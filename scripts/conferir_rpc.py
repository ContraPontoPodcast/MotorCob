"""Confere os argumentos de toda chamada de RPC contra a assinatura das funções do banco.

O PostgREST acha a função pelo NOME e pelos NOMES dos argumentos (o corpo JSON da chamada). Argumento com nome
errado não dá erro de tipo no site: dá "Could not find the function ... in the schema cache" só na hora do clique.
Este script lê todas as chamadas e falha se alguma não casa com nenhuma versão da função.

    python3 scripts/conferir_rpc.py            # migrações (supabase/migrations) contra o código
    python3 scripts/conferir_rpc.py --banco    # também confere no catálogo de um Postgres com as migrações
                                               # aplicadas (psql com PGHOST/PGUSER/PGDATABASE do ambiente)

O que é lido:
- site/src e supabase/functions (TS/TSX): `x.rpc('nome', {...})`, `rpc<T>('nome', {...})` (os embrulhos locais
  chamados `rpc`) e `fetch(".../rest/v1/rpc/nome", { body: JSON.stringify({...}) })`;
- Python de nuvem/, voz/, motor/, scripts/ e da raiz: `x.rpc("nome", {...})` (pela árvore sintática).

Assinatura vigente = a última de cada sobrecarga (nome + tipos) depois de todas as migrações em ordem, com os
`drop function` aplicados. Uma chamada casa com uma sobrecarga quando todo argumento enviado existe nela e todo
parâmetro sem default foi enviado (a regra do PostgREST). Mais de uma sobrecarga casando também é erro (o PostgREST
recusa a chamada ambígua).

Argumentos vindos de variável: o script procura a declaração (`const x = {...}`, `x = {...}`) e soma as chaves
atribuídas depois (`x.chave = ...`, `x["chave"] = ...`); espalhamento `...(cond ? {a} : {})` conta as chaves dos
dois lados como opcionais. O que não dá para ler (nome da função ou argumentos vindos de outro lugar) precisa de um
comentário `conferir-rpc: <motivo>` na linha da chamada ou na de cima; sem ele, é achado.
"""
from __future__ import annotations

import argparse
import ast
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MIGRACOES = RAIZ / "supabase" / "migrations"
PASTAS_TS = ("site/src", "supabase/functions")
PASTAS_PY = ("nuvem", "voz", "motor", "scripts")
LIBERA = re.compile(r"conferir-rpc:\s*\S")


# ====================================================================== assinaturas (SQL)
@dataclass
class Assinatura:
    nome: str
    tipos: tuple[str, ...]
    params: list[tuple[str | None, bool]]      # (nome, tem_default) dos parâmetros de entrada
    arquivo: str

    def nomes(self) -> set[str]:
        return {n for n, _ in self.params if n}

    def obrigatorios(self) -> set[str]:
        return {n or f"${i + 1}" for i, (n, d) in enumerate(self.params) if not d}

    def texto(self) -> str:
        return f"{self.nome}(" + ", ".join(f"{n or '?'}{' = …' if d else ''}" for n, d in self.params) + ")"


_PALAVRA = re.compile(r'[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"]|"")*"')
_DOLAR = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")
_FUNCAO_SQL = re.compile(r"\b(?:create|drop)\b", re.I)


def _tokens_sql(s: str) -> list[tuple[str, str]]:
    """Fichas do SQL: ('p', palavra minúscula ou "citada"), ('s', conteúdo de string/dólar), ('x', pontuação).
    Comentários somem; o conteúdo de string fica numa ficha só (nunca é lido como código)."""
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c.isspace():
            i += 1
        elif s.startswith("--", i):
            j = s.find("\n", i)
            i = n if j < 0 else j + 1
        elif s.startswith("/*", i):
            prof, i = 1, i + 2
            while i < n and prof:
                if s.startswith("/*", i):
                    prof, i = prof + 1, i + 2
                elif s.startswith("*/", i):
                    prof, i = prof - 1, i + 2
                else:
                    i += 1
        elif c == "'" or (c in "eE" and i + 1 < n and s[i + 1] == "'"):
            i += 2 if c != "'" else 1
            ini, buf = i, []
            while i < n:
                if s[i] == "'" and i + 1 < n and s[i + 1] == "'":
                    i += 2
                elif s[i] == "\\" and c in "eE":
                    i += 2
                elif s[i] == "'":
                    break
                else:
                    i += 1
            buf = s[ini:i].replace("''", "'")
            out.append(("s", buf))
            i += 1
        elif c == "$" and (m := _DOLAR.match(s, i)):
            fim = s.find(m.group(0), m.end())
            fim = n if fim < 0 else fim
            out.append(("s", s[m.end():fim]))
            i = fim + len(m.group(0))
        elif m := _PALAVRA.match(s, i):
            w = m.group(0)
            out.append(("p", w if w.startswith('"') else w.lower()))
            i = m.end()
        else:
            out.append(("x", c))
            i += 1
    return out


_ALIAS = {"int": "integer", "int4": "integer", "int8": "bigint", "int2": "smallint", "bool": "boolean",
          "float8": "double precision", "float4": "real", "decimal": "numeric", "varchar": "character varying",
          "timestamptz": "timestamp with time zone", "timetz": "time with time zone",
          "timestamp": "timestamp without time zone"}


def _tipo(fichas: list[tuple[str, str]]) -> str:
    """Tipo normalizado (sem precisão, sem schema público), para identificar a sobrecarga."""
    partes, prof = [], 0
    for t, v in fichas:
        if t == "x" and v == "(":
            prof += 1
        elif t == "x" and v == ")":
            prof -= 1
        elif prof == 0:
            partes.append(v)
    s = " ".join(partes).replace(" . ", ".").replace("[ ]", "[]").replace(" [", "[")
    s = re.sub(r"^public\.", "", s)
    if s.endswith("[]"):
        return _ALIAS.get(s[:-2].strip(), s[:-2].strip()) + "[]"
    if s.startswith("timestamp") and "with time zone" not in s and "without" not in s:
        return "timestamp without time zone"
    return _ALIAS.get(s, s)


_MODOS = {"in", "out", "inout", "variadic"}
_INICIO_TIPO = {"double", "character", "timestamp", "time", "bit", "interval", "national"}


def _parametros(fichas: list[tuple[str, str]]) -> list[tuple[str | None, str, bool]] | None:
    """Parâmetros de ENTRADA: (nome, tipo, tem_default). None se não der para ler."""
    grupos, atual, prof = [], [], 0
    for f in fichas:
        if f[0] == "x" and f[1] in "([":
            prof += 1
        elif f[0] == "x" and f[1] in ")]":
            prof -= 1
        if f == ("x", ",") and prof == 0:
            grupos.append(atual)
            atual = []
        else:
            atual.append(f)
    if atual:
        grupos.append(atual)
    out = []
    for g in grupos:
        modo = "in"
        if g and g[0][0] == "p" and g[0][1] in _MODOS and len(g) > 1:
            modo, g = g[0][1], g[1:]
        corte = next((i for i, f in enumerate(g) if f in (("p", "default"), ("x", "="))), len(g))
        antes, tem_default = g[:corte], corte < len(g)
        if not antes:
            return None
        nome = None
        if len(antes) > 1 and antes[0][0] == "p" and antes[0][1] not in _INICIO_TIPO \
                and antes[1] != ("x", ".") and antes[1] != ("x", "(") and antes[1] != ("x", "["):
            nome, antes = antes[0][1], antes[1:]
            if nome.startswith('"'):
                nome = nome[1:-1].replace('""', '"')
        if modo == "out":
            continue
        out.append((nome, _tipo(antes), tem_default))
    return out


def _fecha(fichas, i):
    """Índice do ')' que fecha o '(' em fichas[i]."""
    prof = 0
    for j in range(i, len(fichas)):
        if fichas[j] == ("x", "("):
            prof += 1
        elif fichas[j] == ("x", ")"):
            prof -= 1
            if prof == 0:
                return j
    return len(fichas)


def _nome_funcao(fichas, i):
    """(schema, nome, próximo índice) de um nome possivelmente qualificado."""
    if i >= len(fichas) or fichas[i][0] != "p":
        return None, None, i
    a = fichas[i][1].strip('"')
    if i + 2 < len(fichas) and fichas[i + 1] == ("x", ".") and fichas[i + 2][0] == "p":
        return a, fichas[i + 2][1].strip('"'), i + 3
    return None, a, i + 1


def _aplicar_sql(texto: str, arquivo: str, funcoes: dict[tuple[str, tuple], Assinatura]) -> None:
    """Aplica os create/drop function do texto (e dos blocos dinâmicos dentro dele) sobre `funcoes`."""
    f = _tokens_sql(texto)
    i = 0
    while i < len(f):
        t, v = f[i]
        if t == "s":
            if _FUNCAO_SQL.search(v) and re.search(r"\bfunction\b", v, re.I):
                _aplicar_sql(v, arquivo, funcoes)       # DO $$ ... execute $f$ create function ... $f$
            i += 1
            continue
        if (t, v) == ("p", "create"):
            j = i + 1
            if f[j:j + 2] == [("p", "or"), ("p", "replace")]:
                j += 2
            if j < len(f) and f[j] == ("p", "function"):
                schema, nome, k = _nome_funcao(f, j + 1)
                if nome and k < len(f) and f[k] == ("x", "("):
                    fim = _fecha(f, k)
                    ps = _parametros(f[k + 1:fim])
                    if ps is not None and schema in (None, "public"):
                        tipos = tuple(p[1] for p in ps)
                        funcoes[(nome, tipos)] = Assinatura(nome, tipos, [(p[0], p[2]) for p in ps], arquivo)
                    i = fim + 1
                    continue
        elif (t, v) == ("p", "drop") and i + 1 < len(f) and f[i + 1] == ("p", "function"):
            j = i + 2
            if f[j:j + 2] == [("p", "if"), ("p", "exists")]:
                j += 2
            while True:
                schema, nome, k = _nome_funcao(f, j)
                if not nome:
                    break
                if k < len(f) and f[k] == ("x", "("):
                    fim = _fecha(f, k)
                    ps = _parametros(f[k + 1:fim]) if fim > k + 1 else []
                    if schema in (None, "public") and ps is not None:
                        funcoes.pop((nome, tuple(p[1] for p in ps)), None)
                    k = fim + 1
                elif schema in (None, "public"):
                    for chave in [c for c in funcoes if c[0] == nome]:
                        funcoes.pop(chave)
                if k < len(f) and f[k] == ("x", ","):
                    j = k + 1
                    continue
                break
            i = j
            continue
        i += 1


def assinaturas_migracoes(pasta: Path = MIGRACOES) -> dict[str, list[Assinatura]]:
    funcoes: dict[tuple[str, tuple], Assinatura] = {}
    for arq in sorted(pasta.glob("*.sql")):
        _aplicar_sql(arq.read_text(encoding="utf-8"), arq.name, funcoes)
    por_nome: dict[str, list[Assinatura]] = {}
    for a in funcoes.values():
        por_nome.setdefault(a.nome, []).append(a)
    return por_nome


def assinaturas_banco() -> dict[str, list[Assinatura]]:
    """As funções do schema public no catálogo de um Postgres (psql do ambiente)."""
    sql = ("select p.proname, coalesce(array_to_string(p.proargnames, ',', ''), ''), "
           "coalesce(array_to_string(p.proargmodes, ','), ''), p.pronargs, p.pronargdefaults, "
           "pg_get_function_identity_arguments(p.oid) "
           "from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')")
    r = subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-AtF", "\t", "-c", sql],
                       capture_output=True, text=True, check=True)
    por_nome: dict[str, list[Assinatura]] = {}
    for linha in r.stdout.splitlines():
        nome, nomes, modos, nargs, ndef, ident = linha.split("\t")
        nomes_l = nomes.split(",") if nomes else []
        modos_l = modos.split(",") if modos else ["i"] * int(nargs)
        entrada = [(nomes_l[k] if k < len(nomes_l) and nomes_l[k] else None)
                   for k, m in enumerate(modos_l) if m in ("i", "b", "v")]
        corte = len(entrada) - int(ndef)
        params = [(n, k >= corte) for k, n in enumerate(entrada)]
        por_nome.setdefault(nome, []).append(Assinatura(nome, (ident,), params, "banco"))
    return por_nome


# ====================================================================== chamadas
@dataclass
class Chamada:
    arquivo: str
    linha: int
    funcoes: list[str] | None                 # None: nome não lido
    chaves: set[str] | None                   # None: argumentos não lidos
    opcionais: set[str] = field(default_factory=set)   # chaves que podem ir ou não (espalhamento condicional)
    liberada: bool = False
    motivo: str = ""


# ---------------------------------------------------------------- TS/TSX
def _fim_string(s: str, i: int) -> int:
    """Índice depois da string que começa em s[i] (', " ou `, com ${...} aninhado)."""
    q, i, n = s[i], i + 1, len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == q:
            return i + 1
        if q == "`" and s.startswith("${", i):
            i = _fim_bloco(s, i + 1)
            continue
        if q != "`" and c == "\n":
            return i
        i += 1
    return n


def _fim_bloco(s: str, i: int) -> int:
    """s[i] é ( [ ou {: índice depois do fechamento correspondente (pula strings e comentários)."""
    pilha, n = [], len(s)
    pares = {"(": ")", "[": "]", "{": "}"}
    while i < n:
        c = s[i]
        if c in "'\"`":
            i = _fim_string(s, i)
            continue
        if s.startswith("//", i):
            j = s.find("\n", i)
            i = n if j < 0 else j
            continue
        if s.startswith("/*", i):
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in pares:
            pilha.append(pares[c])
        elif c in ")]}":
            if pilha and pilha[-1] == c:
                pilha.pop()
            if not pilha:
                return i + 1
        i += 1
    return n


def _partes(s: str, ini: int, fim: int) -> list[tuple[int, int]]:
    """Divide s[ini:fim] nas vírgulas de nível zero: [(início, fim)] de cada parte, sem espaços nas pontas."""
    out, i, a = [], ini, ini
    while i < fim:
        c = s[i]
        if c in "'\"`":
            i = _fim_string(s, i)
            continue
        if s.startswith("//", i):
            j = s.find("\n", i)
            i = fim if j < 0 else j
            continue
        if s.startswith("/*", i):
            j = s.find("*/", i + 2)
            i = fim if j < 0 else j + 2
            continue
        if c in "([{":
            i = _fim_bloco(s, i)
            continue
        if c == ",":
            out.append((a, i))
            a = i + 1
        i += 1
    out.append((a, fim))
    limpo = []
    for x, y in out:
        while x < y and s[x].isspace():
            x += 1
        while y > x and s[y - 1].isspace():
            y -= 1
        if x < y:
            limpo.append((x, y))
    return limpo


_STR = re.compile(r"""^(['"])([A-Za-z0-9_]*)\1$""")
_CHAVE = re.compile(r"""^(?:([A-Za-z_$][\w$]*)|(['"])([^'"]*)\2)\s*(?::|\(|$)""")
_IDENT = re.compile(r"^[A-Za-z_$][\w$]*$")


def _objeto_ts(s: str, ini: int, fim: int, escopo: str, ate: int, prof: int = 0):
    """Chaves de um objeto literal em s[ini:fim] (s[ini] == '{'). Devolve (chaves, opcionais) ou None."""
    chaves, opcionais = set(), set()
    partes: list[list[int]] = []
    for a, b in _partes(s, ini + 1, fim - 1):
        # vírgula de genérico (`x as Record<string, unknown>`) não separa chave: junta com a parte anterior
        if partes and s[partes[-1][0]:partes[-1][1]].count("<") > s[partes[-1][0]:partes[-1][1]].count(">") \
                and not _CHAVE.match(s[a:b]):
            partes[-1][1] = b
        else:
            partes.append([a, b])
    for a, b in partes:
        p = s[a:b]
        if p.startswith("..."):
            alvo = p[3:].strip()
            r = _espalha_ts(alvo, escopo, ate, prof)
            if r is None:
                return None
            c, o = r
            chaves |= c
            opcionais |= o
            continue
        m = _CHAVE.match(p)
        if not m:
            return None                                   # chave calculada [x]: não dá para ler
        chaves.add(m.group(1) or m.group(3))
    return chaves, opcionais


def _espalha_ts(expr: str, escopo: str, ate: int, prof: int):
    expr = expr.strip()
    while expr.startswith("(") and _fim_bloco(expr, 0) == len(expr):
        expr = expr[1:-1].strip()
    if expr.startswith("{"):
        fim = _fim_bloco(expr, 0)
        return _objeto_ts(expr, 0, fim, escopo, ate, prof)
    # cond ? {…} : {…}  /  cond && {…}
    lados = []
    for m in re.finditer(r"[?:]\s*\(?\s*\{|&&\s*\(?\s*\{", expr):
        i = expr.index("{", m.start())
        lados.append(_objeto_ts(expr, i, _fim_bloco(expr, i), escopo, ate, prof))
    if lados and all(x is not None for x in lados):
        todas = set().union(*(c | o for c, o in lados))
        return set(), todas
    if _IDENT.match(expr) and prof < 3:
        r = _variavel_ts(expr, escopo, ate, prof + 1)
        return r
    return None


def _variavel_ts(nome: str, s: str, ate: int, prof: int = 0):
    """Chaves do objeto atribuído à variável `nome` (a declaração mais próxima antes de `ate`) mais as chaves
    atribuídas depois (`nome.x = `). None se não for um objeto literal."""
    decl = None
    for m in re.finditer(r"\b(?:const|let|var)\s+" + re.escape(nome) + r"\b[^=;]*?=(?!=)", s[:ate]):
        decl = m
    if decl is None:
        return None
    i = decl.end()
    resto = s[i:i + 200]
    pre = re.match(r"\s*(?:useMemo\s*\(\s*\(\s*\)\s*=>\s*\(?\s*)?", resto)
    i += pre.end()
    if i >= len(s) or s[i] != "{":
        return None
    fim = _fim_bloco(s, i)
    r = _objeto_ts(s, i, fim, s, ate, prof)
    if r is None:
        return None
    chaves, opcionais = r
    for m in re.finditer(r"\b" + re.escape(nome) + r"""(?:\.([A-Za-z_$][\w$]*)|\[\s*(['"])([^'"]+)\2\s*\])\s*=(?!=)""",
                         s[fim:ate]):
        chave = m.group(1) or m.group(3)
        if chave not in chaves:
            opcionais.add(chave)
    return chaves, opcionais


def _nomes_ts(expr: str, s: str, ate: int, vizinhos: str = "") -> list[str] | None:
    m = _STR.match(expr)
    if m:
        return [m.group(2)]
    if not _IDENT.match(expr):
        return None
    decl = None
    for d in re.finditer(r"\b(?:const|let|var)\s+" + re.escape(expr) + r"\s*(?::[^=]+)?=(?!=)\s*([^;\n]+)", s[:ate]):
        decl = d
    if decl is None:                      # constante exportada por um arquivo da mesma pasta (import { NOME })
        decl = re.search(r"\bexport\s+const\s+" + re.escape(expr) + r"\s*(?::[^=]+)?=(?!=)\s*([^;\n]+)", vizinhos)
    if decl is None:
        return None
    valor = decl.group(1)
    lit = re.findall(r"""(?:^|[?:])\s*(['"])([A-Za-z0-9_]+)\1""", valor.strip())
    return [x[1] for x in lit] or None


_RPC_TS = re.compile(r"(?<![\w$])rpc\s*(<)?")


def _liberada(linhas: list[str], linha: int) -> bool:
    return any(LIBERA.search(linhas[k]) for k in (linha - 1, linha - 2) if 0 <= k < len(linhas))


def chamadas_ts(arquivo: str, s: str, vizinhos: str = "") -> list[Chamada]:
    out, linhas = [], s.split("\n")
    for m in _RPC_TS.finditer(s):
        ponto = s[max(0, m.start() - 40):m.start()].rstrip().endswith(".")       # x.rpc(…) / x!.rpc(…); senão é o embrulho rpc(…)
        i = m.end()
        if m.group(1):                       # rpc<T>(…): pula o genérico
            prof = 1
            while i < len(s) and prof:
                prof += {"<": 1, ">": -1}.get(s[i], 0)
                i += 1
        while i < len(s) and s[i].isspace():
            i += 1
        if i >= len(s) or s[i] != "(":
            continue
        antes = s[max(0, m.start() - 20):m.start()]
        if not ponto and re.search(r"(function|async|def)\s*$", antes):
            continue                         # declaração do embrulho, não chamada
        fim = _fim_bloco(s, i)
        args = _partes(s, i + 1, fim - 1)
        linha = s.count("\n", 0, m.start()) + 1
        lin = linhas[linha - 1].lstrip()
        if lin.startswith("//") or lin.startswith("*") or lin.startswith("/*"):
            continue                         # comentário
        primeiro = s[args[0][0]:args[0][1]] if args else ""
        if not ponto and not _STR.match(primeiro):
            continue                         # rpc(nome, …) dentro do embrulho: é o .rpc de dentro que conta
        nomes = _nomes_ts(primeiro, s, m.start(), vizinhos)
        if len(args) < 2:
            chaves, opc = set(), set()
        else:
            a, b = args[1]
            expr = s[a:b]
            if expr.startswith("{"):
                r = _objeto_ts(s, a, _fim_bloco(s, a), s, m.start())
            elif _IDENT.match(expr):
                r = _variavel_ts(expr, s, m.start())
            else:
                r = None
            chaves, opc = r if r is not None else (None, set())
        out.append(Chamada(arquivo, linha, nomes, chaves, opc, _liberada(linhas, linha)))
    # fetch direto no PostgREST (Edge Functions): fetch(`…/rest/v1/rpc/nome`, { body: JSON.stringify({...}) })
    for m in re.finditer(r"/rest/v1/rpc/([A-Za-z0-9_]+)", s):
        linha = s.count("\n", 0, m.start()) + 1
        j = s.find("JSON.stringify(", m.end(), m.end() + 600)
        chaves, opc = None, set()
        if j >= 0:
            k = j + len("JSON.stringify(")
            if s[k] == "{":
                r = _objeto_ts(s, k, _fim_bloco(s, k), s, m.start())
                if r is not None:
                    chaves, opc = r
        out.append(Chamada(arquivo, linha, [m.group(1)], chaves, opc, _liberada(linhas, linha)))
    return out


# ---------------------------------------------------------------- Python
def _chaves_py(no: ast.AST, atribs: dict[str, list[ast.AST]], prof: int = 0, retornos=None):
    if isinstance(no, ast.Dict):
        chaves, opc = set(), set()
        for k, v in zip(no.keys, no.values):
            if k is None:                                      # **x
                r = _chaves_py(v, atribs, prof + 1, retornos) if prof < 3 else None
                if r is None:
                    return None
                chaves |= r[0]
                opc |= r[1]
            elif isinstance(k, ast.Constant) and isinstance(k.value, str):
                chaves.add(k.value)
            else:
                return None
        return chaves, opc
    if isinstance(no, ast.Call) and isinstance(no.func, ast.Name) and no.func.id == "dict" and not no.args:
        if any(k.arg is None for k in no.keywords):
            return None
        return {k.arg for k in no.keywords}, set()
    # chamada de função/método do projeto que devolve dicionário literal (ex.: r.para_rpc(empresa))
    if isinstance(no, ast.Call) and prof < 3:
        rets = retornos(no) if retornos else None
        return None if rets is None else _unir([_chaves_py(v, {}, prof + 1, retornos) for v in rets])
    if isinstance(no, ast.Name) and no.id in atribs and prof < 3:
        return _unir([_chaves_py(v, atribs, prof + 1, retornos) for v in atribs[no.id]])
    return None


def _unir(rs):
    """Várias origens possíveis do mesmo objeto: as chaves comuns vão sempre; as outras, talvez."""
    if not rs or any(r is None for r in rs):
        return None
    if len(rs) == 1:
        return rs[0]
    comuns = set.intersection(*(r[0] for r in rs))
    todas = set().union(*(r[0] | r[1] for r in rs))
    return comuns, todas - comuns


def _nomes_py(no: ast.AST, atribs: dict[str, list[ast.AST]]) -> list[str] | None:
    if isinstance(no, ast.Constant) and isinstance(no.value, str):
        return [no.value]
    if isinstance(no, ast.IfExp):
        a, b = _nomes_py(no.body, atribs), _nomes_py(no.orelse, atribs)
        return a + b if a is not None and b is not None else None
    if isinstance(no, ast.Name) and no.id in atribs:
        rs = [_nomes_py(v, atribs) for v in atribs[no.id]]
        if rs and all(r is not None for r in rs):
            return [x for r in rs for x in r]
    return None


def retornos_py(arvores: dict[str, ast.AST]) -> dict[str, dict[str, list[ast.AST] | None]]:
    """{arquivo: {função: dicionários que ela devolve}}. None quando algum retorno (fora `return None`) não é um
    dicionário literal."""
    saida: dict[str, dict[str, list[ast.AST] | None]] = {}
    for arquivo, arvore in arvores.items():
        por_nome = saida.setdefault(arquivo, {})
        for f in ast.walk(arvore):
            if isinstance(f, (ast.FunctionDef, ast.AsyncFunctionDef)):
                rets = [r.value for r in ast.walk(f) if isinstance(r, ast.Return)
                        and r.value is not None and not (isinstance(r.value, ast.Constant) and r.value.value is None)]
                ok = rets and all(isinstance(r, ast.Dict) for r in rets)
                por_nome[f.name] = rets if ok and f.name not in por_nome else None
    return saida


def _resolvedor(arquivo: str, arvore: ast.AST, retornos: dict[str, dict[str, list[ast.AST] | None]]):
    """Função (chamada -> dicionários devolvidos ou None): procura a função no módulo importado (R.medir com
    `from motor import retroalimentacao as R`), senão no próprio arquivo, senão em um único lugar do projeto."""
    modulos = {}
    for no in ast.walk(arvore):
        if isinstance(no, ast.ImportFrom) and no.module:
            for a in no.names:
                modulos[a.asname or a.name] = f"{no.module.replace('.', '/')}/{a.name}.py"
        elif isinstance(no, ast.Import):
            for a in no.names:
                modulos[a.asname or a.name.split(".")[0]] = a.name.replace(".", "/") + ".py"

    def resolver(chamada: ast.Call):
        f = chamada.func
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id in modulos:
            return retornos.get(modulos[f.value.id], {}).get(f.attr)
        nome = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
        if nome in retornos.get(arquivo, {}):
            return retornos[arquivo][nome]
        achadas = [r[nome] for r in retornos.values() if nome in r]
        return achadas[0] if len(achadas) == 1 else None
    return resolver


def chamadas_py(arquivo: str, s: str, retornos: dict[str, dict[str, list[ast.AST] | None]] | None = None
                ) -> list[Chamada]:
    try:
        arvore = ast.parse(s)
    except SyntaxError:
        return []
    resolver = _resolvedor(arquivo, arvore, retornos if retornos is not None else retornos_py({arquivo: arvore}))
    linhas = s.split("\n")
    out = []

    def atribuicoes(nos) -> dict[str, list[ast.AST]]:
        """{variável: valores atribuídos} (x = ... e x: T = ...)."""
        saida: dict[str, list[ast.AST]] = {}
        for no in nos:
            if isinstance(no, ast.Assign) and len(no.targets) == 1 and isinstance(no.targets[0], ast.Name):
                saida.setdefault(no.targets[0].id, []).append(no.value)
            elif isinstance(no, ast.AnnAssign) and isinstance(no.target, ast.Name) and no.value is not None:
                saida.setdefault(no.target.id, []).append(no.value)
        return saida

    modulo = atribuicoes(arvore.body)
    funcoes = [n for n in ast.walk(arvore) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    vistos = set()
    for f in funcoes + [arvore]:
        atribs = modulo if f is arvore else {**modulo, **atribuicoes(ast.walk(f))}   # funções de fora antes
        for no in ast.walk(f):
            if id(no) in vistos:
                continue
            if not (isinstance(no, ast.Call) and isinstance(no.func, ast.Attribute) and no.func.attr == "rpc"):
                continue
            if not no.args:
                continue
            vistos.add(id(no))
            nomes = _nomes_py(no.args[0], atribs)
            if len(no.args) < 2 and not no.keywords:
                chaves, opc = set(), set()
            else:
                alvo = no.args[1] if len(no.args) > 1 else next((k.value for k in no.keywords if k.arg == "args"),
                                                                 None)
                r = _chaves_py(alvo, atribs, 0, resolver) if alvo is not None else None
                chaves, opc = r if r is not None else (None, set())
            linha = no.lineno
            lib = any(_liberada(linhas, k) for k in range(no.lineno, (no.end_lineno or no.lineno) + 1))
            out.append(Chamada(arquivo, linha, nomes, chaves, opc, lib))
    return out


def todas_as_chamadas(raiz: Path = RAIZ) -> list[Chamada]:
    out = []
    for pasta in PASTAS_TS:
        for arq in sorted((raiz / pasta).rglob("*")):
            if arq.suffix not in (".ts", ".tsx") or ".test." in arq.name or "_test." in arq.name \
                    or "node_modules" in arq.parts:
                continue
            vizinhos = "\n".join(v.read_text(encoding="utf-8") for v in sorted(arq.parent.glob("*.ts"))
                                  if v != arq and ".test." not in v.name)
            out += chamadas_ts(str(arq.relative_to(raiz)), arq.read_text(encoding="utf-8"), vizinhos)
    arquivos_py = [p for pasta in PASTAS_PY for p in sorted((raiz / pasta).rglob("*.py"))]
    arquivos_py += sorted(raiz.glob("*.py"))
    arquivos_py = [a for a in arquivos_py if "tests" not in a.parts and not a.name.startswith("test_")]
    textos = {str(a.relative_to(raiz)): a.read_text(encoding="utf-8") for a in arquivos_py}
    arvores = {}
    for arq, texto in textos.items():
        try:
            arvores[arq] = ast.parse(texto)
        except SyntaxError:
            pass
    retornos = retornos_py(arvores)
    for arq, texto in textos.items():
        out += chamadas_py(arq, texto, retornos)
    return out


# ====================================================================== conferência
def conferir(chamadas: list[Chamada], sigs: dict[str, list[Assinatura]]) -> list[str]:
    achados = []
    for c in chamadas:
        onde = f"{c.arquivo}:{c.linha}"
        if c.funcoes is None or c.chaves is None:
            if not c.liberada:
                o_que = "o nome da função" if c.funcoes is None else "os argumentos"
                achados.append(f"{onde}: não deu para ler {o_que} da chamada; deixe literal ou explique com um "
                               f"comentário 'conferir-rpc: <motivo>'")
            if c.funcoes is None:
                continue
        for nome in c.funcoes:
            if nome not in sigs:
                achados.append(f"{onde}: a função {nome} não existe no banco (migrações)")
                continue
            if c.chaves is None:
                continue
            enviadas = c.chaves
            casam = []
            for a in sigs[nome]:
                if not (enviadas | c.opcionais) <= a.nomes():
                    continue
                if not a.obrigatorios() <= enviadas:
                    continue
                casam.append(a)
            if not casam:
                versoes = " | ".join(a.texto() for a in sigs[nome])
                env = ", ".join(sorted(enviadas)) + (" (+ opcionais: " + ", ".join(sorted(c.opcionais)) + ")"
                                                     if c.opcionais else "")
                achados.append(f"{onde}: {nome}({{{env}}}) não casa com {versoes}")
            elif len(casam) > 1:
                achados.append(f"{onde}: {nome} é ambígua para o PostgREST: " + " | ".join(a.texto() for a in casam))
    return achados


def diferencas(a: dict[str, list[Assinatura]], b: dict[str, list[Assinatura]], nomes: set[str]) -> list[str]:
    """Funções chamadas cuja leitura das migrações difere do catálogo do banco (prova do leitor de SQL)."""
    def forma(lista):
        return sorted(tuple(x.params) for x in lista)
    out = []
    for n in sorted(nomes):
        if forma(a.get(n, [])) != forma(b.get(n, [])):
            out.append(f"{n}: migrações {[x.texto() for x in a.get(n, [])]} x banco {[x.texto() for x in b.get(n, [])]}")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--banco", action="store_true", help="confere também no catálogo do Postgres (psql)")
    ap.add_argument("--raiz", type=Path, default=RAIZ, help="raiz do repositório (padrão: a deste script)")
    args = ap.parse_args(argv)
    sigs = assinaturas_migracoes(args.raiz / "supabase" / "migrations")
    chamadas = todas_as_chamadas(args.raiz)
    achados = conferir(chamadas, sigs)
    if args.banco:
        banco = assinaturas_banco()
        achados += [f"[banco] {x}" for x in conferir(chamadas, banco)]
        chamados = {n for c in chamadas for n in (c.funcoes or [])}
        achados += [f"[leitura do SQL] {x}" for x in diferencas(sigs, banco, chamados)]
    for a in achados:
        print(a)
    print(f"conferir_rpc: {len(chamadas)} chamadas, {sum(len(v) for v in sigs.values())} funções; "
          f"{len(achados)} achado(s)", file=sys.stderr)
    return 1 if achados else 0


if __name__ == "__main__":
    sys.exit(main())
