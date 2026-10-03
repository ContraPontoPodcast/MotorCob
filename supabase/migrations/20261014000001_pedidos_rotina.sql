-- "Reenquadrar agora": o site registra o pedido e a vigia do Mac (plantão, a cada 5 s) roda a
-- rotina da carteira na hora, reenquadra os clientes com a orquestração atual e refaz a lista do
-- dia. O site acompanha pelo status: pendente → rodando → ok | erro.
-- Pode ser rodado de novo sem erro.

create table if not exists public.pedidos_rotina (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint,
    motivo        text not null default 'reenquadrar' check (motivo in ('reenquadrar')),
    status        text not null default 'pendente' check (status in ('pendente', 'rodando', 'ok', 'erro')),
    pedido_em     timestamptz not null default now(),
    pedido_por    uuid default auth.uid() references auth.users (id),
    iniciado_em   timestamptz,
    terminado_em  timestamptz,
    execucao_id   bigint,
    erro          text,
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
-- um pedido por carteira na fila de cada vez
create unique index if not exists pedidos_rotina_um_na_fila
    on public.pedidos_rotina (empresa_id, coalesce(credor_id, 0)) where status in ('pendente', 'rodando');
create index if not exists pedidos_rotina_credor on public.pedidos_rotina (empresa_id, credor_id, id desc);

drop trigger if exists a_empresa_do_credor on public.pedidos_rotina;
create trigger a_empresa_do_credor before insert on public.pedidos_rotina
    for each row execute function public.empresa_do_credor();

alter table public.pedidos_rotina enable row level security;
drop policy if exists pedidos_rotina_ver on public.pedidos_rotina;
create policy pedidos_rotina_ver on public.pedidos_rotina for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists pedidos_rotina_criar on public.pedidos_rotina;
create policy pedidos_rotina_criar on public.pedidos_rotina for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id)
                and status = 'pendente' and iniciado_em is null and terminado_em is null
                and execucao_id is null and erro is null);
-- status, início e fim só a rotina (service_role) grava
revoke all on public.pedidos_rotina from anon;
revoke update, delete on public.pedidos_rotina from authenticated;
