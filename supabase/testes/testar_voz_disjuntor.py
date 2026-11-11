"""SQL 115 · Telefonia, PR T6: disjuntor por tronco, "suspeita de sem crédito" e saúde do tronco.

Cobre: a migração roda duas vezes; o que é falha técnica; 20 falhas técnicas seguidas pausam SÓ aquele tronco (o outro
da empresa segue), com aviso obrigatório aos Admins (Envios pausados) e à equipe; 19 não pausam; 50% de 50 pausam;
mais de 90% das últimas 30 com o mesmo código para destinos diferentes = suspeita de sem crédito; atendidas e o modo
simulado não contam; depois da retomada as falhas antigas não contam; o teste que passa retoma sozinho o disjuntor (e
não a pausa por bloqueio); a VM vê a pausa nova; saude_troncos_voz só para a própria empresa.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_disjuntor.py
Só dados fictícios (empresas e115-*, e-mails @exemplo.test, hashes sintéticos).
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
SQL = RAIZ / "supabase" / "migrations" / "20270228000001_voz_disjuntor.sql"
ROTULO = "SQL 115: "


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


def caso(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + ROTULO + nome + ("" if cond else f"  -> {detalhe}"))


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
checar("a pausa aceita os motivos novos", True,
       "select pg_get_constraintdef(oid) like '%disjuntor%' and pg_get_constraintdef(oid) like '%suspeita_sem_credito%' "
       "from pg_constraint where conname = 'voz_troncos_pausas_motivo_check'", None, None, "t")
checar("falha técnica: 503, 408, 403 e Q.850 34 sim; 486, 404, 402 e atendida não", True,
       "select concat_ws(',', falha_tecnica_voz(503, 34), falha_tecnica_voz(408, null), falha_tecnica_voz(403, 21), "
       "falha_tecnica_voz(null, 34), falha_tecnica_voz(486, 17), falha_tecnica_voz(404, 1), falha_tecnica_voz(402, 21), "
       "falha_tecnica_voz(null, 16))", None, None, "t,t,t,t,f,f,f,f")

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e115-a-{T}', 'E115 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e115-b-{T}', 'E115 B {T}') returning id")
sv(f"insert into public.empresa_modulos (empresa_id, modulo) values ({EA}, 'agente_voz'), ({EB}, 'agente_voz')")
sv(f"insert into public.voz_config (empresa_id) values ({EA}), ({EB}) on conflict do nothing")
CX = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'c115-{T}', 'Carteira 115') returning id")


def pessoa(nome, papel, empresa):
    uid = sv(f"insert into auth.users (email) values ('{nome}-{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={empresa}, nome='{nome.title()} {T}' where id='{uid}'")
    return uid


ADM = pessoa("adm", "admin", EA)
OPER = pessoa("oper", "operacao", EA)
ADMB = pessoa("admb", "admin", EB)


def tronco(ref, bina):
    return sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, bina, canais) "
              f"values ({EA}, '{ref}-{T}', 'Operadora {ref}', 'sip.{ref}.e115.exemplo.com.br', 'ip', '11', '{bina}', 10) returning id")


TA, TB, TC, TD = tronco("a", "1130030001"), tronco("b", "1130030002"), tronco("c", "1130030003"), tronco("d", "1130030004")
n = [0]


def tentativas(tid, qtd, sip=None, q850=None, atendida=False, modo="real", destinos=True):
    vals = []
    for i in range(qtd):
        n[0] += 1
        h = f"{n[0]:064x}" if destinos else "a" * 64
        vals.append(f"({EA}, {CX}, 'ch115-{T}-{n[0]}', 'C{n[0]}', '{modo}', now() - interval '3 hours' + interval '{n[0]} seconds', "
                    f"{'now()' if atendida else 'null'}, now(), {30 if atendida else 0}, {sip or 'null'}, {q850 or 'null'}, {tid}, '{h}')")
    sv("insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, modo, ocorrido_em, atendida_em, "
       "encerrada_em, billsec, causa_sip, causa_q850, tronco_id, destino_hash) values " + ", ".join(vals))


PAUSA = "select coalesce((select motivo from public.voz_troncos_pausas where tronco_id={t} and retomado_em is null), '-')"

tentativas(TA, 10, atendida=True)
tentativas(TA, 19, sip=503, q850=34)
checar("19 falhas técnicas seguidas não pausam", True, PAUSA.format(t=TA), None, None, "-")
tentativas(TA, 1, sip=503, q850=34)
checar("a 20ª falha técnica seguida pausa o tronco (disjuntor)", True, PAUSA.format(t=TA), None, None, "disjuntor")
checar("o outro tronco da empresa continua sem pausa", True, PAUSA.format(t=TB), None, None, "-")
checar("os Admins recebem o aviso obrigatório (Envios pausados), sem número", True,
       f"select count(*) || '|' || bool_and(texto not like '%@%' and titulo like '%a-{T} saiu sozinho%') from public.avisos "
       f"where empresa_id={EA} and para='usuario' and assunto='pausa' and usuario_id='{ADM}'", None, None, "1|true")
checar("o aviso de pausa é obrigatório (vira e-mail)", True,
       "select email_obrigatorio from public.notificacao_assuntos where codigo='pausa'", None, None, "t")
checar("a equipe recebe no sino", True,
       f"select count(*) from public.avisos where empresa_id={EA} and para='equipe' and titulo like 'Disjuntor: tronco a-{T}%'",
       None, None, 1)
checar("o servidor de voz vê a pausa nova (troncos_pausados_voz)", True,
       f"set role service_role; select count(*) from jsonb_array_elements(public.troncos_pausados_voz(array[{EA}]::bigint[])) e "
       f"where (e ->> 'tronco_id')::bigint = {TA} and e ->> 'motivo' = 'disjuntor'", None, None, 1)
checar("o cliente vê o motivo da pausa", True, f"select motivo from public.voz_pausas_empresa where tronco_id={TA}",
       "authenticated", OPER, "disjuntor")
tentativas(TA, 5, sip=503)
checar("mais falhas com o tronco já pausado não abrem outra pausa", True,
       f"select count(*) from public.voz_troncos_pausas where tronco_id={TA}", None, None, 1)

# suspeita de sem crédito: o mesmo código (480 não é falha técnica) para destinos diferentes
tentativas(TB, 29, sip=480, q850=18)
checar("29 com o mesmo código ainda não bastam", True, PAUSA.format(t=TB), None, None, "-")
tentativas(TB, 1, sip=480, q850=18)
checar("30 com o mesmo código para destinos diferentes = suspeita de sem crédito", True,
       f"select motivo || '|' || causa_sip from public.voz_troncos_pausas where tronco_id={TB} and retomado_em is null",
       None, None, "suspeita_sem_credito|480")

# 50% de 50, sem 20 seguidas
for _ in range(25):
    tentativas(TC, 1, sip=503)
    tentativas(TC, 1, sip=486, q850=17)
checar("metade das últimas 50 com falha técnica (sem 20 seguidas) pausa", True, PAUSA.format(t=TC), None, None, "disjuntor")

# simulado e atendida não contam; o mesmo destino não é suspeita
tentativas(TD, 25, sip=503, modo="simulado")
checar("o modo simulado não conta", True, PAUSA.format(t=TD), None, None, "-")
tentativas(TD, 30, sip=404, q850=1, destinos=False)
checar("o mesmo código para o MESMO destino não é suspeita (e 404 não é falha técnica)", True, PAUSA.format(t=TD), None, None, "-")

# depois da retomada, as falhas antigas não contam
PA = sv(f"select id from public.voz_troncos_pausas where tronco_id={TA} and retomado_em is null")
sv(f"update public.voz_troncos_pausas set retomado_em = now(), nota = 'Resolvido com a operadora' where id={PA}")
tentativas(TA, 1, sip=503)
checar("depois da retomada, uma falha nova não pausa (as antigas não contam)", True, PAUSA.format(t=TA), None, None, "-")

# volta com teste: disjuntor sai sozinho; bloqueio não
PC = sv(f"select id from public.voz_troncos_pausas where tronco_id={TC} and retomado_em is null")
sv(f"update public.voz_troncos set ips_operadora = '{{200.190.9.9/32}}', ips_liberados = '{{200.190.9.9/32}}' where id in ({TC}, {TD})")


def teste_passou(tid):
    x = sv(f"insert into public.voz_testes_tronco (empresa_id, tronco_id, codigo, assinatura, situacao, pedido_por) "
           f"select {EA}, t.id, '1234', public.assinatura_tronco_voz(t), 'rodando', '{ADM}' from public.voz_troncos t "
           f"where t.id = {tid} returning id")
    sv(f"set role service_role; select public.registrar_teste_tronco_voz({x}, '[]', 'passou', 'A rota passou no teste.')")


teste_passou(TC)
checar("o teste que passou retoma sozinho o disjuntor (nota automática)", True,
       f"select (retomado_em is not null) || '|' || (nota like 'Retomada sozinha: o teste da rota passou%') "
       f"from public.voz_troncos_pausas where id={PC}", None, None, "true|true")
PD = sv(f"insert into public.voz_troncos_pausas (empresa_id, tronco_id, motivo, causa_sip) values ({EA}, {TD}, "
        f"'bloqueio_originacao', 603) returning id")
teste_passou(TD)
checar("bloqueio de originação NÃO sai sozinho (pede o Retomar)", True,
       f"select retomado_em is null from public.voz_troncos_pausas where id={PD}", None, None, "t")

# saúde do tronco (G34)
checar("saúde do tronco: tentativas, atendidas e códigos mais comuns", True,
       f"select tentativas || '|' || atendidas || '|' || (codigos -> 0 ->> 'codigo') from public.saude_troncos_voz({EA}, 24) "
       f"where tronco_id={TA}", "authenticated", OPER, "36|10|503")
checar("outra empresa não vê a saúde dos troncos", True,
       f"select count(*) from public.saude_troncos_voz({EA}, 24)", "authenticated", ADMB, 0)
checar("anon não chama", False, f"select * from public.saude_troncos_voz({EA}, 24)", "anon")
checar("o site não abre o disjuntor na mão", False, f"select public.avaliar_disjuntor_tronco_voz({TA})", "authenticated", ADM,
       aal="aal2")

sv(f"delete from public.voz_testes_tronco where empresa_id={EA}; delete from public.voz_chamadas where empresa_id={EA}; "
   f"delete from public.voz_troncos_pausas where empresa_id={EA}; delete from public.voz_troncos where empresa_id={EA}")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
