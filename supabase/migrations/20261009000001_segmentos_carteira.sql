-- Segmento × carteira: quais carteiras usam cada segmento e se está em uso em cada uma.
--
-- * segmentos_carteira (cluster_id, credor_id, ativo): o segmento vale nas carteiras listadas,
--   e só onde ativo = true. Segmento SEM nenhuma linha aqui segue a regra antiga:
--   clusters.credor_id preenchido = só aquela carteira; vazio = todas as carteiras.
-- * clusters.ativo continua sendo o liga/desliga geral (desligado = não vale em nenhuma).
-- * O que já existia é copiado: segmento de uma carteira vira uma linha com o ativo dele.
-- Pode ser rodado de novo sem erro.

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'clusters_empresa_id_id_key') then
        alter table public.clusters add constraint clusters_empresa_id_id_key unique (empresa_id, id);
    end if;
end $$;

create table if not exists public.segmentos_carteira (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    cluster_id      bigint not null,
    credor_id       bigint not null,
    ativo           boolean not null default true,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (cluster_id, credor_id),
    foreign key (empresa_id, cluster_id) references public.clusters (empresa_id, id) on delete cascade,
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
create index if not exists segmentos_carteira_credor on public.segmentos_carteira (empresa_id, credor_id);

insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo)
    select c.empresa_id, c.id, c.credor_id, c.ativo from public.clusters c
    where c.credor_id is not null
on conflict (cluster_id, credor_id) do nothing;

drop trigger if exists carimbar_segmento_carteira on public.segmentos_carteira;
create trigger carimbar_segmento_carteira before insert or update on public.segmentos_carteira
    for each row execute function public.carimbar_cluster();

alter table public.segmentos_carteira enable row level security;
drop policy if exists segmentos_carteira_ver on public.segmentos_carteira;
create policy segmentos_carteira_ver on public.segmentos_carteira for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists segmentos_carteira_criar on public.segmentos_carteira;
create policy segmentos_carteira_criar on public.segmentos_carteira for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists segmentos_carteira_editar on public.segmentos_carteira;
create policy segmentos_carteira_editar on public.segmentos_carteira for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists segmentos_carteira_apagar on public.segmentos_carteira;
create policy segmentos_carteira_apagar on public.segmentos_carteira for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
revoke all on public.segmentos_carteira from anon;

-- visão pronta para o site: cada segmento × cada carteira da empresa, com "em uso" já resolvido
drop view if exists public.segmentos_em_uso;
create view public.segmentos_em_uso with (security_invoker = true) as
    select c.empresa_id,
           cr.id as credor_id,
           c.id as cluster_id,
           c.codigo,
           c.nome,
           c.ordem,
           c.estrategia_id,
           case when exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id)
                then 'escolhidas'
                when c.credor_id is not null then 'uma'
                else 'todas' end as vinculo,
           (c.ativo and case
                when exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id)
                    then coalesce((select x.ativo from public.segmentos_carteira x
                                   where x.cluster_id = c.id and x.credor_id = cr.id), false)
                else c.credor_id is null or c.credor_id = cr.id end) as em_uso,
           (exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id and x.credor_id = cr.id)
            or (not exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id)
                and (c.credor_id is null or c.credor_id = cr.id))) as vinculado
    from public.clusters c
    join public.credores cr on cr.empresa_id = c.empresa_id;
comment on view public.segmentos_em_uso is 'Cada segmento × carteira: se está vinculado e se está em uso (ativo).';
