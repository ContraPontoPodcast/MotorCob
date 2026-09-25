"""Testes da normalização e da ingestão de retornos. Rodar: python -m unittest"""
import tempfile
import unittest
from datetime import date
from pathlib import Path

from motor import normalizacao as norm
from motor.ingestao import LayoutInvalido, carregar_carteira, carregar_layouts, ingerir_pasta, ler_retorno, validar_layout

RAIZ = Path(__file__).resolve().parent.parent
CPF = norm.gerar_cpf(123456789)
LAYOUT = {
    "fornecedor": "teste", "canal": "discador", "arquivo": "teste_*.csv",
    "delimitador": ";", "decimal": ",", "formato_data": "%d/%m/%Y",
    "colunas": {"id_cliente": "ID_CLI", "contato": "FONE", "data": "DATA", "resultado": "COD", "id_externo": "ID", "custo": "CUSTO"},
    "resultados": {"1": "cpc", "2": "nao_atendida"},
}


class TestNormalizacao(unittest.TestCase):
    def test_cpf(self):
        self.assertEqual(norm.cpf(f"{CPF[:3]}.{CPF[3:6]}.{CPF[6:9]}-{CPF[9:]}"), CPF)
        self.assertIsNone(norm.cpf(CPF[:-1] + str((int(CPF[-1]) + 1) % 10)))
        self.assertIsNone(norm.cpf("111.111.111-11"))

    def test_telefone_formas_diferentes_viram_o_mesmo(self):
        formas = ["(11) 99999-0000", "+55 11 99999-0000", "5511999990000", "011999990000", "11999990000"]
        self.assertEqual({norm.telefone(f) for f in formas}, {"11999990000"})
        self.assertIsNone(norm.telefone("99990000"))

    def test_email(self):
        self.assertEqual(norm.email("  Fulano@Exemplo.COM "), "fulano@exemplo.com")
        self.assertIsNone(norm.email("fulano@"))


class TestLayout(unittest.TestCase):
    def test_layouts_do_repositorio_sao_validos(self):
        self.assertEqual(len(carregar_layouts(RAIZ / "layouts")), 6)

    def test_de_para_para_resultado_fora_da_taxonomia_e_recusado(self):
        with self.assertRaises(LayoutInvalido):
            validar_layout({**LAYOUT, "resultados": {"1": "lido"}})  # "lido" não existe no discador

    def test_sem_custo_e_recusado(self):
        colunas = {k: v for k, v in LAYOUT["colunas"].items() if k != "custo"}
        with self.assertRaises(LayoutInvalido):
            validar_layout({**LAYOUT, "colunas": colunas})


class TestLeitura(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pasta = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def escrever(self, nome, linhas):
        p = self.pasta / nome
        p.write_text("ID_CLI;FONE;DATA;COD;ID;CUSTO\n" + "\n".join(linhas) + "\n", encoding="utf-8")
        return p

    def test_le_normaliza_e_classifica(self):
        p = self.escrever("teste_1.csv", ["C123;(11) 99999-0000;20/09/2026;1;A;0,35"])
        eventos, rel, q = ler_retorno(p, validar_layout(LAYOUT))
        self.assertEqual(rel.aceitas, 1)
        e = eventos[0]
        self.assertEqual((e.id_cliente, e.contato, e.resultado, e.data, e.custo),
                         ("C123", "11999990000", "cpc", date(2026, 9, 20), 0.35))

    def test_codigo_desconhecido_vai_para_quarentena_mascarado(self):
        p = self.escrever("teste_1.csv", ["C123;11999990000;20/09/2026;77;A;0,35"])
        eventos, rel, q = ler_retorno(p, validar_layout(LAYOUT))
        self.assertEqual((eventos, rel.desconhecidos["77"]), ([], 1))
        self.assertNotIn("11999990000", q[0]["contato"])

    def test_rejeicoes_e_duplicadas(self):
        p = self.escrever("teste_1.csv", [
            "C123;11999990000;20/09/2026;1;A;0,35",
            "C123;11999990000;20/09/2026;1;A;0,35",   # reexportação
            f"  ;11999990000;20/09/2026;1;B;0,35",  # sem ID do cliente
            "C123;123;20/09/2026;1;C;0,35",           # telefone inválido
            "C123;11999990000;2026-09-20;1;D;0,35",   # data fora do formato
        ])
        eventos, rel, _ = ler_retorno(p, validar_layout(LAYOUT))
        self.assertEqual((rel.aceitas, rel.duplicadas), (1, 1))
        self.assertEqual(rel.rejeitadas, {"id_cliente inválido": 1, "contato inválido": 1, "data inválida": 1})

    def test_arquivo_sem_layout_nao_e_processado(self):
        self.escrever("teste_1.csv", ["C123;11999990000;20/09/2026;1;A;0,35"])
        (self.pasta / "outro.csv").write_text("x\n")
        eventos, _, _, sem_layout = ingerir_pasta(self.pasta, [validar_layout(LAYOUT)])
        self.assertEqual((len(eventos), sem_layout), (1, ["outro.csv"]))

    def test_coluna_ausente_no_arquivo_falha_alto(self):
        p = self.pasta / "teste_1.csv"
        p.write_text("ID_CLI;FONE\n1;2\n")
        with self.assertRaises(LayoutInvalido):
            ler_retorno(p, validar_layout(LAYOUT))

    def test_carteira_normaliza_e_deduplica(self):
        p = self.pasta / "carteira.csv"
        p.write_text("id_cliente;contato;tipo;origem;cpf\n"
                     f"C1;(11) 99999-0000;telefone;bureau;{CPF}\n"
                     "C1;5511999990000;telefone;cadastro;\n"
                     "C1;x;fax;;\n"
                     f"C2;11988887777;telefone;;{CPF[:3]}.{CPF[3:6]}.{CPF[6:9]}-{CPF[9:]}\n"
                     "C3;11977776666;telefone;;12345678900\n", encoding="utf-8")
        contatos, pessoa_de, rej = carregar_carteira(p)
        self.assertEqual(len(contatos), 3)
        self.assertEqual(rej["tipo inválido"], 1)
        # C1 e C2 são a mesma pessoa; CPF inválido de C3 é ignorado, a linha fica
        self.assertEqual(pessoa_de["C1"], pessoa_de["C2"])
        self.assertNotIn("C3", pessoa_de)
        self.assertNotIn(CPF, str(pessoa_de))

    def test_saidas_nao_carregam_cpf(self):
        import rodar
        from exemplos import gerar_retornos
        with tempfile.TemporaryDirectory() as tmp:
            gerar_retornos.main(seed=5, pasta=Path(tmp), verbose=False)
            rodar.rodar(Path(tmp) / "retornos", Path(tmp) / "carteira_contatos.csv", RAIZ / "layouts",
                        date(2026, 9, 25), Path(tmp) / "saida", out=lambda *a: None)
            cpfs = {l.split(";")[4].strip() for l in (Path(tmp) / "carteira_contatos.csv").read_text().splitlines()[1:]}
            cpfs.discard("")
            for arq in (Path(tmp) / "saida").glob("*.csv"):
                texto = arq.read_text()
                self.assertFalse([c for c in cpfs if c in texto], arq.name)


class TestPontaAPonta(unittest.TestCase):
    def test_arquivos_simulados_rodam_ate_o_plano(self):
        import rodar
        from exemplos import gerar_retornos
        with tempfile.TemporaryDirectory() as tmp:
            gerar_retornos.main(seed=3, pasta=Path(tmp), verbose=False)
            r = rodar.rodar(Path(tmp) / "retornos", Path(tmp) / "carteira_contatos.csv",
                            RAIZ / "layouts", date(2026, 9, 25), Path(tmp) / "saida", out=lambda *a: None)
        self.assertEqual(len(r["relatorios"]), 6)
        self.assertEqual(len(r["sem_layout"]), 1)
        self.assertTrue(r["quarentena"])
        self.assertGreater(r["funil"]["clientes_acionados"], 0)


if __name__ == "__main__":
    unittest.main()
