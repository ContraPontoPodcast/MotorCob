"""SQL 76 · Prévia de segmentação: paridade com o motor e permissões.

Cobre: a migração roda duas vezes; o retrato (`atributos_previa`) montado por `motor/previa.linhas` a partir de
clientes fictícios; `previa_segmentacao` conta, para cada segmento proposto NA ORDEM, exatamente quem o motor põe nele
(`cluster.carregar_regras` + `cluster.classificar`, no mesmo dia), Demais, quantos batem sem olhar a ordem,
sobreposições e a matriz "de onde vêm" (segmento de hoje → proposto); todos os operadores, números pt-BR e texto com
acento/caixa/espaço; segmento com condição inválida é ignorado com o erro (como o motor); campo sem dado no retrato.
Permissões: planejamento (editar_orquestracao) e equipe podem; operação, outra empresa e anon não; carteira de outra
empresa recusada; o site não lê a tabela; a resposta não traz nenhum id de cliente. Check de CPF no id.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_segmentos_previa.py
Só dados fictícios (empresas e76-*, e-mails @exemplo.test, ids C00001…).
"""
import json
import os
import random
import subprocess
import sys
import uuid
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
from motor import cluster as CL  # noqa: E402
from motor import previa as PREVIA  # noqa: E402
from motor.marcacao import Cliente, EstadoCliente  # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL76 = RAIZ / "supabase" / "migrations" / "20270112000001_segmentos_diarios_previa.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)   # stdin: SQL grande
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 76: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 76: " + nome + ("" if cond else f"  -> {detalhe}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def lit(x) -> str:
    return "'" + json.dumps(x, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL76)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e76-a-{T}', 'E76 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e76-b-{T}', 'E76 B {T}') returning id")
U = {}
for p in ("plan", "oper", "planb", "master"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}76-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='planejamento', empresa_id={EA} where id='{U['plan']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['oper']}'")
sv(f"update public.perfis set papel='planejamento', empresa_id={EB} where id='{U['planb']}'")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['master']}'")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'c76{T}', 'Cartões') returning id")
CB = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'b76{T}', 'Outra') returning id")
P = ("authenticated", U["plan"])

# ------------------------------------------------------------------ carteira fictícia
HOJE = date(2026, 11, 7)
rnd = random.Random(76)
PRODUTOS = ["Cartão", "cartão ", "CARTAO", "Consignado", "Veículos", "", "Pessoal"]
UFS = ["SP", "RJ", "MG", "BA", "pr", " rs "]
clientes, estados = {}, {}
for i in range(1, 1501):
    idc = f"C{i:05d}"
    attrs = {"PRODUTO": rnd.choice(PRODUTOS), "UF": rnd.choice(UFS),
             "RENDA": rnd.choice(["1.500,50", "2500", "3.200,00", "980,10", "", "abc", "12.000,00", "4500.5"]),
             "NOME_CLIENTE": f"Pessoa Ficticia {i}",          # dado pessoal: nunca vai ao retrato
             "NUM_CONTRATO": str(900000 + i),                 # código: nunca vai ao retrato
             "tem_whatsapp": rnd.choice(["sim", "não"]), "idade": str(rnd.randint(18, 90)),
             "persona": rnd.choice(["Digital", "Tradicional", "Sem persona"])}
    if rnd.random() < 0.1:
        attrs.pop("PRODUTO")
    entrada = HOJE - timedelta(days=rnd.randint(0, 200))
    clientes[idc] = Cliente(idc, entrada, round(rnd.uniform(0, 9000), 2) if rnd.random() < 0.95 else 1500.0,
                            rnd.randint(0, 200), None, rnd.randint(1, 4), attrs)
    estado = rnd.choice(["LOC"] * 8 + ["NCP", "CPA", "PRE", "BLQ", "LIQ"])
    estados[idc] = EstadoCliente(idc, entrada, "A1", rnd.choice(["A1", "A2", "B1", "JUR", "M2", "VEI"]), "2026-11",
                                 estado=estado)
ativos = {k for k in clientes if rnd.random() < 0.93}


class ReguaFake:
    """Só o que previa.linhas usa: o código atual é um segmento da empresa?"""
    def __init__(self, codigos):
        self.codigos = set(codigos)

    def _regra(self, cod):
        return cod if cod in self.codigos else None


linhas, fora = PREVIA.linhas(estados, clientes, HOJE, ReguaFake({"A1", "A2", "B1", "JUR", "VEI"}), ativos)
afirmar("retrato: nome e número de contrato ficam fora", fora == ["NOME_CLIENTE", "NUM_CONTRATO"], fora)
afirmar("retrato: nenhum valor de nome no retrato", not any("Ficticia" in json.dumps(l, ensure_ascii=False)
                                                            for l in linhas))
afirmar("retrato: só quem está na carga, fora BLQ/LIQ",
        {l["id_cliente"] for l in linhas} == {k for k, e in estados.items()
                                             if k in ativos and e.estado not in ("BLQ", "LIQ")})
universo = {l["id_cliente"] for l in linhas}
sv(f"insert into public.atributos_previa (empresa_id, credor_id, id_cliente, data_base, segmento_atual, saldo, "
   f"dias_atraso, qtd_contratos, atributos) select {EA}, {CA}, x.id_cliente, '{HOJE}', x.segmento_atual, x.saldo, "
   f"x.dias_atraso, x.qtd_contratos, x.atributos from jsonb_to_recordset({lit(linhas)}) as x(id_cliente text, "
   f"segmento_atual text, saldo numeric, dias_atraso int, qtd_contratos int, atributos jsonb)")

# ------------------------------------------------------------------ segmentos propostos (todos os operadores)
PROPOSTA = [
    {"codigo": "JUR", "nome": "Jurídico", "condicoes": [{"campo": "PRODUTO", "op": "em", "valor": ["veículos"]}]},
    {"codigo": "A1", "nome": "0 a 30", "condicoes": [{"campo": "dias_atraso", "op": "entre", "valor": [0, 30]}]},
    {"codigo": "D90B", "nome": "31–90 até 2 mil", "condicoes": [
        {"campo": "dias_atraso", "op": "entre", "valor": "31;90"}, {"campo": "saldo", "op": "<=", "valor": "2.000,00"}]},
    {"codigo": "D90A", "nome": "31–90 acima", "condicoes": [
        {"campo": "dias_atraso", "op": ">=", "valor": 31}, {"campo": "dias_atraso", "op": "<", "valor": "91"},
        {"campo": "saldo", "op": ">", "valor": 2000}]},
    {"codigo": "REN", "nome": "renda", "condicoes": [{"campo": "RENDA", "op": ">=", "valor": "1.500,5"},
                                                      {"campo": "UF", "op": "nao_em", "valor": "sp; rj"}]},
    {"codigo": "CART", "nome": "cartão", "condicoes": [{"campo": "PRODUTO", "op": "=", "valor": " CARTÃO"}]},
    {"codigo": "VAZ", "nome": "sem produto", "condicoes": [{"campo": "PRODUTO", "op": "vazio", "valor": None}]},
    {"codigo": "WA", "nome": "whatsapp", "condicoes": [{"campo": "tem_whatsapp", "op": "!=", "valor": "não"},
                                                        {"campo": "idade", "op": "<=", "valor": 40}]},
    {"codigo": "SAL", "nome": "saldo exato", "condicoes": [{"campo": "saldo", "op": "=", "valor": 1500}]},
    {"codigo": "TXT", "nome": "contém", "condicoes": [{"campo": "persona", "op": "contem", "valor": "DIGI"},
                                                       {"campo": "qtd_contratos", "op": "em", "valor": [2, "3"]}]},
    {"codigo": "ERR", "nome": "inválido", "condicoes": [{"campo": "saldo", "op": ">", "valor": "muito"}]},
    {"codigo": "FX", "nome": "faixa invertida", "condicoes": [{"campo": "saldo", "op": "entre", "valor": [10, 1]}]},
    {"codigo": "PRE", "nome": "preenchido", "condicoes": [{"campo": "UF", "op": "preenchido", "valor": None},
                                                         {"campo": "dias_atraso", "op": ">", "valor": 150}]},
]


def esperado(proposta, dia):
    """O que o motor faz: regras na ordem (inválida ignorada), 1ª que bate, senão Demais."""
    regras_validas = []
    for k, s in enumerate(proposta):
        conds, erro = CL.ler_condicoes(s["condicoes"])
        if erro is None:
            regras_validas.append((k + 1, CL.RegraCluster(s["codigo"], s["nome"], tuple(conds))))
    por, batem, de_onde, demais = Counter(), Counter(), Counter(), 0
    sobre = Counter()
    for l in linhas:
        c = clientes[l["id_cliente"]]
        bate = [pos for pos, r in regras_validas if all(CL.condicao_ok(c, dia, *x) for x in r.condicoes)]
        for p_ in bate:
            batem[p_] += 1
        for a in range(len(bate)):
            for b in bate[a + 1:]:
                sobre[(bate[a], b)] += 1
        r = CL.classificar([r for _, r in regras_validas], c, dia)
        pos = next((p_ for p_, rr in regras_validas if rr is r), None) if r else None
        assert (pos is None) == (not bate) and (pos is None or pos == bate[0])
        if pos is None:
            demais += 1
        else:
            por[pos] += 1
        de_onde[(l["segmento_atual"], pos)] += 1
    return por, batem, demais, sobre, de_onde


def previa(proposta, papel=P):
    ok, out, err = sql(f"select public.previa_segmentacao({EA}, {CA}, {lit({'segmentos': proposta})})::text", *papel)
    if not ok:
        raise RuntimeError(err[:400])
    return json.loads(out)


res = previa(PROPOSTA)
por, batem, demais, sobre, de_onde = esperado(PROPOSTA, HOJE)
afirmar("data-base = a da rotina", res["data_base"] == HOJE.isoformat(), res["data_base"])
afirmar("clientes = universo do retrato", res["clientes"] == len(universo), res["clientes"])
afirmar("paridade: 1º segmento que bate (por segmento) = cluster.classificar",
        [s["clientes"] for s in res["segmentos"]] == [por[i + 1] for i in range(len(PROPOSTA))],
        ([s["clientes"] for s in res["segmentos"]], [por[i + 1] for i in range(len(PROPOSTA))]))
afirmar("paridade: Demais", res["demais"] == demais, (res["demais"], demais))
afirmar("paridade: quantos batem sem olhar a ordem",
        [s["batem"] for s in res["segmentos"]] == [batem[i + 1] for i in range(len(PROPOSTA))])
afirmar("paridade: sobreposições", {(x["a"], x["b"]): x["clientes"] for x in res["sobreposicao"]} == dict(sobre))
afirmar("paridade: de onde vêm (hoje → proposto)",
        {(x["de"], x["para"]): x["clientes"] for x in res["de_onde"]} == dict(de_onde))
afirmar("soma = universo", sum(s["clientes"] for s in res["segmentos"]) + res["demais"] == res["clientes"])
afirmar("cada segmento de teste pega alguém (o teste exercita todos os operadores)",
        all(por[i + 1] or batem[i + 1] for i, s in enumerate(PROPOSTA) if s["codigo"] not in ("ERR", "FX")),
        [(s["codigo"], batem[i + 1]) for i, s in enumerate(PROPOSTA)])
erros = {s["codigo"]: s["erro"] for s in res["segmentos"] if s["erro"]}
afirmar("condição inválida: segmento ignorado com o erro do motor",
        set(erros) == {"ERR", "FX"} and "precisa ser número" in erros["ERR"] and "menor ou igual" in erros["FX"], erros)
afirmar("a resposta não traz nenhum id de cliente", not any(k in json.dumps(res) for k in ("C00001", "C00002", "C01500")))

# ordem muda o resultado (sobreposição resolvida pela ordem)
INV = list(reversed(PROPOSTA))
res2 = previa(INV)
por2, _, demais2, _, _ = esperado(INV, HOJE)
afirmar("paridade com a ordem invertida",
        [s["clientes"] for s in res2["segmentos"]] == [por2[i + 1] for i in range(len(INV))] and res2["demais"] == demais2)

# segmento sem condição: todos (como o motor); lista vazia: todos em Demais
res3 = previa([{"codigo": "TUDO", "nome": "todos", "condicoes": []}])
afirmar("segmento sem condição vale para todos", res3["segmentos"][0]["clientes"] == len(universo) and res3["demais"] == 0)
res4 = previa([])
afirmar("sem segmentos: todos em Demais", res4["demais"] == len(universo))

# campo que o retrato não tem (nome do cliente ficou fora; coluna inexistente)
res5 = previa([{"codigo": "X", "nome": "x", "condicoes": [{"campo": "NOME_CLIENTE", "op": "preenchido"},
                                                          {"campo": "saldo", "op": ">", "valor": 0}]},
               {"codigo": "Y", "nome": "y", "condicoes": [{"campo": "SCORE_SERASA", "op": ">", "valor": 500}]}])
afirmar("campo sem dado no retrato é avisado", res5["campos_sem_dado"] == ["NOME_CLIENTE", "SCORE_SERASA"],
        res5["campos_sem_dado"])

# carteira sem retrato ainda
CV = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'v76{T}', 'Vazia') returning id")
checar("carteira sem rotina: data-base nula e 0 clientes", True,
       f"select (r->>'data_base') is null and (r->>'clientes')::int = 0 from public.previa_segmentacao({EA}, {CV}, "
       f"'{{\"segmentos\": []}}'::jsonb) r", *P, valor="t")

# ------------------------------------------------------------------ permissões e segurança
Q = f"select (public.previa_segmentacao({EA}, {CA}, '{{\"segmentos\": []}}'::jsonb) ->> 'clientes')::int"
checar("planejamento (editar_orquestracao) vê a prévia", True, Q, *P, valor=len(universo))
checar("equipe (master) vê a prévia", True, Q, "authenticated", U["master"], valor=len(universo))
checar("operação não vê a prévia", False, Q, "authenticated", U["oper"], erro="sem permissão")
checar("outra empresa não vê a prévia", False, Q, "authenticated", U["planb"], erro="sem permissão")
checar("anon não executa a prévia", False, Q, "anon")
checar("carteira de outra empresa é recusada", False,
       f"select public.previa_segmentacao({EA}, {CB}, '{{\"segmentos\": []}}'::jsonb)", *P, erro="não é desta empresa")
checar("o site não lê o retrato por cliente", False, "select count(*) from public.atributos_previa", *P)
checar("o site não grava no retrato", False,
       f"insert into public.atributos_previa (empresa_id, credor_id, id_cliente, data_base) values ({EA}, {CA}, 'Z1', "
       f"'{HOJE}')", *P)
checar("previa_condicao_sql é só interna", False, "select public.previa_condicao_sql('{}'::jsonb)", *P)
checar("é security definer", True, "select prosecdef from pg_proc where oid = "
       "'public.previa_segmentacao(bigint,bigint,jsonb)'::regprocedure", valor="t")
checar("id com cara de CPF é barrado no retrato", False,
       f"insert into public.atributos_previa (empresa_id, credor_id, id_cliente, data_base) values ({EA}, {CA}, "
       f"'52998224725', '{HOJE}')", erro="sem_cpf")
checar("o retrato entra na troca de id (SQL 73)", True,
       "select 'atributos_previa' = any (public.tabelas_id_cliente())", valor="t")
checar("proposta malformada é recusada", False,
       f"select public.previa_segmentacao({EA}, {CA}, '[1]'::jsonb)", *P, erro="proposta")
INJ = {"segmentos": [{"codigo": "Q", "condicoes": [
    {"campo": "') or true; drop table public.empresas; --", "op": "=", "valor": "x'); drop table public.credores; --"}]}]}
checar("injeção no campo/valor não executa (nada bate, nada é apagado)", True,
       f"select (public.previa_segmentacao({EA}, {CA}, {lit(INJ)}) -> 'segmentos' -> 0 ->> 'clientes')::int "
       f"+ (select count(*) from public.credores where id = {CA})::int", *P, valor=1)
# números pt-BR iguais aos do motor
for txt_ in ("1.500,50", "1500,5", "1500.50", "1.500", "1.000.000", "R$ 10", " 12 ", "abc", "", "1e3", ".5"):
    py = CL.numero(txt_)
    checar(f"previa_numero({txt_!r}) = motor ({py})", True,
           f"select coalesce(public.previa_numero({lit(txt_)} #>> '{{}}')::text, 'None')",
           valor="None" if py is None else (str(int(py)) if py == int(py) else repr(py)))

sql(f"delete from public.empresas where id in ({EA}, {EB})")
print(f"\nSQL 76: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
