"""Rotina do faturamento no plantão: rascunhos e emissão automática uma vez por dia, envio da fila a cada rodada."""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from nuvem.sincronizar import _faturamento
from nuvem.supabase_api import ErroSupabase


class Sb:
    def __init__(self, fila, falhar=None):
        self.chamadas, self.fila, self.falhar = [], list(fila), falhar or {}
        self.faturas = {f: {"id": f, "envio": "enviando", "envio_tentativas": 1} for f in fila}

    def rpc(self, nome, args=None):
        self.chamadas.append(("rpc", nome, args))
        if nome == "faturas_para_enviar":
            fila, self.fila = self.fila, []
            return fila
        return {"gerar_rascunhos": 1, "emitir_automaticas": 2}.get(nome)

    def funcao(self, nome, corpo):
        self.chamadas.append(("funcao", nome, corpo))
        f = corpo["fatura"]
        if f in self.falhar:
            raise self.falhar[f]
        return {"enviada_para": ["fin@exemplo.com"]}

    def selecionar(self, tabela, filtros):
        return [self.faturas[int(filtros["id"][3:])]]

    def atualizar(self, tabela, filtros, valores):
        self.faturas[int(filtros["id"][3:])].update(valores)


class TestEnvio(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dados = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_dia_roda_uma_vez_e_depois_das_6h(self):
        sb, saida = Sb([]), []
        _faturamento(sb, self.dados, datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc), saida.append)   # 05:00 em SP
        self.assertNotIn(("rpc", "emitir_automaticas", None), sb.chamadas)
        _faturamento(sb, self.dados, datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc), saida.append)  # 09:00
        self.assertIn(("rpc", "gerar_rascunhos", {"competencia": "2026-10-01"}), sb.chamadas)          # corte 1: mês anterior
        self.assertIn(("rpc", "gerar_rascunhos", {"competencia": "2026-11-01"}), sb.chamadas)
        self.assertIn("faturamento: 2 rascunhos gerados, 2 faturas emitidas sozinhas", saida)
        n = len(sb.chamadas)
        _faturamento(sb, self.dados, datetime(2026, 11, 1, 15, 0, tzinfo=timezone.utc), saida.append)
        self.assertEqual([c for c in sb.chamadas[n:] if c[1] != "faturas_para_enviar"], [])         # só uma vez por dia

    def test_fila_envia_e_erro_definitivo_ou_tenta_de_novo(self):
        recusa = ErroSupabase(422, json.dumps({"erro": "Sem e-mail do financeiro"}), "u")
        sb = Sb([7, 8, 9], {8: recusa, 9: ErroSupabase(503, "fora", "u")})
        saida = []
        _faturamento(sb, self.dados, datetime(2026, 11, 1, 3, 0, tzinfo=timezone.utc), saida.append)
        self.assertIn(("funcao", "cobranca", {"acao": "enviar_fatura", "fatura": 7}), sb.chamadas)
        self.assertEqual(sb.faturas[8]["envio"], "erro")
        self.assertEqual(sb.faturas[8]["envio_motivo"], "Sem e-mail do financeiro")
        self.assertEqual(sb.faturas[9]["envio"], "pendente")                                         # tenta na próxima
        self.assertIn("faturamento: fatura 7 enviada para fin@exemplo.com", saida)

    def test_banco_sem_o_sql_25_nao_quebra(self):
        class Velho(Sb):
            def rpc(self, nome, args=None):
                raise ErroSupabase(404, "função não existe", "u")
        saida = []
        _faturamento(Velho([]), self.dados, datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc), saida.append)
        self.assertTrue(any("não rodou" in s for s in saida))


if __name__ == "__main__":
    unittest.main()
