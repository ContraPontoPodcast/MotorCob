-- SQL 106 · Agente de voz: medir o abandono certo, sem mudar o ritmo (Power e Preditivo, V1; PREDITIVO.md P4, P5,
-- P13, P15). Pré-requisito do Power (razão fixa) e do Preditivo (razão adaptativa): o controlador e a tela precisam de
-- uma taxa de abandono honesta, por janela, carteira e tronco.
--
-- 1. desfechos_voz(): + 'transferencia_sem_operador' (motor/voz.py › DESFECHOS, sem os internos, na mesma ordem;
--    tests/test_voz_banco.py confere). A pessoa conversou com o agente, pediu um humano e a fila do cliente não atendeu
--    (ou a transferência falhou) e o agente não pôde voltar. Antes isso era 'abandonada' e freava o discador da IA por
--    culpa da fila humana. Não é abandono (nem na meta, nem no freio) e não é chamada curta por si (houve conversa; só
--    pelos 6 s). Só acrescenta: nenhuma linha gravada deixa de valer.
-- 2. situacao_voz(): transferencia_sem_operador continua na linha "abandonada" da Renitência/Resubmit (=
--    motor/discagem.situacao_de): a regra por sinalização da carteira vale como antes, sem configuração nova.
--    regras_curtas_voz() não muda (o abandono que conta como curta segue abandonada + abandono_sem_robo).
-- 3. voz_ritmo_amostras: a VM grava a cada 5 min, por empresa × carteira × janela de 5 min (America/Sao_Paulo):
--    discadas (tentativas encerradas), atendidas por pessoa (AMD pessoa), abandonos (abandonada + abandono_sem_robo),
--    transferências sem operador, curtas, o modo e a razão usados e o retrato dos robôs (conversando, reservados,
--    linhas no ar), com o mesmo por tronco (por_tronco). Só contagens: nenhum telefone, cliente ou conversa. Soma na
--    mesma janela (VM reiniciada ou duas VMs não perdem nada). Guarda 35 dias (o relatório é de 30).
-- 4. registrar_ritmo_voz(linhas jsonb): só o servidor (modo chave) ou a VM (motorcx_voz, por voz_vm.registrar_ritmo).
-- 5. ritmo_voz_hoje(empresa, credor default null): a leitura das telas (Discagem › Ritmo e Ligações › faixa ao vivo,
--    V7): totais do dia e taxas (abandono, transferência sem operador, atendimento por pessoa, curtas), a última
--    amostra, as janelas de 30 min do dia, o dia por tronco (bina mascarada, nunca IP) e o abandono de 30 dias. Quem é
--    da empresa (minhas_empresas()) ou a equipe que cuida da voz dela.
-- Depende dos SQL 56/57 (voz, papel motorcx_voz), 91 (abandono_sem_robo) e 93 (hoje_sp). Rode ANTES de atualizar o
-- motor e as VMs de voz (a VM nova grava o desfecho novo e as amostras). Pode rodar de novo.

-- ================================================================ 1. desfechos de voz
create or replace function public.desfechos_voz() returns text[]
language sql immutable parallel safe as $$
    select array['numero_inexistente', 'nao_atendida', 'caixa_postal', 'atendida_sem_cpc',
                 'atendida_terceiro_desconhece', 'cpc', 'promessa', 'recusa', 'recado', 'ocupado', 'abandonada',
                 'falha_rede', 'opt_out', 'identidade_confirmada', 'maquina', 'desligou_sem_conversar',
                 'atendeu_desligou', 'retorno_agendado', 'falha_operadora', 'bloqueio_originacao',
                 'cancelada_discador', 'indisponivel', 'rejeitada', 'mudo', 'fax', 'abandono_sem_robo',
                 'transferencia_sem_operador']::text[]
$$;
comment on column public.voz_chamadas.resultado is
    'Desfecho final (motor/voz.classificar_chamada). Abandono = abandonada ou abandono_sem_robo (atendeu sem robô '
    'livre). transferencia_sem_operador (SQL 106) = conversou, pediu humano e a fila não atendeu: não é abandono.';

-- ================================================================ 2. desfecho -> situação (= motor/discagem.situacao_de)
create or replace function public.situacao_voz(resultado text, causa_sip int default null) returns text
language sql immutable parallel safe as $$
    select case
        when resultado in ('numero_inexistente', 'inexistente_voz', 'atendida_terceiro_desconhece') then 'numero_incorreto'
        when resultado = 'falha_operadora' and causa_sip = 402 then 'sem_credito'
        when resultado in ('abandono_sem_robo', 'transferencia_sem_operador') then 'abandonada'
        when resultado = any (public.situacoes_resubmit_voz()) then resultado
    end
$$;

revoke all on function public.desfechos_voz(), public.situacao_voz(text, int) from public, anon;
grant execute on function public.desfechos_voz(), public.situacao_voz(text, int) to authenticated, service_role;

-- ================================================================ 3. amostras do ritmo (a VM grava a cada 5 min)
create table if not exists public.voz_ritmo_amostras (
    id                  bigint generated always as identity primary key,
    empresa_id          bigint not null references public.empresas (id) on delete cascade,
    credor_id           bigint references public.credores (id) on delete cascade,
    credor_chave        bigint generated always as (coalesce(credor_id, 0)) stored,
    janela              timestamptz not null,          -- início da janela de 5 min
    dia                 date not null,                 -- dia da janela em America/Sao_Paulo
    modo                text not null default 'power' check (modo in ('power', 'preditivo')),
    razao               numeric(4, 2) not null default 1 check (razao between 1 and 3),
    discadas            int not null default 0 check (discadas between 0 and 1000000),
    atendidas_pessoa    int not null default 0 check (atendidas_pessoa between 0 and 1000000),
    abandonos           int not null default 0 check (abandonos between 0 and 1000000),
    transf_sem_operador int not null default 0 check (transf_sem_operador between 0 and 1000000),
    curtas              int not null default 0 check (curtas between 0 and 1000000),
    conversas           int not null default 0 check (conversas between 0 and 100000),
    reservas            int not null default 0 check (reservas between 0 and 100000),
    linhas              int not null default 0 check (linhas between 0 and 100000),
    por_tronco          jsonb not null default '[]'::jsonb check (jsonb_typeof(por_tronco) = 'array'),
    atualizado_em       timestamptz not null default now(),
    constraint voz_ritmo_amostras_janela unique (empresa_id, credor_chave, janela),
    constraint voz_ritmo_amostras_coerente check (atendidas_pessoa <= discadas and abandonos <= atendidas_pessoa
                                                  and curtas <= discadas)
);
create index if not exists voz_ritmo_amostras_dia on public.voz_ritmo_amostras (empresa_id, dia);
comment on table public.voz_ritmo_amostras is
    'Ritmo da discagem por empresa × carteira × janela de 5 min (a VM grava; só contagens). SQL 106.';
comment on column public.voz_ritmo_amostras.por_tronco is
    '[{tronco_id, discadas, atendidas_pessoa, abandonos, curtas}] da janela (só contagens).';

alter table public.voz_ritmo_amostras enable row level security;
drop policy if exists voz_ritmo_amostras_ver on public.voz_ritmo_amostras;
create policy voz_ritmo_amostras_ver on public.voz_ritmo_amostras for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) or public.cuida_voz(empresa_id));
revoke all on public.voz_ritmo_amostras from public, anon, authenticated;
grant select on public.voz_ritmo_amostras to authenticated, service_role;

-- ================================================================ 4. gravação (VM)
-- linhas: [{empresa_id, credor_id, janela, modo, razao, discadas, atendidas_pessoa, abandonos, transf_sem_operador,
--           curtas, conversas, reservas, linhas, por_tronco}]
-- interna (só registrar_ritmo_voz usa): derrubada e recriada para poder rodar de novo depois de um SQL que mude as colunas
drop function if exists public.ritmo_voz_linhas(jsonb);
create function public.ritmo_voz_linhas(linhas jsonb)
returns table (empresa_id bigint, credor_id bigint, janela timestamptz, modo text, razao numeric, discadas int,
               atendidas_pessoa int, abandonos int, transf_sem_operador int, curtas int, conversas int, reservas int,
               linhas_ar int, por_tronco jsonb)
language sql immutable set search_path = '' as $$
    select x.empresa_id, x.credor_id, x.janela, coalesce(x.modo, 'power'), coalesce(x.razao, 1),
           coalesce(x.discadas, 0), coalesce(x.atendidas_pessoa, 0), coalesce(x.abandonos, 0),
           coalesce(x.transf_sem_operador, 0), coalesce(x.curtas, 0), coalesce(x.conversas, 0),
           coalesce(x.reservas, 0), coalesce(x.linhas, 0), coalesce(x.por_tronco, '[]'::jsonb)
      from jsonb_to_recordset(ritmo_voz_linhas.linhas) as x(empresa_id bigint, credor_id bigint, janela timestamptz,
                                                            modo text, razao numeric, discadas int,
                                                            atendidas_pessoa int, abandonos int,
                                                            transf_sem_operador int, curtas int, conversas int,
                                                            reservas int, linhas int, por_tronco jsonb)
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
                   or jsonb_typeof(u.por_tronco) <> 'array' or jsonb_array_length(u.por_tronco) > 50) then
        raise exception 'linhas: empresa_id e janela (das últimas 48 h) obrigatórios; modo power|preditivo; razão de 1 a 3; contagens coerentes e não negativas; até 50 troncos';
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

    insert into public.voz_ritmo_amostras as a (empresa_id, credor_id, janela, dia, modo, razao, discadas,
                                                atendidas_pessoa, abandonos, transf_sem_operador, curtas, conversas,
                                                reservas, linhas, por_tronco, atualizado_em)
    select u.empresa_id, u.credor_id, date_trunc('minute', u.janela),
           (date_trunc('minute', u.janela) at time zone 'America/Sao_Paulo')::date, u.modo, round(u.razao, 2),
           u.discadas, u.atendidas_pessoa, u.abandonos, u.transf_sem_operador, u.curtas, u.conversas, u.reservas,
           u.linhas_ar, u.por_tronco, now()
      from public.ritmo_voz_linhas(l) u
    on conflict on constraint voz_ritmo_amostras_janela do update
       set modo = excluded.modo, razao = excluded.razao,
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

-- ================================================================ 5. leitura das telas
-- % com uma casa; null sem base (a tela mostra "—", nunca 0%)
create or replace function public.ritmo_pct(parte bigint, total bigint) returns numeric
language sql immutable parallel safe as $$
    select case when coalesce(total, 0) > 0 then round(100.0 * coalesce(parte, 0) / total, 1) end
$$;
revoke all on function public.ritmo_pct(bigint, bigint) from public, anon;
grant execute on function public.ritmo_pct(bigint, bigint) to authenticated, service_role;

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
        select janela, modo, razao,
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
        'ultima', (select jsonb_build_object('janela', janela, 'modo', modo, 'razao', razao, 'conversas', conversas,
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
