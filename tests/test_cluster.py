"""Cluster por regras da empresa (motor/cluster.py)."""
import tempfile
import unittest
from datetime import date
from pathlib import Path

import rodar_dia
from motor.cluster import carregar_regras, classificar, versao
from motor.marcacao import Cliente, EstadoCliente, processar_dia
from motor.regua import carregar_regua

RAIZ = Path(__file__).resolve().parent.parent
EX = RAIZ / "exemplos" / "empresa"
DIA = date(2026, 9, 1)


def _cli(saldo=100.0, atraso=10, **atrib):
    return Cliente("C1", DIA, saldo, atraso, None, 1, atrib)


class TestRegras(unittest.TestCase):
    def test_primeira_regra_que_bate_vale(self):
        regras, avisos = carregar_regras([
            {"ordem": 2, "codigo": "gr", "condicoes": [{"campo": "saldo", "op": ">=", "valor": "1.000,00"}]},
            {"ordem": 1, "codigo": "VE", "condicoes": [{"campo": "PRODUTO", "op": "=", "valor": "veiculo"}]},
        ])
        self.assertEqual((avisos, [r.codigo for r in regras]), ([], ["VE", "GR"]))
        self.assertEqual(classificar(regras, _cli(5000, PRODUTO="VEICULO"), DIA).codigo, "VE")  # ordem manda
        self.assertEqual(classificar(regras, _cli(5000, PRODUTO="CARTAO"), DIA).codigo, "GR")
        self.assertIsNone(classificar(regras, _cli(10, PRODUTO="CARTAO"), DIA))

    def test_operadores(self):
        def bate(op, valor, **kw):
            regras, _ = carregar_regras([{"codigo": "X", "condicoes": [{"campo": "F", "op": op, "valor": valor}]}])
            return classificar(regras, _cli(**kw), DIA) is not None
        self.assertTrue(bate("em", ["SP", "rj"], F="RJ"))
        self.assertTrue(bate("nao_em", "SP;RJ", F="MG"))
        self.assertTrue(bate(">", "700", F="720"))
        self.assertFalse(bate(">", "700", F="sem score"))   # texto não passa em comparação numérica
        self.assertTrue(bate("=", "10", F="10,00"))
        self.assertTrue(bate("contem", "cart", F="Cartão Gold".replace("ã", "a")))
        self.assertTrue(bate("vazio", None, F=""))
        self.assertTrue(bate("preenchido", None, F="x"))
        self.assertFalse(bate("preenchido", None))           # coluna inexistente = vazia

    def test_atraso_e_do_dia_da_revisao(self):
        regras, _ = carregar_regras([{"codigo": "V", "condicoes": [{"campo": "dias_atraso", "op": ">", "valor": 90}]}])
        c = _cli(atraso=80)
        self.assertIsNone(classificar(regras, c, DIA))
        self.assertEqual(classificar(regras, c, date(2026, 9, 20)).codigo, "V")

    def test_regra_com_erro_vira_aviso_e_nao_para_a_rotina(self):
        regras, avisos = carregar_regras([
            {"codigo": "A-1", "condicoes": []},
            {"codigo": "OK", "condicoes": [{"campo": "saldo", "op": ">", "valor": "muito"}]},
            {"codigo": "BL", "condicoes": [], "canais_bloqueados": ["whatsapp", "fax"]},
        ])
        self.assertEqual([r.codigo for r in regras], ["BL"])
        self.assertEqual(len(avisos), 3)
        self.assertEqual(regras[0].bloqueados, {"whatsapp"})

    def test_regua_usa_o_que_o_cluster_define(self):
        regras, _ = carregar_regras([{"codigo": "SD", "condicoes": [], "so_digital": True, "pacote": "p1",
                                      "revalida_dias": 15, "voz_d0": True}])
        r = carregar_regua().com_clusters(regras)
        self.assertEqual(r.cluster_de(_cli(), DIA), "SD")
        self.assertEqual(r.enriquecimento("SD")["pacote"], "p1")
        self.assertEqual(r.canais_bloqueados("SD"), {"agente_voz", "discador"})
        self.assertTrue(r.voz_d0("SD"))
        self.assertEqual(r.enriquecimento("ZZ")["pacote"], "básico")        # cluster que saiu das regras
        self.assertEqual(carregar_regua().cluster_de(_cli(6000, 10), DIA), "A1")  # sem regras: padrão

    def test_mudar_regras_revisa_o_cluster_na_rotina_seguinte(self):
        regua = carregar_regua()
        c = _cli(100, 10, PRODUTO="CARTAO")
        est = {"C1": EstadoCliente("C1", DIA, "B1", "B1", "2026-09")}
        regras, _ = carregar_regras([{"codigo": "CA", "condicoes": [{"campo": "PRODUTO", "op": "=", "valor": "CARTAO"}]}])
        trilha = processar_dia(est, {"C1": c}, [], {}, date(2026, 9, 2), regua.com_clusters(regras))
        self.assertEqual((est["C1"].cluster_atual, est["C1"].cluster_origem), ("CA", "B1"))
        self.assertEqual(trilha[0]["motivo"], "regras de cluster alteradas")
        self.assertEqual(est["C1"].cluster_versao, versao(regras))
        self.assertEqual(processar_dia(est, {"C1": c}, [], {}, date(2026, 9, 3), regua.com_clusters(regras)), [])


class TestRotina(unittest.TestCase):
    def test_base_bruta_com_clusters_da_empresa(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "base"
            rel = rodar_dia.preparar_base(RAIZ / "empresas" / "exemplo.json", EX / "bruto", base)
            atrib = (base / "atributos.csv").read_text()
            self.assertNotIn("98888", atrib)          # telefone não vira atributo
            self.assertNotIn("@", atrib)
            self.assertIn({"nome": "PRODUTO", "tipo": "texto"}, rel["colunas"])
            self.assertIn({"nome": "SALDO_DEVEDOR", "tipo": "numero"}, rel["colunas"])
            regras = [*__import__("json").loads((EX / "clusters.json").read_text()),
                      {"ordem": 99, "codigo": "SC", "condicoes": [{"campo": "SCORE", "op": ">", "valor": 1}]}]
            r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", Path(tmp) / "ret",
                                    date(2026, 9, 2), pasta_estado=Path(tmp) / "estado",
                                    pasta_saida=Path(tmp) / "saida", clusters=regras,
                                    atributos=base / "atributos.csv", out=lambda *a: None)
        self.assertEqual({k: e.cluster_atual for k, e in r["estados"].items()},
                         {"X0001": "CA", "X0002": "RJ", "X0003": "VE"})
        # RJ bloqueia WhatsApp; CA é só digital
        self.assertNotIn("X0002", {l["id_cliente"] for l in r["fila"] if l["canal"] == "whatsapp"})
        self.assertTrue(any("SCORE" in a for a in r["alertas"]))   # coluna que não existe na base


if __name__ == "__main__":
    unittest.main()


class TestModelosDePersona(unittest.TestCase):
    """Catálogo de modelos de persona: condições válidas, SQL igual ao JSON e efeito esperado."""
    def setUp(self):
        import json
        self.dados = json.loads((RAIZ / "regras" / "personas_modelo.json").read_text(encoding="utf-8"))["modelos"]

    def test_modelos_validos_e_iguais_no_sql(self):
        from motor.cluster import carregar_personas
        from motor.estrategia import CANAIS
        sql = (RAIZ / "supabase" / "migrations" / "20261011000001_personas_modelo.sql").read_text(encoding="utf-8")
        pers, avisos = carregar_personas([{**m, "id": i} for i, m in enumerate(self.dados)])
        self.assertEqual((len(pers), avisos), (len(self.dados), []))
        for m in self.dados:
            self.assertIn(m["propensao"], ("digital", "analogico"))
            self.assertTrue(set(m["canais_sugeridos"]) <= set(CANAIS), m["id"])
            self.assertIn(f'"id": "{m["id"]}"', sql)
            self.assertIn(m["descricao"].replace("'", "''"), sql)

    def test_cada_perfil_cai_no_modelo_esperado(self):
        from datetime import date
        from motor.cluster import carregar_personas, persona_de
        from motor.marcacao import Cliente
        pers, _ = carregar_personas([{**m, "id": m["id"]} for m in self.dados])
        hoje = date(2026, 10, 5)

        def cli(saldo=800, atraso=20, **atrib):
            base = {"tem_whatsapp": "não", "tem_rcs": "não", "tem_email": "não", "tem_celular": "sim", "so_fixo": "não"}
            return Cliente("C", hoje, saldo, atraso, atributos={**base, **atrib})

        casos = {"so-telefone-fixo": cli(so_fixo="sim", tem_celular="não"),
                 "senior": cli(idade="67", tem_whatsapp="sim"),
                 "digital-nativo": cli(idade="24", tem_whatsapp="sim"),
                 "ticket-alto": cli(saldo=25000, atraso=90, tem_whatsapp="sim"),
                 "conectado": cli(saldo=3000, atraso=60, tem_whatsapp="sim", tem_email="sim"),
                 "atraso-recente-ticket-baixo": cli(),
                 "atraso-longo": cli(saldo=3000, atraso=400, tem_rcs="sim"),
                 "sem-canal-digital": cli(saldo=3000, atraso=60),
                 "celular-sem-whatsapp": cli(saldo=3000, atraso=60, tem_rcs="sim")}
        for esperado, c in casos.items():
            self.assertEqual(persona_de(pers, c, hoje).id, esperado, esperado)
