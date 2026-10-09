"""Estratégia de acionamento: o que cada cluster faz, em que dia, por qual canal e em qual contato.

Uma estratégia (tabela `estrategias`, editada no site) sobrescreve partes do playbook
padrão (`regras/regua.json`) para os clusters que a usam:

    {
      "localizacao": {"passos": {"1": [ação, ...], "3": [...]}, "dias_sem_contato_para_ncp": 8},
      "cpc":         {"ordem": [ação, ...], "junto": [ação, ...], "tentativas_por_canal": 3,
                      "intervalo_cpa": 1, "intervalo_cpb": 2},   # acionar a cada N dias
      "giro":        {"passos": {...}, "ciclo_dias": 8, "max_ciclos": 3},
      "preventivo":  {"ativo": true, "passos": {"3": [...], "1": [...], "0": [...]}},
      "quebra":      {"ativo": true, "carencia": 0, "passos": {...}, "dias_para_estoque": 6},
      "recencia_horas": 48
    }

Cada passo é um BLEND de ações, avaliadas em ordem:

    {"canal": "whatsapp", "modo": "sempre", "numeros": 1,
     "contatos": {"whatsapp": true, "status": ["CERTIFICADO", "PROVAVEL"]}}

modo:
  sempre   vai se houver contato que passe no filtro (abre uma nova cadeia)
  senao    vai só se nada da cadeia foi (ex.: WhatsApp → senão RCS → senão SMS)
  junto    vai junto com a ação de cima, se ela foi (ex.: SMS + e-mail)
  reserva  se a cadeia foi: vai marcada "só se <canal> sem contato no dia";
           se a cadeia não foi: vai como principal (ex.: agente virtual → reserva discador)

contatos (todos opcionais; o que não for informado não filtra):
  status             certificação aceita: CERTIFICADO, PROVAVEL, NAO_CONFIRMADO, DESCONHECIDO
  whatsapp           só número com WhatsApp (base ou enriquecimento)
  rcs                só número com RCS (enriquecimento)
  pertence           só contato que pertence ao cliente (enriquecimento ou certificado)
  sem_nao_perturbe   fora os números da lista Não Perturbe
  score_bureau_min   score mínimo do bureau
  origem             origens aceitas (cliente, bureau, enriquecimento…)
numeros: quantos contatos do cliente recebem a ação (vazio = regra padrão do canal).
personas: ids das personas da carteira (tabela personas_usuario) que recebem a ação; vazio = todos.
          Cliente fora delas: a ação não vai para ele (o "senão" seguinte vai).

Travas que nenhuma estratégia desliga: contato inválido, contestado ou marcado como
"não pertence" nunca recebe; WhatsApp só em número confiável ou com WhatsApp válido e
com freio por taxa de bloqueio; janela de horário, domingo e feriado; 48h no padrão.
Um passo escrito só com nomes de canal (["whatsapp"]) segue o playbook padrão
(substituto, acompanhante e reserva de `regua.json`).
"""
from copy import deepcopy

CANAIS = ("whatsapp", "rcs", "agente_voz", "discador", "sms", "email")
MODOS = ("sempre", "senao", "junto", "reserva")
STATUS = ("CERTIFICADO", "PROVAVEL", "NAO_CONFIRMADO", "DESCONHECIDO")
FILTROS = ("status", "whatsapp", "rcs", "pertence", "sem_nao_perturbe", "score_bureau_min", "origem")
FASES_PASSOS = ("localizacao", "giro", "preventivo", "quebra")
NUMEROS_FASE = {"localizacao": ("dias_sem_contato_para_ncp",), "giro": ("ciclo_dias", "max_ciclos"),
                "quebra": ("dias_para_estoque",), "cpc": ("tentativas_por_canal",), "preventivo": ()}


TOKENS_PERSONA = ("persona_1", "persona_2")   # melhor / 2º melhor canal da persona (motor/persona.py)
ENRIQUECIMENTO = "enriquecimento"   # ação da esteira: manda o cliente para o bureau nesse dia (não é contato)
SEM_ACAO = "sem_acao"               # na raia de uma persona: neste dia ela não recebe nada
CAMPOS_PRIORIDADE = ("ranking", "score", "whatsapp", "rcs", "bureau")


def _simples(v) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", str(v or "")).encode("ascii", "ignore").decode().lower().strip()
    return "".join(c if c.isalnum() else "_" for c in t).strip("_")


APELIDOS_CANAL = {
    "whats": "whatsapp", "wpp": "whatsapp", "zap": "whatsapp", "wa": "whatsapp", "whatsapp_business": "whatsapp",
    "e_mail": "email", "mail": "email", "agente_virtual": "agente_voz", "agente": "agente_voz", "ura": "agente_voz",
    "voz": "agente_voz", "ia": "agente_voz", "bot": "agente_voz", "voicebot": "agente_voz", "robo": "agente_voz",
    "discadora": "discador", "ligacao": "discador", "telefone": "discador",
    "bureau": ENRIQUECIMENTO, "enriquecimento_bureau": ENRIQUECIMENTO, "enriquecer": ENRIQUECIMENTO,
    "nenhum": SEM_ACAO, "nenhuma": SEM_ACAO, "pausa": SEM_ACAO, "nao_acionar": SEM_ACAO, "sem_acionamento": SEM_ACAO,
    "melhor_canal_da_persona": "persona_1", "persona1": "persona_1", "persona_melhor": "persona_1",
    "2_melhor_da_persona": "persona_2", "segundo_melhor_da_persona": "persona_2", "persona2": "persona_2"}
APELIDOS_MODO = {"senao": "senao", "se_nao": "senao", "junto": "junto", "junto_com": "junto", "e": "junto",
                 "reserva": "reserva", "sempre": "sempre", "principal": "sempre", "": "sempre"}


def canal_padrao(v) -> str:
    """Nome de canal como o site escrever ('WhatsApp', 'Agente virtual', 'E-mail') -> canal do motor."""
    t = _simples(v)
    return APELIDOS_CANAL.get(t, t)


def _acao(a, onde: str, erros: list) -> dict | None:
    if isinstance(a, str):
        a = canal_padrao(a)
    elif isinstance(a, dict) and a.get("canal"):
        a = {**a, "canal": canal_padrao(a["canal"])}
    if isinstance(a, str) and a in TOKENS_PERSONA + (ENRIQUECIMENTO, SEM_ACAO):
        a = {"canal": a}
    if isinstance(a, str):
        if a not in CANAIS:
            erros.append(f"{onde}: canal desconhecido '{a}'")
            return None
        return a
    if not isinstance(a, dict) or a.get("canal") not in CANAIS + TOKENS_PERSONA + (ENRIQUECIMENTO, SEM_ACAO):
        erros.append(f"{onde}: ação sem canal válido {a!r}")
        return None
    modo = APELIDOS_MODO.get(_simples(a.get("modo")), _simples(a.get("modo")))
    if modo not in MODOS:
        erros.append(f"{onde}: modo '{a.get('modo')}' não reconhecido, vale como 'sempre'")
        modo = "sempre"
    filtro = {k: v for k, v in dict(a.get("contatos") or {}).items() if v not in (None, "", False, [])}
    fora = sorted(set(filtro) - set(FILTROS))
    if fora:
        erros.append(f"{onde}: filtros desconhecidos {fora} ignorados")
        filtro = {k: v for k, v in filtro.items() if k in FILTROS}
    if "status" in filtro:
        st = filtro["status"] if isinstance(filtro["status"], list) else [filtro["status"]]
        st = [str(x).upper() for x in st if str(x).upper() in STATUS]
        if st:
            filtro["status"] = st
        else:
            erros.append(f"{onde}: status do filtro ignorado (use {list(STATUS)})")
            del filtro["status"]
    numeros = a.get("numeros")
    if isinstance(numeros, str) and numeros.strip().isdigit():
        numeros = int(numeros)
    elif isinstance(numeros, str) and _simples(numeros) in ("todos", "todas"):
        numeros = 99
    if numeros not in (None, "") and (not isinstance(numeros, int) or numeros < 1):
        erros.append(f"{onde}: numeros '{numeros}' ignorado (vale a regra do canal)")
        numeros = None
    personas = a.get("personas") or []
    if not isinstance(personas, list):
        personas = [personas]
    if not all(isinstance(p, int) or str(p).isdigit() for p in personas):
        erros.append(f"{onde}: personas inválidas ignoradas (a ação vale para todos)")
        personas = []
    if a["canal"] == SEM_ACAO and not personas:
        erros.append(f"{onde}: 'sem ação' só vale na raia de uma persona (ignorado)")
        return None
    acao = {"canal": a["canal"], "modo": modo, "numeros": numeros or None, "contatos": filtro}
    if personas:
        acao["personas"] = [int(p) for p in personas]
    return acao


def _sem_repetir(acoes: list, onde: str, erros: list) -> list:
    """O mesmo canal não se repete no mesmo dia para o mesmo público (raia geral ou da persona):
    fica a 1ª vez, as outras saem com aviso."""
    vistos, saida = set(), []
    for a in acoes:
        canal = a if isinstance(a, str) else a["canal"]
        chave = (canal, tuple(sorted(a.get("personas") or [])) if isinstance(a, dict) else ())
        if chave in vistos and canal != SEM_ACAO:
            erros.append(f"{onde}: {canal} repetido no mesmo dia (fica só o 1º)")
            continue
        vistos.add(chave)
        saida.append(a)
    return saida


def validar_estrategia(definicao: dict, nome: str = "?") -> tuple[dict, list[str]]:
    """Definição do site -> (partes do playbook a sobrescrever, avisos).

    Tolerante com o que o site gravar: dia "D+3" vira 3, canal "Agente virtual" vira agente_voz, modo
    "senão" vira senao. O que não der para entender é descartado SÓ naquele ponto (com aviso); o resto
    da esteira vale."""
    erros: list[str] = []
    if not isinstance(definicao, dict):
        return {}, [f"estratégia {nome}: definição precisa ser um objeto"]
    saida: dict = {}
    for fase in FASES_PASSOS:
        if fase not in definicao:
            continue
        f = definicao[fase] or {}
        sec = {}
        if "passos" in f:
            passos = {}
            for dia, acoes in (f["passos"] or {}).items():
                digitos = "".join(c for c in str(dia) if c.isdigit())
                if not digitos:
                    erros.append(f"{nome}/{fase}: dia '{dia}' não é número (ignorado)")
                    continue
                d = int(digitos)
                if not isinstance(acoes, list) or not acoes:
                    continue
                lista = [_acao(a, f"{nome}/{fase}/dia {d}", erros) for a in acoes]
                passos[str(d)] = _sem_repetir([a for a in lista if a is not None], f"{nome}/{fase}/dia {d}", erros)
            sec["passos"] = passos
        for k in NUMEROS_FASE[fase]:
            if isinstance(f.get(k), str) and f[k].strip().isdigit():
                f = {**f, k: int(f[k])}
            if f.get(k) not in (None, ""):
                if not isinstance(f[k], int) or f[k] < 1:
                    erros.append(f"{nome}/{fase}: {k} deve ser inteiro ≥ 1")
                else:
                    sec[k] = f[k]
        if fase in ("preventivo", "quebra") and "ativo" in f:
            # liga/desliga do preventivo e da quebra neste segmento (desligado: sem ação nessa fase)
            v = f["ativo"]
            sec["ativo"] = not (v is False or _simples(v) in ("false", "nao", "não", "n", "0", "off", "desligado"))
        if fase == "quebra" and f.get("carencia") not in (None, ""):
            c = f["carencia"]
            c = int(c) if isinstance(c, str) and c.strip().isdigit() else c
            if isinstance(c, int) and not isinstance(c, bool) and 0 <= c <= 60:
                sec["carencia"] = c
            else:
                erros.append(f"{nome}/quebra: carencia deve ser inteiro de 0 a 60")
        saida[fase] = sec
    if isinstance(definicao.get("whatsapp"), dict) and "so_marcados" in definicao["whatsapp"]:
        # True: WhatsApp só para número marcado com WhatsApp (carga ou bureau); False: qualquer celular
        v = definicao["whatsapp"]["so_marcados"]
        saida["whatsapp"] = {"exige_whatsapp_valido": v is True or _simples(v) in ("true", "sim", "s", "1")}
    if "prioridade_contatos" in definicao:
        pr, erro = _prioridade(definicao["prioridade_contatos"])
        if erro:
            erros.append(f"{nome}/prioridade_contatos: {erro}")
        elif pr:
            saida["prioridade_contatos"] = pr
    if "cpc" in definicao:
        c = definicao["cpc"] or {}
        ordem = [_acao(a, f"{nome}/cpc", erros) for a in (c.get("ordem") or [])]
        ordem = [a if isinstance(a, dict) else {"canal": a, "modo": "sempre", "numeros": None, "contatos": {}}
                 for a in ordem if a is not None]
        if any(a["canal"] == ENRIQUECIMENTO for a in ordem):
            erros.append(f"{nome}/cpc: enriquecimento vai nos dias da esteira, não na ordem do CPC")
        if len({a["canal"] for a in ordem}) != len(ordem):
            erros.append(f"{nome}/cpc: canal repetido na ordem de rotação")
        junto = [_acao(a, f"{nome}/cpc/junto", erros) for a in (c.get("junto") or [])]
        if any((a if isinstance(a, str) else a["canal"]) == ENRIQUECIMENTO for a in junto if a is not None):
            erros.append(f"{nome}/cpc: enriquecimento vai nos dias da esteira, não junto do CPC")
        if ordem:
            saida["ordem_rotacao"] = [a["canal"] for a in ordem]
            saida["cpc_acoes"] = {a["canal"]: {**a, "modo": "sempre"} for a in ordem}
        saida["cpc_junto"] = [({**a, "modo": "junto"} if isinstance(a, dict) else
                               {"canal": a, "modo": "junto", "numeros": None, "contatos": {}})
                              for a in junto if a is not None]
        t = c.get("tentativas_por_canal")
        if t not in (None, ""):
            if not isinstance(t, int) or t < 1:
                erros.append(f"{nome}/cpc: tentativas_por_canal deve ser inteiro ≥ 1")
            else:
                saida["tentativas_por_canal"] = t
        for k in ("intervalo_cpa", "intervalo_cpb"):   # acionar a cada N dias (1 = todo dia de lista)
            v = c.get(k)
            if isinstance(v, str) and v.strip().isdigit():
                v = int(v)
            if v in (None, ""):
                continue
            if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 30:
                erros.append(f"{nome}/cpc: {k} deve ser inteiro de 1 a 30 (dias)")
            else:
                saida[k] = v
    r = definicao.get("recencia_horas")
    if r not in (None, ""):
        if not isinstance(r, int) or r < 0:
            erros.append(f"{nome}: recencia_horas deve ser inteiro ≥ 0")
        else:
            saida["recencia_horas"] = r
    return saida, erros


def _prioridade(p) -> tuple[dict | None, str | None]:
    """Regra do usuário para ordenar (e filtrar) os telefones com o retorno do bureau:
    {"criterios": [{"campo": ranking|score|whatsapp|rcs|bureau, "sentido": asc|desc}],
     "score_minimo": número, "ranking_maximo": número}. Telefone sem score/ranking passa no
    filtro e vai depois dos que têm."""
    if not p:
        return None, None
    if not isinstance(p, dict):
        return None, "precisa ser um objeto"
    crit = []
    for c in p.get("criterios") or []:
        campo, sentido = (c or {}).get("campo"), (c or {}).get("sentido") or "desc"
        if campo not in CAMPOS_PRIORIDADE or sentido not in ("asc", "desc"):
            return None, f"critério inválido {c} (campos: {list(CAMPOS_PRIORIDADE)}; sentido asc/desc)"
        crit.append({"campo": campo, "sentido": sentido})
    saida = {"criterios": crit}
    for k in ("score_minimo", "ranking_maximo"):
        v = p.get(k)
        if v not in (None, ""):
            try:
                saida[k] = float(v)
            except (TypeError, ValueError):
                return None, f"{k} precisa ser número"
    return saida, None


def aplicar(dados: dict, override: dict) -> dict:
    """Playbook padrão + partes da estratégia (fase a fase)."""
    d = deepcopy(dados)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(d.get(k), dict) and k not in ("cpc_acoes",):
            d[k] = {**d[k], **v}
        else:
            d[k] = v
    return d


# ------------------------------------------------------------------ passo -> ações
def normalizar(passo: list, regua) -> list[dict]:
    """Itens do passo em ações. Nome de canal solto segue o playbook padrão:
    canal (sempre) → acompanhantes (junto) → substituto (senão) → acompanhantes → reserva."""
    acoes = []
    for item in passo:
        if isinstance(item, dict):
            acoes.append(item)
            continue
        if item in TOKENS_PERSONA or item in (ENRIQUECIMENTO, SEM_ACAO):
            acoes.append({"canal": item, "modo": "sempre", "numeros": None, "contatos": {}})
            continue
        acoes.append({"canal": item, "modo": "sempre", "numeros": None, "contatos": {}})
        acoes += [{"canal": e, "modo": "junto", "numeros": None, "contatos": {}}
                  for e in regua["acompanha"].get(item, [])]
        sub = regua["substituto"].get(item)
        if sub:
            acoes.append({"canal": sub, "modo": "senao", "numeros": None, "contatos": {}})
            acoes += [{"canal": e, "modo": "junto", "numeros": None, "contatos": {}}
                      for e in regua["acompanha"].get(sub, [])]
        if item in regua["reserva"]:
            acoes.append({"canal": regua["reserva"][item], "modo": "reserva", "numeros": None, "contatos": {}})
    return acoes


def raia(acoes: list[dict], persona) -> tuple[list[dict], list[dict]]:
    """Raias do dia: (ações da raia da persona do cliente, ações do público geral).

    O dia tem a raia do público geral (ações sem "personas") e, se o usuário arrastou alguma
    persona para ele, a raia dela (ações com o id em "personas"). Cliente cuja persona tem raia
    no dia recebe só a raia dela; quem não tem persona, ou cuja persona não está no dia, segue o
    público geral. A raia própria vem sem os itens 'sem ação' (raia só com eles = nada hoje)."""
    geral = [a for a in acoes if not a.get("personas")]
    if persona is None:
        return [], geral
    propria = [a for a in acoes if a.get("personas") and persona in a["personas"]]
    return propria, geral


def resolver(acoes: list[dict], contatos_da) -> list[tuple[str, str, list[str]]]:
    """Blend -> [(canal, condição, contatos)]. contatos_da(ação) devolve os contatos que passam."""
    saida, usados = [], set()
    cadeia_foi, cadeia_canal, anterior_foi = False, None, False
    for a in acoes:
        canal, modo = a["canal"], a["modo"]
        if modo == "sempre":
            cadeia_foi, cadeia_canal = False, None
        contatos = contatos_da(a) if canal not in usados else []
        foi, condicao = False, ""
        if contatos:
            if modo == "sempre":
                foi = True
            elif modo == "senao":
                foi = not cadeia_foi
            elif modo == "junto":
                foi = anterior_foi
            elif modo == "reserva":
                foi = True
                if cadeia_foi:
                    condicao = f"se {cadeia_canal} sem contato no dia"
        if foi:
            saida.append((canal, condicao, contatos))
            usados.add(canal)
            if modo != "junto" and not condicao:
                cadeia_foi, cadeia_canal = True, cadeia_canal or canal
        anterior_foi = foi
    return saida


def passa(filtro: dict, cert, sinal: dict, flag: dict) -> bool:
    """O contato passa no filtro da ação?"""
    if not filtro:
        return True
    if "status" in filtro and cert.status not in filtro["status"]:
        return False
    if filtro.get("whatsapp") and not flag.get("whatsapp_valido"):
        return False
    if filtro.get("rcs") and not sinal.get("rcs"):
        return False
    if filtro.get("pertence") and not (sinal.get("pertence") == "sim" or cert.status == "CERTIFICADO"):
        return False
    if filtro.get("sem_nao_perturbe") and sinal.get("nao_perturbe"):
        return False
    if filtro.get("score_bureau_min") not in (None, ""):
        s = sinal.get("score_bureau")
        if s is None or s < float(filtro["score_bureau_min"]):
            return False
    if filtro.get("origem") and (sinal.get("origem") or "") not in filtro["origem"]:
        return False
    return True
