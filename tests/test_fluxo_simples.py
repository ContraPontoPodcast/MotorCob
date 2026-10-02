"""O fluxo da operação: carga do dia → ações → ocorrência (CPC sim/não) → telefone Hot + canal flegado."""
import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

import rodar_dia
from motor.certificacao import Certificacao
from motor.fila import gerar_fila
from motor.marcacao import Cliente, EstadoCliente
from motor.regua import carregar_regua

RAIZ = Path(__file__).resolve().parent.parent
EMPRESA = RAIZ / "empresas" / "exemplo.json"
CAB = "COD_CLIENTE;CONTRATO;CPF;SALDO_DEVEDOR;DT_VENCIMENTO;PRODUTO;UF;TEL1;WHATS_TEL1;TEL2;TEL3;EMAIL;BLOQUEIO\n"


def _csv(p: Path, texto: str) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(texto, encoding="utf-8")
    return p


class TestFluxo(unittest.TestCase):
    def _rodar(self, tmp, dia):
        base = tmp / "base"
        rodar_dia.preparar_base(EMPRESA, tmp / "bruto", base)
        return rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", tmp / "ret", dia,
                                   pasta_estado=tmp / "estado", pasta_saida=tmp / "saida",
                                   ocorrencias=tmp / "oc", entrada=EMPRESA, out=lambda *a: None)

    def test_cpc_marca_o_telefone_da_acao_como_hot_e_flega_o_canal(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            _csv(tmp / "bruto" / "carga_2026-09-01.csv", CAB +
                 "A1;K1;;900,00;01/08/2026;CARTAO;SP;11988880001;S;11977770001;;a1@exemplo.invalid;\n"
                 "B1;K2;;500,00;01/08/2026;CARTAO;SP;21988880002;S;;;;\n")
            r = self._rodar(tmp, date(2026, 9, 2))                       # D+1: WhatsApp
            wa = [l for l in r["fila"] if l["canal"] == "whatsapp"]
            self.assertEqual({(l["id_cliente"], l["contato"]) for l in wa},
                             {("A1", "11988880001"), ("B1", "21988880002")})
            self.assertEqual({l["status_contato"] for l in wa}, {"WHATSAPP"})
            # a ocorrência só diz se foi CPC; o motor sabe que foi o 11988880001 no WhatsApp
            _csv(tmp / "oc" / "ocorrencia_2026-09-02.csv", "COD_CLIENTE;DT_ACAO;CANAL;OCORRENCIA\n"
                 "A1;02/09/2026 10:00;WHATS;CPC\nB1;02/09/2026 10:00;WHATS;NAO CPC\n")
            r = self._rodar(tmp, date(2026, 9, 4))                       # 48h depois: negociação
            est = r["estados"]["A1"]
            self.assertEqual((est.estado, est.canal_atual, est.contato_localizador),
                             ("CPA", "whatsapp", "11988880001"))
            linhas = [l for l in r["fila"] if l["id_cliente"] == "A1"]
            self.assertEqual([(l["canal"], l["contato"], l["status_contato"]) for l in linhas],
                             [("whatsapp", "11988880001", "HOT")])
            self.assertEqual(r["contatos_status"]["HOT"], 1)
            self.assertEqual(r["estados"]["B1"].estado, "LOC")         # não CPC: segue localizando

    def test_so_quem_esta_na_carga_do_dia_recebe_acao(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            _csv(tmp / "bruto" / "carga_2026-09-01.csv", CAB +
                 "A1;K1;;900,00;01/08/2026;CARTAO;SP;11988880001;S;;;;\n"
                 "B1;K2;;500,00;01/08/2026;CARTAO;SP;21988880002;S;;;;\n")
            _csv(tmp / "bruto" / "carga_2026-09-02.csv", CAB +            # colchão/preventivo de hoje: só A1
                 "A1;K1;;880,00;01/08/2026;CARTAO;SP;11988880001;S;;;;\n")
            r = self._rodar(tmp, date(2026, 9, 2))
            self.assertEqual({l["id_cliente"] for l in r["fila"]}, {"A1"})
            self.assertEqual(r["na_carga"], 1)
            self.assertIn("B1", r["estados"])                         # B1 não some: volta quando reaparecer
            self.assertNotEqual(r["estados"]["B1"].estado, "BLQ")


class TestExportacao(unittest.TestCase):
    def test_voz_exporta_um_numero_hot_primeiro_e_marcas_da_carga(self):
        regua = carregar_regua()
        safra = date(2026, 8, 31)                                     # D+5 = sábado 05/09: agente virtual
        est = {"C1": EstadoCliente("C1", safra, "M1", "M1", "2026-08")}
        nums = ["11900000001", "11900000002", "11900000003"]
        certs = {("C1", n): Certificacao("C1", n, "telefone", "DESCONHECIDO", 0.4) for n in nums}
        sinais = {("C1", "11900000003"): {"hot": True}, ("C1", "11900000002"): {"rcs": True}}
        fila, _, _ = gerar_fila(est, {"C1": Cliente("C1", safra, 900.0, 30)}, certs, {}, {}, date(2026, 9, 5),
                                regua, [], sinais)
        voz = [l for l in fila if l["canal"] == "agente_voz"]
        self.assertEqual([(l["contato"], l["status_contato"]) for l in voz], [("11900000003", "HOT")])

    def test_carga_aceita_marca_hot_whatsapp_e_rcs_por_telefone(self):
        import json
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            cfg = json.loads(EMPRESA.read_text(encoding="utf-8"))
            cfg["base"]["telefones"] = [{"coluna": "TEL1", "whatsapp": "WA1", "rcs": "RCS1", "hot": "HOT1"}, "TEL2"]
            (tmp / "e.json").write_text(json.dumps(cfg), encoding="utf-8")
            _csv(tmp / "bruto" / "carga_2026-09-01.csv",
                 "COD_CLIENTE;CONTRATO;CPF;SALDO_DEVEDOR;DT_VENCIMENTO;TEL1;WA1;RCS1;HOT1;TEL2;EMAIL\n"
                 "A1;K1;;10,00;01/08/2026;11988880001;N;S;S;11977770001;\n")
            rodar_dia.preparar_base(tmp / "e.json", tmp / "bruto", tmp / "base")
            with open(tmp / "base" / "contatos.csv", newline="", encoding="utf-8") as f:
                c = {l["contato"]: l for l in csv.DictReader(f, delimiter=";")}
        self.assertEqual((c["11988880001"]["hot"], c["11988880001"]["rcs_valido"], c["11988880001"]["whatsapp_valido"]),
                         ("1", "1", "0"))
        self.assertEqual((c["11977770001"]["hot"], c["11977770001"]["rcs_valido"]), ("", ""))   # neutro


if __name__ == "__main__":
    unittest.main()


class TestTodosOsNumeros(unittest.TestCase):
    NUMS = ["11900000001", "11900000002", "11900000003"]

    def _fila(self, est, dia, canais=None):
        from motor.cluster import carregar_regras
        regras, _ = carregar_regras([])
        regua = carregar_regua().com_clusters(regras, {}, None, canais or {})
        certs = {("C1", n): Certificacao("C1", n, "telefone", "DESCONHECIDO", 0.4) for n in self.NUMS}
        return gerar_fila({"C1": est}, {"C1": Cliente("C1", est.safra, 900.0, 30)}, certs, {}, {}, dia, regua, [])[0], regua

    def test_empresa_escolhe_todos_os_numeros_no_canal(self):
        safra = date(2026, 8, 31)                                     # D+5 = sábado: agente virtual
        cfg = {"agente_voz": {"canal": "agente_voz", "numeros_por_cliente": 99}}
        fila, _ = self._fila(EstadoCliente("C1", safra, "M1", "M1", "2026-08"), date(2026, 9, 5), cfg)
        self.assertEqual(len([l for l in fila if l["canal"] == "agente_voz"]), 3)
        fila, _ = self._fila(EstadoCliente("C1", safra, "M1", "M1", "2026-08"), date(2026, 9, 5))
        self.assertEqual(len([l for l in fila if l["canal"] == "agente_voz"]), 1)   # padrão: 1

    def test_cpc_com_varios_numeros_descobre_o_hot_um_por_vez(self):
        from motor.certificacao import Evento
        from motor.entrada import _resolver
        from motor.marcacao import processar_dia
        # ocorrência sem telefone, com 3 números na ação: CPC vale, números viram candidatos
        escolhas = {("2026-09-05", "C1"): [{"canal": "agente_voz", "contato": n, "ordem_contato": i + 1, "reserva": 0}
                                          for i, n in enumerate(self.NUMS)]}
        canal, contato, _, cand = _resolver(escolhas, "C1", date(2026, 9, 5), "agente_voz")
        self.assertEqual((canal, contato, cand), ("agente_voz", "", tuple(self.NUMS)))
        safra = date(2026, 8, 31)
        est = EstadoCliente("C1", safra, "M1", "M1", "2026-08")
        cli = {"C1": Cliente("C1", safra, 900.0, 30)}
        regua = carregar_regua()
        cpc = Evento("C1", "", "telefone", "agente_voz", "cpc", date(2026, 9, 5), candidatos=tuple(self.NUMS))
        processar_dia({"C1": est}, cli, [cpc], {}, date(2026, 9, 5), regua)
        self.assertEqual((est.estado, est.canal_atual, est.contato_localizador, est.candidatos_hot),
                         ("CPA", "agente_voz", None, self.NUMS))
        cfg = {"agente_voz": {"canal": "agente_voz", "numeros_por_cliente": 99}}
        fila, _ = self._fila(est, date(2026, 9, 8), cfg)               # mesmo com "todos": 1 candidato
        self.assertEqual({(l["canal"], l["contato"]) for l in fila},   # agente virtual + discador de reserva
                         {("agente_voz", self.NUMS[0]), ("discador", self.NUMS[0])})
        # o 1º candidato não atende: sai da descoberta; o próximo entra
        nao = Evento("C1", self.NUMS[0], "telefone", "agente_voz", "nao_atendida", date(2026, 9, 8))
        processar_dia({"C1": est}, cli, [nao], {}, date(2026, 9, 8), regua)
        self.assertEqual(est.candidatos_hot, self.NUMS[1:])
        fila, _ = self._fila(est, date(2026, 9, 10), cfg)
        self.assertEqual({l["contato"] for l in fila}, {self.NUMS[1]})
        # CPC no número sozinho: esse é o Hot
        sim = Evento("C1", self.NUMS[1], "telefone", "agente_voz", "cpc", date(2026, 9, 10))
        processar_dia({"C1": est}, cli, [sim], {}, date(2026, 9, 10), regua)
        self.assertEqual((est.contato_localizador, est.candidatos_hot), (self.NUMS[1], []))


class TestRotacaoAteOHot(unittest.TestCase):
    def test_uma_passagem_por_telefone_ate_o_cpc_e_depois_fiel_ao_hot(self):
        from motor.certificacao import Evento
        from motor.marcacao import processar_dia
        nums = ["11900000001", "11900000002", "11900000003", "11900000004"]
        safra = date(2026, 9, 1)
        regua = carregar_regua()
        est = EstadoCliente("C1", safra, "M1", "M1", "2026-09")
        cli = {"C1": Cliente("C1", safra, 900.0, 30)}
        certs = {("C1", n): Certificacao("C1", n, "telefone", "DESCONHECIDO", 0.4) for n in nums}
        passo = date(2026, 9, 4)                                    # D+3: RCS → senão SMS

        def exportado():
            fila, _, _ = gerar_fila({"C1": est}, cli, certs, {}, {}, passo, regua, [])
            tel = {l["contato"] for l in fila if l["canal"] in ("rcs", "sms")}
            self.assertEqual(len(tel), 1)                           # 1 telefone por cliente
            return tel.pop()

        enviados = []
        for _ in range(5):                                          # 5 passagens sem CPC
            t = exportado()
            enviados.append(t)
            processar_dia({"C1": est}, cli, [], {}, date(2026, 9, 2), regua, enviados={"C1": [t]})
        self.assertEqual(enviados, nums + [nums[0]])                # 1, 2, 3, 4 e recomeça no 1
        # CPC no telefone exportado (o 2): vira Hot e o motor fica fiel a ele
        processar_dia({"C1": est}, cli, [Evento("C1", nums[1], "telefone", "rcs", "identidade_confirmada",
                                                date(2026, 9, 2))], {}, date(2026, 9, 2), regua,
                      enviados={"C1": [nums[1]]})
        self.assertEqual((est.estado, est.contato_localizador, est.contatos_tentados), ("CPA", nums[1], []))
        certs[("C1", nums[1])] = Certificacao("C1", nums[1], "telefone", "CERTIFICADO", 0.9)
        for d in (8, 10, 14):                                       # negociação: sempre o Hot
            fila, _, _ = gerar_fila({"C1": est}, cli, certs, {}, {}, date(2026, 9, d), regua, [])
            self.assertEqual({(l["contato"], l["status_contato"]) for l in fila if l["canal"] != "email"},
                             {(nums[1], "HOT")})
            processar_dia({"C1": est}, cli, [], {}, date(2026, 9, d), regua,
                          enviados={"C1": [l["contato"] for l in fila]})
