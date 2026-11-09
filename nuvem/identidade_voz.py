"""Identidade pelo arquivo do agente de voz (SQL 88): a rotina publica os CÓDIGOS da lista de hoje do agente.

Depois da Lista do dia, os códigos de validação (base/identidade.csv, feitos na leitura da carga por
motor/identidade_mailing.py) dos clientes que estão no ids/agente_voz*.csv de hoje vão para voz_identidade_dia por
`publicar_identidade_voz` (service_role; a função troca tudo da carteira, então quem saiu da lista ou da carteira sai
junto, e não grava nada se a carteira não confere pelo arquivo). Nunca vai para o Storage (`saidas/ids` é lido por
qualquer usuário da empresa: SPEC §4.1). Antes de gravar, `checar_linhas` barra id com cara de CPF.

Nunca derruba a rotina: banco sem o SQL 88, sem chave ou erro viram um alerta. Log e alerta só com contagens.
"""
from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from motor import identidade_mailing as IM
from motor.pseudonimo import checar_linhas

LOTE = 5000
ALERTA_SQL88 = ("BANCO: rode o SQL 88 (supabase/migrations/20270124000001_voz_identidade_mailing.sql) para o agente de "
                "voz confirmar a identidade pelo arquivo")
ALERTA_SEM_CHAVE = ("AGENTE DE VOZ: a carga trouxe colunas de validação, mas a chave de identidade da empresa ainda não "
                    "existe no Secret Manager (motorcx-voz-identidade-e{eid}); nenhum código foi feito e o agente "
                    "segue conferindo pelo CRM")


def chave(eid, out=print) -> IM.Chave | None:
    """A chave da empresa (variável de ambiente gravada pelo motorcob-rodar). Fora do formato: aviso, sem chave."""
    try:
        return IM.chave_do_ambiente(eid)
    except IM.ChaveInvalida as ex:
        out(f"  aviso: {ex}")
        return None


def ids_do_agente(saida: Path | None) -> set[str]:
    """Clientes da lista de hoje do agente (ids/agente_voz.csv e o arquivo da reserva, se houver)."""
    ids: set[str] = set()
    if saida is None:
        return ids
    for arq in sorted((Path(saida) / "ids").glob("agente_voz*.csv")):
        with open(arq, newline="", encoding="utf-8") as f:
            for l in csv.DictReader(f, delimiter=";"):
                if l.get("id_cliente"):
                    ids.add(l["id_cliente"].strip())
    return ids


def publicar(sb, eid, cid, pasta: Path, dia: date, saida: Path | None, out=print) -> str | None:
    """Troca os códigos da carteira no banco pelos da lista de hoje do agente. Devolve um alerta ou None."""
    from nuvem.supabase_api import ErroSupabase
    if cid is None:
        return None
    ids = ids_do_agente(saida)
    linhas = [{"id_cliente": l["id_cliente"], "pergunta": l["pergunta"], "codigo": l["codigo"],
               "versao": int(l["versao"])} for l in IM.ler(Path(pasta) / "base") if l["id_cliente"] in ids]
    try:
        checar_linhas("voz_identidade_dia", linhas)
        total = 0
        lotes = [linhas[i:i + LOTE] for i in range(0, len(linhas), LOTE)] or [[]]
        for i, lote in enumerate(lotes):
            r = sb.rpc("publicar_identidade_voz", {"empresa": int(eid), "credor": int(cid), "dia": dia.isoformat(),
                                                   "linhas": lote, "substituir": i == 0})
            r = (r[0] if isinstance(r, list) and r else r) if r else {}
            r = r if isinstance(r, dict) else {}
            if not r.get("usa_arquivo"):
                break
            total += int(r.get("gravados") or 0)
    except ErroSupabase as ex:
        if "publicar_identidade_voz" in str(ex):
            return ALERTA_SQL88 if linhas else None
        return f"AGENTE DE VOZ: códigos de identidade não publicados ({str(ex)[:120]})"
    except ValueError as ex:      # checar_linhas: id com cara de CPF (nunca devia chegar aqui)
        return f"AGENTE DE VOZ: códigos de identidade não publicados ({str(ex)[:120]})"
    if total:
        out(f"  agente de voz: identidade pelo arquivo para {len({l['id_cliente'] for l in linhas})} cliente(s) da lista")
    return None


def alerta_da_carga(rel_base: dict | None, eid) -> str | None:
    """Carga com coluna de validação apontada e sem chave: avisa (só uma frase, sem número de cliente)."""
    r = (rel_base or {}).get("identidade") or {}
    if any((r.get("colunas") or {}).values()) and not r.get("chave"):
        return ALERTA_SEM_CHAVE.format(eid=eid)
    return None


def resumo(rel_base: dict | None) -> dict | None:
    """O relatório da carga (só contagens) para o envio e o e-mail."""
    r = (rel_base or {}).get("identidade") or {}
    if not any((r.get("colunas") or {}).values()):
        return None
    return {k: r.get(k) for k in ("colunas", "chave", "nascimento_validas", "nascimento_invalidas",
                                  "documento_validos", "documento_invalidos", "clientes_com_codigo")}
