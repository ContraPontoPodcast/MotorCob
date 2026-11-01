"""Transcrição das ligações da IA (decisão 21: o texto da própria conversa, sem custo de transcrição).

Cada provedor entrega a conversa por turno (agente | cliente, início e fim em segundos quando houver):
  Montagem MotorCX   ConversaComTurnos embrulha a Conversa/Sessao do fluxo e anota cada fala (o tempo é o do
                     processo: o fim da fala da pessoa é quando o Deepgram fecha a frase, e a duração é estimada
                     pelas palavras; "tempo": "estimado");
  ElevenLabs         o transcript da conversa (webhook pós-chamada ou a API de conversas), com time_in_call_secs;
  Simulador          os turnos simulados do cenário.
O provedor manda ao orquestrador o evento "transcricao" {turnos, tempo, oferta}; o orquestrador só grava quando a
ligação é gravada (sem gravação não há com quem casar a análise) pelo GravadorTranscricaoIA:
  /var/motorcx/transcricoes/empresa_<id>/ia_<id da chamada>.json (0600), no MESMO formato do worker do Whisper
  (segmentos com inicio, fim, texto e locutor), e o <ref> "ia_<id da chamada>" é o nome do arquivo da gravação da IA
  no bucket sem a extensão: speech_contexto_voz (SQL 62/63) casa um com o outro.
O texto é mascarado ANTES de ir ao disco (redacao.mascarar: CPF, cartão, e-mail, telefone, sequências de dígitos,
nome dito e os nomes conhecidos da chamada). Nunca há texto sem máscara no disco. O arquivo vai embora em 90 dias
(expirar), como o do Whisper.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from voz.transcricao.redacao import mascarar

PREFIXO = "ia_"
RETENCAO_DIAS = 90
PALAVRAS_POR_S = 2.5            # fala em português ~150 palavras/min: duração estimada da fala
MIN_FALA_S = 0.6
MAX_TURNOS = 400
MAX_TEXTO = 1000
LOCUTORES = ("agente", "cliente")
REF = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")
NOMES_VARIAVEIS = ("primeiro_nome", "nome", "nome_cliente")     # variáveis da chamada que são nome de pessoa


def ref_ia(id_chamada: str) -> str:
    """O <ref> da transcrição da IA = o nome do arquivo da gravação no bucket sem a extensão."""
    ref = PREFIXO + str(id_chamada)
    if not REF.match(ref):
        raise ValueError("id da chamada inválido para a transcrição")
    return ref


def eh_da_ia(ref: str) -> bool:
    return str(ref or "").startswith(PREFIXO)


def nomes_da_chamada(variaveis: dict | None) -> tuple[str, ...]:
    """Os nomes de pessoa que a chamada conhece (para a máscara). Só ficam na memória."""
    v = variaveis or {}
    return tuple(str(v[k]).strip() for k in NOMES_VARIAVEIS if v.get(k) and str(v[k]).strip())


def _duracao(texto: str) -> float:
    return max(MIN_FALA_S, len((texto or "").split()) / PALAVRAS_POR_S)


# ------------------------------------------------------------------ oferta: só parcelas e faixa de desconto
def faixa_desconto(pct) -> str | None:
    try:
        p = float(pct)
    except (TypeError, ValueError):
        return None
    if p <= 0:
        return None
    for lim, nome in ((10, "1_10"), (20, "10_20"), (30, "20_30"), (50, "30_50")):
        if p <= lim:
            return nome
    return "50_mais"


def codigo_oferta(oferta: dict | None) -> str | None:
    """'avista' | '<n>x', com '_d<faixa>' quando há desconto (ex.: '6x', 'avista_d10_20'). Nunca valor."""
    if not isinstance(oferta, dict):
        return None
    try:
        n = int(oferta.get("parcelas") or 1)
    except (TypeError, ValueError):
        return None
    if not 1 <= n <= 99:
        return None
    cod = "avista" if n == 1 else f"{n}x"
    f = faixa_desconto(oferta.get("desconto_pct"))
    return cod + (f"_d{f}" if f else "")


# ------------------------------------------------------------------ Montagem: turnos anotados no processo
class TurnosConversa:
    """Turnos da conversa da Montagem, com o tempo do processo desde o começo da sessão (estimado)."""

    def __init__(self, relogio=time.monotonic):
        self.relogio = relogio
        self.t0 = relogio()
        self.turnos: list[dict] = []
        self._fim_agente = 0.0

    def _agora(self) -> float:
        return max(0.0, self.relogio() - self.t0)

    def agente(self, texto: str) -> None:
        texto = (texto or "").strip()
        if not texto or len(self.turnos) >= MAX_TURNOS:
            return
        ini = max(self._agora(), self._fim_agente)
        fim = ini + _duracao(texto)
        self._fim_agente = fim
        self.turnos.append({"locutor": "agente", "inicio": round(ini, 2), "fim": round(fim, 2), "texto": texto})

    def pessoa(self, texto: str) -> None:
        texto = (texto or "").strip()
        if not texto or len(self.turnos) >= MAX_TURNOS:
            return
        fim = self._agora()
        self.turnos.append({"locutor": "cliente", "inicio": round(max(0.0, fim - _duracao(texto)), 2),
                            "fim": round(fim, 2), "texto": texto})


class ConversaComTurnos:
    """Embrulha a Conversa (roteiro) ou a Sessao do fluxo (voz/fluxo.py): mesma interface para o Pipecat, e anota
    cada fala do agente e da pessoa e a PRIMEIRA oferta apresentada (só o código: parcelas e faixa de desconto)."""

    def __init__(self, interna, turnos: TurnosConversa | None = None):
        object.__setattr__(self, "_interna", interna)
        object.__setattr__(self, "turnos", turnos or TurnosConversa())
        object.__setattr__(self, "oferta", None)

    def _olhar_oferta(self) -> None:
        if self.oferta is None:
            cod = codigo_oferta(getattr(self._interna, "oferta_atual", None))
            if cod:
                object.__setattr__(self, "oferta", cod)

    def comecar(self) -> list[str]:
        falas = self._interna.comecar()
        for f in falas or []:
            self.turnos.agente(f)
        self._olhar_oferta()
        return falas

    def ouvir(self, texto: str) -> list[str]:
        self.turnos.pessoa(texto)
        falas = self._interna.ouvir(texto)
        for f in falas or []:
            self.turnos.agente(f)
        self._olhar_oferta()
        return falas

    @property
    def falar_agora(self):
        return getattr(self._interna, "falar_agora", None)

    @falar_agora.setter
    def falar_agora(self, f):
        """A fala de espera do bloco Chamar conector também entra na transcrição."""
        if f is None:
            self._interna.falar_agora = None
            return

        def falar(t):
            self.turnos.agente(t)
            return f(t)

        self._interna.falar_agora = falar

    def __getattr__(self, nome):
        return getattr(self._interna, nome)

    def __setattr__(self, nome, valor):
        if nome == "falar_agora":
            type(self).falar_agora.fset(self, valor)
            return
        setattr(self._interna, nome, valor)

    def resumo(self) -> dict:
        """O que vai no evento "transcricao" (texto ainda sem máscara: só em memória; o gravador mascara)."""
        return {"turnos": list(self.turnos.turnos), "tempo": "estimado", "oferta": self.oferta}


# ------------------------------------------------------------------ gravação no disco da VM (mascarada)
def turnos_validos(turnos) -> list[dict]:
    out = []
    for t in (turnos or [])[:MAX_TURNOS]:
        if not isinstance(t, dict):
            continue
        loc = t.get("locutor")
        texto = str(t.get("texto") or "").strip()
        if loc not in LOCUTORES or not texto:
            continue
        try:
            ini = float(t.get("inicio") or 0)
            fim = float(t.get("fim") if t.get("fim") is not None else ini)
        except (TypeError, ValueError):
            continue
        if ini < 0 or fim < ini or fim > 36000:
            continue
        out.append({"locutor": loc, "inicio": round(ini, 2), "fim": round(fim, 2), "texto": texto[:MAX_TEXTO]})
    return sorted(out, key=lambda x: (x["inicio"], x["fim"]))


class GravadorTranscricaoIA:
    """Grava a transcrição mascarada da ligação da IA ao lado das do Whisper (DestinoPasta)."""

    def __init__(self, pasta: str | Path):
        self.pasta = Path(pasta)

    def caminho(self, empresa_id: int, id_chamada: str) -> Path:
        return self.pasta / f"empresa_{int(empresa_id)}" / f"{ref_ia(id_chamada)}.json"

    def salvar(self, empresa_id: int, id_chamada: str, provedor: str, dados: dict, nomes=()) -> Path | None:
        turnos = turnos_validos((dados or {}).get("turnos"))
        if not turnos:
            return None
        cont: dict = {}
        segs = []
        for t in turnos:
            texto, c = mascarar(t["texto"], nomes)
            for k, v in c.items():
                cont[k] = cont.get(k, 0) + v
            segs.append({"inicio": t["inicio"], "fim": t["fim"], "texto": texto, "locutor": t["locutor"]})
        oferta = (dados or {}).get("oferta")
        conteudo = {"id": ref_ia(id_chamada), "empresa_id": int(empresa_id), "origem": "ia",
                    "motor": f"conversa:{provedor}"[:40], "idioma": "pt",
                    "tempo": "provedor" if (dados or {}).get("tempo") == "provedor" else "estimado",
                    # o minuto analisado é o da conversa com a IA (depois da transferência o operador não está aqui)
                    "duracao_s": round(max(s["fim"] for s in segs), 1),
                    "texto": " ".join(s["texto"] for s in segs), "segmentos": segs, "redigidos": cont,
                    "oferta": oferta if isinstance(oferta, str) and re.fullmatch(r"[a-z0-9_]{2,30}", oferta) else None}
        arq = self.caminho(empresa_id, id_chamada)
        arq.parent.mkdir(parents=True, exist_ok=True)
        tmp = arq.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(conteudo, f, ensure_ascii=False)
        os.replace(tmp, arq)
        return arq


def expirar(pasta: str | Path, dias: int = RETENCAO_DIAS, relogio=time.time) -> int:
    """Apaga as transcrições (da IA e do Whisper) e as marcas ao lado com mais de `dias` dias. Devolve quantos."""
    pasta = Path(pasta)
    if not pasta.is_dir():
        return 0
    limite = relogio() - int(dias) * 86400
    n = 0
    for d in pasta.iterdir():
        if not d.is_dir() or not d.name.startswith("empresa_"):
            continue
        for arq in d.glob("*.json"):
            try:
                if arq.stat().st_mtime < limite:
                    arq.unlink()
                    n += 1
            except FileNotFoundError:
                continue
    return n
