"""SQL 120 · Roleplay, PR 7: sugestões de atribuição de treino a partir das notas e dos alertas do Speech (job noturno),
num Postgres local com as migrações aplicadas.

Cobre: a migração roda duas vezes; gerar_sugestoes_treino só pelo servidor (e pela VM, voz_vm); as cinco regras com
dados fictícios (item com "não" em 3+ operadores, nota baixa com o pior item, item crítico repetido, alerta que dobrou
numa equipe, vulnerabilidade concentrada), sem o que não passa do piso (2 operadores, 9 ligações, alerta que não dobrou);
evidência só com contagens e códigos (nunca chamada, gravação, cliente ou trecho); operador sem ID do discador ou de
outra empresa não entra; cenário sugerido pelo item em foco ou pelo tipo de cliente; idempotente (a noite seguinte só
atualiza); dispensada fica fora por 30 dias e volta depois se ainda valer; "Desfazer"; aceita fica aceita com o treino
aberto; a que parou de valer some em 8 dias; módulo desligado não gera; o site lê as sugestões só da própria empresa;
nada é gravado em voz_avaliacoes/voz_qualidade_dia.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_treino_sugestoes.py
Só dados fictícios (empresas t120-*, e-mails @exemplo.test, operadores com apelido, clientes CLI-*).
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
SQL120 = RAIZ / "supabase" / "migrations" / "20270312000001_treino_sugestoes.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 120: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 120: " + nome + ("" if cond else f"  -> {detalhe[:600]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"

for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL120)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])

au, an, sr = "authenticated", "anon", "service_role"
HOJE = sv("select public.hoje_treino()")
T = uuid.uuid4().hex[:6]
TA = sv(f"insert into public.empresas (slug, nome) values ('t120-a-{T}', 'T120 A {T}') returning id")
TB = sv(f"insert into public.empresas (slug, nome) values ('t120-b-{T}', 'T120 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true), "
   f"({TB}, 'speech_analytics', true) on conflict (empresa_id, modulo) do update set ativo = true")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({TA}, 'cartao-t120', 'Cartão T120') returning id")
U = {}
for p, papel, emp in (("qa", "qualidade", TA), ("qb", "qualidade", TB), ("ges", "gestao", TA)):
    U[p] = sv(f"insert into auth.users (email) values ('t120.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
Q, QB, G = U["qa"], U["qb"], U["ges"]

EQ = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Noite')", au, Q)
EQ2 = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Dia')", au, Q)
OPS = {}
for ap, ref, eq in (("Ana T.", "T120-A", EQ), ("Beto T.", "T120-B", EQ), ("Cris T.", "T120-C", EQ), ("Duda T.", "T120-D", EQ2),
                    ("Elis T.", "T120-E", EQ2)):
    OPS[ref] = sv(f"select public.salvar_operador_treino({TA}, '{ap}', {eq}, '{ref}')", au, Q)
SEMREF = sv(f"select public.salvar_operador_treino({TA}, 'Fábio T.', {EQ})", au, Q)        # só treino, sem ID do discador
OPB = sv(f"select public.salvar_operador_treino({TB}, 'Gil T.', null, 'T120-A')", au, QB)   # mesmo ID, outra empresa


def qual(ref, item, dias, avaliadas, aprovadas, na=0, nota=0, emp=TA):
    sv(f"insert into public.voz_qualidade_dia (empresa_id, credor_id, data, origem, persona, operador_ref, item, avaliadas, "
       f"aprovadas, na, nota_soma) values ({emp}, 0, '{HOJE}'::date - {dias}, 'discador', '', '{ref}', '{item}', {avaliadas}, "
       f"{aprovadas}, {na}, {nota}) on conflict do nothing")


# regra 1: ck_cpc com "não" em 3 operadores (A, B, C); ck_resumo com "não" só em 2 (fica fora)
for ref in ("T120-A", "T120-B", "T120-C"):
    qual(ref, "ck_cpc", 2, 10, 7)
qual("T120-D", "ck_cpc", 3, 10, 10)
for ref in ("T120-A", "T120-B"):
    qual(ref, "ck_resumo", 2, 10, 8)
qual("T120-A", "ck_cpc", 2, 10, 5, emp=TB)                                            # outra empresa não conta
# regra 5: nota baixa de D (12 ligações, média 61) com o pior item ck_oferta; E com 9 ligações fica fora
qual("T120-D", "_ligacao", 4, 12, 6, nota=12 * 61)
qual("T120-D", "ck_oferta", 4, 12, 3)
qual("T120-E", "_ligacao", 4, 9, 2, nota=9 * 50)
# regra 3: item crítico ck_cpc 2 vezes para C em 30 dias (voz_avaliacoes, com chamada e gravação fictícias)
VPAD = sv("select v.id from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id "
          "where c.empresa_id is null and v.situacao = 'em_uso' order by v.id limit 1")
for k in range(2):
    ch = sv(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em) values "
            f"({TA}, {CA}, 'LG-120{k}-{T}', 'CLI-120{k}', 'real', now() - interval '3 days') returning id")
    g = sv(f"insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, operador_ref) "
           f"values ({TA}, {CA}, {ch}, 'CLI-120{k}', 'discador', 't120/{T}/{ch}.mp3', 'T120-C') returning id")
    sv(f"insert into public.voz_avaliacoes (empresa_id, credor_id, chamada_id, gravacao_id, versao_id, origem, operador_ref, "
       f"nota, itens, reprovada, item_reprovado, avaliada_em) values ({TA}, {CA}, {ch}, {g}, {VPAD}, 'discador', 'T120-C', 40, "
       f"'{{\"ck_cpc\": \"nao\"}}', true, 'ck_cpc', now() - interval '3 days')")


def alerta(ref, tipo, dias, sinal=None):
    sv(f"insert into public.voz_alertas (empresa_id, credor_id, id_cliente, tipo, sinal, falante, origem, operador_ref, criado_em) "
       f"values ({TA}, {CA}, 'CLI-120X', '{tipo}', {('%s' % repr(sinal)) if sinal else 'null'}, 'cliente', 'discador', '{ref}', "
       f"now() - interval '{dias} days')")


# regra 2: Procon na Equipe Noite: 4 nesta semana × 1 na anterior (dobrou); ameaça na Equipe Dia: 3 × 2 (não dobrou)
for ref in ("T120-A", "T120-B", "T120-A", "T120-C"):
    alerta(ref, "procon", 2)
alerta("T120-A", "procon", 10)
for _ in range(3):
    alerta("T120-D", "ameaca", 2)
for _ in range(2):
    alerta("T120-E", "ameaca", 9)
# regra 4: idade_confusao 3 vezes na Equipe Dia
for ref in ("T120-D", "T120-E", "T120-D"):
    alerta(ref, "vulnerabilidade", 1, "idade_confusao")

checar("o site não gera sugestões", False, f"select public.gerar_sugestoes_treino({TA})", au, Q)
checar("anon não gera sugestões", False, f"select public.gerar_sugestoes_treino({TA})", an)
R = json.loads(sv(f"select public.gerar_sugestoes_treino({TA})", sr))
caso("a noite gera as cinco sugestões (e nada abaixo do piso)", R["sugestoes"] == 5, json.dumps(R))
LIN = {x["chave"]: x for x in json.loads(sv(
    f"select coalesce(jsonb_agg(to_jsonb(s) order by s.chave), '[]') from public.treino_sugestoes s where s.empresa_id = {TA}", sr))}
op = lambda ref: int(OPS[ref])   # noqa: E731
caso("item com não em 3 operadores: os 3, com contagens e o cenário com o item em foco",
     "item_reprovado:ck_cpc" in LIN and sorted(LIN["item_reprovado:ck_cpc"]["operadores"]) == sorted([op("T120-A"), op("T120-B"), op("T120-C")])
     and LIN["item_reprovado:ck_cpc"]["evidencia"]["operadores"] == 3 and LIN["item_reprovado:ck_cpc"]["evidencia"]["nao"] == 9
     and LIN["item_reprovado:ck_cpc"]["cenario_id"] is not None, json.dumps(LIN.get("item_reprovado:ck_cpc")))
caso("item com não em só 2 operadores fica fora", "item_reprovado:ck_resumo" not in LIN, ",".join(LIN))
caso("nota baixa: média 61 em 12 ligações, com o pior item; 9 ligações fica fora",
     f"nota_baixa:op{op('T120-D')}" in LIN and LIN[f"nota_baixa:op{op('T120-D')}"]["evidencia"]["nota_media"] == 61
     and LIN[f"nota_baixa:op{op('T120-D')}"]["evidencia"]["item"] == "ck_oferta" and f"nota_baixa:op{op('T120-E')}" not in LIN,
     json.dumps(LIN.get(f"nota_baixa:op{op('T120-D')}")))
caso("item crítico repetido: o operador e as vezes",
     f"item_critico_operador:ck_cpc:op{op('T120-C')}" in LIN
     and LIN[f"item_critico_operador:ck_cpc:op{op('T120-C')}"]["evidencia"]["vezes"] == 2, ",".join(LIN))
caso("alerta que dobrou na equipe: Procon na Equipe Noite (ameaça que não dobrou fica fora), cenário pelo tipo de cliente",
     f"alerta_subiu:procon:eq{EQ}" in LIN and LIN[f"alerta_subiu:procon:eq{EQ}"]["evidencia"]["semana"] == 4
     and LIN[f"alerta_subiu:procon:eq{EQ}"]["evidencia"]["semana_anterior"] == 1 and f"alerta_subiu:ameaca:eq{EQ2}" not in LIN
     and sv(f"select perfil from public.treino_cenarios where id = {LIN[f'alerta_subiu:procon:eq{EQ}']['cenario_id']}") == "contesta_procon",
     ",".join(LIN))
caso("vulnerabilidade concentrada na Equipe Dia", f"vulnerabilidade:idade_confusao:eq{EQ2}" in LIN, ",".join(LIN))
TUDO = json.dumps([x["evidencia"] for x in LIN.values()])
caso("evidência só com contagens e códigos (nada de cliente, chamada, gravação ou trecho)",
     not any(k in TUDO for k in ("CLI-", "chamada", "gravacao", "trecho", "id_cliente", "LG-")), TUDO)
caso("operador sem ID do discador e de outra empresa não entram",
     all(int(SEMREF) not in x["operadores"] and int(OPB) not in x["operadores"] for x in LIN.values()))
checar("outra empresa sem dados suficientes: nenhuma sugestão", True,
       f"select public.gerar_sugestoes_treino({TB}) ->> 'sugestoes'", sr, None, 0)

# ---------------------------------------------------------------- noite seguinte, dispensar, desfazer, aceitar
ID1 = LIN["item_reprovado:ck_cpc"]["id"]
sv(f"select public.gerar_sugestoes_treino({TA})", sr)
checar("idempotente: a noite seguinte só atualiza", True,
       f"select count(*) || '|' || count(*) filter (where situacao = 'nova') from public.treino_sugestoes where empresa_id = {TA}",
       sr, None, "5|5")
checar("Gestão não dispensa", False, f"select public.dispensar_sugestao_treino({ID1}, 'tratado')", au, G)
sv(f"select public.dispensar_sugestao_treino({ID1}, 'tratado')", au, Q)
sv(f"select public.gerar_sugestoes_treino({TA})", sr)
checar("dispensada fica dispensada por 30 dias (a noite não reabre)", True,
       f"select situacao || '|' || motivo_dispensa from public.treino_sugestoes where id = {ID1}", sr, None, "dispensada|tratado")
sv(f"select public.dispensar_sugestao_treino({ID1}, null)", au, Q)
checar("Desfazer volta para nova", True, f"select situacao from public.treino_sugestoes where id = {ID1}", sr, None, "nova")
sv(f"select public.dispensar_sugestao_treino({ID1}, 'falso_positivo')", au, Q)
sv(f"update public.treino_sugestoes set dispensada_ate = '{HOJE}'::date - 1 where id = {ID1}")
sv(f"select public.gerar_sugestoes_treino({TA})", sr)
checar("passados os 30 dias, se a regra ainda vale, volta como nova", True,
       f"select situacao || '|' || coalesce(motivo_dispensa, '-') from public.treino_sugestoes where id = {ID1}", sr, None, "nova|-")
CEN = LIN["item_reprovado:ck_cpc"]["cenario_id"]
sv(f"select public.atribuir_treino({TA}, {CEN}, array[{op('T120-A')}], '{HOJE}'::date + 7, 75, 2, null, {ID1})", au, Q)
sv(f"select public.gerar_sugestoes_treino({TA})", sr)
checar("aceita (virou treino) fica aceita com o treino aberto", True,
       f"select situacao from public.treino_sugestoes where id = {ID1}", sr, None, "aceita")
IDV = LIN[f"vulnerabilidade:idade_confusao:eq{EQ2}"]["id"]
sv(f"update public.treino_sugestoes set atualizada_em = now() - interval '9 days' where id = {IDV}")
sv(f"delete from public.voz_alertas where empresa_id = {TA} and tipo = 'vulnerabilidade'")
sv(f"select public.gerar_sugestoes_treino({TA})", sr)
checar("a regra parou de valer: some depois de 8 noites", True, f"select count(*) from public.treino_sugestoes where id = {IDV}", sr, None, 0)

# ---------------------------------------------------------------- leitura e módulo
checar("a Qualidade lê as sugestões da empresa", True,
       f"select count(*) > 0 from public.treino_sugestoes where empresa_id = {TA}", au, Q, "t")
checar("Qualidade de outra empresa não lê", True, f"select count(*) from public.treino_sugestoes where empresa_id = {TA}", au, QB, 0)
checar("Gestão não lê", True, f"select count(*) from public.treino_sugestoes where empresa_id = {TA}", au, G, 0)
sv(f"update public.empresa_modulos set ativo = false where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("módulo desligado: não gera", True, f"select public.gerar_sugestoes_treino({TA}) ->> 'desligado'", sr, None, "true")
sv(f"update public.empresa_modulos set ativo = true where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("pela VM (voz_vm): só empresa com voz configurada", False,
       f"select voz_vm.gerar_sugestoes_treino('{{\"empresa\": {TA}}}')", erro="sem voz configurada")
checar("a VM chama pela interface voz_vm (só o papel motorcx_voz)", True,
       "select has_function_privilege('motorcx_voz', 'voz_vm.gerar_sugestoes_treino(jsonb)', 'execute') "
       "and not has_function_privilege('authenticated', 'voz_vm.gerar_sugestoes_treino(jsonb)', 'execute')", valor="t")
checar("a noite só lê: nenhuma avaliação nova", True,
       f"select count(*) from public.voz_avaliacoes where empresa_id = {TA}", sr, None, 2)
checar("funções do SQL 120 com search_path fixo e security definer", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('gerar_sugestoes_treino', "
       "'cenario_sugestao_treino') and prosecdef and array_to_string(proconfig, ',') like '%search_path%'", sr, None, 2)

sv(f"delete from auth.users where id in ('{Q}', '{QB}', '{G}'); delete from public.empresas where id in ({TA}, {TB})")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
