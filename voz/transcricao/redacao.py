"""Redação do texto transcrito: CPF e número de cartão nunca ficam na transcrição (LGPD; decisões 4b e 21).

Pega também o que a fala vira no texto: dígitos separados por espaço, ponto, hífen ou barra ("123 456 789 09",
"1234-5678-9012-3456"). Regras:
  CPF      formato 000.000.000-00 sempre; 11 dígitos seguidos (ou separados) quando os dígitos verificadores
           conferem.
  cartão   13 a 19 dígitos (separados ou não) que passam no Luhn.
Número de telefone (10/11 dígitos que não são CPF válido) fica; valor em reais fica.
"""
from __future__ import annotations

import re

CPF_FORMATADO = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
# sequência de 11 a 19 dígitos com separadores simples entre eles
SEQUENCIA = re.compile(r"(?<![\d])(?:\d[ .\-/]?){10,18}\d(?![\d])")
MARCA_CPF = "[CPF REDIGIDO]"
MARCA_CARTAO = "[CARTÃO REDIGIDO]"


def cpf_valido(d: str) -> bool:
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        if int(d[n]) != (soma * 10 % 11) % 10:
            return False
    return True


def luhn(d: str) -> bool:
    total = 0
    for i, c in enumerate(reversed(d)):
        n = int(c)
        if i % 2:
            n *= 2
            n -= 9 if n > 9 else 0
        total += n
    return total % 10 == 0


def redigir(texto: str) -> tuple[str, dict]:
    """(texto redigido, contagem {'cpf': n, 'cartao': n})."""
    cont = {"cpf": 0, "cartao": 0}

    def _cpf(_m):
        cont["cpf"] += 1
        return MARCA_CPF

    t = CPF_FORMATADO.sub(_cpf, texto or "")

    def _seq(m):
        d = re.sub(r"\D", "", m.group(0))
        if len(d) == 11 and cpf_valido(d):
            cont["cpf"] += 1
            return MARCA_CPF
        if 13 <= len(d) <= 19 and luhn(d):
            cont["cartao"] += 1
            return MARCA_CARTAO
        return m.group(0)

    return SEQUENCIA.sub(_seq, t), cont


# ------------------------------------------------------------------ trechos do Speech Analytics (SQL 60)
# Antes de guardar um trecho ou calcular o embedding, a máscara vai além de CPF e cartão: telefone, e-mail, nomes
# conhecidos da chamada e saúde. Nada sem máscara é indexado.
TELEFONE = re.compile(r"(?<!\d)(?:\+?55[ .\-]?)?\(?\d{2}\)?[ .\-]?9?\d{4}[ .\-]?\d{4}(?!\d)")
EMAIL = re.compile(r"[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+")
DIGITOS_LONGOS = re.compile(r"\d{8,}")
NOME_DITO = re.compile(r"\b(meu nome é|me chamo|aqui é o|aqui é a|falo com o|falo com a|com o senhor|com a senhora)"
                       r"\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]+)", re.IGNORECASE)
SAUDE = re.compile(r"\b(c[aâ]ncer|quimioterapia|quimio|cirurgia|internad[oa]|interna[çc][aã]o|hospital|uti|avc|"
                   r"infarto|depress[aã]o|ansiedade|tratamento|rem[eé]dio|diabetes|hiv|doen[çc]a|doente|gr[aá]vida|"
                   r"gravidez|hemodi[aá]lise|psiquiatra|transplante)\b", re.IGNORECASE)
MARCA_TELEFONE, MARCA_EMAIL, MARCA_NOME, MARCA_SAUDE, MARCA_NUMERO = (
    "[TELEFONE]", "[E-MAIL]", "[NOME]", "[SAÚDE]", "[NÚMERO]")


def redigir_trecho(texto: str, nomes: tuple[str, ...] | list[str] = ()) -> str:
    """Máscara completa do trecho: CPF e cartão (redigir), e-mail, telefone, nomes conhecidos da chamada (ex.:
    primeiro_nome das variáveis) e ditos ("meu nome é X"), termos de saúde e qualquer sequência de 8+ dígitos."""
    t, _ = redigir(texto)
    t = EMAIL.sub(MARCA_EMAIL, t)
    t = TELEFONE.sub(MARCA_TELEFONE, t)
    t = DIGITOS_LONGOS.sub(MARCA_NUMERO, t)
    for n in sorted({x.strip() for x in nomes if x and len(x.strip()) >= 2}, key=len, reverse=True):
        t = re.sub(rf"\b{re.escape(n)}\b", MARCA_NOME, t, flags=re.IGNORECASE)
    t = NOME_DITO.sub(lambda m: f"{m.group(1)} {MARCA_NOME}", t)
    return SAUDE.sub(MARCA_SAUDE, t)


def mascarar(texto: str, nomes: tuple[str, ...] | list[str] = ()) -> tuple[str, dict]:
    """Máscara da conversa inteira (a mesma do analisador antes do LLM): CPF, cartão, e-mail, telefone, sequências de
    8+ dígitos, nomes conhecidos da chamada (primeiro_nome) e nome dito ("meu nome é X"). Saúde fica (é o sinal de
    vulnerabilidade; só vira [SAÚDE] no trecho guardado, redigir_trecho). Devolve (texto, contagem)."""
    t, cont = redigir(texto or "")
    cont = dict(cont, email=0, telefone=0, numero=0, nome=0)

    def _sub(rx, marca, chave, s):
        def f(_m):
            cont[chave] += 1
            return marca
        return rx.sub(f, s)

    t = _sub(EMAIL, MARCA_EMAIL, "email", t)
    t = _sub(TELEFONE, MARCA_TELEFONE, "telefone", t)
    t = _sub(DIGITOS_LONGOS, MARCA_NUMERO, "numero", t)
    for n in sorted({x.strip() for x in nomes if x and len(x.strip()) >= 2}, key=len, reverse=True):
        t, k = re.subn(rf"\b{re.escape(n)}\b", MARCA_NOME, t, flags=re.IGNORECASE)
        cont["nome"] += k

    def _dito(m):
        cont["nome"] += 1
        return f"{m.group(1)} {MARCA_NOME}"

    return NOME_DITO.sub(_dito, t), cont
