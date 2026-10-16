"""E-mails do sistema (SQL 42): fila de avisos, conferência do domínio e limpeza."""
import unittest

from nuvem import emails as EM


class SbFalso:
    def __init__(self, funcao=None, cfg=None, erro_rpc=None):
        self.chamadas, self.rpcs, self._funcao, self._cfg, self._erro = [], [], funcao, cfg, erro_rpc

    def funcao(self, nome, corpo):
        self.chamadas.append((nome, corpo))
        if isinstance(self._funcao, Exception):
            raise self._funcao
        return self._funcao

    def selecionar(self, tabela, filtros):
        if isinstance(self._cfg, Exception):
            raise self._cfg
        return [self._cfg] if self._cfg else []

    def rpc(self, nome, args=None):
        if self._erro:
            raise self._erro
        self.rpcs.append((nome, args))


DNS = {
    "motorcob.online": ['v=spf1 include:_spf.smtplw.com.br include:locaweb.com.br ~all', "google-site-verification=x"],
    "_dmarc.motorcob.online": ["v=DMARC1; p=quarantine; rua=mailto:dmarc@motorcob.online"],
    "lw._domainkey.motorcob.online": ["v=DKIM1; k=rsa; p=MIGfMA0GCSq"],
}


class TestEmails(unittest.TestCase):
    def test_fila_chama_a_funcao(self):
        sb, msgs = SbFalso({"enviados": 3, "erros": 1}), []
        self.assertEqual(EM.avisos(sb, msgs.append), 3)
        self.assertEqual(sb.chamadas, [("emails", {"acao": "avisos"})])
        self.assertIn("1 não saíram", msgs[0])

    def test_fila_sem_funcao_publicada_nao_derruba(self):
        msgs = []
        self.assertEqual(EM.avisos(SbFalso(RuntimeError("404 function not found")), msgs.append), 0)
        self.assertIn("não rodou", msgs[0])
        self.assertEqual(EM.avisos(SbFalso({"enviados": 0}), msgs.append), 0)
        self.assertEqual(len(msgs), 1)                 # nada enviado: fica quieto

    def test_dominio_completo(self):
        r = EM.conferir_dominio("motorcob.online", "lw", lambda n: DNS.get(n, []))
        self.assertEqual(r, {"spf": "ok", "spf_locaweb": True, "dkim": "ok", "dmarc": "ok", "politica_dmarc": "quarantine"})

    def test_dominio_incompleto(self):
        r = EM.conferir_dominio("exemplo.com", None, lambda n: {"exemplo.com": ["v=spf1 -all", "v=spf1 include:x ~all"]}.get(n, []))
        self.assertEqual((r["spf"], r["dkim"], r["dmarc"], r["politica_dmarc"]), ("duplicado", "sem_seletor", "ausente", None))

    def test_verificar_grava_e_avisa_o_que_falta(self):
        sb, msgs = SbFalso(cfg={"dominio": "motorcob.online", "dkim_seletor": None}), []
        r = EM.verificar(sb, msgs.append, lambda n: DNS.get(n, []))
        self.assertEqual(sb.rpcs[0][0], "registrar_verificacao_email")
        self.assertEqual(sb.rpcs[0][1]["resultado"], r)
        self.assertIn("sem DKIM", msgs[0])

    def test_banco_sem_sql42(self):
        self.assertIsNone(EM.verificar(SbFalso(cfg=RuntimeError("relation does not exist")), print, lambda n: []))
        EM.limpar(SbFalso(erro_rpc=RuntimeError("function does not exist")))


if __name__ == "__main__":
    unittest.main()
