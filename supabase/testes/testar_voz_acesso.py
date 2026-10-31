"""SQL 57 · Acesso próprio das VMs de voz: entra no banco local COMO o papel motorcx_voz (login de verdade, não
"set role") e prova o que ele pode e o que não pode. Depois roda o código da VM (voz/acesso.py com pg8000) contra o
mesmo banco: configuração, chamadas, consumo e a publicação do retorno (a Edge Function é imitada aqui, consumindo
o bilhete como service_role). Só dados fictícios.

Pré-requisito: o banco com a imitação do Supabase e todas as migrações (como no testar_rls.py), num Postgres local
que aceite o login de motorcx_voz sem senha (trust) pelo socket. Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_acesso.py
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
from datetime import date, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, usuario="postgres"):
    r = subprocess.run(BASE + ["-U", usuario, "-c", cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


def _sv(cmd):
    ok, out, err = sql(cmd)
    assert ok, err
    return out


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, valor=None, usuario="motorcx_voz", erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, usuario)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:160]}"))


def caso(nome, passou, detalhe=""):
    global ok_total, falhas
    ok_total += bool(passou)
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + nome + ("" if passou else f"  -> {detalhe}"))


# o testar_rls.py reaplica o SQL 56 (que recria divisao_concorrencia_voz sem a troca do 57): reaplica o 57 por cima,
# como o dono faria, o que também prova que ele roda de novo com dados
r = subprocess.run(["psql", "-d", BANCO, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f",
                    str(RAIZ / "supabase" / "migrations" / "20261224000001_voz_acesso_proprio.sql")],
                   capture_output=True, text=True)
assert r.returncode == 0, r.stderr

# ------------------------------------------------------------------ dados (como postgres): A com voz, B sem voz
_sv("delete from public.envios where caminho like 'vza-%'; delete from storage.objects where name like 'vza-%'")
_sv("delete from auth.users where email like 'vza.%'")
_sv("delete from public.empresas where slug in ('vza-alfa', 'vza-beta')")
EA = _sv("insert into public.empresas (slug, nome) values ('vza-alfa', 'Voz Acesso Alfa') returning id")
EB = _sv("insert into public.empresas (slug, nome) values ('vza-beta', 'Voz Acesso Beta') returning id")
CA = _sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cart-a', 'Carteira A') returning id")
CB = _sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'cart-b', 'Carteira B') returning id")
_sv(f"insert into public.voz_config (empresa_id) values ({EA})")
TA = _sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, canais) "
         f"values ({EA}, 'vza-sp', 'Operadora Exemplo', '203.0.113.20', 'ip', '11', '1130030000', 8) returning id")
_sv(f"insert into public.voz_rotas (empresa_id, tronco_id, prioridade, tech_prefix, tipo, cadencia_inicial_s, "
    f"cadencia_incremento_s, preco_minuto, vigente_desde) values ({EA}, {TA}, 1, '4321', 'movel_vc1', 30, 6, 0.09, '2026-01-01')")
TB = _sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, canais) "
         f"values ({EB}, 'vzb-rj', 'Operadora Exemplo', '203.0.113.21', 'ip', '21', '2130030000', 4) returning id")
EQ = _sv("insert into auth.users (email) values ('vza.equipe@x.com') returning id")
_sv(f"update public.perfis set equipe = true, ativo = true, empresa_id = null where id = '{EQ}'")
NE = _sv("insert into auth.users (email) values ('vza.cliente@x.com') returning id")
_sv(f"update public.perfis set equipe = false, empresa_id = {EA} where id = '{NE}'")
H64 = hashlib.sha256(b"11999990000").hexdigest()

# ------------------------------------------------------------------ quem é
checar("SQL 57: entra como motorcx_voz (login próprio, não set role)", True,
       "select current_user || '|' || session_user", "motorcx_voz|motorcx_voz")
checar("SQL 57: papel sem herança, sem BYPASSRLS, sem super, sem criar banco/papel", True,
       "select rolinherit || '|' || rolbypassrls || '|' || rolsuper || '|' || rolcreatedb || '|' || rolcreaterole "
       "from pg_roles where rolname = current_user", "false|false|false|false|false")
checar("SQL 57: papel não é membro de nenhum outro", True,
       "select count(*) from pg_auth_members where member = (select oid from pg_roles where rolname = current_user)", 0)

# ------------------------------------------------------------------ pode: ler a configuração de voz
for v, n in (("config", 1), ("troncos", 1), ("rotas", 1), ("transferencias", 0), ("contrato", 1),
             ("roteiros_em_uso", 0)):
    checar(f"SQL 57: lê voz_vm.{v}", True, f"select count(*) from voz_vm.{v} t "
           + ("" if v == "contrato" else f"where t.empresa_id = {EA}"), n)
checar("SQL 57: lê a divisão da concorrência (todas as empresas, como o servidor)", True,
       f"select count(*) from voz_vm.divisao_concorrencia where empresa_id in ({EA}, {EB})", 2)
checar("SQL 57: vê id e slug só das empresas com voz", True,
       f"select string_agg(slug, ',') from voz_vm.empresas where id in ({EA}, {EB})", "vza-alfa")
checar("SQL 57: vê só id e código das carteiras ativas das empresas com voz", True,
       f"select string_agg(codigo, ',' order by codigo) from voz_vm.carteiras where empresa_id in ({EA}, {EB})",
       "cart-a,principal")
checar("SQL 57: a view de empresas não tem nome, CNPJ nem endereço", True,
       "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       "where table_schema = 'voz_vm' and table_name = 'empresas'", "id,slug", usuario="postgres")
checar("SQL 57: a view de tarifação não tem cliente, destino nem códigos", True,
       "select count(*) from information_schema.columns where table_schema = 'voz_vm' "
       "and table_name = 'chamadas_tarifacao' and column_name in ('id_cliente', 'destino_hash', 'destino_mascara', 'codigos', 'id_acao')",
       0, usuario="postgres")

# ------------------------------------------------------------------ pode: gravar chamadas, consumo, gravações, saúde, lotes
CH = (f"[{{\"empresa_id\": {EA}, \"credor_id\": {CA}, \"id_cliente\": \"C1\", \"id_acao\": \"A1\", \"id_chamada\": \"vza-0001\", "
      f"\"resultado\": \"promessa\", \"billsec\": 31, \"duracao_s\": 31, \"tech_prefix\": \"4321\", \"tronco_id\": {TA}, "
      f"\"destino_hash\": \"{H64}\", \"ocorrido_em\": \"2026-11-05T10:00:00-03:00\", "
      f"\"encerrada_em\": \"2026-11-05T10:00:40-03:00\", \"custo_operadora\": 99, \"transferencia_resultado\": \"x\"}}]")
checar("SQL 57: grava chamada", True, f"select voz_vm.gravar_chamadas('{CH}')", 1)
checar("SQL 57: reenvio da mesma chamada não duplica", True,
       f"select voz_vm.gravar_chamadas('{CH}'); select count(*) from voz_vm.chamadas_tarifacao where id_chamada = 'vza-0001'", 1)
checar("SQL 57: tarifação é do gatilho (o custo mandado pela VM é ignorado)", True,
       "select custo_operadora || '|' || segundos_tarifados || '|' || modo from voz_vm.chamadas_tarifacao "
       "where id_chamada = 'vza-0001'", "0.05400|36|simulado")
checar("SQL 57: grava consumo do dia", True,
       f"select voz_vm.gravar_consumo('[{{\"empresa_id\": {EA}, \"dia\": \"2026-11-05\", \"tech_prefix\": \"4321\", "
       f"\"chamadas\": 1, \"chamadas_atendidas\": 1, \"segundos_atendidos\": 31, \"segundos_tarifados\": 36, "
       f"\"custo_estimado\": 0.054}}]')", 1)
checar("SQL 57: grava gravação pela id_chamada (guarda e validade não são da VM)", True,
       f"select voz_vm.gravar_gravacoes('[{{\"empresa_id\": {EA}, \"credor_id\": {CA}, \"id_chamada\": \"vza-0001\", "
       f"\"id_cliente\": \"C1\", \"id_acao\": \"A1\", \"origem\": \"ia\", \"caminho\": \"cart-a/2026/11/05/A1_vza-0001.mp3\", "
       f"\"duracao_s\": 31, \"guarda\": true, \"expira_em\": \"2026-11-06T00:00:00Z\"}}]')", 1)
checar("SQL 57: a gravação ficou com 90 dias, sem guarda, e marcou a chamada", True,
       f"select (g.expira_em - g.gravada_em)::text || '|' || g.guarda || '|' || c.tem_gravacao from public.voz_gravacoes g "
       f"join public.voz_chamadas c on c.id = g.chamada_id where g.empresa_id = {EA}", "90 days|false|true", usuario="postgres")
checar("SQL 57: grava saúde do tronco", True,
       f"select voz_vm.gravar_saude('[{{\"empresa_id\": {EA}, \"tronco_id\": {TA}, \"item\": \"options_sip\", \"ok\": true}}]')", 1)
checar("SQL 57: cria lote e onda", True,
       f"with l as (select id from voz_vm.gravar_lotes('[{{\"empresa_id\": {EA}, \"credor_id\": {CA}, \"data\": \"2026-11-05\", \"total\": 10}}]')) "
       f"select count(*) from l", 1)
LT = _sv(f"select id from public.voz_lotes where empresa_id = {EA} order by id desc limit 1")
checar("SQL 57: grava onda do lote", True,
       f"select count(*) from voz_vm.gravar_ondas('[{{\"empresa_id\": {EA}, \"lote_id\": {LT}, \"janela\": \"manha\", \"tentativa\": 1, \"total\": 10}}]')", 1)
checar("SQL 57: lote avança agendado → ligando", True,
       f"select count(*) from voz_vm.gravar_lotes('[{{\"id\": {LT}, \"empresa_id\": {EA}, \"situacao\": \"ligando\", \"encerradas\": 3}}]')", 1)
_sv(f"update public.voz_lotes set situacao = 'pausado' where id = {LT}")
checar("SQL 57: VM não tira da pausa um lote que a pessoa pausou", True,
       f"select count(*) from voz_vm.gravar_lotes('[{{\"id\": {LT}, \"empresa_id\": {EA}, \"situacao\": \"concluido\"}}]')", 1)
checar("SQL 57: ... e o lote continua pausado", True, f"select situacao from public.voz_lotes where id = {LT}", "pausado",
       usuario="postgres")

# ------------------------------------------------------------------ escrita recusada fora da regra
checar("SQL 57: não grava chamada de empresa sem voz", False,
       f"select voz_vm.gravar_chamadas('[{{\"empresa_id\": {EB}, \"id_cliente\": \"C9\", \"id_chamada\": \"vzb-0001\"}}]')",
       erro="empresa sem voz")
checar("SQL 57: não grava chamada com carteira de outra empresa", False,
       f"select voz_vm.gravar_chamadas('[{{\"empresa_id\": {EA}, \"credor_id\": {CB}, \"id_cliente\": \"C9\", \"id_chamada\": \"vza-0009\"}}]')",
       erro="outra empresa")
checar("SQL 57: não grava saúde com tronco de outra empresa", False,
       f"select voz_vm.gravar_saude('[{{\"empresa_id\": {EA}, \"tronco_id\": {TB}, \"item\": \"options_sip\", \"ok\": true}}]')")
checar("SQL 57: não escreve em tabela de voz direto", False,
       f"insert into public.voz_chamadas (empresa_id, id_chamada, id_cliente) values ({EA}, 'vza-0002', 'C2')")
checar("SQL 57: não escreve pela view de configuração", False, f"update voz_vm.config set modo = 'real' where empresa_id = {EA}")
checar("SQL 57: não apaga gravação", False, f"delete from public.voz_gravacoes where empresa_id = {EA}")

# ------------------------------------------------------------------ não pode: nada fora da voz
for t in ("estado_cliente", "trilha", "fila_dia", "perfis", "empresas", "credores", "faturas", "envios", "api_tokens",
          "voz_config", "voz_chamadas", "voz_gravacoes", "consumo_voz"):
    checar(f"SQL 57: não lê public.{t}", False, f"select * from public.{t} limit 1", erro="permission denied")
checar("SQL 57: não lê auth.users", False, "select * from auth.users limit 1", erro="permission denied")
checar("SQL 57: não lê storage.objects", False, "select * from storage.objects limit 1", erro="permission denied")
checar("SQL 57: não lê os bilhetes", False, "select * from voz_vm.bilhetes limit 1", erro="permission denied")
checar("SQL 57: nenhuma tabela, view ou sequência fora de voz_vm com privilégio", True,
       "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace "
       "where n.nspname not in ('pg_catalog', 'information_schema', 'voz_vm') and c.relkind in ('r','v','m','p','f','S') "
       "and (has_table_privilege(c.oid, 'select') or has_table_privilege(c.oid, 'insert') "
       "or has_table_privilege(c.oid, 'update') or has_table_privilege(c.oid, 'delete') "
       "or (c.relkind = 'S' and has_sequence_privilege(c.oid, 'usage')))", 0)
checar("SQL 57: nenhuma função security definer fora de voz_vm executável", True,
       "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
       "where p.prosecdef and n.nspname <> 'voz_vm' and n.nspname not like 'pg\\_%' and has_function_privilege(p.oid, 'execute')", 0)
checar("SQL 57: JWT forjado não abre função do site (sem execução)", False,
       f"select set_config('request.jwt.claim.sub', '{EQ}', false); select public.sou_equipe()", erro="permission denied")
checar("SQL 57: não chama RPC da equipe nem com JWT forjado", False,
       f"select set_config('request.jwt.claim.sub', '{EQ}', false); select public.configurar_voz_equipe({EA}, '{{\"modo\": \"real\"}}')",
       erro="permission denied")
for papel in ("service_role", "authenticated", "postgres"):
    checar(f"SQL 57: não vira {papel}", False, f"set role {papel}", erro="permission denied")
checar("SQL 57: não consome o próprio bilhete (só a Edge Function)", False,
       f"select * from public.consumir_bilhete_voz('{'0' * 64}')", erro="permission denied")

# ------------------------------------------------------------------ não pode: DDL
for nome, cmd in (("cria tabela no public", "create table public.vza_x (id int)"),
                  ("cria tabela em voz_vm", "create table voz_vm.vza_x (id int)"),
                  ("cria schema", "create schema vza_x"),
                  ("cria função no public", "create function public.vza_f() returns int language sql as 'select 1'"),
                  ("altera tabela de voz", "alter table public.voz_chamadas add column vza int"),
                  ("apaga view da VM", "drop view voz_vm.config"),
                  ("troca a própria view", "create or replace view voz_vm.empresas as select id, slug, cnpj from public.empresas"),
                  ("cria papel", "create role vza_r"),
                  ("muda o próprio papel", "alter role motorcx_voz bypassrls"),
                  ("apaga tabela de voz", "drop table public.voz_chamadas"),
                  ("cria extensão", "create extension if not exists pgcrypto")):
    checar(f"SQL 57: DDL recusado: {nome}", False, cmd)

checar("SQL 57: grant feito por ele não vale (não é dono de nada)", True,
       "grant select on voz_vm.config to anon; select has_table_privilege('anon', 'voz_vm.config', 'select')", "f")

# ------------------------------------------------------------------ arquivos: bilhete só para os caminhos da voz
def bilhete(op, bucket, caminho):
    return f"select voz_vm.bilhete_arquivo('{op}', '{bucket}', '{caminho}') ~ '^[0-9a-f]{{64}}$'"


UU = "0b0c0d0e-0000-4000-8000-000000000001"
RET = f"vza-alfa/retorno/2026-11-05/{UU}_motorcx_voz_2026-11-05_101500.csv"
checar("SQL 57: bilhete para baixar a Lista do discador", True, bilhete("baixar", "saidas", "vza-alfa/2026-11-05/discador_mailing.csv"), "t")
checar("SQL 57: bilhete para baixar a Lista do agente da carteira", True, bilhete("baixar", "saidas", "vza-alfa/2026-11-05/cart-a/ids/agente_voz.csv"), "t")
checar("SQL 57: bilhete para enviar o retorno", True, bilhete("enviar", "entradas", RET), "t")
for nome, op, b, c in (("outro arquivo do motor (trilha)", "baixar", "saidas", "vza-alfa/2026-11-05/trilha.csv"),
                       ("Lista de empresa sem voz", "baixar", "saidas", "vza-beta/2026-11-05/discador_mailing.csv"),
                       ("carteira de outra empresa", "baixar", "saidas", "vza-alfa/2026-11-05/cart-b/discador_mailing.csv"),
                       ("caminho com ..", "baixar", "saidas", "vza-alfa/2026-11-05/../x/discador_mailing.csv"),
                       ("baixar do bucket entradas", "baixar", "entradas", RET),
                       ("enviar para saidas", "enviar", "saidas", "vza-alfa/2026-11-05/discador_mailing.csv"),
                       ("enviar carga de clientes", "enviar", "entradas", f"vza-alfa/clientes/2026-11-05/{UU}_base.csv"),
                       ("retorno com dia trocado", "enviar", "entradas", RET.replace("_2026-11-05_", "_2026-11-04_")),
                       ("listar", "listar", "saidas", "vza-alfa")):
    checar(f"SQL 57: sem bilhete: {nome}", False, f"select voz_vm.bilhete_arquivo('{op}', '{b}', '{c}')", erro="não permitido")

# o bilhete vale uma vez e só pela Edge Function (service_role)
ok, T, err = sql("select voz_vm.bilhete_arquivo('baixar', 'saidas', 'vza-alfa/2026-11-05/discador_mailing.csv')")
HT = hashlib.sha256(T.encode()).hexdigest()
checar("SQL 57: o banco guarda só o hash do bilhete", True, f"select count(*) from voz_vm.bilhetes where hash = '{HT}' "
       f"and caminho = 'vza-alfa/2026-11-05/discador_mailing.csv'", 1, usuario="postgres")
checar("SQL 57: Edge Function troca o bilhete pela operação", True,
       f"set role service_role; select operacao || '|' || bucket || '|' || caminho from public.consumir_bilhete_voz('{HT}')",
       "baixar|saidas|vza-alfa/2026-11-05/discador_mailing.csv", usuario="postgres")
checar("SQL 57: bilhete usado não vale de novo", True,
       f"set role service_role; select count(*) from public.consumir_bilhete_voz('{HT}')", 0, usuario="postgres")
checar("SQL 57: anon e authenticated não consomem bilhete", False,
       f"set role authenticated; select * from public.consumir_bilhete_voz('{HT}')", usuario="postgres")

# ------------------------------------------------------------------ publicação do envio de retorno
REG = f"select voz_vm.registrar_retorno({EA}, {CA}, '{RET}', 'motorcx_voz_2026-11-05_101500.csv', '{EQ}')"
checar("SQL 57: retorno sem o arquivo no bucket é recusado", False, REG, erro="não está no bucket")
_sv(f"insert into storage.objects (bucket_id, name) values ('entradas', '{RET}')")
checar("SQL 57: retorno com usuário que não é da equipe é recusado", False, REG.replace(EQ, NE), erro="equipe")
checar("SQL 57: retorno com nome diferente do caminho é recusado", False,
       REG.replace("'motorcx_voz_2026-11-05_101500.csv'", "'motorcx_voz_2026-11-05_101501.csv'"), erro="não confere")
checar("SQL 57: retorno de carteira de outra empresa é recusado", False, REG.replace(f", {CA},", f", {CB},"), erro="outra empresa")
checar("SQL 57: retorno no caminho de outra empresa é recusado", False, REG.replace(f"({EA},", f"({EB},"))
checar("SQL 57: registra o envio de retorno (pendente)", True, REG + " is not null", "t")
checar("SQL 57: o envio é retorno, pendente, da carteira e do usuário da equipe", True,
       f"select tipo || '|' || status || '|' || credor_id || '|' || (enviado_por = '{EQ}') from public.envios where caminho = '{RET}'",
       f"retorno|pendente|{CA}|true", usuario="postgres")
checar("SQL 57: o mesmo arquivo não é registrado duas vezes", False, REG)
checar("SQL 57: sem bilhete para apagar arquivo já registrado em envios", False,
       f"select voz_vm.bilhete_arquivo('apagar', 'entradas', '{RET}')", erro="já registrado")

# ------------------------------------------------------------------ o código da VM (voz/acesso.py) contra este banco
try:
    import pg8000.native as PG
except ImportError:   # o motor e o CI não têm o driver; a VM tem (voz/requirements.txt)
    PG = None
    print("AVISO: pg8000 ausente, pulando a parte do código da VM")

if PG is not None:
    sys.path.insert(0, str(RAIZ))
    from voz import acesso as A
    from voz import configuracao as CF
    from voz.orquestrador.eventos import EventoChamada
    from voz.publicacao import Publicador
    from voz.registro import RegistroBanco

    SOCK = os.path.join(os.environ.get("PGHOST", "/tmp"), f".s.PGSQL.{os.environ.get('PGPORT', '5432')}")

    def conectar():
        return PG.Connection("motorcx_voz", unix_sock=SOCK, database=BANCO, application_name="motorcx-voz-teste")

    servidor = PG.Connection("postgres", unix_sock=SOCK, database=BANCO)
    arquivos = {("saidas", "vza-alfa/2026-11-05/cart-a/discador_mailing.csv"): b"id_cliente;telefone\n"}

    class Resposta(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def edge_function(req, timeout=None):
        """Imita supabase/functions/voz-arquivos: troca o bilhete (service_role) e faz a operação."""
        import urllib.error
        h = {k.lower(): v for k, v in req.header_items()}
        servidor.run("set role service_role")
        try:
            uso = servidor.run("select operacao, bucket, caminho from public.consumir_bilhete_voz(:h)",
                               h=hashlib.sha256(h["x-voz-bilhete"].encode()).hexdigest())
        finally:
            servidor.run("reset role")
        if not uso or uso[0][0] != h["x-voz-operacao"]:
            raise urllib.error.HTTPError(req.full_url, 403, "bilhete", {}, None)
        op, bucket, caminho = uso[0]
        if op == "baixar":
            if (bucket, caminho) not in arquivos:
                raise urllib.error.HTTPError(req.full_url, 404, "não achou", {}, None)
            return Resposta(arquivos[(bucket, caminho)])
        if op == "enviar":
            arquivos[(bucket, caminho)] = req.data
            servidor.run("insert into storage.objects (bucket_id, name) values (:b, :c)", b=bucket, c=caminho)
        else:
            arquivos.pop((bucket, caminho), None)
            servidor.run("delete from storage.objects where bucket_id = :b and name = :c", b=bucket, c=caminho)
        return Resposta(b"ok")

    sb = A.AcessoProprio(conectar, "https://exemplo-ref.supabase.co", abrir=edge_function)
    try:   # as tabelas que voz/configuracao.py lê, pela mesma interface, só da empresa A (dados de outros testes ficam de fora)
        from voz import banco as B
        dados = {t: sb.selecionar(t, {"empresa_id": f"eq.{EA}"}, ordem="empresa_id.asc") for t in CF.TABELAS}
        dados["voz_contrato"] = sb.selecionar("voz_contrato", limite=1)
        cfg = B.carregar(dados)
        caso("VM: configuração de voz lida e validada pelo voz/banco.py",
             [t.referencia for t in cfg.troncos] == ["vza-sp"] and len(cfg.rotas) == 1 and int(EA) in cfg.configs
             and len(dados["voz_contrato"]) == 1, dados)
    except Exception as ex:   # noqa: BLE001
        caso("VM: configuração de voz lida e validada pelo voz/banco.py", False, repr(ex))

    reg = RegistroBanco(sb)
    e = EventoChamada(empresa_id=int(EA), id_cliente="C2", numero_discado="11988887770", data=date(2026, 11, 5),
                      hora=time(11, 0), id_chamada="vza-0101", billsec=20, tech_prefix="4321", credor_id=int(CA))
    e.desfecho = "cpc"
    reg.registrar(e)
    caso("VM: RegistroBanco grava voz_chamadas pelo acesso próprio", reg.descarregar() == 1 and reg.erros == 0, reg.erros)
    caso("VM: RegistroBanco recalcula consumo_voz (lê só a tarifação)", reg.atualizar_consumo() >= 1 and reg.erros == 0, reg.erros)
    caso("VM: o número discado não foi para o banco",
         servidor.run("select count(*) from public.voz_chamadas where id_chamada = 'vza-0101' "
                      "and coalesce(destino_mascara, '') || coalesce(destino_hash, '') like '%988887770%'")[0][0] == 0)
    try:
        sb.selecionar("estado_cliente")
        caso("VM: tabela fora da voz é recusada no código", False, "leu estado_cliente")
    except A.AcessoNegado:
        caso("VM: tabela fora da voz é recusada no código", True)
    try:
        sb._run("select count(*) from public.estado_cliente")
        caso("VM: ... e no banco", False, "leu estado_cliente")
    except Exception as ex:   # noqa: BLE001
        caso("VM: ... e no banco", "permission denied" in str(ex), repr(ex)[:160])

    caso("VM: baixa a Lista do dia com bilhete", sb.baixar("saidas", "vza-alfa/2026-11-05/cart-a/discador_mailing.csv")
         == b"id_cliente;telefone\n")
    try:
        sb.baixar("saidas", "vza-alfa/2026-11-05/trilha.csv")
        caso("VM: arquivo fora da Lista de voz não sai", False, "baixou")
    except Exception as ex:   # noqa: BLE001
        caso("VM: arquivo fora da Lista de voz não sai", "não permitido" in str(ex), repr(ex)[:160])

    with tempfile.TemporaryDirectory() as tmp:
        pasta = Path(tmp) / f"empresa_{EA}" / f"credor_{CA}"
        pasta.mkdir(parents=True)
        (pasta / "motorcx_voz_2026-11-05.csv").write_text("id_cliente;resultado\nC1;cpc\nC2;cpc\n", encoding="utf-8")
        from datetime import datetime
        pub = Publicador(sb, tmp, EQ, relogio=lambda: datetime(2026, 11, 5, 12, 30, 0))
        feitos = pub.publicar()
        caso("VM: publica o retorno (arquivo pela Edge Function + envios)", len(feitos) == 1 and feitos[0]["linhas"] == 2, feitos)
        n = servidor.run("select count(*) from public.envios where empresa_id = :e and tipo = 'retorno' "
                         "and nome_original = 'motorcx_voz_2026-11-05_123000.csv' and status = 'pendente'", e=int(EA))[0][0]
        caso("VM: o envio de retorno está pendente para o motor", n == 1, n)
        caso("VM: o CSV chegou ao bucket entradas",
             any(b == "entradas" and c.endswith("_motorcx_voz_2026-11-05_123000.csv") for b, c in arquivos))
    sb.fechar()
    servidor.close()

# ------------------------------------------------------------------ o passo da senha (README, seção 7) com senha fictícia
FICTICIA = "Ficticia0123456789abcdefghijKLMNOP"
r = subprocess.run(f"printf '%s' '{FICTICIA}' | {sys.executable} {RAIZ / 'infra' / 'asterisk' / 'senha_motorcx_voz.py'} "
                   f"| psql -d {BANCO} -U postgres -v ON_ERROR_STOP=1 -q", shell=True, capture_output=True, text=True)
caso("senha: o comando do README define a senha do papel (só o verificador SCRAM)", r.returncode == 0
     and _sv("select rolpassword like 'SCRAM-SHA-256$4096:%' from pg_authid where rolname = 'motorcx_voz'") == "t",
     r.stderr[:200])
caso("senha: a senha não aparece no que vai ao banco", FICTICIA not in r.stdout + r.stderr)
_sv("alter role motorcx_voz with password null")

# ------------------------------------------------------------------ limpeza
_sv("delete from public.envios where caminho like 'vza-%'; delete from storage.objects where name like 'vza-%'")
_sv(f"delete from auth.users where id in ('{EQ}', '{NE}')")
_sv(f"delete from voz_vm.bilhetes; delete from public.empresas where id in ({EA}, {EB})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
