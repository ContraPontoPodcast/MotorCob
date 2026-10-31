"""Executor do fluxo do agente de voz (SQL 58): anda pelo grafo de blocos nos modos árvore, cognição e generativo.

Uma `Sessao` por ligação. Mesma interface da Conversa da Montagem (comecar/ouvir/encerrada), então roda atrás do
Pipecat (voz) e em modo texto (simulador, `simular`). Cada fala da pessoa passa primeiro pelas TRAVAS, que ficam
aqui e não no prompt:
  1. valor, oferta ou credor só depois de Confirmar identidade (o validador já recusa o fluxo; aqui a fala que
     tiver variável sensível sem identidade confirmada é trocada pelo recado neutro);
  2. nunca pede senha nem cartão (fala do roteiro e do Generativo passam por filtro; a pessoa que oferecer ouve a
     fala fixa);
  3. "não me ligue" em qualquer etapa: opt-out e encerra (nenhum ramo segura);
  4. terceiro ouve só o recado neutro fixo;
  5. nunca passa da alçada (ofertas do CRM acima dela são descartadas, código oferta_acima_alcada);
  6. "quero falar com uma pessoa" transfere a qualquer momento;
  7. o Generativo só usa as ofertas recebidas (enum por chamada; número fora delas troca a frase).
A identidade é conferida só pelo CRM (conector Validar cadastro), nunca pela IA. A Cognição só classifica intenção (saída fechada) e a fala continua a do roteiro.

Eventos para o orquestrador (emitir(id_chamada, tipo, dados)):
  passo      um por bloco (voz_fluxo_passos: ordem, bloco_id, modo, saida_quando, intencao, confianca_faixa,
             motivo_devolucao, trava, turnos) — só códigos;
  conector   um por chamada a conector (crm_chamadas: só classe, status, tempo, tentativa e código);
  fluxo      no fim: {fluxo_versao_id, bloco_final};
  resultado / transferir / encerrar  como antes (voz/provedores/base.py).
A resposta do CRM fica em `memoria` e é apagada no fim (`descartar`).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from voz import conector as CN
from voz import fluxo_validador as FV

log = logging.getLogger("motorcx.voz.fluxo")

MAX_PASSOS = 200
_ACENTOS = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüç", "aaaaaeeeeiiiiooooouuuuc")
RECADO_NEUTRO = "Peço que {primeiro_nome} retorne a ligação para a {assessoria}. Obrigada."
FALA_OPT_OUT = "Entendido. Vou registrar agora e você não recebe mais ligações nossas sobre isso. Até logo."
FALA_HUMANO = "Claro, vou passar você para um atendente agora, só um instante."
FALA_SENHA = "Não precisa me passar senha nem número de cartão. O pagamento é sempre pelo link."
FALA_REPETIR = "Desculpe, pode repetir?"
FALA_FALHA = "Tive um problema aqui. Vou passar você para um atendente, só um instante."

RE_NAO_ME_LIGUE = re.compile(r"nao me lig|para de (me )?ligar|pare de (me )?ligar|nao quero mais (receber|ligac)|"
                             r"nao liguem mais|tira(r)? meu numero|nunca mais me lig")
RE_HUMANO = re.compile(r"atendente|humano|falar com (uma )?pessoa|falar com alguem|pessoa de verdade|"
                       r"quero um operador")
RE_SENHA = re.compile(r"senha|numero do cartao|codigo de seguranca|\bcvv\b")
RE_TITULAR = re.compile(r"^(sim|sou eu|e ela|e ele|pode falar|sou|isso|ela mesma|ele mesmo|eu mesm[oa]|pois nao|"
                        r"oi,? sou|e eu|falando)\b|sou eu|ele mesmo|ela mesma|eu mesm[oa]")
RE_TERCEIRO = re.compile(r"\bnao\b|engano|nao conheco|nao mora|numero errado|nao e (ele|ela|aqui)|nao tem ningu")
MESES = {"jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6, "jul": 7, "ago": 8, "set": 9, "out": 10,
         "nov": 11, "dez": 12}
DIAS_SEMANA = {"segunda": 0, "terca": 1, "quarta": 2, "quinta": 3, "sexta": 4, "sabado": 5, "domingo": 6}

# sinônimos do catálogo de intenções (Cognição por regras; o LLM, quando ligado, decide antes)
SINONIMOS = {
    "quero_negociar": r"parcel|negoci|acordo|desconto|quero pagar|como pago|condic|resolver|quitar",
    "ja_paguei": r"ja paguei|paguei|ja quitei|ja pago",
    "nao_reconheco": r"nao reconhe|nao conheco (essa|esta|a) divida|nao devo|nao fiz|procon|contest|nao e minha",
    "sem_dinheiro": r"sem dinheiro|desempreg|nao tenho|agora nao|apertad|nao da\b|nao posso",
    "pedir_humano": RE_HUMANO.pattern,
    "nao_me_ligue": RE_NAO_ME_LIGUE.pattern,
    "pedir_fora_alcada": r"mais parcelas|parcela menor|mais desconto|desconto maior|metade|\b(1[0-9]|[2-9][0-9])\s*(x|vezes)",
    "escolher_oferta": r"\b\d{1,2}\s*(x|vezes|parcelas)\b|a vista|primeira|segunda",
    "aceitar": r"^(sim|pode|fechado|aceito|ok|isso|combinado|pode registrar|pode fechar)\b|aceito|pode fechar|fechado|fechar",
    "recusar": r"nao quero|nao aceito|recuso|agora nao",
    "quer_outra_condicao": r"outra|mais parcelas|parcela menor|menos|mais desconto",
    "informou_data": r"\d{1,2}\s*(/|de)\s*(\d{1,2}|[a-z]{3})|amanha|segunda|terca|quarta|quinta|sexta|sabado|dia \d{1,2}",
    "nao_lembra": r"nao lembro|nao sei|esqueci",
    "agendar_retorno": r"liga (depois|outro dia|amanha)|me liga|retorn",
}


def normal(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").lower().translate(_ACENTOS)).strip()


# ------------------------------------------------------------------ entidades (sempre por regra, nunca pela IA)
def extrair_data(t: str, hoje: date) -> date | None:
    t = normal(t)
    m = re.search(r"\b(\d{1,2})\s*(?:/|de)\s*(\d{1,2}|[a-z]{3,})", t)
    if m:
        dia = int(m.group(1))
        mes = int(m.group(2)) if m.group(2).isdigit() else MESES.get(m.group(2)[:3])
        if mes and 1 <= mes <= 12 and 1 <= dia <= 31:
            try:
                d = date(hoje.year, mes, dia)
            except ValueError:
                return None
            return d
    if "amanha" in t:
        return hoje + timedelta(days=1)
    for nome, wd in DIAS_SEMANA.items():
        if nome in t:
            return hoje + timedelta(days=(wd - hoje.weekday()) % 7 or 7)
    m = re.search(r"\bdia (\d{1,2})\b", t)
    if m and 1 <= int(m.group(1)) <= 31:
        d = int(m.group(1))
        mes, ano = (hoje.month, hoje.year) if d >= hoje.day else ((hoje.month % 12) + 1, hoje.year + (hoje.month == 12))
        try:
            return date(ano, mes, d)
        except ValueError:
            return None
    return None


def extrair_hora(t: str) -> tuple[int, int] | None:
    t = normal(t)
    m = re.search(r"\b(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?", t)
    if m and 0 <= int(m.group(1)) <= 23:
        return int(m.group(1)), int(m.group(2) or 0)
    if "manha" in t:
        return 10, 0
    if "tarde" in t:
        return 15, 0
    if "noite" in t:
        return 19, 0
    return None


def extrair_parcelas(t: str) -> int | None:
    m = re.search(r"\b(\d{1,2})\s*(x|vezes|parcelas)\b", normal(t))
    if m:
        return int(m.group(1))
    if "a vista" in normal(t):
        return 1
    return None


# ------------------------------------------------------------------ Cognição
@dataclass
class Entendimento:
    intencao: str | None
    confianca: float = 0.0
    entidades: dict = field(default_factory=dict)


def faixa(conf: float) -> str:
    return "alta" if conf >= 0.85 else "media" if conf >= 0.6 else "baixa"


class EntendedorRegras:
    """Cognição sem LLM: frases de exemplo do bloco + sinônimos do catálogo. Determinística (simulador e testes)."""

    def entender(self, texto: str, opcoes: list[str], exemplos: dict | None = None) -> Entendimento:
        t = normal(texto)
        for op in opcoes:
            for ex in (exemplos or {}).get(op, []):
                if normal(ex) and normal(ex) in t:
                    return Entendimento(op, 0.95)
        for op in opcoes:
            if op in SINONIMOS and re.search(SINONIMOS[op], t):
                return Entendimento(op, 0.9)
        return Entendimento(None, 0.3)


class EntendedorLLM:
    """Cognição por LLM com saída de esquema fechado: uma ferramenta `classificar` com enum das opções do bloco.
    Fora do esquema (ou LLM fora) cai nas regras. A fala nunca vem daqui."""

    def __init__(self, modelo, reserva: EntendedorRegras | None = None):
        self.modelo, self.reserva = modelo, reserva or EntendedorRegras()

    def entender(self, texto: str, opcoes: list[str], exemplos: dict | None = None) -> Entendimento:
        ferr = [{"type": "function", "function": {
            "name": "classificar", "description": "Classifica a intenção da última fala da pessoa.",
            "parameters": {"type": "object", "additionalProperties": False, "required": ["intencao", "confianca"],
                           "properties": {"intencao": {"type": "string", "enum": list(opcoes) + ["nenhuma"]},
                                          "confianca": {"type": "number", "minimum": 0, "maximum": 1}}}}}]
        ex = "\n".join(f"- {k}: {', '.join(v)}" for k, v in (exemplos or {}).items())
        msgs = [{"role": "system", "content": "Classifique a intenção da fala em uma das opções. Responda só pela "
                                              "ferramenta classificar." + (f"\nExemplos:\n{ex}" if ex else "")},
                {"role": "user", "content": texto}]
        try:
            r = self.modelo.responder(msgs, ferr)
            for nome, a in r.chamadas:
                if nome == "classificar" and a.get("intencao") in opcoes and isinstance(a.get("confianca"), (int, float)):
                    return Entendimento(a["intencao"], max(0.0, min(1.0, float(a["confianca"]))))
                if nome == "classificar" and a.get("intencao") == "nenhuma":
                    return Entendimento(None, 0.3)
        except Exception as ex:   # noqa: BLE001
            log.warning("cognição: LLM indisponível (%s); usando regras", ex.__class__.__name__)
        return self.reserva.entender(texto, opcoes, exemplos)


# ------------------------------------------------------------------ o que a sessão precisa
@dataclass
class FluxoCarregado:
    """O que a VM lê do banco para uma chamada (cache por versão e hash)."""
    versao_id: int | None
    definicao: dict
    conectores: dict = field(default_factory=dict)          # id -> conector.Conector
    alcada: CN.Alcada | None = None
    base: dict = field(default_factory=dict)                # bloco_id -> [(pergunta, resposta)] revisadas
    hash: str = ""
    hosts: tuple = ()                                       # crm_hosts_permitidos da empresa


@dataclass
class Turno:
    """O que o simulador mostra a cada fala."""
    falas: list = field(default_factory=list)               # [(texto, bloco, modo)]
    caminho: list = field(default_factory=list)
    intencao: dict | None = None
    conectores: list = field(default_factory=list)
    travas: list = field(default_factory=list)
    devolucoes: list = field(default_factory=list)
    fim: str | None = None


class FluxoInvalido(ValueError):
    pass


class Sessao:
    def __init__(self, fluxo: FluxoCarregado, id_chamada: str, id_cliente: str, variaveis: dict, emitir,
                 cliente_conectores, entendedor=None, gerador=None, hoje: date | None = None):
        erros = FV.erros(fluxo.definicao)
        if erros:
            raise FluxoInvalido(", ".join(erros))
        self.fluxo, self.id_chamada, self.id_cliente = fluxo, id_chamada, id_cliente
        self.vars = {k: ("" if v is None else str(v)) for k, v in (variaveis or {}).items()}
        self.emitir_fora, self.cliente = emitir, cliente_conectores
        self.entendedor = entendedor or EntendedorRegras()
        self.gerador = gerador                 # (sessao, bloco) -> ConversaBloco
        self.hoje = hoje or date.today()
        self.blocos = {b["id"]: b for b in fluxo.definicao["blocos"]}
        self.abertura = next(b["id"] for b in fluxo.definicao["blocos"] if b["tipo"] == "abertura")
        self.memoria: dict = {}               # resposta do CRM (só na ligação)
        self.ofertas: list = []
        self.oferta_atual: dict | None = None
        self.identidade_confirmada = False
        self.terceiro = False
        self.atual: str | None = None
        self.tentativas: dict[str, int] = {}
        self.entradas: dict[str, int] = {}
        self.ordem = 0
        self.encerrada = False
        self.passos: list[dict] = []
        self.caminho: list[str] = []
        self.promessa: dict | None = None
        self.retorno_em: datetime | None = None
        self.resultado_final: str | None = None
        self.conversa = None                   # ConversaBloco do bloco generativo atual
        self.avisos: list[str] = []
        self.falar_agora = None                # voz: fala de espera tocada antes da API responder
        self._turno = Turno()

    # ---------------------------------------------------------------- interface (igual à Conversa)
    def comecar(self) -> list[str]:
        self._turno = Turno()
        self._entrar(self.abertura)
        return [f for f, _, _ in self._turno.falas]

    def ouvir(self, texto: str) -> list[str]:
        return [f for f, _, _ in self.turno(texto).falas]

    def turno(self, texto: str) -> Turno:
        self._turno = Turno()
        if self.encerrada or not (texto or "").strip():
            return self._turno
        t = normal(texto)
        if self._travas(texto, t):
            return self._turno
        b = self.blocos[self.atual]
        getattr(self, "_ouvir_" + b["tipo"])(b, texto, t)
        return self._turno

    def _transferir(self, motivo: str) -> None:            # chamado pela Montagem se o áudio cair
        if not self.encerrada:
            self._finalizar("transferir", motivo=motivo)

    def descartar(self) -> None:
        """Fim da ligação: a resposta do CRM some da memória."""
        self.memoria.clear()
        self.ofertas = []
        self.oferta_atual = None
        self.conversa = None

    # ---------------------------------------------------------------- travas em toda fala
    def _travas(self, texto: str, t: str) -> bool:
        cog = None
        if not RE_NAO_ME_LIGUE.search(t) and not RE_HUMANO.search(t) and not isinstance(self.entendedor, EntendedorRegras):
            cog = self.entendedor.entender(texto, ["nao_me_ligue", "pedir_humano"])
        if RE_NAO_ME_LIGUE.search(t) or (cog and cog.intencao == "nao_me_ligue" and cog.confianca >= 0.85):
            self._marca_trava("nao_me_ligue")
            self._falar(FALA_OPT_OUT, self.atual)
            self.resultado_final = "opt_out"
            self._finalizar("encerrar", resultado="opt_out")
            return True
        if RE_HUMANO.search(t) or (cog and cog.intencao == "pedir_humano" and cog.confianca >= 0.85):
            self._marca_trava("pedido_humano")
            self._falar(FALA_HUMANO, self.atual)
            self._finalizar("transferir", motivo="pedido_humano")
            return True
        if RE_SENHA.search(t) or re.search(r"\d{4}[ .-]?\d{4}[ .-]?\d{4}[ .-]?\d{4}", t):
            self._marca_trava("senha_cartao")
            self._falar(FALA_SENHA, self.atual)
            return True
        return False

    def _marca_trava(self, trava: str) -> None:
        self._turno.travas.append(trava)
        if self.passos and self.passos[-1].get("trava") is None:
            self.passos[-1]["trava"] = trava

    # ---------------------------------------------------------------- fala e variáveis
    def _valor(self, nome: str) -> str | None:
        if nome.startswith("oferta."):
            o = self.oferta_atual or {}
            v = o.get(nome.split(".", 1)[1])
            if v is None:
                return None
            if nome in ("oferta.valor_parcela", "oferta.valor_total", "oferta.entrada"):
                return _reais(v)
            if nome == "oferta.vencimento":
                try:
                    return date.fromisoformat(str(v)[:10]).strftime("%d/%m")
                except ValueError:
                    return str(v)
            if nome == "oferta.desconto_pct":
                return f"{float(v):g}%".replace(".", ",")
            return str(v)
        if nome == "link_pagamento":
            return self.memoria.get("link_pagamento") or self.vars.get("link_pagamento")
        return self.vars.get(nome)

    def render(self, texto: str) -> tuple[str, str | None]:
        """(fala, trava). Variável sensível sem identidade confirmada → recado neutro (trava 1)."""
        nomes = FV.variaveis(texto)
        if any(n in FV.VARIAVEIS_SENSIVEIS for n in nomes) and not self.identidade_confirmada:
            return self._recado(), "valor_antes_identidade"
        def troca(nome):
            v = self._valor(nome.strip(" \t\n\r"))
            return v if v is not None else ""
        fala = FV.trocar_variaveis(texto, troca)
        if RE_SENHA.search(normal(fala)):
            return FALA_SENHA, "senha_cartao"
        return fala, None

    def _recado(self) -> str:
        return RECADO_NEUTRO.format(primeiro_nome=self.vars.get("primeiro_nome") or "a pessoa responsável",
                                    assessoria=self.vars.get("assessoria") or "nossa central")

    def _falar(self, texto: str, bloco: str | None, modo: str | None = None) -> None:
        if not texto:
            return
        b = self.blocos.get(bloco or "")
        self._turno.falas.append((texto, bloco, modo or (b["modo"] if b else "arvore")))

    def _falar_bloco(self, b: dict, campo: str = "fala") -> None:
        fala, trava = self.render(b["params"].get(campo) or "")
        if trava:
            self._marca_trava(trava)
        self._falar(fala, b["id"])

    # ---------------------------------------------------------------- andar no grafo
    def _emitir(self, tipo: str, dados: dict) -> None:
        try:
            self.emitir_fora(self.id_chamada, tipo, dados)
        except Exception as ex:   # noqa: BLE001 — evento perdido não derruba a ligação
            log.warning("evento %s não emitido (%s)", tipo, ex.__class__.__name__)

    def _entrar(self, bid: str) -> None:
        b = self.blocos[bid]
        self.ordem += 1
        self.entradas[bid] = self.entradas.get(bid, 0) + 1
        self.tentativas[bid] = 0
        passo = {"ordem": self.ordem, "bloco_id": bid, "modo": b["modo"], "fluxo_versao_id": self.fluxo.versao_id,
                 "entrou_em": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        self.passos.append(passo)
        self.caminho.append(bid)
        self._turno.caminho.append(bid)
        self.atual = bid
        if self.ordem > MAX_PASSOS or ("repetir_max" in b and self.entradas[bid] > b["repetir_max"]):
            passo["trava"] = "repeticao"
            self._falar(FALA_HUMANO, bid)
            self._finalizar("transferir", motivo="pedido_humano")
            return
        getattr(self, "_entrar_" + b["tipo"])(b)

    def _seguir(self, b: dict, quando: str, **extra) -> None:
        passo = self.passos[-1]
        passo["saida_quando"] = quando
        passo.update({k: v for k, v in extra.items() if v is not None})
        self._emitir("passo", dict(passo))
        s = next((x for x in b["saidas"] if x["quando"] == quando), None)
        if s is None:                       # saída que o fluxo não tem (só nas opcionais): um atendente resolve
            self._falar(FALA_HUMANO, b["id"])
            self._finalizar("transferir", motivo="pedido_humano")
            return
        if s["tipo"] == "devolve":
            self._turno.devolucoes.append({"motivo": quando, "para": s["para"]})
        self._entrar(s["para"])

    def _finalizar(self, acao: str, motivo: str | None = None, resultado: str | None = None) -> None:
        if self.encerrada:
            return
        self.encerrada = True
        if self.passos and "saida_quando" not in self.passos[-1]:
            self._emitir("passo", dict(self.passos[-1]))
        if resultado is None and acao == "transferir":
            resultado = "cpc" if self.identidade_confirmada else None
        dados = {}
        if resultado:
            dados["resultado_ia"] = resultado
        if self.identidade_confirmada:
            dados["identidade_confirmada"] = True
        if self.promessa:
            dados["data_promessa"] = self.promessa["data_promessa"]
            if self.promessa.get("valor_promessa") is not None:
                dados["valor_promessa"] = round(float(self.promessa["valor_promessa"]), 2)
        if self.retorno_em:
            dados["retorno_em"] = self.retorno_em
        if dados.get("resultado_ia"):
            self._emitir("resultado", dados)
        self._emitir("fluxo", {"fluxo_versao_id": self.fluxo.versao_id, "bloco_final": self.atual})
        if acao == "transferir":
            self._emitir("transferir", {"motivo": motivo or "pedido_humano"})
            self._turno.fim = f"transferida · {motivo or 'pedido_humano'}"
        else:
            self._emitir("encerrar", {})
            self._turno.fim = resultado or "encerrada"
        self.resultado_final = resultado or self.resultado_final
        self.descartar()

    def _tentar_de_novo(self, b: dict, fala: str | None = None) -> bool:
        """Mais uma tentativa no bloco? (tentativas do params, padrão 2)"""
        self.tentativas[b["id"]] += 1
        if self.tentativas[b["id"]] >= int(b["params"].get("tentativas") or 2):
            return False
        self._falar(fala or FALA_REPETIR, b["id"])
        return True

    # ---------------------------------------------------------------- abertura (árvore) e terceiro (trava 4)
    def _entrar_abertura(self, b):
        self._falar_bloco(b)

    def _ouvir_abertura(self, b, texto, t):
        if RE_TITULAR.search(t) and not re.match(r"^nao\b", t):
            self._seguir(b, "titular")
        elif RE_TERCEIRO.search(t) or not self._tentar_de_novo(b, "Desculpe. Falo com "
                                                                    f"{self.vars.get('primeiro_nome') or 'o titular'}?"):
            self.terceiro = True
            self._marca_trava("terceiro")
            self._seguir(b, "terceiro")

    # ---------------------------------------------------------------- identidade: só o CRM confere, nunca a IA
    def _entrar_identidade(self, b):
        self._falar_bloco(b)

    def _ouvir_identidade(self, b, texto, t):
        p = b["params"]
        d = extrair_data(texto, self.hoje) if p["pergunta"] != "ultimos3_documento" else None
        informado = None
        if p["pergunta"] == "dia_mes_nascimento" and d:
            informado = d.strftime("%d%m")
        elif p["pergunta"] == "ano_nascimento":
            m = re.search(r"\b(19\d{2}|20\d{2})\b", t)
            informado = m.group(1) if m else None
        elif p["pergunta"] == "ultimos3_documento":
            m = re.search(r"\b(\d{3})\b", t)
            informado = m.group(1) if m else None
        if informado is None:
            if not self._tentar_de_novo(b, "Desculpe, não entendi. Pode repetir, por exemplo, 15 de março?"):
                self._seguir(b, "nao_confirmou")
            return
        self._turno.intencao = {"intencao": "informou_data", "confianca": "alta", "entidades": ["dado: ••••"]}
        r = self._chamar(b, p.get("conector_id"), {"data_informada": informado, "ano_informado": informado,
                                                   "digitos_informados": informado})
        ok = None if r is None or not r.ok else {"identidade_ok": True, "identidade_nao_confere": False}.get(r.codigo)
        if ok is None:                      # sem conferência possível: nunca "confirma" por palpite
            self._seguir(b, "falhou") if any(s["quando"] == "falhou" for s in b["saidas"]) else self._seguir(b, "nao_confirmou")
        elif ok:
            self.identidade_confirmada = True
            self._seguir(b, "confirmou")
        elif not self._tentar_de_novo(b, "Não conferiu. Pode me dizer de novo?"):
            self._seguir(b, "nao_confirmou")

    # ---------------------------------------------------------------- pergunta (árvore)
    def _entrar_pergunta(self, b):
        self._falar_bloco(b)

    def _ouvir_pergunta(self, b, texto, t):
        achou = None
        for o in b["params"]["opcoes"]:
            alvos = [o["rotulo"]] + list(o.get("exemplos") or [])
            if any(normal(a) and normal(a) in t for a in alvos) or (
                    o["codigo"].endswith("data") and extrair_data(texto, self.hoje)) or (
                    o["codigo"] in SINONIMOS and re.search(SINONIMOS[o["codigo"]], t)) or (
                    o["codigo"] in ("sim", "nao") and re.match(rf"^{o['codigo']}\b", t)):
                achou = o["codigo"]
                break
        if achou:
            self._seguir(b, achou)
        elif not self._tentar_de_novo(b, b["params"]["fala"] and self.render(b["params"]["fala"])[0]):
            self._seguir(b, "sem_resposta")

    # ---------------------------------------------------------------- intenção (cognição: classifica; fala do roteiro)
    def _entrar_intencao(self, b):
        self._falar_bloco(b)

    def _ouvir_intencao(self, b, texto, t):
        p = b["params"]
        e = self.entendedor.entender(texto, list(p["intencoes"]), p.get("exemplos"))
        self._turno.intencao = {"intencao": e.intencao or "nao_entendido", "confianca": faixa(e.confianca),
                                "entidades": _entidades(texto, p.get("entidades") or [])}
        if e.intencao and e.confianca >= float(p.get("confianca_min", 0.7)):
            self._seguir(b, e.intencao, intencao=e.intencao, confianca_faixa=faixa(e.confianca))
        elif not self._tentar_de_novo(b):
            self._seguir(b, "nao_entendido", intencao="nao_entendido", confianca_faixa=faixa(e.confianca))

    # ---------------------------------------------------------------- conector (sem fala; fala de espera)
    def _chamar(self, b: dict, cid, extra: dict | None = None) -> CN.Resultado | None:
        con = self.fluxo.conectores.get(cid) if cid is not None else None
        if con is None:
            self._emitir("conector", {"conector_id": cid, "bloco_id": b["id"], "classe": "recusado", "tentativa": 1,
                                      "latencia_ms": 0, "fluxo_versao_id": self.fluxo.versao_id})
            self._turno.conectores.append({"conector": cid, "classe": "recusado", "codigo": None})
            return None
        entrada = {"id_cliente": self.id_cliente, "id_chamada": self.id_chamada,
                   "contrato_ref": self.vars.get("contrato_ref"), "oferta.id": (self.oferta_atual or {}).get("id"),
                   "acordo.id": self.memoria.get("acordo.id")}
        if self.promessa:
            entrada["data_promessa"] = self.promessa["data_promessa"].isoformat()
            entrada["valor_promessa"] = self.promessa.get("valor_promessa")
        entrada.update(extra or {})
        r = self.cliente.chamar(con, entrada, f"{self.id_chamada}:{b['id']}")
        codigo = r.codigo
        descartadas = 0
        if r.ok and con.finalidade == "buscar_ofertas":
            boas, descartadas = CN.filtrar_ofertas(r.ofertas, self.fluxo.alcada)
            self.ofertas = boas
            codigo = CN.codigo_ofertas(len(boas), descartadas)
            if descartadas:
                self._marca_trava("alcada")
        if r.ok:
            self.memoria.update(r.dados)
        self._emitir("conector", {"conector_id": con.id, "conector_versao": con.versao, "bloco_id": b["id"],
                                  "classe": r.classe, "http_status": r.http_status, "latencia_ms": r.latencia_ms,
                                  "tentativa": r.tentativa, "resultado_codigo": codigo if codigo in _CODIGOS else
                                  ("ok" if r.ok else "falhou"), "ofertas_acima_alcada": descartadas,
                                  "fluxo_versao_id": self.fluxo.versao_id, "id_cliente": self.id_cliente})
        self._turno.conectores.append({"conector": con.id, "nome": con.nome, "classe": r.classe,
                                       "status": r.http_status, "ms": r.latencia_ms, "codigo": codigo,
                                       "descartadas_alcada": descartadas})
        r.codigo = codigo
        return r

    def _entrar_conector(self, b):
        p = b["params"]
        if p.get("fala_espera"):
            fala, _ = self.render(p["fala_espera"])
            if self.falar_agora:
                self.falar_agora(fala)
            self._falar(fala, b["id"])
        con = self.fluxo.conectores.get(p.get("conector_id"))
        r = self._chamar(b, p.get("conector_id"))
        if r is not None and r.ok:
            self._seguir(b, "respondeu")
            return
        if con is not None and con.em_falha == "transferir":
            self._falar(FALA_FALHA, b["id"])
            self._finalizar("transferir", motivo="pedido_humano")
            return
        if con is not None and con.em_falha == "alternativa_carteira":
            self.ofertas = CN.ofertas_da_carteira(self.fluxo.alcada, self.vars.get("saldo"), self.hoje)
        self._seguir(b, "falhou")

    # ---------------------------------------------------------------- condição (sem fala)
    def _entrar_condicao(self, b):
        p = b["params"]
        v = {"ofertas_quantidade": len(self.ofertas), "identidade_confirmada": self.identidade_confirmada,
             "dias_atraso": CN._num(self.vars.get("dias_atraso")), "saldo": CN._num(self.vars.get("saldo")),
             "tentativa_do_dia": CN._num(self.vars.get("tentativa_do_dia"))}[p["campo"]]
        alvo, op = p["valor"], p["op"]
        if v is None:
            ok = False
        else:
            ok = {"=": v == alvo, "<>": v != alvo, "<": v < alvo, "<=": v <= alvo, ">": v > alvo, ">=": v >= alvo}[op]
        self._seguir(b, "sim" if ok else "nao")

    # ---------------------------------------------------------------- oferta (árvore ou cognição)
    def _ofertas_do_bloco(self, b) -> list:
        if b["params"]["origem"] == "carteira" or not self.ofertas:
            if not self.ofertas:
                self.ofertas = CN.ofertas_da_carteira(self.fluxo.alcada, self.vars.get("saldo"), self.hoje)
        return self.ofertas

    def _entrar_oferta(self, b):
        ofs = self._ofertas_do_bloco(b)
        if not ofs:
            self._falar(FALA_HUMANO, b["id"])
            self._finalizar("transferir", motivo="ofertas_sem_acordo")
            return
        self.oferta_atual = self.oferta_atual if self.oferta_atual in ofs else min(ofs, key=lambda o: float(o.get("valor_parcela") or o.get("valor_total") or 0))
        self._falar_bloco(b)

    def _ouvir_oferta(self, b, texto, t):
        ofs = self.ofertas
        n = extrair_parcelas(texto)
        if n is not None and n > (self.fluxo.alcada.parcelas_max if self.fluxo.alcada else 0):
            self._marca_trava("alcada")
            self._seguir(b, "quer_outra", intencao="pedir_fora_alcada") if any(
                s["quando"] == "quer_outra" for s in b["saidas"]) else self._seguir(b, "recusou")
            return
        if n is not None:
            esc = next((o for o in ofs if int(o.get("parcelas") or 0) == n), None)
            if esc:
                self.oferta_atual = esc
        e = self.entendedor.entender(texto, ["aceitar", "quer_outra_condicao", "recusar"])
        self._turno.intencao = {"intencao": e.intencao or "nao_entendido", "confianca": faixa(e.confianca), "entidades": []}
        if e.intencao == "aceitar" or (n is not None and self.oferta_atual and int(self.oferta_atual["parcelas"]) == n):
            o = self.oferta_atual
            valor = o.get("valor_parcela") if int(o.get("parcelas") or 1) > 1 else o.get("valor_total")
            venc = o.get("vencimento")
            try:
                d = date.fromisoformat(str(venc)[:10]) if venc else self.hoje + timedelta(days=self.fluxo.alcada.validade_dias)
            except (ValueError, AttributeError):
                d = self.hoje
            self.promessa = {"oferta": o, "data_promessa": d, "valor_promessa": valor}
            self._seguir(b, "aceitou", intencao="aceitar", confianca_faixa=faixa(e.confianca))
        elif e.intencao == "quer_outra_condicao" and any(s["quando"] == "quer_outra" for s in b["saidas"]):
            self._seguir(b, "quer_outra", intencao=e.intencao)
        elif e.intencao == "recusar" or not self._tentar_de_novo(b):
            self._seguir(b, "recusou", intencao="recusar")

    # ---------------------------------------------------------------- agendar retorno
    def _entrar_retorno(self, b):
        self._falar_bloco(b)

    def _ouvir_retorno(self, b, texto, t):
        d, h = extrair_data(texto, self.hoje), extrair_hora(texto)
        if d is None and h is not None:
            d = self.hoje + timedelta(days=1)
        lim = self.hoje + timedelta(days=int(b["params"].get("dias_max") or 7))
        if d is not None and self.hoje <= d <= lim:
            hh, mm = h or (10, 0)
            hh = min(max(hh, 8), 19)        # janela 08:00–20:00 (a UF fica com o discador/regra do motor)
            self.retorno_em = datetime(d.year, d.month, d.day, hh, mm)
            self._turno.intencao = {"intencao": "informou_data_hora", "confianca": "alta", "entidades": ["dia e hora"]}
            self._seguir(b, "agendou")
        elif not self._tentar_de_novo(b, "Pode me dizer um dia e um horário, por exemplo, sexta às 10h?"):
            self._seguir(b, "nao_agendou")

    # ---------------------------------------------------------------- registrar promessa / acordo
    def _entrar_registrar(self, b):
        p = b["params"]
        if p["registra"] == "acordo_crm":
            for cid in [c for c in p.get("conectores") or [] if c is not None]:
                r = self._chamar(b, cid)
                if r is None or not r.ok or r.codigo in ("acordo_recusado", "boleto_falhou", "link_falhou"):
                    self._seguir(b, "falhou")
                    return
        self._seguir(b, "registrado")

    # ---------------------------------------------------------------- enviar link (árvore)
    def _entrar_link(self, b):
        link = self.memoria.get("link_pagamento") or self.vars.get("link_pagamento")
        if not link:
            self._seguir(b, "falhou") if any(s["quando"] == "falhou" for s in b["saidas"]) else self._seguir(b, "enviado")
            return
        self._emitir("link", {"canal": b["params"]["canal"], "modelo_id": b["params"].get("modelo_id")})
        self._falar_bloco(b)
        self._seguir(b, "enviado")

    # ---------------------------------------------------------------- finais
    def _entrar_transferir(self, b):
        self._falar_bloco(b)
        self._finalizar("transferir", motivo=b["params"]["motivo"])

    def _entrar_encerrar(self, b):
        res = b["params"]["resultado"]
        if res == "recado" or self.terceiro:
            self._falar(self._recado(), b["id"])          # trava 4: recado neutro fixo
        else:
            self._falar_bloco(b)
        if res == "promessa" and not self.promessa:
            res = "cpc" if self.identidade_confirmada else "atendida_sem_cpc"
        self._finalizar("encerrar", resultado=res)

    # ---------------------------------------------------------------- generativo (Conversa da Montagem por bloco)
    def _entrar_generativa(self, b):
        if self.gerador is None:
            self._falar(FALA_HUMANO, b["id"])
            self._finalizar("transferir", motivo="pedido_humano")
            return
        if not self.ofertas and "apresentar_oferta" in b["params"]["ferramentas"]:
            self.ofertas = CN.ofertas_da_carteira(self.fluxo.alcada, self.vars.get("saldo"), self.hoje)
        self.conversa = self.gerador(self, b)
        self._aplicar_turno_gen(b, self.conversa.comecar())

    def _ouvir_generativa(self, b, texto, t):
        devs = [s["quando"] for s in b["saidas"]]
        auto = next((q for q in devs if q in ("contestou", "nao_reconheco", "contestacao")), None)
        if auto:
            e = self.entendedor.entender(texto, ["nao_reconheco"])
            if e.intencao == "nao_reconheco" and e.confianca >= 0.85:
                self._seguir(b, auto, motivo_devolucao=auto, turnos=self.conversa.turnos)
                return
        self._aplicar_turno_gen(b, self.conversa.ouvir(texto))

    def _aplicar_turno_gen(self, b, tb) -> None:
        for f in tb.falas:
            fala, trava = (self._recado(), "valor_antes_identidade") if not self.identidade_confirmada else (f, None)
            if trava:
                self._marca_trava(trava)
            self._falar(fala, b["id"], "generativo")
        if tb.trava:
            self._marca_trava(tb.trava)
        conv = self.conversa
        if conv.oferta_atual:
            self.oferta_atual = conv.oferta_atual
        if conv.promessa:
            self.promessa = conv.promessa
        if conv.retorno_em:
            self.retorno_em = conv.retorno_em
        if not tb.acao:
            return
        tipo, arg = tb.acao
        self.passos[-1]["turnos"] = conv.turnos
        if tipo == "devolver":
            self._seguir(b, arg, motivo_devolucao=arg)
        elif tipo == "transferir":
            self._finalizar("transferir", motivo=arg)
        else:
            res = "promessa" if self.promessa else "retorno_agendado" if self.retorno_em else (
                "cpc" if self.identidade_confirmada else "atendida_sem_cpc")
            self._finalizar("encerrar", resultado=res)


_CODIGOS = ("ok", "falhou", "ofertas_0", "ofertas_1_3", "ofertas_4_mais", "oferta_acima_alcada", "identidade_ok",
            "identidade_nao_confere", "acordo_registrado", "acordo_recusado", "boleto_gerado", "boleto_falhou",
            "link_gerado", "link_falhou")


def _entidades(texto: str, quais: list) -> list:
    out = []
    if "parcelas" in quais and extrair_parcelas(texto):
        out.append(f"parcelas: {extrair_parcelas(texto)}")
    if "data" in quais and extrair_data(texto, date.today()):
        out.append("data: ••/••")
    if "hora" in quais and extrair_hora(texto):
        out.append("hora")
    return out


def _reais(v) -> str:
    try:
        return "R$ " + f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (TypeError, ValueError):
        return str(v)


# ------------------------------------------------------------------ leitura do banco (VM), com cache por versão e hash
class CarregadorFluxos:
    """fluxo_de(ctx) da Montagem: pede a versão em uso da carteira no começo de cada chamada (cache curto) e monta o
    resto (conectores ativos, hosts, alçada vigente, base revisada) uma vez por versão e hash. Sem fluxo em uso:
    None (a Montagem cai no roteiro). Erro do banco também cai no roteiro, com aviso no log."""

    def __init__(self, sb, ttl_s: float = 60, relogio=None):
        import time as _t
        self.sb, self.ttl = sb, ttl_s
        self.relogio = relogio or _t.monotonic
        self._em_uso: dict = {}
        self._versoes: dict = {}

    def __call__(self, ctx) -> FluxoCarregado | None:
        chave = (ctx.empresa_id, ctx.credor_id)
        agora = self.relogio()
        try:
            hit = self._em_uso.get(chave)
            if hit is None or agora - hit[0] > self.ttl:
                linhas = self.sb.rpc("fluxo_voz_em_uso", {"empresa": ctx.empresa_id, "credor": ctx.credor_id}) or []
                hit = (agora, linhas[0] if linhas else None)
                self._em_uso[chave] = hit
            v = hit[1]
            if v is None:
                return None
            ch = (v["versao_id"], v["hash"])
            if ch not in self._versoes:
                self._versoes[ch] = self._montar(ctx, v)
            return self._versoes[ch]
        except Exception as ex:   # noqa: BLE001
            log.warning("fluxo da empresa %s indisponível (%s): usando o roteiro", ctx.empresa_id, ex.__class__.__name__)
            return None

    def _montar(self, ctx, v: dict) -> FluxoCarregado:
        emp = int(ctx.empresa_id)
        cons = self.sb.selecionar("crm_conectores", {"empresa_id": f"eq.{emp}", "situacao": "eq.ativo"}) or []
        hosts = self.sb.selecionar("crm_hosts_permitidos", {"empresa_id": f"eq.{emp}"}) or []
        alc = self.sb.rpc("alcada_voz_vigente", {"empresa": emp, "credor": ctx.credor_id, "dia": None})
        alc = alc[0] if isinstance(alc, list) and alc else alc
        base: dict = {}
        for r in self.sb.selecionar("voz_base_respostas", {"fluxo_versao_id": f"eq.{v['versao_id']}",
                                                           "revisado_em": "not.is.null"}) or []:
            base.setdefault(r["bloco_id"], []).append((r["pergunta"], r["resposta"]))
        return FluxoCarregado(versao_id=int(v["versao_id"]), definicao=v["definicao"], hash=v["hash"],
                              conectores={int(c["id"]): CN.Conector.da_linha(c) for c in cons},
                              alcada=CN.Alcada.da_linha(alc if isinstance(alc, dict) and alc.get("id") else None),
                              base=base,
                              hosts=tuple(h["host"] for h in hosts))


# ------------------------------------------------------------------ gerador padrão do bloco generativo
def gerador_montagem(modelo_de):
    """(sessao, bloco) -> ConversaBloco da Montagem, com ofertas, alçada e base de respostas do bloco."""
    from voz.provedores.montagem import ConversaBloco

    def fazer(sessao: Sessao, b: dict):
        alc = sessao.fluxo.alcada
        base = sessao.fluxo.base.get(b["id"], [])
        livres = {round(float(x), 2) for _, r in base for x in re.findall(r"\d+", r)}
        saldo = CN._num(sessao.vars.get("saldo"))
        if saldo is not None:
            livres.add(round(saldo, 2))
        contexto = (f"Você fala com {sessao.vars.get('primeiro_nome') or 'o titular'}, identidade já confirmada. "
                    f"Credor: {sessao.vars.get('credor') or '-'}. Saldo: {sessao.vars.get('saldo') or '-'}. "
                    + (f"Limites da carteira: até {alc.parcelas_max} parcelas, desconto até {alc.desconto_max_pct:g}%."
                       if alc else "Sem alçada: não ofereça condições."))
        return ConversaBloco(modelo_de(), b["params"], [s["quando"] for s in b["saidas"]], sessao.ofertas, contexto,
                             base=base, hoje=sessao.hoje, validade_dias=alc.validade_dias if alc else 5,
                             numeros_livres=tuple(livres))
    return fazer


# ------------------------------------------------------------------ modo texto (simulador)
def simular(fluxo: FluxoCarregado, falas: list[str], variaveis: dict, entendedor=None, modelo_de=None,
            falhar: set | None = None, hoje: date | None = None, id_cliente: str = "CLI-TESTE") -> dict:
    """Roda o fluxo em modo texto, com os conectores trocados pelo exemplo_resposta (ou falhando os de `falhar`).
    Devolve, por turno, fala, bloco, caminho, intenção, travas e chamadas a conectores, e os eventos de passo."""
    eventos: list = []
    s = Sessao(fluxo, "sim-texto", id_cliente, variaveis, lambda i, t, d: eventos.append((t, d)),
               CN.ConectoresDeExemplo(falhar), entendedor=entendedor,
               gerador=gerador_montagem(modelo_de) if modelo_de else None, hoje=hoje)
    turnos = []
    s._turno = Turno()
    s._entrar(s.abertura)
    turnos.append(_turno_json(None, s._turno))
    for f in falas:
        if s.encerrada:
            break
        turnos.append(_turno_json(f, s.turno(f)))
    return {"turnos": turnos, "caminho": list(s.caminho), "encerrada": s.encerrada,
            "resultado": s.resultado_final, "passos": [d for t, d in eventos if t == "passo"],
            "conectores": [d for t, d in eventos if t == "conector"],
            "eventos": [t for t, _ in eventos]}


def _turno_json(fala_pessoa, t: Turno) -> dict:
    return {"pessoa": fala_pessoa, "falas": [{"texto": x, "bloco": b, "modo": m} for x, b, m in t.falas],
            "bloco": t.caminho[-1] if t.caminho else (t.falas[-1][1] if t.falas else None),
            "caminho": t.caminho, "intencao": t.intencao, "conectores": t.conectores, "travas": t.travas,
            "devolucoes": t.devolucoes, "fim": t.fim}
