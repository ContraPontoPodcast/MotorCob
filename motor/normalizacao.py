"""Normalização de ID do cliente, CPF, telefone e e-mail vindos de arquivos.

Cada fornecedor formata de um jeito ("(11) 99999-0000", "+5511999990000",
"000.000.000-00"). O motor só enxerga a forma canônica, senão o mesmo contato
vira dois e a evidência se divide.
"""
import hashlib
import re

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def id_cliente(valor: str) -> str | None:
    """ID do cliente no sistema de cobrança: identificador opaco, só sem espaços nas pontas."""
    v = (valor or "").strip()
    return v if 0 < len(v) <= 64 else None


def chave_pessoa(cpf_valido: str) -> str:
    """Chave pseudônima para agrupar IDs da mesma pessoa sem levar o CPF adiante.

    Não é anonimização (CPF tem poucas combinações): só evita que o CPF circule
    pelo motor. Nunca gravar esta chave em saída.
    """
    return "p_" + hashlib.sha256(cpf_valido.encode()).hexdigest()[:16]


def _digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _dv_cpf(base: str) -> str:
    for n in (9, 10):
        soma = sum(int(d) * p for d, p in zip(base, range(n + 1, 1, -1)))
        base += str((soma * 10 % 11) % 10)
    return base[-2:]


def cpf(valor: str) -> str | None:
    """CPF com 11 dígitos e dígitos verificadores válidos, ou None."""
    d = _digitos(valor)
    if not d or len(d) > 11:
        return None
    d = d.zfill(11)
    if len(set(d)) == 1 or _dv_cpf(d[:9]) != d[9:]:
        return None
    return d


def gerar_cpf(base9: int) -> str:
    """CPF fictício com dígitos verificadores válidos (para simulação e testes)."""
    b = f"{base9:09d}"
    return b + _dv_cpf(b)


def telefone(valor: str) -> str | None:
    """DDD + número (10 ou 11 dígitos), sem DDI, ou None."""
    d = _digitos(valor)
    if d.startswith("55") and len(d) in (12, 13):
        d = d[2:]
    d = d.lstrip("0")
    if len(d) not in (10, 11) or d[:2] < "11":
        return None
    return d


def email(valor: str) -> str | None:
    e = (valor or "").strip().lower()
    return e if _EMAIL.match(e) else None


def contato(valor: str, tipo: str) -> str | None:
    return telefone(valor) if tipo == "telefone" else email(valor)
