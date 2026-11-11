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
from voz import destinos as DST
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
             "tech_prefix": "", "cabecalhos": ["X-MotorCX-Id-Chamada", "X-MotorCX-Id-Acao", "X-MotorCX-Motivo"]},
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
        self.assertIsNone(d.config(1).bucket_gravacoes)

    def test_bucket_por_empresa_e_colunas_do_banco(self):
        d = dados_exemplo()
        d["voz_config"][0]["bucket_gravacoes"] = "proj-motorcx-grav-e1"
        self.assertEqual(B.carregar(d).config(1).bucket_gravacoes, "proj-motorcx-grav-e1")
        d["voz_config"][0]["bucket_gravacoes"] = "gs://x"
        with self.assertRaises(B.DadosInvalidos):
            B.carregar(d)
        self.assertEqual(B.para_colunas("consumo_voz", {"empresa_id": 1, "dia": "2026-11-03", "xyz": 1}),
                         {"empresa_id": 1, "dia": "2026-11-03"})
        self.assertEqual(B.conflito("consumo_voz"), "empresa_id,dia,tech_prefix")

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
            ("voz_transferencias", 0, {"cabecalhos": ["X-CPF"]}, "cabeçalho"),
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

    def test_cabecalhos_no_formato_do_banco(self):
        """voz_transferencias.cabecalhos é text[] no SQL 56: lista do PostgREST ou literal do Postgres."""
        todos = B.CABECALHOS_TRANSFERENCIA
        self.assertEqual(B.ler_cabecalhos(None, "x"), todos)                        # ausente = padrão do banco
        self.assertEqual(B.ler_cabecalhos([], "x"), ())                             # nenhum
        self.assertEqual(B.ler_cabecalhos(["X-MotorCX-Motivo", "X-MotorCX-Id-Chamada"], "x"),
                         ("X-MotorCX-Id-Chamada", "X-MotorCX-Motivo"))
        self.assertEqual(B.ler_cabecalhos("{X-MotorCX-Id-Chamada,X-MotorCX-Id-Acao,X-MotorCX-Acao,X-MotorCX-Motivo}",
                                          "x"), todos)
        for ruim in ({"X-Campanha": "cobranca"}, "X-MotorCX-Motivo", ["X-MotorCX-Cliente"]):
            with self.assertRaises(B.DadosInvalidos):
                B.ler_cabecalhos(ruim, "x")
        d = dados_exemplo()                                 # a linha como o banco devolve (com o default)
        d["voz_transferencias"][0]["cabecalhos"] = list(todos)
        d["voz_transferencias"][0]["credor_id"] = 7
        tf = B.carregar(d).transferencias[0]
        self.assertEqual((tf.cabecalhos, tf.credor_id), (todos, 7))

    def test_variaveis_da_empresa_no_formato_do_banco(self):
        """voz_config.variaveis é text[] (subconjunto de variaveis_voz()); a lista é a mesma do motor."""
        from motor import voz as MV
        self.assertEqual(B.VARIAVEIS_VOZ, MV.VARIAVEIS_VOZ)      # o contêiner do Asterisk leva só voz/
        self.assertEqual(B.ler_variaveis(None, "x"), ("primeiro_nome", "credor", "link_pagamento"))
        self.assertEqual(B.ler_variaveis("{saldo,primeiro_nome}", "x"), ("primeiro_nome", "saldo"))
        self.assertEqual(B.ler_variaveis([], "x"), ())
        for ruim in (["cpf"], "saldo", {"saldo": 1}):
            with self.assertRaises(B.DadosInvalidos):
                B.ler_variaveis(ruim, "x")
        d = dados_exemplo()
        d["voz_config"][0]["variaveis"] = ["saldo", "credor"]
        self.assertEqual(B.carregar(d).config(1).variaveis, ("credor", "saldo"))
        self.assertEqual(B.carregar(dados_exemplo()).config(9).variaveis, B.VARIAVEIS_PADRAO)

    def test_destino_da_carteira_antes_do_da_empresa(self):
        from types import SimpleNamespace as NS
        from voz.orquestrador.nucleo import Orquestrador
        d = dados_exemplo()
        geral = dict(d["voz_transferencias"][0])
        d["voz_transferencias"].append({**geral, "id": 70, "credor_id": 7, "destino_sip": "sip:cart7@203.0.113.61"})
        dados = B.carregar(d)
        destino = lambda chave: Orquestrador._destino_humano(NS(dados=dados), NS(empresa_id=1, lote_chave=chave))  # noqa: E731
        self.assertEqual(destino((1, 7, "discador")).id, 70)          # a da carteira
        self.assertEqual(destino((1, 8, "discador")).id, geral["id"])  # outra carteira: a da empresa toda
        self.assertEqual(destino(()).id, geral["id"])

    def test_sips_usa_tls(self):
        d = dados_exemplo()
        d["voz_transferencias"][0]["destino_sip"] = "sips:fila@discador.exemplo.com.br"
        tf = B.carregar(d).transferencias[0]
        self.assertEqual((tf.esquema, tf.transporte, tf.porta), ("sips", "tls", 5060))

    def test_limite_vem_da_divisao_do_banco(self):
        from voz import configuracao as CF

        class Sb:
            def __init__(self, divisao):
                self.divisao = divisao

            def selecionar(self, tabela, *a, **k):
                d = dados_exemplo()
                d["voz_config"].append({"empresa_id": 2})
                return {"voz_divisao_concorrencia": self.divisao, "voz_contrato": [{"concorrencia_contratada": 9}]
                        }.get(tabela, d.get(tabela))
        d = CF.buscar(Sb([{"empresa_id": 1, "limite": 0}, {"empresa_id": 2, "limite": 3}]))
        cfg = B.carregar(d)
        self.assertEqual((cfg.config(1).limite_simultaneas, cfg.config(2).limite_simultaneas), (0, 3))
        self.assertNotIn("limite_simultaneas", B.COLUNAS["voz_config"])          # não é coluna de voz_config
        d = CF.buscar(Sb([]))                                                       # sem divisão: canais
        self.assertIsNone(B.carregar(d).config(1).limite_simultaneas)

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

    def test_sql103_tronco_sem_senha_no_cofre_fica_de_fora_sozinho(self):
        """Um tronco com senha ainda não guardada (ou apagada) não para a configuração das outras empresas."""
        with tempfile.TemporaryDirectory() as tmp:
            err = io.StringIO()
            with redirect_stderr(err):
                res = G.gerar(dados_exemplo(), Path(tmp), S.Dicionario({}), "203.0.113.10", ["10.60.0.0/24"])
            self.assertEqual((res["troncos"], res["sem_senha"], res["destinos_recusados"]), (2, 1, 0))
            pj = (Path(tmp) / "pjsip_motorcx.conf").read_text()
            ex = (Path(tmp) / "extensions_motorcx.conf").read_text()
            self.assertNotIn("[tr-1-11]", pj)
            self.assertIn("[tr-1-10]", pj)
            self.assertIn("[tr-2-20]", pj)
            self.assertNotIn("@tr-1-11", ex)                               # a rota do tronco 11 sai junto
            self.assertIn("tronco 11 (empresa 1) ficou de fora: senha indisponível no cofre", err.getvalue())
            self.assertNotIn("voz/trunk", err.getvalue())                    # sem nome de segredo no aviso

    def test_sql103_senha_com_ponto_e_virgula_e_lida_uma_vez(self):
        lidas = []

        class Contador(S.Resolvedor):
            def valor(self, ref):
                lidas.append(ref)
                return "abc;def;123"
        d, seg, avisos = G.filtrar_senhas(self.dados, Contador())
        self.assertEqual((lidas, avisos), (["voz/trunk/1-11"], []))
        pj = G.gerar_pjsip(d, seg)
        self.assertIn("password=abc\\;def\\;123\n", pj)
        d2, _, avisos2 = G.filtrar_senhas(self.dados, S.Dicionario({"voz/trunk/1-11": "linha\nquebrada"}))
        self.assertEqual(len(d2.troncos), len(self.dados.troncos) - 1)
        self.assertIn("quebra de linha", avisos2[0])
        self.assertNotIn("linha\nquebrada", avisos2[0])

    def test_sql103_nome_do_segredo_da_empresa(self):
        # a referência que o banco grava (segredo_ref_tronco_voz) vira o nome que a Edge Function escreve
        # (nome_segredo_tronco_voz): motorcx-voz-trunk-e<empresa>-<referência>
        self.assertEqual(S.nome_secret_manager("voz/trunk/e12/aurora-opc"), "motorcx-voz-trunk-e12-aurora-opc")
        self.assertEqual(S.nome_secret_manager("voz/trunk/e3/sp_1"), "motorcx-voz-trunk-e3-sp_1")

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
        self.assertLess(bloco.index("Dial(PJSIP/1010${EXTEN}@tr-1-10,30,S(1200))"),
                        bloco.index("Dial(PJSIP/2020${EXTEN}@tr-1-11,30,S(1200))"))
        self.assertEqual(bloco.count("1010${EXTEN}"), len(DST.PADROES_DIALPLAN))    # uma vez por padrão nacional
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

    def test_formatos_de_discagem(self):
        """tech_ddd_numero (padrão), tech_0_csp_ddd_numero e tech_55_ddd_numero, no dialplan e na rota."""
        casos = [({}, "1010${EXTEN}", "101011988887777"),
                 ({"formato_discagem": "tech_ddd_numero"}, "1010${EXTEN}", "101011988887777"),
                 ({"formato_discagem": "tech_0_csp_ddd_numero", "csp": "21"}, "1010021${EXTEN}", "101002111988887777"),
                 ({"formato_discagem": "tech_55_ddd_numero"}, "101055${EXTEN}", "10105511988887777")]
        for mud, no_dialplan, discado in casos:
            with self.subTest(mud=mud):
                d = dados_exemplo()
                d["voz_troncos"][0].update(mud)
                dados = B.carregar(d)
                ex = G.gerar_extensions(dados)
                bloco = ex.split("[motorcx-saida-1-movel_vc1]")[1].split("\n\n")[0]
                self.assertIn(f"Dial(PJSIP/{no_dialplan}@tr-1-10,30,S(1200))", bloco)
                self.assertIn("Dial(PJSIP/2020${EXTEN}@tr-1-11,30,S(1200))", bloco)     # o outro tronco não muda
                c = T.rotas_para(dados, 1, "11988887777", date(2026, 11, 3))[0]
                self.assertEqual((c.discar, c.endpoint), (discado, f"PJSIP/{discado}@tr-1-10"))

    def test_campos_t4_no_pjsip_e_no_dialplan(self):
        """SQL 113 · Telefonia T4: DTMF, cabeçalho da bina, realm, De, OPTIONS, E.164, toque e duração por tronco."""
        d = dados_exemplo()
        d["voz_troncos"][0].update({"dtmf": "inband", "cabecalho_bina": "rpid", "from_usuario": "4130000000",
                                    "verificar_options": False, "formato_discagem": "tech_e164", "toque_max_s": 25,
                                    "duracao_max_min": 10})
        d["voz_troncos"][1].update({"realm": "sip.operadora-y.example", "cabecalho_bina": "from"})
        dados = B.carregar(d)
        pj = G.gerar_pjsip(dados, self.seg)
        ep10 = pj.split("[tr-1-10]\ntype=endpoint")[1].split("\n\n")[0]
        self.assertIn("dtmf_mode=inband", ep10)
        self.assertIn("send_rpid=yes", ep10)
        self.assertIn("send_pai=no", ep10)
        self.assertIn("from_user=4130000000", ep10)
        self.assertIn("qualify_frequency=0", pj.split("[tr-1-10]\ntype=aor")[1].split("\n\n")[0])
        ep11 = pj.split("[tr-1-11]\ntype=endpoint")[1].split("\n\n")[0]
        self.assertIn("dtmf_mode=auto", ep11)            # padrão do SQL 113
        self.assertIn("send_pai=no", ep11)
        self.assertIn("from_user=motorcx1", ep11)        # com senha e sem "De": o usuário
        self.assertIn("realm=sip.operadora-y.example", pj.split("[tr-1-11-auth]")[1].split("\n\n")[0])
        self.assertIn("qualify_frequency=60", pj.split("[tr-1-11]\ntype=aor")[1].split("\n\n")[0])
        ex = G.gerar_extensions(dados)
        self.assertIn("MOTORCX_DURMAX_TR_1_10=600", ex)
        self.assertIn("MOTORCX_DURMAX_TR_1_11=1200", ex)
        self.assertIn("Set(TIMEOUT(absolute)=", ex.split("[motorcx-atendeu]")[1].split("\n\n")[0])
        bloco = ex.split("[motorcx-saida-1-movel_vc1]")[1].split("\n\n")[0]
        self.assertIn("Dial(PJSIP/1010+55${EXTEN}@tr-1-10,25,S(600))", bloco)
        c = T.rotas_para(dados, 1, "11988887777", date(2026, 11, 3))[0]
        self.assertEqual(c.discar, "1010+5511988887777")
        self.assertEqual(dados.tronco(10).toque_max_s, 25)

    def test_rota_sem_prefixo_nao_manda_o_codigo(self):
        """SQL 113 · G14: rota com enviar_prefixo=false disca sem prefixo (o código fica só na vigência e no custo)."""
        d = dados_exemplo()
        d["voz_rotas"][0]["enviar_prefixo"] = False
        dados = B.carregar(d)
        ex = G.gerar_extensions(dados)
        bloco = ex.split("[motorcx-saida-1-movel_vc1]")[1].split("\n\n")[0]
        self.assertIn("Dial(PJSIP/${EXTEN}@tr-1-10,30,S(1200))", bloco)
        self.assertIn("Set(MOTORCX_TECH_PREFIX=1010)", bloco)
        c = T.rotas_para(dados, 1, "11988887777", date(2026, 11, 3))[0]
        self.assertEqual((c.discar, c.rota.tech_prefix), ("11988887777", "1010"))

    def test_campos_t4_invalidos(self):
        for mud, msg in (({"dtmf": "pulso"}, "dtmf"), ({"cabecalho_bina": "x"}, "cabecalho_bina"),
                         ({"realm": "a b"}, "realm"), ({"from_usuario": "a;b"}, "from_usuario"),
                         ({"toque_max_s": 90}, "toque_max_s"), ({"duracao_max_min": 1}, "duracao_max_min")):
            d = dados_exemplo()
            d["voz_troncos"][0].update(mud)
            with self.assertRaises(B.DadosInvalidos) as cm:
                B.carregar(d)
            self.assertIn(msg, str(cm.exception))

    def test_formato_invalido_ou_sem_csp(self):
        for mud, msg in (({"formato_discagem": "outro"}, "formato_discagem"),
                         ({"formato_discagem": "tech_0_csp_ddd_numero"}, "csp"),
                         ({"formato_discagem": "tech_0_csp_ddd_numero", "csp": "123"}, "csp")):
            d = dados_exemplo()
            d["voz_troncos"][0].update(mud)
            with self.assertRaises(B.DadosInvalidos) as cm:
                B.carregar(d)
            self.assertIn(msg, str(cm.exception))

    def test_gerar_grava_arquivos_com_permissao(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = G.gerar(dados_exemplo(), Path(tmp), self.seg, "203.0.113.10", ["10.60.0.0/24"])
            self.assertEqual(res, {"troncos": 3, "rotas": 6, "transferencias": 2, "provedores_sip": 1,
                               "destinos_recusados": 0, "sem_senha": 0})
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

    def test_sem_tronco_com_senha_nao_precisa_do_cofre(self):
        d = dados_exemplo()
        d["voz_troncos"] = [t for t in d["voz_troncos"] if t.get("autenticacao") != "senha"]
        d["voz_rotas"] = [r for r in d["voz_rotas"] if r["tronco_id"] != 11]
        chamado = []
        seg = S.Tardio(lambda: chamado.append(1) or S.Dicionario({}))
        G.gerar_pjsip(B.carregar(d), seg)
        self.assertEqual(chamado, [])
        with self.assertRaises(S.SegredoAusente):
            G.gerar_pjsip(self.dados, seg)
        self.assertEqual(chamado, [1])

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
