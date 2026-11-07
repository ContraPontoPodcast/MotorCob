"""Recuperação por ação (SQL 77): atribuição do acordo, pagamento atrasado, idempotência e só agregado.

Só dados fictícios (IDs R…, números 1190…). Não lê supabase/ nem docs/ (roda também na imagem do motor).
"""
import json
import unittest
from datetime import date

from motor.acordos import Parcela
from motor.certificacao import Evento
from motor.recuperacao import (CHAVE, CHAVE_POSICAO, METRICAS, METRICAS_POSICAO, SEM_ACAO, agregar, totais,
                               volta_dia)
from motor.regua import carregar_regua

D = date.fromisoformat


def esc(d, idc, canal, contato="", ordem=1, reserva=0, regua="localizacao", cluster="A1", persona="Digital",
        passo="D+1"):
    return {"data": d, "id_cliente": idc, "canal": canal, "contato": contato, "ordem_contato": str(ordem),
            "reserva": str(reserva), "regua": regua, "cluster": cluster, "persona": persona, "passo": passo}


def ev(idc, canal, resultado, d, custo=0.0, contato="", **kw):
    return Evento(idc, contato, "telefone", canal, resultado, D(d), custo, fornecedor="ocorrencia:x", **kw)


def tr(idc, d, tag, antes=""):
    return {"id_cliente": idc, "data": d, "tag": tag, "tag_anterior": antes}


def parc(idc, ida, n, venc, valor, pago=None):
    return Parcela(idc, ida, n, D(venc), valor, D(pago) if pago else None)


def montar(escolhas):
    por = {}
    for l in escolhas:
        por.setdefault((l["data"], l["id_cliente"]), []).append(l)
    return por


class TestVoltaDia(unittest.TestCase):
    def test_passos(self):
        self.assertEqual(volta_dia("G2-dia3"), (2, 3))
        self.assertEqual(volta_dia("C3-D5"), (3, 5))
        self.assertEqual(volta_dia("C1-D-2"), (1, -2))
        self.assertEqual(volta_dia("D+4"), (0, 4))
        self.assertEqual(volta_dia("D-3"), (0, -3))
        self.assertEqual(volta_dia("D0"), (0, 0))
        self.assertEqual(volta_dia("CPC B · T2"), (0, 2))
        self.assertEqual(volta_dia("CPC A · negociação"), (0, None))
        self.assertEqual(volta_dia("rotação → sms"), (0, None))
        self.assertEqual(volta_dia(""), (0, None))
        self.assertEqual(volta_dia(None), (0, None))


class TestRecuperacao(unittest.TestCase):
    HOJE = D("2026-10-25")

    def setUp(self):
        self.regua = carregar_regua()
        self.escolhas = montar([
            # A: WhatsApp com CPC no dia 1, discador sem contato no dia 2, acordo no dia 3 → é do WhatsApp
            esc("2026-10-01", "RA", "whatsapp", "11900000001"),
            esc("2026-10-02", "RA", "discador", "11900000001", passo="D+2", persona="Voz"),
            # B: SMS no dia 1, acordo só no dia 20 (fora dos 7 dias) → sem ação
            esc("2026-10-01", "RB", "sms", "11900000002", cluster="B2"),
            # D: giro, volta 2 dia 3, promessa no discador
            esc("2026-10-05", "RD", "discador", "11900000004", regua="giro", passo="G2-dia3", persona="Voz"),
            # E: SMS com opt-out
            esc("2026-10-05", "RE", "sms", "11900000005", regua="cpc", passo="CPC B · T2", cluster="M1"),
            # reserva sem retorno: não é ação
            esc("2026-10-05", "RE", "discador", "11900000005", reserva=1, regua="cpc", passo="CPC B · T2",
                cluster="M1"),
            # F: dois números no discador em dias de lista seguidos (posição e dias seguidos)
            esc("2026-10-01", "RF", "discador", "11900000061", 1, persona="Voz"),
            esc("2026-10-01", "RF", "discador", "11900000062", 2, persona="Voz"),
            esc("2026-10-02", "RF", "discador", "11900000061", 1, passo="D+2", persona="Voz"),
            esc("2026-10-02", "RF", "discador", "11900000062", 2, passo="D+2", persona="Voz"),
            # G: dois toques no mesmo dia sem CPC; a trilha marcou o discador na entrada em acordo
            esc("2026-10-10", "RG", "sms", "11900000007", regua="cpc", passo="CPC B · T1"),
            esc("2026-10-10", "RG", "discador", "11900000007", regua="cpc", passo="CPC B · T1", persona="Voz"),
        ])
        self.eventos = [
            ev("RA", "whatsapp", "resposta", "2026-10-01", 0.05, "11900000001"),
            ev("RA", "discador", "nao_atendida", "2026-10-02", 0.10, "11900000001"),
            ev("RD", "discador", "promessa", "2026-10-05", 0.30, "11900000004", data_promessa=D("2026-10-12")),
            ev("RE", "sms", "opt_out", "2026-10-06", 0.02, "11900000005"),
            ev("RF", "discador", "nao_atendida", "2026-10-01", 0.10, "11900000061"),
            ev("RF", "discador", "atendida_terceiro_desconhece", "2026-10-01", 0.10, "11900000062"),
            ev("RF", "discador", "cpc", "2026-10-02", 0.10, "11900000062"),
            ev("RG", "sms", "entregue", "2026-10-10", 0.02, "11900000007"),
            ev("RG", "discador", "nao_atendida", "2026-10-10", 0.10, "11900000007"),
        ]
        self.trilha = [
            tr("RA", "2026-09-30", "S260930-A1-LOC-ND-L0"),
            tr("RA", "2026-10-01", "S260930-A1-CPA-WA-T0", "S260930-A1-LOC-ND-L0"),
            tr("RA", "2026-10-03", "S260930-A1-PRE-WA-D3", "S260930-A1-CPA-WA-T0"),
            tr("RB", "2026-09-30", "S260930-B2-LOC-ND-L0"),
            tr("RB", "2026-10-20", "S260930-B2-PRE-SM-D3", "S260930-B2-LOC-ND-L5"),
            # C: entrou já em acordo (não nasceu de ação)
            tr("RC", "2026-09-30", "S260930-A1-COL-ND-L0"),
            tr("RG", "2026-09-30", "S260930-A1-LOC-ND-L0"),
            tr("RG", "2026-10-10", "S260930-A1-PRE-DC-D3", "S260930-A1-CPB-DC-T1"),
        ]
        self.parcelas = {
            "RA": [parc("RA", "AC-A", 1, "2026-10-10", 500.0, "2026-10-10"),
                   parc("RA", "AC-A", 2, "2026-11-10", 500.0)],
            "RB": [parc("RB", "AC-B", 1, "2026-10-23", 300.0, "2026-10-23")],
            "RC": [parc("RC", "AC-C", 1, "2026-10-15", 200.0, "2026-10-15")],
            "RG": [parc("RG", "AC-G", 1, "2026-10-13", 150.0)],
        }
        self.custos = {"sms": 0.02, "whatsapp": 0.05, "discador": 0.10}

    def rodar(self, hoje=None, parcelas=None, **kw):
        return agregar(self.escolhas, self.eventos, parcelas or self.parcelas, self.trilha, self.regua,
                       hoje or self.HOJE, self.custos, cluster_de={"RB": "B2", "RC": "A1"}, **kw)

    @staticmethod
    def _por(linhas, **f):
        return [l for l in linhas if all(l[k] == v for k, v in f.items())]

    def test_acordo_vai_para_o_ultimo_toque_com_cpc(self):
        r = self.rodar()
        wa = self._por(r["linhas"], data="2026-10-01", canal="whatsapp")[0]
        self.assertEqual((wa["acordos"], wa["valor_acordo"], wa["pagamentos"], wa["valor_pago"]), (1, 1000.0, 1, 500.0))
        self.assertEqual((wa["regua"], wa["cluster"], wa["persona"], wa["volta"], wa["dia_ciclo"]),
                         ("localizacao", "A1", "Digital", 0, 1))
        disc = self._por(r["linhas"], data="2026-10-02", canal="discador", persona="Voz")
        self.assertEqual(sum(l["acordos"] for l in disc), 0)   # o toque mais recente sem CPC não leva

    def test_sem_toque_na_janela_e_acordo_preexistente_vao_para_sem_acao(self):
        r = self.rodar()
        sem = {l["data"]: l for l in self._por(r["linhas"], regua=SEM_ACAO)}
        self.assertEqual(sem["2026-10-20"]["acordos"], 1)       # B: SMS 19 dias antes
        self.assertEqual(sem["2026-10-20"]["cluster"], "B2")
        self.assertEqual(sem["2026-10-20"]["canal"], "")
        self.assertEqual(sem["2026-10-08"]["valor_pago"], 200.0)  # C: 1º vencimento − 7
        self.assertEqual(sem["2026-10-08"]["acoes"], 0)

    def test_empate_no_dia_fica_com_o_canal_da_trilha(self):
        r = self.rodar()
        g = self._por(r["linhas"], data="2026-10-10")
        self.assertEqual([l["canal"] for l in g if l["acordos"]], ["discador"])
        self.assertEqual(self._por(g, canal="discador")[0]["pagamentos"], 0)

    def test_funil_promessa_optout_volta_custo(self):
        r = self.rodar()
        gi = self._por(r["linhas"], regua="giro")[0]
        self.assertEqual((gi["volta"], gi["dia_ciclo"], gi["promessas"], gi["cpcs"], gi["contatos"]), (2, 3, 1, 1, 1))
        self.assertEqual(gi["custo"], 0.3)
        sms_e = self._por(r["linhas"], data="2026-10-05", canal="sms")[0]
        self.assertEqual((sms_e["optouts"], sms_e["dia_ciclo"], sms_e["cpcs"]), (1, 2, 0))
        # reserva sem retorno não é ação
        self.assertEqual(self._por(r["linhas"], data="2026-10-05", canal="discador", regua="cpc"), [])
        # ação sem retorno usa o custo do canal
        b = self._por(r["linhas"], data="2026-10-01", canal="sms")[0]
        self.assertEqual((b["acoes"], b["com_retorno"], b["custo"]), (1, 0, 0.02))

    def test_totais_batem_com_as_parcelas(self):
        r = self.rodar()
        t = totais(r["linhas"])
        todas = [p for ps in self.parcelas.values() for p in ps]
        self.assertEqual(t["acordos"], len({p.id_acordo for p in todas}))
        self.assertAlmostEqual(t["valor_acordo"], sum(p.valor for p in todas))
        self.assertAlmostEqual(t["valor_pago"], sum(p.valor for p in todas if p.pago_em and p.pago_em <= self.HOJE))
        self.assertEqual(t, r["totais"])
        acoes_enviadas = sum(1 for ls in self.escolhas.values() for l in {(x["canal"]): x for x in ls}.values()
                             if l["reserva"] != "1")
        self.assertEqual(t["acoes"], acoes_enviadas)

    def test_pagamento_atrasado_atualiza_o_dia_da_acao_e_e_idempotente(self):
        antes = self.rodar()
        pagas = {**self.parcelas, "RA": [parc("RA", "AC-A", 1, "2026-10-10", 500.0, "2026-10-10"),
                                         parc("RA", "AC-A", 2, "2026-11-10", 500.0, "2026-11-12")]}
        depois = self.rodar(hoje=D("2026-11-13"), parcelas=pagas)
        wa = self._por(depois["linhas"], data="2026-10-01", canal="whatsapp")[0]
        self.assertEqual((wa["pagamentos"], wa["valor_pago"]), (1, 1000.0))
        self.assertEqual(depois["desde"], "2026-05-17")          # 180 dias: a janela regravada
        # o pagamento de amanhã não entra antes da hora (pago depois de hoje)
        self.assertEqual(self._por(self.rodar(parcelas=pagas)["linhas"], data="2026-10-01",
                                   canal="whatsapp")[0]["valor_pago"], 500.0)
        # rodar de novo dá o mesmo resultado (byte a byte)
        self.assertEqual(json.dumps(depois, sort_keys=True),
                         json.dumps(self.rodar(hoje=D("2026-11-13"), parcelas=pagas), sort_keys=True))
        self.assertNotEqual(antes["totais"]["valor_pago"], depois["totais"]["valor_pago"])

    def test_acao_antes_da_janela_nao_e_regravada(self):
        r = self.rodar(desde=D("2026-10-02"))
        self.assertEqual(self._por(r["linhas"], data="2026-10-01"), [])
        self.assertEqual(sum(l["acordos"] for l in r["linhas"] if l["canal"] == "whatsapp"), 0)  # A ficou no publicado
        self.assertEqual(r["desde"], "2026-10-02")

    def test_contato_por_posicao_e_dias_seguidos(self):
        pos = {(p["data"], p["canal"], p["posicao"], p["dias_seguidos"]): p for p in self.rodar()["posicao"]}
        p1 = pos[("2026-10-01", "discador", 1, 1)]   # RF nº 1, não atendida
        self.assertEqual(p1["curtas"], 1)
        p2 = pos[("2026-10-01", "discador", 2, 1)]
        self.assertEqual((p2["tentativas"], p2["terceiros"], p2["contatos"], p2["cpcs"]), (1, 1, 1, 0))
        p2b = pos[("2026-10-02", "discador", 2, 2)]   # mesmo número no 2º dia de lista seguido
        self.assertEqual((p2b["tentativas"], p2b["cpcs"]), (1, 1))
        self.assertEqual(pos[("2026-10-05", "discador", 1, 1)]["tentativas"], 1)   # só RD: a reserva de RE não foi

    def test_sem_dado_pessoal_na_saida(self):
        r = self.rodar()
        self.assertTrue(all(set(l) == set(CHAVE) | set(METRICAS) for l in r["linhas"]))
        self.assertTrue(all(set(p) == set(CHAVE_POSICAO) | set(METRICAS_POSICAO) for p in r["posicao"]))
        texto = json.dumps(r)
        for segredo in ("RA", "RB", "RC", "RF", "1190000", "AC-A"):
            self.assertNotIn(f'"{segredo}', texto)
            self.assertNotIn(segredo, json.dumps([list(l.values()) for l in r["linhas"] + r["posicao"]]))

    def test_sem_parcelas_nem_eventos(self):
        r = agregar({}, [], {}, [], self.regua, self.HOJE)
        self.assertEqual((r["linhas"], r["posicao"]), ([], []))
        self.assertEqual(r["totais"]["acoes"], 0)


class TestAcordosVistos(unittest.TestCase):
    """Data do acordo = rotina que o viu pela 1ª vez (estado/acordos_vistos.csv); o que já existia é 'legado'."""

    def setUp(self):
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.pasta = self._tmp.name
        self.regua = carregar_regua()

    def tearDown(self):
        self._tmp.cleanup()

    def test_primeira_rodada_e_legado_depois_rotina_e_idempotente(self):
        from pathlib import Path
        from motor.recuperacao import registrar_acordos
        antigo = {"RA": [parc("RA", "AC-A", 1, "2026-10-10", 100.0)], "RZ": [parc("RZ", "AC-Z", 1, "2026-10-08", 9.0)]}
        v = registrar_acordos(self.pasta, antigo, D("2026-10-02"), [], self.regua)
        self.assertEqual(v[("RA", "AC-A")], (D("2026-10-02"), "legado"))   # 1º vencimento − 7, nunca depois de hoje
        self.assertEqual(v[("RZ", "AC-Z")], (D("2026-10-01"), "legado"))   # sem trilha: 1º vencimento − 7
        novo = {**antigo, "RB": [parc("RB", "AC-B", 1, "2026-10-20", 50.0)]}
        v = registrar_acordos(self.pasta, novo, D("2026-10-05"), [], self.regua)
        self.assertEqual(v[("RB", "AC-B")], (D("2026-10-05"), "rotina"))
        self.assertEqual(v[("RA", "AC-A")], (D("2026-10-02"), "legado"))
        arq = Path(self.pasta) / "acordos_vistos.csv"
        antes = arq.read_text()
        v2 = registrar_acordos(self.pasta, novo, D("2026-10-09"), [], self.regua)   # outro dia: não muda a data
        self.assertEqual((v2, arq.read_text()), (v, antes))

    def test_acordo_visto_na_rotina_vai_para_a_acao_da_vespera_e_nao_para_a_lista_do_dia(self):
        esc_ = montar([esc("2026-10-02", "RA", "whatsapp", "11900000001"),
                       esc("2026-10-03", "RA", "sms", "11900000001", regua="preventivo", passo="D-3")])
        evs = [ev("RA", "whatsapp", "resposta", "2026-10-02", 0.05, "11900000001")]
        # a trilha marca o acordo no último dia fechado (01/10, o dia de entrada): a regra antiga diria "já existia"
        trilha = [tr("RA", "2026-10-01", "S261001-B2-LOC-ND-L0"),
                  tr("RA", "2026-10-01", "S261001-B2-COL-ND", "S261001-B2-LOC-ND-L0")]
        parcelas = {"RA": [parc("RA", "AC-A", 1, "2026-10-08", 300.0, "2026-10-08")]}
        vistos = {("RA", "AC-A"): (D("2026-10-03"), "rotina")}
        r = agregar(esc_, evs, parcelas, trilha, self.regua, D("2026-10-09"), vistos=vistos)
        wa = [l for l in r["linhas"] if l["canal"] == "whatsapp"][0]
        self.assertEqual((wa["data"], wa["acordos"], wa["valor_pago"]), ("2026-10-02", 1, 300.0))
        self.assertEqual(sum(l["acordos"] for l in r["linhas"] if l["canal"] == "sms"), 0)
        sem = agregar(esc_, evs, parcelas, trilha, self.regua, D("2026-10-09"))   # sem o controle: legado
        self.assertEqual([l["regua"] for l in sem["linhas"] if l["acordos"]], [SEM_ACAO])

    def test_acordo_que_veio_na_carga_antes_de_qualquer_acao_e_sem_acao(self):
        parcelas = {"RA": [parc("RA", "AC-A", 1, "2026-10-08", 300.0)]}
        vistos = {("RA", "AC-A"): (D("2026-10-02"), "rotina")}
        esc_ = montar([esc("2026-10-02", "RA", "sms", "11900000001", regua="preventivo", passo="D-6")])
        r = agregar(esc_, [], parcelas, [], self.regua, D("2026-10-05"), vistos=vistos)
        self.assertEqual([(l["regua"], l["data"]) for l in r["linhas"] if l["acordos"]], [(SEM_ACAO, "2026-10-02")])


class SbFalso:
    def __init__(self, sem_tabela=False):
        self.sem_tabela, self.apagados, self.inseridos = sem_tabela, [], []

    def apagar(self, tabela, filtros):
        if self.sem_tabela:
            from nuvem.supabase_api import ErroSupabase
            raise ErroSupabase(404, f'relation "public.{tabela}" does not exist', f"/rest/v1/{tabela}")
        self.apagados.append((tabela, filtros))

    def inserir(self, tabela, linhas, **kw):
        self.inseridos.append((tabela, linhas))


class TestPublicar(unittest.TestCase):
    def setUp(self):
        t = TestRecuperacao("test_sem_parcelas_nem_eventos")
        t.setUp()
        self.r = {"recuperacao": t.rodar(), "alertas": []}

    def test_regrava_a_janela_e_apaga_o_que_passou_da_retencao(self):
        from nuvem.sincronizar import publicar_recuperacao
        sb = SbFalso()
        n = publicar_recuperacao(sb, 7, self.r, 3, D("2026-10-25"))
        self.assertEqual(n, len(self.r["recuperacao"]["linhas"]))
        self.assertIn(("recuperacao_dia", {"empresa_id": "eq.7", "credor_id": "eq.3", "data": "gte.2026-04-28"}),
                      sb.apagados)
        self.assertIn(("contato_posicao_dia", {"empresa_id": "eq.7", "credor_id": "eq.3", "data": "lt.2024-09-25"}),
                      sb.apagados)
        tab = dict(sb.inseridos)
        self.assertTrue(all(l["empresa_id"] == 7 and l["credor_id"] == 3 for l in tab["recuperacao_dia"]))
        self.assertEqual(len(tab["contato_posicao_dia"]), len(self.r["recuperacao"]["posicao"]))
        self.assertFalse({"id_cliente", "contato"} & set(tab["recuperacao_dia"][0]))

    def test_banco_sem_sql77_avisa_e_segue(self):
        from nuvem.sincronizar import ALERTA_SQL77, publicar_recuperacao
        self.assertEqual(publicar_recuperacao(SbFalso(sem_tabela=True), 7, self.r, 3, D("2026-10-25")), 0)
        self.assertEqual(self.r["alertas"], [ALERTA_SQL77])

    def test_sem_recuperacao_nao_publica(self):
        from nuvem.sincronizar import publicar_recuperacao
        sb = SbFalso()
        self.assertEqual(publicar_recuperacao(sb, 7, {"recuperacao": None}, 3), 0)
        self.assertEqual(sb.apagados, [])


if __name__ == "__main__":
    unittest.main()
