"""Ritmo da discagem (Power e Preditivo, PREDITIVO.md): V1 · medir o abandono certo, sem mudar o ritmo (SQL 106);
V2 · linhas e robôs separados também com razão > 1 (reserva no atendimento, antes do AMD); V3 · ritmo por carteira em
credores.discagem › ritmo (SQL 107) e a leitura na VM; V4 · Power (razão fixa, teto de abandono) e abandono digno
(mensagem, não religa no dia, abandono recente; SQL 108); V6 · freios de chamadas curtas no ritmo (SQL 109); V5 ·
o Preditivo (controlador, aquecimento, previsão de robôs liberando, simulação de discagem; SQL 110); V8 · perna humana
(operadores ao mesmo tempo, fila cheia; SQL 111).

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
        # o SQL 108 recria a leitura com razao_config e estado (TestSql108)
        self.assertEqual({c.split()[0] for c in campos}, set(linha) - {"razao_config", "estado"})
        self.assertEqual(set(linha["por_tronco"][0]), {"tronco_id", "discadas", "atendidas_pessoa", "abandonos",
                                                       "curtas"})


class TestReservaNoAtendimento(Base):
    """V2/V4 · linhas e robôs separados com razão > 1: as linhas saem sem reserva e reservam o robô quando ATENDEM (antes
    do AMD), a máquina devolve, quem atende sem robô livre ouve a mensagem (abandono), e o toque longo nunca ocupa robô.
    Com a razão 1,0 (padrão) nada muda: cada linha sai com o seu robô."""

    def _montar(self, n=8, limite=2, razao=2.0, provedor=None):
        itens = [item(f"C{i}", f"119888{i:05d}") for i in range(n)]
        mud = [("voz_config", 0, {"limite_simultaneas": limite, "pico_multiplo": 1}),
               ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})]
        orq = self.montar(itens, mud=mud, provedor=provedor)
        self.lote.ritmo = {"modo": "power", "razao": razao, "meta_abandono": 1.0, "razao_max": 3.0}   # V4: da carteira
        return orq, orq.agendador.empresas[1]

    def test_linhas_a_mais_sem_reserva_e_toque_longo_sem_robo(self):
        orq, e = self._montar()
        self.assertEqual(orq.tick(), 4)                          # 2 robôs livres × razão 2,0
        self.assertEqual((e.linhas, e.reservas, e.conversas, e.ocupadas), (4, 0, 0, 0))
        self.rel.andar(39)                                      # toque longo: nenhuma conversa, nenhum pico
        for c in list(orq.chamadas.values()):
            self.cair(c.canal, 19)
        self.assertEqual((e.linhas, e.reservas, e.conversas), (0, 0, 0))
        self.assertTrue(all(not ev.no_pico for ev in self.eventos))

    def test_reserva_no_atendimento_devolve_na_maquina_e_abandono_com_mensagem(self):
        orq, e = self._montar()
        orq.tick()
        a, b, c, d = list(orq.chamadas.values())
        self.ev("StasisStart", a.canal, args=["saida", a.id])   # atendeu: reserva antes do AMD
        self.assertTrue(a.reservada)
        self.assertEqual((e.reservas, orq.contagem.get("reserva_no_atendimento")), (1, 1))
        self.ev("StasisStart", a.canal, args=["amd", "MACHINE", "LONGGREETING", ""])
        self.assertEqual(e.reservas, 0)                          # máquina: o robô volta
        self.atender(b.canal)
        self.assertEqual((e.reservas, e.conversas), (0, 1))
        self.assertIn(b.id, self.sim.sessoes)                    # quem atendeu fala com o agente
        self.ev("StasisStart", c.canal, args=["saida", c.id])   # o último robô livre
        self.ev("StasisStart", d.canal, args=["saida", d.id])   # nenhum: o AMD ainda decide
        self.assertEqual(orq.contagem.get("atendeu_sem_reserva"), 1)
        self.ev("StasisStart", d.canal, args=["amd", "HUMAN", "HUMAN-1-1", ""])
        self.assertEqual(self.ari.de("tocar")[-1][2], "sound:motorcx/sem-robo")   # nunca mudo
        self.cair(d.canal)
        self.assertEqual(self.eventos[-1].desfecho, "abandono_sem_robo")

    def test_provedor_limita_as_linhas_a_mais(self):
        sim = __import__("voz.provedores.simulador", fromlist=["Simulador"]).Simulador(max_simultaneas=1)
        orq, e = self._montar(limite=5, provedor=sim)
        self.assertEqual(orq.tick(), 2)                          # 1 sessão do provedor × razão 2,0

    def test_razao_um_igual_a_antes(self):
        orq, e = self._montar(razao=1.0)
        self.assertEqual(orq.tick(), 2)
        self.assertTrue(all(c.reservada for c in orq.chamadas.values()))
        self.assertEqual(orq.contagem.get("reserva_no_atendimento"), None)


class TestConfiguracaoRitmo(unittest.TestCase):
    """V3 · credores.discagem › ritmo (SQL 107): Power 1,0 por padrão; Power 1–3; Preditivo com meta 0,5–3% e razão
    máxima 1–3; teto de abandono fixo em 3%; o banco valida o mesmo que o motor."""

    def test_padrao_e_power_um(self):
        from motor import discagem as DG
        self.assertEqual(DG.ritmo_da_carteira(None), {"modo": "power", "razao": 1.0, "meta_abandono": 1.0,
                                                      "razao_max": 3.0})
        self.assertEqual(DG.ritmo_da_carteira({"tentativas_numero_dia": 3})["razao"], 1.0)
        self.assertEqual(DG.TETO_ABANDONO, 3.0)
        self.assertEqual(DG.padrao_site()["ritmo"]["teto_abandono"], 3.0)

    def test_validacao_no_motor(self):
        from motor import discagem as DG
        cfg, av = DG.normalizar({"ritmo": {"modo": "preditivo", "meta_abandono": 0.8, "razao_max": 2.5}})
        self.assertEqual(av, [])
        self.assertEqual(cfg["ritmo"], {"modo": "preditivo", "razao": 1.0, "meta_abandono": 0.8, "razao_max": 2.5})
        cfg, av = DG.normalizar({"ritmo": {"modo": "progressivo", "razao": 4, "meta_abandono": 5, "x": 1}})
        self.assertEqual(cfg["ritmo"], DG.PADRAO["ritmo"])       # o inválido fica com o padrão
        self.assertEqual(len(av), 4)
        self.assertEqual(DG.ritmo_da_carteira({"ritmo": {"modo": "power", "razao": 1.5}})["razao"], 1.5)

    def test_banco_tem_as_mesmas_regras(self):
        import json
        sql = (RAIZ / "supabase" / "migrations" / "20270222000001_voz_ritmo_config.sql").read_text(encoding="utf-8")
        regras = json.loads(re.search(r"discagem_regras\(\) returns jsonb.*?select '(.*?)'::jsonb", sql, re.S).group(1))
        self.assertEqual(regras["_blocos"]["ritmo"], {"modo": ["enum", "power", "preditivo"],
                                                      "razao": ["real", 1.0, 3.0], "meta_abandono": ["real", 0.5, 3.0],
                                                      "razao_max": ["real", 1.0, 3.0]})
        self.assertIn("ritmo", regras["_chaves"])


class FonteRitmo:
    def __init__(self, linhas):
        self.linhas, self.chamadas = linhas, 0

    def ritmos(self, empresa_id):
        self.chamadas += 1
        if self.linhas is None:
            return None
        from voz.orquestrador.principal import FonteListas
        return FonteListas.ritmos(self, empresa_id, self.linhas)


class TestVmLeORitmo(Base):
    def test_le_e_rele_a_cada_minuto_e_banco_fora_mantem(self):
        orq = self.montar([item()])
        self.lote.credor_id = 7
        self.assertEqual(self.lote.ritmo["modo"], "power")
        fonte = FonteRitmo([{"credor_id": 7, "discagem": {"ritmo": {"modo": "power", "razao": 2.0}}},
                            {"credor_id": 8, "discagem": None}])
        pl = P.Plantao(orq, fonte, orq.dados.config(1).modo, relogio=self.rel)
        pl._ult = {k: float("inf") for k in pl._ult} | {"ritmo_cfg": -1e9}
        pl.agregado = self.rel().date()
        pl.ciclo(0.0)
        self.assertEqual((self.lote.ritmo["modo"], self.lote.ritmo["razao"]), ("power", 2.0))
        pl.ciclo(30.0)
        self.assertEqual(fonte.chamadas, 1)                      # a cada minuto
        fonte.linhas = None                                      # banco fora: o ritmo de antes continua
        pl.ciclo(61.0)
        self.assertEqual(self.lote.ritmo["razao"], 2.0)
        fonte.linhas = [{"credor_id": 7, "discagem": {"ritmo": {"modo": "x"}}}]   # inválido: padrão
        pl.ciclo(122.0)
        self.assertEqual(self.lote.ritmo, {"modo": "power", "razao": 1.0, "meta_abandono": 1.0, "razao_max": 3.0})


class TestPower(Base):
    """V4 · Power: a razão fixa da carteira vale na VM; teto de 3 % nos últimos 30 min → 1,0 até o fim do dia; o
    Preditivo, até o V5, disca em aquecimento (1,0)."""

    def _montar(self, ritmo, n=12, limite=2):
        itens = [item(f"C{i}", f"119888{i:05d}") for i in range(n)]
        mud = [("voz_config", 0, {"limite_simultaneas": limite, "pico_multiplo": 1}),
               ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})]
        orq = self.montar(itens, mud=mud)
        self.lote.ritmo = {"modo": "power", "razao": 1.0, "meta_abandono": 1.0, "razao_max": 3.0, **ritmo}
        return orq

    def test_razao_da_carteira(self):
        for razao, linhas in ((1.0, 2), (1.5, 3), (2.0, 4), (3.0, 6)):
            orq = self._montar({"razao": razao})
            self.assertEqual(orq.tick(), linhas, razao)
            # 1,0: cada linha com o seu robô; acima: todas reservam no atendimento
            self.assertEqual(sum(c.reservada for c in orq.chamadas.values()), 2 if razao == 1.0 else 0)

    def test_preditivo_antes_do_controlador_e_um_para_um(self):
        orq = self._montar({"modo": "preditivo", "razao_max": 3.0})
        self.assertEqual(orq.tick(), 2)
        self.assertEqual(orq.retrato(1, None)["estado"], "aquecendo")

    def test_retrato_tem_modo_razao_e_estado(self):
        orq = self._montar({"razao": 2.0})
        self.lote.credor_id = None
        r = orq.retrato(1, None)
        self.assertEqual({k: r[k] for k in ("modo", "razao", "razao_config", "estado")},
                         {"modo": "power", "razao": 2.0, "razao_config": 2.0, "estado": "normal"})

    def test_teto_de_abandono_freia_ate_o_fim_do_dia(self):
        from voz.orquestrador.ritmo import AMOSTRA_MIN_TETO, RitmoCarteira
        r = RitmoCarteira()
        ritmo = {"modo": "power", "razao": 2.0}
        t = D0
        for i in range(AMOSTRA_MIN_TETO - 1):
            self.assertIsNone(r.resultado_pessoa(i < 2, t, ritmo))     # 2 de 49: abaixo da amostra mínima
        self.assertEqual(r.resultado_pessoa(False, t, ritmo), "freou")  # 2 de 50 = 4 % > 3 %
        self.assertEqual((r.razao(ritmo, t), r.estado(ritmo, t)), (1.0, "freado"))
        self.assertEqual(r.razao(ritmo, t + timedelta(hours=8)), 1.0)    # até o fim do dia
        self.assertEqual(r.razao(ritmo, t + timedelta(days=1)), 2.0)     # amanhã volta
        r2 = RitmoCarteira()
        for i in range(AMOSTRA_MIN_TETO):                                # já em 1,0: nada a frear
            r2.resultado_pessoa(i < 5, t, {"modo": "power", "razao": 1.0})
        self.assertIsNone(r2.freado_dia)


class TestAbandonoDigno(Base):
    """V4 · quem atende sem agente ouve a mensagem e não recebe outra ligação no dia (nem pela regra por sinalização);
    abandono recente: 2 em 7 dias = 3 dias sem voz; 1 = a próxima só com robô reservado."""

    def test_nao_religa_no_dia_mesmo_com_a_regra_por_sinalizacao(self):
        from voz.orquestrador.lote import Lote, RegrasLote
        regras = RegrasLote.da_carteira({"por_sinalizacao": {}})
        self.assertTrue(regras.sinal("abandonada")["rediscar"]["ativo"])   # a linha padrão redisca no topo
        it, outro = item("C1"), item("C1", "11988887771", ordem=2)
        lote = Lote(1, [it, outro], regras=regras)
        lote.registrar(it, "abandono_sem_robo", D0, id_chamada="x1")
        self.assertIn("C1", lote.guarda.clientes_encerrados)
        self.assertNotIn("C1", lote.guarda.reabriveis)
        self.assertIsNone(it.volta)
        self.assertIsNone(lote.proximo(D0 + timedelta(hours=1)))
        lote2 = Lote(1, [item("C2")], regras=regras)
        lote2.registrar(lote2.itens[0], "transferencia_sem_operador", D0, id_chamada="x2")   # não é abandono
        self.assertIsNotNone(lote2.itens[0].volta)

    def test_abandonos_recentes(self):
        from voz.orquestrador.lote import Lote
        from voz.orquestrador.principal import aplicar_abandonos
        lote = Lote(1, [item("A"), item("B", "11988887771"), item("C", "11988887772"), item("D", "11988887773")])
        hoje = D0.date()
        fora = aplicar_abandonos([lote], {"A": (2, hoje - timedelta(days=1)), "B": (1, hoje - timedelta(days=2)),
                                          "C": (2, hoje - timedelta(days=3))}, hoje)
        a, b, c, d = lote.itens
        self.assertEqual((fora, a.encerrado, b.reservar, c.encerrado, c.reservar, d.reservar),
                         (1, True, True, False, True, False))

    def test_quem_teve_abandono_so_sai_com_robo_reservado(self):
        itens = [item("R", "11988887771", reservar=True), item("N", "11988887772"), item("M", "11988887773")]
        mud = [("voz_config", 0, {"limite_simultaneas": 1, "pico_multiplo": 1}),
               ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})]
        orq = self.montar(itens, mud=mud)
        self.lote.ritmo = {"modo": "power", "razao": 3.0, "meta_abandono": 1.0, "razao_max": 3.0}
        orq.tick()
        por = {c.item.id_cliente: c.reservada for c in orq.chamadas.values()}
        self.assertEqual(por, {"R": True, "N": False, "M": False})       # R primeiro, com o único robô
        from voz.orquestrador.lote import Lote
        lote = Lote(1, [item("R", "11988887771", reservar=True), item("N", "11988887772")])
        self.assertEqual(lote.proximo(D0, reservavel=False)[1].id_cliente, "N")   # sem robô livre: R espera
        self.assertEqual(lote.proximo(D0)[1].id_cliente, "R")


class TestSql108(unittest.TestCase):
    def test_vm_manda_o_que_o_banco_le(self):
        s = (RAIZ / "supabase" / "migrations" / "20270223000001_voz_ritmo_power.sql").read_text(encoding="utf-8")
        campos = re.search(r"as x\(([^)]*)\)", s, re.S).group(1).replace("\n", " ").split(",")
        m = M.Medidor()
        m.contar(1, 2, 3, "cpc", True, True, 30, datetime(2026, 11, 3, 10, 0))
        retrato = {"modo": "power", "razao": 2.0, "razao_config": 2.0, "estado": "normal", "conversas": 1,
                   "reservas": 0, "linhas": 2}
        (linha,) = m.fechar(datetime(2026, 11, 3, 11, 0), lambda e, c: retrato)
        self.assertEqual({c.split()[0] for c in campos}, set(linha))
        self.assertEqual(A.RPC["abandonos_recentes_voz"], "abandonos_recentes")
        self.assertIn("function voz_vm.abandonos_recentes(args jsonb)", s)


class TestFreiosCurtas(Base):
    """V6 · curtas medidas na VM por linha e total: a razão cai de 70 % a 80 %; em 80 % com 800 ligações a linha para no
    dia; com 8.000 a empresa para; a liberação do Admin sobe para 950/9.500 só no dia; dia novo zera."""

    def test_razao_cai_de_70_a_80(self):
        from voz.orquestrador.curtas import Curtas
        c = Curtas()
        for i in range(100):
            c.contar(1, 10, i < 75, D0)                          # 75 % de curtas
        self.assertAlmostEqual(c.razao(1, 3.0, D0), 2.0)       # metade do caminho entre 3,0 e 1,0
        self.assertEqual(c.razao(1, 1.0, D0), 1.0)
        self.assertEqual(c.estado(1, D0), "reduzido")
        c2 = Curtas()
        for i in range(99):
            c2.contar(1, 10, True, D0)                          # 100 % mas sem amostra (99 < 100): não reduz
        self.assertEqual(c2.razao(1, 3.0, D0), 3.0)
        c2.contar(1, 10, True, D0)
        self.assertEqual(c2.razao(1, 3.0, D0), 1.0)            # ≥ 80 %: 1,0

    def test_linha_para_em_800_e_volta_amanha(self):
        from voz.orquestrador.curtas import Curtas
        c = Curtas()
        for i in range(799):
            c.contar(1, 10, i % 10 < 8, D0)                     # 80 %
        self.assertFalse(c.tronco_parado(1, 10, D0))
        c.contar(1, 10, True, D0)
        self.assertTrue(c.tronco_parado(1, 10, D0))
        self.assertEqual(c.estado(1, D0), "parado")
        self.assertTrue(any("parada até amanhã" in a for a in c.avisos))
        self.assertFalse(c.tronco_parado(1, 11, D0))           # as outras linhas seguem
        self.assertFalse(c.tronco_parado(1, 10, D0 + timedelta(days=1)))
        c.contar(1, 10, False, D0 + timedelta(days=1))          # dia novo: zera
        self.assertEqual(c.empresas[1].troncos[10].total, 1)

    def test_liberacao_do_admin_e_semente_do_banco(self):
        from voz.orquestrador.curtas import Curtas
        c = Curtas()
        c.semear(1, D0.date(), {"total": 8000, "curtas": 6500, "troncos": [{"tronco_id": 10, "total": 900,
                                                                           "curtas": 760}]})
        self.assertTrue(c.empresa_parada(1, D0))
        self.assertTrue(c.tronco_parado(1, 10, D0))
        c.semear(1, D0.date(), {"total": 10, "curtas": 1, "liberado": True})   # nunca desce: fica o maior
        self.assertEqual(c.empresas[1].total.total, 8000)
        self.assertFalse(c.empresa_parada(1, D0))              # liberado: só para em 9.500
        self.assertFalse(c.tronco_parado(1, 10, D0))           # e a linha em 950
        self.assertEqual(c.razao(1, 2.0, D0), 1.0)             # a redução continua

    def test_vm_nao_disca_por_linha_parada_nem_empresa_parada(self):
        itens = [item(f"C{i}", f"119888{i:05d}") for i in range(10)]
        mud = [("voz_config", 0, {"limite_simultaneas": 5, "pico_multiplo": 1}),
               ("voz_troncos", 0, {"cps": 100}), ("voz_troncos", 1, {"cps": 100})]
        orq = self.montar(itens, mud=mud)
        orq.curtas.semear(1, D0.date(), {"troncos": [{"tronco_id": 10, "total": 800, "curtas": 700}]})
        orq.tick()
        self.assertTrue(all(c.candidata.tronco.id != 10 for c in orq.chamadas.values()))
        self.assertGreater(orq.contagem.get("linha_parada_curtas", 0), 0)
        self.assertEqual(orq.retrato(1, None)["estado"], "parado")
        orq2 = self.montar(itens, mud=mud)
        orq2.curtas.semear(1, D0.date(), {"total": 8000, "curtas": 6400})
        self.assertEqual(orq2.tick(), 0)
        self.assertGreater(orq2.contagem.get("empresa_parada_curtas", 0), 0)

    def test_plantao_semeia_do_banco_e_banco_fora_segue(self):
        orq = self.montar([item()])

        class SbCurtas(Sb):
            def rpc(self, f, args=None):
                super().rpc(f, args)
                return {"total": 900, "curtas": 100, "troncos": [], "liberado": False}
        sb = SbCurtas()
        pl = P.Plantao(orq, None, orq.dados.config(1).modo, registro=SimpleNamespace(sb=sb), relogio=self.rel)
        self.assertEqual(pl.semear_curtas(0.0), 1)
        self.assertEqual(sb.rpcs[0], ("curtas_hoje_voz", {"empresa": 1}))
        self.assertEqual(orq.curtas.empresas[1].total.total, 900)
        pl2 = P.Plantao(orq, None, orq.dados.config(1).modo, registro=SimpleNamespace(sb=Sb(falhar=True)),
                        relogio=self.rel)
        self.assertEqual(pl2.semear_curtas(0.0), 0)

    def test_sql_e_acesso(self):
        s = (RAIZ / "supabase" / "migrations" / "20270224000001_voz_curtas_freio.sql").read_text(encoding="utf-8")
        self.assertEqual(A.RPC["curtas_hoje_voz"], "curtas_hoje")
        self.assertIn("function voz_vm.curtas_hoje(args jsonb)", s)
        from voz.orquestrador import curtas as K
        self.assertEqual((K.LINHA_PARA, K.EMPRESA_PARA, K.LINHA_LIBERADA, K.EMPRESA_LIBERADA), (800, 8000, 950, 9500))
        self.assertIn("950/linha e 9.500/total", s)


class TestControladorPreditivo(unittest.TestCase):
    """V5 · o Preditivo: p com encolhimento, fator do controlador, aquecimento, primeira semana, início do lote e teto."""

    def _ctrl(self, **h):
        from voz.orquestrador.ritmo import Historico, RitmoCarteira
        base = {"discadas_7d": 5000, "atendidas_7d": 600, "dias_preditivo": 30}
        return RitmoCarteira(historico=Historico(**{**base, **h}))

    PRED = {"modo": "preditivo", "razao": 1.0, "meta_abandono": 1.0, "razao_max": 3.0}

    def test_p_com_encolhimento(self):
        from voz.orquestrador.ritmo import P_SEM_HISTORICO, Historico, RitmoCarteira
        c = self._ctrl()
        self.assertAlmostEqual(c.p(D0), 0.12)                  # 600/5000 da carteira
        for i in range(200):
            c.discou(D0, i < 60)                                # 30 % hoje
        self.assertAlmostEqual(c.p(D0), (60 + 200 * 0.12) / 400)
        self.assertAlmostEqual(RitmoCarteira().p(D0), P_SEM_HISTORICO)
        self.assertAlmostEqual(RitmoCarteira(historico=Historico(p_empresa=0.2)).p(D0), 0.2)
        # janela nova do dia: a anterior (com 30+ atendidas) vira a base
        self.assertAlmostEqual(c.p(D0 + timedelta(minutes=30)), (60 + 200 * 0.12) / 400)

    def test_razao_fator_sobre_p_com_tetos(self):
        c = self._ctrl()
        c.inicio = D0 - timedelta(hours=1)
        self.assertAlmostEqual(c.razao(self.PRED, D0), 0.8 / 0.12 if 0.8 / 0.12 < 3 else 3.0)
        self.assertEqual(c.razao({**self.PRED, "razao_max": 2.5}, D0), 2.5)
        c.inicio = D0 - timedelta(minutes=5)                     # primeiros 15 min do lote: até 1,5
        self.assertEqual(c.razao(self.PRED, D0), 1.5)
        c2 = self._ctrl(dias_preditivo=3)                        # primeira semana: até 2,0
        c2.inicio = D0 - timedelta(hours=1)
        self.assertEqual(c2.razao(self.PRED, D0), 2.0)

    def test_aquecimento(self):
        c = self._ctrl(atendidas_7d=150)
        c.inicio = D0 - timedelta(hours=1)
        self.assertEqual((c.razao(self.PRED, D0), c.estado(self.PRED, D0)), (1.0, "aquecendo"))
        for _ in range(50):
            c.discou(D0, True)                                    # 150 + 50 hoje = 200
        self.assertGreater(c.razao(self.PRED, D0), 1.0)
        self.assertEqual(c.estado(self.PRED, D0), "normal")

    def test_fator_segue_a_meta(self):
        from voz.orquestrador.ritmo import FATOR_INICIAL
        c = self._ctrl()
        t = D0
        for i in range(60):                                      # 2 de 60 = 3,3 % > teto: corta pela metade na hora
            c.resultado_pessoa(i < 2, t, self.PRED)
        self.assertAlmostEqual(c.fator, FATOR_INICIAL * 0.5)
        self.assertEqual(c.estado(self.PRED, t), "freado")
        c2 = self._ctrl()
        for i in range(100):                                     # 2 % > meta 1 %: −0,10 na revisão
            c2.janela.contar(t.timestamp(), i < 2)
        c2.rever(t, self.PRED)
        self.assertAlmostEqual(c2.fator, FATOR_INICIAL - 0.10)
        c2.rever(t + timedelta(minutes=1), self.PRED)
        self.assertAlmostEqual(c2.fator, FATOR_INICIAL - 0.10)   # só revê a cada 5 min
        c2.rever(t + timedelta(minutes=5), self.PRED)
        self.assertAlmostEqual(c2.fator, FATOR_INICIAL - 0.20)
        c3 = self._ctrl()
        for i in range(100):                                     # 0 % < meta ÷ 2: +0,05
            c3.janela.contar(t.timestamp(), False)
        c3.rever(t, self.PRED)
        self.assertAlmostEqual(c3.fator, FATOR_INICIAL + 0.05)

    def test_teto_por_10_min_vira_power_no_dia(self):
        c = self._ctrl()
        t = D0
        for i in range(50):
            c.resultado_pessoa(i < 5, t, self.PRED)              # 10 %
        self.assertIsNone(c.freado_dia)
        self.assertEqual(c.rever(t + timedelta(minutes=10), self.PRED), "power")
        self.assertEqual(c.razao(self.PRED, t + timedelta(hours=2)), 1.0)
        self.assertEqual(c.estado(self.PRED, t + timedelta(hours=2)), "freado")


class TestSimulacaoPreditivo(unittest.TestCase):
    """V5 · simulação de discagem (agendador e controlador de verdade, mundo falso): 30 robôs, conversa média de 90 s,
    30 % de máquina, 3 h, em 3 cenários do PREDITIVO.md (p estável, p subindo à tarde, rota caindo). O abandono fica em
    até 1,5 % e o Preditivo conversa mais que o Power 1,0 (o de hoje), que nunca abandona."""

    def _sim(self, p_de, **kw):
        from tests.sim_preditivo import simular
        return [simular(p_de, seed=s, **kw) for s in (1, 2)]

    def test_tres_cenarios_abandono_ate_1_5(self):
        S = 3 * 3600
        cen = {"p estável": lambda t: 0.15, "p subindo à tarde": lambda t: 0.08 + 0.32 * t / S,
               "rota caindo": lambda t: 0.15 if t < 3600 else (0.03 if t < 7200 else 0.15)}
        base = self._sim(lambda t: 0.15, ritmo={"modo": "power", "razao": 1.0})
        self.assertTrue(all(b["abandonos"] == 0 for b in base))
        for nome, f in cen.items():
            for r in self._sim(f):
                self.assertLessEqual(r["abandono_pct"], 1.5, nome)
                self.assertGreater(r["razao_media"], 1.0, nome)
        for r, b in zip(self._sim(cen["p estável"]), base):
            self.assertGreater(r["conversas_hora"], 1.5 * b["conversas_hora"])   # ~2× hoje (PREDITIVO.md 3.4)

    def test_preditivo_abandona_menos_que_power_alto_com_p_subindo(self):
        S = 3 * 3600
        f = lambda t: 0.10 + 0.35 * t / S                      # noqa: E731
        pred = self._sim(f)
        power = self._sim(f, ritmo={"modo": "power", "razao": 3.0})
        self.assertLess(sum(r["abandono_pct"] for r in pred), sum(r["abandono_pct"] for r in power))

    def test_sem_historico_aquece_em_power_um(self):
        from tests.sim_preditivo import simular
        r = simular(lambda t: 0.15, segundos=600, aquecida=False)
        self.assertEqual((r["razao_max"], r["abandonos"]), (1.0, 0))      # 10 min: ainda sem 200 atendidas


class TestPreditivoNaVm(Base):
    def test_liberando_e_historico(self):
        from voz.orquestrador.ritmo import Historico
        itens = [item(f"C{i}", f"119888{i:05d}") for i in range(30)]
        mud = [("voz_config", 0, {"limite_simultaneas": 2, "pico_multiplo": 1}),
               ("voz_troncos", 0, {"cps": 100, "canais": 100}), ("voz_troncos", 1, {"cps": 100})]
        orq = self.montar(itens, mud=mud)
        self.lote.ritmo = {"modo": "preditivo", "razao": 1.0, "meta_abandono": 1.0, "razao_max": 3.0}
        self.assertEqual(orq.tick(), 2)                          # sem histórico: aquecimento (1:1)
        self.lote.controle.historico = Historico(discadas_7d=5000, atendidas_7d=600, dias_preditivo=30)
        self.lote.controle.inicio = D0 - timedelta(hours=1)
        for c in list(orq.chamadas.values()):
            self.atender(c.canal)                                # os 2 robôs conversando
        self.assertEqual(orq.tick(), 0)                          # nenhum livre, nenhum liberando
        self.rel.andar(80)                                       # conversa média 90 s − T 17 s: vão liberar
        self.assertEqual(orq._liberando(self.lote, self.rel()), 2)
        self.assertEqual(orq.tick(), 6)                          # 2 liberando × razão 3,0

    def test_plantao_le_o_historico(self):
        orq = self.montar([item()])
        self.lote.credor_id = 7

        class SbH(Sb):
            def rpc(self, f, args=None):
                super().rpc(f, args)
                return {"p_empresa": 0.11, "carteiras": [{"credor_id": 7, "discadas_7d": 900, "atendidas_7d": 120,
                                                          "dias_preditivo": 2}]}
        sb = SbH()
        pl = P.Plantao(orq, None, orq.dados.config(1).modo, registro=SimpleNamespace(sb=sb), relogio=self.rel)
        self.assertEqual(pl.ler_historico(), 1)
        h = self.lote.controle.historico
        self.assertEqual((h.atendidas_7d, h.dias_preditivo, h.p_empresa), (120, 2, 0.11))
        self.assertEqual(sb.rpcs[0], ("historico_ritmo_voz", {"empresa": 1}))
        self.assertEqual(A.RPC["historico_ritmo_voz"], "historico_ritmo")


class TestPernaHumana(Base):
    """V8 · perna humana: nunca mais transferências ao mesmo tempo que os operadores informados (padrão 5); passou, o
    agente continua e agenda retorno; fila humana cheia (> 10 % sem operador em 30 min) = o agente oferece o retorno
    antes de transferir; a transferência sem operador conta à parte (mesmo quando o agente voltou), nunca no abandono."""

    def _transferindo(self, n, simultaneas=5):
        itens = [item(f"C{i}", f"11988887{i:02d}8") for i in range(n)]          # final 8 = o Simulador pede humano
        mud = [("voz_config", 0, {"limite_simultaneas": 20, "pico_multiplo": 1}),
               ("voz_troncos", 0, {"cps": 100, "canais": 50}), ("voz_troncos", 1, {"cps": 100}),
               ("voz_transferencias", 0, {"simultaneas": simultaneas})]
        orq = self.montar(itens, mud=mud)
        orq.tick()
        for c in list(orq.chamadas.values()):
            self.atender(c.canal)
        orq.tick()
        self.rel.andar(31)
        orq.tick()
        return orq

    def test_limite_de_operadores_ao_mesmo_tempo(self):
        orq = self._transferindo(4, simultaneas=2)
        humanos = [c for c in orq.chamadas.values() if c.estado == "transferindo"]
        self.assertEqual(len(humanos), 2)                        # só 2 chamando a fila
        self.assertEqual(orq.contagem.get("transferencia_limite_operadores"), 2)
        self.assertEqual(len([c for c in self.ari.de("originar") if c[3][0] == "humano"]), 2)   # só 2 para a fila
        voltaram = [c for c in orq.chamadas.values() if c.estado != "transferindo"]
        self.assertEqual(len(voltaram), 2)                       # as outras voltaram ao agente (retorno agendado)
        self.assertTrue(all(c.sem_operador and c.canal_humano is None for c in voltaram))
        self.assertEqual(orq.contagem.get("transferencia_sem_operador_voltou_agente"), 2)
        self.assertEqual(self.dados.transferencias[0].simultaneas, 2)

    def test_fila_cheia_e_contagem_separada(self):
        from voz.orquestrador.nucleo import FILA_AMOSTRA_MIN
        orq = self._transferindo(1)
        j = orq.fila_humana.setdefault(1, __import__("voz.orquestrador.agendador", fromlist=["JanelaTaxa"]).JanelaTaxa())
        for k in range(FILA_AMOSTRA_MIN):
            j.contar(self.rel().timestamp(), k < 3)               # 15 % sem operador
        self.assertTrue(orq._fila_humana_cheia(1, self.rel()))
        self.assertTrue(any("fila humana está cheia" in a for a in orq.alertas))
        c = next(iter(orq.chamadas.values()))
        self.cair(f"{c.id}-h", 17)                              # ninguém atendeu: volta ao agente
        self.cair(c.canal)
        b = next(iter(orq.medidor.baldes.values()))
        self.assertEqual((b.transf_sem_operador, b.abandonos), (1, 0))
        self.rel.andar(31 * 60)                                   # a janela anda: a fila deixa de estar cheia
        self.assertFalse(orq._fila_humana_cheia(1, self.rel()))

    def test_banco_le_simultaneas(self):
        from voz import banco as B
        from tests.test_voz_gerador import dados_exemplo
        d = dados_exemplo()
        self.assertEqual(B.carregar(d).transferencias[0].simultaneas, 5)          # sem a coluna: 5
        d["voz_transferencias"][0]["simultaneas"] = 600
        with self.assertRaises(B.DadosInvalidos):
            B.carregar(d)
        s = (RAIZ / "supabase" / "migrations" / "20270226000001_voz_transferencia_operadores.sql").read_text(encoding="utf-8")
        self.assertIn("select t.id, t.simultaneas from public.voz_transferencias t", s)
        self.assertNotIn("create or replace view voz_vm.transferencias ", s)    # o SQL 57 continua reaplicável
        self.assertEqual(B.COLUNAS["voz_transferencias"]["simultaneas"], "simultaneas")
        self.assertEqual(A.LEITURA["voz_transferencias_operadores"], "transferencias_operadores")

    def test_acesso_proprio_junta_a_view_dos_operadores(self):
        from voz import configuracao as CF

        class SbV:
            def __init__(self, falhar=False):
                self.falhar = falhar

            def selecionar(self, t, **kw):
                if self.falhar:
                    raise OSError("sem a view")
                return [{"id": 3, "simultaneas": 9}]
        trs = [{"id": 3, "destino_sip": "sip:x@y"}, {"id": 4}]
        CF.juntar_operadores(SbV(), trs)
        self.assertEqual([t.get("simultaneas") for t in trs], [9, None])
        ja = [{"id": 3, "simultaneas": 2}]
        CF.juntar_operadores(SbV(falhar=True), ja)             # modo chave: já veio na linha (nem consulta)
        self.assertEqual(ja[0]["simultaneas"], 2)
        sem = [{"id": 3}]
        CF.juntar_operadores(SbV(falhar=True), sem)            # banco sem o SQL 111: fica o padrão
        self.assertNotIn("simultaneas", sem[0])


if __name__ == "__main__":
    unittest.main()
