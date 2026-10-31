"""Senhas de tronco: lidas do Secret Manager do GCP do MotorCX pela REFERÊNCIA (voz_troncos.segredo_ref).

O banco guarda só o nome do segredo. A senha existe em memória na hora de gerar o pjsip.conf (arquivo 0600 dentro
do contêiner do Asterisk) e nunca vai para log, banco ou saída de terminal.
"""
from __future__ import annotations

import base64
import os
import re
import urllib.request

from voz import gcp
from voz.banco import SEGREDO_REF


class SegredoAusente(LookupError):
    pass


class Resolvedor:
    """Interface: valor(ref) -> str. Erro alto se o segredo não existe (tronco sem senha não sobe)."""

    def valor(self, ref: str) -> str:  # pragma: no cover - interface
        raise NotImplementedError


def nome_secret_manager(ref: str, prefixo: str = "motorcx-") -> str:
    """Nome do segredo no Secret Manager: 'voz/trunk/12' -> 'motorcx-voz-trunk-12' (barras e pontos viram hífen;
    o prefixo só entra se a referência ainda não começa com ele). O Secret Manager aceita [A-Za-z0-9_-]."""
    if not SEGREDO_REF.match(ref or ""):
        raise ValueError("referência de segredo inválida")
    nome = re.sub(r"[/.]", "-", ref).strip("-")
    return nome if nome.startswith(prefixo) else prefixo + nome


class SecretManager(Resolvedor):
    """Lê a última versão do segredo pela API REST, com o token da conta de serviço da VM (sem chave em arquivo,
    sem biblioteca do Google). A conta só lê segredos com o prefixo motorcx-voz- (condição no IAM)."""

    def __init__(self, projeto: str | None = None, prefixo: str = "motorcx-", token=None, abrir=None):
        self.projeto = projeto or os.environ.get("MOTORCX_GCP_PROJETO") or os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not self.projeto:
            raise ValueError("defina MOTORCX_GCP_PROJETO (ID do projeto do GCP)")
        self.prefixo = prefixo
        self._abrir = abrir or urllib.request.urlopen
        self._token = token or gcp.Token(self._abrir)

    def valor(self, ref: str) -> str:
        nome = nome_secret_manager(ref, self.prefixo)
        url = (f"https://secretmanager.googleapis.com/v1/projects/{self.projeto}/secrets/{nome}"
               "/versions/latest:access")
        try:
            d = gcp.requisitar("GET", url, self._token, abrir=self._abrir)
        except Exception as ex:   # não repassa detalhes que possam conter o valor
            raise SegredoAusente(f"segredo '{ref}' indisponível ({ex.__class__.__name__})") from None
        return base64.b64decode(d["payload"]["data"]).decode("utf-8").strip()


class Dicionario(Resolvedor):
    """Para testes e para o modo de pré-visualização (sem senha: devolve um marcador)."""

    def __init__(self, valores: dict | None = None, marcador: str | None = None):
        self.valores = dict(valores or {})
        self.marcador = marcador

    def valor(self, ref: str) -> str:
        if ref in self.valores:
            return self.valores[ref]
        if self.marcador is not None:
            return self.marcador
        raise SegredoAusente(f"segredo '{ref}' indisponível")
