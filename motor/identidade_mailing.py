"""Identidade pelo arquivo (mailing) do agente de voz (SQL 88): os dados de validação viram CÓDIGO e o valor some.

O cliente pode mandar na carga a data de nascimento e o documento (ou só os 3 últimos dígitos). Na leitura da carga
(`motor/entrada.py › converter_base`) cada valor é normalizado, vira um código e é descartado:

    código = HMAC-SHA256(chave da empresa, "motorcx:identidade:v1:" + empresa + ":" + id_cliente + ":" + pergunta + ":" + valor)

em 32 hexadecimais. Valor normalizado: DDMM (dia_mes_nascimento), AAAA (ano_nascimento), ddd (ultimos3_documento).
O id do cliente e a pergunta entram no código: dois clientes que fazem aniversário no mesmo dia têm códigos diferentes.

A chave é PRÓPRIA da identidade (Secret Manager `motorcx-voz-identidade-e<empresa>`), nunca o `faturamento_sal`: ela
fica também na VM de voz (que calcula o código do que a pessoa disse) e o sal do faturamento lá daria o id pseudônimo
de qualquer CPF. A VM nunca recebe os códigos guardados: ela manda o código da resposta e o banco compara
(`conferir_identidade_voz`). Quem tem só a VM não tem os códigos; quem tem só o banco não tem a chave.

Na nuvem a chave chega por variável de ambiente (`MOTORCX_IDENTIDADE_E<empresa>=<versão>:<valor>`, gravada pelo
`motorcob-rodar` a partir do Secret Manager; nunca em arquivo, banco ou log). Sem chave: nenhum código, o relatório da
carga só conta e o agente segue com o CRM.

Data inválida (31/02, futura, idade fora de 14–110, a mesma faixa da idade em `entrada._idade`) não gera código.
Saída local: `base/identidade.csv` (id_cliente;pergunta;codigo;versao), reescrito a cada carga, só com quem está na
carga (quem saiu da carteira sai junto). Só biblioteca padrão.
"""
from __future__ import annotations

import base64
import binascii
import csv
import hashlib
import hmac
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

PERGUNTAS = ("dia_mes_nascimento", "ultimos3_documento", "ano_nascimento")
DOMINIO = "motorcx:identidade:v1:"
CAMPOS_CSV = ("id_cliente", "pergunta", "codigo", "versao")
ARQUIVO = "identidade.csv"
FORMATOS_DATA = ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%d.%m.%Y", "%Y%m%d")
IDADE_MIN, IDADE_MAX = 14, 110
RE_CODIGO = re.compile(r"^[0-9a-f]{32}$")
RE_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")
VAR_AMBIENTE = "MOTORCX_IDENTIDADE_E{}"


@dataclass(frozen=True)
class Chave:
    """Chave de identidade de UMA empresa, numa versão. Nunca aparece em repr, log ou exceção."""
    empresa: int
    versao: int
    segredo: bytes = field(repr=False)

    def __repr__(self) -> str:
        return f"Chave(empresa={self.empresa}, versao={self.versao})"


class ChaveInvalida(ValueError):
    pass


def ler_segredo(texto: str) -> bytes:
    """O valor guardado no Secret Manager: 64 hexadecimais (`openssl rand -hex 32`). Aceita também o mesmo texto em
    base64 (como o gcloud mostra o payload em alguns formatos). Nada do valor vai para a mensagem de erro."""
    t = (texto or "").strip()
    if RE_HEX64.match(t):
        return bytes.fromhex(t)
    try:
        d = base64.b64decode(t, validate=True).decode("ascii").strip()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        d = ""
    if RE_HEX64.match(d):
        return bytes.fromhex(d)
    raise ChaveInvalida("chave de identidade fora do formato (64 hexadecimais)")


def chave_do_ambiente(empresa_id, env=None) -> Chave | None:
    """MOTORCX_IDENTIDADE_E<empresa>=<versão>:<valor>. Sem a variável: None. Fora do formato: ChaveInvalida."""
    env = os.environ if env is None else env
    try:
        emp = int(empresa_id)
    except (TypeError, ValueError):
        return None
    bruto = (env.get(VAR_AMBIENTE.format(emp)) or "").strip()
    if not bruto:
        return None
    versao, sep, valor = bruto.partition(":")
    if not sep or not versao.isdigit() or not 1 <= int(versao) <= 1_000_000:
        raise ChaveInvalida(f"{VAR_AMBIENTE.format(emp)} fora do formato <versão>:<valor>")
    return Chave(emp, int(versao), ler_segredo(valor))


def codigo(chave: Chave, id_cliente: str, pergunta: str, valor: str) -> str:
    if pergunta not in PERGUNTAS:
        raise ValueError("pergunta desconhecida")
    msg = f"{DOMINIO}{chave.empresa}:{id_cliente}:{pergunta}:{valor}".encode("utf-8")
    return hmac.new(chave.segredo, msg, hashlib.sha256).hexdigest()[:32]


def iguais(a: str, b: str) -> bool:
    return hmac.compare_digest((a or "").encode(), (b or "").encode())


# ------------------------------------------------------------------ normalização (a mesma na carga e na VM)
def data_nascimento(texto: str, hoje: date, formato: str | None = None) -> date | None:
    """Data válida de nascimento (formato do layout primeiro), sem hora; futura ou idade fora de 14–110: None."""
    v = (texto or "").strip()
    if not v:
        return None
    nasc = None
    for f in ((formato,) if formato else ()) + FORMATOS_DATA:
        for tentativa in (v, v.split(" ")[0], v.split("T")[0]):
            try:
                nasc = datetime.strptime(tentativa, f).date()
                break
            except ValueError:
                continue
        if nasc:
            break
    if nasc is None or nasc >= hoje:
        return None
    anos = hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))
    return nasc if IDADE_MIN <= anos <= IDADE_MAX else None


def ultimos3(texto: str) -> str | None:
    """3 últimos dígitos do documento: de uma coluna só com eles (o zero à esquerda que a planilha comeu volta) ou do
    CPF/CNPJ inteiro (11 ou 14 dígitos, também com os zeros recompostos). Outra coisa: None."""
    d = re.sub(r"\D", "", texto or "")
    if not d or set(d) == {"0"} and len(d) > 3:
        return None
    if len(d) <= 3:
        return d.zfill(3)
    if 9 <= len(d) <= 14:
        return (d.zfill(11) if len(d) <= 11 else d.zfill(14))[-3:]
    return None


def valores(nasc: date | None, doc3: str | None) -> dict[str, str]:
    """{pergunta: valor normalizado} do que existe (só em memória, nunca gravado)."""
    out = {}
    if nasc is not None:
        out["dia_mes_nascimento"] = nasc.strftime("%d%m")
        out["ano_nascimento"] = f"{nasc.year:04d}"
    if doc3 is not None:
        out["ultimos3_documento"] = doc3
    return out


# ------------------------------------------------------------------ arquivo local (base/identidade.csv)
def gravar(pasta: str | Path, linhas: list[dict]) -> None:
    """Reescreve base/identidade.csv (troca atômica). Só códigos."""
    caminho = Path(pasta) / ARQUIVO
    tmp = caminho.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_CSV, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(linhas)
    os.chmod(tmp, 0o600)
    tmp.replace(caminho)


def apagar(pasta: str | Path) -> None:
    (Path(pasta) / ARQUIVO).unlink(missing_ok=True)


def ler(pasta: str | Path) -> list[dict]:
    caminho = Path(pasta) / ARQUIVO
    if not caminho.exists():
        return []
    with open(caminho, newline="", encoding="utf-8") as f:
        return [l for l in csv.DictReader(f, delimiter=";")
                if l.get("pergunta") in PERGUNTAS and RE_CODIGO.match(l.get("codigo") or "")
                and (l.get("versao") or "").isdigit()]


@dataclass
class Leitura:
    """O que a carga trouxe de validação, por cliente: só os códigos (e contagens para o relatório)."""
    chave: Chave | None
    codigos: dict = field(default_factory=dict)            # id_cliente -> {pergunta: código}
    nasc_valida: set = field(default_factory=set)
    nasc_invalida: set = field(default_factory=set)
    doc_valido: set = field(default_factory=set)
    doc_invalido: set = field(default_factory=set)

    def ler_linha(self, idc: str, nasc_txt: str | None, doc_txt: str | None, hoje: date, formato: str | None) -> None:
        """Uma linha da carga (um contrato). O valor fica só aqui dentro, o tempo de virar código."""
        nasc = doc = None
        if nasc_txt is not None and nasc_txt.strip():
            nasc = data_nascimento(nasc_txt, hoje, formato)
            (self.nasc_valida if nasc else self.nasc_invalida).add(idc)
        if doc_txt is not None and doc_txt.strip():
            doc = ultimos3(doc_txt)
            (self.doc_valido if doc else self.doc_invalido).add(idc)
        if self.chave is None:
            return
        for p, v in valores(nasc, doc).items():
            self.codigos.setdefault(idc, {})[p] = codigo(self.chave, idc, p, v)

    def relatorio(self, na_carga: set, mapeadas: dict) -> dict:
        """Só contagens de quem está na carga (nunca valor)."""
        return {
            "colunas": {k: bool(v) for k, v in mapeadas.items()},
            "chave": self.chave is not None,
            "versao_chave": self.chave.versao if self.chave else None,
            "nascimento_validas": len(self.nasc_valida & na_carga),
            "nascimento_invalidas": len((self.nasc_invalida - self.nasc_valida) & na_carga),
            "documento_validos": len(self.doc_valido & na_carga),
            "documento_invalidos": len((self.doc_invalido - self.doc_valido) & na_carga),
            "clientes_com_codigo": len(set(self.codigos) & na_carga),
        }

    def linhas(self, na_carga: set) -> list[dict]:
        if self.chave is None:
            return []
        return [{"id_cliente": idc, "pergunta": p, "codigo": c, "versao": self.chave.versao}
                for idc in sorted(set(self.codigos) & na_carga) for p, c in sorted(self.codigos[idc].items())]
