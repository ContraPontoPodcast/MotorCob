"""scripts/conferir_colunas.py: toda coluna que o site usa em supabase.from('tabela') (select, insert/update/upsert,
filtros, order, onConflict) existe na tabela/view vigente das migrações. Coluna errada só aparece no clique, como
"Could not find the 'papel' column of 'empresa_contatos' in the schema cache" (Empresa › Contatos › Novo contato)."""
import io
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
import conferir_colunas as C  # noqa: E402


def _repo(arquivos: dict[str, str]) -> Path:
    raiz = Path(tempfile.mkdtemp(prefix="conferir_colunas_"))
    for nome, texto in arquivos.items():
        p = raiz / nome
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(texto), encoding="utf-8")
    return raiz


def _achados(arquivos: dict[str, str]) -> list[str]:
    raiz = _repo(arquivos)
    return C.conferir(C.todos_os_usos(raiz), C.esquema_migracoes(raiz / "supabase" / "migrations"))


SQL = {
    "supabase/migrations/20260101000001_a.sql": """
        create table if not exists public.contatos (
            id bigint generated always as identity primary key,
            empresa_id bigint not null,
            nome text not null check (length(nome) > 1),
            papel_contrato text not null default 'operacional' check (papel_contrato in ('operacional', 'financeiro')),
            "Citada" text,
            unique (empresa_id, nome),
            constraint ck check (true)
        );
        -- create table if not exists de novo não muda a tabela
        create table if not exists public.contatos (id int, outra text);
        alter table public.contatos add column if not exists recebe_faturas boolean not null default false,
            add column email text, add constraint ck2 check (true);
        alter table public.contatos rename column email to email_principal;
        alter table public.contatos drop column if exists "Citada";
        create table public.velha (a int);
        alter table public.velha rename to nova;
        create table public.apagada (a int);
        drop table if exists public.apagada;
        create table voz_vm.fora (a int);
        do $$ declare t text; begin
            foreach t in array array['contatos', 'nova'] loop
                execute format('alter table public.%I add column if not exists credor_id bigint', t);
            end loop;
        end $$;
        create or replace view public.resumo as
            select c.id, c.nome as nome_contato, count(*) total, c.empresa_id::text
              from public.contatos c group by 1, 2, 4;
        create or replace view public.aberta as select *, 1 + 1 from public.contatos;
        create or replace function public.prazo(c public.contatos) returns int language sql as $$ select 1 $$;
    """,
}


class TestRepositorio(unittest.TestCase):
    def test_o_site_nao_usa_coluna_que_nao_existe(self):
        achados = C.conferir(C.todos_os_usos(), C.esquema_migracoes())
        self.assertEqual(achados, [], "\n" + "\n".join(achados))

    def test_le_os_usos_do_site(self):
        usos = C.todos_os_usos()
        self.assertGreater(len(usos), 500)
        # o caso que quebrou em produção: Empresa › Contatos grava papel_contrato
        contatos = [u for u in usos if u.arquivo.endswith("empresa/contatos.tsx") and u.metodo in ("insert", "update")]
        self.assertTrue(contatos)
        self.assertTrue(all("papel_contrato" in u.colunas and "papel" not in u.colunas
                            for u in contatos if len(u.colunas) > 1))

    def test_esquema_vigente_das_tabelas_corrigidas(self):
        rels = C.esquema_migracoes()
        self.assertIn("papel_contrato", rels["empresa_contatos"].colunas)
        self.assertIn("recebe_faturas", rels["empresa_contatos"].colunas)    # alter table … add column
        self.assertNotIn("papel", rels["empresa_contatos"].colunas)
        self.assertIn("credor_id", rels["estado_cliente"].colunas)            # DO … foreach … format('%I')
        self.assertIn("prazo_resposta", rels["chamados"].calculadas)           # coluna calculada (função)
        self.assertEqual(rels["mensageria_fornecedores"].colunas & {"id"}, set())


class TestLeitura(unittest.TestCase):
    def test_tabela_alter_rename_drop_e_view(self):
        rels = C.esquema_migracoes(_repo(SQL) / "supabase" / "migrations")
        self.assertEqual(rels["contatos"].colunas,
                         {"id", "empresa_id", "nome", "papel_contrato", "recebe_faturas", "email_principal", "credor_id"})
        self.assertNotIn("velha", rels)
        self.assertEqual(rels["nova"].colunas, {"a", "credor_id"})
        self.assertNotIn("apagada", rels)
        self.assertNotIn("fora", rels)
        self.assertEqual(rels["resumo"].colunas, {"id", "nome_contato", "total", "empresa_id"})
        self.assertFalse(rels["resumo"].aberta)
        self.assertTrue(rels["aberta"].aberta)
        self.assertEqual(rels["contatos"].calculadas, {"prazo"})

    def test_coluna_errada_no_payload_e_no_select(self):
        achados = _achados({**SQL, "site/src/a.tsx": """
            async function salvar(f) {
              const payload = { empresa_id: 1, nome: f.nome, papel: f.papel || null };
              payload.observacao = 'x';
              await supabase.from('contatos').insert(payload);
              await supabase.from('contatos').update({ papel_contrato: 'financeiro' }).eq('id', 1);
              await supabase.from('contatos').select('id, nome, papel').eq('empresa_id', 1).order('nome');
              await sb.from("contatos").upsert([{ nome: 'a' }, { nme: 'b' }], { onConflict: 'empresa_id,nome' });
            }
        """})
        self.assertEqual(len(achados), 3, achados)
        self.assertIn("a.tsx:5: contatos.insert: coluna(s) observacao, papel", achados[0])
        self.assertIn("a.tsx:7: contatos.select: coluna(s) papel", achados[1])
        self.assertIn("a.tsx:8: contatos.upsert: coluna(s) nme", achados[2])

    def test_filtros_order_or_match_e_tabela_inexistente(self):
        achados = _achados({**SQL, "site/src/b.ts": """
            const T = 'contatos';
            const COLS = 'id,nome,emial';
            export async function f() {
              await supabase.from(T).select(COLS).neq('nome', 'x').in('papel', [1]).order('criado_em', { ascending: false });
              await supabase.from('contatos').select('id').or('nome.eq.a,papel.is.null').match({ empresa_id: 1, x: 2 });
              await supabase.from('nao_existe').select('id');
            }
        """})
        self.assertIn("b.ts:5: contatos.select: coluna(s) emial", achados[0])
        self.assertTrue(any(":5: contatos.in: coluna(s) papel" in a for a in achados))
        self.assertTrue(any(":5: contatos.order: coluna(s) criado_em" in a for a in achados))
        self.assertTrue(any(":6: contatos.or: coluna(s) papel" in a for a in achados))
        self.assertTrue(any(":6: contatos.match: coluna(s) x" in a for a in achados))
        self.assertTrue(any(":7: a tabela/view nao_existe não existe" in a for a in achados))
        self.assertEqual(len(achados), 6, achados)

    def test_formas_que_nao_sao_achado(self):
        achados = _achados({**SQL, "site/src/c.tsx": """
            export async function g(payload, sel) {
              await supabase.from('contatos').select('*, empresas(nome), dono:perfis!inner(id), alias:nome, id::text, '
                + 'x');                                                     // texto montado: não lido
              await supabase.from('contatos').select('alias:nome, empresa_id::text, papel_contrato->>a, count');
              await supabase.from('contatos').insert(payload);              // payload de fora: não lido
              await supabase.from('contatos').select(sel).eq('empresas.nome', 'x').order('nome', { referencedTable: 'e' });
              await supabase.from('contatos').select('id, prazo');           // coluna calculada
              await supabase.from('aberta').select('qualquer');             // view com *: aberta
              await supabase.from('resumo').select('total, nome_contato');
              await supabase.storage.from('entradas').upload('a', b);
              const xs = Array.from(new Set([1]));
              await supabase.schema('voz_vm').from('fora').select('zzz');
              // conferir-colunas: coluna criada pela rotina antes do deploy do site
              await supabase.from('contatos').select('nova_coluna');
              await supabase.from('contatos')   // conferir-colunas: a corrente inteira
                .update({ zz: 1 }).eq('yy', 2);
              await supabase.from('contatos').update({ ...(ok ? { nome: 'a' } : { papel_contrato: 'b' }) }).eq('id', 1);
            }
        """})
        self.assertEqual(achados, [])

    def test_main_sai_com_erro(self):
        raiz = _repo({**SQL, "site/src/d.ts": "await supabase.from('contatos').insert({ papel: 'x' });\n"})
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            self.assertEqual(C.main(["--raiz", str(raiz)]), 1)
        self.assertIn("papel", out.getvalue())
        raiz = _repo({**SQL, "site/src/d.ts": "await supabase.from('contatos').insert({ papel_contrato: 'x' });\n"})
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(C.main(["--raiz", str(raiz)]), 0)


if __name__ == "__main__":
    unittest.main()
