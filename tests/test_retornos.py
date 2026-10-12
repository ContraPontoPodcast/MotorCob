"""Fornecedores reais: envio aguardando retorno, avisos de entrega/falha/resposta/bounce aplicados pelo motor e os
adaptadores (corpo, cabeçalhos e leitura da resposta) sem rede."""
import io
import json
import os
import unittest
import urllib.error
from datetime import datetime, timedelta
from unittest import mock

from nuvem import fornecedores as F
from nuvem import mensageria as M
from nuvem import retornos as R
from tests import test_mensageria as TM
from tests.test_mensageria import DIA, SP, SbFalso


class SbEventos(SbFalso):
    def _passa(self, l, filtros):
        resto = {}
        for k, cond in (filtros or {}).items():
            if cond == "is.null":
                if l.get(k) is not None:
                    return False
            else:
                resto[k] = cond
        return super()._passa(l, resto)


class Assincrono:
    """Fornecedor real de mentira: aceita e devolve só o id (o resultado chega depois)."""
    n = 0

    def enviar(self, canal, destino, texto, assunto=None, conteudo=None):
        Assincrono.n += 1
        if canal == "email":
            return M.Resultado("entregue", None, f"lw-{Assincrono.n}")
        return M.Resultado("enviada", "aguardando retorno da operadora", f"zv-{Assincrono.n}", enviado=False)


class TestRetornos(unittest.TestCase):
    setUp, tearDown = TM.TestMensageria.setUp, TM.TestMensageria.tearDown
    _criar, _processar = TM.TestMensageria._criar, TM.TestMensageria._processar
    _lote, _msgs = TM.TestMensageria._lote, TM.TestMensageria._msgs

    def _enviar(self):
        velho = self.sb.t
        self.sb = SbEventos()
        self.sb.t = velho
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "real", "aprovar_lotes": False, "radar": False}]
        self.sb.t["mensageria_eventos"] = []
        with mock.patch.dict(M.ADAPTADORES_REAIS, {"zenvia": Assincrono, "infobip": Assincrono, "locaweb": Assincrono}):
            self._criar()
            self._processar()

    def _aplicar(self, minutos=1):
        agora = datetime(DIA.year, DIA.month, DIA.day, 10, minutos, tzinfo=SP)
        with mock.patch("nuvem.sincronizar.credores", lambda sb, dados, emp: [{"id": None, "pasta": self.pasta}]):
            return R.processar_retornos(self.sb, self.dados, agora, out=lambda *a: None)

    def _evento(self, **kw):
        ev = {"id": len(self.sb.t["mensageria_eventos"]) + 1, "fornecedor": "zenvia", "evento_id": None,
              "recebido_em": datetime(DIA.year, DIA.month, DIA.day, 10, 0, tzinfo=SP).isoformat(),
              "processado_em": None, "ocorrido_em": None, **kw}
        self.sb.t["mensageria_eventos"].append(ev)
        return ev

    def test_sms_fica_aguardando_e_o_aviso_fecha_o_funil(self):
        self._enviar()
        lote = self._lote("sms")
        msgs = [m for m in self._msgs("sms") if m["situacao"] == "enviada"]
        self.assertTrue(msgs)
        self.assertEqual((lote["enviadas"], lote["sem_retorno"]), (0, len(msgs)))     # disparado, sem confirmação
        a, b, c = msgs[0], msgs[1], msgs[2]
        self._evento(evento_id="1", id_externo=a["id_externo"], tipo="enviado", fornecedor=a["fornecedor"])
        self._evento(evento_id="2", id_externo=a["id_externo"], tipo="entregue", fornecedor=a["fornecedor"])
        self._evento(evento_id="3", id_externo=b["id_externo"], tipo="falhou", motivo="número inexistente", fornecedor=b["fornecedor"])
        self._evento(evento_id="4", id_externo=c["id_externo"], tipo="entregue", fornecedor=c["fornecedor"])
        self._evento(evento_id="5", id_externo="zv-nao-existe", tipo="entregue")
        r = self._aplicar()
        self.assertEqual(r, {"aplicados": 4, "aguardando": 1, "descartados": 0})
        lote = self._lote("sms")
        self.assertEqual((lote["enviadas"], lote["entregues"], lote["falhas"], lote["sem_retorno"]),
                         (2, 2, 1, len(msgs) - 3))
        por_id = {m["id"]: m for m in self._msgs("sms")}
        self.assertEqual(por_id[b["id"]]["situacao"], "falhou")
        self.assertEqual(por_id[b["id"]]["motivo"], "número inexistente")
        self.assertTrue(por_id[a["id"]]["confirmada_em"])
        retorno = (self.pasta / "canais_mensageria" / "sms" / f"{DIA.isoformat()}_lote{lote['id']}.csv").read_text()
        self.assertIn(";entregue;", retorno)
        self.assertIn(";inexistente;", retorno)
        # o aviso repetido não conta duas vezes; o órfão é descartado depois de 1 hora
        self._evento(evento_id="6", id_externo=a["id_externo"], tipo="entregue", fornecedor=a["fornecedor"])
        self.assertEqual(self._aplicar(minutos=59), {"aplicados": 1, "aguardando": 1, "descartados": 0})
        self.assertEqual(self._lote("sms")["entregues"], 2)
        r = R.processar_retornos(self.sb, self.dados, datetime(DIA.year, DIA.month, DIA.day, 11, 30, tzinfo=SP), out=lambda *a: None)
        self.assertEqual(r["descartados"], 1)
        self.assertFalse([e for e in self.sb.t["mensageria_eventos"] if e["processado_em"] is None])

    def test_resposta_casa_pelo_hash_cobra_e_sair_descadastra(self):
        self._enviar()
        m1, m2 = self._msgs("sms")[0], self._msgs("sms")[1]
        n1 = next(f for f in self.fones if M.hash_destino("sms", f) == m1["destino_hash"])
        self._evento(tipo="resposta", de_hash=M.hash_destino("sms", "55" + n1), texto="Qual o valor pra quitar?")
        self._evento(tipo="resposta", de_hash=m2["destino_hash"], texto="SAIR")
        self._evento(tipo="resposta", de_hash="0" * 64, texto="quem é?")
        r = self._aplicar()
        self.assertEqual(r["aplicados"], 2)
        self.assertEqual(r["descartados"], 1)
        lote = self._lote("sms")
        self.assertEqual((lote["respostas"], lote["descadastros"]), (2, 1))
        self.assertTrue(any(d["destino_hash"] == m2["destino_hash"] and d.get("origem") == "resposta"
                            for d in self.sb.t["mensageria_descadastros"]))
        c = {x["item"]: x["quantidade"] for x in self.sb.t["consumo_mensageria"]}
        self.assertEqual(c["sms_resposta"], 2)

    def test_email_bounce_abertura_e_spam(self):
        self.sb.t["mensageria_modelos_email"] = [{"empresa_id": 1, "remetente_nome": "Alfa", "assunto": "Sua conta",
                                                  "corpo": "Temos uma condição para você."}]
        self._enviar()
        e1, e2 = self._msgs("email")
        self.assertEqual(self._lote("email")["entregues"], 2)
        self._evento(fornecedor="locaweb", evento_id="b1", id_externo=e1["id_externo"], tipo="bounce", bounce="permanente",
                     motivo="550 caixa inexistente")
        self._evento(fornecedor="locaweb", evento_id="a2", id_externo=e2["id_externo"], tipo="abertura")
        self._evento(fornecedor="locaweb", evento_id="s2", id_externo=e2["id_externo"], tipo="spam")
        self._aplicar()
        lote = self._lote("email")
        self.assertEqual((lote["entregues"], lote["falhas"], lote["aberturas"], lote["spam"]), (1, 1, 1, 1))
        por_id = {m["id"]: m for m in self._msgs("email")}
        self.assertEqual((por_id[e1["id"]]["situacao"], por_id[e1["id"]]["bounce"]), ("falhou", "permanente"))
        self.assertTrue(any(d.get("origem") == "reclamacao" for d in self.sb.t["mensageria_descadastros"]))

    def test_banco_sem_o_sql_24_nao_faz_nada(self):
        self.sb.t.pop("mensageria_eventos", None)
        with mock.patch.object(R, "banco_eventos", return_value=False):
            self.assertEqual(self._aplicar(), {})


class Resposta(io.BytesIO):
    def __init__(self, corpo, status=200, cab=None):
        super().__init__(json.dumps(corpo).encode())
        self.status, self.headers = status, cab or {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestAdaptadores(unittest.TestCase):
    def _pedido(self, urlopen):
        req = urlopen.call_args[0][0]
        return req, json.loads(req.data.decode())

    def test_sem_credencial_nao_liga(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            a, c = {}, {}
            self.assertEqual(F.registrar(a, c), [])
        with mock.patch.dict(os.environ, {"ZENVIA_TOKEN": "x", "LOCAWEB_TOKEN": "y", "LOCAWEB_FROM": "a@b.com"}, clear=True):
            a, c = {}, {}
            self.assertEqual(F.registrar(a, c), ["zenvia", "locaweb"])
            self.assertIsInstance(a["zenvia"](), F.Zenvia)

    def test_zenvia_sms_e_rcs_card(self):
        env = {"ZENVIA_TOKEN": "tk", "ZENVIA_SMS_FROM": "motorcx", "ZENVIA_RCS_FROM": "agente"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("urllib.request.urlopen", return_value=Resposta({"id": "abc-1"})) as u:
            z = F.Zenvia.criar()
            r = z.enviar("sms", "(11) 98765-4321", "Olá")
            req, corpo = self._pedido(u)
            self.assertEqual(req.full_url, "https://api.zenvia.com/v2/channels/sms/messages")
            self.assertEqual(req.get_header("X-api-token"), "tk")
            self.assertEqual(corpo, {"from": "motorcx", "to": "5511987654321", "contents": [{"type": "text", "text": "Olá"}]})
            self.assertEqual((r.situacao, r.id_externo, r.enviado), ("enviada", "abc-1", False))
            z.enviar("rcs", "11987654321", "x", conteudo={"card": {"titulo": "Oferta", "descricao": "Desconto",
                     "midia": "https://cdn.exemplo.com/a.png", "botoes": [{"tipo": "url", "rotulo": "Ver", "valor": "https://x.com"}]}})
            req, corpo = self._pedido(u)
            self.assertTrue(req.full_url.endswith("/channels/rcs/messages"))
            card = corpo["contents"][0]
            self.assertEqual((card["type"], card["title"], card["media"]["url"]), ("card", "Oferta", "https://cdn.exemplo.com/a.png"))
            self.assertEqual(card["buttons"], [{"type": "link", "text": "Ver", "url": "https://x.com"}])

    def test_infobip_sms_com_retorno_e_consulta_de_operadora(self):
        env = {"INFOBIP_BASE_URL": "https://abc.api.infobip.com", "INFOBIP_API_KEY": "k", "INFOBIP_SMS_FROM": "MotorCX",
               "RETORNO_URL": "https://p.supabase.co/functions/v1/retorno-mensageria", "RETORNO_TOKEN": "s3"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("urllib.request.urlopen", return_value=Resposta({"messages": [{"messageId": "ib-9"}]})) as u:
            i = F.Infobip.criar()
            r = i.enviar("sms", "11987654321", "Oi")
            req, corpo = self._pedido(u)
            self.assertEqual(req.full_url, "https://abc.api.infobip.com/sms/3/messages")
            self.assertEqual(req.get_header("Authorization"), "App k")
            m = corpo["messages"][0]
            self.assertEqual(m["destinations"], [{"to": "5511987654321"}])
            self.assertEqual(m["webhooks"]["delivery"]["url"], "https://p.supabase.co/functions/v1/retorno-mensageria/infobip?t=s3")
            self.assertEqual(r.id_externo, "ib-9")
        with mock.patch.dict(os.environ, env, clear=True), mock.patch("urllib.request.urlopen", return_value=Resposta(
                {"results": [{"originalNetwork": {"networkName": "TIM Brasil"}, "portedNetwork": {"networkName": "Claro BR"}}]})):
            self.assertEqual(F.Infobip.criar().operadora("11987654321"), "claro")
        self.assertEqual(F.operadora_pelo_nome("Telefonica Brasil (Vivo)"), "vivo")
        self.assertEqual(F.operadora_pelo_nome("Algar"), "outras")

    def test_sinch_e_locaweb(self):
        env = {"SINCH_SERVICE_PLAN_ID": "sp1", "SINCH_API_TOKEN": "t", "SINCH_FROM": "29090", "LOCAWEB_TOKEN": "lw",
               "LOCAWEB_FROM": "avisos@motorcx.com.br"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("urllib.request.urlopen", side_effect=lambda *a, **k: Resposta({"id": "batch-1"}, 201)) as u:
            F.Sinch.criar().enviar("sms", "11987654321", "Oi")
            req, corpo = self._pedido(u)
            self.assertEqual(req.full_url, "https://br.sms.api.sinch.com/xms/v1/sp1/batches")
            self.assertEqual(corpo["to"], ["+5511987654321"])
            r = F.Locaweb.criar().enviar("email", "ana@exemplo.com", "Linha 1\n<b>2</b>", "Condição especial")
            req, corpo = self._pedido(u)
            self.assertEqual(req.get_header("X-auth-token"), "lw")
            self.assertTrue(corpo["subject"].startswith("=?UTF-8?B?"))
            self.assertEqual(corpo["body"], "Linha 1<br>&lt;b&gt;2&lt;/b&gt;")
            self.assertEqual((r.situacao, r.id_externo), ("entregue", "batch-1"))

    def test_zenvia_cadastra_o_retorno_uma_vez(self):
        env = {"ZENVIA_TOKEN": "tk", "ZENVIA_SMS_FROM": "motorcx", "RETORNO_URL": "https://p.supabase.co/functions/v1/retorno-mensageria",
               "RETORNO_TOKEN": "s3"}
        url = "https://p.supabase.co/functions/v1/retorno-mensageria/zenvia?t=s3"
        ja = [{"eventType": "MESSAGE_STATUS", "webhook": {"url": url}, "criteria": {"channel": "sms"}}]
        respostas = [Resposta(ja), Resposta({"id": "sub-2"}, 201)]
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("urllib.request.urlopen", side_effect=lambda *a, **k: respostas.pop(0)) as u:
            feitas = F.Zenvia.criar().assinar()
        self.assertEqual(feitas, ["MESSAGE sms: ok"])                 # só a de respostas faltava; RCS sem remetente
        _, corpo = self._pedido(u)
        self.assertEqual(corpo, {"eventType": "MESSAGE", "webhook": {"url": url}, "criteria": {"channel": "sms", "direction": "IN"}})

    def test_erros_viram_reserva_ou_falha(self):
        env = {"ZENVIA_TOKEN": "tk", "ZENVIA_SMS_FROM": "motorcx"}

        def erro(codigo):
            return urllib.error.HTTPError("u", codigo, "x", {}, io.BytesIO(b'{"message":"numero invalido"}'))
        with mock.patch.dict(os.environ, env, clear=True):
            z = F.Zenvia.criar()
            for codigo in (401, 429, 503):
                with mock.patch("urllib.request.urlopen", side_effect=erro(codigo)), self.assertRaises(M.ErroFornecedor):
                    z.enviar("sms", "11987654321", "x")
            with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("dns")), self.assertRaises(M.ErroFornecedor):
                z.enviar("sms", "11987654321", "x")
            with mock.patch("urllib.request.urlopen", side_effect=erro(400)):
                r = z.enviar("sms", "11987654321", "x")
            self.assertEqual((r.situacao, r.enviado), ("falhou", False))
            self.assertIn("numero invalido", r.motivo)
            with self.assertRaises(M.ErroFornecedor):
                z.enviar("rcs", "11987654321", "x")             # sem remetente de RCS


if __name__ == "__main__":
    unittest.main()
