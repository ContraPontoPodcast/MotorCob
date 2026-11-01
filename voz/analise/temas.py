"""Temas novos do Speech Analytics (SQL 60, decisão 7; SQL 63): clusterização semanal na VM.

Toda segunda (motorcx-voz-speech-temas.timer), para cada empresa com o Speech Analytics ligado desta VM (parte i/n):
  1. trechos_para_temas_voz: os trechos mascarados do CLIENTE da semana anterior, de ligações analisadas que ficaram
     sem tema e sem intenção (ou com a intenção em dúvida na Curadoria), e uma amostra de cada tema que já existe;
  2. agrupa: com pgvector, pelos embeddings da busca semântica (o mesmo modelo de voz/analise/trechos.py,
     Vertex em São Paulo, 1536 dimensões; o trecho sem vetor ganha o dele aqui, com o custo registrado); sem pgvector, por palavras (TF-IDF);
     o agrupamento é guloso pelo centro mais parecido, com uma passada de reatribuição (determinístico);
  3. grupo parecido com um tema que já existe entra nele (propor_tema_voz com tema_id; descartado continua
     descartado, sem item novo);
  4. grupo com 30 conversas ou mais vira tema 'novo' com um item 'tema' na Curadoria e um nome SUGERIDO pelo LLM da
     Montagem (ferramenta sugerir_tema, só letras, 3 a 60 caracteres; resposta fora disso é recusada e pedida de novo,
     até 2 vezes; sem nome válido, o item vai sem sugestão). Quem dá o nome e promove é a pessoa com curadoria_voz.
     Grupo com menos de 30 nunca aparece (o banco também recusa).
Uso de IA: o nome sugerido (componente temas) e os embeddings calculados aqui (componente embeddings) entram pelo
registrar_uso_ia_voz com os tokens reais (custo real só para a margem; nada é cobrado a mais).
"""
from __future__ import annotations

import logging
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta

log = logging.getLogger("motorcx.voz.speech")
MIN_CONVERSAS = 30
LIMIAR_VETOR = 0.82            # cosseno para entrar num grupo (embeddings)
LIMIAR_VETOR_TEMA = 0.85       # cosseno para entrar num tema que já existe
LIMIAR_PALAVRAS = 0.35         # cosseno TF-IDF (sem pgvector)
LIMIAR_PALAVRAS_TEMA = 0.45
MAX_EXEMPLOS = 8
MAX_TENTATIVAS = 2
FERRAMENTA = "sugerir_tema"
ROTULO = re.compile(r"^[^\W\d_][^\W\d_ ,/\-]*(?:[ ,/\-]+[^\W\d_]+)*$")
MARCAS = re.compile(r"\[[A-ZÁÉÍÓÚÂÊÔÃÕÇ\- ]+\]")
STOP = set("""a o e é de do da dos das que em no na nos nas um uma uns umas para pra por com sem se eu tu ele ela nós
vocês voces você voce eles elas me te lhe meu minha meus minhas seu sua seus suas isso isto aquilo esse essa este esta
mas ou já ja não nao sim tá ta né ne aí ai lá la aqui ali então entao porque pq como quando onde muito mais menos bem
foi ser ter tem tenho tava estava estou está esta vou vai vamos pode posso fazer faz ok certo tudo nada alguém alguem
ah eh hum uhum oi olá ola alô alo senhor senhora sr sra dona obrigado obrigada tchau gente pois só so ainda agora hoje
""".split())


def semana_anterior(hoje: date) -> date:
    """A segunda-feira da semana passada (a semana fechada mais recente)."""
    return hoje - timedelta(days=hoje.weekday() + 7)


# ------------------------------------------------------------------ representação
def _normal(t: str) -> str:
    t = unicodedata.normalize("NFKD", MARCAS.sub(" ", t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def palavras(texto: str) -> list[str]:
    return [w for w in re.findall(r"[a-z]{3,}", _normal(texto)) if w not in STOP]


def vetor_texto(s) -> list[float] | None:
    """'[0.1,0.2,...]' (pgvector como texto) -> lista; None se não houver."""
    if not s:
        return None
    try:
        v = [float(x) for x in str(s).strip("[] ").split(",") if x.strip()]
    except ValueError:
        return None
    return v or None


def _norm_denso(v: list[float]) -> list[float] | None:
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n > 0 else None


def _norm_esparso(d: dict) -> dict | None:
    n = math.sqrt(sum(x * x for x in d.values()))
    return {k: x / n for k, x in d.items()} if n > 0 else None


def _cos(a, b) -> float:
    if isinstance(a, dict):
        if len(a) > len(b):
            a, b = b, a
        return sum(x * b.get(k, 0.0) for k, x in a.items())
    return sum(x * y for x, y in zip(a, b))


def _somar(acc, v):
    if isinstance(v, dict):
        acc = dict(acc or {})
        for k, x in v.items():
            acc[k] = acc.get(k, 0.0) + x
        return acc
    return [x + y for x, y in zip(acc, v)] if acc is not None else list(v)


def _centro(soma):
    return _norm_esparso(soma) if isinstance(soma, dict) else _norm_denso(soma)


class Lexico:
    """TF-IDF das palavras dos trechos da semana (sem pgvector)."""

    def __init__(self, textos: list[str]):
        self.n = max(1, len(textos))
        self.df: Counter = Counter()
        for t in textos:
            self.df.update(set(palavras(t)))

    def vetor(self, texto: str) -> dict | None:
        tf = Counter(palavras(texto))
        return _norm_esparso({w: c * math.log((1 + self.n) / (1 + self.df.get(w, 0)) + 1) for w, c in tf.items()})


# ------------------------------------------------------------------ agrupamento
@dataclass
class Grupo:
    tema_id: int | None = None
    trechos: list = field(default_factory=list)       # ids
    chamadas: set = field(default_factory=set)
    soma: object = None
    centro: object = None
    textos: list = field(default_factory=list)        # (similaridade ao centro, id, texto)

    def adicionar(self, tid: int, chamada: int, v, texto: str) -> None:
        self.trechos.append(tid)
        self.chamadas.add(chamada)
        self.soma = _somar(self.soma, v)
        self.centro = _centro(self.soma)
        self.textos.append((tid, texto, v))

    def exemplos(self, n: int = MAX_EXEMPLOS) -> list[tuple[int, str]]:
        ordem = sorted(self.textos, key=lambda x: (-_cos(x[2], self.centro), x[0]))
        return [(i, t) for i, t, _ in ordem[:n]]


def agrupar(itens: list[dict], temas: list[dict], vetorial: bool) -> tuple[list[Grupo], list[Grupo]]:
    """itens: [{id, chamada_id, texto, v}] (v: vetor normalizado, denso ou esparso). temas: [{id, centro}].
    Devolve (grupos que entram em temas existentes, grupos novos)."""
    lim, lim_tema = (LIMIAR_VETOR, LIMIAR_VETOR_TEMA) if vetorial else (LIMIAR_PALAVRAS, LIMIAR_PALAVRAS_TEMA)
    existentes = {t["id"]: Grupo(tema_id=t["id"], centro=t["centro"]) for t in temas if t.get("centro")}
    livres = []
    for it in sorted(itens, key=lambda x: x["id"]):
        melhor, sim = None, lim_tema
        for g in existentes.values():
            c = _cos(it["v"], g.centro)
            if c >= sim:
                melhor, sim = g, c
        if melhor is not None:
            melhor.trechos.append(it["id"])
            melhor.chamadas.add(it["chamada_id"])
        else:
            livres.append(it)
    # guloso pelo centro mais parecido
    grupos: list[Grupo] = []
    for it in livres:
        melhor, sim = None, lim
        for g in grupos:
            c = _cos(it["v"], g.centro)
            if c >= sim:
                melhor, sim = g, c
        if melhor is None:
            melhor = Grupo()
            grupos.append(melhor)
        melhor.adicionar(it["id"], it["chamada_id"], it["v"], it["texto"])
    # uma passada de reatribuição ao centro mais parecido (menos dependência da ordem)
    centros = [(g, g.centro) for g in grupos if len(g.trechos) > 1]
    if centros:
        novos = [Grupo() for _ in centros]
        sobras: list[Grupo] = []
        for it in livres:
            j, sim = max(((k, _cos(it["v"], c)) for k, (_, c) in enumerate(centros)), key=lambda x: x[1])
            if sim >= lim:
                novos[j].adicionar(it["id"], it["chamada_id"], it["v"], it["texto"])
            else:
                g = Grupo()
                g.adicionar(it["id"], it["chamada_id"], it["v"], it["texto"])
                sobras.append(g)
        grupos = [g for g in novos if g.trechos] + sobras
    return [g for g in existentes.values() if g.trechos], grupos


# ------------------------------------------------------------------ nome sugerido (LLM da Montagem)
def ferramenta() -> list[dict]:
    return [{"type": "function", "function": {
        "name": FERRAMENTA, "description": "Sugere um nome curto para o tema comum dos trechos.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["rotulo"], "properties": {
            "rotulo": {"type": "string", "minLength": 3, "maxLength": 60,
                       "description": "de 2 a 6 palavras, só letras, sem nomes de pessoas nem números"}}}}}]


def rotulo_valido(r) -> str | None:
    if not isinstance(r, str):
        return None
    r = re.sub(r"\s+", " ", r).strip().strip(".")
    if not 3 <= len(r) <= 60 or not ROTULO.match(r) or "@" in r or MARCAS.search(r):
        return None
    return r[:1].upper() + r[1:]


def sugerir_rotulo(modelo, exemplos: list[str]) -> tuple[str | None, int, int, int]:
    """(rótulo ou None, chamadas ao LLM, tokens de entrada, tokens de saída)."""
    txt = "\n".join(f"- {e[:300]}" for e in exemplos[:MAX_EXEMPLOS])
    msgs = [{"role": "system", "content": (
        "Você nomeia temas de ligações de cobrança para a curadoria do MotorCX, em português do Brasil. Os trechos "
        "abaixo são falas de clientes, já mascaradas. Dê um nome curto (2 a 6 palavras) para o assunto em comum, só "
        f"com letras, sem nomes de pessoas, empresas, números ou dados pessoais. Responda só com a ferramenta {FERRAMENTA}.")},
        {"role": "user", "content": f"Trechos:\n{txt}"}]
    n = te = ts = 0
    for _ in range(MAX_TENTATIVAS):
        try:
            r = modelo.responder(msgs, ferramenta())
        except Exception as ex:   # noqa: BLE001 — sem LLM: o tema vai sem sugestão (a pessoa dá o nome)
            log.warning("temas: LLM indisponível (%s)", ex.__class__.__name__)
            break
        n += 1
        e, s = int(getattr(r, "tokens_entrada", 0) or 0), int(getattr(r, "tokens_saida", 0) or 0)
        if e + s == 0:
            s = int(getattr(r, "tokens", 0) or 0)
        te, ts = te + e, ts + s
        args = next((a for nome, a in r.chamadas if nome == FERRAMENTA), None)
        rot = rotulo_valido((args or {}).get("rotulo"))
        if rot:
            return rot, n, te, ts
        msgs.append({"role": "user", "content": "Nome recusado: use de 2 a 6 palavras, só letras, sem números nem "
                                                f"nomes. Responda pela ferramenta {FERRAMENTA}."})
    return None, n, te, ts


# ------------------------------------------------------------------ o job
def _tokens_estimados(textos: list[str]) -> int:
    return sum(len(t) for t in textos) // 4 + len(textos)


def temas_da_empresa(sb, empresa: int, semana: date, modelo=None, embedder=None, hoje: date | None = None) -> dict:
    out: Counter = Counter()
    d = sb.rpc("trechos_para_temas_voz", {"empresa": empresa, "semana": semana.isoformat()}) or {}
    if not d.get("ligado"):
        return {"desligada": 1}
    brutos = [t for t in d.get("trechos") or [] if isinstance(t, dict) and t.get("id") and (t.get("texto") or "").strip()]
    out["trechos"] = len(brutos)
    if not brutos:
        return dict(out)
    vetorial = bool(d.get("vetor"))
    tok_emb = 0
    if vetorial:
        sem = [t for t in brutos if not vetor_texto(t.get("emb"))]
        if sem and embedder is not None:
            try:
                antes = int(getattr(embedder, "tokens_entrada", 0) or 0)
                for t, v in zip(sem, embedder.vetores([t["texto"] for t in sem])):
                    t["emb"] = v
                tok_emb = int(getattr(embedder, "tokens_entrada", 0) or 0) - antes or _tokens_estimados(
                    [t["texto"] for t in sem])
                out["embeddings"] = len(sem)
            except Exception as ex:   # noqa: BLE001 — Vertex fora: agrupa por palavras desta vez
                log.warning("temas: embeddings indisponíveis (%s)", ex.__class__.__name__)
                vetorial = False
        elif sem:
            vetorial = False                       # sem como calcular os que faltam: por palavras, igual para todos
    lex = None if vetorial else Lexico([t["texto"] for t in brutos]
                                         + [x.get("texto") or "" for tm in d.get("temas") or [] for x in tm.get("trechos") or []])

    def rep(t):
        if vetorial:
            v = t["emb"] if isinstance(t["emb"], list) else vetor_texto(t["emb"])
            return _norm_denso(v) if v else None
        return lex.vetor(t.get("texto") or "")

    itens = [{"id": int(t["id"]), "chamada_id": int(t["chamada_id"]), "texto": t["texto"], "v": rep(t)} for t in brutos]
    itens = [i for i in itens if i["v"]]
    temas = []
    for tm in d.get("temas") or []:
        soma = None
        for x in tm.get("trechos") or []:
            v = rep(x) if (not vetorial or vetor_texto(x.get("emb"))) else None
            if v:
                soma = _somar(soma, v)
        if soma is not None:
            temas.append({"id": int(tm["id"]), "centro": _centro(soma)})
    existentes, novos = agrupar(itens, temas, vetorial)
    for g in existentes:
        sb.rpc("propor_tema_voz", {"empresa": empresa, "semana": semana.isoformat(),
                                   "tema": {"tema_id": g.tema_id, "trechos": g.trechos}})
        out["em_temas_existentes"] += len(g.trechos)
    llm = [0, 0, 0]
    for g in sorted(novos, key=lambda g: -len(g.chamadas)):
        if len(g.chamadas) < MIN_CONVERSAS:
            out["grupos_pequenos"] += 1            # nunca aparece
            continue
        ex = g.exemplos()
        rot = None
        if modelo is not None:
            rot, n, te, ts = sugerir_rotulo(modelo, [t for _, t in ex])
            llm = [llm[0] + n, llm[1] + te, llm[2] + ts]
        tema = {"trechos": g.trechos[:5000], "exemplo": ex[0][0]}
        if rot:
            tema["sugestao"] = rot
        r = sb.rpc("propor_tema_voz", {"empresa": empresa, "semana": semana.isoformat(), "tema": tema}) or {}
        out["temas_novos"] += int(bool(r.get("novo")))
    dia = (hoje or date.today()).isoformat()
    if llm[0]:
        sb.rpc("registrar_uso_ia_voz", {"empresa": empresa, "dia": dia, "componente": "temas", "chamadas": llm[0],
                                        "minutos": 0, "minutos_cobraveis": 0, "tokens_entrada": llm[1],
                                        "tokens_saida": llm[2]})
    if out.get("embeddings"):
        sb.rpc("registrar_uso_ia_voz", {"empresa": empresa, "dia": dia, "componente": "embeddings",
                                        "chamadas": out["embeddings"], "minutos": 0, "minutos_cobraveis": 0,
                                        "tokens_entrada": tok_emb, "tokens_saida": 0})
    out["vetorial"] = int(vetorial)
    return dict(out)


def rodar(sb, hoje: date, parte: str = "1/1", modelo=None, embedder=None) -> dict:
    semana = semana_anterior(hoje)
    total: Counter = Counter()
    empresas = sb.rpc("speech_empresas_voz", {"parte": parte}) or []
    total["empresas"] = len(empresas)
    for e in empresas:
        try:
            for k, v in temas_da_empresa(sb, int(e), semana, modelo, embedder, hoje).items():
                total[k] += v
        except Exception as ex:   # noqa: BLE001 — uma empresa não segura as outras
            log.warning("temas: empresa %s falhou (%s)", e, ex.__class__.__name__)
            total["erros"] += 1
    return dict(total)
