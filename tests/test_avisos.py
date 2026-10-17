"""Sino de avisos (SQL 34): o que o motor grava e como se comporta com o banco antigo."""
import unittest
from datetime import datetime, timezone

from nuvem import avisos as AV
from nuvem.supabase_api import ErroSupabase


class SbFalso:
    def __init__(self, erro=None):
        self.linhas, self.apagados, self.erro, self.rpcs = [], [], erro, {}

    def inserir(self, tabela, linha, **_):
        if self.erro:
            raise ErroSupabase(self.erro, "erro", tabela)
        self.linhas.append((tabela, linha))

    def apagar(self, tabela, filtros):
        self.apagados.append((tabela, filtros))

    def rpc(self, funcao, args=None):
        r = self.rpcs[funcao]
        if isinstance(r, Exception):
            raise r
        return r


class TestAvisos(unittest.TestCase):
    def test_aviso_para_pessoa(self):
        sb = SbFalso()
        self.assertTrue(AV.criar(sb, "usuario", " Prévia pronta · Outubro ", "17.904 números", empresa_id=1,
                                 usuario_id="u1", link="/mensageria/campanhas/3", chave="previa:3"))
        tabela, l = sb.linhas[0]
        self.assertEqual(tabela, "avisos")
        self.assertEqual(l, {"para": "usuario", "tipo": "pronto", "titulo": "Prévia pronta · Outubro",
                             "texto": "17.904 números", "empresa_id": 1, "usuario_id": "u1",
                             "link": "/mensageria/campanhas/3", "chave": "previa:3"})

    def test_sem_a_pessoa_vai_para_a_empresa(self):
        sb = SbFalso()
        AV.criar(sb, "usuario", "Lista lida", empresa_id=1, usuario_id=None)
        self.assertEqual(sb.linhas[0][1]["para"], "empresa")
        self.assertNotIn("usuario_id", sb.linhas[0][1])

    def test_textos_longos_sao_cortados(self):
        sb = SbFalso()
        AV.criar(sb, "equipe", "x" * 300, "y" * 900)
        l = sb.linhas[0][1]
        self.assertEqual((len(l["titulo"]), len(l["texto"])), (140, 400))

    def test_destino_ou_tipo_invalido(self):
        with self.assertRaises(ValueError):
            AV.criar(SbFalso(), "todos", "Teste")
        with self.assertRaises(ValueError):
            AV.criar(SbFalso(), "equipe", "Teste", tipo="urgente")

    def test_mesma_chave_ou_banco_antigo_nao_derrubam(self):
        for status in (400, 404, 409):
            self.assertFalse(AV.criar(SbFalso(erro=status), "equipe", "Teste", chave="k"))
        with self.assertRaises(ErroSupabase):
            AV.criar(SbFalso(erro=500), "equipe", "Teste")

    def test_aviso_de_campanha(self):
        sb = SbFalso()
        AV.para_campanha(sb, {"id": 7, "empresa_id": 2, "canal": "rcs", "criado_por": "u9"}, "Prévia pronta · X", tipo="pronto")
        l = sb.linhas[0][1]
        self.assertEqual((l["para"], l["usuario_id"], l["empresa_id"], l["link"]),
                         ("usuario", "u9", 2, "/mensageria/rcs/campanhas?id=7"))

    def test_qualidade(self):
        sb = SbFalso()
        sb.rpcs["gerar_avisos_qualidade"] = 2
        saida = []
        self.assertEqual(AV.qualidade(sb, out=saida.append), 2)
        self.assertIn("2 alerta(s)", saida[0])
        sb.rpcs["gerar_avisos_qualidade"] = ErroSupabase(404, "sem a função", "rpc")
        self.assertEqual(AV.qualidade(sb, out=saida.append), 0)

    def test_implantacao(self):
        sb = SbFalso()
        sb.rpcs["gerar_avisos_implantacao"] = 1
        saida = []
        self.assertEqual(AV.implantacao(sb, out=saida.append), 1)
        self.assertIn("1 aviso(s)", saida[0])
        sb.rpcs["gerar_avisos_implantacao"] = ErroSupabase(404, "sem a função", "rpc")
        self.assertEqual(AV.implantacao(sb, out=saida.append), 0)

    def test_atendimento(self):
        sb = SbFalso()
        sb.rpcs["gerar_avisos_atendimento"] = 3
        saida = []
        self.assertEqual(AV.atendimento(sb, out=saida.append), 3)
        self.assertIn("3 aviso(s)", saida[0])
        sb.rpcs["gerar_avisos_atendimento"] = ErroSupabase(404, "sem a função", "rpc")
        self.assertEqual(AV.atendimento(sb, out=saida.append), 0)

    def test_limpar_apaga_mais_de_90_dias(self):
        sb = SbFalso()
        chamadas = []
        sb.rpcs["limpar_atendimento_90d"] = None
        sb.rpc = lambda f, a=None: chamadas.append(f)
        AV.limpar(sb, datetime(2026, 12, 31, 12, tzinfo=timezone.utc))
        self.assertEqual(sb.apagados, [("avisos", {"criado_em": "lt.2026-10-02T12:00:00+00:00"})])
        self.assertEqual(chamadas, ["limpar_atendimento_90d", "limpar_registros_api"])

    def test_avisos_dos_tokens_de_api(self):
        sb = SbFalso()
        sb.rpc = lambda f, a=None: 2 if f == "gerar_avisos_api" else None
        saida = []
        self.assertEqual(AV.api(sb, out=saida.append), 2)
        self.assertTrue(any("2 aviso(s) de token" in x for x in saida))

        def velho(f, a=None):
            raise RuntimeError("404")
        sb.rpc = velho
        self.assertEqual(AV.api(sb, out=saida.append), 0)


    def test_chamados_parados(self):
        sb = SbFalso()
        sb.rpc = lambda f, a=None: {"avisados": 1, "fechados": 2} if f == "fechar_chamados_parados" else None
        saida = []
        self.assertEqual(AV.chamados_parados(sb, out=saida.append), {"avisados": 1, "fechados": 2})
        self.assertEqual(saida, ["suporte: 1 chamado(s) avisado(s), 2 fechado(s) sem resposta"])
        sb.rpc = lambda f, a=None: {"avisados": 0, "fechados": 0}
        AV.chamados_parados(sb, out=saida.append)
        self.assertEqual(len(saida), 1)                  # nada a contar: nada no log

        def velho(f, a=None):
            raise RuntimeError("404")
        sb.rpc = velho
        self.assertEqual(AV.chamados_parados(sb, out=saida.append), {})

if __name__ == "__main__":
    unittest.main()
