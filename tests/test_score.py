"""Score de Entrega (bloco 6): conta do modelo, faixas, filtro na campanha, grupo de controle e cobrança."""
import unittest

from nuvem import campanhas as C
from nuvem import mensageria as M
from nuvem import score as SC
from tests.test_campanhas import AGORA, TestCampanha


class TestModelo(unittest.TestCase):
    CFG = dict(SC.PADRAO)

    def test_recente_pesa_mais_e_falha_permanente_pesa_o_dobro(self):
        p_rec, t_rec, _ = SC.probabilidade([(0, "falhou", False)], self.CFG)
        p_ant, t_ant, _ = SC.probabilidade([(20, "falhou", False)], self.CFG)
        self.assertAlmostEqual(t_rec, 1.0)
        self.assertAlmostEqual(t_ant, 0.25)                       # duas meias-vidas
        self.assertLess(p_rec, p_ant)
        _, t_perm, _ = SC.probabilidade([(0, "falhou", True)], self.CFG)
        self.assertAlmostEqual(t_perm, 2.0)

    def test_fora_da_janela_nao_conta_e_sem_historico_usa_a_base(self):
        p, t, ultima = SC.probabilidade([(31, "falhou", True)], self.CFG, base=0.82)
        self.assertEqual((round(p, 4), t, ultima), (0.82, 0.0, None))
        self.assertEqual(SC.faixa(p, t, ultima, self.CFG), "sem")

    def test_faixas(self):
        so_falhas = [(1, "falhou", True), (3, "falhou", True), (8, "falhou", False)]
        p, t, u = SC.probabilidade(so_falhas, self.CFG)
        self.assertEqual(SC.faixa(p, t, u, self.CFG), "baixo")
        p, t, u = SC.probabilidade([(1, "entregue", False), (5, "entregue", False)], self.CFG)
        self.assertEqual(SC.faixa(p, t, u, self.CFG), "alto")
        p, t, u = SC.probabilidade([(1, "entregue", False), (2, "falhou", True)], self.CFG)
        self.assertEqual(SC.faixa(p, t, u, self.CFG), "medio")
        # pouco histórico nunca cai em Baixo
        p, t, u = SC.probabilidade([(9, "falhou", False)], self.CFG)
        self.assertLess(t, self.CFG["historico_min"])
        self.assertNotEqual(SC.faixa(p, t, u, self.CFG), "baixo")
        # quarentena vencida: o Baixo volta a ser tentado (como sem histórico)
        cfg = {**self.CFG, "quarentena_dias": 5}
        p, t, u = SC.probabilidade([(6, "falhou", True), (7, "falhou", True), (8, "falhou", True)], cfg)
        self.assertEqual(SC.faixa(p, t, u, cfg), "sem")

    def test_controle_estavel_e_proporcional(self):
        hashes = [f"{i:064x}" for i in range(4000)]
        sorteados = [h for h in hashes if SC.no_controle(h, 7, 5)]
        self.assertEqual(sorteados, [h for h in hashes if SC.no_controle(h, 7, 5)])
        self.assertAlmostEqual(len(sorteados) / len(hashes), 0.05, delta=0.012)
        self.assertFalse(any(SC.no_controle(h, 7, 0) for h in hashes))


class TestScoreNaCampanha(TestCampanha):
    def _score(self, faixas, cobranca="analisado", modo="simulado", controle=0):
        fx = {}
        for i, f in enumerate(self.fones):
            fx[M.hash_destino("sms", f)] = ("baixo", 0.05) if i % 5 == 0 else ("medio", 0.5) if i % 5 == 1 else ("alto", 0.9)
        self.sb.funcoes["score_entrega"] = lambda hashes, item_produto: [
            {"destino_hash": h, "faixa": fx.get(h, ("sem", 0.8))[0], "probabilidade": fx.get(h, ("sem", 0.8))[1]}
            for h in hashes]
        self.sb.funcoes["score_config_do_item"] = lambda item_produto: {**SC.PADRAO, "controle_pct": controle}
        self.sb.t["mensageria_score_nomes"] = [{"faixa": "baixo", "texto": "Número com baixa propensão de entrega"}]
        self.sb.t["empresa_score"] = [{"empresa_id": 1, "ativo": True, "cobranca": cobranca}]
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": modo}]
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        c = self._confirmar()
        c["score_faixas"] = faixas
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        return [m for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"]]

    def test_so_as_faixas_marcadas_recebem_e_o_resto_volta_com_o_nome(self):
        msgs = self._score(["alto", "medio", "sem"])
        self.assertEqual(len({tuple(sorted(m)) for m in msgs}), 1)          # mesmas chaves em todas as linhas
        baixo = [m for m in msgs if m["score_faixa"] == "baixo"]
        self.assertEqual(len(baixo), 10)
        self.assertEqual({(m["situacao"], m["filtro"], m["motivo"]) for m in baixo},
                         {("bloqueada", "score", "Número com baixa propensão de entrega")})
        self.assertTrue(all(m["situacao"] == "pendente" for m in msgs if m["score_faixa"] in ("alto", "medio")))
        self.assertNotIn("consumo_mensageria", self.sb.t)                   # simulação não cobra

    def test_grupo_de_controle_sai_mesmo_fora_da_faixa(self):
        msgs = self._score(["alto"], controle=5)
        fora = [m for m in msgs if m["score_faixa"] in ("baixo", "medio")]
        controle = [m for m in fora if m["score_controle"]]
        self.assertTrue(all(m["situacao"] == "pendente" and m["filtro"] is None for m in controle))
        self.assertEqual(len([m for m in fora if m["filtro"] == "score"]), len(fora) - len(controle))

    def test_cobranca_por_analisado_ou_represado_no_envio_real(self):
        self._score(["alto", "medio", "sem"], cobranca="represado", modo="real")
        itens = {c["item"]: c["quantidade"] for c in self.sb.t["consumo_mensageria"]}
        self.assertEqual(itens, {"score_represado": 10})

    def test_sem_score_na_campanha_nada_muda(self):
        msgs = self._score(None)
        self.assertFalse([m for m in msgs if m.get("filtro")])
        self.assertTrue(all(m.get("score_faixa") is None for m in msgs))


for _n in [n for n in dir(TestCampanha) if n.startswith("test")]:
    setattr(TestScoreNaCampanha, _n, None)        # não roda de novo os testes herdados das campanhas
del TestCampanha


if __name__ == "__main__":
    unittest.main()
