"""Situação do acordo do cliente a partir das parcelas (sistema de acordos).

Pagamento só conta com baixa: `baixas_ate` é a data até a qual o arquivo de
baixas já reflete os pagamentos (padrão: ontem, baixa em D+1). Parcela vencida
sem baixa confirmada não dispara quebra — evita acionar quem já pagou.
"""
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Parcela:
    id_cliente: str
    id_acordo: str
    numero: int
    vencimento: date
    valor: float
    pago_em: date | None = None


def situacao_acordo(parcelas: list[Parcela], hoje: date, baixas_ate: date,
                    quebrados: set[str]) -> tuple[str, str, str] | None:
    """Retorna (estado, ciclo, id_acordo) do acordo vigente, ou None se não há acordo.

    estado: LIQ (tudo pago) · QBR (parcela vencida sem pagamento; ciclo D1, D2…)
            · PRE (parcela vence em até 3 dias; ciclo D-3…D0) · COL (em dia)
    """
    por_acordo: dict[str, list[Parcela]] = {}
    for p in parcelas:
        if p.id_acordo not in quebrados:
            por_acordo.setdefault(p.id_acordo, []).append(p)
    if not por_acordo:
        return None
    # acordo vigente = o mais recente (maior 1º vencimento)
    id_acordo, ps = max(por_acordo.items(), key=lambda kv: min(p.vencimento for p in kv[1]))
    pendentes = [p for p in ps if p.pago_em is None or p.pago_em > baixas_ate]
    if not pendentes:
        return ("LIQ", "", id_acordo)
    vencidas = [p for p in pendentes if p.vencimento < hoje and p.vencimento <= baixas_ate]
    if vencidas:
        return ("QBR", f"D{(hoje - min(p.vencimento for p in vencidas)).days}", id_acordo)
    prox = min(p.vencimento for p in pendentes)
    dv = (prox - hoje).days
    if 0 <= dv <= 3:
        return ("PRE", "D0" if dv == 0 else f"D-{dv}", id_acordo)
    return ("COL", "", id_acordo)
