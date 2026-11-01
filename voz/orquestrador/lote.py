"""Lote da Lista do dia e a guarda antes de cada INVITE.

A Lista do dia é o discador_mailing.csv do motor (motor/discagem.py: CAMPOS_MAILING, uma linha por telefone, já
na ordem de discagem, com a janela do número em horário de Brasília calculada pela UF/DDD). O orquestrador não
recalcula a régua: só confere, na hora de discar, o que pode ter mudado desde a manhã:
  - janela do número (janela_local) e o "agendar_para" do retorno agendado;
  - tentativas por número e por cliente no dia e o intervalo entre tentativas (ocupado tem o seu);
  - cliente que já teve contato hoje (CPC, promessa, recusa, opt-out…) não recebe outra ligação;
  - número de reserva só depois que os principais do cliente se esgotaram sem contato;
  - a guarda extra do motor (callable), para as regras de tempo real (ex.: "não ligar" recebido agora).

Regras da carteira (SQL 65, protótipo funcional aprovado; credores.discagem normalizado pelo motor, Lote.regras):
  - sem as chaves novas, tudo como antes (paridade): o número volta depois de intervalo_min (ocupado: o dele) até as
    tentativas do dia, na ordem do arquivo;
  - por_situacao: o máximo no dia no mesmo número da situação da última tentativa;
  - por_sinalizacao: depois da tentativa, a linha da sinalização decide. 1) finaliza o cliente? 2) senão, redisca o
    MESMO telefone (depois de depois_min — o único intervalo da situação —, até max vezes, com a prioridade); 3)
    esgotadas, depois: próximo telefone (espera), próximo cliente ou finaliza; até o horário limite e a janela do
    número, sem passar das tentativas por número e por cliente. Fixos: CPC, promessa, recusa, "não ligar" finalizam;
    pediu retorno finaliza; inexistente e pessoa errada não rediscam; sem crédito e bloqueio pausam a rota e alertam;
  - modo_discagem: vertical (esgota os telefones do cliente, até max_telefones_dia) ou horizontal com spins (uma
    passagem do mailing por spin, spin N → telefone N por padrão; o spin N só abre quando o N−1 passou pelo lote
    inteiro, depois do intervalo e do início do spin);
  - prioridade das voltas: topo fura a fila das 1ªs tentativas; normal vem depois delas; fim por último.
Cada decisão (finaliza, redisca, próximo telefone, próximo cliente ou fora, com o motivo) vai para voz_resubmits
(só destino_hash, nunca o número). "Reenviar agora" e "Reciclar mailing" passam pelas mesmas regras.

As variáveis da fala por cliente (primeiro_nome, saldo, vencimento… só as de variaveis_voz(), nunca CPF) vêm das
colunas extras do ids/agente_voz.csv (rodar_dia.exportar_ids) e ficam só em ItemLote.variaveis, na memória da VM
durante o lote: fora do repr, dos eventos, do banco e de qualquer log.
"""
from __future__ import annotations

import csv
import dataclasses
import hashlib
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from motor import discagem as DG
from motor import voz as V

# desfechos que encerram o CLIENTE no dia (houve gente do outro lado ou pedido explícito) — o de hoje
ENCERRA_CLIENTE = frozenset(d.chave for d in V.DESFECHOS if d.e_cpc) | {
    "opt_out", "recado", "atendida_terceiro_desconhece", "atendida_sem_cpc", "atendeu_desligou",
    "desligou_sem_conversar", "abandonada"}
# desfechos que encerram o NÚMERO no dia (não adianta tentar de novo hoje)
ENCERRA_NUMERO = frozenset({"numero_inexistente", "inexistente_voz", "fax", "rejeitada", "opt_out"})
# encerram o cliente hoje, mas a regra por sinalização (ou o "Reenviar agora") pode reabrir: ninguém falou de verdade
REABRIVEIS = frozenset({"atendeu_desligou", "desligou_sem_conversar", "abandonada", "atendida_terceiro_desconhece",
                        "retorno_agendado", "recado"})
# com a regra nova, só estes finalizam sempre (o resto é a linha da sinalização)
FINALIZA_SEMPRE = frozenset(DG.FINALIZA_SEMPRE)
RANK = {"topo": 0, "normal": 2, "fim": 3}       # 1 = primeiras tentativas (e a retentativa de hoje)
SEM_CONTATO = frozenset(DG.SITUACOES)


def hash_destino(telefone: str) -> str:
    """sha-256 do número só com dígitos, sem o 55 (igual a nuvem/mensageria.hash_destino e public.hash_destino)."""
    d = re.sub(r"\D", "", telefone or "")
    d = d[2:] if re.fullmatch(r"55\d{10,11}", d) else d
    return hashlib.sha256(d.encode("utf-8")).hexdigest()


@dataclass
class Volta:
    """Uma volta ao mailing no mesmo dia (rediscagem da regra, pedido à mão ou reciclagem)."""
    nao_antes_de: datetime
    prioridade: str = "normal"
    ate: datetime | None = None
    origem: str = "rediscagem"            # rediscagem | manual | reciclagem
    situacao_origem: str | None = None
    ref: str = field(default_factory=lambda: uuid.uuid4().hex)
    pedido_id: int | None = None
    reabre_cliente: bool = False


class RegrasLote:
    """Regras da carteira que a VM aplica (credores.discagem normalizado pelo motor). None no Lote = paridade total."""

    CHAVES = ("por_situacao", "falhas_tecnicas", "por_sinalizacao", "modo_discagem", "reciclagem_auto")

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.regra_nova = cfg.get("por_sinalizacao") is not None
        self.modo = cfg.get("modo_discagem")

    @classmethod
    def da_carteira(cls, discagem) -> "RegrasLote | None":
        if not isinstance(discagem, dict) or not any(k in discagem for k in cls.CHAVES):
            return None
        cfg, _ = DG.normalizar(discagem)
        return cls(cfg)

    def max_dia(self, sit: str | None) -> int | None:
        if sit is None or sit not in (self.cfg.get("por_situacao") or {}):
            return None
        return DG.regra_situacao(self.cfg, sit)["max_dia"]

    def sinal(self, sinal: str | None) -> dict | None:
        return DG.regra_sinalizacao(self.cfg, sinal)

    def intervalo_efetivo(self, sit: str | None, item: "ItemLote", sinal: str | None = None) -> int:
        r = self.sinal(sinal) if sinal else None
        if r is not None:
            return r["rediscar"]["depois_min"]
        return item.intervalo_ocupado if sit == "ocupado" else item.intervalo_min

    @property
    def tnum(self) -> int:
        return self.cfg["tentativas_numero_dia"]

    @property
    def tcli(self) -> int:
        return self.cfg.get("tentativas_cliente_dia") or 3

    @property
    def horizontal(self) -> bool:
        return bool(self.modo) and self.modo["modo"] == "horizontal"


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
    # variáveis da fala (variaveis_voz()); só memória: fora do repr e da comparação (nunca vai para log)
    variaveis: dict = field(default_factory=dict, repr=False, compare=False)
    # estado do dia
    tentativas: int = 0
    nao_antes_de: datetime | None = None
    encerrado: bool = False
    situacao: str | None = None          # situação da última tentativa (motor/discagem.situacao_de)
    desfecho: str | None = None          # desfecho da última tentativa
    volta: Volta | None = None           # volta pendente (rediscagem, Reenviar agora ou reciclagem)
    onda_chave: tuple | None = None      # onda da última tentativa
    spin: int | None = None              # horizontal: em qual spin este telefone sai
    rediscagens: int = 0                 # rediscagens da regra por sinalização já feitas neste item
    adiado: bool = False                 # vertical: "próximo cliente" mandou os outros telefones para o fim


def ler_variaveis(linha: dict) -> dict:
    """As colunas de variaveis_voz() que a linha traz preenchidas (o resto do arquivo, CPF incluído, é ignorado)."""
    return {k: str(linha[k]).strip()[:120] for k in V.VARIAVEIS_VOZ if (linha.get(k) or "").strip()}


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
                id_acao=l.get("id_acao") or "", agendar_para=_quando(l.get("agendar_para")),
                variaveis=ler_variaveis(l)))
    return itens


@dataclass
class Guarda:
    """Decide se o item pode ser discado AGORA (horário de Brasília, sem fuso no datetime)."""
    extra: object = None                                   # callable(item, agora) -> motivo | None
    tentativas_cliente: dict = field(default_factory=dict)
    clientes_encerrados: set = field(default_factory=set)
    so_voltas: bool = False                                # regra nova: depois da tentativa, só com volta
    reabriveis: set = field(default_factory=set)           # clientes encerrados só por desfecho reabrível
    tentativas_numero: dict = field(default_factory=dict)  # (cliente, telefone) -> tentativas (spins repetem o número)
    desfechos_cliente: dict = field(default_factory=dict)  # cliente -> desfechos do dia (reciclagem)

    def motivo(self, item: ItemLote, agora: datetime) -> str | None:
        """None = pode discar; senão, o motivo (texto curto, sem o número)."""
        if item.encerrado:
            return "número encerrado no dia"
        v = item.volta
        if item.id_cliente in self.clientes_encerrados and not (v is not None and v.reabre_cliente):
            return "cliente já teve contato hoje"
        if v is None and self.so_voltas and item.tentativas > 0:
            return "sem volta agendada"
        if max(item.tentativas, self.tentativas_numero.get((item.id_cliente, item.telefone), 0)) \
                >= item.tentativas_max_numero:
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
        if v is not None and agora < v.nao_antes_de:
            return "intervalo entre tentativas"
        if v is not None and v.ate is not None and agora >= v.ate:
            return "volta fora do horário limite"
        if self.extra is not None:
            m = self.extra(item, agora)
            if m:
                return m
        return None

    def contar(self, item: ItemLote, desfecho: str | None, causa_sip: int | None = None) -> None:
        item.tentativas += 1
        item.desfecho = desfecho
        item.situacao = DG.situacao_de(desfecho, causa_sip)
        self.tentativas_cliente[item.id_cliente] = self.tentativas_cliente.get(item.id_cliente, 0) + 1
        k = (item.id_cliente, item.telefone)
        self.tentativas_numero[k] = self.tentativas_numero.get(k, 0) + 1
        self.desfechos_cliente.setdefault(item.id_cliente, set()).add(desfecho)

    def encerrar_cliente(self, idc: str, desfecho: str | None) -> None:
        self.clientes_encerrados.add(idc)
        if desfecho in REABRIVEIS:
            self.reabriveis.add(idc)
        else:
            self.reabriveis.discard(idc)

    def registrar(self, item: ItemLote, desfecho: str | None, agora: datetime, regras: RegrasLote | None = None,
                  causa_sip: int | None = None) -> None:
        """Depois da tentativa (retentativa de hoje): conta, agenda a próxima ou encerra número/cliente. Com o máximo
        por situação da carteira, o número para no máximo da situação."""
        self.contar(item, desfecho, causa_sip)
        if desfecho in ENCERRA_CLIENTE:
            self.encerrar_cliente(item.id_cliente, desfecho)
        if desfecho in ENCERRA_NUMERO or desfecho in ENCERRA_CLIENTE:
            item.encerrado = True
            return
        minutos = item.intervalo_ocupado if desfecho == "ocupado" else item.intervalo_min
        if regras is not None:
            mx = regras.max_dia(item.situacao)
            if mx is not None and item.tentativas >= mx:
                item.encerrado = True
                return
        item.nao_antes_de = agora + timedelta(minutes=minutos)


class Lote:
    """Itens de uma empresa no dia, na ordem da Lista. proximo() devolve o primeiro que a guarda libera; o número
    de reserva só entra quando os principais do mesmo cliente acabaram (encerrados ou esgotados) sem contato.
    Ordem: voltas topo > 1ªs tentativas (e a retentativa de hoje, na ordem do arquivo) > voltas normal > voltas fim
    (e os telefones adiados por "próximo cliente"). Sem volta nenhuma, é a ordem do arquivo (paridade). No
    horizontal, o spin N só abre quando o spin N−1 passou pelo lote inteiro, depois do intervalo e do início."""

    def __init__(self, empresa_id: int, itens: list[ItemLote], guarda: Guarda | None = None,
                 credor_id: int | None = None, canal: str = "agente_voz", regras: RegrasLote | None = None):
        if canal not in ("agente_voz", "discador"):
            raise ValueError(f"canal de voz desconhecido: {canal}")
        self.empresa_id = empresa_id
        self.credor_id = credor_id
        self.canal = canal          # canal da ação no motor (o evento volta no mesmo canal, para a atribuição)
        self.itens = itens
        self.guarda = guarda or Guarda()
        self.em_voo: set[int] = set()            # índices discando agora
        self.motivos: dict[str, int] = {}         # contagem do porquê não discou (observabilidade)
        self.lote_id: int | None = None           # voz_lotes.id (o Plantão pede ao banco: lote_voz_do_dia)
        self.decisoes: list[dict] = []            # para voz_resubmits (o registro esvazia)
        self.alertas: list[str] = []              # o núcleo repassa (sem crédito / bloqueio: pausa a rota)
        # ondas do dia: chave (origem, passada, situacao_origem, prioridade, pedido_id) -> contagens e id do banco
        self.ondas: dict[tuple, dict] = {}
        self._voltas: dict[int, str] = {}         # índice -> prioridade da volta pendente
        self._idx: dict[int, int] = {}
        self._fim_spin: dict[int, datetime] = {}  # horizontal: quando o spin acabou de passar pelo lote
        self.reciclagem_auto_em = None            # dia da última reciclagem automática
        self.regras = None
        self.aplicar_regras(regras)

    @property
    def chave(self) -> tuple:
        return (self.empresa_id, self.credor_id, self.canal)

    # ------------------------------------------------------------ regras da carteira
    def aplicar_regras(self, regras: RegrasLote | None) -> None:
        """Regras da carteira (credores.discagem). Com a regra nova, as tentativas nunca passam das da carteira; o
        modo de discagem monta os spins (horizontal) ou corta os telefones por cliente (vertical)."""
        self.regras = regras
        self.guarda.so_voltas = bool(regras and regras.regra_nova)
        if regras is not None and (regras.regra_nova or regras.modo):
            for it in self.itens:
                it.tentativas_max_numero = min(it.tentativas_max_numero, regras.tnum)
                it.tentativas_max_cliente = min(it.tentativas_max_cliente, regras.tcli)
        if regras is not None and regras.modo and not any(it.tentativas for it in self.itens):
            self.itens = self._montar_modo(self.itens, regras.modo)
        self._idx = {}
        self.ondas = {}
        if self.itens:
            self._onda(("regua", 1, None, "normal", None))["total"] = sum(1 for it in self.itens if (it.spin or 1) == 1)

    @staticmethod
    def _montar_modo(itens: list[ItemLote], modo: dict) -> list[ItemLote]:
        por_cli: dict[str, list[ItemLote]] = {}
        for it in itens:
            if not it.reserva:
                por_cli.setdefault(it.id_cliente, []).append(it)
        reservas = [it for it in itens if it.reserva]
        if modo["modo"] == "vertical":            # até max_telefones_dia por cliente, na ordem da Lista
            corte = {c: {id(x) for x in sorted(l, key=lambda x: x.ordem)[:modo["max_telefones_dia"]]}
                     for c, l in por_cli.items()}
            return [it for it in itens if it.reserva or id(it) in corte[it.id_cliente]]
        spins = modo["spins"]
        saida: list[ItemLote] = []
        for r in spins["regras"][:spins["quantidade"]]:
            n, tel = r["spin"], r["telefone"]
            for c, lista in por_cli.items():
                fones = sorted(lista, key=lambda x: x.ordem)
                usados = {x.telefone for x in saida if x.id_cliente == c}
                if tel.startswith("t"):
                    i = int(tel[1:]) - 1
                elif tel == "nao_tentado":
                    i = next((k for k, x in enumerate(fones) if x.telefone not in usados), len(fones))
                else:                              # historico: o melhor da Lista (a nota já ordena)
                    i = 0
                if i >= len(fones):
                    if modo["telefone_ausente"] == "pula":
                        continue
                    i = i % len(fones)             # vai para o próximo disponível (o cliente repete o número)
                saida.append(dataclasses.replace(fones[i], spin=n, tentativas=0))
        return saida + reservas

    def _spins_abertos(self, agora: datetime) -> set[int] | None:
        """Horizontal: os spins que já podem discar (None = sem spins)."""
        if not (self.regras and self.regras.horizontal):
            return None
        spins = self.regras.modo["spins"]
        pend: dict[int, bool] = {}
        g = self.guarda
        for it in self.itens:
            if it.spin is None:
                continue
            vivo = not it.encerrado and (it.tentativas == 0 or it.volta is not None) \
                and (it.id_cliente not in g.clientes_encerrados or (it.volta and it.volta.reabre_cliente)) \
                and it.janela_local is not None and agora.strftime("%H:%M") < it.janela_local[1] \
                and g.tentativas_cliente.get(it.id_cliente, 0) < it.tentativas_max_cliente
            pend[it.spin] = pend.get(it.spin, False) or vivo
        abertos = set()
        inicio = {r["spin"]: r["inicio"] for r in spins["regras"]}
        for n in range(1, spins["quantidade"] + 1):
            ini = inicio.get(n)
            if ini and agora.strftime("%H:%M") < ini:
                break
            if n > 1:
                if pend.get(n - 1):
                    break
                fim = self._fim_spin.setdefault(n - 1, agora)
                if agora < fim + timedelta(minutes=spins["intervalo_min"]):
                    break
            abertos.add(n)
        return abertos

    # ------------------------------------------------------------ escolha do próximo
    def _indice(self, item: ItemLote) -> int:
        if len(self._idx) != len(self.itens):
            self._idx = {id(x): i for i, x in enumerate(self.itens)}
        return self._idx[id(item)]

    def _onda(self, chave: tuple) -> dict:
        return self.ondas.setdefault(chave, {"id": None, "total": 0, "encerradas": 0, "mudou": True})

    def _principais_acabaram(self, idc: str) -> bool:
        for it in self.itens:
            if it.id_cliente == idc and not it.reserva and not it.encerrado and \
                    it.tentativas < it.tentativas_max_numero and (not self.guarda.so_voltas or it.tentativas == 0):
                return False
        return True

    def _pode(self, i: int, it: ItemLote, agora: datetime, clientes_em_voo: set, abertos,
              com_volta: set = frozenset()) -> bool:
        if i in self.em_voo or it.id_cliente in clientes_em_voo:
            return False
        # regra nova fora do horizontal: o telefone atual termina a sequência (rediscagens) antes do próximo
        if it.volta is None and it.tentativas == 0 and it.id_cliente in com_volta:
            return False
        if abertos is not None and it.spin is not None and it.spin not in abertos and it.volta is None:
            return False
        m = self.guarda.motivo(it, agora)
        if m is None and it.reserva and it.volta is None and not self._principais_acabaram(it.id_cliente):
            m = "reserva: principais ainda em curso"
        return m is None

    def proximo(self, agora: datetime) -> tuple[int, ItemLote] | None:
        clientes_em_voo = {self.itens[i].id_cliente for i in self.em_voo}
        abertos = self._spins_abertos(agora)
        voltas = sorted(self._voltas.items(), key=lambda x: (RANK[x[1]], x[0])) if self._voltas else []
        com_volta = {self.itens[i].id_cliente for i, _ in voltas} \
            if self.regras and self.regras.regra_nova and not self.regras.horizontal else frozenset()
        for i, pri in voltas:
            if pri == "topo" and self._pode(i, self.itens[i], agora, clientes_em_voo, abertos):
                return i, self.itens[i]
        adiados = []
        for i, it in enumerate(self.itens):
            if it.volta is None:
                if it.adiado:
                    adiados.append(i)
                elif self._pode(i, it, agora, clientes_em_voo, abertos, com_volta):
                    return i, it
        for i, pri in voltas:
            if pri == "normal" and self._pode(i, self.itens[i], agora, clientes_em_voo, abertos):
                return i, self.itens[i]
        for i in [i for i, pri in voltas if pri == "fim"] + adiados:
            if self._pode(i, self.itens[i], agora, clientes_em_voo, abertos, com_volta if i in adiados else frozenset()):
                return i, self.itens[i]
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
        g = self.guarda
        return sum(1 for it in self.itens if not it.encerrado
                   and (it.id_cliente not in g.clientes_encerrados or (it.volta and it.volta.reabre_cliente))
                   and (not g.so_voltas or it.tentativas == 0 or it.volta is not None)
                   and max(it.tentativas, g.tentativas_numero.get((it.id_cliente, it.telefone), 0)) < it.tentativas_max_numero
                   and g.tentativas_cliente.get(it.id_cliente, 0) < it.tentativas_max_cliente
                   and it.janela_local is not None and agora.strftime("%H:%M") < it.janela_local[1])

    # ------------------------------------------------------------ tentativa: começo e fim
    def iniciar(self, idx: int, agora: datetime) -> dict:
        """O item vai ser discado: consome a volta e diz a passada (tentativa do cliente no dia), a situação de origem,
        a onda e a decisão que gerou a volta."""
        it = self.itens[idx]
        v, it.volta = it.volta, None
        self._voltas.pop(idx, None)
        g = self.guarda
        passada = g.tentativas_cliente.get(it.id_cliente, 0) + 1
        ult = next((x.situacao for x in reversed(self.itens) if x.id_cliente == it.id_cliente and x.situacao), None)
        if v is not None:
            chave = (v.origem, passada, v.situacao_origem, v.prioridade, v.pedido_id)
            if v.reabre_cliente:
                g.clientes_encerrados.discard(it.id_cliente)
            sit, ref = v.situacao_origem, v.ref
        else:
            sit, ref = (it.situacao or ult if passada > 1 else None), None
            origem = "spin" if (it.spin or 1) > 1 else "regua"
            chave = (origem, it.spin or passada, sit, "normal", None) if origem == "spin" else ("regua", passada, sit, "normal", None)
            if passada > 1 or origem == "spin":       # retentativa de hoje ou spin: a onda cresce quando a tentativa sai
                o = self._onda(chave)
                o["total"] += 1
                o["mudou"] = True
        it.onda_chave = chave
        return {"passada": min(passada, 50), "situacao_origem": sit, "resubmit_ref": ref, "onda_chave": chave}

    def registrar(self, item: ItemLote, desfecho: str | None, agora: datetime, causa_sip: int | None = None,
                  retorno_em: datetime | None = None, id_chamada: str | None = None) -> None:
        """Fim da tentativa: conta na onda e decide (retentativa de hoje ou a regra por sinalização)."""
        if item.onda_chave is not None:
            o = self._onda(item.onda_chave)
            o["encerradas"] += 1
            o["mudou"] = True
        g, r = self.guarda, self.regras
        if r is None or not r.regra_nova:
            g.registrar(item, desfecho, agora, r, causa_sip)
            return
        g.contar(item, desfecho, causa_sip)
        item.nao_antes_de = None                         # com a regra nova, quem decide a hora é a volta
        sinal = DG.sinalizacao_de(desfecho, causa_sip)
        sit = item.situacao
        if desfecho in FINALIZA_SEMPRE or (sinal is None and desfecho in ENCERRA_CLIENTE):
            g.encerrar_cliente(item.id_cliente, desfecho)
            item.encerrado = True
            return
        if sinal in DG.PAUSA_ROTA:
            self.alertas.append(f"empresa {self.empresa_id}: {'sem crédito na operadora' if sinal == 'sem_credito' else 'bloqueio de originação'}"
                                " — a rota fica em pausa até a equipe resolver")
            return
        if desfecho in ENCERRA_NUMERO or sinal in ("numero_inexistente", "pessoa_errada"):
            item.encerrado = True                       # o número não serve hoje; o cliente segue pela linha
        regra = r.sinal(sinal)
        if regra is None:                               # desfecho sem linha (mudo, rejeitada, fax): a retentativa de hoje
            if not item.encerrado:
                self._volta(item, sit, agora, origem="rediscagem", prioridade="normal",
                            depois=r.intervalo_efetivo(sit, item), ate=None, decisao="redisca", id_chamada=id_chamada)
            return
        dec = {"sit": sit, "id_chamada": id_chamada}
        if regra["finaliza"]:
            g.encerrar_cliente(item.id_cliente, desfecho)
            self._log(item, item, sit, "finaliza", None, agora, "auto", None, id_chamada)
            return
        red = regra["rediscar"]
        if red["ativo"] and not item.encerrado and item.rediscagens < red["max"]:
            motivo = self._volta(item, sit, agora, origem="rediscagem", prioridade=red["prioridade"],
                                 depois=red["depois_min"], ate=regra["ate"], decisao="redisca", id_chamada=id_chamada,
                                 log_fora=False)
            if motivo is None:
                item.rediscagens += 1
                return
            if motivo != "max_dia":
                self._log(item, item, sit, "fora", motivo, agora, "auto", None, id_chamada)
                return
        self._depois(item, regra, agora, dec)

    def _depois(self, item: ItemLote, regra: dict, agora: datetime, dec: dict) -> None:
        """Esgotadas as rediscagens: próximo telefone (com espera), próximo cliente ou finaliza."""
        acao, espera = regra["depois"]["acao"], regra["depois"]["espera_min"]
        g = self.guarda
        if acao == "finaliza":
            g.encerrar_cliente(item.id_cliente, item.desfecho)
            self._log(item, item, dec["sit"], "finaliza", None, agora, "auto", None, dec["id_chamada"])
            return
        horizontal = bool(self.regras and self.regras.horizontal)
        outros = [x for x in self.itens if x.id_cliente == item.id_cliente and x is not item and not x.reserva
                  and not x.encerrado and x.tentativas == 0 and x.telefone != item.telefone
                  and (not horizontal or x.spin == item.spin)]
        if acao == "proximo_telefone":
            if outros and espera:
                outros[0].nao_antes_de = agora + timedelta(minutes=espera)
            self._log(item, outros[0] if outros else item, dec["sit"], "proximo_telefone", None, agora, "auto", None,
                      dec["id_chamada"])
        else:
            if not horizontal:                          # vertical: os outros telefones do cliente vão para o fim
                for x in outros:
                    x.adiado = True
            self._log(item, item, dec["sit"], "proximo_cliente", None, agora, "auto", None, dec["id_chamada"])

    # ------------------------------------------------------------ volta: decisão e registro
    def _outro_numero(self, item: ItemLote) -> ItemLote | None:
        """O próximo número do cliente (na ordem da Lista, certificado primeiro) que já foi tentado hoje, não está
        encerrado, não tem volta e ainda tem tentativas. Número ainda não tentado já está na 1ª passada."""
        mesmos = [x for x in self.itens if x.id_cliente == item.id_cliente and x is not item
                  and x.telefone != item.telefone]
        mesmos.sort(key=lambda x: (x.reserva, x.ordem))
        for x in mesmos:
            if x.tentativas > 0 and not x.encerrado and x.volta is None and x.tentativas < x.tentativas_max_numero:
                return x
        return None

    def _fim_do_dia(self, item: ItemLote, ate: str | None, agora: datetime) -> datetime | None:
        fins = []
        if ate:
            fins.append(datetime.combine(agora.date(), datetime.strptime(ate, "%H:%M").time()))
        if item.janela_local:
            fins.append(datetime.combine(agora.date(), datetime.strptime(item.janela_local[1], "%H:%M").time()))
        return min(fins) if fins else None

    def _log(self, item: ItemLote, alvo: ItemLote, sit: str | None, decisao: str, motivo: str | None, agora: datetime,
             origem: str, pedido_id: int | None, id_chamada: str | None, ref: str | None = None,
             nao_antes: datetime | None = None) -> None:
        if sit is None:
            return                                       # só situações sem contato entram no log
        self.decisoes.append({
            "empresa_id": self.empresa_id, "credor_id": self.credor_id, "lote_id": self.lote_id,
            "id_cliente": item.id_cliente, "destino_hash": hash_destino(alvo.telefone), "situacao_origem": sit,
            "passada": min(50, self.guarda.tentativas_cliente.get(item.id_cliente, 0) + 1), "origem": origem,
            "pedido_id": pedido_id if origem == "manual" else None,
            "reciclagem_id": pedido_id if origem == "reciclagem" else None,
            "id_chamada_origem": id_chamada, "criado_em": agora, "decisao": decisao,
            "motivo_fora": motivo, "ref": ref or uuid.uuid4().hex, "nao_antes_de": nao_antes})

    def _motivo_fora(self, item: ItemLote, alvo: ItemLote | None, sit: str | None, nao_antes: datetime,
                     fim: datetime | None) -> str | None:
        g, r = self.guarda, self.regras
        if alvo is None:
            return "inexistente"
        if alvo.encerrado:
            return "inexistente" if sit == "numero_incorreto" else "max_dia"
        mx = alvo.tentativas_max_numero
        if r is not None and r.max_dia(sit) is not None and alvo is item:
            mx = min(mx, r.max_dia(sit))
        if max(alvo.tentativas, g.tentativas_numero.get((alvo.id_cliente, alvo.telefone), 0)) >= mx \
                or g.tentativas_cliente.get(item.id_cliente, 0) >= alvo.tentativas_max_cliente:
            return "max_dia"
        if alvo.janela_local is None or (fim is not None and nao_antes >= fim):
            return "fora_horario"
        if g.extra is not None:
            m = (g.extra(alvo, nao_antes) or "").lower()
            if m:
                return ("nao_ligar" if "ligar" in m else "promessa" if "promessa" in m
                        else "inexistente" if "inexistente" in m else "descanso")
        return None

    def _volta(self, item: ItemLote, sit: str | None, agora: datetime, origem: str, prioridade: str, depois: int,
               ate: str | None, decisao: str, id_chamada: str | None = None, outro: bool = False,
               pedido_id: int | None = None, reabre: bool = False, log_fora: bool = True) -> str | None:
        """Agenda a volta (no mesmo número, ou em outro do cliente). Devolve None (voltou) ou o motivo de ficar fora."""
        alvo = item
        if outro or item.encerrado:
            alvo = (self._outro_numero(item) or (None if item.encerrado else item)) if outro else None
        nao_antes = agora + timedelta(minutes=depois)
        fim = self._fim_do_dia(alvo or item, ate, agora)
        motivo = self._motivo_fora(item, alvo, sit, nao_antes, fim)
        if motivo is not None:
            if log_fora:
                self._log(item, alvo or item, sit, "fora", motivo, agora, "auto" if origem == "rediscagem" else origem,
                          pedido_id, id_chamada)
            return motivo
        g = self.guarda
        v = Volta(nao_antes_de=nao_antes, prioridade=prioridade, ate=fim, origem=origem, situacao_origem=sit,
                  pedido_id=pedido_id, reabre_cliente=reabre or item.id_cliente in g.clientes_encerrados)
        alvo.volta = v
        alvo.adiado = False
        self._voltas[self._indice(alvo)] = prioridade
        passada = min(50, g.tentativas_cliente.get(item.id_cliente, 0) + 1)
        o = self._onda((origem, passada, sit, prioridade, pedido_id))
        o["total"] += 1
        o["mudou"] = True
        self._log(item, alvo, sit, decisao if alvo is item else "proximo_telefone", None, agora,
                  "auto" if origem == "rediscagem" else origem, pedido_id, id_chamada, ref=v.ref, nao_antes=nao_antes)
        return None

    def _filtra(self, it: ItemLote, sits: set, ondas: set) -> bool:
        if it.situacao not in sits:
            return False
        if ondas:
            por_id = {o["id"]: k for k, o in self.ondas.items() if o["id"] is not None}
            return it.onda_chave in {por_id[x] for x in ondas if x in por_id}
        return True

    def reenviar(self, situacoes, ondas, prioridade: str, outro: bool, pedido_id: int, agora: datetime) -> dict:
        """Reenviar agora (pedido à mão): as mesmas regras para os números sem contato que caem no filtro."""
        sits, ids_ondas = set(situacoes or ()), {int(x) for x in (ondas or ())}
        cont = {"volta": 0, "volta_outro_numero": 0, "espera_intervalo": 0, "fora": {}}
        g, r = self.guarda, self.regras
        for it in list(self.itens):
            if it.tentativas == 0 or it.volta is not None or not self._filtra(it, sits, ids_ondas):
                continue
            if it.id_cliente in g.clientes_encerrados and it.id_cliente not in g.reabriveis:
                continue
            sinal = DG.sinalizacao_de(it.desfecho)
            depois = r.intervalo_efetivo(it.situacao, it, sinal) if r else \
                (it.intervalo_ocupado if it.situacao == "ocupado" else it.intervalo_min)
            antes = len(self.decisoes)
            m = self._volta(it, it.situacao, agora, origem="manual", prioridade=prioridade, depois=depois, ate=None,
                            decisao="redisca", outro=outro, pedido_id=pedido_id, reabre=it.id_cliente in g.reabriveis)
            if m is None:
                cont["volta"] += 1
                cont["volta_outro_numero"] += self.decisoes[antes]["decisao"] == "proximo_telefone"
                cont["espera_intervalo"] += depois > 0
            else:
                cont["fora"][m] = cont["fora"].get(m, 0) + 1
        return cont

    # ------------------------------------------------------------ reciclagem
    def sem_contato_pct(self) -> float:
        """% dos clientes do lote sem contato hoje (para a reciclagem automática)."""
        clientes = {it.id_cliente for it in self.itens}
        if not clientes:
            return 0.0
        contato = {c for c, ds in self.guarda.desfechos_cliente.items() if ds & FINALIZA_SEMPRE}
        return 100.0 * len(clientes - contato) / len(clientes)

    def reciclar(self, situacoes, ondas, excluir, limite: str, pedido_id: int, agora: datetime,
                 escopo: str = "lote") -> dict:
        """Reciclar mailing: zera tentativas e estágios dos números escolhidos e redisca do começo, no modo da
        carteira. Nunca volta: "não ligar" e número inexistente. A contagem de curtas e a janela não mudam. Com
        limite "mantem", as tentativas do dia continuam contando (o limite corta); "recomeca" zera só destes."""
        g = self.guarda
        excluir = set(excluir or ())
        promessa_trava = bool(self.regras and self.regras.cfg["promessa_suspende"]["ativo"])
        if promessa_trava:
            excluir.add("promessa")
        sits, ids_ondas = set(situacoes or ()), {int(x) for x in (ondas or ())}
        cont = {"volta": 0, "fora": {}}
        mexidos = []
        for it in self.itens:
            if it.tentativas == 0 and it.volta is None:
                continue
            if escopo == "filtro" and not self._filtra(it, sits, ids_ondas):
                continue
            ds = g.desfechos_cliente.get(it.id_cliente, set())
            motivo = None
            if "opt_out" in ds:
                motivo = "nao_ligar"
            elif it.desfecho in ("numero_inexistente", "inexistente_voz"):
                motivo = "inexistente"
            elif "cpc" in excluir and ds & {"cpc", "identidade_confirmada", "atendida_sem_cpc"}:
                motivo = "cpc"
            elif "promessa" in excluir and "promessa" in ds:
                motivo = "promessa"
            elif "recusa" in excluir and "recusa" in ds:
                motivo = "recusa"
            elif "pessoa_errada" in excluir and it.desfecho == "atendida_terceiro_desconhece":
                motivo = "pessoa_errada"
            elif "retorno" in excluir and "retorno_agendado" in ds:
                motivo = "retorno"
            elif limite != "recomeca" and (g.tentativas_cliente.get(it.id_cliente, 0) >= it.tentativas_max_cliente
                                           or g.tentativas_numero.get((it.id_cliente, it.telefone), 0)
                                           >= it.tentativas_max_numero):
                motivo = "max_dia"
            if motivo:
                cont["fora"][motivo] = cont["fora"].get(motivo, 0) + 1
                self._log(it, it, it.situacao, "fora", motivo, agora, "reciclagem", pedido_id, None)
                continue
            mexidos.append(it)
        for it in mexidos:
            if limite == "recomeca":
                g.tentativas_cliente[it.id_cliente] = 0
                g.tentativas_numero[(it.id_cliente, it.telefone)] = 0
            g.clientes_encerrados.discard(it.id_cliente)
            it.tentativas, it.nao_antes_de, it.encerrado, it.volta, it.rediscagens, it.adiado = 0, None, False, None, 0, False
            self._voltas.pop(self._indice(it), None)
            cont["volta"] += 1
            o = self._onda(("reciclagem", 1, None, "normal", pedido_id))
            o["total"] += 1
            o["mudou"] = True
            self._log(it, it, it.situacao, "redisca", None, agora, "reciclagem", pedido_id, None)
        self._fim_spin.clear()                       # o spin do lote recomeça do 1
        return cont


def ler_ids(caminho: str | Path, dia, reserva: bool = False, base=("08:00", "20:00"), feriados=(),
            tentativas_numero: int = 3, tentativas_cliente: int = 6) -> list[ItemLote]:
    """ids/agente_voz.csv (id_cliente;contato[;mensagem][;produto][;variáveis da fala], um número por linha na ordem de
    discagem; rodar_dia.exportar_ids). As variáveis (primeiro_nome, saldo…) vão para ItemLote.variaveis.
    Sem a janela por número do mailing, a janela sai da prévia de horários por UF/DDD do próprio motor
    (motor/discagem.py: Horarios) dentro de `base`. reserva=True para o agente_voz_reserva.csv."""
    from motor.discagem import DDD_UF, Horarios
    hor = Horarios(None, feriados)
    itens, ordem = [], {}
    with open(caminho, newline="", encoding="utf-8") as f:
        for l in csv.DictReader(f, delimiter=";"):
            idc, tel = (l.get("id_cliente") or "").strip(), (l.get("contato") or "").strip()
            if not idc or not tel:
                continue
            ordem[idc] = ordem.get(idc, 0) + 1
            itens.append(ItemLote(id_cliente=idc, telefone=tel, ordem=ordem[idc], reserva=reserva,
                                  tentativas_max_numero=tentativas_numero, tentativas_max_cliente=tentativas_cliente,
                                  janela_local=hor.janela(dia, tel, base), uf=DDD_UF.get(tel[:2], ""),
                                  variaveis=ler_variaveis(l)))
    return itens
