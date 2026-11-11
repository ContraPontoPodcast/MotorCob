"""Treino de operadores HUMANOS por VOZ no navegador (Roleplay do Speech Analytics, SQL 119): o gateway de áudio na VM.

Por que um gateway na VM (e não WebRTC no Asterisk): a Montagem já tem tudo o que a voz do treino precisa (STT
Deepgram em streaming, TTS ElevenLabs/Google, LLM, chaves no Secret Manager); só faltava o transporte do navegador. O
caminho mais curto e seguro é um WebSocket seguro (WSS) no Caddy que já está no ar na 8443 (porta já aberta, certificado
Let's Encrypt), até este serviço em 127.0.0.1:8093. Nada de SIP/WebRTC exposto, nada de porta nova, nenhum PABX.

  navegador (microfone, PCM 16 kHz) --wss://<vm>:8443/treino/voz--> Caddy --> este serviço
     -> Deepgram (Pipecat) -> cliente simulado (voz/treino.py, o mesmo das sessões por texto) -> TTS -> navegador

Autorização: a Edge Function `treino` (que confere o link do operador ou o login da Qualidade e lê o cenário) emite um
BILHETE de uso único: base64url(JSON) + "." + HMAC-SHA256(chave do simulador, "treino-voz." + base64url), válido por
2 minutos, com a sessão, o cenário (roteiro do cliente simulado), o checklist e o limite de segundos (o menor entre a
duração do cenário e o saldo de voz da franquia). O navegador manda o bilhete como primeira mensagem do WebSocket; o
roteiro nunca fica visível na tela (o navegador só repassa o bilhete). Cada sessão abre uma vez só.

Fim da ligação: o operador encerra, a cliente desliga, o tempo (ou a franquia) acaba, 20 s de silêncio, "Sair sem
contar", microfone perdido ou a rede cai. O serviço avalia a conversa pelo checklist (voz/treino.py, mesmo avaliador
das ligações) e devolve o resultado ASSINADO à Edge Function (acao voz_registrar), que grava com registrar_sessao_treino
(tentativas, uso em minutos, cobrança ia_treino_voz com franquia, aviso a 80% e 100%). Este serviço não lê nem grava o
banco e não guarda nada: o áudio só passa pela memória (nunca em disco, nunca em log); a transcrição é a mesma das
sessões por texto, com a fala do operador mascarada (CPF, telefone, e-mail, 9+ dígitos, nome dito).

Protocolo do WebSocket (navegador <-> serviço):
  -> {"bilhete": "..."}                       primeira mensagem (até 10 s)
  -> binário: PCM 16 bits little-endian, 16 kHz, mono (quadros de até 1 s)
  -> {"tipo": "encerrar" | "sair" | "microfone"} e {"tipo": "mudo", "ligado": bool}
  <- {"tipo": "pronto", "limite_s"}  · {"tipo": "fala", "quem", "texto", "t"} · {"tipo": "parcial", "texto"}
  <- {"tipo": "interromper"} (o operador falou por cima: a tela para o áudio) · {"tipo": "tempo", "segundos"}
  <- {"tipo": "desligou"} · {"tipo": "avaliando"} · {"tipo": "fim", "situacao", "motivo"} · {"tipo": "erro", "erro"}
  <- binário: PCM 16 bits little-endian, 16 kHz, mono (a voz da cliente simulada)

Uso na VM: python -m voz.treino_voz --porta 8093 (chave do cofre voz/simulador; retorno em
$MOTORCOB_SUPABASE_URL/functions/v1/treino). Dependências: voz/requirements-ia.txt (pipecat-ai e websockets).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import dataclasses
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
import urllib.request

from voz import treino as TR

log = logging.getLogger("motorcx.voz.treino_voz")
PREFIXO = "treino-voz."
MAX_BILHETE = 96 * 1024
VALIDADE_MAX_S = 300
SILENCIO_S = 20
LIMITE_MAX_S = 900
MAX_SESSOES = 20
TAXA = 16000
BYTES_POR_S = TAXA * 2
MAX_QUADRO = BYTES_POR_S                    # até 1 s de áudio por mensagem
ESPERA_BILHETE_S = 10
FALLBACK_FALA = "Desculpa, não ouvi direito. Pode repetir?"
MAX_FALHAS_LLM = 3
AVALIA = ("encerrar", "desligou", "tempo", "franquia", "silencio")
MOTIVOS = AVALIA + ("sair", "rede", "microfone", "servico")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _de64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def assinar(chave: str, texto: str) -> str:
    return hmac.new(chave.encode(), texto.encode(), hashlib.sha256).hexdigest()


def criar_bilhete(chave: str, dados: dict) -> str:
    """O mesmo formato da Edge Function (supabase/functions/treino/regras.ts › criarBilhete)."""
    corpo = _b64(json.dumps(dados, ensure_ascii=False, separators=(",", ":")).encode())
    return f"{corpo}.{assinar(chave, PREFIXO + corpo)}"


def ler_bilhete(chave: str, bilhete, agora: float) -> dict | None:
    """Confere assinatura, validade (até 5 min à frente) e o conteúdo. Qualquer coisa fora: None."""
    if not isinstance(bilhete, str) or len(bilhete) > MAX_BILHETE or bilhete.count(".") != 1:
        return None
    corpo, assin = bilhete.split(".")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,}", corpo) or not re.fullmatch(r"[0-9a-f]{64}", assin):
        return None
    if not hmac.compare_digest(assinar(chave, PREFIXO + corpo), assin):
        return None
    try:
        d = json.loads(_de64(corpo).decode("utf-8"))
    except Exception:   # noqa: BLE001
        return None
    if not isinstance(d, dict) or d.get("v") != 1:
        return None
    exp, sessao, limite = d.get("exp"), d.get("sessao"), d.get("limite_s")
    if not isinstance(exp, int) or not agora < exp <= agora + VALIDADE_MAX_S:
        return None
    if not isinstance(sessao, int) or isinstance(sessao, bool) or sessao <= 0:
        return None
    if not isinstance(limite, int) or not 10 <= limite <= LIMITE_MAX_S:
        return None
    if not TR.cenario_ok(d.get("cenario")) or not isinstance(d.get("checklist"), dict):
        return None
    voz = d.get("voz")
    if voz is not None and not (isinstance(voz, str) and re.fullmatch(r"[A-Za-z0-9_.:\-]{1,60}", voz)):
        return None
    return d


class Usados:
    """Bilhete de uso único: cada sessão abre uma vez neste processo (a validade curta cobre o resto)."""

    def __init__(self):
        self._vistos: dict[int, float] = {}
        self._trava = threading.Lock()

    def marcar(self, sessao: int, exp: float, agora: float) -> bool:
        with self._trava:
            self._vistos = {k: v for k, v in self._vistos.items() if v > agora}
            if sessao in self._vistos:
                return False
            self._vistos[sessao] = exp + 3600
            return True


# ------------------------------------------------------------------ a conversa (thread do LLM)
class ConversaVoz:
    """O cliente simulado ao telefone, fala a fala, com o mesmo turno das sessões por texto (voz/treino.py): a fala do
    operador (transcrita) volta mascarada e é essa que vai para a tela e para a transcrição. LLM fora numa fala: a
    cliente pede para repetir; 3 seguidas: a sessão falha (não conta, não cobra)."""

    def __init__(self, sessao: int, cenario: dict, modelo_de, relogio, ao_evento):
        self.sessao, self.cenario, self.modelo_de = sessao, cenario, modelo_de
        self.relogio, self.ao_evento = relogio, ao_evento
        self.inicio = relogio()
        self.turnos: list[dict] = []
        self.tokens = 0
        self.caracteres_tts = 0
        self.encerrada = False
        self.falhas = 0
        self.falhou = False
        self._trava = threading.Lock()

    def _t(self) -> int:
        return max(0, int(self.relogio() - self.inicio))

    def falas_operador(self) -> int:
        return sum(1 for t in self.turnos if t["quem"] == "operador")

    def _turno(self, texto: str | None) -> dict | None:
        try:
            r = TR.turno({"treino": "turno", "sessao": self.sessao, "cenario": self.cenario,
                          "turnos": [{"quem": t["quem"], "texto": t["texto"]} for t in self.turnos], "texto": texto},
                         self.modelo_de())
        except Exception as ex:   # noqa: BLE001 — sem fala em log
            log.warning("treino_voz: cliente simulado sem resposta (%s)", ex.__class__.__name__)
            r = None
        if isinstance(r, dict) and "erro" in r:     # fala inválida (vazia depois da máscara): não é falha do LLM
            return None
        if r is None:
            self.falhas += 1
            if self.falhas >= MAX_FALHAS_LLM:
                self.falhou = True
            return None
        self.falhas = 0
        self.tokens += int(r.get("tokens") or 0)
        return r

    def _persona(self, fala: str) -> list[str]:
        t = self._t()
        self.turnos.append({"quem": "persona", "texto": fala, "t": t})
        self.caracteres_tts += len(fala)
        self.ao_evento({"tipo": "fala", "quem": "persona", "texto": fala, "t": t})
        return [fala]

    def comecar(self) -> list[str]:
        with self._trava:
            r = self._turno(None)
            return self._persona(r["fala"] if r else "Alô?")

    def ouvir(self, texto: str) -> list[str]:
        with self._trava:
            texto = (texto or "").strip()[:TR.MAX_TEXTO]
            if self.encerrada or self.falhou or not texto or len(self.turnos) >= TR.MAX_TURNOS - 2:
                return []
            r = self._turno(texto)
            op = r.get("operador") if r else TR.mascarar_fala(texto)
            if op:                          # a fala do operador entra mesmo com o LLM fora (já mascarada)
                t = self._t()
                self.turnos.append({"quem": "operador", "texto": op, "t": t})
                self.ao_evento({"tipo": "fala", "quem": "operador", "texto": op, "t": t})
            if r is None:
                return [] if self.falhou else self._persona(FALLBACK_FALA)
            if r.get("desligou"):
                self.encerrada = True
            return self._persona(r["fala"])


# ------------------------------------------------------------------ o fim: o `dados` de registrar_sessao_treino
def dados_fim(motivo: str, conversa: ConversaVoz, segundos: int, modelo_de, checklist: dict) -> tuple[dict, bool]:
    """(dados, sem_fala). sem_fala = o operador não chegou a falar: a Edge Function fecha a sessão como abandonada SEM
    uso (não conta, não cobra). Avaliada: o mesmo avaliador das sessões por texto. Rede, microfone e falha do serviço:
    "falhou" (não conta, não cobra). "Sair sem contar" com fala: abandonada (a IA rodou: cobra, não conta)."""
    dur = max(0, min(3600, int(segundos)))
    base = {"duracao_s": dur, "tokens": conversa.tokens, "minutos_stt": round(dur / 60, 2),
            "caracteres_tts": conversa.caracteres_tts}
    turnos = [dict(t) for t in conversa.turnos]
    if not conversa.falas_operador():
        return {"situacao": "abandonada", **base}, True
    if conversa.falhou or motivo == "servico":
        return {"situacao": "falhou", "motivo_falha": "servico", "duracao_s": dur, "tokens": conversa.tokens}, False
    if motivo in ("rede", "microfone"):
        return {"situacao": "falhou", "motivo_falha": motivo, "duracao_s": dur, "tokens": conversa.tokens}, False
    if motivo == "sair":
        return {"situacao": "abandonada", **base}, False
    m = modelo_de()
    if hasattr(m, "timeout"):
        m.timeout = max(float(getattr(m, "timeout", 15) or 15), 45.0)
    try:
        av = TR.avaliar({"treino": "avaliar", "cenario": conversa.cenario, "checklist": checklist, "turnos": turnos}, m)
    except Exception as ex:   # noqa: BLE001
        log.warning("treino_voz: avaliação falhou (%s)", ex.__class__.__name__)
        av = None
    if not av or av.get("situacao") != "avaliada":
        return {"situacao": "falhou", "motivo_falha": "servico", "duracao_s": dur,
                "tokens": conversa.tokens + int((av or {}).get("tokens") or 0)}, False
    d = {"situacao": "avaliada", **base, "tokens": conversa.tokens + int(av.get("tokens") or 0), "transcricao": turnos}
    for k in ("nota", "itens", "evidencia", "reprovada", "item_reprovado", "objetivo_ok", "feedback"):
        if k in av:
            d[k] = av[k]
    return d, False


def assinatura_http(chave: str, carimbo: str, corpo: bytes) -> str:
    """O mesmo HMAC do simulador (voz/simulador_http.py), agora no sentido VM → Edge Function."""
    return hmac.new(chave.encode(), carimbo.encode() + b"." + corpo, hashlib.sha256).hexdigest()


def enviar_resultado(url: str, chave: str, sessao: int, dados: dict, sem_fala: bool,
                     abrir=urllib.request.urlopen, relogio=time.time, tentativas: int = 2) -> str | None:
    """POST assinado à Edge Function treino ({acao: voz_registrar}). Devolve a situação gravada ou None."""
    corpo = json.dumps({"acao": "voz_registrar", "sessao": sessao, "dados": dados, "sem_fala": bool(sem_fala)},
                       ensure_ascii=False).encode()
    for _ in range(max(1, tentativas)):
        carimbo = str(int(relogio()))
        req = urllib.request.Request(url, data=corpo, method="POST", headers={
            "Content-Type": "application/json", "X-MotorCX-Carimbo": carimbo,
            "X-MotorCX-Assinatura": assinatura_http(chave, carimbo, corpo)})
        try:
            with abrir(req, timeout=20) as r:
                d = json.loads(r.read(64 * 1024).decode() or "{}")
                return d.get("situacao") if isinstance(d, dict) else None
        except Exception as ex:   # noqa: BLE001 — sem corpo em log
            log.warning("treino_voz: resultado não entregue (%s)", ex.__class__.__name__)
    return None


# ------------------------------------------------------------------ a sessão (loop asyncio do servidor)
@dataclasses.dataclass
class Deps:
    modelo_de: object
    servicos_de: object                 # voz -> (stt, tts)
    pipeline: object                    # async (ponte, conversa, stt, tts, parar, ao_parcial) -> None
    retorno: object                     # (sessao, dados, sem_fala) -> situacao | None
    relogio: object = time.monotonic


class PonteWS:
    """A mesma cara da PonteRTP para o pipeline: ao_audio (o pipeline liga), falar(pcm) e interromper()."""

    def __init__(self, sessao: "SessaoVoz"):
        self.sessao = sessao
        self.ao_audio = None

    def falar(self, pcm: bytes) -> None:
        self.sessao.audio(pcm)

    def interromper(self) -> None:
        self.sessao.interromper()


class SessaoVoz:
    def __init__(self, ws, bilhete: dict, deps: Deps):
        self.ws, self.b, self.deps = ws, bilhete, deps
        self.sessao = int(bilhete["sessao"])
        self.limite = int(bilhete["limite_s"])
        self.por_franquia = bool(bilhete.get("por_franquia"))
        self.motivo: str | None = None
        self.mudo = False
        self.desligou_avisado = False

    # ---- saída (thread-safe: o LLM roda em outra thread)
    def _por(self, item) -> None:
        self.loop.call_soon_threadsafe(self.saida.put_nowait, item)

    def json(self, d: dict) -> None:
        self._por(json.dumps(d, ensure_ascii=False))

    def audio(self, pcm: bytes) -> None:
        if not pcm or self.motivo:
            return
        agora = self.deps.relogio()
        self.falando_ate = max(self.falando_ate, agora) + len(pcm) / BYTES_POR_S
        self._por(bytes(pcm))

    def interromper(self) -> None:
        self.falando_ate = self.deps.relogio()
        self.json({"tipo": "interromper"})

    def parcial(self, texto: str) -> None:
        t = TR.mascarar_fala(texto or "")[:300]
        if t:
            self.json({"tipo": "parcial", "texto": t})

    def evento(self, d: dict) -> None:
        if d.get("quem") == "operador":
            self.ultimo_operador = self.deps.relogio()
        self.json(d)

    def terminar(self, motivo: str) -> None:
        if motivo == "rede" and self.conversa.encerrada:
            motivo = "desligou"             # a cliente já tinha desligado: a ligação acabou de verdade
        if self.motivo is None:
            self.motivo = motivo
            self.loop.call_soon_threadsafe(self.acabou.set)

    def segundos(self) -> int:
        return max(0, int(self.deps.relogio() - self.inicio))

    async def _enviar(self) -> None:
        while True:
            item = await self.saida.get()
            if item is None:
                return
            try:
                await self.ws.send(item)
            except Exception:   # noqa: BLE001 — a rede caiu: o receptor percebe
                return

    async def _receber(self) -> None:
        try:
            async for msg in self.ws:
                if isinstance(msg, (bytes, bytearray)):
                    if self.mudo or not msg or len(msg) > MAX_QUADRO or len(msg) % 2:
                        continue
                    if self.ponte.ao_audio is not None:
                        self.ponte.ao_audio(bytes(msg))
                    continue
                try:
                    d = json.loads(msg)
                except Exception:   # noqa: BLE001
                    continue
                tipo = d.get("tipo") if isinstance(d, dict) else None
                if tipo in ("encerrar", "sair", "microfone"):
                    self.terminar(tipo)
                elif tipo == "mudo":
                    self.mudo = d.get("ligado") is True
                    if not self.mudo:
                        self.ultimo_operador = self.deps.relogio()
        except Exception:   # noqa: BLE001
            pass
        self.terminar("rede")

    async def _relogio(self, passo: float = 1.0) -> None:
        ultimo = -1
        while self.motivo is None:
            await asyncio.sleep(passo)
            agora = self.deps.relogio()
            s = self.segundos()
            if s != ultimo:
                ultimo = s
                self.json({"tipo": "tempo", "segundos": s})
            if self.conversa.falhou:
                self.terminar("servico")
            elif self.conversa.encerrada and agora >= self.falando_ate + 0.5:
                if not self.desligou_avisado:
                    self.desligou_avisado = True
                    self.json({"tipo": "desligou"})
                self.terminar("desligou")
            elif s >= self.limite:
                self.terminar("franquia" if self.por_franquia else "tempo")
            elif not self.mudo and agora - max(self.ultimo_operador, self.falando_ate) >= SILENCIO_S:
                self.terminar("silencio")

    async def rodar(self, passo: float = 1.0) -> str:
        self.loop = asyncio.get_running_loop()
        self.saida: asyncio.Queue = asyncio.Queue()
        self.acabou = asyncio.Event()
        self.inicio = self.deps.relogio()
        self.falando_ate = self.inicio
        self.ultimo_operador = self.inicio
        self.ponte = PonteWS(self)
        self.conversa = ConversaVoz(self.sessao, self.b["cenario"], self.deps.modelo_de, self.deps.relogio, self.evento)
        envio = asyncio.ensure_future(self._enviar())
        parar = asyncio.Event()
        try:
            stt, tts = self.deps.servicos_de(self.b.get("voz"))
        except Exception as ex:   # noqa: BLE001
            log.warning("treino_voz: STT/TTS indisponível (%s)", ex.__class__.__name__)
            stt = tts = None
            self.terminar("servico")
        self.json({"tipo": "pronto", "limite_s": self.limite})
        pipe = None
        if stt is not None:
            pipe = asyncio.ensure_future(self.deps.pipeline(self.ponte, self.conversa, stt, tts, parar, self.parcial))
            pipe.add_done_callback(lambda f: (not f.cancelled() and f.exception() is not None) and self.terminar("servico"))
        receb = asyncio.ensure_future(self._receber())
        relog = asyncio.ensure_future(self._relogio(passo))
        await self.acabou.wait()
        motivo = self.motivo or "servico"
        parar.set()
        relog.cancel()
        if pipe is not None:
            try:
                await asyncio.wait_for(pipe, 5)
            except BaseException:   # noqa: BLE001 — o pipeline não segura o fim
                pipe.cancel()
        segundos = self.segundos()
        if motivo in AVALIA and self.conversa.falas_operador() and not self.conversa.falhou:
            self.json({"tipo": "avaliando"})
        dados, sem_fala = await asyncio.to_thread(dados_fim, motivo, self.conversa, segundos, self.deps.modelo_de,
                                                  self.b.get("checklist") or {})
        gravada = await asyncio.to_thread(self.deps.retorno, self.sessao, dados, sem_fala)
        situacao = gravada or ("abandonada" if sem_fala else "falhou")
        log.info("treino_voz: sessão %s fim %s %s %ss", self.sessao, motivo, situacao, segundos)
        self.json({"tipo": "fim", "situacao": situacao, "motivo": "sem_fala" if sem_fala else motivo,
                   **({} if gravada else {"erro": "Não deu para guardar o resultado agora. A tentativa não contou."})})
        self._por(None)
        try:
            await asyncio.wait_for(envio, 5)
        except BaseException:   # noqa: BLE001
            envio.cancel()
        receb.cancel()
        try:
            await self.ws.close()
        except Exception:   # noqa: BLE001
            pass
        return situacao


# ------------------------------------------------------------------ servidor
class Servidor:
    def __init__(self, chave: str, deps: Deps, origens: tuple = (), max_sessoes: int = MAX_SESSOES, agora=time.time):
        self.chave, self.deps, self.origens, self.max_sessoes, self.agora = chave, deps, origens, max_sessoes, agora
        self.usados = Usados()
        self.ativas = 0

    async def atender(self, ws, origem: str | None = None) -> str | None:
        async def recusar(erro: str):
            try:
                await ws.send(json.dumps({"tipo": "erro", "erro": erro}, ensure_ascii=False))
                await ws.close()
            except Exception:   # noqa: BLE001
                pass
            return None
        if self.origens and origem not in self.origens:
            return await recusar("origem não permitida")
        if self.ativas >= self.max_sessoes:
            return await recusar("O treino por voz está cheio agora. Tente em alguns minutos ou use o texto.")
        try:
            primeira = await asyncio.wait_for(ws.recv(), ESPERA_BILHETE_S)
            pedido = json.loads(primeira) if isinstance(primeira, str) else None
        except Exception:   # noqa: BLE001
            pedido = None
        agora = self.agora()
        b = ler_bilhete(self.chave, (pedido or {}).get("bilhete") if isinstance(pedido, dict) else None, agora)
        if b is None:
            log.warning("treino_voz: bilhete recusado")
            return await recusar("Bilhete inválido ou vencido. Volte e comece de novo.")
        if not self.usados.marcar(b["sessao"], b["exp"], agora):
            return await recusar("Esta sessão já foi aberta. Volte e comece de novo.")
        self.ativas += 1
        try:
            return await SessaoVoz(ws, b, self.deps).rodar()
        finally:
            self.ativas -= 1


def servicos_da_vm(provedores: str, segredos):   # pragma: no cover - VM
    """(voz -> (stt, tts)) com a Montagem da VM. A voz do cenário só vale se estiver entre as liberadas na VM."""
    from voz.provedores import ler_config
    from voz.provedores.montagem import ConfigMontagem, montar_servicos_pipecat
    bruto = ler_config(provedores)
    cfg = ConfigMontagem(**{k: v for k, v in (bruto.get("montagem_motorcx") or bruto.get("montagem") or {}).items()
                            if k != "portas"})
    liberadas = {v for v in (cfg.tts_voz, *(cfg.tts_vozes or ())) if isinstance(v, str) and v}

    def servicos(voz: str | None):
        c = dataclasses.replace(cfg, tts_voz=voz) if voz and voz in liberadas else cfg
        return montar_servicos_pipecat(c, segredos)
    return servicos


async def pipeline_pipecat(ponte, conversa, stt, tts, parar: asyncio.Event, ao_parcial) -> None:   # pragma: no cover
    """Pipeline Pipecat (o mesmo desenho da Montagem): áudio do navegador -> STT -> cliente simulado -> TTS -> navegador.
    Transcrição parcial vai para a tela (já mascarada) e interrompe a cliente quando o operador fala por cima."""
    from pipecat.frames.frames import (EndFrame, InputAudioRawFrame, InterimTranscriptionFrame, TranscriptionFrame,
                                       TTSAudioRawFrame, TTSSpeakFrame)
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.task import PipelineTask
    from pipecat.processors.frame_processor import FrameProcessor

    class Cerebro(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, InterimTranscriptionFrame):
                if len((frame.text or "").split()) >= 2:
                    ponte.interromper()
                ao_parcial(frame.text)
            elif isinstance(frame, TranscriptionFrame):
                ponte.interromper()
                for t in await asyncio.to_thread(conversa.ouvir, frame.text):
                    await self.push_frame(TTSSpeakFrame(t))
            else:
                await self.push_frame(frame, direction)

    class Saida(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, TTSAudioRawFrame):
                ponte.falar(frame.audio)
            else:
                await self.push_frame(frame, direction)

    task = PipelineTask(Pipeline([stt, Cerebro(), tts, Saida()]))
    ponte.ao_audio = lambda pcm: asyncio.ensure_future(
        task.queue_frame(InputAudioRawFrame(audio=pcm, sample_rate=TAXA, num_channels=1)))
    runner = asyncio.ensure_future(PipelineRunner(handle_sigint=False).run(task))
    for t in await asyncio.to_thread(conversa.comecar):
        await task.queue_frame(TTSSpeakFrame(t))
    await parar.wait()
    await task.queue_frame(EndFrame())
    await runner


def main(argv=None) -> int:   # pragma: no cover - serviço
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--porta", type=int, default=8093)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--chave-ref", default="voz/simulador")
    ap.add_argument("--provedores", default="/etc/motorcx/provedores.json")
    ap.add_argument("--retorno", default="")
    ap.add_argument("--origens", default="https://motorcob.online")
    ap.add_argument("--max-sessoes", type=int, default=MAX_SESSOES)
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    from voz.segredos import SecretManager
    from voz.simulador_http import modelos_da_vm
    seg = SecretManager()
    chave = seg.valor(a.chave_ref)
    retorno = a.retorno or (os.environ.get("MOTORCOB_SUPABASE_URL", "").rstrip("/") + "/functions/v1/treino")
    if not retorno.startswith("https://"):
        raise SystemExit("defina --retorno ou MOTORCOB_SUPABASE_URL (https)")
    modelo_de, _ = modelos_da_vm(a.provedores)
    deps = Deps(modelo_de=modelo_de, servicos_de=servicos_da_vm(a.provedores, seg), pipeline=pipeline_pipecat,
                retorno=lambda s, d, sf: enviar_resultado(retorno, chave, s, d, sf))
    srv = Servidor(chave, deps, tuple(x.strip() for x in a.origens.split(",") if x.strip()), a.max_sessoes)

    try:
        from websockets.asyncio.server import serve
    except ImportError:
        from websockets import serve   # type: ignore[no-redef]

    async def handler(ws):
        req = getattr(ws, "request", None)
        origem = req.headers.get("Origin") if req is not None else None
        await srv.atender(ws, origem)

    async def rodar():
        async with serve(handler, a.host, a.porta, max_size=MAX_BILHETE, ping_interval=20, ping_timeout=20):
            log.info("treino_voz: WebSocket em %s:%s", a.host, a.porta)
            await asyncio.Future()
    asyncio.run(rodar())
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
