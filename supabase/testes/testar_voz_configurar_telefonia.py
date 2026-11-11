"""SQL 105 · Telefonia, PR T3: o Admin do cliente configura a telefonia dele (configurar_telefonia + duas etapas).

Cobre: a migração roda duas vezes; a permissão nova no catálogo (padrão só Admin; fora do Speech, o Qualidade nunca tem;
o Admin pode tirar de si e dar ao Planejamento); pode_configurar_telefonia: Admin com aal2, com o módulo agente_voz e da
própria empresa (sem aal2, sem o módulo, outra empresa, sem a permissão: não); o Admin cadastra tronco, guarda a senha
(preparar), grava os IPs, salva rota e transferência e encerra rota; não libera IPs no firewall (é da equipe) e não
aponta para o segredo de outra empresa; as views do cliente não têm segredo_ref e só mostram a própria empresa; e-mail
(aviso obrigatório de segurança) a todos os Admins a cada mudança de endereço, senha, bina ou IPs, e nada quando muda
só o nome da operadora.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_configurar_telefonia.py
Só dados fictícios (empresas e105-*, e-mails @exemplo.test, IPs de documentação e faixas fictícias).
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
SQL = RAIZ / "supabase" / "migrations" / "20270218000001_voz_configurar_telefonia.sql"
ROTULO = "SQL 105: "


def sql(cmd, papel=None, uid=None, aal=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; "
        if uid:
            claims = json.dumps({"sub": uid, "role": papel, **({"aal": aal} if aal else {})})
            pre += (f"select set_config('request.jwt.claim.sub', '{uid}', false); "
                    f"select set_config('request.jwt.claims', '{claims}', false); ")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None, aal=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid, aal)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + ROTULO + nome
          + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def caso(nome, cond):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + ROTULO + nome)


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar():
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL)], capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-600:])
    return r


r1, r2 = aplicar(), aplicar()
caso("a migração roda sem erro (duas vezes)", r1.returncode == 0 and r2.returncode == 0)
checar("a permissão está no catálogo uma vez, padrão só do Admin", True,
       "select count(*) || '|' || bool_and(admin and not planejamento and not operacao and not gestao) "
       "from public.permissoes_catalogo where codigo = 'configurar_telefonia'", None, None, "1|true")

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e105-a-{T}', 'E105 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e105-b-{T}', 'E105 B {T}') returning id")
EN = sv(f"insert into public.empresas (slug, nome) values ('e105-n-{T}', 'E105 N {T}') returning id")   # sem o módulo
sv(f"insert into public.empresa_modulos (empresa_id, modulo) values ({EA}, 'agente_voz'), ({EB}, 'agente_voz')")


def pessoa(nome, papel, empresa=None, equipe=False):
    uid = sv(f"insert into auth.users (email) values ('{nome}-{T}@exemplo.test') returning id")
    if equipe:
        sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, "
           f"equipe_alcance='todas', nome='Técnico {T}' where id='{uid}'")
    else:
        sv(f"update public.perfis set papel='{papel}', empresa_id={empresa}, nome='{nome.title()} {T}' where id='{uid}'")
    return uid


ADM = pessoa("adm", "admin", EA)
ADM2 = pessoa("adm2", "admin", EA)
PLAN = pessoa("plan", "planejamento", EA)
OPER = pessoa("oper", "operacao", EA)
QUAL = pessoa("qual", "qualidade", EA)
ADMB = pessoa("admb", "admin", EB)
ADMN = pessoa("admn", "admin", EN)
TEC = pessoa("tec", None, equipe=True)

PODE = f"select public.pode_configurar_telefonia({EA})"
checar("Admin com a verificação em duas etapas configura", True, PODE, "authenticated", ADM, "t", aal="aal2")
checar("Admin sem a verificação em duas etapas (aal1) não configura", True, PODE, "authenticated", ADM, "f", aal="aal1")
checar("Admin de outra empresa não configura esta", True, PODE, "authenticated", ADMB, "f", aal="aal2")
checar("Planejamento não configura (padrão só Admin)", True, PODE, "authenticated", PLAN, "f", aal="aal2")
checar("Operação não configura", True, PODE, "authenticated", OPER, "f", aal="aal2")
checar("perfil Qualidade nunca configura (fora do Speech)", True, PODE, "authenticated", QUAL, "f", aal="aal2")
checar("nem o Admin consegue dar a permissão ao perfil Qualidade", False,
       f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{QUAL}', 'configurar_telefonia', true)",
       None, None, erro="só tem acessos do Speech")
checar("empresa sem o módulo agente_voz: o Admin não configura", True,
       f"select public.pode_configurar_telefonia({EN})", "authenticated", ADMN, "f", aal="aal2")
checar("a equipe com gerenciar_troncos_voz continua configurando", True, PODE, "authenticated", TEC, "t")

# ---------------------------------------------------------------- o Admin cadastra e configura
REF = f"tr105-{T}"
TRONCO = (f"select public.cadastrar_tronco_voz({EA}, '{REF}', 'Operadora Exemplo', 'sip.e105.exemplo.com.br', 10, 'senha', "
          f"'11', '1130030000', null, 'usr_e105')")
checar("Admin sem aal2 não cadastra tronco", False, TRONCO, "authenticated", ADM, aal="aal1", erro="verificação em duas etapas")
checar("Admin com aal2 cadastra tronco com senha", True, TRONCO + " is not null", "authenticated", ADM, "t", aal="aal2")
TID = sv(f"select id from public.voz_troncos where empresa_id={EA} and referencia='{REF}'")
checar("o tronco que o cliente cadastra nasce inativo (a equipe ativa depois do teste e da liberação)", True,
       f"select ativo from public.voz_troncos where id={TID}", None, None, "f")
checar("o Admin não ativa o tronco", True,
       TRONCO.replace("null, 'usr_e105')", "null, 'usr_e105', ativo => true)") + f"; select ativo from public.voz_troncos where id={TID}",
       "authenticated", ADM, "f", aal="aal2")
ATIVAR = TRONCO.replace("null, 'usr_e105')", "null, 'usr_e105', ativo => true)")
checar("a equipe ativa o tronco do cliente", True, ATIVAR + f"; select ativo from public.voz_troncos where id={TID}",
       "authenticated", TEC, "t")
checar("o Admin muda só a capacidade e o tronco segue ativo", True,
       TRONCO.replace(", 10, 'senha'", ", 12, 'senha'") + f"; select ativo || '|' || canais from public.voz_troncos where id={TID}",
       "authenticated", ADM, "true|12", aal="aal2")
checar("o Admin muda a bina e o tronco volta a inativo (testar e liberar de novo)", True,
       TRONCO.replace("'1130030000'", "'1130031234'") + f"; select ativo from public.voz_troncos where id={TID}",
       "authenticated", ADM, "f", aal="aal2")
sql(ATIVAR, "authenticated", TEC)
checar("o Admin pode desativar", True,
       TRONCO.replace("null, 'usr_e105')", "null, 'usr_e105', ativo => false)")
       + f"; select ativo from public.voz_troncos where id={TID}", "authenticated", ADM, "f", aal="aal2")
sql(ATIVAR.replace("'1130030000'", "'1130031234'"), "authenticated", TEC)
checar("a referência é a do cofre da empresa", True, f"select segredo_ref from public.voz_troncos where id={TID}", None, None,
       f"voz/trunk/e{EA}/{REF}")
checar("Admin não aponta a senha para o segredo de outra empresa", False,
       TRONCO.replace("null, 'usr_e105'", f"'voz/trunk/e{EB}/x', 'usr_e105'"), "authenticated", ADM, aal="aal2",
       erro="cofre da empresa")
checar("Admin prepara a troca da senha (recebe só o nome do segredo da empresa)", True,
       f"select nome_segredo from public.preparar_segredo_tronco_voz({TID})", "authenticated", ADM,
       f"motorcx-voz-trunk-e{EA}-{REF}", aal="aal2")
checar("Admin grava os IPs da operadora", True,
       f"select public.definir_ips_voz('tronco', {TID}, array['200.190.1.10'])::text", "authenticated", ADM,
       "{200.190.1.10/32}", aal="aal2")
checar("Admin NÃO libera os IPs no firewall (segundo passo, da equipe)", False,
       f"select public.liberar_ips_voz('tronco', {TID})", "authenticated", ADM, aal="aal2", erro="só a equipe MotorCX")
ROTA = f"select public.salvar_rota_voz({EA}, {TID}, '1051', 'movel_vc1', 1, 30, 6, 0.05)"
checar("Admin sem aal2 não salva rota", False, ROTA, "authenticated", ADM, aal="aal1", erro="sem permissão para configurar")
checar("Admin com aal2 salva rota", True, ROTA + " is not null", "authenticated", ADM, "t", aal="aal2")
RID = sv(f"select id from public.voz_rotas where empresa_id={EA} and tech_prefix='1051'")
checar("Admin de outra empresa não encerra a rota", False, f"select public.encerrar_rota_voz({RID})", "authenticated", ADMB,
       aal="aal2", erro="rota não encontrada")
checar("Admin encerra a rota", True, f"select public.encerrar_rota_voz({RID}); select vigente_ate is not null from "
       f"public.voz_rotas where id={RID}", "authenticated", ADM, "t", aal="aal2")
TRANSF = (f"select public.salvar_transferencia_voz({EA}, 'Fila 105', 'sip:fila@pabx.e105.exemplo.com.br', 'ponte')")
checar("Planejamento não salva a transferência", False, TRANSF, "authenticated", PLAN, aal="aal2",
       erro="sem permissão para configurar")
checar("Admin com aal2 salva a transferência", True, TRANSF + " is not null", "authenticated", ADM, "t", aal="aal2")
checar("o Admin pode dar a permissão ao Planejamento", True,
       f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({EA}, 'planejamento', "
       f"'configurar_telefonia', true) on conflict (empresa_id, papel, permissao) do update set permitido = true; "
       f"set role authenticated; select set_config('request.jwt.claim.sub', '{PLAN}', false); "
       f"select set_config('request.jwt.claims', '{{\"sub\": \"{PLAN}\", \"aal\": \"aal2\"}}', false); {PODE}",
       None, None, "t")
sv(f"delete from public.permissoes_papel where empresa_id={EA} and papel='planejamento' and permissao='configurar_telefonia'")

# ---------------------------------------------------------------- leitura do cliente, sem segredo
checar("a view do cliente não tem segredo_ref nem quem guardou", True,
       "select count(*) from information_schema.columns where table_name = 'voz_troncos_empresa' "
       "and column_name in ('segredo_ref', 'segredo_guardado_por', 'segredo_versao')", None, None, 0)
checar("Operação da empresa vê o tronco: senha ainda não guardada e IP esperando liberação", True,
       f"select segredo_no_cofre || '|' || ips_pendentes::text from public.voz_troncos_empresa where id={TID}",
       "authenticated", OPER, "false|{200.190.1.10/32}")
checar("Operação da empresa vê as rotas", True, f"select count(*) from public.voz_rotas_empresa where empresa_id={EA}",
       "authenticated", OPER, 1)
checar("cliente de outra empresa não vê", True, f"select count(*) from public.voz_troncos_empresa where empresa_id={EA}",
       "authenticated", ADMB, 0)
checar("Operação continua sem ler a tabela de troncos (só a view)", True,
       f"select count(*) from public.voz_troncos where empresa_id={EA}", "authenticated", OPER, 0)
checar("anon não lê a view", False, "select * from public.voz_troncos_empresa", "anon")
checar("a equipe que cuida da voz vê pela view também", True,
       f"select count(*) from public.voz_troncos_empresa where id={TID}", "authenticated", TEC, 1)

# ---------------------------------------------------------------- e-mail aos Admins (D13)
AV = (f"select count(*) from public.avisos where empresa_id={EA} and para='usuario' and assunto='seguranca' "
      f"and titulo like '%{REF}%'")
n0 = int(sv(AV))
checar("tronco novo avisou os dois Admins (e só eles)", True,
       f"select count(*) || '|' || count(distinct usuario_id) filter (where usuario_id in ('{ADM}', '{ADM2}')) "
       f"from public.avisos where empresa_id={EA} and para='usuario' and assunto='seguranca' and titulo like '%{REF}%' "
       f"and texto like 'Mudou: tronco novo.%'", None, None, "2|2")
checar("IPs da operadora também avisam os Admins", True,
       f"select count(*) from public.avisos where empresa_id={EA} and para='usuario' and assunto='seguranca' "
       f"and titulo like '%{REF}%' and texto like 'Mudou: IPs da operadora.%'", None, None, 2)
sql(f"update public.voz_troncos set operadora = 'Operadora Renomeada' where id = {TID}")
caso("mudar só o nome da operadora não manda e-mail", int(sv(AV)) == n0)
sql(f"select public.cadastrar_tronco_voz({EA}, '{REF}', 'Operadora Renomeada', 'sip2.e105.exemplo.com.br', 10, 'senha', "
    f"'11', '1130039999', null, 'usr_e105')", "authenticated", ADM, "aal2")
checar("mudar endereço e bina avisa os Admins, com quem mudou e sem senha", True,
       f"select count(*) || '|' || bool_and(texto like 'Mudou: endereço, bina. Por: Adm {T}%') from public.avisos "
       f"where empresa_id={EA} and para='usuario' and assunto='seguranca' and titulo like '%{REF}%' and id > "
       f"(select max(id) - 2 from public.avisos where empresa_id={EA} and para='usuario')", None, None, "2|true")
checar("a equipe recebe no sino", True,
       f"select count(*) > 0 from public.avisos where empresa_id={EA} and para='equipe' and titulo like '%{REF}% alterado'",
       None, None, "t")
checar("senha trocada (registrar do servidor) avisa com quem guardou", True,
       f"set role service_role; select public.registrar_segredo_tronco_voz({TID}, '{ADM}', 7) is not null; reset role; "
       f"select texto like 'Mudou: senha. Por: Adm {T}%' from public.avisos where empresa_id={EA} and para='usuario' "
       f"and usuario_id='{ADM2}' order by id desc limit 1", None, None, "t")
checar("o aviso de segurança é obrigatório (vira e-mail)", True,
       "select email_obrigatorio from public.notificacao_assuntos where codigo = 'seguranca'", None, None, "t")
checar("nenhum aviso traz o nome do segredo", True,
       f"select count(*) from public.avisos where empresa_id={EA} and (texto like '%motorcx-voz%' or texto like '%voz/trunk%')",
       None, None, 0)

sv(f"delete from public.voz_transferencias where empresa_id in ({EA}, {EB}); "
   f"delete from public.voz_rotas where empresa_id in ({EA}, {EB}); "
   f"delete from public.voz_troncos where empresa_id in ({EA}, {EB})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
