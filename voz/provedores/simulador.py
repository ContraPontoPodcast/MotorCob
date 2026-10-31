"""Simulador: provedor de voz sem áudio e sem custo, determinístico, para testar o caminho inteiro (modo
'simulado' do voz_config). O cenário de cada chamada vem de `cenarios` (id_cliente -> cenário) ou, sem isso, do
último dígito do número discado (CENARIO_POR_DIGITO). O tempo é o do orquestrador (tick).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from voz.provedores.base import Conexao, ContextoChamada, Emitir, ProvedorVoz

# cenário -> (segundos de conversa, resultado da IA, extras, transferir?)
CENARIOS = {
    "cpc": (35, "cpc", {"identidade_confirmada": True}, None),
    "promessa": (60, "promessa", {"identidade_confirmada": True, "valor_promessa": 150.0, "dias_promessa": 3}, None),
    "recusa": (40, "recusa", {"identidade_confirmada": True}, None),
    "retorno": (25, "retorno_agendado", {"identidade_confirmada": True, "retorno_horas": 24}, None),
    "terceiro": (15, "atendida_terceiro_desconhece", {}, None),
    "recado": (20, "recado", {}, None),
    "desligou": (4, "atendeu_desligou", {}, None),
    "opt_out": (10, "opt_out", {}, None),
    "transferir": (30, "cpc", {"identidade_confirmada": True}, "cpc"),
}
CENARIO_POR_DIGITO = {"0": "cpc", "1": "promessa", "2": "recusa", "3": "retorno", "4": "terceiro",
                      "5": "recado", "6": "desligou", "7": "opt_out", "8": "transferir", "9": "promessa"}


@dataclass
class Sessao:
    ctx: ContextoChamada
    emitir: Emitir
    cenario: str
    inicio: datetime | None = None
    feito: bool = False


@dataclass
class Simulador(ProvedorVoz):
    max_simultaneas: int = 1000
    cenarios: dict = field(default_factory=dict)       # id_cliente -> cenário
    sessoes: dict = field(default_factory=dict)
    codigo = "simulador"

    def disponivel(self) -> bool:
        return len(self.sessoes) < self.max_simultaneas

    def limites(self) -> dict:
        return {"por_agente": self.max_simultaneas}

    def iniciar(self, ctx: ContextoChamada, emitir: Emitir) -> Conexao:
        cen = self.cenarios.get(ctx.id_cliente) or CENARIO_POR_DIGITO.get(ctx.final_numero[-1:] or "0", "cpc")
        if cen not in CENARIOS:
            raise ValueError(f"cenário desconhecido: {cen}")
        self.sessoes[ctx.id_chamada] = Sessao(ctx, emitir, cen)
        return Conexao("interno")

    def encerrar(self, id_chamada: str) -> None:
        self.sessoes.pop(id_chamada, None)

    def tick(self, agora: datetime) -> None:
        for sid, s in list(self.sessoes.items()):
            if s.inicio is None:
                s.inicio = agora
            seg, res, extras, transf = CENARIOS[s.cenario]
            if s.feito or (agora - s.inicio).total_seconds() < seg:
                continue
            s.feito = True
            dados = {"resultado_ia": res}
            if extras.get("identidade_confirmada"):
                dados["identidade_confirmada"] = True
            if "valor_promessa" in extras:
                dados["valor_promessa"] = extras["valor_promessa"]
                dados["data_promessa"] = (agora + timedelta(days=extras["dias_promessa"])).date()
            if "retorno_horas" in extras:
                dados["retorno_em"] = (agora + timedelta(hours=extras["retorno_horas"])).replace(second=0,
                                                                                                microsecond=0)
            s.emitir(sid, "resultado", dados)
            if transf:
                s.emitir(sid, "transferir", {"motivo": transf})
            else:
                s.emitir(sid, "encerrar", {})
