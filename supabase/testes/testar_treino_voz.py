"""SQL 119 · Roleplay, PR 6: sessão de treino por VOZ (contexto com a voz e o saldo de voz, uso do mês no "Meus
treinamentos", "Ouvir a voz" da cliente simulada), num Postgres local com as migrações aplicadas.

Cobre: a migração roda duas vezes; o contexto da sessão por voz traz voz_tts e voz_restante_s (franquia em segundos
menos o usado; texto: nulo); registrar a sessão por voz soma minutos (ia_treino_voz), desconta o saldo, avisa a 80% e
100% e, esgotada a franquia, a voz não abre mais e o texto continua; treino_meus traz voz_minutos/voz_franquia e nunca o
roteiro; treino_previa_voz pelo link só com a chave do servidor, só para treino do próprio operador com voz, até 6 por
hora (registradas); logado, quem treina ou edita cenários na empresa (Gestão e outra empresa não); nada vai para
voz_avaliacoes.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_treino_voz.py
Só dados fictícios (empresas t119-*, e-mails @exemplo.test, operadores com apelido).
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
SQL119 = RAIZ / "supabase" / "migrations" / "20270311000001_treino_voz.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 119: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 119: " + nome + ("" if cond else f"  -> {detalhe[:600]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"

for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL119)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])

au, an, sr = "authenticated", "anon", "service_role"
HOJE = sv("select public.hoje_treino()")
T = uuid.uuid4().hex[:6]
TA = sv(f"insert into public.empresas (slug, nome) values ('t119-a-{T}', 'T119 A {T}') returning id")
TB = sv(f"insert into public.empresas (slug, nome) values ('t119-b-{T}', 'T119 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true), "
   f"({TB}, 'speech_analytics', true) on conflict (empresa_id, modulo) do update set ativo = true")
U = {}
for p, papel, emp in (("qa", "qualidade", TA), ("qb", "qualidade", TB), ("adm", "admin", TA), ("ges", "gestao", TA)):
    U[p] = sv(f"insert into auth.users (email) values ('t119.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
Q, QB, A, G = U["qa"], U["qb"], U["adm"], U["ges"]

EQ = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Tarde')", au, Q)
OP1 = sv(f"select public.salvar_operador_treino({TA}, 'Dani P.', {EQ})", au, Q)
OP2 = sv(f"select public.salvar_operador_treino({TA}, 'Edu S.', {EQ})", au, Q)
GLOB = sv("select id from public.treino_cenarios where empresa_id is null and codigo = 'ja_pagou'")
AT = sv(f"select public.atribuir_treino({TA}, {GLOB}, array[{OP1}, {OP2}], '{HOJE}'::date + 7, 75, 3)", au, Q)
ATX = sv(f"select public.atribuir_treino({TA}, {GLOB}, array[{OP1}], '{HOJE}'::date + 7, 75, 3, array['texto'])", au, Q)
TK1 = json.loads(sv(f"select public.gerar_link_treino({OP1})", au, Q))["token"]
TK2 = json.loads(sv(f"select public.gerar_link_treino({OP2})", au, Q))["token"]
FR = int(sv(f"select public.franquia_treino({TA}, 'ia_treino_voz', date_trunc('month', public.hoje_treino())::date)", sr))

# ---------------------------------------------------------------- contexto da sessão por voz
SV = json.loads(sv(f"select public.treino_iniciar('{TK1}', {AT}, 'voz')", an))["sessao"]
c = json.loads(sv(f"select public.treino_contexto_sessao({SV}, '{TK1}')", sr))
caso("contexto por voz: modo, voz_tts no cenário e saldo de voz = franquia inteira em segundos",
     c["modo"] == "voz" and "voz_tts" in c["cenario"] and c["voz_restante_s"] == FR * 60, json.dumps(c)[:300])
ST = json.loads(sv(f"select public.treino_iniciar('{TK2}', {AT}, 'texto')", an))["sessao"]
checar("contexto por texto: sem saldo de voz", True,
       f"select coalesce(public.treino_contexto_sessao({ST}, '{TK2}') ->> 'voz_restante_s', 'nulo')", sr, None, "nulo")
sv(f"select public.treino_sair('{TK2}', {ST})", an)
checar("anon continua sem o contexto", False, f"select public.treino_contexto_sessao({SV}, '{TK1}')", an)

# ---------------------------------------------------------------- registrar a sessão por voz: minutos e saldo
TURNOS = [{"quem": "persona", "texto": "Alô?", "t": 0}, {"quem": "operador", "texto": "Boa tarde, falo da Assessoria Exemplo.", "t": 3}]
DADOS = {"situacao": "avaliada", "duracao_s": 125, "nota": 80, "itens": {"ck_ident": "sim", "ck_cpc": "sim"},
         "evidencia": {}, "reprovada": False, "objetivo_ok": True, "tokens": 900, "minutos_stt": 2.08, "caracteres_tts": 340,
         "transcricao": TURNOS, "feedback": []}
checar("registrar a sessão por voz conta a tentativa e soma 3 minutos (arredonda para cima)", True,
       f"select public.registrar_sessao_treino({SV}, {j(DADOS)}) ->> 'conta_tentativa'; "
       f"select minutos_voz || '|' || segundos_voz || '|' || sessoes_voz from public.treino_uso_mes where empresa_id = {TA}",
       sr, None, "3|125|1")
checar("a sessão guarda os minutos de STT e os caracteres de TTS (áudio não)", True,
       f"select minutos_stt || '|' || caracteres_tts || '|' || modo from public.treino_sessoes where id = {SV}", sr, None, "2.08|340|voz")
checar("o saldo de voz do contexto desconta o usado", True,
       f"select public.voz_restante_treino({TA})", sr, None, FR * 60 - 125)
m = json.loads(sv(f"select public.treino_meus('{TK1}')", an))
caso("treino_meus traz os minutos de voz do mês e a franquia (sem o roteiro)",
     m["voz_minutos"] == 3 and m["voz_franquia"] == FR and m["voz_disponivel"] is True
     and not {"frases", "comportamentos", "objecoes", "objetivo"} & set(m["treinos"][0]["cenario"]), json.dumps(m)[:300])
checar("o saldo de voz não é chamado pelo site", False, f"select public.voz_restante_treino({TA})", au, Q)

# 80%: aviso; 100%: voz bloqueia e o texto continua
sv(f"update public.treino_uso_mes set segundos_voz = {FR * 48 - 60}, minutos_voz = {FR * 48 // 60 - 1} where empresa_id = {TA}")
S80 = json.loads(sv(f"select public.treino_iniciar('{TK1}', {AT}, 'voz')", an))["sessao"]
sv(f"select public.registrar_sessao_treino({S80}, {j({**DADOS, 'duracao_s': 120})})", sr)
checar("a 80% dos minutos de voz, aviso no sino da empresa", True,
       f"select count(*) from public.avisos where empresa_id = {TA} and chave like 'treino_voz:%:80'", sr, None, 1)
sv(f"update public.treino_uso_mes set segundos_voz = {FR * 60 - 30}, minutos_voz = {FR} where empresa_id = {TA}")
checar("com a franquia no fim, a voz não abre mais", False, f"select public.treino_iniciar('{TK2}', {AT}, 'voz')", an,
       erro="minutos de voz")
checar("e o texto continua", True, f"select (public.treino_iniciar('{TK2}', {AT}, 'texto') ->> 'sessao') is not null", an, None, "t")
checar("treino_meus diz que a voz não está disponível", True,
       f"select public.treino_meus('{TK1}') ->> 'voz_disponivel'", an, None, "false")
checar("saldo de voz de 30 s no fim do mês", True, f"select public.voz_restante_treino({TA})", sr, None, 30)
checar("nota de treino por voz nunca vai para voz_avaliacoes", True,
       f"select count(*) from public.voz_avaliacoes where empresa_id = {TA}", sr, None, 0)

# ---------------------------------------------------------------- "Ouvir a voz"
checar("prévia pelo link: anon não chama", False, f"select public.treino_previa_voz('{TK1}', {AT})", an)
checar("prévia pelo link: o site logado não chama pelo token", False, f"select public.treino_previa_voz('{TK1}', {AT})", au, Q,
       erro="só o serviço")
p = json.loads(sv(f"select public.treino_previa_voz('{TK1}', {AT})", sr))
caso("prévia pelo link: só a voz, uma frase fictícia e a empresa (nunca o roteiro)",
     set(p) == {"empresa", "voz_tts", "frase"} and p["empresa"] == int(TA) and 3 <= len(p["frase"]) <= 200, json.dumps(p))
checar("prévia registrada no acesso do link", True,
       f"select count(*) from public.treino_link_acessos x join public.treino_links l on l.id = x.link_id "
       f"where l.operador_id = {OP1} and x.acao = 'ouvir'", sr, None, 1)
checar("prévia de treino só por texto: não", False, f"select public.treino_previa_voz('{TK1}', {ATX})", sr, erro="não encontrado")
checar("prévia de treino de outro operador: não", False,
       f"select public.treino_previa_voz('{TK2}', {ATX})", sr, erro="não encontrado")
for _ in range(5):
    sv(f"select public.treino_previa_voz('{TK1}', {AT})", sr)
checar("até 6 prévias por hora pelo link", False, f"select public.treino_previa_voz('{TK1}', {AT})", sr, erro="limite de prévias")
checar("logado: a Qualidade ouve a voz do cenário da biblioteca", True,
       f"select (public.treino_previa_voz(null, null, {GLOB}, {TA}) ->> 'empresa')::bigint = {TA}", au, Q, "t")
checar("logado: Admin também", True, f"select (public.treino_previa_voz(null, null, {GLOB}, {TA}) ->> 'frase') is not null", au, A, "t")
checar("logado: Gestão não", False, f"select public.treino_previa_voz(null, null, {GLOB}, {TA})", au, G, erro="sem permissão")
checar("logado: Qualidade de outra empresa não", False, f"select public.treino_previa_voz(null, null, {GLOB}, {TA})", au, QB,
       erro="sem permissão")
CB = sv(f"select public.salvar_cenario_treino({TB}, " + j({"nome": "Cenário B", "persona_nome": "Lia (fictícia)", "perfil": "irritado",
        "objetivo": "Irritada com as ligações.", "frases": ["Já falei que não posso agora."]}) + ")", au, QB)
checar("logado: cenário de outra empresa não", False, f"select public.treino_previa_voz(null, null, {CB}, {TA})", au, Q,
       erro="não encontrado")
sv(f"update public.empresa_modulos set ativo = false where empresa_id = {TA} and modulo = 'speech_analytics'")
checar("módulo desligado: prévia indisponível", False, f"select public.treino_previa_voz(null, null, {GLOB}, {TA})", au, A)
sv(f"update public.empresa_modulos set ativo = true where empresa_id = {TA} and modulo = 'speech_analytics'")

checar("RPCs do SQL 119 com search_path fixo e security definer", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('treino_contexto_sessao', "
       "'treino_meus', 'treino_previa_voz', 'voz_restante_treino') and prosecdef "
       "and array_to_string(proconfig, ',') like '%search_path%'", sr, None, 4)

sv(f"delete from auth.users where id in ('{Q}', '{QB}', '{A}', '{G}'); delete from public.empresas where id in ({TA}, {TB})")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
