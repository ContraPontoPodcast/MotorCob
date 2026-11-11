"""SQL 114 · Telefonia, PR T5: tela Telefonia editável e o "Testar a rota" de verdade.

Cobre: a migração roda duas vezes; números de teste (até 5; o banco só tem hash, máscara e a referência do segredo;
preparar com o login da pessoa e duas etapas, registrar só o servidor; remover devolve o nome do segredo); pedir o
teste (número guardado da empresa, IPs liberados, senha guardada, um por vez, 10 por hora por tronco); nenhum número
passa pelo banco (a VM recebe a referência do segredo); a VM grava passos (sem número), o fim grava
teste_ok só se o tronco não mudou e confirma o número de teste pelo código; a bina respondida na tela; cancelar;
usar_tronco_voz (primeira vez: pedido à equipe; depois da primeira Real: o Admin ativa); retomar a rota pausada só
depois de um teste que passou depois da pausa.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_telefonia_editavel.py
Só dados fictícios (empresas e114-*, e-mails @exemplo.test, IPs de documentação, número de teste fictício).
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
SQL = RAIZ / "supabase" / "migrations" / "20270227000001_voz_telefonia_editavel.sql"
ROTULO = "SQL 114: "


def sql(cmd, papel=None, uid=None, aal=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; "
        if uid:
            claims = json.dumps({"sub": uid, "role": papel, **({"aal": aal} if aal else {})})
            pre += (f"select set_config('request.jwt.claim.sub', '{uid}', false); "
                    f"select set_config('request.jwt.claims', '{claims}', false); ")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None, aal=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid, aal)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + ROTULO + nome
          + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def caso(nome, cond):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + ROTULO + nome)


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar():
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL)], capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-600:])
    return r


r1, r2 = aplicar(), aplicar()
caso("a migração roda sem erro (duas vezes)", r1.returncode == 0 and r2.returncode == 0)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e114-a-{T}', 'E114 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e114-b-{T}', 'E114 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo) values ({EA}, 'agente_voz'), ({EB}, 'agente_voz')")


def pessoa(nome, papel, empresa=None, equipe=False):
    uid = sv(f"insert into auth.users (email) values ('{nome}-{T}@exemplo.test') returning id")
    if equipe:
        sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, "
           f"equipe_alcance='todas', nome='Técnico {T}' where id='{uid}'")
    else:
        sv(f"update public.perfis set papel='{papel}', empresa_id={empresa}, nome='{nome.title()} {T}' where id='{uid}'")
    return uid


ADM = pessoa("adm", "admin", EA)
OPER = pessoa("oper", "operacao", EA)
ADMB = pessoa("admb", "admin", EB)
TEC = pessoa("tec", None, equipe=True)
REF = f"tr114-{T}"
import hashlib
HASH = hashlib.sha256(b"11987650041").hexdigest()      # o que a Edge Function manda (dígitos sem o 55)
sql(f"select public.salvar_tronco_voz({EA}, '{json.dumps({'referencia': REF, 'operadora': 'Operadora Alfa', 'host': 'sip.e114.exemplo.com.br', 'canais': 10, 'autenticacao': 'ip', 'bina': '1130030000', 'declaro': True})}'::jsonb)",
    "authenticated", ADM, "aal2")
TID = sv(f"select id from public.voz_troncos where empresa_id={EA} and referencia='{REF}'")

# ---------------------------------------------------------------- números de teste
PREP = f"select nome_segredo from public.preparar_numero_teste_voz({EA}, '{HASH}', '(11) 9••••-••41')"
checar("Operação não cadastra número de teste", False, PREP, "authenticated", OPER, aal="aal2", erro="sem permissão")
checar("Admin sem as duas etapas não cadastra", False, PREP, "authenticated", ADM, aal="aal1", erro="verificação em duas etapas")
checar("Admin prepara: recebe o nome do segredo da empresa (o número vai só para o cofre)", True, PREP, "authenticated",
       ADM, f"motorcx-voz-trunk-e{EA}-teste-{HASH[:12]}", aal="aal2")
checar("preparar de novo o mesmo número devolve a mesma linha", True,
       f"select count(*) from public.preparar_numero_teste_voz({EA}, '{HASH}', '(11) 9••••-••41')", "authenticated", ADM,
       1, aal="aal2")
NID = sv(f"select id from public.voz_numeros_teste where empresa_id={EA} and hash='{HASH}'")
caso("o banco guarda só hash, máscara e a referência do segredo",
     sv(f"select segredo_ref from public.voz_numeros_teste where id={NID}") == f"voz/trunk/e{EA}/teste-{HASH[:12]}")
checar("o site não registra o número guardado (só o servidor)", False,
       f"select public.registrar_numero_teste_voz({NID}, '{ADM}', 1)", "authenticated", ADM, aal="aal2")
sv(f"set role service_role; select public.registrar_numero_teste_voz({NID}, '{ADM}', 1)")
for i in range(4):
    sql(f"select * from public.preparar_numero_teste_voz({EA}, '{i:064d}', '(11) 9••••-••0{i}')", "authenticated", ADM, "aal2")
checar("no máximo 5 por empresa", False, f"select * from public.preparar_numero_teste_voz({EA}, '{'f' * 64}', '(11) 9••••-••99')",
       "authenticated", ADM, aal="aal2", erro="no máximo 5")
checar("máscara com o número inteiro é recusada", False,
       f"select * from public.preparar_numero_teste_voz({EB}, '{'e' * 64}', '(11) 98765-0041')", "authenticated", ADMB,
       aal="aal2")
checar("Operação vê os números pela view, sem hash nem referência", True,
       f"select count(*) || '|' || count(guardado_em) from public.voz_numeros_teste_empresa where empresa_id={EA}",
       "authenticated", OPER, "5|1")
checar("a view não tem hash nem referência do segredo", True,
       "select count(*) from information_schema.columns where table_name='voz_numeros_teste_empresa' "
       "and column_name in ('hash', 'segredo_ref')", None, None, 0)
checar("ninguém do site lê a tabela", False, "select * from public.voz_numeros_teste", "authenticated", ADM)
NID0 = sv(f"select id from public.voz_numeros_teste where empresa_id={EA} and hash='{'0' * 64}'")
checar("Admin remove um número e recebe o nome do segredo para destruir", True,
       f"select public.remover_numero_teste_voz({NID0})", "authenticated", ADM,
       f"motorcx-voz-trunk-e{EA}-teste-{'0' * 12}", aal="aal2")
caso("o número removido sai da tabela", sv(f"select count(*) from public.voz_numeros_teste where empresa_id={EA}") == "4")
checar("Admin de outra empresa não remove", False, f"select public.remover_numero_teste_voz({NID})", "authenticated",
       ADMB, aal="aal2", erro="não encontrado")
NAO_GUARDADO = sv(f"select id from public.voz_numeros_teste where empresa_id={EA} and hash='{'1'.zfill(64)}'")

# ---------------------------------------------------------------- pedir o teste
PEDIR = f"select public.pedir_teste_tronco_voz({TID}, {NID})"
checar("sem IPs da operadora: não testa", False, PEDIR, "authenticated", ADM, aal="aal2", erro="IPs da operadora")
sql(f"select public.definir_ips_voz('tronco', {TID}, array['200.190.1.10'])", "authenticated", ADM, "aal2")
checar("IPs ainda não liberados pela equipe: não testa", False, PEDIR, "authenticated", ADM, aal="aal2",
       erro="liberando os IPs")
sql(f"select public.liberar_ips_voz('tronco', {TID})", "authenticated", TEC, "aal2")
checar("número de outra empresa: recusado", False, f"select public.pedir_teste_tronco_voz({TID}, 999999999)",
       "authenticated", ADM, aal="aal2", erro="Números de teste")
checar("número ainda não guardado no cofre: recusado", False, f"select public.pedir_teste_tronco_voz({TID}, {NAO_GUARDADO})",
       "authenticated", ADM, aal="aal2", erro="ainda não foi guardado")
checar("Operação não pede teste", False, PEDIR, "authenticated", OPER, aal="aal2", erro="não encontrado")
checar("Admin pede o teste", True, PEDIR + " is not null", "authenticated", ADM, "t", aal="aal2")
X = sv(f"select max(id) from public.voz_testes_tronco where tronco_id={TID}")
checar("um teste por vez por tronco", False, PEDIR, "authenticated", ADM, aal="aal2", erro="em andamento")
checar("a view mostra o código (só enquanto roda) e nunca o número", True,
       f"select (codigo ~ '^[0-9]{{4}}$') || '|' || numero_mascara || '|' || situacao from public.voz_testes_tronco_empresa "
       f"where id={X}", "authenticated", OPER, "true|(11) 9••••-••41|pedido")
checar("nenhuma tabela ou view de teste tem coluna de número em claro", True,
       "select count(*) from information_schema.columns where table_name in ('voz_testes_tronco', 'voz_testes_tronco_empresa', "
       "'voz_numeros_teste', 'voz_numeros_teste_empresa') and column_name in ('numero', 'telefone')", None, None, 0)
checar("Admin de outra empresa não vê o teste", True,
       f"select count(*) from public.voz_testes_tronco_empresa where id={X}", "authenticated", ADMB, 0)
checar("o site não pega o pedido (só o servidor de voz)", False, "select public.pegar_teste_tronco_voz('vm-1')",
       "authenticated", ADM, aal="aal2")
P = sv("set role service_role; select public.pegar_teste_tronco_voz('motorcx-ast-1')::text")
pj = json.loads(P)
caso("o servidor de voz recebe a referência do segredo (não o número), o código e a última mudança do tronco",
     pj["numero_ref"] == f"voz/trunk/e{EA}/teste-{HASH[:12]}" and "numero" not in pj and pj["tronco_id"] == int(TID)
     and len(pj["codigo"]) == 4 and pj.get("atualizado_em"))
checar("o pedido fica rodando com a VM que pegou", True,
       f"select situacao || '|' || vm from public.voz_testes_tronco where id={X}", None, None, "rodando|motorcx-ast-1")
checar("passo com telefone na mensagem é recusado", False,
       f"set role service_role; select public.registrar_teste_tronco_voz({X}, "
       f"'[{{\"passo\": 0, \"resultado\": \"ok\", \"mensagem\": \"ligou para (11) 98765-0041\"}}]')",
       None, None, erro="passo inválido")
PASSOS = json.dumps([{"passo": i, "resultado": "ok", "mensagem": "ok"} for i in range(10)])
sv(f"set role service_role; select public.registrar_teste_tronco_voz({X}, '{json.dumps(PASSOS[:0] or [{'passo': 0, 'resultado': 'ok', 'mensagem': 'ok'}])}')")
checar("a pessoa responde a bina na tela", True,
       f"select public.responder_bina_teste_voz({X}, 'certa'); select bina_resposta from public.voz_testes_tronco_empresa where id={X}",
       "authenticated", ADM, "certa", aal="aal2")
checar("o servidor de voz lê a resposta", True,
       f"set role service_role; select public.ler_teste_tronco_voz({X}) ->> 'bina_resposta'", None, None, "certa")
checar("o fim grava teste_ok no tronco e confirma o número de teste pelo código (passo 5)", True,
       f"set role service_role; select public.registrar_teste_tronco_voz({X}, '{PASSOS}', 'passou', 'A rota passou no teste.'); "
       f"reset role; select (select teste_ok from public.voz_troncos where id={TID}) || '|' || "
       f"(select confirmado_em is not null from public.voz_numeros_teste where id={NID}) || '|' || "
       f"(select '{HASH}' = any (numeros_teste_hash) from public.voz_config where empresa_id={EA})", None, None,
       "true|true|true")
checar("a equipe recebe aviso: tronco inativo passou no teste", True,
       f"select count(*) > 0 from public.avisos where empresa_id={EA} and para='equipe' and titulo like '%{REF} passou no teste'",
       None, None, "t")
checar("depois do fim o código some da view", True,
       f"select codigo is null from public.voz_testes_tronco_empresa where id={X}", "authenticated", OPER, "t")

# teste que muda no meio não vale
sql(PEDIR, "authenticated", ADM, "aal2")
X2 = sv(f"select max(id) from public.voz_testes_tronco where tronco_id={TID}")
sv("set role service_role; select public.pegar_teste_tronco_voz('motorcx-ast-1')")
sv(f"update public.voz_troncos set realm = 'outro.e114.exemplo.com.br' where id={TID}")
checar("tronco mudou durante o teste: o resultado não vale para o tronco", True,
       f"set role service_role; select public.registrar_teste_tronco_voz({X2}, '[]', 'falhou', 'x'); reset role; "
       f"select teste_ok from public.voz_troncos where id={TID}", None, None, "t")
sv(f"update public.voz_troncos set realm = null where id={TID}")

# cancelar
sql(PEDIR, "authenticated", ADM, "aal2")
X3 = sv(f"select max(id) from public.voz_testes_tronco where tronco_id={TID}")
sql(f"select public.cancelar_teste_tronco_voz({X3})", "authenticated", ADM, "aal2")
caso("Admin cancela", sv(f"select situacao from public.voz_testes_tronco where id={X3}") == "cancelado")
checar("a VM recebe 'cancelado' ao gravar o passo", True,
       f"set role service_role; select public.registrar_teste_tronco_voz({X3}, '[]')", None, None, "cancelado")
sv(f"update public.voz_testes_tronco set pedido_em = now() - interval '11 minutes' where tronco_id={TID} and id={X3}")
sql(PEDIR, "authenticated", ADM, "aal2")
X4 = sv(f"select max(id) from public.voz_testes_tronco where tronco_id={TID}")
sv(f"update public.voz_testes_tronco set pedido_em = now() - interval '11 minutes' where id={X4}")
checar("pedido parado há mais de 10 minutos expira (e libera o tronco)", True, PEDIR + " is not null", "authenticated",
       ADM, "t", aal="aal2")
caso("o pedido parado ficou expirado", sv(f"select situacao from public.voz_testes_tronco where id={X4}") == "expirado")
sv(f"update public.voz_testes_tronco set situacao='cancelado' where tronco_id={TID} and situacao='pedido'")
sv(f"insert into public.voz_testes_tronco (empresa_id, tronco_id, codigo, assinatura, situacao) "
   f"select {EA}, {TID}, '0000', 'x', 'falhou' from generate_series(1, 10)")
checar("10 testes na última hora: limite", False, PEDIR, "authenticated", ADM, aal="aal2", erro="10 testes por hora")
sv(f"delete from public.voz_testes_tronco where tronco_id={TID} and assinatura='x'")

# ---------------------------------------------------------------- usar em Real (C11)
USAR = f"select public.usar_tronco_voz({TID}, true)"
checar("primeira vez da empresa: vira pedido à equipe e o tronco segue inativo", True,
       USAR + f"; select ativo from public.voz_troncos where id={TID}", "authenticated", ADM, "f", aal="aal2")
checar("o pedido aparece para a equipe", True,
       f"select count(*) from public.avisos where empresa_id={EA} and para='equipe' and chave like 'usar_tronco_voz:{TID}:%'",
       None, None, 1)
sv(f"insert into public.voz_config (empresa_id) values ({EA}) on conflict do nothing; "
   f"update public.voz_config set provedor='montagem_motorcx', modo='real' where empresa_id={EA}")
checar("empresa que já teve Real: o Admin ativa sozinho", True, USAR, "authenticated", ADM, "ativo", aal="aal2")
checar("o Admin desativa", True, f"select public.usar_tronco_voz({TID}, false)", "authenticated", ADM, "inativo", aal="aal2")
sv(f"update public.voz_troncos set teste_ok = null where id={TID}")
checar("sem teste que passou: não ativa", False, USAR, "authenticated", ADM, aal="aal2", erro="passar no teste")
sv(f"update public.voz_troncos set teste_ok = true, testado_em = now() where id={TID}")

# ---------------------------------------------------------------- retomar depois do teste (G18)
PA = sv(f"insert into public.voz_troncos_pausas (empresa_id, tronco_id, motivo, causa_sip) values ({EA}, {TID}, "
        f"'bloqueio_originacao', 603) returning id")
checar("a pausa aparece para o cliente", True, f"select motivo || '|' || causa_sip from public.voz_pausas_empresa where id={PA}",
       "authenticated", OPER, "bloqueio_originacao|603")
checar("rota pausada não ativa", False, USAR, "authenticated", ADM, aal="aal2", erro="pausada")
sv(f"update public.voz_troncos set testado_em = now() - interval '1 hour' where id={TID}")
checar("retomar sem teste depois da pausa: recusado", False, f"select public.retomar_rota_voz({PA})", "authenticated", ADM,
       aal="aal2", erro="depois da pausa")
sv(f"update public.voz_troncos set testado_em = now() + interval '1 second' where id={TID}")
checar("Operação não retoma", False, f"select public.retomar_rota_voz({PA})", "authenticated", OPER, aal="aal2",
       erro="não encontrada")
checar("teste que passou depois da pausa: o Admin retoma (nota automática)", True,
       f"select public.retomar_rota_voz({PA}) is not null; select nota like 'Retomada pela empresa depois do teste%' "
       f"from public.voz_troncos_pausas where id={PA}", "authenticated", ADM, "t", aal="aal2")

sv(f"delete from public.voz_testes_tronco where empresa_id in ({EA}, {EB}); "
   f"delete from public.voz_troncos_pausas where empresa_id in ({EA}, {EB}); "
   f"delete from public.voz_numeros_teste where empresa_id in ({EA}, {EB}); "
   f"delete from public.voz_rotas where empresa_id in ({EA}, {EB}); "
   f"delete from public.voz_troncos where empresa_id in ({EA}, {EB})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
