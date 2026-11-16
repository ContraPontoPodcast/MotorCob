"""SQL 134 · Agente de voz: a trava do modo Real confere o que a VM usa (fluxo em uso, não o roteiro antigo) e o que
ela precisa para discar no real (teto contratado, robôs ou limite por minuto, limite na divisão e transferência).

Cobre: a migração roda duas vezes e mantém a assinatura; só fluxo passa; só roteiro não passa; teto 0, licença 0,
limite 0 na divisão e sem transferência aparecem como falta (e só no real: o modo teste não pede); o por minuto conta
como robôs; transferência testada não é exigida; de ponta a ponta, ligar_voz_real recusa sem fluxo e liga com ele, e o
pedido do cliente diz o que falta.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_trava_real.py
Só dados fictícios (empresas e134-*, e-mails @exemplo.test). Cada cenário roda numa transação desfeita.
"""
import os
import subprocess
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL134 = RAIZ / "supabase" / "migrations" / "20270331000001_voz_trava_real.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 134: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL134)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


ASSINATURA = "falta_para_voz(empresa bigint, modo text) -> text"
aplicar(1)
aplicar(2)
checar("falta_para_voz mantém a assinatura e o retorno", True,
       "select 'falta_para_voz(' || pg_get_function_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) "
       "from pg_proc p where p.oid = 'public.falta_para_voz(bigint, text)'::regprocedure", valor=ASSINATURA)
checar("o cliente continua sem executar falta_para_voz direto", True,
       "select has_function_privilege('authenticated', 'public.falta_para_voz(bigint, text)', 'execute')", valor="f")

T = uuid.uuid4().hex[:6]
E = sv(f"insert into public.empresas (slug, nome) values ('e134-{T}', 'E134 {T}') returning id")
C = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({E}, 'c134{T}', 'Carteira Teste') returning id")
H64 = "a" * 64


def pronto(sem=()):
    """Comandos que deixam a empresa E pronta para o real; `sem` tira itens: fluxo, roteiro, teto, licenca,
    por_minuto, transferencia, tronco."""
    s = ["set session_replication_role = replica;",
         "update public.voz_troncos set ativo = false where ativo;", "delete from public.voz_licencas;",
         "delete from public.voz_cobranca_ia;",
         f"update public.voz_contrato set concorrencia_contratada = {0 if 'teto' in sem else 10};",
         f"insert into public.voz_config (empresa_id, provedor, modo, gravar, numeros_teste_hash) values ({E}, "
         f"'montagem_motorcx', 'teste', false, array['{H64}']) on conflict (empresa_id) do update set "
         f"provedor = excluded.provedor, modo = excluded.modo, gravar = false, numeros_teste_hash = excluded.numeros_teste_hash;"]
    if "tronco" not in sem:
        s.append(f"insert into public.voz_troncos (id, empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, "
                 f"canais, ativo, teste_ok, testado_em) overriding system value values (-134, {E}, 'sp-134', 'Operadora Alfa', "
                 f"'sip.operadora-alfa.example', 'ip', '11', '1135550134', 10, true, true, now());")
        s.append(f"insert into public.voz_rotas (empresa_id, tronco_id, prioridade, tech_prefix, tipo, cadencia_inicial_s, "
                 f"cadencia_incremento_s, preco_minuto, vigente_desde) values ({E}, -134, 1, '1021', 'fixo_local', 30, 6, "
                 f"0.05, public.hoje_sp() - 30);")
    s.append(f"insert into public.voz_chamadas (empresa_id, id_chamada, id_cliente, modo) values ({E}, 'c134-{T}', 'C134', 'teste');")
    s.append(f"insert into public.empresa_contatos (empresa_id, nome, recebe_faturas) values ({E}, 'Financeiro Exemplo', true);")
    if "fluxo" not in sem:
        s.append(f"insert into public.voz_fluxos (id, empresa_id, credor_id, nome) overriding system value values "
                 f"(-134, {E}, {C}, 'Fluxo 134');")
        s.append(f"insert into public.voz_fluxo_versoes (fluxo_id, empresa_id, credor_id, versao, situacao, definicao, "
                 f"aprovado_em, em_uso_em) select -134, {E}, {C}, 1, 'em_uso', m.definicao, now(), now() "
                 f"from public.voz_fluxo_modelos m order by m.codigo limit 1;")
    if "roteiro" in sem:   # aqui `sem` liga o roteiro antigo em uso
        s.append(f"insert into public.voz_roteiros (empresa_id, credor_id, versao, prompt, primeira_fala, regras_transferencia, "
                 f"situacao, aprovado_em, em_uso_em) values ({E}, {C}, 1, 'Você é o agente virtual da empresa. Confirme a identidade "
                 f"antes de falar da dívida.', 'Olá, tudo bem?', "
                 f"'{{\"cpc\": false, \"pedido_humano\": true, \"ofertas_sem_acordo\": 2, \"fora_alcada\": true, "
                 f"\"contestacao\": true}}', 'em_uso', now(), now());")
    if "licenca" not in sem and "por_minuto" not in sem:
        s.append(f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, vigente_desde, motivo) "
                 f"values ({E}, {0 if 'licenca0' in sem else 5}, 'por_robo', 6000, public.hoje_sp(), 'Contrato de teste.');")
    if "por_minuto" in sem:   # aqui `sem` troca a licença pelo contrato por minuto
        s.append(f"insert into public.voz_cobranca_ia (empresa_id, modelo, limite_conversas, vigente_desde, motivo) "
                 f"values ({E}, 'por_minuto', 4, now() - interval '1 day', 'Contrato de teste.');")
    if "transferencia" not in sem:
        s.append(f"insert into public.voz_transferencias (empresa_id, nome, destino_sip, metodo, ativo) values "
                 f"({E}, 'Central Exemplo', 'sip:operadores@pabx.exemplo.test:5060', 'refer', true);")
    s.append("set session_replication_role = origin;")
    return " ".join(s)


def falta(sem=(), modo="real"):
    return ("begin; " + pronto(sem) + f" set local role service_role; "
            f"select coalesce(public.falta_para_voz({E}, '{modo}'), 'pronto'); rollback;")


checar("só fluxo (sem roteiro): pronto para o real", True, falta(), valor="pronto")
checar("só fluxo: pronto também para o teste", True, falta(modo="teste"), valor="pronto")
checar("só roteiro em uso (sem fluxo): não passa no real", True, falta(("fluxo", "roteiro")), valor="fluxo do agente em uso")
checar("só roteiro em uso (sem fluxo): não passa nem no teste", True, falta(("fluxo", "roteiro"), "teste"),
       valor="fluxo do agente em uso")
checar("teto contratado 0: falta o teto e, por consequência, o limite na divisão", True, falta(("teto",)),
       valor="teto contratado maior que zero, limite da empresa na divisão maior que zero")
checar("sem licença nem por minuto: falta robôs contratados", True, falta(("licenca",)),
       valor="robôs contratados pela empresa")
checar("licença com 0 robôs: falta robôs (a divisão trata como legado e dá a sobra pelos canais)", True,
       falta(("licenca0",)), valor="robôs contratados pela empresa")
checar("contrato por minuto com limite de conversas conta como robôs", True, falta(("por_minuto",)), valor="pronto")
checar("sem tronco ativo: limite 0 na divisão também aparece", True, falta(("tronco",)),
       valor="tronco ativo e testado, rota cadastrada, limite da empresa na divisão maior que zero")
checar("sem transferência para humano: falta", True, falta(("transferencia",)),
       valor="transferência para humano configurada")
checar("o modo teste não pede teto, robôs, divisão nem transferência", True,
       falta(("teto", "licenca", "transferencia"), "teste"), valor="pronto")
checar("transferência nunca testada (teste_ok nulo) não é exigida", True,
       "begin; " + pronto() + f" update public.voz_transferencias set teste_ok = null, testado_em = null where empresa_id = {E}; "
       f"set local role service_role; select coalesce(public.falta_para_voz({E}, 'real'), 'pronto'); rollback;", valor="pronto")

# de ponta a ponta: a equipe liga o real; o cliente pede
_, U_SUP, _ = sql(f"insert into auth.users (email) values ('sup134-{T}@exemplo.test') returning id")
_, U_ADM, _ = sql(f"insert into auth.users (email) values ('adm134-{T}@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=false, empresa_id=null, equipe_alcance='todas' "
   f"where id='{U_SUP}'")
sv(f"update public.perfis set papel='admin', empresa_id={E} where id='{U_ADM}'")


def ponta(sem, chamada):
    return "begin; " + pronto(sem) + " " + chamada + " rollback;"


LIGAR = (f"set local role authenticated; select set_config('request.jwt.claim.sub', '{U_SUP}', true); "
         f"select public.ligar_voz_real({E}, 'real');")
PEDIR = (f"set local role authenticated; select set_config('request.jwt.claim.sub', '{U_ADM}', true); "
         f"select public.pedir_voz_real({E}) is not null;")
checar("equipe: só com roteiro, ligar_voz_real recusa e diz o que falta", False, ponta(("fluxo", "roteiro"), LIGAR),
       erro="falta: fluxo do agente em uso")
checar("equipe: com fluxo, ligar_voz_real liga o real", True, ponta((), LIGAR), valor="real")
checar("equipe: teto 0 recusa o real", False, ponta(("teto",), LIGAR), erro="teto contratado maior que zero")
checar("cliente: sem transferência, o pedido diz o que falta", False, ponta(("transferencia",), PEDIR),
       erro="antes de pedir: transferência para humano configurada")
checar("cliente: pronto, o pedido abre o chamado com o texto novo", True,
       ponta((), PEDIR + " select m.texto like '%fluxo em uso%' from public.chamado_mensagens m "
             f"join public.chamados c on c.id = m.chamado_id where c.empresa_id = {E} order by m.id desc limit 1;"),
       valor="t")

print(f"\n{ok_total} passaram, {falhas} falharam")
raise SystemExit(1 if falhas else 0)
