"""KPIs do playbook por safra e cluster, migração de estados, benchmarks e realizado por ação.

Tudo sai da trilha (onde cada cliente estava em cada dia), dos eventos (tentativas,
contatos e custo) e das parcelas (acordos e pagamentos). Cada tentativa é atribuída
à régua em que o cliente estava no dia; cada acordo, à régua e ao canal do contato
que o originou. É isso que torna o Real x Previsto comparável por ação.

Frentes (slide "O que medir"):
1 Localização  — % base qualificada · % localização por canal · custo por CPC descoberto
2 Fomento CPC  — Não CPC → CPC A · CPC B recuperados · tentativas até o contato
3 Conversão    — % acordo sobre CPC (voz) · % acordo sobre retorno (digital) · custo por acordo
4 Preventivo   — % parcelas pagas em dia · % acordos quitados até o fim
5 Quebra       — % regularização até D+5 · % que retorna ao estoque
"""
from bisect import bisect_left
from collections import Counter, defaultdict
from datetime import date, timedelta

from .acordos import Parcela
from .certificacao import Certificacao, Evento
from .marcacao import Cliente, EstadoCliente
from .regua import CANAIS_VOZ, Regua

REGUA_DO_ESTADO = {"LOC": "localizacao", "NCP": "giro", "CPA": "cpc", "CPB": "cpc",
                   "PRE": "preventivo", "COL": "preventivo", "QBR": "quebra"}
ESTADOS_ACORDO = ("PRE", "COL", "QBR", "LIQ")


def _estado(tag: str) -> str:
    return tag.split("-")[2] if tag else ""


def _canal_cod(tag: str) -> str:
    p = tag.split("-")
    return p[3] if len(p) > 3 else "ND"


class LinhaDoTempo:
    """Consulta 'em que estado estava o cliente no começo do dia d'."""

    def __init__(self, trilha: list[dict]):
        self.por = defaultdict(list)
        for t in sorted(trilha, key=lambda t: t["data"]):
            self.por[t["id_cliente"]].append((date.fromisoformat(t["data"]), t))

    def estado_em(self, idc: str, d: date) -> str | None:
        ts = self.por.get(idc, [])
        i = bisect_left([x[0] for x in ts], d)  # eventos até o dia anterior
        return _estado(ts[i - 1][1]["tag"]) if i else None

    def eventos(self, idc: str):
        return self.por.get(idc, [])


def atribuir(eventos: list[Evento], linha: LinhaDoTempo, regua: Regua):
    """[(evento, régua, contato?)] — só tentativas em canais da régua (portal não é tentativa)."""
    saida = []
    for e in eventos:
        if e.canal not in regua["canais"]:
            continue
        est = linha.estado_em(e.id_cliente, e.data) or "LOC"
        saida.append((e, REGUA_DO_ESTADO.get(est, "outros"), regua.e_contato(e.canal, e.resultado)))
    return saida


def nascimentos_de_acordo(linha: LinhaDoTempo, regua: Regua):
    """[(id_cliente, data, régua de origem, canal de origem)] — entrada em acordo vinda de régua massiva."""
    cod_para_canal = {v: k for k, v in regua["canais"].items()}
    saida = []
    for idc, ts in linha.por.items():
        entrada = ts[0][0] if ts else None
        for d, t in ts:
            # acordo que já existia no dia da entrada não nasceu de uma ação do motor
            if d != entrada and _estado(t["tag"]) in ESTADOS_ACORDO and \
                    _estado(t["tag_anterior"]) in ("LOC", "CPA", "CPB", "NCP"):
                est = linha.estado_em(idc, d) or "LOC"
                saida.append((idc, d, REGUA_DO_ESTADO.get(est, "cpc"), cod_para_canal.get(_canal_cod(t["tag"]))))
    return saida


def _acordos_com_origem(parcelas: dict[str, list[Parcela]], nascimentos):
    """{id_acordo: (id_cliente, data de nascimento, régua, canal, valor total, parcelas)}.

    Liga cada acordo à última entrada em acordo do cliente antes do 1º vencimento. Sem
    entrada na trilha (acordo anterior ao motor), nasce 7 dias antes do 1º vencimento.
    """
    nasc = defaultdict(list)
    for idc, d, r, c in nascimentos:
        nasc[idc].append((d, r, c))
    saida = {}
    for idc, ps in parcelas.items():
        por_acordo = defaultdict(list)
        for p in ps:
            por_acordo[p.id_acordo].append(p)
        for ida, pa in por_acordo.items():
            inicio = min(p.vencimento for p in pa)
            cand = [n for n in nasc.get(idc, []) if n[0] <= inicio]
            d, r, c = max(cand, key=lambda n: n[0]) if cand else (inicio - timedelta(days=7), "cpc", None)
            saida[ida] = (idc, d, r, c or "sem_origem", sum(p.valor for p in pa), pa)
    return saida


def kpis_por_safra_cluster(clientes: dict[str, Cliente], estados: dict[str, EstadoCliente], trilha: list[dict],
                           eventos: list[Evento], parcelas: dict[str, list[Parcela]], regua: Regua,
                           inicio: date, fim: date, certs: dict[tuple[str, str], Certificacao] | None = None):
    """Linhas por (safra AAAA-MM, cluster de origem) + uma linha TOTAL."""
    linha = LinhaDoTempo([t for t in trilha if t["data"] <= fim.isoformat()])
    no_periodo = [e for e in eventos if inicio <= e.data <= fim]
    atrib = atribuir(no_periodo, linha, regua)
    grupo = {idc: (f"{e.safra:%Y-%m}", e.cluster_origem) for idc, e in estados.items()}
    validos = defaultdict(bool)
    for (idc, _), c in (certs or {}).items():
        if c.status not in ("INVALIDO", "CONTESTADO"):
            validos[idc] = True

    # primeiro contato (CPA) de cada cliente e tentativas até ele
    primeiro_cpa = {}
    for idc, ts in linha.por.items():
        for d, t in ts:
            if _estado(t["tag"]) == "CPA" and "contato" in t["motivo"]:
                primeiro_cpa[idc] = (d, _canal_cod(t["tag"]))
                break
    tentativas_ate = defaultdict(set)
    for e in eventos:
        if e.canal in regua["canais"] and e.id_cliente in primeiro_cpa and e.data <= primeiro_cpa[e.id_cliente][0]:
            tentativas_ate[e.id_cliente].add((e.data, e.canal))

    transicoes = Counter()
    entradas = defaultdict(Counter)
    for t in trilha:
        if not (inicio.isoformat() <= t["data"] <= fim.isoformat()):
            continue
        g = grupo.get(t["id_cliente"])
        a, b = _estado(t["tag_anterior"]), _estado(t["tag"])
        if a != b:
            transicoes[(g, a, b)] += 1
        if b == "CPA" and a != "CPA" and "contato" in t["motivo"]:
            entradas[g]["cpa_voz" if _canal_cod(t["tag"]) in ("AV", "DC") else "cpa_digital"] += 1
        if b == "QBR" and a != "QBR":
            entradas[g]["quebras"] += 1
        if "volta ao estoque" in t["motivo"]:
            entradas[g]["voltou_estoque"] += 1

    acordos = _acordos_com_origem(parcelas, nascimentos_de_acordo(linha, regua))
    custos = defaultdict(lambda: defaultdict(float))
    for e, r, _ in atrib:
        custos[grupo.get(e.id_cliente)][r] += e.custo
        custos[grupo.get(e.id_cliente)]["total"] += e.custo

    grupos = sorted({g for g in grupo.values()})
    linhas = []
    for g in grupos + ["TOTAL"]:
        ids = [i for i, gg in grupo.items() if g == "TOTAL" or gg == g]
        so = (lambda x: True) if g == "TOTAL" else (lambda x: x == g)
        n = len(ids)
        loc = [i for i in ids if i in primeiro_cpa and inicio <= primeiro_cpa[i][0] <= fim]
        por_canal = Counter(primeiro_cpa[i][1] for i in loc)
        ent = Counter()
        for gg, c in entradas.items():
            if so(gg):
                ent.update(c)
        custo = defaultdict(float)
        for gg, c in custos.items():
            if so(gg):
                for k, v in c.items():
                    custo[k] += v
        ids_set = set(ids)
        acs = [a for a in acordos.values() if a[0] in ids_set and inicio <= a[1] <= fim]
        voz = sum(1 for a in acs if a[3] in CANAIS_VOZ)
        dig = len(acs) - voz
        # pagamentos: todas as parcelas do grupo que venceram no período (qualquer safra de acordo)
        todas = [a for a in acordos.values() if a[0] in ids_set]
        ps = [p for a in todas for p in a[5] if inicio <= p.vencimento < fim]
        em_dia = sum(1 for p in ps if p.pago_em and p.pago_em <= p.vencimento)
        venc_q = [p for p in ps if p.vencimento + timedelta(days=5) <= fim and not (p.pago_em and p.pago_em <= p.vencimento)]
        regular = sum(1 for p in venc_q if p.pago_em and p.pago_em <= p.vencimento + timedelta(days=5))
        encerrados = [a for a in todas if max(p.vencimento for p in a[5]) < fim]
        quitados = sum(1 for a in encerrados if all(p.pago_em and p.pago_em <= fim for p in a[5]))
        tent = [len(tentativas_ate[i]) for i in loc]
        mig = sum(v for (gg, a, b), v in transicoes.items() if so(gg) and a == "NCP" and b == "CPA")
        rec = sum(v for (gg, a, b), v in transicoes.items() if so(gg) and a == "CPB" and b == "CPA")
        linhas.append({
            "safra": g if g == "TOTAL" else g[0], "cluster": "" if g == "TOTAL" else g[1],
            "clientes": n,
            "pct_base_qualificada": _pct(sum(validos[i] for i in ids), n) if certs is not None else None,
            "localizados": len(loc), "pct_localizados": _pct(len(loc), n),
            **{f"pct_loc_{c}": _pct(por_canal[c], n) for c in regua["canais"].values()},
            "custo_localizacao": round(custo["localizacao"] + custo["giro"], 2),
            "custo_por_cpc_descoberto": _div(custo["localizacao"] + custo["giro"], len(loc)),
            "ncp_para_cpa": mig, "cpb_recuperados": rec,
            "tentativas_ate_contato": round(sum(tent) / len(tent), 1) if tent else None,
            "acordos": len(acs), "pct_acordo_sobre_cpc_voz": _pct(voz, ent["cpa_voz"]),
            "pct_acordo_sobre_retorno_digital": _pct(dig, ent["cpa_digital"]),
            "custo_total": round(custo["total"], 2), "custo_por_acordo": _div(custo["total"], len(acs)),
            "pct_parcelas_em_dia": _pct(em_dia, len(ps)), "pct_acordos_quitados": _pct(quitados, len(encerrados)),
            "quebras": ent["quebras"], "pct_regularizacao_ate_d5": _pct(regular, len(venc_q)),
            "pct_retorna_estoque": _pct(ent["voltou_estoque"], ent["quebras"]),
        })
    return linhas


def matriz_migracao(trilha: list[dict], inicio: date, fim: date) -> dict[str, Counter]:
    """{estado_origem: Counter(estado_destino)} das mudanças de estado no período."""
    m = defaultdict(Counter)
    for t in trilha:
        if inicio.isoformat() <= t["data"] <= fim.isoformat():
            a, b = _estado(t["tag_anterior"]) or "ENTRADA", _estado(t["tag"])
            if a != b:
                m[a][b] += 1
    return m


def realizado_por_acao(clientes, trilha: list[dict], eventos: list[Evento], parcelas: dict[str, list[Parcela]],
                       regua: Regua, inicio: date, fim: date):
    """Uma linha por ação (régua x canal): volume, custo, contatos, acordos, valor acordado, recebido."""
    linha = LinhaDoTempo([t for t in trilha if t["data"] <= fim.isoformat()])
    atrib = atribuir([e for e in eventos if inicio <= e.data <= fim], linha, regua)
    acc = defaultdict(lambda: {"volume": 0, "custo": 0.0, "contatos": 0, "acordos": 0,
                               "valor_acordado": 0.0, "recebido": 0.0, "fornecedores": Counter()})
    for e, r, contato in atrib:
        a = acc[(r, e.canal)]
        a["volume"] += 1
        a["custo"] += e.custo
        a["contatos"] += contato
        a["fornecedores"][e.fornecedor or ""] += 1
    for idc, nasc, r, c, total, ps in _acordos_com_origem(parcelas, nascimentos_de_acordo(linha, regua)).values():
        if not (inicio <= nasc <= fim):
            continue
        a = acc[(r, c)]
        a["acordos"] += 1
        a["valor_acordado"] += total
        a["recebido"] += sum(p.valor for p in ps if p.pago_em and p.pago_em <= fim)
    ordem_r = ["localizacao", "giro", "cpc", "preventivo", "quebra", "outros"]
    ordem_c = list(regua["canais"])
    saida = []
    for (r, c), a in sorted(acc.items(), key=lambda kv: (ordem_r.index(kv[0][0]) if kv[0][0] in ordem_r else 9,
                                                         ordem_c.index(kv[0][1]) if kv[0][1] in ordem_c else 9)):
        saida.append({"regua": r, "canal": c, "vertical": "Voz" if c in CANAIS_VOZ else "Digital",
                      "fornecedor": a["fornecedores"].most_common(1)[0][0] if a["fornecedores"] else "",
                      "volume": a["volume"], "custo": round(a["custo"], 2), "contatos": a["contatos"],
                      "acordos": a["acordos"], "valor_acordado": round(a["valor_acordado"], 2),
                      "recebido": round(a["recebido"], 2)})
    return saida


def benchmarks(realizado: list[dict]) -> list[dict]:
    """Taxas observadas por régua x canal — recalibram as premissas do mês seguinte."""
    return [{**{k: r[k] for k in ("regua", "canal", "volume", "contatos", "custo")},
             "taxa_contato": _pct(r["contatos"], r["volume"]),
             "custo_por_contato": _div(r["custo"], r["contatos"]),
             "pct_acordo_sobre_contato": _pct(r["acordos"], r["contatos"])} for r in realizado]


def sugerir_ordem_rotacao(realizado: list[dict], regua: Regua) -> list[dict]:
    """Ordem por eficiência (menor custo por contato) nas réguas massivas, para o comitê mensal.

    Sugestão apenas: a ordem em regras/regua.json só muda por decisão do comitê.
    """
    agg = defaultdict(lambda: [0, 0, 0.0])
    for r in realizado:
        if r["regua"] in ("localizacao", "giro", "cpc") and r["canal"] in regua["ordem_rotacao"]:
            a = agg[r["canal"]]
            a[0] += r["volume"]
            a[1] += r["contatos"]
            a[2] += r["custo"]
    linhas = [{"canal": c, "volume": v[0], "contatos": v[1], "taxa_contato": _pct(v[1], v[0]),
               "custo_por_contato": _div(v[2], v[1]),
               "posicao_atual": regua["ordem_rotacao"].index(c) + 1} for c, v in agg.items()]
    linhas.sort(key=lambda l: (l["custo_por_contato"] is None, l["custo_por_contato"] or 0))
    for i, l in enumerate(linhas, 1):
        l["posicao_sugerida"] = i
    return linhas


def _pct(a, b):
    return round(a / b, 4) if b else None


def _div(a, b):
    return round(a / b, 2) if b else None
