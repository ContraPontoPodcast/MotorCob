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
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL79)], capture_output=True, text=True)
    afirmar(f"a migração roda sem erro (vez {vez})", r.returncode == 0, r.stderr[-400:])

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


H0, S0 = hash_(), estado()

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


ordem = sv(f"select string_agg(s.codigo, ',' order by s.ordem, s.codigo) from public.segmentos_em_uso s where s.credor_id = {CART} and s.vinculado and s.codigo <> 'A2'")
afirmar("ordem final JUR, A1, D90B, D90A, B1, X180", ordem == "JUR,A1,D90B,D90A,B1,X180", ordem)
afirmar("A1 alterado (0–30, nome novo)", seg("A1").startswith('Atraso 0–30|[{"op": "entre", "campo": "dias_atraso", "valor": [0, 30]}]'), seg("A1"))
afirmar("D90B criado com saldo ≤ 2000 (ticket = saldo)", '"campo": "saldo"' in seg("D90B") and '"valor": 2000' in seg("D90B"), seg("D90B"))
afirmar("novos e alterados PAUSADOS nesta carteira, com a estratégia nova", all(
    vinc(c) == f"false:{n} · Cartões" for c, n in (("A1", "Atraso 0–30"), ("D90B", "31–90 · até R$ 2 mil"),
                                                  ("D90A", "31–90 · acima de R$ 2 mil"), ("B1", "91 a 180 dias"),
                                                  ("X180", "Acima de 180 dias"))), [vinc(c) for c in ("A1", "D90B", "B1")])
afirmar("JUR não citado: segue ligado, com a estratégia dele", vinc("JUR") == "true:Jurídico · Cartões", vinc("JUR"))
afirmar("A2 desligado SÓ em Cartões; continua em Consignado com 'Atraso médio'",
        vinc("A2") == "false:Atraso médio" and vinc("A2", CONS) == "true:Atraso médio", (vinc("A2"), vinc("A2", CONS)))
afirmar("estratégia antiga de B1 não foi apagada", sv(f"select count(*) from public.estrategias where id = {E_B1}") == "1")
afirmar("carteira extra: segmentos novos pausados lá, com CÓPIA da estratégia (outra linha)",
        vinc("D90B", CONS) == "false:31–90 · até R$ 2 mil · Consignado"
        and sv(f"select count(distinct v.estrategia_id) from public.segmentos_carteira v join public.clusters c on c.id = v.cluster_id "
               f"where c.codigo = 'D90B' and c.empresa_id = {EA}") == "2", vinc("D90B", CONS))
d = json.loads(sv(f"select e.definicao from public.segmentos_carteira v join public.clusters c on c.id = v.cluster_id "
                  f"join public.estrategias e on e.id = v.estrategia_id where c.codigo = 'A1' and c.empresa_id = {EA} and v.credor_id = {CART}"))
afirmar("estratégia de A1 = a régua compilada (raias por persona, Não CPC ciclo 3 × 6, acordo padrão)",
        d == PROP["segmentos"]["s1"]["definicao"] and d["giro"]["ciclo_dias"] == 3, d)
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
checar("ligar um segmento (D90B)", True, f"select public.ligar_segmentacao({AP}, array[(select id from public.clusters "
       f"where empresa_id = {EA} and codigo = 'D90B')])", *PL, valor=1)
afirmar("só D90B ligado; os outros seguem pausados", vinc("D90B").startswith("true") and vinc("A1").startswith("false"))
checar("ligar o resto", True, f"select public.ligar_segmentacao({AP})", *PL, valor=4)
afirmar("ligados em Cartões (Consignado segue pausado: conferir lá)", all(vinc(c).startswith("true") for c in ("A1", "D90A", "B1", "X180"))
        and vinc("D90B", CONS).startswith("false") and sv(f"select ligada_em is not null from public.segmentacao_aplicacoes where id = {AP}") == "t")

# desfazer: até a próxima rotina, volta exatamente
sv(f"insert into public.execucoes (empresa_id, data_ref, iniciada_em, status) values ({EA}, current_date, now() + interval '1 minute', 'ok')")
checar("depois da rotina, desfazer é recusado", False, f"select public.desfazer_segmentacao({AP})", *PL, erro="próxima rotina")
sv(f"delete from public.execucoes where empresa_id = {EA}")
checar("operação não desfaz", False, f"select public.desfazer_segmentacao({AP})", "authenticated", U["oper"])
r = json.loads(checar("desfaz", True, f"select public.desfazer_segmentacao({AP})", *PL))
CRIADOS = ",".join(str(x) for x in R.get("pausados", []) if str(x) not in (A1, B1))
afirmar("desfeito: segmentos, ordem, vínculos e Demais como antes (só os criados ficam, desligados)",
        r["ok"] and estado(CRIADOS) == S0, r)
afirmar("desfeito: criados desligados (não apagados) em todas as carteiras; estratégias criadas ficam",
        vinc("D90B") == "false:31–90 · até R$ 2 mil · Cartões" and vinc("D90B", CONS).startswith("false")
        and sv(f"select count(*) from public.clusters where empresa_id = {EA} and codigo in ('D90B', 'D90A', 'X180')") == "3")
afirmar("desfeito: A2 ligado de novo em Cartões; A1 e B1 como eram",
        vinc("A2") == "true:Atraso médio" and seg("A1") == f'Primeiro atraso|[{{"op": "entre", "campo": "dias_atraso", "valor": [1, 30]}}]|20'
        and vinc("B1") == "true:Atraso longo · Cartões", (vinc("A2"), seg("A1")))
checar("desfazer duas vezes é recusado", False, f"select public.desfazer_segmentacao({AP})", *PL, erro="já foi desfeita")

# conflito: outra pessoa mexeu num segmento depois de aplicar
P4 = json.loads(sv(f"select public.pedir_segmentacao({EA}, {CART}, {lit(FX['contexto']['texto'])} #>> '{{}}')", *PL))["pedido"]
ctx4 = json.loads(sv("select public.pegar_pedido_segmentacao()", "service_role"))
prop4, erros4 = SI.compilar(resolver(FX["entrega"]), {**ctx4, "canais": {**ctx4["canais"], "agente_voz": "desligado"}})
afirmar("2ª geração: os códigos que já existem (D90B, D90A, X180) ganham outro código",
        erros4 == [] and prop4["segmentos"]["s2"]["codigo"] != "D90B", prop4 and prop4["segmentos"]["s2"]["codigo"])
sv(f"select public.registrar_segmentacao({P4}, {lit(prop4)}, '{{}}')", "service_role")
H4, S4 = hash_(), estado(CRIADOS)
ok, out, err = aplicar(prop4, h=H4, pedido=P4)
AP4 = json.loads(out)["aplicacao"] if ok else None
afirmar("aplica a 2ª", ok, err)
sv(f"select pg_sleep(0.01); update public.clusters set nome = 'Mexido à mão' where empresa_id = {EA} and codigo = 'B1'")
r = json.loads(checar("conflito listado, nada desfeito", True, f"select public.desfazer_segmentacao({AP4})", *PL))
afirmar("conflito: B1", r == {"ok": False, "conflitos": ["B1"]} and seg("B1").startswith("Mexido à mão"), r)
r = json.loads(checar("forçar desfaz mesmo assim", True, f"select public.desfazer_segmentacao({AP4}, true)", *PL))
CRIADOS4 = ",".join([CRIADOS] + [str(x) for x in json.loads(out)["pausados"] if str(x) not in (A1, B1)])
afirmar("forçado: volta ao estado de antes", r["ok"] and estado(CRIADOS4) == S4, r)

# funções da VM no schema voz_vm (acesso próprio)
afirmar("voz_vm: a VM executa pegar/registrar; o site não",
        sv("select has_function_privilege('motorcx_voz', 'voz_vm.pegar_pedido_segmentacao(jsonb)', 'execute')") == "t"
        and sv("select has_function_privilege('authenticated', 'voz_vm.registrar_segmentacao(jsonb)', 'execute')") == "f"
        and sv("select has_function_privilege('authenticated', 'public.registrar_segmentacao(bigint, jsonb, jsonb, bigint)', 'execute')") == "f")
afirmar("RLS ligada nas tabelas novas",
        sv("select bool_and(relrowsecurity) from pg_class where oid in ('public.segmentacao_pedidos'::regclass, 'public.segmentacao_aplicacoes'::regclass)") == "t")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
