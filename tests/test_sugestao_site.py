"""PR 0 da discagem: a sugestão do site para códigos de ocorrência é sempre uma marca que o banco aceita, recado
não é sugerido como terceiro, e o resumo de discagem tem a forma que a tela Resultado do dia lê."""
import re
import unittest
from pathlib import Path

from motor.detectar import RESULTADOS_SITE, _resultado, sugestao_site
from nuvem import mapeamento

RAIZ = Path(__file__).resolve().parent.parent
SQL = RAIZ / "supabase" / "migrations" / "20261017000001_mapeamento_arquivos.sql"
TELA = RAIZ / "site" / "src" / "components" / "credores" / "configuracoes.tsx"
LIB = RAIZ / "site" / "src" / "lib" / "discagem.ts"


class TestSugestaoSite(unittest.TestCase):
    CODIGOS = ("CPC", "NAO CPC", "PROMESSA DE PAGAMENTO", "RECUSA", "NAO ATENDE", "CAIXA POSTAL", "OCUPADO",
               "FALHA", "TERCEIRO", "ATENDEU TERCEIRO", "NUMERO INVALIDO", "NUMERO INEXISTENTE", "OPT OUT",
               "RECADO", "DEIXOU RECADO", "RECADO COM FAMILIAR", "RECADO - NAO CONHECE", "XPTO-99", "")

    def test_sempre_uma_marca_que_o_banco_aceita(self):
        for c in self.CODIGOS:
            self.assertIn(sugestao_site(c), RESULTADOS_SITE + (None,), c)

    def test_invalido_fica_sem_sugestao(self):
        self.assertEqual(_resultado("NUMERO INVALIDO"), "invalido")      # layout fixo/automático: não muda
        self.assertIsNone(sugestao_site("NUMERO INVALIDO"))
        self.assertIsNone(sugestao_site("NUMERO INEXISTENTE"))

    def test_recado_nao_e_terceiro(self):
        for c in ("RECADO", "DEIXOU RECADO", "RECADO COM FAMILIAR", "Recado c/ esposa"):
            self.assertEqual(sugestao_site(c), "sem_contato", c)
        self.assertEqual(sugestao_site("RECADO - NAO CONHECE"), "terceiro")
        self.assertEqual(sugestao_site("ATENDEU TERCEIRO"), "terceiro")
        # o layout automático (que pode valer na rodada) continua como estava: mudar exige decisão do dono
        self.assertEqual(_resultado("RECADO"), "terceiro")

    def test_cpc_e_desfechos_de_cpc(self):
        for c in ("CPC", "PROMESSA DE PAGAMENTO", "RECUSA"):
            self.assertEqual(sugestao_site(c), "cpc", c)
        self.assertEqual(sugestao_site("OPT OUT"), "opt_out")
        self.assertEqual(sugestao_site("CAIXA POSTAL"), "sem_contato")

    def test_mesmas_marcas_no_motor_no_banco_e_no_site(self):
        self.assertEqual(mapeamento.RESULTADOS, RESULTADOS_SITE)
        m = re.search(r"resultado\s+text check \(resultado in \(([^)]*)\)\)", SQL.read_text(encoding="utf-8"))
        self.assertEqual(tuple(re.findall(r"'([^']+)'", m.group(1))), RESULTADOS_SITE)
        tela = TELA.read_text(encoding="utf-8")
        m = re.search(r"type ResultadoOcorrencia = ([^;]+);", tela)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", m.group(1))), RESULTADOS_SITE)
        m = re.search(r"const RESULTADOS_VALIDOS[^=]*= \[([^\]]*)\]", tela)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", m.group(1))), RESULTADOS_SITE)

    def test_tela_le_a_forma_que_o_motor_grava(self):
        """rodar_dia grava regras_desligadas = {resultado: n} e mailing = nº de linhas (rodar_dia.py)."""
        lib = LIB.read_text(encoding="utf-8")
        self.assertIn("regras_desligadas?: Record<string, number>", lib)
        self.assertIn("mailing?: number", lib)
        rodar = (RAIZ / "rodar_dia.py").read_text(encoding="utf-8")
        self.assertIn('resumo_disc["mailing"] = len(linhas_m)', rodar)
        self.assertIn('"regras_desligadas": dict(trocados)', rodar)


if __name__ == "__main__":
    unittest.main()
