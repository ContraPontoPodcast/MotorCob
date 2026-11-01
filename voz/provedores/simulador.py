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

# turnos simulados de cada cenário (texto inventado, sem nome nem número de ninguém): a transcrição da ligação da IA
# (voz/transcricao/ia.py) sai destes turnos, espalhados pelos segundos do cenário
_ABERTURA = [("agente", "Olá, aqui é a central de atendimento da assessoria. Falo com o titular?"),
             ("cliente", "Sim, sou eu.")]
_IDENTIDADE = [("agente", "Para sua segurança, me confirma o dia e o mês do seu nascimento?"),
               ("cliente", "Quinze de março.")]
ROTEIROS = {
    "cpc": _ABERTURA + _IDENTIDADE + [("agente", "Obrigada. Temos um valor em aberto. Como fica melhor para você resolver?"),
                                      ("cliente", "Agora não consigo, vou ver com calma."),
                                      ("agente", "Tudo bem. Obrigada pela atenção.")],
    "promessa": _ABERTURA + _IDENTIDADE + [("agente", "Consigo para você seis parcelas sem juros. Fica bom?"),
                                           ("cliente", "Fica bom, pode mandar o link."),
                                           ("agente", "Combinado. Acabei de mandar o link do pagamento.")],
    "recusa": _ABERTURA + _IDENTIDADE + [("agente", "Consigo para você seis parcelas. Fica bom?"),
                                         ("cliente", "Não quero, a parcela está alta."),
                                         ("agente", "Entendo. Obrigada pela atenção.")],
    "retorno": _ABERTURA + [("cliente", "Agora estou trabalhando, me liga amanhã de manhã."),
                            ("agente", "Combinado, eu ligo amanhã de manhã.")],
    "terceiro": [("agente", "Olá, aqui é a central de atendimento da assessoria. Falo com o titular?"),
                 ("cliente", "Não, não conheço essa pessoa.")],
    "recado": [("agente", "Olá, aqui é a central de atendimento da assessoria. Falo com o titular?"),
               ("cliente", "Ele não está."), ("agente", "Peço que retorne para a assessoria. Obrigada.")],
    "desligou": [("agente", "Olá, aqui é a central de atendimento da assessoria. Falo com o titular?")],
    "opt_out": [("agente", "Olá, aqui é a central de atendimento da assessoria. Falo com o titular?"),
                ("cliente", "Não me liguem mais."), ("agente", "Tudo bem, não vamos mais ligar. Até logo.")],
    "transferir": _ABERTURA + _IDENTIDADE + [("cliente", "Quero falar com um atendente."),
                                             ("agente", "Vou passar você para um atendente agora.")],
}
OFERTA_DO_CENARIO = {"promessa": "6x", "recusa": "6x"}


def turnos_simulados(cenario: str, ate_s: float | None = None) -> list[dict]:
    """Os turnos do cenário, espalhados pelos segundos dele (cortados em ate_s se a pessoa desligou antes)."""
    seg = CENARIOS[cenario][0]
    falas = ROTEIROS.get(cenario) or []
    passo = seg / max(1, len(falas))
    out = []
    for i, (quem, texto) in enumerate(falas):
        ini, fim = round(i * passo, 2), round((i + 1) * passo - 0.3, 2)
        if ate_s is not None and ini >= ate_s:
            break
        out.append({"locutor": quem, "inicio": ini, "fim": max(ini, fim), "texto": texto})
    return out


@dataclass
class Sessao:
    ctx: ContextoChamada
    emitir: Emitir
    cenario: str
    inicio: datetime | None = None
    feito: bool = False
    agora: datetime | None = None


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
        s = self.sessoes.pop(id_chamada, None)
        if s is None:
            return
        # a transcrição simulada (só até onde a conversa foi) vai ao orquestrador, que grava se a ligação é gravada
        ate = (s.agora - s.inicio).total_seconds() if s.inicio and s.agora and not s.feito else None
        turnos = turnos_simulados(s.cenario, ate)
        if turnos:
            s.emitir(id_chamada, "transcricao", {"turnos": turnos, "tempo": "estimado",
                                                 "oferta": OFERTA_DO_CENARIO.get(s.cenario)})

    def tick(self, agora: datetime) -> None:
        for sid, s in list(self.sessoes.items()):
            if s.inicio is None:
                s.inicio = agora
            s.agora = agora
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
