"""Geração do fluxo a partir do texto (voz/gerar_fluxo.py) com um LLM falso: saída inválida nunca vira rascunho
(nem depois das 2 correções), as travas sempre entram, conector inventado não passa e mudanças são listadas."""
import copy
import unittest

from voz import fluxo_casos as C
from voz import fluxo_validador as FV
from voz import gerar_fluxo as G
from voz.provedores.montagem import Resposta

CTX = {"pedido": 7, "empresa_id": 1, "credor_id": 2, "texto": "Quero confirmar o titular, buscar ofertas no CRM e negociar.",
       "conectores": [{"id": 1, "nome": "Buscar ofertas", "finalidade": "buscar_ofertas", "campos": ["oferta.id"]},
                      {"id": 2, "nome": "Validar cadastro", "finalidade": "validar_cadastro", "campos": ["codigo"]},
                      {"id": 3, "nome": "Registrar acordo", "finalidade": "registrar_acordo", "campos": ["codigo"]},
                      {"id": 4, "nome": "Gerar boleto", "finalidade": "gerar_boleto", "campos": ["link_pagamento"]}],
       "intencoes": ["quero_negociar", "ja_paguei", "nao_reconheco", "sem_dinheiro", "nao_me_ligue", "pedir_humano"],
       "variaveis": list(FV.VARIAVEIS_FALA), "tem_alcada": True, "origem": None, "respostas": None}


class LLM:
    def __init__(self, definicoes):
        self.defs, self.chamadas = list(definicoes), []

    def responder(self, msgs, ferramentas):
        self.chamadas.append(copy.deepcopy(msgs))
        d = self.defs.pop(0)
        return Resposta("", [("entregar_fluxo", {"definicao": d, "entendi": [{"frase": "buscar ofertas no CRM", "bloco": "N4"}],
                                                 "suposicoes": ["sem dinheiro agenda retorno"], "perguntas": ["Qual o tom?"]})])


def bloco(d, i):
    return next(b for b in d["blocos"] if b["id"] == i)


def ruim():
    d = C.negociador()
    bloco(d, "N1")["params"]["fala"] = "Consta {{saldo}}. Falo com {{primeiro_nome}}?"     # valor antes da identidade
    return d


class TestGerar(unittest.TestCase):
    def test_valida_e_devolve_o_que_entendeu(self):
        llm = LLM([C.negociador()])
        g = G.gerar_fluxo_voz(CTX, llm)
        self.assertEqual(FV.erros(g.definicao), [])
        self.assertEqual(g.resultado["entendi"], [{"frase": "buscar ofertas no CRM", "bloco": "N4"}])
        self.assertEqual((g.resultado["perguntas"], g.resultado["tentativas"], g.resultado["erros"]), (["Qual o tom?"], 0, []))
        prompt = llm.chamadas[0][0]["content"]
        self.assertIn("1: Buscar ofertas (buscar_ofertas", prompt)          # só os conectores da empresa
        self.assertIn("quero_negociar", prompt)

    def test_saida_invalida_nunca_vira_rascunho(self):
        llm = LLM([ruim(), ruim(), ruim()])
        g = G.gerar_fluxo_voz(CTX, llm)
        self.assertIsNone(g.definicao)
        self.assertEqual(g.resultado["erros"], ["valor_antes_identidade:N1"])
        self.assertEqual(len(llm.chamadas), 3)                               # 1 + 2 correções
        self.assertIn("valor_antes_identidade:N1", llm.chamadas[1][-1]["content"])

    def test_corrige_na_segunda(self):
        g = G.gerar_fluxo_voz(CTX, LLM([ruim(), C.negociador()]))
        self.assertIsNotNone(g.definicao)
        self.assertEqual(g.resultado["tentativas"], 1)

    def test_lixo_do_llm(self):
        g = G.gerar_fluxo_voz(CTX, LLM(["não é json", {"esquema": 9}, None]))
        self.assertIsNone(g.definicao)
        self.assertEqual(g.resultado["erros"], ["esquema_invalido"])

    def test_travas_sempre_entram(self):
        d = C.negociador()
        n5 = bloco(d, "N5")["params"]
        n5["ferramentas"] = ["apresentar_oferta", "encerrar_chamada", "pagar_pix"]       # sem transferir, com uma inventada
        bloco(d, "N2")["modo"] = "generativo"                                            # identidade generativa
        next(s for s in bloco(d, "N1")["saidas"] if s["quando"] == "terceiro")["para"] = "N13"   # terceiro sem recado
        bloco(d, "N14")["params"]["fala"] = "Ana, sua dívida de {{saldo}} com {{credor}} venceu."
        g = G.gerar_fluxo_voz(CTX, LLM([d]))
        self.assertIsNotNone(g.definicao)
        out = g.definicao
        self.assertEqual(bloco(out, "N5")["params"]["ferramentas"], ["apresentar_oferta", "encerrar_chamada", "transferir_humano"])
        self.assertEqual(bloco(out, "N2")["modo"], "cognicao")
        terc = next(s for s in bloco(out, "N1")["saidas"] if s["quando"] == "terceiro")["para"]
        self.assertEqual((bloco(out, terc)["tipo"], bloco(out, terc)["params"]["fala"]), ("encerrar", G.RECADO))
        self.assertEqual(bloco(out, "N14")["params"]["fala"], G.RECADO)

    def test_conector_inventado_vira_a_escolher(self):
        d = C.negociador(99, 1, 3, 4)          # 99 não existe; 1 é de ofertas, não de validação
        g = G.gerar_fluxo_voz(CTX, LLM([d]))
        self.assertIsNone(bloco(g.definicao, "N4")["params"]["conector_id"])
        self.assertIsNone(bloco(g.definicao, "N2")["params"]["conector_id"])
        self.assertEqual(len(g.resultado["suposicoes"]), 3)
        self.assertIn("identidade_sem_conferencia:N2",
                      FV.pendencias(g.definicao, {i: ("ativo", c["finalidade"]) for i, c in
                                                   ((c["id"], c) for c in CTX["conectores"])}, True, set(CTX["intencoes"])))

    def test_nao_inventa_oferta_nem_intencao(self):
        d = C.negociador()
        bloco(d, "N6")["params"]["fala"] = "Faço em 10 vezes de R$ 99,90 para você."
        e = C.negociador()
        bloco(e, "N3")["params"]["intencoes"].append("quer_boleto")
        bloco(e, "N3")["saidas"].append({"rotulo": "Boleto", "para": "N13", "tipo": "normal", "quando": "quer_boleto"})
        g = G.gerar_fluxo_voz(CTX, LLM([d, e, e]))
        self.assertIsNone(g.definicao)
        self.assertEqual(g.resultado["erros"], ["intencao_fora_catalogo:N3"])
        self.assertEqual(G.erros_geracao(d, CTX), ["oferta_escrita_na_fala:N6"])
        self.assertEqual(G.erros_geracao(C.negociador(), {**CTX, "tem_alcada": False}), ["oferta_sem_alcada:N6"])

    def test_mudancas_em_relacao_a_origem(self):
        origem = C.negociador()
        nova = copy.deepcopy(origem)
        bloco(nova, "N2")["params"]["tentativas"] = 1
        nova["blocos"] = [b for b in nova["blocos"] if b["id"] != "N16"]
        next(s for s in bloco(nova, "N8")["saidas"] if s["quando"] == "informou_data")["para"] = "N13"
        g = G.gerar_fluxo_voz({**CTX, "origem": origem}, LLM([nova]))
        # N14: a trava trocou o recado pelo texto fixo, e isso também aparece como mudança
        self.assertEqual(g.resultado["mudancas"], ["N2: mudou params", "N8: mudou saidas", "N14: mudou params",
                                                   "N16: bloco removido (encerrar)"])

    def test_processar_um_invalido_vai_sem_definicao(self):
        class SB:
            def __init__(self):
                self.chamadas = []

            def rpc(self, f, a):
                self.chamadas.append((f, a))
                return CTX if f == "pegar_pedido_fluxo_voz" and len(self.chamadas) == 1 else None
        sb = SB()
        self.assertTrue(G.processar_um(sb, LLM([ruim(), ruim(), ruim()])))
        f, a = sb.chamadas[1]
        self.assertEqual((f, a["pedido"], a["definicao"]), ("registrar_geracao_fluxo_voz", 7, None))
        self.assertEqual(a["resultado"]["erros"], ["valor_antes_identidade:N1"])
        self.assertFalse(G.processar_um(sb, LLM([])))


if __name__ == "__main__":
    unittest.main()
