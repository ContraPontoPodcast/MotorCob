"""Avaliador por IA (checklist) e extrator de códigos do Speech Analytics: UMA chamada ao LLM por gravação.

Entrada: a transcrição da gravação que o worker deixou na VM (voz/transcricao/worker.py: CPF e cartão já
redigidos) e o contexto do banco (speech_contexto_voz: versão do checklist vigente no dia da ligação, catálogo de
intenções e temas promovidos da empresa). Antes de ir ao LLM, o texto passa de novo pela máscara (e-mail, telefone,
sequências de dígitos e nome dito); saúde fica, porque é o sinal de vulnerabilidade. O LLM é o mesmo da Montagem
(voz/provedores/montagem.py › ModeloOpenAICompat, chave do Secret Manager), injetável nos testes.

Saída fechada pela ferramenta entregar_analise (esquema com enums): por item do checklist sim | nao | na com
confiança e o segmento da evidência; motivo e objeção principal como probabilidades; objeções; intenção do catálogo;
canal e horário preferidos; sinais de vulnerabilidade; riscos (Procon, jurídico, ameaça, linguagem abusiva, fraude,
reclamação); frases-código do agente; temas promovidos; sentimento no início e no fim; quem fala em cada segmento
(A = empresa, C = cliente); fração da transcrição incompreensível. Qualquer código fora das listas, item faltando ou
número fora do intervalo recusa a resposta inteira, e o LLM recebe os erros para corrigir (até MAX_TENTATIVAS
chamadas). Sem resposta válida: a gravação fica "falhou" (o custo é registrado; nada é cobrado).

Daqui saem, para gravar_analise_voz (SQL 62), só códigos, números e trechos mascarados (redigir_trecho):
  nota      soma dos pesos com "sim" ÷ soma dos pesos avaliados (sim + nao) × 100; tudo "na" = 100. Item bloqueante
            com "nao" reprova a ligação (fora de conformidade) e o trecho dele vai para a lista das reprovadas.
  códigos   motivo só com probabilidade >= LIMIAR_CODIGO; nunca texto livre nem dado pessoal.
  alertas   vulnerabilidade só com o sinal (sem trecho); Procon, jurídico, ameaça e abusiva com o trecho mascarado.
  curadoria as regras do SQL 60 (voz/analise/curadoria.py: intenção < 0,5; motivo/objeção com as duas maiores
            probabilidades a menos de 0,15; transcrição com mais de 30% ruim) e item do checklist com confiança
            < LIMIAR_NOTA (tipo nota, um por avaliação).
  áudio     fala da empresa e do cliente, silêncio e interrupções, contados dos segmentos (sem LLM).
  uso       tokens de entrada e de saída de todas as tentativas (custo real) e os minutos da gravação (cobrados só
            na primeira análise que deu certo, pelo banco).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from voz.analise import catalogo as CAT
from voz.analise import curadoria as CU
from voz.analise.trechos import falante_de
from voz.transcricao import redacao as RED

log = logging.getLogger("motorcx.voz.speech")
VERSAO = "speech-v1"
FERRAMENTA = "entregar_analise"
MAX_TENTATIVAS = 3                 # 1 + 2 correções
LIMIAR_NOTA = 0.6                  # item do checklist com confiança menor vai para a Curadoria (tipo nota)
LIMIAR_CODIGO = 0.4                # motivo só vira código com essa probabilidade
LIMIAR_DUVIDA = 0.3                # a regra das duas maiores só vale quando a maior passa disto (senão não há código)
MAX_SEGMENTOS = 900
MAX_TEXTO_SEGMENTO = 400
LETRAS = re.compile(r"^[AC]*$")


@dataclass
class Contexto:
    """Uma gravação a analisar (o que speech_contexto_voz devolve, mais os catálogos da empresa)."""
    empresa_id: int
    gravacao_id: int
    chamada_id: int
    origem: str                          # ia | discador
    versao_id: int | None
    itens: list = field(default_factory=list)       # itens do checklist APLICÁVEIS a esta origem
    intencoes: tuple = ()
    temas: dict = field(default_factory=dict)       # id -> nome (só promovidos)
    credor_id: int | None = None
    operador_ref: str | None = None
    duracao_s: float | None = None
    transferida_s: float | None = None
    modelo: str = ""


@dataclass
class Resultado:
    analise: dict | None
    tokens_entrada: int = 0
    tokens_saida: int = 0
    chamadas_llm: int = 0
    erros: list = field(default_factory=list)


def itens_aplicaveis(itens, origem: str) -> list[dict]:
    """Itens ligados que valem para a origem (IA: ia/ambos; discador: humano/ambos)."""
    alvo = "ia" if origem == "ia" else "humano"
    return [dict(i) for i in (itens or []) if isinstance(i, dict) and i.get("on") and i.get("aplica") in ("ambos", alvo)]


def mascarar_para_llm(texto: str) -> str:
    """CPF, cartão, e-mail, telefone, sequências longas de dígitos e nome dito. Saúde fica (sinal de vulnerabilidade).
    A mesma máscara da transcrição das ligações da IA (voz/transcricao/redacao.py › mascarar)."""
    return RED.mascarar(texto or "")[0]


def preparar_segmentos(transcricao: dict) -> list[dict]:
    """Segmentos em ordem, mascarados e cortados. Transcrição sem segmentos (reserva por API) vira um segmento só."""
    brutos = transcricao.get("segmentos") or []
    if not brutos and (transcricao.get("texto") or "").strip():
        brutos = [{"inicio": 0.0, "fim": float(transcricao.get("duracao_s") or 0), "texto": transcricao["texto"]}]
    out = []
    for s in sorted((x for x in brutos if isinstance(x, dict)), key=lambda x: float(x.get("inicio") or 0)):
        texto = mascarar_para_llm(str(s.get("texto") or "")).strip()
        ini, fim = float(s.get("inicio") or 0), float(s.get("fim") or 0)
        if not texto or fim < ini:
            continue
        out.append({"inicio": round(ini, 2), "fim": round(fim, 2), "texto": texto[:MAX_TEXTO_SEGMENTO],
                    "locutor": s.get("locutor")})
    return out[:MAX_SEGMENTOS]


# ------------------------------------------------------------------ pedido ao LLM
def _seg() -> dict:
    return {"type": ["integer", "null"], "minimum": 0, "description": "índice do segmento da evidência"}


def _probs(lista) -> dict:
    return {"type": ["object", "null"], "additionalProperties": False, "required": ["probabilidades", "segmento"],
            "properties": {"probabilidades": {"type": "object", "additionalProperties": False,
                                              "properties": {c: {"type": "number", "minimum": 0, "maximum": 1} for c in lista}},
                           "segmento": _seg()}}


def ferramenta(ctx: Contexto) -> list[dict]:
    temas = sorted(int(t) for t in ctx.temas)
    props = {
        "itens": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                             "required": ["id", "resposta", "confianca", "segmento"], "properties": {
                                                 "id": {"type": "string", "enum": [i["id"] for i in ctx.itens]},
                                                 "resposta": {"type": "string", "enum": list(CAT.RESPOSTAS)},
                                                 "confianca": {"type": "number", "minimum": 0, "maximum": 1},
                                                 "segmento": _seg()}}},
        "motivo": _probs(CAT.MOTIVOS),
        "objecoes": {"type": "array", "maxItems": 5, "items": {"type": "string", "enum": list(CAT.OBJECOES)}},
        "objecao_principal": _probs(CAT.OBJECOES),
        "intencao": {"type": ["object", "null"], "additionalProperties": False,
                     "required": ["codigo", "confianca", "alternativas", "segmento"], "properties": {
                         "codigo": {"type": "string", "enum": list(ctx.intencoes)},
                         "confianca": {"type": "number", "minimum": 0, "maximum": 1},
                         "alternativas": {"type": "array", "maxItems": 3, "items": {"type": "string", "enum": list(ctx.intencoes)}},
                         "segmento": _seg()}},
        "canal_preferido": {"type": ["string", "null"], "enum": [*CAT.CANAIS, None]},
        "horario_preferido": {"type": ["string", "null"], "enum": [*CAT.HORARIOS, None]},
        "vulnerabilidade": {"type": "array", "maxItems": 4, "items": {"type": "object", "additionalProperties": False,
                                                                      "required": ["sinal", "segmento"], "properties": {
                                                                          "sinal": {"type": "string", "enum": list(CAT.SINAIS)},
                                                                          "segmento": _seg()}}},
        "riscos": {"type": "array", "maxItems": 6, "items": {"type": "object", "additionalProperties": False,
                                                             "required": ["tipo", "falante", "segmento"], "properties": {
                                                                 "tipo": {"type": "string", "enum": list(CAT.RISCOS)},
                                                                 "falante": {"type": "string", "enum": list(CAT.FALANTES)},
                                                                 "segmento": _seg()}}},
        "frases": {"type": "array", "maxItems": 4, "items": {"type": "string", "enum": list(CAT.FRASES)}},
        "temas": ({"type": "array", "maxItems": 3, "items": {"type": "integer", "enum": temas}} if temas
                  else {"type": "array", "maxItems": 0}),
        "sentimento": {"type": ["object", "null"], "additionalProperties": False, "required": ["inicio", "fim"],
                       "properties": {"inicio": {"type": "number", "minimum": -1, "maximum": 1},
                                      "fim": {"type": "number", "minimum": -1, "maximum": 1}}},
        "falantes": {"type": "string", "description": "uma letra por segmento, na ordem: A = empresa, C = cliente"},
        "transcricao_ruim": {"type": "number", "minimum": 0, "maximum": 1},
    }
    return [{"type": "function", "function": {
        "name": FERRAMENTA, "description": "Entrega a avaliação do checklist e os códigos da ligação (só listas fechadas).",
        "parameters": {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}}}]


def _lista(nome: str, codigos) -> str:
    desc = CAT.DESCRICAO.get(nome, {})
    return ", ".join(f"{c} ({desc[c]})" if c in desc else c for c in codigos)


def texto_transcricao(segs: list[dict]) -> str:
    return "\n".join(f"[{i}] {s['inicio']:.1f}-{s['fim']:.1f}s: {s['texto']}" for i, s in enumerate(segs))


def mensagens(ctx: Contexto, segs: list[dict]) -> list[dict]:
    quem = "o agente de IA (e, depois da transferência, o operador)" if ctx.origem == "ia" else "o operador humano"
    itens = "\n".join(f"- {i['id']}: {i['texto']}" + (f" (critério: {i['criterio']})" if i.get("criterio") else "")
                      + f" [{i.get('gravidade')}]" for i in ctx.itens) or "- (nenhum item aplicável)"
    temas = "\n".join(f"- {t}: {n}" for t, n in sorted(ctx.temas.items())) or "- (nenhum)"
    sistema = (
        "Você analisa ligações de cobrança gravadas para a garantia de qualidade do MotorCX, em português do Brasil. "
        f"Na ligação, a empresa é {quem}. Responda só com a ferramenta {FERRAMENTA}, usando apenas os códigos das listas. "
        "Nunca escreva nomes, documentos, telefones, e-mails, endereços ou qualquer texto livre.\n"
        "Checklist: para cada item, sim (cumpriu), nao (não cumpriu) ou na (não se aplicou nesta ligação), a confiança "
        "(0 a 1) e o índice do segmento que é a evidência (null se não houver).\n"
        "motivo e objecao_principal: probabilidades (somando no máximo 1) só para o que o CLIENTE disse; null se ele não "
        "falou disso. objecoes: todas as objeções que o cliente levantou. intencao: a principal intenção do cliente, "
        "do catálogo, com a confiança e até 3 alternativas. canal_preferido e horario_preferido só se o cliente pediu. "
        "vulnerabilidade: só sinais claros ditos pelo cliente. riscos: quem disse (cliente, agente ou operador). "
        "frases: o que o atendente fez. temas: só da lista. sentimento do cliente no início e no fim (-1 a 1), null se "
        "não der para saber. falantes: uma letra por segmento (A empresa, C cliente), exatamente "
        f"{len(segs)} letras. transcricao_ruim: fração (0 a 1) do texto incompreensível.")
    usuario = (
        f"Itens do checklist:\n{itens}\n\n"
        f"Motivos: {_lista('motivo', CAT.MOTIVOS)}\n"
        f"Objeções: {', '.join(CAT.OBJECOES)}\n"
        f"Intenções: {', '.join(ctx.intencoes) or '(nenhuma)'}\n"
        f"Canais: {', '.join(CAT.CANAIS)} · Horários: {', '.join(CAT.HORARIOS)}\n"
        f"Sinais de vulnerabilidade: {_lista('sinais', CAT.SINAIS)}\n"
        f"Riscos: {_lista('riscos', CAT.RISCOS)}\n"
        f"Frases do atendente: {_lista('frases', CAT.FRASES)}\n"
        f"Temas:\n{temas}\n\n"
        f"Transcrição ({len(segs)} segmentos, já mascarada):\n{texto_transcricao(segs)}")
    return [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]


# ------------------------------------------------------------------ validação (nada fora das listas)
def _num(v, lo: float, hi: float) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= float(v) <= hi


def _indice(v, n: int, erros: list, onde: str):
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v < n:
        erros.append(f"segmento_invalido:{onde}")
        return None
    return v


def _probabilidades(v, lista, n: int, erros: list, onde: str):
    if v is None:
        return None
    if not isinstance(v, dict) or set(v) - {"probabilidades", "segmento"} or not isinstance(v.get("probabilidades"), dict):
        erros.append(f"formato:{onde}")
        return None
    p = v["probabilidades"]
    fora = [k for k in p if k not in lista]
    if fora:
        erros.append(f"codigo_fora_da_lista:{onde}:{','.join(sorted(fora))[:80]}")
        return None
    if any(not _num(x, 0, 1) for x in p.values()) or sum(float(x) for x in p.values()) > 1.05:
        erros.append(f"probabilidade_invalida:{onde}")
        return None
    return {"probabilidades": {k: round(float(x), 3) for k, x in p.items()},
            "segmento": _indice(v.get("segmento"), n, erros, onde)}


def _codigos(v, lista, maximo: int, erros: list, onde: str) -> list:
    if not isinstance(v, list) or len(v) > maximo:
        erros.append(f"formato:{onde}")
        return []
    fora = [x for x in v if x not in lista]
    if fora:
        erros.append(f"codigo_fora_da_lista:{onde}:{','.join(map(str, fora))[:80]}")
        return []
    return list(dict.fromkeys(v))


def validar(args: dict, ctx: Contexto, n: int) -> tuple[dict | None, list[str]]:
    """Normaliza a resposta do LLM. Qualquer coisa fora do esquema vira erro (a resposta inteira é recusada)."""
    erros: list[str] = []
    if not isinstance(args, dict):
        return None, ["resposta_fora_do_esquema"]
    esperadas = set(ferramenta(ctx)[0]["function"]["parameters"]["properties"])
    fora, faltam = set(args) - esperadas, esperadas - set(args) - {"objecao_principal", "temas", "transcricao_ruim"}
    if fora:
        erros.append("campo_fora_do_esquema:" + ",".join(sorted(fora))[:80])
    if faltam:
        erros.append("campo_faltando:" + ",".join(sorted(faltam)))
    out: dict = {}
    # checklist: todos os itens aplicáveis, uma vez cada
    ids = [i["id"] for i in ctx.itens]
    itens: dict = {}
    for x in args.get("itens") or []:
        if not isinstance(x, dict) or set(x) - {"id", "resposta", "confianca", "segmento"}:
            erros.append("formato:itens")
            continue
        if x.get("id") not in ids or x.get("id") in itens:
            erros.append(f"item_fora_do_checklist:{str(x.get('id'))[:40]}")
            continue
        if x.get("resposta") not in CAT.RESPOSTAS or not _num(x.get("confianca"), 0, 1):
            erros.append(f"resposta_invalida:{x['id']}")
            continue
        itens[x["id"]] = {"resposta": x["resposta"], "confianca": round(float(x["confianca"]), 3),
                          "segmento": _indice(x.get("segmento"), n, erros, x["id"])}
    faltando = [i for i in ids if i not in itens]
    if faltando:
        erros.append("item_sem_resposta:" + ",".join(faltando)[:80])
    out["itens"] = itens
    out["motivo"] = _probabilidades(args.get("motivo"), CAT.MOTIVOS, n, erros, "motivo")
    out["objecao_principal"] = _probabilidades(args.get("objecao_principal"), CAT.OBJECOES, n, erros, "objecao_principal")
    out["objecoes"] = _codigos(args.get("objecoes", []), CAT.OBJECOES, 5, erros, "objecoes")
    it = args.get("intencao")
    out["intencao"] = None
    if it is not None:
        if (not isinstance(it, dict) or set(it) - {"codigo", "confianca", "alternativas", "segmento"}
                or it.get("codigo") not in ctx.intencoes or not _num(it.get("confianca"), 0, 1)):
            erros.append("intencao_fora_do_catalogo")
        else:
            alt = _codigos(it.get("alternativas") or [], ctx.intencoes, 3, erros, "intencao.alternativas")
            out["intencao"] = {"codigo": it["codigo"], "confianca": round(float(it["confianca"]), 3),
                               "alternativas": [a for a in alt if a != it["codigo"]],
                               "segmento": _indice(it.get("segmento"), n, erros, "intencao")}
    for campo, lista in (("canal_preferido", CAT.CANAIS), ("horario_preferido", CAT.HORARIOS)):
        v = args.get(campo)
        if v is not None and v not in lista:
            erros.append(f"codigo_fora_da_lista:{campo}:{str(v)[:40]}")
            v = None
        out[campo] = v
    vul = []
    for x in args.get("vulnerabilidade") or []:
        if not isinstance(x, dict) or set(x) - {"sinal", "segmento"} or x.get("sinal") not in CAT.SINAIS:
            erros.append("codigo_fora_da_lista:vulnerabilidade")
            continue
        vul.append({"sinal": x["sinal"], "segmento": _indice(x.get("segmento"), n, erros, "vulnerabilidade")})
    out["vulnerabilidade"] = vul
    riscos = []
    for x in args.get("riscos") or []:
        if (not isinstance(x, dict) or set(x) - {"tipo", "falante", "segmento"} or x.get("tipo") not in CAT.RISCOS
                or x.get("falante") not in CAT.FALANTES):
            erros.append("codigo_fora_da_lista:riscos")
            continue
        riscos.append({"tipo": x["tipo"], "falante": x["falante"], "segmento": _indice(x.get("segmento"), n, erros, "riscos")})
    out["riscos"] = riscos
    out["frases"] = _codigos(args.get("frases") or [], CAT.FRASES, 4, erros, "frases")
    temas = args.get("temas") or []
    if not isinstance(temas, list) or len(temas) > 3 or any(isinstance(t, bool) or not isinstance(t, int)
                                                            or t not in ctx.temas for t in temas):
        erros.append("tema_fora_da_lista")
        temas = []
    out["temas"] = list(dict.fromkeys(temas))
    s = args.get("sentimento")
    out["sentimento"] = None
    if s is not None:
        if not isinstance(s, dict) or set(s) != {"inicio", "fim"} or not _num(s["inicio"], -1, 1) or not _num(s["fim"], -1, 1):
            erros.append("sentimento_invalido")
        else:
            out["sentimento"] = (round(float(s["inicio"]), 3), round(float(s["fim"]), 3))
    f = args.get("falantes")
    if f is not None and (not isinstance(f, str) or not LETRAS.match(f)):
        erros.append("falantes_invalido")
        f = None
    out["falantes"] = f if f and len(f) == n else None          # tamanho errado: só não divide a fala
    r = args.get("transcricao_ruim", 0)
    if not _num(r, 0, 1):
        erros.append("transcricao_ruim_invalida")
        r = 0
    out["transcricao_ruim"] = round(float(r), 3)
    return (None if erros else out), erros


# ------------------------------------------------------------------ a chamada ao LLM (com correção)
def _tokens(r) -> tuple[int, int]:
    e, s = int(getattr(r, "tokens_entrada", 0) or 0), int(getattr(r, "tokens_saida", 0) or 0)
    if e + s == 0:
        s = int(getattr(r, "tokens", 0) or 0)       # sem a divisão: tudo como saída (o mais caro; conservador)
    return e, s


def analisar(modelo, ctx: Contexto, segs: list[dict], max_tentativas: int = MAX_TENTATIVAS) -> Resultado:
    msgs = mensagens(ctx, segs)
    ferr = ferramenta(ctx)
    res = Resultado(None, erros=["sem_resposta_do_llm"])
    for _ in range(max_tentativas):
        try:
            r = modelo.responder(msgs, ferr)
        except Exception as ex:   # noqa: BLE001 — LLM fora: a gravação fica para a próxima rodada
            log.warning("speech: LLM indisponível (%s)", ex.__class__.__name__)
            res.erros = ["llm_indisponivel"]
            break
        res.chamadas_llm += 1
        e, s = _tokens(r)
        res.tokens_entrada += e
        res.tokens_saida += s
        args = next((a for nome, a in r.chamadas if nome == FERRAMENTA), None)
        if not isinstance(args, dict):
            res.erros = ["resposta_fora_do_esquema"]
            msgs.append({"role": "user", "content": f"Responda só com a ferramenta {FERRAMENTA}."})
            continue
        norm, erros = validar(args, ctx, len(segs))
        if norm is not None:
            res.analise, res.erros = norm, []
            return res
        res.erros = erros
        msgs.append({"role": "assistant", "content": json.dumps(args, ensure_ascii=False)[:20000]})
        msgs.append({"role": "user", "content": "Resposta recusada (fora das listas fechadas): " + "; ".join(erros)[:2000]
                                                + f". Corrija e entregue de novo pela ferramenta {FERRAMENTA}."})
    return res


# ------------------------------------------------------------------ contas (sem LLM)
def nota(itens: list[dict], respostas: dict) -> tuple[float, bool, str | None]:
    """(nota 0–100, reprovada, primeiro item bloqueante reprovado)."""
    avaliados = aprovados = 0
    for i in itens:
        r = respostas.get(i["id"])
        if r in ("sim", "nao"):
            avaliados += int(i.get("peso") or 1)
            aprovados += int(i.get("peso") or 1) if r == "sim" else 0
    bloq = [i["id"] for i in itens if i.get("gravidade") == "bloqueante" and respostas.get(i["id"]) == "nao"]
    return (round(100.0 * aprovados / avaliados, 2) if avaliados else 100.0), bool(bloq), (bloq[0] if bloq else None)


def _lado(seg: dict, i: int, falantes: str | None, transferida_s) -> str | None:
    if seg.get("locutor"):
        return "cliente" if falante_de(seg["locutor"], seg["inicio"], transferida_s) == "cliente" else "empresa"
    if falantes:
        return "cliente" if falantes[i] == "C" else "empresa"
    return None


def metricas_audio(segs: list[dict], falantes: str | None, duracao_s: float, transferida_s=None) -> dict:
    """Fala da empresa e do cliente, silêncio (duração − tempo com alguém falando) e interrupções (fala que começa
    antes de o outro lado terminar, com folga de 0,2 s). Sem saber quem fala, a fala não é dividida."""
    empresa = cliente = 0.0
    inter = 0
    anterior = None
    for i, s in enumerate(segs):
        lado = _lado(s, i, falantes, transferida_s)
        d = max(0.0, s["fim"] - s["inicio"])
        if lado == "empresa":
            empresa += d
        elif lado == "cliente":
            cliente += d
        if lado and anterior and lado != anterior[0] and s["inicio"] < anterior[1] - 0.2:
            inter += 1
        if lado:
            anterior = (lado, s["fim"])
    falado, fim_ate = 0.0, None
    for s in segs:                                      # união dos intervalos com fala
        ini = s["inicio"] if fim_ate is None else max(s["inicio"], fim_ate)
        if s["fim"] > ini:
            falado += s["fim"] - ini
        fim_ate = s["fim"] if fim_ate is None else max(fim_ate, s["fim"])
    total = max(float(duracao_s or 0), fim_ate or 0.0)
    return {"fala_agente_s": int(round(empresa)), "fala_cliente_s": int(round(cliente)),
            "silencio_s": int(round(max(0.0, total - falado))), "interrupcoes": inter}


# ------------------------------------------------------------------ o que vai para gravar_analise_voz
def _trecho(segs: list[dict], i) -> str | None:
    if i is None or not 0 <= i < len(segs):
        return None
    return RED.redigir_trecho(segs[i]["texto"])[:600] or None


def _falante(f: str, seg: dict | None, ctx: Contexto) -> str:
    if f == "cliente":
        return "cliente"
    if ctx.origem == "discador" or (ctx.transferida_s is not None and seg and seg["inicio"] >= ctx.transferida_s):
        return "operador"
    return "agente"


def _rotulo_modelo(ctx: Contexto) -> str:
    return re.sub(r"[^A-Za-z0-9_.:\-]", "-", f"{VERSAO}:{ctx.modelo}" if ctx.modelo else VERSAO)[:60]


def montar(ctx: Contexto, segs: list[dict], res: Resultado, duracao_s: float, oferta: str | None = None) -> dict:
    """O argumento `analise` de gravar_analise_voz. Só códigos, números e trechos mascarados. `oferta`: o código da
    primeira oferta do fluxo (transcrição da ligação da IA, SQL 63), nunca do LLM."""
    base = {"empresa_id": ctx.empresa_id, "gravacao_id": ctx.gravacao_id, "versao": _rotulo_modelo(ctx),
            "minutos": round(max(0.0, float(duracao_s or 0)) / 60.0, 2),
            "uso": {"chamadas_llm": res.chamadas_llm, "tokens_entrada": res.tokens_entrada, "tokens_saida": res.tokens_saida}}
    a = res.analise
    if a is None:
        return {**base, "situacao": "falhou"}
    seg = lambda i: segs[i] if i is not None and 0 <= i < len(segs) else None   # noqa: E731
    # códigos fechados
    cod: dict = {}
    if a["motivo"] and a["motivo"]["probabilidades"]:
        topo, p = max(a["motivo"]["probabilidades"].items(), key=lambda kv: kv[1])
        if p >= LIMIAR_CODIGO:
            cod["motivo"] = topo
    if a["objecoes"]:
        cod["objecoes"] = a["objecoes"]
    if a["intencao"]:
        cod["intencao"] = a["intencao"]["codigo"]
    for campo in ("canal_preferido", "horario_preferido"):
        if a[campo]:
            cod[campo] = a[campo]
    riscos = list(dict.fromkeys(r["tipo"] for r in a["riscos"]))
    if riscos:
        cod["riscos"] = riscos
    if a["frases"]:
        cod["frases"] = a["frases"]
    if a["temas"]:
        cod["temas"] = a["temas"]
    if ctx.origem == "ia" and isinstance(oferta, str) and CAT.OFERTA.match(oferta):
        cod["oferta"] = oferta
    # avaliação
    respostas = {k: v["resposta"] for k, v in a["itens"].items()}
    aval = None
    if ctx.versao_id and ctx.itens:
        n, reprovada, item_rep = nota(ctx.itens, respostas)
        evid = {k: [seg(v["segmento"])["inicio"], seg(v["segmento"])["fim"]] for k, v in a["itens"].items()
                if seg(v["segmento"]) is not None}
        aval = {"versao_id": ctx.versao_id, "nota": n, "itens": respostas, "evidencia": evid, "reprovada": reprovada,
                "item_reprovado": item_rep, "modelo": _rotulo_modelo(ctx),
                "trecho_redigido": _trecho(segs, a["itens"][item_rep]["segmento"]) if item_rep else None}
    # alertas: vulnerabilidade só com o sinal; os riscos de alerta com o trecho mascarado
    alertas, vistos = [], set()
    for v in a["vulnerabilidade"]:
        if v["sinal"] in vistos:
            continue
        vistos.add(v["sinal"])
        s = seg(v["segmento"])
        alertas.append({"tipo": "vulnerabilidade", "sinal": v["sinal"], "falante": "cliente",
                        "inicio_s": s["inicio"] if s else None})
    for r in a["riscos"]:
        if r["tipo"] not in CAT.RISCOS_ALERTA or r["tipo"] in vistos:
            continue
        vistos.add(r["tipo"])
        s = seg(r["segmento"])
        alertas.append({"tipo": r["tipo"], "falante": _falante(r["falante"], s, ctx), "inicio_s": s["inicio"] if s else None,
                        "trecho": _trecho(segs, r["segmento"])})
    # curadoria: as regras do SQL 60 (curadoria.py) e o item do checklist com pouca confiança
    pedido: dict = {"intencoes": [], "probabilidades": {}, "baixa_confianca_pct": a["transcricao_ruim"]}
    if a["intencao"]:
        i = a["intencao"]
        pedido["intencoes"].append({"intencao": i["codigo"], "confianca": i["confianca"],
                                    "trecho": (seg(i["segmento"]) or {}).get("texto"),
                                    "alternativas": [i["codigo"], *i["alternativas"]]})
    for campo, chave in (("motivo", "motivo"), ("objecao", "objecao_principal")):
        pr = a[chave]
        if pr and pr["probabilidades"] and max(pr["probabilidades"].values()) >= LIMIAR_DUVIDA:
            pedido["probabilidades"][campo] = pr["probabilidades"]
            pedido["trecho_" + campo] = (seg(pr["segmento"]) or {}).get("texto")
    cur = [{k: x[k] for k in ("tipo", "trecho_redigido", "decisao_ia", "opcoes", "confianca")}
           for x in CU.itens_da_chamada({"empresa_id": ctx.empresa_id, "chamada_id": ctx.chamada_id,
                                         "gravacao_id": ctx.gravacao_id}, pedido)]
    if aval:
        duvida = sorted(((v["confianca"], k) for k, v in a["itens"].items() if v["confianca"] < LIMIAR_NOTA))
        if duvida:
            conf, k = duvida[0]
            cur.append({"tipo": "nota", "trecho_redigido": _trecho(segs, a["itens"][k]["segmento"]),
                        "decisao_ia": {"item": k, "valor": respostas[k], "baixa_confianca": True},
                        "opcoes": list(CAT.RESPOSTAS), "confianca": conf})
    return {**base, "situacao": "ok", "codigos": cod,
            "audio": metricas_audio(segs, a["falantes"], duracao_s, ctx.transferida_s),
            "sentimento": {"ini": a["sentimento"][0], "fim": a["sentimento"][1]} if a["sentimento"] else None,
            "avaliacao": aval, "alertas": alertas[:10], "curadoria": cur[:20]}


def processar(sb, modelo, ctx: Contexto, transcricao: dict, saida: dict | None = None) -> dict:
    """Analisa uma gravação e grava (gravar_analise_voz: tudo numa transação, inclusive o uso de IA). `saida` (opcional)
    recebe os segmentos mascarados e quem fala em cada um (para os trechos da busca e dos temas, SQL 63)."""
    segs = preparar_segmentos(transcricao)
    if not segs:
        return {"situacao": "sem_texto"}
    duracao = float(transcricao.get("duracao_s") or ctx.duracao_s or segs[-1]["fim"])
    res = analisar(modelo, ctx, segs)
    if saida is not None:
        saida["segmentos"] = segs
        saida["falantes"] = (res.analise or {}).get("falantes")
    if res.analise is None and res.chamadas_llm == 0:
        return {"situacao": "llm_indisponivel"}           # nada gasto: tenta na próxima rodada
    return sb.rpc("gravar_analise_voz", {"analise": montar(ctx, segs, res, duracao, transcricao.get("oferta"))}) or {}
