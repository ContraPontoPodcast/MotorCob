"""Rótulos legíveis do motor (blocos 3 e 5): nenhum código cru (G1, RE, T1, CPA…) na tela; os nomes são os do
glossário aprovado ("O que significa").

Mesmo mapa das funções do banco rotulo_estado, rotulo_ciclo e rotulo_passo (SQL 31); o teste de RLS
confere que os dois dão o mesmo resultado.
"""
import re

ESTADOS = {"LOC": "Cliente novo", "CPA": "CPC · em negociação", "CPB": "CPC · sem resposta", "NCP": "Não CPC",
           "PRE": "Acordo · antes do vencimento", "COL": "Acordo em dia", "QBR": "Acordo · parcela vencida",
           "LIQ": "Quitado", "BLQ": "Bloqueado", "ET": "Etapa própria"}


def rotulo_estado(estado: str | None) -> str | None:
    return ESTADOS.get(estado, estado)


def rotulo_ciclo(estado: str | None, ciclo: str | None) -> str:
    c = ciclo or ""
    if not c:
        return ""
    if c == "RE":
        return "Parado · aguarda enriquecimento"
    if re.fullmatch(r"G\d+", c):
        return f"{c[1:]}º ciclo"
    if re.fullmatch(r"T\d+", c):
        return f"{c[1:]}ª tentativa"
    if c == "L0":
        return "Aguardando a 1ª lista"
    if re.fullmatch(r"L\d+", c):
        return f"D+{c[1:]}"
    if estado == "QBR" and re.fullmatch(r"D\d+", c):
        return f"D+{c[1:]}"
    return c


def rotulo_passo(passo: str | None) -> str:
    p = passo
    if p is None:
        return ""
    m = re.fullmatch(r"[GC](\d+)-(?:dia|D)(\d+)", p)
    if m:
        return f"{m[1]}º ciclo · dia {m[2]}"
    if p == "CPC A · negociação":
        return "CPC · em negociação"
    m = re.fullmatch(r"CPC B · T(\d+)", p)
    if m:
        return f"CPC · sem resposta · {m[1]}ª tentativa"
    if p.startswith("rotação → "):
        return "troca de canal → " + p[len("rotação → "):]
    return p
