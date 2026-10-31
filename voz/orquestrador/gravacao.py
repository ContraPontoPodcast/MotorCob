"""Gravação: o MixMonitor grava na VM (só a parte com pessoa) e o orquestrador sobe para o GCS e apaga o local.

Nome do objeto: empresa=<id>/<AAAA>/<MM>/<DD>/<id_chamada>.wav — nunca telefone, CPF ou nome. A retenção é a regra
de ciclo de vida do bucket (criar_gcp.sh; padrão 90 dias) e a cifra é a do bucket (CMEK opcional).
"""
from __future__ import annotations

import os
import time
import urllib.parse
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

DIR_LOCAL = Path(os.environ.get("MOTORCX_DIR_GRAVACOES", "/var/motorcx/gravacoes"))


def nome_arquivo(id_chamada: str) -> str:
    """Valor de MOTORCX_GRAVACAO (o dialplan acrescenta .wav)."""
    if not id_chamada.replace("-", "").isalnum():
        raise ValueError("id_chamada inválido para nome de arquivo")
    return id_chamada


def nome_objeto(empresa_id: int, dia: date, id_chamada: str) -> str:
    return f"empresa={int(empresa_id)}/{dia:%Y/%m/%d}/{nome_arquivo(id_chamada)}.wav"


class Enviador:
    """Interface: enviar(caminho_local, nome_objeto) -> URI gs://."""

    def enviar(self, caminho: Path, objeto: str) -> str:  # pragma: no cover - interface
        raise NotImplementedError


class EnviadorGCS(Enviador):
    """Upload simples pela API JSON do GCS com o token da conta de serviço da VM (só biblioteca padrão)."""

    def __init__(self, bucket: str, token=None, abrir=None):
        from voz import gcp
        import urllib.request
        self.bucket = bucket
        self._abrir = abrir or urllib.request.urlopen
        self._token = token or gcp.Token(self._abrir)
        self._gcp = gcp

    def enviar(self, caminho, objeto):
        url = (f"https://storage.googleapis.com/upload/storage/v1/b/{urllib.parse.quote(self.bucket)}/o"
               f"?uploadType=media&name={urllib.parse.quote(objeto, safe='')}&ifGenerationMatch=0")
        self._gcp.requisitar("POST", url, self._token, Path(caminho).read_bytes(), "audio/wav", abrir=self._abrir,
                             timeout=120)
        return f"gs://{self.bucket}/{objeto}"


class EnviadorLocal(Enviador):
    """Para testes e simulação: copia para uma pasta."""

    def __init__(self, pasta: Path):
        self.pasta = Path(pasta)

    def enviar(self, caminho, objeto):
        destino = self.pasta / objeto
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(Path(caminho).read_bytes())
        return f"file://{destino}"


@dataclass
class FilaEnvio:
    """Gravações esperando o MixMonitor fechar o arquivo (tamanho estável por `estavel_s`) para subir.
    Falha de envio: tenta de novo no próximo ciclo (até `max_tentativas`); o arquivo local só sai depois do envio."""
    enviador: Enviador
    pasta: Path = DIR_LOCAL
    estavel_s: float = 2.0
    max_tentativas: int = 5
    pendentes: dict = field(default_factory=dict)   # nome -> {objeto, tamanho, visto, tentativas, ao_enviar}
    erros: int = 0

    def agendar(self, nome: str, objeto: str, ao_enviar=None) -> None:
        self.pendentes[nome] = {"objeto": objeto, "tamanho": -1, "visto": None, "tentativas": 0,
                                "ao_enviar": ao_enviar}

    def processar(self, agora_s: float | None = None) -> list[str]:
        agora_s = time.time() if agora_s is None else agora_s
        enviados = []
        for nome, p in list(self.pendentes.items()):
            arq = self.pasta / f"{nome}.wav"
            if not arq.exists():
                continue
            tam = arq.stat().st_size
            if tam != p["tamanho"]:
                p["tamanho"], p["visto"] = tam, agora_s
                continue
            if agora_s - p["visto"] < self.estavel_s:
                continue
            try:
                uri = self.enviador.enviar(arq, p["objeto"])
            except Exception:
                p["tentativas"] += 1
                self.erros += 1
                if p["tentativas"] >= self.max_tentativas:
                    del self.pendentes[nome]       # fica no disco local para a reconciliação
                continue
            arq.unlink(missing_ok=True)
            del self.pendentes[nome]
            enviados.append(uri)
            if p["ao_enviar"]:
                p["ao_enviar"](uri)
        return enviados
