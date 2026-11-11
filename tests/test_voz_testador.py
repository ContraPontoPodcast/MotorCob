"""SQL 114 · Telefonia T5: "Testar a rota" de verdade (voz/testador.py) e o OPTIONS (voz/sip_options.py), sem Asterisk:
ARI falso, fila de eventos montada no teste e banco falso que guarda cada passo."""
import queue
import unittest

from voz import banco as B
from voz import sip_options as O
from voz import testador as TT
from voz.orquestrador.ari import AriFalso
from voz.segredos import Dicionario


def dados(**mud):
    t = {"id": 10, "empresa_id": 1, "referencia": "alfa-sp-1", "operadora": "Alfa", "host": "198.51.100.20",
         "autenticacao": "ip", "bina": "1130000000", "canais": 5, "cps": 10, "ativo": False, "toque_max_s": 25,
         "formato_discagem": "tech_e164", "atualizado_em": "2026-11-10T10:00:00+00:00"}
    t.update(mud)
    bruto = {"voz_troncos": [t], "voz_rotas": [
        {"id": 1, "empresa_id": 1, "tronco_id": 10, "prioridade": 1, "tech_prefix": "04412345", "tipo": "movel_vc1",
         "cadencia_inicial_s": 30, "cadencia_incremento_s": 6, "preco_minuto": 0, "enviar_prefixo": False}],
             "voz_transferencias": [], "voz_config": []}
    return B.carregar(bruto), bruto


class BancoFalso:
    def __init__(self, bina="certa", cancelar_no=None):
        self.registros, self.bina, self.cancelar_no = [], bina, cancelar_no

    def rpc(self, funcao, args=None):
        if funcao == "registrar_teste_tronco_voz":
            self.registros.append(args)
            if self.cancelar_no is not None and len(self.registros) >= self.cancelar_no:
                return "cancelado"
            return args.get("situacao") or "rodando"
        if funcao == "ler_teste_tronco_voz":
            return {"situacao": "rodando", "bina_resposta": self.bina}
        raise AssertionError(funcao)

    def final(self):
        return self.registros[-1]

    def passo(self, n):
        return next(x for x in self.final()["passos"] if x["passo"] == n)


REF = "voz/trunk/e1/teste-0123456789ab"
PEDIDO = {"id": 7, "empresa_id": 1, "tronco_id": 10, "numero_ref": REF, "codigo": "4821",
          "atualizado_em": "2026-11-10T10:00:00+00:00"}


class Relogio:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        self.t += 0.5
        return self.t


def teste(sb, eventos, pedido=PEDIDO, ari=None, options=lambda *a: (200, 38), **mud):
    d, bruto = dados(**mud)
    ari = ari or AriFalso()
    ari.endpoints["PJSIP/tr-1-10"] = {"state": "online"}
    fila = queue.Queue()
    t = TT.Teste(sb, ari, dict(pedido), d, bruto, fila, relogio=Relogio(), options=options, resolver=lambda h: [h],
                 segredos=Dicionario({REF: "+55 11 98888-7741"}))
    t.espera_fila = 0.01
    canal = {"id": None}
    orig = ari.originar

    def originar(endpoint, id_canal, *a, **k):
        canal["id"] = id_canal
        for e in eventos:
            e = dict(e)
            e["channel"] = {**e.get("channel", {}), "id": id_canal}
            fila.put(e)
        return orig(endpoint, id_canal, *a, **k)
    ari.originar = originar
    return t, ari


ATENDE = [{"type": "ChannelStateChange", "channel": {"state": "Ringing"}}, {"type": "StasisStart", "args": ["teste", "7"]},
          {"type": "ChannelDtmfReceived", "digit": "4"}, {"type": "ChannelDtmfReceived", "digit": "8"},
          {"type": "ChannelDtmfReceived", "digit": "2"}, {"type": "ChannelDtmfReceived", "digit": "1"},
          {"type": "ChannelTalkingStarted"}]


class TestTestador(unittest.TestCase):
    def test_passou_de_ponta_a_ponta(self):
        sb = BancoFalso()
        t, ari = teste(sb, ATENDE + [{"type": "StasisEnd"}])
        ari.lidas[("x", "y")] = ""
        self.assertEqual(t.rodar(), "atencao")      # sem a medida de qualidade (passo 7, não obrigatório): atenção
        f = sb.final()
        self.assertEqual(f["situacao"], "atencao")
        self.assertEqual([p["passo"] for p in f["passos"]], list(range(10)))
        self.assertEqual(sb.passo(1)["mensagem"], "A operadora respondeu em 38 ms.")
        self.assertEqual(sb.passo(7)["resultado"], "aviso")       # sem rtpqos: não reprova
        # liga pelo tronco certo: rota sem prefixo, formato +55, bina e toque do tronco, app próprio
        _, endpoint, canal, args, _, callerid, timeout = ari.de("originar")[0]
        self.assertEqual(endpoint, "PJSIP/+5511988887741@tr-1-10")
        self.assertEqual((args, callerid, timeout), (("teste", "7"), "1130000000", 25))
        self.assertTrue(canal.startswith("teste-7-"))
        self.assertIn(("tocar", canal, TT.BIPES, f"bip-{canal}"), ari.comandos)
        # nenhum passo leva o número
        self.assertNotIn("88887741", str(sb.registros))

    def test_qualidade_boa_passa_sem_aviso(self):
        sb = BancoFalso()
        ari = AriFalso()
        t, ari = teste(sb, ATENDE + [{"type": "StasisEnd"}], ari=ari)
        orig = ari.ler_variavel
        ari.ler_variavel = lambda c, n: "ssrc=1;lp=0;rxjitter=0.004;rxcount=500;rtt=0.045" if "rtpqos" in n else orig(c, n)
        self.assertEqual(t.rodar(), "passou")
        self.assertEqual(sb.passo(7)["mensagem"], "Qualidade boa: atraso 45 ms, variação 4 ms, perda 0,0%.")
        self.assertIn("passou no teste", sb.final()["resumo"])

    def test_operadora_recusa_por_ip(self):
        sb = BancoFalso()
        t, ari = teste(sb, [{"type": "ChannelDestroyed", "cause": 21, "tech_cause": 403}])
        self.assertEqual(t.rodar(), "falhou")
        self.assertEqual(sb.passo(2)["resultado"], "falha")
        self.assertIn("não reconhece os IPs do MotorCX", sb.passo(2)["mensagem"])
        self.assertIn("Nada liga para cliente", sb.final()["resumo"])
        self.assertFalse(any(p["passo"] > 2 for p in sb.final()["passos"]))

    def test_senha_recusada_e_numero_nao_entendido(self):
        sb = BancoFalso()
        t, _ = teste(sb, [{"type": "ChannelDestroyed", "cause": 21, "tech_cause": 407}], autenticacao="senha",
                     usuario="u1", segredo_ref="voz/trunk/e1/alfa")
        self.assertEqual(t.rodar(), "falhou")
        self.assertIn("usuário ou a senha", sb.passo(2)["mensagem"])
        sb = BancoFalso()
        t, _ = teste(sb, [{"type": "ChannelDestroyed", "cause": 28, "tech_cause": 484}])
        self.assertEqual(t.rodar(), "falhou")
        self.assertEqual((sb.passo(2)["resultado"], sb.passo(3)["resultado"]), ("ok", "falha"))

    def test_tocou_e_nao_atendeu_e_incompleto(self):
        sb = BancoFalso()
        t, _ = teste(sb, [{"type": "ChannelStateChange", "channel": {"state": "Ringing"}},
                          {"type": "ChannelDestroyed", "cause": 19}])
        self.assertEqual(t.rodar(), "incompleto")
        self.assertEqual(sb.passo(4)["resultado"], "inconclusivo")
        self.assertIn("Teste incompleto", sb.final()["resumo"])

    def test_bina_errada_reprova(self):
        sb = BancoFalso(bina="outro")
        t, ari = teste(sb, ATENDE)
        self.assertEqual(t.rodar(), "falhou")
        self.assertIn("Bina errada", sb.passo(8)["mensagem"])
        self.assertTrue(ari.desligados)                         # o MotorCX desliga a ligação de teste

    def test_teclas_sem_codigo_certo_avisa(self):
        sb = BancoFalso()
        ev = [e for e in ATENDE if e.get("digit") not in ("1",)] + [{"type": "ChannelDtmfReceived", "digit": "9"},
                                                                  {"type": "StasisEnd"}]
        t, _ = teste(sb, ev)
        self.assertEqual(t.rodar(), "atencao")
        self.assertEqual(sb.passo(5)["resultado"], "aviso")
        self.assertIn("não confere", sb.passo(5)["mensagem"])

    def test_tronco_que_nao_subiu_para_no_passo_0(self):
        sb = BancoFalso()
        d, bruto = dados()
        ari = AriFalso()                                         # sem o endpoint
        t = TT.Teste(sb, ari, dict(PEDIDO), d, bruto, queue.Queue(), relogio=Relogio(), resolver=lambda h: [h])
        self.assertEqual(t.rodar(), "falhou")
        self.assertEqual(sb.final()["passos"], [{"passo": 0, "resultado": "falha", "mensagem":
                                                 "O tronco ainda não subiu no servidor de voz. Tente de novo em 2 minutos."}])
        self.assertFalse(ari.de("originar"))

    def test_mudanca_ainda_nao_carregada_para_no_passo_0(self):
        sb = BancoFalso()
        t, ari = teste(sb, [], pedido={**PEDIDO, "atualizado_em": "2026-11-10T10:05:00+00:00"})
        self.assertEqual(t.rodar(), "falhou")
        self.assertIn("carregando a última mudança", sb.passo(0)["mensagem"])

    def test_host_interno_para_no_passo_0(self):
        sb = BancoFalso()
        t, _ = teste(sb, [], host="sip.alfa.exemplo.com.br")
        t.resolver = lambda h: ["10.0.0.5"]
        self.assertEqual(t.rodar(), "falhou")
        self.assertIn("endereço público", sb.passo(0)["mensagem"])

    def test_options_sem_resposta_nao_reprova(self):
        sb = BancoFalso()
        t, _ = teste(sb, ATENDE + [{"type": "StasisEnd"}], options=lambda *a: None)
        t.rodar()
        self.assertEqual(sb.passo(1)["resultado"], "aviso")
        self.assertNotEqual(sb.final()["situacao"], "falhou")

    def test_cancelado_na_tela_para_e_desliga(self):
        sb = BancoFalso(cancelar_no=4)
        t, ari = teste(sb, ATENDE)
        self.assertEqual(t.rodar(), "cancelado")
        self.assertTrue(ari.desligados)

    def test_numero_que_o_cofre_nao_entrega_nao_liga(self):
        for pedido in ({**PEDIDO, "numero_ref": "voz/trunk/e1/teste-ffffffffffff"}, {**PEDIDO, "numero_ref": "../x"}):
            sb = BancoFalso()
            t, ari = teste(sb, [], pedido=pedido)
            self.assertEqual(t.rodar(), "falhou")
            self.assertIn("cofre", sb.passo(2)["mensagem"])
            self.assertFalse(ari.de("originar"))

    def test_mensagens_por_codigo(self):
        self.assertEqual(TT.mensagem_falha(402, 21, "ip", False)[:2], (2, "falha"))
        self.assertEqual(TT.mensagem_falha(488, 58, "ip", False)[:2], (3, "falha"))
        self.assertEqual(TT.mensagem_falha(603, 21, "ip", False)[:2], (3, "falha"))
        self.assertEqual(TT.mensagem_falha(486, 17, "ip", True)[:2], (4, "inconclusivo"))
        self.assertEqual(TT.mensagem_falha(503, 34, "ip", False)[:2], (2, "falha"))

    def test_qualidade(self):
        self.assertEqual(TT.qualidade("lp=12;rxcount=488;rxjitter=0.01;rtt=0.05")[0], "aviso")
        self.assertEqual(TT.qualidade(None)[0], "aviso")


class TestOptions(unittest.TestCase):
    def test_monta_e_le_resposta(self):
        msg = O.montar("sip.alfa.example", 5060, "203.0.113.10", 40000, "abc@motorcx", "t1", "b1").decode()
        self.assertTrue(msg.startswith("OPTIONS sip:sip.alfa.example:5060 SIP/2.0\r\n"))
        self.assertIn("Via: SIP/2.0/UDP 203.0.113.10:40000;branch=z9hG4bKb1;rport", msg)
        self.assertIn("User-Agent: MotorCX", msg)
        self.assertTrue(msg.endswith("\r\n\r\n"))
        self.assertEqual(O.ler_resposta(b"SIP/2.0 200 OK\r\nCall-ID: abc@motorcx\r\n\r\n", "abc@motorcx"), 200)
        self.assertIsNone(O.ler_resposta(b"SIP/2.0 200 OK\r\nCall-ID: outro\r\n\r\n", "abc@motorcx"))
        self.assertIsNone(O.ler_resposta(b"INVITE sip:x SIP/2.0\r\n", "abc@motorcx"))

    def test_responde_por_udp_local(self):
        import socket
        import threading
        srv = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        srv.bind(("127.0.0.1", 0))
        porta = srv.getsockname()[1]

        def responder():
            dados, end = srv.recvfrom(4096)
            cid = [l for l in dados.decode().split("\r\n") if l.startswith("Call-ID:")][0]
            srv.sendto(f"SIP/2.0 405 Method Not Allowed\r\n{cid}\r\n\r\n".encode(), end)
        th = threading.Thread(target=responder, daemon=True)
        th.start()
        r = O.perguntar("127.0.0.1", porta, "127.0.0.1", tempo=2)
        srv.close()
        self.assertEqual(r[0], 405)
        self.assertIsNone(O.perguntar("127.0.0.1", porta, "127.0.0.1", tempo=0.2))


if __name__ == "__main__":
    unittest.main()
