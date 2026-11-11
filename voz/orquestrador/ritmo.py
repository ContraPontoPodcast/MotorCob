"""Ritmo da discagem por carteira (Power e Preditivo, PREDITIVO.md 3.2–3.3 e Parte 4).

razão = linhas sem conversa por robô livre (o agendador conta; ver agendador.vaga_empresa):
  Power      razão fixa da carteira (credores.discagem › ritmo.razao, 1,0 a 3,0; 1,0 = Progressivo, ninguém atende sem
             robô). Teto de abandono (3 %, fixo) nos últimos 30 min com amostra mínima → Power 1,0 até o fim do dia.
  Preditivo  (V5) razão calculada pela chance de atender. Até o V5 a carteira em Preditivo disca como em aquecimento:
             Power 1,0 (nenhum abandono novo antes de existir o controlador).
A taxa é a da CARTEIRA (abandonos ÷ atendidas por pessoa nos últimos 30 min); a transferência sem operador não entra.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from motor import discagem as DG
from voz.orquestrador.agendador import JanelaTaxa

AMOSTRA_MIN_TETO = 50        # atendidas por pessoa na janela de 30 min para avaliar o abandono (PREDITIVO.md Parte 4)


@dataclass
class RitmoCarteira:
    janela: JanelaTaxa = field(default_factory=JanelaTaxa)
    freado_dia: date | None = None          # bateu no teto: razão 1,0 até o fim deste dia
    freado_em: datetime | None = None

    def razao(self, ritmo: dict, agora: datetime) -> float:
        """A razão que vale agora para a carteira."""
        if self.freado_dia == agora.date():
            return 1.0
        if ritmo.get("modo") == "power":
            return max(1.0, min(3.0, float(ritmo.get("razao") or 1.0)))
        return 1.0                           # Preditivo: aquecimento (o controlador vem no V5)

    def estado(self, ritmo: dict, agora: datetime) -> str:
        """normal | aquecendo | freado (para as telas)."""
        if self.freado_dia == agora.date():
            return "freado"
        return "aquecendo" if ritmo.get("modo") == "preditivo" else "normal"

    def taxa(self) -> float | None:
        return self.janela.taxa(AMOSTRA_MIN_TETO)

    def resultado_pessoa(self, abandono: bool, agora: datetime, ritmo: dict) -> str | None:
        """Conta uma atendida por pessoa da carteira. Devolve 'freou' quando bate no teto (Power acima de 1,0: razão
        1,0 até o fim do dia)."""
        self.janela.contar(agora.timestamp(), abandono)
        taxa = self.taxa()
        if taxa is None or taxa <= DG.TETO_ABANDONO or self.freado_dia == agora.date():
            return None
        if self.razao(ritmo, agora) <= 1.0:
            return None                      # já em 1,0: o abandono restante é de falha do provedor, não do ritmo
        self.freado_dia, self.freado_em = agora.date(), agora
        return "freou"
