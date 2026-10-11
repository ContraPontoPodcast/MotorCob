"""Medição da Orquestração para o faturamento por contrato.

Cada rodada do dia grava em `contratos_mes` os contratos da carteira em cobrança (na_carga) que o motor
avaliou: um registro por contrato distinto no mês (empresa × credor × competência). Sem CPF, nome ou
telefone: só o código do contrato. Cliente sem código de contrato na carga conta como um contrato
("cliente:<id>").

Para não reenviar o mês inteiro todo dia, guarda localmente o que já subiu (estado/contratos_AAAA-MM.txt);
o banco também não duplica (chave primária), então reenviar é inofensivo.
"""
import csv
from datetime import date
from pathlib import Path


def contratos_avaliados(pasta_base: Path) -> set[str]:
    """Contratos dos clientes em cobrança hoje (base/clientes.csv × base/na_carga.csv)."""
    pasta_base = Path(pasta_base)
    clientes, na_carga = pasta_base / "clientes.csv", pasta_base / "na_carga.csv"
    if not clientes.exists():
        return set()
    ativos = None
    if na_carga.exists():
        with open(na_carga, encoding="utf-8") as f:
            ativos = {l.strip() for l in f.readlines()[1:] if l.strip()}
    saida = set()
    with open(clientes, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            idc = (r.get("id_cliente") or "").strip()
            if not idc or (ativos is not None and idc not in ativos):
                continue
            saida.add(((r.get("id_contrato") or "").strip() or f"cliente:{idc}")[:120])
    return saida


def publicar_contratos(sb, empresa_id, credor_id, pasta: Path, data: date) -> int:
    """Sobe os contratos do dia que ainda não estavam no mês. Devolve quantos eram novos."""
    pasta = Path(pasta)
    competencia = data.replace(day=1)
    cache = pasta / "estado" / f"contratos_{competencia:%Y-%m}.txt"
    ja = set(cache.read_text(encoding="utf-8").splitlines()) if cache.exists() else set()
    novos = sorted(contratos_avaliados(pasta / "base") - ja)
    if not novos:
        return 0
    sb.inserir("contratos_mes", [{"empresa_id": empresa_id, "credor_id": credor_id or 0,
                                  "competencia": competencia.isoformat(), "contrato": c,
                                  "primeiro_dia": data.isoformat()} for c in novos],
               conflito="empresa_id,competencia,credor_id,contrato")
    cache.parent.mkdir(parents=True, exist_ok=True)
    with open(cache, "a", encoding="utf-8") as f:
        f.write("".join(c + "\n" for c in novos))
    return len(novos)
