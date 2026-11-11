"""Testar a rota de verdade (SQL 114 · Telefonia T5; seção F do parecer, G1).

  python3 -m voz.testador --dados /run/motorcx/voz.json       (serviço motorcx-voz-teste, nas duas VMs)

Pega o próximo pedido do banco (pegar_teste_tronco_voz: "for update skip locked", as duas VMs podem rodar). O número de
teste NUNCA passa pelo banco: o pedido traz só a referência do segredo (voz/trunk/e<empresa>/teste-…), e o número é lido
no cofre (Secret Manager, como a senha do tronco) e fica só na memória deste teste. Liga de verdade para o número de teste
pelo tronco pedido, com o app ARI próprio `motorcx-teste` (o orquestrador não vê estas ligações). Cada passo vai para
o banco assim que termina (registrar_teste_tronco_voz), e a tela mostra ao vivo. Para no primeiro ✕ obrigatório (★).

  0 ★ Conferência: o tronco está no voz.json desta VM (com a última mudança), o nome resolve só para IP público e o
      endpoint subiu no Asterisk (com senha: o servidor de voz leu a senha no cofre). Os IPs no firewall e a senha
      guardada o banco já conferiu no pedido.
  1   A operadora está no ar? OPTIONS por UDP (voz/sip_options.py) com o tempo de resposta; TCP/TLS: o estado do
      endpoint (qualify). Sem resposta não reprova.
  2 ★ A operadora aceitou o MotorCX? · 3 ★ O número foi aceito? · 4 ★ O celular tocou? — pela ligação (ARI originate,
      bina do tronco, toque máximo do tronco) e o código SIP final (tech_cause do ChannelDestroyed).
  5 ★ O áudio chega ao celular e as teclas voltam? — toca bipes; a pessoa digita o código de 4 dígitos que está na tela
      (o mesmo código confirma o número de teste no banco).
  6 ★ O áudio do celular chega ao MotorCX? — TALK_DETECT no canal: a pessoa diz "testando, um, dois, três".
  7   Qualidade da linha — CHANNEL(rtpqos,audio,all): atraso, variação e perda.
  8 ★ A bina está certa? — a pessoa responde na tela (responder_bina_teste_voz).
  9 ★ O desligamento chega ao MotorCX? — a pessoa desliga e o MotorCX precisa saber em até 20 s.

As instruções para a pessoa ("digite o código", "diga testando…", "confira a bina", "pode desligar") estão na tela, que
acompanha o passo em andamento: o servidor de voz só toca bipes, não precisa de áudio gravado. Nada de número, senha ou
dado de cliente vai para log ou para o banco (as mensagens dos passos não têm número).
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import threading
import time
import uuid
from pathlib import Path

from voz import banco as B
from voz import destinos as DST
from voz import sip_options
from voz import tarifacao as T
from voz.segredos import Resolvedor

APP = "motorcx-teste"
OBRIGATORIOS = (0, 2, 3, 4, 5, 6, 8, 9)
TITULOS = {0: "Conferência antes de ligar", 1: "A operadora está no ar?", 2: "A operadora aceitou o MotorCX?",
           3: "O número foi aceito?", 4: "O celular tocou?", 5: "O áudio chega ao celular e as teclas voltam?",
           6: "O áudio do celular chega ao MotorCX?", 7: "Qualidade da linha", 8: "A bina está certa?",
           9: "O desligamento chega ao MotorCX?"}
BIPES = "tone:!1000/250,!0/250,!1000/250,!0/1250"      # repete enquanto espera as teclas
ESPERA_TECLAS_S, ESPERA_VOZ_S, ESPERA_BINA_S, ESPERA_DESLIGAR_S = 25, 15, 45, 25
TOQUE_LENTO_S, OPTIONS_LENTO_MS = 6.0, 300
FORMATO_TXT = {"tech_ddd_numero": "DDD + número", "tech_0_csp_ddd_numero": "0 + CSP + DDD + número",
               "tech_55_ddd_numero": "55 + DDD + número", "tech_e164": "+55 DDD número"}


class Cancelado(Exception):
    pass


def _instante(v) -> float:
    """Data/hora ISO do banco -> segundos (0 se vazio ou ilegível)."""
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp() if v else 0.0
    except ValueError:
        return 0.0


def ips_motorcx() -> str:
    return os.environ.get("MOTORCX_IPS_SAIDA", "os IPs de saída do MotorCX")


def mensagem_falha(sip: int | None, q850: int | None, autenticacao: str, tocou: bool) -> tuple[int, str, str]:
    """(passo, resultado, mensagem) da ligação que não foi atendida, pelo código SIP final (D11)."""
    s = sip or 0
    if s in (480, 486, 487) or (tocou and s in (0, 603) and q850 in (16, 17, 18, 19, 21, None)):
        return 4, "inconclusivo", ("O celular de teste não atendeu, estava ocupado ou recusou. A rota parece funcionar: "
                                   "atenda e teste de novo.")
    if s in (401, 407) or (s == 403 and autenticacao == "senha"):
        return 2, "falha", "A operadora recusou o usuário ou a senha. Confira o passo 2 e guarde a senha de novo."
    if s == 403:
        return 2, "falha", ("A operadora recusou: ela não reconhece os IPs do MotorCX. Mande a ficha técnica para a "
                            f"operadora liberar {ips_motorcx()}.")
    if s == 402:
        return 2, "falha", "A operadora diz que não há crédito neste contrato."
    if s == 408 or (s == 0 and q850 in (18, 102, 41, 38, None)):
        return 2, "falha", ("A operadora não respondeu à ligação. Confira o endereço e a porta (passo 3) e se a operadora "
                            "já liberou os IPs do MotorCX.")
    if s == 503 or (s == 0 and q850 in (34, 42)):
        return 2, "falha", "A operadora está congestionada ou fora do ar. Tente de novo em alguns minutos."
    if s in (404, 484, 400, 485) or (s == 0 and q850 in (1, 28)):
        return 3, "falha", "A operadora não entendeu o número. Confira o formato, o CSP e o prefixo (passo 5)."
    if s in (488, 415, 606) or (s == 0 and q850 in (58, 65, 88)):
        return 3, "falha", "A operadora não aceitou o formato do áudio. Em Avançado, deixe só G.711 A-law."
    if s in (603, 608) or 433 <= s <= 438:
        return 3, "falha", "A operadora bloqueou ligações saindo deste contrato. Fale com ela antes de testar de novo."
    return 2, "falha", f"A operadora recusou a ligação (código SIP {s or 'sem código'}). Veja a tabela de erros da operadora."


def qualidade(rtpqos: str | None) -> tuple[str, str]:
    """(resultado, mensagem) do CHANNEL(rtpqos,audio,all): 'ssrc=…;lp=0;rxjitter=0.002;rxcount=…;rtt=0.045;…'."""
    if not rtpqos:
        return "aviso", "Não deu para medir a qualidade desta ligação."
    v = {}
    for parte in rtpqos.split(";"):
        k, _, x = parte.partition("=")
        try:
            v[k.strip()] = float(x)
        except ValueError:
            continue
    rx = v.get("rxcount") or 0
    perda = (v.get("lp", 0) / (rx + v.get("lp", 0)) * 100) if rx + v.get("lp", 0) > 0 else 0.0
    atraso = v.get("rtt", 0) * 1000 if v.get("rtt", 0) < 10 else v.get("rtt", 0)
    var = v.get("rxjitter", 0) * 1000 if v.get("rxjitter", 0) < 10 else v.get("rxjitter", 0)
    txt = (f"atraso {atraso:.0f} ms, variação {var:.0f} ms, perda {perda:.1f}%").replace(".", ",")
    if atraso > 150 or var > 30 or perda > 1:
        return "aviso", f"Qualidade abaixo do ideal: {txt}. O agente pode entender mal."
    return "ok", f"Qualidade boa: {txt}."


class Teste:
    """Um teste de rota. `eventos`: fila com os eventos ARI do app motorcx-teste."""

    def __init__(self, sb, ari, pedido: dict, dados: B.DadosVoz, bruto: dict, eventos: "queue.Queue",
                 relogio=time.monotonic, dormir=time.sleep, ip_externo: str = "", proprios=(), resolver=None,
                 options=sip_options.perguntar, segredos: Resolvedor | None = None):
        self.sb, self.ari, self.p, self.dados, self.bruto = sb, ari, pedido, dados, bruto
        self.ev, self.relogio, self.dormir = eventos, relogio, dormir
        self.ip_externo, self.proprios, self.resolver, self.options = ip_externo, proprios, resolver, options
        self.segredos = segredos
        self.id = int(pedido["id"])
        self.passos: list[dict] = []
        self.canal: str | None = None
        self.desligou_la = False
        self.espera_fila = 1.0           # quanto a fila de eventos espera de cada vez (os testes encurtam)

    # ---------------------------------------------------------- registro
    def _marca(self, passo: int, resultado: str, mensagem: str = "") -> None:
        self.passos = [x for x in self.passos if x["passo"] != passo]
        self.passos.append({"passo": passo, "resultado": resultado, "mensagem": mensagem[:300]})
        self.passos.sort(key=lambda x: x["passo"])
        sit = self.sb.rpc("registrar_teste_tronco_voz", {"teste": self.id, "passos": self.passos})
        if sit in ("cancelado", "expirado"):
            raise Cancelado(sit)

    def _final(self) -> str:
        falha = next((x for x in self.passos if x["resultado"] == "falha" and x["passo"] in OBRIGATORIOS), None)
        incon = next((x for x in self.passos if x["resultado"] == "inconclusivo"), None)
        avisos = [x for x in self.passos if x["resultado"] == "aviso"]
        if falha:
            sit = "falhou"
            resumo = f"A rota não passou no teste. {falha['mensagem']} Nada liga para cliente por esta rota até passar."
        elif incon:
            sit, resumo = "incompleto", f"Teste incompleto: {incon['mensagem']}"
        elif avisos:
            sit = "atencao"
            resumo = (f"A rota funciona, com {len(avisos)} ponto{'s' if len(avisos) > 1 else ''} de atenção. "
                      + avisos[0]["mensagem"])
        else:
            sit = "passou"
            resumo = "A rota passou no teste. Pode usar em Só números de teste. Para Real, veja o caminho na tela."
        self.sb.rpc("registrar_teste_tronco_voz", {"teste": self.id, "passos": self.passos, "situacao": sit,
                                                   "resumo": resumo[:400]})
        return sit

    # ---------------------------------------------------------- eventos
    def _esperar(self, quer, tempo: float) -> dict | None:
        fim = self.relogio() + tempo
        while True:
            falta = fim - self.relogio()
            if falta <= 0:
                return None
            try:
                e = self.ev.get(timeout=min(falta, self.espera_fila))
            except queue.Empty:
                continue
            if (e.get("channel") or {}).get("id") != self.canal:
                continue
            if e.get("type") in ("ChannelHangupRequest", "StasisEnd", "ChannelDestroyed"):
                self.desligou_la = True
            if quer(e):
                return e
            if e.get("type") == "ChannelDestroyed":
                return e

    # ---------------------------------------------------------- passos
    def rodar(self) -> str:
        try:
            return self._rodar()
        except Cancelado:
            return "cancelado"
        finally:
            if self.canal and not self.desligou_la:
                try:
                    self.ari.desligar(self.canal)
                except Exception:   # noqa: BLE001 — já desligou
                    pass

    def _rodar(self) -> str:
        t = self.dados.tronco(int(self.p["tronco_id"]))
        if not self._passo0(t):
            return self._final()
        self._passo1(t)
        numero = self._numero()
        if not numero:
            self._marca(2, "falha", "O servidor de voz não conseguiu ler o número de teste no cofre. Cadastre o número de "
                                    "novo em Números de teste.")
            return self._final()
        tipo = T.tipo_numero(numero, t.ddd_origem)
        rotas = sorted((r for r in self.dados.rotas if r.tronco_id == t.id), key=lambda r: (r.tipo != tipo, r.prioridade, r.id))
        prefixo = rotas[0].prefixo_discagem if rotas else ""
        self.canal = f"teste-{self.id}-{uuid.uuid4().hex[:8]}"
        self._marca(2, "rodando", "Ligando para o número de teste…")
        ini = self.relogio()
        try:
            self.ari.originar(f"PJSIP/{t.discar(prefixo, numero)}@{t.nome}", self.canal, APP, ["teste", str(self.id)],
                              callerid=t.bina, timeout=t.toque_max_s)
        except Exception:   # noqa: BLE001 — ARI recusou (endpoint sumiu no meio): falha técnica, sem detalhe
            self.canal = None
            self._marca(2, "falha", "O servidor de voz não conseguiu mandar a ligação. Tente de novo em 2 minutos.")
            return self._final()
        tocou_em = None
        aceito = ("A operadora aceitou a ligação vinda do MotorCX." if t.autenticacao == "ip"
                  else "Usuário e senha aceitos.")
        while True:
            e = self._esperar(lambda e: e.get("type") in ("ChannelStateChange", "StasisStart"), t.toque_max_s + 10)
            if e is None:
                self._marca(2, "falha", "A operadora não respondeu à ligação. Confira o endereço e a porta (passo 3).")
                return self._final()
            if e["type"] == "ChannelStateChange" and (e.get("channel") or {}).get("state") == "Ringing" and tocou_em is None:
                tocou_em = self.relogio() - ini
                self._marca(2, "ok", aceito)
                self._marca(3, "ok", f"A operadora entendeu o número ({FORMATO_TXT.get(t.formato_discagem, 'DDD + número')}).")
                lento = tocou_em > TOQUE_LENTO_S
                self._marca(4, "aviso" if lento else "ok",
                            (f"Tocou, mas demorou {tocou_em:.1f} s para começar. As pessoas desistem antes." if lento
                             else f"O celular começou a tocar em {tocou_em:.1f} s.").replace(".", ",", 1))
                self._marca(5, "rodando", "Atenda o celular de teste.")
                continue
            if e["type"] == "StasisStart":
                break
            if e["type"] == "ChannelDestroyed":
                passo, res, msg = mensagem_falha(B._int(e["tech_cause"], "sip") if e.get("tech_cause") else None,
                                                 e.get("cause"), t.autenticacao, tocou_em is not None)
                if passo > 2 and not any(x["passo"] == 2 and x["resultado"] == "ok" for x in self.passos):
                    self._marca(2, "ok", aceito)
                if passo > 3 and not any(x["passo"] == 3 and x["resultado"] == "ok" for x in self.passos):
                    self._marca(3, "ok", f"A operadora entendeu o número ({FORMATO_TXT.get(t.formato_discagem)}).")
                self.passos = [x for x in self.passos if x["resultado"] != "rodando"]
                self._marca(passo, res, msg)
                return self._final()
        # atendeu
        if tocou_em is None:
            self._marca(2, "ok", aceito)
            self._marca(3, "ok", f"A operadora entendeu o número ({FORMATO_TXT.get(t.formato_discagem, 'DDD + número')}).")
            self._marca(4, "ok", "O celular atendeu.")
        if not self._passo5():
            return self._final()
        if not self._passo6():
            return self._final()
        self._passo7()
        if not self._passo8():
            return self._final()
        self._passo9()
        return self._final()

    def _numero(self) -> str | None:
        """O número de teste lido no cofre pela referência (nunca vai para log nem para o banco)."""
        ref = str(self.p.get("numero_ref") or "")
        if not re.fullmatch(r"voz/trunk/e[1-9]\d{0,18}/teste-[0-9a-f]{12}", ref) or self.segredos is None:
            return None
        try:
            d = re.sub(r"\D", "", self.segredos.valor(ref))
        except Exception:   # noqa: BLE001 — cofre fora, sem permissão ou segredo apagado: sem detalhe (nada de número)
            return None
        d = d[2:] if re.fullmatch(r"55\d{10,11}", d) else d
        return d if re.fullmatch(r"[1-9][1-9]\d{8,9}", d) else None

    def _passo0(self, t: B.Tronco | None) -> bool:
        if t is None:
            self._marca(0, "falha", "O tronco ainda não chegou ao servidor de voz. Tente de novo em 2 minutos.")
            return False
        linha = next((x for x in self.bruto.get("voz_troncos") or [] if int(x.get("id", 0)) == t.id), {})
        if _instante(linha.get("atualizado_em")) < _instante(self.p.get("atualizado_em")):
            self._marca(0, "falha", "O servidor de voz ainda está carregando a última mudança do tronco. "
                                    "Tente de novo em 2 minutos.")
            return False
        motivo = DST.motivo_host(t.host, self.proprios, self.resolver)
        if motivo:
            self._marca(0, "falha", "O endereço do tronco não foi encontrado na internet ou não é um endereço público. "
                                    "Confira com a operadora.")
            return False
        if self.ari.endpoint("PJSIP", t.nome) is None:
            self._marca(0, "falha", "O servidor de voz não conseguiu ler a senha. Guarde a senha de novo."
                        if t.autenticacao == "senha" else
                        "O tronco ainda não subiu no servidor de voz. Tente de novo em 2 minutos.")
            return False
        self._marca(0, "ok", "Dados conferidos e tronco carregado no servidor de voz.")
        return True

    def _passo1(self, t: B.Tronco) -> None:
        if not t.verificar_options:
            self._marca(1, "aviso", "A verificação da operadora (OPTIONS) está desligada neste tronco.")
            return
        if t.transporte == "udp":
            r = self.options(t.host, t.porta, self.ip_externo)
            if r is None:
                self._marca(1, "aviso", "A operadora não respondeu à verificação. Algumas operadoras ignoram essa "
                                        "pergunta. Vamos tentar a ligação mesmo assim.")
            elif r[1] > OPTIONS_LENTO_MS:
                self._marca(1, "aviso", f"A operadora respondeu, mas demorou {r[1]} ms. Ligações podem atrasar para começar.")
            else:
                self._marca(1, "ok", f"A operadora respondeu em {r[1]} ms.")
            return
        estado = (self.ari.endpoint("PJSIP", t.nome) or {}).get("state")
        if estado == "online":
            self._marca(1, "ok", "A operadora respondeu à verificação.")
        else:
            self._marca(1, "aviso", "A operadora não respondeu à verificação. Vamos tentar a ligação mesmo assim.")

    def _passo5(self) -> bool:
        self._marca(5, "rodando", "Digite no celular o código que está na tela.")
        try:
            self.ari.definir_variavel(self.canal, "TALK_DETECT(set)", "")
        except Exception:   # noqa: BLE001 — sem detecção de voz: o passo 6 decide sem ela
            pass
        self.ari.tocar(self.canal, BIPES, f"bip-{self.canal}")
        codigo, digitos, falou = str(self.p.get("codigo") or ""), "", False
        fim = self.relogio() + ESPERA_TECLAS_S
        while self.relogio() < fim and len(digitos) < len(codigo):
            e = self._esperar(lambda e: e.get("type") in ("ChannelDtmfReceived", "ChannelTalkingStarted"),
                              fim - self.relogio())
            if e is None:
                break
            if e["type"] == "ChannelDestroyed":
                self._marca(5, "falha", "A ligação caiu antes de terminar o teste.")
                return False
            if e["type"] == "ChannelTalkingStarted":
                falou = True
            elif e["type"] == "ChannelDtmfReceived":
                digitos += str(e.get("digit", ""))[:1]
        self.falou = falou
        if digitos and digitos == codigo:
            self._marca(5, "ok", "Áudio do MotorCX para o celular: ok. O código chegou pelas teclas.")
            return True
        if digitos:
            self._marca(5, "aviso", "As teclas chegaram, mas o código não confere com o da tela: o número de teste não "
                                    "foi confirmado.")
            return True
        if falou:
            self._marca(5, "aviso", "Ouvimos a sua voz, mas as teclas não chegaram. Em Avançado › Envio das teclas, tente "
                                    "'No áudio (inband)' e teste de novo.")
            return True
        self._marca(5, "falha", "O celular atendeu, mas não recebemos tecla nem voz. Provável áudio de um lado só: confira "
                                "com a operadora a liberação das portas de áudio 10000–20000 dos IPs do MotorCX.")
        return False

    def _passo6(self) -> bool:
        self._marca(6, "rodando", "Agora diga no celular: testando, um, dois, três.")
        e = self._esperar(lambda e: e.get("type") == "ChannelTalkingStarted", ESPERA_VOZ_S)
        if e is not None and e.get("type") == "ChannelTalkingStarted":
            self._marca(6, "ok", "Áudio do celular para o MotorCX: ok.")
            return True
        if e is not None and e.get("type") == "ChannelDestroyed":
            self._marca(6, "falha", "A ligação caiu antes de terminar o teste.")
            return False
        if getattr(self, "falou", False):
            self._marca(6, "ok", "Áudio do celular para o MotorCX: ok (ouvimos a sua voz no passo anterior).")
            return True
        self._marca(6, "falha", "Não chegou áudio do celular. Quase sempre é o firewall: confira os IPs de áudio da "
                                "operadora (passo 2) e peça a ela os IPs do equipamento de mídia.")
        return False

    def _passo7(self) -> None:
        try:
            v = self.ari.ler_variavel(self.canal, "CHANNEL(rtpqos,audio,all)")
        except Exception:   # noqa: BLE001
            v = None
        res, msg = qualidade(v)
        self._marca(7, res, msg)

    def _passo8(self) -> bool:
        self._marca(8, "rodando", "Confira o número que apareceu no celular e responda na tela.")
        fim = self.relogio() + ESPERA_BINA_S
        resp = None
        while self.relogio() < fim:
            r = self.sb.rpc("ler_teste_tronco_voz", {"teste": self.id}) or {}
            if r.get("situacao") in ("cancelado", "expirado"):
                raise Cancelado(r["situacao"])
            resp = r.get("bina_resposta")
            if resp:
                break
            self._esperar(lambda e: False, 1.0)     # consome eventos (e nota se desligou)
            if self.desligou_la:
                break
        if resp == "certa":
            self._marca(8, "ok", "Bina correta (confirmado por você).")
            return True
        if resp == "outro":
            self._marca(8, "falha", "Bina errada: a operadora trocou o número. Confira o passo 4 e se a bina está neste "
                                    "contrato.")
            return False
        if resp == "privado":
            self._marca(8, "falha", "A operadora não está mostrando o número. Peça para ela liberar a apresentação da bina.")
            return False
        self._marca(8, "inconclusivo", "Não recebemos a resposta da bina na tela. Responda e teste de novo.")
        return False

    def _passo9(self) -> None:
        if self.desligou_la:
            self._marca(9, "ok", "Você desligou e o MotorCX soube.")
            return
        self._marca(9, "rodando", "Pode desligar agora.")
        ini = self.relogio()
        e = self._esperar(lambda e: e.get("type") in ("ChannelHangupRequest", "StasisEnd"), ESPERA_DESLIGAR_S)
        if e is not None:
            self._marca(9, "ok", f"Você desligou e o MotorCX soube em {self.relogio() - ini:.1f} s.".replace(".", ",", 1))
        else:
            self._marca(9, "falha", "O MotorCX não soube que você desligou. Isso deixa ligações penduradas e cobradas. "
                                    "Confira com a operadora os IPs de sinalização dela (passo 2).")


# ---------------------------------------------------------- serviço
def carregar_dados(arq: Path) -> tuple[B.DadosVoz, dict]:
    bruto = json.loads(arq.read_text(encoding="utf-8"))
    return B.carregar(bruto), bruto


def ouvir(ari, fila: "queue.Queue", parar: threading.Event) -> None:
    while not parar.is_set():
        try:
            for e in ari.eventos(APP):
                fila.put(e)
                if parar.is_set():
                    return
        except Exception as ex:   # noqa: BLE001 — Asterisk reiniciou: reconecta
            print(f"AVISO: eventos do ARI caíram ({ex.__class__.__name__}); reconectando", file=sys.stderr)
            time.sleep(2)


def uma_vez(sb, ari, dados_arq: Path, fila: "queue.Queue", vm: str, **kw) -> str | None:
    pedido = sb.rpc("pegar_teste_tronco_voz", {"vm": vm})
    if not pedido:
        return None
    while not fila.empty():             # eventos velhos de outro teste
        fila.get_nowait()
    try:
        dados, bruto = carregar_dados(dados_arq)
    except (OSError, ValueError, B.DadosInvalidos):
        dados, bruto = B.DadosVoz(troncos=[], rotas=[], transferencias=[], configs={}), {}
    sit = Teste(sb, ari, pedido, dados, bruto, fila, **kw).rodar()
    print(json.dumps({"teste": int(pedido["id"]), "tronco": int(pedido["tronco_id"]), "situacao": sit}))
    return sit


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Testar a rota de verdade (SQL 114)")
    ap.add_argument("--dados", default="/run/motorcx/voz.json")
    ap.add_argument("--ari", default="http://127.0.0.1:8088")
    ap.add_argument("--intervalo", type=float, default=2.0)
    a = ap.parse_args(argv)
    from voz.acesso import conectar_do_ambiente
    from voz.orquestrador.ari import AriHttp
    from voz.segredos import SecretManager, Tardio
    senha = Path(os.environ.get("MOTORCX_ARI_SENHA_ARQUIVO", "/run/motorcx/ari_senha")).read_text().strip()
    ari = AriHttp(a.ari, os.environ.get("MOTORCX_ARI_USUARIO", "motorcx"), senha)
    sb = conectar_do_ambiente()
    ip = os.environ.get("MOTORCX_IP_EXTERNO", "")
    proprios = DST.proprios_do_ambiente(ip, [os.environ.get("MOTORCX_REDE_LOCAL", "")])
    vm = re.sub(r"[^a-z0-9-]", "-", (os.environ.get("MOTORCX_VM_NOME") or "motorcx-voz").lower())[:63]
    segredos = Tardio(SecretManager)       # só lê segredos motorcx-voz-* (a conta da VM)
    fila: queue.Queue = queue.Queue()
    parar = threading.Event()
    threading.Thread(target=ouvir, args=(ari, fila, parar), daemon=True).start()
    while True:
        try:
            if uma_vez(sb, ari, Path(a.dados), fila, vm, ip_externo=ip, proprios=proprios,
                       resolver=DST.resolver_dns, segredos=segredos) is None:
                time.sleep(a.intervalo)
        except Exception as ex:   # noqa: BLE001 — banco fora: tenta de novo (o pedido expira sozinho em 10 min)
            print(f"ERRO: teste da rota ({ex.__class__.__name__}: {str(ex)[:200]})", file=sys.stderr)
            time.sleep(5)


if __name__ == "__main__":
    sys.exit(main())
