"""SQL 102 · Agente de voz: uso dos robôs contratados (telemetria), PR 6.

Cobre: a migração roda duas vezes; a VM (login motorcx_voz, por voz_vm.registrar_uso_robos) e o servidor (modo chave,
registrar_uso_robos_voz) gravam; o upsert de "agora" substitui a leitura anterior; o pico do dia só sobe (pico_em muda
só quando sobe) e os segundos no limite somam; recusas (lista grande, linha repetida, número negativo ou fora do
limite, segundos acima de 120, empresa sem voz); ninguém grava pelo site (authenticated, anon); leitura: quem é da
empresa vê só a própria linha, outra empresa nada, a equipe que cuida da voz vê, anon nada.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_robos_uso.py
Só dados fictícios (empresas e102-*, e-mails @exemplo.test).
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
SQL102 = RAIZ / "supabase" / "migrations" / "20270215000001_voz_robos_uso.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 102: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL102)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
E = {}
for k in ("a", "b", "s"):
    E[k] = sv(f"insert into public.empresas (slug, nome) values ('e102-{k}-{T}', 'E102 {k.upper()} {T}') returning id")
for k in ("a", "b"):
    sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({E[k]}, 'simulador', 'simulado')")
U = {}
for p in ("cli", "clib", "tec"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}102-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={E['a']} where id='{U['cli']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={E['b']} where id='{U['clib']}'")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, "
   f"equipe_alcance='todas' where id='{U['tec']}'")
CL = ("authenticated", U["cli"])
CLB = ("authenticated", U["clib"])
TEC = ("authenticated", U["tec"])


def linha(emp, em_uso, pico=None, limite=10, seg=0, **kw):
    x = {"empresa_id": int(emp), "em_uso": em_uso, "conversas": em_uso, "linhas": em_uso, "aguardando": 3,
         "limite": limite, "pico": em_uso if pico is None else pico, "no_limite": em_uso >= limite,
         "segundos_no_limite": seg}
    x.update(kw)
    return x


def gravar_vm(linhas):
    corpo = json.dumps({"linhas": linhas}).replace("'", "''")
    return f"set session authorization motorcx_voz; select voz_vm.registrar_uso_robos('{corpo}'::jsonb)"


def gravar_srv(linhas):
    corpo = json.dumps(linhas).replace("'", "''")
    return f"select public.registrar_uso_robos_voz('{corpo}'::jsonb)"


AGORA = f"select em_uso || ':' || limite || ':' || no_limite from public.voz_robos_agora where empresa_id = {E['a']}"
DIA = (f"select pico || ':' || segundos_no_limite from public.voz_robos_dia where empresa_id = {E['a']} "
       f"and dia = public.hoje_sp()")

# ------------------------------------------------------------------ gravação
checar("a VM grava (acesso próprio)", True, gravar_vm([linha(E["a"], 4, pico=6), linha(E["b"], 1)]), valor=2)
checar("agora: em uso e limite", True, AGORA, valor="4:10:false")
checar("dia: o pico da janela", True, DIA, valor="6:0")
PICO_EM = sv(f"select pico_em from public.voz_robos_dia where empresa_id = {E['a']} and dia = public.hoje_sp()")
checar("o servidor grava (modo chave da VM)", True, gravar_srv([linha(E["a"], 10, seg=15)]), "service_role", valor=1)
checar("agora: substitui a leitura anterior (no limite)", True, AGORA, valor="10:10:true")
checar("dia: o pico sobe e os segundos somam", True, DIA, valor="10:15")
checar("pico_em muda quando o pico sobe", True,
       f"select pico_em > '{PICO_EM}' from public.voz_robos_dia where empresa_id = {E['a']} and dia = public.hoje_sp()",
       valor="t")
PICO_EM = sv(f"select pico_em from public.voz_robos_dia where empresa_id = {E['a']} and dia = public.hoje_sp()")
sv(gravar_srv([linha(E["a"], 2, seg=0)]), "service_role")
checar("dia: o pico não desce e pico_em fica", True,
       f"select pico || ':' || (pico_em = '{PICO_EM}') from public.voz_robos_dia where empresa_id = {E['a']} "
       f"and dia = public.hoje_sp()", valor="10:true")

# ------------------------------------------------------------------ recusas
checar("lista com mais de 500 empresas", False, gravar_srv([linha(E["a"], 1)] * 501), "service_role", erro="até 500")
checar("linha repetida da mesma empresa", False, gravar_srv([linha(E["a"], 1), linha(E["a"], 2)]), "service_role",
       erro="uma linha por empresa")
checar("número negativo", False, gravar_srv([linha(E["a"], -1)]), "service_role", erro="números de 0 a 100000")
checar("segundos acima de 120 numa leitura", False, gravar_srv([linha(E["a"], 1, seg=121)]), "service_role",
       erro="segundos até 120")
checar("sem limite", False, gravar_srv([{"empresa_id": int(E["a"]), "em_uso": 1}]), "service_role", erro="obrigatórios")
checar("empresa sem voz configurada", False, gravar_vm([linha(E["s"], 1)]), erro="empresa sem voz")
checar("não é lista", False, gravar_srv({"empresa_id": 1}), "service_role", erro="lista")
checar("o site não grava (authenticated)", False, gravar_srv([linha(E["a"], 1)]), *CL)
checar("nem a equipe pelo site", False, gravar_srv([linha(E["a"], 1)]), *TEC)
checar("anon não grava", False, gravar_srv([linha(E["a"], 1)]), "anon")
checar("o site não escreve direto na tabela", False,
       f"update public.voz_robos_agora set em_uso = 0 where empresa_id = {E['a']}", *TEC)
checar("a VM só pela função de voz_vm (não chama a do public)", False,
       "set session authorization motorcx_voz; select public.registrar_uso_robos_voz('[]'::jsonb)")

# ------------------------------------------------------------------ leitura
checar("cliente: só a própria empresa (agora)", True,
       "select string_agg(empresa_id::text, ',') from public.voz_robos_agora", *CL, valor=E["a"])
checar("cliente: só a própria empresa (dia)", True,
       "select string_agg(empresa_id::text || ':' || pico, ',') from public.voz_robos_dia", *CL, valor=f"{E['a']}:10")
checar("outra empresa não vê a A", True,
       f"select count(*) from public.voz_robos_agora where empresa_id = {E['a']}", *CLB, valor=0)
checar("equipe que cuida da voz vê", True,
       f"select count(*) from public.voz_robos_agora where empresa_id in ({E['a']}, {E['b']})", *TEC, valor=2)
checar("anon não lê", False, "select * from public.voz_robos_agora", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
