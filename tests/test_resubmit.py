"""Renitência por situação, Resubmit, Reenviar agora e contato por passada (SQL 65; protótipo aprovado em 01/11/2026).

Paridade: carteira sem as chaves novas = o motor e a VM de hoje. Depois, as regras novas: intervalo e máximo por
situação, conta no descanso, falha técnica como curta, voltas do Resubmit (maior entre "depois de" e o intervalo,
máximo, horário limite, prioridade topo furando as 1ªs tentativas, outro número), o log de decisões (só destino_hash)
e o "Reenviar agora". Também confere que o SQL 65 diz o mesmo que o motor. Só dados fictícios."""
import json
import re
import unittest
from datetime import date, datetime, timedelta
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
        self.assertEqual(r["_blocos"], {k: {kk: _enc(vv) for kk, vv in s.items()} for k, s in DG._SUB.items()})
        for bloco, chaves, sub in (("por_situacao", DG.SITUACOES_RENITENCIA, DG._SUB_SITUACAO),
                                   ("falhas_tecnicas", DG.FALHAS_TECNICAS, DG._SUB_FALHA),
                                   ("resubmit", DG.SITUACOES_RESUBMIT, DG._SUB_RESUBMIT)):
            self.assertEqual(r[bloco], {"chaves": list(chaves), "campos": {k: _enc(v) for k, v in sub.items()}})
        self.assertEqual(r["_chaves"], sorted(DG.PADRAO))

    def test_padrao_do_site(self):
        self.assertEqual(_json_da_funcao("discagem_padrao"), DG.padrao_site())

    def test_situacoes_e_encerra_cliente(self):
        self.assertEqual(_array_da_funcao("situacoes_resubmit_voz"), list(DG.SITUACOES_RESUBMIT))
        self.assertEqual(set(_array_da_funcao("encerra_cliente_voz")), set(L.ENCERRA_CLIENTE - L.REABRIVEIS))

    def test_vm_chama_as_rpcs_do_sql65_nos_dois_acessos(self):
        s = SQL65.read_text(encoding="utf-8")
        for publica, da_vm in (("regras_discagem_voz", "regras_discagem"), ("lote_voz_do_dia", "lote_do_dia"),
                               ("registrar_onda_voz", "registrar_onda"), ("pegar_reenvio_voz", "pegar_reenvio"),
                               ("concluir_reenvio_voz", "concluir_reenvio"), ("agregar_passadas_voz", "agregar_passadas")):
            self.assertEqual(A.RPC[publica], da_vm)
            self.assertIn(f"function public.{publica}(", s)
            self.assertIn(f"function voz_vm.{da_vm}(args jsonb)", s)
        self.assertEqual(A.ESCRITA["voz_resubmits"], "gravar_resubmits")
        self.assertIn("voz_resubmits", A.DEVOLVE_ID)
        self.assertEqual(B.conflito("voz_resubmits"), "empresa_id,ref")

    def test_sem_dado_pessoal_nas_colunas_novas(self):
        for t in ("voz_resubmits",):
            for c in B.COLUNAS[t]:
                self.assertNotRegex(c, r"telefone|cpf|nome|numero_discado")


# ------------------------------------------------------------------ motor
class TestMotor(unittest.TestCase):
    def test_paridade_sem_as_chaves_novas(self):
        cfg, av = DG.normalizar({"tentativas_numero_dia": 3, "intervalo_min_minutos": 90})
        self.assertEqual(av, [])
        self.assertEqual((cfg["por_situacao"], cfg["falhas_tecnicas"], cfg["resubmit"]), ({}, {}, None))
        for s in DG.SITUACOES_RENITENCIA:
            r = DG.regra_situacao(cfg, s)
            self.assertEqual(r["intervalo_minutos"], 15 if s == "ocupado" else 90)
            self.assertEqual(r["max_dia"], 3)
            self.assertEqual(r["conta_descanso"], s in V.NAO_ATENDE)
        for s in DG.FALHAS_TECNICAS:
            self.assertEqual(DG.regra_situacao(cfg, s)["intervalo_minutos"], 90)     # falha religa pelo geral
        self.assertIsNone(DG.resubmit_efetivo(cfg, "nao_atendida"))
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
        com, _ = DG.normalizar({"descanso_nao_atende": {"ativo": True}, "resubmit": {}})
        self.assertEqual(DG.renitencia(ev, hoje, base), DG.renitencia(ev, hoje, com))
        self.assertEqual(DG.medir(ev, hoje, base), DG.medir(ev, hoje, com))

    def test_indisponivel_e_falha_tecnica(self):
        self.assertIn("indisponivel", V.TECNICOS)
        self.assertNotIn("indisponivel", V.NAO_ATENDE)
        self.assertNotIn("indisponivel", V.MARCA_VOZ)              # nunca penaliza o número
        self.assertTrue(V.POR_CHAVE["indisponivel"].conta_tentativa)  # mas conta como tentativa do dia
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

    def test_normalizar_e_valores(self):
        cfg, av = DG.normalizar({"por_situacao": {"ocupado": {"intervalo_minutos": 20, "max_dia": 1}, "x": {}},
                                 "falhas_tecnicas": {"falha_operadora": {"religar_minutos": 30, "aviso": 15}},
                                 "resubmit": {"ocupado": {"depois_minutos": 5, "prioridade": "fim"},
                                              "retorno_agendado": {"ativo": False, "max_dia": 9},
                                              "nao_atendida": {"max_dia": 99}}})
        self.assertEqual(len(av), 2)                                     # 'x' e max_dia 99
        self.assertEqual(cfg["falhas_tecnicas"]["falha_operadora"], {"religar_minutos": 30, "aviso": 0.15})
        r = DG.resubmit_efetivo(cfg, "ocupado")
        self.assertEqual((r["depois_minutos"], r["depois_efetivo"], r["prioridade"]), (5, 20, "fim"))   # vale o maior
        self.assertEqual(r["cabe"], 0)                                   # máx. 1 no ocupado: não sobra volta
        self.assertEqual(cfg["resubmit"]["retorno_agendado"]["ativo"], True)                            # travado
        self.assertEqual(cfg["resubmit"]["nao_atendida"]["max_dia"], 2)                                  # padrão
        self.assertEqual(DG.situacao_de("falha_operadora", 402), "sem_credito")
        self.assertEqual(DG.situacao_de("atendida_terceiro_desconhece"), "numero_incorreto")
        self.assertIsNone(DG.situacao_de("cpc"))


# ------------------------------------------------------------------ VM
def regras(d):
    return L.RegrasLote.da_carteira(d)


class BaseVM(Base):
    def _nao_atendeu(self, i=-1):
        self.rel.andar(40)
        self.cair(self.originados()[i][2], 19)


class TestVM(BaseVM):
    def test_sem_chaves_novas_sem_regras(self):
        self.assertIsNone(regras({"tentativas_numero_dia": 2, "chamadas_curtas": {"ativo": False}}))
        self.assertIsNone(regras(None))

    def test_paridade_da_retentativa(self):
        """Por situação com os mesmos valores do geral = mesma discagem de hoje."""
        tempos = []
        for r in (None, regras({"por_situacao": {"nao_atendida": {"intervalo_minutos": 60, "max_dia": 3}}})):
            orq = self.montar([item("C1", TEL[0]), item("C2", TEL[1])])
            self.lote.aplicar_regras(r)
            orq.tick()
            self._nao_atendeu(0)
            self._nao_atendeu(1)
            tempos.append((self.lote.itens[0].nao_antes_de, self.lote.itens[1].nao_antes_de,
                           self.lote.itens[0].encerrado))
            self.rel.andar(3600)
            self.assertEqual(orq.tick(), 2)
        self.assertEqual(tempos[0], tempos[1])

    def test_intervalo_e_maximo_por_situacao(self):
        orq = self.montar([item("C1", TEL[0])])
        self.lote.aplicar_regras(regras({"por_situacao": {"nao_atendida": {"intervalo_minutos": 30, "max_dia": 1}}}))
        orq.tick()
        self._nao_atendeu()
        self.assertTrue(self.lote.itens[0].encerrado)                    # máx. 1 no dia para "não atendeu"

    def test_topo_fura_as_primeiras_e_normal_vem_depois(self):
        for pri, primeiro in (("topo", TEL[0]), ("normal", TEL[1])):
            itens = [item("C1", TEL[0]), item("C2", TEL[1], janela_local=("10:20", "20:00")),
                     item("C3", TEL[2], janela_local=("10:20", "20:00"))]
            orq = self.montar(itens)
            self.lote.aplicar_regras(regras({"resubmit": {"ocupado": {"prioridade": pri}}}))
            orq.tick()
            self.rel.andar(10)
            self.cair(self.originados()[0][2], 17, tech=486)              # ocupado
            self.assertEqual(self.lote.itens[0].volta.nao_antes_de, self.rel.t + timedelta(minutes=15))
            self.rel.t = D0 + timedelta(minutes=25)
            self.assertEqual(orq.tick(), 3)
            self.assertTrue(self.originados()[1][1].endswith(primeiro + "@tr-1-10"), pri)

    def test_vale_o_maior_entre_depois_de_e_o_intervalo(self):
        orq = self.montar([item("C1", TEL[0], intervalo_min=120)])
        self.lote.aplicar_regras(regras({"resubmit": {"nao_atendida": {"depois_minutos": 10}}}))
        orq.tick()
        self._nao_atendeu()
        self.assertEqual(self.lote.itens[0].volta.nao_antes_de, self.rel.t + timedelta(minutes=120))
        self.rel.andar(119 * 60)
        self.assertEqual(orq.tick(), 0)
        self.rel.andar(61)
        self.assertEqual(orq.tick(), 1)

    def test_sem_volta_desativada_e_fora_por_max_e_horario(self):
        orq = self.montar([item("C1", TEL[0]), item("C2", TEL[1])])
        self.lote.aplicar_regras(regras({"tentativas_numero_dia": 3,
                                         "resubmit": {"nao_atendida": {"max_dia": 1, "depois_minutos": 0},
                                                      "maquina": {"ativo": False}}}))
        orq.tick()
        self._nao_atendeu(0)
        self.rel.andar(10)
        self.atender(self.originados()[1][2], amd="MACHINE", causa="LONGGREETING")
        self.cair(self.originados()[1][2], 16)
        self.assertIsNone(self.lote.itens[1].volta)
        self.assertEqual(self.lote.contar_motivos(self.rel.t).get("sem volta agendada"), 1)
        self.rel.andar(121 * 60)
        self.assertEqual(orq.tick(), 1)                                  # a volta do C1
        self._nao_atendeu()
        dec = [d for d in self.lote.decisoes if d["id_cliente"] == "C1"]
        self.assertEqual([(d["decisao"], d["motivo_fora"]) for d in dec], [("volta", None), ("fora", "max_dia")])
        self.assertEqual(dec[0]["destino_hash"], L.hash_destino(TEL[0]))
        self.assertNotIn(TEL[0], json.dumps(self.lote.decisoes, default=str))   # nunca o telefone
        orq2 = self.montar([item("C1", TEL[0], janela_local=("08:00", "11:00"))])
        self.lote.aplicar_regras(regras({"resubmit": {}}))
        orq2.tick()
        self._nao_atendeu()
        self.assertEqual(self.lote.decisoes[-1]["motivo_fora"], "fora_horario")

    def test_outro_numero_e_numero_incorreto(self):
        orq = self.montar([item("C1", TEL[0]), item("C1", TEL[1], ordem=2)])
        self.lote.aplicar_regras(regras({"resubmit": {"numero_incorreto": {"ativo": True, "depois_minutos": 0},
                                                      "nao_atendida": {"ativo": False}}}))
        orq.tick()
        self._nao_atendeu()                                               # nº 1: não atendeu, sem volta
        self.rel.andar(5)
        self.assertEqual(orq.tick(), 1)                                   # nº 2 na 1ª passada
        self.cair(self.originados()[-1][2], 1, tech=404)                  # inexistente
        d = self.lote.decisoes[-1]
        self.assertEqual((d["situacao_origem"], d["decisao"]), ("numero_incorreto", "volta"))
        self.assertEqual(d["destino_hash"], L.hash_destino(TEL[0]))       # a volta vai para o outro número
        self.assertTrue(self.lote.itens[1].encerrado)

    def test_desligou_sem_conversar_reabre_so_com_resubmit(self):
        for res, volta in ((None, False), ({}, True)):
            orq = self.montar([item("C1", TEL[0], intervalo_min=60)])
            self.lote.aplicar_regras(regras({"resubmit": res}) if res is not None else None)
            orq.tick()
            self.rel.andar(10)
            self.atender(self.originados()[0][2])
            self.rel.andar(2)
            self.lote.registrar(self.lote.itens[0], "desligou_sem_conversar", self.rel.t)
            self.assertEqual(self.lote.itens[0].volta is not None, volta)
            self.rel.andar(91 * 60)
            self.assertEqual(self.lote.guarda.motivo(self.lote.itens[0], self.rel.t) is None, volta)

    def test_reenviar_agora(self):
        orq = self.montar([item("C1", TEL[0]), item("C2", TEL[1]), item("C3", TEL[2])])
        orq.tick()
        for i in range(3):
            self._nao_atendeu(i)
        self.lote.guarda.extra = lambda it, agora: "pediu para não ligar" if it.id_cliente == "C3" else None
        c = self.lote.reenviar(["nao_atendida"], [], "topo", False, 7, self.rel.t)
        self.assertEqual((c["volta"], c["fora"]), (2, {"nao_ligar": 1}))
        dec = [d for d in self.lote.decisoes if d["pedido_id"] == 7]
        self.assertTrue(all(d["origem"] == "manual" for d in dec))
        self.assertEqual(self.lote.itens[0].volta.prioridade, "topo")
        self.assertEqual(self.lote.reenviar(["maquina"], [], "normal", False, 8, self.rel.t)["volta"], 0)

    def test_eventos_levam_passada_hash_e_nunca_o_telefone_no_banco(self):
        orq = self.montar([item("C1", TEL[0])])
        self.lote.aplicar_regras(regras({"resubmit": {"nao_atendida": {"depois_minutos": 0}}}))
        self.lote.lote_id = 50
        orq.tick()
        self._nao_atendeu()
        self.rel.andar(121 * 60)
        orq.tick()
        self._nao_atendeu()
        e1, e2 = self.eventos
        self.assertEqual((e1.passada, e1.situacao_origem, e2.passada, e2.situacao_origem),
                         (1, None, 2, "nao_atendida"))
        self.assertEqual(e2.resubmit_ref, self.lote.decisoes[0]["ref"])
        from voz.orquestrador.eventos import CAMPOS, para_voz_chamadas
        self.assertNotIn("onda_chave", CAMPOS)
        linha = para_voz_chamadas(e2)
        self.assertEqual((linha["lote_id"], linha["destino_hash"]), (50, L.hash_destino(TEL[0])))
        self.assertNotIn(TEL[0], json.dumps(linha, default=str))


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
        orq = self.montar([item("C1", TEL[0])])
        self.lote.aplicar_regras(regras({"resubmit": {"nao_atendida": {"depois_minutos": 0}}}))
        sb = SbFalso()
        reg = RegistroBanco(sb)
        self.lote.lote_id = reg.lote_do_dia(1, None, D0.date(), 1)
        orq.tick()
        self._nao_atendeu()
        self.rel.andar(121 * 60)
        orq.tick()
        self._nao_atendeu()
        for ev in self.eventos:
            reg.registrar(ev)
        reg.sincronizar([self.lote])
        reg.descarregar()
        tabelas = [t for t, _ in sb.inseridos]
        self.assertEqual(tabelas[:2], ["voz_resubmits", "voz_chamadas"])
        chamadas = sb.inseridos[1][1]
        self.assertEqual([c["resubmit_id"] for c in chamadas], [None, 100])
        self.assertEqual({c["onda_id"] for c in chamadas}, {70})
        self.assertEqual(len({tuple(sorted(c)) for c in chamadas}), 1)     # mesmas chaves em todas (PostgREST)
        self.assertTrue(all("_ref" not in c for c in chamadas))

    def test_falha_nas_decisoes_segura_as_chamadas(self):
        orq = self.montar([item("C1", TEL[0])])
        self.lote.aplicar_regras(regras({"resubmit": {}}))
        sb = SbFalso(falhar={"voz_resubmits"})
        reg = RegistroBanco(sb)
        self.lote.lote_id = 50
        orq.tick()
        self._nao_atendeu()
        reg.registrar(self.eventos[0])
        reg.sincronizar([self.lote])
        self.assertEqual(reg.descarregar(), 0)
        self.assertEqual((len(reg.fila), len(reg.fila_resubmits)), (1, 1))


if __name__ == "__main__":
    unittest.main()
