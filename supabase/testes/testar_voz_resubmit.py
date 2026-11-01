"""SQL 65 · Renitência por situação, Resubmit, Reenviar agora e contato por passada, no banco.

Prova: a validação do bloco discagem é a do motor (mesmos casos em motor/discagem.normalizar), o histórico de versões
com conflito de edição, a permissão nova reenviar_lote_voz (Admin e Operação), a prévia e o pedido de reenvio (só
contagens), o contato por passada (menos de 30 chamadas = taxa nula) e o papel motorcx_voz (login de verdade, com
a senha do banco de teste no CI) chamando as funções novas de voz_vm, sem alcançar nada fora delas. Também confere
que a VM grava as decisões (voz_resubmits, só destino_hash) e as chamadas com passada e resubmit_id.
Só dados fictícios (IDs CLI-, hash de números de exemplo).

Pré-requisito: o banco com a imitação do Supabase e todas as migrações (como no testar_rls.py). Chamado pelo
testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_resubmit.py
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
from motor import discagem as DG  # noqa: E402

BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]


def sql(cmd, usuario="postgres", uid=None, papel=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-U", usuario, "-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


def _sv(cmd):
    ok, out, err = sql(cmd)
    assert ok, err
    return out


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, valor=None, usuario="postgres", uid=None, papel=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, usuario, uid, papel)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + nome + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:200]}"))


def vm(nome, esperado_ok, cmd, valor=None, erro=None):
    checar(nome, esperado_ok, cmd, valor, usuario="motorcx_voz", erro=erro)


def site(nome, esperado_ok, cmd, uid, valor=None, erro=None):
    checar(nome, esperado_ok, cmd, valor, uid=uid, papel="authenticated", erro=erro)


# rodou o 57 ou o 58 de novo (testar_voz_acesso.py), rode este depois: reaplica e prova que roda de novo com dados
r = subprocess.run(["psql", "-d", BANCO, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f",
                    str(RAIZ / "supabase" / "migrations" / "20270101000001_voz_resubmit.sql")],
                   capture_output=True, text=True)
assert r.returncode == 0, r.stderr
if os.environ.get("PGPASSWORD"):      # CI: login com senha (scram) também para o papel da VM
    _sv("alter role motorcx_voz with password '" + os.environ["PGPASSWORD"].replace("'", "''") + "'")

# ------------------------------------------------------------------ dados fictícios
_sv("update public.perfis set empresa_id = null where id in (select id from auth.users where email like 'rsb.%')")
_sv("delete from public.empresas where slug in ('rsb-alfa', 'rsb-beta')")
_sv("delete from auth.users where email like 'rsb.%'")
EA = _sv("insert into public.empresas (slug, nome) values ('rsb-alfa', 'Resubmit Alfa') returning id")
EB = _sv("insert into public.empresas (slug, nome) values ('rsb-beta', 'Resubmit Beta') returning id")
CA = _sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'rsb-a', 'Carteira A') returning id")
CB = _sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EB}, 'rsb-b', 'Carteira B') returning id")
_sv(f"insert into public.voz_config (empresa_id) values ({EA})")
U = {}
for p, papel in (("admin", "admin"), ("oper", "operacao"), ("plan", "planejamento"), ("outra", "admin")):
    U[p] = _sv(f"insert into auth.users (email) values ('rsb.{p}@x.com') returning id")
    _sv(f"update public.perfis set papel = '{papel}', empresa_id = {EB if p == 'outra' else EA}, equipe = false, "
        f"ativo = true where id = '{U[p]}'")
H = [hashlib.sha256(f"1198888777{i}".encode()).hexdigest() for i in range(6)]

# ------------------------------------------------------------------ R1: a validação é a do motor
CASOS = [
    {}, {"tentativas_numero_dia": 3}, {"tentativas_numero_dia": 11}, {"tentativas_cliente_dia": None},
    {"intervalo_min_minutos": 2.5}, {"descanso_nao_atende": {"ativo": True, "n": 6}}, {"descanso_nao_atende": {"n": 0}},
    {"chamadas_curtas": {"aviso": 75, "falha_conta": False}}, {"chamadas_curtas": {"aviso": 150}},
    {"inexistente": {"modo": "so_voz", "so_voz_desde": "2026-11-01"}}, {"inexistente": {"modo": "outro"}},
    {"retorno_agendado": {"de": "08:00", "ate": "21:30"}}, {"retorno_agendado": {"de": "8h"}},
    {"agente_ia": {"peso_cpc": 0.5}}, {"agente_ia": {"peso_cpc": 3}}, {"chave_nova": 1},
    {"por_situacao": {"ocupado": {"intervalo_minutos": 20, "max_dia": 2, "conta_descanso": False}}},
    {"por_situacao": {"ocupado": {"max_dia": 11}}}, {"por_situacao": {"falha_rede": {"max_dia": 1}}},
    {"por_situacao": {"maquina": {"x": 1}}},
    {"falhas_tecnicas": {"indisponivel": {"religar_minutos": 180, "aviso": 0.2}}},
    {"falhas_tecnicas": {"indisponivel": {"aviso": 0}}},
    {"resubmit": {"ocupado": {"ativo": True, "depois_minutos": 15, "max_dia": 2, "prioridade": "topo", "ate": "19:30",
                              "outro_numero": False}}},
    {"resubmit": {"ocupado": {"prioridade": "alta"}}}, {"resubmit": {"ocupado": {"depois_minutos": 601}}},
    {"resubmit": {"ocupado": {"ate": "25:00"}}}, {"resubmit": {"desconhecida": {}}}, {"resubmit": []},
    {"horarios": {"ativo": True, "tabela": None}}, {"horarios": True},
]
iguais = 0
for caso in CASOS:
    _, avisos = DG.normalizar(caso)
    ok, out, err = sql(f"select cardinality(public.discagem_erros('{json.dumps(caso)}'::jsonb))")
    iguais += ok and (out == "0") == (not avisos)
    if not (ok and (out == "0") == (not avisos)):
        print("   diferente do motor:", caso, out, avisos)
checar(f"R1: discagem_erros = motor/discagem.normalizar nos {len(CASOS)} casos", True, f"select {iguais}", len(CASOS))
checar("R1: a RPC só aceita tipos JSON (o motor também entende \"sim\"; o site manda booleano)", True,
       "select cardinality(public.discagem_erros('{\"horarios\": \"sim\", \"nao_ligar\": \"sim\"}'))", 2)
checar("R1: padrão MotorCX publicado para o site", True,
       "select public.discagem_padrao() -> 'resubmit' -> 'ocupado' ->> 'prioridade'", "topo", papel="authenticated",
       uid=U["oper"])

# ------------------------------------------------------------------ R2: versões, conflito e permissão
NOVA = json.dumps({"resubmit": {"ocupado": {"depois_minutos": 20}}, "por_situacao": {"ocupado": {"intervalo_minutos": 20}}})
site("R2: sem editar_credores não salva (Operação)", False,
     f"select public.salvar_discagem({CA}, '{NOVA}', 0)", U["oper"], erro="sem permissão")
site("R2: carteira de outra empresa não salva", False, f"select public.salvar_discagem({CA}, '{NOVA}', 0)", U["outra"],
     erro="carteira não encontrada")
site("R2: regra inválida é recusada com o motivo", False,
     f"select public.salvar_discagem({CA}, '{{\"resubmit\": {{\"ocupado\": {{\"max_dia\": 99}}}}}}', 0)", U["admin"],
     erro="resubmit/ocupado/max_dia")
site("R2: motivo com telefone é recusado (LGPD)", False,
     f"select public.salvar_discagem({CA}, '{NOVA}', 0, 'ligar para (11) 98888-7777')", U["admin"], erro="motivo")
site("R2: 1ª gravação vira v2 (v1 = o que valia antes)", True,
     f"select public.salvar_discagem({CA}, '{NOVA}', 0, 'Teste de volta mais cedo', array['Resubmit › Ocupado › depois de (min): 15 → 20'])",
     U["admin"], 2)
checar("R2: credores.discagem gravado e as duas versões no histórico", True,
       f"select (select discagem -> 'resubmit' -> 'ocupado' ->> 'depois_minutos' from public.credores where id = {CA}) "
       f"|| '|' || (select string_agg(versao || ':' || coalesce(resumo[1], ''), ',' order by versao) "
       f"from public.regras_voz_versoes where credor_id = {CA})", "20|1:Padrão MotorCX,2:Resubmit › Ocupado › depois de (min): 15 → 20")
site("R2: versão base antiga (outra pessoa salvou antes) é recusada", False,
     f"select public.salvar_discagem({CA}, '{{}}', 1)", U["admin"], erro="outra pessoa salvou a versão 2")
site("R2: voltar ao padrão (objeto vazio) grava nulo como v3", True,
     f"select public.salvar_discagem({CA}, '{{}}', 2); select coalesce(discagem::text, 'nulo') from public.credores where id = {CA}",
     U["admin"], "nulo")
site("R2: histórico visível na empresa", True, f"select count(*) from public.regras_voz_versoes where credor_id = {CA}",
     U["oper"], 3)
site("R2: histórico invisível para outra empresa", True,
     f"select count(*) from public.regras_voz_versoes where credor_id = {CA}", U["outra"], 0)
site("R2: ninguém grava no histórico direto", False,
     f"insert into public.regras_voz_versoes (empresa_id, credor_id, versao) values ({EA}, {CA}, 9)", U["admin"])
checar("R2: a gravação fica na auditoria (antes e depois)", True,
       f"select count(*) > 0 from public.auditoria where tabela = 'regras_voz_versoes'", "t")
_sv(f"update public.credores set discagem = '{NOVA}' where id = {CA}")

# ------------------------------------------------------------------ R8: permissão nova
for p, pode in (("admin", "t"), ("oper", "t"), ("plan", "f")):
    site(f"R8: reenviar_lote_voz padrão para {p}", True, "select public.pode('reenviar_lote_voz')", U[p], pode)

# ------------------------------------------------------------------ VM: lote do dia, ondas, decisões e chamadas
HOJE = _sv("select (now() at time zone 'America/Sao_Paulo')::date")
vm("VM: regras de discagem só com id e o bloco (sem nome nem CNPJ)", True,
   f"select jsonb_agg(x -> 'discagem' -> 'resubmit' -> 'ocupado' ->> 'depois_minutos') from jsonb_array_elements("
   f"voz_vm.regras_discagem('{{\"empresa\": {EA}}}')) x where (x ->> 'credor_id')::bigint = {CA}", '["20"]')
vm("VM: empresa sem voz não lê regras", False, f"select voz_vm.regras_discagem('{{\"empresa\": {EB}}}')",
   erro="sem voz")
LT = sql(f"select voz_vm.lote_do_dia('{{\"empresa\": {EA}, \"credor\": {CA}, \"dia\": \"{HOJE}\", \"total\": 6}}')",
         "motorcx_voz")[1]
vm("VM: o lote do dia é achado de novo (não duplica)", True,
   f"select voz_vm.lote_do_dia('{{\"empresa\": {EA}, \"credor\": {CA}, \"dia\": \"{HOJE}\", \"total\": 3}}')", LT)
checar("VM: lote nasce ligando, com o maior total", True, f"select situacao || '|' || total from public.voz_lotes where id = {LT}",
       "ligando|6")
vm("VM: carteira de outra empresa não abre lote", False,
   f"select voz_vm.lote_do_dia('{{\"empresa\": {EA}, \"credor\": {CB}, \"dia\": \"{HOJE}\"}}')", erro="outra empresa")
O1 = sql(f"select voz_vm.registrar_onda('{{\"lote\": {LT}, \"origem\": \"regua\", \"passada\": 1, \"prioridade\": \"normal\", "
         f"\"total\": 6, \"encerradas\": 0}}')", "motorcx_voz")[1]
O2 = sql(f"select voz_vm.registrar_onda('{{\"lote\": {LT}, \"origem\": \"resubmit\", \"passada\": 2, \"situacao_origem\": "
         f"\"nao_atendida\", \"prioridade\": \"normal\", \"total\": 1}}')", "motorcx_voz")[1]
vm("VM: a mesma onda não duplica e fecha quando todas encerram", True,
   f"select voz_vm.registrar_onda('{{\"lote\": {LT}, \"origem\": \"resubmit\", \"passada\": 2, \"situacao_origem\": "
   f"\"nao_atendida\", \"prioridade\": \"normal\", \"total\": 1, \"encerradas\": 1}}')", O2)
checar("VM: onda do Resubmit com origem, passada e situação", True,
       f"select origem || '|' || passada || '|' || situacao_origem || '|' || situacao from public.voz_ondas where id = {O2}",
       "resubmit|2|nao_atendida|encerrada")
vm("VM: situação fora da lista é recusada na onda", False,
   f"select voz_vm.registrar_onda('{{\"lote\": {LT}, \"origem\": \"resubmit\", \"passada\": 2, \"situacao_origem\": \"cpc\", "
   f"\"prioridade\": \"normal\"}}')")
REF = "ab" * 16
DEC = json.dumps([{"ref": REF, "empresa_id": int(EA), "credor_id": int(CA), "lote_id": int(LT), "id_cliente": "CLI-1",
                   "destino_hash": H[0], "situacao_origem": "nao_atendida", "passada": 2, "origem": "auto",
                   "decisao": "volta", "nao_antes_de": "2026-11-05T12:00:00-03:00", "id_chamada_origem": "rsb-0001"},
                  {"ref": "cd" * 16, "empresa_id": int(EA), "credor_id": int(CA), "lote_id": int(LT),
                   "id_cliente": "CLI-2", "destino_hash": H[1], "situacao_origem": "ocupado", "passada": 3,
                   "origem": "auto", "decisao": "fora", "motivo_fora": "max_dia"}])
ok, IDS, err = sql(f"select string_agg(id::text, ',') from voz_vm.gravar_resubmits('{DEC}')", "motorcx_voz")
checar("VM: grava as decisões e devolve os ids na ordem", True, f"select {int(ok and len(IDS.split(',')) == 2)}", 1)
RID = IDS.split(",")[0] if ok else "0"
vm("VM: reenviar a mesma decisão não duplica (upsert por ref)", True,
   f"select string_agg(id::text, ',') from voz_vm.gravar_resubmits('{DEC}')", IDS)
vm("VM: decisão com telefone (coluna fora da lista) é recusada", False,
   "select voz_vm.gravar_resubmits('" + DEC.replace('"id_cliente"', '"telefone": "11988887770", "id_cliente"', 1) + "')",
   erro="colunas que a VM não grava")
vm("VM: decisão de empresa sem voz é recusada", False,
   "select voz_vm.gravar_resubmits('" + DEC.replace(f'"empresa_id": {EA}', f'"empresa_id": {EB}', 1) + "')")
checar("VM: decisão com lote de outra empresa é recusada também pela chave do servidor (gatilho)", False,
       f"insert into public.voz_resubmits (ref, empresa_id, lote_id, id_cliente, destino_hash, situacao_origem, passada, "
       f"origem, decisao) values ('{'ef' * 16}', {EA}, (select id from public.voz_lotes where empresa_id <> {EA} limit 1), "
       f"'CLI-9', '{H[2]}', 'ocupado', 2, 'auto', 'volta')", papel="service_role", erro="outra empresa")
CH = []
for i, (cli, h, res, passada, sit, rid) in enumerate((
        ("CLI-1", H[0], "nao_atendida", 1, None, None), ("CLI-1", H[0], "nao_atendida", 2, "nao_atendida", RID),
        ("CLI-2", H[1], "ocupado", 1, None, None), ("CLI-3", H[2], "maquina", 1, None, None),
        ("CLI-4", H[3], "cpc", 1, None, None), ("CLI-5", H[4], "numero_inexistente", 1, None, None),
        ("CLI-6", H[5], "opt_out", 1, None, None))):
    CH.append({"empresa_id": int(EA), "credor_id": int(CA), "lote_id": int(LT), "onda_id": int(O2 if passada > 1 else O1),
               "id_chamada": f"rsb-{i:04d}", "canal": "agente_voz", "id_cliente": cli, "destino_hash": h,
               "resultado": res, "passada": passada, "situacao_origem": sit, "resubmit_id": int(rid) if rid else None,
               "ocorrido_em": f"{HOJE}T09:0{i}:00-03:00", "encerrada_em": f"{HOJE}T09:0{i}:30-03:00", "billsec": 0,
               "modo": "teste"})
vm("VM: grava chamadas com passada, situação de origem e resubmit_id", True,
   f"select voz_vm.gravar_chamadas('{json.dumps(CH)}')", 7)
checar("VM: a volta aponta para a decisão", True,
       f"select passada || '|' || situacao_origem || '|' || (resubmit_id = {RID}) from public.voz_chamadas "
       f"where empresa_id = {EA} and id_chamada = 'rsb-0001'", "2|nao_atendida|true")
vm("VM: resubmit_id de outra empresa é recusado", False,
   "select voz_vm.gravar_chamadas('" + json.dumps([{**CH[0], "id_chamada": "rsb-0100", "empresa_id": int(EA),
                                                     "resubmit_id": 999999999, "credor_id": None, "lote_id": None,
                                                     "onda_id": None}]) + "')")
vm("VM: não lê voz_resubmits direto (só pelas funções)", False, "select count(*) from public.voz_resubmits")
vm("VM: não chama a RPC do site (prévia)", False, f"select public.previa_reenvio_voz({LT}, array['nao_atendida'])")
vm("VM: as funções novas de voz_vm são só dela", True,
   "select count(*) from pg_proc p where p.pronamespace = 'voz_vm'::regnamespace and p.proname in ('regras_discagem', "
   "'lote_do_dia', 'registrar_onda', 'pegar_reenvio', 'concluir_reenvio', 'agregar_passadas', 'gravar_resubmits') "
   "and has_function_privilege('motorcx_voz', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') "
   "and not has_function_privilege('service_role', p.oid, 'execute')", 7)

# ------------------------------------------------------------------ R6, R7: sem contato, prévia e pedido
site("R6: sem contato no lote, por situação (cliente com CPC ou não ligar fica fora)", True,
     f"select string_agg(situacao || '=' || n, ',' order by situacao) from (select situacao, sum(numeros) n "
     f"from public.sem_contato_lote_voz({LT}) group by 1) x", U["oper"], "maquina=1,nao_atendida=1,numero_incorreto=1,ocupado=1")
site("R6: outra empresa não vê o lote", True, f"select count(*) from public.sem_contato_lote_voz({LT})", U["outra"], 0)
site("R6: prévia só com contagens", True,
     f"select public.previa_reenvio_voz({LT}, array['nao_atendida', 'ocupado', 'maquina', 'numero_incorreto']) "
     f"-> 'fora' ->> 'max_dia' || '|' || (public.previa_reenvio_voz({LT}, array['nao_atendida', 'ocupado', 'maquina', "
     f"'numero_incorreto']) -> 'fora' ->> 'inexistente')", U["oper"], "1|1")
site("R6: prévia de lote de outra empresa é recusada", False,
     f"select public.previa_reenvio_voz({LT}, array['nao_atendida'])", U["outra"], erro="lote não encontrado")
JANELA = _sv("select extract(isodow from now() at time zone 'America/Sao_Paulo') < 7 and "
             "(now() at time zone 'America/Sao_Paulo')::time between time '08:00' and "
             "(case when extract(isodow from now() at time zone 'America/Sao_Paulo') = 6 then time '13:59' else time '19:59' end)")
site("R7: sem a permissão (Planejamento) não pede", False,
     f"select public.pedir_reenvio_voz({LT}, array['maquina'])", U["plan"], erro="sem permissão")
site("R7: situação fora da lista é recusada", False, f"select public.pedir_reenvio_voz({LT}, array['cpc'])", U["oper"])
if JANELA == "t":
    site("R7: Operação pede o reenvio (com a prévia guardada)", True,
         f"select previa ->> 'volta' from public.voz_reenvios where id = public.pedir_reenvio_voz({LT}, array['maquina'], null, 'topo', false)",
         U["oper"], 1)
else:
    site("R7: fora da janela de hoje não pede", False, f"select public.pedir_reenvio_voz({LT}, array['maquina'])", U["oper"],
         erro="fora da janela")
    _sv(f"insert into public.voz_reenvios (empresa_id, credor_id, lote_id, filtros, prioridade) values ({EA}, {CA}, {LT}, "
        "'{\"resultados\": [\"maquina\"], \"ondas\": []}', 'topo')")
site("R7: ninguém grava reenvio direto", False,
     f"insert into public.voz_reenvios (empresa_id, lote_id, filtros) values ({EA}, {LT}, '{{}}')", U["admin"])
vm("VM: pega o pedido só das empresas pedidas", True, f"select voz_vm.pegar_reenvio('{{\"empresas\": [{EB}]}}')", "")
PED = sql(f"select voz_vm.pegar_reenvio('{{\"empresas\": [{EA}]}}') ->> 'id'", "motorcx_voz")[1]
vm("VM: conclui o pedido com o total real", True,
   f"select voz_vm.concluir_reenvio('{{\"reenvio\": {PED or 0}, \"situacao\": \"concluido\", \"volta_real\": 1, "
   f"\"onda\": {O2}, \"resultado\": {{\"volta\": 1}}}}'); select 1", 1)
checar("VM: pedido concluído com volta_real", True,
       f"select situacao || '|' || volta_real from public.voz_reenvios where id = {PED or 0}", "concluido|1")
vm("VM: não conclui duas vezes", False,
   f"select voz_vm.concluir_reenvio('{{\"reenvio\": {PED or 0}, \"situacao\": \"concluido\", \"volta_real\": 1}}')")

# ------------------------------------------------------------------ R9, R10: contato por passada
REGRAS = json.dumps({"contato": ["cpc", "promessa"], "curta_sempre": ["nao_atendida", "ocupado", "maquina"],
                     "curta_abandono": ["abandonada"], "segundos": 6})
vm("R9: a VM agrega o dia (idempotente)", True,
   f"select voz_vm.agregar_passadas('{{\"empresa\": {EA}, \"dia\": \"{HOJE}\", \"regras\": {REGRAS}}}'); "
   f"select voz_vm.agregar_passadas('{{\"empresa\": {EA}, \"dia\": \"{HOJE}\", \"regras\": {REGRAS}}}')", 2)
checar("R9: 1ª passada sem situação; 2ª com a situação de origem", True,
       f"select string_agg(passada || ':' || coalesce(situacao_origem, '-') || ':' || chamadas || ':' || contatos, ',' "
       f"order by passada) from public.voz_passadas_dia where empresa_id = {EA}", "1:-:6:1,2:nao_atendida:1:0")
vm("R9: regras com desfecho que não existe são recusadas", False,
   f"select voz_vm.agregar_passadas('{{\"empresa\": {EA}, \"dia\": \"{HOJE}\", \"regras\": {{\"contato\": [\"x\"]}}}}')")
site("R10: menos de 30 chamadas: taxa nula", True,
     f"select count(*) filter (where taxa is null) from public.contato_por_passada({EA}, {CA}, '{HOJE}', '{HOJE}')",
     U["oper"], 2)
_sv(f"update public.voz_passadas_dia set chamadas = 40, contatos = 4 where empresa_id = {EA} and passada = 1")
site("R10: com 30 ou mais, a taxa sai em %", True,
     f"select taxa from public.contato_por_passada({EA}, null, '{HOJE}', '{HOJE}', 'ocupado') where passada = 1",
     U["oper"], "10.00")
site("R10: o filtro de situação vale da 2ª em diante", True,
     f"select count(*) from public.contato_por_passada({EA}, null, '{HOJE}', '{HOJE}', 'ocupado')", U["oper"], 1)
site("R10: outra empresa não vê", True, f"select count(*) from public.contato_por_passada({EA}, null, '{HOJE}', '{HOJE}')",
     U["outra"], 0)

# ------------------------------------------------------------------ segurança
for t in ("regras_voz_versoes", "voz_resubmits", "voz_reenvios", "voz_passadas_dia"):
    checar(f"segurança: anon não lê {t}", False, f"select * from public.{t} limit 1", papel="anon")
checar("segurança: tabelas novas com RLS", True,
       "select count(*) from pg_tables where schemaname = 'public' and tablename in ('regras_voz_versoes', 'voz_resubmits', "
       "'voz_reenvios', 'voz_passadas_dia') and not rowsecurity", 0)
checar("segurança: nenhuma coluna nova com telefone, CPF ou nome", True,
       "select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('voz_resubmits', "
       "'voz_reenvios', 'voz_passadas_dia', 'regras_voz_versoes') and column_name ~ '(telefone|cpf|^nome|numero_discado)'", 0)
checar("segurança: funções novas com search_path fixo", True,
       "select count(*) from pg_proc where pronamespace in ('public'::regnamespace, 'voz_vm'::regnamespace) and prosecdef "
       "and proname in ('salvar_discagem', 'previa_reenvio_voz', 'pedir_reenvio_voz', 'regras_discagem_voz', 'lote_voz_do_dia', "
       "'registrar_onda_voz', 'pegar_reenvio_voz', 'concluir_reenvio_voz', 'agregar_passadas_voz', 'gravar_resubmits', "
       "'validar_resubmit_voz') and not coalesce(array_to_string(proconfig, ',') like '%search_path%', false)", 0)
checar("segurança: o site não chama as funções da VM", True,
       "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('regras_discagem_voz', "
       "'lote_voz_do_dia', 'registrar_onda_voz', 'pegar_reenvio_voz', 'concluir_reenvio_voz', 'agregar_passadas_voz') "
       "and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute'))", 0)

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
