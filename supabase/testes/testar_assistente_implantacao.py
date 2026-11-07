"""SQL 74 · Assistente de implantação e mapeamento da carga geral pelo site.

Cobre: criar_empresa_implantacao numa transação só (empresa, motor, módulo, ciclo, preço por CPF, contato, progresso),
idempotente pela chave (o retry devolve a MESMA empresa) e pelo CNPJ; erro no meio não deixa nada pela metade; só a
equipe cria. salvar_carteira_implantacao renomeia a "Carteira principal" (não cria outra). salvar_mapeamento_base:
campos obrigatórios, colunas do último arquivo, uma coluna por campo, cliente ≠ CPF, pedido de rotina quando a carga
espera; outra empresa não grava. salvar_canais_implantacao: quem envia (lista/motorcx/desligado), MotorCX só com a
Mensageria do canal, frases padrão do SMS sem duplicar a da empresa, aprovação do primeiro lote. implantacao_situacao
para quem vê a empresa (a outra empresa e o anônimo não). Aplica o SQL 74 duas vezes.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_assistente_implantacao.py
Só dados fictícios (empresas imp74-*, e-mails @exemplo.test).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL74 = RAIZ / "supabase" / "migrations" / "20270110000001_assistente_implantacao.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 74: " + nome
          + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL74)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

# ------------------------------------------------------------------ pessoas fictícias (um sufixo por rodada)
import random
import uuid
T = uuid.uuid4().hex[:6]


def cnpj_ficticio():
    n = [random.randint(0, 9) for _ in range(8)] + [0, 0, 0, 1]
    for pesos in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        d = sum(a * b for a, b in zip(n, pesos)) % 11
        n.append(0 if d < 2 else 11 - d)
    return "".join(map(str, n))


DOC = cnpj_ficticio()
OUTRA = sv(f"insert into public.empresas (slug, nome) values ('imp74-outra-{T}', 'Imp74 Outra {T}') returning id")
U = {}
for p in ("master", "vend", "admo", "adm"):
    U[p] = sv(f"insert into auth.users (email) values ('imp74.{p}.{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true, nome='Master teste' where id='{U['master']}'")
sv(f"update public.perfis set papel='admin', empresa_id={OUTRA}, nome='Admin outra' where id='{U['admo']}'")
M = U["master"]
PISO = sv("select coalesce(preco_minimo::text, 'null') from public.cobranca_itens where codigo = 'contratos'")
CH = str(uuid.uuid4())
CRIAR = ("select public.criar_empresa_implantacao(chave => '{ch}', nome => 'Imp74 Aurora {T} (fictícia)', "
         "razao_social => 'Imp74 Aurora Cobranças Ltda', admin_nome => 'Renata Teste', "
         "admin_email => 'imp74.adm.{T}@exemplo.test', preco => {preco}, minimo => 1500{extra})")

# ------------------------------------------------------------------ passo 1
checar("cliente (Admin de outra empresa) não cria empresa", False, CRIAR.format(ch=CH, preco=0.38, extra="", T=T),
       "authenticated", U["admo"], erro="equipe MotorCX")
checar("anônimo não chama", False, CRIAR.format(ch=CH, preco=0.38, extra="", T=T), "anon")
checar("preço abaixo do mínimo sem motivo: nada é criado (transação)", False,
       "update public.cobranca_itens set preco_minimo = 0.30 where codigo = 'contratos'; "
       "set role authenticated; select set_config('request.jwt.claim.sub', '" + M + "', false); "
       + CRIAR.format(ch=CH, preco=0.10, extra="", T=T), erro="motivo")
checar("…e a empresa não ficou pela metade", True, f"select count(*) from public.empresas where nome = 'Imp74 Aurora {T} (fictícia)'",
       valor=0)
EID = sv(CRIAR.format(ch=CH, preco=0.38, extra="", T=T), "authenticated", M)
checar("Master cria a empresa numa chamada (pelo nome dos argumentos)", True, f"select {EID} > 0", valor="t")
checar("retry com a mesma chave devolve a MESMA empresa", True, CRIAR.format(ch=CH, preco=0.38, extra="", T=T),
       "authenticated", M, EID)
checar("…e não existe outra com slug -2", True, f"select count(*) from public.empresas where nome = 'Imp74 Aurora {T} (fictícia)'",
       valor=1)
checar("empresa em implantação, com slug sem acento", True, f"select situacao || '|' || slug from public.empresas where id = {EID}",
       valor=f"implantacao|imp74-aurora-{T}-ficticia")
checar("MotorCob + Orquestração ligados", True,
       f"select count(*) from public.empresa_modulos where empresa_id = {EID} and modulo = 'orquestracao' and ativo", valor=1)
checar("ciclo padrão: mensal, pós-pago, boleto e Pix, revisar antes de emitir", True,
       f"select periodicidade || '|' || modelo_pagamento || '|' || array_to_string(formas, ',') || '|' || emissao "
       f"from public.ciclo_empresa where empresa_id = {EID}", valor="mensal|pos|boleto,pix|revisar")
checar("preço por CPF ativo gravado (0,38, mínimo 1.500)", True,
       f"select preco || '|' || minimo from public.precos_empresa where empresa_id = {EID} and item = 'contratos'",
       valor="0.38000|1500.00")
checar("contato do Admin gravado", True, f"select count(*) from public.empresa_contatos where empresa_id = {EID} "
       f"and email = 'imp74.adm.{T}@exemplo.test'", valor=1)
checar("progresso: passo 2, passo 1 feito", True,
       f"select passo || '|' || array_to_string(feitos, ',') from public.implantacao_progresso where empresa_id = {EID}",
       valor="2|1")
checar("sal do faturamento criado", True, f"select count(*) from public.faturamento_sal where empresa_id = {EID}", valor=1)
checar("mesmo CNPJ abre a empresa que já existe", True,
       f"update public.empresas set cnpj = '{DOC}' where id = {EID}; set role authenticated; "
       f"select set_config('request.jwt.claim.sub', '{M}', false); "
       + CRIAR.format(ch=str(uuid.uuid4()), preco=0.38, extra=f", cnpj => '{DOC}'", T=T),
       valor=EID)
checar("CNPJ inválido é recusado", False,
       CRIAR.format(ch=str(uuid.uuid4()), preco=0.38, extra=", cnpj => '11.111.111/1111-11'", T=T),
       "authenticated", M, erro="CNPJ inválido")

# Admin da empresa nova (o convite cria o perfil)
sv(f"update public.perfis set papel='admin', empresa_id={EID}, nome='Renata Teste' where id='{U['adm']}'")
A = U["adm"]

# ------------------------------------------------------------------ passo 2
checar("a empresa nasce com a Carteira principal", True,
       f"select count(*) from public.credores where empresa_id = {EID} and codigo = 'principal'", valor=1)
checar("Admin de outra empresa não mexe", False,
       f"select * from public.salvar_carteira_implantacao(empresa => {EID}, nome => 'Banco Horizonte')",
       "authenticated", U["admo"])
checar("nome curto é recusado com frase de carteira", False,
       f"select * from public.salvar_carteira_implantacao(empresa => {EID}, nome => 'B')", "authenticated", A,
       erro="Dê um nome à carteira")
checar("renomeia a principal (código não muda)", True,
       f"select credor_codigo || '|' || credor_nome from public.salvar_carteira_implantacao(empresa => {EID}, "
       "nome => 'Banco Horizonte · Cartões', entrada => 'arquivo')", "authenticated", A,
       "principal|Banco Horizonte · Cartões")
checar("…e continua uma carteira só", True, f"select count(*) from public.credores where empresa_id = {EID}", valor=1)
CID = sv(f"select id from public.credores where empresa_id = {EID} and codigo = 'principal'")

# ------------------------------------------------------------------ passo 3
sv(f"insert into public.mapeamento_arquivos (empresa_id, credor_id, tipo, cabecalho, arquivo, sugerido, visto_em) values "
   f"({EID}, {CID}, 'base', '[\"COD\",\"DOC\",\"VL_ATU\",\"ATR\",\"CEL1\",\"CEL2\",\"MAIL\"]', 'carga.csv', "
   "'{\"id_cliente\": \"COD\", \"cpf\": \"DOC\"}', now())", "service_role")
sv(f"insert into public.envios (empresa_id, credor_id, tipo, caminho, nome_original, status, enviado_por) values "
   f"({EID}, {CID}, 'base', 'imp74/base/{T}.csv', 'carga.csv', 'aguardando', '{A}')", "service_role")
BOM = '{"id_cliente": "COD", "cpf": "DOC", "saldo": "VL_ATU", "dias_atraso": "ATR", "telefones": ["CEL1", "CEL2"], "emails": ["MAIL"]}'
checar("falta saldo e telefone: mensagem conta as colunas", False,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{{\"id_cliente\": \"COD\", \"dias_atraso\": \"ATR\"}}')",
       "authenticated", A, erro="Falta apontar 2 colunas: o saldo, o telefone ou o e-mail")
checar("coluna que não está no arquivo é recusada", False,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{BOM.replace('VL_ATU', 'SALDO_X')}')",
       "authenticated", A, erro="não está no último arquivo")
checar("mesma coluna em dois campos é recusada (cliente = CPF)", False,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{BOM.replace(chr(34) + 'COD' + chr(34), chr(34) + 'DOC' + chr(34), 1)}')",
       "authenticated", A, erro="mais de um campo")
checar("campo desconhecido é recusado", False,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{{\"nome\": \"X\"}}')", "authenticated", A,
       erro="campo desconhecido")
checar("cabeçalho lido no navegador vale antes do motor ver o arquivo", True,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{{\"id_cliente\": \"A\", \"saldo\": \"B\", "
       f"\"vencimento\": \"C\", \"telefones\": [\"D\"]}}', cabecalho => '[\"A\",\"B\",\"C\",\"D\"]') ->> 'colunas'; "
       f"select cabecalho::text from public.mapeamento_arquivos where credor_id = {CID} and tipo = 'base'",
       "authenticated", A, '["A", "B", "C", "D"]')
sv(f"update public.mapeamento_arquivos set cabecalho = '[\"COD\",\"DOC\",\"VL_ATU\",\"ATR\",\"CEL1\",\"CEL2\",\"MAIL\"]' "
   f"where credor_id = {CID} and tipo = 'base'")
checar("Admin de outra empresa não grava", False,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{BOM}')", "authenticated", U["admo"])
checar("mapeamento salvo pede a rotina de novo (carga aguardando)", True,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{BOM}') ->> 'reprocessar'", "authenticated", A,
       "true")
checar("…um pedido na fila", True, f"select count(*) from public.pedidos_rotina where credor_id = {CID} and status = 'pendente'",
       valor=1)
checar("…mapeamento confirmado com as colunas", True,
       f"select confirmado || '|' || (colunas ->> 'saldo') || '|' || (colunas -> 'telefones' ->> 1) "
       f"from public.mapeamento_arquivos where credor_id = {CID} and tipo = 'base'", valor="true|VL_ATU|CEL2")
checar("salvar de novo não duplica o pedido", True,
       f"select public.salvar_mapeamento_base(credor => {CID}, colunas => '{BOM}'); "
       f"select count(*) from public.pedidos_rotina where credor_id = {CID} and status = 'pendente'", "authenticated", A, 1)

# ------------------------------------------------------------------ passo 4
checar("MotorCX não envia sem a Mensageria", False,
       f"select public.salvar_canais_implantacao(empresa => {EID}, canais => '{{\"sms\": \"motorcx\"}}')",
       "authenticated", A, erro="Mensageria contratada")
FR = json.dumps([{"estagio": "localizacao", "texto": "Imp74: temos uma condição para o seu contrato."},
                 {"estagio": "quebra", "texto": "Imp74: a parcela de {valor_parcela} venceu."}])
checar("lista para baixar (padrão) e frases padrão do SMS", True,
       f"select public.salvar_canais_implantacao(empresa => {EID}, canais => "
       "'{\"whatsapp\": \"lista\", \"sms\": \"lista\", \"email\": \"lista\", \"rcs\": \"desligado\", \"discador\": \"desligado\"}', "
       f"aprovacao => 'primeiro', frases => '{FR}'); "
       f"select string_agg(canal || '=' || ativo || '/' || coalesce(quem_envia, '-'), ',' order by canal) "
       f"from public.canais_empresa where empresa_id = {EID}", "authenticated", A,
       "discador=false/-,email=true/lista,rcs=false/-,sms=true/lista,whatsapp=true/lista")
checar("…frases por etapa gravadas", True,
       f"select string_agg(estagio, ',' order by estagio) from public.frases where empresa_id = {EID} and canal = 'sms'",
       valor="localizacao,quebra")
sv(f"update public.frases set nome = 'Minha frase', texto = 'texto da empresa' where empresa_id = {EID} and estagio = 'quebra'")
checar("frase da própria empresa não é duplicada pela padrão", True,
       f"select public.salvar_canais_implantacao(empresa => {EID}, canais => '{{}}', frases => '{FR}'); "
       f"select count(*) from public.frases where empresa_id = {EID} and estagio = 'quebra'", "authenticated", A, 1)
checar("frase acima de 160 caracteres é recusada", False,
       f"select public.salvar_canais_implantacao(empresa => {EID}, canais => '{{}}', frases => "
       f"'[{{\"estagio\": \"cpa\", \"texto\": \"{'x' * 170}\"}}]')", "authenticated", A, erro="160 caracteres")
sv(f"insert into public.empresa_modulos (empresa_id, modulo, ativo, canais) values ({EID}, 'mensageria', true, '{{sms}}') "
   "on conflict (empresa_id, modulo) do update set ativo = true, canais = '{sms}'")
checar("com a Mensageria do SMS: MotorCX envia e aprova só o primeiro lote", True,
       f"select public.salvar_canais_implantacao(empresa => {EID}, canais => '{{\"sms\": \"motorcx\"}}', aprovacao => 'primeiro'); "
       f"select (select quem_envia from public.canais_empresa where empresa_id = {EID} and canal = 'sms') || '|' || "
       f"aprovar_lotes || '|' || aprovar_primeiro from public.mensageria_config where empresa_id = {EID}",
       "authenticated", A, "motorcx|true|true")
checar("e-mail continua só em lista (Mensageria sem e-mail)", False,
       f"select public.salvar_canais_implantacao(empresa => {EID}, canais => '{{\"email\": \"motorcx\"}}')",
       "authenticated", A, erro="e-mail")

# ------------------------------------------------------------------ passo 5
checar("situação: Admin da empresa lê", True,
       f"select (s -> 'carteira' ->> 'nome') || '|' || (s -> 'carga' ->> 'status') || '|' || (s -> 'mapeamento' ->> 'confirmado') "
       f"|| '|' || (s -> 'canais' -> 'sms' ->> 'quem_envia') || '|' || (s -> 'preco' ->> 'preco') "
       f"from public.implantacao_situacao({EID}) s", "authenticated", A,
       "Banco Horizonte · Cartões|aguardando|true|motorcx|0.38000")
checar("situação: progresso no passo 5 com 1, 2 e 4 feitos", True,
       f"select s -> 'progresso' from public.implantacao_situacao(empresa => {EID}) s", "authenticated", M,
       '{"passo": 5, "feitos": [1, 2, 4]}')
sv(f"insert into public.clientes_mes (empresa_id, competencia, credor_id, cliente) select {EID}, "
   f"public.competencia_de({EID}, current_date), {CID}, left(md5('imp74-' || g), 32) from generate_series(1, 10) g", "service_role")
checar("prévia: CPFs ativos sem contar a linha do mínimo; valor com o mínimo", True,
       f"select (s -> 'previa' ->> 'cpfs') || '|' || (s -> 'previa' ->> 'valor') from public.implantacao_situacao({EID}) s",
       "authenticated", M, "10|1500.00")
checar("situação: outra empresa não lê", False, f"select public.implantacao_situacao({EID})", "authenticated", U["admo"])
checar("situação: anônimo não chama", False, f"select public.implantacao_situacao({EID})", "anon")
checar("quem recebe a fatura: e-mail novo vira contato financeiro", True,
       f"select public.definir_contato_fatura(empresa => {EID}, email => 'imp74.fin.{T}@exemplo.test'); "
       f"select (public.implantacao_situacao({EID}) ->> 'recebe_fatura')", "authenticated", A, "true")
checar("progresso: só quem vê a empresa marca", False,
       f"select public.marcar_passo_implantacao(empresa => {EID}, passo => 3)", "authenticated", U["admo"])
checar("progresso: marcar passo 3 feito", True,
       f"select public.marcar_passo_implantacao(empresa => {EID}, passo => 3, feito => true); "
       f"select array_to_string(feitos, ',') from public.implantacao_progresso where empresa_id = {EID}",
       "authenticated", A, "1,2,3,4")
checar("anônimo não chama nenhuma RPC do assistente", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ("
       "'criar_empresa_implantacao','salvar_carteira_implantacao','salvar_mapeamento_base','salvar_canais_implantacao',"
       "'implantacao_situacao','definir_contato_fatura','marcar_passo_implantacao','pode_implantar','slug_disponivel') "
       "and has_function_privilege('anon', oid, 'execute')", valor=0)
checar("RPCs do assistente com search_path fixo", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and proname in ("
       "'criar_empresa_implantacao','salvar_carteira_implantacao','salvar_mapeamento_base','salvar_canais_implantacao',"
       "'implantacao_situacao','definir_contato_fatura','marcar_passo_implantacao','pode_implantar','slug_disponivel') "
       "and not coalesce(array_to_string(proconfig, ',') like '%search_path%', false)", valor=0)
checar("tipo 'base' aceito no mapeamento; tipo inventado não", False,
       f"insert into public.mapeamento_arquivos (empresa_id, credor_id, tipo) values ({EID}, {CID}, 'xyz')")

sv(f"update public.cobranca_itens set preco_minimo = {PISO} where codigo = 'contratos'")
print(f"\nSQL 74: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
