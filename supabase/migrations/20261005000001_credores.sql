-- Credores: cada empresa tem uma ou mais carteiras (credores). Toda carga é de um credor, e a
-- estratégia, os segmentos, a lista do dia e os números são por credor.
--
-- * credores: código, nome, ativo e a estratégia padrão do credor.
-- * Toda empresa ganha o credor 'principal' (os dados que já existiam vão para ele). Empresa
--   nova também nasce com ele; dá para renomear e criar outros no site.
-- * credor_id em envios, execucoes, estado_cliente, trilha, fila_dia, acoes_dia, personas,
--   sugestoes e kpis (obrigatório) e em clusters (vazio = segmento vale para todos os credores).
--   Chave composta (empresa_id, credor_id) → o credor é sempre da mesma empresa.
-- * Envios: novos tipos 'incremental', 'retirada', 'acordo' e 'baixa' ('base' = carga geral).
--   Envio sem credor: se a empresa tem um credor só, vai para ele; retorno do bureau
--   (enriquecimento) sem credor vale para todos; os demais tipos exigem o credor.
-- * Saídas no Storage passam a ser saidas/<slug>/<data>/<credor>/… (ids/ continua liberado).
-- * Views ganham credor_id.
-- Pode ser rodado de novo sem erro.

create table if not exists public.credores (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    codigo         text not null check (codigo ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
    nome           text not null check (length(trim(nome)) between 1 and 80),
    ativo          boolean not null default true,
    estrategia_id  bigint references public.estrategias (id) on delete set null,
    criado_em      timestamptz not null default now(),
    unique (empresa_id, codigo),
    unique (empresa_id, id)
);
comment on table public.credores is 'Carteiras (credores) de cada empresa; estratégia padrão por credor.';

insert into public.credores (empresa_id, codigo, nome)
    select e.id, 'principal', 'Carteira principal' from public.empresas e
    where not exists (select 1 from public.credores c where c.empresa_id = e.id);

create or replace function public.criar_credor_principal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.credores (empresa_id, codigo, nome) values (new.id, 'principal', 'Carteira principal')
        on conflict do nothing;
    return new;
end $$;
drop trigger if exists criar_credor_principal on public.empresas;
create trigger criar_credor_principal after insert on public.empresas
    for each row execute function public.criar_credor_principal();

create or replace function public.checar_estrategia_credor() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.estrategia_id is not null and not exists (
        select 1 from public.estrategias e where e.id = new.estrategia_id and e.empresa_id = new.empresa_id) then
        raise exception 'a estratégia escolhida é de outra empresa';
    end if;
    return new;
end $$;
drop trigger if exists checar_estrategia_credor on public.credores;
create trigger checar_estrategia_credor before insert or update on public.credores
    for each row execute function public.checar_estrategia_credor();

-- linha gravada sem credor (versão antiga da rotina): vai para o credor único ou o principal
create or replace function public.credor_padrao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.credor_id is null then
        select id into new.credor_id from public.credores
        where empresa_id = new.empresa_id order by (codigo = 'principal') desc, id limit 1;
    end if;
    return new;
end $$;

-- credor_id nas tabelas (dados existentes → credor principal da empresa)
do $$
declare t text;
begin
    foreach t in array array['envios', 'execucoes', 'estado_cliente', 'trilha', 'fila_dia', 'acoes_dia',
                             'personas', 'sugestoes', 'kpis', 'clusters'] loop
        execute format('alter table public.%I add column if not exists credor_id bigint', t);
        if not exists (select 1 from pg_constraint where conname = t || '_credor_fk') then
            execute format('alter table public.%I add constraint %I foreign key (empresa_id, credor_id) '
                           'references public.credores (empresa_id, id) on delete cascade', t, t || '_credor_fk');
        end if;
        if t not in ('clusters', 'envios') then
            execute format('update public.%I x set credor_id = c.id from public.credores c '
                           'where x.credor_id is null and c.empresa_id = x.empresa_id and c.codigo = ''principal''', t);
            execute format('alter table public.%I alter column credor_id set not null', t);
            execute format('drop trigger if exists credor_padrao on public.%I', t);
            execute format('create trigger credor_padrao before insert on public.%I '
                           'for each row execute function public.credor_padrao()', t);
        end if;
    end loop;
end $$;
update public.envios x set credor_id = c.id from public.credores c
    where x.credor_id is null and x.tipo <> 'enriquecimento' and c.empresa_id = x.empresa_id and c.codigo = 'principal';

alter table public.estado_cliente drop constraint if exists estado_cliente_pkey,
    add constraint estado_cliente_pkey primary key (empresa_id, credor_id, id_cliente);
alter table public.fila_dia drop constraint if exists fila_dia_pkey,
    add constraint fila_dia_pkey primary key (empresa_id, credor_id, data, canal, id_cliente, reserva);
alter table public.acoes_dia drop constraint if exists acoes_dia_pkey,
    add constraint acoes_dia_pkey primary key (empresa_id, credor_id, data, canal, regua, cluster, persona);
alter table public.personas drop constraint if exists personas_pkey,
    add constraint personas_pkey primary key (empresa_id, credor_id, persona);
alter table public.kpis drop constraint if exists kpis_pkey,
    add constraint kpis_pkey primary key (empresa_id, credor_id, inicio, fim, safra, cluster);
alter table public.sugestoes drop constraint if exists sugestoes_empresa_id_chave_key;
create unique index if not exists sugestoes_credor_chave on public.sugestoes (empresa_id, credor_id, chave);
alter table public.clusters drop constraint if exists clusters_empresa_id_codigo_key;
create unique index if not exists clusters_credor_codigo
    on public.clusters (empresa_id, coalesce(credor_id, 0), codigo);
create index if not exists execucoes_credor_idx on public.execucoes (empresa_id, credor_id, iniciada_em desc);

-- envios: tipos da carteira e credor obrigatório (com as exceções acima)
alter table public.envios drop constraint if exists envios_tipo_check;
alter table public.envios add constraint envios_tipo_check
    check (tipo in ('base', 'incremental', 'retirada', 'acordo', 'baixa', 'ocorrencia', 'enriquecimento',
                    'clientes', 'contatos', 'parcelas', 'retorno', 'portal'));

create or replace function public.credor_do_envio() returns trigger
language plpgsql security definer set search_path = public as $$
declare unico bigint;
begin
    if new.credor_id is null then
        select min(id) into unico from public.credores where empresa_id = new.empresa_id and ativo
            having count(*) = 1;
        if unico is not null then
            new.credor_id := unico;
        elsif new.tipo <> 'enriquecimento' then
            raise exception 'escolha o credor do arquivo';
        end if;
    elsif not exists (select 1 from public.credores c where c.id = new.credor_id and c.ativo) then
        raise exception 'credor inativo';
    end if;
    return new;
end $$;
drop trigger if exists credor_do_envio on public.envios;
create trigger credor_do_envio before insert on public.envios
    for each row execute function public.credor_do_envio();

drop policy if exists entradas_enviar on storage.objects;
create policy entradas_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'entradas' and public.tem_papel('admin', 'planejamento')
                and public.pode_ver_slug((storage.foldername(name))[1])
                and (storage.foldername(name))[2] in ('base', 'incremental', 'retirada', 'acordo', 'baixa',
                                                      'ocorrencia', 'enriquecimento', 'clientes', 'contatos',
                                                      'parcelas', 'retorno', 'portal'));
drop policy if exists saidas_ler_ids on storage.objects;
create policy saidas_ler_ids on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.meu_papel() is not null
           and public.pode_ver_slug((storage.foldername(name))[1])
           and ((storage.foldername(name))[3] = 'ids' or (storage.foldername(name))[4] = 'ids'));

-- RLS de credores: todos da empresa veem; admin e planejamento criam e editam (não apagam:
-- credor que sai fica inativo, para não perder o histórico)
alter table public.credores enable row level security;
drop policy if exists credores_ver on public.credores;
create policy credores_ver on public.credores for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists credores_criar on public.credores;
create policy credores_criar on public.credores for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists credores_editar on public.credores;
create policy credores_editar on public.credores for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
revoke all on public.credores from anon;

-- views com credor_id
drop view if exists public.resumo_estados;
create view public.resumo_estados with (security_invoker = true) as
    select empresa_id, credor_id, estado, count(*)::int as clientes
    from public.estado_cliente group by 1, 2, 3;

drop view if exists public.resumo_fila;
create view public.resumo_fila with (security_invoker = true) as
    select empresa_id, credor_id, data, canal, reserva, count(*)::int as clientes
    from public.fila_dia group by 1, 2, 3, 4, 5;

drop view if exists public.ultima_execucao;
create view public.ultima_execucao with (security_invoker = true) as
    select distinct on (empresa_id, credor_id) * from public.execucoes
    order by empresa_id, credor_id, iniciada_em desc;

drop view if exists public.mapa_esteira;
create view public.mapa_esteira with (security_invoker = true) as
    select empresa_id,
           credor_id,
           estado,
           case
               when estado = 'LOC' then 'L' || least(coalesce(nullif(substr(ciclo, 2), '')::int, 0), 99)
               when estado = 'NCP' and ciclo = 'RE' then 'RE'
               else coalesce(nullif(ciclo, ''), '-')
           end as etapa,
           canal,
           cluster_atual as cluster,
           to_char(safra, 'YYYY-MM') as safra,
           count(*)::int as clientes,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo
    from public.estado_cliente
    group by 1, 2, 3, 4, 5, 6, 7;

drop view if exists public.acoes_hoje;
create view public.acoes_hoje with (security_invoker = true) as
    select empresa_id, credor_id, data, regua, passo, canal, reserva, count(*)::int as clientes
    from public.fila_dia
    group by 1, 2, 3, 4, 5, 6, 7;

drop view if exists public.fluxo_esteira;
create view public.fluxo_esteira with (security_invoker = true) as
    select empresa_id,
           credor_id,
           data,
           nullif(split_part(tag_anterior, '-', 3), '') as de,
           split_part(tag, '-', 3) as para,
           count(*)::int as clientes
    from public.trilha
    where split_part(tag_anterior, '-', 3) is distinct from split_part(tag, '-', 3)
    group by 1, 2, 3, 4, 5;
