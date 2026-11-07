"""Cluster do cliente: regras de cada empresa sobre qualquer coluna da base.

A empresa define no site (tabela `clusters`) uma lista de regras em ordem. Cada regra
tem um código (entra na TAG), condições sobre colunas da base bruta ou campos
calculados, e o que o cluster muda na operação (pacote de enriquecimento, revalidação,
só digital, voz no D0 do preventivo, canais bloqueados). Vale a primeira regra cujas
condições batem todas; quem não bate em nenhuma cai no cluster padrão ticket x atraso
de `regras/regua.json`.

Campos calculados (valem para qualquer empresa):
  saldo          soma dos contratos do cliente
  dias_atraso    atraso no dia da revisão
  qtd_contratos  número de contratos do cliente
As colunas da base bruta são lidas do contrato de maior saldo do cliente.

Reavaliação diária (decisão do dono, 07/11/2026): segmento cuja condição usa um campo que muda sozinho com o tempo
(`CAMPOS_DIARIOS`: dias de atraso, idade; e "persona" quando alguma persona da carteira usa um deles) é reavaliado
TODA rotina, não só no fechamento do mês. Ver `segmentos_diarios` e `marcacao.reavaliar_diario`.
"""
import csv
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

CAMPOS_CALCULADOS = ("saldo", "dias_atraso", "qtd_contratos")
OPERADORES = ("=", "!=", ">", ">=", "<", "<=", "entre", "em", "nao_em", "contem", "vazio", "preenchido")
CANAIS = ("whatsapp", "rcs", "agente_voz", "discador", "sms", "email")
CANAIS_VOZ = ("agente_voz", "discador")
CODIGO = re.compile(r"^[A-Z0-9]{1,4}$")
# campos que mudam sozinhos com o tempo: o segmento que usa um deles é reavaliado todo dia
CAMPOS_DIARIOS = ("dias_atraso", "idade")


@dataclass(frozen=True)
class RegraCluster:
    codigo: str
    nome: str
    condicoes: tuple[tuple[str, str, object], ...]   # (campo, operador, valor)
    pacote: str = "básico"
    revalida_dias: int = 90
    so_digital: bool = False
    voz_d0: bool = False
    canais_bloqueados: tuple[str, ...] = ()
    estrategia_id: int | None = None

    @property
    def bloqueados(self) -> set[str]:
        return set(self.canais_bloqueados) | (set(CANAIS_VOZ) if self.so_digital else set())

    def enriquecimento(self) -> dict:
        return {"pacote": self.pacote, "revalida_dias": self.revalida_dias, "so_digital": self.so_digital}


_MILHARES = re.compile(r"[+-]?\d{1,3}(\.\d{3}){2,}")


def numero(v) -> float | None:
    """'1.234,56', '1234.56', '1.000.000', 'R$ 10' -> float; None se não for número.

    Com vírgula: pt-BR (ponto = milhar). Sem vírgula e com 2+ pontos em grupos de 3: milhar ('1.000.000').
    Sem vírgula e com UM ponto: decimal ('1.500' = 1,5) -- é como o motor sempre leu o texto salvo, e mudar
    isso trocaria o sentido de regra antiga. O site grava número (JSON) nas condições numéricas desde a
    correção da vírgula, então texto novo com essa ambiguidade não chega mais aqui (site/src/lib/condicoes.ts).
    """
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v or "").replace("R$", "").replace(" ", "").replace("\u00a0", "").strip()
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif _MILHARES.fullmatch(s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def _texto(v) -> str:
    return str(v if v is not None else "").strip().casefold()


def ler_condicoes(lista) -> tuple[list[tuple], str | None]:
    """[{campo, op, valor}] -> ([(campo, op, valor)], erro)."""
    conds = []
    for c in lista or []:
        campo, op, valor = str(c.get("campo") or "").strip(), str(c.get("op") or "").strip(), c.get("valor")
        if not campo or op not in OPERADORES:
            return [], f"condição inválida {c}"
        if op in (">", ">=", "<", "<=") and numero(valor) is None:
            return [], f"'{campo} {op} {valor}': valor precisa ser número (ex.: 1.500,50)"
        if op == "entre":
            faixa = valor if isinstance(valor, (list, tuple)) else str(valor or "").split(";")
            lim = [numero(x) for x in faixa]
            if len(lim) != 2 or None in lim:
                return [], f"'{campo} entre {valor}': informe dois números, de e até (ex.: [1500.5, 3000])"
            if lim[0] > lim[1]:
                return [], f"'{campo} entre {valor}': o primeiro valor precisa ser menor ou igual ao segundo"
            valor = (lim[0], lim[1])
        if op in ("em", "nao_em"):
            valor = tuple(_texto(v) for v in (valor if isinstance(valor, list) else str(valor or "").split(";"))
                          if _texto(v))
        conds.append((campo, op, valor))
    return conds, None


@dataclass(frozen=True)
class PersonaUsuario:
    """Persona criada pela empresa: o perfil do devedor (público), por carteira."""
    id: int
    nome: str
    condicoes: tuple[tuple[str, str, object], ...]


def carregar_personas(linhas: list[dict]) -> tuple[list[PersonaUsuario], list[str]]:
    """Linhas da tabela `personas_usuario` (ativas) em ordem -> (personas, avisos). Vale a 1ª que bate."""
    saida, avisos = [], []
    for l in sorted(linhas or [], key=lambda l: (l.get("ordem") or 0, l.get("id") or 0)):
        if l.get("ativo") is False:
            continue
        nome = str(l.get("nome") or "").strip()
        conds, erro = ler_condicoes(l.get("condicoes"))
        if not nome or erro or not conds:
            avisos.append(f"persona '{nome or l.get('id')}' ignorada: {erro or 'sem nome ou sem características'}")
            continue
        saida.append(PersonaUsuario(l.get("id"), nome, tuple(conds)))
    return saida, avisos


def persona_de(personas: list[PersonaUsuario], cliente, dia: date) -> PersonaUsuario | None:
    for p in personas:
        if all(condicao_ok(cliente, dia, *c) for c in p.condicoes):
            return p
    return None


def carregar_regras(linhas: list[dict]) -> tuple[list[RegraCluster], list[str]]:
    """Linhas da tabela `clusters` (ativas, em ordem) -> (regras válidas, avisos).

    Regra com erro é ignorada e vira aviso (a rotina não para por causa de um cadastro).
    """
    regras, avisos, vistos = [], [], set()
    for l in sorted(linhas, key=lambda l: (l.get("ordem") or 0, str(l.get("codigo")))):
        cod = str(l.get("codigo") or "").strip().upper()
        if not CODIGO.match(cod):
            avisos.append(f"cluster '{cod}': código precisa ter 1 a 4 letras/números")
            continue
        if cod in vistos:
            avisos.append(f"cluster '{cod}': código repetido, vale só o primeiro")
            continue
        conds, erro = ler_condicoes(l.get("condicoes"))
        if erro:
            avisos.append(f"cluster '{cod}' ignorado: {erro}")
            continue
        fora = [c for c in (l.get("canais_bloqueados") or []) if c not in CANAIS]
        if fora:
            avisos.append(f"cluster '{cod}': canais desconhecidos ignorados {fora}")
        vistos.add(cod)
        regras.append(RegraCluster(
            cod, str(l.get("nome") or ""), tuple(conds), str(l.get("pacote") or "básico"),
            int(l.get("revalida_dias") or 90), bool(l.get("so_digital")), bool(l.get("voz_d0")),
            tuple(c for c in (l.get("canais_bloqueados") or []) if c in CANAIS),
            l.get("estrategia_id")))
    return regras, avisos


def versao(regras: list[RegraCluster]) -> str:
    """Muda quando as regras mudam: o motor revisa o cluster de todos na rotina seguinte."""
    if not regras:
        return ""
    return hashlib.sha256(json.dumps([r.__dict__ for r in regras], default=list,
                                     ensure_ascii=False).encode()).hexdigest()[:12]


def valor_do_campo(cliente, dia: date, campo: str):
    if campo == "saldo":
        return cliente.saldo
    if campo == "dias_atraso":
        return cliente.atraso_em(dia)
    if campo == "qtd_contratos":
        return cliente.qtd_contratos
    return (cliente.atributos or {}).get(campo)


def condicao_ok(cliente, dia: date, campo: str, op: str, valor) -> bool:
    v = valor_do_campo(cliente, dia, campo)
    if op == "vazio":
        return _texto(v) == ""
    if op == "preenchido":
        return _texto(v) != ""
    if op in (">", ">=", "<", "<="):
        a, b = numero(v), numero(valor)
        if a is None or b is None:
            return False
        return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]
    if op == "entre":                    # faixa fechada: de <= valor <= até (ler_condicoes já validou)
        a = numero(v)
        return a is not None and valor[0] <= a <= valor[1]
    if op in ("em", "nao_em"):
        dentro = _texto(v) in valor
        return dentro if op == "em" else not dentro
    if op == "contem":
        return _texto(valor) in _texto(v)
    a, b = numero(v), numero(valor)  # '=' e '!=': compara como número quando os dois são números
    igual = (a == b) if a is not None and b is not None else _texto(v) == _texto(valor)
    return igual if op == "=" else not igual


def classificar(regras: list[RegraCluster], cliente, dia: date) -> RegraCluster | None:
    for r in regras:
        if all(condicao_ok(cliente, dia, *c) for c in r.condicoes):
            return r
    return None


def versao_com_personas(versao_regras: str, regras: list[RegraCluster], personas: list) -> str:
    """Segmento que usa o campo "persona" depende das personas da carteira: mudou uma persona,
    muda a versão e o motor reclassifica todos na rotina seguinte (sem esperar a revisão mensal)."""
    if not versao_regras or not any(c[0] == "persona" for r in regras for c in r.condicoes):
        return versao_regras
    pers = json.dumps([(p.id, p.nome, p.condicoes) for p in personas], default=list, ensure_ascii=False)
    return versao_regras + "-" + hashlib.sha256(pers.encode()).hexdigest()[:8]


def campos_diarios(personas: list = ()) -> set[str]:
    """Campos que mudam sozinhos com o tempo. "persona" entra quando alguma persona da carteira usa um deles (a
    persona do cliente pode mudar no dia em que ele passa da faixa)."""
    diarios = set(CAMPOS_DIARIOS)
    if any(c[0] in diarios for p in personas for c in p.condicoes):
        diarios.add("persona")
    return diarios


def segmentos_diarios(regras: list[RegraCluster], personas: list = ()) -> frozenset[str]:
    """Códigos dos segmentos reavaliados todo dia: alguma condição usa um campo que muda com o tempo."""
    diarios = campos_diarios(personas)
    return frozenset(r.codigo for r in regras if any(c[0] in diarios for c in r.condicoes))


def colunas_usadas(regras: list[RegraCluster]) -> set[str]:
    return {c[0] for r in regras for c in r.condicoes} - set(CAMPOS_CALCULADOS)


# ------------------------------------------------------------------ atributos da base
def carregar_atributos(caminho: str | Path | None) -> dict[str, dict[str, str]]:
    """base/atributos.csv (id_cliente + colunas da base bruta) -> {id_cliente: {coluna: valor}}."""
    if not caminho or not Path(caminho).exists():
        return {}
    with open(caminho, newline="", encoding="utf-8") as f:
        return {l["id_cliente"]: {k: v for k, v in l.items() if k != "id_cliente"}
                for l in csv.DictReader(f, delimiter=";")}


def tipos_das_colunas(linhas: list[dict[str, str]], colunas: list[str]) -> list[dict]:
    """[{nome, tipo}] com tipo 'numero' quando todo valor preenchido é número. Só nomes, nunca valores."""
    saida = []
    for c in colunas:
        vals = [l.get(c) for l in linhas if (l.get(c) or "").strip()]
        saida.append({"nome": c, "tipo": "numero" if vals and all(numero(v) is not None for v in vals) else "texto"})
    return saida
