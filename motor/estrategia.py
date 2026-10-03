"""Estratégia de acionamento: o que cada cluster faz, em que dia, por qual canal e em qual contato.

Uma estratégia (tabela `estrategias`, editada no site) sobrescreve partes do playbook
padrão (`regras/regua.json`) para os clusters que a usam:

    {
      "localizacao": {"passos": {"1": [ação, ...], "3": [...]}, "dias_sem_contato_para_ncp": 8},
      "cpc":         {"ordem": [ação, ...], "junto": [ação, ...], "tentativas_por_canal": 3},
      "giro":        {"passos": {...}, "ciclo_dias": 8, "max_ciclos": 3},
      "preventivo":  {"passos": {"3": [...], "1": [...], "0": [...]}},
      "quebra":      {"passos": {...}, "dias_para_estoque": 6},
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


def _acao(a, onde: str, erros: list) -> dict | None:
    if isinstance(a, str) and a in TOKENS_PERSONA:
        a = {"canal": a}
    if isinstance(a, str):
        if a not in CANAIS:
            erros.append(f"{onde}: canal desconhecido '{a}'")
            return None
        return a
    if not isinstance(a, dict) or a.get("canal") not in CANAIS + TOKENS_PERSONA:
        erros.append(f"{onde}: ação sem canal válido {a!r}")
        return None
    modo = a.get("modo") or "sempre"
    if modo not in MODOS:
        erros.append(f"{onde}: modo '{modo}' inválido")
        return None
    filtro = dict(a.get("contatos") or {})
    fora = sorted(set(filtro) - set(FILTROS))
    if fora:
        erros.append(f"{onde}: filtros desconhecidos {fora}")
        return None
    if "status" in filtro and (not isinstance(filtro["status"], list) or set(filtro["status"]) - set(STATUS)):
        erros.append(f"{onde}: status deve ser lista de {list(STATUS)}")
        return None
    numeros = a.get("numeros")
    if numeros not in (None, "") and (not isinstance(numeros, int) or numeros < 1):
        erros.append(f"{onde}: numeros deve ser inteiro ≥ 1")
        return None
    personas = a.get("personas") or []
    if not isinstance(personas, list) or not all(isinstance(p, int) or str(p).isdigit() for p in personas):
        erros.append(f"{onde}: personas deve ser lista de ids de persona")
        return None
    acao = {"canal": a["canal"], "modo": modo, "numeros": numeros or None, "contatos": filtro}
    if personas:
        acao["personas"] = [int(p) for p in personas]
    return acao


def validar_estrategia(definicao: dict, nome: str = "?") -> tuple[dict, list[str]]:
    """Definição do site -> (partes do playbook a sobrescrever, erros). Com erro, não sobrescreve nada."""
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
                try:
                    d = int(dia)
                except (TypeError, ValueError):
                    erros.append(f"{nome}/{fase}: dia '{dia}' não é número")
                    continue
                if not isinstance(acoes, list) or not acoes:
                    continue
                lista = [_acao(a, f"{nome}/{fase}/dia {d}", erros) for a in acoes]
                passos[str(d)] = [a for a in lista if a is not None]
            sec["passos"] = passos
        for k in NUMEROS_FASE[fase]:
            if f.get(k) not in (None, ""):
                if not isinstance(f[k], int) or f[k] < 1:
                    erros.append(f"{nome}/{fase}: {k} deve ser inteiro ≥ 1")
                else:
                    sec[k] = f[k]
        saida[fase] = sec
    if "cpc" in definicao:
        c = definicao["cpc"] or {}
        ordem = [_acao(a, f"{nome}/cpc", erros) for a in (c.get("ordem") or [])]
        ordem = [a if isinstance(a, dict) else {"canal": a, "modo": "sempre", "numeros": None, "contatos": {}}
                 for a in ordem if a is not None]
        if len({a["canal"] for a in ordem}) != len(ordem):
            erros.append(f"{nome}/cpc: canal repetido na ordem de rotação")
        junto = [_acao(a, f"{nome}/cpc/junto", erros) for a in (c.get("junto") or [])]
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
    r = definicao.get("recencia_horas")
    if r not in (None, ""):
        if not isinstance(r, int) or r < 0:
            erros.append(f"{nome}: recencia_horas deve ser inteiro ≥ 0")
        else:
            saida["recencia_horas"] = r
    return ({} if erros else saida), erros


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
        if item in TOKENS_PERSONA:
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
