"""SQL 77 · Recuperação por ação: acordo, pagamento e valor recuperado por canal × persona × estágio.

Cobre: as tabelas recuperacao_dia e contato_posicao_dia (RLS: a empresa vê as suas, a equipe as do alcance, anônimo
nada, o site nunca grava; só agregados: nenhuma coluna de cliente; chave única com dia_ciclo nulo; pagamentos ≤
acordos; carteira padrão); as RPCs recuperacao_por_acao (agrupamento, filtros, rótulo "Sem ação do motor", taxas só
com ≥ 30, recuperado por real), contato_por_posicao e respostas_por_hora (outra empresa, anônimo, sem 'ver_painel',
período e agrupamento inválidos são recusados); a retenção limpar_recuperacao (só o servidor). Aplica o SQL 77 duas
vezes.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_recuperacao.py
Só dados fictícios (empresas e77-*, e-mails @exemplo.test, ids C77…).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL77 = RAIZ / "supabase" / "migrations" / "20270113000001_recuperacao_por_acao.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 77: " + nome
          + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL77)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e77-a-{T}', 'E77 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e77-b-{T}', 'E77 B {T}') returning id")
U = {}
for p in ("oper", "gest", "operb", "sempainel", "equipe"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['oper']}'")
sv(f"update public.perfis set papel='gestao', empresa_id={EA} where id='{U['gest']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EB} where id='{U['operb']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['sempainel']}'")
sv(f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{U['sempainel']}', 'ver_painel', false)")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['equipe']}'")


def credor(emp, codigo):
    return sv(f"insert into public.credores (empresa_id, codigo, nome) values ({emp}, '{codigo}', 'Carteira {codigo}') "
              f"on conflict (empresa_id, codigo) do update set nome = excluded.nome returning id")


CA1, CA2, CB = credor(EA, "principal"), credor(EA, f"c2{T}"), credor(EB, "principal")
OPER, GEST, OPERB = ("authenticated", U["oper"]), ("authenticated", U["gest"]), ("authenticated", U["operb"])
COLS = ("empresa_id,credor_id,data,canal,regua,cluster,persona,volta,dia_ciclo,acoes,com_retorno,contatos,cpcs,"
        "promessas,optouts,custo,acordos,valor_acordo,pagamentos,valor_pago")
sv("set role service_role; insert into public.recuperacao_dia (" + COLS + ") values "
   f"({EA},{CA1},'2026-10-01','whatsapp','localizacao','A1','Digital',0,1,100,80,40,20,0,2,10.00,4,4000,3,1500),"
   f"({EA},{CA1},'2026-10-01','discador','localizacao','A1','Voz',0,1,50,30,20,10,5,0,40.00,2,3000,1,1000),"
   f"({EA},{CA1},'2026-10-02','discador','giro','A1','Voz',2,3,20,10,5,4,1,0,8.00,1,500,0,0),"
   f"({EA},{CA2},'2026-10-01','sms','cpc','B2','Digital',0,null,10,3,2,1,0,1,1.00,0,0,0,0),"
   f"({EA},{CA1},'2026-10-03','','sem_acao','A1','',0,null,0,0,0,0,0,0,0,1,800,1,800),"
   f"({EB},{CB},'2026-10-01','sms','localizacao','B1','',0,1,7,0,0,0,0,0,0.70,0,0,0,0)")
sv("set role service_role; insert into public.contato_posicao_dia (empresa_id,credor_id,data,canal,posicao,"
   "dias_seguidos,tentativas,com_retorno,contatos,cpcs,terceiros,curtas) values "
   f"({EA},{CA1},'2026-10-01','discador',1,1,40,30,12,8,1,10),({EA},{CA1},'2026-10-02','discador',1,2,20,10,3,1,0,6),"
   f"({EA},{CA1},'2026-10-01','discador',2,1,10,5,1,0,1,4),({EB},{CB},'2026-10-01','discador',1,1,9,1,0,0,0,1)")

# ---- tabelas: só agregados e RLS
checar("tabelas com RLS ligada", True,
       "select count(*) from pg_tables where schemaname='public' and tablename in ('recuperacao_dia',"
       "'contato_posicao_dia') and rowsecurity", valor=2)
checar("nenhuma coluna de cliente (id_cliente, cpf, contato, telefone, email, nome)", True,
       "select count(*) from information_schema.columns where table_schema='public' and table_name in "
       "('recuperacao_dia','contato_posicao_dia') and column_name ~ '(id_cliente|cpf|contato$|telefone|email|nome)'",
       valor=0)
checar("empresa A vê só as dela (valor pago)", True, "select sum(valor_pago) from public.recuperacao_dia", *OPER,
       valor="3300.00")
checar("empresa B vê só as dela", True, "select sum(acoes) from public.recuperacao_dia", *OPERB, valor=7)
checar("equipe vê as do alcance (as duas)", True,
       f"select count(*) from public.recuperacao_dia where empresa_id in ({EA},{EB})", "authenticated", U["equipe"],
       6)
checar("posição: B vê só a dela", True, "select sum(tentativas) from public.contato_posicao_dia", *OPERB, valor=9)
checar("anônimo não lê a recuperação", False, "select count(*) from public.recuperacao_dia", "anon")
checar("anônimo não lê a posição", False, "select count(*) from public.contato_posicao_dia", "anon")
checar("site não grava recuperação", False,
       f"insert into public.recuperacao_dia (empresa_id,credor_id,data) values ({EA},{CA1},'2026-10-09')", *GEST)
checar("site não altera recuperação", False, "update public.recuperacao_dia set valor_pago = 0", *GEST)
checar("site não apaga posição", False, "delete from public.contato_posicao_dia", *GEST)
checar("chave única (mesmo dia/canal/fase/segmento/persona/volta/dia)", False,
       f"set role service_role; insert into public.recuperacao_dia (empresa_id,credor_id,data,canal,regua,cluster,"
       f"persona,volta,dia_ciclo) values ({EA},{CA1},'2026-10-01','whatsapp','localizacao','A1','Digital',0,1)")
checar("chave única também com dia_ciclo nulo", False,
       f"set role service_role; insert into public.recuperacao_dia (empresa_id,credor_id,data,canal,regua,cluster,"
       f"persona) values ({EA},{CA2},'2026-10-01','sms','cpc','B2','Digital')")
checar("pagamentos nunca passam dos acordos", False,
       f"set role service_role; insert into public.recuperacao_dia (empresa_id,credor_id,data,canal,acordos,"
       f"pagamentos) values ({EA},{CA1},'2026-10-05','sms',1,2)")
checar("rotina sem carteira cai na principal", True,
       f"set role service_role; insert into public.recuperacao_dia (empresa_id,data,canal,regua) values "
       f"({EA},'2026-09-01','email','cpc') returning (credor_id = {CA1})", valor="t")

# ---- RPC recuperacao_por_acao
R = "public.recuperacao_por_acao"
checar("por canal e persona (padrão): whatsapp Digital recupera 1500", True,
       f"select valor_pago from {R}({EA}, '2026-10-01', '2026-10-31') where canal='whatsapp' and persona='Digital'",
       *OPER, valor="1500.00")
checar("total do período = soma das linhas (sem agrupar)", True,
       f"select acoes || '|' || acordos || '|' || valor_pago from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => '{{}}')",
       *OPER, valor="180|8|3300.00")
checar("recuperado por real = valor pago ÷ custo", True,
       f"select recuperado_por_real from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['canal']) "
       f"where canal='discador'", *OPER, valor="20.83")
checar("taxa de CPC só com ≥ 30 ações (discador 70 → 20%)", True,
       f"select taxa_cpc from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['canal']) where canal='discador'",
       *OPER, valor="20.00")
checar("grupo pequeno: taxa nula (sms 10 ações)", True,
       f"select coalesce(taxa_cpc::text, 'nula') from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['canal']) "
       f"where canal='sms'", *OPER, valor="nula")
checar("acordo sem ação aparece como 'Sem ação do motor'", True,
       f"select fase || '|' || valor_pago from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['regua']) "
       f"where regua='sem_acao'", *OPER, valor="Sem ação do motor|800.00")
checar("por volta e dia do ciclo (giro volta 2, dia 3)", True,
       f"select acoes from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['regua','volta','dia_ciclo']) "
       f"where regua='giro' and volta=2 and dia_ciclo=3", *OPER, valor=20)
checar("optouts por segmento", True,
       f"select optouts from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['cluster']) where cluster='B2'",
       *OPER, valor=1)
checar("filtro por carteira", True,
       f"select sum(acoes) from {R}({EA}, '2026-10-01', '2026-10-31', credor => {CA2})", *OPER, valor=10)
checar("filtro por canal", True,
       f"select sum(acoes) from {R}({EA}, '2026-10-01', '2026-10-31', so_canal => 'discador')", *OPER, valor=70)
checar("por dia", True,
       f"select count(*) from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['data'])", *OPER, valor=3)
checar("equipe consulta a empresa do alcance", True,
       f"select sum(acoes) from {R}({EB}, '2026-10-01', '2026-10-31')", "authenticated", U["equipe"], 7)
checar("outra empresa é recusada", False, f"select * from {R}({EA}, '2026-10-01', '2026-10-31')", *OPERB,
       erro="sem permissão")
checar("sem 'ver_painel' é recusado", False, f"select * from {R}({EA}, '2026-10-01', '2026-10-31')",
       "authenticated", U["sempainel"], erro="sem permissão")
checar("anônimo não chama", False, f"select * from {R}({EA}, '2026-10-01', '2026-10-31')", "anon")
checar("agrupamento inválido é recusado", False,
       f"select * from {R}({EA}, '2026-10-01', '2026-10-31', agrupar => array['id_cliente'])", *OPER,
       erro="agrupar aceita")
checar("período invertido é recusado", False, f"select * from {R}({EA}, '2026-10-31', '2026-10-01')", *OPER,
       erro="período inválido")
checar("período longo demais é recusado", False, f"select * from {R}({EA}, '2020-01-01', '2026-10-01')", *OPER,
       erro="longo demais")
checar("sem argumentos de cliente na assinatura", True,
       "select count(*) from pg_proc where proname in ('recuperacao_por_acao','contato_por_posicao',"
       "'respostas_por_hora') and array_to_string(proargnames, ',') ~ '(id_cliente|cpf)'", valor=0)
checar("RPCs security definer com search_path", True,
       "select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proconfig is not null "
       "and proname in ('recuperacao_por_acao','contato_por_posicao','respostas_por_hora','limpar_recuperacao')",
       valor=4)

# ---- contato_por_posicao
P = "public.contato_por_posicao"
checar("posição 1, 1º dia: taxa de contato 30%", True,
       f"select taxa_contato from {P}({EA}, '2026-10-01', '2026-10-31') where posicao=1 and dias_seguidos=1",
       *OPER, valor="30.00")
checar("posição 2: grupo pequeno sem taxa", True,
       f"select coalesce(taxa_contato::text,'nula') || '|' || terceiros from {P}({EA}, '2026-10-01', '2026-10-31') "
       f"where posicao=2", *OPER, valor="nula|1")
checar("dias seguidos: 2º dia no mesmo número com 6 curtas", True,
       f"select curtas from {P}({EA}, '2026-10-01', '2026-10-31') where dias_seguidos=2", *OPER, valor=6)
checar("posição: outra empresa recusada", False, f"select * from {P}({EA}, '2026-10-01', '2026-10-31')", *OPERB)

# ---- respostas_por_hora (mensageria_mensagens somado no banco)
LT = sv(f"set role service_role; insert into public.mensageria_lotes (empresa_id,credor_id,data,canal,modo,situacao) "
        f"values ({EA},{CA1},'2026-10-01','sms','simulado','concluido') returning id")
H = "0" * 64
sv("set role service_role; insert into public.mensageria_mensagens (lote_id,empresa_id,id_cliente,destino_mascara,"
   "destino_hash,situacao,enviado_em,respondida_em) "
   f"select {LT},{EA},'C77'||g,'(11) 9****-0000','{H}', case when g<=30 then 'entregue' else 'falhou' end, "
   "timestamptz '2026-10-01 10:15:00-03', case when g<=6 then timestamptz '2026-10-01 10:30:00-03' end "
   "from generate_series(1,40) g")
sv("set role service_role; insert into public.mensageria_mensagens (lote_id,empresa_id,id_cliente,destino_mascara,"
   "destino_hash,situacao,enviado_em) "
   f"select {LT},{EA},'C77x'||g,'(11) 9****-0000','{H}','entregue',timestamptz '2026-10-01 18:05:00-03' "
   "from generate_series(1,5) g")
RH = "public.respostas_por_hora"
checar("respostas por hora: 10h (Brasília) com 40 enviadas, 6 respostas = 15%", True,
       f"select enviadas || '|' || entregues || '|' || respostas || '|' || taxa_resposta from {RH}({EA}, '2026-10-01', "
       f"'2026-10-01') where hora=10", *OPER, valor="40|30|6|15.00")
checar("respostas por hora: 18h com 5 enviadas, taxa nula", True,
       f"select coalesce(taxa_resposta::text,'nula') from {RH}({EA}, '2026-10-01', '2026-10-01') where hora=18",
       *OPER, valor="nula")
checar("respostas por hora: outra empresa recusada", False, f"select * from {RH}({EA}, '2026-10-01', '2026-10-01')",
       *OPERB)
checar("respostas por hora: B não vê a mensageria da A pela própria empresa", True,
       f"select count(*) from {RH}({EB}, '2026-10-01', '2026-10-01')", *OPERB, valor=0)

# ---- retenção
sv(f"set role service_role; insert into public.recuperacao_dia (empresa_id,credor_id,data,canal) values "
   f"({EA},{CA1},current_date - 900,'sms')")
checar("retenção: o site não chama", False, "select public.limpar_recuperacao()", *GEST)
checar("retenção: mínimo de 400 dias", False, "set role service_role; select public.limpar_recuperacao(30)",
       erro="mínima")
checar("retenção: o servidor apaga o que passou de 760 dias", True,
       "set role service_role; select public.limpar_recuperacao(); "
       f"select count(*) from public.recuperacao_dia where empresa_id={EA} and data < current_date - 760", valor=0)
checar("retenção: o recente fica", True,
       f"select count(*) from public.recuperacao_dia where empresa_id={EA} and data >= '2026-10-01'", valor=5)

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
