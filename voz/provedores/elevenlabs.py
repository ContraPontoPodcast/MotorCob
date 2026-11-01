"""ElevenLabs ligado por SIP (decisão 20 do dono): o Asterisk só chama a ElevenLabs quando já é uma pessoa.

  iniciar      -> Conexao SIP: PJSIP/<número do agente>@pv-elevenlabs, com X-MotorCX-Id/X-MotorCX-Empresa no INVITE
                  (nunca CPF, nome ou valor). O endpoint pv-elevenlabs sai do gerador (provedores_sip no JSON).
  resultado    -> chega DEPOIS da chamada pelo webhook pós-chamada (post_call_transcription). ler_webhook confere a
                  assinatura (HMAC-SHA256 de "<t>.<corpo>" com o segredo do webhook, tolerância de 30 min) e
                  devolve os eventos; o orquestrador espera até `espera_resultado_s` antes de fechar a tentativa.
  transferência-> a ferramenta de transferência da ElevenLabs manda REFER para sip:transferir-<motivo>@<Asterisk>;
                  o ARI avisa (ChannelTransfer) e o orquestrador transfere para o discador do cliente.

  transcrição  -> (Speech Analytics, SQL 63) o transcript da conversa (role agent/user, message, time_in_call_secs)
                  vira o evento "transcricao" {turnos, tempo: provedor}: pelo webhook (ler_webhook) ou, sem webhook,
                  pela API de conversas (ApiElevenLabs: lista as conversas recentes do agente e lê a de cada chamada
                  que acabou, numa thread; tick() entrega os eventos na thread do orquestrador). A chave da API vem do
                  Secret Manager (ref_api) e nunca fica em arquivo; sem agent_id/ref_api no provedores.json, nada muda.

Recomendado: um agente por VM, com o webhook pós-chamada do agente (aba Segurança) apontando para a própria VM, e a
API de conversas (do agente desta VM) como reserva.
A confirmar no piloto (documentação da ElevenLabs): como os cabeçalhos X- do INVITE viram variáveis dinâmicas
(aqui: motorcx_id; se não virarem, o "Webhook de Dados do Cliente de Iniciação de Conversa" é o caminho, se o pedido
trouxer um identificador da chamada: infra/asterisk/README.md) e o nome do campo de análise com o resultado (aqui:
data_collection_results.resultado).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import queue
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

from voz.provedores.base import MOTIVOS_TRANSFERENCIA, Conexao, ContextoChamada, Emitir, ProvedorVoz
from voz.provedores.montagem import RESULTADOS_IA

TOLERANCIA_S = 30 * 60
API = "https://api.elevenlabs.io/v1/convai"
log = logging.getLogger("motorcx.voz")


class AssinaturaInvalida(ValueError):
    pass


def verificar_assinatura(cabecalho: str, corpo: bytes, segredo: str, agora: float | None = None) -> None:
    partes = dict(p.split("=", 1) for p in (cabecalho or "").split(",") if "=" in p)
    t, v0 = partes.get("t", ""), partes.get("v0", "")
    if not t.isdigit() or not v0:
        raise AssinaturaInvalida("cabeçalho de assinatura ausente ou malformado")
    if abs((agora if agora is not None else time.time()) - int(t)) > TOLERANCIA_S:
        raise AssinaturaInvalida("assinatura fora da janela de tempo")
    esperado = hmac.new(segredo.encode(), f"{t}.".encode() + corpo, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(esperado, v0):
        raise AssinaturaInvalida("assinatura não confere")


def id_da_conversa(dados: dict) -> str:
    """O id da chamada do MotorCX (variável dinâmica motorcx_id) de uma conversa da ElevenLabs; '' se não houver."""
    var = (((dados or {}).get("conversation_initiation_client_data") or {}).get("dynamic_variables") or {})
    i = str(var.get("motorcx_id") or "")
    return i if i.isalnum() else ""


def turnos_da_conversa(dados: dict) -> list[dict]:
    """transcript da ElevenLabs -> turnos {locutor agente|cliente, inicio, fim, texto}. O fim é o começo do turno
    seguinte (ou a duração da chamada no último)."""
    brutos = [t for t in ((dados or {}).get("transcript") or []) if isinstance(t, dict)
              and t.get("role") in ("agent", "user") and str(t.get("message") or "").strip()]
    dur = ((dados or {}).get("metadata") or {}).get("call_duration_secs")
    out = []
    for i, t in enumerate(brutos):
        try:
            ini = float(t.get("time_in_call_secs") or 0)
        except (TypeError, ValueError):
            continue
        prox = brutos[i + 1].get("time_in_call_secs") if i + 1 < len(brutos) else dur
        try:
            fim = max(ini, float(prox)) if prox is not None else ini + 2.0
        except (TypeError, ValueError):
            fim = ini + 2.0
        out.append({"locutor": "agente" if t["role"] == "agent" else "cliente", "inicio": ini, "fim": fim,
                    "texto": str(t["message"]).strip()})
    return out


def eventos_da_conversa(dados: dict) -> list[tuple]:
    """[(id_chamada, tipo, dados)] de uma conversa terminada (webhook pós-chamada ou API): a transcrição (quando há)
    e depois o resultado."""
    id_chamada = id_da_conversa(dados)
    if not id_chamada:
        return []
    out = []
    turnos = turnos_da_conversa(dados)
    if turnos:
        out.append((id_chamada, "transcricao", {"turnos": turnos, "tempo": "provedor", "oferta": None}))
    return out + [_resultado(id_chamada, dados)]


def ler_webhook(cabecalhos: dict, corpo: bytes, segredo: str, agora: float | None = None) -> list[tuple]:
    """[(id_chamada, tipo, dados)] de um webhook pós-chamada. Assinatura inválida: AssinaturaInvalida."""
    cab = {k.lower(): v for k, v in cabecalhos.items()}
    verificar_assinatura(cab.get("elevenlabs-signature", ""), corpo, segredo, agora)
    d = json.loads(corpo.decode("utf-8"))
    if d.get("type") != "post_call_transcription":
        return []
    return eventos_da_conversa(d.get("data") or {})


def _resultado(id_chamada: str, dados: dict) -> tuple:
    coleta = ((dados.get("analysis") or {}).get("data_collection_results") or {})

    def valor(campo):
        return (coleta.get(campo) or {}).get("value")

    r = valor("resultado")
    if r not in RESULTADOS_IA:
        return (id_chamada, "encerrar", {})
    out = {"resultado_ia": r}
    if isinstance(valor("identidade_confirmada"), bool):
        out["identidade_confirmada"] = valor("identidade_confirmada")
    try:
        if valor("data_promessa"):
            out["data_promessa"] = date.fromisoformat(str(valor("data_promessa"))[:10])
        if valor("retorno_em"):
            out["retorno_em"] = datetime.fromisoformat(str(valor("retorno_em"))[:16])
    except ValueError:
        pass
    v = valor("valor_promessa")
    if isinstance(v, (int, float)) and 0 < v < 10_000_000:
        out["valor_promessa"] = round(float(v), 2)
    return (id_chamada, "resultado", out)


def motivo_do_refer(refer_to: str) -> str | None:
    """'sip:transferir-cpc@203.0.113.10' -> 'cpc'; outro destino -> None."""
    u = (refer_to or "").split(":", 1)[-1].split("@", 1)[0]
    if not u.startswith("transferir-"):
        return None
    m = u[len("transferir-"):]
    return m if m in MOTIVOS_TRANSFERENCIA else "pedido_humano"


class ApiElevenLabs:
    """API de conversas da ElevenLabs (só biblioteca padrão). A chave vem do Secret Manager (nunca em arquivo)."""

    def __init__(self, chave: str, agent_id: str, abrir=urllib.request.urlopen, timeout: float = 15, base: str = API):
        if not str(agent_id or "").replace("_", "").replace("-", "").isalnum():
            raise ValueError("agent_id inválido")
        self.chave, self.agent_id, self.abrir, self.timeout, self.base = chave, agent_id, abrir, timeout, base

    def _get(self, caminho: str, params: dict | None = None) -> dict:
        url = f"{self.base}{caminho}" + (("?" + urllib.parse.urlencode(params)) if params else "")
        req = urllib.request.Request(url, headers={"xi-api-key": self.chave, "Accept": "application/json"})
        try:
            with self.abrir(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as ex:
            raise RuntimeError(f"ElevenLabs HTTP {ex.code}") from None

    def recentes(self, desde_unix: int) -> list[dict]:
        """[{conversation_id, start_time_unix_secs, status}] do agente que começaram depois de desde_unix."""
        d = self._get("/conversations", {"agent_id": self.agent_id, "page_size": 100,
                                          "call_start_after_unix": int(desde_unix)})
        return [c for c in d.get("conversations") or [] if isinstance(c, dict) and c.get("conversation_id")
                and int(c.get("start_time_unix_secs") or 0) >= int(desde_unix)]

    def conversa(self, conversation_id: str) -> dict:
        if not str(conversation_id).replace("_", "").replace("-", "").isalnum():
            raise ValueError("conversation_id inválido")
        return self._get(f"/conversations/{urllib.parse.quote(str(conversation_id))}")


class BuscaConversas:
    """Busca, numa thread, a conversa de cada chamada que acabou (API) e devolve os eventos numa fila. Conversa já
    lida e de outra chamada fica em memória (só o id) para não ler de novo."""

    def __init__(self, api: ApiElevenLabs, prazo_s: int = 900, intervalo_s: int = 20, relogio=time.time):
        self.api, self.prazo_s, self.intervalo_s, self.relogio = api, prazo_s, intervalo_s, relogio
        self.pendentes: dict[str, tuple[float, float]] = {}     # id_chamada -> (início unix, fim unix)
        self.vistas: dict[str, str] = {}                         # conversation_id -> id_chamada ('' = não é nossa)
        self.eventos: queue.Queue = queue.Queue()
        self._ult = 0.0
        self._rodando = False
        self._trava = threading.Lock()

    def acompanhar(self, id_chamada: str, inicio: float, fim: float) -> None:
        with self._trava:
            self.pendentes[id_chamada] = (inicio, fim)

    def rodada(self) -> int:
        """Uma passada (síncrona; a thread chama). Devolve quantas chamadas resolveu."""
        agora = self.relogio()
        with self._trava:
            pend = dict(self.pendentes)
            for i, (_, fim) in pend.items():
                if agora - fim > self.prazo_s:
                    self.pendentes.pop(i, None)          # não veio a tempo: a tentativa já foi registrada sem ela
        pend = {i: v for i, v in pend.items() if agora - v[1] <= self.prazo_s}
        if not pend:
            return 0
        n = 0
        for c in self.api.recentes(int(min(v[0] for v in pend.values())) - 120):
            cid = str(c["conversation_id"])
            if self.vistas.get(cid) == "":
                continue
            if cid in self.vistas and self.vistas[cid] not in pend:
                continue
            if c.get("status") not in (None, "done"):
                continue                                  # ainda processando: próxima passada
            d = self.api.conversa(cid)
            if (d.get("status") or "done") != "done":
                continue
            ident = id_da_conversa(d)
            self.vistas[cid] = ident if ident in pend else ""
            if ident in pend:
                for ev in eventos_da_conversa(d):
                    self.eventos.put(ev)
                with self._trava:
                    self.pendentes.pop(ident, None)
                pend.pop(ident, None)
                n += 1
        if len(self.vistas) > 20000:
            self.vistas.clear()
        return n

    def talvez_rodar(self) -> None:
        """Chamado no tick: dispara uma passada em thread a cada intervalo_s (nunca duas ao mesmo tempo)."""
        agora = self.relogio()
        if self._rodando or not self.pendentes or agora - self._ult < self.intervalo_s:
            return
        self._ult, self._rodando = agora, True

        def correr():
            try:
                self.rodada()
            except Exception as ex:   # noqa: BLE001 — API fora: tenta na próxima passada
                log.warning("elevenlabs: conversas não lidas (%s)", ex.__class__.__name__)
            finally:
                self._rodando = False

        threading.Thread(target=correr, daemon=True, name="elevenlabs-conversas").start()


class ElevenLabs(ProvedorVoz):
    codigo = "elevenlabs"
    PRAZO_DEPOIS_S = 900 + 120          # quanto tempo depois do fim ainda aceita resultado/transcrição

    def __init__(self, numero_agente: str, max_simultaneas: int = 200, espera_resultado_s: int = 120,
                 endpoint: str = "pv-elevenlabs", api: ApiElevenLabs | None = None, relogio=time.time,
                 ref_webhook: str | None = None, webhook_porta: int = 8092):
        if not numero_agente.replace("+", "").isalnum():
            raise ValueError("número/identificador do agente inválido")
        self.numero_agente, self.max_simultaneas, self.endpoint = numero_agente, max_simultaneas, endpoint
        self.espera_resultado_s = espera_resultado_s
        self.sessoes: dict[str, ContextoChamada] = {}
        self.relogio = relogio
        self.busca = BuscaConversas(api, relogio=relogio) if api is not None else None
        # receptor do webhook pós-chamada (voz/provedores/elevenlabs.py › criar_receptor): só com ref_webhook
        self.ref_webhook, self.webhook_porta = ref_webhook, int(webhook_porta)
        self.recebidos: queue.Queue = queue.Queue()
        self._inicio: dict[str, float] = {}
        self._emitir: dict[str, Emitir] = {}
        self._fim: dict[str, float] = {}

    @property
    def depois_do_fim(self) -> bool:
        """O resultado/transcrição chega depois da chamada (API ou webhook)?"""
        return self.busca is not None or bool(self.ref_webhook)

    def disponivel(self) -> bool:
        return len(self.sessoes) < self.max_simultaneas

    def limites(self) -> dict:
        return {"por_agente": self.max_simultaneas}

    def iniciar(self, ctx: ContextoChamada, emitir: Emitir) -> Conexao:
        self.sessoes[ctx.id_chamada] = ctx
        self._inicio[ctx.id_chamada] = self.relogio()
        self._emitir[ctx.id_chamada] = emitir
        return Conexao("sip", endpoint=f"PJSIP/{self.numero_agente}@{self.endpoint}", variaveis={
            "PJSIP_HEADER(add,X-MotorCX-Id)": ctx.id_chamada,
            "PJSIP_HEADER(add,X-MotorCX-Empresa)": str(ctx.empresa_id),
            "PJSIP_HEADER(add,X-MotorCX-Acao)": ctx.id_acao or "-"})

    def encerrar(self, id_chamada: str) -> None:
        self.sessoes.pop(id_chamada, None)
        inicio = self._inicio.pop(id_chamada, None)
        if inicio is None:
            return
        if not self.depois_do_fim:
            self._emitir.pop(id_chamada, None)
            return
        self._fim[id_chamada] = self.relogio()
        if self.busca is not None:
            self.busca.acompanhar(id_chamada, inicio, self._fim[id_chamada])   # resultado e transcrição pela API

    def receber(self, eventos: list[tuple]) -> int:
        """Eventos do webhook (thread do receptor HTTP): vão para a fila e saem no tick, na thread do orquestrador."""
        for ev in eventos:
            self.recebidos.put(ev)
        return len(eventos)

    def _entregar(self, i: str, tipo: str, dados: dict) -> None:
        emitir = self._emitir.get(i)
        if emitir is not None:
            emitir(i, tipo, dados)
        if self.busca is not None:                     # já chegou pelo webhook: a API não precisa buscar
            with self.busca._trava:
                self.busca.pendentes.pop(i, None)

    def tick(self, agora: datetime) -> None:
        if not self.depois_do_fim:
            return
        while True:
            try:
                self._entregar(*self.recebidos.get_nowait())
            except queue.Empty:
                break
        if self.busca is not None:
            self.busca.talvez_rodar()
            while True:
                try:
                    i, tipo, dados = self.busca.eventos.get_nowait()
                except queue.Empty:
                    break
                emitir = self._emitir.get(i)
                if emitir is not None:
                    emitir(i, tipo, dados)
        limite = self.relogio() - self.PRAZO_DEPOIS_S
        for i in [x for x, fim in self._fim.items() if fim < limite]:
            self._fim.pop(i, None)
            self._emitir.pop(i, None)


# ------------------------------------------------------------------ receptor do webhook pós-chamada
CAMINHO_WEBHOOK = "/elevenlabs/pos-chamada"
MAX_CORPO_WEBHOOK = 2 * 1024 * 1024          # a conversa inteira com a análise cabe com folga
TEMPO_LEITURA_S = 10                          # quem não manda o corpo nesse tempo é cortado


def criar_receptor(porta: int, segredo: str, entregar, host: str = "127.0.0.1", relogio=time.time,
                   max_corpo: int = MAX_CORPO_WEBHOOK, tempo_s: float = TEMPO_LEITURA_S):
    """POST /elevenlabs/pos-chamada: confere a assinatura (ElevenLabs-Signature, HMAC-SHA256 com o segredo do
    webhook, tolerância de 30 min em ler_webhook), recusa corpo grande (413), sem tamanho (411) ou lento (408) e
    entrega os eventos (transcrição e resultado) por `entregar(eventos)`. O corpo nunca é gravado nem vai para log.
    Escuta só em 127.0.0.1: o Caddy da VM (TLS na 8443) encaminha."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class H(BaseHTTPRequestHandler):
        timeout = tempo_s                       # socket: leitura lenta (slowloris) é cortada

        def log_message(self, *a):              # sem corpo nem cabeçalho em log
            pass

        def _resp(self, status: int, corpo: dict) -> None:
            b = json.dumps(corpo).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_POST(self):  # noqa: N802
            if self.path.split("?", 1)[0] != CAMINHO_WEBHOOK:
                return self._resp(404, {"erro": "não encontrado"})
            n = self.headers.get("Content-Length")
            if n is None or not n.isdigit():
                return self._resp(411, {"erro": "tamanho obrigatório"})
            if int(n) <= 0 or int(n) > max_corpo:
                return self._resp(413, {"erro": "corpo grande demais"})
            try:
                corpo = self.rfile.read(int(n))
            except OSError:                     # inclui o tempo de leitura estourado
                return self._resp(408, {"erro": "tempo esgotado"})
            if len(corpo) != int(n):
                return self._resp(408, {"erro": "corpo incompleto"})
            try:
                eventos = ler_webhook(dict(self.headers.items()), corpo, segredo, relogio())
            except AssinaturaInvalida:
                log.warning("elevenlabs: webhook com assinatura recusada")
                return self._resp(401, {"erro": "assinatura inválida"})
            except (ValueError, UnicodeDecodeError):
                return self._resp(400, {"erro": "corpo inválido"})
            finally:
                del corpo                       # nada do corpo cru fica no processo
            entregar(eventos)
            return self._resp(200, {"ok": True, "eventos": len(eventos)})

        def do_GET(self):  # noqa: N802
            return self._resp(405, {"erro": "só POST"})

    return ThreadingHTTPServer((host, int(porta)), H)


def ligar_receptor(provedor: "ElevenLabs", segredos, host: str = "127.0.0.1"):   # pragma: no cover - VM
    """Sobe o receptor numa thread quando o provedor tem ref_webhook (o segredo vem do Secret Manager)."""
    if not provedor.ref_webhook or segredos is None:
        return None
    srv = criar_receptor(provedor.webhook_porta, segredos.valor(provedor.ref_webhook), provedor.receber, host)
    threading.Thread(target=srv.serve_forever, daemon=True, name="elevenlabs-webhook").start()
    log.info("elevenlabs: webhook pós-chamada em %s:%s%s", host, provedor.webhook_porta, CAMINHO_WEBHOOK)
    return srv
