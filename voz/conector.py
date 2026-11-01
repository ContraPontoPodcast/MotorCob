"""Conectores de CRM do agente de voz (SQL 58 · FL4/FL5), do lado da VM.

Cliente HTTP de cada conector (crm_conectores):
  * credencial lida do Secret Manager pela referência (segredo_ref), na hora, e nunca guardada fora da memória do
    cliente (o token OAuth2 fica em cache só até vencer);
  * só https e só host liberado para a empresa (crm_hosts_permitidos), sem seguir redirecionamento;
  * tempo limite (timeout_ms), novas tentativas em tempo esgotado, erro de rede e 5xx (POST/PUT só com
    Idempotency-Key = id da chamada + bloco);
  * mapa_entrada monta caminho, query, corpo e cabeçalhos; mapa_saida tira da resposta só os campos mapeados.
A resposta do CRM nunca vai para log, banco ou exceção: fica no dicionário da sessão da ligação (voz/fluxo.py), que
é descartado no fim. Log só com conector, classe, status, tempo e tentativa (tests/test_voz_fluxo.py prova).

A alçada da carteira (voz_alcada_carteira) é o teto de toda oferta, inclusive das que vêm do CRM (decisão 2):
`filtrar_ofertas` descarta o que passa dela e o executor grava o código oferta_acima_alcada.

Só biblioteca padrão.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import ssl
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, timedelta

log = logging.getLogger("motorcx.voz.conector")

MAX_RESPOSTA = 256 * 1024
CAMPOS_OFERTA = ("id", "parcelas", "valor_parcela", "desconto_pct", "vencimento", "valor_total", "entrada")
RE_HOST = re.compile(r"^https://([^/:?#]+)")
RE_PLACEHOLDER = re.compile(r"\{([A-Za-z][A-Za-z0-9_.\-]*)\}")


# ------------------------------------------------------------------ dados
@dataclass(frozen=True)
class Conector:
    id: int
    empresa_id: int
    nome: str
    finalidade: str
    metodo: str
    url: str
    autenticacao: str
    segredo_ref: str | None
    mapa_entrada: tuple = ()
    mapa_saida: tuple = ()
    cabecalhos_fixos: dict = field(default_factory=dict)
    timeout_ms: int = 2500
    tentativas: int = 0
    idempotencia: bool = False
    em_falha: str = "ramo"
    situacao: str = "ativo"
    versao: int = 1
    exemplo_resposta: dict | None = None

    @staticmethod
    def da_linha(l: dict) -> "Conector":
        return Conector(id=int(l["id"]), empresa_id=int(l["empresa_id"]), nome=l.get("nome") or "",
                        finalidade=l["finalidade"], metodo=l["metodo"], url=l["url"], autenticacao=l["autenticacao"],
                        segredo_ref=l.get("segredo_ref"), mapa_entrada=tuple(l.get("mapa_entrada") or ()),
                        mapa_saida=tuple(l.get("mapa_saida") or ()), cabecalhos_fixos=dict(l.get("cabecalhos_fixos") or {}),
                        timeout_ms=int(l.get("timeout_ms") or 2500), tentativas=int(l.get("tentativas") or 0),
                        idempotencia=bool(l.get("idempotencia")), em_falha=l.get("em_falha") or "ramo",
                        situacao=l.get("situacao") or "rascunho", versao=int(l.get("versao") or 1),
                        exemplo_resposta=l.get("exemplo_resposta"))


@dataclass
class Resultado:
    """O que o conector devolve ao executor. `dados` e `ofertas` são só da memória da ligação."""
    classe: str                         # ok | tempo | http_4xx | http_5xx | mapa_invalido | recusado
    http_status: int | None = None
    latencia_ms: int = 0
    tentativa: int = 1
    codigo: str | None = None           # código fechado (destino 'codigo' do mapa de saída)
    dados: dict = field(default_factory=dict)
    ofertas: list = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.classe == "ok"

    def __repr__(self) -> str:          # nunca mostra dados nem ofertas
        return f"Resultado(classe={self.classe!r}, http_status={self.http_status}, tentativa={self.tentativa})"


@dataclass(frozen=True)
class Alcada:
    desconto_max_pct: float
    parcelas_max: int
    parcela_min: float
    entrada_min: float = 0.0
    validade_dias: int = 5
    ofertas_padrao: tuple = ()

    @staticmethod
    def da_linha(l: dict | None) -> "Alcada | None":
        if not l:
            return None
        return Alcada(float(l["desconto_max_pct"]), int(l["parcelas_max"]), float(l["parcela_min"]),
                      float(l.get("entrada_min") or 0), int(l.get("validade_dias") or 5),
                      tuple(l.get("ofertas_padrao") or ()))


# ------------------------------------------------------------------ JSONPath simples ($.a.b, [*], [n])
def caminho_json(dado, origem: str) -> list:
    """Valores no caminho (lista; [*] espalha). Caminho fora do formato devolve []."""
    if not origem.startswith("$"):
        return []
    tokens = re.findall(r"\.([A-Za-z_][A-Za-z0-9_]*)|\[(\*|\d{1,2})\]", origem[1:])
    if "".join(f".{a}" if a else f"[{b}]" for a, b in tokens) != origem[1:]:
        return []
    atuais = [dado]
    for chave, idx in tokens:
        prox = []
        for v in atuais:
            if chave:
                if isinstance(v, dict) and chave in v:
                    prox.append(v[chave])
            elif idx == "*":
                if isinstance(v, list):
                    prox.extend(v)
            elif isinstance(v, list) and int(idx) < len(v):
                prox.append(v[int(idx)])
        atuais = prox
    return atuais


def aplicar_mapa_saida(resposta, mapa: tuple) -> tuple[dict, str | None, list]:
    """(dados, código, ofertas). Destinos oferta.* viram uma lista de ofertas (por posição)."""
    dados: dict = {}
    codigo = None
    colunas: dict[str, list] = {}
    for m in mapa:
        vals = caminho_json(resposta, m["origem"])
        dest = m["destino"]
        if dest == "codigo":
            if vals:
                v = vals[0]
                chave = ("true" if v else "false") if isinstance(v, bool) else str(v)
                codigo = (m.get("valores") or {}).get(chave) or codigo
        elif dest.startswith("oferta."):
            colunas[dest.split(".", 1)[1]] = vals
        elif vals:
            dados[dest] = vals[0]
    ofertas = []
    if colunas:
        n = max(len(v) for v in colunas.values())
        for i in range(n):
            o = {k: (v[i] if i < len(v) else None) for k, v in colunas.items()}
            o = {k: v for k, v in o.items() if k in CAMPOS_OFERTA and v is not None}
            if o:
                ofertas.append(o)
    return dados, codigo, ofertas


# ------------------------------------------------------------------ alçada (decisão 2)
def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        t = v.replace("R$", "").replace(" ", "")
        if "," in t:
            t = t.replace(".", "").replace(",", ".")
        try:
            return float(t)
        except ValueError:
            return None
    return None


def oferta_dentro(o: dict, a: Alcada | None) -> bool:
    if a is None or not o.get("id"):
        return False
    parc = _num(o.get("parcelas"))
    if parc is None or parc != int(parc) or not 1 <= parc <= a.parcelas_max:
        return False
    desc = _num(o.get("desconto_pct")) or 0.0
    if desc < 0 or desc > a.desconto_max_pct:
        return False
    vp = _num(o.get("valor_parcela"))
    if vp is not None and parc > 1 and vp < a.parcela_min:
        return False
    ent = _num(o.get("entrada"))
    if ent is not None and a.entrada_min and ent < a.entrada_min:
        return False
    return True


def filtrar_ofertas(ofertas: list, alcada: Alcada | None) -> tuple[list, int]:
    """(ofertas dentro da alçada, quantas foram descartadas). Sem alçada nada passa."""
    boas = [dict(o, id=str(o["id"])) for o in ofertas if oferta_dentro(o, alcada)]
    return boas, len(ofertas) - len(boas)


def codigo_ofertas(n_validas: int, n_descartadas: int) -> str:
    if n_validas == 0 and n_descartadas > 0:
        return "oferta_acima_alcada"
    return "ofertas_0" if n_validas == 0 else "ofertas_1_3" if n_validas <= 3 else "ofertas_4_mais"


def ofertas_da_carteira(a: Alcada | None, saldo, hoje: date) -> list:
    """A alternativa: as ofertas padrão da alçada, com valores calculados do saldo da ligação."""
    s = _num(saldo)
    if a is None or s is None or s <= 0:
        return []
    out = []
    for o in a.ofertas_padrao:
        parc, desc = int(o["parcelas"]), float(o.get("desconto_pct") or 0)
        total = round(s * (1 - desc / 100), 2)
        oferta = {"id": str(o["id"]), "parcelas": parc, "desconto_pct": desc, "valor_total": total,
                  "valor_parcela": round(total / parc, 2), "vencimento": (hoje + timedelta(days=a.validade_dias)).isoformat()}
        if o.get("entrada") is not None:
            oferta["entrada"] = float(o["entrada"])
        if oferta_dentro(oferta, a):
            out.append(oferta)
    return out


# ------------------------------------------------------------------ cliente HTTP
class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):           # redirecionamento = recusa (não sai do host liberado)
        return None


class ErroConector(Exception):
    pass


class ClienteConectores:
    """Chama os conectores de uma VM. `hosts`: {empresa_id: {host,...}} (crm_hosts_permitidos).
    `abrir(req, timeout, contexto_ssl)` é injetável (testes); o padrão usa urllib sem redirecionamento."""

    def __init__(self, segredos, hosts: dict[int, set[str]], abrir=None, relogio=time.monotonic, dormir=time.sleep):
        self.segredos, self.hosts = segredos, hosts
        self._abrir = abrir or self._abrir_urllib
        self.relogio, self.dormir = relogio, dormir
        self._tokens: dict[int, tuple[str, float]] = {}

    @staticmethod
    def _abrir_urllib(req, timeout, contexto):
        abridor = urllib.request.build_opener(_SemRedirecionar, urllib.request.HTTPSHandler(context=contexto))
        return abridor.open(req, timeout=timeout)

    # ---------------------------------------------------------------- credencial
    def _segredo(self, con: Conector) -> str:
        if not con.segredo_ref:
            raise ErroConector("conector sem credencial")
        return self.segredos.valor(con.segredo_ref)

    def _autenticar(self, con: Conector, cab: dict) -> ssl.SSLContext | None:
        if con.autenticacao == "mtls":
            return self._contexto_mtls(self._segredo(con))
        if con.autenticacao == "bearer":
            cab["Authorization"] = "Bearer " + self._segredo(con)
        elif con.autenticacao == "basic":
            cab["Authorization"] = "Basic " + base64.b64encode(self._segredo(con).encode()).decode()
        elif con.autenticacao == "api_key_header":
            s = self._segredo(con)
            try:
                j = json.loads(s)
                cab[str(j["cabecalho"])] = str(j["valor"])
            except (ValueError, KeyError, TypeError):
                cab["X-API-Key"] = s
        elif con.autenticacao == "oauth2_cc":
            cab["Authorization"] = "Bearer " + self._token_oauth(con)
        return None

    def _token_oauth(self, con: Conector) -> str:
        tok = self._tokens.get(con.id)
        if tok and tok[1] > self.relogio() + 30:
            return tok[0]
        try:
            c = json.loads(self._segredo(con))
            corpo = {"grant_type": "client_credentials", "client_id": c["client_id"], "client_secret": c["client_secret"]}
            if c.get("scope"):
                corpo["scope"] = c["scope"]
            url = c["token_url"]
        except (ValueError, KeyError, TypeError):
            raise ErroConector("credencial OAuth2 fora do formato") from None
        if not self._host_ok(con.empresa_id, url):
            raise ErroConector("token_url fora dos hosts liberados")
        req = urllib.request.Request(url, data=urllib.parse.urlencode(corpo).encode(), method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with self._abrir(req, con.timeout_ms / 1000, None) as r:
                d = json.loads(r.read(MAX_RESPOSTA).decode())
            token, dura = str(d["access_token"]), float(d.get("expires_in") or 300)
        except Exception:   # noqa: BLE001 — nada da resposta vai adiante
            raise ErroConector("token OAuth2 indisponível") from None
        self._tokens[con.id] = (token, self.relogio() + dura)
        return token

    @staticmethod
    def _contexto_mtls(segredo: str) -> ssl.SSLContext:
        try:
            c = json.loads(segredo)
            cert, chave = c["cert"], c["key"]
        except (ValueError, KeyError, TypeError):
            raise ErroConector("credencial mTLS fora do formato") from None
        ctx = ssl.create_default_context()
        d = tempfile.mkdtemp(prefix="mtls-")
        try:
            pc, pk = os.path.join(d, "c.pem"), os.path.join(d, "k.pem")
            for p, v in ((pc, cert), (pk, chave)):
                fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write(v)
            ctx.load_cert_chain(pc, pk)
        finally:
            for n in os.listdir(d):
                os.remove(os.path.join(d, n))
            os.rmdir(d)
        return ctx

    # ---------------------------------------------------------------- pedido
    def _host_ok(self, empresa_id: int, url: str) -> bool:
        m = RE_HOST.match(url or "")
        return bool(m) and m.group(1).lower() in self.hosts.get(empresa_id, set())

    def montar(self, con: Conector, entrada: dict) -> tuple[str, dict, bytes | None]:
        """(url, cabeçalhos, corpo) a partir do mapa de entrada. Campo que falta = recusa."""
        url, cab, corpo, query = con.url, dict(con.cabecalhos_fixos), {}, {}
        for m in con.mapa_entrada:
            if m["origem"] not in entrada or entrada[m["origem"]] in (None, ""):
                raise ErroConector(f"campo {m['origem']} ausente")
            v = entrada[m["origem"]]
            if m["onde"] == "path":
                url = url.replace("{" + m["destino"] + "}", urllib.parse.quote(str(v), safe=""))
            elif m["onde"] == "query":
                query[m["destino"]] = str(v)
            elif m["onde"] == "corpo":
                corpo[m["destino"]] = v
            else:
                cab[m["destino"]] = str(v)
        if RE_PLACEHOLDER.search(url):
            raise ErroConector("URL com campo sem valor")
        if query:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)
        dados = json.dumps(corpo).encode() if corpo or con.metodo != "GET" else None
        if dados is not None:
            cab["Content-Type"] = "application/json"
        cab["Accept"] = "application/json"
        return url, cab, dados

    def chamar(self, con: Conector, entrada: dict, chave_idempotencia: str) -> Resultado:
        t0 = self.relogio()
        try:
            if con.situacao != "ativo":
                raise ErroConector("conector fora de ativo")
            if not self._host_ok(con.empresa_id, con.url):
                raise ErroConector("host não liberado")
            url, cab, corpo = self.montar(con, entrada)
            ctx = self._autenticar(con, cab)
        except Exception as ex:   # noqa: BLE001
            r = Resultado("recusado", latencia_ms=int((self.relogio() - t0) * 1000))
            log.warning("conector %s: classe=recusado motivo=%s", con.id, ex.__class__.__name__)
            return r
        repete = con.tentativas if (con.metodo == "GET" or con.idempotencia) else 0
        if con.metodo != "GET" and con.idempotencia:
            cab["Idempotency-Key"] = chave_idempotencia
        r = Resultado("tempo")
        for tentativa in range(1, repete + 2):
            ini = self.relogio()
            r = self._uma(con, url, cab, corpo, ctx)
            r.tentativa, r.latencia_ms = tentativa, int((self.relogio() - ini) * 1000)
            log.info("conector %s: classe=%s status=%s ms=%s tentativa=%s", con.id, r.classe, r.http_status,
                     r.latencia_ms, tentativa)
            if r.classe not in ("tempo", "http_5xx") or tentativa > repete:
                break
            self.dormir(min(0.2 * tentativa, 0.5))
        return r

    def _uma(self, con, url, cab, corpo, ctx) -> Resultado:
        req = urllib.request.Request(url, data=corpo, method=con.metodo, headers=cab)
        try:
            with self._abrir(req, con.timeout_ms / 1000, ctx) as resp:
                status = int(getattr(resp, "status", None) or resp.getcode())
                bruto = resp.read(MAX_RESPOSTA + 1)
        except urllib.error.HTTPError as ex:
            st = int(ex.code)
            ex.close()
            return Resultado("http_5xx" if st >= 500 else "http_4xx", http_status=st)
        except Exception:   # noqa: BLE001 — tempo, rede, TLS: tudo vira "tempo" (sem detalhe)
            return Resultado("tempo")
        if status >= 300:
            return Resultado("http_5xx" if status >= 500 else "http_4xx", http_status=status)
        if len(bruto) > MAX_RESPOSTA:
            return Resultado("mapa_invalido", http_status=status)
        try:
            resposta = json.loads(bruto.decode("utf-8")) if bruto.strip() else {}
        except (ValueError, UnicodeDecodeError):
            return Resultado("mapa_invalido", http_status=status)
        del bruto
        dados, codigo, ofertas = aplicar_mapa_saida(resposta, con.mapa_saida)
        return Resultado("ok", http_status=status, codigo=codigo, dados=dados, ofertas=ofertas)


CENARIOS_SIMULADOR = ("sucesso", "tempo", "401")


class ConectoresDeExemplo:
    """Para o simulador de texto: cada conector responde com o seu exemplo_resposta (valores de exemplo, gravados
    pela VM no último teste) passando pelo mesmo mapa de saída. `falhar` = ids que respondem tempo esgotado.
    `cenarios` (SQL 66, tela Testar conversa) = {id: "sucesso" | "tempo" | "401"}: a resposta escolhida para o
    conector, que vale acima de `falhar` ("401" = credencial recusada pelo CRM, classe http_4xx)."""

    def __init__(self, falhar: set[int] | None = None, cenarios: dict | None = None):
        self.falhar = set(falhar or ())
        self.cenarios = {int(k): v for k, v in (cenarios or {}).items() if v in CENARIOS_SIMULADOR}

    def chamar(self, con: Conector, entrada: dict, chave_idempotencia: str) -> Resultado:
        cen = self.cenarios.get(con.id)
        if cen == "401":
            return Resultado("http_4xx", http_status=401, latencia_ms=0)
        if cen == "tempo" or (cen is None and con.id in self.falhar):
            return Resultado("tempo", latencia_ms=con.timeout_ms)
        if con.exemplo_resposta is None:
            return Resultado("recusado")
        dados, codigo, ofertas = aplicar_mapa_saida(con.exemplo_resposta, con.mapa_saida)
        return Resultado("ok", http_status=200, latencia_ms=0, codigo=codigo, dados=dados, ofertas=ofertas)
