"""Gravação no banco do que o orquestrador produz: voz_chamadas (V21/V24/V25) e consumo_voz (V22).

Só pela interface de colunas de voz/banco.py (COLUNAS, CONFLITO): se o SQL 56 mudar um nome, muda lá.
  voz_chamadas  upsert por empresa, id_chamada e canal (reprocessar não duplica); nunca o número discado. A
                tarifação é do gatilho do banco (encerrada_em + billsec); a VM só a lê para o consumo.
  consumo_voz   recalculado a partir de voz_chamadas do dia (empresa × dia × tech prefix): as duas VMs gravam
                chamadas e qualquer uma pode recalcular sem somar em dobro. Rota sem preço: custo nulo, conta em
                sem_custo (nunca preço inventado). Chamada do modo simulado não entra (igual a consolidar_consumo_voz).
Falha do banco não derruba a discagem: as linhas ficam na fila e vão no próximo descarregar().
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from voz import banco as B
from voz.orquestrador.eventos import EventoChamada, para_voz_chamadas

FUSO = ZoneInfo("America/Sao_Paulo")
PAGINA = 1000
log = logging.getLogger("motorcx.voz")


def _instante(dia: date, hora: time = time(0)) -> str:
    return datetime.combine(dia, hora, tzinfo=FUSO).isoformat()


def _valor(v):
    """Horário sem fuso (Brasília) -> ISO com fuso; data -> ISO; o resto como está."""
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=FUSO)).isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return v


class RegistroBanco:
    def __init__(self, sb, max_fila: int = 50000):
        self.sb = sb
        self.fila: list[dict] = []
        self.tocados: set[tuple[int, date]] = set()
        self.max_fila = max_fila
        self.erros = 0

    def registrar(self, ev: EventoChamada) -> None:
        linha = {k: _valor(v) for k, v in para_voz_chamadas(ev).items()}      # horários com fuso (timestamptz)
        self.fila.append(B.para_colunas("voz_chamadas", linha))
        self.tocados.add((ev.empresa_id, ev.data))
        if len(self.fila) > self.max_fila:                           # banco fora há muito tempo: não estoura memória
            self.fila = self.fila[-self.max_fila:]

    def descarregar(self) -> int:
        if not self.fila:
            return 0
        lote, self.fila = self.fila, []
        try:
            self.sb.inserir("voz_chamadas", lote, conflito=B.conflito("voz_chamadas"))
        except Exception as ex:   # noqa: BLE001 — tenta de novo no próximo ciclo
            self.erros += 1
            log.warning("voz_chamadas: falha ao gravar (%s); %d linha(s) ficam na fila", ex.__class__.__name__,
                        len(lote))
            self.fila = lote + self.fila
            return 0
        return len(lote)

    def _chamadas_do_dia(self, empresa_id: int, dia: date) -> list[dict]:
        c = B.COLUNAS["voz_chamadas"]
        ini, fim = _instante(dia), _instante(dia + timedelta(days=1))
        linhas, offset = [], 0
        while True:
            pagina = self.sb.selecionar("voz_chamadas", {
                c["empresa_id"]: f"eq.{int(empresa_id)}",
                "and": f"({c['ocorrido_em']}.gte.{ini},{c['ocorrido_em']}.lt.{fim})",
                "offset": str(offset)}, ordem=f"{c['id_chamada']}.asc", limite=PAGINA) or []
            linhas += pagina
            if len(pagina) < PAGINA:
                return linhas
            offset += PAGINA

    @staticmethod
    def agregar(empresa_id: int, dia: date, chamadas: list[dict]) -> list[dict]:
        c = B.COLUNAS["voz_chamadas"]
        por: dict[str, dict] = {}
        for ch in chamadas:
            if ch.get(c["modo"]) == "simulado":     # como consolidar_consumo_voz: simulado não é telefonia
                continue
            tp = ch.get(c["tech_prefix"]) or ""
            a = por.setdefault(tp, {"empresa_id": empresa_id, "dia": dia.isoformat(), "tech_prefix": tp,
                                    "rota_id": None, "chamadas": 0, "chamadas_atendidas": 0,
                                    "segundos_atendidos": 0, "segundos_tarifados": 0, "custo_estimado": None,
                                    "sem_custo": 0})
            bs = int(ch.get(c["billsec"]) or 0)
            a["chamadas"] += 1
            a["chamadas_atendidas"] += int(bs > 0)
            a["segundos_atendidos"] += bs
            a["segundos_tarifados"] += int(ch.get(c["segundos_tarifados"]) or 0)
            a["rota_id"] = ch.get(c["rota_id"]) or a["rota_id"]
            custo = ch.get(c["custo_operadora"])
            if custo is None:
                a["sem_custo"] += 1
            else:
                a["custo_estimado"] = round((a["custo_estimado"] or 0) + float(custo), 5)
        return [B.para_colunas("consumo_voz", x) for x in sorted(por.values(), key=lambda x: x["tech_prefix"])]

    def atualizar_consumo(self) -> int:
        """Recalcula consumo_voz dos (empresa, dia) que tiveram chamada desde a última vez."""
        n = 0
        for emp, dia in sorted(self.tocados):
            try:
                linhas = self.agregar(emp, dia, self._chamadas_do_dia(emp, dia))
                if linhas:
                    self.sb.inserir("consumo_voz", linhas, conflito=B.conflito("consumo_voz"))
                self.tocados.discard((emp, dia))
                n += len(linhas)
            except Exception as ex:   # noqa: BLE001
                self.erros += 1
                log.warning("consumo_voz: falha ao recalcular (%s)", ex.__class__.__name__)
        return n
