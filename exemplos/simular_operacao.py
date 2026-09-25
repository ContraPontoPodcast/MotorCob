"""Simulação da operação dia a dia seguindo o playbook, com verdade conhecida.

Todo dia: clientes entram na carteira → o motor gera a fila do dia (régua +
certificação) → a fila é "executada" contra a verdade simulada → os retornos
atualizam a TAG e a trilha → acordos geram parcelas que são pagas, atrasadas
ou quebradas.

Uso (na raiz): python exemplos/simular_operacao.py [--dias 45] [--clientes 400]
Saídas em exemplos/operacao/: trilha.csv, estados.csv, fila_ultimo_dia.csv,
enriquecimento_ultimo_dia.csv e comite/ (KPIs e Real x Previsto em Excel).
"""
import argparse
import csv
import random
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import demo  # noqa: E402
from motor.acordos import Parcela  # noqa: E402
from motor.certificacao import Evento, certificar_contatos  # noqa: E402
from motor.fila import gerar_fila, lista_enriquecimento  # noqa: E402
from motor.marcacao import Cliente, processar_dia  # noqa: E402
from motor.regua import CANAIS_VOZ, carregar_regua  # noqa: E402

INICIO = date(2026, 8, 3)
# P(contato | é o titular) por tentativa, antes da propensão do cliente.
# Calibrado para reproduzir a ordem de eficiência do playbook (WA > RCS > voz > SMS).
BASE = {"whatsapp": 0.30, "rcs": 0.15, "agente_voz": 0.10, "discador": 0.08, "sms": 0.03, "email": 0.03}


def gerar_clientes(rng, n):
    _, contatos = demo.gerar_carteira(rng, n_historico=0, n_novos=n)
    clientes, props = {}, {}
    for i in range(n):
        idc = f"C{i:07d}"
        faixa = rng.random()
        saldo = rng.uniform(5000, 30000) if faixa < 0.25 else rng.uniform(1000, 4999) if faixa < 0.65 \
            else rng.uniform(100, 999)
        r = rng.random()
        atraso = rng.randint(1, 90) if r < 0.5 else rng.randint(91, 180) if r < 0.75 else rng.randint(181, 720)
        entrada = INICIO + timedelta(days=rng.randint(0, 29))
        clientes[idc] = Cliente(idc, entrada, round(saldo, 2), atraso,
                                "opt-out geral" if rng.random() < 0.01 else None)
        props[idc] = rng.uniform(0.3, 1.7)
    for c in contatos:  # enriquecimento: "WhatsApp válido" acerta na maioria das vezes
        c["whatsapp_valido"] = rng.random() < (0.85 if c["whatsapp"] else 0.10)
        c["atualizado_em"] = clientes[c["id_cliente"]].data_entrada
    return clientes, contatos, props


def simular_resultado(rng, canal, c, prop):
    r = rng.random
    p = min(0.95, BASE[canal] * prop)
    if canal in CANAIS_VOZ:
        if not c["existe"]:
            return "numero_inexistente"
        if c["titular"]:
            if r() < p:
                return "cpc" if canal == "discador" else "identidade_confirmada"
            return "atendida_sem_cpc" if r() < 0.3 else "nao_atendida"
        x = r()
        return "atendida_terceiro_desconhece" if x < 0.2 else "atendida_sem_cpc" if x < 0.3 else "nao_atendida"
    if canal == "whatsapp":
        if not c["whatsapp"]:
            return "sem_conta"
        if c["titular"]:
            if r() < p:
                return "resposta" if r() < 0.8 else "clique_link"
            return "bloqueio" if r() < 0.01 else "lido" if r() < 0.5 else "entregue"
        x = r()
        return "desconhece" if x < 0.03 else "bloqueio" if x < 0.06 else "lido" if x < 0.4 else "entregue"
    if canal in ("rcs", "sms"):
        if not c["existe"]:
            return "nao_entregue"
        if c["titular"] and r() < p:
            return ("interacao" if r() < 0.7 else "clique_link") if canal == "rcs" else "clique_link"
        return "lido" if canal == "rcs" and r() < 0.3 else "entregue"
    if not c["existe"]:
        return "hard_bounce"
    if c["titular"] and r() < p:
        return "clique"
    return "abertura" if r() < 0.2 else "entregue"


def criar_acordo(rng, cli, dia, seq):
    n = rng.choice([1, 3, 6, 10])
    valor = round(cli.saldo * 0.6 / n, 2)
    perfil = rng.random()  # 70% paga em dia, 15% paga atrasado, 15% quebra
    ps, quebrou = [], False
    for k in range(n):
        venc = dia + timedelta(days=rng.randint(5, 10) + 30 * k)
        if quebrou:
            pago = None
        elif perfil < 0.70 or rng.random() < 0.85:
            pago = venc - timedelta(days=rng.randint(0, 3))
        elif perfil < 0.85:
            pago = venc + timedelta(days=rng.randint(1, 5))
        else:
            pago, quebrou = None, True
        ps.append(Parcela(cli.id_cliente, f"AC{seq:05d}", k + 1, venc, valor, pago))
    return ps


def simular(seed=7, dias=45, n_clientes=400, pasta=RAIZ / "exemplos" / "operacao", verbose=True):
    out = print if verbose else (lambda *a, **k: None)
    rng = random.Random(seed)
    regua = carregar_regua()
    clientes, contatos, props = gerar_clientes(rng, n_clientes)
    verdade = {(c["id_cliente"], c["contato"]): c for c in contatos}
    flags = {c["contato"]: {"whatsapp_valido": c["whatsapp_valido"], "atualizado_em": c["atualizado_em"]}
             for c in contatos}
    por_cliente_contatos = defaultdict(list)
    for c in contatos:
        por_cliente_contatos[c["id_cliente"]].append(c["contato"])

    estados, eventos, trilha, parcelas = {}, [], [], defaultdict(list)
    execucoes = []   # (dia, id_cliente, canal, massiva?, cluster na hora) — para auditar as regras
    alertas_dias, seq_ev, seq_ac = [], 0, 0
    fila = enriq = []
    certs = {}
    for dia in (INICIO + timedelta(days=k) for k in range(dias)):
        ativos = {k: v for k, v in clientes.items() if v.data_entrada <= dia}
        contatos_ativos = [c for c in contatos if c["id_cliente"] in ativos]
        certs = certificar_contatos(eventos, dia, contatos_ativos)
        fila, disp, alertas = gerar_fila(estados, clientes, certs, flags, parcelas, dia, regua, eventos)
        enriq = lista_enriquecimento(estados, flags, por_cliente_contatos, dia, regua)
        if alertas:
            alertas_dias.append((dia, alertas))

        evs_dia, contato_no_dia = [], set()
        for linha in sorted(fila, key=lambda l: l["condicao"] != ""):  # reserva por último
            idc = linha["id_cliente"]
            if linha["condicao"] and idc in contato_no_dia:
                continue
            c = verdade[(idc, linha["contato"])]
            res = simular_resultado(rng, linha["canal"], c, props[idc])
            seq_ev += 1
            evs_dia.append(Evento(idc, linha["contato"], c["tipo"], linha["canal"], res, dia,
                                  demo.CUSTOS[linha["canal"]], fornecedor="sim", id_externo=str(seq_ev)))
            execucoes.append((dia, idc, linha["canal"], not linha["data_fixa"], linha["tag"].split("-")[1]))
            if regua.e_contato(linha["canal"], res):
                contato_no_dia.add(idc)
        # negociação: parte dos contatos com o cliente vira acordo
        for idc in sorted(contato_no_dia):
            est = estados[idc]
            if est.estado in ("LOC", "CPA", "CPB", "NCP") and rng.random() < 0.3:
                seq_ac += 1
                parcelas[idc] += criar_acordo(rng, clientes[idc], dia, seq_ac)
        eventos += evs_dia
        certs = certificar_contatos(eventos, dia, contatos_ativos)
        trilha += processar_dia(estados, clientes, evs_dia, parcelas, dia, regua, disp, baixas_ate=dia)

    pasta.mkdir(parents=True, exist_ok=True)
    _salvar(pasta / "trilha.csv", trilha)
    _salvar(pasta / "estados.csv", [{"id_cliente": k, "tag": e.tag, **{x: y for x, y in e.para_json().items()
                                     if x in ("estado", "cluster_origem", "cluster_atual", "reenriquecer")}}
                                    for k, e in estados.items()])
    _salvar(pasta / "fila_ultimo_dia.csv", fila)
    _salvar(pasta / "enriquecimento_ultimo_dia.csv", enriq)

    m = _metricas(regua, clientes, estados, eventos, trilha, parcelas, verdade, execucoes, alertas_dias)
    _relatorio(out, m, trilha, dias)
    m["dados"] = {"clientes": clientes, "estados": estados, "trilha": trilha, "eventos": eventos,
                  "parcelas": dict(parcelas), "certs": certs, "regua": regua,
                  "inicio": INICIO, "fim": INICIO + timedelta(days=dias - 1)}
    return m


def _metricas(regua, clientes, estados, eventos, trilha, parcelas, verdade, execucoes, alertas_dias):
    m = {"estados": Counter(e.estado for e in estados.values()), "clientes": len(estados)}
    hr = defaultdict(lambda: [0, 0, 0.0])
    for e in eventos:
        h = hr[e.canal]
        h[0] += 1
        h[1] += regua.e_contato(e.canal, e.resultado)
        h[2] += e.custo
    m["hit_rate"] = {c: (v[1] / v[0], v[0], v[1], v[2]) for c, v in hr.items()}
    primeiro_cpa = {}
    for t in trilha:
        if "-CPA-" in t["tag"] and t["id_cliente"] not in primeiro_cpa:
            primeiro_cpa[t["id_cliente"]] = t
    m["localizados"] = len(primeiro_cpa)
    m["localizados_por_canal"] = Counter(t["tag"].split("-")[3] for t in primeiro_cpa.values())
    custo_total = sum(e.custo for e in eventos)
    m["custo_total"] = custo_total
    m["custo_por_cpc_descoberto"] = custo_total / len(primeiro_cpa) if primeiro_cpa else None
    locs = [e for e in estados.values() if e.contato_localizador]
    m["localizador_correto"] = (sum(verdade[(e.id_cliente, e.contato_localizador)]["titular"] for e in locs)
                                / len(locs)) if locs else None
    wa = [e for e in eventos if e.canal == "whatsapp" and e.resultado != "sem_conta"]
    m["whatsapp_envios"] = len(wa)
    m["whatsapp_bloqueios"] = sum(e.resultado in ("bloqueio", "desconhece") for e in wa)
    m["dias_freio_whatsapp"] = sum(any("FREIO" in a for a in al) for _, al in alertas_dias)
    todas = [p for ps in parcelas.values() for p in ps]
    m["acordos"] = len({p.id_acordo for p in todas})
    m["quebras"] = sum(1 for t in trilha if "QBR" in t["tag"] and "QBR" not in t["tag_anterior"])
    m["volta_estoque"] = sum(1 for t in trilha if "volta ao estoque" in t["motivo"])
    m["liquidados"] = m["estados"]["LIQ"]
    # auditoria das regras do playbook
    massivas = defaultdict(list)
    for dia, idc, canal, massiva, _ in execucoes:
        if massiva:
            massivas[idc].append(dia)
    m["violacoes_48h"] = sum(1 for ds in massivas.values() for a, b in zip(sorted(set(ds)), sorted(set(ds))[1:])
                             if (b - a).days < 2)
    m["acoes_domingo_feriado"] = sum(1 for dia, *_ in execucoes if regua.janela(dia) is None)
    m["voz_em_b3"] = sum(1 for _, _, canal, _, cluster in execucoes if canal in CANAIS_VOZ and cluster == "B3")
    m["acoes_em_bloqueados"] = sum(1 for _, idc, *_ in execucoes if clientes[idc].bloqueio)
    return m


def _relatorio(out, m, trilha, dias):
    out(f"OPERAÇÃO SIMULADA: {m['clientes']} clientes, {dias} dias\n")
    out("ESTADOS NO ÚLTIMO DIA")
    for e in ("LOC", "CPA", "CPB", "NCP", "PRE", "COL", "QBR", "LIQ", "BLQ"):
        out(f"  {e}: {m['estados'][e]}")
    out("\nRETORNO POR CANAL (contato por tentativa, pela definição da régua)")
    for c, (taxa, n, k, custo) in sorted(m["hit_rate"].items(), key=lambda kv: -kv[1][0]):
        out(f"  {c:<11} {n:>5} tentativas | {k:>4} contatos | {taxa:>5.1%} | custo R$ {custo:,.2f}")
    out(f"\nLOCALIZAÇÃO\n  clientes localizados (chegaram a CPC A): {m['localizados']} de {m['clientes']}"
        f" | por canal: {dict(m['localizados_por_canal'])}\n"
        f"  custo por CPC descoberto: R$ {m['custo_por_cpc_descoberto']:.2f}\n"
        f"  contato localizador é mesmo do cliente: {m['localizador_correto']:.0%}")
    out(f"\nWHATSAPP\n  envios: {m['whatsapp_envios']} | bloqueio/pessoa errada: {m['whatsapp_bloqueios']}"
        f" ({m['whatsapp_bloqueios'] / max(m['whatsapp_envios'], 1):.1%}) | dias com freio: {m['dias_freio_whatsapp']}")
    out(f"\nACORDOS\n  acordos: {m['acordos']} | entradas em quebra: {m['quebras']} | "
        f"voltaram ao estoque (D+6): {m['volta_estoque']} | liquidados: {m['liquidados']}")
    out(f"\nAUDITORIA DAS REGRAS\n  violações de 48h: {m['violacoes_48h']} | ações em domingo/feriado: "
        f"{m['acoes_domingo_feriado']} | voz em cluster B3: {m['voz_em_b3']} | "
        f"ações em bloqueados: {m['acoes_em_bloqueados']}")
    por = defaultdict(list)
    for t in trilha:
        por[t["id_cliente"]].append(t)
    exemplo = max(por.values(), key=lambda ts: len({t["tag"].split("-")[2] for t in ts}))
    out(f"\nEXTRATO DE UM CLIENTE ({exemplo[0]['id_cliente']})")
    for t in exemplo:
        out(f"  {t['data'][8:]}/{t['data'][5:7]}  {t['tag']:<24} {t['motivo']:<55} {t['quem_marcou']}")


def _salvar(caminho, linhas):
    if not linhas:
        return
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()))
        w.writeheader()
        w.writerows(linhas)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=45)
    ap.add_argument("--clientes", type=int, default=400)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--sem-relatorio", action="store_true", help="não gera o relatório do comitê")
    a = ap.parse_args()
    m = simular(a.seed, a.dias, a.clientes)
    if not a.sem_relatorio:
        import relatorio
        d = m["dados"]
        print()
        relatorio.montar(d["clientes"], d["estados"], d["trilha"], d["eventos"], d["parcelas"], d["regua"],
                         d["inicio"], d["fim"], RAIZ / "exemplos" / "operacao" / "comite", d["certs"])
