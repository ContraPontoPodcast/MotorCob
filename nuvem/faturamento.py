"""Medição da Orquestração para o faturamento por CPF (SQL 69).

A Orquestração é cobrada por CPF: clientes distintos que estiveram na carteira em cobrança (na_carga) em pelo
menos um dia do ciclo. Cada rodada do dia grava em `clientes_mes` um registro por cliente distinto no ciclo
(empresa × credor × competência). A chave do cliente é HMAC-SHA256 com o sal secreto da empresa
(`faturamento_sal`, só a rotina lê) sobre a chave pseudônima da pessoa (`norm.chave_pessoa` do CPF da carteira,
em memória) ou, sem CPF, sobre o id_cliente. Nunca CPF, nome ou telefone: só 32 hexadecimais. O mesmo CPF em dois
credores da mesma empresa vira a mesma chave e a fatura conta uma vez (distinct por empresa); vários contratos do
mesmo cliente contam uma vez; quem saiu da carga para de contar no ciclo seguinte.

Continua gravando `contratos_mes` (informativo: contratos avaliados): um registro por contrato distinto no ciclo,
só o código do contrato; cliente sem código de contrato conta como um contrato ("cliente:<id>").

Para não reenviar o ciclo inteiro todo dia, guarda localmente o que já subiu (estado/contratos_AAAA-MM.txt e
estado/clientes_AAAA-MM.txt, este só com as chaves HMAC; ciclo em dias: AAAA-MM-DD); o banco também não duplica (chave primária), então
reenviar é inofensivo.

Ciclo de uso (ciclo_empresa, SQL 19 e 22): mensal = do dia de corte até a véspera do corte no mês seguinte, e a
competência é o mês em que o ciclo termina (corte 21: "outubro" = 21/09 a 20/10; corte 1 = mês fechado); em dias
(semanal, quinzenal, a cada N dias) = a competência é o primeiro dia do ciclo.
A MotorCli (Jornada) mede clientes distintos acionados no ciclo em jornada_clientes_mes.
"""
import csv
import hashlib
import hmac
from datetime import date, timedelta
from pathlib import Path

from motor import normalizacao as norm


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


def _sufixo(comp: date) -> str:
    """Nome do arquivo de controle do ciclo: AAAA-MM no mensal; AAAA-MM-DD no ciclo em dias (dois ciclos semanais
    no mesmo mês não podem dividir o arquivo, senão o segundo não sobe ninguém)."""
    return f"{comp:%Y-%m}" if comp.day == 1 else comp.isoformat()


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


def _em_cobranca(pasta_base: Path):
    """(id_cliente, id_contrato) da carteira em cobrança hoje (base/clientes.csv × base/na_carga.csv)."""
    pasta_base = Path(pasta_base)
    clientes, na_carga = pasta_base / "clientes.csv", pasta_base / "na_carga.csv"
    if not clientes.exists():
        return
    ativos = None
    if na_carga.exists():
        with open(na_carga, encoding="utf-8") as f:
            ativos = {l.strip() for l in f.readlines()[1:] if l.strip()}
    with open(clientes, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            idc = (r.get("id_cliente") or "").strip()
            if not idc or (ativos is not None and idc not in ativos):
                continue
            yield idc, (r.get("id_contrato") or "").strip()


def contratos_avaliados(pasta_base: Path) -> set[str]:
    """Contratos dos clientes em cobrança hoje (base/clientes.csv × base/na_carga.csv)."""
    return {(ct or f"cliente:{idc}")[:120] for idc, ct in _em_cobranca(pasta_base)}


def pessoas_da_carteira(contatos_csv: Path) -> dict[str, str]:
    """id_cliente -> chave pseudônima da pessoa (do CPF da carteira; só em memória, nunca vai para saída)."""
    pessoa_de = {}
    contatos_csv = Path(contatos_csv)
    if not contatos_csv.exists():
        return pessoa_de
    with open(contatos_csv, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            idc = norm.id_cliente(r.get("id_cliente"))
            if idc and idc not in pessoa_de and (r.get("cpf") or "").strip():
                cpf = norm.cpf(r["cpf"])
                if cpf:
                    pessoa_de[idc] = norm.chave_pessoa(cpf)
    return pessoa_de


def chave_cliente(sal: str, idc: str, pessoa_de: dict[str, str], originais: dict[str, str] | None = None) -> str:
    """Chave do cliente em clientes_mes: HMAC-SHA256(sal da empresa, pessoa do CPF ou id_cliente), 32 hexadecimais.
    Sem o sal (que só a rotina lê) não dá para voltar ao CPF nem testar CPFs. Id que virou código pseudônimo (era o
    CPF; motor/pseudonimo.py) usa o valor original (base/ids_originais.csv): a chave não muda com a troca do id e o
    cliente não conta duas vezes no ciclo."""
    base = pessoa_de.get(idc) or f"id:{(originais or {}).get(idc, idc)}"
    return hmac.new(sal.encode(), base.encode(), hashlib.sha256).hexdigest()[:32]


def clientes_avaliados(pasta: Path, sal: str) -> set[str]:
    """Chaves dos clientes (CPFs) em cobrança hoje: cada pessoa uma vez, quantos contratos tiver."""
    pasta = Path(pasta)
    ids = {idc for idc, _ in _em_cobranca(pasta / "base")}
    if not ids:
        return set()
    pessoa_de = pessoas_da_carteira(pasta / "base" / "contatos.csv")
    from motor.pseudonimo import ler_originais
    originais = ler_originais(pasta / "base")
    return {chave_cliente(sal, idc, pessoa_de, originais) for idc in ids}


def sal_da_empresa(sb, empresa_id) -> str:
    """Sal secreto da empresa (faturamento_sal, SQL 69). Cria a linha se a empresa ainda não tem (o banco gera)."""
    filtro = {"empresa_id": f"eq.{empresa_id}"}
    linha = (sb.selecionar("faturamento_sal", filtro) or [{}])[0]
    if not linha.get("sal"):
        sb.inserir("faturamento_sal", [{"empresa_id": empresa_id}], conflito="empresa_id")
        linha = (sb.selecionar("faturamento_sal", filtro) or [{}])[0]
    sal = str(linha.get("sal") or "")
    if len(sal) < 32:
        raise RuntimeError("empresa sem sal do faturamento (rode o SQL 69)")
    return sal


def publicar_contratos(sb, empresa_id, credor_id, pasta: Path, data: date) -> int:
    """Sobe os contratos do dia que ainda não estavam no mês. Devolve quantos eram novos."""
    pasta = Path(pasta)
    competencia_ = competencia(data, ciclo_da_empresa(sb, empresa_id))
    cache = pasta / "estado" / f"contratos_{_sufixo(competencia_)}.txt"
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


def publicar_clientes(sb, empresa_id, credor_id, pasta: Path, data: date) -> int:
    """Orquestração por CPF: sobe os clientes do dia que ainda não estavam no ciclo. Devolve quantos eram novos."""
    pasta = Path(pasta)
    if not (pasta / "base" / "clientes.csv").exists():
        return 0
    comp = competencia(data, ciclo_da_empresa(sb, empresa_id))
    cache = pasta / "estado" / f"clientes_{_sufixo(comp)}.txt"
    ja = set(cache.read_text(encoding="utf-8").splitlines()) if cache.exists() else set()
    novos = sorted(clientes_avaliados(pasta, sal_da_empresa(sb, empresa_id)) - ja)
    if not novos:
        return 0
    for i in range(0, len(novos), 1000):
        sb.inserir("clientes_mes", [{"empresa_id": empresa_id, "credor_id": credor_id or 0,
                                      "competencia": comp.isoformat(), "cliente": c,
                                      "primeiro_dia": data.isoformat()} for c in novos[i:i + 1000]],
                   conflito="empresa_id,competencia,credor_id,cliente")
    cache.parent.mkdir(parents=True, exist_ok=True)
    with open(cache, "a", encoding="utf-8") as f:
        f.write("".join(c + "\n" for c in novos))
    return len(novos)


def publicar_clientes_jornada(sb, empresa_id, credor_id, pasta: Path, data: date, fila: list[dict]) -> int:
    """MotorCli: sobe os clientes acionados hoje que ainda não estavam no ciclo. Devolve quantos eram novos."""
    pasta = Path(pasta)
    comp = competencia(data, ciclo_da_empresa(sb, empresa_id))
    cache = pasta / "estado" / f"jornada_clientes_{_sufixo(comp)}.txt"
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
