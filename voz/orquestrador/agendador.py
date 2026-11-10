"""Concorrência, pico, CPS por tronco e freio de abandono (decisões 6, 12 e V24 do dono).

Dois recursos, dois contadores (decisão do dono: o limite conta CONVERSAS com a IA, não linhas):
  linhas            = canais do cliente no ar (originando, tocando, AMD, conversa, humano na ponte). Limitadas pelos
                      canais de cada tronco e pelo CPS (por tronco, abaixo); a empresa não tem outro limite de linhas.
  conversas         = robôs (sessões do provedor de voz) ocupados + reservados. Limitadas pelo teto da empresa e pelo
                      teto global. A reserva é feita ANTES de originar: com a razão 1,0 (padrão, a única deste PR) cada
                      linha só sai com um robô reservado para ela, então quem atende sempre tem com quem falar. A
                      reserva vira conversa quando a pessoa atende (AMD = pessoa) e volta quando o AMD dá máquina ou a
                      linha acaba sem conversa; a conversa volta quando o agente sai (fim, REFER, humano atendeu).
                      Razão > 1 (Power/Preditivo, PR próprio) origina mais linhas que robôs livres: as linhas a mais
                      saem sem reserva e quem atende nelas sem robô livre é o abandono que o controlador mantém na meta.

  teto da empresa   = min(limite × pico_multiplo, canais dos troncos ativos); limite = a parte da empresa na
                      divisão do contratado (voz_divisao_concorrencia.limite; nulo = canais; 0 = não disca).
                      Conversa acima do limite e dentro do teto sai marcada no_pico (minuto de IA ao dobro): decidido
                      quando a conversa começa, não na originação (linha que só tocou não vira minuto de pico).
  teto global       = concorrência contratada (voz_contrato), nunca ultrapassado (conta conversas + reservas).
  por tronco        = canais do tronco em voo e CPS (balde de fichas: até `cps` por segundo, rajada de 1 s).
  freio de abandono = abandonos ÷ atendidas por pessoa no lote (mínimo de amostra). Acima de abandono_max_pct, o
                      teto da empresa cai para freio_ritmo_pct % até a taxa voltar abaixo de 80 % do limite.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from voz.banco import ConfigVoz, Tronco

AMOSTRA_MIN_ABANDONO = 20
# linhas por robô livre. 1,0 = discagem 1:1 com reserva (o comportamento de sempre). O Power/Preditivo (PR próprio) lê a
# razão de credores.discagem.ritmo; até lá ninguém muda este valor.
RAZAO_PADRAO = 1.0


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
    linhas: int = 0            # canais do cliente no ar (tocando, AMD, conversa ou humano)
    reservas: int = 0          # robôs reservados para linhas que ainda não viraram conversa
    conversas: int = 0         # conversas com a IA (sessão do provedor aberta)
    razao: float = RAZAO_PADRAO
    atendidas_pessoa: int = 0
    abandonos: int = 0
    freado: bool = False
    freado_vezes: int = 0

    @property
    def ocupadas(self) -> int:
        """Robôs da empresa em uso: conversas + reservas (o que o teto e o teto global contam)."""
        return self.conversas + self.reservas

    @property
    def em_voo(self) -> int:
        """Nome antigo de `ocupadas` (antes contava linhas desde a originação)."""
        return self.ocupadas

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
    def ocupadas_global(self) -> int:
        return sum(e.ocupadas for e in self.empresas.values())

    @property
    def em_voo_global(self) -> int:
        """Nome antigo de `ocupadas_global`."""
        return self.ocupadas_global

    def livres_conversa(self, empresa_id: int) -> int:
        """Robôs que a empresa ainda pode reservar agora (teto da empresa e teto global)."""
        e = self.empresas.get(empresa_id)
        if e is None:
            return 0
        return max(0, min(e.teto - e.ocupadas, self.contratado - self.ocupadas_global))

    def vaga_empresa(self, empresa_id: int) -> bool:
        """Pode originar mais uma linha? Linhas sem conversa ≤ razão × (robôs livres + reservados). Com a razão 1,0
        isso é: só origina com um robô livre para reservar (canal e CPS do tronco são conferidos à parte)."""
        e = self.empresas.get(empresa_id)
        if e is None:
            return False
        livres = self.livres_conversa(empresa_id)
        if e.razao <= 1.0:
            return livres > 0
        sem_conversa = max(0, e.linhas - e.conversas)
        return sem_conversa < math.floor(e.razao * (livres + e.reservas))

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
        """Conta a linha (empresa e tronco) e reserva um robô se houver. Devolve se a linha saiu com reserva (com a razão
        1,0 sempre sai: vaga_empresa só deixa originar com robô livre)."""
        e = self.empresas[empresa_id]
        reservada = self.livres_conversa(empresa_id) > 0
        e.linhas += 1
        e.reservas += int(reservada)
        self.em_voo_tronco[tronco_id] = self.em_voo_tronco.get(tronco_id, 0) + 1
        return reservada

    def devolver_reserva(self, empresa_id: int) -> None:
        """A linha não vai conversar (AMD máquina, não atendeu, sem robô no provedor): o robô reservado volta."""
        e = self.empresas[empresa_id]
        e.reservas = max(0, e.reservas - 1)

    def conversar(self, empresa_id: int, reservada: bool) -> bool | None:
        """A pessoa atendeu: a reserva (se houver) vira conversa. Sem reserva, só com robô livre de verdade (nunca tira
        o de quem reservou). Devolve no_pico (já há `limite` conversas: esta passa do limite, dentro do teto; reserva
        não conta, porque linha tocando não gasta minuto de IA) ou None se não há robô."""
        e = self.empresas[empresa_id]
        if reservada:
            e.reservas = max(0, e.reservas - 1)
        elif self.livres_conversa(empresa_id) <= 0:
            return None
        no_pico = e.conversas >= e.limite
        e.conversas += 1
        return no_pico

    def fim_conversa(self, empresa_id: int) -> None:
        """O agente saiu da ligação (fim, REFER ou humano atendeu na ponte): o robô fica livre."""
        e = self.empresas[empresa_id]
        e.conversas = max(0, e.conversas - 1)

    def trocar_tronco(self, de: int, para: int) -> None:
        """Failover: a chamada sai de um tronco e vai para outro (a empresa continua com a mesma vaga)."""
        self.em_voo_tronco[de] = max(0, self.em_voo_tronco.get(de, 0) - 1)
        self.em_voo_tronco[para] = self.em_voo_tronco.get(para, 0) + 1

    def liberar(self, empresa_id: int, tronco_id: int | None) -> None:
        """A linha acabou (canal do cliente destruído ou originação desistida): canal da empresa e do tronco. A reserva
        e a conversa saem por devolver_reserva/fim_conversa (o núcleo sabe em que estado a chamada estava)."""
        e = self.empresas[empresa_id]
        e.linhas = max(0, e.linhas - 1)
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
