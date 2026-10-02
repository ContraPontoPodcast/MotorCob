"""Ações realizadas: quantas ações o MotorCob mandou fazer e o que voltou delas.

Cruza o que foi exportado (estado/escolhas.csv) com os eventos (ocorrências e retornos)
e soma por dia, canal, régua (momento: localizacao, cpc, giro, preventivo, quebra),
segmento (cluster) e persona. Sai só número agregado: nenhum ID, telefone ou e-mail.

Uma AÇÃO é (dia, cliente, canal): o cliente com 3 números no discador conta 1 ação.
  enviadas       ações exportadas na lista do dia (a reserva só conta se teve retorno)
  reservas       ações exportadas como reserva ("só se o principal não contatar")
  com_retorno    ações que tiveram ao menos uma ocorrência/retorno
  retornos       ocorrências/retornos ligados às ações (o discador pode ter várias)
  cpcs           ações em que o cliente deu CPC
  custo          custo dos retornos; ação sem retorno usa o custo do canal (config)
  primeiros_cpc / acoes_ate_primeiro_cpc
                 no dia do 1º CPC do cliente: quantas ações ele recebeu até aquele dia
                 (média = acoes_ate_primeiro_cpc / primeiros_cpc, soma com qualquer filtro)
Ocorrência que não casa com ação exportada (até DIAS_BUSCA_ESCOLHA dias antes) entra na
régua "fora_da_lista": a empresa acionou por fora do MotorCob.
"""
from collections import defaultdict
from datetime import date, timedelta

from .entrada import DIAS_BUSCA_ESCOLHA

FORA = "fora_da_lista"
METRICAS = ("enviadas", "reservas", "com_retorno", "retornos", "cpcs", "custo", "primeiros_cpc",
            "acoes_ate_primeiro_cpc")


def agregar(escolhas: dict, eventos: list, regua, custos: dict | None = None,
            desde: date | None = None) -> list[dict]:
    """escolhas: carregar_escolhas(); eventos: Evento[]; custos: {canal: custo por ação}.
    Retorna linhas {data, canal, regua, cluster, persona, <METRICAS>} a partir de `desde`."""
    custos = {c: float(v) for c, v in (custos or {}).items() if v not in (None, "")}
    acoes = {}                         # (data, idc, canal) -> dados da ação
    por_cliente_canal = defaultdict(list)
    for (d, idc), ls in escolhas.items():
        for l in ls:
            k = (d, idc, l["canal"])
            reserva = str(l.get("reserva")) == "1"
            if k in acoes:
                acoes[k]["reserva"] = acoes[k]["reserva"] and reserva
                continue
            acoes[k] = {"reserva": reserva, "regua": l.get("regua") or "", "cluster": l.get("cluster") or "",
                        "persona": l.get("persona") or "", "retornos": 0, "cpc": False, "custo": 0.0}
            por_cliente_canal[(idc, l["canal"])].append(d)
    for v in por_cliente_canal.values():
        v.sort(reverse=True)

    fora = defaultdict(lambda: {"retornos": 0, "cpcs": 0, "custo": 0.0})
    for e in eventos:
        cpc = regua.e_contato(e.canal, e.resultado)
        limite = (e.data - timedelta(days=DIAS_BUSCA_ESCOLHA)).isoformat()
        dia_ev = e.data.isoformat()
        d = next((d for d in por_cliente_canal.get((e.id_cliente, e.canal), ()) if limite <= d <= dia_ev), None)
        if d is None:
            if (e.fornecedor or "").startswith("ocorrencia:"):
                f = fora[(dia_ev, e.canal)]
                f["retornos"] += 1
                f["cpcs"] += cpc
                f["custo"] += e.custo or custos.get(e.canal) or 0.0
            continue
        a = acoes[(d, e.id_cliente, e.canal)]
        a["retornos"] += 1
        a["cpc"] = a["cpc"] or cpc
        a["custo"] += e.custo or 0.0

    soma = defaultdict(lambda: dict.fromkeys(METRICAS, 0))
    # 1º CPC de cada cliente: quantas ações (enviadas) ele recebeu até aquele dia
    acoes_cliente = defaultdict(list)
    for (d, idc, canal), a in acoes.items():
        if not a["reserva"] or a["retornos"]:
            acoes_cliente[idc].append((d, canal, a))
    for idc, ls in acoes_cliente.items():
        ls.sort(key=lambda x: (x[0], x[1]))
        primeiro = next((x for x in ls if x[2]["cpc"]), None)
        if primeiro:   # conta todas as ações até o dia do 1º CPC, inclusive as desse dia
            d, canal, a = primeiro
            s = soma[(d, canal, a["regua"], a["cluster"], a["persona"])]
            s["primeiros_cpc"] += 1
            s["acoes_ate_primeiro_cpc"] += sum(1 for x in ls if x[0] <= d)
    for (d, idc, canal), a in acoes.items():
        s = soma[(d, canal, a["regua"], a["cluster"], a["persona"])]
        foi = not a["reserva"] or a["retornos"] > 0
        s["reservas"] += a["reserva"]
        s["enviadas"] += foi
        s["com_retorno"] += a["retornos"] > 0
        s["retornos"] += a["retornos"]
        s["cpcs"] += a["cpc"]
        if foi:
            s["custo"] += a["custo"] if a["retornos"] and a["custo"] else (custos.get(canal) or 0.0)
    for (d, canal), f in fora.items():
        s = soma[(d, canal, FORA, "", "")]
        s["com_retorno"] += f["retornos"]
        s["retornos"] += f["retornos"]
        s["cpcs"] += f["cpcs"]
        s["custo"] += f["custo"]

    linhas = []
    for (d, canal, reg, cluster, persona), s in sorted(soma.items()):
        if desde and d < desde.isoformat():
            continue
        linhas.append({"data": d, "canal": canal, "regua": reg, "cluster": cluster, "persona": persona,
                       **s, "custo": round(float(s["custo"]), 2)})
    return linhas


def sem_ocorrencia(linhas: list[dict], dia: date) -> list[str]:
    """Canais com ações enviadas em `dia` e nenhuma ocorrência de volta."""
    por = defaultdict(lambda: [0, 0])
    for l in linhas:
        if l["data"] == dia.isoformat() and l["regua"] != FORA:
            por[l["canal"]][0] += l["enviadas"]
            por[l["canal"]][1] += l["com_retorno"]
    faltam = [f"{c} {e}" for c, (e, r) in sorted(por.items()) if e and not r]
    if not faltam:
        return []
    return [f"SEM OCORRÊNCIA: ações de {dia:%d/%m/%Y} sem retorno da empresa — " + ", ".join(faltam)
            + " (envie o arquivo de ocorrência para o MotorCob contar CPC e custo)"]


def totais(linhas: list[dict]) -> dict:
    """Soma geral (para o resumo da rotina)."""
    t = dict.fromkeys(METRICAS, 0)
    for l in linhas:
        for k in METRICAS:
            t[k] += l[k]
    t["custo"] = round(float(t["custo"]), 2)
    return t
