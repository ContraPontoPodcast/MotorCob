"""SQL 107 · Agente de voz: ritmo da discagem por carteira (Power e Preditivo, V3).

Cobre: a migração roda duas vezes; o padrão que o site mostra (Power 1,0, teto 3% fixo, razão máxima da 1ª semana 2,0);
salvar_discagem aceita Power (razão 1–3) e Preditivo (meta 0,5–3%, razão máxima 1–3) e guarda versão; recusa modo
desconhecido, razão fora de 1–3, meta acima do teto, campo estranho e valor em texto; sem editar_credores não salva.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_ritmo_config.py
Só dados fictícios (empresas e107-*, e-mails @exemplo.test).
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
SQL107 = RAIZ / "supabase" / "migrations" / "20270222000001_voz_ritmo_config.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 107: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL107)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
E = sv(f"insert into public.empresas (slug, nome) values ('e107-{T}', 'E107 {T}') returning id")
C = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({E}, 'c107{T}', 'Carteira') returning id")
U = {}
for p in ("adm", "ope"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}107-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={E} where id='{U['adm']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={E} where id='{U['ope']}'")
ADM = ("authenticated", U["adm"])
OPE = ("authenticated", U["ope"])


def salvar(ritmo, versao):
    corpo = json.dumps({"ritmo": ritmo}).replace("'", "''")
    return f"select public.salvar_discagem({C}, '{corpo}'::jsonb, {versao}, 'Teste do ritmo')"


checar("padrão: Power 1,0", True,
       "select r ->> 'modo' || ':' || (r ->> 'razao') || ':' || (r ->> 'teto_abandono') || ':' "
       "|| (r ->> 'razao_max_1a_semana') from (select public.discagem_padrao() -> 'ritmo' as r) x",
       valor="power:1.0:3.0:2.0")
checar("regras: bloco ritmo e a chave", True,
       "select (public.discagem_regras() -> '_blocos' -> 'ritmo' ->> 'modo') || ':' "
       "|| (public.discagem_regras() -> '_chaves' ? 'ritmo')", valor='["enum", "power", "preditivo"]:true')
checar("Power 1,5 salva (v2)", True, salvar({"modo": "power", "razao": 1.5}, 0), *ADM, valor=2)
checar("Preditivo com meta e razão máxima salva (v3)", True,
       salvar({"modo": "preditivo", "meta_abandono": 0.8, "razao_max": 2.5}, 2), *ADM, valor=3)
checar("fica em credores.discagem › ritmo", True,
       f"select discagem -> 'ritmo' ->> 'modo' from public.credores where id = {C}", valor="preditivo")
checar("modo desconhecido", False, salvar({"modo": "progressivo"}, 3), *ADM, erro="ritmo/modo: fora da faixa")
checar("razão acima de 3", False, salvar({"modo": "power", "razao": 3.5}, 3), *ADM, erro="ritmo/razao: fora da faixa")
checar("razão abaixo de 1", False, salvar({"modo": "power", "razao": 0.5}, 3), *ADM, erro="ritmo/razao")
checar("meta acima do teto de 3%", False, salvar({"modo": "preditivo", "meta_abandono": 4}, 3), *ADM,
       erro="ritmo/meta_abandono: fora da faixa")
checar("razão máxima acima de 3", False, salvar({"modo": "preditivo", "razao_max": 4}, 3), *ADM, erro="razao_max")
checar("campo estranho (teto não é editável)", False, salvar({"modo": "power", "teto_abandono": 5}, 3), *ADM,
       erro="não existe")
checar("número em texto", False, salvar({"modo": "power", "razao": "2"}, 3), *ADM, erro="ritmo/razao")
checar("sem editar_credores não salva", False, salvar({"modo": "power", "razao": 1.0}, 3), *OPE, erro="sem permissão")
checar("histórico com 3 versões", True,
       f"select count(*) from public.regras_voz_versoes where credor_id = {C}", valor=3)

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
