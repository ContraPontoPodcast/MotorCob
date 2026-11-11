"""SQL 128 · Agente de voz por minuto falado: limite de conversas na divisão do teto global (PR 7).

Cobre: a migração roda duas vezes (e por cima do SQL 101 rodado de novo); a mesma assinatura da divisão; empresa por
minuto entra com o limite de conversas como demanda (motivo 'por_minuto', pico desligado, teto = limite); tronco menor
limita; overbooking proporcional junto com as licenças; o contrato por minuto ganha da licença; legado divide a sobra;
licença por minuto agendada para o próximo ciclo ainda não vale; voz_vm.config com pico 1 no por minuto.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_divisao_minuto.py
Só dados fictícios (empresas e128-*).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
MIG = RAIZ / "supabase" / "migrations"
SQL128 = MIG / "20270326000001_voz_divisao_por_minuto.sql"
SQL101 = MIG / "20270214000001_voz_licencas_divisao.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 128: " + nome
          + ("" if passou else f"  -> ok={ok} out={out[:300]!r} err={err[:300]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def rodar(arq, nome):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(arq)], capture_output=True, text=True)
    checar(nome, True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


ASSINATURA = sv("select pg_get_function_result('public.divisao_concorrencia_voz()'::regprocedure)")
rodar(SQL128, "a migração roda sem erro (vez 1)")
rodar(SQL128, "a migração roda sem erro (vez 2)")
rodar(SQL101, "o SQL 101 roda de novo por cima")
rodar(SQL128, "e este de novo depois dele")
checar("a divisão mantém a assinatura", True,
       "select pg_get_function_result('public.divisao_concorrencia_voz()'::regprocedure)", valor=ASSINATURA)

T = uuid.uuid4().hex[:6]
E = {}
for k in ("p", "l", "g", "q"):
    E[k] = sv(f"insert into public.empresas (slug, nome) values ('e128-{k}-{T}', 'E128 {k.upper()} {T}') returning id")
LETRA = "split_part(x.slug, '-', 2)"


def cenario(n, emps, consulta=None):
    """Transação desfeita: só estas empresas têm tronco, licença ou contrato.
    emps: letra -> (canais, robôs ou None, limite por minuto ou None, pico, contrato no futuro?)."""
    s = ["begin;", "set session_replication_role = replica;",
         "update public.voz_troncos set ativo = false where ativo;", "delete from public.voz_licencas;",
         "delete from public.voz_cobranca_ia;", f"update public.voz_contrato set concorrencia_contratada = {n};"]
    for k, (canais, robos, limite, pico, futuro) in emps.items():
        s.append(f"insert into public.voz_config (empresa_id, provedor, modo, pico_multiplo) values ({E[k]}, 'simulador', "
                 f"'simulado', {pico}) on conflict (empresa_id) do update set pico_multiplo = {pico};")
        if canais:
            s.append(f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, ddd_origem, "
                     f"bina, canais) values ({E[k]}, 'e128-{k}-{T}', 'Operadora Exemplo', '203.0.113.42', 'ip', '11', "
                     f"'1130040000', {canais});")
        if robos is not None:
            s.append(f"insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, vigente_desde, motivo) "
                     f"values ({E[k]}, {robos}, 'por_robo', 6000, public.hoje_sp(), 'Contrato de teste.');")
        if limite is not None:
            s.append(f"insert into public.voz_cobranca_ia (empresa_id, modelo, limite_conversas, vigente_desde, motivo) "
                     f"values ({E[k]}, 'por_minuto', {limite}, now() {'+' if futuro else '-'} interval '1 day', 'Contrato de teste.');")
    s.append("set session_replication_role = origin; set local role service_role;")
    s.append(consulta or (
        f"select string_agg({LETRA} || '=' || d.limite || ':' || d.motivo || ':' || d.teto || ':' || coalesce(d.licencas::text, '-'), "
        f"',' order by {LETRA}) from public.voz_divisao_concorrencia d join public.empresas x on x.id = d.empresa_id;"))
    s.append("rollback;")
    return " ".join(s)


checar("cabe: por minuto com o limite (pico desligado: teto = limite), licença e o legado com a sobra", True,
       cenario(20, {"p": (10, None, 4, 3, False), "l": (10, 5, None, 1, False), "g": (10, None, None, 2, False)}),
       valor="g=10:legado:10:-,l=5:licencas:5:5,p=4:por_minuto:4:4")
checar("tronco menor limita o por minuto", True,
       cenario(20, {"p": (3, None, 6, 1, False)}), valor="p=3:tronco:3:6")
checar("overbooking: por minuto e licença proporcionais, o legado fica com zero", True,
       cenario(6, {"p": (10, None, 6, 1, False), "l": (10, 6, None, 1, False), "g": (10, None, None, 1, False)}),
       valor="g=0:legado:0:-,l=3:teto:3:6,p=3:teto:3:6")
checar("o contrato por minuto ganha da licença (P8)", True,
       cenario(20, {"q": (10, 8, 2, 1, False)}), valor="q=2:por_minuto:2:2")
checar("contrato por minuto agendado ainda não vale (segue a licença)", True,
       cenario(20, {"q": (10, 8, 2, 1, True)}), valor="q=8:licencas:8:8")
checar("voz_vm.config: pico 1 para quem está no por minuto", True,
       cenario(20, {"p": (10, None, 4, 3, False), "g": (10, None, None, 3, False)},
               f"reset role; select string_agg({LETRA} || '=' || c.pico_multiplo, ',' order by {LETRA}) from voz_vm.config c "
               f"join public.empresas x on x.id = c.empresa_id where x.id in ({E['p']}, {E['g']});"),
       valor="g=3,p=1")
checar("a VM continua lendo a divisão e o config", True,
       "select has_table_privilege('motorcx_voz', 'voz_vm.config', 'select') "
       "and has_table_privilege('motorcx_voz', 'voz_vm.divisao_concorrencia', 'select')", valor="t")
checar("o site não lê voz_vm.config", True, "select has_table_privilege('authenticated', 'voz_vm.config', 'select')",
       valor="f")

checar("a equipe lê a cadência padrão (tela da Contratação); a policy segue só para a equipe", True,
       "select has_column_privilege('authenticated', 'public.voz_contrato', 'cadencia_ia_padrao', 'select')", valor="t")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
