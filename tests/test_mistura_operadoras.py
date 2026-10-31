"""Mistura de operadoras pelos dados abertos da Anatel: leitura, conta, travas, calendário e falhas (sem rede)."""
import io
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest import mock

from nuvem import mistura_operadoras as MO

FIXTURE = Path(__file__).parent / "dados" / "anatel_acessos_movel_colunas.csv"
TELECO = "Teleco (dados Anatel) · agosto/2026 · celulares"


def linhas():
    return FIXTURE.read_text(encoding="utf-8-sig").splitlines()


def mistura(vivo=37.8, claro=33.0, tim=22.0, outras=7.2, fonte=TELECO, por=None, em="2026-09-01T00:00:00+00:00"):
    return [{"operadora": o, "percentual": v, "fonte": fonte, "atualizado_por": por, "atualizado_em": em}
            for o, v in (("vivo", vivo), ("claro", claro), ("tim", tim), ("outras", outras))]


class SbFalso:
    def __init__(self, linhas_mistura=None):
        self.mistura = linhas_mistura if linhas_mistura is not None else mistura()
        self.gravado, self.avisos = [], []

    def selecionar(self, tabela, *a, **k):
        assert tabela == "mensageria_mistura_operadoras"
        return self.mistura

    def inserir(self, tabela, linhas, conflito=None, **_):
        if tabela == "avisos":
            if any(a["chave"] == linhas["chave"] for a in self.avisos):
                from nuvem.supabase_api import ErroSupabase
                raise ErroSupabase(409, "duplicada", tabela)
            self.avisos.append(linhas)
            return
        assert tabela == "mensageria_mistura_operadoras" and conflito == "operadora"
        self.gravado.append(linhas)


def buscar_fixture(mes_atual=None):
    return MO.contar(linhas(), mes_atual)


class TestLeitura(unittest.TestCase):
    def test_conta_celulares_por_grupo_e_agrupa_outras(self):
        mes, acessos = MO.contar(linhas())
        self.assertEqual(mes, "2026-09")
        # M2M e PONTO_DE_SERVICO ficam fora; Surf e Telecall (OUTROS) viram "outras"
        self.assertEqual(acessos, {"vivo": 41_000_000, "claro": 36_000_000, "tim": 22_000_000, "outras": 2_000_000})

    def test_participacao_soma_exatamente_100(self):
        p = MO.participacao({"vivo": 41_000_000, "claro": 36_000_000, "tim": 22_000_000, "outras": 2_000_000})
        self.assertEqual(p, {"vivo": 40.60, "claro": 35.64, "tim": 21.78, "outras": 1.98})
        self.assertAlmostEqual(sum(p.values()), 100, places=6)

    def test_operadora_pelo_grupo_ou_pela_empresa(self):
        self.assertEqual(MO.operadora("TELEFÔNICA"), "vivo")
        self.assertEqual(MO.operadora("Telecom Americas"), "claro")
        self.assertEqual(MO.operadora("", "TIM"), "tim")
        self.assertEqual(MO.operadora("BRISANET", "BRISANET"), "outras")

    def test_mes_recem_aberto_fica_fora(self):
        texto = [l.rsplit(";", 1)[0] + (";10" if i else ";2026-09") for i, l in enumerate(linhas())]
        self.assertEqual(MO.contar(texto)[0], "2026-08")

    def test_para_cedo_sem_mes_novo(self):
        self.assertIsNone(MO.contar(linhas(), "2026-09"))
        self.assertEqual(MO.contar(linhas(), "2026-08")[0], "2026-09")

    def test_formato_mudou(self):
        with self.assertRaises(MO.ErroFonte):
            MO.contar(["Ano;Mês;Acessos", "2026;9;1"])

    def test_fonte_ida_e_volta(self):
        self.assertEqual(MO.fonte("2026-09"), "Anatel (dados abertos) · setembro/2026 · celulares")
        self.assertEqual(MO.mes_da_fonte(MO.fonte("2026-03")), "2026-03")
        self.assertIsNone(MO.mes_da_fonte(TELECO))
        self.assertEqual(MO.mes_esperado(date(2027, 1, 5)), "2026-11")


class TestZip(unittest.TestCase):
    """O caminho do download real, servido de um zip em memória por intervalo de bytes."""

    def setUp(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("Acessos_Telefonia_Movel_Total.csv", "Ano;Mês;Acessos\n2026;9;1\n")
            z.writestr("Acessos_Telefonia_Movel_2026_1S_Colunas.csv", "lixo")
            z.writestr("Acessos_Telefonia_Movel_2026_2S_Colunas.csv", FIXTURE.read_bytes())
            z.writestr("Acessos_Telefonia_Movel_2026_2S.csv", "não é este")
        self.zip = buf.getvalue()

    def _intervalo(self, url, ini, fim=None, timeout=None):
        n = len(self.zip)
        ini = n + ini if ini < 0 else ini
        corpo = self.zip[ini:(n if fim is None else fim + 1)]
        r = io.BytesIO(corpo)
        r.headers = {"Content-Range": f"bytes {ini}-{ini + len(corpo) - 1}/{n}"}
        return r

    def test_baixa_so_o_membro_do_semestre(self):
        with mock.patch.object(MO, "_intervalo", self._intervalo):
            mes, acessos = MO.baixar("https://exemplo.invalid/a.zip")
        self.assertEqual((mes, acessos["vivo"]), ("2026-09", 41_000_000))

    def test_diretorio_zip64(self):
        """O zip da Anatel (~3,3 GB) vai passar de 4 GiB: tamanhos e deslocamento vêm no extra zip64."""
        import struct
        nome = b"Acessos_Telefonia_Movel_2027_2S_Colunas.csv"
        extra = struct.pack("<HHQQQ", 1, 24, 40_000_000, 3_000_000, 5_000_000_000)
        cd = struct.pack("<IHHHHHHIIIHHHHHII", 0x02014b50, 45, 45, 0, 8, 0, 0, 0, 0xFFFFFFFF, 0xFFFFFFFF, len(nome),
                         len(extra), 0, 0, 0, 0, 0xFFFFFFFF) + nome + extra
        base = 5_100_000_000
        fim = (cd + struct.pack("<IQHHIIQQQQ", 0x06064b50, 44, 45, 45, 0, 0, 1, 1, len(cd), base)
               + struct.pack("<IIQI", 0x07064b50, 0, base + len(cd), 1)
               + struct.pack("<IHHHHIIH", 0x06054b50, 0, 0, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0))
        self.assertEqual(MO.diretorio(fim, base + len(fim)), {nome.decode(): (5_000_000_000, 3_000_000)})

    def test_teto_de_tamanho(self):
        with mock.patch.object(MO, "_intervalo", self._intervalo), mock.patch.object(MO, "TETO_COMPACTADO", 10):
            with self.assertRaises(MO.ErroFonte):
                MO.baixar("https://exemplo.invalid/a.zip")


class TestAtualizar(unittest.TestCase):
    def test_grava_com_a_fonte_da_anatel(self):
        sb = SbFalso()
        r = MO.atualizar(sb, date(2026, 11, 5), buscar_fixture, out=lambda *a: None)
        self.assertEqual(r["status"], "gravada")
        gravadas = {l["operadora"]: l for l in sb.gravado[0]}
        self.assertEqual(set(gravadas), {"vivo", "claro", "tim", "outras"})
        self.assertEqual(gravadas["vivo"]["percentual"], 40.60)
        self.assertEqual(gravadas["tim"]["fonte"], "Anatel (dados abertos) · setembro/2026 · celulares")
        self.assertIsNone(gravadas["claro"]["atualizado_por"])
        self.assertEqual(sb.avisos, [])

    def test_salto_maior_que_10_pontos_recusa_e_avisa_uma_vez(self):
        sb = SbFalso(mistura(vivo=25.0, claro=40.0, tim=25.0, outras=10.0))
        r = MO.atualizar(sb, date(2026, 11, 5), buscar_fixture, out=lambda *a: None)
        self.assertEqual(r["status"], "recusada")
        self.assertIn("vivo pularia de 25.0% para 40.6%", r["problemas"])
        self.assertEqual(sb.gravado, [])
        MO.atualizar(sb, date(2026, 11, 6), buscar_fixture, out=lambda *a: None)      # dia seguinte: mesma chave
        self.assertEqual(len(sb.avisos), 1)
        self.assertEqual((sb.avisos[0]["para"], sb.avisos[0]["tipo"]), ("equipe", "atencao"))
        self.assertEqual(sb.avisos[0]["chave"], "mistura_operadoras:2026-11")

    def test_forcar_grava_mesmo_com_salto(self):
        sb = SbFalso(mistura(vivo=25.0, claro=40.0, tim=25.0, outras=10.0))
        self.assertEqual(MO.atualizar(sb, date(2026, 11, 5), buscar_fixture, forcar=True, out=lambda *a: None)["status"],
                         "gravada")

    def test_total_baixo_demais_recusa(self):
        def pouco(mes_atual=None):
            return "2026-09", {"vivo": 400, "claro": 350, "tim": 200, "outras": 50}
        sb = SbFalso()
        r = MO.atualizar(sb, date(2026, 11, 5), pouco, forcar=True, out=lambda *a: None)
        self.assertEqual(r["status"], "recusada")
        self.assertEqual(sb.gravado, [])

    def test_idempotente_sem_rede_quando_ja_tem_o_mes(self):
        sb = SbFalso(mistura(fonte=MO.fonte("2026-09")))
        nunca = mock.Mock(side_effect=AssertionError("não devia baixar"))
        self.assertEqual(MO.atualizar(sb, date(2026, 11, 20), nunca)["status"], "em_dia")
        self.assertEqual(MO.atualizar(sb, date(2026, 12, 3), nunca)["status"], "fora_do_dia")   # antes do dia 5
        nunca.assert_not_called()
        self.assertEqual(sb.gravado, [])

    def test_anatel_sem_mes_novo_nao_grava(self):
        sb = SbFalso(mistura(fonte=MO.fonte("2026-09")))
        r = MO.atualizar(sb, date(2026, 12, 5), buscar_fixture, out=lambda *a: None)     # espera outubro
        self.assertEqual(r["status"], "sem_mes_novo")
        self.assertEqual((sb.gravado, sb.avisos), ([], []))

    def test_edicao_manual_no_mes_vale_ate_o_proximo(self):
        sb = SbFalso(mistura(fonte="ajuste do Master", por="u-1", em="2026-11-02T13:00:00+00:00"))
        nunca = mock.Mock(side_effect=AssertionError("não devia baixar"))
        self.assertEqual(MO.atualizar(sb, date(2026, 11, 5), nunca)["status"], "manual")
        self.assertEqual(MO.atualizar(sb, date(2026, 12, 5), buscar_fixture, out=lambda *a: None)["status"],
                         "gravada")

    def test_simular_nao_grava_nem_avisa(self):
        sb = SbFalso()
        r = MO.atualizar(sb, date(2026, 11, 1), buscar_fixture, simular=True)
        self.assertEqual(r["status"], "simulada")
        self.assertEqual((sb.gravado, sb.avisos), ([], []))


class TestFalhaNaoParaARotina(unittest.TestCase):
    def test_fonte_fora_do_ar_avisa_e_nao_grava(self):
        def fora(mes_atual=None):
            raise OSError("conexão recusada")
        sb, msgs = SbFalso(), []
        r = MO.rodar(sb, msgs.append, date(2026, 11, 5), fora)
        self.assertEqual(r["status"], "falhou")
        self.assertEqual(sb.gravado, [])
        self.assertEqual(sb.avisos[0]["titulo"], "Mistura de operadoras sem atualização")

    def test_erro_no_banco_nao_levanta(self):
        class SbQuebrado:
            def selecionar(self, *a, **k):
                raise RuntimeError("banco fora")
        r = MO.rodar(SbQuebrado(), lambda *a: None, date(2026, 11, 5), buscar_fixture)
        self.assertEqual(r["status"], "falhou")

    def test_aviso_que_falha_tambem_nao_levanta(self):
        class SbSemSino(SbFalso):
            def inserir(self, tabela, linhas, conflito=None, **_):
                raise RuntimeError("sino fora")
        def fora(mes_atual=None):
            raise MO.ErroFonte("zip mudou")
        self.assertEqual(MO.rodar(SbSemSino(), lambda *a: None, date(2026, 11, 5), fora)["status"], "falhou")


if __name__ == "__main__":
    unittest.main()
