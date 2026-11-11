"""Medidor do ritmo da discagem (SQL 106, Power e Preditivo V1): contagens por empresa × carteira × janela de 5 min.

Cada tentativa encerrada (o evento classificado pelo motor/voz.py) entra na janela de 5 min do seu fim (horário de
Brasília): discada, atendida por pessoa (AMD pessoa), abandono (abandonada ou abandono_sem_robo: quem atendeu e não
teve agente), transferência sem operador (conversou, pediu humano e a fila não atendeu; NÃO é abandono), curta (a regra
da Anatel do motor: não completada, caixa postal/máquina ou até 6 s; o abandono conta sempre) e o mesmo por tronco.
O Plantão manda as janelas fechadas a cada minuto (voz_ritmo_amostras, por registrar_ritmo_voz), com o modo, a razão e
o retrato dos robôs da empresa. Só contagens: nenhum telefone, cliente ou conversa.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from motor import discagem as DG
from motor import voz as V

BALDE_S = 300
_FUSO = ZoneInfo("America/Sao_Paulo")
ABANDONOS = ("abandonada", "abandono_sem_robo")
TRANSF_SEM_OPERADOR = "transferencia_sem_operador"
# a regra da Anatel no medidor da VM: o abandono conta sempre como curta (PREDITIVO.md 3.5, decisão recomendada)
_CURTAS = {**DG.PADRAO["chamadas_curtas"], "abandono_conta": True}
MAX_PENDENTES = 2000            # banco fora: guarda até isto (as mais novas) e tenta de novo


def e_curta(desfecho: str | None, atendida: bool, billsec: int | None) -> bool:
    """A mesma regra do motor (motor/discagem.e_curta) com a duração só de ligação atendida."""
    return DG.e_curta(SimpleNamespace(resultado=desfecho, duracao_s=billsec if atendida else None), _CURTAS)


def inicio_janela(quando: datetime) -> datetime:
    """Início da janela de 5 min (horário de Brasília sem fuso, como o relógio da VM)."""
    q = quando.replace(second=0, microsecond=0)
    return q - timedelta(minutes=q.minute % (BALDE_S // 60))


@dataclass
class Balde:
    discadas: int = 0
    atendidas_pessoa: int = 0
    abandonos: int = 0
    transf_sem_operador: int = 0
    curtas: int = 0
    por_tronco: dict = field(default_factory=dict)     # tronco_id -> [discadas, atendidas_pessoa, abandonos, curtas]


@dataclass
class Medidor:
    baldes: dict = field(default_factory=dict)         # (empresa_id, credor_id, início) -> Balde
    pendentes: list = field(default_factory=list)      # linhas fechadas que o banco ainda não recebeu

    def contar(self, empresa_id: int, credor_id: int | None, tronco_id: int | None, desfecho: str | None,
               pessoa: bool, atendida: bool, billsec: int | None, quando: datetime) -> None:
        b = self.baldes.setdefault((empresa_id, credor_id, inicio_janela(quando)), Balde())
        ab = desfecho in ABANDONOS
        curta = e_curta(desfecho, atendida, billsec)
        b.discadas += 1
        b.atendidas_pessoa += int(pessoa)
        b.abandonos += int(ab and pessoa)
        b.transf_sem_operador += int(desfecho == TRANSF_SEM_OPERADOR)
        b.curtas += int(curta)
        if tronco_id is not None:
            t = b.por_tronco.setdefault(int(tronco_id), [0, 0, 0, 0])
            t[0] += 1
            t[1] += int(pessoa)
            t[2] += int(ab and pessoa)
            t[3] += int(curta)

    def fechar(self, agora: datetime, retrato, todos: bool = False) -> list[dict]:
        """As janelas que já acabaram (todas, com `todos`) viram linhas de voz_ritmo_amostras e saem da memória.
        retrato(empresa_id, credor_id) -> {modo, razao, conversas, reservas, linhas}."""
        fim = inicio_janela(agora)
        linhas = []
        for chave in sorted((k for k in self.baldes if todos or k[2] < fim), key=lambda k: (k[2], k[0], k[1] or 0)):
            emp, cred, ini = chave
            b = self.baldes.pop(chave)
            r = retrato(emp, cred) or {}
            linhas.append({
                "empresa_id": emp, "credor_id": cred, "janela": ini.replace(tzinfo=_FUSO).isoformat(),
                "modo": r.get("modo", "power"), "razao": round(float(r.get("razao", 1.0)), 2),
                "razao_config": round(float(r.get("razao_config", r.get("razao", 1.0))), 2),
                "estado": r.get("estado", "normal"),
                "discadas": b.discadas, "atendidas_pessoa": b.atendidas_pessoa, "abandonos": b.abandonos,
                "transf_sem_operador": b.transf_sem_operador, "curtas": b.curtas,
                "conversas": int(r.get("conversas", 0)), "reservas": int(r.get("reservas", 0)),
                "linhas": int(r.get("linhas", 0)),
                "por_tronco": [{"tronco_id": t, "discadas": v[0], "atendidas_pessoa": v[1], "abandonos": v[2],
                                "curtas": v[3]} for t, v in sorted(b.por_tronco.items())][:50]})
        return linhas

    def enviar(self, agora: datetime, retrato, gravar, todos: bool = False) -> int:
        """Fecha as janelas acabadas e manda as pendentes por gravar(linhas). Falhou: guarda (até MAX_PENDENTES, as
        mais novas) e devolve -1; senão, quantas linhas foram."""
        self.pendentes += self.fechar(agora, retrato, todos)
        self.pendentes = self.pendentes[-MAX_PENDENTES:]
        if not self.pendentes:
            return 0
        lote = self.pendentes[:2000]
        try:
            gravar(lote)
        except Exception:   # noqa: BLE001 — o chamador avisa; as linhas ficam para a próxima
            return -1
        self.pendentes = self.pendentes[len(lote):]
        return len(lote)


assert set(ABANDONOS) <= set(V.CURTA_SE_ABANDONO), "abandono do medidor fora da regra de curtas do motor"
