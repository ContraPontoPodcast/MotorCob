"""Orquestrador ARI: do lote do dia ao evento de cada tentativa.

Fluxo de uma tentativa (id_chamada = uuid hex; canais <id>-c<n> cliente, <id>-p provedor, <id>-h humano):
  1. tick: a guarda libera um item, há robô para reservar (conversas da empresa e global no agendador e sessão livre
     no provedor da empresa nesta VM), canal e CPS do tronco, e rota para o tipo do número -> o robô fica reservado
     para a linha e sai o originate PJSIP/<tech prefix><DDD+número>@<tronco> no app Stasis. Sem robô para reservar,
     o número espera na lista (nada é discado para quem não teria com quem falar).
  2. falha técnica antes de atender (pela_rede = falha_operadora/bloqueio_originacao) -> próxima rota (failover).
     Sem crédito (falha da operadora com SIP 402) ou bloqueio de originação pausam a rota (o tronco) na hora: ela não
     disca até a equipe retomar (SQL 65 › voz_troncos_pausas; a pausa vai ao banco pelo Plantão) e a equipe é avisada.
  3. atendeu (StasisStart 'saida') -> linha sem reserva (razão > 1, Power/Preditivo) reserva o robô agora, antes do
     AMD -> dialplan motorcx-atendeu: AMD (ou Khomp) e MixMonitor só em pessoa -> volta ao Stasis ('amd').
  4. pessoa -> a reserva vira conversa e vai ao provedor de voz (ponte SIP, mídia externa ou interno). Máquina ->
     a reserva volta. Sem robô (linha a mais do Power/Preditivo que atendeu com todos ocupados, ou corrida/falha do
     provedor): na hora, uma mensagem curta e neutra pré-gravada (sem dívida nem credor: a identidade vem antes da
     dívida) e o fim da ligação, com desfecho abandono_sem_robo (transferencia = sem_robo), que conta no abandono e
     não religa no dia. Nunca se desliga mudo na cara de quem atendeu; o "Alô fake" saiu (V4).
  5. o provedor pede humano -> ponte (padrão, decisão do dono 08/11/2026: o MotorCX segura a ligação e chama a fila
     do cliente; a IA só sai quando o humano atende) ou REFER (opção avançada; dialplan motorcx-transferir). Ninguém
     atendeu, a fila recusou ou não há destino: a pessoa volta para o agente, que pede desculpas e agenda um retorno
     (ProvedorVoz.retomar_sem_humano: a Conversa do roteiro e, desde o B5, a Sessão do fluxo). A ElevenLabs, que não
     recebe texto no meio da conversa, é chamada de novo para a mesma ponte com o motivo (reconectar_sem_humano).
     Nunca se desliga na cara. Só se o agente não puder voltar (REFER já soltou o agente, provedor sem suporte ou
     sem robô) a chamada termina como transferencia_sem_operador (sem_operador | falhou; SQL 106: não é abandono).
  6. o canal do cliente acabou -> evento (CDR, Q.850, SIP, AMD, billsec, toque, rota/tech prefix, segundos
     tarifados, custo, transferência) classificado com motor/voz.py, guarda e agendador atualizados, gravação na
     fila de envio para o GCS.
"""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from motor import discagem as DG
from motor import voz as V
from voz import tarifacao as T
from voz import destinos as DST
from voz.banco import VARIAVEIS_VOZ, DadosVoz, Transferencia
from voz.orquestrador import amd as A
from voz.orquestrador import gravacao as G
from voz.orquestrador.agendador import Agendador, JanelaTaxa
from voz.orquestrador.ari import ClienteARI, ErroARI
from voz.orquestrador.eventos import SEM_IA, EscritorEventos, EventoChamada, classificar
from voz.orquestrador.lote import ItemLote, Lote, hash_destino
from voz.orquestrador.curtas import Curtas
from voz.orquestrador.medidor import Medidor, e_curta
from voz.provedores.base import ContextoChamada, ProvedorVoz, aviso_abertura
from voz.transcricao import ia as TIA

log = logging.getLogger("motorcx.voz")
_FUSO = ZoneInfo("America/Sao_Paulo")
APP = "motorcx"
TECNICOS_FAILOVER = ("falha_operadora", "bloqueio_originacao")
# Q.850 do destino da transferência que quer dizer "ninguém para atender" (o resto é falha)
SEM_OPERADOR_Q850 = frozenset({17, 18, 19, 21, 31})
SEM_OPERADOR_SIP = frozenset({408, 480, 486, 600, 603})
AUDIO_ALO_PADRAO = "sound:motorcx/alo"
# mensagem de quem atendeu sem robô (como gerar: infra/asterisk/README.md, seção 4): curta, neutra, sem dívida nem credor
AUDIO_SEM_ROBO_PADRAO = "sound:motorcx/sem-robo"
MENSAGEM_SEM_ROBO_MAX_S = 15          # sem o PlaybackFinished (áudio faltando, evento perdido), desliga depois disto
SUFIXO_SEM_ROBO = "semrobo"
# desfechos que contam no freio de abandono (e na taxa de abandono da tela). A transferência sem operador (fila humana
# cheia) não entra: é transferencia_sem_operador desde o SQL 106
ABANDONOS = ("abandonada", "abandono_sem_robo")
# perna humana (V8, PREDITIVO.md 3.8): transferências sem operador acima disto nos últimos 30 min (com amostra) = fila
# humana cheia: o agente oferece o retorno antes de tentar transferir, até a janela voltar
FILA_CHEIA_PCT, FILA_AMOSTRA_MIN = 10.0, 20


@dataclass
class Chamada:
    id: str
    empresa_id: int
    idx: int
    item: ItemLote
    candidatas: list
    i_rota: int = 0
    tentativa_canal: int = 0
    canal: str | None = None
    t_origem: datetime | None = None
    t_atendeu: datetime | None = None
    no_pico: bool = False
    estado: str = "originando"     # originando | atendida | conversa | transferindo | humano | mensagem | encerrando
    causa_q850: int | None = None
    causa_sip: int | None = None
    amd: str | None = None
    veredito: str | None = None
    resultado_ia: str | None = None
    extras: dict = field(default_factory=dict)
    transferencia: str | None = None
    destino: str | None = None
    ponte: str | None = None
    canal_provedor: str | None = None
    canal_humano: str | None = None
    tf: Transferencia | None = None
    gravando: bool = False
    bucket: str | None = None
    motivo_tf: str = ""
    refer_falhou: bool = False
    lote_chave: tuple = ()
    t_fim: datetime | None = None
    t_transferencia: datetime | None = None     # quando a transferência foi pedida (voz_chamadas.transferida_em)
    espera_agente_ate: datetime | None = None
    failover_ate: datetime | None = None
    provedor: str | None = None
    conexao: str | None = None                  # tipo da conexão com o agente (sip | midia_externa | interno)
    agente_solto: bool = False                  # o agente já saiu da ligação (REFER ou humano atendeu)
    passagem: dict = field(default_factory=dict)   # passada, situação de origem, onda e volta (Lote.iniciar)
    reservada: bool = False                     # há um robô reservado para esta linha (agendador)
    prov_reserva: str | None = None             # provedor em que a sessão está reservada (Orquestrador.reservas_prov)
    conversando: bool = False                   # a linha ocupa uma conversa da empresa (o agente está nela)
    desligar_ate: datetime | None = None        # tocando a mensagem de sem robô: desliga no fim (ou neste prazo)
    sem_operador: bool = False                  # pediu humano e não houve operador (V8: conta mesmo se o agente voltou)
    ctx: object = None                          # ContextoChamada da conversa (B5: reconectar o agente sem humano)
    # SQL 125 · minuto falado com a IA (o que a empresa paga): trechos [início, fim|None, motivo do fim]. Abre quando o
    # agente entra na conversa, fecha no INÍCIO da transferência (a cobrança para ali), reabre quando o agente volta
    # sem humano; máquina, sem robô e AMD não abrem nada. A cadência e o preço são do banco (tarifar_ia_chamada_voz)
    ia_trechos: list = field(default_factory=list)
    ia_sessao_ini: datetime | None = None       # sessão do provedor (custo nosso, inclui o toque da ponte)
    ia_sessao_fim: datetime | None = None

    @property
    def candidata(self):
        return self.candidatas[self.i_rota]


def _id_de(canal_id: str) -> str:
    return canal_id.rsplit("-", 1)[0]


def _quando(v) -> datetime | None:
    """retorno_em do provedor (datetime ou texto ISO) -> horário de Brasília sem fuso."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo is None else v.astimezone(_FUSO).replace(tzinfo=None)
    try:
        d = datetime.fromisoformat(str(v).strip().replace("Z", "+00:00")) if v else None
    except ValueError:
        return None
    return None if d is None else (d if d.tzinfo is None else d.astimezone(_FUSO).replace(tzinfo=None))
_DEZ_DIGITOS = re.compile(r"[0-9]{10}")


def novo_id() -> str:
    """uuid hex sem 10 dígitos seguidos: o id vai no nome da gravação e o banco recusa caminho com 10+ dígitos (pode
    ser telefone). Sorteia de novo nesse caso (~8% dos uuid)."""
    while True:
        h = uuid.uuid4().hex
        if not _DEZ_DIGITOS.search(h):
            return h


def _int(v):
    try:
        return int(str(v).strip().split()[-1]) if v not in (None, "") else None
    except (ValueError, IndexError):
        return None


MAX_TRECHOS_IA = 5        # voz_chamadas.ia_trechos (o que passar disso vai somado no último)


def ia_abrir(c: Chamada, agora: datetime) -> None:
    """O agente está na conversa: abre um trecho cobrável (nada se já há um aberto). Reabrir no mesmo instante em que o
    anterior fechou (transferência que nem começou) continua o mesmo trecho."""
    if c.ia_trechos and c.ia_trechos[-1][1] is None:
        return
    if c.ia_trechos and c.ia_trechos[-1][1] == agora:
        c.ia_trechos[-1][1], c.ia_trechos[-1][2] = None, None
    else:
        c.ia_trechos.append([agora, None, None])
    c.ia_sessao_ini = c.ia_sessao_ini or agora


def ia_fechar(c: Chamada, agora: datetime, motivo: str) -> None:
    """Fecha o trecho aberto (transferencia | agente_encerrou | fim)."""
    if c.ia_trechos and c.ia_trechos[-1][1] is None:
        c.ia_trechos[-1][1], c.ia_trechos[-1][2] = max(agora, c.ia_trechos[-1][0]), motivo


def ia_medicao(c: Chamada) -> dict:
    """Campos do minuto de IA para voz_chamadas: soma dos trechos em milésimos e a sessão do provedor. Ligação não
    atendida não manda nada; atendida sem conversa (máquina, sem robô) manda 0."""
    if c.t_atendeu is None:
        return {}
    fechados = [t for t in c.ia_trechos if t[1] is not None]
    soma = round(sum((f - i).total_seconds() for i, f, _ in fechados), 3)
    trechos = [list(t) for t in fechados]
    if len(trechos) > MAX_TRECHOS_IA:                 # o banco guarda até 5: o resto vai no último (a soma é a real)
        trechos = trechos[:MAX_TRECHOS_IA - 1] + [[trechos[MAX_TRECHOS_IA - 1][0], trechos[-1][1], trechos[-1][2]]]
    sessao = None
    if c.ia_sessao_ini is not None:
        sessao = round(max(((c.ia_sessao_fim or c.t_fim or c.ia_sessao_ini) - c.ia_sessao_ini).total_seconds(), 0), 3)
    return {"ia_inicio_em": fechados[0][0] if fechados else None,
            "ia_fim_em": fechados[0][1] if fechados else None,
            "ia_retomada_em": fechados[1][0] if len(fechados) > 1 else None,
            "ia_trechos": trechos or None, "segundos_ia": soma, "segundos_sessao_ia": sessao}


class Orquestrador:
    def __init__(self, ari: ClienteARI, dados: DadosVoz, agendador: Agendador, escritor: EscritorEventos,
                 provedores: dict[str, ProvedorVoz], relogio: Callable[[], datetime],
                 detector: A.DetectorMaquina | None = None, fila_envio: G.FilaEnvio | None = None,
                 ao_registrar: Callable[[EventoChamada], None] | None = None, toque_max_s: int = 40,
                 toque_min_s: int = 15, transferencia_toque_s: int = 30, failover_espera_s: int = 5,
                 audio_alo: str = AUDIO_ALO_PADRAO, audio_sem_robo: str = AUDIO_SEM_ROBO_PADRAO,
                 ao_fluxo: Callable[[int, str, str, dict], None] | None = None,
                 transcricoes: TIA.GravadorTranscricaoIA | None = None,
                 ao_gravacao: Callable[[dict], None] | None = None):
        self.ari, self.dados, self.agendador, self.escritor = ari, dados, agendador, escritor
        self.provedores, self.relogio = provedores, relogio
        self.detector = detector or A.AmdAsterisk()
        self.fila_envio, self.ao_registrar = fila_envio, ao_registrar
        self.toque_max_s, self.toque_min_s = toque_max_s, toque_min_s
        self.transferencia_toque_s, self.failover_espera_s = transferencia_toque_s, failover_espera_s
        self.audio_alo, self.audio_sem_robo = audio_alo, audio_sem_robo
        self.reservas_prov: dict[str, int] = {}  # provedor -> sessões reservadas para linhas que ainda não conversam
        self.ao_fluxo = ao_fluxo                # passos e chamadas de conector do fluxo (SQL 58) → RegistroBanco
        # Speech Analytics (SQL 63): transcrição mascarada da conversa com a IA (só de ligação gravada) e a gravação da
        # IA em voz_gravacoes depois que subiu para o bucket
        self.transcricoes, self.ao_gravacao = transcricoes, ao_gravacao
        self._transcrever: dict[str, dict] = {}  # id_chamada -> {empresa_id, provedor, nomes (memória), ate}
        self.lotes: dict[tuple, Lote] = {}      # (empresa_id, credor_id, canal) -> lote
        self.aguardando: dict[str, tuple] = {}   # id_chamada -> (Chamada, prazo) esperando o resultado do provedor
        self.chamadas: dict[str, Chamada] = {}
        self.contagem: dict[str, int] = {}
        self.alertas: list[str] = []
        self.pausas_novas: list[dict] = []       # rotas pausadas aqui e ainda não gravadas no banco (o Plantão grava)
        self.medidor = Medidor()                 # ritmo por carteira × janela de 5 min (SQL 106; o Plantão grava)
        self.curtas = Curtas()                   # chamadas curtas do dia por linha e total (freios do ritmo, V6)
        self.fila_humana: dict[int, JanelaTaxa] = {}   # empresa -> transferências (sem operador?) dos últimos 30 min
        self.fila_cheia: set[int] = set()
        # "Testar agora" (SQL 116): o Plantão recebe o fim da ligação de teste (id do teste, evento, chamada). O evento
        # vai para voz_chamadas (ao_registrar) e para os medidores, mas não volta ao motor (não há cliente)
        self.ao_teste: Callable[[int, EventoChamada, "Chamada"], None] | None = None

    # ---------------------------------------------------------------- utilidades
    def _conta(self, k: str, n: int = 1):
        self.contagem[k] = self.contagem.get(k, 0) + n

    def _alerta(self, txt: str):
        if txt not in self.alertas:
            self.alertas.append(txt)
            log.warning(txt)

    def adicionar_lote(self, lote: Lote) -> None:
        self.lotes[lote.chave] = lote

    def _provedor(self, empresa_id: int) -> ProvedorVoz | None:
        cfg = self.dados.config(empresa_id)
        p = self.provedores.get(cfg.provedor)
        if p is None:
            self._alerta(f"empresa {empresa_id}: provedor '{cfg.provedor}' não configurado na VM (usando o Simulador)")
            p = self.provedores.get("simulador")
        return p

    def atualizar_dados(self, dados: DadosVoz) -> None:
        """Configuração nova do banco (voz.json mudou): rotas, transferências e limites valem já; o que está em voo
        continua com o que tinha."""
        self.dados = dados
        for emp in list(self.agendador.empresas):
            self.agendador.atualizar_empresa(dados.config(emp), dados.troncos_da(emp))

    # ---------------------------------------------------------------- ciclo
    def tick(self) -> int:
        """Um ciclo: provedores, esperas, envio de gravações e novas originações. Devolve quantas originou."""
        agora = self.relogio()
        for p in self.provedores.values():
            p.tick(agora)
        for c in list(self.chamadas.values()):
            if c.espera_agente_ate is not None:
                self._tentar_agente(c, agora)
            if c.failover_ate is not None:
                self._tentar_failover(c, agora)
            if c.desligar_ate is not None and agora >= c.desligar_ate:
                c.desligar_ate = None
                self._desligar_cliente(c)
        for cid in [k for k, v in self._transcrever.items() if agora >= v["ate"]]:
            self._transcrever.pop(cid, None)        # a transcrição não veio (provedor sem texto): nomes saem da memória
        for cid, (c, prazo) in list(self.aguardando.items()):
            if agora >= prazo:
                self._alerta(f"provedor {c.provedor}: resultado não chegou a tempo (tentativa fechada pela rede)")
                self._registrar(c)
        if self.fila_envio is not None:
            self.fila_envio.processar(agora.timestamp())
        for lote in self.lotes.values():             # o controlador do Preditivo revê o fator mesmo sem ligação nova
            self._aviso_ritmo(lote, lote.controle.rever(agora, lote.ritmo))
        for emp in list(self.agendador.empresas):    # a janela de 30 min do freio anda com o relógio
            if self.agendador.reavaliar(emp, agora.timestamp()) == "soltou":
                log.info("empresa %s: abandono dos últimos 30 min voltou ao normal — ritmo liberado", emp)
        return self._originar_rodadas(agora)

    def retrato(self, empresa_id: int, credor_id: int | None = None) -> dict:
        """Modo, razão (configurada e a que vale agora), estado da carteira e robôs da empresa agora (para as amostras
        do ritmo; só contagens)."""
        e = self.agendador.empresas.get(empresa_id)
        if e is None:
            return {}
        agora = self.relogio()
        lote = next((l for l in self.lotes.values() if l.empresa_id == empresa_id and l.credor_id == credor_id), None)
        ritmo = lote.ritmo if lote is not None else {"modo": "power", "razao": e.razao}
        razao = lote.controle.razao(ritmo, agora) if lote is not None else e.razao
        razao = self.curtas.razao(empresa_id, razao, agora)
        estado = lote.controle.estado(ritmo, agora) if lote is not None else "normal"
        curtas = self.curtas.estado(empresa_id, agora)     # parado vence; freado vence o reduzido
        if curtas == "parado" or (curtas == "reduzido" and estado != "freado"):
            estado = curtas
        return {"modo": ritmo.get("modo", "power"), "razao": razao, "razao_config": ritmo.get("razao", 1.0),
                "estado": estado, "conversas": e.conversas, "reservas": e.reservas, "linhas": e.linhas}

    def _originar_rodadas(self, agora: datetime) -> int:
        total, progresso = 0, True
        while progresso:                       # rodízio: uma por empresa por rodada (partilha justa)
            progresso = False
            for lote in self.lotes.values():
                if not self._vaga(lote, agora):
                    continue
                prox = lote.proximo(agora, reservavel=self._reservavel(lote.empresa_id))
                if prox is None:
                    continue
                r = self._originar(lote, *prox, agora)
                if r:
                    total += 1
                if r or r is None:            # None = item descartado (sem rota): segue para o próximo
                    progresso = True
        return total

    def _originar(self, lote: Lote, idx: int, item: ItemLote, agora: datetime) -> bool | None:
        # SQL 83 · B4: só número nacional (10/11 dígitos, DDD válido); emergência, 0300/0500/0800/0900, internacional
        # e curtos nunca saem. O plano de discagem do Asterisk repete a trava (voz/asterisk/gerador.py).
        motivo = DST.motivo_numero(item.telefone)
        if motivo:
            item.encerrado = True
            self._conta("numero_bloqueado")
            self._alerta(f"empresa {lote.empresa_id}: número fora do plano de discagem ({motivo}); fica fora do dia")
            return None
        cands = T.rotas_para(self.dados, lote.empresa_id, item.telefone, agora.date())
        if not cands:
            item.encerrado = True
            self._conta("sem_rota")
            self._alerta(f"empresa {lote.empresa_id}: número sem rota cadastrada para o tipo (fica fora do dia)")
            return None
        if all(x.tronco.id in self.agendador.pausados for x in cands):
            item.nao_antes_de = agora + timedelta(minutes=1)   # toda rota do número está pausada: espera a retomada
            self._conta("rota_pausada")
            return None
        c = Chamada(novo_id(), lote.empresa_id, idx, item, cands, lote_chave=lote.chave)
        for i, cand in enumerate(cands):
            if self._tronco_ok(lote.empresa_id, cand.tronco.id, agora):
                c.i_rota = i
                break
        else:
            self._conta("troncos_cheios")
            return False
        # razão 1,0: a linha sai com o robô reservado (ninguém atende sem agente). Razão > 1 (Power/Preditivo): todas
        # reservam quando ATENDEM (um robô preso a uma linha que só toca não serve a quem atendeu na linha ao lado),
        # salvo o cliente que teve abandono há pouco (ItemLote.reservar), que só sai com o seu robô
        self._reservar(c, antes=item.reservar or lote.controle.razao(lote.ritmo, agora) <= 1.0)
        c.passagem = lote.iniciar(idx, agora)
        lote.em_voo.add(idx)
        self.chamadas[c.id] = c
        if not self._discar(c, agora):
            self._desistir(c, agora)
            return False
        return True

    # ---------------------------------------------------------------- robôs (conversas) e reservas
    def _livres_provedor(self, prov: ProvedorVoz) -> int:
        """Sessões do provedor nesta VM que ninguém reservou (capacidade compartilhada entre as empresas)."""
        n = prov.livres()
        if n is None:                          # provedor que não sabe a capacidade: só o disponivel()
            return 1 if prov.disponivel() else 0
        return n - self.reservas_prov.get(prov.codigo, 0)

    def _vaga(self, lote: Lote, agora: datetime) -> bool:
        """Pode originar mais uma linha desta carteira? Robôs da empresa (agendador) e sessões do provedor nesta VM:
        com a razão 1,0 toda linha sai com a sua reserva; acima (Power/Preditivo da carteira, lote.controle), linhas
        sem conversa < razão × (livres + reservados)."""
        prov = self._provedor(lote.empresa_id)
        if prov is None:
            return False
        if self.curtas.empresa_parada(lote.empresa_id, agora):
            self._conta("empresa_parada_curtas")   # 80 % de curtas com 8.000 ligações hoje: só amanhã
            return False
        livres_prov = self._livres_provedor(prov)
        razao = self.curtas.razao(lote.empresa_id, lote.controle.razao(lote.ritmo, agora), agora)
        extra = self._liberando(lote, agora) if razao > 1.0 and lote.controle.preditivo_ativo(lote.ritmo, agora) else 0
        if self.agendador.vaga_empresa(lote.empresa_id, razao=razao, livres_max=livres_prov, livres_extra=extra):
            return True
        if livres_prov <= 0 and self.agendador.vaga_empresa(lote.empresa_id):
            self._conta("sem_robo_provedor")   # a lista espera: ninguém é discado sem robô para falar
        return False

    def _aviso_ritmo(self, lote: Lote, mudou: str | None) -> None:
        if mudou is None:
            return
        quem = f"empresa {lote.empresa_id} carteira {lote.credor_id}"
        teto = f"{DG.TETO_ABANDONO:g}%"
        if mudou == "freou" and lote.ritmo.get("modo") == "preditivo":
            self._alerta(f"{quem}: abandono acima de {teto} nos últimos 30 min — Preditivo freado (margem cortada pela "
                         "metade)")
        elif mudou in ("freou", "power"):
            self._alerta(f"{quem}: abandono acima de {teto} nos últimos 30 min — ligando 1 por robô até o fim do dia")

    def _liberando(self, lote: Lote, agora: datetime) -> int:
        """Preditivo: robôs da empresa que devem liberar até a linha nova atender (conversas que já passaram de
        conversa média − T, com T = toque médio até atender + AMD; PREDITIVO.md 3.2)."""
        limiar = max(0.0, lote.controle.conversa_s - lote.controle.T)
        return sum(1 for c in self.chamadas.values()
                   if c.empresa_id == lote.empresa_id and c.conversando and c.t_atendeu is not None
                   and (agora - c.t_atendeu).total_seconds() >= limiar)

    def _tronco_ok(self, empresa_id: int, tronco_id: int, agora: datetime) -> bool:
        """Linha parada hoje pelas curtas não disca (e não consome ficha de CPS); senão, canal e CPS do tronco."""
        if self.curtas.tronco_parado(empresa_id, tronco_id, agora):
            self._conta("linha_parada_curtas")
            return False
        return self.agendador.tronco_livre(tronco_id, agora.timestamp())

    def _reservavel(self, empresa_id: int) -> bool:
        """Há robô livre (empresa e provedor) para reservar agora?"""
        prov = self._provedor(empresa_id)
        return prov is not None and self._livres_provedor(prov) > 0 and self.agendador.livres_conversa(empresa_id) > 0

    def _reservar(self, c: Chamada, antes: bool = True) -> None:
        """Antes de originar: o robô da empresa (agendador) e a sessão do provedor ficam guardados para esta linha
        (`antes`; senão só a linha conta e o robô é reservado no atendimento)."""
        prov = self._provedor(c.empresa_id)
        livre_prov = antes and prov is not None and self._livres_provedor(prov) > 0
        c.reservada = self.agendador.ocupar(c.empresa_id, c.candidata.tronco.id, pode_reservar=livre_prov)
        if c.reservada and livre_prov:
            c.prov_reserva = prov.codigo
            self.reservas_prov[prov.codigo] = self.reservas_prov.get(prov.codigo, 0) + 1

    def _soltar_reserva(self, c: Chamada) -> None:
        """A linha não vai (ou não vai mais) conversar com a reserva: robô e sessão do provedor voltam."""
        if c.reservada:
            c.reservada = False
            self.agendador.devolver_reserva(c.empresa_id)
        self._soltar_reserva_provedor(c)

    def _soltar_reserva_provedor(self, c: Chamada) -> None:
        if c.prov_reserva is not None:
            self.reservas_prov[c.prov_reserva] = max(0, self.reservas_prov.get(c.prov_reserva, 0) - 1)
            c.prov_reserva = None

    def _vaga_robo(self, c: Chamada, prov: ProvedorVoz | None) -> bool:
        """A pessoa atendeu: há robô para ela? Com a reserva, sim, salvo se o provedor não tem sessão de verdade
        (corrida com a capacidade da VM ou falha). Sem reserva (razão > 1, ou provedor trocado no meio), só com vaga
        livre que ninguém reservou."""
        if prov is None or not prov.disponivel():
            return False
        empresa_ok = c.reservada or self.agendador.livres_conversa(c.empresa_id) > 0
        prov_ok = c.prov_reserva == prov.codigo or self._livres_provedor(prov) > 0
        return empresa_ok and prov_ok

    def _grava(self, empresa_id: int) -> bool:
        """Grava se a empresa quer E tem bucket próprio (um por empresa); sem bucket, alerta e não grava."""
        cfg = self.dados.config(empresa_id)
        if cfg.gravar and not cfg.bucket_gravacoes and self.fila_envio is not None:
            self._alerta(f"empresa {empresa_id}: gravar ligado sem bucket_gravacoes (criar_gcp.sh empresa {empresa_id} "
                         "<dias>): chamadas sem gravação")
        return cfg.gravar and bool(cfg.bucket_gravacoes) and self.fila_envio is not None

    def _variaveis(self, c: Chamada) -> dict:
        return {"MOTORCX_ID": c.id, "MOTORCX_AMD": "1" if self.detector.usa_amd_asterisk else "0",
                "MOTORCX_GRAVAR": "1" if self._grava(c.empresa_id) else "0", "MOTORCX_GRAVACAO": G.nome_arquivo(c.id),
                "MOTORCX_TECH_PREFIX": c.candidata.rota.tech_prefix}

    def _discar(self, c: Chamada, agora: datetime) -> bool:
        cand = c.candidata
        c.tentativa_canal += 1
        c.canal = f"{c.id}-c{c.tentativa_canal}"
        c.t_origem, c.estado = agora, "originando"
        try:
            self.ari.originar(cand.endpoint, c.canal, APP, ["saida", c.id], self._variaveis(c),
                              callerid=cand.tronco.bina, timeout=self.toque_max_s)
        except ErroARI as ex:
            log.warning("originate falhou (%s) no tronco %s", ex, cand.tronco.id)
            self._conta("erro_originate")
            return self._proxima_rota(c, agora)
        self._conta("originadas")
        return True

    def _proxima_rota(self, c: Chamada, agora: datetime) -> bool:
        """Passa para a próxima rota com tronco livre; False se acabaram."""
        for j in range(c.i_rota + 1, len(c.candidatas)):
            t_novo = c.candidatas[j].tronco.id
            if self._tronco_ok(c.empresa_id, t_novo, agora):
                self.agendador.trocar_tronco(c.candidata.tronco.id, t_novo)
                c.i_rota = j
                self._conta("failover")
                return self._discar(c, agora)
        return False

    def _desistir(self, c: Chamada, agora: datetime) -> None:
        """Nenhuma rota originou (erro do ARI/rede local): não é tentativa; o item volta em 1 minuto."""
        self.chamadas.pop(c.id, None)
        lote = self.lotes[c.lote_chave]
        lote.em_voo.discard(c.idx)
        c.item.nao_antes_de = agora + timedelta(minutes=1)
        self._soltar_reserva(c)
        self.agendador.liberar(c.empresa_id, c.candidata.tronco.id)

    # ---------------------------------------------------------------- eventos do ARI
    def ao_evento(self, ev: dict) -> None:
        tipo = ev.get("type")
        if tipo == "PlaybackFinished":
            self._fim_playback(ev)
            return
        canal = (ev.get("channel") or {}).get("id") or ""
        c = self.chamadas.get(_id_de(canal)) if canal else None
        if c is None:
            return
        agora = self.relogio()
        if tipo == "StasisStart":
            args = ev.get("args") or []
            etapa = args[0] if args else ""
            if etapa == "saida" and canal == c.canal:
                self._atendeu(c, agora)
            elif etapa == "amd" and canal == c.canal:
                self._resultado_amd(c, args[1:], agora)
            elif etapa == "provedor" and canal == c.canal_provedor:
                self.ari.adicionar_na_ponte(c.ponte, [canal])
                if c.estado == "conversa":         # SQL 125: o agente (SIP) entrou na ponte: a IA começa a contar
                    ia_abrir(c, agora)
            elif etapa == "humano" and canal == c.canal_humano:
                self._humano_atendeu(c, agora)
            elif etapa == "transferencia" and canal == c.canal:
                self._resultado_refer(c, args[1:], agora)
        elif tipo == "ChannelDestroyed":
            if canal == c.canal:
                self._cliente_saiu(c, ev, agora)
            elif canal == c.canal_humano:
                self._humano_saiu(c, ev, agora)
            elif canal == c.canal_provedor:
                c.canal_provedor = None
                if c.estado == "conversa":         # o provedor caiu/encerrou no meio da conversa
                    ia_fechar(c, agora, "agente_encerrou")
                    self._desligar_cliente(c)
        elif tipo == "ChannelTransfer" and canal == c.canal_provedor:
            # REFER do provedor (ElevenLabs: sip:transferir-<motivo>@...): a transferência é feita pelo MotorCX
            from voz.provedores.elevenlabs import motivo_do_refer
            destino = ((ev.get("refer_to") or {}).get("requested_destination") or {}).get("destination") or ""
            m = motivo_do_refer(destino)
            if m and c.estado == "conversa":
                self._transferir(c, m, agora)
        # tech_cause = código SIP final no evento do ARI. Confirmado no Asterisk 22.11 da imagem pelo teste de ponta a
        # ponta (404 e 503 chegam no ChannelDestroyed). Se uma versão futura não mandar, só o Q.850 decide
        # (motor/voz.py: pela_rede usa o que houver) — decisão do dono: fica assim.
        elif tipo == "ChannelHangupRequest" and canal == c.canal:
            if ev.get("cause") is not None:
                c.causa_q850 = _int(ev.get("cause"))
            if ev.get("tech_cause") not in (None, "", 0):
                c.causa_sip = _int(ev.get("tech_cause"))

    def _atendeu(self, c: Chamada, agora: datetime) -> None:
        c.t_atendeu, c.estado = agora, "atendida"
        if not c.reservada:                     # linha a mais (razão > 1): o robô é reservado no atendimento, antes
            self._reservar_no_atendimento(c)    # do AMD (máquina devolve na hora)
        self.ari.continuar(c.canal, "motorcx-atendeu", "s", 1)

    def _reservar_no_atendimento(self, c: Chamada) -> None:
        prov = self._provedor(c.empresa_id)
        if prov is None or self._livres_provedor(prov) <= 0 or not self.agendador.reservar(c.empresa_id):
            self._conta("atendeu_sem_reserva")  # o AMD ainda decide; se for pessoa, tenta um robô livre de novo
            return
        c.reservada, c.prov_reserva = True, prov.codigo
        self.reservas_prov[prov.codigo] = self.reservas_prov.get(prov.codigo, 0) + 1
        self._conta("reserva_no_atendimento")

    def _resultado_amd(self, c: Chamada, args: list, agora: datetime) -> None:
        status, causa, khomp = (list(args) + ["", "", ""])[:3]
        v = self.detector.classificar(status, causa, khomp)
        c.amd, c.veredito = v.amd or None, v.tipo
        if v.tipo != A.PESSOA:
            self._conta(f"amd_{v.tipo}")
            self._soltar_reserva(c)             # máquina/silêncio: o robô reservado volta na hora
            self._desligar_cliente(c)
            return
        c.gravando = self._grava(c.empresa_id)
        c.bucket = self.dados.config(c.empresa_id).bucket_gravacoes
        prov = self._provedor(c.empresa_id)
        if self._vaga_robo(c, prov):
            self._conectar(c, prov, agora)
            return
        # sem robô: a mensagem neutra na hora (o "Alô fake", que segurava a pessoa com um "Alô?" gravado e depois
        # derrubava, saiu no V4 do Power/Preditivo; voz_config.alo_fake* ficou sem efeito)
        self._sem_robo(c, agora)

    def _tentar_agente(self, c: Chamada, agora: datetime) -> None:
        prov = self._provedor(c.empresa_id)
        if self._vaga_robo(c, prov):
            c.espera_agente_ate = None
            self._conectar(c, prov, agora)
        elif agora >= c.espera_agente_ate:
            c.espera_agente_ate = None
            self._sem_robo(c, agora)

    def _sem_robo(self, c: Chamada, agora: datetime) -> None:
        """A pessoa atendeu e não há robô (o provedor não abriu a sessão mesmo com a reserva). Nunca desliga mudo: toca a
        mensagem curta e neutra (sem dívida nem credor) e desliga no fim dela. Desfecho abandono_sem_robo (conta no
        abandono: freio do lote, Anatel e a meta do preditivo). A reserva volta: ninguém mais vai usá-la nesta linha."""
        c.transferencia = "sem_robo"
        c.destino = c.destino or "ia"
        c.t_transferencia = c.t_transferencia or agora
        self._soltar_reserva(c)
        self._conta("abandono_sem_robo")
        prov = self.dados.config(c.empresa_id).provedor
        self._alerta(f"empresa {c.empresa_id}: pessoa atendeu sem robô livre (provedor {prov} sem sessão mesmo com a "
                     "reserva): ouviu a mensagem de abandono e a ligação foi encerrada")
        c.estado = "mensagem"
        try:
            self.ari.tocar(c.canal, self.audio_sem_robo, f"{c.id}-{SUFIXO_SEM_ROBO}")
        except ErroARI as ex:                  # sem como tocar: encerra (é o único caso em que não há mensagem)
            log.warning("mensagem de sem robô não tocou (%s)", ex)
            self._desligar_cliente(c)
            return
        c.desligar_ate = agora + timedelta(seconds=MENSAGEM_SEM_ROBO_MAX_S)

    def _fim_playback(self, ev: dict) -> None:
        """A mensagem de sem robô acabou de tocar (ou falhou): desliga."""
        pid = str((ev.get("playback") or {}).get("id") or "")
        if not pid.endswith(f"-{SUFIXO_SEM_ROBO}"):
            return
        c = self.chamadas.get(_id_de(pid))
        if c is not None and c.estado == "mensagem":
            c.desligar_ate = None
            self._desligar_cliente(c)

    def _abandonar(self, c: Chamada, motivo: str) -> None:
        """A transferência não achou humano e o agente não pôde voltar: encerra. O desfecho é
        transferencia_sem_operador (SQL 106): não conta no abandono do discador."""
        c.transferencia = motivo
        c.destino = c.destino or "ia"
        self._conta("transferencia_sem_operador")
        self._desligar_cliente(c)

    def _variaveis_fala(self, c: Chamada) -> dict:
        """Variáveis da fala do cliente (Lista do dia, em memória) que a empresa manda ao provedor: só as de
        voz_config.variaveis, todas dentro de variaveis_voz() (nunca CPF). Não vão para evento, banco nem log."""
        permitidas = set(self.dados.config(c.empresa_id).variaveis) & set(VARIAVEIS_VOZ)
        return {k: v for k, v in (c.item.variaveis or {}).items() if k in permitidas and v not in (None, "")}

    def _aviso_abertura(self, c: Chamada) -> str:
        """SQL 83 · B6: "Esta ligação é gravada." (gravando e com o aviso ligado, o padrão) + "Sou o assistente virtual
        da {empresa}." (sempre). O nome é o da empresa (assessoria), nunca o do credor."""
        cfg = self.dados.config(c.empresa_id)
        return aviso_abertura(bool(c.gravando and cfg.aviso_gravacao), (c.item.variaveis or {}).get("assessoria"))

    def _conectar(self, c: Chamada, prov: ProvedorVoz, agora: datetime) -> None:
        ctx = ContextoChamada(id_chamada=c.id, empresa_id=c.empresa_id, id_cliente=c.item.id_cliente,
                              id_acao=c.item.id_acao, final_numero=c.item.telefone[-2:],
                              variaveis=self._variaveis_fala(c),
                              credor_id=c.lote_chave[1] if c.lote_chave else None,
                              aviso_abertura=self._aviso_abertura(c))
        c.ctx = ctx
        no_pico = self.agendador.conversar(c.empresa_id, c.reservada)
        if no_pico is None:                     # sem reserva e sem robô livre (não acontece com a razão 1,0)
            self._sem_robo(c, agora)
            return
        c.reservada, c.conversando, c.no_pico = False, True, no_pico
        self._soltar_reserva_provedor(c)        # a sessão aberta passa a contar no provedor
        if c.gravando and self.transcricoes is not None:
            self._transcrever[c.id] = {"empresa_id": c.empresa_id, "provedor": prov.codigo,
                                       "nomes": TIA.nomes_da_chamada(c.item.variaveis),
                                       "ate": agora + timedelta(hours=2)}
        try:
            con = prov.iniciar(ctx, self.evento_provedor)
        except Exception as ex:   # noqa: BLE001 — provedor com erro ao abrir a sessão: mensagem, nunca hangup mudo
            self._alerta(f"provedor {prov.codigo}: não abriu a sessão ({ex.__class__.__name__})")
            self._transcrever.pop(c.id, None)
            try:
                prov.encerrar(c.id)
            except Exception:     # noqa: BLE001
                pass
            c.conversando = False
            self.agendador.fim_conversa(c.empresa_id)
            self._sem_robo(c, agora)
            return
        c.provedor, c.estado, c.destino, c.conexao = prov.codigo, "conversa", "ia", con.tipo
        c.ponte = f"{c.id}-b"
        self.ari.criar_ponte(c.ponte)
        self.ari.adicionar_na_ponte(c.ponte, [c.canal])
        if con.tipo == "sip":
            c.canal_provedor = f"{c.id}-p"
            self.ari.originar(con.endpoint, c.canal_provedor, APP, ["provedor", c.id], dict(con.variaveis),
                              timeout=15)
        elif con.tipo == "midia_externa":
            c.canal_provedor = f"{c.id}-p"
            self.ari.midia_externa(c.canal_provedor, APP, con.host_porta, con.formato)
            self.ari.adicionar_na_ponte(c.ponte, [c.canal_provedor])
            ia_abrir(c, agora)                  # SQL 125: o áudio do agente já está na ponte
        else:                                   # interno: o agente fala pelo próprio orquestrador desde iniciar()
            ia_abrir(c, agora)

    # ---------------------------------------------------------------- eventos do provedor
    def evento_provedor(self, id_chamada: str, tipo: str, dados: dict) -> None:
        if tipo == "transcricao":                  # pode chegar depois do fim (ElevenLabs): não depende da chamada viva
            self._gravar_transcricao(id_chamada, dados)
            return
        c = self.chamadas.get(id_chamada)
        if c is None and id_chamada in self.aguardando:        # resultado que chegou depois do fim da chamada
            c = self.aguardando[id_chamada][0]
            if tipo == "resultado":
                self._guardar_resultado(c, dados)
                self._registrar(c)
            return
        if c is None:
            return
        if tipo == "resultado":
            self._guardar_resultado(c, dados)
        elif tipo == "fluxo":
            c.extras["fluxo_versao_id"] = dados.get("fluxo_versao_id")
            c.extras["bloco_final"] = dados.get("bloco_final")
        elif tipo in ("passo", "conector", "link"):
            if self.ao_fluxo is not None:
                try:
                    self.ao_fluxo(c.empresa_id, c.id, tipo, dados)
                except Exception as ex:   # noqa: BLE001 — registro do fluxo nunca derruba a ligação
                    self._alerta(f"fluxo: evento {tipo} não registrado ({ex.__class__.__name__})")
        elif tipo == "transferir":
            self._transferir(c, str(dados.get("motivo") or ""), self.relogio())
        elif tipo == "encerrar":
            self._desligar_cliente(c)

    def _gravar_transcricao(self, id_chamada: str, dados: dict) -> None:
        """Só ligação gravada (sem gravação não há com que casar a análise); mascarada antes de ir ao disco."""
        meta = self._transcrever.pop(id_chamada, None)
        if meta is None or self.transcricoes is None:
            return
        try:
            self.transcricoes.salvar(meta["empresa_id"], id_chamada, meta["provedor"], dados or {}, meta["nomes"])
            self._conta("transcricao_ia")
        except Exception as ex:   # noqa: BLE001 — disco cheio etc.: a ligação segue, só fica sem análise
            self._alerta(f"transcrição da IA não gravada ({ex.__class__.__name__})")

    def _guardar_resultado(self, c: Chamada, dados: dict) -> None:
        r = dados.get("resultado_ia")
        if r and r in V.POR_CHAVE:
            c.resultado_ia = r
        elif r:
            self._alerta(f"provedor {c.provedor}: resultado desconhecido '{r}' (ignorado)")
        for k in ("identidade_confirmada", "data_promessa", "valor_promessa", "retorno_em", "duracao_ia_provedor_s"):
            if dados.get(k) is not None:
                c.extras[k] = dados[k]

    def _cabecalhos(self, c: Chamada, motivo: str, tf: Transferencia) -> dict:
        """Os cabeçalhos X-MotorCX que a transferência escolheu no banco (voz_transferencias.cabecalhos): id da
        chamada, id da ação, ação (o canal da ação no motor: agente_voz|discador) e motivo. Nunca CPF, nome ou valor."""
        valores = {"X-MotorCX-Id-Chamada": c.id, "X-MotorCX-Id-Acao": c.item.id_acao,
                   "X-MotorCX-Acao": c.lote_chave[2] if c.lote_chave else "agente_voz", "X-MotorCX-Motivo": motivo}
        return {k: str(valores[k]) for k in tf.cabecalhos if valores.get(k) not in (None, "")}

    def _destino_humano(self, c: Chamada) -> Transferencia | None:
        """Destino ativo da carteira da chamada; sem um da carteira, o da empresa toda (credor nulo)."""
        credor = c.lote_chave[1] if c.lote_chave else None
        ativos = [x for x in self.dados.transferencias if x.empresa_id == c.empresa_id and x.ativo]
        return next((x for x in ativos if credor is not None and x.credor_id == credor), None) or \
            next((x for x in ativos if x.credor_id is None), None)

    def _transferir(self, c: Chamada, motivo: str, agora: datetime) -> None:
        ia_fechar(c, agora, "transferencia")    # SQL 125: a cobrança da IA termina no INÍCIO da transferência
        c.t_transferencia = agora
        tf = self._destino_humano(c)
        if tf is None:
            self._alerta(f"empresa {c.empresa_id}: transferência pedida sem destino cadastrado (voz_transferencias)")
            self._sem_humano(c, "falhou")
            return
        if self._fila_humana_cheia(c.empresa_id, agora):
            self._conta("transferencia_fila_cheia")     # o agente oferece o retorno antes de chamar a fila
            self._sem_humano(c, "sem_operador", contar=False)
            return
        em_curso = sum(1 for x in self.chamadas.values()
                       if x.tf is not None and x.tf.id == tf.id and x.estado in ("transferindo", "humano"))
        if em_curso >= tf.simultaneas:
            self._conta("transferencia_limite_operadores")   # nunca mais que os operadores informados ao mesmo tempo
            self._sem_humano(c, "sem_operador", contar=False)
            return
        c.tf, c.estado, c.motivo_tf = tf, "transferindo", motivo
        cab = self._cabecalhos(c, motivo, tf)
        if tf.metodo == "refer":
            # REFER: validar com cada discador do cliente ("Testar transferência"); se falhar, cai na ponte
            self._soltar_provedor(c)
            self.ari.remover_da_ponte(c.ponte, [c.canal])
            hdrs = "&".join(f"{k}={v.replace(' ', '%20')}" for k, v in cab.items())
            uri = f"{tf.esquema}:{tf.tech_prefix}{tf.usuario}@{tf.host}:{tf.porta}" + (f"?{hdrs}" if hdrs else "")
            self.ari.definir_variavel(c.canal, "MOTORCX_TF_URI", uri)
            self.ari.continuar(c.canal, "motorcx-transferir", "refer", 1)
            return
        self._ponte(c, tf, cab)

    def _ponte(self, c: Chamada, tf: Transferencia, cab: dict) -> None:
        """Ponte: origina para o discador do cliente (cabeçalhos no INVITE) e só tira a IA quando o humano atende."""
        c.canal_humano = f"{c.id}-h"
        if tf.tronco_id is not None:
            tr = self.dados.tronco(tf.tronco_id)
            endpoint = f"PJSIP/{tf.tech_prefix}{tf.usuario}@{tr.nome}"
        else:
            endpoint = f"PJSIP/{tf.tech_prefix}{tf.usuario}@{tf.nome}"
        var = {f"PJSIP_HEADER(add,{k})": v for k, v in cab.items()}
        try:
            self.ari.originar(endpoint, c.canal_humano, APP, ["humano", c.id], var,
                              timeout=self.transferencia_toque_s)
        except ErroARI:
            c.canal_humano = None
            self._sem_humano(c, "falhou")

    def _resultado_refer(self, c: Chamada, args: list, agora: datetime) -> None:
        status, proto = (list(args) + ["", ""])[:2]
        if str(status).upper() == "SUCCESS":
            self._resultado_transferencia(c, False)
            c.transferencia, c.destino = "atendida", "ia_humano"
            self._conta("transferida")
            self._desligar_cliente(c)        # o discador do cliente ficou com a chamada
            return
        sip = _int(proto)
        if not c.refer_falhou and c.tf is not None and (c.tf.tronco_id is not None or c.tf.ativo):
            # alternativa automática: o cliente volta para a ponte e o MotorCX liga para o destino
            c.refer_falhou = True
            self._conta("refer_falhou_ponte")
            self.ari.adicionar_na_ponte(c.ponte, [c.canal])
            self._ponte(c, c.tf, self._cabecalhos(c, c.motivo_tf, c.tf))
            return
        self._sem_humano(c, "sem_operador" if sip in SEM_OPERADOR_SIP else "falhou")

    def _fila_humana_cheia(self, empresa_id: int, agora: datetime) -> bool:
        j = self.fila_humana.get(empresa_id)
        if j is None:
            return False
        j.podar(agora.timestamp())
        taxa = j.taxa(FILA_AMOSTRA_MIN)
        cheia = taxa is not None and taxa > FILA_CHEIA_PCT
        if cheia and empresa_id not in self.fila_cheia:
            self.fila_cheia.add(empresa_id)
            self._alerta(f"empresa {empresa_id}: sua fila humana está cheia ({taxa:.0f}% das transferências sem operador "
                         "na última meia hora) — o agente está agendando retornos")
        elif not cheia:
            self.fila_cheia.discard(empresa_id)
        return cheia

    def _resultado_transferencia(self, c: Chamada, sem_operador: bool) -> None:
        self.fila_humana.setdefault(c.empresa_id, JanelaTaxa()).contar(self.relogio().timestamp(), sem_operador)

    def _sem_humano(self, c: Chamada, motivo: str, contar: bool = True) -> None:
        """Ninguém do cliente atendeu (ou a transferência falhou), ou passou do limite de operadores / fila cheia: a
        pessoa volta para o agente, que pede desculpas e agenda um retorno (decisão do dono, 08/11/2026). Sem como
        voltar, encerra (transferencia_sem_operador). `contar`: entra na taxa da fila humana (o que nem foi tentado,
        não)."""
        c.sem_operador = True
        if contar:
            self._resultado_transferencia(c, True)
        prov = self.provedores.get(c.provedor or "")
        vivo = not c.agente_solto and (c.conexao == "interno" or c.canal_provedor is not None)
        if prov is None or c.estado not in ("conversa", "transferindo"):
            self._abandonar(c, motivo)
            return
        if vivo:
            # a conversa segue com o agente (antes de avisá-lo: ele pode encerrar na mesma hora); o desfecho vem dele
            # (ex.: retorno_agendado) e não vira abandono
            c.tf, c.canal_humano, c.estado, c.destino = None, None, "conversa", "ia"
            try:
                voltou = bool(prov.retomar_sem_humano(c.id, motivo))
            except Exception as ex:   # noqa: BLE001 — provedor com erro: tenta reconectar, senão encerra como antes
                self._alerta(f"provedor {c.provedor}: não voltou ao agente ({ex.__class__.__name__})")
                voltou = False
            if voltou:
                ia_abrir(c, self.relogio())     # SQL 125: o agente voltou (ninguém atendeu): volta a contar
                self._conta(f"transferencia_{motivo}_voltou_agente")
                return
        if self._reconectar_agente(c, prov, motivo):
            self._conta(f"transferencia_{motivo}_voltou_agente")
            self._conta("agente_reconectado")
            return
        self._abandonar(c, motivo)

    def _reconectar_agente(self, c: Chamada, prov: ProvedorVoz, motivo: str) -> bool:
        """B5: o provedor que não recebe texto no meio da conversa (ElevenLabs por SIP) é chamado de novo para a mesma
        ponte, com o motivo, e o agente pede desculpas e agenda o retorno. Só com o robô ainda desta chamada (ponte;
        no REFER o agente já saiu) e uma vez por chamada (o provedor recusa a segunda)."""
        if not c.conversando or c.conexao != "sip" or c.ponte is None or c.ctx is None:
            return False
        try:
            con = prov.reconectar_sem_humano(c.ctx, motivo, self.evento_provedor)
        except Exception as ex:   # noqa: BLE001
            self._alerta(f"provedor {c.provedor}: não reconectou o agente ({ex.__class__.__name__})")
            return False
        if con is None or con.tipo != "sip" or not con.endpoint:
            return False
        antigo = c.canal_provedor
        c.tf, c.canal_humano, c.estado, c.destino, c.agente_solto = None, None, "conversa", "ia", False
        c.resultado_ia = None                   # vale o resultado da conversa de retorno
        c.canal_provedor = f"{c.id}-q"
        if antigo:
            self.ari.desligar(antigo)
        try:
            self.ari.originar(con.endpoint, c.canal_provedor, APP, ["provedor", c.id], dict(con.variaveis), timeout=15)
        except ErroARI:
            c.canal_provedor = None
            return False
        return True

    def _humano_atendeu(self, c: Chamada, agora: datetime) -> None:
        self._resultado_transferencia(c, False)
        c.transferencia, c.destino, c.estado = "atendida", "ia_humano", "humano"
        self._conta("transferida")
        self._soltar_provedor(c)
        self.ari.adicionar_na_ponte(c.ponte, [c.canal_humano])

    def _humano_saiu(self, c: Chamada, ev: dict, agora: datetime) -> None:
        c.canal_humano = None
        if c.estado == "humano":                  # conversa com o humano acabou
            self._desligar_cliente(c)
            return
        q, s = _int(ev.get("cause")), _int(ev.get("tech_cause"))
        self._sem_humano(c, "sem_operador" if (q in SEM_OPERADOR_Q850 or s in SEM_OPERADOR_SIP) else "falhou")

    def _soltar_provedor(self, c: Chamada) -> None:
        if c.ia_sessao_ini is not None and not c.agente_solto:   # SQL 125: fim da sessão do provedor (custo)
            c.ia_sessao_fim = self.relogio()
        if c.conversando:                       # o robô fica livre para a próxima conversa
            c.conversando = False
            self.agendador.fim_conversa(c.empresa_id)
        c.agente_solto = True
        prov = self.provedores.get(c.provedor or "")
        if prov is not None:
            prov.encerrar(c.id)
        if c.canal_provedor:
            canal, c.canal_provedor = c.canal_provedor, None
            self.ari.desligar(canal)

    def _desligar_cliente(self, c: Chamada) -> None:
        if c.estado != "encerrando":
            c.estado = "encerrando"
            self.ari.desligar(c.canal)

    # ---------------------------------------------------------------- fim
    def _cliente_saiu(self, c: Chamada, ev: dict, agora: datetime) -> None:
        q = _int(ev.get("cause"))
        s = _int(ev.get("tech_cause"))
        c.causa_q850 = q if q is not None else c.causa_q850
        c.causa_sip = s if s not in (None, 0) else c.causa_sip
        if c.estado == "transferindo" and c.tf is not None and c.tf.metodo == "refer" and c.transferencia is None:
            # o discador do cliente aceitou o REFER e mandou BYE antes do resultado voltar ao Stasis
            c.transferencia = "atendida" if q == 16 else "falhou"
            c.destino = "ia_humano" if q == 16 else c.destino
        if c.t_atendeu is None:
            rede, _, _ = V.pela_rede(sip=c.causa_sip, q850=c.causa_q850)
            self._pausar_rota(c, rede)
            if rede in TECNICOS_FAILOVER and c.i_rota + 1 < len(c.candidatas):
                c.failover_ate = agora + timedelta(seconds=self.failover_espera_s)
                self._tentar_failover(c, agora)
                return
        self._finalizar(c, agora)

    def _tentar_failover(self, c: Chamada, agora: datetime) -> None:
        motivo_sip, motivo_q = c.causa_sip, c.causa_q850
        c.causa_sip = c.causa_q850 = None
        if self._proxima_rota(c, agora):
            c.failover_ate = None
            return
        c.causa_sip, c.causa_q850 = motivo_sip, motivo_q
        if agora >= c.failover_ate or all(not self._tem_canal(x.tronco.id) for x in c.candidatas[c.i_rota + 1:]):
            c.failover_ate = None
            self._finalizar(c, agora)

    def _tem_canal(self, tronco_id: int) -> bool:
        t = self.agendador.troncos.get(tronco_id)
        return (t is not None and tronco_id not in self.agendador.pausados
                and self.agendador.em_voo_tronco.get(tronco_id, 0) < t.canais)

    def _pausar_rota(self, c: Chamada, rede: str | None) -> None:
        """Sem crédito (falha da operadora com SIP 402) ou bloqueio de originação: a rota (o tronco) para de discar
        na hora, para todas as carteiras, até a equipe retomar. Vale com ou sem a regra nova da carteira."""
        motivo = ("sem_credito" if rede == "falha_operadora" and c.causa_sip == 402
                  else "bloqueio_originacao" if rede == "bloqueio_originacao" else None)
        if motivo is None:
            return
        tr = c.candidata.tronco
        if not self.agendador.pausar(tr.id, motivo):
            return
        self._conta("rotas_pausadas")
        self.pausas_novas.append({"empresa_id": c.empresa_id, "tronco_id": tr.id, "motivo": motivo,
                                  "causa_sip": c.causa_sip})
        self._alerta(f"empresa {c.empresa_id}: rota {tr.nome} pausada por "
                     f"{'sem crédito na operadora' if motivo == 'sem_credito' else 'bloqueio de originação'}"
                     " — não disca até a equipe retomar")

    def _finalizar(self, c: Chamada, agora: datetime) -> None:
        """O canal do cliente acabou: libera canal, tronco e vaga na hora. Se o provedor manda o resultado depois
        (ElevenLabs: webhook pós-chamada), a tentativa espera até espera_resultado_s antes de virar evento."""
        self.chamadas.pop(c.id, None)
        prov = self.provedores.get(c.provedor or "")
        espera = getattr(prov, "espera_resultado_s", 0) if prov is not None else 0
        ia_fechar(c, agora, "fim")              # SQL 125: a conversa com o agente acabou junto com a ligação
        if c.ia_sessao_ini is not None and not c.agente_solto:
            c.ia_sessao_fim = agora
        self._soltar_provedor(c)
        if c.canal_humano:
            self.ari.desligar(c.canal_humano)
        if c.ponte:
            self.ari.destruir_ponte(c.ponte)
        c.t_fim = agora
        c.desligar_ate = c.espera_agente_ate = None
        self._soltar_reserva(c)                 # não atendeu, falhou ou desligou no AMD: o robô reservado volta
        self.agendador.liberar(c.empresa_id, c.candidata.tronco.id)
        if espera and c.veredito == A.PESSOA and c.resultado_ia is None:
            self.aguardando[c.id] = (c, agora + timedelta(seconds=espera))
            return
        self._registrar(c)

    def _registrar(self, c: Chamada) -> None:
        self.aguardando.pop(c.id, None)
        agora = c.t_fim
        cand = c.candidata
        billsec = int((agora - c.t_atendeu).total_seconds()) if c.t_atendeu else 0
        toque = int(((c.t_atendeu or agora) - c.t_origem).total_seconds()) if c.t_origem else None
        tar = T.tarifar(self.dados, c.empresa_id, cand.rota.tech_prefix, billsec, agora.date())
        if tar["alerta"]:
            self._alerta(f"empresa {c.empresa_id}: {tar['alerta']} (tech prefix {cand.rota.tech_prefix})")
        ev = EventoChamada(
            empresa_id=c.empresa_id, id_cliente=c.item.id_cliente, numero_discado=c.item.telefone,
            data=(c.t_origem or agora).date(), hora=(c.t_origem or agora).time().replace(microsecond=0),
            id_chamada=c.id, resultado=c.resultado_ia or (
                # pessoa atendeu e falou com o agente, mas o provedor não registrou resultado
                "atendida_sem_cpc" if c.veredito == A.PESSOA and c.provedor and c.transferencia is None else SEM_IA), billsec=billsec, toque=toque,
            causa_sip=c.causa_sip, causa_q850=c.causa_q850, dialstatus="ANSWER" if c.t_atendeu else None,
            amd=c.amd, transferencia=c.transferencia, destino=c.destino,
            rota=f"{cand.tronco.nome}/{cand.rota.tech_prefix}",
            identidade_confirmada=c.extras.get("identidade_confirmada"),
            data_promessa=c.extras.get("data_promessa"), valor_promessa=c.extras.get("valor_promessa"),
            retorno_em=c.extras.get("retorno_em"), id_acao=c.item.id_acao,
            fluxo_versao_id=c.extras.get("fluxo_versao_id"), bloco_final=c.extras.get("bloco_final"), tronco_id=cand.tronco.id,
            tech_prefix=cand.rota.tech_prefix, rota_id=tar["rota_id"], segundos_tarifados=tar["segundos_tarifados"],
            preco_minuto=tar["preco_minuto"], custo_operadora=tar["custo_operadora"], no_pico=c.no_pico,
            provedor=c.provedor, credor_id=c.lote_chave[1] if c.lote_chave else None,
            canal=c.lote_chave[2] if c.lote_chave else "agente_voz", custo=tar["custo_operadora"] or 0.0,
            modo=self.dados.config(c.empresa_id).modo, atendida_em=c.t_atendeu, encerrada_em=agora,
            transferida_em=(c.t_transferencia or agora) if c.transferencia else None,
            lote_id=self.lotes[c.lote_chave].lote_id if c.lote_chave in self.lotes else None,
            destino_hash=hash_destino(c.item.telefone), passada=c.passagem.get("passada"),
            situacao_origem=c.passagem.get("situacao_origem"), resubmit_ref=c.passagem.get("resubmit_ref"),
            onda_chave=c.passagem.get("onda_chave"), **ia_medicao(c))
        dur = c.extras.get("duracao_ia_provedor_s")
        if dur is not None and ev.segundos_sessao_ia is not None and abs(float(dur) - ev.segundos_sessao_ia) > 2:
            self._conta("divergencia_duracao_ia")     # só monitoramento: quem cobra é a medição da VM
        if c.gravando and c.t_atendeu and self.fila_envio is not None:
            objeto = G.nome_objeto(c.lote_chave[1] if c.lote_chave else None, ev.data, c.id)
            ev.gravacao = f"gs://{c.bucket}/{objeto}"
            ao_enviar = None
            if self.ao_gravacao is not None:       # depois do upload: voz_gravacoes (origem ia), casa com a transcrição
                linha = {"empresa_id": c.empresa_id, "id_chamada": c.id, "caminho": objeto, "duracao_s": billsec}
                ao_enviar = lambda _uri, linha=linha: self.ao_gravacao(linha)   # noqa: E731
            self.fila_envio.agendar(G.nome_arquivo(c.id), objeto, ao_enviar=ao_enviar, bucket=c.bucket)
        classificar(ev, self.toque_min_s)
        self.medidor.contar(c.empresa_id, c.lote_chave[1] if c.lote_chave else None, cand.tronco.id, ev.desfecho,
                            c.veredito == A.PESSOA, c.t_atendeu is not None, billsec, agora,
                            sem_operador=c.sem_operador)
        self.curtas.contar(c.empresa_id, cand.tronco.id, e_curta(ev.desfecho, c.t_atendeu is not None, billsec), agora)
        for av in self.curtas.avisos:
            self._alerta(av)
        self.curtas.avisos.clear()
        lote = self.lotes.get(c.lote_chave)
        teste = lote.teste_id if lote is not None else None
        if teste is None:
            self.escritor.escrever(ev)
        if self.ao_registrar is not None:
            self.ao_registrar(ev)
        if lote is not None:
            lote.em_voo.discard(c.idx)
            lote.registrar(c.item, ev.desfecho, self.relogio(), causa_sip=c.causa_sip,
                           retorno_em=_quando(c.extras.get("retorno_em")), id_chamada=c.id)
            for al in lote.alertas:              # alertas do lote (a pausa da rota é do núcleo)
                self._alerta(al)
            lote.alertas.clear()
        if lote is not None:
            lote.controle.discou(agora, c.veredito == A.PESSOA, toque, billsec if c.provedor else None)
        if c.veredito == A.PESSOA and lote is not None:
            self._aviso_ritmo(lote, lote.controle.resultado_pessoa(ev.desfecho in ABANDONOS, agora, lote.ritmo))
        if c.veredito == A.PESSOA:
            mudou = self.agendador.resultado_pessoa(c.empresa_id, ev.desfecho in ABANDONOS, agora.timestamp())
            if mudou == "freou":
                self._alerta(f"empresa {c.empresa_id}: abandono acima de "
                             f"{self.dados.config(c.empresa_id).abandono_max_pct:g}% — ritmo reduzido")
        self._conta(f"desfecho_{ev.desfecho}")
        if teste is not None and self.ao_teste is not None:
            self.ao_teste(teste, ev, c)
