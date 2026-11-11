"""SQL 111 · Agente de voz: operadores para transferência ao mesmo tempo (Power e Preditivo, V8).

Cobre: a migração roda duas vezes; a coluna nasce com 5 nas transferências que já existem; a VM lê pela view própria
voz_vm.transferencias_operadores (a do SQL 57 não muda, para continuar reaplicável); definir_operadores_transferencia_voz: só a equipe que cuida da voz
da empresa, de 1 a 500; o cliente e anon não mudam.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_transferencia_operadores.py
Só dados fictícios (empresas e111-*, e-mails @exemplo.test).
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
SQL111 = RAIZ / "supabase" / "migrations" / "20270226000001_voz_transferencia_operadores.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 111: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL111)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


T = uuid.uuid4().hex[:6]
E = sv(f"insert into public.empresas (slug, nome) values ('e111-{T}', 'E111 {T}') returning id")
sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({E}, 'simulador', 'simulado')")
TF = sv(f"insert into public.voz_transferencias (empresa_id, nome, destino_sip, metodo) values ({E}, 'Fila {T}', "
        f"'sip:fila@203.0.113.50:5060', 'ponte') returning id")
aplicar(1)
aplicar(2)
U = {}
for p in ("cli", "tec"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}111-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={E} where id='{U['cli']}'")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, "
   f"equipe_alcance='todas' where id='{U['tec']}'")
CL, TEC = ("authenticated", U["cli"]), ("authenticated", U["tec"])
checar("transferência que já existia fica com 5", True,
       f"select simultaneas from public.voz_transferencias where id = {TF}", valor=5)
checar("voz_vm.transferencias do SQL 57 não muda (o 57 continua reaplicável)", True,
       "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       "where table_schema = 'voz_vm' and table_name = 'transferencias'",
       valor="id,empresa_id,credor_id,nome,destino_sip,metodo,tronco_id,tech_prefix,cabecalhos,ativo,atualizado_em")
checar("a VM lê o número pela view própria", True,
       f"set session authorization motorcx_voz; select simultaneas from voz_vm.transferencias_operadores where id = {TF}",
       valor=5)
checar("a view própria só tem id e o número", True,
       "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       "where table_schema = 'voz_vm' and table_name = 'transferencias_operadores'", valor="id,simultaneas")
checar("o site não lê a view da VM", False, "select * from voz_vm.transferencias_operadores", *CL)
checar("a equipe que cuida da voz muda", True, f"select public.definir_operadores_transferencia_voz({TF}, 12)", *TEC,
       valor=12)
checar("gravado", True, f"select simultaneas from public.voz_transferencias where id = {TF}", valor=12)
checar("fora de 1 a 500", False, f"select public.definir_operadores_transferencia_voz({TF}, 0)", *TEC, erro="de 1 a 500")
checar("o cliente não muda", False, f"select public.definir_operadores_transferencia_voz({TF}, 3)", *CL,
       erro="só a equipe")
checar("transferência inexistente", False, "select public.definir_operadores_transferencia_voz(-1, 3)", *TEC,
       erro="não encontrada")
checar("anon não muda", False, f"select public.definir_operadores_transferencia_voz({TF}, 3)", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
