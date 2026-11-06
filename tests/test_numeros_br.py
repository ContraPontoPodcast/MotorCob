"""Números em pt-BR nas condições de segmento/persona/estágio (dono: "entre, a vírgula não aceita").

O site grava número (JSON) nas condições numéricas; o motor continua lendo o texto salvo antes do mesmo jeito
(regra antiga não muda de sentido) e passa a aceitar milhar com 2+ pontos e a faixa "está entre" (op `entre`).
"""
import unittest
from datetime import date

from motor.cluster import carregar_personas, carregar_regras, classificar, ler_condicoes, numero
from motor.marcacao import Cliente
from motor.persona import _faixa, condicoes_cluster

DIA = date(2026, 9, 1)


def _cli(saldo, **atrib):
    return Cliente("C1", DIA, saldo, 10, None, 1, atrib)


class TestNumero(unittest.TestCase):
    def test_pt_br(self):
        for texto, esperado in [("1.500,50", 1500.5), ("1500,5", 1500.5), ("1500.50", 1500.5),
                                ("R$ 1.500,50", 1500.5), ("-1.500,50", -1500.5), ("1.000.000", 1e6),
                                ("1.000.000,25", 1000000.25), ("0,5", 0.5), (1500.5, 1500.5), (3000, 3000.0)]:
            self.assertEqual(numero(texto), esperado, texto)

    def test_texto_salvo_antes_mantem_o_sentido(self):
        # Sem vírgula e com um ponto: decimal, como o motor sempre leu (o site agora grava número).
        self.assertEqual(numero("1.500"), 1.5)
        self.assertEqual(numero("1.5"), 1.5)

    def test_invalidos(self):
        for texto in ("", None, "abc", "1.500.00", True):
            self.assertIsNone(numero(texto), texto)


class TestEntre(unittest.TestCase):
    def test_faixa_fechada_com_numeros_do_site(self):
        regras, avisos = carregar_regras([{"codigo": "MED", "condicoes": [
            {"campo": "saldo", "op": "entre", "valor": [1500.5, 3000]}]}])
        self.assertEqual(avisos, [])
        self.assertIsNone(classificar(regras, _cli(1500.49), DIA))
        self.assertEqual(classificar(regras, _cli(1500.5), DIA).codigo, "MED")
        self.assertEqual(classificar(regras, _cli(3000), DIA).codigo, "MED")
        self.assertIsNone(classificar(regras, _cli(3000.01), DIA))

    def test_faixa_em_texto_pt_br_e_atributo_da_carga(self):
        conds, erro = ler_condicoes([{"campo": "RENDA", "op": "entre", "valor": ["1.500,50", "3.000,00"]}])
        self.assertIsNone(erro)
        self.assertEqual(conds[0][2], (1500.5, 3000.0))
        regras, _ = carregar_regras([{"codigo": "R", "condicoes": [
            {"campo": "RENDA", "op": "entre", "valor": "1.500,50;3.000,00"}]}])
        self.assertEqual(classificar(regras, _cli(10, RENDA="2.000,00"), DIA).codigo, "R")
        self.assertIsNone(classificar(regras, _cli(10, RENDA="1.500,49"), DIA))
        self.assertIsNone(classificar(regras, _cli(10, RENDA=""), DIA))

    def test_faixa_invalida_vira_aviso(self):
        for valor in ([3000, 1500], ["abc", 1], [1], "1500"):
            regras, avisos = carregar_regras([{"codigo": "X", "condicoes": [
                {"campo": "saldo", "op": "entre", "valor": valor}]}])
            self.assertEqual(regras, [], valor)
            self.assertEqual(len(avisos), 1, valor)

    def test_persona_do_usuario_com_faixa(self):
        personas, avisos = carregar_personas([{"id": 1, "nome": "Médio", "condicoes": [
            {"campo": "saldo", "op": "entre", "valor": [1500.5, 3000]}]}])
        self.assertEqual((avisos, len(personas)), ([], 1))

    def test_maior_igual_com_virgula_e_milhar(self):
        regras, avisos = carregar_regras([{"codigo": "A", "condicoes": [
            {"campo": "saldo", "op": ">=", "valor": "1.000.000,50"}]}])
        self.assertEqual(avisos, [])
        self.assertEqual(classificar(regras, _cli(1000000.5), DIA).codigo, "A")
        self.assertIsNone(classificar(regras, _cli(1000000.49), DIA))


class TestFaixaDaPersona(unittest.TestCase):
    def test_formato_do_motor(self):
        self.assertEqual(_faixa("até 500"), (None, 500.0))
        self.assertEqual(_faixa("1500.5 a 3000"), (1500.5, 3000.0))
        self.assertEqual(_faixa("acima de 1e+06"), (1e6, None))   # f"{x:g}" de 1 milhão
        self.assertEqual(_faixa("até 1.234"), (None, 1.234))      # ponto do motor = decimal
        self.assertEqual(_faixa("-10 a -2"), (-10.0, -2.0))

    def test_pt_br(self):
        self.assertEqual(_faixa("1.500,50 a 3.000,00"), (1500.5, 3000.0))
        self.assertEqual(_faixa("até 1,5"), (None, 1.5))
        self.assertEqual(_faixa("acima de 2.000,75"), (2000.75, None))

    def test_texto_que_nao_e_faixa(self):
        for v in ("SP", "a a b", "até", "1.5.5 a 2"):
            self.assertIsNone(_faixa(v), v)

    def test_condicoes_cluster_com_virgula(self):
        self.assertEqual(condicoes_cluster([{"campo": "RENDA", "valor": "1.500,50 a 3.000"}]), [
            {"campo": "RENDA", "op": ">", "valor": 1500.5}, {"campo": "RENDA", "op": "<=", "valor": 3000.0}])
        self.assertEqual(condicoes_cluster([{"campo": "RENDA", "valor": "acima de 1e+06"}]), [
            {"campo": "RENDA", "op": ">", "valor": 1e6}])


if __name__ == "__main__":
    unittest.main()
