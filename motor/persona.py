"""Personas: o motor aprende, com o histórico de ocorrências, qual canal funciona para quem.

Fluxo (refeito a cada rotina com os eventos até ontem):
1. Tentativas: cada (cliente, canal, dia) acionado vira uma tentativa; sucesso = contato
   (CPC) naquele canal, pela régua (`regua.e_contato`).
2. Características do cliente: as colunas da carga (`atributos`) e campos derivados —
   faixa de saldo, faixa de atraso, DDD, tem WhatsApp, tem RCS. Colunas numéricas viram
   faixas (tercis). Nada de dado sensível: só o que a carga e o enriquecimento trazem.
3. Seleção automática: o motor testa todas as características e fica com as (até) 2 que
   mais mudam a taxa de CPC por canal (qui-quadrado por grau de liberdade, com volume
   mínimo). Persona = combinação dos valores dessas características.
4. Taxa por persona e canal com encolhimento (Beta): persona → valor da 1ª característica
   → carteira. Pouco volume puxa para a média; não aprende com acaso.
5. Ranking por CPC por real gasto (taxa ÷ custo do canal), só entre os canais em que o
   cliente tem contato. 10% dos clientes exploram outro canal a cada dia.

A esteira usa o ranking pelas etiquetas `persona_1` (melhor canal da persona) e
`persona_2` (segundo melhor). Mudanças de régua viram sugestões (ver `sugerir`), que só
entram na orquestração depois de aprovadas.
"""
import hashlib
from collections import defaultdict
from dataclasses import dataclass, field

CANAIS = ("whatsapp", "rcs", "agente_voz", "discador", "sms", "email")
TOKENS = {"persona_1": 0, "persona_2": 1}
NOME_TOKEN = {"persona_1": "melhor canal da persona", "persona_2": "2º melhor canal da persona"}
CUSTO_PADRAO = {"whatsapp": 0.30, "rcs": 0.15, "sms": 0.08, "email": 0.01, "agente_voz": 0.50, "discador": 1.20}
FORCA = 50.0          # peso do prior no encolhimento (equivale a 50 tentativas)
MIN_GRUPO = 30        # tentativas mínimas num valor para a característica contar
MAX_VALORES = 30      # coluna com mais valores distintos que isso não vira característica
EXPLORACAO = 0.10
MIN_SUGESTAO = 200    # tentativas por canal na persona para sugerir mudança de régua
GANHO_SUGESTAO = 1.2  # o canal sugerido precisa render 20% mais CPC por real


def faixa_saldo(v: float) -> str:
    return "até 500" if v < 500 else "500 a 2 mil" if v < 2000 else "2 a 5 mil" if v < 5000 else "acima de 5 mil"


def faixa_atraso(d: int) -> str:
    return "até 90" if d <= 90 else "91 a 180" if d <= 180 else "181 a 360" if d <= 360 else "acima de 360"


def _num(v):
    s = str(v or "").replace("R$", "").replace(" ", "").strip()
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def caracteristicas(clientes: dict, dia, contatos_por: dict[str, list[dict]] | None = None) -> dict[str, dict[str, str]]:
    """{id_cliente: {característica: valor}} — colunas da carga + derivadas."""
    contatos_por = contatos_por or {}
    saida = {}
    for idc, c in clientes.items():
        f = {"faixa_saldo": faixa_saldo(c.saldo), "faixa_atraso": faixa_atraso(c.atraso_em(dia))}
        tels = [x for x in contatos_por.get(idc, []) if x.get("tipo") == "telefone"]
        if tels:
            f["ddd"] = tels[0]["contato"][:2]
            f["tem_whatsapp"] = "sim" if any(x.get("whatsapp_valido") for x in tels) else "não"
            f["tem_rcs"] = "sim" if any(x.get("rcs") for x in tels) else "não"
        for k, v in (c.atributos or {}).items():
            if (v or "").strip():
                f[k] = str(v).strip()
        saida[idc] = f
    return saida


def _faixas_numericas(feats: dict[str, dict[str, str]]):
    """Colunas numéricas da carga viram 3 faixas (tercis). Muda feats no lugar."""
    colunas = {k for f in feats.values() for k in f}
    for col in colunas:
        vals = [_num(f[col]) for f in feats.values() if col in f]
        if not vals or any(v is None for v in vals) or len(set(vals)) <= MAX_VALORES:
            continue
        ordenados = sorted(vals)
        c1, c2 = ordenados[len(ordenados) // 3], ordenados[2 * len(ordenados) // 3]
        for f in feats.values():
            if col in f:
                v = _num(f[col])
                f[col] = f"até {c1:g}" if v <= c1 else f"{c1:g} a {c2:g}" if v <= c2 else f"acima de {c2:g}"


def tentativas(eventos, regua) -> list[tuple[str, str, bool]]:
    """[(id_cliente, canal, deu_cpc)], uma por cliente × canal × dia."""
    por = {}
    for e in eventos:
        if e.canal not in CANAIS:
            continue
        k = (e.id_cliente, e.canal, e.data)
        por[k] = por.get(k, False) or regua.e_contato(e.canal, e.resultado)
    return [(i, c, s) for (i, c, _), s in por.items()]


def _qui2(tent, feats, col) -> tuple[float, int]:
    """Qui-quadrado por grau de liberdade de (valor × CPC) somado nos canais."""
    total, gl = 0.0, 0
    for canal in CANAIS:
        grupos = defaultdict(lambda: [0, 0])
        for i, c, s in tent:
            if c == canal and col in feats.get(i, {}):
                g = grupos[feats[i][col]]
                g[0] += s
                g[1] += 1
        grupos = {v: g for v, g in grupos.items() if g[1] >= MIN_GRUPO}
        if len(grupos) < 2:
            continue
        n = sum(g[1] for g in grupos.values())
        p = sum(g[0] for g in grupos.values()) / n
        if p <= 0 or p >= 1:
            continue
        total += sum((g[0] - g[1] * p) ** 2 / (g[1] * p * (1 - p)) for g in grupos.values())
        gl += len(grupos) - 1
    return (total / gl if gl else 0.0), gl


@dataclass
class ModeloPersona:
    colunas: list[str] = field(default_factory=list)           # características escolhidas
    taxa: dict = field(default_factory=dict)                   # (persona, canal) -> taxa encolhida
    volume: dict = field(default_factory=dict)                 # (persona, canal) -> [cpcs, tentativas]
    custo: dict = field(default_factory=dict)                  # canal -> custo por tentativa
    global_: dict = field(default_factory=dict)                # canal -> taxa da carteira
    vol_global: dict = field(default_factory=dict)             # canal -> tentativas na carteira
    feats: dict = field(default_factory=dict)                  # id_cliente -> características
    nivel1: dict = field(default_factory=dict)                 # (valor da 1ª, canal) -> taxa

    def persona(self, idc: str) -> tuple:
        f = self.feats.get(idc, {})
        return tuple(f.get(c, "?") for c in self.colunas)

    def nome(self, persona: tuple) -> str:
        if not self.colunas:
            return "Carteira toda"
        return " · ".join(f"{c} {v}" for c, v in zip(self.colunas, persona))

    def taxa_de(self, persona: tuple, canal: str) -> float:
        if (persona, canal) in self.taxa:
            return self.taxa[(persona, canal)]
        if self.colunas and (persona[:1], canal) in self.nivel1:
            return self.nivel1[(persona[:1], canal)]
        return self.global_.get(canal, 0.0)

    def ranking(self, idc: str, disponiveis=None) -> list[str]:
        """Canais em ordem de CPC por real gasto para a persona do cliente."""
        p = self.persona(idc)
        canais = [c for c in CANAIS if disponiveis is None or c in disponiveis]
        # canal sem histórico suficiente vai depois dos que têm evidência (a exploração testa ele)
        return sorted(canais, key=lambda c: (self.vol_global.get(c, 0) < MIN_GRUPO,
                                             -self.taxa_de(p, c) / max(self.custo.get(c, 1.0), 0.001)))


def aprender(eventos, clientes, regua, dia, contatos_por=None, custos: dict | None = None) -> ModeloPersona:
    """Modelo de personas a partir dos eventos até ontem."""
    feats = caracteristicas(clientes, dia, contatos_por)
    _faixas_numericas(feats)
    tent = tentativas(eventos, regua)
    m = ModeloPersona(feats=feats)
    # custo por tentativa: o da empresa (página Canais), senão o médio dos eventos, senão o padrão
    soma, qtd = defaultdict(float), defaultdict(int)
    for e in eventos:
        if e.custo:
            soma[e.canal] += e.custo
            qtd[e.canal] += 1
    for c in CANAIS:
        m.custo[c] = float((custos or {}).get(c) or (soma[c] / qtd[c] if qtd[c] else CUSTO_PADRAO[c]))
    g = defaultdict(lambda: [0, 0])
    for i, c, s in tent:
        g[c][0] += s
        g[c][1] += 1
    m.global_ = {c: (g[c][0] + 1) / (g[c][1] + 20) for c in CANAIS}  # prior fraco: ~5%
    m.vol_global = {c: g[c][1] for c in CANAIS}
    # seleção das características
    colunas = sorted({k for f in feats.values() for k in f if len({x.get(k) for x in feats.values()}) <= MAX_VALORES})
    pontos = sorted(((_qui2(tent, feats, col), col) for col in colunas), key=lambda x: -x[0][0])
    m.colunas = [col for (q, gl), col in pontos if gl and q >= 4.0][:2]
    if not m.colunas:
        return m
    n1 = defaultdict(lambda: [0, 0])
    np_ = defaultdict(lambda: [0, 0])
    for i, c, s in tent:
        p = m.persona(i)
        n1[(p[:1], c)][0] += s
        n1[(p[:1], c)][1] += 1
        np_[(p, c)][0] += s
        np_[(p, c)][1] += 1
    for (v1, c), (s, n) in n1.items():
        m.nivel1[(v1, c)] = (s + FORCA * m.global_[c]) / (n + FORCA)
    for (p, c), (s, n) in np_.items():
        base = m.nivel1.get((p[:1], c), m.global_[c])
        m.taxa[(p, c)] = (s + FORCA * base) / (n + FORCA)
        m.volume[(p, c)] = [s, n]
    return m


def explorar(idc: str, dia) -> bool:
    """Sorteio estável por cliente e dia: ~10% dos clientes testam outro canal."""
    h = int(hashlib.sha256(f"{idc}|{dia.isoformat()}".encode()).hexdigest()[:8], 16)
    return h / 0xFFFFFFFF < EXPLORACAO


def resolver_tokens(acoes: list[dict], modelo: ModeloPersona | None, idc: str, dia, disponiveis) -> tuple[list[dict], str]:
    """Troca persona_1/persona_2 pelo canal do ranking do cliente. Devolve (ações, rótulo)."""
    if not any(a["canal"] in TOKENS for a in acoes):
        return acoes, ""
    if modelo is None:
        modelo = ModeloPersona(custo=dict(CUSTO_PADRAO))
    rank = modelo.ranking(idc, disponiveis)
    rotulo = modelo.nome(modelo.persona(idc))
    if rank and explorar(idc, dia) and len(rank) > 1:
        rank = rank[1:] + rank[:1]   # exploração: começa pelo 2º, o 1º vai para o fim
        rotulo += " · exploração"
    fixos = {a["canal"] for a in acoes if a["canal"] not in TOKENS}
    livres = [c for c in rank if c not in fixos]       # ranking sem os canais já fixos no passo
    saida, usados = [], set(fixos)
    for a in acoes:
        if a["canal"] not in TOKENS:
            saida.append(a)
            continue
        candidatos = livres[TOKENS[a["canal"]]:] + livres[:TOKENS[a["canal"]]]
        canal = next((c for c in candidatos if c not in usados), None)
        if canal:
            usados.add(canal)
            saida.append({**a, "canal": canal})
    return saida, rotulo


def resumo(modelo: ModeloPersona, clientes_ativos: set[str] | None = None) -> list[dict]:
    """Uma linha por persona: clientes, ranking com taxa, volume e custo por CPC."""
    contagem = defaultdict(int)
    for idc in modelo.feats:
        if clientes_ativos is None or idc in clientes_ativos:
            contagem[modelo.persona(idc)] += 1
    linhas = []
    for p, n in sorted(contagem.items(), key=lambda x: -x[1]):
        ranking = []
        for c in modelo.ranking(next(i for i in modelo.feats if modelo.persona(i) == p)):
            t = modelo.taxa_de(p, c)
            s, v = modelo.volume.get((p, c), [0, 0])
            ranking.append({"canal": c, "taxa_cpc": round(t, 4), "tentativas": v, "cpcs": s,
                            "custo_por_cpc": round(modelo.custo[c] / t, 2) if t > 0 else None})
        linhas.append({"persona": "|".join(p), "nome": modelo.nome(p), "clientes": n,
                       "condicoes": [{"campo": c, "valor": v} for c, v in zip(modelo.colunas, p)],
                       "ranking": ranking})
    return linhas


def sugerir(modelo: ModeloPersona, estrategia_de, clientes_ativos=None) -> list[dict]:
    """Sugestões de régua: na persona, o 1º canal do Cliente novo rende bem menos CPC por real
    que outro canal com volume suficiente. estrategia_de(idc) -> (nome, dia, canal) do 1º passo."""
    if not modelo.colunas:
        return []
    por_persona = defaultdict(list)
    for idc in modelo.feats:
        if clientes_ativos is None or idc in clientes_ativos:
            por_persona[modelo.persona(idc)].append(idc)
    saida = []
    for p, ids in por_persona.items():
        atual = defaultdict(int)
        for idc in ids:
            atual[estrategia_de(idc)] += 1
        (estrategia, dia, de), _ = max(atual.items(), key=lambda x: x[1])
        if de not in CANAIS:
            continue
        cpr = {c: modelo.taxa_de(p, c) / modelo.custo[c] for c in CANAIS}
        para = max((c for c in CANAIS if modelo.volume.get((p, c), [0, 0])[1] >= MIN_SUGESTAO), key=lambda c: cpr[c],
                   default=None)
        if not para or para == de or modelo.volume.get((p, de), [0, 0])[1] < MIN_SUGESTAO:
            continue
        if cpr[para] < GANHO_SUGESTAO * cpr[de]:
            continue
        mensal = len(ids) * (modelo.taxa_de(p, para) - modelo.taxa_de(p, de))
        saida.append({
            "persona": "|".join(p), "nome": modelo.nome(p), "clientes": len(ids),
            "condicoes": [{"campo": c, "valor": v} for c, v in zip(modelo.colunas, p)],
            "estrategia_base": estrategia, "fase": "localizacao", "dia": dia, "de": de, "para": para,
            "evidencia": {c: {"taxa_cpc": round(modelo.taxa_de(p, c), 4),
                              "tentativas": modelo.volume.get((p, c), [0, 0])[1],
                              "custo_por_cpc": round(modelo.custo[c] / modelo.taxa_de(p, c), 2)}
                          for c in (de, para)},
            "ganho_cpc_por_rodada": round(mensal, 1),
            "texto": f"{modelo.nome(p)}: trocar o D+{dia} de {de} para {para} — "
                     f"{cpr[para] / cpr[de]:.1f}× mais CPC por real gasto",
        })
    return sorted(saida, key=lambda s: -s["ganho_cpc_por_rodada"])


def condicoes_cluster(condicoes: list[dict]) -> list[dict]:
    """Condições da persona no formato das regras de cluster (motor/cluster.py)."""
    saida = []
    for c in condicoes:
        campo, v = c["campo"], c["valor"]
        if campo == "faixa_saldo":
            lim = {"até 500": (None, 500), "500 a 2 mil": (500, 2000), "2 a 5 mil": (2000, 5000),
                   "acima de 5 mil": (5000, None)}[v]
            if lim[0] is not None:
                saida.append({"campo": "saldo", "op": ">=", "valor": lim[0]})
            if lim[1] is not None:
                saida.append({"campo": "saldo", "op": "<", "valor": lim[1]})
        elif campo == "faixa_atraso":
            lim = {"até 90": (None, 90), "91 a 180": (91, 180), "181 a 360": (181, 360), "acima de 360": (361, None)}[v]
            if lim[0] is not None:
                saida.append({"campo": "dias_atraso", "op": ">=", "valor": lim[0]})
            if lim[1] is not None:
                saida.append({"campo": "dias_atraso", "op": "<=", "valor": lim[1]})
        elif _faixa(v):
            lo, hi = _faixa(v)
            if lo is not None:
                saida.append({"campo": campo, "op": ">", "valor": lo})
            if hi is not None:
                saida.append({"campo": campo, "op": "<=", "valor": hi})
        else:
            saida.append({"campo": campo, "op": "=", "valor": v})
    return saida


def _faixa(v: str):
    """'até X' / 'X a Y' / 'acima de Y' (faixas numéricas criadas pelo motor) -> (>lo, <=hi)."""
    import re
    m = re.fullmatch(r"até (-?[\d.]+)", v) or re.fullmatch(r"(-?[\d.]+) a (-?[\d.]+)", v) \
        or re.fullmatch(r"acima de (-?[\d.]+)", v)
    if not m:
        return None
    if v.startswith("até"):
        return None, float(m.group(1))
    if v.startswith("acima"):
        return float(m.group(1)), None
    return float(m.group(1)), float(m.group(2))
