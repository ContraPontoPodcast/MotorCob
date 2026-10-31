"""Eventos pós-atendimento de voz (IA e operador) movem o processo: saída de etapa (promessa, retorno agendado,
além de cpc, acordo, pagamento e fim da janela), renitência e próxima ação. Decisões do dono (31/10/2026).
Só dados fictícios."""
import csv
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

from motor import discagem as DG
from motor import etapas as ET
from motor import voz as V
from motor.certificacao import Certificacao, Evento
from motor.cluster import carregar_regras
from motor.entrada import LayoutOcorrencia, ler_ocorrencia
from motor.estrategia import validar_estrategia
from motor.fila import gerar_fila
from motor.marcacao import Cliente, EstadoCliente
from motor.regua import carregar_regua

SP = "11988880001"
D0 = date(2026, 11, 3)            # terça (02/11 é Finados)
TICKET = {"id": "ticket-alto", "nome": "Ticket alto", "condicoes": [{"campo": "saldo", "op": ">", "valor": 1000}],
          "referencia": {"tipo": "entrada"}, "de": 0, "ate": 20,
          "passos": {"0": [{"canal": "discador", "modo": "sempre"}], "1": [{"canal": "sms", "modo": "sempre"}]},
          "saidas": {"promessa": "sai", "retorno_agendado": "etapa:retorno", "acordo": "padrao"}}
RETORNO = {"id": "retorno", "nome": "Retorno pedido", "condicoes": [{"campo": "saldo", "op": ">", "valor": 10 ** 9}],
           "referencia": {"tipo": "entrada"}, "de": 0, "ate": 3,
           "passos": {"0": [{"canal": "agente_voz", "modo": "sempre"}]}}
LAYOUT = LayoutOcorrencia(
    arquivo="*", canal="agente_voz",
    colunas={"id_cliente": "ID", "data": "DT", "resultado": "IA", "numero_discado": "FONE", "billsec": "SEG",
             "id_chamada": "CHAMADA", "resultado_operador": "OPER", "transferencia": "TRANSF",
             "data_promessa": "DATA_PROM", "valor_promessa": "VALOR", "retorno_em": "RETORNO",
             "identidade_confirmada": "IDENT"},
    resultados={"CPC": "cpc", "PROMESSA": "promessa", "ACORDO": "promessa", "RETORNO": "retorno_agendado",
                "RECUSA": "recusa"},
    transferencias={"OK": "atendida"})
CAB = ["ID", "DT", "IA", "FONE", "SEG", "CHAMADA", "OPER", "TRANSF", "DATA_PROM", "VALOR", "RETORNO", "IDENT"]


def _ler(linhas):
    with tempfile.TemporaryDirectory() as tmp:
        arq = Path(tmp) / "oc.csv"
        with open(arq, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(CAB)
            w.writerows(linhas)
        ev, rel, quar = ler_ocorrencia(arq, LAYOUT, "emp", {})
    assert not quar, quar
    ev, _ = V.unificar_chamadas(ev)
    return ev, rel


def _etapas():
    over, erros = validar_estrategia({"etapas": [TICKET, RETORNO]})
    assert not erros, erros
    return over["etapas"], over["ordem_etapas"]


def _esc(estado, eventos, dia, fase="giro"):
    et, ordem = _etapas()
    return ET.escolher(et, ordem, fase, {"saldo": 5000, "dias_atraso": 40}, {}, eventos, estado, "C1", dia)


class TestPromessa(unittest.TestCase):
    """Promessa em 05/11 de R$ 200 suspende a voz até 06/11 (a baixa entra D+1)."""

    def setUp(self):
        self.ev, _ = _ler([["C1", "03/11/2026", "PROMESSA", SP, "80", "k1", "", "", "05/11/2026", "200,00", "", "sim"]])

    def test_campos_da_promessa(self):
        e = self.ev[0]
        self.assertEqual((e.resultado, e.data_promessa, e.valor_promessa, e.identidade_confirmada),
                         ("promessa", date(2026, 11, 5), 200.0, True))

    def test_suspende_a_voz_ate_o_dia_seguinte_da_promessa(self):
        cfg = DG.normalizar({"promessa_suspende": {"ativo": True}})[0]
        for hoje, suspensa in ((date(2026, 11, 4), True), (date(2026, 11, 5), True), (date(2026, 11, 6), True),
                               (date(2026, 11, 7), False)):
            sem_voz, _, _ = DG.renitencia(self.ev, hoje, cfg)
            self.assertEqual("C1" in sem_voz, suspensa, hoje)
        self.assertEqual(DG.renitencia(self.ev, date(2026, 11, 4), cfg)[0]["C1"],
                         "promessa de pagamento para 05/11: voz suspensa até 06/11")
        # a voz para; WhatsApp, SMS e e-mail seguem a régua
        disc = DG.Discagem(date(2026, 11, 6), DG.renitencia(self.ev, date(2026, 11, 6), cfg)[0])
        self.assertIn("C1", disc.sem_voz)

    def test_saida_de_etapa_por_promessa(self):
        estado = {}
        self.assertEqual(_esc(estado, set(), D0).etapa.id, "ticket-alto")
        ev = ET.eventos_pos_atendimento(self.ev, None, date(2026, 11, 4))         # chamada de ontem
        self.assertEqual(ev, {"promessa"})
        self.assertIs(_esc(estado, ev, date(2026, 11, 4)), ET.FORA)                # saída "sai"
        self.assertEqual(estado["C1"]["fora"]["motivo"], "promessa")


class TestRetornoAgendado(unittest.TestCase):
    """Atendeu e pediu retorno às 14:30: a voz espera até o dia; no dia, topo do mailing com agendar_para."""
    CFG = DG.normalizar(None)[0]

    def _ev(self, quando, dia=date(2026, 11, 4)):
        return _ler([["C1", dia.strftime("%d/%m/%Y"), "RETORNO", SP, "40", "k9", "", "", "", "", quando, "sim"]])[0]

    def test_retorno_as_14_30(self):
        ev = self._ev("05/11/2026 14:30")
        self.assertEqual((ev[0].resultado, ev[0].retorno_em), ("retorno_agendado", datetime(2026, 11, 5, 14, 30)))
        espera, hoje, av = DG.retornos_agendados(ev, date(2026, 11, 5), self.CFG)
        self.assertEqual((espera, hoje, av), ({}, {"C1": "2026-11-05T14:30"}, []))
        ev = self._ev("06/11/2026 14:30")
        espera, hoje, _ = DG.retornos_agendados(ev, date(2026, 11, 5), self.CFG)
        self.assertEqual((espera, hoje), ({"C1": "retorno agendado para 06/11 às 14:30"}, {}))

    def test_fora_da_faixa_vai_para_a_proxima_abertura(self):
        _, hoje, av = DG.retornos_agendados(self._ev("05/11/2026 21:00"), date(2026, 11, 6), self.CFG)
        self.assertEqual(hoje, {"C1": "2026-11-06T08:00"})
        self.assertTrue(av and av[0].startswith("DISCAGEM: 1 retorno pedido fora da faixa"))
        _, hoje, _ = DG.retornos_agendados(self._ev("08/11/2026 10:00", date(2026, 11, 6)), date(2026, 11, 9),
                                           self.CFG)                                         # domingo -> segunda
        self.assertEqual(hoje, {"C1": "2026-11-09T08:00"})
        _, hoje, _ = DG.retornos_agendados(self._ev(""), date(2026, 11, 5), self.CFG)        # sem hora: D+1
        self.assertEqual(hoje, {"C1": "2026-11-05"})
        desl = DG.normalizar({"retorno_agendado": {"ativo": False}})[0]
        self.assertEqual(DG.retornos_agendados(self._ev("05/11/2026 14:30"), date(2026, 11, 5), desl), ({}, {}, []))

    def test_mailing_poe_o_retorno_no_topo(self):
        regua = carregar_regua()
        fila = [{"canal": "discador", "id_cliente": i, "contato": c, "ordem_contato": 1, "condicao": "",
                 "janela": "08:00-20:00", "prioridade": p, "agendar_para": ag}
                for i, c, p, ag in (("C2", "11988880002", 1, ""), ("C1", SP, 5, "2026-11-05T14:30"))]
        linhas, _ = DG.linhas_mailing(fila, date(2026, 11, 5), lambda i: regua)
        self.assertEqual(DG.CAMPOS_MAILING[-1], "agendar_para")
        self.assertEqual([(l[0], l[-1]) for l in linhas], [("C1", "2026-11-05T14:30"), ("C2", "")])

    def test_saida_de_etapa_para_a_etapa_de_retorno(self):
        estado = {}
        _esc(estado, set(), D0)
        ev = ET.eventos_pos_atendimento(self._ev("05/11/2026 14:30"), None, date(2026, 11, 5))
        self.assertEqual(ev, {"retorno_agendado"})
        self.assertEqual(_esc(estado, ev, date(2026, 11, 5)).etapa.id, "retorno")


class TestAcordo(unittest.TestCase):
    def test_acordo_sai_pela_mudanca_de_estado_e_acordo_da_ia_e_promessa(self):
        estado = {}
        self.assertEqual(_esc(estado, set(), D0).etapa.id, "ticket-alto")
        ev = ET.eventos_cob("CPA", "PRE")                     # acordo de verdade: nasce das parcelas
        self.assertEqual(ev, {"acordo"})
        self.assertIsNone(_esc(estado, ev, D0 + timedelta(days=1), fase="preventivo"))   # "padrao": volta à fase
        self.assertEqual(estado["C1"]["etapas"]["ticket-alto"]["motivo"], "acordo")
        # acordo proposto pela IA/operador entra como promessa (não vira acordo sem as parcelas)
        ev_ia, _ = _ler([["C2", "03/11/2026", "ACORDO", SP, "300", "k5", "", "", "10/11/2026", "450", "", "sim"]])
        self.assertEqual(ev_ia[0].resultado, "promessa")
        self.assertEqual(ET.eventos_pos_atendimento(ev_ia, None, date(2026, 11, 4)), {"promessa"})

    def test_saidas_novas_validas(self):
        self.assertTrue({"promessa", "retorno_agendado", "cpc", "acordo", "pagamento", "fim_janela"}
                        <= set(ET.EVENTOS["cob"]))
        et, _ = _etapas()
        self.assertEqual(et[0].saidas, {"promessa": "sai", "retorno_agendado": "etapa:retorno", "acordo": "padrao"})


class TestDeduplicacao(unittest.TestCase):
    def test_mesma_chamada_ia_e_operador_vira_um_evento(self):
        # webhook da IA (cpc, identidade confirmada) + tabulação do operador depois da transferência (promessa)
        # chegam em arquivos diferentes com o mesmo id_chamada
        ia, _ = _ler([["C1", "03/11/2026", "CPC", SP, "120", "k7", "", "OK", "", "", "", "sim"]])
        op, _ = _ler([["C1", "03/11/2026", "CPC", SP, "", "k7", "PROMESSA", "OK", "05/11/2026", "200", "", ""]])
        ev, n = V.unificar_chamadas(ia + op + op)          # o arquivo do operador reimportado
        self.assertEqual(n, 2)
        self.assertEqual(len(ev), 1)
        e = ev[0]
        self.assertEqual((e.resultado, e.origem_resultado, e.data_promessa, e.valor_promessa, e.duracao_s,
                          e.identidade_confirmada, e.resultado_ia, e.resultado_operador),
                         ("promessa", "operador", date(2026, 11, 5), 200.0, 120, True, "cpc", "promessa"))
        self.assertEqual(ET.eventos_pos_atendimento(ev, None, date(2026, 11, 4)), {"promessa"})
        # sem id_chamada nada muda; canais diferentes não se fundem
        soltos = [Evento("C1", SP, "telefone", "agente_voz", "cpc", D0, fornecedor="f", id_externo=str(i))
                  for i in range(2)]
        self.assertEqual(V.unificar_chamadas(soltos), (soltos, 0))
        dois = [Evento("C1", SP, "telefone", c, "cpc", D0, fornecedor="f", id_externo=c, id_chamada="x")
                for c in ("agente_voz", "discador")]
        self.assertEqual(V.unificar_chamadas(dois)[1], 0)

    def test_evento_conta_uma_vez_por_rodada(self):
        ev, _ = _ler([["C1", "03/11/2026", "PROMESSA", SP, "80", "k1", "", "", "05/11/2026", "200", "", "sim"]])
        self.assertEqual(ET.eventos_pos_atendimento(ev, None, date(2026, 11, 4)), {"promessa"})
        self.assertEqual(ET.eventos_pos_atendimento(ev, "2026-11-03", date(2026, 11, 5)), set())   # já aplicado


class TestListaDoDia(unittest.TestCase):
    def test_promessa_da_ia_tira_da_etapa_na_lista(self):
        regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
        over, erros = validar_estrategia({"etapas": [TICKET, RETORNO]})
        self.assertEqual(erros, [])
        regua = carregar_regua().com_clusters(regras, {7: over}, None, {})
        est = {"C1": EstadoCliente("C1", D0, "DG", "DG", "2026-11", cluster_versao=regua.versao_clusters)}
        cli = {"C1": Cliente("C1", D0, 5000.0, 30)}
        certs = {("C1", SP): Certificacao("C1", SP, "telefone", "DESCONHECIDO", 0.4)}
        estado, motivos = {}, {}
        fila, _, _ = gerar_fila(est, cli, certs, {}, {}, D0, regua, [], None, motivos=motivos, etapas_estado=estado)
        self.assertEqual({l["regua"] for l in fila}, {"etapa-ticket-alto"})
        prom = Evento("C1", SP, "telefone", "agente_voz", "promessa", D0, fornecedor="ia", id_externo="p",
                      origem_resultado="ia", data_promessa=D0 + timedelta(days=3), valor_promessa=200.0)
        motivos = {}
        fila, _, _ = gerar_fila(est, cli, certs, {}, {}, D0 + timedelta(days=1), regua, [prom], None,
                                motivos=motivos, etapas_estado=estado)
        self.assertEqual((fila, motivos), ([], {"saiu_da_regua": 1}))
        self.assertEqual(estado["C1"]["eventos_ate"], D0.isoformat())


if __name__ == "__main__":
    unittest.main()
