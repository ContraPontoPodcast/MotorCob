"""Mapeamento da carga geral feito no site (SQL 74): o salvo vence a detecção, a detecção completa o resto, o código
do cliente nunca é a coluna do CPF e a falta de coluna vira uma frase em português (nunca uma lista do Python)."""
import tempfile
import unittest
from pathlib import Path

from motor.detectar import layout_base, sugerir_base
from motor.ingestao import LayoutInvalido
from nuvem.mapeamento import msg_carga

CAB = "IDENT;DOCUMENTO;CT;MONTANTE;QTD_DD;DATA_REF;NUM1;NUM2;CORREIO\n"
LINHAS = ("A1;10000001171;K1;1.234,50;30;01/08/2026;11988880001;1133330001;a1@exemplo.invalid\n"
          "A2;10000002224;K2;380,00;45;15/07/2026;21977770002;;\n")


class TestMapeamentoBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.arq = Path(self.tmp.name) / "carga_2026-09-02.csv"
        self.arq.write_text(CAB + LINHAS, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_sem_mapeamento_a_carga_nao_e_reconhecida(self):
        with self.assertRaises(LayoutInvalido):
            layout_base(self.arq, {})

    def test_sugestao_diz_o_que_falta_sem_erro(self):
        s = sugerir_base(self.arq)
        self.assertEqual(s["cabecalho"], CAB.strip().split(";"))
        self.assertEqual(s["sugerido"].get("cpf"), "DOCUMENTO")
        self.assertEqual(s["faltam"], ["saldo", "atraso", "contato"])
        self.assertNotIn("1.234,50", str(s))                                   # só nomes de coluna

    def test_mapeamento_salvo_monta_o_layout(self):
        fixas = {"id_cliente": "IDENT", "cpf": "DOCUMENTO", "id_contrato": "CT", "saldo": "MONTANTE",
                 "dias_atraso": "QTD_DD", "telefones": ["NUM1", "NUM2"], "emails": ["CORREIO"]}
        exp = {}
        lay = layout_base(self.arq, exp, fixas)
        self.assertEqual(lay["colunas"], {"id_cliente": "IDENT", "saldo": "MONTANTE", "id_contrato": "CT",
                                          "cpf": "DOCUMENTO", "dias_atraso": "QTD_DD"})
        self.assertEqual([t["coluna"] for t in lay["telefones"]], ["NUM1", "NUM2"])
        self.assertEqual(lay["emails"], ["CORREIO"])
        self.assertEqual(exp["saldo"], "MONTANTE (você apontou)")
        self.assertEqual(sugerir_base(self.arq, fixas)["faltam"], [])

    def test_vencimento_apontado_nao_e_trocado_pelo_atraso_detectado(self):
        arq = Path(self.tmp.name) / "c2_2026-09-02.csv"
        arq.write_text("COD_CLIENTE;SALDO;DIAS_ATRASO;VENC_ORIGINAL;TEL1\nA1;10,00;3;01/08/2026;11988880001\n",
                       encoding="utf-8")
        lay = layout_base(arq, {}, {"vencimento": "VENC_ORIGINAL"})
        self.assertEqual(lay["colunas"].get("vencimento"), "VENC_ORIGINAL")
        self.assertNotIn("dias_atraso", lay["colunas"])

    def test_cliente_igual_ao_cpf_e_ignorado(self):
        """O código do cliente nunca é a coluna do CPF: o apontamento é descartado e o motor decide o ID."""
        fixas = {"id_cliente": "DOCUMENTO", "cpf": "DOCUMENTO", "saldo": "MONTANTE", "dias_atraso": "QTD_DD",
                 "telefones": ["NUM1"]}
        lay = layout_base(self.arq, {}, fixas)
        self.assertEqual(lay["colunas"]["cpf"], "DOCUMENTO")
        self.assertNotEqual(lay["colunas"]["id_cliente"], "IDENT (você apontou)")

    def test_coluna_que_sumiu_volta_para_a_deteccao(self):
        lay = layout_base(self.arq, {}, {"saldo": "MONTANTE", "dias_atraso": "QTD_DD", "telefones": ["NUM1"],
                                         "cpf": "CPF_ANTIGO"})
        self.assertEqual(lay["colunas"]["cpf"], "DOCUMENTO")                   # achou pelo nome usual

    def test_mensagem_em_portugues(self):
        msg = msg_carga(["saldo", "contato"], {"saldo": "VL"}, ["COD", "X"], "Banco Horizonte")
        self.assertTrue(msg.startswith("Faltou apontar 2 colunas da carga: o saldo e o telefone ou o e-mail."))
        self.assertIn("não vieram neste arquivo: VL", msg)
        self.assertIn("Carteiras › Banco Horizonte › Configurações › Arquivos", msg)
        self.assertNotIn("[", msg)
        self.assertIn("Faltou apontar 1 coluna da carga: o saldo.", msg_carga(["saldo"], None, []))


if __name__ == "__main__":
    unittest.main()
