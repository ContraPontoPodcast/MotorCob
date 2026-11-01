"""SQL 66 · o que a tela "Fluxo do agente" do site precisa: enviar o rascunho para aprovação e os anexos do pedido.

Cobre: quem edita (editar_canais) envia; Operação e a equipe MotorCX não; rascunho com bloqueio (validador ou
pendência de contexto) é recusado com os códigos; enviado vira sino de quem aprova (aprovar_roteiro_voz), uma vez por
conteúdo; mudar a definição limpa o envio; versão aprovada não é "enviada" de novo; a aprovação continua igual; outra
empresa não envia; anon não chama. Storage: entradas/<slug>/fluxo/... só para quem edita a própria empresa, sem 10+
dígitos seguidos no nome.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_fluxo_site.py
Também: descartar o pedido em texto (cancelar_pedido_fluxo_voz: pendente, gerado com o rascunho e o fluxo que nasceu
dele, com a equipe com a mensagem no chamado; gerando e aprovado não) e o job noturno das métricas (agregar_fluxo_dia
pelos dois acessos: service_role e o papel motorcx_voz por voz_vm; idempotente; "desligou" pelo bloco_final da chamada;
fora da janela, authenticated e o papel da VM direto no public são recusados).
Só dados fictícios (empresa vfs-*).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, papel=None, uid=None, usuario=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + (["-U", usuario] if usuario else []) + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None, usuario=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid, usuario)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 66: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def j(v) -> str:
    return "$j$" + json.dumps(v, ensure_ascii=False) + "$j$::jsonb"


# reaplica o SQL 66 (prova que roda de novo)
r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f",
                    str(RAIZ / "supabase" / "migrations" / "20270102000001_voz_fluxo_site.sql")], capture_output=True, text=True)
assert r.returncode == 0, r.stderr
if os.environ.get("PGPASSWORD"):
    sv("alter role motorcx_voz with password '" + os.environ["PGPASSWORD"].replace("'", "''") + "'")

# ------------------------------------------------------------------ dados fictícios
sv("delete from auth.users where email like 'vfs.%@exemplo.test'")
sv("delete from public.empresas where slug in ('vfs-alfa', 'vfs-beta')")
sv("insert into storage.buckets (id, name, public) values ('entradas', 'entradas', false) on conflict do nothing")
EA = sv("insert into public.empresas (slug, nome) values ('vfs-alfa', 'Fluxo Alfa (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('vfs-beta', 'Fluxo Beta (teste)') returning id")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cartao-vfs', 'Cartão Exemplo') returning id")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("adm2", "admin", EA), ("pla", "planejamento", EA), ("ope", "operacao", EA),
                      ("plb", "planejamento", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('vfs.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
U["tec"] = sv("insert into auth.users (email) values ('vfs.tec@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, equipe_alcance='todas', empresa_id=null "
   f"where id='{U['tec']}'")

# conector de validação ativo (só a equipe cadastra; a VM registra o teste)
sv(f"select public.liberar_host_crm({EA}, 'api.crm-vfs.exemplo.com.br')", "authenticated", U["tec"])
CON = sv("select public.salvar_conector_crm(" + EA + ", " + j({
    "nome": "Validar cadastro", "finalidade": "validar_cadastro", "metodo": "POST", "autenticacao": "oauth2_cc",
    "url": "https://api.crm-vfs.exemplo.com.br/v2/clientes/{id_cliente}/validacoes",
    "mapa_entrada": [{"origem": "id_cliente", "destino": "id_cliente", "onde": "path"},
                     {"origem": "data_informada", "destino": "birthDayMonth", "onde": "corpo"}],
    "mapa_saida": [{"origem": "$.match", "destino": "codigo", "grava": "codigo",
                    "valores": {"true": "identidade_ok", "false": "identidade_nao_confere"}}]}) + ")", "authenticated", U["tec"])
sv(f"select public.trocar_credencial_conector({CON})", "authenticated", U["tec"])
sv(f"select public.registrar_teste_conector_crm({CON}, true)", "service_role")
sv(f"select public.mudar_situacao_conector_crm({CON}, 'ativo')", "authenticated", U["tec"])

# rascunho do modelo Localizador: sem o conector de validação fica pendente (identidade_sem_conferencia)
V1 = sv(f"select public.criar_fluxo_de_modelo({EA}, 'localizador', {CA}, 'Localizador VFS')", "authenticated", U["pla"])
checar("rascunho com pendência não vai para aprovação (lista os códigos)", False,
       f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["pla"], erro="identidade_sem_conferencia:N2")
checar("Operação não envia", False, f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["ope"])
checar("equipe MotorCX não envia o fluxo do cliente", False, f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["tec"])
checar("outra empresa não envia", False, f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["plb"])
checar("anon não chama", False, f"select public.enviar_fluxo_voz_aprovacao({V1})", "anon")

# com o conector escolhido em N2, nada segura: envia
DEF = sv(f"select jsonb_set(definicao, '{{blocos,1,params,conector_id}}', to_jsonb({CON}::bigint)) from public.voz_fluxo_versoes where id={V1}")
sv(f"select public.salvar_fluxo_voz({EA}, {CA}, 'Localizador VFS', 'localizador', $j${DEF}$j$::jsonb, {V1})", "authenticated", U["pla"])
checar("sem bloqueio, quem edita envia", True, f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["pla"], "enviado")
checar("o envio fica marcado com quem enviou", True,
       f"select (enviado_aprovacao_em is not null)::text || (enviado_por = '{U['pla']}')::text from public.voz_fluxo_versoes where id={V1}",
       "authenticated", U["ope"], "truetrue")
checar("sino para cada pessoa que aprova (os dois Admin), não para quem enviou nem para a Operação", True,
       f"select string_agg(nome, ',' order by nome) from public.perfis where id in (select usuario_id from public.avisos where chave like 'voz_fluxo_enviado:{V1}:%')",
       None, None, "Pessoa adm,Pessoa adm2")
checar("o link do sino abre o editor da versão", True,
       f"select count(distinct link) || '|' || min(link) from public.avisos where chave like 'voz_fluxo_enviado:{V1}:%'",
       None, None, f"1|/canais/agente-virtual/editor/{V1}")
sv(f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["pla"])
checar("enviar de novo o mesmo conteúdo não repete o sino", True,
       f"select count(*) from public.avisos where chave like 'voz_fluxo_enviado:{V1}:%'", None, None, 2)

# mudar a definição limpa o envio
DEF2 = sv(f"select jsonb_set(definicao, '{{blocos,0,params,fala}}', '\"Olá, aqui é a {{{{assessoria}}}}. Falo com {{{{primeiro_nome}}}}?\"') from public.voz_fluxo_versoes where id={V1}")
sv(f"select public.salvar_fluxo_voz({EA}, {CA}, null, null, $j${DEF2}$j$::jsonb, {V1})", "authenticated", U["pla"])
checar("mudar o rascunho limpa o envio", True,
       f"select coalesce(enviado_aprovacao_em::text, 'limpo') from public.voz_fluxo_versoes where id={V1}", "authenticated", U["ope"], "limpo")

# a aprovação segue igual (aprovar_fluxo_voz) e versão aprovada não é enviada de novo
checar("Admin aprova (sem depender do envio)", True, f"select public.aprovar_fluxo_voz({V1})", "authenticated", U["adm"], "aprovado_empresa")
checar("versão aprovada não vai para aprovação de novo", False, f"select public.enviar_fluxo_voz_aprovacao({V1})", "authenticated", U["pla"])
checar("usuário não grava o envio direto", False,
       f"update public.voz_fluxo_versoes set enviado_aprovacao_em = now() where id={V1}", "authenticated", U["pla"])

# Storage: anexos do pedido em texto em entradas/<slug>/fluxo/...
checar("quem edita anexa em entradas/<slug>/fluxo/", True,
       "insert into storage.objects (bucket_id, name) values ('entradas', 'vfs-alfa/fluxo/2026-11-01/abc_roteiro.pdf') returning bucket_id",
       "authenticated", U["pla"], "entradas")
checar("Operação não anexa", False,
       "insert into storage.objects (bucket_id, name) values ('entradas', 'vfs-alfa/fluxo/2026-11-01/x.pdf')", "authenticated", U["ope"])
checar("outra empresa não anexa na pasta da A", False,
       "insert into storage.objects (bucket_id, name) values ('entradas', 'vfs-alfa/fluxo/2026-11-01/y.pdf')", "authenticated", U["plb"])
checar("nome com 10+ dígitos seguidos é recusado (cara de documento)", False,
       "insert into storage.objects (bucket_id, name) values ('entradas', 'vfs-alfa/fluxo/2026-11-01/12345678901.pdf')",
       "authenticated", U["pla"])
checar("fora da pasta fluxo continua recusado", False,
       "insert into storage.objects (bucket_id, name) values ('entradas', 'vfs-alfa/qualquer/z.pdf')", "authenticated", U["pla"])
checar("o anexo enviado vale no pedido em texto", True,
       f"select public.pedir_fluxo_voz({EA}, {CA}, 'Quero confirmar a data de nascimento antes do valor.', "
       "array['entradas/vfs-alfa/fluxo/2026-11-01/abc_roteiro.pdf']) is not null", "authenticated", U["pla"], "t")

# ------------------------------------------------------------------ descartar o pedido em texto
PED = sv(f"select id from public.voz_fluxo_pedidos where empresa_id={EA} and situacao='pendente'")
checar("Operação não descarta o pedido", False, f"select public.cancelar_pedido_fluxo_voz({PED})", "authenticated", U["ope"])
checar("outra empresa não descarta", False, f"select public.cancelar_pedido_fluxo_voz({PED})", "authenticated", U["plb"])
checar("quem edita descarta o pedido pendente", True, f"select public.cancelar_pedido_fluxo_voz({PED})", "authenticated", U["pla"], "cancelado")
checar("o pedido fica guardado com quem cancelou", True,
       f"select situacao || '|' || (cancelado_por = '{U['pla']}')::text from public.voz_fluxo_pedidos where id={PED}", "authenticated", U["ope"], "cancelado|true")
checar("descartar de novo não muda nada", True, f"select public.cancelar_pedido_fluxo_voz({PED})", "authenticated", U["pla"], "cancelado")
DEFV = sv(f"select definicao from public.voz_fluxo_versoes where id={V1}")
PG = sv(f"select public.pedir_fluxo_voz({EA}, {CA}, 'Quero um localizador simples, que confirma a data e transfere.')", "authenticated", U["pla"])
sv(f"update public.voz_fluxo_pedidos set situacao='gerando' where id={PG}")
checar("pedido em geração espera terminar", False, f"select public.cancelar_pedido_fluxo_voz({PG})", "authenticated", U["pla"], erro="espere terminar")
VG = sv(f"select public.registrar_geracao_fluxo_voz({PG}, $j${DEFV}$j$::jsonb, '{{\"entendi\": []}}'::jsonb)", "service_role")
FG = sv(f"select fluxo_id from public.voz_fluxo_versoes where id={VG}")
checar("descartar o gerado apaga o rascunho e o fluxo que nasceu do pedido", True,
       f"select public.cancelar_pedido_fluxo_voz({PG}); select (select count(*) from public.voz_fluxo_versoes where id={VG}) || '|' || "
       f"(select count(*) from public.voz_fluxos where id={FG}) || '|' || (select coalesce(versao_gerada_id::text, 'sem') from public.voz_fluxo_pedidos where id={PG})",
       "authenticated", U["pla"], "0|0|sem")
PE = sv(f"select public.pedir_fluxo_equipe({EA}, {CA}, 'Montem para nós um negociador com as ofertas do CRM.')", "authenticated", U["pla"])
checar("descartar o pedido à equipe avisa no chamado", True,
       f"select public.cancelar_pedido_fluxo_voz({PE}); select count(*) from public.chamado_mensagens m join public.voz_fluxo_pedidos p on p.chamado_id = m.chamado_id "
       f"where p.id={PE} and m.texto like 'Pedido de fluxo cancelado%'", "authenticated", U["pla"], 1)
PA = sv(f"select public.pedir_fluxo_voz({EA}, {CA}, 'Outro localizador para comparar as duas versões.')", "authenticated", U["pla"])
sv(f"update public.voz_fluxo_pedidos set situacao='gerando' where id={PA}")
VA = sv(f"select public.registrar_geracao_fluxo_voz({PA}, $j${DEFV}$j$::jsonb, '{{}}'::jsonb)", "service_role")
sv(f"select public.aprovar_fluxo_voz({VA})", "authenticated", U["adm"])
checar("versão gerada já aprovada não é descartada", False, f"select public.cancelar_pedido_fluxo_voz({PA})", "authenticated", U["pla"], erro="já foi aprovada")
checar("anon não descarta", False, f"select public.cancelar_pedido_fluxo_voz({PA})", "anon")

# ------------------------------------------------------------------ job noturno das métricas do fluxo
sv(f"insert into public.voz_config (empresa_id) values ({EA}) on conflict do nothing")
ONTEM = sv("select (now() at time zone 'America/Sao_Paulo')::date - 1")
QUANDO = f"(('{ONTEM}'::date + time '10:00') at time zone 'America/Sao_Paulo')"
for idc, final in (("vfs-ch-a", "N4"), ("vfs-ch-b", "N6"), ("vfs-ch-c", "N2")):
    sv(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em, resultado, fluxo_versao_id, bloco_final) "
       f"values ({EA}, {CA}, '{idc}', 'CLI-0{idc[-1]}', 'real', {QUANDO}, 'cpc', {V1}, '{final}')", "service_role")
PASSOS = [("vfs-ch-a", 1, "N1", "arvore", "titular", None), ("vfs-ch-a", 2, "N2", "cognicao", "confirmou", None),
          ("vfs-ch-a", 3, "N3", "arvore", "sim", "quero_negociar"), ("vfs-ch-a", 4, "N4", "arvore", None, None),
          ("vfs-ch-b", 1, "N1", "arvore", "terceiro", None), ("vfs-ch-b", 2, "N6", "arvore", None, None),
          ("vfs-ch-c", 1, "N1", "arvore", "titular", None), ("vfs-ch-c", 2, "N2", "cognicao", None, None)]
for idc, ordem, bloco, modo, q, intencao in PASSOS:
    sv(f"insert into public.voz_fluxo_passos (empresa_id, chamada_id, id_chamada, fluxo_versao_id, ordem, bloco_id, modo, entrou_em, saida_quando, intencao) "
       f"values ({EA}, (select id from public.voz_chamadas where id_chamada='{idc}'), '{idc}', {V1}, {ordem}, '{bloco}', '{modo}', {QUANDO}, "
       f"{'null' if q is None else repr(q)}, {'null' if intencao is None else repr(intencao)})", "service_role")
checar("o servidor agrega o dia (blocos e intenções)", True, f"select public.agregar_fluxo_dia({EA}, '{ONTEM}')::text", "service_role", None,
       '{"blocos": 5, "intencoes": 1}')
checar("funil da abertura: chegaram 3, titular 2 e terceiro 1", True,
       f"select chegaram || '|' || saidas::text from public.voz_fluxo_metricas_dia where fluxo_versao_id={V1} and dia='{ONTEM}' and bloco_id='N1'",
       "authenticated", U["ope"], '3|{"titular": 2, "terceiro": 1}')
checar("quem parou num bloco que não é final conta como desligou (pelo bloco_final da chamada)", True,
       f"select saidas::text from public.voz_fluxo_metricas_dia where fluxo_versao_id={V1} and dia='{ONTEM}' and bloco_id='N2'",
       "authenticated", U["ope"], '{"desligou": 1, "confirmou": 1}')
checar("final (transferir) não vira desligou", True,
       f"select saidas::text from public.voz_fluxo_metricas_dia where fluxo_versao_id={V1} and dia='{ONTEM}' and bloco_id='N4'", "authenticated", U["ope"], "{}")
checar("intenções do dia por bloco", True,
       f"select bloco_id || ':' || intencao || '=' || n from public.voz_fluxo_intencoes_dia where fluxo_versao_id={V1} and dia='{ONTEM}'", "authenticated", U["ope"], "N3:quero_negociar=1")
checar("a VM (papel motorcx_voz) agrega pelo voz_vm e dá o mesmo resultado (idempotente)", True,
       f"select voz_vm.agregar_fluxo_dia('{{\"empresa\": {EA}, \"dia\": \"{ONTEM}\"}}')::text", None, None, '{"blocos": 5, "intencoes": 1}', usuario="motorcx_voz")
checar("rodar de novo não duplica", True, f"select count(*) from public.voz_fluxo_metricas_dia where empresa_id={EA} and dia='{ONTEM}'", "service_role", None, 5)
checar("a VM lista as empresas da parte pelo voz_vm", True,
       f"select voz_vm.fluxo_empresas('{{\"parte\": \"1/1\"}}') @> '[{EA}]'", None, None, "t", usuario="motorcx_voz")
checar("o papel da VM não chama a função do public direto", False, f"select public.agregar_fluxo_dia({EA}, '{ONTEM}')", None, None, usuario="motorcx_voz")
checar("usuário do site não agrega", False, f"select public.agregar_fluxo_dia({EA}, '{ONTEM}')", "authenticated", U["adm"])
checar("dia fora da janela de 35 dias é recusado", False, f"select public.agregar_fluxo_dia({EA}, current_date - 60)", "service_role")
checar("outra empresa não lê as métricas da A", True, f"select count(*) from public.voz_fluxo_metricas_dia where empresa_id={EA}", "authenticated", U["plb"], 0)
checar("prévia de voz entra no uso de IA (componente previa_voz)", True,
       f"select public.registrar_uso_ia_voz({EA}, '{ONTEM}', 'previa_voz', 1, 0.05, 0, 45, 0) >= 0", "service_role", None, "t")

sv("delete from storage.objects where bucket_id = 'entradas' and name like 'vfs-%'")
print(f"\nSQL 66: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
