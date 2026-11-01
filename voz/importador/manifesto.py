"""Manifesto das gravações do discador (CSV ou JSON): leitura e validação estrita.

Uma linha por gravação. Colunas (o cabeçalho aceita os apelidos de COLUNAS; maiúsculas, acentos e espaços não
importam):
  id_chamada          obrigatório. ID da ligação no discador (letras, números, _ . : -; até 80).
  inicio              obrigatório. Data e hora do início (ISO 8601, AAAA-MM-DD HH:MM[:SS] ou DD/MM/AAAA HH:MM[:SS];
                      sem fuso = America/Sao_Paulo). Até 120 dias para trás.
  duracao_s           obrigatório. Segundos (0 a 14400).
  arquivo | url       um dos dois. Arquivo de áudio (wav, mp3, ogg, opus, flac, m4a) relativo ao manifesto, ou a URL
                      HTTPS do áudio (só na fonte HTTPS).
  operador_ref        ID do operador no discador (sem 8+ dígitos seguidos, sem @).
  id_cliente, id_acao códigos do MotorCX (nunca CPF, nome, telefone ou e-mail).
  carteira            código da carteira (credores.codigo) da empresa.
  id_chamada_motorcx  o X-MotorCX-Id-Chamada que o discador recebeu na transferência (par exato).
Arquivo com coluna de CPF, nome, telefone ou e-mail é recusado inteiro; coluna desconhecida também (estrito). Linha
com padrão de dado pessoal em qualquer campo vai para a quarentena (motivo dado_pessoal), sem guardar o valor.

O id_chamada vira a chave da importação (hash, só letras a–p: nunca uma sequência de dígitos) e só aparece como
referência quando não tem 10+ dígitos seguidos (poderia ser telefone); senão a referência é "h-<10 letras>".
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import posixpath
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")
MAX_LINHAS = 50_000
MAX_DURACAO_S = 14_400
DIAS_ATRAS = 120
EXT_AUDIO = ("wav", "mp3", "ogg", "opus", "flac", "m4a")

COLUNAS = {
    "id_chamada": ("id_chamada", "call_id", "callid", "uniqueid", "id_ligacao", "chamada"),
    "inicio": ("inicio", "data_hora", "inicio_em", "inicio_chamada", "start", "started_at", "data_hora_inicio"),
    "duracao_s": ("duracao_s", "duracao", "duration", "billsec", "duracao_segundos"),
    "arquivo": ("arquivo", "gravacao", "arquivo_gravacao", "file", "filename", "nome_arquivo"),
    "url": ("url", "url_gravacao", "link", "link_gravacao"),
    "operador_ref": ("operador_ref", "operador", "id_operador", "agente", "agent_id", "ramal_operador"),
    "id_cliente": ("id_cliente", "cliente_id", "codigo_cliente", "cod_cliente"),
    "id_acao": ("id_acao", "acao_id", "codigo_acao"),
    "carteira": ("carteira", "credor", "codigo_carteira", "cod_carteira"),
    "id_chamada_motorcx": ("id_chamada_motorcx", "x_motorcx_id_chamada", "motorcx_id_chamada", "id_motorcx"),
}
APELIDO = {a: c for c, aps in COLUNAS.items() for a in aps}
# coluna que por si só é dado pessoal (algum pedaço do nome dela): o arquivo inteiro é recusado e o valor nunca é lido
PROIBIDAS = ("cpf", "cnpj", "documento", "rg", "nome", "devedor", "telefone", "fone", "celular", "numero", "destino",
             "ani", "dnis", "bina", "email", "mail", "endereco", "nascimento", "whatsapp")


def coluna_pessoal(col: str) -> bool:
    if col in APELIDO:                       # as colunas conhecidas (ex.: nome_arquivo) valem como estão
        return False
    partes = col.split("_")
    return any(p in PROIBIDAS for p in partes) or "e_mail" in col

ID = re.compile(r"^[A-Za-z0-9_.:\-]{1,80}$")
ID_MOTORCX = re.compile(r"^[A-Za-z0-9_.:\-]{4,80}$")
CODIGO = re.compile(r"^[A-Za-z0-9_.:\-/]{1,60}$")
CODIGO_ACAO = re.compile(r"^[A-Za-z0-9_.:\-/]{1,80}$")
OPERADOR = re.compile(r"^[A-Za-z0-9_.:\-]{1,40}$")
CARTEIRA = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
ARQUIVO = re.compile(r"^[A-Za-z0-9_.\- /()]{1,200}$")

CPF_FORMATADO = re.compile(r"\d{3}\.\d{3}\.\d{3}-\d{2}")
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}")
TELEFONE_FORMATADO = re.compile(r"\(?\d{2}\)?[\s.\-]?9?\d{4}[\s.\-]\d{4}")
DIGITOS_LONGOS = re.compile(r"\d{10,}")


class ErroManifesto(ValueError):
    """Arquivo inteiro recusado (cabeçalho, formato ou tamanho). A mensagem nunca traz valor de célula."""


@dataclass
class Linha:
    n: int
    id_chamada: str
    chave: str
    ref: str
    inicio: datetime
    duracao_s: int
    arquivo: str | None = None
    url: str | None = None
    operador_ref: str | None = None
    id_cliente: str | None = None
    id_acao: str | None = None
    carteira: str | None = None
    credor_id: int | None = None
    id_chamada_motorcx: str | None = None

    @property
    def extensao(self) -> str:
        alvo = self.arquivo or posixpath.basename((self.url or "").split("?", 1)[0])
        return alvo.rsplit(".", 1)[-1].lower() if "." in alvo else ""


@dataclass
class Rejeicao:
    linha: int
    ref: str
    motivo: str
    detalhe: str = ""

    def para_banco(self) -> dict:
        return {"ref": self.ref, "motivo": self.motivo, "linha": self.linha, "detalhe": self.detalhe[:120]}


@dataclass
class Leitura:
    linhas: list[Linha] = field(default_factory=list)
    rejeicoes: list[Rejeicao] = field(default_factory=list)
    total: int = 0


# ------------------------------------------------------------------ chave, referência e dado pessoal
def chave(empresa_id: int, id_chamada: str) -> str:
    """24 letras a–p do sha-256 de 'empresa:id_chamada' (sem dígito: nunca parece telefone no caminho do bucket)."""
    h = hashlib.sha256(f"{int(empresa_id)}:{id_chamada}".encode()).hexdigest()[:24]
    return h.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))


def ref_segura(id_chamada: str | None, ch: str | None, n: int) -> str:
    if id_chamada and ID.match(id_chamada) and not DIGITOS_LONGOS.search(id_chamada):
        return id_chamada
    if ch:
        return "h-" + ch[:10]
    return f"linha-{n}"


def cpf_valido(d: str) -> bool:
    if len(d) != 11 or not d.isdigit() or d == d[0] * 11:
        return False
    for k in (9, 10):
        soma = sum(int(d[i]) * (k + 1 - i) for i in range(k))
        if int(d[k]) != (soma * 10 % 11) % 10:
            return False
    return True


def tem_dado_pessoal(valor: str) -> bool:
    """CPF (formatado ou 11 dígitos válidos), e-mail, telefone formatado ou 10+ dígitos seguidos (telefone, CPF)."""
    v = valor or ""
    if CPF_FORMATADO.search(v) or EMAIL.search(v) or TELEFONE_FORMATADO.search(v) or DIGITOS_LONGOS.search(v):
        return True
    return any(cpf_valido(x) for x in re.findall(r"\d+", v))


# ------------------------------------------------------------------ leitura
def _norm(nome: str) -> str:
    s = unicodedata.normalize("NFKD", str(nome or "")).encode("ascii", "ignore").decode().strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _texto(conteudo: bytes) -> str:
    for cod in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return conteudo.decode(cod)
        except UnicodeDecodeError:
            continue
    raise ErroManifesto("codificação do arquivo não reconhecida")   # pragma: no cover - latin-1 sempre decodifica


def registros(conteudo: bytes, nome: str = "") -> tuple[list[str], list[dict]]:
    """(colunas normalizadas, linhas como dict coluna→texto). JSON: lista de objetos ou {"gravacoes": [...]}."""
    if len(conteudo) > 50 * 1024 * 1024:
        raise ErroManifesto("manifesto acima de 50 MB")
    txt = _texto(conteudo).strip()
    if not txt:
        raise ErroManifesto("manifesto vazio")
    if nome.lower().endswith(".json") or txt[:1] in "[{":
        try:
            d = json.loads(txt)
        except json.JSONDecodeError:
            raise ErroManifesto("JSON inválido") from None
        lista = d.get("gravacoes", d.get("itens")) if isinstance(d, dict) else d
        if not isinstance(lista, list) or any(not isinstance(x, dict) for x in lista):
            raise ErroManifesto('JSON: uma lista de objetos (ou {"gravacoes": [...]})')
        cols: list[str] = []
        linhas = []
        for x in lista:
            r = {}
            for k, v in x.items():
                nk = _norm(k)
                if nk not in cols:
                    cols.append(nk)
                r[nk] = "" if v is None else str(v)
            linhas.append(r)
        return cols, linhas
    amostra = txt[:4096]
    try:
        dialeto = csv.Sniffer().sniff(amostra.splitlines()[0] if amostra else amostra, delimiters=";,\t|")
        sep = dialeto.delimiter
    except csv.Error:
        sep = ";"
    leitor = csv.reader(io.StringIO(txt), delimiter=sep)
    try:
        cab = [_norm(c) for c in next(leitor)]
    except StopIteration:   # pragma: no cover - txt não é vazio
        raise ErroManifesto("manifesto vazio") from None
    linhas = []
    for cel in leitor:
        if not any(c.strip() for c in cel):
            continue
        if len(cel) > len(cab):
            raise ErroManifesto(f"linha {len(linhas) + 2} com mais colunas que o cabeçalho")
        linhas.append({cab[i]: (cel[i] if i < len(cel) else "") for i in range(len(cab))})
    return cab, linhas


def conferir_colunas(colunas: list[str], forma: str) -> dict[str, str]:
    """Coluna do arquivo → coluna canônica. Recusa o arquivo com coluna de dado pessoal ou desconhecida."""
    pessoais = [c for c in colunas if coluna_pessoal(c)]
    if pessoais:
        raise ErroManifesto(f"coluna com dado pessoal não é aceita: {', '.join(pessoais)}")
    desconhecidas = [c for c in colunas if c and c not in APELIDO]
    if desconhecidas:
        raise ErroManifesto(f"coluna desconhecida: {', '.join(d[:30] for d in desconhecidas[:5])}")
    mapa: dict[str, str] = {}
    for c in colunas:
        canon = APELIDO[c]
        if canon in mapa.values():
            raise ErroManifesto(f"coluna repetida: {canon}")
        mapa[c] = canon
    faltam = [c for c in ("id_chamada", "inicio", "duracao_s") if c not in mapa.values()]
    if faltam:
        raise ErroManifesto(f"faltam colunas obrigatórias: {', '.join(faltam)}")
    audio = "url" if forma == "url" else "arquivo"
    if audio not in mapa.values():
        raise ErroManifesto(f"falta a coluna {audio} (o áudio de cada linha)")
    return mapa


FORMATOS_DATA = ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S",
                 "%d/%m/%Y %H:%M")


def ler_data(v: str) -> datetime | None:
    s = (v or "").strip().replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        d = None
        for fmt in FORMATOS_DATA:
            try:
                d = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue
    if d is None:
        return None
    return d.replace(tzinfo=TZ) if d.tzinfo is None else d


def ler(conteudo: bytes, nome: str, empresa_id: int, carteiras: dict[str, int] | None = None, forma: str = "arquivo",
        agora: datetime | None = None) -> Leitura:
    """Lê e valida o manifesto inteiro. ErroManifesto = arquivo recusado; senão linhas boas + rejeições por linha."""
    colunas, brutas = registros(conteudo, nome)
    mapa = conferir_colunas(colunas, forma)
    if len(brutas) > MAX_LINHAS:
        raise ErroManifesto(f"mais de {MAX_LINHAS} linhas: divida o manifesto")
    agora = agora or datetime.now(TZ)
    carteiras = carteiras or {}
    out = Leitura(total=len(brutas))
    vistos: set[str] = set()
    for i, bruta in enumerate(brutas, start=1):
        r = {mapa[k]: (v or "").strip() for k, v in bruta.items() if k in mapa}
        idc = r.get("id_chamada") or ""
        ch = chave(empresa_id, idc) if idc and ID.match(idc) else None
        ref = ref_segura(idc, ch, i)

        def rej(motivo: str, detalhe: str = "") -> None:
            out.rejeicoes.append(Rejeicao(i, ref, motivo, detalhe))

        if not idc or not ID.match(idc):
            rej("campo_invalido", "id_chamada vazio ou com caractere fora do padrão")
            continue
        # dado pessoal em qualquer campo de código guardado (o id_chamada vira hash; o id_chamada_motorcx, um uuid do
        # MotorCX, só serve para achar o par e não é guardado; o áudio tem regra própria)
        pessoal = [c for c in ("operador_ref", "id_cliente", "id_acao", "carteira")
                   if r.get(c) and tem_dado_pessoal(r[c])]
        if pessoal:
            rej("dado_pessoal", "padrão de CPF, telefone ou e-mail em " + ", ".join(pessoal))
            continue
        if any(EMAIL.search(r.get(c) or "") or CPF_FORMATADO.search(r.get(c) or "") for c in ("arquivo", "url")):
            rej("nome_com_dado_pessoal", "nome do áudio com CPF ou e-mail (nome descartado)")
            continue
        if ch in vistos:
            rej("duplicada_no_arquivo", "id_chamada repetido no manifesto")
            continue
        inicio = ler_data(r.get("inicio", ""))
        if inicio is None:
            rej("campo_invalido", "inicio: data e hora fora do formato")
            continue
        if inicio > agora + timedelta(days=1) or inicio < agora - timedelta(days=DIAS_ATRAS):
            rej("campo_invalido", f"inicio fora da janela (até {DIAS_ATRAS} dias atrás)")
            continue
        try:
            dur = float((r.get("duracao_s") or "").replace(",", "."))
        except ValueError:
            dur = -1
        if not 0 <= dur <= MAX_DURACAO_S:
            rej("campo_invalido", "duracao_s: segundos entre 0 e 14400")
            continue
        op = r.get("operador_ref") or None
        if op and (not OPERADOR.match(op) or re.search(r"\d{8,}", op)):
            rej("campo_invalido", "operador_ref: até 40 letras, números ou _ . : -")
            continue
        cli = r.get("id_cliente") or None
        if cli and not CODIGO.match(cli):
            rej("campo_invalido", "id_cliente: só o código (sem espaço)")
            continue
        acao = r.get("id_acao") or None
        if acao and not CODIGO_ACAO.match(acao):
            rej("campo_invalido", "id_acao: só o código (sem espaço)")
            continue
        cart = (r.get("carteira") or "").lower() or None
        credor_id = None
        if cart:
            if not CARTEIRA.match(cart) or cart not in carteiras:
                rej("carteira_desconhecida", "carteira: código que não é desta empresa")
                continue
            credor_id = int(carteiras[cart])
        mcx = r.get("id_chamada_motorcx") or None
        if mcx and not ID_MOTORCX.match(mcx):
            rej("campo_invalido", "id_chamada_motorcx fora do padrão")
            continue
        arq = url = None
        if forma == "url":
            url = r.get("url") or ""
            if not url.lower().startswith("https://") or len(url) > 1000:
                rej("url_nao_permitida", "url: só HTTPS")
                continue
        else:
            arq = (r.get("arquivo") or "").replace("\\", "/")
            if not arq or not ARQUIVO.match(arq) or arq.startswith("/") or ".." in arq.split("/"):
                rej("audio_ausente", "arquivo vazio ou com caminho inválido")
                continue
            if DIGITOS_LONGOS.search(posixpath.basename(arq)) or any(cpf_valido(x) for x in re.findall(r"\d+", arq)):
                rej("nome_com_dado_pessoal", "nome do arquivo com telefone ou CPF (nome descartado)")
                continue
        ln = Linha(i, idc, ch, ref, inicio, int(round(dur)), arquivo=arq, url=url, operador_ref=op, id_cliente=cli,
                   id_acao=acao, carteira=cart, credor_id=credor_id, id_chamada_motorcx=mcx)
        if ln.extensao not in EXT_AUDIO:
            rej("formato", "áudio fora dos formatos aceitos (wav, mp3, ogg, opus, flac, m4a)")
            continue
        vistos.add(ch)
        out.linhas.append(ln)
    return out


# ------------------------------------------------------------------ áudio
def formato_audio(dados: bytes) -> str | None:
    """Formato pelo conteúdo (não pelo nome): wav, mp3, ogg (ogg/opus), flac, m4a; senão None."""
    if len(dados) < 12:
        return None
    if dados[:4] == b"RIFF" and dados[8:12] == b"WAVE":
        return "wav"
    if dados[:3] == b"ID3" or (dados[0] == 0xFF and (dados[1] & 0xE0) == 0xE0):
        return "mp3"
    if dados[:4] == b"OggS":
        return "ogg"
    if dados[:4] == b"fLaC":
        return "flac"
    if dados[4:8] == b"ftyp":
        return "m4a"
    return None


def audio_confere(extensao: str, dados: bytes) -> bool:
    f = formato_audio(dados)
    return f is not None and (f == extensao or (f == "ogg" and extensao == "opus"))


TIPOS = {"wav": "audio/wav", "mp3": "audio/mpeg", "ogg": "audio/ogg", "opus": "audio/ogg", "flac": "audio/flac",
         "m4a": "audio/mp4"}
