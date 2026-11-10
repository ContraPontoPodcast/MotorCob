"""SQL 116 · "Testar agora" do Agente de voz (PR 9 do plano Canais/Agente Voz/CX) na VM.

- o Plantão pega o pedido com a referência do segredo (nunca o número), lê o número no cofre e confere o hash, o plano
  de discagem nacional, a janela de hoje pela UF do número e o freio de curtas antes de discar;
- a ligação sai pelo mesmo caminho do lote (robô reservado, aviso de gravação na abertura, fluxo da carteira) e conta
  em voz_chamadas, mas não volta ao motor como retorno de cliente; o lote do dia não é trocado;
- no fim, só marcas e contagens vão para concluir_teste_agora_voz; sem discar, recusa com o motivo;
- o número não aparece em log nem no que vai ao banco.
Só dados fictícios."""
import hashlib
import json
import logging
import unittest
from datetime import timedelta
from types import SimpleNamespace

from tests.test_voz_orquestrador import CEL, Base, item
from voz import acesso as A
from voz.orquestrador import principal as P
from voz.orquestrador import testar_agora as TA
from voz.segredos import Dicionario

logging.getLogger("motorcx.voz").setLevel(logging.ERROR)
REF = "voz/trunk/e1/teste-abcdef123456"
HASH = hashlib.sha256(CEL.encode()).hexdigest()


class Sb:
    def __init__(self, pedidos):
        self.pedidos, self.rpcs = list(pedidos), []

    def rpc(self, f, args=None):
        self.rpcs.append((f, args))
        if f == "pegar_teste_agora_voz":
            return self.pedidos.pop(0) if self.pedidos else None
        return None

    def selecionar(self, tabela, filtros=None, ordem=None):
        return [{"id": 1, "nome": "Assessoria Exemplo"}] if tabela == "empresas" else [{"id": 7, "nome": "Carteira Beta"}]

    def concluidos(self):
        return [a for f, a in self.rpcs if f == "concluir_teste_agora_voz"]


class Fonte:
    def __init__(self, sb):
        self.sb = sb

    def regras(self, empresa_id, linhas=None):
        return {}


def pedido(i=1, **kw):
    return {"id": i, "empresa_id": 1, "credor_id": 7, "hash": HASH, "segredo_ref": REF, **kw}


class TestConferir(unittest.TestCase):
    def test_travas_antes_de_discar(self):
        from tests.test_voz_orquestrador import D0          # terça, 10:00 (Brasília)
        self.assertEqual(TA.conferir(pedido(), CEL, D0, None, False), (("08:00", "19:50"), None))   # prévia de SP
        self.assertIn("não confere", TA.conferir(pedido(hash="0" * 64), CEL, D0, None, False)[1])
        self.assertIn("plano de discagem", TA.conferir({"hash": hashlib.sha256(b"190").hexdigest()}, "190", D0, None, False)[1])
        self.assertIn("chamadas curtas", TA.conferir(pedido(), CEL, D0, None, True)[1])
        self.assertIn("fora do horário", TA.conferir(pedido(), CEL, D0.replace(hour=21), None, False)[1])
        domingo = D0 + timedelta(days=5)
        self.assertIn("domingo", TA.conferir(pedido(), CEL, domingo, None, False)[1])
        # Acre (68): 08:00 local = 10:00 de Brasília; às 09:30 de Brasília ainda não liga
        acre = "68988887770"
        self.assertIn("fora do horário", TA.conferir({"hash": hashlib.sha256(acre.encode()).hexdigest()}, acre,
                                                     D0.replace(hour=9, minute=30), None, False)[1])


class TestPlantaoTestarAgora(Base):
    def _plantao(self, pedidos, segredos=None, modo="teste"):
        orq = self.montar([item("C1", "11988887772")], mud=[("voz_config", 0, {"modo": modo})])
        self.sb = Sb(pedidos)
        pl = P.Plantao(orq, Fonte(self.sb), "real", registro=SimpleNamespace(sb=self.sb), relogio=self.rel,
                       segredos=Dicionario({REF: "+55 " + CEL}) if segredos is None else segredos)
        return orq, pl

    def test_liga_com_o_numero_do_cofre_e_conclui_so_com_marcas(self):
        orq, pl = self._plantao([pedido()])
        with self.assertLogs("motorcx.voz", level="INFO") as logs:
            self.assertEqual(pl.pegar_testes_agora(0.0), 1)
        self.assertTrue(all(CEL not in m for m in logs.output))
        self.assertEqual(self.sb.rpcs[0], ("pegar_teste_agora_voz", {"empresas": [1]}))
        self.assertEqual(len(orq.lotes), 2)                              # o lote do dia continua lá
        lote_dia = orq.lotes[(1, None, "agente_voz")]
        self.assertIsNone(lote_dia.teste_id)
        teste = next(l for l in orq.lotes.values() if l.teste_id == 1)
        self.assertEqual((teste.itens[0].id_cliente, teste.itens[0].tentativas_max_numero), ("teste-agora-1", 1))
        self.assertEqual(teste.itens[0].variaveis, {"assessoria": "Assessoria Exemplo", "credor": "Carteira Beta"})
        orq.tick()
        saida = [c for c in self.originados() if CEL in c[1]]
        self.assertEqual(len(saida), 1)
        canal = saida[0][2]
        c = next(x for x in orq.chamadas.values() if x.canal == canal)
        self.assertTrue(c.reservada)                                     # Power 1,0: robô reservado antes de discar
        self.rel.andar(6)
        self.atender(canal)
        orq.tick()
        self.rel.andar(40)
        orq.tick()
        self.cair(canal, 16)
        fim = self.sb.concluidos()
        self.assertEqual(len(fim), 1)
        self.assertEqual(fim[0]["situacao"], "concluido")
        p = fim[0]["passos"]
        self.assertTrue(p["tocou"] and p["atendeu"] and p["agente"] and p["aviso_gravacao"])
        self.assertGreater(p["segundos"], 0)
        self.assertTrue(set(p) <= {"tocou", "atendeu", "agente", "gravada", "aviso_gravacao", "identidade_confirmada",
                                   "transferiu", "segundos", "toque_s", "sip"})
        self.assertNotIn(CEL, json.dumps(fim))
        # voz_chamadas recebe a ligação (modo da empresa), o retorno ao motor não
        ev = next(e for e in self.eventos if e.id_cliente == "teste-agora-1")
        self.assertEqual(ev.modo, "teste")
        self.assertFalse(any((self.pasta / "eventos").glob("**/*teste-agora*")))
        self.assertFalse(any("teste-agora" in f.read_text() for f in (self.pasta / "eventos").rglob("*") if f.is_file()))
        self.assertEqual(len(orq.lotes), 1)                              # o lote de teste saiu
        self.assertEqual(pl.testes, {})

    def test_recusa_sem_ligar(self):
        casos = [
            (Dicionario({}), pedido(), "não foi lido do cofre"),
            (Dicionario({REF: "11988887779"}), pedido(), "não confere"),
        ]
        for seg, ped, motivo in casos:
            orq, pl = self._plantao([ped], segredos=seg)
            pl.pegar_testes_agora(0.0)
            fim = self.sb.concluidos()
            self.assertEqual((fim[0]["situacao"], len(orq.lotes)), ("recusado", 1), motivo)
            self.assertIn(motivo, fim[0]["motivo"])
            self.assertEqual(self.originados(), [])

    def test_sem_cofre_e_modo_simulado(self):
        orq, pl = self._plantao([pedido()])
        pl.segredos = None
        pl.pegar_testes_agora(0.0)
        self.assertIn("cofre", self.sb.concluidos()[0]["motivo"])
        orq2, pl2 = self._plantao([pedido()], modo="simulado")
        self.assertEqual(pl2.pegar_testes_agora(0.0), 0)                 # empresa em Simulado: nem pede
        self.assertEqual(self.sb.rpcs, [])

    def test_espera_demais_recusa_e_tira_o_lote(self):
        orq, pl = self._plantao([pedido()])
        pl.pegar_testes_agora(0.0)
        teste = next(l for l in orq.lotes.values() if l.teste_id == 1)
        teste.itens[0].nao_antes_de = self.rel() + timedelta(hours=1)   # algo segura a ligação (ex.: troncos cheios)
        pl.vigiar_testes(TA.ESPERA_MAX_S - 1)
        self.assertEqual(self.sb.concluidos(), [])
        pl.vigiar_testes(TA.ESPERA_MAX_S)
        self.assertIn("ocupados por 5 minutos", self.sb.concluidos()[0]["motivo"])
        self.assertEqual(len(orq.lotes), 1)

    def test_lote_de_teste_fica_fora_do_lote_do_dia(self):
        orq, pl = self._plantao([pedido()])
        pl.pegar_testes_agora(0.0)
        self.assertEqual([l.teste_id for l in pl._do_dia()], [None])
        pl._carregar_listas(self.rel().date())        # dia "novo" para a empresa: sai o lote do dia, o de teste fica
        self.assertEqual([l.teste_id for l in orq.lotes.values()], [1])

    def test_rpc_no_acesso_proprio(self):
        self.assertEqual((A.RPC["pegar_teste_agora_voz"], A.RPC["concluir_teste_agora_voz"]),
                         ("pegar_teste_agora", "concluir_teste_agora"))


if __name__ == "__main__":
    unittest.main()
