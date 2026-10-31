"""Detecção de máquina: AMD do Asterisk (app_amd) e ponto de extensão para a Khomp Analytics.

O veredito decide o que o orquestrador faz (pessoa = liga o provedor; senão desliga). O código AMD que vai para
o evento é o vocabulário que regras/voz_causas.json já entende (grupo "amd": MACHINE, HUMAN, NOTSURE, HANGUP,
INITIALSILENCE), e é o motor quem transforma em desfecho (motor/voz.py: pela_rede).
"""
from __future__ import annotations

from dataclasses import dataclass, field

PESSOA, MAQUINA, SILENCIO, DESLIGOU = "pessoa", "maquina", "silencio", "desligou"


@dataclass(frozen=True)
class Veredito:
    tipo: str              # pessoa | maquina | silencio | desligou
    amd: str               # código para o evento (grupo amd de regras/voz_causas.json)
    detalhe: str = ""      # causa/padrão, só para diagnóstico


class DetectorMaquina:
    """Interface. `usa_amd_asterisk` liga a app AMD() no dialplan (MOTORCX_AMD=1)."""
    usa_amd_asterisk = True
    codigo = "base"

    def classificar(self, amd_status: str, amd_causa: str = "", khomp: str = "") -> Veredito:
        raise NotImplementedError


class AmdAsterisk(DetectorMaquina):
    """app_amd: AMDSTATUS = MACHINE | HUMAN | NOTSURE | HANGUP; AMDCAUSE = TOOLONG-x, INITIALSILENCE-x-y, …
    NOTSURE vai para a pessoa (melhor a IA atender uma secretária do que derrubar um titular)."""
    codigo = "asterisk"

    def classificar(self, amd_status, amd_causa="", khomp=""):
        s = (amd_status or "").strip().upper()
        c = (amd_causa or "").strip().upper()
        if s == "MACHINE":
            if c.startswith("INITIALSILENCE"):
                return Veredito(SILENCIO, "INITIALSILENCE", c)
            return Veredito(MAQUINA, "MACHINE", c)
        if s == "HANGUP":
            return Veredito(DESLIGOU, "HANGUP", c)
        if s in ("HUMAN", "NOTSURE"):
            return Veredito(PESSOA, s, c)
        return Veredito(PESSOA, "", "sem AMD")     # SEM_AMD: AMD desligado ou falhou


# Conclusões da Khomp (cabeçalho X-Khomp-Analytics-CC) -> (veredito, código AMD do evento). Vocabulário a
# confirmar com a Khomp no piloto (plano B.1): ajuste aqui, sem mexer no orquestrador (decisão do dono: fica
# assim até o piloto). O cabeçalho é lido no dialplan com PJSIP_RESPONSE_HEADER (a função existe na imagem; o teste
# de fumaça confere) e chega como 3º argumento do Stasis 'amd'.
MAPA_KHOMP_PADRAO = {
    "HUMAN": (PESSOA, "HUMAN"),
    "VOICEMAIL": (MAQUINA, "MACHINE"),
    "ANSWERING_MACHINE": (MAQUINA, "MACHINE"),
    "MACHINE": (MAQUINA, "MACHINE"),
    "SILENCE": (SILENCIO, "INITIALSILENCE"),
    "OPERATOR_MESSAGE": (MAQUINA, "MACHINE"),
    "FAX": (MAQUINA, "MACHINE"),
}


@dataclass
class KhompAnalytics(DetectorMaquina):
    """A Khomp segura o 200 OK até concluir e manda a conclusão em cabeçalho SIP; o AMD do Asterisk fica
    desligado. Sem cabeçalho (ou conclusão desconhecida), usa a `reserva` (padrão: AMD do Asterisk, que então
    precisa estar ligado — use KhompAnalytics(reserva=AmdAsterisk()) e usa_amd_asterisk=True no piloto)."""
    mapa: dict = field(default_factory=lambda: dict(MAPA_KHOMP_PADRAO))
    reserva: DetectorMaquina | None = None
    codigo = "khomp"

    @property
    def usa_amd_asterisk(self) -> bool:
        return self.reserva is not None and self.reserva.usa_amd_asterisk

    def classificar(self, amd_status, amd_causa="", khomp=""):
        k = (khomp or "").strip().upper()
        if k in self.mapa:
            tipo, amd = self.mapa[k]
            return Veredito(tipo, amd, f"khomp:{k}")
        if self.reserva is not None:
            return self.reserva.classificar(amd_status, amd_causa, "")
        return Veredito(PESSOA, "", f"khomp sem conclusão ({k or 'vazio'})")
