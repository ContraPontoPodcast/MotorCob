"""MotorCli: momentos da jornada, um passo por vez, contato certo e quem fica de fora."""
import copy
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from motor import jornada as jor
from motor.certificacao import Certificacao
from motor.retorno_canal import Registro
from rodar_jornada import rodar_jornada

HOJE = date(2026, 10, 13)          # terça-feira, dia útil
EXEMPLOS = Path(__file__).resolve().parent.parent / "exemplos" / "jornada"
REGRAS = jor.carregar_jornada()


def cli(idc="C1", **kw):
    return jor.ClienteJornada(idc, **kw)


def tel(idc, n, tipo="telefone"):
    return {"id_cliente": idc, "contato": n, "tipo": tipo}


def gerar(clientes, contatos, estado=None, hoje=HOJE, **kw):
    kw.setdefault("whatsapp_ok", set())
    return jor.gerar({c.id_cliente: c for c in clientes}, contatos, hoje, REGRAS,
                     {} if estado is None else estado, **kw)


class Regras(unittest.TestCase):
    def test_padrao_valido_e_passos_inteiros(self):
        self.assertEqual(REGRAS["hierarquia"][0], "pre_vencimento")
        self.assertIn(-5, REGRAS["momentos"]["pre_vencimento"]["passos"])

    def test_passo_fora_da_faixa(self):
        d = copy.deepcopy(REGRAS)
        d["momentos"]["boas_vindas"]["passos"][9] = [{"canal": "sms"}]
        with self.assertRaises(jor.JornadaInvalida):
            jor.validar(d)

    def test_canal_invalido_e_melhor_sem_opcoes(self):
        for acao in ({"canal": "pombo"}, {"canal": "melhor"}, {"canal": "sms", "senao": "fax"}):
            d = copy.deepcopy(REGRAS)
            d["momentos"]["ativacao"]["passos"][3] = [acao]
            with self.assertRaises(jor.JornadaInvalida):
                jor.validar(d)

    def test_estrategia_do_site_desliga_momento_e_troca_passos(self):
        d = jor.aplicar_estrategia(REGRAS, {"recencia_horas": 72, "momentos": {
            "retencao": {"ativo": False}, "boas_vindas": {"passos": {"1": [{"canal": "sms"}]}}}})
        self.assertFalse(d["momentos"]["retencao"]["ativo"])
        self.assertEqual(d["momentos"]["boas_vindas"]["passos"], {1: [{"canal": "sms"}]})
        self.assertEqual(d["recencia_horas"], 72)
        self.assertTrue(REGRAS["momentos"]["retencao"]["ativo"])      # o padrão não muda


class Momentos(unittest.TestCase):
    def test_boas_vindas_email_e_rcs(self):
        r = gerar([cli(contratacao=HOJE)], [tel("C1", "11900000001"), tel("C1", "a@b.com.br", "email")])
        self.assertEqual({(l["regua"], l["passo"], l["canal"]) for l in r.fila},
                         {("boas_vindas", "D0", "email"), ("boas_vindas", "D0", "rcs")})

    def test_ativacao_so_para_quem_nao_ativou(self):
        contatos = [tel("C1", "11900000001")]
        r = gerar([cli(contratacao=HOJE - timedelta(days=3), ativado=False)], contatos)
        self.assertEqual(r.fila[0]["regua"], "ativacao")
        r = gerar([cli(contratacao=HOJE - timedelta(days=3), ativado=True)], contatos)
        self.assertEqual(r.fila, [])
        self.assertEqual(r.motivos[jor.M_SEM_MOMENTO], 1)

    def test_pre_vencimento_tem_prioridade_e_some_quando_pago(self):
        c = cli(contratacao=HOJE - timedelta(days=3), ativado=False, vencimento=HOJE + timedelta(days=5))
        r = gerar([c], [tel("C1", "11900000001")])
        self.assertEqual({l["regua"] for l in r.fila}, {"pre_vencimento"})
        self.assertEqual(r.fila[0]["passo"], "D-5")
        c.pago = True
        self.assertEqual({l["regua"] for l in gerar([c], [tel("C1", "11900000001")]).fila}, {"ativacao"})

    def test_retencao_e_reativacao_pelos_dias_sem_atividade(self):
        contatos = [tel("C1", "11900000001")]
        r = gerar([cli(ativado=True, ultima_atividade=HOJE - timedelta(days=31))], contatos)
        self.assertEqual((r.fila[0]["regua"], r.fila[0]["passo"]), ("retencao", "D+30"))
        r = gerar([cli(ativado=True, ultima_atividade=HOJE - timedelta(days=95))], contatos)
        self.assertEqual((r.fila[0]["regua"], r.fila[0]["passo"]), ("reativacao", "D+90"))
        r = gerar([cli(ativado=True, ultima_atividade=HOJE - timedelta(days=400))], contatos)
        self.assertEqual(r.fila, [])

    def test_em_atraso_fica_com_a_cobranca_e_bloqueado_fora(self):
        r = gerar([cli("A", contratacao=HOJE, dias_atraso=3), cli("B", contratacao=HOJE, bloqueio="opt_out")],
                  [tel("A", "11900000001"), tel("B", "11900000002")])
        self.assertEqual(r.fila, [])
        self.assertEqual(r.motivos[jor.M_ATRASO], 1)
        self.assertEqual(r.motivos[jor.M_BLOQUEIO], 1)

    def test_momento_desligado_nao_gera(self):
        regras = jor.aplicar_estrategia(REGRAS, {"momentos": {"boas_vindas": {"ativo": False}}})
        r = jor.gerar({"C1": cli(contratacao=HOJE)}, [tel("C1", "11900000001")], HOJE, regras, {},
                      whatsapp_ok=set())
        self.assertEqual(r.fila, [])


class Passos(unittest.TestCase):
    def test_um_passo_por_vez_e_o_seguinte_no_dia_dele(self):
        estado, contatos = {}, [tel("C1", "11900000001"), tel("C1", "a@b.com.br", "email")]
        c = cli(contratacao=HOJE - timedelta(days=3), ativado=False)
        self.assertEqual(len(gerar([c], contatos, estado).fila), 1)
        r = gerar([c], contatos, estado, hoje=HOJE + timedelta(days=2))         # dia 5: nada novo
        self.assertEqual(r.motivos[jor.M_FEITO], 1)
        r = gerar([c], contatos, estado, hoje=HOJE + timedelta(days=4))         # dia 7: e-mail
        self.assertEqual([(l["passo"], l["canal"]) for l in r.fila], [("D+7", "email")])

    def test_passo_perdido_sai_ate_o_proximo(self):
        c = cli(contratacao=HOJE - timedelta(days=5), ativado=False)            # o D+3 caiu num feriado
        r = gerar([c], [tel("C1", "11900000001")])
        self.assertEqual(r.fila[0]["passo"], "D+3")

    def test_recencia_segura_mas_pre_vencimento_e_isento(self):
        estado = {"C1": {"momentos": {}, "ultima": (HOJE - timedelta(days=1)).isoformat()}}
        r = gerar([cli(contratacao=HOJE - timedelta(days=3), ativado=False)], [tel("C1", "11900000001")],
                  copy.deepcopy(estado))
        self.assertEqual(r.motivos[jor.M_RECENCIA], 1)
        r = gerar([cli(vencimento=HOJE + timedelta(days=2))], [tel("C1", "11900000001")], copy.deepcopy(estado))
        self.assertEqual(r.fila[0]["passo"], "D-2")

    def test_novo_vencimento_reinicia_o_episodio(self):
        estado, contatos = {}, [tel("C1", "11900000001")]
        gerar([cli(vencimento=HOJE)], contatos, estado)
        self.assertEqual(estado["C1"]["momentos"]["pre_vencimento"]["feitos"], [0])
        r = gerar([cli(vencimento=HOJE + timedelta(days=35))], contatos, estado, hoje=HOJE + timedelta(days=30))
        self.assertEqual(r.fila[0]["passo"], "D-5")

    def test_dia_sem_acao(self):
        r = gerar([cli(contratacao=HOJE)], [tel("C1", "11900000001")], janela_ok=False)
        self.assertEqual(r.fila, [])
        self.assertEqual(r.motivos[jor.M_DIA], 1)


class Contato(unittest.TestCase):
    def test_hot_primeiro_e_contestado_fora(self):
        certs = {("C1", "11900000001"): Certificacao("C1", "11900000001", "telefone", "CONTESTADO", .1),
                 ("C1", "11900000002"): Certificacao("C1", "11900000002", "telefone", "PROVAVEL", .5),
                 ("C1", "11900000003"): Certificacao("C1", "11900000003", "telefone", "CERTIFICADO", .9)}
        contatos = [tel("C1", n) for n in ("11900000001", "11900000002", "11900000003")]
        r = gerar([cli(ativado=True, ultima_atividade=HOJE - timedelta(days=30))], contatos, certs=certs)
        self.assertEqual(r.fila[0]["contato"], "11900000003")

    def test_whatsapp_so_em_numero_confirmado(self):
        regras = jor.aplicar_estrategia(REGRAS, {"momentos": {"boas_vindas": {"passos": {
            "0": [{"canal": "whatsapp", "senao": "sms"}]}}}})
        args = ({"C1": cli(contratacao=HOJE)}, [tel("C1", "11900000001")], HOJE, regras)
        self.assertEqual(jor.gerar(*args, {}, whatsapp_ok=set()).fila[0]["canal"], "sms")
        self.assertEqual(jor.gerar(*args, {}, whatsapp_ok={"11900000001"}).fila[0]["canal"], "whatsapp")

    def test_restricao_do_canal_e_canal_desligado_usam_o_senao(self):
        contatos = [tel("C1", "11900000001"), tel("C1", "a@b.com.br", "email")]
        c = cli(contratacao=HOJE - timedelta(days=3), ativado=False)
        r = gerar([c], contatos, restricoes={"11900000001": {"rcs:sem_suporte", "sms:inexistente"}})
        self.assertEqual([l["canal"] for l in r.fila], ["email"])
        r = gerar([c], contatos, canais_ativos={"email"})
        self.assertEqual([l["canal"] for l in r.fila], ["email"])

    def test_sem_contato_nao_marca_o_passo(self):
        estado = {}
        r = gerar([cli(contratacao=HOJE)], [], estado)
        self.assertEqual(r.motivos[jor.M_SEM_CONTATO], 1)
        self.assertNotIn("C1", estado)

    def test_melhor_canal_pelo_resultado_com_amostra_minima(self):
        ordenar = jor.ordem_por_resultado({"sms": {"tentativas": 500, "hit_rate": .2},
                                          "rcs": {"tentativas": 500, "hit_rate": .05},
                                          "whatsapp": {"tentativas": 10, "hit_rate": .9}})
        self.assertEqual(ordenar(["rcs", "whatsapp", "sms"]), ["sms", "rcs", "whatsapp"])


class Base(unittest.TestCase):
    def test_varios_contratos_do_mesmo_cliente(self):
        with tempfile.TemporaryDirectory() as t:
            arq = Path(t) / "c.csv"
            arq.write_text("id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade;"
                           "dias_atraso\nX1;2026-01-10;20/11/2026;nao;nao;2026-09-01;0\n"
                           "X1;2026-05-02;2026-10-20;nao;sim;2026-10-01;0\n"
                           "X1;2026-03-01;2026-10-15;sim;;;0\n;2026-01-01;;;;;0\nX2;ontem;;;;;0\n", encoding="utf-8")
            clientes, rej = jor.carregar_clientes_jornada(arq)
        c = clientes["X1"]
        self.assertEqual((c.contratacao, c.vencimento, c.pago, c.ativado, c.ultima_atividade),
                         (date(2026, 5, 2), date(2026, 10, 20), False, True, date(2026, 10, 1)))
        self.assertEqual(sum(rej.values()), 2)


class Rotina(unittest.TestCase):
    def test_exemplo_completo_gera_ids_por_canal_e_resumo(self):
        with tempfile.TemporaryDirectory() as t:
            r = rodar_jornada(EXEMPLOS / "clientes.csv", EXEMPLOS / "contatos.csv", HOJE, Path(t) / "estado",
                              Path(t) / "saida", out=lambda *_: None)
            self.assertEqual(r["resumo"]["por_momento"], {"boas_vindas": 1, "ativacao": 1, "pre_vencimento": 1,
                                                          "retencao": 1, "reativacao": 1})
            ids = Path(t) / "saida" / HOJE.isoformat() / "ids"
            self.assertEqual(sorted(p.name for p in ids.iterdir()), ["email.csv", "rcs.csv"])
            self.assertTrue((ids / "rcs.csv").read_text().startswith("id_cliente;contato"))
            self.assertTrue((Path(t) / "estado" / "escolhas.csv").exists())
            self.assertEqual({a["regua"] for a in r["acoes"]}, set(r["resumo"]["por_momento"]))
            # o mesmo dia de novo: a mesma lista (não marca o passo duas vezes)
            r1 = rodar_jornada(EXEMPLOS / "clientes.csv", EXEMPLOS / "contatos.csv", HOJE, Path(t) / "estado",
                               Path(t) / "saida", out=lambda *_: None)
            self.assertEqual(r1["fila"], r["fila"])
            # amanhã: ninguém repete o passo
            r2 = rodar_jornada(EXEMPLOS / "clientes.csv", EXEMPLOS / "contatos.csv", HOJE + timedelta(days=1),
                               Path(t) / "estado", Path(t) / "saida", out=lambda *_: None)
            self.assertEqual(r2["fila"], [])

    def test_descadastro_da_mensageria_tira_o_contato(self):
        with tempfile.TemporaryDirectory() as t:
            regs = [Registro("11987650004", "rcs", "bloqueio", HOJE - timedelta(days=1), "x.csv"),
                    Registro("11987650004", "sms", "bloqueio", HOJE - timedelta(days=1), "x.csv")]
            r = rodar_jornada(EXEMPLOS / "clientes.csv", EXEMPLOS / "contatos.csv", HOJE, Path(t) / "e",
                              Path(t) / "s", registros_canal=regs, out=lambda *_: None)
            self.assertNotIn("CLI004", {l["id_cliente"] for l in r["fila"]})
            self.assertEqual(r["enquadramento"]["CLI004"]["motivo"], jor.M_SEM_CONTATO)

    def test_feriado_nao_gera(self):
        with tempfile.TemporaryDirectory() as t:
            r = rodar_jornada(EXEMPLOS / "clientes.csv", EXEMPLOS / "contatos.csv", date(2026, 10, 12),
                              Path(t) / "e", Path(t) / "s", out=lambda *_: None)
            self.assertEqual(r["fila"], [])
            self.assertTrue(r["alertas"])


if __name__ == "__main__":
    unittest.main()
