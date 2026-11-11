"""Treino de operadores por VOZ (voz/treino_voz.py, SQL 119): bilhete, conversa por voz, fim e resultado assinado.

Sem Pipecat e sem rede: o WebSocket é falso (filas), o pipeline é falso (o "áudio" que chega é o texto já transcrito) e
o LLM é falso. Cobre:
- o bilhete da Edge Function: assinatura (o mesmo vetor do teste da Edge Function), validade curta, conteúdo, uso único;
- a conversa: a fala do operador volta mascarada para a tela e para a transcrição; a cliente atende primeiro; LLM fora
  numa fala → "pode repetir?"; 3 seguidas → falha (não conta);
- o fim: encerrar avalia pelo checklist e manda o resultado assinado (voz_registrar) com minutos de STT, caracteres de
  TTS e a transcrição (nunca o áudio); sair sem falar = sem uso; sair com fala = abandonada; rede/microfone = falhou;
  tempo e franquia encerram e avaliam; a cliente desliga → "desligou" e avalia; mudo segura o áudio;
- o servidor: origem fora da lista, bilhete inválido ou repetido e capacidade cheia são recusados.
"""
import asyncio
import json
import time
import unittest

from voz import treino_voz as TV
from voz.provedores.montagem import Resposta

CHAVE = "chave-de-teste"
CEN = {"persona_nome": "Rita (fictícia)", "perfil": "ja_pagou", "objetivo": "Diz que já pagou.", "comportamentos": [],
       "frases": ["Mas eu já paguei!"], "objecoes": [], "dificuldade": 2, "divida": {"faixa": "1k_5k", "dias_atraso": 30}}
ITENS = [{"id": "ck_ident", "texto": "Se identificou", "gravidade": "importante", "peso": 1, "aplica": "ambos", "on": True},
         {"id": "ck_cpc", "texto": "Confirmou a identidade", "gravidade": "bloqueante", "peso": 2, "aplica": "ambos", "on": True}]


def bilhete(**kw) -> dict:
    d = {"v": 1, "sessao": 41, "exp": int(time.time()) + 60, "limite_s": 480, "cenario": CEN,
         "checklist": {"versao_id": 3, "itens": ITENS}, "voz": None, "por_franquia": False}
    d.update(kw)
    return d


def analise(itens: dict) -> dict:
    return {"itens": [{"id": k, "resposta": v[0], "confianca": 0.9, "segmento": v[1]} for k, v in itens.items()],
            "motivo": {"probabilidades": {}, "segmento": None}, "objecoes": [], "objecao_principal": None, "intencao": None,
            "canal_preferido": None, "horario_preferido": None, "vulnerabilidade": [], "riscos": [], "frases": [],
            "temas": [], "sentimento": None, "falantes": "CACA", "transcricao_ruim": 0}


class LLM:
    """Responde pela ferramenta pedida: sem ferramenta = fala da cliente; entregar_analise/entregar_dicas = avaliação."""

    def __init__(self, falas=("Alô?", "Mas eu já paguei!", "Tá bom, tchau. [DESLIGA]"), falhar=0):
        self.falas, self.falhar, self.timeout, self.pedidos = list(falas), falhar, 15, []

    def responder(self, mensagens, ferramentas):
        self.pedidos.append((mensagens, ferramentas))
        nomes = [f["function"]["name"] for f in ferramentas]
        if "entregar_analise" in nomes:
            return Resposta("", chamadas=[("entregar_analise", analise({"ck_ident": ("sim", 1), "ck_cpc": ("nao", 1)}))],
                            tokens_entrada=50, tokens_saida=10)
        if "entregar_dicas" in nomes:
            return Resposta("", chamadas=[("entregar_dicas", {"dicas": [{"item": "ck_cpc", "dica": "Confirme com quem fala."}]})], tokens=7)
        if self.falhar:
            self.falhar -= 1
            raise RuntimeError("LLM HTTP 503")
        return Resposta(self.falas.pop(0) if self.falas else "Hum.", tokens=5)


class WS:
    def __init__(self):
        self.entrada: asyncio.Queue = asyncio.Queue()
        self.saidas: list = []
        self.fechado = False

    async def recv(self):
        return await self.entrada.get()

    def __aiter__(self):
        return self

    async def __anext__(self):
        m = await self.entrada.get()
        if m is None:
            raise StopAsyncIteration
        return m

    async def send(self, m):
        self.saidas.append(m)

    async def close(self):
        self.fechado = True

    def json(self):
        return [json.loads(m) for m in self.saidas if isinstance(m, str)]

    def tipos(self):
        return [m["tipo"] for m in self.json()]


class Relogio:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


async def pipeline_falso(ponte, conversa, stt, tts, parar, ao_parcial):
    """O "áudio" que chega é o texto transcrito (b"FALA:..."): parcial para a tela, fala final para a cliente."""
    loop = asyncio.get_running_loop()

    def ao_audio(pcm: bytes):
        if pcm.startswith(b"FALA:"):
            texto = pcm[5:].decode()
            ao_parcial(texto[:10])

            async def responder():
                ponte.interromper()
                for f in await asyncio.to_thread(conversa.ouvir, texto):
                    ponte.falar(b"\x00\x00" * len(f))
            asyncio.ensure_future(responder(), loop=loop)
    ponte.ao_audio = ao_audio
    for f in await asyncio.to_thread(conversa.comecar):
        ponte.falar(b"\x00\x00" * 100)
    await parar.wait()


def fala(t: str) -> bytes:
    b = ("FALA:" + t).encode()
    return b + (b" " if len(b) % 2 else b"")


class Base(unittest.IsolatedAsyncioTestCase):
    def deps(self, llm=None, relogio=None):
        self.registros = []
        self.llm = llm or LLM()
        self.relogio = relogio or Relogio()

        def retorno(sessao, dados, sem_fala):
            self.registros.append((sessao, dados, sem_fala))
            return "abandonada" if sem_fala else dados["situacao"]
        return TV.Deps(modelo_de=lambda: self.llm, servicos_de=lambda voz: ("stt", "tts"), pipeline=pipeline_falso,
                       retorno=retorno, relogio=self.relogio)

    async def esperar(self, ws, tipo, n=1, limite=3.0):
        fim = time.monotonic() + limite
        while sum(1 for x in ws.tipos() if x == tipo) < n:
            if time.monotonic() > fim:
                self.fail(f"não chegou {tipo}: {ws.tipos()}")
            await asyncio.sleep(0.01)

    async def falar(self, ws, texto, n):
        await ws.entrada.put(fala(texto))
        await self.esperar(ws, "fala", n)


class TestBilhete(unittest.TestCase):
    def test_vetor_compartilhado_com_a_edge_function(self):
        # o mesmo vetor está em supabase/functions/treino/regras.test.ts (criarBilhete)
        self.assertEqual(TV.criar_bilhete("k", {"v": 1, "sessao": 7}),
                         "eyJ2IjoxLCJzZXNzYW8iOjd9.f86bf7fd81a1e59d676550973f8b9a2c25bc7c332974ffd526f91e9792ea62d1")

    def test_confere_assinatura_validade_e_conteudo(self):
        agora = time.time()
        ok = TV.criar_bilhete(CHAVE, bilhete())
        self.assertEqual(TV.ler_bilhete(CHAVE, ok, agora)["sessao"], 41)
        self.assertIsNone(TV.ler_bilhete("outra", ok, agora), "assinatura com outra chave")
        corpo, assin = ok.split(".")
        self.assertIsNone(TV.ler_bilhete(CHAVE, corpo + "x." + assin, agora), "corpo trocado")
        self.assertIsNone(TV.ler_bilhete(CHAVE, TV.criar_bilhete(CHAVE, bilhete(exp=int(agora) - 1)), agora), "vencido")
        self.assertIsNone(TV.ler_bilhete(CHAVE, TV.criar_bilhete(CHAVE, bilhete(exp=int(agora) + 3600)), agora), "validade longa demais")
        self.assertIsNone(TV.ler_bilhete(CHAVE, TV.criar_bilhete(CHAVE, bilhete(limite_s=5000)), agora), "limite fora")
        self.assertIsNone(TV.ler_bilhete(CHAVE, TV.criar_bilhete(CHAVE, bilhete(sessao=True)), agora))
        self.assertIsNone(TV.ler_bilhete(CHAVE, TV.criar_bilhete(CHAVE, bilhete(cenario={})), agora), "sem cenário")
        self.assertIsNone(TV.ler_bilhete(CHAVE, TV.criar_bilhete(CHAVE, bilhete(voz="../x")), agora), "voz fora do formato")
        self.assertIsNone(TV.ler_bilhete(CHAVE, None, agora))
        self.assertIsNone(TV.ler_bilhete(CHAVE, "a.b.c", agora))

    def test_uso_unico(self):
        u = TV.Usados()
        self.assertTrue(u.marcar(41, 100, 50))
        self.assertFalse(u.marcar(41, 100, 60))
        self.assertTrue(u.marcar(42, 100, 60))

    def test_resultado_assinado_para_a_edge_function(self):
        pedidos = []

        class R:
            def __init__(self, corpo):
                self.corpo = corpo

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return self.corpo

        def abrir(req, timeout):
            pedidos.append(req)
            return R(b'{"situacao": "avaliada"}')
        s = TV.enviar_resultado("https://x.supabase.co/functions/v1/treino", CHAVE, 41, {"situacao": "avaliada"}, False,
                                abrir=abrir, relogio=lambda: 1700000000)
        self.assertEqual(s, "avaliada")
        req = pedidos[0]
        corpo = req.data
        self.assertEqual(json.loads(corpo)["acao"], "voz_registrar")
        self.assertEqual(req.get_header("X-motorcx-carimbo"), "1700000000")
        self.assertEqual(req.get_header("X-motorcx-assinatura"), TV.assinatura_http(CHAVE, "1700000000", corpo))

    def test_resultado_nao_entregue_tenta_de_novo_e_devolve_none(self):
        n = []

        def abrir(req, timeout):
            n.append(1)
            raise OSError("rede")
        self.assertIsNone(TV.enviar_resultado("https://x", CHAVE, 1, {}, True, abrir=abrir))
        self.assertEqual(len(n), 2)


class TestSessao(Base):
    async def test_ciclo_encerrar_avalia_e_registra_sem_audio(self):
        ws = WS()
        s = TV.SessaoVoz(ws, bilhete(), self.deps())
        t = asyncio.ensure_future(s.rodar(passo=0.01))
        await self.esperar(ws, "fala", 1)
        self.assertEqual(ws.json()[1], {"tipo": "fala", "quem": "persona", "texto": "Alô?", "t": 0})
        self.relogio.t += 4
        await self.falar(ws, "Boa tarde, meu CPF é 123.456.789-09 e o telefone 11987654321", 3)
        op = [m for m in ws.json() if m["tipo"] == "fala" and m["quem"] == "operador"][0]
        self.assertNotIn("123.456.789-09", op["texto"])
        self.assertNotIn("11987654321", op["texto"])
        self.assertIn("parcial", ws.tipos())
        self.assertIn("interromper", ws.tipos())
        self.assertTrue(any(isinstance(m, bytes) for m in ws.saidas), "a voz da cliente vai em binário")
        self.relogio.t += 60
        await ws.entrada.put(json.dumps({"tipo": "encerrar"}))
        self.assertEqual(await asyncio.wait_for(t, 3), "avaliada")
        self.assertIn("avaliando", ws.tipos())
        self.assertEqual(ws.json()[-1]["tipo"], "fim")
        self.assertEqual(ws.json()[-1]["situacao"], "avaliada")
        self.assertTrue(ws.fechado)
        sessao, d, sem_fala = self.registros[0]
        self.assertEqual((sessao, sem_fala, d["situacao"], d["duracao_s"]), (41, False, "avaliada", 64))
        self.assertEqual(d["minutos_stt"], 1.07)
        self.assertEqual(d["caracteres_tts"], len("Alô?") + len("Mas eu já paguei!"))
        self.assertEqual(d["itens"], {"ck_ident": "sim", "ck_cpc": "nao"})
        self.assertTrue(d["reprovada"])
        self.assertEqual([x["quem"] for x in d["transcricao"]], ["persona", "operador", "persona"])
        self.assertNotIn("11987654321", json.dumps(d))
        self.assertNotIn("audio", d)

    async def test_sair_antes_de_falar_e_sem_uso(self):
        ws = WS()
        t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(), self.deps()).rodar(passo=0.01))
        await self.esperar(ws, "fala", 1)
        await ws.entrada.put(json.dumps({"tipo": "sair"}))
        self.assertEqual(await asyncio.wait_for(t, 3), "abandonada")
        self.assertTrue(self.registros[0][2], "sem fala do operador: sem uso")
        self.assertEqual(ws.json()[-1]["motivo"], "sem_fala")
        self.assertNotIn("avaliando", ws.tipos())

    async def test_sair_com_fala_e_abandonada_com_uso(self):
        ws = WS()
        t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(), self.deps()).rodar(passo=0.01))
        await self.esperar(ws, "fala", 1)
        await self.falar(ws, "Boa tarde", 3)
        await ws.entrada.put(json.dumps({"tipo": "sair"}))
        self.assertEqual(await asyncio.wait_for(t, 3), "abandonada")
        _, d, sem_fala = self.registros[0]
        self.assertFalse(sem_fala)
        self.assertEqual(d["situacao"], "abandonada")
        self.assertNotIn("transcricao", d)

    async def test_rede_caiu_e_microfone_nao_contam(self):
        for fim, motivo in ((None, "rede"), (json.dumps({"tipo": "microfone"}), "microfone")):
            ws = WS()
            t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(), self.deps()).rodar(passo=0.01))
            await self.esperar(ws, "fala", 1)
            await self.falar(ws, "Boa tarde", 3)
            await ws.entrada.put(fim)
            self.assertEqual(await asyncio.wait_for(t, 3), "falhou")
            self.assertEqual(self.registros[0][1], {"situacao": "falhou", "motivo_falha": motivo, "duracao_s": 0, "tokens": 10})

    async def test_tempo_e_franquia_encerram_e_avaliam(self):
        for por_franquia, motivo in ((False, "tempo"), (True, "franquia")):
            ws = WS()
            t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(limite_s=30, por_franquia=por_franquia), self.deps()).rodar(passo=0.01))
            await self.esperar(ws, "fala", 1)
            await self.falar(ws, "Boa tarde", 3)
            self.relogio.t += 31
            self.assertEqual(await asyncio.wait_for(t, 3), "avaliada")
            self.assertEqual(ws.json()[-1]["motivo"], motivo)

    async def test_cliente_desliga_avisa_e_avalia(self):
        ws = WS()
        t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(), self.deps()).rodar(passo=0.01))
        await self.esperar(ws, "fala", 1)
        await self.falar(ws, "Boa tarde", 3)
        await self.falar(ws, "Pode pagar amanhã?", 5)
        self.relogio.t += 10                    # depois de a despedida tocar
        self.assertEqual(await asyncio.wait_for(t, 3), "avaliada")
        self.assertIn("desligou", ws.tipos())
        self.assertEqual(ws.json()[-1]["motivo"], "desligou")
        self.assertNotIn("[DESLIGA]", json.dumps(ws.json()))

    async def test_silencio_de_20s_encerra(self):
        ws = WS()
        t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(), self.deps()).rodar(passo=0.01))
        await self.esperar(ws, "fala", 1)
        self.relogio.t += 25
        self.assertEqual(await asyncio.wait_for(t, 3), "abandonada", "sem fala do operador: sem uso")

    async def test_mudo_segura_o_audio_e_o_silencio(self):
        ws = WS()
        t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(), self.deps()).rodar(passo=0.01))
        await self.esperar(ws, "fala", 1)
        await ws.entrada.put(json.dumps({"tipo": "mudo", "ligado": True}))
        await asyncio.sleep(0.05)
        await ws.entrada.put(fala("isto não pode chegar"))
        self.relogio.t += 25
        await asyncio.sleep(0.1)
        self.assertNotIn("parcial", ws.tipos(), "com mudo o áudio não vai para o STT")
        self.assertFalse(t.done(), "com mudo o silêncio não encerra")
        await ws.entrada.put(json.dumps({"tipo": "sair"}))
        await asyncio.wait_for(t, 3)

    async def test_llm_fora_pede_para_repetir_e_tres_seguidas_falham(self):
        ws = WS()
        llm = LLM(falas=("Alô?",), falhar=0)
        t = asyncio.ensure_future(TV.SessaoVoz(ws, bilhete(), self.deps(llm)).rodar(passo=0.01))
        await self.esperar(ws, "fala", 1)
        llm.falhar = 1
        await self.falar(ws, "Boa tarde", 2)
        self.assertEqual([m for m in ws.json() if m["tipo"] == "fala"][-1]["texto"], TV.FALLBACK_FALA)
        llm.falhar = 3
        for _ in range(3):
            await ws.entrada.put(fala("Alô"))
            await asyncio.sleep(0.05)
        self.assertEqual(await asyncio.wait_for(t, 3), "falhou")
        self.assertEqual(ws.json()[-1]["motivo"], "servico")


class TestServidor(Base):
    async def test_recusas(self):
        srv = TV.Servidor(CHAVE, self.deps(), origens=("https://motorcob.online",))
        ws = WS()
        self.assertIsNone(await srv.atender(ws, "https://outro.exemplo"))
        self.assertEqual(ws.json()[0]["erro"], "origem não permitida")
        ws = WS()
        await ws.entrada.put(json.dumps({"bilhete": "x.y"}))
        self.assertIsNone(await srv.atender(ws, "https://motorcob.online"))
        self.assertIn("Bilhete inválido", ws.json()[0]["erro"])
        srv.ativas = srv.max_sessoes
        ws = WS()
        self.assertIsNone(await srv.atender(ws, "https://motorcob.online"))
        self.assertIn("cheio", ws.json()[0]["erro"])

    async def test_abre_uma_vez_por_sessao(self):
        srv = TV.Servidor(CHAVE, self.deps(), origens=("https://motorcob.online",))
        b = TV.criar_bilhete(CHAVE, bilhete(sessao=77))
        ws = WS()
        await ws.entrada.put(json.dumps({"bilhete": b}))
        t = asyncio.ensure_future(srv.atender(ws, "https://motorcob.online"))
        await self.esperar(ws, "fala", 1)
        self.assertEqual(srv.ativas, 1)
        ws2 = WS()
        await ws2.entrada.put(json.dumps({"bilhete": b}))
        self.assertIsNone(await srv.atender(ws2, "https://motorcob.online"))
        self.assertIn("já foi aberta", ws2.json()[0]["erro"])
        await ws.entrada.put(json.dumps({"tipo": "sair"}))
        self.assertEqual(await asyncio.wait_for(t, 3), "abandonada")
        self.assertEqual(srv.ativas, 0)


if __name__ == "__main__":
    unittest.main()
