"""Concorrência, pico, CPS por tronco e freio de abandono (decisões 6, 12 e V24 do dono).

  teto da empresa   = min(limite × pico_multiplo, canais dos troncos ativos); limite = a parte da empresa na
                      divisão do contratado (voz_divisao_concorrencia.limite; nulo = canais; 0 = não disca).
                      Chamada acima do limite e dentro do teto sai marcada no_pico (minuto de IA ao dobro).
  teto global       = concorrência contratada (voz_contrato), nunca ultrapassado.
  por tronco        = canais do tronco em voo e CPS (balde de fichas: até `cps` por segundo, rajada de 1 s).
  freio de abandono = abandonos ÷ atendidas por pessoa no lote (mínimo de amostra). Acima de abandono_max_pct, o
                      teto da empresa cai para freio_ritmo_pct % até a taxa voltar abaixo de 80 % do limite.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from voz.banco import ConfigVoz, Tronco

AMOSTRA_MIN_ABANDONO = 20


@dataclass
class Balde:
    taxa: float
    capacidade: float
    fichas: float = 0.0
    t: float | None = None

    def tirar(self, agora: float) -> bool:
        if self.t is None:
            self.t, self.fichas = agora, self.capacidade
        self.fichas = min(self.capacidade, self.fichas + (agora - self.t) * self.taxa)
        self.t = agora
        if self.fichas >= 1:
            self.fichas -= 1
            return True
        return False


@dataclass
class EstadoEmpresa:
    config: ConfigVoz
    canais: int
    em_voo: int = 0
    atendidas_pessoa: int = 0
    abandonos: int = 0
    freado: bool = False
    freado_vezes: int = 0

    @property
    def limite(self) -> int:
        lim = self.config.limite_simultaneas            # 0 = sem parte na divisão do contratado: não disca
        return min(self.canais if lim is None else lim, self.canais)

    @property
    def teto(self) -> int:
        t = min(self.limite * max(1, self.config.pico_multiplo), self.canais)
        if self.freado and t > 0:
            t = max(1, math.floor(t * self.config.freio_ritmo_pct / 100))
        return t

    @property
    def taxa_abandono(self) -> float | None:
        if self.atendidas_pessoa < AMOSTRA_MIN_ABANDONO:
            return None
        return 100.0 * self.abandonos / self.atendidas_pessoa


@dataclass
class Agendador:
    contratado: int
    empresas: dict[int, EstadoEmpresa] = field(default_factory=dict)
    troncos: dict[int, Tronco] = field(default_factory=dict)
    em_voo_tronco: dict[int, int] = field(default_factory=dict)
    baldes: dict[int, Balde] = field(default_factory=dict)
    # rota (tronco) pausada por sem crédito ou bloqueio de originação (SQL 65 › voz_troncos_pausas): não disca até a
    # equipe retomar. tronco_id -> motivo
    pausados: dict[int, str] = field(default_factory=dict)

    def registrar_empresa(self, config: ConfigVoz, troncos: list[Tronco]) -> None:
        ativos = [t for t in troncos if t.ativo]
        self.empresas[config.empresa_id] = EstadoEmpresa(config, canais=sum(t.canais for t in ativos))
        for t in ativos:
            self.troncos[t.id] = t
            self.em_voo_tronco.setdefault(t.id, 0)
            self.baldes.setdefault(t.id, Balde(taxa=t.cps, capacidade=max(1.0, t.cps)))

    def atualizar_empresa(self, config: ConfigVoz, troncos: list[Tronco]) -> None:
        """Limites novos sem perder o que está em voo."""
        e = self.empresas.get(config.empresa_id)
        if e is None:
            self.registrar_empresa(config, troncos)
            return
        ativos = [t for t in troncos if t.ativo]
        e.config, e.canais = config, sum(t.canais for t in ativos)
        for t in ativos:
            velho = self.troncos.get(t.id)
            self.troncos[t.id] = t
            self.em_voo_tronco.setdefault(t.id, 0)
            if velho is None or velho.cps != t.cps:
                self.baldes[t.id] = Balde(taxa=t.cps, capacidade=max(1.0, t.cps))

    @property
    def em_voo_global(self) -> int:
        return sum(e.em_voo for e in self.empresas.values())

    def vaga_empresa(self, empresa_id: int) -> bool:
        e = self.empresas.get(empresa_id)
        return e is not None and e.em_voo < e.teto and self.em_voo_global < self.contratado

    def tronco_livre(self, tronco_id: int, agora_s: float) -> bool:
        """Canal livre E ficha de CPS (consome a ficha: chame só quando for originar)."""
        t = self.troncos.get(tronco_id)
        if t is None or tronco_id in self.pausados or self.em_voo_tronco.get(tronco_id, 0) >= t.canais:
            return False
        return self.baldes[tronco_id].tirar(agora_s)

    def pausar(self, tronco_id: int, motivo: str) -> bool:
        """Pausa a rota na hora (sem crédito / bloqueio). Devolve True se ela ainda não estava pausada."""
        novo = tronco_id not in self.pausados
        self.pausados[tronco_id] = motivo
        return novo

    def aplicar_pausas(self, pausas: dict[int, str], troncos: set[int] | None = None) -> list[int]:
        """As pausas ativas do banco valem (as retomadas pela equipe saem). `troncos` limita aos troncos desta VM.
        Devolve os troncos retomados."""
        alvo = set(self.troncos) if troncos is None else troncos
        retomados = [t for t in self.pausados if t in alvo and t not in pausas]
        for t in retomados:
            self.pausados.pop(t, None)
        for t, m in pausas.items():
            if t in alvo:
                self.pausados[t] = m
        return retomados

    def ocupar(self, empresa_id: int, tronco_id: int) -> bool:
        """Conta a chamada. Devolve no_pico (acima do limite da empresa, dentro do teto)."""
        e = self.empresas[empresa_id]
        no_pico = e.em_voo >= e.limite
        e.em_voo += 1
        self.em_voo_tronco[tronco_id] = self.em_voo_tronco.get(tronco_id, 0) + 1
        return no_pico

    def trocar_tronco(self, de: int, para: int) -> None:
        """Failover: a chamada sai de um tronco e vai para outro (a empresa continua com a mesma vaga)."""
        self.em_voo_tronco[de] = max(0, self.em_voo_tronco.get(de, 0) - 1)
        self.em_voo_tronco[para] = self.em_voo_tronco.get(para, 0) + 1

    def liberar(self, empresa_id: int, tronco_id: int | None) -> None:
        e = self.empresas[empresa_id]
        e.em_voo = max(0, e.em_voo - 1)
        if tronco_id is not None:
            self.em_voo_tronco[tronco_id] = max(0, self.em_voo_tronco.get(tronco_id, 0) - 1)

    def resultado_pessoa(self, empresa_id: int, abandonada: bool) -> str | None:
        """Conta uma chamada atendida por pessoa (e se foi abandonada). Devolve 'freou'/'soltou' quando muda."""
        e = self.empresas[empresa_id]
        e.atendidas_pessoa += 1
        e.abandonos += int(abandonada)
        taxa = e.taxa_abandono
        if taxa is None:
            return None
        if not e.freado and taxa > e.config.abandono_max_pct:
            e.freado, e.freado_vezes = True, e.freado_vezes + 1
            return "freou"
        if e.freado and taxa <= 0.8 * e.config.abandono_max_pct:
            e.freado = False
            return "soltou"
        return None
