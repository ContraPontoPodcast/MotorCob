"""Interface ProvedorVoz: o que fala com a pessoa depois que o Asterisk confirmou que é gente.

O orquestrador chama `iniciar` com o contexto da chamada (sem CPF, nome ou valor: só ids e as variáveis
permitidas do roteiro) e recebe uma Conexao dizendo como ligar o áudio:
  sip            o Asterisk origina para `endpoint` (ex.: ElevenLabs) e faz a ponte;
  midia_externa  o Asterisk manda o RTP para `host_porta` (ARI externalMedia; ex.: Montagem MotorCX/Pipecat);
  interno        sem áudio (Simulador).
O provedor devolve o que aconteceu por `emitir(id_chamada, tipo, dados)`:
  resultado   {resultado_ia, identidade_confirmada?, data_promessa?, valor_promessa?, retorno_em?}
  transferir  {motivo}  (cpc, pedido_humano, ofertas_sem_acordo, fora_alcada, contestacao)
  encerrar    {}
Com o fluxo (SQL 58, voz/fluxo.py) também:
  passo       {ordem, bloco_id, modo, saida_quando, intencao, confianca_faixa, motivo_devolucao, trava, turnos,
               fluxo_versao_id}  → voz_fluxo_passos
  conector    {conector_id, classe, http_status, latencia_ms, tentativa, resultado_codigo, ...} → crm_chamadas
  fluxo       {fluxo_versao_id, bloco_final} → voz_chamadas
  link        {canal, modelo_id}  (envio do link pela Mensageria)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

TIPOS_CONEXAO = ("sip", "midia_externa", "interno")
TIPOS_EVENTO = ("resultado", "transferir", "encerrar", "passo", "conector", "fluxo", "link")
MOTIVOS_TRANSFERENCIA = ("cpc", "pedido_humano", "ofertas_sem_acordo", "fora_alcada", "contestacao")


def aviso_abertura(gravada: bool, empresa: str | None = None) -> str:
    """SQL 83 · B6 (decisão do dono, 08/11/2026): a abertura diz que a ligação é gravada (quando é gravada e a empresa
    deixou o aviso ligado, o padrão) e que quem fala é um assistente virtual, em todas as carteiras. Nunca o credor
    nem a dívida: isso só depois de confirmar a identidade (trava do fluxo)."""
    nome = " ".join(str(empresa or "").split())[:80]
    quem = f"Sou o assistente virtual da {nome}." if nome else "Sou um assistente virtual."
    return ("Esta ligação é gravada. " if gravada else "") + quem


@dataclass(frozen=True)
class ContextoChamada:
    id_chamada: str
    empresa_id: int
    id_cliente: str
    id_acao: str = ""
    tipo_agente: str = "ambos"              # localizador | negociador | ambos
    variaveis: dict = field(default_factory=dict, repr=False)   # da Lista do dia, só memória (nunca em log)
    final_numero: str = ""                  # últimos 2 dígitos (só para simulação/diagnóstico)
    credor_id: int | None = None            # carteira (o fluxo em uso é por carteira, SQL 58)
    aviso_abertura: str = ""                # SQL 83 · B6: dito ANTES da primeira fala (gravação e assistente virtual)


@dataclass(frozen=True)
class Conexao:
    tipo: str
    endpoint: str | None = None             # sip: "PJSIP/<destino>@pv-elevenlabs"
    host_porta: str | None = None           # midia_externa: "127.0.0.1:40000"
    formato: str = "slin16"
    variaveis: dict = field(default_factory=dict)   # vão no INVITE (PJSIP_HEADER) no tipo sip


Emitir = Callable[[str, str, dict], None]


class ProvedorVoz:
    codigo = "base"

    def disponivel(self) -> bool:
        """Há agente livre agora? (o orquestrador reserva antes de originar; sem agente quando a pessoa atende — corrida
        ou falha do provedor —: Alô fake, se ligado, e depois a mensagem curta de abandono_sem_robo)"""
        return True

    def livres(self) -> int | None:
        """Sessões livres agora nesta VM (capacidade − sessões abertas), para o orquestrador reservar o robô ANTES de
        originar. None = o provedor não sabe dizer (vale só disponivel())."""
        return None

    def limites(self) -> dict:
        return {}

    def iniciar(self, ctx: ContextoChamada, emitir: Emitir) -> Conexao:
        raise NotImplementedError

    def encerrar(self, id_chamada: str) -> None:
        """A chamada acabou (pessoa desligou ou transferiu): libera a sessão."""

    def retomar_sem_humano(self, id_chamada: str, motivo: str) -> bool:
        """A transferência pedida não chegou a um humano (motivo: sem_operador | falhou) e a pessoa continua na linha:
        o agente volta, pede desculpas e oferece agendar um retorno (registrar_resultado retorno_agendado). True = o
        agente voltou; False = este provedor não sabe voltar (o orquestrador encerra como abandono, como antes)."""
        return False

    def tick(self, agora: datetime) -> None:
        """Chamado a cada ciclo do orquestrador (provedores que simulam tempo)."""
