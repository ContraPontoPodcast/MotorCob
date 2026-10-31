"""Evento de cada tentativa (o CDR do MotorCX), no formato que o motor já lê.

Uma linha por tentativa num CSV de ocorrência (separador ';') com as colunas de voz de motor/ingestao.py
(numero_discado, billsec, id_chamada, causa_sip, causa_q850, dialstatus, amd, toque, transferencia, destino, rota,
identidade_confirmada, valor_promessa, retorno_em…). LAYOUT_OCORRENCIA é o layout para motor/entrada.py
(LayoutOcorrencia): o motor classifica a tentativa com voz.classificar_chamada, a mesma função usada aqui para
o resultado gravado em voz_chamadas — não há uma segunda tabela de causas.

Coluna `resultado` = o evento da IA (desfecho de voz) ou SEM_IA quando a IA não falou (máquina, não atendeu,
falha…): SEM_IA vira "não atende" genérico e cede para o que a rede detalhou (voz.FRACOS).
As colunas a mais (tech_prefix, rota_id, segundos_tarifados, custo_operadora, gravacao, no_pico, desfecho…) o
motor ignora; servem a voz_chamadas (V21) e ao consumo_voz (V22).
"""
from __future__ import annotations

import csv
import os
from dataclasses import asdict, dataclass, fields
from datetime import date, datetime, time
from pathlib import Path

from motor import voz as V

SEM_IA = "SEM_IA"
CANAL = "agente_voz"


@dataclass
class EventoChamada:
    empresa_id: int
    id_cliente: str
    numero_discado: str
    data: date
    hora: time
    id_chamada: str
    resultado: str = SEM_IA           # evento da IA (desfecho) ou SEM_IA
    billsec: int = 0
    toque: int | None = None
    causa_sip: int | None = None
    causa_q850: int | None = None
    dialstatus: str | None = None
    amd: str | None = None
    transferencia: str | None = None  # atendida | sem_operador | falhou
    destino: str | None = None        # ia | ia_humano
    rota: str | None = None           # tronco/tech prefix (trava de lote por rota)
    identidade_confirmada: bool | None = None
    data_promessa: date | None = None
    valor_promessa: float | None = None
    retorno_em: datetime | None = None
    # fora do motor (voz_chamadas / consumo_voz)
    id_acao: str = ""
    tronco_id: int | None = None
    tech_prefix: str | None = None
    rota_id: int | None = None
    segundos_tarifados: int | None = None
    preco_minuto: float | None = None
    custo_operadora: float | None = None
    no_pico: bool = False
    gravacao: str | None = None
    provedor: str | None = None
    desfecho: str | None = None
    origem_desfecho: str | None = None
    avisos: str = ""


CAMPOS = tuple(f.name for f in fields(EventoChamada))

LAYOUT_OCORRENCIA = {
    "arquivo": "agente_voz_*.csv",
    "canal": CANAL,
    "formato_data": "%Y-%m-%d",
    "delimitador": ";",
    "decimal": ".",
    "colunas": {
        "id_cliente": "id_cliente", "data": "data", "hora": "hora", "resultado": "resultado",
        "numero_discado": "numero_discado", "billsec": "billsec", "id_chamada": "id_chamada",
        "causa_sip": "causa_sip", "causa_q850": "causa_q850", "dialstatus": "dialstatus", "amd": "amd",
        "toque": "toque", "transferencia": "transferencia", "destino": "destino", "rota": "rota",
        "identidade_confirmada": "identidade_confirmada", "data_promessa": "data_promessa",
        "valor_promessa": "valor_promessa", "retorno_em": "retorno_em", "custo": "custo_operadora",
    },
    # o resultado já é o desfecho de voz (motor/voz.py); SEM_IA = "não atendeu" genérico (a rede detalha)
    "resultados": {**{d.chave: d.chave for d in V.do_canal(CANAL) if not d.interno}, SEM_IA: "nao_atendida"},
}


def classificar(ev: EventoChamada, toque_min: int = 15) -> EventoChamada:
    """Preenche desfecho/origem com voz.classificar_chamada (igual ao motor na ingestão)."""
    ia = None if ev.resultado == SEM_IA else ev.resultado
    ch, origem, av = V.classificar_chamada(resultado_ia=ia, transferencia=ev.transferencia, sip=ev.causa_sip,
                                           q850=ev.causa_q850, dialstatus=ev.dialstatus, amd=ev.amd,
                                           toque_s=ev.toque, toque_min=toque_min,
                                           canonico=V.numero_canonico(ev.numero_discado))
    ev.desfecho = ch or "nao_atendida"
    ev.origem_desfecho = origem
    ev.avisos = "; ".join(av)[:300]
    return ev


def _txt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, time):
        return v.strftime("%H:%M:%S")
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def linha(ev: EventoChamada) -> dict:
    return {k: _txt(v) for k, v in asdict(ev).items()}


class EscritorEventos:
    """Acrescenta no CSV do dia (<pasta>/empresa_<id>/agente_voz_<AAAA-MM-DD>.csv), com cabeçalho na criação.
    Arquivo 0600 (tem o número discado, como toda ocorrência de voz)."""

    def __init__(self, pasta: str | Path):
        self.pasta = Path(pasta)

    def caminho(self, empresa_id: int, dia: date) -> Path:
        return self.pasta / f"empresa_{int(empresa_id)}" / f"agente_voz_{dia.isoformat()}.csv"

    def escrever(self, ev: EventoChamada) -> Path:
        arq = self.caminho(ev.empresa_id, ev.data)
        arq.parent.mkdir(parents=True, exist_ok=True)
        novo = not arq.exists()
        fd = os.open(arq, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=CAMPOS, delimiter=";", lineterminator="\n")
            if novo:
                w.writeheader()
            w.writerow(linha(ev))
        return arq


def para_voz_chamadas(ev: EventoChamada) -> dict:
    """Colunas de voz_chamadas (V21, V24, V25) para a VM gravar no banco (sem o número discado)."""
    return {"empresa_id": ev.empresa_id, "id_cliente": ev.id_cliente, "id_acao": ev.id_acao or None,
            "id_chamada": ev.id_chamada, "resultado": ev.desfecho, "duracao_s": ev.billsec, "billsec": ev.billsec,
            "tech_prefix": ev.tech_prefix, "rota_id": ev.rota_id, "segundos_tarifados": ev.segundos_tarifados,
            "preco_minuto": ev.preco_minuto, "custo_operadora": ev.custo_operadora, "no_pico": ev.no_pico,
            "transferencia_resultado": ev.transferencia, "tem_gravacao": bool(ev.gravacao),
            "ocorrido_em": datetime.combine(ev.data, ev.hora).isoformat()}
