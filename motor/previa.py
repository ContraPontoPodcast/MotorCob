"""Prévia de segmentação: o retrato por cliente que o banco usa para contar quem cairia em cada segmento.

A RPC `previa_segmentacao` (SQL 76) avalia as condições propostas no banco com a mesma regra de
`cluster.condicao_ok` e devolve SÓ contagens agregadas. Para isso a rotina publica, por carteira, uma linha por
cliente em cobrança (tabela `atributos_previa`, sem leitura direta pelo site) com:

- `id_cliente` (o código pseudônimo do SQL 73, nunca o CPF), o segmento em que ele está hoje (`segmento_atual`;
  vazio = Demais), saldo, dias de atraso NO DIA da rotina e quantidade de contratos;
- `atributos`: só os campos que valem em condição e não identificam ninguém: os calculados pelo motor
  (`CALCULADOS`) e as colunas da carga que passam no filtro `colunas_publicaveis` (nome que não é de dado pessoal;
  texto com poucas categorias; número que não tem cara de código). Nome, documento, contato, endereço, data de
  nascimento e códigos (contrato, conta…) nunca saem do motor.

Universo = clientes da carga (na_carga) fora de BLQ/LIQ: exatamente quem o motor reavalia o segmento.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

from .cluster import numero

# atributos que o motor calcula (rodar_dia): valem em segmento e persona e não identificam ninguém
CALCULADOS = ("idade", "tem_email", "tem_celular", "so_fixo", "qtd_telefones", "tem_whatsapp", "tem_rcs", "ddd",
              "melhor_contato", "tem_contato_certificado", "contatos_alcancaveis", "persona")
LIMITE_CATEGORIAS = 50          # coluna de texto com mais valores distintos que isso não vai (nome, endereço…)
# partes do nome da coluna que denunciam dado pessoal: nunca publicadas, qualquer que seja o conteúdo
PESSOAIS = {"NOME", "NAME", "CPF", "CNPJ", "RG", "DOC", "DOCUMENTO", "EMAIL", "MAIL", "TEL", "TELEFONE", "FONE",
            "CELULAR", "CEL", "WHATSAPP", "ENDERECO", "LOGRADOURO", "RUA", "COMPLEMENTO", "CEP", "NASC",
            "NASCIMENTO", "MAE", "PAI", "CONJUGE", "SENHA", "PLACA", "CHASSI", "RENAVAM", "IP", "PIS", "NIS",
            "TITULO", "PASSAPORTE", "CNH", "SOBRENOME", "APELIDO",
            # SQL 88 · risco R1: colunas de validação que não foram apontadas (ULT3_DOC, DIG_CPF, DT_NASC, ULTIMOS_DIGITOS…)
            "ULT3", "ULTIMOS", "DIGITOS", "DIG", "DV", "DTNASC", "VALIDACAO"}
# partes que denunciam código (número que identifica): número com muitos valores distintos e esse nome não vai
CODIGOS = {"ID", "COD", "CODIGO", "NUM", "NUMERO", "NR", "NRO", "CONTRATO", "CONTA", "AGENCIA", "CARTAO",
           "MATRICULA", "PROTOCOLO", "PROPOSTA", "OPERACAO", "TITULO", "BOLETO", "LINHA", "CHAVE"}


def _partes(nome: str) -> set[str]:
    t = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().upper()
    return {p for p in re.split(r"[^A-Z0-9]+", t) if p}


def colunas_publicaveis(valores: dict[str, list[str]]) -> tuple[list[str], list[str]]:
    """{coluna: valores dos clientes} -> (publicáveis, fora). Só nomes: nenhum valor sai daqui."""
    sim, nao = [], []
    for col, vals in valores.items():
        partes = _partes(col)
        preenchidos = [v for v in vals if str(v or "").strip()]
        distintos = {str(v).strip().casefold() for v in preenchidos}
        numerica = bool(preenchidos) and all(numero(v) is not None for v in preenchidos)
        if col in CALCULADOS or partes & PESSOAIS:
            ok = False
        elif len(distintos) <= LIMITE_CATEGORIAS:
            ok = True                       # categoria (UF, produto, faixa…): não identifica ninguém
        else:
            ok = numerica and not (partes & CODIGOS)   # renda, valor da parcela…; código de contrato não
        (sim if ok else nao).append(col)
    return sim, nao


def linhas(estados: dict, clientes: dict, hoje: date, regua, ativos: set | None) -> tuple[list[dict], list[str]]:
    """Linhas da `atributos_previa` (sem empresa/carteira/data, que a nuvem põe) e as colunas da carga que ficaram
    fora por parecerem dado pessoal ou código."""
    universo = [(k, e, clientes[k]) for k, e in estados.items()
                if k in clientes and e.estado not in ("BLQ", "LIQ") and (ativos is None or k in ativos)]
    da_carga: dict[str, list[str]] = {}
    for _, _, c in universo:
        for col, v in (c.atributos or {}).items():
            if col not in CALCULADOS:
                da_carga.setdefault(col, []).append(v)
    sim, fora = colunas_publicaveis(da_carga)
    campos = set(sim) | set(CALCULADOS)
    saida = []
    for k, e, c in universo:
        attrs = {col: str(v) for col, v in (c.atributos or {}).items()
                 if col in campos and v is not None and str(v).strip() != ""}
        saida.append({"id_cliente": k,
                      "segmento_atual": e.cluster_atual if regua._regra(e.cluster_atual) is not None else None,
                      "saldo": round(float(c.saldo or 0), 2), "dias_atraso": int(c.atraso_em(hoje)),
                      "qtd_contratos": int(c.qtd_contratos or 0), "atributos": attrs})
    return saida, sorted(fora)
