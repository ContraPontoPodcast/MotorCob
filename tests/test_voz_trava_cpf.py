"""SQL 96 (PR9 do redesenho; SPEC B4 e Q4): trava de CPF.

O agente nunca fala, pede nem repete CPF; o CPF dito pela pessoa nunca vai ao modelo, à transcrição nem de volta ao
simulador. "Os três últimos números do CPF" (pergunta de identidade) continua valendo. CPFs fictícios.
"""
import json
import unittest
from pathlib import Path

from voz import fluxo as FX
from voz import fluxo_casos as C
from voz import fluxo_validador as FV
from voz.provedores import montagem as M
from voz.transcricao import redacao as RD
from voz.transcricao.ia import FALA_CPF_ROTEIRO, ConversaComTurnos

from tests.test_voz_fluxo import ATE_N3, VARS, ModeloFalso, R, fluxo, simular

CPF_FORMATADO = "111.444.777-35"        # fictício, dígitos verificadores certos
CPF_SEGUIDO = "11144477735"


CASOS = json.loads((Path(__file__).parent / "dados" / "trava_cpf_casos.json").read_text(encoding="utf-8"))


class TestDeteccao(unittest.TestCase):
    def test_tabela_compartilhada_com_o_site_e_o_banco(self):
        for t, esperado in CASOS["fala"]:
            self.assertEqual(FV.pede_cpf(t), esperado, t)
        for t, esperado in CASOS["pessoa"]:
            self.assertEqual(RD.cpf_dito(t), esperado, t)

    def test_cpf_dito(self):
        for t in (f"meu cpf é {CPF_FORMATADO}", f"é {CPF_SEGUIDO}", "111 444 777 35",
                  "um um um quatro quatro quatro sete sete sete três cinco", "o CPF é 123 456 789"):
            self.assertTrue(RD.cpf_dito(t), t)
        for t in ("472", "os três últimos são 4 7 2", "meu telefone é 11 98765 4321", "quero pagar 1.380,00",
                  "não vou dar meu cpf", ""):
            self.assertFalse(RD.cpf_dito(t), t)
        self.assertEqual(RD.sem_cpf(f"é {CPF_FORMATADO}"), RD.MARCA_CPF)
        self.assertEqual(RD.sem_cpf("Sou eu"), "Sou eu")

    def test_fala_pede_cpf(self):
        for t in ("Me diga o seu CPF?", "Qual o número do C.P.F.?", "Confere 111.444.777-35?", "Seu cpf 11144477735",
                  "Os três últimos números do CPF. Ou o CPF inteiro."):
            self.assertTrue(FV.pede_cpf(t), t)
            self.assertTrue(FV.pede_senha(t), t)
        for t in ("Me diga os três últimos números do seu CPF?", "Pode dizer os 3 últimos dígitos do CPF?",
                  "Falo com Ana?", "São 6 parcelas de {{oferta.valor_parcela}}."):
            self.assertFalse(FV.pede_cpf(t), t)
        self.assertFalse(FV.pede_cpf(FX.PERGUNTAS_FALA["ultimos3_documento"]))


class TestExecutor(unittest.TestCase):
    def test_cpf_dito_nunca_volta_e_a_etapa_espera(self):
        r = simular(["Sou eu", f"meu cpf é {CPF_FORMATADO}", "15 de março"])
        t = r["turnos"][2]
        self.assertEqual(t["pessoa"], RD.MARCA_CPF)
        self.assertEqual([f["texto"] for f in t["falas"]], [FX.FALA_CPF])
        self.assertIn("cpf", t["travas"])
        self.assertNotIn("111", str(r))
        self.assertEqual(r["caminho"], ["N1", "N2", "N3"])          # depois confirma normalmente

    def test_cpf_na_identidade_pelos_3_ultimos(self):
        d = C.negociador()
        n2 = next(b for b in d["blocos"] if b["id"] == "N2")
        n2["params"].update(pergunta="ultimos3_documento", fala="Me diga os três últimos números do seu CPF?")
        r = simular(["Sou eu", CPF_SEGUIDO], f=fluxo(d))
        self.assertEqual(r["turnos"][-1]["falas"][0]["texto"], f"{FX.FALA_CPF} {FX.FALA_CPF_ULTIMOS3}")

    def test_cpf_nunca_vai_ao_modelo(self):
        modelo = ModeloFalso([R("Vamos ver as condições.")])
        s = FX.Sessao(fluxo(), "c", "CLI", VARS, lambda *a: None, None, entendedor=FX.EntendedorLLM(modelo))
        s.comecar()
        s.ouvir(f"meu cpf é {CPF_FORMATADO}")
        self.assertEqual(modelo.ferramentas, [])                    # nem o classificador das travas recebeu o texto

    def test_fala_do_roteiro_com_cpf_e_trocada(self):
        s = FX.Sessao(fluxo(), "c", "CLI", VARS, lambda *a: None, None)
        self.assertEqual(s.render("Confere o CPF 111.444.777-35?"), (FX.FALA_CPF, "cpf"))

    def test_generativo_que_pede_cpf_e_cortado(self):
        modelo = ModeloFalso([R("Antes, me passa seu CPF completo?")])
        r = simular(ATE_N3 + ["Quero parcelar"], modelo=modelo)
        self.assertEqual(r["turnos"][-1]["falas"][-1]["texto"], M.FIXA_CPF)
        self.assertIn("cpf", r["turnos"][-1]["travas"])


class TestTranscricao(unittest.TestCase):
    def test_transcricao_so_com_a_marca(self):
        s = FX.Sessao(fluxo(), "c", "CLI", VARS, lambda *a: None, None)
        c = ConversaComTurnos(s)
        c.comecar()
        self.assertEqual(c.ouvir(f"é {CPF_FORMATADO}"), [FX.FALA_CPF])
        self.assertNotIn("111", str(c.resumo()))

    def test_roteiro_sem_fluxo_nem_chama_o_modelo(self):
        class Roteiro:
            chamou = False

            def comecar(self):
                return []

            def ouvir(self, texto):
                Roteiro.chamou = True
                return ["ok"]
        c = ConversaComTurnos(Roteiro())
        self.assertEqual(c.ouvir(CPF_SEGUIDO), [FALA_CPF_ROTEIRO])
        self.assertFalse(Roteiro.chamou)
        self.assertNotIn("111", str(c.resumo()))


if __name__ == "__main__":
    unittest.main()
