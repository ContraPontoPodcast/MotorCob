"""SQL 108 · Agente de voz: Power e abandono digno (Power e Preditivo, V4).

Cobre: a migração roda duas vezes (e sobre o SQL 106 com amostras gravadas); as amostras ganham razao_config e estado
(o que já estava gravado fica 'normal'); recusa estado desconhecido e razão escolhida fora de 1–3; ritmo_voz_hoje
devolve o estado e a razão escolhida; abandonos_recentes_voz devolve só id_cliente e contagens dos últimos 7 dias
(abandonada e abandono_sem_robo; transferência sem operador e abandono antigo não), só para o servidor e a VM.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_ritmo_power.py
Só dados fictícios (empresas e108-*, e-mails @exemplo.test).
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
SQL108 = RAIZ / "supabase" / "migrations" / "20270223000001_voz_ritmo_power.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 108: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL108)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)
checar("amostra gravada antes do SQL 108 fica 'normal'", True,
       "select count(*) from public.voz_ritmo_amostras where estado <> 'normal'", valor=0)

T = uuid.uuid4().hex[:6]
E = sv(f"insert into public.empresas (slug, nome) values ('e108-{T}', 'E108 {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e108b-{T}', 'E108B {T}') returning id")
sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({E}, 'simulador', 'simulado')")
C = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({E}, 'c108{T}', 'Carteira') returning id")
U = sv(f"insert into auth.users (email) values ('cli108-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={E} where id='{U}'")
CL = ("authenticated", U)
J = sv("select to_char(date_trunc('hour', now()) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD\"T\"HH24:MI:SS') "
       "|| '-03:00'")


def gravar(estado="freado", razao=1.0, razao_config=2.0):
    x = {"empresa_id": int(E), "credor_id": int(C), "janela": J, "modo": "power", "razao": razao,
         "razao_config": razao_config, "estado": estado, "discadas": 60, "atendidas_pessoa": 50, "abandonos": 2,
         "curtas": 40, "por_tronco": []}
    return f"select public.registrar_ritmo_voz('{json.dumps([x])}'::jsonb)"


checar("grava razão escolhida e estado", True, gravar(), "service_role", valor=1)
checar("ritmo_voz_hoje: estado e razões", True,
       f"select u ->> 'estado' || ':' || (u ->> 'razao') || ':' || (u ->> 'razao_config') "
       f"from (select public.ritmo_voz_hoje({E}, {C}) -> 'ultima' as u) x", *CL, valor="freado:1.00:2.00")
checar("estado desconhecido", False, gravar(estado="pausado"), "service_role", erro="estado normal|aquecendo")
checar("razão escolhida fora de 1–3", False, gravar(razao_config=4), "service_role", erro="razão de 1 a 3")


def chamada(emp, cid, cli, res, dias=0):
    return (f"insert into public.voz_chamadas (empresa_id, id_chamada, id_cliente, resultado, ocorrido_em) values "
            f"({emp}, '{cid}{T}', '{cli}', '{res}', now() - interval '{dias} days')")


for i, (cli, res, dias) in enumerate([("A1", "abandono_sem_robo", 0), ("A1", "abandonada", 2),
                                      ("B1", "abandono_sem_robo", 1), ("C1", "transferencia_sem_operador", 0),
                                      ("D1", "abandono_sem_robo", 9), ("E1", "promessa", 0)]):
    sv(chamada(E, f"ch{i}x", cli, res, dias))
sv(chamada(EB, "outra", "A1", "abandono_sem_robo"))
checar("abandonos recentes: só abandono do discador nos últimos 7 dias", True,
       f"select string_agg(x ->> 'id_cliente' || ':' || (x ->> 'abandonos'), ',') "
       f"from jsonb_array_elements(public.abandonos_recentes_voz({E})) x", "service_role", valor="A1:2,B1:1")
checar("só id_cliente, abandonos e último dia", True,
       f"select string_agg(distinct k, ',') from jsonb_array_elements(public.abandonos_recentes_voz({E})) x, "
       "jsonb_object_keys(x) k", "service_role", valor="abandonos,id_cliente,ultimo")
checar("a VM lê pela função de voz_vm", True,
       f"set session authorization motorcx_voz; select jsonb_array_length(voz_vm.abandonos_recentes("
       f"'{{\"empresa\": {E}}}'::jsonb))", valor=2)
checar("o site não lê (authenticated)", False, f"select public.abandonos_recentes_voz({E})", *CL)
checar("anon não lê", False, f"select public.abandonos_recentes_voz({E})", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
