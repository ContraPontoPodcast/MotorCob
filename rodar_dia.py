"""Rotina diária da operação (playbook): atualiza as TAGs e gera a fila do dia.

Uso (toda manhã):
    python rodar_dia.py --clientes base/clientes.csv --carteira base/contatos.csv \\
        --retornos retornos/ [--parcelas base/parcelas.csv] [--acoes acoes/acoes.csv --portal logs/portal.csv] \\
        [--data 2026-09-25] [--estado estado/] [--saida saida/]

Com os arquivos da empresa cliente (base bruta e ocorrências, ver empresas/):
    python rodar_dia.py --empresa empresas/exemplo.json --base-bruta bruto/ --ocorrencias ocorrencias/ \\
        --retornos retornos/ [--data ...] [--estado estado/] [--saida saida/]
    (a base bruta vira base/clientes.csv e base/contatos.csv ao lado de --estado)

1. Lê retornos dos fornecedores (layouts/), ocorrências da empresa, portal e parcelas.
2. Processa cada dia pendente até ontem: retornos do dia → TAG, acordos, tempo.
   O estado fica em --estado (estados.json) e a trilha é acrescentada em trilha.csv.
3. Gera para --data, em saida/AAAA-MM-DD/:
   ids/<canal>.csv       ID do cliente e contato a acionar hoje em cada canal (id_cliente;contato)
                         (<canal>_reserva.csv: só se o canal principal do dia não contatar)
   O que foi mandado acionar fica em --estado/escolhas.csv: é por ele que a ocorrência
   da empresa (que não traz o contato) é ligada ao número/e-mail usado.
   fila_do_dia.csv       detalhe completo (régua, passo, TAG, contato escolhido)
   enriquecimento.csv    quem mandar para o bureau · alertas.txt

Para usar o link rastreável, a fila completa pode ir para o disparar.py:
    python disparar.py --plano saida/2026-09-25/fila_do_dia.csv --ordem todas ...
"""
import argparse
import csv
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from motor.certificacao import certificar_contatos
from motor.entrada import Entrada, carregar_entrada, converter_base, ingerir_ocorrencias, salvar_escolhas
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


def exportar_ids(pasta: Path, por_canal: dict[str, list[dict]]) -> dict[str, list[str]]:
    """Um arquivo por canal com o ID do cliente e o contato a acionar hoje (id_cliente;contato).

    A ferramenta de cada canal recebe o contato que o MotorCob escolheu; no discador e no
    agente virtual o cliente pode ter várias linhas (um número por linha, na ordem de
    discagem). Linhas condicionais (ex.: discador de reserva para quem o agente virtual
    não contatou no dia) vão para um arquivo à parte.
    """
    pasta.mkdir(parents=True, exist_ok=True)
    for antigo in pasta.glob("*.csv"):  # reprocessar o dia não deixa arquivo velho
        antigo.unlink()
    arquivos = {}
    for canal, linhas in por_canal.items():
        for condicional in (False, True):
            pares, vistos = [], set()
            for l in sorted((l for l in linhas if bool(l["condicao"]) == condicional),
                            key=lambda l: (l["id_cliente"], int(l.get("ordem_contato") or 1))):
                if (l["id_cliente"], l["contato"]) not in vistos:
                    vistos.add((l["id_cliente"], l["contato"]))
                    pares.append((l["id_cliente"], l["contato"]))
            if not pares:
                continue
            nome = f"{canal}_reserva" if condicional else canal
            with open(pasta / f"{nome}.csv", "w", newline="", encoding="utf-8") as f:
                f.write("id_cliente;contato\n" + "".join(f"{i};{c}\n" for i, c in pares))
            arquivos[nome] = sorted({i for i, _ in pares})
    return arquivos


def preparar_base(entrada, pasta_bruta, pasta_base) -> dict:
    """Converte a base bruta da empresa (todos os arquivos da pasta) na base canônica."""
    ent = entrada if isinstance(entrada, Entrada) else carregar_entrada(entrada)
    from fnmatch import fnmatch
    arquivos = [p for p in sorted(Path(pasta_bruta).glob("*")) if p.is_file() and fnmatch(p.name, ent.base.arquivo)]
    if not arquivos:
        raise FileNotFoundError(f"nenhuma base bruta ({ent.base.arquivo}) em {pasta_bruta}")
    return converter_base(arquivos, ent.base, pasta_base)


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
              acoes=None, portal=None, pasta_estado="estado", pasta_saida="saida", regua_json=None, out=print,
              ocorrencias=None, entrada=None):
    regua = carregar_regua(regua_json) if regua_json else carregar_regua()
    clientes, rej_cli = carregar_clientes(clientes_csv)
    contatos, pessoa_de, _ = carregar_carteira(carteira_csv)
    eventos, relatorios, quarentena, sem_layout = ingerir_pasta(retornos, carregar_layouts(layouts))
    rel_ocorrencias = []
    if ocorrencias:
        ent = entrada if isinstance(entrada, Entrada) else carregar_entrada(entrada)
        ev, rel_ocorrencias, q, sl = ingerir_ocorrencias(ocorrencias, ent, pasta_estado)
        eventos += ev
        quarentena += q
        sem_layout += sl
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
    _salvar(saida / "fila_do_dia.csv", fila)  # completa: régua, passo, contato escolhido etc.
    por_canal = defaultdict(list)
    for l in fila:
        por_canal[l["canal"]].append(l)
    exportar_ids(saida / "ids", por_canal)
    salvar_escolhas(pasta_estado, hoje, fila)
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
    for r in rel_ocorrencias:
        out(f"  ocorrência {r.arquivo}: {r.aceitas}/{r.linhas} aceitas, contato identificado em "
            f"{r.contato_identificado}" + (f" · avisos {dict(r.avisos)}" if r.avisos else "")
            + (f" · rejeitadas {dict(r.rejeitadas)}" if r.rejeitadas else ""))
    out(f"  enriquecimento: {len(enriq)} clientes")
    for a in alertas:
        out(f"  ALERTA: {a}")
    out(f"  saídas em {saida}/ · estado em {pasta_estado}/")
    return {"estados": estados, "fila": fila, "enriquecimento": enriq, "alertas": alertas, "trilha": trilha,
            "saida": saida, "relatorios": relatorios, "relatorios_ocorrencia": rel_ocorrencias,
            "quarentena": quarentena, "sem_layout": sem_layout,
            "dias_processados": (hoje - inicio).days if inicio < hoje else 0}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clientes", help="id_cliente;data_entrada;saldo;dias_atraso[;bloqueio]")
    ap.add_argument("--carteira", help="id_cliente;contato;tipo[;origem;cpf;whatsapp_valido;atualizado_em]")
    ap.add_argument("--empresa", help="arquivo de entrada da empresa (empresas/<slug>.json)")
    ap.add_argument("--base-bruta", help="pasta com a base bruta da empresa (exige --empresa)")
    ap.add_argument("--ocorrencias", help="pasta com os arquivos de ocorrência da empresa (exige --empresa)")
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
    if (a.base_bruta or a.ocorrencias) and not a.empresa:
        ap.error("--base-bruta e --ocorrencias exigem --empresa")
    if a.base_bruta:
        base = Path(a.estado).parent / "base"
        rel = preparar_base(a.empresa, a.base_bruta, base)
        print(f"BASE BRUTA: {rel['clientes']} clientes, {rel['contatos']} contatos → {base}/")
        a.clientes, a.carteira = a.clientes or base / "clientes.csv", a.carteira or base / "contatos.csv"
    if not a.clientes or not a.carteira:
        ap.error("informe --clientes e --carteira, ou --empresa com --base-bruta")
    rodar_dia(a.clientes, a.carteira, a.retornos, a.data, a.layouts, a.parcelas, a.acoes, a.portal,
              a.estado, a.saida, a.regua, ocorrencias=a.ocorrencias, entrada=a.empresa)


if __name__ == "__main__":
    main()
