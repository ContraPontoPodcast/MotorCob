"""Fila da curadoria (SA22) alimentada pela VM: o que a IA decidiu com dúvida vai para a operação revisar.

Regras (decisões do protótipo aprovado):
  intencao     intenção com confiança < 0,5
  trava        toda resposta do generativo trocada pela trava
  codigo       motivo ou objeção com as duas maiores probabilidades a menos de 0,15 uma da outra
  transcricao  transcrição com mais de 30% do trecho em baixa confiança
  tema         tema novo da clusterização semanal (sem nome; só a curadoria dá nome, decisão 7)
A nota contestada entra pelo site (contestar_nota_voz). O trecho vai sempre mascarado; o banco recusa o resto.
"""
from __future__ import annotations

from voz.analise import contrato as K
from voz.transcricao.redacao import redigir_trecho

LIMIAR_INTENCAO = 0.5
MARGEM_CODIGO = 0.15
BAIXA_TRANSCRICAO = 0.30


def _item(ctx: dict, tipo: str, trecho: str | None, decisao: dict, opcoes=(), confianca=None) -> dict:
    return {"empresa_id": ctx["empresa_id"], "tipo": tipo, "chamada_id": ctx.get("chamada_id"),
            "gravacao_id": ctx.get("gravacao_id"), "avaliacao_id": None, "tema_id": ctx.get("tema_id"),
            "trecho_redigido": redigir_trecho(trecho, ctx.get("nomes", ()))[:600] if trecho else None,
            "decisao_ia": decisao, "opcoes": list(opcoes)[:20],
            "confianca": None if confianca is None else round(float(confianca), 3)}


def itens_da_chamada(ctx: dict, analise: dict) -> list[dict]:
    """ctx: {empresa_id, chamada_id, gravacao_id, nomes}. analise: o que o extrator e o fluxo devolveram (só códigos,
    probabilidades e posições; o texto vem da transcrição já mascarada)."""
    out = []
    for i in analise.get("intencoes", []):
        if float(i.get("confianca", 1)) < LIMIAR_INTENCAO:
            out.append(_item(ctx, "intencao", i.get("trecho"), {"valor": i.get("intencao")},
                             i.get("alternativas", []), i.get("confianca")))
    for t in analise.get("travas", []):
        out.append(_item(ctx, "trava", t.get("trecho"), {"valor": "trava_correta", "trava": t.get("trava")},
                         ["trava_correta", "trava_desnecessaria"]))
    for campo, probs in (analise.get("probabilidades") or {}).items():
        ordem = sorted(probs.items(), key=lambda kv: -kv[1])
        if len(ordem) >= 2 and ordem[0][1] - ordem[1][1] < MARGEM_CODIGO:
            out.append(_item(ctx, "codigo", analise.get("trecho_" + campo), {"valor": ordem[0][0], "campo": campo,
                                                                              "duvida_com": ordem[1][0]},
                             [k for k, _ in ordem], ordem[0][1]))
    baixa = analise.get("baixa_confianca_pct")
    if baixa is not None and float(baixa) > BAIXA_TRANSCRICAO:
        out.append(_item(ctx, "transcricao", analise.get("trecho_ruido"), {"valor": "retranscrever",
                                                                          "baixa_pct": round(float(baixa), 2)},
                         ["retranscrever", "audio_ruim"]))
    return out


def itens_de_temas(empresa_id: int, temas_novos: list[dict]) -> list[dict]:
    """temas_novos: [{tema_id, exemplo (trecho), conversas, intencoes: {codigo: pct}}] da clusterização semanal."""
    out = []
    for t in temas_novos:
        if int(t.get("conversas", 0)) < 30:                 # tema com menos de 30 conversas espera mais uma semana
            continue
        out.append(_item({"empresa_id": empresa_id, "tema_id": t["tema_id"]}, "tema", t.get("exemplo"),
                         {"valor": "", "conversas": int(t["conversas"]), "intencoes": t.get("intencoes", {})}))
    return out


def enfileirar(sb, itens: list[dict]) -> int:
    if not itens:
        return 0
    cols = set(K.COLUNAS["voz_curadoria_itens"])
    sb.inserir("voz_curadoria_itens", [{k: v for k, v in i.items() if k in cols} for i in itens])
    return len(itens)
