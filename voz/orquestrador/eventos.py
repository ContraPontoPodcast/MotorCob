"""Evento de cada tentativa (o CDR do MotorCX), no formato que o motor já lê.

Mesmo caminho de qualquer retorno de fornecedor de voz (ex.: layouts/vozbot.json): o arquivo vai para a pasta
retornos/ da carteira (envio tipo "retorno", nuvem/sincronizar.py) e o motor acha o layout PELO NOME
(motor/ingestao.py: ingerir_pasta + fnmatch). Os dois layouts são os de layouts/motorcx_voz.json (canal
agente_voz) e layouts/motorcx_discador.json (canal discador, quando a ação do dia era do discador), gerados
de LAYOUTS abaixo (um teste confere que o JSON e o código dizem a mesma coisa).

Uma linha por tentativa (separador ';'), com as colunas de voz que motor/ingestao.py entende: numero_discado,
billsec, id_chamada, causa_sip, causa_q850, dialstatus, amd, toque, transferencia, destino, rota,
identidade_confirmada, valor_promessa, data_promessa, retorno_em. O motor classifica a tentativa com
voz.classificar_chamada, a mesma função usada aqui para o resultado que vai a voz_chamadas: não há uma segunda
tabela de causas.

Coluna `resultado` = o evento da IA (desfecho de voz) ou SEM_IA quando a IA não falou (máquina, não atendeu,
falha…): SEM_IA vira "não atende" genérico e cede para o que a rede detalhou (voz.FRACOS).
As colunas a mais (tech_prefix, rota_id, segundos_tarifados, gravacao, no_pico, desfecho…) o motor ignora;
servem a voz_chamadas (V21) e ao consumo_voz (V22). `custo` = custo da operadora estimado (0 sem rota/preço).
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
PREFIXO_ARQUIVO = {"agente_voz": "motorcx_voz", "discador": "motorcx_discador"}


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
    custo: float = 0.0               # = custo_operadora, 0 quando não há rota/preço (o layout exige número)
    # fora do motor (voz_chamadas / consumo_voz)
    credor_id: int | None = None
    canal: str = CANAL
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
    modo: str | None = None                   # voz_config.modo da empresa (simulado | teste | real)
    atendida_em: datetime | None = None       # horário de Brasília, sem fuso (o registro põe o fuso)
    encerrada_em: datetime | None = None      # com billsec, faz o gatilho do banco tarifar a chamada
    transferida_em: datetime | None = None
    fluxo_versao_id: int | None = None   # SQL 58: versão do fluxo que conduziu a chamada
    bloco_final: str | None = None


CAMPOS = tuple(f.name for f in fields(EventoChamada))



def layout_retorno(canal: str) -> dict:
    """Layout de retorno de fornecedor (motor/ingestao.py: validar_layout) para o canal."""
    return {
        "fornecedor": PREFIXO_ARQUIVO[canal],
        "canal": canal,
        "arquivo": f"{PREFIXO_ARQUIVO[canal]}_*.csv",
        "formato_data": "%Y-%m-%d",
        "delimitador": ";",
        "decimal": ".",
        "colunas": {
            "id_cliente": "id_cliente", "numero_discado": "numero_discado", "data": "data", "hora": "hora",
            "resultado": "resultado", "id_chamada": "id_chamada", "billsec": "billsec", "custo": "custo",
            "causa_sip": "causa_sip", "causa_q850": "causa_q850", "dialstatus": "dialstatus", "amd": "amd",
            "toque": "toque", "transferencia": "transferencia", "destino": "destino", "rota": "rota",
            "identidade_confirmada": "identidade_confirmada", "data_promessa": "data_promessa",
            "valor_promessa": "valor_promessa", "retorno_em": "retorno_em",
        },
        # o resultado já é o desfecho de voz (motor/voz.py); SEM_IA = "não atendeu" genérico (a rede detalha)
        "resultados": {**{d.chave: d.chave for d in V.do_canal(canal) if not d.interno}, SEM_IA: "nao_atendida"},
    }


LAYOUTS = {c: layout_retorno(c) for c in PREFIXO_ARQUIVO}


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
    """Acrescenta no CSV do dia, um por empresa, carteira e canal, com o nome que o layout reconhece:
    <pasta>/empresa_<id>/credor_<id|0>/motorcx_voz_<AAAA-MM-DD>.csv. Cabeçalho na criação; arquivo 0600 (tem
    o número discado, como todo retorno de voz). O Publicador sobe só as linhas novas como envio "retorno"."""

    def __init__(self, pasta: str | Path):
        self.pasta = Path(pasta)

    def caminho(self, empresa_id: int, dia: date, credor_id: int | None = None, canal: str = CANAL) -> Path:
        return self.pasta / f"empresa_{int(empresa_id)}" / f"credor_{int(credor_id or 0)}" / \
            f"{PREFIXO_ARQUIVO[canal]}_{dia.isoformat()}.csv"

    def escrever(self, ev: EventoChamada) -> Path:
        arq = self.caminho(ev.empresa_id, ev.data, ev.credor_id, ev.canal)
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
    """Colunas de voz_chamadas (V21, V24, V25) para a VM gravar no banco (sem o número discado). Horários sem fuso
    (Brasília): voz/registro.py põe o fuso. A tarifação (rota, segundos, preço, custo) não vai: é do gatilho
    tarifar_chamada_voz, que roda com encerrada_em + billsec. Chave do upsert: empresa, id_chamada e canal."""
    return {"empresa_id": ev.empresa_id, "credor_id": ev.credor_id, "id_cliente": ev.id_cliente,
            "id_acao": ev.id_acao or None, "id_chamada": ev.id_chamada, "canal": ev.canal, "modo": ev.modo,
            "provedor": ev.provedor, "ocorrido_em": datetime.combine(ev.data, ev.hora),
            "atendida_em": ev.atendida_em, "encerrada_em": ev.encerrada_em,
            "duracao_s": ev.billsec, "billsec": ev.billsec, "causa_sip": ev.causa_sip, "causa_q850": ev.causa_q850,
            "dialstatus": ev.dialstatus, "amd": ev.amd,
            "resultado_ia": None if ev.resultado in (SEM_IA, "", None) else ev.resultado,
            "resultado": ev.desfecho, "origem_resultado": ev.origem_desfecho, "destino": ev.destino,
            "identidade_confirmada": ev.identidade_confirmada,
            "transferencia": ev.transferencia, "transferida_em": ev.transferida_em if ev.transferencia else None,
            "no_pico": ev.no_pico, "tronco_id": ev.tronco_id, "tech_prefix": ev.tech_prefix,
            "data_promessa": ev.data_promessa, "valor_promessa": ev.valor_promessa, "retorno_em": ev.retorno_em,
            "tem_gravacao": bool(ev.gravacao),
            "fluxo_versao_id": ev.fluxo_versao_id, "bloco_final": ev.bloco_final}
