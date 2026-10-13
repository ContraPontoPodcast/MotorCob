"""Travas configuráveis da estratégia (motor/travas.py): faixas de segurança, janela, fila e MotorCli."""
import unittest
from datetime import date, timedelta

from motor import jornada as jor
from motor import travas as TV
from motor.certificacao import Certificacao
from motor.cluster import carregar_regras
from motor.estrategia import validar_estrategia
from motor.fila import MOTIVOS, gerar_fila
from motor.marcacao import Cliente, EstadoCliente
from motor.regua import carregar_regua

SEG = date(2026, 9, 14)          # segunda
SAB, DOM = SEG + timedelta(days=5), SEG + timedelta(days=6)
FERIADO = date(2026, 9, 7)       # 7 de setembro (segunda)


class TestLer(unittest.TestCase):
    def test_faixas_de_seguranca(self):
        t, av = TV.ler({"travas": {"intervalo": {"horas": 4}, "horario": {"de": "06:00", "ate": "22:00"},
                                   "freio_whatsapp": {"taxa": 9, "minimo": 100}}})
        self.assertEqual(t["recencia_horas"], 12)
        self.assertEqual(t["travas_janela"]["seg_sex"], ["08:00", "20:00"])
        self.assertEqual(t["whatsapp"], {"limite_taxa_bloqueio": 0.05, "minimo_envios_para_freio": 100})
        self.assertEqual(len(av), 3)

    def test_desligar_nunca_passa_da_faixa(self):
        t, _ = TV.ler({"travas": {"intervalo": {"ligado": False}, "horario": {"ligado": False},
                                  "freio_whatsapp": {"ligado": False}, "pausa_carteiras": {"ligado": False}}})
        self.assertEqual((t["recencia_horas"], t["pausa_carteiras_horas"]), (12, 0))
        self.assertEqual(t["travas_janela"]["seg_sex"], ["08:00", "20:00"])
        self.assertEqual(t["travas_janela"]["sabado"], ["08:00", "20:00"])     # desligada: sábado normal
        self.assertEqual(t["whatsapp"]["limite_taxa_bloqueio"], 0.05)

    def test_dias_sabado_domingo_e_feriado(self):
        t, _ = TV.ler({"travas": {"horario": {"de": "09:00", "ate": "19:00", "sabado": "nao"},
                                  "domingo_feriado": {"domingo": "digitais", "feriados": "nenhum"}}})
        tj = t["travas_janela"]
        self.assertEqual((tj["dias_semana"], tj["respeita_feriados"], t["domingo_so_digitais"]),
                         ([0, 1, 2, 3, 4, 6], False, True))
        fer = [FERIADO.isoformat()]
        self.assertEqual(TV.janela_com_travas(("08:00", "20:00"), tj, SEG, fer), ("09:00", "19:00"))
        self.assertIsNone(TV.janela_com_travas(("08:00", "14:00"), tj, SAB, fer))
        self.assertEqual(TV.janela_com_travas(("08:00", "20:00"), tj, FERIADO, fer), ("09:00", "19:00"))
        self.assertIsNone(TV.janela_com_travas(None, tj, SEG, fer))           # calendário fechou: continua fechado

    def test_limite_restante(self):
        hist = [(SEG - timedelta(days=n), "sms") for n in (1, 2, 3, 10, 20)]
        self.assertEqual(TV.limite_restante({"dia": 2, "semana": 4, "mes": 6}, hist, SEG), 1)
        self.assertEqual(TV.limite_restante({"semana": 3}, hist, SEG), 0)
        self.assertIsNone(TV.limite_restante(None, hist, SEG))

    def test_trava_que_nao_existe_na_frente(self):
        _, av = TV.ler({"travas": {"freio_whatsapp": {"taxa": 2}}}, "cli")
        self.assertTrue(av and "não existe" in av[0])


TEL, TEL2 = "11988880001", "11988880002"


def _fila(travas, dia=SEG, hist=None, pausados=frozenset(), estado="LOC"):
    regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
    defin = {"travas": travas, "localizacao": {"passos": {"1": [{"canal": "whatsapp", "modo": "sempre"},
                                                                 {"canal": "sms", "modo": "junto"},
                                                                 {"canal": "discador", "modo": "junto"}]}}}
    over, erros = validar_estrategia(defin)
    assert not erros, erros
    regua = carregar_regua().com_clusters(regras, {7: over}, None, {})
    est = {"C1": EstadoCliente("C1", dia, "DG", "DG", "2026-09", estado=estado, cluster_versao=regua.versao_clusters)}
    cli = {"C1": Cliente("C1", dia, 5000.0, 30)}
    certs = {("C1", c): Certificacao("C1", c, "telefone", "CERTIFICADO", 0.9) for c in (TEL, TEL2)}
    flags = {TEL: {"whatsapp_valido": True}}
    motivos = {}
    fila, _, alertas = gerar_fila(est, cli, certs, flags, {}, dia, regua, [], None, motivos=motivos,
                                  pausados=pausados, historico_acoes=hist)
    return fila, motivos, regua


class TestFila(unittest.TestCase):
    def test_sem_travas_continua_igual(self):
        fila, motivos, _ = _fila({})
        self.assertEqual({l["canal"] for l in fila}, {"whatsapp", "sms", "discador"})

    def test_limite_de_acoes_corta_canais_e_bloqueia_com_historico(self):
        fila, _, _ = _fila({"limite_acoes": {"dia": 2}})
        self.assertEqual({l["canal"] for l in fila}, {"whatsapp", "sms"})
        hist = {"C1": [(SEG - timedelta(days=n), "sms") for n in (2, 3, 4)]}
        fila, motivos, _ = _fila({"limite_acoes": {"semana": 3}}, hist=hist)
        self.assertEqual((fila, motivos), ([], {"limite_acoes": 1}))
        self.assertIn("limite_acoes", MOTIVOS)

    def test_domingo_so_digitais_e_horario_da_trava(self):
        trava = {"horario": {"de": "09:00", "ate": "18:00", "sabado": "normal"},
                 "domingo_feriado": {"domingo": "digitais", "feriados": "nacionais"}}
        fila, _, regua = _fila(trava, dia=DOM)
        self.assertEqual({l["canal"] for l in fila}, {"whatsapp", "sms"})
        self.assertEqual({l["janela"] for l in fila}, {"09:00-18:00"})
        fila, _, _ = _fila(trava, dia=SEG)
        self.assertEqual({l["canal"] for l in fila}, {"whatsapp", "sms", "discador"})
        fila, motivos, _ = _fila(trava, dia=FERIADO)
        self.assertEqual((fila, motivos), ([], {"domingo_feriado": 1}))

    def test_pausa_entre_carteiras_pela_trava(self):
        ontem = {"C1": SEG - timedelta(days=1)}
        _, motivos, _ = _fila({}, pausados=ontem)                                 # padrão 48h: pausado
        self.assertEqual(motivos, {"outro_credor": 1})
        fila, _, _ = _fila({"pausa_carteiras": {"horas": 12}}, pausados=ontem)   # 12h: já pode
        self.assertTrue(fila)

    def test_ligacoes_por_dia_e_nao_perturbe(self):
        fila, _, _ = _fila({"ligacoes": {"por_dia": 5}})
        self.assertEqual({l["spins_max"] for l in fila if l["canal"] == "discador"}, {5})
        over, _ = validar_estrategia({"travas": {"nao_perturbe": {"quem": "todos"}}})
        self.assertTrue(over["nao_perturbe_todos"])


class TestJornada(unittest.TestCase):
    def test_limite_para_leads_e_intervalo(self):
        prosp = {"id": "prospeccao", "nome": "Prospecção", "condicoes": [{"campo": "e_cliente", "op": "=", "valor": "não"}],
                 "referencia": {"tipo": "lead"}, "de": 0, "ate": 30,
                 "passos": {str(d): [{"canal": "sms", "modo": "sempre"}] for d in range(0, 30, 2)}}
        regras = jor.carregar_jornada(definicao={"etapas": [prosp], "travas": {
            "intervalo": {"horas": 24}, "limite_leads": {"semana": 2}}})
        self.assertEqual(regras["recencia_horas"], 24)
        leads = {"L1": jor.Lead("L1", SEG, "site", "consentimento")}
        cont = [{"id_cliente": "L1", "contato": TEL, "tipo": "telefone"}]
        estado, et, enviados = {}, {}, []
        for n in range(0, 9, 2):
            res = jor.gerar({}, cont, SEG + timedelta(days=n), regras, estado, leads=leads, etapas_estado=et)
            enviados += [n for l in res.fila]
        self.assertEqual(enviados, [0, 2, 8])       # dias 4 e 6: já tinha 2 na semana
        self.assertEqual(res.motivos.get(jor.M_LIMITE, 0), 0)
