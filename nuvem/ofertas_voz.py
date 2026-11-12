"""Ofertas prontas do arquivo para o agente de voz (SQL 130): a rotina publica as da lista de hoje do agente.

Depois da Lista do dia, as ofertas lidas da carga (base/ofertas.csv, feito por motor/ofertas_mailing.py) dos clientes
que estão no ids/agente_voz*.csv de hoje vão para voz_ofertas_dia por `publicar_ofertas_voz` (service_role; a função
troca tudo da carteira e não grava nada se a carteira está em "só a API"). Nunca vai para o Storage (`saidas/ids` é
lido por qualquer usuário da empresa). Antes de gravar, `checar_linhas` barra id com cara de CPF.

Nunca derruba a rotina: banco sem o SQL 130 ou erro viram um alerta. Log e alerta só com contagens.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from motor import ofertas_mailing as OM
from motor.pseudonimo import checar_linhas
from nuvem.identidade_voz import ids_do_agente

LOTE = 5000
ALERTA_SQL130 = ("BANCO: rode o SQL 130 (supabase/migrations/20270327000001_voz_ofertas_fonte.sql) para o agente de voz "
                 "usar as ofertas do arquivo")


def publicar(sb, eid, cid, pasta: Path, dia: date, saida: Path | None, out=print) -> str | None:
    """Troca as ofertas da carteira no banco pelas da lista de hoje do agente. Devolve um alerta ou None."""
    from nuvem.supabase_api import ErroSupabase
    if cid is None:
        return None
    ids = ids_do_agente(saida)
    linhas = [l for l in OM.ler(Path(pasta) / "base") if l["id_cliente"] in ids]
    try:
        checar_linhas("voz_ofertas_dia", linhas)
        total = 0
        lotes = [linhas[i:i + LOTE] for i in range(0, len(linhas), LOTE)] or [[]]
        for i, lote in enumerate(lotes):
            r = sb.rpc("publicar_ofertas_voz", {"empresa": int(eid), "credor": int(cid), "dia": dia.isoformat(),
                                                "linhas": lote, "substituir": i == 0})
            r = (r[0] if isinstance(r, list) and r else r) if r else {}
            r = r if isinstance(r, dict) else {}
            if not r.get("usa_arquivo"):
                break
            total += int(r.get("gravados") or 0)
    except ErroSupabase as ex:
        if "publicar_ofertas_voz" in str(ex):
            return ALERTA_SQL130 if linhas else None
        return f"AGENTE DE VOZ: ofertas do arquivo não publicadas ({str(ex)[:120]})"
    except ValueError as ex:      # checar_linhas: id com cara de CPF (nunca devia chegar aqui)
        return f"AGENTE DE VOZ: ofertas do arquivo não publicadas ({str(ex)[:120]})"
    if total:
        out(f"  agente de voz: ofertas do arquivo para {len({l['id_cliente'] for l in linhas})} cliente(s) da lista")
    return None


def resumo(rel_base: dict | None) -> dict | None:
    """O relatório da carga (só contagens) para o envio (envios.relatorio.ofertas_voz) e a tela Ofertas da carteira."""
    r = (rel_base or {}).get("ofertas") or {}
    if not r.get("colunas"):
        return None
    return {k: r.get(k) for k in ("clientes_na_carga", "clientes_com_oferta", "ofertas", "varios_contratos",
                                  "descartadas")}
