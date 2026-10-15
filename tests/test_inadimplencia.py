"""Fatura vencida (SQL 37): lembretes pela função de cobrança e inadimplência, uma vez por dia."""
import unittest

from nuvem import sincronizar as S


class SbFalso:
    def __init__(self, pendentes, erro_em=None):
        self.pendentes, self.erro_em, self.funcoes, self.rpcs = pendentes, erro_em, [], []

    def rpc(self, nome, args=None):
        self.rpcs.append(nome)
        if nome == "lembretes_parcelas_para_enviar":
            return [{"parcela_id": 31, "tipo": "d5"}]
        if nome == "acordos_para_informar":
            return [5, {"acordos_para_informar": 6}]
        return self.pendentes if nome == "lembretes_para_enviar" else 2

    def funcao(self, nome, corpo):
        self.funcoes.append((nome, corpo))
        if (self.erro_em and corpo.get("fatura") == self.erro_em) or corpo.get("acordo") == 6:
            raise RuntimeError("sem e-mail para o lembrete")
        return {"enviado_para": ["fin@exemplo.com"]}


class TestInadimplencia(unittest.TestCase):
    def test_lembretes_e_inadimplencia(self):
        sb = SbFalso([{"fatura_id": 7, "tipo": "d1"}, {"fatura_id": 9, "tipo": "d7"}], erro_em=9)
        saida = []
        S._inadimplencia(sb, out=saida.append)
        self.assertEqual(sb.funcoes, [("cobranca", {"acao": "lembrar_fatura", "fatura": 7, "tipo": "d1"}),
                                      ("cobranca", {"acao": "lembrar_fatura", "fatura": 9, "tipo": "d7"}),
                                      ("cobranca", {"acao": "lembrar_parcela", "parcela": 31, "tipo": "d5"})])
        # erro num lembrete não para; a quebra do acordo roda depois dos lembretes, dentro de atualizar_inadimplencia
        self.assertEqual(sb.rpcs, ["lembretes_para_enviar", "lembretes_parcelas_para_enviar", "atualizar_inadimplencia"])
        self.assertTrue(any("lembrete d5 da parcela 31 enviado" in s for s in saida))
        self.assertTrue(any("lembrete d1 da fatura 7 enviado" in s for s in saida))
        self.assertTrue(any("fatura 9 não saiu" in s for s in saida))
        self.assertTrue(any("2 mudança(s) de inadimplência" in s for s in saida))

    def test_email_do_acordo_que_faltou(self):
        sb = SbFalso([])
        saida = []
        S._informar_acordos(sb, out=saida.append)
        self.assertEqual(sb.funcoes, [("cobranca", {"acao": "informar_acordo", "acordo": 5}),
                                      ("cobranca", {"acao": "informar_acordo", "acordo": 6})])
        self.assertTrue(any("e-mail do acordo 5 enviado" in s for s in saida))
        self.assertTrue(any("acordo 6 não saiu" in s for s in saida))      # erro num não para os outros

    def test_banco_sem_o_sql_37(self):
        class Velho:
            def rpc(self, nome, args=None):
                raise RuntimeError("404")
        S._inadimplencia(Velho(), out=lambda *a: None)          # não derruba o plantão
        S._informar_acordos(Velho(), out=lambda *a: None)


if __name__ == "__main__":
    unittest.main()
