"""Medição da Orquestração para o faturamento por contrato.

Cada rodada do dia grava em `contratos_mes` os contratos da carteira em cobrança (na_carga) que o motor
avaliou: um registro por contrato distinto no mês (empresa × credor × competência). Sem CPF, nome ou
telefone: só o código do contrato. Cliente sem código de contrato na carga conta como um contrato
("cliente:<id>").

Para não reenviar o mês inteiro todo dia, guarda localmente o que já subiu (estado/contratos_AAAA-MM.txt);
o banco também não duplica (chave primária), então reenviar é inofensivo.

Ciclo de uso (ciclo_empresa, SQL 19): o uso conta do dia de corte até a véspera do corte no mês seguinte e a
competência é o mês em que o ciclo termina (corte 21: "outubro" = 21/09 a 20/10). Corte 1 = mês fechado.
A MotorCli (Jornada) mede clientes distintos acionados no ciclo em jornada_clientes_mes.
"""
import csv
from datetime import date
from pathlib import Path


def competencia(dia: date, corte: int = 1) -> date:
    """Competência do dia de uso: o mês em que o ciclo termina."""
    if corte > 1 and dia.day >= corte:
        return date(dia.year + dia.month // 12, dia.month % 12 + 1, 1)
    return dia.replace(day=1)


def corte_da_empresa(sb, empresa_id) -> int:
    """Dia de corte do ciclo de uso da empresa (1 sem ciclo cadastrado ou banco sem o SQL 19)."""
    try:
        linha = (sb.selecionar("ciclo_empresa", {"empresa_id": f"eq.{empresa_id}"}) or [{}])[0]
        corte = int(linha.get("dia_corte") or 1)
    except Exception:  # noqa: BLE001 — banco antigo: mês fechado
        return 1
    return corte if 1 <= corte <= 28 else 1


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
    competencia_ = competencia(data, corte_da_empresa(sb, empresa_id))
    cache = pasta / "estado" / f"contratos_{competencia_:%Y-%m}.txt"
    ja = set(cache.read_text(encoding="utf-8").splitlines()) if cache.exists() else set()
    novos = sorted(contratos_avaliados(pasta / "base") - ja)
    if not novos:
        return 0
    sb.inserir("contratos_mes", [{"empresa_id": empresa_id, "credor_id": credor_id or 0,
                                  "competencia": competencia_.isoformat(), "contrato": c,
                                  "primeiro_dia": data.isoformat()} for c in novos],
               conflito="empresa_id,competencia,credor_id,contrato")
    cache.parent.mkdir(parents=True, exist_ok=True)
    with open(cache, "a", encoding="utf-8") as f:
        f.write("".join(c + "\n" for c in novos))
    return len(novos)


def publicar_clientes_jornada(sb, empresa_id, credor_id, pasta: Path, data: date, fila: list[dict]) -> int:
    """MotorCli: sobe os clientes acionados hoje que ainda não estavam no ciclo. Devolve quantos eram novos."""
    pasta = Path(pasta)
    comp = competencia(data, corte_da_empresa(sb, empresa_id))
    cache = pasta / "estado" / f"jornada_clientes_{comp:%Y-%m}.txt"
    ja = set(cache.read_text(encoding="utf-8").splitlines()) if cache.exists() else set()
    novos = sorted({l["id_cliente"][:60] for l in fila if l.get("id_cliente")} - ja)
    if not novos:
        return 0
    for i in range(0, len(novos), 1000):
        sb.inserir("jornada_clientes_mes", [{"empresa_id": empresa_id, "credor_id": credor_id or 0,
                                              "competencia": comp.isoformat(), "id_cliente": c,
                                              "primeiro_dia": data.isoformat()} for c in novos[i:i + 1000]],
                   conflito="empresa_id,competencia,credor_id,id_cliente")
    cache.parent.mkdir(parents=True, exist_ok=True)
    with open(cache, "a", encoding="utf-8") as f:
        f.write("".join(c + "\n" for c in novos))
    return len(novos)
