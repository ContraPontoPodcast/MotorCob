"""ON/OFF de cada fase da estratégia e frases por estágio × canal no arquivo exportado."""
import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

import rodar_dia
from motor.estrategia import validar_estrategia

RAIZ = Path(__file__).resolve().parent.parent
EMPRESA = RAIZ / "empresas" / "exemplo.json"
CAB = "COD_CLIENTE;CONTRATO;CPF;SALDO_DEVEDOR;DT_VENCIMENTO;PRODUTO;UF;TEL1;WHATS_TEL1;TEL2;TEL3;EMAIL;BLOQUEIO\n"
HOJE = date(2026, 9, 2)


def _rodar(definicao, frases=None):
    tmp = Path(tempfile.mkdtemp())
    (tmp / "bruto").mkdir(parents=True)
    (tmp / "bruto" / "carga_2026-09-01.csv").write_text(
        CAB + "A1;K1;;1234,50;01/08/2026;CARTAO;SP;11988880001;S;;;a1@exemplo.invalid;\n", encoding="utf-8")
    rodar_dia.preparar_base(EMPRESA, tmp / "bruto", tmp / "base")
    estr = [{"id": 7, "nome": "Teste", "padrao": True, "definicao": definicao}]
    return rodar_dia.rodar_dia(tmp / "base" / "clientes.csv", tmp / "base" / "contatos.csv", tmp / "ret", HOJE,
                               pasta_estado=tmp / "estado", pasta_saida=tmp / "saida", estrategias=estr,
                               frases=frases, out=lambda *a: None)


PASSO = {"localizacao": {"passos": {"1": [{"canal": "whatsapp", "modo": "sempre"}]}}}


class TestFases(unittest.TestCase):
    def test_site_grava_on_off_de_cada_fase(self):
        over, erros = validar_estrategia({"localizacao": {"ativo": False}, "giro": {"ativo": "off"},
                                          "cpc": {"ativo": "true"}, "preventivo": {"ativo": True}})
        self.assertEqual(erros, [])
        self.assertEqual((over["localizacao"]["ativo"], over["giro"]["ativo"], over["cpc_ativo"],
                          over["preventivo"]["ativo"]), (False, False, True, True))

    def test_cliente_novo_desligado_nao_aciona_e_explica(self):
        ligado = _rodar(PASSO)
        self.assertEqual([l["canal"] for l in ligado["fila"]], ["whatsapp"])
        desligado = _rodar({"localizacao": {**PASSO["localizacao"], "ativo": False}})
        self.assertEqual(desligado["fila"], [])
        self.assertEqual(desligado["motivos"].get("fase_desligada"), 1)


class TestMensagens(unittest.TestCase):
    def test_frase_do_estagio_sai_na_coluna_mensagem(self):
        r = _rodar({**PASSO, "mensagens": {"localizacao": {
            "WhatsApp": "Olá {nome}; seu saldo é {saldo}, com {dias_atraso} dias em atraso."}}})
        arq = r["saida"] / "ids" / "estrategias"
        ws = next(arq.rglob("1-cliente-novo/whatsapp.csv"))
        linhas = list(csv.reader(ws.read_text(encoding="utf-8").splitlines(), delimiter=";"))
        self.assertEqual(linhas[0], ["id_cliente", "contato", "mensagem"])
        self.assertEqual(linhas[1][0], "A1")
        # {nome} não é do motor (dado pessoal): fica para a ferramenta do canal preencher
        self.assertEqual(linhas[1][2], "Olá {nome}; seu saldo é R$ 1.234,50, com 32 dias em atraso.")
        self.assertIn("Olá", (r["saida"] / "ids" / "whatsapp.csv").read_text(encoding="utf-8"))

    def test_sem_frase_o_arquivo_fica_como_antes(self):
        r = _rodar(PASSO)
        self.assertEqual((r["saida"] / "ids" / "whatsapp.csv").read_text(encoding="utf-8").splitlines()[0],
                         "id_cliente;contato")

    def test_frase_do_playbook(self):
        defin = {**PASSO, "mensagens": {"localizacao": {"whatsapp": {"frase_id": "12"}}}}
        playbook = [{"id": 12, "canal": "whatsapp", "nome": "Boas-vindas", "texto": "Saldo {saldo}. {link}",
                     "ativo": True}]
        r = _rodar(defin, playbook)
        self.assertEqual([l["mensagem"] for l in r["fila"]], ["Saldo R$ 1.234,50. {link}"])
        r = _rodar(defin, [{**playbook[0], "ativo": False}])                # frase desativada não sai
        self.assertEqual([l["mensagem"] for l in r["fila"]], [""])
        self.assertEqual(r["fila"][0]["canal"], "whatsapp")                 # a ação sai mesmo sem frase

    def test_validacao_das_frases(self):
        over, erros = validar_estrategia({"mensagens": {"cpa": {"sms": "Pague {valor_parcela}", "fax": "x"},
                                                        "desconhecido": {"sms": "y"}}})
        self.assertEqual(over["mensagens"], {"cpa": {"sms": "Pague {valor_parcela}"}})
        over, _ = validar_estrategia({"mensagens": {"cpb": {"whatsapp": {"frase_id": 3}}}})
        self.assertEqual(over["mensagens"], {"cpb": {"whatsapp": {"frase_id": 3}}})
        self.assertEqual(len(erros), 2)


class TestFrasePorDia(unittest.TestCase):
    """A frase fica na ação de cada dia da esteira (cada dia pode ter a sua)."""

    def _arquivo(self, r):
        return [l["mensagem"] for l in r["fila"]]

    def test_frase_da_acao_do_dia(self):
        defin = {"localizacao": {"passos": {"1": [{"canal": "whatsapp", "modo": "sempre",
                                                   "mensagem": "Dia 1: saldo {saldo}"}]}}}
        self.assertEqual(self._arquivo(_rodar(defin)), ["Dia 1: saldo R$ 1.234,50"])

    def test_acao_tem_prioridade_sobre_frase_do_estagio(self):
        defin = {"localizacao": {"passos": {"1": [{"canal": "whatsapp", "mensagem": {"frase_id": 5}}]}},
                 "mensagens": {"localizacao": {"whatsapp": "genérica"}}}
        playbook = [{"id": 5, "canal": "whatsapp", "nome": "D1", "texto": "Do playbook {dias_atraso}", "ativo": True}]
        self.assertEqual(self._arquivo(_rodar(defin, playbook)), ["Do playbook 32"])
        # frase do dia desativada: sai sem frase (não cai na genérica do estágio)
        self.assertEqual(self._arquivo(_rodar(defin, [{**playbook[0], "ativo": False}])), [""])
        sem = {"localizacao": {"passos": {"1": [{"canal": "whatsapp"}]}},
               "mensagens": {"localizacao": {"whatsapp": "genérica"}}}
        self.assertEqual(self._arquivo(_rodar(sem)), ["genérica"])   # estratégia antiga continua valendo

    def test_validacao_da_frase_na_acao(self):
        over, erros = validar_estrategia({"giro": {"passos": {
            "1": [{"canal": "sms", "mensagem": "Oi {saldo}"}],
            "2": [{"canal": "persona_1", "mensagem": {"WhatsApp": {"frase_id": "3"}, "sms": "curta", "fax": "x"}}],
            "3": [{"canal": "discador", "mensagem": {"frase_id": "abc"}}]}},
            "cpc": {"ordem": [{"canal": "whatsapp", "mensagem": {"cpa": "negociar", "cpb": {"frase_id": 9}}}]}})
        p = over["giro"]["passos"]
        self.assertEqual(p["1"][0]["mensagem"], "Oi {saldo}")
        self.assertEqual(p["2"][0]["mensagem"], {"whatsapp": {"frase_id": 3}, "sms": "curta"})
        self.assertNotIn("mensagem", p["3"][0])
        self.assertEqual(over["cpc_acoes"]["whatsapp"]["mensagem"], {"cpa": "negociar", "cpb": {"frase_id": 9}})
        self.assertEqual(len(erros), 2)

    def test_mapa_por_canal_e_estagio(self):
        from motor.estrategia import frase_da_acao
        m = {"whatsapp": "w", "cpb": "b"}
        self.assertEqual(frase_da_acao(m, "whatsapp", "cpa"), "w")
        self.assertEqual(frase_da_acao(m, "sms", "cpb"), "b")
        self.assertIsNone(frase_da_acao(m, "sms", "cpa"))
        self.assertEqual(frase_da_acao({"frase_id": 2}, "sms", "cpa"), {"frase_id": 2})


class TestFraseCpc(unittest.TestCase):
    """Deu CPC: frase do canal do CPC (Hot) por canal × CPC A/B, e frase de cada canal da ordem de reserva."""

    def _fila(self, definicao, estado="CPA", canal="whatsapp", tentativas=0):
        from motor.certificacao import Certificacao
        from motor.cluster import carregar_regras
        from motor.fila import gerar_fila
        from motor.marcacao import Cliente, EstadoCliente
        from motor.regua import carregar_regua
        regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
        over, erros = validar_estrategia(definicao)
        self.assertEqual(erros, [])
        regua = carregar_regua().com_clusters(regras, {7: over})
        est = {"C1": EstadoCliente("C1", HOJE, "DG", "DG", "2026-09", estado=estado, canal_atual=canal,
                                   tentativas=tentativas, cluster_versao=regua.versao_clusters)}
        certs = {("C1", c): Certificacao("C1", c, "telefone", "CERTIFICADO", 0.9) for c in ("11988880001",)}
        fila, _, _ = gerar_fila(est, {"C1": Cliente("C1", HOJE, 100.0, 10)},
                                certs, {}, {}, date(2026, 9, 10), regua, [])
        return fila

    def test_frase_do_canal_do_cpc_por_estagio(self):
        from motor.estrategia import frase_da_acao
        d = {"cpc": {"ordem": [{"canal": "sms", "mensagem": "reserva"}],
                     "mensagem_hot": {"whatsapp": {"cpa": "negociar {saldo}", "cpb": "retomar"}, "sms": "hot sms"}}}
        l = self._fila(d)[0]
        self.assertEqual((l["canal"], frase_da_acao(l["frase_acao"], "whatsapp", "cpa")),
                         ("whatsapp", "negociar {saldo}"))
        l = self._fila(d, "CPB", tentativas=1)[0]
        self.assertEqual(frase_da_acao(l["frase_acao"], l["canal"], "cpb"), "retomar")
        l = self._fila(d, "CPB", tentativas=5)[0]                   # trocou de canal: frase da ordem de reserva
        self.assertEqual((l["canal"], l["frase_acao"]), ("sms", "reserva"))

    def test_validacao_frase_hot(self):
        over, erros = validar_estrategia({"cpc": {"mensagem_hot": {"WhatsApp": {"cpa": {"frase_id": "4"}, "x": 1},
                                                                   "sms": "oi"}}})
        self.assertEqual(over["cpc_mensagem_hot"], {"whatsapp": {"cpa": {"frase_id": 4}}, "sms": "oi"})
        self.assertEqual(erros, [])


if __name__ == "__main__":
    unittest.main()
