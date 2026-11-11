-- SQL 108 · Agente de voz: Power e abandono digno (Power e Preditivo, V4; PREDITIVO.md 3.3, 3.5, P8, P9).
-- A VM passa a aplicar o ritmo da carteira (SQL 107): Power = razão fixa (linhas por robô livre). Este SQL dá ao banco o
-- que a VM e as telas precisam para isso:
--
-- 1. voz_ritmo_amostras: + razao_config (a razão escolhida na carteira) e estado (normal | aquecendo | reduzido | freado
--    | parado: a frase de estado das telas). razao continua sendo a razão que valeu de fato (com o freio, 1,0).
--    registrar_ritmo_voz, ritmo_voz_linhas (interna) e ritmo_voz_hoje são recriadas inteiras a partir do SQL 106 com os
--    dois campos (ritmo_voz_linhas muda de assinatura: drop + create; só registrar_ritmo_voz a usa).
-- 2. abandonos_recentes_voz(empresa): os clientes da empresa com abandono do discador (abandonada ou
--    abandono_sem_robo) nos últimos 7 dias, com quantos e o último dia. A VM usa ao carregar o lote: 2 abandonos em 7
--    dias = 3 dias sem voz desde o último; 1 = a próxima ligação só sai com robô reservado (ninguém atende sem agente
--    de novo). Só o servidor ou a VM (voz_vm.abandonos_recentes); devolve só id_cliente (o código do cliente, nunca
--    CPF) e contagens.
-- Depende do SQL 106. Pode rodar de novo.

-- ================================================================ 1. estado e razão escolhida nas amostras
alter table public.voz_ritmo_amostras add column if not exists razao_config numeric(4, 2)
    check (razao_config between 1 and 3);
alter table public.voz_ritmo_amostras add column if not exists estado text not null default 'normal'
    check (estado in ('normal', 'aquecendo', 'reduzido', 'freado', 'parado'));
comment on column public.voz_ritmo_amostras.razao is 'Razão (linhas por robô livre) que valeu na janela. SQL 106.';
comment on column public.voz_ritmo_amostras.razao_config is 'Razão escolhida na carteira (Power). SQL 108.';
comment on column public.voz_ritmo_amostras.estado is
    'normal | aquecendo (Preditivo juntando histórico) | reduzido (curtas) | freado (abandono no teto: 1,0 até o fim '
    'do dia) | parado (linha ou empresa parada pelas curtas). SQL 108.';

-- linhas: [{empresa_id, credor_id, janela, modo, razao, razao_config, estado, discadas, atendidas_pessoa, abandonos,
--           transf_sem_operador, curtas, conversas, reservas, linhas, por_tronco}]
-- a assinatura muda (razao_config e estado no fim): a função interna é derrubada e recriada
drop function if exists public.ritmo_voz_linhas(jsonb);
create function public.ritmo_voz_linhas(linhas jsonb)
returns table (empresa_id bigint, credor_id bigint, janela timestamptz, modo text, razao numeric, discadas int,
               atendidas_pessoa int, abandonos int, transf_sem_operador int, curtas int, conversas int, reservas int,
               linhas_ar int, por_tronco jsonb, razao_config numeric, estado text)
language sql immutable set search_path = '' as $$
    select x.empresa_id, x.credor_id, x.janela, coalesce(x.modo, 'power'), coalesce(x.razao, 1),
           coalesce(x.discadas, 0), coalesce(x.atendidas_pessoa, 0), coalesce(x.abandonos, 0),
           coalesce(x.transf_sem_operador, 0), coalesce(x.curtas, 0), coalesce(x.conversas, 0),
           coalesce(x.reservas, 0), coalesce(x.linhas, 0), coalesce(x.por_tronco, '[]'::jsonb), x.razao_config,
           coalesce(x.estado, 'normal')
      from jsonb_to_recordset(ritmo_voz_linhas.linhas) as x(empresa_id bigint, credor_id bigint, janela timestamptz,
                                                            modo text, razao numeric, discadas int,
                                                            atendidas_pessoa int, abandonos int,
                                                            transf_sem_operador int, curtas int, conversas int,
                                                            reservas int, linhas int, por_tronco jsonb,
                                                            razao_config numeric, estado text)
$$;
revoke all on function public.ritmo_voz_linhas(jsonb) from public, anon, authenticated;

create or replace function public.registrar_ritmo_voz(linhas jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
    n int;
    l jsonb := registrar_ritmo_voz.linhas;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    if l is null or jsonb_typeof(l) <> 'array' or jsonb_array_length(l) > 2000 then
        raise exception 'linhas: lista de até 2000 amostras';
    end if;
    if exists (select 1 from public.ritmo_voz_linhas(l) u
                where u.empresa_id is null or u.janela is null
                   or u.janela > now() + interval '10 minutes' or u.janela < now() - interval '2 days'
                   or u.modo not in ('power', 'preditivo') or u.razao < 1 or u.razao > 3
                   or least(u.discadas, u.atendidas_pessoa, u.abandonos, u.transf_sem_operador, u.curtas,
                            u.conversas, u.reservas, u.linhas_ar) < 0
                   or greatest(u.discadas, u.atendidas_pessoa, u.abandonos, u.transf_sem_operador, u.curtas) > 1000000
                   or greatest(u.conversas, u.reservas, u.linhas_ar) > 100000
                   or u.atendidas_pessoa > u.discadas or u.abandonos > u.atendidas_pessoa or u.curtas > u.discadas
                   or jsonb_typeof(u.por_tronco) <> 'array' or jsonb_array_length(u.por_tronco) > 50
                   or (u.razao_config is not null and (u.razao_config < 1 or u.razao_config > 3))
                   or u.estado not in ('normal', 'aquecendo', 'reduzido', 'freado', 'parado')) then
        raise exception 'linhas: empresa_id e janela (das últimas 48 h) obrigatórios; modo power|preditivo; razão de 1 a 3; estado normal|aquecendo|reduzido|freado|parado; contagens coerentes e não negativas; até 50 troncos';
    end if;
    if exists (select 1 from public.ritmo_voz_linhas(l) u, jsonb_array_elements(u.por_tronco) t
                where jsonb_typeof(t) <> 'object' or jsonb_typeof(t -> 'tronco_id') <> 'number'
                   or exists (select 1 from jsonb_each(t) k
                               where k.key not in ('tronco_id', 'discadas', 'atendidas_pessoa', 'abandonos', 'curtas')
                                  or jsonb_typeof(k.value) <> 'number' or (k.value #>> '{}')::numeric < 0)) then
        raise exception 'por_tronco: [{tronco_id, discadas, atendidas_pessoa, abandonos, curtas}] (só contagens)';
    end if;
    if (select count(*) <> count(distinct (u.empresa_id, coalesce(u.credor_id, 0), u.janela))
          from public.ritmo_voz_linhas(l) u) then
        raise exception 'linhas: uma por empresa, carteira e janela';
    end if;
    if exists (select 1 from public.ritmo_voz_linhas(l) u
                where not exists (select 1 from public.voz_config c where c.empresa_id = u.empresa_id)
                   or (u.credor_id is not null and not exists (select 1 from public.credores cr
                                                                where cr.id = u.credor_id
                                                                  and cr.empresa_id = u.empresa_id))) then
        raise exception 'empresa sem voz configurada ou carteira de outra empresa';
    end if;

    insert into public.voz_ritmo_amostras as a (empresa_id, credor_id, janela, dia, modo, razao, razao_config, estado,
                                                discadas, atendidas_pessoa, abandonos, transf_sem_operador, curtas,
                                                conversas, reservas, linhas, por_tronco, atualizado_em)
    select u.empresa_id, u.credor_id, date_trunc('minute', u.janela),
           (date_trunc('minute', u.janela) at time zone 'America/Sao_Paulo')::date, u.modo, round(u.razao, 2),
           round(u.razao_config, 2), u.estado,
           u.discadas, u.atendidas_pessoa, u.abandonos, u.transf_sem_operador, u.curtas, u.conversas, u.reservas,
           u.linhas_ar, u.por_tronco, now()
      from public.ritmo_voz_linhas(l) u
    on conflict on constraint voz_ritmo_amostras_janela do update
       set modo = excluded.modo, razao = excluded.razao, razao_config = excluded.razao_config,
           estado = excluded.estado,
           discadas = least(a.discadas + excluded.discadas, 1000000),
           atendidas_pessoa = least(a.atendidas_pessoa + excluded.atendidas_pessoa, 1000000),
           abandonos = least(a.abandonos + excluded.abandonos, 1000000),
           transf_sem_operador = least(a.transf_sem_operador + excluded.transf_sem_operador, 1000000),
           curtas = least(a.curtas + excluded.curtas, 1000000),
           conversas = excluded.conversas, reservas = excluded.reservas, linhas = excluded.linhas,
           por_tronco = (select coalesce(jsonb_agg(jsonb_build_object(
                                     'tronco_id', t.tronco_id, 'discadas', t.discadas,
                                     'atendidas_pessoa', t.atendidas_pessoa, 'abandonos', t.abandonos,
                                     'curtas', t.curtas) order by t.tronco_id), '[]'::jsonb)
                           from (select (x ->> 'tronco_id')::bigint as tronco_id,
                                        sum(coalesce((x ->> 'discadas')::int, 0)) as discadas,
                                        sum(coalesce((x ->> 'atendidas_pessoa')::int, 0)) as atendidas_pessoa,
                                        sum(coalesce((x ->> 'abandonos')::int, 0)) as abandonos,
                                        sum(coalesce((x ->> 'curtas')::int, 0)) as curtas
                                   from jsonb_array_elements(a.por_tronco || excluded.por_tronco) x
                                  group by 1) t),
           atualizado_em = now();
    get diagnostics n = row_count;

    -- guarda 35 dias (o relatório de abandono é de 30)
    delete from public.voz_ritmo_amostras v where v.dia < public.hoje_sp() - 35;
    return n;
end $$;
revoke all on function public.registrar_ritmo_voz(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_ritmo_voz(jsonb) to service_role;

-- a VM (motorcx_voz) não executa funções de public: a mesma gravação por uma função de voz_vm (corpo do PostgREST)
create or replace function voz_vm.registrar_ritmo(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.registrar_ritmo_voz(args -> 'linhas'))
$$;
revoke all on function voz_vm.registrar_ritmo(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.registrar_ritmo(jsonb) to motorcx_voz;

-- ================================================================ 2. leitura das telas (ritmo_voz_hoje com o estado)
create or replace function public.ritmo_voz_hoje(empresa bigint, credor bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    hoje date := public.hoje_sp();
    r jsonb;
begin
    if not (public.chamada_do_servidor() or empresa in (select public.minhas_empresas()) or public.cuida_voz(empresa)) then
        raise exception 'sem acesso à empresa';
    end if;
    with a as (
        select * from public.voz_ritmo_amostras v
         where v.empresa_id = ritmo_voz_hoje.empresa and v.dia = hoje
           and (ritmo_voz_hoje.credor is null or v.credor_id = ritmo_voz_hoje.credor)
    ), tot as (
        select coalesce(sum(discadas), 0) d, coalesce(sum(atendidas_pessoa), 0) p, coalesce(sum(abandonos), 0) ab,
               coalesce(sum(transf_sem_operador), 0) tf, coalesce(sum(curtas), 0) c
          from a
    ), j30 as (
        select to_timestamp(floor(extract(epoch from janela) / 1800) * 1800) as inicio,
               sum(discadas) d, sum(atendidas_pessoa) p, sum(abandonos) ab, sum(curtas) c, max(razao) razao
          from a group by 1
    ), ult as (
        select janela, modo, razao, razao_config, estado,
               (select sum(x.conversas) from a x where x.janela = m.janela) conversas,
               (select sum(x.reservas) from a x where x.janela = m.janela) reservas,
               (select sum(x.linhas) from a x where x.janela = m.janela) linhas
          from (select * from a order by janela desc, credor_chave limit 1) m
    ), tr as (
        select (x ->> 'tronco_id')::bigint tronco_id, sum((x ->> 'discadas')::int) d,
               sum((x ->> 'atendidas_pessoa')::int) p, sum((x ->> 'abandonos')::int) ab, sum((x ->> 'curtas')::int) c
          from a, jsonb_array_elements(a.por_tronco) x group by 1
    ), m30 as (
        select coalesce(sum(atendidas_pessoa), 0) p, coalesce(sum(abandonos), 0) ab,
               coalesce(sum(transf_sem_operador), 0) tf
          from public.voz_ritmo_amostras v
         where v.empresa_id = ritmo_voz_hoje.empresa and v.dia > hoje - 30
           and (ritmo_voz_hoje.credor is null or v.credor_id = ritmo_voz_hoje.credor)
    )
    select jsonb_build_object(
        'dia', hoje,
        'totais', (select jsonb_build_object('discadas', d, 'atendidas_pessoa', p, 'abandonos', ab,
                                             'transf_sem_operador', tf, 'curtas', c,
                                             'atendimento_pct', public.ritmo_pct(p, d),
                                             'abandono_pct', public.ritmo_pct(ab, p),
                                             'transf_sem_operador_pct', public.ritmo_pct(tf, p),
                                             'curtas_pct', public.ritmo_pct(c, d)) from tot),
        'ultima', (select jsonb_build_object('janela', janela, 'modo', modo, 'razao', razao,
                                             'razao_config', razao_config, 'estado', estado, 'conversas', conversas,
                                             'reservas', reservas, 'linhas', linhas) from ult),
        'janelas', coalesce((select jsonb_agg(jsonb_build_object(
                        'inicio', inicio, 'discadas', d, 'atendidas_pessoa', p, 'abandonos', ab, 'curtas', c,
                        'razao', razao, 'atendimento_pct', public.ritmo_pct(p, d),
                        'abandono_pct', public.ritmo_pct(ab, p), 'curtas_pct', public.ritmo_pct(c, d))
                        order by inicio) from j30), '[]'::jsonb),
        'por_tronco', coalesce((select jsonb_agg(jsonb_build_object(
                        'tronco_id', tr.tronco_id,
                        'bina', case when t.bina is null then null
                                     else left(t.bina, 2) || ' ' || left(substr(t.bina, 3), 1) || '•••-••'
                                          || right(t.bina, 2) end,
                        'discadas', d, 'atendidas_pessoa', p, 'abandonos', ab, 'curtas', c,
                        'abandono_pct', public.ritmo_pct(ab, p), 'curtas_pct', public.ritmo_pct(c, d))
                        order by tr.tronco_id)
                          from tr left join public.voz_troncos t on t.id = tr.tronco_id
                                                               and t.empresa_id = ritmo_voz_hoje.empresa), '[]'::jsonb),
        'abandono_30d', (select jsonb_build_object('atendidas_pessoa', p, 'abandonos', ab, 'transf_sem_operador', tf,
                                                   'abandono_pct', public.ritmo_pct(ab, p)) from m30)
    ) into r;
    return r;
end $$;
revoke all on function public.ritmo_voz_hoje(bigint, bigint) from public, anon;
grant execute on function public.ritmo_voz_hoje(bigint, bigint) to authenticated, service_role;

-- ================================================================ 3. abandonos recentes por cliente (a VM, ao carregar o lote)
create or replace function public.abandonos_recentes_voz(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('id_cliente', x.id_cliente, 'abandonos', x.n, 'ultimo', x.ultimo)
                         order by x.id_cliente)
          from (select c.id_cliente, count(*) as n, max((c.ocorrido_em at time zone 'America/Sao_Paulo')::date) as ultimo
                  from public.voz_chamadas c
                 where c.empresa_id = abandonos_recentes_voz.empresa
                   and c.ocorrido_em >= (public.hoje_sp() - 7)::timestamp at time zone 'America/Sao_Paulo'
                   and c.resultado in ('abandonada', 'abandono_sem_robo')
                 group by c.id_cliente
                 limit 100000) x), '[]'::jsonb);
end $$;
revoke all on function public.abandonos_recentes_voz(bigint) from public, anon, authenticated;
grant execute on function public.abandonos_recentes_voz(bigint) to service_role;

create or replace function voz_vm.abandonos_recentes(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.abandonos_recentes_voz((args ->> 'empresa')::bigint)
$$;
revoke all on function voz_vm.abandonos_recentes(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.abandonos_recentes(jsonb) to motorcx_voz;
