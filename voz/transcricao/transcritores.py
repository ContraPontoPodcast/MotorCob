"""Transcritores: Whisper self-hosted em São Paulo (faster-whisper) e reserva por API, atrás de uma interface.

  WhisperLocal     faster-whisper na VM (voz/requirements-ia.txt), modelo e dispositivo configuráveis.
  ApiTranscricao   reserva: endpoint compatível com /v1/audio/transcriptions (ex.: gpt-4o-mini-transcribe),
                   chave pelo Secret Manager (motorcx-voz-transcricao-api). Só biblioteca padrão.
  ComReserva       tenta o principal; se falhar, a reserva (e marca qual foi usada).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Segmento:
    inicio: float
    fim: float
    texto: str
    locutor: str | None = None


@dataclass
class Transcricao:
    texto: str
    segmentos: list[Segmento] = field(default_factory=list)
    idioma: str = "pt"
    motor: str = ""


class Transcritor:
    codigo = "base"

    def transcrever(self, caminho: Path, idioma: str = "pt") -> Transcricao:
        raise NotImplementedError


class WhisperLocal(Transcritor):
    codigo = "whisper"

    def __init__(self, modelo: str = "medium", dispositivo: str = "cpu", computacao: str = "int8",
                 pasta_modelos: str | None = None, fabrica=None):
        self.modelo, self.dispositivo, self.computacao, self.pasta = modelo, dispositivo, computacao, pasta_modelos
        self._fabrica = fabrica
        self._m = None

    def _carregar(self):
        if self._m is None:
            fab = self._fabrica
            if fab is None:
                from faster_whisper import WhisperModel   # voz/requirements-ia.txt
                fab = WhisperModel
            self._m = fab(self.modelo, device=self.dispositivo, compute_type=self.computacao,
                          download_root=self.pasta)
        return self._m

    def transcrever(self, caminho, idioma="pt"):
        segs, _info = self._carregar().transcribe(str(caminho), language=idioma, vad_filter=True, beam_size=5)
        lista = [Segmento(round(s.start, 2), round(s.end, 2), s.text.strip()) for s in segs]
        return Transcricao(" ".join(s.texto for s in lista if s.texto), lista, idioma, self.codigo)


class ApiTranscricao(Transcritor):
    codigo = "api"

    def __init__(self, chave: str, modelo: str = "gpt-4o-mini-transcribe",
                 url: str = "https://api.openai.com/v1/audio/transcriptions", abrir=urllib.request.urlopen,
                 timeout: float = 120):
        self.chave, self.modelo, self.url, self.abrir, self.timeout = chave, modelo, url, abrir, timeout

    def transcrever(self, caminho, idioma="pt"):
        fronteira = uuid.uuid4().hex
        partes = []
        for nome, valor in (("model", self.modelo), ("language", idioma), ("response_format", "json")):
            partes.append(f'--{fronteira}\r\nContent-Disposition: form-data; name="{nome}"\r\n\r\n{valor}\r\n'.encode())
        partes.append(f'--{fronteira}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n'
                      f"Content-Type: audio/wav\r\n\r\n".encode() + Path(caminho).read_bytes() + b"\r\n")
        partes.append(f"--{fronteira}--\r\n".encode())
        req = urllib.request.Request(self.url, data=b"".join(partes), method="POST", headers={
            "Authorization": f"Bearer {self.chave}", "Content-Type": f"multipart/form-data; boundary={fronteira}"})
        try:
            with self.abrir(req, timeout=self.timeout) as r:
                d = json.loads(r.read().decode())
        except urllib.error.HTTPError as ex:
            raise RuntimeError(f"transcrição por API: HTTP {ex.code}") from None
        return Transcricao((d.get("text") or "").strip(), [], idioma, self.codigo)


class ComReserva(Transcritor):
    def __init__(self, principal: Transcritor, reserva: Transcritor | None):
        self.principal, self.reserva = principal, reserva
        self.codigo = principal.codigo

    def transcrever(self, caminho, idioma="pt"):
        try:
            return self.principal.transcrever(caminho, idioma)
        except Exception:
            if self.reserva is None:
                raise
            return self.reserva.transcrever(caminho, idioma)
