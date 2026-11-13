"""SQL 132 · Agente de voz: a tela "Ofertas da carteira" (painel_ofertas_voz).

Cobre: a migração roda duas vezes; sem configuração: config null, API pelo 1º "Buscar ofertas" ativo, sem dados; com
chamadas: % que respondeu, tempo médio, p95, falhas por tipo; 3 falhas seguidas em 5 min = instável; 6+ falhas sem
resposta boa em 15 min = fora; uso das fontes das últimas 24 h (reserva, API pulada, descartes por motivo); a última
carga (só contagens); a alçada; quem pode ativar (Admin do cliente) e rascunho (equipe); outra empresa não lê; e nada
de cliente nem valor de oferta na resposta.

Chamado pelo testar_rls.py no fim; também roda só:
    PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=sb python supabase/testes/testar_ofertas_painel.py
Só dados fictícios (empresas e132-*).
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
SQL132 = RAIZ / "supabase" / "migrations" / "20270329000001_voz_ofertas_painel.sql"
ok_total = falhas = 0


def sql(cmd, papel=None, uid=None):
    pre = ""
    if papel:
        pre = f"set role {papel}; " + (f"select set_config('request.jwt.claim.sub', '{uid}', false); " if uid else "")
    r = subprocess.run(BASE + ["-f", "-"], input=pre + cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()


def afirmar(nome, cond, detalhe=""):
    global ok_total, falhas
    ok_total += bool(cond)
    falhas += not cond
    print(("PASSOU " if cond else "FALHOU ") + "SQL 132: " + nome + ("" if cond else f"  -> {detalhe}"))


def sv(cmd, papel=None, uid=None):
    ok, out, err = sql(cmd, papel, uid)
    if not ok:
        raise RuntimeError(err[:600])
    return out


def j(x):
    return json.dumps(x).replace("'", "''")


for vez in (1, 2):
    r = subprocess.run(["psql", "-d", BANCO, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(SQL132)], capture_output=True, text=True)
    afirmar(f"a migração roda sem erro (vez {vez})", r.returncode == 0, r.stderr[-300:])

T = uuid.uuid4().hex[:6]
EA = sv(f"insert into public.empresas (slug, nome) values ('e132-a-{T}', 'E132 A {T}') returning id")
EB = sv(f"insert into public.empresas (slug, nome) values ('e132-b-{T}', 'E132 B {T}') returning id")
CA = sv(f"select id from public.credores where empresa_id = {EA} order by id limit 1")
HOST = f"api-{T}.exemplo.com.br"
sv(f"insert into public.crm_hosts_permitidos (empresa_id, host) values ({EA}, '{HOST}')")
K = sv(f"insert into public.crm_conectores (empresa_id, nome, finalidade, metodo, url, autenticacao, mapa_saida) values "
       f"({EA}, 'Ofertas {T}', 'buscar_ofertas', 'GET', 'https://{HOST}/o', 'bearer', "
       f"'[{{\"origem\": \"$.o[*].v\", \"destino\": \"oferta.validade\", \"grava\": \"nao\"}}]') returning id")
U = {}
for p, papel, emp in (("adm", "admin", EA), ("oper", "operacao", EA), ("admb", "admin", EB)):
    U[p] = sv(f"insert into auth.users (email) values ('{p}132-{T}@exemplo.test') returning id")
    sv(f"update public.perfis set papel='{papel}', empresa_id={emp} where id='{U[p]}'")
U["eq"] = sv(f"insert into auth.users (email) values ('eq132-{T}@exemplo.test') returning id")
sv(f"update public.perfis set equipe=true, papel='admin', equipe_alcance='todas', empresa_id=null where id='{U['eq']}'")


def painel(uid):
    ok, out, err = sql(f"select public.painel_ofertas_voz({EA}, {CA})", "authenticated", uid)
    return json.loads(out) if ok else {"erro": err[:300]}


p = painel(U["adm"])
afirmar("sem configuração: config nula e a API pelo Buscar ofertas da empresa",
        p.get("config") is None and p["api"]["conector_id"] == int(K) and p["api"]["estado"] == "sem_dados", p)
afirmar("o conector mapeia a validade", p["api"]["mapeia_validade"] is True, p)
afirmar("Admin do cliente ativa; operação não", p["pode"] == {"ativar": True, "rascunho": True}
        and painel(U["oper"])["pode"] == {"ativar": False, "rascunho": False}, p)
afirmar("equipe MotorCX: só rascunho", painel(U["eq"]).get("pode") == {"ativar": False, "rascunho": True}, painel(U["eq"]))
afirmar("outra empresa não lê", "erro" in painel(U["admb"]))

ins = "insert into public.crm_chamadas (empresa_id, conector_id, classe, latencia_ms, ocorrido_em) values "
sv(ins + ", ".join(f"({EA}, {K}, 'ok', {ms}, now() - interval '2 hours')" for ms in (400, 600, 800, 1000)))
sv(ins + f"({EA}, {K}, 'tempo', 2500, now() - interval '3 minutes'), ({EA}, {K}, 'http_5xx', 300, now() - interval '2 minutes'), "
       f"({EA}, {K}, 'tempo', 2500, now() - interval '1 minute')")
p = painel(U["adm"])
a = p["api"]
afirmar("24 h: chamadas, % que respondeu, falhas por tipo",
        (a["chamadas"], a["ok_pct"], a["falhas_tempo"], a["falhas_erro"]) == (7, 57.1, 2, 1), a)
afirmar("3 falhas seguidas em 5 min: instável", a["estado"] == "instavel", a)
sv(ins + ", ".join(f"({EA}, {K}, 'tempo', 2500, now() - interval '{m} minutes')" for m in (6, 7, 8)))
afirmar("6+ falhas sem resposta boa em 15 min: fora", painel(U["adm"])["api"]["estado"] == "fora")

L = [{"empresa_id": int(EA), "id_chamada": f"c{T}{i}", "credor_id": int(CA), "modo": "api_arquivo", "fonte": f, "motivo": m,
      "pulou_api": pu, "descartes": d, "ofertas": n}
     for i, (f, m, pu, d, n) in enumerate([("api", "primeira", False, {}, 3), ("arquivo", "api_falhou", False, {"vencida": 1}, 2),
                                           ("arquivo", "api_instavel", True, {}, 1), (None, "sem_oferta", False, {"acima_alcada": 2}, 0)])]
sv(f"select public.registrar_ofertas_voz('{j(L)}')", "service_role")
u = painel(U["adm"])["uso"]
afirmar("uso 24 h por fonte, reserva, API pulada e descartes",
        (u["ligacoes"], u["api"], u["arquivo"], u["nenhuma"], u["reserva"], u["api_pulada"]) == (4, 1, 2, 1, 2, 1)
        and u["descartes"] == {"incompleta": 0, "vencida": 1, "acima_alcada": 2, "conta": 0}, u)

sv(f"insert into public.envios (tipo, caminho, nome_original, enviado_por, status, relatorio, empresa_id, credor_id) "
   f"select 'base', 'e132/{T}/c.csv', 'c.csv', '{U['adm']}', 'processado', "
   f"'{{\"ofertas_voz\": {{\"clientes_com_oferta\": 12, \"descartadas\": {{\"vencida\": 3}}}}}}', {EA}, {CA}")
c = painel(U["adm"])["carga"]
afirmar("a última carga com as contagens das ofertas", c and c["relatorio"]["clientes_com_oferta"] == 12, c)
sv(f"insert into public.voz_alcada_carteira (empresa_id, desconto_max_pct, parcelas_max, parcela_min, vigente_desde) "
   f"values ({EA}, 40, 12, 50, current_date - 1)")
afirmar("a alçada (só a trava)", painel(U["adm"])["alcada"]["parcelas_max"] == 12)
sv(f"select public.ativar_ofertas_voz({EA}, {CA}, '{j({'modo': 'so_api', 'conector_id': int(K)})}')", "authenticated", U["adm"])
sv(f"select public.salvar_rascunho_ofertas_voz({EA}, {CA}, '{j({'modo': 'so_arquivo', 'conector_id': None})}')",
   "authenticated", U["eq"])
p = painel(U["adm"])
afirmar("a ordem em vigor e o rascunho", p["config"]["ofertas"]["modo"] == "so_api" and p["rascunho"]["ofertas"]["modo"] == "so_arquivo", p)
afirmar("nada de cliente nem valor de oferta", all(x not in json.dumps(p) for x in ("id_cliente", "valor_parcela", "c.csv")), p)

print(f"\n{ok_total} passaram, {falhas} falharam")
sys.exit(1 if falhas else 0)
