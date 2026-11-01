"""Acesso da VM de voz ao banco (voz/acesso.py): escolha do modo, filtros do PostgREST traduzidos para SQL só nas
views de voz_vm, escrita só pelas funções de voz_vm, arquivos por bilhete e a trava do modo real. Sem banco e sem rede
(conexão e Edge Function falsas); o teste contra o Postgres de verdade é supabase/testes/testar_voz_acesso.py.
Só dados fictícios."""
import base64
import importlib.util
import io
import json
import ssl
import threading
import unittest
import urllib.error

from voz import acesso as A
from voz.orquestrador import principal as P

USUARIO = "00000000-0000-4000-8000-000000000001"
BILHETE = "b" * 64


class ConexaoFalsa:
    def __init__(self, respostas=None, cair=0):
        self.chamadas: list[tuple[str, dict]] = []
        self.respostas = list(respostas or [])
        self.cair = cair
        self.fechada = False

    def run(self, sql, **params):
        if self.cair:
            self.cair -= 1
            raise OSError("conexão caiu")
        self.chamadas.append((sql, params))
        if "bilhete_arquivo" in sql:
            return [[BILHETE]]
        if "registrar_retorno" in sql:
            return [[77]]
        return self.respostas.pop(0) if self.respostas else []

    def close(self):
        self.fechada = True


class Resposta(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def acesso(conn=None, abrir=None):
    conn = conn or ConexaoFalsa()
    return A.AcessoProprio(lambda: conn, "https://exemplo-ref.supabase.co", abrir=abrir), conn


class TestModo(unittest.TestCase):
    def test_padrao_e_chave_do_servidor(self):
        self.assertEqual(A.modo_do_ambiente({}), "supabase_chave")
        sb = A.conectar_do_ambiente({"MOTORCOB_SUPABASE_URL": "https://exemplo-ref.supabase.co",
                                     "MOTORCOB_SUPABASE_KEY": "chave-ficticia"})
        self.assertEqual(type(sb).__name__, "Supabase")

    def test_acesso_proprio_nao_conecta_na_criacao_e_nao_le_a_chave(self):
        class Cofre:
            pedidos = []

            def valor(self, ref):
                self.pedidos.append(ref)
                return "senha-ficticia"
        cofre = Cofre()
        amb = {"MOTORCX_VOZ_ACESSO": "acesso_proprio", "MOTORCOB_SUPABASE_URL": "https://exemplo-ref.supabase.co",
               "MOTORCX_VOZ_DB_HOST": "pooler.exemplo.com", "MOTORCX_VOZ_DB_USUARIO": "motorcx_voz.exemploref01"}
        sb = A.conectar_do_ambiente(amb, segredos=cofre)
        self.assertIsInstance(sb, A.AcessoProprio)
        self.assertEqual(cofre.pedidos, [])                     # a senha só é lida ao conectar
        self.assertEqual(A.SEGREDO_SENHA, "motorcx-voz-db-senha")

    def test_configuracao_invalida(self):
        with self.assertRaises(ValueError):
            A.modo_do_ambiente({"MOTORCX_VOZ_ACESSO": "service_role"})
        with self.assertRaises(ValueError):    # usuário do pooler precisa ser motorcx_voz.<ref>
            A.conector_do_ambiente({"MOTORCX_VOZ_DB_HOST": "pooler.exemplo.com", "MOTORCX_VOZ_DB_USUARIO": "postgres.x"},
                                   segredos=object())

    def test_tls_sempre_verificado(self):
        ctx = A.contexto_tls(None)
        self.assertTrue(ctx.check_hostname)
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)

    def test_modo_real_exige_acesso_proprio(self):
        parar = threading.Event()
        parar.set()
        self.assertFalse(P._acesso_proprio_ok(parar, {}))                                 # fica parado, não disca
        self.assertTrue(P._acesso_proprio_ok(parar, {"MOTORCX_VOZ_ACESSO": "acesso_proprio"}))


class TestLeitura(unittest.TestCase):
    def test_filtros_da_voz_viram_sql_parametrizado(self):
        sql, p = A.montar_select("voz_chamadas", {"empresa_id": "eq.12",
                                                  "and": "(ocorrido_em.gte.2026-11-03T00:00:00-03:00,"
                                                         "ocorrido_em.lt.2026-11-04T00:00:00-03:00)",
                                                  "offset": "1000"}, ordem="id_chamada.asc", limite=1000)
        self.assertEqual(sql, 'select to_jsonb(t) from voz_vm.chamadas_tarifacao t where "empresa_id" = :p0 and '
                              '"ocorrido_em" >= :p1 and "ocorrido_em" < :p2 order by "id_chamada" asc limit 1000 offset 1000')
        self.assertEqual(p, {"p0": "12", "p1": "2026-11-03T00:00:00-03:00", "p2": "2026-11-04T00:00:00-03:00"})
        sql, p = A.montar_select("credores", {"empresa_id": "eq.3", "ativo": "eq.true", "id": "in.(1,2)"}, ordem="id.asc")
        self.assertIn("from voz_vm.carteiras t", sql)
        self.assertIn('"id"::text = any(cast(:p2 as text[]))', sql)
        self.assertEqual(p["p2"], ["1", "2"])

    def test_tabela_fora_da_voz_e_recusada(self):
        for t in ("clientes", "estado_cliente", "perfis", "faturas", "envios", "consumo_voz"):
            with self.assertRaises(A.AcessoNegado):
                A.montar_select(t)

    def test_coluna_e_ordem_nao_injetam_sql(self):
        for filtros, ordem in (({'id" or 1=1 --': "eq.1"}, None), ({"id": "like.%"}, None), (None, "id;drop table x.asc"),
                               (None, "id.asc.nullsfirst.x")):
            with self.assertRaises(ValueError):
                A.montar_select("empresas", filtros, ordem)

    def test_selecionar_devolve_dicionarios(self):
        sb, conn = acesso(ConexaoFalsa([[[{"id": 3, "slug": "alfa"}]]]))
        self.assertEqual(sb.selecionar("empresas", {"id": "eq.3"}), [{"id": 3, "slug": "alfa"}])
        self.assertIn("voz_vm.empresas", conn.chamadas[0][0])

    def test_reconecta_quando_a_conexao_cai(self):
        conn = ConexaoFalsa([[[{"concorrencia_contratada": 10}]]], cair=1)
        sb, _ = acesso(conn)
        self.assertEqual(sb.selecionar("voz_contrato", limite=1), [{"concorrencia_contratada": 10}])


class TestEscrita(unittest.TestCase):
    def test_cada_tabela_tem_sua_funcao(self):
        sb, conn = acesso()
        sb.inserir("voz_chamadas", [{"empresa_id": 1, "id_chamada": "c-0001", "id_cliente": "C1"}],
                   conflito="empresa_id,id_chamada,canal")
        sb.inserir("consumo_voz", [{"empresa_id": 1, "dia": "2026-11-03"}], conflito="empresa_id,dia,tech_prefix")
        self.assertIn("voz_vm.gravar_chamadas(cast(:l as jsonb))", conn.chamadas[0][0])
        self.assertEqual(json.loads(conn.chamadas[0][1]["l"])[0]["id_chamada"], "c-0001")
        self.assertIn("voz_vm.gravar_consumo", conn.chamadas[1][0])

    def test_conflito_e_o_do_banco(self):
        """A chave do upsert é a de voz/banco.py › CONFLITO, nos dois acessos: outra chave é erro, não é ignorada."""
        sb, conn = acesso()
        with self.assertRaises(ValueError):
            sb.inserir("voz_chamadas", [{"empresa_id": 1, "id_chamada": "c-0001"}], conflito="id_chamada")
        self.assertEqual(conn.chamadas, [])

    def test_lotes_devolvem_id(self):
        sb, conn = acesso(ConexaoFalsa([[[41]]]))
        self.assertEqual(sb.inserir("voz_lotes", {"empresa_id": 1, "data": "2026-11-03"}, retornar=True), [{"id": 41}])

    def test_lote_grande_vai_em_partes(self):
        sb, conn = acesso()
        sb.inserir("voz_chamadas", [{"id_chamada": f"c-{i:04d}"} for i in range(5)], lote=2)
        self.assertEqual(len(conn.chamadas), 3)

    def test_fora_da_voz_e_recusado(self):
        sb, conn = acesso()
        for t in ("clientes", "perfis", "faturas", "credores", "voz_config"):
            with self.assertRaises(A.AcessoNegado):
                sb.inserir(t, [{"x": 1}])
        for f in (lambda: sb.atualizar("voz_lotes", {"id": "eq.1"}, {}), lambda: sb.apagar("voz_chamadas", {"id": "eq.1"}),
                  lambda: sb.rpc("ligar_voz_real", {}), lambda: sb.listar("saidas", "alfa")):
            with self.assertRaises(A.AcessoNegado):
                f()
        self.assertEqual(conn.chamadas, [])

    def test_rpc_do_fluxo_pela_funcao_de_voz_vm(self):
        sb, conn = acesso(ConexaoFalsa([[[[{"versao_id": 3}]]]]))
        self.assertEqual(sb.rpc("fluxo_voz_em_uso", {"empresa": 1, "credor": None}), [{"versao_id": 3}])
        sql, params = conn.chamadas[0]
        self.assertEqual(sql, "select voz_vm.fluxo_em_uso(cast(:a as jsonb))")
        self.assertEqual(json.loads(params["a"]), {"empresa": 1, "credor": None})
        for publica, vm in (("alcada_voz_vigente", "alcada_vigente"), ("pegar_pedido_fluxo_voz", "pegar_pedido_fluxo"),
                            ("registrar_geracao_fluxo_voz", "registrar_geracao_fluxo"),
                            ("anexos_fluxo_vencidos", "anexos_fluxo_vencidos"),
                            ("marcar_anexos_apagados", "marcar_anexos_apagados")):
            self.assertEqual(A.RPC[publica], vm)

    def test_fluxo_le_e_grava_pelas_views_e_funcoes(self):
        sql, params = A.montar_select("voz_base_respostas", {"fluxo_versao_id": "eq.3", "revisado_em": "not.is.null"})
        self.assertEqual(sql, 'select to_jsonb(t) from voz_vm.base_respostas t where "fluxo_versao_id" = :p0 '
                              'and "revisado_em" is not null')
        self.assertIn("voz_vm.crm_conectores", A.montar_select("crm_conectores", {"situacao": "eq.ativo"})[0])
        self.assertIn("voz_vm.crm_hosts_permitidos", A.montar_select("crm_hosts_permitidos")[0])
        sb, conn = acesso()
        sb.inserir("voz_fluxo_passos", [{"empresa_id": 1, "id_chamada": "c-0001", "ordem": 1}],
                   conflito="empresa_id,id_chamada,ordem")
        sb.inserir("crm_chamadas", [{"empresa_id": 1, "classe": "ok"}])
        self.assertEqual([c[0] for c in conn.chamadas], ["select voz_vm.gravar_fluxo_passos(cast(:l as jsonb))",
                                                         "select voz_vm.gravar_crm_chamadas(cast(:l as jsonb))"])
        with self.assertRaises(ValueError):
            sb.inserir("voz_fluxo_passos", [{"empresa_id": 1}], conflito="id_chamada")
        with self.assertRaises(ValueError):
            A.montar_select("crm_conectores", {"url": "not.like.x"})

    def test_envio_so_de_retorno_pendente(self):
        sb, conn = acesso()
        linha = {"empresa_id": 1, "credor_id": None, "tipo": "retorno", "caminho": "alfa/retorno/x.csv",
                 "nome_original": "x.csv", "enviado_por": USUARIO, "status": "pendente"}
        sb.inserir("envios", linha)
        self.assertIn("voz_vm.registrar_retorno", conn.chamadas[0][0])
        self.assertIsNone(conn.chamadas[0][1]["c"])
        for ruim in ({"tipo": "clientes"}, {"status": "processado"}):
            with self.assertRaises(A.AcessoNegado):
                sb.inserir("envios", {**linha, **ruim})


class TestArquivos(unittest.TestCase):
    def test_baixar_e_enviar_com_bilhete(self):
        pedidos = []

        def abrir(req, timeout=None):
            pedidos.append(req)
            return Resposta(b"id_cliente\nC1\n")
        sb, conn = acesso(abrir=abrir)
        self.assertEqual(sb.baixar("saidas", "alfa/2026-11-03/discador_mailing.csv"), b"id_cliente\nC1\n")
        sb.enviar("entradas", "alfa/retorno/2026-11-03/u_motorcx_voz_2026-11-03_101500.csv", b"a;b\n")
        self.assertEqual(conn.chamadas[0][1], {"o": "baixar", "b": "saidas", "c": "alfa/2026-11-03/discador_mailing.csv"})
        self.assertEqual(pedidos[0].full_url, "https://exemplo-ref.supabase.co/functions/v1/voz-arquivos")
        cab = {k.lower(): v for k, v in pedidos[1].header_items()}
        self.assertEqual((cab["x-voz-bilhete"], cab["x-voz-operacao"]), (BILHETE, "enviar"))
        self.assertNotIn("authorization", cab)                          # nenhuma chave do Supabase sai da VM
        self.assertNotIn("apikey", cab)
        self.assertEqual(pedidos[1].data, b"a;b\n")

    def test_erro_http_nao_repassa_corpo(self):
        def abrir(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 404, "x", {}, io.BytesIO(b"11988887770"))
        sb, _ = acesso(abrir=abrir)
        with self.assertRaises(A.ErroArquivo) as e:
            sb.baixar("saidas", "alfa/2026-11-03/discador_mailing.csv")
        self.assertNotIn("1198888", str(e.exception))

    def test_sem_url_https_nao_tenta(self):
        sb = A.AcessoProprio(lambda: ConexaoFalsa(), "http://exemplo")
        with self.assertRaises(A.ErroArquivo):
            sb.baixar("saidas", "alfa/x.csv")


class TestSenhaDoPapel(unittest.TestCase):
    """infra/asterisk/senha_motorcx_voz.py: o verificador SCRAM é o mesmo que o Postgres gera (vetor tirado de um
    Postgres 16 com password_encryption = scram-sha-256 e uma senha fictícia)."""

    def setUp(self):
        from pathlib import Path
        arq = Path(__file__).resolve().parents[1] / "infra" / "asterisk" / "senha_motorcx_voz.py"
        spec = importlib.util.spec_from_file_location("senha_motorcx_voz", arq)
        self.S = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.S)

    def test_igual_ao_postgres(self):
        sal = base64.b64decode("pXRFe+oliMzBg1IY3Aj56g==")
        self.assertEqual(self.S.verificador("Abc123DefGhi456JklMno789PqrStu012", sal),
                         "SCRAM-SHA-256$4096:pXRFe+oliMzBg1IY3Aj56g==$s5ZqjpjRlt7bkgRZa5/BIjlvyvyCzg1jPkNOZYmr+G8="
                         ":KiQ6u7H1q8veKEL02vSYLCG9VDs3gFw24JPZVJMgJRU=")

    def test_comando_sem_a_senha(self):
        senha = "Abc123DefGhi456JklMno789PqrStu012"
        cmd = self.S.comando(senha)
        self.assertTrue(cmd.startswith("alter role motorcx_voz with password 'SCRAM-SHA-256$4096:"))
        self.assertNotIn(senha, cmd)
        for ruim in ("curta1", "com'aspas" * 5, ""):
            with self.assertRaises(ValueError):
                self.S.comando(ruim)


if __name__ == "__main__":
    unittest.main()
