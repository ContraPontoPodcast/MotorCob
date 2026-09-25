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
- cluster B3: só canais digitais; domingo e feriado: sem ações.
"""
from collections import defaultdict
from datetime import date, timedelta

from .certificacao import Certificacao, Evento
from .marcacao import Cliente, EstadoCliente, proximo_canal
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


def contatos_elegiveis(est: EstadoCliente, cluster: str, certs: list[Certificacao], flags: dict[str, dict],
                       regua: Regua, freio_whatsapp: bool) -> dict[str, list[str]]:
    """{canal: contatos em ordem de prioridade} para o cliente."""
    so_digital = regua.enriquecimento(cluster).get("so_digital", False)
    validos = sorted((c for c in certs if c.status not in FORA), key=lambda c: -c.score)
    loc = est.contato_localizador
    w = regua["whatsapp"]
    saida = {}
    for canal in regua["canais"]:
        if so_digital and canal in CANAIS_VOZ:
            continue
        tipo = "email" if canal == "email" else "telefone"
        cands = [c for c in validos if c.tipo == tipo and not any(r.startswith(canal + ":") for r in c.restricoes)]
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
        contatos = [c.contato for c in cands]
        if loc in contatos:  # o contato que localizou o cliente vem primeiro
            contatos.remove(loc)
            contatos.insert(0, loc)
        if canal in CANAIS_VOZ:
            pass  # discador/agente: todos os números válidos, em ordem de score
        elif est.estado in ("CPA", "CPB", "PRE", "QBR"):
            contatos = contatos[:1]
        else:
            contatos = contatos[:1 if canal == "whatsapp" else regua["localizacao"]["numeros_digitais"]]
        if contatos:
            saida[canal] = contatos
    return saida


def _canais_do_passo(canais: list[str], eleg: dict, regua: Regua) -> list[tuple[str, str]]:
    """Expande um passo da régua: substitutos, acompanhantes e reserva. [(canal, condição)]"""
    out = []
    for canal in canais:
        if canal not in eleg and canal in regua["substituto"]:
            canal = regua["substituto"][canal]
        if canal in eleg:
            out.append((canal, ""))
        elif canal in regua["reserva"] and regua["reserva"][canal] in eleg:
            out.append((regua["reserva"][canal], ""))
            continue
        else:
            continue
        for extra in regua["acompanha"].get(canal, []):
            if extra in eleg:
                out.append((extra, ""))
        if canal in regua["reserva"] and regua["reserva"][canal] in eleg:
            out.append((regua["reserva"][canal], f"se {canal} sem contato no dia"))
    return out


def gerar_fila(estados: dict[str, EstadoCliente], clientes: dict[str, Cliente],
               certs: dict[tuple[str, str], Certificacao], flags: dict[str, dict],
               parcelas: dict, hoje: date, regua: Regua, eventos: list[Evento] | None = None):
    """Retorna (fila, disponiveis, alertas).

    fila: linhas (cliente x canal x contato) para subir nos fornecedores hoje.
    disponiveis: {id_cliente: canais com contato elegível} (usado na rotação).
    flags: {contato: {"whatsapp_valido": bool, "atualizado_em": date|None}} do enriquecimento.
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

    fila, disponiveis = [], {}
    prioridade = {e: i + 1 for i, e in enumerate(regua["hierarquia"])}
    for idc, est in estados.items():
        eleg = contatos_elegiveis(est, est.cluster_atual, certs_por.get(idc, []), flags, regua, freio)
        disponiveis[idc] = set(eleg)
        if janela is None or est.estado in ("BLQ", "LIQ", "COL"):
            continue
        passo = _passo_do_dia(est, clientes.get(idc), hoje, regua, eleg, parcelas.get(idc, []))
        if passo is None:
            continue
        nome_regua, rotulo, canais, data_fixa = passo
        for canal, condicao in _canais_do_passo(canais, eleg, regua):
            for ordem, contato in enumerate(eleg[canal], 1):
                fila.append({
                    "data": hoje.isoformat(), "id_cliente": idc, "tag": est.tag, "estado": est.estado,
                    "prioridade": prioridade.get(est.estado, 9), "regua": nome_regua, "passo": rotulo,
                    "canal": canal, "contato": contato, "ordem_contato": ordem,
                    "condicao": condicao, "data_fixa": data_fixa,
                    "spins_max": regua["spins_discador_dia"] if canal == "discador" else "",
                    "janela": f"{janela[0]}-{janela[1]}",
                })
    fila.sort(key=lambda l: (l["prioridade"], l["id_cliente"], l["ordem_contato"]))
    return fila, disponiveis, alertas


def _recencia_ok(est: EstadoCliente, hoje: date, regua: Regua) -> bool:
    return est.ultima_massiva is None or (hoje - est.ultima_massiva).days * 24 >= regua["recencia_horas"]


def _passo_do_dia(est, cliente, hoje, regua, eleg, parcelas):
    """(régua, rótulo do passo, canais, data_fixa) ou None."""
    if est.estado == "QBR":
        d = int(est.ciclo[1:]) if est.ciclo.startswith("D") else -1
        canais = regua["quebra"]["passos"].get(str(d))
        return ("quebra", f"D+{d}", canais, True) if canais else None
    if est.estado == "PRE":
        d = 0 if est.ciclo == "D0" else int(est.ciclo[2:])
        canais = list(regua["preventivo"]["passos"].get(str(d), []))
        if d == 0 and cliente and est.cluster_atual[0] in regua["preventivo"]["voz_d0_tickets"]:
            canais.append(regua["preventivo"]["voz_d0_canal"])
        return ("preventivo", "D0" if d == 0 else f"D-{d}", canais, True) if canais else None
    if not _recencia_ok(est, hoje, regua):
        return None
    if est.estado == "LOC":
        d = (hoje - est.safra).days
        canais = regua["localizacao"]["passos"].get(str(d))
        return ("localizacao", f"D+{d}", canais, False) if canais else None
    if est.estado == "NCP":
        if est.giro_pausado or not est.giro_inicio or hoje < est.giro_inicio:
            return None
        dias = (hoje - est.giro_inicio).days
        n, dia_ciclo = dias // regua["giro"]["ciclo_dias"] + 1, dias % regua["giro"]["ciclo_dias"] + 1
        canais = regua["giro"]["passos"].get(str(dia_ciclo))
        return ("giro", f"G{n}-dia{dia_ciclo}", canais, False) if canais else None
    if est.estado == "CPA":
        canal = est.canal_atual if est.canal_atual in eleg else proximo_canal(est, regua, set(eleg))
        return ("cpc", "CPC A · negociação", [canal], False) if canal else None
    if est.estado == "CPB":
        if est.tentativas < regua["tentativas_por_canal"] and est.canal_atual in eleg:
            return ("cpc", f"CPC B · T{est.tentativas + 1}", [est.canal_atual], False)
        canal = proximo_canal(est, regua, set(eleg))
        return ("cpc", f"rotação → {canal}", [canal], False) if canal else None
    return None


def lista_enriquecimento(estados: dict[str, EstadoCliente], flags: dict[str, dict], certs_contatos: dict[str, list[str]],
                         hoje: date, regua: Regua) -> list[dict]:
    """Quem precisa de enriquecimento hoje: entrada (D0), revalidação vencida ou re-enriquecimento."""
    saida = []
    for idc, est in estados.items():
        if est.estado in ("BLQ", "LIQ"):
            continue
        cfg = regua.enriquecimento(est.cluster_atual)
        motivo = None
        if est.estado == "LOC" and est.safra == hoje:
            motivo = "entrada na carteira (D0)"
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
