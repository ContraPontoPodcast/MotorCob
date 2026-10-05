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
CAMPOS_ESCOLHA = ("data", "id_cliente", "canal", "contato", "ordem_contato", "reserva", "regua", "cluster",
                  "estado", "persona")
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
    base_completa: bool = True   # (obsoleto) a carga do dia é sempre o universo de quem recebe ação


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
class LayoutArquivo:
    """Retirada, acordo ou baixa: colunas e, quando houver, o de-para de motivos/tipos."""
    colunas: dict[str, str]
    arquivo: str = "*"
    formato_data: str = "%d/%m/%Y"
    delimitador: str = ";"
    encoding: str = "utf-8"
    decimal: str = ","
    motivos: dict[str, str] = field(default_factory=dict)   # retirada: código -> motivo
    tipos: dict[str, str] = field(default_factory=dict)     # baixa: código -> quitacao | parcial | parcela


# colunas que cada arquivo da carteira entende (* = obrigatória; id_cliente OU id_contrato)
CAMPOS_ARQUIVO = {
    "retirada": ("id_cliente", "id_contrato", "data", "motivo"),
    "acordo": ("id_cliente", "id_contrato", "id_acordo", "parcela*", "vencimento*", "valor"),
    "baixa": ("id_cliente", "id_contrato", "id_acordo", "parcela", "data*", "valor*", "tipo"),
}


@dataclass(frozen=True)
class Entrada:
    empresa: str
    base: LayoutBase
    ocorrencias: list[LayoutOcorrencia]
    enriquecimento: list = field(default_factory=list)  # [LayoutEnriquecimento]
    incremental: LayoutBase | None = None   # sem layout próprio: o mesmo da carga geral
    retirada: LayoutArquivo | None = None
    acordo: LayoutArquivo | None = None
    baixa: LayoutArquivo | None = None


def _sem_doc(d: dict) -> dict:
    """Chaves que começam com '_' são comentários no arquivo de entrada."""
    return {k: v for k, v in d.items() if not k.startswith("_")}


def validar_entrada(dados: dict) -> Entrada:
    emp = dados.get("empresa") or "?"
    try:
        base = LayoutBase(**_sem_doc(dados["base"]))
        ocs = dados.get("ocorrencia") or []
        ocs = [LayoutOcorrencia(**_sem_doc(o)) for o in (ocs if isinstance(ocs, list) else [ocs])]
        enr = dados.get("enriquecimento") or []
        enr = [LayoutEnriquecimento(**_sem_doc(x)) for x in (enr if isinstance(enr, list) else [enr])]
        incremental = LayoutBase(**_sem_doc(dados["incremental"])) if dados.get("incremental") else None
        extras = {k: LayoutArquivo(**_sem_doc(dados[k])) for k in CAMPOS_ARQUIVO if dados.get(k)}
    except (TypeError, KeyError) as e:
        raise LayoutInvalido(f"{emp}: {e}") from None
    for tipo, lay in extras.items():
        conhecidas = {c.rstrip("*") for c in CAMPOS_ARQUIVO[tipo]}
        fora = sorted(set(lay.colunas) - conhecidas)
        if fora:
            raise LayoutInvalido(f"{emp}: {tipo}: colunas desconhecidas {fora} (use {sorted(conhecidas)})")
        falta = [c.rstrip("*") for c in CAMPOS_ARQUIVO[tipo] if c.endswith("*") and c.rstrip("*") not in lay.colunas]
        if not ({"id_cliente", "id_contrato"} & set(lay.colunas)):
            falta.append("id_cliente ou id_contrato")
        if falta:
            raise LayoutInvalido(f"{emp}: {tipo}: falta dizer a coluna de {falta}")
        if tipo == "baixa" and set(lay.tipos.values()) - {"quitacao", "parcial", "parcela"}:
            raise LayoutInvalido(f"{emp}: baixa: tipos devem ser quitacao, parcial ou parcela")
    for x in enr:
        if set(x.chave) - {"cpf", "id_cliente"} or len(x.chave) != 1:
            raise LayoutInvalido(f"{emp}: enriquecimento {x.arquivo}: chave deve ser cpf ou id_cliente")
        if not x.telefone.get("numero") and not x.emails:
            raise LayoutInvalido(f"{emp}: enriquecimento {x.arquivo}: sem telefone.numero nem emails")
        fora = set(x.telefone) - {"ddd", "numero", "whatsapp", "rcs", "nao_perturbe", "score", "ranking"}
        if fora:
            raise LayoutInvalido(f"{emp}: enriquecimento {x.arquivo}: campos de telefone desconhecidos {sorted(fora)}")
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
    return Entrada(emp, base, ocs, enr, incremental, **extras)


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


NOMES_NASCIMENTO = ("DATA_NASCIMENTO", "DT_NASCIMENTO", "DT_NASC", "DATA_NASC", "NASCIMENTO", "DATANASCIMENTO",
                    "DT_NASCTO", "DATA_DE_NASCIMENTO")


def _nome_simples(nome: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", "_", t).strip("_")


def _idade(linha: dict, col_nasc, col_idade, dia: date, formato: str) -> dict:
    """Atributo calculado "idade" (anos) a partir da data de nascimento ou da coluna IDADE."""
    if col_nasc and (linha.get(col_nasc) or "").strip():
        nasc = _data(linha[col_nasc], formato)
        if nasc is None:
            for f in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
                nasc = _data(linha[col_nasc], f)
                if nasc:
                    break
        if nasc and nasc < dia:
            anos = dia.year - nasc.year - ((dia.month, dia.day) < (nasc.month, nasc.day))
            if 14 <= anos <= 110:
                return {"idade": str(anos)}
    if col_idade:
        v = re.sub(r"\D", "", linha.get(col_idade) or "")
        if v and 14 <= int(v) <= 110:
            return {"idade": v}
    return {}


def _colunas_base(nomes: list[str], layout: LayoutBase):
    """Obrigatórias: ID, saldo e atraso (ou vencimento) e ao menos um contato. As demais
    colunas do cadastro que não vierem no arquivo do dia ficam vazias.
    Retorna (ausentes, colunas presentes, colunas de telefone, colunas de e-mail)."""
    obrig = [layout.colunas["id_cliente"], layout.colunas["saldo"],
             layout.colunas.get("dias_atraso") or layout.colunas.get("vencimento")]
    ausentes = sorted(c for c in obrig if c not in nomes)
    col = {k: v for k, v in layout.colunas.items() if v in nomes}
    tel_cols = [{k: v for k, v in (t if isinstance(t, dict) else {"coluna": t}).items() if v in nomes}
                for t in layout.telefones]
    tel_cols = [t for t in tel_cols if t.get("coluna")]
    emails = [e for e in layout.emails if e in nomes]
    if not tel_cols and not emails:
        ausentes.append("nenhuma coluna de telefone ou e-mail do cadastro")
    return ausentes, col, tel_cols, emails


def checar_base(arq: str | Path, layout: LayoutBase) -> list[str]:
    """Só o cabeçalho: as colunas obrigatórias que faltam na carga (vazio = arquivo serve)."""
    try:
        with open(arq, newline="", encoding=layout.encoding) as f:
            nomes = csv.DictReader(f, delimiter=layout.delimitador).fieldnames or []
    except (UnicodeDecodeError, csv.Error) as ex:
        return [f"arquivo ilegível ({ex.__class__.__name__})"]
    return _colunas_base(nomes, layout)[0]


def converter_base(arquivos: list[Path], layout: LayoutBase, pasta_saida: str | Path,
                   incrementais: list[Path] = (), retiradas: list[dict] = (), pagamentos: list[dict] = (),
                   layout_incremental: LayoutBase | None = None) -> dict:
    """Carteira do credor -> base/clientes.csv, contatos.csv, na_carga.csv, pessoas.csv, atributos.csv.

    O ESTOQUE (quem recebe ação) é montado por contrato, em ordem de data:
      carga geral (`arquivos`)    substitui o estoque inteiro pelo que vem no arquivo
      carga incremental           acrescenta/atualiza os contratos que vierem
      retirada                    tira o contrato (ou o cliente todo) do estoque, com motivo
      pagamento sem acordo        quitação tira o contrato; parcial abate o saldo
    No mesmo dia: geral → incremental → retirada → pagamento. Um arquivo só de carga, sem
    incremental, é o caso antigo: a carga mais recente é o universo de quem recebe ação.
    Quem sai do estoque não é acionado, mas o histórico (TAG, trilha, Hot) continua e volta a
    valer se ele reaparecer numa carga.

    retiradas: [{data, id_cliente, id_contrato, motivo}] · pagamentos: [{data, id_cliente,
    id_contrato, valor, tipo: quitacao|parcial|""}] (já com o cliente resolvido).
    Marcas por telefone na carga (opcionais): hot (preferencial), whatsapp, rcs.
    """
    eventos = [(data_do_arquivo(a), 0, a.name, "geral", a) for a in arquivos]
    eventos += [(data_do_arquivo(a), 1, a.name, "incremental", a) for a in incrementais]
    eventos += [(r["data"], 2, str(n), "retirada", r) for n, r in enumerate(retiradas)]
    eventos += [(p["data"], 3, str(n), "pagamento", p) for n, p in enumerate(pagamentos)]
    eventos.sort(key=lambda e: e[:3])
    rel = {"arquivos": [], "rejeitadas": Counter(), "retirados": Counter(), "pagamentos": Counter()}
    colunas_atrib: list[str] = []   # colunas da base que viram atributos (para as regras de cluster)
    primeira: dict[str, date] = {}
    estoque: dict[str, dict[str, dict]] = {}     # contratos em cobrança: {idc: {contrato: linha}}
    historico: dict[str, dict[str, dict]] = {}   # último retrato de cada cliente (também os que saíram)
    contrato_de: dict[str, str] = {}
    contatos: dict[tuple[str, str], dict] = {}
    documentos: dict[str, str] = {}   # id_cliente -> CPF/CNPJ (só dígitos), para ligar o enriquecimento
    saiu: dict[str, tuple[date, str]] = {}       # cliente que saiu do estoque: (data, motivo)
    quitados: dict[str, date] = {}
    for dia, _, _, tipo, item in eventos:
        if tipo == "retirada":
            idc, ct = item["id_cliente"], item.get("id_contrato") or ""
            if idc not in estoque:
                rel["retirados"]["já fora do estoque"] += 1
                continue
            if ct and ct in estoque[idc]:
                del estoque[idc][ct]
            elif not ct:
                estoque[idc] = {}
            else:
                rel["retirados"]["contrato não encontrado"] += 1
                continue
            rel["retirados"][item.get("motivo") or "sem motivo"] += 1
            if not estoque[idc]:
                del estoque[idc]
                saiu[idc] = (dia, item.get("motivo") or "retirada")
            continue
        if tipo == "pagamento":
            idc, ct = item["id_cliente"], item.get("id_contrato") or ""
            alvo = estoque.get(idc) or {}
            linhas = [alvo[ct]] if ct in alvo else ([] if ct else list(alvo.values()))
            if not linhas:
                rel["pagamentos"]["sem contrato em cobrança"] += 1
                continue
            saldo = sum(l["saldo"] for l in linhas)
            quita = item.get("tipo") == "quitacao" or (item.get("tipo") != "parcial"
                                                        and item["valor"] >= saldo * 0.99)
            if quita:
                for k in ([ct] if ct in alvo else list(alvo)):
                    del alvo[k]
                rel["pagamentos"]["quitação"] += 1
                if not alvo:
                    del estoque[idc]
                    saiu[idc] = (dia, "quitado")
                    quitados[idc] = dia
            else:
                resta = item["valor"]
                for l in sorted(linhas, key=lambda l: -l["saldo"]):
                    abate = min(resta, l["saldo"])
                    l["saldo"] -= abate
                    resta -= abate
                rel["pagamentos"]["parcial"] += 1
            continue
        arq, lay = item, (layout_incremental or layout) if tipo == "incremental" else layout
        linhas_arq: dict[str, list[dict]] = defaultdict(list)
        with open(arq, newline="", encoding=lay.encoding) as f:
            leitor = csv.DictReader(f, delimiter=lay.delimitador)
            nomes = leitor.fieldnames or []
            ausentes, col, tel_cols, emails = _colunas_base(nomes, lay)
            if ausentes:
                raise LayoutInvalido(f"{arq.name}: colunas obrigatórias ausentes no arquivo {ausentes}")
            # contato, CPF e ID não viram atributo: só o que descreve o cliente/contrato
            pessoais = {col["id_cliente"], col.get("cpf")} | {t["coluna"] for t in tel_cols} \
                | {t.get(k) for t in tel_cols for k in ("whatsapp", "rcs", "hot", "ddd")} | set(emails)
            # data de nascimento é dado pessoal: não vira atributo, vira só a idade
            col_nasc = next((c for c in nomes if _nome_simples(c) in NOMES_NASCIMENTO), None)
            col_idade = next((c for c in nomes if _nome_simples(c) == "IDADE"), None)
            pessoais.add(col_nasc)
            colunas_atrib = [c for c in nomes if c and c not in pessoais]
            n = 0
            for linha in leitor:
                n += 1
                idc = norm.id_cliente(linha[col["id_cliente"]])
                if idc is None:
                    rel["rejeitadas"]["id_cliente vazio"] += 1
                    continue
                try:
                    saldo = _num(linha[col["saldo"]], lay.decimal)
                    if "dias_atraso" in col:
                        atraso = int(float((linha[col["dias_atraso"]] or "0").strip().replace(",", ".")))
                    else:
                        venc = _data(linha[col["vencimento"]], lay.formato_data)
                        if venc is None:
                            raise ValueError("vencimento")
                        atraso = max((dia - venc).days, 0)
                    entrada = None
                    if "data_entrada" in col and (linha[col["data_entrada"]] or "").strip():
                        entrada = _data(linha[col["data_entrada"]], lay.formato_data)
                        if entrada is None:
                            raise ValueError("data_entrada")
                except (ValueError, AttributeError):
                    rel["rejeitadas"]["saldo, atraso ou data inválidos"] += 1
                    continue
                cpf = norm.cpf(linha[col["cpf"]]) if "cpf" in col and (linha[col["cpf"]] or "").strip() else None
                doc = documento(linha[col["cpf"]]) if "cpf" in col else None
                if doc:
                    documentos[idc] = doc
                linhas_arq[idc].append({
                    "id_contrato": (linha[col["id_contrato"]] or "").strip() if "id_contrato" in col else "",
                    "saldo": saldo, "atraso": atraso, "entrada": entrada, "dia": dia,
                    "bloqueio": (linha[col["bloqueio"]] or "").strip() if "bloqueio" in col else "",
                    "atributos": {**{c: (linha.get(c) or "").strip() for c in colunas_atrib},
                                  **_idade(linha, col_nasc, col_idade, dia, lay.formato_data)}})
                for t in tel_cols:
                    bruto = linha[t["coluna"]] or ""
                    if t.get("ddd") and len(re.sub(r"\D", "", bruto)) < 10:   # DDD numa coluna, número na outra
                        bruto = (linha[t["ddd"]] or "") + bruto
                    tel = norm.telefone(bruto)
                    if tel:
                        c = contatos.setdefault((idc, tel), {"tipo": "telefone", "cpf": cpf, "wa": False})
                        c["wa"] = c["wa"] or (_sim(linha[t["whatsapp"]]) if t.get("whatsapp") else False)
                        if t.get("rcs"):
                            c["rcs"] = c.get("rcs") or _sim(linha[t["rcs"]])
                        if t.get("hot"):
                            c["hot"] = c.get("hot") or _sim(linha[t["hot"]])
                        c["atualizado"] = dia
                for ce in emails:
                    em = norm.email(linha[ce])
                    if em:
                        contatos.setdefault((idc, em), {"tipo": "email", "cpf": cpf, "wa": False})["atualizado"] = dia
        if tipo == "geral":
            estoque = {}
        for idc, ls in linhas_arq.items():
            primeira.setdefault(idc, min([dia] + [l["entrada"] for l in ls if l["entrada"]]))
            novos = {(l["id_contrato"] or f"#{k}"): l for k, l in enumerate(ls)}
            for ct in novos:
                if not ct.startswith("#"):
                    contrato_de[ct] = idc
            sem_id = any(ct.startswith("#") for ct in novos)
            atual = {} if (tipo == "geral" or sem_id) else dict(estoque.get(idc, {}))
            atual.update(novos)
            estoque[idc] = atual
            historico[idc] = dict(atual)
            saiu.pop(idc, None)
            quitados.pop(idc, None)
        rel["arquivos"].append({"arquivo": arq.name, "tipo": tipo, "data": dia.isoformat(), "linhas": n,
                                "clientes": len(linhas_arq)})

    pasta = Path(pasta_saida)
    pasta.mkdir(parents=True, exist_ok=True)
    retrato = {idc: (estoque.get(idc) or historico[idc]) for idc in historico}
    with open(pasta / "clientes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente", "id_contrato", "data_entrada", "saldo", "dias_atraso", "bloqueio"])
        for idc in sorted(retrato):
            entrada = primeira[idc]
            for l in retrato[idc].values():
                # atraso informado no dia do arquivo, trazido para a entrada do cliente
                w.writerow([idc, l["id_contrato"], entrada.isoformat(), f"{max(l['saldo'], 0):.2f}",
                            max(l["atraso"] - (l["dia"] - entrada).days, 0), l["bloqueio"]])
    _gravar_contatos(pasta / "contatos.csv", [
        {"id_cliente": idc, "contato": contato, "tipo": c["tipo"], "origem": layout.origem, "cpf": c["cpf"] or "",
         "whatsapp_valido": int(c["wa"]), "atualizado_em": c["atualizado"].isoformat(),
         "rcs_valido": int(c["rcs"]) if "rcs" in c else "", "hot": int(c["hot"]) if "hot" in c else ""}
        for (idc, contato), c in sorted(contatos.items())])
    gravar_na_carga(pasta, set(estoque))
    with open(pasta / "pessoas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente", "documento"])
        for idc in sorted(documentos):
            w.writerow([idc, documentos[idc]])
    with open(pasta / "fora_do_estoque.csv", "w", newline="", encoding="utf-8") as f:
        f.write("id_cliente;data;motivo\n" + "".join(f"{i};{d.isoformat()};{m}\n" for i, (d, m) in sorted(saiu.items())))
    # atributos do contrato de maior saldo de cada cliente
    todas = sorted({c for ls in retrato.values() for l in ls.values() for c in l["atributos"]},
                   key=lambda c: (colunas_atrib.index(c) if c in colunas_atrib else len(colunas_atrib), c))
    repres = {idc: max(ls.values(), key=lambda l: l["saldo"])["atributos"] for idc, ls in retrato.items() if ls}
    with open(pasta / "atributos.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["id_cliente"] + todas)
        for idc in sorted(repres):
            w.writerow([idc] + [repres[idc].get(c, "") for c in todas])
    rel["colunas"] = tipos_das_colunas(list(repres.values()), todas)
    rel["clientes"] = len(retrato)
    rel["contatos"] = len(contatos)
    rel["na_carga"] = len(estoque)
    cargas = [a for a in rel["arquivos"]]
    rel["carga_do_dia"] = cargas[-1]["arquivo"] if cargas else None
    rel["fora_da_carga"] = len(set(retrato) - set(estoque))
    rel["rejeitadas"] = dict(rel["rejeitadas"])
    rel["retirados"] = dict(rel["retirados"])
    rel["pagamentos"] = dict(rel["pagamentos"])
    rel["quitados"] = {k: v.isoformat() for k, v in quitados.items()}
    rel["saiu"] = {k: (d.isoformat(), m) for k, (d, m) in saiu.items()}
    rel["estoque"] = sorted(estoque)
    rel["contrato_de"] = contrato_de
    return rel


def gravar_na_carga(pasta: str | Path, ids: set[str]):
    with open(Path(pasta) / "na_carga.csv", "w", newline="", encoding="utf-8") as f:
        f.write("id_cliente\n" + "".join(i + "\n" for i in sorted(ids)))


# ------------------------------------------------------------------ retorno do enriquecimento
CAMPOS_CONTATO = ("id_cliente", "contato", "tipo", "origem", "cpf", "whatsapp_valido", "atualizado_em",
                  "rcs_valido", "nao_perturbe", "score_bureau", "ranking", "pertence", "hot")


def documento(v) -> str | None:
    """CPF/CNPJ só com dígitos e zeros à esquerda recompostos (planilha costuma comer o zero)."""
    d = re.sub(r"\D", "", str(v or ""))
    if not d or len(d) > 14 or set(d) == {"0"}:
        return None
    return d.zfill(11) if len(d) <= 11 else d.zfill(14)


def _gravar_contatos(caminho: Path, linhas: list[dict]):
    tmp = caminho.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_CONTATO, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(linhas)
    tmp.replace(caminho)


@dataclass(frozen=True)
class LayoutEnriquecimento:
    """Arquivo que volta do bureau. Colunas com o mesmo nome repetido (FONE, FONE, ...) são lidas
    pela posição: o k-ésimo FONE anda com o k-ésimo DDD, POSSUI-WHATSAPP etc."""
    arquivo: str
    chave: dict[str, str]                 # {"cpf": "CPF/CNPJ"} ou {"id_cliente": "COD"}
    telefone: dict[str, str] = field(default_factory=dict)  # ddd, numero, whatsapp, rcs, nao_perturbe, score, ranking
    emails: list[str] = field(default_factory=list)
    pertence: dict = field(default_factory=dict)  # {"score_min_sim": 4, "score_max_nao": 1} (opcional)
    delimitador: str = ";"
    encoding: str = "utf-8-sig"
    valores_sim: list[str] = field(default_factory=lambda: ["1", "s", "sim", "true", "x", "y", "yes"])
    valores_nao: list[str] = field(default_factory=lambda: ["0", "n", "nao", "não", "false", "no"])


def _flag(v, lay: LayoutEnriquecimento):
    t = (v or "").strip().casefold()
    return True if t in lay.valores_sim else False if t in lay.valores_nao else None


def aplicar_enriquecimento(arquivos: list[Path], lay: LayoutEnriquecimento, pasta_base: str | Path) -> dict:
    """Junta os retornos do bureau em base/contatos.csv (números novos e marcas atualizadas).

    Liga pelo CPF/CNPJ (base/pessoas.csv ou coluna cpf dos contatos) ou pelo id_cliente. O
    arquivo mais recente vale por último. Nada do arquivo além de contato e marcas é guardado.
    """
    pasta = Path(pasta_base)
    arq_cont = pasta / "contatos.csv"
    with open(arq_cont, newline="", encoding="utf-8") as f:
        contatos = {(l["id_cliente"], l["contato"]): dict(l) for l in csv.DictReader(f, delimiter=";")}
    ids_de = defaultdict(set)
    if (pasta / "pessoas.csv").exists():
        with open(pasta / "pessoas.csv", newline="", encoding="utf-8") as f:
            for l in csv.DictReader(f, delimiter=";"):
                ids_de[l["documento"]].add(l["id_cliente"])
    for (idc, _), l in contatos.items():
        d = documento(l.get("cpf"))
        if d:
            ids_de[d].add(idc)
    rel = {"arquivos": [], "sem_cliente": 0, "telefones_novos": 0, "telefones_atualizados": 0, "emails_novos": 0}
    tel = lay.telefone
    for arq in sorted(arquivos, key=lambda p: (data_do_arquivo(p), p.name)):
        dia = data_do_arquivo(arq).isoformat()
        n = achados = 0
        with open(arq, newline="", encoding=lay.encoding) as f:
            leitor = csv.reader(f, delimiter=lay.delimitador)
            cab = [c.strip() for c in next(leitor, [])]
            pos = defaultdict(list)
            for i, c in enumerate(cab):
                pos[c].append(i)
            usadas = list(lay.chave.values()) + [v for v in tel.values() if v] + list(lay.emails)
            ausentes = sorted({c for c in usadas if c not in pos})
            if ausentes:
                raise LayoutInvalido(f"{arq.name}: colunas ausentes no arquivo {ausentes}")
            grupos = len(pos[tel["numero"]]) if tel.get("numero") else 0

            def val(linha, campo, k=0):
                nome = tel.get(campo) if campo in tel else campo
                idx = pos.get(nome) or []
                i = idx[k] if k < len(idx) else (idx[0] if len(idx) == 1 else None)
                return linha[i].strip() if i is not None and i < len(linha) else ""

            for linha in leitor:
                n += 1
                if "cpf" in lay.chave:
                    ids = ids_de.get(documento(val(linha, lay.chave["cpf"])) or "", set())
                else:
                    ids = {x for x in [norm.id_cliente(val(linha, lay.chave["id_cliente"]))] if x}
                if not ids:
                    rel["sem_cliente"] += 1
                    continue
                achados += 1
                for k in range(grupos):
                    bruto = re.sub(r"\D", "", val(linha, "numero", k))
                    # alguns bureaus já mandam o DDD dentro do número; só junta se faltar
                    numero = norm.telefone(bruto) if len(bruto) >= 10 or not tel.get("ddd") \
                        else norm.telefone(val(linha, "ddd", k) + bruto)
                    if not numero:
                        continue
                    wa, rcs, np = (_flag(val(linha, c, k), lay) for c in ("whatsapp", "rcs", "nao_perturbe"))
                    score = numero_ou_none(val(linha, "score", k)) if tel.get("score") else None
                    ranking = numero_ou_none(val(linha, "ranking", k)) if tel.get("ranking") else None
                    pert = ""
                    if score is not None and lay.pertence.get("score_min_sim") is not None \
                            and score >= lay.pertence["score_min_sim"]:
                        pert = "sim"
                    if score is not None and lay.pertence.get("score_max_nao") is not None \
                            and score <= lay.pertence["score_max_nao"]:
                        pert = "nao"
                    for idc in ids:
                        c = contatos.get((idc, numero))
                        if c is None:
                            c = contatos[(idc, numero)] = {"id_cliente": idc, "contato": numero, "tipo": "telefone",
                                                           "origem": "enriquecimento", "cpf": "",
                                                           "whatsapp_valido": 0}
                            rel["telefones_novos"] += 1
                        else:
                            rel["telefones_atualizados"] += 1
                        if wa is not None:
                            c["whatsapp_valido"] = int(wa)
                        if rcs is not None:
                            c["rcs_valido"] = int(rcs)
                        if np is not None:
                            c["nao_perturbe"] = int(np)
                        if score is not None:
                            c["score_bureau"] = f"{score:g}"
                        if ranking is not None:
                            c["ranking"] = f"{ranking:g}"
                        if pert:
                            c["pertence"] = pert
                        c["atualizado_em"] = dia
                for ce in lay.emails:
                    for k in range(len(pos[ce])):
                        em = norm.email(linha[pos[ce][k]]) if pos[ce][k] < len(linha) else None
                        if not em:
                            continue
                        for idc in ids:
                            if (idc, em) not in contatos:
                                contatos[(idc, em)] = {"id_cliente": idc, "contato": em, "tipo": "email",
                                                       "origem": "enriquecimento", "cpf": "", "whatsapp_valido": 0}
                                rel["emails_novos"] += 1
                            contatos[(idc, em)]["atualizado_em"] = dia
        rel["arquivos"].append({"arquivo": arq.name, "data": dia, "linhas": n, "clientes_encontrados": achados})
    _gravar_contatos(arq_cont, [contatos[k] for k in sorted(contatos)])
    return rel


def numero_ou_none(v) -> float | None:
    try:
        return float(str(v).replace(",", ".")) if str(v).strip() else None
    except ValueError:
        return None


# ------------------------------------------------------------------ escolhas do motor
def salvar_escolhas(pasta_estado: str | Path, dia: date, fila: list[dict]):
    """Guarda o que o MotorCob mandou acionar em `dia` (substitui o que havia desse dia)."""
    arq = Path(pasta_estado) / "escolhas.csv"
    arq.parent.mkdir(parents=True, exist_ok=True)
    antigas = []
    if arq.exists():
        with open(arq, newline="", encoding="utf-8") as f:
            antigas = [{k: l.get(k) or "" for k in CAMPOS_ESCOLHA}   # arquivo antigo: sem régua/segmento
                       for l in csv.DictReader(f, delimiter=";") if l["data"] != dia.isoformat()]
    novas = [{"data": dia.isoformat(), "id_cliente": l["id_cliente"], "canal": l["canal"], "contato": l["contato"],
              "ordem_contato": l["ordem_contato"], "reserva": int(bool(l["condicao"])),
              "regua": l.get("regua") or "", "cluster": l.get("cluster") or "", "estado": l.get("estado") or "",
              "persona": (l.get("persona") or "").split(" · ")[0]} for l in fila]
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
    """(canal, contato, aviso, candidatos) a partir do que o MotorCob mandou acionar até
    DIAS_BUSCA_ESCOLHA antes. Com vários contatos no canal, contato = "" e candidatos = os
    contatos enviados, na ordem de exportação."""
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
        contatos = []
        for l in sorted((l for l in ls if l["canal"] == escolhido), key=lambda l: int(l.get("ordem_contato") or 1)):
            if l["contato"] not in contatos:
                contatos.append(l["contato"])
        if len(contatos) == 1:
            return escolhido, contatos[0], aviso, ()
        return escolhido, "", aviso, tuple(contatos)
    return canal, "", "sem ação do MotorCob para este ID na data", ()


def ler_ocorrencia(caminho: str | Path, layout: LayoutOcorrencia, empresa: str, escolhas, vistos: set | None = None,
                   identificar=None):
    """Retorna (eventos, relatorio, quarentena).

    O contato vem da coluna contato, se houver; senão do que o MotorCob mandou acionar.
    Quando o canal teve vários números (discador), a ocorrência vale para a TAG do
    cliente mas não certifica nenhum número (contato fica vazio).
    identificar (motor.identificar.Identificador da base do credor): acha o cliente da carga
    mesmo quando o arquivo traz contrato, CPF ou o código com outra formatação.
    """
    caminho = Path(caminho)
    vistos = set() if vistos is None else vistos
    rel = RelatorioOcorrencia(caminho.name)
    eventos, quarentena = [], []
    col = layout.colunas
    fornecedor = f"ocorrencia:{empresa}"
    with open(caminho, newline="", encoding=layout.encoding) as f:
        leitor = csv.DictReader(f, delimiter=layout.delimitador)
        nomes = leitor.fieldnames or []
        # obrigatórias: cliente, data e resultado (CPC sim/não); canal, contato e id são opcionais
        ausentes = [col[k] for k in ("id_cliente", "data", "resultado") if col[k] not in nomes]
        if ausentes:
            raise LayoutInvalido(f"{caminho.name}: colunas obrigatórias ausentes no arquivo {ausentes}")
        col = {k: v for k, v in col.items() if v in nomes}
        ultimo = None   # id_cliente -> (data, canal) da última ação do MotorCob (montado só se precisar)
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
            if identificar:
                achado, como = identificar.resolver(idc)
                if achado is None:
                    rel.rejeitadas["cliente com o mesmo CPF/código em mais de um cadastro" if como == "ambiguo"
                                   else "cliente não encontrado na carga (código, contrato e CPF)"] += 1
                    continue
                if como != "codigo":
                    rel.avisos[f"cliente achado pelo {'CPF' if como == 'cpf' else como}"] += 1
                idc = achado
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
            canal_res, contato_res, aviso, candidatos = _resolver(escolhas, idc, dia, canal)
            canal = canal or canal_res
            if canal is None:
                # a operação acionou fora da lista do MotorCob (outra data, outro canal): o CPC vale
                # do mesmo jeito; o canal é o último que o MotorCob usou com ele, senão o discador
                if ultimo is None:
                    ultimo = {}
                    for (d, i), ls in escolhas.items():
                        if ls and (i not in ultimo or d > ultimo[i][0]):
                            ultimo[i] = (d, min(ls, key=lambda x: int(x["reserva"]))["canal"])
                canal = ultimo[idc][1] if idc in ultimo else "discador"
                aviso = "canal presumido (sem coluna de canal e sem ação do MotorCob na data)"
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
                                  fornecedor=fornecedor, id_externo=id_ext,
                                  candidatos=() if contato else candidatos, origem=caminho.name))
            rel.aceitas += 1
            rel.contato_identificado += bool(contato)
    return eventos, rel, quarentena


def ingerir_ocorrencias(pasta: str | Path, entrada: Entrada, pasta_estado: str | Path, identificar=None):
    """Lê todos os arquivos de ocorrência da pasta. Retorna (eventos, relatorios, quarentena, sem_layout)."""
    escolhas = carregar_escolhas(pasta_estado)
    eventos, relatorios, quarentena, sem_layout = [], [], [], []
    vistos: set = set()
    pasta = Path(pasta)
    if not pasta.exists():
        return eventos, relatorios, quarentena, sem_layout
    for arq in sorted(pasta.glob("*")):
        if not arq.is_file() or arq.name.startswith("."):
            continue
        # um layout de ocorrência só: vale para qualquer arquivo da pasta, seja qual for o nome
        cands = entrada.ocorrencias if len(entrada.ocorrencias) == 1 else \
            [o for o in entrada.ocorrencias if fnmatch(arq.name, o.arquivo)]
        if len(cands) != 1:
            sem_layout.append(arq.name if not cands else f"{arq.name} (layouts ambíguos)")
            continue
        ev, rel, q = ler_ocorrencia(arq, cands[0], entrada.empresa, escolhas, vistos, identificar)
        eventos += ev
        relatorios.append(rel)
        quarentena += q
    return eventos, relatorios, quarentena, sem_layout
