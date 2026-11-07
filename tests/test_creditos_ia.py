"""Créditos de IA (SQL 78): o plantão estorna as reservas vencidas e nunca para a rotina."""
import unittest

from nuvem import sincronizar


class _Sb:
    def __init__(self, resposta=None, erro=None):
        self.resposta, self.erro, self.chamadas = resposta, erro, []

    def rpc(self, nome, args=None):
        self.chamadas.append((nome, args))
        if self.erro:
            raise self.erro
        return self.resposta


class TestEstornoCreditos(unittest.TestCase):
    def test_estorna_e_avisa(self):
        sb, msgs = _Sb(3), []
        self.assertEqual(sincronizar._estornar_creditos_ia(sb, msgs.append), 3)
        self.assertEqual(sb.chamadas, [("estornar_creditos_ia_vencidos", None)])
        self.assertIn("3 reserva(s)", msgs[0])

    def test_nada_vencido_fica_quieto(self):
        msgs = []
        self.assertEqual(sincronizar._estornar_creditos_ia(_Sb(0), msgs.append), 0)
        self.assertEqual(msgs, [])

    def test_banco_sem_sql78_nao_derruba(self):
        self.assertEqual(sincronizar._estornar_creditos_ia(_Sb(erro=RuntimeError("404")), print), 0)


if __name__ == "__main__":
    unittest.main()
