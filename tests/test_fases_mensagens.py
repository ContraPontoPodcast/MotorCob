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


if __name__ == "__main__":
    unittest.main()
