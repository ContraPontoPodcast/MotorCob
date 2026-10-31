"""Retroalimentação do Speech Analytics (motor/retroalimentacao.py): piso das regras, estimativa de impacto,
antes × depois e relatório ao credor só com agregados. Dados fictícios."""
import unittest
from datetime import date

from motor import retroalimentacao as R


def cv(dimensao, valor, conversas, acordos, credor=1):
    return {"credor_id": credor, "dimensao": dimensao, "valor": valor, "conversas": conversas, "com_acordo": acordos}


class FakeSb:
    def __init__(self, tabelas=None, rpcs=None):
        self.tabelas, self.rpcs, self.chamadas, self.inseridos = tabelas or {}, rpcs or {}, [], []

    def selecionar(self, tabela, filtros=None, ordem=None, limite=None):
        return list(self.tabelas.get(tabela, []))

    def rpc(self, nome, args=None):
        self.chamadas.append((nome, args))
        r = self.rpcs.get(nome)
        return r(args) if callable(r) else r

    def inserir(self, tabela, linhas, conflito=None, retornar=False, lote=1000):
        self.inseridos.append((tabela, linhas, conflito))


class Piso(unittest.TestCase):
    def test_compara_so_com_200_por_grupo_e_5pp(self):
        self.assertIsNone(R.comparar(199, 80, 500, 100, "a", "b", "%"))
        self.assertIsNone(R.comparar(500, 120, 500, 100, "a", "b", "%"))      # 24% × 20% = 4 p.p.
        ev = R.comparar(500, 150, 400, 80, "a", "b", "%")
        self.assertEqual((ev["n_a"], ev["n_b"], ev["pct_a"], ev["pct_b"]), (500, 400, 30.0, 20.0))

    def test_pct_esconde_grupo_pequeno(self):
        self.assertIsNone(R.pct(5, 29))
        self.assertEqual(R.pct(15, 30), 50.0)

    def test_estimativa_metade_com_faixa_25_75(self):
        self.assertEqual(R.estimar_impacto(1000, 8), {"centro": 40, "min": 20, "max": 60})
        self.assertEqual(R.estimar_impacto(1000, -3), {"centro": 0, "min": 0, "max": 0})


class Regras(unittest.TestCase):
    def test_horario_vira_trava_na_estrategia(self):
        recs = R.regra_horario([cv("horario", "noite", 3880, 1590), cv("horario", "manha", 2140, 492),
                                cv("horario", "tarde", 150, 40)])
        self.assertEqual(len(recs), 1)
        r = recs[0]
        self.assertEqual((r.destino, r.credor_id), ("regua", 1))
        self.assertEqual(r.proposta["definicao"]["travas"]["horario"], {"ligado": True, "de": "17:00", "ate": "20:00"})
        self.assertGreaterEqual(r.evidencia["pct_a"] - r.evidencia["pct_b"], 5)

    def test_horario_sem_volume_nao_recomenda(self):
        self.assertEqual(R.regra_horario([cv("horario", "noite", 199, 150), cv("horario", "manha", 2000, 100)]), [])

    def test_renitencia_45_minutos(self):
        recs = R.regra_renitencia([{"credor_id": 2, "faixa": "ate_30", "tentativas": 1920, "cpcs": 8},
                                   {"credor_id": 2, "faixa": "45_90", "tentativas": 800, "cpcs": 60}])
        self.assertEqual(recs[0].proposta["definicao"]["travas"]["ligacoes"]["intervalo_ocupado"], 45)

    def test_frase_presente_no_acordo(self):
        linhas = [cv("total", "todas", 4210, 1000), cv("frase", "reconheceu_dificuldade", 760, 520),
                  cv("frase", "codigo_desconhecido", 900, 600)]
        recs = R.regra_frases(linhas)
        self.assertEqual([r.chave for r in recs], ["frases:reconheceu_dificuldade"])
        self.assertIn("momento está difícil", recs[0].proposta["texto"])

    def test_propensao_so_observacao(self):
        recs = R.regra_propensao([{"motivo": "aguardando_recebimento", "conversas": 1240, "pagamentos": 545},
                                  {"motivo": "esquecimento", "conversas": 3000, "pagamentos": 300}])
        self.assertEqual([(r.destino, r.chave) for r in recs], [("propensao", "propensao:aguardando_recebimento")])

    def test_ofertas_vao_para_o_fluxo(self):
        recs = R.regra_ofertas([cv("oferta", "of-3", 1410, 243), cv("oferta", "of-1", 1300, 143)])
        self.assertEqual(recs[0].destino, "fluxo")


class Banco(unittest.TestCase):
    def test_publica_pelo_rpc_do_banco(self):
        sb = FakeSb({"voz_conversao_dia": [cv("horario", "noite", 3880, 1590), cv("horario", "manha", 2140, 492)],
                     "voz_resultado_por_motivo": []}, {"renitencia_voz": [], "registrar_recomendacao_voz": 7})
        self.assertEqual(R.publicar_recomendacoes(sb, 12, date(2026, 11, 1)), 1)
        nome, args = sb.chamadas[-1]
        self.assertEqual((nome, args["empresa"], args["destino"]), ("registrar_recomendacao_voz", 12, "regua"))

    def test_impacto_so_depois_de_28_dias(self):
        rec = {"id": 5, "credor_id": 1, "aplicada_em": "2026-10-01T10:00:00-03:00"}
        sb = FakeSb({"recomendacoes": [rec], "voz_conversao_dia": [cv("total", "todas", 900, 120)]})
        self.assertEqual(R.medir_impactos(sb, 12, date(2026, 10, 20)), 0)
        self.assertEqual(R.medir_impactos(sb, 12, date(2026, 10, 29)), 1)
        tabela, linhas, conflito = sb.inseridos[0]
        self.assertEqual((tabela, linhas[0]["metrica"], linhas[0]["janela_dias"], conflito),
                         ("recomendacao_impacto", "acordo_pct", 28, "rec_id,metrica"))

    def test_medir_esconde_lado_pequeno(self):
        self.assertIsNone(R.medir((20, 5), (300, 40)))
        self.assertEqual(R.medir((300, 30), (300, 45))["depois"], 15.0)


class Relatorio(unittest.TestCase):
    def conv(self):
        return [cv("total", "todas", 1240, 181), cv("motivo", "esquecimento", 320, 100), cv("motivo", "reducao_renda", 10, 1),
                cv("motivo", "aguardando_recebimento", 250, 70), cv("objecao", "parcela_alta", 380, 40),
                cv("objecao", "juros", 20, 3)]

    def test_so_agregados_de_30_ou_mais(self):
        c = R.montar_relatorio({"id": 1, "politica": {"parcela_minima": 120}}, date(2026, 10, 1), self.conv(),
                               [{"tipo": "vulnerabilidade", "sinal": "saude"}] * 4,
                               [{"id": 2, "politica": {"parcela_minima": 50}, "conversas": 900, "acordos": 230}])
        nomes = [i["rotulo"] for s in c["secoes"] for i in s["itens"]]
        self.assertNotIn("Redução de renda", nomes)        # 10 conversas
        self.assertNotIn("Juros", nomes)                   # 20
        self.assertNotIn("Saúde", nomes)                   # 4 sinais
        self.assertTrue(all(i["n"] >= 30 for s in c["secoes"] for i in s["itens"]))
        pm = [r for r in c["recomendacoes"] if r["id"] == "parcela_minima"][0]
        e = pm["estimativa"]
        self.assertTrue(e["min"] <= e["centro"] <= e["max"])
        self.assertAlmostEqual(e["min"] / e["max"], 1 / 3, delta=0.05)
        self.assertNotIn("id_cliente", repr(c))

    def test_carteira_pequena_nao_tem_relatorio(self):
        self.assertIsNone(R.montar_relatorio({"id": 1}, date(2026, 10, 1), [cv("total", "todas", 29, 3)], [], []))


if __name__ == "__main__":
    unittest.main()
