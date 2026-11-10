"""SQL 89 · Perfil Qualidade: só a área Speech Analytics (RLS e RPCs), num Postgres local com as migrações aplicadas.

Cobre: a migração roda duas vezes; o padrão de permissões da Qualidade (só as do Speech) e o teto (nem o Admin libera
permissão de fora do Speech; ajuste dentro do Speech vale); a Qualidade lê o Speech da própria empresa (gravações,
avaliações, alertas, operadores, curadoria, temas, insights, checklist, recomendações, módulos, painéis e RPCs) e
registra a escuta; não lê a outra empresa; não lê nada de fora do Speech (varredura de toda tabela e view com
empresa_id, Storage e toda RPC que recebe a empresa); perfis antigos sem mudança (pode() igual ao padrão do papel,
minhas_empresas_speech() igual a minhas_empresas()); o Admin passa uma pessoa para Qualidade e ela perde a Cobrança.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_perfil_qualidade.py
Só dados fictícios (empresas q89-*, e-mails @exemplo.test, IDs CLI-xxxxx, operadores OP-xx).
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
SQL89 = RAIZ / "supabase" / "migrations" / "20270125000001_perfil_qualidade.sql"


def sql(cmd, papel=None, uid=None, todas=False):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    linhas = r.stdout.strip().splitlines()
    return r.returncode == 0, (linhas if todas else (linhas or [""])[-1]), r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor))
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 89: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 89: " + nome + ("" if cond else f"  -> {detalhe[:600]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL89)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)
# o SQL 89 recria permissoes_speech/permissoes_qualidade; as migrações posteriores (SQL 90: treino) voltam por cima,
# como em produção ("se o SQL 89 rodar de novo, rode os seguintes depois")
for posterior in sorted(p for p in SQL89.parent.glob("*.sql") if p.name > SQL89.name):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(posterior)], capture_output=True,
                       text=True)
    checar(f"a migração posterior {posterior.name[:14]} roda de novo por cima", True, f"select {r.returncode}", valor=0)

au = "authenticated"
# SQL 90: o treino de operadores (Roleplay) entra no Speech: treinar_operadores e editar_cenarios_treino
SPEECH = ["ouvir_gravacoes", "ver_transcricoes", "ver_operadores", "ver_alertas", "curadoria_voz", "editar_checklist",
          "treinar_operadores", "editar_cenarios_treino"]
PADRAO_Q = sorted(p for p in SPEECH if p != "editar_checklist")

# ---------------------------------------------------------------- empresas, carteiras e pessoas (fictícias)
T = uuid.uuid4().hex[:6]
QA = sv(f"insert into public.empresas (slug, nome) values ('q89-a-{T}', 'Q89 A {T}') returning id")
QB = sv(f"insert into public.empresas (slug, nome) values ('q89-b-{T}', 'Q89 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({QA}, 'speech_analytics', true), "
   f"({QA}, 'orquestracao', true), ({QB}, 'orquestracao', true) on conflict (empresa_id, modulo) do update set ativo = true")
sv(f"delete from public.empresa_modulos where empresa_id = {QB} and modulo = 'speech_analytics'")
NMOD_A = sv(f"select count(*) from public.empresa_modulos where empresa_id = {QA}")
NMOD_B = sv(f"select count(*) from public.empresa_modulos where empresa_id = {QB}")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({QA}, 'cartao-q', 'Cartão Q') returning id")
CB = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({QB}, 'carteira-qb', 'Carteira QB') returning id")
U = {}
for p, papel, emp in (("qa", "qualidade", QA), ("qb", "qualidade", QB), ("adm", "admin", QA), ("ges", "gestao", QA),
                      ("ope", "operacao", QA), ("pla", "planejamento", QA), ("vira", "operacao", QA)):
    U[p] = sv(f"insert into auth.users (email) values ('q89.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
U["eq"] = sv(f"insert into auth.users (email) values ('q89.eq.{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['eq']}'")
Q, QQB, A, G, O, P = U["qa"], U["qb"], U["adm"], U["ges"], U["ope"], U["pla"]

# ---------------------------------------------------------------- dados do Speech nas duas empresas (o servidor grava)


def cham(emp, credor, idc, cli):
    return sv(f"set role service_role; insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, "
              f"ocorrido_em) values ({emp}, {credor}, '{idc}-{T}', '{cli}', 'real', now() - interval '2 days') returning id")


def grav(emp, credor, ch, cli, origem="discador", op="OP-31"):
    return sv(f"set role service_role; insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, "
              f"caminho, operador_ref) values ({emp}, {credor}, {ch}, '{cli}', '{origem}', 'q89/{T}/{ch}.mp3', '{op}') returning id")


CHA = cham(QA, CA, "LG-89001", "CLI-89001")
GA = grav(QA, CA, CHA, "CLI-89001")
CHB = cham(QB, CB, "LG-89002", "CLI-89002")
GB = grav(QB, CB, CHB, "CLI-89002")
VPAD = sv("select v.id from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id "
          "where c.empresa_id is null and v.situacao = 'em_uso' order by v.id limit 1")
TR = j('Operador: "Bom dia, é o [NOME]? O débito está em R$ 2.380,00…"')
for emp, credor, ch, g in ((QA, CA, CHA, GA), (QB, CB, CHB, GB)):
    sv(f"set role service_role; insert into public.voz_avaliacoes (empresa_id, credor_id, chamada_id, gravacao_id, versao_id, "
       f"origem, operador_ref, nota, itens, reprovada, item_reprovado, trecho_redigido) values ({emp}, {credor}, {ch}, {g}, "
       f"{VPAD}, 'discador', 'OP-31', 62, '{{\"ck_cpc\": \"nao\"}}', true, 'ck_cpc', {TR})")
    sv(f"set role service_role; insert into public.voz_alertas (empresa_id, credor_id, chamada_id, gravacao_id, id_cliente, "
       f"tipo, falante, trecho_redigido) values ({emp}, {credor}, {ch}, {g}, 'CLI-89001', 'procon', 'cliente', "
       f"'Cliente: \"Vou abrir reclamação no Procon.\"')")
    sv(f"set role service_role; insert into public.voz_qualidade_dia (empresa_id, credor_id, data, origem, persona, "
       f"operador_ref, item, avaliadas, aprovadas, nota_soma) values ({emp}, {credor}, current_date - 3, 'discador', '', "
       f"'OP-31', '_ligacao', 40, 35, 3520)")
    sv(f"set role service_role; insert into public.voz_insights_dia (empresa_id, credor_id, data, origem, campo, valor, qtd) "
       f"values ({emp}, {credor}, current_date - 3, 'discador', 'motivo', 'esquecimento', 40)")
    sv(f"set role service_role; insert into public.voz_operadores (empresa_id, discador, operador_ref, apelido) "
       f"values ({emp}, 'olos', 'OP-31', 'Nando')")
    TEMA = sv(f"set role service_role; insert into public.voz_temas (empresa_id) values ({emp}) returning id")
    sv(f"set role service_role; insert into public.voz_curadoria_itens (empresa_id, tipo, tema_id, decisao_ia) "
       f"values ({emp}, 'tema', {TEMA}, '{{\"valor\": \"\"}}')")
    sv(f"set role service_role; insert into public.recomendacoes (empresa_id, credor_id, destino, regra, chave, titulo, "
       f"evidencia, situacao) values ({emp}, {credor}, 'regua', 'horario', 'regua:horario:q89', 'Ligar de manhã, teste', "
       f"'{{\"n_a\": 300, \"n_b\": 300, \"pct_a\": 30, \"pct_b\": 20}}', 'rascunho')")
# fora do Speech, na empresa A: cliente, lista do dia, trilha, acesso de download (dados que a Cobrança lê)
sv(f"set role service_role; insert into public.estado_cliente (empresa_id, id_cliente, tag, safra, cluster_origem, "
   f"cluster_atual, estado, canal) values ({QA}, 'C89', 'S260801-A1-CPA-WA-T1', '2026-08-01', 'A1', 'A1', 'CPA', 'WA')")
sv(f"set role service_role; insert into public.fila_dia (empresa_id, data, canal, id_cliente, reserva, regua, passo, tag) "
   f"values ({QA}, current_date, 'whatsapp', 'C89', false, 'cpc', 'T1', 'x')")
sv(f"insert into public.acessos (usuario, acao, alvo, empresa_id) values ('{A}', 'download', 'q89', {QA})")

# ---------------------------------------------------------------- permissões
checar(f"Qualidade tem por padrão só as {len(PADRAO_Q)} permissões do Speech", True,
       "select string_agg(p, ',' order by p) from public.minhas_permissoes() p", au, Q, ",".join(PADRAO_Q))
checar("permissao_padrao('qualidade') = permissoes_qualidade()", True,
       "select string_agg(c.codigo, ',' order by c.codigo) from public.permissoes_catalogo c "
       "where public.permissao_padrao('qualidade', c.codigo)", None, None, ",".join(PADRAO_Q))
checar("editar_checklist fica com o Admin (a Qualidade não tem por padrão)", True, "select public.pode('editar_checklist')", au, Q, "f")
checar("Admin libera editar_checklist para a Qualidade (dentro do Speech)", True,
       f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({QA}, 'qualidade', "
       f"'editar_checklist', true); select 1", au, A, 1)
checar("com o ajuste, a Qualidade edita o checklist", True, "select public.pode('editar_checklist')", au, Q, "t")
checar("Admin não libera permissão de fora do Speech para o perfil Qualidade", False,
       f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({QA}, 'qualidade', "
       f"'baixar_listas', true)", au, A)
checar("Admin não libera permissão de fora do Speech para uma pessoa Qualidade", False,
       f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{Q}', 'ver_clientes', true)", au, A)
checar("nem pelo servidor (o banco recusa)", False,
       f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{Q}', 'ver_clientes', true)",
       "service_role")
checar("Admin pode tirar uma permissão do Speech da Qualidade", True,
       f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{Q}', 'curadoria_voz', false); "
       f"delete from public.permissoes_usuario where usuario_id = '{Q}' and permissao = 'curadoria_voz'; select 1", au, A, 1)
# acesso antigo que sobra quando a pessoa vira Qualidade: o teto do pode() vale
sv(f"insert into public.permissoes_usuario (usuario_id, permissao, permitido) values ('{U['vira']}', 'baixar_listas', true), "
   f"('{U['vira']}', 'enviar_arquivos', true)")
checar("antes de virar Qualidade, a pessoa vê a Lista do dia", True,
       f"select count(*) from public.fila_dia where empresa_id = {QA}", au, U["vira"], 1)
checar("Admin da empresa passa a pessoa para Qualidade", True,
       f"update public.perfis set papel = 'qualidade' where id = '{U['vira']}'; select 1", au, A, 1)
checar("acesso antigo de fora do Speech não vale mais (pode = não)", True,
       "select public.pode('baixar_listas') or public.pode('enviar_arquivos')", au, U["vira"], "f")
checar("permissoes_do_usuario mostra o acesso antigo como não", True,
       f"select count(*) from public.permissoes_do_usuario('{U['vira']}') where permitido and not (codigo = any (public.permissoes_speech()))",
       au, A, 0)
checar("permissoes_do_papel('qualidade') só tem o Speech", True,
       f"select count(*) from public.permissoes_do_papel('qualidade', {QA}) where permitido and not (codigo = any (public.permissoes_speech()))",
       au, A, 0)
checar("depois de virar Qualidade, a pessoa não vê mais a Lista do dia", True,
       f"select count(*) from public.fila_dia", au, U["vira"], 0)
sql(f"update public.perfis set papel = 'admin' where id = '{Q}'", au, Q)
sql(f"update public.perfis set papel = 'gestao' where id = '{O}'", au, Q)
checar("a Qualidade não muda o próprio perfil nem o de outra pessoa", True,
       f"select string_agg(papel::text, ',' order by papel::text) from public.perfis where id in ('{Q}', '{O}')", None, None,
       "operacao,qualidade")
checar("Admin vê a pessoa Qualidade na equipe", True, f"select papel from public.perfis where id = '{Q}'", au, A, "qualidade")

# ---------------------------------------------------------------- a Qualidade lê o Speech da própria empresa
checar("minhas_empresas() não devolve a empresa da Qualidade", True, "select count(*) from public.minhas_empresas()", au, Q, 0)
checar("minhas_empresas_speech() devolve só a empresa dela", True,
       "select string_agg(x::text, ',') from public.minhas_empresas_speech() x", au, Q, QA)
for t, n in (("voz_gravacoes", 1), ("voz_avaliacoes", 1), ("voz_alertas", 1), ("voz_operadores", 1), ("voz_temas", 1),
             ("voz_curadoria_itens", 1), ("voz_insights_dia", 1), ("recomendacoes", 1), ("empresa_modulos", int(NMOD_A))):
    checar(f"lê {t} da própria empresa", True, f"select count(*) from public.{t} where empresa_id = {QA}", au, Q, n)
    checar(f"não lê {t} da outra empresa", True, f"select count(*) from public.{t} where empresa_id <> {QA}", au, Q, 0)
checar("lê o checklist padrão MotorCX", True,
       "select count(*) > 0 from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id "
       "where c.empresa_id is null", au, Q, "t")
checar("lê a própria empresa (nome no topo)", True, "select string_agg(id::text, ',') from public.empresas", au, Q, QA)
checar("lê só o próprio perfil", True, "select string_agg(id::text, ',') from public.perfis", au, Q, Q)
CARTEIRAS_A = sv(f"select string_agg(codigo, ',' order by nome) from public.credores where empresa_id = {QA}")
checar("carteiras_speech: id, código e nome das carteiras da empresa", True,
       f"select string_agg(codigo, ',' order by nome) from public.carteiras_speech({QA})", au, Q, CARTEIRAS_A)
checar("carteiras_speech da outra empresa vem vazio", True, f"select count(*) from public.carteiras_speech({QB})", au, Q, 0)
checar("acesso_da_empresa (aviso de suspensão) vale para a Qualidade", True,
       f"select count(*) from public.acesso_da_empresa({QA})", au, Q, 1)
checar("painel_speech da própria empresa", True,
       f"select public.painel_speech({QA}, null, current_date - 10, current_date) ->> 'n'", au, Q, 40)
checar("qualidade_voz da própria empresa", True,
       f"select public.qualidade_voz({QA}, null, current_date - 10, current_date) is not null", au, Q, "t")
checar("operadores_voz da própria empresa", True,
       f"select jsonb_array_length(public.operadores_voz({QA}, null, current_date - 10, current_date) -> 'operadores')", au, Q, 1)
checar("operador_voz da própria empresa", True,
       f"select public.operador_voz({QA}, 'OP-31', current_date - 10, current_date) ->> 'nota'", au, Q, "88.0")
checar("reprovadas_voz da própria empresa", True,
       f"select count(*) from public.reprovadas_voz({QA}, null, current_date - 10, current_date)", au, Q, 1)
checar("alertas_voz e contagem_alertas_voz", True,
       f"select (select count(*) from public.alertas_voz({QA})) || '|' || "
       f"(public.contagem_alertas_voz({QA}, current_date - 10, current_date) is not null)", au, Q, "1|true")
AL = sv(f"select id from public.voz_alertas where empresa_id = {QA}")
checar("revisa o alerta", True, f"select public.revisar_alerta_voz({AL}, 'sem_acao'); select 1", au, Q, 1)
checar("busca nas transcrições da própria empresa", True,
       f"select (public.buscar_trechos_voz({QA}, 'boleto', 'termo')) ? 'resultados'", au, Q, "t")
AV = sv(f"select id from public.voz_avaliacoes where empresa_id = {QA}")
checar("discorda da nota (vai para a Curadoria)", True, f"select public.contestar_nota_voz({AV}) is not null", au, Q, "t")
CI = sv(f"select id from public.voz_curadoria_itens where empresa_id = {QA} and tipo = 'tema'")
checar("cura um item", True, f"select public.curar_item_voz({CI}, 'corrigir', 'Boleto não chegou') is not null", au, Q, "t")
checar("cadastra operador por ID e apelido", True,
       f"select public.salvar_operador_voz({QA}, 'olos', 'OP-32', 'Cris') is not null", au, Q, "t")
checar("registra a escuta da gravação (como a função gravacoes faz)", True,
       f"insert into public.acessos (usuario, acao, alvo, empresa_id) values ('{Q}', 'ouvir_gravacao', '{GA}', {QA}); select 1",
       au, Q, 1)
checar("não registra download (acesso de fora do Speech)", False,
       f"insert into public.acessos (usuario, acao, alvo, empresa_id) values ('{Q}', 'download', 'x', {QA})", au, Q)
checar("não registra escuta na outra empresa", False,
       f"insert into public.acessos (usuario, acao, alvo, empresa_id) values ('{Q}', 'ouvir_gravacao', '{GB}', {QB})", au, Q)
checar("Qualidade da empresa B não lê nada da A", True,
       f"select (select count(*) from public.voz_gravacoes where empresa_id = {QA}) + "
       f"(select count(*) from public.voz_avaliacoes where empresa_id = {QA}) + "
       f"(select count(*) from public.empresa_modulos where empresa_id = {QA})", au, QQB, 0)
checar("Qualidade da empresa B lê a gravação da B", True, "select count(*) from public.voz_gravacoes", au, QQB, 1)
checar("Qualidade da empresa B lê os módulos (sem o Speech: aviso de não contratado)", True,
       f"select count(*) filter (where modulo = 'speech_analytics') || '|' || count(*) from public.empresa_modulos", au, QQB, f"0|{NMOD_B}")
for f in (f"public.painel_speech({QB}, null, current_date - 10, current_date)",
          f"public.qualidade_voz({QB}, null, current_date - 10, current_date)",
          f"public.operadores_voz({QB}, null, current_date - 10, current_date)",
          f"public.alertas_voz({QB})", f"public.buscar_trechos_voz({QB}, 'boleto', 'termo')"):
    checar(f"não chama {f.split('(')[0]} da outra empresa", False, f"select {f}", au, Q)
checar("a equipe MotorCX continua sem ouvir gravação do cliente pelo site", True,
       f"select count(*) from public.voz_gravacoes where empresa_id = {QA}", au, U["eq"], 1)

# ---------------------------------------------------------------- fora do Speech: nada
for t in ("credores", "estado_cliente", "fila_dia", "trilha", "acessos", "voz_chamadas", "voz_config", "voz_lotes",
          "voz_fluxos", "voz_buscas", "faturas", "chamados", "auditoria", "permissoes_papel", "empresa_frentes",
          "relatorios_credor", "mensageria_campanhas", "canais_empresa", "estrategias"):
    checar(f"não lê {t}", True, f"select count(*) from public.{t}", au, Q, 0)
checar("não lê arquivos do Storage (listas, comitê, entradas)", True, "select count(*) from storage.objects", au, Q, 0)
for nome, cmd in (("numeros_areas (Início)", f"select count(*) from public.numeros_areas({QA})"),
                  ("pessoas_empresa (equipe)", f"select count(*) from public.pessoas_empresa({QA})"),
                  ("perfis_empresa", f"select count(*) from public.perfis_empresa({QA})"),
                  ("minhas_frentes", "select count(*) from public.minhas_frentes()"),
                  ("para_hoje", f"select count(*) from public.para_hoje({QA})"),
                  ("permissoes_do_papel", f"select count(*) from public.permissoes_do_papel('operacao', {QA})")):
    checar(f"{nome} vem vazio", True, cmd, au, Q, 0)
for nome, cmd in (("guardar gravação (só o Admin)", f"select public.guardar_gravacao({GA}, 'disputa judicial')"),
                  ("ler o registro de buscas (só o Admin)", f"select public.buscas_recentes_voz({QA})"),
                  ("estado dos canais", f"select public.estado_canais({QA})"),
                  ("situação da implantação", f"select public.implantacao_situacao({QA})"),
                  ("primeiros passos", f"select public.primeiros_passos({QA})"),
                  ("aplicar recomendação", f"select public.aplicar_recomendacao((select id from public.recomendacoes where empresa_id = {QA}))"),
                  ("abrir pedido do titular", "select public.abrir_pedido_titular('exportar', 'CLI-89001')")):
    checar(f"RPC de fora do Speech negada: {nome}", False, cmd, au, Q)
checar("pode_ver_empresa é não", True, f"select public.pode_ver_empresa({QA})", au, Q, "f")

# ---------------------------------------------------------------- varredura: toda tabela/view com empresa_id
# A Qualidade fica numa empresa com muitos dados (a que mais tem linhas, das criadas pelos outros testes) e não pode ver
# nenhuma linha fora da lista do Speech. perfis/empresas: só a própria linha.
PERMITIDAS = {"voz_gravacoes", "voz_avaliacoes", "voz_alertas", "voz_operadores", "voz_treino_exemplos", "voz_temas",
              "voz_curadoria_itens", "voz_golden_set", "voz_golden_medicoes", "voz_melhorias", "voz_insights_dia",
              "checklists_qualidade", "recomendacoes", "empresa_modulos",
              # SQL 90: treino de operadores (Roleplay), com cliente_pode(empresa, 'treinar_operadores')
              "treino_equipes", "treino_cenarios", "treino_atribuicoes", "treino_atribuicao_operadores", "treino_links",
              "treino_link_acessos", "treino_sessoes", "treino_transcricoes", "treino_feedback", "treino_feedbacks",
              "treino_revisoes", "treino_discordancias", "treino_sugestoes", "treino_uso_mes"}
tabelas = sql("select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'empresa_id' "
              "and not a.attisdropped where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') "
              "and has_table_privilege('authenticated', c.oid, 'select') order by 1", todas=True)[1]
cont = " union all ".join(f"select '{t}', count(*) from public.{t} where empresa_id = e.id" for t in tabelas if t not in ("empresas",))
EX = sv(f"select e.id from public.empresas e order by (select count(*) from ({cont}) x(t, n) where n > 0) desc, e.id limit 1")
QX = sv(f"insert into auth.users (email) values ('q89.qx.{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel = 'qualidade', empresa_id = {EX}, nome = 'Qualidade X' where id = '{QX}'")
com_dado = vazado = 0
erros = []
for t in tabelas:
    if t in PERMITIDAS:
        continue
    _, tot, _ = sql(f"select count(*) from public.{t} where empresa_id = {EX}")
    # linha com empresa nula é catálogo da MotorCX (modelos de relatório, personas padrão), igual para todos
    ok, vis, err = sql(f"select count(*) from public.{t} where empresa_id is not null", au, QX)
    esperado = "1" if t in ("perfis",) else "0"
    if tot not in ("", "0"):
        com_dado += 1
    if ok and vis != esperado:
        vazado += 1
        erros.append(f"{t}: vê {vis}")
caso(f"varredura: {len(tabelas) - len(PERMITIDAS & set(tabelas))} tabelas/views fora do Speech, nenhuma linha visível "
     f"({com_dado} com dado da empresa)", vazado == 0, "; ".join(erros))
caso("varredura tem dado de verdade (empresa com 5+ tabelas com linhas)", com_dado >= 5, f"com dado: {com_dado}")
checar("varredura: a Qualidade X vê só a própria empresa em empresas", True,
       "select string_agg(id::text, ',') from public.empresas", au, QX, EX)

# ---------------------------------------------------------------- varredura: toda RPC que recebe a empresa
# Cada função do public que o site pode chamar (authenticated) com o 1º argumento bigint chamado empresa/eid: chamada
# pela Qualidade X com a empresa dela (os outros argumentos nulos), dentro de uma transação desfeita. Fora do Speech, ou
# dá erro ou não devolve nada (nulo, vazio, false, 0). As do Speech ficam de fora (já testadas acima).
RPC_SPEECH = {"painel_speech", "qualidade_voz", "operadores_voz", "operador_voz", "reprovadas_voz", "alertas_voz",
              "contagem_alertas_voz", "buscar_trechos_voz", "buscas_recentes_voz", "salvar_operador_voz",
              "salvar_rascunho_checklist", "salvar_melhoria_voz", "carteiras_speech", "acesso_da_empresa",
              "cliente_pode", "checklist_vigente",
              # SQL 90: treino de operadores (Roleplay)
              "salvar_equipe_treino", "salvar_operador_treino", "salvar_cenario_treino", "atribuir_treino",
              "salvar_feedback_treino", "uso_treino", "treino_liberado"}
# respostas que não são dado da empresa (constantes, sim/não do próprio acesso)
INOFENSIVAS = {"", "f", "0", "[]", "{}", "null", "false", "t"}
funcs = sql("select p.proname || '|' || p.pronargs || '|' || pg_get_function_identity_arguments(p.oid) from pg_proc p "
            "where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.pronargs >= 1 "
            "and has_function_privilege('authenticated', p.oid, 'execute') and p.proargtypes[0] = 'bigint'::regtype "
            "and coalesce(p.proargnames[1], '') in ('empresa', 'eid', 'p_empresa', 'empresa_id') "
            "and p.prorettype <> 'trigger'::regtype order by 1", todas=True)[1]
testadas = 0
problemas = []


def chamar(nome, args, uid):
    ok, out, _ = sql(f"begin; select coalesce(nullif(x::text, ''), '') from (select public.{nome}({args}) x) s "
                     f"where x is not null; rollback;", au, uid, todas=True)
    return {v for v in out if v not in INOFENSIVAS and v != uid} if ok else set()


for linha in funcs:
    nome, n, _args = linha.split("|", 2)
    if nome in RPC_SPEECH or nome == "pode_ver_empresa_linha":   # esta é a policy de empresas (a própria linha)
        continue
    args = ", ".join([EX] + ["null"] * (int(n) - 1))
    testadas += 1
    vals = chamar(nome, args, QX)
    # o que qualquer pessoa de outra empresa também recebe (constante, padrão) não é dado da empresa
    if vals and vals != chamar(nome, args, QQB):
        problemas.append(f"{nome}: {sorted(vals)[0][:80]}")
caso(f"varredura: {testadas} RPCs de fora do Speech com a empresa da Qualidade, nenhuma devolve dado", not problemas,
     "; ".join(problemas))

# ---------------------------------------------------------------- perfis antigos sem mudança
for uid, papel in ((A, "admin"), (G, "gestao"), (O, "operacao"), (P, "planejamento")):
    checar(f"{papel}: pode() igual ao padrão do papel em todo o catálogo", True,
           "select count(*) from public.permissoes_catalogo c where public.pode(c.codigo) is distinct from "
           f"(case when '{papel}' = 'admin' and c.codigo in ('gerenciar_usuarios', 'gerenciar_permissoes') then true "
           f"else public.permissao_padrao('{papel}', c.codigo) end)", au, uid, 0)
    checar(f"{papel}: minhas_empresas_speech() = minhas_empresas()", True,
           "select (select array_agg(x order by x) from public.minhas_empresas() x) is not distinct from "
           "(select array_agg(x order by x) from public.minhas_empresas_speech() x)", au, uid, "t")
checar("equipe: minhas_empresas_speech() = minhas_empresas()", True,
       "select (select array_agg(x order by x) from public.minhas_empresas() x) is not distinct from "
       "(select array_agg(x order by x) from public.minhas_empresas_speech() x)", au, U["eq"], "t")
checar("Operação continua lendo carteiras, clientes e a Lista do dia", True,
       f"select (select count(*) from public.credores) || '|' || (select count(*) from public.estado_cliente) || '|' || "
       f"(select count(*) from public.fila_dia)", au, O, f"{len(CARTEIRAS_A.split(','))}|1|1")
checar("Operação continua sem o Speech de quem não tem permissão (alertas)", True,
       "select count(*) from public.voz_alertas", au, O, 0)
checar("Gestão continua lendo alertas e avaliações", True,
       "select (select count(*) from public.voz_alertas) || '|' || (select count(*) from public.voz_avaliacoes)", au, G, "1|1")
checar("Admin continua com numeros_areas (Início)", True, f"select count(*) > 0 from public.numeros_areas({QA})", au, A, "t")
checar("anon não chama minhas_empresas_speech nem carteiras_speech", False,
       f"select public.minhas_empresas_speech(); select public.carteiras_speech({QA})", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
