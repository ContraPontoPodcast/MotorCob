"""SQL 126 · Agente de voz por minuto falado: consumo do dia e fatura (PR 5).

Cobre: a migração roda duas vezes; voz_consumo_ia_dia recalculado pelo gatilho (ligações, cobradas, segundos, valor;
simulado fora; máquina conta como ligação sem cobrar); custo em consumo_ia pela sessão do provedor (com o toque da ponte)
sem somar em dobro no recálculo (consolidar_consumo_voz); previa_fatura do por minuto: "Agente de voz — minutos
tarifados × preço" com Σ tarifados ÷ 60 e valor arredondado só no total (P5), uma linha por vigência de preço, sem pico
(P9), licença não cobrada no ciclo por minuto (P8), complemento do mínimo mensal; franquia (linha da franquia sempre e
excedente, P6); licença: a franquia conta os minutos falados medidos (P7); **fatura sem diferença** para quem não tem o
modelo novo (comparada com a previa_fatura do SQL 98); margem_ia com a receita do minuto falado; RLS do consumo.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_fatura_minuto.py
Só dados fictícios (empresas e126-*, e-mails @exemplo.test).
"""
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL126 = RAIZ / "supabase" / "migrations" / "20270324000001_voz_consumo_ia.sql"
SQL98 = RAIZ / "supabase" / "migrations" / "20270205000001_voz_licencas_fatura.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 126: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL126)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

# a previa_fatura do SQL 98 (antes deste SQL), com outro nome, para comparar quem não tem o modelo novo
t98 = SQL98.read_text(encoding="utf-8")
p98 = t98[t98.index("create or replace function public.previa_fatura("):t98.index("-- ================ 4.".replace("================ 4.", "================================================================ 4."))]
p98 = p98.replace("function public.previa_fatura(", "function public.previa_fatura_98_teste(", 1)
r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q"], input=p98, capture_output=True, text=True)
assert r.returncode == 0, r.stderr

T = uuid.uuid4().hex[:6]
PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
sv("update public.parametros_margem set impostos_pct = 0 where id = 1")
ITEM_MC = sv("select coalesce(mc_minima_ia_pct::text, 'null') from public.cobranca_itens where codigo = 'voz_minuto_ia'")
sv("update public.cobranca_itens set mc_minima_ia_pct = 60 where codigo = 'voz_minuto_ia'")
EA = sv(f"insert into public.empresas (slug, nome) values ('e126-a-{T}', 'E126 A {T}') returning id")   # por minuto
EF = sv(f"insert into public.empresas (slug, nome) values ('e126-f-{T}', 'E126 F {T}') returning id")   # com franquia
EL = sv(f"insert into public.empresas (slug, nome) values ('e126-l-{T}', 'E126 L {T}') returning id")   # licença
EG = sv(f"insert into public.empresas (slug, nome) values ('e126-g-{T}', 'E126 G {T}') returning id")   # legado
U = {}
for p in ("master", "cli", "clib"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}126-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true, nome='Mara Master' where id='{U['master']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['cli']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EG} where id='{U['clib']}'")
M = ("authenticated", U["master"])
CL = ("authenticated", U["cli"])
CB = ("authenticated", U["clib"])
SR = ("service_role", None)
HOJE = sv("select (now() at time zone 'America/Sao_Paulo')::date")
MES = sv(f"select public.competencia_de({EA}, '{HOJE}')")
INICIO = sv(f"select (public.ciclo_de({EA}, '{MES}')).inicio")
DESDE = "" if HOJE == INICIO else " · desde " + "/".join(HOJE.split("-")[::-1][:2])
CUSTO = float(sv("select public.custo_ia_vigente('voz_minuto_ia', current_date)"))

# legado e licença com consumo da forma antiga (consumo_mensageria), para a comparação com o SQL 98
sv(f"select public.salvar_preco({EG}, 'voz_minuto_ia', 'flat', 1.80)", *M)
sv(f"insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade) "
   f"values ({EG}, date_trunc('month', '{MES}'::date)::date, 'voz_minuto_ia', 100)")
sv(f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, franquia_min_robo, vigente_desde, motivo) "
   f"select {EL}, 1, 'por_robo', preco_tabela, 10, (public.ciclo_de({EL}, '{MES}')).inicio, 'Licença de teste.' "
   f"from public.cobranca_itens where codigo = 'voz_licenca_robo'")
sv(f"select public.salvar_preco({EL}, 'voz_minuto_ia', 'flat', 1.50)", *M)
sv(f"insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade) "
   f"values ({EL}, date_trunc('month', '{MES}'::date)::date, 'voz_minuto_ia', 8)")


def previa(emp, fn="previa_fatura"):
    return (f"select string_agg(item || '=' || quantidade || 'x' || preco || '=' || valor, ' ; ' order by ordem, item) "
            f"from public.{fn}({emp}, '{MES}')")


IGUAIS = ("select count(*) from public.empresas e where not exists (select 1 from public.voz_cobranca_ia x "
          "where x.empresa_id = e.id and x.modelo = 'por_minuto') and exists (select 1 from ("
          f"(select * from public.previa_fatura(e.id, public.competencia_de(e.id, '{HOJE}')) except all "
          f"select * from public.previa_fatura_98_teste(e.id, public.competencia_de(e.id, '{HOJE}'))) union all "
          f"(select * from public.previa_fatura_98_teste(e.id, public.competencia_de(e.id, '{HOJE}')) except all "
          f"select * from public.previa_fatura(e.id, public.competencia_de(e.id, '{HOJE}')))) d)")
checar("fatura sem diferença: nenhuma empresa sem o modelo novo muda (comparada com o SQL 98)", True, IGUAIS, valor=0)

# contratos por minuto
sv(f"select public.salvar_cobranca_ia_voz({EA}, 'por_minuto', 'Contrato por minuto.', preco => 1.25, "
   f"limite_conversas => 5, quando => 'agora', overbooking_confirmado => true)", *M)
sv(f"select public.salvar_cobranca_ia_voz({EF}, 'por_minuto', 'Contrato com franquia.', preco => 1.25, "
   f"limite_conversas => 5, franquia_min => 10, quando => 'agora', overbooking_confirmado => true)", *M)
n = 0


def chamada(emp, segundos, sessao=None, extra_col="", extra_val="", modo="real"):
    global n
    n += 1
    sess = segundos + 5 if sessao is None else sessao
    sv(f"insert into public.voz_chamadas (empresa_id, id_chamada, id_cliente, modo, ocorrido_em, atendida_em, "
       f"encerrada_em, billsec, ia_inicio_em, segundos_ia, segundos_sessao_ia{extra_col}) values ({emp}, 'c126-{T}-{n}', "
       f"'K{n}', '{modo}', now(), now(), now() + interval '2 minutes', 120, now(), {segundos}, {sess}{extra_val})")


# ------------------------------------------------------------------ consumo do dia
chamada(EA, 47, 85)                     # 48 s · sessão com o toque da ponte (custo nosso)
chamada(EA, 12, 17)                     # 30 s
chamada(EA, 40, 0, ", resultado", ", 'maquina'")     # máquina: 0
chamada(EA, 100, 105, modo="simulado")      # simulado: fora
checar("consumo do dia: 3 ligações, 2 cobradas, 99 s falados, 78 s tarifados, R$ 1,625", True,
       f"select ligacoes || '|' || ligacoes_cobradas || '|' || segundos_ia || '|' || segundos_ia_tarifados || '|' || valor "
       f"|| '|' || modelo || '|' || cadencia_ia || '|' || preco_minuto_ia from public.voz_consumo_ia_dia "
       f"where empresa_id = {EA}", valor="3|2|99.000|78|1.62500|por_minuto|0/30/6|1.25000")
checar("custo em consumo_ia: quantidade = tarifados ÷ 60 e custo = sessão ÷ 60 × custo do minuto", True,
       f"select round(quantidade, 4) || '|' || (abs(custo - round(102 / 60.0 * {CUSTO}, 5)) < 0.0001) from public.consumo_ia "
       f"where empresa_id = {EA} and item = 'voz_minuto_ia'", valor="1.3000|true")
checar("o recálculo pelo servidor (consolidar_consumo_voz) não soma em dobro", True,
       f"select public.consolidar_consumo_voz({EA}, '{HOJE}'); reset role; "
       f"select round(quantidade, 4) from public.consumo_ia where empresa_id = {EA} and item = 'voz_minuto_ia'", *SR,
       valor="1.3000")
checar("o site não consolida", False, f"select public.consolidar_consumo_ia_voz({EA}, '{HOJE}')", *CL,
       erro="permission denied")

# ------------------------------------------------------------------ fatura do por minuto
checar("prévia: minutos tarifados × preço = 1,30 × 1,25 = R$ 1,63 (arredonda só no total), sem pico", True,
       f"select item || '|' || quantidade || '|' || preco || '|' || valor || '|' || (descricao like 'Agente de voz — minutos tarifados × preço%') "
       f"from public.previa_fatura({EA}, '{MES}') where item like 'voz_minuto_ia%'", valor="voz_minuto_ia|1.30|1.25000|1.63|true")
checar("prévia: a descrição traz a cadência e as ligações cobradas", True,
       f"select descricao from public.previa_fatura({EA}, '{MES}') where item = 'voz_minuto_ia'",
       valor="Agente de voz — minutos tarifados × preço · cadência 0/30/6 · 2 ligações" + DESDE)
sv(f"select public.salvar_cobranca_ia_voz({EA}, 'por_minuto', 'Reajuste negociado.', preco => 1.40, quando => 'agora')", *M)
chamada(EA, 12)
checar("preço novo agora: uma linha por vigência de preço", True,
       f"select string_agg(item || '=' || quantidade || 'x' || preco || '=' || valor, ' ; ' order by item) "
       f"from public.previa_fatura({EA}, '{MES}') where item like 'voz_minuto_ia%'",
       valor="voz_minuto_ia=1.30x1.25000=1.63 ; voz_minuto_ia_2=0.50x1.40000=0.70")
sv(f"update public.precos_empresa set minimo = 50 where empresa_id = {EA} and item = 'voz_minuto_ia'")
checar("sem franquia, o mínimo mensal do preço da empresa vale (complemento)", True,
       f"select valor from public.previa_fatura({EA}, '{MES}') where item = 'voz_minuto_ia_minimo'", valor="47.67")
sv(f"update public.precos_empresa set minimo = 0 where empresa_id = {EA} and item = 'voz_minuto_ia'")
sv(f"insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade) "
   f"values ({EA}, date_trunc('month', '{MES}'::date)::date, 'voz_minuto_ia_pico', 7)")
checar("por minuto: o pico não entra (P9)", True,
       f"select count(*) from public.previa_fatura({EA}, '{MES}') where item like 'voz_minuto_ia_pico%'", valor=0)

# ------------------------------------------------------------------ franquia
chamada(EF, 47)
checar("franquia: a linha da franquia sempre aparece (10 min × R$ 1,25 = R$ 12,50) e sem excedente", True,
       f"select string_agg(item || '=' || quantidade || 'x' || preco || '=' || valor, ' ; ' order by item) "
       f"from public.previa_fatura({EF}, '{MES}') where item like 'voz_minuto_ia%'",
       valor="voz_minuto_ia_franquia=10x1.25000=12.50")
for _ in range(11):
    chamada(EF, 60)
checar("franquia: o excedente (11,80 − 10 = 1,80 min × R$ 1,25 = R$ 2,25)", True,
       f"select quantidade || 'x' || preco || '=' || valor from public.previa_fatura({EF}, '{MES}') "
       f"where item = 'voz_minuto_ia'", valor="1.80x1.25000=2.25")

# ------------------------------------------------------------------ licença: a franquia conta os minutos medidos
ANTES_L = sv(previa(EL))
chamada(EL, 47.2)                       # ceil: 48 s
checar("licença: a ligação medida conta 48 s (ceil, sem cadência) no consumo", True,
       f"select modelo || '|' || segundos_ia_tarifados || '|' || coalesce(valor::text, '-') from public.voz_consumo_ia_dia "
       f"where empresa_id = {EL}", valor="licenca|48|-")
checar("licença: a franquia passa a contar 8 + 1 = 9 min", True,
       f"select quantidade from public.previa_fatura({EL}, '{MES}') where item = 'voz_minuto_ia_franquia'", valor=9)
checar("licença: a licença segue sendo cobrada como antes", True,
       f"select count(*) from public.previa_fatura({EL}, '{MES}') where item = 'voz_licenca_robo'", valor=1)

# ------------------------------------------------------------------ legado: nada muda
ANTES_G = sv(previa(EG))
chamada(EG, 47)
checar("legado sem contrato: a ligação medida não muda a fatura", True, previa(EG), valor=ANTES_G)
checar("legado: o consumo do dia fica como legado, sem valor", True,
       f"select modelo || '|' || coalesce(valor::text, '-') from public.voz_consumo_ia_dia where empresa_id = {EG}",
       valor="legado|-")
checar("fatura sem diferença de novo, com as ligações medidas (a franquia da licença é a mesma função nos dois)", True,
       IGUAIS, valor=0)

# ------------------------------------------------------------------ margem e leitura
checar("margem_ia: receita do minuto falado = Σ valor do mês (R$ 1,63 + R$ 0,70)", True,
       f"select receita || '|' || (custo > 0) from public.margem_ia('{HOJE}') where empresa_id = {EA} and item = 'voz_minuto_ia'",
       *M, valor="2.33|true")
checar("cliente com ve_faturamento lê o consumo da empresa", True,
       f"select count(*) > 0 from public.voz_consumo_ia_dia where empresa_id = {EA}", *CL, valor="t")
checar("cliente de outra empresa não lê", True,
       f"select count(*) from public.voz_consumo_ia_dia where empresa_id = {EA}", *CB, valor=0)
checar("ninguém grava pelo site", False,
       f"insert into public.voz_consumo_ia_dia (empresa_id, dia, modelo) values ({EA}, current_date, 'legado')", *CL,
       erro="permission denied")
checar("anon não lê", False, "select count(*) from public.voz_consumo_ia_dia", "anon", erro="permission denied")
checar("RLS ligada", True, "select relrowsecurity from pg_class where oid = 'public.voz_consumo_ia_dia'::regclass",
       valor="t")

sv("drop function public.previa_fatura_98_teste(bigint, date)")
sv(f"update public.cobranca_itens set mc_minima_ia_pct = {ITEM_MC} where codigo = 'voz_minuto_ia'")
imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
