"""Estratégias por cluster, blend de ações, limites dos canais e retorno do enriquecimento."""
import csv
import shutil
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import rodar_dia
from motor.certificacao import Certificacao
from motor.cluster import carregar_regras
from motor.entrada import carregar_entrada
from motor.estrategia import validar_estrategia
from motor.fila import gerar_fila
from motor.marcacao import Cliente, EstadoCliente, processar_dia
from motor.regua import carregar_regua

RAIZ = Path(__file__).resolve().parent.parent
EX = RAIZ / "exemplos" / "empresa"
EMPRESA = RAIZ / "empresas" / "exemplo.json"
D0 = date(2026, 9, 1)          # terça: D+1 = quarta
WA, WA2, TEL3, EM = "11988880001", "11977770001", "11966660001", "c1@exemplo.invalid"

BLEND = {"localizacao": {"passos": {"1": [
    {"canal": "whatsapp", "modo": "sempre", "contatos": {"whatsapp": True}},
    {"canal": "rcs", "modo": "senao", "contatos": {"rcs": True, "pertence": True}},
    {"canal": "sms", "modo": "senao", "numeros": 2},
    {"canal": "email", "modo": "junto"}]}}}


def _cenario(sinais=None, flags=None, canais=None, definicao=BLEND, dia=D0 + timedelta(days=1)):
    regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
    over, erros = validar_estrategia(definicao)
    assert not erros, erros
    regua = carregar_regua().com_clusters(regras, {7: over}, None, canais or {})
    est = {"C1": EstadoCliente("C1", D0, "DG", "DG", "2026-09", cluster_versao=regua.versao_clusters)}
    cli = {"C1": Cliente("C1", D0, 500.0, 30)}
    certs = {("C1", c): Certificacao("C1", c, "email" if "@" in c else "telefone", "DESCONHECIDO", 0.4)
             for c in (WA, WA2, TEL3, EM)}
    fila, disp, alertas = gerar_fila(est, cli, certs, flags or {}, {}, dia, regua, [],
                                     {("C1", k): v for k, v in (sinais or {}).items()})
    return fila, alertas


def _canais(fila):
    return sorted({(l["canal"], l["contato"], l["condicao"]) for l in fila})


class TestBlend(unittest.TestCase):
    def test_whatsapp_primeiro_quando_ha_numero_com_whatsapp(self):
        fila, _ = _cenario(flags={WA: {"whatsapp_valido": True}}, sinais={WA2: {"rcs": True, "pertence": "sim"}})
        self.assertEqual(_canais(fila), [("whatsapp", WA, "")])     # e-mail vai junto só do SMS

    def test_sem_whatsapp_vai_rcs_so_em_numero_que_pertence(self):
        fila, _ = _cenario(sinais={WA: {"rcs": True, "pertence": "nao"}, WA2: {"rcs": True, "pertence": "sim"}})
        self.assertEqual(_canais(fila), [("rcs", WA2, "")])

    def test_sem_whatsapp_nem_rcs_vai_sms_em_2_numeros_mais_email(self):
        fila, _ = _cenario(sinais={WA: {"pertence": "nao"}})       # "não pertence" nunca recebe
        self.assertEqual({(c, n) for c, n, _ in _canais(fila)},
                         {("sms", WA2), ("sms", TEL3), ("email", EM)})

    def test_reserva_condicional_e_nao_perturbe_na_voz(self):
        d = {"localizacao": {"passos": {"1": [{"canal": "agente_voz"}, {"canal": "discador", "modo": "reserva"}]}}}
        fila, _ = _cenario(definicao=d, sinais={WA: {"nao_perturbe": True}})
        voz = {(l["canal"], l["condicao"]) for l in fila}
        self.assertEqual(voz, {("agente_voz", ""), ("discador", "se agente_voz sem contato no dia")})
        self.assertNotIn(WA, {l["contato"] for l in fila})
        # empresa que decide não respeitar a lista na voz
        fila, _ = _cenario(definicao=d, sinais={WA: {"nao_perturbe": True}},
                           canais={"agente_voz": {"canal": "agente_voz", "respeitar_nao_perturbe": False}})
        self.assertIn(WA, {l["contato"] for l in fila if l["canal"] == "agente_voz"})

    def test_limites_do_canal(self):
        d = {"localizacao": {"passos": {"1": [{"canal": "sms", "numeros": 3}]}}}
        fila, _ = _cenario(definicao=d, canais={"sms": {"canal": "sms", "janela_inicio": "09:00", "janela_fim": "22:00"}})
        self.assertEqual({l["janela"] for l in fila}, {"09:00-20:00"})       # nunca amplia a janela geral
        fila, _ = _cenario(definicao=d, canais={"sms": {"canal": "sms", "ativo": False}})
        self.assertEqual(fila, [])
        sabado = date(2026, 9, 5)
        d_sab = {"localizacao": {"passos": {"4": [{"canal": "sms"}]}}}
        fila, _ = _cenario(definicao=d_sab, dia=sabado, canais={"sms": {"canal": "sms", "sabado": False}})
        self.assertEqual(fila, [])

    def test_capacidade_do_dia_prioriza_maior_saldo(self):
        regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
        over, _ = validar_estrategia({"localizacao": {"passos": {"1": [{"canal": "sms"}]}}})
        regua = carregar_regua().com_clusters(regras, {7: over}, None, {"sms": {"canal": "sms", "capacidade_dia": 1}})
        est = {i: EstadoCliente(i, D0, "DG", "DG", "2026-09", cluster_versao=regua.versao_clusters) for i in ("A", "B")}
        cli = {"A": Cliente("A", D0, 100.0, 30), "B": Cliente("B", D0, 900.0, 30)}
        certs = {(i, f"1190000000{n}"): Certificacao(i, f"1190000000{n}", "telefone", "DESCONHECIDO")
                 for n, i in enumerate(("A", "B"))}
        fila, _, alertas = gerar_fila(est, cli, certs, {}, {}, D0 + timedelta(days=1), regua, [])
        self.assertEqual([l["id_cliente"] for l in fila], ["B"])
        self.assertTrue(any("CAPACIDADE sms" in a for a in alertas))


class TestEstrategia(unittest.TestCase):
    def test_erros_claros(self):
        _, erros = validar_estrategia({"localizacao": {"passos": {"x": [{"canal": "sms"}], "2": [{"canal": "fax"}]}},
                                       "cpc": {"ordem": ["whatsapp", "whatsapp"]}})
        self.assertEqual(len(erros), 3)
        over, erros = validar_estrategia({"localizacao": {"dias_sem_contato_para_ncp": 3}})
        self.assertEqual((erros, over), ([], {"localizacao": {"dias_sem_contato_para_ncp": 3}}))

    def test_cluster_sem_estrategia_usa_a_padrao_da_empresa_e_sem_padrao_o_playbook(self):
        regras, _ = carregar_regras([{"codigo": "SE", "condicoes": []}])
        over, _ = validar_estrategia({"localizacao": {"dias_sem_contato_para_ncp": 3}})
        r = carregar_regua().com_clusters(regras, {1: over}, 1)
        self.assertEqual(r.para("SE")["localizacao"]["dias_sem_contato_para_ncp"], 3)
        self.assertEqual(r.para("SE")["localizacao"]["passos"], carregar_regua()["localizacao"]["passos"])
        self.assertEqual(carregar_regua().com_clusters(regras).para("SE")["localizacao"]["dias_sem_contato_para_ncp"], 8)

    def test_fase_da_estrategia_muda_a_marcacao(self):
        regras, _ = carregar_regras([{"codigo": "RP", "condicoes": [], "estrategia_id": 1}])
        over, _ = validar_estrategia({"localizacao": {"dias_sem_contato_para_ncp": 3}})
        regua = carregar_regua().com_clusters(regras, {1: over})
        est = {"C1": EstadoCliente("C1", D0, "RP", "RP", "2026-09", cluster_versao=regua.versao_clusters)}
        processar_dia(est, {"C1": Cliente("C1", D0, 100.0, 10)}, [], {}, D0 + timedelta(days=3), regua)
        self.assertEqual(est["C1"].estado, "NCP")        # no playbook padrão seria só em D+8

    def test_cpc_com_ordem_e_filtro_da_estrategia(self):
        d = {"cpc": {"ordem": [{"canal": "rcs", "contatos": {"rcs": True}}, {"canal": "sms"}],
                     "junto": [{"canal": "email"}]}}
        regras, _ = carregar_regras([{"codigo": "DG", "condicoes": [], "estrategia_id": 7}])
        over, _ = validar_estrategia(d)
        regua = carregar_regua().com_clusters(regras, {7: over})
        est = {"C1": EstadoCliente("C1", D0, "DG", "DG", "2026-09", estado="CPA", canal_atual="whatsapp",
                                   cluster_versao=regua.versao_clusters)}
        certs = {("C1", c): Certificacao("C1", c, "email" if "@" in c else "telefone", "CERTIFICADO", 0.9)
                 for c in (WA, EM)}
        fila, _, _ = gerar_fila(est, {"C1": Cliente("C1", D0, 100.0, 10)}, certs, {}, {}, date(2026, 9, 10),
                                regua, [])
        # o canal do CPC (WhatsApp) vem primeiro mesmo fora da ordem de reserva da estratégia
        self.assertEqual(sorted(l["canal"] for l in fila), ["email", "whatsapp"])
        est["C1"].canal_atual = "rcs"                            # canal do CPC sem número com RCS
        fila, _, _ = gerar_fila(est, {"C1": Cliente("C1", D0, 100.0, 10)}, certs, {}, {}, date(2026, 9, 10),
                                regua, [])
        self.assertEqual(sorted(l["canal"] for l in fila), ["email", "sms"])   # sem RCS no número → SMS
        fila, _, _ = gerar_fila(est, {"C1": Cliente("C1", D0, 100.0, 10)}, certs, {}, {}, date(2026, 9, 10),
                                regua, [], {("C1", WA): {"rcs": True}})
        self.assertEqual(sorted(l["canal"] for l in fila), ["email", "rcs"])

    def test_retorno_do_enriquecimento_reativa_giro_parado(self):
        regua = carregar_regua()
        g = regua["giro"]
        inicio = D0
        est = {"C1": EstadoCliente("C1", D0, "B1", "B1", "2026-09", estado="NCP", ciclo="RE", giro_inicio=inicio,
                                   giro_pausado=True, reenriquecer="3 ciclos de giro sem contato")}
        pausa = inicio + timedelta(days=g["max_ciclos"] * g["ciclo_dias"])
        dia = pausa + timedelta(days=2)
        trilha = processar_dia(est, {"C1": Cliente("C1", D0, 100.0, 10)}, [], {}, dia, regua,
                               atualizados={"C1": pausa - timedelta(days=5)})    # enriquecimento antigo
        self.assertTrue(est["C1"].giro_pausado)
        trilha = processar_dia(est, {"C1": Cliente("C1", D0, 100.0, 10)}, [], {}, dia, regua,
                               atualizados={"C1": pausa + timedelta(days=1)})
        self.assertFalse(est["C1"].giro_pausado)
        self.assertIsNone(est["C1"].reenriquecer)
        self.assertIn("re-enriquecido", trilha[0]["motivo"])


class TestRetornoEnriquecimento(unittest.TestCase):
    def test_formato_do_bureau(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "base"
            rodar_dia.preparar_base(EMPRESA, EX / "bruto", base)
            rel = rodar_dia.preparar_enriquecimento(EMPRESA, EX / "enriquecimento", base)
            with open(base / "contatos.csv", newline="", encoding="utf-8") as f:
                cont = {(l["id_cliente"], l["contato"]): l for l in csv.DictReader(f, delimiter=";")}
            # reaplicar não duplica nada
            rodar_dia.preparar_enriquecimento(EMPRESA, EX / "enriquecimento", base)
            with open(base / "contatos.csv", newline="", encoding="utf-8") as f:
                self.assertEqual(len(list(csv.DictReader(f, delimiter=";"))), len(cont))
        a = rel["arquivos"][0]
        self.assertEqual((a["clientes_encontrados"], a["sem_cliente"], a["telefones_novos"], a["emails_novos"]),
                         (2, 1, 2, 1))
        novo = cont[("X0001", "11977770009")]               # FONE já vem com DDD: não duplica o 11
        self.assertEqual((novo["origem"], novo["rcs_valido"], novo["nao_perturbe"], novo["score_bureau"],
                          novo["ranking"]), ("enriquecimento", "1", "1", "3", "2"))
        self.assertEqual(cont[("X0002", "21977770002")]["whatsapp_valido"], "1")   # marca atualizada
        self.assertNotIn("NOME", (base.parent / "base").name)

    def test_pertence_pelo_score_quando_configurado(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            cfg = json.loads(EMPRESA.read_text(encoding="utf-8"))
            cfg["enriquecimento"][0]["pertence"] = {"score_min_sim": 4, "score_max_nao": 1}
            (Path(tmp) / "e.json").write_text(json.dumps(cfg), encoding="utf-8")
            base = Path(tmp) / "base"
            rodar_dia.preparar_base(Path(tmp) / "e.json", EX / "bruto", base)
            rodar_dia.preparar_enriquecimento(Path(tmp) / "e.json", EX / "enriquecimento", base)
            with open(base / "contatos.csv", newline="", encoding="utf-8") as f:
                cont = {(l["id_cliente"], l["contato"]): l["pertence"] for l in csv.DictReader(f, delimiter=";")}
        self.assertEqual(cont[("X0001", "11988880001")], "sim")     # score 5
        self.assertEqual(cont[("X0002", "21977770002")], "nao")     # score 1
        self.assertEqual(cont[("X0001", "11977770009")], "")        # score 3: sem decisão

    def test_rotina_com_empresa_estrategia_e_enriquecimento(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "base"
            rodar_dia.preparar_base(EMPRESA, EX / "bruto", base)
            shutil.copytree(EX / "enriquecimento", Path(tmp) / "enr")
            rodar_dia.preparar_enriquecimento(EMPRESA, Path(tmp) / "enr", base)
            estr = [{"id": 1, "nome": "Digital", "padrao": True, "definicao": BLEND},
                    {"id": 2, "nome": "Quebrada", "definicao": {"localizacao": {"passos": {"1": [{"canal": "fax"}]}}}}]
            r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", Path(tmp) / "ret", date(2026, 9, 2),
                                    pasta_estado=Path(tmp) / "estado", pasta_saida=Path(tmp) / "saida",
                                    estrategias=estr, canais=[{"canal": "sms", "capacidade_dia": 100}],
                                    atributos=base / "atributos.csv", out=lambda *a: None)
        self.assertTrue(any("Quebrada" in a for a in r["alertas"]))    # estratégia com erro vira alerta
        self.assertTrue(r["fila"])


if __name__ == "__main__":
    unittest.main()
