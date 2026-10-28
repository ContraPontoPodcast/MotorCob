"""Etapas próprias da estratégia (motor/etapas.py): validação, escolha do dia, saídas e a Lista do dia."""
import unittest
from datetime import date, timedelta

from motor import etapas as ET
from motor.certificacao import Certificacao
from motor.cluster import carregar_regras
from motor.estrategia import validar_estrategia
from motor.fila import MOTIVOS, gerar_fila
from motor.marcacao import Cliente, EstadoCliente
from motor.regua import carregar_regua

D0 = date(2026, 9, 1)            # terça
TEL, EM = "11988880001", "c1@exemplo.invalid"

TICKET = {"id": "ticket-alto", "nome": "Ticket alto", "condicoes": [{"campo": "saldo", "op": ">", "valor": 10000}],
          "referencia": {"tipo": "entrada"}, "de": 0, "ate": 10,
          "passos": {"0": [{"canal": "email", "modo": "sempre"}, {"canal": "discador", "modo": "junto"}],
                     "D+3": [{"canal": "sms", "modo": "sempre", "mensagem": "Proposta especial: responda SIM"}],
                     "5": [{"canal": "discador", "modo": "sempre", "personas": [7]},
                           {"canal": "sms", "modo": "sempre"}]},
          "saidas": {"cpc": "padrao", "pagamento": "sai"}}


def _validar(etapas, ordem=None):
    d = {"etapas": etapas}
    if ordem is not None:
        d["ordem_etapas"] = ordem
    return validar_estrategia(d)


class TestValidar(unittest.TestCase):
    def test_etapa_valida_e_ordem_padrao_no_topo(self):
        over, erros = _validar([TICKET])
        self.assertEqual(erros, [])
        e = over["etapas"][0]
        self.assertEqual((e.id, e.tipo_ref, e.de, e.ate, sorted(e.passos)), ("ticket-alto", "entrada", 0, 10, [0, 3, 5]))
        self.assertEqual(over["ordem_etapas"], ["ticket-alto", "quebra", "preventivo", "cpc", "giro", "localizacao"])
        self.assertEqual(e.passos[3][0]["mensagem"], "Proposta especial: responda SIM")
        self.assertEqual(e.passos[5][0]["personas"], [7])     # raia da persona continua valendo

    def test_prazo_agrupado_em_janela_como_o_site_grava(self):
        site = {k: v for k, v in TICKET.items() if k not in ("referencia", "de", "ate")}
        site["janela"] = {"de": 0, "ate": 10, "contando": {"tipo": "entrada", "coluna": None}, "ciclo": None}
        over, erros = _validar([site])
        self.assertEqual(erros, [])
        e = over["etapas"][0]
        self.assertEqual((e.tipo_ref, e.de, e.ate, sorted(e.passos)), ("entrada", 0, 10, [0, 3, 5]))

    def test_erros_ficam_so_na_etapa_com_problema(self):
        ruins = [
            {**TICKET, "id": "cpc"},                                         # id de fase do motor
            {**TICKET, "id": "sem-cond", "condicoes": []},
            {**TICKET, "id": "janela", "de": 5, "ate": 1},
            {**TICKET, "id": "ref", "referencia": {"tipo": "coluna"}},     # coluna sem nome
            {**TICKET, "id": "sem-dia", "passos": {"40": ["sms"]}},          # dia fora da janela
        ]
        over, erros = _validar([TICKET] + ruins)
        self.assertEqual([e.id for e in over["etapas"]], ["ticket-alto"])
        self.assertEqual(len(erros), 6)        # 5 etapas ignoradas + o dia fora da janela

    def test_destino_inexistente_vira_padrao_e_desligada_some(self):
        a = {**TICKET, "id": "a", "saidas": {"fim_janela": "etapa:nao-existe"}}
        b = {**TICKET, "id": "b", "ativo": False}
        over, erros = _validar([a, b], ordem=["cpc", "a", "b", "xx"])
        self.assertEqual(over["etapas"][0].saidas["fim_janela"], "padrao")
        self.assertTrue(any("inexistente" in e for e in erros))
        self.assertEqual(over["ordem_etapas"][:2], ["cpc", "a"])
        self.assertNotIn("b", over["ordem_etapas"])


def _etapas(*extra, ordem=None):
    over, erros = validar_estrategia({"etapas": [TICKET, *extra], **({"ordem_etapas": ordem} if ordem else {})})
    assert not erros, erros
    return over["etapas"], over["ordem_etapas"]


class TestEscolher(unittest.TestCase):
    def setUp(self):
        self.estado = {}

    def esc(self, etapas, ordem, fase="localizacao", saldo=20000, dia=D0, eventos=()):
        return ET.escolher(etapas, ordem, fase, {"saldo": saldo, "dias_atraso": 40}, {}, set(eventos),
                           self.estado, "C1", dia)

    def test_regua_por_dia_desde_a_entrada_e_passo_perdido_ainda_sai(self):
        et, ordem = _etapas()
        e = self.esc(et, ordem)
        self.assertEqual((e.etapa.id, e.dia, e.passo), ("ticket-alto", 0, 0))
        ET.marcar_feito(e)
        self.assertIsNone(self.esc(et, ordem, dia=D0 + timedelta(days=1)).passo)     # D+1 sem passo
        e4 = self.esc(et, ordem, dia=D0 + timedelta(days=4))                         # D+3 perdido: sai no D+4
        self.assertEqual((e4.dia, e4.passo, e4.rotulo), (4, 3, "D+3"))
        ET.marcar_feito(e4)
        self.assertEqual(self.esc(et, ordem, dia=D0 + timedelta(days=4)).passo, 3)   # rodar de novo no dia refaz

    def test_quem_nao_encaixa_segue_a_fase_do_motor(self):
        et, ordem = _etapas()
        self.assertIsNone(self.esc(et, ordem, saldo=500))

    def test_prioridade_abaixo_da_fase_nao_captura(self):
        et, ordem = _etapas(ordem=["quebra", "preventivo", "cpc", "ticket-alto", "giro", "localizacao"])
        self.assertIsNone(self.esc(et, ordem, fase="cpc"))                  # CPC acima: segue o CPC
        self.assertEqual(self.esc(et, ordem, fase="localizacao").etapa.id, "ticket-alto")

    def test_fim_da_janela_volta_ao_padrao_e_nao_reentra(self):
        et, ordem = _etapas()
        self.esc(et, ordem)
        self.assertIsNone(self.esc(et, ordem, dia=D0 + timedelta(days=11)))
        self.assertEqual(self.estado["C1"]["etapas"]["ticket-alto"]["motivo"], "fim_janela")
        self.assertIsNone(self.esc(et, ordem, dia=D0 + timedelta(days=12)))

    def test_saida_por_evento_padrao_ou_fora_da_regua(self):
        et, ordem = _etapas()
        self.esc(et, ordem)
        self.assertIsNone(self.esc(et, ordem, fase="cpc", eventos={"cpc"}, dia=D0 + timedelta(days=2)))
        self.estado.clear()
        self.esc(et, ordem)
        self.assertEqual(self.esc(et, ordem, eventos={"pagamento"}, dia=D0 + timedelta(days=2)), ET.FORA)
        self.assertEqual(self.esc(et, ordem, dia=D0 + timedelta(days=3)), ET.FORA)      # fica fora

    def test_destino_outra_etapa_entra_sem_olhar_condicoes(self):
        pre = {"id": "pre-judicial", "nome": "Pré-judicial", "condicoes": [{"campo": "saldo", "op": ">", "valor": 999999}],
               "referencia": {"tipo": "entrada"}, "de": 0, "ate": 5, "passos": {"0": ["email"]}}
        tk = {**TICKET, "saidas": {"fim_janela": "etapa:pre-judicial"}}
        over, erros = validar_estrategia({"etapas": [tk, pre]})
        self.assertEqual(erros, [])
        et, ordem = over["etapas"], over["ordem_etapas"]
        self.esc(et, ordem)
        e = self.esc(et, ordem, dia=D0 + timedelta(days=11))
        self.assertEqual((e.etapa.id, e.dia, e.passo), ("pre-judicial", 0, 0))

    def test_eventos_pela_mudanca_de_estado(self):
        self.assertEqual(ET.eventos_cob("LOC", "CPA"), {"cpc"})
        self.assertEqual(ET.eventos_cob("CPA", "PRE"), {"acordo"})
        self.assertEqual(ET.eventos_cob("QBR", "PRE"), set())               # voltou a pagar: não é acordo novo
        self.assertEqual(ET.eventos_cob("COL", "LIQ"), {"pagamento"})
        self.assertEqual(ET.eventos_cob(None, "CPA"), set())

    def test_referencias(self):
        e = ET.Etapa("x", "x", (), "vencimento", None, -5, 0, {}, {})
        self.assertEqual(ET.dia_ref(e, {}, {}, {"vencimento": D0 + timedelta(days=3)}, D0), -3)
        e = ET.Etapa("x", "x", (), "coluna", "DT_SEG", 0, 9, {}, {})
        self.assertEqual(ET.dia_ref(e, {}, {"DT_SEG": "25/08/2026"}, {}, D0), 7)
        self.assertIsNone(ET.dia_ref(e, {}, {}, {}, D0))


def _fila(definicao, saldo=20000.0, dia=D0, estado_et=None, publico=None):
    regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
    over, erros = validar_estrategia(definicao)
    assert not erros, erros
    regua = carregar_regua().com_clusters(regras, {7: over}, None, {})
    est = {"C1": EstadoCliente("C1", D0, "DG", "DG", "2026-09", cluster_versao=regua.versao_clusters)}
    cli = {"C1": Cliente("C1", D0, saldo, 30, atributos={"persona": "Sênior (60+)"})}
    certs = {("C1", c): Certificacao("C1", c, "email" if "@" in c else "telefone", "DESCONHECIDO", 0.4)
             for c in (TEL, EM)}
    motivos = {}
    fila, _, _ = gerar_fila(est, cli, certs, {}, {}, dia, regua, [], None, motivos=motivos,
                            etapas_estado=estado_et, publico=publico)
    return fila, motivos


class TestListaDoDia(unittest.TestCase):
    def test_etapa_gera_a_regua_dela_com_rotulo_proprio(self):
        estado = {}
        fila, motivos = _fila({"etapas": [TICKET]}, estado_et=estado)
        self.assertEqual(sorted({(l["regua"], l["passo"], l["canal"]) for l in fila}),
                         [("etapa-ticket-alto", "D0", "discador"), ("etapa-ticket-alto", "D0", "email")])
        self.assertEqual(motivos, {"com_acao": 1})
        self.assertEqual(estado["C1"]["etapas"]["ticket-alto"]["feitos"], {"0": D0.isoformat()})
        self.assertEqual(estado["C1"]["estado_motor"], "LOC")

    def test_sem_estado_ou_fora_da_condicao_vale_o_padrao(self):
        fila, _ = _fila({"etapas": [TICKET]}, estado_et=None)
        self.assertTrue(fila and all(not l["regua"].startswith("etapa-") for l in fila))
        fila, _ = _fila({"etapas": [TICKET]}, saldo=100.0, estado_et={})
        self.assertTrue(fila and all(not l["regua"].startswith("etapa-") for l in fila))

    def test_dia_sem_passo_na_etapa_tem_motivo(self):
        estado = {}
        _fila({"etapas": [TICKET]}, estado_et=estado)
        fila, motivos = _fila({"etapas": [TICKET]}, dia=D0 + timedelta(days=1), estado_et=estado)
        self.assertEqual((fila, motivos), ([], {"etapa_sem_passo": 1}))
        self.assertIn("etapa_sem_passo", MOTIVOS)

    def test_raia_da_persona_e_frase_na_etapa(self):
        estado = {}
        _fila({"etapas": [TICKET]}, estado_et=estado)
        estado["C1"]["etapas"]["ticket-alto"]["entrou"] = (D0 - timedelta(days=5)).isoformat()
        fila, _ = _fila({"etapas": [TICKET]}, estado_et=estado, publico={"C1": 7}, dia=D0 + timedelta(days=0))
        self.assertEqual({(l["passo"], l["canal"]) for l in fila}, {("D+5", "discador")})   # só a raia da persona
        estado2 = {}
        _fila({"etapas": [TICKET]}, estado_et=estado2)
        estado2["C1"]["etapas"]["ticket-alto"]["entrou"] = (D0 - timedelta(days=3)).isoformat()
        fila, _ = _fila({"etapas": [TICKET]}, estado_et=estado2)
        self.assertEqual([(l["canal"], l.get("frase_acao")) for l in fila], [("sms", "Proposta especial: responda SIM")])


if __name__ == "__main__":
    unittest.main()


# ------------------------------------------------------------------ MotorCli: etapas e prospecção
import tempfile
from pathlib import Path

from motor import jornada as jor

PROSPECCAO = {"id": "prospeccao", "nome": "Prospecção",
              "condicoes": [{"campo": "e_cliente", "op": "=", "valor": "não"},
                            {"campo": "origem", "op": "em", "valor": ["site", "indicação"]}],
              "referencia": {"tipo": "lead"}, "de": 0, "ate": 30,
              "passos": {"0": [{"canal": "email", "modo": "sempre", "mensagem": "Conheça a oferta"},
                               {"canal": "sms", "modo": "junto", "mensagem": "Oferta no seu e-mail. SAIR para não receber"}],
                         "2": [{"canal": "whatsapp", "modo": "sempre"}, {"canal": "sms", "modo": "senao",
                                                                         "mensagem": {"frase_id": 9}}]},
              "saidas": {"convertido": "padrao", "fim_janela": "sai"}}


def _csv(linhas):
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8")
    f.write("\n".join(linhas) + "\n")
    f.close()
    return f.name


class TestProspeccao(unittest.TestCase):
    def setUp(self):
        self.leads_csv = _csv([
            "id_lead;data_entrada;origem;base_legal;telefone;email;whatsapp;PRODUTO",
            "L1;01/09/2026;Site;consentimento;(11) 98888-0001;l1@exemplo.invalid;sim;cartão",
            "L2;2026-09-01;Indicação;legítimo interesse;(11) 98888-0002;;não;",
            "L3;2026-09-01;Lista comprada;;(11) 98888-0003;;;",                   # sem base legal
            "L4;2026-09-01;;consentimento;(11) 98888-0004;;;",                    # sem origem
            "L5;2026-09-01;Site;consentimento;;;;",                               # sem contato
            "L6;2026-09-01;Evento;consentimento;(11) 98888-0006;;;"])            # origem fora da etapa

    def regras(self, etapas=(PROSPECCAO,)):
        return jor.carregar_jornada(definicao={"etapas": list(etapas)})

    def test_lgpd_lead_sem_base_legal_origem_ou_contato_nao_entra(self):
        leads, contatos, wa, rej = jor.carregar_leads(self.leads_csv)
        self.assertEqual(sorted(leads), ["L1", "L2", "L6"])
        self.assertEqual(leads["L2"].base_legal, "legitimo_interesse")
        self.assertEqual(leads["L1"].atributos, {"produto": "cartão"})
        self.assertEqual(sum(rej.values()), 3)
        self.assertTrue(any("base legal" in k for k in rej) and any("origem" in k for k in rej))
        self.assertEqual(wa, {"11988880001"})
        self.assertFalse(any("cpf" in json for json in map(str, leads.values())))

    def test_prospeccao_aciona_lead_e_quem_virou_cliente_segue_a_jornada(self):
        leads, contatos, wa, _ = jor.carregar_leads(self.leads_csv)
        regras, estado, et = self.regras(), {}, {}
        res = jor.gerar({}, contatos, D0, regras, estado, whatsapp_ok=wa, leads=leads, etapas_estado=et)
        self.assertEqual(sorted({(l["id_cliente"], l["canal"], l["regua"]) for l in res.fila}),
                         [("L1", "email", "etapa-prospeccao"), ("L1", "sms", "etapa-prospeccao")])
        self.assertEqual(res.enquadramento["L2"]["motivo"], jor.M_SEM_CONTATO)   # sem e-mail: o 'junto' não vai
        self.assertEqual(res.enquadramento["L6"]["motivo"], jor.M_LEAD_SEM_ETAPA)
        msgs = {(l["id_cliente"], l["canal"]): l.get("frase_acao") for l in res.fila}
        self.assertIsNone(msgs[("L1", "email")])          # e-mail não leva frase: vale o modelo de e-mail
        self.assertEqual(msgs[("L1", "sms")], "Oferta no seu e-mail. SAIR para não receber")
        self.assertTrue(any("mensagem" in a or "frase" in a for a in regras["avisos_etapas"]))
        # D+2: WhatsApp só em número confirmado; L2 sem WhatsApp vai pelo senão (frase do playbook)
        res = jor.gerar({}, contatos, D0 + timedelta(days=2), regras, estado, whatsapp_ok=wa, leads=leads,
                        etapas_estado=et)
        self.assertEqual(sorted((l["id_cliente"], l["canal"], str(l.get("frase_acao"))) for l in res.fila),
                         [("L1", "whatsapp", "None"), ("L2", "sms", "{'frase_id': 9}")])
        # L1 contratou: aparece na carga de clientes com o mesmo id e cai nas Boas-vindas
        cli = {"L1": jor.ClienteJornada("L1", contratacao=D0 + timedelta(days=3))}
        res = jor.gerar(cli, contatos, D0 + timedelta(days=3), regras, estado, whatsapp_ok=wa, leads=leads,
                        etapas_estado=et)
        self.assertEqual(res.enquadramento["L1"]["momento"], "boas_vindas")
        self.assertEqual(et["L1"]["etapas"]["prospeccao"]["motivo"], "convertido")

    def test_fim_da_janela_tira_o_lead_da_regua(self):
        leads, contatos, wa, _ = jor.carregar_leads(self.leads_csv)
        et = {}
        res = jor.gerar({}, contatos, D0 + timedelta(days=31), self.regras(), {}, whatsapp_ok=wa, leads=leads,
                        etapas_estado=et)
        self.assertEqual(res.fila, [])
        self.assertEqual(res.enquadramento["L1"]["motivo"], jor.M_FORA)

    def test_sem_etapa_lead_nao_e_acionado_e_cliente_segue_o_padrao(self):
        leads, contatos, wa, _ = jor.carregar_leads(self.leads_csv)
        res = jor.gerar({}, contatos, D0, jor.carregar_jornada(), {}, whatsapp_ok=wa, leads=leads, etapas_estado={})
        self.assertEqual(res.fila, [])
        self.assertEqual(res.motivos[jor.M_LEAD_SEM_ETAPA], 3)

    def test_etapa_de_cliente_acima_do_momento(self):
        upgrade = {"id": "upgrade", "nome": "Upgrade", "condicoes": [{"campo": "USO", "op": ">", "valor": 80}],
                   "referencia": {"tipo": "entrada"}, "de": 0, "ate": 5, "passos": {"0": ["email"]}}
        regras = self.regras([upgrade])
        cli = {"C1": jor.ClienteJornada("C1", contratacao=D0, atributos={"USO": "95"}),
               "C2": jor.ClienteJornada("C2", contratacao=D0, atributos={"USO": "10"})}
        cont = [{"id_cliente": k, "contato": f"{k.lower()}@exemplo.invalid", "tipo": "email"} for k in cli]
        res = jor.gerar(cli, cont, D0, regras, {}, etapas_estado={})
        self.assertEqual({l["id_cliente"]: l["regua"] for l in res.fila}, {"C1": "etapa-upgrade", "C2": "boas_vindas"})
        # na ordem, abaixo das boas-vindas: o momento do motor vem antes
        regras = jor.carregar_jornada(definicao={"etapas": [upgrade], "ordem_etapas": ["pre_vencimento", "boas_vindas", "upgrade"]})
        res = jor.gerar(cli, cont, D0, regras, {}, etapas_estado={})
        self.assertEqual({l["id_cliente"]: l["regua"] for l in res.fila}, {"C1": "boas_vindas", "C2": "boas_vindas"})

    def test_rotina_grava_mensagem_e_resumo_com_leads(self):
        import rodar_jornada
        with tempfile.TemporaryDirectory() as tmp:
            clientes = _csv(["id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade"])
            contatos = _csv(["id_cliente;contato;tipo"])
            r = rodar_jornada.rodar_jornada(clientes, contatos, D0, Path(tmp) / "e", Path(tmp) / "s",
                                            definicao={"etapas": [PROSPECCAO]}, leads_csv=self.leads_csv,
                                            frases=[{"id": 9, "texto": "Frase 9", "ativo": True}], out=lambda *a: None)
            self.assertEqual(r["resumo"]["leads"], 3)
            sms = (r["saida"] / "ids" / "sms.csv").read_text(encoding="utf-8").splitlines()
            self.assertEqual(sms[0], "id_cliente;contato;mensagem")
            self.assertIn("L1;11988880001;Oferta no seu e-mail. SAIR para não receber", sms)
            self.assertTrue((Path(tmp) / "e" / "etapas.json").exists())


class TestRotinaCob(unittest.TestCase):
    def test_rotina_grava_estado_das_etapas_e_regua_da_etapa(self):
        import shutil
        import rodar_dia
        from pathlib import Path as P
        raiz = P(__file__).resolve().parent.parent
        ex, empresa = raiz / "exemplos" / "empresa", raiz / "empresas" / "exemplo.json"
        todos = {**TICKET, "id": "todos", "condicoes": [{"campo": "saldo", "op": ">=", "valor": 0}],
                 "passos": {"0": [{"canal": "sms", "modo": "sempre", "mensagem": "Etapa da empresa"}]}}
        with tempfile.TemporaryDirectory() as tmp:
            base = P(tmp) / "base"
            rodar_dia.preparar_base(empresa, ex / "bruto", base)
            estr = [{"id": 1, "nome": "Com etapa", "padrao": True, "definicao": {"etapas": [todos]}}]
            r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", P(tmp) / "ret", date(2026, 9, 2),
                                    pasta_estado=P(tmp) / "estado", pasta_saida=P(tmp) / "saida",
                                    estrategias=estr, out=lambda *a: None)
            estado = ET.carregar_estado(P(tmp) / "estado")
            self.assertTrue(estado and all("todos" in v["etapas"] for v in estado.values()))
        reguas = {l["regua"] for l in r["fila"]}
        self.assertEqual(reguas, {"etapa-todos"})
        self.assertTrue(all(l["mensagem"] == "Etapa da empresa" for l in r["fila"] if l["canal"] == "sms"))


# ------------------------------------------------------------------ ciclo e orçamento por canal
CICLO = {"id": "ciclo", "nome": "Ciclo", "condicoes": [{"campo": "saldo", "op": ">", "valor": 10000}],
         "referencia": {"tipo": "entrada"}, "de": 0, "ate": 20, "ciclo": {"dias": 3, "vezes": 2},
         "passos": {"1": ["sms"], "3": ["email"]}}


class TestCiclo(unittest.TestCase):
    def test_validacao_do_ciclo_e_do_orcamento(self):
        over, erros = _validar([CICLO])
        self.assertEqual((erros, over["etapas"][0].ciclo), ([], (3, 2)))
        ruins = [{**CICLO, "id": "c-ruim", "ciclo": {"dias": 1, "vezes": 2}},
                 {**CICLO, "id": "c-dia", "passos": {"1": ["sms"], "5": ["email"]}}]          # dia 5 num ciclo de 3
        over, erros = _validar(ruins)
        self.assertEqual([e.id for e in over["etapas"]], ["c-dia"])
        self.assertEqual(len(erros), 2)
        orc = {**TICKET, "orcamento": {
            "email": {"modo": "parametrizado", "clientes": 10,
                      "prioridade": ["novo", "etapa_antigo", "etapa_novo", "xx", {"criterio": "coluna", "coluna": "PRIO"}]},
            "whatsapp": {"modo": "parametrizado", "clientes": 5},           # canal fora da régua
            "sms": {"modo": "todos", "clientes": 1},                        # todos: sem limite
            "discador": {"modo": "parametrizado"}}}                         # sem limite: vale todos
        over, erros = _validar([orc])
        o = over["etapas"][0].orcamento
        self.assertEqual(list(o), ["email"])
        self.assertEqual(o["email"].prioridade, (("novo", None), ("etapa_antigo", None), ("coluna", "PRIO")))
        self.assertEqual(o["email"].fora, "senao")
        self.assertEqual(len(erros), 4)       # oposto, desconhecido, canal fora da régua, sem limite

    def test_regua_repete_em_ciclo_e_sai_no_fim_dos_ciclos(self):
        over, _ = _validar([CICLO])
        et, ordem, estado = over["etapas"], over["ordem_etapas"], {}

        def esc(n):
            return ET.escolher(et, ordem, "localizacao", {"saldo": 20000}, {}, set(), estado, "C1", D0 + timedelta(days=n))
        e = esc(0)
        self.assertEqual((e.volta, e.passo, e.rotulo), (1, 1, "C1-D1"))
        ET.marcar_feito(e)
        self.assertIsNone(esc(1).passo)                       # dia 2 do ciclo: o dia 1 já saiu
        e = esc(2)
        self.assertEqual(e.rotulo, "C1-D3")
        ET.marcar_feito(e)
        e = esc(3)                                            # 2º ciclo: o dia 1 sai de novo
        self.assertEqual((e.volta, e.passo, e.rotulo), (2, 1, "C2-D1"))
        ET.marcar_feito(e)
        self.assertEqual(set(estado["C1"]["etapas"]["ciclo"]["feitos"]), {"1:1", "1:3", "2:1"})
        self.assertIsNone(esc(6))                             # acabaram os 2 ciclos: volta ao padrão
        self.assertEqual(estado["C1"]["etapas"]["ciclo"]["motivo"], "fim_janela")


class TestOrcamento(unittest.TestCase):
    ETAPA = {"id": "vista", "nome": "À vista", "condicoes": [{"campo": "PLANO", "op": "=", "valor": "x"}],
             "referencia": {"tipo": "entrada"}, "de": 0, "ate": 30,
             "passos": {"0": [{"canal": "whatsapp", "modo": "sempre"}, {"canal": "sms", "modo": "senao"}]}}
    # dias desde que entrou na etapa: C3 entrou hoje (novo do dia)
    ENTROU = {"C1": 5, "C2": 2, "C3": 0, "C4": 4, "C5": 1}

    def rodar(self, orcamento, dia=D0, estado=None, et=None):
        etapa = {**self.ETAPA, "orcamento": {"whatsapp": orcamento}}
        regras = jor.carregar_jornada(definicao={"etapas": [etapa]})
        cli = {k: jor.ClienteJornada(k, contratacao=D0 - timedelta(days=200), atributos={"PLANO": "x", "PRIO": str(i)})
               for i, k in enumerate(self.ENTROU)}
        tels = {k: f"1198888000{i}" for i, k in enumerate(self.ENTROU)}
        cont = [{"id_cliente": k, "contato": t, "tipo": "telefone"} for k, t in tels.items()]
        if et is None:
            et = {k: {"etapas": {"vista": {"entrou": (D0 - timedelta(days=n)).isoformat(), "feitos": {}}}}
                  for k, n in self.ENTROU.items() if n}
        estado = {} if estado is None else estado
        res = jor.gerar(cli, cont, dia, regras, estado, whatsapp_ok=set(tels.values()), etapas_estado=et)
        return res, et, estado

    def test_prioridade_decide_quem_sai_e_o_resto_vai_pelo_canal_de_baixo(self):
        res, et, _ = self.rodar({"modo": "parametrizado", "clientes": 2, "prioridade": ["novo", "etapa_antigo"]})
        canal = {l["id_cliente"]: l["canal"] for l in res.fila}
        self.assertEqual(canal, {"C3": "whatsapp", "C1": "whatsapp", "C2": "sms", "C4": "sms", "C5": "sms"})
        self.assertTrue(any("ORÇAMENTO vista/whatsapp: 3" in a for a in res.alertas))
        # do mais novo para o mais antigo (sem o novo do dia): C3 (0 dias) e C5 (1 dia)
        res, _, _ = self.rodar({"modo": "parametrizado", "clientes": 2, "prioridade": ["etapa_novo"]})
        self.assertEqual(sorted(l["id_cliente"] for l in res.fila if l["canal"] == "whatsapp"), ["C3", "C5"])
        # coluna da carga (maior primeiro): PRIO 4 (C5) e 3 (C4)
        res, _, _ = self.rodar({"modo": "parametrizado", "clientes": 2,
                                "prioridade": [{"criterio": "coluna", "coluna": "PRIO"}]})
        self.assertEqual(sorted(l["id_cliente"] for l in res.fila if l["canal"] == "whatsapp"), ["C4", "C5"])

    def test_todos_da_raia_nao_limita(self):
        res, _, _ = self.rodar({"modo": "todos", "clientes": 1, "prioridade": ["novo"]})
        self.assertEqual({l["canal"] for l in res.fila}, {"whatsapp"})
        self.assertEqual(len(res.fila), 5)

    def test_fora_amanha_nao_conta_como_acao_e_concorre_de_novo(self):
        orc = {"modo": "parametrizado", "clientes": 2, "prioridade": ["acao_antiga", "etapa_antigo"], "fora": "amanha"}
        res, et, estado = self.rodar(orc)
        self.assertEqual(sorted(l["id_cliente"] for l in res.fila), ["C1", "C4"])
        self.assertEqual(res.motivos[jor.M_ORCAMENTO], 3)
        self.assertEqual(et["C2"]["etapas"]["vista"]["feitos"], {})          # passo continua devido
        self.assertNotIn("C2", estado)                                       # recência não começou
        # amanhã: C1 e C4 já foram (recência); C2 e C5 (nunca acionados, os mais antigos na etapa) saem
        res, _, _ = self.rodar(orc, dia=D0 + timedelta(days=1), estado=estado, et=et)
        self.assertEqual(sorted(l["id_cliente"] for l in res.fila), ["C2", "C5"])

    def test_limite_de_telefones_no_motorcob(self):
        tk = {**TICKET, "orcamento": {"discador": {"modo": "parametrizado", "telefones": 0}}}
        estado = {}
        fila, motivos = _fila({"etapas": [tk]}, estado_et=estado)
        self.assertEqual({l["canal"] for l in fila}, {"email"})               # o e-mail segue; o discador não
        self.assertEqual(motivos, {"com_acao": 1})
        # sem orçamento para o principal: o 'junto' não vai sozinho; fica fora sem marcar o passo
        tk = {**TICKET, "orcamento": {"email": {"modo": "parametrizado", "clientes": 0}}}
        estado = {}
        fila, motivos = _fila({"etapas": [tk]}, estado_et=estado)
        self.assertEqual((fila, motivos), ([], {"sem_orcamento": 1}))
        self.assertEqual(estado["C1"]["etapas"]["ticket-alto"]["feitos"], {})
        self.assertIn("sem_orcamento", MOTIVOS)


class TestTravasDaEtapa(unittest.TestCase):
    def test_travas_proprias_da_etapa(self):
        tk = {**TICKET, "travas": {"intervalo_horas": 4, "acoes_dia": 1, "de": "10:00", "ate": "22:00"}}
        over, erros = _validar([tk])
        self.assertEqual(over["etapas"][0].travas, {"recencia_horas": 12, "limite_dia": 1, "janela": ("10:00", "20:00")})
        self.assertEqual(len(erros), 1)                      # intervalo abaixo do mínimo
        tk["travas"] = {**tk["travas"], "intervalo_horas": 72}
        fila, _ = _fila({"etapas": [tk]}, estado_et={})
        self.assertEqual([(l["canal"], l["janela"][:5]) for l in fila], [("email", "10:00")])   # 1 ação, das 10h
        self.assertEqual(ET.janela_da_etapa("08:00-14:00", {"janela": ("10:00", "19:00")}), "10:00-14:00")


def _fila_fase(definicao, n=5, dia=D0, ultima=None):
    """Lista do dia de n clientes em cliente novo (localização), sem etapas próprias."""
    regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
    over, erros = validar_estrategia(definicao)
    assert not erros, erros
    regua = carregar_regua().com_clusters(regras, {7: over}, None, {})
    est, cli, certs = {}, {}, {}
    for i in range(n):
        k = f"C{i}"
        est[k] = EstadoCliente(k, D0, "DG", "DG", "2026-09", cluster_versao=regua.versao_clusters,
                               ultima_massiva=ultima)
        cli[k] = Cliente(k, D0, 1000.0 * (i + 1), 30)
        for c in (f"1198888000{i}", f"c{i}@exemplo.invalid"):
            certs[(k, c)] = Certificacao(k, c, "email" if "@" in c else "telefone", "DESCONHECIDO", 0.4)
    motivos = {}
    fila, _, _ = gerar_fila(est, cli, certs, {}, {}, dia, regua, [], None, motivos=motivos)
    return fila, motivos


class TestFasesDoMotor(unittest.TestCase):
    """Bloco 3: as fases do motor com orçamento por canal, prioridade e travas próprias."""
    PASSOS = {str(d): [{"canal": "email", "modo": "sempre"}, {"canal": "sms", "modo": "senao"}] for d in range(4)}

    def test_validacao_so_das_fases_que_definiram_algo(self):
        over, erros = validar_estrategia({
            "localizacao": {"orcamento": {"whatsapp": {"modo": "parametrizado", "clientes": 300,
                                                       "prioridade": ["novo", "saldo_maior"]}},
                            "travas": {"intervalo_horas": 72}},
            "cpc": {"travas": {"acoes_dia": 3}},
            "giro": {"orcamento": {"fax": {"modo": "parametrizado", "clientes": 1}}}})
        cfg = over["fases_cfg"]
        self.assertEqual(sorted(cfg), ["cpc", "localizacao"])
        self.assertEqual(cfg["localizacao"].orcamento["whatsapp"].clientes, 300)
        self.assertEqual(cfg["localizacao"].travas, {"recencia_horas": 72})
        self.assertEqual(cfg["cpc"].travas, {"limite_dia": 3})
        self.assertEqual(len(erros), 1)
        self.assertIn("Não CPC", erros[0])                       # nome legível da fase no aviso
        self.assertNotIn("fases_cfg", validar_estrategia({"localizacao": {"passos": self.PASSOS}})[0])

    def test_orcamento_da_fase_com_prioridade_e_canal_de_baixo(self):
        fila, motivos = _fila_fase({"localizacao": {"passos": self.PASSOS, "orcamento": {
            "email": {"modo": "parametrizado", "clientes": 2, "prioridade": ["saldo_maior"]}}}})
        canal = {l["id_cliente"]: l["canal"] for l in fila}
        self.assertEqual(canal, {"C4": "email", "C3": "email", "C0": "sms", "C1": "sms", "C2": "sms"})
        self.assertEqual(motivos, {"com_acao": 5})
        fila, motivos = _fila_fase({"localizacao": {"passos": self.PASSOS, "orcamento": {
            "email": {"modo": "parametrizado", "clientes": 1, "prioridade": ["saldo_menor"], "fora": "amanha"}}}})
        self.assertEqual([(l["id_cliente"], l["canal"]) for l in fila], [("C0", "email")])
        self.assertEqual(motivos, {"com_acao": 1, "sem_orcamento": 4})

    def test_travas_proprias_da_fase(self):
        passos = {str(d): [{"canal": "email", "modo": "sempre"}, {"canal": "sms", "modo": "junto"}] for d in range(4)}
        fila, _ = _fila_fase({"localizacao": {"passos": passos, "travas": {"acoes_dia": 1, "de": "10:00"}}}, n=1)
        self.assertEqual([(l["canal"], l["janela"][:5]) for l in fila], [("email", "10:00")])
        # intervalo próprio da fase: 72 h barra quem teve ação há 2 dias (a estratégia, 48 h, deixaria)
        ontem2 = D0 - timedelta(days=2)
        fila, motivos = _fila_fase({"localizacao": {"passos": passos}}, n=1, ultima=ontem2)
        self.assertTrue(fila)
        fila, motivos = _fila_fase({"localizacao": {"passos": passos, "travas": {"intervalo_horas": 72}}},
                                   n=1, ultima=ontem2)
        self.assertEqual((fila, motivos), ([], {"intervalo_48h": 1}))


class TestRotulos(unittest.TestCase):
    def test_nenhum_codigo_cru(self):
        from motor import rotulos as RT
        self.assertEqual([RT.rotulo_ciclo("NCP", c) for c in ("G1", "G3", "RE")],
                         ["1º ciclo", "3º ciclo", "Parado · aguarda enriquecimento"])
        self.assertEqual((RT.rotulo_ciclo("CPB", "T1"), RT.rotulo_ciclo("QBR", "D2"), RT.rotulo_ciclo("PRE", "D0")),
                         ("1ª tentativa", "D+2", "D0"))
        self.assertEqual(RT.rotulo_estado("CPA"), "CPC · em negociação")
        self.assertEqual(RT.rotulo_passo("G2-dia5"), "2º ciclo · dia 5")
        self.assertEqual(RT.rotulo_passo("CPC B · T2"), "CPC · sem resposta · 2ª tentativa")
