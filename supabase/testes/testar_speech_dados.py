"""SQL 62 · dados do Speech Analytics: o banco recebe o que a VM produz (voz/analise/analisador.py, com LLM falso) pelas
RPCs do public como o PostgREST chamaria (service_role, argumentos por nome), e o job noturno agrega o dia.

Cobre: contexto da análise (casa transcrição com gravação, sem id_cliente; empresa desligada), gravação da análise
numa transação (avaliação, códigos, alertas, curadoria, uso de IA com custo real e minuto cobrado uma vez só),
reenvio e falha, recusas (código fora da lista, intenção fora do catálogo, tema/versão/gravação de outra empresa,
campo a mais, trecho com CPF, empresa desligada, site e anon), agregados idempotentes com o piso de 30 na leitura,
operador só com o ID do discador, retroalimentação pela RPC e retenção (a análise vai embora com a gravação).

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_speech_dados.py
Só dados fictícios (IDs CLI-xxxxx, operador OP-7, transcrições inventadas).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))

from voz.analise import analisador as AN          # noqa: E402
from voz.analise import rotina as RT              # noqa: E402
from voz.provedores.montagem import Resposta      # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 62: " + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def caso(nome, passou, detalhe=""):
    global ok_total, falhas
    ok_total += bool(passou)
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 62: " + nome + ("" if passou else f"  -> {detalhe}"))


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def _lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


class PostgRESTServidor:
    """Como o PostgREST com a chave do servidor: public.<rpc>(arg => valor) como service_role."""

    def __init__(self):
        self.chamadas = []

    def rpc(self, nome, args=None):
        self.chamadas.append(nome)
        partes = ", ".join(f"{k} => {_lit(v)}" for k, v in (args or {}).items())
        ok, out, err = sql(f"select to_jsonb(public.{nome}({partes}))", "service_role")
        if not ok:
            raise RuntimeError(err[:300])
        return json.loads(out) if out else None


# ---------------------------------------------------------------- dados fictícios
sv("delete from auth.users where email like 'sd.%@exemplo.test'")
sv("delete from public.empresas where slug in ('sd-aurora', 'sd-boreal', 'sd-cirrus')")
EA = sv("insert into public.empresas (slug, nome) values ('sd-aurora', 'Aurora Dados (teste)') returning id")
EB = sv("insert into public.empresas (slug, nome) values ('sd-boreal', 'Boreal Dados (teste)') returning id")
EC = sv("insert into public.empresas (slug, nome) values ('sd-cirrus', 'Cirrus sem voz (teste)') returning id")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'cartao-sd', 'Cartão Exemplo') returning id")
CB = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'carteira-sd', 'Carteira Exemplo') returning id")
sv(f"insert into public.voz_config (empresa_id, speech_analytics) values ({EA}, true), ({EB}, false)")
TEMA = sv(f"insert into public.voz_temas (empresa_id, nome, situacao) values ({EA}, 'Boleto não chegou', 'promovido') returning id")
TEMA_NOVO = sv(f"insert into public.voz_temas (empresa_id) values ({EA}) returning id")
TEMA_B = sv(f"insert into public.voz_temas (empresa_id, nome, situacao) values ({EB}, 'Outro tema', 'promovido') returning id")
U = {}
for p, papel in (("adm", "admin"), ("ges", "gestao"), ("ope", "operacao")):
    U[p] = sv(f"insert into auth.users (email) values ('sd.{p}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={EA}, nome='Pessoa {p}' where id='{U[p]}'")
ONTEM = sv("select (now() at time zone 'America/Sao_Paulo')::date - 1")
QUANDO = f"(('{ONTEM}'::date + time '10:00') at time zone 'America/Sao_Paulo')"


def chamada(emp, credor, idc, cli, resultado="cpc", ident=True, op=None, origem="ia", sufixo=""):
    cid = sv(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em, atendida_em, "
             f"resultado, identidade_confirmada) values ({emp}, {credor}, '{idc}', '{cli}', 'real', {QUANDO}, {QUANDO}, "
             f"'{resultado}', {str(ident).lower()}) on conflict (empresa_id, id_chamada, canal) do update set resultado = excluded.resultado "
             f"returning id")
    gid = sv(f"insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, duracao_s, "
             f"operador_ref, gravada_em) values ({emp}, {credor}, {cid}, '{cli}', '{origem}', "
             f"'c{credor}/A1_{idc}{sufixo}.wav', 90, {_lit(op)}, {QUANDO}) returning id")
    return cid, gid


CHECK = json.loads(sv("select v.itens from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id "
                      "where c.empresa_id is null and v.situacao = 'em_uso'"))
INTENCOES = tuple(json.loads(sv("select jsonb_agg(codigo order by codigo) from public.voz_intencoes where ativa")))
SEGS = {"duracao_s": 90, "segmentos": [
    {"inicio": 0, "fim": 5, "texto": "Olá, aqui é a central da Assessoria Exemplo. Falo com o titular?"},
    {"inicio": 5.5, "fim": 8, "texto": "Sou eu."},
    {"inicio": 8.5, "fim": 14, "texto": "Para sua segurança, me confirma o dia do seu nascimento?"},
    {"inicio": 14.5, "fim": 22, "texto": "Quinze de março. Perdi o emprego, estou sem dinheiro agora."},
    {"inicio": 23, "fim": 33, "texto": "Entendo. Tenho uma condição em parcelas. Posso mandar o link agora?"},
    {"inicio": 34, "fim": 45, "texto": "Se continuar me ligando eu vou no Procon."}]}


def resposta(i=0, ck_cpc="sim", conf_oferta=0.9, motivo="desemprego", tema=True, **mudar):
    r = {"itens": [{"id": c["id"], "resposta": "sim", "confianca": 0.95, "segmento": 0} for c in CHECK],
         "motivo": {"probabilidades": {motivo: 0.85}, "segmento": 3},
         "objecoes": ["sem_dinheiro_agora"], "objecao_principal": None,
         "intencao": {"codigo": "sem_dinheiro" if "sem_dinheiro" in INTENCOES else INTENCOES[0], "confianca": 0.9,
                      "alternativas": [], "segmento": 3},
         "canal_preferido": "whatsapp" if i % 3 == 0 else None, "horario_preferido": None,
         "vulnerabilidade": [{"sinal": "desemprego_recente", "segmento": 3}] if i == 0 else [],
         "riscos": [{"tipo": "procon", "falante": "cliente", "segmento": 5}] if i == 0 else [],
         "frases": ["link_na_ligacao"], "temas": [int(TEMA)] if tema else [], "sentimento": {"inicio": -0.5, "fim": 0.2},
         "falantes": "ACACAC", "transcricao_ruim": 0.02}
    for it in r["itens"]:
        if it["id"] == "ck_cpc":
            it["resposta"] = ck_cpc
        if it["id"] == "ck_oferta":
            it["confianca"] = conf_oferta
    r.update(mudar)
    return r


class LLM:
    def __init__(self, *respostas):
        self.fila = list(respostas)

    def responder(self, m, f):
        a = self.fila.pop(0)
        return Resposta("", [] if a is None else [(AN.FERRAMENTA, a)], tokens=1500, tokens_entrada=1300, tokens_saida=200)


SB = PostgRESTServidor()


def contexto(emp, refs):
    return SB.rpc("speech_contexto_voz", {"empresa": emp, "refs": refs})


def ctx_de(emp, geral, ref):
    c = [x for x in geral["chamadas"] if x["ref"] == ref][0]
    return RT._contexto(int(emp), c, geral, "modelo-teste")


# ---------------------------------------------------------------- contexto
C1, G1 = chamada(EA, CA, "sd-0001", "CLI-00001", resultado="promessa")
C2, G2 = chamada(EA, CA, "sd-0002", "CLI-00002")
_, G2D = chamada(EA, CA, "sd-0002", "CLI-00002", op="OP-7", origem="discador", sufixo="-op")
CB1, GB1 = chamada(EB, CB, "sd-b001", "CLI-00009")
geral = contexto(EA, [{"ref": G1, "caminho": f"empresa_{EA}/{G1}.json"}, {"ref": "sd-0001", "caminho": ""},
                      {"ref": "sd-0002", "caminho": ""}, {"ref": "A1_sd-0002-op", "caminho": ""}, {"ref": GB1, "caminho": ""},
                      {"ref": "nao-existe", "caminho": ""}])
por = {c["ref"]: c for c in geral["chamadas"]}
caso("contexto casa pelo id da gravação", por.get(str(G1), {}).get("gravacao_id") == int(G1), por.get(str(G1)))
caso("contexto casa pelo id_chamada (só a gravação da IA)", por.get("sd-0001", {}).get("gravacao_id") == int(G1))
caso("contexto prefere a gravação do discador no mesmo id_chamada", por.get("sd-0002", {}).get("gravacao_id") == int(G2D)
     and por["sd-0002"].get("operador_ref") == "OP-7" and por["sd-0002"].get("origem") == "discador")
caso("contexto casa pelo nome do arquivo da gravação", por.get("A1_sd-0002-op", {}).get("gravacao_id") == int(G2D))
caso("contexto não casa gravação de outra empresa nem o que não existe", str(GB1) not in por and "nao-existe" not in por)
caso("contexto traz a versão vigente do checklist (padrão) e os itens dela",
     por[str(G1)].get("versao_id") is not None and str(por[str(G1)]["versao_id"]) in geral["checklists"])
caso("contexto traz o dia da ligação e não traz id_cliente", por[str(G1)].get("dia") == ONTEM and "CLI-" not in json.dumps(geral))
caso("contexto traz só os temas promovidos da empresa", [t["id"] for t in geral["temas"]] == [int(TEMA)])
caso("contexto traz o catálogo de intenções", tuple(geral["intencoes"]) == INTENCOES)
caso("empresa com o Speech Analytics desligado: contexto vazio", contexto(EB, [{"ref": GB1, "caminho": ""}]) ==
     {"ligado": False, "chamadas": []})
_, GAMB = chamada(EA, CA, "sd-0003", "CLI-00003")
sv(f"update public.voz_gravacoes set caminho = 'c{CA}/x/{G1}.wav' where id = {GAMB}")
caso("duas gravações pela mesma regra: ambígua (a VM não analisa)",
     [c for c in contexto(EA, [{"ref": f"{G1}x", "caminho": ""}])["chamadas"]] == [] and
     contexto(EA, [{"ref": "sd-0003", "caminho": ""}])["chamadas"][0].get("gravacao_id") == int(GAMB))
sv(f"update public.voz_gravacoes set caminho = 'c{CA}/x/amb.wav' where id = {GAMB}")
_, GAMB2 = chamada(EA, CA, "sd-0004", "CLI-00004", sufixo="-amb")
sv(f"update public.voz_gravacoes set caminho = 'c{CA}/y/amb.wav' where id = {GAMB2}")
caso("... mesmo nome de arquivo em duas gravações = ambígua",
     contexto(EA, [{"ref": "amb", "caminho": ""}])["chamadas"] == [{"ref": "amb", "ambigua": True}])
checar("contexto recusa ref com caractere fora do padrão", False,
       f"select public.speech_contexto_voz({EA}, '[{{\"ref\": \"../x\", \"caminho\": \"\"}}]')", "service_role", erro="refs")

# ---------------------------------------------------------------- gravar: a primeira análise
c1 = ctx_de(EA, geral, str(G1))
r1 = AN.processar(SB, LLM(resposta(0, conf_oferta=0.4)), c1, SEGS)
caso("grava a análise (ok, cobrada, com avaliação)", r1.get("situacao") == "ok" and r1.get("cobrado") is True
     and r1.get("avaliacao_id"), r1)
checar("avaliação na versão do padrão, nota 100, sem reprovação", True,
       f"select nota || '|' || reprovada || '|' || origem || '|' || (modelo like 'speech-v1:%') from public.voz_avaliacoes where chamada_id = {C1}",
       valor="100.00|false|ia|true")
checar("códigos fechados na análise (sem vulnerabilidade, sem texto)", True,
       f"select (select string_agg(k, ',' order by k) from jsonb_object_keys(codigos) k) || '|' || (codigos ->> 'motivo') "
       f"|| '|' || (codigos ->> 'riscos') || '|' || (codigos -> 'temas' ->> 0) from public.voz_analise_chamadas where chamada_id = {C1}",
       valor=f"canal_preferido,frases,intencao,motivo,objecoes,riscos,temas|desemprego|[\"procon\"]|{TEMA}")
checar("códigos por cliente de sempre (codigos_voz_validos) também na chamada", True,
       f"select codigos ->> 'motivo' || '|' || (codigos -> 'objecoes' ->> 0) || '|' || (codigos ->> 'canal_preferido') "
       f"|| '|' || (codigos ? 'riscos') from public.voz_chamadas where id = {C1}", valor="desemprego|sem_dinheiro_agora|whatsapp|false")
checar("áudio e sentimento da gravação", True,
       f"select fala_agente_s || '|' || fala_cliente_s || '|' || interrupcoes || '|' || sentimento_ini || '|' || sentimento_fim "
       f"from public.voz_analise_chamadas where chamada_id = {C1}", valor="20|21|0|-0.500|0.200")
checar("alerta de vulnerabilidade só com o sinal (sem trecho) e Procon com o trecho mascarado", True,
       f"select string_agg(tipo || ':' || coalesce(sinal, '-') || ':' || (trecho_redigido is not null) || ':' || id_cliente, ',' "
       f"order by tipo) from public.voz_alertas where chamada_id = {C1}",
       valor="procon:-:true:CLI-00001,vulnerabilidade:desemprego_recente:false:CLI-00001")
checar("item do checklist com pouca confiança vai para a Curadoria ligado à avaliação", True,
       f"select tipo || '|' || situacao || '|' || (decisao_ia ->> 'item') || '|' || (avaliacao_id = {r1.get('avaliacao_id') or 0}) "
       f"from public.voz_curadoria_itens where chamada_id = {C1}", valor="nota|aberto|ck_oferta|true")
checar("uso de IA: tokens reais, custo pela premissa e o minuto analisado cobrado", True,
       f"select chamadas || '|' || minutos_cobrados || '|' || tokens_entrada || '|' || tokens_saida || '|' || (custo_real > 0) "
       f"|| '|' || sem_custo from public.voz_analise_consumo where empresa_id = {EA} and componente = 'avaliador'",
       valor="1|1.50|1300|200|true|false")
checar("... a fatura recebe ceil(minutos) no item ia_speech_analytics (preço da empresa, nunca o custo)", True,
       f"select quantidade from public.consumo_mensageria where empresa_id = {EA} and item = 'ia_speech_analytics'", valor=2)
checar("... e o custo real espelhado em consumo_ia (SQL 61)", True,
       f"select (custo > 0) || '|' || tokens from public.consumo_ia where empresa_id = {EA} and item = 'ia_speech_analytics'",
       valor="true|1500")

# reenvio: não muda nada, só registra o custo da tentativa
r1b = AN.processar(SB, LLM(resposta(0)), c1, SEGS)
caso("reenvio da mesma gravação: ja_analisada", r1b.get("situacao") == "ja_analisada", r1b)
checar("... sem cobrar de novo e sem alerta duplicado; o custo da tentativa fica", True,
       f"select (select minutos_cobrados || '|' || tokens_entrada from public.voz_analise_consumo where empresa_id = {EA} "
       f"and componente = 'avaliador') || '|' || (select count(*) from public.voz_alertas where chamada_id = {C1})",
       valor="1.50|2600|2")

# falha (LLM sem resposta válida) e depois acerto
c2 = ctx_de(EA, geral, "sd-0002")
rf = AN.processar(SB, LLM(None, None, None), c2, SEGS)
caso("resposta inválida em todas as tentativas: falhou", rf.get("situacao") == "falhou", rf)
AN.processar(SB, LLM(None, None, None), c2, SEGS)
checar("... falhou conta as tentativas e não cobra", True,
       f"select situacao || '|' || tentativas || '|' || codigos::text from public.voz_analise_chamadas where gravacao_id = {G2D}",
       valor="falhou|2|{}")
checar("... e não cobrou minuto (custo das tentativas registrado)", True,
       f"select minutos_cobrados || '|' || tokens_saida from public.voz_analise_consumo where empresa_id = {EA} and componente = 'avaliador'",
       valor="1.50|1600")
geral2 = contexto(EA, [{"ref": "sd-0002", "caminho": ""}])
caso("... o contexto mostra a falha e as tentativas", geral2["chamadas"][0].get("situacao") == "falhou"
     and geral2["chamadas"][0].get("tentativas") == 2)
itens_h = AN.itens_aplicaveis(CHECK, "discador")
r2 = AN.processar(SB, LLM(resposta(1, ck_cpc="nao", tema=False)), c2, SEGS)
checar("depois a análise dá certo: ok, discador, operador do discador, reprovada no item de lei", True,
       f"select a.situacao || '|' || a.tentativas || '|' || a.operador_ref || '|' || v.reprovada || '|' || v.item_reprovado "
       f"|| '|' || v.operador_ref from public.voz_analise_chamadas a join public.voz_avaliacoes v on v.chamada_id = a.chamada_id "
       f"and v.origem = a.origem where a.gravacao_id = {G2D}", valor="ok|3|OP-7|true|ck_cpc|OP-7")

# ---------------------------------------------------------------- recusas
def bruto(**mudar):
    a = {"empresa_id": int(EA), "gravacao_id": int(G1), "situacao": "ok", "versao": "speech-v1", "minutos": 1,
         "uso": {"chamadas_llm": 1, "tokens_entrada": 1, "tokens_saida": 1}, "codigos": {}}
    a.update(mudar)
    return "select public.gravar_analise_voz(" + _lit(a) + ")"


_, GN = chamada(EA, CA, "sd-0010", "CLI-00010")
checar("código fora da lista é recusado", False, bruto(gravacao_id=int(GN), codigos={"motivo": "doenca"}), "service_role",
       erro="listas fechadas")
checar("saúde nunca vira código", False, bruto(gravacao_id=int(GN), codigos={"saude": "cancer"}), "service_role",
       erro="listas fechadas")
checar("intenção fora do catálogo é recusada", False, bruto(gravacao_id=int(GN), codigos={"intencao": "inventada"}),
       "service_role", erro="catálogo")
checar("tema de outra empresa é recusado", False, bruto(gravacao_id=int(GN), codigos={"temas": [int(TEMA_B)]}),
       "service_role", erro="tema")
checar("tema ainda sem nome (não promovido) é recusado", False, bruto(gravacao_id=int(GN), codigos={"temas": [int(TEMA_NOVO)]}),
       "service_role", erro="tema")
CKB = sv(f"insert into public.checklists_qualidade (empresa_id, nome) values ({EB}, 'Checklist B') returning id")
VB = sv(f"insert into public.checklist_versoes (checklist_id, versao, situacao, itens, vigente_de) select {CKB}, 1, 'em_uso', "
        f"v.itens, date '2026-01-01' from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id "
        f"where c.empresa_id is null and v.situacao = 'em_uso' returning id")
checar("versão do checklist de outra empresa é recusada", False,
       bruto(gravacao_id=int(GN), avaliacao={"versao_id": int(VB), "nota": 90, "itens": {"ck_cpc": "sim"}}), "service_role",
       erro="checklist")
checar("item fora da versão é recusado", False,
       bruto(gravacao_id=int(GN), avaliacao={"versao_id": int(c1.versao_id), "nota": 90, "itens": {"ck_inventado": "sim"}}),
       "service_role", erro="item fora")
checar("gravação de outra empresa é recusada", False, bruto(gravacao_id=int(GB1)), "service_role", erro="não encontrada")
checar("campo a mais (id_cliente) é recusado", False, bruto(gravacao_id=int(GN), id_cliente="CLI-00010"), "service_role",
       erro="não grava")
checar("trecho com CPF no alerta é recusado pelo banco", False,
       bruto(gravacao_id=int(GN), alertas=[{"tipo": "procon", "falante": "cliente", "trecho": "CPF 123.456.789-09"}]),
       "service_role")
checar("vulnerabilidade nunca guarda trecho (o banco descarta)", True,
       bruto(gravacao_id=int(GN), alertas=[{"tipo": "vulnerabilidade", "sinal": "luto", "falante": "cliente",
                                            "trecho": "Meu pai faleceu semana passada."}])
       + f"; select count(*) || '|' || bool_and(trecho_redigido is null) from public.voz_alertas where gravacao_id = {GN}",
       "service_role", valor="1|true")
sv(f"update public.voz_config set speech_analytics = true where empresa_id = {EB}")
sv(f"update public.voz_config set speech_analytics = false where empresa_id = {EB}")
checar("empresa com o Speech Analytics desligado é recusada", False,
       bruto(empresa_id=int(EB), gravacao_id=int(GB1)), "service_role", erro="desligado")
checar("o site não grava a análise", False, bruto(gravacao_id=int(GN)), "authenticated", U["adm"])
checar("anon não grava a análise", False, bruto(gravacao_id=int(GN)), "anon")
checar("outro login (não a VM nem o servidor) não grava", False, bruto(gravacao_id=int(GN)), erro="só o servidor")
checar("o site não lê voz_analise_chamadas", False, "select count(*) from public.voz_analise_chamadas", "authenticated", U["adm"])
checar("anon não lê voz_analise_chamadas", False, "select count(*) from public.voz_analise_chamadas", "anon")
for f in ("speech_contexto_voz(1, '[]')", "agregar_speech_dia(1, current_date)", "speech_empresas_voz('1/1')",
          "dados_retroalimentacao_voz(1, current_date, current_date)", "recomendacoes_aplicadas_voz(1)"):
    checar(f"o site não chama {f.split('(')[0]}", False, f"select public.{f}", "authenticated", U["adm"])

# ---------------------------------------------------------------- volume para o job noturno (35 da IA, 10 do discador)
for i in range(33):
    cid, gid = chamada(EA, CA, f"sd-1{i:03d}", f"CLI-1{i:04d}", resultado="promessa" if i % 3 == 0 else "cpc", ident=i % 4 != 0)
    g = contexto(EA, [{"ref": gid, "caminho": ""}])
    AN.processar(SB, LLM(resposta(i + 1, motivo="esquecimento" if i % 2 else "desemprego")), ctx_de(EA, g, str(gid)), SEGS)
for i in range(9):
    cid, gid = chamada(EA, CA, f"sd-2{i:03d}", f"CLI-2{i:04d}", op="OP-7", origem="discador")
    g = contexto(EA, [{"ref": gid, "caminho": ""}])
    AN.processar(SB, LLM(resposta(i + 1, tema=False) | {"itens": [{"id": c["id"], "resposta": "sim", "confianca": 0.95,
                                                                  "segmento": 0} for c in itens_h]}),
                 ctx_de(EA, g, str(gid)), SEGS)
checar("45 gravações analisadas no dia (35 da IA, 10 do discador)", True,
       f"select string_agg(origem || ':' || n, ',' order by origem) from (select origem, count(*) n from public.voz_analise_chamadas "
       f"where empresa_id = {EA} and situacao = 'ok' and dia = '{ONTEM}' group by origem) x", valor="discador:10,ia:35")

# ---------------------------------------------------------------- job noturno
noite = RT.noite(SB, __import__("datetime").date.fromisoformat(ONTEM) + __import__("datetime").timedelta(days=1), dias=1)
caso("a noite agrega as empresas ligadas desta parte", noite.get("empresas", 0) >= 1 and noite.get("dias", 0) >= 1, noite)
FOTO = ("select md5(string_agg(t, ',' order by t)) from ("
        f"select format('%s', x) t from public.voz_conversao_dia x where empresa_id = {EA} union all "
        f"select format('%s', x) from public.voz_audio_dia x where empresa_id = {EA} union all "
        f"select format('%s', x) from public.voz_qualidade_dia x where empresa_id = {EA} union all "
        f"select format('%s', x) from public.voz_temas_semana x where empresa_id = {EA}) z")
antes = sv(FOTO)
checar("conversão do dia: total por origem e acordos", True,
       f"select string_agg(origem || ':' || conversas || ':' || com_acordo, ',' order by origem) from public.voz_conversao_dia "
       f"where empresa_id = {EA} and data = '{ONTEM}' and dimensao = 'total'", valor="discador:10:0,ia:35:12")
checar("conversão por motivo, frase, tema, horário, canal e funil", True,
       f"select string_agg(dimensao || '=' || valor || ':' || conversas, ',' order by dimensao, valor) from public.voz_conversao_dia "
       f"where empresa_id = {EA} and data = '{ONTEM}' and origem = 'ia'",
       valor=f"canal_preferido=whatsapp:12,frase=link_na_ligacao:34,funil=acordo:12,funil=atendidas:35,funil=identidade:26,"
             f"funil=oferta:34,horario=manha:35,motivo=desemprego:18,motivo=esquecimento:16,objecao=sem_dinheiro_agora:34,"
             f"tema=tema_{TEMA}:34,total=todas:35")
checar("áudio do dia (somas)", True,
       f"select ligacoes || '|' || fala_agente_s || '|' || com_sentimento || '|' || melhorou from public.voz_audio_dia "
       f"where empresa_id = {EA} and data = '{ONTEM}' and origem = 'ia'", valor=f"35|{34 * 20}|34|34")
checar("qualidade: operador só com o ID do discador; a IA sem operador", True,
       f"select string_agg(origem || ':' || operador_ref || ':' || avaliadas || ':' || aprovadas, ',' order by origem) "
       f"from public.voz_qualidade_dia where empresa_id = {EA} and data = '{ONTEM}' and item = '_ligacao'",
       valor="discador:OP-7:10:9,ia::34:34")
checar("qualidade por item (aprovadas e não se aplica)", True,
       f"select avaliadas || '|' || aprovadas || '|' || na from public.voz_qualidade_dia where empresa_id = {EA} "
       f"and data = '{ONTEM}' and origem = 'discador' and item = 'ck_cpc'", valor="10|9|0")
checar("temas da semana", True,
       f"select sum(conversas) || '|' || sum(com_acordo) from public.voz_temas_semana where empresa_id = {EA} and tema_id = {TEMA}",
       valor="34|12")
checar("o operador visto no dia entra na lista (ID do discador)", True,
       f"select apelido || '|' || discador || '|' || ativo from public.voz_operadores where empresa_id = {EA} and operador_ref = 'OP-7'",
       valor="OP-7|generico|true")
sv(f"update public.voz_operadores set apelido = 'Bia' where empresa_id = {EA} and operador_ref = 'OP-7'")
r = SB.rpc("agregar_speech_dia", {"empresa": EA, "dia": ONTEM})
caso("rodar de novo o mesmo dia dá o mesmo resultado (idempotente)", sv(FOTO) == antes, r)
checar("... e não muda o apelido que a empresa deu", True,
       f"select apelido from public.voz_operadores where empresa_id = {EA} and operador_ref = 'OP-7'", valor="Bia")
checar("painel: 44 avaliadas (a gravação sem avaliação não conta); o discador (10) fica escondido (< 30)", True,
       f"select (p ->> 'n') || '|' || (p -> 'por_origem' ->> 'ia') || '|' || coalesce(p -> 'por_origem' ->> 'discador', 'nulo') "
       f"|| '|' || (p ->> 'conversao') from public.painel_speech({EA}, null, '{ONTEM}', '{ONTEM}') p",
       "authenticated", U["ope"], valor="44|34|nulo|26.7")
checar("painel: motivo com menos de 30 conversas fica sem número", True,
       f"select string_agg((x ->> 'valor') || ':' || coalesce(x ->> 'n', 'nulo'), ',' order by x ->> 'valor') "
       f"from jsonb_array_elements(public.painel_speech({EA}, null, '{ONTEM}', '{ONTEM}') -> 'motivos') x",
       "authenticated", U["ope"], valor="desemprego:nulo,esquecimento:nulo")
checar("qualidade: nota da IA e conformidade", True,
       f"select (q -> 'origens' -> 'ia' ->> 'nota') || '|' || (q -> 'origens' -> 'ia' ->> 'conformidade') || '|' "
       f"|| coalesce(q -> 'origens' -> 'discador' ->> 'nota', 'nulo') from public.qualidade_voz({EA}, null, '{ONTEM}', '{ONTEM}') q",
       "authenticated", U["ope"], valor="100.0|100.0|nulo")
checar("operadores: OP-7 com 10 avaliadas fica sem nota (< 30)", True,
       f"select (o -> 'operadores' -> 0 ->> 'apelido') || '|' || (o -> 'operadores' -> 0 ->> 'n') || '|' "
       f"|| coalesce(o -> 'operadores' -> 0 ->> 'nota', 'nulo') from public.operadores_voz({EA}, null, '{ONTEM}', '{ONTEM}') o",
       "authenticated", U["ges"], valor="Bia|10|nulo")
checar("dia fora da janela do job é recusado", False, f"select public.agregar_speech_dia({EA}, current_date - 60)", "service_role",
       erro="janela")
checar("dia no futuro é recusado", False, f"select public.agregar_speech_dia({EA}, current_date + 2)", "service_role", erro="janela")
checar("parte inválida é recusada", False, "select public.speech_empresas_voz('3/2')", "service_role")
checar("só as empresas ligadas (e da parte)", True,
       f"select (public.speech_empresas_voz('1/1') @> '[{EA}]') || '|' || (public.speech_empresas_voz('1/1') @> '[{EB}]')",
       "service_role", valor="true|false")

# ---------------------------------------------------------------- retroalimentação pelas RPCs
d = SB.rpc("dados_retroalimentacao_voz", {"empresa": EA, "de": ONTEM, "ate": ONTEM})
caso("dados da retroalimentação: só agregados (sem id_cliente)", len(d["conversao"]) > 0 and "CLI-" not in json.dumps(d)
     and isinstance(d["renitencia"], list))
checar("período longo é recusado", False, f"select public.dados_retroalimentacao_voz({EA}, current_date - 200, current_date)",
       "service_role", erro="120")
REC = sv(f"insert into public.recomendacoes (empresa_id, credor_id, destino, regra, chave, titulo, evidencia, situacao, "
         f"aplicada_em) values ({EA}, {CA}, 'regua', 'horario', 'regua:horario:sd', 'Ligar de manhã, teste', "
         f"'{{\"n_a\": 300, \"n_b\": 300, \"pct_a\": 30, \"pct_b\": 20}}', 'aplicada', now() - interval '40 days') returning id")
caso("recomendações aplicadas da empresa", [x["id"] for x in SB.rpc("recomendacoes_aplicadas_voz", {"empresa": EA})] == [int(REC)])
checar("impacto com menos de 30 conversas é recusado", False,
       f"select public.gravar_impacto_voz({REC}, 'acordo_pct', 20, 30, 29, 100)", "service_role", erro="30")
checar("impacto com 30+ dos dois lados é gravado (e regravado)", True,
       f"select public.gravar_impacto_voz({REC}, 'acordo_pct', 20, 30, 100, 100) = public.gravar_impacto_voz({REC}, 'acordo_pct', 21, 31, 100, 100)",
       "service_role", valor="t")
checar("motor e VM registram recomendação (o site não)", False,
       f"select public.registrar_recomendacao_voz({EA}, null, 'regua', 'horario', 'x:y', 'Título de teste', '', "
       f"'{{\"n_a\": 300, \"n_b\": 300, \"pct_a\": 30, \"pct_b\": 20}}')", "authenticated", U["adm"])

# ---------------------------------------------------------------- retenção
sv(f"delete from public.voz_gravacoes where id = {G1}")
checar("a análise vai embora com a gravação", True,
       f"select (select count(*) from public.voz_analise_chamadas where gravacao_id = {G1}) || '|' || "
       f"(select count(*) from public.voz_avaliacoes where chamada_id = {C1}) || '|' || "
       f"(select count(*) from public.voz_alertas where chamada_id = {C1})", valor="0|0|0")
checar("... os agregados do dia ficam (não têm dado por cliente)", True,
       f"select sum(conversas) from public.voz_conversao_dia where empresa_id = {EA} and data = '{ONTEM}' and dimensao = 'total'",
       valor=45)

# ---------------------------------------------------------------- limpeza
sv(f"delete from public.recomendacoes where empresa_id in ({EA}, {EB})")
sv("delete from auth.users where email like 'sd.%@exemplo.test'")
sv(f"delete from public.empresas where id in ({EA}, {EB}, {EC})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
