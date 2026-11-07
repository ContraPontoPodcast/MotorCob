"""ID do cliente sem CPF (LGPD; decisão do dono, 07/11/2026).

O CPF nunca é o identificador do cliente. Quando a carga do credor não tem código de cliente (layout automático:
a coluna do cliente É a do CPF) ou quando o "código" que chega tem cara de CPF (11 dígitos com dígito verificador
válido, ou 000.000.000-00), o motor troca o valor por um código pseudônimo estável:

    MX + 16 letras  =  HMAC-SHA256(sal da empresa, "motorcx:id_cliente:v1:" + dígitos do documento)

- Mesmo cliente → mesmo código todo dia (a TAG, a trilha, a régua e o faturamento continuam).
- O sal é o `faturamento_sal` da empresa (SQL 69; só a rotina lê). Sem o sal não dá para voltar ao CPF nem testar
  CPFs. O domínio "motorcx:id_cliente:v1:" separa este uso da chave do faturamento (clientes_mes). O sal nunca muda.
- Só letras (sem dígito): o código nunca parece CPF, telefone ou "10 dígitos seguidos".
- Credor que manda código de cliente de verdade: o código não muda.
- O banco tem a mesma conta (SQL 73: `id_cliente_pseudonimo`), usada para rechavear o que já estava gravado.

`Pseudonimizador` aplica a regra na conversão da carga; `rechavear_pasta` troca os ids antigos (CPF) do estado local
e das saídas da pasta do credor, uma vez (marcador `estado/ids_sem_cpf.txt`). `checar_linhas` é a trava antes de
gravar no banco: id_cliente com cara de CPF não sai do motor.
"""
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
from pathlib import Path

PREFIXO = "MX"
ALFABETO = "BCDFGHJKLMNPQRSTVWXZ"     # 20 consoantes: sem dígito e sem vogal (não forma palavra)
TAMANHO = 16
DOMINIO = "motorcx:id_cliente:v1:"
MARCADOR = "ids_sem_cpf.txt"          # estado/: a pasta já passou pela troca (versão 1)
PENDENTE = "rechavear_banco.json"     # estado/: pares antigo → novo que o banco ainda não trocou (nuvem consome)
ORIGINAIS = "ids_originais.csv"       # base/: código pseudônimo → valor que veio no arquivo (só local, como pessoas.csv)

_PSEUDO = re.compile(rf"^{PREFIXO}[{ALFABETO}]{{{TAMANHO}}}$")
_CPF_FORMATADO = re.compile(r"^\d{3}\.\d{3}\.\d{3}-\d{2}$")
_ONZE = re.compile(r"^\d{11}$")
_SO_DOCUMENTO = re.compile(r"^[\d.\-/\s]+$")


def _dv_ok(d: str) -> bool:
    if len(set(d)) == 1:
        return False
    base = d[:9]
    for n in (9, 10):
        soma = sum(int(x) * p for x, p in zip(base, range(n + 1, 1, -1)))
        base += str((soma * 10 % 11) % 10)
    return base == d


def parece_cpf(valor) -> bool:
    """O valor tem cara de CPF: 000.000.000-00 (qualquer dígito) ou 11 dígitos com dígito verificador válido.
    É a mesma regra do banco (SQL 73: public.parece_cpf), que barra esses valores em id_cliente."""
    v = str(valor or "").strip()
    return bool(_CPF_FORMATADO.match(v)) or (bool(_ONZE.match(v)) and _dv_ok(v))


def e_pseudonimo(valor) -> bool:
    return bool(_PSEUDO.match(str(valor or "")))


def _base(valor: str) -> str:
    """O que entra no HMAC: CPF/CNPJ só com dígitos e o zero à esquerda recomposto (a planilha come o zero; o mesmo
    documento formatado ou não dá o mesmo código); outro valor, como veio (sem espaços nas pontas)."""
    v = str(valor or "").strip()
    d = re.sub(r"\D", "", v)
    if _SO_DOCUMENTO.match(v) and d and len(d) <= 14 and set(d) != {"0"}:
        return d.zfill(11) if len(d) <= 11 else d.zfill(14)
    return v


def pseudonimo(sal: str, valor: str) -> str:
    """Código do cliente: MX + 16 letras do HMAC-SHA256(sal, domínio + documento). Igual ao do banco (SQL 73)."""
    if not sal or len(sal) < 32:
        raise ValueError("sal da empresa inválido para o código do cliente")
    d = hmac.new(sal.encode(), (DOMINIO + _base(valor)).encode(), hashlib.sha256).digest()
    return PREFIXO + "".join(ALFABETO[b % len(ALFABETO)] for b in d[:TAMANHO])


def id_do_cpf(layout) -> bool:
    """O layout usa a coluna do CPF como coluna do cliente (layout automático sem código de cliente)."""
    col = getattr(layout, "colunas", None) or {}
    return bool(col.get("cpf")) and col.get("id_cliente") == col.get("cpf")


def sal_local(pasta) -> str:
    """Sal de quem roda o motor sem a nuvem (Mac, testes): config/sal_id_cliente.txt da pasta, criado na 1ª vez.
    Na nuvem o sal vem SEMPRE do banco (faturamento_sal): nunca cai aqui."""
    arq = Path(pasta) / "config" / "sal_id_cliente.txt"
    if arq.exists():
        sal = arq.read_bytes().decode("utf-8").strip()
        if len(sal) >= 32:
            return sal
    arq.parent.mkdir(parents=True, exist_ok=True)
    sal = secrets.token_hex(32)
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(sal + "\n", encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(arq)
    return sal


class Pseudonimizador:
    """Troca o id que é CPF pelo código pseudônimo. `chave`: o sal (texto) ou uma função que o devolve (só chamada
    quando algum id precisa: credor com código de cliente nunca busca o sal)."""

    def __init__(self, chave):
        self._chave = chave
        self._sal = None
        self._cache: dict[str, str] = {}
        self.originais: dict[str, str] = {}     # código → valor original (para achar o cliente nos outros arquivos)

    @classmethod
    def local(cls, pasta) -> "Pseudonimizador":
        return cls(lambda: sal_local(pasta))

    def sal(self) -> str:
        if self._sal is None:
            self._sal = self._chave() if callable(self._chave) else self._chave
            if not self._sal or len(str(self._sal)) < 32:
                raise RuntimeError("sem o sal da empresa para o código do cliente (rode o SQL 69)")
            self._sal = str(self._sal)
        return self._sal

    def precisa(self, idc, todos: bool = False) -> bool:
        return bool(idc) and not e_pseudonimo(idc) and (todos or parece_cpf(idc))

    def __call__(self, idc, todos: bool = False):
        if not self.precisa(idc, todos):
            return idc
        novo = self._cache.get(idc)
        if novo is None:
            novo = self._cache[idc] = pseudonimo(self.sal(), idc)
        self.originais.setdefault(novo, idc)
        return novo


def gravar_originais(pasta_base, originais: dict[str, str]):
    """base/ids_originais.csv (id_cliente;original): só na pasta local do credor (nunca sobe), para achar o cliente
    quando acordo, baixa, retirada ou ocorrência trazem o valor original (CPF)."""
    arq = Path(pasta_base) / ORIGINAIS
    if not originais:
        arq.unlink(missing_ok=True)
        return
    tmp = arq.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        f.write("id_cliente;original\n" + "".join(f"{k};{v}\n" for k, v in sorted(originais.items())))
    tmp.replace(arq)


def ler_originais(pasta_base) -> dict[str, str]:
    arq = Path(pasta_base) / ORIGINAIS
    if not arq.exists():
        return {}
    with open(arq, newline="", encoding="utf-8") as f:
        return {l["id_cliente"]: l["original"] for l in csv.DictReader(f, delimiter=";")
                if l.get("id_cliente") and l.get("original")}


# ------------------------------------------------------------------ trava antes do banco e do Storage
class IdComCpf(ValueError):
    """id_cliente com cara de CPF a caminho do banco ou do Storage (LGPD: nunca sai do motor)."""


def checar_linhas(tabela: str, linhas) -> None:
    """Levanta IdComCpf se alguma linha leva id_cliente com cara de CPF (ou contrato 'cliente:<CPF>')."""
    for l in linhas if isinstance(linhas, list) else [linhas]:
        if not isinstance(l, dict):
            continue
        if parece_cpf(l.get("id_cliente")):
            raise IdComCpf(f"LGPD: {tabela} recebeu id_cliente com cara de CPF; o motor usa o código pseudônimo")
        ct = l.get("contrato")
        if isinstance(ct, str) and ct.startswith("cliente:") and parece_cpf(ct[8:]):
            raise IdComCpf(f"LGPD: {tabela} recebeu contrato 'cliente:<CPF>'")


def checar_csv(nome: str, conteudo: bytes) -> None:
    """Arquivo que vai para o Storage: coluna id_cliente (qualquer caixa) com cara de CPF levanta IdComCpf.
    A coluna do documento do arquivo do bureau (CPF_CNPJ) é de propósito e não entra aqui."""
    texto = conteudo.decode("utf-8", "replace")
    primeira = texto.split("\n", 1)[0]
    delim = ";" if primeira.count(";") >= primeira.count(",") else ","
    leitor = csv.reader(io.StringIO(texto), delimiter=delim)
    cab = [c.strip().lower() for c in next(leitor, [])]
    if "id_cliente" not in cab:
        return
    i = cab.index("id_cliente")
    for linha in leitor:
        if i < len(linha) and parece_cpf(linha[i]):
            raise IdComCpf(f"LGPD: {nome} tem id_cliente com cara de CPF; o arquivo não foi publicado")


# ------------------------------------------------------------------ troca dos ids antigos da pasta (uma vez)
def _gravar(arq: Path, texto: str):
    tmp = arq.with_name(arq.name + ".rechave")
    tmp.write_text(texto, encoding="utf-8", newline="")
    tmp.replace(arq)


def _csv(arq: Path, mapa: dict) -> int:
    texto = arq.read_bytes().decode("utf-8")
    if not texto:
        return 0
    primeira = texto.split("\n", 1)[0]
    delim = ";" if primeira.count(";") >= primeira.count(",") else ","
    fim = "\r\n" if primeira.endswith("\r") else "\n"
    linhas = list(csv.reader(io.StringIO(texto, newline=""), delimiter=delim))
    if not linhas:
        return 0
    cols = [i for i, c in enumerate(linhas[0]) if c.strip().lower() == "id_cliente"]
    n = 0
    for l in linhas[1:]:
        for i in cols:
            if i < len(l) and l[i] in mapa:
                l[i] = mapa[l[i]]
                n += 1
    if n:
        saida = io.StringIO(newline="")
        csv.writer(saida, delimiter=delim, lineterminator=fim).writerows(linhas)
        _gravar(arq, saida.getvalue())
    return n


def _chaves(d: dict, mapa: dict) -> tuple[dict, int]:
    novo, n = {}, 0
    for k, v in d.items():
        nk = mapa.get(k, k)
        n += nk != k
        if nk in novo and nk != k:      # o código novo já existia (rodada nova antes da troca): fica o mais novo
            continue
        novo[nk] = v
    return novo, n


def _json(arq: Path, mapa: dict, onde) -> int:
    dados = json.loads(arq.read_bytes().decode("utf-8"))
    alvo = dados.get(onde) if onde else dados
    if not isinstance(alvo, dict):
        return 0
    novo, n = _chaves(alvo, mapa)
    for v in novo.values():                       # estados.json: o id_cliente de dentro do estado
        if isinstance(v, dict) and v.get("id_cliente") in mapa:
            v["id_cliente"] = mapa[v["id_cliente"]]
    if not n:
        return 0
    if onde:
        dados[onde] = novo
    else:
        dados = novo
    _gravar(arq, json.dumps(dados, ensure_ascii=False))
    return n


def _linhas(arq: Path, mapa: dict, troca) -> int:
    texto = arq.read_bytes().decode("utf-8")
    saida, n = [], 0
    for l in texto.splitlines(keepends=True):
        nl = troca(l, mapa)
        n += nl != l
        saida.append(nl)
    if n:
        _gravar(arq, "".join(saida))
    return n


def _evento(linha: str, mapa: dict) -> str:
    """eventos_aplicados.txt: fornecedor|id_externo|id_cliente|data."""
    corpo = linha.rstrip("\r\n")
    p = corpo.split("|")
    if len(p) >= 4 and p[-2] in mapa:
        p[-2] = mapa[p[-2]]
        return "|".join(p) + linha[len(corpo):]
    return linha


def _contrato(linha: str, mapa: dict) -> str:
    """contratos_<ciclo>.txt: cliente sem código de contrato conta como 'cliente:<id>'."""
    corpo = linha.rstrip("\r\n")
    if corpo.startswith("cliente:") and corpo[8:] in mapa:
        return "cliente:" + mapa[corpo[8:]] + linha[len(corpo):]
    return linha


def ids_do_estado(pasta_estado) -> list[str]:
    arq = Path(pasta_estado) / "estados.json"
    if not arq.exists():
        return []
    return list((json.loads(arq.read_bytes().decode("utf-8")).get("estados") or {}).keys())


def rechavear_pasta(pasta, mapa: dict[str, str]) -> dict:
    """Troca os ids antigos (CPF) pelos códigos em todo o estado local e nas saídas da pasta do credor. Só mexe na
    coluna/chave do cliente de cada arquivo (nunca num telefone que por acaso tenha os mesmos dígitos). Cada arquivo
    é trocado inteiro (troca atômica); rodar de novo não muda nada. Devolve {arquivo: trocas} e os dias de saida/."""
    pasta = Path(pasta)
    feito, dias = {}, set()
    if not mapa:
        return {"arquivos": feito, "dias": []}
    est = pasta / "estado"
    for nome, onde in (("estados.json", "estados"), ("etapas.json", None), ("bureau_enviados.json", None),
                       ("propensao.json", "clientes")):
        if (est / nome).exists() and (n := _json(est / nome, mapa, onde)):
            feito[f"estado/{nome}"] = n
    if (est / "eventos_aplicados.txt").exists() and (n := _linhas(est / "eventos_aplicados.txt", mapa, _evento)):
        feito["estado/eventos_aplicados.txt"] = n
    for arq in sorted(est.glob("contratos_*.txt")):
        if (n := _linhas(arq, mapa, _contrato)):
            feito[f"estado/{arq.name}"] = n
    arquivos = list(est.glob("*.csv")) + list((pasta / "base").glob("*.csv")) + list((pasta / "saida").rglob("*.csv"))
    for arq in sorted(arquivos):
        if arq.name == ORIGINAIS:
            continue
        if (n := _csv(arq, mapa)):
            rel = arq.relative_to(pasta).as_posix()
            feito[rel] = n
            if rel.startswith("saida/"):
                dias.add(rel.split("/")[1])
    return {"arquivos": feito, "dias": sorted(dias)}


def migrar_pasta(pasta, pseudo: Pseudonimizador, todos: bool) -> dict | None:
    """Uma vez por pasta (marcador estado/ids_sem_cpf.txt): troca os ids antigos que eram CPF (ou, no layout sem
    código de cliente, todos os que não são código) pelo código pseudônimo e deixa os pares para o banco
    (estado/rechavear_banco.json, que a nuvem manda ao SQL 73 e apaga). Devolve o resumo ou None (nada a fazer)."""
    pasta = Path(pasta)
    est = pasta / "estado"
    if (est / MARCADOR).exists():
        return None
    mapa = {}
    for idc in ids_do_estado(est):
        if pseudo.precisa(idc, todos):
            mapa[idc] = pseudonimo(pseudo.sal(), idc)
    r = rechavear_pasta(pasta, mapa) if mapa else {"arquivos": {}, "dias": []}
    if mapa:
        pend = est / PENDENTE
        antigo = json.loads(pend.read_text(encoding="utf-8")) if pend.exists() else {}
        dados = {"pares": {**(antigo.get("pares") or {}), **mapa},
                 "dias": sorted(set(antigo.get("dias") or []) | set(r["dias"]))}
        _gravar(pend, json.dumps(dados, ensure_ascii=False))
    if est.exists():
        _gravar(est / MARCADOR, "1\n")
    return {"clientes": len(mapa), **r} if mapa else None
