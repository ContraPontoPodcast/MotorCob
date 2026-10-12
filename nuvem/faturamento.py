"""Medição da Orquestração para o faturamento por contrato.

Cada rodada do dia grava em `contratos_mes` os contratos da carteira em cobrança (na_carga) que o motor
avaliou: um registro por contrato distinto no mês (empresa × credor × competência). Sem CPF, nome ou
telefone: só o código do contrato. Cliente sem código de contrato na carga conta como um contrato
("cliente:<id>").

Para não reenviar o mês inteiro todo dia, guarda localmente o que já subiu (estado/contratos_AAAA-MM.txt);
o banco também não duplica (chave primária), então reenviar é inofensivo.

Ciclo de uso (ciclo_empresa, SQL 19 e 22): mensal = do dia de corte até a véspera do corte no mês seguinte, e a
competência é o mês em que o ciclo termina (corte 21: "outubro" = 21/09 a 20/10; corte 1 = mês fechado); em dias
(semanal, quinzenal, a cada N dias) = a competência é o primeiro dia do ciclo.
A MotorCli (Jornada) mede clientes distintos acionados no ciclo em jornada_clientes_mes.
"""
import csv
from datetime import date, timedelta
from pathlib import Path


def competencia(dia: date, ciclo=1) -> date:
    """Competência do dia de uso. ciclo: dia de corte (int, ciclo mensal) ou a linha de ciclo_empresa.
    Mensal: o dia 1 do mês em que o ciclo termina. Em dias: o primeiro dia do ciclo."""
    if isinstance(ciclo, dict):
        if ciclo.get("periodicidade") == "dias" and ciclo.get("ciclo_dias") and ciclo.get("inicio"):
            inicio, n = date.fromisoformat(str(ciclo["inicio"])[:10]), int(ciclo["ciclo_dias"])
            return inicio + timedelta(days=((dia - inicio).days // n) * n)
        ciclo = int(ciclo.get("dia_corte") or 1)
    if ciclo > 1 and dia.day >= ciclo:
        return date(dia.year + dia.month // 12, dia.month % 12 + 1, 1)
    return dia.replace(day=1)


def ciclo_da_empresa(sb, empresa_id) -> dict:
    """Linha de ciclo_empresa (vazia = mês fechado; banco sem o SQL 19 também)."""
    try:
        return (sb.selecionar("ciclo_empresa", {"empresa_id": f"eq.{empresa_id}"}) or [{}])[0]
    except Exception:  # noqa: BLE001 — banco antigo: mês fechado
        return {}


def corte_da_empresa(sb, empresa_id) -> int:
    """Dia de corte do ciclo mensal (1 sem ciclo cadastrado)."""
    try:
        corte = int(ciclo_da_empresa(sb, empresa_id).get("dia_corte") or 1)
    except (TypeError, ValueError):
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
    competencia_ = competencia(data, ciclo_da_empresa(sb, empresa_id))
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
    comp = competencia(data, ciclo_da_empresa(sb, empresa_id))
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
