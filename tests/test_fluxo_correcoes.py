"""Correções de um clique do editor do fluxo (PR4 do redesenho) conferidas com o validador do banco.

O site oferece, para algumas pendências, uma correção determinística (site/src/lib/fluxo.ts › correcaoDe) que muda o
rascunho depois de mostrar o antes → depois. tests/dados/fluxo_correcoes_casos.json guarda cada caso (antes, pendência,
depois). Aqui, voz/fluxo_validador.py (cópia fiel de public.fluxo_voz_erros e fluxo_voz_pendencias) confere que o
"depois" some com a pendência e não cria nenhuma outra. O validador não muda: ele continua sendo a autoridade.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from voz import fluxo_validador as FV

DADOS = json.loads((Path(__file__).parent / "dados" / "fluxo_correcoes_casos.json").read_text("utf-8"))
CONECTORES = {c["id"]: (c["situacao"], c["finalidade"]) for c in DADOS["conectores"]}


def tudo(d: dict) -> set[str]:
    """Erros do validador e, se o desenho passa, as pendências de contexto (conectores; alçada cadastrada)."""
    e = FV.erros(d)
    if e:
        return set(e)
    intencoes = {i for b in d["blocos"] if b["tipo"] == "intencao" for i in b["params"].get("intencoes", [])}
    return set(FV.pendencias(d, CONECTORES, True, intencoes))


class TestCorrecoesDeUmClique(unittest.TestCase):
    def test_depois_some_com_a_pendencia_e_nao_cria_outra(self):
        self.assertGreaterEqual(len(DADOS["casos"]), 10)
        for c in DADOS["casos"]:
            with self.subTest(c["nome"]):
                antes, depois = tudo(c["antes"]), tudo(c["depois"])
                self.assertIn(c["codigo"], antes)
                self.assertNotIn(c["codigo"], depois)
                self.assertEqual(depois - antes, set(), "a correção criou pendência nova")

    def test_o_desenho_base_dos_casos_passa(self):
        # os casos partem de um fluxo sem pendência: a correção deixa o rascunho limpo de novo
        for c in DADOS["casos"]:
            with self.subTest(c["nome"]):
                self.assertEqual(tudo(c["depois"]), set())

    def test_casos_sem_botao_tem_a_pendencia(self):
        for c in DADOS["sem_botao"]:
            with self.subTest(c["nome"]):
                self.assertIn(c["codigo"], tudo(c["antes"]))


if __name__ == "__main__":
    unittest.main()
