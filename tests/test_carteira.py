"""Carteira do credor: carga geral, incremental, retirada, acordo e baixa."""
import csv
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path

import rodar_dia
from motor.carteira import montar
from motor.entrada import carregar_entrada
from motor.ingestao import LayoutInvalido

RAIZ = Path(__file__).resolve().parent.parent
EX = RAIZ / "exemplos" / "empresa"
EMPRESA = RAIZ / "empresas" / "exemplo.json"
CAB = "COD_CLIENTE;CONTRATO;CPF;SALDO_DEVEDOR;DT_VENCIMENTO;PRODUTO;UF;TEL1;WHATS_TEL1;TEL2;TEL3;EMAIL;BLOQUEIO\n"


def _ler(p):
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter=";"))


class TestCarteira(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        for d in ("bruto", "incremental", "retirada", "acordo", "baixa"):
            shutil.copytree(EX / d, self.tmp / d)
        self.ent = carregar_entrada(EMPRESA)

    def tearDown(self):
        self._tmp.cleanup()

    def _na_carga(self):
        return {l["id_cliente"] for l in _ler(self.tmp / "base" / "na_carga.csv")}

    def test_estoque_com_os_cinco_arquivos(self):
        rel = montar(self.tmp, self.ent)
        # X0003 retirado (devolução); X0004 entrou na incremental e quitou; X0001 ganhou contrato
        self.assertEqual(self._na_carga(), {"X0001", "X0002"})
        self.assertEqual(rel["retirados"], {"devolução": 1})
        self.assertEqual(rel["quitados"], {"X0004": "2026-09-06"})
        cli = _ler(self.tmp / "base" / "clientes.csv")
        x1 = {l["id_contrato"]: float(l["saldo"]) for l in cli if l["id_cliente"] == "X0001"}
        self.assertEqual(x1, {"CT01": 1000.0, "CT06": 300.0})      # parcial abateu 250,40 do CT01
        parc = _ler(self.tmp / "base" / "parcelas.csv")
        ac = [p for p in parc if p["id_acordo"] == "AC100"]
        self.assertEqual([p["pago_em"] for p in ac], ["2026-09-05", "", ""])   # baixa pagou a 1ª parcela
        self.assertTrue(any(p["id_cliente"] == "X0004" and p["id_acordo"] == "QUITACAO" for p in parc))

    def test_geral_nova_substitui_o_estoque(self):
        (self.tmp / "bruto" / "geral_2026-09-10.csv").write_text(
            CAB + "X0003;CT04;10000003387;5.000,00;10/05/2026;VEICULO;MG;31955550003;S;;;;\n", encoding="utf-8")
        montar(self.tmp, self.ent)
        # X0003 volta com a geral; X0001 sai (não veio); X0002 fica por ter acordo aberto
        self.assertEqual(self._na_carga(), {"X0002", "X0003"})

    def test_retirada_depois_do_acordo_para_tudo(self):
        (self.tmp / "retirada" / "retirada_2026-09-08.csv").write_text(
            "CONTRATO;DT_RETIRADA;MOTIVO\nCT02;08/09/2026;JUD\nCT03;08/09/2026;JUD\n", encoding="utf-8")
        rel = montar(self.tmp, self.ent)
        self.assertNotIn("X0002", self._na_carga())
        self.assertEqual(rel["retirados"]["judicial"], 2)

    def test_arquivo_sem_layout_avisa(self):
        ent = carregar_entrada(EMPRESA)
        from dataclasses import replace
        with self.assertRaises(LayoutInvalido):
            montar(self.tmp, replace(ent, baixa=None))

    def test_motor_liquida_quitado_e_nao_aciona_retirado(self):
        rel = rodar_dia.preparar_carteira(EMPRESA, self.tmp)
        self.assertEqual(rel["na_carga"], 2)
        base = self.tmp / "base"
        r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", self.tmp / "ret", date(2026, 9, 8),
                                parcelas_csv=base / "parcelas.csv", pasta_estado=self.tmp / "estado",
                                pasta_saida=self.tmp / "saida", out=lambda *a: None)
        est = {k: e.estado for k, e in r["estados"].items()}
        self.assertEqual(est["X0004"], "LIQ")
        self.assertIn(est["X0002"], ("COL", "PRE"))
        self.assertFalse({"X0003", "X0004"} & {l["id_cliente"] for l in r["fila"]})



class TestPersonasDaEmpresa(unittest.TestCase):
    """Persona criada pela empresa: perfil do devedor; a esteira manda ação só para ela."""
    def test_persona_filtra_a_acao_e_aparece_no_enquadramento(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            (tmp / "bruto").mkdir()
            (tmp / "bruto" / "carga_2026-09-02.csv").write_text(
                CAB + "A1;K1;;800,00;01/08/2026;CARTAO;SP;11911110001;S;;;;\n"
                      "B1;K2;;9000,00;01/08/2026;VEICULO;RJ;21922220002;S;;;;\n", encoding="utf-8")
            rodar_dia.preparar_carteira(EMPRESA, tmp)
            personas = [{"id": 7, "nome": "Digitais SP", "ordem": 1, "ativo": True,
                         "condicoes": [{"campo": "UF", "op": "=", "valor": "SP"},
                                       {"campo": "tem_whatsapp", "op": "=", "valor": "sim"},
                                       {"campo": "saldo", "op": "<=", "valor": 2000}]}]
            estr = [{"id": 1, "nome": "E", "padrao": True, "definicao": {"localizacao": {"passos": {"1": [
                {"canal": "whatsapp", "modo": "sempre", "personas": [7]},
                {"canal": "sms", "modo": "senao"}]}}}}]
            base = tmp / "base"
            r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", tmp / "ret", date(2026, 9, 2),
                                    pasta_estado=tmp / "estado", pasta_saida=tmp / "saida", out=lambda *a: None,
                                    atributos=base / "atributos.csv", estrategias=estr, personas_usuario=personas)
            canal = {l["id_cliente"]: l["canal"] for l in r["fila"]}
            self.assertEqual(canal, {"A1": "whatsapp", "B1": "sms"})      # B1 fora da persona: senão SMS
            self.assertEqual(r["enquadramento"]["A1"]["persona_usuario"], "Digitais SP")
            self.assertEqual(r["enquadramento"]["B1"]["persona_usuario"], "")
            self.assertEqual(r["clientes"]["B1"].atributos["persona"], "Sem persona")


class TestEnriquecimentoNaEsteira(unittest.TestCase):
    """Enriquecimento como ação da esteira e prioridade dos telefones pelo Score/Ranking do bureau."""
    def _rodar(self, tmp, dia, estr):
        base = tmp / "base"
        return rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", tmp / "ret", dia,
                                   pasta_estado=tmp / "estado", pasta_saida=tmp / "saida", out=lambda *a: None,
                                   estrategias=estr)

    def _carga(self, tmp):
        (tmp / "bruto").mkdir()
        (tmp / "bruto" / "carga_2026-09-02.csv").write_text(
            CAB + "A1;K1;10000001171;800,00;01/08/2026;CARTAO;SP;11911110001;N;11922220002;11933330003;;\n",
            encoding="utf-8")
        rodar_dia.preparar_carteira(EMPRESA, tmp)

    def test_bureau_no_dia_que_a_esteira_mandou(self):
        estr = [{"id": 1, "nome": "E", "padrao": True, "definicao": {"localizacao": {"passos": {
            "1": [{"canal": "sms", "modo": "sempre"}],
            "3": [{"canal": "enriquecimento"}, {"canal": "sms", "modo": "sempre"}]}}}}]
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            self._carga(tmp)
            r = self._rodar(tmp, date(2026, 9, 2), estr)                 # D+1: sem bureau (está no D+3)
            self.assertEqual(r["enriquecimento"], [])
            r = self._rodar(tmp, date(2026, 9, 4), estr)                 # D+3: vai para o bureau
            self.assertEqual([(l["id_cliente"], l["motivo"], l["documento"]) for l in r["enriquecimento"]],
                             [("A1", "esteira localizacao D+3", "10000001171")])
            arq = (tmp / "saida" / "2026-09-04" / "bureau" / "enviar_bureau.csv").read_text()
            self.assertEqual(arq, "CPF_CNPJ;ID_CLIENTE\n10000001171;A1\n")
            self.assertEqual(r["enquadramento"]["A1"]["enriq_enviado"], "2026-09-04")
            self.assertEqual({l["canal"] for l in r["fila"]}, {"sms"})     # o SMS do dia segue

    def test_sem_enriquecimento_na_esteira_vai_na_entrada(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            self._carga(tmp)
            r = self._rodar(tmp, date(2026, 9, 2), [])
            self.assertEqual([l["motivo"] for l in r["enriquecimento"]], ["entrada na carteira (D+1)"])

    def test_prioridade_dos_telefones_pelo_retorno_do_bureau(self):
        from motor.entrada import aplicar_enriquecimento, carregar_entrada
        ent = carregar_entrada(EMPRESA)
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            self._carga(tmp)
            from dataclasses import replace
            cab = replace(ent.enriquecimento[0], emails=[], telefone={"ddd": "DDD", "numero": "FONE",
                                                                       "score": "SCORE", "ranking": "RANKING"})
            # retorno do bureau: ranking 3 / score 2 no 1º número, ranking 1 / score 5 no 3º
            linha = {"CPF/CNPJ": "10000001171", "DDD": ["11", "11", "11"], "FONE": ["911110001", "922220002",
                                                                                   "933330003"],
                     "RANKING": ["3", "2", "1"], "SCORE": ["2", "4", "5"]}
            cols = ["CPF/CNPJ"] + [c for _ in range(3) for c in ("DDD", "FONE", "RANKING", "SCORE")]
            vals = ["10000001171"] + [v for i in range(3) for v in (linha["DDD"][i], linha["FONE"][i],
                                                                     linha["RANKING"][i], linha["SCORE"][i])]
            (tmp / "enr.csv").write_text(";".join(cols) + "\n" + ";".join(vals) + "\n", encoding="utf-8")
            aplicar_enriquecimento([tmp / "enr.csv"], cab, tmp / "base")
            regra = {"criterios": [{"campo": "ranking", "sentido": "asc"}], "score_minimo": 3}
            estr = [{"id": 1, "nome": "E", "padrao": True, "definicao": {
                "prioridade_contatos": regra,
                "localizacao": {"passos": {"1": [{"canal": "sms", "modo": "sempre"}]}}}}]
            r = self._rodar(tmp, date(2026, 9, 2), estr)
            self.assertEqual([l["contato"] for l in r["fila"]], ["11933330003"])   # ranking 1 primeiro
            regra["criterios"] = [{"campo": "score", "sentido": "asc"}]               # score menor (ainda ≥ 3)
            r2 = rodar_dia.rodar_dia(tmp / "base" / "clientes.csv", tmp / "base" / "contatos.csv", tmp / "ret",
                                     date(2026, 9, 2), pasta_estado=tmp / "estado2", pasta_saida=tmp / "s2",
                                     out=lambda *a: None, estrategias=estr)
            self.assertEqual([l["contato"] for l in r2["fila"]], ["11922220002"])  # score 2 ficou de fora


class TestEntreCredores(unittest.TestCase):
    """Mesmo CPF em dois credores: Hot e WhatsApp valem para os dois; 48h contam juntas."""
    def _rodar(self, tmp, comp):
        base = tmp / "base"
        r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", tmp / "ret", date(2026, 9, 2),
                                pasta_estado=tmp / "estado", pasta_saida=tmp / "saida", out=lambda *a: None,
                                compartilhado=comp)
        return [l for l in r["fila"] if l["id_cliente"] == "B1"], r

    def _preparar(self, tmp):
        (tmp / "bruto").mkdir(parents=True)
        (tmp / "bruto" / "carga_2026-09-02.csv").write_text(
            CAB + "B1;K1;10000001171;800,00;01/08/2026;CARTAO;SP;11911110001;N;11922220002;;;\n", encoding="utf-8")
        rodar_dia.preparar_carteira(EMPRESA, tmp)

    def test_hot_de_outro_credor_vai_primeiro_e_48h_pausa(self):
        from motor import normalizacao as norm
        pessoa = norm.chave_pessoa(norm.cpf("10000001171"))
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            self._preparar(tmp)
            fila, r = self._rodar(tmp, {"hot": {(pessoa, "11922220002")}, "whatsapp": {"11922220002"}})
            self.assertTrue(fila)
            self.assertEqual({l["contato"] for l in fila if l["canal"] == "whatsapp"}, {"11922220002"})
            self.assertIn(pessoa, r["compartilhar"]["acionados"])           # este credor também avisa
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            self._preparar(tmp)
            fila, r = self._rodar(tmp, {"acionados": {pessoa: date(2026, 9, 1)}, "whatsapp": {"11922220002"}})
            self.assertEqual(fila, [])
            self.assertTrue(any("OUTRO CREDOR" in a for a in r["alertas"]))
            fila, _ = self._rodar(tmp, {"acionados": {pessoa: date(2026, 8, 30)}, "whatsapp": {"11922220002"}})   # passou das 48h
            self.assertTrue(fila)


if __name__ == "__main__":
    unittest.main()
