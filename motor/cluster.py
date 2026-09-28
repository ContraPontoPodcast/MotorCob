"""Cluster do cliente: regras de cada empresa sobre qualquer coluna da base.

A empresa define no site (tabela `clusters`) uma lista de regras em ordem. Cada regra
tem um código (entra na TAG), condições sobre colunas da base bruta ou campos
calculados, e o que o cluster muda na operação (pacote de enriquecimento, revalidação,
só digital, voz no D0 do preventivo, canais bloqueados). Vale a primeira regra cujas
condições batem todas; quem não bate em nenhuma cai no cluster padrão ticket x atraso
de `regras/regua.json`.

Campos calculados (valem para qualquer empresa):
  saldo          soma dos contratos do cliente
  dias_atraso    atraso no dia da revisão
  qtd_contratos  número de contratos do cliente
As colunas da base bruta são lidas do contrato de maior saldo do cliente.
"""
import csv
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

CAMPOS_CALCULADOS = ("saldo", "dias_atraso", "qtd_contratos")
OPERADORES = ("=", "!=", ">", ">=", "<", "<=", "em", "nao_em", "contem", "vazio", "preenchido")
CANAIS = ("whatsapp", "rcs", "agente_voz", "discador", "sms", "email")
CANAIS_VOZ = ("agente_voz", "discador")
CODIGO = re.compile(r"^[A-Z0-9]{1,4}$")


@dataclass(frozen=True)
class RegraCluster:
    codigo: str
    nome: str
    condicoes: tuple[tuple[str, str, object], ...]   # (campo, operador, valor)
    pacote: str = "básico"
    revalida_dias: int = 90
    so_digital: bool = False
    voz_d0: bool = False
    canais_bloqueados: tuple[str, ...] = ()
    estrategia_id: int | None = None

    @property
    def bloqueados(self) -> set[str]:
        return set(self.canais_bloqueados) | (set(CANAIS_VOZ) if self.so_digital else set())

    def enriquecimento(self) -> dict:
        return {"pacote": self.pacote, "revalida_dias": self.revalida_dias, "so_digital": self.so_digital}


def numero(v) -> float | None:
    """'1.234,56', '1234.56', 'R$ 10' -> float; None se não for número."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v or "").replace("R$", "").replace(" ", "").strip()
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _texto(v) -> str:
    return str(v if v is not None else "").strip().casefold()


def carregar_regras(linhas: list[dict]) -> tuple[list[RegraCluster], list[str]]:
    """Linhas da tabela `clusters` (ativas, em ordem) -> (regras válidas, avisos).

    Regra com erro é ignorada e vira aviso (a rotina não para por causa de um cadastro).
    """
    regras, avisos, vistos = [], [], set()
    for l in sorted(linhas, key=lambda l: (l.get("ordem") or 0, str(l.get("codigo")))):
        cod = str(l.get("codigo") or "").strip().upper()
        if not CODIGO.match(cod):
            avisos.append(f"cluster '{cod}': código precisa ter 1 a 4 letras/números")
            continue
        if cod in vistos:
            avisos.append(f"cluster '{cod}': código repetido, vale só o primeiro")
            continue
        conds, erro = [], None
        for c in l.get("condicoes") or []:
            campo, op, valor = str(c.get("campo") or "").strip(), str(c.get("op") or "").strip(), c.get("valor")
            if not campo or op not in OPERADORES:
                erro = f"condição inválida {c}"
                break
            if op in (">", ">=", "<", "<=") and numero(valor) is None:
                erro = f"'{campo} {op} {valor}': valor precisa ser número"
                break
            if op in ("em", "nao_em"):
                valor = tuple(_texto(v) for v in (valor if isinstance(valor, list) else str(valor or "").split(";"))
                              if _texto(v))
            conds.append((campo, op, valor))
        if erro:
            avisos.append(f"cluster '{cod}' ignorado: {erro}")
            continue
        fora = [c for c in (l.get("canais_bloqueados") or []) if c not in CANAIS]
        if fora:
            avisos.append(f"cluster '{cod}': canais desconhecidos ignorados {fora}")
        vistos.add(cod)
        regras.append(RegraCluster(
            cod, str(l.get("nome") or ""), tuple(conds), str(l.get("pacote") or "básico"),
            int(l.get("revalida_dias") or 90), bool(l.get("so_digital")), bool(l.get("voz_d0")),
            tuple(c for c in (l.get("canais_bloqueados") or []) if c in CANAIS),
            l.get("estrategia_id")))
    return regras, avisos


def versao(regras: list[RegraCluster]) -> str:
    """Muda quando as regras mudam: o motor revisa o cluster de todos na rotina seguinte."""
    if not regras:
        return ""
    return hashlib.sha256(json.dumps([r.__dict__ for r in regras], default=list,
                                     ensure_ascii=False).encode()).hexdigest()[:12]


def valor_do_campo(cliente, dia: date, campo: str):
    if campo == "saldo":
        return cliente.saldo
    if campo == "dias_atraso":
        return cliente.atraso_em(dia)
    if campo == "qtd_contratos":
        return cliente.qtd_contratos
    return (cliente.atributos or {}).get(campo)


def condicao_ok(cliente, dia: date, campo: str, op: str, valor) -> bool:
    v = valor_do_campo(cliente, dia, campo)
    if op == "vazio":
        return _texto(v) == ""
    if op == "preenchido":
        return _texto(v) != ""
    if op in (">", ">=", "<", "<="):
        a, b = numero(v), numero(valor)
        if a is None or b is None:
            return False
        return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]
    if op in ("em", "nao_em"):
        dentro = _texto(v) in valor
        return dentro if op == "em" else not dentro
    if op == "contem":
        return _texto(valor) in _texto(v)
    a, b = numero(v), numero(valor)  # '=' e '!=': compara como número quando os dois são números
    igual = (a == b) if a is not None and b is not None else _texto(v) == _texto(valor)
    return igual if op == "=" else not igual


def classificar(regras: list[RegraCluster], cliente, dia: date) -> RegraCluster | None:
    for r in regras:
        if all(condicao_ok(cliente, dia, *c) for c in r.condicoes):
            return r
    return None


def colunas_usadas(regras: list[RegraCluster]) -> set[str]:
    return {c[0] for r in regras for c in r.condicoes} - set(CAMPOS_CALCULADOS)


# ------------------------------------------------------------------ atributos da base
def carregar_atributos(caminho: str | Path | None) -> dict[str, dict[str, str]]:
    """base/atributos.csv (id_cliente + colunas da base bruta) -> {id_cliente: {coluna: valor}}."""
    if not caminho or not Path(caminho).exists():
        return {}
    with open(caminho, newline="", encoding="utf-8") as f:
        return {l["id_cliente"]: {k: v for k, v in l.items() if k != "id_cliente"}
                for l in csv.DictReader(f, delimiter=";")}


def tipos_das_colunas(linhas: list[dict[str, str]], colunas: list[str]) -> list[dict]:
    """[{nome, tipo}] com tipo 'numero' quando todo valor preenchido é número. Só nomes, nunca valores."""
    saida = []
    for c in colunas:
        vals = [l.get(c) for l in linhas if (l.get(c) or "").strip()]
        saida.append({"nome": c, "tipo": "numero" if vals and all(numero(v) is not None for v in vals) else "texto"})
    return saida
