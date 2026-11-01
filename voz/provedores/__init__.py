"""Provedores de voz (decisão 21 do dono: escolhido por empresa em voz_config.provedor).

  simulador   sem áudio e sem custo (voz/provedores/simulador.py)
  montagem_motorcx  Montagem MotorCX: Pipecat + Deepgram + LLM configurável + TTS pt-BR (voz/provedores/montagem.py)
  elevenlabs  ElevenLabs por SIP (voz/provedores/elevenlabs.py)
"""
from __future__ import annotations

import json
from pathlib import Path

# os valores de voz_config.provedor no SQL 56 (o mesmo código vai em voz_chamadas.provedor)
CODIGOS = ("simulador", "montagem_motorcx", "elevenlabs")


def criar_todos(config: dict | None, segredos=None, roteiro_de=None) -> dict:
    """{codigo: provedor} a partir do JSON de provedores da VM (/etc/motorcx/provedores.json):
    {"montagem": {...ConfigMontagem...}, "elevenlabs": {"numero_agente": "...", "max_simultaneas": 200,
    "agent_id": "...", "ref_api": "voz/elevenlabs-api"}} (agent_id e ref_api: a conversa pela API, SQL 63).
    A chave "montagem" do arquivo vira o código do banco, montagem_motorcx (voz_config.provedor).
    O Simulador está sempre lá. Provedor sem configuração fica de fora (a empresa que o escolher cai no
    Simulador, com alerta do orquestrador)."""
    from voz.provedores.simulador import Simulador
    out = {"simulador": Simulador()}
    config = config or {}
    chave = next((k for k in ("montagem_motorcx", "montagem") if k in config), None)
    if chave:
        from voz.provedores.montagem import ConfigMontagem, Montagem
        c = dict(config[chave])
        if "portas" in c:
            c["portas"] = tuple(c["portas"])
        padrao = ("Você é o assistente de cobrança da empresa. Seja breve, educado e objetivo.", "Alô?")
        out["montagem_motorcx"] = Montagem(ConfigMontagem(**c), segredos, roteiro_de or (lambda ctx: padrao))
    if "elevenlabs" in config:
        from voz.provedores.elevenlabs import ApiElevenLabs, ElevenLabs
        c = dict(config["elevenlabs"])
        agent_id, ref_api = c.pop("agent_id", None), c.pop("ref_api", None)
        api = None
        if agent_id and ref_api and segredos is not None:     # resultado e transcrição pela API de conversas (SQL 63)
            api = ApiElevenLabs(segredos.valor(ref_api), agent_id)
        out["elevenlabs"] = ElevenLabs(**c, api=api)
    return out


def ler_config(caminho: str | Path | None) -> dict:
    p = Path(caminho) if caminho else None
    return json.loads(p.read_text(encoding="utf-8")) if p and p.exists() else {}
