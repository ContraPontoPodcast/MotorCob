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
  interno      só o motor gera (ex.: inexistente_voz); fora do de-para e do site
  prova_existencia o número existe (alguém/algo atendeu ou a linha deu sinal): zera confirmações de inexistente
                   (usado pela proteção do inexistente; sem efeito até ela entrar)

Também aqui: os códigos SIP/Q.850 que confirmam (tipo A/B) ou nunca confirmam número inexistente
(de-para do especialista, scratchpad/discador/de_para_sip.md §3.1). São só dados até a ingestão ler as causas.
"""
import json
from dataclasses import dataclass
from pathlib import Path

CANAIS_VOZ = ("discador", "agente_voz")

# variáveis que o agente de voz pode receber por cliente (paridade com public.variaveis_voz() do SQL 56; o teste
# supabase/testes/testar_voz_contrato.py confere). Nunca CPF. O valor só existe no arquivo do agente_voz, na
# memória da VM e no provedor durante a chamada; nunca no banco nem em log.
VARIAVEIS_VOZ = ("primeiro_nome", "credor", "saldo", "dias_atraso", "vencimento", "link_pagamento",
                 "valor_minimo", "parcelas_max", "desconto_max", "assessoria")   # assessoria: nome da empresa (SQL 58)
# as que o motor conhece e põe no ids/agente_voz.csv (colunas no fim, nesta ordem). credor vem do banco (a VM lê
# credores.nome); link_pagamento e a alçada (valor_minimo, parcelas_max, desconto_max) vêm de fora do motor.
VARIAVEIS_DO_MOTOR = ("primeiro_nome", "saldo", "dias_atraso", "vencimento")
# colunas da base bruta que trazem o nome da pessoa (normalizadas como motor.entrada._nome_simples)
COLUNAS_NOME = ("NOME", "NOME_CLIENTE", "NOME_DEVEDOR", "NOME_TITULAR", "NOME_COMPLETO", "NOME_CONSUMIDOR",
                "NOME_DO_CLIENTE", "NOME_DO_DEVEDOR", "NOME_DO_TITULAR", "NM_CLIENTE", "NM_DEVEDOR", "NM_TITULAR",
                "CLIENTE_NOME", "PRIMEIRO_NOME")


def primeiro_nome(atributos: dict | None) -> str:
    """Só o primeiro nome (para a saudação), da coluna de nome da base bruta; vazio se não houver."""
    import re
    import unicodedata
    for col, valor in (atributos or {}).items():
        chave = re.sub(r"[^A-Z0-9]+", "_", unicodedata.normalize("NFKD", str(col or "")).encode("ascii", "ignore")
                       .decode().upper()).strip("_")
        if chave in COLUNAS_NOME:
            partes = re.findall(r"[^\W\d_]+(?:['-][^\W\d_]+)*", str(valor or ""))
            if partes:
                return partes[0][:30].title()
    return ""


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
    interno: bool = False        # só o motor gera (não é mapeável nem aparece no site)


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
    # proteção do inexistente (discagem.inexistente.modo = "so_voz"): o número inexistente da voz não invalida o
    # número na certificação; a voz do número fica em quarentena/encerrada por restrição (discagem.protecao_inexistente)
    D("inexistente_voz", "SEM_RETORNO", "Número inexistente (só voz)", curta="sempre", interno=True),
    # o agente virtual também confirma a identidade
    D("identidade_confirmada", "CERTIFICADO", "Identidade confirmada", pro="CERT", canais=("agente_voz",),
      marca="clique", e_cpc=True, prova_existencia=True),
    # ---- de-para SIP/Q.850 do especialista + decisões do dono (31/10/2026). Só aparecem com código/coluna novos:
    # layout e ocorrência antigos não mudam. Tentativa técnica continua contando como tentativa (conta_tentativa)
    # e a falha técnica conta como chamada curta (MP 1.396: não completada).
    # as 8 situações do dono (SITUACOES_DONO): máquina, desligou sem conversar, atendeu e desligou, pediu retorno
    D("maquina", "ENTREGUE", "Máquina", marca="temporario", nao_atende=True, curta="sempre", generico="maquina",
      prova_existencia=True),
    D("desligou_sem_conversar", "ENTREGUE", "Desligou sem conversar", marca="entregue",
      generico="desligou_sem_conversar", prova_existencia=True),
    D("atendeu_desligou", "ENGAJADO", "Atendeu e desligou", pro="ENGAJ", marca="clique", generico="atendeu_desligou",
      prova_existencia=True),
    # pediu retorno: CPC só se foi o titular (de terceiro é recado + retorno_em)
    D("retorno_agendado", "CERTIFICADO", "Atendeu e pediu retorno", pro="CERT", marca="clique",
      generico="retorno_agendado", e_cpc=True, prova_existencia=True),
    # técnico: nunca penaliza o número (fora da certificação, do Chega e do Responde); a nossa rede é falha_rede
    D("falha_operadora", "SEM_RETORNO", "Falha da operadora / rota", ignorar=True, curta="sempre",
      generico="falha_operadora"),
    D("bloqueio_originacao", "SEM_RETORNO", "Bloqueio de originação", ignorar=True, curta="sempre",
      generico="bloqueio_originacao"),
    D("cancelada_discador", "SEM_RETORNO", "Cancelada antes do toque mínimo", ignorar=True, curta="sempre",
      generico="cancelada_discador"),
    # aparelho desligado/fora de área: nem confirma nem desfaz inexistente. Decisão do dono (01/11/2026, Renitência e
    # Resubmit): é falha TÉCNICA, nunca penaliza o número (fora da certificação) e não conta no descanso por "não
    # atende"; continua contando como tentativa do dia e como chamada curta (pela opção chamadas_curtas.falha_conta)
    D("indisponivel", "SEM_RETORNO", "Fora de área / desligado", ignorar=True, curta="sempre",
      generico="indisponivel"),
    D("rejeitada", "ENTREGUE", "Recusou a chamada", marca="entregue", curta="sempre", generico="rejeitada",
      prova_existencia=True),
    D("mudo", "SEM_RETORNO", "Mudo", marca="temporario", nao_atende=True, generico="mudo"),
    D("fax", "SEM_RETORNO", "Fax / sinal", marca="inexistente", generico="fax"),
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
TECNICOS = tuple(d.chave for d in DESFECHOS if d.ignorar)        # não dizem nada do número

# As 8 situações do dono (31/10/2026) -> desfechos. "Número incorreto" são dois: não existe × pessoa errada.
SITUACOES_DONO: dict[str, tuple[str, ...]] = {
    "Máquina": ("maquina",),
    "Não atendeu": ("nao_atendida",),
    "Ocupado": ("ocupado",),
    "Caixa postal": ("caixa_postal",),
    "Desligou sem conversar": ("desligou_sem_conversar",),
    "Atendeu e pediu retorno": ("retorno_agendado",),
    "Atendeu e desligou": ("atendeu_desligou",),
    "Número incorreto": ("numero_inexistente", "atendida_terceiro_desconhece"),
}


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


# ------------------------------------------------------------------ de-para da rede (regras/voz_causas.json)
# Decisões do dono (31/10/2026): quem disca é sempre o agente de IA, pelo tronco do cliente; quando precisa de um
# humano ele transfere por SIP para o discador do cliente. Cada tentativa traz TRÊS fontes, guardadas separadas
# no Evento: a REDE (SIP final, Q.850/HANGUPCAUSE, DIALSTATUS, AMD), o evento da IA e o evento do OPERADOR (a
# tabulação que volta do discador do cliente depois da transferência, ou que chega pela importação).
CAUSAS = Path(__file__).resolve().parent.parent / "regras" / "voz_causas.json"
GRUPOS_CAUSA = ("sip", "q850", "dialstatus", "amd")
TRANSFERENCIAS = ("atendida", "sem_operador", "falhou")     # resultado da transferência IA -> humano
DESTINOS = ("ia", "ia_humano")                               # quem ficou com a chamada do nosso lado
FRACOS = ("nao_atendida",)       # resultado que a rede pode detalhar (o "sem contato" genérico vira não atende)
_causas_cache: dict = {}


def validar_causas(dados: dict, onde: str = "voz_causas.json") -> dict:
    """De-para da rede validado: grupo -> código (texto, maiúsculo) -> {chave, confirma}. Toda chave existe na
    tabela ("*" = decide a tabulação); "numero_inexistente" exige confirma A/B (nunca por palpite)."""
    out = {}
    for g in GRUPOS_CAUSA:
        out[g] = {}
        for cod, v in (dados.get(g) or {}).items():
            ch = v.get("chave") if isinstance(v, dict) else v
            if ch != "*" and ch not in POR_CHAVE:
                raise ValueError(f"{onde}: {g}/{cod}: desfecho '{ch}' não existe em motor/voz.py")
            conf = v.get("confirma") if isinstance(v, dict) else None
            if ch == "numero_inexistente" and conf not in ("A", "B"):
                raise ValueError(f"{onde}: {g}/{cod}: inexistente sem tipo de confirmação (A ou B)")
            out[g][str(cod).strip().upper()] = {"chave": ch, "confirma": conf}
    return out


def carregar_causas(caminho: Path | None = None) -> dict:
    """regras/voz_causas.json (falha alto na carga, como o regua.json)."""
    caminho = Path(caminho or CAUSAS)
    if caminho not in _causas_cache:
        _causas_cache[caminho] = validar_causas(json.loads(caminho.read_text(encoding="utf-8")), caminho.name)
    return _causas_cache[caminho]


def numero_canonico(numero: str | None) -> bool:
    """DDD válido + 9º dígito no celular (11 dígitos começando por 9) ou fixo de 8 (2–5). Celular de 8 dígitos é
    número antigo sem o 9º dígito: erro da base, não do número (nunca confirma inexistente tipo B)."""
    n = "".join(c for c in str(numero or "") if c.isdigit())
    if len(n) in (12, 13) and n.startswith("55"):
        n = n[2:]
    if len(n) not in (10, 11) or "0" in n[:2]:
        return False
    return n[2] == "9" if len(n) == 11 else n[2] in "2345"


def _inteiro(v):
    try:
        return int(str(v).strip()) if v is not None and str(v).strip() != "" else None
    except ValueError:
        return None


def pela_rede(sip=None, q850=None, dialstatus=None, amd=None, toque_s=None, toque_min: int = 15,
              canonico: bool = True, aceita_tipo_b: bool = True, causas: dict | None = None):
    """Desfecho que a REDE indica: (chave ou None, tipo de confirmação de inexistente ou None, avisos).
    Ordem: AMD; o SIP final, com o Q.850 decidindo quando o SIP é genérico ou não confirmou; o DIALSTATUS por
    último. Inexistente só por código confirmável (tipo_confirmacao); 'não confirmou' vira falha da operadora."""
    c = causas or carregar_causas()
    sip, q850 = _inteiro(sip), _inteiro(q850)
    av = []
    a = str(amd or "").strip().upper()
    if a:
        x = c["amd"].get(a)
        if x is None:
            av.append(f"AMD desconhecido '{a}'")
        elif x["chave"] != "*":
            return x["chave"], None, av
    t = tipo_confirmacao(sip, q850, canonico, aceita_tipo_b)
    if t:
        return "numero_inexistente", t, av

    def _de(g, cod):
        x = c[g].get(str(cod).upper())
        if x is None:
            av.append(f"causa {g.upper()} {cod} desconhecida (vale a tabulação)")
            return None
        if x["chave"] == "numero_inexistente":       # não confirmou (tipo B fora do número canônico, Q.850 de rota)
            av.append("NORMALIZAÇÃO: inexistente tipo B em número não canônico (vale como falha da operadora)"
                      if x["confirma"] == "B" and not canonico else "inexistente sem confirmação da rede")
            return "falha_operadora"
        if x["chave"] == "*":
            return None
        if x["chave"] == "nao_atendida" and str(cod).upper() in ("487", "CANCEL") and toque_s is not None \
                and _inteiro(toque_s) is not None and _inteiro(toque_s) < toque_min:
            return "cancelada_discador"
        return x["chave"]

    q_decide = q850 is not None and (sip is None or sip in SIP_GENERICO or sip in CONFIRMA_A_SIP | CONFIRMA_B_SIP
                                     or q850 in NUNCA_CONFIRMA_Q850 | APARELHO_Q850)
    if q_decide:
        ch = _de("q850", q850)
        if ch:
            return ch, None, av
    if sip is not None:
        ch = _de("sip", sip)
        if ch:
            return ch, None, av
    ds = str(dialstatus or "").strip().upper()
    if ds:
        ch = _de("dialstatus", ds)
        if ch:
            return ch, None, av
    return None, None, av


def classificar_chamada(resultado_ia=None, resultado_operador=None, transferencia=None, sip=None, q850=None,
                        dialstatus=None, amd=None, toque_s=None, toque_min: int = 15, canonico: bool = True,
                        aceita_tipo_b: bool = True, causas: dict | None = None):
    """Desfecho final de uma tentativa: (chave, origem, avisos); origem = operador|transferencia|ia|rede|nenhum.

    1. a tabulação do OPERADOR (depois da transferência) manda, se diz algo além de "não atendeu";
    2. transferência sem operador ou que falhou = abandono (não penaliza o número);
    3. o evento da IA;
    4. a rede (pela_rede). "Não atendeu" genérico da IA/operador cede para o que a rede detalhou.
    Número inexistente vindo da IA/operador com causa de rede que NÃO confirma vira o que a rede disse (ou falha
    da operadora): nunca se invalida a voz de um número por um código não confirmável."""
    rede, conf, av = pela_rede(sip, q850, dialstatus, amd, toque_s, toque_min, canonico, aceita_tipo_b, causas)
    tem_rede = any(v not in (None, "") for v in (sip, q850, dialstatus, amd))
    if resultado_operador and resultado_operador not in FRACOS:
        ch, origem = resultado_operador, "operador"
    elif transferencia in ("sem_operador", "falhou"):
        ch, origem = "abandonada", "transferencia"
    elif resultado_ia and resultado_ia not in FRACOS:
        ch, origem = resultado_ia, "ia"
    elif rede:
        ch, origem = rede, "rede"
    elif resultado_operador or resultado_ia:
        ch, origem = resultado_operador or resultado_ia, "operador" if resultado_operador else "ia"
    else:
        return None, "nenhum", av
    if ch == "numero_inexistente" and origem != "rede" and tem_rede and not conf:
        ch = rede if rede and rede != "numero_inexistente" else "falha_operadora"
        av.append("inexistente da tabulação sem confirmação da rede (vale o que a rede disse)")
    return ch, origem, av


# ------------------------------------------------------------------ eventos pós-atendimento (IA e operador)
# A mesma chamada pode chegar mais de uma vez (o webhook da IA e, depois, a tabulação do operador do discador do
# cliente; ou o arquivo reimportado): vale UM registro por canal por tentativa (canal, id_chamada).
# Ordem de força da tabulação (a mais forte fica; o operador vence a IA no empate): acordo proposto entra como
# promessa (acordo de verdade só nasce das parcelas).
FORCA = ("promessa", "retorno_agendado", "recusa", "cpc", "identidade_confirmada", "recado",
         "atendida_terceiro_desconhece", "atendeu_desligou", "atendida_sem_cpc", "opt_out")
_COMPLEMENTA = ("data_promessa", "valor_promessa", "retorno_em", "duracao_s", "hora", "causa_sip", "causa_q850",
                "resultado_ia", "resultado_operador", "transferencia", "destino", "rota")


def _forca(e) -> tuple:
    r = FORCA.index(e.resultado) if e.resultado in FORCA else len(FORCA)
    return (r, 0 if e.origem_resultado == "operador" else 1)


def unificar_chamadas(eventos: list) -> tuple[list, int]:
    """Um registro por (canal, id_chamada) de voz: fica a tabulação mais forte (FORCA; operador antes da IA), com
    os campos que só os outros registros traziam (data/valor da promessa, retorno, causas…). Identidade
    confirmada em qualquer registro da chamada vale para o que ficou. Sem id_chamada: nada muda.
    Devolve (eventos na ordem original, quantos registros foram fundidos)."""
    from dataclasses import replace
    grupos: dict = {}
    for i, e in enumerate(eventos):
        if e.canal in CANAIS_VOZ and e.id_chamada and not (e.fornecedor or "").startswith("canal:"):
            grupos.setdefault((e.canal, e.id_chamada), []).append(i)
    fora, troca = set(), {}
    for idx in grupos.values():
        if len(idx) < 2:
            continue
        evs = [eventos[i] for i in idx]
        fica_i = min(idx, key=lambda i: _forca(eventos[i]))
        fica = eventos[fica_i]
        extra = {}
        for campo in _COMPLEMENTA:
            if getattr(fica, campo) is None:
                v = next((getattr(x, campo) for x in evs if getattr(x, campo) is not None), None)
                if v is not None:
                    extra[campo] = v
        if any(x.resultado == "identidade_confirmada" or x.identidade_confirmada for x in evs):
            extra["identidade_confirmada"] = True
        troca[fica_i] = replace(fica, **extra) if extra else fica
        fora.update(i for i in idx if i != fica_i)
    if not fora:
        return eventos, 0
    return [troca.get(i, e) for i, e in enumerate(eventos) if i not in fora], len(fora)


# Marcas que o cliente escolhe no site para um código de ocorrência (ocorrencia_codigos.resultado: CHECK do banco,
# SQL 20261017000001; site/src/components/credores/configuracoes.tsx). São genéricos, não desfechos: o desfecho
# fino da voz (promessa, ocupado…) ainda só vem do layout do repositório.
GENERICOS_SITE = ("cpc", "sem_contato", "terceiro", "opt_out")
