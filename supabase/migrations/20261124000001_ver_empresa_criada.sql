-- SQL 27 · Correção: Master (ou Comercial com a permissão) não conseguia criar empresa pelo Console.
-- Erro no site: "new row violates row-level security policy for table empresas".
-- Causa: desde o SQL 21, a regra de leitura de empresas (pode_ver_empresa → minhas_empresas) consulta a
-- própria tabela empresas, e a empresa recém-criada ainda não aparece nessa consulta. O site cria e pede a
-- linha de volta (insert … select), e a leitura dela era recusada.
-- Correção: a leitura de empresas passa a decidir pelas colunas da própria linha (id, vendedor e gerente),
-- com a mesma regra de alcance do SQL 21. Nada muda em quem vê o quê. Pode rodar mais de uma vez.

create or replace function public.pode_ver_empresa_linha(eid bigint, vendedor uuid, gerente uuid)
returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when not p.equipe then p.empresa_id = eid
                    when p.papel = 'admin' then true
                    else public.pode_equipe('ver_empresas')
                         and (p.equipe_alcance = 'todas' or vendedor = p.id or gerente = p.id) end
          from public.perfis p where p.id = auth.uid() and p.ativo), false)
$$;
revoke all on function public.pode_ver_empresa_linha(bigint, uuid, uuid) from public, anon;
grant execute on function public.pode_ver_empresa_linha(bigint, uuid, uuid) to authenticated;

drop policy if exists empresas_ver on public.empresas;
create policy empresas_ver on public.empresas for select to authenticated
    using (public.pode_ver_empresa_linha(id, vendedor_id, gerente_id));
