"""Discagem, fase 1: regras de discagem e renitência que valem para QUALQUER discador do mercado.

O MotorCX decide quem, qual número, quantas vezes e em que janela; o discador só executa. O MotorCX
informa, sugere e alerta; quem decide é o cliente: cada regra tem valor recomendado e liga/desliga.

Configuração em camadas (a de cima vence):
  trava `ligacoes` da estratégia (motor/travas.py; só tentativas e intervalos)
  > do credor (rodar_dia(discagem=...); tolerante: parte inválida fica de fora, com aviso)
  > regras/regua.json › discagem (padrão MotorCob; validado na carga, falha alto).

- Tentativas e intervalos vão como colunas no mailing (discador_mailing.csv); na régua o dia continua
  contando 1 tentativa. tentativas_cliente_dia = spins_discador_dia (None = o spins de hoje).
- Horários por UF/DDD: janela do número = janela da estratégia ∩ canal ∩ UF do DDD (tabela do cliente,
  senão a PRÉVIA regras/horarios_uf.json — referência, não é orientação jurídica), da hora local para a
  de Brasília pelo fuso, ∩ faixa global 08:00–20:00, nunca domingo nem feriado nacional. Número sem
  janela hoje não sai na voz (o próximo número do cliente assume; sem nenhum, motivo na Lista do dia).
- Renitência: descanso depois de N "não atende" (pausa da voz no número, via retorno_canal), recusa
  (descanso da voz do cliente), promessa (voz do cliente suspensa até a data prometida + 1; promessa é
  CPC, não é pagamento), inexistente (layout que marca `inexistente_confirmado` só bloqueia com esses
  códigos; o resto vira falha de rede) e "não ligar" (opt-out de voz: sai de todos os canais de voz).
  Padrão: só inexistente e "não ligar" ligados (recomendados); os outros vêm com o valor recomendado,
  desligados.
- Chamadas curtas (MP 1.396/2026: bloqueio das linhas com ≥ 85% de curtas e mais de 1 mil chamadas numa
  linha ou 10 mil no total no dia): KPI medido pelos retornos de voz (cada linha = uma chamada), previsão
  do dia (Σ tentativas × P(curta) do número), alerta e corte OPCIONAL (desligado). O motor não sabe por
  qual linha de saída o discador liga: o limite por linha vira "linhas mínimas" no alerta.
"""
import copy
import json
import math
from collections import Counter, defaultdict
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from . import voz as V

PREVIA = Path(__file__).resolve().parent.parent / "regras" / "horarios_uf.json"
MIN_HORA, MAX_HORA = "08:00", "20:00"        # faixa de segurança global (motor/travas.py)
CANAIS_VOZ = V.CANAIS_VOZ
ORIGEM = "discagem:"                          # registros de voz vindos das ocorrências (retorno_canal)

PADRAO = {
    "tentativas_numero_dia": 2,
    "tentativas_cliente_dia": None,           # None = spins_discador_dia
    "intervalo_min_minutos": 120,
    "intervalo_ocupado_minutos": 15,
    "descanso_nao_atende": {"ativo": False, "n": 6, "em_dias": 3, "descansa_dias": 7},
    "descanso_recusa": {"ativo": False, "dias": 7},
    "promessa_suspende": {"ativo": False, "dias_sem_data": 7},
    # inexistente (decisão do dono, 31/10/2026): só a voz (so_voz; "invalida" = regra antiga, número INVALIDO em
    # tudo), 2 confirmações em dias diferentes, reteste em D+7 até 3 vezes e trava de lote (suspeita de rota)
    # so_voz_desde: só os retornos a partir desta data seguem a regra nova; os de antes ficam como estavam (número já
    # inválido continua inválido). Para reavaliar os antigos, o credor põe uma data anterior.
    "inexistente": {"ativo": True, "modo": "so_voz", "so_voz_desde": "2026-11-01", "confirmacoes": 2, "reteste_dias": 7, "max_retestes": 3,
                    "sinal_outros_canais": True, "aceita_tipo_b": True,
                    "trava_lote_ativo": True, "trava_lote_minimo": 200, "trava_lote_fracao": 0.30,
                    "trava_lote_relativa": 2.0, "trava_lote_pp_min": 0.10, "trava_rota_minimo": 50},
    "nao_ligar": {"ativo": True},
    "horarios": {"ativo": False, "tabela": None},   # desligado até o jurídico validar a prévia
    "chamadas_curtas": {"ativo": True, "aviso": 0.75, "corte_ativo": False, "corte": 0.80,
                        "max_por_numero_dia": 900, "max_total_dia": 9000, "abandono_conta": True, "segundos": 6},
}
# campo -> (tipo, mínimo, máximo) dos blocos
_SUB = {
    "descanso_nao_atende": {"ativo": bool, "n": (1, 50), "em_dias": (1, 60), "descansa_dias": (1, 365)},
    "descanso_recusa": {"ativo": bool, "dias": (1, 365)},
    "promessa_suspende": {"ativo": bool, "dias_sem_data": (1, 90)},
    "inexistente": {"ativo": bool, "modo": ("so_voz", "invalida"), "so_voz_desde": "data", "confirmacoes": (1, 10), "reteste_dias": (1, 90),
                    "max_retestes": (0, 10), "sinal_outros_canais": bool, "aceita_tipo_b": bool,
                    "trava_lote_ativo": bool, "trava_lote_minimo": (1, 10 ** 6), "trava_lote_fracao": "fracao",
                    "trava_lote_relativa": ("real", 1.0, 20.0), "trava_lote_pp_min": "fracao",
                    "trava_rota_minimo": (1, 10 ** 6)},
    "nao_ligar": {"ativo": bool},
    "chamadas_curtas": {"ativo": bool, "aviso": "fracao", "corte_ativo": bool, "corte": "fracao",
                        "max_por_numero_dia": (1, 10 ** 6), "max_total_dia": (1, 10 ** 8),
                        "abandono_conta": bool, "segundos": (1, 60)},
}
_INTEIROS = {"tentativas_numero_dia": (1, 10), "tentativas_cliente_dia": (1, 10),
             "intervalo_min_minutos": (0, 1440), "intervalo_ocupado_minutos": (0, 1440)}

DDD_UF = {str(d): uf for uf, ds in {
    "SP": range(11, 20), "RJ": (21, 22, 24), "ES": (27, 28), "MG": (31, 32, 33, 34, 35, 37, 38),
    "PR": range(41, 47), "SC": (47, 48, 49), "RS": (51, 53, 54, 55), "DF": (61,), "GO": (62, 64), "TO": (63,),
    "MT": (65, 66), "MS": (67,), "AC": (68,), "RO": (69,), "BA": (71, 73, 74, 75, 77), "SE": (79,),
    "PE": (81, 87), "AL": (82,), "PB": (83,), "RN": (84,), "CE": (85, 88), "PI": (86, 89), "PA": (91, 93, 94),
    "AM": (92, 97), "RR": (95,), "AP": (96,), "MA": (98, 99)}.items() for d in ds}
UFS = frozenset(DDD_UF.values())
FUSO = {"AM": -1, "MT": -1, "MS": -1, "RO": -1, "RR": -1, "AC": -2}   # horas em relação a Brasília (sem horário de verão)


# ------------------------------------------------------------------ configuração
def _bool(v):
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("1", "true", "sim", "s", "ligado", "on"):
        return True
    if s in ("0", "false", "nao", "não", "n", "desligado", "off"):
        return False
    raise ValueError("use sim/não")


def _inteiro(v, lo, hi):
    if isinstance(v, bool) or v is None:
        raise ValueError(f"use um número de {lo} a {hi}")
    n = int(str(v).strip())
    if not lo <= n <= hi:
        raise ValueError(f"use um número de {lo} a {hi}")
    return n


def _fracao(v):
    x = float(str(v).replace(",", "."))
    x = x / 100 if x > 1 else x                # 75 = 75%
    if not 0 < x <= 1:
        raise ValueError("use uma porcentagem de 1 a 100")
    return round(x, 4)


def _real(v, lo, hi):
    if isinstance(v, bool) or v is None:
        raise ValueError(f"use um número de {lo:g} a {hi:g}")
    x = float(str(v).replace(",", "."))
    if not lo <= x <= hi:
        raise ValueError(f"use um número de {lo:g} a {hi:g}")
    return round(x, 4)


def _valor(v, regra):
    """Valor de um campo de bloco pela regra: bool, "fracao", (lo, hi) inteiro, ("real", lo, hi) ou opções (texto)."""
    if regra is bool:
        return _bool(v)
    if regra == "fracao":
        return _fracao(v)
    if regra == "data":
        from datetime import datetime
        t = str(v or "").strip()[:10]
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(t, fmt).date().isoformat()
            except ValueError:
                continue
        raise ValueError("use uma data AAAA-MM-DD")
    if regra[0] == "real":
        return _real(v, regra[1], regra[2])
    if isinstance(regra[0], str):
        t = str(v).strip().lower()
        if t not in regra:
            raise ValueError("use " + " ou ".join(regra))
        return t
    return _inteiro(v, *regra)


def _hora(s) -> str:
    s = str(s or "").strip()
    if len(s) == 4 and s[1] == ":":
        s = "0" + s
    if len(s) != 5 or s[2] != ":" or not (s[:2] + s[3:]).isdigit() or int(s[:2]) > 23 or int(s[3:]) > 59:
        raise ValueError(f"hora inválida '{s}' (use HH:MM)")
    return s


def _faixa(v):
    """[de, até] -> (de, até); None/false/"não" = sem janela nesse dia."""
    if v in (None, False, "", "nao", "não", "sem"):
        return None
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        raise ValueError("faixa precisa ser [de, até]")
    de, ate = _hora(v[0]), _hora(v[1])
    if de >= ate:
        raise ValueError(f"'de' ({de}) precisa ser antes de 'até' ({ate})")
    return (de, ate)


def _tabela(t, onde: str):
    """Tabela de horários por UF/DDD -> (tabela normalizada, avisos). Entrada ruim fica de fora."""
    if t in (None, {}):
        return None, []
    if not isinstance(t, dict):
        return None, [f"{onde}: a tabela precisa ser um objeto (vale a prévia)"]
    av = []
    hora = str(t.get("hora") or "local").lower()
    if hora not in ("local", "brasilia"):
        av.append(f"{onde}: hora '{hora}' desconhecida (use local ou brasilia; vale local)")
        hora = "local"
    saida = {"hora": hora, "ufs": {}, "ddds": {}}
    for chave in ("ufs", "ddds"):
        bloco = t.get(chave) or {}
        if not isinstance(bloco, dict):
            av.append(f"{onde}/{chave}: precisa ser um objeto (ignorado)")
            continue
        for k, e in bloco.items():
            if str(k).startswith("_"):
                continue
            k2 = str(k).strip().upper() if chave == "ufs" else str(k).strip()
            if (chave == "ufs" and k2 not in UFS) or (chave == "ddds" and k2 not in DDD_UF):
                av.append(f"{onde}/{chave}: '{k}' desconhecido (ignorado)")
                continue
            try:
                if not isinstance(e, dict) or "seg_sex" not in e:
                    raise ValueError("precisa de seg_sex")
                saida[chave][k2] = {"seg_sex": _faixa(e["seg_sex"]), "sabado": _faixa(e.get("sabado"))}
            except ValueError as ex:
                av.append(f"{onde}/{chave}/{k}: {ex} (ignorado)")
    return saida, av


def normalizar(bruto, base: dict | None = None, onde: str = "discagem") -> tuple[dict, list[str]]:
    """Bloco `discagem` -> (config completa, avisos). O que não der para entender fica com o valor de
    `base` (padrão PADRAO). Aceita o nome antigo spins_discador_dia e descanso_recusa_dias."""
    cfg = copy.deepcopy(base if base is not None else PADRAO)
    if bruto in (None, {}):
        return cfg, []
    if not isinstance(bruto, dict):
        return cfg, [f"{onde}: precisa ser um objeto (vale o padrão)"]
    av = []
    for k, v in bruto.items():
        if str(k).startswith("_"):
            continue
        if k == "spins_discador_dia":
            k = "tentativas_cliente_dia"
        if k == "descanso_recusa_dias":
            k, v = "descanso_recusa", ({"ativo": False} if v in (0, "0", None, False) else {"ativo": True, "dias": v})
        if k not in PADRAO:
            av.append(f"{onde}: '{k}' não existe (ignorado)")
            continue
        try:
            if k in _INTEIROS:
                cfg[k] = None if (k == "tentativas_cliente_dia" and v in (None, "")) else _inteiro(v, *_INTEIROS[k])
            elif k == "horarios":
                if isinstance(v, bool) or not isinstance(v, dict):
                    v = {"ativo": v}
                if "ativo" in v:
                    cfg[k]["ativo"] = _bool(v["ativo"])
                if "tabela" in v:
                    cfg[k]["tabela"], a = _tabela(v["tabela"], f"{onde}/horarios/tabela")
                    av += a
            else:
                if not isinstance(v, dict):
                    v = {"ativo": v}
                for kk, vv in v.items():
                    if str(kk).startswith("_"):
                        continue
                    regra = _SUB[k].get(kk)
                    if regra is None:
                        av.append(f"{onde}/{k}: '{kk}' não existe (ignorado)")
                        continue
                    try:
                        cfg[k][kk] = _valor(vv, regra)
                    except (TypeError, ValueError) as ex:
                        av.append(f"{onde}/{k}/{kk}: {ex} (vale {cfg[k][kk]!r})")
        except (TypeError, ValueError) as ex:
            av.append(f"{onde}/{k}: {ex} (vale o padrão)")
    return cfg, av


def config(dados: dict) -> dict:
    """Config que vale para a régua (playbook + estratégia): bloco `discagem` com a trava da estratégia
    (dados["discagem_trava"]) por cima. tentativas_cliente_dia nunca fica vazio (spins_discador_dia)."""
    cfg = dados.get("discagem") or PADRAO
    trava = dados.get("discagem_trava") or {}
    tc = trava.get("tentativas_cliente_dia") or cfg.get("tentativas_cliente_dia") or dados.get("spins_discador_dia") or 3
    if not trava and cfg.get("tentativas_cliente_dia") == tc:
        return cfg
    return {**cfg, **trava, "tentativas_cliente_dia": tc}


def config_de(regua) -> dict:
    """config() com cache na própria régua (uma por estratégia)."""
    c = regua._cache.get("__discagem")
    if c is None:
        c = regua._cache["__discagem"] = config(regua.dados)
    return c


def _horarios_ativo(dados: dict) -> bool:
    return (dados.get("discagem") or PADRAO)["horarios"]["ativo"]


def tentativas_cliente(dados: dict) -> int:
    """Tentativas por cliente no dia no discador (= spins_discador_dia, salvo trava/credor)."""
    trava = dados.get("discagem_trava") or {}
    cfg = dados.get("discagem") or {}
    return trava.get("tentativas_cliente_dia") or cfg.get("tentativas_cliente_dia") or dados["spins_discador_dia"]


# ------------------------------------------------------------------ horários por UF/DDD
@lru_cache(maxsize=4)
def _previa(caminho: str):
    t, av = _tabela(json.loads(Path(caminho).read_text(encoding="utf-8")), "horarios_uf.json")
    if av:
        raise ValueError("; ".join(av))
    return t


def carregar_previa(caminho=PREVIA) -> dict:
    """Prévia de horários (regras/horarios_uf.json), em hora local."""
    return _previa(str(caminho))


def _min(h: str) -> int:
    return int(h[:2]) * 60 + int(h[3:])


def _hhmm(m: int) -> str:
    m = max(0, min(m, 23 * 60 + 59))
    return f"{m // 60:02d}:{m % 60:02d}"


class Horarios:
    """Janela de cada DDD em horário de Brasília. Ordem: DDD do cliente > UF do cliente > DDD da prévia >
    UF da prévia. DDD sem regra: só a janela da estratégia e a faixa global."""

    def __init__(self, tabela: dict | None, feriados=(), previa: dict | None = None):
        previa = carregar_previa() if previa is None else previa
        self.regras = {}
        for ddd, uf in DDD_UF.items():
            for origem, tab in (("sua tabela", tabela or {}), ("prévia MotorCX", previa or {})):
                e = (tab.get("ddds") or {}).get(ddd) or (tab.get("ufs") or {}).get(uf)
                if e is None:
                    continue
                desloc = -FUSO.get(uf, 0) * 60 if tab.get("hora", "local") == "local" else 0
                conv = lambda f: None if f is None else (_hhmm(_min(f[0]) + desloc), _hhmm(_min(f[1]) + desloc))  # noqa: E731
                self.regras[ddd] = (uf, conv(e["seg_sex"]), conv(e["sabado"]), origem)
                break
        self.feriados = frozenset(feriados or ())
        self._cache = {}

    def janela(self, dia: date, contato: str, base) -> tuple[str, str] | None:
        """Janela de hoje para o número (Brasília) dentro de `base` (janela da estratégia/canal), ou None."""
        if base is None:
            return None
        k = (dia, contato[:2], base[0], base[1])
        r = self._cache.get(k, 0)
        if r != 0:
            return r
        r = None
        if dia.weekday() != 6 and dia.isoformat() not in self.feriados:
            de, ate = max(base[0], MIN_HORA), min(base[1], MAX_HORA)
            regra = self.regras.get(contato[:2])
            f = (regra[2] if dia.weekday() == 5 else regra[1]) if regra else (de, ate)
            if f is not None:
                de, ate = max(de, f[0]), min(ate, f[1])
                r = (de, ate) if de < ate else None
        self._cache[k] = r
        return r

    def motivo(self, dia: date, contato: str) -> str:
        """Por que o número não tem janela hoje (texto curto, sem o número)."""
        regra = self.regras.get(contato[:2])
        if dia.weekday() == 6 or dia.isoformat() in self.feriados:
            return "domingo ou feriado nacional"
        if regra is None:
            return "fora da faixa 08:00–20:00"
        uf, ss, sab, origem = regra
        f = sab if dia.weekday() == 5 else ss
        if f is None:
            return f"{uf}: não liga no sábado ({origem})"
        return f"{uf}: fora do horário {f[0]}–{f[1]} de Brasília ({origem})"


def horarios_de(regua) -> Horarios:
    """Horários da régua (cache na própria régua)."""
    h = regua._cache.get("__horarios")
    if h is None:
        tabela = (regua.dados.get("discagem") or PADRAO)["horarios"].get("tabela")
        h = regua._cache["__horarios"] = Horarios(tabela, regua["janela"]["feriados"])
    return h


def _intersecao(a, b):
    if a is None or b is None:
        return None
    de, ate = max(a[0], b[0]), min(a[1], b[1])
    return (de, ate) if de < ate else None


def janela_base(regua, dia: date, canal: str):
    """Janela da estratégia no dia ∩ janela do canal na empresa (Brasília)."""
    j = regua.janela(dia)
    cfg = regua.canal_cfg(canal)
    if j is not None and cfg.get("janela_inicio") and cfg.get("janela_fim"):
        j = (max(j[0], cfg["janela_inicio"]), min(j[1], cfg["janela_fim"]))
    return j


def janela_do_numero(regua, dia: date, contato: str, canal: str = "discador"):
    """Janela do número no dia em horário de Brasília: estratégia ∩ canal ∩ UF do DDD (tabela do cliente
    ou prévia) ∩ faixa global; None = não liga hoje. Horários desligados: a janela da estratégia/canal."""
    base = janela_base(regua, dia, canal)
    if not _horarios_ativo(regua.dados):
        return base
    return horarios_de(regua).janela(dia, contato, base)


class Discagem:
    """O que a fila de hoje usa (fila.candidatos): janela por número na voz e clientes com a voz suspensa
    (recusa, promessa, "não ligar" sem número identificado). Erro aqui não segura a lista: `erro` fica
    preenchido, a fila segue sem a regra e rodar_dia alerta "DISCAGEM"."""

    def __init__(self, hoje: date, sem_voz: dict | None = None):
        self.hoje = hoje
        self.sem_voz = sem_voz or {}          # id_cliente -> motivo
        self.erro = None
        self.fora_uf = defaultdict(set)       # UF -> números fora do horário hoje
        self.fora_de = defaultdict(set)       # id_cliente -> motivos (sem número)

    def filtrar(self, regua, idc: str, canal: str, cands: list) -> list:
        if idc in self.sem_voz:
            return []
        if not cands or not _horarios_ativo(regua.dados):
            return cands
        base = janela_base(regua, self.hoje, canal)
        if base is None:                      # sem janela hoje para ninguém: a fila já trata
            return cands
        hor = horarios_de(regua)
        ok = []
        for c in cands:
            if hor.janela(self.hoje, c.contato, base) is None:
                self.fora_uf[DDD_UF.get(c.contato[:2], "?")].add(c.contato)
                self.fora_de[idc].add(hor.motivo(self.hoje, c.contato))
            else:
                ok.append(c)
        return ok

    def motivo_voz(self, idc: str) -> str | None:
        if idc in self.sem_voz:
            return self.sem_voz[idc]
        if idc in self.fora_de:
            return "números fora do horário da UF/DDD hoje (" + "; ".join(sorted(self.fora_de[idc])[:2]) + ")"
        return None

    def resumo_horarios(self) -> dict:
        return {uf: len(cs) for uf, cs in sorted(self.fora_uf.items(), key=lambda x: -len(x[1]))}


# ------------------------------------------------------------------ renitência
# marca do retorno de canal de cada desfecho de voz (tabela única em motor/voz.py); sem marca = fora da renitência
MARCA_VOZ = V.MARCA_VOZ


def _voz(eventos, hoje):
    return [e for e in eventos if e.canal in CANAIS_VOZ and e.data <= hoje
            and not (e.fornecedor or "").startswith("canal:")]


def ajustar_eventos(eventos: list, cfg: dict) -> tuple[list, Counter]:
    """Regras desligadas pelo cliente: inexistente da voz vira falha de rede (não penaliza); "não ligar"
    da voz vira atendida sem CPC. Devolve (eventos, contagem do que mudou)."""
    from dataclasses import replace
    troca = {}
    if not cfg["inexistente"]["ativo"]:
        troca["numero_inexistente"] = "falha_rede"
    if not cfg["nao_ligar"]["ativo"]:
        troca["opt_out"] = "atendida_sem_cpc"
    if not troca:
        return eventos, Counter()
    n = Counter()
    saida = []
    for e in eventos:
        if e.canal in CANAIS_VOZ and e.resultado in troca:
            n[e.resultado] += 1
            e = replace(e, resultado=troca[e.resultado])
        saida.append(e)
    return saida, n


def renitencia(eventos: list, hoje: date, cfg: dict) -> tuple[dict, list, Counter]:
    """(sem_voz {id_cliente: motivo}, registros de voz para o retorno de canal, resumo).

    - recusa: a voz do cliente descansa `dias` a partir do dia da recusa;
    - promessa: voz suspensa até a data prometida + 1 (o pagamento entra com a baixa D+1); sem data,
      `dias_sem_data` dias;
    - "não ligar" sem número identificado (ocorrência com vários números): toda a voz do cliente;
      com o número, a certificação já tira o número de todos os canais de voz;
    - registros (motor.retorno_canal.Registro, canal voz): "não atende"/ocupado/caixa postal = temporário,
      atendeu = positivo, inexistente = escada. Só com o descanso ligado (sem ele, nada muda: o inexistente
      confirmado já invalida o número na certificação, como antes)."""
    from .retorno_canal import Registro
    rec, pro, nl = cfg["descanso_recusa"], cfg["promessa_suspende"], cfg["nao_ligar"]
    descanso, inex = cfg["descanso_nao_atende"]["ativo"], cfg["inexistente"]["ativo"]
    voz = _voz(eventos, hoje)
    ate_de, regs, resumo = {}, [], Counter()
    for e in voz:
        ate = texto = None
        if e.resultado == "recusa" and rec["ativo"]:
            ate = e.data + timedelta(days=rec["dias"])
            texto = f"recusou negociar em {e.data:%d/%m}: voz descansa até {ate - timedelta(days=1):%d/%m}"
        elif e.resultado == "promessa" and pro["ativo"]:
            dp = getattr(e, "data_promessa", None)
            ate = (dp + timedelta(days=2)) if dp else e.data + timedelta(days=pro["dias_sem_data"])
            texto = (f"promessa de pagamento para {dp:%d/%m}: voz suspensa até {dp + timedelta(days=1):%d/%m}" if dp
                     else f"promessa de pagamento em {e.data:%d/%m}: voz suspensa até "
                          f"{ate - timedelta(days=1):%d/%m}")
        elif e.resultado == "opt_out" and nl["ativo"] and not e.contato:
            ate, texto = date.max, "pediu para não ligar"
        if ate is not None and hoje < ate and (e.id_cliente not in ate_de or ate > ate_de[e.id_cliente][0]):
            ate_de[e.id_cliente] = (ate, texto)
        marca = MARCA_VOZ.get(e.resultado)
        if e.contato and marca and descanso and (marca != "inexistente" or inex):
            regs.append(Registro(e.contato, "voz", marca, e.data, ORIGEM + (e.origem or e.fornecedor or "")))
    sem_voz = {k: t for k, (_, t) in ate_de.items()}
    for t in sem_voz.values():
        resumo["recusa" if t.startswith("recusou") else "promessa" if t.startswith("promessa") else "nao_ligar"] += 1
    return sem_voz, regs, resumo


# ------------------------------------------------------------------ proteção do número inexistente
CONFIRMA = "numero_inexistente"
INEXISTENTE_VOZ = "inexistente_voz"           # só a voz (taxonomia: SEM_RETORNO; motor/voz.py)
LOTE_TRAVADO = "falha_rede"                   # confirmação de lote travado: suspeita de rota, não diz nada do número
RESTR_QUARENTENA = tuple(f"{c}:suspenso" for c in CANAIS_VOZ)
RESTR_ENCERRADA = tuple(f"{c}:inexistente" for c in CANAIS_VOZ)


class Protecao:
    """Resultado da proteção do inexistente: restrições de voz por (cliente, número), sinais para o Chega dos
    canais de mensagem, resumo (só contagens) e alertas."""

    def __init__(self):
        self.restricoes: dict[tuple[str, str], set] = {}
        self.sinais: list[tuple[str, date]] = []
        self.resumo: dict = {}
        self.alertas: list[str] = []
        self.cfg: dict | None = None     # modo so_voz: a config, para recalcular o ciclo num dia passado


def _mediana(xs: list[float]) -> float:
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _dispara(n: int, k: int, med, ic: dict, minimo: int) -> bool:
    if n < minimo or not k:
        return False
    f = k / n
    if f > ic["trava_lote_fracao"]:
        return True
    return med is not None and f > ic["trava_lote_relativa"] * med and f >= med + ic["trava_lote_pp_min"]


def trava_lote(eventos: list, cfg: dict) -> tuple[set, list[dict]]:
    """Trava de lote: arquivo × dia (e rota, se houver) com muitas confirmações de inexistente é suspeita de falha
    da operadora/rota. Só avalia lote com ≥ trava_lote_minimo chamadas de voz (rota: trava_rota_minimo). Dispara
    se a taxa passar de trava_lote_fracao, ou de trava_lote_relativa × a mediana dos últimos 14 dias do mesmo
    fornecedor/layout e ao menos trava_lote_pp_min acima dela. Devolve (chaves travadas, informações)."""
    ic = cfg["inexistente"]
    if not ic["trava_lote_ativo"]:
        return set(), []
    lote = defaultdict(lambda: [0, 0])            # (fornecedor, arquivo, dia) -> [chamadas, confirmações]
    rota = defaultdict(lambda: [0, 0])            # (fornecedor, arquivo, dia, rota) -> idem
    por_dia = defaultdict(lambda: [0, 0])         # (fornecedor, dia) -> idem
    for e in eventos:
        if e.canal not in CANAIS_VOZ or (e.fornecedor or "").startswith("canal:"):
            continue
        k = (e.fornecedor or "", e.origem or "", e.data)
        c = e.resultado == CONFIRMA
        for chave, agg in ((k, lote), ((k[0], e.data), por_dia)):
            agg[chave][0] += 1
            agg[chave][1] += c
        r = getattr(e, "rota", None)
        if r:
            rota[k + (r,)][0] += 1
            rota[k + (r,)][1] += c
    hist = defaultdict(dict)
    for (forn, d), (n, k) in por_dia.items():
        if n >= ic["trava_lote_minimo"]:
            hist[forn][d] = k / n

    def med(forn, d):
        xs = [f for dd, f in hist[forn].items() if 1 <= (d - dd).days <= 14]
        return _mediana(xs) if xs else None

    travados, info = set(), []
    for k, (n, c) in lote.items():
        m = med(k[0], k[2])
        if _dispara(n, c, m, ic, ic["trava_lote_minimo"]):
            travados.add(k)
            info.append({"arquivo": k[1] or k[0], "data": k[2].isoformat(), "chamadas": n, "inexistentes": c,
                         "fracao": round(c / n, 4), "mediana_14d": None if m is None else round(m, 4), "rota": None})
    for kr, (n, c) in rota.items():
        k = kr[:3]
        if k in travados:
            continue
        m = med(k[0], k[2])
        if _dispara(n, c, m, ic, ic["trava_rota_minimo"]):
            travados.add(kr)
            info.append({"arquivo": k[1] or k[0], "data": k[2].isoformat(), "chamadas": n, "inexistentes": c,
                         "fracao": round(c / n, 4), "mediana_14d": None if m is None else round(m, 4), "rota": kr[3]})
    return travados, info


def protecao_inexistente(eventos: list, hoje: date, cfg: dict) -> tuple[list, Protecao]:
    """Número inexistente da voz (decisão do dono, 31/10/2026). Com `inexistente.ativo`:

    1. trava de lote (os dois modos): confirmações de um lote suspeito viram falha de rede (não contam) + alerta;
    2. modo "so_voz" (padrão): o inexistente NÃO invalida o número na certificação (vira inexistente_voz, sem
       nível de inválido) e vale só para a voz, por (cliente, número):
       - 1ª confirmação: voz em quarentena (`<voz>:suspenso`) por reteste_dias;
       - 2ª confirmação em OUTRO dia (confirmacoes): voz encerrada no número para este cliente (`<voz>:inexistente`);
       - prova de que o número existe (caixa postal, ocupado, qualquer atendida…) zera tudo;
       - reteste sem conclusão (não atende, falha…) depois da quarentena: nova quarentena, até max_retestes;
         esgotado, a voz fica suspensa sem encerrar e o motor alerta;
       - sinal para SMS/RCS/WhatsApp (sinal_outros_canais): cada dia de confirmação vale meia falha de envio no
         Chega do número nesses canais (nunca restringe; entrega/clique depois devolve a confiança).
    Modo "invalida": a regra antiga (o inexistente invalida o número em todos os canais), só com a trava de lote.
    Só vale para retornos a partir de `so_voz_desde`: os de antes seguem a regra antiga (número inválido continua
    inválido; resumo["anteriores_regra_antiga"] conta quantos). Nunca muda a contagem de tentativas da régua.
    Recalculado do histórico a cada rodada (idempotente)."""
    from dataclasses import replace
    p = Protecao()
    ic = cfg["inexistente"]
    if not ic["ativo"]:
        return eventos, p
    desde = date.fromisoformat(ic["so_voz_desde"])
    travados, info = trava_lote([e for e in eventos if e.data >= desde], cfg)
    so_voz = ic["modo"] == "so_voz"
    saida, n_travadas, antigos = [], 0, set()
    for e in eventos:
        if e.canal in CANAIS_VOZ and e.resultado == CONFIRMA and e.data < desde \
                and not (e.fornecedor or "").startswith("canal:"):
            antigos.add((e.id_cliente, e.contato))           # antes da vigência: fica como estava (regra antiga)
        elif e.canal in CANAIS_VOZ and e.resultado == CONFIRMA and not (e.fornecedor or "").startswith("canal:"):
            k = (e.fornecedor or "", e.origem or "", e.data)
            r = getattr(e, "rota", None)
            if k in travados or (r and k + (r,) in travados):
                e = replace(e, resultado=LOTE_TRAVADO)
                n_travadas += 1
            elif so_voz:
                e = replace(e, resultado=INEXISTENTE_VOZ)
        saida.append(e)
    resumo = {"modo": ic["modo"], "desde": ic["so_voz_desde"], "lotes_travados": info,
              "confirmacoes_travadas": n_travadas, "anteriores_regra_antiga": len({k for k in antigos if k[1]})}
    for i in info:
        med = "" if i["mediana_14d"] is None else f", mediana de 14 dias {_pct(i['mediana_14d'])}"
        onde = f"arquivo {i['arquivo']}" + (f", rota {i['rota']}" if i["rota"] else "")
        p.alertas.append(f"DISCAGEM: suspeita de falha da operadora: {_pct(i['fracao'])} de número inexistente em "
                         f"{_n(i['chamadas'])} chamadas ({onde}, {date.fromisoformat(i['data']):%d/%m}{med}). "
                         "Esses números NÃO foram invalidados (contam como falha técnica); confira a rota com o "
                         "discador.")
    if not so_voz:
        p.resumo = resumo
        return saida, p
    p.cfg = cfg
    p.restricoes, cont, sinais = ciclo_inexistente(saida, hoje, cfg)
    if ic["sinal_outros_canais"]:
        p.sinais = sorted(sinais)
    resumo.update({"quarentena": cont["quarentena"], "em_reteste": cont["em_reteste"],
                   "encerrados": cont["encerrados"], "sem_confirmacao": cont["sem_confirmacao"],
                   "sinal_outros_canais": len({c for c, _ in p.sinais})})
    if cont["sem_confirmacao"]:
        p.alertas.append(f"DISCAGEM: {cont['sem_confirmacao']} número(s) com inexistente sem confirmação depois de "
                         f"{ic['max_retestes']} reteste(s): a voz segue suspensa, sem encerrar. Confira com o "
                         "discador (falha de rota ou aparelho desligado).")
    p.resumo = resumo
    return saida, p


def ciclo_inexistente(eventos: list, hoje: date, cfg: dict) -> tuple[dict, Counter, set]:
    """Ciclo de vida do inexistente da voz por (cliente, número), com os eventos JÁ ajustados por
    protecao_inexistente (inexistente_voz) e o histórico até `hoje`: (restrições, contagens, sinais (número, dia)).
    Separado para a rotina recalcular o estado de um dia passado (rodar_dia reprocessa os dias em aberto)."""
    ic = cfg["inexistente"]
    restricoes: dict[tuple[str, str], set] = {}
    por = defaultdict(lambda: defaultdict(set))       # (cliente, número) -> dia -> {confirma, prova, outro}
    for e in eventos:
        if e.canal not in CANAIS_VOZ or not e.contato or e.data > hoje or (e.fornecedor or "").startswith("canal:"):
            continue
        d = V.POR_CHAVE.get(e.resultado)
        tipo = "confirma" if e.resultado == INEXISTENTE_VOZ else "prova" if d is not None and d.prova_existencia \
            else "outro"
        por[(e.id_cliente, e.contato)][e.data].add(tipo)
    passo = timedelta(days=ic["reteste_dias"])
    cont = Counter()
    sinais = set()
    for k, dias in por.items():
        conf, ult, ate, retestes, fim = 0, None, None, 0, None     # fim: "encerrada" | "esgotado"
        for d in sorted(dias):
            t = dias[d]
            if "prova" in t:
                conf, ult, ate, retestes, fim = 0, None, None, 0, None
            elif "confirma" in t:
                sinais.add((k[1], d))
                if fim == "encerrada":
                    continue
                if conf == 0 or d != ult:
                    conf += 1
                    ult = d
                    ate = d + passo
                if conf >= ic["confirmacoes"]:
                    fim = "encerrada"
            elif conf and fim is None and ate is not None and d >= ate:
                retestes += 1
                if retestes >= ic["max_retestes"]:
                    fim = "esgotado"
                else:
                    ate = d + passo
        if fim == "encerrada":
            restricoes[k] = set(RESTR_ENCERRADA)
            cont["encerrados"] += 1
        elif fim == "esgotado":
            restricoes[k] = set(RESTR_QUARENTENA)
            cont["sem_confirmacao"] += 1
        elif conf and ate is not None and hoje < ate:
            restricoes[k] = set(RESTR_QUARENTENA)
            cont["quarentena"] += 1
        elif conf:
            cont["em_reteste"] += 1
    return restricoes, cont, sinais


def aplicar_restricoes_voz(certs: dict, restricoes: dict) -> dict:
    """Junta as restrições da proteção do inexistente às certificações ({(id, contato): Certificacao})."""
    for k, rs in (restricoes or {}).items():
        c = certs.get(k)
        if c is not None:
            c.restricoes = set(c.restricoes) | rs
    return certs


def regras_voz(regras_canal: dict, cfg: dict) -> dict:
    """Descanso por "não atende" ligado: vira a pausa da voz no retorno de canal (n seguidos em em_dias →
    descansa_dias só na voz, no número)."""
    d = cfg["descanso_nao_atende"]
    if not d["ativo"]:
        return regras_canal
    return {**regras_canal, "voz": {**regras_canal["voz"], "temporarios_pausa": d["n"],
                                    "dias_pausa": d["descansa_dias"], "temporarios_janela_dias": d["em_dias"]}}


# ------------------------------------------------------------------ chamadas curtas
NAO_COMPLETADA = V.NAO_COMPLETADA          # chamada curta sempre (motor/voz.py)
PRIOR_CURTA = 0.9      # cobrança típica: 10% de atendimento humano acima de 6 s = 90% de curtas (plano C.2)
FORCA_CARTEIRA = 20.0  # peso do prior na taxa da carteira (em chamadas)
FORCA_NUMERO = 5.0     # peso da taxa da carteira na taxa do número (em chamadas)
DIAS_HISTORICO = 30


def e_curta(e, cc: dict) -> bool:
    """Chamada curta: até `segundos`, caixa postal ou não completada; abandono conta se configurado."""
    d = getattr(e, "duracao_s", None)
    if d is not None and d <= cc["segundos"]:
        return True
    if e.resultado in NAO_COMPLETADA:
        return True
    return e.resultado in V.CURTA_SE_ABANDONO and cc["abandono_conta"]


def medir(eventos: list, hoje: date, cfg: dict, dias: int = 7) -> list[dict]:
    """KPI medido: chamadas de voz e curtas por dia (total da carteira), dos últimos `dias` antes de hoje."""
    cc = cfg["chamadas_curtas"]
    por = defaultdict(lambda: [0, 0])
    for e in _voz(eventos, hoje - timedelta(days=1)):
        if (hoje - e.data).days <= dias:
            p = por[e.data]
            p[0] += 1
            p[1] += e_curta(e, cc)
    return [{"data": d.isoformat(), "chamadas": n, "curtas": k, "fracao": round(k / n, 4)}
            for d, (n, k) in sorted(por.items())]


class ModeloCurtas:
    """P(curta) por número: taxa do número encolhida para a da carteira (que encolhe para PRIOR_CURTA)."""

    def __init__(self, eventos: list, hoje: date, cfg: dict):
        cc, d = cfg["chamadas_curtas"], cfg["descanso_nao_atende"]
        self.obs, self.nao_atende = defaultdict(lambda: [0, 0]), Counter()
        k = n = 0
        for e in _voz(eventos, hoje - timedelta(days=1)):
            if (hoje - e.data).days > DIAS_HISTORICO:
                continue
            c = e_curta(e, cc)
            n += 1
            k += c
            if e.contato:
                o = self.obs[e.contato]
                o[0] += c
                o[1] += 1
                if e.resultado in V.NAO_ATENDE and (hoje - e.data).days <= d["em_dias"]:
                    self.nao_atende[e.contato] += 1
        self.chamadas = n
        self.p0 = (k + PRIOR_CURTA * FORCA_CARTEIRA) / (n + FORCA_CARTEIRA)

    def p(self, contato: str) -> float:
        o = self.obs.get(contato)
        return self.p0 if o is None else (o[0] + FORCA_NUMERO * self.p0) / (o[1] + FORCA_NUMERO)


def previsao(fila: list, modelo: ModeloCurtas, tentativas) -> tuple[dict, dict]:
    """Previsão (teto) do dia: por cliente × canal de voz, cada número recebe até tentativas_numero_dia,
    até somar tentativas_cliente_dia. tentativas(linha) -> (por número, por cliente).
    Devolve (total {chamadas, curtas, fracao}, por cliente {id: [chamadas, curtas, prioridade, data_fixa]})."""
    grupos = defaultdict(list)
    for l in fila:
        if l["canal"] in CANAIS_VOZ:
            grupos[(l["id_cliente"], l["canal"], bool(l["condicao"]))].append(l)
    por = {}
    for (idc, _, _), ls in grupos.items():
        tn, tc = tentativas(ls[0])
        resta = tc
        p = por.setdefault(idc, [0, 0.0, ls[0]["prioridade"], bool(ls[0].get("data_fixa"))])
        for l in sorted(ls, key=lambda l: int(l.get("ordem_contato") or 1)):
            t = min(tn, resta)
            if t <= 0:
                break
            resta -= t
            p[0] += t
            p[1] += t * modelo.p(l["contato"])
    T = sum(v[0] for v in por.values())
    S = sum(v[1] for v in por.values())
    return {"chamadas": T, "curtas": round(S, 1), "fracao": round(S / T, 4) if T else 0.0}, por


def cortar(por: dict, total: dict, cc: dict) -> tuple[list, dict]:
    """Quem sai da voz pelo corte: pelo fim da prioridade (estado de menor prioridade, depois quem mais
    dá curta), até a previsão ficar abaixo do corte ou o total abaixo de max_total_dia. Preventivo e quebra
    (data fixa) ficam. Devolve (ids cortados, total depois)."""
    T, S = total["chamadas"], total["curtas"]
    if not T or T <= cc["max_total_dia"] or S / T < cc["corte"]:
        return [], total
    ordem = sorted((i for i, v in por.items() if not v[3] and v[0]),
                   key=lambda i: (-por[i][2], -(por[i][1] / por[i][0]), _neg(i)))
    fora = []
    for i in ordem:
        if T <= cc["max_total_dia"] or (T and S / T < cc["corte"]):
            break
        T -= por[i][0]
        S -= por[i][1]
        fora.append(i)
    return fora, {"chamadas": T, "curtas": round(S, 1), "fracao": round(S / T, 4) if T else 0.0}


def _neg(s: str) -> tuple:
    """Chave para ordenar texto do maior para o menor (fim da fila primeiro)."""
    return tuple(-ord(ch) for ch in s)


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def _n(x) -> str:
    return f"{int(round(x)):,}".replace(",", ".")


def curtas(fila: list, eventos: list, hoje: date, cfg: dict, tentativas) -> tuple[list, dict, list[str]]:
    """Chamadas curtas do dia: (fila depois do corte opcional, resumo, alertas).
    resumo: medido (últimos 7 dias), previsao, previsao_depois, cortados {id: motivo}, linhas_minimas."""
    cc = cfg["chamadas_curtas"]
    medido = medir(eventos, hoje, cfg)
    resumo = {"medido": medido, "previsao": None, "cortados": {}, "corte_ativo": cc["corte_ativo"]}
    if not cc["ativo"]:
        return fila, resumo, []
    modelo = ModeloCurtas(eventos, hoje, cfg)
    total, por = previsao(fila, modelo, tentativas)
    resumo["previsao"] = total
    resumo["linhas_minimas"] = math.ceil(total["chamadas"] / cc["max_por_numero_dia"]) if total["chamadas"] else 0
    fora, depois = cortar(por, total, cc)
    alertas = []
    if cc["corte_ativo"] and fora:
        tirar = set(fora)
        fila = [l for l in fila if not (l["canal"] in CANAIS_VOZ and l["id_cliente"] in tirar)]
        resumo["cortados"] = {i: "corte de chamadas curtas (fim da prioridade)" for i in fora}
        resumo["previsao_depois"] = depois
    ultimo = medido[-1] if medido else None
    acima_prev = total["chamadas"] >= cc["max_por_numero_dia"] and total["fracao"] >= cc["aviso"]
    acima_med = ultimo is not None and ultimo["chamadas"] >= cc["max_por_numero_dia"] and ultimo["fracao"] >= cc["aviso"]
    if acima_prev or acima_med:
        partes = [f"previsão de hoje {_pct(total['fracao'])} de curtas em {_n(total['chamadas'])} chamadas de voz"
                  if total["chamadas"] else "sem voz na lista de hoje"]
        if ultimo:
            partes.append(f"medido em {date.fromisoformat(ultimo['data']):%d/%m}: {_pct(ultimo['fracao'])} de "
                          f"{_n(ultimo['chamadas'])}")
        txt = ("CHAMADAS CURTAS: " + "; ".join(partes) + f" (seu aviso: {_pct(cc['aviso'])}; MP 1.396: bloqueio "
               "das linhas com 85% ou mais e mais de 1.000 chamadas numa linha ou 10.000 no total no dia).")
        if total["chamadas"]:
            txt += (f" Com até {_n(cc['max_por_numero_dia'])} chamadas por linha, a lista de hoje precisa de pelo "
                    f"menos {resumo['linhas_minimas']} linha(s) de saída (o MotorCX não sabe por qual linha o "
                    "discador liga).")
        if resumo["cortados"]:
            txt += (f" Corte ligado: {len(fora)} clientes saíram da voz hoje pelo fim da prioridade (previsão "
                    f"{_pct(depois['fracao'])} em {_n(depois['chamadas'])} chamadas).")
        sug = []
        vozes = {l["contato"] for l in fila if l["canal"] in CANAIS_VOZ}
        d = cfg["descanso_nao_atende"]
        if not d["ativo"]:
            n = sum(1 for c in vozes if modelo.nao_atende.get(c, 0) >= d["n"])
            sug.append(f"ligar o descanso por não atende ({n} números com {d['n']}+ não atende em {d['em_dias']} dias)"
                       if n else "ligar o descanso por não atende")
        n = sum(1 for c in vozes if modelo.obs.get(c, (0, 0))[1] >= 5 and modelo.p(c) >= 0.95)
        if n:
            sug.append(f"segurar {n} números que quase só dão curta (caixa postal recorrente) ou mandar ao digital")
        if not cfg["inexistente"]["ativo"]:
            sug.append("religar o bloqueio de número inexistente")
        if not cc["corte_ativo"] and fora:
            sug.append(f"ligar o corte pelo fim da fila (tiraria {len(fora)} clientes da voz hoje; preventivo e "
                       "quebra ficam)")
        if sug:
            txt += " Sugestões (nenhuma liga sozinha): " + "; ".join(sug) + "."
        alertas.append(txt)
    return fila, resumo, alertas


# ------------------------------------------------------------------ mailing estendido
CAMPOS_MAILING = ("id_cliente", "telefone", "ordem", "reserva", "tentativas_max_numero", "tentativas_max_cliente",
                  "intervalo_min", "intervalo_ocupado", "janela_local", "uf", "prioridade", "regua", "passo",
                  "persona", "id_acao")


def linhas_mailing(fila: list, hoje: date, regua_de) -> tuple[list[tuple], int]:
    """Linhas do discador_mailing.csv (só o discador; um telefone por linha, na ordem de discagem).
    janela_local = janela do número em horário de Brasília (dentro da janela da linha). Nunca CPF/nome.
    regua_de(id_cliente) -> régua do cliente. Devolve (linhas, números sem janela que ficaram de fora)."""
    saida, sem = [], 0
    for l in fila:
        if l["canal"] != "discador":
            continue
        rc = regua_de(l["id_cliente"])
        cfg = config_de(rc)
        base = tuple(l["janela"].split("-", 1)) if l.get("janela") else None
        jan = horarios_de(rc).janela(hoje, l["contato"], base) if cfg["horarios"]["ativo"] else base
        if jan is None:
            sem += 1
            continue
        saida.append((l["id_cliente"], l["contato"], int(l.get("ordem_contato") or 1), int(bool(l["condicao"])),
                      cfg["tentativas_numero_dia"], cfg["tentativas_cliente_dia"], cfg["intervalo_min_minutos"],
                      cfg["intervalo_ocupado_minutos"], f"{jan[0]}-{jan[1]}", DDD_UF.get(l["contato"][:2], ""),
                      l["prioridade"], l.get("regua") or "", l.get("passo") or "", l.get("persona") or "",
                      l.get("id_acao") or ""))
    saida.sort(key=lambda r: (r[3], r[10], r[0], r[2]))
    return saida, sem
