"""SQL 92 · Preços editáveis: tabela, mínimo e franquia padrão; preço e franquia por empresa (vigência e mínimo).

Cobre: a migração roda duas vezes; os itens do treino seguem pré-preenchidos (R$ 1,50/min com 1.000 min e R$ 1,20/sessão
com 300); só os três itens com franquia aceitam franquia; franquia padrão só com o Master (RPC e gravação direta no
catálogo); tabela e mínimo dos itens fora da Mensageria e da IA com editar_produtos (Administrativo sim; Comercial,
Atendimento, cliente e anon não; IA e Mensageria ficam nas telas deles); preço + franquia da empresa com editar_precos,
no próximo ciclo (padrão) ou neste ciclo com motivo, franquia mantida ao regravar a mesma vigência, vazia = padrão, o
guarda da IA (abaixo do mínimo recusado até para o Master) e o mínimo do catálogo com motivo; alcance da carteira;
franquia dos Créditos de IA só com o Master; franquia_treino passa a ler o que foi gravado.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_precos_editaveis.py
Só dados fictícios (empresas e92-*, e-mails @exemplo.test).
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
SQL92 = RAIZ / "supabase" / "migrations" / "20270128000001_precos_editaveis.sql"


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 92: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL92)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
# parâmetros da margem como no padrão (outros testes mexem neles) e o catálogo como estava; voltam no fim
PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
CATALOGO = json.loads(sv("select json_agg(json_build_object('c', codigo, 'min', preco_minimo, 'tab', preco_tabela, "
                         "'fr', franquia_padrao)) from public.cobranca_itens where codigo in ('contratos', "
                         "'voz_plataforma', 'ia_treino_voz', 'ia_treino_texto', 'ia_creditos')"))
sv("update public.parametros_margem set impostos_pct = 0, mc_minima_ia_pct = 70 where id = 1")
EA = sv(f"insert into public.empresas (slug, nome) values ('e92-a-{T}', 'E92 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e92-b-{T}', 'E92 B {T}') returning id")
U = {}
for p in ("master", "adm", "admcart", "com", "atend", "cli"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}92-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true where id='{U['master']}'")
sv(f"update public.perfis set papel='planejamento', equipe=true, equipe_alcance='todas' where id='{U['adm']}'")
sv(f"update public.perfis set papel='planejamento', equipe=true, equipe_alcance='carteira' where id='{U['admcart']}'")
sv(f"update public.empresas set vendedor_id='{U['admcart']}' where id={EB}")
sv(f"update public.perfis set papel='gestao', equipe=true, equipe_alcance='todas' where id='{U['com']}'")
sv(f"update public.perfis set papel='operacao', equipe=true, equipe_alcance='todas' where id='{U['atend']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['cli']}'")
M = ("authenticated", U["master"])
A = ("authenticated", U["adm"])
AC = ("authenticated", U["admcart"])
C = ("authenticated", U["com"])
AT = ("authenticated", U["atend"])
CL = ("authenticated", U["cli"])
ANON = ("anon", None)
PROX = sv(f"select public.proximo_ciclo_mes({EA})")
ATUAL = sv(f"select date_trunc('month', public.competencia_de({EA}, current_date))::date")


def spf(emp, item, modelo, preco, franquia="null", vigencia="proximo", motivo="null", motivo_vig="null", minimo=0):
    return (f"select preco_id is not null, vale_desde, franquia_vigente from public.salvar_preco_franquia({emp}, "
            f"'{item}', '{modelo}', {preco}, {minimo}, null, '{vigencia}', {motivo}, {motivo_vig}, {franquia})")


def franquia_em(emp, item, mes):
    return sv(f"select public.franquia_treino({emp}, '{item}', '{mes}')")


# ------------------------------------------------------------------ padrão pré-preenchido
checar("itens com franquia: créditos de IA e os dois do treino", True,
       "select array_to_string(public.itens_com_franquia(), ',')", *M, valor="ia_creditos,ia_treino_voz,ia_treino_texto")
checar("treino por voz pré-preenchido: R$ 1,50 por minuto e 1.000 min de franquia", True,
       "select preco_tabela::numeric(6,2) || '|' || franquia_padrao from public.cobranca_itens "
       "where codigo = 'ia_treino_voz'", valor="1.50|1000")
checar("treino por texto pré-preenchido: R$ 1,20 por sessão e 300 sessões de franquia", True,
       "select preco_tabela::numeric(6,2) || '|' || franquia_padrao from public.cobranca_itens "
       "where codigo = 'ia_treino_texto'", valor="1.20|300")

# ------------------------------------------------------------------ franquia padrão (só o Master)
checar("Master muda a franquia padrão do treino por voz", True,
       "select public.salvar_franquia_padrao('ia_treino_voz', 1200)", *M, valor=1200)
checar("a franquia padrão nova vale para a empresa sem franquia própria", True,
       f"select public.franquia_treino({EA}, 'ia_treino_voz', current_date)", valor=1200)
checar("Administrativo não muda a franquia padrão (RPC)", False,
       "select public.salvar_franquia_padrao('ia_treino_voz', 5000)", *A, erro="Master")
checar("Administrativo não muda a franquia padrão gravando direto no catálogo", False,
       "update public.cobranca_itens set franquia_padrao = 5000 where codigo = 'ia_treino_voz'", *A, erro="Master")
checar("Administrativo segue gravando o resto do catálogo (a policy de editar_produtos não mudou)", True,
       "update public.cobranca_itens set descricao = descricao where codigo = 'voz_plataforma' returning codigo", *A,
       valor="voz_plataforma")
checar("item sem franquia não recebe franquia padrão", False,
       "select public.salvar_franquia_padrao('sms', 10)", *M, erro="não tem franquia")
checar("franquia padrão negativa é recusada", False,
       "select public.salvar_franquia_padrao('ia_treino_texto', -1)", *M, erro="franquia inválida")
checar("cliente não muda a franquia padrão", False,
       "select public.salvar_franquia_padrao('ia_treino_texto', 999)", *CL, erro="Master")
checar("anon não chama salvar_franquia_padrao", False,
       "select public.salvar_franquia_padrao('ia_treino_texto', 999)", *ANON, erro="permission denied")
sv("update public.cobranca_itens set franquia_padrao = 1000 where codigo = 'ia_treino_voz'")

# ------------------------------------------------------------------ tabela e mínimo fora da Mensageria e da IA
checar("Administrativo define tabela e mínimo da plataforma do agente de voz", True,
       "select public.salvar_preco_padrao('voz_plataforma', 300, 250); select preco_minimo::int || '|' || "
       "preco_tabela::int from public.cobranca_itens where codigo = 'voz_plataforma'", *A, valor="250|300")
checar("Master define a tabela da Orquestração sem mínimo (vazio = sem mínimo)", True,
       "select public.salvar_preco_padrao('contratos', 0.5); select coalesce(preco_minimo::text, 'sem') || '|' || "
       "preco_tabela::numeric(4,2) from public.cobranca_itens where codigo = 'contratos'", *M, valor="sem|0.50")
checar("tabela abaixo do mínimo é recusada", False,
       "select public.salvar_preco_padrao('jornada_clientes', 1, 2)", *A, erro="mínimo fica entre")
checar("tabela zero é recusada", False, "select public.salvar_preco_padrao('jornada_clientes', 0)", *A,
       erro="preço de tabela")
checar("item de IA fica com o Master em Margem › IA", False,
       "select public.salvar_preco_padrao('ia_treino_voz', 2)", *M, erro="item de IA")
checar("produto da Mensageria fica em Produtos (salvar_produto)", False,
       "select public.salvar_preco_padrao('sms', 0.1)", *M, erro="Mensageria")
checar("item que usa o preço de outro é recusado", False,
       "select public.salvar_preco_padrao('sms_resposta', 0.1)", *M, erro="sem preço próprio")
checar("Comercial não define tabela", False, "select public.salvar_preco_padrao('voz_plataforma', 400)", *C,
       erro="sem permissão")
checar("Atendimento não define tabela", False, "select public.salvar_preco_padrao('voz_plataforma', 400)", *AT,
       erro="sem permissão")
checar("cliente não define tabela", False, "select public.salvar_preco_padrao('voz_plataforma', 1)", *CL,
       erro="sem permissão")
checar("anon não chama salvar_preco_padrao", False, "select public.salvar_preco_padrao('voz_plataforma', 1)", *ANON,
       erro="permission denied")

# ------------------------------------------------------------------ preço e franquia da empresa
checar("Administrativo grava preço e franquia do treino por voz: vale no próximo ciclo", True,
       spf(EA, "ia_treino_voz", "flat", 1.80, 1500), *A, valor=f"t|{PROX}|1500")
checar("franquia_treino lê a franquia da empresa na vigência", True,
       f"select public.franquia_treino({EA}, 'ia_treino_voz', '{PROX}')", valor=1500)
checar("regravar o preço na mesma vigência sem franquia mantém a franquia gravada", True,
       spf(EA, "ia_treino_voz", "flat", 1.90), *A, valor=f"t|{PROX}|1500")
checar("o preço novo ficou na vigência (um só por mês)", True,
       f"select count(*) || '|' || max(preco)::numeric(4,2) from public.precos_empresa where empresa_id = {EA} "
       f"and item = 'ia_treino_voz' and vigente_desde = '{PROX}'", valor="1|1.90")
checar("neste ciclo sem motivo é recusado", False,
       spf(EA, "ia_treino_texto", "flat", 1.30, 100, "atual"), *A, erro="motivo")
checar("neste ciclo com motivo: franquia vazia = a padrão (300)", True,
       spf(EA, "ia_treino_texto", "flat", 1.30, "null", "atual", "null", "'acordo comercial de novembro'"), *A,
       valor=f"t|{ATUAL}|300")
checar("franquia zero (tudo é cobrado) é aceita", True,
       spf(EA, "ia_treino_texto", "flat", 1.30, 0, "atual", "null", "'acordo comercial de novembro'"), *A,
       valor=f"t|{ATUAL}|0")
checar("franquia_treino do texto agora é 0", True,
       f"select public.franquia_treino({EA}, 'ia_treino_texto', '{ATUAL}')", valor=0)
checar("guarda da IA: preço abaixo do mínimo recusado (Administrativo)", False,
       spf(EA, "ia_treino_voz", "flat", 1.00, 1500), *A, erro="mínimo")
checar("guarda da IA: abaixo do mínimo recusado até para o Master, mesmo com motivo", False,
       spf(EA, "ia_treino_voz", "flat", 1.00, 1500, "proximo", "'cliente estratégico'"), *M, erro="mínimo")
checar("guarda da IA: mensalidade não vale para item de IA", False,
       spf(EA, "ia_treino_voz", "mensalidade", 500), *M, erro="mensalidade")
checar("franquia em item sem franquia é recusada", False,
       spf(EA, "voz_plataforma", "mensalidade", 300, 10), *A, erro="não tem franquia")
checar("franquia negativa é recusada", False, spf(EA, "ia_treino_voz", "flat", 1.80, -5), *A, erro="franquia inválida")
checar("plataforma do agente de voz como mensalidade (sem franquia)", True,
       spf(EA, "voz_plataforma", "mensalidade", 320), *A, valor=f"t|{PROX}|")
sv("select public.salvar_preco_padrao('contratos', 0.5, 0.4)", *M)
checar("abaixo do mínimo do catálogo sem motivo é recusado", False,
       spf(EA, "contratos", "flat", 0.30), *A, erro="motivo")
checar("abaixo do mínimo do catálogo com motivo (Administrativo)", True,
       spf(EA, "contratos", "flat", 0.30, "null", "proximo", "'volume de 2 milhões de CPFs'"), *A, valor=f"t|{PROX}|")
checar("o motivo do abaixo do mínimo ficou gravado", True,
       f"select motivo_abaixo from public.precos_empresa where empresa_id = {EA} and item = 'contratos' "
       f"and vigente_desde = '{PROX}'", valor="volume de 2 milhões de CPFs")
checar("Créditos de IA: Administrativo não muda a franquia da empresa", False,
       spf(EA, "ia_creditos", "flat", 1.95, 200), *A, erro="Master")
checar("Créditos de IA: Master muda preço e franquia da empresa", True,
       spf(EA, "ia_creditos", "flat", 1.95, 200), *M, valor=f"t|{PROX}|200")
checar("Créditos de IA: Administrativo muda só o preço e a franquia do Master fica", True,
       spf(EA, "ia_creditos", "flat", 2.10), *A, valor=f"t|{PROX}|200")
checar("Comercial não grava preço (editar_precos)", False, spf(EA, "ia_treino_voz", "flat", 1.80, 1500), *C,
       erro="sem permissão")
checar("Atendimento não grava preço", False, spf(EA, "ia_treino_voz", "flat", 1.80, 1500), *AT, erro="sem permissão")
checar("Administrativo da carteira não grava preço de empresa fora dela", False,
       spf(EA, "ia_treino_voz", "flat", 1.80, 1500), *AC, erro="sem permissão")
checar("Administrativo da carteira grava na empresa da carteira", True,
       spf(EB, "ia_treino_voz", "flat", 1.60, 800), *AC, valor=f"t|{sv(f'select public.proximo_ciclo_mes({EB})')}|800")
checar("cliente (Admin da empresa) não grava preço nem franquia", False,
       spf(EA, "ia_treino_voz", "flat", 1.80, 5000), *CL, erro="sem permissão")
checar("anon não chama salvar_preco_franquia", False, spf(EA, "ia_treino_voz", "flat", 1.80, 5000), *ANON,
       erro="permission denied")
checar("site não grava precos_empresa direto", False,
       f"update public.precos_empresa set franquia = 99999 where empresa_id = {EA}", *A, erro="permission denied")
checar("o cliente vê a franquia da própria empresa (leitura)", True,
       f"select count(*) > 0 from public.precos_empresa where empresa_id = {EA} and franquia is not null", *CL,
       valor="t")
checar("o gatilho do catálogo não fica exposto ao site", True,
       "select has_function_privilege('authenticated', 'public.guardar_franquia_padrao()', 'execute')", valor="f")

# ------------------------------------------------------------------ volta o que mudou fora das empresas de teste
for c in CATALOGO:
    sv("update public.cobranca_itens set preco_minimo = {mn}, preco_tabela = {tb}, franquia_padrao = {fr} "
       "where codigo = '{c}'".format(c=c["c"], fr=c["fr"],
                                     mn="null" if c["min"] is None else c["min"], tb="null" if c["tab"] is None else c["tab"]))
imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
