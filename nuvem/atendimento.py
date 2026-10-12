"""Atendimento das respostas (caixa de entrada da Mensageria).

* registrar: cada resposta recebida vira (ou atualiza) uma conversa do número, com o texto (guardado 90 dias) e a
  classificação do Radar. Devolve a marca para o retorno de canal da Orquestração: quem respondeu foi encontrado
  ("clique"); quem desconhece é contato errado ("inexistente").
* enviar: o que o cliente responde pela plataforma sai pelo mesmo canal e fornecedor do plano, dentro do horário
  do canal. O contato é buscado no arquivo do lote no servidor (o banco não tem o telefone).
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

from nuvem import mensageria as M
from nuvem import radar


def banco_radar(sb) -> bool:
    """O banco já tem o SQL 15 (conversas, Radar, links)?"""
    return M._tabela_nova(lambda: sb.selecionar("mensageria_conversas", {"id": "eq.0"}) is not None, False)


def registrar(sb, empresa_id, canal: str, lote: dict, itens: list[dict], cfg: dict, agora: datetime,
              out=print) -> list[str]:
    """itens: [{mensagem, texto}]. Classifica, grava conversa e mensagem e devolve a marca de cada item."""
    if not itens:
        return []
    usar_ia = cfg.get("radar") is not False and (lote.get("modo") == "real" or os.environ.get("MOTORCOB_RADAR_IA_SIMULADO") == "1")
    classes = radar.classificar([i["texto"] for i in itens], usar_ia=usar_ia, out=out)
    marcas = []
    for it, cl in zip(itens, classes):
        m = it["mensagem"]
        chave = {"empresa_id": f"eq.{empresa_id}", "canal": f"eq.{canal}", "destino_hash": f"eq.{m['destino_hash']}"}
        atual = (sb.selecionar("mensageria_conversas", chave) or [None])[0]
        dados = {"empresa_id": empresa_id, "canal": canal, "destino_hash": m["destino_hash"],
                 "destino_mascara": m.get("destino_mascara"), "id_cliente": m.get("id_cliente"),
                 "lote_id": lote["id"], "mensagem_id": m["id"], "campanha_id": lote.get("campanha_id"),
                 "classe": cl["classe"], "confianca": cl["confianca"], "situacao": "aberta",
                 "nao_lidas": int((atual or {}).get("nao_lidas") or 0) + 1, "ultima_em": agora.isoformat()}
        if atual:
            sb.atualizar("mensageria_conversas", {"id": f"eq.{atual['id']}"}, dados)
            cid = atual["id"]
        else:
            cid = sb.inserir("mensageria_conversas", [dados], retornar=True)[0]["id"]
        sb.inserir("mensageria_conversa_mensagens", [{
            "conversa_id": cid, "empresa_id": empresa_id, "direcao": "entrada", "texto": it["texto"][:2000],
            "classe": cl["classe"], "confianca": cl["confianca"], "justificativa": cl["justificativa"],
            "origem_radar": cl["origem"], "situacao": "recebida", "criado_em": agora.isoformat(),
            "apagar_em": (agora + timedelta(days=90)).isoformat()}])
        marcas.append("inexistente" if cl["classe"] == "desconhece" else "clique")
    return marcas


def _contato(sb, dados: Path, conversa: dict, pastas: dict) -> str | None:
    lote = (sb.selecionar("mensageria_lotes", {"id": f"eq.{conversa.get('lote_id')}"}) or [None])[0] \
        if conversa.get("lote_id") else None
    if not lote:
        return None
    eid = lote["empresa_id"]
    if lote.get("campanha_id"):
        arq = pastas.get(("campanhas", eid))
        arq = arq / f"lote_{lote['id']}.json" if arq else None
    else:
        pasta = pastas.get((eid, lote.get("credor_id") or 0))
        arq = pasta / "mensageria" / f"lote_{lote['id']}.json" if pasta else None
    if not arq or not arq.exists():
        return None
    return (json.loads(arq.read_text(encoding="utf-8")).get(str(conversa.get("mensagem_id"))) or {}).get("contato")


def enviar(sb, dados: Path, agora: datetime | None = None, out=print) -> dict:
    """Envia as respostas escritas na plataforma. Devolve {enviadas, falhas, aguardando}."""
    agora = (agora or datetime.now(M.SP)).astimezone(M.SP)
    pend = sb.selecionar("mensageria_conversa_mensagens", {"situacao": "eq.pendente"}, ordem="id.asc", limite=200) or []
    res = {"enviadas": 0, "falhas": 0, "aguardando": 0}
    if not pend:
        return res
    conversas = {c["id"]: c for c in sb.selecionar("mensageria_conversas", {
        "id": f"in.({','.join(str(i) for i in sorted({p['conversa_id'] for p in pend}))})"}) or []}
    pastas = M._pastas(sb, Path(dados), {c["empresa_id"] for c in conversas.values()})
    for msg in pend:
        conv = conversas.get(msg["conversa_id"])
        filtro = {"id": f"eq.{msg['id']}"}
        if not conv:
            continue
        eid, canal = conv["empresa_id"], conv["canal"]
        cfg = (sb.selecionar("mensageria_config", {"empresa_id": f"eq.{eid}"}) or [{}])[0]
        modo = cfg.get("modo") or "simulado"
        canal_cfg = next((x for x in sb.selecionar("canais_empresa", {"empresa_id": f"eq.{eid}"}) or []
                          if x.get("canal") == canal), None)
        if not M.dentro(M.janela(canal_cfg, agora.date()), agora):
            res["aguardando"] += 1                       # fora do horário do canal: sai na próxima janela
            continue
        contato = _contato(sb, dados, conv, pastas)
        if not contato:
            sb.atualizar("mensageria_conversa_mensagens", filtro,
                         {"situacao": "falhou", "motivo": "contato não está mais no servidor"})
            res["falhas"] += 1
            continue
        plano = M.plano_rota(sb, eid, canal, modo)
        resultado, usado, erro = None, None, "sem rota ativa"
        for f in M.escolher(plano, f"resp:{msg['id']}"):
            try:
                resultado, usado = M.adaptador(f, modo).enviar(canal, contato, msg["texto"]), f
                break
            except M.ErroFornecedor as e:
                erro = str(e)
        if resultado is None or resultado.situacao not in ("entregue", "enviada"):
            sb.atualizar("mensageria_conversa_mensagens", filtro, {
                "situacao": "falhou", "motivo": (resultado.motivo if resultado else erro or "")[:200]})
            res["falhas"] += 1
            continue
        item = canal
        if canal == "rcs":
            item = ("rcs_sessao" if conv["destino_hash"] in M._sessoes_abertas(sb, eid, agora) else
                    "rcs_basic" if len(msg["texto"]) <= M.LIMITE_RCS_BASIC else "rcs_single")
        M._consumo_fornecedor(sb, eid, agora.date(), modo, {(usado, "", item): 1})
        if modo == "real":
            M._consumo(sb, eid, agora.date(), {item: 1})
        sb.atualizar("mensageria_conversa_mensagens", filtro, {"situacao": "enviada", "motivo": None})
        res["enviadas"] += 1
    if res["enviadas"] or res["falhas"]:
        out(f"atendimento: {res['enviadas']} respostas enviadas, {res['falhas']} com falha")
    return res
