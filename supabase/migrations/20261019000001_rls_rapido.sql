-- Desempenho das permissões (RLS): "pode_ver_empresa(empresa_id)" rodava UMA VEZ POR LINHA (é uma
-- função security definer, o Postgres não consegue embutir). Em tabelas grandes (trilha, fila_dia,
-- estado_cliente) a página passava do limite de tempo do Supabase e mostrava "Não foi possível
-- concluir a operação". Agora a lista de empresas que o usuário vê é calculada uma vez por consulta
-- (minhas_empresas) e cada linha só confere se a empresa dela está na lista. Mesmas regras de acesso.
-- Pode ser rodado de novo sem erro (e deve ser rodado depois de qualquer migração que recrie política).

create or replace function public.minhas_empresas() returns setof bigint
language sql stable security definer set search_path = public as $$
    select e.id from public.empresas e
    where exists (select 1 from public.perfis p
                  where p.id = auth.uid() and p.ativo and (p.equipe or p.empresa_id = e.id))
$$;
revoke all on function public.minhas_empresas() from anon;
grant execute on function public.minhas_empresas() to authenticated;

do $$
declare
    r record;
    novo_q text;
    novo_c text;
    padrao constant text := '(public\.)?pode_ver_empresa\(empresa_id\)';
    troca constant text := '(empresa_id IN ( SELECT public.minhas_empresas()))';
begin
    for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
             where schemaname = 'public'
               and (qual ~ padrao or with_check ~ padrao) loop
        novo_q := regexp_replace(r.qual, padrao, troca, 'g');
        novo_c := regexp_replace(r.with_check, padrao, troca, 'g');
        if r.qual is not null and r.with_check is not null then
            execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                           r.policyname, r.schemaname, r.tablename, novo_q, novo_c);
        elsif r.qual is not null then
            execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, novo_q);
        else
            execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, novo_c);
        end if;
    end loop;
end $$;

-- leitura por data na trilha e na fila (Mapa da Esteira, Lista do dia)
create index if not exists trilha_empresa_credor_data_idx on public.trilha (empresa_id, credor_id, data);
create index if not exists fila_dia_empresa_data_idx on public.fila_dia (empresa_id, data);
