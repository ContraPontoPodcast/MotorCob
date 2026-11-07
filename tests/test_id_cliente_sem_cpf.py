"""LGPD: o CPF nunca é o id do cliente (decisão do dono, 07/11/2026; motor/pseudonimo.py).

Carga sem código de cliente (layout automático) ou código com cara de CPF → código pseudônimo estável (MX + 16
letras, HMAC com o sal da empresa); credor com código de cliente não muda; acordo, baixa e ocorrência que trazem o
CPF acham o código; a lista do dia leva o contrato (nunca o CPF); o estado antigo com CPF é trocado uma vez; a trava
barra CPF em id_cliente antes do banco e do Storage. Só CPFs fictícios (gerados com dígito válido, de ninguém).
"""
import csv
import json
import re
import tempfile
import unittest
from datetime import date
from pathlib import Path

import rodar_dia
from motor import pseudonimo as P
from motor.carteira import montar
from motor.detectar import entrada_automatica
from motor.entrada import carregar_entrada
from motor.identificar import Identificador
from motor.normalizacao import gerar_cpf

RAIZ = Path(__file__).resolve().parent.parent
SAL = "ab" * 32
CPF = [gerar_cpf(800000000 + i) for i in range(1, 6)]
CPF_ZERO = gerar_cpf(12345678)            # começa com zero: a planilha pode comer
FMT = lambda c: f"{c[:3]}.{c[3:6]}.{c[6:9]}-{c[9:]}"  # noqa: E731


def _ler(p, delim=";"):
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter=delim))


def _carga(pasta: Path, nome: str, linhas: list[tuple]):
    (pasta / "bruto").mkdir(parents=True, exist_ok=True)
    txt = "CPF;CONTRATO;SALDO;DIAS_ATRASO;TEL1;EMAIL\n" + "".join(";".join(l) + "\n" for l in linhas)
    (pasta / "bruto" / nome).write_text(txt, encoding="utf-8")


class TestCodigo(unittest.TestCase):
    def test_formato_estavel_e_sem_digito(self):
        c = P.pseudonimo(SAL, CPF[0])
        self.assertRegex(c, r"^MX[BCDFGHJKLMNPQRSTVWXZ]{16}$")
        self.assertTrue(P.e_pseudonimo(c))
        self.assertEqual(c, P.pseudonimo(SAL, CPF[0]))                     # mesmo cliente, mesmo código
        self.assertEqual(c, P.pseudonimo(SAL, FMT(CPF[0])))                # formatado ou não
        self.assertEqual(P.pseudonimo(SAL, CPF_ZERO), P.pseudonimo(SAL, CPF_ZERO.lstrip("0")))  # zero comido
        self.assertNotEqual(c, P.pseudonimo("cd" * 32, CPF[0]))           # outra empresa, outro código
        self.assertNotEqual(c, P.pseudonimo(SAL, CPF[1]))
        self.assertFalse(re.search(r"\d", c))
        self.assertFalse(P.parece_cpf(c))

    def test_parece_cpf(self):
        self.assertTrue(P.parece_cpf(CPF[0]))
        self.assertTrue(P.parece_cpf(FMT(CPF[0])))
        self.assertTrue(P.parece_cpf("000.000.000-00"))                    # formatado: sempre barra
        self.assertFalse(P.parece_cpf(CPF[0][:10] + str((int(CPF[0][10]) + 1) % 10)))   # dígito errado
        self.assertFalse(P.parece_cpf("11111111111"))
        self.assertFalse(P.parece_cpf("X0001"))
        self.assertFalse(P.parece_cpf(CPF[0][1:]))                          # 10 dígitos: não é o padrão
        self.assertFalse(P.parece_cpf(""))

    def test_sal_so_quando_precisa(self):
        chamado = []
        ps = P.Pseudonimizador(lambda: chamado.append(1) or SAL)
        self.assertEqual(ps("X0001"), "X0001")
        self.assertEqual(chamado, [])                                      # código de cliente: nem busca o sal
        self.assertEqual(ps(CPF[0]), P.pseudonimo(SAL, CPF[0]))
        self.assertEqual(ps.originais, {P.pseudonimo(SAL, CPF[0]): CPF[0]})
        with self.assertRaises(RuntimeError):
            P.Pseudonimizador(lambda: "")(CPF[0])


class TestCargaSemCodigo(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        _carga(self.tmp, "carga_2026-09-01.csv", [
            (CPF[0], "CT01", "1250,40", "30", "11988880001", "a@exemplo.invalid"),
            (FMT(CPF[1]), "CT02", "380,00", "15", "21977770002", ""),
            (CPF[1], "CT03", "100,00", "10", "", ""),                     # mesmo cliente, outro contrato
            (CPF_ZERO.lstrip("0"), "CT04", "90,00", "200", "31966660004", ""),
        ])
        self.ent, self.info = entrada_automatica(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def _ids(self):
        return {l["id_cliente"] for l in _ler(self.tmp / "base" / "clientes.csv")}

    def test_o_id_e_o_codigo_e_o_cpf_nao_sai(self):
        self.assertTrue(P.id_do_cpf(self.ent.base))
        self.assertIn("código do MotorCX", self.info["entendido"]["carga"]["ID do cliente"])
        rel = montar(self.tmp, self.ent, chave=SAL)
        esperado = {P.pseudonimo(SAL, c) for c in (CPF[0], CPF[1], CPF_ZERO)}
        self.assertEqual(self._ids(), esperado)
        self.assertEqual(rel["ids_pseudonimos"], 3)
        for arq in ("clientes.csv", "na_carga.csv", "atributos.csv", "fora_do_estoque.csv", "pagamentos.csv"):
            texto = (self.tmp / "base" / arq).read_text(encoding="utf-8")
            for c in CPF[:2] + [CPF_ZERO, CPF_ZERO.lstrip("0")]:
                self.assertNotIn(c, texto, arq)
        # o CPF fica só onde já ficava (local, nunca sobe): pessoas.csv e ids_originais.csv
        self.assertEqual(P.ler_originais(self.tmp / "base")[P.pseudonimo(SAL, CPF[0])], CPF[0])
        # outro dia, outro formato: o mesmo código (TAG, trilha, régua e fatura continuam)
        _carga(self.tmp, "carga_2026-09-02.csv", [
            (FMT(CPF[0]), "CT01", "1250,40", "31", "11988880001", ""),
            (CPF[1], "CT02", "380,00", "16", "21977770002", ""),
            (CPF_ZERO, "CT04", "90,00", "201", "31966660004", ""),
        ])
        montar(self.tmp, entrada_automatica(self.tmp)[0], chave=SAL)
        self.assertEqual(self._ids(), esperado)

    def test_acordo_baixa_e_ocorrencia_com_cpf_acham_o_codigo(self):
        (self.tmp / "acordo").mkdir()
        (self.tmp / "acordo" / "acordo_2026-09-01.csv").write_text(
            f"CPF;ACORDO;PARCELA;VENCIMENTO;VALOR\n{FMT(CPF[0])};A1;1;05/09/2026;100,00\n", encoding="utf-8")
        ent = entrada_automatica(self.tmp)[0]
        rel = montar(self.tmp, ent, chave=SAL)
        parc = _ler(self.tmp / "base" / "parcelas.csv")
        self.assertEqual({p["id_cliente"] for p in parc if p["id_acordo"] == "A1"}, {P.pseudonimo(SAL, CPF[0])})
        self.assertNotIn("nao_encontrado", json.dumps(rel["identificacao"]))
        ident = Identificador.da_base(self.tmp / "base")
        self.assertEqual(ident.resolver(CPF[1]), (P.pseudonimo(SAL, CPF[1]), "codigo"))
        self.assertEqual(ident.resolver(FMT(CPF[1]))[0], P.pseudonimo(SAL, CPF[1]))

    def test_lista_do_dia_leva_o_contrato_e_nenhum_cpf(self):
        montar(self.tmp, self.ent, chave=SAL)
        base = self.tmp / "base"
        (self.tmp / "ret").mkdir()
        r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", self.tmp / "ret", date(2026, 9, 1),
                                pasta_estado=self.tmp / "estado", pasta_saida=self.tmp / "saida", out=lambda *a: None)
        self.assertTrue(r["fila"])
        self.assertTrue(all(P.e_pseudonimo(i) for i in r["estados"]))
        ids = sorted((self.tmp / "saida" / "2026-09-01" / "ids").rglob("*.csv"))
        self.assertTrue(ids)
        for arq in ids:
            linhas = _ler(arq)
            self.assertEqual(list(linhas[0])[:2], ["id_cliente", "contato"], arq.name)
            self.assertEqual(list(linhas[0])[-1], "contrato", arq.name)    # coluna nova no fim: cruza no sistema
            for l in linhas:
                self.assertTrue(P.e_pseudonimo(l["id_cliente"]))
            self.assertNotRegex(arq.read_text(encoding="utf-8"), "|".join(CPF[:2] + [CPF_ZERO.lstrip("0")]))
        sms = {l["id_cliente"]: l["contrato"] for f in ids if f.name in ("sms.csv", "whatsapp.csv") for l in _ler(f)}
        self.assertEqual(sms.get(P.pseudonimo(SAL, CPF[1])), "CT02|CT03")
        for nome in ("fila_do_dia.csv",):
            self.assertNotIn(CPF[0], (self.tmp / "saida" / "2026-09-01" / nome).read_text(encoding="utf-8"))
        for arq in (self.tmp / "estado").iterdir():
            self.assertNotIn(CPF[0], arq.read_text(encoding="utf-8"), arq.name)

    def test_sem_chave_usa_o_sal_local_da_pasta(self):
        montar(self.tmp, self.ent)
        sal = (self.tmp / "config" / "sal_id_cliente.txt").read_text().strip()
        self.assertEqual(self._ids(), {P.pseudonimo(sal, c) for c in (CPF[0], CPF[1], CPF_ZERO)})
        montar(self.tmp, self.ent)
        self.assertEqual(self._ids(), {P.pseudonimo(sal, c) for c in (CPF[0], CPF[1], CPF_ZERO)})


class TestCredorComCodigo(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_codigo_de_cliente_nao_muda_e_nem_busca_o_sal(self):
        import shutil
        shutil.copytree(RAIZ / "exemplos" / "empresa" / "bruto", self.tmp / "bruto")
        montar(self.tmp, carregar_entrada(RAIZ / "empresas" / "exemplo.json"),
               chave=lambda: self.fail("credor com código não precisa do sal"))
        self.assertTrue({"X0001", "X0002"} <= {l["id_cliente"] for l in _ler(self.tmp / "base" / "clientes.csv")})
        self.assertFalse((self.tmp / "base" / P.ORIGINAIS).exists())
        self.assertEqual(rodar_dia.contratos_dos_codigos(self.tmp / "base" / "clientes.csv"), {})

    def test_codigo_com_cara_de_cpf_vira_codigo_do_motorcx(self):
        (self.tmp / "bruto").mkdir()
        (self.tmp / "bruto" / "base_2026-09-01.csv").write_text(
            "COD_CLIENTE;CONTRATO;SALDO;DIAS_ATRASO;TEL1\n"
            f"{CPF[2]};CT9;100,00;10;11988880009\nX77;CT7;50,00;5;11988880007\n", encoding="utf-8")
        (self.tmp / "acordo").mkdir()
        (self.tmp / "acordo" / "acordo_2026-09-01.csv").write_text(
            f"COD_CLIENTE;ACORDO;PARCELA;VENCIMENTO;VALOR\n{CPF[2]};A9;1;05/09/2026;10,00\n", encoding="utf-8")
        ent = entrada_automatica(self.tmp)[0]
        self.assertFalse(P.id_do_cpf(ent.base))
        montar(self.tmp, ent, chave=SAL)
        self.assertEqual({l["id_cliente"] for l in _ler(self.tmp / "base" / "clientes.csv")},
                         {P.pseudonimo(SAL, CPF[2]), "X77"})
        self.assertEqual({p["id_cliente"] for p in _ler(self.tmp / "base" / "parcelas.csv") if p["id_acordo"] == "A9"},
                         {P.pseudonimo(SAL, CPF[2])})
        self.assertEqual(Identificador.da_base(self.tmp / "base").resolver(CPF[2])[0], P.pseudonimo(SAL, CPF[2]))


class TestTrocaDoEstadoAntigo(unittest.TestCase):
    """Credor que já rodou com o CPF no id: a primeira montagem com a regra nova troca tudo, uma vez."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        est, dia = self.tmp / "estado", self.tmp / "saida" / "2026-09-01"
        (dia / "ids").mkdir(parents=True)
        (dia / "bureau").mkdir()
        est.mkdir()
        a, b = CPF[0], FMT(CPF[1])
        self.a, self.b = a, b
        (est / "estados.json").write_text(json.dumps({"ultimo_dia": "2026-09-01", "estados": {
            a: {"id_cliente": a, "estado": "LOC"}, b: {"id_cliente": b, "estado": "CPA"},
            "X1": {"id_cliente": "X1", "estado": "LOC"}}}), encoding="utf-8")
        (est / "etapas.json").write_text(json.dumps({a: {"etapas": {}}, "X1": {}}), encoding="utf-8")
        (est / "bureau_enviados.json").write_text(json.dumps({a: "2026-09-01"}), encoding="utf-8")
        (est / "propensao.json").write_text(json.dumps({"clientes": {b: {"p": 0.1}}, "versao": "x"}), encoding="utf-8")
        (est / "trilha.csv").write_text(f"data,id_cliente,tag_anterior,tag,motivo,quem_marcou\r\n"
                                        f"2026-09-01,{a},,T,\"entrada, D+1\",Planejamento\r\n", encoding="utf-8")
        (est / "nuvem_trilha_enviada.txt").write_text("1")
        # o telefone do cliente X1 tem por acaso os mesmos dígitos do CPF de outro: não pode mudar
        (est / "escolhas.csv").write_text(
            "data;id_cliente;canal;contato;ordem_contato\n"
            f"2026-09-01;{a};sms;11988880001;1\n2026-09-01;X1;discador;{a};1\n", encoding="utf-8")
        (est / "eventos_aplicados.txt").write_text(f"ocorrencia:x|e1|{a}|2026-09-01\n", encoding="utf-8")
        (est / "contratos_2026-09.txt").write_text(f"CT1\ncliente:{b}\n", encoding="utf-8")
        (dia / "ids" / "sms.csv").write_text(f"id_cliente;contato\n{a};11988880001\nX1;{a}\n", encoding="utf-8")
        (dia / "bureau" / "enviar_bureau.csv").write_text(f"CPF_CNPJ;ID_CLIENTE\n{a};{a}\n", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def test_troca_uma_vez_so_na_coluna_do_cliente(self):
        ps = P.Pseudonimizador(SAL)
        r = P.migrar_pasta(self.tmp, ps, todos=False)
        na, nb = P.pseudonimo(SAL, self.a), P.pseudonimo(SAL, self.b)
        self.assertEqual(r["clientes"], 2)
        self.assertEqual(r["dias"], ["2026-09-01"])
        est = self.tmp / "estado"
        estados = json.loads((est / "estados.json").read_text())["estados"]
        self.assertEqual(set(estados), {na, nb, "X1"})
        self.assertEqual(estados[na]["id_cliente"], na)
        self.assertEqual(set(json.loads((est / "etapas.json").read_text())), {na, "X1"})
        self.assertEqual(json.loads((est / "bureau_enviados.json").read_text()), {na: "2026-09-01"})
        self.assertEqual(json.loads((est / "propensao.json").read_text())["clientes"], {nb: {"p": 0.1}})
        trilha = (est / "trilha.csv").read_bytes().decode()
        self.assertEqual(trilha, f"data,id_cliente,tag_anterior,tag,motivo,quem_marcou\r\n"
                                 f"2026-09-01,{na},,T,\"entrada, D+1\",Planejamento\r\n")   # mesmas linhas
        esc = _ler(est / "escolhas.csv")
        self.assertEqual([(l["id_cliente"], l["contato"]) for l in esc], [(na, "11988880001"), ("X1", self.a)])
        self.assertEqual((est / "eventos_aplicados.txt").read_text(), f"ocorrencia:x|e1|{na}|2026-09-01\n")
        self.assertEqual((est / "contratos_2026-09.txt").read_text(), f"CT1\ncliente:{nb}\n")
        sms = (self.tmp / "saida" / "2026-09-01" / "ids" / "sms.csv").read_text()
        self.assertEqual(sms, f"id_cliente;contato\n{na};11988880001\nX1;{self.a}\n")
        bureau = (self.tmp / "saida" / "2026-09-01" / "bureau" / "enviar_bureau.csv").read_text()
        self.assertEqual(bureau, f"CPF_CNPJ;ID_CLIENTE\n{self.a};{na}\n")      # o documento do bureau fica
        pend = json.loads((est / P.PENDENTE).read_text())
        self.assertEqual(pend, {"pares": {self.a: na, self.b: nb}, "dias": ["2026-09-01"]})
        self.assertTrue((est / P.MARCADOR).exists())
        self.assertIsNone(P.migrar_pasta(self.tmp, ps, todos=False))          # uma vez só

    def test_layout_sem_codigo_troca_tambem_o_que_nao_tem_cara_de_cpf(self):
        estados = json.loads((self.tmp / "estado" / "estados.json").read_text())
        z = CPF_ZERO.lstrip("0")                                              # CPF que perdeu o zero
        estados["estados"][z] = {"id_cliente": z}
        (self.tmp / "estado" / "estados.json").write_text(json.dumps(estados))
        r = P.migrar_pasta(self.tmp, P.Pseudonimizador(SAL), todos=True)
        self.assertEqual(r["clientes"], 4)
        novos = set(json.loads((self.tmp / "estado" / "estados.json").read_text())["estados"])
        self.assertIn(P.pseudonimo(SAL, CPF_ZERO), novos)
        self.assertTrue(all(P.e_pseudonimo(i) for i in novos))

    def test_montar_troca_o_estado_e_a_base_ja_sai_com_o_codigo(self):
        _carga(self.tmp, "carga_2026-09-02.csv", [(self.a, "CT01", "10,00", "3", "11988880001", "")])
        rel = montar(self.tmp, entrada_automatica(self.tmp)[0], chave=SAL)
        na = P.pseudonimo(SAL, self.a)
        self.assertEqual(rel["ids_rechaveados"], 3)                       # no layout sem código, X1 também
        self.assertIn(na, json.loads((self.tmp / "estado" / "estados.json").read_text())["estados"])
        self.assertEqual({l["id_cliente"] for l in _ler(self.tmp / "base" / "clientes.csv")}, {na})


class TestTrava(unittest.TestCase):
    def test_banco_nao_recebe_cpf_no_id(self):
        from nuvem.supabase_api import Supabase
        sb = Supabase("http://127.0.0.1:9", "sb_secret_teste")
        for linha in ({"id_cliente": CPF[0]}, {"id_cliente": FMT(CPF[0])}, {"contrato": f"cliente:{CPF[0]}"}):
            with self.assertRaises(P.IdComCpf):
                sb.inserir("estado_cliente", [{"empresa_id": 1, **linha}])
        with self.assertRaises(P.IdComCpf):
            sb.atualizar("fila_dia", {"id": "eq.1"}, {"id_cliente": CPF[0]})
        P.checar_linhas("estado_cliente", [{"id_cliente": "X0001"}, {"id_cliente": P.pseudonimo(SAL, CPF[0])}])

    def test_storage_nao_recebe_lista_com_cpf_no_id(self):
        with self.assertRaises(P.IdComCpf):
            P.checar_csv("ids/sms.csv", f"id_cliente;contato\n{CPF[0]};11988880001\n".encode())
        with self.assertRaises(P.IdComCpf):
            P.checar_csv("bureau/enviar_bureau.csv", f"CPF_CNPJ;ID_CLIENTE\n{CPF[0]};{CPF[0]}\n".encode())
        P.checar_csv("bureau/enviar_bureau.csv", f"CPF_CNPJ;ID_CLIENTE\n{CPF[0]};X1\n".encode())   # o documento fica
        P.checar_csv("fila_do_dia.csv", f"data,id_cliente,contato\n2026-09-01,X1,{CPF[0]}\n".encode())


class SbFalso:
    def __init__(self, falha=False):
        self.falha, self.chamadas = falha, []

    def rpc(self, nome, args):
        if self.falha:
            raise RuntimeError("Could not find the function public.rechavear_clientes")
        self.chamadas.append((nome, args))
        return len(args["pares"])


class TestNuvemPendente(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        (self.tmp / "estado").mkdir()
        (self.tmp / "saida" / "2026-09-01").mkdir(parents=True)
        (self.tmp / "estado" / P.PENDENTE).write_text(json.dumps({"pares": {CPF[0]: "MXA"}, "dias": ["2026-09-01"]}))

    def tearDown(self):
        self._tmp.cleanup()

    def test_manda_os_pares_republica_e_apaga(self):
        from nuvem.ids_cliente import aplicar_pendente
        sb, publicados = SbFalso(), []
        r = aplicar_pendente(sb, 7, 3, self.tmp, lambda d: f"emp/{d}/cart", lambda s, p, pre: publicados.append(pre),
                             out=lambda *a: None)
        self.assertIsNone(r)
        self.assertEqual(sb.chamadas, [("rechavear_clientes", {"empresa": 7, "credor": 3,
                                                               "pares": [{"de": CPF[0], "para": "MXA"}]})])
        self.assertEqual(publicados, ["emp/2026-09-01/cart"])
        self.assertFalse((self.tmp / "estado" / P.PENDENTE).exists())

    def test_banco_sem_o_sql73_alerta_e_tenta_de_novo(self):
        from nuvem.ids_cliente import ALERTA_SQL73, aplicar_pendente
        r = aplicar_pendente(SbFalso(falha=True), 7, 3, self.tmp, str, lambda *a: None, out=lambda *a: None)
        self.assertEqual(r, ALERTA_SQL73)
        self.assertTrue((self.tmp / "estado" / P.PENDENTE).exists())


class TestFaturamento(unittest.TestCase):
    def test_chave_do_faturamento_nao_muda_com_a_troca_do_id(self):
        from nuvem.faturamento import chave_cliente
        novo = P.pseudonimo(SAL, CPF[0])
        antes = chave_cliente(SAL, CPF[0], {})                            # sem CPF na carteira: pelo id antigo
        self.assertEqual(chave_cliente(SAL, novo, {}, {novo: CPF[0]}), antes)
        self.assertEqual(chave_cliente(SAL, novo, {novo: "p_x"}), chave_cliente(SAL, CPF[0], {CPF[0]: "p_x"}))


if __name__ == "__main__":
    unittest.main()
