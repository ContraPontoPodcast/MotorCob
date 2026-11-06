"""SQL 69 · Orquestração cobrada por CPF (clientes distintos ativos no ciclo).

Cobre: a quantidade da Orquestração na prévia é o número de CPFs distintos do ciclo (o mesmo cliente em várias rodadas
e com vários contratos conta uma vez; o mesmo CPF em duas carteiras da empresa conta uma vez), o texto
"Orquestração · CPFs ativos no mês", dois ciclos (4.000 no primeiro; +200 −500 no segundo = 3.700), o ciclo medido só
antes do SQL 69 continua pelos contratos, fatura já fechada não muda, consumo_mes e o demonstrativo (CPFs por carteira),
a RLS (só a rotina grava; o cliente só lê com ver_faturamento; o sal nunca sai para o site) e a chave nunca aceita CPF.
Prova também que o SQL 69 roda de novo sem erro (aplica duas vezes). Datas fixas em 2025 (não depende do dia de hoje).

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_orquestracao_cpf.py
Só dados fictícios (empresa ocpf-*); chaves de cliente = md5 de textos fictícios (32 hexadecimais, como o HMAC).
"""
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL69 = RAIZ / "supabase" / "migrations" / "20270105000001_orquestracao_por_cpf.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 69: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL69)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)

# ------------------------------------------------------------------ dados fictícios
sv("delete from auth.users where email like 'ocpf.%@exemplo.test'")
_ANT = "(select id from public.empresas where slug in ('ocpf-alfa', 'ocpf-beta'))"
sv(f"delete from public.fatura_itens where fatura_id in (select id from public.faturas where empresa_id in {_ANT}); "
   f"delete from public.faturas where empresa_id in {_ANT}; "
   "delete from public.empresas where slug in ('ocpf-alfa', 'ocpf-beta')")
EA = sv("insert into public.empresas (slug, nome) values ('ocpf-alfa', 'CPF Alfa (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('ocpf-beta', 'CPF Beta (teste)') returning id")
C1 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cartao-ocpf', 'Cartão Exemplo') returning id")
C2 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'emprestimo-ocpf', 'Empréstimo Exemplo') returning id")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("ope", "operacao", EA), ("adb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('ocpf.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
# preço da Orquestração da A: flat R$ 0,35 por CPF, mínimo R$ 1.000 (desde jan/2025)
sv(f"insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde) "
   f"values ({EA}, 'contratos', 'flat', 0.35, 1000, '2025-01-01')", "service_role")


def k(txt):   # chave fictícia no formato do HMAC (32 hexadecimais)
    return f"left(md5('{txt}'), 32)"


def cpfs(comp, credor, ids_sql, dia=None):
    sv(f"insert into public.clientes_mes (empresa_id, competencia, credor_id, cliente, primeiro_dia) "
       f"select {EA}, '{comp}', {credor}, left(md5('pessoa-' || g), 32), '{dia or comp}' from ({ids_sql}) x(g) "
       f"on conflict do nothing", "service_role")


# ------------------------------------------------------------------ catálogo e sal
checar("a unidade da Orquestração é o CPF", True,
       "select nome || ' / ' || unidade from public.cobranca_itens where codigo = 'contratos'", "authenticated", U["adm"],
       "Orquestração / CPF")
checar("empresa que já existia ganhou o sal", True,
       "select count(*) from public.empresas e where not exists (select 1 from public.faturamento_sal s where s.empresa_id = e.id) "
       f"and e.id not in ({EA}, {EB})", "service_role", None, 0)
checar("a rotina cria o sal de empresa nova (o banco gera, 64 hexadecimais)", True,
       f"insert into public.faturamento_sal (empresa_id) values ({EA}) on conflict (empresa_id) do update set empresa_id = excluded.empresa_id; "
       f"select sal ~ '^[0-9a-f]{{64}}$' from public.faturamento_sal where empresa_id = {EA}", "service_role", None, "t")
checar("cada empresa tem o seu sal", True,
       f"insert into public.faturamento_sal (empresa_id) values ({EB}) on conflict do nothing; "
       f"select count(distinct sal) from public.faturamento_sal where empresa_id in ({EA}, {EB})", "service_role", None, 2)
checar("o site não lê o sal (nem o admin da empresa)", False, "select sal from public.faturamento_sal", "authenticated", U["adm"])
checar("o site não grava sal", False, f"insert into public.faturamento_sal (empresa_id, sal) values ({EB}, repeat('0', 64))",
       "authenticated", U["adm"])
checar("anônimo não lê o sal", False, "select sal from public.faturamento_sal", "anon")

# ------------------------------------------------------------------ chave nunca é CPF
checar("CPF (11 dígitos) não entra como cliente", False,
       f"insert into public.clientes_mes (empresa_id, competencia, cliente) values ({EA}, '2025-04-01', '52998224725')",
       "service_role")
checar("CPF com máscara não entra", False,
       f"insert into public.clientes_mes (empresa_id, competencia, cliente) values ({EA}, '2025-04-01', '529.982.247-25')",
       "service_role")
checar("id_cliente em claro não entra", False,
       f"insert into public.clientes_mes (empresa_id, competencia, cliente) values ({EA}, '2025-04-01', 'C0000001')",
       "service_role")

# ------------------------------------------------------------------ ciclo antigo (só contratos, antes do SQL 69)
sv(f"insert into public.contratos_mes (empresa_id, competencia, credor_id, contrato) "
   f"select {EA}, '2025-03-01', {C1}, 'CT-ANT-' || g from generate_series(1, 3200) g", "service_role")
checar("ciclo medido só antes do SQL 69 segue pelos contratos", True,
       f"select quantidade || ' | ' || descricao from public.previa_fatura({EA}, '2025-03-01') where item = 'orquestracao'",
       "service_role", None, "3200 | Orquestração · contratos no ciclo (medição anterior à cobrança por CPF)")

# ------------------------------------------------------------------ ciclo 1 (abril): 4.000 CPFs
# carteira 1: 4.000 pessoas, cada uma com 2 contratos, em 3 rodadas do ciclo (as rodadas repetem: on conflict)
for dia in ("2025-04-01", "2025-04-15", "2025-04-30"):
    cpfs("2025-04-01", C1, "select generate_series(1, 4000)", dia)
sv(f"insert into public.contratos_mes (empresa_id, competencia, credor_id, contrato) "
   f"select {EA}, '2025-04-01', {C1}, 'CT-' || g || s from generate_series(1, 4000) g, (values ('A'), ('B')) v(s)", "service_role")
# carteira 2: 150 pessoas que também estão na carteira 1 (mesmo CPF = mesma chave na empresa)
cpfs("2025-04-01", C2, "select generate_series(3851, 4000)")
checar("mesmo cliente em várias rodadas: uma linha por carteira", True,
       f"select count(*) from public.clientes_mes where empresa_id = {EA} and competencia = '2025-04-01'",
       "service_role", None, 4150)
checar("prévia: 4.000 CPFs (vários contratos e duas carteiras contam uma vez)", True,
       f"select quantidade from public.previa_fatura({EA}, '2025-04-10') where item = 'orquestracao'", "service_role", None, 4000)
checar("texto da linha: Orquestração · CPFs ativos no mês", True,
       f"select descricao from public.previa_fatura({EA}, '2025-04-01') where item = 'orquestracao'", "service_role", None,
       "Orquestração · CPFs ativos no mês")
checar("valor: 4.000 × R$ 0,35 = R$ 1.400 (acima do mínimo, sem complemento)", True,
       f"select string_agg(item || '=' || valor, ',' order by ordem) from public.previa_fatura({EA}, '2025-04-01') "
       "where item like 'orquestracao%'", "service_role", None, "orquestracao=1400.00")
checar("o admin da empresa vê a prévia por CPF", True,
       f"select quantidade from public.previa_fatura({EA}, '2025-04-01') where item = 'orquestracao'", "authenticated", U["adm"], 4000)
checar("consumo do ciclo: 4.000 CPFs (não os 8.000 contratos)", True,
       f"select quantidade from public.consumo_mes where empresa_id = {EA} and competencia = '2025-04-01' and item = 'contratos'",
       "authenticated", U["adm"], 4000)
checar("consumo do ciclo antigo continua pelos contratos", True,
       f"select quantidade from public.consumo_mes where empresa_id = {EA} and competencia = '2025-03-01' and item = 'contratos'",
       "authenticated", U["adm"], 3200)

# ------------------------------------------------------------------ ciclo 2 (maio): entram 200, saem 500 → 3.700
# os 500 que saíram (pagaram/devolvidos) em abril não estão na carga de maio; os 200 novos entram em maio
cpfs("2025-05-01", C1, "select generate_series(501, 4000)")
cpfs("2025-05-01", C2, "select generate_series(4001, 4200)")
checar("ciclo 2: 4.000 + 200 − 500 = 3.700 CPFs", True,
       f"select quantidade from public.previa_fatura({EA}, '2025-05-01') where item = 'orquestracao'", "service_role", None, 3700)
checar("ciclo 2: R$ 1.295 (3.700 × 0,35), acima do mínimo", True,
       f"select sum(valor) from public.previa_fatura({EA}, '2025-05-01') where item like 'orquestracao%'", "service_role", None, "1295.00")
cpfs("2025-06-01", C1, "select generate_series(1, 100)")
checar("abaixo do mínimo entra o complemento (100 CPFs = R$ 35 + R$ 965)", True,
       f"select string_agg(item || '=' || valor, ',' order by ordem) from public.previa_fatura({EA}, '2025-06-01') "
       "where item like 'orquestracao%'", "service_role", None, "orquestracao=35.00,orquestracao_minimo=965.00")
checar("ciclo sem medição nenhuma: só o mínimo", True,
       f"select string_agg(item || '=' || valor, ',' order by ordem) from public.previa_fatura({EA}, '2025-07-01') "
       "where item like 'orquestracao%'", "service_role", None, "orquestracao=0.00,orquestracao_minimo=1000.00")

# ------------------------------------------------------------------ fatura fechada não muda
# fatura fechada antes do SQL 69 (pelos contratos): congelada
FV = sv(f"insert into public.faturas (empresa_id, competencia, situacao, valor_total, itens_total, vencimento, modelo) "
        f"values ({EA}, '2025-02-01', 'paga', 1750, 1750, '2025-03-10', 'por_contrato') returning id", "service_role")
sv(f"insert into public.fatura_itens (fatura_id, ordem, item, descricao, quantidade, preco, valor) "
   f"values ({FV}, 1, 'orquestracao', 'Orquestração · contratos no ciclo', 5000, 0.35, 1750)", "service_role")
sv(f"insert into public.clientes_mes (empresa_id, competencia, cliente) values ({EA}, '2025-02-01', {k('tardio')})", "service_role")
FA = sv(f"select public.fechar_fatura({EA}, '2025-04-01')", "service_role")
checar("fechar congela a prévia por CPF", True,
       f"select quantidade || ' | ' || descricao || ' | ' || valor from public.fatura_itens where fatura_id = {FA} and item = 'orquestracao'",
       "service_role", None, "4000 | Orquestração · CPFs ativos no mês | 1400.00")
cpfs("2025-04-01", C2, "select generate_series(9001, 9100)")          # medição atrasada depois do fechamento
aplicar(2)
checar("fatura fechada não muda com medição nova nem com o SQL 69 de novo", True,
       f"select quantidade || ' | ' || valor from public.fatura_itens where fatura_id = {FA} and item = 'orquestracao'",
       "service_role", None, "4000 | 1400.00")
checar("fatura de antes do SQL 69 segue com os contratos", True,
       f"select quantidade || ' | ' || descricao || ' | ' || valor from public.fatura_itens where fatura_id = {FV}",
       "service_role", None, "5000 | Orquestração · contratos no ciclo | 1750.00")
checar("a prévia do ciclo fechado vê a medição nova (só a prévia)", True,
       f"select quantidade from public.previa_fatura({EA}, '2025-04-01') where item = 'orquestracao'", "service_role", None, 4100)

# ------------------------------------------------------------------ demonstrativo: CPFs por carteira
checar("demonstrativo: CPFs e contratos por carteira", True,
       f"select string_agg((c->>'carteira') || ':' || (c->>'cpfs') || '/' || (c->>'contratos'), ',' order by c->>'carteira') "
       f"from jsonb_array_elements(public.demonstrativo_fatura({FA})->'carteiras') c", "service_role", None,
       "Cartão Exemplo:4000/8000,Empréstimo Exemplo:250/0")

# ------------------------------------------------------------------ RLS
checar("o admin da empresa lê os CPFs do ciclo (só chaves)", True,
       f"select count(*) from public.clientes_mes where competencia = '2025-05-01'", "authenticated", U["adm"], 3700)
checar("operação (sem ver_faturamento) não vê", True, "select count(*) from public.clientes_mes", "authenticated", U["ope"], 0)
checar("outra empresa não vê", True, "select count(*) from public.clientes_mes", "authenticated", U["adb"], 0)
checar("outra empresa não vê a prévia", False, f"select * from public.previa_fatura({EA}, '2025-04-01')", "authenticated", U["adb"])
checar("anônimo não lê", False, "select count(*) from public.clientes_mes", "anon")
checar("cliente não grava CPF do ciclo", False,
       f"insert into public.clientes_mes (empresa_id, competencia, cliente) values ({EA}, '2025-08-01', {k('x')})",
       "authenticated", U["adm"])
checar("cliente não apaga CPF do ciclo", False, f"delete from public.clientes_mes where empresa_id = {EA}",
       "authenticated", U["adm"], erro="permission denied")
checar("cliente não altera CPF do ciclo", False, f"update public.clientes_mes set credor_id = 0 where empresa_id = {EA}",
       "authenticated", U["adm"], erro="permission denied")
checar("a medição interna não é chamável pelo site", False,
       f"select * from public.orquestracao_medicao({EA}, '2025-04-01')", "authenticated", U["adm"])

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
