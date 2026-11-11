"""SQL 110 · Agente de voz: o histórico que o Preditivo usa (Power e Preditivo, V5).

Cobre: a migração roda duas vezes; historico_ritmo_voz devolve, por carteira, discadas e atendidas por pessoa dos
últimos 7 dias (sem hoje e sem o que é mais velho), dias desde a primeira amostra em Preditivo e o p da empresa; só o
servidor e a VM leem; só contagens.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_ritmo_preditivo.py
Só dados fictícios (empresas e110-*, e-mails @exemplo.test).
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
SQL110 = RAIZ / "supabase" / "migrations" / "20270225000001_voz_ritmo_preditivo.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 110: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL110)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
E = sv(f"insert into public.empresas (slug, nome) values ('e110-{T}', 'E110 {T}') returning id")
sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({E}, 'simulador', 'simulado')")
C1 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({E}, 'c110a{T}', 'A') returning id")
C2 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({E}, 'c110b{T}', 'B') returning id")
U = sv(f"insert into auth.users (email) values ('cli110-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={E} where id='{U}'")


def amostra(credor, dias, d, p, modo="power", minuto=0):
    return (f"insert into public.voz_ritmo_amostras (empresa_id, credor_id, janela, dia, modo, discadas, "
            f"atendidas_pessoa) values ({E}, {credor}, now() - interval '{dias} days' + interval '{minuto} minutes', "
            f"public.hoje_sp() - {dias}, '{modo}', {d}, {p})")


for x in (amostra(C1, 1, 1000, 120, "preditivo"), amostra(C1, 3, 1000, 100, "preditivo"),
          amostra(C1, 10, 5000, 900, "preditivo"), amostra(C1, 0, 300, 90, "preditivo"),
          amostra(C2, 2, 500, 50), amostra("null", 2, 100, 10)):
    sv(x)
H = f"public.historico_ritmo_voz({E})"
checar("carteira A: 7 dias sem hoje e sem o mais velho; dias em Preditivo desde a 1ª amostra", True,
       f"select x ->> 'discadas_7d' || ':' || (x ->> 'atendidas_7d') || ':' || (x ->> 'dias_preditivo') "
       f"from jsonb_array_elements({H} -> 'carteiras') x where (x ->> 'credor_id')::bigint = {C1}", "service_role",
       valor="2000:220:10")
checar("carteira B em Power: 0 dias em Preditivo", True,
       f"select x ->> 'dias_preditivo' from jsonb_array_elements({H} -> 'carteiras') x "
       f"where (x ->> 'credor_id')::bigint = {C2}", "service_role", valor=0)
checar("p da empresa em 7 dias", True, f"select {H} ->> 'p_empresa'", "service_role", valor="0.1077")
checar("a VM lê pela função de voz_vm", True,
       f"set session authorization motorcx_voz; select jsonb_array_length(voz_vm.historico_ritmo("
       f"'{{\"empresa\": {E}}}'::jsonb) -> 'carteiras')", valor=3)
checar("o site não lê", False, f"select {H}", "authenticated", U)
checar("anon não lê", False, f"select {H}", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
