"""SQL 100 · Roleplay, PR 5: sessão de treino por texto (conversa em andamento, contexto para a Edge Function, resultado
para a Qualidade), num Postgres local com as migrações aplicadas.

Cobre: a migração roda duas vezes; treino_turnos sem leitura/escrita do site nem de anon (só o servidor); o contexto
pelo link só com a chave do servidor e só do operador da sessão (token de outro operador, revogado ou sessão de teste
falham); logado, só quem abriu o treino lado a lado ou o teste, com a permissão certa; o roteiro do cliente simulado
vai no contexto (para a VM) e nunca em treino_meus; guardar a conversa recusa fala com CPF/telefone/e-mail e sessão
que já terminou ("Sair sem contar" pelo link fecha na hora); descartar com abandonar fecha sem uso (não conta, não
cobra); o ciclo inteiro com registrar_sessao_treino (avaliada conta a tentativa, cobra ia_treino_texto dentro da
franquia, nunca grava em voz_avaliacoes); resultado_sessao_treino para quem treina e para quem fez o teste, com a
revisão e as discordâncias; outra empresa e outros perfis não veem.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_treino_sessao.py
Só dados fictícios (empresas t100-*, e-mails @exemplo.test, operadores com apelido).
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
SQL100 = RAIZ / "supabase" / "migrations" / "20270211000001_treino_sessao_texto.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 100: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 100: " + nome + ("" if cond else f"  -> {detalhe[:600]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(obj) -> str:
    return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'"


for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL100)], capture_output=True, text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])

au, an, sr = "authenticated", "anon", "service_role"
HOJE = sv("select public.hoje_treino()")
T = uuid.uuid4().hex[:6]
TA = sv(f"insert into public.empresas (slug, nome) values ('t100-a-{T}', 'T100 A {T}') returning id")
TB = sv(f"insert into public.empresas (slug, nome) values ('t100-b-{T}', 'T100 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo) values ({TA}, 'speech_analytics', true), "
   f"({TB}, 'speech_analytics', true) on conflict (empresa_id, modulo) do update set ativo = true")
U = {}
for p, papel, emp in (("qa", "qualidade", TA), ("q2", "qualidade", TA), ("qb", "qualidade", TB), ("adm", "admin", TA), ("ges", "gestao", TA)):
    U[p] = sv(f"insert into auth.users (email) values ('t100.{p}.{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
Q, Q2, QB, A, G = U["qa"], U["q2"], U["qb"], U["adm"], U["ges"]

EQ = sv(f"select public.salvar_equipe_treino({TA}, 'Equipe Manhã')", au, Q)
OP1 = sv(f"select public.salvar_operador_treino({TA}, 'Bia R.', {EQ})", au, Q)
OP2 = sv(f"select public.salvar_operador_treino({TA}, 'Caio M.', {EQ})", au, Q)
GLOB = sv("select id from public.treino_cenarios where empresa_id is null and codigo = 'ja_pagou'")
AT = sv(f"select public.atribuir_treino({TA}, {GLOB}, array[{OP1}, {OP2}], '{HOJE}'::date + 7, 75, 2)", au, Q)
TK1 = json.loads(sv(f"select public.gerar_link_treino({OP1})", au, Q))["token"]
TK2 = json.loads(sv(f"select public.gerar_link_treino({OP2})", au, Q))["token"]
S1 = json.loads(sv(f"select public.treino_iniciar('{TK1}', {AT}, 'texto')", an))["sessao"]

# ---------------------------------------------------------------- treino_turnos: só o servidor
for papel, uid in ((an, None), (au, Q), (au, A)):
    checar(f"{papel}{' (Qualidade)' if uid == Q else ' (Admin)' if uid == A else ''} não lê treino_turnos", False,
           "select count(*) from public.treino_turnos", papel, uid)
checar("o site não grava em treino_turnos", False,
       f"insert into public.treino_turnos (sessao_id, empresa_id) values ({S1}, {TA})", au, Q)
checar("treino_turnos com RLS e sem policy", True,
       "select (select relrowsecurity from pg_class where oid = 'public.treino_turnos'::regclass) || '|' || "
       "(select count(*) from pg_policy where polrelid = 'public.treino_turnos'::regclass)", sr, None, "true|0")

# ---------------------------------------------------------------- contexto pelo link (só com a chave do servidor)
CTX = sv(f"select public.treino_contexto_sessao({S1}, '{TK1}')", sr)
c = json.loads(CTX)
caso("contexto pelo link: cenário inteiro (com o roteiro do cliente) e o checklist da sessão",
     c["sessao"] == int(S1) and c["cenario"]["frases"] and c["cenario"]["comportamentos"] and c["cenario"]["objetivo"]
     and isinstance(c["checklist"]["itens"], list) and c["turnos"] == [] and c["situacao"] == "em_andamento", CTX[:400])
checar("anon não chama o contexto (o roteiro do cliente nunca chega ao navegador)", False,
       f"select public.treino_contexto_sessao({S1}, '{TK1}')", an)
checar("o site logado não abre o contexto pelo token", False,
       f"select public.treino_contexto_sessao({S1}, '{TK1}')", au, Q, erro="só o serviço")
checar("token de outro operador não abre a sessão", False, f"select public.treino_contexto_sessao({S1}, '{TK2}')", sr,
       erro="sessão não encontrada")
checar("token errado não abre", False, f"select public.treino_contexto_sessao({S1}, '{'0' * 64}')", sr, erro="link inválido")
caso("treino_meus continua sem o roteiro do cliente",
     not {"frases", "comportamentos", "objecoes", "objetivo"} & set(json.loads(sv(f"select public.treino_meus('{TK1}')", an))["treinos"][0]["cenario"]))

# ---------------------------------------------------------------- guardar a conversa
TURNOS = [{"quem": "persona", "texto": "Alô?", "t": 0}, {"quem": "operador", "texto": "Boa tarde, falo da Assessoria Exemplo.", "t": 4},
          {"quem": "persona", "texto": "Mas eu já paguei isso!", "t": 9}]
checar("o site não guarda a conversa (só o servidor)", False,
       f"select public.treino_guardar_turnos({S1}, {j(TURNOS)}, 10)", au, Q)
checar("o servidor guarda a conversa, os tokens e o saldo fictício", True,
       f"select public.treino_guardar_turnos({S1}, {j(TURNOS)}, 120, 'R$ 2.340,00'); "
       f"select jsonb_array_length(turnos) || '|' || tokens || '|' || saldo from public.treino_turnos where sessao_id = {S1}",
       sr, None, "3|120|R$ 2.340,00")
checar("fala com telefone é recusada", False,
       f"select public.treino_guardar_turnos({S1}, {j(TURNOS + [{'quem': 'operador', 'texto': 'me liga no 11987654321'}])}, 0)", sr)
checar("fala com e-mail é recusada", False,
       f"select public.treino_guardar_turnos({S1}, {j(TURNOS + [{'quem': 'operador', 'texto': 'bia@exemplo.com'}])}, 0)", sr)
checar("o contexto devolve a conversa guardada", True,
       f"select jsonb_array_length(public.treino_contexto_sessao({S1}, '{TK1}') -> 'turnos')", sr, None, 3)

# ---------------------------------------------------------------- "Sair sem contar" pelo link fecha na hora
S2 = json.loads(sv(f"select public.treino_iniciar('{TK2}', {AT}, 'texto')", an))["sessao"]
sv(f"select public.treino_guardar_turnos({S2}, {j(TURNOS)}, 30)", sr)
sv(f"select public.treino_sair('{TK2}', {S2})", an)
checar("depois de sair pelo link, a conversa não é mais guardada", False,
       f"select public.treino_guardar_turnos({S2}, {j(TURNOS)}, 30)", sr, erro="já terminou")
checar("e não conta tentativa", True,
       f"select tentativas_usadas from public.treino_atribuicao_operadores where atribuicao_id = {AT} and operador_id = {OP2}", sr, None, 0)
S3 = json.loads(sv(f"select public.treino_iniciar('{TK2}', {AT}, 'texto')", an))["sessao"]
checar("saiu antes de falar: descartar com abandonar fecha sem uso (não conta, não cobra)", True,
       f"select public.treino_descartar_turnos({S3}, true); select situacao || '|' || uso_registrado || '|' || "
       f"(select count(*) from public.treino_turnos where sessao_id = {S3}) from public.treino_sessoes where id = {S3}",
       sr, None, "abandonada|false|0")
checar("o site não descarta a conversa", False, f"select public.treino_descartar_turnos({S1}, true)", au, Q)

# ---------------------------------------------------------------- o ciclo inteiro: avaliar e registrar
VERSAO = sv(f"select checklist_versao_id from public.treino_sessoes where id = {S1}")
DADOS = {"situacao": "avaliada", "duracao_s": 140, "nota": 50, "itens": {"ck_ident": "sim", "ck_cpc": "nao", "ck_resumo": "na"},
         "evidencia": {"ck_cpc": [4, 9]}, "reprovada": True, "item_reprovado": "ck_cpc", "objetivo_ok": False, "tokens": 300,
         "transcricao": TURNOS, "feedback": [{"item": "ck_cpc", "trecho": "Boa tarde, falo da Assessoria Exemplo.", "dica": "Confirme com quem fala antes do valor."}]}
checar("registrar a sessão avaliada (serviço) conta a tentativa", True,
       f"select public.registrar_sessao_treino({S1}, {j(DADOS)}) ->> 'conta_tentativa'; select public.treino_descartar_turnos({S1}); "
       f"select tentativas_usadas || '|' || situacao from public.treino_atribuicao_operadores where atribuicao_id = {AT} and operador_id = {OP1}",
       sr, None, "1|abaixo")
checar("a conversa em andamento some ao encerrar (fica só a transcrição de 90 dias)", True,
       f"select (select count(*) from public.treino_turnos where sessao_id = {S1}) || '|' || "
       f"(select count(*) from public.treino_transcricoes where sessao_id = {S1} and expira_em > now() + interval '80 days')", sr, None, "0|1")
checar("a sessão de texto entra no uso do mês (dentro da franquia: nada na fatura)", True,
       f"select u.sessoes_texto || '|' || (select count(*) from public.consumo_mensageria m where m.empresa_id = {TA} "
       f"and m.item = 'ia_treino_texto') from public.treino_uso_mes u where u.empresa_id = {TA}", sr, None, "1|0")
checar("nota de treino nunca vai para voz_avaliacoes", True,
       f"select count(*) from public.voz_avaliacoes where empresa_id = {TA}", sr, None, 0)
checar("o contexto de sessão encerrada diz que terminou", True,
       f"select public.treino_contexto_sessao({S1}, '{TK1}') ->> 'situacao'", sr, None, "avaliada")

# ---------------------------------------------------------------- resultado para a Qualidade
R = json.loads(sv(f"select public.resultado_sessao_treino({S1})", au, Q))
caso("resultado para quem treina: itens com texto, trecho e dica, transcrição, quem treinou e a tentativa",
     R["nota"] == 50 and R["operador"]["apelido"] == "Bia R." and R["tentativa"] == 1 and R["nota_minima"] == 75
     and R["feedback"][0]["dica"].startswith("Confirme") and len(R["transcricao"]) == 3
     and any(i["id"] == "ck_cpc" and i["texto"] for i in R["itens"]), json.dumps(R)[:500])
sv(f"select public.treino_discordar('{TK1}', {S1}, 'ck_cpc', 'Eu confirmei logo no começo.')", an)
sv(f"select public.revisar_sessao_treino({S1}, 'ck_cpc', 'sim')", au, Q)
R = json.loads(sv(f"select public.resultado_sessao_treino({S1})", au, Q))
caso("o resultado traz a revisão item a item e a discordância com o id para resolver",
     next(i for i in R["itens"] if i["id"] == "ck_cpc")["revisado"] == "sim" and R["discordancias"][0]["id"] > 0
     and R["discordancias"][0]["resolvida"] is False, json.dumps(R)[:500])
checar("Admin vê o resultado", True, f"select public.resultado_sessao_treino({S1}) ->> 'nota'", au, A, "50.00")
checar("Gestão não vê", False, f"select public.resultado_sessao_treino({S1})", au, G, erro="sem permissão")
checar("Qualidade da outra empresa não vê", False, f"select public.resultado_sessao_treino({S1})", au, QB, erro="sem permissão")
checar("anon não chama o resultado da Qualidade", False, f"select public.resultado_sessao_treino({S1})", an)

# ---------------------------------------------------------------- logado: treino lado a lado e teste do cenário
L = json.loads(sv(f"select public.iniciar_treino_lado_a_lado({AT}, {OP1}, 'texto')", au, Q))["sessao"]
checar("lado a lado: quem abriu lê o contexto com o próprio login", True,
       f"select public.treino_contexto_sessao({L}) ->> 'origem'", au, Q, "lado_a_lado")
checar("lado a lado: outra pessoa da Qualidade não conduz a sessão de quem abriu", False,
       f"select public.treino_contexto_sessao({L})", au, Q2, erro="sessão não encontrada")
checar("lado a lado: sessão do link não abre logado", False, f"select public.treino_contexto_sessao({S1})", au, Q)
TE = json.loads(sv(f"select public.testar_cenario_treino({GLOB}, {TA}, 'texto')", au, Q))["sessao"]
checar("teste: quem fez lê o contexto", True, f"select public.treino_contexto_sessao({TE}) ->> 'origem'", au, Q, "teste")
checar("teste: pelo token não abre (não é sessão do link)", False, f"select public.treino_contexto_sessao({TE}, '{TK1}')", sr)
sv(f"select public.registrar_sessao_treino({TE}, {j(DADOS)})", sr)
checar("teste: a transcrição fica só 1 dia", True,
       f"select count(*) from public.treino_transcricoes where sessao_id = {TE} and expira_em < now() + interval '2 days'", sr, None, 1)
sv(f"insert into public.permissoes_papel (empresa_id, papel, permissao, permitido) values ({TA}, 'qualidade', 'treinar_operadores', false)")
checar("teste: quem fez vê o resultado com editar_cenarios_treino (sem treinar_operadores)", True,
       f"select public.resultado_sessao_treino({TE}) ->> 'origem'", au, Q, "teste")
checar("sem treinar_operadores, a sessão de operador não abre", False, f"select public.resultado_sessao_treino({S1})", au, Q)
sv(f"delete from public.permissoes_papel where empresa_id = {TA} and papel = 'qualidade'")

checar("RPCs novas com search_path fixo e security definer", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('treino_contexto_sessao', "
       "'treino_guardar_turnos', 'treino_descartar_turnos', 'resultado_sessao_treino') and prosecdef "
       "and array_to_string(proconfig, ',') like '%search_path%'", sr, None, 4)

sv(f"delete from auth.users where id in ('{Q}', '{Q2}', '{QB}', '{A}', '{G}'); delete from public.empresas where id in ({TA}, {TB})")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
