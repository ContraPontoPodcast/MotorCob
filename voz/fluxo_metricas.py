"""Job noturno das métricas do Fluxo do agente (SQL 66), na VM.

Às 02:50 (timer motorcx-voz-fluxo-noite), para cada empresa com voz da parte i/n desta VM (fluxo_empresas_voz), refaz
o funil por versão, dia e bloco (voz_fluxo_metricas_dia) e as intenções (voz_fluxo_intencoes_dia) de ontem e anteontem
com agregar_fluxo_dia, a partir de voz_fluxo_passos e voz_chamadas. Idempotente: rodar de novo refaz os mesmos números.
Só códigos e contagens; nenhum dado por cliente sai daqui. Sem IA, sem custo: não tem interruptor.

Os dois acessos da VM (voz/acesso.py): as mesmas RPCs pela chave do servidor ou pelas funções de voz_vm
(voz_vm.fluxo_empresas e voz_vm.agregar_fluxo_dia, papel motorcx_voz).

Uso: python -m voz.fluxo_metricas --parte 1/1 [--dias 2] [--hoje AAAA-MM-DD]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

log = logging.getLogger("motorcx.voz.fluxo_metricas")
JANELA_DIAS = 35          # o banco recusa dia mais antigo que isso


def noite(sb, hoje: date, parte: str = "1/1", dias: int = 2) -> dict:
    """Agrega os `dias` anteriores a hoje (o mais antigo primeiro; hoje fica para amanhã). Uma empresa que falha não
    segura as outras."""
    out = Counter()
    empresas = sb.rpc("fluxo_empresas_voz", {"parte": parte}) or []
    out["empresas"] = len(empresas)
    for e in empresas:
        try:
            for k in range(min(max(1, dias), JANELA_DIAS), 0, -1):
                r = sb.rpc("agregar_fluxo_dia", {"empresa": int(e), "dia": (hoje - timedelta(days=k)).isoformat()}) or {}
                out["dias"] += 1
                out["blocos"] += int(r.get("blocos") or 0)
                out["intencoes"] += int(r.get("intencoes") or 0)
        except Exception as ex:   # noqa: BLE001 — uma empresa não segura as outras
            log.warning("fluxo: noite da empresa %s falhou (%s)", e, ex.__class__.__name__)
            out["erros"] += 1
    return dict(out)


def main(argv=None, sb=None) -> int:
    ap = argparse.ArgumentParser(description="Métricas do Fluxo do agente na VM (job noturno)")
    ap.add_argument("--parte", default="1/1")
    ap.add_argument("--dias", type=int, default=2)
    ap.add_argument("--hoje", type=date.fromisoformat, default=None)
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if sb is None:   # pragma: no cover - VM
        from voz.configuracao import supabase_do_ambiente
        sb = supabase_do_ambiente()
    hoje = a.hoje or datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    out = noite(sb, hoje, a.parte, a.dias)
    print(json.dumps(out, ensure_ascii=False, sort_keys=True))
    return 1 if out.get("erros") and not out.get("dias") else 0


if __name__ == "__main__":   # pragma: no cover
    sys.exit(main())
