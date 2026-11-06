"""scripts/conferir_rpc.py: toda chamada de RPC do site, das Edge Functions e do Python casa com a assinatura vigente
da função no banco (nome dos argumentos, sobrecargas e defaults). O PostgREST acha a função pelo nome dos argumentos:
nome errado só aparece no clique, como "Could not find the function ... in the schema cache"."""
import io
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
import conferir_rpc as C  # noqa: E402


def _repo(arquivos: dict[str, str]) -> Path:
    raiz = Path(tempfile.mkdtemp(prefix="conferir_rpc_"))
    for nome, texto in arquivos.items():
        p = raiz / nome
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(texto), encoding="utf-8")
    return raiz


def _achados(arquivos: dict[str, str]) -> list[str]:
    raiz = _repo(arquivos)
    return C.conferir(C.todas_as_chamadas(raiz), C.assinaturas_migracoes(raiz / "supabase" / "migrations"))


SQL = {
    "supabase/migrations/20260101000001_a.sql": """
        create or replace function public.pedir_envio_real(empresa_id bigint) returns bigint
        language sql as $$ select 1 $$;
        -- trocou o nome do argumento: o Postgres exige drop antes
        drop function if exists public.pedir_envio_real(bigint);
        create or replace function public.pedir_envio_real(empresa bigint) returns bigint
        language sql as $$ select 1 $$;
        create or replace function public.acordos(empresa bigint default null) returns setof int
        language sql as $$ select 1 $$;
        create or replace function public.salvar_preco(empresa bigint, item text, preco numeric default null,
                                                       faixas jsonb default '[{"a": 1}, {"b": 2}]', "Motivo" text = null)
        returns void language sql as $$ select $$;
        create or replace function public.dupla(a int, b int default 0) returns int language sql as $$ select 1 $$;
        create or replace function public.dupla(a int, c text default '') returns int language sql as $$ select 1 $$;
        create or replace function voz_vm.so_da_vm(x int) returns int language sql as $$ select 1 $$;
        create or replace function public.com_saida(empresa bigint, out total numeric) returns numeric
        language sql as $$ select 1 $$;
        do $$ begin execute $f$ create or replace function public.dinamica(lote bigint) returns void
                                language sql as $g$ select $g$ $f$; end $$;
        create or replace function public.apagada(x int) returns int language sql as $$ select 1 $$;
        drop function public.apagada;
    """,
}


class TestRepositorio(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chamadas = C.todas_as_chamadas()

    def test_o_repositorio_nao_tem_chamada_com_argumento_errado(self):
        achados = C.conferir(self.chamadas, C.assinaturas_migracoes())
        self.assertEqual(achados, [], "\n".join(achados))

    def test_le_as_chamadas_do_site_das_funcoes_e_do_python(self):
        arquivos = {c.arquivo.split("/")[0] for c in self.chamadas}
        esperadas = {"site", "nuvem", "voz", "motor"}
        # a imagem do motor não leva supabase/functions (.dockerignore): só cobra as Edge Functions quando existem
        if (C.RAIZ / "supabase" / "functions").is_dir():
            esperadas.add("supabase")
        self.assertTrue(esperadas <= arquivos, arquivos)

    def test_assinatura_vigente_das_funcoes_corrigidas(self):
        sigs = C.assinaturas_migracoes()
        self.assertEqual([a.texto() for a in sigs["pedir_envio_real"]], ["pedir_envio_real(empresa)"])
        self.assertEqual([a.texto() for a in sigs["cancelar_rascunho"]], ["cancelar_rascunho(fatura)"])   # SQL 71
        self.assertEqual([a.texto() for a in sigs["alertas_qualidade"]], ["alertas_qualidade(canal_lote = …)"])


class TestSql(unittest.TestCase):
    def setUp(self):
        self.sigs = C.assinaturas_migracoes(_repo(SQL) / "supabase" / "migrations")

    def test_drop_e_recriacao_com_nome_novo(self):
        self.assertEqual([a.texto() for a in self.sigs["pedir_envio_real"]], ["pedir_envio_real(empresa)"])

    def test_defaults_com_virgula_e_nome_citado(self):
        self.assertEqual(self.sigs["salvar_preco"][0].texto(),
                         "salvar_preco(empresa, item, preco = …, faixas = …, Motivo = …)")

    def test_sobrecargas_parametro_de_saida_e_schema(self):
        self.assertEqual(len(self.sigs["dupla"]), 2)
        self.assertEqual(self.sigs["com_saida"][0].texto(), "com_saida(empresa)")
        self.assertNotIn("so_da_vm", self.sigs)

    def test_funcao_criada_em_bloco_dinamico_e_drop_sem_tipos(self):
        self.assertIn("dinamica", self.sigs)
        self.assertNotIn("apagada", self.sigs)


class TestChamadasErradas(unittest.TestCase):
    """O conferidor tem de FALHAR nestes exemplos quebrados de propósito."""

    def test_argumento_com_nome_errado_no_site(self):
        a = _achados({**SQL, "site/src/a.tsx": """
            const { error } = await supabase.rpc('pedir_envio_real', { empresa_id: empresa.id });
        """})
        self.assertEqual(len(a), 1)
        self.assertIn("site/src/a.tsx:2: pedir_envio_real({empresa_id}) não casa com pedir_envio_real(empresa)", a[0])

    def test_funcao_inexistente_obrigatorio_faltando_e_ambigua(self):
        a = _achados({**SQL, "site/src/a.tsx": """
            await supabase.rpc('cancelar_rascunho', { fatura: f.id });
            await supabase.rpc('salvar_preco', { empresa: 1 });
            await supabase.rpc('dupla', { a: 1 });
            await supabase.rpc('apagada', { x: 1 });
        """})
        self.assertEqual(len(a), 4, a)
        self.assertIn("cancelar_rascunho não existe", a[0])
        self.assertIn("salvar_preco({empresa}) não casa", a[1])
        self.assertIn("dupla é ambígua", a[2])
        self.assertIn("apagada não existe", a[3])

    def test_chave_atribuida_depois_e_espalhamento_condicional(self):
        a = _achados({**SQL, "site/src/a.tsx": """
            const payload: Record<string, unknown> = { empresa: e, item: 'x' };
            if (abaixo) payload.motivo_abaixo_do_minimo = m;
            await supabase.rpc('salvar_preco', payload);
            await supabase.rpc('acordos', { ...(e ? { empresa_id: e } : {}) });
        """})
        self.assertEqual(len(a), 2, a)
        self.assertIn("opcionais: motivo_abaixo_do_minimo", a[0])
        self.assertIn("opcionais: empresa_id", a[1])

    def test_argumentos_ilegiveis_sem_comentario_sao_achado(self):
        a = _achados({**SQL, "site/src/a.tsx": """
            await supabase.rpc('acordos', montar());
            await supabase.rpc(qualFuncao(), { empresa: 1 });
        """})
        self.assertEqual(len(a), 2, a)
        self.assertTrue(all("conferir-rpc" in x for x in a))

    def test_python_e_edge_function(self):
        a = sorted(_achados({**SQL,
                      "nuvem/x.py": """
                          def f(sb, e):
                              args = {"empresa_id": e}
                              sb.rpc("pedir_envio_real", args)
                              sb.rpc("acordos", {**args})
                      """,
                      "supabase/functions/f/index.ts": """
                          const r = await fetch(`${URL}/rest/v1/rpc/pedir_envio_real`, {
                            method: "POST", body: JSON.stringify({ empresa_id: 1 }),
                          });
                      """}))
        self.assertEqual(len(a), 3, a)
        self.assertIn("nuvem/x.py:4: pedir_envio_real({empresa_id})", a[0])
        self.assertIn("nuvem/x.py:5: acordos({empresa_id})", a[1])
        self.assertIn("supabase/functions/f/index.ts:2: pedir_envio_real({empresa_id})", a[2])

    def test_main_sai_com_erro(self):
        raiz = _repo({**SQL, "site/src/a.tsx": "supabase.rpc('pedir_envio_real', { empresa_id: 1 });\n"})
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()):
            self.assertEqual(C.main(["--raiz", str(raiz)]), 1)
        self.assertIn("pedir_envio_real", out.getvalue())


class TestChamadasCertas(unittest.TestCase):
    def test_formas_que_o_conferidor_entende(self):
        a = _achados({**SQL,
                      "site/src/a.tsx": """
                          const fn = acao === 'pausar' ? 'pedir_envio_real' : 'acordos';
                          await supabase!.rpc(fn, { empresa: 1 });
                          await sb.rpc<Row[]>('acordos');
                          await supabase.rpc('salvar_preco', { empresa, item: 'x', faixas: f as Record<string, unknown>, 'Motivo': null });
                          const args = useMemo(() => ({ empresa: e, ...(x ? { item: 'a' } : {}) }), [e, x]);
                          await supabase.rpc('salvar_preco', { ...args, item: 'y' });
                          const rpc = async <T>(nome: string, args: Record<string, unknown>) => sb.rpc(nome, args);  // conferir-rpc: embrulho
                          await rpc<number>('dinamica', { lote: 1 });
                          // supabase.rpc('nao_existe', { x: 1 }) num comentário não conta
                          await supabase.rpc('com_saida', { empresa: 1 }).maybeSingle();
                      """,
                      "supabase/functions/f/regras.ts": 'export const PERMISSAO = "acordos";\n',
                      "supabase/functions/f/index.ts": "await db.rpc(PERMISSAO, { empresa: 1 });\n",
                      "voz/y.py": """
                          from motor import r as R

                          def g(sb, e, rec):
                              sb.rpc("pedir_envio_real", {"empresa": e})
                              sb.rpc("acordos")
                              sb.rpc("salvar_preco", R.para_rpc(e))
                              sb.rpc("salvar_preco", {"empresa": e, "item": "x", **R.extra()})
                      """,
                      "motor/r.py": """
                          def para_rpc(e):
                              return {"empresa": e, "item": "x"}

                          def extra():
                              if False:
                                  return None
                              return {"preco": 1}
                      """})
        self.assertEqual(a, [])


if __name__ == "__main__":
    unittest.main()
