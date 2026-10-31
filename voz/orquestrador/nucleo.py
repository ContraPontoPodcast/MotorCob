"""Orquestrador ARI: do lote do dia ao evento de cada tentativa.

Fluxo de uma tentativa (id_chamada = uuid hex; canais <id>-c<n> cliente, <id>-p provedor, <id>-h humano):
  1. tick: a guarda libera um item, o agendador tem vaga (empresa, global, canal e CPS do tronco) e há rota para
     o tipo do número -> originate PJSIP/<tech prefix><DDD+número>@<tronco> no app Stasis.
  2. falha técnica antes de atender (pela_rede = falha_operadora/bloqueio_originacao) -> próxima rota (failover).
  3. atendeu (StasisStart 'saida') -> dialplan motorcx-atendeu: AMD (ou Khomp) e MixMonitor só em pessoa ->
     volta ao Stasis ('amd').
  4. pessoa -> provedor de voz (ponte SIP, mídia externa ou interno); sem agente livre: Alô fake (se ligado) por até
     alo_fake_max_s e depois abandono (transferencia = sem_operador).
  5. o provedor pede humano -> transferência por REFER (dialplan motorcx-transferir) ou ponte (originate para o
     discador do cliente); resultado atendida | sem_operador | falhou.
  6. o canal do cliente acabou -> evento (CDR, Q.850, SIP, AMD, billsec, toque, rota/tech prefix, segundos
     tarifados, custo, transferência) classificado com motor/voz.py, guarda e agendador atualizados, gravação na
     fila de envio para o GCS.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable

from motor import voz as V
from voz import tarifacao as T
from voz.banco import DadosVoz, Transferencia
from voz.orquestrador import amd as A
from voz.orquestrador import gravacao as G
from voz.orquestrador.agendador import Agendador
from voz.orquestrador.ari import ClienteARI, ErroARI
from voz.orquestrador.eventos import SEM_IA, EscritorEventos, EventoChamada, classificar
from voz.orquestrador.lote import ItemLote, Lote
from voz.provedores.base import ContextoChamada, ProvedorVoz

log = logging.getLogger("motorcx.voz")
APP = "motorcx"
TECNICOS_FAILOVER = ("falha_operadora", "bloqueio_originacao")
# Q.850 do destino da transferência que quer dizer "ninguém para atender" (o resto é falha)
SEM_OPERADOR_Q850 = frozenset({17, 18, 19, 21, 31})
SEM_OPERADOR_SIP = frozenset({408, 480, 486, 600, 603})
AUDIO_ALO_PADRAO = "sound:motorcx/alo"


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
    estado: str = "originando"     # originando | atendida | conversa | transferindo | humano | encerrando
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
    espera_agente_ate: datetime | None = None
    failover_ate: datetime | None = None
    provedor: str | None = None

    @property
    def candidata(self):
        return self.candidatas[self.i_rota]


def _id_de(canal_id: str) -> str:
    return canal_id.rsplit("-", 1)[0]


def _int(v):
    try:
        return int(str(v).strip().split()[-1]) if v not in (None, "") else None
    except (ValueError, IndexError):
        return None


class Orquestrador:
    def __init__(self, ari: ClienteARI, dados: DadosVoz, agendador: Agendador, escritor: EscritorEventos,
                 provedores: dict[str, ProvedorVoz], relogio: Callable[[], datetime],
                 detector: A.DetectorMaquina | None = None, fila_envio: G.FilaEnvio | None = None,
                 ao_registrar: Callable[[EventoChamada], None] | None = None, toque_max_s: int = 40,
                 toque_min_s: int = 15, transferencia_toque_s: int = 30, failover_espera_s: int = 5,
                 audio_alo: str = AUDIO_ALO_PADRAO,
                 ao_fluxo: Callable[[int, str, str, dict], None] | None = None):
        self.ari, self.dados, self.agendador, self.escritor = ari, dados, agendador, escritor
        self.provedores, self.relogio = provedores, relogio
        self.detector = detector or A.AmdAsterisk()
        self.fila_envio, self.ao_registrar = fila_envio, ao_registrar
        self.toque_max_s, self.toque_min_s = toque_max_s, toque_min_s
        self.transferencia_toque_s, self.failover_espera_s = transferencia_toque_s, failover_espera_s
        self.audio_alo = audio_alo
        self.ao_fluxo = ao_fluxo                # passos e chamadas de conector do fluxo (SQL 58) → RegistroBanco
        self.lotes: dict[tuple, Lote] = {}      # (empresa_id, credor_id, canal) -> lote
        self.aguardando: dict[str, tuple] = {}   # id_chamada -> (Chamada, prazo) esperando o resultado do provedor
        self.chamadas: dict[str, Chamada] = {}
        self.contagem: dict[str, int] = {}
        self.alertas: list[str] = []

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
        for cid, (c, prazo) in list(self.aguardando.items()):
            if agora >= prazo:
                self._alerta(f"provedor {c.provedor}: resultado não chegou a tempo (tentativa fechada pela rede)")
                self._registrar(c)
        if self.fila_envio is not None:
            self.fila_envio.processar(agora.timestamp())
        return self._originar_rodadas(agora)

    def _originar_rodadas(self, agora: datetime) -> int:
        total, progresso = 0, True
        while progresso:                       # rodízio: uma por empresa por rodada (partilha justa)
            progresso = False
            for lote in self.lotes.values():
                if not self.agendador.vaga_empresa(lote.empresa_id):
                    continue
                prox = lote.proximo(agora)
                if prox is None:
                    continue
                r = self._originar(lote, *prox, agora)
                if r:
                    total += 1
                if r or r is None:            # None = item descartado (sem rota): segue para o próximo
                    progresso = True
        return total

    def _originar(self, lote: Lote, idx: int, item: ItemLote, agora: datetime) -> bool | None:
        cands = T.rotas_para(self.dados, lote.empresa_id, item.telefone, agora.date())
        if not cands:
            item.encerrado = True
            self._conta("sem_rota")
            self._alerta(f"empresa {lote.empresa_id}: número sem rota cadastrada para o tipo (fica fora do dia)")
            return None
        c = Chamada(uuid.uuid4().hex, lote.empresa_id, idx, item, cands, lote_chave=lote.chave)
        for i, cand in enumerate(cands):
            if self.agendador.tronco_livre(cand.tronco.id, agora.timestamp()):
                c.i_rota = i
                break
        else:
            self._conta("troncos_cheios")
            return False
        c.no_pico = self.agendador.ocupar(lote.empresa_id, c.candidata.tronco.id)
        lote.em_voo.add(idx)
        self.chamadas[c.id] = c
        if not self._discar(c, agora):
            self._desistir(c, agora)
            return False
        return True

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
            if self.agendador.tronco_livre(t_novo, agora.timestamp()):
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
        self.agendador.liberar(c.empresa_id, c.candidata.tronco.id)

    # ---------------------------------------------------------------- eventos do ARI
    def ao_evento(self, ev: dict) -> None:
        tipo = ev.get("type")
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
        self.ari.continuar(c.canal, "motorcx-atendeu", "s", 1)

    def _resultado_amd(self, c: Chamada, args: list, agora: datetime) -> None:
        status, causa, khomp = (list(args) + ["", "", ""])[:3]
        v = self.detector.classificar(status, causa, khomp)
        c.amd, c.veredito = v.amd or None, v.tipo
        if v.tipo != A.PESSOA:
            self._conta(f"amd_{v.tipo}")
            self._desligar_cliente(c)
            return
        c.gravando = self._grava(c.empresa_id)
        c.bucket = self.dados.config(c.empresa_id).bucket_gravacoes
        prov = self._provedor(c.empresa_id)
        if prov is not None and prov.disponivel():
            self._conectar(c, prov, agora)
            return
        cfg = self.dados.config(c.empresa_id)
        if cfg.alo_fake_ativo:
            self.ari.tocar(c.canal, self.audio_alo, f"{c.id}-alo")
            c.espera_agente_ate = agora + timedelta(seconds=cfg.alo_fake_max_s)
            self._conta("alo_fake")
            return
        self._abandonar(c, "sem_operador")

    def _tentar_agente(self, c: Chamada, agora: datetime) -> None:
        prov = self._provedor(c.empresa_id)
        if prov is not None and prov.disponivel():
            c.espera_agente_ate = None
            self._conectar(c, prov, agora)
        elif agora >= c.espera_agente_ate:
            c.espera_agente_ate = None
            self._abandonar(c, "sem_operador")

    def _abandonar(self, c: Chamada, motivo: str) -> None:
        """Sem destino (agente ou humano): derruba e registra como abandono (V24)."""
        c.transferencia = motivo
        c.destino = c.destino or "ia"
        self._conta("abandono")
        self._desligar_cliente(c)

    def _conectar(self, c: Chamada, prov: ProvedorVoz, agora: datetime) -> None:
        ctx = ContextoChamada(id_chamada=c.id, empresa_id=c.empresa_id, id_cliente=c.item.id_cliente,
                              id_acao=c.item.id_acao, final_numero=c.item.telefone[-2:],
                              credor_id=c.lote_chave[1] if c.lote_chave else None)
        con = prov.iniciar(ctx, self.evento_provedor)
        c.provedor, c.estado, c.destino = prov.codigo, "conversa", "ia"
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

    # ---------------------------------------------------------------- eventos do provedor
    def evento_provedor(self, id_chamada: str, tipo: str, dados: dict) -> None:
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

    def _guardar_resultado(self, c: Chamada, dados: dict) -> None:
        r = dados.get("resultado_ia")
        if r and r in V.POR_CHAVE:
            c.resultado_ia = r
        elif r:
            self._alerta(f"provedor {c.provedor}: resultado desconhecido '{r}' (ignorado)")
        for k in ("identidade_confirmada", "data_promessa", "valor_promessa", "retorno_em"):
            if dados.get(k) is not None:
                c.extras[k] = dados[k]

    def _cabecalhos(self, c: Chamada, motivo: str, tf: Transferencia) -> dict:
        """Cabeçalhos X-MotorCX (id da chamada, cliente, ação, motivo) + os fixos. Nunca CPF, nome ou valor."""
        cab = {"X-MotorCX-Id": c.id, "X-MotorCX-Cliente": c.item.id_cliente, "X-MotorCX-Acao": c.item.id_acao,
               "X-MotorCX-Motivo": motivo}
        cab.update(tf.cabecalhos)
        return {k: str(v) for k, v in cab.items() if v not in (None, "")}

    def _transferir(self, c: Chamada, motivo: str, agora: datetime) -> None:
        tf = next((x for x in self.dados.transferencias if x.empresa_id == c.empresa_id and x.ativo), None)
        if tf is None:
            self._alerta(f"empresa {c.empresa_id}: transferência pedida sem destino cadastrado (voz_transferencias)")
            self._abandonar(c, "falhou")
            return
        c.tf, c.estado, c.motivo_tf = tf, "transferindo", motivo
        cab = self._cabecalhos(c, motivo, tf)
        if tf.metodo == "refer":
            # REFER: validar com cada discador do cliente ("Testar transferência"); se falhar, cai na ponte
            self._soltar_provedor(c)
            self.ari.remover_da_ponte(c.ponte, [c.canal])
            hdrs = "&".join(f"{k}={v.replace(' ', '%20')}" for k, v in cab.items())
            uri = f"sip:{tf.tech_prefix}{tf.usuario}@{tf.host}:{tf.porta}" + (f"?{hdrs}" if hdrs else "")
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
            self._abandonar(c, "falhou")

    def _resultado_refer(self, c: Chamada, args: list, agora: datetime) -> None:
        status, proto = (list(args) + ["", ""])[:2]
        if str(status).upper() == "SUCCESS":
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
        self._abandonar(c, "sem_operador" if sip in SEM_OPERADOR_SIP else "falhou")

    def _humano_atendeu(self, c: Chamada, agora: datetime) -> None:
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
        self._abandonar(c, "sem_operador" if (q in SEM_OPERADOR_Q850 or s in SEM_OPERADOR_SIP) else "falhou")

    def _soltar_provedor(self, c: Chamada) -> None:
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
        return t is not None and self.agendador.em_voo_tronco.get(tronco_id, 0) < t.canais

    def _finalizar(self, c: Chamada, agora: datetime) -> None:
        """O canal do cliente acabou: libera canal, tronco e vaga na hora. Se o provedor manda o resultado depois
        (ElevenLabs: webhook pós-chamada), a tentativa espera até espera_resultado_s antes de virar evento."""
        self.chamadas.pop(c.id, None)
        prov = self.provedores.get(c.provedor or "")
        espera = getattr(prov, "espera_resultado_s", 0) if prov is not None else 0
        self._soltar_provedor(c)
        if c.canal_humano:
            self.ari.desligar(c.canal_humano)
        if c.ponte:
            self.ari.destruir_ponte(c.ponte)
        c.t_fim = agora
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
            canal=c.lote_chave[2] if c.lote_chave else "agente_voz", custo=tar["custo_operadora"] or 0.0)
        if c.gravando and c.t_atendeu and self.fila_envio is not None:
            objeto = G.nome_objeto(c.lote_chave[1] if c.lote_chave else None, ev.data, c.id)
            ev.gravacao = f"gs://{c.bucket}/{objeto}"
            self.fila_envio.agendar(G.nome_arquivo(c.id), objeto, bucket=c.bucket)
        classificar(ev, self.toque_min_s)
        self.escritor.escrever(ev)
        if self.ao_registrar is not None:
            self.ao_registrar(ev)
        lote = self.lotes.get(c.lote_chave)
        if lote is not None:
            lote.em_voo.discard(c.idx)
            lote.guarda.registrar(c.item, ev.desfecho, self.relogio())
        if c.veredito == A.PESSOA:
            mudou = self.agendador.resultado_pessoa(c.empresa_id, ev.desfecho == "abandonada")
            if mudou == "freou":
                self._alerta(f"empresa {c.empresa_id}: abandono acima de "
                             f"{self.dados.config(c.empresa_id).abandono_max_pct:g}% — ritmo reduzido")
        self._conta(f"desfecho_{ev.desfecho}")
