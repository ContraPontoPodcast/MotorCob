"""Geração do rascunho do fluxo a partir do texto do cliente (pedido do dono, SQL 58 · voz_fluxo_pedidos).

Roda na VM (mais simples que uma Edge Function: usa o mesmo validador em Python, voz/fluxo_validador.py, e o mesmo
cliente de LLM da Montagem). Laço: pega o próximo pedido (pegar_pedido_fluxo_voz), gera, valida e devolve
(registrar_geracao_fluxo_voz). O banco valida de novo e só cria o rascunho se passar: saída inválida nunca vira
rascunho, e nada é aprovado nem colocado em uso por aqui.

gerar_fluxo_voz(contexto, modelo):
  1. pede ao LLM a definição no esquema fechado (ferramenta entregar_fluxo), só com os conectores, intenções e
     variáveis que a empresa tem;
  2. aplica os REPAROS de forma que não mudam o sentido (título cortado em 60, repetir_max entre 1 e 5, chaves
     fora do esquema saem, tipo e rótulo da saída deduzidos, `quando` repetido sai, final sem saídas, falhou /
     sem_resposta / nao_entendido obrigatórios vão para um Transferir · atendente comum, bloco que nenhum caminho
     alcança sai; cada mudança relevante vira suposição) e as TRAVAS que sempre entram (independem do que o LLM
     escreveu): terceiro → Encerrar com recado neutro fixo; Confirmar identidade nunca generativa;
     transferir_humano em todo Generativo; ferramentas fora da lista saem; conector que a empresa não tem vira
     "a escolher" (nunca inventado). Reparo nenhum mexe em fala, valor, variável ou ordem da identidade;
  3. valida (validador + catálogo + nada de oferta escrita à mão na fala) e, com erro, devolve ao LLM o que
     corrigir, bloco a bloco e em português (explicar_erros), até 2 vezes. Sobrou erro: devolve sem definição e
     com os erros (códigos, que o site traduz);
  4. devolve "o que entendi" (frase → bloco), "suposições e perguntas" (respondidas, geram de novo) e, para mudança
     num fluxo existente, o que mudou em relação à versão de origem.
Sem limite de pedidos (decisão do dono): cada geração aparece no extrato (item ia_geracao_fluxo, contado pelo banco
em registrar_geracao_fluxo_voz). Os tokens gastos vão em resultado.tokens_ia só para o custo real (SQL 61 · consumo_ia,
só o Master vê); o banco tira a chave antes de gravar o pedido e o cliente paga sempre o preço por geração.
Anexos: apagados do Storage quando a versão gerada deixa de existir (limpar_anexos).
A chave do LLM fica no Secret Manager (voz/llm-fluxo). Só biblioteca padrão.

Na VM: serviço motorcx-voz-gerar-fluxo (infra/asterisk/vm), `motorcx-voz-rodar gerar-fluxo`, desligado por padrão
(metadado motorcx-gerar-fluxo=1 liga). Funciona nos dois acessos da VM (voz/acesso.py): no acesso_proprio as RPCs viram
voz_vm.pegar_pedido_fluxo, registrar_geracao_fluxo, anexos_fluxo_vencidos e marcar_anexos_apagados, e o anexo sai
pelo bilhete 'apagar' da Edge Function voz-arquivos.
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
- oferta (arvore|cognicao) {fala, origem: conector|arquivo, conector_id}; saídas aceitou, quer_outra, recusou
- retorno (arvore|cognicao) {fala, dias_max 1..7}; saídas agendou, nao_agendou
- conector (sistema) {conector_id, fala_espera}; saídas respondeu, falhou (tipo falha)
- registrar (sistema) {registra: acordo_crm|promessa_motorcx, conectores: [ids]}; saídas registrado, falhou (tipo falha)
- link (arvore) {fala, canal: whatsapp_sms|sms|whatsapp}; saídas enviado, falhou (tipo falha)
- condicao (sistema) {campo: ofertas_quantidade|identidade_confirmada|dias_atraso|saldo|tentativa_do_dia, op, valor}; saídas sim, nao
- transferir (arvore) {fala, motivo: cpc|pedido_humano|ofertas_sem_acordo|fora_alcada|contestacao}; sem saídas
- encerrar (arvore) {fala, resultado: promessa|retorno_agendado|recusa|recado|cpc|atendida_sem_cpc|identidade_confirmada}; sem saídas
Regras: até 60 blocos; fala até 500 caracteres; variáveis só {{nome}} da lista dada; valor, oferta ou credor só depois
de Confirmar identidade; nunca escreva valores, parcelas ou descontos na fala (use {{oferta.parcelas}} etc., que vêm do
CRM ou da alçada); nunca peça senha ou cartão; ciclos precisam de repetir_max no bloco.
Forma (o validador recusa o resto):
- bloco só com as chaves id, tipo, modo, x, y, titulo, repetir_max, params, saidas; titulo até 60 caracteres;
  repetir_max inteiro de 1 a 5 (só em bloco de ciclo); params só com as chaves do tipo, listadas acima;
- saída só com rotulo, para, tipo, quando, as quatro sempre: rotulo 1 a 60 caracteres; para = id de um bloco que
  existe; tipo "falha" se e só se quando = "falhou"; tipo "devolve" se e só se o bloco é generativa; senão "normal";
- `quando` sem repetir no bloco e só os válidos do tipo; todas as saídas obrigatórias do tipo (as listadas acima;
  em retorno, agendou; em link, enviado; em oferta, aceitou e recusou; em identidade, falhou se tem conector);
- todo bloco alcançável a partir da abertura; transferir e encerrar com saidas []; uma abertura só."""

MAPEAMENTO_TEXTO = """Pedido em texto livre (prompt de persona, etapas numeradas, regras): NÃO faça um bloco por tópico.
Monte um fluxo compacto, em geral de 4 a 10 blocos:
- abertura: saudação breve com {{primeiro_nome}} e {{assessoria}}, sem valores nem credor; saídas titular e terceiro;
- identidade (sempre antes de qualquer valor, oferta ou {{credor}}); confirmou segue, nao_confirmou encerra/transfere;
- UMA generativa para entendimento, negociação, objeções, contrapropostas e fechamento: objetivo com a persona, as
  etapas e as regras do pedido (sem números), tom do texto (cordial, frases_curtas, nao_pressiona...), ferramentas
  apresentar_oferta, registrar_promessa, agendar_retorno, transferir_humano, encerrar_chamada, contrapropostas_max
  do texto (padrão 2); saídas devolve como fechou_acordo, sem_acordo, retorno, contestou;
- finais: encerrar (promessa, retorno_agendado, recusa) e transferir; contestação da dívida → transferir motivo
  contestacao; pedido de humano ou falha → um Transferir · atendente (motivo pedido_humano) comum.
Valores fixos do pedido (R$, parcelas, entrada, %) NUNCA vão na fala nem no objetivo: as ofertas vêm só da API do
credor (conector buscar_ofertas) ou do arquivo do dia, por {{oferta.*}} e apresentar_oferta; o agente não calcula nem
negocia. Liste-os numa pergunta ("Mandar estas ofertas pelo arquivo ou pela API? R$ ...") e registre em suposicoes.
"Pedir o primeiro nome": o sistema já tem {{primeiro_nome}} e a identidade é confirmada pelo bloco identidade;
diga isso em suposicoes. "Simulação"/"valor fictício": em ligação real as ofertas são as reais; testes vão no
simulador do fluxo; diga isso em suposicoes."""


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
               f"{MAPEAMENTO_TEXTO}\n"
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


# ------------------------------------------------------------------ reparos de forma e travas que sempre entram
# saídas obrigatórias que o reparo liga a um Transferir · atendente comum (caminho seguro). Opção de pergunta,
# intenção e as outras obrigatórias (confirmou, titular, aceitou...) nunca são inventadas: ficam para o LLM.
QUANDOS_SEGUROS = ("falhou", "sem_resposta", "nao_entendido")
FALA_ATENDENTE = "Vou passar você para um atendente agora, só um instante."
# params inteiros com faixa: valor fora da faixa vai para a ponta mais próxima
FAIXAS = {"tentativas": (1, 3), "max_turnos": (1, FV.MAX_TURNOS_GLOBAL), "contrapropostas_max": (0, 5),
          "dias_max": (1, 7)}


def _proximo_id(d: dict, removidos=()) -> str:
    """Próximo id livre; os removidos pelo reparo não voltam (a suposição que os cita continua certa)."""
    ids = [b.get("id") for b in d["blocos"] if isinstance(b, dict)] + list(removidos)
    usados = {int(i[1:]) for i in ids if re.fullmatch(r"N\d{1,3}", str(i))}
    return f"N{max(usados | {0}) + 1}"


def _id_ok(v) -> bool:
    return isinstance(v, str) and FV.RE_ID.fullmatch(v) is not None


def _inteiro(v) -> int | None:
    """3, 3.0 ou "3" → 3; o resto → None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if v == v and abs(v) < 1e9 else None
    if isinstance(v, str) and re.fullmatch(r"\s*-?\d{1,9}(\.0*)?\s*", v):
        return int(float(v))
    return None


def _como_codigo(v) -> str | None:
    """"Não entendido" → "nao_entendido"; None se não vira código."""
    if not isinstance(v, str):
        return None
    c = re.sub(r"[^a-z0-9_]+", "_", v.strip().lower().translate(FV._ACENTOS)).strip("_")
    return c if FV.RE_CODIGO.fullmatch(c) else None


def _rotulo_de(quando: str) -> str:
    return quando.replace("_", " ").capitalize()[:60]


def _reparar_bloco(b: dict, sup: list[str]) -> None:
    """Forma do bloco (chaves, título, repetir_max, x/y, modo, params fora do esquema e inteiros fora da faixa)."""
    bid, tipo = b["id"], b["tipo"]
    for k in [k for k in b if k not in FV.CHAVES_BLOCO]:
        b.pop(k)
    if "titulo" in b:
        t = b["titulo"].strip() if isinstance(b["titulo"], str) else ""
        if t:
            b["titulo"] = t[:60].rstrip()
        else:
            b.pop("titulo")
    if "repetir_max" in b:
        n = _inteiro(b["repetir_max"])
        if n is None:
            b.pop("repetir_max")
        else:
            if not 1 <= n <= 5:
                sup.append(f"{bid}: repetir_max {n} ajustado para {min(max(n, 1), 5)} (o limite é de 1 a 5).")
            b["repetir_max"] = min(max(n, 1), 5)
    for k in ("x", "y"):
        if k in b and not FV._numero(b[k]):
            b.pop(k)                                         # o site organiza o quadro por ramos; posição é opcional
    modos = FV.TIPOS[tipo][0]
    if b.get("modo") not in modos:
        novo = "cognicao" if "cognicao" in modos else modos[0]
        if len(modos) > 1 and tipo != "identidade" and b.get("modo") is not None:
            sup.append(f"{bid}: modo {b.get('modo')} não vale para {tipo}; ficou {novo}.")
        b["modo"] = novo                                     # identidade nunca generativa: vira cognicao
    p = b.get("params")
    if not isinstance(p, dict):
        return
    for k in [k for k in p if k not in FV.CHAVES_PARAMS[tipo]]:
        p.pop(k)
    for k, (de, ate) in FAIXAS.items():
        if k in p:
            n = _inteiro(p[k])
            if n is None:
                p.pop(k)
            else:
                p[k] = min(max(n, de), ate)


def _reparar_saidas(b: dict, ids: set[str], sup: list[str]) -> None:
    """Saídas no esquema: tipo deduzido (falha se e só se falhou; devolve se e só se generativa), rótulo a partir do
    `quando` quando falta (ou cortado em 60), `quando` repetido sai (fica o primeiro), saída com `quando` que não
    vale para o tipo ou destino inexistente sai; final (transferir/encerrar) sem saídas."""
    bid, tipo = b["id"], b["tipo"]
    sa = b.get("saidas")
    if FV.TIPOS[tipo][1]:
        if sa:
            sup.append(f"{bid}: {tipo} encerra a ligação; as saídas dele foram removidas.")
        b["saidas"] = []
        return
    validos, _ = FV._quandos(b)
    # com opções/intenções malformadas a lista de válidos não é confiável: o LLM corrige os params e nada sai
    tmp: list[str] = []
    FV._params(b, tmp)
    confia = tipo not in ("pergunta", "intencao") or not any(e.startswith("params_invalidos") for e in tmp)
    novas, vistos, fora = [], set(), []
    for s in sa if isinstance(sa, list) else []:
        if not isinstance(s, dict):
            continue
        q = s.get("quando") if FV._codigo(s.get("quando")) else _como_codigo(s.get("quando"))
        if (q is None or (tipo != "generativa" and confia and q not in validos) or not _id_ok(s.get("para"))
                or s["para"] not in ids):
            fora.append(str(s.get("quando") or s.get("rotulo") or "?")[:40])
            continue
        if q in vistos:
            continue
        vistos.add(q)
        rot = s.get("rotulo").strip() if isinstance(s.get("rotulo"), str) else ""
        novas.append({"rotulo": rot[:60].rstrip() if rot else _rotulo_de(q), "para": s["para"],
                      "tipo": "devolve" if tipo == "generativa" else ("falha" if q == "falhou" else "normal"),
                      "quando": q})
    if fora:
        sup.append(f"{bid}: saída(s) {', '.join(fora)} removida(s) (caso que não existe para {tipo} "
                   "ou destino que não existe).")
    b["saidas"] = novas


def _bloco_atendente(d: dict, blocos: list[dict], removidos=()) -> dict:
    """O Transferir · atendente comum (motivo pedido_humano): reaproveita o que já existe ou cria um."""
    for b in blocos:
        p = b.get("params") if isinstance(b.get("params"), dict) else {}
        if b["tipo"] == "transferir" and p.get("motivo") == "pedido_humano":
            return b
    novo = {"id": _proximo_id(d, removidos), "tipo": "transferir", "modo": "arvore",
            "titulo": "Transferir · atendente", "params": {"fala": FALA_ATENDENTE, "motivo": "pedido_humano"},
            "saidas": []}
    d["blocos"].append(novo)
    blocos.append(novo)
    return novo


def _bloco_recado(d: dict, blocos: list[dict]) -> dict:
    for b in blocos:
        if b["tipo"] == "encerrar" and isinstance(b.get("params"), dict) and b["params"].get("resultado") == "recado":
            return b
    novo = {"id": _proximo_id(d), "tipo": "encerrar", "modo": "arvore", "titulo": "Encerrar · recado neutro",
            "params": {"fala": RECADO, "resultado": "recado"}, "saidas": []}
    d["blocos"].append(novo)
    blocos.append(novo)
    return novo


def aplicar_travas(d, ctx: dict) -> tuple[object, list[str]]:
    """Reparos de forma que não mudam o sentido + travas que nunca dependem do LLM.
    Devolve (definição, suposições acrescentadas). Não toca em fala, objetivo, variável nem na ordem da identidade:
    o que o validador recusa por segurança continua recusado."""
    if not isinstance(d, dict) or not isinstance(d.get("blocos"), list):
        return d, []
    d = {"esquema": FV.ESQUEMA, "blocos": [b for b in copy.deepcopy(d["blocos"]) if isinstance(b, dict)]}
    sup: list[str] = []
    cons = {int(c["id"]): c["finalidade"] for c in ctx.get("conectores") or [] if str(c.get("id", "")).isdigit()}
    # só os blocos com id e tipo válidos são reparados; o resto o validador aponta (e o LLM corrige)
    blocos = [b for b in d["blocos"]
              if _id_ok(b.get("id")) and isinstance(b.get("tipo"), str) and b["tipo"] in FV.TIPOS]
    for b in blocos:
        _reparar_bloco(b, sup)
    por_id = {b["id"]: b for b in blocos}
    for b in blocos:
        p = b.get("params") if isinstance(b.get("params"), dict) else None
        if p is None:
            continue
        t = b["tipo"]
        if t == "identidade":
            p.pop("confere", None)                         # só o CRM confere
        if t == "generativa":
            fe = [f for f in (p["ferramentas"] if isinstance(p.get("ferramentas"), list) else [])
                  if isinstance(f, str) and f in FV.FERRAMENTAS]
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
                sup.append(f"{b['id']}: o conector {cid} não existe para esta finalidade; escolha um antes de aprovar.")
        if isinstance(p.get("conectores"), list):
            novos = []
            for cid in p["conectores"]:
                if cid is not None and (not isinstance(cid, int) or cid not in cons):
                    sup.append(f"{b['id']}: o conector {cid} não existe; escolha um antes de aprovar.")
                    cid = None
                novos.append(cid)
            p["conectores"] = novos[:2]
    # saídas (depois dos conectores: identidade sem conector não exige falhou)
    for b in blocos:
        _reparar_saidas(b, set(por_id), sup)
    # terceiro sempre vai para um Encerrar com recado neutro (e a abertura sempre tem a saída terceiro)
    for ab in [b for b in blocos if b["tipo"] == "abertura"]:
        terc = [s for s in ab["saidas"] if s["quando"] == "terceiro"]
        if not terc:
            ab["saidas"].append({"rotulo": "Não é a pessoa", "para": _bloco_recado(d, blocos)["id"], "tipo": "normal",
                                 "quando": "terceiro"})
            sup.append(f"{ab['id']}: quem atende e não é a pessoa recebe o recado neutro e a ligação encerra.")
        for s in terc:
            alvo = por_id.get(s["para"])
            prm = alvo.get("params") if alvo and isinstance(alvo.get("params"), dict) else {}
            if not (alvo and alvo["tipo"] == "encerrar" and prm.get("resultado") == "recado"):
                nid = _proximo_id(d)
                novo = {"id": nid, "tipo": "encerrar", "modo": "arvore", "titulo": "Encerrar · recado neutro",
                        "params": {"fala": RECADO, "resultado": "recado"}, "saidas": []}
                d["blocos"].append(novo)
                blocos.append(novo)
                s["para"] = nid
        por_id = {b["id"]: b for b in blocos}
    # o que nenhum caminho alcança a partir da abertura sai (só com uma abertura que tem a saída titular). Antes de
    # ligar as falhas: um Transferir · atendente sem caminho até ele sai aqui e é criado de novo, se preciso
    aberturas, removidos = [b for b in blocos if b["tipo"] == "abertura"], []
    if len(aberturas) == 1 and any(s["quando"] == "titular" for s in aberturas[0]["saidas"]):
        por_id = {b["id"]: b for b in blocos}
        alc, fila = {aberturas[0]["id"]}, [aberturas[0]["id"]]
        while fila:
            for s in por_id[fila.pop()]["saidas"]:
                if s["para"] in por_id and s["para"] not in alc:
                    alc.add(s["para"])
                    fila.append(s["para"])
        fica = [b for b in d["blocos"] if _id_ok(b.get("id")) and b["id"] in alc]
        removidos = [b.get("id") for b in d["blocos"] if not any(b is f for f in fica)]
        if removidos:
            d["blocos"] = fica
            blocos = [b for b in blocos if b["id"] in alc]
            sup.append("Blocos sem caminho a partir da abertura, removidos: "
                       + ", ".join(str(i)[:8] for i in removidos) + ".")
    # falhou / sem_resposta / nao_entendido obrigatórios e ausentes: Transferir · atendente
    ligados = []
    for b in list(blocos):
        if FV.TIPOS[b["tipo"]][1] or not isinstance(b.get("params"), dict):
            continue
        tem = {s["quando"] for s in b["saidas"]}
        for q in sorted((FV._quandos(b)[1] - tem) & set(QUANDOS_SEGUROS)):
            alvo = _bloco_atendente(d, blocos, removidos)
            b["saidas"].append({"rotulo": _rotulo_de(q), "para": alvo["id"],
                                "tipo": "falha" if q == "falhou" else "normal", "quando": q})
            ligados.append((b["id"], q))
    if ligados:
        sup.append(f"Sem caminho para falha ou silêncio em {', '.join(f'{i} ({q})' for i, q in ligados)}: "
                   "vai para Transferir · atendente.")
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


# ------------------------------------------------------------------ o que dizer ao LLM para corrigir
# trecho com valor escrito, para mostrar ao LLM (a regra de recusa continua sendo RE_OFERTA_FIXA)
RE_TRECHO_VALOR = re.compile(r"r\$\s*[\d.,]*\d|\d[\d.,]*\s*(?:x|vezes|parcelas?)\b|\d+\s*%|\d+[.,]\d{2}\b", re.I)
DICA_PARAMS = {
    "abertura": "fala obrigatória",
    "identidade": f"fala obrigatória; pergunta um de {', '.join(FV.PERGUNTAS_IDENTIDADE)}; tentativas 1 a 3",
    "pergunta": "fala obrigatória; opcoes 1 a 6, cada uma {codigo (minúsculas_com_sublinhado, nunca sem_resposta), "
                "rotulo até 60, exemplos opcionais}; tentativas 1 a 3",
    "intencao": "fala obrigatória; intencoes 1 a 12 do catálogo, sem nao_entendido; exemplos só das intenções; "
                "confianca_min 0.5 a 0.95; tentativas 1 a 3",
    "generativa": f"objetivo (20+ caracteres), max_turnos 1 a {FV.MAX_TURNOS_GLOBAL}, tom só {', '.join(FV.TONS)}, "
                  "contrapropostas_max 0 a 5; sem fala",
    "oferta": f"fala obrigatória; origem {' ou '.join(FV.ORIGENS_OFERTA)}",
    "retorno": "fala obrigatória; dias_max 1 a 7",
    "conector": "conector_id e fala_espera",
    "registrar": f"registra {' ou '.join(FV.REGISTROS)}; conectores até 2 ids",
    "link": f"fala obrigatória; canal um de {', '.join(FV.CANAIS_LINK)}",
    "condicao": f"campo um de {', '.join(FV.CAMPOS_CONDICAO)}; op um de {' '.join(FV.OPERADORES)}; valor número "
                "(identidade_confirmada: true/false com = ou <>)",
    "transferir": f"fala obrigatória; motivo um de {', '.join(FV.MOTIVOS_TRANSFERENCIA)}",
    "encerrar": f"fala obrigatória; resultado um de {', '.join(FV.RESULTADOS_ENCERRAR)}",
}


def _valor_escrito(b: dict) -> str | None:
    """O primeiro valor escrito à mão numa fala do bloco (ex.: "R$ 450"), ou None. Mesma regra de erros_geracao."""
    for campo, txt in FV.textos_do_bloco(b):
        if campo == "objetivo":
            continue
        limpo = FV.trocar_variaveis(txt, lambda _: "")
        if RE_OFERTA_FIXA.search(limpo.lower()):
            m = RE_TRECHO_VALOR.search(limpo)
            return (m.group(0) if m else limpo[:30]).strip()
    return None


def _uma_explicacao(cod: str, bid: str, b: dict | None, ctx: dict) -> str:
    tipo = b.get("tipo") if b else None
    nome = f"{bid} ({tipo})" if b and tipo in FV.TIPOS else bid
    p = b.get("params") if b and isinstance(b.get("params"), dict) else {}
    if cod == "esquema_invalido":
        return 'A definição é {"esquema": 1, "blocos": [...]} e nada mais.'
    if cod == "blocos_demais":
        return f"Mais de {FV.MAX_BLOCOS} blocos: junte as etapas de conversa numa generativa (fluxo de 4 a 10 blocos)."
    if cod == "id_invalido":
        return "Todo bloco precisa de id N1, N2... (N e até 3 dígitos)."
    if cod == "id_repetido":
        return f"{bid}: id repetido; cada bloco tem o seu."
    if cod == "tipo_invalido":
        return f"{bid}: tipo {tipo!r} não existe; use um de {', '.join(FV.TIPOS)}."
    if cod == "bloco_invalido":
        return (f"{nome}: bloco fora do esquema; chaves só {', '.join(FV.CHAVES_BLOCO)}; modo, params e saidas "
                "obrigatórios; titulo até 60 caracteres; repetir_max inteiro de 1 a 5.")
    if cod in ("modo_incompativel", "identidade_generativa"):
        return f"{nome}: modo precisa ser {' ou '.join(FV.TIPOS[tipo][0])}."
    if cod == "params_invalidos":
        return (f"{nome}: params inválidos; chaves permitidas {', '.join(FV.CHAVES_PARAMS.get(tipo, ()))}; "
                f"{DICA_PARAMS.get(tipo, '')}.")
    if cod == "fala_longa":
        return f"{nome}: fala com mais de {FV.FALA_MAX} caracteres; encurte."
    if cod == "generativo_sem_objetivo":
        return f"{nome}: objetivo com pelo menos {FV.OBJETIVO_MIN} caracteres (sem valores escritos)."
    if cod == "generativo_sem_limite":
        return f"{nome}: max_turnos inteiro de 1 a {FV.MAX_TURNOS_GLOBAL}."
    if cod in ("ferramenta_invalida", "transferir_humano_desligado"):
        return f"{nome}: ferramentas só {', '.join(FV.FERRAMENTAS)}, sem repetir e sempre com transferir_humano."
    if cod == "variavel_invalida":
        ruins = sorted({v for _, t in FV.textos_do_bloco(b or {}) for v in FV.variaveis(t) if v not in FV.VARIAVEIS_FALA})
        return (f"{nome}: variável fora da lista ({', '.join('{{' + v + '}}' for v in ruins)}); use só "
                f"{', '.join(ctx.get('variaveis') or FV.VARIAVEIS_FALA)}.")
    if cod == "fala_pede_senha":
        return f"{nome}: o texto pede senha ou dados de cartão, o que é proibido; tire esse pedido."
    if cod in ("saida_faltando", "saida_invalida", "sem_saida", "saida_inexistente") and tipo == "generativa":
        return (f"{nome}: pelo menos uma saída; cada uma com rotulo (1 a 60), para (id que existe), tipo devolve e "
                "quando = motivo em minúsculas (ex.: fechou_acordo, sem_acordo, contestou), sem repetir e nunca falhou.")
    if cod in ("saida_faltando", "saida_invalida", "sem_saida") and tipo in FV.TIPOS:
        validos, obrig = FV._quandos(b)
        tem = {s.get("quando") for s in (b.get("saidas") or []) if isinstance(s, dict)}
        txt = f"{nome}: saídas obrigatórias {', '.join(sorted(obrig)) or '(nenhuma)'}"
        if obrig - tem:
            txt += f" (falta {', '.join(sorted(obrig - tem))})"
        txt += f"; válidas {', '.join(sorted(validos))}"
        if cod == "saida_invalida":
            txt += ("; cada saída com rotulo (1 a 60), para (id que existe), tipo e quando, sem repetir o quando; "
                    "tipo falha só com quando falhou, senão normal")
        return txt + "."
    if cod == "saida_inexistente":
        ids = sorted({str(s.get("para")) for s in (b.get("saidas") or []) if isinstance(s, dict)})
        return f"{nome}: saída para bloco que não existe (para: {', '.join(ids)}); aponte para um id do fluxo."
    if cod == "final_com_saida":
        return f"{nome}: transferir e encerrar não têm saídas (saidas: [])."
    if cod == "abertura_ausente":
        return "Falta o bloco abertura (um só, de onde o fluxo começa)."
    if cod == "abertura_repetida":
        return "Mais de uma abertura: deixe uma só."
    if cod == "inalcancavel":
        return f"{nome}: nenhum caminho chega aqui; ligue a partir de outro bloco ou remova."
    if cod == "terceiro_sem_recado":
        return "A saída terceiro da abertura vai para um encerrar com resultado recado."
    if cod == "valor_antes_identidade":
        return (f"{nome}: valor, oferta ou credor antes de Confirmar identidade; só depois da saída confirmou de um "
                "bloco identidade, em todos os caminhos.")
    if cod == "ciclo_sem_limite":
        return f"{nome}: ciclo sem limite; ponha repetir_max (1 a 5) num bloco do ciclo ou desfaça a volta."
    if cod == "intencao_fora_catalogo":
        fora = [i for i in (p.get("intencoes") or []) if i not in set(ctx.get("intencoes") or [])]
        return (f"{nome}: intenção fora do catálogo ({', '.join(map(str, fora))}); use só "
                f"{', '.join(ctx.get('intencoes') or [])}.")
    if cod == "oferta_escrita_na_fala":
        return (f"{nome}: fala com valor escrito ({_valor_escrito(b or {}) or 'valor'}); use {{{{oferta.*}}}} e deixe "
                "os valores como pergunta sobre a alçada.")
    if cod == "oferta_sem_alcada":
        return (f"{nome}: a carteira não tem alçada; não use bloco oferta (use conector buscar_ofertas e a generativa "
                "com apresentar_oferta).")
    return f"{bid}: {cod}" if bid else cod


def explicar_erros(erros: list[str], d, ctx: dict) -> list[str]:
    """Os erros (códigos do validador) em frases que dizem o que corrigir, bloco a bloco. Também aponta valor escrito
    na fala mesmo quando o validador parou antes (erros de forma), para o LLM corrigir tudo na mesma rodada."""
    blocos = [b for b in (d.get("blocos") if isinstance(d, dict) and isinstance(d.get("blocos"), list) else [])
              if isinstance(b, dict)]
    por_id = {b.get("id"): b for b in blocos if isinstance(b.get("id"), str)}
    todos = list(erros)
    for b in blocos:
        if isinstance(b.get("id"), str) and _valor_escrito(b) and f"oferta_escrita_na_fala:{b['id']}" not in todos:
            todos.append(f"oferta_escrita_na_fala:{b['id']}")

    def ordem(e):
        bid = e.partition(":")[2]
        return (int(bid[1:]) if FV.RE_ID.fullmatch(bid) else -1, e)
    out = []
    for e in sorted(dict.fromkeys(todos), key=ordem):
        cod, _, bid = e.partition(":")
        linha = _uma_explicacao(cod, bid, por_id.get(bid), ctx)
        if linha not in out:
            out.append(linha)
    return out


def mensagem_correcao(erros: list[str], d, ctx: dict, reparos: list[str]) -> str:
    txt = ("O validador recusou o fluxo. Corrija cada ponto e entregue o fluxo inteiro de novo pela ferramenta "
           "entregar_fluxo (mantenha o fluxo compacto):\n- " + "\n- ".join(explicar_erros(erros, d, ctx)))
    if reparos:
        txt += "\nO sistema já fez estes ajustes (pode mantê-los):\n- " + "\n- ".join(reparos)
    return txt + "\nCódigos: " + ", ".join(erros) + "."


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
            # o LLM vê o que ele mesmo entregou; os erros (e ids) são da versão reparada, e os reparos vão junto
            msgs.append({"role": "assistant", "content": json.dumps(args.get("definicao"), ensure_ascii=False)[:20000]})
            msgs.append({"role": "user", "content": mensagem_correcao(erros, d, ctx, extra)})
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


def rodar(sb, modelo, intervalo: float = 15, uma_vez: bool = False, esperar=time.sleep,
          rodadas: int | None = None, max_por_rodada: int = 50) -> dict:
    """O laço do serviço: esvazia a fila de pedidos (até max_por_rodada), apaga os anexos vencidos e espera.
    Erro do banco numa rodada não derruba o serviço (só a classe do erro vai para o log; nada do pedido): espera e
    tenta de novo. `rodadas` limita o laço (testes)."""
    cont = {"pedidos": 0, "anexos": 0, "falhas": 0}
    k = 0
    while rodadas is None or k < rodadas:
        k += 1
        try:
            n = 0
            while n < max_por_rodada and processar_um(sb, modelo):
                n += 1
            cont["pedidos"] += n
            cont["anexos"] += limpar_anexos(sb)
        except Exception as ex:   # noqa: BLE001
            cont["falhas"] += 1
            log.warning("rodada da geração falhou (%s); tenta de novo em %ss", ex.__class__.__name__, intervalo)
        if uma_vez:
            break
        esperar(intervalo)
    return cont


def main(argv=None) -> int:   # pragma: no cover - serviço
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--uma-vez", action="store_true")
    ap.add_argument("--intervalo", type=float, default=15)
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
    modelo = ModeloOpenAICompat(a.base_url, SecretManager().valor(REF_LLM), a.modelo, timeout=60)
    rodar(sb, modelo, a.intervalo, a.uma_vez)
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
