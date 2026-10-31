"""Lote da Lista do dia e a guarda antes de cada INVITE.

A Lista do dia é o discador_mailing.csv do motor (motor/discagem.py: CAMPOS_MAILING, uma linha por telefone, já
na ordem de discagem, com a janela do número em horário de Brasília calculada pela UF/DDD). O orquestrador não
recalcula a régua: só confere, na hora de discar, o que pode ter mudado desde a manhã:
  - janela do número (janela_local) e o "agendar_para" do retorno agendado;
  - tentativas por número e por cliente no dia e o intervalo entre tentativas (ocupado tem o seu);
  - cliente que já teve contato hoje (CPC, promessa, recusa, opt-out…) não recebe outra ligação;
  - número de reserva só depois que os principais do cliente se esgotaram sem contato;
  - a guarda extra do motor (callable), para as regras de tempo real (ex.: "não ligar" recebido agora).
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from motor import voz as V

# desfechos que encerram o CLIENTE no dia (houve gente do outro lado ou pedido explícito)
ENCERRA_CLIENTE = frozenset(d.chave for d in V.DESFECHOS if d.e_cpc) | {
    "opt_out", "recado", "atendida_terceiro_desconhece", "atendida_sem_cpc", "atendeu_desligou",
    "desligou_sem_conversar", "abandonada"}
# desfechos que encerram o NÚMERO no dia (não adianta tentar de novo hoje)
ENCERRA_NUMERO = frozenset({"numero_inexistente", "inexistente_voz", "fax", "rejeitada", "opt_out"})


@dataclass
class ItemLote:
    id_cliente: str
    telefone: str
    ordem: int = 1
    reserva: bool = False
    tentativas_max_numero: int = 3
    tentativas_max_cliente: int = 6
    intervalo_min: int = 60
    intervalo_ocupado: int = 15
    janela_local: tuple[str, str] | None = None
    uf: str = ""
    prioridade: str = ""
    id_acao: str = ""
    agendar_para: datetime | None = None
    # estado do dia
    tentativas: int = 0
    nao_antes_de: datetime | None = None
    encerrado: bool = False


def _janela(txt: str):
    t = (txt or "").strip()
    if not t or "-" not in t:
        return None
    de, ate = t.split("-", 1)
    return de.strip()[:5], ate.strip()[:5]


def _quando(txt: str):
    t = (txt or "").strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    return None


def ler_mailing(caminho: str | Path) -> list[ItemLote]:
    """discador_mailing.csv (separador ';', cabeçalho = CAMPOS_MAILING) -> itens na ordem do arquivo."""
    itens = []
    with open(caminho, newline="", encoding="utf-8") as f:
        for l in csv.DictReader(f, delimiter=";"):
            itens.append(ItemLote(
                id_cliente=l["id_cliente"], telefone=l["telefone"], ordem=int(l.get("ordem") or 1),
                reserva=str(l.get("reserva") or "0") == "1",
                tentativas_max_numero=int(l.get("tentativas_max_numero") or 3),
                tentativas_max_cliente=int(l.get("tentativas_max_cliente") or 6),
                intervalo_min=int(l.get("intervalo_min") or 60), intervalo_ocupado=int(l.get("intervalo_ocupado") or 15),
                janela_local=_janela(l.get("janela_local")), uf=l.get("uf") or "", prioridade=l.get("prioridade") or "",
                id_acao=l.get("id_acao") or "", agendar_para=_quando(l.get("agendar_para"))))
    return itens


@dataclass
class Guarda:
    """Decide se o item pode ser discado AGORA (horário de Brasília, sem fuso no datetime)."""
    extra: object = None                                   # callable(item, agora) -> motivo | None
    tentativas_cliente: dict = field(default_factory=dict)
    clientes_encerrados: set = field(default_factory=set)

    def motivo(self, item: ItemLote, agora: datetime) -> str | None:
        """None = pode discar; senão, o motivo (texto curto, sem o número)."""
        if item.encerrado:
            return "número encerrado no dia"
        if item.id_cliente in self.clientes_encerrados:
            return "cliente já teve contato hoje"
        if item.tentativas >= item.tentativas_max_numero:
            return "tentativas do número esgotadas"
        if self.tentativas_cliente.get(item.id_cliente, 0) >= item.tentativas_max_cliente:
            return "tentativas do cliente esgotadas"
        if item.janela_local is None:
            return "número sem janela hoje"
        hhmm = agora.strftime("%H:%M")
        if not item.janela_local[0] <= hhmm < item.janela_local[1]:
            return "fora da janela da UF/DDD"
        if item.agendar_para and agora < item.agendar_para:
            return "retorno agendado para mais tarde"
        if item.nao_antes_de and agora < item.nao_antes_de:
            return "intervalo entre tentativas"
        if self.extra is not None:
            m = self.extra(item, agora)
            if m:
                return m
        return None

    def registrar(self, item: ItemLote, desfecho: str | None, agora: datetime) -> None:
        """Depois da tentativa: conta, agenda a próxima ou encerra número/cliente."""
        item.tentativas += 1
        self.tentativas_cliente[item.id_cliente] = self.tentativas_cliente.get(item.id_cliente, 0) + 1
        if desfecho in ENCERRA_CLIENTE:
            self.clientes_encerrados.add(item.id_cliente)
        if desfecho in ENCERRA_NUMERO or desfecho in ENCERRA_CLIENTE:
            item.encerrado = True
            return
        minutos = item.intervalo_ocupado if desfecho == "ocupado" else item.intervalo_min
        item.nao_antes_de = agora + timedelta(minutes=minutos)


class Lote:
    """Itens de uma empresa no dia, na ordem da Lista. proximo() devolve o primeiro que a guarda libera; o número
    de reserva só entra quando os principais do mesmo cliente acabaram (encerrados ou esgotados) sem contato."""

    def __init__(self, empresa_id: int, itens: list[ItemLote], guarda: Guarda | None = None):
        self.empresa_id = empresa_id
        self.itens = itens
        self.guarda = guarda or Guarda()
        self.em_voo: set[int] = set()            # índices discando agora
        self.motivos: dict[str, int] = {}         # contagem do porquê não discou (observabilidade)

    def _principais_acabaram(self, idc: str) -> bool:
        for it in self.itens:
            if it.id_cliente == idc and not it.reserva and not it.encerrado and \
                    it.tentativas < it.tentativas_max_numero:
                return False
        return True

    def proximo(self, agora: datetime) -> tuple[int, ItemLote] | None:
        clientes_em_voo = {self.itens[i].id_cliente for i in self.em_voo}
        for i, it in enumerate(self.itens):
            if i in self.em_voo or it.id_cliente in clientes_em_voo:
                continue
            m = self.guarda.motivo(it, agora)
            if m is None and it.reserva and not self._principais_acabaram(it.id_cliente):
                m = "reserva: principais ainda em curso"
            if m is None:
                return i, it
        return None

    def contar_motivos(self, agora: datetime) -> dict[str, int]:
        c: dict[str, int] = {}
        for it in self.itens:
            m = self.guarda.motivo(it, agora)
            if m:
                c[m] = c.get(m, 0) + 1
        return c

    def pendentes(self, agora: datetime) -> int:
        """Itens que ainda podem ser discados hoje (agora ou mais tarde)."""
        return sum(1 for it in self.itens if not it.encerrado and it.id_cliente not in self.guarda.clientes_encerrados
                   and it.tentativas < it.tentativas_max_numero
                   and self.guarda.tentativas_cliente.get(it.id_cliente, 0) < it.tentativas_max_cliente
                   and it.janela_local is not None and agora.strftime("%H:%M") < it.janela_local[1])
