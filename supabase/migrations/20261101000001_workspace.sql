-- Workspace (fase 1): cadastro da empresa contratante, contatos, módulos contratados, dados e foto do
-- usuário, suporte por chamado (protocolo, conversa, nota interna, anexos) e a forma de entrada da carga
-- de cada credor (arquivo ou API). Faturamento e mensageria vêm nas próximas fases.
-- Quem pode o quê:
-- * cadastro da empresa e módulos: só o admin da equipe MotorCob altera; os membros da empresa leem;
-- * contatos da empresa: quem gerencia usuários na empresa (e a equipe) lê e altera;
-- * chamados: quem é da empresa abre e conversa; nota interna só a equipe vê; só a equipe muda a
--   situação e o responsável (o cliente resolve pela função resolver_chamado);
-- * dados do próprio perfil (nome, sobrenome, telefone, setor, foto): pela função atualizar_meu_perfil.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- empresa: cadastro
create or replace function public.cnpj_valido(c text) returns boolean
language plpgsql immutable as $$
declare
    d int[]; s int; r int; i int;
    p1 constant int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
    p2 constant int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
    if c is null or c !~ '^\d{14}$' or c ~ '^(\d)\1{13}$' then
        return false;
    end if;
    d := array(select substr(c, g, 1)::int from generate_series(1, 14) g);
    s := 0; for i in 1..12 loop s := s + d[i] * p1[i]; end loop;
    r := s % 11; if (case when r < 2 then 0 else 11 - r end) <> d[13] then return false; end if;
    s := 0; for i in 1..13 loop s := s + d[i] * p2[i]; end loop;
    r := s % 11; return (case when r < 2 then 0 else 11 - r end) = d[14];
end $$;

alter table public.empresas
    add column if not exists razao_social        text check (razao_social is null or length(trim(razao_social)) between 2 and 160),
    add column if not exists cnpj                text unique check (cnpj is null or public.cnpj_valido(cnpj)),
    add column if not exists inscricao_estadual  text check (inscricao_estadual is null or length(inscricao_estadual) <= 20),
    add column if not exists inscricao_municipal text check (inscricao_municipal is null or length(inscricao_municipal) <= 20),
    add column if not exists segmento            text check (segmento is null or segmento in ('assessoria', 'banco', 'financeira',
                                                   'fintech', 'varejo', 'securitizadora', 'utilities_telecom', 'educacao', 'outro')),
    add column if not exists cep                 text check (cep is null or cep ~ '^\d{8}$'),
    add column if not exists logradouro          text,
    add column if not exists numero              text,
    add column if not exists complemento         text,
    add column if not exists bairro              text,
    add column if not exists municipio           text,
    add column if not exists uf                  text check (uf is null or uf ~ '^[A-Z]{2}$'),
    add column if not exists vendedor_id         uuid references public.perfis (id) on delete set null,
    add column if not exists gerente_id          uuid references public.perfis (id) on delete set null,
    add column if not exists situacao            text not null default 'ativa'
                                                   check (situacao in ('implantacao', 'ativa', 'suspensa', 'encerrada')),
    add column if not exists cliente_desde       date;
comment on column public.empresas.cnpj is 'Só os 14 dígitos (o site formata). Validado pelos dígitos verificadores.';
comment on column public.empresas.situacao is 'implantacao, ativa, suspensa (por atraso, pela equipe) ou encerrada.';

-- ---------------------------------------------------------------- contatos da empresa
create table if not exists public.empresa_contatos (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    nome            text not null check (length(trim(nome)) between 1 and 80),
    sobrenome       text check (sobrenome is null or length(sobrenome) <= 80),
    setor           text check (setor is null or length(setor) <= 60),
    papel_contrato  text not null default 'operacional'
                    check (papel_contrato in ('operacional', 'financeiro', 'legal', 'tecnico')),
    telefone        text check (telefone is null or telefone ~ '^[0-9 ()+-]{8,20}$'),
    email           text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
    observacao      text check (observacao is null or length(observacao) <= 1000),
    criado_em       timestamptz not null default now(),
    atualizado_em   timestamptz not null default now()
);
create index if not exists empresa_contatos_empresa on public.empresa_contatos (empresa_id);
alter table public.empresa_contatos enable row level security;
drop policy if exists empresa_contatos_ver on public.empresa_contatos;
create policy empresa_contatos_ver on public.empresa_contatos for select to authenticated
    using (public.admin_equipe() or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas())));
drop policy if exists empresa_contatos_gravar on public.empresa_contatos;
create policy empresa_contatos_gravar on public.empresa_contatos for all to authenticated
    using (public.admin_equipe() or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas())))
    with check (public.admin_equipe() or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas())));
revoke all on public.empresa_contatos from anon;

-- ---------------------------------------------------------------- módulos contratados
create table if not exists public.empresa_modulos (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    modulo      text not null check (modulo in ('orquestracao', 'mensageria', 'enriquecimento', 'api')),
    ativo       boolean not null default true,
    canais      text[] not null default '{}'
                check (canais <@ array['sms', 'email', 'rcs', 'whatsapp']::text[]),
    desde       date not null default current_date,
    primary key (empresa_id, modulo)
);
comment on column public.empresa_modulos.canais is 'Mensageria: canais liberados (sms, email, rcs, whatsapp).';
alter table public.empresa_modulos enable row level security;
drop policy if exists empresa_modulos_ver on public.empresa_modulos;
create policy empresa_modulos_ver on public.empresa_modulos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists empresa_modulos_gravar on public.empresa_modulos;
create policy empresa_modulos_gravar on public.empresa_modulos for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.empresa_modulos from anon;
-- toda empresa tem a Orquestração: as que já existem e as que forem criadas
insert into public.empresa_modulos (empresa_id, modulo)
select id, 'orquestracao' from public.empresas on conflict do nothing;
create or replace function public.modulo_inicial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.empresa_modulos (empresa_id, modulo) values (new.id, 'orquestracao') on conflict do nothing;
    return new;
end $$;
drop trigger if exists modulo_inicial on public.empresas;
create trigger modulo_inicial after insert on public.empresas
    for each row execute function public.modulo_inicial();

-- ---------------------------------------------------------------- dados e foto do usuário
alter table public.perfis
    add column if not exists sobrenome text check (sobrenome is null or length(sobrenome) <= 80),
    add column if not exists telefone  text check (telefone is null or telefone ~ '^[0-9 ()+-]{8,20}$'),
    add column if not exists setor     text check (setor is null or length(setor) <= 60),
    add column if not exists foto      text check (foto is null or foto ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
comment on column public.perfis.foto is 'Caminho no bucket privado "fotos": <id do usuário>/<arquivo>.';

create or replace function public.atualizar_meu_perfil(p_nome text, p_sobrenome text, p_telefone text,
                                                       p_setor text, p_foto text)
returns void language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then
        raise exception 'sem sessão';
    end if;
    if p_foto is not null and split_part(p_foto, '/', 1) <> auth.uid()::text then
        raise exception 'a foto precisa estar na sua pasta';
    end if;
    update public.perfis
       set nome = coalesce(nullif(trim(p_nome), ''), nome), sobrenome = nullif(trim(p_sobrenome), ''),
           telefone = nullif(trim(p_telefone), ''), setor = nullif(trim(p_setor), ''), foto = p_foto
     where id = auth.uid() and ativo;
end $$;
revoke all on function public.atualizar_meu_perfil(text, text, text, text, text) from public, anon;
grant execute on function public.atualizar_meu_perfil(text, text, text, text, text) to authenticated;

insert into storage.buckets (id, name, public) values ('fotos', 'fotos', false), ('chamados', 'chamados', false)
    on conflict (id) do update set public = false;
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
        execute $u$update storage.buckets set file_size_limit = 2097152,
                   allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'fotos'$u$;
        execute $u$update storage.buckets set file_size_limit = 10485760,
                   allowed_mime_types = array['text/csv', 'text/plain', 'application/pdf', 'image/jpeg', 'image/png',
                     'application/zip', 'application/vnd.ms-excel',
                     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id = 'chamados'$u$;
    end if;
end $$;

drop policy if exists fotos_gravar on storage.objects;
create policy fotos_gravar on storage.objects for insert to authenticated
    with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists fotos_ler on storage.objects;
create policy fotos_ler on storage.objects for select to authenticated
    using (bucket_id = 'fotos' and exists (
        select 1 from public.perfis p where p.id::text = (storage.foldername(name))[1]
          and (p.id = auth.uid() or public.sou_equipe() or p.empresa_id in (select public.minhas_empresas()))));

-- ---------------------------------------------------------------- suporte: chamados
create table if not exists public.chamados (
    id            bigint generated always as identity primary key,
    protocolo     text unique,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    aberto_por    uuid references public.perfis (id) on delete set null default auth.uid(),
    motivo        text not null check (motivo in ('acesso', 'lista_do_dia', 'arquivos', 'mensageria', 'faturamento',
                                                  'integracao', 'sugestao', 'outro')),
    motivo_outro  text check (motivo_outro is null or length(trim(motivo_outro)) between 2 and 80),
    assunto       text not null check (length(trim(assunto)) between 3 and 120),
    prioridade    text not null default 'normal' check (prioridade in ('normal', 'alta')),
    situacao      text not null default 'aberto'
                  check (situacao in ('aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido')),
    responsavel   uuid references public.perfis (id) on delete set null,
    criado_em     timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    check (motivo <> 'outro' or motivo_outro is not null)
);
create index if not exists chamados_empresa on public.chamados (empresa_id, atualizado_em desc);
create index if not exists chamados_fila on public.chamados (situacao, atualizado_em) where situacao <> 'resolvido';

create or replace function public.protocolo_chamado() returns trigger
language plpgsql as $$
begin
    new.protocolo := 'MC-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad(new.id::text, 6, '0');
    return new;
end $$;
drop trigger if exists protocolo_chamado on public.chamados;
create trigger protocolo_chamado before insert on public.chamados
    for each row execute function public.protocolo_chamado();

create table if not exists public.chamado_mensagens (
    id          bigint generated always as identity primary key,
    chamado_id  bigint not null references public.chamados (id) on delete cascade,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    autor       uuid references public.perfis (id) on delete set null default auth.uid(),
    tipo        text not null check (tipo in ('cliente', 'equipe', 'nota')),
    texto       text not null check (length(trim(texto)) between 1 and 10000),
    anexos      jsonb not null default '[]' check (jsonb_typeof(anexos) = 'array' and jsonb_array_length(anexos) <= 5),
    criado_em   timestamptz not null default now()
);
comment on column public.chamado_mensagens.tipo is 'cliente, equipe (resposta ao cliente) ou nota (interna, só a equipe vê).';
create index if not exists chamado_mensagens_chamado on public.chamado_mensagens (chamado_id, criado_em);

-- a mensagem herda a empresa do chamado; resposta do cliente reabre o chamado resolvido ou em espera
create or replace function public.mensagem_chamado() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.chamados;
begin
    select * into c from public.chamados where id = new.chamado_id;
    if c.id is null then raise exception 'chamado não encontrado'; end if;
    new.empresa_id := c.empresa_id;
    if new.tipo = 'cliente' then
        update public.chamados set atualizado_em = now(),
               situacao = case when situacao in ('resolvido', 'aguardando_cliente') then 'em_atendimento' else situacao end
         where id = c.id;
    elsif new.tipo = 'equipe' then
        update public.chamados set atualizado_em = now() where id = c.id;
    end if;
    return new;
end $$;
drop trigger if exists mensagem_chamado on public.chamado_mensagens;
create trigger mensagem_chamado before insert on public.chamado_mensagens
    for each row execute function public.mensagem_chamado();

create or replace function public.resolver_chamado(cid bigint) returns void
language sql security definer set search_path = public as $$
    update public.chamados set situacao = 'resolvido', atualizado_em = now()
     where id = cid and empresa_id in (select public.minhas_empresas());
$$;
revoke all on function public.resolver_chamado(bigint) from public, anon;
grant execute on function public.resolver_chamado(bigint) to authenticated;

alter table public.chamados enable row level security;
drop policy if exists chamados_ver on public.chamados;
create policy chamados_ver on public.chamados for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists chamados_abrir on public.chamados;
create policy chamados_abrir on public.chamados for insert to authenticated
    with check (empresa_id in (select public.minhas_empresas()) and aberto_por = auth.uid()
                and situacao = 'aberto' and responsavel is null);
drop policy if exists chamados_atender on public.chamados;
create policy chamados_atender on public.chamados for update to authenticated
    using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.chamados from anon;

alter table public.chamado_mensagens enable row level security;
drop policy if exists chamado_mensagens_ver on public.chamado_mensagens;
create policy chamado_mensagens_ver on public.chamado_mensagens for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (tipo <> 'nota' or public.sou_equipe()));
drop policy if exists chamado_mensagens_escrever on public.chamado_mensagens;
create policy chamado_mensagens_escrever on public.chamado_mensagens for insert to authenticated
    with check (autor = auth.uid()
                and exists (select 1 from public.chamados c where c.id = chamado_id
                            and c.empresa_id in (select public.minhas_empresas()))
                and (case when public.sou_equipe() then tipo in ('equipe', 'nota') else tipo = 'cliente' end));
revoke all on public.chamado_mensagens from anon;
revoke update, delete on public.chamado_mensagens from authenticated;

drop policy if exists chamados_anexar on storage.objects;
create policy chamados_anexar on storage.objects for insert to authenticated
    with check (bucket_id = 'chamados' and (storage.foldername(name))[1] ~ '^\d+$'
                and (storage.foldername(name))[1]::bigint in (select public.minhas_empresas()));
drop policy if exists chamados_ler_anexo on storage.objects;
create policy chamados_ler_anexo on storage.objects for select to authenticated
    using (bucket_id = 'chamados' and (storage.foldername(name))[1] ~ '^\d+$'
           and (storage.foldername(name))[1]::bigint in (select public.minhas_empresas()));

-- ---------------------------------------------------------------- credores: como a carga chega
alter table public.credores add column if not exists entrada_carga text not null default 'arquivo'
    check (entrada_carga in ('arquivo', 'api'));
comment on column public.credores.entrada_carga is 'arquivo (envio pelo site) ou api (o sistema do cliente manda pela API).';

-- ---------------------------------------------------------------- auditoria das tabelas novas
do $$
declare t text;
begin
    foreach t in array array['empresa_contatos', 'empresa_modulos', 'chamados'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
