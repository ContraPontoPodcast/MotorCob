"""De onde vêm as gravações do discador: envio pelo site, SFTP do discador e HTTPS (lista de URLs).

Cada fonte devolve PACOTES: um manifesto e o jeito de pegar o áudio de cada linha dele. A rotina
(voz/importador/rotina.py) não sabe de onde veio o arquivo.

  FonteEnvio   lote enviado pelo site (bucket gravacoes-discador, <slug>/<lote>/<n>.<ext>), baixado com sb.baixar
               (chave do servidor ou bilhete do SQL 57, os dois acessos da VM). O nome original nunca chega ao banco:
               o lote traz o sha-256 do nome (minúsculo), que casa com a coluna arquivo do manifesto. Zip: manifesto e
               áudios dentro (até 5000 itens, 50 MB por áudio; caminho com ".." ou absoluto é ignorado).
  FonteSFTP    pasta do discador (e as subpastas de 1 nível) com a chave pública do servidor FIXADA: servidor com
               outra chave é recusado. Só manifestos (.csv/.json) mudados nos últimos dias_busca dias; o áudio é
               relativo ao manifesto e nunca sai da pasta. Credencial do Secret Manager (senha ou chave privada).
  FonteHTTPS   GET na url_lista (Bearer do Secret Manager, se houver) → manifesto JSON ou CSV, com "proxima"
               (até 20 páginas); cada áudio pela URL, só HTTPS, só nos domínios autorizados, sem redirecionamento e
               nunca para IP interno.
Limites: áudio até 50 MB; manifesto até 50 MB. Erros sem dado pessoal (só o tipo).
"""
from __future__ import annotations

import hashlib
import io
import ipaddress
import json
import posixpath
import socket
import stat as st
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass, field
from typing import Callable

from voz.importador import manifesto as M

BUCKET_ENVIO = "gravacoes-discador"
MAX_AUDIO = 50 * 1024 * 1024
MAX_MANIFESTO = 50 * 1024 * 1024
MAX_ITENS_ZIP = 5000
MAX_PAGINAS = 20
EXT_MANIFESTO = (".csv", ".json")


class ErroAudio(Exception):
    """Áudio que não deu para pegar. motivo = um dos motivos da quarentena (audio_ausente, grande_demais...)."""

    def __init__(self, motivo: str, detalhe: str = ""):
        super().__init__(detalhe or motivo)
        self.motivo, self.detalhe = motivo, detalhe


class ErroFonte(RuntimeError):
    """A fonte inteira falhou (conexão, credencial, servidor com outra chave). repetir = passageiro."""

    def __init__(self, mensagem: str, repetir: bool = True):
        super().__init__(mensagem)
        self.repetir = repetir


def assinatura(*partes) -> str:
    return hashlib.sha256("|".join(str(p) for p in partes).encode()).hexdigest()


def hash_nome(nome: str) -> str:
    """O que o site manda no lote: sha-256 do nome do arquivo (só o nome, minúsculo)."""
    return hashlib.sha256(posixpath.basename(nome.replace("\\", "/")).strip().lower().encode()).hexdigest()


@dataclass
class Pacote:
    nome: str                                    # para o registro (a rotina descarta se tiver dado pessoal)
    assinatura: str
    ler_manifesto: Callable[[], bytes]
    ler_audio: Callable[[M.Linha], bytes]
    forma: str = "arquivo"


# ------------------------------------------------------------------ rede: só endereço público
def endereco_publico(host: str, resolver=socket.getaddrinfo) -> bool:
    """Todos os IPs do host são públicos (nada de rede interna, loopback, link-local/metadados ou reservado)."""
    try:
        ips = {ai[4][0] for ai in resolver(host, None)}
    except (socket.gaierror, UnicodeError, OSError):
        return False
    if not ips:
        return False
    for ip in ips:
        a = ipaddress.ip_address(ip.split("%", 1)[0])
        if a.is_private or a.is_loopback or a.is_link_local or a.is_reserved or a.is_multicast or a.is_unspecified:
            return False
    return True


def dominio_autorizado(host: str, dominios: list[str]) -> bool:
    h = (host or "").lower().rstrip(".")
    return any(h == d or h.endswith("." + d) for d in (x.lower().strip(".") for x in dominios or []) if d)


# ------------------------------------------------------------------ envio pelo site
class FonteEnvio:
    def __init__(self, sb, lote: dict):
        self.sb, self.lote = sb, lote
        self._cache: dict[str, bytes] = {}

    def _baixar(self, caminho: str) -> bytes:
        if caminho not in self._cache:
            self._cache[caminho] = self.sb.baixar(BUCKET_ENVIO, caminho)
        return self._cache[caminho]

    def pacotes(self) -> list[Pacote]:
        arquivos = self.lote.get("arquivos") or []
        por_hash = {a["nome_hash"]: a["caminho"] for a in arquivos}
        soltos = [a for a in arquivos if a["caminho"].rsplit(".", 1)[-1] in ("csv", "json")]
        zips = [a for a in arquivos if a["caminho"].endswith(".zip")]
        zip_abertos: list[zipfile.ZipFile] = []

        def abrir_zips():
            if not zip_abertos:
                for z in zips:
                    try:
                        zf = zipfile.ZipFile(io.BytesIO(self._baixar(z["caminho"])))
                    except zipfile.BadZipFile:
                        raise ErroFonte("zip corrompido", repetir=False) from None
                    if len(zf.infolist()) > MAX_ITENS_ZIP:
                        raise ErroFonte(f"zip com mais de {MAX_ITENS_ZIP} arquivos", repetir=False)
                    zip_abertos.append(zf)
            return zip_abertos

        def audio(ln: M.Linha) -> bytes:
            alvo = posixpath.basename(ln.arquivo or "").lower()
            for zf in abrir_zips():
                for info in zf.infolist():
                    if info.is_dir() or ".." in info.filename.split("/") or info.filename.startswith("/"):
                        continue
                    if posixpath.basename(info.filename).lower() == alvo:
                        if info.file_size > MAX_AUDIO:
                            raise ErroAudio("grande_demais", "áudio acima de 50 MB")
                        return zf.read(info)
            caminho = por_hash.get(hash_nome(ln.arquivo or ""))
            if not caminho:
                raise ErroAudio("audio_ausente", "áudio citado no manifesto não veio no envio")
            dados = self._baixar(caminho)
            if len(dados) > MAX_AUDIO:
                raise ErroAudio("grande_demais", "áudio acima de 50 MB")
            return dados

        out = [Pacote(f"envio {self.lote['id']} · manifesto {i + 1}", assinatura("lote", self.lote["id"], a["caminho"]),
                      (lambda c=a["caminho"]: self._baixar(c)), audio) for i, a in enumerate(soltos)]
        for z in zips:
            try:
                zf = zipfile.ZipFile(io.BytesIO(self._baixar(z["caminho"])))
            except zipfile.BadZipFile:
                raise ErroFonte("zip corrompido", repetir=False) from None
            for info in zf.infolist():
                nome = info.filename
                if info.is_dir() or ".." in nome.split("/") or nome.startswith("/") or \
                        not nome.lower().endswith(EXT_MANIFESTO) or posixpath.basename(nome).startswith("."):
                    continue
                if info.file_size > MAX_MANIFESTO:
                    raise ErroFonte("manifesto acima de 50 MB no zip", repetir=False)
                out.append(Pacote(f"envio {self.lote['id']} · {posixpath.basename(nome)[:60]}",
                                  assinatura("lote", self.lote["id"], z["caminho"], nome),
                                  (lambda zf=zf, i=info: zf.read(i)), audio))
        return out


# ------------------------------------------------------------------ SFTP
def conectar_sftp(cfg: dict, credencial: str, resolver=socket.getaddrinfo):   # pragma: no cover - rede (paramiko)
    """Cliente SFTP do paramiko com a chave do servidor fixada (RejectPolicy) e sem agente/chaves locais."""
    import paramiko
    host, porta = cfg["host"], int(cfg.get("porta") or 22)
    if not endereco_publico(host, resolver):
        raise ErroFonte("servidor SFTP em rede interna ou nome que não resolve", repetir=False)
    tipo, b64 = cfg["chave_host"].split(" ", 1)
    chave = paramiko.PKey.from_type_string(tipo, __import__("base64").b64decode(b64.strip()))
    cli = paramiko.SSHClient()
    cli.get_host_keys().add(host if porta == 22 else f"[{host}]:{porta}", tipo, chave)
    cli.set_missing_host_key_policy(paramiko.RejectPolicy())
    kw = {"look_for_keys": False, "allow_agent": False, "timeout": 30, "banner_timeout": 30, "auth_timeout": 30}
    if credencial.lstrip().startswith("-----BEGIN"):
        pkey = None
        for cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey):
            try:
                pkey = cls.from_private_key(io.StringIO(credencial))
                break
            except paramiko.SSHException:
                continue
        if pkey is None:
            raise ErroFonte("chave privada do cofre em formato não suportado", repetir=False)
        kw["pkey"] = pkey
    else:
        kw["password"] = credencial
    try:
        cli.connect(host, port=porta, username=cfg["usuario"], **kw)
    except paramiko.BadHostKeyException:
        raise ErroFonte("o servidor SFTP apresentou outra chave pública (recusado)", repetir=False) from None
    except paramiko.SSHException as ex:   # inclui a chave desconhecida (RejectPolicy) e a autenticação
        raise ErroFonte(f"SFTP: {ex.__class__.__name__}") from None
    sftp = cli.open_sftp()
    sftp.get_channel().settimeout(60)
    sftp._motorcx_ssh = cli               # fecha junto
    return sftp


class FonteSFTP:
    """sftp: objeto com listdir_attr(pasta), stat(caminho), open(caminho, 'rb') e close() (o do paramiko)."""

    def __init__(self, cfg: dict, sftp, agora_s: float | None = None):
        import time
        self.cfg, self.sftp = cfg, sftp
        self.raiz = posixpath.normpath("/" + (cfg.get("pasta") or "").strip("/")) if (cfg.get("pasta") or "").startswith("/") \
            else posixpath.normpath(cfg.get("pasta") or ".")
        self.limite = (agora_s if agora_s is not None else time.time()) - int(cfg.get("dias_busca") or 7) * 86400

    def _ler(self, caminho: str, maximo: int, motivo_grande: str | None) -> bytes:
        try:
            tam = self.sftp.stat(caminho).st_size
        except (IOError, OSError):
            raise ErroAudio("audio_ausente", "arquivo citado não está na pasta") from None
        if tam > maximo:
            if motivo_grande:
                raise ErroAudio(motivo_grande, "áudio acima de 50 MB")
            raise ErroFonte("manifesto acima de 50 MB", repetir=False)
        with self.sftp.open(caminho, "rb") as f:
            return f.read(maximo + 1)[:maximo]

    def _dentro(self, caminho: str) -> bool:
        c = posixpath.normpath(caminho)
        return c == self.raiz or c.startswith(self.raiz.rstrip("/") + "/")

    def pacotes(self) -> list[Pacote]:
        try:
            itens = [(self.raiz, a) for a in self.sftp.listdir_attr(self.raiz)]
        except (IOError, OSError):
            raise ErroFonte("pasta do SFTP não encontrada ou sem permissão", repetir=False) from None
        for a in [x for _, x in itens if st.S_ISDIR(x.st_mode or 0) and not x.filename.startswith(".")]:
            sub = posixpath.join(self.raiz, a.filename)
            try:
                itens += [(sub, b) for b in self.sftp.listdir_attr(sub)]
            except (IOError, OSError):
                continue
        out = []
        for pasta, a in sorted(itens, key=lambda x: (x[1].st_mtime or 0, x[0], x[1].filename)):
            if st.S_ISDIR(a.st_mode or 0) or not a.filename.lower().endswith(EXT_MANIFESTO) or \
                    a.filename.startswith(".") or (a.st_mtime or 0) < self.limite:
                continue
            cam = posixpath.join(pasta, a.filename)

            def audio(ln: M.Linha, base=pasta) -> bytes:
                alvo = posixpath.normpath(posixpath.join(base, ln.arquivo or ""))
                if not self._dentro(alvo):
                    raise ErroAudio("audio_ausente", "caminho do áudio fora da pasta")
                return self._ler(alvo, MAX_AUDIO, "grande_demais")

            out.append(Pacote(posixpath.relpath(cam, self.raiz)[:120],
                              assinatura("sftp", cam, a.st_size, int(a.st_mtime or 0)),
                              (lambda c=cam: self._ler(c, MAX_MANIFESTO, None)), audio, "sftp"))
        return out

    def fechar(self):
        try:
            ssh = getattr(self.sftp, "_motorcx_ssh", None)
            self.sftp.close()
            if ssh is not None:
                ssh.close()
        except Exception:   # noqa: BLE001 — já fechado
            pass


# ------------------------------------------------------------------ HTTPS
class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirecionamento recusado", headers, fp)


def abridor_padrao():   # pragma: no cover - rede
    op = urllib.request.build_opener(_SemRedirecionar())
    return op.open


@dataclass
class FonteHTTPS:
    cfg: dict
    token: str | None = None
    abrir: Callable = None                      # type: ignore[assignment]
    resolver: Callable = socket.getaddrinfo
    paginas: list = field(default_factory=list)

    def __post_init__(self):
        if self.abrir is None:
            self.abrir = abridor_padrao()

    def _url_ok(self, url: str) -> str:
        p = urllib.parse.urlsplit(url)
        if p.scheme != "https" or not p.hostname or p.username or p.password:
            raise ErroAudio("url_nao_permitida", "só HTTPS, sem usuário na URL")
        if not dominio_autorizado(p.hostname, self.cfg.get("dominios_url") or []):
            raise ErroAudio("url_nao_permitida", "domínio fora da lista autorizada")
        try:
            ipaddress.ip_address(p.hostname)
            raise ErroAudio("url_nao_permitida", "URL com IP em vez de domínio")
        except ValueError:
            pass
        if not endereco_publico(p.hostname, self.resolver):
            raise ErroAudio("url_nao_permitida", "domínio aponta para rede interna ou não resolve")
        return url

    def _get(self, url: str, maximo: int) -> bytes:
        cab = {"User-Agent": "MotorCX-importador/1", "Accept": "*/*"}
        if self.token:
            cab["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(url, headers=cab, method="GET")
        try:
            with self.abrir(req, timeout=60) as r:
                tam = r.headers.get("Content-Length") if getattr(r, "headers", None) else None
                if tam and tam.isdigit() and int(tam) > maximo:
                    raise ErroAudio("grande_demais", "arquivo acima de 50 MB")
                dados = r.read(maximo + 1)
        except urllib.error.HTTPError as ex:   # nunca repassa o corpo; só o status
            raise ErroAudio("download", f"HTTP {ex.code}") from None
        except (urllib.error.URLError, OSError, TimeoutError) as ex:
            raise ErroAudio("download", ex.__class__.__name__) from None
        if len(dados) > maximo:
            raise ErroAudio("grande_demais", "arquivo acima de 50 MB")
        return dados

    def pacotes(self) -> list[Pacote]:
        url = self.cfg.get("url_lista") or ""
        out = []
        vistas = set()
        for n in range(MAX_PAGINAS):
            try:
                self._url_ok(url)
                corpo = self._get(url, MAX_MANIFESTO)
            except ErroAudio as ex:
                raise ErroFonte(f"lista HTTPS: {ex.detalhe or ex.motivo}", repetir=ex.motivo == "download") from None
            prox = None
            if corpo.lstrip()[:1] == b"{":
                try:
                    d = json.loads(corpo.decode("utf-8-sig"))
                    prox = d.get("proxima") if isinstance(d, dict) else None
                except (ValueError, UnicodeDecodeError):
                    prox = None
            out.append(Pacote(f"lista HTTPS · página {n + 1}", assinatura("https", corpo),
                              (lambda c=corpo: c), self._audio, "url"))
            vistas.add(url)
            if not isinstance(prox, str) or not prox or prox in vistas:
                break
            url = prox
        return out

    def _audio(self, ln: M.Linha) -> bytes:
        return self._get(self._url_ok(ln.url or ""), MAX_AUDIO)
