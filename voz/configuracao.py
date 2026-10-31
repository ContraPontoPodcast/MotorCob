"""Busca a configuração de voz no banco e grava o JSON que o gerador do Asterisk e o orquestrador leem.

  python3 -m voz.configuracao --saida /run/motorcx/voz.json [--provedores-sip /etc/motorcx/provedores_sip.json]

Lê voz_troncos, voz_rotas, voz_transferencias, voz_config, voz_contrato (concorrência contratada) e
voz_divisao_concorrencia (o limite de cada empresa) pelo acesso que a VM usa (voz/acesso.py: chave do servidor no
piloto, papel motorcx_voz antes do modo real; só em memória).
Valida tudo com voz/banco.py ANTES de gravar: configuração quebrada no banco não derruba o Asterisk que está no
ar. Só grava se mudou (hash) e então sai com código 10, para o serviço da VM regerar o pjsip/dialplan dentro do
contêiner e recarregar (infra/asterisk/vm/motorcx-voz-config).
Nenhuma senha passa por aqui: o banco só tem a referência do segredo.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from voz import banco as B

TABELAS = ("voz_troncos", "voz_rotas", "voz_transferencias", "voz_config")
MUDOU = 10


def buscar(sb, provedores_sip: list | None = None) -> dict:
    dados = {t: sb.selecionar(t, ordem="empresa_id.asc") or [] for t in TABELAS}
    try:
        contrato = sb.selecionar("voz_contrato", limite=1) or []
    except Exception:   # noqa: BLE001 — tabela de V4 ainda não criada
        contrato = []
    dados["voz_contrato"] = {"concorrencia_contratada": int(contrato[0].get("concorrencia_contratada") or 0)} \
        if contrato else {"concorrencia_contratada": 0}
    # o limite de cada empresa é a parte dela no contratado, calculada pelo banco (voz_divisao_concorrencia)
    try:
        divisao = sb.selecionar("voz_divisao_concorrencia") or []
    except Exception:   # noqa: BLE001 — sem a view: limite = canais dos troncos (como antes)
        divisao = []
    cd = B.COLUNAS["voz_divisao_concorrencia"]
    limite = {int(d[cd["empresa_id"]]): d.get(cd["limite"]) for d in divisao}
    for c in dados["voz_config"]:
        c["limite_simultaneas"] = limite.get(int(c[B.COLUNAS["voz_config"]["empresa_id"]]))
    dados["provedores_sip"] = provedores_sip or []
    B.carregar(dados)            # valida (erro alto, nada é gravado)
    return dados


def gravar_se_mudou(dados: dict, saida: Path) -> bool:
    texto = json.dumps(dados, ensure_ascii=False, sort_keys=True, indent=1, default=str)
    if saida.exists() and hashlib.sha256(saida.read_bytes()).digest() == hashlib.sha256(texto.encode()).digest():
        return False
    saida.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=saida.parent, prefix=f".{saida.name}.")
    try:
        os.fchmod(fd, 0o644)          # sem segredo: o contêiner do Asterisk (uid próprio) lê
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(texto)
        os.replace(tmp, saida)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return True


def supabase_do_ambiente():
    """Cliente do banco da VM: chave do servidor (piloto) ou acesso próprio (SQL 57), por MOTORCX_VOZ_ACESSO."""
    from voz.acesso import conectar_do_ambiente
    return conectar_do_ambiente()


def main(argv=None, sb=None) -> int:
    ap = argparse.ArgumentParser(description="Configuração de voz do banco -> JSON do Asterisk/orquestrador")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--provedores-sip", help="JSON com os provedores ligados por SIP (ex.: ElevenLabs)")
    a = ap.parse_args(argv)
    prov = json.loads(Path(a.provedores_sip).read_text(encoding="utf-8")) if a.provedores_sip and \
        Path(a.provedores_sip).exists() else []
    try:
        dados = buscar(sb or supabase_do_ambiente(), prov)
    except (B.DadosInvalidos, TypeError, AttributeError, KeyError) as ex:   # formato inesperado também não derruba
        print(f"ERRO: configuração de voz inválida no banco (mantida a anterior): {ex.__class__.__name__}: {ex}",
              file=sys.stderr)
        return 2
    mudou = gravar_se_mudou(dados, Path(a.saida))
    print(json.dumps({"mudou": mudou, **{t: len(dados[t]) for t in TABELAS}}, ensure_ascii=False))
    return MUDOU if mudou else 0


if __name__ == "__main__":
    sys.exit(main())
