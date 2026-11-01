"""Geração do rascunho do fluxo a partir do texto do cliente (pedido do dono, SQL 58 · voz_fluxo_pedidos).

Roda na VM (mais simples que uma Edge Function: usa o mesmo validador em Python, voz/fluxo_validador.py, e o mesmo
cliente de LLM da Montagem). Laço: pega o próximo pedido (pegar_pedido_fluxo_voz), gera, valida e devolve
(registrar_geracao_fluxo_voz). O banco valida de novo e só cria o rascunho se passar: saída inválida nunca vira
rascunho, e nada é aprovado nem colocado em uso por aqui.

gerar_fluxo_voz(contexto, modelo):
  1. pede ao LLM a definição no esquema fechado (ferramenta entregar_fluxo), só com os conectores, intenções e
     variáveis que a empresa tem;
  2. aplica as TRAVAS que sempre entram (independem do que o LLM escreveu): terceiro → Encerrar com recado neutro
     fixo; Confirmar identidade nunca generativa; transferir_humano em todo Generativo; ferramentas fora da lista
     saem; conector que a empresa não tem vira "a escolher" (nunca inventado);
  3. valida (validador + catálogo + nada de oferta escrita à mão na fala) e, com erro, devolve os erros ao LLM
     para corrigir, até 2 vezes. Sobrou erro: devolve sem definição e com os erros;
  4. devolve "o que entendi" (frase → bloco), "suposições e perguntas" (respondidas, geram de novo) e, para mudança
     num fluxo existente, o que mudou em relação à versão de origem.
Sem limite de pedidos (decisão do dono): cada geração aparece no extrato (item ia_geracao_fluxo, contado pelo banco
em registrar_geracao_fluxo_voz). Os tokens gastos vão em resultado.tokens_ia só para o custo real (SQL 61 · consumo_ia,
só o Master vê); o banco tira a chave antes de gravar o pedido e o cliente paga sempre o preço por geração.
Anexos: apagados do Storage quando a versão gerada deixa de existir (limpar_anexos).
A chave do LLM fica no Secret Manager (voz/llm-fluxo). Só biblioteca padrão.
"""
from __future__ import annotations

import argparse
import copy
import json
import logging
import re
import time
from dataclasses import dataclass, field

from voz import fluxo_validador as FV

log = logging.getLogger("motorcx.voz.gerar_fluxo")
MAX_CORRECOES = 2
REF_LLM = "voz/llm-fluxo"
RECADO = "Peço que {{primeiro_nome}} retorne a ligação para a {{assessoria}}. Obrigada."
RE_OFERTA_FIXA = re.compile(r"r\$\s*\d|\d+\s*(x|vezes|parcelas?)\b|\d+\s*%|\d+[.,]\d{2}\b")
FINALIDADE_DO_BLOCO = {"identidade": ("validar_cadastro",), "oferta": ("buscar_ofertas",),
                       "registrar": ("registrar_acordo", "gerar_boleto", "gerar_link")}

ESQUEMA_TEXTO = """Esquema (esquema 1, fechado; nada fora disto):
{"esquema": 1, "blocos": [{"id": "N1", "tipo": ..., "modo": ..., "x": 0, "y": 0, "titulo": "...", "params": {...},
  "saidas": [{"rotulo": "texto da tela", "para": "N2", "tipo": "normal|devolve|falha", "quando": "código"}]}]}
Tipos, modos, params e `quando` das saídas:
- abertura (arvore) {fala}; saídas titular, terceiro (terceiro vai para um Encerrar com resultado recado)
- identidade (arvore|cognicao, nunca generativo) {fala, pergunta: dia_mes_nascimento|ano_nascimento|ultimos3_documento,
  conector_id: id de um conector validar_cadastro ou null (a identidade só é conferida pelo CRM), tentativas 1..3}; saídas confirmou,
  nao_confirmou, falhou (tipo falha)
- pergunta (arvore) {fala, opcoes: [{codigo, rotulo, exemplos}], tentativas}; saídas = códigos das opções + sem_resposta
- intencao (cognicao) {fala, intencoes: [do catálogo], exemplos: {intencao: [frases]}, confianca_min 0.5..0.95,
  tentativas}; saídas = cada intenção + nao_entendido
- generativa (generativo) {objetivo (20+ caracteres), tom: [cordial|frases_curtas|sem_giria|nao_pressiona|formal],
  max_turnos 1..40, ferramentas: [apresentar_oferta|registrar_promessa|agendar_retorno|consultar_base|transferir_humano|
  encerrar_chamada] (transferir_humano sempre), contrapropostas_max 0..5}; saídas todas tipo devolve, quando = motivo
- oferta (arvore|cognicao) {fala, origem: conector|carteira, conector_id}; saídas aceitou, quer_outra, recusou
- retorno (arvore|cognicao) {fala, dias_max 1..7}; saídas agendou, nao_agendou
- conector (sistema) {conector_id, fala_espera}; saídas respondeu, falhou (tipo falha)
- registrar (sistema) {registra: acordo_crm|promessa_motorcx, conectores: [ids]}; saídas registrado, falhou (tipo falha)
- link (arvore) {fala, canal: whatsapp_sms|sms|whatsapp}; saídas enviado, falhou (tipo falha)
- condicao (sistema) {campo: ofertas_quantidade|identidade_confirmada|dias_atraso|saldo|tentativa_do_dia, op, valor}; saídas sim, nao
- transferir (arvore) {fala, motivo: cpc|pedido_humano|ofertas_sem_acordo|fora_alcada|contestacao}; sem saídas
- encerrar (arvore) {fala, resultado: promessa|retorno_agendado|recusa|recado|cpc|atendida_sem_cpc|identidade_confirmada}; sem saídas
Regras: até 60 blocos; fala até 500 caracteres; variáveis só {{nome}} da lista dada; valor, oferta ou credor só depois
de Confirmar identidade; nunca escreva valores, parcelas ou descontos na fala (use {{oferta.parcelas}} etc., que vêm do
CRM ou da alçada); nunca peça senha ou cartão; ciclos precisam de repetir_max no bloco."""


@dataclass
class Geracao:
    definicao: dict | None
    resultado: dict = field(default_factory=dict)
    tokens: int = 0                                   # tokens do LLM em todas as tentativas (custo real, SQL 61)


def _ferramenta() -> list[dict]:
    return [{"type": "function", "function": {
        "name": "entregar_fluxo", "description": "Entrega o fluxo no esquema fechado e o que foi entendido.",
        "parameters": {"type": "object", "additionalProperties": False,
                       "required": ["definicao", "entendi", "suposicoes", "perguntas"], "properties": {
                           "definicao": {"type": "object"},
                           "entendi": {"type": "array", "items": {"type": "object", "properties": {
                               "frase": {"type": "string"}, "bloco": {"type": "string"}}}},
                           "suposicoes": {"type": "array", "items": {"type": "string"}},
                           "perguntas": {"type": "array", "items": {"type": "string"}}}}}}]


def _mensagens(ctx: dict) -> list[dict]:
    cons = "\n".join(f"- {c['id']}: {c['nome']} ({c['finalidade']}; preenche {', '.join(c.get('campos') or []) or '-'})"
                     for c in ctx.get("conectores") or []) or "- nenhum (use null; a empresa escolhe depois)"
    sistema = (f"Você monta fluxos do agente de voz de cobrança do MotorCX, em português do Brasil.\n{ESQUEMA_TEXTO}\n"
               f"Conectores da empresa (só estes, pelo id):\n{cons}\n"
               f"Intenções do catálogo (só estas): {', '.join(ctx.get('intencoes') or [])}\n"
               f"Variáveis: {', '.join(ctx.get('variaveis') or [])}\n"
               f"Alçada da carteira cadastrada: {'sim' if ctx.get('tem_alcada') else 'não (não use bloco Oferta)'}\n"
               "Responda só com a ferramenta entregar_fluxo. Em `entendi`, cada frase do pedido e o bloco que a atende. "
               "Em `suposicoes`, o que você supôs; em `perguntas`, o que precisa da empresa.")
    usuario = f"Pedido da empresa:\n{ctx['texto']}"
    if ctx.get("origem"):
        usuario += f"\n\nMude este fluxo existente (mantenha os ids dos blocos que não mudam):\n{json.dumps(ctx['origem'], ensure_ascii=False)}"
    if ctx.get("respostas"):
        usuario += f"\n\nRespostas da empresa às perguntas anteriores:\n{json.dumps(ctx['respostas'], ensure_ascii=False)}"
    return [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]


# ------------------------------------------------------------------ travas que sempre entram
def _proximo_id(d: dict) -> str:
    usados = {int(b["id"][1:]) for b in d["blocos"] if isinstance(b, dict) and re.fullmatch(r"N\d{1,3}", str(b.get("id")))}
    return f"N{max(usados | {0}) + 1}"


def aplicar_travas(d, ctx: dict) -> tuple[object, list[str]]:
    """Normaliza o que nunca depende do LLM. Devolve (definição, suposições acrescentadas)."""
    if not isinstance(d, dict) or not isinstance(d.get("blocos"), list):
        return d, []
    d = copy.deepcopy(d)
    sup: list[str] = []
    cons = {int(c["id"]): c["finalidade"] for c in ctx.get("conectores") or [] if str(c.get("id", "")).isdigit()}
    blocos = [b for b in d["blocos"] if isinstance(b, dict)]
    por_id = {b.get("id"): b for b in blocos}
    for b in blocos:
        p = b.get("params") if isinstance(b.get("params"), dict) else None
        if p is None:
            continue
        t = b.get("tipo")
        if t == "identidade":
            if b.get("modo") not in ("arvore", "cognicao"):
                b["modo"] = "cognicao"                       # nunca generativo
            p.pop("confere", None)                         # só o CRM confere
        if t == "generativa":
            fe = [f for f in (p.get("ferramentas") or []) if f in FV.FERRAMENTAS]
            if "transferir_humano" not in fe:
                fe.append("transferir_humano")
            p["ferramentas"] = list(dict.fromkeys(fe))
        if t == "encerrar" and p.get("resultado") == "recado":
            p["fala"] = RECADO                              # recado neutro fixo
        # conector que a empresa não tem (ou de outra finalidade) vira "a escolher"
        for chave in ("conector_id",):
            cid = p.get(chave)
            if cid is not None and (not isinstance(cid, int) or cid not in cons
                                    or (t in FINALIDADE_DO_BLOCO and cons[cid] not in FINALIDADE_DO_BLOCO[t])):
                p[chave] = None
                sup.append(f"{b.get('id')}: o conector {cid} não existe para esta finalidade; escolha um antes de aprovar.")
        if isinstance(p.get("conectores"), list):
            novos = []
            for cid in p["conectores"]:
                if cid is not None and (not isinstance(cid, int) or cid not in cons):
                    sup.append(f"{b.get('id')}: o conector {cid} não existe; escolha um antes de aprovar.")
                    cid = None
                novos.append(cid)
            p["conectores"] = novos[:2]
    # terceiro sempre vai para um Encerrar com recado neutro
    for ab in [b for b in blocos if b.get("tipo") == "abertura"]:
        for s in ab.get("saidas") or []:
            if isinstance(s, dict) and s.get("quando") == "terceiro":
                alvo = por_id.get(s.get("para"))
                if not (alvo and alvo.get("tipo") == "encerrar" and (alvo.get("params") or {}).get("resultado") == "recado"):
                    nid = _proximo_id(d)
                    d["blocos"].append({"id": nid, "tipo": "encerrar", "modo": "arvore", "titulo": "Encerrar · recado neutro",
                                        "params": {"fala": RECADO, "resultado": "recado"}, "saidas": []})
                    s["para"] = nid
                    por_id[nid] = d["blocos"][-1]
    return d, sup


def erros_geracao(d, ctx: dict) -> list[str]:
    """Validador + o que a geração não pode fazer: intenção fora do catálogo e oferta escrita à mão na fala."""
    out = FV.erros(d)
    if out:
        return out
    cat = set(ctx.get("intencoes") or [])
    for b in d["blocos"]:
        if b["tipo"] == "intencao" and any(i not in cat for i in b["params"]["intencoes"]):
            out.append(f"intencao_fora_catalogo:{b['id']}")
        for campo, txt in FV.textos_do_bloco(b):
            if campo != "objetivo" and RE_OFERTA_FIXA.search(FV.trocar_variaveis(txt.lower(), lambda _: "")):
                out.append(f"oferta_escrita_na_fala:{b['id']}")
        if b["tipo"] == "oferta" and not ctx.get("tem_alcada"):
            out.append(f"oferta_sem_alcada:{b['id']}")
    return sorted(set(out))


def mudancas(origem: dict | None, nova: dict) -> list[str]:
    """O que mudou em relação à versão de origem (por bloco)."""
    if not origem:
        return []
    a = {b["id"]: b for b in origem.get("blocos") or []}
    n = {b["id"]: b for b in nova.get("blocos") or []}
    out = []
    for i in sorted(set(a) | set(n), key=lambda x: int(x[1:])):
        if i not in a:
            out.append(f"{i}: bloco novo ({n[i]['tipo']})")
        elif i not in n:
            out.append(f"{i}: bloco removido ({a[i]['tipo']})")
        else:
            partes = [k for k in ("tipo", "modo", "params", "saidas", "repetir_max") if a[i].get(k) != n[i].get(k)]
            if partes:
                out.append(f"{i}: mudou {', '.join(partes)}")
    return out


def _texto_lista(v, maximo=40) -> list:
    return [str(x)[:300] for x in (v or []) if isinstance(x, (str, int, float))][:maximo]


def gerar_fluxo_voz(ctx: dict, modelo, max_correcoes: int = MAX_CORRECOES) -> Geracao:
    msgs = _mensagens(ctx)
    entendi, suposicoes, perguntas, erros = [], [], [], ["sem_resposta_do_llm"]
    d = None
    tokens = 0
    for tentativa in range(max_correcoes + 1):
        try:
            r = modelo.responder(msgs, _ferramenta())
        except Exception as ex:   # noqa: BLE001
            log.warning("geração: LLM indisponível (%s)", ex.__class__.__name__)
            erros = ["llm_indisponivel"]
            break
        tokens += int(getattr(r, "tokens", 0) or 0)
        args = next((a for nome, a in r.chamadas if nome == "entregar_fluxo"), None)
        if not isinstance(args, dict):
            erros = ["resposta_fora_do_esquema"]
            msgs.append({"role": "user", "content": "Responda só com a ferramenta entregar_fluxo."})
            continue
        d, extra = aplicar_travas(args.get("definicao"), ctx)
        entendi = [{"frase": str(e.get("frase", ""))[:300], "bloco": str(e.get("bloco", ""))[:4]}
                   for e in (args.get("entendi") or []) if isinstance(e, dict)][:60]
        suposicoes = _texto_lista(args.get("suposicoes")) + extra
        perguntas = _texto_lista(args.get("perguntas"))
        erros = erros_geracao(d, ctx)
        if not erros:
            return Geracao(d, {"entendi": entendi, "suposicoes": suposicoes, "perguntas": perguntas,
                               "mudancas": mudancas(ctx.get("origem"), d), "erros": [], "tentativas": tentativa}, tokens)
        if tentativa < max_correcoes:
            msgs.append({"role": "assistant", "content": json.dumps(args.get("definicao"), ensure_ascii=False)[:20000]})
            msgs.append({"role": "user", "content": "O validador recusou o fluxo com estes erros (código:bloco): "
                                                    + ", ".join(erros) + ". Corrija e entregue de novo."})
    return Geracao(None, {"entendi": entendi, "suposicoes": suposicoes, "perguntas": perguntas, "mudancas": [],
                          "erros": erros, "tentativas": max_correcoes}, tokens)


# ------------------------------------------------------------------ laço da VM
def processar_um(sb, modelo) -> bool:
    """Um pedido: pega, gera e devolve. Sem pedido na fila: False."""
    ctx = sb.rpc("pegar_pedido_fluxo_voz", {})
    if not ctx:
        return False
    try:
        g = gerar_fluxo_voz(ctx, modelo)
    except Exception as ex:   # noqa: BLE001
        log.warning("geração do pedido %s falhou (%s)", ctx.get("pedido"), ex.__class__.__name__)
        g = Geracao(None, {"erros": ["falha_na_geracao"], "tentativas": 0})
    args = {"pedido": ctx["pedido"], "definicao": g.definicao, "resultado": g.resultado}
    if g.tokens > 0:
        try:
            sb.rpc("registrar_geracao_fluxo_voz", {**args, "resultado": {**g.resultado, "tokens_ia": g.tokens}})
        except Exception as ex:   # noqa: BLE001 - banco sem o SQL 61 recusa a chave tokens_ia: grava sem o custo
            log.warning("pedido %s: tokens não aceitos pelo banco (%s); gravando sem eles", ctx.get("pedido"),
                        ex.__class__.__name__)
            sb.rpc("registrar_geracao_fluxo_voz", args)
    else:
        sb.rpc("registrar_geracao_fluxo_voz", args)
    log.info("pedido %s: %s", ctx.get("pedido"), "rascunho" if g.definicao else f"{len(g.resultado.get('erros', []))} erro(s)")
    return True


def limpar_anexos(sb) -> int:
    """Anexos guardados enquanto a versão gerada existir (decisão do dono): apaga do Storage o que o banco liberou
    (anexos_fluxo_vencidos) e marca o pedido. Falha num pedido não segura os outros."""
    n = 0
    for linha in sb.rpc("anexos_fluxo_vencidos", {}) or []:
        por_bucket: dict[str, list[str]] = {}
        for a in linha.get("anexos") or []:
            bucket, _, caminho = str(a).partition("/")
            if bucket in ("entradas", "chamados") and caminho:
                por_bucket.setdefault(bucket, []).append(caminho)
        try:
            for bucket, caminhos in por_bucket.items():
                sb.apagar_arquivos(bucket, caminhos)
            sb.rpc("marcar_anexos_apagados", {"pedido": linha["pedido_id"]})
            n += 1
        except Exception as ex:   # noqa: BLE001
            log.warning("anexos do pedido %s: falha ao apagar (%s)", linha.get("pedido_id"), ex.__class__.__name__)
    return n


def main(argv=None) -> int:   # pragma: no cover - serviço
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--uma-vez", action="store_true")
    ap.add_argument("--intervalo", type=float, default=15)
    ap.add_argument("--base-url", default="https://api.openai.com/v1")
    ap.add_argument("--modelo", default="gpt-4.1")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    from voz.configuracao import supabase_do_ambiente
    from voz.provedores.montagem import ModeloOpenAICompat
    from voz.segredos import SecretManager
    sb = supabase_do_ambiente()
    modelo = ModeloOpenAICompat(a.base_url, SecretManager().valor(REF_LLM), a.modelo, timeout=60)
    while True:
        while processar_um(sb, modelo):
            pass
        limpar_anexos(sb)
        if a.uma_vez:
            return 0
        time.sleep(a.intervalo)


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
