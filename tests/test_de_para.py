"""De-para SIP/Q.850 com as decisões do dono (31/10/2026): quem disca é sempre o agente de IA; a rede, o evento
da IA e a tabulação do operador (discador do cliente, depois da transferência) ficam separados. Só dados
fictícios."""
import csv
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

from motor import discagem as DG
from motor import voz as V
from motor.certificacao import Evento, certificar_contatos
from motor.entrada import LayoutOcorrencia, ler_ocorrencia
from motor.ingestao import ler_retorno, validar_layout
from motor.regua import carregar_regua
from motor.taxonomia import TAXONOMIA, classificar

DIA = date(2026, 10, 30)
HOJE = date(2026, 10, 31)
SP, OUTRO = "11988880001", "11988880002"


class TestTabelaDeCausas(unittest.TestCase):
    def test_json_valido_e_coerente_com_a_confirmacao(self):
        c = V.carregar_causas()
        self.assertTrue(all(c[g] for g in V.GRUPOS_CAUSA))
        for cod, x in c["sip"].items():
            if x["confirma"] == "A":
                self.assertEqual(V.tipo_confirmacao(int(cod), None), "A", cod)
            if x["confirma"] == "B":
                self.assertEqual(V.tipo_confirmacao(int(cod), None), "B", cod)
        for cod, x in c["q850"].items():
            if x["confirma"]:
                self.assertEqual(V.tipo_confirmacao(None, int(cod)), x["confirma"], cod)
        with self.assertRaises(ValueError):
            V.validar_causas({"sip": {"999": {"chave": "xpto"}}})
        with self.assertRaises(ValueError):          # inexistente nunca sem tipo de confirmação
            V.validar_causas({"sip": {"999": {"chave": "numero_inexistente"}}})

    def test_situacoes_do_dono(self):
        self.assertEqual(len(V.SITUACOES_DONO), 8)
        for situacao, chaves in V.SITUACOES_DONO.items():
            for ch in chaves:
                for canal in V.CANAIS_VOZ:
                    self.assertIn(ch, TAXONOMIA[canal], (situacao, ch, canal))
        self.assertEqual(V.SITUACOES_DONO["Número incorreto"], ("numero_inexistente", "atendida_terceiro_desconhece"))
        regua = carregar_regua()
        for canal in V.CANAIS_VOZ:                    # pediu retorno (titular) é CPC
            self.assertIn("retorno_agendado", regua.dados["contato"][canal])


class TestPelaRede(unittest.TestCase):
    def test_casos_do_especialista(self):
        casos = [
            (dict(sip=404, q850=1), "numero_inexistente"),
            (dict(sip=404), "numero_inexistente"),
            (dict(sip=404, q850=3), "falha_operadora"),            # 404 de rota no Brasil
            (dict(sip=503, q850=17), "ocupado"),                   # SIP genérico: o Q.850 decide
            (dict(dialstatus="CONGESTION", q850=22), "numero_inexistente"),
            (dict(dialstatus="CONGESTION"), "falha_operadora"),
            (dict(sip=487, toque_s=8), "cancelada_discador"),
            (dict(sip=487, toque_s=25), "nao_atendida"),
            (dict(dialstatus="CANCEL", toque_s=3), "cancelada_discador"),
            (dict(amd="MACHINE"), "maquina"),
            (dict(amd="HANGUP"), "desligou_sem_conversar"),
            (dict(sip=480), "indisponivel"),
            (dict(sip=603), "rejeitada"),
            (dict(sip=608), "bloqueio_originacao"),
            (dict(sip=484), "numero_inexistente"),                 # tipo B, número canônico
            (dict(sip=200, q850=16), None),                        # atendida: decide a tabulação
        ]
        for kw, esperado in casos:
            self.assertEqual(V.pela_rede(**kw)[0], esperado, kw)

    def test_tipo_b_so_com_numero_canonico(self):
        ch, conf, av = V.pela_rede(sip=484, canonico=False)
        self.assertEqual((ch, conf), ("falha_operadora", None))
        self.assertTrue(any(a.startswith("NORMALIZAÇÃO") for a in av))
        self.assertTrue(V.numero_canonico("11988880001"))
        self.assertTrue(V.numero_canonico("+55 11 3333-4444"))
        self.assertFalse(V.numero_canonico("1188880001"))          # celular sem o 9º dígito
        self.assertFalse(V.numero_canonico("0188880001"))

    def test_causa_desconhecida_avisa_e_nao_decide(self):
        ch, _, av = V.pela_rede(sip=499)
        self.assertIsNone(ch)
        self.assertIn("causa SIP 499 desconhecida (vale a tabulação)", av)


class TestClassificarChamada(unittest.TestCase):
    def test_operador_ia_e_rede_separados(self):
        # a IA localizou, transferiu, o operador fechou promessa: vale o operador
        self.assertEqual(V.classificar_chamada(resultado_ia="cpc", transferencia="atendida",
                                               resultado_operador="promessa")[:2], ("promessa", "operador"))
        # sem operador livre / transferência falhou: abandono (não penaliza o número)
        for tr in ("sem_operador", "falhou"):
            self.assertEqual(V.classificar_chamada(resultado_ia="cpc", transferencia=tr)[:2],
                             ("abandonada", "transferencia"))
        # a IA resolveu sozinha
        self.assertEqual(V.classificar_chamada(resultado_ia="recusa", sip=200)[:2], ("recusa", "ia"))
        # "não atendeu" genérico cede para o que a rede detalhou
        self.assertEqual(V.classificar_chamada(resultado_ia="nao_atendida", sip=480)[:2], ("indisponivel", "rede"))
        self.assertEqual(V.classificar_chamada(resultado_ia="nao_atendida", amd="MACHINE")[:2], ("maquina", "rede"))
        self.assertEqual(V.classificar_chamada()[:2], (None, "nenhum"))

    def test_inexistente_da_tabulacao_precisa_da_rede(self):
        ch, _, av = V.classificar_chamada(resultado_ia="numero_inexistente", sip=503)
        self.assertEqual(ch, "falha_operadora")
        self.assertTrue(av)
        self.assertEqual(V.classificar_chamada(resultado_ia="numero_inexistente", sip=404, q850=1)[0],
                         "numero_inexistente")
        self.assertEqual(V.classificar_chamada(resultado_operador="numero_inexistente", sip=480)[0], "indisponivel")
        # sem nenhuma causa de rede: vale a tabulação (como hoje)
        self.assertEqual(V.classificar_chamada(resultado_ia="numero_inexistente")[0], "numero_inexistente")


class TestTecnicoNaoPenalizaMasConta(unittest.TestCase):
    def test_falha_tecnica(self):
        for ch in ("falha_operadora", "bloqueio_originacao", "cancelada_discador"):
            d = V.POR_CHAVE[ch]
            self.assertTrue(classificar("agente_voz", ch).ignorar, ch)        # fora da certificação
            self.assertTrue(d.conta_tentativa, ch)                            # continua sendo tentativa
            self.assertTrue(DG.e_curta(SimpleNamespace(resultado=ch, duracao_s=None),
                                       {"segundos": 6, "abandono_conta": True}), ch)   # e chamada curta
        ev = [Evento("C1", SP, "telefone", "agente_voz", "falha_operadora", DIA - timedelta(days=i),
                     fornecedor="f", id_externo=str(i)) for i in range(5)]
        self.assertEqual(certificar_contatos(ev, HOJE)[("C1", SP)].status, "DESCONHECIDO")

    def test_indisponivel_nao_desfaz_inexistente_e_caixa_postal_desfaz(self):
        cfg = DG.normalizar({"inexistente": {"so_voz_desde": "2026-01-01"}})[0]
        base = [Evento("C1", SP, "telefone", "agente_voz", "numero_inexistente", HOJE - timedelta(days=12),
                       fornecedor="f", id_externo="a")]
        for ch, encerra in (("indisponivel", True), ("maquina", False), ("rejeitada", False)):
            evs = base + [Evento("C1", SP, "telefone", "agente_voz", ch, HOJE - timedelta(days=5), fornecedor="f",
                                 id_externo="b"),
                          Evento("C1", SP, "telefone", "agente_voz", "numero_inexistente", HOJE - timedelta(days=2),
                                 fornecedor="f", id_externo="c")]
            _, p = DG.protecao_inexistente(evs, HOJE, cfg)
            self.assertEqual(p.restricoes[("C1", SP)] == set(DG.RESTR_ENCERRADA), encerra, ch)

    def test_tipo_b_desligado_pelo_credor(self):
        e = Evento("C1", SP, "telefone", "agente_voz", "numero_inexistente", DIA, fornecedor="f", id_externo="1",
                   causa_sip=484)
        cfg = DG.normalizar({"inexistente": {"so_voz_desde": "2026-01-01", "aceita_tipo_b": False}})[0]
        ev2, p = DG.protecao_inexistente([e], HOJE, cfg)
        self.assertEqual(ev2[0].resultado, "falha_operadora")
        self.assertEqual(p.resumo["tipo_b_desligado"], 1)
        cfg = DG.normalizar({"inexistente": {"so_voz_desde": "2026-01-01"}})[0]
        self.assertEqual(DG.protecao_inexistente([e], HOJE, cfg)[0][0].resultado, "inexistente_voz")


class TestCpcDaIa(unittest.TestCase):
    CFG = DG.normalizar(None)[0]

    def _ev(self, resultado, n, **kw):
        return Evento("C1", SP, "telefone", "agente_voz", resultado, DIA, fornecedor="ia", id_externo=str(n), **kw)

    def test_peso_um_com_identidade_e_meio_sem(self):
        ev, cont = DG.peso_cpc_ia([self._ev("cpc", 1)], self.CFG)
        self.assertEqual((ev[0].peso_pro, dict(cont)), (0.5, {"sem_identidade": 1}))
        ev, _ = DG.peso_cpc_ia([self._ev("cpc", 1, identidade_confirmada=True)], self.CFG)
        self.assertIsNone(ev[0].peso_pro)
        ev, cont = DG.peso_cpc_ia([self._ev("identidade_confirmada", 1), self._ev("promessa", 2)], self.CFG)
        self.assertEqual([e.peso_pro for e in ev], [None, None])
        self.assertEqual(dict(cont), {"com_identidade": 1})
        # tabulação do operador (humano, depois da transferência) vale 1,0
        ev, _ = DG.peso_cpc_ia([self._ev("promessa", 1, origem_resultado="operador")], self.CFG)
        self.assertIsNone(ev[0].peso_pro)
        # configurável
        cfg = DG.normalizar({"agente_ia": {"peso_cpc_sem_identidade": "0,8"}})[0]
        self.assertEqual(DG.peso_cpc_ia([self._ev("cpc", 1)], cfg)[0][0].peso_pro, 0.8)

    def test_certificacao_usa_o_peso(self):
        sem, _ = DG.peso_cpc_ia([self._ev("cpc", 1)], self.CFG)
        com = [self._ev("cpc", 1, identidade_confirmada=True)]
        self.assertLess(certificar_contatos(sem, HOJE)[("C1", SP)].score,
                        certificar_contatos(com, HOJE)[("C1", SP)].score)

    def test_por_destino(self):
        evs = [self._ev("cpc", 1, destino="ia_humano", transferencia="atendida"), self._ev("cpc", 2),
               self._ev("abandonada", 3, destino="ia_humano", transferencia="sem_operador")]
        self.assertEqual(DG.por_destino(evs, DIA), {"ia_humano": 2, "ia": 1, "transferencia_atendida": 1,
                                                   "transferencia_sem_operador": 1})


class TestIngestao(unittest.TestCase):
    def _csv(self, tmp, linhas, cab):
        arq = Path(tmp) / "oc.csv"
        with open(arq, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(cab)
            w.writerows(linhas)
        return arq

    def test_ocorrencia_com_rede_ia_e_operador(self):
        lay = LayoutOcorrencia(
            arquivo="*", canal="agente_voz",
            colunas={"id_cliente": "ID", "data": "DT", "resultado": "RES_IA", "numero_discado": "FONE",
                     "billsec": "SEG", "id_chamada": "CHAMADA", "causa_sip": "SIP", "causa_q850": "Q850",
                     "resultado_operador": "TAB", "transferencia": "TRANSF", "destino": "DEST"},
            resultados={"CPC": "cpc", "PROM": "promessa", "NAO": "sem_contato", "INEX": "invalido"},
            transferencias={"OK": "atendida", "SEMOP": "sem_operador"}, destinos={"IA+HUMANO": "ia_humano"})
        cab = ["ID", "DT", "RES_IA", "FONE", "SEG", "CHAMADA", "SIP", "Q850", "TAB", "TRANSF", "DEST"]
        linhas = [["C1", "30/10/2026", "CPC", SP, "95", "k1", "200", "16", "PROM", "OK", "IA+HUMANO"],
                  ["C2", "30/10/2026", "CPC", OUTRO, "40", "k2", "200", "16", "", "SEMOP", "IA+HUMANO"],
                  ["C3", "30/10/2026", "NAO", "11988880003", "0", "k3", "480", "18", "", "", ""],
                  ["C4", "30/10/2026", "INEX", "11988880004", "0", "k4", "503", "", "", "", ""],
                  ["C4", "30/10/2026", "INEX", "11988880004", "0", "k4", "503", "", "", "", ""]]   # repetida
        with tempfile.TemporaryDirectory() as tmp:
            ev, rel, quar = ler_ocorrencia(self._csv(tmp, linhas, cab), lay, "emp", {})
        self.assertEqual([e.resultado for e in ev], ["promessa", "abandonada", "indisponivel", "falha_operadora"])
        e = ev[0]
        self.assertEqual((e.contato, e.duracao_s, e.id_externo, e.id_chamada), (SP, 95, "agente_voz:k1", "k1"))
        # rede, IA e operador em campos separados
        self.assertEqual((e.causa_sip, e.causa_q850, e.resultado_ia, e.resultado_operador, e.transferencia,
                          e.destino, e.origem_resultado), (200, 16, "cpc", "promessa", "atendida", "ia_humano",
                                                           "operador"))
        self.assertEqual((ev[1].resultado_ia, ev[1].origem_resultado), ("cpc", "transferencia"))
        self.assertEqual(rel.duplicadas, 1)                     # um registro por canal por tentativa
        self.assertNotIn("voz sem número discado", " ".join(rel.avisos))

    def test_ocorrencia_antiga_nao_muda_e_avisa_dados_minimos(self):
        lay = LayoutOcorrencia(arquivo="*", canal="discador",
                               colunas={"id_cliente": "ID", "data": "DT", "resultado": "RES", "contato": "FONE"},
                               resultados={"INEX": "invalido", "NAO": "sem_contato"})
        with tempfile.TemporaryDirectory() as tmp:
            ev, rel, _ = ler_ocorrencia(self._csv(tmp, [["C1", "30/10/2026", "INEX", SP]], ["ID", "DT", "RES", "FONE"]),
                                        lay, "emp", {})
        self.assertEqual(ev[0].resultado, "numero_inexistente")
        self.assertEqual((ev[0].causa_sip, ev[0].resultado_ia, ev[0].origem_resultado), (None, None, None))
        self.assertTrue(any(a.startswith("voz sem número discado") for a in rel.avisos))

    def test_layout_de_fornecedor_com_rede(self):
        lay = validar_layout({"fornecedor": "ia_fict", "canal": "agente_voz", "arquivo": "*",
                              "colunas": {"id_cliente": "id", "numero_discado": "fone", "data": "dt",
                                          "resultado": "res", "id_chamada": "cid", "billsec": "seg",
                                          "causa_sip": "sip", "amd": "amd"},
                              "formato_data": "%Y-%m-%d", "resultados": {"NA": "nao_atendida", "CPC": "cpc"},
                              "custo_fixo": 0.5})
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "r.csv"
            arq.write_text("id,fone,dt,res,cid,seg,sip,amd\n"
                           f"C1,{SP},2026-10-30,NA,x1,30,200,MACHINE\n"
                           f"C2,{OUTRO},2026-10-30,NA,x2,0,404,\n"
                           f"C3,1188880003,2026-10-30,NA,x3,0,484,\n", encoding="utf-8")
            ev, rel, _ = ler_retorno(arq, lay)
        self.assertEqual([e.resultado for e in ev], ["maquina", "numero_inexistente", "falha_operadora"])
        self.assertEqual([e.duracao_s for e in ev], [30, 0, 0])
        self.assertTrue(any(a.startswith("NORMALIZAÇÃO") for a in rel.avisos))


class TestJson(unittest.TestCase):
    def test_regua_tem_o_bloco_agente_ia(self):
        dados = json.loads((Path(__file__).resolve().parent.parent / "regras" / "regua.json").read_text("utf-8"))
        self.assertEqual(DG.normalizar(dados["discagem"])[0]["agente_ia"],
                         {"peso_cpc": 1.0, "peso_cpc_sem_identidade": 0.5})


if __name__ == "__main__":
    unittest.main()
