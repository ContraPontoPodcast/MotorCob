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
