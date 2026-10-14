"""Score de Entrega (bloco 6): filtro de inteligência aplicado na campanha.

Cada número (só o hash, nunca o contato) recebe a probabilidade de entrega e uma faixa (alto, medio, baixo, sem)
calculadas no banco por score_entrega(hashes, item), sobre o histórico de tudo o que saiu pela Mensageria. A
campanha escolhe as faixas que recebem; quem fica fora não sai, não é cobrado como SMS e volta ao cliente com o
nome da faixa (mensageria_score_nomes, editável pelo Técnico), com filtro = 'score'. Uma amostra sorteada dos que
ficariam fora sai mesmo assim (grupo de controle) para medir a entrega real de cada faixa.

probabilidade() e faixa() repetem a conta do banco: servem aos testes (o teste de RLS confere que dão o mesmo
resultado) e documentam o modelo.
"""
from __future__ import annotations

import hashlib

FAIXAS = ("alto", "medio", "baixo", "sem")
LOTE_RPC = 500
PADRAO = {"janela_dias": 30, "meia_vida_dias": 10.0, "peso_permanente": 2.0, "forca_base": 1.0, "alto_min": 70.0,
          "baixo_max": 20.0, "historico_min": 1.5, "sem_historico_abaixo": 0.5, "quarentena_dias": 20,
          "controle_pct": 1.0}
NOMES_PADRAO = {"alto": "Não enviado · faixa Alto fora da campanha", "medio": "Não enviado · faixa Médio fora da campanha",
                "baixo": "Não enviado · baixa propensão de entrega", "sem": "Não enviado · número sem histórico"}


def probabilidade(historico: list[tuple[float, str, bool]], cfg: dict, base: float = 0.8) -> tuple[float, float, float | None]:
    """historico: [(idade em dias, 'entregue'|'falhou', falha permanente?)]. Devolve (probabilidade, histórico
    ponderado, idade da última tentativa). Peso de cada tentativa = ½^(idade ÷ meia-vida), vezes o peso da falha
    permanente quando é "número inexistente"; fora da janela não conta."""
    e = t = 0.0
    ultima = None
    for idade, situacao, permanente in historico:
        if idade < 0 or idade >= cfg["janela_dias"]:
            continue
        w = 0.5 ** (idade / cfg["meia_vida_dias"]) * (cfg["peso_permanente"] if situacao == "falhou" and permanente else 1)
        t += w
        if situacao == "entregue":
            e += w
        ultima = idade if ultima is None else min(ultima, idade)
    den = cfg["forca_base"] + t
    return ((base * cfg["forca_base"] + e) / den if den else base), t, ultima


def faixa(p: float, t: float, ultima: float | None, cfg: dict) -> str:
    if t < cfg["sem_historico_abaixo"]:
        return "sem"
    if p * 100 >= cfg["alto_min"]:
        return "alto"
    if p * 100 < cfg["baixo_max"] and t >= cfg["historico_min"]:
        return "sem" if ultima is not None and ultima >= cfg["quarentena_dias"] else "baixo"
    return "medio"


def no_controle(destino_hash: str, campanha_id, pct: float) -> bool:
    """Sorteio estável do grupo de controle: o mesmo número na mesma campanha cai sempre do mesmo lado."""
    if not pct:
        return False
    x = int(hashlib.sha256(f"controle:{campanha_id}:{destino_hash}".encode()).hexdigest()[:8], 16) / 16 ** 8
    return x < pct / 100


def classificar(sb, hashes: list[str], item: str) -> dict:
    """{hash: (faixa, probabilidade)} pelo banco (score_entrega), em pedaços."""
    saida = {}
    unicos = list(dict.fromkeys(hashes))
    for i in range(0, len(unicos), LOTE_RPC):
        for r in sb.rpc("score_entrega", {"hashes": unicos[i:i + LOTE_RPC], "item_produto": item}) or []:
            saida[r["destino_hash"]] = (r["faixa"], float(r["probabilidade"]))
    return saida


def configuracao(sb, item: str) -> dict:
    """Configuração do filtro que vale para o produto (só o controle é usado aqui; o resto o banco aplica)."""
    try:
        r = sb.rpc("score_config_do_item", {"item_produto": item})
    except Exception:  # noqa: BLE001 — banco sem a função: padrão
        r = None
    r = (r[0] if isinstance(r, list) and r else r) or {}
    return {**PADRAO, **{k: v for k, v in r.items() if k in PADRAO and v is not None}}


def nomes(sb) -> dict:
    return {**NOMES_PADRAO, **{n["faixa"]: n["texto"] for n in sb.selecionar("mensageria_score_nomes") or []}}


def aplicar(sb, campanha: dict, item: str, linhas: list[dict], locais: dict) -> dict:
    """Aplica o Score às linhas pendentes da campanha (altera linhas e locais). Toda linha ganha as mesmas chaves
    (o insert em lote do PostgREST exige). Devolve a contagem: analisados, represados e controle."""
    faixas_ok = set(campanha.get("score_faixas") or [])
    for l in linhas:
        l.update(score_faixa=None, score_prob=None, score_controle=False, filtro=None)
    pend = [l for l in linhas if l["situacao"] == "pendente"]
    cont = {"analisados": len(pend), "represados": 0, "controle": 0}
    if not faixas_ok or not pend:
        return cont
    cfg, nome = configuracao(sb, item), nomes(sb)
    res = classificar(sb, [l["destino_hash"] for l in pend], item)
    for l in pend:
        fx, p = res.get(l["destino_hash"], ("sem", None))
        l.update(score_faixa=fx, score_prob=round(p, 4) if p is not None else None)
        if fx in faixas_ok:
            continue
        if no_controle(l["destino_hash"], campanha.get("id"), cfg["controle_pct"]):
            l["score_controle"] = True
            cont["controle"] += 1
            continue
        l.update(situacao="bloqueada", motivo=nome[fx][:200], filtro="score")
        locais.pop((l["id_cliente"], l["destino_hash"]), None)
        cont["represados"] += 1
    return cont


def itens_de_cobranca(sb, empresa_id, cont: dict) -> dict:
    """{item: quantidade} do Score para o consumo do mês, pela forma contratada (empresa_score.cobranca)."""
    contrato = (sb.selecionar("empresa_score", {"empresa_id": f"eq.{empresa_id}", "ativo": "eq.true"}) or [None])[0]
    if not contrato:
        return {}
    if contrato.get("cobranca") == "represado":
        return {"score_represado": cont["represados"]}
    return {"score_analisado": cont["analisados"]}
