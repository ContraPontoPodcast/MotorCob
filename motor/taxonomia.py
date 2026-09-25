"""Taxonomia: traduz o retorno bruto de cada canal para uma escala única.

Todo fornecedor novo entra aqui. A regra de ouro: separar o que prova que o
contato EXISTE, o que prova que ALGUÉM engajou e o que prova que é o CLIENTE.
"""
from dataclasses import dataclass
from enum import IntEnum


class Nivel(IntEnum):
    INVALIDO = -1     # contato morto (hard bounce, número inexistente)
    SEM_RETORNO = 0   # nada se sabe (não atendida, soft bounce)
    ENTREGUE = 1      # o contato existe
    ENGAJADO = 2      # alguém interagiu, mas não prova titularidade
    CERTIFICADO = 3   # prova que é o cliente (CPC, identidade, portal autenticado)


CANAIS_TELEFONE = ("discador", "agente_voz", "sms", "whatsapp", "rcs")
CANAIS_EMAIL = ("email",)
CANAIS = CANAIS_TELEFONE + CANAIS_EMAIL


@dataclass(frozen=True)
class Classificacao:
    nivel: Nivel
    pro_titular: float = 0.0     # peso de evidência a favor de ser do cliente
    contra_titular: float = 0.0  # peso de evidência contra (ex.: terceiro desconhece)
    restricao: str | None = None  # restringe o CANAL para o contato, não o invalida


# Pesos de evidência. Calibrar com dados reais (ver CLAUDE.md).
CERT = 6.0      # certificação forte
TERCEIRO = 4.0  # terceiro atendeu e disse não conhecer
ENGAJ = 0.5     # engajamento: sinal fraco de titularidade

C = Classificacao
TAXONOMIA: dict[str, dict[str, Classificacao]] = {
    "discador": {
        "numero_inexistente": C(Nivel.INVALIDO),
        "nao_atendida": C(Nivel.SEM_RETORNO),
        "caixa_postal": C(Nivel.ENTREGUE),
        "atendida_sem_cpc": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "atendida_terceiro_desconhece": C(Nivel.ENGAJADO, contra_titular=TERCEIRO),
        "cpc": C(Nivel.CERTIFICADO, pro_titular=CERT),
    },
    "sms": {
        "nao_entregue": C(Nivel.INVALIDO),
        "entregue": C(Nivel.ENTREGUE),
        "clique_link": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "resposta": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "opt_out": C(Nivel.ENGAJADO, restricao="sms:opt_out"),
        "acesso_portal_autenticado": C(Nivel.CERTIFICADO, pro_titular=CERT),
    },
    "whatsapp": {
        # sem_conta restringe o canal, NÃO invalida o telefone
        "sem_conta": C(Nivel.SEM_RETORNO, restricao="whatsapp:sem_conta"),
        "entregue": C(Nivel.ENTREGUE),
        "lido": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "resposta": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "bloqueio": C(Nivel.ENGAJADO, contra_titular=1.0, restricao="whatsapp:bloqueio"),
        "desconhece": C(Nivel.ENGAJADO, contra_titular=TERCEIRO, restricao="whatsapp:desconhece"),
        "identidade_confirmada": C(Nivel.CERTIFICADO, pro_titular=CERT),
        "acesso_portal_autenticado": C(Nivel.CERTIFICADO, pro_titular=CERT),
    },
    "rcs": {
        "nao_entregue": C(Nivel.INVALIDO),
        "entregue": C(Nivel.ENTREGUE),
        "lido": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "interacao": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "identidade_confirmada": C(Nivel.CERTIFICADO, pro_titular=CERT),
        "acesso_portal_autenticado": C(Nivel.CERTIFICADO, pro_titular=CERT),
    },
    "email": {
        "hard_bounce": C(Nivel.INVALIDO),
        "soft_bounce": C(Nivel.SEM_RETORNO),
        "entregue": C(Nivel.ENTREGUE),
        "abertura": C(Nivel.ENGAJADO, pro_titular=ENGAJ / 2),  # pixel é pouco confiável
        "clique": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
        "descadastro": C(Nivel.ENGAJADO, restricao="email:opt_out"),
        "acesso_portal_autenticado": C(Nivel.CERTIFICADO, pro_titular=CERT),
    },
}
# Agente de voz (URA inteligente) devolve os mesmos resultados do discador,
# mais a confirmação de identidade feita pelo próprio agente.
TAXONOMIA["agente_voz"] = {
    **TAXONOMIA["discador"],
    "identidade_confirmada": C(Nivel.CERTIFICADO, pro_titular=CERT),
}


class ResultadoDesconhecido(ValueError):
    """Retorno que a taxonomia não conhece: precisa de mapeamento (agente de Ingestão)."""


def classificar(canal: str, resultado: str) -> Classificacao:
    try:
        return TAXONOMIA[canal][resultado]
    except KeyError:
        raise ResultadoDesconhecido(f"{canal}/{resultado}") from None
