"""SQL 123 · Agente de voz cobrado por minuto falado com a IA, PR 1 (só banco).

Cobre: a migração roda duas vezes; segundos_tarifados_ia com a mesma tabela de casos da VM
(tests/dados/tarifacao_ia_casos.json: 47→48, 12→30, tempo grátis, milésimos, soma de trechos, máquina = 0); cadência
padrão 0/30/6 (só o Master muda); RLS (o cliente nunca grava; o Admin do cliente lê o próprio contrato sem motivo nem
autor; a equipe com editar_contratacao edita e precisa de editar_precos para mudar o preço; anon nada); vigência (próximo
ciclo por padrão, "agora" com hora); troca de modelo só no próximo ciclo e nunca com a fidelidade da licença correndo;
legado (sem contrato: licença vigente = licenca, senão por_minuto); guarda da IA no preço (nem o Master passa abaixo);
o preço vai para precos_empresa (voz_minuto_ia); overbooking com confirmação e aviso; só se acrescenta; auditoria.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_cobranca_ia.py
Só dados fictícios (empresas e123-*, e-mails @exemplo.test).
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
SQL123 = RAIZ / "supabase" / "migrations" / "20270321000001_voz_cobranca_ia.sql"
CASOS = json.loads((RAIZ / "tests" / "dados" / "tarifacao_ia_casos.json").read_text(encoding="utf-8"))


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 123: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL123)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

# ------------------------------------------------------------------ tarifação: a mesma tabela da VM
for c in CASOS["casos"]:
    g, i, n = c["cadencia"].split("/")
    checar(f"tarifação: {c['nome']}", True, f"select public.segundos_tarifados_ia({c['segundos']}, {g}, {i}, {n})",
           valor=c["tarifados"])
for c in CASOS["chamadas"]:
    g, i, n = c["cadencia"].split("/")
    soma = " + ".join(f"({f} - {a})" for a, f in c["trechos"]) or "0"
    checar(f"tarifação por ligação: {c['nome']}", True,
           f"select public.segundos_tarifados_ia({soma}, {g}, {i}, {n})", valor=c["tarifados"])
checar("cadência inválida (inicial 0) é recusada", False, "select public.segundos_tarifados_ia(10, 0, 0, 6)",
       erro="cadência inválida")
checar("nulo devolve nulo", True, "select coalesce(public.segundos_tarifados_ia(null, 0, 30, 6)::text, 'nulo')",
       valor="nulo")

T = uuid.uuid4().hex[:6]
PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
TETO_ANTES = sv("select concorrencia_contratada from public.voz_contrato")
CAD_ANTES = sv("select cadencia_ia_padrao from public.voz_contrato")
sv("update public.parametros_margem set impostos_pct = 0, mc_minima_ia_pct = 70 where id = 1")
# SQL 124: a mínima própria do minuto de IA (60%) fica de fora aqui; os testes do 124 cobrem os 60%
ITEM_MC = sv("select coalesce(mc_minima_ia_pct::text, 'null') from public.cobranca_itens where codigo = 'voz_minuto_ia'")
TAB_ANTES = sv("select preco_minimo || ',' || preco_tabela from public.cobranca_itens where codigo = 'voz_minuto_ia'")
sv("update public.cobranca_itens set mc_minima_ia_pct = null, preco_minimo = 1.50, preco_tabela = greatest(preco_tabela, 1.50) "
   "where codigo = 'voz_minuto_ia'")
EA = sv(f"insert into public.empresas (slug, nome) values ('e123-a-{T}', 'E123 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e123-b-{T}', 'E123 B {T}') returning id")
EC = sv(f"insert into public.empresas (slug, nome) values ('e123-c-{T}', 'E123 C {T}') returning id")
U = {}
for p in ("master", "adm", "com", "atend", "cli", "cliop", "clib"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}123-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true, nome='Mara Master' where id='{U['master']}'")
sv(f"update public.perfis set papel='planejamento', equipe=true, equipe_alcance='todas' where id='{U['adm']}'")
sv(f"update public.perfis set papel='gestao', equipe=true, equipe_alcance='todas', nome='Ana Ribeiro' where id='{U['com']}'")
sv(f"update public.perfis set papel='operacao', equipe=true, equipe_alcance='todas' where id='{U['atend']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['cli']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['cliop']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EB} where id='{U['clib']}'")
sv(f"insert into public.permissoes_equipe (usuario_id, permissao, permitido) values ('{U['com']}', 'editar_contratacao', true)")
M = ("authenticated", U["master"])
A = ("authenticated", U["adm"])
C = ("authenticated", U["com"])
AT = ("authenticated", U["atend"])
CL = ("authenticated", U["cli"])
CO = ("authenticated", U["cliop"])
CB = ("authenticated", U["clib"])
ANON = ("anon", None)
SR = ("service_role", None)
HOJE = sv("select (now() at time zone 'America/Sao_Paulo')::date")
PROX = sv(f"select (public.proximo_ciclo_ia_voz({EA}) at time zone 'America/Sao_Paulo')::date")
MES_ATUAL = sv(f"select date_trunc('month', public.competencia_de({EA}, '{HOJE}'))::date")
MES_PROX = sv(f"select date_trunc('month', public.competencia_de({EA}, '{PROX}'))::date")
PMIN = float(sv("select public.preco_minimo_ia('voz_minuto_ia')"))
VEND0 = int(sv(f"select greatest(public.conversas_vendidas_voz('{HOJE}'), public.conversas_vendidas_voz('{PROX}'))"))
sv(f"update public.voz_contrato set concorrencia_contratada = {VEND0 + 40}")


def slv(emp, modelo="'por_minuto'", motivo="'Assinatura do contrato.'", **kw):
    args = ", ".join(f"{k} => {v}" for k, v in kw.items())
    return (f"select cobranca_id is not null, (vale_desde at time zone 'America/Sao_Paulo')::date, preco_id is not null, "
            f"overbooking from public.salvar_cobranca_ia_voz({emp}, {modelo}, {motivo}{', ' + args if args else ''})")


# ------------------------------------------------------------------ cadência padrão
checar("cadência padrão 0/30/6", True, "select cadencia_ia_padrao from public.voz_contrato", valor=CAD_ANTES)
checar("só o Master muda a cadência padrão", False, "select public.definir_cadencia_ia_padrao('0/60/6')", *C,
       erro="só um Master")
checar("cadência padrão inválida (grátis >= inicial) é recusada", False,
       "select public.definir_cadencia_ia_padrao('30/30/6')", *M, erro="inválida")
checar("Master muda e volta a cadência padrão", True,
       "select public.definir_cadencia_ia_padrao('0/60/6'); select public.definir_cadencia_ia_padrao('0/30/6')", *M,
       valor="0/30/6")

# ------------------------------------------------------------------ legado (sem contrato)
checar("sem contrato e sem licença: por_minuto (legado)", True, f"select public.modelo_ia_voz({EA})", *SR,
       valor="por_minuto")
sv(f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, vigente_desde, motivo, fidelidade_meses, "
   f"fidelidade_ate, fidelidade_min) select {EC}, 2, 'por_robo', preco_tabela, '{HOJE}', 'Licença de teste.', 12, "
   f"'{HOJE}'::date + 365, 2 from public.cobranca_itens where codigo = 'voz_licenca_robo'")
checar("sem contrato e com licença vigente: licenca (legado)", True, f"select public.modelo_ia_voz({EC})", *SR,
       valor="licenca")

# ------------------------------------------------------------------ permissões de escrita
checar("cliente (Admin da empresa) nunca grava", False, slv(EA, limite_conversas=5), *CL, erro="sem permissão")
checar("cliente não grava direto na tabela", False,
       f"insert into public.voz_cobranca_ia (empresa_id, modelo, limite_conversas, vigente_desde, motivo) "
       f"values ({EA}, 'por_minuto', 1, now(), 'teste direto')", *CL, erro="permission denied")
checar("anon não chama salvar_cobranca_ia_voz", False, slv(EA, limite_conversas=5), *ANON, erro="permission denied")
checar("Atendimento da equipe não grava", False, slv(EA, limite_conversas=5), *AT, erro="editar_contratacao")
checar("Administrativo sem editar_contratacao não grava", False, slv(EA, limite_conversas=5), *A,
       erro="editar_contratacao")
checar("Comercial com editar_contratacao mas sem editar_precos não abre contrato (preço novo)", False,
       slv(EA, limite_conversas=5, preco=PMIN), *C, erro="editar_precos")
checar("motivo curto é recusado", False, slv(EA, motivo="'ok'", limite_conversas=5), *M, erro="motivo")
checar("por minuto sem limite de conversas é recusado", False, slv(EA, preco=PMIN), *M, erro="limite de conversas")
checar("grátis >= inicial é recusado", False, slv(EA, limite_conversas=5, preco=PMIN, gratis_s=30, inicial_s=30), *M,
       erro="tempo grátis")
checar("vigência desconhecida é recusada", False, slv(EA, limite_conversas=5, preco=PMIN, quando="'ontem'"), *M,
       erro="vigência")

# ------------------------------------------------------------------ guarda da IA (MC mínima 70%, impostos 0)
checar("guarda da IA: R$ 1,25 com MC mínima de 70% é recusado até para o Master, com a mensagem do banco", False,
       slv(EA, limite_conversas=5, preco=1.25, quando="'agora'"), *M, erro="o menor preço aceito é R$ 1,50 por minuto")

# ------------------------------------------------------------------ contrato (agora) com o mínimo
checar("Master abre o contrato agora: por minuto, preço no mínimo, cadência padrão, 5 conversas", True,
       slv(EA, limite_conversas=5, preco=PMIN, quando="'agora'"), *M, valor=f"t|{HOJE}|t|f")
checar("pré-preenchido: cadência 0/30/6 da padrão, sem franquia", True,
       f"select gratis_s || '/' || inicial_s || '/' || incremento_s || '|' || coalesce(franquia_min::text, '-') "
       f"from public.voz_cobranca_ia where empresa_id = {EA}", valor="0/30/6|-")
checar("vigente_desde com hora (agora)", True,
       f"select vigente_desde > now() - interval '1 minute' from public.voz_cobranca_ia where empresa_id = {EA}",
       valor="t")
checar("preço em precos_empresa: voz_minuto_ia flat, mês deste ciclo, com o motivo da vigência", True,
       f"select modelo || '|' || vigente_desde || '|' || (preco = {PMIN}) || '|' || (motivo_vigencia is not null) "
       f"from public.precos_empresa where empresa_id = {EA} and item = 'voz_minuto_ia'",
       valor=f"flat|{MES_ATUAL}|true|true")
checar("modelo que vale: por_minuto", True, f"select public.modelo_ia_voz({EA})", *SR, valor="por_minuto")
checar("cobranca_ia_vigente acha o contrato", True,
       f"select (public.cobranca_ia_vigente({EA})).limite_conversas", *SR, valor=5)
checar("Comercial com editar_contratacao muda o limite (mesmo preço)", True,
       slv(EA, motivo="'Cliente ampliou a operação.'", limite_conversas=8, quando="'agora'"), *C,
       valor=f"t|{HOJE}|t|f")
checar("Comercial não muda o preço (editar_precos)", False,
       slv(EA, motivo="'Reajuste.'", preco=PMIN + 0.1), *C, erro="editar_precos")
checar("cadência e franquia no próximo ciclo: 3/30/6 e 10.000 min", True,
       slv(EA, motivo="'Tolerância negociada.'", gratis_s=3, franquia_min=10000), *M, valor=f"t|{PROX}|t|f")
checar("hoje vale 0/30/6 com 8 conversas; o próximo ciclo fica agendado", True,
       f"select (c).gratis_s || '|' || (c).limite_conversas from (select public.cobranca_ia_vigente({EA}) c) x", *SR,
       valor="0|8")
checar("franquia 0 tira a franquia", True,
       slv(EA, motivo="'Sem franquia.'", franquia_min=0), *M, valor=f"t|{PROX}|t|f")
checar("a franquia saiu na vigência mais nova", True,
       f"select coalesce(franquia_min::text, '-') from public.voz_cobranca_ia where empresa_id = {EA} "
       f"order by id desc limit 1", valor="-")

# ------------------------------------------------------------------ troca de modelo (P8)
checar("troca para licença agora é recusada (só no próximo ciclo)", False,
       slv(EA, modelo="'licenca'", motivo="'Cliente prefere licença.'", quando="'agora'"), *M, erro="próximo ciclo")
checar("troca para licença no próximo ciclo grava (sem preço do minuto)", True,
       slv(EA, modelo="'licenca'", motivo="'Cliente prefere licença.'"), *M, valor=f"t|{PROX}|f|f")
checar("empresa com licença e fidelidade correndo não troca para o minuto", False,
       slv(EC, motivo="'Troca de modelo.'", limite_conversas=2, preco=PMIN), *M, erro="fidelidade")
checar("empresa com licença não troca para o minuto agora (P8)", False,
       slv(EC, motivo="'Troca de modelo.'", limite_conversas=2, preco=PMIN, quando="'agora'"), *M,
       erro="próximo ciclo")

# ------------------------------------------------------------------ mínimo do catálogo com motivo
sv(f"update public.cobranca_itens set preco_minimo = {PMIN + 0.2}, preco_tabela = greatest(preco_tabela, {PMIN + 0.2}) "
   f"where codigo = 'voz_minuto_ia'")
checar("abaixo do mínimo do catálogo sem motivo é recusado", False,
       slv(EB, limite_conversas=3, preco=PMIN + 0.1), *M, erro="motivo do preço abaixo")
checar("abaixo do mínimo do catálogo com motivo (Master) grava no próximo ciclo", True,
       slv(EB, limite_conversas=3, preco=PMIN + 0.1, motivo_abaixo="'cliente estratégico'"), *M, valor=f"t|{PROX}|t|f")
checar("o motivo do abaixo do mínimo ficou no preço do mês do próximo ciclo", True,
       f"select motivo_abaixo from public.precos_empresa where empresa_id = {EB} and item = 'voz_minuto_ia' "
       f"and vigente_desde = '{MES_PROX}'", valor="cliente estratégico")
sv(f"update public.cobranca_itens set preco_minimo = {PMIN} where codigo = 'voz_minuto_ia'")

# ------------------------------------------------------------------ overbooking
TETO = int(sv("select concorrencia_contratada from public.voz_contrato"))
checar("overbooking sem confirmação é recusado", False,
       slv(EB, motivo="'Contrato grande.'", limite_conversas=60, preco=PMIN + 0.1), *M, erro="overbooking")
AV0 = sv("select count(*) from public.avisos where para = 'equipe' and link = '/console/voz'")
checar("overbooking confirmado grava e marca", True,
       slv(EB, motivo="'Contrato grande.'", limite_conversas=60, preco=PMIN + 0.1, overbooking_confirmado="true"), *M,
       valor=f"t|{PROX}|t|t")
checar("overbooking avisa a equipe (link /console/voz)", True,
       "select count(*) from public.avisos where para = 'equipe' and link = '/console/voz'", valor=int(AV0) + 1)
checar("conversas vendidas no próximo ciclo contam o limite de 60 da B", True,
       f"select public.conversas_vendidas_voz('{PROX}') >= 60", *SR, valor="t")

# ------------------------------------------------------------------ leitura
checar("Admin do cliente lê o próprio contrato pela view (sem motivo)", True,
       f"select count(*) from public.voz_cobranca_ia_cliente where empresa_id = {EA}", *CL, valor=5)
checar("Admin do cliente vê a cadência como texto", True,
       f"select cadencia from public.voz_cobranca_ia_cliente where empresa_id = {EA} order by id limit 1", *CL,
       valor="0/30/6")
checar("Admin do cliente não lê o contrato de outra empresa", True,
       f"select count(*) from public.voz_cobranca_ia_cliente where empresa_id <> {EA}", *CL, valor=0)
checar("Admin do cliente não lê o motivo", False,
       f"select motivo from public.voz_cobranca_ia where empresa_id = {EA}", *CL, erro="permission denied")
checar("perfil sem ver_faturamento não lê o contrato", True,
       f"select count(*) from public.voz_cobranca_ia_cliente where empresa_id = {EA}", *CO, valor=0)
checar("anon não lê", False, "select count(*) from public.voz_cobranca_ia_cliente", *ANON, erro="permission denied")
checar("Admin do cliente não lê o histórico da equipe", False,
       f"select count(*) from public.historico_cobranca_ia_voz({EA})", *CL, erro="sem permissão")
checar("Master lê o histórico com situação, de → para e quem", True,
       f"select string_agg(situacao || ':' || modelo || ':' || coalesce(limite_conversas::text, '-') || ':' "
       f"|| coalesce(limite_antes::text, '-') || ':' || quem, ',' order by vigente_desde, id) "
       f"from public.historico_cobranca_ia_voz({EA})", *M,
       valor="anterior:por_minuto:5:-:Mara M.,vigente:por_minuto:8:5:Ana R.,agendada:por_minuto:8:8:Mara M.,"
             "agendada:por_minuto:8:8:Mara M.,agendada:licenca:-:8:Mara M.")
checar("histórico traz o motivo e o preço do mês", True,
       f"select motivo || '|' || (preco_minuto = {PMIN}) from public.historico_cobranca_ia_voz({EA}) "
       f"where situacao = 'vigente'", *M, valor="Cliente ampliou a operação.|true")
checar("Atendimento da equipe não lê o histórico", False,
       f"select count(*) from public.historico_cobranca_ia_voz({EA})", *AT, erro="sem permissão")

# ------------------------------------------------------------------ só se acrescenta e auditoria
checar("nem o servidor altera", False, f"update public.voz_cobranca_ia set limite_conversas = 99 where empresa_id = {EA}",
       *SR, erro="permission denied")
checar("nem o dono do banco altera (gatilho)", False,
       f"update public.voz_cobranca_ia set limite_conversas = 99 where empresa_id = {EA}", erro="só se acrescenta")
checar("nem o dono do banco apaga (gatilho)", False, f"delete from public.voz_cobranca_ia where empresa_id = {EA}",
       erro="só se acrescenta")
checar("auditoria registra a gravação", True,
       f"select count(*) > 0 from public.auditoria where tabela = 'voz_cobranca_ia' and empresa_id = {EA} "
       f"and acao = 'INSERT'", valor="t")
checar("RLS ligada em voz_cobranca_ia", True,
       "select relrowsecurity from pg_class where oid = 'public.voz_cobranca_ia'::regclass", valor="t")
checar("empresa com licença confirma a licença no próximo ciclo", True,
       slv(EC, modelo="'licenca'", motivo="'Segue na licença.'"), *M, valor=f"t|{PROX}|f|t")
checar("a exclusão da empresa apaga em cascata", True,
       f"delete from public.empresas where id = {EC}; select count(*) from public.voz_cobranca_ia where empresa_id = {EC}",
       valor=0)

# ------------------------------------------------------------------ volta o que mudou fora das empresas de teste
sv(f"update public.voz_contrato set concorrencia_contratada = {TETO_ANTES}, cadencia_ia_padrao = '{CAD_ANTES}'")
imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")
pmin_a, tab_a = TAB_ANTES.split(",")
sv(f"update public.cobranca_itens set mc_minima_ia_pct = {ITEM_MC} where codigo = 'voz_minuto_ia'")
sv(f"update public.cobranca_itens set preco_minimo = {pmin_a}, preco_tabela = {tab_a} where codigo = 'voz_minuto_ia'")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
