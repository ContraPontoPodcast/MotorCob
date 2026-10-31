"""Validador do fluxo do agente de voz (SQL 58 · FL2). Cópia fiel de public.fluxo_voz_erros(jsonb).

O site avisa, o banco recusa e o executor (voz/fluxo.py) corta: os três usam as mesmas regras. Este módulo é
a versão em Python e é conferido contra o banco com os mesmos casos (voz/fluxo_casos.py; tests/test_voz_fluxo_validador.py
roda os casos aqui e supabase/testes/testar_rls.py roda os mesmos casos no Postgres e compara a lista de erros).

Esquema (esquema 1):
    {"esquema": 1, "blocos": [{"id": "N1", "tipo": ..., "modo": ..., "x": 0, "y": 0, "titulo": "...",
                               "repetir_max": 1..5, "params": {...}, "saidas": [{"rotulo", "para", "tipo", "quando"}]}]}

`quando` diz em que caso o executor segue a saída (o `rotulo` é só o texto da tela). Cada tipo tem a sua lista.

Erros devolvidos como texto "codigo" ou "codigo:ID", em ordem e sem repetição (a mesma ordem do banco: sorted()).
Erros de contexto (conector ativo, alçada da carteira, intenção do catálogo) ficam em `pendencias()`, a cópia
de public.fluxo_voz_pendencias(), que lê o banco.

Só biblioteca padrão.
"""
from __future__ import annotations

import re

ESQUEMA = 1
MAX_BLOCOS = 60
FALA_MAX = 500
OBJETIVO_MIN, OBJETIVO_MAX = 20, 20000
MAX_TURNOS_GLOBAL = 40          # voz/provedores/montagem.py › ConfigMontagem.max_turnos

# public.variaveis_voz() (SQL 56 + 'assessoria' no SQL 58)
VARIAVEIS_VOZ = ("primeiro_nome", "credor", "saldo", "dias_atraso", "vencimento", "link_pagamento",
                 "valor_minimo", "parcelas_max", "desconto_max", "assessoria")
# campos de oferta que o mapa de saída de um conector pode preencher e que a fala pode citar
CAMPOS_OFERTA = ("oferta.id", "oferta.parcelas", "oferta.valor_parcela", "oferta.desconto_pct", "oferta.vencimento",
                 "oferta.valor_total", "oferta.entrada")
VARIAVEIS_FALA = VARIAVEIS_VOZ + CAMPOS_OFERTA
# o que não pode aparecer antes de Confirmar identidade (valor, oferta ou credor da dívida)
VARIAVEIS_LIVRES = ("primeiro_nome", "assessoria")
VARIAVEIS_SENSIVEIS = tuple(v for v in VARIAVEIS_FALA if v not in VARIAVEIS_LIVRES)

MODOS = ("arvore", "cognicao", "generativo", "sistema")
# tipo: (modos, final, quandos fixos (None = vêm dos params), quandos obrigatórios)
TIPOS = {
    "abertura":   (("arvore",), False, ("titular", "terceiro"), ("titular", "terceiro")),
    "identidade": (("arvore", "cognicao"), False, ("confirmou", "nao_confirmou", "falhou"), ("confirmou", "nao_confirmou")),
    "pergunta":   (("arvore",), False, None, None),
    "intencao":   (("cognicao",), False, None, None),
    "generativa": (("generativo",), False, None, None),
    "oferta":     (("arvore", "cognicao"), False, ("aceitou", "quer_outra", "recusou"), ("aceitou", "recusou")),
    "retorno":    (("arvore", "cognicao"), False, ("agendou", "nao_agendou"), ("agendou",)),
    "conector":   (("sistema",), False, ("respondeu", "falhou"), ("respondeu", "falhou")),
    "registrar":  (("sistema",), False, ("registrado", "falhou"), ("registrado", "falhou")),
    "link":       (("arvore",), False, ("enviado", "falhou"), ("enviado",)),
    "condicao":   (("sistema",), False, ("sim", "nao"), ("sim", "nao")),
    "transferir": (("arvore",), True, (), ()),
    "encerrar":   (("arvore",), True, (), ()),
}
# blocos que, por si, tratam de valor, oferta ou credor da dívida
TIPOS_SENSIVEIS = ("oferta", "generativa", "registrar", "link")

FERRAMENTAS = ("apresentar_oferta", "registrar_promessa", "agendar_retorno", "consultar_base", "transferir_humano",
               "encerrar_chamada")
TONS = ("cordial", "frases_curtas", "sem_giria", "nao_pressiona", "formal")
ENTIDADES = ("data", "valor", "parcelas", "hora")
PERGUNTAS_IDENTIDADE = ("dia_mes_nascimento", "ano_nascimento", "ultimos3_documento")
ORIGENS_OFERTA = ("conector", "carteira")
REGISTROS = ("acordo_crm", "promessa_motorcx")
CANAIS_LINK = ("whatsapp_sms", "sms", "whatsapp")
CAMPOS_CONDICAO = ("ofertas_quantidade", "identidade_confirmada", "dias_atraso", "saldo", "tentativa_do_dia")
OPERADORES = ("=", "<>", "<", "<=", ">", ">=")
# regras_transferencia_validas (SQL 56): os motivos do bloco Transferir
MOTIVOS_TRANSFERENCIA = ("cpc", "pedido_humano", "ofertas_sem_acordo", "fora_alcada", "contestacao")
RESULTADOS_ENCERRAR = ("promessa", "retorno_agendado", "recusa", "recado", "cpc", "atendida_sem_cpc",
                       "identidade_confirmada")
TIPOS_SAIDA = ("normal", "devolve", "falha")

CHAVES_BLOCO = ("id", "tipo", "modo", "x", "y", "titulo", "repetir_max", "params", "saidas")
CHAVES_SAIDA = ("rotulo", "para", "tipo", "quando")
CHAVES_PARAMS = {
    "abertura": ("fala",),
    "identidade": ("fala", "pergunta", "conector_id", "tentativas"),
    "pergunta": ("fala", "opcoes", "tentativas"),
    "intencao": ("fala", "intencoes", "exemplos", "confianca_min", "tentativas", "entidades"),
    "generativa": ("objetivo", "tom", "max_turnos", "ferramentas", "contrapropostas_max"),
    "oferta": ("fala", "origem", "conector_id"),
    "retorno": ("fala", "dias_max"),
    "conector": ("conector_id", "fala_espera"),
    "registrar": ("registra", "conectores"),
    "link": ("fala", "canal", "modelo_id"),
    "condicao": ("campo", "op", "valor"),
    "transferir": ("fala", "motivo"),
    "encerrar": ("fala", "resultado", "codigo"),
}
COM_FALA = ("abertura", "identidade", "pergunta", "intencao", "oferta", "retorno", "link", "transferir", "encerrar")

RE_ID = re.compile(r"N[0-9]{1,3}")
RE_CODIGO = re.compile(r"[a-z][a-z0-9_]{1,40}")
RE_VARIAVEL = re.compile(r"\{\{([^}]*)\}\}")
RE_SENHA = re.compile(r"senha|numero do cartao|codigo de seguranca|cvv")
_BRANCOS = " \t\n\r"      # btrim do banco
# mesma troca de acentos do banco (translate), para o filtro de senha dar igual nos dois
_ACENTOS = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüç", "aaaaaeeeeiiiiooooouuuuc")


# ------------------------------------------------------------------ auxiliares de tipo (iguais ao jsonb_typeof)
def _texto(v) -> bool:
    return isinstance(v, str)


def _numero(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _inteiro(v, de: int, ate: int) -> bool:
    return _numero(v) and float(v) == int(v) and de <= v <= ate


def _codigo(v) -> bool:
    return _texto(v) and RE_CODIGO.fullmatch(v) is not None


def _lista_textos(v, maximo: int, tam_max: int) -> bool:
    return (isinstance(v, list) and len(v) <= maximo
            and all(_texto(x) and 1 <= len(x) <= tam_max for x in v))


def _id_num(i: str) -> int:
    return int(i[1:])


def variaveis(texto: str) -> list[str]:
    """Nomes entre {{ }} (sem espaços nas pontas), na ordem em que aparecem."""
    return [m.strip(_BRANCOS) for m in RE_VARIAVEL.findall(texto)]


def pede_senha(texto: str) -> bool:
    return RE_SENHA.search(texto.lower().translate(_ACENTOS)) is not None


def textos_do_bloco(b: dict) -> list[tuple[str, str]]:
    """(campo, texto) dos textos que viram fala ou orientam a IA."""
    p = b.get("params") if isinstance(b.get("params"), dict) else {}
    out = []
    for k in ("fala", "fala_espera", "objetivo"):
        if _texto(p.get(k)):
            out.append((k, p[k]))
    return out


# ------------------------------------------------------------------ params por tipo
def _params(b: dict, erros: list[str]) -> None:
    bid, tipo, p = b["id"], b["tipo"], b.get("params")
    if not isinstance(p, dict):
        erros.append(f"params_invalidos:{bid}")
        return
    ruim = any(k not in CHAVES_PARAMS[tipo] for k in p)

    if tipo in COM_FALA:
        f = p.get("fala")
        if not _texto(f) or len(f.strip(_BRANCOS)) == 0:
            ruim = True
        elif len(f) > FALA_MAX:
            erros.append(f"fala_longa:{bid}")
    if "fala_espera" in p:
        f = p["fala_espera"]
        if not _texto(f) or len(f.strip(_BRANCOS)) == 0:
            ruim = True
        elif len(f) > FALA_MAX:
            erros.append(f"fala_longa:{bid}")
    if "tentativas" in p and not _inteiro(p["tentativas"], 1, 3):
        ruim = True
    if "conector_id" in p and p["conector_id"] is not None and not _inteiro(p["conector_id"], 1, 2 ** 53):
        ruim = True

    if tipo == "identidade":
        ruim |= p.get("pergunta") not in PERGUNTAS_IDENTIDADE
    elif tipo == "pergunta":
        op = p.get("opcoes")
        if not isinstance(op, list) or not 1 <= len(op) <= 6:
            ruim = True
        else:
            cods = []
            for o in op:
                if (not isinstance(o, dict) or any(k not in ("codigo", "rotulo", "exemplos") for k in o)
                        or not _codigo(o.get("codigo")) or o.get("codigo") == "sem_resposta"
                        or not (_texto(o.get("rotulo")) and 1 <= len(o["rotulo"]) <= 60)
                        or ("exemplos" in o and not _lista_textos(o["exemplos"], 10, 120))):
                    ruim = True
                else:
                    cods.append(o["codigo"])
            ruim |= len(cods) != len(set(cods))
    elif tipo == "intencao":
        it = p.get("intencoes")
        if (not isinstance(it, list) or not 1 <= len(it) <= 12 or not all(_codigo(x) for x in it)
                or len(set(it)) != len(it) or "nao_entendido" in it):
            ruim = True
        ex = p.get("exemplos")
        if ex is not None:
            if (not isinstance(ex, dict) or not isinstance(it, list)
                    or any(k not in it or not _lista_textos(v, 10, 120) for k, v in ex.items())):
                ruim = True
        if "exemplos" in p and ex is None:
            ruim = True
        if "confianca_min" in p and not (_numero(p["confianca_min"]) and 0.5 <= p["confianca_min"] <= 0.95):
            ruim = True
        if "entidades" in p and not (isinstance(p["entidades"], list)
                                     and all(e in ENTIDADES for e in p["entidades"])):
            ruim = True
    elif tipo == "generativa":
        ob = p.get("objetivo")
        if not _texto(ob) or not OBJETIVO_MIN <= len(ob.strip(_BRANCOS)) or len(ob) > OBJETIVO_MAX:
            erros.append(f"generativo_sem_objetivo:{bid}")
        if not _inteiro(p.get("max_turnos"), 1, MAX_TURNOS_GLOBAL):
            erros.append(f"generativo_sem_limite:{bid}")
        fe = p.get("ferramentas")
        if not isinstance(fe, list) or any(f not in FERRAMENTAS for f in fe) or len(set(map(str, fe))) != len(fe):
            erros.append(f"ferramenta_invalida:{bid}")
        elif "transferir_humano" not in fe:
            erros.append(f"transferir_humano_desligado:{bid}")
        if "tom" in p and not (isinstance(p["tom"], list) and all(t in TONS for t in p["tom"])):
            ruim = True
        if "contrapropostas_max" in p and not _inteiro(p["contrapropostas_max"], 0, 5):
            ruim = True
    elif tipo == "oferta":
        ruim |= p.get("origem") not in ORIGENS_OFERTA
    elif tipo == "retorno":
        if "dias_max" in p and not _inteiro(p["dias_max"], 1, 7):
            ruim = True
    elif tipo == "registrar":
        ruim |= p.get("registra") not in REGISTROS
        cs = p.get("conectores", [])
        if not isinstance(cs, list) or len(cs) > 2 or any(c is not None and not _inteiro(c, 1, 2 ** 53) for c in cs):
            ruim = True
    elif tipo == "link":
        ruim |= p.get("canal") not in CANAIS_LINK
        if "modelo_id" in p and p["modelo_id"] is not None and not _inteiro(p["modelo_id"], 1, 2 ** 53):
            ruim = True
    elif tipo == "condicao":
        campo, op, val = p.get("campo"), p.get("op"), p.get("valor")
        if campo not in CAMPOS_CONDICAO or op not in OPERADORES:
            ruim = True
        elif campo == "identidade_confirmada":
            ruim |= not isinstance(val, bool) or op not in ("=", "<>")
        else:
            ruim |= not _numero(val)
    elif tipo == "transferir":
        ruim |= p.get("motivo") not in MOTIVOS_TRANSFERENCIA
    elif tipo == "encerrar":
        ruim |= p.get("resultado") not in RESULTADOS_ENCERRAR
        if "codigo" in p and not _codigo(p["codigo"]):
            ruim = True

    if ruim:
        erros.append(f"params_invalidos:{bid}")


def _quandos(b: dict) -> tuple[set[str], set[str]]:
    """(válidos, obrigatórios) da saída `quando` deste bloco."""
    tipo, p = b["tipo"], b.get("params") if isinstance(b.get("params"), dict) else {}
    fixos = TIPOS[tipo][2]
    if fixos is not None:
        obrig = set(TIPOS[tipo][3])
        if tipo == "identidade" and p.get("conector_id") is not None:
            obrig.add("falhou")
        return set(fixos), obrig
    if tipo == "pergunta":
        cods = {o.get("codigo") for o in p.get("opcoes", []) if isinstance(o, dict)} if isinstance(p.get("opcoes"), list) else set()
        cods = {c for c in cods if _texto(c)}
        return cods | {"sem_resposta"}, cods
    if tipo == "intencao":
        it = {x for x in p.get("intencoes", []) if _texto(x)} if isinstance(p.get("intencoes"), list) else set()
        return it | {"nao_entendido"}, it | {"nao_entendido"}
    return set(), set()     # generativa: qualquer código; pelo menos uma saída (sem_saida)


# ------------------------------------------------------------------ validador
def erros(d) -> list[str]:
    """Lista ordenada de erros. Vazia = fluxo válido (public.fluxo_voz_valido)."""
    if (not isinstance(d, dict) or any(k not in ("esquema", "blocos") for k in d) or d.get("esquema") != ESQUEMA
            or isinstance(d.get("esquema"), bool) or not isinstance(d.get("blocos"), list)):
        return ["esquema_invalido"]
    blocos = d["blocos"]
    if len(blocos) > MAX_BLOCOS:
        return ["blocos_demais"]
    out: list[str] = []

    # forma de cada bloco: sem id válido, id repetido ou tipo desconhecido não dá para seguir
    vistos: set[str] = set()
    for b in blocos:
        if not isinstance(b, dict) or not _texto(b.get("id")) or RE_ID.fullmatch(b["id"]) is None:
            out.append("id_invalido")
            continue
        if b["id"] in vistos:
            out.append(f"id_repetido:{b['id']}")
        vistos.add(b["id"])
        if b.get("tipo") not in TIPOS:
            out.append(f"tipo_invalido:{b['id']}")
    if out:
        return sorted(set(out))

    por_id = {b["id"]: b for b in blocos}
    for b in blocos:
        bid, tipo = b["id"], b["tipo"]
        modos, final = TIPOS[tipo][0], TIPOS[tipo][1]
        if (any(k not in CHAVES_BLOCO for k in b) or "params" not in b or "saidas" not in b or "modo" not in b
                or ("x" in b and not _numero(b["x"])) or ("y" in b and not _numero(b["y"]))
                or ("titulo" in b and not (_texto(b["titulo"]) and len(b["titulo"]) <= 60))
                or ("repetir_max" in b and not _inteiro(b["repetir_max"], 1, 5))):
            out.append(f"bloco_invalido:{bid}")
        if tipo == "identidade" and b.get("modo") == "generativo":
            out.append(f"identidade_generativa:{bid}")
        elif b.get("modo") not in modos:
            out.append(f"modo_incompativel:{bid}")
        _params(b, out)

        for campo, txt in textos_do_bloco(b):
            if any(v not in VARIAVEIS_FALA for v in variaveis(txt)):
                out.append(f"variavel_invalida:{bid}")
            if campo != "objetivo" and pede_senha(txt):
                out.append(f"fala_pede_senha:{bid}")

        sa = b.get("saidas")
        if not isinstance(sa, list):
            out.append(f"saida_invalida:{bid}")
            continue
        if final:
            if sa:
                out.append(f"final_com_saida:{bid}")
            continue
        if not sa:
            out.append(f"sem_saida:{bid}")
            continue
        validos, obrig = _quandos(b)
        qs = []
        for s in sa:
            if (not isinstance(s, dict) or any(k not in CHAVES_SAIDA for k in s) or any(k not in s for k in CHAVES_SAIDA)
                    or not (_texto(s["rotulo"]) and 1 <= len(s["rotulo"]) <= 60)
                    or not (_texto(s["para"]) and RE_ID.fullmatch(s["para"]))
                    or s["tipo"] not in TIPOS_SAIDA or not _codigo(s["quando"])
                    or (tipo != "generativa" and s["quando"] not in validos)
                    or (s["tipo"] == "devolve") != (tipo == "generativa")
                    or (s["tipo"] == "falha") != (s["quando"] == "falhou")):
                out.append(f"saida_invalida:{bid}")
                continue
            qs.append(s["quando"])
            if s["para"] not in por_id:
                out.append(f"saida_inexistente:{bid}")
        if len(qs) != len(set(qs)):
            out.append(f"saida_invalida:{bid}")
        if not obrig <= set(qs):
            out.append(f"saida_faltando:{bid}")

    # grafo (só com saídas bem formadas e destino existente)
    arestas: dict[str, list[tuple[str, str]]] = {i: [] for i in por_id}
    for b in blocos:
        if isinstance(b.get("saidas"), list):
            for s in b["saidas"]:
                if isinstance(s, dict) and _texto(s.get("para")) and s["para"] in por_id and _texto(s.get("quando")):
                    arestas[b["id"]].append((s["quando"], s["para"]))

    aberturas = [b["id"] for b in blocos if b["tipo"] == "abertura"]
    if not aberturas:
        out.append("abertura_ausente")
    elif len(aberturas) > 1:
        out.append("abertura_repetida")
    else:
        ini = aberturas[0]
        alc = _alcance(ini, arestas)
        for i in por_id:
            if i not in alc:
                out.append(f"inalcancavel:{i}")
        # terceiro: recado neutro fixo e encerra
        for q, p in arestas[ini]:
            if q == "terceiro":
                alvo = por_id[p]
                prm = alvo.get("params") if isinstance(alvo.get("params"), dict) else {}
                if alvo["tipo"] != "encerrar" or prm.get("resultado") != "recado":
                    out.append("terceiro_sem_recado")
        # trava: valor, oferta ou credor só depois de Confirmar identidade, em todos os caminhos
        antes = _alcance(ini, arestas, pular=lambda o, q: por_id[o]["tipo"] == "identidade" and q == "confirmou")
        for i in antes:
            if _sensivel(por_id[i]):
                out.append(f"valor_antes_identidade:{i}")

    # ciclos: cada componente com volta precisa de um bloco com repetir_max
    alcance = {i: _alcance(i, arestas, incluir_inicio=False) for i in por_id}
    feitos: set[str] = set()
    for i in sorted(por_id, key=_id_num):
        if i in feitos or i not in alcance[i]:
            continue
        comp = {j for j in alcance[i] if i in alcance[j]} | {i}
        feitos |= comp
        if not any("repetir_max" in por_id[j] for j in comp):
            out.append(f"ciclo_sem_limite:{min(comp, key=_id_num)}")

    return sorted(set(out))


def _alcance(ini: str, arestas, pular=None, incluir_inicio: bool = True) -> set[str]:
    vis: set[str] = {ini} if incluir_inicio else set()
    fila = [ini]
    while fila:
        o = fila.pop(0)
        for q, p in arestas[o]:
            if pular and pular(o, q):
                continue
            if p not in vis:
                vis.add(p)
                fila.append(p)
    return vis


def _sensivel(b: dict) -> bool:
    if b["tipo"] in TIPOS_SENSIVEIS:
        return True
    return any(v in VARIAVEIS_SENSIVEIS for _, t in textos_do_bloco(b) for v in variaveis(t))


def valido(d) -> bool:
    return not erros(d)


# erros que nem um rascunho pode ter (public.fluxo_voz_forma_ok)
ERROS_DE_FORMA = ("esquema_invalido", "blocos_demais", "id_invalido", "id_repetido", "tipo_invalido", "bloco_invalido")


def forma_ok(d) -> bool:
    return not any(e.split(":")[0] in ERROS_DE_FORMA for e in erros(d))


# ------------------------------------------------------------------ pendências de contexto (cópia de fluxo_voz_pendencias)
FINALIDADES = {
    "identidade": ("validar_cadastro",),
    "oferta": ("buscar_ofertas",),
    "registrar": ("registrar_acordo", "gerar_boleto", "gerar_link"),
}


def conectores_do_bloco(b: dict) -> list:
    """IDs de conector que o bloco usa (None = ainda não escolhido)."""
    p = b.get("params") if isinstance(b.get("params"), dict) else {}
    t = b["tipo"]
    if t == "conector":
        return [p.get("conector_id")]
    if t == "identidade" and p.get("conector_id") is not None:
        return [p["conector_id"]]
    if t == "oferta" and p.get("origem") == "conector":
        return [p.get("conector_id")]
    if t == "registrar" and p.get("registra") == "acordo_crm":
        cs = [c for c in (p.get("conectores") or []) if c is not None]
        return cs or [None]
    return []


def usa_oferta(d: dict) -> bool:
    for b in d["blocos"]:
        p = b.get("params") if isinstance(b.get("params"), dict) else {}
        if b["tipo"] == "oferta" or (b["tipo"] == "generativa" and "apresentar_oferta" in (p.get("ferramentas") or [])):
            return True
    return False


def pendencias(d: dict, conectores: dict[int, tuple[str, str]], tem_alcada: bool, intencoes: set[str]) -> list[str]:
    """Erros que dependem do banco. conectores: id → (situacao, finalidade) da empresa; intencoes: catálogo ativo.
    Só para fluxo que passa em erros()."""
    out = []
    for b in d["blocos"]:
        for c in conectores_do_bloco(b):
            info = conectores.get(c) if c is not None else None
            if info is None or info[0] != "ativo":
                out.append(f"conector_inativo:{b['id']}")
            elif b["tipo"] in FINALIDADES and info[1] not in FINALIDADES[b["tipo"]]:
                out.append(f"conector_finalidade:{b['id']}")
        if b["tipo"] == "intencao":
            if any(i not in intencoes for i in b["params"]["intencoes"]):
                out.append(f"intencao_fora_catalogo:{b['id']}")
    if usa_oferta(d) and not tem_alcada:
        out.append("sem_alcada")
    return sorted(set(out))
