"""Personas: o motor aprende com o histórico qual canal funciona para quem."""
import random
import unittest
from datetime import date, timedelta

from motor.certificacao import Certificacao, Evento
from motor.cluster import carregar_regras, classificar
from motor.estrategia import validar_estrategia
from motor.fila import gerar_fila
from motor.marcacao import Cliente, EstadoCliente
from motor.persona import aprender, condicoes_cluster, explorar, resumo, sugerir
from motor.regua import carregar_regua

D0 = date(2026, 8, 1)
HOJE = date(2026, 9, 2)                      # quarta-feira
TAXAS = {"SP": {"whatsapp": .30, "discador": .05}, "RJ": {"whatsapp": .02, "discador": .30}}
RES = {"whatsapp": ("identidade_confirmada", "entregue"), "discador": ("cpc", "nao_atendida")}


def carteira(n_por_uf=400, seed=7):
    rnd = random.Random(seed)
    clientes, eventos = {}, []
    for uf in ("SP", "RJ"):
        for i in range(n_por_uf):
            idc = f"{uf}{i:04d}"
            clientes[idc] = Cliente(idc, D0, 800.0, 40, None, 1,
                                    {"UF": uf, "RUIDO": rnd.choice(["a", "b", "c"])})
            for k, canal in enumerate(("whatsapp", "discador")):
                ok = rnd.random() < TAXAS[uf][canal]
                eventos.append(Evento(idc, f"119{i:04d}{k}000"[:11], "telefone", canal, RES[canal][0 if ok else 1],
                                      D0 + timedelta(days=2 + 2 * k)))
    return clientes, eventos


class TestAprender(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.regua = carregar_regua()
        cls.clientes, cls.eventos = carteira()
        cls.modelo = aprender(cls.eventos, cls.clientes, cls.regua, HOJE)

    def test_descobre_sozinho_a_caracteristica_que_importa(self):
        self.assertEqual(self.modelo.colunas[0], "UF")
        self.assertNotIn("RUIDO", self.modelo.colunas)

    def test_ranking_por_cpc_por_real(self):
        self.assertEqual(self.modelo.ranking("SP0001", {"whatsapp", "discador"})[0], "whatsapp")
        # RJ: discador custa 4× mais, mas dá 15× mais CPC
        self.assertEqual(self.modelo.ranking("RJ0001", {"whatsapp", "discador"})[0], "discador")

    def test_pouco_volume_puxa_para_a_media(self):
        clientes, eventos = carteira(n_por_uf=8)
        m = aprender(eventos, clientes, self.regua, HOJE)
        self.assertEqual(m.colunas, [])                     # sem volume: não inventa persona
        self.assertEqual(m.nome(m.persona("SP0001")), "Carteira toda")

    def test_resumo_e_sugestao_de_regua(self):
        linhas = resumo(self.modelo)
        rj = next(l for l in linhas if "RJ" in l["nome"])
        self.assertEqual((rj["clientes"], rj["ranking"][0]["canal"]), (400, "discador"))
        sug = sugerir(self.modelo, lambda idc: (None, 1, "whatsapp"))
        self.assertEqual([(s["de"], s["para"]) for s in sug if "RJ" in s["nome"]], [("whatsapp", "discador")])
        self.assertFalse([s for s in sug if "SP" in s["nome"]])     # SP já começa pelo melhor canal

    def test_maturidade_da_persona(self):
        rj = next(l for l in resumo(self.modelo) if "RJ" in l["nome"])
        m = rj["maturidade"]
        # 400 tentativas por canal e discador muito à frente: definida, índice cheio
        self.assertEqual((m["fase"], m["indice"], m["volume_pct"]), ("definida", 100, 100))
        self.assertGreater(m["confianca"], 0.99)
        self.assertEqual(rj["ranking"][0]["evidencia"], "firme")
        self.assertAlmostEqual(rj["ranking"][0]["peso_proprio"], 400 / 450, places=2)
        # pouco volume: só a carteira toda, ainda coletando, e o volume vem da carteira
        clientes, eventos = carteira(n_por_uf=8)
        m2 = aprender(eventos, clientes, self.regua, HOJE)
        (cart,) = resumo(m2)
        self.assertEqual(cart["nome"], "Carteira toda")
        self.assertEqual(cart["maturidade"]["fase"], "coletando")
        self.assertFalse(cart["maturidade"]["persona_formada"])
        self.assertEqual({r["canal"]: r["tentativas"] for r in cart["ranking"]}["whatsapp"], 16)
        self.assertIn("faltam", cart["maturidade"]["proximo_passo"])

    def test_maturidade_previa_quando_canais_empatados(self):
        from motor.persona import maturidade
        # sms: 0,10 ÷ R$ 0,08 = 1,25 CPC/real; whatsapp: 0,37 ÷ R$ 0,30 = 1,23 — praticamente empate
        rk = [{"canal": "sms", "taxa_cpc": .10, "tentativas": 250},
              {"canal": "whatsapp", "taxa_cpc": .37, "tentativas": 250}]
        m = maturidade(self.modelo, ("RJ",), rk)
        self.assertEqual(m["fase"], "previa")
        self.assertIn("próximos", m["proximo_passo"])

    def test_condicoes_da_persona_viram_segmento(self):
        regras, avisos = carregar_regras([{"codigo": "P1", "condicoes": condicoes_cluster(
            [{"campo": "UF", "valor": "RJ"}, {"campo": "faixa_saldo", "valor": "500 a 2 mil"}])}])
        self.assertEqual(avisos, [])
        self.assertIsNotNone(classificar(regras, self.clientes["RJ0001"], HOJE))
        self.assertIsNone(classificar(regras, self.clientes["SP0001"], HOJE))
        self.assertEqual(condicoes_cluster([{"campo": "SCORE", "valor": "10 a 20"}]),
                         [{"campo": "SCORE", "op": ">", "valor": 10.0}, {"campo": "SCORE", "op": "<=", "valor": 20.0}])

    def test_etiqueta_melhor_canal_da_persona_na_lista_do_dia(self):
        over, erros = validar_estrategia({"localizacao": {"passos": {"1": [{"canal": "persona_1"}]}}})
        self.assertEqual(erros, [])
        regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 1}])
        regua = carregar_regua().com_clusters(regras, {1: over})
        from dataclasses import replace
        regua = replace(regua, persona=self.modelo, _cache={})
        safra = HOJE                                      # carga hoje = D+1
        ids = [i for i in ("SP0001", "SP0002", "SP0003", "RJ0001", "RJ0002", "RJ0003") if not explorar(i, HOJE)]
        est = {i: EstadoCliente(i, safra, "DG", "DG", "2026-09", cluster_versao=regua.versao_clusters) for i in ids}
        certs = {(i, f"119{n:08d}"): Certificacao(i, f"119{n:08d}", "telefone", "CERTIFICADO", .9)
                 for n, i in enumerate(ids)}
        fila, _, _ = gerar_fila(est, {i: self.clientes[i] for i in ids}, certs, {}, {}, HOJE, regua, [])
        canal = {l["id_cliente"]: l["canal"] for l in fila}
        self.assertTrue(all(canal[i] == "whatsapp" for i in ids if i.startswith("SP")))
        self.assertTrue(all(canal[i] == "discador" for i in ids if i.startswith("RJ")))
        self.assertTrue(all("UF" in l["persona"] for l in fila))

    def test_exploracao_em_torno_de_10_por_cento(self):
        n = sum(explorar(f"C{i}", HOJE) for i in range(5000))
        self.assertTrue(350 < n < 650, n)


if __name__ == "__main__":
    unittest.main()
