"""SQL 75 · Trocar e excluir a estratégia do segmento; nome legível da estratégia criada.

Cobre: separar_estrategia com o nome inteiro da carteira (sem "Carteira princip"); criar_estrategia_segmento com o nome
da tela ("<Modelo> · <Segmento>") e " (2)" só quando já existe; "Trocar" (segmentos_carteira.estrategia_id = null) só
para quem edita a orquestração, com auditoria; usos_estrategia (outro segmento × carteira, Demais clientes, padrão);
excluir_estrategia recusa quando vale em outro lugar (e diz onde), apaga quando não vale, desvincula este segmento na
mesma transação e fica na auditoria; operação e outra empresa não excluem. Aplica o SQL 75 duas vezes.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_estrategia_trocar.py
Só dados fictícios (empresas e75-*, e-mails @exemplo.test).
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
BANCO = os.environ.get("PGDATABASE", "sb")
BASE = ["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-Atq"]
SQL75 = RAIZ / "supabase" / "migrations" / "20270111000001_estrategia_trocar_excluir.sql"


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
    print(("PASSOU " if passou else "FALHOU ") + "SQL 75: " + nome
          + ("" if passou else f"  -> ok={ok} out={out!r} err={err[:240]}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:400])
    return out


def aplicar(vez):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL75)], capture_output=True,
                       text=True)
    checar(f"a migração roda sem erro (vez {vez})", True, f"select {r.returncode}", valor=0)
    if r.returncode:
        print(r.stderr[-400:])


aplicar(1)
aplicar(2)

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e75-a-{T}', 'E75 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e75-b-{T}', 'E75 B {T}') returning id")
U = {}
for p in ("plan", "oper", "planb"):
    U[p] = sv(f"insert into auth.users (email) values ('{p}-{T}@exemplo.test') returning id")
sv(f"update public.perfis set papel='planejamento', empresa_id={EA} where id='{U['plan']}'")
sv(f"update public.perfis set papel='operacao', empresa_id={EA} where id='{U['oper']}'")
sv(f"update public.perfis set papel='planejamento', empresa_id={EB} where id='{U['planb']}'")


def credor(emp, codigo, nome):
    return sv(f"insert into public.credores (empresa_id, codigo, nome) values ({emp}, '{codigo}', '{nome}') "
              f"on conflict (empresa_id, codigo) do update set nome = excluded.nome returning id")


CP = credor(EA, f"cp{T}", "Carteira principal")
CX = credor(EA, f"cx{T}", "Banco X")
SEG = sv(f"insert into public.clusters (empresa_id, ordem, codigo, nome) values ({EA}, 75, 'T75', 'teste') returning id")
SEG2 = sv(f"insert into public.clusters (empresa_id, ordem, codigo, nome) values ({EA}, 76, 'U75', 'outro') returning id")
for s in (SEG, SEG2):
    for c in (CP, CX):
        sv(f"insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo) values ({EA}, {s}, {c}, true)")
P = ("authenticated", U["plan"])
DEF = "'{\"localizacao\": {\"ativo\": true}, \"cpc\": {\"ativo\": true}}'::jsonb"

# ------------------------------------------------------------------ nomes
NOVA = sv(f"select public.separar_estrategia({SEG}, {CP}, {DEF})", *P)
checar("a cópia leva o nome inteiro da carteira (sem 'Carteira princip')", True,
       f"select nome from public.estrategias where id = {NOVA}", *P, valor="teste · Carteira principal")
sv(f"update public.segmentos_carteira set estrategia_id = null where cluster_id = {SEG} and credor_id = {CP}", *P)
M1 = sv(f"select public.criar_estrategia_segmento({SEG}, {CP}, {DEF}, 'Estágios clássicos · teste')", *P)
checar("criar do modelo: nome '<Modelo> · <Segmento>'", True,
       f"select nome from public.estrategias where id = {M1}", *P, valor="Estágios clássicos · teste")
checar("criar do modelo: vira a estratégia própria desta carteira", True,
       f"select estrategia_id = {M1} and estrategia_propria from public.segmentos_em_uso "
       f"where cluster_id = {SEG} and credor_id = {CP}", *P, valor="t")
checar("operação não cria a estratégia do segmento", False,
       f"select public.criar_estrategia_segmento({SEG}, {CX}, {DEF}, 'x')", "authenticated", U["oper"])
checar("criar sem definição é recusado", False,
       f"select public.criar_estrategia_segmento({SEG}, {CX}, null, 'x')", *P, erro="definição")

# ------------------------------------------------------------------ trocar
checar("operação não troca a estratégia (RLS)", True,
       f"with x as (update public.segmentos_carteira set estrategia_id = null where cluster_id = {SEG} and credor_id = {CP} "
       f"returning 1) select count(*) from x", "authenticated", U["oper"], valor=0)
checar("trocar: tira a estratégia deste segmento × carteira", True,
       f"update public.segmentos_carteira set estrategia_id = null where cluster_id = {SEG} and credor_id = {CP}; "
       f"select estrategia_id is null and not estrategia_propria from public.segmentos_em_uso "
       f"where cluster_id = {SEG} and credor_id = {CP}", *P, valor="t")
checar("trocar: a estratégia continua na empresa", True,
       f"select count(*) from public.estrategias where id = {M1}", *P, valor=1)
checar("trocar: fica na auditoria", True,
       f"select count(*) > 0 from public.auditoria where tabela = 'segmentos_carteira' and acao = 'UPDATE' "
       f"and empresa_id = {EA}", valor="t")
M2 = sv(f"select public.criar_estrategia_segmento({SEG}, {CP}, {DEF}, 'Estágios clássicos · teste')", *P)
checar("mesmo nome de novo: ganha ' (2)'", True,
       f"select nome from public.estrategias where id = {M2}", *P, valor="Estágios clássicos · teste (2)")

# ------------------------------------------------------------------ usos e excluir
checar("usos: estratégia sem outro uso não tem linhas", True,
       f"select count(*) from public.usos_estrategia({M2}, {SEG}, {CP})", *P, valor=0)
sv(f"update public.segmentos_carteira set estrategia_id = {M2} where cluster_id = {SEG2} and credor_id = {CX}", *P)
checar("usos: outro segmento × carteira aparece pelo nome", True,
       f"select string_agg(onde, '; ') from public.usos_estrategia({M2}, {SEG}, {CP})", *P,
       valor="Segmento outro · carteira Banco X")
checar("excluir em uso em outro lugar é recusado e diz onde", False,
       f"select public.excluir_estrategia({M2}, {SEG}, {CP})", *P, erro="Segmento outro · carteira Banco X")
checar("recusado: nada mudou neste segmento", True,
       f"select estrategia_id = {M2} from public.segmentos_em_uso where cluster_id = {SEG} and credor_id = {CP}", *P,
       valor="t")
sv(f"update public.segmentos_carteira set estrategia_id = null where cluster_id = {SEG2} and credor_id = {CX}", *P)
sv(f"update public.credores set estrategia_id = {M1} where id = {CX}")
checar("usos: Demais clientes de uma carteira", True,
       f"select string_agg(onde, '; ') from public.usos_estrategia({M1})", *P, valor="Demais clientes · carteira Banco X")
checar("excluir a dos Demais clientes é recusado", False, f"select public.excluir_estrategia({M1})", *P,
       erro="Demais clientes")
sv(f"update public.credores set estrategia_id = null where id = {CX}")
checar("operação não exclui", False, f"select public.excluir_estrategia({M2}, {SEG}, {CP})", "authenticated", U["oper"])
checar("outra empresa não exclui", False, f"select public.excluir_estrategia({M2}, {SEG}, {CP})", "authenticated",
       U["planb"])
checar("excluir: apaga e o segmento volta às três opções", True,
       f"select public.excluir_estrategia({M2}, {SEG}, {CP}); "
       f"select (select count(*) from public.estrategias where id = {M2}) = 0 and estrategia_id is null "
       f"from public.segmentos_em_uso where cluster_id = {SEG} and credor_id = {CP}", *P, valor="t")
checar("excluir: fica na auditoria", True,
       f"select count(*) from public.auditoria where tabela = 'estrategias' and acao = 'DELETE' and registro = '{M2}'",
       valor=1)
checar("excluir a estratégia que já foi trocada (sem segmento) também funciona", True,
       f"select public.excluir_estrategia({M1}); select count(*) from public.estrategias where id = {M1}", *P, valor=0)
PAD = sv(f"insert into public.estrategias (empresa_id, nome, definicao, padrao) values ({EA}, 'Padrão {T}', '{{}}', true) "
         f"returning id")
checar("a padrão da empresa não é excluída", False, f"select public.excluir_estrategia({PAD})", *P,
       erro="Padrão da empresa")
checar("anônimo não chama", False, f"select public.usos_estrategia({PAD})", "anon")

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
