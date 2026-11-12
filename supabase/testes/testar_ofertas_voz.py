"""SQL 130 · Agente de voz: as ofertas vêm só da API do credor ou do arquivo (SPEC_OFERTAS_v2).

Cobre: a migração roda duas vezes; a parte "ofertas" de voz_mailing_config (formato, versões com "o que mudou",
auditoria, identidade e ofertas resolvidas cada uma por si, salvar a identidade mantém as ofertas e vice-versa); quem
muda (Q15: o Admin do cliente ativa, a equipe MotorCX só grava rascunho, operação e outra empresa não; conector tem de
ser "Buscar ofertas" da empresa); em_falha alternativa_carteira → reserva_arquivo (migrado e traduzido); as ofertas do
arquivo (só números e datas no formato do contrato, id com cara de CPF barrado, só a rotina publica, "só a API" não
guarda); ninguém lê voz_ofertas_dia (site, chave do servidor, papel da VM); ofertas_mailing_voz só dentro da ligação com
a identidade confirmada (pelo arquivo ou pelo CRM registrado pela VM), do contrato da ligação ou do principal; o acesso
próprio da VM (voz_vm.*); a limpeza; a etapa Oferta com origem 'arquivo'; e as colunas oferta1..3_* do mapeamento.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_ofertas_voz.py
Só dados fictícios (empresas e130-*, e-mails @exemplo.test).
"""
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
from voz import fluxo_casos as FC  # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL130 = RAIZ / "supabase" / "migrations" / "20270327000001_voz_ofertas_fonte.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 130: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:200]!r} err={err[:300]}"))


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 130: " + nome + ("" if cond else f"  -> {detalhe} {ULTIMO[0]}"))


def sv(cmd, papel=None, uid=None, usuario=None):
    ok, out, err = sql(cmd, papel, uid, usuario)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL130)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


def j(x):
    return json.dumps(x).replace("'", "''")


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e130-a-{T}', 'E130 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e130-b-{T}', 'E130 B {T}') returning id")
CA = sv(f"select id from public.credores where empresa_id = {EA} order by id limit 1")
CB = sv(f"select id from public.credores where empresa_id = {EB} order by id limit 1")
sv(f"insert into public.voz_config (empresa_id) values ({EA}) on conflict do nothing")
HOST = f"api-{T}.exemplo.com.br"
sv(f"insert into public.crm_hosts_permitidos (empresa_id, host) values ({EA}, '{HOST}'), ({EB}, '{HOST}')")


def conector(emp, fin, em_falha="ramo", nome="Buscar ofertas"):
    return sv(f"insert into public.crm_conectores (empresa_id, nome, finalidade, metodo, url, autenticacao, em_falha) "
              f"values ({emp}, '{nome} {uuid.uuid4().hex[:4]}', '{fin}', 'GET', 'https://{HOST}/ofertas', 'bearer', "
              f"'{em_falha}') returning id")


KA = conector(EA, "buscar_ofertas")
KV = conector(EA, "validar_cadastro", nome="Validar")
KB = conector(EB, "buscar_ofertas")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("plan", "planejamento", EA), ("oper", "operacao", EA), ("admb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('{p}130-{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp} where id='{U[p]}'")
U["eq"] = sv(f"insert into auth.users (email) values ('eq130-{T}@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='admin', equipe_alcance='todas', empresa_id=null where id='{U['eq']}'")
ADM, PLAN, OPER, ADMB, EQ = (("authenticated", U[k]) for k in ("adm", "plan", "oper", "admb", "eq"))
OF = {"modo": "api_arquivo", "conector_id": int(KA)}
IDENT = {"fonte": "crm_arquivo", "perguntas": ["dia_mes_nascimento", "ultimos3_documento"], "quantas": 2,
         "se_faltar": "proxima", "erros_dia": 4}


def ativar(of, credor=CA, empresa=EA):
    c = "null" if of is None else f"'{j(of)}'::jsonb"
    return f"select coalesce(public.ativar_ofertas_voz({empresa}, {credor}, {c})::text, 'null')"


def rascunho(of, credor=CA, empresa=EA):
    c = "null" if of is None else f"'{j(of)}'::jsonb"
    return f"select coalesce(public.salvar_rascunho_ofertas_voz({empresa}, {credor}, {c})::text, 'null')"


def vigente(credor=CA):
    return f"select coalesce(public.ofertas_voz_vigente({EA}, {credor}) -> 'ofertas' ->> 'modo', 'padrao')"


# ---------------------------------------------------------------- formato e quem muda
checar("sem configuração: ofertas no padrão (o arquivo vale como reserva)", True,
       vigente() + f"; select public.ofertas_voz_usa_arquivo({EA}, {CA})", *ADM, valor="t")
for nome, ruim in (("modo desconhecido (regras)", {"modo": "regras", "conector_id": int(KA)}),
                   ("ofertas padrão da alçada", {"modo": "padrao", "conector_id": None}),
                   ("API sem conector", {"modo": "so_api", "conector_id": None}),
                   ("só arquivo com conector", {"modo": "so_arquivo", "conector_id": int(KA)}),
                   ("campo a mais (desconto)", dict(OF, desconto_max=30)),
                   ("conector como texto", {"modo": "so_api", "conector_id": str(KA)})):
    checar(f"configuração inválida recusada: {nome}", False, ativar(ruim), *ADM)
checar("conector de outra finalidade recusado", False, ativar({"modo": "so_api", "conector_id": int(KV)}), *ADM,
       erro="Buscar ofertas")
checar("conector de outra empresa recusado", False, ativar({"modo": "so_api", "conector_id": int(KB)}), *ADM,
       erro="Buscar ofertas")
checar("equipe MotorCX não ativa (Q15)", False, ativar(OF), *EQ, erro="Admin do cliente")
checar("operação não ativa", False, ativar(OF), *OPER)
checar("Admin de outra empresa não ativa", False, ativar(OF), *ADMB)
checar("operação não grava rascunho", False, rascunho(OF), *OPER)
checar("equipe MotorCX grava rascunho", True, rascunho(OF) + "; select 1", *EQ, valor=1)
checar("o rascunho não vale para as ligações", True, vigente(), *ADM, valor="padrao")
checar("quem vê a empresa lê o rascunho", True,
       f"select ofertas ->> 'modo' from public.voz_ofertas_rascunho where credor_id = {CA}", *OPER, valor="api_arquivo")
checar("outra empresa não lê o rascunho", True,
       f"select count(*) from public.voz_ofertas_rascunho where empresa_id = {EA}", *ADMB, valor=0)
checar("o site não grava o rascunho direto", False,
       f"insert into public.voz_ofertas_rascunho (empresa_id, ofertas) values ({EA}, '{j(OF)}')", *ADM)
checar("Admin do cliente ativa e o rascunho some", True,
       ativar(OF) + f"; select (select count(*) from public.voz_ofertas_rascunho where credor_id = {CA}) || '|' || "
       f"(public.ofertas_voz_vigente({EA}, {CA}) -> 'ofertas' ->> 'modo')", *ADM, valor="0|api_arquivo")
V1 = sv(f"select id from public.voz_mailing_config where credor_id = {CA} and vigente_ate is null")
checar("ativar igual não abre versão", True, ativar(OF), *ADM, valor=V1)
checar("Planejamento com editar_orquestracao também ativa", True,
       ativar({"modo": "so_arquivo", "conector_id": None}) + "; select 1", *PLAN, valor=1)
checar("o que mudou em palavras", True,
       f"select mudancas from public.voz_mailing_config where credor_id = {CA} and vigente_ate is null", *ADM,
       valor="Ofertas: só o arquivo")
checar("só o arquivo: a carteira usa o arquivo", True, f"select public.ofertas_voz_usa_arquivo({EA}, {CA})", *ADM,
       valor="t")
sv(ativar({"modo": "so_api", "conector_id": int(KA)}), *ADM)
checar("só a API: a carteira não usa o arquivo", True, f"select public.ofertas_voz_usa_arquivo({EA}, {CA})", *ADM,
       valor="f")
checar("auditoria grava a ativação", True,
       f"select count(*) > 0 from public.auditoria where tabela = 'voz_mailing_config'", valor="t")

# identidade e ofertas, cada uma por si
checar("a versão só com ofertas não tem identidade (o de hoje)", True,
       f"select public.identidade_voz_vigente({EA}, {CA}) is null", *ADM, valor="t")
checar("salvar a identidade mantém as ofertas", True,
       f"select public.salvar_config_mailing_voz({EA}, {CA}, '{j(IDENT)}'::jsonb); "
       f"select (public.identidade_voz_vigente({EA}, {CA}) -> 'identidade' ->> 'fonte') || '|' || "
       f"(public.ofertas_voz_vigente({EA}, {CA}) -> 'ofertas' ->> 'modo')", *ADM, valor="crm_arquivo|so_api")
checar("ativar as ofertas mantém a identidade", True,
       ativar(OF) + f"; select (public.identidade_voz_vigente({EA}, {CA}) -> 'identidade' ->> 'fonte') || '|' || "
       f"(public.ofertas_voz_vigente({EA}, {CA}) -> 'ofertas' ->> 'modo')", *ADM, valor="crm_arquivo|api_arquivo")
checar("identidade de volta ao de hoje mantém as ofertas", True,
       f"select public.salvar_config_mailing_voz({EA}, {CA}, null); "
       f"select (public.identidade_voz_vigente({EA}, {CA}) is null)::text || '|' || "
       f"(public.ofertas_voz_vigente({EA}, {CA}) -> 'ofertas' ->> 'modo')", *ADM, valor="true|api_arquivo")
checar("identidade da empresa toda vale para a carteira que só configurou ofertas", True,
       f"select public.salvar_config_mailing_voz({EA}, null, '{j(IDENT)}'::jsonb); "
       f"select public.identidade_voz_vigente({EA}, {CA}) ->> 'credor_id' is null", *ADM, valor="t")
sv(f"select public.salvar_config_mailing_voz({EA}, null, null)", *ADM)
checar("ofertas de volta ao padrão (null) fecham a vigência", True,
       ativar(None) + "; " + vigente(), *ADM, valor="padrao")
checar("nenhuma versão vigente sem identidade e sem ofertas", True,
       f"select count(*) from public.voz_mailing_config where empresa_id = {EA} and vigente_ate is null", valor=0)
checar("versão sem as duas partes é recusada pela tabela", False,
       f"insert into public.voz_mailing_config (empresa_id, credor_id) values ({EA}, {CA})")
checar("ofertas da empresa toda valem para a carteira", True,
       ativar({"modo": "so_arquivo", "conector_id": None}, credor="null") + "; " + vigente(), *ADM, valor="so_arquivo")
sv(ativar(None, credor="null"), *ADM)

# ---------------------------------------------------------------- em_falha
KF = conector(EA, "buscar_ofertas", em_falha="ramo")
checar("nome antigo (alternativa_carteira) vira reserva_arquivo", True,
       f"update public.crm_conectores set em_falha = 'alternativa_carteira' where id = {KF}; "
       f"select em_falha from public.crm_conectores where id = {KF}", valor="reserva_arquivo")
checar("reserva_arquivo só em Buscar ofertas", False, f"update public.crm_conectores set em_falha = 'reserva_arquivo' where id = {KV}")
checar("nenhum conector com alternativa_carteira", True,
       "select count(*) from public.crm_conectores where em_falha = 'alternativa_carteira'", valor=0)

# ---------------------------------------------------------------- ofertas do arquivo (só a rotina publica; ninguém lê)
IDC = f"CL-{T}"
O1 = {"id": "arq-1", "parcelas": 1, "valor_parcela": 1300.0, "desconto_pct": 35, "validade": "2099-11-18",
      "valor_total": 1300.0}
O2 = {"id": "arq-2", "parcelas": 4, "valor_parcela": 400.0, "validade": "2099-11-18"}
LINHAS = [{"id_cliente": IDC, "contrato": "K1", "principal": True, "ofertas": [O1, O2]},
          {"id_cliente": IDC, "contrato": "K2", "principal": False, "ofertas": [O2]},
          {"id_cliente": f"OUT-{T}", "contrato": "", "principal": True, "ofertas": [O2]}]


def publicar(linhas, credor=CA, empresa=EA, papel="service_role", uid=None):
    return sql(f"select public.publicar_ofertas_voz({empresa}, {credor}, (now() at time zone 'America/Sao_Paulo')::date, "
               f"'{j(linhas)}'::jsonb)", papel, uid)


ok, _, _ = publicar(LINHAS, papel="authenticated", uid=U["adm"])
afirmar("o site não publica ofertas", not ok)
ok, out, _ = publicar(LINHAS)
afirmar("a rotina publica (service_role)", ok and json.loads(out)["gravados"] == 3, out)
for nome, ruim in (("sem validade", [{k: v for k, v in O2.items() if k != "validade"}]),
                   ("desconto acima de 100", [dict(O2, desconto_pct=800)]),
                   ("4 ofertas", [dict(O2, id=f"a{i}") for i in range(4)]),
                   ("campo de limite (desconto_max)", [dict(O2, desconto_max=30)]),
                   ("nome do cliente", [dict(O2, nome="Fulano")]),
                   ("ids repetidos", [O2, O2]), ("parcelas 0", [dict(O2, parcelas=0)])):
    ok, _, err = publicar([{"id_cliente": IDC, "contrato": "K9", "ofertas": ruim}])
    afirmar(f"oferta fora do contrato é recusada: {nome}", not ok, err)
ok, _, err = publicar([{"id_cliente": "529.982.247-25", "ofertas": [O2]}])
afirmar("id com cara de CPF é recusado", not ok and "sem_cpf" in err, err)
publicar(LINHAS)
for papel, uid in (("authenticated", U["adm"]), ("authenticated", U["eq"]), ("service_role", None), ("anon", None)):
    checar(f"{papel}{' (equipe)' if uid == U['eq'] else ''} não lê voz_ofertas_dia", False,
           "select count(*) from public.voz_ofertas_dia", papel, uid)
checar("o papel da VM (motorcx_voz) não lê voz_ofertas_dia", False, "select count(*) from public.voz_ofertas_dia",
       usuario="motorcx_voz")
checar("nenhuma view de voz_vm lê voz_ofertas_dia", True,
       "select count(*) from pg_views where schemaname = 'voz_vm' and definition like '%voz_ofertas_dia%'", valor=0)


def ofertas(ch, idc=IDC, contrato=None, papel="service_role", usuario=None):
    if usuario:
        a = {"empresa": int(EA), "credor": int(CA), "id_cliente": idc, "id_chamada": ch, "contrato": contrato}
        return sql(f"select voz_vm.ofertas_mailing('{j(a)}')", usuario=usuario)
    c = "null" if contrato is None else f"'{contrato}'"
    return sql(f"select public.ofertas_mailing_voz({EA}, {CA}, '{idc}', '{ch}', {c})", papel)


def crm_ok(ch, idc=IDC, usuario=None):
    if usuario:
        a = {"empresa": int(EA), "credor": int(CA), "id_cliente": idc, "id_chamada": ch}
        return sql(f"select voz_vm.confirmar_identidade_crm('{j(a)}')", usuario=usuario)
    return sql(f"select public.confirmar_identidade_crm_voz({EA}, {CA}, '{idc}', '{ch}')", "service_role")


ok, _, err = ofertas(f"ch-0-{T}")
afirmar("sem identidade confirmada na ligação: recusa", not ok and "identidade" in err, err)
sv(f"select public.salvar_config_mailing_voz({EA}, {CA}, '{j(IDENT)}'::jsonb)", *ADM)
sv(f"select public.abrir_identidade_voz({EA}, {CA}, '{IDC}', 'ch-1-{T}')", "service_role")
ok, _, err = ofertas(f"ch-1-{T}")
afirmar("ligação aberta sem as perguntas conferidas: recusa", not ok and "identidade" in err, err)
ok, _, _ = crm_ok(f"ch-2-{T}", idc=IDC)
afirmar("a VM registra a identidade confirmada pelo CRM", ok)
ok, _, _ = sql(f"select public.confirmar_identidade_crm_voz({EA}, {CA}, '{IDC}', 'ch-9-{T}')", "authenticated", U["adm"])
afirmar("o site não registra identidade confirmada", not ok)
ok, _, err = crm_ok(f"ch-2-{T}", idc=f"OUT-{T}")
afirmar("a mesma ligação para outro cliente: recusa", not ok and "outro cliente" in err, err)
ok, out, _ = ofertas(f"ch-2-{T}")
afirmar("sem contrato: as ofertas do contrato principal, na ordem do arquivo", ok and json.loads(out) == [O1, O2], out)
ok, out, _ = ofertas(f"ch-2-{T}", contrato="K2")
afirmar("com o contrato da ligação: as dele", ok and json.loads(out) == [O2], out)
ok, out, _ = ofertas(f"ch-2-{T}", contrato="K7")
afirmar("contrato sem oferta: as do principal", ok and json.loads(out) == [O1, O2], out)
ok, _, err = ofertas(f"ch-2-{T}", idc=f"OUT-{T}")
afirmar("ofertas de outro cliente na mesma ligação: recusa", not ok, err)
sv(f"update public.voz_identidade_chamadas set aberta_em = now() - interval '31 minutes' where id_chamada = 'ch-2-{T}'")
ok, _, err = ofertas(f"ch-2-{T}")
afirmar("ligação com mais de 30 minutos: recusa", not ok, err)
ok, _, _ = sql(f"select public.ofertas_mailing_voz({EA}, {CA}, '{IDC}', 'ch-2-{T}')", "authenticated", U["adm"])
afirmar("o site não pede ofertas", not ok)

# acesso próprio da VM
ok, _, err = crm_ok(f"ch-3-{T}", usuario="motorcx_voz")
afirmar("a VM (motorcx_voz) registra a identidade pelo CRM", ok, err)
ok, out, err = ofertas(f"ch-3-{T}", usuario="motorcx_voz")
afirmar("a VM recebe as ofertas de um cliente", ok and json.loads(out) == [O1, O2], f"{out} {err}")
sv(ativar(OF), *ADM)
ok, out, err = sql(f"select voz_vm.ofertas_vigente('{j({'empresa': int(EA), 'credor': int(CA)})}') -> 'ofertas' ->> 'modo'",
                   usuario="motorcx_voz")
afirmar("a VM lê a ordem vigente", ok and out == "api_arquivo", f"{out} {err}")
ok, _, _ = sql(f"select public.ofertas_mailing_voz({EA}, {CA}, '{IDC}', 'ch-3-{T}')", usuario="motorcx_voz")
afirmar("a VM não chama a função do public direto", not ok)
ok, _, _ = sql(f"select voz_vm.ofertas_mailing('{j({'empresa': int(EB), 'credor': int(CB), 'id_cliente': 'X1', 'id_chamada': 'ch-b-1'})}')",
               usuario="motorcx_voz")
afirmar("empresa sem voz: a VM não pede ofertas", not ok)

# só a API: a publicação apaga e não grava; a leitura devolve vazio
sv(ativar({"modo": "so_api", "conector_id": int(KA)}), *ADM)
ok, out, _ = ofertas(f"ch-3-{T}")
afirmar("só a API: o arquivo não é lido", ok and json.loads(out) == [], out)
ok, out, _ = publicar(LINHAS)
afirmar("só a API: a publicação apaga e não grava nada", ok and json.loads(out) == {
    "gravados": 0, "apagados": 3, "usa_arquivo": False}, out)
sv(ativar(OF), *ADM)

# ---------------------------------------------------------------- limpeza
publicar(LINHAS)
sv(f"update public.voz_ofertas_dia set dia = (now() at time zone 'America/Sao_Paulo')::date - 3 where id_cliente = 'OUT-{T}'")
checar("o site não limpa", False, "select public.limpar_ofertas_voz()", "authenticated", U["adm"])
ok, out, err = sql("select voz_vm.limpar_ofertas('{}')", usuario="motorcx_voz")
afirmar("a VM limpa (job noturno) e recebe só a contagem", ok and "ofertas" in set(json.loads(out)), f"{out} {err}")
checar("oferta com mais de 1 dia apagada", True,
       f"select (select count(*) from public.voz_ofertas_dia where id_cliente = 'OUT-{T}') || '|' || "
       f"(select count(*) from public.voz_ofertas_dia where id_cliente = '{IDC}')", valor="0|2")
sv(ativar({"modo": "so_api", "conector_id": int(KA)}), *ADM)
sv("set role service_role; select public.limpar_ofertas_voz()")
checar("carteira que passou a só a API: a limpeza apaga as ofertas", True,
       f"select count(*) from public.voz_ofertas_dia where empresa_id = {EA}", valor=0)

# ---------------------------------------------------------------- fluxo: origem 'arquivo' na etapa Oferta
d = FC.negociador(1, None, 3, 4)
for b in d["blocos"]:
    if b["tipo"] == "oferta":
        b["params"]["origem"] = "arquivo"
checar("a etapa Oferta aceita a origem 'arquivo'", True, f"select public.fluxo_voz_valido('{j(d)}')", valor="t")
for b in d["blocos"]:
    if b["tipo"] == "oferta":
        b["params"]["origem"] = "regras"
checar("origem desconhecida (regras) recusada", True, f"select public.fluxo_voz_valido('{j(d)}')", valor="f")

# ---------------------------------------------------------------- colunas de oferta na carga
MAP = {"id_cliente": "COD", "saldo": "SALDO", "dias_atraso": "ATRASO", "telefones": ["TEL"]}
CAB = ["COD", "SALDO", "ATRASO", "TEL", "OF1_PARC", "OF1_VLR", "OF1_VAL", "DESC_MAX"]


def mapear(extra):
    return f"select public.salvar_mapeamento_base({CA}, '{j(dict(MAP, **extra))}'::jsonb, '{j(CAB)}'::jsonb) -> 'colunas'"


checar("as colunas oferta1_* entram no mapeamento", True,
       mapear({"oferta1_parcelas": "OF1_PARC", "oferta1_valor_parcela": "OF1_VLR", "oferta1_validade": "OF1_VAL"})
       + " ->> 'oferta1_validade'", *ADM, valor="OF1_VAL")
checar("oferta 4 não existe", False, mapear({"oferta4_parcelas": "OF1_PARC"}), *ADM, erro="campo desconhecido")
checar("limite por cliente (desconto_max) não existe", False, mapear({"desconto_max": "DESC_MAX"}), *ADM,
       erro="campo desconhecido")
checar("a mesma coluna em duas ofertas é recusada", False,
       mapear({"oferta1_parcelas": "OF1_PARC", "oferta2_parcelas": "OF1_PARC"}), *ADM, erro="mais de um campo")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
