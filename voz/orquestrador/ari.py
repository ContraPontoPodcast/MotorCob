"""Cliente ARI (Asterisk REST Interface): a interface que o orquestrador usa, a implementação HTTP real e uma falsa
para os testes (sem Asterisk).

O ARI fica só em 127.0.0.1:8088 (http.conf); usuário e senha vêm do Secret Manager (motorcx-voz-ari-senha).
"""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Iterator


class ErroARI(RuntimeError):
    def __init__(self, msg: str, status: int | None = None):
        super().__init__(msg)
        self.status = status


class ClienteARI:
    """Interface. Todos os métodos levantam ErroARI em falha (o orquestrador decide o que fazer)."""

    def originar(self, endpoint: str, id_canal: str, app: str, app_args: list[str], variaveis: dict | None = None,
                 callerid: str | None = None, timeout: int = 40) -> dict:
        raise NotImplementedError

    def continuar(self, canal: str, contexto: str, extensao: str = "s", prioridade: int = 1) -> None:
        raise NotImplementedError

    def definir_variavel(self, canal: str, nome: str, valor: str) -> None:
        raise NotImplementedError

    def desligar(self, canal: str, motivo: str = "normal") -> None:
        raise NotImplementedError

    def criar_ponte(self, id_ponte: str) -> None:
        raise NotImplementedError

    def adicionar_na_ponte(self, ponte: str, canais: list[str]) -> None:
        raise NotImplementedError

    def remover_da_ponte(self, ponte: str, canais: list[str]) -> None:
        raise NotImplementedError

    def destruir_ponte(self, ponte: str) -> None:
        raise NotImplementedError

    def tocar(self, canal: str, midia: str, id_playback: str) -> None:
        raise NotImplementedError

    def midia_externa(self, id_canal: str, app: str, host_porta: str, formato: str = "slin16") -> dict:
        raise NotImplementedError

    def recarregar_modulo(self, modulo: str) -> None:
        raise NotImplementedError

    def eventos(self, app: str) -> Iterator[dict]:
        raise NotImplementedError


class AriHttp(ClienteARI):
    """ARI real. REST com urllib; eventos pelo WebSocket (websocket-client, em voz/requirements.txt)."""

    def __init__(self, base: str = "http://127.0.0.1:8088", usuario: str = "motorcx", senha: str = "",
                 timeout: float = 5.0):
        if not senha:
            raise ValueError("senha do ARI vazia")
        self.base = base.rstrip("/")
        self._auth = "Basic " + base64.b64encode(f"{usuario}:{senha}".encode()).decode()
        self.timeout = timeout

    def _req(self, metodo: str, caminho: str, params: dict | None = None, corpo: dict | None = None):
        q = ("?" + urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})) if params else ""
        dados = json.dumps(corpo).encode() if corpo is not None else None
        req = urllib.request.Request(f"{self.base}/ari{caminho}{q}", data=dados, method=metodo,
                                     headers={"Authorization": self._auth, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                txt = r.read().decode()
        except urllib.error.HTTPError as ex:
            raise ErroARI(f"{metodo} {caminho.split('/')[1]} -> {ex.code}", ex.code) from None
        except (urllib.error.URLError, TimeoutError) as ex:
            raise ErroARI(f"{metodo} {caminho.split('/')[1]}: {ex.__class__.__name__}") from None
        return json.loads(txt) if txt else {}

    def originar(self, endpoint, id_canal, app, app_args, variaveis=None, callerid=None, timeout=40):
        params = {"endpoint": endpoint, "app": app, "appArgs": ",".join(app_args), "callerId": callerid,
                  "timeout": timeout}
        return self._req("POST", f"/channels/{urllib.parse.quote(id_canal)}", params,
                         {"variables": variaveis or {}})

    def continuar(self, canal, contexto, extensao="s", prioridade=1):
        self._req("POST", f"/channels/{canal}/continue",
                  {"context": contexto, "extension": extensao, "priority": prioridade})

    def definir_variavel(self, canal, nome, valor):
        self._req("POST", f"/channels/{canal}/variable", {"variable": nome, "value": valor})

    def desligar(self, canal, motivo="normal"):
        try:
            self._req("DELETE", f"/channels/{canal}", {"reason": motivo})
        except ErroARI as ex:
            if ex.status != 404:      # já desligou
                raise

    def criar_ponte(self, id_ponte):
        self._req("POST", f"/bridges/{id_ponte}", {"type": "mixing"})

    def adicionar_na_ponte(self, ponte, canais):
        self._req("POST", f"/bridges/{ponte}/addChannel", {"channel": ",".join(canais)})

    def remover_da_ponte(self, ponte, canais):
        self._req("POST", f"/bridges/{ponte}/removeChannel", {"channel": ",".join(canais)})

    def destruir_ponte(self, ponte):
        try:
            self._req("DELETE", f"/bridges/{ponte}")
        except ErroARI as ex:
            if ex.status != 404:
                raise

    def tocar(self, canal, midia, id_playback):
        self._req("POST", f"/channels/{canal}/play/{id_playback}", {"media": midia})

    def midia_externa(self, id_canal, app, host_porta, formato="slin16"):
        return self._req("POST", "/channels/externalMedia",
                         {"channelId": id_canal, "app": app, "external_host": host_porta, "format": formato,
                          "encapsulation": "rtp", "transport": "udp", "direction": "both"})

    def recarregar_modulo(self, modulo):
        self._req("PUT", f"/asterisk/modules/{modulo}")

    def eventos(self, app):
        import websocket   # websocket-client (voz/requirements.txt)
        url = self.base.replace("http", "ws", 1) + "/ari/events?" + urllib.parse.urlencode({"app": app})
        ws = websocket.create_connection(url, header=[f"Authorization: {self._auth}"], timeout=None,
                                         suppress_origin=True)
        try:
            while True:
                msg = ws.recv()
                if msg:
                    yield json.loads(msg)
        finally:
            ws.close()


class AriFalso(ClienteARI):
    """ARI de mentira: guarda os comandos em `comandos` e devolve o que um Asterisk devolveria. Os testes
    injetam os eventos direto no orquestrador. `falhar_originar` = conjunto de endpoints que dão erro 500."""

    def __init__(self):
        self.comandos: list[tuple] = []
        self.variaveis: dict[tuple[str, str], str] = {}
        self.pontes: dict[str, set] = {}
        self.desligados: list[str] = []
        self.falhar_originar: set[str] = set()

    def _anota(self, *cmd):
        self.comandos.append(cmd)

    def de(self, metodo: str) -> list[tuple]:
        return [c for c in self.comandos if c[0] == metodo]

    def originar(self, endpoint, id_canal, app, app_args, variaveis=None, callerid=None, timeout=40):
        self._anota("originar", endpoint, id_canal, tuple(app_args), dict(variaveis or {}), callerid, timeout)
        if endpoint in self.falhar_originar:
            raise ErroARI("POST channels -> 500", 500)
        return {"id": id_canal, "state": "Down"}

    def continuar(self, canal, contexto, extensao="s", prioridade=1):
        self._anota("continuar", canal, contexto, extensao, prioridade)

    def definir_variavel(self, canal, nome, valor):
        self._anota("variavel", canal, nome, valor)
        self.variaveis[(canal, nome)] = valor

    def desligar(self, canal, motivo="normal"):
        self._anota("desligar", canal, motivo)
        self.desligados.append(canal)

    def criar_ponte(self, id_ponte):
        self._anota("criar_ponte", id_ponte)
        self.pontes[id_ponte] = set()

    def adicionar_na_ponte(self, ponte, canais):
        self._anota("adicionar_na_ponte", ponte, tuple(canais))
        self.pontes.setdefault(ponte, set()).update(canais)

    def remover_da_ponte(self, ponte, canais):
        self._anota("remover_da_ponte", ponte, tuple(canais))
        self.pontes.get(ponte, set()).difference_update(canais)

    def destruir_ponte(self, ponte):
        self._anota("destruir_ponte", ponte)
        self.pontes.pop(ponte, None)

    def tocar(self, canal, midia, id_playback):
        self._anota("tocar", canal, midia, id_playback)

    def midia_externa(self, id_canal, app, host_porta, formato="slin16"):
        self._anota("midia_externa", id_canal, app, host_porta, formato)
        return {"id": id_canal}

    def recarregar_modulo(self, modulo):
        self._anota("recarregar", modulo)

    def eventos(self, app):
        return iter(())


class AriSimulado(AriFalso):
    """Modo 'simulado' do voz_config (nenhuma ligação de verdade): responde aos comandos com os eventos que o
    Asterisk mandaria, pelo último dígito do número, para a empresa ver o caminho inteiro sem telefonia.
      9 não atende (Q.850 19) · 5 ocupado (17/486) · 4 inexistente (1/404) · 6 máquina · demais: pessoa."""

    def __init__(self):
        super().__init__()
        import queue as _q
        self.fila = _q.Queue()
        self._numero: dict[str, str] = {}

    def _ev(self, tipo, canal, **kw):
        self.fila.put({"type": tipo, "channel": {"id": canal}, **kw})

    def originar(self, endpoint, id_canal, app, app_args, variaveis=None, callerid=None, timeout=40):
        r = super().originar(endpoint, id_canal, app, app_args, variaveis, callerid, timeout)
        etapa = app_args[0] if app_args else ""
        if etapa != "saida":
            self._ev("StasisStart", id_canal, args=list(app_args))
            return r
        final = endpoint.split("@")[0][-1:]
        self._numero[id_canal] = final
        if final == "9":
            self._ev("ChannelDestroyed", id_canal, cause=19)
        elif final == "5":
            self._ev("ChannelDestroyed", id_canal, cause=17, tech_cause=486)
        elif final == "4":
            self._ev("ChannelDestroyed", id_canal, cause=1, tech_cause=404)
        else:
            self._ev("StasisStart", id_canal, args=list(app_args))
        return r

    def continuar(self, canal, contexto, extensao="s", prioridade=1):
        super().continuar(canal, contexto, extensao, prioridade)
        if contexto == "motorcx-atendeu":
            maq = self._numero.get(canal) == "6"
            self._ev("StasisStart", canal, args=["amd", "MACHINE" if maq else "HUMAN", "", ""])
        elif contexto == "motorcx-transferir":
            self._ev("StasisStart", canal, args=["transferencia", "SUCCESS", "202"])

    def desligar(self, canal, motivo="normal"):
        super().desligar(canal, motivo)
        self._ev("ChannelDestroyed", canal, cause=16)

    def eventos(self, app):
        while True:
            yield self.fila.get()
