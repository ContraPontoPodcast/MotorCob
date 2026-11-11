"""Pergunta SIP OPTIONS à operadora (passo 1 do "Testar a rota", SQL 114 · Telefonia T5).

Manda um OPTIONS por UDP de uma porta efêmera da VM (o Asterisk fica com a 5060) e mede quanto a operadora demora para
responder. Qualquer resposta SIP (200, 403, 404, 405…) quer dizer que a operadora está no ar. Sem resposta em `tempo`
segundos: None (algumas operadoras ignoram OPTIONS; o teste segue). O firewall do GCP é com estado: a resposta à
pergunta que a VM fez volta mesmo de um IP que não está na regra de entrada.
Nada de senha, número de pessoa ou dado de cliente passa por aqui.
"""
from __future__ import annotations

import secrets
import socket
import time


def montar(host: str, porta: int, ip_local: str, porta_local: int, call_id: str, tag: str, branch: str) -> bytes:
    linhas = [f"OPTIONS sip:{host}:{porta} SIP/2.0",
              f"Via: SIP/2.0/UDP {ip_local}:{porta_local};branch=z9hG4bK{branch};rport",
              "Max-Forwards: 70",
              f"From: <sip:motorcx@{ip_local}>;tag={tag}",
              f"To: <sip:{host}:{porta}>",
              f"Call-ID: {call_id}",
              "CSeq: 1 OPTIONS",
              f"Contact: <sip:motorcx@{ip_local}:{porta_local}>",
              "User-Agent: MotorCX",
              "Accept: application/sdp",
              "Content-Length: 0", "", ""]
    return "\r\n".join(linhas).encode()


def ler_resposta(dados: bytes, call_id: str) -> int | None:
    """Código da resposta SIP se for a deste Call-ID; None se não for."""
    try:
        txt = dados.decode("utf-8", "replace")
    except Exception:   # noqa: BLE001
        return None
    linhas = txt.split("\r\n") if "\r\n" in txt else txt.split("\n")
    if not linhas or not linhas[0].startswith("SIP/2.0 "):
        return None
    cid = next((l.split(":", 1)[1].strip() for l in linhas[1:]
                if l.lower().startswith("call-id:") or l.lower().startswith("i:")), None)
    if cid != call_id:
        return None
    try:
        return int(linhas[0].split()[1])
    except (IndexError, ValueError):
        return None


def perguntar(host: str, porta: int = 5060, ip_externo: str = "", tempo: float = 3.0,
              abrir_socket=socket.socket, relogio=time.monotonic) -> tuple[int, int] | None:
    """(código SIP, ms) da resposta, ou None sem resposta. Erro de DNS ou de rede: None."""
    try:
        destino = socket.getaddrinfo(host, porta, socket.AF_INET, socket.SOCK_DGRAM)[0][4]
    except (OSError, IndexError):
        return None
    s = abrir_socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.bind(("0.0.0.0", 0))
        porta_local = s.getsockname()[1]
        call_id = secrets.token_hex(12) + "@motorcx"
        msg = montar(host, porta, ip_externo or "0.0.0.0", porta_local, call_id, secrets.token_hex(6),
                     secrets.token_hex(8))
        ini = relogio()
        s.sendto(msg, destino)
        fim = ini + tempo
        while True:
            falta = fim - relogio()
            if falta <= 0:
                return None
            s.settimeout(falta)
            try:
                dados, _ = s.recvfrom(4096)
            except (socket.timeout, OSError):
                return None
            cod = ler_resposta(dados, call_id)
            if cod is not None and cod >= 200:
                return cod, int(round((relogio() - ini) * 1000))
    finally:
        s.close()
