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
from datetime import date, datetime
from fnmatch import fnmatch
from pathlib import Path

from . import normalizacao as norm
from . import voz as V
from .certificacao import Evento
from .taxonomia import CANAIS_EMAIL, TAXONOMIA

CAMPOS_OBRIGATORIOS = ("id_cliente", "contato", "data", "resultado", "id_externo")


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
    inexistente_confirmado: list = field(default_factory=list)  # voz: códigos de inexistente confiáveis
    transferencias: dict = field(default_factory=dict)   # voz: valor da coluna transferencia -> atendida|sem_operador|falhou
    destinos: dict = field(default_factory=dict)         # voz: valor da coluna destino -> ia|ia_humano
    toque_min_segundos: int = 15                         # voz: 487/CANCEL com menos toque = cancelada antes do toque

    @property
    def tipo_contato(self) -> str:
        return "email" if self.canal in CANAIS_EMAIL else "telefone"


# ------------------------------------------------------------------ voz: rede × IA × operador (de-para do dono)
# nomes de coluna das decisões do dono (um registro por canal por tentativa): número discado, billsec e id da chamada
ALIAS_VOZ = {"numero_discado": "contato", "billsec": "duracao", "id_chamada": "id_externo"}
COLUNAS_REDE = ("causa_sip", "causa_q850", "dialstatus", "amd", "toque")
COLUNAS_VOZ = COLUNAS_REDE + ("resultado_operador", "transferencia", "destino", "rota", "identidade_confirmada",
                              "id_chamada")
AVISO_DADOS_MINIMOS = ("voz sem número discado, billsec ou id da chamada por tentativa: renitência por número, "
                       "confirmação de inexistente e KPI de curtas ficam limitados")


def colunas_voz(col: dict) -> dict:
    """Aceita os nomes numero_discado/billsec/id_chamada (o nome antigo vence se o layout trouxer os dois)."""
    col = dict(col)
    for novo, antigo in ALIAS_VOZ.items():
        if novo in col and antigo not in col:
            col[antigo] = col[novo]
    return col


def _int(txt):
    try:
        return int(str(txt).strip()) if str(txt or "").strip() else None
    except ValueError:
        return None


def ler_voz(linha: dict, col: dict, resultado: str, traduz, contato: str, layout, avisos: Counter, canal: str):
    """Campos de voz de uma linha: (desfecho final, campos extras do Evento). A rede (SIP/Q.850/DIALSTATUS/AMD),
    o evento da IA (coluna resultado) e a tabulação do operador (resultado_operador, depois da transferência)
    ficam em campos separados; o desfecho final sai de voz.classificar_chamada. Sem as colunas novas, o
    desfecho é o de sempre. traduz: código do cliente -> desfecho de voz (ou None)."""
    def v(k):
        return (linha.get(col[k]) or "").strip() if k in col else ""
    sip, q850 = _int(v("causa_sip")), _int(v("causa_q850"))
    op_cod = v("resultado_operador")
    op = traduz(op_cod) if op_cod else None
    if op_cod and op is None:
        avisos["tabulação do operador com código desconhecido (ignorada)"] += 1
    tr = v("transferencia").lower()
    tr = layout.transferencias.get(v("transferencia"), layout.transferencias.get(tr, tr)) or None
    if tr and tr not in V.TRANSFERENCIAS:
        avisos[f"transferência '{tr}' desconhecida (ignorada)"] += 1
        tr = None
    de = v("destino").lower()
    de = layout.destinos.get(v("destino"), layout.destinos.get(de, de)) or None
    if de and de not in V.DESTINOS:
        avisos[f"destino '{de}' desconhecido (ignorado)"] += 1
        de = None
    ident = v("identidade_confirmada")
    extra = {"causa_sip": sip, "causa_q850": q850, "resultado_operador": op, "transferencia": tr, "destino": de,
             "rota": v("rota") or None, "identidade_confirmada": _sim(ident) if ident else None,
             "id_chamada": v("id_chamada") or None}
    if canal == "agente_voz" or de:
        extra["resultado_ia"] = resultado
    if any(v(k) for k in COLUNAS_REDE) or op or tr:
        ch, origem, av = V.classificar_chamada(
            resultado_ia=resultado, resultado_operador=op, transferencia=tr, sip=sip, q850=q850,
            dialstatus=v("dialstatus"), amd=v("amd"), toque_s=_int(v("toque")), toque_min=layout.toque_min_segundos,
            canonico=V.numero_canonico(contato))
        for a in av:
            avisos[a] += 1
        if ch:
            resultado, extra["origem_resultado"] = ch, origem
    return resultado, {k: x for k, x in extra.items() if x is not None}


def validar_layout(dados: dict) -> Layout:
    """Carrega e valida um layout. Um de-para errado aqui contaminaria todo o score."""
    if isinstance(dados.get("colunas"), dict):
        dados = {**dados, "colunas": colunas_voz(dados["colunas"])}
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
    avisos: Counter = field(default_factory=Counter)          # aceitas com ressalva


def _mascarar(valor: str) -> str:
    return valor[:2] + "*" * max(len(valor) - 4, 0) + valor[-2:] if len(valor) > 4 else "****"


def ler_retorno(caminho: str | Path, layout: Layout, vistos: set | None = None):
    """Lê um arquivo de retorno. Retorna (eventos, relatorio, quarentena).

    quarentena: linhas com código desconhecido, com o contato mascarado (LGPD).
    Colunas opcionais (discagem): hora (senão a hora da coluna data, se houver), duracao (segundos ou
    MM:SS), data_promessa. Com `inexistente_confirmado`, inexistente da voz de outro código vira falha_rede.
    """
    caminho = Path(caminho)
    vistos = set() if vistos is None else vistos
    rel = Relatorio(layout.fornecedor, caminho.name)
    eventos, quarentena = [], []
    datas = {}
    col = layout.colunas
    voz = layout.canal in ("discador", "agente_voz")
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
            id_cliente = norm.id_cliente(linha[col["id_cliente"]])
            if id_cliente is None:
                rel.rejeitadas["id_cliente inválido"] += 1
                continue
            contato = norm.contato(linha[col["contato"]], layout.tipo_contato)
            if contato is None:
                rel.rejeitadas["contato inválido"] += 1
                continue
            txt = linha[col["data"]]
            data = datas.get(txt)
            if data is None:
                try:      # strptime é caro e as datas/horas se repetem muito num arquivo: lê cada uma uma vez
                    data = datas[txt] = datetime.strptime(txt.strip(), layout.formato_data).date()
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
            extra = {}
            if voz:
                com_rede = any((linha.get(col.get(k, "")) or "").strip() for k in COLUNAS_REDE if k in col)
                if not com_rede and resultado == "numero_inexistente" and layout.inexistente_confirmado \
                        and codigo not in layout.inexistente_confirmado:
                    resultado = "falha_rede"
                    rel.avisos["número inexistente sem código confirmado (vale como falha de rede)"] += 1
                resultado, extra = ler_voz(linha, col, resultado, layout.resultados.get, contato, layout, rel.avisos,
                                           layout.canal)
                if "duracao" not in col:
                    rel.avisos[AVISO_DADOS_MINIMOS] += 1
                extra["hora"] = norm.hora(linha[col["hora"]] if "hora" in col else txt)
                if "duracao" in col:
                    extra["duracao_s"] = norm.segundos(linha[col["duracao"]])
                if (linha.get(col.get("data_promessa", "")) or "").strip():
                    try:
                        extra["data_promessa"] = _data(linha[col["data_promessa"]])
                    except ValueError:
                        rel.avisos["data_promessa inválida (ignorada)"] += 1
            eventos.append(Evento(id_cliente, contato, layout.tipo_contato, layout.canal, resultado,
                                  data, custo, fornecedor=layout.fornecedor, id_externo=id_externo, **extra))
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


def carregar_carteira(caminho: str | Path) -> tuple[list[dict], dict[str, str], Counter]:
    """Base de contatos da carteira (id_cliente;contato;tipo[;origem][;cpf]), normalizada.

    Inclui contatos nunca acionados — é o que permite planejar o cold start.
    O CPF é opcional e serve só para agrupar IDs da mesma pessoa: vira uma chave
    pseudônima (hash) em memória e não segue para nenhuma saída.

    Retorna (contatos, pessoa_de, rejeitados), com pessoa_de = {id_cliente: chave}.
    """
    contatos, pessoa_de, rejeitados, vistos = [], {}, Counter(), set()
    with open(caminho, newline="", encoding="utf-8") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            tipo = (linha.get("tipo") or "").strip().lower()
            if tipo not in ("telefone", "email"):
                rejeitados["tipo inválido"] += 1
                continue
            id_cliente = norm.id_cliente(linha.get("id_cliente"))
            contato = norm.contato(linha.get("contato"), tipo)
            if id_cliente is None or contato is None:
                rejeitados["id_cliente ou contato inválido"] += 1
                continue
            if (linha.get("cpf") or "").strip():
                cpf = norm.cpf(linha["cpf"])
                if cpf is None:
                    rejeitados["cpf inválido (ignorado, linha mantida)"] += 1
                else:
                    pessoa_de[id_cliente] = norm.chave_pessoa(cpf)
            if (id_cliente, contato) in vistos:
                continue
            vistos.add((id_cliente, contato))
            try:
                atualizado = _data(linha.get("atualizado_em"))
            except ValueError:
                rejeitados["atualizado_em inválido (ignorado)"] += 1
                atualizado = None
            contatos.append({"id_cliente": id_cliente, "contato": contato, "tipo": tipo,
                             "origem": (linha.get("origem") or "").strip() or None,
                             "whatsapp_valido": _sim(linha.get("whatsapp_valido")),
                             "atualizado_em": atualizado,
                             # marcas do retorno do enriquecimento (opcionais)
                             "rcs": _sim(linha.get("rcs_valido")),
                             "nao_perturbe": _sim(linha.get("nao_perturbe")),
                             "score_bureau": _num_ou_none(linha.get("score_bureau")),
                             "ranking": _num_ou_none(linha.get("ranking")),
                             "pertence": (linha.get("pertence") or "").strip().lower(),
                             "hot": _sim(linha.get("hot"))})
    return contatos, pessoa_de, rejeitados


def _num_ou_none(v):
    try:
        return float(str(v).replace(",", ".")) if (v or "").strip() else None
    except ValueError:
        return None


def _sim(v) -> bool:
    return (v or "").strip().lower() in ("1", "s", "sim", "true", "x")


def _data(v):
    v = (v or "").strip()
    if not v:
        return None
    if "/" in v:
        return datetime.strptime(v, "%d/%m/%Y").date()
    return date.fromisoformat(v[:10])


def _valor(v) -> float:
    v = (v or "0").strip().replace("R$", "").strip()
    if "," in v:
        v = v.replace(".", "").replace(",", ".")
    return float(v)


def carregar_clientes(caminho: str | Path):
    """Base de clientes: id_cliente;data_entrada;saldo;dias_atraso[;bloqueio][;id_contrato].

    Cliente com vários contratos (várias linhas): ticket = soma dos saldos, atraso = o
    maior, entrada = a mais antiga, bloqueio se qualquer contrato estiver bloqueado.
    Retorna ({id_cliente: Cliente}, rejeitados).
    """
    from .marcacao import Cliente
    agg, rejeitados = {}, Counter()
    with open(caminho, newline="", encoding="utf-8") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            idc = norm.id_cliente(linha.get("id_cliente"))
            try:
                entrada = _data(linha.get("data_entrada"))
                saldo = _valor(linha.get("saldo"))
                atraso = int((linha.get("dias_atraso") or "0").strip())
            except ValueError:
                rejeitados["linha com data/saldo/atraso inválido"] += 1
                continue
            if idc is None or entrada is None:
                rejeitados["id_cliente ou data_entrada ausente"] += 1
                continue
            bloqueio = (linha.get("bloqueio") or "").strip() or None
            a = agg.setdefault(idc, {"contratos": [], "saldo": 0.0, "bloqueio": None})
            a["contratos"].append((entrada, atraso))
            a["saldo"] += saldo
            a["bloqueio"] = a["bloqueio"] or bloqueio
    clientes = {}
    for idc, a in agg.items():
        entrada = min(e for e, _ in a["contratos"])
        # atraso de cada contrato trazido para a data de entrada do cliente; vale o maior
        atraso = max(max(at - (e - entrada).days, 0) for e, at in a["contratos"])
        clientes[idc] = Cliente(idc, entrada, round(a["saldo"], 2), atraso, a["bloqueio"], len(a["contratos"]))
    return clientes, rejeitados


def carregar_parcelas(caminho: str | Path):
    """Parcelas do sistema de acordos: id_cliente;id_acordo;parcela;vencimento;valor;pago_em.

    Retorna ({id_cliente: [Parcela]}, rejeitados).
    """
    from .acordos import Parcela
    por, rejeitados = {}, Counter()
    with open(caminho, newline="", encoding="utf-8") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            idc = norm.id_cliente(linha.get("id_cliente"))
            try:
                p = Parcela(idc, (linha.get("id_acordo") or "").strip(), int(linha["parcela"]),
                            _data(linha["vencimento"]), _valor(linha.get("valor")), _data(linha.get("pago_em")))
            except (ValueError, KeyError, TypeError):
                rejeitados["parcela inválida"] += 1
                continue
            if idc is None or not p.id_acordo or p.vencimento is None:
                rejeitados["parcela sem cliente, acordo ou vencimento"] += 1
                continue
            por.setdefault(idc, []).append(p)
    return por, rejeitados
