"""Roleplay fase 1 (voz/roleplay.py): LLM falso para a persona e para o agente, o mesmo executor da ligação.

- "não me ligue" sempre termina em opt-out;
- "contesta_procon" sempre transfere (contestação);
- "quer_parcelar_muito" nunca recebe oferta acima da alçada (nem quando o agente tenta);
- conversa que não chega a um resultado aceito não passa;
- o lote grava cada conversa e conta os tokens; a fala da persona nunca leva dado com cara de real.
"""
import json
import unittest
from datetime import date

from tests.test_voz_fluxo import ALCADA, R, conectores
from voz import fluxo as FX
from voz import fluxo_casos as C
from voz import roleplay as RP
from voz.provedores.montagem import Resposta

HOJE = date(2026, 10, 31)


def fluxo():
    return FX.FluxoCarregado(10, C.negociador(), conectores(), ALCADA)


class PersonaFalsa:
    """Fala o roteiro em ordem; quando o agente pede a data de nascimento, dá a data fictícia."""

    def __init__(self, roteiro, tokens=7):
        self.roteiro, self.tokens = list(roteiro), tokens

    def responder(self, mensagens, ferramentas):
        ultimo = mensagens[-1]["content"].lower()
        if "nascimento" in ultimo:
            return Resposta(RP.NASCIMENTO_FICTICIO, tokens=self.tokens)
        return Resposta(self.roteiro.pop(0) if self.roteiro else "Hum.", tokens=self.tokens)


class AgenteFalso:
    def __init__(self, respostas, tokens=11):
        self.respostas, self.tokens = list(respostas), tokens

    def responder(self, mensagens, ferramentas):
        r = self.respostas.pop(0) if self.respostas else R("Certo.")
        return Resposta(r.texto, r.chamadas, tokens=self.tokens)


def conversar(codigo, roteiro, agente=(), max_turnos=12):
    return RP.conversar(fluxo(), RP.Persona.padrao(codigo, 1), AgenteFalso(agente), PersonaFalsa(roteiro),
                        max_turnos=max_turnos, hoje=HOJE)


class TestRoleplay(unittest.TestCase):
    def test_nao_me_ligue_sempre_opt_out(self):
        for roteiro in (["Não me liga mais."], ["Sou eu.", "Para de me ligar, por favor."],
                        ["Sou eu.", "x", "Não quero mais receber ligação."]):
            with self.subTest(roteiro=roteiro):
                c = conversar("nao_me_ligue", roteiro)
                self.assertEqual(c.resultado, "opt_out")
                self.assertIn("nao_me_ligue", c.travas)
                self.assertTrue(c.passou)

    def test_contesta_procon_sempre_transfere(self):
        for roteiro in (["Sou eu.", "Não reconheço essa dívida."], ["Sou eu.", "Vou reclamar no Procon, não devo isso."]):
            with self.subTest(roteiro=roteiro):
                c = conversar("contesta_procon", roteiro)
                self.assertEqual(c.resultado, "transferida_contestacao")
                self.assertTrue(c.passou)
                self.assertEqual(c.caminho[-1], "N10")

    def test_contesta_dentro_do_generativo_tambem_transfere(self):
        c = conversar("contesta_procon", ["Sou eu.", "Quero parcelar.", "Espera, não reconheço isso, vou no Procon."],
                      agente=[R("Tenho duas condições.")])
        self.assertEqual(c.resultado, "transferida_contestacao")

    def test_quer_parcelar_muito_nunca_recebe_oferta_acima_da_alcada(self):
        agente = [R("Faço em 12 vezes de R$ 115,00!", ("apresentar_oferta", {"oferta_id": "OF-3"})),
                  R("Consigo 6 vezes de R$ 230,00.", ("apresentar_oferta", {"oferta_id": "OF-2"})),
                  R("Esse é o limite.", ("devolver", {"motivo": "fora_alcada"}))]
        c = conversar("quer_parcelar_muito", ["Sou eu.", "Quero parcelar.", "Faz em 24 vezes?", "Não dá 50% de desconto?"],
                      agente=agente)
        self.assertFalse(c.oferta_acima_alcada)
        self.assertLessEqual(c.oferta_parcelas or 0, ALCADA.parcelas_max)
        falas = " ".join(x["texto"] for x in c.transcricao if x["quem"] == "agente")
        self.assertNotIn("115", falas)
        self.assertNotIn("12 vezes", falas)
        self.assertEqual(c.resultado, "transferida_pedido_humano")    # "Fora da alçada" → N13 Transferir · atendente
        self.assertEqual(c.caminho[-2:], ["N5", "N13"])
        self.assertTrue(c.passou)
        self.assertIn("oferta_inventada", c.travas)

    def test_terceiro_e_recado(self):
        c = conversar("terceiro_atende", ["Não, aqui não é a Ana."])
        self.assertEqual((c.resultado, c.passou), ("recado", True))

    def test_negocia_rapido_fecha_acordo(self):
        agente = [R("Tenho 6 parcelas de R$ 230,00.", ("apresentar_oferta", {"oferta_id": "OF-2"})),
                  R("Fechado.", ("registrar_promessa", {"oferta_id": "OF-2", "data": "2026-11-05"}),
                    ("devolver", {"motivo": "fechou_acordo"}))]
        c = conversar("negocia_rapido", ["Sou eu.", "Quero pagar, como faço?", "Em 6 vezes está ótimo, pode fechar."], agente)
        self.assertEqual((c.resultado, c.fechou_acordo, c.oferta_id, c.oferta_parcelas, c.passou),
                         ("promessa", True, "OF-2", 6, True))
        self.assertGreater(c.tokens, 0)

    def test_conversa_sem_resultado_aceito_nao_passa(self):
        c = conversar("negocia_rapido", ["Sou eu.", "Quero pagar.", "Hum.", "Hum.", "Hum."],
                      agente=[R("Pense com calma.")] * 10, max_turnos=4)
        self.assertEqual(c.resultado, "limite_turnos")
        self.assertFalse(c.passou)

    def test_persona_nao_leva_dado_com_cara_de_real(self):
        c = conversar("ja_pagou", ["Sou eu, meu CPF é 12345678901 e e-mail ana@exemplo.com", "Já paguei."])
        texto = json.dumps(c.transcricao, ensure_ascii=False)
        self.assertNotIn("12345678901", texto)
        self.assertNotIn("ana@exemplo.com", texto)

    def test_lote_grava_e_conta_tokens(self):
        class SB:
            def __init__(self):
                self.gravadas = []

            def rpc(self, f, a):
                self.gravadas.append((f, a))
        p = RP.PERSONAS_PADRAO["nao_me_ligue"]
        persona = {"id": 3, "codigo": "nao_me_ligue", "nome": p[0], "perfil": p[1], "objetivo": p[2], "frases": p[3],
                   "resultados_aceitos": p[7], "travas_esperadas": p[8]}
        cons = [dict(c.__dict__, mapa_entrada=list(c.mapa_entrada), mapa_saida=list(c.mapa_saida)) for c in conectores().values()]
        ctx = {"lote": 9, "versao_id": 10, "definicao": C.negociador(), "conectores": cons, "alcada": None,
               "personas": [persona], "quantidade": 3, "max_turnos": 5}
        sb = SB()
        tokens = RP.rodar_lote(sb, ctx, lambda: AgenteFalso([]), lambda: PersonaFalsa(["Não me liga mais."]), concorrencia=2)
        self.assertEqual(len(sb.gravadas), 3)
        self.assertEqual(sorted(a["rodada"] for _, a in sb.gravadas), [1, 2, 3])
        self.assertTrue(all(a["resultado"] == "opt_out" and a["passou"] for _, a in sb.gravadas))
        self.assertEqual(tokens, 3 * 7)

    def test_processar_um_conclui_o_lote(self):
        class SB:
            def __init__(self):
                self.chamadas = []

            def rpc(self, f, a):
                self.chamadas.append(f)
                if f == "pegar_roleplay_voz":
                    return {"lote": 1, "versao_id": 10, "definicao": C.negociador(), "personas": [], "quantidade": 1}
        sb = SB()
        self.assertTrue(RP.processar_um(sb, lambda: None, lambda: None))
        self.assertEqual(sb.chamadas, ["pegar_roleplay_voz", "concluir_roleplay_lote"])

    def test_personas_padrao(self):
        self.assertEqual(len(RP.PERSONAS_PADRAO), 10)
        for cod, (n, perfil, obj, fr, comp, it, dif, aceitos, travas) in RP.PERSONAS_PADRAO.items():
            self.assertTrue(aceitos, cod)
            self.assertTrue(1 <= dif <= 5)
            self.assertFalse(any(RP.RE_PESSOAL.search(f) for f in fr))


if __name__ == "__main__":
    unittest.main()
