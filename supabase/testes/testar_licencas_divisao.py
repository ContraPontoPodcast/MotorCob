"""SQL 101 · Agente de voz: robôs contratados (licenças) na divisão do teto global, PR 4.

Cobre: a migração roda duas vezes (e o SQL 98 rodado de novo depois dela não desfaz a divisão nova); a divisão com as
licenças em cenários isolados (cada um numa transação desfeita no fim, só com as empresas do cenário): cabe no teto
(limite = licenças; tronco menor limita), overbooking (proporcional à demanda usável com maior resto, nunca acima da
demanda, a soma é o teto), sem licença fica só com a sobra pelos canais (e com zero quando não sobra), só legado igual à
regra antiga, licença agendada ou com 0 robôs = legado, licença sem tronco ativo (0, 'tronco'), pico desligado para quem
tem licença e mantido no legado (teto = min(limite × pico, canais)); colunas novas no fim e as antigas com o mesmo nome;
o cliente vê só a própria linha, com o motivo e sem o teto global (contratado e cota nulos); a equipe vê o teto; a view
da VM (voz_vm.divisao_concorrencia) tem as colunas novas e só o papel motorcx_voz lê; anon nada;
definir_concorrencia_contratada avisa a equipe quando o teto fica abaixo dos robôs vendidos (só quando diminui), sem
bloquear.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_licencas_divisao.py
Só dados fictícios (empresas e101-*, e-mails @exemplo.test).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
MIG = RAIZ / "supabase" / "migrations"
SQL101 = MIG / "20270214000001_voz_licencas_divisao.sql"
SQL98 = MIG / "20270205000001_voz_licencas_fatura.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 101: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def rodar(arq, vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(arq)], capture_output=True,
                       text=True)
    checar(f"{arq.name} roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


rodar(SQL101, 1)
rodar(SQL101, 2)
COLS = ("empresa_id bigint, canais integer, contratado integer, cota numeric, limite integer, pico_multiplo integer, "
        "teto integer, licencas integer, motivo text")
checar("o SQL 98 rodado de novo depois não desfaz a divisão nova", True,
       f"select pg_get_function_result('public.divisao_concorrencia_voz()'::regprocedure)", valor=f"TABLE({COLS})")
rodar(SQL98, 3)
checar("divisão: colunas antigas com o mesmo nome e as novas no fim", True,
       "select pg_get_function_result('public.divisao_concorrencia_voz()'::regprocedure)", valor=f"TABLE({COLS})")
checar("voz_vm.divisao(): as mesmas colunas", True,
       "select pg_get_function_result('voz_vm.divisao()'::regprocedure)", valor=f"TABLE({COLS})")
checar("views: public e da VM com licencas e motivo", True,
       "select string_agg(table_schema || '.' || column_name, ',' order by table_schema, ordinal_position) "
       "from information_schema.columns where table_name in ('voz_divisao_concorrencia', 'divisao_concorrencia') "
       "and column_name in ('licencas', 'motivo')",
       valor="public.licencas,public.motivo,voz_vm.licencas,voz_vm.motivo")

T = uuid.uuid4().hex[:6]
TETO_ANTES = sv("select concorrencia_contratada from public.voz_contrato")
E = {}
for k in ("a", "b", "c", "d", "e"):
    E[k] = sv(f"insert into public.empresas (slug, nome) values ('e101-{k}-{T}', 'E101 {k.upper()} {T}') returning id")
U = {}
for p in ("master", "cli", "tec"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}101-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['master']}'")
sv(f"update public.perfis set papel='admin', empresa_id={E['a']} where id='{U['cli']}'")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, "
   f"equipe_alcance='todas' where id='{U['tec']}'")
M = ("authenticated", U["master"])
CL = ("authenticated", U["cli"])
LETRA = f"split_part(x.slug, '-', 2)"


def cenario(n, emps, consulta=None, papel="service_role", uid=None):
    """Um cenário isolado numa transação desfeita: só as empresas dadas têm tronco ativo e licença.
    emps: letra -> (canais ou None, robôs ou None, pico, desde da licença)."""
    s = ["begin;", "set session_replication_role = replica;",
         "update public.voz_troncos set ativo = false where ativo;", "delete from public.voz_licencas;",
         f"update public.voz_contrato set concorrencia_contratada = {n};"]
    for k, (canais, robos, pico, desde) in emps.items():
        s.append(f"insert into public.voz_config (empresa_id, provedor, modo, pico_multiplo) values ({E[k]}, "
                 f"'simulador', 'simulado', {pico}) on conflict (empresa_id) do update set pico_multiplo = {pico};")
        if canais:
            s.append(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, "
                     f"ddd_origem, bina, canais) values ({E[k]}, 'e101-{k}-{T}', 'Operadora Exemplo', "
                     f"'203.0.113.41', 'ip', '11', '1130040000', {canais});")
        if robos is not None:
            s.append(f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, vigente_desde, motivo) "
                     f"values ({E[k]}, {robos}, 'por_robo', 6000, {desde or 'public.hoje_sp()'}, 'Contrato de teste.');")
    s.append("set session_replication_role = origin;")
    if papel:
        s.append(f"set local role {papel};")
        if uid:
            s.append(f"set local request.jwt.claim.sub = '{uid}';")
    s.append(consulta or (
        f"select string_agg({LETRA} || '=' || d.limite || ':' || d.motivo || ':' || d.teto, ',' order by {LETRA}) "
        f"from public.voz_divisao_concorrencia d join public.empresas x on x.id = d.empresa_id;"))
    s.append("rollback;")
    return " ".join(s)


# ------------------------------------------------------------------ cabe no teto
checar("cabe: limite = licenças; tronco menor limita; sem licença fica com a sobra até os canais", True,
       cenario(20, {"a": (10, 5, 1, None), "b": (4, 8, 1, None), "c": (6, None, 1, None), "d": (3, None, 1, None)}),
       valor="a=5:licencas:5,b=4:tronco:4,c=6:legado:6,d=3:legado:3")
checar("cabe: sobra pequena dividida pelos canais (maior resto) entre quem não tem licença", True,
       cenario(12, {"a": (10, 8, 1, None), "c": (6, None, 1, None), "d": (3, None, 1, None)}),
       valor="a=8:licencas:8,c=3:legado:3,d=1:legado:1")

# ------------------------------------------------------------------ overbooking
checar("overbooking: proporcional à demanda usável, maior resto, sem licença com zero", True,
       cenario(10, {"a": (10, 8, 1, None), "b": (6, 6, 1, None), "c": (2, 4, 1, None), "d": (5, None, 2, None)}),
       valor="a=5:teto:5,b=4:teto:4,c=1:teto:1,d=0:legado:0")
checar("overbooking: a soma dos limites é o teto", True,
       cenario(10, {"a": (10, 8, 1, None), "b": (6, 6, 1, None), "c": (2, 4, 1, None), "d": (5, None, 2, None)},
               "select sum(limite) from public.voz_divisao_concorrencia;"), valor=10)
checar("overbooking: empate de fração vai para quem tem mais demanda", True,
       cenario(5, {"a": (10, 3, 1, None), "b": (10, 7, 1, None)}), valor="a=1:teto:1,b=4:teto:4")
checar("overbooking: cota exata para a equipe", True,
       cenario(10, {"a": (10, 8, 1, None), "b": (6, 6, 1, None), "c": (2, 4, 1, None)},
               f"select string_agg(d.cota::text, ',' order by d.cota) from public.voz_divisao_concorrencia d "
               f"where d.empresa_id in ({E['a']}, {E['b']}, {E['c']});", *M), valor="1.2500,3.7500,5.0000")

# ------------------------------------------------------------------ legado e casos de borda
checar("só legado: igual à regra antiga (30/10/5 canais, teto 10 → 7, 2, 1)", True,
       cenario(10, {"a": (30, None, 1, None), "b": (10, None, 1, None), "c": (5, None, 1, None)}),
       valor="a=7:legado:7,b=2:legado:2,c=1:legado:1")
checar("legado com pico 3: teto = min(limite × pico, canais); licença: pico 1", True,
       cenario(10, {"a": (10, 4, 3, None), "b": (8, None, 3, None)},
               f"select string_agg({LETRA} || '=' || d.limite || '/' || d.pico_multiplo || '/' || d.teto, ',' "
               f"order by {LETRA}) from public.voz_divisao_concorrencia d join public.empresas x on x.id = d.empresa_id;"),
       valor="a=4/1/4,b=6/3/8")
checar("licença só agendada (futuro) e licença com 0 robôs = legado", True,
       cenario(10, {"a": (5, 3, 1, "'2099-01-01'"), "b": (5, 0, 1, None)},
               f"select string_agg({LETRA} || '=' || d.limite || ':' || d.motivo || ':' || coalesce(d.licencas::text, "
               f"'-'), ',' order by {LETRA}) from public.voz_divisao_concorrencia d "
               f"join public.empresas x on x.id = d.empresa_id;"),
       valor="a=5:legado:-,b=5:legado:0")
checar("licença sem tronco ativo: aparece com 0 canais, limite 0 e motivo tronco", True,
       cenario(10, {"a": (None, 6, 1, None), "b": (4, None, 1, None)},
               f"select string_agg({LETRA} || '=' || d.canais || '/' || d.limite || ':' || d.motivo, ',' "
               f"order by {LETRA}) from public.voz_divisao_concorrencia d join public.empresas x on x.id = d.empresa_id;"),
       valor="a=0/0:tronco,b=4/4:legado")
checar("teto 0: ninguém disca", True,
       cenario(0, {"a": (10, 5, 1, None), "b": (5, None, 1, None)}), valor="a=0:teto:0,b=0:legado:0")

# ------------------------------------------------------------------ quem vê o quê
VARIAS = {"a": (10, 8, 1, None), "b": (6, 6, 1, None), "c": (5, None, 1, None)}
checar("cliente: só a própria linha, com licenças e motivo, sem o teto global", True,
       cenario(10, VARIAS, "select string_agg(limite || ':' || motivo || ':' || licencas || ':' || "
                           "coalesce(contratado::text, '-') || ':' || coalesce(cota::text, '-'), ',') "
                           "from public.voz_divisao_concorrencia;", *CL), valor="6:teto:8:-:-")
checar("cliente: pela função também não vê as outras nem o teto", True,
       cenario(10, VARIAS, "select count(*) || ':' || count(contratado) from public.divisao_concorrencia_voz();", *CL),
       valor="1:0")
checar("equipe: vê o teto global", True,
       cenario(10, VARIAS, f"select contratado from public.voz_divisao_concorrencia where empresa_id = {E['a']};", *M),
       valor=10)
checar("servidor: vê todas com o teto", True,
       cenario(10, VARIAS, "select count(*) || ':' || min(contratado) from public.voz_divisao_concorrencia;",
               "service_role"), valor="3:10")
checar("anon não lê a divisão", False, "select * from public.voz_divisao_concorrencia", "anon")
checar("anon não chama a função", False, "select * from public.divisao_concorrencia_voz()", "anon")
checar("a view da VM: só o papel motorcx_voz lê (nem authenticated nem service_role)", True,
       "select has_table_privilege('motorcx_voz', 'voz_vm.divisao_concorrencia', 'select')::text || "
       "has_table_privilege('authenticated', 'voz_vm.divisao_concorrencia', 'select')::text || "
       "has_table_privilege('service_role', 'voz_vm.divisao_concorrencia', 'select')::text || "
       "has_function_privilege('motorcx_voz', 'voz_vm.divisao()', 'execute')::text || "
       "has_function_privilege('authenticated', 'voz_vm.divisao()', 'execute')::text", valor="truefalsefalsetruefalse")
checar("a VM (login motorcx_voz) lê todas as linhas com licencas e motivo", True,
       cenario(10, VARIAS, f"set session authorization motorcx_voz; select string_agg({LETRA} || '=' || d.limite || ':' "
                           f"|| d.motivo || ':' || coalesce(d.licencas::text, '-'), ',' order by {LETRA}) "
                           f"from voz_vm.divisao_concorrencia d join (values {', '.join(f'({E[k]}, {chr(39)}x-{k}{chr(39)})' for k in 'abc')}) "
                           f"x (id, slug) on x.id = d.empresa_id;", None), valor="a=6:teto:8,b=4:teto:6,c=0:legado:-")

# ------------------------------------------------------------------ definir_concorrencia_contratada: aviso, sem bloquear
AVISOS = ("select count(*) from public.avisos where para = 'equipe' and titulo = "
          "'Agente de voz: teto abaixo dos robôs vendidos' and criado_em > now() - interval '1 hour'")
A0 = int(sv(AVISOS))
sv("set session_replication_role = replica; "
   f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, vigente_desde, motivo) values "
   f"({E['e']}, 4000, 'por_robo', 6000, public.hoje_sp(), 'Contrato de teste.')")
VEND = int(sv("select public.robos_vendidos_voz(public.hoje_sp())"))
sv(f"update public.voz_contrato set concorrencia_contratada = {VEND + 100}")
checar("teto abaixo do vendido: grava (não bloqueia)", True,
       f"select public.definir_concorrencia_contratada({VEND - 5}); select concorrencia_contratada from "
       f"public.voz_contrato", "authenticated", U["tec"], valor=VEND - 5)
checar("e avisa a equipe (sino, link /console/voz)", True,
       AVISOS.replace("count(*)", "count(*) || ':' || max(link)"), valor=f"{A0 + 1}:/console/voz")
sv(f"select public.definir_concorrencia_contratada({VEND - 2})", "authenticated", U["tec"])
checar("subir o teto (ainda abaixo) não avisa de novo", True, f"select ({AVISOS}) = {A0 + 1}", valor="t")
sv(f"select public.definir_concorrencia_contratada({VEND + 10})", "authenticated", U["tec"])
checar("teto acima do vendido não avisa", True, f"select ({AVISOS}) = {A0 + 1}", valor="t")
checar("cliente continua sem definir o teto", False, "select public.definir_concorrencia_contratada(5)", *CL)

# ------------------------------------------------------------------ volta o que mudou fora das empresas de teste
sv(f"update public.voz_contrato set concorrencia_contratada = {TETO_ANTES}")
sv(f"set session_replication_role = replica; delete from public.voz_licencas where empresa_id = {E['e']}")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
