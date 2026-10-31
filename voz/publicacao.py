"""Leva os eventos de voz ao motor pelo caminho que já existe para retorno de fornecedor.

Igual à Edge Function api (supabase/functions/api/index.ts): arquivo no bucket "entradas" em
<slug>/retorno/<AAAA-MM-DD>/<uuid>_<nome> + linha em "envios" (tipo "retorno", pendente). O plantão do motor
(nuvem/sincronizar.py: baixar_entradas) baixa para retornos/ da carteira com o nome original, e o motor acha o
layout pelo nome (layouts/motorcx_voz.json, layouts/motorcx_discador.json).

Cada publicação leva só as linhas novas do CSV do dia (o arquivo local guarda quantas já subiram em
.<nome>.publicado). Reenvio por falha não duplica: o motor deduplica pelo id_chamada.
enviado_por: o usuário da equipe MotorCX que responde pela integração (MOTORCX_VOZ_ENVIADO_POR, uuid de
auth.users), porque envios.enviado_por é obrigatório.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

log = logging.getLogger("motorcx.voz")
NOME = re.compile(r"^(motorcx_(?:voz|discador))_(\d{4}-\d{2}-\d{2})\.csv$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class Publicador:
    def __init__(self, sb, pasta_eventos: str | Path, enviado_por: str, relogio=datetime.now):
        if not UUID.match(enviado_por or ""):
            raise ValueError("MOTORCX_VOZ_ENVIADO_POR precisa ser o uuid de um usuário da equipe MotorCX")
        self.sb, self.pasta, self.enviado_por, self.relogio = sb, Path(pasta_eventos), enviado_por, relogio
        self._slugs: dict[int, str] = {}

    def _slug(self, empresa_id: int) -> str:
        if empresa_id not in self._slugs:
            r = self.sb.selecionar("empresas", {"id": f"eq.{int(empresa_id)}"}) or []
            if not r:
                raise LookupError(f"empresa {empresa_id} não encontrada")
            self._slugs[empresa_id] = r[0]["slug"]
        return self._slugs[empresa_id]

    def publicar(self) -> list[dict]:
        """Sobe as linhas novas de todos os CSVs. Devolve [{empresa_id, credor_id, nome, linhas}]."""
        feitos = []
        for arq in sorted(self.pasta.glob("empresa_*/credor_*/motorcx_*.csv")):
            m = NOME.match(arq.name)
            if not m:
                continue
            try:
                r = self._publicar_arquivo(arq, m.group(1), m.group(2))
            except Exception as ex:   # noqa: BLE001 — um arquivo com problema não segura os outros
                log.warning("publicação de %s falhou (%s)", arq.name, ex.__class__.__name__)
                continue
            if r:
                feitos.append(r)
        return feitos

    def _publicar_arquivo(self, arq: Path, prefixo: str, dia: str) -> dict | None:
        marca = arq.with_name(f".{arq.name}.publicado")
        ja = int(marca.read_text()) if marca.exists() else 0
        linhas = arq.read_text(encoding="utf-8").splitlines(keepends=True)
        if len(linhas) <= 1 + ja:
            return None
        novas = linhas[1 + ja:]
        empresa_id = int(arq.parent.parent.name.split("_", 1)[1])
        credor = int(arq.parent.name.split("_", 1)[1]) or None
        nome = f"{prefixo}_{dia}_{self.relogio():%H%M%S}.csv"
        caminho = f"{self._slug(empresa_id)}/retorno/{dia}/{uuid.uuid4()}_{nome}"
        self.sb.enviar("entradas", caminho, (linhas[0] + "".join(novas)).encode("utf-8"), "text/csv")
        try:
            self.sb.inserir("envios", {"empresa_id": empresa_id, "credor_id": credor, "tipo": "retorno",
                                       "caminho": caminho, "nome_original": nome, "enviado_por": self.enviado_por,
                                       "status": "pendente"})
        except Exception:
            self.sb.apagar_arquivos("entradas", [caminho])
            raise
        marca.write_text(str(ja + len(novas)))
        return {"empresa_id": empresa_id, "credor_id": credor, "nome": nome, "linhas": len(novas)}
