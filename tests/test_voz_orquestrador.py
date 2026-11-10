"""Orquestrador ARI do agente de voz (voz/orquestrador) sem Asterisk: ARI falso, relógio falso e Simulador.
Cobre originação por rota/tech prefix, failover, AMD, provedor, transferência (ponte e REFER), Alô fake e
abandono, concorrência/pico/CPS, guarda (janela, tentativas, intervalo, reserva), gravação e o evento lido pelo
motor (motor/entrada.py + motor/voz.py). Só dados fictícios."""
import csv
import logging
import queue
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

from motor import voz as V
from motor.ingestao import carregar_layouts, ingerir_pasta
from tests.test_voz_gerador import dados_exemplo
from voz import banco as B
from voz.orquestrador import amd as A
from voz.orquestrador.agendador import AMOSTRA_MIN_ABANDONO, Agendador
from voz.orquestrador.ari import AriFalso
from voz.orquestrador.eventos import CAMPOS, LAYOUTS, SEM_IA, EscritorEventos, para_voz_chamadas
from voz.orquestrador.gravacao import EnviadorLocal, FilaEnvio
from voz.orquestrador.lote import Guarda, ItemLote, Lote, ler_mailing
from voz.orquestrador.nucleo import Orquestrador
from voz.provedores.simulador import Simulador

logging.getLogger("motorcx.voz").setLevel(logging.ERROR)
D0 = datetime(2026, 11, 3, 10, 0, 0)     # terça
CEL = "11988887770"                      # termina em 0 = cenário cpc do Simulador
BUCKET = "proj-ficticio-motorcx-grav-e1"
RAIZ = Path(__file__).resolve().parent.parent


class Relogio:
    def __init__(self, t=D0):
        self.t = t

    def __call__(self):
        return self.t

    def andar(self, s):
        self.t += timedelta(seconds=s)


def item(idc="C1", tel=CEL, **kw):
    base = dict(janela_local=("08:00", "20:00"), tentativas_max_numero=3, tentativas_max_cliente=6,
                intervalo_min=60, intervalo_ocupado=15, id_acao=f"a-{idc}")
    base.update(kw)
    return ItemLote(id_cliente=idc, telefone=tel, **base)


class Base(unittest.TestCase):
    def montar(self, itens, mud=None, provedor=None, contratado=100, gravar=True, detector=None, guarda=None):
        d = dados_exemplo()
        for tabela, i, campos in mud or []:
            d[tabela][i].update(campos)
        d["voz_config"][0]["gravar"] = gravar
        d["voz_config"][0]["bucket_gravacoes"] = BUCKET
        self.dados = B.carregar(d)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.pasta = Path(self.tmp.name)
        (self.pasta / "spool").mkdir()
        self.ari = AriFalso()
        self.rel = Relogio()
        self.sim = provedor or Simulador()
        self.eventos = []
        ag = Agendador(contratado=contratado)
        ag.registrar_empresa(self.dados.config(1), self.dados.troncos_da(1))
        self.fila = FilaEnvio(EnviadorLocal(self.pasta / "gcs"), pasta=self.pasta / "spool", estavel_s=1)
        self.orq = Orquestrador(self.ari, self.dados, ag, EscritorEventos(self.pasta / "eventos"),
                                {"simulador": self.sim}, self.rel, detector=detector, fila_envio=self.fila,
                                ao_registrar=self.eventos.append)
        self.lote = Lote(1, itens, guarda)
        self.orq.adicionar_lote(self.lote)
        return self.orq

    # atalhos de eventos do Asterisk
    def originados(self):
        return [c for c in self.ari.de("originar") if c[3][0] == "saida"]

    def ev(self, tipo, canal, **kw):
        self.orq.ao_evento({"type": tipo, "channel": {"id": canal}, **kw})

    def atender(self, canal, amd="HUMAN", causa="HUMAN-1-1", khomp=""):
        cid = canal.rsplit("-", 1)[0]
        self.ev("StasisStart", canal, args=["saida", cid])
        self.ev("StasisStart", canal, args=["amd", amd, causa, khomp])

    def cair(self, canal, cause=16, tech=None):
        kw = {"cause": cause}
        if tech is not None:
            kw["tech_cause"] = tech
        self.ev("ChannelDestroyed", canal, **kw)


class TestFluxo(Base):
    def test_maquina(self):
        orq = self.montar([item()])
        self.assertEqual(orq.tick(), 1)
        cmd = self.originados()[0]
        _, endpoint, canal, args, var, callerid, timeout = cmd
        self.assertEqual(endpoint, "PJSIP/101011988887770@tr-1-10")           # tech prefix + DDD + número
        self.assertEqual((var["MOTORCX_AMD"], var["MOTORCX_GRAVAR"], var["MOTORCX_TECH_PREFIX"]), ("1", "1", "1010"))
        self.assertNotIn(CEL, var["MOTORCX_GRAVACAO"])
        self.assertEqual((callerid, timeout), ("1130000000", 40))
        self.rel.andar(12)
        self.ev("StasisStart", canal, args=["saida", args[1]])
        self.assertEqual(self.ari.de("continuar")[-1][1:], (canal, "motorcx-atendeu", "s", 1))
        self.ev("StasisStart", canal, args=["amd", "MACHINE", "LONGGREETING-1800-1500"])
        self.assertIn(canal, self.ari.desligados)
        self.rel.andar(3)
        self.cair(canal, 16)
        ev = self.eventos[0]
        self.assertEqual((ev.desfecho, ev.origem_desfecho, ev.amd, ev.resultado), ("maquina", "rede", "MACHINE", SEM_IA))
        self.assertEqual((ev.billsec, ev.toque, ev.dialstatus), (3, 12, "ANSWER"))
        self.assertEqual((ev.tech_prefix, ev.rota, ev.rota_id, ev.segundos_tarifados, ev.custo_operadora),
                         ("1010", "tr-1-10/1010", 1, 30, 0.025))
        self.assertIsNone(ev.gravacao)                                         # máquina não grava
        self.assertEqual(self.ari.de("criar_ponte"), [])
        it = self.lote.itens[0]
        self.assertEqual((it.tentativas, it.encerrado, it.nao_antes_de), (1, False, self.rel.t + timedelta(minutes=60)))
        self.assertEqual(orq.tick(), 0)                                        # intervalo entre tentativas

    def test_silencio_e_desligou_no_amd(self):
        orq = self.montar([item("C1"), item("C2", "11988887771")])
        orq.tick()
        c1, c2 = (c[2] for c in self.originados())
        self.atender(c1, "MACHINE", "INITIALSILENCE-2500-2500")
        self.cair(c1)
        self.atender(c2, "HANGUP", "")
        self.cair(c2)
        self.assertEqual([e.desfecho for e in self.eventos], ["mudo", "desligou_sem_conversar"])

    def test_pessoa_com_simulador_promessa_e_gravacao(self):
        orq = self.montar([item("C1", "11988887771")])        # final 1 = promessa
        orq.tick()
        canal = self.originados()[0][2]
        cid = canal.rsplit("-", 1)[0]
        self.rel.andar(8)
        self.atender(canal)
        self.assertEqual(self.ari.de("criar_ponte")[0][1], f"{cid}-b")
        self.assertIn(canal, self.ari.pontes[f"{cid}-b"])
        orq.tick()
        self.rel.andar(61)
        orq.tick()                                             # o Simulador encerra
        self.assertIn(canal, self.ari.desligados)
        # o Asterisk grava enquanto a chamada existe; depois do BYE o arquivo fica estável e sobe
        (self.pasta / "spool" / f"{cid}.wav").write_bytes(b"RIFF....WAVEfmt ")
        self.cair(canal, 16)
        ev = self.eventos[0]
        self.assertEqual((ev.resultado, ev.desfecho, ev.origem_desfecho, ev.destino), ("promessa", "promessa", "ia",
                                                                                      "ia"))
        self.assertEqual((ev.valor_promessa, ev.data_promessa, ev.identidade_confirmada),
                         (150.0, date(2026, 11, 6), True))
        self.assertEqual((ev.billsec, ev.segundos_tarifados, ev.custo_operadora), (61, 66, 0.055))
        self.assertEqual(ev.gravacao, f"gs://{BUCKET}/credor_0/2026/11/03/ia_{cid}.wav")
        self.assertEqual(ev.provedor, "simulador")
        self.assertIn(("destruir_ponte", f"{cid}-b"), self.ari.comandos)
        self.assertEqual(self.fila.processar(100.0), [])       # primeira leitura do tamanho
        uris = self.fila.processar(102.0)
        self.assertEqual(len(uris), 1)
        self.assertTrue((self.pasta / "gcs" / BUCKET / f"credor_0/2026/11/03/ia_{cid}.wav").exists())
        self.assertFalse((self.pasta / "spool" / f"{cid}.wav").exists())
        # cliente com contato hoje não recebe outra ligação
        self.assertIn("C1", self.lote.guarda.clientes_encerrados)
        db = para_voz_chamadas(ev)
        self.assertNotIn("numero_discado", db)
        self.assertEqual((db["resultado"], db["tem_gravacao"], db["canal"]), ("promessa", True, "agente_voz"))
        self.assertIsNotNone(db["encerrada_em"])                 # com billsec, o gatilho do banco tarifa
        self.assertEqual(ev.custo_operadora, 0.055)               # no evento (CSV); no banco quem tarifa é o gatilho
        self.assertTrue(set(B.SO_DO_BANCO["voz_chamadas"]).isdisjoint(B.para_colunas("voz_chamadas", db)))

    def test_sem_gravar(self):
        orq = self.montar([item()], gravar=False)
        orq.tick()
        canal = self.originados()[0][2]
        self.assertEqual(self.originados()[0][4]["MOTORCX_GRAVAR"], "0")
        self.atender(canal)
        self.cair(canal)
        self.assertIsNone(self.eventos[0].gravacao)
        self.assertEqual(self.fila.pendentes, {})

    def test_gravar_sem_bucket_alerta_e_nao_grava(self):
        orq = self.montar([item()], mud=[("voz_config", 0, {"bucket_gravacoes": None})])
        self.dados.configs[1] = B.ler_config({**dados_exemplo()["voz_config"][0], "bucket_gravacoes": None})
        orq.tick()
        self.assertEqual(self.originados()[0][4]["MOTORCX_GRAVAR"], "0")
        self.assertTrue(any("sem bucket_gravacoes" in a for a in orq.alertas))

    def test_failover_por_falha_tecnica(self):
        orq = self.montar([item()])
        orq.tick()
        c1 = self.originados()[0][2]
        self.rel.andar(1)
        self.cair(c1, 34)                                       # congestion antes de atender
        orig = self.originados()
        self.assertEqual(len(orig), 2)
        self.assertEqual(orig[1][1], "PJSIP/202011988887770@tr-1-11")
        self.assertTrue(orig[1][2].endswith("-c2"))
        self.assertEqual(self.eventos, [])                      # ainda é a mesma tentativa
        self.assertEqual(orq.agendador.em_voo_tronco, {10: 0, 11: 1})
        self.atender(orig[1][2], "MACHINE", "")
        self.cair(orig[1][2])
        ev = self.eventos[0]
        self.assertEqual((ev.rota, ev.tech_prefix, ev.desfecho, ev.causa_q850), ("tr-1-11/2020", "2020", "maquina", 16))
        self.assertEqual(orq.contagem["failover"], 1)
        self.assertEqual(orq.agendador.em_voo_tronco, {10: 0, 11: 0})

    def test_failover_quando_originate_falha(self):
        orq = self.montar([item()])
        self.ari.falhar_originar.add("PJSIP/101011988887770@tr-1-10")
        self.assertEqual(orq.tick(), 1)
        self.assertEqual(self.originados()[-1][1], "PJSIP/202011988887770@tr-1-11")

    def test_todas_as_rotas_falham_vira_falha_da_operadora(self):
        orq = self.montar([item()])
        orq.tick()
        self.cair(self.originados()[0][2], 34)
        self.cair(self.originados()[1][2], 0, tech=503)
        ev = self.eventos[0]
        self.assertEqual((ev.desfecho, ev.causa_sip, ev.billsec), ("falha_operadora", 503, 0))
        self.assertFalse(self.lote.itens[0].encerrado)          # falha técnica não encerra o número

    def test_inexistente_confirmado(self):
        orq = self.montar([item()])
        orq.tick()
        self.cair(self.originados()[0][2], 1, tech=404)
        self.assertEqual(self.eventos[0].desfecho, "numero_inexistente")
        self.assertTrue(self.lote.itens[0].encerrado)
        self.assertEqual(len(self.originados()), 1)             # inexistente não faz failover

    def test_nao_atendeu_e_ocupado(self):
        orq = self.montar([item("C1"), item("C2", "11988887772", intervalo_ocupado=10)])
        orq.tick()
        c1, c2 = (c[2] for c in self.originados())
        self.rel.andar(40)
        self.cair(c1, 19)
        self.cair(c2, 17, tech=486)
        self.assertEqual([e.desfecho for e in self.eventos], ["nao_atendida", "ocupado"])
        self.assertEqual(self.eventos[0].toque, 40)
        self.assertEqual(self.lote.itens[1].nao_antes_de, self.rel.t + timedelta(minutes=10))
        self.rel.andar(10 * 60)
        self.assertEqual(orq.tick(), 1)                         # o ocupado volta antes
        self.assertEqual(self.originados()[-1][1], "PJSIP/101011988887772@tr-1-10")

    def test_sem_rota(self):
        # sem rota de fixo (a de fixo local virou móvel): o fixo fica fora do dia, o celular sai
        orq = self.montar([item(tel="1133334444"), item("C2")], mud=[("voz_rotas", 3, {"tipo": "movel_vc2_vc3"})])
        self.assertEqual(orq.tick(), 1)
        self.assertEqual(orq.contagem["sem_rota"], 1)
        self.assertTrue(any("sem rota" in a for a in orq.alertas))

    def test_aviso_de_abertura(self):
        """SQL 83 · B6: gravação (se grava e o aviso está ligado, o padrão) + assistente virtual; nunca o credor."""
        import dataclasses
        orq = self.montar([item()])
        orq.tick()
        c = next(iter(orq.chamadas.values()))
        c.item.variaveis = {"assessoria": "Assessoria Alfa", "credor": "Banco Fictício"}
        c.gravando = True
        self.assertEqual(orq._aviso_abertura(c), "Esta ligação é gravada. Sou o assistente virtual da Assessoria Alfa.")
        c.gravando = False
        self.assertEqual(orq._aviso_abertura(c), "Sou o assistente virtual da Assessoria Alfa.")
        c.gravando = True
        orq.dados.configs[1] = dataclasses.replace(orq.dados.config(1), aviso_gravacao=False)
        self.assertEqual(orq._aviso_abertura(c), "Sou o assistente virtual da Assessoria Alfa.")
        self.assertNotIn("Banco", orq._aviso_abertura(c))

    def test_numero_fora_do_plano_nao_sai(self):
        """SQL 83 · B4: 0800, emergência, curto e internacional nunca são originados (nem com rota)."""
        orq = self.montar([item("C1", "08001234567"), item("C2", "190"), item("C3", "+12125550100"),
                           item("C4", "0011987654321"), item("C5", "1133334444")])
        self.assertEqual(orq.tick(), 1)
        self.assertEqual([o[1] for o in self.originados()], ["PJSIP/10121133334444@tr-1-10"])
        self.assertEqual(orq.contagem["numero_bloqueado"], 4)
        self.assertTrue(all("fora do plano de discagem" in a for a in orq.alertas))
        self.assertFalse(any(n in " ".join(orq.alertas) for n in ("1234567", "2125550100", "1987654321")))   # sem o número

    def test_rota_sem_preco_alerta(self):
        orq = self.montar([item()], mud=[("voz_rotas", 0, {"preco_minuto": None})])
        orq.tick()
        self.cair(self.originados()[0][2], 19)
        self.assertIsNone(self.eventos[0].custo_operadora)
        self.assertTrue(any("rota_sem_preco" in a for a in orq.alertas))


class TestTransferencia(Base):
    def _ate_transferir(self, mud=None, provedor=None):
        orq = self.montar([item("C8", "11988887778")], mud=mud, provedor=provedor)     # final 8 = transferir (motivo cpc)
        orq.tick()
        canal = self.originados()[0][2]
        cid = canal.rsplit("-", 1)[0]
        self.atender(canal)
        orq.tick()
        self.rel.andar(31)
        orq.tick()
        return orq, canal, cid

    def test_ponte_atendida(self):
        orq, canal, cid = self._ate_transferir()
        h = [c for c in self.ari.de("originar") if c[3][0] == "humano"][0]
        self.assertEqual(h[1], "PJSIP/fila@tf-1-7")
        self.assertEqual(h[2], f"{cid}-h")
        # só os cabeçalhos que a transferência escolheu no banco (voz_transferencias.cabecalhos)
        self.assertEqual(h[4], {"PJSIP_HEADER(add,X-MotorCX-Id-Chamada)": cid,
                                "PJSIP_HEADER(add,X-MotorCX-Id-Acao)": "a-C8",
                                "PJSIP_HEADER(add,X-MotorCX-Motivo)": "cpc"})
        self.assertFalse(any(CEL[:9] in str(v) for v in h[4].values()))
        self.ev("StasisStart", f"{cid}-h", args=["humano", cid])
        self.assertIn(f"{cid}-h", self.ari.pontes[f"{cid}-b"])
        self.assertNotIn(cid, self.sim.sessoes)                 # a IA saiu
        self.rel.andar(120)
        self.cair(f"{cid}-h")                                   # o operador encerrou
        self.assertIn(canal, self.ari.desligados)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.transferencia, ev.destino, ev.resultado, ev.desfecho), ("atendida", "ia_humano", "cpc",
                                                                                     "cpc"))
        self.assertEqual(ev.billsec, 151)
        db = para_voz_chamadas(ev)                               # a transferência vai nas colunas reais
        self.assertEqual((db["transferencia"], db["destino"]), ("atendida", "ia_humano"))
        self.assertTrue(db["atendida_em"] <= db["transferida_em"] <= db["encerrada_em"])

    def test_ponte_e_o_padrao(self):
        self.assertEqual(B.ler_transferencia({"id": 1, "empresa_id": 1, "destino_sip": "sip:fila@203.0.113.50"}).metodo,
                         "ponte")

    def test_ponte_sem_operador_volta_ao_agente(self):
        # decisão do dono (08/11/2026): ninguém atendeu -> a pessoa volta para o agente, que agenda um retorno
        orq, canal, cid = self._ate_transferir()
        self.cair(f"{cid}-h", 17)
        self.assertEqual(orq.contagem["transferencia_sem_operador_voltou_agente"], 1)
        self.assertNotIn("abandono", orq.contagem)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.transferencia, ev.destino, ev.desfecho), (None, "ia", "retorno_agendado"))
        self.assertIsNotNone(ev.retorno_em)

    def test_ponte_falhou_volta_ao_agente(self):
        orq, canal, cid = self._ate_transferir()
        self.cair(f"{cid}-h", 38)
        self.cair(canal)
        self.assertEqual(orq.contagem["transferencia_falhou_voltou_agente"], 1)
        self.assertEqual((self.eventos[0].transferencia, self.eventos[0].desfecho), (None, "retorno_agendado"))

    def test_provedor_que_nao_volta_vira_transferencia_sem_operador(self):
        class SemVolta(Simulador):
            def retomar_sem_humano(self, id_chamada, motivo):
                return False
        orq, canal, cid = self._ate_transferir(provedor=SemVolta())
        self.cair(f"{cid}-h", 17)
        self.assertIn(canal, self.ari.desligados)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.transferencia, ev.desfecho, ev.origem_desfecho),
                         ("sem_operador", "transferencia_sem_operador", "transferencia"))
        self.assertEqual(orq.contagem["transferencia_sem_operador"], 1)
        # SQL 106: a fila humana cheia não é abandono do discador (não freia o ritmo)
        e = orq.agendador.empresas[1]
        self.assertEqual((e.atendidas_pessoa, e.abandonos), (1, 0))

    def test_refer(self):
        mud = [("voz_transferencias", 0, {"metodo": "refer", "tech_prefix": "77"})]
        orq, canal, cid = self._ate_transferir(mud)
        uri = self.ari.variaveis[(canal, "MOTORCX_TF_URI")]
        self.assertTrue(uri.startswith("sip:77fila@203.0.113.50:5060?X-MotorCX-Id-Chamada=" + cid))
        self.assertIn("X-MotorCX-Motivo=cpc", uri)
        self.assertEqual(self.ari.de("continuar")[-1][1:], (canal, "motorcx-transferir", "refer", 1))
        self.assertNotIn(cid, self.sim.sessoes)
        self.ev("StasisStart", canal, args=["transferencia", "SUCCESS", "202"])
        self.cair(canal)
        self.assertEqual((self.eventos[0].transferencia, self.eventos[0].destino), ("atendida", "ia_humano"))

    def test_refer_recusado_cai_na_ponte(self):
        mud = [("voz_transferencias", 0, {"metodo": "refer"})]
        orq, canal, cid = self._ate_transferir(mud)
        self.ev("StasisStart", canal, args=["transferencia", "FAILURE", "486"])
        self.assertIn(canal, self.ari.pontes[f"{cid}-b"])               # o cliente volta para a ponte
        h = [c for c in self.ari.de("originar") if c[3][0] == "humano"]
        self.assertEqual((h[0][1], h[0][4]["PJSIP_HEADER(add,X-MotorCX-Motivo)"]), ("PJSIP/fila@tf-1-7", "cpc"))
        self.ev("StasisStart", f"{cid}-h", args=["humano", cid])
        self.cair(f"{cid}-h")
        self.cair(canal)
        self.assertEqual((self.eventos[0].transferencia, self.eventos[0].destino), ("atendida", "ia_humano"))
        self.assertEqual(orq.contagem["refer_falhou_ponte"], 1)

    def test_refer_e_ponte_falham(self):
        mud = [("voz_transferencias", 0, {"metodo": "refer"})]
        orq, canal, cid = self._ate_transferir(mud)
        self.ev("StasisStart", canal, args=["transferencia", "FAILURE", "486"])
        self.cair(f"{cid}-h", 17)
        self.cair(canal)
        self.assertEqual((self.eventos[0].transferencia, self.eventos[0].desfecho),
                         ("sem_operador", "transferencia_sem_operador"))

    def test_sem_destino_cadastrado_volta_ao_agente(self):
        mud = [("voz_transferencias", 0, {"ativo": False})]
        orq, canal, cid = self._ate_transferir(mud)
        self.cair(canal)
        self.assertEqual(self.eventos[0].desfecho, "retorno_agendado")
        self.assertTrue(any("sem destino" in a for a in orq.alertas))


class SimuladorQueFalha(Simulador):
    """Provedor que aceita a reserva mas não abre a sessão (erro ao iniciar): o caso de falha do provedor."""

    def iniciar(self, ctx, emitir):
        raise RuntimeError("provedor fora do ar")


class TestAloFakeEAbandono(Base):
    def test_sem_robo_toca_mensagem_e_nao_derruba_mudo(self):
        # a reserva foi feita, mas o provedor perdeu a capacidade antes de a pessoa atender (corrida/falha)
        sim = Simulador(max_simultaneas=1)
        orq = self.montar([item()], provedor=sim)
        orq.tick()
        canal = self.originados()[0][2]
        cid = canal.rsplit("-", 1)[0]
        sim.max_simultaneas = 0
        self.atender(canal)
        self.assertNotIn(canal, self.ari.desligados)            # nunca desliga mudo
        self.assertEqual(self.ari.de("tocar")[0][1:4], (canal, "sound:motorcx/sem-robo", f"{cid}-semrobo"))
        self.assertEqual(orq.agendador.empresas[1].ocupadas, 0)  # a reserva já voltou
        self.orq.ao_evento({"type": "PlaybackFinished", "playback": {"id": f"{cid}-semrobo", "state": "done"}})
        self.assertIn(canal, self.ari.desligados)
        self.cair(canal)
        ev = self.eventos[0]
        self.assertEqual((ev.desfecho, ev.transferencia, ev.origem_desfecho), ("abandono_sem_robo", "sem_robo",
                                                                               "transferencia"))
        db = para_voz_chamadas(ev)
        self.assertEqual((db["resultado"], db["transferencia"]), ("abandono_sem_robo", "sem_robo"))
        self.assertIsNotNone(db["transferida_em"])               # check do banco: transferência exige transferida_em
        self.assertEqual(orq.contagem.get("abandono_sem_robo"), 1)

    def test_alo_fake_segura_e_conecta(self):
        sim = Simulador(max_simultaneas=1)
        mud = [("voz_config", 0, {"alo_fake_liberado": True, "alo_fake": True, "alo_fake_max_s": 4})]
        orq = self.montar([item()], provedor=sim, mud=mud)
        orq.tick()
        canal = self.originados()[0][2]
        sim.max_simultaneas = 0
        self.atender(canal)
        self.assertEqual(self.ari.de("tocar")[0][1:3], (canal, "sound:motorcx/alo"))
        self.rel.andar(2)
        sim.max_simultaneas = 1
        orq.tick()
        self.assertEqual(len(sim.sessoes), 1)
        self.assertNotIn(canal, self.ari.desligados)

    def test_alo_fake_sem_liberacao_da_equipe_nao_toca(self):
        mud = [("voz_config", 0, {"alo_fake_liberado": False, "alo_fake": True})]
        sim = Simulador(max_simultaneas=1)
        orq = self.montar([item()], provedor=sim, mud=mud)
        orq.tick()
        sim.max_simultaneas = 0
        self.atender(self.originados()[0][2])
        self.assertNotIn("sound:motorcx/alo", [t[2] for t in self.ari.de("tocar")])
        self.assertEqual([t[2] for t in self.ari.de("tocar")], ["sound:motorcx/sem-robo"])

    def test_alo_fake_estoura_tempo(self):
        mud = [("voz_config", 0, {"alo_fake_liberado": True, "alo_fake": True, "alo_fake_max_s": 4})]
        sim = Simulador(max_simultaneas=1)
        orq = self.montar([item()], provedor=sim, mud=mud)
        orq.tick()
        canal = self.originados()[0][2]
        sim.max_simultaneas = 0
        self.atender(canal)
        self.rel.andar(4)
        orq.tick()
        self.assertNotIn(canal, self.ari.desligados)            # mensagem antes de desligar
        self.assertEqual(self.ari.de("tocar")[-1][2], "sound:motorcx/sem-robo")
        self.rel.andar(15)                                      # sem o PlaybackFinished: desliga pelo prazo
        orq.tick()
        self.assertIn(canal, self.ari.desligados)
        self.cair(canal)
        self.assertEqual(self.eventos[0].desfecho, "abandono_sem_robo")

    def test_freio_de_abandono(self):
        n = AMOSTRA_MIN_ABANDONO
        itens = [item(f"C{i}", f"119888{i:05d}") for i in range(n + 5)]
        mud = [("voz_config", 0, {"limite_simultaneas": 10, "pico_multiplo": 1, "abandono_max_pct": 3,
                                  "freio_ritmo_pct": 50}),
               ("voz_troncos", 0, {"canais": 100, "cps": 100})]
        orq = self.montar(itens, provedor=SimuladorQueFalha(), mud=mud)
        emp = orq.agendador.empresas[1]
        feitas = 0
        while feitas < n:
            orq.tick()
            for c in list(orq.chamadas.values()):
                self.atender(c.canal)
                self.cair(c.canal)
                feitas += 1
        self.assertTrue(emp.freado)
        self.assertEqual(emp.teto, 5)
        self.assertTrue(any("abandono acima de 3%" in a for a in orq.alertas))
        self.assertEqual(orq.tick(), 5)


class TestConcorrencia(Base):
    def _itens(self, n):
        return [item(f"C{i}", f"119888{i:05d}") for i in range(n)]

    def test_limite_pico_e_canais(self):
        # limite 4, pico ×2 = 8; troncos da empresa 1 têm 5 + 3 canais = 8
        orq = self.montar(self._itens(12), mud=[("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})])
        self.assertEqual(orq.tick(), 8)
        self.assertEqual([c.no_pico for c in orq.chamadas.values()], [False] * 8)   # tocando não é pico
        for c in list(orq.chamadas.values()):
            self.atender(c.canal)                              # o pico é decidido quando a conversa começa
        pico = [c.no_pico for c in orq.chamadas.values()]
        self.assertEqual(sorted(pico), [False] * 4 + [True] * 4)
        self.assertEqual(orq.agendador.em_voo_tronco, {10: 5, 11: 3})
        self.assertEqual(orq.tick(), 0)
        c = next(iter(orq.chamadas.values()))
        self.cair(c.canal, 19)
        self.assertEqual(orq.tick(), 1)

    def test_pico_nunca_passa_dos_canais(self):
        mud = [("voz_config", 0, {"limite_simultaneas": 6, "pico_multiplo": 3}),
               ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})]
        orq = self.montar(self._itens(30), mud=mud)
        self.assertEqual(orq.tick(), 8)

    def test_teto_global(self):
        orq = self.montar(self._itens(12), contratado=3,
                          mud=[("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})])
        self.assertEqual(orq.tick(), 3)

    def test_cps_por_tronco(self):
        mud = [("voz_troncos", 0, {"cps": 1}), ("voz_troncos", 1, {"cps": 1})]
        orq = self.montar(self._itens(10), mud=mud)
        self.assertEqual(orq.tick(), 2)        # 1 por tronco no mesmo segundo
        self.assertEqual(orq.tick(), 0)
        self.rel.andar(1)
        self.assertEqual(orq.tick(), 2)

    def test_rodizio_entre_empresas(self):
        orq = self.montar(self._itens(10), mud=[("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})],
                          contratado=4)
        orq.agendador.registrar_empresa(self.dados.config(2), self.dados.troncos_da(2))
        orq.adicionar_lote(Lote(2, [item(f"E{i}", f"119777{i:05d}") for i in range(10)]))
        orq.tick()
        por_emp = {}
        for c in orq.chamadas.values():
            por_emp[c.empresa_id] = por_emp.get(c.empresa_id, 0) + 1
        self.assertEqual(por_emp, {1: 2, 2: 2})


class TestRobos(Base):
    """Conversas (robôs) separadas das linhas: reserva antes de originar, devolução no AMD e no fim, capacidade do
    provedor na VM, e as travas de linha (canais e CPS) iguais."""

    def _itens(self, n):
        return [item(f"C{i}", f"119888{i:05d}") for i in range(n)]

    def _mud(self, limite, **cfg):
        return [("voz_config", 0, {"limite_simultaneas": limite, "pico_multiplo": 1, **cfg}),
                ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})]

    def test_reserva_antes_de_originar_e_contagem_separada(self):
        orq = self.montar(self._itens(6), mud=self._mud(2))
        emp = orq.agendador.empresas[1]
        self.assertEqual(orq.tick(), 2)
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (2, 2, 0))
        self.assertTrue(all(c.reservada for c in orq.chamadas.values()))
        self.assertEqual(orq.reservas_prov, {"simulador": 2})
        a, b = list(orq.chamadas.values())
        self.atender(a.canal)                                   # pessoa: a reserva vira conversa
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (2, 1, 1))
        self.assertEqual(orq.reservas_prov, {"simulador": 1})
        self.assertEqual(len(self.sim.sessoes), 1)
        self.atender(b.canal, amd="MACHINE", causa="LONGGREETING")   # máquina: o robô volta na hora
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (2, 0, 1))
        self.assertEqual(orq.reservas_prov, {"simulador": 0})
        self.assertEqual(orq.tick(), 1)                         # a linha da máquina ainda está no ar, mas o robô não
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (3, 1, 1))
        self.cair(b.canal)
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (2, 1, 1))
        self.cair(a.canal)
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (1, 1, 0))

    def test_toque_longo_nao_vira_conversa_nem_pico(self):
        orq = self.montar(self._itens(4), mud=self._mud(2))
        orq.tick()
        self.rel.andar(39)
        c = next(iter(orq.chamadas.values()))
        self.cair(c.canal, 19)                                  # não atendeu: reserva volta, sem minuto de pico
        emp = orq.agendador.empresas[1]
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (1, 1, 0))
        self.assertFalse(self.eventos[0].no_pico)

    def test_provedor_cheio_nao_origina(self):
        sim = Simulador(max_simultaneas=1)
        orq = self.montar(self._itens(5), mud=self._mud(10), provedor=sim)
        self.assertEqual(orq.tick(), 1)                         # só uma sessão do provedor na VM
        self.assertGreater(orq.contagem.get("sem_robo_provedor", 0), 0)
        c = next(iter(orq.chamadas.values()))
        self.atender(c.canal)
        self.assertEqual(orq.reservas_prov, {"simulador": 0})
        self.assertEqual(orq.tick(), 0)                         # a sessão está em uso
        self.cair(c.canal)
        self.assertEqual(orq.tick(), 1)

    def test_capacidade_do_provedor_e_compartilhada_entre_empresas(self):
        sim = Simulador(max_simultaneas=3)
        orq = self.montar(self._itens(10), mud=self._mud(10), provedor=sim)
        orq.agendador.registrar_empresa(self.dados.config(2), self.dados.troncos_da(2))
        orq.adicionar_lote(Lote(2, [item(f"E{i}", f"119777{i:05d}") for i in range(10)]))
        orq.tick()
        self.assertEqual(len(orq.chamadas), 3)
        self.assertEqual(orq.reservas_prov, {"simulador": 3})

    def test_falha_do_provedor_ao_abrir_a_sessao(self):
        orq = self.montar([item()], provedor=SimuladorQueFalha())
        orq.tick()
        canal = self.originados()[0][2]
        self.atender(canal)
        emp = orq.agendador.empresas[1]
        self.assertEqual((emp.reservas, emp.conversas), (0, 0))
        self.assertNotIn(canal, self.ari.desligados)
        self.assertEqual(self.ari.de("tocar")[0][2], "sound:motorcx/sem-robo")
        self.assertEqual(self.ari.de("criar_ponte"), [])
        self.assertTrue(any("não abriu a sessão" in a for a in orq.alertas))
        self.rel.andar(15)
        orq.tick()
        self.assertIn(canal, self.ari.desligados)
        self.cair(canal)
        self.assertEqual(self.eventos[0].desfecho, "abandono_sem_robo")

    def test_mensagem_sem_como_tocar_desliga(self):
        from voz.orquestrador.ari import ErroARI
        sim = Simulador(max_simultaneas=1)
        orq = self.montar([item()], provedor=sim)
        orq.tick()
        canal = self.originados()[0][2]
        sim.max_simultaneas = 0

        def falha(*a, **k):
            raise ErroARI("canal sumiu")
        self.ari.tocar = falha
        self.atender(canal)
        self.assertIn(canal, self.ari.desligados)

    def test_pessoa_que_desliga_durante_a_mensagem(self):
        sim = Simulador(max_simultaneas=1)
        orq = self.montar([item()], provedor=sim)
        orq.tick()
        canal = self.originados()[0][2]
        sim.max_simultaneas = 0
        self.atender(canal)
        self.cair(canal)
        self.assertEqual(self.eventos[0].desfecho, "abandono_sem_robo")
        self.assertEqual(orq.chamadas, {})
        emp = orq.agendador.empresas[1]
        self.assertEqual((emp.linhas, emp.reservas, emp.conversas), (0, 0, 0))

    def test_humano_atendeu_na_ponte_libera_o_robo(self):
        orq = self.montar([item("C8", "11988887778")])          # final 8 = transferir
        orq.tick()
        canal = self.originados()[0][2]
        cid = canal.rsplit("-", 1)[0]
        self.atender(canal)
        emp = orq.agendador.empresas[1]
        self.assertEqual(emp.conversas, 1)
        orq.tick()
        self.rel.andar(31)
        orq.tick()
        self.ev("StasisStart", f"{cid}-h", args=["humano", cid])
        self.assertEqual((emp.linhas, emp.conversas), (1, 0))   # a linha segue com o humano; o robô está livre

    def test_reduzir_o_limite_nao_derruba_quem_ja_reservou(self):
        orq = self.montar(self._itens(4), mud=self._mud(2))
        orq.tick()
        from dataclasses import replace
        cfg = replace(self.dados.config(1), limite_simultaneas=0)   # limite novo (ou freio): só para conversas novas
        orq.agendador.atualizar_empresa(cfg, self.dados.troncos_da(1))
        self.assertEqual(orq.tick(), 0)
        for c in list(orq.chamadas.values()):
            self.atender(c.canal)
        self.assertEqual(len(self.sim.sessoes), 2)              # quem atendeu tem robô
        self.assertEqual(self.ari.de("tocar"), [])

    def test_travas_de_linha_iguais(self):
        # canais do tronco (5 + 3) e CPS continuam limitando as linhas, mesmo com robôs sobrando
        orq = self.montar(self._itens(20), mud=self._mud(50))
        self.assertEqual(orq.tick(), 8)
        self.assertEqual(orq.agendador.em_voo_tronco, {10: 5, 11: 3})
        orq2 = self.montar(self._itens(20), mud=[("voz_config", 0, {"limite_simultaneas": 50}),
                                                 ("voz_troncos", 0, {"cps": 1}), ("voz_troncos", 1, {"cps": 1})])
        self.assertEqual(orq2.tick(), 2)


class TestAgendadorRobos(unittest.TestCase):
    def _ag(self, limite=2, canais=10, contratado=100):
        d = dados_exemplo()
        d["voz_config"][0].update({"limite_simultaneas": limite, "pico_multiplo": 1})
        dados = B.carregar(d)
        ag = Agendador(contratado=contratado)
        ag.registrar_empresa(dados.config(1), dados.troncos_da(1))
        ag.empresas[1].canais = canais
        return ag

    def test_razao_padrao_e_um_para_um(self):
        ag = self._ag()
        e = ag.empresas[1]
        self.assertEqual(e.razao, 1.0)
        self.assertTrue(ag.ocupar(1, 10))
        self.assertTrue(ag.ocupar(1, 10))
        self.assertFalse(ag.vaga_empresa(1))                    # 2 robôs reservados = limite
        self.assertEqual(ag.conversar(1, reservada=True), False)
        self.assertEqual((e.linhas, e.reservas, e.conversas), (2, 1, 1))

    def test_sem_reserva_nunca_toma_o_robo_de_quem_reservou(self):
        ag = self._ag()
        ag.ocupar(1, 10)
        ag.ocupar(1, 10)
        self.assertIsNone(ag.conversar(1, reservada=False))

    def test_teto_global_conta_conversas(self):
        ag = self._ag(limite=5, contratado=2)
        ag.ocupar(1, 10)
        ag.conversar(1, reservada=True)
        ag.ocupar(1, 10)
        self.assertFalse(ag.vaga_empresa(1))
        ag.fim_conversa(1)
        self.assertTrue(ag.vaga_empresa(1))

    def test_razao_maior_preparada_para_o_power(self):
        ag = self._ag(limite=2)
        e = ag.empresas[1]
        e.razao = 2.0                                           # o PR do Power lê a razão da carteira
        n = 0
        while ag.vaga_empresa(1) and n < 10:
            ag.ocupar(1, 10)
            n += 1
        self.assertEqual(n, 4)                                  # 2 linhas por robô livre
        self.assertEqual(e.reservas, 2)                         # só 2 saem com reserva


class TestGuarda(Base):
    def test_janela_e_agendado(self):
        itens = [item("C1", janela_local=("14:00", "20:00")),
                 item("C2", "11988887772", agendar_para=D0 + timedelta(hours=1)),
                 item("C3", "11988887773", janela_local=None)]
        orq = self.montar(itens)
        self.assertEqual(orq.tick(), 0)
        motivos = self.lote.contar_motivos(self.rel.t)
        self.assertEqual(motivos, {"fora da janela da UF/DDD": 1, "retorno agendado para mais tarde": 1,
                                   "número sem janela hoje": 1})
        self.rel.andar(3600)
        self.assertEqual(orq.tick(), 1)

    def test_um_numero_por_cliente_por_vez_e_reserva(self):
        itens = [item("C1", "11988887770"), item("C1", "11988887771", ordem=2),
                 item("C1", "11988887772", ordem=3, reserva=True, tentativas_max_numero=1)]
        for it in itens:
            it.tentativas_max_numero = 1
        orq = self.montar(itens)
        self.assertEqual(orq.tick(), 1)
        self.cair(self.originados()[0][2], 19)
        self.assertEqual(orq.tick(), 1)
        self.assertEqual(self.originados()[1][1], "PJSIP/101011988887771@tr-1-10")
        self.cair(self.originados()[1][2], 19)
        self.assertEqual(orq.tick(), 1)                                   # reserva só agora
        self.assertEqual(self.originados()[2][1], "PJSIP/101011988887772@tr-1-10")

    def test_tentativas_do_cliente_e_guarda_extra(self):
        g = Guarda(extra=lambda it, agora: "não ligar recebido agora" if it.id_cliente == "C9" else None)
        itens = [item("C1", tentativas_max_cliente=1), item("C1", "11988887771", tentativas_max_cliente=1),
                 item("C9", "11988887779")]
        orq = self.montar(itens, guarda=g)
        self.assertEqual(orq.tick(), 1)
        self.cair(self.originados()[0][2], 19)
        self.rel.andar(7200)
        self.assertEqual(orq.tick(), 0)
        self.assertEqual(self.lote.contar_motivos(self.rel.t)["tentativas do cliente esgotadas"], 2)
        self.assertEqual(self.lote.pendentes(self.rel.t), 1)          # C9 pode ser liberado mais tarde

    def test_ler_mailing(self):
        from motor.discagem import CAMPOS_MAILING
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "discador_mailing.csv"
            with open(arq, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f, delimiter=";")
                w.writerow(CAMPOS_MAILING)
                w.writerow(["C1", "11988887770", 1, 0, 3, 6, 60, 15, "09:00-19:30", "SP", 2, "LOC", "L1", "", "a1", ""])
                w.writerow(["C2", "21988887770", 1, 1, 2, 4, 120, 20, "08:00-14:00", "RJ", 1, "QBR", "D1", "", "a2",
                            "2026-11-03 15:30"])
            its = ler_mailing(arq)
        self.assertEqual((its[0].janela_local, its[0].reserva, its[0].intervalo_ocupado), (("09:00", "19:30"), False, 15))
        self.assertEqual((its[1].reserva, its[1].tentativas_max_numero, its[1].agendar_para),
                         (True, 2, datetime(2026, 11, 3, 15, 30)))


class TestPrincipal(unittest.TestCase):
    def test_montar_e_rodar_ate_esvaziar(self):
        from motor.discagem import CAMPOS_MAILING
        from voz.orquestrador import principal as P
        rel = Relogio(datetime(2026, 11, 3, 19, 59, 59))
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "m.csv"
            with open(arq, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f, delimiter=";")
                w.writerow(CAMPOS_MAILING)
                w.writerow(["C1", CEL, 1, 0, 1, 1, 60, 15, "08:00-20:00", "SP", 1, "", "", "", "a1", ""])
            ari = AriFalso()
            orq = P.montar(B.carregar(dados_exemplo()), {1: str(arq)}, 10, ari, EscritorEventos(Path(tmp) / "ev"),
                           {"simulador": Simulador()}, rel)
            fila = queue.Queue()
            orq.tick()
            canal = [c for c in ari.de("originar")][0][2]
            fila.put({"type": "ChannelDestroyed", "channel": {"id": canal}, "cause": 19})
            contagem = P.rodar(orq, fila, passo_s=0.01, relogio=rel)
        self.assertEqual((contagem["originadas"], contagem["desfecho_nao_atendida"]), (1, 1))


class TestDetector(unittest.TestCase):
    def test_asterisk(self):
        d = A.AmdAsterisk()
        self.assertEqual(d.classificar("MACHINE", "TOOLONG-5000").tipo, A.MAQUINA)
        self.assertEqual(d.classificar("MACHINE", "INITIALSILENCE-2500-2500").amd, "INITIALSILENCE")
        self.assertEqual(d.classificar("NOTSURE", "").tipo, A.PESSOA)
        self.assertEqual(d.classificar("SEM_AMD").tipo, A.PESSOA)
        # todo código que sai daqui existe no de-para da rede do motor
        for amd in ("MACHINE", "HUMAN", "NOTSURE", "HANGUP", "INITIALSILENCE"):
            self.assertIn(amd, V.carregar_causas()["amd"])

    def test_khomp(self):
        k = A.KhompAnalytics()
        self.assertFalse(k.usa_amd_asterisk)
        self.assertEqual(k.classificar("", "", "voicemail"), A.Veredito(A.MAQUINA, "MACHINE", "khomp:VOICEMAIL"))
        self.assertEqual(k.classificar("", "", "").tipo, A.PESSOA)
        kr = A.KhompAnalytics(reserva=A.AmdAsterisk())
        self.assertTrue(kr.usa_amd_asterisk)
        self.assertEqual(kr.classificar("MACHINE", "", "").tipo, A.MAQUINA)

    def test_khomp_no_orquestrador_desliga_amd_do_asterisk(self):
        b = Base()
        b.setUp = lambda: None
        b.addCleanup = lambda f: None
        orq = Base.montar(b, [item()], detector=A.KhompAnalytics())
        orq.tick()
        canal = b.originados()[0][2]
        self.assertEqual(b.originados()[0][4]["MOTORCX_AMD"], "0")
        b.atender(canal, "", "", "SILENCE")
        b.cair(canal)
        self.assertEqual(b.eventos[0].desfecho, "mudo")
        b.tmp.cleanup()


class TestEventoNoMotor(Base):
    """O CSV que o orquestrador escreve entra no motor pelo caminho de sempre (ler_ocorrencia) e o motor chega
    ao mesmo desfecho (voz.classificar_chamada)."""

    def test_ingestao(self):
        itens = [item("C1", "11988887771"), item("C2", "11988887772"), item("C3", "11988887773"),
                 item("C4", "11988887774")]
        orq = self.montar(itens, mud=[("voz_troncos", 0, {"cps": 100})])
        orq.tick()
        c1, c2, c3, c4 = (c[2] for c in self.originados())
        self.atender(c1)                                          # promessa (Simulador)
        orq.tick()
        self.rel.andar(61)
        orq.tick()
        self.cair(c1)
        self.atender(c2, "MACHINE", "")
        self.cair(c2)
        self.cair(c3, 1, tech=404)
        self.cair(c4, 17, tech=486)
        arq = orq.escritor.caminho(1, D0.date())
        self.assertEqual(arq.name, "motorcx_voz_2026-11-03.csv")
        cab = arq.read_text(encoding="utf-8").splitlines()[0].split(";")
        self.assertEqual(tuple(cab), CAMPOS)
        # o mesmo caminho de qualquer retorno de fornecedor: pasta retornos/ + layouts/ achado pelo nome
        retornos = self.pasta / "retornos"
        retornos.mkdir()
        (retornos / "motorcx_voz_2026-11-03_0001.csv").write_bytes(arq.read_bytes())
        (retornos / "motorcx_voz_2026-11-03_0002.csv").write_bytes(arq.read_bytes())    # reenvio
        evs, rels, quar, sem_layout = ingerir_pasta(retornos, carregar_layouts(RAIZ / "layouts"))
        self.assertEqual((quar, sem_layout), ([], []))
        self.assertEqual([(r.aceitas, r.duplicadas) for r in rels], [(4, 0), (0, 4)])    # id_chamada deduplica
        por_id = {e.id_cliente: e for e in evs}
        esperado = {e.id_cliente: e.desfecho for e in self.eventos}
        self.assertEqual({k: e.resultado for k, e in por_id.items()}, esperado)
        self.assertEqual(esperado, {"C1": "promessa", "C2": "maquina", "C3": "numero_inexistente", "C4": "ocupado"})
        e1 = por_id["C1"]
        self.assertEqual((e1.canal, e1.contato, e1.duracao_s, e1.data_promessa, e1.valor_promessa,
                          e1.identidade_confirmada, e1.origem_resultado, e1.resultado_ia, e1.fornecedor),
                         ("agente_voz", "11988887771", 61, date(2026, 11, 6), 150.0, True, "ia", "promessa",
                          "motorcx_voz"))
        self.assertEqual(e1.id_externo, self.eventos[0].id_chamada)
        self.assertEqual(e1.rota, "tr-1-10/1010")
        self.assertEqual(e1.custo, 0.055)
        e3 = por_id["C3"]
        self.assertEqual((e3.causa_sip, e3.causa_q850, e3.origem_resultado), (404, 1, "rede"))

    def test_canal_discador_vai_no_layout_do_discador(self):
        self.montar([])
        self.lote = Lote(1, [item()], canal="discador", credor_id=7)
        self.orq.lotes = {}
        self.orq.adicionar_lote(self.lote)
        self.orq.tick()
        self.cair(self.originados()[0][2], 19)
        ev = self.eventos[0]
        self.assertEqual((ev.canal, ev.credor_id), ("discador", 7))
        arq = self.orq.escritor.caminho(1, D0.date(), 7, "discador")
        self.assertEqual(arq.name, "motorcx_discador_2026-11-03.csv")
        evs, rels, _, _ = ingerir_pasta(arq.parent, carregar_layouts(RAIZ / "layouts"))
        self.assertEqual((evs[0].canal, evs[0].resultado), ("discador", "nao_atendida"))

    def test_layouts_do_repositorio_iguais_ao_codigo(self):
        import json
        for canal, lay in LAYOUTS.items():
            arq = RAIZ / "layouts" / f"{lay['fornecedor']}.json"
            self.assertEqual(json.loads(arq.read_text(encoding="utf-8")), lay, arq.name)

    def test_layout_cobre_todos_os_desfechos_do_canal(self):
        for canal, lay in LAYOUTS.items():
            for d in V.do_canal(canal):
                if not d.interno:
                    self.assertEqual(lay["resultados"][d.chave], d.chave)
            self.assertIn(lay["resultados"][SEM_IA], V.FRACOS)

    def test_arquivo_de_eventos_privado(self):
        import stat
        orq = self.montar([item()])
        orq.tick()
        self.cair(self.originados()[0][2], 19)
        arq = orq.escritor.caminho(1, D0.date())
        self.assertEqual(stat.S_IMODE(arq.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
