"""Proteção do número inexistente (decisão do dono, 31/10/2026): só a voz, reteste antes do definitivo, trava de
lote e sinal para os canais de mensagem. Só dados fictícios."""
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from motor import discagem as DG
from motor.certificacao import Evento, certificar_contatos, nota_contatos
from motor.fila import candidatos
from motor.marcacao import EstadoCliente
from motor.regua import carregar_regua
from motor.retorno_canal import Registro

D0 = date(2026, 10, 20)
HOJE = date(2026, 10, 31)
SP, OUTRO = "11988880001", "11988880002"
CFG = DG.normalizar({"inexistente": {"so_voz_desde": "2026-01-01"}})[0]


def _ev(idc, contato, resultado, dia, n=0, origem="disc.csv", forn="discadora", canal="discador"):
    return Evento(idc, contato, "telefone", canal, resultado, dia, fornecedor=forn, id_externo=f"{idc}{contato}{dia}{n}",
                  origem=origem)


def _cfg(**inex):
    return DG.normalizar({"inexistente": {"so_voz_desde": "2026-01-01", **inex}})[0]


def _prot(evs, hoje=HOJE, cfg=CFG):
    return DG.protecao_inexistente(evs, hoje, cfg)


def _certs(evs, prot, hoje=HOJE):
    certs = certificar_contatos(evs, hoje, [{"id_cliente": "C1", "contato": c, "tipo": "telefone"} for c in (SP, OUTRO)])
    return DG.aplicar_restricoes_voz(certs, prot.restricoes)


class TestConfig(unittest.TestCase):
    def test_padrao_ligado_e_nunca_nulo(self):
        i = DG.normalizar(None)[0]["inexistente"]
        self.assertEqual(i["so_voz_desde"], "2026-11-01")
        self.assertEqual((i["ativo"], i["modo"], i["confirmacoes"], i["reteste_dias"], i["max_retestes"]),
                         (True, "so_voz", 2, 7, 3))
        self.assertEqual((i["trava_lote_ativo"], i["trava_lote_minimo"], i["trava_lote_fracao"],
                          i["trava_lote_relativa"], i["trava_lote_pp_min"], i["trava_rota_minimo"]),
                         (True, 200, 0.3, 2.0, 0.1, 50))
        self.assertTrue(all(v is not None for v in i.values()))
        self.assertEqual(carregar_regua().dados["discagem"]["inexistente"], i)      # regua.json diz o mesmo

    def test_credor_tolerante(self):
        cfg, av = DG.normalizar({"inexistente": {"modo": "tudo", "confirmacoes": 0, "trava_lote_fracao": "45%"}})
        self.assertEqual(cfg["inexistente"]["modo"], "so_voz")
        self.assertEqual(cfg["inexistente"]["confirmacoes"], 2)
        self.assertEqual(len(av), 3)                                   # "45%" também não é número: avisa
        self.assertEqual(cfg["inexistente"]["trava_lote_fracao"], 0.3)
        cfg, _ = DG.normalizar({"inexistente": {"trava_lote_fracao": 45, "trava_lote_relativa": "2,5"}})
        self.assertEqual((cfg["inexistente"]["trava_lote_fracao"], cfg["inexistente"]["trava_lote_relativa"]),
                         (0.45, 2.5))
        cfg, av = DG.normalizar({"inexistente": {"so_voz_desde": "01/10/2026"}})
        self.assertEqual((cfg["inexistente"]["so_voz_desde"], av), ("2026-10-01", []))
        cfg, av = DG.normalizar({"inexistente": {"so_voz_desde": "ontem"}})
        self.assertEqual((cfg["inexistente"]["so_voz_desde"], len(av)), ("2026-11-01", 1))
        cfg, _ = DG.normalizar({"inexistente": False})                     # forma antiga
        self.assertFalse(cfg["inexistente"]["ativo"])
        self.assertEqual(cfg["inexistente"]["modo"], "so_voz")


class TestSoVoz(unittest.TestCase):
    def test_um_inexistente_so_quarentena_da_voz(self):
        evs = [_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=2))]
        ev2, p = _prot(evs)
        self.assertEqual(ev2[0].resultado, "inexistente_voz")
        self.assertEqual(p.restricoes[("C1", SP)], {"discador:suspenso", "agente_voz:suspenso"})
        self.assertEqual((p.resumo["quarentena"], p.resumo["encerrados"]), (1, 0))
        c = _certs(ev2, p)[("C1", SP)]
        self.assertNotEqual(c.status, "INVALIDO")                   # não invalida o número
        self.assertGreater(c.score, 0)
        self.assertFalse(any(r.split(":")[0] in ("sms", "rcs", "whatsapp") for r in c.restricoes))
        # fila: o número sai da voz e continua no WhatsApp e no SMS
        regua = carregar_regua()
        est = EstadoCliente("C1", D0, "M1", "M1", "2026-10")
        cands = candidatos(est, "M1", list(_certs(ev2, p).values()), {SP: {"whatsapp_valido": True}}, regua, False)
        self.assertNotIn(SP, [x.contato for x in cands.get("discador", [])])
        self.assertIn(OUTRO, [x.contato for x in cands.get("discador", [])])
        self.assertIn(SP, [x.contato for x in cands.get("whatsapp", [])])
        self.assertIn(SP, [x.contato for x in cands.get("sms", [])])

    def test_quarentena_acaba_no_reteste(self):
        _, p = _prot([_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=7))])
        self.assertNotIn(("C1", SP), p.restricoes)                  # D+7: volta para o reteste
        self.assertEqual(p.resumo["em_reteste"], 1)

    def test_duas_confirmacoes_em_dias_diferentes_encerram_so_a_voz(self):
        evs = [_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=9)),
               _ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=1))]
        ev2, p = _prot(evs)
        self.assertEqual(p.restricoes[("C1", SP)], {"discador:inexistente", "agente_voz:inexistente"})
        self.assertEqual(p.resumo["encerrados"], 1)
        c = _certs(ev2, p)[("C1", SP)]
        self.assertNotEqual(c.status, "INVALIDO")
        self.assertFalse(any(r.split(":")[0] in ("sms", "rcs", "whatsapp") for r in c.restricoes))

    def test_duas_no_mesmo_dia_contam_uma(self):
        d = HOJE - timedelta(days=1)
        _, p = _prot([_ev("C1", SP, "numero_inexistente", d, n=1), _ev("C1", SP, "numero_inexistente", d, n=2)])
        self.assertEqual(p.restricoes[("C1", SP)], {"discador:suspenso", "agente_voz:suspenso"})

    def test_uma_confirmacao_basta_se_configurado(self):
        _, p = _prot([_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=1))], cfg=_cfg(confirmacoes=1))
        self.assertEqual(p.restricoes[("C1", SP)], {"discador:inexistente", "agente_voz:inexistente"})

    def test_prova_de_existencia_zera(self):
        evs = [_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=10)),
               _ev("C1", SP, "caixa_postal", HOJE - timedelta(days=3)),
               _ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=2))]
        _, p = _prot(evs)
        self.assertEqual(p.restricoes[("C1", SP)], {"discador:suspenso", "agente_voz:suspenso"})   # recomeçou

    def test_reteste_sem_conclusao_renova_e_esgota_sem_encerrar(self):
        d = HOJE - timedelta(days=30)
        evs = [_ev("C1", SP, "numero_inexistente", d)]
        _, p = _prot(evs + [_ev("C1", SP, "nao_atendida", d + timedelta(days=7))])
        self.assertNotIn(("C1", SP), p.restricoes)                  # renovada até D+14, que já passou: novo reteste
        self.assertEqual(p.resumo["em_reteste"], 1)
        _, p = _prot(evs + [_ev("C1", SP, "nao_atendida", HOJE - timedelta(days=2))])
        self.assertEqual(p.restricoes[("C1", SP)], {"discador:suspenso", "agente_voz:suspenso"})   # renovada
        evs += [_ev("C1", SP, "falha_rede", d + timedelta(days=k), n=k) for k in (7, 14, 21)]
        _, p = _prot(evs)
        self.assertEqual(p.restricoes[("C1", SP)], {"discador:suspenso", "agente_voz:suspenso"})
        self.assertEqual(p.resumo["sem_confirmacao"], 1)
        self.assertTrue(any("sem confirmação" in a for a in p.alertas))
        # não atende durante a quarentena não conta como reteste
        _, p = _prot([_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=3)),
                      _ev("C1", SP, "nao_atendida", HOJE - timedelta(days=1))])
        self.assertEqual(p.resumo["quarentena"], 1)

    def test_ciclo_de_um_dia_passado(self):
        """A rotina reprocessa dias em aberto: o estado é o daquele dia, não o de hoje."""
        d = HOJE - timedelta(days=10)
        ev2, p = _prot([_ev("C1", SP, "numero_inexistente", d)])
        self.assertNotIn(("C1", SP), p.restricoes)                  # hoje: quarentena já acabou (D+7)
        self.assertEqual(DG.ciclo_inexistente(ev2, d + timedelta(days=3), p.cfg)[0][("C1", SP)],
                         {"discador:suspenso", "agente_voz:suspenso"})
        self.assertEqual(DG.ciclo_inexistente(ev2, d - timedelta(days=1), p.cfg)[0], {})

    def test_sem_numero_nao_restringe(self):
        ev2, p = _prot([_ev("C1", "", "numero_inexistente", HOJE - timedelta(days=1))])
        self.assertEqual(ev2[0].resultado, "inexistente_voz")
        self.assertEqual(p.restricoes, {})

    def test_modo_invalida_e_a_regra_antiga(self):
        evs = [_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=1))]
        ev2, p = _prot(evs, cfg=_cfg(modo="invalida"))
        self.assertEqual(ev2[0].resultado, "numero_inexistente")
        self.assertEqual(p.restricoes, {})
        self.assertEqual(_certs(ev2, p)[("C1", SP)].status, "INVALIDO")

    def test_desligado_nao_faz_nada(self):
        evs = [_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=1))]
        ev2, p = _prot(evs, cfg=_cfg(ativo=False))
        self.assertIs(ev2, evs)
        self.assertEqual((p.restricoes, p.alertas), ({}, []))

    def test_retorno_de_canal_nao_entra(self):
        e = Evento("C1", SP, "telefone", "discador", "numero_inexistente", HOJE, fornecedor="canal:voz")
        ev2, p = _prot([e])
        self.assertEqual(ev2[0].resultado, "numero_inexistente")


class TestVigencia(unittest.TestCase):
    def test_antes_da_vigencia_fica_como_estava(self):
        """Número já inválido pela regra antiga continua inválido; o credor reavalia pondo uma data anterior."""
        evs = [_ev("C1", SP, "numero_inexistente", date(2026, 10, 25))]
        cfg = DG.normalizar(None)[0]                                      # vigência padrão: 01/11/2026
        ev2, p = DG.protecao_inexistente(evs, date(2026, 11, 3), cfg)
        self.assertEqual(ev2[0].resultado, "numero_inexistente")
        self.assertEqual(p.resumo["anteriores_regra_antiga"], 1)
        self.assertEqual(certificar_contatos(ev2, date(2026, 11, 3))[("C1", SP)].status, "INVALIDO")
        # depois da vigência: regra nova
        ev3, p = DG.protecao_inexistente(evs + [_ev("C1", OUTRO, "numero_inexistente", date(2026, 11, 2))],
                                         date(2026, 11, 3), cfg)
        self.assertEqual([e.resultado for e in ev3], ["numero_inexistente", "inexistente_voz"])
        # reavaliar os antigos: data anterior
        ev4, p = DG.protecao_inexistente(evs, date(2026, 11, 3), _cfg(so_voz_desde="2026-10-01"))
        self.assertEqual(ev4[0].resultado, "inexistente_voz")
        self.assertEqual(p.resumo["anteriores_regra_antiga"], 0)

    def test_trava_de_lote_nao_reabre_o_passado(self):
        evs = TestTravaLote._arquivo(date(2026, 10, 25), 300, 210)
        ev2, p = DG.protecao_inexistente(evs, date(2026, 11, 3), DG.normalizar(None)[0])
        self.assertEqual(p.resumo["lotes_travados"], [])
        self.assertEqual(sum(e.resultado == "numero_inexistente" for e in ev2), 210)


class TestChega(unittest.TestCase):
    def test_sinal_reduz_o_chega_das_mensagens_e_a_entrega_devolve(self):
        evs = [_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=2))]
        ev2, p = _prot(evs)
        self.assertEqual(p.sinais, [(SP, HOJE - timedelta(days=2))])
        certs = _certs(ev2, p)
        base = [Registro(OUTRO, "sms", "entregue", HOJE - timedelta(days=5), "a")]
        sem = nota_contatos(ev2, certs, HOJE, base)
        com = nota_contatos(ev2, certs, HOJE, base, sinais_voz=p.sinais)
        for canal in ("sms", "rcs", "whatsapp"):
            self.assertLess(com.chega(SP, canal), sem.chega(SP, canal), canal)
        self.assertEqual(com.chega(OUTRO, "sms"), sem.chega(OUTRO, "sms"))
        self.assertEqual(com.chega(SP, "discador"), sem.chega(SP, "discador"))      # voz não usa o sinal
        volta = nota_contatos(ev2, certs, HOJE, base + [Registro(SP, "sms", "entregue", HOJE - timedelta(days=1), "b")],
                              sinais_voz=p.sinais)
        self.assertGreater(volta.chega(SP, "sms"), com.chega(SP, "sms"))

    def test_sinal_desligado(self):
        _, p = _prot([_ev("C1", SP, "numero_inexistente", HOJE - timedelta(days=2))],
                     cfg=_cfg(sinal_outros_canais=False))
        self.assertEqual(p.sinais, [])


class TestTravaLote(unittest.TestCase):
    @staticmethod
    def _arquivo(dia, n, inex, origem="lote.csv", rota=None):
        return [_ev(f"C{i}", f"119{i:08d}", "numero_inexistente" if i < inex else "nao_atendida", dia, origem=origem)
                for i in range(n)]

    def test_pico_nao_invalida_e_alerta(self):
        ev2, p = _prot(self._arquivo(HOJE - timedelta(days=1), 300, 210))
        self.assertFalse(any(e.resultado in ("numero_inexistente", "inexistente_voz") for e in ev2))
        self.assertEqual(p.restricoes, {})
        self.assertEqual(p.resumo["confirmacoes_travadas"], 210)
        self.assertEqual(p.resumo["lotes_travados"][0]["chamadas"], 300)
        self.assertTrue(any(a.startswith("DISCAGEM: suspeita de falha da operadora") for a in p.alertas))
        # o mesmo pico no modo antigo também não invalida
        ev3, _ = _prot(self._arquivo(HOJE - timedelta(days=1), 300, 210), cfg=_cfg(modo="invalida"))
        certs = certificar_contatos(ev3, HOJE)
        self.assertFalse(any(c.status == "INVALIDO" for c in certs.values()))

    def test_abaixo_do_minimo_nao_trava(self):
        ev2, p = _prot(self._arquivo(HOJE - timedelta(days=1), 150, 105))
        self.assertEqual(p.resumo["lotes_travados"], [])
        self.assertEqual(sum(e.resultado == "inexistente_voz" for e in ev2), 105)
        self.assertEqual(p.resumo["quarentena"], 105)                 # cada número só na 1ª confirmação

    def test_relativa_a_mediana_de_14_dias(self):
        hist = []
        for k in range(2, 9):
            hist += self._arquivo(HOJE - timedelta(days=k), 200, 20, origem=f"d{k}.csv")      # mediana 10%
        _, p = _prot(hist + self._arquivo(HOJE - timedelta(days=1), 200, 50, origem="hoje.csv"))   # 25%
        self.assertEqual([l["arquivo"] for l in p.resumo["lotes_travados"]], ["hoje.csv"])
        self.assertEqual(p.resumo["lotes_travados"][0]["mediana_14d"], 0.1)
        hist = []
        for k in range(2, 9):
            hist += self._arquivo(HOJE - timedelta(days=k), 200, 6, origem=f"d{k}.csv")       # mediana 3%
        _, p = _prot(hist + self._arquivo(HOJE - timedelta(days=1), 200, 14, origem="hoje.csv"))   # 7%
        self.assertEqual(p.resumo["lotes_travados"], [])

    def test_por_rota(self):
        from dataclasses import dataclass

        @dataclass(frozen=True)
        class ComRota(Evento):
            rota: str = ""
        dia = HOJE - timedelta(days=1)
        evs = [ComRota(f"C{i}", f"119{i:08d}", "telefone", "discador",
                       "numero_inexistente" if (i < 48 or 60 <= i < 70) else "nao_atendida", dia,
                       fornecedor="discadora", id_externo=str(i), origem="r.csv", rota="A" if i < 60 else "B")
               for i in range(260)]
        ev2, p = _prot(evs)
        self.assertEqual([(l["rota"], l["chamadas"]) for l in p.resumo["lotes_travados"]], [("A", 60)])
        self.assertEqual(sum(e.resultado == "inexistente_voz" for e in ev2), 10)    # rota B segue valendo

    def test_trava_desligada(self):
        ev2, p = _prot(self._arquivo(HOJE - timedelta(days=1), 300, 210), cfg=_cfg(trava_lote_ativo=False))
        self.assertEqual(p.resumo["lotes_travados"], [])
        self.assertEqual(sum(e.resultado == "inexistente_voz" for e in ev2), 210)


class TestSino(unittest.TestCase):
    def test_lote_travado_vira_aviso_da_empresa_e_falha_nao_levanta(self):
        from nuvem.sincronizar import aviso_lote_discagem

        class Sb:
            def __init__(self, erro=None):
                self.linhas, self.erro = [], erro

            def inserir(self, tabela, linha):
                if self.erro:
                    raise self.erro
                self.linhas.append((tabela, linha))
        disc = {"inexistente": {"lotes_travados": [{"arquivo": "lote.csv", "data": "2026-10-30", "chamadas": 300,
                                                    "inexistentes": 210, "fracao": 0.7, "mediana_14d": None,
                                                    "rota": None}]}}
        sb = Sb()
        self.assertEqual(aviso_lote_discagem(sb, 2, 9, "Credor X", disc, out=lambda *a: None), 1)
        tabela, linha = sb.linhas[0]
        self.assertEqual((tabela, linha["para"], linha["tipo"], linha["empresa_id"]), ("avisos", "empresa", "atencao", 2))
        self.assertIn("70% de número inexistente em 300 chamadas (lote.csv", linha["texto"])
        self.assertEqual(linha["chave"], "discagem_lote:9:2026-10-30:lote.csv:")
        self.assertEqual(aviso_lote_discagem(Sb(RuntimeError("fora")), 2, 9, "X", disc, out=lambda *a: None), 0)
        self.assertEqual(aviso_lote_discagem(Sb(), 2, 9, "X", {}, out=lambda *a: None), 0)


class TestRotina(unittest.TestCase):
    def test_falha_nunca_segura_a_lista(self):
        import rodar_dia
        ex = Path(__file__).resolve().parent.parent / "exemplos"
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(DG, "protecao_inexistente", side_effect=RuntimeError("boom")):
            r = rodar_dia.rodar_dia(ex / "clientes.csv", ex / "carteira_contatos.csv", ex / "retornos",
                                    date(2026, 9, 25), parcelas_csv=ex / "parcelas.csv",
                                    pasta_estado=Path(tmp) / "estado", pasta_saida=Path(tmp) / "saida",
                                    out=lambda *a: None)
        self.assertTrue(r["fila"])
        self.assertTrue(any(a.startswith("DISCAGEM: proteção do número inexistente") for a in r["alertas"]))
        self.assertNotIn("inexistente", r["discagem"])

    def test_resumo_na_rotina(self):
        import rodar_dia
        ex = Path(__file__).resolve().parent.parent / "exemplos"
        with tempfile.TemporaryDirectory() as tmp:
            r = rodar_dia.rodar_dia(ex / "clientes.csv", ex / "carteira_contatos.csv", ex / "retornos",
                                    date(2026, 9, 25), parcelas_csv=ex / "parcelas.csv",
                                    pasta_estado=Path(tmp) / "estado", pasta_saida=Path(tmp) / "saida",
                                    out=lambda *a: None)
        i = r["discagem"]["inexistente"]
        self.assertEqual(i["modo"], "so_voz")
        self.assertTrue({"quarentena", "encerrados", "sem_confirmacao", "lotes_travados"} <= set(i))


if __name__ == "__main__":
    unittest.main()
