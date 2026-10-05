"""Carteira do credor: os cinco arquivos que o credor manda e o que cada um faz.

Pasta do credor (cada tipo numa pasta; o nome do arquivo não importa, a data vem do nome
— 2026-10-05 ou 20261005 — ou da modificação):
  bruto/         CARGA GERAL       a carteira toda em cobrança: substitui o estoque
  incremental/   CARGA INCREMENTAL contratos novos/atualizados: somam ao estoque
  retirada/      RETIRADA          contratos que saem da cobrança (com motivo): param na hora
  acordo/        ACORDO            o acordo formalizado, com as parcelas e vencimentos
  baixa/         BAIXA             pagamentos: parcela de acordo, quitação ou parcial

Saída em base/: a base canônica (converter_base) e parcelas.csv (acordos com o que já foi
pago), que leva o cliente a Preventivo, Acordo em dia, Quebra ou Liquidado.
Quem recebe ação (na_carga.csv) = estoque + quem tem acordo aberto (exceto se foi retirado
depois do acordo). Quitação sem acordo vira um acordo quitado ("QUITACAO") → Liquidado.
"""
import csv
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from . import normalizacao as norm
from .entrada import Entrada, LayoutArquivo, _data, _num, converter_base, data_do_arquivo, gravar_na_carga
from .identificar import Identificador
from .ingestao import LayoutInvalido

PASTAS = {"geral": "bruto", "incremental": "incremental", "retirada": "retirada", "acordo": "acordo",
          "baixa": "baixa"}
TOLERANCIA = 0.99   # pagamento ≥ 99% do valor da parcela (ou do saldo) conta como pago


def _arquivos(pasta: Path) -> list[Path]:
    if not pasta.exists():
        return []
    return sorted((p for p in pasta.iterdir() if p.is_file() and not p.name.startswith(".")),
                  key=lambda p: (data_do_arquivo(p), p.name))


def ler(arq: Path, lay: LayoutArquivo, tipo: str, rel: Counter) -> list[dict]:
    """Linhas do arquivo já com nomes do MotorCob. Data ausente = data do arquivo."""
    dia_arq = data_do_arquivo(arq)
    col = lay.colunas
    with open(arq, newline="", encoding=lay.encoding) as f:
        leitor = csv.DictReader(f, delimiter=lay.delimitador)
        nomes = leitor.fieldnames or []
        obrig = {"retirada": [], "acordo": ["parcela", "vencimento"], "baixa": ["data", "valor"]}[tipo]
        ausentes = [col[c] for c in obrig if col[c] not in nomes]
        if not any(col.get(k) in nomes for k in ("id_cliente", "id_contrato")):
            ausentes.append(col.get("id_cliente") or col.get("id_contrato"))
        if ausentes:
            raise LayoutInvalido(f"{arq.name}: colunas obrigatórias ausentes no arquivo {ausentes}")
        col = {k: v for k, v in col.items() if v in nomes}
        saida = []
        for linha in leitor:
            v = {k: (linha.get(c) or "").strip() for k, c in col.items()}
            r = {"arquivo": arq.name, "dia_arquivo": dia_arq,
                 "id_cliente": norm.id_cliente(v.get("id_cliente")) if v.get("id_cliente") else None,
                 "id_contrato": v.get("id_contrato") or ""}
            try:
                if tipo == "retirada":
                    r["data"] = _data(v["data"], lay.formato_data) if v.get("data") else dia_arq
                    bruto = v.get("motivo") or ""
                    r["motivo"] = lay.motivos.get(bruto, bruto) or "retirada"
                elif tipo == "acordo":
                    r["id_acordo"] = v.get("id_acordo") or ""
                    r["parcela"] = int(float(v["parcela"].replace(",", ".")))
                    r["vencimento"] = _data(v["vencimento"], lay.formato_data)
                    r["valor"] = _num(v.get("valor"), lay.decimal) if v.get("valor") else 0.0
                    if r["vencimento"] is None:
                        raise ValueError
                else:
                    r["data"] = _data(v["data"], lay.formato_data)
                    r["valor"] = _num(v["valor"], lay.decimal)
                    r["id_acordo"] = v.get("id_acordo") or ""
                    r["parcela"] = int(float(v["parcela"].replace(",", "."))) if v.get("parcela") else None
                    bruto = v.get("tipo") or ""
                    r["tipo"] = lay.tipos.get(bruto, bruto.lower() if bruto.lower() in
                                              ("quitacao", "parcial", "parcela") else "")
                    if r["data"] is None:
                        raise ValueError
            except (ValueError, AttributeError, KeyError):
                rel[f"{tipo}: linha com data/número inválido"] += 1
                continue
            if r["data" if tipo != "acordo" else "vencimento"] is None:
                continue
            saida.append(r)
    return saida


def checar_arquivo(arq: Path, lay: LayoutArquivo | None, tipo: str) -> list[str]:
    """Só o cabeçalho: o que falta para ler o arquivo (["layout"] = layout não configurado)."""
    if lay is None:
        return ["layout"]
    try:
        with open(arq, newline="", encoding=lay.encoding) as f:
            nomes = csv.DictReader(f, delimiter=lay.delimitador).fieldnames or []
    except (UnicodeDecodeError, csv.Error) as ex:
        return [f"arquivo ilegível ({ex.__class__.__name__})"]
    obrig = {"retirada": [], "acordo": ["parcela", "vencimento"], "baixa": ["data", "valor"]}[tipo]
    ausentes = [lay.colunas[c] for c in obrig if lay.colunas[c] not in nomes]
    if not any(lay.colunas.get(k) in nomes for k in ("id_cliente", "id_contrato") if lay.colunas.get(k)):
        ausentes.append(lay.colunas.get("id_cliente") or lay.colunas.get("id_contrato"))
    return ausentes


def _identificador(arquivos: list[tuple[Path, object]]) -> Identificador:
    """Quem está nas cargas: código, contrato e CPF/CNPJ (só essas colunas)."""
    ident = Identificador()
    for arq, lay in arquivos:
        cc, ci, cd = (lay.colunas.get(k) for k in ("id_contrato", "id_cliente", "cpf"))
        with open(arq, newline="", encoding=lay.encoding) as f:
            for linha in csv.DictReader(f, delimiter=lay.delimitador):
                ident.incluir(linha.get(ci) or "", (linha.get(cc) or "") if cc else "",
                              (linha.get(cd) or "") if cd else "")
    return ident


def montar(pasta: str | Path, entrada: Entrada) -> dict:
    """Lê as cinco pastas do credor e grava a base canônica em <pasta>/base/. Retorna o relatório."""
    pasta = Path(pasta)
    base = pasta / "base"
    arqs = {t: _arquivos(pasta / p) for t, p in PASTAS.items()}
    if not arqs["geral"] and not arqs["incremental"]:
        raise FileNotFoundError(f"nenhuma carga (geral ou incremental) em {pasta}")
    for t in ("retirada", "acordo", "baixa"):
        if arqs[t] and getattr(entrada, t) is None:
            raise LayoutInvalido(f"chegou arquivo de {t}, mas o layout de {t} não está em empresas/<slug>.json")
    lay_inc = entrada.incremental or entrada.base
    ident = _identificador([(a, entrada.base) for a in arqs["geral"]] + [(a, lay_inc) for a in arqs["incremental"]])
    avisos = Counter()
    achados = Counter()

    def cliente(r):
        idc, como = ident.resolver(r["id_cliente"] or "", r["id_contrato"])
        achados[(r["arquivo"], como)] += 1
        if idc is None:
            motivo = "cliente com o mesmo CPF/código em mais de um cadastro" if como == "ambiguo" else \
                "cliente não encontrado na carga (código, contrato e CPF)"
            avisos[f"{r['arquivo']}: {motivo}"] += 1
        return idc

    linhas = {t: [r for a in arqs[t] for r in ler(a, getattr(entrada, t), t, avisos)]
              for t in ("retirada", "acordo", "baixa")}
    retiradas = [{**r, "id_cliente": idc} for r in linhas["retirada"] if (idc := cliente(r))]

    # acordos: arquivo mais novo de um mesmo acordo substitui as parcelas dele
    acordos: dict[tuple[str, str], dict] = {}
    for r in linhas["acordo"]:
        idc = cliente(r)
        if not idc:
            continue
        ida = r["id_acordo"] or f"{idc}@{r['dia_arquivo'].isoformat()}"
        a = acordos.get((idc, ida))
        if a is None or a["dia"] != r["dia_arquivo"]:
            if a is not None and r["dia_arquivo"] < a["dia"]:
                continue
            a = acordos[(idc, ida)] = {"dia": r["dia_arquivo"], "parcelas": {}}
        a["parcelas"][r["parcela"]] = {"vencimento": r["vencimento"], "valor": r["valor"], "pago_em": None,
                                       "pago": 0.0}
    por_cliente = defaultdict(list)
    for (idc, ida), a in acordos.items():
        por_cliente[idc].append(ida)

    # baixas: primeiro as de parcela de acordo; o resto vai para o estoque (quitação/parcial)
    pagamentos = []
    rel_baixa = Counter()
    for r in sorted(linhas["baixa"], key=lambda r: r["data"]):
        idc = cliente(r)
        if not idc:
            continue
        ids = [r["id_acordo"]] if r["id_acordo"] else por_cliente.get(idc, [])
        abertos = [(idc, i) for i in ids if (idc, i) in acordos
                   and any(p["pago_em"] is None for p in acordos[(idc, i)]["parcelas"].values())]
        if r["tipo"] != "quitacao" and abertos:
            a = acordos[max(abertos, key=lambda k: acordos[k]["dia"])]
            resta = r["valor"]
            alvo = ([a["parcelas"][r["parcela"]]] if r["parcela"] in a["parcelas"] else
                    [p for _, p in sorted(a["parcelas"].items()) if p["pago_em"] is None])
            for p in alvo:
                if resta <= 0 or p["pago_em"] is not None:
                    continue
                falta = p["valor"] - p["pago"]
                usado = min(resta, falta) if falta > 0 else resta
                p["pago"] += usado
                resta -= usado
                if p["valor"] <= 0 or p["pago"] >= p["valor"] * TOLERANCIA:
                    p["pago_em"] = r["data"]
                    rel_baixa["parcelas pagas"] += 1
                if r["parcela"] in a["parcelas"]:
                    break
            continue
        pagamentos.append({"data": r["data"], "id_cliente": idc, "id_contrato": r["id_contrato"],
                           "valor": r["valor"], "tipo": r["tipo"] if r["tipo"] != "parcela" else "parcial"})

    rel = converter_base(arqs["geral"], entrada.base, base, incrementais=arqs["incremental"],
                         retiradas=retiradas, pagamentos=pagamentos, layout_incremental=entrada.incremental)
    rel["avisos"] = dict(avisos)
    # por arquivo: quantas linhas acharam o cliente e por qual chave (código, contrato, CPF...)
    rel["identificacao"] = {}
    for (arq, como), n in achados.items():
        rel["identificacao"].setdefault(arq, {})[como] = rel["identificacao"].get(arq, {}).get(como, 0) + n
    rel["parcelas_pagas"] = rel_baixa["parcelas pagas"]

    # parcelas.csv: acordos do credor + quitações sem acordo (acordo quitado → Liquidado)
    abertos_desde = {}
    if acordos or rel["quitados"] or not (base / "parcelas.csv").exists():
        with open(base / "parcelas.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(["id_cliente", "id_acordo", "parcela", "vencimento", "valor", "pago_em"])
            for (idc, ida), a in sorted(acordos.items()):
                for n, p in sorted(a["parcelas"].items()):
                    w.writerow([idc, ida, n, p["vencimento"].isoformat(), f"{p['valor']:.2f}",
                                p["pago_em"].isoformat() if p["pago_em"] else ""])
                if any(p["pago_em"] is None for p in a["parcelas"].values()):
                    abertos_desde[idc] = max(abertos_desde.get(idc, date.min), a["dia"])
            for idc, d in sorted(rel["quitados"].items()):
                if idc not in por_cliente:
                    w.writerow([idc, "QUITACAO", 1, d, "0.00", d])
    # quem recebe ação: estoque + acordo aberto (salvo se retirado depois do acordo)
    ativos = set(rel["estoque"])
    for idc, d in abertos_desde.items():
        saida = rel["saiu"].get(idc)
        if saida is None or date.fromisoformat(saida[0]) <= d:
            ativos.add(idc)
    gravar_na_carga(base, ativos)
    rel["na_carga"] = len(ativos)
    rel["acordos"] = len(acordos)
    rel["acordos_abertos"] = len(abertos_desde)
    rel["arquivos"] += [{"arquivo": a.name, "tipo": t, "data": data_do_arquivo(a).isoformat(),
                         "linhas": sum(1 for r in linhas[t] if r["arquivo"] == a.name)}
                        for t in ("retirada", "acordo", "baixa") for a in arqs[t]]
    return rel
