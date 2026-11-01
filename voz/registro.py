"""Gravação no banco do que o orquestrador produz: voz_chamadas (V21/V24/V25) e consumo_voz (V22).

Só pela interface de colunas de voz/banco.py (COLUNAS, CONFLITO): se o SQL 56 mudar um nome, muda lá.
  voz_chamadas  upsert por empresa, id_chamada e canal (reprocessar não duplica); nunca o número discado. A
                tarifação é do gatilho do banco (encerrada_em + billsec); a VM só a lê para o consumo.
  voz_gravacoes a gravação da ligação da IA, depois que subiu para o bucket (SQL 63: registrar_gravacoes_ia_voz, que
                pega cliente e carteira da própria voz_chamadas); chamada que ainda não chegou ao banco tenta de novo.
  consumo_voz   recalculado a partir de voz_chamadas do dia (empresa × dia × tech prefix): as duas VMs gravam
                chamadas e qualquer uma pode recalcular sem somar em dobro. Rota sem preço: custo nulo, conta em
                sem_custo (nunca preço inventado). Chamada do modo simulado não entra (igual a consolidar_consumo_voz).
  SQL 65        o lote do dia (lote_voz_do_dia), as ondas (registrar_onda_voz) e as decisões do Resubmit
                (voz_resubmits, upsert por empresa e ref; só destino_hash). As decisões vão ANTES das chamadas: a
                chamada da volta leva o resubmit_id e o onda_id do banco (se as decisões falham, as chamadas esperam).
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
        self.fila_passos: list[dict] = []
        self.fila_conectores: list[dict] = []
        self.fila_resubmits: list[dict] = []
        self.ids_resubmit: dict[str, int] = {}          # ref da volta -> voz_resubmits.id
        self.ids_onda: dict[tuple, int] = {}            # (lote_id, chave da onda) -> voz_ondas.id
        self.fila_gravacoes: list[dict] = []       # gravações da IA (SQL 63), com as tentativas

    def registrar(self, ev: EventoChamada) -> None:
        linha = {k: _valor(v) for k, v in para_voz_chamadas(ev).items()}      # horários com fuso (timestamptz)
        linha = B.para_colunas("voz_chamadas", linha)
        if ev.resubmit_ref:
            linha["_ref"] = ev.resubmit_ref
        if ev.onda_chave is not None:
            linha["_onda"] = ev.onda_chave
        self.fila.append(linha)
        self.tocados.add((ev.empresa_id, ev.data))
        if len(self.fila) > self.max_fila:                           # banco fora há muito tempo: não estoura memória
            self.fila = self.fila[-self.max_fila:]

    def registrar_fluxo(self, empresa_id: int, id_chamada: str, tipo: str, dados: dict) -> None:
        """Eventos do executor do fluxo (SQL 58): passo → voz_fluxo_passos, conector → crm_chamadas. Só códigos."""
        linha = dict(dados, empresa_id=empresa_id, id_chamada=id_chamada)
        if tipo == "passo":
            self.fila_passos.append(B.para_colunas("voz_fluxo_passos", linha))
        elif tipo == "conector" and dados.get("conector_id") is not None:
            self.fila_conectores.append(B.para_colunas("crm_chamadas", linha))
        for f in (self.fila_passos, self.fila_conectores):
            del f[:-self.max_fila]

    def _descarregar_fluxo(self) -> None:
        for tabela, attr, conf in (("voz_fluxo_passos", "fila_passos", B.conflito("voz_fluxo_passos")),
                                   ("crm_chamadas", "fila_conectores", None)):
            lote = getattr(self, attr)
            if not lote:
                continue
            setattr(self, attr, [])
            if conf:                     # upsert: a mesma chave duas vezes no lote vira uma (a última)
                chave = conf.split(",")
                lote = list({tuple(l.get(c) for c in chave): l for l in lote}.values())
            # o PostgREST exige as mesmas chaves em todos os objetos do lote (PGRST102) e um passo só leva os campos
            # que teve: um insert por conjunto de chaves, na ordem em que chegaram
            grupos: dict[tuple, list] = {}
            for l in lote:
                grupos.setdefault(tuple(sorted(l)), []).append(l)
            falhou: list[dict] = []
            for grupo in grupos.values():
                try:
                    self.sb.inserir(tabela, grupo, conflito=conf)
                except Exception as ex:   # noqa: BLE001
                    self.erros += 1
                    log.warning("%s: falha ao gravar (%s); %d linha(s) ficam na fila", tabela, ex.__class__.__name__,
                                len(grupo))
                    falhou += grupo
            if falhou:
                setattr(self, attr, falhou + getattr(self, attr))

    # ------------------------------------------------------------ SQL 65: lote do dia, ondas e decisões
    def lote_do_dia(self, empresa_id: int, credor_id, dia: date, total: int) -> int | None:
        """voz_lotes da carteira no dia (acha ou cria). None se o banco falhar (o Plantão tenta de novo)."""
        try:
            r = self.sb.rpc("lote_voz_do_dia", {"empresa": empresa_id, "credor": credor_id, "dia": dia.isoformat(),
                                                "total": int(total)})
        except Exception as ex:   # noqa: BLE001
            self.erros += 1
            log.warning("voz_lotes: falha ao achar o lote do dia (%s)", ex.__class__.__name__)
            return None
        return int(r) if r is not None else None

    def sincronizar(self, lotes) -> int:
        """Ondas novas ou com contagem nova (registrar_onda_voz) e decisões do Resubmit para a fila."""
        n = 0
        for lote in lotes:
            if lote.lote_id is None:
                continue
            for d in lote.decisoes:
                d["lote_id"] = d.get("lote_id") or lote.lote_id
                d["_onda"] = None if d["decisao"] != "volta" else \
                    ("resubmit" if d["origem"] == "auto" else "manual", d["passada"], d["situacao_origem"])
                self.fila_resubmits.append(d)
            lote.decisoes = []
            for chave, o in lote.ondas.items():
                if not o.get("mudou"):
                    continue
                origem, passada, sit, pri, pedido = chave
                try:
                    oid = self.sb.rpc("registrar_onda_voz", {
                        "lote": lote.lote_id, "origem": origem, "passada": passada, "situacao_origem": sit,
                        "prioridade": pri, "reenvio": pedido, "total": o["total"], "encerradas": o["encerradas"]})
                except Exception as ex:   # noqa: BLE001
                    self.erros += 1
                    log.warning("voz_ondas: falha ao registrar (%s)", ex.__class__.__name__)
                    continue
                if oid is not None:
                    o["id"] = int(oid)
                    self.ids_onda[(lote.lote_id, chave)] = int(oid)
                o["mudou"] = False
                n += 1
        return n

    def _onda_da_decisao(self, d: dict):
        for (lid, chave), oid in self.ids_onda.items():
            if lid == d["lote_id"] and chave[:3] == d["_onda"] and chave[4] == d.get("pedido_id"):
                return oid
        return None

    def _descarregar_resubmits(self) -> bool:
        if not self.fila_resubmits:
            return True
        lote, self.fila_resubmits = self.fila_resubmits, []
        linhas = []
        for d in lote:
            oid = self._onda_da_decisao(d) if d.get("_onda") else None
            cheia = {c: None for c in B.COLUNAS["voz_resubmits"]}
            cheia.update({k: _valor(v) for k, v in d.items() if k in cheia})
            cheia["onda_id"] = oid
            linhas.append(B.para_colunas("voz_resubmits", cheia))
        try:
            ret = self.sb.inserir("voz_resubmits", linhas, conflito=B.conflito("voz_resubmits"), retornar=True) or []
        except Exception as ex:   # noqa: BLE001
            self.erros += 1
            log.warning("voz_resubmits: falha ao gravar (%s); %d decisão(ões) ficam na fila", ex.__class__.__name__,
                        len(lote))
            self.fila_resubmits = lote + self.fila_resubmits
            return False
        for d, r in zip(linhas, ret):
            self.ids_resubmit[r.get("ref") or d["ref"]] = int(r["id"])
        return True

    def registrar_gravacao(self, linha: dict) -> None:
        """{empresa_id, id_chamada, caminho, duracao_s} da gravação da IA que acabou de subir para o bucket."""
        self.fila_gravacoes.append({"linha": dict(linha), "tentativas": 0})
        del self.fila_gravacoes[:-self.max_fila]

    def _descarregar_gravacoes(self) -> int:
        if not self.fila_gravacoes:
            return 0
        fila, self.fila_gravacoes = self.fila_gravacoes, []
        n = 0
        for i in range(0, len(fila), 500):
            lote = fila[i:i + 500]
            try:
                r = self.sb.rpc("registrar_gravacoes_ia_voz", {"linhas": [x["linha"] for x in lote]}) or {}
            except Exception as ex:   # noqa: BLE001 — banco fora: tenta no próximo ciclo
                self.erros += 1
                log.warning("voz_gravacoes: falha ao registrar (%s); %d gravação(ões) ficam na fila",
                            ex.__class__.__name__, len(lote))
                self.fila_gravacoes += lote
                continue
            faltam = set(r.get("sem_chamada") or [])
            n += int(r.get("gravadas") or 0)
            for x in lote:                    # a chamada ainda não chegou ao banco: tenta de novo (até 40 ciclos)
                if x["linha"]["id_chamada"] in faltam and x["tentativas"] < 40:
                    self.fila_gravacoes.append({"linha": x["linha"], "tentativas": x["tentativas"] + 1})
        return n

    def descarregar(self) -> int:
        if not self._descarregar_resubmits():
            return 0                     # a chamada da volta precisa do id da decisão: espera o próximo ciclo
        n = self._descarregar_voz()
        self._descarregar_fluxo()      # depois das chamadas (mesma ordem do banco)
        self._descarregar_gravacoes()
        return n

    def _descarregar_voz(self) -> int:
        if not self.fila:
            return 0
        lote, self.fila = self.fila, []
        envio = []
        for l in lote:
            x = {k: v for k, v in l.items() if not k.startswith("_")}
            # todas as linhas com as mesmas chaves (o PostgREST exige no lote)
            x["resubmit_id"] = self.ids_resubmit.get(l.get("_ref"))
            x["onda_id"] = self.ids_onda.get((l.get("lote_id"), l.get("_onda")))
            envio.append(x)
        try:
            self.sb.inserir("voz_chamadas", envio, conflito=B.conflito("voz_chamadas"))
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
