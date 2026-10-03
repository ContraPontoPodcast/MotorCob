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
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

from motor.certificacao import certificar_contatos
from motor.cluster import carregar_atributos, carregar_regras, colunas_usadas
from motor.entrada import (Entrada, aplicar_enriquecimento, carregar_entrada, carregar_escolhas, converter_base,
                           ingerir_ocorrencias, salvar_escolhas)
from motor.acoes import agregar as agregar_acoes, sem_ocorrencia, totais as totais_acoes
from motor.estrategia import validar_estrategia
from motor.persona import aprender, resumo as resumo_personas, sugerir
from motor.fila import gerar_fila, lista_enriquecimento
from motor.ingestao import carregar_carteira, carregar_clientes, carregar_layouts, carregar_parcelas, ingerir_pasta
from motor.marcacao import ESTADOS_MASSIVOS, EstadoCliente, processar_dia
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
    # a pasta só recebe carga do credor: o nome do arquivo não importa
    arquivos = [p for p in sorted(Path(pasta_bruta).glob("*")) if p.is_file() and not p.name.startswith(".")]
    if not arquivos:
        raise FileNotFoundError(f"nenhuma base bruta ({ent.base.arquivo}) em {pasta_bruta}")
    return converter_base(arquivos, ent.base, pasta_base)


def preparar_carteira(entrada, pasta) -> dict:
    """Carteira do credor (carga geral, incremental, retirada, acordo e baixa) -> <pasta>/base/."""
    from motor.carteira import montar
    ent = entrada if isinstance(entrada, Entrada) else carregar_entrada(entrada)
    return montar(pasta, ent)


def preparar_enriquecimento(entrada, pasta_enriq, pasta_base) -> dict | None:
    """Junta os retornos do bureau (todos os arquivos da pasta) em base/contatos.csv."""
    from fnmatch import fnmatch
    ent = entrada if isinstance(entrada, Entrada) else carregar_entrada(entrada)
    pasta_enriq = Path(pasta_enriq)
    if not ent.enriquecimento or not pasta_enriq.exists():
        return None
    rel = {"arquivos": [], "sem_layout": []}
    for arq in sorted(p for p in pasta_enriq.glob("*") if p.is_file() and not p.name.startswith(".")):
        lays = ent.enriquecimento if len(ent.enriquecimento) == 1 else \
            [l for l in ent.enriquecimento if fnmatch(arq.name, l.arquivo)]  # um layout só: nome não importa
        if len(lays) != 1:
            rel["sem_layout"].append(arq.name)
            continue
        r = aplicar_enriquecimento([arq], lays[0], pasta_base)
        rel["arquivos"] += [{**a, **{k: r[k] for k in ("sem_cliente", "telefones_novos", "telefones_atualizados",
                                                         "emails_novos")}} for a in r["arquivos"]]
    return rel


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
              ocorrencias=None, entrada=None, clusters=None, atributos=None, estrategias=None, canais=None,
              na_carga=None, compartilhado=None):
    """clusters: regras de cluster da empresa (lista de dicts da tabela `clusters` ou arquivo .json).
    atributos: base/atributos.csv (colunas da base bruta usadas pelas regras).
    na_carga: base/na_carga.csv — quem está na carga do dia (só esses recebem ação hoje).
              Padrão: o na_carga.csv ao lado de clientes_csv, se existir.
    estrategias: [{id, nome, definicao, padrao}] da tabela `estrategias` (ou .json).
    canais: [{canal, ativo, janela_inicio, janela_fim, sabado, capacidade_dia, custo, tentativas_dia,
             respeitar_nao_perturbe}] da tabela `canais_empresa` (ou .json).
    compartilhado: o que os OUTROS credores da empresa sabem da mesma pessoa (mesmo CPF):
             {"hot": {(pessoa, contato)}, "whatsapp": {contato}, "acionados": {pessoa: data}}.
             Hot e WhatsApp valem aqui; quem está em "acionados" com data nas últimas 48h não
             recebe ação massiva hoje (o rodízio entre credores entra aí também). O resultado
             traz r["compartilhar"] com hot, whatsapp, acionados e esperando (adiados hoje)."""
    regua = carregar_regua(regua_json) if regua_json else carregar_regua()
    avisos_cluster = []
    if clusters:
        linhas = json.loads(Path(clusters).read_text(encoding="utf-8")) if isinstance(clusters, (str, Path)) \
            else clusters
        regras, avisos_cluster = carregar_regras(linhas)
    else:
        regras = []
    est_validas, padrao = {}, None
    for e in _ler_lista(estrategias):
        override, erros = validar_estrategia(e.get("definicao") or {}, e.get("nome") or str(e.get("id")))
        if erros:
            avisos_cluster.append(f"estratégia '{e.get('nome')}' ignorada (vale o playbook padrão): "
                                  + "; ".join(erros[:3]))
            continue
        est_validas[e.get("id")] = override
        if e.get("padrao"):
            padrao = e.get("id")
    cfg_canais = {c["canal"]: c for c in _ler_lista(canais) if c.get("canal")}
    if regras or est_validas or cfg_canais:
        regua = regua.com_clusters(regras, est_validas, padrao, cfg_canais)
    clientes, rej_cli = carregar_clientes(clientes_csv)
    atrib = carregar_atributos(atributos)
    if atrib:
        clientes = {k: replace(c, atributos=atrib.get(k, {})) for k, c in clientes.items()}
    faltam = sorted(colunas_usadas(list(regua.clusters)) - {k for a in atrib.values() for k in a})
    if faltam:
        avisos_cluster.append(f"regras de cluster usam colunas que não estão na base: {faltam}")
    contatos, pessoa_de, _ = carregar_carteira(carteira_csv)
    eventos, relatorios, quarentena, sem_layout = ingerir_pasta(retornos, carregar_layouts(layouts))
    rel_ocorrencias = []
    if ocorrencias:
        ent = entrada if isinstance(entrada, Entrada) else carregar_entrada(entrada)
        ev, rel_ocorrencias, q, sl = ingerir_ocorrencias(ocorrencias, ent, pasta_estado)
        custos = {c.get("canal"): c.get("custo") for c in _ler_lista(canais) if c.get("custo") is not None}
        ev = [replace(e, custo=float(custos[e.canal])) if not e.custo and e.canal in custos else e for e in ev]
        eventos += ev
        quarentena += q
        sem_layout += sl
    if portal:
        eventos += ler_log_portal(portal, carregar_acoes(acoes))[0]
    parcelas = carregar_parcelas(parcelas_csv)[0] if parcelas_csv else {}
    flags = {c["contato"]: {"whatsapp_valido": c["whatsapp_valido"], "atualizado_em": c["atualizado_em"]}
             for c in contatos}
    sinais = {(c["id_cliente"], c["contato"]): {k: c.get(k) for k in ("rcs", "nao_perturbe", "score_bureau",
                                                                       "ranking", "pertence", "origem", "hot")}
              for c in contatos}
    compartilhado = compartilhado or {}
    hot_ext, wa_ext = compartilhado.get("hot") or set(), compartilhado.get("whatsapp") or set()
    for c in contatos:
        if c["contato"] in wa_ext and c["tipo"] == "telefone":
            flags[c["contato"]]["whatsapp_valido"] = True
        if (pessoa_de.get(c["id_cliente"]), c["contato"]) in hot_ext:
            sinais[(c["id_cliente"], c["contato"])]["hot"] = True
    atualizados = {}
    for c in contatos:
        if c["atualizado_em"] and c["atualizado_em"] > atualizados.get(c["id_cliente"], date.min):
            atualizados[c["id_cliente"]] = c["atualizado_em"]
    contatos_por = defaultdict(list)
    dados_contatos = defaultdict(list)
    for c in contatos:
        contatos_por[c["id_cliente"]].append(c["contato"])
        dados_contatos[c["id_cliente"]].append(c)
    # características derivadas dos contatos: valem para regras de segmento e para as personas
    for k, c in list(clientes.items()):
        tels = [x for x in dados_contatos.get(k, []) if x["tipo"] == "telefone"]
        if tels:
            extra = {"ddd": tels[0]["contato"][:2],
                     "tem_whatsapp": "sim" if any(x["whatsapp_valido"] for x in tels) else "não",
                     "tem_rcs": "sim" if any(x.get("rcs") for x in tels) else "não"}
            clientes[k] = replace(c, atributos={**extra, **(c.atributos or {})})
    por_dia = defaultdict(list)
    for e in eventos:
        por_dia[e.data].append(e)

    pasta_estado = Path(pasta_estado)
    estados, ultimo = carregar_estado(pasta_estado)
    inicio = (ultimo + timedelta(days=1)) if ultimo else min(c.data_entrada for c in clientes.values())
    # o que o motor exportou em cada dia (sem as reservas condicionais): base da rotação de contatos
    enviados_dia = defaultdict(lambda: defaultdict(list))
    for (d, idc), ls in carregar_escolhas(pasta_estado).items():
        for l in sorted(ls, key=lambda l: int(l.get("ordem_contato") or 1)):
            if str(l.get("reserva")) != "1" and l["contato"] not in enviados_dia[d][idc]:
                enviados_dia[d][idc].append(l["contato"])
    trilha = []
    dia = inicio
    while dia < hoje:
        ev_ate = [e for e in eventos if e.data <= dia]
        certs = certificar_contatos(ev_ate, dia, contatos, pessoa_de)
        _, disp, _ = gerar_fila(estados, clientes, certs, flags, parcelas, dia, regua, ev_ate, sinais)
        trilha += processar_dia(estados, clientes, por_dia.get(dia, []), parcelas, dia, regua, disp,
                                baixas_ate=dia, atualizados=atualizados, enviados=enviados_dia.get(dia.isoformat()))
        dia += timedelta(days=1)
    ultimo = max(ultimo or hoje - timedelta(days=1), hoje - timedelta(days=1))
    salvar_estado(pasta_estado, estados, ultimo)
    _salvar(pasta_estado / "trilha.csv", trilha, anexar=True)

    ev_ate = [e for e in eventos if e.data < hoje]
    certs = certificar_contatos(ev_ate, hoje, contatos, pessoa_de)
    # personas: aprendidas com o histórico até ontem; escolhem o canal das etiquetas persona_1/2
    custos = {c["canal"]: c.get("custo") for c in _ler_lista(canais) if c.get("custo") is not None}
    modelo = aprender(ev_ate, clientes, regua, hoje, dados_contatos, custos)
    regua = replace(regua, persona=modelo, _cache={})
    arq_carga = Path(na_carga) if na_carga else Path(clientes_csv).parent / "na_carga.csv"
    ativos = None
    if arq_carga.exists():
        ativos = {l.strip() for l in arq_carga.read_text(encoding="utf-8").splitlines()[1:] if l.strip()}
    recencia = timedelta(hours=regua["recencia_horas"])
    pausados = {idc for idc, p in pessoa_de.items()
                if (d := (compartilhado.get("acionados") or {}).get(p)) and hoje - d < recencia}
    adiados = set()
    fila, _, alertas = gerar_fila(estados, clientes, certs, flags, parcelas, hoje, regua, ev_ate, sinais, ativos,
                                  pausados=pausados, adiados=adiados)
    if adiados:
        alertas.append(f"OUTRO CREDOR: {len(adiados)} clientes ficam sem ação massiva hoje (outro credor acionou "
                       f"nas últimas {regua['recencia_horas']}h ou é a vez dele); voltam na próxima")
    contatos_status = _contar_contatos(certs, sinais, flags, estados, ativos)
    alertas = [f"CLUSTER: {a}" for a in avisos_cluster] + alertas
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
    # ações realizadas (agregado, sem dado pessoal): últimos DIAS_ACOES dias
    acoes = agregar_acoes(carregar_escolhas(pasta_estado), eventos, regua, custos,
                          desde=hoje - timedelta(days=DIAS_ACOES))
    if ocorrencias:
        alertas += sem_ocorrencia(acoes, _dia_util_anterior(hoje, regua))
    (saida / "acoes.json").write_text(json.dumps(acoes, ensure_ascii=False), encoding="utf-8")
    personas = resumo_personas(modelo, ativos)
    nomes_estr = {e.get("id"): e.get("nome") for e in _ler_lista(estrategias)}

    def primeiro_passo(idc):
        est = estados.get(idc)
        if est is None:
            return (None, 0, None)
        passos = regua.para(est.cluster_atual)["localizacao"]["passos"]
        if not passos:
            return (None, 0, None)
        d = min(passos, key=int)
        a = passos[d][0]
        return (regua.estrategia_de(est.cluster_atual), int(d), a if isinstance(a, str) else a.get("canal"))

    sugestoes = sugerir(modelo, primeiro_passo, ativos)
    for s in sugestoes:
        s["estrategia_nome"] = nomes_estr.get(s["estrategia_base"]) or "Playbook MotorCob"
    (saida / "personas.json").write_text(json.dumps({"caracteristicas": modelo.colunas, "personas": personas},
                                                    ensure_ascii=False, indent=1), encoding="utf-8")
    (saida / "sugestoes.json").write_text(json.dumps(sugestoes, ensure_ascii=False, indent=1), encoding="utf-8")
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
    if regua.clusters:
        por_cluster = defaultdict(int)
        for e in estados.values():
            por_cluster[e.cluster_atual] += 1
        out("  clusters: " + " · ".join(f"{k} {v}" for k, v in sorted(por_cluster.items())))
    if ativos is not None:
        out(f"  na carga de hoje: {len(ativos)} clientes")
    if contatos_status:
        out("  contatos: " + " · ".join(f"{k} {contatos_status[k]}" for k in
                                        ("HOT", "WHATSAPP", "RCS", "NEUTRO", "INVALIDO") if contatos_status.get(k)))
    ontem = [l for l in acoes if l["data"] == (hoje - timedelta(days=1)).isoformat()]
    if ontem:
        t = totais_acoes(ontem)
        out(f"  ações de ontem: {t['enviadas']} enviadas · {t['com_retorno']} com retorno · {t['cpcs']} CPC"
            + (f" · R$ {t['custo']:.2f}" if t["custo"] else ""))
    out(f"  enriquecimento: {len(enriq)} clientes")
    for a in alertas:
        out(f"  ALERTA: {a}")
    out(f"  saídas em {saida}/ · estado em {pasta_estado}/")
    compartilhar = {
        "hot": {(pessoa_de[k], e.contato_localizador) for k, e in estados.items()
                if e.contato_localizador and k in pessoa_de},
        "whatsapp": {c for c, f in flags.items() if f.get("whatsapp_valido")},
        "acionados": {pessoa_de[l["id_cliente"]]: hoje for l in fila
                      if l["id_cliente"] in pessoa_de and not l["condicao"] and l["estado"] in ESTADOS_MASSIVOS},
        # quem este credor queria acionar hoje e ficou de fora: na próxima, é a vez dele
        "esperando": {pessoa_de[i]: hoje for i in adiados if i in pessoa_de}}
    return {"estados": estados, "clientes": clientes, "fila": fila, "acoes": acoes, "compartilhar": compartilhar, "personas": personas, "sugestoes": sugestoes,
            "caracteristicas_persona": modelo.colunas,
            "na_carga": len(ativos) if ativos is not None else None, "contatos_status": contatos_status, "enriquecimento": enriq, "alertas": alertas, "trilha": trilha,
            "saida": saida, "relatorios": relatorios, "relatorios_ocorrencia": rel_ocorrencias,
            "quarentena": quarentena, "sem_layout": sem_layout,
            "dias_processados": (hoje - inicio).days if inicio < hoje else 0}


DIAS_ACOES = 60


def _dia_util_anterior(hoje: date, regua) -> date:
    """Último dia antes de hoje em que houve janela de ações (pula domingo e feriado)."""
    d = hoje - timedelta(days=1)
    for _ in range(7):
        if regua.janela(d) is not None:
            return d
        d -= timedelta(days=1)
    return hoje - timedelta(days=1)


def _contar_contatos(certs, sinais, flags, estados, ativos) -> dict:
    """Contatos dos clientes na carga por status: HOT · WHATSAPP · RCS · NEUTRO · INVALIDO."""
    from motor.fila import status_contato
    cont = defaultdict(int)
    for (idc, contato), c in certs.items():
        if ativos is not None and idc not in ativos:
            continue
        cont[status_contato(c, sinais.get((idc, contato), {}), flags.get(contato, {}), estados.get(idc))] += 1
    return dict(cont)


def _ler_lista(v) -> list[dict]:
    if not v:
        return []
    return json.loads(Path(v).read_text(encoding="utf-8")) if isinstance(v, (str, Path)) else list(v)


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
    ap.add_argument("--clusters", help="regras de cluster da empresa (.json, lista como a tabela clusters)")
    ap.add_argument("--estrategias", help="estratégias da empresa (.json, lista como a tabela estrategias)")
    ap.add_argument("--canais", help="limites dos canais da empresa (.json, lista como a tabela canais_empresa)")
    ap.add_argument("--enriquecimento", help="pasta com os retornos do bureau (exige --empresa)")
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
        a.atributos = base / "atributos.csv"
        if a.enriquecimento:
            rel_e = preparar_enriquecimento(a.empresa, a.enriquecimento, base)
            if rel_e:
                print(f"ENRIQUECIMENTO: {rel_e}")
    if not a.clientes or not a.carteira:
        ap.error("informe --clientes e --carteira, ou --empresa com --base-bruta")
    rodar_dia(a.clientes, a.carteira, a.retornos, a.data, a.layouts, a.parcelas, a.acoes, a.portal,
              a.estado, a.saida, a.regua, ocorrencias=a.ocorrencias, entrada=a.empresa, clusters=a.clusters,
              atributos=getattr(a, "atributos", None), estrategias=a.estrategias, canais=a.canais)


if __name__ == "__main__":
    main()
