"""MotorCli (revisão de UX): resultado de cada momento, movimento, melhor canal pelo resultado, prioridade,
orçamento por canal no momento e mensagem por passo."""
import copy
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from motor import jornada as jor
from motor import jornada_resultados as jr
from rodar_jornada import rodar_jornada

HOJE = date(2026, 10, 13)
REGRAS = jor.carregar_jornada()


def cli(idc="C1", **kw):
    return jor.ClienteJornada(idc, **kw)


def momento(c, hoje):
    return jor.momento_aplicavel(c, REGRAS, hoje)


def dia(clientes, hoje, estado, acoes=None):
    return jr.calcular({c.id_cliente: c for c in clientes}, lambda c: momento(c, hoje), hoje, estado, acoes or {})


class Resultados(unittest.TestCase):
    def test_pre_vencimento_pagou_em_dia_conta_para_o_ultimo_canal(self):
        v = HOJE + timedelta(days=1)
        est = {}
        dia([cli(vencimento=v)], HOJE, est)
        acoes = {"C1": {"ultima": HOJE.isoformat(), "canal": "whatsapp"}}
        d, mov = dia([cli(vencimento=v, pago=True)], HOJE + timedelta(days=1), est, acoes)
        self.assertEqual(d, {("pre_vencimento", "whatsapp", 0, "sucesso"): 1})
        d, _ = dia([cli(vencimento=v, pago=True)], HOJE + timedelta(days=2), est, acoes)
        self.assertEqual(d, {})                                   # uma vez por episódio

    def test_pre_vencimento_venceu_sem_pagar_e_foi_para_a_cobranca(self):
        v = HOJE
        est = {}
        dia([cli(vencimento=v)], HOJE, est)
        d, _ = dia([cli(vencimento=v)], HOJE + timedelta(days=2), est)
        self.assertEqual(d, {("pre_vencimento", "", 0, "nao"): 1})  # sem ação nos 7 dias: canal vazio
        d, mov = dia([cli(vencimento=v, dias_atraso=3)], HOJE + timedelta(days=3), est)
        self.assertEqual(d, {("", "", 0, "cobranca"): 1})
        self.assertEqual(mov, {("fora", "cobranca"): 1})

    def test_base_antiga_nao_vira_resultado_no_primeiro_dia(self):
        est = {}
        velho = cli(contratacao=HOJE - timedelta(days=400), vencimento=HOJE - timedelta(days=60))
        d, mov = dia([velho], HOJE, est)
        self.assertEqual(d, {})
        d, _ = dia([velho], HOJE + timedelta(days=1), est)
        self.assertEqual(d, {})

    def test_ativacao_ativou_e_nao_ativou(self):
        est = {}
        c1 = cli("A", contratacao=HOJE - timedelta(days=10), ativado=False)
        c2 = cli("B", contratacao=HOJE - timedelta(days=30), ativado=False)
        dia([c1, c2], HOJE, est)
        c1.ativado = True
        d, _ = dia([c1, c2], HOJE + timedelta(days=1), est)
        self.assertEqual(d[("ativacao", "", 0, "sucesso")], 1)
        self.assertEqual(d[("ativacao", "", 0, "nao")], 1)

    def test_retencao_voltou_a_usar_e_movimento(self):
        est = {}
        c = cli(contratacao=HOJE - timedelta(days=300), ativado=True, ultima_atividade=HOJE - timedelta(days=40))
        dia([c], HOJE, est)
        self.assertEqual(est["C1"]["m"], "retencao")
        c.ultima_atividade = HOJE
        d, mov = dia([c], HOJE + timedelta(days=1), est)
        self.assertEqual(d, {("retencao", "", 0, "sucesso"): 1})
        self.assertEqual(mov, {("retencao", "voltou_a_usar"): 1})

    def test_retencao_chega_aos_90_dias(self):
        est = {}
        c = cli(contratacao=HOJE - timedelta(days=300), ativado=True, ultima_atividade=HOJE - timedelta(days=89))
        dia([c], HOJE, est)
        d, mov = dia([c], HOJE + timedelta(days=1), est)
        self.assertEqual(d, {("retencao", "", 0, "nao"): 1})
        self.assertEqual(mov, {("retencao", "reativacao"): 1})

    def test_boas_vindas_recebeu_a_primeira_acao(self):
        est = {}
        c = cli(contratacao=HOJE)
        dia([c], HOJE, est)
        acoes = {"C1": {"ultima": HOJE.isoformat(), "canal": "email",
                        "momentos": {"boas_vindas": {"episodio": HOJE.isoformat(), "feitos": [0]}}}}
        d, _ = dia([c], HOJE + timedelta(days=1), est, acoes)
        self.assertEqual(d, {("boas_vindas", "email", 0, "sucesso"): 1})

    def test_quem_sai_da_carga_sai_do_estado(self):
        est = {}
        dia([cli("A", contratacao=HOJE), cli("B", contratacao=HOJE)], HOJE, est)
        dia([cli("A", contratacao=HOJE)], HOJE + timedelta(days=1), est)
        self.assertEqual(set(est), {"A"})


class MelhorCanal(unittest.TestCase):
    def test_taxas_com_amostra_minima(self):
        linhas = [{"momento": "pre_vencimento", "canal": "whatsapp", "desfecho": "sucesso", "clientes": 182},
                  {"momento": "pre_vencimento", "canal": "whatsapp", "desfecho": "nao", "clientes": 18},
                  {"momento": "pre_vencimento", "canal": "sms", "desfecho": "sucesso", "clientes": 150},
                  {"momento": "pre_vencimento", "canal": "sms", "desfecho": "nao", "clientes": 50},
                  {"momento": "pre_vencimento", "canal": "rcs", "desfecho": "sucesso", "clientes": 10},
                  {"momento": "pre_vencimento", "canal": "", "desfecho": "sucesso", "clientes": 900}]
        t = jr.taxas_por_momento(linhas)
        self.assertEqual(t, {"pre_vencimento": {"whatsapp": 91.0, "sms": 75.0}})
        escolher = jr.melhor_por_resultado(t)
        self.assertEqual(escolher(["sms", "whatsapp"], "pre_vencimento"),
                         (["whatsapp", "sms"], "melhor canal: 91% pagam em dia"))
        ordem, por_que = escolher(["rcs", "sms"], "pre_vencimento")   # rcs sem histórico: vale a reserva
        self.assertEqual(ordem, ["rcs", "sms"])
        self.assertIn("sem histórico", por_que)

    def test_gerar_marca_o_por_que_na_fila(self):
        escolher = jr.melhor_por_resultado({"pre_vencimento": {"whatsapp": 91.0, "sms": 75.0}})
        c = cli(vencimento=HOJE + timedelta(days=2))
        r = jor.gerar({"C1": c}, [{"id_cliente": "C1", "contato": "11999990000", "tipo": "telefone"}], HOJE, REGRAS,
                      {}, whatsapp_ok={"11999990000"}, melhor=escolher)
        self.assertEqual(r.fila[0]["canal"], "whatsapp")
        self.assertEqual(r.fila[0]["por_que"], "melhor canal: 91% pagam em dia")


class Estrategia(unittest.TestCase):
    def test_prioridade_editavel(self):
        d = jor.carregar_jornada(definicao={"hierarquia": ["ativacao", "pre_vencimento", "boas_vindas", "retencao",
                                                           "reativacao"]})
        c = cli(contratacao=HOJE - timedelta(days=3), ativado=False, vencimento=HOJE + timedelta(days=2))
        self.assertEqual(jor.momento_aplicavel(c, d, HOJE), "ativacao")
        with self.assertRaises(jor.JornadaInvalida):
            jor.carregar_jornada(definicao={"hierarquia": ["ativacao", "ativacao"]})

    def test_orcamento_por_canal_no_momento(self):
        d = jor.carregar_jornada(definicao={"momentos": {"pre_vencimento": {"orcamento": {"sms": 1}}}})
        clientes = {f"C{i}": cli(f"C{i}", vencimento=HOJE) for i in range(3)}
        contatos = [{"id_cliente": f"C{i}", "contato": f"1199999000{i}", "tipo": "telefone"} for i in range(3)]
        r = jor.gerar(clientes, contatos, HOJE, d, {}, whatsapp_ok=set())
        self.assertEqual(len(r.fila), 1)
        self.assertEqual(r.motivos[jor.M_ORCAMENTO_MOMENTO], 2)
        with self.assertRaises(jor.JornadaInvalida):
            jor.carregar_jornada(definicao={"momentos": {"pre_vencimento": {"orcamento": {"pombo": 1}}}})

    def test_mensagem_do_passo_vai_na_lista(self):
        d = jor.carregar_jornada(definicao={"momentos": {"pre_vencimento": {"passos": {
            "0": [{"canal": "sms", "frase_id": 7}]}}}})
        r = jor.gerar({"C1": cli(vencimento=HOJE)}, [{"id_cliente": "C1", "contato": "11999990000", "tipo": "telefone"}],
                      HOJE, d, {}, whatsapp_ok=set())
        self.assertEqual(r.fila[0]["frase_acao"], {"frase_id": 7})
        with self.assertRaises(jor.JornadaInvalida):
            jor.carregar_jornada(definicao={"momentos": {"pre_vencimento": {"passos": {"0": [{"canal": "sms", "frase_id": "x"}]}}}})


class Rotina(unittest.TestCase):
    def test_rotina_devolve_resultados_e_usa_a_frase(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "clientes.csv").write_text("id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade\n"
                                            f"C1;2026-01-10;{HOJE.isoformat()};não;sim;{HOJE.isoformat()}\n", encoding="utf-8")
            (d / "contatos.csv").write_text("id_cliente;contato;tipo\nC1;11999990000;telefone\n", encoding="utf-8")
            definicao = {"momentos": {"pre_vencimento": {"passos": {"0": [{"canal": "sms", "frase_id": 3}]}}}}
            frases = [{"id": 3, "texto": "Sua fatura vence hoje.", "ativo": True}]
            r = rodar_jornada(d / "clientes.csv", d / "contatos.csv", HOJE, d / "estado", d / "saida", definicao=definicao,
                              frases=frases, out=lambda *a: None)
            self.assertEqual(r["fila"][0]["mensagem"], "Sua fatura vence hoje.")
            self.assertEqual(r["movimento"], [{"de": "entrada", "para": "pre_vencimento", "clientes": 1}])
            (d / "clientes.csv").write_text("id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade\n"
                                            f"C1;2026-01-10;{HOJE.isoformat()};sim;sim;{HOJE.isoformat()}\n", encoding="utf-8")
            r = rodar_jornada(d / "clientes.csv", d / "contatos.csv", HOJE + timedelta(days=1), d / "estado", d / "saida",
                              definicao=definicao, frases=frases, out=lambda *a: None)
            self.assertEqual(r["desfechos"], [{"momento": "pre_vencimento", "canal": "sms", "frase_id": 3, "desfecho": "sucesso",
                                              "clientes": 1}])

            # histórico de 90 dias (SQL 55): dia 1 entrou no Pré-vencimento com SMS; dia 2 fechou o resultado
            self.assertEqual(r["historico"], [{"id_cliente": "C1", "fase": "", "entrou": True, "passo": "",
                                               "canal": "", "desfecho": "sucesso", "desfecho_momento": "pre_vencimento"}])


class Historico(unittest.TestCase):
    """Histórico de 90 dias do cliente no site (Onda 3, SQL 55): só os dias com algo, só o ID."""

    def test_calcular_devolve_o_resultado_de_cada_cliente(self):
        v = HOJE + timedelta(days=1)
        est, por = {}, {}
        dia([cli(vencimento=v)], HOJE, est)
        acoes = {"C1": {"ultima": HOJE.isoformat(), "canal": "whatsapp"}}
        jr.calcular({"C1": cli(vencimento=v, pago=True)}, lambda c: momento(c, HOJE + timedelta(days=1)),
                    HOJE + timedelta(days=1), est, acoes, por_cliente=por)
        self.assertEqual(por, {"C1": ("pre_vencimento", "sucesso")})

    def test_so_grava_o_dia_com_algo(self):
        from rodar_jornada import historico_do_dia
        enq = {"A": {"fase": "retencao", "passo": "D+30"}, "B": {"fase": "retencao", "passo": ""},
               "C": {"fase": "ativacao", "passo": "D+3"}, "D": {"fase": "reativacao", "passo": ""},
               "L1": {"fase": "", "passo": "D0"}}
        fila = [{"id_cliente": "A", "canal": "whatsapp"}, {"id_cliente": "A", "canal": "sms"},
                {"id_cliente": "L1", "canal": "email"}]
        antes = {"A": "retencao", "B": "retencao", "C": None, "D": "retencao"}     # L1 é lead: fora
        linhas = historico_do_dia(enq, fila, antes, {"D": ("retencao", "nao")})
        self.assertEqual([(x["id_cliente"], x["entrou"], x["canal"], x["desfecho"]) for x in linhas],
                         [("A", False, "whatsapp", ""), ("C", True, "", ""), ("D", True, "", "nao")])
        self.assertTrue(all(set(x) == {"id_cliente", "fase", "entrou", "passo", "canal", "desfecho", "desfecho_momento"}
                            for x in linhas))

    def test_sincronizar_troca_o_dia_e_apaga_o_que_passou_de_90_dias(self):
        from nuvem import sincronizar as S

        class SB:
            def __init__(self, falha=False):
                self.chamadas, self.falha = [], falha

            def apagar(self, tabela, filtros):
                if self.falha:
                    raise RuntimeError("relation jornada_cliente_dia does not exist")
                self.chamadas.append(("apagar", tabela, filtros["data"]))

            def inserir(self, tabela, linhas):
                self.chamadas.append(("inserir", tabela, len(linhas)))

        sb = SB()
        r = {"historico": [{"id_cliente": f"C{i}", "fase": "retencao", "entrou": True, "passo": "", "canal": "",
                            "desfecho": "", "desfecho_momento": ""} for i in range(1500)]}
        S._publicar_historico_jornada(sb, 7, 9, HOJE, r, out=lambda *a: None)
        self.assertEqual(sb.chamadas, [("apagar", "jornada_cliente_dia", "eq.2026-10-13"),
                                       ("apagar", "jornada_cliente_dia", "lt.2026-07-15"),
                                       ("inserir", "jornada_cliente_dia", 1000), ("inserir", "jornada_cliente_dia", 500)])
        avisos = []
        S._publicar_historico_jornada(SB(falha=True), 7, 9, HOJE, r, out=avisos.append)
        self.assertTrue(avisos and "histórico da jornada não gravado" in avisos[0])

if __name__ == "__main__":
    unittest.main()
