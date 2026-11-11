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
- gerar (SQL 122): o cliente simulado fictício de um cenário novo a partir dos padrões AGREGADOS das ligações (só códigos
  e porcentagens, base de 30+), com a ferramenta fechada entregar_cenario; o texto passa pelo mesmo filtro; o cenário
  volta para a Edge Function, que grava em rascunho (uma pessoa revisa e publica).
Só biblioteca padrão.
"""
from __future__ import annotations

import json
import logging
import random
import re

from voz.analise import analisador as AN
from voz.persona import filtrar_fala
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
    # palavra com "@" (e-mail) vira *** antes de tudo, sem regex sobre o texto de fora (tempo linear)
    t = " ".join("***" if "@" in w else w for w in (texto or "")[:2 * MAX_TEXTO].split())
    t = RED.mascarar(t)[0]
    t = re.sub(r"\d{9,}", "***", t).replace("@", " ")
    return " ".join(t.split())[:MAX_TEXTO]


def _txt(v, n: int) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _lista(v, n: int, tam: int = 200) -> list[str]:
    return [_txt(x, tam) for x in (v or [])[:n] if isinstance(x, str) and x.strip()] if isinstance(v, list) else []


def primeiro_nome(persona: str) -> str:
    p = (persona or "").strip()
    for fim in ("(fictícia)", "(fictício)"):
        if p.endswith(fim):
            p = p[: -len(fim)].strip()
    return p or "Ana"


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


# ------------------------------------------------------------------ cenário a partir dos padrões (SQL 122)
FERRAMENTA_CENARIO = "entregar_cenario"
MOTIVOS_SPEECH = {
    "desemprego": "perdeu o emprego", "reducao_renda": "a renda caiu", "outras_dividas": "tem outras dívidas",
    "esquecimento": "esqueceu de pagar", "aguardando_recebimento": "espera receber salário ou benefício",
    "nao_reconhece": "não reconhece a dívida", "contestacao": "contesta a dívida", "fraude_alegada": "diz que foi fraude",
    "insatisfacao_servico": "está insatisfeito com o serviço", "outro": "outro motivo",
}
OBJECOES_SPEECH = {
    "valor_alto": "acha o valor alto", "parcela_alta": "acha a parcela alta", "juros": "reclama dos juros",
    "sem_dinheiro_agora": "diz que não tem dinheiro agora", "quer_desconto": "quer desconto", "desconfia_golpe": "desconfia de golpe",
    "quer_por_escrito": "quer tudo por escrito", "quer_falar_humano": "quer falar com outra pessoa", "outro": "outra objeção",
}
RE_CODIGO = re.compile(r"[a-z][a-z0-9_]{1,39}")
# itens do checklist padrão MotorCX (SQL 60): o texto vai ao LLM quando o pedido traz só o código
ITENS_PADRAO = {
    "ck_ident": "se identificar (empresa e motivo da ligação)", "ck_cpc": "confirmar a identidade antes de falar valor",
    "ck_ameaca": "não ameaçar nem constranger", "ck_oferta": "oferecer uma condição", "ck_canais": "informar os canais de pagamento",
    "ck_naoligue": "respeitar o pedido de não ligar", "ck_terceiro": "não falar da dívida com terceiro",
    "ck_resumo": "resumir o combinado antes de encerrar",
}


def insights_ok(j) -> bool:
    """Só códigos e porcentagens (base >= 30): o mesmo formato de insights_treino_ok do banco."""
    if not isinstance(j, dict) or not isinstance(j.get("base"), (int, float)) or j["base"] < 30 or len(json.dumps(j)) > 4000:
        return False
    for k, v in j.items():
        if k in ("de", "ate"):
            if not (isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v)):
                return False
        elif not re.fullmatch(r"[a-z_]{2,30}(:[a-z0-9_]{1,40})?", k) or isinstance(v, bool) or not isinstance(v, (int, float)):
            return False
    return True


def ferramenta_cenario() -> list[dict]:
    texto = lambda n: {"type": "string", "maxLength": n}   # noqa: E731
    return [{"type": "function", "function": {
        "name": FERRAMENTA_CENARIO, "description": "Entrega o cliente simulado fictício do cenário de treino.",
        "parameters": {"type": "object", "additionalProperties": False,
                       "required": ["nome", "primeiro_nome", "genero", "perfil", "objetivo", "comportamentos", "frases", "objecoes",
                                    "dificuldade", "objetivo_cenario"],
                       "properties": {
                           "nome": texto(70), "primeiro_nome": texto(20), "genero": {"type": "string", "enum": ["f", "m"]},
                           "perfil": {"type": "string", "enum": list(TIPOS)}, "objetivo": texto(480),
                           "comportamentos": {"type": "array", "maxItems": 6, "items": texto(180)},
                           "frases": {"type": "array", "maxItems": 8, "items": texto(180)},
                           "objecoes": {"type": "array", "maxItems": 5, "items": {
                               "type": "object", "additionalProperties": False, "required": ["codigo"],
                               "properties": {"codigo": {"type": "string", "enum": list(OBJECOES)}, "quando": texto(110)}}},
                           "dificuldade": {"type": "integer", "minimum": 1, "maximum": 5}, "objetivo_cenario": texto(190)}}}}]


def _limpo(t, n: int) -> str:
    """Texto do cenário: sem dado com cara de real (9+ dígitos, e-mail, CPF/telefone mascarados), curto e sem dígitos longos."""
    v = mascarar_fala(filtrar_fala(t if isinstance(t, str) else "", ""))
    v = re.sub(r"\d{6,}", "", v)
    return " ".join(v.split())[:n].strip()


def gerar_cenario(pedido: dict, modelo) -> dict:
    """Cenário FICTÍCIO a partir dos padrões agregados das ligações. pedido = {treino: "gerar", insights: {base, de, ate,
    "motivo:x": 0.18, "objecao:y": 0.07, "item:z": 0.52}, item: {id, texto}?}. Vai ao LLM só o JSON de códigos e
    porcentagens (com a descrição dos códigos), nunca trecho, nome ou valor de cliente. Devolve {cenario, tokens} já
    filtrado (o banco confere de novo e grava em rascunho) ou {erro}."""
    ins = pedido.get("insights")
    if not insights_ok(ins):
        return {"erro": "padrões inválidos (só códigos e porcentagens, base de 30 ou mais ligações)"}
    item = pedido.get("item") if isinstance(pedido.get("item"), dict) else None
    if item and not (isinstance(item.get("id"), str) and RE_CODIGO.fullmatch(item["id"])):
        return {"erro": "item inválido"}
    linhas = []
    for k, v in ins.items():
        if ":" not in k:
            continue
        tipo, cod = k.split(":", 1)
        desc = (MOTIVOS_SPEECH if tipo == "motivo" else OBJECOES_SPEECH if tipo == "objecao" else {}).get(cod, cod.replace("_", " "))
        linhas.append(f"- {tipo} \"{desc}\": {round(float(v) * 100)}% das ligações" if tipo != "item"
                      else f"- item do checklist com {round(float(v) * 100)}% de acerto nas ligações")
    foco = (_limpo(item.get("texto"), 120) or ITENS_PADRAO.get(item["id"], "")) if item else ""
    prompt = (
        "Você cria um CLIENTE SIMULADO FICTÍCIO para treinar operadores de cobrança. A partir dos padrões AGREGADOS das "
        f"ligações da empresa (base de {int(ins['base'])} ligações, de {ins.get('de', '?')} a {ins.get('ate', '?')}), descreva "
        "uma pessoa inventada que represente esse padrão. Nunca use nome completo, documento, telefone, e-mail, endereço, "
        "valor em reais ou qualquer coisa que pareça de um cliente real. Português do Brasil, frases curtas.\n"
        "Padrões (só códigos e porcentagens):\n" + "\n".join(linhas) + "\n"
        + (f"O treino deve exercitar este ponto do checklist: {foco}.\n" if foco else "")
        + f"Responda só pela ferramenta {FERRAMENTA_CENARIO}: nome do cenário (curto), primeiro nome fictício, gênero, tipo de "
          "cliente, como a pessoa age (objetivo), comportamentos, frases que ela costuma dizer, objeções na ordem, dificuldade "
          "de 1 a 5 e o objetivo da ligação para o operador.")
    r = modelo.responder([{"role": "user", "content": prompt}], ferramenta_cenario())
    tokens = int(getattr(r, "tokens", 0) or 0)
    a = next((x for nome, x in r.chamadas if nome == FERRAMENTA_CENARIO), None)
    if not isinstance(a, dict):
        return {"erro": "o modelo não devolveu o cenário", "tokens": tokens}
    primeiro = re.sub(r"[^A-Za-zÀ-ÿ]", "", str(a.get("primeiro_nome") or ""))[:20] or "Ana"
    sufixo = "(fictício)" if a.get("genero") == "m" else "(fictícia)"
    perfil = a.get("perfil") if a.get("perfil") in TIPOS else "outro"
    objecoes = [{"codigo": o["codigo"], **({"quando": _limpo(o.get("quando"), 110)} if _limpo(o.get("quando"), 110) else {})}
                for o in (a.get("objecoes") or [])[:5] if isinstance(o, dict) and o.get("codigo") in OBJECOES]
    cen = {
        "nome": _limpo(a.get("nome"), 70) or "Cenário dos padrões das ligações",
        "persona_nome": f"{primeiro.capitalize()} {sufixo}",
        "perfil": perfil,
        "objetivo": _limpo(a.get("objetivo"), 480),
        "comportamentos": [x for x in (_limpo(c, 180) for c in (a.get("comportamentos") or [])[:6]) if x],
        "frases": [x for x in (_limpo(c, 180) for c in (a.get("frases") or [])[:8]) if x],
        "objecoes": objecoes,
        "dificuldade": min(5, max(1, int(a.get("dificuldade") or 3))) if isinstance(a.get("dificuldade"), (int, float)) else 3,
        "objetivo_cenario": _limpo(a.get("objetivo_cenario"), 190) or None,
    }
    if len(cen["nome"]) < 3:
        cen["nome"] = "Cenário dos padrões das ligações"
    if len(cen["objetivo"]) < 10:
        return {"erro": "o modelo não descreveu a cliente", "tokens": tokens}
    return {"cenario": cen, "tokens": tokens}


def rodar(pedido: dict, modelo_de) -> dict:
    """Despacho do simulador: {"treino": "turno" | "avaliar" | "gerar", ...}."""
    if modelo_de is None:
        return {"erro": "treino indisponível nesta VM"}
    acao = pedido.get("treino")
    if acao == "gerar":
        m = modelo_de()
        if hasattr(m, "timeout"):
            m.timeout = max(float(getattr(m, "timeout", 15) or 15), 45.0)
        return gerar_cenario(pedido, m)
    if acao == "turno":
        return turno(pedido, modelo_de())
    if acao == "avaliar":
        m = modelo_de()
        if hasattr(m, "timeout"):
            m.timeout = max(float(getattr(m, "timeout", 15) or 15), 45.0)   # a avaliação lê a conversa inteira
        return avaliar(pedido, m)
    return {"erro": "ação de treino desconhecida"}


def resumo_log(r: dict) -> str:
    """Linha de log sem fala nenhuma (nem o cenário gerado)."""
    return json.dumps({k: r[k] for k in ("situacao", "nota", "reprovada", "desligou", "tokens") if k in r}
                      | ({"cenario": True} if "cenario" in r else {}))
