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
# como o dono faria, o que também prova que ele roda de novo com dados. Os SQL seguintes que estendem o voz_vm (58 em
# diante) refazem as trocas deles depois do 57, em ordem (como o cabeçalho do 57 manda)
DO_57_EM_DIANTE = sorted(f for f in (RAIZ / "supabase" / "migrations").glob("*.sql")
                         if f.name >= "20261224000001_voz_acesso_proprio.sql")
for f in DO_57_EM_DIANTE:
    r = subprocess.run(["psql", "-d", BANCO, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", str(f)],
                       capture_output=True, text=True)
    assert r.returncode == 0, f"{f.name}: {r.stderr}"

# no CI o Postgres exige senha (scram) para todo login: o papel ganha a senha descartável do próprio banco de teste
# (PGPASSWORD do job), e o psql/pg8000 entram com ela. Local (trust pelo socket) fica sem senha, como antes.
SENHA_TESTE = os.environ.get("PGPASSWORD", "")


def _senha_de_teste():
    if SENHA_TESTE:
        _sv("alter role motorcx_voz with password '" + SENHA_TESTE.replace("'", "''") + "'")


_senha_de_teste()

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
checar("SQL 57: a view de carteiras tem só id, empresa, código, ativo e nome", True,
       "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       "where table_schema = 'voz_vm' and table_name = 'carteiras'", "id,empresa_id,codigo,ativo,nome", usuario="postgres")
checar("SQL 57: vê o nome da carteira (variável credor da fala)", True,
       f"select nome from voz_vm.carteiras where id = {CA}", "Carteira A")
checar("SQL 57: vê só as carteiras ativas das empresas com voz", True,
       f"select string_agg(codigo, ',' order by codigo) from voz_vm.carteiras where empresa_id in ({EA}, {EB})",
       "cart-a,principal")
checar("SQL 57: a view de empresas tem só id, slug e nome (sem CNPJ, endereço nem contato)", True,
       "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       "where table_schema = 'voz_vm' and table_name = 'empresas'", "id,slug,nome", usuario="postgres")
checar("SQL 57: a view de tarifação não tem cliente, destino nem códigos", True,
       "select count(*) from information_schema.columns where table_schema = 'voz_vm' "
       "and table_name = 'chamadas_tarifacao' and column_name in ('id_cliente', 'destino_hash', 'destino_mascara', 'codigos', 'id_acao')",
       0, usuario="postgres")

# ------------------------------------------------------------------ pode: gravar chamadas, consumo, gravações, saúde, lotes
CH = (f"[{{\"empresa_id\": {EA}, \"credor_id\": {CA}, \"id_cliente\": \"C1\", \"id_acao\": \"A1\", \"id_chamada\": \"vza-0001\", "
      f"\"resultado\": \"promessa\", \"billsec\": 31, \"duracao_s\": 31, \"tech_prefix\": \"4321\", \"tronco_id\": {TA}, "
      f"\"destino_hash\": \"{H64}\", \"ocorrido_em\": \"2026-11-05T10:00:00-03:00\", "
      f"\"encerrada_em\": \"2026-11-05T10:00:40-03:00\", \"canal\": \"agente_voz\", \"destino\": \"ia_humano\", "
      f"\"transferencia\": \"atendida\", \"transferida_em\": \"2026-11-05T10:00:30-03:00\"}}]")
CH_ANTIGA = CH.replace('"canal"', '"transferencia_resultado": "x", "canal"')   # o formato de antes do #152
CH_TARIFA = CH.replace('"canal"', '"custo_operadora": 99, "canal"')
checar("SQL 57: grava chamada (formato corrigido: transferencia, transferida_em, destino)", True,
       f"select voz_vm.gravar_chamadas('{CH}')", 1)
checar("SQL 57: reenvio da mesma chamada não duplica (empresa, id_chamada, canal)", True,
       f"select voz_vm.gravar_chamadas('{CH}'); select count(*) from voz_vm.chamadas_tarifacao where id_chamada = 'vza-0001'", 1)
checar("SQL 57: mesmo id_chamada em outro canal é outra linha", True,
       f"select voz_vm.gravar_chamadas('{CH.replace('agente_voz', 'discador')}'); "
       "select count(*) from voz_vm.chamadas_tarifacao where id_chamada = 'vza-0001'", 2)
checar("SQL 57: a transferência fica nas colunas reais", True,
       "select string_agg(transferencia || '|' || (transferida_em is not null) || '|' || destino, ',') "
       "from public.voz_chamadas where id_chamada = 'vza-0001'", "atendida|true|ia_humano,atendida|true|ia_humano",
       usuario="postgres")
checar("SQL 57: tarifação é do gatilho", True,
       "select custo_operadora || '|' || segundos_tarifados || '|' || modo from voz_vm.chamadas_tarifacao "
       "where id_chamada = 'vza-0001' and canal = 'agente_voz'", "0.05400|36|simulado")
checar("SQL 57: coluna antiga (transferencia_resultado) é recusada, não ignorada", False,
       f"select voz_vm.gravar_chamadas('{CH_ANTIGA}')",
       erro="transferencia_resultado")
checar("SQL 57: coluna de tarifação mandada pela VM é recusada (é do gatilho)", False,
       f"select voz_vm.gravar_chamadas('{CH_TARIFA}')",
       erro="custo_operadora")
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

# ------------------------------------------------------------------ SQL 58 · fluxo pelo acesso próprio (voz_vm)
# dados (como postgres): versão em uso da carteira A, host liberado, conector ativo e um em rascunho, alçada, base
# (uma resposta revisada e uma não), e o mesmo conector em B (sem voz)
FLA = _sv(f"insert into public.voz_fluxos (empresa_id, credor_id, nome) values ({EA}, {CA}, 'Fluxo VZA') returning id")
FVA = _sv(f"insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, credor_id, versao, situacao, definicao, aprovado_em, "
          f"em_uso_em) select {FLA}, {EA}, {CA}, 1, 'em_uso', m.definicao, now(), now() from public.voz_fluxo_modelos m "
          f"order by m.codigo limit 1 returning id")
FLB = _sv(f"insert into public.voz_fluxos (empresa_id, credor_id, nome) values ({EB}, {CB}, 'Fluxo VZB') returning id")
FVB = _sv(f"insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, credor_id, versao, situacao, definicao) "
          f"select {FLB}, {EB}, {CB}, 1, 'rascunho', m.definicao from public.voz_fluxo_modelos m order by m.codigo limit 1 returning id")
_sv(f"insert into public.crm_hosts_permitidos (empresa_id, host) values ({EA}, 'crm.vza-exemplo.com.br'), "
    f"({EB}, 'crm.vzb-exemplo.com.br')")
_CON = ("insert into public.crm_conectores (empresa_id, nome, finalidade, metodo, url, autenticacao, segredo_ref, situacao, "
        "teste_ok, exemplo_resposta) values ({e}, '{n}', 'buscar_ofertas', 'GET', 'https://crm.{h}-exemplo.com.br/ofertas', "
        "'bearer', 'voz/crm/{h}', '{s}', true, '{{\"ofertas\": []}}') returning id")
KA = _sv(_CON.format(e=EA, n="Ofertas", h="vza", s="ativo"))
KR = _sv(_CON.format(e=EA, n="Ofertas 2", h="vza", s="rascunho"))
KB = _sv(_CON.format(e=EB, n="Ofertas", h="vzb", s="ativo"))
_sv(f"insert into public.voz_alcada_carteira (empresa_id, credor_id, desconto_max_pct, parcelas_max, parcela_min, vigente_desde) "
    f"values ({EA}, {CA}, 25, 6, 40, '2026-01-01'), ({EB}, {CB}, 10, 2, 40, '2026-01-01')")
_sv(f"insert into public.voz_base_respostas (empresa_id, fluxo_versao_id, bloco_id, pergunta, resposta, revisado_em) values "
    f"({EA}, {FVA}, 'N3', 'Posso pagar no boleto?', 'Pode sim, o link chega por mensagem.', now()), "
    f"({EA}, {FVA}, 'N3', 'Tem desconto maior?', 'Ainda não revisada pela empresa.', null)")

checar("SQL 58: lê a versão em uso do fluxo da carteira (voz_vm.fluxo_em_uso)", True,
       f"select (r ->> 'versao_id') || '|' || (r ? 'definicao') || '|' || (r ? 'hash') "
       f"from jsonb_array_elements(voz_vm.fluxo_em_uso('{{\"empresa\": {EA}, \"credor\": {CA}}}')) r", f"{FVA}|true|true")
checar("SQL 58: sem fluxo da empresa sem voz", True,
       f"select voz_vm.fluxo_em_uso('{{\"empresa\": {EB}, \"credor\": {CB}}}')::text", "[]")
checar("SQL 58: lê a alçada vigente da carteira (voz_vm.alcada_vigente)", True,
       f"select r ->> 'parcelas_max' from voz_vm.alcada_vigente('{{\"empresa\": {EA}, \"credor\": {CA}, \"dia\": null}}') r", "6")
checar("SQL 58: sem alçada da empresa sem voz", True,
       f"select coalesce(voz_vm.alcada_vigente('{{\"empresa\": {EB}, \"credor\": {CB}}}')::text, 'nulo')", "nulo")
checar("SQL 58: vê só os conectores ativos das empresas com voz, com segredo_ref (o nome no cofre)", True,
       f"select string_agg(id || ':' || segredo_ref, ',') from voz_vm.crm_conectores where id in ({KA}, {KR}, {KB})",
       f"{KA}:voz/crm/vza")
checar("SQL 58: a view de conectores não tem exemplo_resposta nem quem testou", True,
       "select count(*) from information_schema.columns where table_schema = 'voz_vm' and table_name = 'crm_conectores' "
       "and column_name in ('exemplo_resposta', 'testado_por', 'criado_por', 'teste_ok')", 0, usuario="postgres")
checar("SQL 58: vê os hosts liberados só das empresas com voz", True,
       f"select string_agg(host, ',') from voz_vm.crm_hosts_permitidos where empresa_id in ({EA}, {EB})", "crm.vza-exemplo.com.br")
checar("SQL 58: vê só a base de respostas revisada", True,
       f"select count(*) from voz_vm.base_respostas where fluxo_versao_id = {FVA}", 1)
checar("SQL 58: vê o nome da empresa (variável assessoria)", True,
       f"select nome from voz_vm.empresas where id = {EA}", "Voz Acesso Alfa")

PS = (f"[{{\"empresa_id\": {EA}, \"id_chamada\": \"vza-0001\", \"fluxo_versao_id\": {FVA}, \"ordem\": 1, "
      f"\"bloco_id\": \"N1\", \"modo\": \"arvore\", \"saida_quando\": \"atendeu\"}}, "
      f"{{\"empresa_id\": {EA}, \"id_chamada\": \"vza-0001\", \"fluxo_versao_id\": {FVA}, \"ordem\": 2, "
      f"\"bloco_id\": \"N3\", \"modo\": \"cognicao\", \"intencao\": \"quero_negociar\", \"confianca_faixa\": \"alta\"}}]")
checar("SQL 58: grava os passos do fluxo", True, f"select voz_vm.gravar_fluxo_passos('{PS}')", 2)
checar("SQL 58: reenvio dos passos é upsert (empresa, id_chamada, ordem)", True,
       f"select voz_vm.gravar_fluxo_passos('{PS}')", 2)
checar("SQL 58: ... e não duplica", True,
       f"select count(*) from public.voz_fluxo_passos where empresa_id = {EA} and id_chamada = 'vza-0001'", 2, usuario="postgres")
PS_OUTRA = PS.replace(f'"fluxo_versao_id": {FVA}', f'"fluxo_versao_id": {FVB}')
PS_FALA = PS.replace('"modo"', '"fala": "oi", "modo"', 1)
checar("SQL 58: passo com versão de outra empresa é recusado", False,
       f"select voz_vm.gravar_fluxo_passos('{PS_OUTRA}')", erro="outra empresa")
checar("SQL 58: passo com coluna fora da lista é recusado", False,
       f"select voz_vm.gravar_fluxo_passos('{PS_FALA}')", erro="não grava em voz_fluxo_passos")
checar("SQL 58: passo de empresa sem voz é recusado", False,
       f"select voz_vm.gravar_fluxo_passos('[{{\"empresa_id\": {EB}, \"id_chamada\": \"vzb-0001\", \"fluxo_versao_id\": {FVB}, "
       f"\"ordem\": 1, \"bloco_id\": \"N1\", \"modo\": \"arvore\"}}]')", erro="empresa sem voz")

CC = (f"[{{\"empresa_id\": {EA}, \"conector_id\": {KA}, \"conector_versao\": 1, \"id_chamada\": \"vza-0001\", "
      f"\"id_cliente\": \"C1\", \"fluxo_versao_id\": {FVA}, \"bloco_id\": \"N3\", \"classe\": \"ok\", "
      f"\"http_status\": 200, \"latencia_ms\": 312, \"resultado_codigo\": \"ofertas_1_3\", \"ofertas_acima_alcada\": 1}}]")
checar("SQL 58: grava a chamada do conector (só códigos)", True, f"select voz_vm.gravar_crm_chamadas('{CC}')", 1)
for nome, extra in (("corpo da resposta", '"corpo": "{}"'), ("dados do CRM", '"dados": {"nome": "Ana"}'),
                    ("ofertas", '"ofertas": []')):
    cc_extra = CC.replace('"classe"', extra + ', "classe"', 1)
    checar(f"SQL 58: chamada de conector com {nome} é recusada (LGPD)", False,
           f"select voz_vm.gravar_crm_chamadas('{cc_extra}')", erro="não grava em crm_chamadas")
# troca só o conector_id (": {KA}," também casava com empresa_id ou conector_versao quando os ids coincidiam: era a
# falha intermitente, que dependia da sequência de ids deixada pelos testes anteriores)
CC_OUTRA = CC.replace(f'"conector_id": {KA},', f'"conector_id": {KB},')
checar("SQL 58: chamada de conector de outra empresa é recusada", False,
       f"select voz_vm.gravar_crm_chamadas('{CC_OUTRA}')", erro="outra empresa")
checar("SQL 58: código fora da lista é recusado pelo banco", False,
       f"select voz_vm.gravar_crm_chamadas('{CC.replace('ofertas_1_3', 'cliente_vip')}')")
checar("SQL 58: grava a chamada com a versão do fluxo e o bloco final", True,
       f"select voz_vm.gravar_chamadas('[{{\"empresa_id\": {EA}, \"id_chamada\": \"vza-0001\", \"id_cliente\": \"C1\", "
       f"\"fluxo_versao_id\": {FVA}, \"bloco_final\": \"N3\"}}]')", 1)
checar("SQL 58: ... e a chamada ficou com elas", True,
       f"select fluxo_versao_id || '|' || bloco_final from public.voz_chamadas where empresa_id = {EA} "
       f"and id_chamada = 'vza-0001' and canal = 'agente_voz'", f"{FVA}|N3", usuario="postgres")
checar("SQL 58: chamada com versão de fluxo de outra empresa é recusada", False,
       f"select voz_vm.gravar_chamadas('[{{\"empresa_id\": {EA}, \"id_chamada\": \"vza-0001\", \"id_cliente\": \"C1\", "
       f"\"fluxo_versao_id\": {FVB}}}]')", erro="outra empresa")
checar("SQL 58: não lê conectores nem versões pelo public", False, "select * from public.crm_conectores limit 1",
       erro="permission denied")
checar("SQL 58: não chama a RPC do public direto", False,
       f"select * from public.fluxo_voz_em_uso({EA}, {CA})", erro="permission denied")
checar("SQL 58: não grava passo direto na tabela", False,
       f"insert into public.voz_fluxo_passos (empresa_id, id_chamada, fluxo_versao_id, ordem, bloco_id, modo) "
       f"values ({EA}, 'vza-0003', {FVA}, 1, 'N1', 'arvore')")

# geração por IA: pega o pedido, devolve o resultado e limpa anexos vencidos (só os que o banco liberou)
def _bilhete(op, bucket, caminho):
    return f"select voz_vm.bilhete_arquivo('{op}', '{bucket}', '{caminho}') ~ '^[0-9a-f]{{64}}$'"


PDA = _sv(f"insert into public.voz_fluxo_pedidos (empresa_id, credor_id, texto, tipo, pedido_em) values ({EA}, {CA}, "
          f"'Quero um fluxo que confirme a identidade e ofereça parcelas.', 'ia', '2000-01-01') returning id")
ANX = "chamados/vza-alfa/Pedido Fluxo.pdf"
PDV = _sv(f"insert into public.voz_fluxo_pedidos (empresa_id, texto, tipo, situacao, anexos, atualizado_em) values ({EA}, "
          f"'Pedido antigo cancelado, com anexo.', 'ia', 'cancelado', array['{ANX}'], now() - interval '40 days') returning id")
PDN = _sv(f"insert into public.voz_fluxo_pedidos (empresa_id, texto, tipo, situacao, anexos) values ({EA}, "
          f"'Pedido recente cancelado, com anexo.', 'ia', 'cancelado', array['entradas/vza-alfa/fluxo/novo.pdf']) returning id")
checar("SQL 58 · geração: pega o pedido mais antigo da fila", True,
       "select r ->> 'pedido' from voz_vm.pegar_pedido_fluxo('{}') r", PDA)
checar("SQL 58 · geração: devolve o resultado sem definição (o pedido fica com_erros)", True,
       f"select coalesce(voz_vm.registrar_geracao_fluxo('{{\"pedido\": {PDA}, \"definicao\": null, "
       f"\"resultado\": {{\"erros\": [\"falha_na_geracao\"], \"tentativas\": 0}}}}')::text, 'nulo')", "nulo")
checar("SQL 58 · geração: ... e o pedido ficou com_erros", True,
       f"select situacao from public.voz_fluxo_pedidos where id = {PDA}", "com_erros", usuario="postgres")
checar("SQL 58 · geração: lista só os anexos vencidos", True,
       f"select string_agg(r ->> 'pedido_id', ',') from jsonb_array_elements(voz_vm.anexos_fluxo_vencidos('{{}}')) r "
       f"where (r ->> 'pedido_id')::bigint in ({PDV}, {PDN})", PDV)
checar("SQL 58 · geração: bilhete para apagar o anexo vencido", True, _bilhete("apagar", "chamados", ANX.split("/", 1)[1]), "t")
checar("SQL 58 · geração: sem bilhete para anexo que ainda vale", False,
       "select voz_vm.bilhete_arquivo('apagar', 'entradas', 'vza-alfa/fluxo/novo.pdf')", erro="não permitido")
checar("SQL 58 · geração: sem bilhete para baixar nem enviar anexo", False,
       f"select voz_vm.bilhete_arquivo('enviar', 'chamados', '{ANX.split('/', 1)[1]}')", erro="não permitido")
checar("SQL 58 · geração: marca os anexos apagados", True,
       f"select voz_vm.marcar_anexos_apagados('{{\"pedido\": {PDV}}}'); select count(*) from jsonb_array_elements("
       f"voz_vm.anexos_fluxo_vencidos('{{}}')) r where (r ->> 'pedido_id')::bigint = {PDV}", 0)
checar("SQL 58 · geração: anexo marcado não ganha mais bilhete", False,
       _bilhete("apagar", "chamados", ANX.split("/", 1)[1]), erro="não permitido")
checar("SQL 58 · geração: não chama a RPC do public direto", False, "select public.pegar_pedido_fluxo_voz()",
       erro="permission denied")
checar("SQL 58 · geração: outro login (não a VM nem o servidor) não pega pedido", False,
       "select public.pegar_pedido_fluxo_voz()", usuario="postgres", erro="servidor")

# ------------------------------------------------------------------ SQL 59 · roleplay pelo acesso próprio (voz_vm)
PRA = _sv("select id from public.roleplay_personas where empresa_id is null and codigo = 'nao_me_ligue'")
RLA = _sv(f"insert into public.roleplay_lotes (empresa_id, fluxo_versao_id, personas, quantidade, pedido_em) "
          f"values ({EA}, {FVA}, array[{PRA}]::bigint[], 2, '2000-01-01') returning id")
checar("SQL 59: pega o lote do roleplay (sem credencial dos conectores)", True,
       "select (x ->> 'lote') || '|' || jsonb_array_length(x -> 'personas') || '|' || "
       "(select count(*) from jsonb_array_elements(x -> 'conectores') c where c ? 'segredo_ref') "
       "from (select voz_vm.pegar_roleplay('{}') x) y", f"{RLA}|1|0")
_RC = ("select voz_vm.registrar_roleplay_conversa('{{\"lote\": {l}, \"persona\": {p}, \"rodada\": {r}, "
       "\"resultado\": \"opt_out\", \"passou\": true, \"caminho\": [\"N1\"], \"travas\": {t}, \"intencoes\": [], "
       "\"fechou_acordo\": false, \"oferta_id\": null, \"oferta_parcelas\": null, \"turnos\": 3, \"tokens\": 900, "
       "\"transcricao\": {x}}}') is not null")
checar("SQL 59: grava a conversa do roleplay", True,
       _RC.format(l=RLA, p=PRA, r=1, t='[\"nao_me_ligue\"]', x='[{\"quem\": \"pessoa\", \"texto\": \"Não me ligue.\"}]'), "t")
checar("SQL 59: conversa sem transcrição", True, _RC.format(l=RLA, p=PRA, r=2, t="[]", x="null"), "t")
checar("SQL 59: trava fora da lista é recusada pelo banco", False, _RC.format(l=RLA, p=PRA, r=3, t='[\"cpf\"]', x="null"))
checar("SQL 59: transcrição com CPF é recusada pelo banco", False,
       _RC.format(l=RLA, p=PRA, r=3, t="[]", x='[{\"quem\": \"pessoa\", \"texto\": \"cpf 12345678901\"}]'))
checar("SQL 59: persona fora do lote é recusada", False, _RC.format(l=RLA, p=0, r=3, t="[]", x="null"), erro="fora do roleplay")
checar("SQL 59: conclui o lote e lança os tokens no item ia_roleplay", True,
       f"select voz_vm.concluir_roleplay_lote('{{\"lote\": {RLA}, \"tokens\": 1800, \"situacao\": \"concluido\"}}') is null", "t")
checar("SQL 59: ... o lote ficou concluído, com as conversas e os tokens", True,
       f"select l.situacao || '|' || l.conversas || '|' || l.tokens || '|' || (select quantidade from public.consumo_mensageria c "
       f"where c.empresa_id = {EA} and c.item = 'ia_roleplay') from public.roleplay_lotes l where l.id = {RLA}",
       "concluido|2|1800|2", usuario="postgres")
checar("SQL 61: os tokens do roleplay pelo voz_vm entram no custo real (consumo_ia)", True,
       f"select tokens || '|' || quantidade from public.consumo_ia where empresa_id = {EA} and item = 'ia_roleplay'",
       "1800|1.8000", usuario="postgres")
PDT = _sv(f"insert into public.voz_fluxo_pedidos (empresa_id, texto, tipo, situacao) values ({EA}, "
          f"'Pedido para conferir os tokens da geração.', 'ia', 'gerando') returning id")
checar("SQL 61: a geração pelo voz_vm manda os tokens só para o custo real", True,
       f"select coalesce(voz_vm.registrar_geracao_fluxo('{{\"pedido\": {PDT}, \"definicao\": null, \"resultado\": "
       f"{{\"erros\": [\"resposta_fora_do_esquema\"], \"tentativas\": 2, \"tokens_ia\": 12000}}}}')::text, 'nulo')", "nulo")
checar("SQL 61: ... os tokens ficam no consumo_ia e fora do pedido (que o cliente lê)", True,
       f"select (select tokens from public.consumo_ia where empresa_id = {EA} and item = 'ia_geracao_fluxo') || '|' || "
       f"(resultado ? 'tokens_ia') from public.voz_fluxo_pedidos where id = {PDT}", "12000|false", usuario="postgres")
checar("SQL 61: a VM não registra consumo de IA direto", False,
       f"select public.registrar_consumo_ia({EA}, 'ia_roleplay', 1)", erro="permission denied")
checar("SQL 59: lote concluído não conclui de novo", False,
       f"select voz_vm.concluir_roleplay_lote('{{\"lote\": {RLA}, \"tokens\": 5}}')", erro="não está rodando")
checar("SQL 59: não chama a RPC do public direto", False, "select public.pegar_roleplay_voz()", erro="permission denied")
checar("SQL 59: outro login (não a VM nem o servidor) não pega roleplay", False, "select public.pegar_roleplay_voz()",
       usuario="postgres", erro="servidor")
for t in ("roleplay_lotes", "roleplay_conversas", "roleplay_personas"):
    checar(f"SQL 59: não lê public.{t}", False, f"select * from public.{t} limit 1", erro="permission denied")

# ------------------------------------------------------------------ SQL 60 · Speech Analytics pelo acesso próprio (voz_vm)
GVA = _sv(f"select id from public.voz_gravacoes where empresa_id = {EA} order by id limit 1")
COM_VETOR = _sv("select count(*) from information_schema.columns where table_schema = 'public' "
                "and table_name = 'voz_trechos' and column_name = 'embedding'") == "1"
VET = "[" + ",".join(["0.01"] * 1536) + "]"
_TR = ("[{{\"empresa_id\": {e}, \"credor_id\": {c}, \"gravacao_id\": {g}, \"origem\": \"ia\", \"inicio_s\": {i}, "
       "\"fim_s\": {f}, \"falante\": \"cliente\", \"texto_redigido\": \"{t}\"{x}}}]")
_vet = (', \"embedding\": \"' + VET + '\"') if COM_VETOR else ""
checar("SQL 60: grava trecho mascarado" + (" com embedding" if COM_VETOR else " (sem pgvector: sem embedding)"), True,
       "select voz_vm.gravar_trechos('" + _TR.format(e=EA, c=CA, g=GVA, i=0, f=20, t="Vou pagar na sexta, pode ser?", x=_vet)
       + "')", 1)
checar("SQL 60: reenvio do trecho é upsert (gravação, início, falante)", True,
       "select voz_vm.gravar_trechos('" + _TR.format(e=EA, c=CA, g=GVA, i=0, f=21, t="Vou pagar na sexta, pode ser?", x="")
       + "')", 1)
checar("SQL 60: ... e não duplica (o embedding fica)", True,
       f"select count(*) || '|' || bool_and(fim_s = 21) || '|' || "
       + ("bool_and(embedding is not null)" if COM_VETOR else "true")
       + f" from public.voz_trechos where gravacao_id = {GVA}", "1|true|true", usuario="postgres")
checar("SQL 60: trecho de empresa sem voz é recusado", False,
       "select voz_vm.gravar_trechos('" + _TR.format(e=EB, c=CB, g=GVA, i=30, f=40, t="Texto qualquer.", x="") + "')",
       erro="empresa sem voz")
checar("SQL 60: trecho com carteira de outra empresa é recusado", False,
       "select voz_vm.gravar_trechos('" + _TR.format(e=EA, c=CB, g=GVA, i=30, f=40, t="Texto qualquer.", x="") + "')",
       erro="outra empresa")
checar("SQL 60: trecho com coluna fora da lista é recusado", False,
       "select voz_vm.gravar_trechos('" + _TR.format(e=EA, c=CA, g=GVA, i=30, f=40, t="Texto qualquer.",
                                                     x=', \"id_cliente\": \"C1\"') + "')", erro="não grava em voz_trechos")
checar("SQL 60: trecho sem máscara (CPF) é recusado pelo banco", False,
       "select voz_vm.gravar_trechos('" + _TR.format(e=EA, c=CA, g=GVA, i=30, f=40, t="Meu CPF é 123.456.789-09", x="") + "')")
_CU = (f"[{{\"empresa_id\": {EA}, \"tipo\": \"intencao\", \"gravacao_id\": {GVA}, \"avaliacao_id\": null, "
       f"\"trecho_redigido\": \"Acho que dá para pagar.\", \"decisao_ia\": {{\"valor\": \"quero_negociar\"}}, "
       f"\"opcoes\": [\"quero_negociar\", \"ja_paguei\"], \"confianca\": 0.41@X@}}]")
checar("SQL 60: põe item na fila da curadoria (nasce aberto)", True,
       "select voz_vm.gravar_curadoria('" + _CU.replace("@X@", "") + "')", 1)
checar("SQL 60: ... aberto, para uma pessoa decidir", True,
       f"select situacao from public.voz_curadoria_itens where empresa_id = {EA} and gravacao_id = {GVA}", "aberto",
       usuario="postgres")
checar("SQL 60: a VM não decide a curadoria (situacao fora da lista)", False,
       "select voz_vm.gravar_curadoria('" + _CU.replace("@X@", ', \"situacao\": \"confirmado\"') + "')",
       erro="não grava em voz_curadoria_itens")
checar("SQL 60: curadoria com gravação de outra empresa é recusada", False,
       "select voz_vm.gravar_curadoria('" + _CU.replace("@X@", "")
       .replace(f'\"gravacao_id\": {GVA}', '\"gravacao_id\": 0') + "')", erro="outra empresa")
BUA = _sv(f"insert into public.voz_buscas (empresa_id, usuario, termo, modo, situacao) values ({EA}, '{EQ}', "
          f"'pagar na sexta', 'semantica', 'pendente') returning id")
checar("SQL 60: lê as buscas semânticas pendentes", True,
       f"select count(*) from jsonb_array_elements(voz_vm.buscas_voz_pendentes('{{\"limite\": 20}}')) b "
       f"where (b ->> 'id')::bigint = {BUA} and b ->> 'termo' = 'pagar na sexta'", 1)
if COM_VETOR:
    checar("SQL 60: responde a busca com o embedding da pergunta", True,
           f"select voz_vm.responder_busca_voz('{{\"busca\": {BUA}, \"emb\": \"{VET}\"}}')", 1)
    checar("SQL 60: ... a busca ficou pronta com o resultado", True,
           f"select situacao || '|' || resultados from public.voz_buscas where id = {BUA}", "pronta|1", usuario="postgres")
else:
    checar("SQL 60: sem pgvector, a resposta da busca semântica diz que está desligada", False,
           f"select voz_vm.responder_busca_voz('{{\"busca\": {BUA}, \"emb\": \"[0]\"}}')", erro="pgvector")
checar("SQL 60: registra o uso de IA (o banco calcula o custo)", True,
       f"select voz_vm.registrar_uso_ia_voz('{{\"empresa\": {EA}, \"dia\": \"2026-11-05\", \"componente\": \"avaliador\", "
       f"\"chamadas\": 1, \"minutos\": 2.5, \"minutos_cobraveis\": 2.5, \"tokens_entrada\": 1000, \"tokens_saida\": 100}}') "
       f"is not null", "t")
checar("SQL 60: ... a fatura recebe o minuto analisado", True,
       f"select quantidade from public.consumo_mensageria where empresa_id = {EA} and item = 'ia_speech_analytics'", 3,
       usuario="postgres")
checar("SQL 60: uso de IA de empresa sem voz é recusado", False,
       f"select voz_vm.registrar_uso_ia_voz('{{\"empresa\": {EB}, \"dia\": \"2026-11-05\", \"componente\": \"avaliador\", "
       f"\"chamadas\": 1, \"minutos\": 1, \"minutos_cobraveis\": 1, \"tokens_entrada\": 0, \"tokens_saida\": 0}}')",
       erro="empresa sem voz")
for t in ("voz_trechos", "voz_buscas", "voz_curadoria_itens", "voz_analise_consumo", "custos_ia_voz", "relatorios_credor"):
    checar(f"SQL 60: não lê public.{t}", False, f"select * from public.{t} limit 1", erro="permission denied")
checar("SQL 60: não chama a RPC do public direto", False, "select * from public.buscas_voz_pendentes(1)",
       erro="permission denied")
checar("SQL 60: outro login (não a VM nem o servidor) não lê as buscas pendentes", False,
       "select * from public.buscas_voz_pendentes(1)", usuario="postgres", erro="servidor")

# ------------------------------------------------------------------ SQL 62 · dados do Speech Analytics pelo acesso próprio
ONTEM_SD = _sv("select (now() at time zone 'America/Sao_Paulo')::date - 1")
_QSD = f"(('{ONTEM_SD}'::date + time '10:00') at time zone 'America/Sao_Paulo')"
CSD = _sv(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em, atendida_em, "
          f"resultado, identidade_confirmada) values ({EA}, {CA}, 'vza-0300', 'C30', 'real', {_QSD}, {_QSD}, 'promessa', true) "
          f"returning id")
GSD = _sv(f"insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, duracao_s, gravada_em) "
          f"values ({EA}, {CA}, {CSD}, 'C30', 'ia', 'cart-a/A30_vza-0300.wav', 120, {_QSD}) returning id")
VSD = _sv(f"select public.checklist_vigente({EA}, '{ONTEM_SD}')")
_REFS = f"{{\"empresa\": {EA}, \"refs\": [{{\"ref\": \"{GSD}\", \"caminho\": \"\"}}]}}"
checar("SQL 62: Speech Analytics desligado na empresa: contexto vazio", True,
       f"select voz_vm.speech_contexto('{_REFS}') ->> 'ligado'", "false")
_sv(f"update public.voz_config set speech_analytics = true where empresa_id = {EA}")
checar("SQL 62: lê o contexto da análise (gravação, versão do checklist, sem id_cliente)", True,
       f"select (c -> 'chamadas' -> 0 ->> 'gravacao_id') || '|' || (c -> 'chamadas' -> 0 ->> 'versao_id') || '|' "
       f"|| (position('C30' in c::text) = 0) from voz_vm.speech_contexto('{_REFS}') c", f"{GSD}|{VSD}|true")
checar("SQL 62: contexto de empresa sem voz é recusado", False,
       f"select voz_vm.speech_contexto('{{\"empresa\": {EB}, \"refs\": []}}')", erro="empresa sem voz")
_AN = {"empresa_id": int(EA), "gravacao_id": int(GSD), "situacao": "ok", "versao": "speech-v1", "minutos": 2,
       "uso": {"chamadas_llm": 1, "tokens_entrada": 2000, "tokens_saida": 300},
       "codigos": {"motivo": "esquecimento", "riscos": ["procon"]},
       "audio": {"fala_agente_s": 50, "fala_cliente_s": 40, "silencio_s": 30, "interrupcoes": 1},
       "sentimento": {"ini": -0.2, "fim": 0.3},
       "avaliacao": {"versao_id": int(VSD), "nota": 100, "itens": {"ck_cpc": "sim"}, "evidencia": {"ck_cpc": [3.0, 9.5]},
                     "reprovada": False},
       "alertas": [{"tipo": "procon", "falante": "cliente", "inicio_s": 40, "trecho": "Vou reclamar no Procon."},
                   {"tipo": "vulnerabilidade", "sinal": "luto", "falante": "cliente", "inicio_s": 50}],
       "curadoria": [{"tipo": "intencao", "trecho_redigido": "Talvez eu pague.", "decisao_ia": {"valor": "quero_negociar"},
                      "opcoes": ["quero_negociar", "sem_dinheiro"], "confianca": 0.4}]}


def _an(**m):
    return "'" + json.dumps({"analise": {**_AN, **m}}).replace("'", "''") + "'"


checar("SQL 62: grava a análise pelo acesso próprio (avaliação, alertas, curadoria e uso numa transação)", True,
       f"select voz_vm.gravar_analise_voz({_an()}) ->> 'situacao'", "ok")
checar("SQL 62: ... avaliação, códigos, alertas e minuto cobrado", True,
       f"select (select nota from public.voz_avaliacoes where chamada_id = {CSD}) || '|' || "
       f"(select codigos ->> 'motivo' from public.voz_chamadas where id = {CSD}) || '|' || "
       f"(select count(*) from public.voz_alertas where chamada_id = {CSD}) || '|' || "
       f"(select count(*) from public.voz_curadoria_itens where chamada_id = {CSD}) || '|' || "
       f"(select minutos_cobrados from public.voz_analise_consumo where empresa_id = {EA} and componente = 'avaliador' "
       f"and dia = (now() at time zone 'America/Sao_Paulo')::date)",
       "100.00|esquecimento|2|1|2.00", usuario="postgres")
checar("SQL 62: reenvio não cobra de novo", True, f"select voz_vm.gravar_analise_voz({_an()}) ->> 'situacao'", "ja_analisada")
checar("SQL 62: análise de empresa sem voz é recusada", False,
       f"select voz_vm.gravar_analise_voz({_an(empresa_id=int(EB))})", erro="empresa sem voz")
checar("SQL 62: gravação de outra empresa é recusada", False,
       f"select voz_vm.gravar_analise_voz({_an(gravacao_id=0)})", erro="não encontrada")
checar("SQL 62: código fora da lista é recusado", False,
       f"select voz_vm.gravar_analise_voz({_an(codigos={'motivo': 'doenca'})})")
checar("SQL 62: agrega o dia pelo acesso próprio", True,
       f"select (voz_vm.agregar_speech_dia('{{\"empresa\": {EA}, \"dia\": \"{ONTEM_SD}\"}}') ->> 'conversao')::int > 0", "t")
checar("SQL 62: ... o agregado do dia está no banco", True,
       f"select conversas || '|' || com_acordo from public.voz_conversao_dia where empresa_id = {EA} and data = '{ONTEM_SD}' "
       f"and dimensao = 'total'", "1|1", usuario="postgres")
checar("SQL 62: agregar empresa sem voz é recusado", False,
       f"select voz_vm.agregar_speech_dia('{{\"empresa\": {EB}, \"dia\": \"{ONTEM_SD}\"}}')", erro="empresa sem voz")
checar("SQL 62: lista as empresas ligadas (com voz)", True,
       f"select voz_vm.speech_empresas('{{\"parte\": \"1/1\"}}') @> '[{EA}]'", "t")
checar("SQL 62: lê os agregados da retroalimentação (com a renitência)", True,
       f"select jsonb_typeof(d -> 'renitencia') || '|' || (jsonb_array_length(d -> 'conversao') > 0) from "
       f"voz_vm.dados_retroalimentacao('{{\"empresa\": {EA}, \"de\": \"{ONTEM_SD}\", \"ate\": \"{ONTEM_SD}\"}}') d", "array|true")
_RV = (f"{{\"empresa\": {EA}, \"credor\": @C@, \"destino\": \"regua\", \"regra\": \"horario\", \"chave\": \"regua:horario:vza\", "
       f"\"titulo\": \"Ligar de manhã (teste)\", \"texto\": \"\", \"evidencia\": {{\"n_a\": 300, \"n_b\": 300, \"pct_a\": 30, "
       f"\"pct_b\": 20}}, \"proposta\": {{}}}}")
checar("SQL 62: registra recomendação pelo acesso próprio", True,
       f"select voz_vm.registrar_recomendacao_voz('{_RV.replace('@C@', str(CA))}') is not null", "t")
checar("SQL 62: recomendação com carteira de outra empresa é recusada", False,
       f"select voz_vm.registrar_recomendacao_voz('{_RV.replace('@C@', str(CB))}')", erro="outra empresa")
checar("SQL 62: confere os rascunhos e lê as aplicadas", True,
       "select jsonb_typeof(voz_vm.conferir_rascunhos_recomendacoes('{}')) || '|' || "
       f"jsonb_typeof(voz_vm.recomendacoes_aplicadas('{{\"empresa\": {EA}}}'))", "number|array")
RECB = _sv(f"insert into public.recomendacoes (empresa_id, destino, regra, chave, titulo, evidencia, situacao, aplicada_em) "
           f"values ({EB}, 'regua', 'horario', 'regua:horario:vzb', 'Recomendação da B (teste)', "
           f"'{{\"n_a\": 300, \"n_b\": 300, \"pct_a\": 30, \"pct_b\": 20}}', 'aplicada', now() - interval '40 days') returning id")
checar("SQL 62: impacto de recomendação de empresa sem voz é recusado", False,
       f"select voz_vm.gravar_impacto('{{\"rec\": {RECB}, \"metrica\": \"acordo_pct\", \"antes\": 20, \"depois\": 30, "
       f"\"n_antes\": 100, \"n_depois\": 100}}')", erro="empresa sem voz")
checar("SQL 62: o sino dos alertas pelo acesso próprio", True, "select jsonb_typeof(voz_vm.avisar_alertas('{}'))", "number")
checar("SQL 62: não lê public.voz_analise_chamadas", False, "select * from public.voz_analise_chamadas limit 1",
       erro="permission denied")
checar("SQL 62: não chama a RPC do public direto", False, f"select public.agregar_speech_dia({EA}, current_date)",
       erro="permission denied")
checar("SQL 62: outro login (não a VM nem o servidor) não grava a análise", False,
       f"select public.gravar_analise_voz('{{}}')", usuario="postgres", erro="só o servidor")

# ------------------------------------------------------------------ não pode: nada fora da voz
for t in ("estado_cliente", "trilha", "fila_dia", "perfis", "empresas", "credores", "faturas", "envios", "api_tokens",
          "voz_config", "voz_chamadas", "voz_gravacoes", "consumo_voz", "crm_conectores", "crm_hosts_permitidos",
          "crm_chamadas", "voz_fluxos", "voz_fluxo_versoes", "voz_fluxo_passos", "voz_alcada_carteira",
          "voz_base_respostas", "voz_fluxo_pedidos"):
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
                      hora=time(11, 0), id_chamada="vza-0101", billsec=20, tech_prefix="4321", credor_id=int(CA),
                      modo="teste")   # simulado não entra no consumo_voz (como consolidar_consumo_voz)
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

    # SQL 58 · o executor do fluxo e a geração pela mesma interface (voz/fluxo.py, voz/registro.py, voz/gerar_fluxo.py)
    from types import SimpleNamespace
    from voz import fluxo as FX
    from voz import gerar_fluxo as GF
    fl = FX.CarregadorFluxos(sb)(SimpleNamespace(empresa_id=int(EA), credor_id=int(CA)))
    caso("VM: carrega o fluxo em uso (versão, conector ativo com segredo_ref, hosts, alçada, base revisada)",
         fl is not None and fl.versao_id == int(FVA) and list(fl.conectores) == [int(KA)]
         and fl.conectores[int(KA)].segredo_ref == "voz/crm/vza" and fl.hosts == ("crm.vza-exemplo.com.br",)
         and fl.alcada is not None and fl.alcada.parcelas_max == 6 and sum(len(x) for x in fl.base.values()) == 1, fl)
    caso("VM: empresa sem voz fica sem fluxo (cai no roteiro)",
         FX.CarregadorFluxos(sb)(SimpleNamespace(empresa_id=int(EB), credor_id=int(CB))) is None)
    regf = RegistroBanco(sb)
    ef = EventoChamada(empresa_id=int(EA), id_cliente="C3", numero_discado="11988887771", data=date(2026, 11, 5),
                       hora=time(11, 5), id_chamada="vza-0102", billsec=40, tech_prefix="4321", credor_id=int(CA),
                       modo="teste", fluxo_versao_id=int(FVA), bloco_final="N3")
    regf.registrar(ef)
    regf.registrar_fluxo(int(EA), "vza-0102", "passo", {"fluxo_versao_id": int(FVA), "ordem": 1, "bloco_id": "N1",
                                                        "modo": "arvore", "saida_quando": "atendeu"})
    regf.registrar_fluxo(int(EA), "vza-0102", "conector", {"conector_id": int(KA), "conector_versao": 1, "bloco_id": "N3",
                                                           "classe": "tempo", "latencia_ms": 2500, "tentativa": 1,
                                                           "resultado_codigo": "falhou", "fluxo_versao_id": int(FVA),
                                                           "id_cliente": "C3"})
    caso("VM: grava chamada, passo e conector do fluxo pelo acesso próprio",
         regf.descarregar() == 1 and regf.erros == 0 and not regf.fila_passos and not regf.fila_conectores, regf.erros)
    caso("VM: ... e as linhas estão no banco",
         servidor.run("select (select fluxo_versao_id || '|' || bloco_final from public.voz_chamadas where id_chamada = 'vza-0102') "
                      "|| '|' || (select count(*) from public.voz_fluxo_passos where id_chamada = 'vza-0102') "
                      "|| '|' || (select classe from public.crm_chamadas where id_chamada = 'vza-0102')")[0][0]
         == f"{FVA}|N3|1|tempo")

    class SemLLM:
        def __getattr__(self, nome):
            raise RuntimeError("LLM fora")
    PDA2 = servidor.run(f"insert into public.voz_fluxo_pedidos (empresa_id, texto, tipo, pedido_em) values ({EA}, "
                        "'Outro pedido de fluxo para a geração.', 'ia', '2000-01-02') returning id")[0][0]
    caso("VM: a geração pega o pedido e devolve o resultado pelo acesso próprio", GF.processar_um(sb, SemLLM()) is True
         and servidor.run("select situacao from public.voz_fluxo_pedidos where id = :p", p=PDA2)[0][0] == "com_erros")
    anexo = "vza-alfa/Desenho do Fluxo.pdf"
    arquivos[("chamados", anexo)] = b"%PDF"
    servidor.run("insert into storage.objects (bucket_id, name) values ('chamados', :c)", c=anexo)
    PDV2 = servidor.run(f"insert into public.voz_fluxo_pedidos (empresa_id, texto, tipo, situacao, anexos, atualizado_em) "
                        f"values ({EA}, 'Pedido antigo com anexo para apagar.', 'ia', 'cancelado', array['chamados/{anexo}'], "
                        "now() - interval '45 days') returning id")[0][0]
    caso("VM: a geração apaga o anexo vencido (bilhete + Edge Function) e marca o pedido",
         GF.limpar_anexos(sb) >= 1 and ("chamados", anexo) not in arquivos
         and servidor.run("select cardinality(anexos) || '|' || (anexos_apagados_em is not null) "
                          "from public.voz_fluxo_pedidos where id = :p", p=PDV2)[0][0] == "0|true")
    # SQL 59 · o trabalhador do roleplay (várias threads gravando pela mesma conexão)
    from voz import roleplay as RP
    from voz.provedores.montagem import Resposta as RespostaLLM

    class LLMFixo:
        def responder(self, msgs, ferr):
            return RespostaLLM("Não me ligue mais.", tokens=10)
    RLB = servidor.run(f"insert into public.roleplay_lotes (empresa_id, fluxo_versao_id, personas, quantidade, pedido_em) "
                       f"values ({EA}, {FVA}, array[{PRA}]::bigint[], 4, '2000-01-02') returning id")[0][0]
    caso("VM: o trabalhador do roleplay roda o lote pelo acesso próprio",
         RP.processar_um(sb, LLMFixo, LLMFixo, concorrencia=4) is True
         and servidor.run("select situacao || '|' || conversas from public.roleplay_lotes where id = :l", l=RLB)[0][0]
         == "concluido|4")
    # SQL 60 · as peças do Speech Analytics da VM (voz/analise) pela mesma interface
    from voz.analise import curadoria as CU
    from voz.analise import trechos as TRC

    class EmbFixo(TRC.Embedder):
        def vetores(self, textos):
            return [[0.02] * 1536 for _ in textos]
    gv = {"id": int(GVA), "empresa_id": int(EA), "credor_id": int(CA), "origem": "ia"}
    caso("VM: grava os trechos mascarados pelo acesso próprio",
         TRC.gravar(sb, gv, [TRC.Janela(40, 60, "agente", "Posso te ajudar com o boleto."),
                             TRC.Janela(60, 80, "cliente", "Pode mandar por mensagem.")], EmbFixo(), com_vetor=COM_VETOR) == 2
         and servidor.run("select count(*) from public.voz_trechos where gravacao_id = :g and inicio_s >= 40", g=int(GVA))[0][0] == 2)
    caso("VM: põe a fila da curadoria pelo acesso próprio", CU.enfileirar(sb, CU.itens_da_chamada(
        {"empresa_id": int(EA), "gravacao_id": int(GVA)},
        {"intencoes": [{"intencao": "quero_negociar", "confianca": 0.3, "trecho": "Talvez dê.", "alternativas": ["ja_paguei"]}]})) == 1)
    BUB = servidor.run(f"insert into public.voz_buscas (empresa_id, usuario, termo, modo, situacao) values ({EA}, '{EQ}', "
                       "'boleto por mensagem', 'semantica', 'pendente') returning id")[0][0]
    n_buscas = TRC.atender_buscas(sb, EmbFixo())
    caso("VM: atende a busca semântica pelo acesso próprio" if COM_VETOR else "VM: sem pgvector a busca falha sozinha",
         (n_buscas >= 1 and servidor.run("select situacao from public.voz_buscas where id = :b", b=BUB)[0][0] == "pronta")
         if COM_VETOR else n_buscas == 0)
    caso("VM: registra o uso de IA pelo acesso próprio",
         TRC.registrar_uso(sb, int(EA), "2026-11-05", "embeddings", 1, 1.0, 0, 500, 0) is not None)
    # SQL 62 · as rotinas do Speech Analytics (avaliador + extrator e job noturno) pela mesma interface
    from datetime import timedelta
    from voz.analise import analisador as AN
    from voz.analise import rotina as RT

    class LLMSpeech:
        def responder(self, msgs, ferr):
            props = ferr[0]["function"]["parameters"]["properties"]
            itens = [{"id": i, "resposta": "sim", "confianca": 0.9, "segmento": 0}
                     for i in props["itens"]["items"]["properties"]["id"]["enum"]]
            return RespostaLLM("", [(AN.FERRAMENTA, {
                "itens": itens, "motivo": {"probabilidades": {"esquecimento": 0.9}, "segmento": 1}, "objecoes": [],
                "objecao_principal": None, "intencao": None, "canal_preferido": None, "horario_preferido": None,
                "vulnerabilidade": [], "riscos": [], "frases": [], "temas": [], "sentimento": None, "falantes": "AC",
                "transcricao_ruim": 0})], tokens=900, tokens_entrada=800, tokens_saida=100)
    CSD2 = servidor.run(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em, "
                        f"resultado) values ({EA}, {CA}, 'vza-0301', 'C31', 'real', {_QSD}, 'cpc') returning id")[0][0]
    GSD2 = servidor.run(f"insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, "
                        f"duracao_s, gravada_em) values ({EA}, {CA}, {CSD2}, 'C31', 'ia', 'cart-a/A31_vza-0301.wav', 60, {_QSD}) "
                        "returning id")[0][0]
    with tempfile.TemporaryDirectory() as pasta_tr:
        d_emp = Path(pasta_tr) / f"empresa_{EA}"
        d_emp.mkdir()
        (d_emp / f"{GSD2}.json").write_text(json.dumps({"duracao_s": 60, "segmentos": [
            {"inicio": 0, "fim": 4, "texto": "Bom dia, aqui é a central."}, {"inicio": 5, "fim": 9, "texto": "Esqueci de pagar."}]}))
        out_sd = RT.analisar_pendentes(sb, LLMSpeech(), RT.FonteLocal(pasta_tr))
        caso("VM: analisa a ligação transcrita pelo acesso próprio (avaliador + extrator, uma chamada ao LLM)",
             out_sd.get("ok") == 1 and (d_emp / f"{GSD2}.analise.json").exists()
             and servidor.run(f"select codigos ->> 'motivo' from public.voz_analise_chamadas where gravacao_id = {GSD2}")[0][0]
             == "esquecimento", out_sd)
    hoje_sd = date.fromisoformat(str(ONTEM_SD)) + timedelta(days=1)
    out_n = RT.noite(sb, hoje_sd, "1/1", dias=1)
    caso("VM: o job noturno agrega e roda a retroalimentação pelo acesso próprio", out_n.get("erros", 0) == 0
         and out_n.get("dias", 0) >= 1 and servidor.run(f"select sum(conversas) from public.voz_conversao_dia where empresa_id = "
                                                         f"{EA} and data = '{ONTEM_SD}' and dimensao = 'total'")[0][0] == 2, out_n)
    try:
        sb.rpc("salvar_fluxo_voz", {})
        caso("VM: RPC fora da lista é recusada no código", False, "chamou")
    except A.AcessoNegado:
        caso("VM: RPC fora da lista é recusada no código", True)
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
_senha_de_teste()

# ------------------------------------------------------------------ limpeza
_sv("delete from public.envios where caminho like 'vza-%'; delete from storage.objects where name like 'vza-%'")
_sv(f"delete from public.voz_buscas where empresa_id in ({EA}, {EB})")   # SQL 60: a busca guarda quem buscou
_sv(f"delete from auth.users where id in ('{EQ}', '{NE}')")
_sv(f"delete from voz_vm.bilhetes; delete from public.empresas where id in ({EA}, {EB})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
