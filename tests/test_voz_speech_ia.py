"""SQL 63 · Speech Analytics das ligações da IA, temas novos, oferta e resultado por motivo, com fakes (sem banco, sem
LLM, sem Vertex, sem ElevenLabs). Só dados fictícios (CLI-xxxxx, nomes e números inventados)."""
import json
import os
import re
import stat
import tempfile
import time
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest import mock

from motor import retroalimentacao as R
from nuvem import resultado_motivo as RM
from tests.test_voz_orquestrador import BUCKET, Base, item
from voz.analise import analisador as AN
from voz.analise import catalogo as CAT
from voz.analise import rotina as RT
from voz.analise import temas as TM
from voz.orquestrador import nucleo as N
from voz.provedores import elevenlabs as EL
from voz.provedores import montagem as M
from voz.provedores.base import ContextoChamada
from voz.provedores.simulador import Simulador, turnos_simulados
from voz.registro import RegistroBanco
from voz.transcricao import ia as TIA
from voz.transcricao.worker import FontePasta

RAIZ = Path(__file__).resolve().parent.parent
SQL63 = (RAIZ / "supabase" / "migrations" / "20261230000001_voz_speech_ia.sql").read_text(encoding="utf-8")
CPF = "529.982.247-25"                         # válido, inventado
FONE = "(11) 98877-6655"
EMAIL = "cliente.ficticio@exemplo.test"


def sem_dado_pessoal(t: str) -> bool:
    return not (re.search(r"\d{3}\.\d{3}\.\d{3}-\d{2}", t) or re.search(r"\d{8,}", t)
                or re.search(r"\(?\d{2}\)?\s?9?\d{4}-\d{4}", t) or "@" in t)


class Relogio:
    def __init__(self, t=100.0):
        self.t = t

    def __call__(self):
        return self.t


class FakeModelo:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.vistos = []

    def responder(self, mensagens, ferramentas):
        self.vistos.append(mensagens)
        r = self.respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


# ---------------------------------------------------------------- 1. transcrição da IA (máscara, arquivo, oferta)
class TestTranscricaoIA(unittest.TestCase):
    def test_grava_mascarado_0600_no_ref_da_gravacao(self):
        with tempfile.TemporaryDirectory() as d:
            g = TIA.GravadorTranscricaoIA(d)
            turnos = [{"locutor": "agente", "inicio": 0, "fim": 3, "texto": "Olá, falo com a Joana?"},
                      {"locutor": "cliente", "inicio": 3.5, "fim": 9,
                       "texto": f"Sou eu. Meu CPF é {CPF}, meu telefone {FONE} e o e-mail {EMAIL}"},
                      {"locutor": "cliente", "inicio": 9.5, "fim": 12, "texto": "Meu nome é Joana e estou com câncer"},
                      {"locutor": "intruso", "inicio": 1, "fim": 2, "texto": "fora do esquema"},
                      {"locutor": "agente", "inicio": 5, "fim": 4, "texto": "fim antes do início"}]
            arq = g.salvar(7, "ab12cd", "montagem_motorcx", {"turnos": turnos, "oferta": "6x"}, ("Joana",))
            self.assertEqual(arq, Path(d) / "empresa_7" / "ia_ab12cd.json")
            self.assertEqual(stat.S_IMODE(os.stat(arq).st_mode), 0o600)
            bruto = arq.read_text(encoding="utf-8")
            self.assertTrue(sem_dado_pessoal(bruto), bruto)
            self.assertNotIn("Joana", bruto)
            j = json.loads(bruto)
            self.assertEqual((j["id"], j["origem"], j["oferta"], len(j["segmentos"])), ("ia_ab12cd", "ia", "6x", 3))
            self.assertEqual([s["locutor"] for s in j["segmentos"]], ["agente", "cliente", "cliente"])
            self.assertIn("câncer", j["segmentos"][2]["texto"])        # saúde fica (sinal de vulnerabilidade)
            self.assertEqual(j["redigidos"]["cpf"], 1)
            self.assertIsNone(g.salvar(7, "zz99", "simulador", {"turnos": []}))     # sem turno, sem arquivo

    def test_oferta_so_parcelas_e_faixa(self):
        self.assertEqual(TIA.codigo_oferta({"parcelas": 6, "valor_parcela": 99.9}), "6x")
        self.assertEqual(TIA.codigo_oferta({"parcelas": 1, "desconto_pct": 15, "valor_total": 1234.5}), "avista_d10_20")
        self.assertEqual(TIA.codigo_oferta({"parcelas": 12, "desconto_pct": 60}), "12x_d50_mais")
        self.assertIsNone(TIA.codigo_oferta({"parcelas": "x"}))
        for c in ("6x", "avista_d10_20", "12x_d50_mais"):
            self.assertTrue(CAT.OFERTA.match(c))
        self.assertFalse(CAT.OFERTA.match("R$ 150"))
        # o mesmo padrão do banco (codigos_speech_ok)
        self.assertIn("'^(avista|([2-9]|[1-9][0-9])x)(_d(1_10|10_20|20_30|30_50|50_mais))?$'", SQL63)
        self.assertEqual(CAT.OFERTA.pattern, r"^(avista|([2-9]|[1-9][0-9])x)(_d(1_10|10_20|20_30|30_50|50_mais))?$")

    def test_turnos_e_primeira_oferta_da_conversa(self):
        rel = Relogio(10.0)

        class Interna:
            oferta_atual = None
            falar_agora = None

            def comecar(self):
                return ["Olá, aqui é a central."]

            def ouvir(self, texto):
                self.oferta_atual = {"parcelas": 6} if self.oferta_atual is None else {"parcelas": 10}
                if self.falar_agora:
                    self.falar_agora("Um instante.")
                return ["Consigo seis parcelas."]

        inner = Interna()
        c = TIA.ConversaComTurnos(inner, TIA.TurnosConversa(rel))
        falas = []
        c.falar_agora = falas.append                          # o Pipecat põe a fala de espera
        self.assertEqual(c.comecar(), ["Olá, aqui é a central."])
        rel.t = 16.0
        c.ouvir("quero parcelar em seis vezes")
        rel.t = 25.0
        c.ouvir("e em dez?")
        r = c.resumo()
        self.assertEqual(r["oferta"], "6x")                    # a primeira apresentada
        self.assertEqual(falas, ["Um instante.", "Um instante."])
        quem = [t["locutor"] for t in r["turnos"]]
        self.assertEqual(quem, ["agente", "cliente", "agente", "agente", "cliente", "agente", "agente"])
        self.assertEqual(r["turnos"][1]["fim"], 6.0)          # a pessoa termina quando o texto chega
        self.assertLess(r["turnos"][1]["inicio"], 6.0)
        self.assertEqual(r["tempo"], "estimado")

    def test_expira_em_90_dias(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "empresa_3"
            p.mkdir()
            velho, novo = p / "ia_aa11.json", p / "77.json"
            velho.write_text("{}")
            novo.write_text("{}")
            os.utime(velho, (time.time() - 91 * 86400,) * 2)
            self.assertEqual(TIA.expirar(d), 1)
            self.assertFalse(velho.exists())
            self.assertTrue(novo.exists())

    def test_whisper_nunca_transcreve_ligacao_da_ia(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "empresa_1"
            p.mkdir()
            (p / "ia_ab12.wav").write_bytes(b"x")
            (p / "G-55.wav").write_bytes(b"x")
            self.assertEqual([g.id for g in FontePasta(d).pendentes()], ["G-55"])


# ---------------------------------------------------------------- 2. provedores entregam a conversa
class TestProvedores(unittest.TestCase):
    CTX = ContextoChamada("abc123", 1, "CLI-00001", variaveis={"primeiro_nome": "Joana"})

    def test_montagem_entrega_a_transcricao_ao_encerrar(self):
        rodadas, ev = [], []

        class Modelo:
            def responder(self, m, f):
                return M.Resposta("Posso te ajudar com o pagamento.", [])

        mt = M.Montagem(M.ConfigMontagem(portas=(40000, 40003)), None, lambda ctx: ("Roteiro", "Alô?"),
                        modelo_de=Modelo, executor=rodadas.append, relogio=Relogio(0.0))
        mt.iniciar(self.CTX, lambda *a: ev.append(a))
        conv = rodadas[0].conversa
        conv.comecar()
        conv.ouvir("Oi, sou eu")
        mt.encerrar("abc123")
        self.assertEqual(ev[-1][:2], ("abc123", "transcricao"))
        self.assertEqual([t["locutor"] for t in ev[-1][2]["turnos"]], ["agente", "cliente", "agente"])
        mt.encerrar("abc123")                                  # de novo (fim depois da transferência): nada
        self.assertEqual(len([e for e in ev if e[1] == "transcricao"]), 1)

    def test_simulador_entrega_os_turnos_do_cenario(self):
        ev = []
        sim = Simulador(cenarios={"CLI-00001": "promessa"})
        sim.iniciar(self.CTX, lambda *a: ev.append(a))
        t0 = datetime(2026, 11, 3, 10, 0)
        sim.tick(t0)
        sim.tick(t0 + timedelta(seconds=61))
        sim.encerrar("abc123")
        tr = [e for e in ev if e[1] == "transcricao"][0][2]
        self.assertEqual((tr["oferta"], len(tr["turnos"])), ("6x", len(turnos_simulados("promessa"))))
        # desligou antes: só até onde a conversa foi
        ev.clear()
        sim.iniciar(self.CTX, lambda *a: ev.append(a))
        sim.tick(t0)
        sim.tick(t0 + timedelta(seconds=10))
        sim.encerrar("abc123")
        self.assertLess(len([e for e in ev if e[1] == "transcricao"][0][2]["turnos"]), len(turnos_simulados("promessa")))

    CONVERSA = {"conversation_id": "conv_1", "status": "done",
                "conversation_initiation_client_data": {"dynamic_variables": {"motorcx_id": "abc123"}},
                "metadata": {"call_duration_secs": 30},
                "transcript": [{"role": "agent", "message": "Olá, falo com o titular?", "time_in_call_secs": 0},
                               {"role": "user", "message": f"Sim. Meu CPF é {CPF}", "time_in_call_secs": 4},
                               {"role": "agent", "message": None, "time_in_call_secs": 8},
                               {"role": "agent", "message": "Obrigada.", "time_in_call_secs": 12}],
                "analysis": {"data_collection_results": {"resultado": {"value": "cpc"}}}}

    def test_elevenlabs_conversa_vira_transcricao_e_resultado(self):
        evs = EL.eventos_da_conversa(self.CONVERSA)
        self.assertEqual([e[1] for e in evs], ["transcricao", "resultado"])
        t = evs[0][2]
        self.assertEqual((t["tempo"], [x["locutor"] for x in t["turnos"]]), ("provedor", ["agente", "cliente", "agente"]))
        self.assertEqual((t["turnos"][0]["fim"], t["turnos"][-1]["fim"]), (4.0, 30.0))

    def test_elevenlabs_pela_api_entrega_no_tick(self):
        class Api:
            def __init__(s):
                s.lidas = []

            def recentes(s, desde):
                return [{"conversation_id": "conv_9", "status": "done"}, {"conversation_id": "conv_1", "status": "done"}]

            def conversa(s, cid):
                s.lidas.append(cid)
                outra = dict(TestProvedores.CONVERSA, conversation_initiation_client_data={
                    "dynamic_variables": {"motorcx_id": "zzz999"}})
                return TestProvedores.CONVERSA if cid == "conv_1" else outra

        rel, api, ev = Relogio(1000.0), Api(), []
        el = EL.ElevenLabs("agente01", api=api, relogio=rel)
        el.iniciar(self.CTX, lambda *a: ev.append(a))
        rel.t = 1040.0
        el.encerrar("abc123")
        self.assertEqual(el.busca.rodada(), 1)
        el.busca.talvez_rodar = lambda: None                    # sem thread no teste
        el.tick(datetime(2026, 11, 3))
        self.assertEqual([e[1] for e in ev], ["transcricao", "resultado"])
        self.assertEqual(el.busca.rodada(), 0)                  # nada pendente
        self.assertEqual(sorted(api.lidas), ["conv_1", "conv_9"])

    def test_elevenlabs_sem_api_como_antes(self):
        el = EL.ElevenLabs("agente01")
        el.iniciar(self.CTX, lambda *a: None)
        el.encerrar("abc123")
        el.tick(datetime(2026, 11, 3))
        self.assertIsNone(el.busca)


# ---------------------------------------------------------------- 3. orquestrador: só ligação gravada, gravação registrada
class TestOrquestrador(Base):
    def _ligacao(self, gravar=True):
        orq = self.montar([item("C1", "11988887771", variaveis={"primeiro_nome": "Joana"})], gravar=gravar)
        self.trans = self.pasta / "transcricoes"
        self.gravacoes = []
        orq.transcricoes = TIA.GravadorTranscricaoIA(self.trans)
        orq.ao_gravacao = self.gravacoes.append
        orq.tick()
        canal = self.originados()[0][2]
        cid = canal.rsplit("-", 1)[0]
        self.rel.andar(8)
        self.atender(canal)
        orq.tick()
        self.rel.andar(61)
        orq.tick()
        (self.pasta / "spool" / f"{cid}.wav").write_bytes(b"RIFF....WAVEfmt ")
        self.cair(canal, 16)
        self.fila.processar(100.0)
        self.fila.processar(102.0)
        return cid

    def test_ligacao_gravada_tem_transcricao_e_gravacao(self):
        cid = self._ligacao()
        arq = self.trans / "empresa_1" / f"ia_{cid}.json"
        self.assertTrue(arq.exists())
        j = json.loads(arq.read_text(encoding="utf-8"))
        self.assertEqual((j["origem"], j["oferta"]), ("ia", "6x"))
        self.assertEqual(self.gravacoes, [{"empresa_id": 1, "id_chamada": cid, "duracao_s": 61,
                                           "caminho": f"credor_0/2026/11/03/ia_{cid}.wav"}])
        # o nome da gravação sem a extensão é o <ref> da transcrição (speech_contexto_voz, regra 3)
        self.assertEqual(Path(self.gravacoes[0]["caminho"]).stem, arq.stem)
        self.assertNotRegex(self.gravacoes[0]["caminho"], r"\d{10}")
        self.assertEqual(self.orq._transcrever, {})              # nomes saem da memória

    def test_sem_gravacao_nada_no_disco(self):
        self._ligacao(gravar=False)
        self.assertFalse(self.trans.exists())
        self.assertEqual(self.gravacoes, [])

    def test_id_sem_dez_digitos(self):
        hexes = iter(["1234567890abcdef1234567890abcdef", "a1b2c3d4e5f60718293a4b5c6d7e8f90"])
        with mock.patch.object(N.uuid, "uuid4", lambda: mock.Mock(hex=next(hexes))):
            self.assertEqual(N.novo_id(), "a1b2c3d4e5f60718293a4b5c6d7e8f90")


class TestRegistroGravacoes(unittest.TestCase):
    def test_tenta_de_novo_enquanto_a_chamada_nao_chega(self):
        class Sb:
            def __init__(s):
                s.vezes = 0

            def rpc(s, nome, args):
                s.vezes += 1
                self.assertEqual(nome, "registrar_gravacoes_ia_voz")
                ids = [x["id_chamada"] for x in args["linhas"]]
                return {"gravadas": len(ids) - (1 if s.vezes == 1 else 0), "sem_chamada": ["c2"] if s.vezes == 1 else []}

        reg = RegistroBanco(Sb())
        reg.registrar_gravacao({"empresa_id": 1, "id_chamada": "c1", "caminho": "credor_0/x/ia_c1.wav", "duracao_s": 9})
        reg.registrar_gravacao({"empresa_id": 1, "id_chamada": "c2", "caminho": "credor_0/x/ia_c2.wav", "duracao_s": 9})
        self.assertEqual(reg._descarregar_gravacoes(), 1)
        self.assertEqual([x["linha"]["id_chamada"] for x in reg.fila_gravacoes], ["c2"])
        self.assertEqual(reg._descarregar_gravacoes(), 1)
        self.assertEqual(reg.fila_gravacoes, [])


# ---------------------------------------------------------------- 4. análise da ligação da IA, trechos e oferta
INTENCOES = ("quero_negociar", "sem_dinheiro")


def args_llm(n):
    return {"itens": [], "motivo": {"probabilidades": {"desemprego": 0.8}, "segmento": 1}, "objecoes": [],
            "objecao_principal": None, "intencao": None, "canal_preferido": None, "horario_preferido": None,
            "vulnerabilidade": [], "riscos": [], "frases": [], "temas": [], "sentimento": None,
            "falantes": "AC" * (n // 2) + "A" * (n % 2), "transcricao_ruim": 0}


class SbAnalise:
    def __init__(self, vetor=True):
        self.chamadas, self.inseridos, self.vetor = [], [], vetor

    def rpc(self, nome, args=None):
        self.chamadas.append((nome, args))
        if nome == "speech_vetor_voz":
            return self.vetor
        if nome == "speech_contexto_voz":
            return {"ligado": True, "intencoes": list(INTENCOES), "temas": [], "checklists": {},
                    "chamadas": [{"ref": r["ref"], "gravacao_id": 50, "chamada_id": 40, "origem": "ia", "credor_id": 3,
                                  "duracao_s": 60, "dia": "2026-11-02"} for r in args["refs"]]}
        if nome == "gravar_analise_voz":
            return {"situacao": "ok", "alertas": 0}
        return None

    def inserir(self, tabela, linhas, conflito=None):
        self.inseridos.append((tabela, linhas, conflito))


class EmbFalso:
    dimensao = 1536

    def __init__(self):
        self.tokens_entrada = 0

    def vetores(self, textos):
        self.tokens_entrada += 7 * len(textos)
        return [[0.01] * 1536 for _ in textos]


class TestAnaliseIA(unittest.TestCase):
    def _arquivo(self, d):
        g = TIA.GravadorTranscricaoIA(d)
        turnos = [{"locutor": "agente" if i % 2 == 0 else "cliente", "inicio": i * 5.0, "fim": i * 5.0 + 4,
                   "texto": "Consigo seis parcelas." if i % 2 == 0 else f"Perdi o emprego, liga no {FONE}"}
                  for i in range(8)]
        return g.salvar(9, "ab12cd", "simulador", {"turnos": turnos, "oferta": "6x"}, ())

    def test_ia_analisada_com_oferta_trechos_e_embedding(self):
        with tempfile.TemporaryDirectory() as d:
            self._arquivo(d)
            sb, emb = SbAnalise(), EmbFalso()
            modelo = FakeModelo([M.Resposta("", [(AN.FERRAMENTA, args_llm(8))], tokens_entrada=900, tokens_saida=80)])
            out = RT.analisar_pendentes(sb, modelo, RT.FonteLocal(d), embedder=emb)
            self.assertEqual(out.get("ok"), 1)
            gravada = next(a for n, a in sb.chamadas if n == "gravar_analise_voz")["analise"]
            self.assertEqual(gravada["codigos"]["oferta"], "6x")
            self.assertEqual(gravada["codigos"]["motivo"], "desemprego")
            tab, linhas, conf = sb.inseridos[0]
            self.assertEqual((tab, conf), ("voz_trechos", "gravacao_id,inicio_s,falante"))
            self.assertEqual({l["falante"] for l in linhas}, {"agente", "cliente"})
            self.assertTrue(all(sem_dado_pessoal(l["texto_redigido"]) and l["origem"] == "ia" and "embedding" in l
                                for l in linhas))
            uso = [a for n, a in sb.chamadas if n == "registrar_uso_ia_voz"]
            self.assertEqual((uso[0]["componente"], uso[0]["minutos_cobraveis"], uso[0]["tokens_entrada"] > 0),
                             ("embeddings", 0, True))
            self.assertTrue((Path(d) / "empresa_9" / "ia_ab12cd.analise.json").exists())

    def test_sem_pgvector_trechos_sem_embedding_e_sem_custo(self):
        with tempfile.TemporaryDirectory() as d:
            self._arquivo(d)
            sb = SbAnalise(vetor=False)
            modelo = FakeModelo([M.Resposta("", [(AN.FERRAMENTA, args_llm(8))], tokens_entrada=900, tokens_saida=80)])
            RT.analisar_pendentes(sb, modelo, RT.FonteLocal(d), embedder=EmbFalso())
            self.assertTrue(all("embedding" not in l for l in sb.inseridos[0][1]))
            self.assertFalse([n for n, _ in sb.chamadas if n == "registrar_uso_ia_voz"])

    def test_oferta_so_de_ligacao_da_ia_e_no_padrao(self):
        ctx = AN.Contexto(empresa_id=1, gravacao_id=2, chamada_id=3, origem="discador", versao_id=None)
        res = AN.Resultado(AN.validar(args_llm(2), AN.Contexto(1, 2, 3, "ia", None, intencoes=INTENCOES), 2)[0])
        segs = [{"inicio": 0, "fim": 2, "texto": "oi"}, {"inicio": 2, "fim": 4, "texto": "oi"}]
        self.assertNotIn("oferta", AN.montar(ctx, segs, res, 4, "6x")["codigos"])
        ctx.origem = "ia"
        self.assertEqual(AN.montar(ctx, segs, res, 4, "6x")["codigos"]["oferta"], "6x")
        self.assertNotIn("oferta", AN.montar(ctx, segs, res, 4, "R$ 99")["codigos"])

    def test_falante_vem_do_llm_quando_o_whisper_nao_diz(self):
        segs = [{"inicio": 0, "fim": 1, "texto": "a"}, {"inicio": 1, "fim": 2, "texto": "b"},
                {"inicio": 2, "fim": 3, "texto": "c", "locutor": "agente"}]
        self.assertEqual([s["locutor"] for s in RT.segmentos_com_falante(segs, "CA")], ["cliente", "agente", "agente"])
        self.assertEqual(len(RT.segmentos_com_falante(segs, None)), 1)


# ---------------------------------------------------------------- 5. temas novos (clusterização semanal)
def trechos_semana(n_pix=35, n_ruido=12, com_emb=False):
    out, i = [], 1
    for k in range(n_pix):
        out.append({"id": i, "chamada_id": 1000 + k, "texto": f"o pix não caiu na conta, paguei pelo pix e não compensou {k % 3}"})
        i += 1
    ruido = ["meu cachorro fugiu ontem", "o carro quebrou na estrada", "choveu demais no bairro",
             "a escola das crianças fechou", "mudei de cidade semana passada", "o chuveiro queimou"]
    for k in range(n_ruido):
        out.append({"id": i, "chamada_id": 5000 + k, "texto": ruido[k % len(ruido)]})
        i += 1
    if com_emb:
        for t in out:
            base = [1.0, 0.0, 0.0] if "pix" in t["texto"] else [0.0, (t["id"] % 7) + 1.0, (t["id"] % 5) + 1.0]
            t["emb"] = "[" + ",".join(str(x) for x in base) + "]"
    return out


class SbTemas:
    def __init__(self, dados):
        self.dados, self.chamadas = dados, []

    def rpc(self, nome, args=None):
        self.chamadas.append((nome, args))
        if nome == "speech_empresas_voz":
            return [5]
        if nome == "trechos_para_temas_voz":
            return self.dados
        if nome == "propor_tema_voz":
            return {"tema_id": 77, "novo": "tema_id" not in args["tema"], "conversas": 0}
        return None


class TestTemas(unittest.TestCase):
    def test_rotulo_so_letras(self):
        self.assertEqual(TM.rotulo_valido(" pix não compensou. "), "Pix não compensou")
        for ruim in ("Pix de 150 reais", "ab", "Ligar para a@b.com", "Cliente [NOME]", 3, "x" * 61):
            self.assertIsNone(TM.rotulo_valido(ruim), ruim)

    def test_por_palavras_grupo_de_30_vira_tema_com_sugestao(self):
        sb = SbTemas({"ligado": True, "vetor": False, "trechos": trechos_semana(), "temas": []})
        modelo = FakeModelo([M.Resposta("", [(TM.FERRAMENTA, {"rotulo": "Pix 100"})], tokens_entrada=300, tokens_saida=10),
                             M.Resposta("", [(TM.FERRAMENTA, {"rotulo": "Pix não compensou"})], tokens_entrada=320,
                                        tokens_saida=12)])
        out = TM.rodar(sb, date(2026, 11, 9), "1/1", modelo, None)
        self.assertEqual((out["temas_novos"], out["vetorial"]), (1, 0))
        self.assertGreaterEqual(out["grupos_pequenos"], 1)              # o ruído nunca aparece
        props = [a for n, a in sb.chamadas if n == "propor_tema_voz"]
        self.assertEqual(len(props), 1)
        tema = props[0]["tema"]
        self.assertEqual((tema["sugestao"], props[0]["semana"], len(tema["trechos"])), ("Pix não compensou", "2026-11-02", 35))
        self.assertIn(tema["exemplo"], tema["trechos"])
        uso = [a for n, a in sb.chamadas if n == "registrar_uso_ia_voz"][0]
        self.assertEqual((uso["componente"], uso["chamadas"], uso["tokens_entrada"], uso["tokens_saida"],
                          uso["minutos_cobraveis"]), ("temas", 2, 620, 22, 0))
        # os exemplos que foram ao LLM são os trechos mascarados (nada além deles)
        self.assertIn("pix", modelo.vistos[0][1]["content"])

    def test_menos_de_30_nunca_aparece(self):
        sb = SbTemas({"ligado": True, "vetor": False, "trechos": trechos_semana(n_pix=29), "temas": []})
        out = TM.rodar(sb, date(2026, 11, 9), "1/1", FakeModelo([]), None)
        self.assertFalse([n for n, _ in sb.chamadas if n == "propor_tema_voz"])
        self.assertEqual(out.get("temas_novos", 0), 0)

    def test_por_vetor_e_grupo_parecido_entra_no_tema_que_existe(self):
        dados = {"ligado": True, "vetor": True, "trechos": trechos_semana(com_emb=True),
                 "temas": [{"id": 12, "situacao": "promovido", "trechos": [{"texto": "pix", "emb": "[1,0,0]"}]}]}
        sb = SbTemas(dados)
        out = TM.rodar(sb, date(2026, 11, 9), "1/1", FakeModelo([]), None)
        props = [a for n, a in sb.chamadas if n == "propor_tema_voz"]
        self.assertEqual(props[0]["tema"]["tema_id"], 12)
        self.assertEqual(len(props[0]["tema"]["trechos"]), 35)
        self.assertEqual((out["vetorial"], out.get("temas_novos", 0)), (1, 0))

    def test_vetor_que_falta_e_calculado_com_custo(self):
        tr = trechos_semana(com_emb=True)
        for t in tr[:5]:
            t.pop("emb")

        class Emb:
            tokens_entrada = 0

            def vetores(s, textos):
                s.tokens_entrada += 11 * len(textos)
                return [[1.0, 0.0, 0.0] for _ in textos]

        sb = SbTemas({"ligado": True, "vetor": True, "trechos": tr, "temas": []})
        out = TM.rodar(sb, date(2026, 11, 9), "1/1", FakeModelo([M.Resposta("", [(TM.FERRAMENTA, {"rotulo": "Pix"})])]),
                       Emb())
        self.assertEqual((out["embeddings"], out["temas_novos"]), (5, 1))
        uso = {a["componente"]: a for n, a in sb.chamadas if n == "registrar_uso_ia_voz"}
        self.assertEqual(uso["embeddings"]["tokens_entrada"], 55)

    def test_sem_llm_o_tema_vai_sem_sugestao(self):
        sb = SbTemas({"ligado": True, "vetor": False, "trechos": trechos_semana(), "temas": []})
        TM.rodar(sb, date(2026, 11, 9), "1/1", FakeModelo([RuntimeError("fora")]), None)
        tema = [a for n, a in sb.chamadas if n == "propor_tema_voz"][0]["tema"]
        self.assertNotIn("sugestao", tema)

    def test_semana_anterior_e_rotina(self):
        self.assertEqual(TM.semana_anterior(date(2026, 11, 9)), date(2026, 11, 2))
        self.assertEqual(TM.semana_anterior(date(2026, 11, 12)), date(2026, 11, 2))
        sb = SbTemas({"ligado": True, "vetor": False, "trechos": [], "temas": []})
        self.assertEqual(RT.main(["temas", "--hoje", "2026-11-09"], ambiente={"MOTORCX_SPEECH_ANALYTICS": "1"}, sb=sb,
                                 modelo=FakeModelo([])), 0)
        self.assertEqual(sb.chamadas[-1], ("trechos_para_temas_voz", {"empresa": 5, "semana": "2026-11-02"}))
        sb.chamadas.clear()
        self.assertEqual(RT.main(["temas"], ambiente={}, sb=sb), 0)            # desligado por padrão: nada
        self.assertEqual(sb.chamadas, [])


# ---------------------------------------------------------------- 6. resultado por motivo (motor) e retroalimentação
class TestResultadoMotivo(unittest.TestCase):
    def test_so_quem_pagou_na_janela_e_sem_valor(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d) / "base"
            base.mkdir()
            (base / "pagamentos.csv").write_text(
                "data;id_cliente;id_contrato;valor;tipo;pagou;arquivo\n"
                "2026-10-20;CLI-00001;K1;150.00;parcela;1;b.csv\n"
                "2026-10-21;CLI-00002;K2;80.00;parcial;0;b.csv\n"
                "2026-06-01;CLI-00003;K3;99.00;quitacao;1;b.csv\n", encoding="utf-8")
            chamadas = []

            class Sb:
                def rpc(s, nome, args):
                    chamadas.append((nome, args))
                    return {"linhas": 3}

            r = RM.publicar(Sb(), 4, 8, Path(d), date(2026, 11, 1))
            self.assertEqual(r, {"linhas": 3})
            nome, args = chamadas[0]
            self.assertEqual(nome, "gravar_resultado_por_motivo_voz")
            self.assertEqual(args["pagamentos"], [{"id_cliente": "CLI-00001", "data": "2026-10-20"}])
            self.assertEqual((args["empresa"], args["credor"], args["ate"]), (4, 8, "2026-11-01"))
            self.assertNotIn("valor", json.dumps(args))
            self.assertIsNone(RM.publicar(Sb(), 4, None, Path(d) / "nada", date(2026, 11, 1)))

    def test_regra_de_ofertas_ignora_sem_oferta(self):
        linhas = [{"dimensao": "oferta", "valor": v, "conversas": c, "com_acordo": a}
                  for v, c, a in (("6x", 400, 120), ("sem_oferta", 400, 10), ("12x", 400, 60))]
        recs = R.regra_ofertas(linhas)
        self.assertEqual(len(recs), 1)
        self.assertNotIn("SEM_OFERTA", recs[0].titulo)

    def test_retroalimentacao_le_dias_fechados(self):
        lidos = []

        class Sb:
            def selecionar(s, tabela, filtros, limite=None):
                lidos.append((tabela, filtros))
                return []

            def rpc(s, *a, **k):
                return []

        R.publicar_recomendacoes(Sb(), 1, date(2026, 11, 29))
        filtro = dict(lidos)["voz_resultado_por_motivo"]["and"]
        self.assertEqual(filtro, "(data.gte.2026-10-02,data.lte.2026-10-29)")
        self.assertIn("m.data between de - 30 and ate - 30", SQL63)


if __name__ == "__main__":
    unittest.main()
