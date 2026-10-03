"""Testes da sincronização com o Supabase, contra um servidor falso em memória."""
import json
import shutil
import tempfile
import threading
import unittest
import urllib.parse
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from nuvem.sincronizar import nome_seguro, sincronizar_comite, sincronizar_dia
from nuvem.supabase_api import Supabase

RAIZ = Path(__file__).resolve().parent.parent
EX = RAIZ / "exemplos"
CHAVE = "sb_secret_teste"


class SupabaseFalso:
    """Guarda tabelas e objetos em memória; entende o pedaço do PostgREST que usamos."""

    def __init__(self):
        self.tabelas, self.objetos, self.seq = {}, {}, 0
        self.lock = threading.Lock()
        falso = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _corpo(self):
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

            def _resp(self, code, corpo=b"", tipo="application/json"):
                self.send_response(code)
                self.send_header("Content-Type", tipo)
                self.send_header("Content-Length", str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)

            def _rota(self):
                if self.headers.get("apikey") != CHAVE:
                    self._resp(401, b'{"message":"sem chave"}')
                    return None
                u = urllib.parse.urlparse(self.path)
                return u.path, dict(urllib.parse.parse_qsl(u.query))

            def do_GET(self):
                r = self._rota()
                if r:
                    falso.get(self, *r)

            def do_POST(self):
                r = self._rota()
                if r:
                    falso.post(self, *r, self._corpo())

            def do_PATCH(self):
                r = self._rota()
                if r:
                    falso.patch(self, *r, json.loads(self._corpo()))

            def do_DELETE(self):
                r = self._rota()
                if r and r[0].startswith("/storage/v1/object/"):
                    bucket = r[0][len("/storage/v1/object/"):]
                    for c in json.loads(self._corpo())["prefixes"]:
                        falso.objetos.pop(f"{bucket}/{c}", None)
                    self._resp(200, b"[]")
                elif r:
                    falso.delete(self, *r)

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_port}"

    @staticmethod
    def _filtra(linhas, q):
        for campo, cond in q.items():
            if campo in ("select", "order", "limit", "on_conflict"):
                continue
            op, _, valor = cond.partition(".")
            assert op in ("eq", "gte", "in"), op
            if op == "in":
                ok = valor.strip("()").split(",")
                linhas = [l for l in linhas if str(l.get(campo)) in ok]
                continue
            if op == "gte":
                linhas = [l for l in linhas if str(l.get(campo)) >= valor]
                continue
            linhas = [l for l in linhas if json.dumps(l.get(campo)).strip('"') == valor]
        return linhas

    def get(self, h, caminho, q):
        if caminho.startswith("/storage/v1/object/"):
            chave = urllib.parse.unquote(caminho[len("/storage/v1/object/"):])
            if chave not in self.objetos:
                return h._resp(404, b'{"message":"not found"}')
            return h._resp(200, self.objetos[chave], "application/octet-stream")
        tabela = caminho.rsplit("/", 1)[1]
        h._resp(200, json.dumps(self._filtra(self.tabelas.get(tabela, []), q)).encode())

    def post(self, h, caminho, q, corpo):
        if caminho.startswith("/storage/v1/object/list/"):
            bucket = caminho[len("/storage/v1/object/list/"):]
            pre = f"{bucket}/" + json.loads(corpo)["prefix"]
            itens, pastas = [], set()
            for k in self.objetos:
                if k.startswith(pre):
                    resto = k[len(pre):]
                    if "/" in resto:
                        pastas.add(resto.split("/")[0])
                    else:
                        itens.append({"name": resto, "id": "x"})
            return h._resp(200, json.dumps(itens + [{"name": p, "id": None} for p in sorted(pastas)]).encode())
        if caminho.startswith("/storage/v1/object/"):
            self.objetos[urllib.parse.unquote(caminho[len("/storage/v1/object/"):])] = corpo
            return h._resp(200, b'{"Key":"ok"}')
        tabela = caminho.rsplit("/", 1)[1]
        linhas = json.loads(corpo)
        linhas = linhas if isinstance(linhas, list) else [linhas]
        with self.lock:
            t = self.tabelas.setdefault(tabela, [])
            chaves = q.get("on_conflict", "").split(",") if q.get("on_conflict") else None
            for l in linhas:
                if chaves:
                    t[:] = [x for x in t if [x.get(k) for k in chaves] != [l.get(k) for k in chaves]]
                if "id" not in l and tabela in ("execucoes", "envios", "trilha", "estrategias", "clusters", "sugestoes"):
                    self.seq += 1
                    l = {"id": self.seq, **l}
                t.append(l)
        ret = "return=representation" in (h.headers.get("Prefer") or "")
        h._resp(201, json.dumps(linhas if not ret else [t[-1]] if len(linhas) == 1 else linhas).encode())

    def patch(self, h, caminho, q, valores):
        for l in self._filtra(self.tabelas.get(caminho.rsplit("/", 1)[1], []), q):
            l.update(valores)
        h._resp(204)

    def delete(self, h, caminho, q):
        t = self.tabelas.get(caminho.rsplit("/", 1)[1], [])
        fora = self._filtra(t, q)
        t[:] = [l for l in t if l not in fora]
        h._resp(204)

    def fechar(self):
        self.srv.shutdown()
        self.srv.server_close()


class TestSincronizar(unittest.TestCase):
    def setUp(self):
        self.falso = SupabaseFalso()
        self.sb = Supabase(self.falso.url, CHAVE)
        self.tmp = tempfile.TemporaryDirectory()
        self.dados = Path(self.tmp.name) / "dados"
        # arquivo de entrada da empresa beta (base bruta + ocorrência), fora do repositório
        self.cfg = Path(self.tmp.name) / "empresas"
        self.cfg.mkdir()
        shutil.copy(RAIZ / "empresas" / "exemplo.json", self.cfg / "beta.json")
        self.falso.tabelas["empresas"] = [{"id": 1, "slug": "alfa", "nome": "Alfa", "ativa": True},
                                          {"id": 2, "slug": "beta", "nome": "Beta", "ativa": True},
                                          {"id": 3, "slug": "gama", "nome": "Gama", "ativa": False}]
        # o que o site teria enviado. alfa: base no formato do motor + retornos de fornecedor
        envios = [(1, "clientes", EX / "clientes.csv"), (1, "contatos", EX / "carteira_contatos.csv"),
                  (1, "parcelas", EX / "parcelas.csv")]
        envios += [(1, "retorno", p) for p in sorted((EX / "retornos").glob("*.csv"))]
        # beta: base bruta da empresa
        envios += [(2, "base", p) for p in sorted((EX / "empresa" / "bruto").glob("*.csv"))]
        for i, (eid, tipo, arq) in enumerate(envios):
            self._envio(1000 + i, eid, tipo, arq.name, arq.read_bytes())

    def _envio(self, id_, eid, tipo, nome, conteudo, dia="2026-09-01", credor=None):
        slug = {1: "alfa", 2: "beta"}[eid]
        caminho = f"{slug}/{tipo}/{dia}/{id_}_{nome}"
        self.falso.objetos[f"entradas/{caminho}"] = conteudo
        self.falso.tabelas.setdefault("envios", []).append(
            {"id": id_, "empresa_id": eid, "tipo": tipo, "caminho": caminho, "nome_original": nome,
             "status": "pendente", "enviado_em": f"{dia}T10:00:{id_ % 60:02d}", "credor_id": credor})

    def _dia(self, dia, empresa=None):
        return sincronizar_dia(self.dados, dia, self.sb, out=lambda *a: None, empresa=empresa,
                               pasta_empresas=self.cfg)

    def tearDown(self):
        self.falso.fechar()
        self.tmp.cleanup()

    def test_dia_completo_e_idempotente(self):
        r = self._dia(date(2026, 9, 25))["alfa"]
        t, o = self.falso.tabelas, self.falso.objetos
        alfa = lambda tab: [l for l in t[tab] if l["empresa_id"] == 1]  # noqa: E731
        self.assertEqual({e["empresa_id"]: e["status"] for e in t["execucoes"]}, {1: "ok", 2: "ok"})  # gama inativa
        self.assertEqual(len(alfa("estado_cliente")), 600)
        self.assertTrue(alfa("trilha"))
        self.assertEqual({l["data"] for l in t["fila_dia"]}, {"2026-09-25"})
        self.assertIn("saidas/alfa/2026-09-25/ids/whatsapp.csv", o)
        self.assertIn("saidas/alfa/2026-09-25/fila_do_dia.csv", o)
        self.assertTrue(o["saidas/alfa/2026-09-25/ids/whatsapp.csv"].startswith(b"id_cliente;contato\n"))
        # nenhum contato ou CPF nas tabelas
        texto = json.dumps({k: t[k] for k in ("estado_cliente", "trilha", "fila_dia")})
        self.assertNotRegex(texto, r"\b119\d{8}\b")
        self.assertNotIn("@exemplo", texto)
        envios = {e["nome_original"]: e for e in t["envios"]}
        self.assertEqual(envios["discadora_alfa_2026-09.csv"]["status"], "processado")
        self.assertIn("aceitas", envios["discadora_alfa_2026-09.csv"]["relatorio"])
        self.assertEqual(envios["voz_nova_2026-09.csv"]["status"], "erro")          # sem layout
        # segunda rodada no mesmo dia: não duplica trilha nem fila
        n_trilha, n_fila = len(t["trilha"]), len(t["fila_dia"])
        self._dia(date(2026, 9, 25))
        self.assertEqual((len(t["trilha"]), len(t["fila_dia"])), (n_trilha, n_fila))
        self.assertEqual(len(alfa("estado_cliente")), 600)
        self.assertEqual(r["resumo"]["clientes"], 600)
        # saldo e atraso vão para o mapa da esteira (não são dado pessoal)
        linha = next(l for l in alfa("estado_cliente"))
        self.assertIsInstance(linha["saldo"], float)
        self.assertGreaterEqual(linha["dias_atraso"], 0)

    def test_empresas_ficam_separadas(self):
        self._dia(date(2026, 9, 25))
        t = self.falso.tabelas
        beta = {l["id_cliente"] for l in t["estado_cliente"] if l["empresa_id"] == 2}
        self.assertEqual(beta, {"X0001", "X0002", "X0003"})
        self.assertFalse(beta & {l["id_cliente"] for l in t["estado_cliente"] if l["empresa_id"] == 1})
        self.assertTrue(all(c.split("/")[1] in ("alfa", "beta") for c in self.falso.objetos if c.startswith("saidas/")))
        self.assertTrue((self.dados / "empresas" / "beta" / "base" / "contatos.csv").exists())
        envio_base = next(e for e in t["envios"] if e["tipo"] == "base")
        self.assertEqual((envio_base["status"], envio_base["relatorio"]["clientes_na_base"]), ("processado", 3))

    def test_ocorrencia_da_empresa_liga_cpc_ao_contato_escolhido(self):
        self._dia(date(2026, 9, 2), empresa="beta")
        ids = self.falso.objetos["saidas/beta/2026-09-02/ids/whatsapp.csv"].decode()
        self.assertIn("X0001;11988880001", ids)
        self._envio(2001, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        r = self._dia(date(2026, 9, 3), empresa="beta")["beta"]
        est = {l["id_cliente"]: l["estado"] for l in self.falso.tabelas["estado_cliente"]}
        self.assertEqual(est["X0001"], "CPA")
        # ações realizadas: só totais, por dia × canal × régua × segmento
        acoes = [l for l in self.falso.tabelas["acoes_dia"] if l["empresa_id"] == 2]
        wa = [l for l in acoes if l["data"] == "2026-09-02" and l["canal"] == "whatsapp"]
        self.assertEqual(sum(l["cpcs"] for l in wa), 1)
        self.assertEqual(sum(l["primeiros_cpc"] for l in wa), 1)
        self.assertGreaterEqual(sum(l["enviadas"] for l in wa), 1)
        self.assertNotIn("X0001", json.dumps(acoes))
        self.assertEqual(r["resumo"]["acoes_ontem"]["cpcs"], 1)
        n = len(self.falso.tabelas["acoes_dia"])
        self._dia(date(2026, 9, 3), empresa="beta")                       # rodar de novo não duplica
        self.assertEqual(len(self.falso.tabelas["acoes_dia"]), n)
        self.assertEqual(r["resumo"]["ocorrencias"], 1)
        env = next(e for e in self.falso.tabelas["envios"] if e["id"] == 2001)
        self.assertEqual((env["status"], env["relatorio"]["contato_identificado"]), ("processado", 1))

    def test_clusters_do_site_e_colunas_da_base(self):
        self.falso.tabelas["clusters"] = [
            {"id": 1, "empresa_id": 2, "ordem": 10, "codigo": "VE", "ativo": True,
             "condicoes": [{"campo": "PRODUTO", "op": "=", "valor": "VEICULO"}], "pacote": "completo"},
            {"id": 2, "empresa_id": 2, "ordem": 20, "codigo": "IN", "ativo": False, "condicoes": []},
            {"id": 3, "empresa_id": 1, "ordem": 10, "codigo": "TD", "ativo": True, "condicoes": []}]
        r = self._dia(date(2026, 9, 2), empresa="beta")["beta"]
        est = {l["id_cliente"]: l["cluster_atual"] for l in self.falso.tabelas["estado_cliente"]}
        self.assertEqual(est["X0003"], "VE")                 # regra da beta
        self.assertNotIn("TD", est.values())                 # regra da alfa não vaza
        self.assertNotIn("IN", est.values())                 # inativa não vale
        self.assertEqual(r["resumo"]["clusters"]["VE"], 1)
        beta = next(e for e in self.falso.tabelas["empresas"] if e["slug"] == "beta")
        nomes = [c["nome"] for c in beta["colunas_base"]["colunas"]]
        self.assertIn("PRODUTO", nomes)
        self.assertFalse({"TEL1", "EMAIL", "CPF", "COD_CLIENTE"} & set(nomes))   # nada pessoal

    def test_estrategia_canais_e_enriquecimento_do_site(self):
        self.falso.tabelas["estrategias"] = [
            {"id": 5, "empresa_id": 2, "nome": "Só SMS", "padrao": True,
             "definicao": {"localizacao": {"passos": {"1": [{"canal": "sms", "numeros": 1}]}}}},
            {"id": 6, "empresa_id": 1, "nome": "Da alfa", "padrao": True,
             "definicao": {"localizacao": {"passos": {"1": [{"canal": "email"}]}}}}]
        self.falso.tabelas["canais_empresa"] = [{"empresa_id": 2, "canal": "sms", "custo": "0.05",
                                                 "janela_inicio": "10:00", "janela_fim": "18:00"}]
        enr = next((EX / "empresa" / "enriquecimento").glob("*.csv"))
        self._envio(3001, 2, "enriquecimento", enr.name, enr.read_bytes())
        self._dia(date(2026, 9, 2), empresa="beta")
        ids = self.falso.objetos["saidas/beta/2026-09-02/ids/sms.csv"].decode()
        self.assertIn("X0001;", ids)
        self.assertNotIn("saidas/beta/2026-09-02/ids/whatsapp.csv", self.falso.objetos)   # estratégia da beta
        fila = self.falso.objetos["saidas/beta/2026-09-02/fila_do_dia.csv"].decode()
        self.assertIn("10:00-18:00", fila)
        env = next(e for e in self.falso.tabelas["envios"] if e["id"] == 3001)
        self.assertEqual((env["status"], env["relatorio"]["telefones_novos"]), ("processado", 2))
        cont = (self.dados / "empresas" / "beta" / "base" / "contatos.csv").read_text()
        self.assertIn("11977770009;telefone;enriquecimento", cont)

    def test_vigia_roda_so_quem_subiu_carga(self):
        from nuvem.sincronizar import empresas_com_carga_nova, vigiar
        vig = lambda: vigiar(self.dados, date(2026, 9, 2), self.sb, out=lambda *a: None,  # noqa: E731
                             pasta_empresas=self.cfg)
        self.assertEqual([e["slug"] for e in empresas_com_carga_nova(self.dados, self.sb)], ["beta"])
        r = vig()
        self.assertEqual(list(r), ["beta"])                      # alfa não subiu carga do credor
        self.assertIn("saidas/beta/2026-09-02/fila_do_dia.csv", self.falso.objetos)
        self.assertEqual({e["empresa_id"] for e in self.falso.tabelas["execucoes"]}, {2})
        self.assertEqual(vig(), {})                              # sem carga nova: nada a fazer
        # carga que dá erro: tenta uma vez e só de novo quando chegar outra carga
        self._envio(4001, 2, "base", "ruim.csv", b"SEM;COLUNAS\n1;2\n")
        self.assertIn("carga do credor rejeitada", vig()["beta"]["erro"])
        env = next(e for e in self.falso.tabelas["envios"] if e["id"] == 4001)
        self.assertEqual(env["status"], "erro")                 # o site mostra o motivo
        self.assertIn("SALDO_DEVEDOR", env["relatorio"]["erro"])
        self.assertEqual(vig(), {})
        nova = next((EX / "empresa" / "bruto").glob("*.csv"))
        self._envio(4002, 2, "base", nova.name, nova.read_bytes())
        r = vig()
        self.assertEqual(list(r), ["beta"])
        self.assertNotIn("erro", r["beta"], r["beta"].get("erro"))

    def test_credores_da_empresa_rodam_separados(self):
        """beta com dois credores: cada arquivo vai para o seu; o bureau sem credor vale para os dois."""
        from nuvem.sincronizar import vigiar
        t = self.falso.tabelas
        self._dia(date(2026, 9, 1), empresa="beta")             # antes dos credores: pasta da empresa
        t["credores"] = [{"id": 21, "empresa_id": 2, "codigo": "principal", "nome": "Principal", "ativo": True},
                         {"id": 22, "empresa_id": 2, "codigo": "banco-x", "nome": "Banco X", "ativo": True,
                          "estrategia_id": 5}]
        t["estrategias"] = [{"id": 5, "empresa_id": 2, "nome": "Só SMS", "padrao": False,
                             "definicao": {"localizacao": {"passos": {"1": [{"canal": "sms"}]}}}}]
        t["personas_usuario"] = [{"id": 31, "empresa_id": 2, "credor_id": 22, "nome": "Paulistas", "ordem": 1,
                                  "ativo": True, "condicoes": [{"campo": "UF", "op": "=", "valor": "SP"}]}]
        carga = (EX / "empresa" / "bruto" / "base_2026-09-02.csv").read_bytes()
        self._envio(5001, 2, "base", "carga_x_2026-09-02.csv", carga, "2026-09-02", credor=22)
        enr = next((EX / "empresa" / "enriquecimento").glob("*.csv"))
        self._envio(5002, 2, "enriquecimento", enr.name, enr.read_bytes(), "2026-09-02")
        r = self._dia(date(2026, 9, 2), empresa="beta")["beta"]
        self.assertEqual(set(r["credores"]), {"principal", "banco-x"})
        cred = self.dados / "empresas" / "beta" / "credores"
        self.assertTrue((cred / "principal" / "estado" / "estados.json").exists())   # pasta antiga migrou
        self.assertTrue((cred / "banco-x" / "bruto" / "carga_x_2026-09-02.csv").exists())
        self.assertTrue((cred / "banco-x" / "enriquecimento" / enr.name).exists())
        self.assertTrue((cred / "principal" / "enriquecimento" / enr.name).exists())
        o = self.falso.objetos
        self.assertIn("saidas/beta/2026-09-02/principal/fila_do_dia.csv", o)
        estr = json.loads((cred / "banco-x" / "config" / "estrategias.json").read_text())
        self.assertTrue(estr[0]["padrao"])                                           # estratégia do credor
        # mesmo CPF: o principal acionou hoje → o Banco X não manda massiva (48h contam juntas)
        self.assertIn("OUTRO CREDOR", o["saidas/beta/2026-09-02/banco-x/alertas.txt"].decode())
        self.assertNotIn("saidas/beta/2026-09-02/banco-x/ids/sms.csv", o)
        est = {(l.get("credor_id"), l["id_cliente"]) for l in t["estado_cliente"] if l["empresa_id"] == 2}
        self.assertIn((22, "X0001"), est)
        self.assertIn((21, "X0001"), est)
        # onde cada cliente se enquadrou: esteira, carga e ação de hoje
        linha = {(l.get("credor_id"), l["id_cliente"]): l for l in t["estado_cliente"] if l["empresa_id"] == 2}
        self.assertEqual(linha[(22, "X0001")]["estrategia"], "Só SMS")
        self.assertEqual(linha[(22, "X0001")]["persona_usuario"], "Paulistas")     # persona da carteira
        self.assertEqual(linha[(21, "X0001")]["persona_usuario"], "")             # outra carteira: sem ela
        self.assertEqual(linha[(21, "X0001")]["estrategia"], "Playbook MotorCob")
        self.assertIn("whatsapp", linha[(21, "X0001")]["acao_hoje"])
        self.assertTrue(linha[(21, "X0001")]["na_carga"])
        self.assertEqual({e.get("credor_id") for e in t["execucoes"] if e["empresa_id"] == 2} - {None}, {21, 22})
        # mesmo CPF nos dois credores: quem foi acionado hoje por um não recebe massiva do outro amanhã
        comp = json.loads((self.dados / "empresas" / "beta" / "compartilhado" / "principal.json").read_text())
        self.assertTrue(comp["acionados"])
        # retirada só do Banco X: a vigia roda só ele
        t["execucoes"].append({"id": 990, "empresa_id": 2, "credor_id": 21, "data_ref": "2026-09-03",
                               "status": "ok"})          # o principal já fez a rotina de 03/09
        n_ex = len(t["execucoes"])
        self._envio(5003, 2, "retirada", "ret.csv", b"CONTRATO;DT_RETIRADA;MOTIVO\nCT04;03/09/2026;DEV\n",
                    "2026-09-03", credor=22)
        rv = vigiar(self.dados, date(2026, 9, 3), self.sb, out=lambda *a: None, pasta_empresas=self.cfg)
        self.assertEqual(set(rv["beta"]["credores"]), {"banco-x"})
        self.assertEqual(len(t["execucoes"]), n_ex + 1)
        env = next(e for e in t["envios"] if e["id"] == 5003)
        self.assertEqual((env["status"], env["relatorio"]["retirados"]), ("processado", {"devolução": 1}))
        na = (cred / "banco-x" / "base" / "na_carga.csv").read_text().split()
        self.assertNotIn("X0003", na)

    def test_rodizio_entre_credores_com_o_mesmo_cpf(self):
        """Mesmos clientes e mesma régua em dois credores: eles se alternam (ninguém fica sem acionar)."""
        t = self.falso.tabelas
        t["envios"] = [e for e in t["envios"] if e["empresa_id"] != 2]
        t["credores"] = [{"id": 21, "empresa_id": 2, "codigo": "principal", "nome": "P", "ativo": True},
                         {"id": 22, "empresa_id": 2, "codigo": "banco-x", "nome": "X", "ativo": True}]
        carga = (EX / "empresa" / "bruto" / "base_2026-09-02.csv").read_bytes()
        self._envio(6001, 2, "base", "base_2026-09-02.csv", carga, credor=21)
        self._envio(6002, 2, "base", "base_2026-09-02.csv", carga, credor=22)
        quem = {}
        for d in (2, 3, 4):
            self._dia(date(2026, 9, d), empresa="beta")
            for cod in ("principal", "banco-x"):
                k = f"saidas/beta/2026-09-{d:02d}/{cod}/fila_do_dia.csv"
                linhas = self.falso.objetos.get(k, b"").decode().splitlines()[1:]
                for l in linhas:
                    quem.setdefault(l.split(",")[1], []).append((d, cod))
        x1 = quem["X0001"]
        self.assertEqual([c for _, c in x1], ["principal", "banco-x"])   # D+1 no principal, D+3 no Banco X
        self.assertEqual(len({d for d, _ in x1}), len(x1))               # nunca os dois no mesmo dia

    def test_segmento_escolhe_as_carteiras_e_liga_por_carteira(self):
        from nuvem.sincronizar import baixar_clusters
        t = self.falso.tabelas
        t["clusters"] = [
            {"id": 1, "empresa_id": 2, "ordem": 10, "codigo": "VE", "ativo": True, "credor_id": None, "condicoes": []},
            {"id": 2, "empresa_id": 2, "ordem": 20, "codigo": "UM", "ativo": True, "credor_id": 21, "condicoes": []},
            {"id": 3, "empresa_id": 2, "ordem": 30, "codigo": "TD", "ativo": True, "credor_id": None, "condicoes": []},
            {"id": 4, "empresa_id": 2, "ordem": 40, "codigo": "DES", "ativo": False, "credor_id": None, "condicoes": []}]
        # VE: vinculado às carteiras 21 (em uso) e 22 (pausado); UM e TD sem vínculo (regra antiga)
        t["segmentos_carteira"] = [{"empresa_id": 2, "cluster_id": 1, "credor_id": 21, "ativo": True},
                                   {"empresa_id": 2, "cluster_id": 1, "credor_id": 22, "ativo": False}]
        cod = lambda cid: [c["codigo"] for c in baixar_clusters(self.sb, self.dados / "x", 2, cid)]  # noqa: E731
        self.assertEqual(cod(21), ["VE", "UM", "TD"])
        self.assertEqual(cod(22), ["TD"])                   # VE pausado na 22; UM é só da 21
        self.assertEqual(cod(23), ["TD"])                   # VE não vinculado à 23

    def test_vigia_refaz_a_lista_quando_a_orquestracao_muda(self):
        from nuvem.sincronizar import empresas_com_carga_nova, vigiar
        t = self.falso.tabelas
        self._dia(date(2026, 9, 2), empresa="beta")
        for e in t["execucoes"]:
            e["iniciada_em"] = "2026-09-02T09:00:00+00:00"
        vig = lambda: vigiar(self.dados, date(2026, 9, 2), self.sb, out=lambda *a: None,  # noqa: E731
                             pasta_empresas=self.cfg)
        self.assertEqual(empresas_com_carga_nova(self.dados, self.sb), [])     # nada mudou
        # a esteira da beta foi ativada no site depois da rotina: só SMS
        t["estrategias"] = [{"id": 9, "empresa_id": 2, "nome": "Só SMS", "padrao": True,
                             "atualizado_em": "2026-09-02T10:00:00+00:00",
                             "definicao": {"localizacao": {"passos": {"D+1": [{"canal": "SMS"}]}}}}]
        r = vig()
        self.assertEqual(list(r), ["beta"])
        self.assertIn("saidas/beta/2026-09-02/ids/sms.csv", self.falso.objetos)
        self.assertNotIn("saidas/beta/2026-09-02/ids/whatsapp.csv", self.falso.objetos)   # lista refeita
        for e in t["execucoes"]:
            e.setdefault("iniciada_em", "2026-09-02T10:05:00+00:00")
        self.assertEqual(empresas_com_carga_nova(self.dados, self.sb), [])     # já refeita: não repete

    def test_vigia_faz_a_rotina_do_dia_sem_arquivo_novo(self):
        """Dia sem arquivo nem mudança: a vigia roda a rotina uma vez para a esteira andar."""
        from nuvem.sincronizar import empresas_com_carga_nova, vigiar
        t = self.falso.tabelas
        self._dia(date(2026, 9, 2), empresa="beta")
        for e in t["execucoes"]:
            e["iniciada_em"] = "2026-09-02T09:00:00+00:00"
        dia = date(2026, 9, 3)
        self.assertEqual(empresas_com_carga_nova(self.dados, self.sb), [])             # sem data: só arquivo
        self.assertEqual([e["slug"] for e in empresas_com_carga_nova(self.dados, self.sb, hoje=dia)], ["beta"])
        r = vigiar(self.dados, dia, self.sb, out=lambda *a: None, pasta_empresas=self.cfg)
        self.assertEqual(list(r), ["beta"])                       # alfa nunca rodou: fica de fora
        self.assertNotIn("erro", r["beta"], r["beta"].get("erro"))
        self.assertIn("saidas/beta/2026-09-03/acoes.json", self.falso.objetos)   # D+2: sem passo, sem fila
        self.assertIn("2026-09-03", {e["data_ref"] for e in t["execucoes"] if e["empresa_id"] == 2})
        self.assertEqual(empresas_com_carga_nova(self.dados, self.sb, hoje=dia), [])  # uma vez por dia

    def test_rotina_do_dia_so_depois_da_hora(self):
        from datetime import datetime
        from nuvem.sincronizar import _passou_hora_rotina
        hoje = date(2026, 9, 3)
        self.assertFalse(_passou_hora_rotina(hoje, datetime(2026, 9, 3, 5, 59)))
        self.assertTrue(_passou_hora_rotina(hoje, datetime(2026, 9, 3, 6, 0)))
        self.assertTrue(_passou_hora_rotina(hoje, datetime(2026, 9, 4, 1, 0)))   # data informada à mão

    def test_sugestao_aprovada_vira_segmento_com_estrategia(self):
        dados = {"persona": "RJ", "nome": "UF RJ", "condicoes": [{"campo": "UF", "valor": "RJ"}],
                 "estrategia_base": None, "fase": "localizacao", "dia": 1, "de": "whatsapp", "para": "sms"}
        self.falso.tabelas["sugestoes"] = [{"id": 900, "empresa_id": 2, "chave": "RJ|localizacao|1|whatsapp|sms",
                                             "texto": "UF RJ: trocar o D+1 de whatsapp para sms", "dados": dados,
                                             "status": "aprovada"}]
        r = self._dia(date(2026, 9, 2), empresa="beta")["beta"]
        t = self.falso.tabelas
        self.assertEqual(t["sugestoes"][0]["status"], "aplicada")
        seg = next(c for c in t["clusters"] if c["empresa_id"] == 2)
        self.assertEqual((seg["codigo"], seg["condicoes"]), ("P1", [{"campo": "UF", "op": "=", "valor": "RJ"}]))
        estr = next(e for e in t["estrategias"] if e["id"] == seg["estrategia_id"])
        self.assertEqual(estr["definicao"]["localizacao"]["passos"]["1"], ["sms"])
        est = {l["id_cliente"]: l["cluster_atual"] for l in t["estado_cliente"] if l["empresa_id"] == 2}
        self.assertEqual(est["X0002"], "P1")                       # o cliente do RJ caiu no segmento
        self.assertEqual(r["resumo"]["sugestoes_aplicadas"], 1)
        ids = self.falso.objetos["saidas/beta/2026-09-02/ids/sms.csv"].decode()
        self.assertIn("X0002;", ids)                               # D+1 por SMS, como aprovado

    def test_falha_de_uma_empresa_nao_para_as_outras(self):
        self.falso.tabelas["envios"] = [e for e in self.falso.tabelas["envios"] if e["tipo"] != "clientes"]
        res = self._dia(date(2026, 9, 25))
        self.assertIn("base", res["alfa"]["erro"])
        self.assertNotIn("erro", res["beta"])
        ex = {e["empresa_id"]: e for e in self.falso.tabelas["execucoes"]}
        self.assertEqual((ex[1]["status"], ex[2]["status"]), ("erro", "ok"))
        self.assertTrue(all(e["status"] == "pendente" for e in self.falso.tabelas["envios"] if e["empresa_id"] == 1))

    def test_empresa_sem_arquivo_de_entrada_usa_layout_automatico(self):
        (self.cfg / "beta.json").unlink()
        res = self._dia(date(2026, 9, 2), empresa="beta")["beta"]
        self.assertNotIn("erro", res)
        ex = next(e for e in self.falso.tabelas["execucoes"] if e["empresa_id"] == 2)
        self.assertTrue(ex["alertas"][0].startswith("LAYOUT AUTOMÁTICO"))
        self.assertIn("saldo = SALDO_DEVEDOR", ex["alertas"][0])
        self.assertNotRegex(ex["alertas"][0], r"\d{8,}")                       # só nomes de coluna, nada pessoal
        self.assertIn("saidas/beta/2026-09-02/ids/whatsapp.csv", self.falso.objetos)
        cfg = self.dados / "empresas" / "beta" / "config" / "entrada_automatica.json"
        self.assertEqual(json.loads(cfg.read_text())["base"]["colunas"]["id_cliente"], "COD_CLIENTE")
        # ocorrência sem layout configurado também é entendida
        self._envio(7001, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        est = {l["id_cliente"]: l["estado"] for l in self.falso.tabelas["estado_cliente"] if l["empresa_id"] == 2}
        self.assertEqual(est["X0001"], "CPA")

    def test_carga_em_excel(self):
        import csv as _csv
        import io
        from openpyxl import Workbook
        (self.cfg / "beta.json").unlink()
        self.falso.tabelas["envios"] = [e for e in self.falso.tabelas["envios"] if e["empresa_id"] != 2]
        wb = Workbook()
        ws = wb.active
        with open(EX / "empresa" / "bruto" / "base_2026-09-02.csv", encoding="utf-8") as f:
            for linha in _csv.reader(f, delimiter=";"):
                ws.append(linha)
        buf = io.BytesIO()
        wb.save(buf)
        self._envio(7201, 2, "base", "mailing_2026-09-02.xlsx", buf.getvalue())
        self._dia(date(2026, 9, 2), empresa="beta")
        env = next(e for e in self.falso.tabelas["envios"] if e["id"] == 7201)
        self.assertEqual(env["status"], "processado", env.get("relatorio"))
        self.assertEqual(env["relatorio"]["clientes"], 3)
        self.assertIn("saidas/beta/2026-09-02/ids/whatsapp.csv", self.falso.objetos)

    def test_carga_que_nao_da_para_entender_fica_com_erro(self):
        (self.cfg / "beta.json").unlink()
        self.falso.tabelas["envios"] = [e for e in self.falso.tabelas["envios"] if e["empresa_id"] != 2]
        self._envio(7101, 2, "base", "estranha.csv", b"COLUNA_A;COLUNA_B\n1;2\n")
        res = self._dia(date(2026, 9, 2), empresa="beta")
        self.assertIn("COLUNA_A", res["beta"]["erro"])
        env = next(e for e in self.falso.tabelas["envios"] if e["id"] == 7101)
        self.assertEqual(env["status"], "erro")
        self.assertIn("não reconheci as colunas", env["relatorio"]["erro"])

    def test_trilha_retoma_de_onde_parou(self):
        self._dia(date(2026, 9, 25), empresa="alfa")
        total = len(self.falso.tabelas["trilha"])
        estado = self.dados / "empresas" / "alfa" / "estado"
        (estado / "nuvem_trilha_enviada.txt").write_text(str(total - 5))  # "caiu" nos 5 últimos
        del self.falso.tabelas["trilha"][-5:]
        self._dia(date(2026, 9, 25), empresa="alfa")
        self.assertEqual(len(self.falso.tabelas["trilha"]), total)

    def test_comite(self):
        self._dia(date(2026, 9, 25))
        comite = lambda: sincronizar_comite(self.dados, "2026-09", self.sb, out=lambda *a: None,  # noqa: E731
                                            pasta_empresas=self.cfg)
        comite()
        kpis = self.falso.tabelas["kpis"]
        self.assertTrue(any(k["safra"] == "TOTAL" and k["empresa_id"] == 1 for k in kpis))
        self.assertTrue(any(c.startswith("saidas/alfa/comite/2026-09/") for c in self.falso.objetos))
        n = len(kpis)
        comite()   # upsert, não duplica
        self.assertEqual(len(self.falso.tabelas["kpis"]), n)

    def test_chave_errada_falha_alto(self):
        from nuvem.supabase_api import ErroSupabase
        with self.assertRaises(ErroSupabase):
            Supabase(self.falso.url, "errada").selecionar("envios")

    def test_nome_de_arquivo_nao_escapa_da_pasta(self):
        self.assertEqual(nome_seguro("../../etc/passwd"), "passwd")
        self.assertEqual(nome_seguro("retorno ação 1.csv"), "retorno_a__o_1.csv")


if __name__ == "__main__":
    unittest.main()
