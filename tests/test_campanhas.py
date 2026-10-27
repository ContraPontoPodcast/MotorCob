"""Campanhas com lista própria: layout livre, higienização, template, centro de custo, fallback do RCS e limpeza."""
import io
import json
import os
import re
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock

from nuvem import campanhas as C
from nuvem import mensageria as M
from tests.test_mensageria import SbFalso

SP = M.SP
AGORA = datetime(2026, 10, 14, 10, 0, tzinfo=SP)          # quarta-feira, dentro da janela


def csv_lista(linhas, sep=";", cab="Celular;Nome;Contrato;CPF;Valor"):
    return ("\n".join([cab.replace(";", sep)] + [sep.join(l) for l in linhas]) + "\n").encode("utf-8")


class TestLayout(unittest.TestCase):
    def test_le_qualquer_separador_e_sem_cabecalho(self):
        for sep in (";", ",", "\t", "|"):
            cab, linhas = C.ler_tabela(csv_lista([["11987654321", "Ana", "K1", "", "10"]], sep), "x.csv")
            self.assertEqual(cab[0], "Celular")
            self.assertEqual(linhas[0][1], "Ana")
        cab, linhas = C.ler_tabela(b"11987654321;Ana\n11912345678;Bia\n", "sem_cabecalho.txt")
        self.assertEqual((cab, len(linhas)), (["coluna_1", "coluna_2"], 2))
        cab, _ = C.ler_tabela("Celular;Situação\n11987654321;Não\n".encode("latin-1"), "latin.csv")
        self.assertEqual(cab[1], "Situação")

    def test_le_xlsx(self):
        from openpyxl import Workbook
        wb = Workbook()
        wb.active.append(["Telefone", "Primeiro nome"])
        wb.active.append([11987654321, "Ana"])
        buf = io.BytesIO()
        wb.save(buf)
        cab, linhas = C.ler_tabela(buf.getvalue(), "lista.xlsx")
        self.assertEqual((cab, linhas), (["Telefone", "Primeiro nome"], [["11987654321", "Ana"]]))

    def test_detecta_colunas_sem_guardar_valores(self):
        linhas = [["(11) 98765-43%02d" % n, f"Pessoa {n}", f"K{n}", "529.982.247-25", "1.234,56"] for n in range(30)]
        cab, corpo = C.ler_tabela(csv_lista(linhas), "a.csv")
        lay = C.detectar_layout(cab, corpo)
        sug = lay["sugestao"]
        self.assertEqual((sug["telefone"], sug["id_cliente"]), ("Celular", "Contrato"))
        self.assertEqual(sug["variaveis"], {"nome": "Nome", "cpf": "CPF", "valor": "Valor"})
        self.assertEqual({c["nome"]: c["tipo"] for c in lay["colunas"]}["CPF"], "cpf")
        self.assertTrue(any("CPF" in a for a in lay["avisos"]))
        texto = json.dumps(lay)
        self.assertNotIn("98765", texto)
        self.assertNotIn("Pessoa", texto)
        self.assertNotIn("529", texto)

    def test_telefone_celular_valido(self):
        self.assertEqual(C.telefone("+55 (11) 98765-4321"), "11987654321")
        self.assertIsNone(C.telefone("(11) 3765-4321"))            # fixo
        self.assertIsNone(C.telefone("(20) 98765-4321"))           # DDD inexistente
        self.assertIsNone(C.telefone("98765-4321"))                # sem DDD


class TestCampanha(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dados = Path(self.tmp.name)
        self.sb = SbFalso()
        self.fones = [f"119{n:08d}" for n in range(1, 51)]
        linhas = [[f, f"Cliente {n}", f"K{n}", "", f"{n},00"] for n, f in enumerate(self.fones)]
        linhas += [["(11) 3333-5555", "Fixo", "K900", "", "1"],               # inválido
                   [self.fones[0], "Repetido", "K901", "", "1"],              # repetido
                   ["11988880001", "Suspeito", "K902", "", "1"],              # lista de bloqueio
                   ["1133334444", "Favorito fixo", "K903", "", "1"],          # favorito passa mesmo fixo
                   ["11977770001", "N" * 200, "K904", "", "1"],               # passa de 160
                   ["11977770002", "Com CPF", "529.982.247-25", "", "1"]]     # ID com CPF vira código
        self.sb.arquivos["entradas/alfa/mensageria/1/lista.csv"] = csv_lista(linhas)
        self.sb.t = {
            "empresas": [{"id": 1, "slug": "alfa", "nome": "Alfa", "ativa": True}],
            "mensageria_fornecedores": [{"codigo": "zenvia", "canais": ["sms"], "ativo": True},
                                        {"codigo": "pontaltech", "canais": ["rcs"], "ativo": True}],
            "mensageria_rotas": [{"empresa_id": None, "canal": "sms", "prioridade": 1, "fornecedor": "zenvia", "ativo": True},
                                 {"empresa_id": None, "canal": "rcs", "prioridade": 1, "fornecedor": "pontaltech",
                                  "ativo": True}],
            "mensageria_templates": [
                {"id": 7, "empresa_id": 1, "canal": "sms", "tipo_midia": "simples",
                 "conteudo": {"texto": "Olá {{nome}}, sua parcela de R$ {{valor}} vence hoje."}},
                {"id": 8, "empresa_id": 1, "canal": "rcs", "tipo_midia": "carrossel", "categoria": "marketing",
                 "conteudo": {"cards": [{"titulo": "Oi {{nome}}", "descricao": "Parcela {{valor}}"},
                                        {"titulo": "Pague com Pix", "botoes": [{"tipo": "url", "rotulo": "Pagar",
                                                                               "valor": "https://x.com/{{contrato}}"}]}]}}],
            "mensageria_listas_contato": [
                {"empresa_id": 1, "tipo": "bloqueio", "canal": "todos", "destino_hash": M.hash_destino("sms", "11988880001")},
                {"empresa_id": 1, "tipo": "favorito", "canal": "sms", "destino_hash": M.hash_destino("sms", "1133334444")}],
            "mensageria_campanhas": [{"id": 1, "empresa_id": 1, "canal": "sms", "nome": "Outubro", "origem": "arquivo",
                                      "template_id": 7, "arquivo_caminho": "alfa/mensageria/1/lista.csv",
                                      "arquivo_nome": "lista.csv", "situacao": "analisando", "fallback": "empresa"}],
            "mensageria_planos_rota": [],
        }

    def tearDown(self):
        self.tmp.cleanup()

    def _confirmar(self, cid=1):
        c = next(x for x in self.sb.t["mensageria_campanhas"] if x["id"] == cid)
        c.update(layout=c["layout_sugerido"]["sugestao"], situacao="agendada", agendada_para=None)
        return c

    def _processar(self, quando=AGORA):
        with mock.patch("nuvem.sincronizar.credores", lambda sb, dados, emp: [{"id": None, "pasta": self.dados / "x"}]):
            return M.processar(self.sb, self.dados, quando, out=lambda *a: None)

    def test_do_arquivo_ao_envio(self):
        self.assertEqual(C.analisar(self.sb, self.dados, out=lambda *a: None), 1)
        c = self.sb.t["mensageria_campanhas"][0]
        self.assertEqual((c["situacao"], c["carregados"]), ("aguardando_layout", 56))
        aviso = self.sb.t["avisos"][-1]                          # sem quem criou: vai para a empresa toda
        self.assertEqual((aviso["para"], aviso["empresa_id"], aviso["titulo"], aviso["link"]),
                         ("empresa", 1, "Lista lida · Outubro", "/mensageria/sms/campanhas?id=1"))
        self.assertEqual(aviso["texto"], "56 linhas. Confira as colunas para continuar.")
        self._confirmar()
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        self.assertEqual((c["situacao"], c["invalidos"], c["duplicados"], c["bloqueados"]), ("em_andamento", 1, 1, 2))
        msgs = [m for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"]]
        motivos = {m["id_cliente"]: m["motivo"] for m in msgs}
        self.assertEqual(motivos["K900"], "contato inválido na higienização")
        self.assertEqual(len({tuple(sorted(m)) for m in msgs}), 1)     # o PostgREST recusa lote com chaves diferentes
        self.assertEqual(motivos["K902"], "lista de bloqueio")
        self.assertEqual(motivos["K904"], "frase acima de 160 caracteres")
        self.assertIsNone(motivos["K903"])                               # favorito fixo passou
        self.assertNotIn("529.982.247-25", motivos)
        self.assertTrue(any(i.startswith("H") for i in motivos))       # CPF virou código
        texto = json.dumps(self.sb.t["mensageria_mensagens"])
        self.assertNotIn("Cliente 1", texto)
        self.assertNotIn(self.fones[1], texto)
        local = json.loads((C.pasta_campanhas(self.dados, "alfa") / f"lote_{lote['id']}.json").read_text("utf-8"))
        self.assertIn("Olá Cliente 3, sua parcela de R$ 3,00 vence hoje.", {v["texto"] for v in local.values()})
        self.assertEqual(lote["situacao"], "agendado")                  # agendar a campanha já é a aprovação
        r = self._processar()
        self.assertEqual(r[lote["id"]]["situacao"], "concluido")
        self.assertFalse(list(self.dados.rglob("canais_mensageria")))   # campanha não volta para a Orquestração
        self.assertEqual(C.concluir(self.sb), 1)
        self.assertEqual(c["situacao"], "concluida")

    def test_campanha_escolhe_o_produto_e_respeita_a_contratacao(self):
        self.sb.t["cobranca_itens"] = [{"codigo": "sms", "canal": "sms", "padrao_canal": True},
                                       {"codigo": "sms_otp", "canal": "sms", "padrao_canal": False}]
        self.sb.t["empresa_produtos"] = [{"empresa_id": 1, "item": "sms", "ativo": True}]
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        c = self._confirmar()
        c["produto"] = "sms_otp"
        self.assertEqual(C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None), [])
        self.assertEqual(c["situacao"], "erro")
        self.assertIn("não contratado", c["erro"])
        self.sb.t["empresa_produtos"].append({"empresa_id": 1, "item": "sms_otp", "ativo": True})
        c.update(situacao="agendada", erro=None)
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        itens = {m["item"] for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"]}
        self.assertEqual(itens - {None}, {"sms_otp"})

    def test_agendada_para_depois_espera(self):
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        self._confirmar()["agendada_para"] = "2026-10-14T15:00:00+00:00"
        self.assertEqual(C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None), [])
        self.assertEqual(len(C.preparar(self.sb, self.dados, datetime(2026, 10, 14, 12, 1, tzinfo=SP),
                                        out=lambda *a: None)), 1)

    def test_arquivo_ilegivel_vira_erro(self):
        self.sb.arquivos["entradas/alfa/mensageria/1/lista.csv"] = b""
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        c = self.sb.t["mensageria_campanhas"][0]
        self.assertEqual(c["situacao"], "erro")
        self.assertIn("vazio", c["erro"])

    def test_centro_de_custo_limita_e_pausa(self):
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        self._confirmar()["centro_custo_id"] = 5
        saldo = {"restante": 1.0}
        self.sb.funcoes["orcamento_centro_motor"] = lambda centro: [
            {"restante": saldo["restante"], "ao_estourar": "bloquear", "preco_sms": 0.1}]
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        r = self._processar()
        rodada = r[lote["id"]]
        self.assertEqual(rodada["enviadas"] + rodada["bloqueadas"], 10)    # R$ 1,00 ÷ R$ 0,10 = 10 da fila
        self.assertEqual(rodada["situacao"], "enviando")
        consumo = self.sb.t["mensageria_consumo_centro"]
        self.assertEqual([(x["centro_id"], x["item"], x["quantidade"]) for x in consumo if x["item"] == "sms"],
                         [(5, "sms", rodada["enviadas"])])
        saldo["restante"] = 0
        r = self._processar()
        self.assertEqual(r[lote["id"]]["situacao"], "pausado")
        self.assertIn("orçamento", next(l for l in self.sb.t["mensageria_lotes"] if l["id"] == lote["id"])["motivo"])

    def test_centro_que_continua_nao_limita(self):
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        self._confirmar()["centro_custo_id"] = 5
        self.sb.funcoes["orcamento_centro_motor"] = lambda centro: [
            {"restante": -50, "ao_estourar": "continuar", "preco_sms": 0.1}]
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        self.assertEqual(self._processar()[lote["id"]]["situacao"], "concluido")

    def test_rcs_carrossel_preenchido_e_fallback(self):
        enviados = []

        class Captura(M.Simulador):
            def enviar(self, canal, destino, texto, assunto=None, conteudo=None):
                enviados.append((canal, conteudo))
                return super().enviar(canal, destino, texto, assunto, conteudo)
        c = self.sb.t["mensageria_campanhas"][0]
        c.update(canal="rcs", template_id=8)
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        self._confirmar()["layout"]["variaveis"]["contrato"] = "Contrato"
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        gravadas = [m for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"]]
        self.assertEqual(len({tuple(sorted(m)) for m in gravadas}), 1)   # o PostgREST recusa lote com chaves diferentes
        with mock.patch.object(M, "adaptador", lambda f, modo: Captura(f)):
            self._processar()
        rcs = [cont for canal, cont in enviados if canal == "rcs"]
        self.assertTrue(rcs and all(x["cards"][0]["titulo"].startswith("Oi ") for x in rcs))
        self.assertTrue(any(x["cards"][0]["titulo"].startswith("Oi Cliente ") for x in rcs))
        self.assertTrue(any(x["cards"][1]["botoes"][0]["valor"].startswith("https://x.com/K") for x in rcs))
        self.assertNotIn("{{", json.dumps(rcs))
        msgs = [m for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"] and m.get("fornecedor")]
        self.assertEqual({m["item"] for m in msgs if not m.get("fallback")}, {"rcs_single"})
        self.assertTrue({m["item"] for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"]}
                        <= {None, "sms", "rcs_basic", "rcs_single"})   # check do banco
        self.assertTrue(any(m.get("fallback") == "sms" and m["fornecedor"] == "zenvia" for m in msgs))
        self.assertGreater(next(l for l in self.sb.t["mensageria_lotes"] if l["id"] == lote["id"])["fallback"], 0)

    def test_rcs_sem_fallback(self):
        c = self.sb.t["mensageria_campanhas"][0]
        c.update(canal="rcs", template_id=8, fallback="nenhum")
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        self._confirmar()["layout"]["variaveis"]["contrato"] = "Contrato"
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        self._processar()
        msgs = [m for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"]]
        self.assertTrue(any(m["motivo"] == "aparelho sem RCS (sem fallback)" and m["situacao"] == "falhou" for m in msgs))
        self.assertFalse(any(m.get("fallback") for m in msgs))

    def test_rodada_do_plantao_faz_tudo(self):
        from nuvem.sincronizar import rodar_mensageria
        with mock.patch("nuvem.sincronizar.credores", lambda sb, dados, emp: [{"id": None, "pasta": self.dados / "x"}]):
            self.sb.funcoes["limpar_mensageria_90d"] = lambda: 0
            rodar_mensageria(self.sb, self.dados, AGORA, out=lambda *a: None)          # analisa
            self._confirmar()
            rodar_mensageria(self.sb, self.dados, AGORA, out=lambda *a: None)          # monta, envia e conclui
        self.assertEqual(self.sb.t["mensageria_campanhas"][0]["situacao"], "concluida")
        self.assertEqual((self.dados / "mensageria_limpeza.txt").read_text(), "2026-10-14")

    def test_links_rastreados_unicos_por_mensagem(self):
        tpl = self.sb.t["mensageria_templates"][0]
        tpl["conteudo"] = {"texto": "{{nome}}, pague em https://pague.exemplo.com/b?c={{contrato}}."}
        self.sb.t["mensageria_campanhas"][0]["rastrear_links"] = True
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        self._confirmar()["layout"]["variaveis"]["contrato"] = "Contrato"
        with mock.patch.dict(os.environ, {"MOTORCOB_LINK_DOMINIO": "mcb.one"}):
            lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        links = self.sb.t["mensageria_links"]
        pend = [m for m in self.sb.t["mensageria_mensagens"] if m["lote_id"] == lote["id"] and m["situacao"] == "pendente"]
        self.assertEqual(len(links), len(pend))
        self.assertEqual(len({l["codigo"] for l in links}), len(links))
        self.assertTrue(all(l["url_destino"].startswith("https://pague.exemplo.com/b?c=") for l in links))
        local = json.loads((C.pasta_campanhas(self.dados, "alfa") / f"lote_{lote['id']}.json").read_text("utf-8"))
        textos = [v["texto"] for v in local.values()]
        curto = re.compile(r"^.+, pague em https://mcb\.one/[0-9A-Za-z]{8}\.$")
        self.assertTrue(textos and all(curto.match(t) for t in textos))                # link original não aparece
        porta = {l["mensagem_id"]: l["codigo"] for l in links}
        um = next(iter(local.items()))
        self.assertIn(porta[int(um[0])], um[1]["texto"])

    def test_limpa_arquivos_com_mais_de_90_dias(self):
        C.analisar(self.sb, self.dados, out=lambda *a: None)
        self._confirmar()
        lote = C.preparar(self.sb, self.dados, AGORA, out=lambda *a: None)[0]
        arq = C.pasta_campanhas(self.dados, "alfa") / f"lote_{lote['id']}.json"
        self.sb.t["mensageria_campanhas"][0]["criado_em"] = "2026-06-01T00:00:00+00:00"
        velho = AGORA.timestamp() - 100 * 86400   # relativo à data do teste, não ao relógio de hoje
        os.utime(arq, (velho, velho))
        C.limpar(self.sb, self.dados, AGORA, out=lambda *a: None)
        self.assertFalse(arq.exists())
        self.assertNotIn("entradas/alfa/mensageria/1/lista.csv", self.sb.arquivos)
        self.assertIsNone(self.sb.t["mensageria_campanhas"][0]["arquivo_caminho"])


if __name__ == "__main__":
    unittest.main()
