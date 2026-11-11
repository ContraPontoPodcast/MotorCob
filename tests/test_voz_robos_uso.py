"""Uso dos robôs contratados (SQL 102, PR 6 do plano "Robôs contratados"): a VM manda, a cada 15 s e por empresa, os robôs
em uso agora (conversas + reservas, o que o limite conta desde o PR 212), o maior uso desde a foto anterior, os números
que ainda esperam na lista e o tempo com todos os robôs ocupados. Só contagens (nenhum telefone ou cliente). Os dois
acessos da VM (chave e acesso próprio) chamam a mesma gravação. Só dados fictícios."""
import logging
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

from tests.test_voz_orquestrador import Base, item
from voz import acesso as A
from voz.orquestrador import principal as P

logging.getLogger("motorcx.voz").setLevel(logging.ERROR)
SQL102 = Path(__file__).resolve().parent.parent / "supabase" / "migrations" / "20270215000001_voz_robos_uso.sql"


class Sb:
    def __init__(self, falhar=False):
        self.rpcs, self.falhar = [], falhar

    def rpc(self, f, args=None):
        if self.falhar:
            raise OSError("fora")
        self.rpcs.append((f, args))
        return 1


class TestUsoRobos(Base):
    def _itens(self, n):
        return [item(f"C{i}", f"119888{i:05d}") for i in range(n)]

    def _montar(self, limite=2, n=6):
        return self.montar(self._itens(n), mud=[("voz_config", 0, {"limite_simultaneas": limite, "pico_multiplo": 1}),
                                                ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})])

    def _plantao(self, orq, sb):
        return P.Plantao(orq, None, orq.dados.config(1).modo, registro=SimpleNamespace(sb=sb), relogio=self.rel)

    def test_foto_conta_robos_ocupados_e_o_pico_da_janela(self):
        orq = self._montar(limite=2)
        ag = orq.agendador
        self.assertEqual(ag.foto_robos(1), {"em_uso": 0, "conversas": 0, "linhas": 0, "limite": 2, "pico": 0,
                                            "no_limite": False})
        orq.tick()                                              # 2 linhas com robô reservado
        a, b = list(orq.chamadas.values())
        self.atender(a.canal)                                   # 1 conversa + 1 reserva
        self.atender(b.canal, amd="MACHINE", causa="LONGGREETING")   # máquina: o robô volta
        f = ag.foto_robos(1)
        self.assertEqual((f["em_uso"], f["conversas"], f["pico"], f["no_limite"]), (1, 1, 2, False))
        self.assertEqual(ag.foto_robos(1)["pico"], 1)           # a janela zera: o pico novo parte do uso de agora
        self.assertIsNone(ag.foto_robos(99))

    def test_plantao_grava_contagens_e_segundos_no_limite(self):
        orq = self._montar(limite=2)
        orq.tick()                                              # 2 de 2: no limite, o resto espera na lista
        sb = Sb()
        pl = self._plantao(orq, sb)
        self.assertEqual(pl.registrar_uso_robos(100.0), 1)
        self.rel.andar(15)
        pl.registrar_uso_robos(115.0)
        self.rel.andar(500)
        pl.registrar_uso_robos(615.0)                           # intervalo longo (VM parada): no máximo 60 s
        (f1, a1), (_, a2), (_, a3) = sb.rpcs
        self.assertEqual(f1, "registrar_uso_robos_voz")
        l1 = a1["linhas"][0]
        self.assertEqual({k: l1[k] for k in ("empresa_id", "em_uso", "limite", "pico", "no_limite", "segundos_no_limite")},
                         {"empresa_id": 1, "em_uso": 2, "limite": 2, "pico": 2, "no_limite": True, "segundos_no_limite": 0})
        self.assertEqual(l1["aguardando"], 4)                   # os outros 4 números esperam na lista
        self.assertEqual(a2["linhas"][0]["segundos_no_limite"], 15)
        self.assertEqual(a3["linhas"][0]["segundos_no_limite"], 60)
        self.assertNotRegex(repr(sb.rpcs), r"119888|C\d")       # só contagens: nenhum telefone nem cliente

    def test_ciclo_grava_a_cada_15s_e_banco_fora_nao_para(self):
        orq = self._montar(limite=2)
        sb = Sb(falhar=True)
        pl = self._plantao(orq, sb)
        pl.registrar_uso_robos(0.0)                             # banco fora: segue sem erro
        sb.falhar = False
        pl._ult = {k: float("inf") for k in pl._ult} | {"robos": -1e9}   # só a telemetria vence neste teste
        pl.agregado = self.rel().date()
        pl.ciclo(1000.0)
        pl.ciclo(1005.0)
        pl.ciclo(1016.0)
        self.assertEqual(sum(1 for f, _ in sb.rpcs if f == "registrar_uso_robos_voz"), 2)

    def test_sem_empresa_carregada_nao_chama(self):
        orq = self._montar()
        orq.agendador.empresas.clear()
        sb = Sb()
        self.assertEqual(self._plantao(orq, sb).registrar_uso_robos(0.0), 0)
        self.assertEqual(sb.rpcs, [])

    def test_sql_e_os_dois_acessos(self):
        s = SQL102.read_text(encoding="utf-8")
        self.assertEqual(A.RPC["registrar_uso_robos_voz"], "registrar_uso_robos")
        self.assertIn("function public.registrar_uso_robos_voz(linhas jsonb)", s)
        self.assertIn("function voz_vm.registrar_uso_robos(args jsonb)", s)
        campos = set(re.search(r"as x\(([^)]*)\)", s, re.S).group(1).replace("\n", " ").split(","))
        nomes = {c.split()[0] for c in campos}
        orq = self._montar()
        foto = {"empresa_id", "aguardando", "segundos_no_limite", *orq.agendador.foto_robos(1)}
        self.assertEqual(nomes, foto)                           # o que a VM manda é o que o banco lê


if __name__ == "__main__":
    unittest.main()
