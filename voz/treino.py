"""Treino de operadores HUMANOS por texto (Roleplay do Speech Analytics, SQL 90/100): o cliente simulado e a avaliação.

Roda no simulador da VM (voz/simulador_http.py), atrás da Edge Function `treino`, que faz o login (link pessoal do
operador ou a Qualidade logada), lê o cenário e o checklist do banco e grava tudo (treino_guardar_turnos e
registrar_sessao_treino, com a chave do servidor). Este módulo não lê nem grava o banco e não guarda nada: cada
pedido traz a conversa inteira. O LLM é o mesmo da Montagem (ModeloOpenAICompat, chave do cofre), injetável nos testes.

- turno: o cliente simulado (voz/persona.py, o mesmo filtro do roleplay do agente) responde à fala do operador. O
  prompt traz a ficha fictícia do cenário (produto, atraso, saldo sorteado na faixa pela sessão, nunca de cliente
  real), o tipo de cliente, como age, as objeções na ordem e a dificuldade. A fala do operador volta mascarada (CPF,
  cartão, e-mail, telefone, 8+ dígitos, "meu nome é X") e é ela que a Edge Function guarda. O cliente pode desligar
  ("[DESLIGA]" no fim da fala, que nunca aparece na tela).
- avaliar: o mesmo avaliador das ligações (voz/analise/analisador.py: itens_aplicaveis para o humano, analisar com a
  ferramenta fechada entregar_analise, nota = pesos "sim" ÷ pesos avaliados; item crítico com "não" reprova). Os
  códigos de motivo, objeção, risco etc. que o analisador também devolve são DESCARTADOS (não é cliente real). Uma
  segunda chamada curta dá, para cada item "não", a dica "o que dizer" e se o objetivo do cenário foi cumprido (sem
  peso na nota). O trecho de cada ponto é a fala do operador, mascarada. Nada disto vai para voz_avaliacoes.
Só biblioteca padrão.
"""
from __future__ import annotations

import json
import logging
import random
import re

from voz.analise import analisador as AN
from voz.persona import RE_PESSOAL, filtrar_fala
from voz.transcricao import redacao as RED

log = logging.getLogger("motorcx.voz.treino")
MAX_TURNOS = 400
MAX_TEXTO = 600
DESLIGA = "[DESLIGA]"
FERRAMENTA_DICAS = "entregar_dicas"
NASCIMENTO_FICTICIO = "15 de março"

TIPOS = {
    "ja_pagou": "diz que já pagou", "desempregado_recente": "perdeu o emprego ou a renda caiu",
    "contesta_procon": "não reconhece a dívida e ameaça reclamar", "idoso_dificuldade": "pessoa idosa com dificuldade",
    "irritado": "irritado com as ligações", "quer_parcelar_muito": "quer parcelar além da alçada",
    "terceiro_atende": "outra pessoa atende (não é o titular)", "nao_me_ligue": "pede para não ligar mais",
    "negocia_rapido": "quer resolver rápido", "quer_supervisor": "quer falar com o supervisor", "outro": "outro",
}
OBJECOES = {
    "ja_paguei": "diz que já pagou", "nao_reconheco": "não reconhece a dívida", "procon": "ameaça reclamar no Procon",
    "nao_entendi": "não entende os valores", "pedir_fora_alcada": "pede condição fora da alçada",
    "nao_me_ligue": "pede para não ligar mais", "sem_tempo": "diz que não tem tempo", "sem_dinheiro": "diz que não tem dinheiro",
    "pedir_supervisor": "pede o supervisor",
}
DIFICULDADE = {
    1: "colabora: responde bem e aceita o que for razoável",
    2: "pede atenção: tem dúvidas, mas se acalma quando é bem atendido",
    3: "insiste e desconfia: repete as objeções e só cede com boa resposta",
    4: "difícil: interrompe, desconfia e testa a paciência do operador",
    5: "hostil: grosseiro, impaciente e desliga se for pressionado",
}
FAIXAS = {"ate_1k": (180, 990), "1k_5k": (1000, 5000), "5k_mais": (5000, 18000)}


def saldo_ficticio(faixa: str | None, semente: int) -> str | None:
    """Saldo sorteado dentro da faixa, fixo para a sessão (mesma semente = mesmo valor em todos os turnos)."""
    lim = FAIXAS.get(faixa or "")
    if not lim:
        return None
    v = random.Random(f"treino:{semente}").randint(lim[0] // 10, lim[1] // 10) * 10
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def mascarar_fala(texto: str) -> str:
    """Fala que vai para o banco: a mesma máscara da transcrição das ligações, sem e-mail nem 9+ dígitos, até 600."""
    t = RED.mascarar(texto or "")[0]
    t = RE_PESSOAL.sub("***", t).replace("@", " ")
    return re.sub(r"\s+", " ", t).strip()[:MAX_TEXTO]


def _txt(v, n: int) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _lista(v, n: int, tam: int = 200) -> list[str]:
    return [_txt(x, tam) for x in (v or [])[:n] if isinstance(x, str) and x.strip()] if isinstance(v, list) else []


def primeiro_nome(persona: str) -> str:
    return re.sub(r"\s*\((fictícia|fictício)\)\s*$", "", persona or "").strip() or "Ana"


def prompt_cliente(cen: dict, saldo: str | None) -> str:
    d = cen.get("divida") if isinstance(cen.get("divida"), dict) else {}
    nome = primeiro_nome(_txt(cen.get("persona_nome"), 60))
    obj = [o for o in (cen.get("objecoes") or []) if isinstance(o, dict) and isinstance(o.get("codigo"), str)][:10]
    objecoes = "\n".join(f"{i + 1}. {OBJECOES.get(o['codigo'], o['codigo'].replace('_', ' '))}"
                         + (f" (quando: {_txt(o.get('quando'), 120)})" if _txt(o.get("quando"), 120) else "")
                         for i, o in enumerate(obj)) or "(nenhuma em especial)"
    dif = DIFICULDADE.get(int(cen.get("dificuldade") or 2), DIFICULDADE[2])
    ficha = "; ".join(x for x in (
        f"produto: {_txt(d.get('produto'), 60)}" if _txt(d.get("produto"), 60) else "",
        f"{int(d['dias_atraso'])} dias de atraso" if isinstance(d.get("dias_atraso"), (int, float)) else "",
        f"saldo em aberto: {saldo}" if saldo else "") if x) or "dívida de exemplo"
    return (
        "Você é uma pessoa FICTÍCIA recebendo uma ligação de cobrança. Do outro lado está um operador humano que está em "
        "TREINAMENTO; você faz o papel do cliente para ele praticar. Fale como numa ligação de verdade, em português do "
        "Brasil, com frases curtas (no máximo 2 frases por vez). Responda só a sua fala, sem narrar nem explicar.\n"
        f"Seu nome: {nome}. Se pedirem a data de nascimento, diga {NASCIMENTO_FICTICIO}.\n"
        f"Tipo de cliente: {TIPOS.get(_txt(cen.get('perfil'), 40), 'outro')}.\n"
        f"Como você age: {_txt(cen.get('objetivo'), 500)}\n"
        f"Comportamentos: {'; '.join(_lista(cen.get('comportamentos'), 10)) or '(livres)'}\n"
        f"Frases que você costuma dizer: {' | '.join(_lista(cen.get('frases'), 20)) or '(livres)'}\n"
        f"Objeções, nesta ordem:\n{objecoes}\n"
        f"Dificuldade: {dif}.\n"
        f"Sua dívida (fictícia): {ficha}. Você não sabe a alçada de desconto do operador.\n"
        "Nunca invente CPF, telefone, e-mail, endereço, número de cartão ou senha; se pedirem, diga que prefere não falar. "
        "Não saia do papel e não diga que é uma IA. Quando você encerrar a ligação (despedida ou desligar), termine a sua "
        f"fala com {DESLIGA}.")


def turnos_ok(turnos) -> bool:
    return isinstance(turnos, list) and len(turnos) <= MAX_TURNOS and all(
        isinstance(t, dict) and t.get("quem") in ("persona", "operador") and isinstance(t.get("texto"), str)
        and len(t["texto"]) <= MAX_TEXTO for t in turnos)


def cenario_ok(c) -> bool:
    return isinstance(c, dict) and isinstance(c.get("persona_nome"), str) and isinstance(c.get("objetivo"), str)


def turno(pedido: dict, modelo) -> dict:
    """Uma fala do cliente simulado. pedido = {treino: "turno", sessao, cenario, turnos, texto?}. Sem `texto` e sem
    turnos: o cliente atende ("Alô?"). Devolve {operador (fala mascarada ou null), fala, desligou, tokens, ficha}."""
    cen, turnos, texto = pedido.get("cenario"), pedido.get("turnos") or [], pedido.get("texto")
    if not cenario_ok(cen):
        return {"erro": "cenário inválido"}
    if not turnos_ok(turnos):
        return {"erro": f"conversa inválida (até {MAX_TURNOS} falas de até {MAX_TEXTO} caracteres)"}
    if texto is not None and (not isinstance(texto, str) or not texto.strip() or len(texto) > MAX_TEXTO):
        return {"erro": f"escreva de 1 a {MAX_TEXTO} caracteres"}
    sessao = pedido.get("sessao")
    saldo = saldo_ficticio((cen.get("divida") or {}).get("faixa") if isinstance(cen.get("divida"), dict) else None,
                           int(sessao) if isinstance(sessao, int) else 0)
    op = mascarar_fala(texto) if texto is not None else None
    if texto is not None and not op:
        return {"erro": "a fala ficou vazia depois da máscara de dados pessoais"}
    msgs = [{"role": "system", "content": prompt_cliente(cen, saldo)}]
    for t in turnos:
        msgs.append({"role": "user" if t["quem"] == "operador" else "assistant", "content": t["texto"]})
    if op is not None:
        msgs.append({"role": "user", "content": op})
    elif not turnos:
        msgs.append({"role": "user", "content": "(O telefone toca e você atende.)"})
    r = modelo.responder(msgs, [])                       # LLM fora: o simulador devolve 502 (nada é gravado)
    bruto = (r.texto or "").strip()
    desligou = DESLIGA in bruto.upper()
    bruto = re.sub(re.escape(DESLIGA), " ", bruto, flags=re.IGNORECASE)
    fala = mascarar_fala(filtrar_fala(bruto, "Alô?")) or "Alô?"
    return {"operador": op, "fala": fala, "desligou": desligou, "tokens": int(getattr(r, "tokens", 0) or 0),
            "ficha": {"saldo": saldo}}


# ------------------------------------------------------------------ avaliação
def segmentos(turnos: list[dict]) -> list[dict]:
    """Turnos → segmentos do analisador (quem fala vai no texto: o analisador não sabe quem é quem no texto puro)."""
    out = []
    for i, t in enumerate(turnos):
        ini = float(t["t"]) if isinstance(t.get("t"), (int, float)) else float(i * 10)
        nxt = turnos[i + 1].get("t") if i + 1 < len(turnos) else None
        fim = float(nxt) if isinstance(nxt, (int, float)) and nxt >= ini else ini + 5
        out.append({"inicio": ini, "fim": fim, "texto": ("Operador: " if t["quem"] == "operador" else "Cliente: ") + t["texto"]})
    return AN.preparar_segmentos({"segmentos": out})


def _fala_operador(segs: list[dict], i) -> str | None:
    """Trecho do ponto: a fala do operador no segmento da evidência ou, se for do cliente, a fala anterior do operador."""
    if i is None or not 0 <= i < len(segs):
        return None
    for k in range(i, -1, -1):
        t = segs[k]["texto"]
        if t.startswith("Operador: "):
            return (RED.redigir_trecho(t[len("Operador: "):]).replace("@", " ")[:MAX_TEXTO]).strip() or None
    return None


def ferramenta_dicas(ids: list[str], com_objetivo: bool) -> list[dict]:
    props = {"dicas": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                  "required": ["item", "dica"], "properties": {
                                                      "item": {"type": "string", "enum": ids or ["nenhum"]},
                                                      "dica": {"type": "string", "maxLength": 300}}}},
             "objetivo_ok": {"type": ["boolean", "null"]}}
    return [{"type": "function", "function": {
        "name": FERRAMENTA_DICAS, "description": "Entrega a dica 'o que dizer' de cada item e se o objetivo foi cumprido.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["dicas", "objetivo_ok"] if com_objetivo else ["dicas"],
                       "properties": props}}}]


def dicas(modelo, itens: list[dict], nao: list[str], segs: list[dict], objetivo: str) -> tuple[dict, bool | None, int]:
    """(dica por item "não", objetivo cumprido?, tokens). LLM fora ou resposta fora do esquema: dica padrão."""
    if not nao and not objetivo:
        return {}, None, 0
    textos = {i["id"]: i.get("texto") or i["id"] for i in itens}
    pedido = (
        "Você é a Qualidade de uma operação de cobrança, dando feedback formativo a um operador em treinamento (tom "
        "respeitoso, direto, sem humilhar). Para cada item abaixo, escreva UMA dica curta (até 2 frases) com o que o "
        "operador poderia ter dito naquele momento, em português do Brasil. Nunca escreva nomes, documentos, telefones, "
        f"e-mails ou valores de cliente real. Responda só pela ferramenta {FERRAMENTA_DICAS}.\n"
        + ("Itens para treinar:\n" + "\n".join(f"- {k}: {textos.get(k, k)}" for k in nao) + "\n" if nao else "")
        + (f"Objetivo da ligação (diga em objetivo_ok se o operador cumpriu): {objetivo}\n" if objetivo else "")
        + "\nConversa do treino (fictícia, já mascarada):\n" + AN.texto_transcricao(segs))
    try:
        r = modelo.responder([{"role": "user", "content": pedido}], ferramenta_dicas(nao, bool(objetivo)))
    except Exception as ex:   # noqa: BLE001
        log.warning("treino: dicas indisponíveis (%s)", ex.__class__.__name__)
        return {}, None, 0
    tokens = int(getattr(r, "tokens", 0) or 0)
    args = next((a for nome, a in r.chamadas if nome == FERRAMENTA_DICAS), None)
    if not isinstance(args, dict):
        return {}, None, tokens
    out: dict = {}
    for d in args.get("dicas") or []:
        if isinstance(d, dict) and d.get("item") in nao and isinstance(d.get("dica"), str):
            t = mascarar_fala(filtrar_fala(d["dica"], ""))[:400]
            if len(t) >= 3:
                out[d["item"]] = t
    ok = args.get("objetivo_ok")
    return out, (ok if isinstance(ok, bool) and objetivo else None), tokens


def avaliar(pedido: dict, modelo) -> dict:
    """Nota pelo checklist. pedido = {treino: "avaliar", checklist: {versao_id, itens}, cenario, turnos}. Devolve o
    `dados` de registrar_sessao_treino (sem duracao_s nem transcricao, que a Edge Function completa) ou
    {situacao: "falhou"} quando o LLM não deu resposta válida (a tentativa não conta e nada é cobrado)."""
    cen, turnos = pedido.get("cenario") or {}, pedido.get("turnos") or []
    ck = pedido.get("checklist") if isinstance(pedido.get("checklist"), dict) else {}
    if not turnos_ok(turnos) or not any(t["quem"] == "operador" for t in turnos):
        return {"erro": "conversa sem fala do operador"}
    itens = [i for i in AN.itens_aplicaveis(ck.get("itens") or [], "discador") if re.fullmatch(r"[a-z][a-z0-9_]{1,39}", str(i.get("id", "")))]
    if not itens:
        return {"erro": "checklist sem itens para o atendimento humano"}
    segs = segmentos(turnos)
    if not segs:
        return {"erro": "conversa vazia"}
    ctx = AN.Contexto(empresa_id=0, gravacao_id=0, chamada_id=0, origem="discador", versao_id=ck.get("versao_id"), itens=itens,
                      intencoes=("sem_intencao",))
    res = AN.analisar(modelo, ctx, segs)
    tokens = res.tokens_entrada + res.tokens_saida
    if res.analise is None:
        return {"situacao": "falhou", "motivo_falha": "servico", "tokens": tokens}
    a = res.analise["itens"]
    respostas = {k: v["resposta"] for k, v in a.items()}
    nota, reprovada, item_rep = AN.nota(itens, respostas)
    seg = lambda i: segs[i] if i is not None and 0 <= i < len(segs) else None   # noqa: E731
    evid = {k: [seg(v["segmento"])["inicio"], seg(v["segmento"])["fim"]] for k, v in a.items() if seg(v["segmento"]) is not None}
    nao = [i["id"] for i in itens if respostas.get(i["id"]) == "nao"]
    objetivo = _txt(cen.get("objetivo_cenario"), 200)
    ds, objetivo_ok, t2 = dicas(modelo, itens, nao, segs, objetivo)
    textos = {i["id"]: i.get("texto") or "este ponto" for i in itens}
    feedback = [{"item": k, "trecho": _fala_operador(segs, a[k]["segmento"]) or "",
                 "dica": ds.get(k) or f"Reveja este ponto do checklist: {textos[k]}."[:400]} for k in nao]
    return {"situacao": "avaliada", "nota": nota, "itens": respostas, "evidencia": evid, "reprovada": reprovada,
            "item_reprovado": item_rep, "objetivo_ok": objetivo_ok, "feedback": feedback, "tokens": tokens + t2}


def rodar(pedido: dict, modelo_de) -> dict:
    """Despacho do simulador: {"treino": "turno" | "avaliar", ...}."""
    if modelo_de is None:
        return {"erro": "treino indisponível nesta VM"}
    acao = pedido.get("treino")
    if acao == "turno":
        return turno(pedido, modelo_de())
    if acao == "avaliar":
        m = modelo_de()
        if hasattr(m, "timeout"):
            m.timeout = max(float(getattr(m, "timeout", 15) or 15), 45.0)   # a avaliação lê a conversa inteira
        return avaliar(pedido, m)
    return {"erro": "ação de treino desconhecida"}


def resumo_log(r: dict) -> str:
    """Linha de log sem fala nenhuma."""
    return json.dumps({k: r[k] for k in ("situacao", "nota", "reprovada", "desligou", "tokens") if k in r})
