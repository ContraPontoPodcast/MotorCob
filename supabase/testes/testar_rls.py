"""Testa as permissões (RLS) da migração do MotorCob num Postgres local.

Pré-requisito: um banco vazio com a imitação do Supabase e as migrações aplicadas:
    psql -d sb -f supabase/testes/stub_supabase.sql
    psql -d sb -f supabase/migrations/20260925000001_motorcob.sql
    (opcional, para testar a migração com dado antigo: psql -d sb -f supabase/testes/dados_legado.sql)
    psql -d sb -f supabase/migrations/20260928000001_multiempresa.sql
    psql -d sb -f supabase/migrations/20260928000002_clusters.sql
    psql -d sb -f supabase/migrations/20260929000001_estrategias.sql
    psql -d sb -f supabase/migrations/20260930000001_mapa_esteira.sql
    psql -d sb -f supabase/migrations/20261002000001_numeros_por_cliente.sql
    psql -d sb -f supabase/migrations/20261003000001_personas.sql
    psql -d sb -f supabase/migrations/20261004000001_acoes_dia.sql
    psql -d sb -f supabase/migrations/20261005000001_credores.sql
    psql -d sb -f supabase/migrations/20261006000001_enquadramento.sql
    psql -d sb -f supabase/migrations/20261007000001_personas_usuario.sql
    psql -d sb -f supabase/migrations/20261008000001_enriquecimento_esteira.sql
    psql -d sb -f supabase/migrations/20261009000001_segmentos_carteira.sql
    psql -d sb -f supabase/migrations/20261010000001_credores_atualizado.sql
    psql -d sb -f supabase/migrations/20261011000001_personas_modelo.sql
    PGHOST=... PGPORT=... PGUSER=postgres python supabase/testes/testar_rls.py
Conexão pelas variáveis padrão do psql (PGHOST, PGPORT, PGUSER); banco: PGDATABASE ou 'sb'.
"""
import os
import subprocess
import sys

BASE = ["psql", "-d", os.environ.get("PGDATABASE", "sb"), "-v", "ON_ERROR_STOP=1", "-Atq"]

def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()

ok_total = falhas = 0
def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor))
    ok_total += passou; falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:120]}"))

# empresas A e B; usuários (trigger cria perfil operacao) e papéis definidos pelo "admin do banco"
sql("insert into public.empresas (slug,nome) values ('alfa','Alfa'),('beta','Beta')")
_, EA, _ = sql("select id from public.empresas where slug='alfa'")
_, EB, _ = sql("select id from public.empresas where slug='beta'")
ids = {}
for p in ("admin", "plan", "oper", "gest", "inativo", "operb", "admina", "semempresa"):
    _, out, _ = sql(f"insert into auth.users (email) values ('{p}@x.com') returning id")
    ids[p] = out
u = ids
sql(f"update public.perfis set papel='admin', equipe=true where id='{u['admin']}'")
sql(f"update public.perfis set papel='planejamento', empresa_id={EA} where id='{u['plan']}'")
sql(f"update public.perfis set empresa_id={EA} where id='{u['oper']}'")
sql(f"update public.perfis set papel='gestao', empresa_id={EA} where id='{u['gest']}'")
sql(f"update public.perfis set ativo=false, empresa_id={EA} where id='{u['inativo']}'")
sql(f"update public.perfis set empresa_id={EB} where id='{u['operb']}'")
sql(f"update public.perfis set papel='admin', empresa_id={EA} where id='{u['admina']}'")
# dados que a rotina (service_role) grava, nas duas empresas
r = sql("set role service_role; insert into public.estado_cliente (empresa_id,id_cliente,tag,safra,cluster_origem,cluster_atual,estado,canal) values "
    f"({EA},'C1','S260801-A1-CPA-WA-T1','2026-08-01','A1','A1','CPA','WA'),({EA},'C2','S260801-M1-LOC-ND-L1','2026-08-01','M1','M1','LOC','ND'),"
    f"({EB},'C1','S260801-B3-NCP-ND-L8','2026-08-01','B3','B3','NCP','ND');"
    "insert into public.fila_dia (empresa_id,data,canal,id_cliente,reserva,regua,passo,tag) values "
    f"({EA},'2026-09-25','whatsapp','C1',false,'cpc','T1','x'),({EA},'2026-09-25','discador','C2',true,'localizacao','D+5','y'),"
    f"({EB},'2026-09-25','sms','C1',false,'giro','G1','z');"
    f"insert into public.trilha (empresa_id,id_cliente,data,tag,motivo,quem_marcou) values ({EA},'C1','2026-08-04','S260801-A1-CPA-WA-T1','contato','WhatsApp');"
    f"insert into public.execucoes (empresa_id,data_ref,status) values ({EA},'2026-09-25','ok'),({EB},'2026-09-25','ok');"
    "insert into storage.objects (bucket_id,name) values ('saidas','alfa/2026-09-25/ids/whatsapp.csv'),('saidas','alfa/2026-09-25/fila_do_dia.csv'),"
    "('saidas','alfa/comite/2026-09/comite.xlsx'),('saidas','beta/2026-09-25/ids/sms.csv')")
assert r[0], r[2]

checar("trigger criou perfil para cada convidado", True, "select count(*) from public.perfis", valor=8)
checar("anon não lê estado_cliente", False, "select * from public.estado_cliente", "anon")
checar("anon não lê fila", False, "select * from public.fila_dia", "anon")
checar("anon não lê empresas", False, "select * from public.empresas", "anon")
checar("operação A lê só a fila da A (2 linhas)", True, "select count(*) from public.fila_dia", "authenticated", u["oper"], 2)
checar("operação B lê só a fila da B (1 linha)", True, "select count(*) from public.fila_dia", "authenticated", u["operb"], 1)
checar("operação B não vê o C1 da A", True, "select string_agg(estado, ',') from public.estado_cliente", "authenticated", u["operb"], "NCP")
checar("equipe vê as duas empresas", True, "select count(*) from public.estado_cliente", "authenticated", u["admin"], 3)
checar("usuário sem empresa não vê nada", True, "select count(*) from public.fila_dia", "authenticated", u["semempresa"], 0)
checar("operação A vê só a empresa A", True, "select string_agg(slug, ',') from public.empresas", "authenticated", u["oper"], "alfa")
checar("equipe vê todas as empresas", True, "select count(*) from public.empresas", "authenticated", u["admin"], 2)
checar("operação lê trilha", True, "select count(*) from public.trilha", "authenticated", u["oper"], 1)
checar("operação B não lê trilha da A", True, "select count(*) from public.trilha", "authenticated", u["operb"], 0)
checar("resumo_estados agrega por empresa", True, "select string_agg(estado||'='||clientes, ',' order by estado) from public.resumo_estados", "authenticated", u["oper"], "CPA=1,LOC=1")
checar("resumo_fila separa reserva", True, "select count(*) from public.resumo_fila", "authenticated", u["gest"], 2)
checar("ultima_execucao: uma por empresa (equipe)", True, "select count(*) from public.ultima_execucao", "authenticated", u["admin"], 2)
checar("ultima_execucao: só a da própria empresa", True, "select count(*) from public.ultima_execucao", "authenticated", u["operb"], 1)
checar("inativo não vê nada", True, "select count(*) from public.fila_dia", "authenticated", u["inativo"], 0)
checar("operação vê só o próprio perfil", True, "select count(*) from public.perfis", "authenticated", u["oper"], 1)
checar("admin da equipe vê todos os perfis", True, "select count(*) from public.perfis", "authenticated", u["admin"], 8)
checar("admin da empresa A vê só perfis da A (5)", True, "select count(*) from public.perfis", "authenticated", u["admina"], 5)
checar("operação não se promove a admin (0 linhas)", True, f"with x as (update public.perfis set papel='admin' where id='{u['oper']}' returning 1) select count(*) from x", "authenticated", u["oper"], 0)
checar("papel da operação continua operacao", True, f"select papel from public.perfis where id='{u['oper']}'", valor="operacao")
checar("operação não altera perfil de outro (0 linhas)", True, f"with x as (update public.perfis set nome='z' where id='{u['plan']}' returning 1) select count(*) from x", "authenticated", u["oper"], 0)
checar("admin da equipe promove operação", True, f"update public.perfis set papel='planejamento' where id='{u['oper']}'; update public.perfis set papel='operacao' where id='{u['oper']}'", "authenticated", u["admin"])
checar("admin da empresa A promove operação da A", True, f"update public.perfis set papel='gestao' where id='{u['oper']}'; update public.perfis set papel='operacao' where id='{u['oper']}'", "authenticated", u["admina"])
checar("admin da empresa A não mexe na B (0 linhas)", True, f"with x as (update public.perfis set papel='admin' where id='{u['operb']}' returning 1) select count(*) from x", "authenticated", u["admina"], 0)
checar("admin da empresa A não troca empresa de ninguém", False, f"update public.perfis set empresa_id={EB} where id='{u['oper']}'", "authenticated", u["admina"])
checar("admin da empresa A não vira equipe", False, f"update public.perfis set equipe=true where id='{u['admina']}'", "authenticated", u["admina"])
checar("admin da empresa A não cria empresa", False, "insert into public.empresas (slug,nome) values ('gama','Gama')", "authenticated", u["admina"])
checar("admin da equipe cria empresa", True, "insert into public.empresas (slug,nome) values ('gama','Gama')", "authenticated", u["admin"])
checar("slug inválido é recusado", False, "insert into public.empresas (slug,nome) values ('Com Espaço','x')", "authenticated", u["admin"])
checar("admin da equipe coloca usuário numa empresa", True, f"update public.perfis set empresa_id={EB} where id='{u['semempresa']}'", "authenticated", u["admin"])
checar("operação não escreve em estado_cliente", False, f"insert into public.estado_cliente (empresa_id,id_cliente,tag,safra,cluster_origem,cluster_atual,estado,canal) values ({EA},'C9','t','2026-01-01','A1','A1','LOC','ND')", "authenticated", u["oper"])
checar("operação não cria envio", False, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'base','alfa/base/2026-09-25/a.csv','a.csv')", "authenticated", u["oper"])
checar("planejamento cria envio de base na A", True, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'base','alfa/base/2026-09-25/a.csv','a.csv')", "authenticated", u["plan"])
checar("planejamento cria envio de ocorrência na A", True, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'ocorrencia','alfa/ocorrencia/2026-09-25/o.csv','o.csv')", "authenticated", u["plan"])
checar("planejamento A não cria envio na B", False, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EB},'base','beta/base/2026-09-25/a.csv','a.csv')", "authenticated", u["plan"])
checar("planejamento A não aponta para a pasta da B", False, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'base','beta/base/2026-09-25/z.csv','z.csv')", "authenticated", u["plan"])
checar("tipo do envio tem que bater com a pasta", False, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'base','alfa/ocorrencia/2026-09-25/y.csv','y.csv')", "authenticated", u["plan"])
checar("planejamento não cria envio já 'processado'", False, f"insert into public.envios (empresa_id,tipo,caminho,nome_original,status) values ({EA},'base','alfa/base/2026-09-25/b.csv','b.csv','processado')", "authenticated", u["plan"])
checar("planejamento não cria envio em nome de outro", False, f"insert into public.envios (empresa_id,tipo,caminho,nome_original,enviado_por) values ({EA},'base','alfa/base/2026-09-25/c.csv','c.csv','{u['admin']}')", "authenticated", u["plan"])
checar("operação B não vê envios da A", True, "select count(*) from public.envios", "authenticated", u["operb"], 0)
checar("planejamento sobe arquivo em entradas/alfa/base", True, "insert into storage.objects (bucket_id,name) values ('entradas','alfa/base/2026-09-25/a.csv')", "authenticated", u["plan"])
checar("planejamento A não sobe em entradas/beta", False, "insert into storage.objects (bucket_id,name) values ('entradas','beta/base/2026-09-25/a.csv')", "authenticated", u["plan"])
checar("planejamento não sobe em pasta desconhecida", False, "insert into storage.objects (bucket_id,name) values ('entradas','alfa/outra/a.csv')", "authenticated", u["plan"])
checar("operação não sobe arquivo", False, "insert into storage.objects (bucket_id,name) values ('entradas','alfa/base/2026-09-25/x.csv')", "authenticated", u["oper"])
checar("operação A vê só ids da A no bucket saidas", True, "select string_agg(name, ',') from storage.objects where bucket_id='saidas'", "authenticated", u["oper"], "alfa/2026-09-25/ids/whatsapp.csv")
checar("operação B vê só ids da B", True, "select string_agg(name, ',') from storage.objects where bucket_id='saidas'", "authenticated", u["operb"], "beta/2026-09-25/ids/sms.csv")
checar("gestão vê ids + comitê, não fila_do_dia", True, "select string_agg(name, ',' order by name) from storage.objects where bucket_id='saidas'", "authenticated", u["gest"], "alfa/2026-09-25/ids/whatsapp.csv,alfa/comite/2026-09/comite.xlsx")
checar("planejamento A vê todas as saídas da A", True, "select count(*) from storage.objects where bucket_id='saidas'", "authenticated", u["plan"], 3)
checar("equipe vê todas as saídas", True, "select count(*) from storage.objects where bucket_id='saidas'", "authenticated", u["admin"], 4)
checar("operação não lê entradas", True, "select count(*) from storage.objects where bucket_id='entradas'", "authenticated", u["oper"], 0)
checar("usuário registra o próprio acesso", True, f"insert into public.acessos (empresa_id,acao,alvo) values ({EA},'download','alfa/2026-09-25/ids/whatsapp.csv')", "authenticated", u["oper"])
checar("usuário não registra acesso em outra empresa", False, f"insert into public.acessos (empresa_id,acao,alvo) values ({EB},'download','x')", "authenticated", u["oper"])
checar("usuário não registra acesso em nome de outro", False, f"insert into public.acessos (empresa_id,usuario,acao,alvo) values ({EA},'{u['plan']}','download','x')", "authenticated", u["oper"])
checar("operação não lê auditoria", True, "select count(*) from public.acessos", "authenticated", u["oper"], 0)
checar("gestão A lê auditoria da A", True, "select count(*) from public.acessos", "authenticated", u["gest"], 1)
# clusters da empresa
checar("planejamento A cria cluster na A", True, f"insert into public.clusters (empresa_id,ordem,codigo,nome,condicoes,canais_bloqueados) values ({EA},10,'VE','Veículo','[{{\"campo\":\"PRODUTO\",\"op\":\"=\",\"valor\":\"VEICULO\"}}]','{{whatsapp}}')", "authenticated", u["plan"])
checar("cluster grava quem alterou", True, "select atualizado_por is not null from public.clusters where codigo='VE'", valor="t")
checar("planejamento A não cria cluster na B", False, f"insert into public.clusters (empresa_id,codigo) values ({EB},'XX')", "authenticated", u["plan"])
checar("operação não cria cluster", False, f"insert into public.clusters (empresa_id,codigo) values ({EA},'OP')", "authenticated", u["oper"])
checar("código com hífen é recusado (quebraria a TAG)", False, f"insert into public.clusters (empresa_id,codigo) values ({EA},'A-1')", "authenticated", u["plan"])
checar("canal desconhecido é recusado", False, f"insert into public.clusters (empresa_id,codigo,canais_bloqueados) values ({EA},'FX','{{fax}}')", "authenticated", u["plan"])
checar("código repetido na mesma empresa é recusado", False, f"insert into public.clusters (empresa_id,codigo) values ({EA},'VE')", "authenticated", u["plan"])
checar("mesmo código em outra empresa pode", True, f"insert into public.clusters (empresa_id,codigo) values ({EB},'VE')", "authenticated", u["admin"])
checar("operação A vê só os clusters da A", True, "select count(*) from public.clusters", "authenticated", u["oper"], 1)
checar("operação B vê só os clusters da B", True, "select count(*) from public.clusters", "authenticated", u["operb"], 1)
checar("operação não altera cluster (0 linhas)", True, "with x as (update public.clusters set pacote='x' returning 1) select count(*) from x", "authenticated", u["oper"], 0)
checar("planejamento A não altera cluster da B (0 linhas)", True, f"with x as (update public.clusters set pacote='x' where empresa_id={EB} returning 1) select count(*) from x", "authenticated", u["plan"], 0)
checar("planejamento A altera e apaga cluster da A", True, f"update public.clusters set so_digital=true where empresa_id={EA}; delete from public.clusters where empresa_id={EA} and codigo='VE'; insert into public.clusters (empresa_id,codigo) values ({EA},'VE')", "authenticated", u["plan"])
checar("operação lê colunas_base da própria empresa", True, "select count(*) from public.empresas where colunas_base is null", "authenticated", u["oper"], 1)
checar("operação não grava colunas_base (0 linhas)", True, "with x as (update public.empresas set colunas_base='[]' returning 1) select count(*) from x", "authenticated", u["oper"], 0)
# estratégias e canais da empresa
checar("planejamento A cria estratégia na A", True, f"insert into public.estrategias (empresa_id,nome,definicao,padrao) values ({EA},'Digital','{{\"localizacao\":{{}}}}',true)", "authenticated", u["plan"])
checar("só uma estratégia padrão por empresa", False, f"insert into public.estrategias (empresa_id,nome,padrao) values ({EA},'Outra',true)", "authenticated", u["plan"])
checar("definição precisa ser objeto", False, f"insert into public.estrategias (empresa_id,nome,definicao) values ({EA},'Lista','[]')", "authenticated", u["plan"])
checar("planejamento A não cria estratégia na B", False, f"insert into public.estrategias (empresa_id,nome) values ({EB},'X')", "authenticated", u["plan"])
checar("operação não cria estratégia", False, f"insert into public.estrategias (empresa_id,nome) values ({EA},'Y')", "authenticated", u["oper"])
sql(f"insert into public.estrategias (empresa_id,nome) values ({EB},'Da B')")
checar("cluster da A usa estratégia da A", True, f"update public.clusters set estrategia_id=(select id from public.estrategias where nome='Digital') where empresa_id={EA} and codigo='VE'", "authenticated", u["plan"])
checar("cluster da A não usa estratégia da B", False, f"update public.clusters set estrategia_id=(select id from public.estrategias where nome='Da B') where empresa_id={EA} and codigo='VE'", "service_role")
checar("operação B não vê estratégias da A", True, "select count(*) from public.estrategias", "authenticated", u["operb"], 1)
checar("planejamento A configura canal da A", True, f"insert into public.canais_empresa (empresa_id,canal,janela_inicio,janela_fim,capacidade_dia,custo) values ({EA},'discador','09:00','18:00',5000,0.12)", "authenticated", u["plan"])
checar("horário inválido é recusado", False, f"insert into public.canais_empresa (empresa_id,canal,janela_inicio) values ({EA},'sms','25:00')", "authenticated", u["plan"])
checar("canal desconhecido é recusado", False, f"insert into public.canais_empresa (empresa_id,canal) values ({EA},'fax')", "authenticated", u["plan"])
checar("planejamento A não configura canal da B", False, f"insert into public.canais_empresa (empresa_id,canal) values ({EB},'sms')", "authenticated", u["plan"])
checar("operação lê canais da própria empresa", True, "select count(*) from public.canais_empresa", "authenticated", u["oper"], 1)
checar("operação B não lê canais da A", True, "select count(*) from public.canais_empresa", "authenticated", u["operb"], 0)
checar("planejamento sobe retorno de enriquecimento", True, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'enriquecimento','alfa/enriquecimento/2026-09-25/e.csv','e.csv')", "authenticated", u["plan"])
checar("planejamento sobe arquivo em entradas/alfa/enriquecimento", True, "insert into storage.objects (bucket_id,name) values ('entradas','alfa/enriquecimento/2026-09-25/e.csv')", "authenticated", u["plan"])
checar("apagar estratégia deixa o cluster sem estratégia", True, f"delete from public.estrategias where nome='Digital'; select count(*) from public.clusters where estrategia_id is null and empresa_id={EA}", "authenticated", u["plan"], 1)
# mapa da esteira
sql(f"set role service_role; update public.estado_cliente set saldo=1000 where empresa_id={EA} and id_cliente='C1'; update public.estado_cliente set saldo=250.5 where empresa_id={EA} and id_cliente='C2'; update public.estado_cliente set saldo=99 where empresa_id={EB}")
checar("mapa: operação A vê só a A, com saldo", True, "select string_agg(estado||':'||etapa||':'||clientes||':'||saldo, ',' order by estado) from public.mapa_esteira", "authenticated", u["oper"], "CPA:-:1:1000.00,LOC:L0:1:250.50")  # ciclo vazio nos dados de teste
checar("mapa: operação B vê só a B", True, "select sum(clientes) from public.mapa_esteira", "authenticated", u["operb"], 1)
checar("mapa: anon não vê", False, "select * from public.mapa_esteira", "anon")
checar("mapa: safra (mês de entrada)", True, "select string_agg(distinct safra, ',') from public.mapa_esteira", "authenticated", u["oper"], "2026-08")
checar("ações de hoje: régua × passo × canal da própria empresa", True, "select string_agg(regua||'/'||passo||'/'||canal||'='||clientes, ',' order by regua) from public.acoes_hoje", "authenticated", u["oper"], "cpc/T1/whatsapp=1,localizacao/D+5/discador=1")
checar("ações de hoje: B vê só a B", True, "select sum(clientes) from public.acoes_hoje", "authenticated", u["operb"], 1)
sql(f"set role service_role; insert into public.trilha (empresa_id,id_cliente,data,tag_anterior,tag,motivo,quem_marcou) values ({EA},'C2','2026-08-02','','S260801-M1-LOC-ND-L0','entrada','P'),({EA},'C2','2026-08-03','S260801-M1-LOC-ND-L0','S260801-M1-LOC-ND-L1','sem contato','W'),({EA},'C1','2026-08-04','S260801-A1-PRE-WA-D-3','S260801-A1-QBR-WA-D1','quebra','S')")
checar("fluxo: entradas e mudanças de estado (não de ciclo)", True, "select string_agg(coalesce(de,'∅')||'>'||para||'='||clientes, ',' order by data) from public.fluxo_esteira", "authenticated", u["oper"], "∅>LOC=1,∅>CPA=1,PRE>QBR=1")
checar("fluxo: B não vê a trilha da A", True, "select count(*) from public.fluxo_esteira", "authenticated", u["operb"], 0)
checar("planejamento escolhe todos os números no discador", True, f"update public.canais_empresa set numeros_por_cliente=99 where empresa_id={EA} and canal='discador'", "authenticated", u["plan"])
checar("números por cliente fora de 1–99 é recusado", False, f"update public.canais_empresa set numeros_por_cliente=0 where empresa_id={EA}", "authenticated", u["plan"])
# personas e sugestões
sql(f"set role service_role; insert into public.personas (empresa_id,persona,nome,clientes) values ({EA},'RJ','UF RJ',400),({EB},'SP','UF SP',10);"
    f"insert into public.sugestoes (empresa_id,chave,texto,dados) values ({EA},'RJ|loc|1|whatsapp|discador','UF RJ: trocar','{{}}'),({EB},'SP|x','b','{{}}')")
checar("personas: cada empresa vê as suas", True, "select string_agg(nome, ',') from public.personas", "authenticated", u["oper"], "UF RJ")
checar("operação não aprova sugestão (0 linhas)", True, "with x as (update public.sugestoes set status='aprovada' returning 1) select count(*) from x", "authenticated", u["oper"], 0)
checar("planejamento A aprova sugestão da A", True, f"update public.sugestoes set status='aprovada' where empresa_id={EA}; select decidida_por is not null from public.sugestoes where empresa_id={EA}", "authenticated", u["plan"], "t")
checar("não dá para mudar a sugestão depois de decidida", False, f"update public.sugestoes set status='recusada' where empresa_id={EA}", "authenticated", u["plan"])
checar("pelo site não se marca como aplicada", False, f"update public.sugestoes set status='aplicada' where empresa_id={EB}", "authenticated", u["admin"])
checar("planejamento A não decide sugestão da B (0 linhas)", True, f"with x as (update public.sugestoes set status='recusada' where empresa_id={EB} returning 1) select count(*) from x", "authenticated", u["plan"], 0)
checar("rotina marca como aplicada", True, f"update public.sugestoes set status='aplicada', aplicada_em=now() where empresa_id={EA}", "service_role")
# ações realizadas (agregado)
checar("rotina grava ações do dia", True, f"insert into public.acoes_dia (empresa_id,data,canal,regua,enviadas,com_retorno,cpcs,custo) values ({EA},'2026-09-01','whatsapp','localizacao',100,80,12,5.00),({EB},'2026-09-01','sms','localizacao',7,0,0,0)", "service_role")
checar("ações: cada empresa vê as suas", True, "select sum(enviadas) from public.acoes_dia", "authenticated", u["oper"], 100)
checar("ações: B vê só a B", True, "select sum(enviadas) from public.acoes_dia", "authenticated", u["operb"], 7)
checar("site não altera ações (0 linhas)", True, "with x as (update public.acoes_dia set enviadas=0 returning 1) select count(*) from x", "authenticated", u["admin"], 0)
checar("site não grava ações", False, f"insert into public.acoes_dia (empresa_id,data,canal) values ({EA},'2026-09-02','sms')", "authenticated", u["admin"])
checar("anônimo não lê ações", False, "select count(*) from public.acoes_dia", "anon")
# credores (carteiras) da empresa
checar("toda empresa nasce com o credor principal", True, "select count(*) from public.empresas e where not exists (select 1 from public.credores c where c.empresa_id=e.id and c.codigo='principal')", "service_role", None, 0)
checar("planejamento A cria credor na A", True, f"insert into public.credores (empresa_id,codigo,nome) values ({EA},'banco-x','Banco X')", "authenticated", u["plan"])
checar("operação não cria credor", False, f"insert into public.credores (empresa_id,codigo,nome) values ({EA},'banco-y','Banco Y')", "authenticated", u["oper"])
checar("planejamento A não cria credor na B", False, f"insert into public.credores (empresa_id,codigo,nome) values ({EB},'banco-z','Banco Z')", "authenticated", u["plan"])
checar("B não vê credores da A", True, "select string_agg(codigo, ',') from public.credores", "authenticated", u["operb"], "principal")
checar("site não apaga credor (0 linhas)", True, "with x as (delete from public.credores returning 1) select count(*) from x", "authenticated", u["admin"], 0)
_, CX, _ = sql(f"select id from public.credores where empresa_id={EA} and codigo='banco-x'")
_, CB, _ = sql(f"select id from public.credores where empresa_id={EB}")
checar("com 2 credores, carga sem credor é recusada", False, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'base','alfa/base/2026-10-05/s.csv','s.csv')", "authenticated", u["plan"])
checar("carga incremental do Banco X", True, f"insert into public.envios (empresa_id,credor_id,tipo,caminho,nome_original) values ({EA},{CX},'incremental','alfa/incremental/2026-10-05/i.csv','i.csv')", "authenticated", u["plan"])
for tipo in ("retirada", "acordo", "baixa"):
    checar(f"arquivo de {tipo} do Banco X", True, f"insert into public.envios (empresa_id,credor_id,tipo,caminho,nome_original) values ({EA},{CX},'{tipo}','alfa/{tipo}/2026-10-05/{tipo}.csv','{tipo}.csv')", "authenticated", u["plan"])
checar("bureau sem credor vale para todos", True, f"insert into public.envios (empresa_id,tipo,caminho,nome_original) values ({EA},'enriquecimento','alfa/enriquecimento/2026-10-05/e2.csv','e2.csv')", "authenticated", u["plan"])
checar("credor de outra empresa é recusado", False, f"insert into public.envios (empresa_id,credor_id,tipo,caminho,nome_original) values ({EA},{CB},'base','alfa/base/2026-10-05/x.csv','x.csv')", "authenticated", u["plan"])
checar("credor inativo não recebe arquivo", False, f"update public.credores set ativo=false where id={CX}; insert into public.envios (empresa_id,credor_id,tipo,caminho,nome_original) values ({EA},{CX},'base','alfa/base/2026-10-05/y.csv','y.csv')", "authenticated", u["plan"])
sql(f"update public.credores set ativo=true where id={CX}")
checar("estado do mesmo ID em dois credores", True, f"insert into public.estado_cliente (empresa_id,credor_id,id_cliente,tag,safra,cluster_origem,cluster_atual,estado,canal,ciclo) select empresa_id,{CX},id_cliente,tag,safra,cluster_origem,cluster_atual,estado,canal,ciclo from public.estado_cliente where empresa_id={EA} limit 1", "service_role")
checar("mapa separa por credor", True, f"select count(distinct credor_id) from public.mapa_esteira where empresa_id={EA}", "authenticated", u["oper"], 2)
checar("rotina antiga sem credor cai no principal", True, f"insert into public.acoes_dia (empresa_id,data,canal) values ({EA},'2026-10-05','sms'); select c.codigo from public.acoes_dia a join public.credores c on c.id=a.credor_id where a.data='2026-10-05'", "service_role", None, "principal")
# enquadramento
checar("rotina grava esteira e ação de hoje", True, f"update public.estado_cliente set estrategia='Esteira X', acao_hoje='whatsapp', na_carga=true where empresa_id={EA}", "service_role")
checar("enquadramento: A vê a esteira dos seus clientes", True, "select string_agg(distinct estrategia, ',') from public.enquadramento where com_acao_hoje > 0", "authenticated", u["oper"], "Esteira X")
checar("enquadramento: B não vê a A", True, "select count(*) from public.enquadramento where estrategia='Esteira X'", "authenticated", u["operb"], 0)
# personas criadas pela empresa (por carteira)
checar("planejamento A cria persona na carteira", True, f"insert into public.personas_usuario (empresa_id,credor_id,nome,condicoes) values ({EA},{CX},'Digitais SP','[{{\"campo\":\"UF\",\"op\":\"=\",\"valor\":\"SP\"}}]')", "authenticated", u["plan"])
checar("operação não cria persona", False, f"insert into public.personas_usuario (empresa_id,credor_id,nome) values ({EA},{CX},'X')", "authenticated", u["oper"])
checar("persona com carteira de outra empresa é recusada", False, f"insert into public.personas_usuario (empresa_id,credor_id,nome) values ({EA},{CB},'Y')", "service_role")
checar("B não vê as personas da A", True, "select count(*) from public.personas_usuario", "authenticated", u["operb"], 0)
checar("nome repetido na mesma carteira é recusado", False, f"insert into public.personas_usuario (empresa_id,credor_id,nome) values ({EA},{CX},'Digitais SP')", "service_role")
# segmento × carteira
_, VE, _ = sql(f"select id from public.clusters where empresa_id={EA} and codigo='VE'")
_, CP, _ = sql(f"select id from public.credores where empresa_id={EA} and codigo='principal'")
checar("segmento sem vínculo vale em todas as carteiras", True, f"select string_agg(em_uso::text, ',' order by credor_id) from public.segmentos_em_uso where cluster_id={VE}", "authenticated", u["oper"], "true,true")
checar("planejamento vincula o segmento à carteira principal", True, f"insert into public.segmentos_carteira (empresa_id,cluster_id,credor_id,ativo) values ({EA},{VE},{CP},true)", "authenticated", u["plan"])
checar("com vínculo, só a carteira vinculada usa", True, f"select string_agg(credor_id::text, ',') from public.segmentos_em_uso where cluster_id={VE} and em_uso", "authenticated", u["oper"], CP)
checar("planejamento pausa o segmento na carteira", True, f"update public.segmentos_carteira set ativo=false where cluster_id={VE} and credor_id={CP}; select count(*) from public.segmentos_em_uso where cluster_id={VE} and em_uso", "authenticated", u["plan"], 0)
checar("vínculo com carteira de outra empresa é recusado", False, f"insert into public.segmentos_carteira (empresa_id,cluster_id,credor_id) values ({EA},{VE},{CB})", "service_role")
checar("operação não vincula segmento", False, f"insert into public.segmentos_carteira (empresa_id,cluster_id,credor_id) values ({EA},{VE},{CX})", "authenticated", u["oper"])
checar("B não vê os vínculos da A", True, "select count(*) from public.segmentos_carteira", "authenticated", u["operb"], 0)
# modelos de persona (catálogo)
checar("todos leem os modelos de persona", True, "select count(*) from public.personas_modelo", "authenticated", u["operb"], 9)
checar("site não altera modelo de persona", False, "insert into public.personas_modelo (id,propensao,nome,descricao,condicoes) values ('x','digital','x','x','[]')", "authenticated", u["admin"])
checar("anônimo não lê modelos", False, "select count(*) from public.personas_modelo", "anon")
checar("rotina (service_role) atualiza status do envio", True, "update public.envios set status='processado', relatorio='{\"linhas\":10}'", "service_role")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
