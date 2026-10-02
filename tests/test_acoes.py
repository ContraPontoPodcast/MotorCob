import unittest
from datetime import date

from motor.acoes import FORA, agregar, sem_ocorrencia, totais
from motor.certificacao import Evento
from motor.regua import carregar_regua


def esc(d, idc, canal, contato, ordem=1, reserva=0, regua="localizacao", cluster="M1", persona=""):
    return {"data": d, "id_cliente": idc, "canal": canal, "contato": contato, "ordem_contato": str(ordem),
            "reserva": str(reserva), "regua": regua, "cluster": cluster, "persona": persona}


def ev(idc, canal, resultado, d, custo=0.0, contato=""):
    return Evento(idc, contato, "telefone", canal, resultado, d, custo, fornecedor="ocorrencia:x")


class TestAcoes(unittest.TestCase):
    def setUp(self):
        self.regua = carregar_regua()
        self.escolhas = {
            ("2026-09-01", "A"): [esc("2026-09-01", "A", "discador", "1199", 1), esc("2026-09-01", "A", "discador", "1198", 2),
                                  esc("2026-09-01", "A", "whatsapp", "1199")],
            ("2026-09-01", "B"): [esc("2026-09-01", "B", "whatsapp", "1197"),
                                  esc("2026-09-01", "B", "discador", "1197", reserva=1)],
            ("2026-09-02", "B"): [esc("2026-09-02", "B", "whatsapp", "1197", cluster="B2")],
            ("2026-09-02", "C"): [esc("2026-09-02", "C", "sms", "1196", regua="cpc", persona="UF RJ")],
        }

    def _por(self, linhas, **f):
        return [l for l in linhas if all(l[k] == v for k, v in f.items())]

    def test_conta_acao_por_cliente_e_canal(self):
        linhas = agregar(self.escolhas, [], self.regua, {"whatsapp": 0.05, "discador": 0.1})
        d1 = self._por(linhas, data="2026-09-01")
        self.assertEqual(sum(l["enviadas"] for l in self._por(d1, canal="discador")), 1)   # 2 números = 1 ação
        self.assertEqual(sum(l["reservas"] for l in self._por(d1, canal="discador")), 1)   # reserva sem retorno
        self.assertEqual(sum(l["enviadas"] for l in self._por(d1, canal="whatsapp")), 2)
        self.assertEqual(totais(d1)["custo"], 0.2)          # sem retorno: custo do canal
        self.assertEqual(self._por(linhas, canal="sms")[0]["persona"], "UF RJ")

    def test_retorno_cpc_e_primeiro_cpc(self):
        eventos = [ev("A", "discador", "nao_atendida", date(2026, 9, 1), 0.1),
                   ev("A", "discador", "cpc", date(2026, 9, 1), 0.1),
                   ev("B", "discador", "cpc", date(2026, 9, 1), 0.1),          # reserva que foi
                   ev("B", "whatsapp", "entregue", date(2026, 9, 3)),           # ocorrência 1 dia depois
                   ev("Z", "sms", "identidade_confirmada", date(2026, 9, 2), 0.02)]               # fora da lista
        linhas = agregar(self.escolhas, eventos, self.regua, {"whatsapp": 0.05})
        disc = self._por(linhas, data="2026-09-01", canal="discador")
        self.assertEqual(sum(l["enviadas"] for l in disc), 2)
        self.assertEqual(sum(l["retornos"] for l in disc), 3)
        self.assertEqual(sum(l["com_retorno"] for l in disc), 2)
        self.assertEqual(sum(l["cpcs"] for l in disc), 2)
        self.assertAlmostEqual(sum(l["custo"] for l in disc), 0.3)
        # A e B: 1º CPC no discador no dia 1, com 2 ações cada até aquele dia
        self.assertEqual(sum(l["primeiros_cpc"] for l in disc), 2)
        self.assertEqual(sum(l["acoes_ate_primeiro_cpc"] for l in disc), 4)
        wa2 = self._por(linhas, data="2026-09-02", canal="whatsapp")[0]
        self.assertEqual((wa2["cluster"], wa2["com_retorno"]), ("B2", 1))   # casa com a ação mais recente
        fora = self._por(linhas, regua=FORA)[0]
        self.assertEqual((fora["canal"], fora["enviadas"], fora["cpcs"]), ("sms", 0, 1))

    def test_alerta_sem_ocorrencia(self):
        linhas = agregar(self.escolhas, [ev("A", "whatsapp", "lido", date(2026, 9, 1))], self.regua)
        a = sem_ocorrencia(linhas, date(2026, 9, 1))
        self.assertEqual(len(a), 1)
        self.assertIn("discador 1", a[0])
        self.assertNotIn("whatsapp", a[0])
        self.assertEqual(sem_ocorrencia(linhas, date(2026, 9, 5)), [])

    def test_janela_e_sem_dado_pessoal(self):
        linhas = agregar(self.escolhas, [], self.regua, desde=date(2026, 9, 2))
        self.assertEqual({l["data"] for l in linhas}, {"2026-09-02"})
        self.assertFalse({"id_cliente", "contato"} & set(linhas[0]))


if __name__ == "__main__":
    unittest.main()
