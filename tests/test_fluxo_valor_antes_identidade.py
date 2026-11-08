"""Trava 1 (valor, oferta ou credor só depois de Confirmar identidade) no validador do fluxo.

Os casos de tests/dados/fluxo_valor_antes_identidade_casos.json rodam aqui (voz/fluxo_validador.py, cópia fiel de
public.fluxo_voz_erros) e na cópia do site que avisa enquanto se edita (site/src/lib/fluxo.ts › validarLocal, testada
em site/fluxo/fluxo.test.ts). Se um lado mudar sem o outro, um dos dois testes quebra.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from voz import fluxo_validador as FV

CASOS = json.loads((Path(__file__).parent / "dados" / "fluxo_valor_antes_identidade_casos.json").read_text("utf-8"))["casos"]


class TestValorAntesIdentidade(unittest.TestCase):
    def test_casos_compartilhados_com_o_site(self):
        self.assertGreaterEqual(len(CASOS), 8)
        for c in CASOS:
            with self.subTest(c["nome"]):
                obtido = [e for e in FV.erros(c["definicao"]) if e.startswith("valor_antes_identidade")]
                self.assertEqual(obtido, c["esperado"])


if __name__ == "__main__":
    unittest.main()
