"""Testar agora (SQL 116; PR 9 do plano Canais/Agente Voz/CX): uma ligação de verdade para um número de teste.

O site pede (pedir_teste_agora_voz: permissão, número guardado e confirmado, fluxo em uso, rota ativa, curtas, limites).
O Plantão pega o pedido (pegar_teste_agora_voz, com a referência do segredo, nunca o número), lê o número no cofre
(Secret Manager, como a senha do tronco), confere o hash, o plano de discagem nacional, a janela de hoje pela UF/DDD do
número (tabela da carteira + prévia; domingo e feriado nunca) e o freio de curtas da empresa, e põe um lote de um item só
no orquestrador. A ligação sai pelo mesmo caminho das do lote: rota de hoje com failover, tronco isolado e CPS, linha
parada pelas curtas, robô reservado antes de discar (Power 1,0: ninguém atende sem agente), aviso de gravação e
"assistente virtual" na abertura, o fluxo em uso da carteira (identidade antes da dívida) e a gravação, se a empresa
grava. Conta como ligação (voz_chamadas, no modo da empresa; amostras do ritmo e curtas), mas não volta ao motor como
retorno de cliente (não existe cliente). No fim, concluir_teste_agora_voz recebe só marcas e contagens.

O número fica só na memória do item (ItemLote.telefone, fora de log); o id do "cliente" é teste-agora-<id>.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime

from motor import discagem as DG
from voz import destinos as DST
from voz.orquestrador.lote import ItemLote, Lote, hash_destino

log = logging.getLogger("motorcx.voz")

PREFIXO = "teste-agora-"
ESPERA_MAX_S = 5 * 60          # sem conseguir discar em 5 min (troncos ou robôs ocupados): recusa e libera
BASE = ("08:00", "20:00")
# situações em que o celular chegou a tocar (sem atender)
TOCOU = frozenset({"nao_atendida", "ocupado", "caixa_postal", "maquina"})


@dataclass
class TesteEmCurso:
    id: int
    lote: Lote
    inicio_s: float
    concluido: bool = False
    extra: dict = field(default_factory=dict)


def janela_de_hoje(numero: str, dia, tabela: dict | None):
    """(de, até) em Brasília para o número hoje, ou (None, motivo). Tabela da carteira por cima da prévia."""
    hor = DG.Horarios(tabela)
    jan = hor.janela(dia, numero, BASE)
    return (jan, None) if jan else (None, hor.motivo(dia, numero))


def item_de_teste(teste_id: int, numero: str, janela, variaveis: dict) -> ItemLote:
    """Um item de lote, uma tentativa só, sem variável do cliente (só o nome da carteira e da empresa)."""
    return ItemLote(id_cliente=f"{PREFIXO}{int(teste_id)}", telefone=numero, ordem=1, tentativas_max_numero=1,
                    tentativas_max_cliente=1, janela_local=janela, uf=DG.DDD_UF.get(numero[:2], ""),
                    id_acao="teste_agora", variaveis=dict(variaveis))


def conferir(ped: dict, numero: str, agora: datetime, tabela: dict | None, parada: bool) -> tuple[object, str | None]:
    """Antes de discar: hash do cofre, plano nacional, janela da UF e curtas. Devolve (janela, motivo da recusa)."""
    if hash_destino(numero) != str(ped.get("hash") or ""):
        return None, "o número guardado no cofre não confere com o do pedido"
    m = DST.motivo_numero(numero)
    if m:
        return None, f"número fora do plano de discagem ({m})"
    jan, motivo = janela_de_hoje(numero, agora.date(), tabela)
    if jan is None:
        return None, f"fora do horário de hoje para o número ({motivo})"
    hhmm = agora.strftime("%H:%M")
    if not (jan[0] <= hhmm < jan[1]):
        return None, f"fora do horário de hoje para o número: liga das {jan[0]} às {jan[1]} (Brasília)"
    if parada:
        return None, "a empresa ou a linha parou pelas chamadas curtas hoje (volta amanhã às 08:00)"
    return jan, None


def passos(ev, gravando: bool, aviso_gravacao: bool, agente: bool) -> dict:
    """O que o teste mostra na tela: só marcas e contagens (nunca texto da conversa)."""
    sit = DG.situacao_de(ev.desfecho, ev.causa_sip)
    atendeu = bool(ev.billsec) or ev.dialstatus == "ANSWER"
    p = {"tocou": atendeu or sit in TOCOU, "atendeu": atendeu, "agente": bool(agente and atendeu),
         "gravada": bool(gravando and atendeu), "aviso_gravacao": bool(gravando and atendeu and aviso_gravacao),
         "identidade_confirmada": bool(ev.identidade_confirmada), "transferiu": ev.transferencia is not None,
         "segundos": int(ev.billsec or 0)}
    if ev.toque is not None:
        p["toque_s"] = max(0, min(int(ev.toque), 7200))
    if ev.causa_sip and 100 <= int(ev.causa_sip) <= 699:
        p["sip"] = int(ev.causa_sip)
    return p


def motivo_sem_ligacao(lote: Lote) -> str:
    """Por que o item saiu sem discar (contagens do núcleo e do lote, sem o número)."""
    if lote.motivos:
        k = max(lote.motivos, key=lote.motivos.get)
        return f"não discou: {k.replace('_', ' ')}"
    return "não discou: sem rota para o tipo do número ou número fora do plano de discagem"
