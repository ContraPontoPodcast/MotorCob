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


# ---------------------------------------------------------------- mensagens escritas (SQL 85)
# SMS, WhatsApp, RCS e e-mail chegam a quem está com o telefone ou a caixa de e-mail, ANTES de qualquer confirmação de
# identidade: não há "depois da confirmação" dentro do texto. Por isso a regra é mais simples que a da voz: a mensagem
# não cita credor, dívida, valor, parcela, vencimento ou contrato em lugar nenhum (nem por variável). O detalhe fica
# atrás do link autenticado. Os termos da voz (SENSIVEL) valem; somam-se as variáveis de chave simples ({saldo},
# {valor_parcela}…) e as palavras que, numa mensagem de cobrança, dizem que há dívida (parcela, acordo, negociar…).
# Cópia literal em public.mensagem_revela_divida (SQL 85); os casos de tests/dados/mensagem_identidade_casos.json rodam
# aqui, no site (site/src/lib/identidade-mensagem.ts) e no Postgres.
VARIAVEL_MENSAGEM = (r"\{\{? *(saldo\w*|credor\w*|valor\w*|vencimento\w*|dias_atraso|qtd_parcelas\w*|contrato\w*|"
                     r"id_contrato|parcelas_max|desconto\w*|link_pagamento|oferta\.[a-z_]+) *\}\}?")
TERMO_MENSAGEM = (r"\b(parcela\w*|acordo\w*|negocia\w*|renegocia\w*|quita\w*|regulariz\w*|pagamento\w*|pague\w*|"
                  r"pagar|vencid\w*|devedor\w*|devendo|calote\w*)\b")
PADROES_MENSAGEM = {"variavel_mensagem": VARIAVEL_MENSAGEM, "termo_mensagem": TERMO_MENSAGEM}
_RE_MSG = {k: re.compile(v) for k, v in PADROES_MENSAGEM.items()}


def sem_empresa(texto: str, empresa: str | None = None) -> str:
    """Texto normalizado com o nome da empresa trocado por {empresa}: 'Alfa Cobrança' no nome não é a dívida."""
    t = normal(texto)
    e = normal(empresa or "")
    return t.replace(e, "{empresa}") if len(e) >= 2 else t


def motivos_mensagem(texto: str, empresa: str | None = None) -> list[str]:
    """Por que a mensagem escrita revela a dívida a quem pegar o telefone; vazio = neutra."""
    t = sem_empresa(texto, empresa)
    out = [m for m in motivos(t)]
    if _RE_MSG["variavel_mensagem"].search(t):
        out.append("variavel_sensivel")
    if _RE["sensivel"].search(t) or _RE_MSG["termo_mensagem"].search(t):
        out.append("termo_sensivel")
    return out


def mensagem_revela(texto: str, empresa: str | None = None) -> bool:
    return bool(motivos_mensagem(texto, empresa))
