"""Job noturno das métricas do Fluxo do agente (voz/fluxo_metricas.py, SQL 66): ontem e anteontem para cada empresa
da parte, o mais antigo primeiro; uma empresa que falha não segura as outras; os dois acessos usam as mesmas RPCs."""
import io
import unittest
from contextlib import redirect_stdout
from datetime import date

from voz import acesso as A
from voz import fluxo_metricas as FM


class SbFalso:
    def __init__(self, empresas, falha=None):
        self.empresas, self.falha, self.chamadas = empresas, falha, []

    def rpc(self, nome, args):
        self.chamadas.append((nome, args))
        if nome == "fluxo_empresas_voz":
            return self.empresas
        if args.get("empresa") == self.falha:
            raise RuntimeError("banco fora")
        return {"blocos": 3, "intencoes": 2}


class TestFluxoMetricas(unittest.TestCase):
    def test_ontem_e_anteontem_por_empresa(self):
        sb = SbFalso([7, 9])
        out = FM.noite(sb, date(2026, 11, 2), "1/2")
        self.assertEqual(sb.chamadas[0], ("fluxo_empresas_voz", {"parte": "1/2"}))
        self.assertEqual([a for n, a in sb.chamadas[1:]], [
            {"empresa": 7, "dia": "2026-10-31"}, {"empresa": 7, "dia": "2026-11-01"},
            {"empresa": 9, "dia": "2026-10-31"}, {"empresa": 9, "dia": "2026-11-01"}])
        self.assertEqual(out, {"empresas": 2, "dias": 4, "blocos": 12, "intencoes": 8})

    def test_empresa_com_erro_nao_segura_as_outras(self):
        out = FM.noite(SbFalso([7, 9], falha=7), date(2026, 11, 2))
        self.assertEqual((out["erros"], out["dias"]), (1, 2))

    def test_janela_limitada_ao_banco(self):
        sb = SbFalso([7])
        FM.noite(sb, date(2026, 11, 2), dias=99)
        self.assertEqual(len(sb.chamadas) - 1, FM.JANELA_DIAS)

    def test_main_imprime_o_resumo(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(FM.main(["--hoje", "2026-11-02"], sb=SbFalso([])), 0)
        self.assertIn('"empresas": 0', buf.getvalue())

    def test_rpcs_no_acesso_proprio(self):
        self.assertEqual(A.RPC["fluxo_empresas_voz"], "fluxo_empresas")
        self.assertEqual(A.RPC["agregar_fluxo_dia"], "agregar_fluxo_dia")


if __name__ == "__main__":
    unittest.main()
