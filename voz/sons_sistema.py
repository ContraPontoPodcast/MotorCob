"""Áudios do sistema do Asterisk gerados com a voz do agente (PR10 do redesenho; README do Asterisk, seção 4).

  sem-robo.wav  a pessoa atendeu e não havia robô livre (SQL 91, `sound:motorcx/sem-robo`)
  alo.wav       o "Alô" curto enquanto a IA fica livre (Alô fake, `sound:motorcx/alo`)

Gera com o TTS da Montagem (o mesmo provedor, voz e modelo de `/etc/motorcx/provedores.json`) e a chave do cofre
(`ref_tts`, padrão `voz/tts` = segredo `motorcx-voz-tts`), lida pela conta de serviço da VM. A chave nunca é
impressa, gravada em arquivo nem vai para o log. Converte para o formato do Asterisk (WAV 8 kHz, mono, 16 bits) sem
ffmpeg e grava em `--saida` (padrão /var/motorcx/sons; o `motorcx-voz-sons` da VM instala no contêiner do Asterisk).

Os textos são neutros: sem dívida, credor, valor nem nome (a identidade vem antes da dívida; a trava B7 confere).
Só ElevenLabs por enquanto (como a prévia "Ouvir a voz"); com o TTS do Google, o script para com o aviso.

Uso na VM: `sudo /usr/local/bin/motorcx-voz-sons` (roda `python3 -m voz.sons_sistema` na imagem da voz).
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import math
import os
import re
import struct
import urllib.request
import wave
from pathlib import Path

log = logging.getLogger("motorcx.voz.sons")

SONS = {
    "sem-robo": "Olá! No momento não conseguimos continuar esta ligação. Vamos tentar de novo mais tarde. Obrigado.",
    "alo": "Alô?",
}
TAXA_TTS = 16000           # pcm_16000 da ElevenLabs: PCM 16 bits, mono, little-endian
TAXA_ASTERISK = 8000
MAX_BYTES = 4 * 1024 * 1024


def neutro(texto: str) -> bool:
    """Sem dívida, credor, valor nem número (trava B7 e a das mensagens): pode tocar para qualquer pessoa que atender."""
    from motor import trava_identidade as TI
    return not TI.revela(texto) and not TI.mensagem_revela(texto) and not re.search(r"\d|\{", texto)


def _filtro(taps: int = 63, corte: float = 3400.0, taxa: int = TAXA_TTS) -> list[float]:
    """Passa-baixa (sinc com janela de Hamming) antes de reduzir 16 kHz para 8 kHz: sem serrilhado no telefone."""
    m = (taps - 1) / 2
    fc = corte / taxa
    h = []
    for n in range(taps):
        x = n - m
        s = 2 * fc if x == 0 else math.sin(2 * math.pi * fc * x) / (math.pi * x)
        h.append(s * (0.54 - 0.46 * math.cos(2 * math.pi * n / (taps - 1))))
    soma = sum(h)
    return [v / soma for v in h]


def para_8k(pcm16k: bytes) -> bytes:
    """PCM 16 bits mono 16 kHz → 8 kHz (filtro e uma amostra a cada duas)."""
    n = len(pcm16k) // 2
    amostras = struct.unpack(f"<{n}h", pcm16k[: n * 2])
    h = _filtro()
    m = len(h) // 2
    saida = []
    for i in range(0, n, 2):
        acc = 0.0
        for k, c in enumerate(h):
            j = i + k - m
            if 0 <= j < n:
                acc += c * amostras[j]
        saida.append(max(-32768, min(32767, int(round(acc)))))
    return struct.pack(f"<{len(saida)}h", *saida)


def wav(pcm: bytes, taxa: int = TAXA_ASTERISK) -> bytes:
    """WAV PCM 16 bits mono (o formato que o Asterisk toca sem converter)."""
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taxa)
        w.writeframes(pcm)
    return b.getvalue()


def sintetizador_elevenlabs(chave: str, voz: str, modelo: str = "", abrir=urllib.request.urlopen, timeout: float = 30):
    """texto → PCM 16 kHz pela API da ElevenLabs (a mesma voz da ligação). A chave vai só no cabeçalho."""
    if not voz or not re.fullmatch(r"[A-Za-z0-9_\-]{2,80}", voz):
        raise ValueError("sem voz configurada (tts_voz em /etc/motorcx/provedores.json)")

    def sintetizar(texto: str) -> bytes:
        corpo = {"text": texto, "language_code": "pt", **({"model_id": modelo} if modelo else {})}
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voz}?output_format=pcm_16000",
                                     data=json.dumps(corpo).encode(), method="POST",
                                     headers={"xi-api-key": chave, "Content-Type": "application/json"})
        with abrir(req, timeout=timeout) as r:
            return r.read(MAX_BYTES)
    return sintetizar


def gerar(saida: Path, sintetizar, sons: dict | None = None) -> list[Path]:
    """Gera cada som (texto neutro → TTS → 8 kHz → WAV) e grava em `saida`, trocando o arquivo de uma vez."""
    saida.mkdir(parents=True, exist_ok=True)
    feitos = []
    for nome, texto in (sons or SONS).items():
        if not neutro(texto):
            raise ValueError(f"texto de '{nome}' não é neutro (dívida, credor, valor ou nome)")
        pcm = sintetizar(texto)
        if len(pcm) < TAXA_TTS * 2 // 5:          # menos de 0,2 s: o provedor não devolveu fala
            raise RuntimeError(f"'{nome}': o TTS devolveu áudio vazio")
        destino = saida / f"{nome}.wav"
        tmp = saida / f".{nome}.wav.tmp"
        tmp.write_bytes(wav(para_8k(pcm)))
        os.chmod(tmp, 0o644)
        tmp.replace(destino)
        feitos.append(destino)
        log.info("som %s gerado (%.1f s)", nome, len(pcm) / 2 / TAXA_TTS)
    return feitos


def sintetizador_da_vm(provedores: str = "/etc/motorcx/provedores.json"):   # pragma: no cover - VM
    from voz.provedores import ler_config
    from voz.provedores.montagem import ConfigMontagem
    from voz.segredos import SecretManager
    bruto = ler_config(provedores)
    cfg = ConfigMontagem(**{k: v for k, v in (bruto.get("montagem_motorcx") or bruto.get("montagem") or {}).items()
                            if k != "portas"})
    if cfg.tts_provedor != "elevenlabs":
        raise SystemExit(f"TTS '{cfg.tts_provedor}': só a ElevenLabs gera os sons por aqui (veja o README, seção 4)")
    return sintetizador_elevenlabs(SecretManager().valor(cfg.ref_tts), cfg.tts_voz, cfg.tts_modelo)


def main(argv=None) -> int:   # pragma: no cover - VM
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--saida", default="/var/motorcx/sons")
    ap.add_argument("--provedores", default="/etc/motorcx/provedores.json")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        feitos = gerar(Path(a.saida), sintetizador_da_vm(a.provedores))
    except (ValueError, RuntimeError) as ex:          # mensagens nossas (sem segredo)
        log.error("sons não gerados: %s", ex)
        return 1
    except Exception as ex:   # noqa: BLE001 — de fora (HTTP, cofre): só o tipo, nunca o detalhe
        log.error("sons não gerados (%s)", ex.__class__.__name__)
        return 1
    for f in feitos:
        print(f)
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
