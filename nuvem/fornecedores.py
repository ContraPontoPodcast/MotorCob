"""Adaptadores reais dos fornecedores da Mensageria (Zenvia, Infobip, Sinch e Locaweb) e a consulta de operadora.

Cada adaptador só entra em ADAPTADORES_REAIS quando as credenciais dele estão nas variáveis de ambiente do servidor
(Secret Manager do Google Cloud). Sem credencial, o fornecedor continua "ainda sem integração" e a reserva assume.
Nenhuma credencial fica no código, no banco ou no repositório.

No envio real o fornecedor só aceita a mensagem na hora: a entrega, a falha, a resposta e o bounce chegam depois
pela função "retorno-mensageria" (webhook) e são aplicados pelo motor (nuvem/retornos.py). Por isso o envio de
SMS e RCS volta como "enviada" (aguardando retorno) e o e-mail como "entregue" (aceito pelo provedor; o bounce
corrige depois).

Variáveis (só as do fornecedor que for usar):
  ZENVIA_TOKEN, ZENVIA_SMS_FROM, ZENVIA_RCS_FROM
  INFOBIP_BASE_URL (https://xxxxx.api.infobip.com), INFOBIP_API_KEY, INFOBIP_SMS_FROM, INFOBIP_RCS_FROM
  SINCH_SERVICE_PLAN_ID, SINCH_API_TOKEN, SINCH_FROM, SINCH_REGION (padrão br)
  LOCAWEB_TOKEN, LOCAWEB_FROM
  RETORNO_URL (https://<projeto>.supabase.co/functions/v1/retorno-mensageria) e RETORNO_TOKEN: o endereço que
  Infobip e Sinch chamam com o retorno de cada envio.
Ótima: sem documentação pública da API; o adaptador entra quando a Ótima enviar a documentação.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 15


def _env(*nomes: str) -> dict | None:
    v = {n: (os.environ.get(n) or "").strip() for n in nomes}
    return v if all(v.values()) else None


def _numero(destino: str) -> str:
    """5511999999999 (DDI + DDD + número, só dígitos)."""
    d = re.sub(r"\D", "", destino or "")
    return d if re.fullmatch(r"55\d{10,11}", d) else "55" + d


def _retorno(fornecedor: str) -> str | None:
    base, token = (os.environ.get("RETORNO_URL") or "").rstrip("/"), os.environ.get("RETORNO_TOKEN") or ""
    if not base.startswith("https://") or not token:
        return None
    return f"{base}/{fornecedor}?t={urllib.parse.quote(token)}"


def _http(metodo: str, url: str, cabecalhos: dict, corpo=None, codigo: str = "") -> tuple[int, dict, dict]:
    """(status, json, cabeçalhos). Fora do ar, 5xx, 429 e credencial recusada viram ErroFornecedor (tenta a reserva)."""
    from nuvem.mensageria import ErroFornecedor
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo,
                                 headers={"Content-Type": "application/json", "Accept": "application/json", **cabecalhos})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            texto = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(texto) if texto.strip() else {}), dict(r.headers)
    except urllib.error.HTTPError as e:
        texto = e.read().decode("utf-8", "replace")[:500]
        if e.code in (401, 403):
            raise ErroFornecedor(f"{codigo}: credencial recusada ({e.code})") from None
        if e.code == 429 or e.code >= 500:
            raise ErroFornecedor(f"{codigo}: indisponível ({e.code})") from None
        try:
            return e.code, json.loads(texto), dict(e.headers or {})
        except ValueError:
            return e.code, {"mensagem": texto}, dict(e.headers or {})
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ErroFornecedor(f"{codigo}: fora do ar ({e.__class__.__name__})") from None


def _recusado(codigo: str, status: int, j: dict):
    from nuvem.mensageria import Resultado
    msg = j.get("message") or j.get("mensagem") or j.get("text") or \
        ((j.get("requestError") or {}).get("serviceException") or {}).get("text") or f"HTTP {status}"
    return Resultado("falhou", f"{codigo} recusou: {msg}"[:200], None, enviado=False)


def _botoes_zenvia(botoes: list) -> list:
    saida = []
    for b in botoes or []:
        tipo, rotulo, valor = b.get("tipo"), (b.get("rotulo") or "")[:25], b.get("valor") or ""
        if tipo == "url" and str(valor).startswith("https://"):
            saida.append({"type": "link", "text": rotulo, "url": valor})
        elif tipo == "ligar":
            saida.append({"type": "dial", "text": rotulo, "phoneNumber": "+" + _numero(valor)})
        elif tipo == "resposta":
            saida.append({"type": "text", "text": rotulo, "payload": (valor or rotulo)[:100]})
    return saida[:4]


def _midia(card: dict) -> str | None:
    m = card.get("midia")
    m = m.get("url") if isinstance(m, dict) else m
    return m if isinstance(m, str) and m.startswith("https://") else None


class Zenvia:
    """API v2 (https://api.zenvia.com/v2), cabeçalho X-API-TOKEN. Retorno por assinatura da conta (POST /subscriptions)."""
    codigo = "zenvia"
    BASE = "https://api.zenvia.com/v2"

    def __init__(self, cred: dict):
        self.cred = cred

    @classmethod
    def criar(cls):
        cred = _env("ZENVIA_TOKEN")
        return cls(cred) if cred else None

    def enviar(self, canal: str, destino: str, texto: str, assunto=None, conteudo=None):
        from nuvem.mensageria import ErroFornecedor, Resultado
        remetente = os.environ.get("ZENVIA_RCS_FROM" if canal == "rcs" else "ZENVIA_SMS_FROM", "").strip()
        if canal not in ("sms", "rcs") or not remetente:
            raise ErroFornecedor(f"zenvia: canal {canal} sem remetente configurado")
        if canal == "rcs" and conteudo and (conteudo.get("card") or conteudo.get("cards")):
            card = conteudo.get("card") or conteudo["cards"][0]
            item = {"type": "card", "title": (card.get("titulo") or "")[:200], "text": (card.get("descricao") or texto)[:2000],
                    "buttons": _botoes_zenvia(card.get("botoes"))}
            if _midia(card):
                item["media"] = {"url": _midia(card), "disposition": "ON_THE_TOP_MEDIUM_HEIGHT"}
        else:
            item = {"type": "text", "text": texto}
            if canal == "rcs" and conteudo and conteudo.get("botoes"):
                item = {"type": "text", "text": texto, "quickReplyButtons": _botoes_zenvia(conteudo["botoes"])}
        status, j, _ = _http("POST", f"{self.BASE}/channels/{canal}/messages", {"X-API-TOKEN": self.cred["ZENVIA_TOKEN"]},
                             {"from": remetente, "to": _numero(destino), "contents": [item]}, self.codigo)
        if status >= 300 or not j.get("id"):
            return _recusado(self.codigo, status, j)
        return Resultado("enviada", "aguardando retorno da operadora", str(j["id"]), enviado=False)


    def assinar(self) -> list[str]:
        """Cadastra na Zenvia o endereço de retorno (status e respostas de SMS e RCS) se ainda não estiver lá."""
        url = _retorno(self.codigo)
        if not url:
            return []
        cab = {"X-API-TOKEN": self.cred["ZENVIA_TOKEN"]}
        _, existentes, _ = _http("GET", f"{self.BASE}/subscriptions", cab, None, self.codigo)
        lista = existentes if isinstance(existentes, list) else []
        tem = {(x.get("eventType"), (x.get("criteria") or {}).get("channel"), (x.get("criteria") or {}).get("direction"))
               for x in lista if (x.get("webhook") or {}).get("url") == url}
        feitas = []
        for canal in ("sms", "rcs"):
            if not os.environ.get(f"ZENVIA_{canal.upper()}_FROM"):
                continue
            for evento, direcao in (("MESSAGE_STATUS", None), ("MESSAGE", "IN")):
                if (evento, canal, direcao) in tem:
                    continue
                crit = {"channel": canal, **({"direction": direcao} if direcao else {})}
                status, j, _ = _http("POST", f"{self.BASE}/subscriptions", cab,
                                     {"eventType": evento, "webhook": {"url": url}, "criteria": crit}, self.codigo)
                feitas.append(f"{evento} {canal}: {'ok' if status < 300 else j.get('message', status)}")
        return feitas


class Infobip:
    """SMS v3 e RCS v2 na URL própria da conta, cabeçalho Authorization: App <chave>. Retorno por envio (webhooks)."""
    codigo = "infobip"

    def __init__(self, cred: dict):
        self.cred = cred
        self.base = cred["INFOBIP_BASE_URL"].rstrip("/")

    @classmethod
    def criar(cls):
        cred = _env("INFOBIP_BASE_URL", "INFOBIP_API_KEY")
        return cls(cred) if cred and cred["INFOBIP_BASE_URL"].startswith("https://") else None

    def _cab(self):
        return {"Authorization": f"App {self.cred['INFOBIP_API_KEY']}"}

    def enviar(self, canal: str, destino: str, texto: str, assunto=None, conteudo=None):
        from nuvem.mensageria import ErroFornecedor, Resultado
        remetente = os.environ.get("INFOBIP_RCS_FROM" if canal == "rcs" else "INFOBIP_SMS_FROM", "").strip()
        if canal not in ("sms", "rcs") or not remetente:
            raise ErroFornecedor(f"infobip: canal {canal} sem remetente configurado")
        hooks = {"delivery": {"url": _retorno(self.codigo)}, "contentType": "application/json"} if _retorno(self.codigo) else None
        if canal == "sms":
            msg = {"sender": remetente, "destinations": [{"to": _numero(destino)}], "content": {"text": texto}}
            caminho = "/sms/3/messages"
        else:
            if conteudo and (conteudo.get("card") or conteudo.get("cards")):
                card = conteudo.get("card") or conteudo["cards"][0]
                interno = {"title": (card.get("titulo") or "")[:200], "description": (card.get("descricao") or texto)[:2000]}
                if _midia(card):
                    interno["media"] = {"file": {"url": _midia(card)}, "height": "MEDIUM"}
                sug = [{"type": "OPEN_URL", "text": b["rotulo"][:25], "postbackData": b["rotulo"][:100], "url": b["valor"]}
                       for b in card.get("botoes") or [] if b.get("tipo") == "url" and str(b.get("valor", "")).startswith("https://")]
                if sug:
                    interno["suggestions"] = sug[:4]
                cont = {"type": "CARD", "orientation": "VERTICAL", "alignment": "LEFT", "content": interno}
            else:
                cont = {"type": "TEXT", "text": texto}
            msg = {"sender": remetente, "destinations": [{"to": _numero(destino)}], "content": cont}
            caminho = "/rcs/2/messages"
        if hooks:
            msg["webhooks"] = hooks
        status, j, _ = _http("POST", self.base + caminho, self._cab(), {"messages": [msg]}, self.codigo)
        mid = ((j.get("messages") or [{}])[0]).get("messageId")
        if status >= 300 or not mid:
            return _recusado(self.codigo, status, j)
        return Resultado("enviada", "aguardando retorno da operadora", str(mid), enviado=False)

    def operadora(self, destino: str) -> str:
        """Consulta de operadora (Number Lookup): vivo, claro, tim, oi, outras ou invalido."""
        try:
            status, j, _ = _http("POST", self.base + "/number/1/query", self._cab(), {"to": [_numero(destino)]}, self.codigo)
        except Exception:  # noqa: BLE001 — consulta fora do ar: segue sem operadora
            return "outras"
        r = (j.get("results") or [{}])[0]
        if status >= 300:
            return "outras"
        if (r.get("error") or {}).get("permanent"):
            return "invalido"
        return operadora_pelo_nome((r.get("portedNetwork") or r.get("originalNetwork") or {}).get("networkName"))


def operadora_pelo_nome(nome: str | None) -> str:
    n = (nome or "").upper()
    for chave, op in (("VIVO", "vivo"), ("TELEFONICA", "vivo"), ("CLARO", "claro"), ("TIM", "tim"), ("OI", "oi")):
        if re.search(rf"\b{chave}\b", n) or n.startswith(chave):
            return op
    return "outras"


class Sinch:
    """SMS REST (xms) na região br, Bearer por service plan. Retorno por envio (callback_url)."""
    codigo = "sinch"

    def __init__(self, cred: dict):
        self.cred = cred
        regiao = (os.environ.get("SINCH_REGION") or "br").strip()
        self.base = f"https://{regiao}.sms.api.sinch.com/xms/v1/{cred['SINCH_SERVICE_PLAN_ID']}"

    @classmethod
    def criar(cls):
        cred = _env("SINCH_SERVICE_PLAN_ID", "SINCH_API_TOKEN", "SINCH_FROM")
        return cls(cred) if cred else None

    def enviar(self, canal: str, destino: str, texto: str, assunto=None, conteudo=None):
        from nuvem.mensageria import ErroFornecedor, Resultado
        if canal != "sms":
            raise ErroFornecedor(f"sinch: só SMS (canal {canal})")
        corpo = {"from": self.cred["SINCH_FROM"], "to": ["+" + _numero(destino)], "body": texto,
                 "delivery_report": "per_recipient"}
        if _retorno(self.codigo):
            corpo["callback_url"] = _retorno(self.codigo)
        status, j, _ = _http("POST", self.base + "/batches", {"Authorization": f"Bearer {self.cred['SINCH_API_TOKEN']}"},
                             corpo, self.codigo)
        if status >= 300 or not j.get("id"):
            return _recusado(self.codigo, status, j)
        return Resultado("enviada", "aguardando retorno da operadora", str(j["id"]), enviado=False)


class Locaweb:
    """SMTP Locaweb (https://api.smtplw.com.br/v1/messages), cabeçalho x-auth-token. Bounce e abertura por webhook
    da conta (Configurações › Webhook)."""
    codigo = "locaweb"
    BASE = "https://api.smtplw.com.br/v1"

    def __init__(self, cred: dict):
        self.cred = cred

    @classmethod
    def criar(cls):
        cred = _env("LOCAWEB_TOKEN", "LOCAWEB_FROM")
        return cls(cred) if cred else None

    def enviar(self, canal: str, destino: str, texto: str, assunto=None, conteudo=None):
        from nuvem.mensageria import ErroFornecedor, Resultado
        if canal != "email":
            raise ErroFornecedor(f"locaweb: só e-mail (canal {canal})")
        corpo = {"subject": _assunto_ascii(assunto or "Aviso"), "body": _html(texto), "to": destino.strip(),
                 "from": self.cred["LOCAWEB_FROM"], "headers": {"Content-Type": "text/html; charset=utf-8"}}
        status, j, cab = _http("POST", self.BASE + "/messages", {"x-auth-token": self.cred["LOCAWEB_TOKEN"]}, corpo, self.codigo)
        if status >= 300:
            return _recusado(self.codigo, status, j)
        mid = j.get("id") or j.get("api_message_id") or (cab.get("Location") or cab.get("location") or "").rstrip("/").split("/")[-1]
        return Resultado("entregue", None, str(mid) if mid else None)


def _assunto_ascii(s: str) -> str:
    """Assunto com acento vai codificado (RFC 1342), como a Locaweb pede."""
    import base64
    s = s.strip()[:150]
    return s if s.isascii() else "=?UTF-8?B?" + base64.b64encode(s.encode("utf-8")).decode() + "?="


def _html(texto: str) -> str:
    import html
    return "<br>".join(html.escape(l) for l in (texto or "").splitlines())


CLASSES = (Zenvia, Infobip, Sinch, Locaweb)


def manter_assinaturas(out=print) -> None:
    """Uma vez por dia: confere o cadastro do endereço de retorno nos fornecedores que pedem assinatura (Zenvia)."""
    z = Zenvia.criar()
    if not z:
        return
    try:
        for linha in z.assinar():
            out(f"zenvia: retorno cadastrado — {linha}")
    except Exception as e:  # noqa: BLE001
        out(f"zenvia: não conferiu o retorno ({str(e)[:120]})")


def registrar(adaptadores: dict, consultas: dict) -> list[str]:
    """Liga os fornecedores com credencial. Devolve os códigos ligados."""
    ligados = []
    for cls in CLASSES:
        inst = cls.criar()
        if inst is None:
            continue
        adaptadores[cls.codigo] = (lambda i=inst: i)
        if hasattr(inst, "operadora"):
            consultas[cls.codigo] = inst.operadora
        ligados.append(cls.codigo)
    return ligados
