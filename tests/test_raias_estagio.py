"""Raias por persona dentro dos estágios: a semântica que a tela da Régua mostra (site/src/lib/raias-estagio.ts).

- ordem dos canais numa célula (sempre / senão / junto / reserva) = estrategia.resolver, pelos casos de
  tests/dados/raias_semantica.json (o site roda os MESMOS casos);
- raia da persona no dia: só ela vale; sem contato para nenhum canal dela → público geral; "sem ação" → nada;
  persona sem raia no dia ou cliente sem persona → público geral;
- "Dia N do ciclo" do Não CPC: N = (dias de esteira desde o início do giro) mod ciclo + 1, e o passo é o do dia N.
"""
import json
import unittest
from datetime import date, timedelta
from pathlib import Path

from motor.certificacao import Certificacao
from motor.cluster import carregar_regras
from motor.estrategia import resolver, validar_estrategia
from motor.fila import gerar_fila
from motor.marcacao import Cliente, EstadoCliente
from motor.regua import carregar_regua

CASOS = json.loads((Path(__file__).parent / "dados" / "raias_semantica.json").read_text(encoding="utf-8"))["casos"]
D0 = date(2026, 9, 1)          # terça
CEL, EM = "11988880001", "c1@exemplo.invalid"


class TestOrdemDosCanaisNaCelula(unittest.TestCase):
    def test_casos_iguais_aos_da_tela(self):
        for caso in CASOS:
            with self.subTest(caso["nome"]):
                acoes = [{**a, "numeros": None, "contatos": {}} for a in caso["acoes"]]
                com = set(caso["com_contato"])
                saida = resolver(acoes, lambda a: ["x"] if a["canal"] in com else [])
                self.assertEqual([[c, cond] for c, cond, _ in saida], caso["esperado"])


def _fila(definicao, publico=None, dia=D0, estado=None):
    regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
    over, erros = validar_estrategia(definicao)
    assert not erros, erros
    regua = carregar_regua().com_clusters(regras, {7: over}, None, {})
    est = estado or EstadoCliente("C1", D0, "DG", "DG", "2026-09", cluster_versao=regua.versao_clusters)
    cli = {"C1": Cliente("C1", D0, 500.0, 30)}
    certs = {("C1", c): Certificacao("C1", c, "email" if "@" in c else "telefone", "DESCONHECIDO", 0.4)
             for c in (CEL, EM)}
    motivos = {}
    fila, _, _ = gerar_fila({"C1": est}, cli, certs, {}, {}, dia, regua, [], None, publico=publico, motivos=motivos)
    return sorted({(l["canal"], l["condicao"]) for l in fila}), motivos


def _loc(*acoes):
    return {"localizacao": {"passos": {"1": list(acoes)}}}


GERAL = {"canal": "sms", "modo": "sempre"}


class TestRaiaDaPersonaNoDia(unittest.TestCase):
    def test_persona_com_raia_recebe_so_a_raia_dela(self):
        d = _loc(GERAL, {"canal": "email", "modo": "sempre", "personas": ["7"]})
        self.assertEqual(_fila(d, publico={"C1": 7})[0], [("email", "")])

    def test_sem_persona_ou_persona_sem_raia_no_dia_segue_o_geral(self):
        d = _loc(GERAL, {"canal": "email", "modo": "sempre", "personas": ["7"]})
        self.assertEqual(_fila(d)[0], [("sms", "")])
        self.assertEqual(_fila(d, publico={"C1": 8})[0], [("sms", "")])

    def test_raia_sem_contato_para_nenhum_canal_dela_segue_o_geral(self):
        # RCS só em número com RCS: o cliente não tem → a raia não vai e o público geral assume
        d = _loc(GERAL, {"canal": "rcs", "modo": "sempre", "personas": ["7"], "contatos": {"rcs": True}})
        self.assertEqual(_fila(d, publico={"C1": 7})[0], [("sms", "")])

    def test_sem_acao_na_raia_e_nada_no_dia(self):
        d = _loc(GERAL, {"canal": "sem_acao", "modo": "sempre", "personas": ["7"]})
        fila, motivos = _fila(d, publico={"C1": 7})
        self.assertEqual(fila, [])
        self.assertEqual(motivos, {"sem_acao_na_raia": 1})

    def test_ordem_dentro_da_raia_vale_como_no_geral(self):
        d = _loc(GERAL, {"canal": "agente_voz", "modo": "sempre", "personas": ["7"]},
                 {"canal": "discador", "modo": "reserva", "personas": ["7"]})
        self.assertEqual(_fila(d, publico={"C1": 7})[0],
                         [("agente_voz", ""), ("discador", "se agente_voz sem contato no dia")])


class TestDiaDoCicloNoNaoCpc(unittest.TestCase):
    def test_dia_n_do_ciclo_repete_a_cada_ciclo(self):
        d = {"giro": {"ciclo_dias": 3, "max_ciclos": 2, "passos": {"1": [{"canal": "sms", "modo": "sempre"}],
                                                                    "3": [{"canal": "email", "modo": "sempre"}]}}}
        regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
        versao = carregar_regua().com_clusters(regras, {7: validar_estrategia(d)[0]}, None, {}).versao_clusters

        seg = date(2026, 9, 14)       # segunda (7/9 é feriado): os 6 dias seguintes (seg–sáb) têm janela; domingo não aciona

        def no_dia(n):
            est = EstadoCliente("C1", D0 - timedelta(days=30), "DG", "DG", "2026-08", estado="NCP", ciclo="G1",
                                giro_inicio=seg, cluster_versao=versao, inicio_esteira=D0 - timedelta(days=30))
            return _fila(d, dia=seg + timedelta(days=n), estado=est)[0]
        # dias 0,1,2 = Dia 1, 2, 3 do 1º ciclo; 3,4,5 = Dia 1, 2, 3 do 2º; depois acabou (aguarda enriquecimento)
        self.assertEqual([no_dia(n) for n in range(6)],
                         [[("sms", "")], [], [("email", "")], [("sms", "")], [], [("email", "")]])
        self.assertEqual(no_dia(7), [])                   # depois dos 2 ciclos: nada (aguarda enriquecimento)


if __name__ == "__main__":
    unittest.main()
