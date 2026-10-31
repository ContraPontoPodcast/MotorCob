"""Ponta a ponta com o Asterisk de verdade (chamado por teste_ponta_a_ponta.sh, dentro da rede do contêiner do
Asterisk). Três "operadoras" SIPp: A recusa com 503 (failover), B atende, C responde 404 (número inexistente).
O orquestrador real (AriHttp + WebSocket) disca dois números e o teste confere o evento de cada um.
Só dados fictícios."""
import json
import os
import queue
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, "/app")

from voz import banco as B  # noqa: E402
from voz.orquestrador.agendador import Agendador  # noqa: E402
from voz.orquestrador.ari import AriHttp  # noqa: E402
from voz.orquestrador.eventos import EscritorEventos  # noqa: E402
from voz.orquestrador.lote import ItemLote, Lote  # noqa: E402
from voz.orquestrador.nucleo import APP, Orquestrador  # noqa: E402
from voz.provedores.simulador import Simulador  # noqa: E402


def main() -> int:
    dados = B.carregar(json.loads(Path(sys.argv[1]).read_text()))
    ari = AriHttp("http://127.0.0.1:8088", "motorcx", Path(sys.argv[2]).read_text().strip())
    fila: queue.Queue = queue.Queue()

    def ouvir():
        for ev in ari.eventos(APP):
            fila.put(ev)
    threading.Thread(target=ouvir, daemon=True).start()
    time.sleep(1.5)                                   # o app Stasis precisa estar registrado antes do originate
    ag = Agendador(contratado=10)
    ag.registrar_empresa(dados.config(1), dados.troncos_da(1))
    eventos = []
    orq = Orquestrador(ari, dados, ag, EscritorEventos("/tmp/eventos"),
                       {"simulador": Simulador(cenarios={"C1": "desligou"})}, datetime.now,
                       ao_registrar=eventos.append, toque_max_s=15)
    jan = ("00:00", "23:59")
    lote = Lote(1, [ItemLote("C1", "11988887770", janela_local=jan, tentativas_max_numero=1),
                    ItemLote("C2", "1133334444", janela_local=jan, tentativas_max_numero=1)])
    orq.adicionar_lote(lote)
    tipos = []
    fim = time.time() + 60
    while time.time() < fim and len(eventos) < 2:
        try:
            ev = fila.get(timeout=0.2)
            tipos.append(ev.get("type"))
            if os.environ.get("E2E_DEBUG"):
                print("ARI", json.dumps({k: ev.get(k) for k in ("type", "args", "cause", "tech_cause", "cause_txt")}
                                        | {"canal": (ev.get("channel") or {}).get("id"),
                                           "estado": (ev.get("channel") or {}).get("state"),
                                           "ctx": ((ev.get("channel") or {}).get("dialplan") or {}).get("context")}),
                      flush=True)
            orq.ao_evento(ev)
        except queue.Empty:
            pass
        orq.tick()
    saida = [{k: getattr(e, k) for k in ("id_cliente", "desfecho", "origem_desfecho", "rota", "tech_prefix",
                                         "causa_sip", "causa_q850", "amd", "billsec", "toque")} for e in eventos]
    print(json.dumps({"eventos": saida, "contagem": orq.contagem, "alertas": orq.alertas,
                      "tipos_ari": sorted(set(tipos))}, ensure_ascii=False, indent=1, default=str))
    por = {e["id_cliente"]: e for e in saida}
    erros = []
    if set(por) != {"C1", "C2"}:
        erros.append(f"eventos faltando: {sorted(por)}")
    else:
        c1, c2 = por["C1"], por["C2"]
        if c1["rota"] != "tr-1-21/22":
            erros.append(f"C1 deveria ter saído pela rota B depois do 503: {c1['rota']}")
        if orq.contagem.get("failover") != 1:
            erros.append("C1 sem failover")
        if c1["desfecho"] not in ("atendeu_desligou", "mudo", "maquina", "atendida_sem_cpc"):
            erros.append(f"C1 desfecho inesperado: {c1['desfecho']}")
        if not c1["billsec"] or c1["billsec"] < 1:
            erros.append("C1 sem billsec")
        if c2["desfecho"] != "numero_inexistente" or c2["causa_q850"] != 1:
            erros.append(f"C2 deveria ser inexistente (Q.850 1): {c2}")
    for e in erros:
        print("ERRO:", e)
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
