"""Assistente (SQL 43): cotação do dólar para o teto do mês em reais e aviso de teto para a equipe.

* Uma vez por dia: a PTAX de venda do Banco Central (último dia útil) vira a cotação do Assistente, a não ser que o
  Master tenha digitado uma cotação manual no Console.
* A cada 10 minutos: aviso no sino (e e-mail, conforme a preferência) com 80% e com 100% do teto do mês.
Banco ainda sem o SQL 43 ou Banco Central fora do ar: nada acontece e o plantão segue.
"""
import json
import urllib.parse
import urllib.request
from datetime import date, timedelta

PTAX = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)"


def _ptax_do_dia(dia: date) -> float | None:
    q = urllib.parse.urlencode({"@dataCotacao": f"'{dia.strftime('%m-%d-%Y')}'", "$format": "json"})
    try:
        with urllib.request.urlopen(f"{PTAX}?{q}", timeout=20) as r:
            valores = json.loads(r.read().decode("utf-8")).get("value") or []
    except Exception:  # noqa: BLE001 — sem rede ou Banco Central fora: tenta amanhã
        return None
    vendas = [v.get("cotacaoVenda") for v in valores if v.get("cotacaoVenda")]
    return float(vendas[-1]) if vendas else None


def ptax(hoje: date, buscar=None) -> tuple[float, date] | None:
    """A PTAX de venda do último dia útil (até 7 dias para trás: fim de semana e feriado não têm cotação)."""
    buscar = buscar or _ptax_do_dia
    for i in range(1, 8):
        dia = hoje - timedelta(days=i)
        v = buscar(dia)
        if v and 1 <= v <= 50:
            return round(v, 4), dia
    return None


def cotacao(sb, out=print, hoje: date | None = None, buscar=None) -> float | None:
    r = ptax(hoje or date.today(), buscar)
    if not r:
        out("assistente: sem cotação do Banco Central hoje (o teto usa a última)")
        return None
    try:
        sb.rpc("registrar_cotacao_dolar", {"valor": r[0], "dia": r[1].isoformat()})
    except Exception:  # noqa: BLE001 — banco ainda sem o SQL 43
        return None
    return r[0]


def teto(sb, out=print) -> int:
    try:
        n = sb.rpc("avisar_teto_assistente") or 0
    except Exception:  # noqa: BLE001 — banco ainda sem o SQL 43
        return 0
    if n:
        out("assistente: aviso de teto do mês para a equipe")
    return n
