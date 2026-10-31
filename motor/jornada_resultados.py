"""MotorCli — resultado de cada momento e movimento da jornada (revisão de UX aprovada em 15/10/2026).

Sai só da carga diária de clientes, comparando o que chegou hoje com o que tinha chegado antes (nenhum dado
novo). Resultado ("desfecho") de cada momento, por cliente e episódio, uma vez só:
  boas_vindas    sucesso = recebeu a 1ª ação até o 2º dia da contratação · não = passou do 2º dia sem ação
  ativacao       sucesso = "ativado" virou sim até 30 dias da contratação · não = passou dos 30 dias sem ativar
  pre_vencimento sucesso = pagou até o vencimento (aceita o dia seguinte, quando a carga chega) · não = venceu
  retencao       sucesso = a atividade voltou antes de 90 dias sem atividade · não = chegou aos 90 dias
  reativacao     sucesso = a atividade voltou · não = passou de 365 dias sem atividade
  cobranca       entrou em atraso (fica com o MotorCob); conta para o momento em que estava
O desfecho conta para o último canal que acionou o cliente nos 7 dias anteriores ("" = sem ação nesse prazo) e
para a mensagem dessa ação (frase_id; 0 = template padrão do canal).
Movimento: quando o momento do cliente muda de um dia para o outro (entrada, voltou a usar, cobrança, fora).
Nada de dado pessoal sai daqui: só contagens.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ATRIBUICAO_DIAS = 7
ARQUIVO = "jornada_resultados.json"
ANTES = "jornada_resultados_antes.json"


def carregar(pasta: str | Path, hoje: date) -> dict:
    """Estado de ontem. Dia refeito (carga nova, rodada repetida): parte do estado de antes deste dia."""
    pasta = Path(pasta)
    antes = pasta / ANTES
    salvo = json.loads(antes.read_text(encoding="utf-8")) if antes.exists() else {}
    if salvo.get("data") == hoje.isoformat():
        return salvo["estado"]
    arq = pasta / ARQUIVO
    estado = json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}
    pasta.mkdir(parents=True, exist_ok=True)
    antes.write_text(json.dumps({"data": hoje.isoformat(), "estado": estado}, ensure_ascii=False), encoding="utf-8")
    return estado


def salvar(pasta: str | Path, estado: dict) -> None:
    arq = Path(pasta) / ARQUIVO
    arq.parent.mkdir(parents=True, exist_ok=True)
    tmp = arq.with_suffix(".tmp")
    tmp.write_text(json.dumps(estado, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp.replace(arq)


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def _canal(est_acao: dict | None, hoje: date) -> str:
    """Último canal que acionou o cliente nos 7 dias anteriores (estado da jornada: ultima + canal)."""
    if not est_acao or not est_acao.get("ultima") or not est_acao.get("canal"):
        return ""
    return est_acao["canal"] if (hoje - date.fromisoformat(est_acao["ultima"])).days <= ATRIBUICAO_DIAS else ""


def calcular(clientes: dict, momento_de, hoje: date, estado: dict, estado_acoes: dict,
             por_cliente: dict | None = None) -> tuple[Counter, Counter]:
    """(desfechos, movimento). desfechos: Counter((momento, canal, frase_id, desfecho)); movimento: Counter((de, para)).
    momento_de(cliente) -> momento do motor hoje (ou None). estado: o deste módulo (atualizado aqui);
    estado_acoes: o da jornada (ultima, canal e passos feitos), antes das ações de hoje.
    por_cliente (opcional): recebe {id_cliente: (momento, desfecho)} do resultado que fechou hoje, para o histórico
    de 90 dias do cliente no site (SQL 55). Só o ID; as contagens continuam as mesmas."""
    desf, mov = Counter(), Counter()
    for idc, c in clientes.items():
        p = estado.get(idc) or {}
        fechados = set(p.get("f") or [])
        ea = estado_acoes.get(idc) or {}
        canal = _canal(ea, hoje)
        frase = int(ea.get("frase") or 0) if canal else 0

        def fechar(chave, momento, resultado):
            if chave not in fechados:
                fechados.add(chave)
                desf[(momento, canal, frase, resultado)] += 1
                if por_cliente is not None:
                    por_cliente[idc] = (momento, resultado)

        atraso = (c.dias_atraso or 0) > 0
        agora = "cobranca" if atraso else (momento_de(c) or "")
        antes = p.get("m")
        # ---- boas-vindas e ativação (episódio = contratação)
        if c.contratacao:
            ct = c.contratacao.isoformat()
            dias = (hoje - c.contratacao).days
            feitos_bv = ((ea.get("momentos") or {}).get("boas_vindas") or {})
            if feitos_bv.get("episodio") == ct and feitos_bv.get("feitos"):
                fechar(f"bv:{ct}", "boas_vindas", "sucesso")
            elif dias in (3, 4) and p.get("ct") == ct:          # só na virada (a base antiga não conta)
                fechar(f"bv:{ct}", "boas_vindas", "nao")
            if c.ativado is True and p.get("at") is not True and p.get("ct") == ct and dias <= 30:
                fechar(f"at:{ct}", "ativacao", "sucesso")
            elif c.ativado is not True and dias in (31, 32) and p.get("ct") == ct:
                fechar(f"at:{ct}", "ativacao", "nao")
        # ---- pré-vencimento (episódio = vencimento que estava em aberto)
        v_ant = _d(p.get("v"))
        if v_ant and not p.get("p"):
            pagou = (c.vencimento == v_ant and c.pago) or \
                    (c.vencimento is not None and c.vencimento > v_ant and not atraso)
            if pagou and hoje <= v_ant + timedelta(days=1):
                fechar(f"pv:{v_ant.isoformat()}", "pre_vencimento", "sucesso")
            elif (hoje - v_ant).days >= 2 and (pagou or (hoje - v_ant).days <= 3):   # venceu (ou pagou atrasado)
                fechar(f"pv:{v_ant.isoformat()}", "pre_vencimento", "nao")
        # ---- retenção e reativação (episódio = última atividade)
        ua_ant = _d(p.get("ua"))
        if ua_ant and p.get("at") is not False:
            dias_ant = (hoje - timedelta(days=1) - ua_ant).days
            voltou = c.ultima_atividade is not None and c.ultima_atividade > ua_ant
            dias = (hoje - ua_ant).days
            if 30 <= dias_ant <= 89:
                if voltou:
                    fechar(f"rt:{ua_ant.isoformat()}", "retencao", "sucesso")
                elif dias >= 90:
                    fechar(f"rt:{ua_ant.isoformat()}", "retencao", "nao")
            elif 90 <= dias_ant <= 365:
                if voltou:
                    fechar(f"ra:{ua_ant.isoformat()}", "reativacao", "sucesso")
                elif dias > 365:
                    fechar(f"ra:{ua_ant.isoformat()}", "reativacao", "nao")
        # ---- cobrança e movimento
        if atraso and not p.get("atraso") and idc in estado:
            desf[(antes or "", canal, frase, "cobranca")] += 1
            if por_cliente is not None:
                por_cliente[idc] = (antes or "", "cobranca")
        if idc not in estado:
            if agora:
                mov[("entrada", agora)] += 1
        elif antes != agora:
            voltou_a_usar = antes in ("retencao", "reativacao") and c.ultima_atividade is not None \
                and ua_ant is not None and c.ultima_atividade > ua_ant
            mov[(antes or "fora", "voltou_a_usar" if voltou_a_usar else (agora or "fora"))] += 1
        # ---- guarda o de hoje (só o que o cálculo de amanhã precisa; episódios fechados há mais de 400 dias saem)
        limite = (hoje - timedelta(days=400)).isoformat()
        estado[idc] = {k: v for k, v in {
            "m": agora, "at": c.ativado, "p": bool(c.pago), "atraso": atraso,
            "ct": c.contratacao.isoformat() if c.contratacao else None,
            "v": c.vencimento.isoformat() if c.vencimento else None,
            "ua": c.ultima_atividade.isoformat() if c.ultima_atividade else None,
            "f": sorted(f for f in fechados if f.split(":", 1)[1] >= limite),
        }.items() if v not in (None, [], "")}
    for idc in [k for k in estado if k not in clientes]:
        del estado[idc]                  # saiu da carga: some do estado (sem dado de quem não está mais)
    return desf, mov


def taxas_por_momento(linhas: list[dict], minimo: int = 200) -> dict:
    """{momento: {canal: taxa}} a partir de jornada_desfechos dos últimos 90 dias (só canais com `minimo` desfechos)."""
    soma: dict = {}
    for l in linhas:
        if not l.get("canal") or l.get("desfecho") not in ("sucesso", "nao"):
            continue
        s = soma.setdefault(l["momento"], {}).setdefault(l["canal"], [0, 0])
        s[0 if l["desfecho"] == "sucesso" else 1] += int(l.get("clientes") or 0)
    return {m: {c: round(100 * s / (s + n), 1) for c, (s, n) in cs.items() if s + n >= minimo}
            for m, cs in soma.items()}


FRASE_RESULTADO = {"boas_vindas": "receberam a 1ª mensagem", "ativacao": "ativaram",
                   "pre_vencimento": "pagam em dia", "retencao": "voltaram a usar", "reativacao": "voltaram a usar"}


def melhor_por_resultado(taxas: dict, reserva=None):
    """'Melhor canal' pelo resultado do momento: ordena as opções pela taxa (com histórico suficiente em todas);
    sem histórico, usa a reserva (taxa de contato da persona, como antes). Devolve (ordem, por_que)."""
    reserva = reserva or (lambda opcoes: list(opcoes))

    def escolher(opcoes: list[str], momento: str | None = None):
        t = taxas.get(momento or "") or {}
        if momento and opcoes and all(o in t for o in opcoes):
            ordem = sorted(opcoes, key=lambda o: -t[o])
            return ordem, f"melhor canal: {t[ordem[0]]:.0f}% {FRASE_RESULTADO.get(momento, 'de sucesso')}".replace(".", ",")
        return reserva(opcoes), "melhor canal: pelo retorno da persona (ainda sem histórico do momento)"
    return escolher
