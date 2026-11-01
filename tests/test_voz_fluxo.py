"""Executor do fluxo (voz/fluxo.py), conectores (voz/conector.py) e o bloco generativo da Montagem.

Todos os caminhos do protótipo (Negociador): identidade, intenções, falha do CRM levando à alternativa da carteira,
oferta acima da alçada, devolução do generativo, "não me ligue", pedido de humano e senha. As travas são do executor:
os testes usam um LLM falso que tenta furar cada uma. Sem rede; só dados fictícios.
"""
import io
import json
import logging
import unittest
import urllib.error
from datetime import date, datetime

from voz import conector as CN
from voz import fluxo as FX
from voz import fluxo_casos as C
from voz.provedores import montagem as M
from voz.provedores.base import ContextoChamada
from voz.segredos import Dicionario

HOJE = date(2026, 10, 31)
VARS = {"primeiro_nome": "Ana", "assessoria": "Aurora Cobranças", "credor": "Varejo Aurora", "saldo": "1380,00"}
SEGREDO_CORPO = "CORPO-SECRETO-DO-CRM-9f8c"      # aparece na resposta do CRM; nunca pode ir para log

MS_OFERTAS = [{"origem": "$.offers[*].id", "destino": "oferta.id", "grava": "nao"},
              {"origem": "$.offers[*].installments", "destino": "oferta.parcelas", "grava": "nao"},
              {"origem": "$.offers[*].installmentAmount", "destino": "oferta.valor_parcela", "grava": "nao"},
              {"origem": "$.offers[*].discountPct", "destino": "oferta.desconto_pct", "grava": "nao"}]
OFERTAS = {"offers": [{"id": "OF-1", "installments": 1, "installmentAmount": 1104, "discountPct": 20},
                      {"id": "OF-2", "installments": 6, "installmentAmount": 230, "discountPct": 0},
                      {"id": "OF-3", "installments": 12, "installmentAmount": 115, "discountPct": 0}],
           "nota": SEGREDO_CORPO}


def con(i, fin, mapa, exemplo, metodo="GET", em_falha="ramo", **k):
    return CN.Conector(i, 1, f"Conector {i}", fin, metodo, "https://api.crm.exemplo.com.br/v2/clientes/{id_cliente}/x",
                       "bearer", "crm/1/x", ({"origem": "id_cliente", "destino": "id_cliente", "onde": "path"},),
                       tuple(mapa), {}, 2500, k.get("tentativas", 0), k.get("idempotencia", False), em_falha,
                       k.get("situacao", "ativo"), 1, exemplo)


def conectores(ofertas=OFERTAS, match=True):
    return {
        1: con(1, "buscar_ofertas", MS_OFERTAS, ofertas, em_falha="alternativa_carteira"),
        2: con(2, "validar_cadastro", [{"origem": "$.match", "destino": "codigo", "grava": "codigo",
                                        "valores": {"true": "identidade_ok", "false": "identidade_nao_confere"}}],
               {"match": match}, "POST"),
        3: con(3, "registrar_acordo", [{"origem": "$.status", "destino": "codigo", "grava": "codigo",
                                        "valores": {"ok": "acordo_registrado", "no": "acordo_recusado"}}],
               {"status": "ok"}, "POST"),
        4: con(4, "gerar_boleto", [{"origem": "$.paymentUrl", "destino": "link_pagamento", "grava": "nao"},
                                   {"origem": "$.status", "destino": "codigo", "grava": "codigo",
                                    "valores": {"ok": "boleto_gerado"}}],
               {"status": "ok", "paymentUrl": "https://pag.exemplo/abc"}, "POST"),
    }


ALCADA = CN.Alcada(20, 6, 50, 0, 5, ({"id": "AV", "parcelas": 1, "desconto_pct": 20}, {"id": "P6", "parcelas": 6, "desconto_pct": 0}))


def fluxo(definicao=None, cons=None, alcada=ALCADA, **k):
    return FX.FluxoCarregado(10, definicao or C.negociador(), conectores() if cons is None else cons, alcada, **k)


class ModeloFalso:
    """LLM falso: devolve as respostas em ordem e guarda as ferramentas que recebeu."""

    def __init__(self, respostas):
        self.respostas, self.ferramentas = list(respostas), []

    def responder(self, mensagens, ferramentas):
        self.ferramentas.append(ferramentas)
        return self.respostas.pop(0) if self.respostas else M.Resposta("Certo.")


def R(texto="", *chamadas):
    return M.Resposta(texto, list(chamadas))


def simular(falas, f=None, modelo=None, **k):
    return FX.simular(f or fluxo(), falas, VARS, modelo_de=(lambda: modelo) if modelo else None, hoje=HOJE, **k)


ATE_N3 = ["Sou eu", "15 de março"]


class TestCaminhos(unittest.TestCase):
    def test_terceiro_ouve_so_recado_neutro(self):
        r = simular(["Não, é engano"])
        self.assertEqual(r["caminho"], ["N1", "N14"])
        self.assertEqual(r["resultado"], "recado")
        fala = r["turnos"][-1]["falas"][0]["texto"]
        self.assertEqual(fala, "Peço que Ana retorne a ligação para a Aurora Cobranças. Obrigada.")
        self.assertIn("terceiro", r["turnos"][-1]["travas"])

    def test_identidade_pelo_conector(self):
        r = simular(ATE_N3)
        self.assertEqual(r["caminho"], ["N1", "N2", "N3"])
        self.assertIn("1380,00", r["turnos"][-1]["falas"][0]["texto"])       # valor só depois da identidade
        self.assertEqual(r["conectores"][0]["resultado_codigo"], "identidade_ok")

    def test_identidade_nao_confere_duas_vezes(self):
        r = simular(["Sou eu", "15 de março", "16 de março"], f=fluxo(cons=conectores(match=False)))
        self.assertEqual(r["caminho"], ["N1", "N2", "N14"])
        self.assertEqual(r["resultado"], "recado")
        self.assertNotIn("1380", json.dumps(r["turnos"], ensure_ascii=False))

    def test_identidade_conector_fora_vai_para_falha(self):
        r = simular(ATE_N3, falhar={2})
        self.assertEqual(r["caminho"], ["N1", "N2", "N13"])
        self.assertTrue(r["turnos"][-1]["fim"].startswith("transferida"))

    def test_identidade_nunca_pela_ia(self):
        """Sem o conector de validação do CRM a sessão nunca confirma (nem com a cognição dizendo que sim)."""
        d = C.negociador(1, None, 3, 4)
        r = simular(ATE_N3, f=fluxo(d))
        self.assertNotIn("N3", r["caminho"])

    def test_ja_paguei(self):
        r = simular(ATE_N3 + ["Já paguei", "Paguei dia 28/10"])
        self.assertEqual(r["caminho"], ["N1", "N2", "N3", "N8", "N16"])
        self.assertEqual(r["resultado"], "recusa")
        passo_n3 = next(p for p in r["passos"] if p["bloco_id"] == "N3")
        self.assertEqual((passo_n3["intencao"], passo_n3["confianca_faixa"], passo_n3["saida_quando"]),
                         ("ja_paguei", "alta", "ja_paguei"))

    def test_nao_reconheco(self):
        r = simular(ATE_N3 + ["Não reconheço essa dívida"])
        self.assertEqual(r["caminho"][-1], "N10")
        self.assertEqual(r["turnos"][-1]["fim"], "transferida · contestacao")

    def test_sem_dinheiro_agenda_retorno(self):
        r = simular(ATE_N3 + ["Tô sem dinheiro agora", "Me liga sexta às 10h"])
        self.assertEqual(r["caminho"][-2:], ["N9", "N17"])
        self.assertEqual(r["resultado"], "retorno_agendado")

    def test_nao_entendi_duas_vezes_transfere(self):
        r = simular(ATE_N3 + ["hmm", "batata"])
        self.assertEqual(r["caminho"][-1], "N13")

    def test_falha_do_crm_leva_a_oferta_da_carteira(self):
        r = simular(ATE_N3 + ["Quero parcelar", "Aceito"], falhar={1})
        self.assertEqual(r["caminho"], ["N1", "N2", "N3", "N4", "N6", "N7", "N11", "N12"])
        self.assertEqual(r["resultado"], "promessa")
        c1 = next(c for c in r["conectores"] if c["conector_id"] == 1)
        self.assertEqual((c1["classe"], c1["resultado_codigo"]), ("tempo", "falhou"))
        oferta = r["turnos"][3]["falas"][-1]["texto"]
        self.assertIn("R$ 230,00", oferta)                    # 1380 em 6x, da alçada da carteira
        self.assertEqual(r["eventos"].count("fluxo"), 1)

    def test_oferta_do_crm_acima_da_alcada_e_descartada(self):
        modelo = ModeloFalso([R("Tenho duas condições.", ("apresentar_oferta", {"oferta_id": "OF-2"}))])
        r = simular(ATE_N3 + ["Quero parcelar"], modelo=modelo)
        c1 = next(c for c in r["conectores"] if c["conector_id"] == 1)
        self.assertEqual((c1["resultado_codigo"], c1["ofertas_acima_alcada"]), ("ofertas_1_3", 1))
        enum = next(f["function"]["parameters"]["properties"]["oferta_id"]["enum"] for f in modelo.ferramentas[0]
                    if f["function"]["name"] == "apresentar_oferta")
        self.assertEqual(enum, ["OF-1", "OF-2"])                # OF-3 (12x) passa das 6 parcelas da alçada
        self.assertIn("alcada", r["turnos"][-1]["travas"])

    def test_todas_acima_da_alcada_grava_o_codigo(self):
        acima = {"offers": [{"id": "X", "installments": 24, "installmentAmount": 60, "discountPct": 0}]}
        r = simular(ATE_N3 + ["Quero parcelar"], f=fluxo(cons=conectores(ofertas=acima)))
        c1 = next(c for c in r["conectores"] if c["conector_id"] == 1)
        self.assertEqual(c1["resultado_codigo"], "oferta_acima_alcada")
        self.assertEqual(r["caminho"][-2:], ["N15", "N13"])      # nenhuma oferta válida

    def test_generativo_fecha_acordo_e_devolve(self):
        modelo = ModeloFalso([
            R("Tenho à vista por R$ 1.104,00 ou 6 parcelas de R$ 230,00.", ("apresentar_oferta", {"oferta_id": "OF-2"})),
            R("Ótimo: 6 parcelas de R$ 230,00, a primeira em 05/11.",
              ("registrar_promessa", {"oferta_id": "OF-2", "data": "2026-11-05"}), ("devolver", {"motivo": "fechou_acordo"})),
        ])
        r = simular(ATE_N3 + ["Quero parcelar", "Pode fechar em 6 vezes"], modelo=modelo)
        self.assertEqual(r["caminho"], ["N1", "N2", "N3", "N4", "N15", "N5", "N7", "N11", "N12"])
        self.assertEqual(r["resultado"], "promessa")
        self.assertEqual(r["turnos"][-1]["devolucoes"], [{"motivo": "fechou_acordo", "para": "N7"}])
        n5 = next(p for p in r["passos"] if p["bloco_id"] == "N5")
        self.assertEqual((n5["motivo_devolucao"], n5["turnos"]), ("fechou_acordo", 1))

    def test_generativo_devolve_sozinho_na_contestacao(self):
        modelo = ModeloFalso([R("Tenho duas condições.")])
        r = simular(ATE_N3 + ["Quero parcelar", "Não reconheço isso, vou no Procon"], modelo=modelo)
        self.assertEqual(r["caminho"][-2:], ["N5", "N10"])
        self.assertEqual(r["turnos"][-1]["devolucoes"], [{"motivo": "contestou", "para": "N10"}])

    def test_generativo_numero_fora_das_ofertas_vira_fala_fixa(self):
        modelo = ModeloFalso([R("Posso fazer 10 parcelas de R$ 138,00!")])
        r = simular(ATE_N3 + ["Quero parcelar"], modelo=modelo)
        fala = r["turnos"][-1]["falas"][-1]["texto"]
        self.assertNotIn("138", fala)
        self.assertIn("alcada", r["turnos"][-1]["travas"])

    def test_generativo_oferta_inventada_e_ignorada(self):
        modelo = ModeloFalso([R("Certo.", ("apresentar_oferta", {"oferta_id": "OF-99"}))])
        r = simular(ATE_N3 + ["Quero parcelar"], modelo=modelo)
        self.assertIn("oferta_inventada", r["turnos"][-1]["travas"])

    def test_generativo_que_pede_senha_e_cortado(self):
        modelo = ModeloFalso([R("Para confirmar, me passe a senha do cartão.")])
        r = simular(ATE_N3 + ["Quero parcelar"], modelo=modelo)
        self.assertEqual(r["turnos"][-1]["falas"][-1]["texto"], M.FIXA_SENHA)

    def test_generativo_limite_de_turnos_transfere(self):
        d = C.negociador()
        next(b for b in d["blocos"] if b["id"] == "N5")["params"]["max_turnos"] = 1
        modelo = ModeloFalso([R("Tenho condições."), R("Pense com calma.")])
        r = simular(ATE_N3 + ["Quero parcelar", "Vou pensar"], f=fluxo(d), modelo=modelo)
        self.assertEqual(r["turnos"][-1]["fim"], "transferida · pedido_humano")

    def test_nao_me_ligue_em_qualquer_etapa(self):
        for n in range(0, 3):
            falas = (ATE_N3 + ["Quero parcelar"])[:n] + ["Não me liga mais, por favor"]
            r = simular(falas, modelo=ModeloFalso([R("Tenho condições.")]))
            with self.subTest(etapa=n):
                self.assertEqual(r["resultado"], "opt_out")
                self.assertIn("nao_me_ligue", r["turnos"][-1]["travas"])
                self.assertEqual(r["eventos"][-1], "encerrar")

    def test_pedido_de_humano_a_qualquer_momento(self):
        r = simular(ATE_N3 + ["Quero parcelar", "Quero falar com uma pessoa"], modelo=ModeloFalso([R("Oi.")]))
        self.assertEqual(r["turnos"][-1]["fim"], "transferida · pedido_humano")
        self.assertIn("pedido_humano", r["turnos"][-1]["travas"])

    def test_senha_oferecida_pela_pessoa(self):
        r = simular(ATE_N3 + ["Minha senha é 1234"])
        self.assertEqual(r["turnos"][-1]["falas"][0]["texto"], FX.FALA_SENHA)
        self.assertFalse(r["encerrada"])
        self.assertEqual(r["caminho"][-1], "N3")                 # continua na etapa

    def test_valor_antes_da_identidade_e_cortado_na_fala(self):
        """Mesmo que um fluxo escape do validador, a fala com valor sem identidade vira o recado neutro."""
        s = FX.Sessao(fluxo(), "c1", "CLI-1", VARS, lambda *a: None, CN.ConectoresDeExemplo(), hoje=HOJE)
        fala, trava = s.render("Consta {{saldo}} com {{credor}}.")
        self.assertEqual(trava, "valor_antes_identidade")
        self.assertNotIn("1380", fala)
        s.identidade_confirmada = True
        self.assertIn("1380", s.render("Consta {{saldo}}.")[0])

    def test_fluxo_invalido_nao_roda(self):
        d = C.negociador()
        next(b for b in d["blocos"] if b["id"] == "N1")["params"]["fala"] = "Consta {{saldo}}. Falo com {{primeiro_nome}}?"
        with self.assertRaises(FX.FluxoInvalido):
            FX.Sessao(fluxo(d), "c1", "CLI-1", VARS, lambda *a: None, CN.ConectoresDeExemplo())

    def test_repeticao_acima_do_limite_transfere(self):
        d = C.negociador()
        n9 = next(b for b in d["blocos"] if b["id"] == "N9")
        n9["repetir_max"] = 1
        next(s for s in n9["saidas"] if s["quando"] == "nao_agendou")["para"] = "N3"
        r = simular(ATE_N3 + ["sem dinheiro", "não sei", "não sei", "sem dinheiro"], f=fluxo(d))
        self.assertEqual(r["turnos"][-1]["fim"], "transferida · pedido_humano")
        self.assertEqual(r["passos"][-1]["trava"], "repeticao")

    def test_passos_so_com_codigos(self):
        r = simular(ATE_N3 + ["Já paguei", "Paguei dia 28/10"])
        chaves = {"ordem", "bloco_id", "modo", "fluxo_versao_id", "entrou_em", "saida_quando", "intencao",
                  "confianca_faixa", "motivo_devolucao", "trava", "turnos"}
        for p in r["passos"]:
            self.assertLessEqual(set(p), chaves)
        self.assertEqual([p["ordem"] for p in r["passos"]], [1, 2, 3, 4, 5])
        self.assertNotIn("Paguei", json.dumps(r["passos"]))

    def test_memoria_do_crm_some_no_fim(self):
        s = FX.Sessao(fluxo(), "c1", "CLI-1", VARS, lambda *a: None, CN.ConectoresDeExemplo(), hoje=HOJE)
        s.comecar()
        for f in ATE_N3 + ["Quero parcelar", "Aceito"]:
            s.ouvir(f)
        self.assertTrue(s.encerrada)
        self.assertEqual((s.memoria, s.ofertas, s.oferta_atual), ({}, [], None))


# ------------------------------------------------------------------ cliente HTTP do conector
class _Resp:
    def __init__(self, status, corpo):
        self.status, self._c = status, corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode()

    def read(self, n=-1):
        return self._c if n < 0 else self._c[:n]

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestConector(unittest.TestCase):
    def cliente(self, respostas, segredos=None):
        self.pedidos = []
        resp = list(respostas)

        def abrir(req, timeout, ctx):
            self.pedidos.append((req, timeout))
            r = resp.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        return CN.ClienteConectores(segredos or Dicionario({"crm/1/x": "tok-123"}),
                                    {1: {"api.crm.exemplo.com.br"}}, abrir=abrir, dormir=lambda s: None)

    def test_get_com_novas_tentativas_e_mapa_de_saida(self):
        c = self.cliente([urllib.error.HTTPError("u", 503, "x", {}, io.BytesIO(SEGREDO_CORPO.encode())),
                          _Resp(200, OFERTAS)])
        r = c.chamar(con(1, "buscar_ofertas", MS_OFERTAS, None, tentativas=1), {"id_cliente": "CLI 1"}, "ch:N4")
        self.assertEqual((r.classe, r.tentativa, r.http_status), ("ok", 2, 200))
        self.assertEqual([o["id"] for o in r.ofertas], ["OF-1", "OF-2", "OF-3"])
        req, timeout = self.pedidos[0]
        self.assertEqual(req.full_url, "https://api.crm.exemplo.com.br/v2/clientes/CLI%201/x")
        self.assertEqual(req.get_header("Authorization"), "Bearer tok-123")
        self.assertEqual(timeout, 2.5)

    def test_post_so_repete_com_idempotencia(self):
        c = self.cliente([CN.ErroConector("tempo"), _Resp(200, {"status": "ok"})])
        r = c.chamar(con(3, "registrar_acordo", [], None, "POST", tentativas=1), {"id_cliente": "C1"}, "ch:N7")
        self.assertEqual((r.classe, len(self.pedidos)), ("tempo", 1))
        c = self.cliente([CN.ErroConector("tempo"), _Resp(200, {"status": "ok"})])
        r = c.chamar(con(3, "registrar_acordo", [], None, "POST", tentativas=1, idempotencia=True), {"id_cliente": "C1"}, "ch:N7")
        self.assertEqual((r.classe, len(self.pedidos)), ("ok", 2))
        self.assertEqual(self.pedidos[0][0].get_header("Idempotency-key"), "ch:N7")

    def test_host_nao_liberado_e_conector_inativo_sao_recusados(self):
        c = self.cliente([])
        outro = CN.Conector(9, 1, "x", "outro", "GET", "https://interno.local/x", "bearer", "crm/1/x")
        self.assertEqual(c.chamar(outro, {}, "k").classe, "recusado")
        self.assertEqual(c.chamar(con(1, "buscar_ofertas", [], None, situacao="pausado"), {"id_cliente": "C"}, "k").classe,
                         "recusado")
        self.assertEqual(self.pedidos, [])

    def test_campo_de_entrada_ausente_recusa(self):
        c = self.cliente([])
        self.assertEqual(c.chamar(con(1, "buscar_ofertas", [], None), {}, "k").classe, "recusado")

    def test_resposta_grande_ou_fora_de_json(self):
        c = self.cliente([_Resp(200, b"x" * (CN.MAX_RESPOSTA + 10)), _Resp(200, b"<html>")])
        self.assertEqual(c.chamar(con(1, "buscar_ofertas", [], None), {"id_cliente": "C"}, "k").classe, "mapa_invalido")
        self.assertEqual(c.chamar(con(1, "buscar_ofertas", [], None), {"id_cliente": "C"}, "k").classe, "mapa_invalido")

    def test_http_4xx(self):
        c = self.cliente([urllib.error.HTTPError("u", 401, "x", {}, io.BytesIO(SEGREDO_CORPO.encode()))])
        r = c.chamar(con(1, "buscar_ofertas", [], None, tentativas=2), {"id_cliente": "C"}, "k")
        self.assertEqual((r.classe, r.http_status, len(self.pedidos)), ("http_4xx", 401, 1))

    def test_oauth2_token_em_cache(self):
        seg = Dicionario({"crm/1/x": json.dumps({"token_url": "https://api.crm.exemplo.com.br/oauth/token",
                                                  "client_id": "id", "client_secret": "s"})})
        c = self.cliente([_Resp(200, {"access_token": "AT", "expires_in": 3600}), _Resp(200, {}), _Resp(200, {})], seg)
        k = con(1, "buscar_ofertas", [], None)
        k = CN.Conector(**{**k.__dict__, "autenticacao": "oauth2_cc"})
        c.chamar(k, {"id_cliente": "C"}, "a")
        c.chamar(k, {"id_cliente": "C"}, "b")
        self.assertEqual(len(self.pedidos), 3)                 # um token, duas chamadas
        self.assertEqual(self.pedidos[2][0].get_header("Authorization"), "Bearer AT")

    def test_nenhum_corpo_em_log(self):
        """A resposta do CRM (com um marcador) passa por todos os caminhos e nunca aparece em log nem em repr."""
        buf = io.StringIO()
        h = logging.StreamHandler(buf)
        h.setLevel(logging.DEBUG)
        logs = [logging.getLogger(n) for n in ("", "motorcx", "motorcx.voz", "motorcx.voz.conector", "motorcx.voz.fluxo")]
        antes = [l.level for l in logs]
        for l in logs:
            l.addHandler(h)
            l.setLevel(logging.DEBUG)
        try:
            c = self.cliente([
                _Resp(200, OFERTAS),
                urllib.error.HTTPError("u", 500, SEGREDO_CORPO, {}, io.BytesIO(SEGREDO_CORPO.encode())),
                _Resp(200, SEGREDO_CORPO.encode()),
                ValueError(SEGREDO_CORPO),
            ])
            reps = [c.chamar(con(1, "buscar_ofertas", MS_OFERTAS, None), {"id_cliente": "C"}, "k") for _ in range(4)]
            s = FX.Sessao(fluxo(cons={**conectores(), 1: con(1, "buscar_ofertas", MS_OFERTAS, OFERTAS)}), "c1", "CLI",
                          VARS, lambda *a: logging.getLogger("x").info("evento %s", a), CN.ConectoresDeExemplo(), hoje=HOJE)
            s.comecar()
            for f in ATE_N3 + ["Quero parcelar"]:
                s.ouvir(f)
        finally:
            for l, nivel in zip(logs, antes):
                l.removeHandler(h)
                l.setLevel(nivel)
        texto = buf.getvalue() + " ".join(repr(r) for r in reps)
        self.assertIn("classe=ok", texto)
        self.assertNotIn(SEGREDO_CORPO, texto)
        self.assertNotIn("OF-1", texto)
        self.assertNotIn("1104", texto)

    def test_filtro_da_alcada(self):
        boas, fora = CN.filtrar_ofertas([{"id": "a", "parcelas": 6, "valor_parcela": 230, "desconto_pct": 0},
                                         {"id": "b", "parcelas": 1, "desconto_pct": 30},
                                         {"id": "c", "parcelas": 3, "valor_parcela": 20},
                                         {"parcelas": 2}], ALCADA)
        self.assertEqual(([o["id"] for o in boas], fora), (["a"], 3))
        self.assertEqual(CN.filtrar_ofertas([{"id": "a", "parcelas": 1}], None), ([], 1))   # sem alçada nada passa
        self.assertEqual(CN.codigo_ofertas(0, 2), "oferta_acima_alcada")


# ------------------------------------------------------------------ Montagem com fluxo
class TestMontagemFluxo(unittest.TestCase):
    def test_montagem_roda_o_fluxo_e_emite_no_tick(self):
        ev = []
        cfg = M.ConfigMontagem(portas=(40000, 40003), max_sessoes=5, host_midia="127.0.0.1")
        mt = M.Montagem(cfg, Dicionario({}), lambda ctx: ("x" * 60, "Alô?"), modelo_de=lambda: ModeloFalso([]),
                        executor=lambda s: None, fluxo_de=lambda ctx: fluxo(), conectores=CN.ConectoresDeExemplo(),
                        entendedor_de=FX.EntendedorRegras)
        ctx = ContextoChamada(id_chamada="ch-1", empresa_id=1, id_cliente="CLI-1", credor_id=5, variaveis=VARS)
        mt.iniciar(ctx, lambda *a: ev.append(a))
        s = mt.sessoes["ch-1"].conversa
        self.assertIsInstance(s, FX.Sessao)
        self.assertEqual(s.comecar(), ["Olá, aqui é a central da Aurora Cobranças. Falo com Ana?"])
        s.ouvir("Não, é engano")
        self.assertEqual(ev, [])                                 # só no tick (thread do orquestrador)
        mt.tick(datetime(2026, 10, 31, 10))
        self.assertEqual([e[1] for e in ev], ["passo", "passo", "resultado", "fluxo", "encerrar"])
        mt.encerrar("ch-1")
        self.assertEqual(s.memoria, {})

    def test_sem_fluxo_cai_no_roteiro(self):
        cfg = M.ConfigMontagem(portas=(40000, 40003))
        mt = M.Montagem(cfg, Dicionario({}), lambda ctx: ("Roteiro " + "x" * 50, "Alô?"),
                        modelo_de=lambda: ModeloFalso([]), executor=lambda s: None, fluxo_de=lambda ctx: None)
        mt.iniciar(ContextoChamada(id_chamada="ch-2", empresa_id=1, id_cliente="C"), lambda *a: None)
        self.assertIsInstance(mt.sessoes["ch-2"].conversa, M.Conversa)

    def test_ferramentas_por_bloco_com_enum(self):
        f = M.ferramentas_do_bloco(["apresentar_oferta", "transferir_humano"], [{"id": "OF-2"}], ["fechou_acordo"])
        nomes = [x["function"]["name"] for x in f]
        self.assertEqual(nomes, ["devolver", "transferir_humano", "apresentar_oferta"])
        self.assertEqual(f[0]["function"]["parameters"]["properties"]["motivo"]["enum"], ["fechou_acordo"])

    def test_carregador_cache_por_versao(self):
        class SB:
            n = 0

            def rpc(self, f, a):
                SB.n += 1
                if f == "fluxo_voz_em_uso":
                    return [{"versao_id": 10, "hash": "h1", "definicao": C.negociador()}]
                return [{"id": 1, "desconto_max_pct": 20, "parcelas_max": 6, "parcela_min": 50, "ofertas_padrao": []}]

            def selecionar(self, t, filtros=None, **k):
                return {"crm_conectores": [], "crm_hosts_permitidos": [{"host": "api.crm.exemplo.com.br"}]}.get(t, [])
        car = FX.CarregadorFluxos(SB(), ttl_s=60, relogio=lambda: 0)
        ctx = ContextoChamada(id_chamada="a", empresa_id=1, id_cliente="C", credor_id=5)
        f1, f2 = car(ctx), car(ctx)
        self.assertIs(f1, f2)
        self.assertEqual((f1.versao_id, f1.alcada.parcelas_max, f1.hosts), (10, 6, ("api.crm.exemplo.com.br",)))
        self.assertEqual(SB.n, 2)                               # em uso + alçada, uma vez só


class TestRegistroFluxo(unittest.TestCase):
    def test_passos_e_conectores_vao_para_as_tabelas(self):
        from voz.registro import RegistroBanco

        class SB:
            def __init__(self):
                self.gravou = []

            def inserir(self, t, linhas, conflito=None):
                self.gravou.append((t, linhas, conflito))
        sb = SB()
        reg = RegistroBanco(sb)
        r = simular(ATE_N3 + ["Já paguei", "Paguei dia 28/10"])
        for p in r["passos"]:
            reg.registrar_fluxo(1, "ch-0001", "passo", p)
        for c in r["conectores"]:
            reg.registrar_fluxo(1, "ch-0001", "conector", c)
        reg.descarregar()
        tabelas: dict = {}
        for t, linhas, c in sb.gravou:
            # cada insert com as mesmas chaves em todos os objetos (o PostgREST recusa lote misturado: PGRST102)
            self.assertEqual(len({tuple(sorted(x)) for x in linhas}), 1, t)
            tabelas.setdefault(t, ([], c))[0].extend(linhas)
        self.assertEqual(len(tabelas["voz_fluxo_passos"][0]), 5)
        self.assertEqual(sorted(x["ordem"] for x in tabelas["voz_fluxo_passos"][0]), [1, 2, 3, 4, 5])
        self.assertEqual(tabelas["voz_fluxo_passos"][1], "empresa_id,id_chamada,ordem")
        self.assertEqual(tabelas["crm_chamadas"][0][0]["resultado_codigo"], "identidade_ok")
        self.assertNotIn("nome", tabelas["crm_chamadas"][0][0])
        self.assertEqual(reg.fila_passos + reg.fila_conectores, [])


if __name__ == "__main__":
    unittest.main()
