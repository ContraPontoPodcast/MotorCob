"""B5 · Transferência segura (SPEC §6.1; REVISAO C9 e D8): sem operador, a pessoa volta ao agente, que pede
desculpas e agenda um retorno, também pelo fluxo (voz/fluxo.py) e pela ElevenLabs. Nunca desliga na cara, nunca
transfere de novo na mesma ligação, nada de credor nem dívida na volta. Só dados fictícios."""
import json
import logging
import unittest

from tests.test_voz_fluxo import ATE_N3, HOJE, VARS, conectores, fluxo
from tests.test_voz_orquestrador import Base, item
from voz import conector as CN
from voz import fluxo as FX
from voz.provedores import elevenlabs as EL
from voz.provedores import montagem as M
from voz.provedores.base import ContextoChamada, ProvedorVoz
from voz.segredos import Dicionario

logging.getLogger("motorcx.voz").setLevel(logging.ERROR)


def sessao(falar=None):
    eventos = []
    s = FX.Sessao(fluxo(), "abc123", "C1", VARS, lambda i, t, d: eventos.append((t, d)), CN.ConectoresDeExemplo(None, None),
                  hoje=HOJE)
    s.comecar()
    return s, eventos


class TestFluxoVolta(unittest.TestCase):
    def _transferida(self):
        s, ev = sessao()
        for f in ATE_N3:
            s.ouvir(f)
        s.ouvir("quero falar com um atendente")
        self.assertTrue(s.encerrada and s.aguardando_humano)
        self.assertEqual([t for t, _ in ev].count("transferir"), 1)
        return s, ev

    def test_volta_pede_desculpas_e_agenda(self):
        s, ev = self._transferida()
        real = s.atual
        falas = s.retomar_sem_humano("sem_operador")
        self.assertEqual(falas, [FX.FALA_SEM_HUMANO["sem_operador"]])
        self.assertFalse(s.encerrada or s.aguardando_humano)
        for nome in (VARS["credor"], VARS["saldo"]):                       # nada de credor nem dívida na volta
            self.assertNotIn(nome, " ".join(falas))
        n_passos = [t for t, _ in ev].count("passo")
        f2 = s.ouvir("pode ser sexta às 15h")
        self.assertIn("Combinado: retornamos", f2[0])
        self.assertTrue(s.encerrada)
        res = [d for t, d in ev if t == "resultado"][-1]
        self.assertEqual(res["resultado_ia"], "retorno_agendado")
        self.assertEqual((res["retorno_em"].hour, res["retorno_em"].weekday()), (15, 4))
        self.assertEqual([t for t, _ in ev].count("transferir"), 1)          # nunca a segunda transferência
        self.assertEqual([t for t, _ in ev][-1], "encerrar")
        self.assertEqual([d for t, d in ev if t == "fluxo"][-1]["bloco_final"], real)   # o bloco do fluxo, não o interno
        self.assertEqual([t for t, _ in ev].count("passo"), n_passos)         # sem passo repetido nem do interno

    def test_pedir_humano_de_novo_nao_transfere(self):
        s, ev = self._transferida()
        s.retomar_sem_humano("falhou")
        f = s.ouvir("quero um atendente")
        self.assertEqual(f, [FX.FALA_SEM_HUMANO_DE_NOVO])
        self.assertFalse(s.encerrada)
        s._finalizar("transferir", motivo="pedido_humano")                  # nem por outro caminho
        self.assertEqual([t for t, _ in ev].count("transferir"), 1)
        self.assertEqual([t for t, _ in ev][-1], "encerrar")

    def test_nao_quer_ou_silencio_encerra_educado(self):
        s, ev = self._transferida()
        s.retomar_sem_humano("sem_operador")
        self.assertEqual(s.ouvir("não precisa, obrigado"), [FX.FALA_SEM_HUMANO_FIM])
        self.assertEqual([d for t, d in ev if t == "resultado"][-1]["resultado_ia"], "cpc")   # identidade confirmada
        s2, ev2 = self._transferida()
        s2.retomar_sem_humano("sem_operador")
        self.assertIn(FX.FALA_NAO_OUVI, s2.silencio()[0])
        self.assertEqual(s2.silencio(), [FX.FALA_SEM_HUMANO_FIM])
        self.assertTrue(s2.encerrada)

    def test_so_volta_quem_pediu_humano_e_nunca_com_terceiro(self):
        s, _ = sessao()
        self.assertEqual(s.retomar_sem_humano("sem_operador"), [])
        s2, _ = sessao()
        s2.ouvir("Não, é engano")                                            # terceiro: recado e fim
        s2.aguardando_humano = True
        self.assertEqual(s2.retomar_sem_humano("sem_operador"), [])

    def test_montagem_volta_com_a_sessao_do_fluxo(self):
        cfg = M.ConfigMontagem(portas=(40000, 40003), max_sessoes=5, host_midia="127.0.0.1")
        rodadas, falas = [], []
        mt = M.Montagem(cfg, Dicionario({}), lambda ctx: ("Roteiro", "Alô?"), executor=rodadas.append,
                        fluxo_de=lambda ctx: fluxo(), conectores=CN.ConectoresDeExemplo(),
                        entendedor_de=FX.EntendedorRegras)
        mt.iniciar(ContextoChamada(id_chamada="abc123", empresa_id=1, id_cliente="C1", variaveis=VARS, credor_id=7),
                   lambda *a: None)
        conv = rodadas[0].conversa
        conv.falar_agora = falas.append
        conv.comecar()
        for f in ATE_N3 + ["quero falar com um atendente"]:
            conv.ouvir(f)
        self.assertTrue(mt.retomar_sem_humano("abc123", "sem_operador"))
        self.assertEqual(len(falas), 1)
        self.assertIn("agendar um retorno", falas[0])


class TestElevenLabsVolta(Base):
    def _ate_ponte(self):
        el = EL.ElevenLabs("agente01", espera_resultado_s=120, relogio=lambda: self.rel().timestamp(),
                           ref_webhook="voz/elevenlabs-webhook")           # resultado depois do fim (webhook)
        orq = self.montar([item("C2", "11988887772")], mud=[("voz_config", 0, {"provedor": "elevenlabs"})])
        orq.provedores["elevenlabs"] = el
        orq.tick()
        c = self.originados()[0][2]
        cid = c.rsplit("-", 1)[0]
        self.atender(c)
        self.ev("StasisStart", f"{cid}-p", args=["provedor", cid])
        self.ev("ChannelTransfer", f"{cid}-p",
                refer_to={"requested_destination": {"destination": "sip:transferir-cpc@203.0.113.10"}})
        return el, orq, c, cid

    def test_sem_operador_liga_de_novo_para_o_agente(self):
        el, orq, c, cid = self._ate_ponte()
        self.cair(f"{cid}-h", 17)                                          # a fila do cliente não atendeu
        novo = [x for x in self.ari.de("originar") if x[3][0] == "provedor"][-1]
        self.assertEqual((novo[1], novo[2]), ("PJSIP/agente01@pv-elevenlabs", f"{cid}-q"))
        self.assertEqual(novo[4]["PJSIP_HEADER(add,X-MotorCX-Retorno)"], "sem_operador")
        self.assertEqual(novo[4]["PJSIP_HEADER(add,X-MotorCX-Id)"], f"{cid}r")
        self.assertIn(f"{cid}-p", self.ari.desligados)                      # a conversa antiga sai
        self.assertNotIn(c, self.ari.desligados)                            # a pessoa nunca é desligada
        self.assertEqual(orq.contagem["agente_reconectado"], 1)
        self.ev("StasisStart", f"{cid}-q", args=["provedor", cid])
        self.assertIn(f"{cid}-q", self.ari.pontes[f"{cid}-b"])
        self.cair(f"{cid}-p")                                               # o fim da conversa antiga não derruba
        self.assertNotIn(c, self.ari.desligados)
        # o webhook da conversa antiga (resultado e "encerrar") não vale; o da conversa de retorno, sim
        el.receber([(cid, "encerrar", {}), (cid, "resultado", {"resultado_ia": "cpc"})])
        el.tick(self.rel())
        self.assertNotIn(c, self.ari.desligados)
        self.rel.andar(30)
        self.cair(f"{cid}-q")
        self.cair(c)
        self.assertEqual(self.eventos, [])                                  # espera o resultado do retorno
        el.receber([(f"{cid}r", "resultado", {"resultado_ia": "retorno_agendado", "retorno_em": "2026-11-06T10:00"})])
        el.tick(self.rel())
        ev = self.eventos[0]
        self.assertEqual((ev.desfecho, ev.transferencia), ("retorno_agendado", None))
        self.assertNotIn("abandono", json.dumps(orq.contagem))

    def test_uma_vez_so_e_sem_robo_nao_reconecta(self):
        el, orq, c, cid = self._ate_ponte()
        self.cair(f"{cid}-h", 17)
        self.ev("StasisStart", f"{cid}-q", args=["provedor", cid])
        self.ev("ChannelTransfer", f"{cid}-q",
                refer_to={"requested_destination": {"destination": "sip:transferir-cpc@203.0.113.10"}})
        self.cair(f"{cid}-h", 17)                                          # de novo sem operador: não reconecta 2x
        self.assertEqual(orq.contagem["agente_reconectado"], 1)
        self.assertIn(c, self.ari.desligados)

    def test_provedor_base_nao_reconecta(self):
        self.assertIsNone(ProvedorVoz().reconectar_sem_humano(None, "sem_operador", lambda *a: None))


if __name__ == "__main__":
    unittest.main()
