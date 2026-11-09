"""SQL 87 · Contratação: Agente de voz e Speech Analytics como módulos (chaves na Contratação).

Cobre: a migração roda duas vezes; empresa_modulos aceita agente_voz e speech_analytics (e recusa módulo inventado);
só quem tem editar_contratacao (Master) grava, o Admin da empresa e o Atendimento da equipe não; ligar o módulo liga
voz_config.speech_analytics e desligar (ou apagar a linha) desliga; empresa sem voz_config não ganha uma; voz_config
nova nasce com o valor do módulo; o Master mudando voz_config à mão leva o módulo junto; backfill (voz_config ligado
sem o módulo vira módulo ativo ao rodar o SQL); "Avisar o Admin" aceita speech_analytics; o item ia_speech_analytics é
do módulo speech_analytics e nenhum preço muda.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_modulos_voz.py
Só dados fictícios (empresas e87-*, e-mails @exemplo.test).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL87 = RAIZ / "supabase" / "migrations" / "20270123000001_modulos_voz_speech.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor))
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 87: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL87)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


def flag(e):
    return f"select coalesce((select speech_analytics::text from public.voz_config where empresa_id = {e}), 'sem')"


def modulo(e, m="speech_analytics"):
    return (f"select coalesce((select ativo::text from public.empresa_modulos where empresa_id = {e} "
            f"and modulo = '{m}'), 'sem')")


def upsert(e, m, ativo):
    return (f"insert into public.empresa_modulos (empresa_id, modulo, ativo, canais) values ({e}, '{m}', {ativo}, '{{}}') "
            f"on conflict (empresa_id, modulo) do update set ativo = excluded.ativo")


T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e87-a-{T}', 'E87 A {T}') returning id")   # tem voz_config
EB = sv(f"insert into public.empresas (slug, nome) values ('e87-b-{T}', 'E87 B {T}') returning id")   # sem voz_config
EC = sv(f"insert into public.empresas (slug, nome) values ('e87-c-{T}', 'E87 C {T}') returning id")   # backfill
U = {}
for p in ("master", "atend", "admina", "opera"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}87-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true, empresa_id=null where id='{U['master']}'")
sv(f"update public.perfis set papel='operacao', equipe=true, empresa_id=null, equipe_alcance='todas' where id='{U['atend']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['admina']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['opera']}'")
M = ("authenticated", U["master"])
precos_antes = sv("select count(*) || '|' || coalesce(sum(coalesce(preco, 0)), 0) from public.precos_empresa")

# ---------------------------------------------------------------- backfill: estado de antes do SQL 87
sv(f"insert into public.voz_config (empresa_id, speech_analytics) values ({EA}, false), ({EC}, true)")
sv(f"delete from public.empresa_modulos where empresa_id = {EC} and modulo = 'speech_analytics'")
sv(f"update public.voz_config set speech_analytics = true where empresa_id = {EC}")   # Master pelo jeito antigo
checar("o Master ligando voz_config à mão cria o módulo ativo", True, modulo(EC), valor="true")
# simula a empresa de antes do SQL 87 (voz_config ligado, sem o módulo), sem os gatilhos
sv("alter table public.empresa_modulos disable trigger speech_do_modulo; "
   f"delete from public.empresa_modulos where empresa_id = {EC} and modulo = 'speech_analytics'; "
   "alter table public.empresa_modulos enable trigger speech_do_modulo")
checar("antes do SQL: voz_config ligado e sem módulo", True, modulo(EC) + " || '|' || (" + flag(EC) + ")",
       valor="sem|true")
aplicar(1)
aplicar(2)
checar("backfill: voz_config ligado vira módulo speech_analytics ativo", True, modulo(EC), valor="true")
checar("backfill: o voz_config continua ligado", True, flag(EC), valor="true")
checar("backfill: quem não tinha o Speech não ganha o módulo", True, modulo(EA), valor="sem")
checar("nenhuma voz_config diferente do módulo depois do SQL", True,
       "select count(*) from public.voz_config c where c.speech_analytics is distinct from coalesce((select m.ativo "
       "from public.empresa_modulos m where m.empresa_id = c.empresa_id and m.modulo = 'speech_analytics'), false)",
       valor=0)

# ---------------------------------------------------------------- o módulo
checar("módulo agente_voz aceito", True, upsert(EA, "agente_voz", "true"), *M)
checar("módulo speech_analytics aceito", True, upsert(EB, "speech_analytics", "false"), *M)
checar("módulo inventado recusado", False, upsert(EA, "speech_qualquer", "true"), *M)
checar("Admin da empresa não liga módulo", False, upsert(EA, "speech_analytics", "true"), "authenticated", U["admina"])
checar("... nem a Operação", False, upsert(EA, "speech_analytics", "true"), "authenticated", U["opera"])
checar("Atendimento da equipe (sem editar_contratacao) não liga módulo", False, upsert(EA, "speech_analytics", "true"),
       "authenticated", U["atend"])
checar("... e nada mudou", True, modulo(EA), valor="sem")
checar("cliente vê os próprios módulos (agente_voz ativo)", True, modulo(EA, "agente_voz"), "authenticated", U["opera"],
       valor="true")

# ---------------------------------------------------------------- voz_config.speech_analytics segue o módulo
checar("Master liga o Speech Analytics na Contratação", True, upsert(EA, "speech_analytics", "true"), *M)
checar("... voz_config.speech_analytics ligado (o que a VM lê)", True, flag(EA), valor="true")
checar("Master desliga", True, upsert(EA, "speech_analytics", "false"), *M)
checar("... voz_config.speech_analytics desligado", True, flag(EA), valor="false")
sv(upsert(EA, "speech_analytics", "true"))
sv(f"delete from public.empresa_modulos where empresa_id = {EA} and modulo = 'speech_analytics'")
checar("apagar a linha do módulo desliga o voz_config", True, flag(EA), valor="false")
checar("salvar outro módulo não mexe no voz_config", True, upsert(EA, "api", "true") + "; " + flag(EA), *M,
       valor="false")

checar("empresa sem voz_config: ligar o módulo não cria voz_config", True,
       upsert(EB, "speech_analytics", "true") + f"; select count(*) from public.voz_config where empresa_id = {EB}",
       *M, valor=0)
sv(f"insert into public.voz_config (empresa_id) values ({EB})")
checar("voz_config criada depois nasce com o valor do módulo", True, flag(EB), valor="true")

checar("Master desliga voz_config à mão: o módulo acompanha", True,
       f"update public.voz_config set speech_analytics = false where empresa_id = {EB}; " + modulo(EB), valor="false")
checar("Master liga voz_config à mão: o módulo acompanha", True,
       f"update public.voz_config set speech_analytics = true where empresa_id = {EB}; " + modulo(EB), valor="true")
checar("site não grava voz_config direto", False,
       f"update public.voz_config set speech_analytics = false where empresa_id = {EA}", *M)

# ---------------------------------------------------------------- avisar o Admin e fatura
checar("Avisar o Admin aceita a área speech_analytics", True,
       "select count(*) > 0 from public.avisar_admin('area', 'speech_analytics', null, null)",
       "authenticated", U["opera"], valor="t")
checar("... e o aviso cita o Speech Analytics", True,
       f"select count(*) from public.avisos where empresa_id = {EA} and titulo like '%Speech Analytics'",
       valor=1)
sv("select count(*) from public.avisar_admin('area', 'cobranca', null, null)", "authenticated", U["opera"])
checar("... e a Cobrança continua 'a Cobrança'", True,
       f"select count(*) from public.avisos where empresa_id = {EA} and titulo like '%quer conhecer a Cobrança'", valor=1)
checar("... área inventada continua recusada", False,
       "select * from public.avisar_admin('area', 'speech', null, null)", "authenticated", U["opera"])
checar("item ia_speech_analytics é do módulo speech_analytics", True,
       "select modulo from public.cobranca_itens where codigo = 'ia_speech_analytics'", valor="speech_analytics")
checar("nenhum preço mudou", True,
       "select count(*) || '|' || coalesce(sum(coalesce(preco, 0)), 0) from public.precos_empresa", valor=precos_antes)

print(f"\nSQL 87: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
