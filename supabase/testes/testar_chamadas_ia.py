"""SQL 125 · Agente de voz por minuto falado: o minuto de IA de cada chamada (PR 3).

Cobre: a migração roda duas vezes; o gatilho tarifar_ia_chamada_voz com a mesma tabela de casos da VM
(tests/dados/tarifacao_ia_casos.json, parte "chamadas": soma dos trechos, transferência corta, máquina = 0, cadência uma
vez por ligação); 47→48 e 12→30 com valor = tarifados × R$ 1,25 ÷ 60; tempo grátis do contrato; desfecho máquina ou
caixa postal = 0 (também quando chega depois); licença = ceil dos segundos sem preço; legado sem contrato = segundos
informativos e valor nulo (fatura não muda); vigência com hora (antes do contrato = legado); preço novo "agora" só nas
chamadas seguintes; congelamento (reenvio ignorado; mudar a tarifação direto dá erro); minutos_ia compatível;
voz_vm.gravar_chamadas aceita os trechos e recusa as colunas da tarifação; o cliente lê as colunas novas, só da empresa.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_chamadas_ia.py
Só dados fictícios (empresas e125-*, e-mails @exemplo.test).
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
SQL125 = RAIZ / "supabase" / "migrations" / "20270323000001_voz_chamadas_ia.sql"
CASOS = json.loads((RAIZ / "tests" / "dados" / "tarifacao_ia_casos.json").read_text(encoding="utf-8"))


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 125: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL125)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
PARAM = sv("select impostos_pct || ',' || mc_minima_ia_pct from public.parametros_margem where id = 1")
TETO_ANTES = sv("select concorrencia_contratada from public.voz_contrato")
sv("update public.parametros_margem set impostos_pct = 0 where id = 1")
ITEM_MC = sv("select coalesce(mc_minima_ia_pct::text, 'null') from public.cobranca_itens where codigo = 'voz_minuto_ia'")
sv("update public.cobranca_itens set mc_minima_ia_pct = 60 where codigo = 'voz_minuto_ia'")
sv("update public.voz_contrato set concorrencia_contratada = concorrencia_contratada + 100")
EA = sv(f"insert into public.empresas (slug, nome) values ('e125-a-{T}', 'E125 A {T}') returning id")   # por minuto
EL = sv(f"insert into public.empresas (slug, nome) values ('e125-l-{T}', 'E125 L {T}') returning id")   # licença
EG = sv(f"insert into public.empresas (slug, nome) values ('e125-g-{T}', 'E125 G {T}') returning id")   # legado
EB = sv(f"insert into public.empresas (slug, nome) values ('e125-b-{T}', 'E125 B {T}') returning id")   # grátis 3
for e in (EA, EL, EG, EB):
    sv(f"insert into public.voz_config (empresa_id) values ({e})")
U = {}
for p in ("master", "cli", "clib"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}125-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', equipe=true, nome='Mara Master' where id='{U['master']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['cli']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EB} where id='{U['clib']}'")
M = ("authenticated", U["master"])
CL = ("authenticated", U["cli"])
CB = ("authenticated", U["clib"])

# contratos: A por minuto 0/30/6 a R$ 1,25 desde 1 hora atrás; B com 3 s grátis; L com licença; G sem nada
sv(f"select public.salvar_cobranca_ia_voz({EA}, 'por_minuto', 'Contrato por minuto.', preco => 1.25, "
   f"limite_conversas => 5, quando => 'agora', overbooking_confirmado => true)", *M)
sv(f"select public.salvar_cobranca_ia_voz({EB}, 'por_minuto', 'Contrato com tolerância.', preco => 1.25, gratis_s => 3, "
   f"limite_conversas => 5, quando => 'agora', overbooking_confirmado => true)", *M)
sv(f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, vigente_desde, motivo) "
   f"select {EL}, 2, 'por_robo', preco_tabela, current_date - 1, 'Licença de teste.' from public.cobranca_itens "
   f"where codigo = 'voz_licenca_robo'")
INICIO_A = sv(f"select vigente_desde from public.voz_cobranca_ia where empresa_id = {EA}")
n = 0


def chamada(emp, segundos, trechos=None, extra="", inicio="now()"):
    """Insere uma chamada encerrada com a medição da VM; devolve o id_chamada."""
    global n
    n += 1
    idc = f"c125-{T}-{n}"
    tj = "null" if trechos is None else "'" + json.dumps([[a, f, "fim"] for a, f in trechos]) + "'"
    sv(f"insert into public.voz_chamadas (empresa_id, id_chamada, id_cliente, ocorrido_em, atendida_em, encerrada_em, "
       f"billsec, ia_inicio_em, ia_fim_em, ia_trechos, segundos_ia, segundos_sessao_ia{', ' + extra.split('=')[0] if extra else ''}) "
       f"values ({emp}, '{idc}', 'K{n}', {inicio}, {inicio}, {inicio} + interval '2 minutes', 120, {inicio}, "
       f"{inicio} + interval '1 minute', {tj}, {segundos}, {segundos} + 5{', ' + extra.split('=', 1)[1] if extra else ''})")
    return idc


def tar(idc):
    return (f"select segundos_ia_tarifados || '|' || coalesce(cadencia_ia, '-') || '|' || coalesce(valor_ia::text, '-') "
            f"from public.voz_chamadas where id_chamada = '{idc}'")


# ------------------------------------------------------------------ a mesma tabela de casos da VM
for c in CASOS["chamadas"]:
    seg = c["segundos_ia"]
    idc = chamada(EA, seg, [tuple(x) for x in c["trechos"]])
    valor = f"{c['tarifados'] * 1.25 / 60:.5f}"
    checar(f"por minuto: {c['nome']}", True, tar(idc), valor=f"{c['tarifados']}|0/30/6|{valor}")
for c in CASOS["casos"]:
    if c["cadencia"] != "0/30/6" or c["segundos"] < 0:
        continue
    idc = chamada(EA, c["segundos"])
    checar(f"por minuto (casos): {c['nome']}", True,
           f"select segundos_ia_tarifados from public.voz_chamadas where id_chamada = '{idc}'", valor=c["tarifados"])

# ------------------------------------------------------------------ regras
idc = chamada(EA, 47)
checar("47 s viram 48 s e R$ 1,00 (48 × 1,25 ÷ 60), contrato e preço congelados", True,
       f"select segundos_ia_tarifados || '|' || preco_minuto_ia || '|' || valor_ia || '|' || (cobranca_ia_id is not null) "
       f"|| '|' || minutos_ia || '|' || (ia_tarifada_em is not null) from public.voz_chamadas where id_chamada = '{idc}'",
       valor="48|1.25000|1.00000|true|0.80|true")
idc12 = chamada(EA, 12)
checar("12 s viram 30 s e R$ 0,625", True, tar(idc12), valor="30|0/30/6|0.62500")
idc = chamada(EB, 2.5)
checar("tempo grátis 3 s: 2,5 s não cobram", True, tar(idc), valor="0|3/30/6|0.00000")
idc = chamada(EB, 3.001)
checar("tempo grátis 3 s: 3,001 s cobram 30", True, tar(idc), valor="30|3/30/6|0.62500")
idc = chamada(EA, 40, extra="resultado='maquina'")
checar("desfecho máquina: 0 s e R$ 0", True, tar(idc), valor="0|0/30/6|0.00000")
idc = chamada(EA, 40, extra="resultado='caixa_postal'")
checar("desfecho caixa postal: 0 s e R$ 0", True, tar(idc), valor="0|0/30/6|0.00000")
idc = chamada(EA, 40)
checar("caixa postal que chega depois baixa para zero", True,
       f"update public.voz_chamadas set resultado = 'caixa_postal' where id_chamada = '{idc}'; " + tar(idc),
       valor="0|0/30/6|0.00000")
idc = chamada(EL, 47.2)
checar("licença: ceil dos segundos, sem cadência nem preço (quem cobra é a licença)", True, tar(idc), valor="48|-|-")
idc = chamada(EG, 47)
checar("legado sem contrato: segundos com a cadência padrão, sem preço nem valor", True,
       tar(idc) + "", valor="48|0/30/6|-")
checar("legado sem contrato: sem cobranca_ia_id", True,
       f"select coalesce(cobranca_ia_id::text, '-') from public.voz_chamadas where id_chamada = '{idc}'", valor="-")
idc = chamada(EA, 47, inicio=f"('{INICIO_A}'::timestamptz - interval '10 minutes')")
checar("vigência com hora: IA que começou antes do contrato fica no legado (sem valor)", True, tar(idc),
       valor="48|0/30/6|-")
# ------------------------------------------------------------------ congelamento
checar("reenvio com outra medição é ignorado (fica 30 s)", True,
       f"update public.voz_chamadas set segundos_ia = 95 where id_chamada = '{idc12}'; " + tar(idc12),
       valor="30|0/30/6|0.62500")
checar("mudar a tarifação direto dá erro", False,
       f"update public.voz_chamadas set valor_ia = 9 where id_chamada = '{idc12}'", erro="já foi feita e não muda")
sv(f"select public.salvar_cobranca_ia_voz({EA}, 'por_minuto', 'Reajuste negociado.', preco => 1.40, quando => 'agora')", *M)
idc = chamada(EA, 12)
checar("preço novo agora vale para a chamada seguinte (R$ 1,40)", True, tar(idc), valor="30|0/30/6|0.70000")
checar("a chamada anterior segue com R$ 1,25", True,
       f"select preco_minuto_ia from public.voz_chamadas where id_chamada = '{idc12}'", valor="1.25000")

# ------------------------------------------------------------------ VM e leitura
LINHA = json.dumps([{"empresa_id": int(EA), "id_chamada": f"vm125-{T}", "id_cliente": "K-VM", "canal": "agente_voz",
                     "ocorrido_em": "2026-11-05T10:00:00-03:00", "atendida_em": "2026-11-05T10:00:05-03:00",
                     "encerrada_em": "2026-11-05T10:02:00-03:00", "billsec": 115,
                     "ia_inicio_em": "2026-11-05T10:00:06-03:00", "ia_fim_em": "2026-11-05T10:00:26.500-03:00",
                     "ia_retomada_em": "2026-11-05T10:00:56-03:00",
                     "ia_trechos": [["2026-11-05T10:00:06-03:00", "2026-11-05T10:00:26.500-03:00", "transferencia"],
                                    ["2026-11-05T10:00:56-03:00", "2026-11-05T10:01:08.250-03:00", "fim"]],
                     "segundos_ia": 32.75, "segundos_sessao_ia": 62.25}])
LINHA_SEM = LINHA.replace(', "segundos_ia": 32.75', '')
LINHA_TAR = LINHA.replace('"segundos_ia"', '"valor_ia": 1, "segundos_ia"')
checar("a VM grava os trechos (gravar_chamadas aceita as chaves novas)", True,
       f"set role motorcx_voz; select voz_vm.gravar_chamadas('{LINHA}')", valor=1)
checar("a chamada da VM ficou com 32,75 s falados e 62,25 s de sessão (custo)", True,
       f"select segundos_ia || '|' || segundos_sessao_ia || '|' || jsonb_array_length(ia_trechos) "
       f"from public.voz_chamadas where id_chamada = 'vm125-{T}'", valor="32.750|62.250|2")
checar("reenvio da VM sem os trechos não apaga a medição (coalesce)", True,
       f"set role motorcx_voz; select voz_vm.gravar_chamadas('{LINHA_SEM}'); "
       f"reset role; select segundos_ia from public.voz_chamadas where id_chamada = 'vm125-{T}'", valor="32.750")
checar("a VM não grava a tarifação do minuto de IA", False,
       f"set role motorcx_voz; select voz_vm.gravar_chamadas('{LINHA_TAR}')",
       erro="valor_ia")
checar("quem é da empresa lê as colunas novas", True,
       f"select count(*) from public.voz_chamadas where empresa_id = {EA} and segundos_ia_tarifados is not null "
       f"and cadencia_ia is not null", *CL, valor=sv(f"select count(*) from public.voz_chamadas where empresa_id = {EA} "
                                                    f"and segundos_ia_tarifados is not null and cadencia_ia is not null"))
checar("outra empresa não lê", True,
       f"select count(*) from public.voz_chamadas where empresa_id = {EA}", *CB, valor=0)
checar("a telefonia não mudou (tarifar_chamada_voz segue sozinho)", True,
       f"select count(*) from pg_trigger where tgrelid = 'public.voz_chamadas'::regclass "
       f"and tgname in ('tarifar_chamada_voz', 'tarifar_ia_chamada_voz')", valor=2)

sv(f"update public.voz_contrato set concorrencia_contratada = {TETO_ANTES}")
sv(f"update public.cobranca_itens set mc_minima_ia_pct = {ITEM_MC} where codigo = 'voz_minuto_ia'")
imp, mc = PARAM.split(",")
sv(f"update public.parametros_margem set impostos_pct = {imp}, mc_minima_ia_pct = {mc} where id = 1")
print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
