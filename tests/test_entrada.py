"""Base bruta e ocorrências da empresa cliente (motor/entrada.py)."""
import csv
import tempfile
import unittest
from dataclasses import replace
from datetime import date
from pathlib import Path

import rodar_dia
from motor.entrada import (GENERICOS, carregar_entrada, ingerir_ocorrencias, salvar_escolhas, traduzir,
                           validar_entrada)
from motor.ingestao import LayoutInvalido
from motor.taxonomia import TAXONOMIA

RAIZ = Path(__file__).resolve().parent.parent
EMPRESA = RAIZ / "empresas" / "exemplo.json"
BRUTO = RAIZ / "exemplos" / "empresa" / "bruto"


def _csv(caminho: Path, texto: str):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(texto, encoding="utf-8")
    return caminho


def _ler(caminho: Path):
    with open(caminho, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter=";"))


class TestConfig(unittest.TestCase):
    def test_genericos_existem_na_taxonomia(self):
        for generico, por_canal in GENERICOS.items():
            for canal, resultado in por_canal.items():
                self.assertIn(resultado, TAXONOMIA[canal], f"{generico}/{canal}")
        for canal in TAXONOMIA:  # CPC informado pela empresa certifica em qualquer canal
            self.assertEqual(TAXONOMIA[canal][traduzir(canal, "cpc")].nivel.name, "CERTIFICADO")

    def test_exemplo_valido_e_erros_claros(self):
        ent = carregar_entrada(EMPRESA)
        self.assertEqual(ent.empresa, "exemplo")
        with self.assertRaisesRegex(LayoutInvalido, "resultados sem significado"):
            validar_entrada({"empresa": "x", "base": {"colunas": {"id_cliente": "A", "saldo": "B", "dias_atraso": "C"},
                                                      "telefones": ["T"]},
                             "ocorrencia": {"arquivo": "o*", "colunas": {"id_cliente": "A", "data": "D",
                                                                         "resultado": "R"},
                                            "resultados": {"1": "talvez"}}})
        with self.assertRaisesRegex(LayoutInvalido, "saldo"):
            validar_entrada({"empresa": "x", "base": {"colunas": {"id_cliente": "A"}, "telefones": ["T"]}})


class TestBaseBruta(unittest.TestCase):
    def test_converte_contratos_telefones_e_atraso(self):
        with tempfile.TemporaryDirectory() as tmp:
            rel = rodar_dia.preparar_base(EMPRESA, BRUTO, Path(tmp))
            cli, cont = _ler(Path(tmp) / "clientes.csv"), _ler(Path(tmp) / "contatos.csv")
        self.assertEqual((rel["clientes"], rel["contatos"]), (3, 7))
        x2 = [c for c in cli if c["id_cliente"] == "X0002"]
        self.assertEqual(sorted(c["dias_atraso"] for c in x2), ["15", "62"])  # vencimento → atraso na entrada
        self.assertEqual({c["data_entrada"] for c in cli}, {"2026-09-01"})    # data do nome do arquivo
        self.assertEqual(sum(c["contato"] == "21977770002" for c in cont), 1)  # repetido em 2 contratos
        wa = {c["contato"]: c["whatsapp_valido"] for c in cont}
        self.assertEqual((wa["11988880001"], wa["21977770002"]), ("1", "0"))

    def test_arquivo_novo_atualiza_e_base_completa_tira_quem_saiu(self):
        with tempfile.TemporaryDirectory() as tmp:
            bruto = Path(tmp) / "bruto"
            cab = "COD_CLIENTE;CONTRATO;CPF;SALDO_DEVEDOR;DT_VENCIMENTO;TEL1;WHATS_TEL1;TEL2;TEL3;EMAIL;BLOQUEIO\n"
            _csv(bruto / "base_2026-09-01.csv", cab + "A1;K1;;100,00;22/08/2026;11988880001;S;;;;\n"
                                                      "A2;K2;;200,00;22/08/2026;11988880002;S;;;;\n")
            _csv(bruto / "base_2026-09-10.csv", cab + "A1;K1;;90,00;22/08/2026;11988880001;S;11977770001;;;\n")
            ent = carregar_entrada(EMPRESA)
            ent = replace(ent, base=replace(ent.base, base_completa=True))
            rel = rodar_dia.preparar_base(ent, bruto, Path(tmp) / "base")
            cli = {c["id_cliente"]: c for c in _ler(Path(tmp) / "base" / "clientes.csv")}
        self.assertEqual(rel["fora_da_base"], 1)
        self.assertEqual(cli["A2"]["bloqueio"], "fora_da_base")
        # A1: entrou em 01/09 com 10 dias de atraso; saldo do arquivo mais recente
        self.assertEqual((cli["A1"]["data_entrada"], cli["A1"]["dias_atraso"], cli["A1"]["saldo"]),
                         ("2026-09-01", "10", "90.00"))


class TestOcorrencia(unittest.TestCase):
    def _rodar(self, tmp, dia, ocorrencias=None):
        base = Path(tmp) / "base"
        rodar_dia.preparar_base(EMPRESA, BRUTO, base)
        return rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", Path(tmp) / "ret", dia,
                                   pasta_estado=Path(tmp) / "estado", pasta_saida=Path(tmp) / "saida",
                                   ocorrencias=ocorrencias, entrada=EMPRESA, out=lambda *a: None)

    def test_cpc_sem_contato_no_arquivo_certifica_o_numero_que_o_motor_mandou(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self._rodar(tmp, date(2026, 9, 2))
            ids = (r["saida"] / "ids" / "whatsapp.csv").read_text()
            self.assertIn("X0001;11988880001\n", ids)
            oc = _csv(Path(tmp) / "oc" / "ocorrencia_2026-09-02.csv",
                      "COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;02/09/2026 10:15;WHATS;CPC\n"
                      "X0003;02/09/2026 11:00;WHATS;XPTO\n")
            r = self._rodar(tmp, date(2026, 9, 3), oc.parent)
            est = r["estados"]["X0001"]
            self.assertEqual((est.estado, est.canal_atual, est.contato_localizador), ("CPA", "whatsapp", "11988880001"))
            self.assertEqual(r["relatorios_ocorrencia"][0].contato_identificado, 1)
            self.assertEqual([q["codigo"] for q in r["quarentena"]], ["XPTO"])  # código desconhecido
            # reprocessar com o mesmo arquivo não duplica a evidência
            ent = carregar_entrada(EMPRESA)
            ev, rels, _, _ = ingerir_ocorrencias(oc.parent, ent, Path(tmp) / "estado")
            self.assertEqual(len(ev), 1)

    def test_voz_com_varios_numeros_vale_para_a_tag_mas_nao_certifica_numero(self):
        with tempfile.TemporaryDirectory() as tmp:
            estado = Path(tmp) / "estado"
            salvar_escolhas(estado, date(2026, 9, 5), [
                {"id_cliente": "X0001", "canal": "discador", "contato": "11988880001", "ordem_contato": 1,
                 "condicao": ""},
                {"id_cliente": "X0001", "canal": "discador", "contato": "1133330001", "ordem_contato": 2,
                 "condicao": ""},
                {"id_cliente": "X0003", "canal": "sms", "contato": "31955550003", "ordem_contato": 1, "condicao": ""}])
            _csv(Path(tmp) / "oc" / "ocorrencia_a.csv",
                 "COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\nX0001;05/09/2026 09:00;DISCADOR;CPC\n"
                 "X0003;06/09/2026 09:00;SMS;OPT OUT\nX0003;06/09/2026 09:00;URA;OPT OUT\n")
            ev, rels, q, _ = ingerir_ocorrencias(Path(tmp) / "oc", carregar_entrada(EMPRESA), estado)
        por = {(e.id_cliente, e.canal): e for e in ev}
        self.assertEqual((por[("X0001", "discador")].contato, por[("X0001", "discador")].resultado), ("", "cpc"))
        # SMS do dia anterior: o motor sabe qual número foi usado
        self.assertEqual((por[("X0003", "sms")].contato, por[("X0003", "sms")].resultado), ("31955550003", "opt_out"))
        self.assertEqual(rels[0].rejeitadas["'opt_out' não se aplica a agente_voz"], 1)

    def test_sem_coluna_de_canal_usa_o_canal_que_o_motor_mandou(self):
        with tempfile.TemporaryDirectory() as tmp:
            estado = Path(tmp) / "estado"
            salvar_escolhas(estado, date(2026, 9, 5), [
                {"id_cliente": "X0001", "canal": "email", "contato": "x0001@exemplo.invalid", "ordem_contato": 1,
                 "condicao": ""}])
            _csv(Path(tmp) / "oc" / "retorno_x.csv", "ID;DATA;RES\nX0001;05/09/2026;1\nX0002;05/09/2026;1\n")
            ent = validar_entrada({"empresa": "x", "base": {"colunas": {"id_cliente": "A", "saldo": "B",
                                                                         "dias_atraso": "C"}, "telefones": ["T"]},
                                   "ocorrencia": {"arquivo": "retorno_*", "colunas": {"id_cliente": "ID",
                                                  "data": "DATA", "resultado": "RES"}, "resultados": {"1": "cpc"}}})
            ev, rels, _, _ = ingerir_ocorrencias(Path(tmp) / "oc", ent, estado)
        self.assertEqual([(e.canal, e.contato, e.resultado) for e in ev],
                         [("email", "x0001@exemplo.invalid", "identidade_confirmada")])
        self.assertEqual(rels[0].rejeitadas["sem canal e sem ação do MotorCob na data"], 1)


if __name__ == "__main__":
    unittest.main()
