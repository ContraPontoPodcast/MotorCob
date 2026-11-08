"""SQL 88 · Agente de voz: identidade pelo arquivo (mailing).

Cobre: a migração roda duas vezes; a configuração (formato, versões com "o que mudou", auditoria, só quem aprova o
roteiro de voz salva, equipe e outra empresa não); os códigos (só HMAC de 32 hexadecimais, nunca o valor; id com cara de
CPF barrado; só a rotina publica; carteira que não confere pelo arquivo não guarda nada); ninguém lê as tabelas (site,
chave do servidor e o papel da VM); a conferência só durante uma ligação em andamento (aberta, do mesmo cliente, até
30 min); 2 tentativas por pergunta na ligação; o limite de 4 erros por cliente no dia somando as ligações; a trava das
ofertas (identidade_mailing_confirmada só depois das perguntas pedidas nesta ligação); o acesso próprio da VM
(voz_vm.*) recebe só a palavra; a limpeza; fluxo_voz_pendencias sem identidade_sem_conferencia com o arquivo; e as
colunas novas do mapeamento da carga.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_identidade_mailing.py
Só dados fictícios (empresas e88-*, e-mails @exemplo.test); a chave é gerada aqui e descartada.
"""
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
from voz import fluxo_casos as FC  # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL88 = RAIZ / "supabase" / "migrations" / "20270124000001_voz_identidade_mailing.sql"


def sql(cmd, papel=None, uid=None, usuario=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + (["-U", usuario] if usuario else []) + ["-f", "-"], input=pre + cmd,
                       capture_output=True, text=True)
    ULTIMO[0] = r.stderr.strip()[:300]
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0
ULTIMO = [""]


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, usuario=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid, usuario)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 88: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 88: " + nome + ("" if cond else f"  -> {detalhe} {ULTIMO[0]}"))


def sv(cmd, papel=None, uid=None, usuario=None):
    ok, out, err = sql(cmd, papel, uid, usuario)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL88)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


CHAVE = secrets.token_bytes(32)


def cod(empresa, idc, pergunta, valor):
    msg = f"motorcx:identidade:v1:{empresa}:{idc}:{pergunta}:{valor}".encode()
    return hmac.new(CHAVE, msg, hashlib.sha256).hexdigest()[:32]


def j(x):
    return json.dumps(x).replace("'", "''")


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e88-a-{T}', 'E88 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e88-b-{T}', 'E88 B {T}') returning id")
CA = sv(f"select id from public.credores where empresa_id = {EA} order by id limit 1")
CB = sv(f"select id from public.credores where empresa_id = {EB} order by id limit 1")
sv(f"insert into public.voz_config (empresa_id) values ({EA}) on conflict do nothing")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("oper", "operacao", EA), ("admb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('{p}88-{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp} where id='{U[p]}'")
U["eq"] = sv(f"insert into auth.users (email) values ('eq88-{T}@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='admin', equipe_alcance='todas', empresa_id=null where id='{U['eq']}'")
ADM, OPER, ADMB, EQ = (("authenticated", U[k]) for k in ("adm", "oper", "admb", "eq"))
CFG = {"fonte": "crm_arquivo", "perguntas": ["dia_mes_nascimento", "ultimos3_documento"], "quantas": 2,
       "se_faltar": "proxima", "erros_dia": 4}


def salvar(cfg, credor=CA, empresa=EA):
    c = "null" if cfg is None else f"'{j(cfg)}'::jsonb"
    return f"select coalesce(public.salvar_config_mailing_voz({empresa}, {credor}, {c})::text, 'null')"


# ---------------------------------------------------------------- configuração
checar("sem configuração: identidade_voz_vigente é nula (o de hoje)", True,
       f"select public.identidade_voz_vigente({EA}, {CA}) is null", *ADM, valor="t")
checar("operação não muda quem confere", False, salvar(CFG), *OPER, erro="aprova")
checar("equipe MotorCX não muda quem confere", False, salvar(CFG), *EQ, erro="aprova")
checar("Admin de outra empresa não muda", False, salvar(CFG), *ADMB)
for nome, ruim in (("pergunta fora da lista (nome da mãe)", dict(CFG, perguntas=["nome_mae", "dia_mes_nascimento"])),
                   ("3 perguntas", dict(CFG, quantas=3)), ("erros no dia 5", dict(CFG, erros_dia=5)),
                   ("fonte ia", dict(CFG, fonte="ia")), ("2 perguntas com 1 ligada", dict(CFG, perguntas=["ano_nascimento"])),
                   ("campo a mais", dict(CFG, valor=1)), ("pergunta repetida", dict(CFG, perguntas=["ano_nascimento"] * 2))):
    checar(f"configuração inválida recusada: {nome}", False, salvar(ruim), *ADM)
checar("Admin salva (aprovar_roteiro_voz)", True, salvar(CFG), *ADM)
V1 = sv(f"select id from public.voz_mailing_config where credor_id = {CA} and vigente_ate is null")
checar("salvar igual não abre versão", True, salvar(CFG), *ADM, valor=V1)
checar("salvar diferente abre versão e fecha a anterior", True,
       salvar(dict(CFG, erros_dia=6)) + f"; select count(*) || '|' || count(*) filter (where vigente_ate is null) "
       f"from public.voz_mailing_config where credor_id = {CA}", *ADM, valor="2|1")
checar("o que mudou em palavras", True,
       f"select mudancas from public.voz_mailing_config where credor_id = {CA} and vigente_ate is null", *ADM,
       valor="Erros no dia por cliente: 6")
checar("auditoria grava o salvamento", True,
       f"select count(*) > 0 from public.auditoria where tabela = 'voz_mailing_config'", valor="t")
sv(salvar(CFG, CA), *ADM)
checar("quem vê a empresa lê a configuração (operação)", True,
       f"select identidade ->> 'fonte' from public.voz_mailing_config where credor_id = {CA} and vigente_ate is null",
       *OPER, valor="crm_arquivo")
checar("outra empresa não lê", True,
       f"select count(*) from public.voz_mailing_config where empresa_id = {EA}", *ADMB, valor=0)
checar("outra empresa não lê pela função", True,
       f"select public.identidade_voz_vigente({EA}, {CA}) is null", *ADMB, valor="t")
checar("o site não grava a tabela direto", False,
       f"update public.voz_mailing_config set identidade = identidade where empresa_id = {EA}", *ADM)

# ---------------------------------------------------------------- códigos (só HMAC; só a rotina publica)
IDC = f"CL-{T}"
LINHAS = [{"id_cliente": IDC, "pergunta": "dia_mes_nascimento", "codigo": cod(EA, IDC, "dia_mes_nascimento", "1503"),
           "versao": 1},
          {"id_cliente": IDC, "pergunta": "ultimos3_documento", "codigo": cod(EA, IDC, "ultimos3_documento", "725"),
           "versao": 1},
          {"id_cliente": f"OUT-{T}", "pergunta": "dia_mes_nascimento",
           "codigo": cod(EA, f"OUT-{T}", "dia_mes_nascimento", "0101"), "versao": 1}]


def publicar(linhas, credor=CA, empresa=EA, papel="service_role", uid=None):
    return sql(f"select public.publicar_identidade_voz({empresa}, {credor}, current_date, '{j(linhas)}'::jsonb)",
               papel, uid)


ok, out, _ = publicar(LINHAS, papel="authenticated", uid=U["adm"])
afirmar("o site não publica códigos", not ok)
ok, out, _ = publicar(LINHAS)
afirmar("a rotina publica (service_role)", ok and json.loads(out)["gravados"] == 3, out)
ok, _, err = publicar([dict(LINHAS[0], codigo="15031980")])
afirmar("valor em claro (não é código de 32 hexadecimais) é recusado", not ok, err)
ok, _, err = publicar([dict(LINHAS[0], codigo="1503")])
afirmar("valor curto é recusado", not ok, err)
ok, _, err = publicar([dict(LINHAS[0], id_cliente="529.982.247-25")])
afirmar("id com cara de CPF é recusado", not ok and "sem_cpf" in err, err)
publicar(LINHAS)
checar("a tabela só tem código (colunas fixas, nenhuma de valor)", True,
       "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns "
       "where table_schema = 'public' and table_name = 'voz_identidade_dia'",
       valor="empresa_id,credor_id,id_cliente,pergunta,codigo,versao,dia,publicado_em")
for papel, uid in (("authenticated", U["adm"]), ("authenticated", U["eq"]), ("service_role", None), ("anon", None)):
    for t in ("voz_identidade_dia", "voz_identidade_tentativas", "voz_identidade_chamadas"):
        checar(f"{papel}{' (equipe)' if uid == U['eq'] else ''} não lê {t}", False, f"select count(*) from public.{t}",
               papel, uid)
for t in ("voz_identidade_dia", "voz_identidade_tentativas", "voz_identidade_chamadas"):
    checar(f"o papel da VM (motorcx_voz) não lê {t}", False, f"select count(*) from public.{t}", usuario="motorcx_voz")
checar("nenhuma view de voz_vm lê as tabelas de identidade", True,
       "select count(*) from pg_views where schemaname = 'voz_vm' and definition like '%voz_identidade%'", valor=0)
checar("as tabelas de código não têm auditoria (o código nunca vai para a auditoria)", True,
       "select count(*) from pg_trigger where tgname = 'z_auditar' and tgrelid in ('public.voz_identidade_dia'::regclass, "
       "'public.voz_identidade_tentativas'::regclass, 'public.voz_identidade_chamadas'::regclass)", valor=0)

# carteira que não confere pelo arquivo: apaga e não grava
sv(salvar(dict(CFG, fonte="crm"), CA), *ADM)
ok, out, _ = publicar(LINHAS)
afirmar("carteira só com o CRM: a publicação apaga e não grava nada", ok and json.loads(out) == {
    "gravados": 0, "apagados": 3, "usa_arquivo": False}, out)
sv(salvar(CFG, CA), *ADM)
publicar(LINHAS)
ok, out, _ = publicar(LINHAS[:2])
afirmar("quem saiu da lista sai junto na publicação seguinte", ok and json.loads(out)["apagados"] == 3, out)
publicar(LINHAS)


# ---------------------------------------------------------------- conferência (no banco, só durante a ligação)
def abrir(ch, idc=IDC, credor=CA, usuario=None, papel="service_role"):
    if usuario:
        return sql(f"select voz_vm.abrir_identidade('{j({'empresa': int(EA), 'credor': int(credor), 'id_cliente': idc, 'id_chamada': ch})}')",
                   usuario=usuario)
    return sql(f"select public.abrir_identidade_voz({EA}, {credor}, '{idc}', '{ch}')", papel)


def conferir(ch, pergunta, valor, idc=IDC, versao=1, papel="service_role", usuario=None, credor=CA):
    c = cod(EA, idc, pergunta, valor)
    if usuario:
        a = {"empresa": int(EA), "credor": int(credor), "id_cliente": idc, "id_chamada": ch, "pergunta": pergunta,
             "codigo": c, "versao": versao}
        return sql(f"select voz_vm.conferir_identidade('{j(a)}') #>> '{{}}'", usuario=usuario)
    return sql(f"select public.conferir_identidade_voz({EA}, {credor}, '{idc}', '{ch}', '{pergunta}', '{c}', {versao})",
               papel)


ok, _, err = conferir(f"ch-sem-{T}", "dia_mes_nascimento", "1503")
afirmar("fora de uma ligação em andamento: recusa", not ok and "andamento" in err, err)
ok, _, _ = abrir(f"ch-1-{T}", papel="authenticated")
afirmar("o site não abre a conferência", not ok)
ok, out, _ = abrir(f"ch-1-{T}")
afirmar("abrir diz só quais perguntas têm dado e se está bloqueado", ok and json.loads(out) == {
    "disponiveis": ["dia_mes_nascimento", "ultimos3_documento"], "bloqueado": False}, out)
ok, _, err = conferir(f"ch-1-{T}", "dia_mes_nascimento", "1503", idc=f"OUT-{T}")
afirmar("ligação de outro cliente: recusa", not ok and "andamento" in err, err)
checar("trava das ofertas: antes de conferir, fechada", True,
       f"select public.identidade_mailing_confirmada({EA}, 'ch-1-{T}')", valor="f")
ok, out, _ = conferir(f"ch-1-{T}", "dia_mes_nascimento", "1503")
afirmar("a 1ª pergunta confere", ok and out == "identidade_ok", out)
checar("trava das ofertas: com 1 de 2 perguntas, segue fechada", True,
       f"select public.identidade_mailing_confirmada({EA}, 'ch-1-{T}')", valor="f")
ok, out, _ = conferir(f"ch-1-{T}", "ultimos3_documento", "725")
afirmar("a 2ª pergunta confere", ok and out == "identidade_ok", out)
checar("trava das ofertas: aberta só nesta ligação", True,
       f"select public.identidade_mailing_confirmada({EA}, 'ch-1-{T}')::text || public.identidade_mailing_confirmada({EA}, 'ch-x-{T}')::text",
       valor="truefalse")
checar("o site não consulta a trava das ofertas", False,
       f"select public.identidade_mailing_confirmada({EA}, 'ch-1-{T}')", "authenticated", U["adm"])
ok, out, _ = conferir(f"ch-1-{T}", "ano_nascimento", "1980")
afirmar("pergunta que a configuração não liga: recusa", not ok)
ok, out, _ = conferir(f"ch-1-{T}", "dia_mes_nascimento", "1503", versao=2)
afirmar("código de outra versão da chave: sem_dado (próxima fonte)", ok and out == "sem_dado", out)

# limite: 2 tentativas por pergunta na ligação e 4 erros no dia somando as ligações
abrir(f"ch-2-{T}")
r = [conferir(f"ch-2-{T}", "dia_mes_nascimento", v)[1] for v in ("0101", "0202", "1503")]
afirmar("2 tentativas por pergunta na ligação; a 3ª é bloqueada", r == ["identidade_nao_confere"] * 2 + ["bloqueado"], r)
abrir(f"ch-3-{T}")
r = [conferir(f"ch-3-{T}", "dia_mes_nascimento", v)[1] for v in ("0303", "0404")]
afirmar("erros 3 e 4 do dia (outra ligação)", r == ["identidade_nao_confere"] * 2, r)
abrir(f"ch-4-{T}")
ok, out, _ = abrir(f"ch-4b-{T}")
afirmar("abrir avisa o limite do dia", ok and json.loads(out)["bloqueado"] is True, out)
ok, out, _ = conferir(f"ch-4-{T}", "dia_mes_nascimento", "1503")
afirmar("depois de 4 erros no dia, nem a resposta certa confere (bloqueado)", ok and out == "bloqueado", out)
checar("a contagem é só número (sem resposta nem código)", True,
       f"select erros from public.voz_identidade_tentativas where id_cliente = '{IDC}'", valor=4)
checar("a ligação guarda só nomes de pergunta e contagens", True,
       f"select tentativas::text from public.voz_identidade_chamadas where id_chamada = 'ch-2-{T}'",
       valor='{"dia_mes_nascimento": 2}')

# ligação aberta há mais de 30 minutos
abrir(f"ch-5-{T}", idc=f"OUT-{T}")
sv(f"update public.voz_identidade_chamadas set aberta_em = now() - interval '31 minutes' where id_chamada = 'ch-5-{T}'")
ok, _, err = conferir(f"ch-5-{T}", "dia_mes_nascimento", "0101", idc=f"OUT-{T}")
afirmar("ligação com mais de 30 minutos: recusa", not ok and "andamento" in err, err)

# acesso próprio da VM: só a palavra
abrir(f"ch-6-{T}", idc=f"OUT-{T}", usuario="motorcx_voz")
ok, out, err = conferir(f"ch-6-{T}", "dia_mes_nascimento", "0101", idc=f"OUT-{T}", usuario="motorcx_voz")
afirmar("a VM (motorcx_voz) confere e recebe só a palavra", ok and out == "identidade_ok", f"{out} {err}")
ok, out, err = sql(f"select voz_vm.identidade_vigente('{j({'empresa': int(EA), 'credor': int(CA)})}') -> 'identidade' ->> 'fonte'",
                   usuario="motorcx_voz")
afirmar("a VM lê a configuração vigente", ok and out == "crm_arquivo", f"{out} {err}")
ok, _, _ = sql(f"select public.conferir_identidade_voz({EA}, {CA}, '{IDC}', 'ch-6-{T}', 'dia_mes_nascimento', "
               f"'{'0' * 32}', 1)", usuario="motorcx_voz")
afirmar("a VM não chama a função do public direto", not ok)
ok, _, _ = sql(f"select voz_vm.conferir_identidade('{j({'empresa': int(EB), 'credor': int(CB), 'id_cliente': 'X1', 'id_chamada': 'ch-b', 'pergunta': 'dia_mes_nascimento', 'codigo': '0' * 32, 'versao': 1})}')",
               usuario="motorcx_voz")
afirmar("empresa sem voz: a VM não confere", not ok)

# ---------------------------------------------------------------- fluxo: pendência com e sem o arquivo
d = j(FC.negociador(1, None, 3, 4))
checar("só CRM e etapa sem conector: identidade_sem_conferencia", True,
       salvar(dict(CFG, fonte="crm")) + f"; select 'identidade_sem_conferencia:N2' = any(public.fluxo_voz_pendencias({EA}, {CA}, '{d}'))",
       *ADM, valor="t")
checar("com o arquivo: a etapa sem conector deixa de ser pendência", True,
       salvar(CFG) + f"; select 'identidade_sem_conferencia:N2' = any(public.fluxo_voz_pendencias({EA}, {CA}, '{d}'))",
       *ADM, valor="f")
checar("voltar ao de hoje (null) fecha a vigência", True,
       salvar(None) + f"; select public.identidade_voz_vigente({EA}, {CA}) is null", *ADM, valor="t")
checar("e a pendência volta", True,
       f"select 'identidade_sem_conferencia:N2' = any(public.fluxo_voz_pendencias({EA}, {CA}, '{d}'))", *ADM, valor="t")
checar("configuração da empresa toda vale para a carteira", True,
       salvar(CFG, "null") + f"; select public.identidade_voz_vigente({EA}, {CA}) ->> 'credor_id' is null", *ADM,
       valor="t")
sv(salvar(None, "null"), *ADM)

# ---------------------------------------------------------------- limpeza
sv(salvar(CFG), *ADM)
publicar(LINHAS)
sv(f"update public.voz_identidade_dia set dia = current_date - 3 where id_cliente = 'OUT-{T}'")
sv(f"update public.voz_identidade_tentativas set dia = current_date - 3 where id_cliente = '{IDC}'")
checar("o site não limpa", False, "select public.limpar_identidade_voz()", "authenticated", U["adm"])
ok, out, err = sql("select voz_vm.limpar_identidade('{}')", usuario="motorcx_voz")
afirmar("a VM limpa (job noturno) e recebe só contagens", ok and set(json.loads(out)) == {"codigos", "tentativas", "chamadas"},
        f"{out} {err}")
checar("código com mais de 1 dia e tentativas com mais de 2 dias apagados", True,
       f"select (select count(*) from public.voz_identidade_dia where id_cliente = 'OUT-{T}') || '|' || "
       f"(select count(*) from public.voz_identidade_tentativas where id_cliente = '{IDC}') || '|' || "
       f"(select count(*) from public.voz_identidade_dia where id_cliente = '{IDC}')", valor="0|0|2")
sv(salvar(dict(CFG, fonte="crm")), *ADM)
sv("set role service_role; select public.limpar_identidade_voz()")
checar("carteira que deixou de conferir pelo arquivo: a limpeza apaga os códigos", True,
       f"select count(*) from public.voz_identidade_dia where empresa_id = {EA}", valor=0)

# ---------------------------------------------------------------- colunas da carga
MAP = {"id_cliente": "COD", "cpf": "CPF", "saldo": "SALDO", "dias_atraso": "ATRASO", "telefones": ["TEL"]}
CAB = ["COD", "CPF", "SALDO", "ATRASO", "TEL", "DT_NASC", "ULT3"]


def mapear(extra):
    return (f"select public.salvar_mapeamento_base({CA}, '{j(dict(MAP, **extra))}'::jsonb, '{j(CAB)}'::jsonb) "
            f"-> 'colunas' ->> 'documento_validacao'")


checar("data de nascimento e 3 dígitos numa coluna própria", True, mapear({"nascimento": "DT_NASC", "documento_validacao": "ULT3"}),
       *ADM, valor="ULT3")
checar('"usar o CPF/CNPJ já apontado" (a mesma coluna do CPF)', True, mapear({"documento_validacao": "CPF"}), *ADM, valor="CPF")
checar("a data não pode repetir outra coluna", False, mapear({"nascimento": "SALDO"}), *ADM, erro="mais de um campo")
checar("coluna fora do arquivo recusada", False, mapear({"nascimento": "NAO_TEM"}), *ADM)

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
