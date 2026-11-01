"""SQL 65 · o que a tela "Fluxo do agente" do site precisa: enviar o rascunho para aprovação e os anexos do pedido.

Cobre: quem edita (editar_canais) envia; Operação e a equipe MotorCX não; rascunho com bloqueio (validador ou
pendência de contexto) é recusado com os códigos; enviado vira sino de quem aprova (aprovar_roteiro_voz), uma vez por
conteúdo; mudar a definição limpa o envio; versão aprovada não é "enviada" de novo; a aprovação continua igual; outra
empresa não envia; anon não chama. Storage: entradas/<slug>/fluxo/... só para quem edita a própria empresa, sem 10+
dígitos seguidos no nome.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_fluxo_site.py
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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 65: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def j(v) -> str:
    return "$j$" + json.dumps(v, ensure_ascii=False) + "$j$::jsonb"


# reaplica o SQL 65 (prova que roda de novo)
r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f",
                    str(RAIZ / "supabase" / "migrations" / "20270102000001_voz_fluxo_site.sql")], capture_output=True, text=True)
assert r.returncode == 0, r.stderr

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

sv("delete from storage.objects where bucket_id = 'entradas' and name like 'vfs-%'")
print(f"\nSQL 65: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
