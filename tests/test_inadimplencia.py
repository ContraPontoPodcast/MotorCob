"""Fatura vencida (SQL 37): lembretes pela função de cobrança e inadimplência, uma vez por dia."""
import unittest

from nuvem import sincronizar as S


class SbFalso:
    def __init__(self, pendentes, erro_em=None):
        self.pendentes, self.erro_em, self.funcoes, self.rpcs = pendentes, erro_em, [], []

    def rpc(self, nome, args=None):
        self.rpcs.append(nome)
        return self.pendentes if nome == "lembretes_para_enviar" else 2

    def funcao(self, nome, corpo):
        self.funcoes.append((nome, corpo))
        if corpo["fatura"] == self.erro_em:
            raise RuntimeError("sem e-mail para o lembrete")
        return {"enviado_para": ["fin@exemplo.com"]}


class TestInadimplencia(unittest.TestCase):
    def test_lembretes_e_inadimplencia(self):
        sb = SbFalso([{"fatura_id": 7, "tipo": "d1"}, {"fatura_id": 9, "tipo": "d7"}], erro_em=9)
        saida = []
        S._inadimplencia(sb, out=saida.append)
        self.assertEqual(sb.funcoes, [("cobranca", {"acao": "lembrar_fatura", "fatura": 7, "tipo": "d1"}),
                                      ("cobranca", {"acao": "lembrar_fatura", "fatura": 9, "tipo": "d7"})])
        self.assertEqual(sb.rpcs, ["lembretes_para_enviar", "atualizar_inadimplencia"])   # erro num lembrete não para
        self.assertTrue(any("lembrete d1 da fatura 7 enviado" in s for s in saida))
        self.assertTrue(any("fatura 9 não saiu" in s for s in saida))
        self.assertTrue(any("2 mudança(s) de inadimplência" in s for s in saida))

    def test_banco_sem_o_sql_37(self):
        class Velho:
            def rpc(self, nome, args=None):
                raise RuntimeError("404")
        S._inadimplencia(Velho(), out=lambda *a: None)          # não derruba o plantão


if __name__ == "__main__":
    unittest.main()
