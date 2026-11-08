"""SQL 83 · B7: identidade antes da dívida nos textos do Speech Analytics (recomendação e relatório)."""
import json
import re
import unittest
from datetime import date
from pathlib import Path

from motor import retroalimentacao as R
from motor import trava_identidade as TI

RAIZ = Path(__file__).resolve().parent.parent
CASOS = json.loads((RAIZ / "tests" / "dados" / "trava_identidade_casos.json").read_text(encoding="utf-8"))["casos"]
MIGRACAO = RAIZ / "supabase" / "migrations" / "20270119000001_voz_destinos_gravacao_identidade.sql"


class TestTrava(unittest.TestCase):
    def test_casos(self):
        for c in CASOS:
            with self.subTest(texto=c["texto"]):
                self.assertEqual(TI.revela(c["texto"]), c["revela"], TI.motivos(c["texto"]))

    def test_padroes_iguais_ao_banco(self):
        """O SQL 83 tem cópia literal dos padrões (\\b do Python = \\y do Postgres)."""
        sql = MIGRACAO.read_text(encoding="utf-8")
        for nome, padrao in TI.PADROES.items():
            with self.subTest(padrao=nome):
                m = re.search(rf"\n    {nome} constant text := '(.*?)';\n", sql)
                self.assertIsNotNone(m, nome)
                self.assertEqual(m.group(1), padrao.replace(r"\b", r"\y"))
        self.assertIn(f"'{TI.ACENTOS[0]}', '{TI.ACENTOS[1]}'", sql)

    def test_exemplos_do_especialista(self):
        self.assertTrue(TI.revela("Abrir a conversa com o nome do credor"))
        self.assertFalse(TI.revela("'Desconhece a dívida' subiu 6 pontos na Carteira Cartões Beta. Confirme a identidade "
                                   "mais cedo e diga o nome do credor logo depois da confirmação."))
        self.assertFalse(TI.revela("Posso falar sobre o seu contrato? Bom dia!"))      # sem cumprimento antes
        self.assertTrue(TI.revela("Bom dia! Posso falar sobre o seu contrato?"))
        self.assertFalse(TI.revela("Bom dia! Falo com {{primeiro_nome}}?"))

    def test_textos_da_recomendacao(self):
        r = R.Recomendacao("frases", "frase_converte", "frases:x", "Título neutro", "Texto neutro", {},
                           {"texto": "Olá! Consta {{saldo}} em aberto. Falo com {{primeiro_nome}}?"})
        self.assertFalse(TI.recomendacao_ok(r))
        self.assertTrue(TI.recomendacao_ok({"titulo": "Ligar à tarde", "texto": "", "proposta": {}}))
        self.assertFalse(TI.recomendacao_ok({"titulo": "Abrir a ligação com o nome do credor", "proposta": {}}))


class TestRetroalimentacao(unittest.TestCase):
    def conversao(self):
        linhas = [{"dimensao": "total", "valor": "todas", "credor_id": None, "conversas": 1000, "com_acordo": 300}]
        linhas.append({"dimensao": "frase", "valor": "reconheceu_dificuldade", "credor_id": None, "conversas": 400,
                       "com_acordo": 200})
        return linhas

    def test_todas_as_frases_do_motor_passam(self):
        for codigo, (titulo, texto) in R.FRASES.items():
            with self.subTest(codigo=codigo):
                self.assertFalse(TI.revela(titulo) or TI.revela(texto))

    def test_recomendacao_que_fere_a_trava_nao_sai(self):
        self.assertEqual([r.chave for r in R.gerar(self.conversao(), [], [])], ["frases:reconheceu_dificuldade"])
        antigo = R.FRASES["reconheceu_dificuldade"]
        try:
            R.FRASES["reconheceu_dificuldade"] = ("Abrir a conversa com o nome do credor",
                                                 "Bom dia, aqui é a central em nome de {{credor}}.")
            self.assertEqual(R.gerar(self.conversao(), [], []), [])
        finally:
            R.FRASES["reconheceu_dificuldade"] = antigo

    def test_relatorio_ao_credor_tambem_passa_pela_trava(self):
        conv = [{"dimensao": "total", "valor": "todas", "conversas": 500, "com_acordo": 100},
                {"dimensao": "motivo", "valor": "aguardando_recebimento", "conversas": 250, "com_acordo": 100}]
        rel = R.montar_relatorio({"politica": {}}, date(2026, 11, 1), conv, [], [])
        self.assertEqual([r["id"] for r in rel["recomendacoes"]], ["dia_vencimento"])
        self.assertTrue(all(TI.recomendacao_ok(r) for r in rel["recomendacoes"]))


if __name__ == "__main__":
    unittest.main()
