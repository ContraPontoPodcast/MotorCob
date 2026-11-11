"""SQL 127 · Agente de voz por minuto falado: demonstrativo por ligação e por mês (PR 6).

Cobre: a migração roda duas vezes; demonstrativo_ia_voz (ligações tarifadas do ciclo, sem telefone nem id_cliente, fora o
simulado, páginas de 1.000); resumo_ia_voz por dia; quem lê (ve_faturamento da empresa; outra empresa e anon não); a
fatura que sai do rascunho congela o resumo (P12) e as ligações novas não mexem no congelado.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_demonstrativo_ia.py
Só dados fictícios (empresas e127-*, e-mails @exemplo.test).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL127 = RAIZ / "supabase" / "migrations" / "20270325000001_voz_demonstrativo_ia.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 127: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL127)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
sv("update public.parametros_margem set impostos_pct = 0 where id = 1")
ITEM_MC = sv("select coalesce(mc_minima_ia_pct::text, 'null') from public.cobranca_itens where codigo = 'voz_minuto_ia'")
sv("update public.cobranca_itens set mc_minima_ia_pct = 60 where codigo = 'voz_minuto_ia'")
EA = sv(f"insert into public.empresas (slug, nome) values ('e127-a-{T}', 'E127 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e127-b-{T}', 'E127 B {T}') returning id")
U = {}
for p in ("master", "cli", "cliop", "clib"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}127-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['master']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['cli']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['cliop']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EB} where id='{U['clib']}'")
M = ("authenticated", U["master"])
CL = ("authenticated", U["cli"])
CO = ("authenticated", U["cliop"])
CB = ("authenticated", U["clib"])
HOJE = sv("select (now() at time zone 'America/Sao_Paulo')::date")
MES = sv(f"select public.competencia_de({EA}, '{HOJE}')")
sv(f"select public.salvar_cobranca_ia_voz({EA}, 'por_minuto', 'Contrato por minuto.', preco => 1.25, "
   f"limite_conversas => 5, quando => 'agora', overbooking_confirmado => true)", *M)
n = 0


def chamada(segundos, modo="real"):
    global n
    n += 1
    sv(f"insert into public.voz_chamadas (empresa_id, id_chamada, id_cliente, modo, ocorrido_em, atendida_em, encerrada_em, "
       f"billsec, ia_inicio_em, ia_fim_em, ia_trechos, segundos_ia, segundos_sessao_ia) values ({EA}, "
       f"'c127-{T}-{n}', 'CLIENTE{n}', '{modo}', now(), now(), now() + interval '2 minutes', 120, now(), "
       f"now() + interval '{segundos} seconds', jsonb_build_array(jsonb_build_array(now(), now() + interval '{segundos} seconds', 'fim')), "
       f"{segundos}, {segundos})")


chamada(47)
chamada(12)
chamada(30, modo="simulado")

checar("demonstrativo: as 2 ligações reais do ciclo (simulado fora), com tarifado e valor", True,
       f"select string_agg(segundos_ia_tarifados || ':' || valor_ia, ',' order by id) "
       f"from public.demonstrativo_ia_voz({EA}, '{MES}')", *CL, valor="48:1.00000,30:0.62500")
checar("demonstrativo: sem telefone, máscara nem id_cliente", True,
       "select pg_get_function_result('public.demonstrativo_ia_voz(bigint, date, int)'::regprocedure) "
       "!~ '(id_cliente|destino_mascara|destino_hash|telefone|transcricao)'", valor="t")
checar("demonstrativo: página 1 vazia (1.000 por página)", True,
       f"select count(*) from public.demonstrativo_ia_voz({EA}, '{MES}', 1)", *CL, valor=0)
checar("demonstrativo: página negativa é recusada", False,
       f"select count(*) from public.demonstrativo_ia_voz({EA}, '{MES}', -1)", *CL, erro="página")
checar("resumo por dia: 2 ligações, 78 s tarifados, R$ 1,625, ao vivo", True,
       f"select ligacoes || '|' || segundos_ia_tarifados || '|' || valor || '|' || congelado "
       f"from public.resumo_ia_voz({EA}, '{MES}')", *CL, valor="2|78|1.62500|false")
checar("perfil sem ver_faturamento não lê", False, f"select count(*) from public.resumo_ia_voz({EA}, '{MES}')", *CO,
       erro="sem permissão")
checar("outra empresa não lê o demonstrativo", False,
       f"select count(*) from public.demonstrativo_ia_voz({EA}, '{MES}')", *CB, erro="sem permissão")
checar("anon não lê", False, f"select count(*) from public.resumo_ia_voz({EA}, '{MES}')", "anon",
       erro="permission denied")

# ------------------------------------------------------------------ fatura fechada congela (P12)
FA = sv(f"insert into public.faturas (empresa_id, competencia, valor_total, vencimento, modelo, situacao) "
        f"values ({EA}, '{MES}', 1.63, current_date + 10, 'contrato', 'rascunho') returning id")
checar("rascunho não congela", True, f"select count(*) from public.faturas_demonstrativo_voz where fatura_id = {FA}",
       valor=0)
sv(f"select set_config('motorcob.emitindo', '1', false); update public.faturas set situacao = 'aberta' where id = {FA}")
checar("rascunho → aberta congela o resumo do ciclo", True,
       f"select sum(segundos_ia_tarifados) || '|' || sum(valor) from public.faturas_demonstrativo_voz where fatura_id = {FA}",
       valor="78|1.62500")
chamada(95)
checar("ligação nova não muda o resumo congelado da fatura fechada", True,
       f"select sum(segundos_ia_tarifados) || '|' || bool_and(congelado) from public.resumo_ia_voz({EA}, '{MES}')", *CL,
       valor="78|true")
checar("o cliente lê o congelado da própria empresa", True,
       f"select count(*) > 0 from public.faturas_demonstrativo_voz where empresa_id = {EA}", *CL, valor="t")
checar("outra empresa não lê o congelado", True,
       f"select count(*) from public.faturas_demonstrativo_voz where empresa_id = {EA}", *CB, valor=0)

sv(f"update public.cobranca_itens set mc_minima_ia_pct = {ITEM_MC} where codigo = 'voz_minuto_ia'")
imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
