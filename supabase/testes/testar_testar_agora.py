"""SQL 116 · Canais › Agente de voz › "Testar agora" (PR 9 do plano Canais/Agente Voz/CX).

Cobre: a migração roda duas vezes; sem voz_numeros_teste (SQL 114) o pedido explica o que falta; quem pode pedir
(editar_canais da empresa ou a equipe que cuida da voz; outra empresa e anon não); cada trava do pedido (Simulado,
número não guardado/não confirmado/fora da lista, fluxo em uso, rota ativa sem pausa, empresa parada pelas curtas,
um de cada vez, 5 por dia); o site não lê o hash; a VM pega o pedido com a referência do segredo (nunca o número) e
conclui só com marcas e contagens; o pedido parado expira; cancelar só antes de a VM pegar.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_testar_agora.py
Só dados fictícios (empresas e116-*, e-mails @exemplo.test). A tabela voz_numeros_teste é a do SQL 114 (Telefonia,
em paralelo); sem ela no banco, o teste cria uma igual só com as colunas que este SQL lê.
"""
import hashlib
import json
import os
import subprocess
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL116 = RAIZ / "supabase" / "migrations" / "20270306000001_voz_testar_agora.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 116: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL116)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)
T = uuid.uuid4().hex[:6]
E = sv(f"insert into public.empresas (slug, nome) values ('e116-{T}', 'E116 {T}') returning id")
E2 = sv(f"insert into public.empresas (slug, nome) values ('e116b-{T}', 'E116B {T}') returning id")
C = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({E}, 'c116{T}', 'Carteira Teste') returning id")
sv(f"insert into public.voz_config (empresa_id, provedor, modo) values ({E}, 'montagem_motorcx', 'simulado')")
U = {}
for p in ("adm", "ope", "out", "tec"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}116-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={E} where id='{U['adm']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={E} where id='{U['ope']}'")
sv(f"update public.perfis set papel='admin', empresa_id={E2} where id='{U['out']}'")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, "
   f"equipe_alcance='todas' where id='{U['tec']}'")
ADM, OPE, OUT, TEC = (("authenticated", U[k]) for k in ("adm", "ope", "out", "tec"))
PEDIR = "select public.pedir_teste_agora_voz({c}, {n})"

# sem o SQL 114 no banco, o pedido diz o que falta
tem_114 = sv("select to_regclass('public.voz_numeros_teste') is not null") == "t"
if not tem_114:
    sv("update public.voz_config set modo = 'teste' where empresa_id = " + E)
    checar("sem os números de teste da Telefonia, o pedido explica", False, PEDIR.format(c=C, n=1), *ADM,
           erro="cadastre um número de teste")
    checar("sem os números de teste da Telefonia, a lista vem vazia", True,
           f"select public.numeros_teste_agora_voz({E})::text", *ADM, valor="[]")
    sv("update public.voz_config set modo = 'simulado' where empresa_id = " + E)
    sv("""create table public.voz_numeros_teste (
            id bigint generated always as identity primary key,
            empresa_id bigint not null references public.empresas (id) on delete cascade,
            hash text not null, mascara text not null, segredo_ref text not null,
            guardado_em timestamptz, confirmado_em timestamptz)""")

HASH = hashlib.sha256(b"11987650041").hexdigest()
N = sv(f"insert into public.voz_numeros_teste (empresa_id, hash, mascara, segredo_ref) values "
       f"({E}, '{HASH}', '(11) 9••••-••41', 'voz/trunk/e{E}/teste-{HASH[:12]}') returning id")

checar("a tela lista os números (máscara, ainda não prontos)", True,
       f"select public.numeros_teste_agora_voz({E}) -> 0 ->> 'mascara' || ':' || (public.numeros_teste_agora_voz({E}) -> 0 ->> 'pronto')",
       *ADM, valor="(11) 9••••-••41:false")
checar("a lista não traz hash nem segredo", True,
       f"select public.numeros_teste_agora_voz({E})::text !~ '[0-9a-f]{{64}}|voz/trunk'", *ADM, valor="t")
checar("operação sem editar_canais não lista", False, f"select public.numeros_teste_agora_voz({E})", *OPE, erro="sem permissão")
checar("Simulado: não liga, aponta o Testar conversa", False, PEDIR.format(c=C, n=N), *ADM, erro="Simulado")
sv(f"update public.voz_config set modo = 'teste' where empresa_id = {E}")
checar("operação sem editar_canais não pede", False, PEDIR.format(c=C, n=N), *OPE, erro="sem permissão")
checar("Admin de outra empresa não pede", False, PEDIR.format(c=C, n=N), *OUT, erro="sem permissão")
checar("anon não pede", False, PEDIR.format(c=C, n=N), "anon")
checar("número que não foi guardado no cofre", False, PEDIR.format(c=C, n=N), *ADM, erro="guardado no cofre")
sv(f"update public.voz_numeros_teste set guardado_em = now() where id = {N}")
checar("número guardado mas não confirmado", False, PEDIR.format(c=C, n=N), *ADM, erro="não foi confirmado")
sv(f"update public.voz_numeros_teste set confirmado_em = now() where id = {N}")
checar("confirmado, mas fora da lista de teste da empresa", False, PEDIR.format(c=C, n=N), *ADM, erro="não foi confirmado")
sv(f"update public.voz_config set numeros_teste_hash = array['{HASH}'] where empresa_id = {E}")
checar("número de outra empresa", False, PEDIR.format(c=C, n=N), *OUT, erro="sem permissão")
checar("sem fluxo em uso na carteira", False, PEDIR.format(c=C, n=N), *ADM, erro="fluxo em uso")
FL = sv(f"insert into public.voz_fluxos (empresa_id, credor_id, nome) values ({E}, {C}, 'Fluxo 116') returning id")
sv(f"insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, credor_id, versao, situacao, definicao, aprovado_em, "
   f"em_uso_em) select {FL}, {E}, {C}, 1, 'em_uso', m.definicao, now(), now() from public.voz_fluxo_modelos m "
   f"order by m.codigo limit 1")
checar("sem rota ativa", False, PEDIR.format(c=C, n=N), *ADM, erro="nenhuma rota ativa")
TR = sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, canais) "
        f"values ({E}, 'sp-116', 'Operadora Alfa', 'sip.operadora-alfa.example', 'ip', '11', '1135550116', 10) returning id")
PA = sv(f"insert into public.voz_troncos_pausas (empresa_id, tronco_id, motivo, causa_sip) values ({E}, {TR}, 'sem_credito', 402) "
        f"returning id")
checar("rota pausada (sem crédito) não testa", False, PEDIR.format(c=C, n=N), *ADM, erro="nenhuma rota ativa")
sv(f"update public.voz_troncos_pausas set retomado_em = now(), nota = 'retomada no teste 116' where id = {PA}")
J = "date_trunc('hour', now())"
sv(f"insert into public.voz_ritmo_amostras (empresa_id, credor_id, janela, dia, discadas, curtas) values "
   f"({E}, {C}, {J}, public.hoje_sp(), 8100, 6600)")
checar("empresa parada pelas chamadas curtas hoje", False, PEDIR.format(c=C, n=N), *ADM, erro="chamadas curtas")
sv(f"delete from public.voz_ritmo_amostras where empresa_id = {E}")

domingo = sv("select extract(isodow from now() at time zone 'America/Sao_Paulo') = 7") == "t"
if domingo:
    checar("domingo não liga", False, PEDIR.format(c=C, n=N), *ADM, erro="domingo")
else:
    ID = sv(PEDIR.format(c=C, n=N), *ADM)
    checar("pronto depois de guardado, confirmado e na lista", True,
           f"select public.numeros_teste_agora_voz({E}) -> 0 ->> 'pronto'", *ADM, valor="true")
    checar("Admin com editar_canais pede o teste", True, f"select situacao || ':' || mascara from public.voz_testes_agora "
           f"where id = {ID}", valor="pedido:(11) 9••••-••41")
    checar("um de cada vez", False, PEDIR.format(c=C, n=N), *TEC, erro="já há um teste em andamento")
    checar("o cliente vê o pedido (sem o hash)", True,
           f"select count(*) from public.voz_testes_agora where id = {ID}", *ADM, valor=1)
    checar("o cliente não lê o hash", False, f"select hash from public.voz_testes_agora where id = {ID}", *ADM)
    checar("outra empresa não vê", True, f"select count(*) from public.voz_testes_agora where id = {ID}", *OUT, valor=0)
    checar("o site não pega o pedido da VM", False, f"select public.pegar_teste_agora_voz(array[{E}::bigint])", *ADM)
    checar("o site não conclui", False, f"select public.concluir_teste_agora_voz({ID}, 'concluido')", *ADM)
    # VM pelo acesso próprio: recebe a referência do segredo e o hash, nunca o número
    P = sv(f"set session authorization motorcx_voz; select voz_vm.pegar_teste_agora('{{\"empresas\": [{E}]}}'::jsonb)")
    p = json.loads(P)
    checar("a VM pega com a referência do segredo e o hash", True,
           f"select {int(p['id'] == int(ID) and p['segredo_ref'] == f'voz/trunk/e{E}/teste-{HASH[:12]}' and p['hash'] == HASH)}",
           valor=1)
    checar("nada de número no pedido", True, f"select {int('11987650041' not in P)}", valor=1)
    checar("cancelar depois de a VM pegar: não", False, f"select public.cancelar_teste_agora_voz({ID})", *ADM,
           erro="já começou")
    checar("passo desconhecido é recusado (só marcas e contagens)", False,
           f"select public.concluir_teste_agora_voz({ID}, 'concluido', 'cpc', '{{\"fala\": \"oi\"}}'::jsonb)", "service_role",
           erro="passo desconhecido")
    checar("motivo com telefone é recusado", False,
           f"select public.concluir_teste_agora_voz({ID}, 'recusado', null, '{{}}'::jsonb, 'ligue 11987650041')",
           "service_role", erro="sem CPF")
    passos = json.dumps({"tocou": True, "atendeu": True, "agente": True, "gravada": True, "aviso_gravacao": True,
                         "identidade_confirmada": False, "segundos": 42, "toque_s": 7})
    checar("a VM conclui com os passos", True,
           f"set session authorization motorcx_voz; select voz_vm.concluir_teste_agora('{{\"teste\": {ID}, "
           f"\"situacao\": \"concluido\", \"desfecho\": \"atendida_sem_cpc\", \"passos\": {passos}}}'::jsonb); "
           f"reset session authorization; select situacao || ':' || desfecho || ':' || (passos ->> 'segundos') "
           f"from public.voz_testes_agora where id = {ID}", valor="concluido:atendida_sem_cpc:42")
    checar("concluído não conclui de novo", False, f"select public.concluir_teste_agora_voz({ID}, 'concluido')",
           "service_role", erro="não está ligando")
    checar("o pedido ficou na Auditoria", True,
           f"select count(*) > 0 from public.auditoria where tabela = 'voz_testes_agora' and registro = '{ID}'", valor="t")
    # cancelar antes da VM pegar; o cancelado não conta no limite
    ID2 = sv(PEDIR.format(c=C, n=N), *ADM)
    checar("cancelar antes de a VM pegar", True, f"select public.cancelar_teste_agora_voz({ID2}); "
           f"select situacao from public.voz_testes_agora where id = {ID2}", *ADM, valor="cancelado")
    # expira: pedido parado há mais de 10 min
    ID3 = sv(PEDIR.format(c=C, n=N), *ADM)
    sv(f"update public.voz_testes_agora set pedido_em = now() - interval '11 minutes' where id = {ID3}")
    checar("pedido parado há 10 min expira", True, "select public.expirar_testes_agora_voz()", "service_role", valor=1)
    # número removido depois do pedido: a VM recusa sem ligar
    ID4 = sv(PEDIR.format(c=C, n=N), *ADM)
    sv(f"update public.voz_numeros_teste set hash = '{'0' * 64}' where id = {N}")
    checar("número trocado depois do pedido: a VM recebe nada e o pedido é recusado", True,
           f"select coalesce(public.pegar_teste_agora_voz(array[{E}::bigint])::text, 'nada'); ", "service_role",
           valor="nada")
    checar("… com o motivo", True, f"select situacao from public.voz_testes_agora where id = {ID4}", valor="recusado")
    sv(f"update public.voz_numeros_teste set hash = '{HASH}' where id = {N}")
    # limite do dia: concluído, expirado e recusado contam; o cancelado não. Com 5 no dia, o 6º não passa
    for _ in range(2):
        ID5 = sv(PEDIR.format(c=C, n=N), *ADM)
        sv(f"update public.voz_testes_agora set situacao = 'concluido', concluido_em = now() where id = {ID5}")
    checar("5 testes por dia (o cancelado não conta)", False, PEDIR.format(c=C, n=N), *ADM, erro="limite de 5")

print(f"\nSQL 116: {ok_total} passaram, {falhas} falharam")
raise SystemExit(1 if falhas else 0)
