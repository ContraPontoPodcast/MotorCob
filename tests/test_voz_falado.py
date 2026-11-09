"""Fala por extenso em pt-BR (voz/falado.py): a mesma tabela de casos do "Como soa no telefone" do site
(site/src/lib/falado.ts), para a VM e o editor dizerem igual (tests/dados/fala_por_extenso_casos.json)."""
import json
import unittest
from pathlib import Path

from voz import falado as F

CASOS = json.loads((Path(__file__).resolve().parent / "dados" / "fala_por_extenso_casos.json").read_text("utf-8"))


class TestFalado(unittest.TestCase):
    def test_numeros_da_tabela(self):
        self.assertGreaterEqual(len(CASOS["numeros"]), 20)
        for n, esperado in CASOS["numeros"]:
            self.assertEqual(F.por_extenso(n), esperado, n)

    def test_falas_da_tabela(self):
        self.assertGreaterEqual(len(CASOS["falas"]), 20)
        for fala, esperado in CASOS["falas"]:
            self.assertEqual(F.como_soa(fala), esperado, fala)

    def test_feminino_e_reais(self):
        self.assertEqual(F.por_extenso(2, fem=True), "duas")
        self.assertEqual(F.por_extenso(201, fem=True), "duzentas e uma")
        self.assertEqual(F.reais_por_extenso(1, 1), "um real e um centavo")
        self.assertEqual(F.reais_por_extenso(2_000_000), "dois milhões de reais")

    def test_datas(self):
        self.assertEqual(F.data_por_extenso(5, 12), "cinco de dezembro")
        self.assertEqual(F.data_por_extenso(1, 1, 2027), "primeiro de janeiro de dois mil e vinte e sete")
        self.assertIsNone(F.data_por_extenso(0, 5))

    def test_trechos(self):
        self.assertEqual(F.trechos_falados("6× de R$ 230,00 em 05/12. Ok?"), [
            {"de": "6×", "para": "seis vezes"}, {"de": "R$ 230,00", "para": "duzentos e trinta reais"},
            {"de": "05/12", "para": "cinco de dezembro"}])
        self.assertEqual(F.trechos_falados("Olá, {{primeiro_nome}}."), [])

    def test_fora_da_faixa_fica_em_digitos(self):
        self.assertEqual(F.por_extenso(1_000_000_000), "1000000000")
        self.assertEqual(F.como_soa("Protocolo 1234567890."), "Protocolo 1234567890.")


if __name__ == "__main__":
    unittest.main()
