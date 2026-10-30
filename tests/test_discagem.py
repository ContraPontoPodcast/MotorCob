"""Discagem, fase 1 (motor/discagem.py): horários por UF/DDD, renitência, chamadas curtas, mailing estendido.
Só dados fictícios."""
import csv
import json
import tempfile
import unittest
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from motor import discagem as DG
from motor import travas as TV
from motor.certificacao import Certificacao, Evento, certificar_contatos
from motor.cluster import carregar_regras
from motor.entrada import GENERICOS, LayoutOcorrencia, ler_ocorrencia, salvar_escolhas, carregar_escolhas
from motor.estrategia import validar_estrategia
from motor.fila import gerar_fila
from motor.ingestao import ingerir_pasta, validar_layout
from motor.marcacao import Cliente, EstadoCliente
from motor.regua import ReguaInvalida, carregar_regua
from motor.retorno_canal import avaliar, regras_de
from motor.taxonomia import TAXONOMIA, Nivel

SEX, SAB, DOM = date(2026, 10, 30), date(2026, 10, 31), date(2026, 11, 1)
FERIADO = date(2026, 11, 2)       # finados (segunda)
SP, RJ, MT, AC, AM, BA = "11988880001", "21988880002", "65988880003", "68988880004", "92988880005", "71988880006"
RAIZ = Path(__file__).resolve().parent.parent
EX = RAIZ / "exemplos"


def _regua(discagem=None, travas=None, passo=None):
    regua = carregar_regua()
    cfg, av = DG.normalizar(discagem, regua.dados["discagem"])
    assert not av, av
    regua = replace(regua, dados={**regua.dados, "discagem": cfg}, _cache={})
    regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
    defin = {"localizacao": {"passos": {"1": passo or [{"canal": "discador", "modo": "sempre", "numeros": 99},
                                                      {"canal": "sms", "modo": "senao"}]}}}
    if travas:
        defin["travas"] = travas
    over, erros = validar_estrategia(defin)
    assert not erros, erros
    return regua.com_clusters(regras, {7: over}, None, {})


def _fila(regua, telefones: dict, dia, disc=None, estado="LOC"):
    """telefones: {id_cliente: [números]} -> (fila, motivo_de, detalhe_de)."""
    est, cli, certs = {}, {}, {}
    for idc, tels in telefones.items():
        est[idc] = EstadoCliente(idc, dia, "DG", "DG", "2026-10", estado=estado, cluster_versao=regua.versao_clusters)
        cli[idc] = Cliente(idc, dia, 5000.0, 30)
        for t in tels:
            certs[(idc, t)] = Certificacao(idc, t, "telefone", "NAO_CONFIRMADO", 0.5)
    motivo_de, detalhe_de = {}, {}
    fila, _, _ = gerar_fila(est, cli, certs, {}, {}, dia, regua, [], None, motivos={}, motivo_de=motivo_de,
                            detalhe_de=detalhe_de, discagem=disc)
    return fila, motivo_de, detalhe_de


def _ev(idc, contato, resultado, dia, canal="discador", n=0, **kw):
    return Evento(idc, contato, "telefone", canal, resultado, dia, fornecedor="discadora", id_externo=f"{idc}{dia}{n}",
                  **kw)


class TestHorarios(unittest.TestCase):
    def test_fuso_menos_1_e_menos_2(self):
        r = _regua(LIGADO)
        self.assertEqual(r.janela_do_numero(SEX, MT), ("09:00", "20:00"))      # MT 08:00–19:50 local = 09:00–20:50
        self.assertEqual(r.janela_do_numero(SEX, AC), ("10:00", "20:00"))      # AC (−2): 08:00 local = 10:00
        self.assertEqual(r.janela_do_numero(SEX, AM), ("09:00", "18:50"))      # AM: 08:00–17:50 local
        self.assertEqual(r.janela_do_numero(SAB, AC), ("11:00", "14:00"))      # sábado ∩ janela do playbook

    def test_uf_sem_sabado_na_previa(self):
        r = _regua(LIGADO)
        for tel in (RJ, "31988880007", "51988880008", "27988880009", "85988880010"):   # RJ MG RS ES CE
            self.assertIsNone(r.janela_do_numero(SAB, tel), tel)
            self.assertIsNotNone(r.janela_do_numero(SEX, tel), tel)
        self.assertEqual(r.janela_do_numero(SAB, SP), ("08:00", "13:50"))
        self.assertEqual(r.janela_do_numero(SEX, RJ), ("09:00", "18:50"))

    def test_tabela_do_cliente_vence_a_previa(self):
        tab = {"hora": "local", "ufs": {"RJ": {"seg_sex": ["10:00", "17:00"], "sabado": ["09:00", "12:00"]}},
               "ddds": {"11": {"seg_sex": ["09:00", "18:00"], "sabado": None}}}
        r = _regua({"horarios": {"ativo": True, "tabela": tab}})
        self.assertEqual(r.janela_do_numero(SAB, RJ), ("09:00", "12:00"))
        self.assertEqual(r.janela_do_numero(SEX, RJ), ("10:00", "17:00"))
        self.assertIsNone(r.janela_do_numero(SAB, SP))                          # DDD do cliente vence
        self.assertEqual(r.janela_do_numero(SAB, "12988880011"), ("08:00", "13:50"))   # SP de outro DDD: prévia
        r2 = _regua({"horarios": {"ativo": True, "tabela": {"hora": "brasilia", "ufs": {"MT": {"seg_sex": ["10:00", "16:00"]}}}}})
        self.assertEqual(r2.janela_do_numero(SEX, MT), ("10:00", "16:00"))      # já em Brasília: sem conversão

    def test_faixa_global_nunca_e_furada(self):
        tab = {"ufs": {"BA": {"seg_sex": ["06:00", "23:00"], "sabado": ["06:00", "23:00"]}}}
        r = _regua({"horarios": {"ativo": True, "tabela": tab}})
        self.assertEqual(r.janela_do_numero(SEX, BA), ("08:00", "20:00"))
        self.assertIsNone(r.janela_do_numero(DOM, BA))
        self.assertIsNone(r.janela_do_numero(FERIADO, BA))
        h = DG.Horarios(tab["ufs"] and DG._tabela(tab, "t")[0], [FERIADO.isoformat()])
        self.assertIsNone(h.janela(DOM, BA, ("06:00", "22:00")))                # mesmo se a estratégia abrir domingo
        self.assertEqual(h.janela(SEX, BA, ("06:00", "22:00")), ("08:00", "20:00"))

    def test_horarios_desligados_e_tabela_invalida(self):
        r = _regua({"horarios": {"ativo": False}})
        self.assertEqual(r.janela_do_numero(SAB, RJ), ("08:00", "14:00"))      # só a janela da estratégia
        cfg, av = DG.normalizar({"horarios": {"tabela": {"ufs": {"XX": {"seg_sex": ["08:00", "09:00"]},
                                                                 "SP": {"seg_sex": ["19:00", "08:00"]}}}}})
        self.assertEqual(len(av), 2)                                            # entrada ruim fica de fora, avisada
        self.assertEqual(cfg["horarios"]["tabela"]["ufs"], {})

    def test_fila_sabado_tira_numero_sem_janela_e_explica(self):
        r = _regua(LIGADO, passo=[{"canal": "discador", "modo": "sempre", "numeros": 99}])
        disc = DG.Discagem(SAB)
        fila, motivo_de, detalhe = _fila(r, {"C1": [RJ, SP], "C2": [RJ]}, SAB, disc)
        voz = {(l["id_cliente"], l["contato"]) for l in fila if l["canal"] == "discador"}
        self.assertEqual(voz, {("C1", SP)})                                     # o próximo número assume
        self.assertEqual(motivo_de["C2"], "sem_contato")
        self.assertIn("RJ: não liga no sábado", detalhe["C2"])
        self.assertEqual(disc.resumo_horarios(), {"RJ": 1})
        # sem a discagem (como antes), o RJ sai no sábado
        fila0, _, _ = _fila(r, {"C1": [RJ, SP], "C2": [RJ]}, SAB, None)
        self.assertIn(("C2", RJ), {(l["id_cliente"], l["contato"]) for l in fila0})


class TestConfig(unittest.TestCase):
    def test_padrao_recomendado(self):
        cfg = carregar_regua()["discagem"]
        self.assertTrue(cfg["inexistente"]["ativo"] and cfg["nao_ligar"]["ativo"])
        self.assertFalse(cfg["horarios"]["ativo"])          # desligado até o jurídico validar a prévia
        self.assertFalse(cfg["descanso_nao_atende"]["ativo"] or cfg["descanso_recusa"]["ativo"]
                         or cfg["promessa_suspende"]["ativo"] or cfg["chamadas_curtas"]["corte_ativo"])
        self.assertEqual((cfg["descanso_nao_atende"]["n"], cfg["chamadas_curtas"]["aviso"]), (6, 0.75))
        self.assertEqual(DG.config(carregar_regua().dados)["tentativas_cliente_dia"], 3)   # = spins_discador_dia

    def test_credor_tolerante_e_regua_json_falha_alto(self):
        cfg, av = DG.normalizar({"tentativas_numero_dia": 99, "spins_discador_dia": 5, "xpto": 1,
                                 "chamadas_curtas": {"aviso": 80, "corte_ativo": "sim"}, "descanso_recusa_dias": 10})
        self.assertEqual((cfg["tentativas_numero_dia"], cfg["tentativas_cliente_dia"]), (2, 5))
        self.assertEqual((cfg["chamadas_curtas"]["aviso"], cfg["chamadas_curtas"]["corte_ativo"]), (0.8, True))
        self.assertEqual(cfg["descanso_recusa"], {"ativo": True, "dias": 10})
        self.assertEqual(len(av), 2)
        with tempfile.TemporaryDirectory() as tmp:
            d = json.loads((RAIZ / "regras" / "regua.json").read_text(encoding="utf-8"))
            d["discagem"]["intervalo_min_minutos"] = -3
            p = Path(tmp) / "r.json"
            p.write_text(json.dumps(d), encoding="utf-8")
            with self.assertRaises(ReguaInvalida):
                carregar_regua(p)

    def test_trava_ligacoes_da_estrategia(self):
        t, av = TV.ler({"travas": {"ligacoes": {"por_dia": 4, "por_numero": 1, "intervalo_min": 60}}})
        self.assertEqual((t["spins_discador_dia"], t["discagem_trava"]),
                         (4, {"tentativas_cliente_dia": 4, "tentativas_numero_dia": 1, "intervalo_min_minutos": 60}))
        self.assertFalse(av)
        r = _regua({"tentativas_cliente_dia": 2}, travas={"ligacoes": {"por_numero": 3}})
        c = DG.config(r.para("DG").dados)
        self.assertEqual((c["tentativas_numero_dia"], c["tentativas_cliente_dia"]), (3, 2))   # trava > credor
        fila, _, _ = _fila(r, {"C1": [SP]}, SEX)
        self.assertEqual({l["spins_max"] for l in fila if l["canal"] == "discador"}, {2})


class TestTaxonomia(unittest.TestCase):
    def test_novos_resultados_e_contato(self):
        d, a = TAXONOMIA["discador"], TAXONOMIA["agente_voz"]
        self.assertEqual((d["promessa"].nivel, d["recusa"].nivel, d["recado"].nivel),
                         (Nivel.CERTIFICADO, Nivel.CERTIFICADO, Nivel.ENGAJADO))
        self.assertTrue(all(k in a for k in ("promessa", "recusa", "recado", "ocupado", "abandonada", "falha_rede",
                                             "opt_out")))
        r = carregar_regua()
        self.assertTrue(r.e_contato("discador", "promessa") and r.e_contato("agente_voz", "recusa"))
        self.assertFalse(r.e_contato("discador", "recado"))
        self.assertEqual((GENERICOS["opt_out"]["discador"], GENERICOS["promessa"]["whatsapp"]),
                         ("opt_out", "identidade_confirmada"))

    def test_opt_out_voz_sai_de_todos_os_canais_de_voz_e_falha_de_rede_nao_penaliza(self):
        certs = certificar_contatos([_ev("C1", SP, "opt_out", SEX), _ev("C1", RJ, "falha_rede", SEX, n=1),
                                     _ev("C1", RJ, "falha_rede", SEX, n=2)], SAB)
        self.assertEqual(certs[("C1", SP)].restricoes, {"discador:opt_out", "agente_voz:opt_out"})
        self.assertEqual((certs[("C1", RJ)].status, certs[("C1", RJ)].tentativas), ("DESCONHECIDO", 0))

    def test_tabulacao_desconhecida_em_quarentena_hora_duracao_e_reimportacao(self):
        lay = validar_layout({"fornecedor": "disc_x", "canal": "discador", "arquivo": "disc_x_*.csv",
                              "delimitador": ";", "formato_data": "%d/%m/%Y %H:%M", "custo_fixo": 0.1,
                              "colunas": {"id_cliente": "ID", "contato": "FONE", "data": "DT", "resultado": "COD",
                                          "id_externo": "CHAMADA", "duracao": "DUR", "data_promessa": "PROM"},
                              "resultados": {"1": "nao_atendida", "2": "numero_inexistente", "3": "promessa",
                                             "9": "numero_inexistente"},
                              "inexistente_confirmado": ["2"]})
        with tempfile.TemporaryDirectory() as tmp:
            txt = ("ID;FONE;DT;COD;CHAMADA;DUR;PROM\nC1;11988880001;29/10/2026 14:05;1;a1;00:04;\n"
                   "C1;11988880001;29/10/2026 15:05;3;a2;95;2026-11-05\nC2;21988880002;29/10/2026 10:00;77;a3;3;\n"
                   "C3;31988880003;29/10/2026 10:00;2;a4;2;\nC4;41988880004;29/10/2026 10:00;9;a5;2;\n")
            for n in ("disc_x_1.csv", "disc_x_2.csv"):               # o mesmo arquivo reimportado
                (Path(tmp) / n).write_text(txt, encoding="utf-8")
            ev, rels, quar, _ = ingerir_pasta(tmp, [lay])
        self.assertEqual(len(ev), 4)                                   # reimportação não duplica
        self.assertEqual(rels[1].duplicadas, 4)
        self.assertEqual([q["codigo"] for q in quar], ["77", "77"])    # desconhecido: quarentena, nunca palpite
        por = {e.id_externo: e for e in ev}
        self.assertEqual((por["a1"].hora.hour, por["a1"].hora.minute, por["a1"].duracao_s), (14, 5, 4))
        self.assertEqual((por["a2"].resultado, por["a2"].data_promessa), ("promessa", date(2026, 11, 5)))
        self.assertEqual((por["a4"].resultado, por["a5"].resultado), ("numero_inexistente", "falha_rede"))

    def test_inexistente_so_com_codigo_confirmado_na_ocorrencia(self):
        lay = LayoutOcorrencia(arquivo="*", canal="discador", colunas={"id_cliente": "ID", "data": "DT",
                                                                       "resultado": "RES", "contato": "FONE"},
                               resultados={"INEX": "invalido", "FALHA": "invalido", "NAO": "sem_contato"},
                               inexistente_confirmado=["INEX"])
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "oc.csv"
            arq.write_text("ID;DT;RES;FONE\nC1;29/10/2026;INEX;11988880001\nC2;29/10/2026;FALHA;11988880002\n"
                           "C3;29/10/2026;XPTO;11988880003\n", encoding="utf-8")
            ev, rel, quar = ler_ocorrencia(arq, lay, "emp", {})
        self.assertEqual([e.resultado for e in ev], ["numero_inexistente", "falha_rede"])
        self.assertEqual([q["codigo"] for q in quar], ["XPTO"])
        certs = certificar_contatos(ev, SEX)
        self.assertEqual((certs[("C1", SP)].status, certs[("C2", "11988880002")].status), ("INVALIDO", "DESCONHECIDO"))


class TestRenitencia(unittest.TestCase):
    def _pausa(self, n, ativo=True):
        cfg, _ = DG.normalizar({"descanso_nao_atende": {"ativo": ativo}})
        evs = [_ev("C1", SP, "nao_atendida", SEX - timedelta(days=i % 3), n=i) for i in range(n)]
        _, regs, _ = DG.renitencia(evs, SAB, cfg)
        _, restr, _, _ = avaliar(regs, {SP: ["C1"]}, SAB, DG.regras_voz(regras_de(None), cfg))
        return restr.get(SP, set())

    def test_descanso_apos_6_nao_atende(self):
        self.assertEqual(self._pausa(6), {"discador:pausa", "agente_voz:pausa"})   # só a voz descansa
        self.assertEqual(self._pausa(5), set())
        self.assertEqual(self._pausa(6, ativo=False), set())                         # padrão: desligado
        cfg, _ = DG.normalizar({"descanso_nao_atende": {"ativo": True}})
        espalhados = [_ev("C1", SP, "nao_atendida", SEX - timedelta(days=2 * i), n=i) for i in range(6)]
        _, regs, _ = DG.renitencia(espalhados, SAB, cfg)
        _, restr, _, _ = avaliar(regs, {SP: ["C1"]}, SAB, DG.regras_voz(regras_de(None), cfg))
        self.assertEqual(restr, {})                                                  # 6 em 11 dias: não são "em 3 dias"

    def test_recusa_e_promessa(self):
        evs = [_ev("C1", SP, "recusa", SEX - timedelta(days=3)), _ev("C2", "", "promessa", SEX,
                                                                      data_promessa=date(2026, 11, 4)),
               _ev("C3", "", "promessa", SEX - timedelta(days=1))]
        sem, _, _ = DG.renitencia(evs, SAB, carregar_regua()["discagem"])
        self.assertEqual(sem, {})                                                    # padrão: desligadas
        cfg, _ = DG.normalizar({"descanso_recusa": {"ativo": True, "dias": 7},
                                "promessa_suspende": {"ativo": True, "dias_sem_data": 3}})
        sem, _, res = DG.renitencia(evs, SAB, cfg)
        self.assertEqual(set(sem), {"C1", "C2", "C3"})
        self.assertIn("05/11", sem["C2"])                                            # data prometida + 1
        self.assertEqual(set(DG.renitencia(evs, date(2026, 11, 5), cfg)[0]), {"C2"})
        self.assertEqual(DG.renitencia(evs, date(2026, 11, 6), cfg)[0], {})
        self.assertEqual(set(DG.renitencia(evs, SEX + timedelta(days=1), cfg)[0]), {"C1", "C2", "C3"})
        self.assertNotIn("C3", DG.renitencia(evs, SEX + timedelta(days=2), cfg)[0])   # sem data: 3 dias
        # na fila: a voz do cliente sai, o digital segue (senão)
        r = _regua()
        fila, _, _ = _fila(r, {"C1": [SP]}, SEX, DG.Discagem(SEX, {"C1": sem["C1"]}))
        self.assertEqual({l["canal"] for l in fila}, {"sms"})

    def test_opt_out_voz_sem_numero_tira_a_voz_do_cliente_e_desligar_vale(self):
        evs = [_ev("C1", "", "opt_out", SEX), _ev("C2", SP, "numero_inexistente", SEX)]
        sem, _, _ = DG.renitencia(evs, SAB, carregar_regua()["discagem"])
        self.assertEqual(sem, {"C1": "pediu para não ligar"})
        cfg, _ = DG.normalizar({"nao_ligar": {"ativo": False}, "inexistente": {"ativo": False}})
        aj, n = DG.ajustar_eventos(evs, cfg)
        self.assertEqual([e.resultado for e in aj], ["atendida_sem_cpc", "falha_rede"])
        self.assertEqual(DG.renitencia(aj, SAB, cfg)[0], {})


def _linha(idc, contato, prioridade=6, ordem=1, canal="discador", data_fixa=False):
    return {"id_cliente": idc, "contato": contato, "canal": canal, "ordem_contato": ordem, "condicao": "",
            "prioridade": prioridade, "data_fixa": data_fixa, "janela": "08:00-20:00", "regua": "localizacao",
            "passo": "D+1", "persona": ""}


class TestCurtas(unittest.TestCase):
    def test_kpi_medido(self):
        cfg = carregar_regua()["discagem"]
        evs = [_ev("C1", SP, "atendida_sem_cpc", SEX, n=1, duracao_s=40), _ev("C1", SP, "atendida_sem_cpc", SEX, n=2,
                                                                           duracao_s=5),
               _ev("C2", RJ, "caixa_postal", SEX, n=3), _ev("C3", MT, "abandonada", SEX, n=4),
               _ev("C4", AC, "cpc", SEX, n=5, duracao_s=120), _ev("C5", BA, "nao_atendida", SAB, n=6)]
        m = DG.medir(evs, SAB, cfg)
        self.assertEqual(m, [{"data": SEX.isoformat(), "chamadas": 5, "curtas": 3, "fracao": 0.6}])
        cfg2, _ = DG.normalizar({"chamadas_curtas": {"abandono_conta": False}})
        self.assertEqual(DG.medir(evs, SAB, cfg2)[0]["curtas"], 2)

    def test_previsao_alerta_e_corte_desligado_por_padrao(self):
        cfg, _ = DG.normalizar({"chamadas_curtas": {"max_por_numero_dia": 10, "max_total_dia": 20}})
        fila = [_linha(f"C{i:02d}", f"119888800{i:02d}") for i in range(12)]
        fila += [_linha("C01", "11977770001", ordem=2)]
        evs = [_ev("C00", "11988880000", "atendida_sem_cpc", SEX, n=i, duracao_s=60) for i in range(10)]
        evs += [_ev("X", "11900000000", "caixa_postal", SEX, n=100 + i) for i in range(60)]   # carteira: muita curta
        fila2, res, al = DG.curtas(fila, evs, SAB, cfg, lambda l: (2, 3))
        self.assertEqual(res["previsao"]["chamadas"], 2 * 12 + 1)                    # C01: 2 + 1 (teto do cliente)
        self.assertLess(DG.ModeloCurtas(evs, SAB, cfg).p("11988880000"), 0.5)       # histórico próprio
        self.assertEqual(fila2, fila)                                                # padrão: nada sai da lista
        self.assertTrue(al and al[0].startswith("CHAMADAS CURTAS"))
        self.assertIn("ligar o corte pelo fim da fila", al[0])
        self.assertIn("pelo menos 3 linha(s)", al[0])
        # abaixo do volume de uma linha: sem alerta (sem ruído em lista pequena)
        cfg3, _ = DG.normalizar({"chamadas_curtas": {"max_por_numero_dia": 900}})
        self.assertEqual(DG.curtas(fila, evs, SAB, cfg3, lambda l: (2, 3))[2], [])

    def test_corte_ligado_pela_prioridade(self):
        cfg, _ = DG.normalizar({"chamadas_curtas": {"corte_ativo": True, "max_por_numero_dia": 1, "max_total_dia": 6,
                                                    "corte": 0.8}})
        fila = [_linha("A1", "11988880001", prioridade=4), _linha("A2", "11988880002", prioridade=4),
                _linha("B1", "11988880003", prioridade=7), _linha("B2", "11988880004", prioridade=7),
                _linha("Q1", "11988880005", prioridade=1, data_fixa=True),
                _linha("B1", "11988880003", canal="sms")]
        fila2, res, al = DG.curtas(fila, [], SAB, cfg, lambda l: (2, 2))
        self.assertEqual(res["previsao"]["chamadas"], 10)
        self.assertEqual(set(res["cortados"]), {"B1", "B2"})                         # fim da prioridade primeiro
        self.assertEqual({(l["id_cliente"], l["canal"]) for l in fila2},
                         {("A1", "discador"), ("A2", "discador"), ("Q1", "discador"), ("B1", "sms")})
        self.assertIn("Corte ligado", al[0])


def _rotina(tmp, nome="a", **kw):
    import rodar_dia
    return rodar_dia.rodar_dia(EX / "clientes.csv", EX / "carteira_contatos.csv", EX / "retornos",
                               date(2026, 9, 25), parcelas_csv=EX / "parcelas.csv",
                               pasta_estado=Path(tmp) / nome / "estado", pasta_saida=Path(tmp) / nome / "saida",
                               out=lambda *a: None, **kw)


DESLIGADO = {"horarios": {"ativo": False}, "chamadas_curtas": {"ativo": False}}
LIGADO = {"horarios": {"ativo": True}}   # horários por UF/DDD vêm desligados por padrão


class TestRotina(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.r = _rotina(cls.tmp.name, "padrao")
        cls.r0 = _rotina(cls.tmp.name, "desligado", discagem=DESLIGADO)
        cls.rh = _rotina(cls.tmp.name, "horarios", discagem=LIGADO)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _arq(self, r, nome):
        return (r["saida"] / nome).read_text(encoding="utf-8")

    def test_sem_configurar_a_fila_e_a_de_hoje(self):
        self.assertEqual(self.r["fila"], self.r0["fila"])
        self.assertTrue(any(l["canal"] == "discador" for l in self.r["fila"]))

    def test_discador_csv_inalterado_e_mailing_novo(self):
        disc = self._arq(self.rh, "ids/discador.csv")
        self.assertEqual(disc, self._arq(self.r0, "ids/discador.csv"))
        self.assertTrue(disc.startswith("id_cliente;contato\n"))
        linhas = list(csv.DictReader(self._arq(self.rh, "discador_mailing.csv").splitlines(), delimiter=";"))
        self.assertEqual(tuple(linhas[0]), DG.CAMPOS_MAILING)
        pares = {tuple(x.split(";")) for x in disc.splitlines()[1:]}
        self.assertEqual({(l["id_cliente"], l["telefone"]) for l in linhas if l["reserva"] == "0"}, pares)
        self.assertTrue(all(l["janela_local"] == "08:00-19:50" and l["uf"] == "SP" for l in linhas))
        self.assertTrue(all(l["tentativas_max_numero"] == "2" and l["tentativas_max_cliente"] == "3" for l in linhas))
        texto = self._arq(self.rh, "discador_mailing.csv")
        cpfs = {l.split(";")[4] for l in (EX / "carteira_contatos.csv").read_text().splitlines()[1:] if l.split(";")[4]}
        self.assertFalse(any(c in texto for c in cpfs))                              # nunca CPF

    def test_resumo_de_discagem(self):
        d = self.r["discagem"]
        self.assertEqual(d["horario_fora_por_uf"], {})
        self.assertGreater(d["chamadas_curtas"]["previsao"]["chamadas"], 0)
        self.assertTrue(d["chamadas_curtas"]["medido"])
        self.assertFalse(any(a.startswith("DISCAGEM") for a in self.r["alertas"]))

    def test_erro_nao_segura_a_lista(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(DG.Horarios, "janela", side_effect=RuntimeError("x")), \
                    mock.patch.object(DG, "renitencia", side_effect=RuntimeError("y")), \
                    mock.patch.object(DG, "curtas", side_effect=RuntimeError("z")):
                r = _rotina(tmp, discagem=LIGADO)
            self.assertEqual(r["fila"], self.r0["fila"])
            self.assertTrue(sum(a.startswith("DISCAGEM") for a in r["alertas"]) >= 3)
            self.assertTrue((r["saida"] / "ids" / "discador.csv").exists())
            original = DG.normalizar

            def falha_no_credor(bruto, base=None, onde="discagem"):
                if onde == "discagem do credor":
                    raise RuntimeError("w")
                return original(bruto, base, onde)
            with mock.patch.object(DG, "normalizar", side_effect=falha_no_credor):
                r = _rotina(tmp, "b")
            self.assertEqual(r["fila"], self.r0["fila"])
            self.assertFalse((r["saida"] / "discador_mailing.csv").exists())
            self.assertTrue(any(a.startswith("DISCAGEM") for a in r["alertas"]))


if __name__ == "__main__":
    unittest.main()
