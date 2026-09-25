"""Regras do playbook carregadas de `regras/regua.json`, validadas na carga.

Uma regra errada (canal inexistente, resultado fora da taxonomia) derrubaria a
operação inteira em silêncio; por isso a carga falha alto.
"""
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .taxonomia import TAXONOMIA

PADRAO = Path(__file__).resolve().parent.parent / "regras" / "regua.json"
CANAIS_VOZ = ("agente_voz", "discador")
CANAIS_DIGITAIS = ("whatsapp", "rcs", "sms", "email")


class ReguaInvalida(ValueError):
    pass


@dataclass(frozen=True)
class Regua:
    dados: dict

    def __getitem__(self, chave):
        return self.dados[chave]

    def codigo(self, canal: str | None) -> str:
        return self.dados["canais"][canal] if canal else "ND"

    def e_contato(self, canal: str, resultado: str) -> bool:
        return resultado in self.dados["contato"].get(canal, ())

    def cluster(self, saldo: float, dias_atraso: int) -> str:
        ticket = next(l for l, piso in self.dados["cluster"]["ticket"] if saldo >= piso)
        faixa = [f for f, piso in self.dados["cluster"]["atraso"] if dias_atraso >= piso][-1]
        return ticket + faixa

    def enriquecimento(self, cluster: str) -> dict:
        return self.dados["enriquecimento"][cluster]

    def janela(self, dia: date) -> tuple[str, str] | None:
        """Janela de acionamento do dia, ou None (domingo/feriado)."""
        j = self.dados["janela"]
        if dia.isoformat() in j["feriados"] or dia.weekday() == 6:
            return None
        return tuple(j["sabado"] if dia.weekday() == 5 else j["seg_sex"])


def carregar_regua(caminho: str | Path = PADRAO) -> Regua:
    d = json.loads(Path(caminho).read_text(encoding="utf-8"))
    canais = set(d["canais"])
    erros = []
    if canais - set(TAXONOMIA):
        erros.append(f"canais fora da taxonomia: {sorted(canais - set(TAXONOMIA))}")
    for canal, resultados in d["contato"].items():
        fora = [r for r in resultados if r not in TAXONOMIA.get(canal, {})]
        if fora:
            erros.append(f"contato/{canal}: resultados fora da taxonomia {fora}")
    usados = set(d["ordem_rotacao"]) | set(d["reserva"]) | set(d["reserva"].values()) \
        | set(d["substituto"]) | set(d["substituto"].values()) \
        | {c for l in d["acompanha"].values() for c in l} | set(d["acompanha"]) \
        | {d["preventivo"]["voz_d0_canal"]}
    for regua in ("localizacao", "giro", "preventivo", "quebra"):
        usados |= {c for passo in d[regua]["passos"].values() for c in passo}
    if usados - canais:
        erros.append(f"canais usados e não declarados: {sorted(usados - canais)}")
    for t in ("A", "M", "B"):
        for f in ("1", "2", "3"):
            if t + f not in d["enriquecimento"]:
                erros.append(f"enriquecimento sem cluster {t + f}")
    if erros:
        raise ReguaInvalida("; ".join(erros))
    return Regua(d)
