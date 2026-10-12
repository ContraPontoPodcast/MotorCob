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
    return clientes, rejeitados


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


def gerar(clientes: dict[str, ClienteJornada], contatos: list[dict], hoje: date, regras: dict, estado: dict,
          janela_ok: bool = True, canais_ativos: set | None = None, certs: dict | None = None,
          restricoes: dict | None = None, whatsapp_ok: set | None = None, melhor=None) -> Resultado:
    """Lista do dia do MotorCli. Atualiza `estado` (passos feitos e última ação) para os clientes
    acionados. canais_ativos: canais ligados na empresa (None = todos)."""
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
        est["momentos"][m] = {"episodio": episodio, "feitos": sorted(set(feitos) | {passo})}
        est["ultima"] = hoje.isoformat()
        res.fila.extend(linhas)
        res.por_momento[m] += 1
        res.enquadramento[idc] = {"momento": m, "passo": rot, "motivo": "com ação hoje"}
    for idc in [k for k, v in estado.items() if not v.get("momentos") and "ultima" not in v]:
        del estado[idc]                    # nada a guardar de quem nunca foi acionado
    return res


def ids_por_canal(fila: list[dict]) -> dict[str, list[dict]]:
    """ids/<canal>.csv: id_cliente;contato (o formato que a Mensageria transforma em lote)."""
    por: dict[str, list[dict]] = {}
    for l in fila:
        por.setdefault(l["canal"], []).append({"id_cliente": l["id_cliente"], "contato": l["contato"]})
    return por
