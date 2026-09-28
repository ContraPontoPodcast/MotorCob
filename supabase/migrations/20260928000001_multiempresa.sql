-- MotorCob multiempresa: várias empresas clientes no mesmo site, com dados separados.
--
-- * public.empresas: uma linha por empresa cliente (slug = nome curto, usado nas pastas
--   do Storage e em empresas/<slug>.json no motor).
-- * Todo dado (envios, execuções, estado, trilha, fila, KPIs, acessos) ganha empresa_id.
-- * Usuário de empresa cliente (perfis.empresa_id) só vê a própria empresa.
--   Usuário da equipe MotorCob (perfis.equipe) vê todas e escolhe a empresa no site.
-- * Só admin da equipe cria empresa, muda empresa/equipe de alguém e promove papéis.
-- * Storage: entradas/<slug>/<tipo>/<AAAA-MM-DD>/<arquivo> · saidas/<slug>/<AAAA-MM-DD>/...
--   · saidas/<slug>/comite/<AAAA-MM>/...
-- * Novos tipos de envio: base (base bruta da empresa) e ocorrencia (CPC ou não por tentativa).
-- * ids/<canal>.csv passa a ter id_cliente;contato: o arquivo que a operação baixa tem
--   telefone/e-mail, por isso todo download continua registrado em public.acessos.
--
-- Dados que já existirem ficam na empresa 'legado' (criada só se houver dado).

-- ---------------------------------------------------------------- empresas
create table public.empresas (
    id         bigint generated always as identity primary key,
    slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
    nome       text not null,
    ativa      boolean not null default true,
    criada_em  timestamptz not null default now()
);
comment on table public.empresas is 'Empresa cliente do MotorCob. slug nomeia as pastas no Storage e empresas/<slug>.json no motor.';

alter table public.perfis
    add column empresa_id bigint references public.empresas (id),
    add column equipe boolean not null default false;
comment on column public.perfis.empresa_id is 'Empresa do usuário (cliente). Nulo para a equipe MotorCob.';
comment on column public.perfis.equipe is 'Equipe MotorCob: vê todas as empresas.';

-- quem já é admin é da equipe MotorCob
update public.perfis set equipe = true where papel = 'admin';

-- ---------------------------------------------------------------- funções de acesso
create function public.sou_equipe() returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((select equipe from public.perfis where id = auth.uid() and ativo), false)
$$;

create function public.pode_ver_empresa(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.perfis p
                   where p.id = auth.uid() and p.ativo and (p.equipe or p.empresa_id = eid))
$$;

create function public.pode_ver_slug(s text) returns boolean
language sql stable security definer set search_path = public as $$
    select public.sou_equipe()
        or exists (select 1 from public.empresas e where e.slug = s and public.pode_ver_empresa(e.id))
$$;

create function public.admin_equipe() returns boolean
language sql stable security definer set search_path = public as $$
    select public.sou_equipe() and public.tem_papel('admin')
$$;

-- Ninguém muda o próprio papel; empresa e equipe só o admin da equipe muda.
-- Admin de empresa cliente altera papel/ativo só de quem é da mesma empresa.
create or replace function public.proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then
        return new;  -- banco/rotina (service_role ou SQL Editor)
    end if;
    if (new.empresa_id is distinct from old.empresa_id or new.equipe is distinct from old.equipe)
       and not public.admin_equipe() then
        raise exception 'só admin da equipe MotorCob altera empresa ou equipe';
    end if;
    if (new.papel is distinct from old.papel or new.ativo is distinct from old.ativo)
       and not (public.tem_papel('admin') and (public.sou_equipe() or public.pode_ver_empresa(old.empresa_id))) then
        raise exception 'só admin altera papel ou ativo';
    end if;
    return new;
end $$;

-- ---------------------------------------------------------------- empresa_id nos dados
alter table public.envios         add column empresa_id bigint references public.empresas (id);
alter table public.execucoes      add column empresa_id bigint references public.empresas (id);
alter table public.estado_cliente add column empresa_id bigint references public.empresas (id);
alter table public.trilha         add column empresa_id bigint references public.empresas (id);
alter table public.fila_dia       add column empresa_id bigint references public.empresas (id);
alter table public.kpis           add column empresa_id bigint references public.empresas (id);
alter table public.acessos        add column empresa_id bigint references public.empresas (id);

do $$
declare legado bigint;
begin
    if exists (select 1 from public.envios) or exists (select 1 from public.execucoes)
       or exists (select 1 from public.estado_cliente) or exists (select 1 from public.trilha)
       or exists (select 1 from public.fila_dia) or exists (select 1 from public.kpis)
       or exists (select 1 from public.acessos) then
        insert into public.empresas (slug, nome) values ('legado', 'Dados anteriores à separação por empresa')
            returning id into legado;
        update public.envios         set empresa_id = legado;
        update public.execucoes      set empresa_id = legado;
        update public.estado_cliente set empresa_id = legado;
        update public.trilha         set empresa_id = legado;
        update public.fila_dia       set empresa_id = legado;
        update public.kpis           set empresa_id = legado;
        update public.acessos        set empresa_id = legado;
    end if;
end $$;

alter table public.envios         alter column empresa_id set not null;
alter table public.execucoes      alter column empresa_id set not null;
alter table public.estado_cliente alter column empresa_id set not null;
alter table public.trilha         alter column empresa_id set not null;
alter table public.fila_dia       alter column empresa_id set not null;
alter table public.kpis           alter column empresa_id set not null;
-- acessos.empresa_id fica opcional: acesso a tela geral (equipe) não tem empresa

alter table public.estado_cliente drop constraint estado_cliente_pkey, add primary key (empresa_id, id_cliente);
alter table public.fila_dia drop constraint fila_dia_pkey,
    add primary key (empresa_id, data, canal, id_cliente, reserva);
alter table public.kpis drop constraint kpis_pkey, add primary key (empresa_id, inicio, fim, safra, cluster);

create index on public.envios (empresa_id, status, enviado_em);
create index on public.execucoes (empresa_id, iniciada_em desc);
create index on public.estado_cliente (empresa_id, estado);
drop index if exists public.trilha_id_cliente_data_id_idx;
create index on public.trilha (empresa_id, id_cliente, data, id);

alter table public.envios drop constraint envios_tipo_check, add constraint envios_tipo_check
    check (tipo in ('base', 'ocorrencia', 'clientes', 'contatos', 'parcelas', 'retorno', 'portal'));

-- ---------------------------------------------------------------- visões por empresa
drop view public.resumo_estados;
drop view public.resumo_fila;
drop view public.ultima_execucao;

create view public.resumo_estados with (security_invoker = true) as
    select empresa_id, estado, count(*)::int as clientes
    from public.estado_cliente group by empresa_id, estado;

create view public.resumo_fila with (security_invoker = true) as
    select empresa_id, data, canal, reserva, count(*)::int as clientes
    from public.fila_dia group by empresa_id, data, canal, reserva;

create view public.ultima_execucao with (security_invoker = true) as
    select distinct on (empresa_id) * from public.execucoes order by empresa_id, iniciada_em desc;

-- ---------------------------------------------------------------- RLS
alter table public.empresas enable row level security;

create policy empresas_ver on public.empresas for select to authenticated
    using (public.pode_ver_empresa(id));
create policy empresas_criar on public.empresas for insert to authenticated
    with check (public.admin_equipe());
create policy empresas_editar on public.empresas for update to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());

drop policy perfis_ver_proprio on public.perfis;
drop policy perfis_admin_edita on public.perfis;
create policy perfis_ver on public.perfis for select to authenticated
    using (id = auth.uid() or public.admin_equipe()
           or (public.tem_papel('admin') and empresa_id is not null and public.pode_ver_empresa(empresa_id)));
create policy perfis_admin_edita on public.perfis for update to authenticated
    using (public.admin_equipe()
           or (public.tem_papel('admin') and empresa_id is not null and public.pode_ver_empresa(empresa_id)))
    with check (public.admin_equipe()
           or (public.tem_papel('admin') and empresa_id is not null and public.pode_ver_empresa(empresa_id)));

drop policy ler_execucoes on public.execucoes;
drop policy ler_estado on public.estado_cliente;
drop policy ler_trilha on public.trilha;
drop policy ler_fila on public.fila_dia;
drop policy ler_kpis on public.kpis;
drop policy ler_envios on public.envios;
drop policy criar_envio on public.envios;
drop policy registrar_acesso on public.acessos;
drop policy ler_acessos on public.acessos;

create policy ler_execucoes on public.execucoes for select to authenticated using (public.pode_ver_empresa(empresa_id));
create policy ler_estado on public.estado_cliente for select to authenticated using (public.pode_ver_empresa(empresa_id));
create policy ler_trilha on public.trilha for select to authenticated using (public.pode_ver_empresa(empresa_id));
create policy ler_fila on public.fila_dia for select to authenticated using (public.pode_ver_empresa(empresa_id));
create policy ler_kpis on public.kpis for select to authenticated using (public.pode_ver_empresa(empresa_id));
create policy ler_envios on public.envios for select to authenticated using (public.pode_ver_empresa(empresa_id));

-- envio: planejamento/admin, só na própria empresa, com o arquivo na pasta da empresa
create policy criar_envio on public.envios for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id)
                and enviado_por = auth.uid() and status = 'pendente'
                and split_part(caminho, '/', 1) = (select e.slug from public.empresas e
                                                   where e.id = empresa_id and e.ativa)
                and split_part(caminho, '/', 2) = tipo);

create policy registrar_acesso on public.acessos for insert to authenticated
    with check (public.meu_papel() is not null and usuario = auth.uid()
                and (empresa_id is null or public.pode_ver_empresa(empresa_id)));
create policy ler_acessos on public.acessos for select to authenticated
    using (public.tem_papel('admin', 'gestao')
           and (public.sou_equipe() or (empresa_id is not null and public.pode_ver_empresa(empresa_id))));

revoke all on public.empresas from anon;
revoke execute on function public.sou_equipe(), public.pode_ver_empresa(bigint), public.pode_ver_slug(text),
    public.admin_equipe() from anon;

-- ---------------------------------------------------------------- Storage por empresa
drop policy entradas_enviar on storage.objects;
drop policy entradas_ler on storage.objects;
drop policy saidas_ler_ids on storage.objects;
drop policy saidas_ler_comite on storage.objects;
drop policy saidas_ler_tudo on storage.objects;

create policy entradas_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'entradas' and public.tem_papel('admin', 'planejamento')
                and public.pode_ver_slug((storage.foldername(name))[1])
                and (storage.foldername(name))[2] in ('base', 'ocorrencia', 'clientes', 'contatos', 'parcelas',
                                                      'retorno', 'portal'));
create policy entradas_ler on storage.objects for select to authenticated
    using (bucket_id = 'entradas' and public.tem_papel('admin', 'planejamento')
           and public.pode_ver_slug((storage.foldername(name))[1]));

-- ID + contato por canal: qualquer usuário ativo da empresa. Comitê: gestão também.
-- Demais saídas (fila_do_dia.csv com o detalhe): só admin e planejamento.
create policy saidas_ler_ids on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.meu_papel() is not null
           and public.pode_ver_slug((storage.foldername(name))[1]) and (storage.foldername(name))[3] = 'ids');
create policy saidas_ler_comite on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.tem_papel('gestao')
           and public.pode_ver_slug((storage.foldername(name))[1]) and (storage.foldername(name))[2] = 'comite');
create policy saidas_ler_tudo on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.tem_papel('admin', 'planejamento')
           and public.pode_ver_slug((storage.foldername(name))[1]));
