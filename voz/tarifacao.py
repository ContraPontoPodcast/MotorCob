"""Tipo do número, rotas candidatas (prioridade e failover) e tarifação por tentativa (decisão 11 do dono).

  tipo_numero        fixo_local · fixo_ldn · movel_vc1 · movel_vc2_vc3 (pelo DDD de origem do tronco)
  rotas_para         rotas vigentes da empresa para o número, em ordem de prioridade (failover)
  segundos_tarifados igual à função do banco (V20): 0 se billsec ≤ 0; inicial se billsec ≤ inicial; senão
                     inicial + ceil((billsec − inicial) ÷ incremento) × incremento
  custo_operadora    segundos tarifados × preço do minuto da vigência do dia; rota sem preço = None (nunca
                     preço inventado)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

from voz.banco import DadosVoz, Rota, Tronco

# rota que falta para um tipo: tenta a "vizinha" (mesmo meio) antes de desistir
VIZINHA = {"fixo_local": "fixo_ldn", "fixo_ldn": "fixo_local", "movel_vc1": "movel_vc2_vc3",
           "movel_vc2_vc3": "movel_vc1"}


def nacional(numero: str | None) -> str | None:
    """DDD + número (10 ou 11 dígitos), sem 55 nem zero; None se não for número brasileiro discável."""
    n = "".join(c for c in str(numero or "") if c.isdigit())
    if len(n) in (12, 13) and n.startswith("55"):
        n = n[2:]
    if len(n) in (11, 12) and n.startswith("0"):
        n = n[1:]
    if len(n) not in (10, 11) or n[0] == "0" or n[1] == "0":
        return None
    if len(n) == 11 and n[2] != "9":
        return None
    if len(n) == 10 and n[2] not in "2345":
        return None
    return n


def tipo_numero(numero: str, ddd_origem: str | None) -> str | None:
    n = nacional(numero)
    if n is None:
        return None
    movel = len(n) == 11
    mesmo = ddd_origem is None or n[:2] == str(ddd_origem)
    if movel:
        return "movel_vc1" if mesmo else "movel_vc2_vc3"
    return "fixo_local" if mesmo else "fixo_ldn"


@dataclass(frozen=True)
class Candidata:
    rota: Rota
    tronco: Tronco
    tipo: str
    discar: str          # tech prefix + (0+CSP | 55 | nada, pelo formato do tronco) + DDD + número

    @property
    def endpoint(self) -> str:
        return f"PJSIP/{self.discar}@{self.tronco.nome}"


def rotas_para(dados: DadosVoz, empresa_id: int, numero: str, dia: date) -> list[Candidata]:
    """Rotas vigentes da empresa para o número, por prioridade (1 primeiro); empate: id. Só troncos ativos.
    O tipo é calculado com o DDD de origem de CADA tronco (o IP e a origem são do tronco, não da rota)."""
    n = nacional(numero)
    if n is None:
        return []
    troncos = {t.id: t for t in dados.troncos_da(empresa_id)}
    vig = [r for r in dados.rotas if r.empresa_id == empresa_id and r.tronco_id in troncos and r.vigente(dia)]
    saida = []
    for r in sorted(vig, key=lambda r: (r.prioridade, r.id)):
        t = troncos[r.tronco_id]
        tipo = tipo_numero(n, t.ddd_origem)
        if r.tipo == tipo:
            saida.append(Candidata(r, t, tipo, t.discar(r.tech_prefix, n)))
    if saida:
        return saida
    for r in sorted(vig, key=lambda r: (r.prioridade, r.id)):
        t = troncos[r.tronco_id]
        tipo = tipo_numero(n, t.ddd_origem)
        if r.tipo == VIZINHA.get(tipo):
            saida.append(Candidata(r, t, tipo, t.discar(r.tech_prefix, n)))
    return saida


def rota_vigente(dados: DadosVoz, empresa_id: int, tech_prefix: str, dia: date) -> Rota | None:
    """Igual a rota_voz_vigente(empresa, tech_prefix, dia) do banco."""
    vs = [r for r in dados.rotas if r.empresa_id == empresa_id and r.tech_prefix == tech_prefix and r.vigente(dia)]
    return max(vs, key=lambda r: (r.vigente_desde or date.min, r.id)) if vs else None


def segundos_tarifados(billsec: int | None, inicial: int, incremento: int) -> int:
    b = int(billsec or 0)
    if b <= 0:
        return 0
    if b <= inicial:
        return inicial
    return inicial + math.ceil((b - inicial) / incremento) * incremento


def tarifar(dados: DadosVoz, empresa_id: int, tech_prefix: str | None, billsec: int | None, dia: date) -> dict:
    """{rota_id, segundos_tarifados, preco_minuto, custo_operadora}; rota sem cadastro: tudo None + alerta."""
    r = rota_vigente(dados, empresa_id, tech_prefix, dia) if tech_prefix else None
    if r is None:
        return {"rota_id": None, "segundos_tarifados": None, "preco_minuto": None, "custo_operadora": None,
                "alerta": "rota_sem_cadastro"}
    seg = segundos_tarifados(billsec, r.cadencia_inicial_s, r.cadencia_incremento_s)
    custo = round(seg / 60 * r.preco_minuto, 5) if r.preco_minuto is not None else None
    return {"rota_id": r.id, "segundos_tarifados": seg, "preco_minuto": r.preco_minuto, "custo_operadora": custo,
            "alerta": None if r.preco_minuto is not None else "rota_sem_preco"}
