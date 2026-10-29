"""Propensão a pagamento (motor/propensao.py): população, alvo, vazamento, encolhimento, faixas e rotina.

Tudo com IDs fictícios (P1, Q1…); nenhum dado pessoal.
"""
import json
import random
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from motor import propensao as PR
from motor.acordos import Parcela
from motor.certificacao import Certificacao
from motor.cluster import carregar_regras
from motor.estrategia import validar_estrategia
from motor.fila import gerar_fila
from motor.marcacao import Cliente, EstadoCliente
from motor.regua import carregar_regua

HOJE = date(2026, 10, 29)           # quinta
SEG = date(2026, 8, 3)              # uma segunda-feira com alvo fechado


def _ev(idc, d, estado):
    return {"data": d.isoformat(), "id_cliente": idc, "tag": f"S260101-A1-{estado}-WA-T1"}


def _pg(idc, d, pagou=True, tipo="parcela", valor=100.0):
    return {"id_cliente": idc, "data": d, "valor": valor, "tipo": tipo, "pagou": pagou}


def _cli(idc, saldo=1000.0, atraso=100, entrada=date(2026, 1, 1)):
    return Cliente(idc, entrada, saldo, atraso)


def _est(idc, estado):
    e = EstadoCliente(idc, date(2026, 1, 1), "A1", "A1", "2026-01")
    e.estado = estado
    return e


class TestFotos(unittest.TestCase):
    def test_datas_das_fotos_sao_segundas_com_alvo_fechado(self):
        ds = PR.datas_das_fotos(HOJE)
        self.assertTrue(ds and all(d.weekday() == 0 for d in ds))
        self.assertGreaterEqual(ds[0], HOJE - timedelta(days=180))
        self.assertLessEqual(ds[-1], HOJE - timedelta(days=30))          # D > hoje−30 fica fora do treino

    def test_populacao_so_estados_de_cobranca_no_dia_da_foto(self):
        cli = {k: _cli(k) for k in ("LOC1", "CPA1", "QBR1", "COL1", "PRE1", "LIQ1", "BLQ1", "NOVO")}
        tr = [_ev(k, date(2026, 7, 1), k[:3]) for k in cli if k != "NOVO"]
        tr.append(_ev("NOVO", SEG, "LOC"))          # entrou no próprio D: no começo de D ainda não estava
        fts = PR.fotos(cli, tr, [], [SEG])
        self.assertEqual(sorted(f["id_cliente"] for f in fts), ["CPA1", "LOC1", "QBR1"])
        # estado como era no começo de D: mudou para CPA em D → a foto de D ainda é LOC
        fts = PR.fotos({"X": _cli("X")}, [_ev("X", date(2026, 7, 1), "LOC"), _ev("X", SEG, "CPA")], [], [SEG])
        self.assertEqual(fts[0]["estado"], "LOC")

    def test_alvo_pagou_em_ate_30_dias_depois_de_d(self):
        cli = {k: _cli(k) for k in "ABCDE"}
        tr = [_ev(k, date(2026, 7, 1), "CPA") for k in cli]
        pg = [_pg("A", SEG + timedelta(days=1)),            # dia seguinte: conta
              _pg("B", SEG + timedelta(days=30)),           # D+30: conta
              _pg("C", SEG + timedelta(days=31)),           # D+31: não
              _pg("D", SEG),                                # no próprio D: não (já tinha acontecido)
              _pg("E", SEG - timedelta(days=5))]            # antes de D: não
        alvo = {f["id_cliente"]: f["alvo"] for f in PR.fotos(cli, tr, pg, [SEG])}
        self.assertEqual(alvo, {"A": True, "B": True, "C": False, "D": False, "E": False})

    def test_quitacao_e_primeira_parcela_contam_promessa_e_parcial_nao(self):
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "pagamentos.csv"
            arq.write_text(
                "id_cliente;id_contrato;data;valor;tipo;id_acordo;parcela;pagou;arquivo\n"
                f"Q;;{SEG + timedelta(days=3)};900.00;quitacao;;;1;b.csv\n"
                f"P1;;{SEG + timedelta(days=3)};100.00;parcela;AC1;1;1;b.csv\n"
                f"P2;;{SEG + timedelta(days=3)};100.00;parcela;AC2;2;0;b.csv\n"      # 2ª parcela: não
                f"PA;;{SEG + timedelta(days=3)};50.00;parcial;;;0;b.csv\n"           # parcial: não
                f"PP;;{SEG + timedelta(days=3)};60.00;parcela;AC3;1;0;b.csv\n", encoding="utf-8")   # 1ª incompleta
            pg = PR.carregar_pagamentos(arq)
        cli = {k: _cli(k) for k in ("Q", "P1", "P2", "PA", "PP", "SO_ACORDO")}
        tr = [_ev(k, date(2026, 7, 1), "CPA") for k in cli]
        alvo = {f["id_cliente"]: f["alvo"] for f in PR.fotos(cli, tr, pg, [SEG])}
        self.assertEqual(alvo, {"Q": True, "P1": True, "P2": False, "PA": False, "PP": False, "SO_ACORDO": False})

    def test_sem_pagamentos_csv_sai_das_parcelas(self):
        d = SEG + timedelta(days=5)
        parc = {"A": [Parcela("A", "AC", 1, d, 100.0, d), Parcela("A", "AC", 2, d + timedelta(days=30), 100.0)],
                "B": [Parcela("B", "AC", 1, d, 100.0), Parcela("B", "AC", 2, d, 100.0, d)],   # 1ª em aberto
                "C": [Parcela("C", "AC", 1, d, 100.0)]}                                      # acordo = promessa
        pg = PR.carregar_pagamentos(None, parc)
        self.assertEqual([(p["id_cliente"], p["data"], p["pagou"]) for p in pg], [("A", d, True)])

    def test_saldo_em_d_reconstruido_sem_vazamento(self):
        # hoje o saldo é 0 porque quitou depois de D: na foto de D o saldo era 1000
        cli = {"Q": _cli("Q", saldo=0.0), "P": _cli("P", saldo=500.0)}
        tr = [_ev("Q", date(2026, 7, 1), "CPA"), _ev("P", date(2026, 7, 1), "CPA")]
        pg = [_pg("Q", SEG + timedelta(days=4), tipo="quitacao", valor=1000.0),
              _pg("P", SEG - timedelta(days=4), pagou=False, tipo="parcial", valor=300.0),   # antes de D: já abatido
              _pg("P", SEG + timedelta(days=4), pagou=False, tipo="parcial", valor=200.0),
              _pg("P", SEG + timedelta(days=6), tipo="parcela", valor=999.0)]               # parcela não abate o estoque
        f = {f["id_cliente"]: f for f in PR.fotos(cli, tr, pg, [SEG])}
        self.assertEqual((f["Q"]["saldo"], f["P"]["saldo"]), (1000.0, 700.0))
        self.assertEqual(f["Q"]["atraso"], cli["Q"].atraso_em(SEG))


class TestModelo(unittest.TestCase):
    def fts(self, n_cpc=100, pagam_cpc=30, n_giro=100, pagam_giro=2):
        f = [{"id_cliente": f"C{i}", "data": SEG, "estado": "CPA", "atraso": 50, "saldo": 1000.0,
              "alvo": i < pagam_cpc, "pagamento": SEG if i < pagam_cpc else None} for i in range(n_cpc)]
        f += [{"id_cliente": f"G{i}", "data": SEG, "estado": "NCP", "atraso": 400, "saldo": 1000.0,
               "alvo": i < pagam_giro, "pagamento": SEG if i < pagam_giro else None} for i in range(n_giro)]
        return f

    def test_encolhimento_celula_situacao_carteira(self):
        fts = self.fts() + [{"id_cliente": "R", "data": SEG, "estado": "CPA", "atraso": 10, "saldo": 1000.0,
                             "alvo": True, "pagamento": SEG}]     # célula com 1 foto e 100% de pagamento
        m = PR.treinar(fts, HOJE)
        cart = 33 / 201
        sit = m["situacao"]["cpc"]["taxa"]
        self.assertAlmostEqual(sit, (31 + PR.FORCA * cart) / (101 + PR.FORCA), places=5)
        rara = PR.taxa(m, ("cpc", "0_30", "saldo_baixo"))
        self.assertTrue(sit < rara < 0.05 + sit)          # 1 foto não leva a 100%: fica perto da situação
        sem_forca = PR.treinar(fts, HOJE, forca=0.0)
        self.assertEqual(PR.taxa(sem_forca, ("cpc", "0_30", "saldo_baixo")), 1.0)
        # célula e situação nunca vistas: cai para a situação e para a carteira
        self.assertEqual(PR.taxa(m, ("cpc", "181_360", "saldo_baixo")), sit)
        self.assertAlmostEqual(PR.taxa(m, ("quebra", "0_30", "saldo_baixo")), cart, places=5)

    def test_faixas_pelos_quintis_e_evidencia(self):
        m = PR.treinar(self.fts(), HOJE)
        self.assertEqual(m["evidencia"], "previa")                  # 32 pagamentos
        self.assertEqual(set(m["cortes"]), set("ABCD"))
        alta, baixa = PR.taxa(m, ("cpc", "31_90", "saldo_baixo")), PR.taxa(m, ("giro", "361_mais", "saldo_baixo"))
        # duas células do mesmo tamanho: empate no corte sobe (a de baixo fica na C, a de cima na A)
        self.assertEqual((PR.faixa_de(m, round(alta, 4)), PR.faixa_de(m, round(baixa, 4))), ("A", "C"))
        self.assertEqual(PR.faixa_de(m, 0.0), "E")
        self.assertGreater(m["realizado_por_faixa"]["A"]["taxa"], m["realizado_por_faixa"]["C"]["taxa"])
        self.assertEqual(PR.treinar(self.fts(pagam_cpc=20, pagam_giro=0), HOJE)["evidencia"], "coletando")
        self.assertEqual(PR.treinar(self.fts(n_cpc=300, pagam_cpc=200), HOJE)["evidencia"], "definida")
        self.assertIsNone(PR.treinar([], HOJE)["cortes"])

    def test_coletando_calcula_p_mas_nao_da_faixa(self):
        m = PR.treinar(self.fts(pagam_cpc=10, pagam_giro=0), HOJE)
        s = PR.aplicar(m, {"C": _cli("C", atraso=50)}, {"C": _est("C", "CPA")}, HOJE)
        self.assertEqual(s["C"]["faixa"], "")
        self.assertGreater(s["C"]["p"], 0)

    def test_aplicacao_so_quem_esta_ativo_e_motivos_em_codigo(self):
        m = PR.treinar(self.fts(), HOJE)
        cli = {k: _cli(k, saldo=1000.0, entrada=HOJE - timedelta(days=10), atraso=40) for k in ("A", "B", "C", "D")}
        est = {"A": _est("A", "CPB"), "B": _est("B", "COL"), "C": _est("C", "LIQ"), "D": _est("D", "LOC")}
        s = PR.aplicar(m, cli, est, HOJE, ativos={"A", "B", "C"})
        self.assertEqual(list(s), ["A"])                            # COL/LIQ fora; D fora da carga
        self.assertEqual(s["A"]["motivos"], ["atraso_31_90", "saldo_baixo", "situacao_cpc"])
        self.assertEqual(s["A"]["faixa"], "A")

    def test_agregado_por_persona(self):
        cli = {"A": _cli("A", saldo=1000.0), "B": _cli("B", saldo=3000.0), "C": _cli("C", saldo=50.0)}
        sc = {"A": {"p": 0.2, "faixa": "A"}, "B": {"p": 0.1, "faixa": "B"}, "C": {"p": 0.5, "faixa": "A"}}
        ag = PR.agregar(sc, cli, {"A": "Digital", "B": "Digital", "C": None}.get)
        self.assertEqual(ag, {"Digital": {"clientes": 2, "saldo": 4000.0, "p_media": 0.15, "pagamentos_esperados": 0.3,
                                          "valor_esperado": 500.0, "faixas": {"A": 1, "B": 1}}})


def _carteira_simulada(n=300, semente=7):
    """Metade paga ~10 dias depois de virar CPA (e vai a LIQ); a outra metade vai para NCP e não paga."""
    rnd = random.Random(semente)
    inicio = HOJE - timedelta(days=200)
    cli, tr, pg = {}, [], []
    for i in range(n):
        idc = f"S{i}"
        cli[idc] = _cli(idc, saldo=rnd.choice([300.0, 1500.0, 8000.0]), atraso=rnd.randint(20, 400), entrada=inicio)
        tr.append(_ev(idc, inicio, "LOC"))
        virada = inicio + timedelta(days=rnd.randint(10, 150))
        if i % 2:
            tr.append(_ev(idc, virada, "CPA"))
            pago = virada + timedelta(days=rnd.randint(5, 15))
            pg.append(_pg(idc, pago, tipo="quitacao", valor=cli[idc].saldo))
            tr.append(_ev(idc, pago + timedelta(days=1), "LIQ"))
        else:
            tr.append(_ev(idc, virada, "NCP"))
    return cli, tr, pg


class TestEmbaralhar(unittest.TestCase):
    def separacao(self, cli, tr, pg):
        m = PR.treinar(PR.fotos(cli, tr, pg, PR.datas_das_fotos(HOJE)), HOJE)
        r = m["realizado_por_faixa"]
        return r["A"]["taxa"] - r[max(r)]["taxa"]

    def test_embaralhar_as_datas_de_pagamento_derruba_a_separacao(self):
        cli, tr, pg = _carteira_simulada()
        real = self.separacao(cli, tr, pg)
        rnd = random.Random(1)
        datas = [HOJE - timedelta(days=rnd.randint(1, 200)) for _ in pg]
        falso = [{**p, "data": d} for p, d in zip(pg, datas)]
        embaralhado = self.separacao(cli, tr, falso)
        self.assertGreater(real, 0.3)
        self.assertLess(embaralhado, real / 2)


class TestRotina(unittest.TestCase):
    def test_treino_semanal_cortes_congelados_e_idempotente(self):
        cli, tr, pg = _carteira_simulada()
        est = {k: _est(k, "CPA" if i % 3 else "NCP") for i, k in enumerate(cli)}
        with tempfile.TemporaryDirectory() as tmp:
            r1 = PR.calcular(cli, est, HOJE, tmp, pg, trilha=tr)
            m1 = (Path(tmp) / PR.ARQ_MODELO).read_text(encoding="utf-8")
            r2 = PR.calcular(cli, est, HOJE, tmp, pg, trilha=tr)          # 2ª rodada no mesmo dia
            self.assertTrue(r1["treinou"])
            self.assertFalse(r2["treinou"])
            self.assertEqual(r1["clientes"], r2["clientes"])
            self.assertEqual((Path(tmp) / PR.ARQ_MODELO).read_text(encoding="utf-8"), m1)
            self.assertEqual(r1["resumo"]["evidencia"], "previa")
            self.assertTrue(all(s["faixa"] in "ABCDE" and s["faixa"] for s in r1["clientes"].values()))
            # sexta: base nova (mais pagamentos) não muda o modelo nem os cortes até o domingo
            sexta, domingo = HOJE + timedelta(days=1), HOJE + timedelta(days=3)
            mais = pg + [_pg(k, HOJE - timedelta(days=40)) for k in list(cli)[:40]]
            r3 = PR.calcular(cli, est, sexta, tmp, mais, trilha=tr)
            self.assertFalse(r3["treinou"])
            self.assertEqual(r3["modelo"]["cortes"], r1["modelo"]["cortes"])
            r4 = PR.calcular(cli, est, domingo, tmp, mais, trilha=tr)
            self.assertTrue(r4["treinou"])
            self.assertEqual(r4["modelo"]["versao"], f"p1-{domingo.isoformat()}")
            gravado = json.loads((Path(tmp) / PR.ARQ_CLIENTES).read_text(encoding="utf-8"))
            self.assertEqual(gravado["versao"], r4["modelo"]["versao"])
        self.assertTrue(PR.precisa_treinar(None, HOJE))
        self.assertTrue(PR.precisa_treinar(r1["modelo"], HOJE - timedelta(days=1)))   # dia passado: retreina
        self.assertTrue(PR.precisa_treinar(r1["modelo"], HOJE + timedelta(days=7)))
        self.assertFalse(PR.precisa_treinar(r1["modelo"], HOJE + timedelta(days=2)))  # sábado


class TestCondicaoDaEtapa(unittest.TestCase):
    def fila(self, faixa):
        d0, tel = date(2026, 9, 1), "11988880001"
        etapa = {"id": "alta", "nome": "Propensão alta", "condicoes": [{"campo": "propensao", "op": "em",
                                                                        "valor": ["A", "B"]}],
                 "referencia": {"tipo": "entrada"}, "de": 0, "ate": 10,
                 "passos": {"0": [{"canal": "sms", "modo": "sempre"}]}}
        regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
        over, erros = validar_estrategia({"etapas": [etapa]})
        self.assertEqual(erros, [])
        regua = carregar_regua().com_clusters(regras, {7: over}, None, {})
        est = {"C1": EstadoCliente("C1", d0, "DG", "DG", "2026-09", cluster_versao=regua.versao_clusters)}
        cli = {"C1": Cliente("C1", d0, 2000.0, 30)}
        certs = {("C1", tel): Certificacao("C1", tel, "telefone", "DESCONHECIDO", 0.4)}
        fila, _, _ = gerar_fila(est, cli, certs, {}, {}, d0, regua, [], None, etapas_estado={},
                                propensao={"C1": faixa} if faixa is not None else None)
        return {l["regua"] for l in fila}

    def test_campo_propensao_na_condicao_da_etapa(self):
        self.assertEqual(self.fila("A"), {"etapa-alta"})
        self.assertEqual(self.fila("B"), {"etapa-alta"})
        self.assertNotIn("etapa-alta", self.fila("D"))
        self.assertNotIn("etapa-alta", self.fila(""))          # Coletando: sem faixa
        self.assertNotIn("etapa-alta", self.fila(None))        # sem propensão calculada


class TestRodarDia(unittest.TestCase):
    def test_rotina_calcula_publica_e_nao_muda_a_lista(self):
        import rodar_dia
        raiz = Path(__file__).resolve().parent.parent
        ex = raiz / "exemplos"
        with tempfile.TemporaryDirectory() as tmp:
            def rodar():
                return rodar_dia.rodar_dia(ex / "clientes.csv", ex / "carteira_contatos.csv", ex / "retornos",
                                           date(2026, 9, 25), parcelas_csv=ex / "parcelas.csv",
                                           pasta_estado=Path(tmp) / "estado", pasta_saida=Path(tmp) / "saida",
                                           out=lambda *a: None)
            r1 = rodar()
            r2 = rodar()
            self.assertTrue((Path(tmp) / "estado" / PR.ARQ_MODELO).exists())
        rp = r1["propensao"]
        self.assertEqual(set(rp) >= {"versao", "evidencia", "cortes", "clientes", "valor_esperado"}, True)
        enq = r1["enquadramento"]
        com = [e for e in enq.values() if e["propensao"] is not None]
        self.assertEqual(len(com), rp["clientes"])
        self.assertTrue(com and all(0 <= e["propensao"] <= 1 for e in com))
        if rp["evidencia"] == "coletando":
            self.assertTrue(all(e["faixa_propensao"] is None for e in enq.values()))
        fora = [k for k, e in r1["estados"].items() if e.estado in ("COL", "PRE", "LIQ", "BLQ")]
        self.assertTrue(all(enq[k]["propensao"] is None for k in fora))
        self.assertTrue(all("propensao" in p for p in r1["personas"]))
        # idempotente: a 2ª rodada do dia dá a mesma propensão e a mesma lista
        self.assertEqual({k: (e["propensao"], e["faixa_propensao"]) for k, e in enq.items()},
                         {k: (e["propensao"], e["faixa_propensao"]) for k, e in r2["enquadramento"].items()})
        self.assertEqual(r1["fila"], r2["fila"])


if __name__ == "__main__":
    unittest.main()


class TestRotinaNaoPara(unittest.TestCase):
    def test_erro_na_propensao_nao_segura_a_lista_do_dia(self):
        from unittest import mock
        import rodar_dia
        from tests.test_fases_mensagens import PASSO, _rodar
        with mock.patch.object(rodar_dia.propensao, "calcular", side_effect=ValueError("quebrou")):
            r = _rodar(PASSO)
        self.assertEqual([l["canal"] for l in r["fila"]], ["whatsapp"])          # a lista saiu
        self.assertTrue(any(a.startswith("PROPENSÃO: não calculada hoje") for a in r["alertas"]))
        self.assertEqual(r["propensao"]["evidencia"], "indisponivel")
