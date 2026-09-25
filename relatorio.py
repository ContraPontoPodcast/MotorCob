"""Relatório do comitê mensal: KPIs por safra/cluster, migração de estados,
benchmarks e Real x Previsto por ação (Excel com fórmulas).

Uso (depois da rotina diária, que mantém estado/trilha.csv):
    python relatorio.py --clientes base/clientes.csv --carteira base/contatos.csv \\
        --retornos retornos/ [--parcelas base/parcelas.csv] [--estado estado/] \\
        --inicio 2026-09-01 --fim 2026-09-30 [--saida saida/comite]

Saídas: kpis_safra_cluster.csv, realizado_por_acao.csv, benchmarks.csv,
sugestao_ordem_rotacao.csv, migracao_estados.csv e comite_AAAA-MM-DD_AAAA-MM-DD.xlsx
(o Excel exige openpyxl; os CSVs não).
"""
import argparse
import csv
from collections import defaultdict
from datetime import date
from pathlib import Path

from motor.certificacao import certificar_contatos
from motor.ingestao import carregar_carteira, carregar_clientes, carregar_layouts, carregar_parcelas, ingerir_pasta
from motor.kpis import (benchmarks, kpis_por_safra_cluster, matriz_migracao, realizado_por_acao,
                        sugerir_ordem_rotacao)
from motor.regua import carregar_regua


def _csv(caminho: Path, linhas: list[dict]):
    if not linhas:
        return
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()))
        w.writeheader()
        w.writerows(linhas)


def montar(clientes, estados, trilha, eventos, parcelas, regua, inicio: date, fim: date, saida, certs=None,
           out=print):
    saida = Path(saida)
    saida.mkdir(parents=True, exist_ok=True)
    kp = kpis_por_safra_cluster(clientes, estados, trilha, eventos, parcelas, regua, inicio, fim, certs)
    real = realizado_por_acao(clientes, trilha, eventos, parcelas, regua, inicio, fim)
    bench = benchmarks(real)
    ordem = sugerir_ordem_rotacao(real, regua)
    matriz = matriz_migracao(trilha, inicio, fim)
    _csv(saida / "kpis_safra_cluster.csv", kp)
    _csv(saida / "realizado_por_acao.csv", real)
    _csv(saida / "benchmarks.csv", bench)
    _csv(saida / "sugestao_ordem_rotacao.csv", ordem)
    estados_m = ["LOC", "CPA", "CPB", "NCP", "PRE", "COL", "QBR", "LIQ", "BLQ"]
    _csv(saida / "migracao_estados.csv", [{"de": a, **{b: matriz[a].get(b, 0) for b in estados_m}} for a in matriz])

    soma, n = defaultdict(float), defaultdict(int)
    for e in eventos:
        if inicio <= e.data <= fim and e.canal in regua["canais"]:
            soma[e.canal] += e.custo
            n[e.canal] += 1
    custos_unit = {c: round(soma[c] / n[c], 4) for c in n}
    acordos = sum(r["acordos"] for r in real)
    ticket = sum(r["valor_acordado"] for r in real) / acordos if acordos else 0.0

    xlsx = saida / f"comite_{inicio.isoformat()}_{fim.isoformat()}.xlsx"
    try:
        from relatorios.excel_comite import gerar_excel
    except ImportError:
        out("  openpyxl não instalado: gerei só os CSVs (pip install openpyxl para o Excel)")
        xlsx = None
    else:
        gerar_excel(xlsx, (inicio, fim), real, kp, matriz, bench, ordem, regua["orcamento"], custos_unit, ticket)

    total = kp[-1]
    out(f"COMITÊ {inicio:%d/%m/%Y} a {fim:%d/%m/%Y}")
    out(f"  localizados: {total['localizados']} de {total['clientes']} ({(total['pct_localizados'] or 0):.1%})"
        f" | custo por CPC descoberto: R$ {total['custo_por_cpc_descoberto'] or 0:.2f}"
        f" | tentativas até o contato: {total['tentativas_ate_contato']}")
    out(f"  acordos: {total['acordos']} | custo por acordo: R$ {total['custo_por_acordo'] or 0:.2f}"
        f" | parcelas em dia: {(total['pct_parcelas_em_dia'] or 0):.1%}")
    mudancas = [o for o in ordem if o["posicao_sugerida"] != o["posicao_atual"]]
    if mudancas:
        out("  sugestão de rotação para o comitê: " + " → ".join(o["canal"] for o in ordem))
    out(f"  saídas em {saida}/" + (f" · Excel: {xlsx.name}" if xlsx else ""))
    return {"kpis": kp, "realizado": real, "benchmarks": bench, "ordem": ordem, "matriz": matriz, "xlsx": xlsx}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clientes", required=True)
    ap.add_argument("--carteira", required=True)
    ap.add_argument("--retornos", required=True)
    ap.add_argument("--layouts", default="layouts")
    ap.add_argument("--parcelas")
    ap.add_argument("--estado", default="estado", help="pasta da rotina diária (estados.json e trilha.csv)")
    ap.add_argument("--inicio", type=date.fromisoformat, required=True)
    ap.add_argument("--fim", type=date.fromisoformat, required=True)
    ap.add_argument("--saida", default="saida/comite")
    a = ap.parse_args()

    import rodar_dia
    regua = carregar_regua()
    clientes, _ = carregar_clientes(a.clientes)
    contatos, pessoa_de, _ = carregar_carteira(a.carteira)
    eventos = ingerir_pasta(a.retornos, carregar_layouts(a.layouts))[0]
    parcelas = carregar_parcelas(a.parcelas)[0] if a.parcelas else {}
    estados, _ = rodar_dia.carregar_estado(Path(a.estado))
    arq_trilha = Path(a.estado) / "trilha.csv"
    if not estados or not arq_trilha.exists():
        raise SystemExit(f"sem estado em {a.estado}/: rode antes o rodar_dia.py")
    with open(arq_trilha, newline="", encoding="utf-8") as f:
        trilha = list(csv.DictReader(f))
    certs = certificar_contatos([e for e in eventos if e.data <= a.fim], a.fim, contatos, pessoa_de)
    montar(clientes, estados, trilha, eventos, parcelas, regua, a.inicio, a.fim, a.saida, certs)


if __name__ == "__main__":
    main()
