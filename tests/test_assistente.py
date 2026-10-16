"""Assistente (SQL 43): cotação PTAX e aviso de teto."""
import unittest
from datetime import date

from nuvem import assistente as AS


class SbFalso:
    def __init__(self, erro=None, ret=0):
        self.rpcs, self.erro, self.ret = [], erro, ret

    def rpc(self, nome, args=None):
        if self.erro:
            raise self.erro
        self.rpcs.append((nome, args))
        return self.ret


class TestAssistente(unittest.TestCase):
    def test_ptax_do_ultimo_dia_util(self):
        dias = {date(2026, 10, 16): 5.4321}                 # sexta; sábado e domingo sem cotação
        self.assertEqual(AS.ptax(date(2026, 10, 19), dias.get), (5.4321, date(2026, 10, 16)))
        self.assertIsNone(AS.ptax(date(2026, 10, 19), lambda d: None))
        self.assertIsNone(AS.ptax(date(2026, 10, 19), lambda d: 999.0))      # valor fora do razoável é ignorado

    def test_cotacao_grava_no_banco(self):
        sb = SbFalso()
        self.assertEqual(AS.cotacao(sb, print, date(2026, 10, 17), lambda d: 5.5), 5.5)
        self.assertEqual(sb.rpcs, [("registrar_cotacao_dolar", {"valor": 5.5, "dia": "2026-10-16"})])

    def test_sem_cotacao_ou_banco_antigo(self):
        msgs = []
        self.assertIsNone(AS.cotacao(SbFalso(), msgs.append, date(2026, 10, 17), lambda d: None))
        self.assertIn("sem cotação", msgs[0])
        self.assertIsNone(AS.cotacao(SbFalso(RuntimeError("função não existe")), print, date(2026, 10, 17), lambda d: 5.0))

    def test_teto(self):
        msgs = []
        self.assertEqual(AS.teto(SbFalso(ret=1), msgs.append), 1)
        self.assertIn("teto", msgs[0])
        self.assertEqual(AS.teto(SbFalso(RuntimeError("x"))), 0)


if __name__ == "__main__":
    unittest.main()
