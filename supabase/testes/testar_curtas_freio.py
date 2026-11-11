"""SQL 109 · Agente de voz: freios de chamadas curtas no ritmo (Power e Preditivo, V6).

Cobre: a migração roda duas vezes; curtas_hoje_voz soma as amostras do dia (total e por linha) e diz se o Admin
liberou, só para o servidor e a VM; liberar_curtas_voz: só o Admin da empresa (ou da equipe), motivo de 10 a 300
caracteres sem dado pessoal, uma vez por dia, auditada; leitura das liberações só da própria empresa.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_curtas_freio.py
Só dados fictícios (empresas e109-*, e-mails @exemplo.test).
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
SQL109 = RAIZ / "supabase" / "migrations" / "20270224000001_voz_curtas_freio.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 109: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL109)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
E = sv(f"insert into public.empresas (slug, nome) values ('e109-{T}', 'E109 {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e109b-{T}', 'E109B {T}') returning id")
for e in (E, EB):
    sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({e}, 'simulador', 'simulado')")
U = {}
for p, papel, emp in (("adm", "admin", E), ("ope", "operacao", E), ("admb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('{p}109-{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp} where id='{U[p]}'")
ADM, OPE, ADMB = ("authenticated", U["adm"]), ("authenticated", U["ope"]), ("authenticated", U["admb"])
J = sv("select to_char(date_trunc('hour', now()) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD\"T\"HH24:MI:SS') "
       "|| '-03:00'")
linhas = [{"empresa_id": int(E), "credor_id": None, "janela": J, "discadas": 900, "atendidas_pessoa": 90,
           "abandonos": 0, "curtas": 760, "por_tronco": [{"tronco_id": 1, "discadas": 600, "atendidas_pessoa": 60,
                                                          "abandonos": 0, "curtas": 500},
                                                         {"tronco_id": 2, "discadas": 300, "atendidas_pessoa": 30,
                                                          "abandonos": 0, "curtas": 260}]}]
sv(f"select public.registrar_ritmo_voz('{json.dumps(linhas)}'::jsonb)", "service_role")
H = f"public.curtas_hoje_voz({E})"
checar("curtas de hoje: total e por linha", True,
       f"select ({H} ->> 'total') || ':' || ({H} ->> 'curtas') || ':' || ({H} -> 'troncos' -> 1 ->> 'curtas') || ':' "
       f"|| ({H} ->> 'liberado')", "service_role", valor="900:760:260:false")
checar("a VM lê pela função de voz_vm", True,
       f"set session authorization motorcx_voz; select voz_vm.curtas_hoje('{{\"empresa\": {E}}}'::jsonb) ->> 'total'",
       valor=900)
checar("o site não lê as curtas da VM", False, f"select {H}", *ADM)
MOT = "'Campanha de feirão autorizada pela diretoria'"
checar("operação não libera", False, f"select public.liberar_curtas_voz({E}, {MOT})", *OPE, erro="só o Admin")
checar("Admin de outra empresa não libera", False, f"select public.liberar_curtas_voz({E}, {MOT})", *ADMB,
       erro="só o Admin")
checar("motivo curto", False, f"select public.liberar_curtas_voz({E}, 'curto')", *ADM, erro="motivo")
checar("motivo com telefone", False,
       f"select public.liberar_curtas_voz({E}, 'ligar para 11 98888-7777 depois')", *ADM, erro="motivo")
checar("Admin libera", True, f"select public.liberar_curtas_voz({E}, {MOT}) > 0", *ADM, valor="t")
checar("uma vez por dia", False, f"select public.liberar_curtas_voz({E}, {MOT})", *ADM, erro="já liberado hoje")
checar("a VM vê a liberação", True, f"select {H} ->> 'liberado'", "service_role", valor="true")
checar("auditada", True,
       f"select count(*) from public.auditoria where tabela = 'voz_curtas_liberacoes' and empresa_id = {E}",
       valor=1)
checar("a empresa lê a sua liberação", True, "select count(*) from public.voz_curtas_liberacoes", *OPE, valor=1)
checar("outra empresa não lê", True, "select count(*) from public.voz_curtas_liberacoes", *ADMB, valor=0)
checar("ninguém grava direto na tabela", False,
       f"insert into public.voz_curtas_liberacoes (empresa_id, motivo) values ({E}, 'motivo direto na tabela')", *ADM)
checar("anon não libera", False, f"select public.liberar_curtas_voz({E}, {MOT})", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
