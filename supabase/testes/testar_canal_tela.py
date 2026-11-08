"""SQL 86 · Canais: a tela do canal (Pausar / Retomar com "Pausado desde" e a carteira com editar_canais).

Cobre: a migração roda duas vezes; pausar grava pausado_em/pausado_por; salvar outra coisa com o canal pausado não muda
o "desde"; o site não consegue gravar o "desde" à mão; retomar apaga; estado_canais usa pausado_em (não atualizado_em)
e diz "toque em Retomar"; credor_canais (carteira) grava com editar_canais e não com o papel fixo; operação e outra
empresa não gravam.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_canal_tela.py
Só dados fictícios (empresas e86-*, e-mails @exemplo.test).
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
SQL86 = RAIZ / "supabase" / "migrations" / "20270122000001_canal_tela.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor))
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 86: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 86: " + nome + ("" if cond else f"  -> {detalhe}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL86)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e86-a-{T}', 'E86 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e86-b-{T}', 'E86 B {T}') returning id")
CRA = sv(f"select id from public.credores where empresa_id = {EA} order by id limit 1")
U = {}
for p in ("plan", "oper", "planb"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}86-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='planejamento', empresa_id={EA} where id='{U['plan']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['oper']}'")
sv(f"update public.perfis set papel='planejamento', empresa_id={EB} where id='{U['planb']}'")
P = ("authenticated", U["plan"])
O = ("authenticated", U["oper"])
B = ("authenticated", U["planb"])

# canal que já estava pausado ANTES do SQL 86 (o "desde" é o atualizado_em da linha, sem carimbar de novo)
sv(f"insert into public.canais_empresa (empresa_id, canal, ativo) values ({EA}, 'email', false)")
sv(f"alter table public.canais_empresa disable trigger user; "
   f"update public.canais_empresa set atualizado_em = '2026-11-02 10:00-03', pausado_em = null "
   f"where empresa_id = {EA} and canal = 'email'; alter table public.canais_empresa enable trigger user")
aplicar(1)
aplicar(2)
checar("canal pausado antes do SQL: pausado_em = atualizado_em de antes", True,
       f"select to_char(pausado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') from public.canais_empresa "
       f"where empresa_id = {EA} and canal = 'email'", valor="02/11 10:00")
checar("o ajuste não mexeu no atualizado_em", True,
       f"select to_char(atualizado_em at time zone 'America/Sao_Paulo', 'DD/MM') from public.canais_empresa "
       f"where empresa_id = {EA} and canal = 'email'", valor="02/11")

# pausar pelo site (upsert só com ativo, como o botão Pausar)
checar("planejamento pausa o SMS (editar_canais)", True,
       f"insert into public.canais_empresa (empresa_id, canal, ativo) values ({EA}, 'sms', false) "
       f"on conflict (empresa_id, canal) do update set ativo = excluded.ativo", *P)
checar("pausar grava quando e quem", True,
       f"select (pausado_em > now() - interval '1 minute')::text || ' ' || (pausado_por = '{U['plan']}')::text "
       f"from public.canais_empresa where empresa_id = {EA} and canal = 'sms'", valor="true true")
sv(f"update public.canais_empresa set pausado_em = '2026-11-03 09:00-03' where empresa_id = {EA} and canal = 'sms'")
checar("nem o servidor troca o 'desde' com o canal seguindo pausado", True,
       f"select (pausado_em > now() - interval '1 minute')::text from public.canais_empresa "
       f"where empresa_id = {EA} and canal = 'sms'", valor="true")
sv(f"alter table public.canais_empresa disable trigger user; update public.canais_empresa "
   f"set pausado_em = '2026-11-03 09:00-03' where empresa_id = {EA} and canal = 'sms'; "
   f"alter table public.canais_empresa enable trigger user")
checar("salvar o custo com o canal pausado não muda o 'desde'", True,
       f"update public.canais_empresa set custo = 0.09 where empresa_id = {EA} and canal = 'sms'; "
       f"select to_char(pausado_em at time zone 'America/Sao_Paulo', 'DD/MM') from public.canais_empresa "
       f"where empresa_id = {EA} and canal = 'sms'", *P, valor="03/11")
checar("o site não grava o 'desde' à mão", True,
       f"update public.canais_empresa set pausado_em = '2020-01-01', pausado_por = null where empresa_id = {EA} "
       f"and canal = 'sms'; select to_char(pausado_em at time zone 'America/Sao_Paulo', 'DD/MM') "
       f"from public.canais_empresa where empresa_id = {EA} and canal = 'sms'", *P, valor="03/11")

r = json.loads(sv(f"select public.estado_canais({EA})", *P))
s = next(x for x in r["canais"] if x["canal"] == "sms")
sin = {x["chave"]: x for x in s["sinais"]}
afirmar("estado_canais: pausado desde = pausado_em (03/11), não o atualizado_em de hoje",
        s["estado"] == "pausado" and str(sin["pausado_desde"]["valor"]).startswith("2026-11-03")
        and "03/11" in s["problema"], s)
afirmar("estado_canais: o que fazer diz 'toque em Retomar'", "toque em Retomar" in (s["o_que_fazer"] or ""), s)

checar("operação não pausa nem retoma", True,
       f"with x as (update public.canais_empresa set ativo = true where empresa_id = {EA} and canal = 'sms' "
       f"returning 1) select count(*) from x", *O, valor=0)
checar("planejamento da B não retoma canal da A", True,
       f"with x as (update public.canais_empresa set ativo = true where empresa_id = {EA} and canal = 'sms' "
       f"returning 1) select count(*) from x", *B, valor=0)
checar("retomar apaga o 'desde'", True,
       f"update public.canais_empresa set ativo = true where empresa_id = {EA} and canal = 'sms'; "
       f"select coalesce(pausado_em::text, 'nulo') || ' ' || coalesce(pausado_por::text, 'nulo') "
       f"from public.canais_empresa where empresa_id = {EA} and canal = 'sms'", *P, valor="nulo nulo")
checar("canal novo já pausado ganha o 'desde'", True,
       f"insert into public.canais_empresa (empresa_id, canal, ativo) values ({EA}, 'rcs', false); "
       f"select (pausado_em is not null)::text from public.canais_empresa where empresa_id = {EA} and canal = 'rcs'",
       *P, valor="true")

# carteira: credor_canais grava com editar_canais (antes: papel fixo admin/planejamento)
checar("a regra da carteira não usa mais o papel fixo", True,
       "select count(*) from pg_policies where tablename = 'credor_canais' "
       "and coalesce(qual,'')||coalesce(with_check,'') ~ 'tem_papel'", valor=0)
checar("planejamento ajusta a carteira (editar_canais)", True,
       f"insert into public.credor_canais (empresa_id, credor_id, canal, ajustes) values ({EA}, {CRA}, 'sms', "
       f"'{{\"capacidade_dia\": 500}}') on conflict (credor_id, canal) do update set ajustes = excluded.ajustes", *P)
sv(f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({EA}, 'planejamento', "
   f"'editar_canais', false) on conflict do nothing")
checar("sem editar_canais (ajuste do Admin) a carteira não grava", True,
       f"with x as (update public.credor_canais set ajustes = '{{}}' where credor_id = {CRA} and canal = 'sms' "
       f"returning 1) select count(*) from x", *P, valor=0)
sv(f"delete from public.permissoes_papel where empresa_id = {EA} and papel = 'planejamento' and permissao = 'editar_canais'")
checar("operação não ajusta a carteira", False,
       f"insert into public.credor_canais (empresa_id, credor_id, canal, ajustes) values ({EA}, {CRA}, 'rcs', "
       f"'{{\"sabado\": false}}')", *O)
checar("planejamento da B não ajusta carteira da A", False,
       f"insert into public.credor_canais (empresa_id, credor_id, canal, ajustes) values ({EA}, {CRA}, 'email', "
       f"'{{\"sabado\": false}}')", *B)

print(f"SQL 86: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
