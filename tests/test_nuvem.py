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
            linhas = [l for l in linhas if str(l.get(campo)) == valor]
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
        self.dados = Path(self.tmp.name)
        # o que o site teria enviado: base + retornos
        envios = [("clientes", EX / "clientes.csv"), ("contatos", EX / "carteira_contatos.csv"),
                  ("parcelas", EX / "parcelas.csv")]
        envios += [("retorno", p) for p in sorted((EX / "retornos").glob("*.csv"))]
        for i, (tipo, arq) in enumerate(envios):
            caminho = f"{tipo}/2026-09-24/{i}_{arq.name}"
            self.falso.objetos[f"entradas/{caminho}"] = arq.read_bytes()
            self.falso.tabelas.setdefault("envios", []).append(
                {"id": 1000 + i, "tipo": tipo, "caminho": caminho, "nome_original": arq.name,
                 "status": "pendente", "enviado_em": f"2026-09-24T10:00:{i:02d}"})

    def tearDown(self):
        self.falso.fechar()
        self.tmp.cleanup()

    def test_dia_completo_e_idempotente(self):
        r = sincronizar_dia(self.dados, date(2026, 9, 25), self.sb, out=lambda *a: None)
        t, o = self.falso.tabelas, self.falso.objetos
        self.assertEqual(t["execucoes"][-1]["status"], "ok")
        self.assertEqual(len(t["estado_cliente"]), 600)
        self.assertTrue(t["trilha"])
        self.assertEqual({l["data"] for l in t["fila_dia"]}, {"2026-09-25"})
        self.assertIn("saidas/2026-09-25/ids/whatsapp.csv", o)
        self.assertIn("saidas/2026-09-25/fila_do_dia.csv", o)
        # nenhum contato ou CPF nas tabelas
        texto = json.dumps({k: t[k] for k in ("estado_cliente", "trilha", "fila_dia")})
        self.assertNotRegex(texto, r"\b119\d{8}\b")
        self.assertNotIn("@exemplo.com", texto)
        envios = {e["nome_original"]: e for e in t["envios"]}
        self.assertEqual(envios["discadora_alfa_2026-09.csv"]["status"], "processado")
        self.assertIn("aceitas", envios["discadora_alfa_2026-09.csv"]["relatorio"])
        self.assertEqual(envios["voz_nova_2026-09.csv"]["status"], "erro")          # sem layout
        # segunda rodada no mesmo dia: não duplica trilha nem fila
        n_trilha, n_fila = len(t["trilha"]), len(t["fila_dia"])
        sincronizar_dia(self.dados, date(2026, 9, 25), self.sb, out=lambda *a: None)
        self.assertEqual((len(t["trilha"]), len(t["fila_dia"])), (n_trilha, n_fila))
        self.assertEqual(len(t["estado_cliente"]), 600)
        self.assertEqual(r["resumo"]["clientes"], 600)

    def test_falha_marca_execucao_com_erro_e_mantem_envios_pendentes(self):
        self.falso.tabelas["envios"] = [e for e in self.falso.tabelas["envios"] if e["tipo"] != "clientes"]
        with self.assertRaises(RuntimeError):
            sincronizar_dia(self.dados, date(2026, 9, 25), self.sb, out=lambda *a: None)
        ex = self.falso.tabelas["execucoes"][-1]
        self.assertEqual(ex["status"], "erro")
        self.assertIn("clientes.csv", ex["erro"])
        self.assertTrue(all(e["status"] == "pendente" for e in self.falso.tabelas["envios"]))

    def test_trilha_retoma_de_onde_parou(self):
        sincronizar_dia(self.dados, date(2026, 9, 25), self.sb, out=lambda *a: None)
        total = len(self.falso.tabelas["trilha"])
        (self.dados / "estado" / "nuvem_trilha_enviada.txt").write_text(str(total - 5))  # "caiu" nos 5 últimos
        del self.falso.tabelas["trilha"][-5:]
        sincronizar_dia(self.dados, date(2026, 9, 25), self.sb, out=lambda *a: None)
        self.assertEqual(len(self.falso.tabelas["trilha"]), total)

    def test_comite(self):
        sincronizar_dia(self.dados, date(2026, 9, 25), self.sb, out=lambda *a: None)
        sincronizar_comite(self.dados, "2026-09", self.sb, out=lambda *a: None)
        kpis = self.falso.tabelas["kpis"]
        self.assertTrue(any(k["safra"] == "TOTAL" for k in kpis))
        self.assertTrue(any(c.startswith("saidas/comite/2026-09/") for c in self.falso.objetos))
        n = len(kpis)
        sincronizar_comite(self.dados, "2026-09", self.sb, out=lambda *a: None)   # upsert, não duplica
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
