"""Fala por extenso em pt-BR: "R$ 1.380,00" -> "mil trezentos e oitenta reais", "05/12" -> "cinco de dezembro",
"6×" -> "seis vezes". Cópia fiel de site/src/lib/falado.ts ("Como soa no telefone" do editor do fluxo, PR5 do
redesenho). As duas leem a mesma tabela de casos (tests/dados/fala_por_extenso_casos.json), para o site e a VM
dizerem igual. PR10 (B6): na ligação, todo texto que vai ao TTS passa por como_soa (voz/provedores/montagem.py ›
para_tts), e a prévia "Ouvir" da VM também. Função pura, sem rede e sem guardar texto."""
from __future__ import annotations

import re

UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
            "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
            "oitocentos", "novecentos"]
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
         "novembro", "dezembro"]


def _feminino(t: str) -> str:
    return re.sub(r"entos\b", "entas", re.sub(r"\bdois\b", "duas", re.sub(r"\bum\b", "uma", t)))


def _ate999(n: int) -> str:
    if n < 20:
        return UNIDADES[n]
    if n < 100:
        return DEZENAS[n // 10] + (f" e {UNIDADES[n % 10]}" if n % 10 else "")
    if n == 100:
        return "cem"
    return CENTENAS[n // 100] + (f" e {_ate999(n % 100)}" if n % 100 else "")


def por_extenso(n: int, fem: bool = False) -> str:
    """Inteiro de 0 a 999.999.999 por extenso. Fora disso, os dígitos."""
    if not isinstance(n, int) or n < 0 or n > 999_999_999:
        return str(n)
    if n == 0:
        return "zero"
    mi, mil, un = n // 1_000_000, (n % 1_000_000) // 1000, n % 1000
    grupos: list[tuple[int, str]] = []
    if mi:
        grupos.append((mi, "um milhão" if mi == 1 else f"{_ate999(mi)} milhões"))
    if mil:
        t = "mil" if mil == 1 else f"{_ate999(mil)} mil"
        grupos.append((mil, _feminino(t) if fem else t))
    if un:
        grupos.append((un, _feminino(_ate999(un)) if fem else _ate999(un)))
    partes = []
    for i, (v, t) in enumerate(grupos):
        partes.append(f"e {t}" if i > 0 and i == len(grupos) - 1 and (v < 100 or v % 100 == 0) else t)
    return " ".join(partes)


def reais_por_extenso(reais: int, centavos: int = 0) -> str:
    ext = por_extenso(reais)
    r = f"{ext} {'real' if reais == 1 else 'de reais' if re.search(r'(milhão|milhões)$', ext) else 'reais'}" if reais else ""
    c = f"{por_extenso(centavos)} {'centavo' if centavos == 1 else 'centavos'}" if centavos else ""
    return f"{r} e {c}" if r and c else (r or c or "zero real")


def data_por_extenso(dia: int, mes: int, ano: int | None = None) -> str | None:
    if not (1 <= dia <= 31 and 1 <= mes <= 12):
        return None
    return f"{'primeiro' if dia == 1 else por_extenso(dia)} de {MESES[mes - 1]}" + (f" de {por_extenso(ano)}" if ano is not None else "")


_FEM_DEPOIS = re.compile(r"\s+(parcelas?|vez|vezes|horas?|prestaç(?:ão|ões)|semanas?|ofertas?|condições|condição)\b", re.I)
_L = r"[^\W\d_]"     # letra (\p{L} do site)
PADRAO = re.compile("|".join([
    r"(?P<data>(?<![\d/])(?P<dd>\d{1,2})/(?P<mm>\d{1,2})(?:/(?P<aa>\d{4}|\d{2}))?(?![\d/]))",
    r"(?P<pct>(?<!\d)(?P<pi>\d{1,3})(?:,(?P<pd>\d{1,2}))?\s?%)",
    r"(?P<rs>R\$\s?(?P<ri>\d{1,3}(?:\.\d{3})+|\d+)(?:,(?P<rc>\d{2}))?(?!\d|,\d))",
    r"(?P<vl>(?<![\d.,])(?P<vi>\d{1,3}(?:\.\d{3})+|\d+),(?P<vc>\d{2})(?!\d|%|,\d))",
    rf"(?P<hora>(?<![\d:])(?P<hh>\d{{1,2}})(?:h(?P<hm>\d{{2}})?|:(?P<hm2>\d{{2}}))(?![\d]|{_L}))",
    rf"(?P<vezes>(?<![\d.,])(?P<vn>\d{{1,3}})\s?[x×](?!{_L}|\d))",
    r"(?P<dec>(?<![\d.,])(?P<di>\d+),(?P<dd2>\d+)(?![\d%]))",
    r"(?P<num>(?<![\d.,])(?P<ni>\d{1,3}(?:\.\d{3})+|\d{1,9})(?!\d|,\d))",
]))


def _inteiro(t: str) -> int:
    return int(t.replace(".", ""))


def _decimais(t: str) -> str:
    return " ".join(UNIDADES[int(c)] for c in t) if t.startswith("0") else por_extenso(int(t))


def _falar(texto: str, aviso=None) -> str:
    def troca(m: re.Match) -> str:
        g = m.groupdict()
        orig = m.group(0)
        fem = _FEM_DEPOIS.match(texto, m.end()) is not None
        r = orig
        if g["data"]:
            ano = int(f"20{g['aa']}" if len(g["aa"]) == 2 else g["aa"]) if g["aa"] else None
            r = data_por_extenso(int(g["dd"]), int(g["mm"]), ano) or orig
        elif g["pct"]:
            r = f"{por_extenso(int(g['pi']))}{' vírgula ' + _decimais(g['pd']) if g['pd'] else ''} por cento"
        elif g["rs"]:
            r = reais_por_extenso(_inteiro(g["ri"]), int(g["rc"] or 0))
        elif g["vl"]:
            r = reais_por_extenso(_inteiro(g["vi"]), int(g["vc"]))
        elif g["hora"]:
            h, mi = int(g["hh"]), int(g["hm"] or g["hm2"] or 0)
            if h <= 23 and mi <= 59:
                r = ("uma hora" if h == 1 else "meia-noite" if h == 0 else f"{por_extenso(h, True)} horas") + \
                    (f" e {por_extenso(mi)} {'minuto' if mi == 1 else 'minutos'}" if mi else "")
        elif g["vezes"]:
            n = int(g["vn"])
            r = f"{por_extenso(n, True)} {'vez' if n == 1 else 'vezes'}"
        elif g["dec"]:
            r = f"{por_extenso(int(g['di']))} vírgula {_decimais(g['dd2'])}"
        elif g["num"]:
            r = por_extenso(_inteiro(g["ni"]), fem)
        if aviso is not None:
            aviso(orig, r)
        return r
    return PADRAO.sub(troca, texto)


def como_soa(texto: str) -> str:
    """A fala como vai ser dita, com números, valores, datas, parcelas e horas por extenso."""
    return _falar(texto)


def trechos_falados(texto: str) -> list[dict]:
    out: list[dict] = []
    _falar(texto, lambda de, para: out.append({"de": de, "para": para}) if de != para else None)
    return out
