"""Marcação de cliente: a TAG que conta a história de cada cliente, e a trilha.

TAG = SAFRA-CLUSTER-ESTADO-CANAL-CICLO    ex.: S260801-A1-CPB-WA-T2

- SAFRA   S+AAMMDD da entrada na carteira. Imutável.
- CLUSTER ticket (A/M/B) x atraso (1/2/3). O de origem é imutável e fica guardado;
          a TAG mostra o atual, revisado no fechamento mensal.
- ESTADO  LOC · CPA · CPB · NCP · PRE · QBR · COL · LIQ · BLQ — um por vez.
- CANAL   WA · RC · AV · DC · SM · EM · ND — canal da última localização.
- CICLO   L0–L8 localização · T1–T3 tentativas · G1… giro · D-3/D0 preventivo · D1–D5 quebra.

Toda mudança de TAG gera um evento na trilha (com quem marcou). O extrato do
cliente é a sequência desses eventos. O estado é atualizado uma vez por dia,
pelos retornos do dia, pelas parcelas e pela passagem do tempo.
"""
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from .acordos import Parcela, situacao_acordo
from .certificacao import Evento
from .regua import CANAIS_VOZ, Regua

ESTADOS_MASSIVOS = ("LOC", "CPA", "CPB", "NCP")
ESTADOS_ACORDO = ("PRE", "QBR", "COL", "LIQ")
QUEM = {"whatsapp": "WhatsApp", "rcs": "RCS", "agente_voz": "Agente virtual", "discador": "Discador",
        "sms": "SMS", "email": "E-mail", "portal": "Portal"}


@dataclass(frozen=True)
class Cliente:
    id_cliente: str
    data_entrada: date
    saldo: float
    dias_atraso: int          # na data de entrada
    bloqueio: str | None = None  # opt-out geral, óbito, judicial, reclamação...

    def atraso_em(self, dia: date) -> int:
        return self.dias_atraso + max((dia - self.data_entrada).days, 0)


@dataclass
class EstadoCliente:
    id_cliente: str
    safra: date
    cluster_origem: str
    cluster_atual: str
    cluster_revisado: str            # AAAA-MM da última revisão
    estado: str = "LOC"
    canal: str = "ND"
    ciclo: str = "L0"
    tentativas: int = 0
    canal_atual: str | None = None   # nome do canal (whatsapp…) de CPA/CPB
    canais_esgotados: list[str] = field(default_factory=list)
    contato_localizador: str | None = None
    ultima_massiva: date | None = None
    giro_inicio: date | None = None
    giro_pausado: bool = False
    reenriquecer: str | None = None  # motivo, quando o cliente precisa de novo enriquecimento
    acordos_quebrados: list[str] = field(default_factory=list)

    @property
    def tag(self) -> str:
        return "-".join(p for p in (f"S{self.safra:%y%m%d}", self.cluster_atual, self.estado,
                                    self.canal, self.ciclo) if p)

    def para_json(self) -> dict:
        d = asdict(self)
        for k in ("safra", "ultima_massiva", "giro_inicio"):
            d[k] = d[k].isoformat() if d[k] else None
        return d

    @classmethod
    def de_json(cls, d: dict) -> "EstadoCliente":
        d = dict(d)
        for k in ("safra", "ultima_massiva", "giro_inicio"):
            d[k] = date.fromisoformat(d[k]) if d.get(k) else None
        return cls(**d)


def iniciar(cliente: Cliente, regua: Regua) -> EstadoCliente:
    cl = regua.cluster(cliente.saldo, cliente.dias_atraso)
    return EstadoCliente(cliente.id_cliente, cliente.data_entrada, cl, cl, f"{cliente.data_entrada:%Y-%m}")


class Trilha:
    """Registra um evento sempre que a TAG muda."""

    def __init__(self):
        self.eventos: list[dict] = []

    def marcar(self, dia: date, est: EstadoCliente, antes: str | None, motivo: str, quem: str):
        if est.tag != antes:
            self.eventos.append({"data": dia.isoformat(), "id_cliente": est.id_cliente,
                                 "tag_anterior": antes or "", "tag": est.tag, "motivo": motivo,
                                 "quem_marcou": quem})


def _ordem(regua: Regua, canal: str) -> int:
    o = regua["ordem_rotacao"]
    return o.index(canal) if canal in o else len(o)


def proximo_canal(est: EstadoCliente, regua: Regua, disponiveis: set[str]) -> str | None:
    """Próximo canal da rotação depois do atual (circular), não esgotado e com contato elegível."""
    ordem = regua["ordem_rotacao"]
    i = ordem.index(est.canal_atual) + 1 if est.canal_atual in ordem else 0
    for c in ordem[i:] + ordem[:i]:
        if c not in est.canais_esgotados and c != est.canal_atual and c in disponiveis:
            return c
    return None


def processar_dia(estados: dict[str, EstadoCliente], clientes: dict[str, Cliente], eventos_dia: list[Evento],
                  parcelas: dict[str, list[Parcela]], dia: date, regua: Regua,
                  disponiveis: dict[str, set[str]] | None = None, baixas_ate: date | None = None) -> list[dict]:
    """Atualiza os estados com o que aconteceu em `dia`. Retorna os eventos da trilha.

    disponiveis: {id_cliente: canais com contato elegível} — decide a rotação e quando
    o cliente esgotou os canais. baixas_ate: pagamentos refletidos até esta data.
    """
    trilha = Trilha()
    disponiveis = disponiveis or {}
    baixas_ate = baixas_ate or dia
    por_cliente = defaultdict(list)
    for e in eventos_dia:
        por_cliente[e.id_cliente].append(e)

    for c in clientes.values():
        if c.id_cliente not in estados and c.data_entrada <= dia:
            est = iniciar(c, regua)
            estados[c.id_cliente] = est
            trilha.marcar(dia, est, None, f"entrada na esteira; enriquecimento "
                                          f"{regua.enriquecimento(est.cluster_origem)['pacote']}", "Planejamento")

    for idc, est in estados.items():
        c = clientes.get(idc)
        if c is None:
            continue
        if c.bloqueio and est.estado != "BLQ":
            antes = est.tag
            est.estado, est.canal, est.ciclo = "BLQ", est.canal, ""
            trilha.marcar(dia, est, antes, f"bloqueado: {c.bloqueio}", "Planejamento")
        if est.estado in ("BLQ", "LIQ"):
            continue

        mes = f"{dia:%Y-%m}"
        if mes != est.cluster_revisado:
            antes, est.cluster_revisado = est.tag, mes
            est.cluster_atual = regua.cluster(c.saldo, c.atraso_em(dia))
            trilha.marcar(dia, est, antes, "revisão mensal do cluster", "Planejamento")

        # Em acordo, a TAG do dia (D-1 → D0…) vem antes dos retornos; nas réguas massivas,
        # o contato do dia vem antes do acordo (respondeu → CPC A → fechou → COL).
        retornos = por_cliente.get(idc, [])
        if est.estado in ESTADOS_ACORDO:
            _aplicar_acordo(est, parcelas.get(idc, []), dia, baixas_ate, regua, trilha)
            _aplicar_retornos(est, retornos, dia, regua, disponiveis.get(idc, set()), trilha)
        else:
            _aplicar_retornos(est, retornos, dia, regua, disponiveis.get(idc, set()), trilha)
            _aplicar_acordo(est, parcelas.get(idc, []), dia, baixas_ate, regua, trilha)
        _aplicar_tempo(est, dia, regua, trilha)
    return trilha.eventos


def _aplicar_retornos(est, eventos, dia, regua, disponiveis, trilha):
    if not eventos:
        return
    antes = est.tag
    tentados = sorted({e.canal for e in eventos if e.canal in regua["canais"]}, key=lambda c: _ordem(regua, c))
    contatos = [e for e in eventos if e.canal in regua["canais"] and regua.e_contato(e.canal, e.resultado)]
    massivo = est.estado in ESTADOS_MASSIVOS
    if massivo and tentados:
        est.ultima_massiva = dia

    if contatos:
        e = min(contatos, key=lambda e: _ordem(regua, e.canal))
        est.canal = regua.codigo(e.canal)
        if massivo:
            est.estado, est.ciclo, est.tentativas = "CPA", "T1", 1
            est.canal_atual, est.contato_localizador = e.canal, e.contato
            est.canais_esgotados, est.giro_inicio, est.giro_pausado, est.reenriquecer = [], None, False, None
        trilha.marcar(dia, est, antes, f"contato no {QUEM.get(e.canal, e.canal)}"
                      + (" → CPC A" if massivo else ""), QUEM.get(e.canal, e.canal))
        return
    if not massivo or not tentados:
        return

    principal = est.canal_atual if est.canal_atual in tentados else tentados[0]
    quem = QUEM.get(principal, principal)
    if est.estado == "LOC":
        est.ciclo = f"L{(dia - est.safra).days}"
        trilha.marcar(dia, est, antes, f"localização por {'+'.join(QUEM[t] for t in tentados)} sem contato", quem)
    elif est.estado == "CPA":
        est.estado, est.canal, est.ciclo, est.tentativas = "CPB", regua.codigo(principal), "T1", 1
        est.canal_atual = principal
        trilha.marcar(dia, est, antes, "sem resposta na ação de negociação → CPC B", quem)
    elif est.estado == "CPB":
        if principal == est.canal_atual:
            est.tentativas += 1
            motivo = f"{est.tentativas}ª tentativa no canal sem resposta"
        else:
            est.canal_atual, est.tentativas = principal, 1
            motivo = f"rotação de canal para {QUEM[principal]}"
        est.canal, est.ciclo = regua.codigo(principal), f"T{est.tentativas}"
        if est.tentativas >= regua["tentativas_por_canal"] and principal not in est.canais_esgotados:
            est.canais_esgotados.append(principal)
        trilha.marcar(dia, est, antes, motivo, quem)
        if est.tentativas >= regua["tentativas_por_canal"] and proximo_canal(est, regua, disponiveis) is None:
            antes = est.tag
            _ir_para_giro(est, dia, "esgotou os canais")
            trilha.marcar(dia, est, antes, "esgotou os canais → Não CPC + re-enriquecimento", "Automático")


def _ir_para_giro(est, dia, motivo_reenriquecer=None):
    est.estado, est.canal, est.ciclo = "NCP", "ND", "G1"
    est.canal_atual, est.tentativas, est.canais_esgotados = None, 0, []
    est.giro_inicio, est.giro_pausado = dia + timedelta(days=1), False
    est.reenriquecer = motivo_reenriquecer


def _aplicar_acordo(est, parcelas, dia, baixas_ate, regua, trilha):
    sit = situacao_acordo(parcelas, dia, baixas_ate, set(est.acordos_quebrados)) if parcelas else None
    antes = est.tag
    if sit is None:
        if est.estado in ESTADOS_ACORDO:  # acordo sumiu do sistema: volta ao estoque
            est.estado, est.ciclo, est.tentativas = "CPA", "T1", 1
            trilha.marcar(dia, est, antes, "sem acordo vigente → estoque", "Sist. acordos")
        return
    estado, ciclo, id_acordo = sit
    if estado == "QBR" and int(ciclo[1:]) >= regua["quebra"]["dias_para_estoque"]:
        est.acordos_quebrados.append(id_acordo)
        est.estado, est.ciclo, est.tentativas, est.canais_esgotados = "CPA", "T1", 1, []
        trilha.marcar(dia, est, antes, f"D+{ciclo[1:]} da quebra sem pagamento → volta ao estoque como CPC A",
                      "Sist. acordos")
        return
    motivo = {"LIQ": "acordo quitado", "QBR": "parcela vencida sem pagamento",
              "PRE": "parcela a vencer", "COL": "acordo ativo (colchão)"}[estado]
    est.estado, est.ciclo = estado, ciclo
    trilha.marcar(dia, est, antes, motivo, "Sist. acordos")


def _aplicar_tempo(est, dia, regua, trilha):
    antes = est.tag
    if est.estado == "LOC" and (dia - est.safra).days >= regua["localizacao"]["dias_sem_contato_para_ncp"]:
        _ir_para_giro(est, dia)
        trilha.marcar(dia, est, antes, f"D+{(dia - est.safra).days} sem contato → Não CPC, entra no giro",
                      "Automático")
    elif est.estado == "NCP" and est.giro_inicio and dia >= est.giro_inicio and not est.giro_pausado:
        n = (dia - est.giro_inicio).days // regua["giro"]["ciclo_dias"] + 1
        if n > regua["giro"]["max_ciclos"]:
            est.giro_pausado, est.ciclo = True, "RE"
            est.reenriquecer = f"{regua['giro']['max_ciclos']} ciclos de giro sem contato"
            trilha.marcar(dia, est, antes, "giro esgotado → aguarda re-enriquecimento", "Automático")
        elif f"G{n}" != est.ciclo:
            est.ciclo = f"G{n}"
            trilha.marcar(dia, est, antes, f"{n}º ciclo de giro", "Automático")


def reativar_apos_enriquecimento(est: EstadoCliente, dia: date, trilha: Trilha):
    """Chamado quando chegam contatos novos/revalidados para quem estava aguardando."""
    if est.estado == "NCP" and est.giro_pausado:
        antes = est.tag
        _ir_para_giro(est, dia - timedelta(days=1))
        trilha.marcar(dia, est, antes, "re-enriquecido → reinicia giro", "Planejamento")


__all__ = ["Cliente", "EstadoCliente", "Trilha", "iniciar", "processar_dia", "proximo_canal",
           "reativar_apos_enriquecimento", "CANAIS_VOZ"]
