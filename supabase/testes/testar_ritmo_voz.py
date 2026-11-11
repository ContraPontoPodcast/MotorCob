"""SQL 106 · Agente de voz: medir o abandono certo (Power e Preditivo, V1).

Cobre: a migração roda duas vezes; o desfecho novo transferencia_sem_operador vale em voz_chamadas e é a situação
"abandonada" da Renitência; a VM (motorcx_voz, voz_vm.registrar_ritmo) e o servidor (registrar_ritmo_voz) gravam
amostras de 5 min por carteira; a mesma janela soma (VM reiniciada / duas VMs), por tronco também; recusas (lista
grande, janela fora das 48 h, razão fora de 1–3, contagem incoerente, por_tronco com campo estranho, linha repetida,
carteira de outra empresa, empresa sem voz); ninguém grava pelo site; leitura: ritmo_voz_hoje (totais e taxas, última
amostra, janelas de 30 min, por tronco com a bina mascarada, 30 dias) só da própria empresa ou da equipe que cuida da
voz; a tabela segue a mesma regra.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_ritmo_voz.py
Só dados fictícios (empresas e106-*, e-mails @exemplo.test).
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
SQL106 = RAIZ / "supabase" / "migrations" / "20270221000001_voz_ritmo_medir.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 106: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL106)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
E = {}
for k in ("a", "b", "s"):
    E[k] = sv(f"insert into public.empresas (slug, nome) values ('e106-{k}-{T}', 'E106 {k.upper()} {T}') returning id")
for k in ("a", "b"):
    sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({E[k]}, 'simulador', 'simulado')")
C = {}
for k in ("a", "b"):
    C[k] = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({E[k]}, 'c106{k}{T}', 'Carteira {k}') "
              "returning id")
TR = sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, "
        f"canais) values ({E['a']}, 'tr106-{T}', 'Operadora X', '203.0.113.10', 'ip', '11', '1130000099', 30) "
        "returning id")
U = {}
for p in ("cli", "clib", "tec"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}106-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={E['a']} where id='{U['cli']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={E['b']} where id='{U['clib']}'")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, "
   f"equipe_alcance='todas' where id='{U['tec']}'")
CL = ("authenticated", U["cli"])
CLB = ("authenticated", U["clib"])
TEC = ("authenticated", U["tec"])

# janela de 5 min de agora (a de 30 min do dia junta duas destas)
J1 = sv("select to_char(date_trunc('hour', now()) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD\"T\"HH24:MI:SS') "
        "|| '-03:00'")
J2 = sv("select to_char((date_trunc('hour', now()) + interval '5 minutes') at time zone 'America/Sao_Paulo', "
        "'YYYY-MM-DD\"T\"HH24:MI:SS') || '-03:00'")


def linha(emp, credor, janela, d=100, p=12, ab=1, tf=0, c=80, **kw):
    x = {"empresa_id": int(emp), "credor_id": int(credor) if credor else None, "janela": janela, "modo": "power",
         "razao": 1.0, "discadas": d, "atendidas_pessoa": p, "abandonos": ab, "transf_sem_operador": tf, "curtas": c,
         "conversas": 4, "reservas": 1, "linhas": 20,
         "por_tronco": [{"tronco_id": int(TR), "discadas": d, "atendidas_pessoa": p, "abandonos": ab, "curtas": c}]}
    x.update(kw)
    return x


def gravar_vm(linhas):
    corpo = json.dumps({"linhas": linhas}).replace("'", "''")
    return f"set session authorization motorcx_voz; select voz_vm.registrar_ritmo('{corpo}'::jsonb)"


def gravar_srv(linhas):
    corpo = json.dumps(linhas).replace("'", "''")
    return f"select public.registrar_ritmo_voz('{corpo}'::jsonb)"


def hoje(emp, credor="null", campo="totais"):
    return f"select public.ritmo_voz_hoje({emp}, {credor}) -> '{campo}'"


# ------------------------------------------------------------------ desfecho novo
checar("transferencia_sem_operador está em desfechos_voz()", True,
       "select 'transferencia_sem_operador' = any (public.desfechos_voz())", valor="t")
checar("na Renitência é a linha 'abandonada'", True,
       "select public.situacao_voz('transferencia_sem_operador')", valor="abandonada")
checar("não entra no abandono das chamadas curtas", True,
       "select public.regras_curtas_voz() -> 'abandono' ? 'transferencia_sem_operador'", valor="f")

# ------------------------------------------------------------------ gravação
checar("a VM grava (acesso próprio)", True, gravar_vm([linha(E["a"], C["a"], J1), linha(E["b"], C["b"], J1)]),
       valor=2)
checar("o servidor grava (modo chave da VM) a janela seguinte", True,
       gravar_srv([linha(E["a"], C["a"], J2, d=50, p=8, ab=0, tf=2, c=30, modo="preditivo", razao=1.8)]),
       "service_role", valor=1)
checar("a mesma janela soma (VM reiniciada)", True,
       gravar_srv([linha(E["a"], C["a"], J1, d=10, p=2, ab=1, c=8)]), "service_role", valor=1)
checar("soma nas contagens e por tronco", True,
       f"select discadas || ':' || atendidas_pessoa || ':' || abandonos || ':' || (por_tronco -> 0 ->> 'discadas') "
       f"from public.voz_ritmo_amostras where empresa_id = {E['a']} and janela = '{J1}'", valor="110:14:2:110")
checar("carteira nula (empresa toda) é outra linha", True,
       gravar_srv([linha(E["a"], None, J1, d=5, p=0, ab=0, c=5)]), "service_role", valor=1)

# ------------------------------------------------------------------ recusas
checar("lista com mais de 2000 amostras", False, gravar_srv([linha(E["a"], C["a"], J1)] * 2001), "service_role",
       erro="até 2000")
checar("janela antiga (fora das 48 h)", False,
       gravar_srv([linha(E["a"], C["a"], "2020-01-01T10:00:00-03:00")]), "service_role", erro="últimas 48 h")
checar("razão acima de 3", False, gravar_srv([linha(E["a"], C["a"], J1, razao=3.5)]), "service_role",
       erro="razão de 1 a 3")
checar("modo desconhecido", False, gravar_srv([linha(E["a"], C["a"], J1, modo="progressivo")]), "service_role",
       erro="power|preditivo")
checar("abandonos acima das atendidas", False, gravar_srv([linha(E["a"], C["a"], J1, p=1, ab=2)]), "service_role",
       erro="coerentes")
checar("número negativo", False, gravar_srv([linha(E["a"], C["a"], J1, d=-1)]), "service_role", erro="coerentes")
checar("por_tronco com campo estranho (nada de telefone)", False,
       gravar_srv([linha(E["a"], C["a"], J1, por_tronco=[{"tronco_id": 1, "telefone": 11999999999}])]),
       "service_role", erro="só contagens")
checar("linha repetida", False, gravar_srv([linha(E["a"], C["a"], J1), linha(E["a"], C["a"], J1)]), "service_role",
       erro="uma por empresa")
checar("carteira de outra empresa", False, gravar_srv([linha(E["a"], C["b"], J1)]), "service_role",
       erro="outra empresa")
checar("empresa sem voz configurada", False, gravar_vm([linha(E["s"], None, J1)]), erro="empresa sem voz")
checar("o site não grava (authenticated)", False, gravar_srv([linha(E["a"], C["a"], J1)]), *CL)
checar("nem a equipe pelo site", False, gravar_srv([linha(E["a"], C["a"], J1)]), *TEC)
checar("anon não grava", False, gravar_srv([linha(E["a"], C["a"], J1)]), "anon")
checar("o site não escreve direto na tabela", False,
       f"update public.voz_ritmo_amostras set abandonos = 0 where empresa_id = {E['a']}", *TEC)
checar("a VM só pela função de voz_vm (não chama a do public)", False,
       "set session authorization motorcx_voz; select public.registrar_ritmo_voz('[]'::jsonb)")

# ------------------------------------------------------------------ leitura
checar("sem amostra: taxas nulas (a tela mostra —)", True,
       f"select coalesce(({hoje(E['a'], 999999999)}) ->> 'abandono_pct', 'nulo')", *CL, valor="nulo")
checar("hoje da carteira: totais e taxas", True,
       f"select t ->> 'discadas' || ':' || (t ->> 'atendidas_pessoa') || ':' || (t ->> 'abandonos') || ':' "
       f"|| (t ->> 'abandono_pct') || ':' || (t ->> 'transf_sem_operador_pct') || ':' || (t ->> 'atendimento_pct') "
       f"from ({hoje(E['a'], C['a'])} as t) x", *CL, valor="160:22:2:9.1:9.1:13.8")
checar("hoje da empresa (todas as carteiras)", True,
       f"select ({hoje(E['a'])}) ->> 'discadas'", *CL, valor="165")
checar("última amostra: modo e razão", True,
       f"select u ->> 'modo' || ':' || (u ->> 'razao') from ({hoje(E['a'], C['a'], 'ultima')} as u) x", *CL,
       valor="preditivo:1.80")
checar("janelas de 30 min juntam as de 5", True,
       f"select jsonb_array_length(public.ritmo_voz_hoje({E['a']}, {C['a']}) -> 'janelas')", *CL, valor=1)
checar("por tronco com a bina mascarada (nunca IP)", True,
       f"select x -> 0 ->> 'bina' || '|' || (x::text like '%203.0.113%') from ({hoje(E['a'], C['a'], 'por_tronco')} "
       f"as x) y", *CL, valor="11 3•••-••99|false")
checar("abandono de 30 dias", True,
       f"select ({hoje(E['a'], C['a'], 'abandono_30d')}) ->> 'abandono_pct'", *CL, valor="9.1")
checar("a empresa B lê a sua", True,
       f"select ({hoje(E['b'], C['b'])}) ->> 'abandono_pct'", *CLB, valor="8.3")
checar("outra empresa não lê a A", False, f"select public.ritmo_voz_hoje({E['a']})", *CLB, erro="sem acesso")
checar("equipe que cuida da voz lê", True, f"select ({hoje(E['a'])}) ->> 'discadas'", *TEC, valor="165")
checar("anon não lê", False, f"select public.ritmo_voz_hoje({E['a']})", "anon")
checar("tabela: cliente só a própria empresa", True,
       "select string_agg(distinct empresa_id::text, ',') from public.voz_ritmo_amostras", *CL, valor=E["a"])
checar("tabela: anon não lê", False, "select * from public.voz_ritmo_amostras", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
