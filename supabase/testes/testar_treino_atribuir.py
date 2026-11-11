"""SQL 99 · Roleplay, PR 4: a policy de voz_operadores para quem treina e o estado do link da página do operador.

Cobre: a migração roda duas vezes; a Qualidade sem "Ver operadores" (o Admin pode tirar) continua lendo o cadastro da
própria empresa pelo treinar_operadores (e sem as duas permissões não lê); outra empresa e outros perfis continuam sem
ler; anon não lê voz_operadores; treino_estado_link (anon) diz ativo, expirado, revogado, indisponivel ou invalido,
sem devolver operador, empresa ou apelido e sem registrar acesso; as RPCs do SQL 90 que as telas novas chamam
(salvar_cenario_treino, atribuir_treino, gerar_link_treino, estender_prazo_treino, salvar_feedback_treino) seguem
funcionando para a Qualidade.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_treino_atribuir.py
Só dados fictícios (empresas t99-*, e-mails @exemplo.test, operadores com apelido).
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
SQL99 = RAIZ / "supabase" / "migrations" / "20270210000001_treino_atribuir.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    linhas = r.stdout.strip().splitlines()
    return r.returncode == 0, (linhas or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 99: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL99)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)

au, an, sr = "authenticated", "anon", "service_role"
HOJE = sv("select public.hoje_treino()")
T = uuid.uuid4().hex[:6]
TA = sv(f"insert into public.empresas (slug, nome) values ('t99-a-{T}', 'T99 A {T}') returning id")
TB = sv(f"insert into public.empresas (slug, nome) values ('t99-b-{T}', 'T99 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true), "
   f"({TB}, 'speech_analytics', true) on conflict (empresa_id, modulo) do update set ativo = true")
U = {}
for p, papel, emp in (("qa", "qualidade", TA), ("qb", "qualidade", TB), ("adm", "admin", TA), ("ope", "operacao", TA)):
    U[p] = sv(f"insert into auth.users (email) values ('t99.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
Q, QB, A, O = U["qa"], U["qb"], U["adm"], U["ope"]

EQ = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Manhã')", au, Q)
OP1 = sv(f"select public.salvar_operador_treino({TA}, 'Bia R.', {EQ})", au, Q)
OP2 = sv(f"select public.salvar_operador_treino({TA}, 'Caio M.', {EQ}, 'OP-991')", au, Q)

# ---------------------------------------------------------------- 1. voz_operadores para quem treina
checar("a Qualidade lê o cadastro da empresa", True, f"select count(*) from public.voz_operadores where empresa_id = {TA}", au, Q, 2)
sv(f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({TA}, 'qualidade', 'ver_operadores', false) "
   f"on conflict do nothing")
checar("Admin tirou 'Ver operadores' da Qualidade", True, "select public.pode('ver_operadores')", au, Q, "f")
checar("sem 'Ver operadores', quem treina continua lendo o cadastro (apelido e equipe)", True,
       f"select string_agg(apelido, ',' order by apelido) from public.voz_operadores where empresa_id = {TA}", au, Q, "Bia R.,Caio M.")
sv(f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({TA}, 'qualidade', 'treinar_operadores', false) "
   f"on conflict do nothing")
checar("sem 'Ver operadores' e sem 'Treinar operadores', não lê nada", True,
       f"select count(*) from public.voz_operadores where empresa_id = {TA}", au, Q, 0)
sv(f"delete from public.permissoes_papel where empresa_id = {TA} and papel = 'qualidade'")
checar("Qualidade da outra empresa não lê", True, f"select count(*) from public.voz_operadores where empresa_id = {TA}", au, QB, 0)
checar("Operação (sem as permissões do Speech) não lê", True, f"select count(*) from public.voz_operadores where empresa_id = {TA}", au, O, 0)
checar("anon não lê voz_operadores", False, "select count(*) from public.voz_operadores", an)
checar("o site continua sem gravar direto em voz_operadores", False,
       f"update public.voz_operadores set apelido = 'X' where id = {OP1}", au, Q)

# ---------------------------------------------------------------- as RPCs que as telas novas chamam
GLOB = sv("select id from public.treino_cenarios where empresa_id is null and codigo = 'ja_pagou'")
NOVO = {"nome": "Pagou, mas a baixa não caiu", "persona_nome": "Renata (fictícia)", "perfil": "ja_pagou",
        "descricao": "", "objetivo": "Diz que pagou e desconfia de golpe.", "comportamentos": ["desconfia de golpe"],
        "frases": ["Mas eu já paguei isso!"], "objecoes": [{"codigo": "ja_paguei", "quando": "no começo"}], "dificuldade": 3,
        "divida": {"produto": "Cartão Exemplo", "faixa": "1k_5k", "dias_atraso": 95, "alcada": {"parcelas": 12, "desconto_max": 0}},
        "duracao_max_s": 600, "modos": ["texto"], "itens_foco": ["ck_cpc"], "objetivo_cenario": "", "situacao": "rascunho"}
dados = "'" + json.dumps(NOVO, ensure_ascii=False).replace("'", "''") + "'"
CE = sv(f"select public.salvar_cenario_treino({TA}, {dados})", au, Q)
checar("o pacote do editor (descrição e objetivo vazios viram nulo) salva em rascunho", True,
       f"select situacao || '|' || coalesce(descricao, '-') || '|' || coalesce(objetivo_cenario, '-') || '|' || duracao_max_s "
       f"from public.treino_cenarios where id = {CE}", au, Q, "rascunho|-|-|600")
checar("publicar pelo editor grava publicado_em", True,
       f"select public.salvar_cenario_treino({TA}, '{{\"situacao\": \"publicado\"}}', {CE}); "
       f"select situacao || '|' || (publicado_em is not null) from public.treino_cenarios where id = {CE}", au, Q, "publicado|true")
AT = sv(f"select public.atribuir_treino({TA}, {CE}, array[{OP1}, {OP2}], '{HOJE}'::date + 7, 80, null, array['texto'])", au, Q)
checar("atribuir sem limite de tentativas e só texto", True,
       f"select coalesce(tentativas::text, 'sem') || '|' || array_to_string(modos, ',') || '|' || nota_minima "
       f"from public.treino_atribuicoes where id = {AT}", au, Q, "sem|texto|80")
checar("o feedback 1:1 do painel grava com a atribuição", True,
       f"select public.salvar_feedback_treino({TA}, {OP1}, 'Confirmar a identidade antes do valor.', '{HOJE}'::date + 3, {AT}) > 0", au, Q, "t")

# ---------------------------------------------------------------- 2. treino_estado_link (página do operador)
TK = json.loads(sv(f"select public.gerar_link_treino({OP1})", au, Q))["token"]
est = lambda tk: f"select public.treino_estado_link('{tk}') ->> 'estado'"   # noqa: E731
checar("link novo: ativo", True, est(TK), an, None, "ativo")
checar("só estado e validade (nada de operador, empresa ou apelido)", True,
       f"select string_agg(k, ',' order by k) from jsonb_object_keys(public.treino_estado_link('{TK}')) k", an, None, "ate,estado")
checar("não registra acesso (só treino_meus registra)", True,
       f"select public.treino_estado_link('{TK}'); select count(*) from public.treino_link_acessos a join public.treino_links l "
       f"on l.id = a.link_id where l.operador_id = {OP1}", sr, None, 0)
checar("token mal formado: invalido", True, est("abc"), an, None, "invalido")
checar("token desconhecido: invalido", True, est("0" * 64), an, None, "invalido")
checar("nulo: invalido", True, "select public.treino_estado_link(null) ->> 'estado'", an, None, "invalido")
sv(f"update public.treino_links set valido_ate = now() - interval '1 minute' where operador_id = {OP1} and revogado_em is null")
checar("link vencido: expirado, com a data", True,
       f"select (public.treino_estado_link('{TK}') ->> 'estado') || '|' || (public.treino_estado_link('{TK}') ? 'ate')", an, None,
       "expirado|true")
TK2 = json.loads(sv(f"select public.gerar_link_treino({OP1})", au, Q))["token"]
checar("gerar outro link: o anterior fica revogado", True, est(TK), an, None, "revogado")
checar("o novo está ativo", True, est(TK2), an, None, "ativo")
sv(f"delete from public.empresa_modulos where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("módulo desligado: indisponivel", True, est(TK2), an, None, "indisponivel")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true) "
   f"on conflict (empresa_id, modulo) do update set ativo = true")
sv(f"select public.salvar_operador_treino({TA}, 'Bia R.', {EQ}, null, {OP1}, false)", au, Q)
checar("pessoa desativada: o link para de abrir (revogado)", True, est(TK2), an, None, "revogado")
checar("treino_estado_link é security definer com search_path fixo", True,
       "select prosecdef and array_to_string(proconfig, ',') like '%search_path%' from pg_proc "
       "where proname = 'treino_estado_link' and pronamespace = 'public'::regnamespace", sr, None, "t")

sv(f"delete from auth.users where id in ('{Q}', '{QB}', '{A}', '{O}'); delete from public.empresas where id in ({TA}, {TB})")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
