"""VM do Speech Analytics (voz/analise): máscara dos trechos, janelas por falante, embedding no Vertex de São Paulo,
busca semântica pendente, fila da curadoria, uso de IA e PDF do relatório. Dados fictícios."""
import json
import unittest

from voz.analise import contrato as K
from voz.analise import curadoria as C
from voz.analise import relatorio_pdf as P
from voz.analise import trechos as T
from voz.transcricao.redacao import redigir_trecho


class FakeSb:
    def __init__(self, tabelas=None, rpcs=None):
        self.tabelas, self.rpcs = tabelas or {}, rpcs or {}
        self.inseridos, self.chamadas, self.enviados, self.atualizados = [], [], [], []

    def selecionar(self, tabela, filtros=None, ordem=None, limite=None):
        return list(self.tabelas.get(tabela, []))

    def inserir(self, tabela, linhas, conflito=None, retornar=False, lote=1000):
        self.inseridos.append((tabela, linhas, conflito))

    def rpc(self, nome, args=None):
        self.chamadas.append((nome, args))
        return self.rpcs.get(nome)

    def enviar(self, bucket, caminho, conteudo, tipo="text/csv"):
        self.enviados.append((bucket, caminho, tipo, conteudo))

    def atualizar(self, tabela, filtros, valores):
        self.atualizados.append((tabela, filtros, valores))


class EmbFalso(T.Embedder):
    def __init__(self):
        self.textos = []

    def vetores(self, textos):
        self.textos += textos
        return [[0.1] * K.DIMENSAO for _ in textos]


class Mascara(unittest.TestCase):
    def test_tudo_que_identifica_some(self):
        t = redigir_trecho("Oi Joana, meu CPF é 529.982.247-25, liga no (11) 98765-4321 ou joana@exemplo.com, "
                           "conta 12345678901, estou internada no hospital", nomes=["Joana"])
        for proibido in ("529.982", "98765", "joana@", "12345678901", "Joana", "internada", "hospital"):
            self.assertNotIn(proibido, t)
        self.assertIn("[NOME]", t)
        self.assertIn("[SAÚDE]", t)

    def test_nome_dito_vira_marca(self):
        self.assertEqual(redigir_trecho("meu nome é Carlos"), "meu nome é [NOME]")

    def test_valor_em_reais_fica(self):
        self.assertIn("R$ 2.380,00", redigir_trecho("o débito está em R$ 2.380,00"))


class Janelas(unittest.TestCase):
    def test_agrupa_por_falante_ate_30s_e_marca_operador_depois_da_transferencia(self):
        segs = [{"inicio": 0, "fim": 8, "texto": "Bom dia", "locutor": "agente"},
                {"inicio": 8, "fim": 20, "texto": "posso falar do contrato?", "locutor": "agente"},
                {"inicio": 20, "fim": 35, "texto": "Pode, mas meu número é 11987654321", "locutor": "cliente"},
                {"inicio": 40, "fim": 60, "texto": "Aqui é do atendimento", "locutor": "agente"}]
        js = T.janelas(segs, transferida_s=38)
        self.assertEqual([j.falante for j in js], ["agente", "cliente", "operador"])
        self.assertEqual((js[0].inicio_s, js[0].fim_s), (0, 20))
        self.assertNotIn("11987654321", js[1].texto)

    def test_grava_com_embedding_e_sem(self):
        sb, emb = FakeSb(), EmbFalso()
        js = T.janelas([{"inicio": 0, "fim": 10, "texto": "quero pagar no dia do salário", "locutor": "cliente"}])
        g = {"id": 9, "empresa_id": 1, "credor_id": 2, "origem": "ia"}
        self.assertEqual(T.gravar(sb, g, js, emb), 1)
        tabela, linhas, conflito = sb.inseridos[0]
        self.assertEqual((tabela, conflito), ("voz_trechos", "gravacao_id,inicio_s,falante"))
        self.assertTrue(linhas[0]["embedding"].startswith("[0.1,"))
        self.assertTrue(set(linhas[0]) - {"embedding"} <= set(K.COLUNAS["voz_trechos"]))
        T.gravar(sb, g, js, emb, com_vetor=False)
        self.assertNotIn("embedding", sb.inseridos[1][1][0])


class Vertex(unittest.TestCase):
    def test_sao_paulo_1536_dimensoes_sem_chave(self):
        pedidos = []

        def req(metodo, url, token, corpo, tipo):
            pedidos.append((url, json.loads(corpo)))
            return {"predictions": [{"embeddings": {"values": [0.0] * 1536, "statistics": {"token_count": 7}}}]}

        e = T.EmbeddingVertex("projeto-exemplo", token=lambda: "x", requisitar=req)
        self.assertEqual(len(e.vetores(["boleto falso"])[0]), 1536)
        url, corpo = pedidos[0]
        self.assertIn("southamerica-east1-aiplatform.googleapis.com", url)
        self.assertEqual(corpo["parameters"]["outputDimensionality"], 1536)
        self.assertEqual(e.tokens_entrada, 7)

    def test_dimensao_errada_falha(self):
        e = T.EmbeddingVertex("p", token=lambda: "x",
                              requisitar=lambda *a: {"predictions": [{"embeddings": {"values": [0.0] * 768}}]})
        with self.assertRaises(ValueError):
            e.vetores(["x"])


class Busca(unittest.TestCase):
    def test_responde_as_pendentes(self):
        sb = FakeSb(rpcs={"buscas_voz_pendentes": [{"id": 3, "termo": "pagar quando o salário cair"}]})
        self.assertEqual(T.atender_buscas(sb, EmbFalso()), 1)
        nome, args = sb.chamadas[-1]
        self.assertEqual((nome, args["busca"]), ("responder_busca_voz", 3))

    def test_uso_de_ia_manda_quantidade_nunca_custo(self):
        sb = FakeSb()
        T.registrar_uso(sb, 1, "2026-10-20", "avaliador", 10, 42.5, 42.5, 1000, 200)
        nome, args = sb.chamadas[0]
        self.assertEqual(nome, "registrar_uso_ia_voz")
        self.assertFalse({k for k in args if "custo" in k or "preco" in k})


class Curadoria(unittest.TestCase):
    def test_regras_da_fila(self):
        ctx = {"empresa_id": 1, "chamada_id": 5, "gravacao_id": 6, "nomes": ["Ana"]}
        itens = C.itens_da_chamada(ctx, {
            "intencoes": [{"intencao": "sem_dinheiro", "confianca": 0.41, "trecho": "Ana: quando o pagamento cair",
                           "alternativas": ["sem_dinheiro", "data_salario"]},
                          {"intencao": "ja_paguei", "confianca": 0.9, "trecho": "já paguei"}],
            "travas": [{"trava": "fora_alcada", "trecho": "posso tirar os juros"}],
            "probabilidades": {"motivo": {"reducao_renda": 0.44, "outras_dividas": 0.38}, "objecao": {"juros": 0.9, "valor_alto": 0.1}},
            "baixa_confianca_pct": 0.41})
        self.assertEqual(sorted(i["tipo"] for i in itens), ["codigo", "intencao", "transcricao", "trava"])
        self.assertNotIn("Ana", itens[0]["trecho_redigido"])
        sb = FakeSb()
        C.enfileirar(sb, itens)
        self.assertTrue(set(sb.inseridos[0][1][0]) <= set(K.COLUNAS["voz_curadoria_itens"]))

    def test_tema_pequeno_espera(self):
        self.assertEqual(C.itens_de_temas(1, [{"tema_id": 1, "conversas": 12}]), [])
        self.assertEqual(len(C.itens_de_temas(1, [{"tema_id": 1, "conversas": 388, "exemplo": "pix parcelado"}])), 1)


class Pdf(unittest.TestCase):
    REL = {"id": 4, "credor_id": 2, "competencia": "2026-10-01", "comentario": "Piloto de 30 dias.",
           "conteudo": {"resumo": {"conversas": {"n": 1240}, "acordo_pct": 14.6},
                        "secoes": [{"id": "motivos", "titulo": "O que os devedores dizem",
                                    "itens": [{"rotulo": "Esqueceu", "n": 320, "pct": 25.8}]}],
                        "recomendacoes": [{"id": "p1", "titulo": "Parcela mínima <menor>", "evidencia": "x", "n": 380,
                                           "unidade": "acordos a mais por mês",
                                           "estimativa": {"centro": 12, "min": 6, "max": 18}}]}}

    def test_html_escapa_e_fala_em_agregados(self):
        h = P.montar_html(self.REL, "Cartão Horizonte", "Aurora")
        self.assertIn("outubro de 2026", h)
        self.assertIn("&lt;menor&gt;", h)
        self.assertIn("1.240 conversas", h)
        self.assertIn("faixa de 6 a 18", h)

    def test_gera_envia_e_grava_caminho(self):
        sb = FakeSb({"empresas": [{"id": 1, "slug": "aurora", "nome": "Aurora"}], "relatorios_credor": [self.REL],
                     "credores": [{"id": 2, "nome": "Cartão Horizonte"}]})
        self.assertEqual(P.gerar(sb, 1, "2026-10-01", para_pdf=lambda h: b"%PDF-1.4"), 1)
        self.assertEqual(sb.enviados[0][:3], ("saidas", "aurora/relatorios_credor/2/2026-10.pdf", "application/pdf"))
        self.assertEqual(sb.atualizados[0][2], {"pdf_caminho": "aurora/relatorios_credor/2/2026-10.pdf"})

    def test_chromium_sem_interface(self):
        chamadas = []

        def rodar(cmd, **kw):
            chamadas.append(cmd)
            saida = [c for c in cmd if c.startswith("--print-to-pdf=")][0].split("=", 1)[1]
            with open(saida, "wb") as f:
                f.write(b"%PDF")

        self.assertEqual(P.html_para_pdf("<p>x</p>", rodar=rodar), b"%PDF")
        self.assertIn("--headless", chamadas[0])


if __name__ == "__main__":
    unittest.main()
