"""Nota de contato (É dele × Chega × Responde) e o uso dela na ordem dos números da fila.

Tudo com IDs e telefones fictícios (N1, 11911110001…); nenhum dado pessoal.
"""
import csv
import json
import random
import re
import tempfile
import unittest
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from motor import certificacao as CE
from motor.certificacao import Afinidade, Certificacao, Evento, hit_rate_por_canal, nota_contatos
from motor.estrategia import validar_estrategia
from motor.fila import candidatos, contatos_da_acao
from motor.marcacao import EstadoCliente
from motor.persona import MIN_GRUPO, MIN_SUGESTAO, bloco_contato
from motor.regua import carregar_regua
from motor.retorno_canal import Registro

HOJE = date(2026, 10, 29)
A, B, C, L = "11911110001", "11922220002", "11933330003", "11944440004"
REGUA = carregar_regua()


def _cert(idc, contato, score=0.4, status="NAO_CONFIRMADO", tipo="telefone"):
    return Certificacao(idc, contato, tipo, status=status, score=score)


def _ev(idc, contato, canal, resultado, dias_atras, fornecedor="discadora"):
    d = HOJE - timedelta(days=dias_atras)
    return Evento(idc, contato, "telefone", canal, resultado, d, fornecedor=fornecedor,
                  id_externo=f"{idc}|{contato}|{canal}|{resultado}|{d}")


def _est(idc, tentados=(), loc=None):
    e = EstadoCliente(idc, date(2026, 1, 1), "A1", "A1", "2026-10")
    e.contatos_tentados = list(tentados)
    e.contato_localizador = loc
    return e


def _ordem(cands, canal):
    return [c.contato for c in cands.get(canal, [])]


class TestNota(unittest.TestCase):
    def test_e_dele_e_o_score_da_certificacao(self):
        certs = {("N1", A): _cert("N1", A, 0.63)}
        n = nota_contatos([], certs, HOJE)
        e, ch, r, nota = n.partes(certs[("N1", A)], "sms")
        self.assertEqual(e, 0.63)
        self.assertAlmostEqual(nota, e * ch * r)

    def test_chega_pelo_retorno_de_canal_com_prior_da_carteira(self):
        regs = [Registro(A, "sms", "entregue", HOJE - timedelta(days=d), "f") for d in (1, 2, 3, 4)]
        regs += [Registro(B, "sms", "inexistente", HOJE - timedelta(days=d), "f") for d in (1, 2, 3, 4)]
        regs.append(Registro(A, "sms", "lido", HOJE - timedelta(days=1), "f"))      # mesmo envio: conta uma vez
        regs.append(Registro(B, "sms", "bloqueio", HOJE - timedelta(days=1), "f"))  # trava, não alcance
        regs.append(Registro(A, "sms", "inexistente", HOJE, "f"))                    # hoje ainda não vale
        certs = {("N1", A): _cert("N1", A), ("N1", B): _cert("N1", B), ("N1", C): _cert("N1", C)}
        n = nota_contatos([], certs, HOJE, regs)
        tot_k = sum(0.5 ** (d / 60) for d in (1, 2, 3, 4))
        p0 = (tot_k + 1) / (2 * tot_k + 1)                                           # taxa do canal na carteira
        self.assertAlmostEqual(n.chega(C, "sms"), p0)                                # sem retorno: o prior
        self.assertAlmostEqual(n.chega(A, "sms"), (tot_k + CE.FORCA_CHEGA * p0) / (tot_k + CE.FORCA_CHEGA))
        self.assertAlmostEqual(n.chega(B, "sms"), (CE.FORCA_CHEGA * p0) / (tot_k + CE.FORCA_CHEGA))
        self.assertGreater(n.chega(A, "sms"), n.chega(C, "sms"))
        self.assertGreater(n.chega(C, "sms"), n.chega(B, "sms"))
        self.assertEqual(n.chega(A, "whatsapp"), 1.0)                                # canal sem retorno nenhum
        # voz: o retorno "voz" vale para discador e agente virtual
        n2 = nota_contatos([], certs, HOJE, [Registro(A, "voz", "inexistente", HOJE - timedelta(days=1), "f"),
                                             Registro(B, "voz", "entregue", HOJE - timedelta(days=1), "f")])
        self.assertLess(n2.chega(A, "discador"), n2.chega(B, "agente_voz"))

    def test_meia_vida_de_60_dias_no_alcance(self):
        certs = {("N1", A): _cert("N1", A), ("N1", B): _cert("N1", B)}
        regs = [Registro(A, "sms", "inexistente", HOJE - timedelta(days=60), "f"),
                Registro(B, "sms", "inexistente", HOJE - timedelta(days=1), "f"),
                Registro(C, "sms", "entregue", HOJE - timedelta(days=1), "f")]
        n = nota_contatos([], certs, HOJE, regs)
        self.assertAlmostEqual(n.chega_obs[(A, "sms")][1], 0.5)                     # 60 dias = metade do peso
        self.assertGreater(n.chega(A, "sms"), n.chega(B, "sms"))                     # falha velha pesa menos

    def test_responde_encolhe_para_a_afinidade_do_cliente(self):
        evs = [_ev("N1", A, "discador", "cpc", 3), _ev("N1", A, "discador", "nao_atendida", 5)]
        evs += [_ev("N1", B, "discador", "nao_atendida", d) for d in (2, 4, 6)]
        # carteira: outros clientes dão o prior
        evs += [_ev(f"X{i}", f"1195555{i:04d}", "discador", "cpc" if i % 4 == 0 else "nao_atendida", 10)
                for i in range(40)]
        certs = {("N1", A): _cert("N1", A), ("N1", B): _cert("N1", B), ("N1", C): _cert("N1", C)}
        n = nota_contatos(evs, certs, HOJE)
        p0 = Afinidade(evs, hit_rate_por_canal(evs), certs).prob_cpc("N1", "discador")
        self.assertAlmostEqual(n.responde("N1", C, "discador"), p0)                   # nunca tentado: o prior
        self.assertAlmostEqual(n.responde("N1", A, "discador"), (1 + CE.FORCA_RESPONDE * p0) / (2 + CE.FORCA_RESPONDE))
        self.assertAlmostEqual(n.responde("N1", B, "discador"), (0 + CE.FORCA_RESPONDE * p0) / (3 + CE.FORCA_RESPONDE))
        self.assertGreater(n.responde("N1", A, "discador"), n.responde("N1", C, "discador"))
        self.assertGreater(n.responde("N1", C, "discador"), n.responde("N1", B, "discador"))

    def test_responde_descarta_o_vies_da_1a_certificacao_no_prior(self):
        # todo titular certificou uma vez só: o prior P(CPC | titular) não pode ser 100%
        evs = [_ev(f"T{i}", f"1196666{i:04d}", "discador", "cpc", 5) for i in range(20)]
        evs += [_ev(f"T{i}", f"1196666{i:04d}", "discador", "nao_atendida", 3) for i in range(20)]
        certs = CE.certificar_contatos(evs, HOJE)
        n = nota_contatos(evs, certs, HOJE)
        bruto = 20 / 20                                                              # se contasse a seleção
        self.assertLess(n.afinidade.cert_titular["discador"], bruto * 0.9)

    def test_retorno_de_canal_e_voz_sem_contato_nao_contam_como_tentativa(self):
        evs = [_ev("N1", A, "sms", "entregue", 2, fornecedor="canal:sms"),
               Evento("N1", "", "telefone", "discador", "cpc", HOJE - timedelta(days=2))]
        n = nota_contatos(evs, {("N1", A): _cert("N1", A)}, HOJE)
        self.assertEqual(n.resp_obs, {})

    def test_linhas_do_estado_e_resumo_por_cliente(self):
        evs = [_ev("N1", A, "discador", "cpc", 3), _ev("N2", B, "discador", "nao_atendida", 3)]
        certs = {("N1", A): _cert("N1", A, 0.9, "CERTIFICADO"), ("N1", C): _cert("N1", C),
                 ("N2", B): _cert("N2", B, 0.3), ("N3", L): _cert("N3", L, 0.0, "INVALIDO"),
                 ("N4", "n4@exemplo.invalid"): _cert("N4", "n4@exemplo.invalid", 0.4, tipo="email")}
        n = nota_contatos(evs, certs, HOJE)
        linhas = n.linhas(certs)
        linhas = [dict(zip(CE.CAMPOS_NOTA, l)) for l in linhas]
        self.assertEqual({(l["id_cliente"], l["canal"]) for l in linhas}, {("N1", "discador"), ("N2", "discador")})
        self.assertEqual(len(linhas[0]), len(CE.CAMPOS_NOTA))
        res = n.resumo_clientes(certs)
        self.assertEqual(res["N1"]["tem_contato_certificado"], "sim")
        self.assertEqual(res["N2"]["tem_contato_certificado"], "não")
        self.assertEqual(res["N3"], {"melhor_contato": "sem", "tem_contato_certificado": "não",
                                     "contatos_alcancaveis": "0"})
        self.assertEqual(res["N1"]["contatos_alcancaveis"], "2+")
        self.assertEqual(res["N4"]["contatos_alcancaveis"], "1")
        self.assertEqual(res["N1"]["melhor_contato"], "alta")
        self.assertIn(res["N2"]["melhor_contato"], ("baixa", "média"))
        # restrição em todos os canais: não é alcançável
        certs[("N4", "n4@exemplo.invalid")].restricoes = {"email:opt_out"}
        self.assertEqual(n.resumo_clientes(certs)["N4"]["contatos_alcancaveis"], "0")


class TestFila(unittest.TestCase):
    """Os números de N1: A deu CPC no discador, B nunca respondeu, C nunca foi tentado."""

    def setUp(self):
        self.evs = [_ev("N1", A, "discador", "cpc", 3), _ev("N1", A, "discador", "nao_atendida", 6)]
        self.evs += [_ev("N1", B, "discador", "nao_atendida", d) for d in (2, 4, 6)]
        self.evs += [_ev(f"X{i}", f"1195555{i:04d}", "discador", "cpc" if i % 4 == 0 else "nao_atendida", 10)
                     for i in range(40)]
        # A, B e C com o mesmo score; a certificação real não entra (teste da ordem, não da titularidade)
        self.certs = {("N1", c): _cert("N1", c) for c in (B, C, A)}
        self.notas = nota_contatos(self.evs, self.certs, HOJE)
        self.flags = {c: {"whatsapp_valido": True} for c in (A, B, C, L)}

    def cands(self, est, certs=None, regua=REGUA, sinais=None, notas="padrao", freio=False):
        certs = list((certs or self.certs).values())
        return candidatos(est, "A1", certs, self.flags, regua, freio, sinais or {},
                          self.notas if notas == "padrao" else notas)

    def test_numero_com_cpc_passa_a_frente_do_que_nunca_respondeu(self):
        antes = self.cands(_est("N1"), notas=None)
        self.assertEqual(_ordem(antes, "discador"), [B, C, A])                     # empate de score: ordem da base
        depois = self.cands(_est("N1"))
        self.assertEqual(_ordem(depois, "discador"), [A, C, B])
        # SMS: nenhum histórico no canal → empate na nota, fica a ordem de antes
        self.assertEqual(_ordem(depois, "sms"), _ordem(antes, "sms"))

    def test_voz_disca_na_ordem_da_nota(self):
        est = _est("N1")
        cands = self.cands(est)
        voz = contatos_da_acao({"canal": "discador", "numeros": 99}, cands, est, self.flags, {}, REGUA)
        self.assertEqual(voz, [A, C, B])

    def test_hot_e_localizador_continuam_primeiro(self):
        certs = dict(self.certs)
        certs[("N1", L)] = _cert("N1", L, 0.4)
        certs[("N1", "11966660006")] = _cert("N1", "11966660006", 0.9, "CERTIFICADO")
        est = _est("N1", loc=L)
        ordem = _ordem(self.cands(est, certs), "discador")
        self.assertEqual(ordem[:2], [L, "11966660006"])                              # localizador, depois o Hot
        self.assertEqual(ordem[2:], [A, C, B])
        # Hot marcado na carga (sinal) também vem antes de qualquer nota
        ordem = _ordem(self.cands(_est("N1"), sinais={B: {"hot": True}}), "discador")
        self.assertEqual(ordem[0], B)

    def test_rotacao_preservada(self):
        # A já foi exportado (tentado); B e C não: os não tentados vêm antes, mesmo com nota pior
        ordem = _ordem(self.cands(_est("N1", tentados=[A])), "discador")
        self.assertEqual(ordem, [C, B, A])
        ordem = _ordem(self.cands(_est("N1", tentados=[C, A])), "discador")       # tentados: do mais antigo
        self.assertEqual(ordem, [B, C, A])

    def test_criterio_do_usuario_vence_a_nota(self):
        regua = replace(REGUA, dados={**REGUA.dados, "prioridade_contatos": {
            "criterios": [{"campo": "ranking", "sentido": "asc"}]}}, _cache={})
        sinais = {B: {"ranking": 1}, C: {"ranking": 2}, A: {"ranking": 3}}
        self.assertEqual(_ordem(self.cands(_est("N1"), regua=regua, sinais=sinais), "discador"), [B, C, A])

    def test_criterio_nota_na_estrategia(self):
        over, erros = validar_estrategia({"prioridade_contatos": {"criterios": [{"campo": "nota", "sentido": "asc"}]}})
        self.assertEqual(erros, [])
        self.assertEqual(over["prioridade_contatos"]["criterios"], [{"campo": "nota", "sentido": "asc"}])
        _, erros = validar_estrategia({"prioridade_contatos": {"criterios": [{"campo": "notas"}]}})
        self.assertTrue(erros)
        regua = replace(REGUA, dados={**REGUA.dados, "prioridade_contatos": over["prioridade_contatos"]}, _cache={})
        self.assertEqual(_ordem(self.cands(_est("N1"), regua=regua), "discador"), [B, C, A])   # pior nota primeiro
        # o critério vem antes do ranking do bureau
        regua2 = replace(REGUA, dados={**REGUA.dados, "prioridade_contatos": {"criterios": [
            {"campo": "nota", "sentido": "desc"}, {"campo": "ranking", "sentido": "asc"}]}}, _cache={})
        sinais = {B: {"ranking": 1}, C: {"ranking": 2}, A: {"ranking": 3}}
        self.assertEqual(_ordem(self.cands(_est("N1"), regua=regua2, sinais=sinais), "discador"), [A, C, B])

    def test_whatsapp_respeita_a_trava(self):
        # WhatsApp: histórico no canal; nenhum dos três é confiável → a trava libera 1 só, o de maior nota
        evs = [_ev("N1", A, "whatsapp", "identidade_confirmada", 3), _ev("N1", B, "whatsapp", "entregue", 3)]
        evs += [_ev(f"X{i}", f"1195555{i:04d}", "whatsapp", "identidade_confirmada" if i % 4 == 0 else "entregue", 9)
                for i in range(40)]
        notas = nota_contatos(evs, self.certs, HOJE)
        antes = self.cands(_est("N1"), notas=None)
        depois = self.cands(_est("N1"), notas=notas)
        self.assertEqual(_ordem(antes, "whatsapp"), [B])
        self.assertEqual(_ordem(depois, "whatsapp"), [A])                         # 1 número não certificado
        # freio ligado: nenhum não confiável, com ou sem nota
        self.assertEqual(_ordem(self.cands(_est("N1"), notas=notas, freio=True), "whatsapp"), [])
        # o confiável (certificado) continua passando e na frente
        certs = dict(self.certs)
        certs[("N1", C)] = _cert("N1", C, 0.9, "CERTIFICADO")
        self.assertEqual(_ordem(self.cands(_est("N1"), certs, notas=notas), "whatsapp"), [C, A])
        # trava fixa: inválido/contestado/"não pertence" nunca recebe, nem com nota alta
        certs[("N1", A)] = _cert("N1", A, 0.1, "CONTESTADO")
        self.assertNotIn(A, _ordem(self.cands(_est("N1"), certs, notas=notas), "discador"))
        self.assertNotIn(B, _ordem(self.cands(_est("N1"), sinais={B: {"pertence": "nao"}}), "discador"))

    def test_paridade_sem_historico(self):
        """Cliente sem histórico próprio: a ordem é IDÊNTICA à de antes, em todos os canais."""
        rnd = random.Random(7)
        # carteira com histórico (os X), para o prior não ser trivial
        evs = [_ev(f"X{i}", f"1195555{i:04d}", rnd.choice(["discador", "whatsapp", "sms"]),
                   "entregue", rnd.randint(1, 90)) for i in range(60)]
        evs = [e if e.canal != "discador" else replace(e, resultado=rnd.choice(["cpc", "nao_atendida"])) for e in evs]
        regs = [Registro(f"1195555{i:04d}", rnd.choice(["sms", "rcs", "whatsapp", "voz"]),
                         rnd.choice(["entregue", "inexistente", "lido"]), HOJE - timedelta(days=rnd.randint(1, 90)), "f")
                for i in range(60)]
        status = ["DESCONHECIDO", "NAO_CONFIRMADO", "PROVAVEL", "CERTIFICADO", "CONTESTADO", "INVALIDO"]
        certs, sinais, flags, ests = {}, {}, {}, []
        for i in range(300):
            idc = f"P{i}"
            nums = [f"119{rnd.randint(10000000, 99999999)}" for _ in range(rnd.randint(1, 5))]
            if rnd.random() < 0.3:
                nums.append(f"11{rnd.randint(20000000, 59999999)}")                # fixo
            if rnd.random() < 0.5:
                nums.append(f"p{i}@exemplo.invalid")
            for c in nums:
                tipo = "email" if "@" in c else "telefone"
                cert = _cert(idc, c, rnd.choice([0.4, 0.4, 0.55, 0.62, 0.8, 0.91]), rnd.choice(status), tipo)
                if rnd.random() < 0.15:
                    cert.restricoes = {rnd.choice(["whatsapp:sem_conta", "sms:suspenso", "discador:inexistente"])}
                certs[(idc, c)] = cert
                flags[c] = {"whatsapp_valido": rnd.random() < 0.5}
                sinais[(idc, c)] = {k: v for k, v in (("hot", rnd.random() < 0.05), ("ranking", rnd.choice([None, 1, 2])),
                                                      ("pertence", rnd.choice([None, None, "nao"]))) if v}
            ests.append(_est(idc, tentados=rnd.sample(nums, rnd.randint(0, len(nums))),
                             loc=rnd.choice(nums) if rnd.random() < 0.2 else None))
        notas = nota_contatos(evs, certs, HOJE, regs)
        por = {}
        for (idc, c), cert in certs.items():
            por.setdefault(idc, []).append(cert)
        for regra in ({}, {"criterios": [{"campo": "whatsapp", "sentido": "desc"}]}):
            regua = replace(REGUA, dados={**REGUA.dados, "prioridade_contatos": regra}, _cache={})
            for est in ests:
                sin = {c: s for (i, c), s in sinais.items() if i == est.id_cliente}
                for freio in (False, True):
                    antes = candidatos(est, "A1", por[est.id_cliente], flags, regua, freio, sin, None)
                    depois = candidatos(est, "A1", por[est.id_cliente], flags, regua, freio, sin, notas)
                    self.assertEqual({k: [c.contato for c in v] for k, v in antes.items()},
                                     {k: [c.contato for c in v] for k, v in depois.items()}, est.id_cliente)

    def test_erro_na_nota_volta_para_a_ordem_de_antes(self):
        with mock.patch.object(CE.NotaContatos, "nota", side_effect=ZeroDivisionError("quebrou")):
            depois = self.cands(_est("N1"))
        self.assertEqual(_ordem(depois, "discador"), _ordem(self.cands(_est("N1"), notas=None), "discador"))
        self.assertIn("ZeroDivisionError", self.notas.erro)


class TestPersonaContato(unittest.TestCase):
    def test_bloco_contato_e_evidencia(self):
        b = bloco_contato(MIN_SUGESTAO, 50, 20, 70)
        self.assertEqual((b["taxa_localizacao"], b["acoes_por_primeiro_cpc"], b["evidencia"]), (0.25, 3.5, "definida"))
        self.assertEqual(bloco_contato(MIN_GRUPO - 1, 1, 0, 0)["evidencia"], "coletando")
        self.assertEqual(bloco_contato(MIN_GRUPO, 1, 0, 0)["evidencia"], "previa")
        self.assertIsNone(bloco_contato(0, 0, 0, 0)["taxa_localizacao"])


RAIZ = Path(__file__).resolve().parent.parent
EX = RAIZ / "exemplos"


def _rotina(tmp, **kw):
    import rodar_dia
    return rodar_dia.rodar_dia(EX / "clientes.csv", EX / "carteira_contatos.csv", EX / "retornos",
                               date(2026, 9, 25), parcelas_csv=EX / "parcelas.csv",
                               pasta_estado=Path(tmp) / "estado", pasta_saida=Path(tmp) / "saida",
                               out=lambda *a: None, **kw)


class TestRotina(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.r1 = _rotina(cls.tmp.name)
        cls.csv1 = (Path(cls.tmp.name) / "estado" / "contatos_nota.csv").read_text(encoding="utf-8")
        cls.r2 = _rotina(cls.tmp.name)
        cls.csv2 = (Path(cls.tmp.name) / "estado" / "contatos_nota.csv").read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_estado_local_com_a_nota(self):
        linhas = list(csv.DictReader(self.csv1.splitlines(), delimiter=";"))
        self.assertTrue(linhas)
        self.assertEqual(list(linhas[0]), list(CE.CAMPOS_NOTA))
        self.assertTrue(all(abs(float(l["nota"]) - float(l["e_dele"]) * float(l["chega"]) * float(l["responde"]))
                            < 1e-3 for l in linhas))
        self.assertFalse(any("NOTA DE CONTATO" in a for a in self.r1["alertas"]))

    def test_idempotente(self):
        self.assertEqual(self.csv1, self.csv2)
        self.assertEqual(self.r1["fila"], self.r2["fila"])
        self.assertEqual(self.r1["personas"], self.r2["personas"])

    def test_persona_tem_bloco_contato_sem_contato_real(self):
        self.assertTrue(self.r1["personas"])
        for p in self.r1["personas"]:
            self.assertEqual(set(p["contato"]) >= {"taxa_localizacao", "acoes_por_primeiro_cpc", "evidencia"}, True)
            self.assertIn(p["contato"]["evidencia"], ("coletando", "previa", "definida"))
        texto = json.dumps(self.r1["personas"], ensure_ascii=False)
        self.assertNotRegex(texto, r"\d{10,11}")                                       # nenhum telefone
        self.assertNotIn("@", texto)
        self.assertNotRegex(texto, r"C\d{7}")                                          # nenhum ID de cliente
        # resumos por cliente viram atributos (características candidatas da persona e campos de segmento)
        c = next(iter(self.r1["clientes"].values()))
        self.assertIn(c.atributos["melhor_contato"], ("alta", "média", "baixa", "sem"))
        self.assertIn(c.atributos["tem_contato_certificado"], ("sim", "não"))
        self.assertIn(c.atributos["contatos_alcancaveis"], ("0", "1", "2+"))

    def test_nota_muda_so_a_ordem_dentro_do_canal(self):
        """Com e sem a nota: os mesmos clientes, canais e conjuntos de números; só a ordem pode mudar."""
        with tempfile.TemporaryDirectory() as t, \
                mock.patch("rodar_dia.nota_contatos", side_effect=RuntimeError("sem nota")):
            r0 = _rotina(t)
        chave = lambda f: sorted((l["id_cliente"], l["canal"], l["condicao"]) for l in f)   # noqa: E731
        self.assertEqual(chave(r0["fila"]), chave(self.r1["fila"]))

    def test_erro_na_nota_nao_segura_a_lista(self):
        with tempfile.TemporaryDirectory() as t, \
                mock.patch("rodar_dia.nota_contatos", side_effect=RuntimeError("quebrou")):
            r = _rotina(t)
            vazio = (Path(t) / "estado" / "contatos_nota.csv").read_text(encoding="utf-8")
        self.assertTrue(r["fila"])
        self.assertTrue(any(a.startswith("NOTA DE CONTATO: não usada hoje (RuntimeError") for a in r["alertas"]))
        self.assertEqual(vazio.strip(), ";".join(CE.CAMPOS_NOTA))
        # falha no meio da fila (nota de um contato): a lista sai inteira, na ordem de antes
        with tempfile.TemporaryDirectory() as t, \
                mock.patch.object(CE.NotaContatos, "nota", side_effect=ValueError("quebrou")):
            r2 = _rotina(t)
        self.assertEqual([(l["id_cliente"], l["canal"], l["contato"]) for l in r2["fila"]],
                         [(l["id_cliente"], l["canal"], l["contato"]) for l in r["fila"]])
        self.assertTrue(any(a.startswith("NOTA DE CONTATO: não usada hoje (ValueError") for a in r2["alertas"]))

    def test_contato_nunca_vai_para_o_resultado_publicado(self):
        texto = json.dumps({k: self.r1[k] for k in ("personas", "enquadramento", "acoes")}, ensure_ascii=False,
                           default=str)
        self.assertIsNone(re.search(r"\b119\d{8}\b", texto))


if __name__ == "__main__":
    unittest.main()


class TestPersonaNaoUsaContato(unittest.TestCase):
    def test_resumos_de_contato_ficam_fora_da_persona_aprendida(self):
        from motor.persona import FORA_DA_PERSONA, caracteristicas
        from motor.marcacao import Cliente
        c = Cliente("P1", date(2026, 1, 1), 800.0, 40,
                    atributos={"produto": "CARTAO", "melhor_contato": "alta", "tem_contato_certificado": "sim",
                               "contatos_alcancaveis": "2+"})
        f = caracteristicas({"P1": c}, date(2026, 10, 1))["P1"]
        self.assertEqual(f.get("produto"), "CARTAO")
        self.assertFalse(FORA_DA_PERSONA & set(f))
