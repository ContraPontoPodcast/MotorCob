"""Confere os NOMES DE COLUNA que o site usa nas tabelas e views do banco (supabase.from('tabela')...).

Coluna com nome errado não dá erro de tipo no site: o PostgREST responde "Could not find the 'x' column of 'tabela' in
the schema cache" (ou "column tabela.x does not exist") só na hora do clique, e a tela mostra a mensagem genérica.
Foi assim que "Novo contato" quebrou (o site gravava `papel`; a coluna é `papel_contrato`).

    python3 scripts/conferir_colunas.py            # migrações (supabase/migrations) contra o código
    python3 scripts/conferir_colunas.py --banco    # também confere no catálogo de um Postgres com as migrações
                                                   # aplicadas (psql com PGHOST/PGUSER/PGDATABASE do ambiente)

O que é lido (site/src e supabase/functions, TS/TSX, fora os testes), em toda corrente que começa em
`x.from('tabela')` (nome literal ou constante de texto do arquivo):
- `.select('a, b, alias:c, d::text, e->>f')`: as colunas simples (recurso embutido `rel(...)`, `*`, `count` e
  agregados ficam de fora); texto vindo de constante (`const COLS = 'a,b'`) também;
- `.insert(x)` / `.update(x)` / `.upsert(x)`: as chaves de objeto literal, de lista de objetos literais ou de variável
  local com objeto literal (`const payload = {...}`, mais `payload.k = ...` depois); `{ onConflict: 'a,b' }`;
- `.eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in/.contains/.containedBy/.overlaps/.not/.filter/.textSearch('col', …)`,
  `.order('col')` (sem `referencedTable`/`foreignTable`), `.match({col: …})` e `.or('col.eq.1,…')` (texto literal).
  Coluna com ponto (`rel.col`, filtro em recurso embutido) fica de fora.

Esquema vigente = as migrações em ordem: `create table` (o `if not exists` não muda tabela que já existe),
`alter table … add/drop/rename column`, `rename to`, `drop table`, `create [or replace] view … as select …`
(`alter view … rename`, `drop view`). View cujo select não dá para ler inteiro (`*`, expressão sem alias) fica "aberta":
o site pode usar qualquer coluna dela (o `--banco` confere de verdade, pelo catálogo).

Limites (o que NÃO é conferido): corrente que não começa em `.from('literal')` (`const t = () => sb.from('x')` e
depois `t().select(...)`), payload montado fora do arquivo ou com espalhamento de variável que não é objeto literal,
select montado com `${}`, filtros dentro de `.or()` com `${}`, colunas de recursos embutidos e de RPC (`.rpc().select`).
Chamada que o script lê errado: comentário `conferir-colunas: <motivo>` na linha do método (ou na de cima) ou na do
`.from(` (ou na de cima), que libera a corrente inteira.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conferir_rpc import (_fim_bloco, _fim_string, _objeto_ts, _partes, _tokens_sql, _variavel_ts,  # noqa: E402
                          assinaturas_migracoes)

RAIZ = Path(__file__).resolve().parent.parent
MIGRACOES = RAIZ / "supabase" / "migrations"
PASTAS_TS = ("site/src", "supabase/functions")
LIBERA = re.compile(r"conferir-colunas:\s*\S")


# ====================================================================== esquema (SQL)
@dataclass
class Relacao:
    nome: str
    colunas: set[str]
    aberta: bool = False            # colunas desconhecidas (view com * / expressão sem alias, create table as …)
    view: bool = False
    arquivo: str = ""
    calculadas: set[str] = field(default_factory=set)   # funções f(tabela) que o PostgREST expõe como coluna


_RESTRICAO = {"constraint", "primary", "unique", "check", "foreign", "exclude"}


def _nome_rel(f, i):
    """(nome, próximo índice) de [public.]nome; nome None se for de outro schema."""
    if i >= len(f) or f[i][0] != "p":
        return None, i
    a = f[i][1]
    if i + 2 < len(f) and f[i + 1] == ("x", ".") and f[i + 2][0] == "p":
        return (_ident(f[i + 2][1]) if a == "public" else None), i + 3
    return _ident(a), i + 1


def _ident(w: str) -> str:
    return w[1:-1].replace('""', '"') if w.startswith('"') else w


def _fim_comando(f, i):
    """Índice do ';' de nível zero a partir de i (ou len)."""
    prof = 0
    for j in range(i, len(f)):
        if f[j] == ("x", "("):
            prof += 1
        elif f[j] == ("x", ")"):
            prof -= 1
        elif f[j] == ("x", ";") and prof <= 0:
            return j
    return len(f)


def _grupos(f, ini, fim):
    """Divide f[ini:fim] nas vírgulas de nível zero."""
    out, atual, prof = [], [], 0
    for t in f[ini:fim]:
        if t == ("x", "("):
            prof += 1
        elif t == ("x", ")"):
            prof -= 1
        if t == ("x", ",") and prof == 0:
            out.append(atual)
            atual = []
        else:
            atual.append(t)
    if atual:
        out.append(atual)
    return out


def _fecha(f, i):
    prof = 0
    for j in range(i, len(f)):
        if f[j] == ("x", "("):
            prof += 1
        elif f[j] == ("x", ")"):
            prof -= 1
            if prof == 0:
                return j
    return len(f)


def _colunas_select(f, ini, fim) -> tuple[list[str], bool]:
    """Nomes das colunas de saída do select principal em f[ini:fim]; (nomes, aberta)."""
    prof, k = 0, None
    for j in range(ini, fim):
        if f[j] == ("x", "("):
            prof += 1
        elif f[j] == ("x", ")"):
            prof -= 1
        elif prof == 0 and f[j] == ("p", "select"):
            k = j + 1
            break
    if k is None:
        return [], True
    if k < fim and f[k] == ("p", "distinct"):
        k += 1
        if k < fim and f[k] == ("p", "on") and f[k + 1] == ("x", "("):
            k = _fecha(f, k + 1) + 1
    elif k < fim and f[k] == ("p", "all"):
        k += 1
    prof, fim_lista = 0, fim
    for j in range(k, fim):
        if f[j] == ("x", "("):
            prof += 1
        elif f[j] == ("x", ")"):
            prof -= 1
        elif prof == 0 and f[j][0] == "p" and f[j][1] in ("from", "union", "except", "intersect", "where", "into"):
            fim_lista = j
            break
    nomes, aberta = [], False
    for g in _grupos(f, k, fim_lista):
        if not g:
            continue
        if g[-1] == ("x", "*"):
            aberta = True
            continue
        if len(g) >= 2 and g[-2] == ("p", "as") and g[-1][0] == "p":
            nomes.append(_ident(g[-1][1]))
            continue
        # tira o cast final (x::text, x::numeric(10,2))
        corte = next((i for i in range(len(g) - 1) if g[i] == ("x", ":") and g[i + 1] == ("x", ":")), None)
        base = g[:corte] if corte is not None else g
        if len(base) == 1 and base[0][0] == "p":
            nomes.append(_ident(base[0][1]))
        elif len(base) == 3 and base[0][0] == "p" and base[1] == ("x", ".") and base[2][0] == "p":
            nomes.append(_ident(base[2][1]))
        elif corte is None and len(g) >= 2 and g[-1][0] == "p" and (g[-2] == ("x", ")") or g[-2][0] in ("p", "s")) \
                and g[-1][1] not in ("end", "null", "true", "false"):
            nomes.append(_ident(g[-1][1]))                           # alias sem AS: count(*) total
        else:
            aberta = True                                            # expressão sem alias: nome do Postgres
    return nomes, aberta


_DINAMICO = re.compile(r"\b(alter|create|drop)\s+(table|view)\b", re.I)


def _aplicar_sql(texto: str, arquivo: str, rels: dict[str, Relacao]) -> None:
    f = _tokens_sql(texto)
    i = 0
    while i < len(f):
        t, v = f[i]
        if t == "s":
            if _DINAMICO.search(v):
                nomes = _lista_do_laco(f, i) if "%I" in v else []
                for n in nomes:                         # foreach t in array array['a', 'b'] loop execute format('… %I …', t)
                    _aplicar_sql(v.replace("%I", n, 1), arquivo, rels)
                if not nomes:
                    _aplicar_sql(v, arquivo, rels)      # DO $$ … execute 'alter table …' $$
            i += 1
            continue
        if t != "p" or v not in ("create", "alter", "drop"):
            i += 1
            continue
        try:
            _comando(f[i:_fim_comando(f, i)], arquivo, rels)
        except IndexError:
            pass
        i += 1          # segue ficha a ficha: strings do comando (corpo de função, DO) também são lidas


def _lista_do_laco(f, i) -> list[str]:
    """Nomes do `foreach t in array array['a', 'b'] loop` mais próximo antes de f[i] (DDL com format('%I', t))."""
    for j in range(i - 1, max(0, i - 400), -1):
        if f[j] == ("p", "foreach") and f[j + 2:j + 6] == [("p", "in"), ("p", "array"), ("p", "array"), ("x", "[")]:
            nomes, k = [], j + 6
            while k < len(f) and f[k] != ("x", "]"):
                if f[k][0] == "s":
                    nomes.append(f[k][1])
                k += 1
            return nomes
    return []


def _comando(f, arquivo, rels):
    j = 1
    if f[0] == ("p", "create"):
        if f[j:j + 2] == [("p", "or"), ("p", "replace")]:
            j += 2
        while f[j][0] == "p" and f[j][1] in ("unlogged", "temp", "temporary", "global", "local", "materialized",
                                             "recursive"):
            if f[j][1] in ("temp", "temporary"):
                return
            j += 1
        if f[j] == ("p", "table"):
            j += 1
            se_nao = f[j:j + 3] == [("p", "if"), ("p", "not"), ("p", "exists")]
            if se_nao:
                j += 3
            nome, j = _nome_rel(f, j)
            if not nome or (se_nao and nome in rels):
                return
            if j < len(f) and f[j] == ("x", "("):
                k = _fecha(f, j)
                cols, aberta = [], False
                for g in _grupos(f, j + 1, k):
                    if not g or g[0][0] != "p":
                        continue
                    if g[0][1] in _RESTRICAO:
                        continue
                    if g[0][1] == "like":
                        aberta = True
                        continue
                    cols.append(_ident(g[0][1]))
                aberta = aberta or (k + 1 < len(f) and f[k + 1] == ("p", "inherits"))
                rels[nome] = Relacao(nome, set(cols), aberta, False, arquivo)
            else:
                rels[nome] = Relacao(nome, set(), True, False, arquivo)      # create table … as / partition of
            return
        if f[j] == ("p", "view"):
            j += 1
            if f[j:j + 3] == [("p", "if"), ("p", "not"), ("p", "exists")]:
                j += 3
            nome, j = _nome_rel(f, j)
            if not nome:
                return
            explicitas = None
            if f[j] == ("x", "("):
                k = _fecha(f, j)
                explicitas = [_ident(g[0][1]) for g in _grupos(f, j + 1, k) if g and g[0][0] == "p"]
                j = k + 1
            if f[j] == ("p", "with") and f[j + 1] == ("x", "("):
                j = _fecha(f, j + 1) + 1
            while j < len(f) and f[j] != ("p", "as"):
                j += 1
            nomes, aberta = _colunas_select(f, j + 1, len(f))
            if explicitas:
                # (a, b) renomeia as primeiras colunas; as outras seguem com o nome do select
                nomes = explicitas + nomes[len(explicitas):]
                aberta = aberta and len(explicitas) < len(nomes)
            aberta = aberta or ("x", "%") in f          # DDL montado com format('… %s …'): não dá para ler
            rels[nome] = Relacao(nome, set(nomes), aberta, True, arquivo)
        return
    if f[0] == ("p", "drop") and f[1][0] == "p" and f[1][1] in ("table", "view") or \
            f[0] == ("p", "drop") and f[1:3] == [("p", "materialized"), ("p", "view")]:
        j = 2 if f[1] != ("p", "materialized") else 3
        if f[j:j + 2] == [("p", "if"), ("p", "exists")]:
            j += 2
        while j < len(f):
            nome, j = _nome_rel(f, j)
            if nome:
                rels.pop(nome, None)
            if j < len(f) and f[j] == ("x", ","):
                j += 1
                continue
            break
        return
    if f[0] == ("p", "alter") and f[1][0] == "p" and f[1][1] in ("table", "view") or \
            f[0] == ("p", "alter") and f[1:3] == [("p", "materialized"), ("p", "view")]:
        j = 2 if f[1] != ("p", "materialized") else 3
        if f[j:j + 2] == [("p", "if"), ("p", "exists")]:
            j += 2
        if f[j] == ("p", "only"):
            j += 1
        nome, j = _nome_rel(f, j)
        if not nome or nome not in rels:
            return
        rel = rels[nome]
        for g in _grupos(f, j, len(f)):
            if not g:
                continue
            a = g[0][1] if g[0][0] == "p" else ""
            if a == "add":
                k = 1
                if g[k] == ("p", "column"):
                    k += 1
                elif g[k][0] == "p" and g[k][1] in _RESTRICAO:
                    continue
                if g[k:k + 3] == [("p", "if"), ("p", "not"), ("p", "exists")]:
                    k += 3
                if g[k][0] == "p":
                    rel.colunas.add(_ident(g[k][1]))
            elif a == "drop":
                k = 1
                if g[k] == ("p", "column"):
                    k += 1
                elif g[k][0] == "p" and g[k][1] in _RESTRICAO | {"default", "not"}:
                    continue
                if g[k:k + 2] == [("p", "if"), ("p", "exists")]:
                    k += 2
                if g[k][0] == "p":
                    rel.colunas.discard(_ident(g[k][1]))
            elif a == "rename":
                if g[1] == ("p", "to") and len(g) > 2:
                    novo = _ident(g[2][1])
                    rels.pop(nome)
                    rel.nome = novo
                    rels[novo] = rel
                    return
                k = 1
                if g[k] == ("p", "constraint"):
                    continue
                if g[k] == ("p", "column"):
                    k += 1
                if len(g) > k + 2 and g[k + 1] == ("p", "to"):
                    rel.colunas.discard(_ident(g[k][1]))
                    rel.colunas.add(_ident(g[k + 2][1]))


def esquema_migracoes(pasta: Path = MIGRACOES) -> dict[str, Relacao]:
    rels: dict[str, Relacao] = {}
    for arq in sorted(pasta.glob("*.sql")):
        _aplicar_sql(arq.read_text(encoding="utf-8"), arq.name, rels)
    # coluna calculada do PostgREST: função vigente com um só parâmetro do tipo da linha (prazo_resposta(chamados))
    for lista in assinaturas_migracoes(pasta).values():
        for a in lista:
            if len(a.tipos) == 1 and a.tipos[0] in rels:
                rels[a.tipos[0]].calculadas.add(a.nome)
    return rels


def esquema_banco() -> dict[str, Relacao]:
    """Tabelas e views do schema public no catálogo de um Postgres (psql do ambiente)."""
    sql = ("select c.relname, c.relkind in ('v','m'), a.attname from pg_class c "
           "join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped "
           "where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')")
    r = subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-AtF", "\t", "-c", sql],
                       capture_output=True, text=True, check=True)
    rels: dict[str, Relacao] = {}
    for linha in r.stdout.splitlines():
        nome, view, col = linha.split("\t")
        rels.setdefault(nome, Relacao(nome, set(), False, view == "t", "banco")).colunas.add(col)
    sql = ("select p.proname, c.relname from pg_proc p join pg_type t on t.oid = p.proargtypes[0] "
           "join pg_class c on c.oid = t.typrelid where p.pronamespace = 'public'::regnamespace and p.pronargs = 1 "
           "and c.relnamespace = 'public'::regnamespace")
    r = subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-AtF", "\t", "-c", sql],
                       capture_output=True, text=True, check=True)
    for linha in r.stdout.splitlines():
        funcao, rel = linha.split("\t")
        if rel in rels:
            rels[rel].calculadas.add(funcao)
    return rels


# ====================================================================== usos no site (TS/TSX)
@dataclass
class Uso:
    arquivo: str
    linha: int
    tabela: str
    metodo: str
    colunas: set[str]
    liberada: bool = False


_METODOS_COL = {"eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "likeAllOf", "likeAnyOf", "ilikeAllOf",
                "ilikeAnyOf", "is", "in", "contains", "containedBy", "overlaps", "rangeGt", "rangeGte", "rangeLt",
                "rangeLte", "rangeAdjacent", "not", "filter", "textSearch", "order"}
_FROM = re.compile(r"\.\s*from\s*\(")
_TEXTO = re.compile(r"""^(['"`])([^'"`$\\]*)\1$""")
_ID = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ID_TS = re.compile(r"^[A-Za-z_$][\w$]*$")


def _texto_ts(expr: str, s: str, ate: int, vizinhos: str = "") -> str | None:
    """Valor de um texto literal ('x', "x", `x` sem ${}) ou de uma constante de texto do arquivo."""
    expr = expr.strip()
    m = _TEXTO.match(expr)
    if m:
        return m.group(2)
    if not _ID_TS.match(expr):
        return None
    decl = None
    for d in re.finditer(r"\b(?:const|let|var)\s+" + re.escape(expr) + r"\s*(?::\s*string\s*)?=(?!=)\s*", s[:ate]):
        decl = d
    fonte = s
    if decl is None and vizinhos:
        decl = re.search(r"\bexport\s+const\s+" + re.escape(expr) + r"\s*(?::\s*string\s*)?=(?!=)\s*", vizinhos)
        fonte = vizinhos
    if decl is None:
        return None
    i = decl.end()
    if i >= len(fonte) or fonte[i] not in "'\"`":
        return None
    fim = _fim_string(fonte, i)
    m = _TEXTO.match(fonte[i:fim].replace("\n", " "))
    if not m:
        return None
    resto = fonte[fim:fim + 3].lstrip()
    if resto[:1] not in (";", "\n", "") and not fonte[fim:fim + 2].startswith("\n"):
        return None                                   # 'a' + x: não é constante simples
    return m.group(2)


def _colunas_select_ts(sel: str) -> set[str]:
    """Colunas simples de um select do PostgREST."""
    out = set()
    prof, atual, itens = 0, "", []
    for c in sel:
        if c == "(":
            prof += 1
        elif c == ")":
            prof -= 1
        if c == "," and prof == 0:
            itens.append(atual)
            atual = ""
        else:
            atual += c
    itens.append(atual)
    for it in itens:
        it = it.strip()
        if not it or "(" in it or it == "*" or it.startswith("..."):
            continue
        if ":" in it.split("::")[0]:
            it = it.split(":", 1)[1] if not it.startswith(":") else it
            it = it.lstrip(":")
        it = it.split("::")[0].split("->")[0].strip()
        if it == "count" or not _ID.match(it):
            continue
        out.add(it)
    return out


def _chaves_ts(expr: str, s: str, ate: int, base: int) -> set[str] | None:
    """Chaves de um objeto literal, de uma lista de objetos literais ou de uma variável local com objeto literal."""
    expr_l = expr.strip()
    if expr_l.startswith("{"):
        r = _objeto_ts(s, base, _fim_bloco(s, base), s, ate)
        return None if r is None else r[0] | r[1]
    if expr_l.startswith("["):
        fim = _fim_bloco(s, base)
        chaves = set()
        for a, b in _partes(s, base + 1, fim - 1):
            if not s[a:b].startswith("{"):
                return None
            r = _objeto_ts(s, a, _fim_bloco(s, a), s, ate)
            if r is None:
                return None
            chaves |= r[0] | r[1]
        return chaves
    if _ID_TS.match(expr_l):
        r = _variavel_ts(expr_l, s, ate)
        if r is not None:
            return r[0] | r[1]
        return None
    return None


def _liberada(linhas: list[str], linha: int) -> bool:
    return any(LIBERA.search(linhas[k]) for k in (linha - 1, linha - 2) if 0 <= k < len(linhas))


def usos_ts(arquivo: str, s: str, vizinhos: str = "") -> list[Uso]:
    out, linhas = [], s.split("\n")
    for m in _FROM.finditer(s):
        antes = s[max(0, m.start() - 60):m.start()].rstrip()
        if re.search(r"(storage|Array|Buffer|Object|Uint8Array|String|Promise|Set|Map)\s*!?$", antes):
            continue
        if re.search(r"\.schema\s*\([^)]*\)\s*$", antes):
            continue                                                   # outro schema
        lin_from = s.count("\n", 0, m.start()) + 1
        if linhas[lin_from - 1].lstrip().startswith(("//", "*", "/*")):
            continue
        i = m.end() - 1
        fim = _fim_bloco(s, i)
        args = _partes(s, i + 1, fim - 1)
        if len(args) != 1:
            continue
        tabela = _texto_ts(s[args[0][0]:args[0][1]], s, m.start(), vizinhos)
        if not tabela or not _ID.match(tabela):
            continue
        corrente_livre = _liberada(linhas, lin_from)
        # percorre a corrente: .metodo(args) .metodo(args) …
        j = fim
        while True:
            k = j
            while k < len(s) and (s[k].isspace() or s[k] == "!"):
                k += 1
            if k < len(s) and s.startswith("//", k):                  # comentário no meio da corrente
                nl = s.find("\n", k)
                j = len(s) if nl < 0 else nl
                continue
            mm = re.match(r"\.\s*([A-Za-z_]\w*)\s*(?:<[^()]*?>)?\s*\(", s[k:])
            if not mm:
                break
            metodo = mm.group(1)
            ab = k + mm.end() - 1
            fe = _fim_bloco(s, ab)
            margs = _partes(s, ab + 1, fe - 1)
            lin = s.count("\n", 0, k + 1) + 1
            livre = corrente_livre or _liberada(linhas, lin)
            cols: set[str] | None = None
            if metodo == "select" and margs:
                t = _texto_ts(s[margs[0][0]:margs[0][1]], s, k, vizinhos)
                cols = _colunas_select_ts(t) if t is not None else None
            elif metodo in ("insert", "update", "upsert") and margs:
                a, b = margs[0]
                cols = _chaves_ts(s[a:b], s, k, a)
                if metodo == "upsert" and len(margs) > 1:
                    mo = re.search(r"onConflict\s*:\s*(['\"`])([^'\"`$]*)\1", s[margs[1][0]:margs[1][1]])
                    if mo:
                        cols = (cols or set()) | {c.strip() for c in mo.group(2).split(",") if c.strip()}
            elif metodo in _METODOS_COL and margs:
                if metodo == "order" and len(margs) > 1 and re.search(r"(referencedTable|foreignTable)",
                                                                      s[margs[1][0]:margs[1][1]]):
                    cols = None
                else:
                    t = _texto_ts(s[margs[0][0]:margs[0][1]], s, k, vizinhos)
                    if t is not None:
                        c = t.split("->")[0].strip()
                        cols = {c} if _ID.match(c) else None
            elif metodo == "match" and margs and s[margs[0][0]] == "{":
                r = _objeto_ts(s, margs[0][0], _fim_bloco(s, margs[0][0]), s, k)
                cols = None if r is None else r[0] | r[1]
            elif metodo == "or" and margs:
                t = _texto_ts(s[margs[0][0]:margs[0][1]], s, k, vizinhos)
                if t is not None:
                    cols = set()
                    for item in t.split(","):
                        mo = re.match(r"\s*([a-z_][a-z0-9_]*)\.(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|"
                                      r"fts|plfts|phfts|wfts|match|imatch)\.", item)
                        if mo:
                            cols.add(mo.group(1))
            if cols:
                out.append(Uso(arquivo, lin, tabela, metodo, cols, livre))
            j = fe
    return out


def todos_os_usos(raiz: Path = RAIZ) -> list[Uso]:
    out = []
    for pasta in PASTAS_TS:
        base = raiz / pasta
        if not base.is_dir():
            continue
        for arq in sorted(base.rglob("*")):
            if arq.suffix not in (".ts", ".tsx") or ".test." in arq.name or "_test." in arq.name \
                    or "node_modules" in arq.parts:
                continue
            vizinhos = "\n".join(v.read_text(encoding="utf-8") for v in sorted(arq.parent.glob("*.ts"))
                                  if v != arq and ".test." not in v.name)
            out += usos_ts(str(arq.relative_to(raiz)), arq.read_text(encoding="utf-8"), vizinhos)
    return out


# ====================================================================== conferência
def conferir(usos: list[Uso], rels: dict[str, Relacao]) -> list[str]:
    achados = []
    for u in usos:
        if u.liberada:
            continue
        onde = f"{u.arquivo}:{u.linha}"
        rel = rels.get(u.tabela)
        if rel is None:
            achados.append(f"{onde}: a tabela/view {u.tabela} não existe no banco (migrações)")
            continue
        if rel.aberta:
            continue
        faltam = sorted(u.colunas - rel.colunas - rel.calculadas)
        if faltam:
            achados.append(f"{onde}: {u.tabela}.{u.metodo}: coluna(s) {', '.join(faltam)} não existe(m) em "
                           f"{u.tabela} ({'view' if rel.view else 'tabela'}; colunas: {', '.join(sorted(rel.colunas))})")
    return list(dict.fromkeys(achados))


def diferencas(a: dict[str, Relacao], b: dict[str, Relacao], nomes: set[str]) -> list[str]:
    """Relações usadas pelo site cuja leitura das migrações difere do catálogo (prova do leitor de SQL)."""
    out = []
    for n in sorted(nomes):
        x, y = a.get(n), b.get(n)
        if x is None or y is None:
            if (x is None) != (y is None):
                out.append(f"{n}: {'só no banco' if x is None else 'só nas migrações'}")
            continue
        if x.aberta:
            continue
        if x.colunas != y.colunas or x.calculadas != y.calculadas:
            out.append(f"{n}: migrações têm a mais {sorted((x.colunas | x.calculadas) - (y.colunas | y.calculadas))}, "
                       f"a menos {sorted((y.colunas | y.calculadas) - (x.colunas | x.calculadas))}")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--banco", action="store_true", help="confere também no catálogo do Postgres (psql)")
    ap.add_argument("--raiz", type=Path, default=RAIZ, help="raiz do repositório (padrão: a deste script)")
    args = ap.parse_args(argv)
    rels = esquema_migracoes(args.raiz / "supabase" / "migrations")
    usos = todos_os_usos(args.raiz)
    achados = conferir(usos, rels)
    if args.banco:
        banco = esquema_banco()
        achados += [f"[banco] {x}" for x in conferir(usos, banco)]
        achados += [f"[leitura do SQL] {x}" for x in diferencas(rels, banco, {u.tabela for u in usos})]
    for a in achados:
        print(a)
    print(f"conferir_colunas: {len(usos)} usos, {len(rels)} tabelas/views; {len(achados)} achado(s)", file=sys.stderr)
    return 1 if achados else 0


if __name__ == "__main__":
    sys.exit(main())
