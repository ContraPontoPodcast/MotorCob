"""SQL 78 · Créditos de IA: franquia, reserva/confirmação/estorno, contador, avisos, teto, fatura e margem.

Cobre: a migração roda duas vezes; item `ia_creditos` (IA, franquia 100, tabela R$ 1,90 ≥ mínimo da IA) e o guarda
da margem (preço abaixo do mínimo recusado; o mínimo segue o % de impostos configurado); pesos 2/2/2/1/0; reserva
idempotente pela chave do pedido; permissões (operação pergunta mas não "Descrever"; o standby é só do sistema; outra
empresa e anon não; o site não confirma, não estorna e não grava a tabela); estorno da reserva e do vencido (15 min)
e a confirmação tardia; avisos de 80% e 100% uma vez por ciclo; teto do Master (recusa sem reservar, peso 0 passa);
contador (view) e Uso de IA (só quantidade, projeção do protótipo = ~373); fatura "franquia incluída" + "excedentes ·
N × R$ 1,90"; margem_ia sem a franquia e margem_creditos_ia (só o Master); franquia própria e herança no preço novo;
ciclo com dia de corte; custo do sistema em ia_sem_credito sem faturar.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_creditos_ia.py
Só dados fictícios (empresas e78-*, e-mails @exemplo.test).
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
SQL78 = RAIZ / "supabase" / "migrations" / "20270114000001_creditos_ia.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 78: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 78: " + nome + ("" if cond else f"  -> {detalhe}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def js(cmd, papel=None, uid=None):
    return json.loads(sv(cmd, papel, uid))


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL78)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

SR = ("service_role", None)
T = uuid.uuid4().hex[:6]
# parâmetros da margem como no padrão (outros testes do testar_rls mexem neles); voltam no fim
PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
sv("update public.parametros_margem set impostos_pct = 0, mc_minima_ia_pct = 70 where id = 1")
EA = sv(f"insert into public.empresas (slug, nome) values ('e78-a-{T}', 'E78 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e78-b-{T}', 'E78 B {T}') returning id")
EC = sv(f"insert into public.empresas (slug, nome) values ('e78-c-{T}', 'E78 C {T}') returning id")
U = {}
for p in ("plan", "oper", "planb", "master"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}78-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='planejamento', empresa_id={EA} where id='{U['plan']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['oper']}'")
sv(f"update public.perfis set papel='planejamento', empresa_id={EB} where id='{U['planb']}'")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['master']}'")
P = ("authenticated", U["plan"])
O = ("authenticated", U["oper"])
B = ("authenticated", U["planb"])
M = ("authenticated", U["master"])
COMP_A = sv(f"select public.competencia_de({EA}, (now() at time zone 'America/Sao_Paulo')::date)")


def reservar(emp, funcao, ref, quem=SR):
    return js(f"select public.reservar_creditos_ia({emp}, '{funcao}', '{ref}')", *quem)


def usados(emp):
    return int(sv(f"select usados from public.ia_creditos_ciclo where empresa_id = {emp}"))


# ------------------------------------------------------------------ catálogo, preço e guarda da margem
checar("ia_creditos é item de IA com franquia 100", True,
       "select eh_ia::text || franquia_padrao || unidade from public.cobranca_itens where codigo = 'ia_creditos'",
       valor="true100crédito")
checar("tabela R$ 1,90 e mínimo da IA R$ 1,87 (custo p95 R$ 0,56, impostos 0%, MC 70%)", True,
       "select greatest(preco_tabela, 1.90) || '|' || public.preco_minimo_ia('ia_creditos') from public.cobranca_itens "
       "where codigo = 'ia_creditos'", valor="1.90000|1.87000")
checar("com impostos de 10% o R$ 1,90 fica abaixo do mínimo (R$ 2,80) e aparece para o Master revisar", True,
       "begin; update public.parametros_margem set impostos_pct = 10 where id = 1; "
       "select count(*) from public.ia_precos_abaixo_minimo() where item = 'ia_creditos' and origem = 'tabela'; rollback;",
       *M, valor=1)
checar("o mínimo segue o % de impostos configurado (14,25% → R$ 3,56; nada fixo no código)", True,
       "begin; update public.parametros_margem set impostos_pct = 14.25 where id = 1; "
       "select public.preco_minimo_ia('ia_creditos'); rollback;", valor="3.56000")
checar("preço de tabela abaixo do mínimo é recusado", False,
       "select public.salvar_preco_tabela_ia('ia_creditos', 1.50)", *M, erro="mínimo")
checar("preço da empresa abaixo do mínimo é recusado", False,
       f"select public.salvar_preco({EA}, 'ia_creditos', 'flat', 1.00)", *M, erro="mínimo")
checar("ia_sem_credito fica fora do catálogo (inativo)", True,
       "select ativo from public.cobranca_itens where codigo = 'ia_sem_credito'", valor="f")
checar("pesos: análise 2 · Descrever 2/2 · pergunta 1 · o resto 0", True,
       "select string_agg(funcao || '=' || creditos, ',' order by ordem) from public.ia_creditos_funcoes",
       valor="analise=2,pergunta=1,descrever_segmentos=2,descrever_estrategia=2,pre_analise=0,plantao=0,explicar=0,"
             "respostas_opcao=0,cache=0")
checar("tabelas novas com RLS", True,
       "select count(*) from pg_tables where schemaname='public' and tablename in "
       "('ia_creditos_funcoes','ia_creditos_uso','empresa_limites_ia') and not rowsecurity", *SR, valor=0)
checar("ia_creditos_uso não tem custo nem tokens", True,
       "select count(*) from information_schema.columns where table_schema='public' and table_name='ia_creditos_uso' "
       "and column_name ~ '(custo$|valor|tokens|preco)'", valor=0)

# ------------------------------------------------------------------ reserva e permissões
r = reservar(EA, "pergunta", f"esp:pergunta:{T}1", O)
afirmar("operação faz pergunta: 1 crédito reservado", r["ok"] and r["creditos"] == 1 and r["situacao"] == "reservado"
        and r["usados"] == 1 and r["franquia"] == 100, r)
r = reservar(EA, "pergunta", f"esp:pergunta:{T}1", O)
afirmar("a mesma chave não conta duas vezes (retry/duplo clique)", r["repetido"] and r["usados"] == 1, r)
checar("operação não usa \"Descrever\" (editar_orquestracao)", False,
       f"select public.reservar_creditos_ia({EA}, 'descrever_segmentos', 'seg:geracao:{T}x')", *O, erro="Descrever")
r = reservar(EA, "descrever_segmentos", f"seg:geracao:{T}1", P)
afirmar("planejamento usa Descrever: 2 créditos", r["ok"] and r["creditos"] == 2 and r["usados"] == 3, r)
checar("o standby é só do sistema", False,
       f"select public.reservar_creditos_ia({EA}, 'plantao', 'esp:plantao:{T}x')", *P, erro="só do sistema")
checar("outra empresa não reserva crédito desta", False,
       f"select public.reservar_creditos_ia({EA}, 'pergunta', 'esp:pergunta:{T}y')", *B, erro="sem permissão")
checar("anon não reserva", False, f"select public.reservar_creditos_ia({EA}, 'pergunta', 'esp:pergunta:{T}z')",
       "anon", None, erro="permission denied")
checar("chave de pedido fora do formato é recusada", False,
       f"select public.reservar_creditos_ia({EA}, 'pergunta', 'qualquer coisa')", *SR, erro="pedido_ref")
checar("função desconhecida é recusada", False,
       f"select public.reservar_creditos_ia({EA}, 'roleplay', 'esp:roleplay:{T}')", *SR, erro="desconhecida")
checar("a chave de outra empresa não é reaproveitada", False,
       f"select public.reservar_creditos_ia({EB}, 'pergunta', 'esp:pergunta:{T}1')", *SR, erro="outra empresa")
checar("o site não confirma", False, f"select public.confirmar_creditos_ia('esp:pergunta:{T}1')", *P,
       erro="permission denied")
checar("o site não estorna", False, f"select public.estornar_creditos_ia('esp:pergunta:{T}1')", *P,
       erro="permission denied")
checar("o site não grava a tabela", False,
       f"insert into public.ia_creditos_uso (empresa_id, competencia, ciclo_inicio, dia, funcao, creditos, origem, "
       f"pedido_ref) values ({EA}, '{COMP_A}', '{COMP_A}', current_date, 'pergunta', 0, 'usuario', 'esp:x:{T}')", *P)
checar("o site não muda a situação", False,
       f"update public.ia_creditos_uso set situacao = 'estornado' where empresa_id = {EA}", *P, erro="permission denied")
checar("o cliente não lê as linhas (só pelo contador e pelo Uso de IA)", True,
       f"select count(*) from public.ia_creditos_uso where empresa_id = {EA}", *P, valor=0)
checar("o Master lê as linhas", True, f"select count(*) from public.ia_creditos_uso where empresa_id = {EA}", *M, valor=2)
checar("o cliente não vê o teto nem grava", False,
       f"insert into public.empresa_limites_ia (empresa_id, teto_creditos_ciclo) values ({EA}, 999)", *P)

# ------------------------------------------------------------------ confirmar e estornar
c = js(f"select public.confirmar_creditos_ia('esp:pergunta:{T}1', 12000, 0.15)", *SR)
afirmar("confirma a pergunta", c["ok"] and not c["repetido"], c)
c = js(f"select public.confirmar_creditos_ia('esp:pergunta:{T}1', 12000, 0.15)", *SR)
afirmar("confirmar de novo é idempotente", c["repetido"], c)
checar("o crédito confirmado vai para a fatura (consumo_mensageria) uma vez", True,
       f"select quantidade from public.consumo_mensageria where empresa_id = {EA} and item = 'ia_creditos' "
       f"and competencia = '{COMP_A}'", valor=1)
checar("o custo real vai para consumo_ia uma vez (R$ 0,15), sem faturar de novo", True,
       f"select custo || '|' || registros from public.consumo_ia where empresa_id = {EA} and item = 'ia_creditos'",
       valor="0.15000|1")
e = js(f"select public.estornar_creditos_ia('seg:geracao:{T}1', 'a geração falhou')", *SR)
afirmar("estorna a geração que falhou", e["ok"] and e["situacao"] == "estornado", e)
afirmar("estornado não conta", usados(EA) == 1, usados(EA))
e = js(f"select public.estornar_creditos_ia('esp:pergunta:{T}1')", *SR)
afirmar("crédito confirmado não é estornado", not e["ok"] and e["situacao"] == "confirmado", e)
checar("pedido estornado (falha) não confirma depois", False,
       f"select public.confirmar_creditos_ia('seg:geracao:{T}1')", *SR, erro="estornado")
# reserva parada há mais de 15 minutos
sv(f"insert into public.ia_creditos_uso (empresa_id, competencia, ciclo_inicio, dia, funcao, creditos, origem, "
   f"pedido_ref, criado_em) values ({EA}, '{COMP_A}', '{COMP_A}', current_date, 'analise', 2, 'usuario', "
   f"'esp:analise:{T}velha', now() - interval '20 minutes')")
afirmar("reserva vencida (15 min) deixa de contar", usados(EA) == 1, usados(EA))
checar("o plantão estorna as reservas vencidas", True, "select public.estornar_creditos_ia_vencidos()", *SR, valor=1)
checar("o site não roda o job", False, "select public.estornar_creditos_ia_vencidos()", *P, erro="permission denied")
c = js(f"select public.confirmar_creditos_ia('esp:analise:{T}velha')", *SR)
afirmar("resultado que chega depois da reserva vencida confirma e volta a contar", c["ok"] and usados(EA) == 3,
        (c, usados(EA)))
u = js(f"select public.registrar_uso_ia({EA}, 'plantao', 'esp:plantao:{T}1', 30000, 0.40)", *SR)
afirmar("standby (sistema): 0 crédito, confirmado na hora", u["ok"] and u["creditos"] == 0
        and u["situacao"] == "confirmado", u)
js(f"select public.registrar_uso_ia({EA}, 'plantao', 'esp:plantao:{T}1', 30000, 0.40)", *SR)
checar("custo do sistema em ia_sem_credito, uma vez, sem fatura", True,
       f"select k.quantidade || '|' || k.custo || '|' || (select count(*) from public.consumo_mensageria m "
       f"where m.empresa_id = {EA} and m.item = 'ia_sem_credito') from public.consumo_ia k "
       f"where k.empresa_id = {EA} and k.item = 'ia_sem_credito'", valor="1.0000|0.40000|0")
afirmar("uso de peso 0 não muda o contador", usados(EA) == 3, usados(EA))

# ------------------------------------------------------------------ avisos 80% e 100%, uma vez por ciclo
for i in range(38):                                     # 3 + 76 = 79
    ref = f"esp:analise:{T}a{i}"
    reservar(EA, "analise", ref)
    sv(f"select public.confirmar_creditos_ia('{ref}')", *SR)
r = reservar(EA, "pergunta", f"esp:pergunta:{T}p80")
afirmar("chega a 80 de 100", r["usados"] == 80, r)
checar("aviso de 80% no sino (uma vez)", True,
       f"select count(*) from public.avisos where chave = 'creditos_ia:{EA}:{COMP_A}:80'", valor=1)
reservar(EA, "pergunta", f"esp:pergunta:{T}p81")
checar("passar de 80 não repete o aviso", True,
       f"select count(*) from public.avisos where chave like 'creditos_ia:{EA}:%'", valor=1)
checar("quem é da empresa vê o aviso (meus_avisos)", True,
       "select count(*) from public.meus_avisos() where titulo like 'Créditos de IA: 80 de 100%'", *O, valor=1)
checar("outra empresa não vê o aviso", True,
       "select count(*) from public.meus_avisos() where titulo like 'Créditos de IA%'", *B, valor=0)
for i in range(10):                                     # 81 + 20 = 101 → cruza 100
    reservar(EA, "analise", f"esp:analise:{T}b{i}")
checar("aviso de 100% com o preço do excedente e a renovação", True,
       f"select (texto like '%R$ 1,90%' and texto like '%renova em%' and titulo like 'A franquia de 100%')::text "
       f"from public.avisos where chave = 'creditos_ia:{EA}:{COMP_A}:100'", valor="true")
reservar(EA, "analise", f"esp:analise:{T}c0")
checar("acima de 100 nada bloqueia e o aviso não repete", True,
       f"select count(*) || '|' || {usados(EA)} from public.avisos where chave like 'creditos_ia:{EA}:%'", valor="2|103")
for i in range(10):
    sv(f"select public.confirmar_creditos_ia('esp:analise:{T}b{i}')", *SR)
sv(f"select public.confirmar_creditos_ia('esp:analise:{T}c0')", *SR)
sv(f"select public.confirmar_creditos_ia('esp:pergunta:{T}p80')", *SR)
sv(f"select public.estornar_creditos_ia('esp:pergunta:{T}p81')", *SR)
# confirmados: 1 + 2 + 76 + 1 + 20 + 2 = 102

# ------------------------------------------------------------------ contador e Uso de IA (só quantidade)
v = sv(f"select usados || '|' || franquia || '|' || excedente || '|' || preco_excedente || '|' || (renova_em = fim + 1) "
       f"from public.ia_creditos_ciclo where empresa_id = {EA}", *O)
afirmar("contador da empresa: 102 de 100 · excedente 2 · R$ 1,90", v == "102|100|2|1.90000|true", v)
checar("a view só mostra a própria empresa", True,
       f"select count(*) from public.ia_creditos_ciclo where empresa_id = {EA}", *B, valor=0)
checar("anon não lê a view", False, "select count(*) from public.ia_creditos_ciclo", "anon", None)
uso = js(f"select public.uso_ia_empresa({EA})", *O)
afirmar("Uso de IA: 7 linhas por função na ordem da tela", [g["grupo"] for g in uso["por_funcao"]][:2]
        == ["Especialista · análise (Consultar / Analisar de novo)", "Especialista · pergunta nova"]
        and len(uso["por_funcao"]) == 7, uso["por_funcao"])
an = next(g for g in uso["por_funcao"] if g["grupo"].startswith("Especialista · análise"))
afirmar("Uso de IA: análise 2 créditos por uso × 50 usos = 100", (an["creditos_por_uso"], an["usos"], an["creditos"])
        == (2, 50, 100), an)
afirmar("Uso de IA: valor do excedente na fatura (2 × R$ 1,90)", float(uso["valor_excedente"]) == 3.8, uso)
afirmar("Uso de IA não traz custo", "custo" not in json.dumps(uso), [k for k in uso])
checar("Uso de IA de outra empresa é recusado", False, f"select public.uso_ia_empresa({EA})", *B, erro="sem permissão")

# projeção com os números do protótipo (tela 12): 87 de 100, ~373 no ritmo dos últimos 7 dias, renova em 01/12
for d, n in zip(range(1, 8), (4, 9, 4, 30, 9, 21, 10)):
    sv(f"insert into public.ia_creditos_uso (empresa_id, competencia, ciclo_inicio, dia, funcao, creditos, origem, "
       f"pedido_ref, situacao, confirmado_em) values ({EC}, '2026-11-01', '2026-11-01', '2026-11-0{d}', 'pergunta', "
       f"{n}, 'usuario', 'esp:pergunta:{T}d{d}', 'confirmado', now())")
pj = js(f"select public.uso_ia_empresa_em({EC}, null, '2026-11-07')")
afirmar("projeção do protótipo: 87 → ~373 (média de 7 dias × dias restantes)", (pj["usados"], pj["projecao"],
        pj["renova_em"], len(pj["por_dia"])) == (87, 373, "2026-12-01", 7), pj)
pj = js(f"select public.uso_ia_empresa_em({EC}, '2026-11-01', '2026-12-03')")
afirmar("ciclo passado: sem projeção, todos os dias do ciclo", pj["projecao"] is None and len(pj["por_dia"]) == 30
        and not pj["atual"], pj)

# ------------------------------------------------------------------ fatura
lin = sv(f"select string_agg(item || '=' || quantidade || '×' || preco || '=' || valor || ' ' || descricao, ' ; ' "
         f"order by item desc) from public.previa_fatura({EA}, '{COMP_A}') where item like 'ia_creditos%'")
afirmar("fatura: franquia incluída sem valor + \"Créditos de IA excedentes · 2 × R$ 1,90\"",
        lin == "ia_creditos_franquia=100×0=0 Créditos de IA (franquia de 100, incluída no contrato) ; "
               "ia_creditos=2×1.90000=3.80 Créditos de IA excedentes · 2 × R$ 1,90", lin)
checar("empresa sem uso de IA não ganha linha de IA na fatura", True,
       f"select count(*) from public.previa_fatura({EB}, '{COMP_A}') where item like 'ia_creditos%'", valor=0)
checar("margem_ia: receita sem a franquia (R$ 3,80) contra o custo só das 2 unidades pagas", True,
       f"select m.receita || '|' || (abs(m.custo - round(k.custo * 2 / 102, 2)) <= 0.01) from public.margem_ia('{COMP_A}') m "
       f"join public.consumo_ia k on k.empresa_id = m.empresa_id and k.item = m.item and k.competencia = '{COMP_A}' "
       f"where m.empresa_id = {EA} and m.item = 'ia_creditos'", *M, valor="3.80|true")
checar("Master: custo da franquia (mensalidade) + excedente = custo total; MC do excedente", True,
       f"select (abs(custo_excedente + custo_franquia - custo_cliente - custo_sistema) <= 0.02 "
       f"and mc_excedente = round(receita - impostos - custo_excedente, 2) and mc_excedente_pct > mc_pct)::text "
       f"from public.margem_creditos_ia('{COMP_A}') where empresa_id = {EA}", *M, valor="true")
mg = sv(f"select usados || '|' || franquia || '|' || excedente || '|' || receita || '|' || (custo_cliente > 0) || '|' "
        f"|| custo_sistema || '|' || (mc_pct is not null) from public.margem_creditos_ia('{COMP_A}') "
        f"where empresa_id = {EA}", *M)
afirmar("Master: margem dos créditos com custo do cliente e do sistema", mg == "102|100|2|3.80|true|0.40|true", mg)
checar("margem dos créditos só para o Master", False, f"select count(*) from public.margem_creditos_ia('{COMP_A}')",
       *P, erro="Master")

# ------------------------------------------------------------------ teto do Master
checar("só o Master põe teto", False, f"select public.salvar_limites_creditos_ia({EA}, null, 105)", *P, erro="Master")
sv(f"select public.salvar_limites_creditos_ia({EA}, null, 104)", *M)
r = reservar(EA, "pergunta", f"esp:pergunta:{T}t1", O)
afirmar("abaixo do teto passa (103 → 104 com a reserva nova)", r["ok"] and r["usados"] == 103, r)
r = reservar(EA, "analise", f"esp:analise:{T}t2", O)
afirmar("acima do teto recusa com a frase e não reserva", not r["ok"] and r["motivo"] == "teto"
        and "fale com o suporte" in r["mensagem"], r)
checar("a recusa do teto não grava linha", True,
       f"select count(*) from public.ia_creditos_uso where pedido_ref = 'esp:analise:{T}t2'", valor=0)
r = reservar(EA, "pre_analise", f"esp:pre_analise:{T}t3", O)
afirmar("uso de peso 0 nunca é barrado pelo teto", r["ok"] and r["creditos"] == 0, r)
sv(f"select public.salvar_limites_creditos_ia({EA}, null, null)", *M)
r = reservar(EA, "analise", f"esp:analise:{T}t4", O)
afirmar("sem teto volta a nunca bloquear", r["ok"], r)

# ------------------------------------------------------------------ franquia própria, herança e ciclo com corte
sv(f"insert into public.ciclo_empresa (empresa_id, dia_corte) values ({EB}, 21) "
   f"on conflict (empresa_id) do update set dia_corte = 21")
fr = js(f"select public.salvar_limites_creditos_ia({EB}, 50, null)", *M)
afirmar("franquia própria (50) vale no ciclo de hoje", fr["franquia"] == 50, fr)
checar("franquia própria grava preço de tabela da empresa", True,
       f"select modelo || '|' || preco || '|' || franquia from public.precos_empresa where empresa_id = {EB} "
       f"and item = 'ia_creditos'", valor="flat|1.90000|50")
comp_b = sv(f"select public.competencia_de({EB}, (now() at time zone 'America/Sao_Paulo')::date)")
checar("ciclo com corte 21: competência e renovação do ciclo da empresa", True,
       f"select (competencia = '{comp_b}' and renova_em = (public.ciclo_de({EB}, '{comp_b}')).fim + 1)::text "
       f"from public.ia_creditos_ciclo where empresa_id = {EB}", *B, valor="true")
sv(f"select public.salvar_preco({EB}, 'ia_creditos', 'flat', 2.10, 0, null, ('{comp_b}'::date + interval '1 month')::date)",
   *M)
checar("preço novo da empresa herda a franquia (50)", True,
       f"select franquia from public.precos_empresa where empresa_id = {EB} and item = 'ia_creditos' "
       f"order by vigente_desde desc limit 1", valor=50)
for i in range(26):
    reservar(EB, "analise", f"esp:analise:{T}e{i}")
checar("aviso de 100% com a franquia própria (50)", True,
       f"select count(*) from public.avisos where chave = 'creditos_ia:{EB}:{comp_b}:100' "
       f"and titulo like 'A franquia de 50 %'", valor=1)
checar("franquia 0 é aceita (sem franquia: tudo é excedente)", True,
       f"select public.salvar_limites_creditos_ia({EC}, 0, null) is not null", *M, valor="t")

# ------------------------------------------------------------------ segurança das funções
checar("funções internas não são do site", False,
       f"select public.reservar_creditos_ia_em({EA}, 'pergunta', 'esp:pergunta:{T}i', 'usuario', null, current_date)",
       *P, erro="permission denied")
checar("registrar_uso_ia não é do site", False,
       f"select public.registrar_uso_ia({EA}, 'cache', 'esp:cache:{T}i')", *P, erro="permission denied")
checar("todas as RPCs novas são security definer", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and not prosecdef and proname in "
       "('reservar_creditos_ia','confirmar_creditos_ia','estornar_creditos_ia','estornar_creditos_ia_vencidos',"
       "'registrar_uso_ia','uso_ia_empresa','margem_creditos_ia','salvar_limites_creditos_ia','resumo_creditos_ia_em')",
       valor=0)

sql(f"delete from public.avisos where empresa_id in ({EA}, {EB}, {EC})")
sql("update public.parametros_margem set impostos_pct = {}, mc_minima_ia_pct = {} where id = 1".format(*PARAM.split(",")))
sql(f"delete from public.empresas where id in ({EA}, {EB}, {EC})")
print(f"\nSQL 78: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
