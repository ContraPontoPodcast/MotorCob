"""SQL 95 (PR8 do redesenho; SPEC B1 e B2): "Se não entender" e "Se não ouvir nada" no executor (voz/fluxo.py).

Silêncio e "não entendi" contam à parte; cada etapa pode ter fala própria e número de vezes; o silêncio pode ter
saída própria. Sem nada configurado, o "não entendi" é exatamente o de antes. As falas novas passam pelas travas
(trava 1: credor ou valor antes da identidade). O simulador entende a fala "[silêncio]". Só dados fictícios.
"""
import copy
import unittest

from voz import fluxo as FX
from voz import fluxo_casos as C
from voz.provedores import montagem as M
from voz.transcricao.ia import ConversaComTurnos

from tests.test_voz_fluxo import ATE_N3, VARS, fluxo, simular

S = FX.MARCA_SILENCIO


def com(mudar):
    d = C.negociador()
    mudar({b["id"]: b for b in d["blocos"]})
    return fluxo(d)


def falas(r, i=-1):
    return [f["texto"] for f in r["turnos"][i]["falas"]]


class TestNaoEntendi(unittest.TestCase):
    def test_sem_configuracao_e_o_de_antes(self):
        r = simular(ATE_N3 + ["hmm"])
        self.assertEqual(falas(r), [FX.FALA_REPETIR])

    def test_fala_propria_e_vezes(self):
        def m(b):
            b["N3"]["params"]["nao_entendi"] = {"fala": "Não peguei. Quer negociar ou já pagou?", "vezes": 3}
        r = simular(ATE_N3 + ["hmm", "batata"], f=com(m))
        self.assertEqual(falas(r, -2), ["Não peguei. Quer negociar ou já pagou?"])
        self.assertEqual(falas(r), ["Não peguei. Quer negociar ou já pagou?"])   # 3 vezes: ainda pede de novo
        self.assertEqual(r["caminho"][-1], "N3")
        r = simular(ATE_N3 + ["hmm", "batata", "xyz"], f=com(m))
        self.assertEqual(r["caminho"][-1], "N13")

    def test_vezes_vale_mais_que_tentativas(self):
        def m(b):
            b["N3"]["params"]["nao_entendi"] = {"vezes": 1}
        r = simular(ATE_N3 + ["hmm"], f=com(m))
        self.assertEqual(r["caminho"][-1], "N13")

    def test_fala_propria_com_credor_antes_da_identidade_vira_recado(self):
        """O validador recusa o fluxo; se mesmo assim chegasse, a trava 1 troca a fala na hora de falar."""
        d = C.negociador()
        b = {x["id"]: x for x in d["blocos"]}
        b["N1"]["params"]["nao_entendi"] = {"fala": "É sobre a Varejo Aurora. Falo com {{primeiro_nome}}?"}
        s = FX.Sessao(fluxo(copy.deepcopy(C.negociador())), "c", "CLI", VARS, lambda *a: None, None, hoje=None)
        s.blocos["N1"] = b["N1"]
        s._turno = FX.Turno()
        s._entrar("N1")
        t = s.turno("hã?")
        self.assertNotIn("Varejo", " ".join(f for f, _, _ in t.falas))
        self.assertIn("valor_antes_identidade", t.travas)


class TestSilencio(unittest.TestCase):
    def test_abertura_sem_saida_propria_encerra_sem_recado_e_sem_terceiro(self):
        r = simular([S, S])
        self.assertEqual(falas(r, 1), ["Alô? Falo com Ana?"])
        self.assertTrue(r["encerrada"])
        self.assertEqual(r["caminho"], ["N1"])
        self.assertIsNone(r["resultado"])
        tudo = " ".join(f for t in r["turnos"] for f in [x["texto"] for x in t["falas"]])
        self.assertNotIn("retorne", tudo)                     # sem recado neutro
        self.assertNotIn("terceiro", [x for t in r["turnos"] for x in t["travas"]])
        self.assertEqual(r["passos"][-1]["saida_quando"], "silencio")
        self.assertEqual(r["turnos"][1]["pessoa"], S)

    def test_abertura_com_saida_silencio(self):
        def m(b):
            b["N1"]["saidas"].append(C._s("Ninguém fala", "N14", "silencio"))
            b["N1"]["params"]["silencio"] = {"fala": "Alô? Está me ouvindo?", "vezes": 2}
        r = simular([S, S], f=com(m))
        self.assertEqual(falas(r, 1), ["Alô? Está me ouvindo?"])
        self.assertEqual(r["caminho"], ["N1", "N14"])

    def test_silencio_e_nao_entendi_contam_separado(self):
        # N3 tentativas 2: um "hmm" e um silêncio não somam para sair
        r = simular(ATE_N3 + ["hmm", S])
        self.assertEqual(r["caminho"][-1], "N3")
        self.assertTrue(falas(r)[0].startswith(FX.FALA_NAO_OUVI))
        r = simular(ATE_N3 + ["hmm", S, S])
        self.assertEqual(r["caminho"][-1], "N13")          # sem saída silencio: segue a de "não entendi"

    def test_silencio_com_saida_propria_e_fala(self):
        def m(b):
            b["N3"]["params"]["silencio"] = {"fala": "Pode falar, por exemplo: quero negociar.", "vezes": 1}
            b["N3"]["saidas"].append(C._s("Não respondeu", "N9", "silencio"))
        r = simular(ATE_N3 + [S], f=com(m))
        self.assertEqual(r["caminho"][-1], "N9")
        passo = next(p for p in r["passos"] if p["bloco_id"] == "N3")
        self.assertEqual(passo["saida_quando"], "silencio")

    def test_silencio_na_identidade_nao_confirma(self):
        r = simular(["Sou eu", S, S])
        self.assertEqual(r["caminho"], ["N1", "N2", "N14"])
        self.assertEqual(r["resultado"], "recado")

    def test_silencio_na_ia_pergunta_e_depois_transfere(self):
        from tests.test_voz_fluxo import ModeloFalso
        r = simular(ATE_N3 + ["Quero parcelar", S, S], modelo=ModeloFalso([]))
        self.assertIn(FX.FALA_SILENCIO_IA, falas(r, -2))
        self.assertTrue(r["turnos"][-1]["fim"].startswith("transferida"))

    def test_sessao_silencio_direto(self):
        s = FX.Sessao(fluxo(), "c", "CLI", VARS, lambda *a: None, None)
        s.comecar()
        self.assertEqual(s.silencio(), ["Alô? Falo com Ana?"])
        s.silencio()
        self.assertTrue(s.encerrada)
        self.assertEqual(s.silencio(), [])

    def test_conversa_com_turnos_repassa_o_silencio(self):
        s = FX.Sessao(fluxo(), "c", "CLI", VARS, lambda *a: None, None)
        c = ConversaComTurnos(s)
        c.comecar()
        self.assertEqual(c.silencio(), ["Alô? Falo com Ana?"])

        class SemSilencio:
            def comecar(self):
                return []
        self.assertEqual(ConversaComTurnos(SemSilencio()).silencio(), [])


class TestRelogioSilencio(unittest.TestCase):
    def test_conta_so_depois_que_o_agente_cala(self):
        r = M.RelogioSilencio(6.0)
        r.pessoa(0.0)
        self.assertFalse(r.venceu(3.0, falando=True))
        self.assertFalse(r.venceu(8.0, falando=False))     # calou em 3 (último "falando"): conta de 3
        self.assertTrue(r.venceu(9.1, falando=False))
        self.assertFalse(r.venceu(10.0, falando=False))    # disparou: recomeça

    def test_pessoa_falando_zera(self):
        r = M.RelogioSilencio(6.0)
        r.pessoa(0.0)
        r.pessoa(5.0)
        self.assertFalse(r.venceu(10.0, falando=False))
        self.assertTrue(r.venceu(11.0, falando=False))


if __name__ == "__main__":
    unittest.main()
