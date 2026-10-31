"""Gerador da configuração do Asterisk (voz/asterisk/gerador.py), leitura das tabelas de voz (voz/banco.py),
senhas pelo Secret Manager (voz/segredos.py) e tarifação (voz/tarifacao.py). Só dados fictícios (IPs de
documentação 198.51.100.x e 203.0.113.x)."""
import base64
import io
import json
import os
import stat
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from pathlib import Path

from voz import banco as B
from voz import segredos as S
from voz import tarifacao as T
from voz.asterisk import gerador as G

SENHA = "senha-ficticia-de-teste-123"


def dados_exemplo() -> dict:
    return {
        "voz_troncos": [
            {"id": 10, "empresa_id": 1, "referencia": "Operadora X · SP", "operadora": "X", "host": "198.51.100.20",
             "porta": 5060, "transporte": "udp", "autenticacao": "ip", "codecs": ["alaw", "ulaw"], "canais": 5,
             "cps": 10, "bina": "1130000000", "ativo": True},
            {"id": 11, "empresa_id": 1, "referencia": "Operadora Y", "host": "203.0.113.30", "porta": 5080,
             "transporte": "tcp", "autenticacao": "senha", "usuario": "motorcx1", "segredo_ref": "voz/trunk/1-11",
             "codecs": "alaw", "canais": 3, "cps": 2, "ddd_origem": "11"},
            {"id": 20, "empresa_id": 2, "referencia": "Operadora Z", "host": "203.0.113.40", "autenticacao": "ip",
             "canais": 10, "cps": 5, "ddd_origem": "21"},
            {"id": 99, "empresa_id": 2, "referencia": "Desligado", "host": "203.0.113.99", "ativo": False},
        ],
        "voz_rotas": [
            {"id": 1, "empresa_id": 1, "tronco_id": 10, "prioridade": 1, "tech_prefix": "1010", "tipo": "movel_vc1",
             "cadencia_inicial_s": 30, "cadencia_incremento_s": 6, "preco_minuto": 0.05,
             "vigente_desde": "2026-01-01"},
            {"id": 2, "empresa_id": 1, "tronco_id": 11, "prioridade": 2, "tech_prefix": "2020", "tipo": "movel_vc1",
             "cadencia_inicial_s": 60, "cadencia_incremento_s": 60, "preco_minuto": 0.04},
            {"id": 3, "empresa_id": 1, "tronco_id": 10, "prioridade": 1, "tech_prefix": "1011",
             "tipo": "movel_vc2_vc3", "cadencia_inicial_s": 30, "cadencia_incremento_s": 6, "preco_minuto": 0.09},
            {"id": 4, "empresa_id": 1, "tronco_id": 10, "prioridade": 1, "tech_prefix": "1012", "tipo": "fixo_local",
             "cadencia_inicial_s": 30, "cadencia_incremento_s": 6, "preco_minuto": 0.02},
            {"id": 5, "empresa_id": 2, "tronco_id": 20, "prioridade": 1, "tech_prefix": "55", "tipo": "movel_vc1",
             "cadencia_inicial_s": 1, "cadencia_incremento_s": 1, "preco_minuto": None},
            # vigência antiga da rota 1 (preço diferente): fica no histórico, fora da discagem
            {"id": 6, "empresa_id": 1, "tronco_id": 10, "prioridade": 1, "tech_prefix": "1010", "tipo": "movel_vc1",
             "cadencia_inicial_s": 30, "cadencia_incremento_s": 6, "preco_minuto": 0.07,
             "vigente_desde": "2025-01-01", "vigente_ate": "2025-12-31"},
        ],
        "voz_transferencias": [
            {"id": 7, "empresa_id": 1, "destino_sip": "sip:fila@203.0.113.50:5060", "metodo": "ponte",
             "tech_prefix": "", "cabecalhos": {"X-Campanha": "cobranca"}},
            {"id": 8, "empresa_id": 2, "destino_sip": "sip:8000@203.0.113.60", "metodo": "refer", "tronco_id": 20},
        ],
        "voz_config": [{"empresa_id": 1, "limite_simultaneas": 4, "pico_multiplo": 2, "provedor": "simulador"}],
        "provedores_sip": [{"nome": "elevenlabs", "host": "203.0.113.70", "porta": 5060, "transporte": "tcp"}],
    }


class TestBanco(unittest.TestCase):
    def test_carrega_e_valida(self):
        d = B.carregar(dados_exemplo())
        self.assertEqual(len(d.troncos), 4)
        t11 = d.tronco(11)
        self.assertEqual((t11.autenticacao, t11.segredo_ref, t11.codecs, t11.nome), ("senha", "voz/trunk/1-11",
                                                                                   ("alaw",), "tr-1-11"))
        self.assertEqual(d.tronco(10).ddd_origem, "11")       # do número da bina
        self.assertEqual(d.config(1).pico_multiplo, 2)
        self.assertEqual(d.config(2).transcrever_min_segundos, 5)   # padrão da decisão 7
        self.assertEqual(d.config(2).retencao_dias, 90)

    def test_erros(self):
        casos = [
            ("voz_troncos", 0, {"autenticacao": "senha"}, "segredo_ref"),
            ("voz_troncos", 0, {"segredo_ref": "voz/x"}, "não leva segredo_ref"),
            ("voz_troncos", 0, {"transporte": "ws"}, "transporte"),
            ("voz_troncos", 0, {"host": "a b"}, "host"),
            ("voz_troncos", 0, {"codecs": ["mp3"]}, "codecs"),
            ("voz_rotas", 0, {"tech_prefix": "12a"}, "tech_prefix"),
            ("voz_rotas", 0, {"tipo": "satelite"}, "tipo"),
            ("voz_rotas", 0, {"tronco_id": 20}, "não existe na empresa"),
            ("voz_rotas", 0, {"prioridade": 10}, "fora de"),
            ("voz_transferencias", 0, {"destino_sip": "fila@host"}, "destino_sip"),
            ("voz_transferencias", 0, {"cabecalhos": {"CPF": "1"}}, "cabeçalho"),
            ("voz_config", 0, {"retencao_dias": 30}, "fora de"),
            ("voz_config", 0, {"pico_multiplo": 4}, "fora de"),
        ]
        for tabela, i, mud, msg in casos:
            with self.subTest(tabela=tabela, mud=mud):
                d = dados_exemplo()
                d[tabela][i].update(mud)
                with self.assertRaises(B.DadosInvalidos) as cm:
                    B.carregar(d)
                self.assertIn(msg, str(cm.exception))

    def test_colunas_ajustaveis(self):
        """Se o SQL final renomear uma coluna, só o dicionário COLUNAS muda."""
        antigo = B.COLUNAS["voz_troncos"]["canais"]
        try:
            B.COLUNAS["voz_troncos"]["canais"] = "canais_simultaneos"
            linha = dict(dados_exemplo()["voz_troncos"][0])
            linha["canais_simultaneos"] = linha.pop("canais") * 2
            self.assertEqual(B.ler_tronco(linha).canais, 10)
        finally:
            B.COLUNAS["voz_troncos"]["canais"] = antigo


class TestGerador(unittest.TestCase):
    def setUp(self):
        self.dados = B.carregar(dados_exemplo())
        self.seg = S.Dicionario({"voz/trunk/1-11": SENHA})

    def test_pjsip(self):
        pj = G.gerar_pjsip(self.dados, self.seg, "203.0.113.10", ["10.60.0.0/24"],
                           provedores_sip=dados_exemplo()["provedores_sip"])
        self.assertIn("[transport-udp]", pj)
        self.assertIn("[transport-tcp]", pj)
        self.assertNotIn("[transport-tls]", pj)
        self.assertIn("external_media_address=203.0.113.10", pj)
        self.assertIn("local_net=10.60.0.0/24", pj)
        # tronco por IP: identify pelo host, sem auth
        self.assertIn("[tr-1-10-id]\ntype=identify\nendpoint=tr-1-10\nmatch=198.51.100.20", pj)
        self.assertIn("contact=sip:198.51.100.20:5060\n", pj)
        self.assertIn("callerid=<1130000000>", pj)
        # tronco por senha: auth com a senha do cofre, contato TCP na porta do tronco
        self.assertIn("outbound_auth=tr-1-11-auth", pj)
        self.assertIn(f"[tr-1-11-auth]\ntype=auth\nauth_type=userpass\nusername=motorcx1\npassword={SENHA}", pj)
        self.assertIn("contact=sip:203.0.113.30:5080;transport=tcp", pj)
        self.assertEqual(pj.count(SENHA), 1)
        self.assertIn("allow=alaw\n", pj)
        # inativo fica de fora; transferência 'ponte pelo tronco' não ganha endpoint próprio
        self.assertNotIn("tr-2-99", pj)
        self.assertIn("[tf-1-7]", pj)
        self.assertNotIn("[tf-2-8]", pj)
        self.assertIn("[pv-elevenlabs]", pj)
        # tudo que entra cai no contexto que recusa
        self.assertEqual(pj.count("context=motorcx-entrada"), pj.count("type=endpoint"))

    def test_segredo_ausente_nao_gera(self):
        with self.assertRaises(S.SegredoAusente):
            G.gerar_pjsip(self.dados, S.Dicionario({}))

    def test_tls_exige_certificado(self):
        d = dados_exemplo()
        d["voz_troncos"][0]["transporte"] = "tls"
        with self.assertRaises(B.DadosInvalidos):
            G.gerar_pjsip(B.carregar(d), self.seg)
        pj = G.gerar_pjsip(B.carregar(d), self.seg, tls={"cert": "/c.crt", "chave": "/c.key"})
        self.assertIn("[transport-tls]\ntype=transport\nprotocol=tls\nbind=0.0.0.0:5061", pj)

    def test_extensions_failover_e_prefixo(self):
        ex = G.gerar_extensions(self.dados)
        self.assertIn("MOTORCX_CANAIS_TR_1_10=5", ex)
        self.assertIn("MOTORCX_CPS_TR_1_11=2", ex)
        bloco = ex.split("[motorcx-saida-1-movel_vc1]")[1].split("\n\n")[0]
        # prioridade 1 (tronco 10, prefixo 1010) antes da 2 (tronco 11, prefixo 2020); vigência antiga não duplica
        self.assertLess(bloco.index("Dial(PJSIP/1010${EXTEN}@tr-1-10,60)"),
                        bloco.index("Dial(PJSIP/2020${EXTEN}@tr-1-11,60)"))
        self.assertEqual(bloco.count("1010${EXTEN}"), 1)
        self.assertIn("GROUP_COUNT(tr-1-10@motorcx)} >= ${MOTORCX_CANAIS_TR_1_10}]?r2", bloco)
        self.assertIn('"${DIALSTATUS}" = "CHANUNAVAIL" | "${DIALSTATUS}" = "CONGESTION"]?r2', bloco)
        self.assertIn("same => n(r3),Hangup(34)", bloco)
        self.assertIn("[motorcx-saida-1-fixo_local]", ex)
        self.assertIn("[motorcx-saida-2-movel_vc1]", ex)
        # contextos fixos que o orquestrador usa
        for ctx in ("[motorcx-entrada]", "[motorcx-atendeu]", "[motorcx-transferir]"):
            self.assertIn(ctx, ex)
        self.assertIn("AMD(${MOTORCX_AMD_PARAMS})", ex)
        self.assertIn("MixMonitor(/var/spool/asterisk/motorcx/${MOTORCX_GRAVACAO}.wav)", ex)
        self.assertIn("Stasis(${MOTORCX_APP},amd,", ex)
        self.assertNotIn(SENHA, ex)

    def test_gerar_grava_arquivos_com_permissao(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = G.gerar(dados_exemplo(), Path(tmp), self.seg, "203.0.113.10", ["10.60.0.0/24"])
            self.assertEqual(res, {"troncos": 3, "rotas": 6, "transferencias": 2, "provedores_sip": 1})
            pj = Path(tmp) / "pjsip_motorcx.conf"
            self.assertEqual(stat.S_IMODE(pj.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE((Path(tmp) / "extensions_motorcx.conf").stat().st_mode), 0o640)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()),
                             ["extensions_motorcx.conf", "pjsip_motorcx.conf"])   # sem temporário sobrando

    def test_cli_previa_sem_senha_nao_imprime_segredo(self):
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "voz.json"
            arq.write_text(json.dumps(dados_exemplo()), encoding="utf-8")
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                rc = G.main(["--dados", str(arq), "--saida", str(Path(tmp) / "conf"), "--sem-senhas",
                             "--ip-externo", "203.0.113.10"])
            self.assertEqual(rc, 0)
            self.assertEqual(json.loads(out.getvalue())["troncos"], 3)
            self.assertIn("password=SEM-SENHA-PREVIA", (Path(tmp) / "conf" / "pjsip_motorcx.conf").read_text())
            d = dados_exemplo()
            d["voz_rotas"][0]["tipo"] = "x"
            arq.write_text(json.dumps(d), encoding="utf-8")
            with redirect_stdout(io.StringIO()), redirect_stderr(err):
                self.assertEqual(G.main(["--dados", str(arq), "--saida", tmp, "--sem-senhas"]), 2)
            self.assertIn("ERRO", err.getvalue())

    def test_banco_nao_tem_coluna_de_senha(self):
        for tabela, cols in B.COLUNAS.items():
            for c in cols.values():
                self.assertNotIn("senha", c, tabela)
                self.assertNotIn("password", c, tabela)

    def test_recarregar_pelo_ari(self):
        from voz.orquestrador.ari import AriFalso
        ari = AriFalso()
        G.recarregar(ari)
        self.assertEqual([c[1] for c in ari.de("recarregar")], ["res_pjsip.so", "pbx_config.so"])


class _Resp:
    def __init__(self, corpo: dict):
        self._c = json.dumps(corpo).encode()

    def read(self):
        return self._c

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestSecretManager(unittest.TestCase):
    def test_nome(self):
        self.assertEqual(S.nome_secret_manager("voz/trunk/1-11"), "motorcx-voz-trunk-1-11")
        self.assertEqual(S.nome_secret_manager("motorcx-voz-ari-senha"), "motorcx-voz-ari-senha")
        with self.assertRaises(ValueError):
            S.nome_secret_manager("voz/../$(x)")

    def test_rest_com_token_da_vm(self):
        pedidos = []

        def abrir(req, timeout=None):
            pedidos.append((req.full_url, dict(req.header_items())))
            if "metadata.google.internal" in req.full_url:
                return _Resp({"access_token": "tok-ficticio", "expires_in": 3600})
            return _Resp({"payload": {"data": base64.b64encode(SENHA.encode()).decode()}})

        sm = S.SecretManager(projeto="projeto-ficticio", abrir=abrir)
        self.assertEqual(sm.valor("voz/trunk/1-11"), SENHA)
        self.assertEqual(sm.valor("voz/trunk/1-11"), SENHA)
        self.assertEqual(sum("metadata" in u for u, _ in pedidos), 1)          # token reaproveitado
        url, cab = pedidos[1]
        self.assertTrue(url.endswith("/projects/projeto-ficticio/secrets/motorcx-voz-trunk-1-11/versions/latest:access"))
        self.assertEqual(cab.get("Authorization"), "Bearer tok-ficticio")

    def test_erro_nao_vaza(self):
        import urllib.error

        def abrir(req, timeout=None):
            if "metadata" in req.full_url:
                return _Resp({"access_token": "t", "expires_in": 3600})
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b"segredo-no-corpo"))

        with self.assertRaises(S.SegredoAusente) as cm:
            S.SecretManager(projeto="p", abrir=abrir).valor("voz/trunk/9")
        self.assertNotIn("segredo-no-corpo", str(cm.exception))

    def test_projeto_obrigatorio(self):
        velho = {k: os.environ.pop(k) for k in ("MOTORCX_GCP_PROJETO", "GOOGLE_CLOUD_PROJECT") if k in os.environ}
        try:
            with self.assertRaises(ValueError):
                S.SecretManager()
        finally:
            os.environ.update(velho)


class TestTarifacao(unittest.TestCase):
    def setUp(self):
        self.dados = B.carregar(dados_exemplo())

    def test_tipo_numero(self):
        self.assertEqual(T.tipo_numero("11988887777", "11"), "movel_vc1")
        self.assertEqual(T.tipo_numero("5521988887777", "11"), "movel_vc2_vc3")
        self.assertEqual(T.tipo_numero("1133334444", "11"), "fixo_local")
        self.assertEqual(T.tipo_numero("021 3333-4444", "11"), "fixo_ldn")
        self.assertIsNone(T.tipo_numero("1188887777", "11"))        # celular sem o 9º dígito
        self.assertIsNone(T.tipo_numero("08001234567", "11"))
        self.assertIsNone(T.tipo_numero("123", "11"))

    def test_rotas_por_prioridade_e_vizinha(self):
        c = T.rotas_para(self.dados, 1, "11988887777", date(2026, 11, 3))
        self.assertEqual([(x.rota.id, x.discar, x.tronco.nome) for x in c],
                         [(1, "101011988887777", "tr-1-10"), (2, "202011988887777", "tr-1-11")])
        self.assertEqual(c[0].endpoint, "PJSIP/101011988887777@tr-1-10")
        # 2025: só a vigência antiga (id 6) e a rota 2 (sem vigência)
        self.assertEqual([x.rota.id for x in T.rotas_para(self.dados, 1, "11988887777", date(2025, 6, 1))], [6, 2])
        # fixo LDN sem rota própria: usa a fixo_local (mesmo meio)
        c = T.rotas_para(self.dados, 1, "2133334444", date(2026, 11, 3))
        self.assertEqual([x.rota.id for x in c], [4])
        self.assertEqual(T.rotas_para(self.dados, 1, "0800", date(2026, 11, 3)), [])
        self.assertEqual(T.rotas_para(self.dados, 3, "11988887777", date(2026, 11, 3)), [])

    def test_segundos_tarifados(self):
        casos = [((0, 30, 6), 0), ((-3, 30, 6), 0), ((1, 30, 6), 30), ((30, 30, 6), 30), ((31, 30, 6), 36),
                 ((37, 30, 6), 42), ((61, 60, 60), 120), ((7, 1, 1), 7), ((None, 30, 6), 0)]
        for args, esperado in casos:
            self.assertEqual(T.segundos_tarifados(*args), esperado, args)

    def test_tarifar(self):
        r = T.tarifar(self.dados, 1, "1010", 31, date(2026, 11, 3))
        self.assertEqual(r, {"rota_id": 1, "segundos_tarifados": 36, "preco_minuto": 0.05, "custo_operadora": 0.03,
                             "alerta": None})
        self.assertEqual(T.tarifar(self.dados, 1, "1010", 31, date(2025, 6, 1))["preco_minuto"], 0.07)
        self.assertEqual(T.tarifar(self.dados, 1, "9999", 31, date(2026, 11, 3))["alerta"], "rota_sem_cadastro")
        sem_preco = T.tarifar(self.dados, 2, "55", 10, date(2026, 11, 3))
        self.assertEqual((sem_preco["segundos_tarifados"], sem_preco["custo_operadora"], sem_preco["alerta"]),
                         (10, None, "rota_sem_preco"))


if __name__ == "__main__":
    unittest.main()
