"""Acesso mínimo ao Google Cloud pela conta de serviço da VM (servidor de metadados), só com a biblioteca padrão.

Sem chave em arquivo e sem bibliotecas do Google na imagem do Asterisk: o token vem do metadata server e dura
~1 h (renovado com folga). Usado pelo Secret Manager (senhas de tronco) e pelo GCS (gravações).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"


class ErroGCP(RuntimeError):
    pass


class Token:
    def __init__(self, abrir=urllib.request.urlopen):
        self._abrir = abrir
        self._valor = None
        self._expira = 0.0

    def __call__(self) -> str:
        if self._valor is None or time.time() > self._expira - 120:
            req = urllib.request.Request(METADATA, headers={"Metadata-Flavor": "Google"})
            with self._abrir(req, timeout=5) as r:
                d = json.loads(r.read().decode())
            self._valor, self._expira = d["access_token"], time.time() + int(d.get("expires_in", 300))
        return self._valor


def requisitar(metodo: str, url: str, token: Token, corpo: bytes | None = None, tipo: str | None = None,
               abrir=urllib.request.urlopen, timeout: float = 30) -> dict:
    cab = {"Authorization": f"Bearer {token()}"}
    if tipo:
        cab["Content-Type"] = tipo
    req = urllib.request.Request(url, data=corpo, method=metodo, headers=cab)
    try:
        with abrir(req, timeout=timeout) as r:
            txt = r.read().decode() or "{}"
    except urllib.error.HTTPError as ex:
        # nunca repassa o corpo (pode ecoar dados); só o status
        raise ErroGCP(f"{metodo} {urllib.parse.urlsplit(url).path.split('/')[1:3]} -> HTTP {ex.code}") from None
    return json.loads(txt)
