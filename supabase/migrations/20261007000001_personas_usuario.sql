-- Personas criadas pela empresa: o perfil do devedor (público), por carteira.
-- Cada persona tem nome e características (condições sobre as colunas da carga e as calculadas:
-- saldo, dias_atraso, qtd_contratos, ddd, tem_whatsapp, tem_rcs). Em ordem: o cliente fica na
-- primeira que bate. Na orquestração, uma ação da esteira pode ir só para algumas personas
-- (estrategias.definicao: {"canal": ..., "personas": [ids]}). O nome da persona do cliente vai
-- para estado_cliente.persona_usuario e para a coluna "persona" usada nos segmentos.
-- Pode ser rodado de novo sem erro.

create table if not exists public.personas_usuario (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint not null,
    nome            text not null check (length(trim(nome)) between 1 and 60),
    descricao       text not null default '',
    ordem           int not null default 100,
    condicoes       jsonb not null default '[]' check (jsonb_typeof(condicoes) = 'array'),
    cor             text,
    ativo           boolean not null default true,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade,
    unique (credor_id, nome)
);
create index if not exists personas_usuario_credor on public.personas_usuario (empresa_id, credor_id, ordem);

drop trigger if exists carimbar_persona_usuario on public.personas_usuario;
create trigger carimbar_persona_usuario before insert or update on public.personas_usuario
    for each row execute function public.carimbar_cluster();

alter table public.personas_usuario enable row level security;
drop policy if exists personas_usuario_ver on public.personas_usuario;
create policy personas_usuario_ver on public.personas_usuario for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists personas_usuario_criar on public.personas_usuario;
create policy personas_usuario_criar on public.personas_usuario for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists personas_usuario_editar on public.personas_usuario;
create policy personas_usuario_editar on public.personas_usuario for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists personas_usuario_apagar on public.personas_usuario;
create policy personas_usuario_apagar on public.personas_usuario for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
revoke all on public.personas_usuario from anon;

alter table public.estado_cliente add column if not exists persona_usuario text;

drop view if exists public.enquadramento;
create view public.enquadramento with (security_invoker = true) as
    select empresa_id,
           credor_id,
           cluster_atual as cluster,
           coalesce(estrategia, '') as estrategia,
           coalesce(persona_usuario, '') as persona_usuario,
           estado,
           coalesce(na_carga, true) as na_carga,
           count(*)::int as clientes,
           count(*) filter (where coalesce(acao_hoje, '') <> '')::int as com_acao_hoje,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo
    from public.estado_cliente
    group by 1, 2, 3, 4, 5, 6, 7;
