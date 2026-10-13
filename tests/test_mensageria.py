"""Mensageria com fornecedor simulado: lotes, janela, reserva, descadastro, retorno e consumo."""
import json
import os
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock

from nuvem import mensageria as M

SP = M.SP
DIA = date(2026, 10, 14)          # quarta-feira


class SbFalso:
    """O pedaço do PostgREST que a mensageria usa (eq, in, limite, upsert por chave)."""

    def __init__(self):
        self.t, self.seq = {}, 0
        self.arquivos, self.funcoes = {}, {}

    def baixar(self, bucket, caminho):
        return self.arquivos[f"{bucket}/{caminho}"]

    def apagar_arquivos(self, bucket, caminhos):
        for c in caminhos:
            self.arquivos.pop(f"{bucket}/{c}", None)

    def rpc(self, funcao, args=None):
        return self.funcoes[funcao](**(args or {}))

    def _passa(self, l, filtros):
        for k, cond in (filtros or {}).items():
            op, _, v = cond.partition(".")
            if op == "eq" and str(l.get(k)).lower() != v.lower():
                return False
            if op == "in" and str(l.get(k)) not in v.strip("()").split(","):
                return False
            if op == "gt" and not str(l.get(k)) > v:
                return False
            if op == "lt" and not str(l.get(k)) < v:
                return False
            if op == "not" and v == "is.null" and l.get(k) is None:
                return False
        return True

    def selecionar(self, tabela, filtros=None, ordem=None, limite=None):
        ls = [dict(l) for l in self.t.get(tabela, []) if self._passa(l, filtros)]
        return ls[:limite] if limite else ls

    def inserir(self, tabela, linhas, conflito=None, retornar=False, lote=1000):
        t = self.t.setdefault(tabela, [])
        saida = []
        for l in (linhas if isinstance(linhas, list) else [linhas]):
            l = dict(l)
            if conflito:
                chaves = conflito.split(",")
                velho = next((x for x in t if all(x.get(c) == l.get(c) for c in chaves)), None)
                if velho:
                    velho.update(l)
                    saida.append(dict(velho))
                    continue
            if "id" not in l and tabela in ("mensageria_lotes", "mensageria_mensagens", "mensageria_conversas",
                                            "mensageria_conversa_mensagens"):
                self.seq += 1
                l["id"] = self.seq
            t.append(l)
            saida.append(dict(l))
        return saida if retornar else []

    def atualizar(self, tabela, filtros, valores):
        for l in self.t.get(tabela, []):
            if self._passa(l, filtros):
                l.update(valores)


class TestMensageria(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dados = Path(self.tmp.name)
        self.pasta = self.dados / "empresas" / "alfa"
        ids = self.pasta / "saida" / DIA.isoformat() / "ids"
        ids.mkdir(parents=True)
        self.fones = [f"119{n:08d}" for n in range(1, 401)]
        linhas = [f"C{n};{f};Olá, temos uma condição para o seu contrato." for n, f in enumerate(self.fones)]
        linhas.append("C999;(21) 90000-0001;")              # sem frase
        linhas.append(f"C998;{self.fones[0]};Repetido")      # mesmo número de novo: um envio só
        (ids / "sms.csv").write_text("id_cliente;contato;mensagem\n" + "\n".join(linhas) + "\n", encoding="utf-8")
        (ids / "email.csv").write_text("id_cliente;contato\nC1;ana@exemplo.com\nC2;bia@exemplo.com\n", encoding="utf-8")
        self.sb = SbFalso()
        self.sb.t = {
            "empresas": [{"id": 1, "slug": "alfa", "nome": "Alfa", "ativa": True}],
            "empresa_modulos": [{"empresa_id": 1, "modulo": "mensageria", "ativo": True, "canais": ["sms", "email"]}],
            "mensageria_fornecedores": [{"codigo": "zenvia", "canais": ["sms"], "ativo": True},
                                        {"codigo": "infobip", "canais": ["sms"], "ativo": True},
                                        {"codigo": "locaweb", "canais": ["email"], "ativo": True}],
            "mensageria_rotas": [{"empresa_id": None, "canal": "sms", "prioridade": 1, "fornecedor": "zenvia", "ativo": True},
                                 {"empresa_id": None, "canal": "sms", "prioridade": 2, "fornecedor": "infobip", "ativo": True},
                                 {"empresa_id": None, "canal": "email", "prioridade": 1, "fornecedor": "locaweb", "ativo": True}],
            "mensageria_descadastros": [{"empresa_id": 1, "canal": "sms",
                                         "destino_hash": M.hash_destino("sms", self.fones[5])}],
        }

    def tearDown(self):
        self.tmp.cleanup()

    def _criar(self, **kw):
        with mock.patch("nuvem.sincronizar.credores",
                        lambda sb, dados, emp: [{"id": None, "pasta": self.pasta}]):
            return M.criar_lotes(self.sb, 1, None, self.pasta, DIA, out=lambda *a: None, **kw)

    def _processar(self, hora="10:00", dia=DIA):
        h, m = map(int, hora.split(":"))
        with mock.patch("nuvem.sincronizar.credores",
                        lambda sb, dados, emp: [{"id": None, "pasta": self.pasta}]):
            return M.processar(self.sb, self.dados, datetime(dia.year, dia.month, dia.day, h, m, tzinfo=SP),
                               out=lambda *a: None)

    def _validos(self):
        """Números do lote de SMS que a consulta de operadora simulada aceita (fora o descadastrado)."""
        return [f for n, f in enumerate(self.fones) if n != 5 and M.operadora_simulada(f) != "invalido"]

    def _lote(self, canal):
        return next(l for l in self.sb.t["mensageria_lotes"] if l["canal"] == canal)

    def _msgs(self, canal):
        lid = self._lote(canal)["id"]
        return [m for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lid]

    def test_destino_normalizado_mascarado_e_hash_igual_ao_banco(self):
        self.assertEqual(M.normalizar("sms", "+55 (11) 98888-7766"), "11988887766")
        self.assertEqual(M.hash_destino("sms", "11988887766"),
                         "07957c85a7805d5b436a6f6d664cba6ecd2d97bd8a87a7f3cd515cf6b6f80294")   # = public.hash_destino
        self.assertEqual(M.mascarar("sms", "11988887766"), "(11) 9••••-••66")
        self.assertEqual(M.mascarar("email", " Ana@Exemplo.com "), "an••@exemplo.com")

    def test_lote_nasce_sem_contato_no_banco_e_aguardando_aprovacao(self):
        self._criar()
        sms = self._lote("sms")
        self.assertEqual((sms["situacao"], sms["modo"], sms["total"]), ("aguardando_aprovacao", "simulado", 401))
        bloq = {m["id_cliente"]: m["motivo"] for m in self._msgs("sms") if m["situacao"] == "bloqueada"}
        self.assertEqual(bloq, {"C5": "descadastrado", "C999": "sem frase no dia"})
        texto = json.dumps(self.sb.t["mensageria_mensagens"])
        self.assertNotIn("119000000", texto)                       # nenhum telefone aberto
        self.assertNotIn("Olá", texto)                             # nem o texto
        local = json.loads((self.pasta / "mensageria" / f"lote_{sms['id']}.json").read_text(encoding="utf-8"))
        self.assertEqual(len(local), 399)
        # e-mail sem modelo: tudo bloqueado, nada a enviar
        em = self._lote("email")
        self.assertEqual((em["situacao"], em["bloqueadas"]), ("concluido", 2))
        # rodada repetida no mesmo dia não duplica
        self._criar()
        self.assertEqual(len(self.sb.t["mensageria_lotes"]), 2)

    def test_so_envia_aprovado_e_dentro_da_janela(self):
        self._criar()
        self.assertEqual(self._processar(), {})                     # aguardando aprovação: nada sai
        self._lote("sms")["situacao"] = "agendado"
        self.assertEqual(self._processar("07:59"), {})              # antes da janela
        self.assertEqual(self._processar("20:00"), {})              # depois da janela
        r = self._processar("10:00")
        lid = self._lote("sms")["id"]
        self.assertEqual(r[lid]["situacao"], "concluido")
        self.assertEqual(r[lid]["disparadas"], len(self._validos()))
        self.assertLess(len(self._validos()), 399)                  # a consulta barrou algum número inválido
        msgs = self._msgs("sms")
        self.assertEqual({m["motivo"] for m in msgs if m["situacao"] == "bloqueada"},
                         {"descadastrado", "sem frase no dia", "número inválido (consulta de operadora)"})
        self.assertFalse([m for m in msgs if m["situacao"] == "pendente"])
        self.assertEqual({m["fornecedor"] for m in msgs if m["situacao"] != "bloqueada"}, {"zenvia"})
        self.assertGreater(sum(m["situacao"] == "entregue" for m in msgs), 360)

    def test_domingo_nao_envia_e_lote_velho_cancela(self):
        self._criar()
        self._lote("sms").update(situacao="agendado", data="2026-10-18")      # lote de um domingo
        self.assertEqual(self._processar("10:00", date(2026, 10, 18)), {})   # domingo: não envia
        r = self._processar("10:00", date(2026, 10, 19))                     # dia seguinte: lote velho
        self.assertEqual(r[self._lote("sms")["id"]]["situacao"], "cancelado")

    def test_reserva_assume_quando_o_principal_cai(self):
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        with mock.patch.dict(os.environ, {"MOTORCOB_SIMULAR_QUEDA": "zenvia"}):
            self._processar()
        self.assertEqual({m["fornecedor"] for m in self._msgs("sms") if m["situacao"] != "bloqueada"}, {"infobip"})

    def test_todos_fora_tenta_de_novo_e_desiste_na_terceira(self):
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        with mock.patch.dict(os.environ, {"MOTORCOB_SIMULAR_QUEDA": "zenvia,infobip"}):
            r = self._processar()
            lid = self._lote("sms")["id"]
            self.assertEqual(r[lid]["situacao"], "enviando")
            self.assertIn("fornecedores indisponíveis", self._lote("sms")["motivo"])
            self._processar()
            self._processar()
        primeira = next(m for m in self._msgs("sms") if m["situacao"] != "bloqueada" and m["id_cliente"] == "C0")
        self.assertEqual((primeira["situacao"], primeira["tentativas"]), ("falhou", 3))

    def test_sair_vira_descadastro_e_retorno_para_o_motor(self):
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        self._processar()
        saiu = [m for m in self._msgs("sms") if m["situacao"] == "descadastro"]
        self.assertTrue(saiu)
        hashes = {d["destino_hash"] for d in self.sb.t["mensageria_descadastros"]}
        self.assertTrue({m["destino_hash"] for m in saiu} <= hashes)
        regs = M.registros(self.pasta)
        marcas = {r.marca for r in regs}
        self.assertEqual(marcas, {"entregue", "inexistente", "bloqueio", "clique"})   # clique: respondeu (Radar)
        self.assertEqual({r.canal for r in regs}, {"sms"})
        conversas = self.sb.t["mensageria_conversas"]
        sem_dlr = [m for m in self._msgs("sms") if m["situacao"] == "enviada"]   # sem retorno final: não volta
        self.assertEqual(len(regs), len(self._validos()) - len(sem_dlr) + len(conversas))

    def test_funil_disparado_enviado_entregue_e_sem_retorno(self):
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        self._processar()
        l, msgs = self._lote("sms"), self._msgs("sms")
        recusadas = [m for m in msgs if m["motivo"] == "recusado pela operadora (simulado)"]
        sem_dlr = [m for m in msgs if m["situacao"] == "enviada"]
        self.assertTrue(recusadas and sem_dlr)
        self.assertEqual(l["disparadas"], len(self._validos()))                  # tudo o que foi à operadora
        self.assertEqual(l["enviadas"], l["disparadas"] - len(recusadas))       # a operadora confirmou o envio
        self.assertEqual(l["sem_retorno"], len(sem_dlr))                         # sem DLR final = "enviada"
        self.assertEqual(l["enviadas"], l["entregues"] + (l["falhas"] - len(recusadas)) + l["sem_retorno"])
        self.assertEqual(l["entregues"], len([m for m in msgs if m["situacao"] in ("entregue", "descadastro")]))
        self.assertEqual(l["falhas"], len([m for m in msgs if m["situacao"] == "falhou"]))

    def test_email_bounce_aberturas_cliques_e_spam(self):
        ids = self.pasta / "saida" / DIA.isoformat() / "ids"
        (ids / "email.csv").write_text("id_cliente;contato\n" + "\n".join(
            f"E{n};cliente{n}@exemplo.com" for n in range(1500)) + "\n", encoding="utf-8")
        self.sb.t["mensageria_modelos_email"] = [{"empresa_id": 1, "remetente_nome": "Alfa", "assunto": "Sua conta",
                                                  "corpo": "Temos uma condição para você."}]
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "simulado", "aprovar_lotes": False}]
        self._criar()
        for _ in range(4):
            self._processar()
        l, msgs = self._lote("email"), self._msgs("email")
        perm = [m for m in msgs if m.get("bounce") == "permanente"]
        temp = [m for m in msgs if m.get("bounce") == "temporario"]
        self.assertEqual(l["disparadas"], l["enviadas"])                        # e-mail: provedor recebeu = enviado
        self.assertEqual((l["falhas"], l["bounce_temporario"]), (len(perm), len(temp)))
        self.assertTrue(perm and temp and l["aberturas"] and l["cliques"])
        self.assertLessEqual(l["cliques"], l["aberturas"])
        self.assertEqual(l["aberturas"], len([m for m in msgs if m.get("aberta_em")]))
        spam = [m for m in msgs if m.get("spam_em")]
        self.assertTrue(spam)
        self.assertEqual(l["spam"], len(spam))
        origem = {d["destino_hash"]: d.get("origem") for d in self.sb.t["mensageria_descadastros"]}
        self.assertTrue(all(origem.get(m["destino_hash"]) == "reclamacao" for m in spam))
        # bounce temporário não marca o e-mail como inexistente na Orquestração
        marcados = {r.contato for r in M.registros(self.pasta) if r.canal == "email"}
        self.assertFalse({f"cliente{m['id_cliente'][1:]}@exemplo.com" for m in temp} & marcados)

    def test_simulado_nao_cobra_e_real_sem_integracao_nao_envia(self):
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        self._processar()
        self.assertNotIn("consumo_mensageria", self.sb.t)           # simulado: nada na fatura
        # modo real sem adaptador do fornecedor: nada sai, motivo claro
        self.sb.t["mensageria_lotes"].clear()
        self.sb.t["mensageria_mensagens"].clear()
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "real", "aprovar_lotes": False}]
        self._criar()
        self._processar()
        self.assertIn("ainda sem integração", self._lote("sms")["motivo"])
        self.assertNotIn("consumo_mensageria", self.sb.t)

    def test_real_com_integracao_entra_no_consumo(self):
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "real", "aprovar_lotes": False}]
        with mock.patch.dict(M.ADAPTADORES_REAIS, {"zenvia": lambda: M.Simulador("zenvia")}):
            self._criar()
            self._processar()
        c = {x["item"]: x for x in self.sb.t["consumo_mensageria"]}
        self.assertEqual((c["sms"]["competencia"], c["sms"]["quantidade"]), ("2026-10-01", 399))   # sem consulta real
        respostas = sum(1 for m in self._msgs("sms") if m.get("respondida_em"))
        self.assertGreater(respostas, 0)
        self.assertEqual(c["sms_resposta"]["quantidade"], respostas)              # cada resposta é cobrada

    def test_pre_pago_sem_saldo_pausa_o_envio_real(self):
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "real", "aprovar_lotes": False}]
        saldo = {"pre_pago": True, "saldo": 0, "pausar_envios": True}
        self.sb.funcoes["saldo_empresa"] = lambda empresa: [saldo]
        with mock.patch.dict(M.ADAPTADORES_REAIS, {"zenvia": lambda: M.Simulador("zenvia")}):
            self._criar()
            self._processar()
            self.assertEqual(self._lote("sms")["situacao"], "pausado")
            self.assertIn("saldo pré-pago esgotado", self._lote("sms")["motivo"])
            self.assertNotIn("consumo_mensageria", self.sb.t)
            # "continuar mesmo sem saldo": o saldo fica negativo e o lote sai
            saldo["pausar_envios"] = False
            self._lote("sms")["situacao"] = "agendado"
            self._processar()
        self.assertTrue(self.sb.t.get("consumo_mensageria"))

    def test_email_com_modelo_sai_pela_locaweb(self):
        self.sb.t["mensageria_modelos_email"] = [{"empresa_id": 1, "remetente_nome": "Alfa", "assunto": "Sua conta",
                                                  "corpo": "Temos uma condição para você."}]
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "simulado", "aprovar_lotes": False}]
        self._criar()
        self.assertEqual(self._lote("email")["situacao"], "agendado")
        self.sb.t["mensageria_modelos_email"][0]["corpo"] = "A {empresa} tem uma condição para você."
        self.sb.t["mensageria_lotes"].clear()
        self._criar()
        local = json.loads((self.pasta / "mensageria" / f"lote_{self._lote('email')['id']}.json").read_text("utf-8"))
        self.assertEqual({v["texto"] for v in local.values()}, {"A Alfa tem uma condição para você."})
        self._processar()
        self.assertEqual({m["fornecedor"] for m in self._msgs("email")}, {"locaweb"})

    def test_sabado_sem_envio_cancela_o_lote(self):
        sab = date(2026, 10, 17)
        ids = self.pasta / "saida" / sab.isoformat() / "ids"
        ids.mkdir(parents=True)
        (ids / "sms.csv").write_text("id_cliente;contato;mensagem\nC1;11900000001;Oi\n", encoding="utf-8")
        with mock.patch("nuvem.sincronizar.credores", lambda sb, dados, emp: [{"id": None, "pasta": self.pasta}]):
            M.criar_lotes(self.sb, 1, None, self.pasta, sab, [{"canal": "sms", "sabado": False}], out=lambda *a: None)
        lote = self.sb.t["mensageria_lotes"][-1]
        self.assertEqual(lote["situacao"], "cancelado")

    # ---------------------------------------------------------------- planos de rota por % e custo
    def _planos(self, proprio=False):
        self.sb.t["mensageria_fornecedores"].append({"codigo": "sinch", "canais": ["sms"], "ativo": True})
        self.sb.t["mensageria_planos_rota"] = [
            {"id": 10, "nome": "Padrão SMS", "canal": "sms", "padrao": True, "ativo": True},
            {"id": 11, "nome": "Econômico", "canal": "sms", "padrao": False, "ativo": True}]
        self.sb.t["mensageria_plano_fornecedores"] = [
            {"plano_id": 10, "fornecedor": "zenvia", "percentual": "70.00", "ordem_reserva": 1},
            {"plano_id": 10, "fornecedor": "infobip", "percentual": "30.00", "ordem_reserva": 2},
            {"plano_id": 10, "fornecedor": "sinch", "percentual": "0.00", "ordem_reserva": 3},
            {"plano_id": 11, "fornecedor": "sinch", "percentual": "100.00", "ordem_reserva": 1}]
        self.sb.t["mensageria_custos"] = [
            {"fornecedor": "zenvia", "item": "sms", "custo": "0.04000", "vigente_desde": "2026-09-01"},
            {"fornecedor": "zenvia", "item": "sms", "custo": "0.03500", "vigente_desde": "2026-10-01"},
            {"fornecedor": "zenvia", "item": "sms", "custo": "0.01000", "vigente_desde": "2026-11-01"},
            {"fornecedor": "infobip", "item": "sms", "custo": "0.05000", "vigente_desde": "2026-01-01"}]
        if proprio:
            self.sb.t["mensageria_rota_empresa"] = [{"empresa_id": 1, "canal": "sms", "plano_id": 11}]
        self._criar()
        self._lote("sms")["situacao"] = "agendado"

    def _por_forn(self):
        saida = {}
        for m in self._msgs("sms"):
            if m.get("fornecedor"):
                saida[m["fornecedor"]] = saida.get(m["fornecedor"], 0) + 1
        return saida

    def test_plano_divide_o_trafego_pelo_percentual(self):
        self._planos()
        self._processar()
        n = self._por_forn()
        self.assertEqual(set(n), {"zenvia", "infobip"})            # sinch com 0% é só reserva
        self.assertEqual(sum(n.values()), len(self._validos()))
        self.assertAlmostEqual(n["zenvia"] / sum(n.values()), 0.70, delta=0.06)

    def test_sorteio_e_estavel_e_reserva_vem_depois(self):
        plano = [{"fornecedor": "zenvia", "percentual": 70.0, "ordem_reserva": 1},
                 {"fornecedor": "infobip", "percentual": 30.0, "ordem_reserva": 2},
                 {"fornecedor": "sinch", "percentual": 0.0, "ordem_reserva": 3}]
        self.assertEqual(M.escolher(plano, "7:42"), M.escolher(plano, "7:42"))
        for chave in ("1:1", "1:2", "1:3", "9:99"):
            ordem = M.escolher(plano, chave)
            self.assertEqual(sorted(ordem), ["infobip", "sinch", "zenvia"])
            self.assertEqual(ordem[-1], "sinch")
        self.assertEqual(M.escolher([{"fornecedor": "a", "percentual": 0.0, "ordem_reserva": 2},
                                     {"fornecedor": "b", "percentual": 0.0, "ordem_reserva": 1}], "x"), ["b", "a"])

    def test_plano_proprio_da_empresa_vale_sobre_o_padrao(self):
        self._planos(proprio=True)
        self._processar()
        self.assertEqual(set(self._por_forn()), {"sinch"})

    def test_fornecedor_fora_do_ar_os_outros_assumem(self):
        self._planos()
        with mock.patch.dict(os.environ, {"MOTORCOB_SIMULAR_QUEDA": "zenvia"}):
            self._processar()
        self.assertEqual(set(self._por_forn()), {"infobip"})
        self.assertEqual(self._lote("sms")["situacao"], "concluido")

    def test_fornecedor_desativado_sai_do_plano(self):
        self._planos()
        self.sb.t["mensageria_fornecedores"][0]["ativo"] = False             # zenvia desligada
        self._processar()
        self.assertEqual(set(self._por_forn()), {"infobip"})

    def test_custo_do_dia_por_fornecedor_vai_para_a_margem(self):
        self._planos()
        self.sb.t["mensageria_custos"].pop(3)                                # infobip sem custo cadastrado
        self._processar()
        n = self._por_forn()
        def soma(forn, item, campo):
            return sum(c[campo] for c in self.sb.t["mensageria_consumo_fornecedor"]
                       if c["fornecedor"] == forn and c["item"] == item)
        z = [c for c in self.sb.t["mensageria_consumo_fornecedor"] if c["fornecedor"] == "zenvia" and c["item"] == "sms"]
        self.assertEqual({(c["competencia"], c["modo"]) for c in z}, {("2026-10-01", "simulado")})
        self.assertEqual({c["operadora"] for c in z} - {"vivo", "claro", "tim", "oi", "outras"}, set())
        self.assertEqual(soma("zenvia", "sms", "quantidade"), n["zenvia"])
        self.assertAlmostEqual(soma("zenvia", "sms", "custo"), n["zenvia"] * 0.035, places=4)   # vigente em 14/10
        self.assertEqual(soma("infobip", "sms", "quantidade_sem_custo"), n["infobip"])
        self.assertEqual(soma("infobip", "sms", "custo"), 0)
        consultas = [c for c in self.sb.t["mensageria_consumo_fornecedor"] if c["item"] == "consulta_operadora"]
        self.assertEqual(sum(c["quantidade"] for c in consultas), 399)             # uma consulta por número
        self.assertNotIn("consumo_mensageria", self.sb.t)                    # simulado continua fora da fatura
        # segunda rodada soma no mês
        self.sb.t["mensageria_lotes"].clear()
        self.sb.t["mensageria_mensagens"].clear()
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        self._processar()
        segunda = self._lote("sms")["disparadas"]                   # quem disse SAIR na primeira já fica de fora
        self.assertEqual(sum(c["quantidade"] for c in self.sb.t["mensageria_consumo_fornecedor"] if c["item"] == "sms"),
                         sum(n.values()) + segunda)

    def test_sem_plano_continua_usando_a_rota_antiga(self):
        self.assertEqual(M.plano_rota(self.sb, 1, "sms", "simulado"),
                         [{"fornecedor": "zenvia", "percentual": 100.0, "ordem_reserva": 1, "operadora": None},
                          {"fornecedor": "infobip", "percentual": 0.0, "ordem_reserva": 2, "operadora": None}])

    def test_banco_sem_o_sql_12_usa_a_rota_antiga(self):
        from nuvem.supabase_api import ErroSupabase
        orig = self.sb.selecionar

        def sel(tabela, *a, **k):
            if tabela.startswith(("mensageria_planos", "mensageria_plano_", "mensageria_rota_empresa",
                                  "mensageria_custos", "mensageria_consumo_fornecedor")):
                raise ErroSupabase(404, "relation does not exist", tabela)
            return orig(tabela, *a, **k)
        self.sb.selecionar = sel
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        self._processar()
        self.assertEqual(set(self._por_forn()), {"zenvia"})

    # ---------------------------------------------------------------- SMS: 160 caracteres e operadora
    def test_sms_acima_de_160_caracteres_nao_sai(self):
        ids = self.pasta / "saida" / DIA.isoformat() / "ids"
        (ids / "sms.csv").write_text("id_cliente;contato;mensagem\nC1;11900000001;" + "a" * 160 +
                                     "\nC2;11900000002;" + "a" * 161 + "\n", encoding="utf-8")
        self._criar()
        motivo = {m["id_cliente"]: m["motivo"] for m in self._msgs("sms")}
        self.assertEqual(motivo, {"C1": None, "C2": "frase acima de 160 caracteres"})

    def test_rota_por_operadora(self):
        self._planos()
        self.sb.t["mensageria_plano_fornecedores"].append(
            {"plano_id": 10, "operadora": "vivo", "fornecedor": "sinch", "percentual": "100.00", "ordem_reserva": 1})
        self._processar()
        enviadas = [m for m in self._msgs("sms") if m.get("fornecedor")]
        vivo = {m["fornecedor"] for m in enviadas if m["operadora"] == "vivo"}
        outras = {m["fornecedor"] for m in enviadas if m["operadora"] != "vivo"}
        self.assertEqual(vivo, {"sinch"})
        self.assertEqual(outras, {"zenvia", "infobip"})
        self.assertTrue(any(c["item"] == "sms" and c["operadora"] == "vivo" and c["fornecedor"] == "sinch"
                            for c in self.sb.t["mensageria_consumo_fornecedor"]))

    def test_operadora_cai_e_as_outras_rotas_assumem(self):
        self._planos()
        self.sb.t["mensageria_plano_fornecedores"].append(
            {"plano_id": 10, "operadora": "vivo", "fornecedor": "sinch", "percentual": "100.00", "ordem_reserva": 1})
        with mock.patch.dict(os.environ, {"MOTORCOB_SIMULAR_QUEDA": "sinch"}):
            self._processar()
        vivo = {m["fornecedor"] for m in self._msgs("sms") if m.get("fornecedor") and m["operadora"] == "vivo"}
        self.assertTrue(vivo and vivo <= {"zenvia", "infobip"})

    def test_cache_de_operadora_no_envio_real(self):
        consultas = []
        def consulta(destino):
            consultas.append(destino)
            return "claro"
        self.sb.t["mensageria_fornecedores"][1]["consulta_operadora"] = True        # infobip consulta
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "real", "aprovar_lotes": False}]
        with mock.patch.dict(M.ADAPTADORES_REAIS, {"zenvia": lambda: M.Simulador("zenvia")}), \
                mock.patch.dict(M.CONSULTAS_REAIS, {"infobip": consulta}):
            self._criar()
            self._processar()
            n = len(consultas)
            self.assertEqual(n, 399)
            self.assertEqual(len(self.sb.t["mensageria_operadoras"]), 399)
            self.assertFalse(any(f in json.dumps(self.sb.t["mensageria_operadoras"]) for f in self.fones))  # só hash
            self.sb.t["mensageria_lotes"].clear()
            self.sb.t["mensageria_mensagens"].clear()
            self._criar()
            self._processar()
        self.assertEqual(len(consultas), n)                                         # segunda vez: do cache

    # ---------------------------------------------------------------- RCS: Basic, Single e sessão de 24 h
    def _rcs(self, agente="conversacional", modo="simulado"):
        ids = self.pasta / "saida" / DIA.isoformat() / "ids"
        linhas = [f"R{n};{f};Olá, temos uma condição." for n, f in enumerate(self.fones[:300])]
        linhas.append(f"R900;11977770001;{'b' * 161}")
        linhas.append("R901;11977770002;Curta mas com card;single")
        (ids / "rcs.csv").write_text("id_cliente;contato;mensagem;tipo_rcs\n" + "\n".join(linhas) + "\n",
                                     encoding="utf-8")
        self.sb.t["empresa_modulos"][0]["canais"] = ["rcs"]
        self.sb.t["mensageria_fornecedores"].append({"codigo": "pontaltech", "canais": ["rcs"], "ativo": True})
        self.sb.t["mensageria_rotas"].append({"empresa_id": None, "canal": "rcs", "prioridade": 1,
                                              "fornecedor": "pontaltech", "ativo": True})
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": modo, "aprovar_lotes": False, "rcs_agente": agente}]

    def test_rcs_basic_ate_160_e_single_acima_ou_com_card(self):
        self._rcs()
        self._criar()
        item = {m["id_cliente"]: m["item"] for m in self._msgs("rcs")}
        self.assertEqual((item["R0"], item["R900"], item["R901"]), ("rcs_basic", "rcs_single", "rcs_single"))

    def test_rcs_conversacional_resposta_vira_sessao_e_24h_sem_custo(self):
        self._rcs()
        with mock.patch.dict(M.ADAPTADORES_REAIS, {"pontaltech": lambda: M.Simulador("pontaltech"),
                                                   "zenvia": lambda: M.Simulador("zenvia")}):
            self.sb.t["mensageria_config"][0]["modo"] = "real"
            self._criar()
            self._processar()
            msgs = self._msgs("rcs")
            conv = [m for m in msgs if m["item"] == "rcs_conversacional"]
            self.assertTrue(conv)
            self.assertTrue(all(m["respondida_em"] for m in conv))
            self.assertEqual(len(self.sb.t["mensageria_sessoes_rcs"]), len(conv))
            c = {x["item"]: x["quantidade"] for x in self.sb.t["consumo_mensageria"]}
            self.assertEqual(c["rcs_conversacional"], len(conv))                  # cobrado como Conversacional
            fb = [m for m in msgs if m.get("fallback") == "sms"]
            self.assertTrue(fb)                                                   # ~15% sem RCS foram por SMS
            self.assertEqual(c["rcs_basic"] + c["rcs_conversacional"] + c.get("rcs_single", 0) + c["sms"],
                             sum(1 for m in msgs if m.get("fornecedor")))
            self.assertEqual(c["sms"], len(fb))
            # no mesmo dia, novo lote para os mesmos números: quem está em sessão não paga
            self.sb.t["mensageria_lotes"].clear()
            self.sb.t["mensageria_mensagens"].clear()
            self._criar()
            self._processar("11:00")
        sessao = [m for m in self._msgs("rcs") if m["item"] == "rcs_sessao"]
        self.assertEqual(len(sessao), len(conv))
        self.assertNotIn("rcs_sessao", {x["item"] for x in self.sb.t["consumo_mensageria"]})
        self.assertEqual(sum(c["custo"] for c in self.sb.t["mensageria_consumo_fornecedor"]
                             if c["item"] == "rcs_sessao"), 0)

    def test_rcs_sessao_vence_em_24h(self):
        self._rcs()
        self._criar()
        self._processar()
        self.assertTrue(self.sb.t["mensageria_sessoes_rcs"])
        self.assertEqual(M._sessoes_abertas(self.sb, 1, datetime(2026, 10, 15, 9, 59, tzinfo=SP)) and True, True)
        self.assertEqual(M._sessoes_abertas(self.sb, 1, datetime(2026, 10, 15, 10, 0, 1, tzinfo=SP)), set())

    def test_rcs_agente_nao_conversacional_ignora_resposta(self):
        self._rcs(agente="nao_conversacional")
        self._criar()
        self._processar()
        itens = {m["item"] for m in self._msgs("rcs") if m.get("fornecedor") and not m.get("fallback")}
        self.assertEqual(itens, {"rcs_basic", "rcs_single"})
        self.assertFalse(self.sb.t.get("mensageria_sessoes_rcs"))
        self.assertFalse(any(m.get("respondida_em") for m in self._msgs("rcs")))

    def test_banco_sem_o_sql_13_nao_cria_rcs_nem_grava_colunas_novas(self):
        from nuvem.supabase_api import ErroSupabase
        self._rcs()
        self.sb.t["empresa_modulos"][0]["canais"] = ["sms", "rcs"]
        orig = self.sb.selecionar

        def sel(tabela, *a, **k):
            if tabela in ("mensageria_planos_rota", "mensageria_plano_fornecedores", "mensageria_rota_empresa",
                          "mensageria_custos", "mensageria_consumo_fornecedor", "mensageria_sessoes_rcs",
                          "mensageria_operadoras"):
                raise ErroSupabase(404, "não existe", tabela)
            return orig(tabela, *a, **k)
        self.sb.selecionar = sel
        self._criar()
        self.assertEqual({l["canal"] for l in self.sb.t["mensageria_lotes"]}, {"sms"})
        self._processar()
        self.assertFalse(any("item" in m or "operadora" in m for m in self.sb.t["mensageria_mensagens"]))
        self.assertNotIn("respostas", self._lote("sms"))

    def test_banco_com_13_e_sem_14_rcs_sem_aparelho_so_falha(self):
        from nuvem.supabase_api import ErroSupabase
        self._rcs()
        orig = self.sb.selecionar

        def sel(tabela, *a, **k):
            if tabela in ("mensageria_campanhas", "mensageria_listas_contato"):
                raise ErroSupabase(404, "não existe", tabela)
            return orig(tabela, *a, **k)
        self.sb.selecionar = sel
        self._criar()
        self._processar()
        msgs = self._msgs("rcs")
        self.assertTrue(any(m["motivo"] == "aparelho sem RCS" for m in msgs))
        self.assertFalse(any("fallback" in m for m in msgs))
        self.assertNotIn("fallback", self._lote("rcs"))

    # ---------------------------------------------------------------- Radar e atendimento
    def _rodar(self):
        self._criar()
        self._lote("sms")["situacao"] = "agendado"
        self._processar()

    def test_radar_regras_dao_peso_ao_negocio(self):
        from nuvem import radar
        casos = {"Me manda o boleto FDP": "cpc_negocio", "Já paguei, seu idiota": "alega_pagamento",
                 "Vou procurar meu advogado": "judicial", "Não conheço essa pessoa": "desconhece",
                 "Sim, sou eu": "cpc", "vsf": "baixo_calao", "Vou no Procon, mas me manda o pix": "cpc_negocio"}
        for texto, classe in casos.items():
            self.assertEqual(radar.classificar_regras(texto)["classe"], classe, texto)
        self.assertEqual(radar.redigir("cpf 529.982.247-25 fone 11987654321 a@b.com"),
                         "cpf [número] fone [número] [e-mail]")

    def test_respostas_viram_conversas_classificadas(self):
        self._rodar()
        conv = self.sb.t["mensageria_conversas"]
        msgs = self.sb.t["mensageria_conversa_mensagens"]
        self.assertTrue(conv)
        self.assertEqual(len(conv), self._lote("sms")["respostas"])
        self.assertEqual({m["direcao"] for m in msgs}, {"entrada"})
        self.assertEqual({m["origem_radar"] for m in msgs}, {"regras"})      # simulação: sem custo de IA
        self.assertTrue({c["classe"] for c in conv} <= set(__import__("nuvem.radar").radar.CLASSES) | {"sem_classe"})
        self.assertTrue(all(m["apagar_em"].startswith("2027-01-12") for m in msgs))   # 90 dias
        self.assertNotIn("1190000", json.dumps(conv))                          # só a máscara
        boleto = [m for m in msgs if "boleto" in m["texto"].lower()]
        self.assertTrue(all(m["classe"] == "cpc_negocio" for m in boleto))
        # quem respondeu volta para a Orquestração como contato encontrado ("clique")
        self.assertEqual(sum(1 for r in M.registros(self.pasta) if r.marca == "clique"),
                         sum(1 for c in conv if c["classe"] != "desconhece"))

    def test_radar_usa_ia_no_envio_real_e_cai_nas_regras_se_falhar(self):
        from nuvem import radar
        chamadas = []

        def ia(textos):
            chamadas.append(len(textos))
            return [{"classe": "judicial", "confianca": 0.8, "justificativa": "teste", "origem": "ia"} for _ in textos]
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "real", "aprovar_lotes": False}]
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "x"}), mock.patch.object(radar, "_classificar_ia", ia), \
                mock.patch.dict(M.ADAPTADORES_REAIS, {"zenvia": lambda: M.Simulador("zenvia")}):
            self._criar()
            self._processar()
        self.assertTrue(chamadas and max(chamadas) <= radar.POR_CHAMADA)
        self.assertEqual({c["classe"] for c in self.sb.t["mensageria_conversas"]}, {"judicial"})
        # IA fora do formato: regras assumem
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "x"}), \
                mock.patch.object(radar, "_classificar_ia", lambda t: (_ for _ in ()).throw(KeyError("x"))):
            r = radar.classificar(["me manda o boleto"], out=lambda *a: None)
        self.assertEqual((r[0]["classe"], r[0]["origem"]), ("cpc_negocio", "regras"))

    def test_radar_desligado_na_empresa_usa_regras(self):
        from nuvem import radar
        self.sb.t["mensageria_config"] = [{"empresa_id": 1, "modo": "real", "aprovar_lotes": False, "radar": False}]
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "x"}), \
                mock.patch.object(radar, "_classificar_ia", lambda t: self.fail("não devia chamar a IA")), \
                mock.patch.dict(M.ADAPTADORES_REAIS, {"zenvia": lambda: M.Simulador("zenvia")}):
            self._criar()
            self._processar()
        self.assertTrue(self.sb.t["mensageria_conversas"])

    def test_resposta_pela_plataforma_sai_pelo_canal(self):
        from nuvem import atendimento
        self._rodar()
        conv = self.sb.t["mensageria_conversas"][0]
        self.sb.t["mensageria_conversa_mensagens"].append(
            {"id": 900, "conversa_id": conv["id"], "empresa_id": 1, "direcao": "saida",
             "texto": "Olá! Segue o link do boleto.", "situacao": "pendente"})
        hora = lambda h: datetime(2026, 10, 14, h, 0, tzinfo=SP)  # noqa: E731
        with mock.patch("nuvem.sincronizar.credores", lambda sb, dados, emp: [{"id": None, "pasta": self.pasta}]):
            self.assertEqual(atendimento.enviar(self.sb, self.dados, hora(21), out=lambda *a: None)["aguardando"], 1)
            r = atendimento.enviar(self.sb, self.dados, hora(11), out=lambda *a: None)
        self.assertEqual(r["enviadas"], 1)
        saida = next(m for m in self.sb.t["mensageria_conversa_mensagens"] if m["id"] == 900)
        self.assertEqual(saida["situacao"], "enviada")
        self.assertTrue(any(c["item"] == "sms" and c["quantidade"] >= 1 for c in self.sb.t["mensageria_consumo_fornecedor"]))

    def test_resposta_sem_contato_no_servidor_falha(self):
        from nuvem import atendimento
        self._rodar()
        conv = self.sb.t["mensageria_conversas"][0]
        (self.pasta / "mensageria" / f"lote_{conv['lote_id']}.json").unlink()
        self.sb.t["mensageria_conversa_mensagens"].append(
            {"id": 901, "conversa_id": conv["id"], "empresa_id": 1, "direcao": "saida", "texto": "Oi", "situacao": "pendente"})
        with mock.patch("nuvem.sincronizar.credores", lambda sb, dados, emp: [{"id": None, "pasta": self.pasta}]):
            atendimento.enviar(self.sb, self.dados, datetime(2026, 10, 14, 11, 0, tzinfo=SP), out=lambda *a: None)
        self.assertEqual(next(m for m in self.sb.t["mensageria_conversa_mensagens"] if m["id"] == 901)["situacao"], "falhou")


if __name__ == "__main__":
    unittest.main()
