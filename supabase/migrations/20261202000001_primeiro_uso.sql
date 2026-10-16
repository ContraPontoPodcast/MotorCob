-- SQL 35 · Primeiro uso do cliente (protótipo aprovado em 15/10/2026)
-- 1. primeiros_passos(empresa): o roteiro do Início, montado pelo que foi contratado e marcado pelo que aconteceu
--    de verdade (ninguém marca à mão). Só "Convidar a sua equipe" pode ser pulado.
-- 2. Pedido de envio real: o cliente pede (pedir_envio_real), abre um chamado de Mensageria para o Suporte, que
--    responde em até 1 hora e liga (ligar_envio_real) ou devolve com o motivo (recusar_envio_real).
-- 3. Console › Implantação: implantacao_empresas() e os avisos de empresa parada há mais de 7 dias e de pedido de
--    envio real sem resposta em 1 hora (gerar_avisos_implantacao, chamada pelo motor).
-- A permissão da equipe "ligar_envio_real" (Master e Atendimento) está no catálogo desde o SQL 33.
-- Depende dos SQL 33 e 34. Pode rodar de novo sem erro.

-- ================================================================ 1. primeiros passos
alter table public.perfis add column if not exists ocultar_primeiros_passos boolean not null default false;

create table if not exists public.empresa_passos_pulados (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    passo       text not null check (passo in ('equipe')),
    pulado_por  uuid default auth.uid() references auth.users (id) on delete set null,
    pulado_em   timestamptz not null default now(),
    primary key (empresa_id, passo)
);
alter table public.empresa_passos_pulados enable row level security;
revoke all on public.empresa_passos_pulados from anon, authenticated;
grant all on public.empresa_passos_pulados to service_role;

-- o motor (chave do servidor) também lê os passos e a implantação, para gerar os avisos
create or replace function public.chamada_do_servidor() returns boolean
language sql stable as $$ select current_setting('role', true) = 'service_role' $$;

create or replace function public.modulo_ativo(empresa bigint, m text) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.empresa_modulos x where x.empresa_id = empresa and x.modulo = m and x.ativo)
$$;
revoke all on function public.modulo_ativo(bigint, text) from public, anon, authenticated;

-- Cada passo: ordem, código, grupo, título, se está feito, se foi pulado e se depende da equipe MotorCob.
create or replace function public.primeiros_passos(empresa bigint)
returns table (ordem int, passo text, grupo text, titulo text, feito boolean, pulado boolean, da_equipe boolean)
language plpgsql stable security definer set search_path = public as $$
declare
    cob boolean := public.modulo_ativo(empresa, 'orquestracao');
    jor boolean := public.modulo_ativo(empresa, 'jornada');
    msg boolean := public.modulo_ativo(empresa, 'mensageria');
    api boolean := public.modulo_ativo(empresa, 'api');
    pre boolean := exists (select 1 from public.ciclo_empresa c where c.empresa_id = empresa and c.modelo_pagamento = 'pre');
    real boolean := exists (select 1 from public.mensageria_config c where c.empresa_id = empresa and c.modo = 'real');
    pulou boolean := exists (select 1 from public.empresa_passos_pulados x where x.empresa_id = empresa and x.passo = 'equipe');
begin
    if not (public.chamada_do_servidor() or public.pode_ver_empresa(empresa)) then
        raise exception 'empresa fora do seu acesso';
    end if;
    return query
    with p(ordem, passo, grupo, titulo, entra, feito, da_equipe) as (values
        (1, 'conta', 'conta', 'Criar a senha e o código no celular', true,
         exists (select 1 from public.perfis x where x.empresa_id = empresa and not x.equipe and x.ativo
                    and x.papel = 'admin' and x.ultimo_acesso is not null
                    and exists (select 1 from auth.mfa_factors f where f.user_id = x.id and f.status::text = 'verified')),
         false),
        (2, 'fatura', 'empresa', 'Dizer quem recebe as faturas', true,
         exists (select 1 from public.empresa_contatos c where c.empresa_id = empresa and c.recebe_faturas), false),
        (3, 'equipe', 'empresa', 'Convidar a sua equipe', true,
         pulou or exists (select 1 from public.perfis x where x.empresa_id = empresa and not x.equipe and x.ativo
                             and x.papel <> 'admin'), false),
        (10, 'carga', 'cobranca', 'Enviar a primeira carga', cob,
         exists (select 1 from public.envios e left join public.credores c on c.id = e.credor_id
                  where e.empresa_id = empresa and e.status <> 'erro' and coalesce(c.frente, 'motorcob') = 'motorcob'),
         false),
        (11, 'lista', 'cobranca', 'Ver a primeira Lista do dia', cob,
         exists (select 1 from public.acoes_dia a left join public.credores c on c.id = a.credor_id
                  where a.empresa_id = empresa and coalesce(c.frente, 'motorcob') = 'motorcob'), false),
        (20, 'token', 'jornada', 'Criar o token da API', api,
         exists (select 1 from public.api_tokens t where t.empresa_id = empresa), false),
        (21, 'carga_jornada', 'jornada', 'Enviar a primeira carga da Jornada', jor,
         exists (select 1 from public.jornada_cliente j where j.empresa_id = empresa), false),
        (30, 'template', 'mensageria', 'Criar o primeiro template', msg,
         exists (select 1 from public.mensageria_templates t where t.empresa_id = empresa and t.situacao = 'ativo'), false),
        (31, 'recarga', 'mensageria', 'Fazer a primeira recarga', msg and pre,
         exists (select 1 from public.recargas r where r.empresa_id = empresa and r.situacao = 'paga'), false),
        (32, 'teste', 'mensageria', 'Fazer um envio de teste em simulação', msg,
         real or exists (select 1 from public.mensageria_lotes l where l.empresa_id = empresa and l.modo = 'simulado'),
         false),
        (33, 'pedir', 'mensageria', 'Pedir o envio real', msg,
         real or exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa
                            and r.situacao in ('aberto', 'ligado')), false),
        (34, 'real', 'mensageria', 'Envio real ligado pelo Suporte', msg, real, true)
    )
    select p.ordem, p.passo, p.grupo, p.titulo, p.feito, p.passo = 'equipe' and pulou, p.da_equipe
      from p where p.entra order by p.ordem;
end $$;

create or replace function public.pular_primeiro_passo(empresa bigint, passo text) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.pode_ver_empresa(empresa) or public.sou_equipe() or not public.pode('gerenciar_usuarios') then
        raise exception 'só o Admin da empresa pula este passo';
    end if;
    if passo is distinct from 'equipe' then
        raise exception 'este passo não pode ser pulado';
    end if;
    insert into public.empresa_passos_pulados (empresa_id, passo) values (empresa, passo) on conflict do nothing;
end $$;

create or replace function public.ocultar_primeiros_passos(ocultar boolean) returns void
language sql security definer set search_path = public as $$
    update public.perfis set ocultar_primeiros_passos = coalesce(ocultar, false) where id = auth.uid()
$$;

-- ================================================================ 2. pedido de envio real
create table if not exists public.pedidos_envio_real (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    pedido_por    uuid default auth.uid() references auth.users (id) on delete set null,
    pedido_em     timestamptz not null default now(),
    situacao      text not null default 'aberto' check (situacao in ('aberto', 'ligado', 'recusado')),
    chamado_id    bigint references public.chamados (id) on delete set null,
    resolvido_por uuid references auth.users (id) on delete set null,
    resolvido_em  timestamptz,
    motivo        text check (motivo is null or char_length(trim(motivo)) between 5 and 400),
    check ((situacao = 'aberto') = (resolvido_em is null)),
    check (situacao <> 'recusado' or motivo is not null)
);
create unique index if not exists pedidos_envio_real_aberto on public.pedidos_envio_real (empresa_id)
    where situacao = 'aberto';
alter table public.pedidos_envio_real enable row level security;
revoke all on public.pedidos_envio_real from anon, authenticated;
grant select on public.pedidos_envio_real to authenticated;
grant all on public.pedidos_envio_real to service_role;
drop policy if exists pedidos_envio_real_ver on public.pedidos_envio_real;
create policy pedidos_envio_real_ver on public.pedidos_envio_real for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));

create or replace function public.pedir_envio_real(empresa bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    falta text;
    ch bigint;
    pid bigint;
begin
    if not public.pode_ver_empresa(empresa) or public.sou_equipe() then
        raise exception 'empresa fora do seu acesso';
    end if;
    if not public.pode('enviar_mensagens') then
        raise exception 'só quem pode enviar mensagens pede o envio real';
    end if;
    if not public.modulo_ativo(empresa, 'mensageria') then
        raise exception 'a Mensageria não está contratada';
    end if;
    if exists (select 1 from public.mensageria_config c where c.empresa_id = empresa and c.modo = 'real') then
        raise exception 'o envio real já está ligado';
    end if;
    if exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa and r.situacao = 'aberto') then
        raise exception 'já existe um pedido em aberto';
    end if;
    select string_agg(lower(x.titulo), ', ' order by x.ordem) into falta
      from public.primeiros_passos(empresa) x
     where x.passo in ('fatura', 'template', 'teste', 'recarga') and not x.feito;
    if falta is not null then
        raise exception 'antes de pedir: %', falta;
    end if;
    insert into public.chamados (empresa_id, motivo, assunto, prioridade)
    values (empresa, 'mensageria', 'Ligar envio real', 'alta') returning id into ch;
    insert into public.chamado_mensagens (chamado_id, tipo, texto)
    values (ch, 'cliente', 'Pedido de envio real. Conferido: quem recebe as faturas, template ativo e envio de teste em '
                           || 'simulação. Prazo de resposta do Suporte: até 1 hora.');
    insert into public.pedidos_envio_real (empresa_id, chamado_id) values (empresa, ch) returning id into pid;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'equipe', empresa, 'atencao', left('Pedido de envio real · ' || e.nome, 140),
           'Responder em até 1 hora.', '/console/implantacao', 'envio_real:' || pid
      from public.empresas e where e.id = empresa;
    return pid;
end $$;

create or replace function public.ligar_envio_real(empresa bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pedidos_envio_real;
begin
    if not public.sou_equipe() or not public.pode_equipe('ligar_envio_real') or not public.pode_ver_empresa(empresa) then
        raise exception 'sem permissão para ligar o envio real';
    end if;
    insert into public.mensageria_config (empresa_id, modo, atualizado_em, atualizado_por)
    values (empresa, 'real', now(), auth.uid())
    on conflict (empresa_id) do update set modo = 'real', atualizado_em = now(), atualizado_por = auth.uid();
    update public.pedidos_envio_real set situacao = 'ligado', resolvido_por = auth.uid(), resolvido_em = now()
     where empresa_id = empresa and situacao = 'aberto' returning * into r;
    if r.chamado_id is not null then
        insert into public.chamado_mensagens (chamado_id, tipo, texto)
        values (r.chamado_id, 'equipe', 'Envio real ligado. As mensagens passam a sair de verdade e entram na fatura.');
        update public.chamados set situacao = 'resolvido', atualizado_em = now() where id = r.chamado_id;
    end if;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
    values ('empresa', empresa, 'pronto', 'Envio real ligado',
            'As mensagens passam a sair de verdade, pelo fornecedor da rota, e entram na fatura.', '/mensageria');
end $$;

create or replace function public.recusar_envio_real(empresa bigint, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pedidos_envio_real;
begin
    if not public.sou_equipe() or not public.pode_equipe('ligar_envio_real') or not public.pode_ver_empresa(empresa) then
        raise exception 'sem permissão para responder o pedido';
    end if;
    update public.pedidos_envio_real p set situacao = 'recusado', resolvido_por = auth.uid(), resolvido_em = now(),
                                         motivo = trim(recusar_envio_real.motivo)
     where p.empresa_id = empresa and p.situacao = 'aberto' returning * into r;
    if r.id is null then
        raise exception 'não há pedido em aberto';
    end if;
    if r.chamado_id is not null then
        insert into public.chamado_mensagens (chamado_id, tipo, texto) values (r.chamado_id, 'equipe', r.motivo);
        update public.chamados set situacao = 'aguardando_cliente', atualizado_em = now() where id = r.chamado_id;
    end if;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
    values ('empresa', empresa, 'atencao', 'Envio real ainda não ligado', left(r.motivo, 400), '/mensageria');
end $$;

-- ================================================================ 3. Console › Implantação
create or replace function public.implantacao_empresas()
returns table (empresa_id bigint, nome text, criada_em timestamptz, total int, feitos int, proximo text,
               ultima_atividade timestamptz, pedido_em timestamptz, vendedor_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.sou_equipe()) then
        raise exception 'só a equipe MotorCob';
    end if;
    return query
    select e.id, e.nome, e.criada_em, x.total, x.feitos, x.proximo,
           greatest(e.criada_em,
                    (select max(v.enviado_em) from public.envios v where v.empresa_id = e.id),
                    (select max(l.criado_em) from public.mensageria_lotes l where l.empresa_id = e.id),
                    (select max(c.criado_em) from public.empresa_contatos c where c.empresa_id = e.id),
                    (select max(p.ultimo_acesso) from public.perfis p where p.empresa_id = e.id and not p.equipe),
                    (select max(r.pedido_em) from public.pedidos_envio_real r where r.empresa_id = e.id)),
           (select r.pedido_em from public.pedidos_envio_real r where r.empresa_id = e.id and r.situacao = 'aberto'),
           e.vendedor_id
      from public.empresas e
      cross join lateral (
          select count(*)::int as total, count(*) filter (where s.feito)::int as feitos,
                 (array_agg(s.titulo order by s.ordem) filter (where not s.feito))[1] as proximo
            from public.primeiros_passos(e.id) s) x
     where (public.chamada_do_servidor() or e.id in (select public.minhas_empresas()))
       and e.criada_em > now() - interval '90 days'
       and coalesce(e.situacao, 'ativa') not in ('suspensa', 'encerrada')
       and x.feitos < x.total
     order by (select r.pedido_em from public.pedidos_envio_real r where r.empresa_id = e.id and r.situacao = 'aberto')
              nulls last, e.criada_em;
end $$;

-- motor (chave do servidor): empresa parada há mais de 7 dias avisa o vendedor (uma vez por semana) e pedido de
-- envio real sem resposta em 1 hora avisa a equipe (uma vez por pedido)
create or replace function public.gerar_avisos_implantacao() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave)
    select case when i.vendedor_id is null then 'equipe' else 'usuario' end, i.empresa_id, i.vendedor_id, 'atencao',
           left('Implantação parada · ' || i.nome, 140),
           left('Sem avanço há ' || (current_date - i.ultima_atividade::date) || ' dias. Próximo passo: '
                || coalesce(i.proximo, '—') || '.', 400),
           '/console/implantacao', 'implantacao:' || i.empresa_id || ':' || to_char(current_date, 'IYYY-IW')
      from public.implantacao_empresas() i
     where i.pedido_em is null and i.ultima_atividade < now() - interval '7 days'
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'equipe', r.empresa_id, 'erro', left('Envio real sem resposta há mais de 1 hora · ' || e.nome, 140),
           'Pedido de ' || to_char(r.pedido_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '.',
           '/console/implantacao', 'envio_real_atraso:' || r.id
      from public.pedidos_envio_real r join public.empresas e on e.id = r.empresa_id
     where r.situacao = 'aberto' and r.pedido_em < now() - interval '1 hour'
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
    return n;
end $$;

-- ================================================================ permissões
do $$
declare f text;
begin
    foreach f in array array['public.primeiros_passos(bigint)', 'public.pular_primeiro_passo(bigint, text)',
                             'public.ocultar_primeiros_passos(boolean)', 'public.pedir_envio_real(bigint)',
                             'public.ligar_envio_real(bigint)', 'public.recusar_envio_real(bigint, text)',
                             'public.implantacao_empresas()'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
revoke all on function public.gerar_avisos_implantacao() from public, anon, authenticated;
grant execute on function public.gerar_avisos_implantacao() to service_role;
