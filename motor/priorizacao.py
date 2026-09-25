"""Motor pré-disparo: qual contato, em qual canal, em que ordem.

valor esperado = P(titular) x P(certifica | titular, canal) x valor do contato efetivo − custo

"Contato efetivo" é contato com a pessoa certa (CPC, identidade confirmada,
portal autenticado). Engajamento sozinho não paga a tentativa.

Roda ANTES de qualquer ação massiva e devolve o plano de acionamento, os
bloqueios (com motivo, para auditoria) e o funil projetado.
"""
from collections import defaultdict

from .certificacao import Afinidade, Certificacao
from .taxonomia import CANAIS_EMAIL, CANAIS_TELEFONE

VALOR_CONTATO_EFETIVO = 8.0  # R$ por CPC; calibrar por carteira
LIMIAR_WHATSAPP = 0.8        # abaixo disso, só com CERTIFICADO (risco de banimento)
STATUS_FORA = {"INVALIDO", "CONTESTADO"}


def planejar(certs: dict[tuple[str, str], Certificacao], afinidade: Afinidade,
             custos: dict[str, float], valor_contato: float = VALOR_CONTATO_EFETIVO,
             limiar_whatsapp: float = LIMIAR_WHATSAPP):
    """Retorna (plano, bloqueios).

    plano: lista de dicts ordenada por CPF e prioridade (ordem 1 = primeira ação).
    bloqueios: lista de (cpf, contato, canal, motivo).
    """
    candidatos = defaultdict(list)
    bloqueios = []
    for c in certs.values():
        if c.status in STATUS_FORA:
            bloqueios.append((c.cpf, c.contato, "*", f"contato {c.status.lower()}"))
            continue
        for canal in CANAIS_TELEFONE if c.tipo == "telefone" else CANAIS_EMAIL:
            restr = sorted(r for r in c.restricoes if r.startswith(canal + ":"))
            if restr:
                bloqueios.append((c.cpf, c.contato, canal, f"restrição {restr[0]}"))
                continue
            if canal == "whatsapp" and c.status != "CERTIFICADO" and c.score < limiar_whatsapp:
                bloqueios.append((c.cpf, c.contato, canal,
                                  f"risco de banimento (score {c.score:.2f} < {limiar_whatsapp})"))
                continue
            p_engaja = afinidade.prob(c.cpf, canal)
            p_cpc = c.score * afinidade.prob_cpc(c.cpf, canal)
            ve = p_cpc * valor_contato - custos[canal]
            if ve <= 0:
                bloqueios.append((c.cpf, c.contato, canal, f"valor esperado negativo ({ve:.2f})"))
                continue
            candidatos[c.cpf].append({
                "cpf": c.cpf, "contato": c.contato, "tipo": c.tipo, "canal": canal,
                "status": c.status, "p_titular": c.score, "p_engaja": round(p_engaja, 4),
                "p_cpc": round(p_cpc, 4), "custo": custos[canal],
                "valor_esperado": round(ve, 4),
            })

    plano = []
    for cpf in sorted(candidatos):
        acoes = sorted(candidatos[cpf], key=lambda a: -a["valor_esperado"])
        for i, a in enumerate(acoes, 1):
            plano.append({"ordem": i, **a})
    return plano, bloqueios


def funil_projetado(plano: list[dict], total_clientes: int | None = None) -> dict:
    """Funil da 1ª ação de cada cliente: acionados → contato → contato com a pessoa certa."""
    primeiras = [a for a in plano if a["ordem"] == 1]
    custo = sum(a["custo"] for a in primeiras)
    cpc = sum(a["p_cpc"] for a in primeiras)
    funil = {}
    if total_clientes is not None:
        funil["clientes_na_carteira"] = total_clientes
        funil["sem_acao_viavel"] = total_clientes - len(primeiras)
    funil.update({
        "clientes_acionados": len(primeiras),
        "contatos_esperados": round(sum(a["p_engaja"] for a in primeiras), 1),
        "cpc_esperado": round(cpc, 1),
        "custo_total": round(custo, 2),
        "custo_por_cpc": round(custo / cpc, 2) if cpc else None,
        "por_canal": dict(sorted(_contar(a["canal"] for a in primeiras).items(), key=lambda kv: -kv[1])),
    })
    return funil


def _contar(itens):
    d = defaultdict(int)
    for i in itens:
        d[i] += 1
    return d
