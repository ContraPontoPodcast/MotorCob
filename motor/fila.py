"""Fila do dia: quem aciona hoje, em qual régua, por qual canal e em qual contato.

A régua (regras/regua.json) decide QUANDO e POR QUAL canal. O motor de
certificação decide EM QUAL contato e trava o WhatsApp onde há risco de
banimento. Regras aplicadas:

- hierarquia: Quebra > Preventivo/Colchão > CPC > localização/giro (um estado por
  cliente; COL suspende as ações massivas);
- recência de 48h entre ações massivas (réguas de data fixa são isentas);
- 1 ação massiva por cliente por dia; 3 tentativas por canal; discador até 3 spins/dia;
- localização D+1 WA · D+3 RCS · D+5 agente virtual (discador de reserva) · D+7 SMS+e-mail;
- giro de 8 dias com os mesmos passos, até 3 ciclos;
- WhatsApp para contato não certificado: só 1 número, com "WhatsApp válido" do
  enriquecimento, e com freio automático se a taxa de bloqueio passar do limite;
- cluster B3 (ou cluster da empresa marcado "só digital"): sem voz; canais bloqueados
  pelo cluster da empresa ficam fora; domingo e feriado: sem ações.
"""
from collections import defaultdict
from datetime import date, timedelta

from .certificacao import Certificacao, Evento
from .marcacao import ESTADOS_MASSIVOS, Cliente, EstadoCliente, dia_na_carga, dias_de_esteira, proximo_canal
from .estrategia import ENRIQUECIMENTO, SEM_ACAO, normalizar, passa, raia, resolver
from .persona import resolver_tokens
from . import normalizacao as norm
from .regua import CANAIS_VOZ, Regua

FORA = {"INVALIDO", "CONTESTADO"}
DIGITAIS_TELEFONE = ("whatsapp", "rcs", "sms")


def taxa_bloqueio_whatsapp(eventos: list[Evento], hoje: date, regua: Regua) -> tuple[float, int]:
    """(taxa de bloqueio/pessoa errada, envios) do WhatsApp na janela recente."""
    w = regua["whatsapp"]
    inicio = hoje - timedelta(days=w["janela_taxa_dias"])
    envios = [e for e in eventos if e.canal == "whatsapp" and inicio <= e.data < hoje and e.resultado != "sem_conta"]
    ruins = sum(e.resultado in ("bloqueio", "desconhece") for e in envios)
    return (ruins / len(envios) if envios else 0.0), len(envios)


def _num(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _passa_prioridade(regra: dict, sinal: dict) -> bool:
    """Filtro da regra do usuário: score mínimo / ranking máximo (sem dado do bureau: passa)."""
    score, ranking = _num(sinal.get("score_bureau")), _num(sinal.get("ranking"))
    if regra.get("score_minimo") is not None and score is not None and score < regra["score_minimo"]:
        return False
    if regra.get("ranking_maximo") is not None and ranking is not None and ranking > regra["ranking_maximo"]:
        return False
    return True


def _chave_prioridade(regra: dict, sinal: dict, flag: dict) -> tuple:
    """Ordem da regra do usuário (ex.: ranking menor primeiro, depois score maior). Sem o dado: vai depois."""
    chave = []
    for c in regra.get("criterios") or []:
        campo = c["campo"]
        if campo == "score":
            v = _num(sinal.get("score_bureau"))
        elif campo == "ranking":
            v = _num(sinal.get("ranking"))
        elif campo == "whatsapp":
            v = 1.0 if flag.get("whatsapp_valido") else 0.0
        elif campo == "rcs":
            v = 1.0 if sinal.get("rcs") else 0.0
        else:   # bureau: veio do retorno do enriquecimento
            v = 1.0 if (sinal.get("origem") or "") == "enriquecimento" else 0.0
        if v is None:
            chave += [1, 0.0]
        else:
            chave += [0, v if c["sentido"] == "asc" else -v]
    return tuple(chave)


def candidatos(est: EstadoCliente, cluster: str, certs: list[Certificacao], flags: dict[str, dict],
               regua: Regua, freio_whatsapp: bool, sinais: dict[str, dict] | None = None) -> dict[str, list]:
    """{canal: Certificacoes que podem receber, em ordem de prioridade}, antes do filtro da ação.

    Aplica as travas que nenhuma estratégia desliga: contato inválido/contestado/"não pertence",
    restrição do canal (opt-out, sem conta…), canal bloqueado pelo cluster ou desligado na
    empresa, Não Perturbe na voz (se a empresa respeitar) e a trava do WhatsApp.
    """
    sinais = sinais or {}
    bloqueados = regua.canais_bloqueados(cluster)
    validos = [c for c in certs if c.status not in FORA and sinais.get(c.contato, {}).get("pertence") != "nao"]
    # Hot (deu CPC ou marcado na carga) primeiro. Sem Hot, rotação: contato ainda não exportado
    # antes, depois os já tentados do mais antigo para o mais recente. Depois score e ranking.
    tent = {c: i + 1 for i, c in enumerate(est.contatos_tentados)} if not est.contato_localizador else {}
    regra = regua.dados.get("prioridade_contatos") or {}
    if regra:
        validos = [c for c in validos if _passa_prioridade(regra, sinais.get(c.contato, {}))]
    validos.sort(key=lambda c: (not (c.status == "CERTIFICADO" or sinais.get(c.contato, {}).get("hot")),
                                tent.get(c.contato, 0),
                                *_chave_prioridade(regra, sinais.get(c.contato, {}), flags.get(c.contato, {})),
                                -c.score, sinais.get(c.contato, {}).get("ranking") or 99))
    loc = est.contato_localizador
    w = regua["whatsapp"]
    saida = {}
    for canal in regua["canais"]:
        cfg = regua.canal_cfg(canal)
        if canal in bloqueados or cfg.get("ativo") is False:
            continue
        tipo = "email" if canal == "email" else "telefone"
        cands = [c for c in validos if c.tipo == tipo and not any(r.startswith(canal + ":") for r in c.restricoes)]
        if canal in ("sms", "rcs"):        # SMS e RCS só em celular (fixo não recebe)
            cands = [c for c in cands if norm.celular(c.contato)]
        elif canal == "whatsapp":          # WhatsApp em fixo só se o número tiver WhatsApp marcado
            cands = [c for c in cands if norm.celular(c.contato) or flags.get(c.contato, {}).get("whatsapp_valido")]
        respeitar = cfg.get("respeitar_nao_perturbe")
        if canal in CANAIS_VOZ if respeitar is None else respeitar:
            cands = [c for c in cands if not sinais.get(c.contato, {}).get("nao_perturbe")]
        if canal == "whatsapp":
            ok = []
            for c in cands:
                confiavel = c.status == "CERTIFICADO" or c.score >= w["limiar_score"] or c.contato == loc
                valido = flags.get(c.contato, {}).get("whatsapp_valido") or not w["exige_whatsapp_valido"]
                if confiavel:
                    ok.append(c)
                elif valido and not freio_whatsapp and \
                        sum(1 for x in ok if not (x.status == "CERTIFICADO" or x.score >= w["limiar_score"]
                                                  or x.contato == loc)) < w["numeros_nao_certificados"]:
                    ok.append(c)
            cands = ok
        primeiro = [c for c in cands if c.contato == loc]  # o contato que localizou o cliente vem primeiro
        cands = primeiro + [c for c in cands if c.contato != loc]
        if cands:
            saida[canal] = cands
    return saida


def status_contato(cert, sinal: dict, flag: dict, est: EstadoCliente | None = None) -> str:
    """Rótulo da operação: HOT · WHATSAPP · RCS · NEUTRO · INVALIDO."""
    if cert is not None and cert.status in FORA or sinal.get("pertence") == "nao":
        return "INVALIDO"
    if (cert is not None and cert.status == "CERTIFICADO") or sinal.get("hot") \
            or (est is not None and cert is not None and cert.contato == est.contato_localizador):
        return "HOT"
    if flag.get("whatsapp_valido"):
        return "WHATSAPP"
    if sinal.get("rcs"):
        return "RCS"
    return "NEUTRO"


def _limite_padrao(canal: str, est: EstadoCliente, regua: Regua) -> int | None:
    if canal in CANAIS_VOZ:
        # 1 número por cliente: o CPC da ocorrência marca exatamente esse número como Hot
        return regua["localizacao"].get("numeros_voz") or None
    if est.estado in ("CPA", "CPB", "PRE", "QBR"):
        return 1
    return 1 if canal == "whatsapp" else regua["localizacao"]["numeros_digitais"]


def contatos_da_acao(acao: dict, cands: dict[str, list], est: EstadoCliente, flags: dict[str, dict],
                     sinais: dict[str, dict], regua: Regua) -> list[str]:
    """Contatos que recebem a ação: candidatos do canal que passam no filtro, até o limite."""
    lista = [c.contato for c in cands.get(acao["canal"], [])
             if passa(acao.get("contatos") or {}, c, sinais.get(c.contato, {}), flags.get(c.contato, {}))]
    if est.estado in ("CPA", "CPB") and not est.contato_localizador and est.candidatos_hot:
        # descoberta do Hot: um candidato por vez, mesmo com "todos os números"
        cand = [c for c in est.candidatos_hot if c in lista]
        if cand:
            return cand[:1]
    limite = acao.get("numeros") or regua.canal_cfg(acao["canal"]).get("numeros_por_cliente") \
        or _limite_padrao(acao["canal"], est, regua)
    return lista[:limite] if limite else lista


NOME_CANAL = {"whatsapp": "WhatsApp", "rcs": "RCS", "sms": "SMS", "email": "E-mail",
              "agente_voz": "Agente virtual", "discador": "Discador"}


def por_que_sem_contato(canais: list[str], cands: dict, certs: list[Certificacao], flags: dict[str, dict],
                        regua: Regua, cluster: str) -> str:
    """Por que nenhum canal do dia tem contato para o cliente, canal a canal (texto curto)."""
    validos = [c for c in certs if c.status not in FORA]
    fones = [c for c in validos if c.tipo == "telefone"]
    partes = []
    for canal in dict.fromkeys(c for c in canais if c in NOME_CANAL):
        cfg = regua.canal_cfg(canal)
        if canal in regua.canais_bloqueados(cluster) or cfg.get("ativo") is False:
            motivo = "canal desligado ou bloqueado no segmento"
        elif canal in cands:
            motivo = "nenhum contato passa no filtro da ação"
        elif canal == "email":
            motivo = "sem e-mail"
        elif not fones:
            motivo = "sem telefone válido"
        elif canal in ("sms", "rcs") and not any(norm.celular(c.contato) for c in fones):
            motivo = "só telefone fixo (precisa de celular)"
        elif canal == "whatsapp" and not any(flags.get(c.contato, {}).get("whatsapp_valido") for c in fones):
            motivo = "nenhum número marcado com WhatsApp (na carga ou no retorno do bureau)"
        else:
            motivo = "contatos sem condição para o canal (Não Perturbe, opt-out ou trava)"
        partes.append(f"{NOME_CANAL[canal]}: {motivo}")
    return "; ".join(partes) or "sem contato"


def contatos_elegiveis(est: EstadoCliente, cluster: str, certs: list[Certificacao], flags: dict[str, dict],
                       regua: Regua, freio_whatsapp: bool, sinais: dict[str, dict] | None = None
                       ) -> dict[str, list[str]]:
    """{canal: contatos em ordem de prioridade} para o cliente, com o limite padrão de cada canal."""
    cands = candidatos(est, cluster, certs, flags, regua, freio_whatsapp, sinais)
    saida = {}
    for canal in cands:
        cs = contatos_da_acao({"canal": canal, "contatos": {}}, cands, est, flags, sinais or {}, regua)
        if cs:
            saida[canal] = cs
    return saida


def _disponiveis_cpc(cands, est, flags, sinais, regua) -> set[str]:
    """Canais em que o cliente tem contato para a régua de CPC (com o filtro da estratégia)."""
    acoes = regua.dados.get("cpc_acoes") or {}
    if acoes:  # a estratégia define a ordem de CPC: esses canais e sempre o canal em que o cliente deu CPC
        cands = {c: v for c, v in cands.items() if c in acoes or c == est.canal_atual}
    return {c for c in cands
            if contatos_da_acao(acoes.get(c) or {"canal": c, "contatos": {}}, cands, est, flags, sinais, regua)}


def gerar_fila(estados: dict[str, EstadoCliente], clientes: dict[str, Cliente],
               certs: dict[tuple[str, str], Certificacao], flags: dict[str, dict],
               parcelas: dict, hoje: date, regua: Regua, eventos: list[Evento] | None = None,
               sinais: dict[tuple[str, str], dict] | None = None, ativos: set[str] | None = None,
               pausados: set[str] = frozenset(), adiados: set | None = None, publico: dict | None = None,
               para_bureau: dict | None = None, motivos: dict | None = None, motivo_de: dict | None = None,
               detalhe_de: dict | None = None):
    """Retorna (fila, disponiveis, alertas).

    fila: linhas (cliente x canal x contato) para subir nos fornecedores hoje.
    disponiveis: {id_cliente: canais com contato elegível} (usado na rotação).
    flags: {contato: {"whatsapp_valido": bool, "atualizado_em": date|None}} do enriquecimento.
    sinais: {(id_cliente, contato): {"pertence", "rcs", "nao_perturbe", "score_bureau", "ranking",
             "origem"}} da base e do retorno do enriquecimento.
    Cada cliente segue a estratégia do cluster dele (regua.para).
    ativos: quem está na carga do dia (None = todos); os demais não recebem ação.
    publico: {id_cliente: id da persona criada pela empresa}; ação com "personas" só vai para elas.
    para_bureau: recebe {id_cliente: "régua passo"} de quem tem a ação "enriquecimento" hoje na esteira.
    motivos: recebe {motivo: clientes} — com ação ou por que ficou sem ação hoje (MOTIVOS).
    motivo_de: recebe {id_cliente: motivo}; detalhe_de: {id_cliente: por que ficou sem contato}.
    pausados: acionados por outro credor nas últimas 48h (ou é a vez dele) — sem ação massiva
              hoje (acordo segue). Quem tinha ação hoje e ficou de fora vai para `adiados`.
    """
    alertas = []
    taxa, envios = taxa_bloqueio_whatsapp(eventos or [], hoje, regua)
    w = regua["whatsapp"]
    freio = envios >= w["minimo_envios_para_freio"] and taxa > w["limite_taxa_bloqueio"]
    if freio:
        alertas.append(f"FREIO WHATSAPP: taxa de bloqueio {taxa:.1%} em {envios} envios > "
                       f"{w['limite_taxa_bloqueio']:.0%}; WhatsApp só para contatos certificados")
    janela = regua.janela(hoje)
    if janela is None:
        alertas.append(f"{hoje:%d/%m/%Y} é domingo ou feriado: sem ações")

    certs_por = defaultdict(list)
    for (idc, _), c in certs.items():
        certs_por[idc].append(c)
    sinais_por = defaultdict(dict)
    for (idc, contato), s in (sinais or {}).items():
        sinais_por[idc][contato] = s

    fila, disponiveis = [], {}
    sem_contato = defaultdict(int)
    prioridade = {e: i + 1 for i, e in enumerate(regua["hierarquia"])}
    for idc, est in estados.items():
        rc = regua.para(est.cluster_atual)
        sin = sinais_por.get(idc, {})
        cands = candidatos(est, est.cluster_atual, certs_por.get(idc, []), flags, rc, freio, sin)
        disp = _disponiveis_cpc(cands, est, flags, sin, rc)
        disponiveis[idc] = disp
        def conta(m, idc=idc):
            if motivos is not None:
                motivos[m] = motivos.get(m, 0) + 1
            if motivo_de is not None:
                motivo_de[idc] = m
        if est.estado in ("BLQ", "LIQ", "COL"):
            conta("encerrado")
            continue
        if ativos is not None and idc not in ativos:
            conta("fora_da_carga")
            continue
        if janela is None:
            conta("domingo_feriado")
            continue
        passo = _passo_do_dia(est, clientes.get(idc), hoje, rc, disp)
        if passo is None:
            conta("sem_passo_hoje")
            continue
        nome_regua, rotulo, acoes, data_fixa = passo
        minha = (publico or {}).get(idc)
        propria, geral = raia(acoes, minha)
        # raia da persona no dia: só ela vale; se a persona não tiver contato para nenhum canal
        # dela, segue o público geral (a não ser que a raia diga "sem ação")
        tentativas = [propria, geral] if propria else [geral]
        if any(a["canal"] == SEM_ACAO for a in propria):
            tentativas = [[a for a in propria if a["canal"] != SEM_ACAO]]
        blend, tinha = [], False
        for lista in tentativas:
            enriq = [a for a in lista if a["canal"] == ENRIQUECIMENTO]
            lista = [a for a in lista if a["canal"] != ENRIQUECIMENTO]
            if enriq and para_bureau is not None:
                para_bureau[idc] = f"esteira {nome_regua} {rotulo}"
            if not lista:
                if enriq:
                    break
                continue
            tinha = True
            lista, persona_rot = resolver_tokens(lista, rc.persona, idc, hoje, set(cands))
            blend = resolver(lista, lambda a: contatos_da_acao(a, cands, est, flags, sin, rc))
            if blend:
                break
        if not tinha:
            conta("bureau_hoje" if idc in (para_bureau or {}) else "sem_acao_na_raia")
            continue
        if not blend:
            sem_contato[nome_regua] += 1
            conta("sem_contato")
            if detalhe_de is not None:
                detalhe_de[idc] = por_que_sem_contato([a["canal"] for t in tentativas for a in t], cands,
                                                      certs_por.get(idc, []), flags, rc, est.cluster_atual)
            continue
        if blend and idc in pausados and est.estado in ESTADOS_MASSIVOS:
            if adiados is not None:
                adiados.add(idc)
            conta("outro_credor")
            continue
        conta("com_acao")
        cert_de = {c.contato: c for cs in cands.values() for c in cs}
        for canal, condicao, contatos in blend:
            cfg = rc.canal_cfg(canal)
            if hoje.weekday() == 5 and cfg.get("sabado") is False:
                continue
            jan = janela
            if cfg.get("janela_inicio") and cfg.get("janela_fim"):  # nunca amplia a janela geral
                jan = (max(janela[0], cfg["janela_inicio"]), min(janela[1], cfg["janela_fim"]))
            for ordem, contato in enumerate(contatos, 1):
                fila.append({
                    "data": hoje.isoformat(), "id_cliente": idc, "tag": est.tag, "estado": est.estado,
                    "cluster": est.cluster_atual, "prioridade": prioridade.get(est.estado, 9), "regua": nome_regua, "passo": rotulo,
                    "canal": canal, "contato": contato, "ordem_contato": ordem,
                    "status_contato": status_contato(cert_de.get(contato), sin.get(contato, {}),
                                                     flags.get(contato, {}), est),
                    "condicao": condicao, "data_fixa": data_fixa,
                    "spins_max": cfg.get("tentativas_dia") or (rc["spins_discador_dia"] if canal == "discador" else ""),
                    "janela": f"{jan[0]}-{jan[1]}",
                    "persona": persona_rot,
                })
    if sum(sem_contato.values()):
        alertas.append(f"SEM CONTATO PARA O PASSO DE HOJE: {sum(sem_contato.values())} clientes tinham ação hoje "
                       f"({', '.join(f'{k} {v}' for k, v in sorted(sem_contato.items()))}), mas nenhum contato "
                       "serve para o canal (ex.: WhatsApp só vai para número com WhatsApp). Ponha um 'senão' "
                       "(SMS, agente virtual ou discador) nesse dia da esteira, ou envie a base ao bureau.")
    fila.sort(key=lambda l: (l["prioridade"], l["id_cliente"], l["ordem_contato"]))
    fila = _aplicar_capacidade(fila, clientes, regua, alertas)
    return fila, disponiveis, alertas


def _aplicar_capacidade(fila, clientes, regua, alertas):
    """Capacidade diária do canal: entram primeiro os de maior prioridade e, empatados, maior saldo."""
    limites = {c: cfg.get("capacidade_dia") for c, cfg in regua.canais_cfg.items() if cfg.get("capacidade_dia")}
    if not limites:
        return fila
    ordem = {}
    for l in fila:
        c = clientes.get(l["id_cliente"])
        ordem.setdefault((l["canal"], l["id_cliente"]), (l["prioridade"], -(c.saldo if c else 0), l["id_cliente"]))
    manter = set()
    for canal, limite in limites.items():
        ids = sorted({i for (c, i) in ordem if c == canal}, key=lambda i: ordem[(canal, i)])
        manter |= {(canal, i) for i in ids[:limite]}
        if len(ids) > limite:
            alertas.append(f"CAPACIDADE {canal}: {len(ids) - limite} clientes ficaram fora hoje (limite {limite})")
    return [l for l in fila if l["canal"] not in limites or (l["canal"], l["id_cliente"]) in manter]


def _recencia_ok(est: EstadoCliente, hoje: date, regua: Regua) -> bool:
    return est.ultima_massiva is None or (hoje - est.ultima_massiva).days * 24 >= regua["recencia_horas"]


MOTIVOS = {
    "com_acao": "com ação hoje",
    "sem_passo_hoje": "a esteira não tem passo hoje (ex.: D+2)",
    "sem_contato": "sem contato para os canais do dia",
    "sem_acao_na_raia": "persona com 'sem ação' hoje",
    "bureau_hoje": "só enriquecimento hoje",
    "outro_credor": "acionados por outra carteira nas últimas 48h",
    "demais_desligado": "Demais clientes desligado",
    "fora_da_carga": "fora da carga (retirados/quitados)",
    "encerrado": "bloqueados, liquidados ou em cobrança encerrada",
    "domingo_feriado": "domingo ou feriado",
}


def previsao(estados: dict, clientes: dict, hoje: date, regua: Regua, ativos=None, dias: int = 7,
             fora: set = frozenset()) -> list[dict]:
    """Próximos dias com quantos clientes a esteira aciona em cada um (estimativa: sem contar os
    retornos de hoje em diante nem a checagem de contato)."""
    from dataclasses import replace as _replace
    proximo_util = next((hoje + timedelta(days=n) for n in range(1, 15)
                         if regua.janela(hoje + timedelta(days=n)) is not None), None)
    # quem ainda não começou a esteira começa na próxima lista
    estados = {k: (_replace(e, esteira_pendente=False, inicio_esteira=proximo_util) if e.esteira_pendente else e)
               for k, e in estados.items()}
    saida = []
    for n in range(1, dias + 1):
        d = hoje + timedelta(days=n)
        if regua.janela(d) is None:
            saida.append({"data": d.isoformat(), "clientes": 0, "passos": {}, "sem_acoes": "domingo ou feriado"})
            continue
        passos = defaultdict(int)
        for idc, est in estados.items():
            if est.estado in ("BLQ", "LIQ", "COL") or idc in fora or (ativos is not None and idc not in ativos):
                continue
            if est.estado in ("CPA", "CPB"):
                continue    # CPC segue o canal do contato: depende do retorno do dia
            rc = regua.para(est.cluster_atual)
            p = _passo_do_dia(est, clientes.get(idc), d, rc, set())
            if p and any(a["canal"] != SEM_ACAO for a in p[2]):
                passos[f"{p[0]} {p[1]}"] += 1
        saida.append({"data": d.isoformat(), "clientes": sum(passos.values()), "passos": dict(passos)})
    return saida


def _passo_do_dia(est, cliente, hoje, regua, disp):
    """(régua, rótulo do passo, ações, data_fixa) ou None. regua já é a do cluster (estratégia)."""
    def acoes(passo):
        return normalizar(passo, regua)

    if est.estado == "QBR":
        d = int(est.ciclo[1:]) if est.ciclo.startswith("D") else -1
        passo = regua["quebra"]["passos"].get(str(d))
        return ("quebra", f"D+{d}", acoes(passo), True) if passo else None
    if est.estado == "PRE":
        d = 0 if est.ciclo == "D0" else int(est.ciclo[2:])
        passo = list(regua["preventivo"]["passos"].get(str(d), []))
        if d == 0 and cliente and regua.voz_d0(est.cluster_atual):
            passo.append(regua["preventivo"]["voz_d0_canal"])
        return ("preventivo", "D0" if d == 0 else f"D-{d}", acoes(passo), True) if passo else None
    if not _recencia_ok(est, hoje, regua):
        return None
    if est.estado == "LOC":
        d = dia_na_carga(est, hoje, regua)      # o dia da 1ª lista é o D+1; só anda em dia de lista
        passo = regua["localizacao"]["passos"].get(str(d))
        return ("localizacao", f"D+{d}", acoes(passo), False) if passo else None
    if est.estado == "NCP":
        if est.giro_pausado or not est.giro_inicio or hoje < est.giro_inicio:
            return None
        dias = dias_de_esteira(regua, est.giro_inicio, hoje) - 1
        n, dia_ciclo = dias // regua["giro"]["ciclo_dias"] + 1, dias % regua["giro"]["ciclo_dias"] + 1
        passo = regua["giro"]["passos"].get(str(dia_ciclo))
        return ("giro", f"G{n}-dia{dia_ciclo}", acoes(passo), False) if passo else None
    if est.estado in ("CPA", "CPB"):
        if est.estado == "CPA":
            canal = est.canal_atual if est.canal_atual in disp else proximo_canal(est, regua, disp)
            rotulo = "CPC A · negociação"
        elif est.tentativas < regua["tentativas_por_canal"] and est.canal_atual in disp:
            canal, rotulo = est.canal_atual, f"CPC B · T{est.tentativas + 1}"
        else:
            canal = proximo_canal(est, regua, disp)
            rotulo = f"rotação → {canal}"
        if not canal:
            return None
        acao = (regua.dados.get("cpc_acoes") or {}).get(canal)
        junto = list(regua.dados.get("cpc_junto") or [])
        passo = []
        for a in ([acao] if acao else acoes([canal])):   # o reforço (junto) acompanha o canal que for
            passo.append(a)
            if isinstance(a, dict) and a.get("modo") in ("sempre", "senao"):
                passo += junto
        return ("cpc", rotulo, passo, False)
    return None


def esteira_tem_enriquecimento(rc: Regua) -> bool:
    """A esteira (estratégia do segmento) programa o enriquecimento em algum dia?"""
    for fase in ("localizacao", "giro", "preventivo", "quebra"):
        for passo in ((rc.dados.get(fase) or {}).get("passos") or {}).values():
            if any((a if isinstance(a, str) else a.get("canal")) == ENRIQUECIMENTO for a in passo):
                return True
    return False


def lista_enriquecimento(estados: dict[str, EstadoCliente], flags: dict[str, dict], certs_contatos: dict[str, list[str]],
                         hoje: date, regua: Regua, programados: dict | None = None) -> list[dict]:
    """Quem vai para o bureau hoje: o dia que a esteira programou (programados) ou, se a esteira
    não programa enriquecimento, a entrada na carga; mais revalidação vencida e re-enriquecimento."""
    saida = []
    programados = programados or {}
    for idc, est in estados.items():
        if est.estado in ("BLQ", "LIQ"):
            continue
        cfg = regua.enriquecimento(est.cluster_atual)
        motivo = None
        if idc in programados:
            motivo = programados[idc]
        elif (est.estado == "LOC" and not est.esteira_pendente and dia_na_carga(est, hoje, regua) == 1
              and not esteira_tem_enriquecimento(regua.para(est.cluster_atual))):   # no D+1 de fato
            motivo = "entrada na carteira (D+1)"
        elif est.reenriquecer:
            motivo = est.reenriquecer
        else:
            datas = [flags.get(c, {}).get("atualizado_em") for c in certs_contatos.get(idc, [])]
            datas = [d for d in datas if d]
            if datas and cfg.get("revalida_dias") and (hoje - max(datas)).days >= cfg["revalida_dias"]:
                motivo = f"revalidação ({cfg['revalida_dias']} dias)"
        if motivo:
            saida.append({"data": hoje.isoformat(), "id_cliente": idc, "tag": est.tag,
                          "cluster": est.cluster_atual, "pacote": cfg["pacote"], "motivo": motivo})
    return saida
