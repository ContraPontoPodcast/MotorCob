"""Medição de contratos para o faturamento por contrato."""
import tempfile
import unittest
from datetime import date
from pathlib import Path

from nuvem.faturamento import (competencia, contratos_avaliados, corte_da_empresa, publicar_clientes_jornada,
                                publicar_contratos)


class SbFalso:
    def __init__(self, corte=None):
        self.linhas, self.corte = [], corte

    def selecionar(self, tabela, filtros, **_):
        assert tabela == "ciclo_empresa"
        return [{"dia_corte": self.corte}] if self.corte else []

    def inserir(self, tabela, linhas, conflito=None, **_):
        assert (tabela, conflito) in (("contratos_mes", "empresa_id,competencia,credor_id,contrato"),
                                      ("jornada_clientes_mes", "empresa_id,competencia,credor_id,id_cliente"))
        self.linhas += linhas


class TestFaturamento(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pasta = Path(self.tmp.name)
        base = self.pasta / "base"
        base.mkdir()
        (base / "clientes.csv").write_text(
            "id_cliente;id_contrato;data_entrada;saldo;dias_atraso;bloqueio\n"
            "C1;CT-1;2026-09-01;100.00;10;\nC1;CT-2;2026-09-01;50.00;5;\n"
            "C2;;2026-09-01;80.00;3;\nC3;CT-9;2026-09-01;10.00;1;\n", encoding="utf-8")
        (base / "na_carga.csv").write_text("id_cliente\nC1\nC2\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_so_quem_esta_em_cobranca_e_contrato_ou_cliente(self):
        self.assertEqual(contratos_avaliados(self.pasta / "base"), {"CT-1", "CT-2", "cliente:C2"})

    def test_sem_na_carga_conta_a_carteira_toda(self):
        (self.pasta / "base" / "na_carga.csv").unlink()
        self.assertEqual(len(contratos_avaliados(self.pasta / "base")), 4)

    def test_publica_so_o_que_e_novo_no_mes(self):
        sb = SbFalso()
        self.assertEqual(publicar_contratos(sb, 7, 12, self.pasta, date(2026, 9, 25)), 3)
        self.assertEqual({(l["empresa_id"], l["credor_id"], l["competencia"]) for l in sb.linhas},
                         {(7, 12, "2026-09-01")})
        self.assertEqual(publicar_contratos(sb, 7, 12, self.pasta, date(2026, 9, 26)), 0)
        self.assertEqual(publicar_contratos(sb, 7, None, self.pasta, date(2026, 10, 1)), 3)
        self.assertEqual(sb.linhas[-1]["credor_id"], 0)

    def test_ciclo_de_uso_pelo_dia_de_corte(self):
        self.assertEqual(competencia(date(2026, 10, 20)), date(2026, 10, 1))               # mês fechado
        self.assertEqual(competencia(date(2026, 10, 20), 21), date(2026, 10, 1))
        self.assertEqual(competencia(date(2026, 10, 21), 21), date(2026, 11, 1))
        self.assertEqual(competencia(date(2026, 12, 25), 21), date(2027, 1, 1))
        self.assertEqual(corte_da_empresa(SbFalso(15), 1), 15)
        self.assertEqual(corte_da_empresa(SbFalso(), 1), 1)
        self.assertEqual(corte_da_empresa(SbFalso(31), 1), 1)

    def test_contratos_entram_no_ciclo_do_corte(self):
        sb = SbFalso(21)
        publicar_contratos(sb, 7, 12, self.pasta, date(2026, 9, 25))
        self.assertEqual({l["competencia"] for l in sb.linhas}, {"2026-10-01"})

    def test_clientes_da_jornada_uma_vez_por_ciclo(self):
        sb = SbFalso(21)
        fila = [{"id_cliente": "J1", "canal": "sms"}, {"id_cliente": "J1", "canal": "email"}, {"id_cliente": "J2"}]
        self.assertEqual(publicar_clientes_jornada(sb, 7, 12, self.pasta, date(2026, 10, 5), fila), 2)
        self.assertEqual(publicar_clientes_jornada(sb, 7, 12, self.pasta, date(2026, 10, 6), fila), 0)
        self.assertEqual(publicar_clientes_jornada(sb, 7, 12, self.pasta, date(2026, 10, 21), fila), 2)
        self.assertEqual([l["competencia"] for l in sb.linhas], ["2026-10-01"] * 2 + ["2026-11-01"] * 2)

    def test_sem_base_nao_publica(self):
        self.assertEqual(publicar_contratos(SbFalso(), 1, None, Path(self.tmp.name) / "vazio", date(2026, 9, 1)), 0)


if __name__ == "__main__":
    unittest.main()
