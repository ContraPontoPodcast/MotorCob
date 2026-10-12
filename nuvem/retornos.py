"""Aplica os avisos dos fornecedores reais (mensageria_eventos, gravados pela função "retorno-mensageria").

O plantão chama a cada minuto, depois do envio. Cada aviso atualiza a mensagem e o lote (funil):
* enviado: a operadora confirmou o envio (Enviado +1).
* entregue / falhou: resultado final do SMS ou RCS que estava "enviada" (sem retorno −1; Entregue ou Falha +1) e
  o retorno para a Orquestração (entregue / inexistente).
* bounce (e-mail): permanente vira falha (e-mail inexistente); temporário só conta.
* abertura, clique e spam (e-mail): marcam a mensagem; spam vira descadastro (reclamação).
* resposta: casa pelo hash do número com a última mensagem enviada a ele (até 3 dias), conta a resposta (SMS cobra
  a resposta), "SAIR" vira descadastro e o texto vai para o Radar e o atendimento.
Aviso que chega antes de a mensagem ter o id do fornecedor gravado espera até 1 hora e então é descartado.
"""
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

ESPERA = timedelta(hours=1)
RESPOSTA_ATE = timedelta(days=3)
SAIR = re.compile(r"^\s*(sair|parar|pare|cancelar|stop|descadastrar|remover)\b", re.I)
CONTADORES = ("enviadas", "entregues", "falhas", "descadastros", "respostas", "sem_retorno", "bounce_temporario",
              "aberturas", "cliques", "spam")


def banco_eventos(sb) -> bool:
    from nuvem.mensageria import _tabela_nova
    return _tabela_nova(lambda: sb.selecionar("mensageria_eventos", {"id": "eq.0"}) is not None, False)


def _em_lotes(sb, ids: set) -> dict:
    out = {}
    lista = sorted(ids)
    for i in range(0, len(lista), 100):
        for l in sb.selecionar("mensageria_lotes", {"id": f"in.({','.join(str(x) for x in lista[i:i + 100])})"}) or []:
            out[l["id"]] = l
    return out


def _mensagens_por_externo(sb, eventos: list[dict]) -> dict:
    """{(fornecedor, id_externo): mensagem}"""
    out = {}
    por_forn: dict[str, set] = {}
    for e in eventos:
        if e.get("id_externo"):
            por_forn.setdefault(e["fornecedor"], set()).add(e["id_externo"])
    for forn, ids in por_forn.items():
        lista = sorted(ids)
        for i in range(0, len(lista), 50):
            alvo = ",".join(x for x in lista[i:i + 50] if re.fullmatch(r"[A-Za-z0-9._:-]{1,120}", x))
            for m in sb.selecionar("mensageria_mensagens", {"fornecedor": f"eq.{forn}", "id_externo": f"in.({alvo})"}) or []:
                out[(forn, m["id_externo"])] = m
    return out


def _mensagem_da_resposta(sb, ev: dict, agora: datetime, lotes: dict) -> dict | None:
    desde = (agora - RESPOSTA_ATE).isoformat()
    cands = sb.selecionar("mensageria_mensagens", {"destino_hash": f"eq.{ev['de_hash']}", "enviado_em": f"gt.{desde}"},
                          ordem="enviado_em.desc", limite=10) or []
    faltam = {m["lote_id"] for m in cands} - set(lotes)
    if faltam:
        lotes.update(_em_lotes(sb, faltam))
    canais = {ev["canal"]} if ev.get("canal") else {"sms", "rcs", "whatsapp"}
    for m in cands:
        if (lotes.get(m["lote_id"]) or {}).get("canal") in canais:
            return m
    return None


def _contato(pastas: dict, lote: dict, mensagem_id) -> str | None:
    """Contato da mensagem no arquivo do lote (fica só no servidor)."""
    campanha = lote.get("campanha_id")
    pasta = pastas.get(("campanhas", lote["empresa_id"])) if campanha else pastas.get((lote["empresa_id"], lote.get("credor_id") or 0))
    if not pasta:
        return None
    arq = Path(pasta) / f"lote_{lote['id']}.json" if campanha else Path(pasta) / "mensageria" / f"lote_{lote['id']}.json"
    try:
        return (json.loads(arq.read_text(encoding="utf-8")).get(str(mensagem_id)) or {}).get("contato")
    except (OSError, ValueError):
        return None


def processar_retornos(sb, dados: Path, agora: datetime | None = None, out=print) -> dict:
    """Aplica os avisos pendentes. Devolve {aplicados, aguardando, descartados}."""
    from nuvem import mensageria as M
    agora = (agora or datetime.now(M.SP)).astimezone(M.SP)
    if not banco_eventos(sb):
        return {}
    eventos = sb.selecionar("mensageria_eventos", {"processado_em": "is.null"}, ordem="id.asc", limite=500) or []
    if not eventos:
        return {"aplicados": 0, "aguardando": 0, "descartados": 0}
    msgs = _mensagens_por_externo(sb, eventos)
    lotes = _em_lotes(sb, {m["lote_id"] for m in msgs.values()})
    mudadas: dict = {}                  # id -> mensagem atualizada
    delta: dict = {}                    # lote_id -> {contador: n}
    retorno: dict = {}                  # lote_id -> [(contato, situacao)]
    respostas: dict = {}                # lote_id -> [{mensagem, texto, contato}]
    descad, consumo = [], {}            # consumo: (empresa, dia) -> {item: n}
    feitos, aguardando, descartados = [], 0, 0
    pastas_cache: dict = {}

    def pastas_de(eid):
        if eid not in pastas_cache:
            pastas_cache.update({k: v for k, v in M._pastas(sb, Path(dados), {eid}).items()})
            pastas_cache[eid] = True
        return pastas_cache

    def soma(lid, k, n=1):
        delta.setdefault(lid, {}).setdefault(k, 0)
        delta[lid][k] += n

    def marcar_retorno(lote, m, situacao):
        if lote.get("campanha_id"):
            return                                           # só a Lista do dia volta para a Orquestração
        c = _contato(pastas_de(lote["empresa_id"]), lote, m["id"])
        if c:
            retorno.setdefault(lote["id"], []).append((c, situacao))

    for ev in eventos:
        tipo = ev["tipo"]
        if tipo == "resposta":
            m = _mensagem_da_resposta(sb, ev, agora, lotes)
        else:
            m = msgs.get((ev["fornecedor"], ev.get("id_externo")))
        if m is None:
            recebido = datetime.fromisoformat(str(ev["recebido_em"]).replace("Z", "+00:00"))
            if agora - recebido < ESPERA and tipo != "resposta":
                aguardando += 1
                continue
            descartados += 1
            feitos.append((ev["id"], "mensagem não encontrada"))
            continue
        m = mudadas.get(m["id"], m)
        lote = lotes.get(m["lote_id"]) or _em_lotes(sb, {m["lote_id"]}).get(m["lote_id"])
        lotes[m["lote_id"]] = lote
        lid, quando = lote["id"], (ev.get("ocorrido_em") or agora.isoformat())
        novo = dict(m)
        if tipo in ("enviado", "entregue") and not m.get("confirmada_em"):
            novo["confirmada_em"] = quando
            soma(lid, "enviadas")
        if tipo == "entregue" and m["situacao"] == "enviada":
            novo.update(situacao="entregue", motivo=None)
            soma(lid, "sem_retorno", -1)
            soma(lid, "entregues")
            marcar_retorno(lote, m, "entregue")
        elif tipo == "falhou" and m["situacao"] == "enviada":
            novo.update(situacao="falhou", motivo=(ev.get("motivo") or "não entregue")[:200])
            soma(lid, "sem_retorno", -1)
            soma(lid, "falhas")
            marcar_retorno(lote, m, "falhou")
        elif tipo == "bounce" and lote["canal"] == "email":
            if ev.get("bounce") == "temporario":
                if not m.get("bounce"):
                    novo["bounce"] = "temporario"
                    soma(lid, "bounce_temporario")
            elif m["situacao"] == "entregue":
                novo.update(situacao="falhou", bounce="permanente", motivo=(ev.get("motivo") or "e-mail inexistente")[:200])
                soma(lid, "entregues", -1)
                soma(lid, "falhas")
                marcar_retorno(lote, m, "falhou")
        elif tipo in ("abertura", "clique") and lote["canal"] == "email":
            if not m.get("aberta_em"):
                novo["aberta_em"] = quando
                soma(lid, "aberturas")
            if tipo == "clique" and not m.get("clicada_em"):
                novo["clicada_em"] = quando
                soma(lid, "cliques")
        elif tipo == "spam" and not m.get("spam_em"):
            novo["spam_em"] = quando
            soma(lid, "spam")
            soma(lid, "descadastros")
            descad.append({"empresa_id": lote["empresa_id"], "canal": lote["canal"], "destino_hash": m["destino_hash"],
                           "destino_mascara": m["destino_mascara"], "origem": "reclamacao"})
        elif tipo == "resposta":
            texto = (ev.get("texto") or "").strip()
            if not m.get("respondida_em"):
                novo["respondida_em"] = quando
                soma(lid, "respostas")
            if lote["canal"] == "sms" and lote.get("modo") == "real":
                dia = date.fromisoformat(str(quando)[:10])
                chave = (lote["empresa_id"], dia)
                consumo.setdefault(chave, {}).setdefault("sms_resposta", 0)
                consumo[chave]["sms_resposta"] += 1
            if SAIR.match(texto):
                soma(lid, "descadastros")
                descad.append({"empresa_id": lote["empresa_id"], "canal": lote["canal"], "destino_hash": m["destino_hash"],
                               "destino_mascara": m["destino_mascara"], "origem": "resposta"})
                marcar_retorno(lote, m, "descadastro")
            elif texto:
                c = _contato(pastas_de(lote["empresa_id"]), lote, m["id"])
                respostas.setdefault(lid, []).append({"mensagem": m, "texto": texto, "contato": c})
        if novo != m:
            novo["atualizado_em"] = agora.isoformat()
            mudadas[m["id"]] = novo
        feitos.append((ev["id"], "aplicado"))

    if mudadas:
        sb.inserir("mensageria_mensagens", list(mudadas.values()), conflito="id")
    if descad:
        sb.inserir("mensageria_descadastros", descad, conflito="empresa_id,canal,destino_hash")
    for (eid, dia), por_item in consumo.items():
        M._consumo(sb, eid, dia, por_item)
    from nuvem import atendimento
    if respostas and atendimento.banco_radar(sb):
        for lid, itens in respostas.items():
            lote = lotes[lid]
            cfg = (sb.selecionar("mensageria_config", {"empresa_id": f"eq.{lote['empresa_id']}"}) or [{}])[0]
            marcas = atendimento.registrar(sb, lote["empresa_id"], lote["canal"], lote, itens, cfg, agora, out)
            if not lote.get("campanha_id"):
                retorno.setdefault(lid, []).extend((i["contato"], mc) for i, mc in zip(itens, marcas) if i["contato"])
    for lid, linhas in retorno.items():
        lote = lotes[lid]
        pasta = pastas_de(lote["empresa_id"]).get((lote["empresa_id"], lote.get("credor_id") or 0))
        if pasta:
            M._anotar_retorno(pasta, lote["canal"], lid, date.fromisoformat(lote["data"]), linhas)
    for lid, d in delta.items():
        lote = lotes[lid]
        sb.atualizar("mensageria_lotes", {"id": f"eq.{lid}"},
                     {**{k: max(0, int(lote.get(k) or 0) + n) for k, n in d.items() if k in CONTADORES},
                      "atualizado_em": agora.isoformat()})
    for i in range(0, len(feitos), 100):
        bloco = feitos[i:i + 100]
        for res in {r for _, r in bloco}:
            ids = ",".join(str(e) for e, r in bloco if r == res)
            sb.atualizar("mensageria_eventos", {"id": f"in.({ids})"}, {"processado_em": agora.isoformat(), "resultado": res})
    aplicados = len(feitos) - descartados
    if aplicados or descartados:
        out(f"mensageria: retornos dos fornecedores — {aplicados} aplicados, {descartados} sem mensagem")
    return {"aplicados": aplicados, "aguardando": aguardando, "descartados": descartados}
