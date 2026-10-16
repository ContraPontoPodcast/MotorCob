"""Etapas que a empresa cria na estratégia (MotorCob e MotorCli).

As fases do motor (MotorCob: quebra, preventivo, CPC, Não CPC, cliente novo; MotorCli: os momentos da
jornada) continuam com as regras de entrada e saída de sempre. Por cima delas, a empresa cria etapas
próprias, na mesma definição da estratégia (estrategias.definicao):

    "etapas": [{
        "id": "ticket-alto", "nome": "Renegociação ticket alto", "ativo": true,
        "condicoes": [{"campo": "saldo", "op": ">", "valor": 10000}],         # quem entra (todas valem)
        "referencia": {"tipo": "entrada"},          # como contar os dias (TIPOS_REF; "coluna" leva "coluna")
        "de": 0, "ate": 20,                         # janela em que o cliente fica na etapa
        "passos": {"0": [ação, ...], "3": [...]},   # a régua: as mesmas ações da estratégia
                                                    # (canal, modo, personas = raia da persona, mensagem)
        "saidas": {"cpc": "padrao", "acordo": "sai", "fim_janela": "etapa:pre-judicial"},
        "ciclo": {"dias": 7, "vezes": 3},           # opcional: a régua repete a cada N dias (passos = dia
                                                    # do ciclo, 1..N), X vezes, dentro da janela
        "orcamento": {"whatsapp": {"modo": "parametrizado", "clientes": 300, "telefones": null,
                                   "prioridade": ["novo", "etapa_antigo", "acao_antiga"],
                                   "fora": "senao"}},  # por canal; sem orçamento = todos da raia
        "travas": {"intervalo_horas": 72, "acoes_dia": 1, "de": "10:00", "ate": "19:00"}
                                                    # opcional: travas próprias da etapa (o resto segue a
                                                    # estratégia; faixas de segurança valem sempre)
    }],
    "ordem_etapas": ["ticket-alto", "quebra", "preventivo", "cpc", "giro", "localizacao"]

Ordem = prioridade: o cliente fica na primeira etapa da lista em que se encaixa. Uma fase do motor na
lista "pega" o cliente que está nela; uma etapa própria acima dela captura antes. Etapa própria fora da
lista entra no topo, na ordem em que foi criada.

Saídas (evento -> destino): "padrao" (sai desta etapa e segue as fases do motor), "sai" (sai da régua:
nenhuma ação, nem das fases do motor, até sair da carga) ou "etapa:<id>" (entra nessa etapa hoje, sem
olhar as condições dela). Evento sem saída configurada não tira o cliente da etapa; o fim da janela
sempre tira (sem destino, volta ao padrão).

Travas que nenhuma etapa desliga ficam onde sempre estiveram: opt-out, Não Perturbe, contato inválido,
janela de horário, domingo e feriado, recência entre ações e pausa entre carteiras do mesmo CPF.

Orçamento por canal: quando a empresa não tem verba para acionar todos, limita o canal na etapa a N
clientes e/ou N telefones por dia (o limite soma o público geral e as personas). Quem recebe primeiro
segue a lista de prioridade (PRIORIDADES; a 1ª decide, a seguinte desempata, empate final = ordem da
carga). Quem fica fora recebe o canal de baixo do dia ("senao": senão/reserva, disputando a sobra do
orçamento desse canal) ou nada hoje ("amanha"). Ficar fora não conta como ação: o passo continua devido
e a recência de 48h não começa.

O estado (quando entrou, passos feitos, quando saiu) fica no servidor, em <estado>/etapas.json, só com o
ID do cliente.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from .cluster import condicao_ok, ler_condicoes


def acoes_da_estrategia(acoes, onde: str, erros: list) -> list:
    """Ações de um dia da régua, no formato da estratégia (canal, modo, contatos, personas, mensagem)."""
    from .estrategia import _acao, _sem_repetir
    if not isinstance(acoes, list):
        return []
    lista = [_acao(a, onde, erros) for a in acoes]
    return _sem_repetir([a for a in lista if a is not None], onde, erros)
from .ingestao import _data

FASES = {
    "cob": ("quebra", "preventivo", "cpc", "giro", "localizacao"),
    "cli": ("pre_vencimento", "boas_vindas", "ativacao", "retencao", "reativacao"),
}
# referência do dia: entrada na etapa, atraso, vencimento (D-5 = -5), contratação, dias sem atividade,
# entrada do lead, ou a data de uma coluna da carga
TIPOS_REF = {"cob": ("entrada", "atraso", "vencimento", "coluna"),
             "cli": ("entrada", "lead", "contratacao", "vencimento", "sem_atividade", "coluna")}
EVENTOS = {"cob": ("cpc", "acordo", "pagamento", "fim_janela"),
           "cli": ("convertido", "fim_janela")}
ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
# critérios de "quem recebe primeiro" no orçamento; os pares opostos não valem juntos
PRIORIDADES = ("novo", "nunca", "etapa_antigo", "etapa_novo", "acao_antiga", "acao_recente",
               "saldo_maior", "saldo_menor", "atraso_maior", "atraso_menor", "hot", "coluna")
OPOSTOS = {"etapa_antigo": "etapa_novo", "etapa_novo": "etapa_antigo", "acao_antiga": "acao_recente",
           "acao_recente": "acao_antiga", "saldo_maior": "saldo_menor", "saldo_menor": "saldo_maior",
           "atraso_maior": "atraso_menor", "atraso_menor": "atraso_maior"}
FORA = "fora"            # escolher(): o cliente saiu da régua


@dataclass(frozen=True)
class Orcamento:
    canal: str
    clientes: int | None          # até N clientes por dia (None = sem limite de clientes)
    telefones: int | None         # até N contatos acionados por dia (None = sem limite de telefones)
    prioridade: tuple             # ((critério, coluna|None), ...)
    fora: str = "senao"           # "senao" (canal de baixo do dia) | "amanha" (nada hoje)


@dataclass(frozen=True)
class Etapa:
    id: str
    nome: str
    condicoes: tuple
    tipo_ref: str
    coluna: str | None
    de: int
    ate: int
    passos: dict = field(hash=False, compare=False)        # {dia(int): [ações]}
    saidas: dict = field(hash=False, compare=False)        # {evento: destino}
    ciclo: tuple | None = None                             # (dias, vezes): a régua repete
    orcamento: dict = field(default_factory=dict, hash=False, compare=False)   # {canal: Orcamento}
    travas: dict = field(default_factory=dict, hash=False, compare=False)
    # {"recencia_horas": h, "limite_dia": n, "janela": (de, ate)} — só o que a etapa definiu


def _int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    s = str(v if v is not None else "").strip()
    return int(s) if re.fullmatch(r"-?\d+", s) else None


def validar(definicao: dict, frente: str, nome: str = "?", validar_acoes=None) -> tuple[list[Etapa], list[str], list[str]]:
    """definicao da estratégia -> (etapas ligadas, ordem de prioridade, avisos). Etapa com erro fica de fora
    (com aviso); o resto vale. validar_acoes(lista, onde, erros) normaliza as ações de um dia (a mesma
    função da régua da estratégia) e devolve a lista válida."""
    erros: list[str] = []
    fases = FASES[frente]
    brutas = definicao.get("etapas") if isinstance(definicao, dict) else None
    if brutas in (None, []):
        return [], list(fases), erros
    if not isinstance(brutas, list):
        return [], list(fases), [f"{nome}: 'etapas' precisa ser uma lista"]
    etapas, vistos = [], set()
    for i, b in enumerate(brutas):
        onde = f"{nome}/etapa {i + 1}"
        if not isinstance(b, dict):
            erros.append(f"{onde}: precisa ser um objeto")
            continue
        eid = str(b.get("id") or "").strip().lower()
        rot = str(b.get("nome") or eid).strip()[:60]
        onde = f"{nome}/{rot or eid or i + 1}"
        if not ID.match(eid) or eid in fases or eid in vistos:
            erros.append(f"{onde}: id '{eid}' inválido, repetido ou igual a uma fase do motor")
            continue
        vistos.add(eid)
        if b.get("ativo") is False:
            continue
        conds, erro = ler_condicoes(b.get("condicoes"))
        if erro or not conds:
            erros.append(f"{onde}: {erro or 'sem condição de entrada'} (etapa ignorada)")
            continue
        ref = b.get("referencia") or {}
        tipo = ref.get("tipo") if isinstance(ref, dict) else ref
        coluna = (ref.get("coluna") or "").strip() if isinstance(ref, dict) else ""
        if tipo not in TIPOS_REF[frente] or (tipo == "coluna" and not coluna):
            erros.append(f"{onde}: dia de referência '{tipo}' inválido (etapa ignorada)")
            continue
        de, ate = _int(b.get("de")), _int(b.get("ate"))
        if de is None or ate is None or de > ate or ate - de > 730:
            erros.append(f"{onde}: janela de dias inválida ({b.get('de')}..{b.get('ate')}) (etapa ignorada)")
            continue
        ciclo = None
        if b.get("ciclo"):
            c = b["ciclo"] if isinstance(b["ciclo"], dict) else {}
            cd, cv = _int(c.get("dias")), _int(c.get("vezes"))
            if cd is None or cv is None or not 2 <= cd <= 60 or not 1 <= cv <= 24:
                erros.append(f"{onde}: ciclo inválido ({c.get('dias')} dias × {c.get('vezes')} vezes) (etapa ignorada)")
                continue
            ciclo = (cd, cv)
        lo, hi = (1, ciclo[0]) if ciclo else (de, ate)
        passos = {}
        for k, acoes in (b.get("passos") or {}).items():
            d = _int(str(k).upper().replace("D+", "").replace("D", ""))
            if d is None or not lo <= d <= hi:
                erros.append(f"{onde}: dia '{k}' fora {'do ciclo' if ciclo else 'da janela'} {lo}..{hi} (ignorado)")
                continue
            lista = validar_acoes(acoes, f"{onde}/dia {d}", erros) if validar_acoes else acoes
            if lista:
                passos[d] = lista
        if not passos:
            erros.append(f"{onde}: régua sem nenhum dia válido (etapa ignorada)")
            continue
        saidas = {}
        for ev, dest in (b.get("saidas") or {}).items():
            if ev not in EVENTOS[frente]:
                erros.append(f"{onde}: saída '{ev}' desconhecida (ignorada)")
                continue
            if dest in ("padrao", "sai") or (isinstance(dest, str) and dest.startswith("etapa:")):
                saidas[ev] = dest
            elif dest not in (None, "", False):
                erros.append(f"{onde}: destino '{dest}' inválido na saída '{ev}' (ignorado)")
        canais = {a.get("canal") for acs in passos.values() for a in acs if isinstance(a, dict)}
        orc = _ler_orcamento(b.get("orcamento"), canais, onde, erros)
        travas = _ler_travas_etapa(b.get("travas"), onde, erros)
        etapas.append(Etapa(eid, rot, tuple(conds), tipo, coluna or None, de, ate, passos, saidas, ciclo, orc, travas))
    ids = {e.id for e in etapas}
    for e in etapas:   # destino para etapa que não existe (ou desligada) vira volta ao padrão
        for ev, dest in list(e.saidas.items()):
            if dest.startswith("etapa:") and dest[6:] not in ids:
                erros.append(f"{nome}/{e.nome}: saída '{ev}' vai para etapa inexistente '{dest[6:]}' (vale o padrão)")
                e.saidas[ev] = "padrao"
    ordem = [x for x in (definicao.get("ordem_etapas") or []) if isinstance(x, str)]
    ordem = [x for x in dict.fromkeys(ordem) if x in ids or x in fases]
    ordem = [e.id for e in etapas if e.id not in ordem] + ordem
    ordem += [f for f in fases if f not in ordem]
    return etapas, ordem, erros


NOMES_FASE = {"quebra": "Acordo · parcela vencida", "preventivo": "Acordo · antes do vencimento", "cpc": "CPC",
              "giro": "Não CPC", "localizacao": "Cliente novo"}      # nomes do glossário (bloco 5)


def validar_fases(definicao: dict, frente: str, nome: str, canais) -> tuple[dict, list[str]]:
    """Orçamento por canal, prioridade e travas próprias das fases do motor (bloco 3), no bloco de cada
    fase da estratégia: definicao.<fase>.orcamento / definicao.<fase>.travas (mesmo formato das etapas
    próprias). Devolve {fase: Etapa sem régua} só das fases que definiram algo, e os avisos."""
    erros: list[str] = []
    saida = {}
    if not isinstance(definicao, dict):
        return saida, erros
    for fase in FASES[frente]:
        b = definicao.get(fase)
        if not isinstance(b, dict) or not (b.get("orcamento") or b.get("travas")):
            continue
        onde = f"{nome}/{NOMES_FASE.get(fase, fase)}"
        orc = _ler_orcamento(b.get("orcamento"), set(canais), onde, erros)
        travas = _ler_travas_etapa(b.get("travas"), onde, erros)
        if orc or travas:
            saida[fase] = Etapa(fase, NOMES_FASE.get(fase, fase), (), "entrada", None, 0, 0, {}, {}, None, orc, travas)
    return saida, erros


def _ler_travas_etapa(bruto, onde: str, erros: list) -> dict:
    """Travas próprias da etapa, dentro das faixas de segurança (motor/travas.py)."""
    from .travas import HORA, MAX_HORA, MIN_HORA, MIN_INTERVALO_H
    if not isinstance(bruto, dict) or not bruto:
        return {}
    t = {}
    h = _int(bruto.get("intervalo_horas"))
    if h is not None:
        if h < MIN_INTERVALO_H:
            erros.append(f"{onde}: intervalo mínimo de {MIN_INTERVALO_H} h entre ações (usado {MIN_INTERVALO_H} h)")
        t["recencia_horas"] = max(MIN_INTERVALO_H, min(h, 24 * 30))
    n = _int(bruto.get("acoes_dia"))
    if n is not None and n >= 1:
        t["limite_dia"] = n
    de, ate = bruto.get("de"), bruto.get("ate")
    if de or ate:
        de, ate = str(de or MIN_HORA), str(ate or MAX_HORA)
        if HORA.match(de) and HORA.match(ate) and max(de, MIN_HORA) < min(ate, MAX_HORA):
            t["janela"] = (max(de, MIN_HORA), min(ate, MAX_HORA))
        else:
            erros.append(f"{onde}: horário da etapa inválido (vale o da estratégia)")
    return t


def janela_da_etapa(janela: str, travas: dict) -> str:
    """'08:00-20:00' encurtado pelo horário da etapa (nunca amplia)."""
    if not travas.get("janela") or "-" not in str(janela):
        return janela
    a, b = str(janela).split("-", 1)
    de, ate = max(a, travas["janela"][0]), min(b, travas["janela"][1])
    return f"{de}-{ate}" if de < ate else janela


def cortar_canais(linhas: list, n: int | None) -> list:
    """Limite de ações (canais) no dia: ficam as linhas dos n primeiros canais, na ordem da régua."""
    if not n:
        return linhas
    canais = list(dict.fromkeys(l["canal"] for l in linhas))[:n]
    return [l for l in linhas if l["canal"] in canais]


def _ler_orcamento(bruto, canais: set, onde: str, erros: list) -> dict:
    """{canal: {...}} -> {canal: Orcamento}, só os parametrizados ("todos" ou ausente = sem limite)."""
    if not bruto:
        return {}
    if not isinstance(bruto, dict):
        erros.append(f"{onde}: 'orcamento' precisa ser um objeto por canal (ignorado)")
        return {}
    saida = {}
    for canal, o in bruto.items():
        if not isinstance(o, dict) or o.get("modo", "parametrizado") in ("todos", None):
            continue
        if canal not in canais:
            erros.append(f"{onde}: orçamento de '{canal}', canal que não está na régua (ignorado)")
            continue
        cl, tel = _int(o.get("clientes")), _int(o.get("telefones"))
        if (cl is None and tel is None) or (cl is not None and cl < 0) or (tel is not None and tel < 0):
            erros.append(f"{onde}: orçamento de '{canal}' sem limite válido de clientes ou telefones (vale todos)")
            continue
        prio, usados = [], set()
        for item in o.get("prioridade") or []:
            crit, col = (item.get("criterio"), (item.get("coluna") or "").strip()) if isinstance(item, dict) else (item, "")
            if crit not in PRIORIDADES or (crit == "coluna" and not col):
                erros.append(f"{onde}: prioridade '{crit}' desconhecida no orçamento de '{canal}' (ignorada)")
                continue
            if OPOSTOS.get(crit) in usados or crit in usados and crit != "coluna":
                erros.append(f"{onde}: prioridade '{crit}' contradiz uma anterior no orçamento de '{canal}' (ignorada)")
                continue
            usados.add(crit)
            prio.append((crit, col or None))
        fora = o.get("fora") if o.get("fora") in ("senao", "amanha") else "senao"
        saida[canal] = Orcamento(canal, cl, tel, tuple(prio), fora)
    return saida


# ------------------------------------------------------------------ estado
def carregar_estado(pasta) -> dict:
    arq = Path(pasta) / "etapas.json"
    try:
        return json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}
    except (OSError, ValueError):
        return {}


def salvar_estado(pasta, estado: dict) -> None:
    arq = Path(pasta) / "etapas.json"
    arq.parent.mkdir(parents=True, exist_ok=True)
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(json.dumps(estado, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp.replace(arq)


def limpar(estado: dict, presentes: set) -> None:
    """Quem saiu da carga perde o estado das etapas (voltando, começa de novo)."""
    for idc in [k for k in estado if k not in presentes]:
        del estado[idc]


# ------------------------------------------------------------------ escolha do dia
@dataclass
class Escolha:
    etapa: Etapa
    dia: int                 # dia de referência de hoje
    passo: int | None        # dia da régua devido hoje (None = nada hoje)
    mem: dict                # estado do cliente nesta etapa (para marcar_feito)
    hoje: date | None = None
    volta: int | None = None  # nº do ciclo (1, 2, …) quando a régua da etapa repete

    @property
    def rotulo(self) -> str:
        p = self.passo
        if self.volta is not None:
            return f"C{self.volta}-D{p}"
        return "D0" if p == 0 else (f"D{p}" if p < 0 else f"D+{p}")

    @property
    def chave_feito(self) -> str:
        return f"{self.volta}:{self.passo}" if self.volta is not None else str(self.passo)


def _cliente(campos: dict):
    """As condições usam o mesmo avaliador dos segmentos e personas."""
    return SimpleNamespace(saldo=campos.get("saldo"), qtd_contratos=campos.get("qtd_contratos"),
                           atraso_em=lambda dia: campos.get("dias_atraso"), atributos=campos)


def encaixa(e: Etapa, campos: dict, hoje: date) -> bool:
    c = _cliente(campos)
    return all(condicao_ok(c, hoje, *cond) for cond in e.condicoes)


def dia_ref(e: Etapa, mem: dict, campos: dict, datas: dict, hoje: date) -> int | None:
    t = e.tipo_ref
    if t == "entrada":
        return (hoje - date.fromisoformat(mem["entrou"])).days if mem.get("entrou") else 0
    if t == "atraso":
        v = campos.get("dias_atraso")
        return int(v) if isinstance(v, (int, float)) else None
    if t == "coluna":
        d = _data(str(campos.get(e.coluna) or "")) if campos.get(e.coluna) else None
        return (hoje - d).days if d else None
    d = datas.get(t)
    if d is None:
        return None
    return -(d - hoje).days if t == "vencimento" else (hoje - d).days


def _sair(st: dict, e: Etapa, evento: str, hoje: date, padrao_quando_vazio: bool) -> str | None:
    """Aplica a saída configurada do evento. Devolve o destino aplicado (ou None se o evento não tira)."""
    dest = e.saidas.get(evento) or ("padrao" if padrao_quando_vazio else None)
    if dest is None:
        return None
    m = st["etapas"].setdefault(e.id, {})
    m["saiu"], m["motivo"] = hoje.isoformat(), evento
    if st.get("forcada") == e.id:
        st.pop("forcada")
    if dest == "sai":
        st["fora"] = {"desde": hoje.isoformat(), "etapa": e.id, "motivo": evento}
    elif dest.startswith("etapa:"):
        st["forcada"] = dest[6:]
        st["etapas"][dest[6:]] = {"entrou": hoje.isoformat(), "feitos": {}}
    return dest


def escolher(etapas: list[Etapa], ordem: list[str], fase: str | None, campos: dict, datas: dict,
             eventos: set, estado: dict, idc: str, hoje: date):
    """Etapa do cliente hoje: Escolha (etapa própria), None (segue a fase do motor) ou FORA.

    fase: a fase do motor em que o cliente está hoje (uma de FASES, ou None). eventos: o que aconteceu
    desde a rodada anterior (EVENTOS). estado: o dicionário de etapas.json (é atualizado)."""
    if not etapas:
        return None
    st = estado.setdefault(idc, {"etapas": {}})
    st.setdefault("etapas", {})
    if st.get("fora"):
        return FORA
    por_id = {e.id: e for e in etapas}
    atual = st.get("atual")
    if atual in por_id:                         # eventos tiram o cliente da etapa em que estava
        for ev in sorted(eventos):
            if _sair(st, por_id[atual], ev, hoje, padrao_quando_vazio=False):
                st.pop("atual", None)
                if st.get("fora"):
                    return FORA
                break
    for _ in range(len(ordem) + 1):             # um destino "etapa:x" pode encadear; limite evita laço
        mudou = False
        for item in ordem:
            if item not in por_id:
                if item == fase and st.get("forcada") is None:
                    st.pop("atual", None)
                    return None
                continue
            e = por_id[item]
            forcada = st.get("forcada") == e.id
            m = st["etapas"].get(e.id) or {}
            if not forcada and (m.get("saiu") or not encaixa(e, campos, hoje)):
                continue
            if not m.get("entrou"):
                m = st["etapas"][e.id] = {"entrou": hoje.isoformat(), "feitos": {}}
            d = dia_ref(e, m, campos, datas, hoje)
            if d is None or d < e.de:
                if forcada:     # forçada mas ainda antes da janela: espera nela
                    st["atual"] = e.id
                    return Escolha(e, d if d is not None else e.de - 1, None, m, hoje)
                continue
            if d > e.ate:
                _sair(st, e, "fim_janela", hoje, padrao_quando_vazio=True)
                st.pop("atual", None)
                if st.get("fora"):
                    return FORA
                mudou = True
                break
            volta, dc = None, d
            if e.ciclo:
                volta, dc = (d - e.de) // e.ciclo[0] + 1, (d - e.de) % e.ciclo[0] + 1
                if volta > e.ciclo[1]:          # acabaram os ciclos: mesma saída do fim da janela
                    _sair(st, e, "fim_janela", hoje, padrao_quando_vazio=True)
                    st.pop("atual", None)
                    if st.get("fora"):
                        return FORA
                    mudou = True
                    break
            st["atual"] = e.id
            chegou = [p for p in e.passos if p <= dc]
            passo = max(chegou) if chegou else None
            esc = Escolha(e, d, passo, m, hoje, volta)
            feito_em = (m.get("feitos") or {}).get(esc.chave_feito) if isinstance(m.get("feitos"), dict) else None
            if passo is not None and feito_em and feito_em < hoje.isoformat():
                esc.passo = None  # já saiu num dia anterior (rodar de novo no mesmo dia refaz o passo)
            return esc
        if not mudou:
            break
    st.pop("atual", None)
    return None


def so_eventos(etapas: list[Etapa], eventos: set, estado: dict, idc: str, hoje: date) -> None:
    """Cliente sem régua hoje (encerrado, acordo ativo): só aplica a saída da etapa em que estava."""
    st = estado.get(idc) or {}
    atual = {e.id: e for e in etapas}.get(st.get("atual"))
    if atual is None:
        return
    for ev in sorted(eventos):
        if _sair(st, atual, ev, hoje, padrao_quando_vazio=False):
            st.pop("atual", None)
            break


def marcar_feito(escolha: Escolha) -> None:
    if escolha.passo is not None:
        f = escolha.mem.get("feitos") if isinstance(escolha.mem.get("feitos"), dict) else {}
        f[escolha.chave_feito] = (escolha.hoje or date.today()).isoformat()
        escolha.mem["feitos"] = f


# ------------------------------------------------------------------ orçamento por canal
@dataclass
class Pendente:
    """Cliente com ação hoje numa etapa que tem orçamento: as linhas esperam o corte do orçamento.
    montar(excluir) refaz as linhas do dia sem os canais em `excluir` (o canal de baixo assume)."""
    idc: str
    escolha: Escolha
    info: dict
    montar: object
    linhas: list
    excluir: set = field(default_factory=set)
    cortado: bool = False


def info_prioridade(escolha: Escolha, hoje: date, ultima_acao: date | None = None, saldo=None, atraso=None,
                    hot: bool = False, atributos: dict | None = None) -> dict:
    """O que os critérios de prioridade olham, para um cliente numa etapa."""
    m = escolha.mem or {}
    entrou = date.fromisoformat(m["entrou"]) if m.get("entrou") else hoje
    feitos = [v for v in (m.get("feitos") or {}).values() if isinstance(v, str) and v < hoje.isoformat()]
    datas = [date.fromisoformat(v) for v in feitos] + ([ultima_acao] if ultima_acao else [])
    ult = max(datas, default=None)
    return {"novo": entrou >= hoje, "nunca": not feitos, "dias_etapa": (hoje - entrou).days,
            "dias_ultima": (hoje - ult).days if ult else None, "saldo": saldo, "atraso": atraso,
            "hot": bool(hot), "atributos": atributos or {}}


def _num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    t = str(v if v is not None else "").strip()
    if "," in t:                         # 1.234,56
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def chave_prioridade(orc: Orcamento, info: dict, idc: str, posicao: int) -> tuple:
    """Ordenação de quem recebe primeiro (menor = antes). Empate final: ordem da carga (posicao)."""
    k, NUNCA = [], 10 ** 9
    for crit, col in orc.prioridade:
        if crit == "novo":
            k.append(0 if info["novo"] else 1)
        elif crit == "nunca":
            k.append(0 if info["nunca"] else 1)
        elif crit == "etapa_antigo":
            k.append(-info["dias_etapa"])
        elif crit == "etapa_novo":
            k.append(info["dias_etapa"])
        elif crit == "acao_antiga":      # nunca acionado conta como a ação mais antiga
            k.append(-(info["dias_ultima"] if info["dias_ultima"] is not None else NUNCA))
        elif crit == "acao_recente":
            k.append(info["dias_ultima"] if info["dias_ultima"] is not None else NUNCA)
        elif crit in ("saldo_maior", "saldo_menor", "atraso_maior", "atraso_menor", "coluna"):
            v = _num(info["atributos"].get(col)) if crit == "coluna" else _num(info[crit.split("_")[0]])
            if v is None:
                k.append(float("inf"))   # sem o dado: vai para o fim nesse critério
            else:
                k.append(v if crit.endswith("_menor") else -v)
        elif crit == "hot":
            k.append(0 if info["hot"] else 1)
    return (*k, posicao, idc)


def aplicar_orcamento(pendentes: list[Pendente], alertas: list | None = None) -> None:
    """Corta as linhas pelo orçamento de cada canal em cada etapa. Atualiza p.linhas e p.cortado.

    Em cada volta, cada (etapa, canal) com orçamento ordena quem ainda tem o canal nas linhas e guarda os
    primeiros que cabem; quem não cabe perde o canal (o canal de baixo do dia assume, e esse cliente
    disputa a sobra do orçamento dele) ou fica sem nada hoje ("amanha"). Um canal tirado de um cliente
    não volta, então as voltas terminam."""
    if not pendentes:
        return
    posicao = {p.idc: i for i, p in enumerate(pendentes)}
    orcs = {}
    for p in pendentes:
        for canal, o in p.escolha.etapa.orcamento.items():
            orcs.setdefault((p.escolha.etapa.id, canal), o)
    fora_por = {}
    for _ in range(len(orcs) * 8 + 2):
        mudou = False
        for (eid, canal), o in sorted(orcs.items()):
            membros = [p for p in pendentes if p.escolha.etapa.id == eid and not p.cortado
                       and any(l["canal"] == canal for l in p.linhas)]
            membros.sort(key=lambda p: chave_prioridade(o, p.info, p.idc, posicao[p.idc]))
            nc = nt = 0
            for p in membros:
                n = sum(1 for l in p.linhas if l["canal"] == canal)
                cabe = (o.clientes is None or nc < o.clientes) and (o.telefones is None or nt + n <= o.telefones)
                if cabe:
                    nc, nt = nc + 1, nt + n
                    continue
                mudou = True
                fora_por[(eid, canal)] = fora_por.get((eid, canal), 0) + 1
                if o.fora == "amanha":
                    p.linhas, p.cortado = [], True
                else:
                    p.excluir.add(canal)
                    p.linhas = p.montar(set(p.excluir)) or []
                    p.cortado = not p.linhas
        if not mudou:
            break
    if alertas is not None:
        for (eid, canal), n in sorted(fora_por.items()):
            alertas.append(f"ORÇAMENTO {eid}/{canal}: {n} cliente(s) ficaram fora do canal hoje")


# ------------------------------------------------------------------ eventos do MotorCob
FASE_DO_ESTADO = {"LOC": "localizacao", "CPA": "cpc", "CPB": "cpc", "NCP": "giro",
                  "PRE": "preventivo", "COL": "preventivo", "QBR": "quebra"}


def eventos_cob(antes: str | None, agora: str) -> set:
    """Eventos do MotorCob pela mudança de estado desde a rodada anterior."""
    ev = set()
    if antes is None or antes == agora:
        return ev
    if agora in ("CPA", "CPB") and antes in ("LOC", "NCP"):
        ev.add("cpc")
    if agora in ("PRE", "COL") and antes not in ("PRE", "COL", "QBR"):
        ev.add("acordo")
    if agora == "LIQ":
        ev.add("pagamento")
    return ev
