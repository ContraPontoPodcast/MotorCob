"""Montagem MotorCX: o agente de voz próprio (decisão 21 do dono), mais barato que um provedor fechado.

  áudio da pessoa (RTP do Asterisk, ARI externalMedia slin16) -> fala→texto Deepgram em streaming (Pipecat)
  -> Conversa (LLM configurável, qualquer API compatível com OpenAI, com 3 ferramentas fechadas)
  -> texto→fala pt-BR configurável (Pipecat: ElevenLabs ou Google) -> RTP de volta.

O que decide a chamada (resultado, transferência, encerrar) vem só das FERRAMENTAS, com esquema fechado e
validado aqui: o que o modelo inventar fora do esquema é ignorado. O núcleo do motor continua determinístico; o
LLM só conduz a conversa (CLAUDE.md: agentes atuam na borda).

Dependências (voz/requirements-ia.txt, fora da imagem do motor): pipecat-ai com deepgram/elevenlabs/google.
Importadas só dentro da sessão: os testes rodam com mocks, sem Pipecat instalado. Os construtores (Deepgram e
ElevenLabs, com Settings) foram conferidos contra o pipecat-ai 1.12.0 de verdade, dentro da imagem voz.
Chaves: Secret Manager pela referência (motorcx-voz-deepgram, motorcx-voz-llm, motorcx-voz-tts), nunca no banco.
"""
from __future__ import annotations

import asyncio
import json
import logging
import queue
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from motor import voz as V
from voz.provedores.base import MOTIVOS_TRANSFERENCIA, Conexao, ContextoChamada, Emitir, ProvedorVoz
from voz.provedores.rtp import TAXA, PonteRTP
from voz.transcricao.ia import ConversaComTurnos, TurnosConversa

log = logging.getLogger("motorcx.voz")
# o que a IA pode registrar (os desfechos de conversa da tabela de voz; nada técnico)
RESULTADOS_IA = tuple(r for r in V.FORCA if r in V.POR_CHAVE)
FERRAMENTAS = [
    {"type": "function", "function": {
        "name": "registrar_resultado",
        "description": "Registra o resultado da conversa. Chame uma vez quando o resultado estiver claro.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["resultado"], "properties": {
            "resultado": {"type": "string", "enum": list(RESULTADOS_IA)},
            "identidade_confirmada": {"type": "boolean"},
            "data_promessa": {"type": "string", "description": "AAAA-MM-DD"},
            "valor_promessa": {"type": "number"},
            "retorno_em": {"type": "string", "description": "AAAA-MM-DDTHH:MM (Brasília)"}}}}},
    {"type": "function", "function": {
        "name": "transferir_humano",
        "description": "Transfere a chamada para um atendente humano.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["motivo"], "properties": {
            "motivo": {"type": "string", "enum": list(MOTIVOS_TRANSFERENCIA)}}}}},
    {"type": "function", "function": {
        "name": "encerrar_chamada", "description": "Despede-se e encerra a chamada.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}}}},
]


@dataclass
class ConfigMontagem:
    stt_modelo: str = "nova-3"
    idioma: str = "pt-BR"
    llm_base_url: str = "https://api.openai.com/v1"
    llm_modelo: str = "gpt-4.1-mini"
    tts_provedor: str = "elevenlabs"           # elevenlabs | google
    tts_voz: str = ""                          # id da voz pt-BR do provedor
    tts_modelo: str = ""
    ref_deepgram: str = "voz/deepgram"
    ref_llm: str = "voz/llm"
    ref_tts: str = "voz/tts"
    host_midia: str = "127.0.0.1"
    portas: tuple = (40000, 40999)
    max_sessoes: int = 50
    max_turnos: int = 40


@dataclass
class Resposta:
    texto: str = ""
    chamadas: list = field(default_factory=list)    # [(nome, argumentos dict)]
    tokens: int = 0                                   # usage.total_tokens (custo do roleplay e da geração)
    tokens_entrada: int = 0                           # usage.prompt_tokens (Speech Analytics: custo por entrada)
    tokens_saida: int = 0                             # usage.completion_tokens (custo por saída)


class ModeloOpenAICompat:
    """LLM por /chat/completions (OpenAI, Gemini compatível, Groq, vLLM…). Só biblioteca padrão."""

    def __init__(self, base_url: str, chave: str, modelo: str, abrir=urllib.request.urlopen, timeout: float = 15):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.chave, self.modelo, self.abrir, self.timeout = chave, modelo, abrir, timeout

    def responder(self, mensagens: list[dict], ferramentas: list[dict]) -> Resposta:
        corpo = json.dumps({"model": self.modelo, "messages": mensagens, "tools": ferramentas,
                            "tool_choice": "auto", "temperature": 0.3}).encode()
        req = urllib.request.Request(self.url, data=corpo, method="POST", headers={
            "Authorization": f"Bearer {self.chave}", "Content-Type": "application/json"})
        try:
            with self.abrir(req, timeout=self.timeout) as r:
                d = json.loads(r.read().decode())
        except urllib.error.HTTPError as ex:
            raise RuntimeError(f"LLM HTTP {ex.code}") from None
        msg = (d.get("choices") or [{}])[0].get("message") or {}
        chamadas = []
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            chamadas.append((fn.get("name"), args if isinstance(args, dict) else {}))
        uso = d.get("usage") or {}
        tokens = int(uso.get("total_tokens") or 0)
        return Resposta(texto=(msg.get("content") or "").strip(), chamadas=chamadas, tokens=tokens,
                        tokens_entrada=int(uso.get("prompt_tokens") or 0), tokens_saida=int(uso.get("completion_tokens") or 0))


class Conversa:
    """A lógica da conversa, sem áudio: recebe o texto final da pessoa e devolve o que falar; o que decide a
    chamada sai pelas ferramentas para `emitir` (resultado, transferir, encerrar)."""

    def __init__(self, ctx: ContextoChamada, modelo, emitir: Emitir, roteiro: str, primeira_fala: str,
                 max_turnos: int = 40, hoje: date | None = None):
        self.ctx, self.modelo, self.emitir = ctx, modelo, emitir
        self.primeira_fala = preencher(primeira_fala, ctx.variaveis)
        self.max_turnos, self.turnos = max_turnos, 0
        self.encerrada = False
        self.avisos: list[str] = []
        hoje = hoje or date.today()
        sistema = preencher(roteiro, ctx.variaveis) + (
            f"\n\nHoje é {hoje:%d/%m/%Y}. Use só as ferramentas para registrar resultado, transferir ou encerrar. "
            "Nunca peça o CPF completo nem dados de cartão.")
        self.historico = [{"role": "system", "content": sistema}]

    def comecar(self) -> list[str]:
        self.historico.append({"role": "assistant", "content": self.primeira_fala})
        return [self.primeira_fala]

    def ouvir(self, texto: str) -> list[str]:
        if self.encerrada or not (texto or "").strip():
            return []
        self.historico.append({"role": "user", "content": texto.strip()})
        try:
            r = self.modelo.responder(self.historico, FERRAMENTAS)
        except Exception as ex:   # noqa: BLE001 — LLM fora: pede um humano em vez de travar a pessoa na linha
            self.avisos.append(f"LLM indisponível ({ex.__class__.__name__})")
            self._transferir("pedido_humano")
            return []
        for nome, args in r.chamadas:
            self._ferramenta(nome, args)
        falas = [r.texto] if r.texto else []
        if r.texto:
            self.historico.append({"role": "assistant", "content": r.texto})
        self.turnos += 1
        if self.turnos >= self.max_turnos and not self.encerrada:
            self.avisos.append("limite de turnos")
            self._encerrar()
        return falas

    def _ferramenta(self, nome: str, args: dict) -> None:
        if nome == "registrar_resultado":
            dados = self._validar_resultado(args)
            if dados:
                self.emitir(self.ctx.id_chamada, "resultado", dados)
        elif nome == "transferir_humano":
            m = args.get("motivo")
            self._transferir(m if m in MOTIVOS_TRANSFERENCIA else "pedido_humano")
        elif nome == "encerrar_chamada":
            self._encerrar()
        else:
            self.avisos.append(f"ferramenta desconhecida '{nome}' (ignorada)")

    def _validar_resultado(self, a: dict) -> dict | None:
        r = a.get("resultado")
        if r not in RESULTADOS_IA:
            self.avisos.append(f"resultado fora do esquema '{r}' (ignorado)")
            return None
        dados = {"resultado_ia": r}
        if isinstance(a.get("identidade_confirmada"), bool):
            dados["identidade_confirmada"] = a["identidade_confirmada"]
        try:
            if a.get("data_promessa"):
                dados["data_promessa"] = date.fromisoformat(str(a["data_promessa"])[:10])
            if a.get("retorno_em"):
                dados["retorno_em"] = datetime.fromisoformat(str(a["retorno_em"])[:16])
        except ValueError:
            self.avisos.append("data inválida do modelo (ignorada)")
        v = a.get("valor_promessa")
        if isinstance(v, (int, float)) and 0 < v < 10_000_000:
            dados["valor_promessa"] = round(float(v), 2)
        return dados

    def _transferir(self, motivo: str) -> None:
        if not self.encerrada:
            self.encerrada = True
            self.emitir(self.ctx.id_chamada, "transferir", {"motivo": motivo})

    def _encerrar(self) -> None:
        if not self.encerrada:
            self.encerrada = True
            self.emitir(self.ctx.id_chamada, "encerrar", {})


# ------------------------------------------------------------------ bloco generativo do fluxo (SQL 58)
FIXA_SENHA = "Não preciso de senha nem de número de cartão. O pagamento é sempre pelo link que eu envio."
FIXA_LIMITE = "Posso te ajudar com uma das condições que tenho aqui para você."
RE_PEDE_SENHA = re.compile(r"senha|numero do cartao|codigo de seguranca|cvv|digitos do cartao")
RE_DATAS_HORAS = re.compile(r"\b\d{1,2}/\d{1,2}(/\d{2,4})?\b|\b\d{1,2}h(\d{2})?\b|\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b")
RE_NUMERO = re.compile(r"\d+(?:\.\d{3})*(?:,\d+)?|\d+(?:\.\d+)?")
_ACENTOS = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüç", "aaaaaeeeeiiiiooooouuuuc")


def _normal(t: str) -> str:
    return (t or "").lower().translate(_ACENTOS)


def _numero_br(t: str) -> float | None:
    try:
        return float(t.replace(".", "").replace(",", ".")) if "," in t else float(t.replace(".", "")) if re.fullmatch(r"\d{1,3}(\.\d{3})+", t) else float(t)
    except ValueError:
        return None


def ferramentas_do_bloco(ferramentas: list, ofertas: list, devolucoes: list) -> list[dict]:
    """Ferramentas do Generativo montadas por bloco, com enum gerado na hora: só os IDs das ofertas recebidas
    (conector ou carteira) e só os motivos de devolução que o bloco tem como saída."""
    ids = [str(o["id"]) for o in ofertas]
    out = [{"type": "function", "function": {
        "name": "devolver", "description": "Devolve o controle ao fluxo pelo motivo (saída do bloco).",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["motivo"], "properties": {
            "motivo": {"type": "string", "enum": list(devolucoes)}}}}},
        {"type": "function", "function": {
            "name": "transferir_humano", "description": "Transfere para um atendente humano.",
            "parameters": {"type": "object", "additionalProperties": False, "required": ["motivo"], "properties": {
                "motivo": {"type": "string", "enum": list(MOTIVOS_TRANSFERENCIA)}}}}}]
    if "encerrar_chamada" in ferramentas:
        out.append({"type": "function", "function": {"name": "encerrar_chamada", "description": "Despede-se e encerra.",
                                                      "parameters": {"type": "object", "additionalProperties": False,
                                                                     "properties": {}}}})
    if ids and "apresentar_oferta" in ferramentas:
        out.append({"type": "function", "function": {
            "name": "apresentar_oferta", "description": "Apresenta uma das ofertas recebidas (só pelo código).",
            "parameters": {"type": "object", "additionalProperties": False, "required": ["oferta_id"], "properties": {
                "oferta_id": {"type": "string", "enum": ids}}}}})
    if ids and "registrar_promessa" in ferramentas:
        out.append({"type": "function", "function": {
            "name": "registrar_promessa", "description": "Registra a promessa com a oferta escolhida e a data do 1º pagamento.",
            "parameters": {"type": "object", "additionalProperties": False, "required": ["oferta_id", "data"],
                           "properties": {"oferta_id": {"type": "string", "enum": ids},
                                          "data": {"type": "string", "description": "AAAA-MM-DD"}}}}})
    if "agendar_retorno" in ferramentas:
        out.append({"type": "function", "function": {
            "name": "agendar_retorno", "description": "Agenda o retorno da ligação.",
            "parameters": {"type": "object", "additionalProperties": False, "required": ["quando"], "properties": {
                "quando": {"type": "string", "description": "AAAA-MM-DDTHH:MM (Brasília)"}}}}})
    if "consultar_base" in ferramentas:
        out.append({"type": "function", "function": {
            "name": "consultar_base", "description": "Consulta a base de respostas aprovadas da empresa.",
            "parameters": {"type": "object", "additionalProperties": False, "required": ["pergunta"], "properties": {
                "pergunta": {"type": "string"}}}}})
    return out


@dataclass
class TurnoBloco:
    falas: list = field(default_factory=list)
    acao: tuple | None = None          # ("devolver", motivo) | ("transferir", motivo) | ("encerrar", None)
    trava: str | None = None           # senha_cartao | oferta_inventada | alcada | repeticao


class ConversaBloco:
    """O executor do bloco Conversa generativa: a Conversa de antes, agora com objetivo, tom, base de respostas e
    ferramentas montadas por bloco. As travas ficam aqui, não no prompt: valor ou parcela que a IA falar e que não
    seja de uma oferta recebida troca a frase por uma fala fixa; pedido de senha ou cartão também; ferramenta ou
    argumento fora do enum é ignorado; passar de max_turnos transfere."""

    def __init__(self, modelo, params: dict, devolucoes: list, ofertas: list, contexto: str, base: list | None = None,
                 hoje: date | None = None, validade_dias: int = 5, numeros_livres: tuple = ()):
        self.modelo, self.params, self.devolucoes, self.ofertas = modelo, params, list(devolucoes), list(ofertas)
        self.hoje = hoje or date.today()
        self.validade_dias = validade_dias
        self.max_turnos = int(params.get("max_turnos") or 8)
        self.max_apresentar = int(params.get("contrapropostas_max", 2)) + 1
        self.turnos = self.apresentadas = 0
        self.oferta_atual: dict | None = None
        self.promessa: dict | None = None
        self.retorno_em: datetime | None = None
        self.avisos: list[str] = []
        self.base = list(base or [])
        self.ferramentas = ferramentas_do_bloco(params.get("ferramentas") or [], self.ofertas, self.devolucoes)
        self.numeros_livres = set(numeros_livres)
        tom = ", ".join(params.get("tom") or [])
        linhas_of = "\n".join(f"- {o['id']}: " + ", ".join(f"{k}={v}" for k, v in o.items() if k != "id") for o in self.ofertas)
        linhas_base = "\n".join(f"- P: {p} R: {r}" for p, r in self.base)
        sistema = (f"{params.get('objetivo', '')}\n\nTom: {tom or 'cordial'}. Fale em português do Brasil, frases curtas.\n"
                   f"Hoje é {self.hoje:%d/%m/%Y}.\n{contexto}\n"
                   + (f"Ofertas que você pode usar (só estas, pelo código):\n{linhas_of}\n" if self.ofertas else
                      "Não há ofertas para apresentar.\n")
                   + (f"Respostas aprovadas da empresa (responda só com elas; fora disso, diga que vai verificar):\n{linhas_base}\n"
                      if self.base else "")
                   + "Use as ferramentas para apresentar oferta, registrar promessa, agendar retorno, devolver ao fluxo, "
                     "transferir ou encerrar. Nunca peça senha, cartão ou documento.")
        self.historico = [{"role": "system", "content": sistema}]

    # ---------------------------------------------------------------- números permitidos (trava de valor)
    def _numeros_ok(self, texto: str) -> bool:
        t = RE_DATAS_HORAS.sub(" ", texto)
        permitidos = set(self.numeros_livres)
        for o in self.ofertas:
            for k in ("parcelas", "valor_parcela", "desconto_pct", "valor_total", "entrada"):
                if isinstance(o.get(k), (int, float)):
                    permitidos.add(round(float(o[k]), 2))
        for n in RE_NUMERO.findall(t):
            v = _numero_br(n)
            if v is not None and v > 1 and round(v, 2) not in permitidos:
                return False
        return True

    def _filtrar(self, texto: str) -> tuple[str, str | None]:
        if not texto:
            return texto, None
        if RE_PEDE_SENHA.search(_normal(texto)):
            return FIXA_SENHA, "senha_cartao"
        if not self._numeros_ok(texto):
            if self.oferta_atual:
                o = self.oferta_atual
                return (f"A condição que tenho é {o.get('parcelas')} vez(es) de "
                        f"{_reais(o.get('valor_parcela') or o.get('valor_total'))}."), "alcada"
            return FIXA_LIMITE, "alcada"
        return texto, None

    def comecar(self) -> TurnoBloco:
        return self._rodar("(a etapa começou: fale a primeira frase desta etapa)", interno=True)

    def ouvir(self, texto: str) -> TurnoBloco:
        return self._rodar(texto)

    def _rodar(self, texto: str, interno: bool = False) -> TurnoBloco:
        self.historico.append({"role": "system" if interno else "user", "content": texto})
        try:
            r = self.modelo.responder(self.historico, self.ferramentas)
        except Exception as ex:   # noqa: BLE001
            self.avisos.append(f"LLM indisponível ({ex.__class__.__name__})")
            return TurnoBloco(acao=("transferir", "pedido_humano"))
        turno = TurnoBloco()
        for nome, args in r.chamadas:
            self._ferramenta(nome, args or {}, turno)
            if turno.acao:
                break
        fala, trava = self._filtrar(r.texto)
        if fala:
            turno.falas.append(fala)
            self.historico.append({"role": "assistant", "content": fala})
        turno.trava = turno.trava or trava
        if not interno:
            self.turnos += 1
        if not turno.acao and self.turnos >= self.max_turnos:
            self.avisos.append("limite de turnos do bloco")
            turno.acao, turno.trava = ("transferir", "pedido_humano"), "repeticao"
        return turno

    def _oferta(self, oid) -> dict | None:
        return next((o for o in self.ofertas if str(o["id"]) == str(oid)), None)

    def _ferramenta(self, nome: str, a: dict, turno: TurnoBloco) -> None:
        if nome == "devolver":
            if a.get("motivo") in self.devolucoes:
                turno.acao = ("devolver", a["motivo"])
            else:
                self.avisos.append("devolução fora das saídas (ignorada)")
        elif nome == "transferir_humano":
            m = a.get("motivo")
            turno.acao = ("transferir", m if m in MOTIVOS_TRANSFERENCIA else "pedido_humano")
        elif nome == "encerrar_chamada" and "encerrar_chamada" in (self.params.get("ferramentas") or []):
            turno.acao = ("encerrar", None)
        elif nome == "apresentar_oferta" and "apresentar_oferta" in (self.params.get("ferramentas") or []):
            o = self._oferta(a.get("oferta_id"))
            if o is None:
                turno.trava = "oferta_inventada"
            elif self.apresentadas >= self.max_apresentar:
                self.avisos.append("contrapropostas esgotadas")
            else:
                self.apresentadas += 1
                self.oferta_atual = o
        elif nome == "registrar_promessa" and "registrar_promessa" in (self.params.get("ferramentas") or []):
            o = self._oferta(a.get("oferta_id"))
            try:
                d = date.fromisoformat(str(a.get("data"))[:10])
            except ValueError:
                d = None
            if o is None:
                turno.trava = "oferta_inventada"
            elif d is None or not self.hoje <= d <= self.hoje + timedelta(days=self.validade_dias):
                self.avisos.append("data da promessa fora da validade (ignorada)")
            else:
                self.oferta_atual = o
                valor = o.get("valor_parcela") if int(o.get("parcelas") or 1) > 1 else o.get("valor_total")
                self.promessa = {"oferta": o, "data_promessa": d, "valor_promessa": valor}
        elif nome == "agendar_retorno" and "agendar_retorno" in (self.params.get("ferramentas") or []):
            try:
                q = datetime.fromisoformat(str(a.get("quando"))[:16])
                if q.date() >= self.hoje:
                    self.retorno_em = q
            except ValueError:
                self.avisos.append("retorno inválido (ignorado)")
        elif nome == "consultar_base" and "consultar_base" in (self.params.get("ferramentas") or []):
            p = _normal(str(a.get("pergunta") or ""))
            melhor = max(self.base, key=lambda pr: len(set(_normal(pr[0]).split()) & set(p.split())), default=None)
            if melhor is not None and set(_normal(melhor[0]).split()) & set(p.split()):
                turno.falas.append(melhor[1])
        else:
            self.avisos.append(f"ferramenta fora do bloco '{nome}' (ignorada)")


def _reais(v) -> str:
    try:
        return "R$ " + f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (TypeError, ValueError):
        return "o valor combinado"




VARIAVEL = re.compile(r"\{\{\s*(\w+)\s*\}\}|\{(\w+)\}")


def preencher(texto: str, variaveis: dict | None) -> str:
    """Troca {{variavel}} (como o site grava o roteiro) e {variavel} pelos valores da chamada. Variável sem valor
    fica como está (o roteiro mostra o que faltou); nada além do texto é avaliado."""
    v = {k: str(x) for k, x in (variaveis or {}).items() if x not in (None, "")}
    return VARIAVEL.sub(lambda m: v.get(m.group(1) or m.group(2), m.group(0)), texto or "")


def montar_servicos_pipecat(cfg: ConfigMontagem, segredos) -> tuple:
    """(stt, tts) do Pipecat com as chaves do cofre. Import tardio (voz/requirements-ia.txt)."""
    from pipecat.services.deepgram.stt import DeepgramSTTService
    stt = DeepgramSTTService(api_key=segredos.valor(cfg.ref_deepgram), sample_rate=TAXA,
                             settings=DeepgramSTTService.Settings(model=cfg.stt_modelo, language=cfg.idioma))
    if cfg.tts_provedor == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
        conf = {"voice": cfg.tts_voz, "language": cfg.idioma}
        if cfg.tts_modelo:
            conf["model"] = cfg.tts_modelo
        tts = ElevenLabsTTSService(api_key=segredos.valor(cfg.ref_tts), sample_rate=TAXA,
                                   settings=ElevenLabsTTSService.Settings(**conf))
    elif cfg.tts_provedor == "google":
        from pipecat.services.google.tts import GoogleTTSService
        tts = GoogleTTSService(credentials=segredos.valor(cfg.ref_tts), sample_rate=TAXA,
                               settings=GoogleTTSService.Settings(voice=cfg.tts_voz, language=cfg.idioma))
    else:
        raise ValueError(f"TTS desconhecido: {cfg.tts_provedor}")
    return stt, tts


async def rodar_pipecat(ponte: PonteRTP, conversa: Conversa, stt, tts, parar: asyncio.Event) -> None:
    """Pipeline Pipecat: áudio da ponte -> STT -> Conversa (thread) -> TTS -> ponte."""
    from pipecat.frames.frames import EndFrame, InputAudioRawFrame, TranscriptionFrame, TTSAudioRawFrame, TTSSpeakFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.task import PipelineTask
    from pipecat.processors.frame_processor import FrameProcessor

    class Cerebro(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, TranscriptionFrame):
                ponte.interromper()
                for t in await asyncio.to_thread(conversa.ouvir, frame.text):
                    await self.push_frame(TTSSpeakFrame(t))
                if conversa.encerrada:
                    await self.push_frame(EndFrame())
            else:
                await self.push_frame(frame, direction)

    class Saida(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, TTSAudioRawFrame):
                ponte.falar(frame.audio)
            else:
                await self.push_frame(frame, direction)

    task = PipelineTask(Pipeline([stt, Cerebro(), tts, Saida()]))
    ponte.ao_audio = lambda pcm: asyncio.ensure_future(
        task.queue_frame(InputAudioRawFrame(audio=pcm, sample_rate=TAXA, num_channels=1)))
    if hasattr(conversa, "falar_agora"):          # fala de espera do bloco Chamar conector, antes da API responder
        loop = asyncio.get_running_loop()
        conversa.falar_agora = lambda t: asyncio.run_coroutine_threadsafe(task.queue_frame(TTSSpeakFrame(t)), loop)
    for t in conversa.comecar():
        await task.queue_frame(TTSSpeakFrame(t))
    runner = asyncio.ensure_future(PipelineRunner(handle_sigint=False).run(task))
    await parar.wait()
    await task.queue_frame(EndFrame())
    await runner


@dataclass
class SessaoMontagem:
    ctx: ContextoChamada
    porta: int
    conversa: Conversa
    parar: asyncio.Event | None = None
    loop: asyncio.AbstractEventLoop | None = None


class Montagem(ProvedorVoz):
    """Provedor 'montagem'. `roteiro_de(ctx) -> (roteiro, primeira_fala)`; `modelo_de()` -> modelo do LLM;
    `executor(sessao)` roda a sessão (padrão: um loop asyncio numa thread por processo). Os eventos da conversa
    são emitidos no tick() (thread do orquestrador), nunca de dentro da thread de áudio."""
    codigo = "montagem_motorcx"          # voz_config.provedor (SQL 56)

    def __init__(self, cfg: ConfigMontagem, segredos, roteiro_de, modelo_de=None, executor=None, servicos=None,
                 fluxo_de=None, conectores=None, entendedor_de=None, relogio=None):
        """fluxo_de(ctx) -> voz.fluxo.FluxoCarregado | None: a versão em uso do fluxo da carteira (SQL 58). Com fluxo,
        a sessão é o executor voz/fluxo.Sessao (a Conversa cuida só do bloco generativo); sem fluxo, a Conversa de
        antes com o roteiro (roteiro_de). conectores: voz.conector.ClienteConectores (padrão: com o cofre da VM)."""
        self.cfg, self.segredos, self.roteiro_de = cfg, segredos, roteiro_de
        self.relogio = relogio or time.monotonic       # tempo dos turnos da transcrição (desde o início da sessão)
        self.fluxo_de = fluxo_de
        self._conectores = conectores
        self.entendedor_de = entendedor_de
        self.modelo_de = modelo_de or (lambda: ModeloOpenAICompat(cfg.llm_base_url, segredos.valor(cfg.ref_llm),
                                                                  cfg.llm_modelo))
        self.servicos = servicos
        self.executor = executor or self._executar_em_thread
        self.sessoes: dict[str, SessaoMontagem] = {}
        self._livres = list(range(cfg.portas[0], cfg.portas[1] + 1, 2))   # RTP em porta par
        self._eventos: queue.Queue = queue.Queue()
        self._emitir: dict[str, Emitir] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def disponivel(self) -> bool:
        return len(self.sessoes) < self.cfg.max_sessoes and bool(self._livres)

    def limites(self) -> dict:
        return {"por_agente": self.cfg.max_sessoes}

    def iniciar(self, ctx: ContextoChamada, emitir: Emitir) -> Conexao:
        if not self.disponivel():
            raise RuntimeError("montagem sem capacidade")
        fluxo = self.fluxo_de(ctx) if self.fluxo_de else None
        porta = self._livres.pop(0)
        emitir_fila = lambda i, t, d: self._eventos.put((i, t, d))   # noqa: E731
        if fluxo is not None:
            conv = self._sessao_fluxo(ctx, fluxo, emitir_fila)
        else:
            roteiro, primeira = self.roteiro_de(ctx)
            conv = Conversa(ctx, self.modelo_de(), emitir_fila, roteiro, primeira, self.cfg.max_turnos)
        # Speech Analytics (SQL 63): cada fala do agente e da pessoa é anotada para a transcrição da ligação da IA
        conv = ConversaComTurnos(conv, TurnosConversa(self.relogio))
        s = SessaoMontagem(ctx, porta, conv)
        self.sessoes[ctx.id_chamada] = s
        self._emitir[ctx.id_chamada] = emitir
        self.executor(s)
        return Conexao("midia_externa", host_porta=f"{self.cfg.host_midia}:{porta}", formato="slin16")

    def tick(self, agora: datetime) -> None:
        while True:
            try:
                i, t, d = self._eventos.get_nowait()
            except queue.Empty:
                return
            if i in self._emitir:
                self._emitir[i](i, t, d)

    def encerrar(self, id_chamada: str) -> None:
        s = self.sessoes.pop(id_chamada, None)
        emitir = self._emitir.pop(id_chamada, None)
        if s is None:
            return
        if emitir is not None and isinstance(s.conversa, ConversaComTurnos):
            # a conversa com a IA acabou (encerrou ou transferiu): a transcrição vai ao orquestrador, que mascara e
            # grava só se a ligação é gravada (voz/transcricao/ia.py)
            try:
                emitir(id_chamada, "transcricao", s.conversa.resumo())
            except Exception as ex:   # noqa: BLE001 — a transcrição nunca segura o fim da chamada
                log.warning("montagem: transcrição não entregue (%s)", ex.__class__.__name__)
        if hasattr(s.conversa, "descartar"):
            s.conversa.descartar()                  # resposta do CRM some da memória
        if s.parar is not None and s.loop is not None:
            s.loop.call_soon_threadsafe(s.parar.set)
        self._livres.append(s.porta)

    def _sessao_fluxo(self, ctx: ContextoChamada, fluxo, emitir: Emitir):
        from voz import fluxo as FX
        from voz.conector import ClienteConectores
        if self._conectores is None:
            self._conectores = ClienteConectores(self.segredos, {})
        if hasattr(self._conectores, "hosts"):
            self._conectores.hosts[ctx.empresa_id] = set(getattr(fluxo, "hosts", ()) or ())
        entendedor = self.entendedor_de() if self.entendedor_de else FX.EntendedorLLM(self.modelo_de())
        variaveis = dict(ctx.variaveis or {})
        return FX.Sessao(fluxo, ctx.id_chamada, ctx.id_cliente, variaveis, emitir, self._conectores,
                         entendedor=entendedor, gerador=FX.gerador_montagem(self.modelo_de))

    # ---------------------------------------------------------------- execução real (Pipecat)
    def _executar_em_thread(self, s: SessaoMontagem) -> None:
        if self._loop is None:
            self._loop = asyncio.new_event_loop()
            threading.Thread(target=self._loop.run_forever, daemon=True, name="montagem-audio").start()
        asyncio.run_coroutine_threadsafe(self._sessao(s), self._loop)

    async def _sessao(self, s: SessaoMontagem) -> None:
        s.loop, s.parar = asyncio.get_running_loop(), asyncio.Event()
        transporte = None
        try:
            ponte = PonteRTP(lambda pcm: None)
            transporte, _ = await s.loop.create_datagram_endpoint(lambda: ponte,
                                                                  local_addr=(self.cfg.host_midia, s.porta))
            envio = asyncio.ensure_future(ponte.enviar_ritmado())
            stt, tts = self.servicos or montar_servicos_pipecat(self.cfg, self.segredos)
            await rodar_pipecat(ponte, s.conversa, stt, tts, s.parar)
            envio.cancel()
        except Exception as ex:   # noqa: BLE001 — falha de áudio/serviço: devolve a pessoa para um humano
            log.warning("sessão da montagem falhou (%s)", ex.__class__.__name__)
            s.conversa._transferir("pedido_humano")
        finally:
            if transporte is not None:
                transporte.close()
