"""SQL 123 · Tarifação do minuto de IA: a regra da VM (voz/tarifacao.py) com a mesma tabela de casos do banco
(supabase/testes/testar_cobranca_ia.py lê tests/dados/tarifacao_ia_casos.json)."""
import json
import unittest
from pathlib import Path

from voz import tarifacao as T

CASOS = json.loads((Path(__file__).parent / "dados" / "tarifacao_ia_casos.json").read_text(encoding="utf-8"))


class TestTarifacaoIA(unittest.TestCase):
    def test_casos(self):
        for c in CASOS["casos"]:
            with self.subTest(c["nome"]):
                self.assertEqual(T.segundos_tarifados_ia(c["segundos"], *T.cadencia_ia(c["cadencia"])), c["tarifados"])

    def test_chamadas_soma_dos_trechos(self):
        for c in CASOS["chamadas"]:
            with self.subTest(c["nome"]):
                soma = round(sum(f - i for i, f in c["trechos"]), 3)
                self.assertAlmostEqual(soma, c["segundos_ia"], places=3)
                self.assertEqual(T.segundos_tarifados_ia(soma, *T.cadencia_ia(c["cadencia"])), c["tarifados"])

    def test_cadencia_invalida(self):
        with self.assertRaises(ValueError):
            T.segundos_tarifados_ia(10, 0, 0, 6)
        with self.assertRaises(ValueError):
            T.segundos_tarifados_ia(10, -1, 30, 6)

    def test_cadencia_texto(self):
        self.assertEqual(T.cadencia_ia("0/30/6"), (0, 30, 6))


if __name__ == "__main__":
    unittest.main()
