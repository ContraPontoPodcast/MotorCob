"""SQL 73 · o CPF nunca é o id do cliente (LGPD) e o rascunho de fatura cancelado pode ser gerado de novo.

Cobre: parece_cpf igual ao motor; id_cliente_pseudonimo do banco = motor/pseudonimo.py (mesmo sal, mesmo código);
só o servidor calcula o código e troca ids; o check barra CPF (com e sem pontuação) em id_cliente e em
contratos_mes ('cliente:<CPF>'); o que já estava gravado com CPF vira o código quando o SQL roda (inclusive a linha
antiga cujo código já existia: fica a nova); rechavear_clientes troca os pares da rotina (também id sem cara de CPF) só
no credor pedido. Faturamento: rascunho cancelado → gerar_rascunhos gera outro (o cancelado fica); gerar de novo não
duplica; fatura emitida e cancelada continua segurando a competência; duas faturas ativas na mesma competência não
passam. Aplica o SQL 73 duas vezes (e uma terceira com dados antigos).

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_id_cliente_sem_cpf.py
Só dados fictícios (empresa cpf73-*; CPFs gerados com dígito válido, de ninguém). Datas fixas em 2025.
"""
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
from motor.normalizacao import gerar_cpf  # noqa: E402
from motor.pseudonimo import parece_cpf, pseudonimo  # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL73 = RAIZ / "supabase" / "migrations" / "20270109000001_id_cliente_sem_cpf.sql"
TABELAS = ("estado_cliente", "fila_dia", "trilha", "jornada_cliente", "jornada_cliente_dia", "jornada_clientes_mes",
           "mensageria_conversas", "mensageria_links", "mensageria_mensagens", "titular_pedidos", "voz_alertas",
           "voz_chamadas", "voz_gravacoes", "voz_resubmits", "crm_chamadas")


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 73: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL73)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-600:])


aplicar(1)
aplicar(2)

# ------------------------------------------------------------------ dados fictícios
def limpar():
    sv("delete from auth.users where email like 'cpf73.%@exemplo.test'")
    emp = "(select id from public.empresas where slug in ('cpf73-alfa', 'cpf73-beta'))"
    for t in ("faturas", "estado_cliente", "fila_dia", "trilha", "contratos_mes", "clientes_mes", "precos_empresa"):
        sv(f"delete from public.{t} where empresa_id in {emp}")
    sv("delete from public.empresas where slug in ('cpf73-alfa', 'cpf73-beta')")


limpar()
EA = sv("insert into public.empresas (slug, nome) values ('cpf73-alfa', 'CPF73 Alfa (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('cpf73-beta', 'CPF73 Beta (teste)') returning id")
C1 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'c73a', 'Carteira A') returning id")
C2 = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'c73b', 'Carteira B') returning id")
CB = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'c73x', 'Carteira X') returning id")
U = {}
for p, papel, emp in (("adm", "admin", EA),):
    U[p] = sv(f"insert into auth.users (email) values ('cpf73.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
CPF1, CPF2, CPF3 = gerar_cpf(900000001), gerar_cpf(900000002), gerar_cpf(900000003)
FORMATADO = f"{CPF2[:3]}.{CPF2[3:6]}.{CPF2[6:9]}-{CPF2[9:]}"

# ------------------------------------------------------------------ parece_cpf e o código: banco = motor
for v in (CPF1, FORMATADO, "11111111111", CPF1[:10] + str((int(CPF1[10]) + 1) % 10), "QA000001", CPF1[1:], ""):
    checar(f"parece_cpf({v!r}) igual ao motor", True, f"select public.parece_cpf('{v}')", valor="t" if parece_cpf(v) else "f")
sv(f"select public.id_cliente_pseudonimo({EA}, 'x')")       # cria o sal da empresa, se faltar
SAL = sv(f"select sal from public.faturamento_sal where empresa_id = {EA}")
for v in (CPF1, FORMATADO, CPF1[1:], "12.345.678/0001-95", "QA 1"):
    checar(f"código do banco = código do motor ({v!r})", True, f"select public.id_cliente_pseudonimo({EA}, '{v}')",
           valor=pseudonimo(SAL, v))
checar("CPF formatado ou não dá o mesmo código", True,
       f"select public.id_cliente_pseudonimo({EA}, '{CPF2}') = public.id_cliente_pseudonimo({EA}, '{FORMATADO}')", valor="t")
checar("outra empresa (outro sal) dá outro código", True,
       f"select public.id_cliente_pseudonimo({EA}, '{CPF1}') <> public.id_cliente_pseudonimo({EB}, '{CPF1}')", valor="t")
checar("o site não calcula o código (seria ligar CPF a código)", False,
       f"select public.id_cliente_pseudonimo({EA}, '{CPF1}')", "authenticated", U["adm"])
checar("anônimo não calcula o código", False, f"select public.id_cliente_pseudonimo({EA}, '{CPF1}')", "anon")
checar("o site não troca ids", False,
       f"select public.rechavear_clientes({EA}, {C1}, '[]'::jsonb)", "authenticated", U["adm"])
checar("anônimo não troca ids", False, f"select public.rechavear_clientes({EA}, {C1}, '[]'::jsonb)", "anon")
checar("o sal continua fechado para o site", False, "select count(*) from public.faturamento_sal", "authenticated", U["adm"])

# ------------------------------------------------------------------ a trava
EST = ("tag, safra, cluster_origem, cluster_atual, estado, canal", "'S1-A1-LOC-ND-L0', '2025-01-01', 'A1', 'A1', 'LOC', 'ND'")


def estado(idc, credor=C1, empresa=EA):
    return (f"insert into public.estado_cliente (empresa_id, credor_id, id_cliente, {EST[0]}) "
            f"values ({empresa}, {credor}, '{idc}', {EST[1]})")


checar("estado_cliente não aceita CPF no id", False, estado(CPF1), "service_role", erro="sem_cpf")
checar("estado_cliente não aceita CPF formatado no id", False, estado(FORMATADO), "service_role", erro="sem_cpf")
checar("estado_cliente aceita código de cliente", True, estado("QA73-1") + "; select 1", "service_role", valor=1)
checar("estado_cliente aceita o código pseudônimo", True, estado(pseudonimo(SAL, CPF3)) + "; select 1", "service_role",
       valor=1)
checar("contratos_mes não aceita 'cliente:<CPF>'", False,
       f"insert into public.contratos_mes (empresa_id, competencia, credor_id, contrato) "
       f"values ({EA}, '2025-01-01', {C1}, 'cliente:{CPF1}')", "service_role", erro="sem_cpf")
for t in TABELAS:
    checar(f"{t} tem o check do CPF validado", True,
           f"select convalidated from pg_constraint where conname = '{t}_id_cliente_sem_cpf'", valor="t")

# ------------------------------------------------------------------ o que já estava gravado com CPF vira o código
for t in ("estado_cliente", "fila_dia", "trilha"):
    sv(f"alter table public.{t} drop constraint {t}_id_cliente_sem_cpf")
sv("alter table public.contratos_mes drop constraint contratos_mes_cliente_sem_cpf")
sv(estado(CPF1))
sv(estado(FORMATADO, C2))
sv(estado(CPF3))                                       # o código de CPF3 já existe (rodada nova): fica a nova
sv(estado(CPF1, CB, EB))
sv(f"insert into public.fila_dia (empresa_id, credor_id, data, canal, id_cliente, regua, passo, tag) values "
   f"({EA}, {C1}, '2025-01-02', 'sms', '{CPF1}', 'localizacao', 'D+1', 'S1-A1-LOC-ND-L0')")
sv(f"insert into public.trilha (empresa_id, credor_id, id_cliente, data, tag, motivo, quem_marcou) values "
   f"({EA}, {C1}, '{CPF1}', '2025-01-02', 'S1-A1-LOC-ND-L0', 'entrada', 'Planejamento')")
sv(f"insert into public.contratos_mes (empresa_id, competencia, credor_id, contrato) "
   f"values ({EA}, '2025-01-01', {C1}, 'cliente:{CPF1}')")
aplicar(3)
SAL_B = sv(f"select sal from public.faturamento_sal where empresa_id = {EB}")
checar("estado_cliente: o CPF virou o código", True,
       f"select string_agg(id_cliente, ',' order by id_cliente) from public.estado_cliente where empresa_id = {EA} "
       f"and credor_id = {C1} and id_cliente like 'MX%'",
       valor=",".join(sorted({pseudonimo(SAL, CPF1), pseudonimo(SAL, CPF3)})))
checar("estado_cliente: o CPF formatado virou o mesmo código do motor", True,
       f"select count(*) from public.estado_cliente where empresa_id = {EA} and credor_id = {C2} "
       f"and id_cliente = '{pseudonimo(SAL, CPF2)}'", valor=1)
checar("estado_cliente: a linha antiga cujo código já existia saiu (fica uma)", True,
       f"select count(*) from public.estado_cliente where empresa_id = {EA} and id_cliente = '{pseudonimo(SAL, CPF3)}'",
       valor=1)
checar("estado_cliente: outra empresa usa o sal dela", True,
       f"select id_cliente from public.estado_cliente where empresa_id = {EB}", valor=pseudonimo(SAL_B, CPF1))
checar("fila_dia e trilha também", True,
       f"select (select id_cliente from public.fila_dia where empresa_id = {EA}) || ',' || "
       f"(select id_cliente from public.trilha where empresa_id = {EA})",
       valor=f"{pseudonimo(SAL, CPF1)},{pseudonimo(SAL, CPF1)}")
checar("contratos_mes: 'cliente:<CPF>' virou 'cliente:<código>'", True,
       f"select contrato from public.contratos_mes where empresa_id = {EA}", valor="cliente:" + pseudonimo(SAL, CPF1))
checar("nenhum id com cara de CPF sobrou no banco", True,
       "select " + " + ".join(f"(select count(*) from public.{t} where public.parece_cpf(id_cliente))" for t in TABELAS),
       valor=0)

# ------------------------------------------------------------------ pares da rotina (inclusive id sem cara de CPF)
DEZ = "1234567890"       # id antigo sem cara de CPF (ex.: CPF que perdeu o zero à esquerda na planilha)
sv(estado(DEZ, C1) + f"; {estado(DEZ, C2)}")
NOVO = pseudonimo(SAL, DEZ)
checar("rechavear_clientes troca os pares só no credor pedido", True,
       f"select public.rechavear_clientes({EA}, {C1}, '[{{\"de\": \"{DEZ}\", \"para\": \"{NOVO}\"}}]'::jsonb); "
       f"select string_agg(credor_id || ':' || id_cliente, ',' order by credor_id) from public.estado_cliente "
       f"where empresa_id = {EA} and id_cliente in ('{DEZ}', '{NOVO}')", "service_role",
       valor=f"{C1}:{NOVO},{C2}:{DEZ}")
checar("rodar de novo não muda nada", True,
       f"select public.rechavear_clientes({EA}, {C1}, '[{{\"de\": \"{DEZ}\", \"para\": \"{NOVO}\"}}]'::jsonb)",
       "service_role", valor=0)
checar("par com CPF no id novo é recusado", False,
       f"select public.rechavear_clientes({EA}, {C1}, '[{{\"de\": \"QA73-1\", \"para\": \"{CPF1}\"}}]'::jsonb)",
       "service_role", erro="par inválido")

# ------------------------------------------------------------------ rascunho cancelado pode ser gerado de novo
sv(f"insert into public.precos_empresa (empresa_id, item, modelo, preco, vigente_desde) values "
   f"({EA}, 'contratos', 'flat', 0.35, '2024-01-01')", "service_role")
sv(f"insert into public.clientes_mes (empresa_id, competencia, credor_id, cliente) "
   f"select {EA}, '2025-03-01', {C1}, left(md5('cpf73-' || g), 32) from generate_series(1, 10) g", "service_role")


def faturas(comp="2025-03-01"):
    return (f"select string_agg(situacao, ',' order by id) from public.faturas "
            f"where empresa_id = {EA} and competencia = '{comp}'")


checar("gera o rascunho da competência", True, "select public.gerar_rascunhos('2025-03-01') >= 1; " + faturas(),
       "service_role", valor="rascunho")
FR = sv(f"select id from public.faturas where empresa_id = {EA} and competencia = '2025-03-01'")
checar("gerar de novo não duplica", True, "select public.gerar_rascunhos('2025-03-01'); " + faturas(), "service_role",
       valor="rascunho")
checar("a equipe cancela o rascunho", True, f"select public.cancelar_rascunho({FR}); " + faturas(), "service_role",
       valor="cancelada")
checar("rascunho cancelado: gerar_rascunhos gera outro (o cancelado fica)", True,
       "select public.gerar_rascunhos('2025-03-01') >= 1; " + faturas(), "service_role", valor="cancelada,rascunho")
checar("o novo rascunho tem os itens do ciclo", True,
       f"select i.quantidade from public.fatura_itens i join public.faturas f on f.id = i.fatura_id "
       f"where f.empresa_id = {EA} and f.competencia = '2025-03-01' and f.situacao = 'rascunho' and i.item = 'orquestracao'",
       valor="10")
checar("gerar de novo depois disso não duplica", True, "select public.gerar_rascunhos('2025-03-01'); " + faturas(),
       "service_role", valor="cancelada,rascunho")
checar("duas faturas ativas na mesma competência não passam", False,
       f"insert into public.faturas (empresa_id, competencia, valor_total, vencimento, modelo, situacao) "
       f"values ({EA}, '2025-03-01', 1, '2025-04-10', 'contrato', 'rascunho')", erro="faturas_empresa_competencia_ativa")
FR2 = sv(f"select id from public.faturas where empresa_id = {EA} and competencia = '2025-03-01' and situacao = 'rascunho'")
checar("fechar_fatura também aceita a competência com rascunho cancelado", True,
       f"select public.cancelar_rascunho({FR2}); select public.fechar_fatura({EA}, '2025-03-01') > 0; " + faturas(),
       "service_role", valor="cancelada,cancelada,rascunho")
# fatura emitida e depois cancelada (decisão manual) continua segurando a competência
sv(f"insert into public.faturas (empresa_id, competencia, valor_total, vencimento, modelo, situacao, emitida_em) "
   f"values ({EA}, '2025-02-01', 1, '2025-03-10', 'contrato', 'aberta', now())")
sv(f"update public.faturas set situacao = 'cancelada' where empresa_id = {EA} and competencia = '2025-02-01'")
checar("fatura emitida e cancelada não gera rascunho sozinha", True,
       "select public.gerar_rascunhos('2025-02-01'); " + faturas("2025-02-01"), "service_role", valor="cancelada")
checar("cliente continua sem gerar rascunhos", False, "select public.gerar_rascunhos('2025-03-01')", "authenticated",
       U["adm"])

# ------------------------------------------------------------------ limpeza
limpar()
print(f"SQL 73: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
