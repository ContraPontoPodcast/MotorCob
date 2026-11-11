"""Ritmo da discagem por carteira (Power e Preditivo, PREDITIVO.md 3.2–3.3 e Parte 4).

razão = linhas sem conversa por robô livre (o agendador conta; ver agendador.vaga_empresa):
  Power      razão fixa da carteira (credores.discagem › ritmo.razao, 1,0 a 3,0; 1,0 = Progressivo, ninguém atende sem
             robô). Teto de abandono (3 %, fixo) nos últimos 30 min com amostra mínima → Power 1,0 até o fim do dia.
  Preditivo  razão = fator ÷ p, de 1,0 até a razão máxima (a da carteira; 2,0 na primeira semana da carteira no
             Preditivo), onde
               p      = chance de "atendida por pessoa" por ligação discada, por janela de 30 min do dia, com
                        encolhimento: (pessoas + k × p_base) ÷ (discadas + k), k = 200. p_base = a janela anterior do dia
                        (com 30+ atendidas, encolhida) ou a carteira nos últimos 7 dias (sem histórico: a empresa; sem
                        nada: 0,12). O PREDITIVO.md fala em "p da janela anterior × 0,8"; aqui fica sem o × 0,8, porque
                        p menor faz discar MAIS (o lado arriscado). Decisão registrada no PR do V5.
               fator  = a margem do controlador do abandono: começa em 0,8, faixa 0,3–1,0, revista a cada 5 min com
                        50+ atendidas por pessoa nos últimos 30 min: acima do teto → × 0,5 na hora (estado freado; 10 min
                        acima do teto → Power 1,0 até o fim do dia); acima da meta → −0,10; abaixo de meta ÷ 2 → +0,05.
             Aquecimento: Power 1,0 enquanto a carteira não tiver 200 atendidas por pessoa nos últimos 7 dias (estado
             aquecendo) e razão até 1,5 nos primeiros 15 min do lote.
             A previsão de robôs que vão liberar nos próximos T segundos (T = toque médio até atender + AMD; conversa
             média medida) entra como robôs livres (Orquestrador._liberando).
A taxa é a da CARTEIRA (abandonos ÷ atendidas por pessoa nos últimos 30 min); a transferência sem operador não entra.
Os freios de curtas (curtas.py) vêm por cima dos dois modos.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from motor import discagem as DG
from voz.orquestrador.agendador import JanelaTaxa

AMOSTRA_MIN_TETO = 50        # atendidas por pessoa na janela de 30 min para avaliar o abandono (PREDITIVO.md Parte 4)
K_ENCOLHIMENTO = 200
P_SEM_HISTORICO = 0.12
AMOSTRA_MIN_JANELA = 30      # atendidas por pessoa para a janela de 30 min do dia valer como base da seguinte
AQUECIMENTO_ATENDIDAS = 200  # atendidas por pessoa da carteira nos últimos 7 dias para sair do aquecimento
INICIO_LOTE = timedelta(minutes=15)
RAZAO_INICIO_LOTE = 1.5
FATOR_INICIAL, FATOR_MIN, FATOR_MAX = 0.8, 0.3, 1.0
REVISAO_S = 300              # o controlador revê o fator a cada 5 min
TETO_PERSISTENTE = timedelta(minutes=10)
CONVERSA_INICIAL_S, TOQUE_INICIAL_S, AMD_S = 90.0, 15.0, 2.0


def _janela30(agora: datetime) -> datetime:
    return agora.replace(minute=agora.minute - agora.minute % 30, second=0, microsecond=0)


@dataclass
class Historico:
    """O que o banco sabe da carteira (historico_ritmo_voz, SQL 110)."""
    discadas_7d: int = 0
    atendidas_7d: int = 0
    dias_preditivo: int = 0          # há quantos dias a carteira disca em Preditivo (0 = começa hoje)
    p_empresa: float | None = None

    @property
    def p_carteira(self) -> float | None:
        return self.atendidas_7d / self.discadas_7d if self.discadas_7d >= 100 else None


@dataclass
class RitmoCarteira:
    janela: JanelaTaxa = field(default_factory=JanelaTaxa)
    freado_dia: date | None = None          # bateu no teto: razão 1,0 até o fim deste dia
    freado_em: datetime | None = None
    historico: Historico = field(default_factory=Historico)
    inicio: datetime | None = None          # quando o lote começou a discar (os primeiros 15 min)
    janelas: dict = field(default_factory=dict)   # início da janela de 30 min -> [discadas, pessoas]
    pessoas_hoje: int = 0
    fator: float = FATOR_INICIAL
    revisto_em: datetime | None = None
    acima_desde: datetime | None = None     # desde quando o abandono está acima do teto (Preditivo)
    freio_fator: bool = False               # o fator foi cortado pelo teto (estado freado, até voltar)
    conversa_s: float = CONVERSA_INICIAL_S  # média móvel da conversa (robô ocupado)
    toque_s: float = TOQUE_INICIAL_S        # média móvel do toque até atender

    # ---------------------------------------------------------------- medições
    def comecou(self, agora: datetime) -> None:
        if self.inicio is None:
            self.inicio = agora

    def discou(self, agora: datetime, pessoa: bool, toque_s: int | None = None, conversa_s: int | None = None) -> None:
        """Uma tentativa encerrada da carteira (para o p por janela de 30 min e as médias de toque e conversa)."""
        self.comecou(agora)
        j = self.janelas.setdefault(_janela30(agora), [0, 0])
        j[0] += 1
        j[1] += int(pessoa)
        self.pessoas_hoje += int(pessoa)
        if toque_s is not None and pessoa:
            self.toque_s += 0.05 * (max(0, toque_s) - self.toque_s)
        if conversa_s is not None and pessoa and conversa_s > 0:
            self.conversa_s += 0.05 * (conversa_s - self.conversa_s)

    def p(self, agora: datetime) -> float:
        """Chance de atendida por pessoa por ligação discada agora (com encolhimento)."""
        base = self.historico.p_carteira or self.historico.p_empresa or P_SEM_HISTORICO
        atual = _janela30(agora)
        anteriores = sorted((k for k, v in self.janelas.items() if k < atual and v[1] >= AMOSTRA_MIN_JANELA),
                            reverse=True)
        if anteriores:                       # a janela anterior do dia (encolhida) é a base da nova
            d, ps = self.janelas[anteriores[0]]
            base = (ps + K_ENCOLHIMENTO * base) / (d + K_ENCOLHIMENTO)
        d, ps = self.janelas.get(atual, [0, 0])
        return min(0.95, max(0.01, (ps + K_ENCOLHIMENTO * base) / (d + K_ENCOLHIMENTO)))

    @property
    def T(self) -> float:
        """Segundos entre originar e precisar do robô: toque médio até atender + AMD."""
        return self.toque_s + AMD_S

    def aquecendo(self) -> bool:
        return self.historico.atendidas_7d + self.pessoas_hoje < AQUECIMENTO_ATENDIDAS

    def razao_max(self, ritmo: dict) -> float:
        m = max(1.0, min(3.0, float(ritmo.get("razao_max") or 3.0)))
        return min(m, DG.RAZAO_MAX_1A_SEMANA) if self.historico.dias_preditivo < 7 else m

    # ---------------------------------------------------------------- decisões
    def preditivo_ativo(self, ritmo: dict, agora: datetime) -> bool:
        return ritmo.get("modo") == "preditivo" and self.freado_dia != agora.date() and not self.aquecendo()

    def razao(self, ritmo: dict, agora: datetime) -> float:
        """A razão que vale agora para a carteira."""
        if self.freado_dia == agora.date():
            return 1.0
        if ritmo.get("modo") == "power":
            return max(1.0, min(3.0, float(ritmo.get("razao") or 1.0)))
        if self.aquecendo():
            return 1.0
        r = min(self.razao_max(ritmo), max(1.0, self.fator / self.p(agora)))
        if self.inicio is None or agora - self.inicio < INICIO_LOTE:
            r = min(r, RAZAO_INICIO_LOTE)
        return r

    def estado(self, ritmo: dict, agora: datetime) -> str:
        """normal | aquecendo | freado (para as telas; as curtas vêm por cima)."""
        if self.freado_dia == agora.date() or (ritmo.get("modo") == "preditivo" and self.freio_fator):
            return "freado"
        return "aquecendo" if ritmo.get("modo") == "preditivo" and self.aquecendo() else "normal"

    def taxa(self) -> float | None:
        return self.janela.taxa(AMOSTRA_MIN_TETO)

    def resultado_pessoa(self, abandono: bool, agora: datetime, ritmo: dict) -> str | None:
        """Conta uma atendida por pessoa da carteira. Power: 'freou' ao bater no teto (1,0 até o fim do dia).
        Preditivo: o controlador (rever)."""
        self.janela.contar(agora.timestamp(), abandono)
        if ritmo.get("modo") == "preditivo":
            return self.rever(agora, ritmo)
        taxa = self.taxa()
        if taxa is None or taxa <= DG.TETO_ABANDONO or self.freado_dia == agora.date():
            return None
        if self.razao(ritmo, agora) <= 1.0:
            return None                      # já em 1,0: o abandono restante é de falha do provedor, não do ritmo
        self.freado_dia, self.freado_em = agora.date(), agora
        return "freou"

    def rever(self, agora: datetime, ritmo: dict) -> str | None:
        """O controlador do Preditivo (no máximo a cada 5 min; o teto age na hora). Devolve 'freou' (fator cortado
        pelo teto), 'power' (10 min acima do teto: 1,0 até o fim do dia) ou None."""
        if self.freado_dia == agora.date() or ritmo.get("modo") != "preditivo":
            return None
        self.janela.podar(agora.timestamp())
        taxa = self.taxa()
        teto = DG.TETO_ABANDONO
        meta = min(teto, float(ritmo.get("meta_abandono") or 1.0))
        if taxa is not None and taxa > teto:
            if self.acima_desde is None:
                self.acima_desde = agora
            if agora - self.acima_desde >= TETO_PERSISTENTE:
                self.freado_dia, self.freado_em = agora.date(), agora
                return "power"
            if not self.freio_fator:
                self.fator = max(FATOR_MIN, self.fator * 0.5)
                self.freio_fator, self.revisto_em = True, agora
                return "freou"
            return None
        self.acima_desde = None
        if self.revisto_em is not None and (agora - self.revisto_em).total_seconds() < REVISAO_S:
            return None
        self.revisto_em = agora
        if taxa is None:
            return None
        self.freio_fator = False
        if taxa > meta:
            self.fator = max(FATOR_MIN, self.fator - 0.10)
        elif taxa < meta / 2:
            self.fator = min(FATOR_MAX, self.fator + 0.05)
        return None
