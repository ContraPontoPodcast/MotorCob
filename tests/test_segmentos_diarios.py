"""Reavaliação diária dos segmentos com condição que muda com o tempo (etapa 2; motor/marcacao.reavaliar_diario) e o
retrato da prévia de segmentação (motor/previa.py).

Regra: segmento cuja condição usa dias de atraso (ou idade, ou persona que usa um deles) é reavaliado todo dia, na
ordem da empresa ("fica no 1º segmento em que se encaixa"); os outros seguem mensais. Mudar de segmento troca só a
régua (a estratégia do segmento novo vale no mesmo dia): momento, ciclo, Hot, giro e dia da esteira são do cliente e
continuam; as etapas próprias da estratégia antiga são zeradas.
"""
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import rodar_dia
from motor import previa as PREVIA
from motor.certificacao import Certificacao
from motor.cluster import PersonaUsuario, carregar_regras, segmentos_diarios
from motor.estrategia import validar_estrategia
from motor.fila import gerar_fila
from motor.marcacao import (Cliente, EstadoCliente, processar_dia, reavaliar_diario, reavaliar_segmentos_diarios)
from motor.regua import carregar_regua

D0 = date(2026, 11, 3)            # terça (02/11 é feriado)
RAIZ = Path(__file__).resolve().parent.parent
EX = RAIZ / "exemplos" / "empresa"

SEGS = [
    {"ordem": 1, "codigo": "JUR", "condicoes": [{"campo": "PRODUTO", "op": "=", "valor": "JUDICIAL"}]},
    {"ordem": 2, "codigo": "A1", "condicoes": [{"campo": "dias_atraso", "op": "entre", "valor": [0, 30]}]},
    {"ordem": 3, "codigo": "VIP", "condicoes": [{"campo": "saldo", "op": ">=", "valor": 5000}]},
    {"ordem": 4, "codigo": "D90", "condicoes": [{"campo": "dias_atraso", "op": "entre", "valor": [31, 90]}]},
]


def _regua(segs=SEGS, estrategias=None):
    regras, avisos = carregar_regras(segs)
    assert not avisos, avisos
    return carregar_regua().com_clusters(regras, estrategias or {}, None, {})


def _cli(idc="C1", atraso=28, saldo=100.0, entrada=D0, **atrib):
    return Cliente(idc, entrada, saldo, atraso, None, 1, atrib or {"PRODUTO": "CARTAO"})


def _est(idc="C1", cluster="A1", **kw):
    return EstadoCliente(idc, D0, cluster, cluster, f"{D0:%Y-%m}", **kw)


class TestQuaisSaoDiarios(unittest.TestCase):
    def test_so_os_segmentos_com_campo_que_muda_com_o_tempo(self):
        r = _regua()
        self.assertEqual(r.segmentos_diarios, frozenset({"A1", "D90"}))
        regras, _ = carregar_regras([{"codigo": "ID", "condicoes": [{"campo": "idade", "op": ">", "valor": 60}]},
                                     {"codigo": "P", "condicoes": [{"campo": "persona", "op": "=", "valor": "Jovem"}]}])
        self.assertEqual(segmentos_diarios(regras), frozenset({"ID"}))
        # persona que usa dias de atraso: o segmento por persona também passa a ser diário
        p = PersonaUsuario(1, "Jovem", (("dias_atraso", "<", 10.0),))
        self.assertEqual(segmentos_diarios(regras, [p]), frozenset({"ID", "P"}))


class TestReavaliarNoDia(unittest.TestCase):
    def test_passou_de_30_dias_muda_no_mesmo_dia(self):
        r = _regua()
        c = _cli(atraso=28)                          # D0: 28 dias; D0+3: 31 dias
        est = {"C1": _est(cluster_versao=r.versao_clusters)}
        self.assertIsNone(reavaliar_diario(est["C1"], c, D0 + timedelta(days=2), r))   # 30: ainda A1
        ev = reavaliar_segmentos_diarios(est, {"C1": c}, D0 + timedelta(days=3), r)
        self.assertEqual(est["C1"].cluster_atual, "D90")
        self.assertEqual([e["motivo"] for e in ev], ["reavaliação diária do segmento"])
        self.assertEqual(est["C1"].cluster_revisado, f"{D0:%Y-%m}")   # a revisão mensal não muda
        # idempotente
        self.assertEqual(reavaliar_segmentos_diarios(est, {"C1": c}, D0 + timedelta(days=3), r), [])

    def test_ordem_manda_segmento_acima_ganha(self):
        r = _regua()
        # cliente em A1 com saldo alto: passou de 30 → o 1º que bate é VIP (mensal, mas acima de D90)
        est = _est()
        self.assertEqual(reavaliar_diario(est, _cli(atraso=31, saldo=9000), D0, r), "VIP")
        # JUR (mensal, acima) segura o cliente mesmo com atraso mudando
        est = _est(cluster="JUR")
        self.assertIsNone(reavaliar_diario(est, _cli(atraso=10, PRODUTO="JUDICIAL"), D0, r))
        self.assertIsNone(reavaliar_diario(est, _cli(atraso=10, PRODUTO="CARTAO"), D0, r))  # saiu de JUR: só no mês

    def test_mensal_so_sai_para_segmento_diario_acima(self):
        r = _regua()
        # em VIP (mensal) e com 10 dias: A1 (diário, acima) passa a bater → vai para A1
        self.assertEqual(reavaliar_diario(_est(cluster="VIP"), _cli(atraso=10, saldo=9000), D0, r), "A1")
        # em VIP com 40 dias: D90 bate mas está ABAIXO de VIP → fica
        self.assertIsNone(reavaliar_diario(_est(cluster="VIP"), _cli(atraso=40, saldo=9000), D0, r))
        # VIP deixou de bater por saldo (mensal) → espera a revisão do mês, mesmo com D90 batendo
        self.assertIsNone(reavaliar_diario(_est(cluster="VIP"), _cli(atraso=40, saldo=100), D0, r))

    def test_demais_entra_no_segmento_diario_e_sai_dele(self):
        r = _regua()
        est = _est(cluster="M3")                      # Demais (cluster padrão)
        self.assertIsNone(reavaliar_diario(est, _cli(atraso=200, saldo=100), D0, r))   # nenhum diário bate
        self.assertEqual(reavaliar_diario(est, _cli(atraso=50, saldo=100), D0, r), "D90")
        # em D90 e passou de 90: nenhum segmento bate → cluster padrão ticket × atraso
        est = _est(cluster="D90")
        self.assertEqual(reavaliar_diario(est, _cli(atraso=91, saldo=100), D0, r), "B2")

    def test_sem_segmento_diario_nada_muda(self):
        r = _regua([s for s in SEGS if s["codigo"] in ("JUR", "VIP")])
        self.assertEqual(r.segmentos_diarios, frozenset())
        self.assertIsNone(reavaliar_diario(_est(cluster="M1"), _cli(atraso=10, saldo=9000), D0, r))

    def test_bloqueado_e_liquidado_ficam(self):
        r = _regua()
        for estado in ("BLQ", "LIQ"):
            self.assertIsNone(reavaliar_diario(_est(estado=estado), _cli(atraso=60), D0, r))

    def test_processar_dia_reavalia_na_virada_e_mantem_o_momento(self):
        r = _regua()
        c = _cli(atraso=29)
        est = {"C1": _est(cluster_versao=r.versao_clusters, estado="NCP", ciclo="G1", canal="SM",
                          giro_inicio=D0, contato_localizador="11999990000", tentativas=3)}
        processar_dia(est, {"C1": c}, [], {}, D0 + timedelta(days=1), r)
        self.assertEqual(est["C1"].cluster_atual, "A1")               # 30 dias
        trilha = processar_dia(est, {"C1": c}, [], {}, D0 + timedelta(days=2), r)
        e = est["C1"]
        self.assertEqual(e.cluster_atual, "D90")                      # 31 dias: muda no dia
        self.assertIn("reavaliação diária do segmento", [t["motivo"] for t in trilha])
        # o momento é do cliente: continua no giro, com o Hot, o início do giro e as tentativas
        self.assertEqual((e.estado, e.giro_inicio, e.contato_localizador, e.tentativas, e.cluster_origem),
                         ("NCP", D0, "11999990000", 3, "A1"))

    def test_revisao_mensal_continua_para_os_outros(self):
        r = _regua()
        est = {"C1": _est(cluster="VIP", cluster_versao=r.versao_clusters)}
        c = _cli(atraso=40, saldo=100)
        processar_dia(est, {"C1": c}, [], {}, D0 + timedelta(days=1), r)
        self.assertEqual(est["C1"].cluster_atual, "VIP")              # saldo caiu: mensal, espera
        processar_dia(est, {"C1": c}, [], {}, date(2026, 12, 1), r)
        self.assertEqual(est["C1"].cluster_atual, "D90")              # revisão do mês


DEF_A = {"etapas": [{"id": "e1", "nome": "Etapa A", "condicoes": [{"campo": "saldo", "op": ">=", "valor": 0}], "referencia": {"tipo": "entrada"}, "de": 0,
                     "ate": 30, "passos": {"0": [{"canal": "email", "modo": "sempre"}]},
                     "saidas": {"cpc": "sai"}}]}
DEF_B = {"etapas": [{"id": "e1", "nome": "Etapa B", "condicoes": [{"campo": "saldo", "op": ">=", "valor": 0}], "referencia": {"tipo": "entrada"}, "de": 0,
                     "ate": 30, "passos": {"0": [{"canal": "sms", "modo": "sempre"}]},
                     "saidas": {"cpc": "sai"}}]}


class TestTrocaDeEstrategia(unittest.TestCase):
    def _regua(self):
        segs = [dict(SEGS[1], estrategia_id=1), dict(SEGS[3], estrategia_id=2)]
        over = {}
        for eid, d in ((1, DEF_A), (2, DEF_B)):
            o, erros = validar_estrategia(d)
            assert not erros, erros
            over[eid] = o
        return _regua(segs, over)

    def _fila(self, r, est, cli, dia, estado_et):
        certs = {("C1", "c1@exemplo.invalid"): Certificacao("C1", "c1@exemplo.invalid", "email", "DESCONHECIDO", 0.4),
                 ("C1", "11988880001"): Certificacao("C1", "11988880001", "telefone", "DESCONHECIDO", 0.4)}
        fila, _, _ = gerar_fila(est, cli, certs, {}, {}, dia, r, [], None, etapas_estado=estado_et)
        return fila

    def test_etapas_da_estrategia_antiga_zeram_e_as_da_nova_comecam(self):
        r = self._regua()
        c = _cli(atraso=29)
        est = {"C1": _est(cluster_versao=r.versao_clusters)}
        estado_et = {}
        f1 = self._fila(r, est, {"C1": c}, D0, estado_et)
        self.assertIn(("etapa-e1", "email"), {(l["regua"], l["canal"]) for l in f1})
        self.assertEqual(estado_et["C1"]["estrategia"], 1)
        estado_et["C1"]["fora"] = {"desde": D0.isoformat(), "etapa": "e1", "motivo": "cpc"}   # saiu da etapa A
        dia = D0 + timedelta(days=2)                                  # 31 dias → D90 (estratégia 2)
        reavaliar_segmentos_diarios(est, {"C1": c}, dia, r)
        self.assertEqual(est["C1"].cluster_atual, "D90")
        f2 = self._fila(r, est, {"C1": c}, dia, estado_et)
        self.assertIn(("etapa-e1", "sms"), {(l["regua"], l["canal"]) for l in f2})   # etapa da B, do D0 dela
        self.assertNotIn("fora", estado_et["C1"])
        self.assertEqual((estado_et["C1"]["estrategia"], estado_et["C1"]["etapas"]["e1"]["entrou"]),
                         (2, dia.isoformat()))

    def test_estado_antigo_sem_marca_nao_e_zerado(self):
        r = self._regua()
        est = {"C1": _est(cluster_versao=r.versao_clusters)}
        estado_et = {"C1": {"etapas": {"e1": {"entrou": D0.isoformat(), "feitos": {"0": D0.isoformat()}}},
                            "atual": "e1"}}
        self._fila(r, est, {"C1": _cli(atraso=29)}, D0 + timedelta(days=1), estado_et)
        self.assertEqual(estado_et["C1"]["etapas"]["e1"]["entrou"], D0.isoformat())
        self.assertEqual(estado_et["C1"]["estrategia"], 1)


class TestRotinaDiaN(unittest.TestCase):
    def test_dia_n_mais_1_quem_passa_da_faixa_ja_sai_no_segmento_novo(self):
        """Rotina do dia N com "até L dias" e "acima de L"; no dia N+1 (sem carga nova: o atraso anda sozinho) quem
        cruzou L já sai no segmento novo, no mesmo dia, e a trilha diz por quê."""
        from motor.ingestao import carregar_clientes
        d0 = date(2026, 9, 2)
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "base"
            rodar_dia.preparar_base(RAIZ / "empresas" / "exemplo.json", EX / "bruto", base)
            clientes, _ = carregar_clientes(base / "clientes.csv")
            idc, c = min(clientes.items(), key=lambda kv: kv[1].atraso_em(d0))
            lim = c.atraso_em(d0) + 2                 # no dia N = d0 + 2 ele tem exatamente o limite
            segs = [{"ordem": 1, "codigo": "A1", "condicoes": [{"campo": "dias_atraso", "op": "entre", "valor": [0, lim]}]},
                    {"ordem": 2, "codigo": "D90", "condicoes": [{"campo": "dias_atraso", "op": ">", "valor": lim}]}]

            def rodar(dia):
                return rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", Path(tmp) / "ret", dia,
                                           pasta_estado=Path(tmp) / "estado", pasta_saida=Path(tmp) / "saida",
                                           clusters=segs, atributos=base / "atributos.csv", out=lambda *a: None)
            rodar(d0)
            n = d0 + timedelta(days=2)
            rn = rodar(n)
            self.assertEqual(rn["estados"][idc].cluster_atual, "A1")
            rn1 = rodar(n + timedelta(days=1))
            self.assertEqual(rn1["estados"][idc].cluster_atual, "D90")
            trilha = (Path(tmp) / "estado" / "trilha.csv").read_text(encoding="utf-8")
            self.assertTrue(any(l.startswith(f"{(n + timedelta(days=1)).isoformat()},{idc},")
                                and "reavaliação diária do segmento" in l for l in trilha.splitlines()), trilha)
            # o retrato da prévia é do dia e leva o segmento de hoje
            prev = {l["id_cliente"]: l for l in rn1["previa"]}
            self.assertEqual((prev[idc]["segmento_atual"], prev[idc]["dias_atraso"]), ("D90", lim + 1))


class TestRetratoDaPrevia(unittest.TestCase):
    def test_colunas_pessoais_e_codigos_nunca_vao(self):
        vals = {"NOME": [f"Pessoa {i}" for i in range(100)], "UF": ["SP", "RJ"] * 50,
                "RENDA": [str(1000 + i) for i in range(100)], "NUM_CONTRATO": [str(9000 + i) for i in range(100)],
                "Endereço": ["Rua x"] * 100, "OBS": [f"texto livre {i}" for i in range(100)],
                "TELEFONE_REF": ["1"] * 100}
        sim, nao = PREVIA.colunas_publicaveis(vals)
        self.assertEqual(sorted(sim), ["RENDA", "UF"])
        self.assertEqual(sorted(nao), ["Endereço", "NOME", "NUM_CONTRATO", "OBS", "TELEFONE_REF"])

    def test_universo_e_campos(self):
        class R:
            def _regra(self, c):
                return c if c == "A1" else None
        cli = {"C1": _cli("C1", 10, 50.0, PRODUTO="X", NOME="Fulano", persona="Digital"),
               "C2": _cli("C2", 10), "C3": _cli("C3", 10), "C4": _cli("C4", 10)}
        est = {"C1": _est("C1"), "C2": _est("C2", cluster="M1"), "C3": _est("C3", estado="BLQ"), "C4": _est("C4")}
        linhas, fora = PREVIA.linhas(est, cli, D0 + timedelta(days=5), R(), {"C1", "C2", "C3"})
        self.assertEqual(fora, ["NOME"])
        self.assertEqual([l["id_cliente"] for l in linhas], ["C1", "C2"])   # C3 bloqueado, C4 fora da carga
        self.assertEqual(linhas[0], {"id_cliente": "C1", "segmento_atual": "A1", "saldo": 50.0, "dias_atraso": 15,
                                     "qtd_contratos": 1, "atributos": {"PRODUTO": "X", "persona": "Digital"}})
        self.assertIsNone(linhas[1]["segmento_atual"])                     # cluster padrão = Demais


if __name__ == "__main__":
    unittest.main()


class TestPublicarPrevia(unittest.TestCase):
    class Sb:
        def __init__(self, erro=None):
            self.chamadas, self.erro = [], erro

        def inserir(self, tabela, linhas, conflito=None, **kw):
            if self.erro:
                raise self.erro
            self.chamadas.append(("inserir", tabela, linhas, conflito))

        def apagar(self, tabela, filtros):
            self.chamadas.append(("apagar", tabela, filtros))

    def test_grava_a_carteira_e_depois_apaga_as_outras_datas(self):
        from nuvem.sincronizar import publicar_previa
        sb = self.Sb()
        r = {"previa": [{"id_cliente": "C1", "segmento_atual": None, "saldo": 1.0, "dias_atraso": 3,
                         "qtd_contratos": 1, "atributos": {}}]}
        self.assertIsNone(publicar_previa(sb, 5, 9, D0, r))
        (op1, t1, linhas, conflito), (op2, t2, filtros) = sb.chamadas
        self.assertEqual((op1, t1, conflito, op2, t2), ("inserir", "atributos_previa",
                                                        "empresa_id,credor_id,id_cliente", "apagar", "atributos_previa"))
        self.assertEqual(linhas[0]["data_base"], D0.isoformat())
        self.assertEqual((linhas[0]["empresa_id"], linhas[0]["credor_id"]), (5, 9))
        self.assertEqual(filtros, {"empresa_id": "eq.5", "credor_id": "eq.9", "data_base": f"neq.{D0.isoformat()}"})
        self.assertIsNone(publicar_previa(sb, 5, None, D0, r))       # sem carteira: não mexe
        self.assertIsNone(publicar_previa(sb, 5, 9, D0, {"previa": None}))
        self.assertEqual(len(sb.chamadas), 2)

    def test_banco_sem_o_sql_76_vira_alerta_e_nao_derruba(self):
        from nuvem.sincronizar import ALERTA_SQL76, publicar_previa
        from nuvem.supabase_api import ErroSupabase
        sb = self.Sb(ErroSupabase(404, '{"message":"relation \\"public.atributos_previa\\" does not exist"}', "u"))
        self.assertEqual(publicar_previa(sb, 5, 9, D0, {"previa": []}), ALERTA_SQL76)
