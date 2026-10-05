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
from bisect import bisect_left, bisect_right
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
    qtd_contratos: int = 1
    atributos: dict | None = field(default=None, compare=False, hash=False)  # colunas da base bruta

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
    cluster_versao: str = ""         # versão das regras de cluster da empresa usada na revisão
    candidatos_hot: list[str] = field(default_factory=list)  # CPC com vários números: um deles é o Hot
    contatos_tentados: list[str] = field(default_factory=list)  # sem Hot: exportados sem CPC, do mais antigo
    inicio_esteira: date | None = None  # dia em que a 1ª lista do cliente saiu (o D+1 dele); None = a safra
    esteira_pendente: bool = False      # a 1ª lista ainda não saiu: o cliente fica no D+1

    @property
    def tag(self) -> str:
        return "-".join(p for p in (f"S{self.safra:%y%m%d}", self.cluster_atual, self.estado,
                                    self.canal, self.ciclo) if p)

    def para_json(self) -> dict:
        d = asdict(self)
        for k in ("safra", "ultima_massiva", "giro_inicio", "inicio_esteira"):
            d[k] = d[k].isoformat() if d[k] else None
        return d

    @classmethod
    def de_json(cls, d: dict) -> "EstadoCliente":
        d = dict(d)
        for k in ("safra", "ultima_massiva", "giro_inicio", "inicio_esteira"):
            d[k] = date.fromisoformat(d[k]) if d.get(k) else None
        return cls(**d)


def _entradas(estados, clientes, dia, regua, trilha, pela_lista=False):
    for c in clientes.values():
        if c.id_cliente not in estados and c.data_entrada <= dia:
            est = iniciar(c, regua)
            est.esteira_pendente = pela_lista
            estados[c.id_cliente] = est
            trilha.marcar(dia, est, None, f"entrada na esteira; enriquecimento "
                                          f"{regua.enriquecimento(est.cluster_origem)['pacote']}", "Planejamento")


def registrar_entradas(estados, clientes, dia, regua, pela_lista=False) -> list[dict]:
    """Quem chegou na carga hoje entra na esteira já hoje (para a 1ª ação sair no dia da carga).
    pela_lista: a esteira do cliente só começa quando a 1ª lista dele sair (rodar_dia)."""
    trilha = Trilha()
    _entradas(estados, clientes, dia, regua, trilha, pela_lista)
    return trilha.eventos


def iniciar(cliente: Cliente, regua: Regua) -> EstadoCliente:
    cl = regua.cluster_de(cliente, cliente.data_entrada)
    return EstadoCliente(cliente.id_cliente, cliente.data_entrada, cl, cl, f"{cliente.data_entrada:%Y-%m}",
                         cluster_versao=regua.versao_clusters)


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
                  disponiveis: dict[str, set[str]] | None = None, baixas_ate: date | None = None,
                  atualizados: dict[str, date] | None = None,
                  enviados: dict[str, list[str]] | None = None, pela_lista: bool = False) -> list[dict]:
    """Atualiza os estados com o que aconteceu em `dia`. Retorna os eventos da trilha.
    pela_lista: quem entra fica no D+1 até a 1ª lista dele sair (ver dia_na_carga).

    disponiveis: {id_cliente: canais com contato elegível} — decide a rotação e quando
    o cliente esgotou os canais. baixas_ate: pagamentos refletidos até esta data.
    atualizados: {id_cliente: data do contato mais recente (enriquecimento)} — reativa o giro
    de quem estava parado aguardando re-enriquecimento.
    enviados: {id_cliente: contatos exportados em `dia`} — enquanto o cliente não tem contato
    Hot, cada contato exportado vai para o fim de `contatos_tentados`, e a próxima passagem
    usa o próximo contato (1, 2, 3, 4 e recomeça pelo tentado há mais tempo).
    """
    trilha = Trilha()
    disponiveis = disponiveis or {}
    baixas_ate = baixas_ate or dia
    por_cliente = defaultdict(list)
    for e in eventos_dia:
        por_cliente[e.id_cliente].append(e)

    _entradas(estados, clientes, dia, regua, trilha, pela_lista)

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
        if mes != est.cluster_revisado or est.cluster_versao != regua.versao_clusters:
            motivo = ("regras de cluster alteradas" if est.cluster_versao != regua.versao_clusters
                      else "revisão mensal do cluster")
            antes, est.cluster_revisado, est.cluster_versao = est.tag, mes, regua.versao_clusters
            est.cluster_atual = regua.cluster_de(c, dia)
            trilha.marcar(dia, est, antes, motivo, "Planejamento")

        rc = regua.para(est.cluster_atual)  # estratégia do cluster do cliente
        novo = (atualizados or {}).get(idc)
        if est.estado == "NCP" and est.giro_pausado and est.giro_inicio and novo and novo <= dia:
            pausa = est.giro_inicio + timedelta(days=rc["giro"]["max_ciclos"] * rc["giro"]["ciclo_dias"])
            if novo >= pausa:
                reativar_apos_enriquecimento(est, dia, trilha)
        # Em acordo, a TAG do dia (D-1 → D0…) vem antes dos retornos; nas réguas massivas,
        # o contato do dia vem antes do acordo (respondeu → CPC A → fechou → COL).
        retornos = por_cliente.get(idc, [])
        if est.estado in ESTADOS_ACORDO:
            _aplicar_acordo(est, parcelas.get(idc, []), dia, baixas_ate, rc, trilha)
            _aplicar_retornos(est, retornos, dia, rc, disponiveis.get(idc, set()), trilha)
        else:
            _aplicar_retornos(est, retornos, dia, rc, disponiveis.get(idc, set()), trilha)
            _aplicar_acordo(est, parcelas.get(idc, []), dia, baixas_ate, rc, trilha)
        _aplicar_tempo(est, dia, rc, trilha)
        if est.contato_localizador:
            est.contatos_tentados = []     # achou o Hot: fiel a ele, rotação encerrada
        else:
            for contato in (enviados or {}).get(idc, []):
                if contato in est.contatos_tentados:
                    est.contatos_tentados.remove(contato)
                est.contatos_tentados.append(contato)
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
    if est.candidatos_hot:  # candidato acionado sozinho e sem CPC sai da descoberta
        falhou = {e.contato for e in eventos if e.contato and not regua.e_contato(e.canal, e.resultado)}
        est.candidatos_hot = [c for c in est.candidatos_hot if c not in falhou]

    if contatos:
        e = min(contatos, key=lambda e: _ordem(regua, e.canal))
        est.canal = regua.codigo(e.canal)
        if massivo:
            est.estado, est.ciclo, est.tentativas = "CPA", "T1", 1
            est.canal_atual, est.contato_localizador = e.canal, e.contato or None
            # CPC sem saber o número (vários na ação): os números enviados viram candidatos a Hot
            est.candidatos_hot = [] if e.contato else list(e.candidatos)
            est.canais_esgotados, est.giro_inicio, est.giro_pausado, est.reenriquecer = [], None, False, None
        trilha.marcar(dia, est, antes, f"contato no {QUEM.get(e.canal, e.canal)}"
                      + (" → CPC A" if massivo else ""), QUEM.get(e.canal, e.canal))
        return
    if not massivo or not tentados:
        return

    principal = est.canal_atual if est.canal_atual in tentados else tentados[0]
    quem = QUEM.get(principal, principal)
    if est.estado == "LOC":
        est.ciclo = f"L{dia_na_carga(est, dia, regua)}"
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


def janela_preventivo(regua) -> int:
    """Quantos dias antes do vencimento o preventivo começa: o maior dia desenhado (mínimo 0)."""
    try:
        return max([abs(int(k)) for k in (regua["preventivo"]["passos"] or {})] + [0])
    except (KeyError, TypeError, ValueError):
        return 3


def _aplicar_acordo(est, parcelas, dia, baixas_ate, regua, trilha):
    sit = situacao_acordo(parcelas, dia, baixas_ate, set(est.acordos_quebrados),
                          janela_preventivo(regua)) if parcelas else None
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


def dias_de_esteira(regua, inicio, dia) -> int:
    """Quantos dias de esteira há de `inicio` a `dia` (os dois inclusos). A esteira só anda nos
    dias em que a lista da carteira saiu (regua.dias_lista): rotina que não rodou, domingo e
    feriado pausam. Depois de hoje, conta os dias úteis (a lista sai sozinha). Sem dias_lista:
    calendário corrido."""
    if regua is None or getattr(regua, "dias_lista", None) is None:
        return (dia - inicio).days + 1
    hoje = regua.hoje_lista
    lista = regua.dias_lista
    n = bisect_right(lista, min(dia, hoje)) - bisect_left(lista, inicio)
    d = max(hoje, inicio - timedelta(days=1)) + timedelta(days=1)
    while d <= dia:
        if regua.janela(d) is not None:
            n += 1
        d += timedelta(days=1)
    return max(n, 0)


def dia_na_carga(est, dia, regua=None) -> int:
    """D+N da localização. A esteira do cliente começa no dia em que a 1ª lista dele sai de fato
    (inicio_esteira, em geral o dia da carga): se a lista não saiu (rotina não rodou, outra carteira
    acionou…), o D+1 não aconteceu e ele continua no D+1. Depois, só anda nos dias de lista."""
    if est.esteira_pendente:
        return 1
    return max(1, dias_de_esteira(regua, est.inicio_esteira or est.safra, dia))


def _aplicar_tempo(est, dia, regua, trilha):
    antes = est.tag
    if est.estado == "LOC" and dia_na_carga(est, dia, regua) >= regua["localizacao"]["dias_sem_contato_para_ncp"]:
        _ir_para_giro(est, dia)
        trilha.marcar(dia, est, antes, f"D+{dia_na_carga(est, dia, regua)} sem contato → Não CPC, entra no giro",
                      "Automático")
    elif est.estado == "NCP" and est.giro_inicio and dia >= est.giro_inicio and not est.giro_pausado:
        n = (dias_de_esteira(regua, est.giro_inicio, dia) - 1) // regua["giro"]["ciclo_dias"] + 1
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


def aplicar_pendentes(estados: dict[str, EstadoCliente], clientes: dict[str, Cliente], tardios: list[Evento],
                      parcelas: dict[str, list[Parcela]], dia: date, regua: Regua) -> list[dict]:
    """O que chegou depois de o dia ser fechado: ocorrência de um dia já processado (a operação
    manda a tabulação depois da rotina) e acordo/pagamento novos. Aplica na hora, com a data do
    último dia processado, sem andar a esteira de ninguém (o tempo já foi contado)."""
    trilha = Trilha()
    por_cliente = defaultdict(list)
    for e in tardios:
        por_cliente[e.id_cliente].append(e)
    for idc, est in estados.items():
        if idc not in clientes or est.estado in ("BLQ", "LIQ"):
            continue
        rc = regua.para(est.cluster_atual)
        evs = sorted(por_cliente.get(idc, []), key=lambda e: e.data)
        if evs:
            antes = est.tag
            _aplicar_retornos(est, evs, dia, rc, set(), trilha)
            if est.tag != antes and trilha.eventos and trilha.eventos[-1]["id_cliente"] == idc:
                datas = sorted({e.data.strftime("%d/%m") for e in evs})
                trilha.eventos[-1]["motivo"] += f" (ocorrência de {', '.join(datas)} que chegou depois)"
        if parcelas.get(idc) or est.estado in ESTADOS_ACORDO:
            _aplicar_acordo(est, parcelas.get(idc, []), dia, dia, rc, trilha)
    return trilha.eventos
