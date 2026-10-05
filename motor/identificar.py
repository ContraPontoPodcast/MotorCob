"""Acha o cliente da carga a partir do que o arquivo da empresa trouxe.

Acordo, pagamento e ocorrência nem sempre usam a mesma chave da carga: um traz o código do
cliente, outro o contrato, outro o CPF; a planilha come zero à esquerda, põe ponto e traço.
Ordem: código exato → contrato → código sem formatação (maiúsculas, só letras/dígitos, sem
zeros à esquerda) → CPF/CNPJ. CPF de mais de um cliente não decide sozinho (ambíguo).
"""
import csv
import re
from pathlib import Path

from . import normalizacao as norm


def _solto(v: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", (v or "").upper()).lstrip("0")


def _doc(v: str) -> str | None:
    d = re.sub(r"\D", "", str(v or ""))
    if len(d) < 11 or len(d) > 14 or set(d) == {"0"}:
        return None
    return d.zfill(11) if len(d) == 11 else d.zfill(14)


class Identificador:
    def __init__(self):
        self.ids: set[str] = set()
        self.contratos: dict[str, str] = {}
        self.soltos: dict[str, str | None] = {}
        self.docs: dict[str, set[str]] = {}

    def incluir(self, idc: str, contrato: str = "", documento: str = ""):
        idc = norm.id_cliente(idc)
        if not idc:
            return
        self.ids.add(idc)
        ct = (contrato or "").strip()
        if ct:
            self.contratos[ct] = idc
            self.soltos.setdefault("c:" + _solto(ct), idc)
        s = _solto(idc)
        if s:
            # dois códigos que viram o mesmo sem formatação: ambíguo, não decide
            self.soltos[s] = idc if self.soltos.get(s, idc) == idc else None
        d = _doc(documento)
        if d:
            self.docs.setdefault(d, set()).add(idc)

    @classmethod
    def da_base(cls, pasta_base: str | Path) -> "Identificador":
        """Da base canônica do credor: clientes.csv (código e contrato) e pessoas.csv (CPF/CNPJ)."""
        ident, pasta = cls(), Path(pasta_base)
        if (pasta / "clientes.csv").exists():
            with open(pasta / "clientes.csv", newline="", encoding="utf-8") as f:
                for linha in csv.DictReader(f, delimiter=";"):
                    ident.incluir(linha["id_cliente"], linha.get("id_contrato") or "")
        if (pasta / "pessoas.csv").exists():
            with open(pasta / "pessoas.csv", newline="", encoding="utf-8") as f:
                for linha in csv.DictReader(f, delimiter=";"):
                    ident.incluir(linha["id_cliente"], documento=linha.get("documento") or "")
        return ident

    def __bool__(self):
        return bool(self.ids)

    def resolver(self, valor: str | None, contrato: str = "") -> tuple[str | None, str]:
        """(id_cliente da carga ou None, como achou: codigo|contrato|formatacao|cpf|ambiguo|nao_encontrado)."""
        v = (valor or "").strip()
        ct = (contrato or "").strip()
        if v in self.ids:
            return v, "codigo"
        for c in (ct, v):
            if c and c in self.contratos:
                return self.contratos[c], "contrato"
        for c in (ct, v):
            if c and (achou := self.soltos.get("c:" + _solto(c))):
                return achou, "contrato"
        if v and (s := _solto(v)) in self.soltos:
            achou = self.soltos[s]
            return (achou, "formatacao") if achou else (None, "ambiguo")
        d = _doc(v)
        if d and d in self.docs:
            donos = self.docs[d]
            return (next(iter(donos)), "cpf") if len(donos) == 1 else (None, "ambiguo")
        return None, "nao_encontrado"
