"""Processo do orquestrador na VM do Asterisk (ao lado do contêiner, rede do host).

Plantão (o serviço motorcx-voz-orquestrador da VM):
  python3 -m voz.orquestrador.principal --auto --modo real --dados /run/motorcx/voz.json --eventos /var/motorcx/eventos
A cada minuto, para cada empresa com voz_config.modo igual a --modo, baixa a Lista do dia que o motor publicou
(saidas/<slug>/<data>[/<credor>]/discador_mailing.csv e ids/agente_voz.csv), disca, grava voz_chamadas e
consumo_voz e publica os eventos como retorno (envios). --modo simulado usa o AriSimulado: ninguém recebe ligação.

Manual (um arquivo de lista):
  python3 -m voz.orquestrador.principal --dados voz.json --lista empresa=12:discador_mailing.csv --eventos ...

Os eventos do ARI chegam por uma thread (WebSocket) numa fila; o laço principal processa a fila e chama tick() a
cada 200 ms. Senha do ARI: arquivo (MOTORCX_ARI_SENHA_ARQUIVO, gravado pela VM a partir do Secret Manager).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from motor import discagem as DG
from voz import banco as B
from voz.orquestrador.agendador import Agendador
from voz.orquestrador.ari import AriHttp, AriSimulado
from voz.orquestrador.eventos import EscritorEventos
from voz.orquestrador.gravacao import EnviadorGCS, FilaEnvio
from voz.orquestrador.lote import Lote, RegrasLote, ler_ids, ler_mailing
from voz.orquestrador.nucleo import APP, Orquestrador
from voz.orquestrador.ritmo import Historico
from voz.orquestrador import testar_agora as TA
from voz.provedores.simulador import Simulador

log = logging.getLogger("motorcx.voz")

FUSO = ZoneInfo("America/Sao_Paulo")


def relogio_brasilia() -> datetime:
    """Hora de Brasília sem fuso (a janela da Lista está em horário de Brasília)."""
    return datetime.now(FUSO).replace(tzinfo=None)


def montar(dados: B.DadosVoz, listas: dict[int, str], contratado: int, ari, escritor, provedores, relogio,
           fila_envio=None, ao_registrar=None) -> Orquestrador:
    ag = Agendador(contratado=contratado)
    orq = Orquestrador(ari, dados, ag, escritor, provedores, relogio, fila_envio=fila_envio, ao_registrar=ao_registrar)
    for emp, caminho in listas.items():
        ag.registrar_empresa(dados.config(emp), dados.troncos_da(emp))
        orq.adicionar_lote(Lote(emp, ler_mailing(caminho), canal="discador"))
    return orq


def _ouvir(ari, fila: queue.Queue, parar: threading.Event) -> None:
    while not parar.is_set():
        try:
            for ev in ari.eventos(APP):
                fila.put(ev)
                if parar.is_set():
                    return
        except Exception as ex:   # reconecta (Asterisk reiniciando)
            logging.getLogger("motorcx.voz").warning("WebSocket do ARI caiu (%s); reconectando", ex.__class__.__name__)
            time.sleep(2)


def rodar(orq: Orquestrador, fila: queue.Queue, passo_s: float = 0.2, relogio=relogio_brasilia) -> dict:
    while True:
        fim = time.monotonic() + passo_s
        while time.monotonic() < fim:
            try:
                orq.ao_evento(fila.get(timeout=max(0.0, fim - time.monotonic())))
            except queue.Empty:
                break
        orq.tick()
        agora = relogio()
        if not orq.chamadas and all(l.pendentes(agora) == 0 for l in orq.lotes.values()):
            return orq.contagem


class FonteListas:
    """A Lista do dia que o motor publicou no bucket "saidas" (nuvem/sincronizar.py: publicar_arquivos).

    As variáveis da fala de cada cliente (ItemLote.variaveis) saem das colunas extras do ids/agente_voz*.csv e, para
    `credor`, do nome da carteira (credores.nome). O cliente que está no discador_mailing.csv e no agente_voz recebe
    as mesmas variáveis nos dois lotes. Os arquivos baixados são apagados logo depois de lidos: o que é do cliente
    fica só na memória da VM durante o lote."""

    def __init__(self, sb, pasta_tmp: Path):
        self.sb, self.tmp = sb, Path(pasta_tmp)

    def _baixar(self, caminho: str, nome: str) -> Path | None:
        try:
            conteudo = self.sb.baixar("saidas", caminho)
        except Exception:   # noqa: BLE001 — ainda não publicada (o motor roda de manhã)
            return None
        self.tmp.mkdir(parents=True, exist_ok=True)
        arq = self.tmp / nome
        arq.write_bytes(conteudo)
        arq.chmod(0o600)
        return arq

    @staticmethod
    def _ler(arq: Path, ler, *args):
        try:
            return ler(arq, *args)
        finally:
            arq.unlink(missing_ok=True)

    def discagem(self, empresa_id: int) -> list[dict] | None:
        """credores.discagem de cada carteira ativa (RPC regras_discagem_voz, SQL 65). None = não leu (banco fora)."""
        try:
            return self.sb.rpc("regras_discagem_voz", {"empresa": int(empresa_id)}) or []
        except Exception as ex:   # noqa: BLE001 — banco sem o SQL 65 ou fora: discagem de hoje
            log.warning("empresa %s: regras da discagem não lidas (%s); vale a discagem de hoje", empresa_id,
                        ex.__class__.__name__)
            return None

    def regras(self, empresa_id: int, linhas: list[dict] | None = None) -> dict:
        """Renitência por situação e Resubmit de cada carteira (credores.discagem pela RPC regras_discagem_voz, SQL
        65). Falhou ou carteira sem as chaves novas: sem regras, a discagem de hoje (paridade)."""
        linhas = self.discagem(empresa_id) if linhas is None else linhas
        saida = {}
        for l in linhas or []:
            r = RegrasLote.da_carteira(l.get("discagem"))
            if r is not None:
                saida[l.get("credor_id")] = r
        return saida

    def ritmos(self, empresa_id: int, linhas: list[dict] | None = None) -> dict | None:
        """credor_id -> ritmo da carteira (credores.discagem › ritmo, SQL 107; sem a chave, Power 1,0). None = não leu
        (o ritmo de antes continua)."""
        linhas = self.discagem(empresa_id) if linhas is None else linhas
        if linhas is None:
            return None
        return {l.get("credor_id"): DG.ritmo_da_carteira(l.get("discagem")) for l in linhas}

    def abandonos(self, empresa_id: int) -> dict:
        """id_cliente -> (abandonos nos últimos 7 dias, último dia) (RPC abandonos_recentes_voz, SQL 108). Banco fora ou
        sem o SQL: vazio (ninguém sai com reserva por abandono de dias anteriores; o de hoje marca no próprio lote)."""
        try:
            linhas = self.sb.rpc("abandonos_recentes_voz", {"empresa": int(empresa_id)}) or []
        except Exception as ex:   # noqa: BLE001
            log.warning("empresa %s: abandonos recentes não lidos (%s)", empresa_id, ex.__class__.__name__)
            return {}
        saida = {}
        for l in linhas:
            try:
                saida[str(l["id_cliente"])] = (int(l["abandonos"]), datetime.fromisoformat(str(l["ultimo"])).date())
            except (KeyError, TypeError, ValueError):
                continue
        return saida

    def lotes(self, empresa_id: int, dia) -> list[Lote] | None:
        """Lotes do dia da empresa (um por carteira e canal) ou None se a lista ainda não saiu."""
        emp = (self.sb.selecionar("empresas", {"id": f"eq.{int(empresa_id)}"}) or [None])[0]
        if emp is None:
            return []
        try:
            credores = self.sb.selecionar("credores", {"empresa_id": f"eq.{int(empresa_id)}", "ativo": "eq.true"},
                                          ordem="id.asc") or []
        except Exception:   # noqa: BLE001 — banco sem credores: a empresa toda
            credores = []
        unidades = [(c["id"], c["codigo"], (c.get("nome") or "").strip()) for c in credores] or [(None, None, "")]
        linhas = self.discagem(empresa_id)
        regras = self.regras(empresa_id, linhas or [])
        ritmos = self.ritmos(empresa_id, linhas) or {}
        saida, achou = [], False
        for cid, cod, nome_credor in unidades:
            prefixo = f"{emp['slug']}/{dia.isoformat()}" + (f"/{cod}" if cid is not None else "")
            base = f"e{empresa_id}_c{cid or 0}_{dia.isoformat()}"
            mailing = None
            m = self._baixar(f"{prefixo}/discador_mailing.csv", f"{base}_mailing.csv")
            if m is not None:
                achou = True
                mailing = self._ler(m, ler_mailing)
            itens = []
            for nome, reserva in (("agente_voz", False), ("agente_voz_reserva", True)):
                a = self._baixar(f"{prefixo}/ids/{nome}.csv", f"{base}_{nome}.csv")
                if a is not None:
                    achou = True
                    itens += self._ler(a, ler_ids, dia, reserva)
            # variáveis por cliente: as do arquivo do agente_voz valem também no discador; credor = nome da carteira
            por_cliente: dict[str, dict] = {}
            for it in itens + (mailing or []):
                d = por_cliente.setdefault(it.id_cliente, {})
                for k, v in it.variaveis.items():
                    d.setdefault(k, v)
            for it in itens + (mailing or []):
                fixas = {**({"credor": nome_credor[:80]} if nome_credor else {}),
                         **({"assessoria": emp["nome"][:80]} if emp.get("nome") else {})}    # SQL 58: nome da empresa
                it.variaveis = {**fixas, **por_cliente[it.id_cliente]}
            if mailing is not None:
                saida.append(Lote(empresa_id, mailing, credor_id=cid, canal="discador", regras=regras.get(cid)))
            if itens:
                saida.append(Lote(empresa_id, itens, credor_id=cid, canal="agente_voz", regras=regras.get(cid)))
        for l in saida:
            if l.credor_id in ritmos:
                l.ritmo = ritmos[l.credor_id]
        if saida:
            aplicar_abandonos(saida, self.abandonos(empresa_id))
        return saida if achou else None


# abandono do discador nos últimos 7 dias (PREDITIVO.md 3.5, V4): a próxima ligação do cliente só sai com robô
# reservado. O abandono não tira ninguém da voz: a próxima tentativa segue a renitência da carteira ("abandonada")
def aplicar_abandonos(lotes: list[Lote], abandonos: dict) -> int:
    """Marca os itens dos clientes com abandono recente para sair com robô reservado. Devolve quantos marcou."""
    marcados = 0
    for l in lotes:
        for it in l.itens:
            n, _ultimo = abandonos.get(it.id_cliente, (0, None))
            if n >= 1:
                it.reservar = True
                marcados += 1
    return marcados


class Plantao:
    """O laço do serviço, em ciclos testáveis (ciclo(agora_s) sem dormir)."""

    def __init__(self, orq: Orquestrador, fonte: FonteListas, modo: str, dados_caminho: Path | None = None,
                 registro=None, publicador=None, relogio=relogio_brasilia, parte: tuple[int, int] = (1, 1),
                 segredos=None):
        self.orq, self.fonte, self.modo, self.dados_caminho = orq, fonte, modo, dados_caminho
        self.parte = parte          # (i, n): esta VM disca as empresas com id % n == i - 1
        self.registro, self.publicador, self.relogio = registro, publicador, relogio
        self.carregados: dict[int, object] = {}     # empresa -> dia carregado
        self._mtime = dados_caminho.stat().st_mtime if dados_caminho and dados_caminho.exists() else None
        self._ult = {"listas": -1e9, "banco": -1e9, "consumo": -1e9, "reenvio": -1e9, "pausas": -1e9, "robos": -1e9,
                     "ritmo": -1e9, "ritmo_cfg": -1e9, "curtas": -1e9, "historico": -1e9, "testes": -1e9}
        self._curtas_aviso_s = -1e9                  # último aviso de falha da leitura das curtas (1 por hora)
        self._ritmo_aviso_s = -1e9                   # último aviso de falha das amostras do ritmo (1 por hora)
        self._robos_s: float | None = None           # última foto dos robôs (segundos no limite entre duas fotos)
        self._robos_aviso_s = -1e9                   # último aviso de falha da telemetria (no máximo 1 por hora)
        self.agregado: object = None                 # último dia agregado em voz_passadas_dia
        # "Testar agora" (SQL 116): o número de teste vem do cofre pela referência (nunca do banco)
        self.segredos = segredos
        self.testes: dict[int, TA.TesteEmCurso] = {}
        self._testes_aviso_s = -1e9
        orq.ao_teste = self._teste_terminou

    def _vence(self, k: str, agora_s: float, a_cada: float) -> bool:
        if agora_s - self._ult[k] >= a_cada:
            self._ult[k] = agora_s
            return True
        return False

    def ciclo(self, agora_s: float) -> None:
        hoje = self.relogio().date()
        if self._vence("listas", agora_s, 60):
            self._recarregar_config()
            self._carregar_listas(hoje)
        if self.registro is not None and self._vence("banco", agora_s, 15):
            self._ids_dos_lotes(hoje)
            self.registro.sincronizar(self._do_dia())
            self.registro.descarregar()
        if self.registro is not None and self._vence("testes", agora_s, 15):
            self.pegar_testes_agora(agora_s)
            self.vigiar_testes(agora_s)
        if self.registro is not None and self._vence("robos", agora_s, 15):
            self.registrar_uso_robos(agora_s)
        if self.registro is not None and self._vence("ritmo", agora_s, 60):
            self.registrar_ritmo(agora_s)
        if self.fonte is not None and self._vence("ritmo_cfg", agora_s, 60):
            self.atualizar_ritmos()
        if self.registro is not None and self._vence("curtas", agora_s, 300):
            self.semear_curtas(agora_s)
        if self.registro is not None and self.orq.lotes and self._vence("historico", agora_s, 1800):
            self.ler_historico()
        if self.registro is not None and self._vence("pausas", agora_s, 30):
            self.sincronizar_pausas()
        if self.registro is not None and self._vence("reenvio", agora_s, 30):
            self.pegar_reenvios()
            self.pegar_reciclagens()
            self.reciclar_automatico()
        if self.registro is not None and self.agregado != hoje:
            self.agregar_passadas(hoje - timedelta(days=1))
            self.agregado = hoje
        if self._vence("consumo", agora_s, 300):
            self.descarregar_tudo(so_periodico=True)

    # ------------------------------------------------------------ SQL 65
    def _minhas(self) -> list[int]:
        return [e for e, cfg in sorted(self.orq.dados.configs.items())
                if cfg.modo == self.modo and e % self.parte[1] == self.parte[0] - 1]

    def _ids_dos_lotes(self, hoje) -> None:
        """voz_lotes do dia para cada carteira carregada (um por carteira; discador e agente_voz dividem)."""
        grupos: dict = {}
        for l in self._do_dia():
            if l.lote_id is None:
                grupos.setdefault((l.empresa_id, l.credor_id), []).append(l)
        for (emp, cid), ls in grupos.items():
            lid = self.registro.lote_do_dia(emp, cid, hoje, sum(len(l.itens) for l in ls))
            for l in ls:
                l.lote_id = lid
            if lid is not None:
                self._registrar_janelas(lid, ls)

    def _registrar_janelas(self, lote_id: int, lotes: list) -> None:
        """voz_lotes.janelas: clientes por janela de discagem (UF/DDD), só contagem (a prévia da reciclagem usa)."""
        por: dict = {}
        for l in lotes:
            for k, j in l.janelas().items():
                x = por.setdefault(k, {"clientes": set(), "ufs": set()})
                x["clientes"] |= j["clientes"]
                x["ufs"] |= j["ufs"]
        janelas = [{"abre": a, "fecha": f, "ufs": sorted(j["ufs"]), "clientes": len(j["clientes"])}
                   for (a, f), j in sorted(por.items()) if a < f][:40]
        if not janelas:
            return
        try:
            self.registro.sb.rpc("registrar_janelas_lote_voz", {"lote": int(lote_id), "janelas": janelas})
        except Exception as ex:   # noqa: BLE001
            log.warning("lote %s: janelas não registradas (%s)", lote_id, ex.__class__.__name__)

    # ------------------------------------------------------------ SQL 102 · uso dos robôs contratados
    def registrar_uso_robos(self, agora_s: float) -> int:
        """voz_robos_agora / voz_robos_dia: por empresa desta VM, robôs em uso agora, o maior uso desde a foto anterior,
        os números que ainda esperam na lista e o tempo com todos os robôs ocupados. Só contagens. Banco sem o SQL 102
        (ou fora): avisa no máximo uma vez por hora e segue discando."""
        passou = 0.0 if self._robos_s is None else min(max(agora_s - self._robos_s, 0.0), 60.0)
        self._robos_s = agora_s
        agora = self.relogio()
        linhas = []
        for emp in self._minhas():
            f = self.orq.agendador.foto_robos(emp)
            if f is None:
                continue
            aguardando = sum(max(0, l.pendentes(agora) - len(l.em_voo)) for l in self.orq.lotes.values()
                             if l.empresa_id == emp)      # na lista e ainda não discando agora
            linhas.append({"empresa_id": emp, **f, "aguardando": aguardando,
                           "segundos_no_limite": int(round(passou)) if f["no_limite"] else 0})
        if not linhas:
            return 0
        try:
            self.registro.sb.rpc("registrar_uso_robos_voz", {"linhas": linhas[:500]})
        except Exception as ex:   # noqa: BLE001
            if agora_s - self._robos_aviso_s >= 3600:
                self._robos_aviso_s = agora_s
                log.warning("uso dos robôs não gravado (%s); segue discando", ex.__class__.__name__)
            return 0
        return len(linhas)

    # ------------------------------------------------------------ SQL 107 · ritmo da carteira (Power/Preditivo V3)
    def atualizar_ritmos(self) -> int:
        """Relê o ritmo de cada carteira com lote carregado (mudou no site = vale no minuto seguinte). Banco fora: o de
        antes continua. Devolve quantos lotes mudaram."""
        mudou = 0
        for emp in sorted({l.empresa_id for l in self._do_dia()}):
            ritmos = self.fonte.ritmos(emp)
            if ritmos is None:
                continue
            for l in self._do_dia():
                novo = ritmos.get(l.credor_id, dict(DG.PADRAO["ritmo"])) if l.empresa_id == emp else None
                if novo is not None and novo != l.ritmo:
                    log.info("empresa %s carteira %s: ritmo agora %s", emp, l.credor_id, novo)
                    l.ritmo = novo
                    mudou += 1
        return mudou

    # ------------------------------------------------------------ SQL 110 · histórico do Preditivo (V5)
    def ler_historico(self) -> int:
        """Por carteira com lote carregado: atendidas e discadas dos últimos 7 dias, dias em Preditivo e o p da empresa
        (aquecimento, base do p e razão máxima da primeira semana). Banco fora: o de antes continua (sem histórico, o
        Preditivo fica em aquecimento: Power 1,0)."""
        n = 0
        for emp in sorted({l.empresa_id for l in self._do_dia()}):
            try:
                h = self.registro.sb.rpc("historico_ritmo_voz", {"empresa": emp}) or {}
            except Exception as ex:   # noqa: BLE001
                log.warning("empresa %s: histórico do ritmo não lido (%s)", emp, ex.__class__.__name__)
                continue
            por = {c.get("credor_id"): c for c in h.get("carteiras") or []}
            p_emp = h.get("p_empresa")
            for l in self._do_dia():
                if l.empresa_id != emp:
                    continue
                c = por.get(l.credor_id) or {}
                l.controle.historico = Historico(discadas_7d=int(c.get("discadas_7d") or 0),
                                                 atendidas_7d=int(c.get("atendidas_7d") or 0),
                                                 dias_preditivo=int(c.get("dias_preditivo") or 0),
                                                 p_empresa=float(p_emp) if p_emp is not None else None)
                n += 1
        return n

    # ------------------------------------------------------------ SQL 109 · freios de curtas (Power/Preditivo V6)
    def semear_curtas(self, agora_s: float) -> int:
        """O que o banco já tem de curtas hoje (por linha e total) e a liberação do Admin, por empresa desta VM: a VM
        reiniciada não começa do zero e a liberação vale em até 5 min. Banco fora: segue com o que mediu (1 aviso por
        hora)."""
        hoje, n = self.relogio().date(), 0
        for emp in self._minhas():
            try:
                dados = self.registro.sb.rpc("curtas_hoje_voz", {"empresa": emp}) or {}
            except Exception as ex:   # noqa: BLE001
                if agora_s - self._curtas_aviso_s >= 3600:
                    self._curtas_aviso_s = agora_s
                    log.warning("curtas de hoje não lidas (%s); segue com o que a VM mediu", ex.__class__.__name__)
                return n
            self.orq.curtas.semear(emp, hoje, dados)
            n += 1
        return n

    # ------------------------------------------------------------ SQL 106 · ritmo da discagem (Power/Preditivo V1)
    def registrar_ritmo(self, agora_s: float, todos: bool = False) -> int:
        """voz_ritmo_amostras: as janelas de 5 min fechadas (por carteira: discadas, atendidas por pessoa, abandonos,
        transferências sem operador, curtas, por tronco) com o modo, a razão e os robôs. Banco sem o SQL 106 (ou fora):
        as linhas esperam na memória (até 2.000), avisa no máximo 1 vez por hora e segue discando."""
        n = self.orq.medidor.enviar(self.relogio(), self.orq.retrato,
                                    lambda linhas: self.registro.sb.rpc("registrar_ritmo_voz", {"linhas": linhas}),
                                    todos=todos)
        if n < 0 and agora_s - self._ritmo_aviso_s >= 3600:
            self._ritmo_aviso_s = agora_s
            log.warning("amostras do ritmo não gravadas (%d na fila); segue discando", len(self.orq.medidor.pendentes))
        return max(n, 0)

    def sincronizar_pausas(self) -> None:
        """Rotas pausadas (sem crédito / bloqueio): grava no banco as que esta VM pausou e depois aplica as ativas do
        banco, das empresas desta VM (a retomada pela equipe volta a discar aqui, sem reiniciar)."""
        orq = self.orq
        while orq.pausas_novas:
            p = orq.pausas_novas[0]
            try:
                self.registro.sb.rpc("pausar_tronco_voz", {"empresa": p["empresa_id"], "tronco": p["tronco_id"],
                                                           "motivo": p["motivo"], "causa_sip": p["causa_sip"]})
            except Exception as ex:   # noqa: BLE001
                log.warning("rota %s: pausa não gravada (%s); fica pausada aqui", p["tronco_id"], ex.__class__.__name__)
                return                                   # tenta de novo no próximo ciclo; a rota segue pausada
            orq.pausas_novas.pop(0)
        minhas = self._minhas()
        if not minhas:
            return
        try:
            ativas = self.registro.sb.rpc("troncos_pausados_voz", {"empresas": minhas}) or []
        except Exception as ex:   # noqa: BLE001
            log.warning("rotas pausadas não lidas (%s)", ex.__class__.__name__)
            return
        meus = {x.id for e in minhas for x in orq.dados.troncos_da(e, ativos=False)}
        retomadas = orq.agendador.aplicar_pausas({int(a["tronco_id"]): a["motivo"] for a in ativas}, meus)
        for t in retomadas:
            log.warning("rota %s retomada pela equipe: volta a discar", t)

    def _do_dia(self) -> list:
        """Os lotes da Lista do dia (sem os de "Testar agora", que não têm voz_lotes, ondas nem resubmits)."""
        return [l for l in self.orq.lotes.values() if l.teste_id is None]

    # ------------------------------------------------------------ SQL 116 · "Testar agora" (PR 9 do plano Canais)
    def _concluir_teste(self, teste_id: int, situacao: str, desfecho: str | None = None, passos: dict | None = None,
                        motivo: str | None = None) -> None:
        try:
            self.registro.sb.rpc("concluir_teste_agora_voz", {"teste": int(teste_id), "situacao": situacao,
                                                              "desfecho": desfecho, "passos": passos or {},
                                                              "motivo": motivo})
        except Exception as ex:   # noqa: BLE001
            log.warning("teste agora %s: resultado não gravado (%s)", teste_id, ex.__class__.__name__)

    def _soltar_teste(self, teste_id: int) -> None:
        t = self.testes.pop(int(teste_id), None)
        if t is not None:
            self.orq.lotes.pop(t.lote.chave, None)

    def pegar_testes_agora(self, agora_s: float) -> int:
        """Pega os pedidos das empresas desta VM em Só números de teste ou Real (um de cada vez por empresa), lê o
        número no cofre, confere tudo de novo e põe o lote de um item no orquestrador. Recusa com o motivo."""
        if self.modo != "real":
            return 0
        minhas = [e for e, cfg in sorted(self.orq.dados.configs.items())
                  if cfg.modo in ("teste", "real") and e % self.parte[1] == self.parte[0] - 1]
        n = 0
        while minhas:
            try:
                ped = self.registro.sb.rpc("pegar_teste_agora_voz", {"empresas": minhas})
            except Exception as ex:   # noqa: BLE001 — banco sem o SQL 116 (ou fora): 1 aviso por hora, segue discando
                if agora_s - self._testes_aviso_s >= 3600:
                    self._testes_aviso_s = agora_s
                    log.warning("teste agora: falha ao pegar pedido (%s)", ex.__class__.__name__)
                return n
            if not ped:
                return n
            n += 1
            tid, emp = int(ped["id"]), int(ped["empresa_id"])
            cid = int(ped["credor_id"]) if ped.get("credor_id") is not None else None
            if self.segredos is None:
                self._concluir_teste(tid, "recusado", motivo="o servidor de voz está sem acesso ao cofre de segredos")
                continue
            try:
                numero = self.segredos.valor(str(ped.get("segredo_ref") or ""))
            except Exception as ex:   # noqa: BLE001 — nunca repassa o valor
                log.warning("teste agora %s: número não lido do cofre (%s)", tid, ex.__class__.__name__)
                self._concluir_teste(tid, "recusado", motivo="o número de teste não foi lido do cofre")
                continue
            numero = "".join(ch for ch in numero if ch.isdigit())
            numero = numero[2:] if len(numero) in (12, 13) and numero.startswith("55") else numero
            agora = self.relogio()
            hor = self._horarios_da_carteira(emp, cid)
            cfg = self.orq.dados.config(emp)
            if emp not in self.orq.agendador.empresas:
                self.orq.agendador.registrar_empresa(cfg, self.orq.dados.troncos_da(emp))
            jan, motivo = TA.conferir(ped, numero, agora, hor.get("tabela") if hor.get("ativo", True) else None,
                                      self.orq.curtas.empresa_parada(emp, agora))
            if motivo:
                self._concluir_teste(tid, "recusado", motivo=motivo)
                continue
            variaveis = {}
            try:
                emp_row = (self.fonte.sb.selecionar("empresas", {"id": f"eq.{emp}"}) or [None])[0]
                cred = (self.fonte.sb.selecionar("credores", {"id": f"eq.{cid}"}) or [None])[0] if cid else None
                if emp_row and emp_row.get("nome"):
                    variaveis["assessoria"] = str(emp_row["nome"])[:80]
                if cred and cred.get("nome"):
                    variaveis["credor"] = str(cred["nome"]).strip()[:80]
            except Exception:   # noqa: BLE001 — sem os nomes, a abertura diz "um assistente virtual"
                pass
            item = TA.item_de_teste(tid, numero, jan, variaveis)
            del numero
            lote = Lote(emp, [item], credor_id=cid, canal="agente_voz", teste_id=tid)
            self.orq.adicionar_lote(lote)
            self.testes[tid] = TA.TesteEmCurso(tid, lote, agora_s)
            log.info("teste agora %s: empresa %s carteira %s, ligando", tid, emp, cid)
        return n

    def _horarios_da_carteira(self, emp: int, cid: int | None) -> dict:
        """credores.discagem › horarios da carteira, normalizado pelo motor (ausente = ligado com a prévia)."""
        linhas = self.fonte.discagem(emp) if self.fonte is not None else None
        bruto = next((l.get("discagem") for l in linhas or [] if l.get("credor_id") == cid), None)
        try:
            return DG.normalizar(bruto or {})[0].get("horarios") or {}
        except Exception:   # noqa: BLE001 — regra que não valida: vale a prévia
            return {}

    def _teste_terminou(self, teste_id: int, ev, c) -> None:
        """Fim da ligação de teste (do núcleo): grava os passos e tira o lote."""
        t = self.testes.get(int(teste_id))
        if t is None or t.concluido:
            return
        t.concluido = True
        cfg = self.orq.dados.config(c.empresa_id)
        self._concluir_teste(teste_id, "concluido", ev.desfecho,
                             TA.passos(ev, bool(c.gravando), bool(cfg.aviso_gravacao), bool(c.provedor)))
        self._soltar_teste(teste_id)

    def vigiar_testes(self, agora_s: float) -> None:
        """Item que saiu sem discar (sem rota, número fora do plano) ou que esperou demais (troncos ou robôs
        ocupados): recusa com o motivo e tira o lote. Ligação em voo nunca é cortada aqui."""
        for tid, t in list(self.testes.items()):
            if t.concluido or t.lote.em_voo:
                continue
            item = t.lote.itens[0]
            if item.tentativas == 0 and (item.encerrado or agora_s - t.inicio_s >= TA.ESPERA_MAX_S):
                t.concluido = True
                motivo = TA.motivo_sem_ligacao(t.lote) if item.encerrado else \
                    "a rota ou os robôs ficaram ocupados por 5 minutos: tente de novo"
                self._concluir_teste(tid, "recusado", motivo=motivo)
                self._soltar_teste(tid)

    def pegar_reenvios(self) -> int:
        """Reenviar agora: pega um pedido pendente das empresas desta VM, confere de novo e cria as voltas."""
        minhas = self._minhas()
        if not minhas:
            return 0
        n = 0
        while True:
            try:
                ped = self.registro.sb.rpc("pegar_reenvio_voz", {"empresas": minhas})
            except Exception as ex:   # noqa: BLE001
                log.warning("reenvio: falha ao pegar pedido (%s)", ex.__class__.__name__)
                return n
            if not ped:
                return n
            n += 1
            agora = self.relogio()
            lotes = [l for l in self.orq.lotes.values() if l.lote_id == ped.get("lote_id")]
            filtros = ped.get("filtros") or {}
            tot = {"volta": 0, "volta_outro_numero": 0, "espera_intervalo": 0, "fora": {}}
            for l in lotes:
                c = l.reenviar(filtros.get("resultados") or [], filtros.get("ondas") or [],
                               ped.get("prioridade") or "normal", bool(ped.get("outro_numero")), int(ped["id"]), agora)
                for k in ("volta", "volta_outro_numero", "espera_intervalo"):
                    tot[k] += c[k]
                for k, v in c["fora"].items():
                    tot["fora"][k] = tot["fora"].get(k, 0) + v
            self.registro.sincronizar(lotes)
            onda = next((o["id"] for l in lotes for k, o in l.ondas.items()
                         if k[0] == "manual" and k[4] == int(ped["id"]) and o["id"] is not None), None)
            try:
                self.registro.sb.rpc("concluir_reenvio_voz", {
                    "reenvio": int(ped["id"]), "situacao": "concluido" if lotes else "cancelado",
                    "volta_real": tot["volta"], "onda": onda, "resultado": tot})
            except Exception as ex:   # noqa: BLE001
                log.warning("reenvio %s: falha ao concluir (%s)", ped.get("id"), ex.__class__.__name__)

    def _processar_reciclagem(self, ped: dict, lotes: list) -> None:
        agora = self.relogio()
        filtros = ped.get("filtros") or {}
        tot = {"volta": 0, "fora": {}}
        for l in lotes:
            c = l.reciclar(filtros.get("resultados") or [], filtros.get("ondas") or [], ped.get("excluir") or [],
                           ped.get("limite_cliente") or "mantem", int(ped["id"]), agora, ped.get("escopo") or "lote")
            tot["volta"] += c["volta"]
            for k, v in c["fora"].items():
                tot["fora"][k] = tot["fora"].get(k, 0) + v
        self.registro.sincronizar(lotes)
        onda = next((o["id"] for l in lotes for k, o in l.ondas.items()
                     if k[0] == "reciclagem" and k[4] == int(ped["id"]) and o["id"] is not None), None)
        try:
            self.registro.sb.rpc("concluir_reciclagem_voz", {
                "reciclagem": int(ped["id"]), "situacao": "concluido" if lotes else "cancelado",
                "volta_real": tot["volta"], "onda": onda, "fora_real": tot["fora"]})
        except Exception as ex:   # noqa: BLE001
            log.warning("reciclagem %s: falha ao concluir (%s)", ped.get("id"), ex.__class__.__name__)

    def pegar_reciclagens(self) -> int:
        """Reciclar mailing (pedido no site): zera e redisca os números escolhidos do lote, pelas mesmas regras."""
        minhas = self._minhas()
        n = 0
        while minhas:
            try:
                ped = self.registro.sb.rpc("pegar_reciclagem_voz", {"empresas": minhas})
            except Exception as ex:   # noqa: BLE001
                log.warning("reciclagem: falha ao pegar pedido (%s)", ex.__class__.__name__)
                return n
            if not ped:
                return n
            n += 1
            self._processar_reciclagem(ped, [l for l in self.orq.lotes.values() if l.lote_id == ped.get("lote_id")])
        return n

    def reciclar_automatico(self) -> int:
        """Reciclagem automática da carteira (reciclagem_auto): no horário, com a parte sem contato do lote acima do
        percentual, uma vez por lote no dia; sempre mantém o limite de tentativas do dia."""
        agora = self.relogio()
        n = 0
        grupos: dict = {}
        for l in self.orq.lotes.values():
            if l.lote_id is not None and l.regras is not None:
                grupos.setdefault(l.lote_id, []).append(l)
        for lote_id, ls in grupos.items():
            cfg = (ls[0].regras.cfg.get("reciclagem_auto") or {})
            if not cfg.get("ativo") or ls[0].reciclagem_auto_em == agora.date() or agora.strftime("%H:%M") < cfg["hora"]:
                continue
            pct = sum(l.sem_contato_pct() * len(l.itens) for l in ls) / max(1, sum(len(l.itens) for l in ls))
            for l in ls:
                l.reciclagem_auto_em = agora.date()
            if pct < cfg["sem_contato_pct"]:
                continue
            try:
                ped = self.registro.sb.rpc("registrar_reciclagem_auto_voz", {
                    "lote": lote_id, "excluir": cfg["excluir"], "sem_contato_pct": round(pct, 1)})
            except Exception as ex:   # noqa: BLE001
                log.warning("reciclagem automática: falha ao registrar (%s)", ex.__class__.__name__)
                continue
            if ped:
                n += 1
                self._processar_reciclagem(ped, ls)
        return n

    def agregar_passadas(self, dia) -> None:
        """Noite: voz_passadas_dia (contato por passada) de cada empresa desta VM, pelas regras do motor (e_cpc e
        chamada curta de motor/voz.py). Idempotente: refaz o dia inteiro."""
        from motor import discagem as DG
        from motor import voz as V
        regras = {"contato": sorted({d.chave for d in V.DESFECHOS if d.e_cpc}), "curta_sempre": list(V.NAO_COMPLETADA),
                  "curta_abandono": list(V.CURTA_SE_ABANDONO), "segundos": DG.PADRAO["chamadas_curtas"]["segundos"]}
        for emp in self._minhas():
            try:
                self.registro.sb.rpc("agregar_passadas_voz", {"empresa": emp, "dia": dia.isoformat(), "regras": regras})
            except Exception as ex:   # noqa: BLE001
                log.warning("empresa %s: contato por passada não agregado (%s)", emp, ex.__class__.__name__)

    def descarregar_tudo(self, so_periodico: bool = False) -> None:
        if self.registro is not None:
            if not so_periodico:
                self.registro.sincronizar(self._do_dia())
                self.registro.descarregar()
                self.registrar_ritmo(0.0, todos=True)      # parando: a janela aberta também vai
            self.registro.atualizar_consumo()
        if self.publicador is not None:
            self.publicador.publicar()

    def _recarregar_config(self) -> None:
        p = self.dados_caminho
        if p is None or not p.exists() or p.stat().st_mtime == self._mtime:
            return
        try:
            self.orq.atualizar_dados(B.carregar(json.loads(p.read_text(encoding="utf-8"))))
            self._mtime = p.stat().st_mtime
            log.info("configuração de voz recarregada")
        except (B.DadosInvalidos, ValueError) as ex:
            log.warning("voz.json inválido, mantida a configuração anterior (%s)", ex)

    def _carregar_listas(self, hoje) -> None:
        # dia novo: sai o lote de ontem (o que não foi discado fica para a lista de hoje do motor)
        for chave in [k for k, l in self.orq.lotes.items() if l.teste_id is None and self.carregados.get(k[0]) != hoje]:
            if not any(c.lote_chave == chave for c in self.orq.chamadas.values()):
                self.orq.lotes.pop(chave, None)
        for emp, cfg in sorted(self.orq.dados.configs.items()):
            if cfg.modo != self.modo or self.carregados.get(emp) == hoje or emp % self.parte[1] != self.parte[0] - 1:
                continue
            lotes = self.fonte.lotes(emp, hoje)
            if lotes is None:
                continue
            if emp not in self.orq.agendador.empresas:
                self.orq.agendador.registrar_empresa(cfg, self.orq.dados.troncos_da(emp))
            for l in lotes:
                self.orq.adicionar_lote(l)
            self.carregados[emp] = hoje
            self._ult["historico"] = -1e9            # lote novo: o histórico do Preditivo vem no próximo ciclo
            log.info("empresa %s: %d lote(s) do dia carregado(s)", emp, len(lotes))


def _rodar_plantao(plantao: Plantao, fila: queue.Queue, parar: threading.Event, passo_s: float = 0.2) -> None:
    orq = plantao.orq
    while not parar.is_set():
        fim = time.monotonic() + passo_s
        while time.monotonic() < fim:
            try:
                orq.ao_evento(fila.get(timeout=max(0.0, fim - time.monotonic())))
            except queue.Empty:
                break
        orq.tick()
        plantao.ciclo(time.monotonic())
    plantao.descarregar_tudo()


def _acesso_proprio_ok(parar: threading.Event | None = None, ambiente=None) -> bool:
    """Decisão do dono: o modo real só roda com o acesso próprio (SQL 57). Com a chave do servidor, o plantão real
    fica parado (sem discar) até o serviço ser parado, sem laço de reinício no systemd."""
    from voz.acesso import modo_do_ambiente
    if modo_do_ambiente(ambiente) == "acesso_proprio":
        return True
    log.error("modo real exige MOTORCX_VOZ_ACESSO=acesso_proprio (infra/asterisk/README.md, seção 7); "
              "o plantão real fica parado")
    if parar is None:
        import signal
        parar = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: parar.set())
    parar.wait()
    return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Orquestrador ARI do agente de voz do MotorCX")
    ap.add_argument("--dados", required=True, help="voz.json (voz/configuracao.py)")
    ap.add_argument("--eventos", required=True)
    ap.add_argument("--auto", action="store_true", help="plantão: listas do dia pelo Supabase, até o serviço parar")
    ap.add_argument("--modo", choices=("real", "simulado"), default="real")
    ap.add_argument("--parte", default="1/1", help="i/n: esta VM disca as empresas com id %% n == i-1 (2 VMs: 1/2 e 2/2)")
    ap.add_argument("--lista", action="append", default=[], help="empresa=<id>:<discador_mailing.csv> (manual)")
    ap.add_argument("--contratado", type=int, help="concorrência contratada (padrão: voz_contrato do voz.json)")
    ap.add_argument("--ari", default="http://127.0.0.1:8088")
    ap.add_argument("--provedores", default=os.environ.get("MOTORCX_PROVEDORES", "/etc/motorcx/provedores.json"))
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if a.auto and a.modo == "real" and not _acesso_proprio_ok():
        return 0
    bruto = json.loads(Path(a.dados).read_text(encoding="utf-8"))
    dados = B.carregar(bruto)
    contratado = a.contratado or int((bruto.get("voz_contrato") or {}).get("concorrencia_contratada") or 0)
    i, n = (int(x) for x in a.parte.split("/", 1))
    if not 1 <= i <= n:
        print("ERRO: --parte i/n com 1 <= i <= n")
        return 2
    contratado = contratado // n if not a.contratado else contratado     # o contratado é dividido entre as VMs
    if contratado <= 0:
        print("ERRO: concorrência contratada não definida (voz_contrato ou --contratado)")
        return 2
    if a.modo == "simulado":
        ari = AriSimulado()
    else:
        senha = Path(os.environ.get("MOTORCX_ARI_SENHA_ARQUIVO", "/run/motorcx/ari_senha")).read_text().strip()
        ari = AriHttp(a.ari, os.environ.get("MOTORCX_ARI_USUARIO", "motorcx"), senha)
        del senha
    from voz import provedores as PV
    from voz.segredos import SecretManager
    cfg_prov = PV.ler_config(a.provedores)
    segredos = SecretManager() if cfg_prov else None
    provedores = PV.criar_todos(cfg_prov, segredos)
    if a.modo == "real" and "elevenlabs" in provedores:     # SQL 63: webhook pós-chamada (só com ref_webhook)
        from voz.provedores.elevenlabs import ligar_receptor
        ligar_receptor(provedores["elevenlabs"], segredos)
    fila_envio = FilaEnvio(EnviadorGCS()) if a.modo == "real" else None
    fila: queue.Queue = queue.Queue()
    parar = threading.Event()
    if a.auto:
        from voz.configuracao import supabase_do_ambiente
        from voz.publicacao import Publicador
        from voz.registro import RegistroBanco
        sb = supabase_do_ambiente()
        registro = RegistroBanco(sb)
        if "montagem_motorcx" in provedores:    # SQL 58: a versão em uso do fluxo da carteira (sem fluxo: roteiro)
            from voz.fluxo import CarregadorFluxos
            # SQL 88: com o cofre, a identidade pode ser conferida pelo arquivo (a chave fica só na memória)
            provedores["montagem_motorcx"].fluxo_de = CarregadorFluxos(sb, segredos=segredos)
        from voz.transcricao.ia import GravadorTranscricaoIA
        orq = Orquestrador(ari, dados, Agendador(contratado=contratado), EscritorEventos(a.eventos), provedores,
                           relogio_brasilia, fila_envio=fila_envio, ao_registrar=registro.registrar,
                           ao_fluxo=registro.registrar_fluxo,
                           # SQL 63: conversa da IA mascarada para o Speech Analytics e a gravação em voz_gravacoes
                           transcricoes=GravadorTranscricaoIA(os.environ.get("MOTORCX_DIR_TRANSCRICOES",
                                                                             "/var/motorcx/transcricoes")),
                           ao_gravacao=registro.registrar_gravacao)
        usuario = os.environ.get("MOTORCX_VOZ_ENVIADO_POR", "")
        pub = Publicador(sb, a.eventos, usuario) if usuario else None
        if pub is None:
            log.warning("MOTORCX_VOZ_ENVIADO_POR não definido: os eventos ficam só na VM (sem envio ao motor)")
        plantao = Plantao(orq, FonteListas(sb, Path(a.eventos) / ".listas"), a.modo, Path(a.dados), registro, pub,
                          parte=(i, n), segredos=segredos)
        threading.Thread(target=_ouvir, args=(ari, fila, parar), daemon=True).start()
        import signal
        signal.signal(signal.SIGTERM, lambda *_: parar.set())
        _rodar_plantao(plantao, fila, parar)
        return 0
    listas = {}
    for x in a.lista:
        k, caminho = x.split(":", 1)
        listas[int(k.split("=", 1)[1])] = caminho
    orq = montar(dados, listas, contratado, ari, EscritorEventos(a.eventos), provedores, relogio_brasilia, fila_envio)
    threading.Thread(target=_ouvir, args=(ari, fila, parar), daemon=True).start()
    try:
        print(json.dumps(rodar(orq, fila), ensure_ascii=False))
    finally:
        parar.set()
    for al in orq.alertas:
        print("ALERTA:", al)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
