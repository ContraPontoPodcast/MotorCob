"""Identidade antes da dívida nos TEXTOS (SQL 83 · B7; revisão do especialista C10 e G36).

A trava do fluxo (voz/fluxo_validador.py: valor, oferta ou credor só depois de Confirmar identidade) vale também para o
que o Speech Analytics escreve: recomendação (título, texto e a frase proposta) e o relatório ao credor. Nenhum texto
gerado pode sugerir dizer o credor, a dívida, o valor ou o contrato ANTES de a pessoa confirmar ser o titular
(CDC art. 42; LGPD art. 6º, III). Revelar a dívida a um terceiro expõe o devedor.

  motivos(texto)        lista de motivos (vazia = pode). Duas regras, por frase:
                        1. instrução: fala de credor/dívida/valor/contrato junto com "abrir a conversa", "na abertura",
                           "no início", "primeira fala", "antes de confirmar a identidade"… sem dizer que é DEPOIS da
                           confirmação e sem negar ("nunca", "não diga"…);
                        2. fala de abertura: o texto começa com cumprimento ("Olá", "Bom dia", "Alô", "aqui é",
                           "falo com") e cita credor, dívida, valor, contrato ou uma variável sensível ({{credor}},
                           {{saldo}}…) antes de a pessoa responder.
  recomendacao_ok(r)    título, texto e proposta.texto da recomendação passam.

Cópia fiel de public.texto_revela_antes_identidade (SQL 83): os mesmos casos (tests/dados/trava_identidade_casos.json)
rodam aqui (tests/test_trava_identidade.py) e no Postgres (supabase/testes/testar_rls.py).
Só biblioteca padrão.
"""
from __future__ import annotations

import re

# Os padrões ficam em texto simples (sem lookaround nem quantificador preguiçoso) para o Postgres usar os mesmos:
# o SQL 83 tem cópia literal, com \b trocado por \y (tests/test_trava_identidade.py confere).
# credor, dívida, valor, contrato… (sem acento, minúsculo). "valor" só com o que faz dele a dívida.
SENSIVEL = (r"\b(credor\w*|divida\w*|debito\w*|contrato\w*|saldo\w*|pendencia\w*|inadimpl\w*|atrasad\w*|"
            r"em atraso|em aberto|fatura\w*|boleto\w*|cobranca\w*|valor (devido|da divida|do debito|em aberto|"
            r"da parcela|total))\b|\{\{ *(credor|saldo|dias_atraso|vencimento|valor_minimo|parcelas_max|"
            r"desconto_max|link_pagamento|oferta\.[a-z_]+) *\}\}")
# a instrução fala do começo da ligação ou de antes da confirmação
ABERTURA = (r"\b(abr(ir|a|e|indo)( a| o)? (conversa|ligacao|chamada|contato)|abertura|na saudacao|no cumprimento|"
            r"no inicio|logo de (cara|inicio)|logo no (inicio|comeco)|no comeco|primeira (fala|frase)|"
            r"comec(ar|e|o|a|ando) (a conversa|a ligacao|a chamada|com|dizendo|falando)|ao atender|"
            r"assim que (atender|atende)|antes de (confirmar|conferir|validar|checar|verificar|identificar)|"
            r"antes da (confirmacao|identificacao|validacao|verificacao)|"
            r"sem (confirmar|conferir|validar|verificar) (a )?identidade)\b")
# … mas diz que é depois da confirmação (como o texto recomendado pelo especialista)
DEPOIS = r"\b(depois|apos|so quando|somente quando)\b[^.]*\b(confirm|identific|valid|verific)"
# … ou proíbe ("nunca diga o credor na abertura", "não fale da dívida antes de confirmar")
NEGA = (r"\b(nunca|jamais|evite|evitar|proibido)\b|\b(nao|sem) (\w+ ){0,2}(diga|dizer|fale|falar|mencione|"
        r"mencionar|cite|citar|revele|revelar|informe|informar|abra|abrir|comece|comecar|use|usar)\b")
# fala de abertura: a primeira frase cumprimenta ou pergunta com quem fala
CUMPRIMENTO = r"^(ola|oi|bom dia|boa tarde|boa noite|alo)\b|\b(aqui e|falo com|estou falando com)\b"
PADROES = {"sensivel": SENSIVEL, "abertura": ABERTURA, "depois": DEPOIS, "nega": NEGA, "cumprimento": CUMPRIMENTO}
_RE = {k: re.compile(v) for k, v in PADROES.items()}
ACENTOS = ("áàâãäéèêëíìîïóòôõöúùûüç", "aaaaaeeeeiiiiooooouuuuc")


def normal(texto: str) -> str:
    """Minúsculo, sem acento e com um espaço só (o mesmo translate + lower do banco)."""
    t = str(texto or "").lower().translate(str.maketrans(*ACENTOS))
    return re.sub(r"\s+", " ", t).strip()


def frases(texto: str) -> list[str]:
    return [f.strip() for f in re.split(r"[.!?;\n]+", normal(texto)) if f.strip()]


def motivos(texto: str) -> list[str]:
    """Motivos (códigos) pelos quais o texto revela a dívida antes da identidade; vazio = pode."""
    out: list[str] = []
    fs = frases(texto)
    if not fs:
        return out
    if any(_RE["sensivel"].search(f) and _RE["abertura"].search(f) and not _RE["depois"].search(f)
           and not _RE["nega"].search(f) for f in fs):
        out.append("instrucao_antes_identidade")
    if _RE["cumprimento"].search(fs[0]) and any(_RE["sensivel"].search(f) for f in fs):
        out.append("abertura_revela_divida")
    return out


def revela(texto: str) -> bool:
    return bool(motivos(texto))


def textos_da_recomendacao(r) -> list[str]:
    """Título, texto e frase proposta (dataclass Recomendacao ou dict do banco/relatório)."""
    g = (lambda k: getattr(r, k, None)) if not isinstance(r, dict) else r.get
    proposta = g("proposta") or {}
    return [str(x) for x in (g("titulo"), g("texto"), g("evidencia") if isinstance(g("evidencia"), str) else None,
                             proposta.get("texto") if isinstance(proposta, dict) else None) if x]


def recomendacao_ok(r) -> bool:
    return not any(revela(t) for t in textos_da_recomendacao(r))
