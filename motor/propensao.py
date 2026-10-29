"""Propensão a pagamento (fase 1): chance de o cliente pagar nos próximos 30 dias, por célula.

Pergunta: dado como o cliente está hoje, qual a chance de ele PAGAR em até 30 dias? "Pagou" = quitação
ou 1ª parcela do acordo paga (coluna `pagou` = 1 em base/pagamentos.csv, ver motor/carteira.py). Acordo
fechado é promessa, não pagamento; parcial e parcela seguinte também não contam.

Treino (fotos semanais, sem vazamento):
1. Fotos: toda segunda-feira (DIA_FOTO) dos últimos `dias` (180) dias, cada cliente da carteira que, no
   começo do dia D, estava em LOC, CPA, CPB, NCP ou QBR (trilha: mesma leitura de
   `kpis.LinhaDoTempo.estado_em`). PRE, COL, LIQ e BLQ ficam fora da população.
2. Variáveis "como eram em D": situação (fase) em D, atraso em D (`Cliente.atraso_em`) e saldo em D =
   saldo de hoje + quitações/parciais registradas depois de D (a baixa abate o estoque; sem isso o saldo
   de quem pagou vaza o alvo). Nada que só existe porque pagou (LIQ, acordo QUITACAO, pago_em).
3. Alvo: existe pagamento com pagou = 1 e data em (D, D+30]. Pagamento até D não conta. Foto cujo alvo
   ainda não fechou (D > hoje − 30) fica fora do treino.
4. Célula = situação (localizacao/cpc/giro/quebra) × faixa de atraso (0–30, 31–90, 91–180, 181–360,
   361+) × faixa de saldo (tercis do saldo das fotos). Taxa com encolhimento Beta hierárquico:
   célula → situação → carteira (força FORCA: equivale a FORCA fotos). Pouco volume puxa para a média.
5. Faixas A (muito alta) … E (muito baixa): cortes nos quintis das p das fotos de treino, gravados no
   modelo (estado/modelo_propensao.json, com versão e data) e congelados até o próximo treino — a faixa
   não "anda" sozinha. p igual ao corte fica na faixa de cima (com poucas células, uma faixa pode ficar
   vazia). Treino semanal (domingo), quando não há modelo, ele tem 7 dias ou mais, foi
   treinado depois de hoje (rodada de dia passado) ou mudou o parâmetro.
6. Evidência da carteira: Coletando (< 30 pagamentos no treino), Prévia (30–199), Definida (≥ 200). Em
   Coletando a faixa fica vazia (a tela mostra "Coletando"); a p continua calculada.

Aplicação (todo dia): p do cliente ativo hoje (na carga, em LOC/CPA/CPB/NCP/QBR) = taxa encolhida da
célula dele hoje; faixa pelos cortes congelados; motivos = códigos da célula (ex.: ["atraso_31_90",
"saldo_baixo", "situacao_cpc"]). Mesmo modelo e mesma base → mesmo resultado (idempotente).

LGPD: o score não usa idade, gênero, raça/cor, religião, saúde, deficiência, DDD/UF nem a persona
aprendida (que pode conter idade); só situação, atraso e saldo. As personas (aprendida e da empresa)
recebem só agregados para o relatório (`agregar`): clientes, saldo, p média, pagamentos esperados = Σp,
valor esperado = Σ(p × saldo).

Nesta fase a propensão só é calculada, publicada e serve de condição de etapa (campo "propensao"); não
muda a ordem da fila nem a escolha de canal.
"""
from __future__ import annotations

import csv
import json
from bisect import bisect_right
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ESTADOS_POPULACAO = ("LOC", "CPA", "CPB", "NCP", "QBR")
SITUACAO = {"LOC": "localizacao", "CPA": "cpc", "CPB": "cpc", "NCP": "giro", "QBR": "quebra"}
FAIXAS_ATRASO = ((30, "0_30"), (90, "31_90"), (180, "91_180"), (360, "181_360"))
FAIXAS = "ABCDE"                 # A = muito alta … E = muito baixa
NOME_FAIXA = {"A": "muito alta", "B": "alta", "C": "média", "D": "baixa", "E": "muito baixa"}
JANELA = 30                      # dias do alvo: pagou em (D, D+30]
DIAS_TREINO = 180                # janela das fotos
DIA_FOTO = 0                     # segunda-feira
DIA_TREINO = 6                   # domingo
FORCA = 50.0                     # peso do prior no encolhimento (equivale a 50 fotos)
MIN_PREVIA, MIN_DEFINIDA = 30, 200   # pagamentos no treino para Prévia / Definida
FORMATO = 1
ARQ_MODELO = "modelo_propensao.json"
ARQ_CLIENTES = "propensao.json"
ABATEM_SALDO = ("quitacao", "parcial")   # baixas que saem do estoque (parcela de acordo não abate)


# ------------------------------------------------------------------ entradas
def carregar_pagamentos(arq: str | Path | None, parcelas: dict | None = None) -> list[dict]:
    """[{id_cliente, data, valor, tipo, pagou}] de base/pagamentos.csv. Sem o arquivo (motor sem pastas de
    credor), sai das parcelas: 1ª parcela do acordo com pago_em = pagou (quitação vira acordo QUITACAO)."""
    if arq is not None and Path(arq).exists():
        saida = []
        with open(arq, newline="", encoding="utf-8") as f:
            for l in csv.DictReader(f, delimiter=";"):
                try:
                    d = date.fromisoformat((l.get("data") or "").strip())
                    v = float(l.get("valor") or 0)
                except ValueError:
                    continue
                saida.append({"id_cliente": l["id_cliente"], "data": d, "valor": v, "tipo": l.get("tipo") or "",
                              "pagou": str(l.get("pagou") or "").strip() == "1"})
        return saida
    saida = []
    for idc, ps in (parcelas or {}).items():
        por_acordo = defaultdict(list)
        for p in ps:
            por_acordo[p.id_acordo].append(p)
        for ida, pa in por_acordo.items():
            p1 = min(pa, key=lambda p: p.numero)
            if p1.pago_em is not None:
                saida.append({"id_cliente": idc, "data": p1.pago_em, "valor": p1.valor,
                              "tipo": "quitacao" if ida == "QUITACAO" else "parcela", "pagou": True})
    return saida


def carregar_trilha(pasta_estado: str | Path) -> list[dict]:
    arq = Path(pasta_estado) / "trilha.csv"
    if not arq.exists():
        return []
    with open(arq, newline="", encoding="utf-8") as f:
        return [{"data": l["data"], "id_cliente": l["id_cliente"], "tag": l["tag"]} for l in csv.DictReader(f)]


# ------------------------------------------------------------------ célula
def faixa_atraso(dias: int) -> str:
    for lim, nome in FAIXAS_ATRASO:
        if dias <= lim:
            return nome
    return "361_mais"


def faixa_saldo(v: float, cortes: list[float] | None) -> str:
    if not cortes:
        return "saldo_medio"
    return "saldo_baixo" if v <= cortes[0] else "saldo_medio" if v <= cortes[1] else "saldo_alto"


def celula(estado: str, atraso: int, saldo: float, cortes_saldo) -> tuple[str, str, str]:
    return (SITUACAO[estado], faixa_atraso(atraso), faixa_saldo(saldo, cortes_saldo))


def _chave(c: tuple) -> str:
    return "|".join(c)


def motivos(c: tuple) -> list[str]:
    """Códigos curtos (não texto livre): atraso, saldo e situação da célula."""
    sit, atr, sal = c
    return [f"atraso_{atr}", sal, f"situacao_{sit}"]


def _quantil(ordenados: list[float], q: float) -> float:
    """Quantil pelo posto mais próximo (sem interpolação): o corte é sempre um valor que existe."""
    i = min(max(int(q * len(ordenados)), 0), len(ordenados) - 1)
    return ordenados[i]


def _estado(tag: str) -> str:
    p = (tag or "").split("-")
    return p[2] if len(p) > 2 else ""


# ------------------------------------------------------------------ fotos
def datas_das_fotos(hoje: date, dias: int = DIAS_TREINO, dia_semana: int = DIA_FOTO) -> list[date]:
    """Dias D das fotos de treino: o dia da semana no período [hoje − dias, hoje − JANELA] (alvo fechado)."""
    fim = hoje - timedelta(days=JANELA)
    d = hoje - timedelta(days=dias)
    d += timedelta(days=(dia_semana - d.weekday()) % 7)
    saida = []
    while d <= fim:
        saida.append(d)
        d += timedelta(days=7)
    return saida


def fotos(clientes: dict, trilha: list[dict], pagamentos: list[dict], datas: list[date]) -> list[dict]:
    """[{id_cliente, data, estado, atraso, saldo, alvo, pagamento}] — variáveis como eram no começo de D."""
    return list(iter_fotos(clientes, trilha, pagamentos, datas))


def iter_fotos(clientes: dict, trilha: list[dict], pagamentos: list[dict], datas: list[date]):
    """Gera as fotos uma a uma (o treino não guarda milhões delas na memória).

    Estado em D = TAG do último evento da trilha antes de D (kpis.LinhaDoTempo.estado_em). Uma passada por
    cliente (eventos e datas em ordem): nada de cliente dentro de cliente. `pagamento` = data da baixa que
    fez o alvo (só para contar a evidência; nunca é variável)."""
    eventos = defaultdict(list)
    for t in trilha:
        eventos[t["id_cliente"]].append((t["data"], _estado(t["tag"])))
    pagos, abate = defaultdict(list), defaultdict(list)
    for p in pagamentos:
        if p["pagou"]:
            pagos[p["id_cliente"]].append(p["data"])
        if p["tipo"] in ABATEM_SALDO:
            abate[p["id_cliente"]].append((p["data"], p["valor"]))
    datas = [(d, d.isoformat(), d + timedelta(days=JANELA)) for d in sorted(datas)]
    for idc, evs in eventos.items():
        c = clientes.get(idc)
        if c is None:
            continue
        evs.sort(key=lambda e: e[0])
        ps = sorted(pagos.get(idc, []))
        ab = abate.get(idc, [])
        i, est = 0, None
        for d, iso, limite in datas:
            while i < len(evs) and evs[i][0] < iso:      # eventos até o dia anterior a D
                est = evs[i][1]
                i += 1
            if est not in ESTADOS_POPULACAO or c.data_entrada > d:
                continue
            # pagou em (D, D+30]: pagamento no próprio D ou antes não conta
            j = bisect_right(ps, d)
            alvo = j < len(ps) and ps[j] <= limite
            saldo = c.saldo + sum(v for dp, v in ab if dp > d) if ab else c.saldo
            yield {"id_cliente": idc, "data": d, "estado": est, "atraso": c.atraso_em(d),
                   "saldo": round(saldo, 2), "alvo": alvo, "pagamento": ps[j] if alvo else None}


# ------------------------------------------------------------------ treino
def evidencia(pagamentos: int) -> str:
    return "definida" if pagamentos >= MIN_DEFINIDA else "previa" if pagamentos >= MIN_PREVIA else "coletando"


def treinar(fts, hoje: date, forca: float = FORCA, dias: int = DIAS_TREINO) -> dict:
    """Modelo da carteira: tercis de saldo, taxas encolhidas por célula e cortes A–E (quintis).

    fts: lista de fotos ou função que gera as fotos de novo (duas passadas: tercis de saldo, depois as
    contagens). Como a p é a da célula, os quintis saem das contagens por célula, sem guardar as fotos."""
    fonte = fts if callable(fts) else (lambda: fts)
    saldos = sorted(f["saldo"] for f in fonte())
    cortes_saldo = [_quantil(saldos, 1 / 3), _quantil(saldos, 2 / 3)] if saldos else None
    del saldos
    carteira, por_sit, por_cel = [0, 0], defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    baixas = set()      # pagamentos no treino: baixas distintas (cliente, data) que caíram no alvo de alguma foto
    for f in fonte():
        c = celula(f["estado"], f["atraso"], f["saldo"], cortes_saldo)
        for g in (carteira, por_sit[c[0]], por_cel[_chave(c)]):
            g[0] += f["alvo"]
            g[1] += 1
        if f["alvo"]:
            baixas.add((f["id_cliente"], f["pagamento"]))
    s, n = carteira
    p_cart = round(s / n, 6) if n else 0.0
    p_sit = {k: round((sk + forca * p_cart) / (nk + forca), 6) for k, (sk, nk) in por_sit.items()}
    p_cel = {k: round((sk + forca * p_sit[k.split("|")[0]]) / (nk + forca), 6) for k, (sk, nk) in por_cel.items()}
    modelo = {"formato": FORMATO, "versao": f"p1-{hoje.isoformat()}", "treinado_em": hoje.isoformat(),
              "parametros": {"dias": dias, "forca": forca, "janela": JANELA},
              "fotos": n, "fotos_com_pagamento": s, "pagamentos": len(baixas), "evidencia": evidencia(len(baixas)),
              "cortes_saldo": cortes_saldo, "taxa_carteira": p_cart,
              "situacao": {k: {"pagaram": v[0], "fotos": v[1], "taxa": p_sit[k]} for k, v in sorted(por_sit.items())},
              "celulas": {k: {"pagaram": v[0], "fotos": v[1], "taxa": p_cel[k]} for k, v in sorted(por_cel.items())},
              "cortes": None, "realizado_por_faixa": {}}
    if n:
        # quintis das p das fotos (posto mais próximo), contando cada célula pelo nº de fotos dela
        pesos = defaultdict(int)
        for k, (_, nk) in por_cel.items():
            pesos[round(p_cel[k], 4)] += nk
        valores = sorted(pesos.items())
        cortes = {}
        for fx, q in zip("ABCD", (0.8, 0.6, 0.4, 0.2)):
            alvo_pos, acum = min(int(q * n), n - 1), 0
            for v, nk in valores:
                acum += nk
                if acum > alvo_pos:
                    cortes[fx] = v
                    break
        modelo["cortes"] = cortes
        # o que de fato aconteceu em cada faixa nas fotos de treino (separação; vira métrica na tela)
        real = defaultdict(lambda: [0, 0])
        for k, (sk, nk) in por_cel.items():
            g = real[faixa_de(modelo, round(p_cel[k], 4))]
            g[0] += sk
            g[1] += nk
        modelo["realizado_por_faixa"] = {fx: {"pagaram": v[0], "fotos": v[1], "taxa": round(v[0] / v[1], 4)}
                                         for fx, v in sorted(real.items())}
    return modelo


def taxa(modelo: dict, c: tuple) -> float:
    """Taxa encolhida da célula; célula sem foto no treino = taxa da situação; situação sem foto = carteira."""
    k = _chave(c)
    if k in modelo["celulas"]:
        return modelo["celulas"][k]["taxa"]
    if c[0] in modelo["situacao"]:
        return modelo["situacao"][c[0]]["taxa"]
    return modelo["taxa_carteira"]


def faixa_de(modelo: dict, p: float) -> str:
    """A–E pelos cortes congelados do modelo (p com 4 casas)."""
    cortes = modelo.get("cortes")
    if not cortes:
        return ""
    for fx in "ABCD":
        if p >= cortes[fx]:
            return fx
    return "E"


# ------------------------------------------------------------------ modelo em disco
def carregar_modelo(pasta_estado) -> dict | None:
    arq = Path(pasta_estado) / ARQ_MODELO
    try:
        m = json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return m if isinstance(m, dict) and m.get("formato") == FORMATO else None


def _gravar(arq: Path, dados):
    arq.parent.mkdir(parents=True, exist_ok=True)
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp.replace(arq)


def precisa_treinar(modelo: dict | None, hoje: date, dias: int = DIAS_TREINO, forca: float = FORCA) -> bool:
    if modelo is None:
        return True
    if modelo.get("parametros") != {"dias": dias, "forca": forca, "janela": JANELA}:
        return True
    t = date.fromisoformat(modelo["treinado_em"])
    if t > hoje:                       # rodada de um dia passado: o modelo de depois veria o futuro
        return True
    return (hoje - t).days >= 7 or (hoje.weekday() == DIA_TREINO and t != hoje)


# ------------------------------------------------------------------ aplicação
def aplicar(modelo: dict, clientes: dict, estados: dict, hoje: date, ativos: set | None = None) -> dict:
    """{id_cliente: {"p", "faixa", "motivos"}} de quem está ativo hoje (na carga, nos estados da população).
    Em Coletando a faixa fica vazia."""
    sem_faixa = modelo["evidencia"] == "coletando"
    saida = {}
    for idc, est in estados.items():
        c = clientes.get(idc)
        if c is None or est.estado not in ESTADOS_POPULACAO or (ativos is not None and idc not in ativos):
            continue
        cel = celula(est.estado, c.atraso_em(hoje), c.saldo, modelo.get("cortes_saldo"))
        p = round(taxa(modelo, cel), 4)
        saida[idc] = {"p": p, "faixa": "" if sem_faixa else faixa_de(modelo, p), "motivos": motivos(cel)}
    return saida


def agregar(scores: dict, clientes: dict, grupo_de) -> dict:
    """{grupo: {clientes, saldo, p_media, pagamentos_esperados, valor_esperado, faixas}} (só relatório).
    grupo_de: id_cliente → chave do grupo (persona aprendida ou da empresa); None = fora."""
    acc = defaultdict(lambda: {"clientes": 0, "saldo": 0.0, "soma_p": 0.0, "valor": 0.0, "faixas": defaultdict(int)})
    for idc, s in scores.items():
        g = grupo_de(idc)
        if g is None:
            continue
        c = clientes.get(idc)
        saldo = c.saldo if c else 0.0
        a = acc[g]
        a["clientes"] += 1
        a["saldo"] += saldo
        a["soma_p"] += s["p"]
        a["valor"] += s["p"] * saldo
        if s["faixa"]:
            a["faixas"][s["faixa"]] += 1
    return {g: {"clientes": a["clientes"], "saldo": round(a["saldo"], 2),
                "p_media": round(a["soma_p"] / a["clientes"], 4),
                "pagamentos_esperados": round(a["soma_p"], 2), "valor_esperado": round(a["valor"], 2),
                "faixas": dict(sorted(a["faixas"].items()))}
            for g, a in sorted(acc.items())}


def resumo(modelo: dict, scores: dict, clientes: dict) -> dict:
    """Resumo da carteira para o resultado da rodada: evidência, versão, cortes e totais de hoje."""
    tot = agregar(scores, clientes, lambda _i: "carteira").get("carteira") or {
        "clientes": 0, "saldo": 0.0, "p_media": 0.0, "pagamentos_esperados": 0.0, "valor_esperado": 0.0, "faixas": {}}
    return {"versao": modelo["versao"], "treinado_em": modelo["treinado_em"], "evidencia": modelo["evidencia"],
            "pagamentos_treino": modelo["pagamentos"], "fotos_treino": modelo["fotos"],
            "taxa_carteira": modelo["taxa_carteira"], "cortes": modelo.get("cortes"),
            "cortes_saldo": modelo.get("cortes_saldo"), "realizado_por_faixa": modelo.get("realizado_por_faixa"),
            **tot}


def calcular(clientes: dict, estados: dict, hoje: date, pasta_estado, pagamentos: list[dict] | None = None,
             ativos: set | None = None, dias: int = DIAS_TREINO, forca: float = FORCA,
             trilha: list[dict] | None = None) -> dict:
    """Rotina do dia: treina se for a hora (lê estado/trilha.csv), aplica e grava estado/propensao.json.
    Devolve {"modelo", "clientes": {id: {p, faixa, motivos}}, "resumo", "treinou"}."""
    pasta_estado = Path(pasta_estado)
    modelo = carregar_modelo(pasta_estado)
    treinou = precisa_treinar(modelo, hoje, dias, forca)
    if treinou:
        tr = trilha if trilha is not None else carregar_trilha(pasta_estado)
        datas = datas_das_fotos(hoje, dias)
        modelo = treinar(lambda: iter_fotos(clientes, tr, pagamentos or [], datas), hoje, forca, dias)
        _gravar(pasta_estado / ARQ_MODELO, modelo)
    scores = aplicar(modelo, clientes, estados, hoje, ativos)
    _gravar(pasta_estado / ARQ_CLIENTES, {"data": hoje.isoformat(), "versao": modelo["versao"],
                                          "evidencia": modelo["evidencia"], "clientes": scores})
    return {"modelo": modelo, "clientes": scores, "resumo": {**resumo(modelo, scores, clientes), "treinou": treinou},
            "treinou": treinou}
