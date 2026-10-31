"""Provedores de voz (decisão 21 do dono: escolhido por empresa em voz_config.provedor).

  simulador   sem áudio e sem custo (voz/provedores/simulador.py)
  montagem    Montagem MotorCX: Pipecat + Deepgram + LLM configurável + TTS pt-BR (voz/provedores/montagem.py)
  elevenlabs  ElevenLabs por SIP (voz/provedores/elevenlabs.py)
"""
from __future__ import annotations

import json
from pathlib import Path

CODIGOS = ("simulador", "montagem", "elevenlabs")


def criar_todos(config: dict | None, segredos=None, roteiro_de=None) -> dict:
    """{codigo: provedor} a partir do JSON de provedores da VM (/etc/motorcx/provedores.json):
    {"montagem": {...ConfigMontagem...}, "elevenlabs": {"numero_agente": "...", "max_simultaneas": 200}}.
    O Simulador está sempre lá. Provedor sem configuração fica de fora (a empresa que o escolher cai no
    Simulador, com alerta do orquestrador)."""
    from voz.provedores.simulador import Simulador
    out = {"simulador": Simulador()}
    config = config or {}
    if "montagem" in config:
        from voz.provedores.montagem import ConfigMontagem, Montagem
        c = dict(config["montagem"])
        if "portas" in c:
            c["portas"] = tuple(c["portas"])
        padrao = ("Você é o assistente de cobrança da empresa. Seja breve, educado e objetivo.", "Alô?")
        out["montagem"] = Montagem(ConfigMontagem(**c), segredos, roteiro_de or (lambda ctx: padrao))
    if "elevenlabs" in config:
        from voz.provedores.elevenlabs import ElevenLabs
        out["elevenlabs"] = ElevenLabs(**config["elevenlabs"])
    return out


def ler_config(caminho: str | Path | None) -> dict:
    p = Path(caminho) if caminho else None
    return json.loads(p.read_text(encoding="utf-8")) if p and p.exists() else {}
