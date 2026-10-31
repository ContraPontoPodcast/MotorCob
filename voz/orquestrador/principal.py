"""Processo do orquestrador na VM do Asterisk (ao lado do contêiner, rede do host).

  python3 -m voz.orquestrador.principal --dados /run/motorcx/voz.json --lista empresa=12:/dados/.../discador_mailing.csv \\
      --eventos /var/motorcx/eventos --bucket <projeto>-motorcx-gravacoes --contratado 300 [--simulado]

Os eventos do ARI chegam por uma thread (WebSocket) numa fila; o laço principal processa a fila e chama tick() a
cada 200 ms. Senha do ARI: arquivo (MOTORCX_ARI_SENHA_ARQUIVO, gravado pela VM a partir do Secret Manager).
Para em fim de janela: quando nenhum lote tem item pendente e não há chamada em voo.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import threading
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from voz import banco as B
from voz.orquestrador.agendador import Agendador
from voz.orquestrador.ari import AriHttp
from voz.orquestrador.eventos import EscritorEventos
from voz.orquestrador.gravacao import EnviadorGCS, FilaEnvio
from voz.orquestrador.lote import Lote, ler_mailing
from voz.orquestrador.nucleo import APP, Orquestrador
from voz.provedores.simulador import Simulador

FUSO = ZoneInfo("America/Sao_Paulo")


def relogio_brasilia() -> datetime:
    """Hora de Brasília sem fuso (a janela da Lista está em horário de Brasília)."""
    return datetime.now(FUSO).replace(tzinfo=None)


def montar(dados: B.DadosVoz, listas: dict[int, str], contratado: int, ari, escritor, provedores, relogio,
           fila_envio=None, ao_registrar=None) -> Orquestrador:
    ag = Agendador(contratado=contratado)
    orq = Orquestrador(ari, dados, ag, escritor, provedores, relogio, fila_envio=fila_envio, ao_registrar=ao_registrar)
    for emp, caminho in listas.items():
        ag.registrar_empresa(dados.config(emp), dados.troncos_da(emp))
        orq.adicionar_lote(Lote(emp, ler_mailing(caminho)))
    return orq


def _ouvir(ari, fila: queue.Queue, parar: threading.Event) -> None:
    while not parar.is_set():
        try:
            for ev in ari.eventos(APP):
                fila.put(ev)
                if parar.is_set():
                    return
        except Exception as ex:   # reconecta (Asterisk reiniciando)
            logging.getLogger("motorcx.voz").warning("WebSocket do ARI caiu (%s); reconectando", ex.__class__.__name__)
            time.sleep(2)


def rodar(orq: Orquestrador, fila: queue.Queue, passo_s: float = 0.2, relogio=relogio_brasilia) -> dict:
    while True:
        fim = time.monotonic() + passo_s
        while time.monotonic() < fim:
            try:
                orq.ao_evento(fila.get(timeout=max(0.0, fim - time.monotonic())))
            except queue.Empty:
                break
        orq.tick()
        agora = relogio()
        if not orq.chamadas and all(l.pendentes(agora) == 0 for l in orq.lotes.values()):
            return orq.contagem


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Orquestrador ARI do agente de voz do MotorCX")
    ap.add_argument("--dados", required=True)
    ap.add_argument("--lista", action="append", required=True, help="empresa=<id>:<discador_mailing.csv>")
    ap.add_argument("--eventos", required=True)
    ap.add_argument("--bucket")
    ap.add_argument("--contratado", type=int, required=True)
    ap.add_argument("--ari", default="http://127.0.0.1:8088")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    listas = {}
    for x in a.lista:
        k, caminho = x.split(":", 1)
        listas[int(k.split("=", 1)[1])] = caminho
    dados = B.carregar(json.loads(Path(a.dados).read_text(encoding="utf-8")))
    senha = Path(os.environ.get("MOTORCX_ARI_SENHA_ARQUIVO", "/run/motorcx/ari_senha")).read_text().strip()
    ari = AriHttp(a.ari, os.environ.get("MOTORCX_ARI_USUARIO", "motorcx"), senha)
    del senha
    # adaptadores reais (Montagem MotorCX, ElevenLabs) entram aqui na etapa 4; até lá, só o Simulador
    provedores = {"simulador": Simulador()}
    fila_envio = FilaEnvio(EnviadorGCS(a.bucket)) if a.bucket else None
    orq = montar(dados, listas, a.contratado, ari, EscritorEventos(a.eventos), provedores, relogio_brasilia,
                 fila_envio)
    fila: queue.Queue = queue.Queue()
    parar = threading.Event()
    threading.Thread(target=_ouvir, args=(ari, fila, parar), daemon=True).start()
    try:
        print(json.dumps(rodar(orq, fila), ensure_ascii=False))
    finally:
        parar.set()
    for al in orq.alertas:
        print("ALERTA:", al)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
