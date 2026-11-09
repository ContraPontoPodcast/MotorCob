"""SQL 90 · Roleplay de treinamento de operadores: o banco do treino, num Postgres local com as migrações aplicadas.

Cobre: a migração roda duas vezes; as sementes Padrão MotorCX (10, publicadas, sem dado pessoal, persona "(fictícia/o)");
permissões novas (Admin e Qualidade sim; Gestão, Operação e Planejamento não); RLS por empresa e perfil (Admin e
Qualidade veem a empresa; a outra empresa e os outros perfis não; anon não lê tabela nenhuma); operador só de treino
(sem ID do discador) sem quebrar o Speech; link pessoal (token mostrado uma vez, só o sha-256 no banco, hash fora do
alcance do site, token errado/revogado/vencido/operador inativo/módulo desligado falham, acessos registrados sem IP);
anon só pelas RPCs do token e só os treinos do próprio operador; tentativas (abandonada e falha não contam, sessão
anterior aberta vira abandonada, esgotou → precisa de apoio, +1 tentativa, aprovado); resultado, "Discordo deste
ponto", revisão e feedback 1:1; teste da Qualidade e treino lado a lado; nota de treino fora de voz_avaliacoes e
voz_qualidade_dia; retenção de 90 dias em apagar_voz_expirada (sem perder o que ela já fazia); cobrança com franquia
(custo em consumo_ia, fatura só do excedente, voz bloqueia e texto segue, aviso de 100%); gating pelo módulo.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_treino.py
Só dados fictícios (empresas t90-*, e-mails @exemplo.test, operadores OP-9xx com apelido).
"""
import hashlib
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL90 = RAIZ / "supabase" / "migrations" / "20270126000001_treino_operadores.sql"


def sql(cmd, papel=None, uid=None, todas=False):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    linhas = r.stdout.strip().splitlines()
    return r.returncode == 0, (linhas if todas else (linhas or [""])[-1]), r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 90: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 90: " + nome + ("" if cond else f"  -> {detalhe[:600]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL90)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

au, an, sr = "authenticated", "anon", "service_role"
HOJE = sv("select public.hoje_treino()")          # data de Brasília (nunca current_date do servidor em UTC)

# ---------------------------------------------------------------- sementes Padrão MotorCX
checar("10 cenários Padrão MotorCX, todos publicados", True,
       "select count(*) || '|' || count(*) filter (where situacao = 'publicado' and origem = 'padrao') "
       "from public.treino_cenarios where empresa_id is null", None, None, "10|10")
checar("sementes: persona sempre '(fictícia)'/'(fictício)', sem quer_humano, com 'quer falar com o supervisor'", True,
       "select count(*) filter (where persona_nome !~ '\\((fictícia|fictício)\\)$') || '|' || "
       "count(*) filter (where perfil = 'quer_humano') || '|' || count(*) filter (where perfil = 'quer_supervisor') "
       "from public.treino_cenarios where empresa_id is null", None, None, "0|0|1")
checar("sementes sem dado pessoal (CPF, telefone, e-mail, 8+ dígitos) em nenhum texto", True,
       "select count(*) from public.treino_cenarios c, lateral (select concat_ws(chr(10), c.nome, c.persona_nome, "
       "c.descricao, c.objetivo, c.objetivo_cenario, array_to_string(c.frases, chr(10)), "
       "array_to_string(c.comportamentos, chr(10)), c.objecoes::text, c.divida::text) t) x "
       "where c.empresa_id is null and (not public.texto_mascarado_ok(x.t) or x.t ~ '@' or x.t ~ '[0-9]{8,}' "
       "or x.t ~* '\\mcpf\\M')", None, None, 0)
checar("sementes sem insights (só cenário de padrões agregados tem) e com itens do checklist padrão", True,
       "select count(*) filter (where insights is not null) || '|' || "
       "count(*) filter (where not (itens_foco <@ array['ck_ident','ck_cpc','ck_ameaca','ck_oferta','ck_canais',"
       "'ck_naoligue','ck_terceiro','ck_resumo'])) from public.treino_cenarios where empresa_id is null", None, None, "0|0")
checar("cenário com nome de cliente sem '(fictícia)' é recusado", False,
       "insert into public.treino_cenarios (empresa_id, nome, persona_nome, perfil, objetivo, origem) values "
       "(null, 'Teste', 'Maria Souza', 'irritado', 'Objetivo de teste longo', 'padrao')", sr)
checar("cenário com telefone numa frase é recusado", False,
       "insert into public.treino_cenarios (empresa_id, nome, persona_nome, perfil, objetivo, origem, frases) values "
       "(null, 'Teste', 'Ana (fictícia)', 'irritado', 'Objetivo de teste longo', 'padrao', "
       "array['Me liga no (11) 98765-4321'])", sr)
checar("insights com grupo menor que 30 é recusado", True,
       "select public.insights_treino_ok('{\"base\": 12, \"motivo:contestacao\": 0.4}')", sr, None, "f")
checar("insights só com códigos e porcentagens (base >= 30) passa", True,
       "select public.insights_treino_ok('{\"base\": 4210, \"motivo:contestacao\": 0.18, \"de\": \"2026-10-01\", "
       "\"ate\": \"2026-10-30\"}')", sr, None, "t")
checar("insights com texto livre é recusado", True,
       "select public.insights_treino_ok('{\"base\": 4210, \"frase\": \"cliente disse X\"}')", sr, None, "f")

# ---------------------------------------------------------------- empresas e pessoas (fictícias)
T = uuid.uuid4().hex[:6]
TA = sv(f"insert into public.empresas (slug, nome) values ('t90-a-{T}', 'T90 A {T}') returning id")
TB = sv(f"insert into public.empresas (slug, nome) values ('t90-b-{T}', 'T90 B {T}') returning id")
TC = sv(f"insert into public.empresas (slug, nome) values ('t90-c-{T}', 'T90 C {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true), "
   f"({TB}, 'speech_analytics', true) on conflict (empresa_id, modulo) do update set ativo = true")
sv(f"delete from public.empresa_modulos where empresa_id = {TC} and modulo = 'speech_analytics'")
U = {}
for p, papel, emp in (("qa", "qualidade", TA), ("qb", "qualidade", TB), ("qc", "qualidade", TC), ("adm", "admin", TA),
                      ("ges", "gestao", TA), ("ope", "operacao", TA), ("pla", "planejamento", TA)):
    U[p] = sv(f"insert into auth.users (email) values ('t90.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
Q, QB, QC, A, G, O, P = U["qa"], U["qb"], U["qc"], U["adm"], U["ges"], U["ope"], U["pla"]

# ---------------------------------------------------------------- permissões
for uid, papel, esperado in ((Q, "Qualidade", "t|t"), (A, "Admin", "t|t"), (G, "Gestão", "f|f"), (O, "Operação", "f|f"),
                             (P, "Planejamento", "f|f")):
    checar(f"{papel}: treinar_operadores e editar_cenarios_treino = {esperado}", True,
           "select public.pode('treinar_operadores') || '|' || public.pode('editar_cenarios_treino')", au, uid,
           esperado.replace("t", "true").replace("f", "false"))
checar("as duas permissões novas estão no teto do Speech (a Qualidade pode tê-las)", True,
       "select array['treinar_operadores','editar_cenarios_treino'] <@ public.permissoes_speech() "
       "and array['treinar_operadores','editar_cenarios_treino'] <@ public.permissoes_qualidade()", sr, None, "t")
checar("o resto do padrão da Qualidade continua igual (só o Speech)", True,
       "select string_agg(c.codigo, ',' order by c.codigo) from public.permissoes_catalogo c "
       "where public.permissao_padrao('qualidade', c.codigo)", sr, None,
       "curadoria_voz,editar_cenarios_treino,ouvir_gravacoes,treinar_operadores,ver_alertas,ver_operadores,ver_transcricoes")
checar("Admin pode tirar treinar_operadores da Qualidade (dentro do Speech)", True,
       f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({TA}, 'qualidade', "
       f"'treinar_operadores', false); select 1", au, A, 1)
checar("sem a permissão, a Qualidade não cadastra equipe", False,
       f"select public.salvar_equipe_treino({TA}, 'Equipe Manhã')", au, Q)
sv(f"delete from public.permissoes_papel where empresa_id = {TA} and papel = 'qualidade' and permissao = 'treinar_operadores'")

# ---------------------------------------------------------------- cadastro para treino
EQ = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Manhã')", au, Q)
EQB = sv(f"select public.salvar_equipe_treino({TB}, 'Equipe Tarde')", au, QB)
checar("equipe com o mesmo nome na empresa é recusada", False, f"select public.salvar_equipe_treino({TA}, 'equipe manhã')", au, Q)
checar("Qualidade de empresa sem Speech Analytics não usa o Roleplay", False,
       f"select public.salvar_equipe_treino({TC}, 'Equipe X')", au, QC, erro="Speech Analytics")
checar("Qualidade não cadastra equipe em outra empresa", False, f"select public.salvar_equipe_treino({TB}, 'Equipe Y')", au, Q)
checar("Gestão não cadastra equipe", False, f"select public.salvar_equipe_treino({TA}, 'Equipe Z')", au, G)
OP1 = sv(f"select public.salvar_operador_treino({TA}, 'Bia R.', {EQ}, 'OP-914')", au, Q)
OP2 = sv(f"select public.salvar_operador_treino({TA}, 'Iara C.', {EQ})", au, Q)        # sem ID do discador
OP3 = sv(f"select public.salvar_operador_treino({TA}, 'Caio M.', {EQ})", au, Q)
OPB = sv(f"select public.salvar_operador_treino({TB}, 'Duda S.', {EQB}, 'OP-920')", au, QB)
checar("operador sem ID do discador fica so_treino; com ID, não", True,
       f"select string_agg(so_treino::text || ':' || coalesce(operador_ref, '-'), ',' order by id) from public.voz_operadores "
       f"where id in ({OP1}, {OP2}, {OP3})", sr, None, "false:OP-914,true:-,true:-")
checar("dois operadores sem ID do discador convivem (unique só com ID)", True,
       f"select count(*) from public.voz_operadores where empresa_id = {TA} and operador_ref is null", sr, None, 2)
checar("operador comum sem ID do discador é recusado no banco", False,
       f"insert into public.voz_operadores (empresa_id, discador, apelido) values ({TA}, 'olos', 'Sem ID')", sr)
checar("'Trazer de Speech › Operadores': o mesmo ID vira o mesmo cadastro (não duplica)", True,
       f"select public.salvar_operador_treino({TA}, 'Bia Rocha', {EQ}, 'OP-914') = {OP1}", au, Q, "t")
checar("equipe de outra empresa é recusada", False, f"select public.salvar_operador_treino({TA}, 'X Y', {EQB})", au, Q)
checar("o Speech continua lendo a lista de operadores com o de treino junto (operadores_voz)", True,
       f"select public.operadores_voz({TA}, null, '{HOJE}'::date - 10, '{HOJE}'::date) ? 'operadores'", au, Q, "t")
checar("a Qualidade vê os operadores da empresa (voz_operadores) com equipe", True,
       f"select count(*) from public.voz_operadores where empresa_id = {TA} and equipe_id = {EQ}", au, Q, 3)

# ---------------------------------------------------------------- cenários
GLOB = sv("select id from public.treino_cenarios where empresa_id is null and codigo = 'ja_pagou'")
GLOB_P = sv("select id from public.treino_cenarios where empresa_id is null and codigo = 'quer_parcelar_muito'")
checar("Padrão MotorCX não se edita", False,
       f"select public.salvar_cenario_treino({TA}, '{{\"nome\": \"Outro\"}}', {GLOB})", au, Q, erro="duplique")
CP = sv(f"select public.duplicar_cenario_treino({GLOB}, {TA})", au, Q)
checar("'Duplicar para editar': cópia em rascunho na empresa, com base no padrão", True,
       f"select situacao || '|' || origem || '|' || (base_id = {GLOB}) || '|' || empresa_id from public.treino_cenarios "
       f"where id = {CP}", au, Q, f"rascunho|manual|true|{TA}")
checar("cenário em rascunho não se atribui", False,
       f"select public.atribuir_treino({TA}, {CP}, array[{OP1}], '{HOJE}'::date + 7)", au, Q)
NOVO = {"nome": "Pagou, mas a baixa não caiu", "persona_nome": "Renata (fictícia)", "perfil": "ja_pagou",
        "objetivo": "Pagou outra parcela e acha que quitou; desconfia de golpe.", "frases": ["Mas eu já paguei isso!"],
        "comportamentos": ["desconfia de golpe"], "objecoes": [{"codigo": "ja_paguei", "quando": "no começo"}],
        "dificuldade": 3, "divida": {"produto": "Cartão Exemplo", "faixa": "1k_5k", "dias_atraso": 95,
                                     "alcada": {"parcelas": 12, "desconto_max": 30}},
        "itens_foco": ["ck_cpc", "cl_tratou_objecao"], "modos": ["texto"], "origem": "insights",
        "insights": {"base": 4210, "motivo:contestacao": 0.18, "de": "2026-10-01", "ate": "2026-10-30"},
        "situacao": "publicado"}
CE = sv(f"select public.salvar_cenario_treino({TA}, {j(NOVO)})", au, Q)
checar("cenário da empresa publicado (de insights) grava publicado_em", True,
       f"select situacao || '|' || origem || '|' || (publicado_em is not null) from public.treino_cenarios where id = {CE}",
       au, Q, "publicado|insights|true")
checar("cenário com CPF no texto é recusado", False,
       f"select public.salvar_cenario_treino({TA}, {j(dict(NOVO, frases=['Meu CPF é 123.456.789-09']))})", au, Q)
checar("Qualidade da outra empresa não edita o cenário", False,
       f"select public.salvar_cenario_treino({TB}, '{{\"nome\": \"Invasão\"}}', {CE})", au, QB)
checar("Qualidade vê os 10 padrão e os da empresa", True,
       f"select count(*) filter (where empresa_id is null) || '|' || count(*) filter (where empresa_id = {TA}) "
       f"from public.treino_cenarios", au, Q, "10|2")
checar("Qualidade da outra empresa não vê os cenários da empresa", True,
       f"select count(*) from public.treino_cenarios where empresa_id = {TA}", au, QB, 0)
checar("Operação e Gestão não veem cenários (nem os padrão)", True,
       "select count(*) from public.treino_cenarios", au, O, 0)
checar("Gestão não vê cenários", True, "select count(*) from public.treino_cenarios", au, G, 0)

# ---------------------------------------------------------------- atribuição
PRAZO = sv(f"select '{HOJE}'::date + 10")
AT = sv(f"select public.atribuir_treino({TA}, {GLOB}, array[{OP1}, {OP2}], '{PRAZO}', 75, 2)", au, Q)
ATE = sv(f"select public.atribuir_treino({TA}, {CE}, array[{OP3}], '{PRAZO}', 70, null)", au, Q)
checar("atribuição: uma linha por pessoa, pendente, sem tentativa usada", True,
       f"select string_agg(situacao || ':' || tentativas_usadas, ',') from public.treino_atribuicao_operadores "
       f"where atribuicao_id = {AT}", au, Q, "pendente:0,pendente:0")
checar("prazo no passado é recusado", False,
       f"select public.atribuir_treino({TA}, {GLOB}, array[{OP1}], '{HOJE}'::date - 1)", au, Q)
checar("pessoa de outra empresa não entra na atribuição", False,
       f"select public.atribuir_treino({TA}, {GLOB}, array[{OPB}], '{PRAZO}')", au, Q)
checar("modo que o cenário não tem é recusado", False,
       f"select public.atribuir_treino({TA}, {CE}, array[{OP1}], '{PRAZO}', 75, 2, array['voz'])", au, Q)
checar("Admin vê as atribuições da empresa", True, f"select count(*) from public.treino_atribuicoes where empresa_id = {TA}",
       au, A, 2)
checar("Gestão não vê atribuições", True, "select count(*) from public.treino_atribuicoes", au, G, 0)
checar("Qualidade da outra empresa não vê", True, f"select count(*) from public.treino_atribuicao_operadores "
       f"where empresa_id = {TA}", au, QB, 0)

# ---------------------------------------------------------------- link pessoal
L1 = json.loads(sv(f"select public.gerar_link_treino({OP1})", au, Q))
TK1 = L1["token"]
H1 = hashlib.sha256(TK1.encode()).hexdigest()
caso("token de 64 hex, mostrado uma vez", len(TK1) == 64 and all(c in "0123456789abcdef" for c in TK1), TK1)
checar("o banco guarda só o sha-256 do token (nunca o token)", True,
       f"select (token_hash = '{H1}') || '|' || (position('{TK1}' in row_to_json(l)::text) = 0) "
       f"from public.treino_links l where operador_id = {OP1}", sr, None, "true|true")
checar("validade = prazo + 1 dia (fim do dia, Brasília)", True,
       f"select valido_ate = (('{PRAZO}'::date + 2)::timestamp at time zone 'America/Sao_Paulo') "
       f"from public.treino_links where operador_id = {OP1} and revogado_em is null", sr, None, "t")
checar("o site não lê o hash do token (nem a Qualidade)", False, "select token_hash from public.treino_links", au, Q)
checar("a Qualidade vê o link (validade) sem o hash", True,
       f"select count(*) from public.treino_links where operador_id = {OP1} and valido_ate > now()", au, Q, 1)
checar("Qualidade da outra empresa não vê o link", True, f"select count(*) from public.treino_links where empresa_id = {TA}",
       au, QB, 0)
checar("Qualidade da outra empresa não gera link para a pessoa", False, f"select public.gerar_link_treino({OP1})", au, QB)
MEUS = sv(f"select public.treino_meus('{TK1}')", an)
m = json.loads(MEUS) if MEUS.startswith("{") else {}
caso("anon com o token: só os treinos do próprio operador (1 treino, apelido dele)",
     m.get("apelido") == "Bia Rocha" and len(m.get("treinos", [])) == 1
     and m["treinos"][0]["atribuicao"] == int(AT), MEUS[:300])
caso("o briefing não traz o roteiro da persona (frases, comportamentos, objeções)",
     m.get("treinos") and not {"frases", "comportamentos", "objecoes", "objetivo"} & set(m["treinos"][0]["cenario"]),
     MEUS[:300])
caso("o briefing traz os itens em foco com o texto do checklist",
     m.get("treinos") and all(i.get("texto") for i in m["treinos"][0]["cenario"]["itens_foco"]), MEUS[:400])
checar("anon com token errado não abre nada", False, f"select public.treino_meus('{'0' * 64}')", an, erro="link inválido")
checar("anon com token mal formado não abre nada", False, "select public.treino_meus('abc')", an, erro="link inválido")
checar("cada abertura fica registrada (sem IP, sem token)", True,
       f"select count(*) || '|' || (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       f"where table_schema = 'public' and table_name = 'treino_link_acessos') from public.treino_link_acessos a "
       f"join public.treino_links l on l.id = a.link_id where l.operador_id = {OP1} and a.acao = 'abrir'", sr, None,
       "1|id,link_id,empresa_id,acao,em")
for t in ("treino_links", "treino_sessoes", "treino_cenarios", "treino_atribuicoes", "treino_transcricoes", "voz_operadores"):
    checar(f"anon não lê {t}", False, f"select count(*) from public.{t}", an)
for f in (f"public.gerar_link_treino({OP1})", f"public.salvar_equipe_treino({TA}, 'X')",
          "public.registrar_sessao_treino(1, '{}')", f"public.link_do_token_treino('{TK1}')",
          f"public.abrir_sessao_treino({TA}, {GLOB}, 'texto', {AT}, {OP1}, 'link', null)", "public.apagar_voz_expirada()",
          f"public.uso_treino({TA})", f"public.franquia_treino({TA}, 'ia_treino_voz', '{HOJE}')"):
    checar(f"anon não chama {f.split('(')[0]}", False, f"select {f}", an)
checar("só as 5 funções do token ficam para anon (nenhuma outra do treino)", True,
       "select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace "
       "and (proname like '%treino%' or proname like 'treino\\_%') and has_function_privilege('anon', oid, 'execute')",
       sr, None, "treino_discordar,treino_iniciar,treino_meus,treino_resultado,treino_sair")
checar("RPCs do treino com search_path fixo", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and proname like '%treino%' "
       "and not coalesce(array_to_string(proconfig, ',') like '%search_path%', false)", sr, None, 0)
checar("todas as tabelas do treino com RLS", True,
       "select count(*) from pg_tables where schemaname = 'public' and tablename like 'treino\\_%' and not rowsecurity",
       sr, None, 0)
L1b = json.loads(sv(f"select public.gerar_link_treino({OP1})", au, Q))
TK1b = L1b["token"]
checar("gerar outro link revoga o anterior (o token antigo não abre)", False, f"select public.treino_meus('{TK1}')", an,
       erro="link inválido")
checar("um link ativo por operador", True,
       f"select count(*) from public.treino_links where operador_id = {OP1} and revogado_em is null", sr, None, 1)
TK2 = json.loads(sv(f"select public.gerar_link_treino({OP2})", au, A))["token"]
TK3 = json.loads(sv(f"select public.gerar_link_treino({OP3})", au, Q))["token"]
TKB = json.loads(sv(f"select public.gerar_link_treino({OPB})", au, QB))["token"]
sv(f"update public.treino_links set valido_ate = now() - interval '1 minute' where operador_id = {OP3} and revogado_em is null")
checar("link vencido não abre", False, f"select public.treino_meus('{TK3}')", an, erro="link inválido")
TK3 = json.loads(sv(f"select public.gerar_link_treino({OP3})", au, Q))["token"]
sv(f"select public.revogar_link_treino({OP2})", au, Q)
checar("link revogado não abre", False, f"select public.treino_meus('{TK2}')", an, erro="link inválido")
TK2 = json.loads(sv(f"select public.gerar_link_treino({OP2})", au, Q))["token"]
checar("o token de uma empresa não abre o treino de outra", False, f"select public.treino_iniciar('{TKB}', {AT}, 'texto')", an)
checar("o token de uma pessoa não abre o treino de outra (mesma empresa)", False,
       f"select public.treino_iniciar('{TK3}', {AT}, 'texto')", an, erro="treino não encontrado")

# ---------------------------------------------------------------- tentativas


def iniciar(tk, atr, modo="texto"):
    return json.loads(sv(f"select public.treino_iniciar('{tk}', {atr}, '{modo}')", an))["sessao"]


def registrar(sid, **dados):
    return sv(f"select public.registrar_sessao_treino({sid}, {j(dados)})", sr)


ITENS_RUINS = {"ck_ident": "sim", "ck_cpc": "nao", "ck_resumo": "na"}
ITENS_BONS = {"ck_ident": "sim", "ck_cpc": "sim", "ck_resumo": "sim"}
TRANS = [{"quem": "persona", "texto": "Mas eu já paguei isso!", "t": 12.5},
         {"quem": "operador", "texto": "Entendo. Me diz a data e por onde pagou?", "t": 15}]
FEED = [{"item": "ck_cpc", "trecho": "A senhora tem uma fatura em atraso.", "dica": "Confirme a identidade antes do valor."}]


def usadas(op, atr=AT):
    return sv(f"select tentativas_usadas || ':' || situacao from public.treino_atribuicao_operadores "
              f"where atribuicao_id = {atr} and operador_id = {op}")


S1 = iniciar(TK1b, AT)
checar("sessão nova pelo link: em andamento, origem link, checklist vigente gravado", True,
       f"select situacao || '|' || origem || '|' || (checklist_versao_id is not null) from public.treino_sessoes where id = {S1}",
       sr, None, "em_andamento|link|true")
sv(f"select public.treino_sair('{TK1b}', {S1})", an)
caso("'Sair sem contar': abandonada, não conta tentativa", usadas(OP1) == "0:em_andamento", usadas(OP1))
S2 = iniciar(TK1b, AT)
registrar(S2, situacao="falhou", motivo_falha="rede", duracao_s=40)
caso("rede caiu no meio: falhou, não conta tentativa", usadas(OP1).startswith("0:"), usadas(OP1))
S3 = iniciar(TK1b, AT)
S4 = iniciar(TK1b, AT)
checar("abrir outra sessão com uma aberta: a aberta vira abandonada (não conta)", True,
       f"select situacao from public.treino_sessoes where id = {S3}", sr, None, "abandonada")
registrar(S4, situacao="avaliada", duracao_s=300, nota=60, itens=ITENS_RUINS, evidencia={"ck_cpc": [3, 4]},
          reprovada=True, item_reprovado="ck_cpc", objetivo_ok=False, tokens=42000, transcricao=TRANS, feedback=FEED)
caso("sessão avaliada conta 1 tentativa (abaixo da meta)", usadas(OP1) == "1:abaixo", usadas(OP1))
checar("situação calculada: item crítico com 'não'", True, f"select public.situacao_treino_operador({AT}, {OP1})", sr, None,
       "item_critico")
checar("registrar de novo a mesma sessão não conta outra vez", True,
       f"select public.registrar_sessao_treino({S4}, {j({'situacao': 'avaliada', 'nota': 99})}) ->> 'ja_registrada'", sr,
       None, "true")
S5 = iniciar(TK1b, AT)
registrar(S5, situacao="avaliada", duracao_s=280, nota=70, itens=ITENS_BONS, tokens=30000)
caso("2ª avaliada: 2 tentativas usadas", usadas(OP1) == "2:abaixo", usadas(OP1))
checar("tentativas esgotadas: não abre outra sessão", False, f"select public.treino_iniciar('{TK1b}', {AT}, 'texto')", an,
       erro="tentativas")
checar("situação calculada: precisa de apoio (não 'reprovado')", True,
       f"select public.situacao_treino_operador({AT}, {OP1})", sr, None, "precisa_apoio")
checar("'Liberar +1 tentativa' (Qualidade)", True, f"select public.liberar_tentativa_treino({AT}, {OP1})", au, Q, 1)
checar("Qualidade da outra empresa não libera tentativa", False, f"select public.liberar_tentativa_treino({AT}, {OP1})", au, QB)
S6 = iniciar(TK1b, AT)
registrar(S6, situacao="avaliada", duracao_s=310, nota=86, itens=ITENS_BONS, tokens=31000, transcricao=TRANS)
caso("com +1 tentativa, nota >= meta sem item crítico: aprovado, melhor nota 86",
     usadas(OP1) == "3:aprovado" and sv(f"select melhor_nota from public.treino_atribuicao_operadores where atribuicao_id = {AT} "
                                       f"and operador_id = {OP1}") == "86.00", usadas(OP1))
checar("só o serviço registra o resultado (Qualidade não)", False,
       f"select public.registrar_sessao_treino({S6}, '{{\"situacao\": \"avaliada\", \"nota\": 100}}')", au, Q)
checar("transcrição com e-mail é recusada", False,
       f"select public.registrar_sessao_treino({iniciar(TK2, AT)}, "
       f"{j({'situacao': 'avaliada', 'nota': 50, 'transcricao': [{'quem': 'operador', 'texto': 'manda pra x@y.com'}]})})", sr)
checar("a sessão da transcrição recusada continua aberta (nada gravado)", True,
       f"select count(*) from public.treino_sessoes where operador_id = {OP2} and situacao = 'em_andamento'", sr, None, 1)

# resultado, discordância, revisão, feedback 1:1
RES = json.loads(sv(f"select public.treino_resultado('{TK1b}', {S4})", an))
caso("resultado pelo link: nota, itens com texto, feedback ponto a ponto e transcrição",
     RES["nota"] == 60 and any(i["id"] == "ck_cpc" and i["resposta"] == "nao" and i["texto"] for i in RES["itens"])
     and RES["feedback"] and RES["transcricao"], json.dumps(RES)[:400])
checar("o token não abre a sessão de outra pessoa", False,
       f"select public.treino_resultado('{TK3}', {S4})", an, erro="sessão não encontrada")
checar("'Discordo deste ponto' num item 'não'", True,
       f"select public.treino_discordar('{TK1b}', {S4}, 'ck_cpc', 'Eu confirmei a data antes, no começo.'); select 1", an,
       None, 1)
checar("não dá para discordar de item 'sim'", False,
       f"select public.treino_discordar('{TK1b}', {S4}, 'ck_ident', 'Discordo do sim.')", an)
checar("discordância com telefone é recusada", False,
       f"select public.treino_discordar('{TK1b}', {S4}, 'ck_cpc', 'Me liga no 11987654321')", an)
checar("Qualidade vê a discordância e resolve", True,
       f"select public.resolver_discordancia_treino((select id from public.treino_discordancias where sessao_id = {S4})); "
       f"select count(*) from public.treino_discordancias where sessao_id = {S4} and resolvida_em is not null", au, Q, 1)
checar("'Revisar avaliação': a Qualidade marca o item (IA × Qualidade)", True,
       f"select public.revisar_sessao_treino({S4}, 'ck_cpc', 'sim'); "
       f"select ia || '>' || qualidade from public.treino_revisoes where sessao_id = {S4}", au, Q, "nao>sim")
checar("o operador vê a revisão no resultado", True,
       f"select (select x ->> 'revisado' from jsonb_array_elements(public.treino_resultado('{TK1b}', {S4}) -> 'itens') x "
       f"where x ->> 'id' = 'ck_cpc')", an, None, "sim")
checar("feedback 1:1 da Qualidade", True,
       f"select public.salvar_feedback_treino({TA}, {OP1}, 'Combinado: confirmar a identidade antes do valor.', "
       f"'{HOJE}'::date + 7, {AT}, {S4}) > 0", au, Q, "t")
checar("feedback 1:1 com CPF é recusado", False,
       f"select public.salvar_feedback_treino({TA}, {OP1}, 'CPF 123.456.789-09')", au, Q)
for t in ("treino_sessoes", "treino_transcricoes", "treino_feedback", "treino_feedbacks", "treino_revisoes",
          "treino_discordancias", "treino_link_acessos"):
    checar(f"Admin vê {t} da empresa", True, f"select count(*) > 0 from public.{t} where empresa_id = {TA}", au, A, "t")
    checar(f"Qualidade da outra empresa não vê {t}", True, f"select count(*) from public.{t} where empresa_id = {TA}",
           au, QB, 0)
    checar(f"Gestão não vê {t}", True, f"select count(*) from public.{t}", au, G, 0)

# teste da Qualidade e lado a lado
TS = json.loads(sv(f"select public.testar_cenario_treino({CP}, {TA}, 'texto')", au, Q))["sessao"]
registrar(TS, situacao="avaliada", duracao_s=200, nota=90, itens=ITENS_BONS, tokens=20000, transcricao=TRANS)
checar("teste da Qualidade (rascunho dá para testar): sem operador, transcrição some em 1 dia", True,
       f"select s.origem || '|' || (s.operador_id is null) || '|' || (t.expira_em < now() + interval '2 days') "
       f"from public.treino_sessoes s join public.treino_transcricoes t on t.sessao_id = s.id where s.id = {TS}", sr, None,
       "teste|true|true")
checar("teste da Qualidade não pode ser revisado nem entra em atribuição", False,
       f"select public.revisar_sessao_treino({TS}, 'ck_cpc', 'nao')", au, Q)
LA = json.loads(sv(f"select public.iniciar_treino_lado_a_lado({ATE}, {OP3}, 'texto')", au, Q))["sessao"]
checar("treino lado a lado: sessão do operador iniciada pela Qualidade logada", True,
       f"select origem || '|' || operador_id || '|' || (iniciada_por = '{Q}') from public.treino_sessoes where id = {LA}", sr,
       None, f"lado_a_lado|{OP3}|true")
checar("lado a lado em modo que o treino não tem é recusado", False,
       f"select public.iniciar_treino_lado_a_lado({ATE}, {OP3}, 'voz')", au, Q)

# ---------------------------------------------------------------- nota de treino fora da nota das ligações
checar("nenhuma nota de treino foi para voz_avaliacoes nem voz_qualidade_dia", True,
       f"select (select count(*) from public.voz_avaliacoes where empresa_id = {TA}) + "
       f"(select count(*) from public.voz_qualidade_dia where empresa_id = {TA})", sr, None, 0)
checar("nenhuma função do treino escreve em voz_avaliacoes/voz_qualidade_dia", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like '%treino%' "
       "and (prosrc ~ 'voz_avaliacoes' or prosrc ~ 'voz_qualidade_dia')", sr, None, 0)
checar("nenhuma coluna de áudio nas tabelas do treino", True,
       "select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'treino\\_%' "
       "and (column_name ~ 'audio|gravacao|caminho|arquivo' or data_type = 'bytea')", sr, None, 0)

# ---------------------------------------------------------------- retenção (90 dias)
sv(f"update public.treino_transcricoes set expira_em = now() - interval '1 second' where sessao_id = {S4}")
sv(f"update public.treino_feedback set expira_em = now() - interval '1 second' where sessao_id = {S4}")
checar("apagar_voz_expirada apaga a transcrição e o feedback vencidos do treino", True,
       f"select public.apagar_voz_expirada() ? 'gravacoes'; "
       f"select (select count(*) from public.treino_transcricoes where sessao_id = {S4}) || '|' || "
       f"(select count(*) from public.treino_feedback where sessao_id = {S4}) || '|' || "
       f"(select nota from public.treino_sessoes where id = {S4}) || '|' || "
       f"(select count(*) from public.treino_transcricoes where sessao_id = {S6})", sr, None, "0|0|60.00|1")
checar("apagar_voz_expirada continua devolvendo o mesmo (gravacoes e codigos)", True,
       "select (public.apagar_voz_expirada() ?& array['gravacoes', 'codigos'])::text", sr, None, "true")
checar("apagar_voz_expirada continua com as limpezas de antes (passos, conectores, roleplay, Resubmit)", True,
       "select (position('voz_fluxo_passos' in d) > 0 and position('crm_chamadas' in d) > 0 "
       "and position('roleplay_conversas' in d) > 0 and position('voz_resubmits' in d) > 0 "
       "and position('voz_gravacoes' in d) > 0 and position('treino_transcricoes' in d) > 0)::text "
       "from (select pg_get_functiondef('public.apagar_voz_expirada()'::regprocedure) d) x", sr, None, "true")
checar("apagar_voz_expirada continua só do servidor", False, "select public.apagar_voz_expirada()", au, A)
checar("resultado sem a transcrição depois dos 90 dias (nota e itens ficam)", True,
       f"select (public.treino_resultado('{TK1b}', {S4}) ->> 'transcricao') is null "
       f"and (public.treino_resultado('{TK1b}', {S4}) ->> 'nota') = '60.00'", an, None, "t")

# ---------------------------------------------------------------- cobrança e franquia
COMP = sv(f"select date_trunc('month', '{HOJE}'::date)::date")
checar("uso do mês: sessões de texto (abandonada e avaliada cobram; falhou não)", True,
       f"select sessoes_texto || '|' || sessoes_voz || '|' || minutos_voz from public.treino_uso_mes "
       f"where empresa_id = {TA} and competencia = '{COMP}'", sr, None, "4|0|0")
checar("o custo da IA vai para consumo_ia (Master)", True,
       f"select quantidade from public.consumo_ia where empresa_id = {TA} and item = 'ia_treino_texto' "
       f"and competencia = '{COMP}'", sr, None, "4.0000")
checar("dentro da franquia (300 sessões), nada de texto na fatura", True,
       f"select count(*) from public.consumo_mensageria where empresa_id = {TA} and item = 'ia_treino_texto'", sr, None, 0)
S3u = registrar(S3, situacao="abandonada", duracao_s=50)
checar("a sessão fechada pelo operador ainda registra o uso pelo serviço, uma vez", True,
       f"select sessoes_texto from public.treino_uso_mes where empresa_id = {TA} and competencia = '{COMP}'", sr, None, 5)
checar("e não registra duas vezes", True,
       f"select public.registrar_sessao_treino({S3}, '{{\"situacao\": \"abandonada\", \"duracao_s\": 50}}') ->> 'ja_registrada'",
       sr, None, "true")
checar("itens novos na fatura: minuto de voz e sessão de texto, de IA, do módulo speech_analytics, com franquia", True,
       "select string_agg(codigo || ':' || unidade || ':' || eh_ia || ':' || modulo || ':' || franquia_padrao, ',' order by codigo) "
       "from public.cobranca_itens where codigo in ('ia_treino_voz', 'ia_treino_texto')", sr, None,
       "ia_treino_texto:sessão:true:speech_analytics:300,ia_treino_voz:minuto:true:speech_analytics:1000")
checar("preço de tabela com o mínimo da IA gravado e nunca abaixo dele (margem de 70%)", True,
       "select bool_and(preco_minimo > 0 and preco_tabela >= preco_minimo) from public.cobranca_itens "
       "where codigo in ('ia_treino_voz', 'ia_treino_texto')", sr, None, "t")
# preço da empresa no mínimo da IA de hoje (os testes anteriores mexem nos impostos da margem)
PRECO_VOZ = sv("select greatest(preco_tabela, public.preco_minimo_ia(codigo)) from public.cobranca_itens "
               "where codigo = 'ia_treino_voz'")
sv(f"insert into public.precos_empresa (empresa_id, item, modelo, preco, vigente_desde, franquia) values "
   f"({TA}, 'ia_treino_voz', 'flat', {PRECO_VOZ}, '{COMP}', 2)")
checar("franquia da empresa (precos_empresa.franquia, SQL 78) vale no lugar da padrão", True,
       f"select public.uso_treino({TA}) ->> 'franquia_voz'", au, Q, 2)
AV = sv(f"select public.atribuir_treino({TA}, {GLOB_P}, array[{OP2}], '{PRAZO}', 75, null, array['voz', 'texto'])", au, Q)
SV1 = iniciar(TK2, AV, "voz")
registrar(SV1, situacao="avaliada", duracao_s=150, nota=80, itens=ITENS_BONS, tokens=5000)
checar("minutos de voz inteiros no mês (150 s = 3 min)", True,
       f"select minutos_voz || '|' || segundos_voz from public.treino_uso_mes where empresa_id = {TA} and competencia = '{COMP}'",
       sr, None, "3|150")
checar("na fatura entra só o que passou da franquia (3 − 2 = 1 minuto)", True,
       f"select quantidade from public.consumo_mensageria where empresa_id = {TA} and item = 'ia_treino_voz' "
       f"and competencia = '{COMP}'", sr, None, 1)
checar("a prévia da fatura mostra o minuto excedente com o preço da empresa", True,
       f"select quantidade || '|' || valor from public.previa_fatura({TA}, '{COMP}') where item = 'ia_treino_voz'", sr, None,
       f"1|{round(float(PRECO_VOZ), 2):.2f}")
checar("aviso no sino quando a franquia de voz acaba (uma vez)", True,
       f"select count(*) from public.avisos where empresa_id = {TA} and chave like 'treino_voz:%:100'", sr, None, 1)
checar("franquia de voz acabou: voz bloqueia", False, f"select public.treino_iniciar('{TK2}', {AV}, 'voz')", an,
       erro="minutos de voz")
checar("franquia de voz acabou: texto segue", True,
       f"select (public.treino_iniciar('{TK2}', {AV}, 'texto') ->> 'sessao') is not null", an, None, "t")
checar("o link mostra que a voz está indisponível", True,
       f"select public.treino_meus('{TK2}') ->> 'voz_disponivel'", an, None, "false")
checar("uso_treino da outra empresa é negado", False, f"select public.uso_treino({TA})", au, QB)
checar("Admin com faturamento lê o uso do mês", True, f"select count(*) from public.treino_uso_mes where empresa_id = {TA}",
       au, A, 1)

# ---------------------------------------------------------------- gating pelo módulo
sv(f"update public.empresa_modulos set ativo = false where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("módulo desligado: o link para de abrir (treinos indisponíveis)", False, f"select public.treino_meus('{TK1b}')", an,
       erro="treinos indisponíveis")
checar("módulo desligado: a Qualidade não atribui", False,
       f"select public.atribuir_treino({TA}, {GLOB}, array[{OP1}], '{PRAZO}')", au, Q, erro="Speech Analytics")
checar("módulo desligado: o serviço não abre sessão", False,
       f"select public.abrir_sessao_treino({TA}, {GLOB}, 'texto', {AT}, {OP1}, 'link', null)", None)
sv(f"update public.empresa_modulos set ativo = true where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("módulo de volta: o link abre", True, f"select public.treino_meus('{TK1b}') ? 'treinos'", an, None, "t")
sv(f"select public.salvar_operador_treino({TA}, 'Bia Rocha', {EQ}, null, {OP1}, false)", au, Q)
checar("pessoa desativada: o link para de abrir", False, f"select public.treino_meus('{TK1b}')", an, erro="link inválido")

# ---------------------------------------------------------------- sugestões (tabela pronta para o job noturno)
SG = sv(f"insert into public.treino_sugestoes (empresa_id, regra, chave, cenario_id, operadores, evidencia) values "
        f"({TA}, 'item_reprovado', 'item_reprovado:ck_cpc:{T}', {GLOB}, array[{OP1}, {OP2}], "
        f"'{{\"operadores\": 3, \"semana\": \"2026-w45\", \"item\": \"ck_cpc\"}}') returning id", sr)
checar("evidência da sugestão com trecho de conversa é recusada", False,
       f"insert into public.treino_sugestoes (empresa_id, regra, chave, evidencia) values ({TA}, 'alerta_subiu', "
       f"'alerta:x:{T}', '{{\"trecho\": \"Cliente disse que vai ao Procon\"}}')", sr)
checar("'Dispensar' pede o motivo (tratado / falso_positivo) e some por 30 dias", True,
       f"select public.dispensar_sugestao_treino({SG}, 'tratado'); select situacao || '|' || motivo_dispensa || '|' || "
       f"(dispensada_ate = '{HOJE}'::date + 30) from public.treino_sugestoes where id = {SG}", au, Q, "dispensada|tratado|true")
checar("'Desfazer' volta a sugestão", True,
       f"select public.dispensar_sugestao_treino({SG}, null); select situacao from public.treino_sugestoes where id = {SG}",
       au, Q, "nova")
checar("motivo fora da lista é recusado", False, f"select public.dispensar_sugestao_treino({SG}, 'sei_la')", au, Q)
checar("atribuir a partir da sugestão marca a sugestão como aceita", True,
       f"select public.atribuir_treino({TA}, {GLOB}, array[{OP2}], '{PRAZO}', 75, 2, null, {SG}) > 0; "
       f"select situacao from public.treino_sugestoes where id = {SG}", au, Q, "aceita")

# ---------------------------------------------------------------- excluir a empresa leva o treino junto
checar("excluir a empresa apaga o treino dela (cascata, sem travar nos cenários)", True,
       f"delete from auth.users where id in ('{Q}', '{A}', '{G}', '{O}', '{P}'); "
       f"delete from public.empresas where id = {TA}; select (select count(*) from public.treino_sessoes where empresa_id = {TA}) "
       f"+ (select count(*) from public.treino_cenarios where empresa_id = {TA}) "
       f"+ (select count(*) from public.voz_operadores where empresa_id = {TA})", None, None, 0)
checar("os cenários Padrão MotorCX continuam", True,
       "select count(*) from public.treino_cenarios where empresa_id is null", None, None, 10)

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
