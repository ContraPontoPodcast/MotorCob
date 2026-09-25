"""Rotina diária da operação (playbook): atualiza as TAGs e gera a fila do dia.

Uso (toda manhã):
    python rodar_dia.py --clientes base/clientes.csv --carteira base/contatos.csv \\
        --retornos retornos/ [--parcelas base/parcelas.csv] [--acoes acoes/acoes.csv --portal logs/portal.csv] \\
        [--data 2026-09-25] [--estado estado/] [--saida saida/]

1. Lê retornos dos fornecedores (layouts/), portal e parcelas.
2. Processa cada dia pendente até ontem: retornos do dia → TAG, acordos, tempo.
   O estado fica em --estado (estados.json) e a trilha é acrescentada em trilha.csv.
3. Gera para --data: fila_do_dia.csv (e uma por canal), enriquecimento.csv e alertas.

A fila pode ir direto para o disparar.py (link rastreável):
    python disparar.py --plano saida/2026-09-25/fila_do_dia.csv --ordem todas ...
"""
import argparse
import csv
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from motor.certificacao import certificar_contatos
from motor.fila import gerar_fila, lista_enriquecimento
from motor.ingestao import carregar_carteira, carregar_clientes, carregar_layouts, carregar_parcelas, ingerir_pasta
from motor.marcacao import EstadoCliente, processar_dia
from motor.rastreio import carregar_acoes, ler_log_portal
from motor.regua import carregar_regua


def _salvar(caminho: Path, linhas: list[dict], anexar=False):
    if not linhas:
        return
    novo = not (anexar and caminho.exists())
    with open(caminho, "a" if anexar else "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()))
        if novo:
            w.writeheader()
        w.writerows(linhas)


def carregar_estado(pasta: Path):
    arq = pasta / "estados.json"
    if not arq.exists():
        return {}, None
    d = json.loads(arq.read_text(encoding="utf-8"))
    return ({k: EstadoCliente.de_json(v) for k, v in d["estados"].items()},
            date.fromisoformat(d["ultimo_dia"]) if d.get("ultimo_dia") else None)


def salvar_estado(pasta: Path, estados, ultimo_dia):
    pasta.mkdir(parents=True, exist_ok=True)
    tmp = pasta / "estados.json.tmp"
    tmp.write_text(json.dumps({"ultimo_dia": ultimo_dia.isoformat() if ultimo_dia else None,
                               "estados": {k: e.para_json() for k, e in estados.items()}},
                              ensure_ascii=False), encoding="utf-8")
    tmp.replace(pasta / "estados.json")  # troca atômica: nunca deixa estado pela metade


def rodar_dia(clientes_csv, carteira_csv, retornos, hoje: date, layouts="layouts", parcelas_csv=None,
              acoes=None, portal=None, pasta_estado="estado", pasta_saida="saida", regua_json=None, out=print):
    regua = carregar_regua(regua_json) if regua_json else carregar_regua()
    clientes, rej_cli = carregar_clientes(clientes_csv)
    contatos, pessoa_de, _ = carregar_carteira(carteira_csv)
    eventos, relatorios, quarentena, sem_layout = ingerir_pasta(retornos, carregar_layouts(layouts))
    if portal:
        eventos += ler_log_portal(portal, carregar_acoes(acoes))[0]
    parcelas = carregar_parcelas(parcelas_csv)[0] if parcelas_csv else {}
    flags = {c["contato"]: {"whatsapp_valido": c["whatsapp_valido"], "atualizado_em": c["atualizado_em"]}
             for c in contatos}
    contatos_por = defaultdict(list)
    for c in contatos:
        contatos_por[c["id_cliente"]].append(c["contato"])
    por_dia = defaultdict(list)
    for e in eventos:
        por_dia[e.data].append(e)

    pasta_estado = Path(pasta_estado)
    estados, ultimo = carregar_estado(pasta_estado)
    inicio = (ultimo + timedelta(days=1)) if ultimo else min(c.data_entrada for c in clientes.values())
    trilha = []
    dia = inicio
    while dia < hoje:
        ev_ate = [e for e in eventos if e.data <= dia]
        certs = certificar_contatos(ev_ate, dia, contatos, pessoa_de)
        _, disp, _ = gerar_fila(estados, clientes, certs, flags, parcelas, dia, regua, ev_ate)
        trilha += processar_dia(estados, clientes, por_dia.get(dia, []), parcelas, dia, regua, disp,
                                baixas_ate=dia)
        dia += timedelta(days=1)
    ultimo = max(ultimo or hoje - timedelta(days=1), hoje - timedelta(days=1))
    salvar_estado(pasta_estado, estados, ultimo)
    _salvar(pasta_estado / "trilha.csv", trilha, anexar=True)

    ev_ate = [e for e in eventos if e.data < hoje]
    certs = certificar_contatos(ev_ate, hoje, contatos, pessoa_de)
    fila, _, alertas = gerar_fila(estados, clientes, certs, flags, parcelas, hoje, regua, ev_ate)
    enriq = lista_enriquecimento(estados, flags, contatos_por, hoje, regua)

    saida = Path(pasta_saida) / hoje.isoformat()
    saida.mkdir(parents=True, exist_ok=True)
    _salvar(saida / "fila_do_dia.csv", fila)
    por_canal = defaultdict(list)
    for l in fila:
        por_canal[l["canal"]].append(l)
    for canal, linhas in por_canal.items():
        _salvar(saida / f"fila_{canal}.csv", linhas)
    _salvar(saida / "enriquecimento.csv", enriq)
    (saida / "alertas.txt").write_text("\n".join(alertas) + ("\n" if alertas else ""), encoding="utf-8")

    contagem = defaultdict(int)
    for e in estados.values():
        contagem[e.estado] += 1
    out(f"ROTINA DE {hoje:%d/%m/%Y}")
    out(f"  dias processados: {(hoje - inicio).days if inicio < hoje else 0} | eventos na trilha: {len(trilha)}"
        + (f" | arquivos sem layout: {sem_layout}" if sem_layout else "")
        + (f" | {len(quarentena)} retornos em quarentena" if quarentena else "")
        + (f" | clientes rejeitados: {dict(rej_cli)}" if rej_cli else ""))
    out("  estados: " + " · ".join(f"{k} {contagem[k]}" for k in regua["hierarquia"] + ["LIQ", "BLQ"] if contagem[k]))
    out(f"  fila do dia: {len({l['id_cliente'] for l in fila})} clientes, {len(fila)} linhas — "
        + ", ".join(f"{c} {len({l['id_cliente'] for l in ls})}" for c, ls in sorted(por_canal.items())))
    out(f"  enriquecimento: {len(enriq)} clientes")
    for a in alertas:
        out(f"  ALERTA: {a}")
    out(f"  saídas em {saida}/ · estado em {pasta_estado}/")
    return {"estados": estados, "fila": fila, "enriquecimento": enriq, "alertas": alertas, "trilha": trilha}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clientes", required=True, help="id_cliente;data_entrada;saldo;dias_atraso[;bloqueio]")
    ap.add_argument("--carteira", required=True, help="id_cliente;contato;tipo[;origem;cpf;whatsapp_valido;atualizado_em]")
    ap.add_argument("--retornos", required=True)
    ap.add_argument("--layouts", default="layouts")
    ap.add_argument("--parcelas", help="id_cliente;id_acordo;parcela;vencimento;valor;pago_em")
    ap.add_argument("--acoes")
    ap.add_argument("--portal")
    ap.add_argument("--data", type=date.fromisoformat, default=date.today())
    ap.add_argument("--estado", default="estado")
    ap.add_argument("--saida", default="saida")
    ap.add_argument("--regua", help="arquivo de regras (padrão: regras/regua.json)")
    a = ap.parse_args()
    if a.portal and not a.acoes:
        ap.error("--portal exige --acoes")
    rodar_dia(a.clientes, a.carteira, a.retornos, a.data, a.layouts, a.parcelas, a.acoes, a.portal,
              a.estado, a.saida, a.regua)


if __name__ == "__main__":
    main()
