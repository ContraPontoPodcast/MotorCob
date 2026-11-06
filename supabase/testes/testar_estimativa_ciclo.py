"""SQL 72 · estimativa do ciclo: o que é contado uma vez no ciclo não é projetado por dia (QA da implantação, B12).

Cobre: Orquestração por CPF (SQL 69) no dia 6 do ciclo → estimativa = o medido (3.200 × R$ 0,35 = R$ 1.120,00), não
×30/6; consumo (SMS) continua projetado por dia; antes do 5º dia não há estimativa; estimativa_ciclo(empresa) segue com
a mesma assinatura e a mesma permissão (cliente vê a dele, não a de outra empresa; anônimo não chama) e a função com
data (estimativa_ciclo_em) é só do servidor. Aplica o SQL 72 duas vezes.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_estimativa_ciclo.py
Só dados fictícios (empresa est72-*). Datas fixas em 2025.
"""
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL72 = RAIZ / "supabase" / "migrations" / "20270108000001_estimativa_ciclo_distintos.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 72: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL72)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)

# ------------------------------------------------------------------ dados fictícios
sv("delete from auth.users where email like 'est72.%@exemplo.test'")
sv("delete from public.empresas where slug in ('est72-alfa', 'est72-beta')")
EA = sv("insert into public.empresas (slug, nome) values ('est72-alfa', 'Estimativa Alfa (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('est72-beta', 'Estimativa Beta (teste)') returning id")
C1 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cart-est72', 'Carteira Exemplo') returning id")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("adb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('est72.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
# Orquestração: R$ 0,35 por CPF (sem mínimo); SMS: R$ 0,06 por mensagem
sv(f"insert into public.precos_empresa (empresa_id, item, modelo, preco, vigente_desde) values "
   f"({EA}, 'contratos', 'flat', 0.35, '2025-01-01'), ({EA}, 'sms', 'flat', 0.06, '2025-01-01')", "service_role")
# ciclo de abril (mês fechado, 30 dias): 3.200 CPFs já medidos e 600 SMS nos 6 primeiros dias
sv(f"insert into public.clientes_mes (empresa_id, competencia, credor_id, cliente, primeiro_dia) "
   f"select {EA}, '2025-04-01', {C1}, left(md5('est72-' || g), 32), '2025-04-01' from generate_series(1, 3200) g",
   "service_role")
sv(f"insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade) values ({EA}, '2025-04-01', 'sms', 600)",
   "service_role")


def est(dia, papel="service_role", uid=None):
    return f"select coalesce(estimativa::text, 'nula') || ' | ' || ate_agora from public.estimativa_ciclo_em({EA}, '{dia}')"


checar("dia 6: Orquestração pelo medido (1.120,00) + SMS projetado (36 × 30/6 = 180,00)", True,
       est("2025-04-06"), "service_role", None, "1300.00 | 1156.00")
checar("antes do 5º dia não há estimativa (o medido aparece)", True, est("2025-04-04"), "service_role", None,
       "nula | 1156.00")
checar("dia 30: igual ao medido (nada a projetar)", True, est("2025-04-30"), "service_role", None, "1156.00 | 1156.00")
checar("a estimativa de CPF não multiplica por dias (nunca 5.600)", True,
       f"select (select estimativa from public.estimativa_ciclo_em({EA}, '2025-04-06')) < 2000", "service_role", None, "t")

# ------------------------------------------------------------------ permissão (a RPC do site)
checar("o admin da empresa chama estimativa_ciclo (pelo nome do argumento, como o site)", True,
       f"select count(*) from public.estimativa_ciclo(empresa => {EA})", "authenticated", U["adm"], 1)
checar("outra empresa não vê", False, f"select * from public.estimativa_ciclo({EA})", "authenticated", U["adb"],
       erro="sem acesso ao faturamento")
checar("anônimo não chama", False, f"select * from public.estimativa_ciclo({EA})", "anon")
checar("a função com data é só do servidor", False, f"select * from public.estimativa_ciclo_em({EA}, '2025-04-06')",
       "authenticated", U["adm"])

aplicar(2)
checar("depois de aplicar de novo, mesma conta", True, est("2025-04-06"), "service_role", None, "1300.00 | 1156.00")

sv("delete from auth.users where email like 'est72.%@exemplo.test'")
sv("delete from public.empresas where slug in ('est72-alfa', 'est72-beta')")
print(f"SQL 72: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
