"""SQL 125 · Agente de voz por minuto falado: onde a VM marca o início e o fim da IA (SPEC §4).

A cobrança para no INÍCIO da transferência (não quando o humano atende); volta a contar quando o agente volta sem
humano; a cadência é aplicada uma vez pelo banco sobre a soma dos trechos; máquina, sem robô e AMD = 0; o toque da
ponte é custo nosso (segundos_sessao_ia). Só dados fictícios."""
import logging
import unittest
from datetime import timedelta

from tests.test_voz_orquestrador import Base, item
from voz import banco as B
from voz import tarifacao as T
from voz.orquestrador.eventos import para_voz_chamadas
from voz.orquestrador.nucleo import Chamada, ia_abrir, ia_fechar, ia_medicao
from voz.provedores import elevenlabs as EL
from voz.provedores.simulador import Simulador

logging.getLogger("motorcx.voz").setLevel(logging.ERROR)


class Medicao(Base):
    """O caminho até a transferência de tests/test_voz_orquestrador.py (o agente fala 31 s e pede o humano)."""

    def _ate_transferir(self, mud=None, provedor=None):
        orq = self.montar([item("C8", "11988887778")], mud=mud, provedor=provedor)   # final 8 = transferir
        orq.tick()
        canal = self.originados()[0][2]
        cid = canal.rsplit("-", 1)[0]
        self.atender(canal)
        orq.tick()
        self.rel.andar(31)
        orq.tick()
        return orq, canal, cid

    def _medir(self, ev):
        return [(round((f - i).total_seconds(), 3), m) for i, f, m in (ev.ia_trechos or [])]

    def test_ponte_com_humano_corta_no_inicio_da_transferencia(self):
        orq, canal, cid = self._ate_transferir()
        self.rel.andar(7)                                     # a fila do cliente toca 7 s (custo nosso)
        self.ev("StasisStart", f"{cid}-h", args=["humano", cid])
        self.rel.andar(120)                                   # conversa com o humano: telefonia, fora da fatura
        self.cair(f"{cid}-h")
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual(self._medir(ev), [(31.0, "transferencia")])
        self.assertEqual(ev.segundos_ia, 31.0)
        self.assertEqual(ev.segundos_sessao_ia, 38.0)         # inclui o toque da ponte até o humano atender
        self.assertEqual(ev.ia_fim_em, ev.transferida_em)     # o fim da IA é o início da transferência
        self.assertIsNone(ev.ia_retomada_em)
        self.assertEqual(T.segundos_tarifados_ia(ev.segundos_ia, 0, 30, 6), 36)

    def test_refer_com_sucesso(self):
        orq, canal, cid = self._ate_transferir([("voz_transferencias", 0, {"metodo": "refer"})])
        self.rel.andar(3)
        self.ev("StasisStart", canal, args=["transferencia", "SUCCESS", "202"])
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.segundos_ia, ev.segundos_sessao_ia), (31.0, 31.0))   # no REFER o agente sai na hora

    def test_refer_que_falha_e_cai_na_ponte_nao_volta_a_contar(self):
        orq, canal, cid = self._ate_transferir([("voz_transferencias", 0, {"metodo": "refer"})])
        self.rel.andar(2)
        self.ev("StasisStart", canal, args=["transferencia", "FAILURE", "486"])
        self.rel.andar(5)
        self.ev("StasisStart", f"{cid}-h", args=["humano", cid])
        self.rel.andar(60)
        self.cair(f"{cid}-h")
        self.cair(canal)
        self.assertEqual(self._medir(self.eventos[0]), [(31.0, "transferencia")])

    def test_sem_humano_com_retorno_soma_os_trechos(self):
        orq, canal, cid = self._ate_transferir()
        self.rel.andar(10)                                    # tocando na fila: não conta
        self.cair(f"{cid}-h", 17)                             # ninguém atendeu: o agente volta
        volta = self.rel.t
        self.rel.andar(20.5)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual(self._medir(ev), [(31.0, "transferencia"), (20.5, "fim")])
        self.assertEqual(ev.segundos_ia, 51.5)
        self.assertEqual(ev.ia_retomada_em, volta)
        self.assertEqual(T.segundos_tarifados_ia(ev.segundos_ia, 0, 30, 6), 54)   # cadência uma vez por ligação

    def test_sem_humano_sem_retorno_abandono(self):
        class SemVolta(Simulador):
            def retomar_sem_humano(self, id_chamada, motivo):
                return False
        orq, canal, cid = self._ate_transferir(provedor=SemVolta())
        self.rel.andar(10)
        self.cair(f"{cid}-h", 17)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.desfecho, ev.segundos_ia), ("transferencia_sem_operador", 31.0))
        self.assertEqual(self._medir(ev), [(31.0, "transferencia")])

    def test_transferencia_que_nem_comeca_continua_o_mesmo_trecho(self):
        orq, canal, cid = self._ate_transferir([("voz_transferencias", 0, {"ativo": False})])   # sem destino
        self.rel.andar(9)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual(self._medir(ev), [(40.0, "fim")])
        self.assertEqual(ev.segundos_ia, 40.0)


class MedicaoSemConversa(Base):
    def test_maquina_e_zero(self):
        orq = self.montar([item()])
        orq.tick()
        canal = self.originados()[0][2]
        self.rel.andar(2)
        self.atender(canal, "MACHINE", "LONGGREETING-1800-1500")
        self.rel.andar(3)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.segundos_ia, ev.ia_trechos, ev.segundos_sessao_ia), (0, None, None))
        self.assertEqual(para_voz_chamadas(ev)["segundos_ia"], 0)

    def test_sem_robo_e_zero(self):
        sim = Simulador(max_simultaneas=1)
        orq = self.montar([item()], provedor=sim)
        orq.tick()
        canal = self.originados()[0][2]
        cid = canal.rsplit("-", 1)[0]
        sim.max_simultaneas = 0
        self.atender(canal)
        self.orq.ao_evento({"type": "PlaybackFinished", "playback": {"id": f"{cid}-semrobo", "state": "done"}})
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.desfecho, ev.segundos_ia, ev.ia_trechos), ("abandono_sem_robo", 0, None))

    def test_nao_atendida_nao_manda_nada(self):
        orq = self.montar([item()])
        orq.tick()
        self.cair(self.originados()[0][2], 19)
        ev = self.eventos[0]
        self.assertIsNone(ev.segundos_ia)
        self.assertIsNone(para_voz_chamadas(ev)["segundos_ia"])

    def test_conversa_inteira_com_o_agente(self):
        orq = self.montar([item("C1", "11988887771")])
        orq.tick()
        canal = self.originados()[0][2]
        self.atender(canal)
        self.rel.andar(47)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual(ev.segundos_ia, 47.0)
        self.assertEqual(T.segundos_tarifados_ia(ev.segundos_ia, 0, 30, 6), 48)
        db = B.para_colunas("voz_chamadas", {k: v for k, v in para_voz_chamadas(ev).items()})
        for k in ("ia_inicio_em", "ia_fim_em", "ia_trechos", "segundos_ia", "segundos_sessao_ia"):
            self.assertIn(k, db)
        self.assertTrue(db["ia_trechos"][0][0].endswith("-03:00"))      # o JSON dos trechos vai com o fuso
        self.assertEqual(db["ia_trechos"][0][2], "fim")


class MedicaoElevenLabs(Base):
    def _conversa(self):
        el = EL.ElevenLabs("agente01", espera_resultado_s=0, relogio=lambda: self.rel().timestamp(),
                           ref_webhook="voz/elevenlabs-webhook")
        orq = self.montar([item("C2", "11988887772")], mud=[("voz_config", 0, {"provedor": "elevenlabs"})])
        orq.provedores["elevenlabs"] = el
        orq.tick()
        c = self.originados()[0][2]
        cid = c.rsplit("-", 1)[0]
        self.rel.andar(1)
        self.atender(c)
        self.rel.andar(2)                                      # o canal SIP do agente ainda não entrou na ponte
        self.ev("StasisStart", f"{cid}-p", args=["provedor", cid])
        return el, orq, c, cid

    def test_queda_do_provedor_fecha_o_trecho(self):
        el, orq, c, cid = self._conversa()
        self.rel.andar(20.25)
        self.cair(f"{cid}-p")                                  # o provedor caiu no meio da conversa
        self.rel.andar(1)
        self.cair(c)
        ev = self.eventos[0]
        self.assertEqual([(round((f - i).total_seconds(), 3), m) for i, f, m in ev.ia_trechos],
                         [(20.25, "agente_encerrou")])
        self.assertEqual(ev.segundos_ia, 20.25)                # só depois que o agente entrou na ponte

    def test_divergencia_com_o_provedor_so_conta(self):
        el, orq, c, cid = self._conversa()
        orq._guardar_resultado(orq.chamadas[cid], {"resultado_ia": "cpc", "duracao_ia_provedor_s": 90.0})
        self.rel.andar(30)
        self.cair(c)
        self.assertEqual(self.eventos[0].segundos_ia, 30.0)
        self.assertEqual(orq.contagem["divergencia_duracao_ia"], 1)

    def test_elevenlabs_manda_a_duracao(self):
        dados = {"analysis": {"data_collection_results": {"resultado": {"value": "cpc"}}},
                 "metadata": {"call_duration_secs": 47}}
        self.assertEqual(EL._resultado("abc", dados)[2]["duracao_ia_provedor_s"], 47.0)


class Trechos(unittest.TestCase):
    def _c(self):
        return Chamada(id="x", empresa_id=1, idx=0, item=None, candidatas=[])

    def test_mais_de_cinco_trechos_somam_no_ultimo(self):
        from datetime import datetime
        c, t = self._c(), datetime(2026, 11, 5, 10)
        c.t_atendeu = c.t_fim = t
        for k in range(7):
            ia_abrir(c, t + timedelta(seconds=10 * k))
            ia_fechar(c, t + timedelta(seconds=10 * k + 4), "transferencia")
        m = ia_medicao(c)
        self.assertEqual(m["segundos_ia"], 28.0)
        self.assertEqual(len(m["ia_trechos"]), 5)

    def test_abrir_duas_vezes_nao_duplica(self):
        from datetime import datetime
        c, t = self._c(), datetime(2026, 11, 5, 10)
        c.t_atendeu = t
        ia_abrir(c, t)
        ia_abrir(c, t + timedelta(seconds=5))
        ia_fechar(c, t + timedelta(seconds=12), "fim")
        ia_fechar(c, t + timedelta(seconds=20), "fim")
        self.assertEqual(ia_medicao(c)["segundos_ia"], 12.0)


if __name__ == "__main__":
    unittest.main()
