-- Mapeamento dos arquivos da empresa, por credor: o cliente aponta uma vez para quais colunas o
-- MotorCob olha (ocorrência, acordo, pagamento) e marca quais resultados de ocorrência são CPC,
-- número errado ou "não contatar". O motor sugere (sugerido/cabecalho, visto_em) e segura os
-- arquivos sem mapeamento; o site confirma (colunas, confirmado, atualizado_em) e a vigia
-- reprocessa. Código de ocorrência novo aparece com mapeado = false até o cliente marcar.
-- Pode ser rodado de novo sem erro.

create table if not exists public.mapeamento_arquivos (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint,
    tipo            text not null check (tipo in ('ocorrencia', 'acordo', 'baixa')),
    colunas         jsonb check (colunas is null or jsonb_typeof(colunas) = 'object'),
    confirmado      boolean not null default false,
    sugerido        jsonb,
    cabecalho       jsonb,
    arquivo         text,
    visto_em        timestamptz,          -- o motor: última vez que viu um arquivo deste tipo
    atualizado_em   timestamptz,          -- o site: quando o cliente confirmou (dispara a rotina)
    atualizado_por  uuid default auth.uid() references auth.users (id),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade,
    unique nulls not distinct (empresa_id, credor_id, tipo)
);

create table if not exists public.ocorrencia_codigos (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint,
    codigo          text not null check (length(codigo) <= 200),
    -- cpc · sem_contato (nenhuma marca) · terceiro (número errado/de outra pessoa) · opt_out (não contatar)
    resultado       text check (resultado in ('cpc', 'sem_contato', 'terceiro', 'opt_out')),
    mapeado         boolean not null default false,
    sugerido        text,
    qtd             int not null default 0,
    primeira_vez    date,
    ultima_vez      date,
    visto_em        timestamptz,
    atualizado_em   timestamptz,
    atualizado_por  uuid default auth.uid() references auth.users (id),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade,
    unique nulls not distinct (empresa_id, credor_id, codigo)
);
create index if not exists ocorrencia_codigos_novos on public.ocorrencia_codigos (empresa_id, credor_id)
    where not mapeado;

do $$
declare t text;
begin
    foreach t in array array['mapeamento_arquivos', 'ocorrencia_codigos'] loop
        execute format('drop trigger if exists a_empresa_do_credor on public.%I', t);
        execute format('create trigger a_empresa_do_credor before insert or update on public.%I '
                       'for each row execute function public.empresa_do_credor()', t);
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_ver', t);
        execute format('create policy %I on public.%I for select to authenticated '
                       'using (public.pode_ver_empresa(empresa_id))', t || '_ver', t);
        execute format('drop policy if exists %I on public.%I', t || '_criar', t);
        execute format('create policy %I on public.%I for insert to authenticated with check '
                       '(public.tem_papel(''admin'', ''planejamento'') and public.pode_ver_empresa(empresa_id))',
                       t || '_criar', t);
        execute format('drop policy if exists %I on public.%I', t || '_editar', t);
        execute format('create policy %I on public.%I for update to authenticated '
                       'using (public.tem_papel(''admin'', ''planejamento'') and public.pode_ver_empresa(empresa_id)) '
                       'with check (public.tem_papel(''admin'', ''planejamento'') and public.pode_ver_empresa(empresa_id))',
                       t || '_editar', t);
        execute format('drop policy if exists %I on public.%I', t || '_apagar', t);
        execute format('create policy %I on public.%I for delete to authenticated '
                       'using (public.tem_papel(''admin'', ''planejamento'') and public.pode_ver_empresa(empresa_id))',
                       t || '_apagar', t);
        execute format('revoke all on public.%I from anon', t);
    end loop;
end $$;

-- envio de ocorrência/acordo/pagamento esperando o mapeamento do cliente
do $$
declare c text;
begin
    for c in select conname from pg_constraint
             where conrelid = 'public.envios'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) like '%status%' loop
        execute format('alter table public.envios drop constraint %I', c);
    end loop;
    alter table public.envios add constraint envios_status_check
        check (status in ('pendente', 'processado', 'erro', 'aguardando'));
end $$;
