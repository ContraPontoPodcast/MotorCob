"""Medição da Orquestração para o faturamento por CPF (SQL 69) e dos contratos (informativo)."""
import re
import tempfile
import unittest
from datetime import date
from pathlib import Path

from motor.normalizacao import gerar_cpf
from nuvem.faturamento import (chave_cliente, clientes_avaliados, competencia, contratos_avaliados, corte_da_empresa,
                                publicar_clientes, publicar_clientes_jornada, publicar_contratos, sal_da_empresa)

SAL = "a1" * 32          # sal fictício (o de verdade o banco gera e só a rotina lê)


class SbFalso:
    def __init__(self, corte=None, ciclo=None, sal=SAL):
        self.linhas, self.corte, self.ciclo, self.sal, self.sais_criados = [], corte, ciclo, sal, 0

    def selecionar(self, tabela, filtros, **_):
        if tabela == "faturamento_sal":
            return [{"empresa_id": int(filtros["empresa_id"][3:]), "sal": self.sal}] if self.sal else []
        assert tabela == "ciclo_empresa"
        return [self.ciclo] if self.ciclo else [{"dia_corte": self.corte}] if self.corte else []

    def inserir(self, tabela, linhas, conflito=None, **_):
        if tabela == "faturamento_sal":            # o banco gera o sal (default da coluna)
            assert conflito == "empresa_id" and linhas == [{"empresa_id": linhas[0]["empresa_id"]}]
            self.sais_criados += 1
            self.sal = "b2" * 32
            return
        assert (tabela, conflito) in (("contratos_mes", "empresa_id,competencia,credor_id,contrato"),
                                      ("clientes_mes", "empresa_id,competencia,credor_id,cliente"),
                                      ("jornada_clientes_mes", "empresa_id,competencia,credor_id,id_cliente"))
        self.linhas += [{**l, "_tabela": tabela} for l in linhas]

    def de(self, tabela):
        return [l for l in self.linhas if l["_tabela"] == tabela]


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
        self.cpf1 = gerar_cpf(123456789)            # CPFs fictícios com DV válido
        (base / "contatos.csv").write_text(
            "id_cliente;contato;tipo;origem;cpf\n"
            f"C1;11988887766;telefone;base;{self.cpf1}\nC1;c1@exemplo.test;email;base;{self.cpf1}\n"
            "C2;11977776655;telefone;base;\n", encoding="utf-8")

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
        semanal = {"periodicidade": "dias", "ciclo_dias": 7, "inicio": "2026-10-05"}      # ciclo em dias
        self.assertEqual(competencia(date(2026, 10, 11), semanal), date(2026, 10, 5))
        self.assertEqual(competencia(date(2026, 10, 12), semanal), date(2026, 10, 12))
        self.assertEqual(competencia(date(2026, 10, 20), {"periodicidade": "mensal", "dia_corte": 21}),
                         date(2026, 10, 1))
        self.assertEqual(competencia(date(2026, 10, 20), {}), date(2026, 10, 1))
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
        self.assertEqual(publicar_clientes(SbFalso(), 1, None, Path(self.tmp.name) / "vazio", date(2026, 9, 1)), 0)

    # ------------------------------------------------------------------ Orquestração por CPF (SQL 69)
    def _base(self, clientes: dict[str, list[str]], cpfs: dict[str, str] | None = None, na_carga=None, pasta=None):
        """clientes: id -> contratos; cpfs: id -> CPF fictício; na_carga: ids na carga (None = todos)."""
        pasta = Path(pasta or self.pasta)
        base = pasta / "base"
        base.mkdir(parents=True, exist_ok=True)
        (base / "clientes.csv").write_text("id_cliente;id_contrato;data_entrada;saldo;dias_atraso;bloqueio\n" + "".join(
            f"{i};{ct};2026-09-01;10.00;5;\n" for i, cts in clientes.items() for ct in (cts or [""])), encoding="utf-8")
        (base / "na_carga.csv").write_text("id_cliente\n" + "".join(f"{i}\n" for i in (na_carga or clientes)),
                                           encoding="utf-8")
        (base / "contatos.csv").write_text("id_cliente;contato;tipo;origem;cpf\n" + "".join(
            f"{i};119{n:08d};telefone;base;{(cpfs or {}).get(i, '')}\n" for n, i in enumerate(clientes)), encoding="utf-8")
        return pasta

    def test_cliente_com_varios_contratos_conta_uma_vez(self):
        chaves = clientes_avaliados(self.pasta, SAL)
        self.assertEqual(len(chaves), 2)                         # C1 (2 contratos) e C2; C3 fora da carga
        self.assertEqual(len(contratos_avaliados(self.pasta / "base")), 3)

    def test_chave_nunca_leva_cpf_nem_id(self):
        chaves = clientes_avaliados(self.pasta, SAL)
        for c in chaves:
            self.assertRegex(c, r"^[0-9a-f]{32}$")
        texto = "".join(chaves)
        self.assertNotIn(self.cpf1, texto)
        self.assertNotIn("C1", texto)
        self.assertIsNone(re.search(r"\d{11}", texto))
        # sem o sal não dá para reproduzir: outro sal = outras chaves
        self.assertFalse(chaves & clientes_avaliados(self.pasta, "c3" * 32))

    def test_mesmo_cpf_em_dois_credores_da_mesma_empresa_e_a_mesma_chave(self):
        cpf = gerar_cpf(987654321)
        a = clientes_avaliados(self._base({"A-1": ["X1"]}, {"A-1": cpf}, pasta=self.pasta / "a"), SAL)
        b = clientes_avaliados(self._base({"B-77": ["Y9", "Y10"]}, {"B-77": cpf}, pasta=self.pasta / "b"), SAL)
        self.assertEqual(a, b)
        # sem CPF na carteira, o id_cliente identifica (ids diferentes = clientes diferentes)
        self.assertEqual(chave_cliente(SAL, "C2", {}), chave_cliente(SAL, "C2", {}))
        self.assertNotEqual(chave_cliente(SAL, "C2", {}), chave_cliente(SAL, "C3", {}))

    def test_mesmo_cliente_em_varias_rodadas_do_ciclo_conta_uma_vez(self):
        sb = SbFalso(21)
        self.assertEqual(publicar_clientes(sb, 7, 12, self.pasta, date(2026, 9, 25)), 2)
        self.assertEqual(publicar_clientes(sb, 7, 12, self.pasta, date(2026, 9, 26)), 0)    # mesma carga
        self.assertEqual(publicar_clientes(sb, 7, 12, self.pasta, date(2026, 10, 20)), 0)   # último dia do ciclo
        linhas = sb.de("clientes_mes")
        self.assertEqual(len(linhas), 2)
        self.assertEqual({(l["empresa_id"], l["credor_id"], l["competencia"], l["primeiro_dia"]) for l in linhas},
                         {(7, 12, "2026-10-01", "2026-09-25")})
        self.assertTrue((self.pasta / "estado" / "clientes_2026-10.txt").exists())
        self.assertNotIn(self.cpf1, (self.pasta / "estado" / "clientes_2026-10.txt").read_text())

    def test_dois_ciclos_entra_e_sai(self):
        """Ciclo 1: 4.000 na carteira. Ciclo 2: entram 200, saem 500 no dia 10 → 4.200 no ciclo 2; ciclo 3: 3.700."""
        sb = SbFalso()
        ciclo1 = {f"K{n:05d}": [f"CT{n}"] for n in range(4000)}
        cpfs = {k: gerar_cpf(100000000 + n) for n, k in enumerate(ciclo1)}
        self._base(ciclo1, cpfs)
        for dia in (1, 15, 30):
            publicar_clientes(sb, 7, 0, self.pasta, date(2026, 9, dia))
        novos = {f"N{n:05d}": [f"NT{n}", f"NT{n}B"] for n in range(200)}            # 2 contratos cada
        saem = list(ciclo1)[:500]
        todos = {**ciclo1, **novos}
        cpfs.update({k: gerar_cpf(200000000 + n) for n, k in enumerate(novos)})
        self._base(todos, cpfs)
        publicar_clientes(sb, 7, 0, self.pasta, date(2026, 10, 1))
        self._base(todos, cpfs, na_carga=[k for k in todos if k not in saem])       # pagaram/devolvidos
        publicar_clientes(sb, 7, 0, self.pasta, date(2026, 10, 10))
        publicar_clientes(sb, 7, 0, self.pasta, date(2026, 11, 2))
        por_ciclo = {}
        for l in sb.de("clientes_mes"):
            por_ciclo.setdefault(l["competencia"], set()).add(l["cliente"])
        self.assertEqual({k: len(v) for k, v in por_ciclo.items()},
                         {"2026-09-01": 4000, "2026-10-01": 4200, "2026-11-01": 3700})

    def test_ciclo_em_dias_nao_divide_o_controle_no_mesmo_mes(self):
        sb = SbFalso(ciclo={"periodicidade": "dias", "ciclo_dias": 7, "inicio": "2026-10-05"})
        self.assertEqual(publicar_clientes(sb, 7, 1, self.pasta, date(2026, 10, 6)), 2)
        self.assertEqual(publicar_clientes(sb, 7, 1, self.pasta, date(2026, 10, 13)), 2)   # semana seguinte conta de novo
        self.assertEqual(publicar_contratos(sb, 7, 1, self.pasta, date(2026, 10, 6)), 3)
        self.assertEqual(publicar_contratos(sb, 7, 1, self.pasta, date(2026, 10, 13)), 3)
        self.assertEqual(sorted({l["competencia"] for l in sb.de("clientes_mes")}), ["2026-10-05", "2026-10-12"])

    def test_sal_da_empresa_criado_pelo_banco_quando_falta(self):
        sb = SbFalso(sal=None)
        self.assertEqual(sal_da_empresa(sb, 9), "b2" * 32)
        self.assertEqual(sb.sais_criados, 1)
        self.assertEqual(sal_da_empresa(sb, 9), "b2" * 32)
        self.assertEqual(sb.sais_criados, 1)

    def test_banco_sem_sql69_nao_grava_cliente(self):
        class SemSal(SbFalso):
            def selecionar(self, tabela, filtros, **kw):
                if tabela == "faturamento_sal":
                    raise RuntimeError("relation faturamento_sal does not exist")
                return super().selecionar(tabela, filtros, **kw)
        sb = SemSal()
        with self.assertRaises(RuntimeError):
            publicar_clientes(sb, 7, 1, self.pasta, date(2026, 10, 6))
        self.assertFalse(sb.de("clientes_mes"))
        self.assertFalse((self.pasta / "estado" / "clientes_2026-10.txt").exists())


if __name__ == "__main__":
    unittest.main()
