"""Testa as permissões (RLS) da migração do MotorCob num Postgres local.

Pré-requisito: um banco vazio com a imitação do Supabase e a migração aplicadas:
    psql -d sb -f supabase/testes/stub_supabase.sql
    psql -d sb -f supabase/migrations/20260925000001_motorcob.sql
    PGHOST=... PGPORT=... PGUSER=postgres python supabase/testes/testar_rls.py
Conexão pelas variáveis padrão do psql (PGHOST, PGPORT, PGUSER); banco: PGDATABASE ou 'sb'.
"""
import os
import subprocess
import sys

BASE = ["psql", "-d", os.environ.get("PGDATABASE", "sb"), "-v", "ON_ERROR_STOP=1", "-Atq"]

def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()

ok_total = falhas = 0
def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor))
    ok_total += passou; falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:120]}"))

# usuários (trigger cria perfil operacao) e papéis definidos pelo "admin do banco"
ids = {}
for p in ("admin", "plan", "oper", "gest", "inativo"):
    _, out, _ = sql(f"insert into auth.users (email) values ('{p}@x.com') returning id")
    ids[p] = out
sql(f"update public.perfis set papel='admin' where id='{ids['admin']}'")
sql(f"update public.perfis set papel='planejamento' where id='{ids['plan']}'")
sql(f"update public.perfis set papel='gestao' where id='{ids['gest']}'")
sql(f"update public.perfis set ativo=false where id='{ids['inativo']}'")
# dados que a rotina (service_role) grava
sql("set role service_role; insert into public.estado_cliente (id_cliente,tag,safra,cluster_origem,cluster_atual,estado,canal) values "
    "('C1','S260801-A1-CPA-WA-T1','2026-08-01','A1','A1','CPA','WA'),('C2','S260801-M1-LOC-ND-L1','2026-08-01','M1','M1','LOC','ND');"
    "insert into public.fila_dia values ('2026-09-25','whatsapp','C1',false,'cpc','T1','x'),('2026-09-25','discador','C2',true,'localizacao','D+5','y');"
    "insert into public.trilha (id_cliente,data,tag,motivo,quem_marcou) values ('C1','2026-08-04','S260801-A1-CPA-WA-T1','contato','WhatsApp');"
    "insert into storage.objects (bucket_id,name) values ('saidas','2026-09-25/ids/whatsapp.csv'),('saidas','2026-09-25/fila_do_dia.csv'),('saidas','comite/2026-09/comite.xlsx')")

u = ids
checar("trigger criou perfil para cada convidado", True, "select count(*) from public.perfis", valor=5)
checar("anon não lê estado_cliente", False, "select * from public.estado_cliente", "anon")
checar("anon não lê fila", False, "select * from public.fila_dia", "anon")
checar("operação lê fila (2 linhas)", True, "select count(*) from public.fila_dia", "authenticated", u["oper"], 2)
checar("operação lê trilha", True, "select count(*) from public.trilha", "authenticated", u["oper"], 1)
checar("resumo_estados agrega", True, "select string_agg(estado||'='||clientes, ',' order by estado) from public.resumo_estados", "authenticated", u["oper"], "CPA=1,LOC=1")
checar("resumo_fila separa reserva", True, "select count(*) from public.resumo_fila", "authenticated", u["gest"], 2)
checar("inativo não vê nada", True, "select count(*) from public.fila_dia", "authenticated", u["inativo"], 0)
checar("operação vê só o próprio perfil", True, "select count(*) from public.perfis", "authenticated", u["oper"], 1)
checar("admin vê todos os perfis", True, "select count(*) from public.perfis", "authenticated", u["admin"], 5)
checar("operação não se promove a admin (0 linhas)", True, f"with x as (update public.perfis set papel='admin' where id='{u['oper']}' returning 1) select count(*) from x", "authenticated", u["oper"], 0)
checar("papel da operação continua operacao", True, f"select papel from public.perfis where id='{u['oper']}'", valor="operacao")
checar("operação não altera perfil de outro (0 linhas)", True, f"with x as (update public.perfis set nome='z' where id='{u['plan']}' returning 1) select count(*) from x", "authenticated", u["oper"], 0)
checar("admin promove operação", True, f"update public.perfis set papel='planejamento' where id='{u['oper']}'; update public.perfis set papel='operacao' where id='{u['oper']}'", "authenticated", u["admin"])
checar("operação não escreve em estado_cliente", False, "insert into public.estado_cliente values ('C9','t','2026-01-01','A1','A1','LOC','ND','',null,now())", "authenticated", u["oper"])
checar("operação não cria envio", False, "insert into public.envios (tipo,caminho,nome_original) values ('clientes','clientes/2026-09-25/a.csv','a.csv')", "authenticated", u["oper"])
checar("planejamento cria envio", True, "insert into public.envios (tipo,caminho,nome_original) values ('clientes','clientes/2026-09-25/a.csv','a.csv')", "authenticated", u["plan"])
checar("planejamento não cria envio já 'processado'", False, "insert into public.envios (tipo,caminho,nome_original,status) values ('clientes','clientes/2026-09-25/b.csv','b.csv','processado')", "authenticated", u["plan"])
checar("planejamento não cria envio em nome de outro", False, f"insert into public.envios (tipo,caminho,nome_original,enviado_por) values ('clientes','clientes/2026-09-25/c.csv','c.csv','{u['admin']}')", "authenticated", u["plan"])
checar("planejamento sobe arquivo em entradas/clientes", True, "insert into storage.objects (bucket_id,name) values ('entradas','clientes/2026-09-25/a.csv')", "authenticated", u["plan"])
checar("planejamento não sobe em pasta desconhecida", False, "insert into storage.objects (bucket_id,name) values ('entradas','outra/a.csv')", "authenticated", u["plan"])
checar("operação não sobe arquivo", False, "insert into storage.objects (bucket_id,name) values ('entradas','clientes/2026-09-25/x.csv')", "authenticated", u["oper"])
checar("operação vê só ids no bucket saidas", True, "select string_agg(name, ',') from storage.objects where bucket_id='saidas'", "authenticated", u["oper"], "2026-09-25/ids/whatsapp.csv")
checar("gestão vê ids + comitê, não fila_do_dia", True, "select string_agg(name, ',' order by name) from storage.objects where bucket_id='saidas'", "authenticated", u["gest"], "2026-09-25/ids/whatsapp.csv,comite/2026-09/comite.xlsx")
checar("planejamento vê todas as saídas", True, "select count(*) from storage.objects where bucket_id='saidas'", "authenticated", u["plan"], 3)
checar("operação não lê entradas", True, "select count(*) from storage.objects where bucket_id='entradas'", "authenticated", u["oper"], 0)
checar("usuário registra o próprio acesso", True, "insert into public.acessos (acao,alvo) values ('download','2026-09-25/ids/whatsapp.csv')", "authenticated", u["oper"])
checar("usuário não registra acesso em nome de outro", False, f"insert into public.acessos (usuario,acao,alvo) values ('{u['plan']}','download','x')", "authenticated", u["oper"])
checar("operação não lê auditoria", True, "select count(*) from public.acessos", "authenticated", u["oper"], 0)
checar("gestão lê auditoria", True, "select count(*) from public.acessos", "authenticated", u["gest"], 1)
checar("rotina (service_role) atualiza status do envio", True, "update public.envios set status='processado', relatorio='{\"linhas\":10}'", "service_role")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
