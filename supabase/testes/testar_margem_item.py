"""SQL 124 · MC mínima própria por item de IA (só o Master), PR 2 do plano "Agente de voz por minuto falado".

Cobre: a migração roda duas vezes (o padrão só na primeira vez); voz_minuto_ia nasce com 60% e tabela R$ 1,25 (com
impostos 0, mínimo R$ 1,12); a geral continua em 70% e vale para os outros itens; a mensagem do banco cita a mínima
que valeu; só o Master muda a coluna (também por gravação direta), nem o Administrativo nem o cliente; preço abaixo do
mínimo do item é recusado até para o Master; nulo volta à geral; prévia do mínimo com outra MC; caixa de margem da
Contratação (equipe vê o mínimo; %MC só o Master; cliente nada); salvar_cobranca_ia_voz aceita R$ 1,25 com 60%.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_margem_item.py
Só dados fictícios (empresas e124-*, e-mails @exemplo.test).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL124 = RAIZ / "supabase" / "migrations" / "20270322000001_ia_margem_item.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 124: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL124)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
sv("update public.parametros_margem set impostos_pct = 0, mc_minima_ia_pct = 70 where id = 1")
# a primeira vez: o item ainda sem mínima própria (como em produção antes deste SQL)
sv("update public.cobranca_itens set mc_minima_ia_pct = null, preco_minimo = 1.50, preco_tabela = 1.80 "
   "where codigo = 'voz_minuto_ia'")
aplicar(1)
checar("padrão: voz_minuto_ia com 60%, mínimo R$ 1,12 e tabela R$ 1,25", True,
       "select mc_minima_ia_pct || '|' || preco_minimo || '|' || preco_tabela || '|' || public.preco_minimo_ia(codigo) "
       "from public.cobranca_itens where codigo = 'voz_minuto_ia'", valor="60.00|1.12000|1.25000|1.12000")
sv("update public.cobranca_itens set preco_tabela = 1.30 where codigo = 'voz_minuto_ia'")
aplicar(2)
checar("rodar de novo não mexe no preço que o Master trocou", True,
       "select preco_tabela from public.cobranca_itens where codigo = 'voz_minuto_ia'", valor="1.30000")
sv("update public.cobranca_itens set preco_tabela = 1.25 where codigo = 'voz_minuto_ia'")
checar("a geral continua em 70% (pico: mínimo R$ 1,50)", True,
       "select public.mc_minima_ia_de('voz_minuto_ia_pico') || '|' || public.preco_minimo_ia('voz_minuto_ia_pico')",
       valor="70.00|1.50000")
checar("com impostos de 10%, R$ 1,25 fica abaixo do mínimo com 60% (F3)", True,
       "update public.parametros_margem set impostos_pct = 10 where id = 1; "
       "select public.preco_minimo_ia('voz_minuto_ia'); ", valor="1.50000")
sv("update public.parametros_margem set impostos_pct = 0 where id = 1")

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e124-a-{T}', 'E124 A {T}') returning id")
U = {}
for p in ("master", "adm", "com", "cli"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}124-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true, nome='Mara Master' where id='{U['master']}'")
sv(f"update public.perfis set papel='planejamento', equipe=true, equipe_alcance='todas' where id='{U['adm']}'")
sv(f"update public.perfis set papel='gestao', equipe=true, equipe_alcance='todas' where id='{U['com']}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{U['cli']}'")
sv(f"insert into public.permissoes_equipe (usuario_id, permissao, permitido) values ('{U['com']}', 'editar_contratacao', true)")
M = ("authenticated", U["master"])
A = ("authenticated", U["adm"])
C = ("authenticated", U["com"])
CL = ("authenticated", U["cli"])

# ------------------------------------------------------------------ guarda com a mínima do item
checar("preço abaixo do mínimo do item é recusado até para o Master, citando 60% deste item", False,
       f"select public.salvar_preco({EA}, 'voz_minuto_ia', 'flat', 1.11)", *M,
       erro="o menor preço aceito é R$ 1,12 por minuto (MC mínima de 60% deste item)")
checar("R$ 1,25 é aceito no minuto de IA", True,
       f"select public.salvar_preco({EA}, 'voz_minuto_ia', 'flat', 1.25) > 0", *M, valor="t")
checar("o pico segue com a geral: abaixo de R$ 1,50 é recusado citando 70% da IA", False,
       f"select public.salvar_preco({EA}, 'voz_minuto_ia_pico', 'flat', 1.25)", *M, erro="MC mínima de 70% da IA")
checar("salvar_cobranca_ia_voz aceita R$ 1,25 (60% no item)", True,
       f"select cobranca_id is not null from public.salvar_cobranca_ia_voz({EA}, 'por_minuto', 'Contrato por minuto.', "
       f"preco => 1.25, limite_conversas => 3, quando => 'agora', overbooking_confirmado => true)", *M, valor="t")

# ------------------------------------------------------------------ quem muda a mínima do item
checar("Administrativo não muda a mínima do item (RPC)", False,
       "select public.salvar_mc_minima_ia_item('voz_minuto_ia', 50)", *A, erro="só um Master")
checar("quem cuida do catálogo (editar_produtos) não muda direto na tabela", False,
       f"insert into public.permissoes_equipe (usuario_id, permissao, permitido) values ('{U['com']}', 'editar_produtos', true) "
       f"on conflict do nothing; set role authenticated; select set_config('request.jwt.claim.sub', '{U['com']}', false); "
       "update public.cobranca_itens set mc_minima_ia_pct = 50 where codigo = 'voz_minuto_ia'", erro="só um Master")
checar("cliente não muda", False, "select public.salvar_mc_minima_ia_item('voz_minuto_ia', 50)", *CL)
checar("item que não é de IA é recusado", False, "select public.salvar_mc_minima_ia_item('voz_plataforma', 50)", *M,
       erro="não é de IA")
checar("fora de 0 a 99 é recusado", False, "select public.salvar_mc_minima_ia_item('voz_minuto_ia', 100)", *M,
       erro="de 0 a 99")
checar("prévia do Master: com 70% o mínimo seria R$ 1,50; com 60%, R$ 1,12", True,
       "select public.preco_minimo_ia_com_mc('voz_minuto_ia', 70) || '|' || public.preco_minimo_ia_com_mc('voz_minuto_ia', 60)",
       *M, valor="1.50000|1.12000")
checar("prévia só para o Master", False, "select public.preco_minimo_ia_com_mc('voz_minuto_ia', 60)", *C,
       erro="só um Master")
checar("Master sobe para 65%: nenhum preço muda, o de R$ 1,25 vira abaixo do mínimo", True,
       "select public.salvar_mc_minima_ia_item('voz_minuto_ia', 65) > 0", *M, valor="t")
checar("ia_precos_abaixo_minimo lista o preço da empresa contra o mínimo de 65% (R$ 1,28)", True,
       f"select preco || '<' || preco_minimo_ia from public.ia_precos_abaixo_minimo() where item = 'voz_minuto_ia' "
       f"and empresa_id = {EA}", *M, valor="1.25000<1.28000")
checar("nulo volta à geral (70%)", True,
       "select public.salvar_mc_minima_ia_item('voz_minuto_ia', null); select public.mc_minima_ia_de('voz_minuto_ia')",
       *M, valor="70.00")
checar("Master volta para 60%", True,
       "select public.salvar_mc_minima_ia_item('voz_minuto_ia', 60); select mc_minima_ia_pct from public.cobranca_itens "
       "where codigo = 'voz_minuto_ia'", *M, valor="60.00")
checar("o site lê a mínima do item no catálogo", True,
       "select mc_minima_ia_pct from public.cobranca_itens where codigo = 'voz_minuto_ia'", *CL, valor="60.00")

# ------------------------------------------------------------------ caixa de margem da Contratação
checar("equipe vê o menor preço aceito e a mínima; sem a %MC (custo é do Master)", True,
       "select preco_minimo || '|' || mc_minima_pct || '|' || coalesce(mc_pct::text, '-') || '|' || "
       "coalesce(problema, 'ok') from public.margem_preco_ia('voz_minuto_ia', 1.25)", *C, valor="1.12000|60.00|-|ok")
checar("Master vê a %MC de R$ 1,25 (64,2%)", True,
       "select mc_pct from public.margem_preco_ia('voz_minuto_ia', 1.25)", *M, valor="64.2")
checar("abaixo do mínimo: a mesma mensagem do banco", True,
       "select problema from public.margem_preco_ia('voz_minuto_ia', 1.00)", *C,
       valor="preço abaixo do mínimo para item de IA (Agente virtual · minuto de IA): o menor preço aceito é R$ 1,12 "
             "por minuto (MC mínima de 60% deste item)")
checar("cliente não usa a caixa de margem", False, "select * from public.margem_preco_ia('voz_minuto_ia', 1.25)", *CL,
       erro="só a equipe")

imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
