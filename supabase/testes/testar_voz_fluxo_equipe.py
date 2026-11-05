"""SQL 68 · a equipe MotorCX monta o fluxo do agente virtual dentro da empresa cliente.

Cobre: a equipe com responder_chamados (Master e Técnico) cria do zero, de modelo e por pedido em texto, edita o
rascunho, duplica, cuida da base de respostas e dos casos de teste, roda o roleplay e ENVIA PARA APROVAÇÃO, com o autor
e a auditoria no nome da pessoa da equipe. A equipe NÃO aprova, NÃO coloca em uso, NÃO volta versão, NÃO revisa a
resposta da base e NÃO mexe na alçada (mesmo o Master). Sem responder_chamados (Comercial, ou o Técnico com a permissão
desligada) ou fora do alcance (carteira) a equipe não edita. Usuário de outra empresa continua sem acesso e o cliente
continua igual (Planejamento edita e envia, Admin aprova e coloca em uso, Operação não edita). Prova também que o SQL 68
roda de novo sem erro (aplica duas vezes).

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_fluxo_equipe.py
Só dados fictícios (empresa vfe-*).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL68 = RAIZ / "supabase" / "migrations" / "20270104000001_voz_fluxo_equipe.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 68: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def j(v) -> str:
    return "$j$" + json.dumps(v, ensure_ascii=False) + "$j$::jsonb"


# aplica o SQL 68 duas vezes (prova que roda de novo sem erro)
for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL68)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])

# ------------------------------------------------------------------ dados fictícios
sv("delete from auth.users where email like 'vfe.%@exemplo.test'")
sv("delete from public.empresas where slug in ('vfe-alfa', 'vfe-beta')")
EA = sv("insert into public.empresas (slug, nome) values ('vfe-alfa', 'Fluxo Equipe Alfa (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('vfe-beta', 'Fluxo Equipe Beta (teste)') returning id")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cartao-vfe', 'Cartão Exemplo') returning id")
CA2 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'emprestimo-vfe', 'Empréstimo Exemplo') returning id")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("pla", "planejamento", EA), ("ope", "operacao", EA), ("plb", "planejamento", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('vfe.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
# equipe: Master, Técnico, Técnico sem responder_chamados, Comercial, Atendimento só da carteira (sem a empresa A)
for p, papel, tecnico, alcance in (("mst", "admin", "false", "todas"), ("tec", "operacao", "true", "todas"),
                                   ("tsr", "operacao", "true", "todas"), ("com", "gestao", "false", "todas"),
                                   ("atc", "operacao", "false", "carteira")):
    U[p] = sv(f"insert into auth.users (email) values ('vfe.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set equipe=true, papel='{papel}', equipe_tecnico={tecnico}, equipe_alcance='{alcance}', "
       f"empresa_id=null, nome='Equipe {p}' where id='{U[p]}'")
sv(f"insert into public.permissoes_equipe (usuario_id, permissao, permitido) values ('{U['tsr']}', 'responder_chamados', false)")

# conector de validação ativo (a equipe cadastra; a VM registra o teste)
sv(f"select public.liberar_host_crm({EA}, 'api.crm-vfe.exemplo.com.br')", "authenticated", U["tec"])
CON = sv("select public.salvar_conector_crm(" + EA + ", " + j({
    "nome": "Validar cadastro", "finalidade": "validar_cadastro", "metodo": "POST", "autenticacao": "oauth2_cc",
    "url": "https://api.crm-vfe.exemplo.com.br/v2/clientes/{id_cliente}/validacoes",
    "mapa_entrada": [{"origem": "id_cliente", "destino": "id_cliente", "onde": "path"},
                     {"origem": "data_informada", "destino": "birthDayMonth", "onde": "corpo"}],
    "mapa_saida": [{"origem": "$.match", "destino": "codigo", "grava": "codigo",
                    "valores": {"true": "identidade_ok", "false": "identidade_nao_confere"}}]}) + ")", "authenticated", U["tec"])
sv(f"select public.trocar_credencial_conector({CON})", "authenticated", U["tec"])
sv(f"select public.registrar_teste_conector_crm({CON}, true)", "service_role")
sv(f"select public.mudar_situacao_conector_crm({CON}, 'ativo')", "authenticated", U["tec"])
LOC = sv("select definicao from public.voz_fluxo_modelos where codigo='localizador'")
LOC_OK = sv(f"select jsonb_set($j${LOC}$j$::jsonb, '{{blocos,1,params,conector_id}}', to_jsonb({CON}::bigint))")

# ------------------------------------------------------------------ o critério (pode_editar_fluxo_voz)
checar("Master da equipe edita o fluxo da empresa", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["mst"], "t")
checar("Técnico (responder_chamados no padrão) edita", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["tec"], "t")
checar("Técnico com responder_chamados desligado não edita", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["tsr"], "f")
checar("Comercial (sem responder_chamados) não edita", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["com"], "f")
checar("Atendimento só da carteira não edita empresa fora dela", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["atc"], "f")
checar("empresa nula nunca vale (nem para o Master)", True, "select public.pode_editar_fluxo_voz(null)", "authenticated", U["mst"], "f")
checar("a equipe continua sem aprovar (pode_aprovar_fluxo_voz, mesmo o Master)", True,
       f"select public.pode_aprovar_fluxo_voz({EA})", "authenticated", U["mst"], "f")
checar("cliente: Planejamento edita a própria empresa", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["pla"], "t")
checar("cliente: Planejamento não edita outra empresa", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["plb"], "f")
checar("cliente: Operação não edita", True, f"select public.pode_editar_fluxo_voz({EA})", "authenticated", U["ope"], "f")
checar("anon não chama", False, f"select public.pode_editar_fluxo_voz({EA})", "anon")

# ------------------------------------------------------------------ a equipe cria, edita, duplica
V1 = sv(f"select public.criar_fluxo_de_modelo({EA}, 'localizador', {CA}, 'Localizador montado pela equipe')", "authenticated", U["tec"])
checar("equipe cria de modelo, com ela como autora do fluxo e da versão", True,
       f"select (f.criado_por = '{U['tec']}')::text || (v.criado_por = '{U['tec']}')::text || v.situacao from public.voz_fluxo_versoes v "
       f"join public.voz_fluxos f on f.id = v.fluxo_id where v.id = {V1}", "service_role", None, "truetruerascunho")
checar("o cliente vê o fluxo montado pela equipe", True, f"select count(*) from public.voz_fluxo_versoes where id={V1}", "authenticated", U["ope"], 1)
checar("equipe edita o rascunho", True,
       f"select public.salvar_fluxo_voz({EA}, {CA}, 'Localizador montado pela equipe', 'localizador', $j${LOC_OK}$j$::jsonb, {V1})",
       "authenticated", U["tec"], V1)
checar("a edição fica na auditoria no nome da pessoa da equipe", True,
       f"select count(*) > 0 from public.auditoria where tabela='voz_fluxo_versoes' and registro='{V1}' and acao='UPDATE' "
       f"and usuario='{U['tec']}' and mudou ? 'definicao'", "service_role", None, "t")
V0 = sv(f"select public.salvar_fluxo_voz({EA}, {CA2}, 'Do zero pela equipe', 'negociador', "
        f"(select definicao from public.voz_fluxo_modelos where codigo='negociador'))", "authenticated", U["mst"])
checar("Master cria do zero", True, f"select criado_por = '{U['mst']}' from public.voz_fluxo_versoes where id={V0}", "service_role", None, "t")
checar("equipe duplica para outra carteira", True,
       f"select public.duplicar_fluxo_voz({V1}, {CA2}, 'Cópia pela equipe') is not null", "authenticated", U["tec"], "t")
checar("Técnico sem responder_chamados não cria", False,
       f"select public.criar_fluxo_de_modelo({EA}, 'localizador', {CA}, 'X')", "authenticated", U["tsr"], erro="sem permissão para editar")
checar("Comercial não cria", False, f"select public.criar_fluxo_de_modelo({EA}, 'localizador', {CA}, 'X')", "authenticated", U["com"])
checar("Atendimento fora da carteira não cria", False, f"select public.criar_fluxo_de_modelo({EA}, 'localizador', {CA}, 'X')", "authenticated", U["atc"])
checar("Comercial não edita o rascunho", False,
       f"select public.salvar_fluxo_voz({EA}, {CA}, null, null, $j${LOC_OK}$j$::jsonb, {V1})", "authenticated", U["com"])

# ------------------------------------------------------------------ base de respostas e casos de teste
RID = sv(f"select public.salvar_resposta_fluxo_voz({V0}, 'N5', 'Suja meu nome?', 'Com o acordo em dia, não.')", "authenticated", U["tec"])
checar("equipe guarda resposta na base (sem revisão)", True,
       f"select revisado_em is null from public.voz_base_respostas where id={RID}", "service_role", None, "t")
checar("equipe NÃO revisa a resposta (é de quem aprova)", False, f"select public.revisar_resposta_fluxo_voz({RID})", "authenticated", U["mst"],
       erro="sem permissão para revisar")
checar("cliente que aprova revisa a resposta montada pela equipe", True,
       f"select public.revisar_resposta_fluxo_voz({RID}); select revisado_por = '{U['adm']}' from public.voz_base_respostas where id={RID}",
       "authenticated", U["adm"], "t")
RID2 = sv(f"select public.salvar_resposta_fluxo_voz({V0}, 'N5', 'Posso pagar depois?', 'Posso agendar um retorno.')", "authenticated", U["tec"])
checar("equipe apaga resposta do rascunho", True,
       f"select public.apagar_resposta_fluxo_voz({RID2}); select count(*) from public.voz_base_respostas where id={RID2}", "authenticated", U["tec"], 0)
F1 = sv(f"select fluxo_id from public.voz_fluxo_versoes where id={V1}")
CASO = sv(f"select public.salvar_caso_teste_fluxo_voz({F1}, 'Titular confirma', array['Sou eu'], array['N1','N2'])", "authenticated", U["tec"])
checar("equipe guarda caso de teste, como autora", True,
       f"select criado_por = '{U['tec']}' from public.voz_fluxo_casos_teste where id={CASO}", "service_role", None, "t")
checar("equipe edita o caso de teste", True,
       f"select public.salvar_caso_teste_fluxo_voz({F1}, 'Titular confirma a data', array['Sou eu'], array['N1','N2'], null, '{{}}', {CASO})",
       "authenticated", U["tec"], CASO)
CASO2 = sv(f"select public.salvar_caso_teste_fluxo_voz({F1}, 'Para apagar', array['Não sou'], array['N1'])", "authenticated", U["tec"])
checar("equipe apaga caso de teste", True,
       f"select public.apagar_caso_teste_fluxo_voz({CASO2}); select count(*) from public.voz_fluxo_casos_teste where id={CASO2}",
       "authenticated", U["tec"], 0)
checar("outra empresa não guarda caso no fluxo da A", False,
       f"select public.salvar_caso_teste_fluxo_voz({F1}, 'X', array['oi'], array['N1'])", "authenticated", U["plb"])

# ------------------------------------------------------------------ testar a conversa (roleplay) e pedido em texto
PERS = sv("select id from public.roleplay_personas where empresa_id is null and ativa order by id limit 1")
checar("equipe roda o roleplay da versão", True,
       f"select public.rodar_roleplay_voz({V1}, array[{PERS}]::bigint[], 1) is not null", "authenticated", U["tec"], "t")
checar("o lote fica no nome de quem pediu da equipe", True,
       f"select pedido_por = '{U['tec']}' from public.roleplay_lotes where fluxo_versao_id={V1}", "service_role", None, "t")
PED = sv(f"select public.pedir_fluxo_voz({EA}, {CA2}, 'Quero um localizador que confirma a data e transfere.')", "authenticated", U["tec"])
checar("equipe pede o rascunho por texto à IA, como autora", True,
       f"select pedido_por = '{U['tec']}' from public.voz_fluxo_pedidos where id={PED}", "service_role", None, "t")
checar("equipe descarta o pedido em texto", True, f"select public.cancelar_pedido_fluxo_voz({PED})", "authenticated", U["tec"], "cancelado")
checar("Comercial não pede rascunho por texto", False,
       f"select public.pedir_fluxo_voz({EA}, {CA2}, 'Quero um localizador simples para a carteira.')", "authenticated", U["com"])

# ------------------------------------------------------------------ enviar para aprovação: sim; aprovar e usar: não
checar("equipe envia o rascunho para aprovação", True, f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["tec"], "enviado")
checar("o envio fica marcado com a pessoa da equipe", True,
       f"select (enviado_aprovacao_em is not null)::text || (enviado_por = '{U['tec']}')::text from public.voz_fluxo_versoes where id={V1}",
       "service_role", None, "truetrue")
checar("o sino vai para quem aprova no cliente, não para a equipe", True,
       f"select string_agg(nome, ',' order by nome) from public.perfis where id in "
       f"(select usuario_id from public.avisos where chave like 'voz_fluxo_enviado:{V1}:%')", "service_role", None, "Pessoa adm")
checar("Comercial não envia", False, f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["com"])
checar("Técnico NÃO aprova", False, f"select public.aprovar_fluxo_voz({V1})", "authenticated", U["tec"], erro="sem permissão para aprovar")
checar("Master NÃO aprova", False, f"select public.aprovar_fluxo_voz({V1})", "authenticated", U["mst"], erro="sem permissão para aprovar")
checar("a versão continua rascunho depois das tentativas da equipe", True,
       f"select situacao from public.voz_fluxo_versoes where id={V1}", "service_role", None, "rascunho")
checar("Admin do cliente aprova o que a equipe montou", True, f"select public.aprovar_fluxo_voz({V1})", "authenticated", U["adm"], "aprovado_empresa")
checar("Técnico NÃO coloca em uso", False, f"select public.usar_fluxo_voz({V1})", "authenticated", U["tec"], erro="sem permissão para colocar o fluxo em uso")
checar("Master NÃO coloca em uso", False, f"select public.usar_fluxo_voz({V1})", "authenticated", U["mst"], erro="sem permissão para colocar o fluxo em uso")
checar("Admin do cliente coloca em uso", True, f"select public.usar_fluxo_voz({V1})", "authenticated", U["adm"], "em_uso")
# versão nova (rascunho) pela equipe a partir da em uso; aprovar e usar continuam do cliente
V2 = sv(f"select public.salvar_fluxo_voz({EA}, {CA}, null, null, $j${LOC_OK}$j$::jsonb, {V1})", "authenticated", U["tec"])
checar("equipe abre versão nova a partir da em uso (rascunho)", True,
       f"select versao || situacao from public.voz_fluxo_versoes where id={V2}", "service_role", None, "2rascunho")
sv(f"select public.aprovar_fluxo_voz({V2}); select public.usar_fluxo_voz({V2})", "authenticated", U["adm"])
checar("Master NÃO volta versão (v1 arquivada)", False, f"select public.voltar_versao_fluxo_voz({F1}, 1, 'teste da equipe')",
       "authenticated", U["mst"], erro="sem permissão para voltar a versão")
checar("equipe NÃO mexe na alçada da carteira", False, f"select public.salvar_alcada_voz({EA}, {CA}, 30, 6, 50)", "authenticated", U["mst"])

# ------------------------------------------------------------------ outra empresa e o cliente, iguais
checar("outra empresa não cria fluxo na A", False,
       f"select public.criar_fluxo_de_modelo({EA}, 'localizador', {CA}, 'X')", "authenticated", U["plb"])
checar("outra empresa não edita o rascunho da A", False,
       f"select public.salvar_fluxo_voz({EA}, {CA2}, null, null, $j${LOC_OK}$j$::jsonb, {V0})", "authenticated", U["plb"])
checar("outra empresa não vê os fluxos da A", True, f"select count(*) from public.voz_fluxo_versoes where empresa_id={EA}", "authenticated", U["plb"], 0)
checar("cliente: Operação continua sem criar", False,
       f"select public.criar_fluxo_de_modelo({EA}, 'localizador', {CA}, 'X')", "authenticated", U["ope"])
V3 = sv(f"select public.criar_fluxo_de_modelo({EA}, 'localizador', null, 'Localizador do cliente')", "authenticated", U["pla"])
sv(f"select public.salvar_fluxo_voz({EA}, null, null, null, $j${LOC_OK}$j$::jsonb, {V3})", "authenticated", U["pla"])
checar("cliente: Planejamento cria, edita e envia como antes", True, f"select public.enviar_fluxo_voz_aprovacao({V3})", "authenticated", U["pla"], "enviado")
checar("cliente: Planejamento continua sem aprovar", False, f"select public.aprovar_fluxo_voz({V3})", "authenticated", U["pla"])
checar("cliente: Admin aprova e coloca em uso como antes", True,
       f"select public.aprovar_fluxo_voz({V3}); select public.usar_fluxo_voz({V3})", "authenticated", U["adm"], "em_uso")

print(f"\nSQL 68: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
