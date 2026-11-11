"""Simulação de discagem para o Power e o Preditivo (V5): o agendador e o controlador DE VERDADE (voz/orquestrador), com
um mundo falso de segundo em segundo: toque, atendimento por pessoa com chance p(t), caixa postal/máquina, AMD de 2 s,
robô reservado no atendimento, conversa com duração exponencial e abandono quando a pessoa atende sem robô.
Só números; nenhum telefone. Usada por tests/test_voz_ritmo.py (TestSimulacaoPreditivo)."""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta

from tests.test_voz_gerador import dados_exemplo
from voz import banco as B
from voz.orquestrador.agendador import Agendador
from voz.orquestrador.ritmo import Historico, RitmoCarteira

INICIO = datetime(2026, 11, 3, 9, 0, 0)


@dataclass
class Linha:
    atende_em: float | None       # segundo em que atende (None = não atende)
    fim_toque: float              # segundo em que desiste (não atendeu)
    tipo: str                     # pessoa | maquina | nada
    reservada: bool
    estado: str = "tocando"       # tocando | amd | conversa | fim
    amd_em: float = 0.0
    fim_em: float = 0.0


def simular(p_de, robos=30, segundos=3 * 3600, ritmo=None, seed=7, conversa_media=90.0, maquina=0.3,
            historico=None, aquecida=True):
    """p_de(t_s) -> chance de atender por pessoa no segundo t. Devolve as contagens e o abandono."""
    rnd = random.Random(seed)
    d = dados_exemplo()
    d["voz_config"][0].update({"limite_simultaneas": robos, "pico_multiplo": 1})
    dados = B.carregar(d)
    ag = Agendador(contratado=10 ** 6)
    ag.registrar_empresa(dados.config(1), dados.troncos_da(1))
    ag.empresas[1].canais = 10 ** 5
    ritmo = ritmo or {"modo": "preditivo", "razao": 1.0, "meta_abandono": 1.0, "razao_max": 3.0}
    ctrl = RitmoCarteira(historico=historico or (Historico(discadas_7d=5000, atendidas_7d=600, dias_preditivo=30)
                                                 if aquecida else Historico()))
    linhas: list[Linha] = []
    conversas: list[float] = []                  # fim de cada conversa em andamento
    inicio_conversa: dict[int, float] = {}
    tot = {"discadas": 0, "pessoas": 0, "abandonos": 0, "conversa_s": 0.0, "razoes": [], "freou": 0, "power": 0}
    for t in range(segundos):
        agora = INICIO + timedelta(seconds=t)
        # fim das conversas
        fim = [x for x in conversas if x <= t]
        for _ in fim:
            ag.fim_conversa(1)
            ag.liberar(1, None)
        conversas = [x for x in conversas if x > t]
        for ln in linhas:
            if ln.estado == "tocando":
                if ln.atende_em is not None and t >= ln.atende_em:
                    if not ln.reservada:
                        ln.reservada = ag.reservar(1)
                    ln.estado, ln.amd_em = "amd", t + 2
                elif ln.atende_em is None and t >= ln.fim_toque:
                    ln.estado = "fim"
                    if ln.reservada:                                 # não atendeu: o robô reservado volta
                        ag.devolver_reserva(1)
                    ag.liberar(1, None)
                    tot["discadas"] += 1
                    ctrl.discou(agora, False)
            elif ln.estado == "amd" and t >= ln.amd_em:
                tot["discadas"] += 1
                if ln.tipo == "pessoa":
                    tot["pessoas"] += 1
                    ok = ag.conversar(1, ln.reservada)
                    if ok is None:                                   # atendeu sem robô: abandono (mensagem)
                        tot["abandonos"] += 1
                        ln.estado = "fim"
                        ag.liberar(1, None)
                        r = ctrl.resultado_pessoa(True, agora, ritmo)
                    else:
                        dur = rnd.expovariate(1 / conversa_media)
                        conversas.append(t + dur)
                        tot["conversa_s"] += dur
                        ln.estado = "conversa"
                        r = ctrl.resultado_pessoa(False, agora, ritmo)
                    ctrl.discou(agora, True, toque_s=int(ln.atende_em - (ln.fim_toque - 40)), conversa_s=int(conversa_media))
                    tot["freou"] += r == "freou"
                    tot["power"] += r == "power"
                else:                                                # máquina: o robô volta
                    if ln.reservada:
                        ag.devolver_reserva(1)
                    ln.estado = "fim"
                    ag.liberar(1, None)
                    ctrl.discou(agora, False)
        linhas = [ln for ln in linhas if ln.estado not in ("fim", "conversa")]
        ctrl.rever(agora, ritmo)
        razao = ctrl.razao(ritmo, agora)
        tot["razoes"].append(razao)
        # previsão dos robôs que liberam até a linha nova atender
        liberando = sum(1 for x in conversas if x - t <= ctrl.T) if razao > 1 else 0
        novas = 0
        while novas < 50 and ag.vaga_empresa(1, razao=razao, livres_extra=liberando):
            ctrl.comecou(agora)
            res = ag.ocupar(1, 10, pode_reservar=razao <= 1.0)   # razão > 1: todas reservam no atendimento
            p = p_de(t)
            u = rnd.random()
            tipo = "pessoa" if u < p else ("maquina" if u < p + maquina else "nada")
            toque = rnd.uniform(4, 25)
            linhas.append(Linha(atende_em=t + toque if tipo != "nada" else None, fim_toque=t + 40, tipo=tipo,
                                reservada=res))
            novas += 1
    tot["abandono_pct"] = 100.0 * tot["abandonos"] / max(1, tot["pessoas"])
    tot["uso_robos"] = tot["conversa_s"] / (robos * segundos)
    tot["razao_media"] = sum(tot["razoes"]) / len(tot["razoes"])
    tot["razao_max"] = max(tot["razoes"])
    tot["conversas_hora"] = tot["pessoas"] / (segundos / 3600)
    del tot["razoes"]
    return tot
