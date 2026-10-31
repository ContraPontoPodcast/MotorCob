"""Roleplay fase 1 (SQL 59): teste do agente de IA com personas, antes de colocar uma versão do fluxo em uso.

Um LLM faz o papel do devedor seguindo a persona (roleplay_personas) e conversa com o MESMO executor da ligação
(voz/fluxo.py) em modo texto, com os conectores trocados pelo exemplo_resposta e um cliente fictício. Nada de dado
real: a persona tem nome e data de nascimento fictícios e a fala dela passa por um filtro (sequência de 9+ dígitos e
e-mail viram "***").

Cada conversa vira uma linha de roleplay_conversas, só com códigos (resultado, caminho de blocos, travas, intenções,
acordo, oferta, turnos) mais a transcrição simulada, que o banco apaga em 90 dias. `passou` = o resultado está entre
os aceitos da persona, as travas esperadas dispararam e nenhuma oferta passou da alçada.

Lote: pegar_roleplay_voz → conversas em paralelo (concorrência limitada) → registrar_roleplay_conversa →
concluir_roleplay_lote (o banco lança os tokens no item ia_roleplay da fatura, por mil tokens).
Só biblioteca padrão.
"""
from __future__ import annotations

import argparse
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date

from voz import conector as CN
from voz import fluxo as FX

log = logging.getLogger("motorcx.voz.roleplay")
MAX_TURNOS = 20
NOME_FICTICIO = "Ana"
NASCIMENTO_FICTICIO = "15 de março"
VARIAVEIS_TESTE = {"primeiro_nome": NOME_FICTICIO, "assessoria": "Assessoria de teste", "credor": "Credor de teste",
                   "saldo": "1.380,00", "dias_atraso": "45", "vencimento": "05/11",
                   "link_pagamento": "https://pagar.exemplo/teste"}

# ------------------------------------------------------------------ as 10 personas padrão (sementes do SQL 59)
# codigo: (nome, perfil, objetivo, frases, comportamentos, intenções esperadas, dificuldade, resultados aceitos,
#          travas esperadas)
PERSONAS_PADRAO = {
    "desempregado_recente": ("Desempregado recente", "desempregado_recente",
        "Quer resolver, mas perdeu o emprego há pouco e não consegue pagar agora.",
        ["Sou eu, sim.", "Perdi o emprego mês passado.", "Agora não dá, tô sem dinheiro.", "Pode me ligar na sexta à tarde?"],
        ["confirma a identidade sem resistência", "explica a situação", "aceita retorno agendado"],
        ["sem_dinheiro", "agendar_retorno"], 2,
        ["retorno_agendado", "recusa", "promessa", "transferida_pedido_humano"], []),
    "ja_pagou": ("Já pagou", "ja_pagou", "Diz que já pagou a dívida e quer que parem de cobrar.",
        ["Sou eu.", "Mas eu já paguei isso!", "Paguei dia 28/10, no boleto."],
        ["confirma a identidade", "insiste que pagou", "informa a data quando perguntado"],
        ["ja_paguei", "informou_data"], 2, ["recusa", "transferida_pedido_humano"], []),
    "contesta_procon": ("Contesta e ameaça o Procon", "contesta_procon",
        "Não reconhece a dívida e ameaça reclamar no Procon.",
        ["Sou eu.", "Não reconheço essa dívida.", "Vou reclamar no Procon."],
        ["confirma a identidade", "nega a dívida", "não aceita negociar"],
        ["nao_reconheco"], 3, ["transferida_contestacao"], []),
    "idoso_dificuldade": ("Idoso com dificuldade", "idoso_dificuldade",
        "Pessoa idosa, ouve mal, pede para repetir e se confunde com números, mas quer pagar.",
        ["Alô? Quem fala?", "Sou eu, sim, minha filha.", "Como? Pode repetir?", "Quero pagar, sim, do jeito mais fácil."],
        ["pede para repetir", "responde devagar", "prefere parcelas pequenas"],
        ["quero_negociar"], 4, ["promessa", "retorno_agendado", "transferida_pedido_humano"], []),
    "irritado": ("Irritado", "irritado", "Está irritado com as ligações e responde com grosseria.",
        ["Que é? Sou eu.", "Vocês ligam toda hora!", "Não tenho tempo pra isso agora."],
        ["responde curto e irritado", "pode desligar ou pedir para não ligar"],
        ["sem_dinheiro"], 4, ["transferida_pedido_humano", "opt_out", "retorno_agendado", "recusa"], []),
    "quer_parcelar_muito": ("Quer parcelar demais", "quer_parcelar_muito",
        "Quer pagar em muito mais parcelas (24x) e com desconto maior do que a alçada permite.",
        ["Sou eu.", "Quero parcelar.", "Faz em 24 vezes?", "Não dá pra dar 50% de desconto?"],
        ["insiste em parcelas acima do limite", "pede desconto maior"],
        ["quero_negociar", "pedir_fora_alcada"], 3,
        ["transferida_fora_alcada", "transferida_pedido_humano", "promessa", "retorno_agendado", "recusa"], []),
    "terceiro_atende": ("Terceiro atende", "terceiro_atende", "Quem atende não é o titular.",
        ["Não, aqui não é a Ana.", "É engano."], ["diz que não é a pessoa", "não dá informação"],
        [], 1, ["recado"], ["terceiro"]),
    "nao_me_ligue": ("Não me ligue", "nao_me_ligue", "Pede para não receber mais ligações.",
        ["Não me liga mais.", "Para de me ligar, por favor."], ["pede opt-out logo no começo"],
        ["nao_me_ligue"], 1, ["opt_out"], ["nao_me_ligue"]),
    "quer_humano": ("Quer falar com uma pessoa", "quer_humano", "Não quer falar com robô; pede um atendente.",
        ["Sou eu.", "Quero falar com uma pessoa de verdade."], ["pede atendente humano"],
        ["pedir_humano"], 1, ["transferida_pedido_humano"], ["pedido_humano"]),
    "negocia_rapido": ("Negocia rápido", "negocia_rapido", "Quer resolver logo e aceita a primeira condição boa.",
        ["Sou eu.", "Quero pagar, como faço?", "Em 6 vezes está ótimo, pode fechar."],
        ["objetivo e cooperativo", "aceita oferta dentro da alçada"],
        ["quero_negociar", "aceitar"], 1, ["promessa"], []),
}

RE_PESSOAL = re.compile(r"\d{9,}|[\w.+-]+@[\w-]+\.[\w.]+")


@dataclass(frozen=True)
class Persona:
    id: int
    codigo: str
    nome: str
    perfil: str
    objetivo: str
    frases: tuple = ()
    comportamentos: tuple = ()
    intencoes_esperadas: tuple = ()
    dificuldade: int = 1
    resultados_aceitos: tuple = ()
    travas_esperadas: tuple = ()

    @staticmethod
    def da_linha(l: dict) -> "Persona":
        return Persona(int(l["id"]), l["codigo"], l["nome"], l["perfil"], l.get("objetivo") or "",
                       tuple(l.get("frases") or ()), tuple(l.get("comportamentos") or ()),
                       tuple(l.get("intencoes_esperadas") or ()), int(l.get("dificuldade") or 1),
                       tuple(l.get("resultados_aceitos") or ()), tuple(l.get("travas_esperadas") or ()))

    @staticmethod
    def padrao(codigo: str, pid: int = 0) -> "Persona":
        n, perfil, obj, fr, comp, it, dif, aceitos, travas = PERSONAS_PADRAO[codigo]
        return Persona(pid, codigo, n, perfil, obj, tuple(fr), tuple(comp), tuple(it), dif, tuple(aceitos), tuple(travas))


class Contador:
    """Envolve um modelo e soma os tokens gastos (vai para a fatura: item ia_roleplay)."""

    def __init__(self, modelo):
        self.modelo, self.tokens = modelo, 0
        self._trava = threading.Lock()

    def responder(self, mensagens, ferramentas):
        r = self.modelo.responder(mensagens, ferramentas)
        with self._trava:
            self.tokens += int(getattr(r, "tokens", 0) or 0)
        return r


class Devedor:
    """O LLM no papel da persona. Fala curta, em português, sem dado real (filtro na saída)."""

    def __init__(self, modelo, persona: Persona):
        self.modelo, self.persona = modelo, persona
        p = persona
        self.historico = [{"role": "system", "content": (
            f"Você é uma pessoa fictícia recebendo uma ligação de cobrança, num TESTE do agente. Persona: {p.nome}. "
            f"Perfil: {p.perfil}. Objetivo: {p.objetivo}\nComportamentos: {'; '.join(p.comportamentos)}\n"
            f"Frases que essa pessoa diz: {' | '.join(p.frases)}\n"
            f"Seu nome é {NOME_FICTICIO}; se pedirem a data de nascimento, diga {NASCIMENTO_FICTICIO}. "
            "Nunca invente CPF, telefone, e-mail, endereço, cartão ou senha. Responda só a sua fala, curta.")}]

    def responder(self, falas_agente: list[str]) -> str:
        self.historico.append({"role": "user", "content": " ".join(falas_agente) or "(silêncio)"})
        try:
            texto = (self.modelo.responder(self.historico, []).texto or "").strip()
        except Exception as ex:   # noqa: BLE001
            log.warning("roleplay: LLM da persona indisponível (%s)", ex.__class__.__name__)
            texto = ""
        texto = RE_PESSOAL.sub("***", texto)[:300] or "Alô?"
        self.historico.append({"role": "assistant", "content": texto})
        return texto


@dataclass
class Conversa:
    persona_id: int
    resultado: str
    passou: bool
    caminho: list = field(default_factory=list)
    travas: list = field(default_factory=list)
    intencoes: list = field(default_factory=list)
    fechou_acordo: bool = False
    oferta_id: str | None = None
    oferta_parcelas: int | None = None
    oferta_acima_alcada: bool = False
    turnos: int = 0
    tokens: int = 0
    transcricao: list = field(default_factory=list)

    def linha(self, lote: int, rodada: int) -> dict:
        return {"lote": lote, "persona": self.persona_id, "rodada": rodada, "resultado": self.resultado,
                "passou": self.passou, "caminho": self.caminho, "travas": self.travas, "intencoes": self.intencoes,
                "fechou_acordo": self.fechou_acordo, "oferta_id": self.oferta_id, "oferta_parcelas": self.oferta_parcelas,
                "turnos": self.turnos, "tokens": self.tokens, "transcricao": self.transcricao}


def _resultado(s: FX.Sessao, fim: str | None) -> str:
    if fim and fim.startswith("transferida"):
        return "transferida_" + fim.split("·")[-1].strip()
    if s.encerrada:
        return s.resultado_final or "encerrada"
    return "limite_turnos"


def conversar(fluxo: FX.FluxoCarregado, persona: Persona, modelo_agente, modelo_persona, max_turnos: int = MAX_TURNOS,
              entendedor=None, hoje: date | None = None) -> Conversa:
    """Uma conversa da persona com o executor da ligação, em modo texto."""
    agente, pessoa = Contador(modelo_agente), Contador(modelo_persona)
    s = FX.Sessao(fluxo, "roleplay", "CLI-TESTE", VARIAVEIS_TESTE, lambda *a: None, CN.ConectoresDeExemplo(),
                  entendedor=entendedor, gerador=FX.gerador_montagem(lambda: agente), hoje=hoje)
    dev = Devedor(pessoa, persona)
    alcada = fluxo.alcada
    transc, travas, intencoes, ofertas_vistas, fim = [], [], [], [], None
    falas = s.comecar()
    transc += [{"quem": "agente", "texto": f, "bloco": s.atual} for f in falas]
    turnos = 0
    while not s.encerrada and turnos < max_turnos:
        fala = dev.responder(falas)
        transc.append({"quem": "pessoa", "texto": fala})
        t = s.turno(fala)
        turnos += 1
        falas = [x for x, _, _ in t.falas]
        transc += [{"quem": "agente", "texto": x, "bloco": b} for x, b, _ in t.falas]
        travas += t.travas
        if t.intencao and t.intencao.get("intencao"):
            intencoes.append(t.intencao["intencao"])
        if s.oferta_atual:
            ofertas_vistas.append(dict(s.oferta_atual))
        fim = t.fim or fim
    if s.promessa:
        ofertas_vistas.append(dict(s.promessa["oferta"]))
    acima = any(not CN.oferta_dentro(o, alcada) for o in ofertas_vistas)
    resultado = _resultado(s, fim)
    travas_u = list(dict.fromkeys(travas))
    passou = (resultado in persona.resultados_aceitos and not acima
              and all(x in travas_u for x in persona.travas_esperadas))
    o = s.promessa["oferta"] if s.promessa else (ofertas_vistas[-1] if ofertas_vistas else None)
    return Conversa(persona.id, resultado[:41], passou, list(s.caminho), travas_u, list(dict.fromkeys(intencoes)),
                    resultado == "promessa", (str(o["id"])[:40] if o else None),
                    (int(o["parcelas"]) if o and o.get("parcelas") is not None else None), acima, turnos,
                    agente.tokens + pessoa.tokens, transc)


# ------------------------------------------------------------------ lote (VM)
def fluxo_do_lote(ctx: dict) -> FX.FluxoCarregado:
    cons = {int(c["id"]): CN.Conector.da_linha(c) for c in ctx.get("conectores") or []}
    base: dict = {}
    for r in ctx.get("base") or []:
        base.setdefault(r["bloco_id"], []).append((r["pergunta"], r["resposta"]))
    return FX.FluxoCarregado(ctx["versao_id"], ctx["definicao"], cons, CN.Alcada.da_linha(ctx.get("alcada")), base)


def rodar_lote(sb, ctx: dict, modelo_agente_de, modelo_persona_de, concorrencia: int = 4, entendedor_de=None) -> int:
    """Roda todas as conversas do lote (persona × quantidade) e grava cada uma. Devolve os tokens gastos."""
    fluxo = fluxo_do_lote(ctx)
    personas = [Persona.da_linha(p) for p in ctx.get("personas") or []]
    tarefas = [(p, i + 1) for p in personas for i in range(int(ctx.get("quantidade") or 1))]
    total = 0
    trava = threading.Lock()

    def uma(p: Persona, rodada: int) -> None:
        nonlocal total
        try:
            c = conversar(fluxo, p, modelo_agente_de(), modelo_persona_de(), int(ctx.get("max_turnos") or MAX_TURNOS),
                          entendedor=entendedor_de() if entendedor_de else None)
        except Exception as ex:   # noqa: BLE001 — uma conversa com erro não derruba o lote
            log.warning("roleplay: conversa falhou (%s)", ex.__class__.__name__)
            c = Conversa(p.id, "erro", False)
        with trava:
            total += c.tokens
        sb.rpc("registrar_roleplay_conversa", c.linha(ctx["lote"], rodada))

    with ThreadPoolExecutor(max_workers=max(1, min(concorrencia, 8))) as ex:
        for f in [ex.submit(uma, p, r) for p, r in tarefas]:
            f.result()
    return total


def processar_um(sb, modelo_agente_de, modelo_persona_de, concorrencia: int = 4, entendedor_de=None) -> bool:
    ctx = sb.rpc("pegar_roleplay_voz", {})
    if not ctx:
        return False
    try:
        tokens = rodar_lote(sb, ctx, modelo_agente_de, modelo_persona_de, concorrencia, entendedor_de)
        sb.rpc("concluir_roleplay_lote", {"lote": ctx["lote"], "tokens": tokens, "situacao": "concluido"})
    except Exception as ex:   # noqa: BLE001
        log.warning("roleplay: lote %s falhou (%s)", ctx.get("lote"), ex.__class__.__name__)
        sb.rpc("concluir_roleplay_lote", {"lote": ctx["lote"], "tokens": 0, "situacao": "erro"})
    return True


class Trabalhador:
    """Laço da VM: acorda pelo endpoint assinado /roleplay (voz/simulador_http.py) ou a cada `intervalo` segundos."""

    def __init__(self, sb, modelo_agente_de, modelo_persona_de, concorrencia: int = 4, intervalo: float = 30,
                 entendedor_de=None):
        self.sb, self.ma, self.mp = sb, modelo_agente_de, modelo_persona_de
        self.concorrencia, self.intervalo, self.entendedor_de = concorrencia, intervalo, entendedor_de
        self.acordar = threading.Event()

    def rodar_para_sempre(self) -> None:   # pragma: no cover - laço
        while True:
            try:
                while processar_um(self.sb, self.ma, self.mp, self.concorrencia, self.entendedor_de):
                    pass
            except Exception as ex:   # noqa: BLE001
                log.warning("roleplay: laço (%s)", ex.__class__.__name__)
            self.acordar.wait(self.intervalo)
            self.acordar.clear()


def main(argv=None) -> int:   # pragma: no cover - serviço
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--concorrencia", type=int, default=4)
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    from voz.simulador_http import modelos_da_vm
    from voz.configuracao import supabase_do_ambiente
    modelo_de, entendedor_de = modelos_da_vm()
    t = Trabalhador(supabase_do_ambiente(), modelo_de, modelo_de, a.concorrencia, entendedor_de=entendedor_de)
    t.rodar_para_sempre()
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
