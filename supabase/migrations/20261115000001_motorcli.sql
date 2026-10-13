-- MotorCX com duas frentes: MotorCob (Cobrança) e MotorCli (Jornada do Cliente).
-- A plataforma é uma só; a frente decide o nome, as cores e os textos do Workspace e qual motor roda em cada
-- carteira. Arquitetura igual: a carteira continua sendo a linha de "credores" (no MotorCli a tela chama de
-- Carteira), com a sua pasta, cargas, Lista do dia (fila_dia), ações (acoes_dia) e Mensageria.
-- * empresa_frentes: as frentes que a empresa contratou. Toda empresa que já existe fica com o MotorCob.
-- * usuario_frentes: limita um usuário a uma frente (sem linha = todas as frentes da empresa).
-- * perfis.frente_preferida: a escolha do login ("lembrar a minha escolha"), gravada por escolher_frente().
-- * credores.frente e estrategias.frente: cada carteira roda o motor da sua frente com uma estratégia da mesma
--   frente; a estratégia padrão passa a ser uma por frente.
-- * jornada_cliente: onde cada cliente do MotorCli se enquadrou hoje (momento, passo e motivo), só com o ID.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- frentes da empresa
create table if not exists public.empresa_frentes (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    frente      text not null check (frente in ('motorcob', 'motorcli')),
    ativo       boolean not null default true,
    desde       date not null default current_date,
    primary key (empresa_id, frente)
);
comment on table public.empresa_frentes is 'Frentes do MotorCX contratadas: motorcob (Cobrança), motorcli (Jornada do Cliente).';
alter table public.empresa_frentes enable row level security;
drop policy if exists empresa_frentes_ver on public.empresa_frentes;
create policy empresa_frentes_ver on public.empresa_frentes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists empresa_frentes_gravar on public.empresa_frentes;
create policy empresa_frentes_gravar on public.empresa_frentes for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.empresa_frentes from anon;

insert into public.empresa_frentes (empresa_id, frente)
select id, 'motorcob' from public.empresas on conflict do nothing;
create or replace function public.frente_inicial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.empresa_frentes (empresa_id, frente) values (new.id, 'motorcob') on conflict do nothing;
    return new;
end $$;
drop trigger if exists frente_inicial on public.empresas;
create trigger frente_inicial after insert on public.empresas
    for each row execute function public.frente_inicial();

-- ---------------------------------------------------------------- frentes do usuário
create table if not exists public.usuario_frentes (
    usuario_id  uuid not null references public.perfis (id) on delete cascade,
    frente      text not null check (frente in ('motorcob', 'motorcli')),
    primary key (usuario_id, frente)
);
comment on table public.usuario_frentes is 'Sem linha: o usuário vê todas as frentes da empresa. Com linhas: só estas.';
alter table public.usuario_frentes enable row level security;
drop policy if exists usuario_frentes_ver on public.usuario_frentes;
create policy usuario_frentes_ver on public.usuario_frentes for select to authenticated
    using (usuario_id = auth.uid() or public.admin_equipe() or (public.pode('gerenciar_usuarios') and exists (
        select 1 from public.perfis p where p.id = usuario_id and p.empresa_id in (select public.minhas_empresas()))));
drop policy if exists usuario_frentes_gravar on public.usuario_frentes;
create policy usuario_frentes_gravar on public.usuario_frentes for all to authenticated
    using (public.admin_equipe() or (public.pode('gerenciar_usuarios') and exists (
        select 1 from public.perfis p where p.id = usuario_id and p.empresa_id in (select public.minhas_empresas()))))
    with check (public.admin_equipe() or (public.pode('gerenciar_usuarios') and exists (
        select 1 from public.perfis p where p.id = usuario_id and p.empresa_id in (select public.minhas_empresas()))));
revoke all on public.usuario_frentes from anon;

alter table public.perfis add column if not exists frente_preferida text
    check (frente_preferida is null or frente_preferida in ('motorcob', 'motorcli'));
comment on column public.perfis.frente_preferida is 'Frente escolhida no login com "lembrar". Gravada por escolher_frente().';

-- frentes que o usuário logado pode abrir (equipe MotorCX: as duas)
create or replace function public.minhas_frentes() returns setof text
language sql stable security definer set search_path = public as $$
    select f from unnest(array['motorcob', 'motorcli']) f where public.sou_equipe()
    union
    select distinct ef.frente from public.empresa_frentes ef
     where ef.ativo and ef.empresa_id in (select public.minhas_empresas())
       and (not exists (select 1 from public.usuario_frentes uf where uf.usuario_id = auth.uid())
            or ef.frente in (select uf.frente from public.usuario_frentes uf where uf.usuario_id = auth.uid()))
$$;
revoke all on function public.minhas_frentes() from public, anon;
grant execute on function public.minhas_frentes() to authenticated;

create or replace function public.escolher_frente(p_frente text, p_lembrar boolean default true) returns text
language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then
        raise exception 'sem sessão';
    end if;
    if p_frente is null or p_frente not in (select public.minhas_frentes()) then
        raise exception 'frente não liberada para este usuário';
    end if;
    update public.perfis set frente_preferida = case when p_lembrar then p_frente end where id = auth.uid() and ativo;
    return p_frente;
end $$;
revoke all on function public.escolher_frente(text, boolean) from public, anon;
grant execute on function public.escolher_frente(text, boolean) to authenticated;

-- ---------------------------------------------------------------- carteira e estratégia por frente
alter table public.credores add column if not exists frente text not null default 'motorcob'
    check (frente in ('motorcob', 'motorcli'));
comment on column public.credores.frente is 'Motor desta carteira: motorcob (régua de cobrança) ou motorcli (jornada).';
alter table public.estrategias add column if not exists frente text not null default 'motorcob'
    check (frente in ('motorcob', 'motorcli'));
comment on column public.estrategias.frente is
    'motorcob: régua de cobrança (motor/estrategia.py). motorcli: momentos da jornada (motor/jornada.py).';
drop index if exists public.estrategias_uma_padrao;
create unique index if not exists estrategias_uma_padrao_frente on public.estrategias (empresa_id, frente) where padrao;

create or replace function public.conferir_frente_credor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    -- empresa recém-criada: o credor "principal" nasce antes da linha de frentes; sem linha = MotorCob
    if not exists (select 1 from public.empresa_frentes
                   where empresa_id = new.empresa_id and frente = new.frente and ativo)
       and not (new.frente = 'motorcob'
                and not exists (select 1 from public.empresa_frentes where empresa_id = new.empresa_id)) then
        raise exception 'a empresa não tem a frente % ativa', new.frente;
    end if;
    if new.estrategia_id is not null and not exists (
        select 1 from public.estrategias e where e.id = new.estrategia_id and e.empresa_id = new.empresa_id
          and e.frente = new.frente) then
        raise exception 'a estratégia da carteira precisa ser da mesma empresa e da mesma frente';
    end if;
    return new;
end $$;
drop trigger if exists conferir_frente_credor on public.credores;
create trigger conferir_frente_credor before insert or update of frente, estrategia_id, empresa_id on public.credores
    for each row execute function public.conferir_frente_credor();

-- ---------------------------------------------------------------- MotorCli: enquadramento do dia
create table if not exists public.jornada_cliente (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    credor_id      bigint not null,
    id_cliente     text not null check (length(id_cliente) between 1 and 60),
    data           date not null,
    momento        text not null default '' check (momento in ('', 'boas_vindas', 'ativacao', 'pre_vencimento',
                                                               'retencao', 'reativacao')),
    passo          text not null default '' check (length(passo) <= 10),
    motivo         text not null check (length(motivo) <= 120),
    atualizado_em  timestamptz not null default now(),
    primary key (empresa_id, credor_id, id_cliente),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
comment on table public.jornada_cliente is 'MotorCli: momento, passo e motivo de hoje de cada cliente (só o ID).';
create index if not exists jornada_cliente_momento on public.jornada_cliente (empresa_id, credor_id, momento);
alter table public.jornada_cliente enable row level security;
drop policy if exists jornada_cliente_ver on public.jornada_cliente;
create policy jornada_cliente_ver on public.jornada_cliente for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.jornada_cliente from anon;
revoke insert, update, delete on public.jornada_cliente from authenticated;

create or replace view public.jornada_resumo with (security_invoker = true) as
    select empresa_id, credor_id, data, momento, motivo, count(*)::int as clientes
      from public.jornada_cliente group by empresa_id, credor_id, data, momento, motivo;
comment on view public.jornada_resumo is 'MotorCli: clientes por momento e motivo no último dia rodado.';
