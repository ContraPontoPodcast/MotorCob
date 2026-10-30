"""Travas da estratégia: a empresa escolhe quais valem e os parâmetros de cada uma (estrategias.definicao).

    "travas": {
        "intervalo":       {"ligado": true, "horas": 48, "cpc": "segue"},        # cpc: segue | respeita
        "pausa_carteiras": {"ligado": true, "horas": 48},
        "horario":         {"ligado": true, "de": "08:00", "ate": "20:00", "sabado": "ate_14"},
                                                                   # sabado: normal | ate_14 | nao
        "domingo_feriado": {"ligado": true, "domingo": "nao", "feriados": "nacionais"},
                                                                   # domingo: nao | digitais | normal
                                                                   # feriados: nacionais | nenhum
        "limite_acoes":    {"ligado": true, "dia": 2, "semana": 6, "mes": 20},
        "limite_leads":    {"ligado": true, "semana": 2},          # MotorCli: só para leads
        "ligacoes":        {"ligado": true, "por_dia": 3,          # tentativas do discador por cliente/dia
                            "por_numero": 2, "intervalo_min": 120, "intervalo_ocupado": 15},  # (discagem.py)
        "nao_perturbe":    {"ligado": true, "quem": "voz"},        # voz | todos
        "freio_whatsapp":  {"ligado": true, "taxa": 3, "minimo": 500}
    }

Faixas de segurança (o site não deixa passar, e o motor corta se chegar fora delas):
- horário sempre entre 08:00 e 20:00, mesmo com a trava desligada;
- intervalo entre ações de no mínimo 12 h (desligado = 12 h);
- freio do WhatsApp com taxa de bloqueio de no máximo 5% (desligado = 5%).
A janela de cada canal (Canais) só encurta a da estratégia; dias do calendário e da trava se somam
(vale o mais restrito). Trava ausente = o padrão do playbook, como antes.

As travas exigidas por lei não estão aqui porque não desligam: opt-out, contato de terceiro, clientes
bloqueados (e, no MotorCli, lead sem base legal e cliente em atraso).
"""
from __future__ import annotations

import re

HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MIN_HORA, MAX_HORA = "08:00", "20:00"
MIN_INTERVALO_H = 12
MAX_FREIO = 0.05
CHAVES = {"cob": ("intervalo", "pausa_carteiras", "horario", "domingo_feriado", "limite_acoes", "ligacoes",
                  "nao_perturbe", "freio_whatsapp"),
          "cli": ("intervalo", "horario", "domingo_feriado", "limite_acoes", "limite_leads")}


def _int(v, lo=None, hi=None):
    if isinstance(v, bool):
        return None
    if isinstance(v, str) and re.fullmatch(r"\s*\d+\s*", v):
        v = int(v)
    if not isinstance(v, int):
        return None
    if lo is not None and v < lo:
        return None
    return min(v, hi) if hi is not None else v


def _num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _ligada(t) -> bool:
    return isinstance(t, dict) and t.get("ligado", True) not in (False, "false", "nao", "não", 0)


def ler(definicao: dict, frente: str = "cob", nome: str = "?") -> tuple[dict, list[str]]:
    """definicao["travas"] -> (parâmetros para o motor, avisos). Só devolve o que veio na definição."""
    bruto = definicao.get("travas") if isinstance(definicao, dict) else None
    if not bruto:
        return {}, []
    if not isinstance(bruto, dict):
        return {}, [f"{nome}: 'travas' precisa ser um objeto (vale o padrão)"]
    av, out = [], {}
    onde = f"{nome}/travas"
    for k in bruto:
        if k not in CHAVES[frente]:
            av.append(f"{onde}: '{k}' não existe {'no MotorCli' if frente == 'cli' else ''} (ignorada)".replace("  ", " "))

    if "intervalo" in bruto:
        t = bruto["intervalo"]
        h = _int((t or {}).get("horas"), 0) if _ligada(t) else MIN_INTERVALO_H
        if h is None:
            av.append(f"{onde}/intervalo: horas inválidas (vale o padrão)")
        else:
            if h < MIN_INTERVALO_H:
                av.append(f"{onde}/intervalo: mínimo de {MIN_INTERVALO_H} h entre ações (usado {MIN_INTERVALO_H} h)")
            out["recencia_horas"] = max(MIN_INTERVALO_H, min(h, 24 * 30))
            if _ligada(t) and t.get("cpc") in ("segue", "respeita"):
                out["recencia_cpc" if frente == "cob" else "recencia_pre_vencimento"] = t["cpc"] == "respeita"

    if "pausa_carteiras" in bruto and frente == "cob":
        t = bruto["pausa_carteiras"]
        h = _int((t or {}).get("horas"), 0, 24 * 30) if _ligada(t) else 0
        if h is None:
            av.append(f"{onde}/pausa_carteiras: horas inválidas (vale o padrão)")
        else:
            out["pausa_carteiras_horas"] = h

    if "horario" in bruto or "domingo_feriado" in bruto:
        # ausente = padrão do playbook (sábado até 14h, sem domingo, respeita feriados);
        # desligada = sem restrição além da faixa 08:00–20:00
        presente_h, presente_d = "horario" in bruto, "domingo_feriado" in bruto
        t = bruto.get("horario") if _ligada(bruto.get("horario")) else {}
        de, ate = (t or {}).get("de") or MIN_HORA, (t or {}).get("ate") or MAX_HORA
        if not HORA.match(str(de)) or not HORA.match(str(ate)):
            av.append(f"{onde}/horario: hora inválida (vale 08:00 às 20:00)")
            de, ate = MIN_HORA, MAX_HORA
        if de < MIN_HORA or ate > MAX_HORA:
            av.append(f"{onde}/horario: fora da faixa permitida (usado dentro de 08:00 às 20:00)")
        de, ate = max(de, MIN_HORA), min(ate, MAX_HORA)
        if de >= ate:
            av.append(f"{onde}/horario: 'de' precisa ser antes de 'até' (vale 08:00 às 20:00)")
            de, ate = MIN_HORA, MAX_HORA
        sab = (t or {}).get("sabado") or ("normal" if presente_h and not t else "ate_14")
        dias = [0, 1, 2, 3, 4] + ([] if sab == "nao" else [5])
        tj = {"seg_sex": [de, ate], "sabado": [de, min(ate, "14:00") if sab == "ate_14" else ate],
              "domingo": [de, ate], "respeita_feriados": True}
        if not presente_d:
            d = {"domingo": "nao", "feriados": "nacionais"}
        elif _ligada(bruto["domingo_feriado"]):
            d = bruto["domingo_feriado"]
        else:
            d = {"domingo": "normal", "feriados": "nenhum"}
        if (d or {}).get("domingo") in ("normal", "digitais"):
            dias.append(6)
            if d["domingo"] == "digitais":
                out["domingo_so_digitais"] = True
        if (d or {}).get("feriados") == "nenhum":
            tj["respeita_feriados"] = False
        if tj["sabado"][0] >= tj["sabado"][1]:
            dias = [x for x in dias if x != 5]
        tj["dias_semana"] = dias
        out["travas_janela"] = tj

    if "limite_acoes" in bruto and _ligada(bruto["limite_acoes"]):
        t = bruto["limite_acoes"]
        lim = {k: _int(t.get(k), 1, 999) for k in ("dia", "semana", "mes") if t.get(k) not in (None, "")}
        if any(v is None for v in lim.values()):
            av.append(f"{onde}/limite_acoes: use números a partir de 1 (os inválidos não valem)")
        lim = {k: v for k, v in lim.items() if v is not None}
        if lim:
            out["limite_acoes"] = lim

    if "limite_leads" in bruto and frente == "cli" and _ligada(bruto["limite_leads"]):
        s = _int(bruto["limite_leads"].get("semana"), 1, 99)
        if s is None:
            av.append(f"{onde}/limite_leads: 'semana' precisa ser número a partir de 1 (não vale)")
        else:
            out["limite_leads_semana"] = s

    if "ligacoes" in bruto and frente == "cob" and _ligada(bruto["ligacoes"]):
        t, dt = bruto["ligacoes"], {}
        extras = (("por_numero", "tentativas_numero_dia", 1, 10), ("intervalo_min", "intervalo_min_minutos", 0, 1440),
                  ("intervalo_ocupado", "intervalo_ocupado_minutos", 0, 1440))
        if "por_dia" in t or not any(k in t for k, *_ in extras):
            n = _int(t.get("por_dia"), 1, 10)
            if n is None:
                av.append(f"{onde}/ligacoes: tentativas por dia de 1 a 10 (vale o padrão)")
            else:
                out["spins_discador_dia"] = n
                dt["tentativas_cliente_dia"] = n
        for chave, destino, lo, hi in extras:      # regras de discagem da estratégia (motor/discagem.py)
            if t.get(chave) in (None, ""):
                continue
            v = _int(t[chave], lo, hi)
            if v is None:
                av.append(f"{onde}/ligacoes/{chave}: use um número de {lo} a {hi} (vale o padrão)")
            else:
                dt[destino] = v
        if dt:
            out["discagem_trava"] = dt

    if "nao_perturbe" in bruto and frente == "cob":
        t = bruto["nao_perturbe"]
        if _ligada(t) and t.get("quem") == "todos":
            out["nao_perturbe_todos"] = True        # voz respeita sempre (não dá para tirar)

    if "freio_whatsapp" in bruto and frente == "cob":
        t = bruto["freio_whatsapp"]
        taxa = _num((t or {}).get("taxa")) if _ligada(t) else MAX_FREIO * 100
        minimo = _int((t or {}).get("minimo"), 1) if _ligada(t) else None
        if taxa is None or taxa <= 0:
            av.append(f"{onde}/freio_whatsapp: taxa inválida (vale o padrão)")
        else:
            if taxa / 100 > MAX_FREIO:
                av.append(f"{onde}/freio_whatsapp: taxa máxima de 5% (usado 5%)")
            w = {"limite_taxa_bloqueio": min(taxa / 100, MAX_FREIO)}
            if minimo is not None:
                w["minimo_envios_para_freio"] = minimo
            out["whatsapp"] = w
    return out, av


def janela_com_travas(base: tuple | None, tj: dict | None, dia, feriados) -> tuple | None:
    """Janela do dia depois das travas: dias e feriados somam restrições; o horário da trava vale
    (sempre dentro de 08:00–20:00)."""
    if base is None or not tj:
        return base
    dsem = dia.weekday()
    if dsem not in tj.get("dias_semana", (0, 1, 2, 3, 4, 5)):
        return None
    if tj.get("respeita_feriados", True) and dia.isoformat() in (feriados or ()):
        return None
    j = tj["domingo"] if dsem == 6 else tj["sabado"] if dsem == 5 else tj["seg_sex"]
    return (j[0], j[1])


def limite_restante(lim: dict | None, historico: list | None, hoje) -> int | None:
    """Quantas ações (canais acionados) o cliente ainda pode receber hoje pelo limite da trava.
    historico: [(data, canal)] das ações anteriores a hoje. None = sem limite."""
    if not lim:
        return None
    hist = [d for d, _ in (historico or []) if d < hoje]
    rest = []
    if lim.get("dia"):
        rest.append(lim["dia"])
    if lim.get("semana"):
        rest.append(lim["semana"] - sum(1 for d in hist if (hoje - d).days < 7))
    if lim.get("mes"):
        rest.append(lim["mes"] - sum(1 for d in hist if (hoje - d).days < 30))
    return max(0, min(rest)) if rest else None
