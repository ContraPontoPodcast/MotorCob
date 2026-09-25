"""Certificação de contato, hit rate da carteira e afinidade cliente x canal.

Núcleo determinístico: nenhuma decisão por registro passa por LLM.

Score de titularidade = média de uma Beta(alfa, beta):
- prior: probabilidade base de um contato ser do cliente (por origem do contato);
- evidências a favor/contra somam em alfa/beta, com decaimento exponencial
  (meia-vida de 90 dias).
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from .taxonomia import Nivel, classificar

MEIA_VIDA_DIAS = 90
PRIOR_TITULAR = 0.4       # calibrar por origem: cadastro, enriquecimento, bureau
FORCA_PRIOR = 2.0         # quanto o prior "pesa" em número de evidências
PESO_OUTRO_CPF = 4.0      # contato certificado para OUTRO CPF é evidência contra
EXPIRA_SEM_CONTA_DIAS = 90  # o cliente pode criar conta no WhatsApp depois

LIMIAR_CERTIFICADO = 0.7
LIMIAR_PROVAVEL = 0.6
LIMIAR_CONTESTADO = 0.2


@dataclass(frozen=True)
class Evento:
    cpf: str
    contato: str
    tipo: str          # telefone | email
    canal: str
    resultado: str     # já no vocabulário da taxonomia
    data: date
    custo: float = 0.0
    fornecedor: str | None = None
    id_externo: str | None = None  # id do retorno no fornecedor, para deduplicar


@dataclass
class Certificacao:
    cpf: str
    contato: str
    tipo: str
    status: str = "DESCONHECIDO"
    score: float = PRIOR_TITULAR
    tentativas: int = 0
    restricoes: set[str] = field(default_factory=set)
    ultimo_evento: date | None = None


def decaimento(data: date, hoje: date) -> float:
    return 0.5 ** (max((hoje - data).days, 0) / MEIA_VIDA_DIAS)


def deduplicar(eventos: list[Evento]) -> list[Evento]:
    """Remove retornos importados mais de uma vez (mesmo fornecedor + id_externo).

    Sem isso, reimportar um arquivo infla a evidência e certifica o contato errado.
    """
    vistos, saida = set(), []
    for e in eventos:
        if e.fornecedor and e.id_externo:
            chave = (e.fornecedor, e.id_externo)
            if chave in vistos:
                continue
            vistos.add(chave)
        saida.append(e)
    return saida


def certificar_contatos(eventos: list[Evento], hoje: date,
                        contatos: list[dict] | None = None) -> dict[tuple[str, str], Certificacao]:
    """Retorna {(cpf, contato): Certificacao}.

    `contatos` (opcional) inclui contatos sem nenhum evento, que saem como DESCONHECIDO
    com o score do prior — é o caso do cliente novo (cold start).
    """
    certs: dict[tuple[str, str], Certificacao] = {}
    alfa: dict[tuple[str, str], float] = defaultdict(lambda: PRIOR_TITULAR * FORCA_PRIOR)
    beta: dict[tuple[str, str], float] = defaultdict(lambda: (1 - PRIOR_TITULAR) * FORCA_PRIOR)
    peso_cert: dict[tuple[str, str], float] = defaultdict(float)
    ult_invalido: dict[tuple[str, str], date] = {}
    ult_cert: dict[tuple[str, str], date] = {}
    restricoes: dict[tuple[str, str], dict[str, date]] = defaultdict(dict)

    for c in contatos or []:
        k = (c["cpf"], c["contato"])
        certs[k] = Certificacao(c["cpf"], c["contato"], c["tipo"])

    for e in deduplicar(eventos):
        k = (e.cpf, e.contato)
        cert = certs.setdefault(k, Certificacao(e.cpf, e.contato, e.tipo))
        cl = classificar(e.canal, e.resultado)
        d = decaimento(e.data, hoje)
        cert.tentativas += 1
        cert.ultimo_evento = max(cert.ultimo_evento or e.data, e.data)
        alfa[k] += cl.pro_titular * d
        beta[k] += cl.contra_titular * d
        if cl.nivel == Nivel.CERTIFICADO:
            peso_cert[k] += cl.pro_titular * d
            ult_cert[k] = max(ult_cert.get(k, e.data), e.data)
        elif cl.nivel == Nivel.INVALIDO:
            ult_invalido[k] = max(ult_invalido.get(k, e.data), e.data)
        if cl.restricao:
            restricoes[k][cl.restricao] = max(restricoes[k].get(cl.restricao, e.data), e.data)

    # Um contato certificado para um CPF é evidência contra os outros CPFs que o têm.
    dono_certificado = defaultdict(set)
    for (cpf, contato), p in peso_cert.items():
        if p > 0:
            dono_certificado[contato].add(cpf)
    for (cpf, contato) in certs:
        if dono_certificado[contato] - {cpf}:
            beta[(cpf, contato)] += PESO_OUTRO_CPF

    for k, cert in certs.items():
        cert.restricoes = {
            r for r, dt in restricoes[k].items()
            if r != "whatsapp:sem_conta" or (hoje - dt).days <= EXPIRA_SEM_CONTA_DIAS
        }
        cert.score = round(alfa[k] / (alfa[k] + beta[k]), 3)
        if k in ult_invalido and (k not in ult_cert or ult_invalido[k] > ult_cert[k]):
            cert.status, cert.score = "INVALIDO", 0.0
        elif k in ult_cert and cert.score >= LIMIAR_CERTIFICADO:
            cert.status = "CERTIFICADO"
        elif cert.tentativas == 0 and not dono_certificado[k[1]] - {k[0]}:
            cert.status = "DESCONHECIDO"
        elif cert.score >= LIMIAR_PROVAVEL:
            cert.status = "PROVAVEL"
        elif cert.score < LIMIAR_CONTESTADO:
            cert.status = "CONTESTADO"
        else:
            cert.status = "NAO_CONFIRMADO"
    return certs


def hit_rate_por_canal(eventos: list[Evento]) -> dict[str, dict]:
    """Força de contato da carteira: tentativas x contato efetivo, por canal."""
    agg = defaultdict(lambda: {"tentativas": 0, "engajados": 0, "certificados": 0, "custo": 0.0})
    for e in deduplicar(eventos):
        cl = classificar(e.canal, e.resultado)
        a = agg[e.canal]
        a["tentativas"] += 1
        a["custo"] += e.custo
        a["engajados"] += cl.nivel >= Nivel.ENGAJADO
        a["certificados"] += cl.nivel == Nivel.CERTIFICADO
    saida = {}
    for canal, a in agg.items():
        t = a["tentativas"]
        saida[canal] = {
            **a,
            "custo": round(a["custo"], 2),
            "hit_rate": round(a["engajados"] / t, 4),
            "taxa_certificacao": round(a["certificados"] / t, 4),
            "custo_por_engajado": round(a["custo"] / a["engajados"], 2) if a["engajados"] else None,
            "custo_por_certificacao": round(a["custo"] / a["certificados"], 2) if a["certificados"] else None,
        }
    return saida


class Afinidade:
    """Probabilidades por cliente x canal, com a carteira como prior (cold start).

    - prob(cpf, canal):     P(alguém engaja) — alimenta o funil de contato.
    - prob_cpc(cpf, canal): P(certifica | o contato É do cliente) — o que vale dinheiro.
      Estimada na carteira a partir dos contatos já CERTIFICADOS (titularidade
      conhecida) e ajustada pelo quanto este cliente engaja no canal vs. a média.
    """

    FORCA = 5.0
    TETO = 0.95

    def __init__(self, eventos: list[Evento], hit_rate: dict[str, dict],
                 certs: dict[tuple[str, str], "Certificacao"] | None = None):
        eventos = deduplicar(eventos)
        self.base = {c: r["hit_rate"] for c, r in hit_rate.items()}
        self.obs = defaultdict(lambda: [0, 0])  # (cpf, canal) -> [engajou, tentativas]
        titulares = {k for k, c in (certs or {}).items() if c.status == "CERTIFICADO"}
        cert_tit = defaultdict(lambda: [0, 0])  # canal -> [certificou, tentativas] em contato titular
        # Viés de seleção: o contato só é "titular conhecido" PORQUE certificou.
        # Descarta a 1ª certificação de cada um, que foi o evento que o selecionou.
        selecao = {}
        for e in sorted(eventos, key=lambda e: e.data):
            k = (e.cpf, e.contato)
            if k in titulares and k not in selecao and classificar(e.canal, e.resultado).nivel == Nivel.CERTIFICADO:
                selecao[k] = e
        for e in eventos:
            cl = classificar(e.canal, e.resultado)
            if (e.cpf, e.contato) in titulares and selecao.get((e.cpf, e.contato)) is not e:
                ct = cert_tit[e.canal]
                ct[0] += cl.nivel == Nivel.CERTIFICADO
                ct[1] += 1
            # Terceiro, contato inválido ou sem conta no app dizem algo sobre o
            # CONTATO, não sobre a preferência de canal do cliente.
            if cl.contra_titular > 0 or cl.nivel == Nivel.INVALIDO or cl.restricao == "whatsapp:sem_conta":
                continue
            o = self.obs[(e.cpf, e.canal)]
            o[0] += cl.nivel >= Nivel.ENGAJADO
            o[1] += 1
        self.cert_titular = {}
        for canal, r in hit_rate.items():
            k, n = cert_tit.get(canal, (0, 0))
            # prior fraco: taxa de certificação bruta da carteira
            self.cert_titular[canal] = (k + r["taxa_certificacao"] * self.FORCA) / (n + self.FORCA)

    def prob(self, cpf: str, canal: str) -> float:
        base = self.base.get(canal, 0.0)
        k, n = self.obs.get((cpf, canal), (0, 0))
        return (k + base * self.FORCA) / (n + self.FORCA)

    def prob_cpc(self, cpf: str, canal: str) -> float:
        base = self.base.get(canal, 0.0)
        lift = self.prob(cpf, canal) / base if base else 1.0
        return min(self.TETO, self.cert_titular.get(canal, 0.0) * lift)


def afinidade_canal(eventos: list[Evento], hit_rate: dict[str, dict],
                    certs: dict[tuple[str, str], Certificacao] | None = None) -> Afinidade:
    return Afinidade(eventos, hit_rate, certs)
