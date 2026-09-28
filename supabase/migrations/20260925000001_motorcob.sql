-- MotorCob no Supabase: o que o site (motorcob.online) lê e o que a rotina do motor grava.
--
-- Princípios
-- * O site só LÊ resultados e ENVIA arquivos. Quem processa é a rotina do motor
--   (Python), que usa a chave service_role e por isso passa por cima do RLS.
-- * Nenhuma tabela deste schema guarda telefone, e-mail ou CPF de devedor: o site
--   trabalha só com id_cliente. Os arquivos com contato ficam no Storage, com acesso
--   restrito. (perfis.email é o e-mail do usuário do site, não de devedor.)
-- * Sem cadastro público: usuários entram por convite (Auth > Invite) e o admin
--   define o papel em public.perfis.

-- ---------------------------------------------------------------- perfis
create type public.papel as enum ('admin', 'planejamento', 'operacao', 'gestao');

create table public.perfis (
    id         uuid primary key references auth.users (id) on delete cascade,
    nome       text,
    email      text,
    papel      public.papel not null default 'operacao',
    ativo      boolean not null default true,
    criado_em  timestamptz not null default now()
);
comment on table public.perfis is 'Usuário do site e seu papel: admin, planejamento, operacao, gestao.';

-- Papel do usuário logado (null se sem perfil ou inativo). security definer para
-- poder ser usada dentro das políticas sem recursão de RLS.
create function public.meu_papel() returns public.papel
language sql stable security definer set search_path = public as $$
    select papel from public.perfis where id = auth.uid() and ativo
$$;

create function public.tem_papel(variadic papeis public.papel[]) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce(public.meu_papel() = any (papeis), false)
$$;

-- Todo usuário convidado ganha um perfil (papel operacao) automaticamente.
create function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.perfis (id, email, nome)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)))
    on conflict (id) do nothing;
    return new;
end $$;

create trigger ao_criar_usuario after insert on auth.users
    for each row execute function public.criar_perfil();

-- Ninguém muda o próprio papel; só admin altera papel/ativo de alguém.
create function public.proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if (new.papel is distinct from old.papel or new.ativo is distinct from old.ativo)
       and auth.uid() is not null and not public.tem_papel('admin') then
        raise exception 'só admin altera papel ou ativo';
    end if;
    return new;
end $$;

create trigger proteger_perfil before update on public.perfis
    for each row execute function public.proteger_perfil();

-- ---------------------------------------------------------------- envios (uploads)
create table public.envios (
    id             bigint generated always as identity primary key,
    tipo           text not null check (tipo in ('clientes', 'contatos', 'parcelas', 'retorno', 'portal')),
    caminho        text not null unique,          -- caminho no bucket 'entradas'
    nome_original  text not null,
    enviado_por    uuid not null default auth.uid() references auth.users (id),
    enviado_em     timestamptz not null default now(),
    status         text not null default 'pendente' check (status in ('pendente', 'processado', 'erro')),
    relatorio      jsonb                          -- preenchido pela rotina: linhas, aceitas, rejeitadas…
);
create index on public.envios (enviado_em desc);

-- ---------------------------------------------------------------- execuções da rotina
create table public.execucoes (
    id            bigint generated always as identity primary key,
    data_ref      date not null,
    iniciada_em   timestamptz not null default now(),
    terminada_em  timestamptz,
    status        text not null default 'rodando' check (status in ('rodando', 'ok', 'erro')),
    resumo        jsonb,                          -- contagens, quarentena, arquivos sem layout
    alertas       text[] not null default '{}',
    erro          text
);
create index on public.execucoes (data_ref desc, iniciada_em desc);

-- ---------------------------------------------------------------- TAG e trilha
create table public.estado_cliente (
    id_cliente      text primary key,
    tag             text not null,
    safra           date not null,
    cluster_origem  text not null,
    cluster_atual   text not null,
    estado          text not null check (estado in ('LOC','CPA','CPB','NCP','PRE','QBR','COL','LIQ','BLQ')),
    canal           text not null,
    ciclo           text not null default '',
    reenriquecer    text,
    atualizado_em   timestamptz not null default now()
);
create index on public.estado_cliente (estado);

create table public.trilha (
    id            bigint generated always as identity primary key,
    id_cliente    text not null,
    data          date not null,
    tag_anterior  text not null default '',
    tag           text not null,
    motivo        text not null,
    quem_marcou   text not null
);
create index on public.trilha (id_cliente, data, id);

-- ---------------------------------------------------------------- fila do dia (só IDs)
create table public.fila_dia (
    data        date not null,
    canal       text not null check (canal in ('whatsapp','rcs','agente_voz','discador','sms','email')),
    id_cliente  text not null,
    reserva     boolean not null default false,   -- só se o canal principal do dia não contatar
    regua       text not null,
    passo       text not null,
    tag         text not null,
    primary key (data, canal, id_cliente, reserva)
);

-- ---------------------------------------------------------------- KPIs do comitê
create table public.kpis (
    inicio      date not null,
    fim         date not null,
    safra       text not null,                    -- AAAA-MM ou TOTAL
    cluster     text not null default '',
    dados       jsonb not null,                   -- linha de motor/kpis.py
    gerado_em   timestamptz not null default now(),
    primary key (inicio, fim, safra, cluster)
);

-- ---------------------------------------------------------------- auditoria de acesso (LGPD)
create table public.acessos (
    id          bigint generated always as identity primary key,
    usuario     uuid not null default auth.uid() references auth.users (id),
    acao        text not null check (acao in ('download', 'consulta_cliente', 'envio')),
    alvo        text not null,                    -- caminho do arquivo ou id_cliente
    em          timestamptz not null default now()
);
create index on public.acessos (em desc);

-- ---------------------------------------------------------------- visões para o site
create view public.resumo_estados with (security_invoker = true) as
    select estado, count(*)::int as clientes from public.estado_cliente group by estado;

create view public.resumo_fila with (security_invoker = true) as
    select data, canal, reserva, count(*)::int as clientes
    from public.fila_dia group by data, canal, reserva;

create view public.ultima_execucao with (security_invoker = true) as
    select * from public.execucoes order by iniciada_em desc limit 1;

-- ---------------------------------------------------------------- RLS
alter table public.perfis         enable row level security;
alter table public.envios         enable row level security;
alter table public.execucoes      enable row level security;
alter table public.estado_cliente enable row level security;
alter table public.trilha         enable row level security;
alter table public.fila_dia       enable row level security;
alter table public.kpis           enable row level security;
alter table public.acessos        enable row level security;

-- perfis: cada um vê o seu; admin vê e edita todos
create policy perfis_ver_proprio on public.perfis for select to authenticated
    using (id = auth.uid() or public.tem_papel('admin'));
create policy perfis_admin_edita on public.perfis for update to authenticated
    using (public.tem_papel('admin')) with check (public.tem_papel('admin'));

-- leitura dos resultados: qualquer usuário ativo
create policy ler_execucoes on public.execucoes for select to authenticated
    using (public.meu_papel() is not null);
create policy ler_estado on public.estado_cliente for select to authenticated
    using (public.meu_papel() is not null);
create policy ler_trilha on public.trilha for select to authenticated
    using (public.meu_papel() is not null);
create policy ler_fila on public.fila_dia for select to authenticated
    using (public.meu_papel() is not null);
create policy ler_kpis on public.kpis for select to authenticated
    using (public.meu_papel() is not null);

-- envios: planejamento/admin enviam; todos os ativos veem a lista
create policy ler_envios on public.envios for select to authenticated
    using (public.meu_papel() is not null);
create policy criar_envio on public.envios for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and enviado_por = auth.uid() and status = 'pendente');

-- acessos: cada um registra os próprios; admin e gestão leem
create policy registrar_acesso on public.acessos for insert to authenticated
    with check (public.meu_papel() is not null and usuario = auth.uid());
create policy ler_acessos on public.acessos for select to authenticated
    using (public.tem_papel('admin', 'gestao'));

-- o papel anon (não logado) não vê nada
revoke all on all tables in schema public from anon;
revoke execute on function public.meu_papel(), public.tem_papel(public.papel[]) from anon;

-- ---------------------------------------------------------------- Storage
-- entradas/<tipo>/<AAAA-MM-DD>/<arquivo>   arquivos enviados pelo site
-- saidas/<AAAA-MM-DD>/ids/<canal>.csv      IDs por canal (o que a operação baixa)
-- saidas/<AAAA-MM-DD>/...                  fila_do_dia.csv (tem contato), enriquecimento, alertas
-- saidas/comite/<AAAA-MM>/...xlsx          relatório do comitê
insert into storage.buckets (id, name, public) values ('entradas', 'entradas', false), ('saidas', 'saidas', false)
    on conflict (id) do nothing;

create policy entradas_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'entradas' and public.tem_papel('admin', 'planejamento')
                and (storage.foldername(name))[1] in ('clientes', 'contatos', 'parcelas', 'retorno', 'portal'));
create policy entradas_ler on storage.objects for select to authenticated
    using (bucket_id = 'entradas' and public.tem_papel('admin', 'planejamento'));

-- IDs por canal: qualquer usuário ativo. Relatório do comitê: gestão também.
-- Demais saídas (fila_do_dia.csv tem telefone/e-mail): só admin e planejamento.
create policy saidas_ler_ids on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.meu_papel() is not null and (storage.foldername(name))[2] = 'ids');
create policy saidas_ler_comite on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.tem_papel('gestao') and (storage.foldername(name))[1] = 'comite');
create policy saidas_ler_tudo on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.tem_papel('admin', 'planejamento'));
