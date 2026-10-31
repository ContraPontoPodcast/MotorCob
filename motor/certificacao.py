"""Certificação de contato, hit rate da carteira e afinidade cliente x canal.

Núcleo determinístico: nenhuma decisão por registro passa por LLM.

Score de titularidade = média de uma Beta(alfa, beta):
- prior: probabilidade base de um contato ser do cliente (por origem do contato);
- evidências a favor/contra somam em alfa/beta, com decaimento exponencial
  (meia-vida de 90 dias).
"""
import gc
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, time

from .taxonomia import EXPANDE_RESTRICAO, TAXONOMIA, Nivel, classificar

MEIA_VIDA_DIAS = 90
PRIOR_TITULAR = 0.4       # calibrar por origem: cadastro, enriquecimento, bureau
FORCA_PRIOR = 2.0         # quanto o prior "pesa" em número de evidências
PESO_OUTRA_PESSOA = 4.0    # contato certificado para OUTRA pessoa é evidência contra
PESO_MESMA_PESSOA = 4.0    # certificado em outro ID da MESMA pessoa é evidência a favor
EXPIRA_SEM_CONTA_DIAS = 90  # o cliente pode criar conta no WhatsApp depois

LIMIAR_CERTIFICADO = 0.7
LIMIAR_PROVAVEL = 0.6
LIMIAR_CONTESTADO = 0.2


@dataclass(frozen=True)
class Evento:
    id_cliente: str
    contato: str
    tipo: str          # telefone | email
    canal: str
    resultado: str     # já no vocabulário da taxonomia
    data: date
    custo: float = 0.0
    fornecedor: str | None = None
    id_externo: str | None = None  # id do retorno no fornecedor, para deduplicar
    candidatos: tuple = ()         # contato vazio: os contatos que foram na ação (descoberta do Hot)
    origem: str = ""               # arquivo de onde veio (ocorrência que chegou depois do dia fechado)
    hora: time | None = None       # hora da chamada/envio, quando o layout traz (discagem)
    duracao_s: int | None = None   # duração da chamada em segundos (chamadas curtas, MP 1.396/2026)
    data_promessa: date | None = None   # promessa de pagamento: data prometida (suspende a voz até + 1)
    # voz (de-para da rede, decisões do dono de 31/10/2026): a rede, o evento da IA e o do operador ficam separados;
    # `resultado` é o desfecho final (voz.classificar_chamada). Tudo opcional: layout antigo não muda nada.
    causa_sip: int | None = None          # rede: SIP final
    causa_q850: int | None = None         # rede: Q.850 / HANGUPCAUSE
    resultado_ia: str | None = None       # evento do agente de IA (desfecho de voz)
    resultado_operador: str | None = None  # tabulação do operador (discador do cliente, depois da transferência)
    transferencia: str | None = None      # atendida | sem_operador | falhou
    destino: str | None = None            # ia | ia_humano
    origem_resultado: str | None = None   # quem decidiu o desfecho: operador | transferencia | ia | rede
    identidade_confirmada: bool | None = None   # a IA verificou a identidade nesta chamada
    rota: str | None = None               # rota/tronco (trava de lote por rota)
    id_chamada: str | None = None         # id da tentativa (um registro por canal por tentativa)
    peso_pro: float | None = None         # multiplicador da evidência a favor (CPC da IA sem identidade: 0,5)
    # evento pós-atendimento (IA ou operador): o que move o processo (etapas, renitência, próxima ação)
    valor_promessa: float | None = None   # valor prometido (R$)
    retorno_em: datetime | None = None    # retorno agendado: data e hora pedidas (Brasília)


@dataclass
class Certificacao:
    id_cliente: str
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


def certificar_contatos(eventos: list[Evento], hoje: date, contatos: list[dict] | None = None,
                        pessoa_de: dict[str, str] | None = None) -> dict[tuple[str, str], Certificacao]:
    """Retorna {(id_cliente, contato): Certificacao}.

    `contatos` (opcional) inclui contatos sem nenhum evento, que saem como DESCONHECIDO
    com o score do prior — é o caso do cliente novo (cold start).

    `pessoa_de` (opcional) agrupa IDs da mesma pessoa (id_cliente -> chave da pessoa,
    ex.: vinda do CPF da carteira). Sem ele, cada ID é uma pessoa.
    """
    pessoa_de = pessoa_de or {}

    def pessoa(id_cliente: str) -> str:
        return pessoa_de.get(id_cliente, id_cliente)

    certs: dict[tuple[str, str], Certificacao] = {}
    alfa: dict[tuple[str, str], float] = defaultdict(lambda: PRIOR_TITULAR * FORCA_PRIOR)
    beta: dict[tuple[str, str], float] = defaultdict(lambda: (1 - PRIOR_TITULAR) * FORCA_PRIOR)
    peso_cert: dict[tuple[str, str], float] = defaultdict(float)
    ult_invalido: dict[tuple[str, str], date] = {}
    ult_cert: dict[tuple[str, str], date] = {}
    restricoes: dict[tuple[str, str], dict[str, date]] = defaultdict(dict)

    for c in contatos or []:
        k = (c["id_cliente"], c["contato"])
        certs[k] = Certificacao(c["id_cliente"], c["contato"], c["tipo"])

    for e in deduplicar(eventos):
        if not e.contato:  # ocorrência sem contato identificado: vale para a TAG, não certifica número
            continue
        k = (e.id_cliente, e.contato)
        cert = certs.setdefault(k, Certificacao(e.id_cliente, e.contato, e.tipo))
        cl = classificar(e.canal, e.resultado)
        if cl.ignorar:              # falha de rede: não diz nada do número
            continue
        d = decaimento(e.data, hoje)
        cert.tentativas += 1
        cert.ultimo_evento = max(cert.ultimo_evento or e.data, e.data)
        pro = cl.pro_titular * d * (1.0 if e.peso_pro is None else e.peso_pro)
        alfa[k] += pro
        beta[k] += cl.contra_titular * d
        if cl.nivel == Nivel.CERTIFICADO:
            peso_cert[k] += pro
            ult_cert[k] = max(ult_cert.get(k, e.data), e.data)
        elif cl.nivel == Nivel.INVALIDO:
            ult_invalido[k] = max(ult_invalido.get(k, e.data), e.data)
        for r in EXPANDE_RESTRICAO.get(cl.restricao, (cl.restricao,)) if cl.restricao else ():
            restricoes[k][r] = max(restricoes[k].get(r, e.data), e.data)

    # Contato certificado para uma pessoa é evidência contra as OUTRAS pessoas que o têm
    # e a favor dos outros IDs da MESMA pessoa.
    donos = defaultdict(set)  # contato -> IDs em que foi certificado
    for (id_cliente, contato), p in peso_cert.items():
        if p > 0:
            donos[contato].add(id_cliente)
    evidencia_cruzada = set()
    for (id_cliente, contato) in certs:
        outros = donos[contato] - {id_cliente}
        if not outros:
            continue
        evidencia_cruzada.add((id_cliente, contato))
        if {pessoa(x) for x in outros} - {pessoa(id_cliente)}:
            beta[(id_cliente, contato)] += PESO_OUTRA_PESSOA
        else:
            alfa[(id_cliente, contato)] += PESO_MESMA_PESSOA

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
        elif cert.tentativas == 0 and k not in evidencia_cruzada:
            cert.status = "DESCONHECIDO"
        elif cert.score >= LIMIAR_PROVAVEL:
            cert.status = "PROVAVEL"
        elif cert.score < LIMIAR_CONTESTADO:
            cert.status = "CONTESTADO"
        else:
            cert.status = "NAO_CONFIRMADO"
    return certs


def hit_rate_por_canal(eventos: list[Evento], deduplicado: bool = False) -> dict[str, dict]:
    """Força de contato da carteira: tentativas x contato efetivo, por canal."""
    agg = defaultdict(lambda: {"tentativas": 0, "engajados": 0, "certificados": 0, "custo": 0.0})
    for e in (eventos if deduplicado else deduplicar(eventos)):
        cl = classificar(e.canal, e.resultado)
        if cl.ignorar:
            continue
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

    - prob(id_cliente, canal):     P(alguém engaja) — alimenta o funil de contato.
    - prob_cpc(id_cliente, canal): P(certifica | o contato É do cliente) — o que vale dinheiro.
      Estimada na carteira a partir dos contatos já CERTIFICADOS (titularidade
      conhecida) e ajustada pelo quanto este cliente engaja no canal vs. a média.
    """

    FORCA = 5.0
    TETO = 0.95

    def __init__(self, eventos: list[Evento], hit_rate: dict[str, dict],
                 certs: dict[tuple[str, str], "Certificacao"] | None = None, deduplicado: bool = False):
        if not deduplicado:
            eventos = deduplicar(eventos)
        self.base = {c: r["hit_rate"] for c, r in hit_rate.items()}
        self.obs = defaultdict(lambda: [0, 0])  # (id_cliente, canal) -> [engajou, tentativas]
        titulares = {k for k, c in (certs or {}).items() if c.status == "CERTIFICADO"}
        cert_tit = defaultdict(lambda: [0, 0])  # canal -> [certificou, tentativas] em contato titular
        # Viés de seleção: o contato só é "titular conhecido" PORQUE certificou.
        # Descarta a 1ª certificação de cada um (a mais antiga; no empate, a 1ª da lista), que foi o
        # evento que o selecionou: conta tudo numa passada e tira essa no fim.
        selecao = {}
        for e in eventos:
            cl = classificar(e.canal, e.resultado)
            if cl.ignorar:
                continue
            k = (e.id_cliente, e.contato)
            if k in titulares:
                ct = cert_tit[e.canal]
                ct[0] += cl.nivel == Nivel.CERTIFICADO
                ct[1] += 1
                if cl.nivel == Nivel.CERTIFICADO and (k not in selecao or e.data < selecao[k].data):
                    selecao[k] = e
            # Terceiro, contato inválido ou sem conta no app dizem algo sobre o
            # CONTATO, não sobre a preferência de canal do cliente.
            if cl.contra_titular > 0 or cl.nivel == Nivel.INVALIDO or cl.restricao == "whatsapp:sem_conta" \
                    or e.resultado == "inexistente_voz":
                continue
            o = self.obs[(e.id_cliente, e.canal)]
            o[0] += cl.nivel >= Nivel.ENGAJADO
            o[1] += 1
        for e in selecao.values():
            ct = cert_tit[e.canal]
            ct[0] -= 1
            ct[1] -= 1
        self.cert_titular = {}
        for canal, r in hit_rate.items():
            k, n = cert_tit.get(canal, (0, 0))
            # prior fraco: taxa de certificação bruta da carteira
            self.cert_titular[canal] = (k + r["taxa_certificacao"] * self.FORCA) / (n + self.FORCA)

    def prob(self, id_cliente: str, canal: str) -> float:
        base = self.base.get(canal, 0.0)
        k, n = self.obs.get((id_cliente, canal), (0, 0))
        return (k + base * self.FORCA) / (n + self.FORCA)

    def prob_cpc(self, id_cliente: str, canal: str) -> float:
        base = self.base.get(canal, 0.0)
        lift = self.prob(id_cliente, canal) / base if base else 1.0
        return min(self.TETO, self.cert_titular.get(canal, 0.0) * lift)


def afinidade_canal(eventos: list[Evento], hit_rate: dict[str, dict],
                    certs: dict[tuple[str, str], Certificacao] | None = None) -> Afinidade:
    return Afinidade(eventos, hit_rate, certs)


# ------------------------------------------------------------------ nota de contato
# Nota de contato por (cliente, contato, canal) = É dele × Chega × Responde. É a mesma estrutura do
# valor esperado de priorizacao.planejar; aqui ela ordena os números DENTRO do canal (fila.candidatos),
# depois das travas, do Hot, da rotação e da regra do usuário. O contato só fica no estado local do
# motor (estado/contatos_nota.csv); para o banco vão só os resumos por cliente/persona.
MEIA_VIDA_CHEGA = 60      # retorno de canal envelhece mais rápido que a titularidade (90)
FORCA_CHEGA = 5.0         # peso do prior (taxa do canal na carteira) em nº de envios com retorno
FORCA_RESPONDE = 5.0      # peso do prior (Afinidade.prob_cpc do cliente) em nº de tentativas
LIMIAR_ALCANCAVEL = 0.5   # Chega mínimo para o contato contar como alcançável na persona
POSITIVAS_CANAL = ("entregue", "lido", "clique")
FALHAS_CANAL = ("inexistente", "temporario")      # bloqueio é trava (opt-out), não alcance
RETORNO_DO_CANAL = {"discador": "voz", "agente_voz": "voz"}   # canal da fila -> canal do retorno
CANAIS_NOTA = {"telefone": ("whatsapp", "rcs", "agente_voz", "discador", "sms"), "email": ("email",)}
CAMPOS_NOTA = ("id_cliente", "contato", "canal", "e_dele", "chega", "responde", "nota", "data")


@contextmanager
def sem_gc():
    """Passadas que criam milhões de tuplas sem ciclo: o coletor de ciclos só atrasa (carteira grande)."""
    ligado = gc.isenabled()
    gc.disable()
    try:
        yield
    finally:
        if ligado:
            gc.enable()


class NotaContatos:
    """Nota de cada (cliente, contato, canal). Calculada sob demanda (só o histórico é guardado):
    contato sem histórico tem Chega = taxa do canal na carteira e Responde = Afinidade.prob_cpc do
    cliente, iguais para todos os contatos do cliente no canal — a nota fica proporcional ao score e a
    ordem não muda (paridade com a ordem antiga, ver fila.candidatos)."""

    def __init__(self, hoje: date, chega_obs: dict, chega_base: dict, resp_obs: dict, afinidade: "Afinidade"):
        self.hoje = hoje
        self.chega_obs = chega_obs          # (contato, canal do retorno) -> [positivos, envios] com decaimento
        self.chega_base = chega_base        # canal do retorno -> taxa da carteira
        self.resp_obs = resp_obs            # (id_cliente, contato, canal) -> [cpcs, tentativas]
        self.afinidade = afinidade
        self._contatos_chega = {c for c, _ in chega_obs}
        self._clientes_resp = {i for i, _, _ in resp_obs}
        self.erro = None                    # falhou na fila: a ordem volta à de antes (rodar_dia alerta)
        self._p0 = {}                       # (id_cliente, canal) -> Afinidade.prob_cpc (cache da rodada)

    def chega(self, contato: str, canal: str) -> float:
        rc = RETORNO_DO_CANAL.get(canal, canal)
        p0 = self.chega_base.get(rc, 1.0)
        o = self.chega_obs.get((contato, rc))
        return p0 if o is None else (o[0] + FORCA_CHEGA * p0) / (o[1] + FORCA_CHEGA)

    def responde(self, id_cliente: str, contato: str, canal: str) -> float:
        p0 = self._p0.get((id_cliente, canal))
        if p0 is None:
            p0 = self._p0[(id_cliente, canal)] = self.afinidade.prob_cpc(id_cliente, canal)
        o = self.resp_obs.get((id_cliente, contato, canal))
        return p0 if o is None else (o[0] + FORCA_RESPONDE * p0) / (o[1] + FORCA_RESPONDE)

    def partes(self, cert: Certificacao, canal: str) -> tuple[float, float, float, float]:
        """(é dele, chega, responde, nota)."""
        e = cert.score
        ch = self.chega(cert.contato, canal)
        r = self.responde(cert.id_cliente, cert.contato, canal)
        return e, ch, r, e * ch * r

    def nota(self, cert: Certificacao, canal: str) -> float:
        return cert.score * self.chega(cert.contato, canal) * self.responde(cert.id_cliente, cert.contato, canal)

    def difere(self, id_cliente: str, certs, canal: str) -> bool:
        """Algum desses contatos tem histórico próprio NESTE canal? Senão a nota no canal é proporcional ao
        score e a ordem não muda (nem precisa calcular)."""
        rc = RETORNO_DO_CANAL.get(canal, canal)
        return any((c.contato, rc) in self.chega_obs or (id_cliente, c.contato, canal) in self.resp_obs
                   for c in certs)

    def tem_historico(self, id_cliente: str, certs) -> bool:
        """O cliente tem algo que diferencie os contatos além do score (CPC/tentativa ou retorno de canal)?"""
        return id_cliente in self._clientes_resp or any(c.contato in self._contatos_chega for c in certs)

    def linhas(self, certs: dict, ids: set | None = None) -> list[tuple]:
        """Linhas (na ordem de CAMPOS_NOTA) de estado/contatos_nota.csv: só (cliente, contato, canal) com histórico próprio NO CANAL
        (retorno de canal ou tentativa); os demais têm a nota do prior (score × taxas do canal/cliente).
        Inválido/contestado ficam fora (nunca recebem)."""
        saida, d = [], self.hoje.isoformat()
        for (idc, contato), c in certs.items():
            if (ids is not None and idc not in ids) or c.status in ("INVALIDO", "CONTESTADO"):
                continue
            if contato not in self._contatos_chega and idc not in self._clientes_resp:
                continue
            for canal in CANAIS_NOTA.get(c.tipo, ()):
                if (contato, RETORNO_DO_CANAL.get(canal, canal)) not in self.chega_obs \
                        and (idc, contato, canal) not in self.resp_obs:
                    continue
                e, ch, r, n = self.partes(c, canal)
                saida.append((idc, contato, canal, round(e, 4), round(ch, 4), round(r, 4), round(n, 6), d))
        return saida

    def resumo_clientes(self, certs: dict, ids: set | None = None, fora: set | None = None) -> dict[str, dict]:
        """Resumos por cliente para as personas e os segmentos (nunca o contato em si):
        melhor_contato (alta/média/baixa pelos tercis da maior nota na carteira; sem = nenhum contato
        válido), tem_contato_certificado (sim/não), contatos_alcancaveis (0, 1, 2+: válido, com algum
        canal sem restrição e Chega ≥ LIMIAR_ALCANCAVEL). fora: {(id, contato)} que não pertencem."""
        fora = fora or set()
        chega, responde = self.chega, self.responde
        cbase = {canal: self.chega_base.get(RETORNO_DO_CANAL.get(canal, canal), 1.0)
                 for cs in CANAIS_NOTA.values() for canal in cs}
        p0 = self._p0
        melhor, cert_, alc = {}, {}, defaultdict(int)
        for (idc, contato), c in certs.items():
            if ids is not None and idc not in ids:
                continue
            melhor.setdefault(idc, None)
            cert_.setdefault(idc, False)
            if c.status in ("INVALIDO", "CONTESTADO") or (idc, contato) in fora:
                continue
            cert_[idc] = cert_[idc] or c.status == "CERTIFICADO"
            alcanca, m = False, melhor[idc]
            # contato sem histórico (o caso comum): Chega e Responde são os priors, sem o cálculo completo
            simples = contato not in self._contatos_chega and idc not in self._clientes_resp
            for canal in CANAIS_NOTA.get(c.tipo, ()):
                if c.restricoes and any(r.startswith(canal + ":") for r in c.restricoes):
                    continue
                if simples:
                    ch = cbase[canal]
                    r = p0.get((idc, canal))
                    if r is None:
                        r = responde(idc, contato, canal)
                else:
                    ch, r = chega(contato, canal), responde(idc, contato, canal)
                alcanca = alcanca or ch >= LIMIAR_ALCANCAVEL
                n = c.score * ch * r
                if m is None or n > m:
                    m = n
            melhor[idc] = m
            alc[idc] += alcanca
        valores = sorted(v for v in melhor.values() if v)
        n = len(valores)          # tercis da carteira (mesmo arredondamento para n pequeno: 3 valores = 3 faixas)
        c1 = valores[(n - 1) // 3] if valores else 0.0
        c2 = valores[2 * (n - 1) // 3] if valores else 0.0
        saida = {}
        for idc, v in melhor.items():
            faixa = "sem" if not v else "baixa" if v <= c1 else "média" if v <= c2 else "alta"
            saida[idc] = {"melhor_contato": faixa, "tem_contato_certificado": "sim" if cert_[idc] else "não",
                          "contatos_alcancaveis": "2+" if alc[idc] >= 2 else str(alc[idc])}
        return saida


def nota_contatos(eventos: list[Evento], certs: dict[tuple[str, str], Certificacao], hoje: date,
                  retornos_canal=None, sinais_voz=None) -> NotaContatos:
    """Nota de contato (É dele × Chega × Responde) com o histórico até ontem. Passadas lineares.

    - É dele    = Certificacao.score (titularidade, já com a evidência cruzada entre IDs da mesma pessoa).
    - Chega     = taxa Beta de alcance por contato × canal a partir do retorno de canal (entregue/lido/
                  clique ÷ envios com retorno; um envio = contato × canal × dia), meia-vida MEIA_VIDA_CHEGA,
                  prior = taxa do canal na carteira. Suspenso/restrito continua fora pela trava, não pela nota.
    - Responde  = CPC (nível CERTIFICADO) do contato no canal ÷ tentativas dele no canal (uma por dia),
                  encolhido para Afinidade.prob_cpc do cliente (que já encolhe para a carteira e descarta o
                  viés da 1ª certificação). Retorno de canal não é tentativa; ocorrência sem contato
                  identificado (voz com vários números) não entra.
    retornos_canal: [motor.retorno_canal.Registro] (contato, canal, marca, data).
    sinais_voz: [(contato, dia)] de número inexistente confirmado na voz (discagem.protecao_inexistente): cada dia
    vale PESO_SINAL de uma falha de envio no Chega do número em SMS/RCS/WhatsApp (só no número, não na taxa da
    carteira). Não restringe: uma entrega/clique depois devolve a confiança."""
    with sem_gc():
        return _nota_contatos(eventos, certs, hoje, retornos_canal, sinais_voz)


CANAIS_SINAL_VOZ = ("sms", "rcs", "whatsapp")
PESO_SINAL_VOZ = 0.5


def _nota_contatos(eventos, certs, hoje, retornos_canal, sinais_voz=None) -> NotaContatos:
    """Ver nota_contatos."""
    # retorno reimportado não conta duas vezes: a contagem é por dia (Chega e Responde) e a Afinidade deduplica
    eventos = [e for e in eventos if e.data < hoje]
    # Chega
    por_envio = {}
    for r in retornos_canal or []:
        if r.data >= hoje or (r.marca not in POSITIVAS_CANAL and r.marca not in FALHAS_CANAL):
            continue
        k = (r.contato, r.canal, r.data)
        por_envio[k] = por_envio.get(k, False) or r.marca in POSITIVAS_CANAL
    chega_obs = defaultdict(lambda: [0.0, 0.0])
    tot = defaultdict(lambda: [0.0, 0.0])
    pesos = {}
    for (contato, canal, d), ok in por_envio.items():
        w = pesos.get(d)
        if w is None:
            w = pesos[d] = 0.5 ** (max((hoje - d).days, 0) / MEIA_VIDA_CHEGA)
        o, t = chega_obs[(contato, canal)], tot[canal]
        o[0] += ok * w
        o[1] += w
        t[0] += ok * w
        t[1] += w
    chega_base = {c: (k + 1.0) / (n + 1.0) for c, (k, n) in tot.items()}   # sem retorno nenhum: presume que chega
    for contato, d in sinais_voz or ():
        if d >= hoje:
            continue
        w = PESO_SINAL_VOZ * 0.5 ** (max((hoje - d).days, 0) / MEIA_VIDA_CHEGA)
        for canal in CANAIS_SINAL_VOZ:
            chega_obs[(contato, canal)][1] += w
    # Responde
    acoes = [e for e in eventos if not (e.fornecedor or "").startswith("canal:")]
    por_dia = {}
    for e in acoes:
        if not e.contato:
            continue
        cl = TAXONOMIA.get(e.canal, {}).get(e.resultado)
        if cl is None or cl.ignorar:   # desconhecido (quarentena) ou falha de rede: não entra
            continue
        k = (e.id_cliente, e.contato, e.canal, e.data)
        if not por_dia.get(k):
            por_dia[k] = cl.nivel == Nivel.CERTIFICADO
    resp_obs = defaultdict(lambda: [0, 0])
    for (idc, contato, canal, _), cpc in por_dia.items():
        o = resp_obs[(idc, contato, canal)]
        o[0] += cpc
        o[1] += 1
    acoes = deduplicar(acoes)
    afin = Afinidade(acoes, hit_rate_por_canal(acoes, deduplicado=True), certs, deduplicado=True)
    return NotaContatos(hoje, dict(chega_obs), chega_base, dict(resp_obs), afin)
