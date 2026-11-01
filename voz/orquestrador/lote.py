"""Lote da Lista do dia e a guarda antes de cada INVITE.

A Lista do dia é o discador_mailing.csv do motor (motor/discagem.py: CAMPOS_MAILING, uma linha por telefone, já
na ordem de discagem, com a janela do número em horário de Brasília calculada pela UF/DDD). O orquestrador não
recalcula a régua: só confere, na hora de discar, o que pode ter mudado desde a manhã:
  - janela do número (janela_local) e o "agendar_para" do retorno agendado;
  - tentativas por número e por cliente no dia e o intervalo entre tentativas (ocupado tem o seu);
  - cliente que já teve contato hoje (CPC, promessa, recusa, opt-out…) não recebe outra ligação;
  - número de reserva só depois que os principais do cliente se esgotaram sem contato;
  - a guarda extra do motor (callable), para as regras de tempo real (ex.: "não ligar" recebido agora).

Renitência por situação e Resubmit (SQL 65, protótipo aprovado em 01/11/2026), pelas regras da carteira
(credores.discagem, normalizadas por motor/discagem.py; Lote.regras):
  - sem as chaves novas, tudo como antes (paridade): o número volta depois de intervalo_min (ocupado: o dele) até as
    tentativas do dia, na ordem do arquivo;
  - por_situacao/falhas_tecnicas: o intervalo e o máximo no dia passam a ser os da situação da última tentativa;
  - resubmit: depois da 1ª tentativa, o número só volta por uma VOLTA decidida aqui (ou pedida à mão em "Reenviar
    agora"): depois do maior entre "depois de" e o intervalo da renitência, até o horário limite e a janela do número,
    sem passar das tentativas por número/cliente, com prioridade (topo fura a fila das 1ªs tentativas; normal vem
    depois delas; fim por último) e, se pedido, em outro número do cliente. Cada decisão (volta ou fora, com o
    motivo) vai para voz_resubmits (só destino_hash, nunca o número).

As variáveis da fala por cliente (primeiro_nome, saldo, vencimento… só as de variaveis_voz(), nunca CPF) vêm das
colunas extras do ids/agente_voz.csv (rodar_dia.exportar_ids) e ficam só em ItemLote.variaveis, na memória da VM
durante o lote: fora do repr, dos eventos, do banco e de qualquer log.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import hashlib
import re
import uuid

from motor import discagem as DG
from motor import voz as V

# desfechos que encerram o CLIENTE no dia (houve gente do outro lado ou pedido explícito)
ENCERRA_CLIENTE = frozenset(d.chave for d in V.DESFECHOS if d.e_cpc) | {
    "opt_out", "recado", "atendida_terceiro_desconhece", "atendida_sem_cpc", "atendeu_desligou",
    "desligou_sem_conversar", "abandonada"}
# desfechos que encerram o NÚMERO no dia (não adianta tentar de novo hoje)
ENCERRA_NUMERO = frozenset({"numero_inexistente", "inexistente_voz", "fax", "rejeitada", "opt_out"})
# encerram o cliente hoje, mas o Resubmit (ou o "Reenviar agora") pode reabrir: ninguém falou de verdade
REABRIVEIS = frozenset({"atendeu_desligou", "desligou_sem_conversar", "abandonada", "atendida_terceiro_desconhece",
                        "retorno_agendado"})
RANK = {"topo": 0, "normal": 2, "fim": 3}       # 1 = primeiras tentativas (e a retentativa de hoje)


def hash_destino(telefone: str) -> str:
    """sha-256 do número só com dígitos, sem o 55 (igual a nuvem/mensageria.hash_destino e public.hash_destino)."""
    d = re.sub(r"\D", "", telefone or "")
    d = d[2:] if re.fullmatch(r"55\d{10,11}", d) else d
    return hashlib.sha256(d.encode("utf-8")).hexdigest()


@dataclass
class Volta:
    """Uma volta ao mailing no mesmo dia (Resubmit automático ou pedido à mão)."""
    nao_antes_de: datetime
    prioridade: str = "normal"
    ate: datetime | None = None
    origem: str = "resubmit"              # resubmit | manual
    situacao_origem: str | None = None
    ref: str = field(default_factory=lambda: uuid.uuid4().hex)
    pedido_id: int | None = None
    reabre_cliente: bool = False


class RegrasLote:
    """Regras da carteira que a VM aplica (credores.discagem normalizado pelo motor). None no Lote = paridade total."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.tem_resubmit = cfg.get("resubmit") is not None

    @classmethod
    def da_carteira(cls, discagem) -> "RegrasLote | None":
        if not isinstance(discagem, dict) or not any(k in discagem for k in ("por_situacao", "falhas_tecnicas",
                                                                               "resubmit")):
            return None
        cfg, _ = DG.normalizar(discagem)
        return cls(cfg)

    def tem_situacao(self, sit: str | None) -> bool:
        if sit is None:
            return False
        bloco = "falhas_tecnicas" if sit in DG.FALHAS_TECNICAS else "por_situacao"
        return sit in (self.cfg.get(bloco) or {})

    def intervalo(self, sit: str | None) -> int | None:
        return DG.regra_situacao(self.cfg, sit)["intervalo_minutos"] if self.tem_situacao(sit) else None

    def max_dia(self, sit: str | None) -> int | None:
        return DG.regra_situacao(self.cfg, sit)["max_dia"] if self.tem_situacao(sit) else None

    def intervalo_efetivo(self, sit: str | None, item: "ItemLote") -> int:
        m = self.intervalo(sit)
        if m is not None:
            return m
        return item.intervalo_ocupado if sit == "ocupado" else item.intervalo_min

    def resubmit(self, sit: str | None) -> dict | None:
        return DG.resubmit_efetivo(self.cfg, sit) if sit else None

    @property
    def tnum(self) -> int:
        return self.cfg["tentativas_numero_dia"]

    @property
    def tcli(self) -> int:
        return self.cfg.get("tentativas_cliente_dia") or 3


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
    volta: Volta | None = None           # volta pendente (Resubmit ou Reenviar agora)
    onda_chave: tuple | None = None      # onda da última tentativa


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
    voltas: dict = field(default_factory=dict)            # (cliente, situação) -> voltas automáticas no dia

    so_voltas: bool = False                                # Resubmit: depois da 1ª tentativa, só com volta
    reabriveis: set = field(default_factory=set)           # clientes encerrados só por desfecho reabrível

    def motivo(self, item: ItemLote, agora: datetime) -> str | None:
        """None = pode discar; senão, o motivo (texto curto, sem o número)."""
        if item.encerrado:
            return "número encerrado no dia"
        v = item.volta
        if item.id_cliente in self.clientes_encerrados and not (v is not None and v.reabre_cliente):
            return "cliente já teve contato hoje"
        if v is None and self.so_voltas and item.tentativas > 0:
            return "sem volta agendada"
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
        if v is not None and agora < v.nao_antes_de:
            return "intervalo entre tentativas"
        if v is not None and v.ate is not None and agora >= v.ate:
            return "volta fora do horário limite"
        if self.extra is not None:
            m = self.extra(item, agora)
            if m:
                return m
        return None

    def registrar(self, item: ItemLote, desfecho: str | None, agora: datetime, regras: RegrasLote | None = None,
                  causa_sip: int | None = None) -> None:
        """Depois da tentativa (retentativa de hoje): conta, agenda a próxima ou encerra número/cliente. Com as regras
        por situação da carteira, o intervalo e o máximo no dia são os da situação."""
        item.tentativas += 1
        self.tentativas_cliente[item.id_cliente] = self.tentativas_cliente.get(item.id_cliente, 0) + 1
        item.situacao = DG.situacao_de(desfecho, causa_sip)
        if desfecho in ENCERRA_CLIENTE:
            self.clientes_encerrados.add(item.id_cliente)
            if desfecho in REABRIVEIS:
                self.reabriveis.add(item.id_cliente)
            else:
                self.reabriveis.discard(item.id_cliente)
        if desfecho in ENCERRA_NUMERO or desfecho in ENCERRA_CLIENTE:
            item.encerrado = True
            return
        if regras is None:
            minutos = item.intervalo_ocupado if desfecho == "ocupado" else item.intervalo_min
        else:
            minutos = regras.intervalo_efetivo(item.situacao, item)
            mx = regras.max_dia(item.situacao)
            if mx is not None and item.tentativas >= mx:
                item.encerrado = True
                return
        item.nao_antes_de = agora + timedelta(minutes=minutos)


class Lote:
    """Itens de uma empresa no dia, na ordem da Lista. proximo() devolve o primeiro que a guarda libera; o número
    de reserva só entra quando os principais do mesmo cliente acabaram (encerrados ou esgotados) sem contato.
    Ordem: voltas de prioridade topo > 1ªs tentativas (e a retentativa de hoje, na ordem do arquivo) > voltas
    normal > voltas fim. Sem volta nenhuma, é a ordem do arquivo (paridade)."""

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
        # ondas do dia: chave (origem, passada, situacao_origem, prioridade, pedido_id) -> contagens e id do banco
        self.ondas: dict[tuple, dict] = {}
        self._voltas: dict[int, str] = {}         # índice -> prioridade da volta pendente
        self._idx: dict[int, int] = {}
        self.regras = None
        self.aplicar_regras(regras)
        if itens:
            self._onda(("regua", 1, None, "normal", None))["total"] = len(itens)

    @property
    def chave(self) -> tuple:
        return (self.empresa_id, self.credor_id, self.canal)

    def aplicar_regras(self, regras: RegrasLote | None) -> None:
        """Regras da carteira (credores.discagem). Com Resubmit, as tentativas do dia nunca passam das da carteira."""
        self.regras = regras
        self.guarda.so_voltas = bool(regras and regras.tem_resubmit)
        if regras is not None and regras.tem_resubmit:
            for it in self.itens:
                it.tentativas_max_numero = min(it.tentativas_max_numero, regras.tnum)
                it.tentativas_max_cliente = min(it.tentativas_max_cliente, regras.tcli)

    def _indice(self, item: ItemLote) -> int:
        if len(self._idx) != len(self.itens):
            self._idx = {id(x): i for i, x in enumerate(self.itens)}
        return self._idx[id(item)]

    def _onda(self, chave: tuple) -> dict:
        return self.ondas.setdefault(chave, {"id": None, "total": 0, "encerradas": 0, "mudou": True})

    def _principais_acabaram(self, idc: str) -> bool:
        for it in self.itens:
            if it.id_cliente == idc and not it.reserva and not it.encerrado and \
                    it.tentativas < it.tentativas_max_numero:
                return False
        return True

    def _pode(self, i: int, it: ItemLote, agora: datetime, clientes_em_voo: set) -> bool:
        if i in self.em_voo or it.id_cliente in clientes_em_voo:
            return False
        m = self.guarda.motivo(it, agora)
        if m is None and it.reserva and it.volta is None and not self._principais_acabaram(it.id_cliente):
            m = "reserva: principais ainda em curso"
        return m is None

    def proximo(self, agora: datetime) -> tuple[int, ItemLote] | None:
        clientes_em_voo = {self.itens[i].id_cliente for i in self.em_voo}
        voltas = sorted(self._voltas.items(), key=lambda x: (RANK[x[1]], x[0])) if self._voltas else []
        for i, pri in voltas:
            if pri == "topo" and self._pode(i, self.itens[i], agora, clientes_em_voo):
                return i, self.itens[i]
        for i, it in enumerate(self.itens):
            if it.volta is None and self._pode(i, it, agora, clientes_em_voo):
                return i, it
        for i, pri in voltas:
            if pri != "topo" and self._pode(i, self.itens[i], agora, clientes_em_voo):
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
                   and it.tentativas < it.tentativas_max_numero
                   and g.tentativas_cliente.get(it.id_cliente, 0) < it.tentativas_max_cliente
                   and it.janela_local is not None and agora.strftime("%H:%M") < it.janela_local[1])

    # ------------------------------------------------------------ tentativa: começo e fim
    def iniciar(self, idx: int, agora: datetime) -> dict:
        """O item vai ser discado: consome a volta e diz a passada, a situação de origem, a onda e o resubmit."""
        it = self.itens[idx]
        v, it.volta = it.volta, None
        self._voltas.pop(idx, None)
        passada = it.tentativas + 1
        if v is not None:
            chave = (v.origem, passada, v.situacao_origem, v.prioridade, v.pedido_id)
            if v.reabre_cliente:
                self.guarda.clientes_encerrados.discard(it.id_cliente)
            sit, ref = v.situacao_origem, v.ref
        else:
            sit, ref = (it.situacao if passada > 1 else None), None
            chave = ("regua", passada, sit, "normal", None)
            if passada > 1:                       # retentativa de hoje: a onda cresce quando a tentativa sai
                o = self._onda(chave)
                o["total"] += 1
                o["mudou"] = True
        it.onda_chave = chave
        return {"passada": passada, "situacao_origem": sit, "resubmit_ref": ref, "onda_chave": chave}

    def registrar(self, item: ItemLote, desfecho: str | None, agora: datetime, causa_sip: int | None = None,
                  retorno_em: datetime | None = None, id_chamada: str | None = None) -> None:
        """Fim da tentativa: conta na onda e decide (retentativa de hoje ou volta do Resubmit)."""
        if item.onda_chave is not None:
            o = self._onda(item.onda_chave)
            o["encerradas"] += 1
            o["mudou"] = True
        g, r = self.guarda, self.regras
        if r is None or not r.tem_resubmit:
            g.registrar(item, desfecho, agora, r, causa_sip)
            return
        sit = DG.situacao_de(desfecho, causa_sip)
        res = r.resubmit(sit)
        reabre = res is not None and res["ativo"] and desfecho in REABRIVEIS
        g.registrar(item, desfecho, agora, None, causa_sip)       # conta, encerra o que encerra
        item.nao_antes_de = None                                    # com Resubmit, quem decide a hora é a volta
        if desfecho in ENCERRA_CLIENTE and not reabre:
            return
        if res is None or not res["ativo"]:
            return
        if desfecho in ENCERRA_CLIENTE:
            # reabrível: a volta reabre o cliente só para ela. Pessoa errada: o número não é dele (fica encerrado e a
            # volta, se houver, vai para outro número do cliente)
            item.encerrado = desfecho == "atendida_terceiro_desconhece"
        self._decidir(item, sit, res, agora, origem="resubmit", prioridade=res["prioridade"],
                      outro=res["outro_numero"] or sit == "numero_incorreto", retorno_em=retorno_em,
                      id_chamada=id_chamada, reabre=desfecho in ENCERRA_CLIENTE)

    # ------------------------------------------------------------ volta: decisão e registro
    def _outro_numero(self, item: ItemLote) -> ItemLote | None:
        """O próximo número do cliente (na ordem da Lista, certificado primeiro) que já foi tentado hoje, não está
        encerrado, não tem volta e ainda tem tentativas. Número ainda não tentado já está na 1ª passada."""
        mesmos = [x for x in self.itens if x.id_cliente == item.id_cliente and x is not item]
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

    def _decidir(self, item: ItemLote, sit: str, res: dict | None, agora: datetime, origem: str, prioridade: str,
                 outro: bool, retorno_em: datetime | None = None, id_chamada: str | None = None,
                 reabre: bool = False, pedido_id: int | None = None) -> str:
        """Decide a volta do número (ou de outro número do cliente). Devolve 'volta', 'volta_outro', 'espera' (volta,
        mas ainda no intervalo) ou o motivo de ficar fora."""
        g, r = self.guarda, self.regras
        intervalo = (r.intervalo_efetivo(sit, item) if r is not None
                     else (item.intervalo_ocupado if sit == "ocupado" else item.intervalo_min))
        alvo = item
        if sit == "numero_incorreto" or (outro and item.encerrado):
            alvo = self._outro_numero(item) if outro else None
        elif outro:
            alvo = self._outro_numero(item) or item
        motivo, nao_antes = None, None
        if origem == "resubmit":
            depois = max(res["depois_minutos"], intervalo)
            if sit == "retorno_agendado":
                depois = 0
            chave_max = (item.id_cliente, sit)
            if g.voltas.get(chave_max, 0) >= res["max_dia"]:
                motivo = "max_dia"
        else:
            depois = intervalo
        if motivo is None and alvo is None:
            motivo = "inexistente"
        if motivo is None and alvo.encerrado:
            motivo = "inexistente" if sit == "numero_incorreto" else "max_dia"
        if motivo is None:
            mx = alvo.tentativas_max_numero
            if r is not None and r.max_dia(sit) is not None and alvo is item:
                mx = min(mx, r.max_dia(sit))
            if alvo.tentativas >= mx or g.tentativas_cliente.get(item.id_cliente, 0) >= alvo.tentativas_max_cliente:
                motivo = "max_dia"
        if motivo is None:
            nao_antes = agora + timedelta(minutes=depois)
            if sit == "retorno_agendado":
                if retorno_em is None or retorno_em.date() != agora.date():
                    motivo = "fora_horario"            # outro dia: o motor agenda (agendar_para)
                else:
                    nao_antes = max(agora, retorno_em)
            fim = self._fim_do_dia(alvo, res["ate"] if res else None, agora)
            if motivo is None and (alvo.janela_local is None or (fim is not None and nao_antes >= fim)):
                motivo = "fora_horario"
        if motivo is None and g.extra is not None:
            m = g.extra(alvo, nao_antes) or ""
            if m:
                ml = m.lower()
                motivo = ("nao_ligar" if "ligar" in ml else "promessa" if "promessa" in ml
                          else "inexistente" if "inexistente" in ml else "descanso")
        dec = {"empresa_id": self.empresa_id, "credor_id": self.credor_id, "lote_id": self.lote_id,
               "id_cliente": item.id_cliente, "destino_hash": hash_destino((alvo or item).telefone),
               "situacao_origem": sit, "passada": (alvo or item).tentativas + 1,
               "origem": "auto" if origem == "resubmit" else "manual", "pedido_id": pedido_id,
               "id_chamada_origem": id_chamada, "criado_em": agora}
        if motivo is not None:
            self.decisoes.append({**dec, "decisao": "fora", "motivo_fora": motivo, "ref": uuid.uuid4().hex})
            return motivo
        v = Volta(nao_antes_de=nao_antes, prioridade=prioridade, ate=self._fim_do_dia(alvo, res["ate"] if res else None,
                                                                                         agora),
                  origem=origem, situacao_origem=sit, pedido_id=pedido_id,
                  reabre_cliente=reabre or item.id_cliente in g.clientes_encerrados)
        alvo.volta = v
        self._voltas[self._indice(alvo)] = prioridade
        if origem == "resubmit":
            g.voltas[(item.id_cliente, sit)] = g.voltas.get((item.id_cliente, sit), 0) + 1
        o = self._onda((origem, alvo.tentativas + 1, sit, prioridade, pedido_id))
        o["total"] += 1
        o["mudou"] = True
        self.decisoes.append({**dec, "decisao": "volta", "motivo_fora": None, "ref": v.ref,
                              "nao_antes_de": nao_antes})
        if alvo is not item:
            return "volta_outro"
        return "espera" if nao_antes > agora else "volta"

    def reenviar(self, situacoes, ondas, prioridade: str, outro: bool, pedido_id: int, agora: datetime) -> dict:
        """Reenviar agora (pedido à mão): as mesmas regras do automático para os números sem contato que caem no
        filtro. Devolve só contagens."""
        sits = set(situacoes or ())
        ids_ondas = {int(x) for x in (ondas or ())}
        por_id = {o["id"]: k for k, o in self.ondas.items() if o["id"] is not None}
        cont = {"volta": 0, "volta_outro_numero": 0, "espera_intervalo": 0, "fora": {}}
        g = self.guarda
        for it in list(self.itens):
            if it.tentativas == 0 or it.volta is not None or it.situacao not in sits:
                continue
            if ids_ondas and it.onda_chave not in {por_id[x] for x in ids_ondas if x in por_id}:
                continue
            if it.id_cliente in g.clientes_encerrados and it.id_cliente not in g.reabriveis:
                continue
            r = self._decidir(it, it.situacao, None, agora, origem="manual", prioridade=prioridade, outro=outro,
                              reabre=it.id_cliente in g.reabriveis, pedido_id=pedido_id)
            if r in ("volta", "espera", "volta_outro"):
                cont["volta"] += 1
                cont["volta_outro_numero"] += r == "volta_outro"
                cont["espera_intervalo"] += r == "espera"
            else:
                cont["fora"][r] = cont["fora"].get(r, 0) + 1
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
