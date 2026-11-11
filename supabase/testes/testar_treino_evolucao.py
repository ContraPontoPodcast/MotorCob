"""SQL 121 · Roleplay, PR 8: Evolução do treino por operador e por equipe (evolucao_treino), num Postgres local com as
migrações aplicadas.

Cobre: a migração roda duas vezes; quem treina lê a empresa, uma equipe e uma pessoa; Gestão, outra empresa e anon não;
a nota do treino por item e semana com a revisão da Qualidade valendo sobre a da IA; o teste da Qualidade não entra;
ligações reais no mesmo item (só de quem tem o ID do discador, só da empresa); a nota por semana do treino e das
ligações; o mapa por equipe só na leitura da empresa; a leitura de equipe e de empresa nunca traz nota por pessoa (sem
ranking); a da pessoa traz as sessões para a linha do tempo; concordância IA × Qualidade; itens em foco dos treinos;
equipe ou pessoa de outra empresa recusada; nada é gravado.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_treino_evolucao.py
Só dados fictícios (empresas t121-*, e-mails @exemplo.test, operadores com apelido).
"""
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL121 = RAIZ / "supabase" / "migrations" / "20270313000001_treino_evolucao.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    linhas = r.stdout.strip().splitlines()
    return r.returncode == 0, (linhas or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 121: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 121: " + nome + ("" if cond else f"  -> {detalhe[:600]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"

for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL121)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])

au, an, sr = "authenticated", "anon", "service_role"
HOJE = sv("select public.hoje_treino()")
T = uuid.uuid4().hex[:6]
TA = sv(f"insert into public.empresas (slug, nome) values ('t121-a-{T}', 'T121 A {T}') returning id")
TB = sv(f"insert into public.empresas (slug, nome) values ('t121-b-{T}', 'T121 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true), "
   f"({TB}, 'speech_analytics', true) on conflict (empresa_id, modulo) do update set ativo = true")
U = {}
for p, papel, emp in (("qa", "qualidade", TA), ("qb", "qualidade", TB), ("adm", "admin", TA), ("ges", "gestao", TA)):
    U[p] = sv(f"insert into auth.users (email) values ('t121.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
Q, QB, A, G = U["qa"], U["qb"], U["adm"], U["ges"]

EQ1 = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Manhã')", au, Q)
EQ2 = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Tarde')", au, Q)
EQB = sv(f"select public.salvar_equipe_treino({TB}, 'Equipe B')", au, QB)
O1 = sv(f"select public.salvar_operador_treino({TA}, 'Ana E.', {EQ1}, 'T121-1')", au, Q)
O2 = sv(f"select public.salvar_operador_treino({TA}, 'Bruno E.', {EQ2}, 'T121-2')", au, Q)
O3 = sv(f"select public.salvar_operador_treino({TA}, 'Carla E.', {EQ1})", au, Q)                 # só treino
OB = sv(f"select public.salvar_operador_treino({TB}, 'Davi E.', {EQB}, 'T121-1')", au, QB)       # mesmo ID, outra empresa
GLOB = sv("select id from public.treino_cenarios where empresa_id is null and codigo = 'ja_pagou'")
AT = sv(f"select public.atribuir_treino({TA}, {GLOB}, array[{O1}, {O2}, {O3}], '{HOJE}'::date + 7, 75, 5)", au, Q)
TK = {o: json.loads(sv(f"select public.gerar_link_treino({o})", au, Q))["token"] for o in (O1, O2, O3)}


def sessao(op, itens, nota, reprovada=False):
    s = json.loads(sv(f"select public.treino_iniciar('{TK[op]}', {AT}, 'texto')", an))["sessao"]
    sv(f"select public.registrar_sessao_treino({s}, " + j({"situacao": "avaliada", "duracao_s": 120, "nota": nota, "itens": itens,
       "evidencia": {}, "reprovada": reprovada, "item_reprovado": "ck_cpc" if reprovada else None, "tokens": 10}) + ")", sr)
    return s


S1 = sessao(O1, {"ck_ident": "sim", "ck_cpc": "nao", "ck_resumo": "na"}, 50, True)
S2 = sessao(O1, {"ck_ident": "sim", "ck_cpc": "sim", "ck_resumo": "sim"}, 100)
S3 = sessao(O2, {"ck_ident": "nao", "ck_cpc": "sim", "ck_resumo": "sim"}, 80)
S4 = sessao(O3, {"ck_ident": "sim", "ck_cpc": "sim", "ck_resumo": "nao"}, 85)
sv(f"select public.revisar_sessao_treino({S3}, 'ck_ident', 'sim')", au, Q)        # a Qualidade corrige a IA
sv(f"select public.revisar_sessao_treino({S2}, 'ck_cpc', 'sim')", au, Q)          # e confirma
TE = json.loads(sv(f"select public.testar_cenario_treino({GLOB}, {TA}, 'texto')", au, Q))["sessao"]
sv(f"select public.registrar_sessao_treino({TE}, " + j({"situacao": "avaliada", "duracao_s": 60, "nota": 0, "itens": {"ck_ident": "nao"},
   "evidencia": {}, "tokens": 1}) + ")", sr)
for ref, emp, item, av, ap, na, nota in (("T121-1", TA, "ck_cpc", 20, 12, 0, 0), ("T121-1", TA, "_ligacao", 20, 15, 0, 1500),
                                         ("T121-2", TA, "ck_cpc", 10, 9, 1, 0), ("T121-1", TB, "ck_cpc", 50, 0, 0, 0)):
    sv(f"insert into public.voz_qualidade_dia (empresa_id, credor_id, data, origem, persona, operador_ref, item, avaliadas, aprovadas, "
       f"na, nota_soma) values ({emp}, 0, '{HOJE}'::date - 2, 'discador', '', '{ref}', '{item}', {av}, {ap}, {na}, {nota})")


def soma(lista, item):
    xs = [x for x in lista if x["item"] == item]
    return sum(x["sim"] for x in xs), sum(x["avaliados"] for x in xs)


E = json.loads(sv(f"select public.evolucao_treino({TA})", au, Q))
caso("empresa: 3 pessoas no escopo, 2 com ligações reais", (E["escopo"], E["pessoas"], E["com_ligacoes"]) == ("empresa", 3, 2), json.dumps(E)[:300])
caso("treino por item com a revisão da Qualidade valendo (ck_ident: 4 sim de 4); o teste não entra",
     soma(E["treino_itens"], "ck_ident") == (4, 4), json.dumps(E["treino_itens"]))
caso("treino ck_cpc: 3 sim de 4 avaliados; não se aplica fica fora", soma(E["treino_itens"], "ck_cpc") == (3, 4)
     and soma(E["treino_itens"], "ck_resumo") == (2, 3), json.dumps(E["treino_itens"]))
caso("ligações reais no item: 21 sim de 29 (só da empresa; não se aplica fora)", soma(E["real_itens"], "ck_cpc") == (21, 29),
     json.dumps(E["real_itens"]))
caso("nota das ligações por semana (75) e do treino por semana (4 sessões, 3 na meta)",
     E["real_notas"][0]["nota"] == 75 and sum(x["sessoes"] for x in E["treino_notas"]) == 4
     and sum(x["na_meta"] for x in E["treino_notas"]) == 3, json.dumps([E["real_notas"], E["treino_notas"]]))
caso("mapa por equipe na leitura da empresa", {x["equipe"] for x in E["por_equipe"]} == {int(EQ1), int(EQ2)}, json.dumps(E["por_equipe"]))
caso("concordância IA × Qualidade: 2 revisados, 1 igual", E["concordancia"] == {"revisados": 2, "iguais": 1}, json.dumps(E["concordancia"]))
caso("itens em foco dos treinos atribuídos", isinstance(E["itens_treinados"], list) and len(E["itens_treinados"]) > 0, json.dumps(E["itens_treinados"]))
TXT = json.dumps(E)
caso("sem ranking: a leitura da empresa não traz sessões, operador nem apelido",
     E["sessoes"] is None and "operador" not in TXT and "Ana E." not in TXT and "apelido" not in TXT, TXT[:300])

Q1 = json.loads(sv(f"select public.evolucao_treino({TA}, {EQ1})", au, Q))
caso("equipe: Ana e Carla, sem mapa por equipe nem sessões", (Q1["escopo"], Q1["pessoas"], Q1["com_ligacoes"]) == ("equipe", 2, 1)
     and Q1["por_equipe"] is None and Q1["sessoes"] is None and soma(Q1["real_itens"], "ck_cpc") == (12, 20), json.dumps(Q1)[:300])
P = json.loads(sv(f"select public.evolucao_treino({TA}, null, {O1}, 30)", au, Q))
caso("pessoa: as sessões em ordem, com os itens já revisados, para a linha do tempo",
     P["escopo"] == "pessoa" and [s["id"] for s in P["sessoes"]] == [int(S1), int(S2)] and P["sessoes"][1]["itens"]["ck_cpc"] == "sim"
     and P["sessoes"][0]["cenario"], json.dumps(P["sessoes"])[:300])
caso("pessoa só de treino: sem ligações reais", json.loads(sv(f"select public.evolucao_treino({TA}, null, {O3})", au, Q))["real_itens"] == [])
checar("Admin também lê", True, f"select public.evolucao_treino({TA}) ->> 'pessoas'", au, A, 3)
checar("Gestão não lê", False, f"select public.evolucao_treino({TA})", au, G, erro="sem permissão")
checar("Qualidade de outra empresa não lê", False, f"select public.evolucao_treino({TA})", au, QB, erro="sem permissão")
checar("anon não chama", False, f"select public.evolucao_treino({TA})", an)
checar("equipe de outra empresa é recusada", False, f"select public.evolucao_treino({TA}, {EQB})", au, Q, erro="equipe não encontrada")
checar("pessoa de outra empresa é recusada", False, f"select public.evolucao_treino({TA}, null, {OB})", au, Q, erro="pessoa não encontrada")
sv(f"update public.empresa_modulos set ativo = false where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("módulo desligado: não abre", False, f"select public.evolucao_treino({TA})", au, Q, erro="não está contratado")
sv(f"update public.empresa_modulos set ativo = true where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("só leitura: nenhuma avaliação real nova", True, f"select count(*) from public.voz_avaliacoes where empresa_id = {TA}", sr, None, 0)
checar("função com search_path fixo e security definer", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'evolucao_treino' and prosecdef "
       "and array_to_string(proconfig, ',') like '%search_path%'", sr, None, 1)

sv(f"delete from auth.users where id in ('{Q}', '{QB}', '{A}', '{G}'); delete from public.empresas where id in ({TA}, {TB})")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
