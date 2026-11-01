"""SQL 62 · dados do Speech Analytics na VM (voz/analise/analisador.py e rotina.py), com LLM falso: códigos só das
listas fechadas, resposta inválida recusada e pedida de novo, uso de IA (tokens reais e minutos) no que vai ao banco,
dúvida para a Curadoria, nada de dado pessoal na saída, job noturno idempotente pelas RPCs e desligado por padrão.
Só dados fictícios."""
import io
import json
import os
import re
import tempfile
import time
import unittest
from datetime import date, timedelta
from pathlib import Path

from motor import retroalimentacao as R
from voz import acesso as A
from voz.analise import analisador as AN
from voz.analise import catalogo as CAT
from voz.analise import rotina as RT
from voz.provedores.montagem import ModeloOpenAICompat, Resposta

RAIZ = Path(__file__).resolve().parents[1]
MIG = RAIZ / "supabase" / "migrations"
CPF = re.compile(r"\d{3}\.?\d{3}\.?\d{3}-?\d{2}")
FONE = re.compile(r"\(?\d{2}\)?\s?9?\d{4}-?\d{4}")
EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}")

CHECKLIST = [
    {"id": "ck_ident", "texto": "Se identificou", "gravidade": "importante", "aplica": "ambos", "peso": 2, "origem": "padrao", "trava": False, "on": True},
    {"id": "ck_cpc", "texto": "Confirmou a identidade antes de falar valor", "gravidade": "bloqueante", "aplica": "ambos", "peso": 3, "origem": "padrao", "trava": True, "on": True},
    {"id": "ck_oferta", "texto": "Ofereceu condição", "gravidade": "importante", "aplica": "ambos", "peso": 2, "origem": "padrao", "trava": False, "on": True},
    {"id": "ck_resumo", "texto": "Resumiu o combinado", "gravidade": "boa_pratica", "aplica": "ambos", "peso": 1, "origem": "padrao", "trava": False, "on": True},
    {"id": "ck_desligado", "texto": "Item desligado", "gravidade": "importante", "aplica": "ambos", "peso": 2, "origem": "cliente", "trava": False, "on": False},
    {"id": "ck_so_humano", "texto": "Item só do humano", "gravidade": "importante", "aplica": "humano", "peso": 2, "origem": "cliente", "trava": False, "on": True},
]
INTENCOES = ("quero_negociar", "ja_paguei", "sem_dinheiro", "agendar_retorno")
TRANSCRICAO = {"id": "77", "empresa_id": 5, "duracao_s": 90.0, "motor": "whisper", "texto": "...", "segmentos": [
    {"inicio": 0.0, "fim": 4.0, "texto": "Olá, aqui é a central da Assessoria Exemplo. Falo com a Ana?", "locutor": None},
    {"inicio": 4.5, "fim": 6.0, "texto": "Sou eu. Meu nome é Ana Teste.", "locutor": None},
    {"inicio": 6.5, "fim": 12.0, "texto": "Para sua segurança, me confirma o dia do seu nascimento?", "locutor": None},
    {"inicio": 11.5, "fim": 20.0, "texto": "Quinze de março. Olha, perdi o emprego e estou em tratamento de câncer.", "locutor": None},
    {"inicio": 21.0, "fim": 30.0, "texto": "Entendo. Posso oferecer 3 parcelas. Meu telefone é (11) 98765-4321, e-mail ana@exemplo.com", "locutor": None},
    {"inicio": 31.0, "fim": 40.0, "texto": "Se continuar ligando vou no Procon. Meu CPF é 123.456.789-09.", "locutor": None},
]}


def ctx(**kw) -> AN.Contexto:
    base = dict(empresa_id=5, gravacao_id=77, chamada_id=700, origem="ia", versao_id=3,
                itens=AN.itens_aplicaveis(CHECKLIST, "ia"), intencoes=INTENCOES, temas={11: "Boleto não chegou"},
                credor_id=9, duracao_s=90.0, modelo="modelo-teste")
    base.update(kw)
    return AN.Contexto(**base)


def resposta_valida(**mudar) -> dict:
    r = {"itens": [{"id": "ck_ident", "resposta": "sim", "confianca": 0.95, "segmento": 0},
                   {"id": "ck_cpc", "resposta": "sim", "confianca": 0.9, "segmento": 2},
                   {"id": "ck_oferta", "resposta": "sim", "confianca": 0.8, "segmento": 4},
                   {"id": "ck_resumo", "resposta": "nao", "confianca": 0.7, "segmento": None}],
         "motivo": {"probabilidades": {"desemprego": 0.8, "reducao_renda": 0.1}, "segmento": 3},
         "objecoes": ["sem_dinheiro_agora"], "objecao_principal": {"probabilidades": {"sem_dinheiro_agora": 0.9}, "segmento": 3},
         "intencao": {"codigo": "sem_dinheiro", "confianca": 0.85, "alternativas": ["agendar_retorno"], "segmento": 3},
         "canal_preferido": "whatsapp", "horario_preferido": None,
         "vulnerabilidade": [{"sinal": "saude", "segmento": 3}, {"sinal": "desemprego_recente", "segmento": 3}],
         "riscos": [{"tipo": "procon", "falante": "cliente", "segmento": 5}, {"tipo": "fraude", "falante": "cliente", "segmento": None}],
         "frases": ["reconheceu_dificuldade"], "temas": [11], "sentimento": {"inicio": -0.4, "fim": 0.1},
         "falantes": "ACACAC", "transcricao_ruim": 0.05}
    r.update(mudar)
    return r


class LLMFalso:
    """Devolve as respostas na ordem; guarda as mensagens que recebeu."""

    def __init__(self, *argumentos, tokens=(1200, 300)):
        self.fila = list(argumentos)
        self.pedidos = []
        self.tokens = tokens

    def responder(self, mensagens, ferramentas):
        self.pedidos.append((json.loads(json.dumps(mensagens)), ferramentas))
        a = self.fila.pop(0) if self.fila else resposta_valida()
        if isinstance(a, Exception):
            raise a
        chamadas = [] if a is None else [(AN.FERRAMENTA, a)]
        return Resposta("", chamadas, tokens=sum(self.tokens), tokens_entrada=self.tokens[0], tokens_saida=self.tokens[1])


class SbFalso:
    def __init__(self, rpcs=None):
        self.rpcs = rpcs or {}
        self.chamadas = []

    def rpc(self, nome, args=None):
        self.chamadas.append((nome, args))
        v = self.rpcs.get(nome)
        if isinstance(v, Exception):
            raise v
        return v(args) if callable(v) else v


def textos(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from textos(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from textos(v)
    elif isinstance(obj, str):
        yield obj


class TestCatalogo(unittest.TestCase):
    def test_listas_batem_com_as_migracoes_e_com_a_retroalimentacao(self):
        sql56 = (MIG / "20261223000001_voz_base.sql").read_text(encoding="utf-8")
        sql60 = (MIG / "20261227000001_voz_speech_analytics.sql").read_text(encoding="utf-8")
        sql62 = (MIG / "20261229000001_voz_speech_dados.sql").read_text(encoding="utf-8")
        corpo56 = sql56[sql56.index("function public.codigos_voz_validos"):sql56.index("-- ================================================================ 4.")]
        corpo62 = sql62[sql62.index("function public.codigos_speech_ok"):sql62.index("-- ================================================================ 3.")]
        for lista in (CAT.MOTIVOS, CAT.OBJECOES, CAT.CANAIS, CAT.HORARIOS):
            for corpo in (corpo56, corpo62):
                self.assertTrue(all(f"'{c}'" in corpo for c in lista), lista)
        for c in CAT.RISCOS + CAT.FRASES:
            self.assertIn(f"'{c}'", corpo62)
        alerta = sql60[sql60.index("create table if not exists public.voz_alertas"):]
        self.assertIn("sinal            text check (sinal in ('idade_confusao', 'saude', 'luto', 'desemprego_recente'))", alerta)
        for t in CAT.RISCOS_ALERTA:
            self.assertIn(f"'{t}'", alerta[:alerta.index("sinal")])
        self.assertEqual(set(CAT.FRASES), set(R.FRASES))
        self.assertEqual(set(CAT.MOTIVOS), set(R.MOTIVOS))
        self.assertEqual(set(CAT.OBJECOES), set(R.OBJECOES))
        self.assertEqual(set(CAT.SINAIS), set(R.SINAIS))
        self.assertNotIn("saude", CAT.MOTIVOS + CAT.RISCOS)            # saúde nunca vira código

    def test_acesso_proprio_tem_as_rpcs_novas_e_o_sql_cria_cada_uma(self):
        sql62 = (MIG / "20261229000001_voz_speech_dados.sql").read_text(encoding="utf-8")
        for publica in ("speech_contexto_voz", "gravar_analise_voz", "agregar_speech_dia", "speech_empresas_voz",
                        "dados_retroalimentacao_voz", "registrar_recomendacao_voz", "conferir_rascunhos_recomendacoes",
                        "recomendacoes_aplicadas_voz", "gravar_impacto_voz", "avisar_alertas_voz"):
            self.assertIn(publica, A.RPC)
            self.assertIn(f"function voz_vm.{A.RPC[publica]}(args jsonb)", sql62)
            self.assertRegex(sql62, rf"grant execute on function[^;]*voz_vm\.{A.RPC[publica]}\(jsonb\)[^;]*to motorcx_voz;")


class TestMascaraEChecklist(unittest.TestCase):
    def test_itens_aplicaveis_pela_origem(self):
        self.assertEqual([i["id"] for i in AN.itens_aplicaveis(CHECKLIST, "ia")], ["ck_ident", "ck_cpc", "ck_oferta", "ck_resumo"])
        self.assertIn("ck_so_humano", [i["id"] for i in AN.itens_aplicaveis(CHECKLIST, "discador")])

    def test_llm_nunca_ve_cpf_telefone_email_nem_nome_dito(self):
        segs = AN.preparar_segmentos(TRANSCRICAO)
        llm = LLMFalso()
        AN.analisar(llm, ctx(), segs)
        enviado = json.dumps(llm.pedidos[0][0], ensure_ascii=False)
        self.assertNotRegex(enviado, CPF)
        self.assertNotRegex(enviado, FONE)
        self.assertNotRegex(enviado, EMAIL)
        self.assertNotIn("Ana Teste", enviado)
        self.assertIn("câncer", enviado)        # saúde fica para o LLM (é o sinal de vulnerabilidade)

    def test_transcricao_sem_segmentos_vira_um(self):
        segs = AN.preparar_segmentos({"texto": "Quero pagar.", "duracao_s": 12})
        self.assertEqual(segs, [{"inicio": 0.0, "fim": 12.0, "texto": "Quero pagar.", "locutor": None}])

    def test_nota_pesos_na_e_bloqueante(self):
        itens = AN.itens_aplicaveis(CHECKLIST, "ia")
        self.assertEqual(AN.nota(itens, {"ck_ident": "sim", "ck_cpc": "sim", "ck_oferta": "sim", "ck_resumo": "nao"}),
                         (87.5, False, None))
        self.assertEqual(AN.nota(itens, {"ck_ident": "na", "ck_cpc": "nao", "ck_oferta": "sim", "ck_resumo": "na"}),
                         (40.0, True, "ck_cpc"))
        self.assertEqual(AN.nota(itens, {k["id"]: "na" for k in itens}), (100.0, False, None))

    def test_audio_fala_silencio_interrupcoes(self):
        segs = AN.preparar_segmentos(TRANSCRICAO)
        m = AN.metricas_audio(segs, "ACACAC", 90.0)
        self.assertEqual(m["interrupcoes"], 1)                     # 11,5 s começa antes de 12,0 s (outro lado)
        self.assertEqual(m["fala_agente_s"], round(4 + 5.5 + 9))
        self.assertEqual(m["fala_cliente_s"], round(1.5 + 8.5 + 9))
        self.assertEqual(m["silencio_s"], 90 - 37)                 # 11,5–12,0 s conta uma vez só
        self.assertEqual(AN.metricas_audio(segs, None, 90.0)["fala_agente_s"], 0)   # sem saber quem fala: não divide


class TestLLM(unittest.TestCase):
    def test_resposta_valida_uma_chamada_e_tokens_separados(self):
        llm = LLMFalso()
        r = AN.analisar(llm, ctx(), AN.preparar_segmentos(TRANSCRICAO))
        self.assertIsNotNone(r.analise)
        self.assertEqual((r.chamadas_llm, r.tokens_entrada, r.tokens_saida), (1, 1200, 300))
        props = llm.pedidos[0][1][0]["function"]["parameters"]["properties"]
        self.assertEqual(props["motivo"]["properties"]["probabilidades"]["properties"].keys(), set(CAT.MOTIVOS))
        self.assertEqual(props["intencao"]["properties"]["codigo"]["enum"], list(INTENCOES))

    def test_codigo_fora_da_lista_e_recusado_e_pedido_de_novo(self):
        llm = LLMFalso(resposta_valida(motivo={"probabilidades": {"doenca_grave": 0.9}, "segmento": 3}), resposta_valida())
        r = AN.analisar(llm, ctx(), AN.preparar_segmentos(TRANSCRICAO))
        self.assertIsNotNone(r.analise)
        self.assertEqual((r.chamadas_llm, r.tokens_entrada, r.tokens_saida), (2, 2400, 600))
        correcao = llm.pedidos[1][0][-1]["content"]
        self.assertIn("codigo_fora_da_lista:motivo", correcao)

    def test_recusas_de_tudo_que_sai_do_esquema(self):
        segs = AN.preparar_segmentos(TRANSCRICAO)
        casos = {
            "intencao_fora_do_catalogo": resposta_valida(intencao={"codigo": "inventada", "confianca": 0.9, "alternativas": [], "segmento": 1}),
            "item_sem_resposta": resposta_valida(itens=resposta_valida()["itens"][:2]),
            "item_fora_do_checklist": resposta_valida(itens=resposta_valida()["itens"] + [{"id": "ck_x", "resposta": "sim", "confianca": 1, "segmento": None}]),
            "resposta_invalida": resposta_valida(itens=[{**resposta_valida()["itens"][0], "resposta": "talvez"}] + resposta_valida()["itens"][1:]),
            "campo_fora_do_esquema": resposta_valida(nome_cliente="Fulano"),
            "segmento_invalido": resposta_valida(riscos=[{"tipo": "procon", "falante": "cliente", "segmento": 99}]),
            "probabilidade_invalida": resposta_valida(motivo={"probabilidades": {"desemprego": 0.9, "outro": 0.9}, "segmento": 3}),
            "tema_fora_da_lista": resposta_valida(temas=[12]),
            "codigo_fora_da_lista:vulnerabilidade": resposta_valida(vulnerabilidade=[{"sinal": "gravidez", "segmento": 1}]),
            "sentimento_invalido": resposta_valida(sentimento={"inicio": -3, "fim": 0}),
        }
        for erro, resp in casos.items():
            norm, erros = AN.validar(resp, ctx(), len(segs))
            self.assertIsNone(norm, erro)
            self.assertTrue(any(e.startswith(erro) for e in erros), (erro, erros))

    def test_sem_resposta_valida_vira_falhou_com_o_custo_e_sem_codigo(self):
        llm = LLMFalso(None, resposta_valida(objecoes=["xingou"]), resposta_valida(canal_preferido="pombo"))
        sb = SbFalso({"gravar_analise_voz": {"situacao": "falhou"}})
        out = AN.processar(sb, llm, ctx(), TRANSCRICAO)
        self.assertEqual(out["situacao"], "falhou")
        self.assertEqual(len(llm.pedidos), AN.MAX_TENTATIVAS)
        a = sb.chamadas[0][1]["analise"]
        self.assertEqual(a["situacao"], "falhou")
        self.assertEqual(a["uso"], {"chamadas_llm": 3, "tokens_entrada": 3600, "tokens_saida": 900})
        self.assertNotIn("codigos", a)
        self.assertNotIn("avaliacao", a)

    def test_llm_fora_nao_grava_nada(self):
        sb = SbFalso()
        self.assertEqual(AN.processar(sb, LLMFalso(RuntimeError("fora")), ctx(), TRANSCRICAO)["situacao"], "llm_indisponivel")
        self.assertEqual(sb.chamadas, [])

    def test_sem_divisao_de_tokens_conta_tudo_como_saida(self):
        class SoTotal:
            def responder(self, m, f):
                return Resposta("", [(AN.FERRAMENTA, resposta_valida())], tokens=1000)
        r = AN.analisar(SoTotal(), ctx(), AN.preparar_segmentos(TRANSCRICAO))
        self.assertEqual((r.tokens_entrada, r.tokens_saida), (0, 1000))

    def test_cliente_openai_compativel_separa_entrada_e_saida(self):
        corpo = {"choices": [{"message": {"content": "", "tool_calls": []}}],
                 "usage": {"prompt_tokens": 900, "completion_tokens": 120, "total_tokens": 1020}}

        class R(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        m = ModeloOpenAICompat("https://llm.exemplo/v1", "chave-ficticia", "modelo-x", abrir=lambda req, timeout: R(json.dumps(corpo).encode()))
        r = m.responder([{"role": "user", "content": "oi"}], [])
        self.assertEqual((r.tokens, r.tokens_entrada, r.tokens_saida), (1020, 900, 120))


class TestMontar(unittest.TestCase):
    def montar(self, resp=None, **kw):
        segs = AN.preparar_segmentos(TRANSCRICAO)
        r = AN.analisar(LLMFalso(resp or resposta_valida()), ctx(**kw), segs)
        return AN.montar(ctx(**kw), segs, r, 90.0)

    def test_so_codigos_fechados_e_nada_pessoal(self):
        a = self.montar()
        self.assertEqual(a["situacao"], "ok")
        self.assertEqual(a["codigos"], {"motivo": "desemprego", "objecoes": ["sem_dinheiro_agora"], "intencao": "sem_dinheiro",
                                        "canal_preferido": "whatsapp", "riscos": ["procon", "fraude"],
                                        "frases": ["reconheceu_dificuldade"], "temas": [11]})
        self.assertEqual(a["minutos"], 1.5)
        self.assertEqual(a["uso"], {"chamadas_llm": 1, "tokens_entrada": 1200, "tokens_saida": 300})
        for t in textos(a):
            self.assertNotRegex(t, CPF)
            self.assertNotRegex(t, FONE)
            self.assertNotRegex(t, EMAIL)
            self.assertNotIn("Ana Teste", t)
            self.assertNotIn("câncer", t)

    def test_avaliacao_com_evidencia_por_posicao(self):
        av = self.montar()["avaliacao"]
        self.assertEqual(av["versao_id"], 3)
        self.assertEqual(av["nota"], 87.5)
        self.assertFalse(av["reprovada"])
        self.assertEqual(av["evidencia"]["ck_cpc"], [6.5, 12.0])
        self.assertNotIn("ck_resumo", av["evidencia"])
        self.assertTrue(set(av["itens"].values()) <= set(CAT.RESPOSTAS))
        self.assertRegex(av["modelo"], r"^[A-Za-z0-9_.:\-]{1,60}$")

    def test_reprovada_leva_o_trecho_mascarado(self):
        itens = resposta_valida()["itens"]
        itens[1] = {"id": "ck_cpc", "resposta": "nao", "confianca": 0.9, "segmento": 4}
        av = self.montar(resposta_valida(itens=itens))["avaliacao"]
        self.assertEqual((av["reprovada"], av["item_reprovado"]), (True, "ck_cpc"))
        self.assertIn("[TELEFONE]", av["trecho_redigido"])

    def test_vulnerabilidade_so_sinal_e_risco_com_trecho(self):
        al = self.montar()["alertas"]
        vul = [x for x in al if x["tipo"] == "vulnerabilidade"]
        self.assertEqual(sorted(x["sinal"] for x in vul), ["desemprego_recente", "saude"])
        self.assertTrue(all("trecho" not in x for x in vul))
        procon = [x for x in al if x["tipo"] == "procon"][0]
        self.assertEqual(procon["falante"], "cliente")
        self.assertIn("[CPF REDIGIDO]", procon["trecho"])
        self.assertFalse([x for x in al if x["tipo"] == "fraude"])    # fraude é só código

    def test_falante_da_empresa_e_operador_no_discador(self):
        itens = resposta_valida()["itens"] + [{"id": "ck_so_humano", "resposta": "na", "confianca": 0.9, "segmento": None}]
        al = self.montar(resposta_valida(itens=itens, riscos=[{"tipo": "ameaca", "falante": "agente", "segmento": 4}]),
                         origem="discador", itens=AN.itens_aplicaveis(CHECKLIST, "discador"))["alertas"]
        self.assertEqual([x["falante"] for x in al if x["tipo"] == "ameaca"], ["operador"])

    def test_duvida_vai_para_a_curadoria(self):
        itens = resposta_valida()["itens"]
        itens[2] = {"id": "ck_oferta", "resposta": "sim", "confianca": 0.45, "segmento": 4}
        a = self.montar(resposta_valida(
            itens=itens, intencao={"codigo": "quero_negociar", "confianca": 0.4, "alternativas": ["ja_paguei"], "segmento": 3},
            motivo={"probabilidades": {"desemprego": 0.45, "reducao_renda": 0.4}, "segmento": 3}, transcricao_ruim=0.35))
        tipos = sorted(c["tipo"] for c in a["curadoria"])
        self.assertEqual(tipos, ["codigo", "intencao", "nota", "transcricao"])
        nota = [c for c in a["curadoria"] if c["tipo"] == "nota"][0]
        self.assertEqual(nota["decisao_ia"], {"item": "ck_oferta", "valor": "sim", "baixa_confianca": True})
        self.assertEqual(nota["opcoes"], ["sim", "nao", "na"])
        self.assertEqual([c for c in a["curadoria"] if c["tipo"] == "intencao"][0]["opcoes"], ["quero_negociar", "ja_paguei"])
        self.assertEqual(a["codigos"]["motivo"], "desemprego")        # 0,45 >= 0,4 vira código; a dúvida vai à fila
        for c in a["curadoria"]:
            self.assertEqual(set(c), {"tipo", "trecho_redigido", "decisao_ia", "opcoes", "confianca"})

    def test_confianca_alta_nao_enche_a_fila(self):
        self.assertEqual(self.montar()["curadoria"], [])

    def test_motivo_fraco_nao_vira_codigo(self):
        a = self.montar(resposta_valida(motivo={"probabilidades": {"desemprego": 0.2, "outro": 0.15}, "segmento": None}))
        self.assertNotIn("motivo", a["codigos"])
        self.assertEqual(a["curadoria"], [])

    def test_processar_grava_numa_rpc_so(self):
        sb = SbFalso({"gravar_analise_voz": {"situacao": "ok", "alertas": 3}})
        out = AN.processar(sb, LLMFalso(), ctx(), TRANSCRICAO)
        self.assertEqual(out["situacao"], "ok")
        self.assertEqual([c[0] for c in sb.chamadas], ["gravar_analise_voz"])
        self.assertEqual(set(sb.chamadas[0][1]), {"analise"})
        self.assertEqual(sb.chamadas[0][1]["analise"]["gravacao_id"], 77)


class TestRotina(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pasta = Path(self.tmp.name)
        d = self.pasta / "empresa_5"
        d.mkdir()
        for ref in ("77", "78", "79", "80"):
            (d / f"{ref}.json").write_text(json.dumps(TRANSCRICAO), encoding="utf-8")
        velho = d / "10.json"
        velho.write_text("{}", encoding="utf-8")
        os.utime(velho, (time.time() - 30 * 86400,) * 2)
        (self.pasta / "outra_pasta").mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def contexto(self, args):
        cham = {"77": {"ref": "77", "gravacao_id": 77, "chamada_id": 700, "origem": "ia", "versao_id": 3, "dia": "2026-11-05"},
                "78": {"ref": "78", "ambigua": True},
                "79": {"ref": "79", "gravacao_id": 79, "chamada_id": 790, "origem": "discador", "versao_id": 3, "situacao": "ok"}}
        return {"ligado": True, "chamadas": [cham[r["ref"]] for r in args["refs"] if r["ref"] in cham],
                "checklists": {"3": CHECKLIST}, "intencoes": list(INTENCOES), "temas": [{"id": 11, "nome": "Boleto"}]}

    def test_rodada_marca_o_que_terminou_e_avisa_alertas(self):
        sb = SbFalso({"speech_contexto_voz": self.contexto, "gravar_analise_voz": {"situacao": "ok", "alertas": 2}})
        out = RT.analisar_pendentes(sb, LLMFalso(), RT.FonteLocal(self.pasta))
        self.assertEqual(out, {"ok": 1, "ambigua": 1, "ja_analisada": 1, "sem_gravacao": 1, "alertas": 2})
        refs = [r["ref"] for r in sb.chamadas[0][1]["refs"]]
        self.assertEqual(sorted(refs), ["77", "78", "79", "80"])           # o arquivo de 30 dias atrás fica de fora
        self.assertEqual(sb.chamadas[0][1]["refs"][0]["caminho"].split("/")[0], "empresa_5")
        self.assertEqual(sb.chamadas[-1][0], "avisar_alertas_voz")
        marcas = sorted(p.name for p in (self.pasta / "empresa_5").glob("*.analise.json"))
        self.assertEqual(marcas, ["77.analise.json", "78.analise.json", "79.analise.json"])
        self.assertEqual(oct((self.pasta / "empresa_5" / "77.analise.json").stat().st_mode & 0o777), "0o600")
        # segunda rodada: só a 80 (sem gravação no banco) volta
        sb2 = SbFalso({"speech_contexto_voz": self.contexto})
        RT.analisar_pendentes(sb2, LLMFalso(), RT.FonteLocal(self.pasta))
        self.assertEqual([r["ref"] for r in sb2.chamadas[0][1]["refs"]], ["80"])

    def test_falhou_tenta_de_novo_ate_o_limite(self):
        sb = SbFalso({"speech_contexto_voz": lambda a: {"ligado": True, "chamadas": [
            {"ref": "77", "gravacao_id": 77, "chamada_id": 700, "origem": "ia", "versao_id": 3, "situacao": "falhou", "tentativas": 1},
            {"ref": "78", "gravacao_id": 78, "chamada_id": 780, "origem": "ia", "versao_id": 3, "situacao": "falhou",
             "tentativas": RT.MAX_FALHAS}], "checklists": {"3": CHECKLIST}, "intencoes": list(INTENCOES)},
            "gravar_analise_voz": {"situacao": "falhou"}})
        out = RT.analisar_pendentes(sb, LLMFalso(), RT.FonteLocal(self.pasta))
        self.assertEqual((out["falhou"], out["desistiu"]), (1, 1))
        self.assertFalse((self.pasta / "empresa_5" / "77.analise.json").exists())
        self.assertTrue((self.pasta / "empresa_5" / "78.analise.json").exists())

    def test_empresa_desligada_nao_chama_o_llm(self):
        llm = LLMFalso()
        sb = SbFalso({"speech_contexto_voz": {"ligado": False, "chamadas": []}})
        out = RT.analisar_pendentes(sb, llm, RT.FonteLocal(self.pasta))
        self.assertEqual(out["desligada"], 4)
        self.assertEqual(llm.pedidos, [])
        self.assertFalse(list((self.pasta / "empresa_5").glob("*.analise.json")))

    def test_desligado_por_padrao(self):
        sb = SbFalso()
        self.assertEqual(RT.main(["noite"], ambiente={}, sb=sb), 0)
        self.assertEqual(RT.main(["analisar", "--pasta", str(self.pasta)], ambiente={"MOTORCX_SPEECH_ANALYTICS": "0"}, sb=sb), 0)
        self.assertEqual(sb.chamadas, [])

    def test_ligado_roda_com_o_llm_injetado(self):
        sb = SbFalso({"speech_contexto_voz": self.contexto, "gravar_analise_voz": {"situacao": "ok"}})
        self.assertEqual(RT.main(["analisar", "--pasta", str(self.pasta)], ambiente={"MOTORCX_SPEECH_ANALYTICS": "1"},
                                 sb=sb, modelo=LLMFalso()), 0)
        self.assertIn("gravar_analise_voz", [c[0] for c in sb.chamadas])


class TestNoite(unittest.TestCase):
    HOJE = date(2026, 11, 20)

    def test_agrega_ontem_e_anteontem_por_empresa_e_e_idempotente(self):
        sb = SbFalso({"speech_empresas_voz": [5, 8], "dados_retroalimentacao_voz": {}, "recomendacoes_aplicadas_voz": []})
        a = RT.noite(sb, self.HOJE, "1/2")
        b = RT.noite(sb, self.HOJE, "1/2")
        self.assertEqual(a, b)
        dias = [(x[1]["empresa"], x[1]["dia"]) for x in sb.chamadas if x[0] == "agregar_speech_dia"]
        self.assertEqual(dias[:4], [(5, "2026-11-18"), (5, "2026-11-19"), (8, "2026-11-18"), (8, "2026-11-19")])
        self.assertEqual(dias[:4], dias[4:])                                     # a mesma coisa de novo
        self.assertEqual(sb.chamadas[0], ("speech_empresas_voz", {"parte": "1/2"}))

    def test_retroalimentacao_com_piso_e_impacto_de_28_dias(self):
        conv = [{"credor_id": 9, "dimensao": "horario", "valor": "manha", "conversas": 400, "com_acordo": 120},
                {"credor_id": 9, "dimensao": "horario", "valor": "noite", "conversas": 300, "com_acordo": 30},
                {"credor_id": 9, "dimensao": "frase", "valor": "resumiu_acordo", "conversas": 20, "com_acordo": 10}]

        def dados(args):
            if args.get("so_total"):
                antes = date.fromisoformat(args["de"]) < date(2026, 10, 1)
                return {"conversao": [{"credor_id": 9, "dimensao": "total", "valor": "todas",
                                       "conversas": 100, "com_acordo": 20 if antes else 30}]}
            return {"conversao": conv, "renitencia": [], "por_motivo": []}
        sb = SbFalso({"speech_empresas_voz": [5], "dados_retroalimentacao_voz": dados, "registrar_recomendacao_voz": 1,
                      "recomendacoes_aplicadas_voz": [{"id": 4, "credor_id": 9, "aplicada_em": "2026-10-01T10:00:00Z"},
                                                      {"id": 6, "credor_id": 9, "aplicada_em": "2026-11-10T10:00:00Z"}]})
        out = RT.noite(sb, self.HOJE)
        self.assertEqual((out["recomendacoes"], out["impactos"]), (1, 1))      # horário (n >= 200, 20 p.p.); frase pequena não
        reg = [x[1] for x in sb.chamadas if x[0] == "registrar_recomendacao_voz"][0]
        self.assertEqual((reg["destino"], reg["chave"]), ("regua", "regua:horario:9:manha"))
        imp = [x[1] for x in sb.chamadas if x[0] == "gravar_impacto_voz"]
        self.assertEqual(imp, [{"rec": 4, "metrica": "acordo_pct", "antes": 20.0, "depois": 30.0, "n_antes": 100,
                                "n_depois": 100, "janela_dias": 28}])
        self.assertIn(("conferir_rascunhos_recomendacoes", {}), sb.chamadas)

    def test_erro_numa_empresa_nao_segura_as_outras(self):
        def agregar(args):
            if args["empresa"] == 5:
                raise RuntimeError("banco recusou")
            return {}
        sb = SbFalso({"speech_empresas_voz": [5, 8], "agregar_speech_dia": agregar})
        out = RT.noite(sb, self.HOJE, retro=False)
        self.assertEqual(out["erros"], 1)
        self.assertEqual(out["dias"], 2)


if __name__ == "__main__":
    unittest.main()
