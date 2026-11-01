"""Simulador de texto na VM (voz/simulador_http.py): assinatura igual à da Edge Function (mesmo vetor), recusa sem
assinatura ou fora da janela, e o pedido roda o mesmo executor da ligação com os exemplos dos conectores."""
import json
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

from tests.test_voz_fluxo import ALCADA, conectores
from voz import fluxo_casos as C
from voz import simulador_http as SH

RAIZ = Path(__file__).resolve().parent.parent
VETOR = json.loads((RAIZ / "supabase" / "functions" / "simular_fluxo_voz" / "vetor_assinatura.json").read_text("utf-8"))


def pedido(falas, falhar=()):
    cons = [dict(c.__dict__, mapa_entrada=list(c.mapa_entrada), mapa_saida=list(c.mapa_saida)) for c in conectores().values()]
    a = ALCADA
    return {"versao_id": 31, "definicao": C.negociador(), "conectores": cons, "falas": falas, "falhar": list(falhar),
            "alcada": {"id": 1, "desconto_max_pct": a.desconto_max_pct, "parcelas_max": a.parcelas_max,
                       "parcela_min": a.parcela_min, "ofertas_padrao": list(a.ofertas_padrao)},
            "variaveis": {"primeiro_nome": "Ana", "assessoria": "Aurora", "saldo": "1.380,00"}}


class TestSimuladorHttp(unittest.TestCase):
    def test_vetor_igual_ao_da_edge_function(self):
        self.assertEqual(SH.assinatura(VETOR["chave"], VETOR["carimbo"], VETOR["corpo"].encode()), VETOR["assinatura"])

    def test_conferir_janela_e_assinatura(self):
        c = VETOR["corpo"].encode()
        agora = int(VETOR["carimbo"])
        self.assertTrue(SH.conferir(VETOR["chave"], VETOR["carimbo"], VETOR["assinatura"], c, agora + 10))
        self.assertFalse(SH.conferir(VETOR["chave"], VETOR["carimbo"], VETOR["assinatura"], c, agora + 301))
        self.assertFalse(SH.conferir("outra", VETOR["carimbo"], VETOR["assinatura"], c, agora))
        self.assertFalse(SH.conferir(VETOR["chave"], VETOR["carimbo"], VETOR["assinatura"], c + b" ", agora))
        self.assertFalse(SH.conferir(VETOR["chave"], None, VETOR["assinatura"], c, agora))

    def test_rodar_falha_do_crm_cai_na_carteira(self):
        r = SH.rodar(pedido(["Sou eu", "15 de março", "Quero parcelar", "Aceito"], falhar=[1]), hoje=date(2026, 10, 31))
        self.assertEqual(r["caminho"], ["N1", "N2", "N3", "N4", "N6", "N7", "N11", "N12"])
        self.assertEqual(r["resultado"], "promessa")
        self.assertNotIn("eventos", r)

    def test_rodar_recusa_fluxo_invalido_e_fala_com_documento(self):
        p = pedido(["Sou eu"])
        p["definicao"]["blocos"][0]["params"]["fala"] = "Consta {{saldo}}"
        self.assertEqual(SH.rodar(p)["erro"], "fluxo inválido")
        self.assertIn("erro", SH.rodar(pedido(["meu cpf é 12345678901"])))

    def test_servidor_so_responde_com_assinatura(self):
        srv = SH.criar_servidor(0, "chave-x", relogio=lambda: 1793000000)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}/simular"
        corpo = json.dumps(pedido(["Não, é engano"])).encode()
        try:
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(urllib.request.Request(url, data=corpo, method="POST"))
            self.assertEqual(e.exception.code, 401)
            req = urllib.request.Request(url, data=corpo, method="POST", headers={
                "X-MotorCX-Carimbo": "1793000000", "X-MotorCX-Assinatura": SH.assinatura("chave-x", "1793000000", corpo)})
            with urllib.request.urlopen(req) as r:
                d = json.loads(r.read())
            self.assertEqual(d["caminho"], ["N1", "N14"])
            self.assertIn("Peço que Ana", d["turnos"][-1]["falas"][0]["texto"])
        finally:
            srv.shutdown()
            srv.server_close()

    def test_roleplay_so_acorda_com_assinatura(self):
        acordou = []
        srv = SH.criar_servidor(0, "chave-x", relogio=lambda: 1793000000, ao_roleplay=lambda: acordou.append(1))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}/roleplay"
        corpo = b'{"lote": 9}'
        try:
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(urllib.request.Request(url, data=corpo, method="POST", headers={
                    "X-MotorCX-Carimbo": "1793000000", "X-MotorCX-Assinatura": "0" * 64}))
            self.assertEqual((e.exception.code, acordou), (401, []))
            req = urllib.request.Request(url, data=corpo, method="POST", headers={
                "X-MotorCX-Carimbo": "1793000000", "X-MotorCX-Assinatura": SH.assinatura("chave-x", "1793000000", corpo)})
            with urllib.request.urlopen(req) as r:
                self.assertEqual(r.status, 202)
            self.assertEqual(acordou, [1])
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
