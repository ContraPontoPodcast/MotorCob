"""Arquivos que cada empresa cliente manda: base bruta e ocorrências.

Cada empresa tem um arquivo de entrada em `empresas/<slug>.json` que diz como ler
os dois arquivos dela (colunas, separador, formato de data e o de-para dos códigos).
Empresa nova = arquivo novo, sem código novo.

- Base bruta: a planilha de envio das ações (cliente, contrato, saldo, atraso e os
  telefones/e-mails em colunas). Vira a base canônica do motor
  (base/clientes.csv e base/contatos.csv).
- Ocorrência: uma linha por tentativa dizendo se deu CPC ou não. Em geral não traz o
  contato: quem sabe qual contato foi usado é o MotorCob, que guarda em
  estado/escolhas.csv o que mandou acionar em cada dia (ID, canal e contato).

O resultado da ocorrência é traduzido em dois passos: o código da empresa vira um
resultado genérico (cpc, sem_contato, atendida_sem_cpc, terceiro, invalido, opt_out)
e o genérico vira o resultado da taxonomia do canal. Código que o de-para não conhece
vai para a quarentena, como nos retornos de fornecedor.
"""
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from fnmatch import fnmatch
from pathlib import Path

from . import normalizacao as norm
from .certificacao import Evento
from .cluster import tipos_das_colunas
from .ingestao import LayoutInvalido, _mascarar, _sim
from .taxonomia import CANAIS_EMAIL, TAXONOMIA

# resultado genérico -> resultado da taxonomia, por canal
GENERICOS: dict[str, dict[str, str]] = {
    "cpc": {"discador": "cpc", "agente_voz": "cpc", "whatsapp": "identidade_confirmada",
            "rcs": "identidade_confirmada", "sms": "identidade_confirmada", "email": "identidade_confirmada"},
    "sem_contato": {"discador": "nao_atendida", "agente_voz": "nao_atendida", "whatsapp": "entregue",
                    "rcs": "entregue", "sms": "entregue", "email": "entregue"},
    "atendida_sem_cpc": {"discador": "atendida_sem_cpc", "agente_voz": "atendida_sem_cpc", "whatsapp": "lido",
                         "rcs": "lido", "sms": "entregue", "email": "abertura"},
    "terceiro": {"discador": "atendida_terceiro_desconhece", "agente_voz": "atendida_terceiro_desconhece",
                 "whatsapp": "desconhece", "rcs": "desconhece", "sms": "desconhece", "email": "desconhece"},
    "invalido": {"discador": "numero_inexistente", "agente_voz": "numero_inexistente", "whatsapp": "sem_conta",
                 "rcs": "nao_entregue", "sms": "nao_entregue", "email": "hard_bounce"},
    "opt_out": {"whatsapp": "bloqueio", "sms": "opt_out", "email": "descadastro"},
}
DIAS_BUSCA_ESCOLHA = 3   # ocorrência de hoje pode ser de uma ação exportada até 3 dias antes
CAMPOS_ESCOLHA = ("data", "id_cliente", "canal", "contato", "ordem_contato", "reserva")
_DATA_NO_NOME = re.compile(r"(20\d{2})-?(\d{2})-?(\d{2})")


def _tipo(canal: str) -> str:
    return "email" if canal in CANAIS_EMAIL else "telefone"


def traduzir(canal: str, valor: str) -> str | None:
    """Resultado do de-para (genérico ou já da taxonomia) -> resultado da taxonomia do canal."""
    if valor in GENERICOS:
        return GENERICOS[valor].get(canal)
    return valor if valor in TAXONOMIA.get(canal, {}) else None


# ------------------------------------------------------------------ configuração
@dataclass(frozen=True)
class LayoutBase:
    arquivo: str = "base*"
    colunas: dict[str, str] = field(default_factory=dict)  # id_cliente, saldo, dias_atraso|vencimento, ...
    telefones: list = field(default_factory=list)          # "COLUNA" ou {"coluna": ..., "whatsapp": ...}
    emails: list[str] = field(default_factory=list)
    formato_data: str = "%d/%m/%Y"
    delimitador: str = ";"
    encoding: str = "utf-8"
    decimal: str = ","
    origem: str = "cliente"
    base_completa: bool = False  # cada arquivo traz a carteira toda: quem sumiu da última sai das ações


@dataclass(frozen=True)
class LayoutOcorrencia:
    arquivo: str
    colunas: dict[str, str]              # id_cliente, data, resultado; opcionais canal, contato, id_externo, custo
    resultados: dict[str, str]           # código da empresa -> genérico ou resultado da taxonomia
    canal: str | None = None             # arquivo de um canal só
    canais: dict[str, str] = field(default_factory=dict)  # valor da coluna canal -> canal do motor
    formato_data: str = "%d/%m/%Y"
    delimitador: str = ";"
    encoding: str = "utf-8"
    decimal: str = ","
    custo_fixo: dict[str, float] = field(default_factory=dict)  # canal -> custo por tentativa


@dataclass(frozen=True)
class Entrada:
    empresa: str
    base: LayoutBase
    ocorrencias: list[LayoutOcorrencia]


def validar_entrada(dados: dict) -> Entrada:
    emp = dados.get("empresa") or "?"
    try:
        base = LayoutBase(**dados["base"])
        ocs = dados.get("ocorrencia") or []
        ocs = [LayoutOcorrencia(**o) for o in (ocs if isinstance(ocs, list) else [ocs])]
    except (TypeError, KeyError) as e:
        raise LayoutInvalido(f"{emp}: {e}") from None
    if "id_cliente" not in base.colunas:
        raise LayoutInvalido(f"{emp}: base sem coluna id_cliente")
    if "saldo" not in base.colunas or not ({"dias_atraso", "vencimento"} & set(base.colunas)):
        raise LayoutInvalido(f"{emp}: base precisa de saldo e de dias_atraso ou vencimento")
    if not base.telefones and not base.emails:
        raise LayoutInvalido(f"{emp}: base sem colunas de telefone ou e-mail")
    for o in ocs:
        faltando = [c for c in ("id_cliente", "data", "resultado") if c not in o.colunas]
        if faltando:
            raise LayoutInvalido(f"{emp}: ocorrência {o.arquivo} sem {faltando}")
        canais = ({o.canal} if o.canal else set()) | set(o.canais.values())
        fora = sorted(c for c in canais if c not in TAXONOMIA)
        if fora:
            raise LayoutInvalido(f"{emp}: canais desconhecidos {fora}")
        ruins = sorted(v for v in o.resultados.values()
                       if v not in GENERICOS and not any(v in TAXONOMIA[c] for c in TAXONOMIA))
        if ruins:
            raise LayoutInvalido(f"{emp}: resultados sem significado {ruins} "
                                 f"(use {sorted(GENERICOS)} ou um resultado da taxonomia)")
    return Entrada(emp, base, ocs)


def carregar_entrada(caminho: str | Path) -> Entrada:
    return validar_entrada(json.loads(Path(caminho).read_text(encoding="utf-8")))


# ------------------------------------------------------------------ base bruta
def data_do_arquivo(caminho: Path) -> date:
    """Data de referência do arquivo: a do nome (2026-09-25 ou 20260925) ou a da modificação."""
    m = _DATA_NO_NOME.search(caminho.name)
    if m:
        try:
            return date(*map(int, m.groups()))
        except ValueError:
            pass
    return date.fromtimestamp(caminho.stat().st_mtime)


def _data(v: str, formato: str) -> date | None:
    """Data no formato do layout; aceita também só a parte da data quando vem com hora."""
    v = (v or "").strip()
    for tentativa in (v, v.split(" ")[0], v.split("T")[0]):
        try:
            return datetime.strptime(tentativa, formato).date()
        except ValueError:
            continue
    return None


def _num(v: str, decimal: str) -> float:
    v = (v or "").replace("R$", "").strip() or "0"
    if decimal == ",":
        v = v.replace(".", "").replace(",", ".")
    return float(v)


def converter_base(arquivos: list[Path], layout: LayoutBase, pasta_saida: str | Path) -> dict:
    """Base bruta (um ou vários arquivos) -> base/clientes.csv e base/contatos.csv.

    Vários arquivos: cada cliente fica com os dados do arquivo mais recente em que
    aparece; a entrada na carteira é o primeiro arquivo (ou a coluna data_entrada) e
    o atraso é trazido para essa data. Contatos se acumulam. Com base_completa, quem
    não está no arquivo mais recente sai das ações (bloqueio "fora_da_base").
    """
    col = layout.colunas
    arquivos = sorted(arquivos, key=lambda p: (data_do_arquivo(p), p.name))
    rel = {"arquivos": [], "rejeitadas": Counter()}
    colunas_atrib: list[str] = []   # colunas da base que viram atributos (para as regras de cluster)
    primeira: dict[str, date] = {}
    ultimo: dict[str, tuple[date, list[dict]]] = {}
    contatos: dict[tuple[str, str], dict] = {}
    presentes_ultimo: set[str] = set()
    for n_arq, arq in enumerate(arquivos):
        dia = data_do_arquivo(arq)
        linhas_arq: dict[str, list[dict]] = defaultdict(list)
        with open(arq, newline="", encoding=layout.encoding) as f:
            leitor = csv.DictReader(f, delimiter=layout.delimitador)
            nomes = leitor.fieldnames or []
            tel_cols = [t if isinstance(t, dict) else {"coluna": t} for t in layout.telefones]
            usadas = list(col.values()) + [t["coluna"] for t in tel_cols] + list(layout.emails)
            ausentes = sorted({c for c in usadas if c not in nomes})
            if ausentes:
                raise LayoutInvalido(f"{arq.name}: colunas ausentes no arquivo {ausentes}")
            # contato, CPF e ID não viram atributo: só o que descreve o cliente/contrato
            pessoais = {col["id_cliente"], col.get("cpf")} | {t["coluna"] for t in tel_cols} \
                | {t.get("whatsapp") for t in tel_cols} | set(layout.emails)
            colunas_atrib = [c for c in nomes if c and c not in pessoais]
            n = 0
            for linha in leitor:
                n += 1
                idc = norm.id_cliente(linha[col["id_cliente"]])
                if idc is None:
                    rel["rejeitadas"]["id_cliente vazio"] += 1
                    continue
                try:
                    saldo = _num(linha[col["saldo"]], layout.decimal)
                    if "dias_atraso" in col:
                        atraso = int(float((linha[col["dias_atraso"]] or "0").strip().replace(",", ".")))
                    else:
                        venc = _data(linha[col["vencimento"]], layout.formato_data)
                        if venc is None:
                            raise ValueError("vencimento")
                        atraso = max((dia - venc).days, 0)
                    entrada = None
                    if "data_entrada" in col and (linha[col["data_entrada"]] or "").strip():
                        entrada = _data(linha[col["data_entrada"]], layout.formato_data)
                        if entrada is None:
                            raise ValueError("data_entrada")
                except (ValueError, AttributeError):
                    rel["rejeitadas"]["saldo, atraso ou data inválidos"] += 1
                    continue
                cpf = norm.cpf(linha[col["cpf"]]) if "cpf" in col and (linha[col["cpf"]] or "").strip() else None
                linhas_arq[idc].append({
                    "id_contrato": (linha[col["id_contrato"]] or "").strip() if "id_contrato" in col else "",
                    "saldo": saldo, "atraso": atraso, "entrada": entrada,
                    "bloqueio": (linha[col["bloqueio"]] or "").strip() if "bloqueio" in col else "",
                    "atributos": {c: (linha.get(c) or "").strip() for c in colunas_atrib}})
                for t in tel_cols:
                    tel = norm.telefone(linha[t["coluna"]])
                    if tel:
                        c = contatos.setdefault((idc, tel), {"tipo": "telefone", "cpf": cpf, "wa": False})
                        c["wa"] = c["wa"] or (_sim(linha[t["whatsapp"]]) if t.get("whatsapp") else False)
                        c["atualizado"] = dia
                for ce in layout.emails:
                    em = norm.email(linha[ce])
                    if em:
                        contatos.setdefault((idc, em), {"tipo": "email", "cpf": cpf, "wa": False})["atualizado"] = dia
        for idc, ls in linhas_arq.items():
            primeira.setdefault(idc, min([dia] + [l["entrada"] for l in ls if l["entrada"]]))
            ultimo[idc] = (dia, ls)
        if n_arq == len(arquivos) - 1:
            presentes_ultimo = set(linhas_arq)
        rel["arquivos"].append({"arquivo": arq.name, "data": dia.isoformat(), "linhas": n,
                                "clientes": len(linhas_arq)})

    pasta = Path(pasta_saida)
    pasta.mkdir(parents=True, exist_ok=True)
    with open(pasta / "clientes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente", "id_contrato", "data_entrada", "saldo", "dias_atraso", "bloqueio"])
        for idc in sorted(ultimo):
            dia, ls = ultimo[idc]
            entrada = primeira[idc]
            fora = layout.base_completa and idc not in presentes_ultimo
            for l in ls:
                # atraso informado no dia do arquivo, trazido para a entrada do cliente
                w.writerow([idc, l["id_contrato"], entrada.isoformat(), f"{l['saldo']:.2f}",
                            max(l["atraso"] - (dia - entrada).days, 0),
                            "fora_da_base" if fora else l["bloqueio"]])
    with open(pasta / "contatos.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente", "contato", "tipo", "origem", "cpf", "whatsapp_valido", "atualizado_em"])
        for (idc, contato), c in sorted(contatos.items()):
            w.writerow([idc, contato, c["tipo"], layout.origem, c["cpf"] or "", int(c["wa"]),
                        c["atualizado"].isoformat()])
    # atributos do contrato de maior saldo de cada cliente (arquivo mais recente)
    todas = sorted({c for _, ls in ultimo.values() for l in ls for c in l["atributos"]},
                   key=lambda c: (colunas_atrib.index(c) if c in colunas_atrib else len(colunas_atrib), c))
    repres = {idc: max(ls, key=lambda l: l["saldo"])["atributos"] for idc, (_, ls) in ultimo.items()}
    with open(pasta / "atributos.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente"] + todas)
        for idc in sorted(repres):
            w.writerow([idc] + [repres[idc].get(c, "") for c in todas])
    rel["colunas"] = tipos_das_colunas(list(repres.values()), todas)
    rel["clientes"] = len(ultimo)
    rel["contatos"] = len(contatos)
    rel["fora_da_base"] = len(set(ultimo) - presentes_ultimo) if layout.base_completa else 0
    rel["rejeitadas"] = dict(rel["rejeitadas"])
    return rel


# ------------------------------------------------------------------ escolhas do motor
def salvar_escolhas(pasta_estado: str | Path, dia: date, fila: list[dict]):
    """Guarda o que o MotorCob mandou acionar em `dia` (substitui o que havia desse dia)."""
    arq = Path(pasta_estado) / "escolhas.csv"
    arq.parent.mkdir(parents=True, exist_ok=True)
    antigas = []
    if arq.exists():
        with open(arq, newline="", encoding="utf-8") as f:
            antigas = [l for l in csv.DictReader(f, delimiter=";") if l["data"] != dia.isoformat()]
    novas = [{"data": dia.isoformat(), "id_cliente": l["id_cliente"], "canal": l["canal"], "contato": l["contato"],
              "ordem_contato": l["ordem_contato"], "reserva": int(bool(l["condicao"]))} for l in fila]
    tmp = arq.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_ESCOLHA, delimiter=";")
        w.writeheader()
        w.writerows(antigas + novas)
    tmp.replace(arq)


def carregar_escolhas(pasta_estado: str | Path) -> dict[tuple[str, str], list[dict]]:
    """{(data, id_cliente): [escolhas do dia]}"""
    arq = Path(pasta_estado) / "escolhas.csv"
    por = defaultdict(list)
    if arq.exists():
        with open(arq, newline="", encoding="utf-8") as f:
            for l in csv.DictReader(f, delimiter=";"):
                por[(l["data"], l["id_cliente"])].append(l)
    return por


# ------------------------------------------------------------------ ocorrências
@dataclass
class RelatorioOcorrencia:
    arquivo: str
    linhas: int = 0
    aceitas: int = 0
    duplicadas: int = 0
    contato_identificado: int = 0
    rejeitadas: Counter = field(default_factory=Counter)
    desconhecidos: Counter = field(default_factory=Counter)
    avisos: Counter = field(default_factory=Counter)

    @property
    def fornecedor(self) -> str:
        return "ocorrencia"


def _resolver(escolhas, idc: str, dia: date, canal: str | None):
    """(canal, contato, aviso) a partir do que o MotorCob mandou acionar até DIAS_BUSCA_ESCOLHA antes."""
    for atras in range(DIAS_BUSCA_ESCOLHA + 1):
        ls = escolhas.get(((dia - timedelta(days=atras)).isoformat(), idc))
        if not ls:
            continue
        if canal:
            ls = [l for l in ls if l["canal"] == canal]
            if not ls:
                continue
        canais = sorted({l["canal"] for l in ls}, key=lambda c: min(int(l["reserva"]) for l in ls if l["canal"] == c))
        aviso = None
        if len(canais) > 1:  # sem coluna de canal e mais de um canal no dia: vale o principal
            aviso = "canal presumido (mais de um canal no dia)"
        escolhido = canais[0]
        contatos = sorted({l["contato"] for l in ls if l["canal"] == escolhido})
        return escolhido, (contatos[0] if len(contatos) == 1 else ""), aviso
    return canal, "", "sem ação do MotorCob para este ID na data"


def ler_ocorrencia(caminho: str | Path, layout: LayoutOcorrencia, empresa: str, escolhas, vistos: set | None = None):
    """Retorna (eventos, relatorio, quarentena).

    O contato vem da coluna contato, se houver; senão do que o MotorCob mandou acionar.
    Quando o canal teve vários números (discador), a ocorrência vale para a TAG do
    cliente mas não certifica nenhum número (contato fica vazio).
    """
    caminho = Path(caminho)
    vistos = set() if vistos is None else vistos
    rel = RelatorioOcorrencia(caminho.name)
    eventos, quarentena = [], []
    col = layout.colunas
    fornecedor = f"ocorrencia:{empresa}"
    with open(caminho, newline="", encoding=layout.encoding) as f:
        leitor = csv.DictReader(f, delimiter=layout.delimitador)
        ausentes = [c for c in col.values() if c not in (leitor.fieldnames or [])]
        if ausentes:
            raise LayoutInvalido(f"{caminho.name}: colunas ausentes no arquivo {ausentes}")
        for n, linha in enumerate(leitor, start=2):
            rel.linhas += 1
            codigo = (linha[col["resultado"]] or "").strip()
            generico = layout.resultados.get(codigo)
            if generico is None:
                rel.desconhecidos[codigo] += 1
                quarentena.append({"fornecedor": fornecedor, "canal": layout.canal or "", "arquivo": caminho.name,
                                   "linha": n, "codigo": codigo,
                                   "contato": _mascarar((linha[col["contato"]] or "") if "contato" in col else "")})
                continue
            idc = norm.id_cliente(linha[col["id_cliente"]])
            if idc is None:
                rel.rejeitadas["id_cliente inválido"] += 1
                continue
            dia = _data(linha[col["data"]], layout.formato_data)
            if dia is None:
                rel.rejeitadas["data inválida"] += 1
                continue
            canal = layout.canal
            if not canal and "canal" in col:
                bruto = (linha[col["canal"]] or "").strip()
                canal = layout.canais.get(bruto, bruto.lower() if bruto.lower() in TAXONOMIA else None)
                if canal is None:
                    rel.rejeitadas[f"canal desconhecido '{bruto}'"] += 1
                    continue
            contato = None
            if "contato" in col and (linha[col["contato"]] or "").strip():
                contato = norm.contato(linha[col["contato"]], _tipo(canal) if canal else "telefone")
                if contato is None and not canal:
                    contato = norm.email(linha[col["contato"]])
            canal_res, contato_res, aviso = _resolver(escolhas, idc, dia, canal)
            canal = canal or canal_res
            if canal is None:
                rel.rejeitadas["sem canal e sem ação do MotorCob na data"] += 1
                continue
            contato = contato or contato_res
            if aviso:
                rel.avisos[aviso] += 1
            resultado = traduzir(canal, generico)
            if resultado is None:
                rel.rejeitadas[f"'{generico}' não se aplica a {canal}"] += 1
                continue
            id_ext = (linha[col["id_externo"]] or "").strip() if "id_externo" in col else ""
            if not id_ext:  # sem id da empresa: a própria linha identifica (reenvio do arquivo não duplica)
                id_ext = "h" + hashlib.sha256(json.dumps(sorted(linha.items())).encode()).hexdigest()[:20]
            if (fornecedor, id_ext) in vistos:
                rel.duplicadas += 1
                continue
            vistos.add((fornecedor, id_ext))
            if "custo" in col:
                try:
                    custo = _num(linha[col["custo"]], layout.decimal)
                except ValueError:
                    custo = 0.0
            else:
                custo = layout.custo_fixo.get(canal, 0.0)
            eventos.append(Evento(idc, contato or "", _tipo(canal), canal, resultado, dia, custo,
                                  fornecedor=fornecedor, id_externo=id_ext))
            rel.aceitas += 1
            rel.contato_identificado += bool(contato)
    return eventos, rel, quarentena


def ingerir_ocorrencias(pasta: str | Path, entrada: Entrada, pasta_estado: str | Path):
    """Lê todos os arquivos de ocorrência da pasta. Retorna (eventos, relatorios, quarentena, sem_layout)."""
    escolhas = carregar_escolhas(pasta_estado)
    eventos, relatorios, quarentena, sem_layout = [], [], [], []
    vistos: set = set()
    pasta = Path(pasta)
    if not pasta.exists():
        return eventos, relatorios, quarentena, sem_layout
    for arq in sorted(pasta.glob("*")):
        if not arq.is_file():
            continue
        cands = [o for o in entrada.ocorrencias if fnmatch(arq.name, o.arquivo)]
        if len(cands) != 1:
            sem_layout.append(arq.name if not cands else f"{arq.name} (layouts ambíguos)")
            continue
        ev, rel, q = ler_ocorrencia(arq, cands[0], entrada.empresa, escolhas, vistos)
        eventos += ev
        relatorios.append(rel)
        quarentena += q
    return eventos, relatorios, quarentena, sem_layout
