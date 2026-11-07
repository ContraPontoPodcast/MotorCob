"""Recuperação por ação: do acionamento ao dinheiro, só em agregado (SQL 77).

O `acoes_dia` mostra o que o MotorCob mandou fazer e o CPC que voltou. Este módulo leva a mesma ação até o fim do
funil: contato → CPC → promessa → acordo → pagamento → valor recuperado, com o custo, para o especialista e o
cliente otimizarem "valor recuperado por real" e não só "CPC por real".

Chave de cada linha (nenhum ID, telefone, e-mail ou CPF sai daqui):
    data (dia da AÇÃO) × canal × regua (fase ou etapa de origem: localizacao, giro, cpc, preventivo, quebra,
    etapa-<id>) × cluster (segmento) × persona × volta × dia_ciclo
  volta / dia_ciclo  vêm do passo exportado: G2-dia3 → volta 2, dia 3 (giro do Não CPC); C2-D5 → volta 2, dia 5
                     (etapa com régua que repete); D+4 → dia 4; D-3 → dia -3; D0 → dia 0; CPC B · T2 → dia 2
                     (tentativa no canal). volta 0 = não se aplica; dia_ciclo None = sem dia (rotação, CPC A).

Ação = (dia, cliente, canal), a mesma do `acoes_dia` (3 números no discador = 1 ação; reserva só conta se teve
retorno). Retorno → ação: o retorno é da ação exportada mais recente do mesmo cliente e canal até
DIAS_BUSCA_ESCOLHA dias antes (a regra do `acoes_dia`).
  acoes        ações enviadas
  com_retorno  ações com algum retorno
  contatos     alguém interagiu (nível ENGAJADO ou CERTIFICADO da taxonomia: atendeu, respondeu, clicou…)
  cpcs         contato do playbook (regua.json › contato; o mesmo CPC do acoes_dia)
  promessas    promessa de pagamento (desfecho de voz "promessa" ou data prometida)
  optouts      pedido de descadastro/opt-out (restrição *:opt_out da taxonomia)
  custo        R$ dos retornos; ação sem retorno usa o custo do canal (como o acoes_dia)

REGRA DE ATRIBUIÇÃO DO ACORDO (documentada no SQL 77 e no CLAUDE.md):
  1. Data do acordo = o dia da rotina em que o motor viu o acordo pela 1ª vez nas parcelas (estado/acordos_vistos.csv,
     gravado uma vez por acordo; `registrar_acordos`). Os acordos que já estavam nas parcelas quando o controle
     começou (rotina antiga) ficam com a regra do relatório do comitê ("legado"): a entrada em acordo marcada pela
     trilha (PRE/COL/QBR/LIQ vindo de LOC/CPA/CPB/NCP, fora do dia de entrada; `kpis.nascimentos_de_acordo`), e sem
     essa entrada o 1º vencimento − 7 (nunca depois do dia da rotina) sem origem.
  2. Toque = ação enviada ao cliente ANTES da rotina que viu o acordo, nos JANELA_ATRIBUICAO dias anteriores:
     [data − 7, data − 1] (legado: [data − 7, data]; a lista do próprio dia sai depois de o acordo ser conhecido).
     Vence o último toque COM CPC; sem CPC no intervalo, o último toque; empate no mesmo dia: o canal que a trilha
     marcou na entrada em acordo, depois a ordem de rotação. Sem toque no intervalo (inclusive o acordo que já
     veio na carga, antes de qualquer ação) → regua "sem_acao", canal vazio, na data do acordo.
  3. O acordo inteiro (1 acordo, valor = soma das parcelas) e todo pagamento dele vão para a linha da ação
     vencedora. pagamentos = acordos com pelo menos uma parcela paga (1ª parcela ou quitação: promessa NÃO é
     pagamento); valor_pago = soma das parcelas pagas até hoje.
  4. Pagamento que chega depois atualiza a linha do dia da AÇÃO: a rotina recalcula tudo a partir dos arquivos de
     estado nos últimos DIAS_RECUPERACAO dias e regrava essa janela (idempotente: rodar de novo dá o mesmo número).
     Acordo cuja ação vencedora é anterior à janela fica com o último número publicado.
  Assim, somando todas as linhas (com "sem_acao"), acordos e valor pago batem com o total das parcelas.

Contato por posição do telefone (lacuna 4 do especialista): por dia × canal × posição do número na ação
(ordem_contato 1..5, 5 = 5 ou mais) × dias seguidos em que o MESMO número estava na lista do canal (1..5, 5 = 5 ou
mais; conta dias com lista, então domingo/feriado sem lista não quebra a sequência): tentativas, com_retorno,
contatos, cpcs, terceiros (terceiro desconhece) e curtas (voz não completada). Só retornos com o número.
"""
import re
from collections import defaultdict
from datetime import date, timedelta

from .acordos import Parcela
from .entrada import DIAS_BUSCA_ESCOLHA
from .kpis import LinhaDoTempo, nascimentos_de_acordo
from .taxonomia import TERCEIRO, Nivel, ResultadoDesconhecido, classificar
from .voz import NAO_COMPLETADA

JANELA_ATRIBUICAO = 7     # dias antes do acordo em que um toque ainda é a origem dele
DIAS_RECUPERACAO = 180    # janela regravada a cada rodada (pagamento de acordo parcelado chega depois)
SEM_ACAO = "sem_acao"
MAX_POSICAO = 5
MAX_SEGUIDOS = 5

METRICAS = ("acoes", "com_retorno", "contatos", "cpcs", "promessas", "optouts", "custo", "acordos",
            "valor_acordo", "pagamentos", "valor_pago")
METRICAS_POSICAO = ("tentativas", "com_retorno", "contatos", "cpcs", "terceiros", "curtas")
CHAVE = ("data", "canal", "regua", "cluster", "persona", "volta", "dia_ciclo")
CHAVE_POSICAO = ("data", "canal", "posicao", "dias_seguidos")

_PASSOS = (
    (re.compile(r"^G(\d+)-dia(-?\d+)$"), lambda m: (int(m[1]), int(m[2]))),
    (re.compile(r"^C(\d+)-D([+-]?\d+)$"), lambda m: (int(m[1]), int(m[2]))),
    (re.compile(r"^D\+(\d+)$"), lambda m: (0, int(m[1]))),
    (re.compile(r"^D(-?\d+)$"), lambda m: (0, int(m[1]))),
    (re.compile(r"T(\d+)$"), lambda m: (0, int(m[1]))),
)


def volta_dia(passo: str | None) -> tuple[int, int | None]:
    """Rótulo do passo exportado → (volta, dia do ciclo). (0, None) quando o passo não tem dia."""
    p = (passo or "").strip()
    for rx, f in _PASSOS:
        m = rx.search(p)
        if m:
            return f(m)
    return 0, None


def _nivel(canal, resultado):
    try:
        return classificar(canal, resultado)
    except ResultadoDesconhecido:
        return None


def _acordos(parcelas: dict[str, list[Parcela]], trilha: list[dict], regua, vistos: dict | None = None):
    """[(id_cliente, data do acordo, canal marcado na trilha ou None, nasceu de ação?, último dia de toque, parcelas)].
    vistos: {(id_cliente, id_acordo): (data, origem 'rotina'|'legado')} de registrar_acordos."""
    linha = LinhaDoTempo(trilha)
    nasc = defaultdict(list)
    for idc, d, _r, c in nascimentos_de_acordo(linha, regua):
        nasc[idc].append((d, c))
    saida = []
    for idc, ps in parcelas.items():
        por = defaultdict(list)
        for p in ps:
            por[p.id_acordo].append(p)
        for ida, pa in sorted(por.items()):
            inicio = min(p.vencimento for p in pa)
            cand = [n for n in nasc.get(idc, []) if n[0] <= inicio]
            ult = max(cand, key=lambda n: n[0]) if cand else None
            visto = (vistos or {}).get((idc, ida))
            if visto and visto[1] == "rotina":
                d = visto[0]
                saida.append((idc, d, ult[1] if ult else None, True, d - timedelta(days=1), pa))
            elif ult:
                saida.append((idc, ult[0], ult[1], True, ult[0], pa))
            else:
                d = inicio - timedelta(days=7)
                saida.append((idc, d, None, False, d, pa))
    return saida


def data_legado(parcelas_acordo: list[Parcela], idc: str, nasc: dict) -> date:
    """Data de um acordo que já existia quando o controle começou: a regra do relatório do comitê."""
    inicio = min(p.vencimento for p in parcelas_acordo)
    cand = [n for n in nasc.get(idc, []) if n[0] <= inicio]
    return max(cand, key=lambda n: n[0])[0] if cand else inicio - timedelta(days=7)


def registrar_acordos(pasta_estado, parcelas: dict[str, list[Parcela]], hoje: date, trilha: list[dict],
                      regua) -> dict:
    """estado/acordos_vistos.csv: o dia da rotina em que cada acordo apareceu pela 1ª vez (fica só no estado local,
    como as parcelas; nunca é publicado). Sem o arquivo (1ª rodada com o controle), o que já existe entra como
    'legado' com a data da regra do comitê. Grava com troca atômica; rodar de novo no mesmo dia não muda nada.
    Devolve {(id_cliente, id_acordo): (data, origem)}."""
    import csv
    from pathlib import Path
    arq = Path(pasta_estado) / "acordos_vistos.csv"
    vistos, novo = {}, not arq.exists()
    if not novo:
        with open(arq, newline="", encoding="utf-8") as f:
            for l in csv.DictReader(f, delimiter=";"):
                vistos[(l["id_cliente"], l["id_acordo"])] = (date.fromisoformat(l["primeira_vez"]), l["origem"])
    nasc = None
    mudou = novo
    for idc, ps in parcelas.items():
        por = defaultdict(list)
        for p in ps:
            por[p.id_acordo].append(p)
        for ida, pa in por.items():
            if (idc, ida) in vistos:
                continue
            if novo:
                if nasc is None:
                    nasc = defaultdict(list)
                    for i, d, _r, c in nascimentos_de_acordo(LinhaDoTempo(trilha), regua):
                        nasc[i].append((d, c))
                vistos[(idc, ida)] = (min(data_legado(pa, idc, nasc), hoje), "legado")
            else:
                vistos[(idc, ida)] = (hoje, "rotina")
            mudou = True
    if mudou:
        arq.parent.mkdir(parents=True, exist_ok=True)
        tmp = arq.with_suffix(".tmp")
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(["id_cliente", "id_acordo", "primeira_vez", "origem"])
            for (idc, ida), (d, o) in sorted(vistos.items()):
                w.writerow([idc, ida, d.isoformat(), o])
        tmp.replace(arq)
    return vistos


def agregar(escolhas: dict, eventos: list, parcelas: dict[str, list[Parcela]], trilha: list[dict], regua,
            hoje: date, custos: dict | None = None, desde: date | None = None,
            cluster_de: dict | None = None, vistos: dict | None = None) -> dict:
    """escolhas: carregar_escolhas(); eventos: Evento[]; parcelas: {id_cliente: [Parcela]}; trilha: trilha.csv
    inteira (dicts com id_cliente, data, tag, tag_anterior); custos: {canal: custo por ação};
    cluster_de: {id_cliente: segmento atual} (só para o acordo sem ação); vistos: registrar_acordos() (sem ele,
    vale a regra legada para todos). Devolve
    {"desde", "linhas": [...], "posicao": [...], "totais": {...}} — só agregado."""
    custos = {c: float(v) for c, v in (custos or {}).items() if v not in (None, "")}
    desde = desde or (hoje - timedelta(days=DIAS_RECUPERACAO))
    ini, fim = desde.isoformat(), hoje.isoformat()
    ordem_canal = {c: i for i, c in enumerate(regua["ordem_rotacao"])}

    # ---- ações (dia, cliente, canal) e as linhas por número (posição)
    acoes = {}
    por_cliente_canal = defaultdict(list)
    numeros = {}                                   # (d, idc, canal, contato) -> posição
    dias_lista = set()
    for (d, idc), ls in escolhas.items():
        if d > fim:
            continue
        for l in ls:
            canal = l["canal"]
            reserva = str(l.get("reserva")) == "1"
            dias_lista.add(d)
            if l.get("contato"):
                k_num = (d, idc, canal, l["contato"])
                pos = int(l.get("ordem_contato") or 1) if str(l.get("ordem_contato") or "1").isdigit() else 1
                if k_num not in numeros or (numeros[k_num]["reserva"] and not reserva):
                    numeros[k_num] = {"posicao": pos, "reserva": reserva, "retornos": 0, "contato": False,
                                      "cpc": False, "terceiro": False, "curta": False}
            k = (d, idc, canal)
            if k in acoes:
                acoes[k]["reserva"] = acoes[k]["reserva"] and reserva
                continue
            volta, dia = volta_dia(l.get("passo"))
            acoes[k] = {"reserva": reserva, "regua": l.get("regua") or "", "cluster": l.get("cluster") or "",
                        "persona": l.get("persona") or "", "volta": volta, "dia_ciclo": dia, "retornos": 0,
                        "contato": False, "cpc": False, "promessa": False, "optout": False, "custo": 0.0}
            por_cliente_canal[(idc, canal)].append(d)
    for v in por_cliente_canal.values():
        v.sort(reverse=True)
    num_por = defaultdict(list)
    for (d, idc, canal, contato) in numeros:
        num_por[(idc, canal, contato)].append(d)
    for v in num_por.values():
        v.sort(reverse=True)

    # ---- retornos → ação (mesma regra do acoes_dia) e → número
    for e in eventos:
        dia_ev = e.data.isoformat()
        limite = (e.data - timedelta(days=DIAS_BUSCA_ESCOLHA)).isoformat()
        cl = _nivel(e.canal, e.resultado)
        contato = cl is not None and cl.nivel >= Nivel.ENGAJADO
        cpc = regua.e_contato(e.canal, e.resultado)
        d = next((d for d in por_cliente_canal.get((e.id_cliente, e.canal), ()) if limite <= d <= dia_ev), None)
        if d is not None:
            a = acoes[(d, e.id_cliente, e.canal)]
            a["retornos"] += 1
            a["contato"] = a["contato"] or contato or cpc
            a["cpc"] = a["cpc"] or cpc
            a["promessa"] = a["promessa"] or e.resultado == "promessa" or e.data_promessa is not None
            a["optout"] = a["optout"] or bool(cl and cl.restricao and cl.restricao.endswith(":opt_out"))
            a["custo"] += e.custo or 0.0
        if e.contato:
            dn = next((d for d in num_por.get((e.id_cliente, e.canal, e.contato), ()) if limite <= d <= dia_ev),
                      None)
            if dn is not None:
                n = numeros[(dn, e.id_cliente, e.canal, e.contato)]
                n["retornos"] += 1
                n["contato"] = n["contato"] or contato or cpc
                n["cpc"] = n["cpc"] or cpc
                n["terceiro"] = n["terceiro"] or bool(cl and cl.contra_titular >= TERCEIRO)
                n["curta"] = n["curta"] or e.resultado in NAO_COMPLETADA

    soma = defaultdict(lambda: dict.fromkeys(METRICAS, 0))

    def chave(d, canal, a):
        return (d, canal, a["regua"], a["cluster"], a["persona"], a["volta"], a["dia_ciclo"])

    toques = defaultdict(list)                     # idc -> [(d, canal, ação)] enviadas
    for (d, idc, canal), a in acoes.items():
        foi = not a["reserva"] or a["retornos"] > 0
        if not foi:
            continue
        toques[idc].append((d, canal, a))
        if d < ini:
            continue
        s = soma[chave(d, canal, a)]
        s["acoes"] += 1
        s["com_retorno"] += a["retornos"] > 0
        s["contatos"] += a["contato"]
        s["cpcs"] += a["cpc"]
        s["promessas"] += a["promessa"]
        s["optouts"] += a["optout"]
        s["custo"] += a["custo"] if a["retornos"] and a["custo"] else (custos.get(canal) or 0.0)

    # ---- acordos e pagamentos → ação de origem
    for idc, d_ac, canal_tag, nasceu, ate, ps in _acordos(parcelas, trilha, regua, vistos):
        d_ac = min(d_ac, hoje)          # legado sem trilha (1º vencimento − 7) nunca fica no futuro
        dia_ac = d_ac.isoformat()
        venc = None
        if nasceu:
            de, ate = (d_ac - timedelta(days=JANELA_ATRIBUICAO)).isoformat(), ate.isoformat()
            cand = [t for t in toques.get(idc, ()) if de <= t[0] <= ate]
            if cand:
                venc = max(cand, key=lambda t: (t[2]["cpc"], t[0], t[1] == canal_tag,
                                                -ordem_canal.get(t[1], 99)))
        if venc is not None:
            d, canal, a = venc
            k = chave(d, canal, a)
        else:
            k = (dia_ac, "", SEM_ACAO, (cluster_de or {}).get(idc, ""), "", 0, None)
        if k[0] < ini:
            continue                                # ação fora da janela: fica o número já publicado
        pagas = [p for p in ps if p.pago_em and p.pago_em <= hoje]
        s = soma[k]
        s["acordos"] += 1
        s["valor_acordo"] += sum(p.valor for p in ps)
        s["pagamentos"] += bool(pagas)
        s["valor_pago"] += sum(p.valor for p in pagas)

    linhas = []
    for k, s in sorted(soma.items(), key=lambda kv: tuple("" if x is None else str(x) for x in kv[0])):
        linhas.append({**dict(zip(CHAVE, k)), **s, "custo": round(float(s["custo"]), 2),
                       "valor_acordo": round(float(s["valor_acordo"]), 2),
                       "valor_pago": round(float(s["valor_pago"]), 2)})

    # ---- contato por posição do número e dias seguidos no mesmo número
    lista_ord = sorted(dias_lista)
    anterior = {d: (lista_ord[i - 1] if i else None) for i, d in enumerate(lista_ord)}
    seguidos = {}
    for (idc, canal, contato), ds in num_por.items():
        for d in sorted(ds):
            ant = anterior.get(d)
            prev = seguidos.get((ant, idc, canal, contato)) if ant else None
            seguidos[(d, idc, canal, contato)] = (prev or 0) + 1
    pos = defaultdict(lambda: dict.fromkeys(METRICAS_POSICAO, 0))
    for (d, idc, canal, contato), n in numeros.items():
        if d < ini or (n["reserva"] and not n["retornos"]):
            continue
        p = pos[(d, canal, min(n["posicao"], MAX_POSICAO), min(seguidos[(d, idc, canal, contato)], MAX_SEGUIDOS))]
        p["tentativas"] += 1
        p["com_retorno"] += n["retornos"] > 0
        p["contatos"] += n["contato"]
        p["cpcs"] += n["cpc"]
        p["terceiros"] += n["terceiro"]
        p["curtas"] += n["curta"]
    posicao = [{**dict(zip(CHAVE_POSICAO, k)), **v} for k, v in sorted(pos.items())]
    return {"desde": ini, "linhas": linhas, "posicao": posicao, "totais": totais(linhas)}


def totais(linhas: list[dict]) -> dict:
    t = dict.fromkeys(METRICAS, 0)
    for l in linhas:
        for k in METRICAS:
            t[k] += l[k]
    for k in ("custo", "valor_acordo", "valor_pago"):
        t[k] = round(float(t[k]), 2)
    return t


def carregar_trilha(pasta_estado) -> list[dict]:
    """estado/trilha.csv inteira (só as colunas que a atribuição usa)."""
    import csv
    from pathlib import Path
    arq = Path(pasta_estado) / "trilha.csv"
    if not arq.exists():
        return []
    with open(arq, newline="", encoding="utf-8") as f:
        return [{"id_cliente": l["id_cliente"], "data": l["data"], "tag": l.get("tag") or "",
                 "tag_anterior": l.get("tag_anterior") or ""} for l in csv.DictReader(f)]
