"""SQL 63 · Speech Analytics: ligações da IA, temas novos, oferta e resultado por motivo, num Postgres local.

Cobre, pelo servidor (service_role, como o PostgREST) e pelo papel motorcx_voz (login de verdade, como a VM no acesso
próprio): a gravação da ligação da IA em voz_gravacoes (cliente e carteira da própria chamada; caminho com 10 dígitos,
nome que não é ia_<id> e campo a mais recusados; chamada que ainda não chegou volta em sem_chamada), o contexto da
análise casando a transcrição ia_<id> com a gravação da IA, a oferta nos códigos (só parcelas e faixa; valor
recusado), a dimensão oferta e sem_oferta (CRM) no job noturno, os trechos para os temas (só do cliente, sem tema e sem
intenção), propor tema (menos de 30 recusado; tema novo com item na Curadoria e nome sugerido; grupo entrando em tema
que existe; trecho repetido, de outra empresa ou nome com número recusados), a semana do tema contando os grupos (e o
job noturno mantendo), descartar e desfazer na Curadoria, o resultado por motivo (só o motor grava, só dias fechados,
grupo < 30 sem número na leitura, o site não lê a tabela) e a retroalimentação lendo os dias fechados.

Chamado pelo testar_rls.py; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_speech_ia.py
Só dados fictícios (CLI-xxxxx, textos inventados). No CI o login do motorcx_voz usa a senha do job (PGPASSWORD).
"""
import json
import os
import subprocess
import sys

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, papel=None, uid=None, usuario="postgres"):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-U", usuario, "-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None, usuario="postgres"):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid, usuario)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 63: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def vm(nome, esperado_ok, cmd, valor=None, erro=None):
    checar("VM (motorcx_voz) " + nome, esperado_ok, cmd, valor=valor, erro=erro, usuario="motorcx_voz")


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def j(v):
    return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"


SR = "service_role"
if os.environ.get("PGPASSWORD"):            # CI: scram para todo login (a senha descartável do banco de teste)
    sv("alter role motorcx_voz with password '" + os.environ["PGPASSWORD"].replace("'", "''") + "'")

# ---------------------------------------------------------------- dados fictícios
sv("delete from public.voz_curadoria_itens where empresa_id in (select id from public.empresas where slug like 'si-%')")
sv("delete from auth.users where email like 'si.%@exemplo.test'")
sv("delete from public.empresas where slug in ('si-aurora', 'si-boreal', 'si-cirrus')")
EA = sv("insert into public.empresas (slug, nome) values ('si-aurora', 'Aurora IA (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('si-boreal', 'Boreal IA (teste)') returning id")
EC = sv("insert into public.empresas (slug, nome) values ('si-cirrus', 'Cirrus sem voz (teste)') returning id")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cartao-si', 'Cartão Exemplo') returning id")
CB = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'carteira-si', 'Carteira Exemplo') returning id")
sv(f"insert into public.voz_config (empresa_id, speech_analytics) values ({EA}, true), ({EB}, true)")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("ope", "operacao", EA), ("admb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('si.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp}, nome='Pessoa {p}' where id='{U[p]}'")
HOJE = sv("select (now() at time zone 'America/Sao_Paulo')::date")
ONTEM = sv("select (now() at time zone 'America/Sao_Paulo')::date - 1")
SEMANA = sv(f"select date_trunc('week', '{ONTEM}'::date)::date")
QUANDO = f"(('{ONTEM}'::date + time '10:00') at time zone 'America/Sao_Paulo')"


def chamada(emp, credor, idc, cli, resultado="cpc", dias_atras=1):
    quando = f"(((now() at time zone 'America/Sao_Paulo')::date - {dias_atras} + time '10:00') at time zone 'America/Sao_Paulo')"
    return sv(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, id_acao, modo, ocorrido_em, "
              f"atendida_em, resultado, identidade_confirmada) values ({emp}, {credor}, '{idc}', '{cli}', 'acao-{idc}', 'real', "
              f"{quando}, {quando}, '{resultado}', true) returning id")


# ---------------------------------------------------------------- 1. gravação da ligação da IA
C1 = chamada(EA, CA, "aa11bb22", "CLI-10001", "promessa")
LIN = {"empresa_id": int(EA), "id_chamada": "aa11bb22", "caminho": f"credor_{CA}/2026/11/01/ia_aa11bb22.wav", "duracao_s": 61}
checar("servidor registra a gravação da IA (cliente, carteira e ação da própria chamada)", True,
       f"select public.registrar_gravacoes_ia_voz({j([LIN, dict(LIN, id_chamada='naochegou1', caminho='credor_0/x/ia_naochegou1.wav')])})::text; "
       f"select origem||'|'||id_cliente||'|'||credor_id||'|'||id_acao||'|'||duracao_s||'|'||(select tem_gravacao from public.voz_chamadas where id={C1}) "
       f"from public.voz_gravacoes where chamada_id={C1}", SR, None, f"ia|CLI-10001|{CA}|acao-aa11bb22|61|true")
checar("chamada que ainda não chegou volta em sem_chamada", True,
       f"select public.registrar_gravacoes_ia_voz({j([dict(LIN, id_chamada='naochegou1', caminho='credor_0/x/ia_naochegou1.wav')])})->>'sem_chamada'",
       SR, None, '["naochegou1"]')
checar("registrar de novo não duplica", True,
       f"select public.registrar_gravacoes_ia_voz({j([LIN])}); select count(*) from public.voz_gravacoes where chamada_id={C1}", SR, None, 1)
for nome, linha in (("caminho com 10 dígitos (pode ser telefone)", dict(LIN, caminho="credor_0/11988887777/ia_aa11bb22.wav")),
                    ("nome que não é ia_<id da chamada>", dict(LIN, caminho="credor_0/x/aa11bb22.wav")),
                    ("campo a mais (id_cliente)", dict(LIN, id_cliente="CLI-10001")),
                    ("caminho com caractere fora do padrão", dict(LIN, caminho="credor=0/x/ia_aa11bb22.wav"))):
    checar("recusa " + nome, False, f"select public.registrar_gravacoes_ia_voz({j([linha])})", SR)
checar("site não registra gravação", False, f"select public.registrar_gravacoes_ia_voz({j([LIN])})", "authenticated", U["adm"])
GIA = sv(f"select id from public.voz_gravacoes where chamada_id={C1}")

# o contexto casa a transcrição ia_<id> com a gravação da IA (nome do arquivo sem a extensão), mesmo com uma gravação
# do discador da mesma chamada
sv(f"insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, duracao_s) "
   f"values ({EA}, {CA}, {C1}, 'CLI-10001', 'discador', 'disc/2026/11/01/rec-77.wav', 120)")
checar("speech_contexto casa ia_<id> com a gravação da IA", True,
       f"select x->>'gravacao_id'||'|'||(x->>'origem') from jsonb_array_elements(public.speech_contexto_voz({EA}, "
       f"'[{{\"ref\": \"ia_aa11bb22\", \"caminho\": \"empresa_{EA}/ia_aa11bb22.json\"}}]')->'chamadas') x", SR, None, f"{GIA}|ia")

# ---------------------------------------------------------------- 2. oferta nos códigos e no job noturno
def analise(gid, codigos, sit="ok"):
    return j({"empresa_id": int(EA), "gravacao_id": int(gid), "situacao": sit, "versao": "speech-v1", "minutos": 1,
              "uso": {"chamadas_llm": 1, "tokens_entrada": 100, "tokens_saida": 10}, "codigos": codigos,
              "audio": {"fala_agente_s": 30, "fala_cliente_s": 20, "silencio_s": 5, "interrupcoes": 0}})


checar("código de oferta com valor é recusado", False,
       f"select public.gravar_analise_voz({analise(GIA, {'motivo': 'desemprego', 'oferta': 'R$ 150'})})", SR)
checar("oferta 6x entra nos códigos da análise", True,
       f"select public.gravar_analise_voz({analise(GIA, {'motivo': 'desemprego', 'oferta': '6x'})})->>'situacao'; "
       f"select codigos->>'oferta' from public.voz_analise_chamadas where chamada_id={C1}", SR, None, "6x")
C2 = chamada(EA, CA, "cc33dd44", "CLI-10002")
sv(f"set role service_role; select public.registrar_gravacoes_ia_voz({j([dict(LIN, id_chamada='cc33dd44', caminho='credor_0/x/ia_cc33dd44.wav')])})")
G2 = sv(f"select id from public.voz_gravacoes where chamada_id={C2}")
sv(f"set role service_role; select public.gravar_analise_voz({analise(G2, {'motivo': 'outro'})})")
sv(f"insert into public.crm_chamadas (empresa_id, id_chamada, classe, resultado_codigo) values ({EA}, 'cc33dd44', 'ok', 'ofertas_0')")
checar("job noturno: dimensão oferta (6x e sem_oferta do CRM) e funil", True,
       f"select public.agregar_speech_dia({EA}, '{ONTEM}'); select string_agg(dimensao||':'||valor||'='||conversas||'/'||com_acordo, ',' order by dimensao, valor) "
       f"from public.voz_conversao_dia where empresa_id={EA} and data='{ONTEM}' and (dimensao='oferta' or (dimensao='funil' and valor='oferta'))",
       SR, None, "funil:oferta=1/1,oferta:6x=1/1,oferta:sem_oferta=1/0")
checar("job noturno idempotente", True,
       f"select public.agregar_speech_dia({EA}, '{ONTEM}'); select count(*) from public.voz_conversao_dia where empresa_id={EA} and data='{ONTEM}' and dimensao='oferta'",
       SR, None, 2)

# ---------------------------------------------------------------- 3. temas: trechos, grupos e Curadoria
# 34 ligações sem tema e sem intenção (trecho do cliente e do agente), 1 com tema, 1 com intenção, 1 de outra empresa
TEMA_P = sv(f"insert into public.voz_temas (empresa_id, nome, situacao) values ({EA}, 'Boleto não chegou', 'promovido') returning id")
sv(f"""
do $$
declare cid bigint; gid bigint; k int; cods jsonb;
begin
  for k in 1..36 loop
    insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em, atendida_em, resultado)
    values ({EA}, {CA}, 'tm' || lpad(k::text, 4, '0'), 'CLI-2' || lpad(k::text, 4, '0'), 'real', {QUANDO}, {QUANDO},
            case when k % 4 = 0 then 'promessa' else 'cpc' end) returning id into cid;
    insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, duracao_s, gravada_em)
    values ({EA}, {CA}, cid, 'CLI-2' || lpad(k::text, 4, '0'), 'ia', 'credor_0/t/ia_tm' || lpad(k::text, 4, '0') || '.wav', 60, {QUANDO})
    returning id into gid;
    cods := case when k = 35 then jsonb_build_object('temas', jsonb_build_array({TEMA_P}))
                 when k = 36 then '{{"intencao": "quero_negociar"}}'::jsonb else '{{}}'::jsonb end;
    insert into public.voz_analise_chamadas (empresa_id, credor_id, chamada_id, gravacao_id, origem, dia, situacao, codigos)
    values ({EA}, {CA}, cid, gid, 'ia', '{ONTEM}', 'ok', cods);
    insert into public.voz_trechos (empresa_id, credor_id, gravacao_id, origem, inicio_s, fim_s, falante, texto_redigido)
    values ({EA}, {CA}, gid, 'ia', 10, 25, 'cliente', 'o pix não caiu na conta e já paguei faz dois dias'),
           ({EA}, {CA}, gid, 'ia', 0, 9, 'agente', 'aqui é a central de atendimento');
  end loop;
end $$""")
GB_C = chamada(EB, CB, "bb99", "CLI-30001")
GB = sv(f"insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, duracao_s, gravada_em) "
        f"values ({EB}, {CB}, {GB_C}, 'CLI-30001', 'ia', 'credor_0/t/ia_bb99.wav', 60, {QUANDO}) returning id")
sv(f"insert into public.voz_analise_chamadas (empresa_id, credor_id, chamada_id, gravacao_id, origem, dia, situacao) "
   f"values ({EB}, {CB}, {GB_C}, {GB}, 'ia', '{ONTEM}', 'ok')")
TB = sv(f"insert into public.voz_trechos (empresa_id, credor_id, gravacao_id, origem, inicio_s, fim_s, falante, texto_redigido) "
        f"values ({EB}, {CB}, {GB}, 'ia', 0, 10, 'cliente', 'o pix não caiu') returning id")
TR = json.loads(sv(f"select jsonb_agg(t.id order by t.id) from public.voz_trechos t join public.voz_analise_chamadas a on a.gravacao_id=t.gravacao_id "
                   f"where t.empresa_id={EA} and t.falante='cliente' and a.codigos = '{{}}'::jsonb and t.texto_redigido like 'o pix%'"))
assert len(TR) == 34, len(TR)
COM_VETOR = sv("select public.speech_vetor_voz()") == "t"

checar("trechos para os temas: só do cliente, sem tema e sem intenção, desta empresa", True,
       f"select jsonb_array_length(x->'trechos')||'|'||(x->>'vetor')||'|'||(select count(*) from jsonb_array_elements(x->'trechos') e where e->>'texto' like 'aqui é%') "
       f"from (select public.trechos_para_temas_voz({EA}, '{SEMANA}') x) s", SR, None, f"34|{str(COM_VETOR).lower()}|0")
checar("trechos para os temas: semana tem de ser segunda", False, f"select public.trechos_para_temas_voz({EA}, '{SEMANA}'::date + 1)", SR)
checar("site não lê os trechos para os temas", False, f"select public.trechos_para_temas_voz({EA}, '{SEMANA}')", "authenticated", U["adm"])


def propor(emp, tema, papel=SR):
    return f"select public.propor_tema_voz({emp}, '{SEMANA}', {j(tema)})"


checar("grupo com menos de 30 conversas nunca vira tema", False, propor(EA, {"trechos": TR[:29]}), SR, erro="menos de 30")
checar("nome sugerido com número é recusado", False, propor(EA, {"trechos": TR[:30], "sugestao": "Pix de 150"}), SR)
checar("trecho de outra empresa é recusado", False, propor(EA, {"trechos": TR[:30] + [int(TB)]}), SR)
checar("campo a mais no tema é recusado", False, propor(EA, {"trechos": TR[:30], "nome": "Pix"}), SR)
checar("empresa sem Speech Analytics não recebe tema", False, propor(EC, {"trechos": TR[:30]}), SR)
checar("site não propõe tema", False, propor(EA, {"trechos": TR[:30]}), "authenticated", U["adm"])
NOVO = json.loads(sv(f"set role service_role; {propor(EA, {'trechos': TR[:31], 'sugestao': 'Pix não compensou', 'exemplo': TR[0]})}"))
checar("30+ conversas: tema novo, sem nome, situação novo", True,
       f"select situacao||'|'||coalesce(nome, '-') from public.voz_temas where id={NOVO['tema_id']}", SR, None, "novo|-")
checar("tema novo vai para a Curadoria com o nome sugerido (sem nome dado)", True,
       f"select tipo||'|'||(decisao_ia->>'sugestao')||'|'||(decisao_ia->>'conversas')||'|'||coalesce(decisao_ia->>'valor','?')||'|'||(trecho_redigido like 'o pix%') "
       f"from public.voz_curadoria_itens where tema_id={NOVO['tema_id']}", SR, None, "tema|Pix não compensou|31||true")
checar("semana do tema conta as conversas dos grupos", True,
       f"select conversas||'|'||com_acordo from public.voz_temas_semana where tema_id={NOVO['tema_id']} and semana='{SEMANA}'",
       SR, None, f"31|{sum(1 for k in range(1, 32) if k % 4 == 0)}")
checar("trecho que já tem tema não entra de novo", False, propor(EA, {"trechos": TR[:31]}), SR)
checar("grupo parecido entra no tema que existe (sem item novo)", True,
       f"{propor(EA, {'tema_id': NOVO['tema_id'], 'trechos': TR[31:34]})}; select (select conversas from public.voz_temas_semana where tema_id={NOVO['tema_id']})"
       f"||'|'||(select count(*) from public.voz_curadoria_itens where tema_id={NOVO['tema_id']})", SR, None, "34|1")
checar("tema de outra empresa é recusado", False, propor(EB, {"tema_id": NOVO["tema_id"], "trechos": [int(TB)]}), SR)
checar("o job noturno mantém a contagem dos grupos e a do código", True,
       f"select public.agregar_speech_dia({EA}, '{ONTEM}'); select string_agg(tema_id::text||'='||conversas, ',' order by tema_id) "
       f"from public.voz_temas_semana where empresa_id={EA} and semana='{SEMANA}'", SR, None, f"{TEMA_P}=1,{NOVO['tema_id']}=34")
checar("amostra do tema existente volta para a próxima semana", True,
       f"select (select jsonb_array_length(t->'trechos') from jsonb_array_elements(public.trechos_para_temas_voz({EA}, '{SEMANA}')->'temas') t "
       f"where (t->>'id')::bigint={NOVO['tema_id']})", SR, None, 34)
checar("site não lê os trechos dos temas (sem privilégio)", False, "select * from public.voz_temas_trechos limit 1", "authenticated", U["adm"])
ITEM = sv(f"select id from public.voz_curadoria_itens where tema_id={NOVO['tema_id']}")
checar("Operação sem curadoria_voz não descarta", False, f"select public.curar_item_voz({ITEM}, 'descartar')", "authenticated", U["ope"])
checar("descartar o tema na Curadoria deixa o tema descartado", True,
       f"select public.curar_item_voz({ITEM}, 'descartar'); select situacao from public.voz_temas where id={NOVO['tema_id']}",
       "authenticated", U["adm"], "descartado")
checar("desfazer devolve o tema para novo", True,
       f"select public.curar_item_voz({ITEM}, 'desfazer'); select situacao from public.voz_temas where id={NOVO['tema_id']}",
       "authenticated", U["adm"], "novo")
checar("dar nome promove (a pessoa, não a IA)", True,
       f"select public.curar_item_voz({ITEM}, 'corrigir', 'Pix não compensou'); select situacao||'|'||nome from public.voz_temas where id={NOVO['tema_id']}",
       "authenticated", U["adm"], "promovido|Pix não compensou")
checar("retenção: o grupo vai embora com a gravação", True,
       f"delete from public.voz_gravacoes where id=(select gravacao_id from public.voz_trechos where id={TR[0]}); "
       f"select count(*) from public.voz_temas_trechos where trecho_id={TR[0]}", None, None, 0)

# ---------------------------------------------------------------- 4. resultado por motivo (pagou em 30 dias)
sv(f"""
do $$
declare cid bigint; gid bigint; k int;
begin
  for k in 1..40 loop
    insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em, atendida_em, resultado)
    values ({EA}, {CA}, 'rm' || lpad(k::text, 4, '0'), 'CLI-4' || lpad(k::text, 4, '0'), 'real', now() - interval '40 days',
            now() - interval '40 days', case when k <= 10 then 'promessa' else 'cpc' end) returning id into cid;
    insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, duracao_s)
    values ({EA}, {CA}, cid, 'CLI-4' || lpad(k::text, 4, '0'), 'ia', 'credor_0/r/ia_rm' || lpad(k::text, 4, '0') || '.wav', 60)
    returning id into gid;
    insert into public.voz_analise_chamadas (empresa_id, credor_id, chamada_id, gravacao_id, origem, dia, situacao, codigos)
    values ({EA}, {CA}, cid, gid, 'ia', '{HOJE}'::date - 40, 'ok',
            jsonb_build_object('motivo', case when k <= 32 then 'desemprego' else 'esquecimento' end));
  end loop;
end $$""")
PAGOS = [{"id_cliente": f"CLI-4{k:04d}", "data": sv(f"select '{HOJE}'::date - 30")} for k in range(1, 9)] + \
        [{"id_cliente": "CLI-40033", "data": sv(f"select '{HOJE}'::date - 2")},          # depois dos 30 dias: não conta
         {"id_cliente": "CLI-99999", "data": sv(f"select '{HOJE}'::date - 35")}]          # quem não foi ligado
checar("só o motor grava o resultado por motivo (site)", False,
       f"select public.gravar_resultado_por_motivo_voz({EA}, {CA}, {j(PAGOS)}, '{HOJE}')", "authenticated", U["adm"])
checar("pagamento com campo errado é recusado", False,
       f"select public.gravar_resultado_por_motivo_voz({EA}, {CA}, {j([{'cpf': '1'}])}, '{HOJE}')", SR)
checar("carteira de outra empresa é recusada", False,
       f"select public.gravar_resultado_por_motivo_voz({EA}, {CB}, {j(PAGOS)}, '{HOJE}')", SR)
checar("motor grava: conversas, promessas e pagou em 30 dias por motivo (só dias fechados)", True,
       f"select public.gravar_resultado_por_motivo_voz({EA}, {CA}, {j(PAGOS)}, '{HOJE}')->>'linhas'; "
       f"select string_agg(motivo||'='||conversas||'/'||promessas||'/'||pagamentos, ',' order by motivo) from public.voz_resultado_por_motivo where empresa_id={EA}",
       SR, None, "desemprego=32/10/8,esquecimento=8/0/0")
checar("de novo não soma em dobro", True,
       f"select public.gravar_resultado_por_motivo_voz({EA}, {CA}, {j(PAGOS)}, '{HOJE}'); select sum(conversas) from public.voz_resultado_por_motivo where empresa_id={EA}",
       SR, None, 40)
checar("dia ainda sem os 30 dias fechados não é gravado", True,
       f"select public.gravar_resultado_por_motivo_voz({EA}, {CA}, {j(PAGOS)}, '{HOJE}'::date - 15); select count(*) from public.voz_resultado_por_motivo where empresa_id={EA} and data > '{HOJE}'::date - 30",
       SR, None, 0)
checar("nenhum id de cliente fica gravado", True,
       "select count(*) from information_schema.columns where table_name='voz_resultado_por_motivo' and column_name in ('id_cliente','cpf')", SR, None, 0)
checar("site não lê a tabela direto", False, "select * from public.voz_resultado_por_motivo limit 1", "authenticated", U["adm"])
checar("leitura pela função: grupo com 30+ tem número; com menos, não", True,
       f"select (r->>'n')||'|'||(r->>'pagou_pct')||'|'||string_agg((m->>'valor')||':'||coalesce(m->>'n','-')||':'||coalesce(m->>'pagou_pct','-'), ',' order by m->>'valor') "
       f"from (select public.resultado_por_motivo_voz({EA}, null, '{HOJE}'::date - 90, '{HOJE}') r) x, jsonb_array_elements(r->'motivos') m group by r",
       "authenticated", U["adm"], "40|20.0|desemprego:32:25.0,esquecimento:-:-")
checar("outra empresa não lê o resultado por motivo", False,
       f"select public.resultado_por_motivo_voz({EA}, null, '{HOJE}'::date - 90, '{HOJE}')", "authenticated", U["admb"])
checar("retroalimentação lê os dias fechados (janela 30 dias para trás)", True,
       f"select jsonb_array_length(public.dados_retroalimentacao_voz({EA}, '{HOJE}'::date - 12, '{HOJE}'::date - 1)->'por_motivo')", SR, None, 2)

# ---------------------------------------------------------------- 4b. busca semântica: pendentes com a empresa (parte i/n)
BS = sv(f"insert into public.voz_buscas (empresa_id, usuario, termo, modo, situacao) values ({EA}, '{U['adm']}', 'pix não caiu', "
        f"'semantica', 'pendente') returning id")
BV = sv(f"insert into public.voz_buscas (empresa_id, usuario, termo, modo, situacao, em) values ({EA}, '{U['adm']}', 'velha', "
        f"'semantica', 'pendente', now() - interval '5 minutes') returning id")
PARTE_A = f"{int(EA) % 2 + 1}/2"
PARTE_OUTRA = f"{(int(EA) + 1) % 2 + 1}/2"
checar("buscas pendentes vêm com a empresa (custo do embedding na empresa certa)", True,
       f"select count(*) from jsonb_array_elements(public.buscas_semanticas_pendentes_voz('1/1', 100)) b "
       f"where (b->>'id')::bigint={BS} and (b->>'empresa_id')::bigint={EA} and b->>'termo'='pix não caiu'", SR, None, 1)
checar("busca parada há mais de 2 minutos vira erro", True, f"select situacao from public.voz_buscas where id={BV}", SR, None, "erro")
checar("só as buscas da parte desta VM", True,
       f"select (select count(*) from jsonb_array_elements(public.buscas_semanticas_pendentes_voz('{PARTE_A}', 100)) b where (b->>'id')::bigint={BS})"
       f"||'|'||(select count(*) from jsonb_array_elements(public.buscas_semanticas_pendentes_voz('{PARTE_OUTRA}', 100)) b where (b->>'id')::bigint={BS})",
       SR, None, "1|0")
checar("parte inválida é recusada", False, "select public.buscas_semanticas_pendentes_voz('3/2')", SR)
checar("site não lê as buscas pendentes", False, "select public.buscas_semanticas_pendentes_voz('1/1')", "authenticated", U["adm"])

# ---------------------------------------------------------------- 5. a VM pelo acesso próprio (motorcx_voz, login de verdade)
C3 = chamada(EA, CA, "ee55ff66", "CLI-10003")
LV = dict(LIN, id_chamada="ee55ff66", caminho="credor_0/x/ia_ee55ff66.wav")
vm("registra a gravação da IA", True,
   f"select voz_vm.registrar_gravacoes_ia('{{\"linhas\": {json.dumps([LV])}}}')->>'gravadas'", 1)
vm("não registra gravação de empresa sem voz", False,
   f"select voz_vm.registrar_gravacoes_ia('{{\"linhas\": {json.dumps([dict(LV, empresa_id=int(EC))])}}}')", erro="sem voz")
vm("lê os trechos para os temas da empresa com voz", True,
   f"select (voz_vm.trechos_para_temas('{{\"empresa\": {EA}, \"semana\": \"{SEMANA}\"}}')->>'ligado')", "true")
vm("não lê trechos de empresa sem voz", False,
   f"select voz_vm.trechos_para_temas('{{\"empresa\": {EC}, \"semana\": \"{SEMANA}\"}}')", erro="sem voz")
T36 = sv(f"select t.id from public.voz_trechos t join public.voz_gravacoes g on g.id=t.gravacao_id join public.voz_chamadas c on c.id=g.chamada_id "
         f"where c.id_chamada='tm0036' and t.falante='cliente'")
vm("propõe tema (grupo pequeno recusado igual ao servidor)", False,
   f"select voz_vm.propor_tema('{{\"empresa\": {EA}, \"semana\": \"{SEMANA}\", \"tema\": {{\"trechos\": [{T36}]}}}}')", erro="menos de 30")
vm("grupo entra num tema que existe", True,
   f"select voz_vm.propor_tema('{{\"empresa\": {EA}, \"semana\": \"{SEMANA}\", \"tema\": {{\"tema_id\": {NOVO['tema_id']}, \"trechos\": [{T36}]}}}}')->>'novo'", "false")
vm("sabe se há pgvector", True, "select voz_vm.speech_vetor('{}')::text", str(COM_VETOR).lower())
vm("recalcula a semana dos temas", True,
   f"select (voz_vm.recalcular_temas_semana('{{\"empresa\": {EA}, \"semana\": \"{SEMANA}\"}}'))::int >= 1", "t")
vm("não lê a tabela dos grupos", False, "select count(*) from public.voz_temas_trechos")
vm("lê as buscas semânticas pendentes da parte dela", True,
   f"select count(*) from jsonb_array_elements(voz_vm.buscas_semanticas_pendentes('{{\"parte\": \"{PARTE_A}\"}}')) b "
   f"where (b->>'id')::bigint={BS}", 1)
vm("não chama a RPC do public direto", False, "select public.buscas_semanticas_pendentes_voz('1/1')")
vm("não grava o resultado por motivo (é do motor)", False,
   f"select public.gravar_resultado_por_motivo_voz({EA}, {CA}, '[]', '{HOJE}')")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
