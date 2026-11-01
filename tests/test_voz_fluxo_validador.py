"""SQL 58 (fluxos do agente de voz): validador em Python = public.fluxo_voz_erros do banco.

- os casos de voz/fluxo_casos.py dão exatamente os erros esperados (os mesmos casos rodam no Postgres em
  supabase/testes/testar_rls.py, então Python e banco ficam amarrados pelos mesmos esperados);
- as listas fechadas do Python são as do SQL (lidas do texto da migração);
- os 4 modelos gravados pela migração são os de voz/fluxo_modelos.py e passam no validador;
- pendencias() (cópia de fluxo_voz_pendencias) segura conector inativo, finalidade errada, intenção fora do catálogo e
  oferta sem alçada.
Sem banco: lê o texto da migração."""
import json
import re
import unittest
from pathlib import Path

from voz import fluxo_casos as C
from voz import fluxo_modelos as M
from voz import fluxo_validador as V

RAIZ = Path(__file__).resolve().parent.parent
MIGRACAO = RAIZ / "supabase" / "migrations" / "20261225000001_voz_fluxo.sql"


def _lista(sql: str, inicio: str) -> list[str]:
    i = sql.index("array[", sql.index(inicio))
    return re.findall(r"'([a-z0-9_.]+)'", sql[i:sql.index("]", i)])


class TestValidadorFluxo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRACAO.read_text(encoding="utf-8")

    def test_casos(self):
        for nome, d, esperado in C.casos():
            with self.subTest(nome):
                self.assertEqual(V.erros(d), esperado)

    def test_cada_recusa_do_prototipo_tem_caso(self):
        codigos = {e.split(":")[0] for _, _, es in C.casos() for e in es}
        for c in ("abertura_ausente", "abertura_repetida", "sem_saida", "saida_inexistente", "inalcancavel",
                  "ciclo_sem_limite", "blocos_demais", "fala_longa", "variavel_invalida", "valor_antes_identidade",
                  "identidade_generativa", "generativo_sem_objetivo", "generativo_sem_limite", "ferramenta_invalida",
                  "transferir_humano_desligado", "terceiro_sem_recado", "fala_pede_senha", "params_invalidos"):
            self.assertIn(c, codigos)

    def test_listas_iguais_ao_banco(self):
        self.assertEqual(tuple(_lista(self.sql, "create or replace function public.variaveis_voz()")), V.VARIAVEIS_VOZ)
        self.assertEqual(tuple(_lista(self.sql, "create or replace function public.campos_oferta_voz()")), V.CAMPOS_OFERTA)
        self.assertEqual(tuple(_lista(self.sql, "ferramentas constant text[]")), V.FERRAMENTAS)
        self.assertEqual(tuple(_lista(self.sql, "tipos constant text[]")), tuple(V.TIPOS))
        self.assertIn(f"public.fluxo_voz_aux_inteiro(p -> 'max_turnos', 1, {V.MAX_TURNOS_GLOBAL})", self.sql)
        self.assertIn(f"jsonb_array_length(d -> 'blocos') > {V.MAX_BLOCOS}", self.sql)
        self.assertIn(f"char_length(p ->> 'fala') > {V.FALA_MAX}", self.sql)

    def test_modelos_da_migracao(self):
        achados = dict(re.findall(r"\('([a-z]+)', '[^']+', '[a-z]+', '[^']+',\n\s+\$m\$(.*?)\$m\$::jsonb\)", self.sql, re.S))
        self.assertEqual(set(achados), set(M.MODELOS))
        for cod, (_n, _t, _d, f) in M.MODELOS.items():
            with self.subTest(cod):
                self.assertEqual(json.loads(achados[cod]), f())
                self.assertEqual(V.erros(f()), [])

    def test_forma_ok(self):
        self.assertTrue(V.forma_ok(C.casos()[3][1]))       # sem saída: rascunho pode
        self.assertFalse(V.forma_ok({"esquema": 2, "blocos": []}))

    def test_pendencias(self):
        d = C.negociador()
        con = {1: ("ativo", "buscar_ofertas"), 2: ("ativo", "validar_cadastro"), 3: ("ativo", "registrar_acordo"),
               4: ("ativo", "gerar_boleto")}
        intencoes = {"quero_negociar", "ja_paguei", "nao_reconheco", "sem_dinheiro"}
        self.assertEqual(V.pendencias(d, con, True, intencoes), [])
        self.assertEqual(V.pendencias(d, {**con, 4: ("rascunho", "gerar_boleto")}, True, intencoes), ["conector_inativo:N7"])
        self.assertEqual(V.pendencias(d, {**con, 2: ("ativo", "buscar_ofertas")}, True, intencoes), ["conector_finalidade:N2"])
        self.assertEqual(V.pendencias(d, con, False, intencoes), ["sem_alcada"])
        self.assertEqual(V.pendencias(d, con, True, intencoes - {"ja_paguei"}), ["intencao_fora_catalogo:N3"])
        sem = C.negociador(None, None, None, None)
        self.assertEqual(V.pendencias(sem, con, True, intencoes),
                         ["conector_inativo:N4", "conector_inativo:N7", "identidade_sem_conferencia:N2"])
        # os 4 modelos começam com a identidade pendente até a empresa escolher o conector de validação
        for cod, (_n, _t, _d, f) in M.MODELOS.items():
            self.assertIn("identidade_sem_conferencia:N2", V.pendencias(f(), {}, True, set()), cod)


class TestVariaveisLineares(unittest.TestCase):
    """variaveis()/trocar_variaveis() = regex do banco \\{\\{([^}]*)\\}\\}, sem o tempo quadrático do regex (CodeQL
    py/polynomial-redos: o texto vem de quem edita o fluxo, pelo simulador)."""
    RE_BANCO = re.compile(r"\{\{([^}]*)\}\}")

    def test_mesmo_resultado_do_regex(self):
        import random
        rnd = random.Random(58)
        fixos = ["", "{{", "}}", "{{}}", "{{ nome }}", "{{{nome}}}", "{{a}b}}", "{{a}}}}", "x{{a}}y{{ b }}z", "{{a}",
                 "{{ {{x}} }}", "{ {a}}", "{{a\n}}", "}}{{", "{{{{"]
        aleatorios = ["".join(rnd.choice("{}a ") for _ in range(rnd.randint(0, 14))) for _ in range(5000)]
        for t in fixos + aleatorios:
            self.assertEqual(V.variaveis(t), [m.strip(" \t\n\r") for m in self.RE_BANCO.findall(t)], repr(t))
            self.assertEqual(V.trocar_variaveis(t, lambda n: f"<{n}>"), self.RE_BANCO.sub(lambda m: f"<{m.group(1)}>", t),
                             repr(t))

    def test_tempo_linear(self):
        import time
        for t in ("{{" * 100_000, "{{|" * 100_000, "{{" + "a}" * 100_000, "{" * 200_000 + "}"):
            ini = time.perf_counter()
            V.variaveis(t)
            V.trocar_variaveis(t, lambda _: "")
            self.assertLess(time.perf_counter() - ini, 1.0, t[:6])


if __name__ == "__main__":
    unittest.main()
