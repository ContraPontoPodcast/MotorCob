"""SQL 104 · Telefonia, PR T2: IPs da operadora por tronco e firewall das VMs a partir do cadastro.

Cobre: a migração roda duas vezes; a regra dos IPs (a mesma de voz/firewall.py: IPv4, até /24, nunca 0.0.0.0/0, rede
interna ou do MotorCX, até 20) no gatilho e na RPC; normalização (1.2.3.4 → /32, host bits zerados, sem repetição);
quem grava a lista (pode_configurar_telefonia) e quem libera (só a equipe com gerenciar_troncos_voz e aal2); aviso
para a equipe; tirar IP vale na hora; origens_firewall_voz só para o servidor e a VM, só o liberado que ainda está na
lista e só de tronco/transferência ativo; registro do firewall só pela VM; o cliente não lê os eventos.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_firewall.py
Só dados fictícios (empresas e104-*, e-mails @exemplo.test, IPs de documentação e faixas fictícias).
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
SQL = RAIZ / "supabase" / "migrations" / "20270217000001_voz_firewall.sql"
ROTULO = "SQL 104: "


def sql(cmd, papel=None, uid=None, aal=None):
    pre = ""
    base = BASE
    if papel == "motorcx_voz":          # login de verdade (session_user = motorcx_voz), como a VM
        base, papel = BASE + ["-U", "motorcx_voz"], None
    if papel:
        pre = f"set role {papel}; "
        if uid:
            claims = json.dumps({"sub": uid, "role": papel, **({"aal": aal} if aal else {})})
            pre += (f"select set_config('request.jwt.claim.sub', '{uid}', false); "
                    f"select set_config('request.jwt.claims', '{claims}', false); ")
    r = subprocess.run(base + ["-c", pre + cmd], capture_output=True, text=True)
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
if os.environ.get("PGPASSWORD"):      # CI: login com senha (scram) também para o papel da VM
    sv("alter role motorcx_voz with password '" + os.environ["PGPASSWORD"].replace("'", "''") + "'")
caso("a migração roda sem erro (duas vezes)", r1.returncode == 0 and r2.returncode == 0)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e104-a-{T}', 'E104 A {T}') returning id")
TEC = sv(f"insert into auth.users (email) values ('tec-{T}@exemplo.test') returning id")
SUP = sv(f"insert into auth.users (email) values ('sup-{T}@exemplo.test') returning id")
ADM = sv(f"insert into auth.users (email) values ('adm-{T}@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=true, empresa_id=null, equipe_alcance='todas' where id='{TEC}'")
sv(f"update public.perfis set equipe=true, papel='operacao', equipe_tecnico=false, empresa_id=null, equipe_alcance='todas' where id='{SUP}'")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{ADM}'")
TR = sv(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, canais, ddd_origem, bina) "
        f"values ({EA}, 'tr104-{T}', 'Operadora Exemplo', '203.0.113.104', 'ip', 5, '11', '1130030000') returning id")
TF = sv(f"insert into public.voz_transferencias (empresa_id, nome, destino_sip, metodo) "
        f"values ({EA}, 'Fila 104', 'sip:fila@pabx.e104.exemplo.com.br', 'refer') returning id")

# ---------------------------------------------------------------- regra dos IPs (mesmos casos de tests/test_voz_firewall.py)
CASOS = {"200.160.10.5/32": None, "200.160.10.0/24": None,
         "200.160.0.0/16": "faixa grande demais: no máximo /24 (256 endereços)",
         "0.0.0.0/0": "faixa grande demais: no máximo /24 (256 endereços)",
         "10.1.2.3/32": "endereço em rede interna, reservada ou de loopback",
         "192.168.0.0/24": "endereço em rede interna, reservada ou de loopback",
         "127.0.0.1/32": "endereço em rede interna, reservada ou de loopback",
         "169.254.169.254/32": "endereço em rede interna, reservada ou de loopback",
         "2001:db8::1/128": "só IPv4"}
for faixa, motivo in CASOS.items():
    checar(f"{faixa}: {motivo or 'aceito'}", True, f"select coalesce(public.voz_ips_motivo(array['{faixa}']::cidr[]), '-')",
           None, None, motivo or "-")
checar("mais de 20 itens é recusado", True,
       "select public.voz_ips_motivo(array(select ('200.1.1.' || g || '/32')::cidr from generate_series(1, 21) g))",
       None, None, "no máximo 20 IPs ou faixas")
sv("insert into public.voz_enderecos_motorcx (faixa, descricao) values ('198.51.100.0/28', 'VMs de voz (teste 104)') "
   "on conflict do nothing")
checar("IP do MotorCX é recusado", True, "select public.voz_ips_motivo(array['198.51.100.7/32']::cidr[])", None, None,
       "endereço do próprio MotorCX")
checar("normaliza: IP solto vira /32, bits de host zerados, sem repetição, em ordem", True,
       "select public.normalizar_ips_voz(array[' 200.161.1.9/24', '200.160.20.1', '200.160.20.1/32', ''])::text",
       None, None, "{200.160.20.1/32,200.161.1.0/24}")
checar("texto que não é IP é recusado com a frase", False, "select public.normalizar_ips_voz(array['sbc.operadora.com'])",
       erro="IP inválido")
checar("o gatilho barra a lista ruim mesmo direto na tabela", False,
       f"update public.voz_troncos set ips_operadora = '{{10.0.0.0/24}}' where id = {TR}", erro="IPs da operadora recusados")

# ---------------------------------------------------------------- gravar a lista (pode_configurar_telefonia)
DEF = f"select public.definir_ips_voz('tronco', {TR}, array['200.161.1.0/24', '200.160.20.1'])::text"
checar("Admin do cliente ainda não grava a lista (abre no PR T3)", False, DEF, "authenticated", ADM, aal="aal2",
       erro="não encontrado")
checar("equipe sem gerenciar_troncos_voz não grava", False, DEF, "authenticated", SUP, aal="aal2", erro="não encontrado")
checar("Técnico grava a lista e recebe o que falta liberar", True, DEF, "authenticated", TEC,
       "{200.160.20.1/32,200.161.1.0/24}")
sql(DEF, "authenticated", TEC)
checar("a equipe recebe aviso no sino (uma vez por lista)", True,
       f"select count(*) from public.avisos where chave like 'firewall_voz:tronco:{TR}:%' and para = 'equipe'", None, None, 1)
checar("lista com rede interna é recusada pela RPC", False,
       f"select public.definir_ips_voz('tronco', {TR}, array['192.168.1.1'])", "authenticated", TEC,
       erro="IPs da operadora recusados")
checar("tipo inválido é recusado", False, f"select public.definir_ips_voz('rota', {TR}, array['200.1.1.1'])",
       "authenticated", TEC, erro="tipo inválido")
checar("Técnico vê o que está pendente", True,
       f"select pendentes::text from public.ips_voz_pendentes() where tipo = 'tronco' and id = {TR}", "authenticated", TEC,
       "{200.160.20.1/32,200.161.1.0/24}")
checar("cliente não vê a lista de pendentes da equipe", True,
       f"select count(*) from public.ips_voz_pendentes()", "authenticated", ADM, 0)

# ---------------------------------------------------------------- nada no firewall antes da liberação
ORI = "select coalesce(string_agg(origem::text, ',' order by origem), '-') from public.origens_firewall_voz()"
checar("antes de liberar, nada entra no firewall", True,
       f"select count(*) from public.origens_firewall_voz() where empresa_id = {EA}", "service_role", None, 0)
checar("o site não lê as origens do firewall", False, ORI, "authenticated", TEC, aal="aal2")

# ---------------------------------------------------------------- liberar (equipe + aal2)
LIB = f"select public.liberar_ips_voz('tronco', {TR})"
checar("Técnico sem a verificação em duas etapas não libera", False, LIB, "authenticated", TEC, aal="aal1",
       erro="verificação em duas etapas")
checar("Admin do cliente não libera (é o segundo passo, da equipe)", False, LIB, "authenticated", ADM, aal="aal2",
       erro="só a equipe MotorCX")
checar("Técnico com aal2 libera a lista atual", True, LIB, "authenticated", TEC, 2, aal="aal2")
checar("quem e quando ficam registrados", True,
       f"select (ips_liberados_por = '{TEC}') || '|' || (ips_liberados_em is not null) from public.voz_troncos where id={TR}",
       None, None, "true|true")
checar("depois de liberar, entram no firewall", True,
       f"select string_agg(origem::text, ',' order by origem) from public.origens_firewall_voz() where empresa_id = {EA}",
       "service_role", None, "200.160.20.1/32,200.161.1.0/24")
checar("nada mais pendente", True, f"select count(*) from public.ips_voz_pendentes() where id = {TR}",
       "authenticated", TEC, 0)

# ---------------------------------------------------------------- tirar vale na hora; incluir espera a equipe
checar("trocar a lista devolve só o IP novo como pendente", True,
       f"select public.definir_ips_voz('tronco', {TR}, array['200.161.1.0/24', '200.170.0.1'])::text",
       "authenticated", TEC, "{200.170.0.1/32}")
checar("tirar um IP tira também do firewall, na hora, e o novo espera a liberação", True,
       f"select string_agg(origem::text, ',' order by origem) from public.origens_firewall_voz() where empresa_id = {EA}",
       "service_role", None, "200.161.1.0/24")
checar("tronco desativado sai do firewall", True,
       f"update public.voz_troncos set ativo = false where id = {TR}; set role service_role; "
       f"select count(*) from public.origens_firewall_voz() where empresa_id = {EA}", None, None, 0)
sv(f"update public.voz_troncos set ativo = true where id = {TR}")

# ---------------------------------------------------------------- transferência (IPs do PABX)
checar("transferência: grava e libera os IPs do PABX", True,
       f"select public.definir_ips_voz('transferencia', {TF}, array['200.180.1.10']); "
       f"select public.liberar_ips_voz('transferencia', {TF})", "authenticated", TEC, 1, aal="aal2")
checar("transferência entra no firewall", True,
       f"select count(*) from public.origens_firewall_voz() where tipo = 'transferencia' and ref_id = {TF}",
       "service_role", None, 1)

# ---------------------------------------------------------------- VM: origens e registro
checar("a VM lê as origens pelo voz_vm", True,
       f"select jsonb_array_length(voz_vm.origens_firewall('{{}}')) >= 2", "motorcx_voz", None, "t")
checar("a VM registra a mudança do firewall", True,
       "select voz_vm.registrar_firewall('{\"evento\": {\"vm\": \"motorcx-ast-1\", \"origens\": 2, "
       "\"adicionadas\": [\"200.161.1.0/24\"], \"removidas\": [], \"ok\": true, \"detalhe\": null}}') is not null",
       "motorcx_voz", None, "t")
checar("o servidor também registra (modo chave)", True,
       "select public.registrar_firewall_voz('{\"vm\": \"motorcx-ast-2\", \"origens\": 0, \"ok\": false, "
       "\"detalhe\": \"teste\"}') is not null", "service_role", None, "t")
checar("evento com chave estranha é recusado", False,
       "select public.registrar_firewall_voz('{\"vm\": \"x\", \"origens\": 0, \"ok\": true, \"senha\": \"x\"}')",
       "service_role", erro="evento: só")
checar("o site não registra o firewall", False,
       "select public.registrar_firewall_voz('{\"vm\": \"x\", \"origens\": 0, \"ok\": true}')", "authenticated", TEC)
checar("Técnico lê os eventos do firewall", True, "select count(*) >= 2 from public.voz_firewall_eventos",
       "authenticated", TEC, "t")
checar("cliente não lê os eventos do firewall", True, "select count(*) from public.voz_firewall_eventos",
       "authenticated", ADM, 0)
checar("anon não lê os eventos", False, "select * from public.voz_firewall_eventos", "anon")
checar("a VM não executa as RPCs do site (definir/liberar)", True,
       "select has_function_privilege('motorcx_voz', 'public.definir_ips_voz(text, bigint, text[])', 'execute') "
       "or has_function_privilege('motorcx_voz', 'public.liberar_ips_voz(text, bigint)', 'execute')", None, None, "f")

sv(f"delete from public.voz_transferencias where empresa_id = {EA}; delete from public.voz_troncos where empresa_id = {EA}; "
   "delete from public.voz_enderecos_motorcx where descricao = 'VMs de voz (teste 104)'")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
