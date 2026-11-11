"""Freios de chamadas curtas no ritmo da VM (Power e Preditivo V6; PREDITIVO.md 3.7; Despacho Anatel 100/2026 e MP
1.396/2026, vigência 12/11/2026).

A regra: se num dia uma linha passar de 1.000 ligações, ou todas as linhas do CNPJ de 10.000, e 85 % ou mais forem
curtas (não completada, caixa postal/máquina ou até 6 s), a operadora bloqueia TODAS as linhas por 15 dias. O motor
já corta a lista da manhã; aqui a VM mede em tempo real, por linha (tronco/bina, a leitura mais restritiva de "acesso"
até o jurídico confirmar) e no total da empresa, e freia o ritmo bem antes:

  curtas < 70 %                       nada
  70 % a 80 %                         a razão cai de forma linear até 1,0 em 80 % (Power e Preditivo)
  ≥ 80 % e linha com ≥ 800 hoje       a linha para no dia ("Linha parada hoje"; volta amanhã)
  ≥ 80 % e empresa com ≥ 8.000 hoje   a empresa para de ligar no dia, em todas as linhas
Liberação manual (só o Admin, com motivo, auditada; SQL 109): os volumes de parada sobem para 950 por linha e 9.500 no
total, só naquele dia. Nunca troca a bina nem desvia para outra linha para contornar (a linha parada só sai da conta).
Para a redução da razão, a % só vale com amostra (MIN_VOLUME_RITMO ligações no dia na linha ou no total); para a parada,
os próprios volumes já são a amostra. O abandono conta sempre como curta (medidor.e_curta).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

AVISO, CORTE = 0.70, 0.80
LINHA_PARA, EMPRESA_PARA = 800, 8000
LINHA_LIBERADA, EMPRESA_LIBERADA = 950, 9500
MIN_VOLUME_RITMO = 100


@dataclass
class Contagem:
    total: int = 0
    curtas: int = 0

    @property
    def fracao(self) -> float:
        return self.curtas / self.total if self.total else 0.0

    def juntar(self, total: int, curtas: int) -> None:
        """Banco (o que já foi gravado) × memória: fica o maior de cada um (nunca soma duas vezes)."""
        self.total, self.curtas = max(self.total, int(total)), max(self.curtas, int(curtas))


@dataclass
class CurtasEmpresa:
    dia: date
    total: Contagem = field(default_factory=Contagem)
    troncos: dict = field(default_factory=dict)          # tronco_id -> Contagem
    liberado: bool = False

    def tronco(self, tid: int) -> Contagem:
        return self.troncos.setdefault(int(tid), Contagem())

    @property
    def limites(self) -> tuple[int, int]:
        return (LINHA_LIBERADA, EMPRESA_LIBERADA) if self.liberado else (LINHA_PARA, EMPRESA_PARA)


@dataclass
class Curtas:
    empresas: dict = field(default_factory=dict)          # empresa_id -> CurtasEmpresa (do dia)
    avisos: list = field(default_factory=list)           # frases novas para o alerta do núcleo
    _avisados: set = field(default_factory=set)

    def _de(self, empresa_id: int, dia: date) -> CurtasEmpresa:
        e = self.empresas.get(empresa_id)
        if e is None or e.dia != dia:                    # dia novo: tudo zera (a linha parada volta)
            e = self.empresas[empresa_id] = CurtasEmpresa(dia)
        return e

    def contar(self, empresa_id: int, tronco_id: int | None, curta: bool, quando: datetime) -> None:
        e = self._de(empresa_id, quando.date())
        e.total.total += 1
        e.total.curtas += int(curta)
        if tronco_id is not None:
            t = e.tronco(tronco_id)
            t.total += 1
            t.curtas += int(curta)
        self._avisar(empresa_id, e, tronco_id)

    def semear(self, empresa_id: int, dia: date, dados: dict) -> None:
        """O que o banco já tem do dia (curtas_hoje_voz, SQL 109): VM reiniciada não começa do zero."""
        e = self._de(empresa_id, dia)
        e.total.juntar(dados.get("total") or 0, dados.get("curtas") or 0)
        for t in dados.get("troncos") or []:
            if t.get("tronco_id") is not None:
                e.tronco(t["tronco_id"]).juntar(t.get("total") or 0, t.get("curtas") or 0)
        e.liberado = bool(dados.get("liberado")) or e.liberado

    # ---------------------------------------------------------------- decisões
    def _hoje(self, empresa_id: int, agora: datetime) -> CurtasEmpresa | None:
        e = self.empresas.get(empresa_id)
        return e if e is not None and e.dia == agora.date() else None

    def empresa_parada(self, empresa_id: int, agora: datetime) -> bool:
        e = self._hoje(empresa_id, agora)
        return e is not None and e.total.total >= e.limites[1] and e.total.fracao >= CORTE

    def tronco_parado(self, empresa_id: int, tronco_id: int, agora: datetime) -> bool:
        e = self._hoje(empresa_id, agora)
        if e is None or int(tronco_id) not in e.troncos:
            return False
        t = e.troncos[int(tronco_id)]
        return t.total >= e.limites[0] and t.fracao >= CORTE

    def pior_fracao(self, empresa_id: int, agora: datetime) -> float:
        """A maior % de curtas com amostra: o total da empresa ou alguma linha ainda ativa."""
        e = self._hoje(empresa_id, agora)
        if e is None:
            return 0.0
        fr = [c.fracao for tid, c in e.troncos.items()
              if c.total >= MIN_VOLUME_RITMO and not self.tronco_parado(empresa_id, tid, agora)]
        if e.total.total >= MIN_VOLUME_RITMO:
            fr.append(e.total.fracao)
        return max(fr, default=0.0)

    def razao(self, empresa_id: int, razao: float, agora: datetime) -> float:
        """A razão depois do freio de curtas: igual abaixo de 70 %, cai até 1,0 em 80 %."""
        f = self.pior_fracao(empresa_id, agora)
        if f <= AVISO or razao <= 1.0:
            return razao
        if f >= CORTE:
            return 1.0
        return 1.0 + (razao - 1.0) * (CORTE - f) / (CORTE - AVISO)

    def estado(self, empresa_id: int, agora: datetime) -> str | None:
        """parado (empresa parada ou alguma linha parada hoje) | reduzido (70 % ou mais) | None."""
        e = self._hoje(empresa_id, agora)
        if e is None:
            return None
        if self.empresa_parada(empresa_id, agora) or any(self.tronco_parado(empresa_id, t, agora) for t in e.troncos):
            return "parado"
        return "reduzido" if self.pior_fracao(empresa_id, agora) > AVISO else None

    def _avisar(self, empresa_id: int, e: CurtasEmpresa, tronco_id: int | None) -> None:
        def uma(chave, txt):
            if chave not in self._avisados:
                self._avisados.add(chave)
                self.avisos.append(txt)
        agora = datetime.combine(e.dia, datetime.min.time())
        if self.empresa_parada(empresa_id, agora):
            uma((empresa_id, e.dia, "empresa"), f"empresa {empresa_id}: {e.total.total} ligações hoje com "
                f"{e.total.fracao:.0%} curtas — a empresa parou de ligar até amanhã (regra de chamadas curtas)")
        if tronco_id is not None and self.tronco_parado(empresa_id, tronco_id, agora):
            t = e.troncos[int(tronco_id)]
            uma((empresa_id, e.dia, "tronco", int(tronco_id)), f"empresa {empresa_id}: linha (tronco {tronco_id}) com "
                f"{t.total} ligações hoje e {t.fracao:.0%} curtas — parada até amanhã (regra de chamadas curtas)")
        if e.total.total >= MIN_VOLUME_RITMO and e.total.fracao > AVISO:
            uma((empresa_id, e.dia, "aviso"), f"empresa {empresa_id}: curtas em {e.total.fracao:.0%} hoje — o ritmo "
                "cai sozinho a partir de 70 %")
