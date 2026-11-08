"""SQL 83 · B4 (destinos perigosos) e B6 (aviso na abertura) na VM de voz."""
import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from tests.test_voz_gerador import SENHA, dados_exemplo
from tests.test_voz_operacao import SbFalso
from voz import banco as B
from voz import configuracao as CF
from voz import destinos as D
from voz import segredos as S
from voz.asterisk import gerador as G
from voz.provedores.base import ContextoChamada, aviso_abertura
from voz.provedores.elevenlabs import ElevenLabs
from voz.transcricao.ia import ConversaComTurnos

RAIZ = Path(__file__).resolve().parent.parent
MIGRACAO = RAIZ / "supabase" / "migrations" / "20270119000001_voz_destinos_gravacao_identidade.sql"
CASOS = json.loads((RAIZ / "tests" / "dados" / "voz_destinos_casos.json").read_text(encoding="utf-8"))


def dns(tabela: dict):
    """Resolver falso: nome -> IPs (nome fora da tabela não resolve)."""
    def resolver(nome):
        if nome not in tabela:
            raise OSError("não resolve")
        return tabela[nome]
    return resolver


class TestHost(unittest.TestCase):
    def test_casos_iguais_ao_banco(self):
        for c in CASOS["hosts"]:
            with self.subTest(host=c["host"]):
                self.assertEqual(D.motivo_host(c["host"]), c["motivo"])

    def test_faixas_e_sufixos_iguais_ao_sql(self):
        sql = MIGRACAO.read_text(encoding="utf-8")
        faixas = re.search(r"voz_faixas_reservadas\(\) returns cidr\[\].*?array\[(.*?)\]::cidr", sql, re.S).group(1)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", faixas)), D.FAIXAS_RESERVADAS)
        sufixos = re.search(r"voz_sufixos_proibidos\(\) returns text\[\].*?array\[(.*?)\]::text", sql, re.S).group(1)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", sufixos)), D.SUFIXOS_PROIBIDOS)

    def test_proprio_motorcx(self):
        proprios = D.proprios_do_ambiente("34.95.10.20", ["10.158.0.0/20"], ["35.199.0.0/30", "lixo"])
        self.assertEqual(proprios, ("34.95.10.20/32", "10.158.0.0/20", "35.199.0.0/30"))
        self.assertEqual(D.motivo_host("34.95.10.20", proprios), "endereço do próprio MotorCX")
        self.assertEqual(D.motivo_host("35.199.0.2", proprios), "endereço do próprio MotorCX")
        self.assertIsNone(D.motivo_host("35.199.0.9", proprios))

    def test_depois_do_dns(self):
        r = dns({"sip.operadora.com.br": ["200.160.2.3"], "interno.operadora.com.br": ["200.160.2.4", "10.0.0.5"],
                 "volta.operadora.com.br": ["34.95.10.20"], "v6.operadora.com.br": ["2001:4860::1"],
                 "v6local.operadora.com.br": ["fd00::1"], "mapeado.operadora.com.br": ["::ffff:127.0.0.1"]})
        p = ("34.95.10.20/32",)
        self.assertIsNone(D.motivo_host("sip.operadora.com.br", p, r))
        self.assertIsNone(D.motivo_host("v6.operadora.com.br", p, r))
        self.assertIn("rede interna", D.motivo_host("interno.operadora.com.br", p, r))   # um IP ruim basta
        self.assertIn("rede interna", D.motivo_host("v6local.operadora.com.br", p, r))
        self.assertIn("rede interna", D.motivo_host("mapeado.operadora.com.br", p, r))
        self.assertEqual(D.motivo_host("volta.operadora.com.br", p, r), "o nome resolve para o próprio MotorCX")
        self.assertEqual(D.motivo_host("nao.existe.com.br", p, r), "o nome não resolve")
        self.assertIsNone(D.motivo_host("nao.existe.com.br", p))                    # sem DNS: só a regra do banco

    def test_host_da_transferencia(self):
        self.assertEqual(D.host_da_transferencia("sip:fila@pabx.empresa.com.br:5061;transport=tls"),
                         "pabx.empresa.com.br")
        self.assertEqual(D.host_da_transferencia("sips:8000@10.0.0.1"), "10.0.0.1")


class TestNumero(unittest.TestCase):
    def test_nacional_passa(self):
        for n in ("11987654321", "1133334444", "+55 11 98765-4321", "5511987654321", "011987654321",
                  "(21) 3333-4444", "4733334444", "6933334444"):
            with self.subTest(n=n):
                self.assertIsNone(D.motivo_numero(n))

    def test_bloqueados(self):
        casos = {"190": "curto", "192": "curto", "193": "curto", "199": "curto", "197": "curto", "100": "curto",
                 "180": "curto", "4004": "curto", "40040000": "curto", "03001234567": "0300",
                 "05001234567": "0300", "08001234567": "0800", "09001234567": "0900", "0300123456": "0300",
                 "+12125550100": "internacional", "0012125550100": "internacional",
                 "+351912345678": "internacional", "2033334444": "DDD", "1183334444": "fixo",
                 "11887654321": "celular", "119876543210": "demais", "": "curto"}
        for n, trecho in casos.items():
            with self.subTest(n=n):
                motivo = D.motivo_numero(n)
                self.assertIsNotNone(motivo)
                self.assertIn(trecho, motivo)
                self.assertNotIn(n or "-", motivo)                           # o motivo nunca traz o número

    def test_ddds_validos(self):
        self.assertEqual(len(D.DDDS), 67)
        self.assertNotIn("20", D.DDDS)
        self.assertIn("11", D.DDDS)


class TestBancoEConfiguracao(unittest.TestCase):
    def test_ler_tronco_recusa_host_interno(self):
        linha = dict(dados_exemplo()["voz_troncos"][0], host="169.254.169.254")
        with self.assertRaisesRegex(B.DadosInvalidos, "host recusado"):
            B.ler_tronco(linha)
        linha = dict(dados_exemplo()["voz_transferencias"][0], destino_sip="sip:fila@localhost")
        with self.assertRaisesRegex(B.DadosInvalidos, "destino recusado"):
            B.ler_transferencia(linha)

    def test_buscar_deixa_de_fora_o_que_resolve_para_dentro(self):
        d = dados_exemplo()
        d["voz_troncos"][0]["host"] = "sip.interna.com.br"             # tronco 10 (rotas 1, 3, 4 e 6)
        d["voz_transferencias"][0]["destino_sip"] = "sip:fila@pabx.volta.com.br"
        d["voz_enderecos_motorcx"] = [{"faixa": "34.95.10.0/24"}]
        r = dns({"sip.interna.com.br": ["192.168.1.10"], "pabx.volta.com.br": ["34.95.10.7"]})
        ign: list = []
        saida = CF.buscar(SbFalso({t: d[t] for t in (*CF.TABELAS, "voz_enderecos_motorcx")}), [], ign, resolver=r)
        self.assertEqual([t["id"] for t in saida["voz_troncos"]], [11, 20, 99])
        self.assertEqual([x["id"] for x in saida["voz_transferencias"]], [8])
        self.assertEqual(saida["enderecos_motorcx"], ["34.95.10.0/24"])
        motivos = {x.referencia: x.motivo for x in ign}
        self.assertIn("rede interna", motivos["tronco.10"])
        self.assertIn("próprio MotorCX", motivos["transferencia.7"])
        self.assertTrue(all(motivos[f"rota.{i}"].startswith("o tronco 10 ficou de fora") for i in (1, 3, 4, 6)))
        self.assertNotIn("192.168", json.dumps([x.texto() for x in ign]))   # o aviso não traz o endereço

    def test_buscar_com_ip_da_vm(self):
        d = dados_exemplo()
        ign: list = []
        saida = CF.buscar(SbFalso({t: d[t] for t in CF.TABELAS}), [], ign, proprios=("203.0.113.40",))
        self.assertNotIn(20, [t["id"] for t in saida["voz_troncos"]])
        self.assertEqual(saida["enderecos_motorcx"], [])                   # banco sem o SQL 83: lista vazia


class TestGeradorDestinos(unittest.TestCase):
    def setUp(self):
        self.seg = S.Dicionario({"voz/trunk/1-11": SENHA})

    def test_plano_so_nacional(self):
        ex = G.gerar_extensions(B.carregar(dados_exemplo()))
        bloco = ex.split("[motorcx-saida-1-movel_vc1]")[1].split("\n\n")[0]
        self.assertNotIn("_X.", bloco)
        self.assertIn("exten => _[1-9][1-9]9XXXXXXXX,1,", bloco)
        self.assertIn("exten => _[1-9][1-9][2-5]XXXXXXX,1,", bloco)
        self.assertIn("exten => i,1,Hangup(1)", bloco)
        # o padrão do Asterisk casa exatamente com motivo_numero nos casos nacionais e recusa os bloqueados
        def casa(numero):
            for p in D.PADROES_DIALPLAN:
                rx = "^" + p[1:].replace("X", "[0-9]") + "$"
                if re.match(rx, numero):
                    return True
            return False
        for n in ("11987654321", "1133334444", "190", "08001234567", "0011987654321", "1183334444", "11887654321"):
            with self.subTest(n=n):
                self.assertEqual(casa(n), D.motivo_numero(n) is None)

    def test_gerar_tira_destino_recusado(self):
        d = dados_exemplo()
        d["voz_troncos"][2]["host"] = "pabx.cliente.com.br"            # tronco 20 (empresa 2) resolve para dentro
        d["enderecos_motorcx"] = ["203.0.113.50/32"]                     # transferência 7 aponta para o MotorCX
        r = dns({"pabx.cliente.com.br": ["10.20.30.40"]})
        with tempfile.TemporaryDirectory() as tmp, redirect_stderr(io.StringIO()) as err:
            res = G.gerar(d, Path(tmp), self.seg, "203.0.113.10", ["10.60.0.0/24"], resolver=r)
            pj = (Path(tmp) / "pjsip_motorcx.conf").read_text()
            ex = (Path(tmp) / "extensions_motorcx.conf").read_text()
        self.assertEqual(res["destinos_recusados"], 3)                   # tronco 20, transf. 7 e transf. 8 (via 20)
        self.assertNotIn("[tr-2-20]", pj)
        self.assertNotIn("[tf-1-7]", pj)
        self.assertIn("[tr-1-10]", pj)
        self.assertNotIn("[motorcx-saida-2-movel_vc1]", ex)
        self.assertIn("[motorcx-saida-1-movel_vc1]", ex)
        self.assertNotIn("10.20.30.40", err.getvalue())
        self.assertIn("tronco 20 (empresa 2) ficou de fora", err.getvalue())

    def test_ip_externo_da_vm_nunca_e_destino(self):
        d = dados_exemplo()
        with tempfile.TemporaryDirectory() as tmp, redirect_stderr(io.StringIO()):
            res = G.gerar(d, Path(tmp), self.seg, "198.51.100.20")     # o tronco 10 aponta para a própria VM
            pj = (Path(tmp) / "pjsip_motorcx.conf").read_text()
        self.assertNotIn("[tr-1-10]", pj)
        self.assertGreaterEqual(res["destinos_recusados"], 1)


class TestAvisoAbertura(unittest.TestCase):
    def test_texto(self):
        self.assertEqual(aviso_abertura(True, "Assessoria Alfa"),
                         "Esta ligação é gravada. Sou o assistente virtual da Assessoria Alfa.")
        self.assertEqual(aviso_abertura(False, "Assessoria Alfa"), "Sou o assistente virtual da Assessoria Alfa.")
        self.assertEqual(aviso_abertura(True, None), "Esta ligação é gravada. Sou um assistente virtual.")

    def test_padrao_ligado(self):
        self.assertTrue(B.ConfigVoz(empresa_id=1).aviso_gravacao)
        self.assertTrue(B.ler_config({"empresa_id": 1}).aviso_gravacao)
        self.assertFalse(B.ler_config({"empresa_id": 1, "aviso_gravacao": False}).aviso_gravacao)

    def test_vem_antes_da_primeira_fala_e_entra_na_transcricao(self):
        class Interna:
            def comecar(self):
                return ["Bom dia! Falo com Ana?"]
        c = ConversaComTurnos(Interna(), aviso="Esta ligação é gravada. Sou o assistente virtual da Alfa.")
        self.assertEqual(c.comecar(), ["Esta ligação é gravada. Sou o assistente virtual da Alfa.",
                                       "Bom dia! Falo com Ana?"])
        self.assertEqual([t["texto"] for t in c.turnos.turnos][0],
                         "Esta ligação é gravada. Sou o assistente virtual da Alfa.")
        self.assertEqual(ConversaComTurnos(Interna()).comecar(), ["Bom dia! Falo com Ana?"])

    def test_elevenlabs_recebe_o_aviso_no_cabecalho(self):
        el = ElevenLabs(numero_agente="agente", endpoint="pv-elevenlabs")
        ctx = ContextoChamada("c1", 1, "C1", aviso_abertura=aviso_abertura(True, "Alfa"))
        self.assertEqual(el.iniciar(ctx, lambda *a: None).variaveis["PJSIP_HEADER(add,X-MotorCX-Aviso)"],
                         "gravacao,virtual")
        ctx = ContextoChamada("c2", 1, "C1", aviso_abertura=aviso_abertura(False, "Alfa"))
        self.assertEqual(el.iniciar(ctx, lambda *a: None).variaveis["PJSIP_HEADER(add,X-MotorCX-Aviso)"], "virtual")


if __name__ == "__main__":
    unittest.main()
