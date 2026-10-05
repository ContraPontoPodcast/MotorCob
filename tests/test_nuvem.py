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
                if "id" not in l and tabela in ("execucoes", "envios", "trilha", "estrategias", "clusters", "sugestoes",
                                                    "mapeamento_arquivos", "ocorrencia_codigos"):
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

    def test_reenquadrar_agora_pedido_pelo_site(self):
        from nuvem.sincronizar import empresas_com_carga_nova, ha_arquivo_novo, vigiar
        t = self.falso.tabelas
        dia = date(2026, 9, 2)
        self._dia(dia, empresa="beta")
        for e in t["execucoes"]:
            e["iniciada_em"] = "2026-09-02T09:00:00+00:00"
        self.assertEqual(empresas_com_carga_nova(self.dados, self.sb, hoje=dia), [])
        t["pedidos_rotina"] = [{"id": 1, "empresa_id": 2, "credor_id": None, "status": "pendente"}]
        self.assertTrue(ha_arquivo_novo(self.dados, self.sb))           # o plantão pega na hora
        n_ex = len(t["execucoes"])
        r = vigiar(self.dados, dia, self.sb, out=lambda *a: None, pasta_empresas=self.cfg)
        self.assertEqual(list(r), ["beta"])
        self.assertEqual(len(t["execucoes"]), n_ex + 1)
        p = t["pedidos_rotina"][0]
        self.assertEqual((p["status"], p["execucao_id"]), ("ok", r["beta"]["execucao"]))
        self.assertTrue(p["iniciado_em"] and p["terminado_em"])
        self.assertEqual(empresas_com_carga_nova(self.dados, self.sb, hoje=dia), [])   # saiu da fila

    def test_pedido_preso_em_rodando_vira_erro(self):
        from nuvem.sincronizar import _pedidos_pendentes
        t = self.falso.tabelas
        t["pedidos_rotina"] = [
            {"id": 1, "empresa_id": 2, "credor_id": None, "status": "rodando",
             "iniciado_em": "2026-01-01T09:00:00+00:00"},                  # caiu no meio: preso
            {"id": 2, "empresa_id": 2, "credor_id": 22, "status": "pendente"}]
        from nuvem.sincronizar import _travar
        trava = _travar(self.dados, esperar=False)               # rotina longa ainda rodando: não mexe
        self.assertEqual(_pedidos_pendentes(self.sb, self.dados), {2: {22: [2]}})
        self.assertEqual(t["pedidos_rotina"][0]["status"], "rodando")
        trava.close()                                            # rotina caiu: vira erro
        self.assertEqual(_pedidos_pendentes(self.sb, self.dados), {2: {22: [2]}})
        p = t["pedidos_rotina"][0]
        self.assertEqual(p["status"], "erro")
        self.assertIn("interrompida", p["erro"])

    def test_plantao_se_atualiza_mesmo_sem_trabalho(self):
        from nuvem.sincronizar import plantao
        import nuvem.sincronizar as s
        relogio, versoes, puxou = {"t": 0.0}, ["a"], []

        def dormir(x):
            relogio["t"] += x

        def atualizar():
            puxou.append(relogio["t"])
            versoes.append("b")

        orig = s.subprocess.run
        s.subprocess.run = lambda *a, **k: None
        try:
            r = plantao(self.dados, ["rodar"], self.sb, out=lambda *a: None, dormir=dormir,
                        relogio=lambda: relogio["t"], versao=lambda: versoes[-1], atualizar=atualizar,
                        a_cada_atualizar=900, parar=lambda: relogio["t"] > 5000)
        finally:
            s.subprocess.run = orig
        self.assertEqual(r, "atualizado")
        self.assertEqual(len(puxou), 1)
        self.assertGreaterEqual(puxou[0], 900)

    def test_rotina_do_dia_so_depois_da_hora(self):
        from datetime import datetime
        from nuvem.sincronizar import _passou_hora_rotina
        hoje = date(2026, 9, 3)
        self.assertFalse(_passou_hora_rotina(hoje, datetime(2026, 9, 3, 5, 59)))
        self.assertTrue(_passou_hora_rotina(hoje, datetime(2026, 9, 3, 6, 0)))
        self.assertTrue(_passou_hora_rotina(hoje, datetime(2026, 9, 4, 1, 0)))   # data informada à mão

    def test_plantao_roda_na_hora_que_o_arquivo_chega(self):
        from nuvem.sincronizar import ha_arquivo_novo, plantao
        self._dia(date(2026, 9, 2), empresa="beta")
        self.assertEqual(ha_arquivo_novo(self.dados, self.sb), frozenset())
        relogio = {"t": 0.0}
        chamadas, ticks = [], {"n": 0}

        def dormir(s):
            relogio["t"] += s
            ticks["n"] += 1
            if ticks["n"] == 3:   # 15 s depois de subir: chega a carga no site
                self._envio(6001, 2, "base", "nova.csv", b"x", "2026-09-03")

        def comando(cmd, check=False):
            chamadas.append(relogio["t"])

        import nuvem.sincronizar as s
        orig = s.subprocess.run
        s.subprocess.run = comando
        try:
            r = plantao(self.dados, ["rodar"], self.sb, out=lambda *a: None, intervalo=5, completo=60,
                        parar=lambda: ticks["n"] >= 20, dormir=dormir, relogio=lambda: relogio["t"],
                        versao=lambda: "")
        finally:
            s.subprocess.run = orig
        self.assertEqual(r, "parado")
        # sobe e roda (rotina/orquestração); arquivo chega aos 15 s → roda aos 15 s;
        # o mesmo arquivo parado não roda de novo a cada 5 s, só no ciclo de 60 s
        self.assertEqual(chamadas, [0.0, 15.0, 75.0])

    def test_plantao_reinicia_quando_o_motor_atualiza(self):
        from nuvem.sincronizar import plantao
        import nuvem.sincronizar as s
        versoes = iter(["a", "b"])
        orig = s.subprocess.run
        s.subprocess.run = lambda *a, **k: None
        try:
            r = plantao(self.dados, ["rodar"], self.sb, out=lambda *a: None, dormir=lambda x: None,
                        versao=lambda: next(versoes))
        finally:
            s.subprocess.run = orig
        self.assertEqual(r, "atualizado")

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
        # ocorrência: espera o cliente apontar as colunas e marcar os códigos; depois entra sozinha
        self._envio(7001, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        est = lambda: {l["id_cliente"]: l["estado"] for l in self.falso.tabelas["estado_cliente"]  # noqa: E731
                       if l["empresa_id"] == 2}
        self.assertEqual(self._status(7001)["status"], "aguardando")
        self.assertIn("Configurações → Arquivos", self._status(7001)["relatorio"]["aguardando"])
        self.assertNotEqual(est()["X0001"], "CPA")
        m = next(x for x in self.falso.tabelas["mapeamento_arquivos"] if x["empresa_id"] == 2)
        self.assertEqual(m["sugerido"], {"id_cliente": "COD_CLIENTE", "data": "DT_ACAO", "resultado": "OCORRENCIA",
                                         "canal": "CANAL"})
        self.assertEqual(m["cabecalho"], ["COD_CLIENTE", "DT_ACAO", "CANAL", "OCORRENCIA"])
        self._mapear(2, "ocorrencia")                      # colunas confirmadas, código ainda sem marca
        self._dia(date(2026, 9, 3), empresa="beta")
        self.assertEqual(self._status(7001)["status"], "aguardando")
        self.assertEqual(self._status(7001)["relatorio"]["codigos_novos"], ["CPC"])
        cod = next(x for x in self.falso.tabelas["ocorrencia_codigos"] if x["empresa_id"] == 2)
        self.assertEqual((cod["codigo"], cod["sugerido"], cod["qtd"], cod.get("mapeado", False)), ("CPC", "cpc", 1, False))
        self._mapear(2, codigos={"CPC": "cpc"})            # marcou: a linha que esperava entra
        self._dia(date(2026, 9, 3), empresa="beta")
        self.assertEqual(est()["X0001"], "CPA")
        self.assertEqual(self._status(7001)["status"], "processado")

    def test_layout_automatico_entende_tabulacao_de_cpc_e_data_do_pagamento(self):
        """Arquivos como o cliente manda: CPF na ocorrência, tabulação 'ALÔ - PROMESSA', e no pagamento a
        coluna VALOR_PAGO vem antes da DATA_PAGTO (as duas têm PAG no nome)."""
        (self.cfg / "beta.json").unlink()
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(7101, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    "CPF;DATA_ACIONAMENTO;CANAL;TABULACAO\n100.000.011-71;02/09/2026 10:15;Discador;"
                    "ALÔ - PROMESSA DE PAGAMENTO\n100.000.022-24;02/09/2026 11:00;Discador;CAIXA POSTAL\n"
                    .encode("latin-1"), "2026-09-02")
        self._envio(7102, 2, "acordo", "acordo_2026-09-02.csv",
                    b"COD_CLIENTE;ACORDO;PARCELA;VENCIMENTO;VALOR\nX0001;77;1;03/09/2026;150,00\n"
                    b"X0001;77;2;03/10/2026;150,00\n", "2026-09-02")
        self._envio(7103, 2, "baixa", "pagamentos_2026-09-03.csv",
                    b"COD_CLIENTE;VALOR_PAGO;DATA_PAGTO\nX0001;150,00;03/09/2026\n", "2026-09-03")
        self._dia(date(2026, 9, 3), empresa="beta")
        st = {i: self._status(i)["status"] for i in (7101, 7102, 7103)}
        self.assertEqual(st, {7101: "aguardando", 7102: "aguardando", 7103: "aguardando"})
        sug = {m["tipo"]: m["sugerido"] for m in self.falso.tabelas["mapeamento_arquivos"] if m["empresa_id"] == 2}
        self.assertEqual(sug["baixa"]["data"], "DATA_PAGTO")                  # não confunde com VALOR_PAGO
        for tipo in ("ocorrencia", "acordo", "baixa"):
            self._mapear(2, tipo)
        sugeridos = {c["codigo"]: c["sugerido"] for c in self.falso.tabelas["ocorrencia_codigos"]}
        self.assertEqual(sugeridos, {"ALÔ - PROMESSA DE PAGAMENTO": "cpc", "CAIXA POSTAL": "sem_contato"})
        self._mapear(2, codigos={"ALÔ - PROMESSA DE PAGAMENTO": "cpc", "CAIXA POSTAL": "sem_contato"})
        self._dia(date(2026, 9, 3), empresa="beta")
        st = {i: self._status(i)["status"] for i in (7101, 7102, 7103)}
        self.assertEqual(st, {7101: "processado", 7102: "processado", 7103: "processado"})
        est = {l["id_cliente"]: l["estado"] for l in self.falso.tabelas["estado_cliente"] if l["empresa_id"] == 2}
        self.assertNotEqual(est["X0002"], "CPA")
        parc = (self.dados / "empresas" / "beta" / "base" / "parcelas.csv").read_text()
        self.assertIn("X0001;77;1;2026-09-03;150.00;2026-09-03", parc)          # acordo + pagamento
        self.assertIn(est["X0001"], ("CPA", "PRE", "COL"))                      # CPC e acordo reconhecidos
        cpc = [e for e in self.falso.tabelas["acoes_dia"] if e["empresa_id"] == 2 and e.get("cpcs")]
        self.assertTrue(cpc)

    def test_ocorrencia_com_resultado_desconhecido_vira_alerta_com_os_codigos(self):
        (self.cfg / "beta.json").unlink()
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(7201, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DATA;OCORRENCIA\nX0001;02/09/2026;COD 47\nX0002;02/09/2026;CAIXA POSTAL\n",
                    "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        self._mapear(2, "ocorrencia", codigos={"CAIXA POSTAL": "sem_contato"})
        self._dia(date(2026, 9, 3), empresa="beta")
        ex = [e for e in self.falso.tabelas["execucoes"] if e["empresa_id"] == 2][-1]
        alerta = next(a for a in ex["alertas"] if a.startswith("OCORRÊNCIAS PARA MARCAR"))
        self.assertIn("'COD 47' 1x", alerta)
        self.assertEqual(self._status(7201)["status"], "aguardando")

    def test_diagnostico_de_arquivos_mostra_colunas_e_codigos_sem_dado_pessoal(self):
        import contextlib
        import io
        from nuvem import diagnostico_arquivos
        (self.cfg / "beta.json").unlink()
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(7301, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"CPF;DATA;OCORRENCIA\n10000001171;02/09/2026;COD 47\n10000002224;02/09/2026;CAIXA POSTAL\n",
                    "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        self._mapear(2, "ocorrencia", codigos={"CAIXA POSTAL": "sem_contato"})
        self._dia(date(2026, 9, 3), empresa="beta")
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            diagnostico_arquivos.carteira(self.dados / "empresas" / "beta", "beta", "beta")
        txt = saida.getvalue()
        self.assertIn("'COD 47'→NÃO ENTENDIDO (1)", txt)
        self.assertIn("nenhum código deste arquivo foi entendido como CPC", txt)
        self.assertIn("aproveitadas 1 de 2", txt)
        self.assertNotRegex(txt, r"\d{11}")                                    # nenhum CPF

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

    def _mapear(self, eid, tipo=None, colunas=None, codigos=None, credor=None):
        """Faz o que o cliente faz no site: confirma as colunas (a sugestão do motor, se não disser) e marca códigos."""
        T = self.falso.tabelas
        if tipo:
            m = next(x for x in T["mapeamento_arquivos"] if x["empresa_id"] == eid and x["tipo"] == tipo
                     and x.get("credor_id") == credor)
            m.update({"colunas": colunas or m["sugerido"], "confirmado": True, "atualizado_em": "2099-01-01T00:00:00"})
        for cod, res in (codigos or {}).items():
            c = next(x for x in T["ocorrencia_codigos"] if x["empresa_id"] == eid and x["codigo"] == cod)
            c.update({"resultado": res, "mapeado": True, "atualizado_em": "2099-01-01T00:00:00"})

    def _status(self, id_):
        return next(e for e in self.falso.tabelas["envios"] if e["id"] == id_)

    def test_acordo_baixa_e_ocorrencia_acham_o_cliente_pelo_cpf_ou_codigo_formatado(self):
        self._dia(date(2026, 9, 2), empresa="beta")
        # acordo com o CPF formatado na coluna do cliente; baixa com o código em minúsculas
        self._envio(2201, 2, "acordo", "acordo_2026-09-02.csv",
                    b"COD_CLIENTE;NUM_ACORDO;PARCELA;VENCIMENTO;VALOR\n100.000.011-71;AC9;1;03/09/2026;100,00\n"
                    b"100.000.011-71;AC9;2;03/10/2026;100,00\n", "2026-09-02")
        self._envio(2202, 2, "baixa", "baixa_2026-09-03.csv",
                    b"COD_CLIENTE;CONTRATO;DT_PAGAMENTO;VALOR_PAGO;TIPO\nx0001;;03/09/2026;100,00;PA\n", "2026-09-03")
        # ocorrência com o CPF só com dígitos
        self._envio(2203, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\n10000002224;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        acordo, baixa, occ = self._status(2201), self._status(2202), self._status(2203)
        self.assertEqual((acordo["status"], baixa["status"], occ["status"]), ("processado",) * 3)
        self.assertEqual(acordo["relatorio"]["identificacao"], {"cpf": 2})
        self.assertEqual(baixa["relatorio"]["identificacao"], {"formatacao": 1})
        self.assertEqual(occ["relatorio"]["aceitas"], 1)
        parc = (self.dados / "empresas" / "beta" / "base" / "parcelas.csv").read_text()
        self.assertIn("X0001;AC9;1;2026-09-03;100.00;2026-09-03", parc)     # acordo e pagamento no X0001
        est = {l["id_cliente"]: l["estado"] for l in self.falso.tabelas["estado_cliente"] if l["empresa_id"] == 2}
        self.assertEqual(est["X0002"], "CPA")                                  # CPC achado pelo CPF

    def test_arquivo_sem_nenhum_cliente_da_carga_fica_com_erro_e_o_motivo(self):
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(2301, 2, "acordo", "acordo_2026-09-02.csv",
                    b"COD_CLIENTE;NUM_ACORDO;PARCELA;VENCIMENTO;VALOR\nZZ999;AC1;1;10/09/2026;100,00\n", "2026-09-02")
        self._envio(2302, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;ALO OK\n", "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        acordo, occ = self._status(2301), self._status(2302)
        self.assertEqual(acordo["status"], "erro")
        self.assertIn("nenhum cliente do arquivo foi encontrado na carga", acordo["relatorio"]["erro"])
        self.assertEqual(occ["status"], "aguardando")                       # espera o cliente marcar
        self.assertEqual(occ["relatorio"]["codigos_novos"], ["ALO OK"])

    def test_ocorrencia_nova_aciona_a_vigia_na_hora(self):
        from nuvem.sincronizar import ha_arquivo_novo
        self._dia(date(2026, 9, 2), empresa="beta")
        self.assertFalse({x for x in ha_arquivo_novo(self.dados, self.sb, "beta") if x[0] == 2})
        self._envio(2401, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        self.assertIn((2, None, 2401), ha_arquivo_novo(self.dados, self.sb, "beta"))

    def test_ocorrencia_que_chega_depois_da_rotina_vale_e_so_uma_vez(self):
        """A rotina das 6h fecha o dia anterior; a operação manda a tabulação de ontem depois disso."""
        self._dia(date(2026, 9, 2), empresa="beta")
        self._dia(date(2026, 9, 3), empresa="beta")          # rotina de 03/09: o dia 02/09 está fechado
        self._envio(2501, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 15:00;WHATS;CPC\n", "2026-09-03")
        self._dia(date(2026, 9, 3), empresa="beta")          # a vigia roda de novo no mesmo dia
        est = lambda: {l["id_cliente"]: l["estado"] for l in self.falso.tabelas["estado_cliente"]  # noqa: E731
                       if l["empresa_id"] == 2}
        self.assertEqual(est()["X0001"], "CPA")
        trilha = (self.dados / "empresas" / "beta" / "estado" / "trilha.csv").read_text()
        self.assertIn("que chegou depois", trilha)
        n = trilha.count("que chegou depois")
        self._dia(date(2026, 9, 3), empresa="beta")
        self._dia(date(2026, 9, 4), empresa="beta")
        self.assertEqual((self.dados / "empresas" / "beta" / "estado" / "trilha.csv").read_text()
                         .count("que chegou depois"), n)                    # não aplica de novo

    def test_acordo_enviado_hoje_vale_na_mesma_rodada(self):
        self._dia(date(2026, 9, 2), empresa="beta")
        self._dia(date(2026, 9, 3), empresa="beta")
        self._envio(2601, 2, "acordo", "acordo_2026-09-03.csv",
                    b"COD_CLIENTE;NUM_ACORDO;PARCELA;VENCIMENTO;VALOR\nX0001;AC5;1;20/09/2026;200,00\n", "2026-09-03")
        self._dia(date(2026, 9, 3), empresa="beta")
        est = {l["id_cliente"]: l["estado"] for l in self.falso.tabelas["estado_cliente"] if l["empresa_id"] == 2}
        self.assertEqual(est["X0001"], "COL")

    def test_mapeamento_confirmado_no_site_aciona_a_vigia(self):
        from nuvem.sincronizar import credores_com_orquestracao_nova
        (self.cfg / "beta.json").unlink()
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(2701, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;OCORRENCIA\nX0001;02/09/2026;ALO\n", "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        for e in self.falso.tabelas["execucoes"]:
            e.setdefault("iniciada_em", "2026-09-03T09:00:00+00:00")
        emp = {"id": 2, "slug": "beta"}
        self.assertEqual(credores_com_orquestracao_nova(self.sb, emp), {})   # o motor gravar não dispara
        self._mapear(2, "ocorrencia")
        self.assertIn(None, credores_com_orquestracao_nova(self.sb, emp))   # o cliente confirmar dispara

    def test_intervalo_do_cpc_e_lista_por_estrategia(self):
        T = self.falso.tabelas
        T["estrategias"] = [{"id": 7, "empresa_id": 2, "nome": "Negociação", "padrao": True,
                             "definicao": {"cpc": {"intervalo_cpa": 3}}}]
        self._dia(date(2026, 9, 1), empresa="beta")
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(2801, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        acionado = {}
        for d in (3, 4, 5, 8):
            dia = date(2026, 9, d)
            self._dia(dia, empresa="beta")
            acionado[d] = any(l["id_cliente"] == "X0001" and l["data"] == dia.isoformat() and l["regua"] == "cpc"
                              for l in T["fila_dia"])
            if d == 4:
                est = next(l for l in T["estado_cliente"] if l["id_cliente"] == "X0001")
                self.assertEqual(est["estado"], "CPA")
                self.assertIn("intervalo de acionamento", est["motivo_hoje"])
        # CPC A a cada 3 dias: 03/09 sim; 04 e 05 não; 08/09 sim (06 domingo, 07 feriado)
        self.assertEqual(acionado, {3: True, 4: False, 5: False, 8: True})
        # lista do dia separada por estratégia
        o = self.falso.objetos
        indice = json.loads(o["saidas/beta/2026-09-03/ids/estrategias/indice.json"])
        self.assertEqual([i["estrategia"] for i in indice], ["Negociação"])
        self.assertIn("saidas/beta/2026-09-03/ids/estrategias/7-negociacao/whatsapp.csv", o)
        # dentro da estratégia, por estágio: a mensagem do WhatsApp de CPC não é a do cliente novo
        pre = "saidas/beta/2026-09-03/ids/estrategias/7-negociacao/"
        self.assertIn("X0001", o[pre + "2-cpc-a/whatsapp.csv"].decode())
        estagios = {e["estagio"]: e for e in indice[0]["estagios"]}
        self.assertEqual(estagios["cpa"]["rotulo"], "CPC A · negociação")
        self.assertEqual(estagios["cpa"]["pasta"], "7-negociacao/2-cpc-a")
        outros = [k for k in estagios if k != "cpa"]
        for k in outros:                                  # o X0001 não aparece em outro estágio
            for canal in estagios[k]["canais"]:
                self.assertNotIn("X0001", o[pre + estagios[k]["pasta"].split("/", 1)[1] + f"/{canal}.csv"].decode())
        self.assertTrue(all(l["estrategia"] == "Negociação" for l in T["fila_dia"] if l["data"] == "2026-09-03"))

    def test_lista_separa_estagios_dentro_da_estrategia(self):
        T = self.falso.tabelas
        T["estrategias"] = [{"id": 7, "empresa_id": 2, "nome": "Negociação", "padrao": True, "definicao": {}}]
        self._dia(date(2026, 9, 1), empresa="beta")
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(2901, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        self._dia(date(2026, 9, 4), empresa="beta")
        o = self.falso.objetos
        idx = json.loads(o["saidas/beta/2026-09-04/ids/estrategias/indice.json"])
        est = {e["estagio"]: e for e in idx[0]["estagios"]}
        self.assertEqual(set(est), {"localizacao", "cpa"})       # cliente novo e CPC A, cada um no seu
        self.assertEqual(est["localizacao"]["passos"], {"D+3": 2})
        pre = "saidas/beta/2026-09-04/ids/estrategias/7-negociacao/"
        self.assertIn("X0001", o[pre + "2-cpc-a/whatsapp.csv"].decode())
        self.assertNotIn("X0001", o[pre + "1-cliente-novo/rcs.csv"].decode())

    def test_calendario_do_credor_e_da_estrategia(self):
        T = self.falso.tabelas
        self._dia(date(2026, 9, 1), empresa="beta")             # antes dos credores: pasta da empresa
        T["estrategias"] = [{"id": 5, "empresa_id": 2, "nome": "Dias úteis", "padrao": False,
                             "definicao": {"localizacao": {"passos": {str(n): ["sms"] for n in range(1, 9)}}}}]
        # o credor exporta todo dia, inclusive feriado; a estratégia dele, só de segunda a sexta
        T["credores"] = [{"id": 21, "empresa_id": 2, "codigo": "principal", "nome": "P", "ativo": True,
                          "estrategia_id": 5, "calendario": {
                              "padrao": {"dias_semana": [0, 1, 2, 3, 4, 5, 6], "feriados_nacionais": False},
                              "estrategias": {"5": {"seguir_padrao": False, "dias_semana": [0, 1, 2, 3, 4]}}}}]
        tem = {}
        for d in (2, 3, 4, 5, 6, 7, 8):
            dia = date(2026, 9, d)
            self._dia(dia, empresa="beta")
            tem[d] = any(l["data"] == dia.isoformat() for l in T["fila_dia"])
        # 05 sábado e 06 domingo: a estratégia não exporta; 07/09 feriado: o credor liberou
        self.assertEqual({d: tem[d] for d in (5, 6, 7)}, {5: False, 6: False, 7: True})
        est = next(l for l in T["estado_cliente"] if l["id_cliente"] == "X0001" and l.get("credor_id") == 21)
        self.assertTrue(est["motivo_hoje"])

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

    def test_comite_usa_custo_do_canal_quando_ocorrencia_nao_traz(self):
        from unittest import mock
        import relatorio
        self._dia(date(2026, 9, 2), empresa="beta")
        self._envio(2101, 2, "ocorrencia", "ocorrencia_2026-09-02.csv",
                    b"COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n", "2026-09-02")
        self._dia(date(2026, 9, 3), empresa="beta")
        self.falso.tabelas["canais_empresa"] = [{"empresa_id": 2, "canal": "whatsapp", "ativo": True, "custo": 0.5}]
        visto = []
        original = relatorio.montar
        def espiao(clientes, estados, trilha, eventos, *a, **k):
            visto.extend(eventos)
            return original(clientes, estados, trilha, eventos, *a, **k)
        with mock.patch.object(relatorio, "montar", espiao):
            sincronizar_comite(self.dados, "2026-09", self.sb, out=lambda *a: None, pasta_empresas=self.cfg,
                               empresa="beta")
        zap = [e for e in visto if e.canal == "whatsapp" and e.id_cliente == "X0001"]
        self.assertTrue(zap)
        self.assertTrue(all(e.custo == 0.5 for e in zap))   # a ocorrência não traz custo: vale o do canal

    def test_chave_errada_falha_alto(self):
        from nuvem.supabase_api import ErroSupabase
        with self.assertRaises(ErroSupabase):
            Supabase(self.falso.url, "errada").selecionar("envios")

    def test_nome_de_arquivo_nao_escapa_da_pasta(self):
        self.assertEqual(nome_seguro("../../etc/passwd"), "passwd")
        self.assertEqual(nome_seguro("retorno ação 1.csv"), "retorno_a__o_1.csv")


if __name__ == "__main__":
    unittest.main()
