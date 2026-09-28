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
                if r:
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
            assert op == "eq", op
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
                if "id" not in l and tabela in ("execucoes", "envios", "trilha"):
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

    def _envio(self, id_, eid, tipo, nome, conteudo, dia="2026-09-01"):
        slug = {1: "alfa", 2: "beta"}[eid]
        caminho = f"{slug}/{tipo}/{dia}/{id_}_{nome}"
        self.falso.objetos[f"entradas/{caminho}"] = conteudo
        self.falso.tabelas.setdefault("envios", []).append(
            {"id": id_, "empresa_id": eid, "tipo": tipo, "caminho": caminho, "nome_original": nome,
             "status": "pendente", "enviado_em": f"{dia}T10:00:{id_ % 60:02d}"})

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

    def test_falha_de_uma_empresa_nao_para_as_outras(self):
        self.falso.tabelas["envios"] = [e for e in self.falso.tabelas["envios"] if e["tipo"] != "clientes"]
        res = self._dia(date(2026, 9, 25))
        self.assertIn("base", res["alfa"]["erro"])
        self.assertNotIn("erro", res["beta"])
        ex = {e["empresa_id"]: e for e in self.falso.tabelas["execucoes"]}
        self.assertEqual((ex[1]["status"], ex[2]["status"]), ("erro", "ok"))
        self.assertTrue(all(e["status"] == "pendente" for e in self.falso.tabelas["envios"] if e["empresa_id"] == 1))

    def test_empresa_sem_arquivo_de_entrada_avisa(self):
        (self.cfg / "beta.json").unlink()
        res = self._dia(date(2026, 9, 25), empresa="beta")
        self.assertIn("empresas/beta.json", res["beta"]["erro"])

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
