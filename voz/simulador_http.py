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

SQL 66: o pedido do simulador aceita `cenarios` {id do conector: "sucesso" | "tempo" | "401"} (a resposta escolhida
para cada conector simulado) e POST /ouvir {texto, voz_id?, variaveis?} devolve a prévia em áudio de uma fala ("Ouvir
a voz"), com o TTS da Montagem (provedores.json, chave no cofre). O áudio volta na resposta e não é gravado em lugar
nenhum; quem registra o uso (registrar_uso_ia_voz, componente previa_voz) é a Edge Function.

Uso: python -m voz.simulador_http --porta 8091   (a chave vem do cofre: voz/simulador)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import logging
import re
import time
import urllib.request
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


MAX_TEXTO_OUVIR = 500
CHARS_POR_MINUTO = 900          # fala de ~15 caracteres por segundo: estimativa dos minutos da prévia


def cenarios_ok(c) -> bool:
    """{"12": "tempo", ...}: até 10 conectores, cada um com um cenário da lista fechada."""
    return isinstance(c, dict) and len(c) <= 10 and all(
        str(k).isdigit() and 0 < int(k) < 2 ** 53 and v in CN.CENARIOS_SIMULADOR for k, v in c.items())


def texto_ouvir_ok(t) -> bool:
    return isinstance(t, str) and 1 <= len(t.strip()) and len(t) <= MAX_TEXTO_OUVIR and not re.search(r"[0-9]{9,}|@", t)


def ouvir(pedido: dict, sintetizar) -> dict:
    """Prévia em áudio de uma fala: troca as variáveis pelos valores de teste e chama o TTS. Nada é gravado."""
    from voz.provedores.montagem import preencher
    texto = pedido.get("texto")
    if not texto_ouvir_ok(texto):
        return {"erro": f"texto inválido (1 a {MAX_TEXTO_OUVIR} caracteres, sem documento, telefone ou e-mail)"}
    voz = pedido.get("voz_id")
    if voz is not None and not (isinstance(voz, str) and re.fullmatch(r"[A-Za-z0-9_\-]{2,80}", voz)):
        return {"erro": "voz inválida"}
    if sintetizar is None:
        return {"erro": "prévia de voz indisponível nesta VM"}
    final = preencher(texto, pedido.get("variaveis") or {})
    if not texto_ouvir_ok(final):
        return {"erro": "texto inválido depois das variáveis"}
    audio, mime = sintetizar(final, voz)
    return {"audio": base64.b64encode(audio).decode(), "mime": mime, "caracteres": len(final),
            "minutos": round(len(final) / CHARS_POR_MINUTO, 3)}


def sintetizador_elevenlabs(chave: str, voz_padrao: str, modelo: str = "", vozes: tuple = (),
                            abrir=urllib.request.urlopen, timeout: float = 20):
    """TTS da ElevenLabs pela API HTTP (o mesmo provedor e voz da Montagem). Devolve (mp3, "audio/mpeg").
    A voz pedida só entra no endereço se for uma das vozes configuradas na VM (a padrão da Montagem e
    `tts_vozes` do provedores.json); qualquer outra cai na padrão. O endereço nunca leva texto vindo de fora."""
    permitidas = {v: v for v in (voz_padrao, *vozes) if v and re.fullmatch(r"[A-Za-z0-9_\-]{2,80}", v)}

    def sintetizar(texto: str, voz: str | None) -> tuple[bytes, str]:
        v = permitidas.get(voz or "") or permitidas.get(voz_padrao)
        if not v:
            raise ValueError("sem voz configurada")
        corpo = {"text": texto, **({"model_id": modelo} if modelo else {})}
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{v}?output_format=mp3_22050_32",
                                     data=json.dumps(corpo).encode(), method="POST",
                                     headers={"xi-api-key": chave, "Content-Type": "application/json", "Accept": "audio/mpeg"})
        with abrir(req, timeout=timeout) as r:
            return r.read(2 * 1024 * 1024), "audio/mpeg"
    return sintetizar


def rodar(pedido: dict, modelo_de=None, entendedor=None, hoje: date | None = None) -> dict:
    """Roda um pedido do simulador (o JSON que a Edge Function manda)."""
    d = pedido.get("definicao")
    erros = FV.erros(d)
    if erros:
        return {"erro": "fluxo inválido", "erros": erros}
    falas = pedido.get("falas") or []
    if not isinstance(falas, list) or len(falas) > 30 or not all(_texto_ok(f) for f in falas):
        return {"erro": "falas inválidas (até 30, 1 a 300 caracteres, sem documento, telefone ou e-mail)"}
    cenarios = pedido.get("cenarios") or {}
    if not cenarios_ok(cenarios):
        return {"erro": "cenários inválidos (sucesso, tempo ou 401, até 10 conectores)"}
    cons = {}
    for linha in pedido.get("conectores") or []:
        c = CN.Conector.da_linha(linha)
        cons[c.id] = c
    base = {k: [tuple(x) for x in v] for k, v in (pedido.get("base") or {}).items()}
    fluxo = FX.FluxoCarregado(pedido.get("versao_id"), d, cons, CN.Alcada.da_linha(pedido.get("alcada")), base)
    r = FX.simular(fluxo, falas, pedido.get("variaveis") or {}, entendedor=entendedor, modelo_de=modelo_de,
                   falhar=set(pedido.get("falhar") or ()), hoje=hoje, cenarios=cenarios)
    del r["eventos"]
    return r


def criar_servidor(porta: int, chave: str, modelo_de=None, entendedor_de=None, host: str = "127.0.0.1",
                   relogio=time.time, ao_roleplay=None, sintetizar=None) -> ThreadingHTTPServer:
    """POST /simular roda um pedido do simulador; POST /roleplay {lote} acorda o trabalhador do roleplay (SQL 59),
    que lê o lote do banco; POST /ouvir devolve a prévia em áudio de uma fala (SQL 66). Todos com a mesma assinatura
    HMAC."""
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
            if self.path not in ("/simular", "/roleplay", "/ouvir"):
                return self._resp(404, {"erro": "não encontrado"})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_CORPO:
                return self._resp(413, {"erro": "corpo inválido"})
            corpo = self.rfile.read(n)
            if not conferir(chave, self.headers.get("X-MotorCX-Carimbo"), self.headers.get("X-MotorCX-Assinatura"),
                            corpo, relogio()):
                log.warning("simulador: assinatura recusada")
                return self._resp(401, {"erro": "assinatura inválida"})
            if self.path == "/roleplay":
                if ao_roleplay is None:
                    return self._resp(503, {"erro": "roleplay desligado nesta VM"})
                ao_roleplay()
                return self._resp(202, {"ok": True})
            if self.path == "/ouvir":
                try:
                    r = ouvir(json.loads(corpo.decode("utf-8")), sintetizar)
                except Exception as ex:   # noqa: BLE001 — sem texto em log
                    log.warning("simulador: prévia de voz falhou (%s)", ex.__class__.__name__)
                    return self._resp(502, {"erro": "não foi possível gerar a prévia agora"})
                return self._resp(503 if r.get("erro") == "prévia de voz indisponível nesta VM" else 400 if "erro" in r else 200, r)
            try:
                pedido = json.loads(corpo.decode("utf-8"))
                r = rodar(pedido, modelo_de=modelo_de, entendedor=entendedor_de() if entendedor_de else None)
            except Exception as ex:   # noqa: BLE001
                log.warning("simulador: falhou (%s)", ex.__class__.__name__)
                return self._resp(500, {"erro": "não foi possível simular"})
            log.info("simulador: %d fala(s), %d bloco(s) no caminho", len(pedido.get("falas") or []), len(r.get("caminho") or []))
            self._resp(400 if "erro" in r else 200, r)

    return ThreadingHTTPServer((host, porta), H)


def modelos_da_vm(provedores: str = "/etc/motorcx/provedores.json"):   # pragma: no cover - VM
    """(modelo_de, entendedor_de) com o LLM configurado na Montagem e a chave do cofre."""
    from voz.provedores import ler_config
    from voz.provedores.montagem import ConfigMontagem, ModeloOpenAICompat
    from voz.segredos import SecretManager
    seg = SecretManager()
    bruto = ler_config(provedores)
    cfg = ConfigMontagem(**{k: v for k, v in (bruto.get("montagem_motorcx") or bruto.get("montagem") or {}).items()
                            if k != "portas"})
    modelo_de = lambda: ModeloOpenAICompat(cfg.llm_base_url, seg.valor(cfg.ref_llm), cfg.llm_modelo)   # noqa: E731
    return modelo_de, (lambda: FX.EntendedorLLM(modelo_de()))


def sintetizador_da_vm(provedores: str = "/etc/motorcx/provedores.json"):   # pragma: no cover - VM
    """TTS da Montagem para a prévia ("Ouvir a voz"). Só ElevenLabs (HTTP direto); com o TTS do Google, a prévia fica
    indisponível (a credencial do Google é de conta de serviço e o caminho dela é o Pipecat da ligação)."""
    from voz.provedores import ler_config
    from voz.provedores.montagem import ConfigMontagem
    from voz.segredos import SecretManager
    bruto = ler_config(provedores)
    cfg = ConfigMontagem(**{k: v for k, v in (bruto.get("montagem_motorcx") or bruto.get("montagem") or {}).items()
                            if k != "portas"})
    if cfg.tts_provedor != "elevenlabs":
        return None
    return sintetizador_elevenlabs(SecretManager().valor(cfg.ref_tts), cfg.tts_voz, cfg.tts_modelo,
                                   tuple(x for x in (cfg.tts_vozes or ()) if isinstance(x, str)))


def main(argv=None) -> int:   # pragma: no cover - serviço
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--porta", type=int, default=8091)
    ap.add_argument("--chave-ref", default="voz/simulador")
    ap.add_argument("--provedores", default="/etc/motorcx/provedores.json")
    ap.add_argument("--roleplay", action="store_true", help="liga o trabalhador do roleplay (SQL 59) neste processo")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    import threading
    from voz.segredos import SecretManager
    modelo_de, entendedor_de = modelos_da_vm(a.provedores)
    acordar = None
    if a.roleplay:
        from voz.configuracao import supabase_do_ambiente
        from voz.roleplay import Trabalhador
        t = Trabalhador(supabase_do_ambiente(), modelo_de, modelo_de, entendedor_de=entendedor_de)
        threading.Thread(target=t.rodar_para_sempre, daemon=True, name="roleplay").start()
        acordar = t.acordar.set
    try:
        sintetizar = sintetizador_da_vm(a.provedores)
    except Exception as ex:   # noqa: BLE001 — sem TTS, só a prévia fica indisponível
        log.warning("simulador: TTS da prévia indisponível (%s)", ex.__class__.__name__)
        sintetizar = None
    srv = criar_servidor(a.porta, SecretManager().valor(a.chave_ref), modelo_de=modelo_de, entendedor_de=entendedor_de,
                         ao_roleplay=acordar, sintetizar=sintetizar)
    srv.serve_forever()
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
