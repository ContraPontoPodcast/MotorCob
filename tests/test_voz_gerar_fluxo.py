"""Geração do fluxo a partir do texto (voz/gerar_fluxo.py) com um LLM falso: saída inválida nunca vira rascunho
(nem depois das 2 correções), as travas sempre entram, conector inventado não passa e mudanças são listadas."""
import copy
import json
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

    def test_processar_um_manda_os_tokens_so_para_o_custo(self):
        """SQL 61: os tokens de todas as tentativas vão em resultado.tokens_ia (custo real, só o Master vê)."""
        class LLMTokens(LLM):
            def responder(self, msgs, ferramentas):
                r = super().responder(msgs, ferramentas)
                return Resposta(r.texto, r.chamadas, tokens=1000)

        class SB:
            def __init__(self):
                self.chamadas = []

            def rpc(self, f, a):
                self.chamadas.append((f, a))
                return CTX if f == "pegar_pedido_fluxo_voz" else None
        sb = SB()
        G.processar_um(sb, LLMTokens([ruim(), ruim(), ruim()]))
        self.assertEqual(sb.chamadas[1][1]["resultado"]["tokens_ia"], 3000)
        self.assertEqual(G.gerar_fluxo_voz(CTX, LLMTokens([ruim(), ruim(), ruim()])).tokens, 3000)

    def test_processar_um_banco_sem_sql61_grava_sem_os_tokens(self):
        class LLMTokens(LLM):
            def responder(self, msgs, ferramentas):
                r = super().responder(msgs, ferramentas)
                return Resposta(r.texto, r.chamadas, tokens=500)

        class SB:
            def __init__(self):
                self.chamadas = []

            def rpc(self, f, a):
                self.chamadas.append((f, a))
                if f == "pegar_pedido_fluxo_voz":
                    return CTX
                if "tokens_ia" in (a.get("resultado") or {}):
                    raise RuntimeError("check constraint")
                return None
        sb = SB()
        self.assertTrue(G.processar_um(sb, LLMTokens([ruim(), ruim(), ruim()])))
        self.assertEqual([f for f, _ in sb.chamadas], ["pegar_pedido_fluxo_voz", "registrar_geracao_fluxo_voz",
                                                       "registrar_geracao_fluxo_voz"])
        self.assertNotIn("tokens_ia", sb.chamadas[2][1]["resultado"])

    def test_limpar_anexos(self):
        class SB:
            def __init__(self):
                self.removidos, self.marcados = [], []

            def rpc(self, f, a):
                if f == "anexos_fluxo_vencidos":
                    return [{"pedido_id": 7, "anexos": ["entradas/alfa/fluxo/desenho.pdf", "chamados/alfa/r.docx", "x"]}]
                self.marcados.append(a["pedido"])

            def apagar_arquivos(self, bucket, caminhos):
                self.removidos.append((bucket, caminhos))
        sb = SB()
        self.assertEqual(G.limpar_anexos(sb), 1)
        self.assertEqual(sb.removidos, [("entradas", ["alfa/fluxo/desenho.pdf"]), ("chamados", ["alfa/r.docx"])])
        self.assertEqual(sb.marcados, [7])


# Pedido real condensado (fictício: empresa, persona e valores inventados) de um "prompt de persona" colado no
# Descrever em texto. Com ele o LLM fazia um bloco por tópico e falhava nas correções.
TEXTO_PERSONA = (
    "PROMPT - AGENTE IA NEGOCIADOR DE COBRANÇA. Você é Alex, agente de IA da Financeira Exemplo, especializado em "
    "negociação de dívidas de cartão de crédito; humanizada, consultiva, persuasiva. 1. Abertura: apresente-se, diga "
    "que quer ajudar, solicite o primeiro nome. 2. Entendimento: interesse em regularizar, motivo do atraso, "
    "capacidade e preferência de pagamento. 3. Negociação: valor fictício R$ 3.500,00 só para simulação; à vista "
    "R$ 2.100,00; entrada R$ 300,00 + 6 parcelas de R$ 450,00; trate objeções sem pressionar. 4. Fechamento: "
    "confirme opção e valores, informe que é simulação. 5. Encerramento: agradeça e encerre. Regras: uma pergunta por "
    "vez; não invente dados; não ameace; se contestar a dívida, oriente canais oficiais.")
CTX_PERSONA = {**CTX, "texto": TEXTO_PERSONA}


def _s(rotulo, para, quando, tipo="normal"):
    return {"rotulo": rotulo, "para": para, "tipo": tipo, "quando": quando}


def compacto():
    """O que o pedido de persona deve virar: abertura → identidade → UMA generativa → finais."""
    return {"esquema": 1, "blocos": [
        {"id": "N1", "tipo": "abertura", "modo": "arvore", "titulo": "Abertura",
         "params": {"fala": "Olá, aqui é o Alex, assistente virtual da {{assessoria}}. Falo com {{primeiro_nome}}?"},
         "saidas": [_s("Sou eu", "N2", "titular"), _s("Não é a pessoa", "N7", "terceiro")]},
        {"id": "N2", "tipo": "identidade", "modo": "cognicao",
         "params": {"fala": "Para sua segurança, me confirma o dia e o mês do seu nascimento?",
                    "pergunta": "dia_mes_nascimento", "conector_id": 2, "tentativas": 2},
         "saidas": [_s("Confirmou", "N3", "confirmou"), _s("Não confirmou", "N7", "nao_confirmou"),
                    _s("Conector falhou", "N6", "falhou", "falha")]},
        {"id": "N3", "tipo": "generativa", "modo": "generativo", "titulo": "Entender e negociar",
         "params": {"objetivo": "Entender o interesse e o motivo do atraso, uma pergunta por vez, e negociar com as "
                                "ofertas recebidas, tratando objeções sem pressionar. Contestação: devolva contestou.",
                    "tom": ["cordial", "frases_curtas", "nao_pressiona"], "max_turnos": 20,
                    "ferramentas": ["apresentar_oferta", "registrar_promessa", "agendar_retorno", "transferir_humano",
                                    "encerrar_chamada"], "contrapropostas_max": 2},
         "saidas": [_s("Fechou acordo", "N4", "fechou_acordo", "devolve"), _s("Sem acordo", "N5", "sem_acordo", "devolve"),
                    _s("Contestou", "N8", "contestou", "devolve"), _s("Pediu humano", "N6", "pediu_humano", "devolve")]},
        {"id": "N4", "tipo": "encerrar", "modo": "arvore",
         "params": {"fala": "Obrigado. Você recebe a confirmação pelos canais oficiais. Até logo!", "resultado": "promessa"},
         "saidas": []},
        {"id": "N5", "tipo": "encerrar", "modo": "arvore",
         "params": {"fala": "Tudo bem, obrigado pela atenção. Até logo!", "resultado": "recusa"}, "saidas": []},
        {"id": "N6", "tipo": "transferir", "modo": "arvore", "titulo": "Transferir · atendente",
         "params": {"fala": "Vou passar você para um atendente agora, só um instante.", "motivo": "pedido_humano"},
         "saidas": []},
        {"id": "N7", "tipo": "encerrar", "modo": "arvore", "params": {"fala": G.RECADO, "resultado": "recado"}, "saidas": []},
        {"id": "N8", "tipo": "transferir", "modo": "arvore",
         "params": {"fala": "Vou passar você para a equipe que cuida de contestações.", "motivo": "contestacao"},
         "saidas": []},
    ]}


def baguncado():
    """Os quatro erros do pedido real: bloco_invalido, saida_invalida, saida_faltando e inalcancavel."""
    d = compacto()
    n1, n2, n3, n4 = (bloco(d, i) for i in ("N1", "N2", "N3", "N4"))
    n1["descricao"] = "Etapa 1 do prompt"                                    # chave fora do esquema
    n1["x"] = "esquerda"                                                       # posição que não é número
    n1["saidas"][0]["rotulo"] = "Sim, sou eu mesmo, pode falar comigo sobre o assunto que quiser, estou ouvindo"
    n2["saidas"] = n2["saidas"][:2]                                            # falta falhou (tem conector)
    n2["saidas"][0]["condicao"] = "se confirmar"                               # chave fora do esquema na saída
    n3["titulo"] = "Negociação consultiva, humanizada e persuasiva com tratamento de objeções e contrapropostas"
    n3["repetir_max"] = 9
    for s in n3["saidas"]:
        s["tipo"] = "normal"                                                   # generativa devolve
    n3["saidas"].append(_s("Fechou de novo", "N5", "fechou_acordo", "devolve"))   # quando repetido
    n4["saidas"] = [_s("Volta", "N1", "titular")]                              # final com saída
    d["blocos"] += [
        {"id": "N9", "tipo": "pergunta", "modo": "arvore", "titulo": "Etapa 5: encerramento",
         "params": {"fala": "Posso ajudar em algo mais?", "opcoes": [{"codigo": "nao", "rotulo": "Não"}]},
         "saidas": [_s("Não", "N10", "nao")]},
        {"id": "N10", "tipo": "encerrar", "modo": "arvore", "params": {"fala": "Até logo!", "resultado": "cpc"}, "saidas": []},
        {"id": "N11", "tipo": "conector", "modo": "sistema", "params": {"conector_id": 1}, "saidas": [_s("Ok", "N3", "respondeu")]},
    ]
    return d


def por_topico():
    """1ª resposta típica: um bloco por tópico do prompt, com os valores escritos na fala."""
    return {"esquema": 1, "blocos": [
        {"id": "N1", "tipo": "abertura", "modo": "arvore", "titulo": "1. Abertura: apresente-se, diga que quer ajudar e peça o nome",
         "params": {"fala": "Oi! Aqui é o Alex, da {{assessoria}}. Falo com {{primeiro_nome}}?"},
         "saidas": [_s("Sim", "N2", "titular"), _s("Não", "N9", "terceiro")]},
        {"id": "N2", "tipo": "identidade", "modo": "cognicao",
         "params": {"fala": "Me confirma o ano do seu nascimento?", "pergunta": "ano_nascimento", "conector_id": 2},
         "saidas": [_s("Confirmou", "N3", "confirmou"), _s("Não confirmou", "N9", "nao_confirmou")]},
        {"id": "N3", "tipo": "pergunta", "modo": "arvore", "titulo": "2. Entendimento",
         "params": {"fala": "Você tem interesse em regularizar?",
                    "opcoes": [{"codigo": "quer_regularizar", "rotulo": "Quer"}, {"codigo": "nao_quer", "rotulo": "Não quer"}]},
         "saidas": [_s("Quer", "N4", "quer_regularizar")]},
        {"id": "N4", "tipo": "pergunta", "modo": "arvore", "titulo": "3. Negociação",
         "params": {"fala": "Temos à vista R$ 2.100,00 ou entrada de R$ 300,00 + 6 parcelas de R$ 450,00. Qual prefere?",
                    "opcoes": [{"codigo": "aceitou", "rotulo": "Aceitou"}, {"codigo": "recusou", "rotulo": "Recusou"}]},
         "saidas": [_s("Aceitou", "N5", "aceitou"), _s("Recusou", "N6", "recusou")]},
        {"id": "N5", "tipo": "encerrar", "modo": "arvore", "params": {"fala": "Combinado, obrigado!", "resultado": "promessa"}, "saidas": []},
        {"id": "N6", "tipo": "encerrar", "modo": "arvore", "params": {"fala": "Tudo bem, obrigado.", "resultado": "recusa"}, "saidas": []},
        {"id": "N9", "tipo": "encerrar", "modo": "arvore", "params": {"fala": G.RECADO, "resultado": "recado"}, "saidas": []},
    ]}


class TestPedidoEmTextoLivre(unittest.TestCase):
    """Prompt de persona colado no Descrever em texto: reparos de forma, prompt com as regras do validador e
    correção com mensagens por bloco. As travas de segurança continuam recusando."""

    def test_compacto_e_valido(self):
        self.assertEqual(FV.erros(compacto()), [])
        self.assertEqual(G.erros_geracao(compacto(), CTX_PERSONA), [])

    def test_fluxo_valido_nao_ganha_reparo(self):
        for d in (compacto(), C.negociador()):
            out, sup = G.aplicar_travas(d, CTX)
            self.assertEqual(sup, [])
            self.assertEqual([b["id"] for b in out["blocos"]], [b["id"] for b in d["blocos"]])
            self.assertEqual([b["saidas"] for b in out["blocos"]], [b["saidas"] for b in d["blocos"]])

    def test_bagunca_vira_rascunho_valido_pelos_reparos(self):
        d = baguncado()
        codigos = {e.split(":")[0] for e in FV.erros(d)}
        self.assertLessEqual({"bloco_invalido", "saida_invalida", "saida_faltando", "inalcancavel"}, codigos)
        llm = LLM([d])
        g = G.gerar_fluxo_voz(CTX_PERSONA, llm)
        self.assertIsNotNone(g.definicao)
        out = g.definicao
        self.assertEqual(FV.erros(out), [])
        self.assertEqual((g.resultado["erros"], g.resultado["tentativas"], len(llm.chamadas)), ([], 0, 1))
        self.assertEqual(len(bloco(out, "N3")["titulo"]), 60)
        self.assertEqual(bloco(out, "N3")["repetir_max"], 5)
        self.assertEqual({s["tipo"] for s in bloco(out, "N3")["saidas"]}, {"devolve"})
        self.assertEqual([s["para"] for s in bloco(out, "N3")["saidas"] if s["quando"] == "fechou_acordo"], ["N4"])
        self.assertNotIn("descricao", bloco(out, "N1"))
        self.assertNotIn("x", bloco(out, "N1"))
        self.assertEqual(len(bloco(out, "N1")["saidas"][0]["rotulo"]), 60)
        self.assertNotIn("condicao", bloco(out, "N2")["saidas"][0])
        self.assertEqual(bloco(out, "N4")["saidas"], [])
        falhou = next(s for s in bloco(out, "N2")["saidas"] if s["quando"] == "falhou")
        self.assertEqual((falhou["para"], falhou["tipo"]), ("N6", "falha"))     # o Transferir · atendente que já existia
        self.assertEqual(sorted(b["id"] for b in out["blocos"]), sorted(["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8"]))
        sup = " | ".join(g.resultado["suposicoes"])
        self.assertIn("removidos: N9, N10, N11", sup)
        self.assertIn("repetir_max 9 ajustado para 5", sup)
        self.assertIn("N2 (falhou): vai para Transferir · atendente", sup)

    def test_falha_obrigatoria_cria_transferir_atendente(self):
        d = compacto()
        d["blocos"] = [b for b in d["blocos"] if b["id"] != "N6"]
        bloco(d, "N2")["saidas"] = bloco(d, "N2")["saidas"][:2]
        bloco(d, "N3")["saidas"] = bloco(d, "N3")["saidas"][:3]
        d["blocos"].insert(2, {"id": "N12", "tipo": "intencao", "modo": "cognicao",
                               "params": {"fala": "Como prefere seguir?", "intencoes": ["quero_negociar"]},
                               "saidas": [_s("Negociar", "N3", "quero_negociar")]})
        bloco(d, "N2")["saidas"][0]["para"] = "N12"
        d["blocos"].append({"id": "N20", "tipo": "encerrar", "modo": "arvore",                 # solto: sai
                            "params": {"fala": "Até logo!", "resultado": "cpc"}, "saidas": []})
        out, sup = G.aplicar_travas(d, CTX)
        self.assertEqual(FV.erros(out), [])
        self.assertNotIn("N20", [b["id"] for b in out["blocos"]])
        novo = bloco(out, "N21")                                     # o id removido não volta
        self.assertEqual((novo["tipo"], novo["titulo"], novo["params"]["motivo"]), ("transferir", "Transferir · atendente", "pedido_humano"))
        self.assertEqual({s["quando"]: s["para"] for s in bloco(out, "N12")["saidas"]}, {"quero_negociar": "N3", "nao_entendido": "N21"})
        self.assertIn("N2 (falhou), N12 (nao_entendido)", " ".join(sup))

    def test_nao_inventa_opcao_nem_intencao(self):
        """Saída obrigatória que não é falha/silêncio (opção da pergunta, confirmou...) fica para o LLM."""
        d = por_topico()
        out, _ = G.aplicar_travas(d, CTX)
        self.assertIn("saida_faltando:N3", FV.erros(out))
        self.assertEqual([s["quando"] for s in bloco(out, "N3")["saidas"]], ["quer_regularizar"])

    def test_um_bloco_por_topico_corrige_na_segunda_com_mensagens_por_bloco(self):
        llm = LLM([por_topico(), compacto()])
        g = G.gerar_fluxo_voz(CTX_PERSONA, llm)
        self.assertIsNotNone(g.definicao)
        self.assertEqual((g.resultado["tentativas"], g.resultado["erros"]), (1, []))
        msg = llm.chamadas[1][-1]["content"]
        self.assertIn("N3 (pergunta): saídas obrigatórias nao_quer, quer_regularizar (falta nao_quer); "
                      "válidas nao_quer, quer_regularizar, sem_resposta, silencio.", msg)
        self.assertIn("N4 (pergunta): fala com valor escrito (R$ 2.100,00); use {{oferta.*}} e deixe os valores como "
                      "pergunta sobre a alçada.", msg)
        self.assertIn("O sistema já fez estes ajustes", msg)
        self.assertIn("N2 (falhou): vai para Transferir · atendente", msg)
        self.assertIn("Códigos: saida_faltando:N3.", msg)
        # o LLM vê a própria resposta antes da correção
        self.assertEqual(json.loads(llm.chamadas[1][-2]["content"]), por_topico())

    def test_explicacoes(self):
        d = compacto()
        d["blocos"].append({"id": "N9", "tipo": "encerrar", "modo": "arvore",
                            "params": {"fala": "Até logo!", "resultado": "cpc"}, "saidas": []})
        linhas = G.explicar_erros(["inalcancavel:N9", "sem_saida:N3", "valor_antes_identidade:N1",
                                   "intencao_fora_catalogo:N2", "params_invalidos:N8"], d, CTX)
        self.assertEqual(linhas[0], "N1 (abertura): valor, oferta ou credor antes de Confirmar identidade; só depois "
                                    "da saída confirmou de um bloco identidade, em todos os caminhos.")
        self.assertIn("N9 (encerrar): nenhum caminho chega aqui; ligue a partir de outro bloco ou remova.", linhas)
        self.assertTrue(any(x.startswith("N3 (generativa): pelo menos uma saída") for x in linhas))
        self.assertTrue(any(x.startswith("N8 (transferir): params inválidos") and "contestacao" in x for x in linhas))
        self.assertEqual(G.explicar_erros(["esquema_invalido"], "lixo", CTX), ['A definição é {"esquema": 1, "blocos": [...]} e nada mais.'])

    def test_travas_de_seguranca_continuam_recusando(self):
        casos = []
        d = compacto()
        bloco(d, "N1")["params"]["fala"] = "Olá {{primeiro_nome}}, sua dívida é de {{saldo}}."
        casos.append((d, "valor_antes_identidade:N1"))
        d = compacto()
        bloco(d, "N4")["params"]["fala"] = "Fechado: entrada e 6 parcelas de R$ 450,00."
        casos.append((d, "oferta_escrita_na_fala:N4"))
        d = compacto()
        bloco(d, "N2")["params"]["fala"] = "Me diga a senha do cartão, por favor."
        casos.append((d, "fala_pede_senha:N2"))
        d = compacto()
        bloco(d, "N5")["params"]["fala"] = "Obrigado, {{cpf}}."
        casos.append((d, "variavel_invalida:N5"))
        for d, erro in casos:
            out, _ = G.aplicar_travas(d, CTX_PERSONA)
            self.assertIn(erro, G.erros_geracao(out, CTX_PERSONA))
            g = G.gerar_fluxo_voz(CTX_PERSONA, LLM([d, d, d]))
            self.assertIsNone(g.definicao, erro)
            self.assertIn(erro, g.resultado["erros"])

    def test_prompt_tem_regras_de_forma_e_mapeamento(self):
        llm = LLM([compacto()])
        G.gerar_fluxo_voz(CTX_PERSONA, llm)
        sistema = llm.chamadas[0][0]["content"]
        for trecho in ("titulo até 60 caracteres", "repetir_max inteiro de 1 a 5", "tipo \"falha\" se e só se",
                       "tipo \"devolve\" se e só se o bloco é generativa", "todo bloco alcançável a partir da abertura",
                       "NÃO faça um bloco por tópico", "UMA generativa", "Cadastrar estes valores na alçada da carteira?",
                       "{{primeiro_nome}}", "simulador", "contestacao"):
            self.assertIn(trecho, sistema)
        self.assertIn(TEXTO_PERSONA, llm.chamadas[0][1]["content"])


class TestServicoDaVm(unittest.TestCase):
    """O laço do serviço motorcx-voz-gerar-fluxo (G.rodar) nos dois acessos da VM: chave do servidor (PostgREST) e
    acesso próprio (papel motorcx_voz: RPC vira a função de voz_vm e o anexo sai por bilhete na voz-arquivos)."""

    def test_chave_do_servidor(self):
        class SB:
            def __init__(self):
                self.chamadas, self.removidos, self.fila = [], [], [dict(CTX), dict(CTX, pedido=8)]

            def rpc(self, f, a):
                self.chamadas.append(f)
                if f == "pegar_pedido_fluxo_voz":
                    return self.fila.pop(0) if self.fila else None
                if f == "anexos_fluxo_vencidos":
                    return [{"pedido_id": 7, "anexos": ["entradas/alfa/fluxo/desenho.pdf"]}]
                return None

            def apagar_arquivos(self, bucket, caminhos):
                self.removidos.append((bucket, caminhos))
        sb, esperas = SB(), []
        cont = G.rodar(sb, LLM([C.negociador(), C.negociador()]), intervalo=15, esperar=esperas.append, rodadas=2)
        self.assertEqual(cont, {"pedidos": 2, "anexos": 2, "falhas": 0})
        self.assertEqual(sb.chamadas[:5], ["pegar_pedido_fluxo_voz", "registrar_geracao_fluxo_voz",
                                           "pegar_pedido_fluxo_voz", "registrar_geracao_fluxo_voz",
                                           "pegar_pedido_fluxo_voz"])
        self.assertEqual(sb.removidos[0], ("entradas", ["alfa/fluxo/desenho.pdf"]))
        self.assertEqual(esperas, [15, 15])

    def test_acesso_proprio(self):
        import io
        import json as J

        from voz import acesso as A

        class Conn:
            def __init__(self):
                self.sqls, self.pedidos = [], [dict(CTX)]

            def run(self, sql, **p):
                self.sqls.append((sql, p))
                if "bilhete_arquivo" in sql:
                    return [["b" * 64]]
                if "pegar_pedido_fluxo" in sql:
                    return [[self.pedidos.pop(0) if self.pedidos else None]]
                if "anexos_fluxo_vencidos" in sql:
                    return [[[{"pedido_id": 7, "anexos": ["chamados/alfa/r.docx"]}]]]
                return [[None]]

            def close(self):
                pass

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        pedidos_http = []

        def abrir(req, timeout=None):
            pedidos_http.append((req.full_url, dict(req.header_items())))
            return Resp(b"{}")
        conn = Conn()
        sb = A.AcessoProprio(lambda: conn, "https://exemplo-ref.supabase.co", abrir=abrir)
        cont = G.rodar(sb, LLM([C.negociador()]), uma_vez=True)
        self.assertEqual(cont, {"pedidos": 1, "anexos": 1, "falhas": 0})
        funcoes = [sql.split("(")[0].replace("select ", "") for sql, _ in conn.sqls]
        self.assertEqual(funcoes, ["voz_vm.pegar_pedido_fluxo", "voz_vm.registrar_geracao_fluxo",
                                   "voz_vm.pegar_pedido_fluxo", "voz_vm.anexos_fluxo_vencidos",
                                   "voz_vm.bilhete_arquivo", "voz_vm.marcar_anexos_apagados"])
        self.assertEqual(conn.sqls[4][1], {"o": "apagar", "b": "chamados", "c": "alfa/r.docx"})
        reg = J.loads(conn.sqls[1][1]["a"])
        self.assertEqual(reg["pedido"], 7)
        self.assertEqual(FV.erros(reg["definicao"]), [])
        self.assertEqual(pedidos_http[0][0], "https://exemplo-ref.supabase.co/functions/v1/voz-arquivos")
        self.assertEqual(pedidos_http[0][1].get("X-voz-operacao"), "apagar")

    def test_erro_do_banco_nao_derruba(self):
        class SB:
            def rpc(self, f, a):
                raise OSError("banco fora")
        cont = G.rodar(SB(), LLM([]), esperar=lambda s: None, rodadas=3)
        self.assertEqual(cont, {"pedidos": 0, "anexos": 0, "falhas": 3})

    def test_unidade_e_opcao_da_vm(self):
        from pathlib import Path
        vm = Path(__file__).resolve().parent.parent / "infra" / "asterisk" / "vm"
        rodar = (vm / "motorcx-voz-rodar").read_text(encoding="utf-8")
        self.assertIn("gerar-fluxo)", rodar)
        self.assertIn('[ "$(meta motorcx-gerar-fluxo)" != 1 ]', rodar)
        self.assertIn("python3 -m voz.gerar_fluxo", rodar)
        # a atualização das 05:35 reinicia o serviço quando a imagem da voz muda (senão roda a imagem antiga)
        atualizar = (vm / "motorcx-voz-atualizar").read_text(encoding="utf-8").replace("\\\n", "")
        self.assertIn("motorcx-voz-gerar-fluxo", next(x for x in atualizar.splitlines() if x.startswith('atualizar "$IMG_VOZ"')))
        unidade = (vm / "motorcx-voz-gerar-fluxo.service").read_text(encoding="utf-8")
        self.assertIn("ExecStart=/usr/local/bin/motorcx-voz-rodar gerar-fluxo", unidade)
        self.assertIn("ExecStartPre=/usr/local/bin/motorcx-voz-segredos", unidade)
        inicio = (vm / "vm_inicio.sh").read_text(encoding="utf-8")
        self.assertIn("motorcx-voz-gerar-fluxo.service", inicio.split("systemctl enable --now motorcx-asterisk.service")[1].split("\n\n")[0])
        self.assertEqual(G.REF_LLM, "voz/llm-fluxo")

    def test_motorcx_voz_rodar_gerar_fluxo(self):
        """O script da VM com metadados e docker FALSOS: desligado sai 0 sem docker; ligado sobe o contêiner com o
        mesmo comum_voz (voz.env dos dois acessos); metadado de URL/modelo inválido é recusado."""
        import os
        import shutil
        import subprocess
        import tempfile
        from pathlib import Path
        if not shutil.which("bash"):
            self.skipTest("precisa de bash")
        vm = Path(__file__).resolve().parent.parent / "infra" / "asterisk" / "vm"
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        comum = tmp / "comum"
        comum.write_text('meta() { case "$1" in motorcx-gerar-fluxo) echo "${M_LIGA:-}" ;; '
                         'motorcx-gerar-fluxo-base-url) echo "${M_URL:-}" ;; motorcx-gerar-fluxo-modelo) echo "${M_MOD:-}" ;; esac; }\n'
                         'PARTE=1/2\nIMG_VOZ=imagem-voz\nRUN=/run/motorcx\n')
        script = tmp / "rodar"
        script.write_text((vm / "motorcx-voz-rodar").read_text(encoding="utf-8").replace(
            ". /usr/local/bin/motorcx-voz-comum", f". {comum}").replace("exec docker ", "docker "))  # exec pula a função
        log = tmp / "log"

        def rodar(**meta):
            log.unlink(missing_ok=True)
            env = {**os.environ, **meta, "LOG": str(log), "BASH_FUNC_docker%%": '() { echo "docker $*" >> "$LOG"; }'}
            r = subprocess.run(["bash", str(script), "gerar-fluxo"], capture_output=True, text=True, env=env, timeout=30)
            return r, (log.read_text() if log.exists() else "")
        r, d = rodar()
        self.assertEqual((r.returncode, d), (0, ""))
        self.assertIn("desligada", r.stdout)
        r, d = rodar(M_LIGA="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--env-file /run/motorcx/voz.env", d)
        self.assertIn("--read-only", d)
        self.assertTrue(d.strip().endswith("imagem-voz python3 -m voz.gerar_fluxo --intervalo 15"), d)
        r, d = rodar(M_LIGA="1", M_URL="https://llm.exemplo.com/v1", M_MOD="modelo-x")
        self.assertTrue(d.strip().endswith("--base-url https://llm.exemplo.com/v1 --modelo modelo-x"), d)
        for ruim in ({"M_URL": "http://llm.exemplo.com"}, {"M_URL": "https://x.com/$(id)"}, {"M_MOD": "a b"}):
            r, d = rodar(M_LIGA="1", **ruim)
            self.assertEqual((r.returncode, d), (2, ""), ruim)


if __name__ == "__main__":
    unittest.main()
