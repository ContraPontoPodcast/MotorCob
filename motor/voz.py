"""Desfechos de voz (discador e agente virtual): a tabela ÚNICA de onde saem a taxonomia da voz, a marca do
retorno de canal (renitência), o "não atende" do descanso, a regra de chamada curta, os genéricos da
ocorrência e as marcas do site.

Desfecho novo = uma linha aqui (+ migration/opção no site se o cliente puder marcar). Nada nesta tabela é
regra nova: ela reproduz exatamente o que taxonomia.py, discagem.py e entrada.py diziam (teste de paridade em
tests/test_voz.py). Sem imports do motor: os pesos e níveis são nomes, resolvidos em taxonomia.py.

Campos de cada desfecho:
  nivel        nome de taxonomia.Nivel (INVALIDO, SEM_RETORNO, ENTREGUE, ENGAJADO, CERTIFICADO)
  pro, contra  nome do peso de evidência (taxonomia: CERT, ENGAJ, TERCEIRO) ou None
  restricao    restrição do canal (ex.: voz:opt_out) ou None
  ignorar      não diz nada do número (fora da certificação, da nota e do hit rate)
  canais       canais de voz que têm o desfecho
  marca        marca do retorno de canal para a renitência (temporario/inexistente/clique) ou None (fica fora)
  nao_atende   conta no descanso por "não atende"
  curta        "sempre" (não completada) · "abandono" (só com chamadas_curtas.abandono_conta) · None
  generico     resultado genérico da ocorrência da empresa que leva a este desfecho na voz (ou None)
  rotulo       nome que o cliente vê
  e_cpc        é contato (CPC) no padrão do playbook (regua.json › contato; o teste confere)
  conta_tentativa  conta como tentativa da régua e no Responde (hoje TODOS contam; mudar é decisão do dono)
  prova_existencia o número existe (alguém/algo atendeu ou a linha deu sinal): zera confirmações de inexistente
                   (usado pela proteção do inexistente; sem efeito até ela entrar)

Também aqui: os códigos SIP/Q.850 que confirmam (tipo A/B) ou nunca confirmam número inexistente
(de-para do especialista, scratchpad/discador/de_para_sip.md §3.1). São só dados até a ingestão ler as causas.
"""
from dataclasses import dataclass

CANAIS_VOZ = ("discador", "agente_voz")


@dataclass(frozen=True)
class Desfecho:
    chave: str
    nivel: str
    rotulo: str
    pro: str | None = None
    contra: str | None = None
    restricao: str | None = None
    ignorar: bool = False
    canais: tuple = CANAIS_VOZ
    marca: str | None = None
    nao_atende: bool = False
    curta: str | None = None
    generico: str | None = None
    e_cpc: bool = False
    conta_tentativa: bool = True
    prova_existencia: bool = False


D = Desfecho
# A ordem é a da taxonomia (os dicionários derivados saem nesta ordem).
DESFECHOS: tuple[Desfecho, ...] = (
    D("numero_inexistente", "INVALIDO", "Número inexistente", marca="inexistente", curta="sempre",
      generico="invalido"),
    D("nao_atendida", "SEM_RETORNO", "Não atende", marca="temporario", nao_atende=True, curta="sempre",
      generico="sem_contato"),
    D("caixa_postal", "ENTREGUE", "Caixa postal", marca="temporario", nao_atende=True, curta="sempre",
      prova_existencia=True),
    D("atendida_sem_cpc", "ENGAJADO", "Atendida sem CPC", pro="ENGAJ", marca="clique", generico="atendida_sem_cpc",
      prova_existencia=True),
    D("atendida_terceiro_desconhece", "ENGAJADO", "Terceiro / não conhece", contra="TERCEIRO", marca="clique",
      generico="terceiro", prova_existencia=True),
    D("cpc", "CERTIFICADO", "CPC", pro="CERT", marca="clique", generico="cpc", e_cpc=True, prova_existencia=True),
    # promessa e recusa são CPC (promessa NÃO é pagamento); recado é de alguém do círculo do titular
    D("promessa", "CERTIFICADO", "Promessa", pro="CERT", marca="clique", generico="promessa", e_cpc=True,
      prova_existencia=True),
    D("recusa", "CERTIFICADO", "Recusa", pro="CERT", marca="clique", generico="recusa", e_cpc=True,
      prova_existencia=True),
    D("recado", "ENGAJADO", "Recado", pro="ENGAJ", marca="clique", generico="recado", prova_existencia=True),
    # ocupado/abandono não dizem de quem é; falha de rede não penaliza
    D("ocupado", "SEM_RETORNO", "Ocupado", marca="temporario", nao_atende=True, curta="sempre", generico="ocupado",
      prova_existencia=True),
    D("abandonada", "SEM_RETORNO", "Abandonada", marca="clique", curta="abandono", generico="abandonada",
      prova_existencia=True),
    D("falha_rede", "SEM_RETORNO", "Falha de rede", ignorar=True, curta="sempre", generico="falha_rede"),
    # "não ligar" tira o número de todos os canais de voz (certificar_contatos expande voz:opt_out)
    D("opt_out", "ENGAJADO", "Não ligar", restricao="voz:opt_out", generico="opt_out", prova_existencia=True),
    # o agente virtual também confirma a identidade
    D("identidade_confirmada", "CERTIFICADO", "Identidade confirmada", pro="CERT", canais=("agente_voz",),
      marca="clique", e_cpc=True, prova_existencia=True),
)
POR_CHAVE = {d.chave: d for d in DESFECHOS}
assert len(POR_CHAVE) == len(DESFECHOS), "desfecho de voz repetido"


def do_canal(canal: str) -> tuple[Desfecho, ...]:
    """Desfechos de um canal de voz, na ordem da tabela."""
    return tuple(d for d in DESFECHOS if canal in d.canais)


# ------------------------------------------------------------------ derivados
MARCA_VOZ = {d.chave: d.marca for d in DESFECHOS if d.marca}
NAO_COMPLETADA = tuple(d.chave for d in DESFECHOS if d.curta == "sempre")
CURTA_SE_ABANDONO = tuple(d.chave for d in DESFECHOS if d.curta == "abandono")
NAO_ATENDE = tuple(d.chave for d in DESFECHOS if d.nao_atende)
# genérico da ocorrência -> {canal de voz: desfecho}
GENERICOS_VOZ: dict[str, dict[str, str]] = {}
for _d in DESFECHOS:
    if _d.generico:
        GENERICOS_VOZ.setdefault(_d.generico, {}).update({c: _d.chave for c in _d.canais})

PROVA_EXISTENCIA = tuple(d.chave for d in DESFECHOS if d.prova_existencia)


def cpc_padrao(canal: str) -> tuple[str, ...]:
    """Desfechos de voz que são contato (CPC) no padrão do playbook (= regua.json › contato[canal])."""
    return tuple(d.chave for d in do_canal(canal) if d.e_cpc)


# ------------------------------------------------------------------ inexistente: o que confirma (SIP/Q.850)
# Tipo A confirma sempre (fora de lote travado); tipo B só com número canônico (DDD válido + 9º dígito no
# celular). SIP 404 só confirma com Q.850 1 ou sem causa (404 com Q.850 2/3/14/127 é rota).
CONFIRMA_A_SIP = frozenset({404, 410, 604})
CONFIRMA_A_Q850 = frozenset({1, 22})
CONFIRMA_B_SIP = frozenset({301, 484, 485})
CONFIRMA_B_Q850 = frozenset({4, 28})
# suspeita de falha da operadora/rota: NUNCA confirma (vira falha da operadora)
NUNCA_CONFIRMA_Q850 = frozenset({2, 3, 5, 14, 16, 31, 34, 38, 41, 42, 44, 47, 127})
NUNCA_CONFIRMA_SIP = frozenset({300, 302, 305, 380, 400, 401, 402, 403, 405, 406, 407, 408, 413, 414, 415, 416, 420,
                                421, 422, 423, 428, 429, 433, 436, 437, 438, 481, 482, 483, 488, 489, 491, 493, 494,
                                500, 501, 502, 503, 504, 505, 513, 555, 580, 606, 608})
# aparelho (desligado/fora de área): nem confirma nem desfaz
APARELHO_SIP = frozenset({408, 480})
APARELHO_Q850 = frozenset({18, 20, 27, 54})


SIP_GENERICO = frozenset({403, 500, 502, 503})     # o Q.850 que vem junto decide (de-para §PR 2)


def tipo_confirmacao(sip: int | None = None, q850: int | None = None, canonico: bool = True,
                     aceita_tipo_b: bool = True) -> str | None:
    """"A" ou "B" se a causa confirma número inexistente; None se não confirma (técnico, aparelho, outro).
    Causa de rota/aparelho no Q.850 sempre vence (404 + Q.850 3 não confirma); SIP genérico (403/5xx) só
    confirma pelo Q.850. Tipo B exige número canônico. Ainda não é chamada pelo motor (só dados)."""
    if q850 in NUNCA_CONFIRMA_Q850 or q850 in APARELHO_Q850:
        return None
    b_ok = canonico and aceita_tipo_b
    if sip in CONFIRMA_A_SIP:
        return "A" if q850 is None or q850 in CONFIRMA_A_Q850 else None
    if sip is None or sip in SIP_GENERICO:
        if q850 in CONFIRMA_A_Q850:
            return "A"
        return "B" if q850 in CONFIRMA_B_Q850 and b_ok else None
    if sip in CONFIRMA_B_SIP and (q850 is None or q850 in CONFIRMA_A_Q850 | CONFIRMA_B_Q850):
        return "B" if b_ok else None
    return None


# Marcas que o cliente escolhe no site para um código de ocorrência (ocorrencia_codigos.resultado: CHECK do banco,
# SQL 20261017000001; site/src/components/credores/configuracoes.tsx). São genéricos, não desfechos: o desfecho
# fino da voz (promessa, ocupado…) ainda só vem do layout do repositório.
GENERICOS_SITE = ("cpc", "sem_contato", "terceiro", "opt_out")
