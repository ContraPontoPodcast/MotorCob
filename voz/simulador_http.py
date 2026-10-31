"""Simulador de texto do fluxo na VM (SQL 58), atrás da Edge Function simular_fluxo_voz.

Por que na VM: o executor é Python (voz/fluxo.py) e a Edge Function roda Deno. Portar o executor para TypeScript
duplicaria as travas e exigiria testes de paridade de tudo; aqui o simulador roda EXATAMENTE o código da ligação
(mesmas travas, mesmo validador, mesma Conversa do bloco generativo), só sem STT/TTS e com os conectores trocados
pelo exemplo_resposta. A Edge Function faz o login, confere editar_canais, lê do banco com a RLS de quem pede e
manda tudo pronto para cá: este serviço não lê o banco e não guarda nada (cada pedido refaz a conversa desde o
começo com as falas recebidas).

Autenticação: HMAC-SHA256 com a chave do simulador (Secret Manager motorcx-voz-simulador na VM; secret
VOZ_SIMULADOR_CHAVE na Edge Function). Cabeçalhos X-MotorCX-Carimbo (segundos Unix, ±300 s) e X-MotorCX-Assinatura
= hex(hmac(chave, "<carimbo>.<corpo>")). Corpo até 256 KB. Na VM, o serviço escuta só em 127.0.0.1 e sai por um
proxy TLS (Caddy) na porta 8443; o firewall do GCP libera a 8443 (a origem das Edge Functions não é fixa: quem
protege é a assinatura).

Uso: python -m voz.simulador_http --porta 8091   (a chave vem do cofre: voz/simulador)
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import time
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from voz import conector as CN
from voz import fluxo as FX
from voz import fluxo_validador as FV

log = logging.getLogger("motorcx.voz.simulador")
MAX_CORPO = 256 * 1024
JANELA_S = 300


def assinatura(chave: str, carimbo: str, corpo: bytes) -> str:
    return hmac.new(chave.encode(), carimbo.encode() + b"." + corpo, hashlib.sha256).hexdigest()


def conferir(chave: str, carimbo: str | None, assin: str | None, corpo: bytes, agora: float) -> bool:
    if not carimbo or not assin or not carimbo.isdigit() or abs(agora - int(carimbo)) > JANELA_S:
        return False
    return hmac.compare_digest(assinatura(chave, carimbo, corpo), assin)


def _texto_ok(t) -> bool:
    import re
    return isinstance(t, str) and 1 <= len(t) <= 300 and not re.search(r"[0-9]{9,}|@", t)


def rodar(pedido: dict, modelo_de=None, entendedor=None, hoje: date | None = None) -> dict:
    """Roda um pedido do simulador (o JSON que a Edge Function manda)."""
    d = pedido.get("definicao")
    erros = FV.erros(d)
    if erros:
        return {"erro": "fluxo inválido", "erros": erros}
    falas = pedido.get("falas") or []
    if not isinstance(falas, list) or len(falas) > 30 or not all(_texto_ok(f) for f in falas):
        return {"erro": "falas inválidas (até 30, 1 a 300 caracteres, sem documento, telefone ou e-mail)"}
    cons = {}
    for linha in pedido.get("conectores") or []:
        c = CN.Conector.da_linha(linha)
        cons[c.id] = c
    base = {k: [tuple(x) for x in v] for k, v in (pedido.get("base") or {}).items()}
    fluxo = FX.FluxoCarregado(pedido.get("versao_id"), d, cons, CN.Alcada.da_linha(pedido.get("alcada")), base)
    r = FX.simular(fluxo, falas, pedido.get("variaveis") or {}, entendedor=entendedor, modelo_de=modelo_de,
                   falhar=set(pedido.get("falhar") or ()), hoje=hoje)
    del r["eventos"]
    return r


def criar_servidor(porta: int, chave: str, modelo_de=None, entendedor_de=None, host: str = "127.0.0.1",
                   relogio=time.time) -> ThreadingHTTPServer:
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):          # sem corpo nem fala em log
            pass

        def _resp(self, status: int, corpo: dict) -> None:
            b = json.dumps(corpo, ensure_ascii=False, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_POST(self):  # noqa: N802
            if self.path != "/simular":
                return self._resp(404, {"erro": "não encontrado"})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_CORPO:
                return self._resp(413, {"erro": "corpo inválido"})
            corpo = self.rfile.read(n)
            if not conferir(chave, self.headers.get("X-MotorCX-Carimbo"), self.headers.get("X-MotorCX-Assinatura"),
                            corpo, relogio()):
                log.warning("simulador: assinatura recusada")
                return self._resp(401, {"erro": "assinatura inválida"})
            try:
                pedido = json.loads(corpo.decode("utf-8"))
                r = rodar(pedido, modelo_de=modelo_de, entendedor=entendedor_de() if entendedor_de else None)
            except Exception as ex:   # noqa: BLE001
                log.warning("simulador: falhou (%s)", ex.__class__.__name__)
                return self._resp(500, {"erro": "não foi possível simular"})
            log.info("simulador: %d fala(s), %d bloco(s) no caminho", len(pedido.get("falas") or []), len(r.get("caminho") or []))
            self._resp(400 if "erro" in r else 200, r)

    return ThreadingHTTPServer((host, porta), H)


def main(argv=None) -> int:   # pragma: no cover - serviço
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--porta", type=int, default=8091)
    ap.add_argument("--chave-ref", default="voz/simulador")
    ap.add_argument("--provedores", default="/etc/motorcx/provedores.json")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    from voz.provedores import ler_config
    from voz.provedores.montagem import ConfigMontagem, ModeloOpenAICompat
    from voz.segredos import SecretManager
    seg = SecretManager()
    bruto = ler_config(a.provedores)
    cfg = ConfigMontagem(**{k: v for k, v in (bruto.get("montagem_motorcx") or bruto.get("montagem") or {}).items()
                            if k != "portas"})
    modelo_de = lambda: ModeloOpenAICompat(cfg.llm_base_url, seg.valor(cfg.ref_llm), cfg.llm_modelo)   # noqa: E731
    srv = criar_servidor(a.porta, seg.valor(a.chave_ref), modelo_de=modelo_de,
                         entendedor_de=lambda: FX.EntendedorLLM(modelo_de()))
    srv.serve_forever()
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
