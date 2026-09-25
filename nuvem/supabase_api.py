"""Cliente mínimo do Supabase (REST do banco + Storage), sem dependências.

Usa a chave service_role, que passa por cima do RLS: roda só na máquina da
rotina (nunca no site). Aceita a chave antiga (JWT, começa com "eyJ") e a nova
(sb_secret_...).
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request


class ErroSupabase(RuntimeError):
    def __init__(self, status, corpo, url):
        super().__init__(f"Supabase respondeu {status} em {url}: {corpo[:300]}")
        self.status = status


class Supabase:
    def __init__(self, url: str, chave: str, tentativas: int = 3):
        if not url or not chave:
            raise ValueError("configure a URL e a chave service_role do Supabase")
        self.url = url.rstrip("/")
        self.chave = chave
        self.tentativas = tentativas

    def _cabecalhos(self, extra=None):
        h = {"apikey": self.chave}
        if self.chave.startswith("eyJ"):  # chave legada (JWT)
            h["Authorization"] = f"Bearer {self.chave}"
        h.update(extra or {})
        return h

    def _req(self, metodo, caminho, corpo=None, cabecalhos=None, bruto=False):
        url = self.url + caminho
        dados = corpo if isinstance(corpo, (bytes, type(None))) else json.dumps(corpo, default=str).encode()
        h = self._cabecalhos(cabecalhos)
        if dados is not None and not isinstance(corpo, bytes):
            h.setdefault("Content-Type", "application/json")
        for tentativa in range(self.tentativas):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, dados, h, method=metodo), timeout=120) as r:
                    conteudo = r.read()
                    if bruto:
                        return conteudo
                    return json.loads(conteudo) if conteudo else None
            except urllib.error.HTTPError as e:
                texto = e.read().decode("utf-8", "replace")
                if e.code >= 500 and tentativa + 1 < self.tentativas:
                    time.sleep(2 ** tentativa)
                    continue
                raise ErroSupabase(e.code, texto, url) from None
            except urllib.error.URLError:
                if tentativa + 1 < self.tentativas:
                    time.sleep(2 ** tentativa)
                    continue
                raise

    # ------------------------------------------------------------ banco (PostgREST)
    def selecionar(self, tabela, filtros: dict | None = None, ordem: str | None = None, limite: int | None = None):
        q = {"select": "*", **(filtros or {})}
        if ordem:
            q["order"] = ordem
        if limite:
            q["limit"] = str(limite)
        return self._req("GET", f"/rest/v1/{tabela}?{urllib.parse.urlencode(q)}")

    def inserir(self, tabela, linhas, conflito: str | None = None, retornar=False, lote=1000):
        linhas = linhas if isinstance(linhas, list) else [linhas]
        prefer = ["return=representation" if retornar else "return=minimal"]
        caminho = f"/rest/v1/{tabela}"
        if conflito:
            prefer.append("resolution=merge-duplicates")
            caminho += "?" + urllib.parse.urlencode({"on_conflict": conflito})
        saida = []
        for i in range(0, len(linhas), lote):
            r = self._req("POST", caminho, linhas[i:i + lote], {"Prefer": ",".join(prefer)})
            if retornar and r:
                saida += r
        return saida

    def atualizar(self, tabela, filtros: dict, valores: dict):
        self._req("PATCH", f"/rest/v1/{tabela}?{urllib.parse.urlencode(filtros)}", valores,
                  {"Prefer": "return=minimal"})

    def apagar(self, tabela, filtros: dict):
        if not filtros:
            raise ValueError("apagar sem filtro não é permitido")
        self._req("DELETE", f"/rest/v1/{tabela}?{urllib.parse.urlencode(filtros)}", None,
                  {"Prefer": "return=minimal"})

    # ------------------------------------------------------------ Storage
    def baixar(self, bucket, caminho) -> bytes:
        return self._req("GET", f"/storage/v1/object/{bucket}/{urllib.parse.quote(caminho)}", bruto=True)

    def enviar(self, bucket, caminho, conteudo: bytes, tipo="text/csv"):
        self._req("POST", f"/storage/v1/object/{bucket}/{urllib.parse.quote(caminho)}", conteudo,
                  {"Content-Type": tipo, "x-upsert": "true"}, bruto=True)
