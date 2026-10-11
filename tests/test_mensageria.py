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

    def _passa(self, l, filtros):
        for k, cond in (filtros or {}).items():
            op, _, v = cond.partition(".")
            if op == "eq" and str(l.get(k)).lower() != v.lower():
                return False
            if op == "in" and str(l.get(k)) not in v.strip("()").split(","):
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
            if "id" not in l and tabela in ("mensageria_lotes", "mensageria_mensagens"):
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
        self.assertEqual(r[lid]["enviadas"], 399)
        msgs = self._msgs("sms")
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
        self.assertEqual(marcas, {"entregue", "inexistente", "bloqueio"})
        self.assertEqual({r.canal for r in regs}, {"sms"})
        self.assertEqual(len(regs), 399)

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
        c = self.sb.t["consumo_mensageria"]
        self.assertEqual([(x["item"], x["competencia"], x["quantidade"]) for x in c], [("sms", "2026-10-01", 399)])

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


if __name__ == "__main__":
    unittest.main()
