"""Realizado por motivo do Speech Analytics (SQL 63 · voz_resultado_por_motivo): pagou em até 30 dias por motivo.

Só o motor sabe quem pagou (base/pagamentos.csv da carteira; sem ele, a 1ª parcela paga de base/parcelas.csv), com a
MESMA regra da propensão (motor/propensao.py: quitação ou 1ª parcela, pagou = 1). Depois da rotina de cada carteira,
o motor manda ao banco só a lista de quem pagou (id do cliente e data, dos últimos 95 dias) e o banco
(gravar_resultado_por_motivo_voz) refaz, para os dias com os 30 dias já fechados, as contagens por dia e motivo das
ligações analisadas (conversas, promessas, pagamentos). Nenhum id de cliente fica gravado; o site só lê pela função
resultado_por_motivo_voz, que esconde grupo com menos de 30. Valor pago nunca sai do motor.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

JANELA_DIAS = 95          # os pagamentos que podem cair na janela de 30 dias dos dias refeitos (de −60 a −30)


def pagadores(pasta: Path, data: date) -> list[dict] | None:
    """[{id_cliente, data}] de quem pagou nos últimos JANELA_DIAS dias; None quando a carteira não tem pagamentos."""
    from motor import propensao
    base = Path(pasta) / "base"
    parcelas = None
    if not (base / "pagamentos.csv").exists():
        if not (base / "parcelas.csv").exists():
            return None
        from motor.ingestao import carregar_parcelas
        parcelas = carregar_parcelas(base / "parcelas.csv")[0]
    desde = data - timedelta(days=JANELA_DIAS)
    vistos = set()
    for p in propensao.carregar_pagamentos(base / "pagamentos.csv", parcelas):
        if p.get("pagou") and desde <= p["data"] <= data:
            vistos.add((str(p["id_cliente"]), p["data"].isoformat()))
    return [{"id_cliente": i, "data": d} for i, d in sorted(vistos)]


def publicar(sb, empresa_id: int, credor_id: int | None, pasta: Path, data: date) -> dict | None:
    """Chama gravar_resultado_por_motivo_voz; None se não há pagamentos na carteira (nada a refazer)."""
    lista = pagadores(pasta, data)
    if lista is None:
        return None
    return sb.rpc("gravar_resultado_por_motivo_voz", {"empresa": int(empresa_id),
                                                      "credor": None if credor_id is None else int(credor_id),
                                                      "pagamentos": lista, "ate": data.isoformat()})
