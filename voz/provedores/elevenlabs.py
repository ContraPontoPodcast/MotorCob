"""ElevenLabs ligado por SIP (decisão 20 do dono): o Asterisk só chama a ElevenLabs quando já é uma pessoa.

  iniciar      -> Conexao SIP: PJSIP/<número do agente>@pv-elevenlabs, com X-MotorCX-Id/X-MotorCX-Empresa no INVITE
                  (nunca CPF, nome ou valor). O endpoint pv-elevenlabs sai do gerador (provedores_sip no JSON).
  resultado    -> chega DEPOIS da chamada pelo webhook pós-chamada (post_call_transcription). ler_webhook confere a
                  assinatura (HMAC-SHA256 de "<t>.<corpo>" com o segredo do webhook, tolerância de 30 min) e
                  devolve os eventos; o orquestrador espera até `espera_resultado_s` antes de fechar a tentativa.
  transferência-> a ferramenta de transferência da ElevenLabs manda REFER para sip:transferir-<motivo>@<Asterisk>;
                  o ARI avisa (ChannelTransfer) e o orquestrador transfere para o discador do cliente.

A confirmar no piloto (documentação da ElevenLabs): como os cabeçalhos X- do INVITE viram variáveis dinâmicas
(aqui: motorcx_id) e o nome do campo de análise com o resultado (aqui: data_collection_results.resultado).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import date, datetime

from voz.provedores.base import MOTIVOS_TRANSFERENCIA, Conexao, ContextoChamada, Emitir, ProvedorVoz
from voz.provedores.montagem import RESULTADOS_IA

TOLERANCIA_S = 30 * 60


class AssinaturaInvalida(ValueError):
    pass


def verificar_assinatura(cabecalho: str, corpo: bytes, segredo: str, agora: float | None = None) -> None:
    partes = dict(p.split("=", 1) for p in (cabecalho or "").split(",") if "=" in p)
    t, v0 = partes.get("t", ""), partes.get("v0", "")
    if not t.isdigit() or not v0:
        raise AssinaturaInvalida("cabeçalho de assinatura ausente ou malformado")
    if abs((agora if agora is not None else time.time()) - int(t)) > TOLERANCIA_S:
        raise AssinaturaInvalida("assinatura fora da janela de tempo")
    esperado = hmac.new(segredo.encode(), f"{t}.".encode() + corpo, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(esperado, v0):
        raise AssinaturaInvalida("assinatura não confere")


def ler_webhook(cabecalhos: dict, corpo: bytes, segredo: str, agora: float | None = None) -> list[tuple]:
    """[(id_chamada, tipo, dados)] de um webhook pós-chamada. Assinatura inválida: AssinaturaInvalida."""
    cab = {k.lower(): v for k, v in cabecalhos.items()}
    verificar_assinatura(cab.get("elevenlabs-signature", ""), corpo, segredo, agora)
    d = json.loads(corpo.decode("utf-8"))
    if d.get("type") != "post_call_transcription":
        return []
    dados = d.get("data") or {}
    var = ((dados.get("conversation_initiation_client_data") or {}).get("dynamic_variables") or {})
    id_chamada = str(var.get("motorcx_id") or "")
    if not id_chamada.isalnum():
        return []
    coleta = ((dados.get("analysis") or {}).get("data_collection_results") or {})

    def valor(campo):
        return (coleta.get(campo) or {}).get("value")

    r = valor("resultado")
    if r not in RESULTADOS_IA:
        return [(id_chamada, "encerrar", {})]
    out = {"resultado_ia": r}
    if isinstance(valor("identidade_confirmada"), bool):
        out["identidade_confirmada"] = valor("identidade_confirmada")
    try:
        if valor("data_promessa"):
            out["data_promessa"] = date.fromisoformat(str(valor("data_promessa"))[:10])
        if valor("retorno_em"):
            out["retorno_em"] = datetime.fromisoformat(str(valor("retorno_em"))[:16])
    except ValueError:
        pass
    v = valor("valor_promessa")
    if isinstance(v, (int, float)) and 0 < v < 10_000_000:
        out["valor_promessa"] = round(float(v), 2)
    return [(id_chamada, "resultado", out)]


def motivo_do_refer(refer_to: str) -> str | None:
    """'sip:transferir-cpc@203.0.113.10' -> 'cpc'; outro destino -> None."""
    u = (refer_to or "").split(":", 1)[-1].split("@", 1)[0]
    if not u.startswith("transferir-"):
        return None
    m = u[len("transferir-"):]
    return m if m in MOTIVOS_TRANSFERENCIA else "pedido_humano"


class ElevenLabs(ProvedorVoz):
    codigo = "elevenlabs"

    def __init__(self, numero_agente: str, max_simultaneas: int = 200, espera_resultado_s: int = 120,
                 endpoint: str = "pv-elevenlabs"):
        if not numero_agente.replace("+", "").isalnum():
            raise ValueError("número/identificador do agente inválido")
        self.numero_agente, self.max_simultaneas, self.endpoint = numero_agente, max_simultaneas, endpoint
        self.espera_resultado_s = espera_resultado_s
        self.sessoes: dict[str, ContextoChamada] = {}

    def disponivel(self) -> bool:
        return len(self.sessoes) < self.max_simultaneas

    def limites(self) -> dict:
        return {"por_agente": self.max_simultaneas}

    def iniciar(self, ctx: ContextoChamada, emitir: Emitir) -> Conexao:
        self.sessoes[ctx.id_chamada] = ctx
        return Conexao("sip", endpoint=f"PJSIP/{self.numero_agente}@{self.endpoint}", variaveis={
            "PJSIP_HEADER(add,X-MotorCX-Id)": ctx.id_chamada,
            "PJSIP_HEADER(add,X-MotorCX-Empresa)": str(ctx.empresa_id),
            "PJSIP_HEADER(add,X-MotorCX-Acao)": ctx.id_acao or "-"})

    def encerrar(self, id_chamada: str) -> None:
        self.sessoes.pop(id_chamada, None)
