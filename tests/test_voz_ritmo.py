"""Ritmo da discagem (Power e Preditivo, PREDITIVO.md): V1 · medir o abandono certo, sem mudar o ritmo (SQL 106);
V2 · linhas e robôs separados também com razão > 1 (reserva no atendimento, antes do AMD).

- a taxa do freio é a dos últimos 30 min (não o acumulado desde que a VM subiu) e solta sozinha quando a janela anda;
- a transferência sem operador (fila humana cheia) não é abandono e não freia o discador;
- as amostras de 5 min por carteira (discadas, atendidas por pessoa, abandonos, transferências sem operador, curtas, por
  tronco) que a VM grava em voz_ritmo_amostras; só contagens.
Só dados fictícios."""
import logging
import re
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

from tests.test_voz_orquestrador import D0, Base, SimuladorQueFalha, item
from voz import acesso as A
from voz.orquestrador import medidor as M
from voz.orquestrador import principal as P
from voz.orquestrador.agendador import AMOSTRA_MIN_ABANDONO, JANELA_ABANDONO_S, JanelaTaxa

logging.getLogger("motorcx.voz").setLevel(logging.ERROR)
RAIZ = Path(__file__).resolve().parent.parent
SQL106 = RAIZ / "supabase" / "migrations" / "20270221000001_voz_ritmo_medir.sql"


class Sb:
    def __init__(self, falhar=False):
        self.rpcs, self.falhar = [], falhar

    def rpc(self, f, args=None):
        if self.falhar:
            raise OSError("fora")
        self.rpcs.append((f, args))
        return 1


class TestJanela(unittest.TestCase):
    def test_janela_de_30_min(self):
        j = JanelaTaxa()
        for i in range(20):
            j.contar(float(i), abandono=i < 2)
        self.assertEqual((j.atendidas, j.abandonos, j.taxa()), (20, 2, 10.0))
        j.contar(JANELA_ABANDONO_S + 1.0, abandono=False)      # as 2 primeiras (abandonos) saem da janela
        self.assertEqual((j.atendidas, j.abandonos), (19, 0))
        self.assertIsNone(JanelaTaxa().taxa())


class TestFreioPorJanela(Base):
    def test_freio_solta_quando_a_janela_anda(self):
        n = AMOSTRA_MIN_ABANDONO
        itens = [item(f"C{i}", f"119888{i:05d}") for i in range(n + 10)]
        mud = [("voz_config", 0, {"limite_simultaneas": 10, "pico_multiplo": 1, "abandono_max_pct": 3,
                                  "freio_ritmo_pct": 50}),
               ("voz_troncos", 0, {"canais": 100, "cps": 100})]
        orq = self.montar(itens, provedor=SimuladorQueFalha(), mud=mud)
        emp = orq.agendador.empresas[1]
        feitas = 0
        while feitas < n:
            orq.tick()
            for c in list(orq.chamadas.values()):
                self.atender(c.canal)
                self.cair(c.canal)
                feitas += 1
        self.assertTrue(emp.freado)
        self.assertEqual(emp.teto, 5)
        self.rel.andar(JANELA_ABANDONO_S + 1)                    # meia hora sem ligação: o dia ruim sai da conta
        orq.tick()
        self.assertFalse(emp.freado)
        self.assertEqual((emp.atendidas_pessoa, emp.abandonos), (0, 0))


class TestMedidor(unittest.TestCase):
    def test_contagens_por_janela_carteira_e_tronco(self):
        m = M.Medidor()
        t = D0 + timedelta(minutes=2)                            # 10:02 -> janela 10:00
        m.contar(1, 7, 10, "nao_atendida", False, False, None, t)
        m.contar(1, 7, 10, "maquina", False, True, 4, t)
        m.contar(1, 7, 11, "promessa", True, True, 90, t)
        m.contar(1, 7, 11, "abandono_sem_robo", True, True, 8, t)
        m.contar(1, 7, 11, "transferencia_sem_operador", True, True, 70, t)
        m.contar(1, 7, 11, "promessa", True, True, 50, D0 + timedelta(minutes=6))   # janela 10:05
        retrato = lambda e, c: {"modo": "power", "razao": 1.0, "conversas": 3, "reservas": 1, "linhas": 9}  # noqa: E731
        self.assertEqual(m.fechar(D0 + timedelta(minutes=4), retrato), [])         # a janela 10:00 ainda está aberta
        (l1,) = m.fechar(D0 + timedelta(minutes=5), retrato)
        self.assertEqual(l1["janela"], "2026-11-03T10:00:00-03:00")
        self.assertEqual({k: l1[k] for k in ("empresa_id", "credor_id", "discadas", "atendidas_pessoa", "abandonos",
                                             "transf_sem_operador", "curtas", "conversas", "reservas", "linhas")},
                         {"empresa_id": 1, "credor_id": 7, "discadas": 5, "atendidas_pessoa": 3, "abandonos": 1,
                          "transf_sem_operador": 1, "curtas": 3, "conversas": 3, "reservas": 1, "linhas": 9})
        self.assertEqual(l1["por_tronco"], [
            {"tronco_id": 10, "discadas": 2, "atendidas_pessoa": 0, "abandonos": 0, "curtas": 2},
            {"tronco_id": 11, "discadas": 3, "atendidas_pessoa": 3, "abandonos": 1, "curtas": 1}])
        (l2,) = m.fechar(D0, retrato, todos=True)
        self.assertEqual((l2["janela"], l2["discadas"]), ("2026-11-03T10:05:00-03:00", 1))
        self.assertEqual(m.baldes, {})

    def test_curta_e_a_regra_do_motor(self):
        self.assertTrue(M.e_curta("abandono_sem_robo", True, 30))       # abandono conta sempre
        self.assertTrue(M.e_curta("nao_atendida", False, None))
        self.assertTrue(M.e_curta("atendeu_desligou", True, 5))
        self.assertFalse(M.e_curta("atendeu_desligou", True, 7))
        self.assertFalse(M.e_curta("transferencia_sem_operador", True, 40))

    def test_banco_fora_guarda_e_manda_depois(self):
        m = M.Medidor()
        m.contar(1, None, 10, "nao_atendida", False, False, None, D0)
        falhou = []

        def gravar(linhas):
            if not falhou:
                falhou.append(1)
                raise OSError("fora")
            self.assertEqual(len(linhas), 1)

        self.assertEqual(m.enviar(D0 + timedelta(minutes=6), lambda e, c: {}, gravar), -1)
        self.assertEqual(len(m.pendentes), 1)
        self.assertEqual(m.enviar(D0 + timedelta(minutes=7), lambda e, c: {}, gravar), 1)
        self.assertEqual(m.pendentes, [])


class TestPlantaoRitmo(Base):
    def test_ligacoes_viram_amostras_sem_dado_pessoal(self):
        itens = [item("C1", "11988887771"), item("C2", "11988887772")]
        orq = self.montar(itens, mud=[("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})])
        self.lote.credor_id = None
        orq.tick()
        a, b = list(orq.chamadas.values())
        self.atender(a.canal, amd="MACHINE", causa="LONGGREETING")
        self.cair(a.canal)
        self.cair(b.canal, 19)                                    # não atendeu
        sb = Sb()
        pl = P.Plantao(orq, None, orq.dados.config(1).modo, registro=SimpleNamespace(sb=sb), relogio=self.rel)
        self.assertEqual(pl.registrar_ritmo(0.0), 0)              # a janela ainda está aberta
        self.rel.andar(300)
        self.assertEqual(pl.registrar_ritmo(300.0), 1)
        f, args = sb.rpcs[0]
        self.assertEqual(f, "registrar_ritmo_voz")
        l = args["linhas"][0]
        self.assertEqual((l["discadas"], l["atendidas_pessoa"], l["curtas"], l["modo"], l["razao"]),
                         (2, 0, 2, "power", 1.0))
        self.assertNotRegex(repr(sb.rpcs), r"119888|'C\d")       # só contagens: nenhum telefone nem cliente

    def test_banco_fora_nao_para(self):
        orq = self.montar([item()])
        orq.tick()
        self.cair(next(iter(orq.chamadas.values())).canal, 19)
        pl = P.Plantao(orq, None, orq.dados.config(1).modo, registro=SimpleNamespace(sb=Sb(falhar=True)),
                       relogio=self.rel)
        self.rel.andar(600)
        self.assertEqual(pl.registrar_ritmo(600.0), 0)
        self.assertEqual(len(orq.medidor.pendentes), 1)


class TestSql106(unittest.TestCase):
    def test_vm_manda_o_que_o_banco_le(self):
        s = SQL106.read_text(encoding="utf-8")
        self.assertEqual(A.RPC["registrar_ritmo_voz"], "registrar_ritmo")
        self.assertIn("function public.registrar_ritmo_voz(linhas jsonb)", s)
        self.assertIn("function voz_vm.registrar_ritmo(args jsonb)", s)
        campos = re.search(r"as x\(([^)]*)\)", s, re.S).group(1).replace("\n", " ").split(",")
        m = M.Medidor()
        m.contar(1, 2, 3, "cpc", True, True, 30, datetime(2026, 11, 3, 10, 0))
        (linha,) = m.fechar(datetime(2026, 11, 3, 11, 0), lambda e, c: {})
        self.assertEqual({c.split()[0] for c in campos}, set(linha))
        self.assertEqual(set(linha["por_tronco"][0]), {"tronco_id", "discadas", "atendidas_pessoa", "abandonos",
                                                       "curtas"})


class TestReservaNoAtendimento(Base):
    """V2 · linhas e robôs separados com razão > 1: a linha a mais sai sem reserva, reserva o robô quando ATENDE (antes
    do AMD), devolve na máquina, e o toque longo nunca ocupa robô. Com a razão 1,0 (padrão) nada muda."""

    def _montar(self, n=8, limite=2, razao=2.0, provedor=None):
        itens = [item(f"C{i}", f"119888{i:05d}") for i in range(n)]
        mud = [("voz_config", 0, {"limite_simultaneas": limite, "pico_multiplo": 1}),
               ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})]
        orq = self.montar(itens, mud=mud, provedor=provedor)
        orq.agendador.empresas[1].razao = razao
        return orq, orq.agendador.empresas[1]

    def test_linhas_a_mais_sem_reserva_e_toque_longo_sem_robo(self):
        orq, e = self._montar()
        self.assertEqual(orq.tick(), 4)                          # 2 robôs livres × razão 2,0
        self.assertEqual((e.linhas, e.reservas, e.conversas, e.ocupadas), (4, 2, 0, 2))
        sem = [c for c in orq.chamadas.values() if not c.reservada]
        self.assertEqual(len(sem), 2)
        self.rel.andar(39)                                      # toque longo: nenhuma conversa, nenhum pico
        for c in sem:
            self.cair(c.canal, 19)
        self.assertEqual((e.linhas, e.reservas, e.conversas), (2, 2, 0))
        self.assertTrue(all(not ev.no_pico for ev in self.eventos))

    def test_reserva_no_atendimento_e_devolve_na_maquina(self):
        orq, e = self._montar()
        orq.tick()
        com = [c for c in orq.chamadas.values() if c.reservada]
        sem = [c for c in orq.chamadas.values() if not c.reservada]
        self.atender(com[0].canal, amd="MACHINE", causa="LONGGREETING")   # robô volta
        self.ev("StasisStart", sem[0].canal, args=["saida", sem[0].id])   # atendeu: reserva antes do AMD
        self.assertTrue(sem[0].reservada)
        self.assertEqual((e.reservas, orq.contagem.get("reserva_no_atendimento")), (2, 1))
        self.ev("StasisStart", sem[0].canal, args=["amd", "HUMAN", "HUMAN-1-1", ""])
        self.assertEqual((e.reservas, e.conversas), (1, 1))
        self.assertIn(sem[0].id, self.sim.sessoes)              # quem atendeu fala com o agente
        self.atender(sem[1].canal, amd="MACHINE", causa="LONGGREETING")   # sem robô livre: nada reservado
        self.assertEqual(orq.contagem.get("atendeu_sem_reserva"), 1)
        self.assertEqual(e.reservas, 1)

    def test_atendeu_sem_robo_livre_e_abandono_com_mensagem(self):
        orq, e = self._montar()
        orq.tick()
        sem = [c for c in orq.chamadas.values() if not c.reservada]
        self.atender(sem[0].canal)                               # os 2 robôs estão reservados para as outras linhas
        self.assertEqual(self.ari.de("tocar")[-1][2], "sound:motorcx/sem-robo")   # nunca mudo
        self.cair(sem[0].canal)
        self.assertEqual(self.eventos[-1].desfecho, "abandono_sem_robo")
        self.assertEqual((e.atendidas_pessoa, e.abandonos), (1, 1))

    def test_provedor_limita_as_linhas_a_mais(self):
        sim = __import__("voz.provedores.simulador", fromlist=["Simulador"]).Simulador(max_simultaneas=1)
        orq, e = self._montar(limite=5, provedor=sim)
        self.assertEqual(orq.tick(), 2)                          # 1 sessão do provedor × razão 2,0

    def test_razao_um_igual_a_antes(self):
        orq, e = self._montar(razao=1.0)
        self.assertEqual(orq.tick(), 2)
        self.assertTrue(all(c.reservada for c in orq.chamadas.values()))
        self.assertEqual(orq.contagem.get("reserva_no_atendimento"), None)


if __name__ == "__main__":
    unittest.main()
