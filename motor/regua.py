"""Regras do playbook carregadas de `regras/regua.json`, validadas na carga.

Uma regra errada (canal inexistente, resultado fora da taxonomia) derrubaria a
operação inteira em silêncio; por isso a carga falha alto.
"""
import json
from dataclasses import dataclass, field, replace
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
    clusters: tuple = field(default=(), compare=False)   # regras de cluster da empresa (motor/cluster.py)
    versao_clusters: str = ""
    estrategias: dict = field(default_factory=dict, compare=False)  # id -> partes do playbook (estrategia.py)
    estrategia_padrao: int | None = None                           # da empresa, p/ quem não tem estratégia
    persona: object = field(default=None, compare=False)           # ModeloPersona (motor/persona.py)
    canais_cfg: dict = field(default_factory=dict, compare=False)   # canal -> limites da empresa
    _cache: dict = field(default_factory=dict, compare=False, repr=False)

    def com_clusters(self, regras, estrategias: dict | None = None, padrao: int | None = None,
                     canais: dict | None = None) -> "Regua":
        from .cluster import versao
        return replace(self, clusters=tuple(regras), versao_clusters=versao(list(regras)),
                       estrategias=dict(estrategias or {}), estrategia_padrao=padrao,
                       canais_cfg=dict(canais or {}), _cache={})

    def estrategia_de(self, cluster: str) -> int | None:
        r = self._regra(cluster)
        eid = r.estrategia_id if r and r.estrategia_id in self.estrategias else None
        if eid is None and self.estrategia_padrao in self.estrategias:
            eid = self.estrategia_padrao
        return eid

    def para(self, cluster: str) -> "Regua":
        """Regras que valem para um cliente do cluster: playbook + estratégia do cluster."""
        eid = self.estrategia_de(cluster)
        if eid is None:
            return self
        if eid not in self._cache:
            from .estrategia import aplicar
            # a cópia não reaplica estratégia: para() sempre é chamado na régua da empresa
            self._cache[eid] = replace(self, dados=aplicar(self.dados, self.estrategias[eid]), _cache={},
                                       estrategias={}, estrategia_padrao=None)
        return self._cache[eid]

    def canal_cfg(self, canal: str) -> dict:
        return self.canais_cfg.get(canal) or {}

    def _regra(self, codigo: str):
        return next((r for r in self.clusters if r.codigo == codigo), None)

    def __getitem__(self, chave):
        return self.dados[chave]

    def codigo(self, canal: str | None) -> str:
        return self.dados["canais"][canal] if canal else "ND"

    def e_contato(self, canal: str, resultado: str) -> bool:
        return resultado in self.dados["contato"].get(canal, ())

    def cluster(self, saldo: float, dias_atraso: int) -> str:
        """Cluster padrão: ticket (A/M/B) x atraso (1/2/3)."""
        ticket = next(l for l, piso in self.dados["cluster"]["ticket"] if saldo >= piso)
        faixa = [f for f, piso in self.dados["cluster"]["atraso"] if dias_atraso >= piso][-1]
        return ticket + faixa

    def cluster_de(self, cliente, dia: date) -> str:
        """Primeira regra da empresa que bate; sem regra, o cluster padrão."""
        from .cluster import classificar
        r = classificar(list(self.clusters), cliente, dia)
        return r.codigo if r else self.cluster(cliente.saldo, cliente.atraso_em(dia))

    def enriquecimento(self, cluster: str) -> dict:
        r = self._regra(cluster)
        if r:
            return r.enriquecimento()
        # cluster que saiu das regras da empresa: básico até a próxima revisão
        return self.dados["enriquecimento"].get(cluster, {"pacote": "básico", "revalida_dias": 90})

    def canais_bloqueados(self, cluster: str) -> set[str]:
        r = self._regra(cluster)
        if r:
            return r.bloqueados
        return set(CANAIS_VOZ) if self.enriquecimento(cluster).get("so_digital") else set()

    def voz_d0(self, cluster: str) -> bool:
        r = self._regra(cluster)
        return r.voz_d0 if r else cluster[:1] in self.dados["preventivo"]["voz_d0_tickets"]

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
