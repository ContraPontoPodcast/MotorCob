"""MotorCli — motor da frente de Jornada do Cliente.

Mesma plataforma do MotorCob, outra pergunta: em vez de "em que estado da cobrança o cliente
está", "em que momento da relação ele está hoje". Momentos (regras/jornada.json):
boas-vindas, ativação, pré-vencimento, retenção e reativação. Para cada cliente, no máximo
uma ação por dia, no momento mais alto da hierarquia que tem um passo devido.

Reaproveita do MotorCob: a janela e o calendário (regua.janela), a certificação dos contatos
(o telefone Hot sai primeiro, o inválido e o descadastrado ficam de fora), as restrições do
retorno de canal e da mensageria, a recência entre ações e o formato da Lista do dia
(ids/<canal>.csv), que a Mensageria já sabe transformar em lote.

Cliente em atraso não é do MotorCli: fica com a cobrança (MotorCob) e sai com o motivo.

Base de clientes (id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;
ultima_atividade[;dias_atraso][;bloqueio]): datas em AAAA-MM-DD ou DD/MM/AAAA; vencimento_pago
e ativado em sim/não (vazio = não informado). Vários contratos do mesmo cliente: a contratação
mais recente, o vencimento em aberto mais próximo, a atividade mais recente, o maior atraso.
"""
from __future__ import annotations

import copy
import csv
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from . import etapas as ET
from . import travas as TV
from . import normalizacao as norm
from .ingestao import _data

PADRAO = Path(__file__).resolve().parent.parent / "regras" / "jornada.json"
CANAIS = ("whatsapp", "rcs", "agente_voz", "discador", "sms", "email")
MOMENTOS = ("boas_vindas", "ativacao", "pre_vencimento", "retencao", "reativacao")
CODIGO = {"boas_vindas": "BV", "ativacao": "AT", "pre_vencimento": "PV", "retencao": "RT", "reativacao": "RA"}
STATUS_FORA = {"CONTESTADO"}          # certificação: contato que não é do cliente

# motivos de quem fica fora da Lista do dia (a tela agrupa por eles)
M_BLOQUEIO = "bloqueado (opt-out, óbito ou judicial)"
M_ATRASO = "em atraso: fica com a cobrança (MotorCob)"
M_SEM_MOMENTO = "nenhum momento da jornada hoje"
M_FEITO = "passo do momento já feito; aguarda o próximo"
M_RECENCIA = "recência entre ações"
M_SEM_CONTATO = "sem contato elegível nos canais do passo"
M_DIA = "dia sem ação (calendário)"
M_ETAPA_SEM_PASSO = "em uma etapa da empresa, sem passo hoje"
M_FORA = "saiu da régua pela regra de uma etapa da empresa"
M_LEAD_SEM_ETAPA = "lead fora das condições das etapas de prospecção"
M_ORCAMENTO = "ficou fora do orçamento do canal na etapa (concorre de novo amanhã)"
M_LIMITE = "atingiu o limite de ações por cliente (trava da estratégia)"


class JornadaInvalida(ValueError):
    pass


# ------------------------------------------------------------------ regras
def validar(d: dict) -> dict:
    """Confere e normaliza as regras (chaves dos passos viram int). Erro: JornadaInvalida."""
    erros = []
    momentos = d.get("momentos") or {}
    for m in d.get("hierarquia") or []:
        if m not in momentos:
            erros.append(f"hierarquia cita momento inexistente: {m}")
    for m, cfg in momentos.items():
        if m not in MOMENTOS:
            erros.append(f"momento desconhecido: {m}")
            continue
        de, ate = cfg.get("de"), cfg.get("ate")
        if not isinstance(de, int) or not isinstance(ate, int) or de > ate:
            erros.append(f"{m}: faixa de dias inválida ({de}..{ate})")
            continue
        passos = {}
        for k, acoes in (cfg.get("passos") or {}).items():
            try:
                dia = int(k)
            except (TypeError, ValueError):
                erros.append(f"{m}: passo {k!r} não é um dia")
                continue
            if not de <= dia <= ate:
                erros.append(f"{m}: passo {dia} fora da faixa {de}..{ate}")
            if not isinstance(acoes, list) or not acoes:
                erros.append(f"{m}: passo {dia} sem ações")
                continue
            for a in acoes:
                canal = a.get("canal")
                if canal == "melhor":
                    if not a.get("opcoes") or set(a["opcoes"]) - set(CANAIS):
                        erros.append(f"{m}: passo {dia} com 'melhor' sem opções válidas")
                elif canal not in CANAIS:
                    erros.append(f"{m}: passo {dia} com canal inválido {canal!r}")
                if a.get("senao") and a["senao"] not in CANAIS:
                    erros.append(f"{m}: passo {dia} com 'senão' inválido {a['senao']!r}")
            passos[dia] = acoes
        cfg["passos"] = passos
    if not isinstance(d.get("recencia_horas", 48), int) or d.get("recencia_horas", 48) < 0:
        erros.append("recencia_horas inválida")
    if erros:
        raise JornadaInvalida("; ".join(erros))
    return d


def aplicar_estrategia(base: dict, definicao: dict | None) -> dict:
    """Estratégia do site (estrategias.definicao da frente MotorCli) por cima das regras padrão:
    {recencia_horas?, momentos: {momento: {ativo?, passos?}}}. A faixa de dias é do padrão."""
    d = copy.deepcopy(base)
    if not definicao:
        return d
    if isinstance(definicao.get("recencia_horas"), int):
        d["recencia_horas"] = definicao["recencia_horas"]
    if "etapas" in definicao:     # etapas da empresa (prospecção e outras): motor/etapas.py
        etapas, ordem, avisos = ET.validar(definicao, "cli", "jornada", ET.acoes_da_estrategia)
        d["etapas"], d["ordem_etapas"], d["avisos_etapas"] = etapas, ordem, avisos
    if "travas" in definicao:     # travas configuráveis (motor/travas.py), dentro das faixas de segurança
        from .travas import ler as ler_travas
        tv, avisos = ler_travas(definicao, "cli", "jornada")
        d["avisos_etapas"] = (d.get("avisos_etapas") or []) + avisos
        if "recencia_horas" in tv:
            d["recencia_horas"] = tv["recencia_horas"]
        if "recencia_pre_vencimento" in tv:        # pré-vencimento: "não espera" (padrão) ou respeita
            isentos = [m for m in d.get("isentos_recencia") or [] if m != "pre_vencimento"]
            d["isentos_recencia"] = isentos if tv["recencia_pre_vencimento"] else isentos + ["pre_vencimento"]
        for k in ("limite_acoes", "limite_leads_semana", "travas_janela"):
            if k in tv:
                d[k] = tv[k]
    for m, cfg in (definicao.get("momentos") or {}).items():
        if m not in d["momentos"] or not isinstance(cfg, dict):
            continue
        if "ativo" in cfg:
            d["momentos"][m]["ativo"] = bool(cfg["ativo"])
        if isinstance(cfg.get("passos"), dict) and cfg["passos"]:
            d["momentos"][m]["passos"] = cfg["passos"]
    return validar(d)


def carregar_jornada(caminho: str | Path = PADRAO, definicao: dict | None = None) -> dict:
    d = validar(json.loads(Path(caminho).read_text(encoding="utf-8")))
    return aplicar_estrategia(d, definicao) if definicao else d


# ------------------------------------------------------------------ base de clientes
@dataclass
class ClienteJornada:
    id_cliente: str
    contratacao: date | None = None
    vencimento: date | None = None
    pago: bool = False
    ativado: bool | None = None
    ultima_atividade: date | None = None
    dias_atraso: int = 0
    bloqueio: str | None = None
    atributos: dict = field(default_factory=dict)   # demais colunas da carga (para as etapas da empresa)


COLUNAS_JORNADA = {"id_cliente", "data_contratacao", "proximo_vencimento", "vencimento_pago", "ativado",
                   "ultima_atividade", "dias_atraso", "bloqueio"}


def _simnao(v) -> bool | None:
    v = (v or "").strip().lower()
    if v in ("sim", "s", "1", "true", "verdadeiro", "yes", "y"):
        return True
    if v in ("nao", "não", "n", "0", "false", "falso", "no"):
        return False
    return None


def carregar_clientes_jornada(caminho: str | Path) -> tuple[dict[str, ClienteJornada], Counter]:
    clientes, rejeitados = {}, Counter()
    with open(caminho, newline="", encoding="utf-8") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            idc = norm.id_cliente(linha.get("id_cliente"))
            if idc is None:
                rejeitados["id_cliente ausente ou inválido"] += 1
                continue
            try:
                contr = _data(linha.get("data_contratacao"))
                venc = _data(linha.get("proximo_vencimento"))
                ativ = _data(linha.get("ultima_atividade"))
                atraso = int((linha.get("dias_atraso") or "0").strip() or 0)
            except ValueError:
                rejeitados["linha com data ou atraso inválido"] += 1
                continue
            pago = _simnao(linha.get("vencimento_pago")) is True
            c = clientes.setdefault(idc, ClienteJornada(idc))
            if contr and (c.contratacao is None or contr > c.contratacao):
                c.contratacao = contr
            if venc and not pago and (c.vencimento is None or c.pago or venc < c.vencimento):
                c.vencimento, c.pago = venc, False
            elif venc and pago and c.vencimento is None:
                c.vencimento, c.pago = venc, True
            a = _simnao(linha.get("ativado"))
            if a is not None:
                c.ativado = bool(c.ativado) or a
            if ativ and (c.ultima_atividade is None or ativ > c.ultima_atividade):
                c.ultima_atividade = ativ
            c.dias_atraso = max(c.dias_atraso, atraso)
            c.bloqueio = c.bloqueio or ((linha.get("bloqueio") or "").strip() or None)
            for k, v in linha.items():
                if k and k not in COLUNAS_JORNADA and (v or "").strip():
                    c.atributos.setdefault(k.strip(), v.strip())
    return clientes, rejeitados


# ------------------------------------------------------------------ leads (prospecção)
BASES_LEGAIS = {"consentimento": "consentimento", "legitimo_interesse": "legitimo_interesse",
                "legitimo interesse": "legitimo_interesse", "legítimo interesse": "legitimo_interesse",
                "legítimo_interesse": "legitimo_interesse"}
COLUNAS_LEAD = {"id_lead", "id_cliente", "data_entrada", "origem", "base_legal", "telefone", "email", "whatsapp",
                "bloqueio", "cpf", "nome"}


@dataclass
class Lead:
    """Quem ainda não é cliente. Só entra com base legal (LGPD art. 7º: consentimento ou legítimo interesse) e
    a origem registradas; quem pede para sair vai para a lista de bloqueio e não volta."""
    id_cliente: str
    entrada: date
    origem: str
    base_legal: str
    bloqueio: str | None = None
    atributos: dict = field(default_factory=dict)


def carregar_leads(caminho: str | Path) -> tuple[dict[str, Lead], list[dict], set, Counter]:
    """leads.csv (id_lead;data_entrada;origem;base_legal;telefone;email[;whatsapp][;bloqueio][;outras colunas])
    -> (leads, contatos, whatsapp confirmados, rejeitados). O id do lead é o que ele terá na carga de clientes
    quando contratar (é assim que o motor sabe que ele virou cliente); CPF vira código, nunca é guardado."""
    leads, contatos, wa, rej = {}, [], set(), Counter()
    with open(caminho, newline="", encoding="utf-8-sig") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            linha = {(k or "").strip().lower(): v for k, v in linha.items()}
            idc = norm.id_cliente(linha.get("id_lead") or linha.get("id_cliente"))
            if idc is None:
                rej["lead sem id"] += 1
                continue
            base = BASES_LEGAIS.get((linha.get("base_legal") or "").strip().lower())
            if base is None:
                rej["lead sem base legal (consentimento ou legítimo interesse): não entra"] += 1
                continue
            origem = (linha.get("origem") or "").strip()
            if not origem:
                rej["lead sem origem registrada: não entra"] += 1
                continue
            try:
                entrada = _data(linha.get("data_entrada"))
            except ValueError:
                entrada = None
            if entrada is None:
                rej["lead sem data de entrada válida"] += 1
                continue
            fone = norm.contato(linha.get("telefone"), "telefone") if (linha.get("telefone") or "").strip() else None
            mail = norm.contato(linha.get("email"), "email") if (linha.get("email") or "").strip() else None
            if not fone and not mail:
                rej["lead sem telefone nem e-mail válido"] += 1
                continue
            leads[idc] = Lead(idc, entrada, origem, base, (linha.get("bloqueio") or "").strip() or None,
                              {k: v.strip() for k, v in linha.items() if k and k not in COLUNAS_LEAD and (v or "").strip()})
            if fone:
                contatos.append({"id_cliente": idc, "contato": fone, "tipo": "telefone"})
                if _simnao(linha.get("whatsapp")):
                    wa.add(fone)
            if mail:
                contatos.append({"id_cliente": idc, "contato": mail, "tipo": "email"})
    return leads, contatos, wa, rej


# ------------------------------------------------------------------ estado (o que já foi feito)
def carregar_estado(pasta: str | Path) -> dict:
    arq = Path(pasta) / "jornada.json"
    return json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}


def salvar_estado(pasta: str | Path, estado: dict) -> None:
    arq = Path(pasta) / "jornada.json"
    arq.parent.mkdir(parents=True, exist_ok=True)
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(json.dumps(estado, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp.replace(arq)


# ------------------------------------------------------------------ momento do dia
def referencia(c: ClienteJornada, momento: str, hoje: date) -> tuple[int, str] | None:
    """(dia de referência, episódio) do cliente no momento, ou None se o momento não se aplica.
    O episódio muda quando o fato muda (novo vencimento, nova contratação, nova atividade) e
    zera os passos feitos."""
    if momento in ("boas_vindas", "ativacao"):
        if c.contratacao is None or (momento == "ativacao" and c.ativado is True):
            return None
        return (hoje - c.contratacao).days, c.contratacao.isoformat()
    if momento == "pre_vencimento":
        if c.vencimento is None or c.pago:
            return None
        return -(c.vencimento - hoje).days, c.vencimento.isoformat()
    if c.ultima_atividade is None or c.ativado is False:
        return None
    return (hoje - c.ultima_atividade).days, c.ultima_atividade.isoformat()


def rotulo_passo(momento: str, dia: int) -> str:
    if dia == 0:
        return "D0"
    return f"D{dia}" if dia < 0 else f"D+{dia}"


def passo_devido(cfg: dict, ref: int, feitos: list[int]) -> tuple[int | None, bool]:
    """(passo de hoje, já feito?). O passo de hoje é o último cujo dia já chegou, dentro da faixa:
    um passo perdido (domingo, feriado, recência) ainda sai até o dia do passo seguinte."""
    if not cfg["de"] <= ref <= cfg["ate"]:
        return None, False
    chegou = [d for d in cfg["passos"] if d <= ref]
    if not chegou:
        return None, False
    d = max(chegou)
    return d, d in feitos


# ------------------------------------------------------------------ contato
def _tipo(canal: str) -> str:
    return "email" if canal == "email" else "telefone"


def contato_do_canal(idc: str, canal: str, contatos_de: dict[str, list[dict]], certs: dict | None,
                     restricoes: dict[str, set] | None, whatsapp_ok: set | None) -> str | None:
    """Melhor contato do cliente no canal: sem restrição do canal, não contestado, maior nota
    (o Hot primeiro). WhatsApp só em número confirmado como WhatsApp (risco de banimento)."""
    cands = []
    for i, c in enumerate(contatos_de.get(idc) or []):
        if c["tipo"] != _tipo(canal):
            continue
        if canal == "whatsapp" and c["contato"] not in (whatsapp_ok or set()):
            continue
        r = (restricoes or {}).get(c["contato"]) or set()
        if any(x.startswith(canal + ":") for x in r):
            continue
        cert = (certs or {}).get((idc, c["contato"]))
        if cert is not None and (cert.status in STATUS_FORA or any(x.startswith(canal + ":") for x in cert.restricoes)):
            continue
        nota = cert.score + (1 if cert.status == "CERTIFICADO" else 0) if cert is not None else 0
        cands.append((-nota, i, c["contato"]))
    return min(cands)[2] if cands else None


def ordem_por_resultado(taxas: dict[str, dict] | None, minimo: int = 200):
    """Função de 'melhor canal': ordena as opções pela taxa de contato efetivo da carteira, quando
    o canal já tem tentativas suficientes; sem evidência, vale a ordem da regra."""
    def ordenar(opcoes: list[str]) -> list[str]:
        def chave(c):
            t = (taxas or {}).get(c) or {}
            return -(t.get("hit_rate") or 0) if (t.get("tentativas") or 0) >= minimo else 0
        return sorted(opcoes, key=chave)
    return ordenar


# ------------------------------------------------------------------ Lista do dia
@dataclass
class Resultado:
    fila: list[dict] = field(default_factory=list)
    motivos: Counter = field(default_factory=Counter)
    por_momento: Counter = field(default_factory=Counter)
    enquadramento: dict = field(default_factory=dict)   # id_cliente -> {momento, passo, motivo}
    alertas: list[str] = field(default_factory=list)


def _linhas_etapa(acoes: list, idc: str, ativos: set, contatos_de, certs, restricoes, whatsapp_ok,
                  etapa_id: str, rot: str) -> list[dict]:
    """Ações de um dia de etapa da empresa (formato da estratégia): 'sempre' abre uma cadeia, 'senão' só vai
    se nada da cadeia foi, 'junto' acompanha a ação de cima, 'reserva' vai como senão. Um contato por canal."""
    linhas, cadeia_foi, anterior_foi = [], False, False
    for a in acoes:
        a = a if isinstance(a, dict) else {"canal": a, "modo": "sempre"}
        canal, modo = a.get("canal"), a.get("modo") or "sempre"
        if modo == "sempre":
            cadeia_foi = False
        vai = (modo == "sempre") or (modo in ("senao", "reserva") and not cadeia_foi) or (modo == "junto" and anterior_foi)
        foi = False
        if vai and canal in ativos and not any(l["canal"] == canal for l in linhas):
            contato = contato_do_canal(idc, canal, contatos_de, certs, restricoes, whatsapp_ok)
            if contato:
                linhas.append({"id_cliente": idc, "canal": canal, "contato": contato, "regua": f"etapa-{etapa_id}",
                               "passo": rot, "tag": f"CLI-ET-{etapa_id}-{rot}", "condicao": "", "ordem_contato": 1,
                               "cluster": "", "estado": "ET", "persona": "",
                               **({"frase_acao": a["mensagem"]} if a.get("mensagem") is not None else {})})
                foi = True
        if foi and modo != "junto":
            cadeia_foi = True
        anterior_foi = foi
    return linhas


def momento_aplicavel(c: ClienteJornada, regras: dict, hoje: date) -> str | None:
    """A fase do motor em que o cliente está hoje: o 1º momento da hierarquia cuja faixa de dias vale."""
    for m in regras["hierarquia"]:
        cfg = regras["momentos"].get(m) or {}
        ref = referencia(c, m, hoje) if cfg.get("ativo", True) else None
        if ref is not None and cfg["de"] <= ref[0] <= cfg["ate"]:
            return m
    return None


def gerar(clientes: dict[str, ClienteJornada], contatos: list[dict], hoje: date, regras: dict, estado: dict,
          janela_ok: bool = True, canais_ativos: set | None = None, certs: dict | None = None,
          restricoes: dict | None = None, whatsapp_ok: set | None = None, melhor=None,
          leads: dict | None = None, etapas_estado: dict | None = None) -> Resultado:
    """Lista do dia do MotorCli. Atualiza `estado` (passos feitos e última ação) para os clientes
    acionados. canais_ativos: canais ligados na empresa (None = todos). leads: quem ainda não é cliente
    (carregar_leads), acionado só pelas etapas da empresa; etapas_estado: <estado>/etapas.json."""
    res = Resultado()
    melhor = melhor or (lambda opcoes: list(opcoes))
    contatos_de: dict[str, list[dict]] = {}
    for c in contatos:
        contatos_de.setdefault(c["id_cliente"], []).append(c)
    if not janela_ok:
        res.motivos[M_DIA] = len(clientes)
        res.alertas.append("Hoje é dia sem ação no calendário: o MotorCli não gerou Lista do dia.")
        return res
    ativos = set(CANAIS) if canais_ativos is None else set(canais_ativos)
    hierarquia = [m for m in regras["hierarquia"] if regras["momentos"].get(m, {}).get("ativo", True)]
    recencia_dias = regras.get("recencia_horas", 48) / 24
    isentos = set(regras.get("isentos_recencia") or [])

    etapas = regras.get("etapas") or []
    ordem = regras.get("ordem_etapas") or list(ET.FASES["cli"])
    usar_etapas = bool(etapas) and etapas_estado is not None

    pendentes = []

    def historico(est):
        return [(date.fromisoformat(d), c) for d, c in est.get("hist") or []]

    def limitar(est, linhas, lead=False):
        """Trava de limite de ações por cliente (e, para lead, por semana): corta os canais que passam."""
        resta = TV.limite_restante(regras.get("limite_acoes"), historico(est), hoje)
        if lead and regras.get("limite_leads_semana"):
            r2 = regras["limite_leads_semana"] - sum(1 for d, _ in historico(est) if d < hoje and (hoje - d).days < 7)
            resta = r2 if resta is None else min(resta, r2)
        return linhas if resta is None else linhas[:max(0, resta)]

    def anotar(est, linhas):
        est["ultima"] = hoje.isoformat()
        if regras.get("limite_acoes") or regras.get("limite_leads_semana"):
            hist = [[d, c] for d, c in est.get("hist") or [] if (hoje - date.fromisoformat(d)).days < 31
                    and d != hoje.isoformat()]
            est["hist"] = hist + [[hoje.isoformat(), l["canal"]] for l in linhas]

    def concluir_etapa(idc, esc, est, linhas):
        chave = f"etapa-{esc.etapa.id}"
        ET.marcar_feito(esc)
        anotar(est, linhas)
        res.fila.extend(linhas)
        res.por_momento[chave] += 1
        res.enquadramento[idc] = {"momento": chave, "passo": esc.rotulo, "motivo": "com ação hoje"}

    def pela_etapa(idc, esc, est, info=None):
        """Cliente (ou lead) numa etapa da empresa: o passo de hoje, com recência e um contato por canal.
        info: dados para a prioridade do orçamento (etapa com orçamento por canal)."""
        rot = esc.rotulo if esc.passo is not None else ""
        chave = f"etapa-{esc.etapa.id}"
        if esc.passo is None:
            res.motivos[M_ETAPA_SEM_PASSO] += 1
            res.enquadramento[idc] = {"momento": chave, "passo": "", "motivo": M_ETAPA_SEM_PASSO}
            return
        ultima = est.get("ultima")
        rec = esc.etapa.travas.get("recencia_horas", None)
        if ultima and (hoje - date.fromisoformat(ultima)).days < (rec / 24 if rec else recencia_dias):
            res.motivos[M_RECENCIA] += 1
            res.enquadramento[idc] = {"momento": chave, "passo": rot, "motivo": M_RECENCIA}
            return
        acoes = esc.etapa.passos[esc.passo]
        lim_dia = esc.etapa.travas.get("limite_dia")

        lead = bool((etapas_estado.get(idc) or {}).get("lead"))

        def montar(excluir, idc=idc, acoes=acoes, est=est, lead=lead):
            return limitar(est, ET.cortar_canais(_linhas_etapa(
                [a for a in acoes if not (isinstance(a, dict) and a.get("canal") in excluir)],
                idc, ativos, contatos_de, certs, restricoes, whatsapp_ok, esc.etapa.id, rot), lim_dia), lead)
        bruto = _linhas_etapa(acoes, idc, ativos, contatos_de, certs, restricoes, whatsapp_ok, esc.etapa.id, rot)
        if not bruto:
            res.motivos[M_SEM_CONTATO] += 1
            res.enquadramento[idc] = {"momento": chave, "passo": rot, "motivo": M_SEM_CONTATO}
            return
        linhas = limitar(est, ET.cortar_canais(bruto, lim_dia), lead)
        if not linhas:
            res.motivos[M_LIMITE] += 1
            res.enquadramento[idc] = {"momento": chave, "passo": rot, "motivo": M_LIMITE}
            return
        if esc.etapa.orcamento:
            pendentes.append(ET.Pendente(idc, esc, ET.info_prioridade(esc, hoje, **(info or {})), montar, linhas))
            return
        concluir_etapa(idc, esc, est, linhas)

    certificados = {k[0] for k, v in (certs or {}).items() if getattr(v, "status", "") == "CERTIFICADO"} \
        if any(e.orcamento for e in etapas) else set()

    def info_de(idc, ultima, saldo, atributos):
        return {"ultima_acao": date.fromisoformat(ultima) if ultima else None, "saldo": saldo,
                "hot": idc in certificados, "atributos": atributos}

    for idc in sorted(clientes):
        c = clientes[idc]
        if c.bloqueio:
            res.motivos[M_BLOQUEIO] += 1
            res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": M_BLOQUEIO}
            continue
        if c.dias_atraso > 0:
            res.motivos[M_ATRASO] += 1
            res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": M_ATRASO}
            continue
        est = estado.setdefault(idc, {"momentos": {}})
        if usar_etapas:
            st = etapas_estado.get(idc) or {}
            eventos = {"convertido"} if st.get("lead") else set()
            if st.get("lead"):
                st.pop("lead")
            fase = momento_aplicavel(c, regras, hoje)
            campos = {**c.atributos, "e_cliente": "sim", "dias_atraso": c.dias_atraso, "momento": fase or "",
                      "ativado": {True: "sim", False: "não"}.get(c.ativado, "")}
            datas = {"contratacao": c.contratacao, "vencimento": None if c.pago else c.vencimento,
                     "sem_atividade": c.ultima_atividade}
            esc = ET.escolher(etapas, ordem, fase, campos, datas, eventos, etapas_estado, idc, hoje)
            if esc == ET.FORA:
                res.motivos[M_FORA] += 1
                res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": M_FORA}
                continue
            if esc is not None:
                pela_etapa(idc, esc, est, info_de(idc, est.get("ultima"), c.atributos.get("limite_disponivel"),
                                                  c.atributos))
                continue
        escolhido, motivo = None, M_SEM_MOMENTO
        for m in hierarquia:
            cfg = regras["momentos"][m]
            ref = referencia(c, m, hoje)
            if ref is None:
                continue
            dia_ref, episodio = ref
            mem = est["momentos"].get(m)
            feitos = mem["feitos"] if mem and mem.get("episodio") == episodio else []
            passo, feito = passo_devido(cfg, dia_ref, feitos)
            if passo is None:
                continue
            if feito:
                motivo = M_FEITO
                continue
            escolhido = (m, passo, episodio, feitos)
            break
        if escolhido is None:
            res.motivos[motivo] += 1
            res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": motivo}
            continue
        m, passo, episodio, feitos = escolhido
        rot = rotulo_passo(m, passo)
        ultima = est.get("ultima")
        if m not in isentos and ultima and (hoje - date.fromisoformat(ultima)).days < recencia_dias:
            res.motivos[M_RECENCIA] += 1
            res.enquadramento[idc] = {"momento": m, "passo": rot, "motivo": M_RECENCIA}
            continue
        linhas = []
        for acao in regras["momentos"][m]["passos"][passo]:
            opcoes = melhor(acao["opcoes"]) if acao["canal"] == "melhor" else [acao["canal"]]
            if acao.get("senao"):
                opcoes = opcoes + [acao["senao"]]
            for canal in opcoes:
                if canal not in ativos or any(l["canal"] == canal for l in linhas):
                    continue
                contato = contato_do_canal(idc, canal, contatos_de, certs, restricoes, whatsapp_ok)
                if contato:
                    linhas.append({"id_cliente": idc, "canal": canal, "contato": contato, "regua": m,
                                   "passo": rot, "tag": f"CLI-{CODIGO[m]}-{rot}", "condicao": "",
                                   "ordem_contato": 1, "cluster": "", "estado": CODIGO[m], "persona": ""})
                    break
        if not linhas:
            res.motivos[M_SEM_CONTATO] += 1
            res.enquadramento[idc] = {"momento": m, "passo": rot, "motivo": M_SEM_CONTATO}
            continue
        linhas = limitar(est, linhas)
        if not linhas:
            res.motivos[M_LIMITE] += 1
            res.enquadramento[idc] = {"momento": m, "passo": rot, "motivo": M_LIMITE}
            continue
        est["momentos"][m] = {"episodio": episodio, "feitos": sorted(set(feitos) | {passo})}
        anotar(est, linhas)
        res.fila.extend(linhas)
        res.por_momento[m] += 1
        res.enquadramento[idc] = {"momento": m, "passo": rot, "motivo": "com ação hoje"}
    for idc in sorted(leads or {}):
        if idc in clientes:
            continue                       # virou cliente: segue como cliente (evento "convertido")
        l = leads[idc]
        if l.bloqueio:
            res.motivos[M_BLOQUEIO] += 1
            res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": M_BLOQUEIO}
            continue
        if not usar_etapas:
            res.motivos[M_LEAD_SEM_ETAPA] += 1
            res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": M_LEAD_SEM_ETAPA}
            continue
        est = estado.setdefault(idc, {"momentos": {}})
        etapas_estado.setdefault(idc, {"etapas": {}})["lead"] = True
        campos = {**l.atributos, "e_cliente": "não", "origem": l.origem, "base_legal": l.base_legal}
        esc = ET.escolher(etapas, ordem, None, campos, {"lead": l.entrada}, set(), etapas_estado, idc, hoje)
        if esc == ET.FORA:
            res.motivos[M_FORA] += 1
            res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": M_FORA}
        elif esc is None:
            res.motivos[M_LEAD_SEM_ETAPA] += 1
            res.enquadramento[idc] = {"momento": "", "passo": "", "motivo": M_LEAD_SEM_ETAPA}
        else:
            pela_etapa(idc, esc, est, info_de(idc, est.get("ultima"), None, l.atributos))
    ET.aplicar_orcamento(pendentes, res.alertas)
    for p in pendentes:
        est = estado.setdefault(p.idc, {"momentos": {}})
        if p.cortado:
            res.motivos[M_ORCAMENTO] += 1
            res.enquadramento[p.idc] = {"momento": f"etapa-{p.escolha.etapa.id}", "passo": p.escolha.rotulo,
                                        "motivo": M_ORCAMENTO}
        else:
            concluir_etapa(p.idc, p.escolha, est, p.linhas)
    for idc in [k for k, v in estado.items() if not v.get("momentos") and "ultima" not in v]:
        del estado[idc]                    # nada a guardar de quem nunca foi acionado
    return res


def ids_por_canal(fila: list[dict]) -> dict[str, list[dict]]:
    """ids/<canal>.csv: id_cliente;contato[;mensagem] (o formato que a Mensageria transforma em lote)."""
    por: dict[str, list[dict]] = {}
    com_frase = {l["canal"] for l in fila if l.get("mensagem")}
    for l in fila:
        linha = {"id_cliente": l["id_cliente"], "contato": l["contato"]}
        if l["canal"] in com_frase:       # frase da ação da etapa (a Mensageria usa a coluna mensagem)
            linha["mensagem"] = l.get("mensagem") or ""
        por.setdefault(l["canal"], []).append(linha)
    return por
