"""SQL 79 · Descrever segmentos e régua: fila, créditos, aplicar (uma transação), ligar, desfazer e permissões.

Cobre: a migração roda duas vezes; pedir_segmentacao reserva os 2 créditos de IA (SQL 78, `seg:geracao:<id>`) e
respeita 6.000 caracteres e um pedido por carteira; a VM (servidor) pega o pedido com o contexto SEM dado pessoal e
registra: com proposta confirma os créditos, sem proposta estorna; descartar estorna. A proposta é a do exemplo do
dono, compilada pelo motor (motor/segmentacao_ia.py) com o contexto que o banco devolveu. aplicar_segmentacao:
previa_hash velho recusa sem mudar nada; FALHA NO MEIO (código que colide com outro segmento da empresa, depois de
já ter criado segmentos e estratégias) não deixa NADA; aplicado: ordem, condições, A2 desligado só nesta carteira
(continua em Consignado), segmentos e estratégias novos PAUSADOS, estratégia antiga guardada, carteira extra com cópia
da estratégia, canal "a ativar" desligado recusa; ligar; desfazer volta exatamente ao estado de antes (hash igual),
só até a próxima rotina, com conflito listado; permissões (operação, outra empresa, anon) e RLS das tabelas novas.

SQL 82 (decisão do dono, 08/11/2026): segmento ALTERADO que está valendo segue na versão atual até "Conferi, ligar"
(A1 e B1: condição, nome e estratégia de hoje; a versão nova em criados.espera); o compartilhado A2 (padrão "desligar
aqui + criar novo") segue valendo em Cartões até ligar e em Consignado sempre; a ordem nova vale a partir do 1º Ligar;
ligar troca tudo numa transação (falha no meio do Ligar não deixa nada); desfazer volta tudo e apaga o que a aplicação
criou e ninguém mexeu, então a 2ª geração reusa D90B e o nome da estratégia sem "(2)"; aplicar de novo com uma
aplicação esperando substitui a espera dela.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_segmentacao_aplicar.py
Só dados fictícios (empresas e79-*, e-mails @exemplo.test, ids C00001…).
"""
import copy
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
from motor import segmentacao_ia as SI  # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL79 = RAIZ / "supabase" / "migrations" / "20270115000001_descrever_segmentacao.sql"
SQL82 = RAIZ / "supabase" / "migrations" / "20270118000001_segmento_alterado_vale.sql"
FX = json.loads((RAIZ / "tests" / "dados" / "segmentacao_exemplo_dono.json").read_text(encoding="utf-8"))


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 79: " + nome + ("" if cond else f"  -> {str(detalhe)[:400]}"))


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    ok, out, err = sql(cmd, papel, uid)
    afirmar(nome, ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err),
            f"ok={ok} out={out[:200]!r} err={err[:300]}")
    return out


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def lit(x) -> str:
    return "'" + json.dumps(x, ensure_ascii=False).replace("'", "''") + "'::jsonb"


for vez in (1, 2):
    for arq in (SQL79, SQL82):         # o 82 redefine aplicar/ligar/desfazer: sempre depois do 79
        r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(arq)], capture_output=True, text=True)
        afirmar(f"a migração {arq.name[:14]} roda sem erro (vez {vez})", r.returncode == 0, r.stderr[-400:])

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e79-a-{T}', 'E79 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e79-b-{T}', 'E79 B {T}') returning id")
U = {}
for p in ("plan", "oper", "planb", "admin"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}79-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='planejamento', empresa_id={EA} where id='{U['plan']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['oper']}'")
sv(f"update public.perfis set papel='planejamento', empresa_id={EB} where id='{U['planb']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['admin']}'")
PL = ("authenticated", U["plan"])
CART = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'c79{T}', 'Cartões') returning id")
CONS = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'k79{T}', 'Consignado') returning id")
OUTRA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'o79{T}', 'Outra') returning id")


def cluster(cod, nome, conds, ordem):
    return sv(f"insert into public.clusters (empresa_id, ordem, codigo, nome, condicoes) values ({EA}, {ordem}, '{cod}', "
              f"'{nome}', {lit(conds)}) returning id")


JUR = cluster("JUR", "Jurídico", [{"campo": "status_juridico", "op": "em", "valor": ["ajuizado", "em execução"]}], 10)
A1 = cluster("A1", "Primeiro atraso", [{"campo": "dias_atraso", "op": "entre", "valor": [1, 30]}], 20)
A2 = cluster("A2", "Atraso médio", [{"campo": "dias_atraso", "op": "entre", "valor": [31, 90]}], 30)
B1 = cluster("B1", "Atraso longo", [{"campo": "dias_atraso", "op": "entre", "valor": [91, 360]}], 40)
OUT = cluster("ZZ1", "Só no Consignado", [{"campo": "saldo", "op": ">", "valor": 99999}], 50)
for c in (JUR, A1, A2, B1):
    sv(f"insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo) values ({EA}, {c}, {CART}, true)")
for c in (A2, OUT):
    sv(f"insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo) values ({EA}, {c}, {CONS}, true)")
E_A2 = sv(f"insert into public.estrategias (empresa_id, nome, definicao) values ({EA}, 'Atraso médio', '{{}}') returning id")
E_B1 = sv(f"insert into public.estrategias (empresa_id, nome, definicao) values ({EA}, 'Atraso longo · Cartões', '{{}}') returning id")
E_JUR = sv(f"insert into public.estrategias (empresa_id, nome, definicao) values ({EA}, 'Jurídico · Cartões', '{{}}') returning id")
sv(f"update public.segmentos_carteira set estrategia_id = {E_A2} where cluster_id = {A2}")
sv(f"update public.segmentos_carteira set estrategia_id = {E_B1} where cluster_id = {B1} and credor_id = {CART}")
sv(f"update public.segmentos_carteira set estrategia_id = {E_JUR} where cluster_id = {JUR} and credor_id = {CART}")
for i, (nome, ordem) in enumerate((("Digital nativo", 1), ("Conectado (WhatsApp + e-mail)", 2),
                                    ("Atraso recente, ticket baixo", 3), ("Celular sem WhatsApp confirmado", 4))):
    sv(f"insert into public.personas_usuario (empresa_id, credor_id, nome, ordem) values ({EA}, {CART}, '{nome}', {ordem})")
sv(f"insert into public.canais_empresa (empresa_id, canal, ativo) values ({EA}, 'agente_voz', false)")
sv(f"update public.empresas set colunas_base = {lit({'colunas': [{'nome': 'produto', 'tipo': 'texto'}, {'nome': 'status_juridico', 'tipo': 'texto'}, {'nome': 'valor_parcela', 'tipo': 'numero'}]})} where id = {EA}")
# retrato fictício (pseudônimos MX…, nunca CPF) para os valores distintos e a prévia
linhas = [{"id_cliente": f"MXQA{i:012d}", "dias": d, "saldo": s, "prod": p}
          for i, (d, s, p) in enumerate([(5, 500, "Cartão"), (40, 1500, "Cartão"), (60, 3500, "Consignado"),
                                         (120, 800, "Cartão"), (300, 9000, "Crédito pessoal"), (-3, 200, "Cartão")])]
for l in linhas:
    sv(f"insert into public.atributos_previa (empresa_id, credor_id, id_cliente, data_base, segmento_atual, saldo, dias_atraso, "
       f"atributos) values ({EA}, {CART}, '{l['id_cliente']}', current_date, null, {l['saldo']}, {l['dias']}, "
       f"{lit({'produto': l['prod'], 'valor_parcela': '120,50'})})")


def hash_(cred=CART):
    return sv(f"select public.hash_segmentacao({EA}, {cred})")


def uso(ref):
    return sv(f"select coalesce((select situacao || ':' || creditos from public.ia_creditos_uso where pedido_ref = '{ref}'), '-')")


def estado(fora="0"):
    """Tudo o que aplicar/desfazer mexe, para comparar antes × depois (fora: segmentos criados, que só ficam desligados)."""
    return sv(f"select md5(coalesce((select string_agg(concat_ws('|', id, codigo, nome, ordem, condicoes::text, so_digital, "
              f"canais_bloqueados::text, ativo), ';' order by id) from public.clusters where empresa_id = {EA} and id not in ({fora})), '') || "
              f"coalesce((select string_agg(concat_ws('|', cluster_id, credor_id, ativo, estrategia_id), ';' order by cluster_id, credor_id) "
              f"from public.segmentos_carteira where empresa_id = {EA} and cluster_id not in ({fora})), '') || "
              f"(select count(*) from public.estrategias where empresa_id = {EA} and descricao not like 'Gerada por%')::text || "
              f"(select string_agg(demais_ativo::text, ',' order by id) from public.credores where empresa_id = {EA}))")


def viva(cred=CART):
    """O que vale HOJE na carteira (o que o motor lê): segmentos em uso na ordem, condição, nome, estratégia e Demais."""
    return sv(f"select md5(coalesce((select string_agg(concat_ws('|', s.codigo, s.nome, c.condicoes::text, c.so_digital, "
              f"c.canais_bloqueados::text, s.estrategia_id), ';' order by s.ordem, s.codigo) from public.segmentos_em_uso s "
              f"join public.clusters c on c.id = s.cluster_id where s.credor_id = {cred} and s.em_uso), '') || "
              f"(select demais_ativo::text from public.credores where id = {cred}))")


H0, S0 = hash_(), estado()
V0, V0_CONS = viva(), viva(CONS)

# ------------------------------------------------------------------ pedir (créditos) e permissões
checar("operação (sem editar a orquestração) não pede", False,
       f"select public.pedir_segmentacao({EA}, {CART}, 'Clientes de 0 a 30 dias: SMS no dia 1.')", "authenticated", U["oper"],
       erro="sem permissão")
checar("outra empresa não pede", False,
       f"select public.pedir_segmentacao({EA}, {CART}, 'Clientes de 0 a 30 dias: SMS no dia 1.')", "authenticated", U["planb"])
checar("anon não executa", False, f"select public.pedir_segmentacao({EA}, {CART}, 'xxxxxxxxxxxxxxx')", "anon")
checar("texto acima de 6.000 caracteres é recusado", False,
       f"select public.pedir_segmentacao({EA}, {CART}, repeat('a', 6001))", *PL, erro="6.000")
checar("carteira de outra empresa é recusada", False,
       f"select public.pedir_segmentacao({EA}, {OUTRA}, 'Clientes de 0 a 30 dias: SMS no dia 1.')", *PL)
r = json.loads(checar("planejamento pede: pedido + reserva de 2 créditos", True,
                      f"select public.pedir_segmentacao({EA}, {CART}, {lit(FX['contexto']['texto'])} #>> '{{}}')", *PL))
P1 = r["pedido"]
afirmar("reserva seg:geracao:<id> com 2 créditos", uso(f"seg:geracao:{P1}") == "reservado:2" and r["creditos"]["creditos"] == 2,
        uso(f"seg:geracao:{P1}"))
checar("um pedido em andamento por carteira", False,
       f"select public.pedir_segmentacao({EA}, {CART}, 'Outro texto qualquer de teste.')", *PL, erro="sendo gerada")
checar("o site não grava a fila direto", False,
       f"update public.segmentacao_pedidos set situacao = 'gerado' where id = {P1}", *PL)
checar("planejamento vê o próprio pedido", True, f"select count(*) from public.segmentacao_pedidos where id = {P1}", *PL, valor=1)
checar("outra empresa não vê o pedido", True, f"select count(*) from public.segmentacao_pedidos where id = {P1}",
       "authenticated", U["planb"], valor=0)
checar("operação não vê o pedido", True, f"select count(*) from public.segmentacao_pedidos where id = {P1}",
       "authenticated", U["oper"], valor=0)
checar("usuário não pega pedido da fila", False, "select public.pegar_pedido_segmentacao()", *PL)

# ------------------------------------------------------------------ a VM pega: contexto sem dado pessoal
ctx = json.loads(sv("select public.pegar_pedido_segmentacao()", "service_role"))
afirmar("a VM pega o pedido e ele fica em geração",
        ctx["pedido"] == int(P1) and sv(f"select situacao from public.segmentacao_pedidos where id = {P1}") == "gerando")
afirmar("contexto: segmentos da carteira na ordem, A2 compartilhado com Consignado, B1 com estratégia própria",
        [s["codigo"] for s in ctx["segmentos"]] == ["JUR", "A1", "A2", "B1"]
        and ctx["segmentos"][2]["compartilhado_com"] == ["Consignado"] and ctx["segmentos"][3]["estrategia_propria"]
        and ctx["segmentos"][3]["estrategia_nome"] == "Atraso longo · Cartões", ctx["segmentos"])
afirmar("contexto: canais (agente virtual sem voz = não contratado), personas, valores de texto com contagem",
        ctx["canais"]["agente_voz"] == "nao_contratado" and ctx["canais"]["sms"] == "ativo"
        and [p["nome"] for p in ctx["personas"]][0] == "Digital nativo"
        and ctx["personas"][0]["canais"] == ["whatsapp", "rcs", "sms", "email"]
        and {"valor": "Cartão", "clientes": 4} in ctx["valores"]["produto"] and "valor_parcela" not in ctx["valores"], ctx)
texto_ctx = json.dumps(ctx, ensure_ascii=False)
afirmar("contexto: nenhum id de cliente nem saldo individual", "MXQA" not in texto_ctx and "9000" not in texto_ctx)
afirmar("contexto: hash de hoje", ctx["hash_base"] == H0)

# a IA (falsa) entrega o exemplo do dono; o motor compila com o contexto que o banco mandou
ids = {"@" + p["nome"]: p["id"] for p in ctx["personas"]}


def resolver(x):
    if isinstance(x, dict):
        o = {k: resolver(v) for k, v in x.items()}
        if "valor_json" in o:
            o["valor_json"] = json.dumps(resolver(json.loads(o["valor_json"])), ensure_ascii=False)
        return o
    if isinstance(x, list):
        return [resolver(v) for v in x]
    return ids.get(x, x) if isinstance(x, str) else x


ctx_motor = {**ctx, "canais": {**ctx["canais"], "agente_voz": "desligado"}}
PROP, erros = SI.compilar(resolver(FX["entrega"]), ctx_motor)
afirmar("o motor compila a proposta do exemplo", erros == [] and PROP is not None, erros)
PROP["hash_base"] = ctx["hash_base"]
checar("usuário não registra resultado", False,
       f"select public.registrar_segmentacao({P1}, {lit(PROP)}, '{{}}', 100)", *PL)
checar("a VM registra a proposta", True, f"select public.registrar_segmentacao({P1}, {lit(PROP)}, "
       f"'{{\"erros\": [], \"tentativas\": 0}}', 12345) ->> 'situacao'", "service_role", valor="gerado")
afirmar("com proposta: créditos confirmados e na fatura", uso(f"seg:geracao:{P1}") == "confirmado:2"
        and sv(f"select quantidade from public.consumo_mensageria where empresa_id = {EA} and item = 'ia_creditos'") == "2")

# geração sem proposta: estorno; descartar antes de gerar: estorno
P2 = json.loads(sv(f"select public.pedir_segmentacao({EA}, {CONS}, 'Clientes com score Serasa acima de 700.')", *PL))["pedido"]
sv("select public.pegar_pedido_segmentacao()", "service_role")
checar("sem proposta: com_erros", True, f"select public.registrar_segmentacao({P2}, null, "
       f"'{{\"erros\": [\"llm_indisponivel\"]}}') ->> 'situacao'", "service_role", valor="com_erros")
afirmar("sem proposta: os 2 créditos são estornados", uso(f"seg:geracao:{P2}") == "estornado:2", uso(f"seg:geracao:{P2}"))
P3 = json.loads(sv(f"select public.pedir_segmentacao({EA}, {CONS}, 'Clientes de 0 a 30 dias: SMS no dia 1.')", *PL))["pedido"]
checar("descartar antes de gerar", True, f"select public.descartar_segmentacao({P3})", *PL)
afirmar("descartado: estornado", uso(f"seg:geracao:{P3}") == "estornado:2")
afirmar("nada mudou nos segmentos até aqui", estado() == S0 and hash_() == H0)


# ------------------------------------------------------------------ aplicar
def proposta_com(**respostas):
    p = copy.deepcopy(PROP)
    for q in p["perguntas"]:
        o = next(o for o in q["opcoes"] if o["valor"] == respostas.get(q["codigo"], q["padrao"]))
        p = SI.aplicar_patch_proposta(p, o["patch"])
    return p


def aplicar(prop, h=None, extras="'{}'::bigint[]", papel=PL, pedido=None):
    return sql(f"select public.aplicar_segmentacao({pedido or P1}, {lit(prop)}, '{h or H0}', {extras})", *papel)


ok, out, err = aplicar(PROP, h="0" * 32)
afirmar("previa_hash velho: recusa e não muda nada", not ok and "mudou desde a geração" in err and estado() == S0, err)
ok, out, err = aplicar(PROP, papel=("authenticated", U["oper"]))
afirmar("operação não aplica", not ok and "sem permissão" in err, err)
ok, out, err = aplicar(PROP, papel=("authenticated", U["planb"]))
afirmar("outra empresa não aplica", not ok, err)
ruim = proposta_com(a1voz="ativar")
ok, out, err = aplicar(ruim)
afirmar("canal 'a ativar' ainda desligado: recusa", not ok and "ative o canal agente_voz" in err and estado() == S0, err)

# falha no meio: X180 (o último a ser criado) com o código de um segmento que já existe na empresa (ZZ1, de Consignado)
meio = copy.deepcopy(PROP)
meio["segmentos"]["s6"]["codigo"] = "ZZ1"
n_estr = sv(f"select count(*) from public.estrategias where empresa_id = {EA}")
ok, out, err = aplicar(meio)
afirmar("falha no meio (código repetido depois de criar 2 segmentos e 4 estratégias): erro", not ok and "duplicate" in err, err)
afirmar("falha no meio não deixa nada: segmentos, vínculos, estratégias, Demais e hash iguais",
        estado() == S0 and hash_() == H0 and sv(f"select count(*) from public.estrategias where empresa_id = {EA}") == n_estr)
afirmar("falha no meio: nenhuma aplicação e o pedido segue pronto para aplicar",
        sv(f"select count(*) from public.segmentacao_aplicacoes where empresa_id = {EA}") == "0"
        and sv(f"select situacao from public.segmentacao_pedidos where id = {P1}") == "gerado")

ok, out, err = aplicar(PROP, extras=f"array[{CONS}]::bigint[]")
afirmar("aplica (exemplo do dono, com Consignado como carteira extra)", ok, err)
R = json.loads(out) if ok else {}
AP = R.get("aplicacao")
afirmar("resumo: 3 novos, 2 alterados, 1 desligado, 1 mantido, 5+3 estratégias",
        (R.get("novos"), R.get("alterados"), R.get("desligados"), R.get("mantidos"), R.get("estrategias")) == (3, 2, 1, 1, 8), R)


def seg(cod):
    return sv(f"select concat_ws('|', c.nome, c.condicoes::text, c.ordem) from public.clusters c where c.empresa_id = {EA} and c.codigo = '{cod}'")


def vinc(cod, cred=CART):
    return sv(f"select coalesce((select v.ativo::text || ':' || coalesce(e.nome, '-') from public.segmentos_carteira v "
              f"join public.clusters c on c.id = v.cluster_id left join public.estrategias e on e.id = v.estrategia_id "
              f"where c.empresa_id = {EA} and c.codigo = '{cod}' and v.credor_id = {cred}), 'sem vínculo')")


def cid_(cod):
    return sv(f"select id from public.clusters where empresa_id = {EA} and codigo = '{cod}'")


def espera(ap=None):
    return json.loads(sv(f"select coalesce(criados -> 'espera', 'null') from public.segmentacao_aplicacoes where id = {ap or AP}"))


def ordem_cart():
    return sv(f"select string_agg(s.codigo, ',' order by s.ordem, s.codigo) from public.segmentos_em_uso s "
              f"where s.credor_id = {CART} and s.vinculado and s.codigo <> 'A2'")


A1_ANTES = 'Primeiro atraso|[{"op": "entre", "campo": "dias_atraso", "valor": [1, 30]}]|20'
# SQL 82: o que vale hoje não muda até ligar (alterados na versão atual, A2 compartilhado segue aqui, ordem de hoje)
afirmar("SQL 82: depois de aplicar, o que vale HOJE em Cartões e em Consignado não mudou",
        viva() == V0 and viva(CONS) == V0_CONS)
afirmar("SQL 82: A1 alterado segue na versão atual (condição, nome e ordem de hoje), ligado e sem estratégia nova",
        seg("A1") == A1_ANTES and vinc("A1") == "true:-", (seg("A1"), vinc("A1")))
afirmar("SQL 82: B1 segue ligado com a estratégia atual ('Atraso longo · Cartões'); a antiga não foi apagada",
        vinc("B1") == "true:Atraso longo · Cartões" and sv(f"select count(*) from public.estrategias where id = {E_B1}") == "1", vinc("B1"))
E = espera()
afirmar("SQL 82: versão nova de A1 e B1 em espera (A1: 0–30 e nome novo; os dois com a estratégia nova)",
        R.get("versoes") == sorted([int(A1), int(B1)]) and E["versoes"][A1]["nome"] == "Atraso 0–30"
        and E["versoes"][A1]["condicoes"] == [{"op": "entre", "campo": "dias_atraso", "valor": [0, 30]}]
        and "estrategia_id" in E["versoes"][A1] and "estrategia_id" in E["versoes"][B1] and "condicoes" in E["versoes"][B1], E)
d = json.loads(sv(f"select definicao from public.estrategias where id = {E['versoes'][A1]['estrategia_id']}"))
afirmar("estratégia nova de A1 (em espera) = a régua compilada (raias por persona, Não CPC ciclo 3 × 6, acordo padrão)",
        d == PROP["segmentos"]["s1"]["definicao"] and d["giro"]["ciclo_dias"] == 3, d)
afirmar("SQL 82: A2 compartilhado segue valendo em Cartões até ligar (desligar espera) e em Consignado",
        vinc("A2") == "true:Atraso médio" and vinc("A2", CONS) == "true:Atraso médio" and E["desligar"] == [int(A2)],
        (vinc("A2"), vinc("A2", CONS), E.get("desligar")))
afirmar("D90B criado com saldo ≤ 2000 (ticket = saldo)", '"campo": "saldo"' in seg("D90B") and '"valor": 2000' in seg("D90B"), seg("D90B"))
afirmar("novos PAUSADOS nesta carteira, com a estratégia nova", all(
    vinc(c) == f"false:{n} · Cartões" for c, n in (("D90B", "31–90 · até R$ 2 mil"), ("D90A", "31–90 · acima de R$ 2 mil"),
                                                  ("X180", "Acima de 180 dias"))), [vinc(c) for c in ("D90B", "D90A", "X180")])
afirmar("só os novos estão em 'pausados'", sorted(R.get("pausados", [])) == sorted(int(cid_(c)) for c in ("D90B", "D90A", "X180")), R)
afirmar("JUR não citado: segue ligado, com a estratégia dele", vinc("JUR") == "true:Jurídico · Cartões", vinc("JUR"))
afirmar("carteira extra: segmentos novos pausados lá, com CÓPIA da estratégia (outra linha)",
        vinc("D90B", CONS) == "false:31–90 · até R$ 2 mil · Consignado"
        and sv(f"select count(distinct v.estrategia_id) from public.segmentos_carteira v join public.clusters c on c.id = v.cluster_id "
               f"where c.codigo = 'D90B' and c.empresa_id = {EA}") == "2", vinc("D90B", CONS))
afirmar("aplicação registrada com snapshot e pedido 'aplicado'",
        sv(f"select situacao || ':' || jsonb_array_length(antes -> 'clusters') from public.segmentacao_aplicacoes where id = {AP}") == "aplicada:4"
        and sv(f"select situacao from public.segmentacao_pedidos where id = {P1}") == "aplicado")
checar("planejamento vê a aplicação; outra empresa não", True,
       f"select count(*) from public.segmentacao_aplicacoes where id = {AP}", "authenticated", U["planb"], valor=0)
checar("não aplica duas vezes o mesmo pedido", False,
       f"select public.aplicar_segmentacao({P1}, {lit(PROP)}, public.hash_segmentacao({EA}, {CART}))", *PL, erro="não está pronta")
prev = json.loads(sv(f"select public.previa_segmentacao({EA}, {CART}, {lit({'segmentos': [{'codigo': PROP['segmentos'][r]['codigo'], 'nome': '', 'ref': r, 'condicoes': PROP['segmentos'][r]['condicoes']} for r in PROP['ordem']]})})", *PL))
afirmar("prévia da proposta (6 clientes fictícios): JUR 0, A1 1, D90B 1, D90A 1, B1 1, X180 1, Demais 1",
        [s["clientes"] for s in prev["segmentos"]] == [0, 1, 1, 1, 1, 1] and prev["demais"] == 1, prev)

# ligar
checar("operação não liga", False, f"select public.ligar_segmentacao({AP})", "authenticated", U["oper"])
# falha no meio do Ligar (depois de trocar a ordem e as versões de A1/B1): nada fica
sv(f"create or replace function public.t82_falhar() returns trigger language plpgsql as $f$ begin "
   f"if new.ativo and new.cluster_id = {cid_('X180')} then raise exception 'falha simulada no meio do ligar'; end if; "
   f"return new; end $f$; create trigger t82_falhar before update on public.segmentos_carteira "
   f"for each row execute function public.t82_falhar()")
S_ANTES_LIGAR, CR_ANTES = estado(), sv(f"select criados::text from public.segmentacao_aplicacoes where id = {AP}")
ok, out, err = sql(f"select public.ligar_segmentacao({AP})", *PL)
afirmar("SQL 82: falha no meio do Ligar: erro e NADA muda (ordem, versões, vínculos, Demais, espera)",
        not ok and "falha simulada" in err and estado() == S_ANTES_LIGAR and viva() == V0 and seg("A1") == A1_ANTES
        and sv(f"select criados::text from public.segmentacao_aplicacoes where id = {AP}") == CR_ANTES, err)
sv("drop trigger t82_falhar on public.segmentos_carteira; drop function public.t82_falhar()")
checar("ligar um segmento (D90B)", True, f"select public.ligar_segmentacao({AP}, array[{cid_('D90B')}::bigint])", *PL, valor=1)
afirmar("só D90B ligado; os outros novos seguem pausados", vinc("D90B").startswith("true") and vinc("D90A").startswith("false"))
afirmar("SQL 82: a ordem nova vale a partir do 1º Ligar", ordem_cart() == "JUR,A1,D90B,D90A,B1,X180", ordem_cart())
afirmar("SQL 82: A1 ainda na versão atual e A2 ainda em Cartões (sobra coisa para ligar)",
        vinc("A1") == "true:-" and seg("A1").startswith("Primeiro atraso|") and vinc("A2") == "true:Atraso médio", (vinc("A1"), vinc("A2")))
checar("ligar o resto (2 versões novas + 2 pausados)", True, f"select public.ligar_segmentacao({AP})", *PL, valor=4)
afirmar("SQL 82: depois de ligar vale a versão nova: A1 0–30 com nome novo e a estratégia nova; B1 com a nova",
        seg("A1").startswith('Atraso 0–30|[{"op": "entre", "campo": "dias_atraso", "valor": [0, 30]}]')
        and vinc("A1") == "true:Atraso 0–30 · Cartões" and vinc("B1") == "true:91 a 180 dias · Cartões", (seg("A1"), vinc("A1"), vinc("B1")))
afirmar("ligados em Cartões (Consignado segue pausado: conferir lá)", all(vinc(c).startswith("true") for c in ("A1", "D90A", "B1", "X180"))
        and vinc("D90B", CONS).startswith("false") and sv(f"select ligada_em is not null from public.segmentacao_aplicacoes where id = {AP}") == "t")
afirmar("SQL 82: com tudo ligado, A2 sai de Cartões e continua em Consignado",
        vinc("A2") == "false:Atraso médio" and vinc("A2", CONS) == "true:Atraso médio" and espera()["concluida_em"], (vinc("A2"), vinc("A2", CONS)))
afirmar("ligar de novo não faz nada", sv(f"select public.ligar_segmentacao({AP})", *PL) == "0")

# desfazer: até a próxima rotina, volta exatamente (e apaga o que criou, sem ninguém ter mexido)
sv(f"insert into public.execucoes (empresa_id, data_ref, iniciada_em, status) values ({EA}, current_date, now() + interval '1 minute', 'ok')")
checar("depois da rotina, desfazer é recusado", False, f"select public.desfazer_segmentacao({AP})", *PL, erro="próxima rotina")
sv(f"delete from public.execucoes where empresa_id = {EA}")
checar("operação não desfaz", False, f"select public.desfazer_segmentacao({AP})", "authenticated", U["oper"])
r = json.loads(checar("desfaz (depois de ligar: sem conflito com o próprio Ligar)", True, f"select public.desfazer_segmentacao({AP})", *PL))
afirmar("desfeito: segmentos, ordem, vínculos, Demais e hash EXATAMENTE como antes", r["ok"] and r["conflitos"] == []
        and estado() == S0 and hash_() == H0 and viva() == V0 and viva(CONS) == V0_CONS, r)
afirmar("SQL 82: desfeito: os 3 segmentos e as 8 estratégias criados saem (código e nome livres de novo)",
        r.get("segmentos_apagados") == 3 and r.get("estrategias_apagadas") == 8
        and sv(f"select count(*) from public.clusters where empresa_id = {EA} and codigo in ('D90B', 'D90A', 'X180')") == "0"
        and sv(f"select count(*) from public.estrategias where empresa_id = {EA} and descricao like 'Gerada por%'") == "0", r)
afirmar("desfeito: A2 ligado de novo em Cartões; A1 e B1 como eram",
        vinc("A2") == "true:Atraso médio" and seg("A1") == A1_ANTES and vinc("B1") == "true:Atraso longo · Cartões", (vinc("A2"), seg("A1")))
checar("desfazer duas vezes é recusado", False, f"select public.desfazer_segmentacao({AP})", *PL, erro="já foi desfeita")


def gerar(cred=CART):
    pid = json.loads(sv(f"select public.pedir_segmentacao({EA}, {cred}, {lit(FX['contexto']['texto'])} #>> '{{}}')", *PL))["pedido"]
    cx = json.loads(sv("select public.pegar_pedido_segmentacao()", "service_role"))
    pr, er = SI.compilar(resolver(FX["entrega"]), {**cx, "canais": {**cx["canais"], "agente_voz": "desligado"}})
    if pr is not None:
        sv(f"select public.registrar_segmentacao({pid}, {lit(pr)}, '{{}}')", "service_role")
    return pid, pr, er


# conflito: outra pessoa mexeu num segmento depois de aplicar
P4, prop4, erros4 = gerar()
afirmar("SQL 82: 2ª geração depois de desfazer reusa os códigos (D90B, D90A, X180)",
        erros4 == [] and [prop4["segmentos"][r]["codigo"] for r in ("s2", "s3", "s6")] == ["D90B", "D90A", "X180"],
        prop4 and [prop4["segmentos"][r]["codigo"] for r in ("s2", "s3", "s6")])
H4, S4, V4 = hash_(), estado(), viva()
ok, out, err = aplicar(prop4, h=H4, pedido=P4)
AP4 = json.loads(out)["aplicacao"] if ok else None
afirmar("aplica a 2ª", ok, err)
afirmar("SQL 82: estratégias da 2ª sem sufixo '(2)'", vinc("D90B") == "false:31–90 · até R$ 2 mil · Cartões"
        and sv(f"select count(*) from public.estrategias where empresa_id = {EA} and nome like '%(_)'") == "0", vinc("D90B"))
sv(f"select pg_sleep(0.01); update public.clusters set nome = 'Mexido à mão' where empresa_id = {EA} and codigo = 'B1'")
r = json.loads(checar("conflito listado, nada desfeito", True, f"select public.desfazer_segmentacao({AP4})", *PL))
afirmar("conflito: B1", r == {"ok": False, "conflitos": ["B1"]} and seg("B1").startswith("Mexido à mão"), r)
r = json.loads(checar("forçar desfaz mesmo assim", True, f"select public.desfazer_segmentacao({AP4}, true)", *PL))
afirmar("forçado: volta ao estado de antes", r["ok"] and estado() == S4 and hash_() == H4 and viva() == V4, r)

# aplicar de novo com uma aplicação esperando: a espera da anterior é substituída (não sobrescreve a nova depois)
P5, prop5, _ = gerar()
ok, out, err = aplicar(prop5, h=hash_(), pedido=P5)
AP5 = json.loads(out)["aplicacao"] if ok else None
afirmar("aplica a 3ª (fica esperando o Ligar)", ok and espera(AP5)["substituida_por"] is None, err)
P6, prop6, er6 = gerar()
ok, out, err = aplicar(prop6, h=hash_(), pedido=P6)
AP6 = json.loads(out)["aplicacao"] if ok else None
afirmar("SQL 82: a 4ª substitui a espera da 3ª", ok and espera(AP5)["substituida_por"] == AP6 and espera(AP6)["substituida_por"] is None,
        (err, AP5 and espera(AP5)))
n = sv(f"select public.ligar_segmentacao({AP5})", *PL)
afirmar("SQL 82: ligar a 3ª substituída só liga os novos pausados dela; A1 segue na versão atual",
        n == "3" and seg("A1") == A1_ANTES and vinc("A2") == "true:Atraso médio", (n, seg("A1"), vinc("A2")))
r6 = json.loads(sv(f"select public.desfazer_segmentacao({AP6})", *PL))
r5 = json.loads(sv(f"select public.desfazer_segmentacao({AP5})", *PL))
afirmar("desfaz a 4ª e a 3ª: volta ao estado de antes", r6["ok"] and r5["ok"] and estado() == S4 and hash_() == H4, (r6, r5))

# funções da VM no schema voz_vm (acesso próprio)
afirmar("voz_vm: a VM executa pegar/registrar; o site não",
        sv("select has_function_privilege('motorcx_voz', 'voz_vm.pegar_pedido_segmentacao(jsonb)', 'execute')") == "t"
        and sv("select has_function_privilege('authenticated', 'voz_vm.registrar_segmentacao(jsonb)', 'execute')") == "f"
        and sv("select has_function_privilege('authenticated', 'public.registrar_segmentacao(bigint, jsonb, jsonb, bigint)', 'execute')") == "f")
afirmar("RLS ligada nas tabelas novas",
        sv("select bool_and(relrowsecurity) from pg_class where oid in ('public.segmentacao_pedidos'::regclass, 'public.segmentacao_aplicacoes'::regclass)") == "t")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
