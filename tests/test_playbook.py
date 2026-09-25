"""Testes das regras do playbook: TAG, estados, trilha, acordos e fila do dia."""
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from motor.acordos import Parcela, situacao_acordo
from motor.certificacao import Evento, certificar_contatos
from motor.fila import gerar_fila
from motor.ingestao import carregar_clientes
from motor.marcacao import Cliente, processar_dia
from motor.regua import PADRAO, ReguaInvalida, carregar_regua

RAIZ = Path(__file__).resolve().parent.parent
R = carregar_regua()
SEG = date(2026, 8, 3)  # segunda-feira
TEL, TEL2, MAIL = "11999990000", "11988880000", "c@exemplo.com"


def ev(canal, resultado, dia, contato=TEL, idc="C1", tipo="telefone"):
    return Evento(idc, contato, tipo, canal, resultado, dia, 0.1)


class Cenario:
    """Um cliente, processado dia a dia."""

    def __init__(self, saldo=2000, atraso=30, entrada=SEG, bloqueio=None, contatos=((TEL, "telefone"),)):
        self.clientes = {"C1": Cliente("C1", entrada, saldo, atraso, bloqueio)}
        self.contatos = [{"id_cliente": "C1", "contato": c, "tipo": t} for c, t in contatos]
        self.estados, self.trilha, self.eventos, self.parcelas = {}, [], [], {}

    @property
    def est(self):
        return self.estados["C1"]

    def dia(self, d, eventos=(), disp=None, baixas_ate=None):
        self.eventos += list(eventos)
        self.trilha += processar_dia(self.estados, self.clientes, list(eventos), self.parcelas, d, R,
                                     disp or {"C1": set(R["canais"])}, baixas_ate or d)
        return self.est

    def fila(self, d, flags=None):
        certs = certificar_contatos(self.eventos, d, self.contatos)
        return gerar_fila(self.estados, self.clientes, certs, flags or {}, self.parcelas, d, R, self.eventos)


class TestRegua(unittest.TestCase):
    def test_regua_do_repositorio_e_valida(self):
        self.assertEqual(R["ordem_rotacao"][0], "whatsapp")

    def test_regua_com_canal_inexistente_e_recusada(self):
        d = json.loads(PADRAO.read_text(encoding="utf-8"))
        d["localizacao"]["passos"]["1"] = ["telegrama"]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(d, f)
        with self.assertRaises(ReguaInvalida):
            carregar_regua(f.name)

    def test_cluster(self):
        self.assertEqual([R.cluster(5000, 90), R.cluster(4999.99, 91), R.cluster(999, 181)], ["A1", "M2", "B3"])

    def test_janela(self):
        self.assertIsNone(R.janela(date(2026, 8, 9)))    # domingo
        self.assertIsNone(R.janela(date(2026, 9, 7)))    # feriado
        self.assertEqual(R.janela(date(2026, 8, 8)), ("08:00", "14:00"))  # sábado


class TestMarcacao(unittest.TestCase):
    def test_entrada_gera_tag_de_localizacao(self):
        c = Cenario(saldo=6000, atraso=10)
        c.dia(SEG)
        self.assertEqual(c.est.tag, "S260803-A1-LOC-ND-L0")
        self.assertEqual(c.trilha[0]["quem_marcou"], "Planejamento")

    def test_contato_vira_cpc_a_no_canal_e_sem_resposta_vira_cpc_b(self):
        c = Cenario()
        c.dia(SEG)
        c.dia(SEG + timedelta(1), [ev("whatsapp", "resposta", SEG + timedelta(1))])
        self.assertEqual(c.est.tag, "S260803-M1-CPA-WA-T1")
        c.dia(SEG + timedelta(3), [ev("whatsapp", "entregue", SEG + timedelta(3))])
        self.assertEqual(c.est.tag, "S260803-M1-CPB-WA-T1")

    def test_lido_e_terceiro_nao_sao_contato(self):
        c = Cenario()
        c.dia(SEG)
        c.dia(SEG + timedelta(1), [ev("whatsapp", "lido", SEG + timedelta(1))])
        c.dia(SEG + timedelta(3), [ev("discador", "atendida_terceiro_desconhece", SEG + timedelta(3))])
        self.assertEqual(c.est.estado, "LOC")

    def test_tres_tentativas_e_rotacao_circular_ate_esgotar(self):
        c = Cenario()
        c.dia(SEG)
        d = SEG + timedelta(1)
        c.dia(d, [ev("rcs", "interacao", d)])                      # localizado no RCS
        tags = []
        for canal in ["rcs"] * 3 + ["agente_voz"] * 3 + ["discador"] * 3 + ["sms"] * 3 + ["whatsapp"] * 3:
            d += timedelta(2)
            tags.append(c.dia(d, [ev(canal, "entregue" if canal in ("rcs", "sms", "whatsapp") else "nao_atendida",
                                     d)]).tag)
        self.assertEqual(tags[0], "S260803-M1-CPB-RC-T1")
        self.assertEqual(tags[2], "S260803-M1-CPB-RC-T3")
        self.assertEqual(tags[3], "S260803-M1-CPB-AV-T1")        # depois do RCS vem o agente virtual
        self.assertEqual(tags[12:14], ["S260803-M1-CPB-WA-T1", "S260803-M1-CPB-WA-T2"])  # dá a volta
        self.assertEqual(tags[-1], "S260803-M1-NCP-ND-G1")                  # esgotou os 5 canais

    def test_localizacao_sem_contato_vai_para_giro_no_d8_e_giro_esgota(self):
        c = Cenario()
        for k in range(0, 9):
            c.dia(SEG + timedelta(k))
        self.assertEqual(c.est.tag, "S260803-M1-NCP-ND-G1")
        for k in range(9, 9 + 8 * 3 + 1):
            c.dia(SEG + timedelta(k))
        self.assertEqual((c.est.ciclo, c.est.giro_pausado), ("RE", True))
        self.assertIn("giro", c.est.reenriquecer)

    def test_safra_imutavel_e_cluster_revisado_no_mes(self):
        c = Cenario(saldo=2000, atraso=80, entrada=date(2026, 8, 20))
        c.dia(date(2026, 8, 20))
        c.dia(date(2026, 9, 1))
        self.assertEqual((c.est.cluster_origem, c.est.cluster_atual), ("M1", "M2"))
        self.assertTrue(c.est.tag.startswith("S260820-M2-"))

    def test_bloqueado(self):
        c = Cenario(bloqueio="óbito")
        c.dia(SEG)
        self.assertEqual(c.est.estado, "BLQ")


class TestAcordos(unittest.TestCase):
    def p(self, venc, pago=None, n=1, acordo="A1"):
        return Parcela("C1", acordo, n, venc, 100.0, pago)

    def test_estados_do_acordo(self):
        v = date(2026, 9, 10)
        self.assertEqual(situacao_acordo([self.p(v)], date(2026, 9, 1), date(2026, 8, 31), set())[0], "COL")
        self.assertEqual(situacao_acordo([self.p(v)], date(2026, 9, 7), date(2026, 9, 6), set())[:2], ("PRE", "D-3"))
        self.assertEqual(situacao_acordo([self.p(v)], date(2026, 9, 10), date(2026, 9, 9), set())[:2], ("PRE", "D0"))
        self.assertEqual(situacao_acordo([self.p(v)], date(2026, 9, 11), date(2026, 9, 10), set())[:2], ("QBR", "D1"))
        self.assertEqual(situacao_acordo([self.p(v, v)], date(2026, 9, 11), date(2026, 9, 10), set())[0], "LIQ")

    def test_sem_baixa_nao_quebra(self):
        v = date(2026, 9, 10)
        # arquivo de baixas ainda não cobre o vencimento: não aciona quebra
        self.assertNotEqual(situacao_acordo([self.p(v)], date(2026, 9, 11), date(2026, 9, 9), set())[0], "QBR")

    def test_d6_da_quebra_volta_ao_estoque_como_cpc_a(self):
        c = Cenario()
        c.dia(SEG)
        c.dia(SEG + timedelta(1), [ev("whatsapp", "resposta", SEG + timedelta(1))])
        venc = SEG + timedelta(5)
        c.parcelas = {"C1": [self.p(venc)]}
        for k in range(2, 12):
            c.dia(SEG + timedelta(k))
        self.assertEqual(c.est.tag, "S260803-M1-CPA-WA-T1")
        self.assertIn("A1", c.est.acordos_quebrados)
        self.assertTrue(any("volta ao estoque" in t["motivo"] for t in c.trilha))


class TestFila(unittest.TestCase):
    def test_passos_da_localizacao(self):
        c = Cenario(contatos=((TEL, "telefone"), (MAIL, "email")))
        c.dia(SEG)
        flags = {TEL: {"whatsapp_valido": True}}
        canais = {}
        for k in (1, 3, 5, 7):
            d = SEG + timedelta(k)
            canais[k] = sorted({(l["canal"], l["condicao"]) for l in c.fila(d, flags)[0]})
            c.dia(d)
        self.assertEqual(canais[1], [("whatsapp", "")])
        self.assertEqual(canais[3], [("rcs", "")])
        self.assertEqual(canais[5], [("agente_voz", ""), ("discador", "se agente_voz sem contato no dia")])
        self.assertEqual(canais[7], [("email", ""), ("sms", "")])  # SMS sempre com e-mail de reforço

    def test_whatsapp_nao_certificado_exige_whatsapp_valido_e_um_numero(self):
        c = Cenario(contatos=((TEL, "telefone"), (TEL2, "telefone")))
        c.dia(SEG)
        d = SEG + timedelta(1)
        self.assertEqual(c.fila(d)[0], [])                                   # sem flag: não manda
        flags = {TEL: {"whatsapp_valido": True}, TEL2: {"whatsapp_valido": True}}
        self.assertEqual(len(c.fila(d, flags)[0]), 1)                         # com flag: 1 número só

    def test_recencia_48h_e_isencao_de_data_fixa(self):
        c = Cenario()
        c.dia(SEG)
        d = SEG + timedelta(1)
        c.dia(d, [ev("whatsapp", "resposta", d)])
        self.assertEqual(c.fila(d + timedelta(1))[0], [])                    # 24h depois: não
        self.assertTrue(c.fila(d + timedelta(2))[0])                         # 48h depois: sim
        c.parcelas = {"C1": [Parcela("C1", "A1", 1, d + timedelta(1), 100.0)]}
        c.dia(d)                                                              # acordo → PRE D-1 hoje
        fila = c.fila(d + timedelta(1))[0]                                    # D0 no dia seguinte
        self.assertTrue(fila and fila[0]["data_fixa"])

    def test_domingo_e_colchao_sem_acao(self):
        c = Cenario()
        c.dia(SEG)
        self.assertEqual(c.fila(date(2026, 8, 9))[0], [])
        c.parcelas = {"C1": [Parcela("C1", "A1", 1, SEG + timedelta(30), 100.0)]}
        c.dia(SEG + timedelta(1))
        self.assertEqual(c.est.estado, "COL")
        self.assertEqual(c.fila(SEG + timedelta(3))[0], [])

    def test_b3_so_digital(self):
        c = Cenario(saldo=500, atraso=300)
        c.dia(SEG)
        self.assertEqual(c.fila(SEG + timedelta(5))[0], [])                   # D+5 é voz: B3 não aciona


class TestCarteira(unittest.TestCase):
    def test_varios_contratos(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "c.csv"
            p.write_text("id_cliente;data_entrada;saldo;dias_atraso;bloqueio\n"
                         "C1;2026-08-10;1.000,00;30;\nC1;2026-08-01;4500;100;\nC2;2026-08-01;10;5;óbito\n",
                         encoding="utf-8")
            cl, _ = carregar_clientes(p)
        self.assertEqual((cl["C1"].saldo, cl["C1"].dias_atraso, cl["C1"].data_entrada), (5500.0, 100, date(2026, 8, 1)))
        self.assertEqual(R.cluster(cl["C1"].saldo, cl["C1"].dias_atraso), "A2")
        self.assertEqual(cl["C2"].bloqueio, "óbito")


class TestOperacao(unittest.TestCase):
    def test_simulacao_respeita_as_regras(self):
        from exemplos import simular_operacao
        with tempfile.TemporaryDirectory() as tmp:
            m = simular_operacao.simular(seed=3, dias=30, n_clientes=150, pasta=Path(tmp), verbose=False)
        self.assertEqual((m["violacoes_48h"], m["acoes_domingo_feriado"], m["voz_em_b3"], m["acoes_em_bloqueados"]),
                         (0, 0, 0, 0))
        self.assertGreaterEqual(m["localizador_correto"], 0.95)
        self.assertGreater(m["localizados"], 0)

    def test_rotina_diaria_e_idempotente(self):
        import rodar_dia
        ex = RAIZ / "exemplos"
        with tempfile.TemporaryDirectory() as tmp:
            args = (ex / "clientes.csv", ex / "carteira_contatos.csv", ex / "retornos", date(2026, 9, 25),
                    RAIZ / "layouts", ex / "parcelas.csv", None, None, Path(tmp) / "est", Path(tmp) / "out")
            r1 = rodar_dia.rodar_dia(*args, out=lambda *a: None)
            r2 = rodar_dia.rodar_dia(*args, out=lambda *a: None)
        self.assertTrue(r1["trilha"])
        self.assertEqual(r2["trilha"], [])                    # nada reprocessado
        self.assertEqual(r1["fila"], r2["fila"])


if __name__ == "__main__":
    unittest.main()
