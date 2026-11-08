"""Descrever segmentos e régua (SQL 79 · segmentacao_pedidos): a geração na VM, no molde de voz/gerar_fluxo.py.

Laço: pega o próximo pedido (pegar_pedido_segmentacao: texto + contexto SEM dado pessoal — segmentos atuais, nomes de
campos, valores distintos de colunas de texto com contagem, canais com estado, personas com o mapeamento), pede ao LLM
a proposta no esquema fechado (ferramenta entregar_segmentacao, motor/segmentacao_ia.py), compila e valida com o
Python do motor (cluster.ler_condicoes, estrategia.validar_estrategia, etapas.validar_fases) e, com erro, devolve ao
LLM o que corrigir, até 2 vezes. Devolve por registrar_segmentacao: com proposta, o banco confirma os 2 créditos de IA
reservados no pedido (SQL 78, `seg:geracao:<id>`); sem proposta (LLM fora, esquema errado, recusado pelo motor), o
banco estorna. Nada é gravado em segmentos ou estratégias por aqui: aplicar é do usuário, no site, e nasce pausado.

O texto do cliente vai como DADO (entre marcas) e o LLM não tem ferramenta de escrita: um texto que pede "apague os
segmentos" no máximo vira uma proposta com "desligar nesta carteira", que passa pela revisão e pela confirmação humana.

Na VM: serviço motorcx-voz-gerar-segmentacao (infra/asterisk/vm), `motorcx-voz-rodar gerar-segmentacao`, desligado
por padrão (metadado motorcx-gerar-segmentacao=1 liga). Mesmo LLM e mesma chave da geração do fluxo (voz/llm-fluxo,
Secret Manager); modelo e URL pelos metadados motorcx-gerar-segmentacao-modelo/-base-url (padrão igual ao do fluxo).
Nos dois acessos da VM (voz/acesso.py): no acesso_proprio as RPCs viram voz_vm.pegar_pedido_segmentacao e
voz_vm.registrar_segmentacao. Só biblioteca padrão.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from dataclasses import dataclass, field

from motor import segmentacao_ia as SI

log = logging.getLogger("motorcx.voz.gerar_segmentacao")
MAX_CORRECOES = 2
REF_LLM = "voz/llm-fluxo"          # a mesma chave do LLM da geração do fluxo


@dataclass
class Geracao:
    proposta: dict | None
    resultado: dict = field(default_factory=dict)
    tokens: int = 0


def gerar_segmentacao(ctx: dict, modelo, max_correcoes: int = MAX_CORRECOES) -> Geracao:
    if len(str(ctx.get("texto") or "")) > SI.LIMITE_TEXTO:
        return Geracao(None, {"erros": ["texto_longo"], "tentativas": 0})
    msgs = SI.mensagens(ctx)
    erros = ["sem_resposta_do_llm"]
    tokens = 0
    for tentativa in range(max_correcoes + 1):
        try:
            r = modelo.responder(msgs, SI.ferramenta())
        except Exception as ex:   # noqa: BLE001
            log.warning("segmentação: LLM indisponível (%s)", ex.__class__.__name__)
            return Geracao(None, {"erros": ["llm_indisponivel"], "tentativas": tentativa}, tokens)
        tokens += int(getattr(r, "tokens", 0) or 0)
        args = next((a for nome, a in r.chamadas if nome == "entregar_segmentacao"), None)
        if not isinstance(args, dict):
            erros = ["resposta_fora_do_esquema"]
            msgs.append({"role": "user", "content": "Responda só com a ferramenta entregar_segmentacao."})
            continue
        try:
            prop, erros = SI.compilar(args, ctx)
        except Exception as ex:   # noqa: BLE001 - entrada estranha nunca derruba o serviço
            log.warning("segmentação: compilação falhou (%s)", ex.__class__.__name__)
            prop, erros = None, ["resposta_fora_do_esquema"]
        if prop is not None:
            prop["hash_base"] = ctx.get("hash_base")
            return Geracao(prop, {"erros": [], "tentativas": tentativa}, tokens)
        if tentativa < max_correcoes:
            msgs.append({"role": "assistant", "content": json.dumps(args, ensure_ascii=False)[:30000]})
            msgs.append({"role": "user", "content": SI.mensagem_correcao(erros)})
    return Geracao(None, {"erros": erros[:20], "tentativas": max_correcoes}, tokens)


# ------------------------------------------------------------------ laço da VM
def processar_um(sb, modelo) -> bool:
    """Um pedido: pega, gera e devolve. Sem pedido na fila: False."""
    ctx = sb.rpc("pegar_pedido_segmentacao", {})
    if not ctx:
        return False
    try:
        g = gerar_segmentacao(ctx, modelo)
    except Exception as ex:   # noqa: BLE001
        log.warning("segmentação do pedido %s falhou (%s)", ctx.get("pedido"), ex.__class__.__name__)
        g = Geracao(None, {"erros": ["falha_na_geracao"], "tentativas": 0})
    sb.rpc("registrar_segmentacao", {"pedido": ctx["pedido"], "proposta": g.proposta, "resultado": g.resultado,
                                     "tokens": g.tokens or None})
    log.info("pedido de segmentação %s: %s", ctx.get("pedido"),
             "proposta" if g.proposta else f"{len(g.resultado.get('erros', []))} erro(s)")
    return True


def rodar(sb, modelo, intervalo: float = 10, uma_vez: bool = False, esperar=time.sleep,
          rodadas: int | None = None, max_por_rodada: int = 20) -> dict:
    """Esvazia a fila (até max_por_rodada) e espera. Erro do banco numa rodada não derruba o serviço."""
    cont = {"pedidos": 0, "falhas": 0}
    k = 0
    while rodadas is None or k < rodadas:
        k += 1
        try:
            n = 0
            while n < max_por_rodada and processar_um(sb, modelo):
                n += 1
            cont["pedidos"] += n
        except Exception as ex:   # noqa: BLE001
            cont["falhas"] += 1
            log.warning("rodada da segmentação falhou (%s); tenta de novo em %ss", ex.__class__.__name__, intervalo)
        if uma_vez:
            break
        esperar(intervalo)
    return cont


def main(argv=None) -> int:   # pragma: no cover - serviço
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--uma-vez", action="store_true")
    ap.add_argument("--intervalo", type=float, default=10)
    ap.add_argument("--base-url", default="https://api.openai.com/v1")
    ap.add_argument("--modelo", default="gpt-4.1")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    if not a.base_url.startswith("https://"):
        ap.error("--base-url precisa ser https://")
    from voz.configuracao import supabase_do_ambiente
    from voz.provedores.montagem import ModeloOpenAICompat
    from voz.segredos import SecretManager
    sb = supabase_do_ambiente()
    modelo = ModeloOpenAICompat(a.base_url, SecretManager().valor(REF_LLM), a.modelo, timeout=90)
    rodar(sb, modelo, a.intervalo, a.uma_vez)
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
