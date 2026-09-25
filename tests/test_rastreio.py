"""Testes do link rastreável e da atribuição pelo portal. Rodar: python -m unittest"""
import tempfile
import unittest
from datetime import date
from pathlib import Path

from motor.certificacao import certificar_contatos
from motor.rastreio import (atribuicao_por_canal, carregar_acoes, gerar_token, ler_log_portal,
                            preparar_disparo, salvar_acoes)

RAIZ = Path(__file__).resolve().parent.parent
HOJE = date(2026, 9, 25)
SEG = "segredo-teste"
PLANO = [
    {"ordem": 1, "id_cliente": "C1", "contato": "11999990000", "tipo": "telefone", "canal": "sms"},
    {"ordem": 2, "id_cliente": "C1", "contato": "11999990000", "tipo": "telefone", "canal": "whatsapp"},
    {"ordem": 3, "id_cliente": "C1", "contato": "11999990000", "tipo": "telefone", "canal": "discador"},
    {"ordem": 1, "id_cliente": "C2", "contato": "c2@exemplo.com", "tipo": "email", "canal": "email"},
]


class TestToken(unittest.TestCase):
    def test_deterministico_e_distinto_por_acao(self):
        t = gerar_token(SEG, "CAMP", "C1", "11999990000", "sms")
        self.assertEqual(t, gerar_token(SEG, "CAMP", "C1", "11999990000", "sms"))
        self.assertNotEqual(t, gerar_token(SEG, "CAMP", "C1", "11999990000", "whatsapp"))
        self.assertNotEqual(t, gerar_token("outro", "CAMP", "C1", "11999990000", "sms"))
        self.assertEqual(len(t), 16)

    def test_exige_segredo(self):
        with self.assertRaises(ValueError):
            gerar_token("", "CAMP", "C1", "x", "sms")

    def test_link_nao_carrega_dado_pessoal(self):
        for a in preparar_disparo(PLANO, "CAMP", "M1", "https://p.ex/r/", SEG, HOJE, ordem=None):
            self.assertNotIn(a.contato, a.link)
            self.assertNotIn(a.id_cliente, a.link)


class TestDisparo(unittest.TestCase):
    def test_ordem_e_voz_sem_link(self):
        so_primeira = preparar_disparo(PLANO, "CAMP", "M1", "https://p.ex/r", SEG, HOJE)
        self.assertEqual({(a.id_cliente, a.canal) for a in so_primeira}, {("C1", "sms"), ("C2", "email")})
        todas = preparar_disparo(PLANO, "CAMP", "M1", "https://p.ex/r", SEG, HOJE, ordem=None)
        voz = [a for a in todas if a.canal == "discador"][0]
        self.assertEqual(voz.link, "")
        self.assertTrue([a for a in todas if a.canal == "sms"][0].link.startswith("https://p.ex/r/"))

    def test_registro_nao_duplica_ao_regravar(self):
        acoes = preparar_disparo(PLANO, "CAMP", "M1", "https://p.ex/r", SEG, HOJE, ordem=None)
        with tempfile.TemporaryDirectory() as tmp:
            reg = Path(tmp) / "acoes.csv"
            salvar_acoes(reg, acoes)
            salvar_acoes(reg, acoes)
            self.assertEqual(len(carregar_acoes(reg)), len(acoes))


class TestPortal(unittest.TestCase):
    def setUp(self):
        self.acoes = {a.token: a for a in preparar_disparo(PLANO, "CAMP", "M1", "https://p.ex/r", SEG, HOJE, ordem=None)}
        self.tok = {a.canal: t for t, a in self.acoes.items()}
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def log(self, linhas):
        p = Path(self.tmp.name) / "portal.csv"
        p.write_text("token;evento;ocorrido_em;valor_acordo\n" + "\n".join(linhas) + "\n", encoding="utf-8")
        return ler_log_portal(p, self.acoes)

    def test_login_certifica_o_contato_do_link(self):
        eventos, _, _ = self.log([f"{self.tok['sms']};login;2026-09-20T10:00:00;"])
        c = certificar_contatos(eventos, HOJE)[("C1", "11999990000")]
        self.assertEqual(c.status, "CERTIFICADO")
        self.assertEqual(eventos[0].canal, "sms")

    def test_clique_nao_certifica(self):
        eventos, _, _ = self.log([f"{self.tok['whatsapp']};clique;2026-09-20T10:00:00;"])
        self.assertNotEqual(certificar_contatos(eventos, HOJE)[("C1", "11999990000")].status, "CERTIFICADO")

    def test_token_desconhecido_e_evento_em_canal_de_voz_sao_descartados(self):
        eventos, _, rel = self.log(["naoexiste;login;2026-09-20T10:00:00;",
                                    f"{self.tok['discador']};login;2026-09-20T10:00:00;"])
        self.assertEqual(eventos, [])
        self.assertEqual((rel["token desconhecido"], rel["evento inválido"]), (1, 1))

    def test_acordo_vira_conversao_atribuida_e_acesso_repetido_conta_uma_vez(self):
        t = self.tok["email"]
        eventos, conv, _ = self.log([f"{t};clique;2026-09-20T10:00:00;", f"{t};clique;2026-09-21T10:00:00;",
                                     f"{t};login;2026-09-21T10:01:00;", f"{t};acordo;2026-09-21T10:05:00;1234,50"])
        self.assertEqual((conv[0].canal, conv[0].id_cliente, conv[0].valor_acordo), ("email", "C2", 1234.5))
        r = atribuicao_por_canal(self.acoes, eventos, conv)["email"]
        self.assertEqual((r["cliques"], r["logins"], r["acordos"]), (1, 1, 1))


class TestPontaAPonta(unittest.TestCase):
    def test_campanha_pulverizada_so_certifica_quem_e_do_cliente(self):
        import rodar
        from exemplos import gerar_retornos
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            _, contatos = gerar_retornos.main(seed=11, pasta=tmp, verbose=False)
            r = rodar.rodar(tmp / "retornos", tmp / "carteira_contatos.csv", RAIZ / "layouts", HOJE,
                            tmp / "saida", acoes=tmp / "acoes.csv", portal=tmp / "portal" / "acessos_2026-09.csv",
                            out=lambda *a: None)
        verdade = {(c["id_cliente"], c["contato"]): c["titular"] for c in contatos}
        via_portal = {(e.id_cliente, e.contato) for e in r["eventos_portal"]
                      if e.resultado == "acesso_portal_autenticado"}
        self.assertTrue(via_portal)
        for k in via_portal:
            self.assertEqual(r["certs"][k].status, "CERTIFICADO")
            self.assertTrue(verdade[k])
        self.assertTrue(r["conversoes"])


if __name__ == "__main__":
    unittest.main()
