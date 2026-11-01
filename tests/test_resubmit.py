"""Renitência por situação, regra por sinalização, modo de discagem, Reenviar agora, Reciclar mailing e contato por
passada (SQL 65; protótipo funcional aprovado em 01/11/2026).

Paridade: carteira sem as chaves novas = o motor e a VM de hoje. Depois, as regras novas: máximo por situação, conta no
descanso, falha técnica como curta, a regra por sinalização (finaliza, redisca o mesmo telefone depois de depois_min
— o único intervalo —, até max, com prioridade; depois: próximo telefone, próximo cliente ou finaliza), o modo vertical
e o horizontal com spins (spin N → telefone N), o log de decisões (só destino_hash), "Reenviar agora" e "Reciclar".
Também confere que o SQL 65 diz o mesmo que o motor. Só dados fictícios."""
import json
import re
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

from motor import discagem as DG
from motor import voz as V
from motor.entrada import Evento
from tests.test_voz_orquestrador import D0, Base, item
from voz import acesso as A
from voz import banco as B
from voz.orquestrador import lote as L
from voz.registro import RegistroBanco

RAIZ = Path(__file__).resolve().parent.parent
SQL65 = RAIZ / "supabase" / "migrations" / "20270101000001_voz_resubmit.sql"
TEL = ("11988887771", "11988887772", "11988887773", "11988887774")


def _json_da_funcao(nome: str):
    s = SQL65.read_text(encoding="utf-8")
    m = re.search(rf"function public\.{nome}\(\) returns jsonb.*?select '(.*?)'::jsonb", s, re.S)
    return json.loads(m.group(1))


def _array_da_funcao(nome: str):
    s = SQL65.read_text(encoding="utf-8")
    m = re.search(rf"function public\.{nome}\(\) returns text\[\].*?select array\[(.*?)\]::text\[\]", s, re.S)
    return re.findall(r"'([a-z_]+)'", m.group(1))


def _enc(r):
    if r is bool:
        return "bool"
    if isinstance(r, str):
        return r
    if isinstance(r, dict):
        return {k: _enc(v) for k, v in r.items()}
    if r[0] == "real":
        return ["real", r[1], r[2]]
    if isinstance(r[0], str):
        return ["enum", *r]
    return ["int", r[0], r[1]]


# ------------------------------------------------------------------ o SQL e o motor dizem a mesma coisa
class TestSqlIgualAoMotor(unittest.TestCase):
    def test_regras_de_validacao(self):
        r = _json_da_funcao("discagem_regras")
        self.assertEqual(r["_inteiros"], {k: ["int", *v] for k, v in DG._INTEIROS.items()})
        self.assertEqual(r["_blocos"], {k: _enc(s) for k, s in DG._SUB.items()})
        for bloco, chaves, sub in (("por_situacao", DG.SITUACOES_RENITENCIA, DG._SUB_SITUACAO),
                                   ("falhas_tecnicas", DG.FALHAS_TECNICAS, DG._SUB_FALHA),
                                   ("por_sinalizacao", DG.SINALIZACOES, DG._SUB_SINAL)):
            self.assertEqual(r[bloco], {"chaves": list(chaves), "campos": _enc(sub)})
        self.assertEqual(r["modo_discagem"], {"campos": _enc(DG._SUB_MODO), "spins": _enc(DG._SUB_SPINS),
                                              "telefones": list(DG.TELEFONES_SPIN)})
        self.assertEqual(r["reciclagem_auto"], {"campos": _enc(DG._SUB_RECICLAGEM),
                                                "excluir": list(DG.EXCLUSOES_RECICLAGEM)})
        self.assertEqual(r["_chaves"], sorted(DG.PADRAO))

    def test_padrao_do_site(self):
        self.assertEqual(_json_da_funcao("discagem_padrao"), DG.padrao_site())

    def test_situacoes_e_encerra_cliente(self):
        self.assertEqual(_array_da_funcao("situacoes_resubmit_voz"), list(DG.SITUACOES))
        self.assertEqual(set(_array_da_funcao("encerra_cliente_voz")), set(DG.FINALIZA_SEMPRE))

    def test_vm_chama_as_rpcs_do_sql65_nos_dois_acessos(self):
        s = SQL65.read_text(encoding="utf-8")
        for publica, da_vm in (("regras_discagem_voz", "regras_discagem"), ("lote_voz_do_dia", "lote_do_dia"),
                               ("registrar_onda_voz", "registrar_onda"), ("pegar_reenvio_voz", "pegar_reenvio"),
                               ("concluir_reenvio_voz", "concluir_reenvio"), ("agregar_passadas_voz", "agregar_passadas"),
                               ("pegar_reciclagem_voz", "pegar_reciclagem"),
                               ("registrar_reciclagem_auto_voz", "registrar_reciclagem_auto"),
                               ("concluir_reciclagem_voz", "concluir_reciclagem")):
            self.assertEqual(A.RPC[publica], da_vm)
            self.assertIn(f"function public.{publica}(", s)
            self.assertIn(f"function voz_vm.{da_vm}(args jsonb)", s)
        self.assertEqual(A.ESCRITA["voz_resubmits"], "gravar_resubmits")
        self.assertIn("voz_resubmits", A.DEVOLVE_ID)
        self.assertEqual(B.conflito("voz_resubmits"), "empresa_id,ref")

    def test_sem_dado_pessoal_nas_colunas_novas(self):
        for c in B.COLUNAS["voz_resubmits"]:
            self.assertNotRegex(c, r"telefone|cpf|nome|numero_discado")


# ------------------------------------------------------------------ motor
class TestMotor(unittest.TestCase):
    def test_paridade_sem_as_chaves_novas(self):
        cfg, av = DG.normalizar({"tentativas_numero_dia": 3, "intervalo_min_minutos": 90})
        self.assertEqual(av, [])
        self.assertEqual((cfg["por_situacao"], cfg["falhas_tecnicas"], cfg["por_sinalizacao"], cfg["modo_discagem"],
                          cfg["reciclagem_auto"]), ({}, {}, None, None, None))
        for s in DG.SITUACOES_RENITENCIA:
            r = DG.regra_situacao(cfg, s)
            self.assertEqual((r["intervalo_minutos"], r["max_dia"], r["conta_descanso"]),
                             (15 if s == "ocupado" else 90, 3, s in V.NAO_ATENDE))
        self.assertIsNone(DG.telefones_dia(cfg))
        self.assertEqual(DG.normalizar({})[0]["tentativas_numero_dia"], 2)            # sem a regra: 2, como hoje
        for res in V.MARCA_VOZ:
            self.assertEqual(DG._marca_descanso(res, cfg), V.MARCA_VOZ[res])

    def test_renitencia_e_curtas_identicas_sem_as_chaves(self):
        hoje = date(2026, 11, 5)
        ev = [Evento("C1", tel, "telefone", "discador", r, hoje - timedelta(days=1), fornecedor="f", id_externo=f"{i}")
              for i, (tel, r) in enumerate(zip(TEL * 3, ("nao_atendida", "ocupado", "caixa_postal", "maquina",
                                                         "recusa", "falha_operadora", "promessa", "abandonada",
                                                         "desligou_sem_conversar", "nao_atendida", "opt_out",
                                                         "atendeu_desligou")))]
        base, _ = DG.normalizar({"descanso_nao_atende": {"ativo": True}})
        com, _ = DG.normalizar({"descanso_nao_atende": {"ativo": True}, "por_sinalizacao": {}})
        self.assertEqual(DG.renitencia(ev, hoje, base), DG.renitencia(ev, hoje, com))
        self.assertEqual(DG.medir(ev, hoje, base), DG.medir(ev, hoje, com))

    def test_indisponivel_e_falha_tecnica(self):
        self.assertIn("indisponivel", V.TECNICOS)
        self.assertNotIn("indisponivel", V.NAO_ATENDE)
        self.assertNotIn("indisponivel", V.MARCA_VOZ)                # nunca penaliza o número
        self.assertTrue(V.POR_CHAVE["indisponivel"].conta_tentativa)   # mas conta como tentativa do dia
        e = SimpleNamespace(resultado="indisponivel", duracao_s=None)
        cc = dict(DG.PADRAO["chamadas_curtas"])
        self.assertTrue(DG.e_curta(e, cc))
        self.assertFalse(DG.e_curta(e, {**cc, "falha_conta": False}))
        self.assertTrue(DG.e_curta(SimpleNamespace(resultado="abandonada", duracao_s=None), {**cc, "falha_conta": False}))

    def test_conta_descanso_por_situacao(self):
        hoje = date(2026, 11, 5)
        ev = [Evento("C1", TEL[0], "telefone", "discador", "nao_atendida", hoje, fornecedor="f", id_externo="1"),
              Evento("C1", TEL[0], "telefone", "discador", "desligou_sem_conversar", hoje, fornecedor="f", id_externo="2")]
        cfg, _ = DG.normalizar({"descanso_nao_atende": {"ativo": True},
                                "por_situacao": {"nao_atendida": {"conta_descanso": False},
                                                 "desligou_sem_conversar": {"conta_descanso": True}}})
        _, regs, _ = DG.renitencia(ev, hoje, cfg)
        self.assertEqual([r.marca for r in regs], ["temporario"])          # só o "desligou" conta agora

    def test_regra_por_sinalizacao(self):
        cfg, av = DG.normalizar({"por_sinalizacao": {"ocupado": {"rediscar": {"depois_min": 20, "max": 99}},
                                                     "retorno_agendado": {"finaliza": False},
                                                     "pessoa_errada": {"rediscar": {"ativo": True}}, "x": {}},
                                 "por_situacao": {"ocupado": {"intervalo_minutos": 20}}})
        self.assertEqual(len(av), 5)       # max 99, 2 travas, 'x' e intervalo_minutos (um intervalo só)
        self.assertEqual(cfg["tentativas_numero_dia"], 3)                    # regra nova: 3 por número
        self.assertEqual(cfg["por_sinalizacao"]["ocupado"]["rediscar"], {"ativo": True, "depois_min": 20, "max": 2,
                                                                         "prioridade": "topo"})
        self.assertEqual(DG.regra_situacao(cfg, "ocupado")["intervalo_minutos"], 20)   # o único intervalo
        self.assertTrue(cfg["por_sinalizacao"]["retorno_agendado"]["finaliza"])
        self.assertFalse(cfg["por_sinalizacao"]["pessoa_errada"]["rediscar"]["ativo"])
        self.assertEqual(cfg["por_sinalizacao"]["maquina"]["depois"]["acao"], "proximo_cliente")   # horizontal
        vert, _ = DG.normalizar({"por_sinalizacao": {}, "modo_discagem": {"modo": "vertical"}})
        self.assertEqual(vert["por_sinalizacao"]["maquina"]["depois"]["acao"], "proximo_telefone")
        self.assertEqual(DG.sinalizacao_de("atendida_terceiro_desconhece"), "pessoa_errada")
        self.assertEqual(DG.sinalizacao_de("falha_operadora", 402), "sem_credito")
        self.assertIsNone(DG.sinalizacao_de("cpc"))

    def test_modo_de_discagem_e_reciclagem(self):
        cfg, av = DG.normalizar({"modo_discagem": {"spins": {"quantidade": 4, "regras": [
            {"spin": 2, "telefone": "nao_tentado", "inicio": "11:00"}, {"spin": 9, "telefone": "t1"}]}},
            "reciclagem_auto": {"ativo": True, "hora": "21:00", "excluir": ["cpc", "x"]}})
        self.assertEqual(len(av), 3)
        m = cfg["modo_discagem"]
        self.assertEqual([(r["spin"], r["telefone"]) for r in m["spins"]["regras"]],
                         [(1, "t1"), (2, "nao_tentado"), (3, "t3"), (4, "t4")])     # spin N → telefone N
        self.assertEqual(DG.telefones_dia(cfg), 5)
        self.assertEqual(cfg["reciclagem_auto"]["hora"], "16:00")
        self.assertEqual(cfg["reciclagem_auto"]["excluir"], DG.RECICLAGEM_PADRAO["excluir"])
        v, _ = DG.normalizar({"modo_discagem": {"modo": "vertical", "max_telefones_dia": 2}})
        self.assertEqual(DG.telefones_dia(v), 2)


# ------------------------------------------------------------------ VM
def regras(d):
    return L.RegrasLote.da_carteira(d)


class BaseVM(Base):
    def _cair(self, causa=19, tech=None, i=-1, andar=40):
        self.rel.andar(andar)
        self.cair(self.originados()[i][2], causa, tech=tech)

    def montar_com(self, itens, d):
        orq = self.montar(itens)
        self.lote.aplicar_regras(regras(d))
        return orq


class TestVM(BaseVM):
    def test_sem_chaves_novas_sem_regras(self):
        self.assertIsNone(regras({"tentativas_numero_dia": 2, "chamadas_curtas": {"ativo": False}}))
        self.assertIsNone(regras(None))

    def test_paridade_da_retentativa(self):
        """Só o máximo por situação, com o mesmo valor do geral = mesma discagem de hoje."""
        tempos = []
        for r in (None, regras({"por_situacao": {"nao_atendida": {"max_dia": 3}}})):
            orq = self.montar([item("C1", TEL[0]), item("C2", TEL[1])])
            self.lote.aplicar_regras(r)
            orq.tick()
            self._cair(i=0)
            self._cair(i=1, andar=0)
            tempos.append((self.lote.itens[0].nao_antes_de, self.lote.itens[1].nao_antes_de,
                           self.lote.itens[0].encerrado))
            self.rel.andar(3600)
            self.assertEqual(orq.tick(), 2)
        self.assertEqual(tempos[0], tempos[1])

    def test_maximo_por_situacao(self):
        orq = self.montar_com([item("C1", TEL[0])], {"por_situacao": {"nao_atendida": {"max_dia": 1}}})
        orq.tick()
        self._cair()
        self.assertTrue(self.lote.itens[0].encerrado)

    def test_redisca_o_mesmo_telefone_e_topo_fura_as_primeiras(self):
        for pri, primeiro in (("topo", TEL[0]), ("normal", TEL[1])):
            itens = [item("C1", TEL[0]), item("C2", TEL[1], janela_local=("10:20", "20:00")),
                     item("C3", TEL[2], janela_local=("10:20", "20:00"))]
            orq = self.montar_com(itens, {"por_sinalizacao": {"ocupado": {"rediscar": {"prioridade": pri}}}})
            orq.tick()
            self._cair(17, tech=486, andar=10)                         # ocupado: redisca em 15 min
            self.assertEqual(self.lote.itens[0].volta.nao_antes_de, self.rel.t + timedelta(minutes=15))
            self.assertEqual(self.lote.decisoes[-1]["decisao"], "redisca")
            self.rel.t = D0 + timedelta(minutes=25)
            self.assertEqual(orq.tick(), 3)
            self.assertTrue(self.originados()[1][1].endswith(primeiro + "@tr-1-10"), pri)

    def test_um_intervalo_so(self):
        orq = self.montar_com([item("C1", TEL[0], intervalo_min=120)],
                              {"por_sinalizacao": {"nao_atendida": {"rediscar": {"depois_min": 10}}}})
        orq.tick()
        self._cair()
        self.assertEqual(self.lote.itens[0].volta.nao_antes_de, self.rel.t + timedelta(minutes=10))

    def test_esgotou_vai_para_o_depois(self):
        """Não atendeu 1×; depois: próximo telefone com espera (vertical)."""
        orq = self.montar_com([item("C1", TEL[0]), item("C1", TEL[1], ordem=2)],
                              {"modo_discagem": {"modo": "vertical", "max_telefones_dia": 2},
                               "por_sinalizacao": {"nao_atendida": {"rediscar": {"max": 1, "depois_min": 0},
                                                                    "depois": {"espera_min": 30}}}})
        orq.tick()
        self._cair()
        self.rel.andar(5)
        orq.tick()                                                       # a rediscagem (0 min)
        self._cair()
        self.assertEqual([d["decisao"] for d in self.lote.decisoes], ["redisca", "proximo_telefone"])
        self.assertEqual(self.lote.itens[1].nao_antes_de, self.rel.t + timedelta(minutes=30))
        self.assertEqual(orq.tick(), 0)
        self.rel.andar(30 * 60)
        self.assertEqual(orq.tick(), 1)
        self.assertTrue(self.originados()[-1][1].endswith(TEL[1] + "@tr-1-10"))

    def test_finaliza_e_fixos(self):
        orq = self.montar_com([item("C1", TEL[0]), item("C1", TEL[1], ordem=2), item("C2", TEL[2])],
                              {"modo_discagem": {"modo": "vertical", "max_telefones_dia": 2}, "por_sinalizacao": {}})
        orq.tick()
        self.lote.registrar(self.lote.itens[0], "recado", self.rel.t)    # recado finaliza (padrão)
        self.assertIn("C1", self.lote.guarda.clientes_encerrados)
        self.lote.registrar(self.lote.itens[2], "atendida_terceiro_desconhece", self.rel.t)   # pessoa errada
        self.assertTrue(self.lote.itens[2].encerrado)
        self.assertNotIn("C2", self.lote.guarda.clientes_encerrados)
        self.assertEqual(self.lote.decisoes[-1]["decisao"], "proximo_telefone")

    def test_desligou_sem_conversar_redisca_so_com_a_regra(self):
        for d, volta in ((None, False), ({"por_sinalizacao": {}}, True)):
            orq = self.montar_com([item("C1", TEL[0], intervalo_min=60)], d) if d else self.montar([item("C1", TEL[0])])
            orq.tick()
            self.lote.registrar(self.lote.itens[0], "desligou_sem_conversar", self.rel.t)
            self.assertEqual(self.lote.itens[0].volta is not None, volta)

    def test_sem_credito_alerta_e_nao_redisca(self):
        orq = self.montar_com([item("C1", TEL[0])], {"por_sinalizacao": {}})
        orq.tick()
        self._cair(tech=402)
        while not self.eventos:                     # as rotas seguintes também falham (failover) até acabar
            self.rel.andar(6)
            orq.tick()
            if self.ari.de("originar")[-1][2] != self.originados()[0][2] and len(self.originados()) > 1:
                self._cair(tech=402, andar=1)
        self.assertEqual(self.eventos[-1].desfecho, "falha_operadora")
        self.assertIsNone(self.lote.itens[0].volta)
        self.assertTrue(any("sem crédito" in a for a in orq.alertas))

    def test_horizontal_spin_n_telefone_n(self):
        itens = [item("C1", TEL[0]), item("C1", TEL[1], ordem=2), item("C2", TEL[2])]
        orq = self.montar_com(itens, {"modo_discagem": {"modo": "horizontal", "spins": {
            "quantidade": 2, "intervalo_min": 60}}, "por_sinalizacao": {"nao_atendida": {"rediscar": {"ativo": False}}}})
        self.assertEqual([(x.id_cliente, x.telefone, x.spin) for x in self.lote.itens],
                         [("C1", TEL[0], 1), ("C2", TEL[2], 1), ("C1", TEL[1], 2), ("C2", TEL[2], 2)])
        self.assertEqual(orq.tick(), 2)                                   # spin 1: um telefone por cliente
        self._cair(i=0)
        self._cair(i=1, andar=0)
        self.assertEqual(orq.tick(), 0)                                   # o spin 2 abre depois do intervalo
        self.rel.andar(59 * 60)
        self.assertEqual(orq.tick(), 0)
        self.rel.andar(61)
        self.assertEqual(orq.tick(), 2)
        self.assertTrue(any(c[1].endswith(TEL[1] + "@tr-1-10") for c in self.originados()[-2:]))   # spin 2 → tel 2

    def test_reenviar_agora(self):
        orq = self.montar([item("C1", TEL[0]), item("C2", TEL[1]), item("C3", TEL[2])])
        orq.tick()
        for i in range(3):
            self._cair(i=i, andar=0 if i else 40)
        self.lote.guarda.extra = lambda it, agora: "pediu para não ligar" if it.id_cliente == "C3" else None
        c = self.lote.reenviar(["nao_atendida"], [], "topo", False, 7, self.rel.t)
        self.assertEqual((c["volta"], c["fora"]), (2, {"nao_ligar": 1}))
        self.assertTrue(all(d["origem"] == "manual" and d["pedido_id"] == 7 for d in self.lote.decisoes))
        self.assertEqual(self.lote.itens[0].volta.prioridade, "topo")

    def test_reciclar(self):
        orq = self.montar_com([item("C1", TEL[0]), item("C2", TEL[1]), item("C3", TEL[2])],
                              {"tentativas_numero_dia": 1, "por_sinalizacao": {"nao_atendida": {"rediscar": {"ativo": False}}}})
        orq.tick()
        self._cair(i=0)
        self.lote.registrar(self.lote.itens[1], "recusa", self.rel.t)
        self.lote.registrar(self.lote.itens[2], "opt_out", self.rel.t)
        mant = self.lote.reciclar([], [], ["recusa"], "mantem", 5, self.rel.t)
        self.assertEqual(mant, {"volta": 0, "fora": {"max_dia": 1, "recusa": 1, "nao_ligar": 1}})
        rec = self.lote.reciclar([], [], ["recusa"], "recomeca", 6, self.rel.t)
        self.assertEqual(rec["volta"], 1)
        self.assertEqual(self.lote.itens[0].tentativas, 0)
        self.assertTrue(any(d["origem"] == "reciclagem" and d["reciclagem_id"] == 6 for d in self.lote.decisoes))
        self.rel.andar(5)
        self.assertEqual(orq.tick(), 1)

    def test_eventos_levam_passada_hash_e_nunca_o_telefone_no_banco(self):
        orq = self.montar_com([item("C1", TEL[0])], {"por_sinalizacao": {"nao_atendida": {"rediscar": {"depois_min": 0}}}})
        self.lote.lote_id = 50
        orq.tick()
        self._cair()
        self.rel.andar(5)
        orq.tick()
        self._cair()
        e1, e2 = self.eventos
        self.assertEqual((e1.passada, e1.situacao_origem, e2.passada, e2.situacao_origem),
                         (1, None, 2, "nao_atendida"))
        self.assertEqual(e2.resubmit_ref, self.lote.decisoes[0]["ref"])
        from voz.orquestrador.eventos import CAMPOS, para_voz_chamadas
        self.assertNotIn("onda_chave", CAMPOS)
        linha = para_voz_chamadas(e2)
        self.assertEqual((linha["lote_id"], linha["destino_hash"]), (50, L.hash_destino(TEL[0])))
        self.assertNotIn(TEL[0], json.dumps(linha, default=str))
        self.assertNotIn(TEL[0], json.dumps(self.lote.decisoes, default=str))


# ------------------------------------------------------------------ registro: decisões antes das chamadas
class SbFalso:
    def __init__(self, falhar=()):
        self.inseridos, self.rpcs, self.falhar = [], [], set(falhar)

    def inserir(self, tabela, linhas, conflito=None, retornar=False):
        if tabela in self.falhar:
            raise OSError("fora")
        self.inseridos.append((tabela, [dict(l) for l in linhas]))
        return [{"id": 100 + i} for i, _ in enumerate(linhas)] if retornar else []

    def rpc(self, f, args=None):
        self.rpcs.append((f, args))
        return {"lote_voz_do_dia": 50, "registrar_onda_voz": 70}.get(f)


class TestRegistro(BaseVM):
    def test_decisao_antes_da_chamada_e_ids_resolvidos(self):
        orq = self.montar_com([item("C1", TEL[0])], {"por_sinalizacao": {"nao_atendida": {"rediscar": {"depois_min": 0}}}})
        sb = SbFalso()
        reg = RegistroBanco(sb)
        self.lote.lote_id = reg.lote_do_dia(1, None, D0.date(), 1)
        orq.tick()
        self._cair()
        self.rel.andar(5)
        orq.tick()
        self._cair()
        for ev in self.eventos:
            reg.registrar(ev)
        reg.sincronizar([self.lote])
        reg.descarregar()
        self.assertEqual([t for t, _ in sb.inseridos][:2], ["voz_resubmits", "voz_chamadas"])
        chamadas = sb.inseridos[1][1]
        self.assertEqual([c["resubmit_id"] for c in chamadas], [None, 100])
        self.assertEqual({c["onda_id"] for c in chamadas}, {70})
        self.assertEqual(len({tuple(sorted(c)) for c in chamadas}), 1)      # mesmas chaves em todas (PostgREST)
        self.assertTrue(all("_ref" not in c for c in chamadas))

    def test_falha_nas_decisoes_segura_as_chamadas(self):
        orq = self.montar_com([item("C1", TEL[0])], {"por_sinalizacao": {}})
        sb = SbFalso(falhar={"voz_resubmits"})
        reg = RegistroBanco(sb)
        self.lote.lote_id = 50
        orq.tick()
        self._cair()
        reg.registrar(self.eventos[0])
        reg.sincronizar([self.lote])
        self.assertEqual(reg.descarregar(), 0)
        self.assertEqual((len(reg.fila), len(reg.fila_resubmits)), (1, 1))


if __name__ == "__main__":
    unittest.main()
