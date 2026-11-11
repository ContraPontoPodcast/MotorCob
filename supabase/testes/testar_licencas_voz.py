"""SQL 93 · Agente de voz: robôs contratados (licenças), PR 1 (só banco).

Cobre: a migração roda duas vezes; o item voz_licenca_robo pré-preenchido (franquia de 4.000 min por robô, tabela >=
mínimo da IA, entra em itens_com_franquia); RLS (o cliente nunca grava; o Admin do cliente só lê o próprio contrato,
sem motivo nem autor; quem é da empresa lê os robôs que valem, sem preço; a equipe com editar_contratacao edita e
precisa de editar_precos para mudar o preço; anon nada); vigência (hoje em America/Sao_Paulo ou no próximo ciclo;
redução só no próximo ciclo; a mais nova do dia vale); fidelidade (até quando, mínimo, não encurta); guarda da IA
(preço por robô × franquia, nem o Master passa) e mínimo do catálogo com motivo; overbooking com confirmação e aviso
para a equipe; o preço vai para precos_empresa (flat = por robô, mensalidade = valor fechado, franquia da licença) e
só pela licença; só se acrescenta (nem o servidor altera ou apaga; a exclusão da empresa apaga em cascata); auditoria.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_licencas_voz.py
Só dados fictícios (empresas e93-*, e-mails @exemplo.test).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL93 = RAIZ / "supabase" / "migrations" / "20270129000001_voz_licencas.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 93: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL93)], capture_output=True,
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
EA = sv(f"insert into public.empresas (slug, nome) values ('e93-a-{T}', 'E93 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e93-b-{T}', 'E93 B {T}') returning id")
EC = sv(f"insert into public.empresas (slug, nome) values ('e93-c-{T}', 'E93 C {T}') returning id")
U = {}
for p in ("master", "adm", "com", "atend", "cli", "cliop", "clib"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}93-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true, nome='Mara Master' where id='{U['master']}'")
sv(f"update public.perfis set papel='planejamento', equipe=true, equipe_alcance='todas' where id='{U['adm']}'")
sv(f"update public.perfis set papel='gestao', equipe=true, equipe_alcance='todas', nome='Ana Ribeiro' where id='{U['com']}'")
sv(f"update public.perfis set papel='operacao', equipe=true, equipe_alcance='todas' where id='{U['atend']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['cli']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['cliop']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EB} where id='{U['clib']}'")
# Comercial com editar_contratacao (ajuste do Master): edita robôs, não o preço (sem editar_precos)
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
PROX = sv(f"select (public.ciclo_de({EA}, public.competencia_de({EA}, '{HOJE}'))).fim + 1")
MES_ATUAL = sv(f"select date_trunc('month', public.competencia_de({EA}, '{HOJE}'))::date")
MES_PROX = sv(f"select date_trunc('month', public.competencia_de({EA}, '{PROX}'))::date")
PMIN = float(sv("select public.preco_minimo_licenca_voz(4000)"))
PMIN2 = float(sv("select public.preco_minimo_licenca_voz(2000)"))
FID_ATE = sv(f"select ('{HOJE}'::date + interval '12 months')::date - 1")
TAB = float(sv("select preco_tabela from public.cobranca_itens where codigo = 'voz_licenca_robo'"))
VEND0 = int(sv(f"select greatest(public.robos_vendidos_voz('{HOJE}'), public.robos_vendidos_voz('{PROX}'))"))
sv(f"update public.voz_contrato set concorrencia_contratada = {VEND0 + 40}")
TETO = VEND0 + 40


def slv(emp, robos, motivo="'Assinatura do contrato.'", **kw):
    args = ", ".join(f"{k} => {v}" for k, v in kw.items())
    return (f"select licenca_id is not null, vale_desde, coalesce(fidelidade_ate::text, ''), preco_id is not null, "
            f"overbooking from public.salvar_licencas_voz({emp}, {robos}, {motivo}{', ' + args if args else ''})")


# ------------------------------------------------------------------ catálogo pré-preenchido
checar("item voz_licenca_robo: robô·mês, Agente de voz, IA, franquia de 4.000 min por robô", True,
       "select unidade || '|' || modulo || '|' || eh_ia || '|' || franquia_padrao || '|' || ordem "
       "from public.cobranca_itens where codigo = 'voz_licenca_robo'", valor="robô·mês|agente_voz|true|4000|49")
checar("pré-preenchido: tabela >= mínimo da IA com a franquia padrão", True,
       "select preco_tabela >= public.preco_minimo_ia(codigo) and preco_minimo >= public.preco_minimo_ia(codigo) "
       "from public.cobranca_itens where codigo = 'voz_licenca_robo'", valor="t")
checar("custo do robô = franquia × custo de referência do minuto de IA", True,
       "select public.custo_ia_referencia('voz_licenca_robo') = 4000 * public.custo_ia_referencia('voz_minuto_ia')",
       valor="t")
checar("itens_com_franquia ganha o robô (franquia padrão editável pelo Master)", True,
       "select array_to_string(public.itens_com_franquia(), ',')",
       valor="ia_creditos,ia_treino_voz,ia_treino_texto,voz_licenca_robo")
checar("Master lê o robô em Margem › IA (itens_ia) com o mínimo", True,
       "select count(*) from public.itens_ia() where codigo = 'voz_licenca_robo' and preco_minimo_ia is not null", *M,
       valor=1)
checar("Master troca a franquia padrão do robô e volta", True,
       "select public.salvar_franquia_padrao('voz_licenca_robo', 3000); "
       "select public.salvar_franquia_padrao('voz_licenca_robo', 4000)", *M, valor=4000)

# ------------------------------------------------------------------ permissões de escrita
checar("cliente (Admin da empresa) nunca grava licença", False, slv(EA, 10), *CL, erro="sem permissão")
checar("cliente não grava direto na tabela", False,
       f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, vigente_desde, motivo) "
       f"values ({EA}, 1, 'por_robo', 1, current_date, 'teste direto')", *CL, erro="permission denied")
checar("anon não chama salvar_licencas_voz", False, slv(EA, 10), *ANON, erro="permission denied")
checar("Atendimento da equipe não grava", False, slv(EA, 10), *AT, erro="editar_contratacao")
checar("Administrativo sem editar_contratacao não grava", False, slv(EA, 10), *A, erro="editar_contratacao")
checar("Comercial com editar_contratacao mas sem editar_precos não abre contrato (preço novo)", False, slv(EA, 10), *C,
       erro="editar_precos")
checar("motivo curto é recusado", False, slv(EA, 10, "'ok'"), *M, erro="motivo")
checar("mais de 5.000 robôs é recusado", False, slv(EA, 5001), *M, erro="robôs")

# ------------------------------------------------------------------ guarda da IA e mínimo do catálogo
checar("guarda da IA: preço por robô abaixo do mínimo com 4.000 min é recusado até para o Master", False,
       slv(EA, 10, preco_robo=round(PMIN - 1, 2), motivo_abaixo="'cliente estratégico'"), *M, erro="mínimo para item de IA")
checar("guarda da IA: valor fechado abaixo de robôs × mínimo é recusado", False,
       slv(EA, 10, modelo="'valor_fechado'", valor_fechado=round(PMIN * 10 - 50, 2)), *M, erro="mínimo para item de IA")

# ------------------------------------------------------------------ contrato inicial (hoje), fidelidade e preço
checar("Master abre o contrato: 10 robôs hoje, preço de tabela pré-preenchido, fidelidade 12 meses", True,
       slv(EA, 10, fidelidade_meses=12), *M,
       valor=f"t|{HOJE}|{FID_ATE}|t|f")
checar("pré-preenchido: preço = tabela, franquia = 4.000, transcrição inclusa, mínimo da fidelidade = 10", True,
       f"select preco_robo::numeric(14,2) = {TAB}::numeric(14,2) and franquia_min_robo = 4000 and transcricao_inclusa "
       f"and fidelidade_min = 10 from public.voz_licencas where empresa_id = {EA}", valor="t")
checar("preço em precos_empresa: flat por robô, deste ciclo, com a franquia da licença", True,
       f"select modelo || '|' || vigente_desde || '|' || franquia || '|' || (preco = {TAB}) from public.precos_empresa "
       f"where empresa_id = {EA} and item = 'voz_licenca_robo'", valor=f"flat|{MES_ATUAL}|4000|true")
checar("voz_licenca_vigente: 10 robôs desde hoje (America/Sao_Paulo)", True,
       f"select robos || '|' || vigente_desde from public.voz_licenca_vigente where empresa_id = {EA}", *CO,
       valor=f"10|{HOJE}")
checar("preço do robô não se grava por fora da licença (salvar_preco_franquia)", False,
       f"select * from public.salvar_preco_franquia({EA}, 'voz_licenca_robo', 'flat', {TAB + 100}, 0, null, 'proximo', "
       f"null, null, 4000)", *M, erro="Contratação › Agente de voz")
checar("aumento hoje com o mesmo preço: o Comercial com editar_contratacao grava", True,
       slv(EA, 15, "'Cliente ampliou a carteira Varejo.'"), *C, valor=f"t|{HOJE}|{FID_ATE}|t|f")
checar("a fidelidade correndo segue (mesmo fim, mínimo 10)", True,
       f"select l.fidelidade_meses || '|' || l.fidelidade_min from public.voz_licenca_vigente v "
       f"join public.voz_licencas l on l.id = v.licenca_id where v.empresa_id = {EA}", *M, valor="12|10")
checar("a mais nova do mesmo dia vale (15 robôs)", True,
       f"select robos from public.voz_licenca_vigente where empresa_id = {EA}", *CL, valor=15)
checar("Comercial não muda o preço (editar_precos)", False,
       slv(EA, 15, "'Reajuste anual.'", preco_robo=TAB + 10), *C, erro="editar_precos")
checar("redução hoje é recusada (só no próximo ciclo)", False, slv(EA, 12, "'Cliente reduziu a operação.'"), *M,
       erro="próximo ciclo")
checar("franquia menor hoje é recusada", False,
       slv(EA, 15, "'Troca de franquia.'", franquia_min_robo=3000), *M, erro="próximo ciclo")
checar("fidelidade: reduzir abaixo do mínimo antes do fim é recusado (mesmo no próximo ciclo)", False,
       slv(EA, 8, "'Cliente reduziu a operação.'", inicio="'proximo'"), *M, erro="mínimo de 10 robôs")
checar("fidelidade: tirar antes do fim é recusado", False,
       slv(EA, 15, "'Sem fidelidade.'", inicio="'proximo'", fidelidade_meses=0), *M, erro="antes do fim")
checar("fidelidade: baixar o mínimo antes do fim é recusado", False,
       slv(EA, 15, "'Mínimo menor.'", inicio="'proximo'", fidelidade_min=5), *M, erro="manter ou estender")
checar("redução no próximo ciclo (12, acima do mínimo) com preço novo pelo Administrativo? sem editar_contratacao não", False,
       slv(EA, 12, "'Cliente reduziu a operação.'", inicio="'proximo'"), *A, erro="editar_contratacao")
checar("redução no próximo ciclo: 12 robôs, franquia 2.000 e preço menor (o mínimo da IA com 2.000 min)", True,
       slv(EA, 12, "'Cliente reduziu a operação.'", inicio="'proximo'", franquia_min_robo=2000,
           preco_robo=round(PMIN2 + 0.01, 2), motivo_abaixo="'franquia menor, preço menor'"), *M,
       valor=f"t|{PROX}|{FID_ATE}|t|f")
checar("o preço abaixo do mínimo do catálogo ficou com o motivo, na vigência do próximo ciclo", True,
       f"select franquia || '|' || coalesce(motivo_abaixo, '-') from public.precos_empresa where empresa_id = {EA} "
       f"and item = 'voz_licenca_robo' and vigente_desde = '{MES_PROX}'", valor="2000|franquia menor, preço menor")
checar("abaixo do mínimo do catálogo sem motivo é recusado", False,
       slv(EB, 5, preco_robo=round(PMIN2 + 0.01, 2), franquia_min_robo=2000), *M, erro="motivo do preço abaixo")
checar("hoje ainda valem 15 robôs; a redução fica agendada", True,
       f"select robos from public.voz_licenca_vigente where empresa_id = {EA}", *CL, valor=15)

# ------------------------------------------------------------------ leitura (cliente só o próprio contrato)
checar("Admin do cliente lê o próprio contrato (3 vigências)", True,
       f"select count(*) from public.voz_licencas_cliente where empresa_id = {EA}", *CL, valor=3)
checar("Admin do cliente não lê o contrato de outra empresa", True,
       f"select count(*) from public.voz_licencas_cliente where empresa_id <> {EA}", *CL, valor=0)
checar("Admin do cliente não lê o motivo", False, f"select motivo from public.voz_licencas where empresa_id = {EA}", *CL,
       erro="permission denied")
checar("Admin do cliente não lê o histórico da equipe (licencas_voz)", False,
       f"select count(*) from public.licencas_voz({EA})", *CL, erro="sem permissão")
checar("perfil sem ver_faturamento não lê preço (voz_licencas_cliente)", True,
       f"select count(*) from public.voz_licencas_cliente where empresa_id = {EA}", *CO, valor=0)
checar("perfil sem ver_faturamento lê os robôs que valem (sem preço)", True,
       f"select robos || '|' || franquia_min_robo from public.voz_licenca_vigente where empresa_id = {EA}", *CO,
       valor="15|4000")
checar("cliente de outra empresa não lê os robôs da A", True,
       f"select count(*) from public.voz_licenca_vigente where empresa_id = {EA}", *CB, valor=0)
checar("anon não lê licença", False, "select count(*) from public.voz_licenca_vigente", *ANON, erro="permission denied")
checar("equipe (Master) lê o histórico com quem, de → para e situação", True,
       f"select string_agg(situacao || ':' || robos || ':' || coalesce(robos_antes::text, '-') || ':' || quem, ',' "
       f"order by vigente_desde, id) from public.licencas_voz({EA})", *M,
       valor="anterior:10:-:Mara M.,vigente:15:10:Ana R.,agendada:12:15:Mara M.")
checar("histórico traz o motivo", True,
       f"select motivo from public.licencas_voz({EA}) where situacao = 'vigente'", *M,
       valor="Cliente ampliou a carteira Varejo.")
checar("Comercial (ver_faturamento) lê o histórico", True, f"select count(*) from public.licencas_voz({EA})", *C, valor=3)
checar("Atendimento da equipe não lê o histórico", False, f"select count(*) from public.licencas_voz({EA})", *AT,
       erro="sem permissão")
checar("o servidor lê os robôs que valem", True,
       f"select robos from public.voz_licenca_vigente where empresa_id = {EA}", *SR, valor=15)

# ------------------------------------------------------------------ valor fechado, overbooking e aviso
checar("valor fechado: 20 robôs na B, mensalidade em precos_empresa", True,
       slv(EB, 20, modelo="'valor_fechado'", valor_fechado=round(PMIN * 20 + 100, 2)), *M, valor=f"t|{HOJE}||t|f")
checar("valor fechado vai como mensalidade com a franquia da licença", True,
       f"select modelo || '|' || franquia from public.precos_empresa where empresa_id = {EB} and item = 'voz_licenca_robo'",
       valor="mensalidade|4000")
checar("valor fechado com 0 robôs é recusado", False,
       slv(EC, 0, modelo="'valor_fechado'", valor_fechado=1000), *M, erro="pelo menos 1 robô")
checar("overbooking sem confirmação é recusado", False, slv(EC, 30, "'Contrato novo grande.'"), *M, erro="overbooking")
AV0 = sv("select count(*) from public.avisos where para = 'equipe' and link = '/console/voz'")
checar("overbooking confirmado grava e marca", True,
       slv(EC, 30, "'Contrato novo grande.'", overbooking_confirmado="true"), *M, valor=f"t|{HOJE}||t|t")
checar("overbooking avisa a equipe (link /console/voz)", True,
       "select count(*) from public.avisos where para = 'equipe' and link = '/console/voz'",
       valor=int(AV0) + 1)
checar("a linha ficou com overbooking_confirmado", True,
       f"select overbooking_confirmado from public.voz_licencas where empresa_id = {EC}", valor="t")
checar("o cliente nunca vê o teto global", True, "select count(*) from public.voz_contrato", *CL, valor=0)

# ------------------------------------------------------------------ só se acrescenta e auditoria
checar("nem o servidor altera uma licença", False, f"update public.voz_licencas set robos = 99 where empresa_id = {EA}",
       *SR, erro="permission denied")
checar("nem o dono do banco altera (gatilho)", False,
       f"update public.voz_licencas set robos = 99 where empresa_id = {EA}", erro="só se acrescentam")
checar("nem o dono do banco apaga (gatilho)", False, f"delete from public.voz_licencas where empresa_id = {EA}",
       erro="só se acrescentam")
checar("auditoria registra a gravação", True,
       f"select count(*) > 0 from public.auditoria where tabela = 'voz_licencas' and empresa_id = {EA} and acao = 'INSERT'",
       valor="t")
checar("RLS ligada em voz_licencas", True,
       "select relrowsecurity from pg_class where oid = 'public.voz_licencas'::regclass", valor="t")
checar("Master vê o robô em ia_precos_abaixo_minimo só se estiver abaixo (nenhum)", True,
       f"select count(*) from public.ia_precos_abaixo_minimo() where item = 'voz_licenca_robo' and empresa_id in ({EA},{EB},{EC})",
       *M, valor=0)
checar("a exclusão da empresa apaga as licenças em cascata", True,
       f"delete from public.empresas where id = {EC}; select count(*) from public.voz_licencas where empresa_id = {EC}",
       valor=0)

# ------------------------------------------------------------------ volta o que mudou fora das empresas de teste
sv(f"update public.voz_contrato set concorrencia_contratada = {TETO_ANTES}")
imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
