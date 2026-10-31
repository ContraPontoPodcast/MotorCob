"""SQL 56 (agente de voz): o banco usa as mesmas listas fechadas do motor.

- voz_chamadas.resultado / resultado_ia / resultado_operador aceitam exatamente os desfechos de motor/voz.py
  (sem os internos, que só o motor gera);
- transferencia, destino e origem_resultado são os valores do de-para (motor/voz.py e motor/certificacao.py);
- segundos_tarifados() do banco segue a regra da decisão 11 (conferida aqui com uma cópia em Python).
Sem banco: lê o texto da migração."""
import math
import re
import unittest
from pathlib import Path

from motor import voz as V

RAIZ = Path(__file__).resolve().parent.parent
MIGRACAO = RAIZ / "supabase" / "migrations" / "20261223000001_voz_base.sql"


def _lista(sql: str, inicio: str) -> list[str]:
    i = sql.index("array[", sql.index(inicio))
    trecho = sql[i:sql.index("]", i)]
    return re.findall(r"'([a-z0-9_]+)'", trecho)


def segundos_tarifados(billsec, inicial, incremento):
    """Cópia da regra do banco: 0 se billsec <= 0; inicial se billsec <= inicial; depois blocos do incremento."""
    if billsec is None or billsec <= 0:
        return 0
    if billsec <= inicial:
        return inicial
    return inicial + math.ceil((billsec - inicial) / incremento) * incremento


class TestVozBanco(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRACAO.read_text(encoding="utf-8")

    def test_desfechos_iguais_ao_motor(self):
        banco = _lista(self.sql, "create or replace function public.desfechos_voz()")
        motor = [d.chave for d in V.DESFECHOS if not d.interno]
        self.assertEqual(banco, motor)

    def test_transferencia_e_destino(self):
        self.assertIn("transferencia          text check (transferencia in ('atendida', 'sem_operador', 'falhou'))",
                      self.sql)
        self.assertEqual(V.TRANSFERENCIAS, ("atendida", "sem_operador", "falhou"))
        self.assertIn("destino                text check (destino in ('ia', 'ia_humano'))", self.sql)
        self.assertEqual(V.DESTINOS, ("ia", "ia_humano"))

    def test_variaveis_sem_dado_pessoal(self):
        variaveis = _lista(self.sql, "create or replace function public.variaveis_voz()")
        for proibida in ("cpf", "nome", "telefone", "nome_completo", "email"):
            self.assertNotIn(proibida, variaveis)

    def test_regra_de_tarifacao(self):
        casos = {(0, 30, 6): 0, (-1, 30, 6): 0, (1, 30, 6): 30, (30, 30, 6): 30, (31, 30, 6): 36, (37, 30, 6): 42,
                 (61, 60, 60): 120, (59, 1, 1): 59}
        for args, esperado in casos.items():
            self.assertEqual(segundos_tarifados(*args), esperado, args)


if __name__ == "__main__":
    unittest.main()
