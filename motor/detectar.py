"""Layout automático: o MotorCob reconhece sozinho as colunas dos arquivos da empresa.

Quando a empresa ainda não tem `empresas/<slug>.json`, cada arquivo é lido pelo cabeçalho:
nomes usuais de cobrança (CPF, CONTRATO, SALDO, VENCIMENTO, DIAS_ATRASO, TEL1, DDD, EMAIL…),
separador (; , tab |), codificação (UTF-8 ou Latin-1), formato de data e decimal pelos
valores. O que foi entendido vai para o alerta da rotina, para a empresa conferir; o que não
der para entender para a rodada com a lista das colunas encontradas (só os nomes, nunca os
valores). Com `empresas/<slug>.json` no repositório, vale ele.
"""
import csv
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from .entrada import Entrada, validar_entrada
from .ingestao import LayoutInvalido

AMOSTRA = 300
FORMATOS_DATA = ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%Y/%m/%d", "%d.%m.%Y", "%Y%m%d", "%d%m%Y")


def _n(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", "_", s).strip("_")


def ler(arq: Path):
    """(encoding, delimitador, nomes, amostra de linhas)."""
    bruto = Path(arq).read_bytes()[:400_000]
    for enc in ("utf-8-sig", "latin-1"):
        try:
            texto = bruto.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    primeira = texto.splitlines()[0] if texto else ""
    delim = max((";", ",", "\t", "|"), key=primeira.count)
    linhas = list(csv.reader(texto.splitlines()[:AMOSTRA + 1], delimiter=delim))
    nomes = [c.strip() for c in (linhas[0] if linhas else [])]
    amostra = [dict(zip(nomes, l)) for l in linhas[1:] if any(x.strip() for x in l)]
    return enc, delim, nomes, amostra


def _achar(nomes, exatos=(), contem=(), evitar=(), usados=()):
    """Primeira coluna cujo nome normalizado é um dos `exatos` (na ordem) ou contém um de `contem`."""
    norm = {c: _n(c) for c in nomes if c not in usados}
    for e in exatos:
        for c, n in norm.items():
            if n == e:
                return c
    for k in contem:
        for c, n in norm.items():
            if k in n and not any(x in n for x in evitar):
                return c
    return None


def _valores(amostra, col):
    return [(l.get(col) or "").strip() for l in amostra if (l.get(col) or "").strip()]


def _formato_data(amostra, cols):
    vals = [v.split(" ")[0].split("T")[0] for c in cols if c for v in _valores(amostra, c)][:AMOSTRA]
    if not vals:
        return "%d/%m/%Y"
    melhor, nota = "%d/%m/%Y", -1
    for f in FORMATOS_DATA:
        ok = 0
        for v in vals:
            try:
                datetime.strptime(v, f)
                ok += 1
            except ValueError:
                pass
        if ok > nota:
            melhor, nota = f, ok
    return melhor


def _decimal(amostra, cols):
    vals = [v for c in cols if c for v in _valores(amostra, c)]
    if any("," in v for v in vals):
        return ","
    if any(re.search(r"\.\d{1,2}$", v) for v in vals):
        return "."
    return ","


def _flag(amostra, col):
    vals = {_n(v) for v in _valores(amostra, col)}
    return vals <= {"S", "N", "SIM", "NAO", "1", "0", "TRUE", "FALSE", "X", "Y", "YES", "NO", ""}


def _parece_telefone(amostra, col):
    vals = _valores(amostra, col)
    if not vals:
        return True   # coluna vazia na amostra: aceita (pode vir preenchida em outras linhas)
    ok = sum(1 for v in vals if 8 <= len(re.sub(r"\D", "", v)) <= 13)
    return ok >= 0.5 * len(vals)


IDS = ("COD_CLIENTE", "CODIGO_CLIENTE", "ID_CLIENTE", "CLIENTE_ID", "CD_CLIENTE", "COD_CLI", "COD_DEVEDOR",
       "ID_DEVEDOR", "CODIGO_DEVEDOR", "CD_DEVEDOR", "MATRICULA", "ID_CONSUMIDOR", "COD_CONSUMIDOR", "CLIENTE", "ID")
CONTRATOS = ("CONTRATO", "NUM_CONTRATO", "NR_CONTRATO", "NUMERO_CONTRATO", "ID_CONTRATO", "COD_CONTRATO",
             "N_CONTRATO", "NO_CONTRATO", "NRO_CONTRATO", "CONTRATO_ID", "CD_CONTRATO", "NUMERO_DO_CONTRATO")
CPFS = ("CPF", "CPF_CNPJ", "CPFCNPJ", "CNPJ_CPF", "CNPJ", "CPF_CLIENTE", "CPF_DEVEDOR", "DOCUMENTO", "NR_DOCUMENTO",
        "NUM_DOCUMENTO", "NUMERO_DOCUMENTO", "DOC", "CPF_CNPJ_CLIENTE")
SALDOS = ("SALDO", "SALDO_DEVEDOR", "SALDO_ATUAL", "SALDO_ATUALIZADO", "SALDO_DEVEDOR_ATUAL", "VALOR_SALDO", "VL_SALDO",
          "VLR_SALDO", "VALOR_DIVIDA", "VL_DIVIDA", "VLR_DIVIDA", "VALOR_ATUALIZADO", "VALOR_EM_ABERTO",
          "VALOR_ABERTO", "VALOR_DEVIDO", "VALOR_TOTAL", "VL_TOTAL", "DIVIDA", "VALOR", "VALOR_ORIGINAL")
ATRASOS = ("DIAS_ATRASO", "ATRASO", "QTD_DIAS_ATRASO", "QT_DIAS_ATRASO", "DIAS_EM_ATRASO", "DIAS_DE_ATRASO",
           "AGING", "DIAS")
VENCS = ("VENCIMENTO", "DT_VENCIMENTO", "DATA_VENCIMENTO", "DT_VENC", "DATA_VENC", "VENC", "DT_VENCTO", "VENCTO",
         "DATA_VENCTO", "VENCIMENTO_ORIGINAL", "DT_VENCIMENTO_ORIGINAL", "PRIMEIRO_VENCIMENTO")
NAO_FONE = ("TIPO", "OPERADORA", "RANKING", "SCORE", "DDD", "POSSUI", "PERTURBE", "STATUS", "FLAG", "WHATS",
            "QTD", "DATA", "DT_", "RCS", "HOT", "CEP")


def layout_base(arq: Path, explicar: dict) -> dict:
    enc, delim, nomes, amostra = ler(arq)
    usados = set()

    def pega(campo, *a, **k):
        c = _achar(nomes, *a, usados=usados, **k)
        if c:
            usados.add(c)
            explicar[campo] = c
        return c

    cpf = pega("CPF", CPFS)
    idc = pega("ID do cliente", IDS)
    if idc is None:                      # sem código de cliente: o CPF identifica o cliente
        if cpf is None:
            raise LayoutInvalido(f"{Path(arq).name}: não achei a coluna do cliente (código ou CPF). "
                                 f"Colunas do arquivo: {nomes}")
        idc = cpf
        explicar["ID do cliente"] = f"{cpf} (o CPF)"
    contrato = pega("contrato", CONTRATOS, contem=("CONTRATO",), evitar=("TIPO", "DATA", "DT_", "QTD", "STATUS"))
    saldo = pega("saldo", SALDOS, contem=("SALDO", "VALOR", "VL_", "VLR"), evitar=("PARCELA", "PAGO", "MINIMO"))
    atraso = pega("dias de atraso", ATRASOS, contem=("ATRASO",))
    venc = None if atraso else pega("vencimento", VENCS, contem=("VENC",))
    entrada = pega("data de entrada", ("DATA_ENTRADA", "DT_ENTRADA", "DATA_CARGA", "DT_CARGA", "DATA_REMESSA"))
    falta = [n for n, c in (("saldo", saldo), ("dias de atraso ou vencimento", atraso or venc)) if not c]
    telefones, emails = [], []
    for i, c in enumerate(nomes):
        n = _n(c)
        if c in usados or not c:
            continue
        if ("EMAIL" in n or "E_MAIL" in n) and "VALID" not in n:
            emails.append(c)
            continue
        if any(k in n for k in ("TEL", "FONE", "CELULAR", "CEL", "WHATSAPP_NUMERO", "NUMERO_TELEFONE")) \
                and not any(x in n for x in NAO_FONE) and _parece_telefone(amostra, c):
            t = {"coluna": c}
            sufixo = re.sub(r"^\D*", "", n)
            ddd = next((d for d in nomes if _n(d) in (f"DDD{sufixo}", f"DDD_{sufixo}", f"DDD_TEL{sufixo}")), None) \
                if sufixo else None
            if ddd is None and i > 0 and _n(nomes[i - 1]).startswith("DDD"):
                ddd = nomes[i - 1]
            if ddd:
                t["ddd"] = ddd
            # marcas do telefone (S/N): WhatsApp, RCS, Hot — WHATS_TEL1, TEL1_WHATSAPP, WHATSAPP1…
            for marca, chaves in (("whatsapp", ("WHATS", "WPP")), ("rcs", ("RCS",)), ("hot", ("HOT", "PREFERENC"))):
                cand = [d for d in nomes if any(k in _n(d) for k in chaves) and _flag(amostra, d)
                        and (n in _n(d) or (sufixo and re.sub(r"^\D*", "", _n(d)) == sufixo))]
                if cand:
                    t[marca] = cand[0]
                    usados.add(cand[0])
            telefones.append(t)
    if not telefones and not emails:
        falta.append("telefone ou e-mail")
    if falta:
        raise LayoutInvalido(f"{Path(arq).name}: não achei {falta}. Colunas do arquivo: {nomes}")
    explicar["telefones"] = ", ".join(
        t["coluna"] + "".join(f" ({k} em {t[k]})" for k in ("ddd", "whatsapp", "rcs", "hot") if k in t)
        for t in telefones) or "-"
    if emails:
        explicar["e-mails"] = ", ".join(emails)
    colunas = {"id_cliente": idc, "saldo": saldo}
    for k, v in (("id_contrato", contrato), ("cpf", cpf), ("dias_atraso", atraso), ("vencimento", venc),
                 ("data_entrada", entrada)):
        if v:
            colunas[k] = v
    return {"arquivo": "*", "delimitador": delim, "encoding": enc,
            "formato_data": _formato_data(amostra, [venc, entrada]), "decimal": _decimal(amostra, [saldo]),
            "colunas": colunas, "telefones": telefones, "emails": emails}


# ------------------------------------------------------------------ ocorrência
def _resultado(v: str) -> str | None:
    n = _n(v)
    neg = any(x in n for x in ("NAO", "SEM", "NO_", "N_CPC", "NCPC")) or n.startswith("N_")
    if n in ("CPC", "SIM", "S", "1", "TRUE", "Y", "YES", "CPC_SIM", "CPC_A", "ALO_CPC", "CONTATO_EFETIVO") or \
            ("CPC" in n and not neg):
        return "cpc"
    if "TERCEIRO" in n or "DESCONHEC" in n or "RECADO" in n:
        return "terceiro"
    if any(x in n for x in ("INVALID", "INEXIST", "ERRADO", "NAO_EXISTE", "NAO_PERTENCE")):
        return "invalido"
    if "OPT" in n or "DESCADAST" in n or "NAO_PERTURBE" in n:
        return "opt_out"
    if n in ("N", "NAO", "0", "FALSE", "NO", "NAO_CPC", "SEM_CPC", "SEM_CONTATO", "NCPC") or ("CPC" in n and neg) or \
            any(x in n for x in ("NAO_ATEND", "CAIXA_POSTAL", "OCUPADO", "SEM_RESPOSTA", "NAO_LIDO", "ENTREGUE",
                                 "LIDO", "ENVIADO", "SEM_RETORNO", "NAO_ATENDE")):
        return "sem_contato"
    return None


def _canal(v: str) -> str | None:
    n = _n(v)
    for canal, ks in (("whatsapp", ("WHATS", "WPP", "ZAP", "WA")), ("rcs", ("RCS",)), ("sms", ("SMS",)),
                      ("email", ("EMAIL", "E_MAIL", "MAIL")),
                      ("agente_voz", ("URA", "AGENTE", "ROBO", "BOT", "IA", "VIRTUAL")),
                      ("discador", ("DISCADOR", "LIGACAO", "TELEFONE", "VOZ", "CALL", "DIALER", "HUMANO", "FONE"))):
        if any(n == k or n.startswith(k) or k in n.split("_") for k in ks):
            return canal
    return None


def layout_ocorrencia(arquivos: list[Path], id_base: str | None, explicar: dict) -> dict | None:
    if not arquivos:
        return None
    enc, delim, nomes, amostra = ler(arquivos[-1])
    usados = set()

    def pega(campo, *a, **k):
        c = _achar(nomes, *a, usados=usados, **k)
        if c:
            usados.add(c)
            explicar[campo] = c
        return c

    idc = pega("ID do cliente", ((_n(id_base),) if id_base else ()) + IDS + CPFS)
    data = pega("data", ("DATA", "DT_ACAO", "DATA_ACAO", "DT_OCORRENCIA", "DATA_OCORRENCIA", "DATA_HORA",
                         "DT_ACIONAMENTO", "DATA_ACIONAMENTO", "DT_EVENTO", "DATA_EVENTO", "DT", "DATA_ENVIO"),
                contem=("DATA", "DT_"))
    res = pega("resultado (CPC)", ("OCORRENCIA", "RESULTADO", "CPC", "STATUS", "TABULACAO", "RETORNO", "EVENTO",
                                   "COD_OCORRENCIA", "DESCRICAO_OCORRENCIA", "DESCRICAO"),
               contem=("OCORR", "RESULT", "CPC", "TABUL", "STATUS"))
    canal = pega("canal", ("CANAL", "TIPO_CANAL", "TIPO_ACAO", "MEIO", "TIPO_ACIONAMENTO"))
    falta = [n for n, c in (("ID do cliente", idc), ("data", data), ("resultado", res)) if not c]
    if falta:
        raise LayoutInvalido(f"ocorrência {Path(arquivos[-1]).name}: não achei {falta}. Colunas: {nomes}")
    valores, canais = set(), set()
    for a in arquivos:
        _, _, _, am = ler(a)
        valores |= set(_valores(am, res))
        if canal:
            canais |= set(_valores(am, canal))
    resultados = {v: r for v in sorted(valores) if (r := _resultado(v))}
    explicar["códigos de CPC"] = ", ".join(v for v, r in resultados.items() if r == "cpc") or "nenhum"
    nao = sorted(v for v in valores if v not in resultados)
    if nao:
        explicar["códigos não entendidos (ficam em quarentena)"] = ", ".join(nao[:15])
    lay = {"arquivo": "*", "delimitador": delim, "encoding": enc, "formato_data": _formato_data(amostra, [data]),
           "colunas": {"id_cliente": idc, "data": data, "resultado": res}, "resultados": resultados}
    if canal:
        lay["colunas"]["canal"] = canal
        lay["canais"] = {v: c for v in sorted(canais) if (c := _canal(v))}
    return lay


# ------------------------------------------------------------------ retirada, acordo, baixa
def layout_arquivo(arq: Path, tipo: str, id_base: str | None, contrato_base: str | None, explicar: dict) -> dict:
    enc, delim, nomes, amostra = ler(arq)
    usados = set()

    def pega(campo, *a, **k):
        c = _achar(nomes, *a, usados=usados, **k)
        if c:
            usados.add(c)
            explicar[campo] = c
        return c

    colunas = {}
    ct = pega("contrato", ((_n(contrato_base),) if contrato_base else ()) + CONTRATOS)
    idc = pega("ID do cliente", ((_n(id_base),) if id_base else ()) + IDS + CPFS)
    if ct:
        colunas["id_contrato"] = ct
    if idc:
        colunas["id_cliente"] = idc
    datas = []
    if tipo == "retirada":
        if (d := pega("data", ("DATA_RETIRADA", "DT_RETIRADA", "DATA_DEVOLUCAO", "DT_DEVOLUCAO", "DATA"),
                      contem=("DATA", "DT_"))):
            colunas["data"] = d
            datas.append(d)
        if (m := pega("motivo", ("MOTIVO", "MOTIVO_RETIRADA", "MOTIVO_DEVOLUCAO", "DESCRICAO", "STATUS"),
                      contem=("MOTIVO",))):
            colunas["motivo"] = m
    elif tipo == "acordo":
        for campo, ex, cont in (("id_acordo", ("ACORDO", "NUM_ACORDO", "ID_ACORDO", "COD_ACORDO", "NR_ACORDO",
                                               "NUMERO_ACORDO"), ("ACORDO",)),
                                ("parcela", ("PARCELA", "NUM_PARCELA", "NR_PARCELA", "N_PARCELA", "NUMERO_PARCELA",
                                             "PARC"), ()),
                                ("vencimento", VENCS, ("VENC",)),
                                ("valor", ("VALOR_PARCELA", "VL_PARCELA", "VLR_PARCELA", "VALOR"), ("VALOR", "VL"))):
            if (c := pega(campo, ex, contem=cont)):
                colunas[campo] = c
        datas = [colunas.get("vencimento")]
    else:
        for campo, ex, cont in (("data", ("DATA_PAGAMENTO", "DT_PAGAMENTO", "DATA_PGTO", "DT_PGTO", "DATA_BAIXA",
                                          "DT_BAIXA", "DATA_CREDITO", "DT_CREDITO", "DATA"), ("PAG", "BAIXA", "DATA")),
                                ("valor", ("VALOR_PAGO", "VL_PAGO", "VLR_PAGO", "VALOR_PAGAMENTO", "VALOR_BAIXA",
                                           "VALOR_RECEBIDO", "VALOR"), ("PAGO", "VALOR")),
                                ("id_acordo", ("ACORDO", "NUM_ACORDO", "ID_ACORDO", "COD_ACORDO", "NR_ACORDO"),
                                 ("ACORDO",)),
                                ("parcela", ("PARCELA", "NUM_PARCELA", "NR_PARCELA", "N_PARCELA"), ()),
                                ("tipo", ("TIPO", "TIPO_BAIXA", "TIPO_PAGAMENTO", "TIPO_PGTO"), ("TIPO",))):
            if (c := pega(campo, ex, contem=cont)):
                colunas[campo] = c
        datas = [colunas.get("data")]
    obrig = {"retirada": [], "acordo": ["parcela", "vencimento"], "baixa": ["data", "valor"]}[tipo]
    falta = [c for c in obrig if c not in colunas] + ([] if ct or idc else ["contrato ou cliente"])
    if falta:
        raise LayoutInvalido(f"{tipo} {Path(arq).name}: não achei {falta}. Colunas: {nomes}")
    lay = {"arquivo": "*", "delimitador": delim, "encoding": enc, "colunas": colunas,
           "formato_data": _formato_data(amostra, datas),
           "decimal": _decimal(amostra, [colunas.get("valor")])}
    if tipo == "baixa" and "tipo" in colunas:
        tipos = {}
        for v in set(_valores(amostra, colunas["tipo"])):
            n = _n(v)
            if any(k in n for k in ("QUIT", "TOTAL", "LIQUID", "INTEGRAL")) or n == "Q":
                tipos[v] = "quitacao"
            elif "PARCIAL" in n or n in ("P", "AMORT", "AMORTIZACAO"):
                tipos[v] = "parcial"
            elif "PARCELA" in n or "ACORDO" in n or n in ("PA", "A"):
                tipos[v] = "parcela"
        lay["tipos"] = tipos
    return lay


# ------------------------------------------------------------------ bureau
BUREAU = {"arquivo": "*", "delimitador": ";", "encoding": "utf-8-sig", "chave": {"cpf": "CPF/CNPJ"},
          "telefone": {"ddd": "DDD", "numero": "FONE", "whatsapp": "POSSUI-WHATSAPP", "rcs": "POSSUI-RCS",
                       "nao_perturbe": "NAO-PERTURBE", "score": "SCORE", "ranking": "RANKING"},
          "emails": ["EMAIL-1", "EMAIL-2", "EMAIL-3"], "pertence": {}}


def layout_bureau(arq: Path) -> dict | None:
    enc, delim, nomes, _ = ler(arq)
    if {"CPF/CNPJ", "DDD", "FONE"} <= set(nomes):
        lay = dict(BUREAU, delimitador=delim, encoding=enc)
        lay["emails"] = [e for e in BUREAU["emails"] if e in nomes]
        lay["telefone"] = {k: v for k, v in BUREAU["telefone"].items() if v in nomes}
        return lay
    return None


# ------------------------------------------------------------------ tudo junto
def _arqs(pasta: Path) -> list[Path]:
    from .entrada import data_do_arquivo
    if not pasta.exists():
        return []
    return sorted((p for p in pasta.iterdir() if p.is_file() and not p.name.startswith(".")),
                  key=lambda p: (data_do_arquivo(p), p.name))


def entrada_automatica(pasta: str | Path, nome: str = "automatico") -> tuple[Entrada, dict]:
    """Monta o layout da pasta do credor pelos arquivos que chegaram. Retorna (Entrada, explicação)."""
    pasta = Path(pasta)
    explic = {}
    cargas = _arqs(pasta / "bruto") or _arqs(pasta / "incremental")
    if not cargas:
        raise LayoutInvalido("ainda não chegou carga geral para reconhecer as colunas")
    explic["carga"] = {}
    base = layout_base(cargas[-1], explic["carga"])
    dados = {"empresa": nome, "base": base}
    inc = _arqs(pasta / "incremental")
    if inc and ler(inc[-1])[2] != ler(cargas[-1])[2]:
        explic["incremental"] = {}
        dados["incremental"] = layout_base(inc[-1], explic["incremental"])
    # os demais arquivos: o que não der para entender fica de fora (com o motivo), sem parar a carga
    oc = _arqs(pasta / "ocorrencias")
    if oc:
        explic["ocorrência"] = {}
        try:
            dados["ocorrencia"] = [layout_ocorrencia(oc, base["colunas"]["id_cliente"], explic["ocorrência"])]
        except LayoutInvalido as ex:
            explic["ocorrência"] = {"erro": str(ex)}
    for tipo in ("retirada", "acordo", "baixa"):
        erro = None
        for arq in reversed(_arqs(pasta / tipo)):      # o mais novo que der para entender
            explic[tipo] = {}
            try:
                dados[tipo] = layout_arquivo(arq, tipo, base["colunas"]["id_cliente"],
                                             base["colunas"].get("id_contrato"), explic[tipo])
                break
            except LayoutInvalido as ex:
                erro = str(ex)
        if erro and tipo not in dados:
            explic[tipo] = {"erro": erro}
    enr = _arqs(pasta / "enriquecimento")
    if enr and (b := layout_bureau(enr[-1])):
        dados["enriquecimento"] = [b]
    return validar_entrada(dados), {"layout": dados, "entendido": explic}


def frase(explic: dict) -> str:
    """Resumo para o alerta: o que foi entendido de cada arquivo."""
    partes = []
    for arquivo, campos in explic.items():
        partes.append(f"{arquivo}: " + " · ".join(f"{k} = {v}" for k, v in campos.items()))
    return "LAYOUT AUTOMÁTICO (confira): " + " | ".join(partes)
