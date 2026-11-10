"""SQL 103 · Telefonia, PR T1: a senha do tronco vai direto para o cofre (Edge Function segredo-tronco-voz).

Cobre: a migração roda duas vezes; nenhuma coluna guarda senha; a referência e o nome do segredo são sempre os da
empresa; preparar_segredo_tronco_voz só com quem configura a telefonia (hoje a equipe com gerenciar_troncos_voz), com a
sessão em aal2, tronco por senha e o limite de 5 por hora; registrar_segredo_tronco_voz só pelo servidor e só depois do
pedido da mesma pessoa; o registro zera o teste, muda atualizado_em (a VM regera) e vai para a Auditoria sem valor;
cadastrar_tronco_voz sem a referência usa a da empresa, trocar para IP limpa a senha guardada; o registro dos pedidos
só para quem configura.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_cofre.py
Só dados fictícios (empresas e103-*, e-mails @exemplo.test, IPs de documentação).
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
SQL = RAIZ / "supabase" / "migrations" / "20270216000001_voz_tronco_cofre.sql"
ROTULO = "SQL 103: "


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


def aplicar(arq=SQL):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(arq)], capture_output=True,
                       text=True)
    if r.returncode:
        print(r.stderr[-600:])
    return r


r1, r2 = aplicar(), aplicar()
caso("a migração roda sem erro (duas vezes)", r1.returncode == 0 and r2.returncode == 0)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e103-a-{T}', 'E103 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e103-b-{T}', 'E103 B {T}') returning id")
TEC = sv(f"insert into auth.users (email) values ('tec-{T}@exemplo.test') returning id")
SUP = sv(f"insert into auth.users (email) values ('sup-{T}@exemplo.test') returning id")
ADM = sv(f"insert into auth.users (email) values ('adm-{T}@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, equipe_alcance='todas' where id='{TEC}'")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=false, empresa_id=null, equipe_alcance='todas' where id='{SUP}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{ADM}'")


def tronco(emp, ref, aut="senha", segredo="null", host="sip.e103.exemplo.com.br"):
    usuario = "'usr_e103'" if aut == "senha" else "null"
    return (f"select public.cadastrar_tronco_voz({emp}, '{ref}', 'Operadora Exemplo', '{host}', 5, '{aut}', '11', "
            f"'1130030000', {segredo}, {usuario})")


REF = f"tr103-{T}"
checar("nenhuma coluna com senha em voz_troncos (o valor nunca fica no banco)", True,
       "select count(*) from information_schema.columns where table_name='voz_troncos' and column_name ~ 'senha|password|secret'",
       None, None, 0)
checar("referência e nome do segredo são os da empresa", True,
       "select public.segredo_ref_tronco_voz(12, 'aurora-opc') || '|' || public.nome_segredo_tronco_voz(12, 'aurora-opc')",
       None, None, "voz/trunk/e12/aurora-opc|motorcx-voz-trunk-e12-aurora-opc")
checar("Técnico cadastra tronco com senha sem informar a referência", True, tronco(EA, REF) + " is not null",
       "authenticated", TEC, "t")
TID = sv(f"select id from public.voz_troncos where empresa_id={EA} and referencia='{REF}'")
checar("a referência é a padrão da empresa e a senha ainda não está guardada", True,
       f"select segredo_ref || '|' || (segredo_guardado_em is null) from public.voz_troncos where id={TID}", None, None,
       f"voz/trunk/e{EA}/{REF}|true")
checar("Técnico cadastra tronco por IP", True, tronco(EA, f"ip103-{T}", "ip", host="203.0.113.103") + " is not null",
       "authenticated", TEC, "t")
IPT = sv(f"select id from public.voz_troncos where empresa_id={EA} and referencia='ip103-{T}'")

# ---------------------------------------------------------------- preparar (login da pessoa)
PREP = f"select nome_segredo from public.preparar_segredo_tronco_voz({TID})"
checar("sem a verificação em duas etapas (aal1), não prepara", False, PREP, "authenticated", TEC, aal="aal1",
       erro="verificação em duas etapas")
checar("Técnico com aal2 recebe só o nome do segredo da empresa", True, PREP, "authenticated", TEC,
       f"motorcx-voz-trunk-e{EA}-{REF}", aal="aal2")
checar("tronco por IP não tem senha para guardar", False,
       f"select * from public.preparar_segredo_tronco_voz({IPT})", "authenticated", TEC, aal="aal2", erro="autentica por IP")
checar("equipe sem gerenciar_troncos_voz não prepara (nem sabe se o tronco existe)", False, PREP, "authenticated", SUP,
       aal="aal2", erro="tronco não encontrado")
checar("Admin do cliente ainda não prepara (abre no PR T3)", False, PREP, "authenticated", ADM, aal="aal2",
       erro="tronco não encontrado")
checar("anon não chama preparar", False, PREP, "anon")
checar("o pedido fica registrado, sem valor", True,
       f"select count(*) || '|' || bool_and(usuario = '{TEC}') from public.voz_troncos_cofre where tronco_id={TID} and evento='pedido'",
       None, None, "1|true")

# ---------------------------------------------------------------- registrar (só o servidor)
REG = f"select public.registrar_segredo_tronco_voz({TID}, '{TEC}', 3) is not null"
checar("o site (authenticated) não registra a senha guardada", False, REG, "authenticated", TEC, aal="aal2")
checar("o servidor não registra sem pedido da mesma pessoa", False,
       f"select public.registrar_segredo_tronco_voz({TID}, '{SUP}', 3)", "service_role", erro="pedido de troca")
checar("versão inválida é recusada", False, f"select public.registrar_segredo_tronco_voz({TID}, '{TEC}', 0)",
       "service_role", erro="versão")
sv(f"update public.voz_troncos set testado_em=now(), teste_ok=true, atualizado_em=now() - interval '1 hour' where id={TID}")
checar("o servidor registra depois do pedido", True, REG, "service_role", None, "t")
checar("tronco com referência padrão, data, quem, versão e teste zerado", True,
       f"select segredo_ref || '|' || (segredo_guardado_em is not null) || '|' || (segredo_guardado_por = '{TEC}') || '|' "
       f"|| segredo_versao || '|' || coalesce(teste_ok::text, 'nulo') || '|' || (atualizado_em > now() - interval '1 minute') "
       f"from public.voz_troncos where id={TID}", None, None, f"voz/trunk/e{EA}/{REF}|true|true|3|nulo|true")
checar("a Auditoria registra a troca sem valor nem nome do segredo", True,
       f"select count(*) || '|' || bool_and(mudou::text like '%trocada (versão 3)%' and mudou::text not like '%motorcx-voz%' "
       f"and mudou::text not like '%voz/trunk%') from public.auditoria where tabela='voz_troncos' and registro='{TID}' "
       f"and usuario='{TEC}' and mudou ? 'senha'", None, None, "1|true")
checar("o evento 'guardado' fica no registro", True,
       f"select count(*) from public.voz_troncos_cofre where tronco_id={TID} and evento='guardado' and versao=3", None, None, 1)

# ---------------------------------------------------------------- limite de trocas
for _ in range(4):
    sql(PREP, "authenticated", TEC, "aal2")
checar("a 6ª troca na mesma hora é recusada", False, PREP, "authenticated", TEC, aal="aal2", erro="muitas trocas")

# ---------------------------------------------------------------- cadastrar_tronco_voz depois do cofre
checar("salvar o tronco de novo, sem referência, mantém a senha guardada", True,
       tronco(EA, REF) + f"; select (segredo_guardado_em is not null) || '|' || segredo_versao from public.voz_troncos where id={TID}",
       "authenticated", TEC, "true|3")
checar("passar para IP tira a referência e a senha guardada", True,
       tronco(EA, REF, "ip", host="203.0.113.104") + f"; select coalesce(segredo_ref, 'nulo') || '|' || "
       f"(segredo_guardado_em is null) || '|' || coalesce(segredo_versao::text, 'nulo') from public.voz_troncos where id={TID}",
       "authenticated", TEC, "nulo|true|nulo")
checar("voltar para senha usa a referência padrão de novo, ainda sem senha guardada", True,
       tronco(EA, REF) + f"; select segredo_ref || '|' || (segredo_guardado_em is null) from public.voz_troncos where id={TID}",
       "authenticated", TEC, f"voz/trunk/e{EA}/{REF}|true")
checar("a equipe ainda pode informar uma referência própria (voz/...)", True,
       tronco(EA, f"leg103-{T}", segredo="'voz/trunk/legado-103'") + f"; select segredo_ref from public.voz_troncos "
       f"where empresa_id={EA} and referencia='leg103-{T}'", "authenticated", TEC, "voz/trunk/legado-103")
checar("Admin do cliente não cadastra tronco (abre no PR T3)", False, tronco(EA, f"cli103-{T}"), "authenticated", ADM,
       aal="aal2")

# ---------------------------------------------------------------- quem vê o registro
checar("Técnico vê o registro dos pedidos", True, f"select count(*) > 0 from public.voz_troncos_cofre where empresa_id={EA}",
       "authenticated", TEC, "t")
checar("Admin do cliente não vê o registro (ainda)", True,
       f"select count(*) from public.voz_troncos_cofre where empresa_id={EA}", "authenticated", ADM, 0)
checar("ninguém do site grava no registro", False,
       f"insert into public.voz_troncos_cofre (empresa_id, tronco_id, evento) values ({EA}, {TID}, 'guardado')",
       "authenticated", TEC)
checar("anon não lê o registro", False, "select * from public.voz_troncos_cofre", "anon")
checar("a VM (motorcx_voz) não executa as funções do cofre", True,
       "select has_function_privilege('motorcx_voz', 'public.preparar_segredo_tronco_voz(bigint)', 'execute') "
       "or has_function_privilege('motorcx_voz', 'public.registrar_segredo_tronco_voz(bigint, uuid, int)', 'execute')",
       None, None, "f")

# limpeza (fora das contagens do testar_rls)
sv(f"delete from public.voz_troncos where empresa_id in ({EA}, {EB})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
