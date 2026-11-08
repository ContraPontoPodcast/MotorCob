"""SQL 83 · Agente Voz/CX: destinos perigosos (B4), aviso de gravação e teto de retenção (B6) e identidade antes da
dívida nos textos do Speech Analytics (B7).

Cobre: a migração roda duas vezes (e a segunda não religa o aviso de quem desligou); host do tronco e da transferência
com os mesmos casos da VM (tests/dados/voz_destinos_casos.json), IP do MotorCX, mudança de endereço, linha antiga só
listada (e ainda desativável); voz_vm.enderecos_motorcx só para a VM; aviso ligado por padrão; retenção 90 (teto), prova
até 5 anos só com promessa ou contestação, gravação que vira prova depois, empresa antiga acima de 90 listada e o check
sem validar; trava de identidade com os mesmos casos de motor/trava_identidade.py, recomendação recusada, antiga que
não vira rascunho mas ainda é dispensada; checklist padrão com o item de identificação corrigido.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_voz_seguranca.py
Só dados fictícios (empresas e83-*, e-mails @exemplo.test, IPs de documentação e privados).
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
SQL83 = RAIZ / "supabase" / "migrations" / "20270119000001_voz_destinos_gravacao_identidade.sql"
HOSTS = json.loads((RAIZ / "tests" / "dados" / "voz_destinos_casos.json").read_text(encoding="utf-8"))["hosts"]
TEXTOS = json.loads((RAIZ / "tests" / "dados" / "trava_identidade_casos.json").read_text(encoding="utf-8"))["casos"]


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-c", pre + cmd], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


ok_total = falhas = 0


def checar(nome, esperado_ok, cmd, papel=None, uid=None, valor=None, erro=None):
    global ok_total, falhas
    ok, out, err = sql(cmd, papel, uid)
    passou = ok == esperado_ok and (valor is None or out == str(valor)) and (erro is None or erro in err)
    ok_total += passou
    falhas += not passou
    print(("PASSOU " if passou else "FALHOU ") + "SQL 83: " + nome
          + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def caso(nome, cond):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 83: " + nome)


def sv(cmd):
    ok, out, err = sql(cmd)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar():
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL83)], capture_output=True,
                       text=True)
    if r.returncode:
        print(r.stderr[-600:])
    return r


def q(t):
    return "'" + str(t).replace("'", "''") + "'"


r1, r2 = aplicar(), aplicar()
caso("a migração roda sem erro (duas vezes)", r1.returncode == 0 and r2.returncode == 0)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e83-a-{T}', 'E83 A {T}') returning id")
CA = sv(f"insert into public.credores (empresa_id, codigo, nome) values ({EA}, 'c83{T}', 'Carteira 83') returning id")
ADM = sv(f"insert into auth.users (email) values ('adm-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='admin', empresa_id={EA} where id='{ADM}'")


def tronco(ref, host):
    return (f"insert into public.voz_troncos (empresa_id, referencia, operadora, host, autenticacao, canais, ddd_origem, bina) "
            f"values ({EA}, '{ref}', 'Operadora Exemplo', {q(host)}, 'ip', 5, '11', '1130030000') returning id")


# ---------------------------------------------------------------- B4 · destinos
for c in HOSTS:
    checar(f"host {c['host']!r}: mesma regra da VM", True, f"select coalesce(public.voz_host_motivo({q(c['host'])}), '-')",
           "service_role", None, c["motivo"] or "-")
checar("tronco com IP público (documentação) entra", True, tronco(f"t83a{T}", "203.0.113.83") + "", "service_role")
checar("tronco com IP de metadados é recusado", False, tronco(f"t83b{T}", "169.254.169.254"), "service_role",
       erro="endereço do tronco recusado: endereço em rede interna")
checar("tronco com localhost é recusado", False, tronco(f"t83c{T}", "localhost"), "service_role", erro="nome de rede interna")
sv("insert into public.voz_enderecos_motorcx (faixa, descricao) values ('198.51.100.0/28', 'VMs de voz (teste 83)') "
   "on conflict do nothing")
checar("tronco com IP do MotorCX é recusado", False, tronco(f"t83d{T}", "198.51.100.7"), "service_role",
       erro="endereço do próprio MotorCX")
checar("mudar o endereço para a rede interna é recusado", False,
       f"update public.voz_troncos set host = '10.0.0.8' where referencia = 't83a{T}'", "service_role",
       erro="endereço do tronco recusado")
checar("transferência para rede interna é recusada", False,
       f"insert into public.voz_transferencias (empresa_id, nome, destino_sip) values ({EA}, 'Fila 83', 'sip:fila@192.168.10.2:5060')",
       "service_role", erro="destino da transferência recusado")
checar("transferência para nome público entra", True,
       f"insert into public.voz_transferencias (empresa_id, nome, destino_sip) values ({EA}, 'Fila 83', 'sip:fila@pabx.e83.exemplo.com.br') returning id",
       "service_role")
# linha antiga (de antes do SQL 83): só listada; ainda dá para desativar
LEG = sv("alter table public.voz_troncos disable trigger voz_destino_seguro; " + tronco(f"t83e{T}", "10.1.2.3")
         + "; alter table public.voz_troncos enable trigger voz_destino_seguro")
LEG = LEG.splitlines()[-1] if LEG else sv(f"select id from public.voz_troncos where referencia = 't83e{T}'")
r = aplicar()
caso("o tronco antigo com endereço interno aparece no aviso, sem ser apagado",
     r.returncode == 0 and f"ids: {LEG}" in r.stderr and "Nada foi apagado" in r.stderr
     and sv(f"select count(*) from public.voz_troncos where id = {LEG}") == "1")
checar("o tronco antigo ainda pode ser desativado", True,
       f"update public.voz_troncos set ativo = false where id = {LEG}; select ativo from public.voz_troncos where id = {LEG}",
       "service_role", None, "f")
sv(f"delete from public.voz_troncos where id = {LEG}")
checar("faixas do MotorCX: cliente não lê", False, "select * from public.voz_enderecos_motorcx", "authenticated", ADM)
checar("faixas do MotorCX: anon não lê", False, "select * from public.voz_enderecos_motorcx", "anon")
checar("faixas do MotorCX: a VM lê pela view", True,
       "select count(*) > 0 from voz_vm.enderecos_motorcx where faixa = '198.51.100.0/28'", "motorcx_voz", None, "t")
sv("delete from public.voz_enderecos_motorcx where faixa = '198.51.100.0/28'")

# ---------------------------------------------------------------- B6 · aviso e retenção
checar("aviso de gravação ligado por padrão", True,
       f"insert into public.voz_config (empresa_id) values ({EA}) on conflict do nothing; "
       f"select aviso_gravacao || '|' || retencao_dias || '|' || retencao_prova_dias from public.voz_config where empresa_id = {EA}",
       "service_role", None, "true|90|90")
sv(f"update public.voz_config set aviso_gravacao = false where empresa_id = {EA}")
aplicar()
checar("rodar de novo não religa o aviso de quem desligou", True,
       f"select aviso_gravacao from public.voz_config where empresa_id = {EA}", "service_role", None, "f")
checar("retenção acima de 90 é recusada (check)", False,
       f"update public.voz_config set retencao_dias = 120 where empresa_id = {EA}", "service_role")
checar("retenção acima de 90 é recusada (Admin)", False,
       f"select public.configurar_voz_empresa({EA}, '{{\"retencao_dias\": 365}}')", "authenticated", ADM, erro="teto")
checar("prova acima de 5 anos é recusada", False,
       f"select public.configurar_voz_empresa({EA}, '{{\"retencao_prova_dias\": 1826}}')", "authenticated", ADM)
checar("Admin põe a prova em 5 anos", True,
       f"select public.configurar_voz_empresa({EA}, '{{\"retencao_prova_dias\": 1825}}'); "
       f"select retencao_prova_dias from public.voz_config where empresa_id = {EA}", "authenticated", ADM, 1825)
H64 = "b" * 64


def chamada(idc, resultado="null"):
    return sv(f"insert into public.voz_chamadas (empresa_id, credor_id, id_chamada, id_cliente, id_acao, destino_mascara, "
              f"destino_hash, modo, ocorrido_em, atendida_em, encerrada_em, billsec, resultado) values ({EA}, {CA}, "
              f"'{idc}', 'CLI-83', 'A83', '(11) ••••-••83', '{H64}', 'teste', now(), now(), now(), 30, {resultado}) "
              f"returning id")


def gravacao(ch, nome, expira="null"):
    return sv(f"insert into public.voz_gravacoes (empresa_id, credor_id, chamada_id, id_cliente, origem, caminho, gravada_em, "
              f"expira_em) values ({EA}, {CA}, {ch}, 'CLI-83', 'ia', 'credor_0/e83/{nome}.wav', now(), {expira}) returning id")


DIAS = "select prova || '|' || extract(day from expira_em - gravada_em)::int from public.voz_gravacoes where id = "
CH_P = chamada(f"e83p{T}", "'promessa'")
G_P = gravacao(CH_P, f"p{T}")
checar("gravação com promessa guarda pela retenção de prova", True, DIAS + G_P, "service_role", None, "promessa|1825")
CH_N = chamada(f"e83n{T}", "'recusa'")
G_N = gravacao(CH_N, f"n{T}", "now() + interval '10 years'")
checar("gravação sem prova fica no teto de 90, mesmo pedindo mais", True,
       f"select coalesce(prova, '-') || '|' || extract(day from expira_em - gravada_em)::int from public.voz_gravacoes where id = {G_N}",
       "service_role", None, "-|90")
sv(f"insert into public.voz_analise_chamadas (empresa_id, credor_id, chamada_id, gravacao_id, origem, dia, situacao, codigos) "
   f"values ({EA}, {CA}, {CH_N}, {G_N}, 'ia', current_date, 'ok', '{{\"motivo\": \"nao_reconhece\"}}')")
checar("a análise acha contestação: a gravação vira prova", True, DIAS + G_N, "service_role", None, "contestacao|1825")
CH_L = chamada(f"e83l{T}")
G_L = gravacao(CH_L, f"l{T}")
sv(f"update public.voz_chamadas set resultado = 'promessa' where id = {CH_L}")
checar("a chamada vira promessa depois: a gravação acompanha", True, DIAS + G_L, "service_role", None, "promessa|1825")
# empresa antiga com retenção acima de 90: listada, check sem validar, nada apagado
sv(f"alter table public.voz_config drop constraint voz_config_retencao_dias_check; "
   f"update public.voz_config set retencao_dias = 365 where empresa_id = {EA}")
r = aplicar()
caso("empresa com retenção acima de 90 aparece no aviso", r.returncode == 0 and f"empresas: {EA}" in r.stderr
     and "Nada foi apagado" in r.stderr)
checar("o check entra sem validar enquanto houver empresa acima de 90", True,
       "select convalidated from pg_constraint where conname = 'voz_config_retencao_dias_check'", "service_role", None, "f")
checar("gravação nova dessa empresa já sai com o teto", True,
       f"select extract(day from expira_em - gravada_em)::int from public.voz_gravacoes where id = {gravacao(chamada(f'e83x{T}'), f'x{T}')}",
       "service_role", None, 90)
checar("Admin salva 90 e a empresa volta ao normal", True,
       f"select public.configurar_voz_empresa({EA}, '{{\"retencao_dias\": 90}}'); "
       f"select retencao_dias from public.voz_config where empresa_id = {EA}", "authenticated", ADM, 90)
aplicar()
checar("sem empresa acima de 90, o check volta validado", True,
       "select convalidated from pg_constraint where conname = 'voz_config_retencao_dias_check'", "service_role", None, "t")

# ---------------------------------------------------------------- B7 · identidade antes da dívida
for c in TEXTOS:
    checar(f"trava: {c['texto'][:50]!r}", True, f"select public.texto_revela_antes_identidade({q(c['texto'])})",
           "service_role", None, "t" if c["revela"] else "f")
EV = '{"n_a": 300, "n_b": 300, "pct_a": 30, "pct_b": 20}'
checar("recomendação que sugere o credor na abertura é recusada", False,
       f"select public.registrar_recomendacao_voz({EA}, {CA}, 'frases', 'frase_converte', 'frases:e83a', "
       f"'Abrir a conversa com o nome do credor', '', '{EV}', '{{}}')", "service_role", erro="antes de confirmar a identidade")
checar("frase proposta que cumprimenta e diz a dívida é recusada", False,
       f"select public.registrar_recomendacao_voz({EA}, {CA}, 'frases', 'frase_converte', 'frases:e83b', "
       f"'Frase de abertura', '', '{EV}', '{{\"texto\": \"Bom dia! Posso falar sobre o seu contrato?\"}}')", "service_role")
checar("recomendação com o credor DEPOIS da confirmação entra", True,
       f"select public.registrar_recomendacao_voz({EA}, {CA}, 'regua', 'horario', 'regua:e83c', 'Confirmar a identidade mais cedo', "
       f"'Confirme a identidade mais cedo e diga o nome do credor logo depois da confirmação.', '{EV}', '{{}}') is not null",
       "service_role", None, "t")
REC = sv(f"alter table public.recomendacoes disable trigger trava_identidade_recomendacao; "
         f"insert into public.recomendacoes (empresa_id, credor_id, destino, regra, chave, titulo, evidencia, proposta) "
         f"values ({EA}, {CA}, 'frases', 'frase_converte', 'frases:e83d', 'Abrir com o nome do credor', '{EV}', "
         f"'{{\"texto\": \"Olá, aqui é a central em nome de {{{{credor}}}}.\", \"canal\": \"agente_voz\"}}') returning id; "
         f"alter table public.recomendacoes enable trigger trava_identidade_recomendacao")
REC = REC.splitlines()[-1] if REC else sv("select max(id) from public.recomendacoes where chave = 'frases:e83d'")
r = aplicar()
caso("a recomendação antiga aparece no aviso, sem ser apagada", f"ids: {REC}" in r.stderr
     and sv(f"select count(*) from public.recomendacoes where id = {REC}") == "1")
checar("a antiga não vira rascunho (Aplicar recusa)", False, f"select public.aplicar_recomendacao({REC})",
       "authenticated", ADM, erro="antes de confirmar a identidade")
checar("e nenhuma frase foi criada", True,
       f"select count(*) from public.frases where empresa_id = {EA}", "service_role", None, 0)
checar("a antiga ainda pode ser dispensada", True,
       f"select public.dispensar_recomendacao({REC}); select situacao from public.recomendacoes where id = {REC}",
       "authenticated", ADM, "dispensada")
checar("checklist padrão em uso sem 'motivo da ligação' antes da identidade", True,
       "select count(*) from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id "
       "where c.empresa_id is null and v.situacao = 'em_uso' and v.itens::text ilike '%motivo da liga%' "
       "and not v.itens::text ilike '%só disse o motivo depois de confirmar o titular%'", "service_role", None, 0)
checar("o padrão segue com uma versão em uso só", True,
       "select count(*) from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id "
       "where c.empresa_id is null and v.situacao = 'em_uso'", "service_role", None, 1)
checar("anon não chama as funções novas", False, "select public.texto_revela_antes_identidade('x')", "anon")
checar("anon não chama voz_host_motivo", False, "select public.voz_host_motivo('x')", "anon")

print(f"\nSQL 83: {ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
