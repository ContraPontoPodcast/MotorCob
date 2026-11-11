"""O LLM no papel de uma pessoa fictícia ao telefone: a base do cliente simulado do roleplay do AGENTE (voz/roleplay.py,
SQL 59, que conversa com o executor da ligação) e do treino de operadores HUMANOS (voz/treino.py, SQL 90/100).

Os dois lados usam a mesma regra de segurança: a fala gerada passa pelo filtro RE_PESSOAL (sequência de 9+ dígitos e
e-mail viram "***"), é cortada em 300 caracteres e nunca fica vazia. O prompt de cada lado diz quem é a pessoa; aqui
só o laço da conversa. Só biblioteca padrão.
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger("motorcx.voz.persona")
RE_PESSOAL = re.compile(r"\d{9,}|[\w.+-]+@[\w-]+\.[\w.]+")
MAX_FALA = 300


def filtrar_fala(texto: str, padrao: str = "Alô?") -> str:
    """Saída do LLM no papel da pessoa: sem dado com cara de real, curta e nunca vazia."""
    return RE_PESSOAL.sub("***", (texto or "").strip())[:MAX_FALA].strip() or padrao


class Interlocutor:
    """Pessoa fictícia ao telefone: guarda o histórico (system + falas) e responde uma fala curta por vez."""

    def __init__(self, modelo, sistema: str, padrao: str = "Alô?"):
        self.modelo, self.padrao = modelo, padrao
        self.historico = [{"role": "system", "content": sistema}]
        self.tokens = 0

    def responder(self, falas_do_outro: list[str]) -> str:
        self.historico.append({"role": "user", "content": " ".join(falas_do_outro) or "(silêncio)"})
        try:
            r = self.modelo.responder(self.historico, [])
            self.tokens += int(getattr(r, "tokens", 0) or 0)
            texto = (r.texto or "").strip()
        except Exception as ex:   # noqa: BLE001
            log.warning("persona: LLM indisponível (%s)", ex.__class__.__name__)
            texto = ""
        texto = filtrar_fala(texto, self.padrao)
        self.historico.append({"role": "assistant", "content": texto})
        return texto
