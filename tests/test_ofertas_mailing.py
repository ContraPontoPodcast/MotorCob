"""Ofertas prontas do arquivo para o agente de voz (SQL 130; SPEC_OFERTAS_v2), no motor e na nuvem.

Motor: a leitura das colunas oferta1..3_* (número pt-BR, data, desconto só em %), o descarte que nunca corrige
(incompleta, vencida, conta que não fecha; os casos de tests/dados/ofertas_casos.json, os mesmos da VM e do site), as
colunas nunca viram atributo, o contrato principal (maior saldo) com vários contratos, a carga geral nova troca as
ofertas, base/ofertas.csv só de quem está na carga e o relatório só com contagens. Nuvem: só a lista de hoje do agente
vai ao banco. Só dados fictícios.
"""
import csv
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from motor import ofertas_mailing as OM
from motor.entrada import LayoutBase, converter_base

RAIZ = Path(__file__).resolve().parents[1]
CASOS = json.loads((RAIZ / "tests" / "dados" / "ofertas_casos.json").read_text(encoding="utf-8"))
HOJE = date.fromisoformat(CASOS["hoje"])

CAB = ["COD", "CONTRATO", "SALDO", "ATRASO", "TEL", "UF", "OF1_PARC", "OF1_VLR", "OF1_DESC", "OF1_VAL", "OF1_TOT",
       "OF2_PARC", "OF2_VLR", "OF2_VAL", "OF2_ID"]
MAPA = {"oferta1_parcelas": "OF1_PARC", "oferta1_valor_parcela": "OF1_VLR", "oferta1_desconto": "OF1_DESC",
        "oferta1_validade": "OF1_VAL", "oferta1_valor_total": "OF1_TOT", "oferta2_parcelas": "OF2_PARC",
        "oferta2_valor_parcela": "OF2_VLR", "oferta2_validade": "OF2_VAL", "oferta2_id": "OF2_ID"}


def _linha(cod, contrato, saldo, of1=None, of2=None, uf="SP"):
    l = {"COD": cod, "CONTRATO": contrato, "SALDO": saldo, "ATRASO": "30", "TEL": "11987650000", "UF": uf}
    for k, v in zip(("OF1_PARC", "OF1_VLR", "OF1_DESC", "OF1_VAL", "OF1_TOT"), of1 or ()):
        l[k] = v
    for k, v in zip(("OF2_PARC", "OF2_VLR", "OF2_VAL", "OF2_ID"), of2 or ()):
        l[k] = v
    return l


def _carga(pasta: Path, nome: str, linhas: list[dict]) -> Path:
    arq = pasta / nome
    with open(arq, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAB, delimiter=";", restval="")
        w.writeheader()
        w.writerows(linhas)
    return arq


LINHAS = [
    _linha("C1", "K1", "2.000,00", ("1", "1.200,00", "40", "20/11/2026", "1.200,00"), ("6", "260,00", "20/11/2026", "B-2")),
    _linha("C1", "K2", "500,00", ("2", "200,00", "", "20/11/2026", "")),
    _linha("C2", "K3", "300,00", ("1", "250,00", "", "10/11/2026", "")),                 # vencida
    _linha("C3", "K4", "400,00", ("6", "260,00", "", "20/11/2026", "1.600,00")),          # conta não fecha
    _linha("C4", "K5", "100,00"),                                                         # sem oferta
]


def _converter(arquivos, mapa=MAPA):
    tmp = Path(arquivos[0]).parent
    lay = LayoutBase(colunas={"id_cliente": "COD", "id_contrato": "CONTRATO", "saldo": "SALDO", "dias_atraso": "ATRASO",
                              **mapa}, telefones=["TEL"])
    rel = converter_base(arquivos, lay, tmp / "base")
    return tmp / "base", rel


class TestCasosCompartilhados(unittest.TestCase):
    def test_arquivo(self):
        for c in CASOS["arquivo"]:
            with self.subTest(c["nome"]):
                o, motivo = OM.oferta(c["valores"], c["n"])
                if o is not None:
                    motivo = OM.descarte(o, HOJE)
                    if motivo:
                        o = None
                self.assertEqual(motivo, c["motivo"])
                self.assertEqual(o, c["oferta"])

    def test_numero_e_data(self):
        self.assertEqual(OM.numero("1.500,50"), 1500.5)
        self.assertEqual(OM.numero("R$ 1.200,00"), 1200.0)
        self.assertEqual(OM.numero("1.234.567"), 1234567.0)
        self.assertEqual(OM.numero("1500.50"), 1500.5)
        self.assertIsNone(OM.numero("abc"))
        self.assertIsNone(OM.numero("nan"))
        self.assertEqual(OM.data("2026-11-20"), date(2026, 11, 20))
        self.assertEqual(OM.data("20-11-2026"), date(2026, 11, 20))
        self.assertEqual(OM.data("11/20/2026", "%m/%d/%Y"), date(2026, 11, 20))     # o formato do layout primeiro


class TestCarga(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_colunas_de_oferta_nunca_viram_atributo(self):
        base, _ = _converter([_carga(self.tmp, "carga_2026-11-12.csv", LINHAS)])
        cab = (base / "atributos.csv").read_text(encoding="utf-8").splitlines()[0].split(";")
        self.assertIn("UF", cab)
        for c in MAPA.values():
            self.assertNotIn(c, cab)

    def test_ofertas_como_vieram_e_contrato_principal(self):
        base, rel = _converter([_carga(self.tmp, "carga_2026-11-12.csv", LINHAS)])
        linhas = {(l["id_cliente"], l["contrato"]): l for l in OM.ler(base)}
        self.assertEqual(set(linhas), {("C1", "K1"), ("C1", "K2")})
        k1 = linhas[("C1", "K1")]
        self.assertTrue(k1["principal"])                         # maior saldo
        self.assertFalse(linhas[("C1", "K2")]["principal"])
        self.assertEqual(k1["ofertas"], [
            {"id": "arq-1", "parcelas": 1, "valor_parcela": 1200.0, "desconto_pct": 40.0, "validade": "2026-11-20",
             "valor_total": 1200.0},
            {"id": "B-2", "parcelas": 6, "valor_parcela": 260.0, "validade": "2026-11-20"}])    # na ordem do arquivo
        r = rel["ofertas"]
        self.assertEqual((r["colunas"], r["clientes_com_oferta"], r["ofertas"], r["varios_contratos"]), (True, 1, 2, 1))
        self.assertEqual(r["descartadas"], {"incompleta": 0, "vencida": 1, "conta": 1})

    def test_carga_geral_nova_troca_as_ofertas(self):
        a1 = _carga(self.tmp, "carga_2026-11-10.csv", LINHAS)
        nova = [_linha("C1", "K1", "2.000,00"), _linha("C2", "K3", "300,00", ("3", "100,00", "", "30/11/2026", ""))]
        a2 = _carga(self.tmp, "carga_2026-11-12.csv", nova)
        base, _ = _converter([a1, a2])
        self.assertEqual({l["id_cliente"] for l in OM.ler(base)}, {"C2"})

    def test_sem_colunas_de_oferta_nada_muda(self):
        base, rel = _converter([_carga(self.tmp, "carga_2026-11-12.csv", LINHAS)], mapa={})
        self.assertFalse((base / "ofertas.csv").exists())
        self.assertFalse(rel["ofertas"]["colunas"])
        cab = (base / "atributos.csv").read_text(encoding="utf-8").splitlines()[0].split(";")
        self.assertIn("OF1_PARC", cab)                            # sem mapeamento, é coluna como outra qualquer

    def test_relatorio_so_com_contagens(self):
        _, rel = _converter([_carga(self.tmp, "carga_2026-11-12.csv", LINHAS)])
        texto = json.dumps(rel["ofertas"])
        for v in ("1200", "260", "C1", "K1"):
            self.assertNotIn(v, texto)


class TestDetectar(unittest.TestCase):
    def test_layout_leva_as_colunas_de_oferta_apontadas(self):
        from motor import detectar as D
        tmp = Path(tempfile.mkdtemp())
        arq = _carga(tmp, "carga_2026-11-12.csv", LINHAS)
        lay = D.layout_base(arq, {}, {"id_cliente": "COD", **MAPA})
        self.assertEqual(lay["colunas"]["oferta1_parcelas"], "OF1_PARC")
        self.assertNotIn("oferta1_parcelas", D.layout_base(arq, {}, {"id_cliente": "COD"})["colunas"])


class SbPublicar:
    def __init__(self, usa=True):
        self.chamadas, self.usa = [], usa

    def rpc(self, nome, args):
        self.chamadas.append((nome, args))
        return {"gravados": len(args["linhas"]) if self.usa else 0, "apagados": 0, "usa_arquivo": self.usa}


class TestPublicar(unittest.TestCase):
    def _pasta(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "base").mkdir()
        of = [{"id": "arq-1", "parcelas": 1, "valor_parcela": 100.0, "validade": "2026-11-20"}]
        OM.gravar(tmp / "base", [{"id_cliente": i, "contrato": "", "principal": True, "ofertas": of}
                                 for i in ("C1", "C2", "C3")])
        (tmp / "saida" / "ids").mkdir(parents=True)
        (tmp / "saida" / "ids" / "agente_voz.csv").write_text("id_cliente;contato\nC1;11987654321\nC3;11987654323\n")
        (tmp / "saida" / "ids" / "sms.csv").write_text("id_cliente;contato\nC2;11987654322\n")
        return tmp

    def test_so_a_lista_de_hoje_do_agente(self):
        from nuvem import ofertas_voz as NO
        tmp = self._pasta()
        sb = SbPublicar()
        self.assertIsNone(NO.publicar(sb, 7, 5, tmp, HOJE, tmp / "saida", out=lambda *_: None))
        (nome, a), = sb.chamadas
        self.assertEqual(nome, "publicar_ofertas_voz")
        self.assertEqual({l["id_cliente"] for l in a["linhas"]}, {"C1", "C3"})
        self.assertTrue(a["substituir"])
        self.assertEqual(set(a["linhas"][0]), {"id_cliente", "contrato", "principal", "ofertas"})

    def test_so_api_nao_grava_e_para(self):
        from nuvem import ofertas_voz as NO
        tmp = self._pasta()
        sb = SbPublicar(usa=False)
        NO.publicar(sb, 7, 5, tmp, HOJE, tmp / "saida", out=lambda *_: None)
        self.assertEqual(len(sb.chamadas), 1)

    def test_resumo(self):
        from nuvem import ofertas_voz as NO
        self.assertIsNone(NO.resumo({"ofertas": {"colunas": False}}))
        r = NO.resumo({"ofertas": {"colunas": True, "clientes_com_oferta": 3, "descartadas": {"vencida": 1}}})
        self.assertEqual((r["clientes_com_oferta"], r["descartadas"]), (3, {"vencida": 1}))


if __name__ == "__main__":
    unittest.main()
