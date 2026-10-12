-- Equipe MotorCX: papéis (Master, Atendimento, Comercial), alcance (todas as empresas ou só a carteira) e
-- permissões por pessoa.
-- * Comercial = equipe com papel 'gestao'. Atendimento = papel 'operacao'. Master = papel 'admin' (tem tudo).
-- * Alcance (perfis.equipe_alcance): 'todas' ou 'carteira' = só as empresas em que a pessoa é Vendedor
--   (empresas.vendedor_id) ou Gerente da conta (empresas.gerente_id). Vale no BANCO: minhas_empresas() deixa de
--   devolver as outras, então nenhuma tela consegue mostrá-las.
-- * Permissões (12): cada papel tem um padrão; o Master liga/desliga por pessoa (permissoes_equipe).
-- * Empresa criada por quem não é Master entra na carteira dele como Vendedor.
-- * Funções que eram só do Master passam a aceitar quem tem a permissão, na empresa do alcance: preço, contratação,
--   faturas (ajustar, fechar e emitir), pausar, responder chamados, ver margem (só das empresas do alcance) e entrar
--   na Mensageria do cliente.
-- Rode DEPOIS do SQL 20 (este SQL ajusta funções dos SQL 12, 16 e 19). Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- papel, alcance e permissões
alter table public.perfis add column if not exists equipe_alcance text not null default 'todas'
    check (equipe_alcance in ('todas', 'carteira'));
comment on column public.perfis.equipe_alcance is 'Equipe: todas as empresas ou só a carteira (vendedor/gerente).';

create or replace view public.permissoes_equipe_catalogo as
select * from (values
    ('ver_empresas', 'Empresas', 'Ver empresas e Saúde', true, true, true),
    ('criar_empresa', 'Empresas', 'Criar empresa', true, false, true),
    ('convidar_admin', 'Empresas', 'Convidar o Admin do cliente', true, false, true),
    ('pausar_empresa', 'Empresas', 'Pausar ou reativar empresa', true, false, false),
    ('editar_contratacao', 'Contratação', 'Editar contratação', true, false, false),
    ('editar_precos', 'Contratação', 'Editar preços', true, false, false),
    ('ver_faturamento', 'Financeiro', 'Ver faturamento', true, false, true),
    ('emitir_faturas', 'Financeiro', 'Ajustar e emitir faturas', true, false, false),
    ('ver_margem', 'Financeiro', 'Ver margem', true, false, false),
    ('responder_chamados', 'Atendimento', 'Responder chamados', true, true, false),
    ('acessar_mensageria', 'Atendimento', 'Entrar na Mensageria do cliente', true, true, false),
    ('gerenciar_equipe', 'Equipe', 'Gerenciar a equipe', true, false, false)
) as c(permissao, grupo, nome, master, atendimento, comercial);
grant select on public.permissoes_equipe_catalogo to authenticated;

create table if not exists public.permissoes_equipe (
    usuario_id      uuid not null references public.perfis (id) on delete cascade,
    permissao       text not null,
    permitido       boolean not null,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (usuario_id, permissao)
);
comment on table public.permissoes_equipe is 'Ajuste por pessoa da equipe sobre o padrão do papel (sem linha = padrão).';
alter table public.permissoes_equipe enable row level security;
revoke all on public.permissoes_equipe from anon;
revoke insert, update, delete on public.permissoes_equipe from authenticated;

create or replace function public.funcao_equipe(papel public.papel) returns text
language sql immutable as $$
    select case papel when 'admin' then 'master' when 'gestao' then 'comercial' else 'atendimento' end
$$;

-- a pessoa logada (da equipe) tem esta permissão? Master: sempre.
create or replace function public.pode_equipe(perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.papel = 'admin' then true
                    else coalesce((select x.permitido from public.permissoes_equipe x
                                    where x.usuario_id = p.id and x.permissao = perm),
                                  (select case public.funcao_equipe(p.papel) when 'comercial' then c.comercial
                                                                             else c.atendimento end
                                     from public.permissoes_equipe_catalogo c where c.permissao = perm), false) end
          from public.perfis p where p.id = auth.uid() and p.ativo and p.equipe), false)
$$;

-- empresas que a pessoa logada enxerga: cliente = a sua; equipe = todas ou a carteira (se puder ver empresas)
create or replace function public.minhas_empresas() returns setof bigint
language sql stable security definer set search_path = public as $$
    with eu as (
        select p.id, p.equipe, p.empresa_id, p.papel, p.equipe_alcance,
               case when p.equipe then public.pode_equipe('ver_empresas') else false end as ve
          from public.perfis p where p.id = auth.uid() and p.ativo
    )
    select e.id from public.empresas e, eu
     where (not eu.equipe and eu.empresa_id = e.id)
        or (eu.equipe and (eu.papel = 'admin'
                           or (eu.ve and (eu.equipe_alcance = 'todas' or e.vendedor_id = eu.id or e.gerente_id = eu.id))))
$$;

create or replace function public.pode_ver_empresa(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select eid in (select public.minhas_empresas())
$$;

create or replace function public.pode_ver_slug(s text) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.empresas e where e.slug = s and e.id in (select public.minhas_empresas()))
$$;

-- a equipe pode fazer <perm> nesta empresa? (eid null = ação sem empresa)
create or replace function public.equipe_pode(perm text, eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select public.sou_equipe() and public.pode_equipe(perm)
           and (eid is null or eid in (select public.minhas_empresas()))
$$;

revoke all on function public.pode_equipe(text), public.equipe_pode(text, bigint) from public, anon;
grant execute on function public.pode_equipe(text), public.equipe_pode(text, bigint) to authenticated;

-- ---------------------------------------------------------------- faturamento: só no alcance e com permissão
create or replace function public.ve_faturamento(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select case when public.sou_equipe() then public.equipe_pode('ver_faturamento', eid)
                else eid in (select public.minhas_empresas()) and public.pode('ver_faturamento') end
$$;

-- ---------------------------------------------------------------- empresas: criar, editar, carteira
drop policy if exists empresas_criar on public.empresas;
create policy empresas_criar on public.empresas for insert to authenticated
    with check (public.admin_equipe() or public.equipe_pode('criar_empresa', null));
drop policy if exists empresas_editar on public.empresas;
create policy empresas_editar on public.empresas for update to authenticated
    using (public.admin_equipe() or public.equipe_pode('editar_contratacao', id) or public.equipe_pode('pausar_empresa', id))
    with check (public.admin_equipe() or public.equipe_pode('editar_contratacao', id) or public.equipe_pode('pausar_empresa', id));

create or replace function public.carteira_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        if public.sou_equipe() and not public.admin_equipe() then
            new.vendedor_id := auth.uid();         -- quem cria fica com a conta
        end if;
        return new;
    end if;
    if auth.uid() is null or public.admin_equipe() then
        return new;
    end if;
    if (new.vendedor_id is distinct from old.vendedor_id or new.gerente_id is distinct from old.gerente_id)
       and not public.pode_equipe('gerenciar_equipe') then
        raise exception 'só quem gerencia a equipe troca o responsável da conta';
    end if;
    if new.situacao is distinct from old.situacao and not public.pode_equipe('pausar_empresa') then
        raise exception 'sem permissão para pausar ou reativar a empresa';
    end if;
    if (to_jsonb(new) - 'situacao' - 'vendedor_id' - 'gerente_id' - 'colunas_base')
       is distinct from (to_jsonb(old) - 'situacao' - 'vendedor_id' - 'gerente_id' - 'colunas_base')
       and not public.pode_equipe('editar_contratacao') then
        raise exception 'sem permissão para editar o cadastro da empresa';
    end if;
    return new;
end $$;
drop trigger if exists carteira_empresa on public.empresas;
create trigger carteira_empresa before insert or update on public.empresas
    for each row execute function public.carteira_empresa();

-- Master (ou quem gerencia a equipe) põe Vendedor e Gerente da conta
create or replace function public.definir_responsaveis(empresa bigint, vendedor uuid, gerente uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not (public.admin_equipe() or public.pode_equipe('gerenciar_equipe')) then
        raise exception 'só quem gerencia a equipe troca o responsável da conta';
    end if;
    if exists (select 1 from unnest(array[vendedor, gerente]) u(id)
               where u.id is not null and not exists (select 1 from public.perfis p where p.id = u.id and p.equipe and p.ativo)) then
        raise exception 'o responsável precisa ser da equipe MotorCX';
    end if;
    update public.empresas set vendedor_id = vendedor, gerente_id = gerente where id = empresa;
end $$;
revoke all on function public.definir_responsaveis(bigint, uuid, uuid) from public, anon;
grant execute on function public.definir_responsaveis(bigint, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- contratação (motor, módulos, ciclo, frentes)
drop policy if exists empresa_modulos_gravar on public.empresa_modulos;
create policy empresa_modulos_gravar on public.empresa_modulos for all to authenticated
    using (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id))
    with check (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id));
drop policy if exists ciclo_empresa_gravar on public.ciclo_empresa;
create policy ciclo_empresa_gravar on public.ciclo_empresa for all to authenticated
    using (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id))
    with check (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id));
drop policy if exists empresa_frentes_gravar on public.empresa_frentes;
create policy empresa_frentes_gravar on public.empresa_frentes for all to authenticated
    using (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id))
    with check (public.admin_equipe() or public.equipe_pode('editar_contratacao', empresa_id));

-- ---------------------------------------------------------------- funções que eram só do Master
-- troca a checagem dentro da função já existente (sem copiar o corpo inteiro); rodar de novo não faz nada
create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

select pg_temp.trocar('public.salvar_preco(bigint,text,text,numeric,numeric,jsonb,date)',
    'if not public.admin_equipe() then', 'if not public.equipe_pode(''editar_precos'', salvar_preco.empresa) then');
select pg_temp.trocar('public.salvar_frentes(bigint,text[])',
    'if not public.admin_equipe() then', 'if not public.equipe_pode(''editar_contratacao'', salvar_frentes.empresa) then');
select pg_temp.trocar('public.fechar_fatura(bigint,date)',
    'if not public.admin_equipe() then', 'if not public.equipe_pode(''emitir_faturas'', fechar_fatura.empresa) then');
select pg_temp.trocar('public.ajustar_fatura(bigint,text,numeric,text)',
    'if not public.admin_equipe() then',
    'if not public.equipe_pode(''emitir_faturas'', (select fx.empresa_id from public.faturas fx where fx.id = ajustar_fatura.fatura)) then');
select pg_temp.trocar('public.remover_ajuste(bigint)',
    'if not public.admin_equipe() then',
    'if not public.equipe_pode(''emitir_faturas'', (select ax.empresa_id from public.fatura_ajustes ax where ax.id = remover_ajuste.ajuste)) then');
select pg_temp.trocar('public.emitir_fatura(bigint)',
    'if not public.admin_equipe() then',
    'if not public.equipe_pode(''emitir_faturas'', (select fx.empresa_id from public.faturas fx where fx.id = emitir_fatura.fatura)) then');
-- margem: quem tem a permissão vê só as empresas do alcance
select pg_temp.trocar('public.margem_mensageria(date,text)',
    'if not public.admin_equipe() then', 'if not (public.admin_equipe() or public.equipe_pode(''ver_margem'', null)) then');
select pg_temp.trocar('public.margem_mensageria(date,text)',
    'where c.competencia = comp and c.modo = margem_mensageria.modo',
    'where c.empresa_id in (select public.minhas_empresas()) and c.competencia = comp and c.modo = margem_mensageria.modo');
-- saúde: só as empresas do alcance
select pg_temp.trocar('public.saude_empresas()',
    'where e.ativa and e.situacao <> ''encerrada''',
    'where e.ativa and e.situacao <> ''encerrada'' and e.id in (select public.minhas_empresas())');

-- ---------------------------------------------------------------- chamados
drop policy if exists chamados_atender on public.chamados;
create policy chamados_atender on public.chamados for update to authenticated
    using (public.equipe_pode('responder_chamados', empresa_id))
    with check (public.equipe_pode('responder_chamados', empresa_id));
drop policy if exists chamado_mensagens_escrever on public.chamado_mensagens;
create policy chamado_mensagens_escrever on public.chamado_mensagens for insert to authenticated
    with check (autor = auth.uid()
                and exists (select 1 from public.chamados c where c.id = chamado_id
                            and c.empresa_id in (select public.minhas_empresas()))
                and (case when public.sou_equipe()
                          then (tipo in ('equipe', 'nota') and public.pode_equipe('responder_chamados'))
                               or (tipo = 'cliente' and exists (select 1 from public.chamados c
                                                                where c.id = chamado_id and c.aberto_por = auth.uid()))
                          else tipo = 'cliente' end));

-- ---------------------------------------------------------------- Mensageria do cliente: só com a permissão
do $$
declare
    r record;
    extra constant text := ' AND ((NOT public.sou_equipe()) OR public.pode_equipe(''acessar_mensageria''::text))';
begin
    for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
             where schemaname = 'public' and tablename like 'mensageria\_%'
               and (coalesce(qual, '') like '%minhas_empresas%' or coalesce(with_check, '') like '%minhas_empresas%')
               and coalesce(qual, '') not like '%acessar_mensageria%'
               and coalesce(with_check, '') not like '%acessar_mensageria%' loop
        if r.qual is not null and r.with_check is not null then
            execute format('alter policy %I on %I.%I using ((%s)%s) with check ((%s)%s)',
                           r.policyname, r.schemaname, r.tablename, r.qual, extra, r.with_check, extra);
        elsif r.qual is not null then
            execute format('alter policy %I on %I.%I using ((%s)%s)', r.policyname, r.schemaname, r.tablename, r.qual, extra);
        else
            execute format('alter policy %I on %I.%I with check ((%s)%s)', r.policyname, r.schemaname, r.tablename,
                           r.with_check, extra);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------- gerenciar a equipe
drop function if exists public.listar_equipe();
create or replace function public.listar_equipe()
returns table (id uuid, nome text, email text, funcao text, alcance text, ativo boolean, ultimo_login timestamptz,
               duas_etapas boolean, carteira int, permissoes jsonb)
language sql stable security definer set search_path = public as $$
    select p.id, p.nome, u.email::text, public.funcao_equipe(p.papel), p.equipe_alcance, p.ativo, u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'),
           (select count(*)::int from public.empresas e where e.vendedor_id = p.id or e.gerente_id = p.id),
           (select jsonb_object_agg(c.permissao, case when p.papel = 'admin' then true
                       else coalesce(x.permitido, case public.funcao_equipe(p.papel) when 'comercial' then c.comercial
                                                                                    else c.atendimento end) end)
              from public.permissoes_equipe_catalogo c
              left join public.permissoes_equipe x on x.usuario_id = p.id and x.permissao = c.permissao)
      from public.perfis p
      join auth.users u on u.id = p.id
     where p.equipe and public.sou_equipe()
     order by (p.papel = 'admin') desc, p.nome
$$;
revoke execute on function public.listar_equipe() from public, anon;
grant execute on function public.listar_equipe() to authenticated;

drop function if exists public.definir_funcao_equipe(uuid, text);
create or replace function public.definir_funcao_equipe(usuario uuid, funcao text) returns text
language plpgsql security definer set search_path = public as $$
declare
    alvo public.perfis;
begin
    if not (public.admin_equipe() or (public.pode_equipe('gerenciar_equipe') and funcao <> 'master')) then
        raise exception 'sem permissão para mudar a função de alguém da equipe';
    end if;
    if not public.sessao_aal2() then
        raise exception 'entre com o seu código de duas etapas para mudar a equipe';
    end if;
    if funcao not in ('master', 'atendimento', 'comercial') then
        raise exception 'função inválida: use master, atendimento ou comercial';
    end if;
    if usuario = auth.uid() then
        raise exception 'ninguém muda a própria função';
    end if;
    select * into alvo from public.perfis where id = usuario;
    if alvo.id is null then
        raise exception 'usuário não encontrado';
    end if;
    if alvo.equipe and alvo.papel = 'admin' and not public.admin_equipe() then
        raise exception 'só um Master muda outro Master';
    end if;
    if funcao <> 'master' and alvo.equipe and alvo.papel = 'admin'
       and (select count(*) from public.perfis where equipe and papel = 'admin' and ativo and id <> usuario) = 0 then
        raise exception 'a equipe precisa de pelo menos um Master ativo';
    end if;
    update public.perfis
       set equipe = true, empresa_id = null, ativo = true,
           papel = case funcao when 'master' then 'admin' when 'comercial' then 'gestao' else 'operacao' end::public.papel,
           equipe_alcance = case funcao when 'comercial' then 'carteira' when 'master' then 'todas'
                                 else equipe_alcance end
     where id = usuario;
    delete from public.permissoes_equipe where usuario_id = usuario;       -- nova função, padrão novo
    return funcao;
end $$;
revoke execute on function public.definir_funcao_equipe(uuid, text) from public, anon;
grant execute on function public.definir_funcao_equipe(uuid, text) to authenticated;

-- alcance e ajustes de permissão de uma pessoa (permissoes: {"editar_precos": true, ...}; null = padrão do papel)
create or replace function public.configurar_equipe(usuario uuid, alcance text, permissoes jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare
    alvo public.perfis;
    k text;
    v jsonb;
begin
    if not (public.admin_equipe() or public.pode_equipe('gerenciar_equipe')) then
        raise exception 'sem permissão para configurar a equipe';
    end if;
    if usuario = auth.uid() then
        raise exception 'ninguém muda as próprias permissões';
    end if;
    select * into alvo from public.perfis where id = usuario;
    if alvo.id is null or not alvo.equipe then
        raise exception 'pessoa da equipe não encontrada';
    end if;
    if alvo.papel = 'admin' then
        raise exception 'Master tem tudo e vê todas as empresas';
    end if;
    if alcance not in ('todas', 'carteira') then
        raise exception 'alcance inválido: use todas ou carteira';
    end if;
    if jsonb_typeof(coalesce(permissoes, '{}')) <> 'object' then
        raise exception 'permissões em formato inválido';
    end if;
    update public.perfis set equipe_alcance = alcance where id = usuario;
    for k, v in select * from jsonb_each(coalesce(permissoes, '{}')) loop
        if not exists (select 1 from public.permissoes_equipe_catalogo c where c.permissao = k) then
            raise exception 'permissão desconhecida: %', k;
        end if;
        if k = 'gerenciar_equipe' and not public.admin_equipe() then
            raise exception 'só um Master dá a permissão de gerenciar a equipe';
        end if;
        if v is null or v = 'null'::jsonb then
            delete from public.permissoes_equipe where usuario_id = usuario and permissao = k;
        elsif jsonb_typeof(v) = 'boolean' then
            insert into public.permissoes_equipe (usuario_id, permissao, permitido) values (usuario, k, v::text::boolean)
            on conflict (usuario_id, permissao) do update set permitido = excluded.permitido, atualizado_em = now(),
                atualizado_por = auth.uid();
        else
            raise exception 'valor inválido para %', k;
        end if;
    end loop;
end $$;
revoke all on function public.configurar_equipe(uuid, text, jsonb) from public, anon;
grant execute on function public.configurar_equipe(uuid, text, jsonb) to authenticated;
