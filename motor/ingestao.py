"""Ingestão de arquivos de retorno de fornecedor → eventos canônicos.

Cada fornecedor tem um layout declarativo em `layouts/<fornecedor>.json`
(colunas, formato de data, separador decimal e o de-para dos códigos dele para
o vocabulário da taxonomia). Fornecedor novo = layout novo, sem código novo.

Nada é classificado por palpite: código que o layout não conhece vai para a
quarentena, que é a fila de trabalho do agente de Ingestão (ele propõe o
de-para, um humano aprova, o layout é versionado).
"""
import csv
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from fnmatch import fnmatch
from pathlib import Path

from . import normalizacao as norm
from .certificacao import Evento
from .taxonomia import CANAIS_EMAIL, TAXONOMIA

CAMPOS_OBRIGATORIOS = ("cpf", "contato", "data", "resultado", "id_externo")


class LayoutInvalido(ValueError):
    pass


@dataclass(frozen=True)
class Layout:
    fornecedor: str
    canal: str
    arquivo: str                 # padrão de nome (glob) dos arquivos deste fornecedor
    colunas: dict[str, str]      # campo canônico -> coluna no arquivo
    formato_data: str
    resultados: dict[str, str]   # código do fornecedor -> resultado da taxonomia
    delimitador: str = ","
    encoding: str = "utf-8"
    decimal: str = "."
    custo_fixo: float | None = None

    @property
    def tipo_contato(self) -> str:
        return "email" if self.canal in CANAIS_EMAIL else "telefone"


def validar_layout(dados: dict) -> Layout:
    """Carrega e valida um layout. Um de-para errado aqui contaminaria todo o score."""
    try:
        layout = Layout(**dados)
    except TypeError as e:
        raise LayoutInvalido(f"{dados.get('fornecedor', '?')}: {e}") from None
    if layout.canal not in TAXONOMIA:
        raise LayoutInvalido(f"{layout.fornecedor}: canal desconhecido '{layout.canal}'")
    faltando = [c for c in CAMPOS_OBRIGATORIOS if c not in layout.colunas]
    if faltando:
        raise LayoutInvalido(f"{layout.fornecedor}: colunas sem mapeamento {faltando}")
    if "custo" not in layout.colunas and layout.custo_fixo is None:
        raise LayoutInvalido(f"{layout.fornecedor}: informe coluna 'custo' ou 'custo_fixo'")
    fora = sorted({r for r in layout.resultados.values() if r not in TAXONOMIA[layout.canal]})
    if fora:
        raise LayoutInvalido(f"{layout.fornecedor}: resultados fora da taxonomia de {layout.canal}: {fora}")
    return layout


def carregar_layouts(pasta: str | Path) -> list[Layout]:
    return [validar_layout(json.loads(p.read_text(encoding="utf-8")))
            for p in sorted(Path(pasta).glob("*.json"))]


@dataclass
class Relatorio:
    fornecedor: str
    arquivo: str
    linhas: int = 0
    aceitas: int = 0
    duplicadas: int = 0
    rejeitadas: Counter = field(default_factory=Counter)      # motivo -> qtd
    desconhecidos: Counter = field(default_factory=Counter)   # código -> qtd


def _mascarar(valor: str) -> str:
    return valor[:2] + "*" * max(len(valor) - 4, 0) + valor[-2:] if len(valor) > 4 else "****"


def ler_retorno(caminho: str | Path, layout: Layout, vistos: set | None = None):
    """Lê um arquivo de retorno. Retorna (eventos, relatorio, quarentena).

    quarentena: linhas com código desconhecido, com o contato mascarado (LGPD).
    """
    caminho = Path(caminho)
    vistos = set() if vistos is None else vistos
    rel = Relatorio(layout.fornecedor, caminho.name)
    eventos, quarentena = [], []
    col = layout.colunas
    with open(caminho, newline="", encoding=layout.encoding) as f:
        leitor = csv.DictReader(f, delimiter=layout.delimitador)
        ausentes = [c for c in col.values() if c not in (leitor.fieldnames or [])]
        if ausentes:
            raise LayoutInvalido(f"{caminho.name}: colunas ausentes no arquivo {ausentes}")
        for n, linha in enumerate(leitor, start=2):  # linha 1 é o cabeçalho
            rel.linhas += 1
            codigo = (linha[col["resultado"]] or "").strip()
            resultado = layout.resultados.get(codigo)
            if resultado is None:
                rel.desconhecidos[codigo] += 1
                quarentena.append({"fornecedor": layout.fornecedor, "canal": layout.canal,
                                   "arquivo": caminho.name, "linha": n, "codigo": codigo,
                                   "contato": _mascarar(linha[col["contato"]] or "")})
                continue
            cpf = norm.cpf(linha[col["cpf"]])
            if cpf is None:
                rel.rejeitadas["cpf inválido"] += 1
                continue
            contato = norm.contato(linha[col["contato"]], layout.tipo_contato)
            if contato is None:
                rel.rejeitadas["contato inválido"] += 1
                continue
            try:
                data = datetime.strptime(linha[col["data"]].strip(), layout.formato_data).date()
            except (ValueError, AttributeError):
                rel.rejeitadas["data inválida"] += 1
                continue
            if layout.custo_fixo is not None:
                custo = layout.custo_fixo
            else:
                try:
                    custo = float(linha[col["custo"]].strip().replace(layout.decimal, "."))
                except (ValueError, AttributeError):
                    rel.rejeitadas["custo inválido"] += 1
                    continue
            id_externo = (linha[col["id_externo"]] or "").strip()
            if (layout.fornecedor, id_externo) in vistos:
                rel.duplicadas += 1
                continue
            vistos.add((layout.fornecedor, id_externo))
            eventos.append(Evento(cpf, contato, layout.tipo_contato, layout.canal, resultado,
                                  data, custo, fornecedor=layout.fornecedor, id_externo=id_externo))
            rel.aceitas += 1
    return eventos, rel, quarentena


def ingerir_pasta(pasta_retornos: str | Path, layouts: list[Layout]):
    """Lê todos os arquivos da pasta. Retorna (eventos, relatorios, quarentena, sem_layout)."""
    eventos, relatorios, quarentena, sem_layout = [], [], [], []
    vistos: set = set()
    for arq in sorted(Path(pasta_retornos).glob("*")):
        if not arq.is_file():
            continue
        candidatos = [l for l in layouts if fnmatch(arq.name, l.arquivo)]
        if len(candidatos) != 1:
            sem_layout.append(arq.name if not candidatos else f"{arq.name} (layouts ambíguos)")
            continue
        ev, rel, q = ler_retorno(arq, candidatos[0], vistos)
        eventos += ev
        relatorios.append(rel)
        quarentena += q
    return eventos, relatorios, quarentena, sem_layout


def carregar_carteira(caminho: str | Path) -> tuple[list[dict], Counter]:
    """Base de contatos da carteira (cpf;contato;tipo[;origem]), normalizada.

    Inclui contatos nunca acionados — é o que permite planejar o cold start.
    """
    contatos, rejeitados, vistos = [], Counter(), set()
    with open(caminho, newline="", encoding="utf-8") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            tipo = (linha.get("tipo") or "").strip().lower()
            if tipo not in ("telefone", "email"):
                rejeitados["tipo inválido"] += 1
                continue
            cpf, contato = norm.cpf(linha.get("cpf")), norm.contato(linha.get("contato"), tipo)
            if cpf is None or contato is None:
                rejeitados["cpf ou contato inválido"] += 1
                continue
            if (cpf, contato) in vistos:
                continue
            vistos.add((cpf, contato))
            contatos.append({"cpf": cpf, "contato": contato, "tipo": tipo,
                             "origem": (linha.get("origem") or "").strip() or None})
    return contatos, rejeitados
