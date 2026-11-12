"""SQL 131 · Agente de voz: o executor das ofertas (campos de oferta com validade e a frase fixa; uso das fontes).

Cobre: a migração roda duas vezes; campos_oferta_voz = voz/fluxo_validador.CAMPOS_OFERTA (o mapa de saída do conector
aceita oferta.validade); voz_ofertas_uso só com códigos e contagens (sem coluna de cliente nem valor), só a VM grava
(registrar_ofertas_voz e voz_vm.registrar_ofertas), repetir a ligação não duplica, motivo e descarte fora da lista
recusam, ninguém do site lê; a limpeza apaga o uso com mais de 90 dias.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_ofertas_executor.py
Só dados fictícios (empresas e131-*).
"""
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
from voz import fluxo_validador as FV  # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL131 = RAIZ / "supabase" / "migrations" / "20270328000001_voz_ofertas_executor.sql"
ok_total = falhas = 0


def sql(cmd, papel=None, uid=None, usuario=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + (["-U", usuario] if usuario else []) + ["-f", "-"], input=pre + cmd,
                       capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, usuario=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid, usuario)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 131: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(x):
    return json.dumps(x).replace("'", "''")


for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL131)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)

checar("campos_oferta_voz é a lista do executor", True, "select array_to_string(public.campos_oferta_voz(), ',')",
       valor=",".join(FV.CAMPOS_OFERTA))
checar("o mapa de saída aceita oferta.validade", True,
       "select public.mapa_conector_valido('[]', '[{\"origem\": \"$.o[*].v\", \"destino\": \"oferta.validade\", \"grava\": \"nao\"}]')",
       valor="t")

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e131-a-{T}', 'E131 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e131-b-{T}', 'E131 B {T}') returning id")
CA = sv(f"select id from public.credores where empresa_id = {EA} order by id limit 1")
sv(f"insert into public.voz_config (empresa_id) values ({EA}) on conflict do nothing")
ADM = sv(f"insert into auth.users (email) values ('adm131-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{ADM}'")
L = {"empresa_id": int(EA), "id_chamada": f"ch-{T}-1", "credor_id": int(CA), "fluxo_versao_id": None, "bloco_id": "N6",
     "modo": "api_arquivo", "fonte": "arquivo", "motivo": "api_falhou", "pulou_api": False, "api_classe": "tempo",
     "api_ms": 2500, "descartes": {"vencida": 1}, "ofertas": 2}

checar("as colunas são só códigos e contagens", True,
       "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       "where table_schema = 'public' and table_name = 'voz_ofertas_uso'",
       valor="empresa_id,id_chamada,credor_id,dia,fluxo_versao_id,bloco_id,modo,fonte,motivo,pulou_api,api_classe,"
             "api_ms,descartes,ofertas,registrado_em")
checar("o site não grava", False, f"select public.registrar_ofertas_voz('{j([L])}')", "authenticated", ADM)
checar("a rotina/servidor grava", True, f"select public.registrar_ofertas_voz('{j([L])}')", "service_role", None, 1)
checar("repetir a ligação não duplica", True, f"select public.registrar_ofertas_voz('{j([L])}')", "service_role", None, 0)
checar("a VM grava pelo acesso próprio", True,
       f"select voz_vm.registrar_ofertas('{j({'linhas': [dict(L, id_chamada=f'ch-{T}-2')]})}')", usuario="motorcx_voz",
       valor=1)
checar("empresa sem voz: a VM não grava", False,
       f"select voz_vm.registrar_ofertas('{j({'linhas': [dict(L, empresa_id=int(EB), id_chamada=f'ch-{T}-3')]})}')",
       usuario="motorcx_voz")
for nome, ruim in (("motivo fora da lista", dict(L, motivo="regras")), ("descarte fora da lista", dict(L, descartes={"x": 1})),
                   ("ofertas sem fonte", dict(L, fonte=None)), ("4 ofertas", dict(L, ofertas=4)),
                   ("modo desconhecido", dict(L, modo="padrao"))):
    checar(f"recusa: {nome}", False, f"select public.registrar_ofertas_voz('{j([dict(ruim, id_chamada=f'ch-{T}-x')])}')",
           "service_role")
checar("o site não lê o uso", False, "select count(*) from public.voz_ofertas_uso", "authenticated", ADM)
sv(f"update public.voz_ofertas_uso set dia = current_date - 100 where id_chamada = 'ch-{T}-1'")
checar("a limpeza apaga o uso com mais de 90 dias", True,
       f"set role service_role; select public.limpar_ofertas_voz() ->> 'uso'; reset role; "
       f"select count(*) from public.voz_ofertas_uso where empresa_id = {EA}", valor=1)

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
