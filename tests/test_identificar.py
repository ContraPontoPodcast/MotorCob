"""Achar o cliente da carga pelo que o arquivo da empresa trouxe."""
import unittest

from motor.identificar import Identificador


class TestIdentificar(unittest.TestCase):
    def setUp(self):
        self.i = Identificador()
        self.i.incluir("000123", "CT-77", "123.456.789-09")
        self.i.incluir("A55", "CT-88", "98765432100")
        self.i.incluir("B66", "", "98765432100")          # mesmo CPF em dois cadastros

    def test_codigo_exato(self):
        self.assertEqual(self.i.resolver("000123"), ("000123", "codigo"))

    def test_planilha_comeu_o_zero_ou_mudou_a_caixa(self):
        self.assertEqual(self.i.resolver("123"), ("000123", "formatacao"))
        self.assertEqual(self.i.resolver("a55"), ("A55", "formatacao"))

    def test_contrato_na_coluna_do_cliente_ou_na_propria(self):
        self.assertEqual(self.i.resolver("", "CT-77"), ("000123", "contrato"))
        self.assertEqual(self.i.resolver("ct77"), ("000123", "contrato"))

    def test_cpf_com_ou_sem_mascara(self):
        self.assertEqual(self.i.resolver("12345678909"), ("000123", "cpf"))
        self.assertEqual(self.i.resolver("123.456.789-09"), ("000123", "cpf"))

    def test_cpf_de_dois_cadastros_nao_decide(self):
        self.assertEqual(self.i.resolver("987.654.321-00"), (None, "ambiguo"))

    def test_nao_encontrado(self):
        self.assertEqual(self.i.resolver("ZZ9"), (None, "nao_encontrado"))


if __name__ == "__main__":
    unittest.main()
