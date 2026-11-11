"""Treino de operadores por texto (voz/treino.py, SQL 100): cliente simulado e avaliação pelo checklist, com LLM falso.

- o prompt traz a ficha fictícia, a dificuldade e as objeções na ordem; o saldo é sorteado na faixa e fixo na sessão;
- a fala do operador volta mascarada (CPF, telefone, e-mail, 8+ dígitos, nome dito) e a do cliente também;
- "[DESLIGA]" vira desligou e nunca aparece na fala;
- a avaliação usa itens_aplicaveis (humano), a nota do analisador (item crítico com "não" reprova), descarta os códigos
  de cliente real e devolve o `dados` de registrar_sessao_treino com trecho do operador e dica "o que dizer";
- LLM fora ou resposta fora do esquema: "falhou" (a tentativa não conta); conversa sem fala do operador: erro;
- o simulador HTTP despacha {"treino": ...} pela mesma rota /simular, com a mesma assinatura.
"""
import json
import re
import unittest
import urllib.error
import urllib.request

from voz import simulador_http as SH
from voz import treino as TR
from voz.persona import RE_PESSOAL
from voz.provedores.montagem import Resposta

CEN = {"persona_nome": "Rita (fictícia)", "perfil": "ja_pagou", "objetivo": "Diz que já pagou e quer que parem de cobrar.",
       "comportamentos": ["insiste que pagou"], "frases": ["Mas eu já paguei isso!"],
       "objecoes": [{"codigo": "ja_paguei", "quando": "logo no começo"}, {"codigo": "procon"}], "dificuldade": 4,
       "divida": {"produto": "Cartão Exemplo", "faixa": "1k_5k", "dias_atraso": 60, "alcada": {"parcelas": 6}},
       "objetivo_cenario": "Pedir data e canal do pagamento"}
ITENS = [
    {"id": "ck_ident", "texto": "Se identificou", "gravidade": "importante", "peso": 1, "aplica": "ambos", "on": True},
    {"id": "ck_cpc", "texto": "Confirmou a identidade antes de falar valor", "gravidade": "bloqueante", "peso": 2, "aplica": "ambos", "on": True},
    {"id": "ck_resumo", "texto": "Resumiu o combinado", "gravidade": "boa_pratica", "peso": 1, "aplica": "humano", "on": True},
    {"id": "ck_so_ia", "texto": "Só para a IA", "gravidade": "importante", "peso": 1, "aplica": "ia", "on": True},
    {"id": "ck_desligado", "texto": "Desligado", "gravidade": "importante", "peso": 1, "aplica": "ambos", "on": False},
]
TURNOS = [{"quem": "persona", "texto": "Alô?", "t": 0}, {"quem": "operador", "texto": "Boa tarde, falo da Assessoria Exemplo.", "t": 4},
          {"quem": "persona", "texto": "Mas eu já paguei isso!", "t": 9}, {"quem": "operador", "texto": "O valor é R$ 2.300.", "t": 15}]


class Falso:
    """LLM falso: guarda as mensagens e devolve as respostas em ordem."""

    def __init__(self, *respostas):
        self.respostas, self.pedidos, self.timeout = list(respostas), [], 15

    def responder(self, mensagens, ferramentas):
        self.pedidos.append((mensagens, ferramentas))
        r = self.respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def analise(itens: dict) -> dict:
    return {"itens": [{"id": k, "resposta": v[0], "confianca": 0.9, "segmento": v[1]} for k, v in itens.items()],
            "motivo": {"probabilidades": {"contestacao": 0.9} if False else {}, "segmento": None}, "objecoes": [],
            "objecao_principal": None, "intencao": None, "canal_preferido": None, "horario_preferido": None,
            "vulnerabilidade": [], "riscos": [{"tipo": "procon", "falante": "cliente", "segmento": 2}], "frases": [],
            "temas": [], "sentimento": None, "falantes": "CACA", "transcricao_ruim": 0}


class TestCliente(unittest.TestCase):
    def test_prompt_com_ficha_ficticia_dificuldade_e_objecoes_na_ordem(self):
        p = TR.prompt_cliente(CEN, TR.saldo_ficticio("1k_5k", 7))
        self.assertIn("Seu nome: Rita.", p)
        self.assertIn("TREINAMENTO", p)
        self.assertIn("1. diz que já pagou (quando: logo no começo)\n2. ameaça reclamar no Procon", p)
        self.assertIn("difícil", p)
        self.assertIn("Cartão Exemplo; 60 dias de atraso; saldo em aberto: R$ ", p)
        self.assertIn(TR.DESLIGA, p)
        self.assertNotIn("parcelas", p, "a alçada é do operador; o cliente não sabe")

    def test_saldo_sorteado_na_faixa_e_fixo_na_sessao(self):
        a, b = TR.saldo_ficticio("1k_5k", 41), TR.saldo_ficticio("1k_5k", 41)
        self.assertEqual(a, b)
        v = float(a.replace("R$ ", "").replace(".", "").replace(",", "."))
        self.assertTrue(1000 <= v <= 5000)
        self.assertIsNone(TR.saldo_ficticio(None, 1))
        self.assertTrue(re.fullmatch(r"R\$ \d{1,3}(\.\d{3})*,00", TR.saldo_ficticio("5k_mais", 3)))

    def test_turno_mascara_a_fala_do_operador_e_do_cliente(self):
        m = Falso(Resposta("Meu CPF é 12345678909, me liga no 11987654321 ou ana@exemplo.com [DESLIGA]", tokens=33))
        r = TR.turno({"treino": "turno", "sessao": 9, "cenario": CEN, "turnos": TURNOS,
                      "texto": "Meu nome é Bianca, anota meu telefone (11) 98765-4321 e o e-mail bia@empresa.com"}, m)
        self.assertNotRegex(r["operador"], r"\d{8,}|@|Bianca")
        self.assertNotRegex(r["fala"], r"\d{8,}|@")
        self.assertIsNone(RE_PESSOAL.search(r["fala"]))
        self.assertTrue(r["desligou"])
        self.assertNotIn("DESLIGA", r["fala"])
        self.assertEqual(r["tokens"], 33)
        self.assertTrue(r["ficha"]["saldo"].startswith("R$ "))
        msgs = m.pedidos[0][0]
        self.assertEqual([x["role"] for x in msgs], ["system", "assistant", "user", "assistant", "user", "user"])
        self.assertEqual(m.pedidos[0][1], [], "sem ferramenta no papel do cliente")

    def test_primeira_fala_o_cliente_atende(self):
        m = Falso(Resposta("Alô? Quem fala?", tokens=5))
        r = TR.turno({"treino": "turno", "sessao": 1, "cenario": CEN, "turnos": []}, m)
        self.assertIsNone(r["operador"])
        self.assertEqual(r["fala"], "Alô? Quem fala?")
        self.assertFalse(r["desligou"])
        self.assertEqual(m.pedidos[0][0][-1]["role"], "user")

    def test_pedidos_invalidos(self):
        m = Falso()
        self.assertIn("erro", TR.turno({"cenario": {}, "turnos": []}, m))
        self.assertIn("erro", TR.turno({"cenario": CEN, "turnos": [{"quem": "agente", "texto": "x"}]}, m))
        self.assertIn("erro", TR.turno({"cenario": CEN, "turnos": [], "texto": "x" * 601}, m))
        self.assertIn("erro", TR.turno({"cenario": CEN, "turnos": [], "texto": "   "}, m))
        self.assertEqual(m.pedidos, [], "nada vai ao LLM")

    def test_llm_fora_no_turno_levanta(self):
        with self.assertRaises(RuntimeError):
            TR.turno({"cenario": CEN, "turnos": [], "texto": "Oi"}, Falso(RuntimeError("LLM HTTP 500")))


class TestAvaliacao(unittest.TestCase):
    def pedido(self, turnos=TURNOS):
        return {"treino": "avaliar", "checklist": {"versao_id": 3, "itens": ITENS}, "cenario": CEN, "turnos": turnos}

    def test_nota_pelo_checklist_item_critico_reprova_e_feedback_do_operador(self):
        m = Falso(
            Resposta("", chamadas=[("entregar_analise", analise({"ck_ident": ("sim", 1), "ck_cpc": ("nao", 3), "ck_resumo": ("na", None)}))],
                     tokens_entrada=100, tokens_saida=20),
            Resposta("", chamadas=[("entregar_dicas", {"dicas": [{"item": "ck_cpc", "dica": "Antes do valor, confirme: “Falo com a Rita?”"}],
                                                         "objetivo_ok": False})], tokens=40))
        r = TR.avaliar(self.pedido(), m)
        self.assertEqual(r["situacao"], "avaliada")
        self.assertEqual(r["itens"], {"ck_ident": "sim", "ck_cpc": "nao", "ck_resumo": "na"}, "só os itens do humano, ligados")
        self.assertAlmostEqual(r["nota"], 33.33, places=2)                   # 1 de (1 + 2)
        self.assertTrue(r["reprovada"])
        self.assertEqual(r["item_reprovado"], "ck_cpc")
        self.assertEqual(r["evidencia"]["ck_cpc"], [15.0, 20.0])
        self.assertEqual(r["feedback"], [{"item": "ck_cpc", "trecho": "O valor é R$ 2.300.", "dica": "Antes do valor, confirme: “Falo com a [NOME]?”"}],
                         "a dica também passa pela máscara (nome dito vira [NOME])")
        self.assertIs(r["objetivo_ok"], False)
        self.assertEqual(r["tokens"], 160)
        for k in ("codigos", "riscos", "alertas", "motivo", "curadoria"):
            self.assertNotIn(k, r, "códigos de cliente real são descartados no treino")
        self.assertEqual(set(r) - {"situacao", "nota", "itens", "evidencia", "reprovada", "item_reprovado", "objetivo_ok", "feedback", "tokens"}, set())
        transc = m.pedidos[0][0][1]["content"]
        self.assertIn("Operador: Boa tarde", transc)
        self.assertIn("Cliente: Mas eu já paguei", transc)
        self.assertNotIn("ck_so_ia", transc)

    def test_dica_padrao_quando_as_dicas_falham(self):
        m = Falso(Resposta("", chamadas=[("entregar_analise", analise({"ck_ident": ("nao", 1), "ck_cpc": ("sim", 1), "ck_resumo": ("sim", 3)}))]),
                  RuntimeError("LLM HTTP 500"))
        r = TR.avaliar(self.pedido(), m)
        self.assertEqual(r["feedback"][0]["dica"], "Reveja este ponto do checklist: Se identificou.")
        self.assertFalse(r["reprovada"])
        self.assertIsNone(r["objetivo_ok"])

    def test_llm_fora_na_avaliacao_e_falhou(self):
        r = TR.avaliar(self.pedido(), Falso(RuntimeError("LLM HTTP 503")))
        self.assertEqual(r["situacao"], "falhou")
        self.assertEqual(r["motivo_falha"], "servico")

    def test_sem_fala_do_operador_nem_avalia(self):
        self.assertIn("erro", TR.avaliar(self.pedido([{"quem": "persona", "texto": "Alô?"}]), Falso()))
        self.assertIn("erro", TR.avaliar({"checklist": {"itens": []}, "turnos": TURNOS}, Falso()))

    def test_rodar_despacha_e_aumenta_o_tempo_da_avaliacao(self):
        m = Falso(Resposta("Alô?"))
        self.assertEqual(TR.rodar({"treino": "turno", "cenario": CEN, "turnos": []}, lambda: m)["fala"], "Alô?")
        self.assertIn("erro", TR.rodar({"treino": "outro"}, lambda: m))
        self.assertEqual(TR.rodar({"treino": "turno"}, None), {"erro": "treino indisponível nesta VM"})
        m2 = Falso(RuntimeError("x"))
        TR.rodar(self.pedido() | {"treino": "avaliar"}, lambda: m2)
        self.assertEqual(m2.timeout, 45.0)


class TestHttp(unittest.TestCase):
    def test_treino_pela_rota_simular_com_assinatura(self):
        m = Falso(Resposta("Alô?", tokens=3))
        srv = SH.criar_servidor(0, "chave", modelo_de=lambda: m)
        import threading
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            porta = srv.server_address[1]

            def post(corpo: dict, chave="chave"):
                b = json.dumps(corpo).encode()
                import time
                c = str(int(time.time()))
                req = urllib.request.Request(f"http://127.0.0.1:{porta}/simular", data=b, method="POST", headers={
                    "Content-Type": "application/json", "X-MotorCX-Carimbo": c, "X-MotorCX-Assinatura": SH.assinatura(chave, c, b)})
                try:
                    with urllib.request.urlopen(req, timeout=5) as r:
                        return r.status, json.loads(r.read())
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read())
            st, r = post({"treino": "turno", "sessao": 1, "cenario": CEN, "turnos": []})
            self.assertEqual((st, r["fala"]), (200, "Alô?"))
            self.assertEqual(post({"treino": "turno", "cenario": {}, "turnos": []})[0], 400)
            self.assertEqual(post({"treino": "turno", "cenario": CEN, "turnos": []}, chave="outra")[0], 401)
            m.respostas.append(RuntimeError("LLM HTTP 500"))
            self.assertEqual(post({"treino": "turno", "cenario": CEN, "turnos": [], "texto": "Oi"})[0], 502)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
