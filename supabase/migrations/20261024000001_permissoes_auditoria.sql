-- Permissões por perfil (configuráveis pelo Admin) e auditoria.
--
-- * permissoes_catalogo (view): o que existe para liberar ou bloquear, com o PADRÃO MotorCob por perfil.
-- * permissoes_papel: o que o Admin da empresa mudou em relação ao padrão (empresa × perfil × permissão).
-- * pode('permissao'): o usuário logado tem a permissão? (ajuste da empresa, senão o padrão; admin da equipe
--   MotorCob pode tudo). TODAS as regras de escrita do banco e dos arquivos passam a usar pode(), então o que o
--   Admin bloqueia fica bloqueado no banco, não só escondido na tela.
-- * minhas_permissoes(): lista do usuário logado (o site usa para mostrar/esconder menus e botões).
-- * Travas: o perfil Admin nunca perde gerenciar_usuarios/gerenciar_permissoes; ninguém altera o próprio papel
--   ou status; só Admin cria/altera Admin.
-- * auditoria: quem alterou o quê e quando (configuração, usuários e permissões), gravado por gatilho; ninguém
--   edita nem apaga pelo site.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- catálogo e padrão MotorCob
create or replace view public.permissoes_catalogo as
select * from (values
  -- codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao
  ('baixar_listas',        'Operação',      'Baixar a lista do dia',        'Arquivos por canal (IDs e contatos) da Lista do dia.', true,  true,  true,  true),
  ('baixar_relatorios',    'Operação',      'Baixar arquivos completos',    'Fila completa, higienização, enriquecimento e demais saídas.', true, true, false, false),
  ('baixar_comite',        'Gestão',        'Baixar o relatório de comitê', 'Planilha mensal do comitê.', true, true, false, true),
  ('enviar_arquivos',      'Operação',      'Enviar arquivos',              'Cargas, acordos, pagamentos, ocorrências e retornos dos canais.', true, true, false, false),
  ('reenquadrar',          'Operação',      'Reenquadrar agora',            'Pedir a rodada do motor na hora.', true, true, false, false),
  ('editar_orquestracao',  'Configuração',  'Editar a orquestração',        'Segmentos, estratégias, personas e sugestões.', true, true, false, false),
  ('editar_credores',      'Configuração',  'Editar credores',              'Criar credor, calendário, mapeamento de arquivos e regras de retorno.', true, true, false, false),
  ('editar_canais',        'Configuração',  'Editar canais e frases',       'Canais da empresa (custo, horário) e playbook de frases.', true, true, false, false),
  ('ver_acessos',          'Administração', 'Ver acessos',                  'Histórico de acessos ao site.', true, false, false, true),
  ('ver_auditoria',        'Administração', 'Ver auditoria',                'Quem alterou o quê e quando.', true, false, false, false),
  ('gerenciar_usuarios',   'Administração', 'Gerenciar usuários',           'Convidar, desativar, reativar, resetar senha e trocar perfil.', true, false, false, false),
  ('gerenciar_permissoes', 'Administração', 'Gerenciar permissões',         'Ajustar o que cada perfil pode fazer.', true, false, false, false)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

create or replace function public.permissao_padrao(p public.papel, perm text) returns boolean
language sql stable set search_path = public as $$
    select coalesce((select case p when 'admin' then c.admin when 'planejamento' then c.planejamento
                                   when 'operacao' then c.operacao when 'gestao' then c.gestao end
                     from public.permissoes_catalogo c where c.codigo = perm), false)
$$;

create table if not exists public.permissoes_papel (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    papel           public.papel not null,
    permissao       text not null,
    permitido       boolean not null,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (empresa_id, papel, permissao)
);

create or replace function public.validar_permissao_papel() returns trigger
language plpgsql set search_path = public as $$
begin
    if not exists (select 1 from public.permissoes_catalogo where codigo = new.permissao) then
        raise exception 'permissão desconhecida: %', new.permissao;
    end if;
    if new.papel = 'admin' and new.permissao in ('gerenciar_usuarios', 'gerenciar_permissoes') and not new.permitido then
        raise exception 'o perfil Admin não pode perder %', new.permissao;   -- evita trancar a empresa para fora
    end if;
    new.atualizado_em := now();
    new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
    return new;
end $$;
drop trigger if exists validar_permissao_papel on public.permissoes_papel;
create trigger validar_permissao_papel before insert or update on public.permissoes_papel
    for each row execute function public.validar_permissao_papel();

create or replace function public.pode(perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.equipe and p.papel = 'admin' then true
                    else coalesce((select pp.permitido from public.permissoes_papel pp
                                   where pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = perm),
                                  public.permissao_padrao(p.papel, perm)) end
        from public.perfis p where p.id = auth.uid() and p.ativo), false)
$$;
revoke all on function public.pode(text) from anon;
grant execute on function public.pode(text) to authenticated;

create or replace function public.minhas_permissoes() returns setof text
language sql stable security definer set search_path = public as $$
    select c.codigo from public.permissoes_catalogo c where public.pode(c.codigo)
$$;
revoke all on function public.minhas_permissoes() from anon;
grant execute on function public.minhas_permissoes() to authenticated;

alter table public.permissoes_papel enable row level security;
drop policy if exists permissoes_papel_ver on public.permissoes_papel;
create policy permissoes_papel_ver on public.permissoes_papel for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists permissoes_papel_criar on public.permissoes_papel;
create policy permissoes_papel_criar on public.permissoes_papel for insert to authenticated
    with check (public.pode('gerenciar_permissoes') and empresa_id in (select public.minhas_empresas()));
drop policy if exists permissoes_papel_editar on public.permissoes_papel;
create policy permissoes_papel_editar on public.permissoes_papel for update to authenticated
    using (public.pode('gerenciar_permissoes') and empresa_id in (select public.minhas_empresas()))
    with check (public.pode('gerenciar_permissoes') and empresa_id in (select public.minhas_empresas()));
drop policy if exists permissoes_papel_apagar on public.permissoes_papel;
create policy permissoes_papel_apagar on public.permissoes_papel for delete to authenticated
    using (public.pode('gerenciar_permissoes') and empresa_id in (select public.minhas_empresas()));
revoke all on public.permissoes_papel from anon;

-- ---------------------------------------------------------------- regras de acesso passam a usar pode()
do $$
declare
    r record;
    perm text;
    novo_q text;
    novo_c text;
    ap constant text := '(public\.)?tem_papel\(VARIADIC ARRAY\[''admin''::(public\.)?papel, ''planejamento''::(public\.)?papel\]\)';
    ag constant text := '(public\.)?tem_papel\(VARIADIC ARRAY\[''admin''::(public\.)?papel, ''gestao''::(public\.)?papel\]\)';
    so_admin constant text := '(public\.)?tem_papel\(VARIADIC ARRAY\[''admin''::(public\.)?papel\]\)';
    so_gestao constant text := '(public\.)?tem_papel\(VARIADIC ARRAY\[''gestao''::(public\.)?papel\]\)';
    algum constant text := '\((public\.)?meu_papel\(\) IS NOT NULL\)';
begin
    for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
             where schemaname in ('public', 'storage') loop
        perm := case
            when r.tablename in ('clusters', 'estrategias', 'segmentos_carteira', 'personas_usuario', 'sugestoes')
                then 'editar_orquestracao'
            when r.tablename in ('credores', 'mapeamento_arquivos', 'ocorrencia_codigos', 'canal_codigos')
                then 'editar_credores'
            when r.tablename in ('canais_empresa', 'frases') then 'editar_canais'
            when r.tablename = 'envios' then 'enviar_arquivos'
            when r.tablename = 'pedidos_rotina' then 'reenquadrar'
            when r.tablename = 'objects' and r.policyname in ('entradas_enviar', 'entradas_ler') then 'enviar_arquivos'
            when r.tablename = 'objects' and r.policyname = 'saidas_ler_tudo' then 'baixar_relatorios'
            else null end;
        novo_q := r.qual;
        novo_c := r.with_check;
        if perm is not null then
            novo_q := regexp_replace(novo_q, ap, format('public.pode(%L)', perm), 'g');
            novo_c := regexp_replace(novo_c, ap, format('public.pode(%L)', perm), 'g');
        end if;
        if r.tablename = 'acessos' then
            novo_q := regexp_replace(novo_q, ag, 'public.pode(''ver_acessos'')', 'g');
        end if;
        if r.tablename = 'perfis' then
            novo_q := regexp_replace(novo_q, so_admin, 'public.pode(''gerenciar_usuarios'')', 'g');
            novo_c := regexp_replace(novo_c, so_admin, 'public.pode(''gerenciar_usuarios'')', 'g');
        end if;
        if r.tablename = 'objects' and r.policyname = 'saidas_ler_comite' then
            novo_q := regexp_replace(novo_q, so_gestao, 'public.pode(''baixar_comite'')', 'g');
        end if;
        if r.tablename = 'objects' and r.policyname = 'saidas_ler_ids' then
            novo_q := regexp_replace(novo_q, algum, 'public.pode(''baixar_listas'')', 'g');
        end if;
        if novo_q is not distinct from r.qual and novo_c is not distinct from r.with_check then
            continue;
        end if;
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

-- ---------------------------------------------------------------- perfis: quem altera papel e status
create or replace function public.proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if auth.uid() is null then
        return new;  -- banco/rotina (service_role, função de usuários ou SQL Editor)
    end if;
    if (new.empresa_id is distinct from old.empresa_id or new.equipe is distinct from old.equipe)
       and not public.admin_equipe() then
        raise exception 'só admin da equipe MotorCob altera empresa ou equipe';
    end if;
    if new.papel is distinct from old.papel or new.ativo is distinct from old.ativo then
        if old.id = auth.uid() then
            raise exception 'ninguém altera o próprio perfil ou status';
        end if;
        if not (public.pode('gerenciar_usuarios') and (public.sou_equipe() or public.pode_ver_empresa(old.empresa_id))) then
            raise exception 'sem permissão para alterar perfil ou status';
        end if;
        if (new.papel = 'admin' or old.papel = 'admin') and not public.tem_papel('admin') then
            raise exception 'só um Admin cria ou altera outro Admin';
        end if;
    end if;
    return new;
end $$;

-- ---------------------------------------------------------------- auditoria
create table if not exists public.auditoria (
    id          bigint generated always as identity primary key,
    empresa_id  bigint references public.empresas (id) on delete cascade,
    usuario     uuid,
    quando      timestamptz not null default now(),
    tabela      text not null,
    acao        text not null check (acao in ('INSERT', 'UPDATE', 'DELETE')),
    registro    text,
    mudou       jsonb
);
create index if not exists auditoria_empresa_quando on public.auditoria (empresa_id, quando desc);

create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    a jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    d jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
    ruido constant text[] := array['atualizado_em', 'atualizado_por', 'visto_em', 'qtd', 'primeira_vez', 'ultima_vez',
                                   'sugerido', 'cabecalho', 'arquivo', 'criado_em'];
    so_perfis constant text[] := array['papel', 'ativo', 'nome', 'empresa_id', 'equipe'];
    mudou jsonb := '{}';
    k text;
begin
    if auth.uid() is null then
        return coalesce(new, old);       -- a rotina do motor não entra na auditoria
    end if;
    for k in select jsonb_object_keys(coalesce(d, a)) loop
        continue when k = any (ruido);
        continue when tg_table_name = 'perfis' and not (k = any (so_perfis));   -- sem e-mail no histórico
        if tg_op = 'UPDATE' and (a -> k) is not distinct from (d -> k) then
            continue;
        end if;
        mudou := mudou || jsonb_build_object(k, jsonb_build_object('antes', a -> k, 'depois', d -> k));
    end loop;
    if tg_op = 'UPDATE' and mudou = '{}' then
        return new;
    end if;
    insert into public.auditoria (empresa_id, usuario, tabela, acao, registro, mudou)
    values (coalesce((coalesce(d, a) ->> 'empresa_id')::bigint,
                     case when tg_table_name = 'empresas' then (coalesce(d, a) ->> 'id')::bigint end),
            auth.uid(), tg_table_name, tg_op,
            coalesce(coalesce(d, a) ->> 'id', coalesce(d, a) ->> 'codigo', coalesce(d, a) ->> 'permissao'), mudou);
    return coalesce(new, old);
end $$;

do $$
declare t text;
begin
    foreach t in array array['estrategias', 'clusters', 'segmentos_carteira', 'personas_usuario', 'credores',
                             'canais_empresa', 'frases', 'mapeamento_arquivos', 'ocorrencia_codigos', 'canal_codigos',
                             'sugestoes', 'perfis', 'permissoes_papel', 'empresas'] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop trigger if exists z_auditar on public.%I', t);
            execute format('create trigger z_auditar after insert or update or delete on public.%I '
                           'for each row execute function public.auditar()', t);
        end if;
    end loop;
end $$;

alter table public.auditoria enable row level security;
drop policy if exists auditoria_ver on public.auditoria;
create policy auditoria_ver on public.auditoria for select to authenticated
    using (public.pode('ver_auditoria') and (empresa_id in (select public.minhas_empresas())
                                            or (empresa_id is null and public.admin_equipe())));
revoke all on public.auditoria from anon;
revoke insert, update, delete on public.auditoria from authenticated;

-- ---------------------------------------------------------------- endurecimento
-- TRUNCATE ignora as regras de acesso (RLS) e REFERENCES/TRIGGER não têm uso pelo site: só o banco/rotina.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
