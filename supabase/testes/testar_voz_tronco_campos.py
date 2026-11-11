"""SQL 113 · Telefonia, PR T4: os campos que a operadora pede (seção E do parecer).

Cobre: a migração roda duas vezes; salvar_tronco_voz grava todos os campos novos (declaração, autenticação da operadora,
DTMF, realm, "De", cabeçalho da bina, prefixo, toque, duração, OPTIONS, liga para, retorno), recusa campo desconhecido e
valor fora da lista; o cliente só cadastra com as duas declarações (e de novo a cada troca de bina), a equipe não
precisa; mudar realm/De/cabeçalho/DTMF zera o teste e desativa o tronco do cliente; formato +55 (E.164); a bina não vai
para tronco de outra operadora; rota sem prefixo (código interno reaproveitado na vigência nova do mesmo tronco e tipo)
e rota em tronco inativo; as views novas só mostram a própria empresa e a VM lê os campos.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_tronco_campos.py
Só dados fictícios (empresas e113-*, e-mails @exemplo.test, hosts .exemplo.com.br).
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
SQL = RAIZ / "supabase" / "migrations" / "20270226000001_voz_tronco_campos.sql"
ROTULO = "SQL 113: "


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
EA = sv(f"insert into public.empresas (slug, nome) values ('e113-a-{T}', 'E113 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e113-b-{T}', 'E113 B {T}') returning id")
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
REF = f"tr113-{T}"


def salvar(campos, emp=None):
    base = {"referencia": REF, "operadora": "Operadora Alfa", "host": "sip.e113.exemplo.com.br", "canais": 10,
            "autenticacao": "ip", "bina": "1130030000"}
    base.update(campos)
    return f"select public.salvar_tronco_voz({emp or EA}, '{json.dumps(base)}'::jsonb)"


COMPLETO = {"declaro": True, "autenticacao_operadora": "sim", "dtmf": "inband", "realm": "sip.alfa.exemplo.com.br",
            "from_usuario": "1130030000", "cabecalho_bina": "rpid", "tech_prefix": "1021", "toque_max_s": 25,
            "duracao_max_min": 15, "verificar_options": False, "liga_para": "movel",
            "retorno_bina": "URA da assessoria", "formato_discagem": "tech_e164", "cps": 20}

checar("cliente sem as declarações não cadastra", False, salvar({}), "authenticated", ADM, aal="aal2",
       erro="marque as duas declarações")
checar("cliente direto no cadastrar_tronco_voz sem declarar não cadastra", False,
       f"select public.cadastrar_tronco_voz({EA}, '{REF}', 'Operadora Alfa', 'sip.e113.exemplo.com.br', 10, 'ip', '11', "
       f"'1130030000')", "authenticated", ADM, aal="aal2", erro="marque as duas declarações")
checar("campo desconhecido é recusado", False, salvar({"declaro": True, "senha": "x"}), "authenticated", ADM,
       aal="aal2", erro="campo desconhecido")
checar("DTMF fora da lista é recusado", False, salvar({"declaro": True, "dtmf": "pulso"}), "authenticated", ADM,
       aal="aal2", erro="dtmf")
checar("toque acima de 45 s é recusado", False, salvar({"declaro": True, "toque_max_s": 90}), "authenticated", ADM,
       aal="aal2", erro="toque_max_s")
checar("Admin sem aal2 não salva", False, salvar(COMPLETO), "authenticated", ADM, aal="aal1",
       erro="verificação em duas etapas")
checar("Admin com aal2 cadastra com todos os campos da seção E", True, salvar(COMPLETO) + " is not null",
       "authenticated", ADM, "t", aal="aal2")
TID = sv(f"select id from public.voz_troncos where empresa_id={EA} and referencia='{REF}'")
checar("os campos ficaram gravados (e o tronco nasce inativo, com a declaração de quem cadastrou)", True,
       f"select concat_ws('|', ativo, declaracao_por = '{ADM}', autenticacao_operadora, dtmf, realm, from_usuario, "
       f"cabecalho_bina, tech_prefix, toque_max_s, duracao_max_min, verificar_options, liga_para, retorno_bina, "
       f"formato_discagem, cps) from public.voz_troncos where id={TID}", None, None,
       "f|t|sim|inband|sip.alfa.exemplo.com.br|1130030000|rpid|1021|25|15|f|movel|URA da assessoria|tech_e164|20")
checar("chave ausente mantém; texto vazio limpa o opcional", True,
       salvar({"realm": "", "canais": 12}) + f"; select concat_ws('|', coalesce(realm, '-'), dtmf, canais) "
       f"from public.voz_troncos where id={TID}", "authenticated", ADM, "-|inband|12", aal="aal2")

# o teste zera e o tronco do cliente desativa quando muda realm/De/cabeçalho/DTMF
sv(f"update public.voz_troncos set ativo = true, teste_ok = true, testado_em = now() where id = {TID}")
checar("mudar só a capacidade mantém o teste e o tronco ativo", True,
       salvar({"canais": 14}) + f"; select ativo || '|' || teste_ok from public.voz_troncos where id={TID}",
       "authenticated", ADM, "true|true", aal="aal2")
checar("mudar o DTMF zera o teste e desativa o tronco do cliente", True,
       salvar({"dtmf": "auto"}) + f"; select ativo || '|' || coalesce(teste_ok::text, '-') from public.voz_troncos "
       f"where id={TID}", "authenticated", ADM, "false|-", aal="aal2")
sv(f"update public.voz_troncos set ativo = true, teste_ok = true, testado_em = now() where id = {TID}")
checar("a equipe muda o cabeçalho: zera o teste, mas o tronco segue ativo", True,
       salvar({"cabecalho_bina": "from_pai"}) + f"; select ativo || '|' || coalesce(teste_ok::text, '-') "
       f"from public.voz_troncos where id={TID}", "authenticated", TEC, "true|-")

# declaração a cada troca de bina
checar("cliente troca a bina sem declarar de novo: recusado", False, salvar({"bina": "1130031111"}), "authenticated", ADM,
       aal="aal2", erro="marque as duas declarações")
checar("cliente troca a bina declarando: ok", True,
       salvar({"bina": "1130031111", "declaro": True}) + f"; select bina from public.voz_troncos where id={TID}",
       "authenticated", ADM, "1130031111", aal="aal2")
checar("a equipe troca a bina sem declarar: a declaração antiga some (o cliente declara de novo)", True,
       salvar({"bina": "1130032222"}) + f"; select declaracao_em is null from public.voz_troncos where id={TID}",
       "authenticated", TEC, "t")
sql(salvar({"bina": "1130032222", "declaro": True}), "authenticated", ADM, "aal2")

# bina única por operadora
OUTRO = (f"select public.salvar_tronco_voz({EA}, '{json.dumps({'referencia': f'tb113-{T}', 'operadora': 'Operadora Beta', 'host': 'sip2.e113.exemplo.com.br', 'canais': 5, 'autenticacao': 'ip', 'bina': '1130032222', 'declaro': True})}'::jsonb)")
checar("a mesma bina em tronco de outra operadora é recusada", False, OUTRO, "authenticated", ADM, aal="aal2",
       erro="outra operadora")
checar("a mesma bina em outro tronco da MESMA operadora pode", True,
       OUTRO.replace("Operadora Beta", "operadora alfa ") + " is not null", "authenticated", ADM, "t", aal="aal2")
checar("outra empresa pode ter a mesma bina (a regra é por empresa)", True,
       salvar({"declaro": True, "operadora": "Operadora Gama", "bina": "1130032222"}, EB) + " is not null",
       "authenticated", ADMB, "t", aal="aal2")

# rotas: prefixo opcional e tronco inativo
checar("rota em tronco inativo da empresa pode (não disca até a equipe ativar)", True,
       f"select public.salvar_rota_voz({EA}, {TID}, '1021', 'movel_vc1', 1, 30, 6, 0.05) is not null",
       "authenticated", ADM, "t", aal="aal2")
RSP = f"select public.salvar_rota_voz({EA}, {TID}, '', 'movel_vc2_vc3', 1, 30, 6, 0.07"
checar("rota sem prefixo: não manda prefixo e guarda um código interno de 8 dígitos", True,
       RSP + ", (now() at time zone 'America/Sao_Paulo')::date - 10) is not null; select enviar_prefixo || '|' || "
       f"(tech_prefix ~ '^0[0-9]{{7}}$') from public.voz_rotas where empresa_id={EA} and tipo='movel_vc2_vc3'",
       "authenticated", ADM, "false|true", aal="aal2")
COD = sv(f"select tech_prefix from public.voz_rotas where empresa_id={EA} and tipo='movel_vc2_vc3'")
checar("vigência nova sem prefixo do mesmo tronco e tipo reaproveita o código e fecha a anterior", True,
       RSP.replace("0.07", "0.06") + f") is not null; select count(*) || '|' || count(distinct tech_prefix) || '|' || "
       f"count(*) filter (where vigente_ate is null) || '|' || bool_and(tech_prefix = '{COD}') from public.voz_rotas "
       f"where empresa_id={EA} and tipo='movel_vc2_vc3'", "authenticated", ADM, "2|1|1|true", aal="aal2")
checar("prefixo com letra é recusado", False,
       f"select public.salvar_rota_voz({EA}, {TID}, '10a', 'fixo_local', 1, 30, 6, 0.05)", "authenticated", ADM,
       aal="aal2", erro="prefixo da operadora")

# leitura
checar("Operação da empresa lê os campos novos", True,
       f"select dtmf || '|' || liga_para from public.voz_troncos_campos_empresa where id={TID}", "authenticated", OPER,
       "auto|movel")
checar("Operação lê se a rota manda prefixo", True,
       f"select count(*) filter (where not enviar_prefixo) from public.voz_rotas_prefixo_empresa where empresa_id={EA}",
       "authenticated", OPER, 2)
checar("Admin de outra empresa não lê", True,
       f"select count(*) from public.voz_troncos_campos_empresa where empresa_id={EA}", "authenticated", ADMB, 0)
checar("anon não lê", False, "select * from public.voz_troncos_campos_empresa", "anon")
checar("o servidor de voz (motorcx_voz) lê os campos do tronco e da rota", True,
       f"set role motorcx_voz; select (select toque_max_s from voz_vm.troncos_campos where id={TID}) || '|' || "
       f"(select count(*) from voz_vm.rotas_prefixo r join voz_vm.rotas x using (id) where x.empresa_id={EA})",
       None, None, "25|3")
checar("o site não lê as views da VM", False, "select * from voz_vm.troncos_campos", "authenticated", ADM)

sv(f"delete from public.voz_rotas where empresa_id in ({EA}, {EB}); "
   f"delete from public.voz_troncos where empresa_id in ({EA}, {EB})")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
