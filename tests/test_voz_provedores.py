"""Provedores de voz (Simulador, Montagem MotorCX com mocks do Pipecat/LLM, ElevenLabs) e transcrição (Whisper
com mock, reserva por API, redação de CPF e cartão, worker). Sem rede, sem Pipecat e sem faster-whisper
instalados. Só dados fictícios (CPF e cartão de teste gerados, não de pessoas)."""
import asyncio
import hashlib
import hmac
import io
import json
import socket
import sys
import tempfile
import types
import unittest
import wave
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest import mock

from tests.test_voz_gerador import dados_exemplo
from tests.test_voz_orquestrador import CEL, D0, Base, item
from voz import banco as B
from voz.provedores import criar_todos
from voz.provedores import elevenlabs as EL
from voz.provedores import montagem as M
from voz.provedores import rtp as R
from voz.provedores.base import ContextoChamada
from voz.provedores.simulador import CENARIO_POR_DIGITO, CENARIOS, Simulador
from voz.segredos import Dicionario
from voz.transcricao import redacao as RD
from voz.transcricao import transcritores as TR
from voz.transcricao import worker as W

CTX = ContextoChamada(id_chamada="abc123", empresa_id=1, id_cliente="C1", id_acao="a1",
                      variaveis={"empresa": "Credora Fictícia"}, final_numero="70")


class _Resp:
    def __init__(self, corpo):
        self._c = corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode()

    def read(self):
        return self._c

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestSimulador(unittest.TestCase):
    def test_todos_os_cenarios(self):
        for cen, (seg, res, extras, transf) in CENARIOS.items():
            with self.subTest(cen=cen):
                ev = []
                sim = Simulador(cenarios={"C1": cen})
                con = sim.iniciar(CTX, lambda *a: ev.append(a))
                self.assertEqual(con.tipo, "interno")
                sim.tick(D0)
                sim.tick(D0 + timedelta(seconds=seg - 1))
                self.assertEqual(ev, [])
                sim.tick(D0 + timedelta(seconds=seg))
                self.assertEqual(ev[0][1:3][0], "resultado")
                self.assertEqual(ev[0][2]["resultado_ia"], res)
                self.assertEqual(ev[-1][1], "transferir" if transf else "encerrar")
                sim.tick(D0 + timedelta(seconds=seg + 60))
                self.assertEqual(len(ev), 2)                    # não repete
                sim.encerrar("abc123")
                self.assertEqual(sim.sessoes, {})

    def test_cenario_pelo_digito_e_capacidade(self):
        self.assertEqual(set(CENARIO_POR_DIGITO.values()) - set(CENARIOS), set())
        sim = Simulador(max_simultaneas=1)
        sim.iniciar(CTX, lambda *a: None)
        self.assertEqual(sim.sessoes["abc123"].cenario, "cpc")
        self.assertFalse(sim.disponivel())
        with self.assertRaises(ValueError):
            Simulador(cenarios={"C1": "x"}).iniciar(CTX, lambda *a: None)


class FakeModelo:
    def __init__(self, respostas):
        self.respostas, self.vistos = list(respostas), []

    def responder(self, mensagens, ferramentas):
        self.vistos.append([dict(m) for m in mensagens])
        r = self.respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


class TestConversa(unittest.TestCase):
    def conv(self, respostas, **kw):
        self.ev = []
        self.modelo = FakeModelo(respostas)
        return M.Conversa(CTX, self.modelo, lambda *a: self.ev.append(a),
                          "Você fala pela {empresa}. Cliente {desconhecida}.", "Alô?", hoje=date(2026, 11, 3), **kw)

    def test_fluxo_promessa(self):
        c = self.conv([M.Resposta("Posso confirmar com quem falo?"),
                       M.Resposta("Combinado, até sexta.", [("registrar_resultado", {
                           "resultado": "promessa", "identidade_confirmada": True, "data_promessa": "2026-11-06",
                           "valor_promessa": 150}), ("encerrar_chamada", {})])])
        self.assertEqual(c.comecar(), ["Alô?"])
        self.assertIn("Credora Fictícia", c.historico[0]["content"])
        self.assertIn("{desconhecida}", c.historico[0]["content"])         # variável fora da lista não vaza
        self.assertEqual(c.ouvir("sou eu"), ["Posso confirmar com quem falo?"])
        self.assertEqual(c.ouvir("pago na sexta"), ["Combinado, até sexta."])
        self.assertEqual(self.ev, [("abc123", "resultado", {"resultado_ia": "promessa", "identidade_confirmada": True,
                                                            "data_promessa": date(2026, 11, 6),
                                                            "valor_promessa": 150.0}),
                                   ("abc123", "encerrar", {})])
        self.assertTrue(c.encerrada)
        self.assertEqual(c.ouvir("alô?"), [])
        self.assertEqual(self.modelo.vistos[0][-1], {"role": "user", "content": "sou eu"})

    def test_esquema_fechado(self):
        c = self.conv([M.Resposta("", [("registrar_resultado", {"resultado": "pagou_tudo"}),
                                       ("apagar_banco", {}), ("transferir_humano", {"motivo": "porque sim"})])])
        c.ouvir("quero falar com alguém")
        self.assertEqual(self.ev, [("abc123", "transferir", {"motivo": "pedido_humano"})])
        self.assertEqual(len(c.avisos), 2)

    def test_llm_fora_transfere(self):
        c = self.conv([RuntimeError("timeout")])
        c.ouvir("oi")
        self.assertEqual(self.ev, [("abc123", "transferir", {"motivo": "pedido_humano"})])

    def test_limite_de_turnos(self):
        c = self.conv([M.Resposta("ok")] * 2, max_turnos=2)
        c.ouvir("a")
        c.ouvir("b")
        self.assertEqual(self.ev, [("abc123", "encerrar", {})])

    def test_ferramentas_usam_os_desfechos_do_motor(self):
        from motor import voz as V
        enum = M.FERRAMENTAS[0]["function"]["parameters"]["properties"]["resultado"]["enum"]
        self.assertTrue(set(enum) <= set(V.POR_CHAVE))
        self.assertNotIn("falha_operadora", enum)


class TestModeloOpenAICompat(unittest.TestCase):
    def test_chamada_e_ferramentas(self):
        pedidos = []

        def abrir(req, timeout=None):
            pedidos.append(req)
            return _Resp({"choices": [{"message": {"content": "Certo.", "tool_calls": [
                {"function": {"name": "registrar_resultado", "arguments": '{"resultado": "cpc"}'}},
                {"function": {"name": "encerrar_chamada", "arguments": "não é json"}}]}}]})

        m = M.ModeloOpenAICompat("https://llm.exemplo.invalid/v1/", "chave-ficticia", "modelo-x", abrir=abrir)
        r = m.responder([{"role": "user", "content": "oi"}], M.FERRAMENTAS)
        self.assertEqual((r.texto, r.chamadas), ("Certo.", [("registrar_resultado", {"resultado": "cpc"}),
                                                             ("encerrar_chamada", {})]))
        self.assertEqual(pedidos[0].full_url, "https://llm.exemplo.invalid/v1/chat/completions")
        self.assertEqual(pedidos[0].get_header("Authorization"), "Bearer chave-ficticia")
        corpo = json.loads(pedidos[0].data)
        self.assertEqual((corpo["model"], corpo["tool_choice"]), ("modelo-x", "auto"))


class TestMontagem(unittest.TestCase):
    def test_iniciar_tick_encerrar(self):
        rodadas, ev = [], []
        modelo = FakeModelo([M.Resposta("", [("transferir_humano", {"motivo": "cpc"})])])
        cfg = M.ConfigMontagem(portas=(40000, 40003), max_sessoes=5, host_midia="127.0.0.1")
        mt = M.Montagem(cfg, Dicionario({}), lambda ctx: ("Roteiro {empresa}", "Alô?"), modelo_de=lambda: modelo,
                        executor=rodadas.append)
        con = mt.iniciar(CTX, lambda *a: ev.append(a))
        self.assertEqual((con.tipo, con.host_porta, con.formato), ("midia_externa", "127.0.0.1:40000", "slin16"))
        self.assertEqual(len(rodadas), 1)
        rodadas[0].conversa.ouvir("quero um atendente")        # (na thread de áudio)
        self.assertEqual(ev, [])                                 # só sai no tick, na thread do orquestrador
        mt.tick(D0)
        self.assertEqual(ev, [("abc123", "transferir", {"motivo": "cpc"})])
        ctx2 = ContextoChamada("def456", 1, "C2")
        self.assertEqual(mt.iniciar(ctx2, lambda *a: None).host_porta, "127.0.0.1:40002")
        self.assertFalse(mt.disponivel())                        # portas pares 40000 e 40002 em uso
        mt.encerrar("abc123")
        self.assertTrue(mt.disponivel())

    def test_servicos_pipecat_com_mocks(self):
        criados = {}

        def classe(nome):
            class C:
                class Settings:
                    def __init__(self, **kw):
                        self.kw = kw

                def __init__(self, **kw):
                    criados[nome] = kw
            return C

        mods = {"pipecat": types.ModuleType("pipecat"), "pipecat.services": types.ModuleType("s")}
        for caminho, nome in (("pipecat.services.deepgram.stt", "DeepgramSTTService"),
                              ("pipecat.services.elevenlabs.tts", "ElevenLabsTTSService"),
                              ("pipecat.services.google.tts", "GoogleTTSService")):
            mod = types.ModuleType(caminho)
            setattr(mod, nome, classe(nome))
            mods[caminho] = mod
            mods[caminho.rsplit(".", 1)[0]] = types.ModuleType(caminho.rsplit(".", 1)[0])
        seg = Dicionario({"voz/deepgram": "dg-ficticia", "voz/tts": "tts-ficticia", "voz/llm": "x"})
        with mock.patch.dict(sys.modules, mods):
            M.montar_servicos_pipecat(M.ConfigMontagem(tts_voz="voz-pt"), seg)
            self.assertEqual(criados["DeepgramSTTService"]["api_key"], "dg-ficticia")
            self.assertEqual(criados["DeepgramSTTService"]["sample_rate"], 16000)
            self.assertEqual(criados["DeepgramSTTService"]["settings"].kw, {"model": "nova-3", "language": "pt-BR"})
            self.assertEqual(criados["ElevenLabsTTSService"]["api_key"], "tts-ficticia")
            self.assertEqual(criados["ElevenLabsTTSService"]["settings"].kw, {"voice": "voz-pt", "language": "pt-BR"})
            M.montar_servicos_pipecat(M.ConfigMontagem(tts_provedor="google", tts_voz="pt-BR-x"), seg)
            self.assertEqual(criados["GoogleTTSService"]["settings"].kw, {"voice": "pt-BR-x", "language": "pt-BR"})
            with self.assertRaises(ValueError):
                M.montar_servicos_pipecat(M.ConfigMontagem(tts_provedor="outro"), seg)

    def test_fabrica(self):
        p = criar_todos({"montagem": {"portas": [41000, 41010]}, "elevenlabs": {"numero_agente": "agente01"}},
                        Dicionario({}))
        self.assertEqual(sorted(p), ["elevenlabs", "montagem", "simulador"])
        self.assertEqual(p["montagem"].cfg.portas, (41000, 41010))
        self.assertEqual(sorted(criar_todos(None)), ["simulador"])


class TestRTP(unittest.TestCase):
    def test_pacote_e_ordem(self):
        pcm_le = b"\x01\x02\x03\x04"
        self.assertEqual(R.trocar_ordem(pcm_le), b"\x02\x01\x04\x03")
        pk = R.montar_pacote(7, 320, 0xABCDEF01, b"\x00\x01", marcador=True)
        self.assertEqual(R.ler_pacote(pk), (7, 320, 0xABCDEF01, b"\x00\x01"))
        self.assertIsNone(R.ler_pacote(b"\x00" * 20))
        emp = R.Empacotador(ssrc=1)
        pks = emp.pacotes(b"\x00\x01" * 500)                     # 1000 bytes = 1 quadro + resto
        self.assertEqual(len(pks), 1)
        self.assertEqual(len(R.ler_pacote(pks[0])[3]), R.BYTES_QUADRO)
        pks2 = emp.pacotes(b"\x00\x01" * 140)                    # completa o 2º quadro
        self.assertEqual((R.ler_pacote(pks2[0])[0] - R.ler_pacote(pks[0])[0]) & 0xFFFF, 1)
        self.assertEqual(R.ler_pacote(pks2[0])[1] - R.ler_pacote(pks[0])[1], 320)

    def test_ponte_udp_de_verdade(self):
        """Ida e volta por UDP no loopback: o 'Asterisk' manda L16 big-endian, a ponte entrega little-endian e
        responde para o endereço de origem em pacotes de 20 ms."""
        async def cenario():
            recebido = []
            ponte = R.PonteRTP(recebido.append)
            loop = asyncio.get_running_loop()
            tr, _ = await loop.create_datagram_endpoint(lambda: ponte, local_addr=("127.0.0.1", 0))
            porta = tr.get_extra_info("sockname")[1]
            ast = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            ast.bind(("127.0.0.1", 0))
            ast.setblocking(False)
            ast.sendto(R.montar_pacote(1, 0, 99, b"\x12\x34" * 320), ("127.0.0.1", porta))
            for _ in range(50):
                if recebido:
                    break
                await asyncio.sleep(0.01)
            envio = asyncio.ensure_future(ponte.enviar_ritmado())
            ponte.falar(b"\x34\x12" * 640)                        # 2 quadros
            volta = []
            for _ in range(100):
                try:
                    volta.append(ast.recv(2000))
                except BlockingIOError:
                    await asyncio.sleep(0.01)
                if len(volta) == 2:
                    break
            envio.cancel()
            tr.close()
            ast.close()
            return recebido, volta

        recebido, volta = asyncio.run(cenario())
        self.assertEqual(recebido, [b"\x34\x12" * 320])
        self.assertEqual(len(volta), 2)
        self.assertEqual(R.ler_pacote(volta[0])[3], b"\x12\x34" * 320)


SEGREDO_WH = "segredo-webhook-ficticio"


def _assinar(corpo: bytes, t: int) -> str:
    return f"t={t},v0=" + hmac.new(SEGREDO_WH.encode(), f"{t}.".encode() + corpo, hashlib.sha256).hexdigest()


class TestElevenLabs(unittest.TestCase):
    CORPO = {"type": "post_call_transcription", "data": {
        "conversation_id": "conv_1",
        "conversation_initiation_client_data": {"dynamic_variables": {"motorcx_id": "abc123"}},
        "analysis": {"data_collection_results": {"resultado": {"value": "promessa"},
                                                 "identidade_confirmada": {"value": True},
                                                 "data_promessa": {"value": "2026-11-10"},
                                                 "valor_promessa": {"value": 99.9}}}}}

    def test_webhook_assinado(self):
        corpo = json.dumps(self.CORPO).encode()
        t = 1_800_000_000
        evs = EL.ler_webhook({"ElevenLabs-Signature": _assinar(corpo, t)}, corpo, SEGREDO_WH, agora=t + 5)
        self.assertEqual(evs, [("abc123", "resultado", {"resultado_ia": "promessa", "identidade_confirmada": True,
                                                        "data_promessa": date(2026, 11, 10), "valor_promessa": 99.9})])

    def test_assinatura_invalida_ou_velha(self):
        corpo = json.dumps(self.CORPO).encode()
        t = 1_800_000_000
        for cab, agora in ((_assinar(corpo + b" ", t), t), (_assinar(corpo, t), t + 3600), ("", t),
                           ("t=x,v0=y", t)):
            with self.assertRaises(EL.AssinaturaInvalida):
                EL.ler_webhook({"elevenlabs-signature": cab}, corpo, SEGREDO_WH, agora=agora)

    def test_resultado_fora_do_esquema_so_encerra(self):
        d = json.loads(json.dumps(self.CORPO))
        d["data"]["analysis"]["data_collection_results"]["resultado"]["value"] = "quitou"
        corpo = json.dumps(d).encode()
        self.assertEqual(EL.ler_webhook({"elevenlabs-signature": _assinar(corpo, 5)}, corpo, SEGREDO_WH, agora=5),
                         [("abc123", "encerrar", {})])

    def test_iniciar_e_refer(self):
        el = EL.ElevenLabs("agente01", max_simultaneas=1)
        con = el.iniciar(CTX, lambda *a: None)
        self.assertEqual(con.endpoint, "PJSIP/agente01@pv-elevenlabs")
        self.assertEqual(con.variaveis["PJSIP_HEADER(add,X-MotorCX-Id)"], "abc123")
        self.assertFalse(any("C1" in v for v in con.variaveis.values()))       # nem o id do cliente vai
        self.assertFalse(el.disponivel())
        self.assertEqual(EL.motivo_do_refer("sip:transferir-cpc@203.0.113.10"), "cpc")
        self.assertEqual(EL.motivo_do_refer("sip:transferir-xyz@203.0.113.10"), "pedido_humano")
        self.assertIsNone(EL.motivo_do_refer("sip:1234@203.0.113.10"))


class TestElevenLabsNoOrquestrador(Base):
    def test_resultado_tardio_e_transferencia_por_refer(self):
        el = EL.ElevenLabs("agente01", espera_resultado_s=120)
        orq = self.montar([item(), item("C2", "11988887772")], mud=[("voz_config", 0, {"provedor": "elevenlabs"})])
        orq.provedores["elevenlabs"] = el
        orq.tick()
        c1, c2 = (c[2] for c in self.originados())
        cid1 = c1.rsplit("-", 1)[0]
        self.atender(c1)
        p = [c for c in self.ari.de("originar") if c[3][0] == "provedor"][0]
        self.assertEqual((p[1], p[2]), ("PJSIP/agente01@pv-elevenlabs", f"{cid1}-p"))
        self.ev("StasisStart", f"{cid1}-p", args=["provedor", cid1])
        self.assertIn(f"{cid1}-p", self.ari.pontes[f"{cid1}-b"])
        self.rel.andar(40)
        self.cair(f"{cid1}-p")                                   # a ElevenLabs desligou
        self.cair(c1)
        self.assertEqual(self.eventos, [])                       # espera o webhook
        self.assertEqual(orq.agendador.empresas[1].em_voo, 1)    # mas a vaga já voltou (só a C2 em voo)
        orq.evento_provedor(cid1, "resultado", {"resultado_ia": "promessa", "valor_promessa": 80.0})
        self.assertEqual((self.eventos[0].desfecho, self.eventos[0].billsec, self.eventos[0].valor_promessa),
                         ("promessa", 40, 80.0))
        # C2: a IA pede humano por REFER
        cid2 = c2.rsplit("-", 1)[0]
        self.atender(c2)
        self.ev("StasisStart", f"{cid2}-p", args=["provedor", cid2])
        self.ev("ChannelTransfer", f"{cid2}-p",
                refer_to={"requested_destination": {"destination": "sip:transferir-cpc@203.0.113.10"}})
        h = [c for c in self.ari.de("originar") if c[3][0] == "humano"]
        self.assertEqual(h[0][4]["PJSIP_HEADER(add,X-MotorCX-Motivo)"], "cpc")

    def test_resultado_que_nao_chega(self):
        el = EL.ElevenLabs("agente01", espera_resultado_s=60)
        orq = self.montar([item()], mud=[("voz_config", 0, {"provedor": "elevenlabs"})])
        orq.provedores["elevenlabs"] = el
        orq.tick()
        c1 = self.originados()[0][2]
        self.atender(c1)
        self.cair(c1)
        self.rel.andar(61)
        orq.tick()
        self.assertEqual(self.eventos[0].desfecho, "atendida_sem_cpc")   # houve pessoa e agente, sem resultado
        self.assertTrue(any("não chegou a tempo" in a for a in orq.alertas))

    def test_provedor_nao_configurado_cai_no_simulador(self):
        orq = self.montar([item()], mud=[("voz_config", 0, {"provedor": "montagem"})])
        orq.tick()
        self.atender(self.originados()[0][2])
        self.assertTrue(any("não configurado" in a for a in orq.alertas))
        self.assertEqual(len(self.sim.sessoes), 1)


# ---------------------------------------------------------------- transcrição
def cpf_ficticio(base9="123456789"):
    d = base9
    for n in (9, 10):
        s = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        d += str((s * 10 % 11) % 10)
    return d


CARTAO_TESTE = "4111111111111111"     # número de teste público (Luhn válido), não é cartão de ninguém


class TestRedacao(unittest.TestCase):
    def test_cpf_e_cartao(self):
        cpf = cpf_ficticio()
        fmt = f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"
        casos = [
            (f"meu cpf é {fmt} ok", "meu cpf é [CPF REDIGIDO] ok", {"cpf": 1, "cartao": 0}),
            (f"é {cpf}", "é [CPF REDIGIDO]", {"cpf": 1, "cartao": 0}),
            (f"é {' '.join(cpf)}", "é [CPF REDIGIDO]", {"cpf": 1, "cartao": 0}),
            ("cartão 4111 1111 1111 1111 validade", "cartão [CARTÃO REDIGIDO] validade", {"cpf": 0, "cartao": 1}),
            (f"cartão {CARTAO_TESTE}", "cartão [CARTÃO REDIGIDO]", {"cpf": 0, "cartao": 1}),
            ("meu número é 11988887777", "meu número é 11988887777", {"cpf": 0, "cartao": 0}),
            ("o valor é 1.234,56 reais", "o valor é 1.234,56 reais", {"cpf": 0, "cartao": 0}),
            ("4111 1111 1111 1112", "4111 1111 1111 1112", {"cpf": 0, "cartao": 0}),       # Luhn falha
        ]
        for txt, esperado, cont in casos:
            with self.subTest(txt=txt):
                self.assertEqual(RD.redigir(txt), (esperado, cont))
        self.assertFalse(RD.cpf_valido("11111111111"))


def _wav(caminho: Path, segundos: float):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(caminho), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * int(8000 * segundos))


class FakeTranscritor(TR.Transcritor):
    codigo = "falso"

    def __init__(self, texto, falhar=False):
        self.texto, self.falhar, self.chamadas = texto, falhar, 0

    def transcrever(self, caminho, idioma="pt"):
        self.chamadas += 1
        if self.falhar:
            raise RuntimeError("caiu")
        return TR.Transcricao(self.texto, [TR.Segmento(0, 1, self.texto)], idioma, self.codigo)


class TestWorker(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ent, self.sai = Path(self.tmp.name) / "ent", Path(self.tmp.name) / "sai"
        d = dados_exemplo()
        d["voz_config"].append({"empresa_id": 2, "transcrever": False})
        d["voz_config"][0]["transcrever_min_segundos"] = 5
        self.dados = B.carregar(d)

    def test_limiar_redacao_e_desligada(self):
        _wav(self.ent / "empresa_1" / "g1.wav", 4.9)
        _wav(self.ent / "empresa_1" / "g2.wav", 6)
        (self.ent / "empresa_1" / "g3.json").write_text('{"duracao_s": 30}')
        _wav(self.ent / "empresa_1" / "g3.wav", 1)                           # duração do importador vence
        _wav(self.ent / "empresa_2" / "g4.wav", 60)
        tr = FakeTranscritor(f"pode anotar meu cpf {cpf_ficticio()} e o cartão {CARTAO_TESTE}")
        w = W.Worker(self.dados, W.FontePasta(self.ent), W.DestinoPasta(self.sai), tr)
        self.assertEqual(w.processar(), {"ok": 2, "abaixo_limiar": 1, "desligada": 1, "erro": 0})
        self.assertEqual(tr.chamadas, 2)
        out = json.loads((self.sai / "empresa_1" / "g2.json").read_text())
        self.assertEqual(out["texto"], "pode anotar meu cpf [CPF REDIGIDO] e o cartão [CARTÃO REDIGIDO]")
        self.assertEqual(out["segmentos"][0]["texto"], out["texto"])
        self.assertEqual(out["redigidos"], {"cpf": 1, "cartao": 1})
        bruto = (self.sai / "empresa_1" / "g2.json").read_text()
        self.assertNotIn(cpf_ficticio(), bruto)
        self.assertNotIn(CARTAO_TESTE, bruto)
        self.assertEqual(oct((self.sai / "empresa_1" / "g2.json").stat().st_mode & 0o777), "0o600")
        self.assertFalse((self.sai / "empresa_1" / "g1.json").exists())
        self.assertEqual(w.processar(), {"ok": 0, "abaixo_limiar": 0, "desligada": 0, "erro": 0})   # não refaz

    def test_erro_tenta_de_novo_ate_o_limite(self):
        _wav(self.ent / "empresa_1" / "g1.wav", 10)
        tr = FakeTranscritor("x", falhar=True)
        w = W.Worker(self.dados, W.FontePasta(self.ent, max_tentativas=2), W.DestinoPasta(self.sai), tr)
        self.assertEqual(w.processar()["erro"], 1)
        self.assertEqual(w.processar()["erro"], 1)
        self.assertEqual(w.processar()["erro"], 0)
        self.assertEqual(tr.chamadas, 2)

    def test_reserva_por_api(self):
        _wav(self.ent / "empresa_1" / "g1.wav", 10)
        pedidos = []

        def abrir(req, timeout=None):
            pedidos.append(req)
            return _Resp({"text": "texto da reserva"})

        api = TR.ApiTranscricao("chave-ficticia", url="https://stt.exemplo.invalid/v1/audio/transcriptions",
                                abrir=abrir)
        w = W.Worker(self.dados, W.FontePasta(self.ent), W.DestinoPasta(self.sai),
                     TR.ComReserva(FakeTranscritor("x", falhar=True), api))
        self.assertEqual(w.processar()["ok"], 1)
        out = json.loads((self.sai / "empresa_1" / "g1.json").read_text())
        self.assertEqual((out["texto"], out["motor"]), ("texto da reserva", "api"))
        self.assertIn(b'name="model"\r\n\r\ngpt-4o-mini-transcribe', pedidos[0].data)
        self.assertIn(b'name="language"\r\n\r\npt', pedidos[0].data)

    def test_whisper_local_com_mock(self):
        seg = types.SimpleNamespace(start=0.0, end=1.234, text=" olá ")
        modelo = mock.Mock()
        modelo.transcribe.return_value = (iter([seg]), None)
        fab = mock.Mock(return_value=modelo)
        wl = TR.WhisperLocal("small", fabrica=fab)
        t = wl.transcrever(Path("a.wav"))
        self.assertEqual((t.texto, t.segmentos[0].fim, t.motor), ("olá", 1.23, "whisper"))
        fab.assert_called_once_with("small", device="cpu", compute_type="int8", download_root=None)
        self.assertEqual(modelo.transcribe.call_args.kwargs["language"], "pt")
        wl.transcrever(Path("b.wav"))
        self.assertEqual(fab.call_count, 1)                                     # modelo carregado uma vez


if __name__ == "__main__":
    unittest.main()
