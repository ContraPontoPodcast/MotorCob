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

from voz import banco as B
from voz.orquestrador.agendador import Agendador
from voz.orquestrador.ari import AriHttp, AriSimulado
from voz.orquestrador.eventos import EscritorEventos
from voz.orquestrador.gravacao import EnviadorGCS, FilaEnvio
from voz.orquestrador.lote import Lote, RegrasLote, ler_ids, ler_mailing
from voz.orquestrador.nucleo import APP, Orquestrador
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

    def regras(self, empresa_id: int) -> dict:
        """Renitência por situação e Resubmit de cada carteira (credores.discagem pela RPC regras_discagem_voz, SQL
        65). Falhou ou carteira sem as chaves novas: sem regras, a discagem de hoje (paridade)."""
        try:
            linhas = self.sb.rpc("regras_discagem_voz", {"empresa": int(empresa_id)}) or []
        except Exception as ex:   # noqa: BLE001 — banco sem o SQL 65 ou fora: discagem de hoje
            log.warning("empresa %s: regras da discagem não lidas (%s); vale a discagem de hoje", empresa_id,
                        ex.__class__.__name__)
            return {}
        saida = {}
        for l in linhas:
            r = RegrasLote.da_carteira(l.get("discagem"))
            if r is not None:
                saida[l.get("credor_id")] = r
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
        regras = self.regras(empresa_id)
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
        return saida if achou else None


class Plantao:
    """O laço do serviço, em ciclos testáveis (ciclo(agora_s) sem dormir)."""

    def __init__(self, orq: Orquestrador, fonte: FonteListas, modo: str, dados_caminho: Path | None = None,
                 registro=None, publicador=None, relogio=relogio_brasilia, parte: tuple[int, int] = (1, 1)):
        self.orq, self.fonte, self.modo, self.dados_caminho = orq, fonte, modo, dados_caminho
        self.parte = parte          # (i, n): esta VM disca as empresas com id % n == i - 1
        self.registro, self.publicador, self.relogio = registro, publicador, relogio
        self.carregados: dict[int, object] = {}     # empresa -> dia carregado
        self._mtime = dados_caminho.stat().st_mtime if dados_caminho and dados_caminho.exists() else None
        self._ult = {"listas": -1e9, "banco": -1e9, "consumo": -1e9, "reenvio": -1e9}
        self.agregado: object = None                 # último dia agregado em voz_passadas_dia

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
            self.registro.sincronizar(list(self.orq.lotes.values()))
            self.registro.descarregar()
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
        for l in self.orq.lotes.values():
            if l.lote_id is None:
                grupos.setdefault((l.empresa_id, l.credor_id), []).append(l)
        for (emp, cid), ls in grupos.items():
            lid = self.registro.lote_do_dia(emp, cid, hoje, sum(len(l.itens) for l in ls))
            for l in ls:
                l.lote_id = lid

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
                self.registro.sincronizar(list(self.orq.lotes.values()))
                self.registro.descarregar()
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
        for chave in [k for k, l in self.orq.lotes.items() if self.carregados.get(k[0]) != hoje]:
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
            provedores["montagem_motorcx"].fluxo_de = CarregadorFluxos(sb)
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
                          parte=(i, n))
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
