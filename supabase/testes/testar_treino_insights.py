"""SQL 122 · Roleplay, PR 9: cenário gerado a partir dos padrões das ligações (padroes_insights_treino e a guarda do
cenário gerado), num Postgres local com as migrações aplicadas.

Cobre: a migração roda duas vezes; os padrões só de grupos com 30+ ligações (base, motivos, objeções com taxa de acordo,
itens com menos "sim"); base abaixo de 30 não é suficiente e não traz nada; só códigos e números (nada de cliente,
chamada, trecho); quem edita cenários lê, Gestão, outra empresa e anon não; o cenário gerado nasce só em rascunho, com
os padrões (insights com base >= 30), no máximo 20 por dia; publicar é pelo editor com o login de uma pessoa; o
servidor sozinho não publica; nada é gravado nas tabelas do Speech.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_treino_insights.py
Só dados fictícios (empresas t122-*, e-mails @exemplo.test).
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
SQL122 = RAIZ / "supabase" / "migrations" / "20270314000001_treino_insights.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 122: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 122: " + nome + ("" if cond else f"  -> {detalhe[:600]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"

for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL122)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])

au, an, sr = "authenticated", "anon", "service_role"
HOJE = sv("select public.hoje_treino()")
T = uuid.uuid4().hex[:6]
TA = sv(f"insert into public.empresas (slug, nome) values ('t122-a-{T}', 'T122 A {T}') returning id")
TB = sv(f"insert into public.empresas (slug, nome) values ('t122-b-{T}', 'T122 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true), "
   f"({TB}, 'speech_analytics', true) on conflict (empresa_id, modulo) do update set ativo = true")
U = {}
for p, papel, emp in (("qa", "qualidade", TA), ("qb", "qualidade", TB), ("ges", "gestao", TA)):
    U[p] = sv(f"insert into auth.users (email) values ('t122.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
Q, QB, G = U["qa"], U["qb"], U["ges"]


def conv(emp, dim, valor, n, acordo, dias=3, origem="discador"):
    sv(f"insert into public.voz_conversao_dia (empresa_id, credor_id, data, origem, persona, dimensao, valor, conversas, com_acordo) "
       f"values ({emp}, 0, '{HOJE}'::date - {dias}, '{origem}', '', '{dim}', '{valor}', {n}, {acordo}) on conflict do nothing")


conv(TA, "total", "todas", 300, 60)
conv(TA, "total", "todas", 100, 30, origem="ia")
conv(TA, "motivo", "contestacao", 72, 6)
conv(TA, "motivo", "desemprego", 29, 10)            # abaixo de 30: fica fora
conv(TA, "objecao", "valor_alto", 120, 12)
conv(TA, "total", "todas", 500, 100, dias=60)       # fora do período de 30 dias
for item, av, ap, na in (("ck_cpc", 40, 20, 0), ("ck_ident", 50, 48, 0), ("ck_resumo", 25, 5, 0), ("_ligacao", 90, 70, 0)):
    sv(f"insert into public.voz_qualidade_dia (empresa_id, credor_id, data, origem, persona, operador_ref, item, avaliadas, "
       f"aprovadas, na, nota_soma) values ({TA}, 0, '{HOJE}'::date - 2, 'discador', '', 'OP-122', '{item}', {av}, {ap}, {na}, 0)")
conv(TB, "total", "todas", 20, 2)

P = json.loads(sv(f"select public.padroes_insights_treino({TA})", au, Q))
caso("base de 400 ligações em 30 dias (as de 60 dias atrás ficam fora)", P["base"] == 400 and P["suficiente"] is True, json.dumps(P))
caso("motivos e objeções só com 30+ ligações, com a porcentagem e a taxa de acordo",
     [m["codigo"] for m in P["motivos"]] == ["contestacao"] and P["motivos"][0]["pct"] == 0.18
     and P["motivos"][0]["acordo_pct"] == 0.083 and P["objecoes"][0]["codigo"] == "valor_alto", json.dumps(P))
caso("itens com menos sim primeiro, só com 30+ avaliações (o de 25 fica fora; a ligação não é item)",
     [i["item"] for i in P["itens"]] == ["ck_cpc", "ck_ident"] and P["itens"][0]["sim_pct"] == 0.5, json.dumps(P["itens"]))
caso("só códigos e números", not any(k in json.dumps(P) for k in ("OP-122", "chamada", "trecho", "cliente")), json.dumps(P))
PB = json.loads(sv(f"select public.padroes_insights_treino({TB})", au, QB))
caso("base abaixo de 30: não é suficiente e não traz motivos nem objeções",
     PB["suficiente"] is False and PB["motivos"] == [] and PB["objecoes"] == [], json.dumps(PB))
checar("Gestão não lê os padrões", False, f"select public.padroes_insights_treino({TA})", au, G, erro="sem permissão")
checar("Qualidade de outra empresa não lê", False, f"select public.padroes_insights_treino({TA})", au, QB, erro="sem permissão")
checar("anon não chama", False, f"select public.padroes_insights_treino({TA})", an)

INS = {"base": 400, "de": "2026-10-11", "ate": "2026-11-09", "motivo:contestacao": 0.18, "objecao:valor_alto": 0.3}
DADOS = {"nome": "Contesta a dívida", "persona_nome": "Lia (fictícia)", "perfil": "contesta_procon",
         "objetivo": "Não reconhece a dívida e pede explicação antes de qualquer acordo.", "frases": ["Eu não reconheço isso."],
         "comportamentos": ["desconfia"], "objecoes": [{"codigo": "nao_reconheco"}], "dificuldade": 3, "origem": "insights", "insights": INS}
C1 = sv(f"select public.salvar_cenario_treino({TA}, {j(DADOS)})", au, Q)
checar("cenário gerado nasce em rascunho", True, f"select situacao || '|' || origem from public.treino_cenarios where id = {C1}", sr, None,
       "rascunho|insights")
checar("cenário gerado não nasce publicado", False,
       f"select public.salvar_cenario_treino({TA}, {j({**DADOS, 'situacao': 'publicado'})})", au, Q, erro="começa em rascunho")
checar("cenário gerado sem os padrões é recusado", False,
       f"select public.salvar_cenario_treino({TA}, {j({k: v for k, v in DADOS.items() if k != 'insights'})})", au, Q, erro="precisa dos padrões")
checar("padrões com base abaixo de 30 são recusados", False,
       f"select public.salvar_cenario_treino({TA}, {j({**DADOS, 'insights': {**INS, 'base': 12}})})", au, Q)
checar("padrões com texto (não código e número) são recusados", False,
       f"select public.salvar_cenario_treino({TA}, {j({**DADOS, 'insights': {**INS, 'motivo:contestacao': 'Lia disse que pagou'}})})", au, Q)
CID = sv(f"select max(id) from public.treino_cenarios where empresa_id = {TA} and origem = 'insights'")
checar("o servidor sozinho não publica o cenário gerado", False,
       f"update public.treino_cenarios set situacao = 'publicado', publicado_em = now() where id = {CID}", sr, erro="só é publicado por uma pessoa")
sv(f"select public.salvar_cenario_treino({TA}, '{{\"situacao\": \"publicado\"}}', {CID})", au, Q)
checar("a Qualidade publica pelo editor depois de revisar", True, f"select situacao from public.treino_cenarios where id = {CID}", sr, None, "publicado")
checar("continua com o selo de padrões agregados", True, f"select origem || '|' || (insights ->> 'base') from public.treino_cenarios where id = {CID}",
       sr, None, "insights|400")
for _ in range(19 - int(sv(f"select count(*) from public.treino_cenarios where empresa_id = {TA} and origem = 'insights'")) + 1):
    sv(f"select public.salvar_cenario_treino({TA}, {j(DADOS)})", au, Q)
checar("no máximo 20 gerados por dia por empresa", False, f"select public.salvar_cenario_treino({TA}, {j(DADOS)})", au, Q, erro="limite de 20")
checar("cenário feito do zero não tem limite", True,
       f"select (public.salvar_cenario_treino({TA}, {j({k: v for k, v in DADOS.items() if k not in ('origem', 'insights')})}) > 0)::text", au, Q, "true")
checar("só leitura: nada novo em voz_conversao_dia", True, f"select count(*) from public.voz_conversao_dia where empresa_id = {TA}", sr, None, 6)
checar("funções do SQL 122 com search_path fixo e security definer", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('padroes_insights_treino', "
       "'treino_cenarios_insights') and prosecdef and array_to_string(proconfig, ',') like '%search_path%'", sr, None, 2)

sv(f"delete from auth.users where id in ('{Q}', '{QB}', '{G}'); delete from public.empresas where id in ({TA}, {TB})")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
