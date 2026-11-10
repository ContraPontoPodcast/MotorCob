-- SQL 102 · Agente de voz: uso dos robôs contratados (telemetria), PR 6 do plano "Robôs contratados" (SPEC §3.3).
-- A VM (agendador, que desde o PR 212 conta CONVERSAS: robôs ocupados = conversas + reservas) grava a cada 15 s, por
-- empresa: quantos robôs estão em uso agora e o maior uso desde a leitura anterior. Base de "em uso agora" e "pico hoje"
-- na Discagem do cliente e no Console (PR 7). Só contagens: nenhum telefone, cliente ou conteúdo de conversa.
--
-- 1. voz_robos_agora (uma linha por empresa, upsert): em_uso (robôs ocupados), conversas (só os conversando), linhas
--    (canais do cliente no ar), aguardando (números do dia que ainda esperam na lista), limite (o teto que a VM aplica
--    agora: o limite da divisão, ou menos com o freio de abandono), no_limite (em_uso >= limite) e atualizado_em.
--    Leitura mais velha que 60 s = "sem leitura agora" na tela (nunca zero).
-- 2. voz_robos_dia (empresa × dia de America/Sao_Paulo): pico (o maior uso do dia), pico_em e segundos_no_limite
--    (soma do tempo em que todos os robôs da empresa estavam ocupados; base do aviso "vale pedir mais robôs"). Guarda 400
--    dias.
-- 3. registrar_uso_robos_voz(linhas jsonb): só o servidor (modo chave da VM) ou a VM (motorcx_voz), por
--    voz_vm.registrar_uso_robos(args jsonb) no acesso próprio. Até 500 empresas por chamada; empresa precisa ter voz
--    configurada; números dentro de limites (nada negativo; segundos_no_limite até 120 por leitura).
-- 4. Leitura: quem é da empresa (minhas_empresas(), como voz_licenca_vigente) e a equipe que cuida da voz da empresa.
--    Ninguém grava pelo site.
-- Depende dos SQL 56/57 (voz, papel motorcx_voz) e 93 (hoje_sp). Pode rodar de novo.

-- ================================================================ 1. tabelas
create table if not exists public.voz_robos_agora (
    empresa_id    bigint primary key references public.empresas (id) on delete cascade,
    em_uso        int not null check (em_uso between 0 and 100000),
    conversas     int not null default 0 check (conversas between 0 and 100000),
    linhas        int not null default 0 check (linhas between 0 and 100000),
    aguardando    int not null default 0 check (aguardando between 0 and 10000000),
    limite        int not null check (limite between 0 and 100000),
    no_limite     boolean not null default false,
    atualizado_em timestamptz not null default now()
);
comment on table public.voz_robos_agora is
    'Robôs do Agente de voz em uso agora, por empresa (a VM grava a cada 15 s; mais velho que 60 s = sem leitura). SQL 102.';

create table if not exists public.voz_robos_dia (
    empresa_id         bigint not null references public.empresas (id) on delete cascade,
    dia                date not null,
    pico               int not null default 0 check (pico between 0 and 100000),
    pico_em            timestamptz,
    segundos_no_limite int not null default 0 check (segundos_no_limite between 0 and 86400),
    atualizado_em      timestamptz not null default now(),
    primary key (empresa_id, dia)
);
comment on table public.voz_robos_dia is
    'Pico de robôs em uso por empresa e dia (America/Sao_Paulo) e o tempo com todos ocupados. A VM grava. SQL 102.';

alter table public.voz_robos_agora enable row level security;
alter table public.voz_robos_dia enable row level security;
drop policy if exists voz_robos_agora_ver on public.voz_robos_agora;
create policy voz_robos_agora_ver on public.voz_robos_agora for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) or public.cuida_voz(empresa_id));
drop policy if exists voz_robos_dia_ver on public.voz_robos_dia;
create policy voz_robos_dia_ver on public.voz_robos_dia for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) or public.cuida_voz(empresa_id));
revoke all on public.voz_robos_agora, public.voz_robos_dia from public, anon, authenticated;
grant select on public.voz_robos_agora, public.voz_robos_dia to authenticated;
grant select on public.voz_robos_agora, public.voz_robos_dia to service_role;

-- ================================================================ 2. gravação (VM)
-- linhas: [{empresa_id, em_uso, conversas, linhas, aguardando, limite, pico, no_limite, segundos_no_limite}]
create or replace function public.uso_robos_voz_linhas(linhas jsonb)
returns table (empresa_id bigint, em_uso int, conversas int, linhas_ar int, aguardando int, limite int, pico int,
               no_limite boolean, segundos_no_limite int)
language sql immutable set search_path = '' as $$
    select x.empresa_id, x.em_uso, coalesce(x.conversas, 0), coalesce(x.linhas, 0), coalesce(x.aguardando, 0), x.limite,
           greatest(coalesce(x.pico, x.em_uso), x.em_uso), coalesce(x.no_limite, false), coalesce(x.segundos_no_limite, 0)
      from jsonb_to_recordset(uso_robos_voz_linhas.linhas) as x(empresa_id bigint, em_uso int, conversas int, linhas int,
                                                                aguardando int, limite int, pico int, no_limite boolean,
                                                                segundos_no_limite int)
$$;
revoke all on function public.uso_robos_voz_linhas(jsonb) from public, anon, authenticated;

create or replace function public.registrar_uso_robos_voz(linhas jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
    n int;
    hoje date := public.hoje_sp();
    l jsonb := registrar_uso_robos_voz.linhas;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    if l is null or jsonb_typeof(l) <> 'array' or jsonb_array_length(l) > 500 then
        raise exception 'linhas: lista de até 500 empresas';
    end if;
    if exists (select 1 from public.uso_robos_voz_linhas(l) u
                where u.empresa_id is null or u.em_uso is null or u.limite is null
                   or least(u.em_uso, u.conversas, u.linhas_ar, u.aguardando, u.limite, u.pico, u.segundos_no_limite) < 0
                   or greatest(u.em_uso, u.conversas, u.linhas_ar, u.limite, u.pico) > 100000
                   or u.aguardando > 10000000 or u.segundos_no_limite > 120) then
        raise exception 'linhas: empresa_id, em_uso e limite obrigatórios; números de 0 a 100000; segundos até 120';
    end if;
    if (select count(*) <> count(distinct u.empresa_id) from public.uso_robos_voz_linhas(l) u) then
        raise exception 'linhas: uma linha por empresa';
    end if;
    if exists (select 1 from public.uso_robos_voz_linhas(l) u
                where not exists (select 1 from public.voz_config c where c.empresa_id = u.empresa_id)) then
        raise exception 'empresa sem voz configurada';
    end if;

    insert into public.voz_robos_agora as a (empresa_id, em_uso, conversas, linhas, aguardando, limite, no_limite,
                                             atualizado_em)
    select u.empresa_id, u.em_uso, u.conversas, u.linhas_ar, u.aguardando, u.limite, u.no_limite, now()
      from public.uso_robos_voz_linhas(l) u
    on conflict on constraint voz_robos_agora_pkey do update
       set em_uso = excluded.em_uso, conversas = excluded.conversas, linhas = excluded.linhas,
           aguardando = excluded.aguardando, limite = excluded.limite, no_limite = excluded.no_limite,
           atualizado_em = now();
    get diagnostics n = row_count;

    insert into public.voz_robos_dia as d (empresa_id, dia, pico, pico_em, segundos_no_limite, atualizado_em)
    select u.empresa_id, hoje, u.pico, case when u.pico > 0 then now() end, u.segundos_no_limite, now()
      from public.uso_robos_voz_linhas(l) u
    on conflict on constraint voz_robos_dia_pkey do update
       set pico = greatest(d.pico, excluded.pico),
           pico_em = case when excluded.pico > d.pico then now() else d.pico_em end,
           segundos_no_limite = least(d.segundos_no_limite + excluded.segundos_no_limite, 86400),
           atualizado_em = now();

    -- guarda 400 dias (a tabela é pequena: empresas × dias)
    delete from public.voz_robos_dia d where d.dia < hoje - 400;
    return n;
end $$;
revoke all on function public.registrar_uso_robos_voz(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_uso_robos_voz(jsonb) to service_role;

-- a VM (motorcx_voz) não executa funções de public: a mesma gravação por uma função de voz_vm (corpo do PostgREST)
create or replace function voz_vm.registrar_uso_robos(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.registrar_uso_robos_voz(args -> 'linhas'))
$$;
revoke all on function voz_vm.registrar_uso_robos(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.registrar_uso_robos(jsonb) to motorcx_voz;
