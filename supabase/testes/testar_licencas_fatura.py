"""SQL 98 · Agente de voz: robôs contratados (licenças) na fatura, PR 2.

Cobre: a migração roda duas vezes; previa_fatura com a licença lida de voz_licencas (nunca do preço que o SQL 93 grava
em precos_empresa): ciclo cheio por robô e valor fechado; contrato que começa no meio do ciclo; aumento no meio com pro
rata contando o dia da mudança; troca de preço "agora" (crédito pelos dias restantes); duas gravações no mesmo dia
(vale a última); ciclo com dia de corte (o pro rata conta os dias do ciclo, não do mês); franquia do voz_minuto_ia
vinda da licença (pelos dias de cada vigência) e excedente cobrado pelo preço da empresa, com os minutos de pico
juntos e sem o mínimo mensal; voz_plataforma e voz_transcricao cortadas para quem tem licença (transcrição só se
inclusa); gestao_tronco_sip segue; legado (sem licença ou licença só agendada) igual a antes; fechar_fatura grava os
itens (chave fatura_id + item) e o total; pico desligado para quem tem licença em divisao_concorrencia_voz() e em
voz_vm.config; "agora" pela RPC usa o dia de America/Sao_Paulo (sessão em outro fuso) e entra no pro rata; o cliente
sem ve_faturamento não lê a prévia; as funções novas não são chamáveis pelo site.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_licencas_fatura.py
Só dados fictícios (empresas e98-*, e-mails @exemplo.test).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 98: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL98)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
TETO_ANTES = sv("select concorrencia_contratada from public.voz_contrato")
sv("update public.parametros_margem set impostos_pct = 0, mc_minima_ia_pct = 70 where id = 1")
E = {}
for k in ("a", "b", "c", "d", "e", "f", "g", "h"):
    E[k] = sv(f"insert into public.empresas (slug, nome) values ('e98-{k}-{T}', 'E98 {k.upper()} {T}') returning id")
U = {}
for p in ("master", "cli", "cliop"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}98-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['master']}'")
sv(f"update public.perfis set papel='admin', empresa_id={E['a']} where id='{U['cli']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={E['a']} where id='{U['cliop']}'")
M = ("authenticated", U["master"])
CL = ("authenticated", U["cli"])
CO = ("authenticated", U["cliop"])


def lic(emp, desde, robos, preco=None, fechado=None, fr=4000, transc="true"):
    modelo = "valor_fechado" if fechado is not None else "por_robo"
    sv(f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, valor_fechado, franquia_min_robo, "
       f"transcricao_inclusa, vigente_desde, motivo) values ({emp}, {robos}, '{modelo}', "
       f"{'null' if preco is None else preco}, {'null' if fechado is None else fechado}, {fr}, {transc}, "
       f"'{desde}', 'Contrato de teste.')")


def preco(emp, item, modelo, valor, minimo=0):
    # fixture: sem os gatilhos de guarda (o custo da IA no banco de teste muda com os outros testes)
    sv(f"set session_replication_role = replica; "
       f"insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde) "
       f"values ({emp}, '{item}', '{modelo}', {valor}, {minimo}, '2026-01-01')")


def consumo(emp, mes, item, qtd):
    sv(f"insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade) "
       f"values ({emp}, '{mes}', '{item}', {qtd})")


def linhas(emp, comp, filtro="item like 'voz%' or item like 'gestao%'"):
    return (f"select coalesce(string_agg(item || '=' || valor::numeric(14,2), ',' order by ordem, item), '') "
            f"from public.previa_fatura({emp}, '{comp}') where {filtro}")


def campo(emp, comp, item, col):
    return f"select {col} from public.previa_fatura({emp}, '{comp}') where item = '{item}'"


for k in E:
    sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo, canais) values ({E[k]}, 'agente_voz', true, '{{}}') "
       f"on conflict (empresa_id, modulo) do update set ativo = true")
    preco(E[k], "voz_plataforma", "mensalidade", 500)
    preco(E[k], "voz_minuto_ia", "flat", 2, minimo=100)
    preco(E[k], "voz_minuto_ia_pico", "flat", 4)
    preco(E[k], "voz_transcricao", "flat", 0.1)
    preco(E[k], "gestao_tronco_sip", "flat", 200)

# ------------------------------------------------------------------ A: por robô, começa no meio de jan, aumento em mar
EA = E["a"]
lic(EA, "2026-01-10", 10, preco=6000)
lic(EA, "2026-03-15", 15, preco=6000)
# o preço que o SQL 93 grava em precos_empresa vale o mês inteiro: a fatura não pode ler dali
sv(f"select set_config('motorcx.salvando_licenca_voz', '1', false); insert into public.precos_empresa "
   f"(empresa_id, item, modelo, preco, minimo, vigente_desde, franquia) values ({EA}, 'voz_licenca_robo', 'mensalidade', "
   f"99999, 0, '2026-03-01', 4000)")
consumo(EA, "2026-03-01", "voz_minuto_ia", 50000)
consumo(EA, "2026-03-01", "voz_minuto_ia_pico", 2000)
consumo(EA, "2026-03-01", "voz_transcricao", 300)
consumo(EA, "2026-03-01", "gestao_tronco_sip", 2)
consumo(EA, "2026-02-01", "voz_minuto_ia", 10)

checar("jan (contrato desde 10/01): só a linha de início, 22 de 31 dias (60.000 × 22 ÷ 31)", True,
       linhas(EA, "2026-01-01", "item like 'voz_licenca%'"), valor="voz_licenca_robo_ajuste=42580.65")
checar("jan: descrição diz o início e os dias", True, campo(EA, "2026-01-01", "voz_licenca_robo_ajuste", "descricao"),
       valor="Agente virtual · robôs (licenças) · início em 10/01, 10 robôs (22 de 31 dias)")
checar("fev (ciclo cheio): 10 robôs × 6.000, franquia de 40.000 min sem excedente, sem plataforma cobrada", True,
       linhas(EA, "2026-02-01"),
       valor="voz_licenca_robo=60000.00,voz_plataforma=0.00,voz_minuto_ia_franquia=0.00")
checar("fev: com licença o mínimo mensal do minuto de IA não vale (10 min, mínimo 100)", True,
       f"select count(*) from public.previa_fatura({EA}, '2026-02-01') where item like '%minimo'", valor=0)
checar("fev: a franquia aparece com o uso (10 de 40.000 min)", True,
       campo(EA, "2026-02-01", "voz_minuto_ia_franquia", "descricao"),
       valor="Agente virtual · minuto de IA · 10 de 40.000 min da franquia (incluída nos robôs)")
checar("mar: base 10 robôs + ajuste pro rata de 5 robôs por 17 de 31 dias (dia 15 conta)", True,
       linhas(EA, "2026-03-01", "item like 'voz_licenca%'"),
       valor="voz_licenca_robo=60000.00,voz_licenca_robo_ajuste=16451.61")
checar("mar: ajuste em robô·mês × preço por robô (5 × 17 ÷ 31 = 2,7419 × 6.000)", True,
       campo(EA, "2026-03-01", "voz_licenca_robo_ajuste", "quantidade || '|' || preco::numeric(14,2) || '|' || descricao"),
       valor="2.7419|6000.00|Agente virtual · robôs (licenças) · ajuste pro rata: de 10 para 15 robôs desde 15/03 "
             "(17 de 31 dias)")
checar("mar: o preço gravado em precos_empresa (mensalidade 99.999) não entra", True,
       f"select count(*) from public.previa_fatura({EA}, '2026-03-01') where valor = 99999", valor=0)
# franquia = (10 × 4.000 × 14 + 15 × 4.000 × 17) ÷ 31 = 50.967,7 → 50.968; uso 50.000 + 2.000 de pico → excedente 1.032
checar("mar: franquia pelos dias de cada vigência (50.968 min), pico junto, excedente 1.032 × R$ 2", True,
       campo(EA, "2026-03-01", "voz_minuto_ia", "quantidade || '|' || valor::numeric(14,2)"),
       valor="1032|2064.00")
checar("mar: linha da franquia com 50.968 min incluídos", True,
       campo(EA, "2026-03-01", "voz_minuto_ia_franquia", "quantidade"), valor=50968)
checar("mar: sem minuto de pico a 2× para quem tem licença", True,
       f"select count(*) from public.previa_fatura({EA}, '2026-03-01') where item = 'voz_minuto_ia_pico'", valor=0)
checar("mar: plataforma e transcrição zeradas (incluídas), gestão de tronco cobrada", True,
       linhas(EA, "2026-03-01", "item in ('voz_plataforma', 'voz_transcricao', 'gestao_tronco_sip')"),
       valor="voz_plataforma=0.00,voz_transcricao=0.00,gestao_tronco_sip=400.00")
checar("mar: transcrição mostra os minutos incluídos", True,
       campo(EA, "2026-03-01", "voz_transcricao", "descricao"),
       valor="Agente virtual · transcrição · 300 min (incluída nos robôs)")

# ------------------------------------------------------------------ B: valor fechado, sem transcrição, aumento em mar
EB = E["b"]
lic(EB, "2026-02-01", 20, fechado=130000, transc="false")
lic(EB, "2026-03-21", 25, fechado=150000, transc="false")
consumo(EB, "2026-03-01", "voz_transcricao", 1000)
checar("valor fechado: base do mês + ajuste (150.000 − 130.000) × 11 ÷ 31", True,
       linhas(EB, "2026-03-01", "item like 'voz_licenca%'"),
       valor="voz_licenca_robo=130000.00,voz_licenca_robo_ajuste=7096.77")
checar("valor fechado: descrição da base", True, campo(EB, "2026-03-01", "voz_licenca_robo", "descricao"),
       valor="Agente virtual · robôs (licenças) · valor fechado, 20 robôs")
checar("valor fechado: ajuste em fração do mês × diferença do total", True,
       campo(EB, "2026-03-01", "voz_licenca_robo_ajuste", "quantidade || '|' || preco::numeric(14,2)"),
       valor="0.3548|20000.00")
checar("transcrição fora da licença: cobrada (1.000 × R$ 0,10); plataforma zerada", True,
       linhas(EB, "2026-03-01", "item in ('voz_plataforma', 'voz_transcricao')"),
       valor="voz_plataforma=0.00,voz_transcricao=100.00")
checar("franquia sem uso aparece com 0 (20 × 4.000 × 20 + 25 × 4.000 × 11) ÷ 31 = 87.097", True,
       campo(EB, "2026-03-01", "voz_minuto_ia_franquia", "quantidade || '|' || descricao"),
       valor="0|Agente virtual · minuto de IA · 0 de 87.097 min da franquia (incluída nos robôs)")

# ------------------------------------------------------------------ C: troca de preço agora e duas no mesmo dia
EC = E["c"]
lic(EC, "2026-01-01", 10, preco=6000)
lic(EC, "2026-03-11", 10, preco=5000)
lic(EC, "2026-03-20", 12, preco=5000)
lic(EC, "2026-03-20", 14, preco=5000)
checar("preço menor agora: crédito pelos dias restantes; no mesmo dia vale a última (14)", True,
       linhas(EC, "2026-03-01", "item like 'voz_licenca%'"),
       valor="voz_licenca_robo=60000.00,voz_licenca_robo_ajuste=-6774.19,voz_licenca_robo_ajuste_2=7741.94")
checar("troca de preço: descrição", True, campo(EC, "2026-03-01", "voz_licenca_robo_ajuste", "descricao"),
       valor="Agente virtual · robôs (licenças) · ajuste pro rata: preço novo desde 11/03 (21 de 31 dias)")
checar("aumento no mesmo dia: de 10 para 14 (não 12), 12 dias", True,
       campo(EC, "2026-03-01", "voz_licenca_robo_ajuste_2", "quantidade || '|' || preco::numeric(14,2)"),
       valor="1.5484|5000.00")
checar("somadas, as linhas dão o valor de cada vigência pelos dias (60.000×10 + 50.000×9 + 70.000×12) ÷ 31", True,
       f"select sum(valor) = round(60000 + (-10000) * 21 / 31.0, 2) + round(20000 * 12 / 31.0, 2) "
       f"and abs(sum(valor) - (60000 * 10 + 50000 * 9 + 70000 * 12) / 31.0) < 0.02 "
       f"from public.previa_fatura({EC}, '2026-03-01') where item like 'voz_licenca%'", valor="t")

# ------------------------------------------------------------------ D: legado (sem licença) igual a antes
ED = E["d"]
consumo(ED, "2026-03-01", "voz_minuto_ia", 40)
consumo(ED, "2026-03-01", "voz_minuto_ia_pico", 10)
consumo(ED, "2026-03-01", "voz_transcricao", 50)
checar("legado: plataforma (mensalidade), minuto de IA com mínimo, pico a parte e transcrição", True,
       linhas(ED, "2026-03-01", "item like 'voz%'"),
       valor="voz_plataforma=500.00,voz_minuto_ia=80.00,voz_minuto_ia_pico=40.00,voz_transcricao=5.00,"
             "voz_minuto_ia_minimo=20.00")

# ------------------------------------------------------------------ E: licença só agendada (abril)
EE = E["e"]
lic(EE, "2026-04-01", 5, preco=6000, fr=1000)
consumo(EE, "2026-03-01", "voz_minuto_ia", 100)
checar("licença que começa em abril: março segue legado (plataforma cobrada, sem linha de robôs)", True,
       linhas(EE, "2026-03-01", "item like 'voz%'"), valor="voz_plataforma=500.00,voz_minuto_ia=200.00")
checar("abril: ciclo cheio com 5 robôs e franquia de 5.000 min", True, linhas(EE, "2026-04-01", "item like 'voz%'"),
       valor="voz_licenca_robo=30000.00,voz_plataforma=0.00,voz_minuto_ia_franquia=0.00")

# ------------------------------------------------------------------ F: ciclo com dia de corte 15
EF = E["f"]
sv(f"insert into public.ciclo_empresa (empresa_id, dia_corte) values ({EF}, 15)")
lic(EF, "2026-03-01", 5, preco=6000)
lic(EF, "2026-04-01", 8, preco=6000)
checar("corte dia 15: competência abril = 15/03 a 14/04 (31 dias); aumento em 01/04 conta 14 dias", True,
       linhas(EF, "2026-04-01", "item like 'voz_licenca%'"),
       valor="voz_licenca_robo=30000.00,voz_licenca_robo_ajuste=8129.03")
checar("corte dia 15: competência março (15/02 a 14/03, 28 dias): início em 01/03, 14 dias", True,
       campo(EF, "2026-03-01", "voz_licenca_robo_ajuste", "valor::numeric(14,2) || '|' || descricao"),
       valor="15000.00|Agente virtual · robôs (licenças) · início em 01/03, 5 robôs (14 de 28 dias)")

# ------------------------------------------------------------------ G: robôs zerados no ciclo = legado
EG = E["g"]
lic(EG, "2026-01-01", 3, preco=6000)
lic(EG, "2026-03-01", 0, preco=6000)
checar("licença com 0 robôs no ciclo: nada da licença e o legado volta (plataforma cobrada)", True,
       linhas(EG, "2026-03-01", "item like 'voz%'"),
       valor="voz_plataforma=500.00,voz_minuto_ia=0.00,voz_minuto_ia_minimo=100.00")

# ------------------------------------------------------------------ fechar_fatura grava os itens
checar("fechar_fatura (março de A): grava cada linha (itens distintos) e o total = soma da prévia", True,
       f"create temp table x as select public.fechar_fatura({EA}, '2026-03-01') as id; "
       f"select f.valor_total = (select sum(valor) from public.previa_fatura({EA}, '2026-03-01')) "
       f"and (select count(*) from public.fatura_itens i where i.fatura_id = f.id and i.item like 'voz_licenca%') = 2 "
       f"from x join public.faturas f on f.id = x.id", valor="t")
checar("fechar_fatura de C (dois ajustes no ciclo) não bate na chave (fatura_id, item)", True,
       f"create temp table x as select public.fechar_fatura({EC}, '2026-03-01') as id; "
       f"select count(*) from x join public.fatura_itens i on i.fatura_id = x.id where i.item like 'voz_licenca%'",
       valor=3)

# ------------------------------------------------------------------ permissões
checar("Admin do cliente (ve_faturamento) lê a prévia com a licença", True,
       linhas(EA, "2026-03-01", "item = 'voz_licenca_robo'"), *CL, valor="voz_licenca_robo=60000.00")
checar("perfil sem ve_faturamento não lê a prévia", False, linhas(EA, "2026-03-01"), *CO, erro="sem permissão")
checar("o site não chama as funções novas", True,
       "select bool_or(has_function_privilege('authenticated', p.oid, 'execute') or "
       "has_function_privilege('anon', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'public'::regnamespace "
       "and p.proname in ('licenca_voz_ciclo', 'segmentos_licenca_voz', 'linhas_fatura_licenca_voz', "
       "'linhas_fatura_minuto_ia_voz')", valor="f")

# ------------------------------------------------------------------ pico desligado para quem tem licença
EH = E["h"]
sv(f"update public.voz_contrato set concorrencia_contratada = 100000")
for k, pico in (("a", 3), ("d", 2), ("e", 3), ("g", 3), ("h", 2)):
    sv(f"insert into public.voz_config (empresa_id, provedor, modo, pico_multiplo) values ({E[k]}, 'simulador', "
       f"'simulado', {pico})")
    sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, canais) "
       f"values ({E[k]}, 'e98-{k}', 'Operadora Exemplo', '203.0.113.40', 'ip', '11', '1130040000', 4)")


def pico(k):
    # a divisão como o servidor; a view da VM como o dono (o papel motorcx_voz só existe com login, no Supabase)
    return (f"create temp table d98 as select pico_multiplo, teto, limite, canais "
            f"from public.divisao_concorrencia_voz() where empresa_id = {E[k]}; grant select on d98 to public; "
            f"reset role; select (select pico_multiplo || '|' || (teto = least(limite * pico_multiplo, canais)) "
            f"from d98) || '|' || (select v.pico_multiplo from voz_vm.config v where v.empresa_id = {E[k]})")


checar("licença vigente: pico 1 na divisão e na config da VM (guardado 3)", True, pico("a"), "service_role",
       valor="1|true|1")
checar("legado: pico guardado vale (2)", True, pico("d"), "service_role", valor="2|true|2")
checar("licença vigente desde abril: pico 1", True, pico("e"), "service_role", valor="1|true|1")
lic(ED, "2099-01-01", 5, preco=6000)
checar("licença só agendada (futuro): pico guardado vale (2)", True, pico("d"), "service_role", valor="2|true|2")
checar("licença com 0 robôs: pico guardado vale (3)", True, pico("g"), "service_role", valor="3|true|3")
checar("voz_config.pico_multiplo guardado não muda", True,
       f"select pico_multiplo from public.voz_config where empresa_id = {EA}", valor=3)
checar("cliente lê a divisão da própria empresa com pico 1", True,
       f"select pico_multiplo from public.divisao_concorrencia_voz() where empresa_id = {EA}", *CL, valor=1)

# ------------------------------------------------------------------ "agora" pela RPC: dia de America/Sao_Paulo
HOJE = sv("select (now() at time zone 'America/Sao_Paulo')::date")
COMP = sv(f"select public.competencia_de({EH}, '{HOJE}')")
FIM = sv(f"select (public.ciclo_de({EH}, '{COMP}')).fim")
INI = sv(f"select (public.ciclo_de({EH}, '{COMP}')).inicio")
checar("RPC com a sessão em outro fuso (+14h): vale desde hoje em São Paulo", True,
       f"set timezone = 'Pacific/Kiritimati'; select vale_desde from public.salvar_licencas_voz({EH}, 2, "
       f"'Contrato novo de teste.')", *M, valor=HOJE)
checar("depois: a prévia do ciclo atual traz o início de hoje com os dias restantes (contando hoje)", True,
       f"set timezone = 'Pacific/Kiritimati'; select (descricao like '%início em ' || to_char('{HOJE}'::date, 'DD/MM') "
       f"|| ', 2 robôs (' || ('{FIM}'::date - '{HOJE}'::date + 1) || ' de ' || ('{FIM}'::date - '{INI}'::date + 1) "
       f"|| ' dias)') or (descricao like '%· 2 robôs' and '{HOJE}' = '{INI}') "
       f"from public.previa_fatura({EH}, '{COMP}') where item like 'voz_licenca_robo%'", *M, valor="t")
checar("e o pico dela já é 1", True, pico("h"), "service_role", valor="1|true|1")

# ------------------------------------------------------------------ volta o que mudou fora das empresas de teste
sv(f"update public.voz_contrato set concorrencia_contratada = {TETO_ANTES}")
imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
