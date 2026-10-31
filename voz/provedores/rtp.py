"""Ponte RTP entre o Asterisk (ARI externalMedia, slin16 sobre RTP/UDP) e a Montagem MotorCX.

O Asterisk manda áudio L16 de 16 kHz em ordem de rede (big-endian) para host:porta; a resposta volta para o
endereço de onde os pacotes vieram (RTP simétrico). Aqui o áudio vira PCM 16 bits little-endian (o que STT e TTS
usam) e o PCM da fala sai em pacotes de 20 ms (640 bytes), com sequência, timestamp e SSRC próprios.
Só biblioteca padrão.
"""
from __future__ import annotations

import array
import asyncio
import random
import struct

TAXA = 16000
QUADRO_MS = 20
BYTES_QUADRO = TAXA * 2 * QUADRO_MS // 1000          # 640
TIPO_PAYLOAD = 118                                    # dinâmico (slin16 do Asterisk)


def trocar_ordem(pcm: bytes) -> bytes:
    """big-endian <-> little-endian, amostras de 16 bits (a troca é simétrica)."""
    if len(pcm) % 2:
        pcm = pcm[:-1]
    arr = array.array("H")
    arr.frombytes(pcm)
    arr.byteswap()
    return arr.tobytes()


def ler_pacote(dados: bytes) -> tuple[int, int, int, bytes] | None:
    """(seq, timestamp, ssrc, payload) ou None se não for RTP v2."""
    if len(dados) < 12 or dados[0] >> 6 != 2:
        return None
    cc = dados[0] & 0x0F
    ext = bool(dados[0] & 0x10)
    seq, ts, ssrc = struct.unpack("!HII", dados[2:12])
    i = 12 + 4 * cc
    if ext and len(dados) >= i + 4:
        i += 4 + 4 * struct.unpack("!H", dados[i + 2:i + 4])[0]
    fim = len(dados)
    if dados[0] & 0x20 and fim > i:                   # padding
        fim -= dados[-1]
    return seq, ts, ssrc, dados[i:fim]


def montar_pacote(seq: int, ts: int, ssrc: int, payload: bytes, marcador: bool = False,
                  tipo: int = TIPO_PAYLOAD) -> bytes:
    return struct.pack("!BBHII", 0x80, (0x80 if marcador else 0) | tipo, seq & 0xFFFF, ts & 0xFFFFFFFF, ssrc) + payload


class Empacotador:
    """PCM little-endian (qualquer tamanho) -> pacotes RTP de 20 ms em L16 big-endian."""

    def __init__(self, ssrc: int | None = None):
        self.ssrc = ssrc if ssrc is not None else random.getrandbits(32)
        self.seq = random.getrandbits(16)
        self.ts = random.getrandbits(32)
        self._resto = b""
        self._primeiro = True

    def pacotes(self, pcm_le: bytes) -> list[bytes]:
        buf = self._resto + pcm_le
        saida = []
        while len(buf) >= BYTES_QUADRO:
            q, buf = buf[:BYTES_QUADRO], buf[BYTES_QUADRO:]
            saida.append(montar_pacote(self.seq, self.ts, self.ssrc, trocar_ordem(q), self._primeiro))
            self._primeiro = False
            self.seq = (self.seq + 1) & 0xFFFF
            self.ts = (self.ts + BYTES_QUADRO // 2) & 0xFFFFFFFF
        self._resto = buf
        return saida


class PonteRTP(asyncio.DatagramProtocol):
    """Recebe RTP -> ao_audio(pcm_le); falar(pcm_le) -> fila de pacotes enviados a cada 20 ms."""

    def __init__(self, ao_audio):
        self.ao_audio = ao_audio
        self.transporte = None
        self.remoto = None
        self.emp = Empacotador()
        self.saida: asyncio.Queue | None = None
        self.recebidos = 0

    def connection_made(self, transporte):
        self.transporte = transporte
        self.saida = asyncio.Queue()

    def datagram_received(self, dados, endereco):
        p = ler_pacote(dados)
        if p is None:
            return
        self.remoto = endereco
        self.recebidos += 1
        self.ao_audio(trocar_ordem(p[3]))

    def falar(self, pcm_le: bytes) -> None:
        for pk in self.emp.pacotes(pcm_le):
            self.saida.put_nowait(pk)

    def interromper(self) -> None:
        """Pessoa falou por cima: descarta o que ainda não saiu."""
        while self.saida is not None and not self.saida.empty():
            self.saida.get_nowait()

    async def enviar_ritmado(self) -> None:
        intervalo = QUADRO_MS / 1000
        prox = asyncio.get_running_loop().time()
        while True:
            pk = await self.saida.get()
            if self.remoto is not None and self.transporte is not None:
                self.transporte.sendto(pk, self.remoto)
            prox = max(prox + intervalo, asyncio.get_running_loop().time())
            await asyncio.sleep(max(0.0, prox - asyncio.get_running_loop().time()))

