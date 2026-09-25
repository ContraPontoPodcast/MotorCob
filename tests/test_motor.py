"""Testes dos princípios do motor. Rodar: python -m unittest"""
import unittest
from datetime import date, timedelta

from motor.certificacao import Evento, afinidade_canal, certificar_contatos, hit_rate_por_canal
from motor.priorizacao import planejar
from motor.taxonomia import ResultadoDesconhecido, classificar

HOJE = date(2026, 9, 25)
CUSTOS = {"discador": 0.35, "agente_voz": 0.12, "sms": 0.07, "whatsapp": 0.30, "rcs": 0.12, "email": 0.01}


def ev(resultado, canal="discador", id_cliente="1", contato="11999990000", dias=1, tipo="telefone", **kw):
    return Evento(id_cliente, contato, tipo, canal, resultado, HOJE - timedelta(days=dias), CUSTOS[canal], **kw)


def status(eventos, contatos=None):
    return {k: (c.status, c.score, c.restricoes) for k, c in certificar_contatos(eventos, HOJE, contatos).items()}


class TestCertificacao(unittest.TestCase):
    def test_cpc_certifica(self):
        self.assertEqual(status([ev("cpc")])[("1", "11999990000")][0], "CERTIFICADO")

    def test_engajamento_nao_e_titularidade(self):
        eventos = [ev("lido", "whatsapp", dias=d) for d in range(1, 4)]
        self.assertNotEqual(status(eventos)[("1", "11999990000")][0], "CERTIFICADO")

    def test_sem_conta_restringe_canal_mas_nao_invalida(self):
        st, _, restr = status([ev("sem_conta", "whatsapp")])[("1", "11999990000")]
        self.assertNotEqual(st, "INVALIDO")
        self.assertIn("whatsapp:sem_conta", restr)

    def test_sem_conta_expira(self):
        _, _, restr = status([ev("sem_conta", "whatsapp", dias=200)])[("1", "11999990000")]
        self.assertNotIn("whatsapp:sem_conta", restr)

    def test_evidencia_decai(self):
        recente = status([ev("atendida_terceiro_desconhece", dias=1)])[("1", "11999990000")][1]
        antiga = status([ev("atendida_terceiro_desconhece", dias=365)])[("1", "11999990000")][1]
        self.assertLess(recente, antiga)

    def test_invalido_depois_de_certificado_invalida(self):
        st = status([ev("cpc", dias=100), ev("numero_inexistente", dias=1)])[("1", "11999990000")][0]
        self.assertEqual(st, "INVALIDO")

    def test_reimportacao_nao_infla_evidencia(self):
        e = ev("atendida_sem_cpc", fornecedor="f", id_externo="42")
        self.assertEqual(status([e])[("1", "11999990000")][1], status([e] * 10)[("1", "11999990000")][1])

    def test_certificado_para_outra_pessoa_pesa_contra(self):
        st = status([ev("cpc", id_cliente="A"), ev("entregue", "sms", id_cliente="B")])
        self.assertEqual(st[("A", "11999990000")][0], "CERTIFICADO")
        self.assertIn(st[("B", "11999990000")][0], ("CONTESTADO", "NAO_CONFIRMADO"))
        self.assertLess(st[("B", "11999990000")][1], 0.4)

    def test_outro_id_da_mesma_pessoa_pesa_a_favor(self):
        eventos = [ev("cpc", id_cliente="A"), ev("entregue", "sms", id_cliente="B")]
        mesma = certificar_contatos(eventos, HOJE, pessoa_de={"A": "p1", "B": "p1"})
        outra = certificar_contatos(eventos, HOJE, pessoa_de={"A": "p1", "B": "p2"})
        self.assertGreaterEqual(mesma[("B", "11999990000")].score, 0.7)
        self.assertLess(outra[("B", "11999990000")].score, 0.4)

    def test_cliente_novo_sai_desconhecido(self):
        st = status([], [{"id_cliente": "9", "contato": "x@y.com", "tipo": "email"}])
        self.assertEqual(st[("9", "x@y.com")][0], "DESCONHECIDO")

    def test_resultado_novo_exige_mapeamento(self):
        with self.assertRaises(ResultadoDesconhecido):
            classificar("sms", "status_3")


class TestPriorizacao(unittest.TestCase):
    def plano(self, eventos, contatos=None):
        certs = certificar_contatos(eventos, HOJE, contatos)
        hr = hit_rate_por_canal(eventos)
        return planejar(certs, afinidade_canal(eventos, hr, certs), CUSTOS)

    def test_whatsapp_barrado_sem_certificacao(self):
        eventos = [ev("atendida_sem_cpc"), ev("lido", "whatsapp"), ev("cpc", id_cliente="2", contato="2")]
        plano, bloqueios = self.plano(eventos)
        self.assertFalse([a for a in plano if a["canal"] == "whatsapp" and a["id_cliente"] == "1"])
        self.assertTrue([b for b in bloqueios if b[2] == "whatsapp" and b[3].startswith("risco de banimento")])

    def test_whatsapp_liberado_para_certificado(self):
        eventos = [ev("identidade_confirmada", "whatsapp"), ev("resposta", "whatsapp", dias=3)]
        plano, _ = self.plano(eventos)
        self.assertTrue([a for a in plano if a["canal"] == "whatsapp"])

    def test_contato_invalido_fora_do_plano(self):
        plano, _ = self.plano([ev("numero_inexistente"), ev("cpc", id_cliente="2", contato="2")])
        self.assertFalse([a for a in plano if a["id_cliente"] == "1"])

    def test_cold_start_ordena_por_valor_esperado(self):
        hist = [ev("cpc", id_cliente=str(i), contato=str(i)) for i in range(10)]
        hist += [ev("entregue", "sms", id_cliente=str(i), contato=str(i)) for i in range(10)]
        plano, _ = self.plano(hist, [{"id_cliente": "novo", "contato": "n1", "tipo": "telefone"}])
        acoes = [a for a in plano if a["id_cliente"] == "novo"]
        self.assertEqual(acoes[0]["canal"], "discador")
        self.assertEqual([a["valor_esperado"] for a in acoes],
                         sorted((a["valor_esperado"] for a in acoes), reverse=True))


class TestDemo(unittest.TestCase):
    def test_certificado_acerta_titularidade_e_whatsapp_nao_erra(self):
        import demo
        r = demo.main(seed=7, verbose=False)
        self.assertGreaterEqual(r["qualidade"]["CERTIFICADO"], 0.95)
        self.assertEqual(r["whatsapp_erro"], 0)


if __name__ == "__main__":
    unittest.main()
