-- Rotas da mensageria por % de tráfego e por operadora, regras de cobrança de SMS e RCS, custo por fornecedor e
-- margem de contribuição (%MC) por cliente.
-- * Plano de rota: nome + canal + linhas (fornecedor, % do tráfego, ordem de reserva). No SMS cada linha pode valer
--   para uma operadora (vivo, claro, tim, oi, outras): a mensagem usa as linhas da operadora do número e, se a
--   operadora não tiver linha própria, as linhas "todas" (operadora vazia). Em cada grupo a soma é 100; 0% = só
--   reserva. Um plano por canal é o PADRÃO; a equipe troca o plano de cada empresa (definir_rota_empresa).
-- * Operadora: o motor consulta o número (portabilidade) antes do SMS e guarda o resultado 30 dias, só pelo hash
--   do número. Número inválido na consulta não é enviado.
-- * SMS: até 160 caracteres. Cada resposta do cliente é cobrada pelo preço do SMS.
-- * RCS: Basic (texto até 160 caracteres) ou Single (acima disso ou com card). Agente conversacional: quando o
--   cliente responde, aquele envio deixa de ser Basic/Single e vira uma sessão Conversacional; por 24 horas as
--   mensagens para o mesmo número não custam nada a mais. Agente não conversacional: só Basic/Single.
-- * Custos dos fornecedores por item, com vigência. O motor grava, por empresa e mês, o que cada fornecedor enviou
--   por item e operadora, com o custo do dia (simulado e real separados).
-- * margem_mensageria(competência): por empresa e canal, receita (preços do cliente, com faixas), impostos, custo, MC e %MC,
--   com o plano em uso e a abertura por item, fornecedor e operadora. simular_plano(): o %MC com outro plano e o
--   mesmo volume. Parâmetros (impostos, meta e mínimo de %MC) em parametros_margem. Custo e margem: só o Master.
-- * As rotas antigas (principal/reserva) viram planos: principal com 100%, reservas com 0%.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- RCS no lote; tipo e operadora na mensagem
alter table public.mensageria_lotes drop constraint if exists mensageria_lotes_canal_check;
alter table public.mensageria_lotes add constraint mensageria_lotes_canal_check check (canal in ('sms', 'email', 'rcs'));
alter table public.mensageria_mensagens add column if not exists item text
    check (item is null or item in ('sms', 'email', 'rcs_basic', 'rcs_single', 'rcs_conversacional', 'rcs_sessao'));
alter table public.mensageria_mensagens add column if not exists operadora text
    check (operadora is null or operadora in ('vivo', 'claro', 'tim', 'oi', 'outras', 'invalido'));
alter table public.mensageria_mensagens add column if not exists respondida_em timestamptz;
alter table public.mensageria_lotes add column if not exists respostas int not null default 0;
comment on column public.mensageria_mensagens.item is
    'Como o envio é cobrado: sms, email, rcs_basic, rcs_single, rcs_conversacional (respondeu) ou rcs_sessao (dentro de 24 h, sem custo).';

alter table public.mensageria_config add column if not exists rcs_agente text not null default 'nao_conversacional';
alter table public.mensageria_config drop constraint if exists mensageria_config_rcs_agente_check;
alter table public.mensageria_config add constraint mensageria_config_rcs_agente_check
    check (rcs_agente in ('conversacional', 'nao_conversacional'));
comment on column public.mensageria_config.rcs_agente is
    'Agente RCS da empresa. Conversacional: resposta do cliente abre sessão de 24 h cobrada como Conversacional.';

alter table public.mensageria_fornecedores add column if not exists consulta_operadora boolean not null default false;
comment on column public.mensageria_fornecedores.consulta_operadora is 'Fornecedor usado para consultar a operadora do número.';

-- ---------------------------------------------------------------- operadora do número (cache, só o motor)
create table if not exists public.mensageria_operadoras (
    destino_hash   text primary key check (destino_hash ~ '^[0-9a-f]{64}$'),
    operadora      text not null check (operadora in ('vivo', 'claro', 'tim', 'oi', 'outras', 'invalido')),
    consultado_em  timestamptz not null default now()
);
alter table public.mensageria_operadoras enable row level security;
revoke all on public.mensageria_operadoras from anon, authenticated;

-- sessões de conversa do RCS (24 h), só o motor
create table if not exists public.mensageria_sessoes_rcs (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    destino_hash  text not null check (destino_hash ~ '^[0-9a-f]{64}$'),
    inicio        timestamptz not null,
    fim           timestamptz not null,
    primary key (empresa_id, destino_hash, inicio)
);
create index if not exists mensageria_sessoes_abertas on public.mensageria_sessoes_rcs (empresa_id, fim);
alter table public.mensageria_sessoes_rcs enable row level security;
revoke all on public.mensageria_sessoes_rcs from anon, authenticated;

-- ---------------------------------------------------------------- planos de rota
create table if not exists public.mensageria_planos_rota (
    id             bigint generated always as identity primary key,
    nome           text not null check (length(trim(nome)) between 2 and 60),
    canal          text not null check (canal in ('sms', 'email', 'rcs', 'whatsapp')),
    padrao         boolean not null default false,
    ativo          boolean not null default true,
    descricao      text check (descricao is null or length(descricao) <= 300),
    criado_em      timestamptz not null default now(),
    atualizado_em  timestamptz not null default now(),
    unique (canal, nome)
);
create unique index if not exists mensageria_planos_um_padrao on public.mensageria_planos_rota (canal) where padrao;

create table if not exists public.mensageria_plano_fornecedores (
    id             bigint generated always as identity primary key,
    plano_id       bigint not null references public.mensageria_planos_rota (id) on delete cascade,
    operadora      text check (operadora is null or operadora in ('vivo', 'claro', 'tim', 'oi', 'outras')),
    fornecedor     text not null references public.mensageria_fornecedores (codigo),
    percentual     numeric(5, 2) not null check (percentual between 0 and 100),
    ordem_reserva  int not null default 1 check (ordem_reserva between 1 and 10)
);
create unique index if not exists mensageria_plano_linha_unica
    on public.mensageria_plano_fornecedores (plano_id, coalesce(operadora, ''), fornecedor);
comment on column public.mensageria_plano_fornecedores.operadora is
    'Só SMS: a linha vale para esta operadora. Vazio = todas as operadoras sem linha própria.';

create table if not exists public.mensageria_rota_empresa (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    canal           text not null check (canal in ('sms', 'email', 'rcs', 'whatsapp')),
    plano_id        bigint not null references public.mensageria_planos_rota (id),
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (empresa_id, canal)
);

-- ---------------------------------------------------------------- custos dos fornecedores (com vigência)
create table if not exists public.mensageria_custos (
    id             bigint generated always as identity primary key,
    fornecedor     text not null references public.mensageria_fornecedores (codigo),
    item           text not null check (item in ('sms', 'sms_resposta', 'consulta_operadora', 'email', 'rcs_basic',
                                                 'rcs_single', 'rcs_conversacional', 'whatsapp_marketing',
                                                 'whatsapp_utilidade', 'whatsapp_servico')),
    custo          numeric(12, 5) not null check (custo >= 0),
    vigente_desde  date not null default current_date,
    criado_em      timestamptz not null default now(),
    unique (fornecedor, item, vigente_desde)
);
comment on column public.mensageria_custos.custo is
    'Custo MotorCob por unidade: mensagem, resposta de SMS, consulta de operadora ou sessão Conversacional do RCS.';

create or replace function public.custo_vigente(forn text, it text, dia date) returns numeric
language sql stable set search_path = public as $$
    select c.custo from public.mensageria_custos c
     where c.fornecedor = forn and c.item = it and c.vigente_desde <= dia
     order by c.vigente_desde desc limit 1
$$;

-- ---------------------------------------------------------------- o que cada fornecedor enviou (o motor grava)
create table if not exists public.mensageria_consumo_fornecedor (
    empresa_id            bigint not null references public.empresas (id) on delete cascade,
    competencia           date not null check (extract(day from competencia) = 1),
    item                  text not null,
    fornecedor            text not null,
    operadora             text not null default '',
    modo                  text not null check (modo in ('simulado', 'real')),
    quantidade            bigint not null default 0 check (quantidade >= 0),
    quantidade_sem_custo  bigint not null default 0 check (quantidade_sem_custo >= 0),
    custo                 numeric(14, 5) not null default 0 check (custo >= 0),
    atualizado_em         timestamptz not null default now(),
    primary key (empresa_id, competencia, item, fornecedor, operadora, modo)
);
comment on table public.mensageria_consumo_fornecedor is
    'Quantidade e custo por fornecedor, item e operadora no mês. Itens: sms, sms_resposta, consulta_operadora, email, '
    'rcs_basic, rcs_single, rcs_conversacional, rcs_sessao (sem custo).';

-- ---------------------------------------------------------------- parâmetros da margem
create table if not exists public.parametros_margem (
    id             int primary key default 1 check (id = 1),
    impostos_pct   numeric(5, 2) not null default 0 check (impostos_pct between 0 and 100),
    mc_meta_pct    numeric(5, 2) not null default 40 check (mc_meta_pct between -100 and 100),
    mc_minimo_pct  numeric(5, 2) not null default 20 check (mc_minimo_pct between -100 and 100),
    atualizado_em  timestamptz not null default now(),
    check (mc_minimo_pct <= mc_meta_pct)
);
comment on column public.parametros_margem.impostos_pct is 'Impostos sobre a receita da mensageria (%), descontados na MC.';
insert into public.parametros_margem (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- validações
create or replace function public.validar_plano_fornecedor() returns trigger
language plpgsql set search_path = public as $$
declare c text;
begin
    select canal into c from public.mensageria_planos_rota where id = new.plano_id;
    if not exists (select 1 from public.mensageria_fornecedores f where f.codigo = new.fornecedor and c = any (f.canais)) then
        raise exception 'o fornecedor % não está habilitado para o canal %', new.fornecedor, c;
    end if;
    if new.operadora is not null and c <> 'sms' then
        raise exception 'rota por operadora só existe no SMS';
    end if;
    return new;
end $$;
drop trigger if exists validar_plano_fornecedor on public.mensageria_plano_fornecedores;
create trigger validar_plano_fornecedor before insert or update on public.mensageria_plano_fornecedores
    for each row execute function public.validar_plano_fornecedor();

create or replace function public.validar_rota_empresa() returns trigger
language plpgsql set search_path = public as $$
begin
    if not exists (select 1 from public.mensageria_planos_rota p where p.id = new.plano_id and p.canal = new.canal
                   and p.ativo) then
        raise exception 'o plano escolhido não é do canal % ou está desativado', new.canal;
    end if;
    return new;
end $$;
drop trigger if exists validar_rota_empresa on public.mensageria_rota_empresa;
create trigger validar_rota_empresa before insert or update on public.mensageria_rota_empresa
    for each row execute function public.validar_rota_empresa();

-- ---------------------------------------------------------------- salvar plano (só o Master; 100% por grupo)
-- itens: [{"fornecedor": "zenvia", "percentual": 60, "ordem_reserva": 1, "operadora": "vivo"}, ...]
-- (operadora omitida ou nula = todas as operadoras sem linha própria; obrigatório ter esse grupo)
create or replace function public.salvar_plano_rota(plano bigint, nome text, canal text, itens jsonb,
                                                    padrao boolean default false, descricao text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    pid bigint := plano;
    g record;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob altera rotas';
    end if;
    if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then
        raise exception 'informe pelo menos um fornecedor';
    end if;
    if exists (select 1 from jsonb_array_elements(itens) i
                group by coalesce(i ->> 'operadora', ''), i ->> 'fornecedor' having count(*) > 1) then
        raise exception 'fornecedor repetido na mesma operadora';
    end if;
    if not exists (select 1 from jsonb_array_elements(itens) i where coalesce(i ->> 'operadora', '') = '') then
        raise exception 'o plano precisa de uma rota para "todas as operadoras" (as que não tiverem rota própria)';
    end if;
    for g in select coalesce(nullif(i ->> 'operadora', ''), 'todas') as op, sum((i ->> 'percentual')::numeric) as soma
               from jsonb_array_elements(itens) i group by 1 loop
        if g.soma <> 100 then
            raise exception 'a soma dos percentuais de % precisa ser 100 (está em %)', g.op, g.soma;
        end if;
    end loop;
    if pid is null then
        insert into public.mensageria_planos_rota (nome, canal, descricao)
        values (trim(salvar_plano_rota.nome), salvar_plano_rota.canal, salvar_plano_rota.descricao)
        returning id into pid;
    else
        if exists (select 1 from public.mensageria_planos_rota p where p.id = pid and p.canal <> salvar_plano_rota.canal) then
            raise exception 'o canal de um plano não muda; crie um plano novo';
        end if;
        update public.mensageria_planos_rota p set nome = trim(salvar_plano_rota.nome),
               descricao = salvar_plano_rota.descricao, atualizado_em = now()
         where p.id = pid;
        if not found then
            raise exception 'plano não encontrado';
        end if;
    end if;
    delete from public.mensageria_plano_fornecedores where plano_id = pid;
    insert into public.mensageria_plano_fornecedores (plano_id, operadora, fornecedor, percentual, ordem_reserva)
    select pid, nullif(i ->> 'operadora', ''), i ->> 'fornecedor', (i ->> 'percentual')::numeric,
           coalesce((i ->> 'ordem_reserva')::int, 1)
      from jsonb_array_elements(itens) i;
    if salvar_plano_rota.padrao then
        update public.mensageria_planos_rota p set padrao = false
         where p.canal = salvar_plano_rota.canal and p.padrao and p.id <> pid;
        update public.mensageria_planos_rota p set padrao = true, ativo = true where p.id = pid;
    end if;
    return pid;
end $$;
revoke execute on function public.salvar_plano_rota(bigint, text, text, jsonb, boolean, text) from public, anon;
grant execute on function public.salvar_plano_rota(bigint, text, text, jsonb, boolean, text) to authenticated;

-- desativar (ou reativar) um plano: o padrão e um plano em uso não desativam
create or replace function public.ativar_plano_rota(plano bigint, ativo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob altera rotas';
    end if;
    if not ativo and exists (select 1 from public.mensageria_planos_rota p where p.id = plano and p.padrao) then
        raise exception 'o plano padrão não pode ser desativado: escolha outro padrão antes';
    end if;
    if not ativo and exists (select 1 from public.mensageria_rota_empresa r where r.plano_id = plano) then
        raise exception 'há empresas usando este plano: mude a rota delas antes';
    end if;
    update public.mensageria_planos_rota p set ativo = ativar_plano_rota.ativo, atualizado_em = now() where p.id = plano;
    if not found then
        raise exception 'plano não encontrado';
    end if;
end $$;
revoke execute on function public.ativar_plano_rota(bigint, boolean) from public, anon;
grant execute on function public.ativar_plano_rota(bigint, boolean) to authenticated;

-- plano da empresa no canal (plano nulo = volta ao padrão)
create or replace function public.definir_rota_empresa(empresa bigint, canal text, plano bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob altera rotas';
    end if;
    if plano is null then
        delete from public.mensageria_rota_empresa r where r.empresa_id = empresa and r.canal = definir_rota_empresa.canal;
        return;
    end if;
    insert into public.mensageria_rota_empresa (empresa_id, canal, plano_id, atualizado_por)
    values (empresa, canal, plano, auth.uid())
    on conflict on constraint mensageria_rota_empresa_pkey do update set plano_id = excluded.plano_id, atualizado_em = now(),
                                                  atualizado_por = auth.uid();
end $$;
revoke execute on function public.definir_rota_empresa(bigint, text, bigint) from public, anon;
grant execute on function public.definir_rota_empresa(bigint, text, bigint) to authenticated;

-- ---------------------------------------------------------------- canal de cada item
create or replace function public.canal_do_item(it text) returns text
language sql immutable as $$
    select case when it in ('sms', 'sms_resposta', 'consulta_operadora') then 'sms'
                when it like 'rcs%' then 'rcs' when it like 'whatsapp%' then 'whatsapp' else it end
$$;

-- receita de um canal no mês pelos preços da empresa (flat, faixa, progressivo; sem mínimo e sem mensalidade).
-- Resposta de SMS soma no volume do SMS; sessão do RCS e consulta de operadora não têm preço.
create or replace function public.receita_canal(empresa bigint, canal text, competencia date, modo text)
returns table (receita numeric, falta_preco boolean, itens jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
    comp date := date_trunc('month', competencia)::date;
begin
    return query
    with vol as (
        select coalesce(ci.preco_de, ci.codigo) as base, sum(c.quantidade) as qtd
          from public.mensageria_consumo_fornecedor c
          join public.cobranca_itens ci on ci.codigo = c.item
         where c.empresa_id = empresa and c.competencia = comp and c.modo = receita_canal.modo
           and public.canal_do_item(c.item) = receita_canal.canal
         group by 1
    ), val as (
        select v.base, v.qtd, x.valor, x.preco_medio, x.modelo
          from vol v left join lateral public.valor_item(empresa, v.base, v.qtd, comp) x on true
    )
    select coalesce(sum(val.valor), 0), coalesce(bool_or(val.valor is null and val.qtd > 0), false),
           coalesce(jsonb_object_agg(val.base, jsonb_build_object('quantidade', val.qtd, 'receita', val.valor,
                                                                  'preco_medio', val.preco_medio,
                                                                  'modelo', val.modelo)), '{}'::jsonb)
      from val;
end $$;
revoke execute on function public.receita_canal(bigint, text, date, text) from public, anon;

-- ---------------------------------------------------------------- margem por empresa e canal
create or replace function public.margem_mensageria(competencia date, modo text default 'real')
returns table (empresa_id bigint, empresa text, canal text, plano text, plano_proprio boolean, envios bigint,
               respostas bigint, receita numeric, impostos numeric, custo numeric, mc numeric, mc_pct numeric,
               situacao text, sem_custo bigint, receita_itens jsonb, custo_itens jsonb, fornecedores jsonb,
               operadoras jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
    par public.parametros_margem;
    comp date := date_trunc('month', competencia)::date;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê a margem';
    end if;
    select * into par from public.parametros_margem where id = 1;
    return query
    with linhas as (
        select c.empresa_id as eid, public.canal_do_item(c.item) as cn, c.item as it, c.fornecedor as forn,
               c.operadora as op, c.quantidade as qtd, c.quantidade_sem_custo as semc, c.custo as cst
          from public.mensageria_consumo_fornecedor c
         where c.competencia = comp and c.modo = margem_mensageria.modo
    ), por_canal as (
        select l.eid, l.cn,
               coalesce(sum(l.qtd) filter (where l.it not in ('sms_resposta', 'consulta_operadora')), 0)::bigint as env,
               coalesce(sum(l.qtd) filter (where l.it = 'sms_resposta'), 0)::bigint as resp,
               sum(l.cst) as cst, sum(l.semc)::bigint as semc
          from linhas l group by l.eid, l.cn
    ), por_item as (
        select x.eid, x.cn, jsonb_object_agg(x.it, jsonb_build_object('quantidade', x.q, 'custo', round(x.c, 2))) as j
          from (select eid, cn, it, sum(qtd) as q, sum(cst) as c from linhas group by 1, 2, 3) x
         group by x.eid, x.cn
    ), forn as (
        select x.eid, x.cn, jsonb_object_agg(x.forn, jsonb_build_object('quantidade', x.q, 'custo', round(x.c, 2))) as j
          from (select eid, cn, forn, sum(qtd) as q, sum(cst) as c from linhas
                 where it <> 'consulta_operadora' group by 1, 2, 3) x
         group by x.eid, x.cn
    ), oper as (
        select x.eid, x.cn, jsonb_object_agg(x.op, jsonb_build_object('quantidade', x.q, 'custo', round(x.c, 2))) as j
          from (select eid, cn, op, sum(qtd) as q, sum(cst) as c from linhas
                 where op <> '' and it = 'sms' group by 1, 2, 3) x
         group by x.eid, x.cn
    ), calc as (
        select p.*, r.receita as rec, r.falta_preco as falta, r.itens as rits
          from por_canal p cross join lateral public.receita_canal(p.eid, p.cn, comp, margem_mensageria.modo) r
    )
    select k.eid, e.nome, k.cn, coalesce(pp.nome, pd.nome), pp.id is not null, k.env, k.resp,
           k.rec, round(k.rec * par.impostos_pct / 100, 2), round(k.cst, 2),
           round(k.rec - k.rec * par.impostos_pct / 100 - k.cst, 2),
           case when k.rec > 0 then round((k.rec - k.rec * par.impostos_pct / 100 - k.cst) / k.rec * 100, 1) end,
           case when k.falta then 'sem_preco'
                when k.rec = 0 then 'sem_receita'
                when (k.rec - k.rec * par.impostos_pct / 100 - k.cst) / k.rec * 100 < par.mc_minimo_pct then 'abaixo_minimo'
                when (k.rec - k.rec * par.impostos_pct / 100 - k.cst) / k.rec * 100 < par.mc_meta_pct then 'abaixo_meta'
                else 'ok' end,
           k.semc, k.rits, i.j, f.j, o.j
      from calc k
      join public.empresas e on e.id = k.eid
      left join por_item i on i.eid = k.eid and i.cn = k.cn
      left join forn f on f.eid = k.eid and f.cn = k.cn
      left join oper o on o.eid = k.eid and o.cn = k.cn
      left join public.mensageria_rota_empresa re on re.empresa_id = k.eid and re.canal = k.cn
      left join public.mensageria_planos_rota pp on pp.id = re.plano_id
      left join public.mensageria_planos_rota pd on pd.canal = k.cn and pd.padrao
     order by 12 nulls first, e.nome, k.cn;
end $$;
revoke execute on function public.margem_mensageria(date, text) from public, anon;
grant execute on function public.margem_mensageria(date, text) to authenticated;

-- ---------------------------------------------------------------- simular outro plano com o mesmo volume
-- recalcula o custo dos envios pelo plano (por item e operadora); respostas, consultas e sessões ficam como estão
create or replace function public.simular_plano(empresa bigint, canal text, plano bigint, competencia date,
                                                modo text default 'real')
returns table (envios bigint, receita numeric, impostos numeric, custo_atual numeric, custo_simulado numeric,
               mc_atual_pct numeric, mc_simulado_pct numeric, fornecedores_sem_custo text)
language plpgsql stable security definer set search_path = public as $$
declare
    par public.parametros_margem;
    comp date := date_trunc('month', competencia)::date;
    dia date := least(current_date, (date_trunc('month', competencia) + interval '1 month - 1 day')::date);
    env bigint;
    rec numeric;
    imp numeric;
    atual numeric;
    fixo numeric;
    novo numeric;
    faltam text;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob simula rotas';
    end if;
    if not exists (select 1 from public.mensageria_planos_rota p where p.id = plano and p.canal = simular_plano.canal) then
        raise exception 'o plano não é do canal %', simular_plano.canal;
    end if;
    select * into par from public.parametros_margem where id = 1;
    select coalesce(sum(x.quantidade) filter (where x.item not in ('sms_resposta', 'consulta_operadora')), 0),
           coalesce(sum(x.custo), 0),
           coalesce(sum(x.custo) filter (where x.item in ('sms_resposta', 'consulta_operadora', 'rcs_sessao')), 0)
      into env, atual, fixo
      from public.mensageria_consumo_fornecedor x
     where x.empresa_id = empresa and x.competencia = comp and x.modo = simular_plano.modo
       and public.canal_do_item(x.item) = simular_plano.canal;
    select r.receita into rec from public.receita_canal(empresa, simular_plano.canal, comp, simular_plano.modo) r;
    imp := round(rec * par.impostos_pct / 100, 2);
    -- cada (item, operadora) do mês vai para as linhas do plano daquela operadora (ou as de "todas")
    with vol as (
        select x.item, x.operadora, sum(x.quantidade) as qtd from public.mensageria_consumo_fornecedor x
         where x.empresa_id = empresa and x.competencia = comp and x.modo = simular_plano.modo
           and public.canal_do_item(x.item) = simular_plano.canal
           and x.item not in ('sms_resposta', 'consulta_operadora', 'rcs_sessao')
         group by x.item, x.operadora
    ), alvo as (
        select v.item, v.qtd, pf.fornecedor, pf.percentual
          from vol v
          join public.mensageria_plano_fornecedores pf on pf.plano_id = plano
           and coalesce(pf.operadora, '') = case when exists (
                   select 1 from public.mensageria_plano_fornecedores z
                    where z.plano_id = plano and z.operadora = nullif(v.operadora, '')) then v.operadora else '' end
    )
    select coalesce(sum(a.qtd * a.percentual / 100 * coalesce(public.custo_vigente(a.fornecedor, a.item, dia), 0)), 0),
           string_agg(distinct a.fornecedor || ' (' || a.item || ')', ', ')
               filter (where a.percentual > 0 and public.custo_vigente(a.fornecedor, a.item, dia) is null)
      into novo, faltam from alvo a;
    novo := round(novo + fixo, 2);
    return query select env, rec, imp, round(atual, 2), novo,
        case when rec > 0 then round((rec - imp - atual) / rec * 100, 1) end,
        case when rec > 0 then round((rec - imp - novo) / rec * 100, 1) end,
        faltam;
end $$;
revoke execute on function public.simular_plano(bigint, text, bigint, date, text) from public, anon;
grant execute on function public.simular_plano(bigint, text, bigint, date, text) to authenticated;

-- ---------------------------------------------------------------- permissões
alter table public.mensageria_planos_rota enable row level security;
alter table public.mensageria_plano_fornecedores enable row level security;
alter table public.mensageria_rota_empresa enable row level security;
alter table public.mensageria_custos enable row level security;
alter table public.mensageria_consumo_fornecedor enable row level security;
alter table public.parametros_margem enable row level security;

drop policy if exists planos_rota_ver on public.mensageria_planos_rota;
create policy planos_rota_ver on public.mensageria_planos_rota for select to authenticated using (public.sou_equipe());
drop policy if exists plano_fornecedores_ver on public.mensageria_plano_fornecedores;
create policy plano_fornecedores_ver on public.mensageria_plano_fornecedores for select to authenticated
    using (public.sou_equipe());
drop policy if exists rota_empresa_ver on public.mensageria_rota_empresa;
create policy rota_empresa_ver on public.mensageria_rota_empresa for select to authenticated using (public.sou_equipe());
-- planos e rotas só mudam pelas funções (que conferem os 100% e o canal)
revoke insert, update, delete on public.mensageria_planos_rota, public.mensageria_plano_fornecedores,
    public.mensageria_rota_empresa from authenticated;

-- custo e margem: só o Master
drop policy if exists custos_ver on public.mensageria_custos;
create policy custos_ver on public.mensageria_custos for select to authenticated using (public.admin_equipe());
drop policy if exists custos_gravar on public.mensageria_custos;
create policy custos_gravar on public.mensageria_custos for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
drop policy if exists consumo_fornecedor_ver on public.mensageria_consumo_fornecedor;
create policy consumo_fornecedor_ver on public.mensageria_consumo_fornecedor for select to authenticated
    using (public.admin_equipe());
revoke insert, update, delete on public.mensageria_consumo_fornecedor from authenticated;
drop policy if exists parametros_margem_ver on public.parametros_margem;
create policy parametros_margem_ver on public.parametros_margem for select to authenticated using (public.admin_equipe());
drop policy if exists parametros_margem_gravar on public.parametros_margem;
create policy parametros_margem_gravar on public.parametros_margem for update to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());

revoke all on public.mensageria_planos_rota, public.mensageria_plano_fornecedores, public.mensageria_rota_empresa,
    public.mensageria_custos, public.mensageria_consumo_fornecedor, public.parametros_margem from anon;

-- ---------------------------------------------------------------- rotas antigas viram planos
do $$
declare
    r record;
    pid bigint;
begin
    -- padrão de cada canal: principal 100%, reservas 0% (só se o canal ainda não tiver plano)
    for r in select distinct ro.canal from public.mensageria_rotas ro where ro.empresa_id is null and ro.ativo loop
        if not exists (select 1 from public.mensageria_planos_rota p where p.canal = r.canal) then
            insert into public.mensageria_planos_rota (nome, canal, padrao, descricao)
            values ('Padrão ' || upper(r.canal), r.canal, true, 'Criado a partir da rota principal/reserva.')
            returning id into pid;
            insert into public.mensageria_plano_fornecedores (plano_id, fornecedor, percentual, ordem_reserva)
            select pid, x.fornecedor, case when x.n = 1 then 100 else 0 end, x.n
              from (select ro.fornecedor, row_number() over (order by ro.prioridade) as n
                      from public.mensageria_rotas ro
                     where ro.empresa_id is null and ro.canal = r.canal and ro.ativo) x;
        end if;
    end loop;
    -- rotas próprias de empresas: um plano exclusivo por empresa e canal
    for r in select distinct ro.empresa_id, ro.canal, e.nome from public.mensageria_rotas ro
              join public.empresas e on e.id = ro.empresa_id where ro.ativo loop
        if not exists (select 1 from public.mensageria_rota_empresa x where x.empresa_id = r.empresa_id
                       and x.canal = r.canal) then
            insert into public.mensageria_planos_rota (nome, canal, descricao)
            values (left(r.nome, 45) || ' · ' || upper(r.canal), r.canal, 'Rota própria da empresa.')
            on conflict (canal, nome) do update set atualizado_em = now()
            returning id into pid;
            delete from public.mensageria_plano_fornecedores where plano_id = pid;
            insert into public.mensageria_plano_fornecedores (plano_id, fornecedor, percentual, ordem_reserva)
            select pid, x.fornecedor, case when x.n = 1 then 100 else 0 end, x.n
              from (select ro.fornecedor, row_number() over (order by ro.prioridade) as n
                      from public.mensageria_rotas ro
                     where ro.empresa_id = r.empresa_id and ro.canal = r.canal and ro.ativo) x;
            insert into public.mensageria_rota_empresa (empresa_id, canal, plano_id) values (r.empresa_id, r.canal, pid);
        end if;
    end loop;
end $$;
-- custo que estava na rota vira custo vigente (sms e e-mail)
insert into public.mensageria_custos (fornecedor, item, custo, vigente_desde)
select distinct on (ro.fornecedor, ro.canal) ro.fornecedor, ro.canal, ro.custo_unitario, current_date
  from public.mensageria_rotas ro
 where ro.custo_unitario is not null and ro.canal in ('sms', 'email')
   and not exists (select 1 from public.mensageria_custos c where c.fornecedor = ro.fornecedor and c.item = ro.canal)
 order by ro.fornecedor, ro.canal, ro.empresa_id nulls first
on conflict do nothing;
comment on table public.mensageria_rotas is
    'Substituída por mensageria_planos_rota (% por fornecedor e operadora). Mantida só para leitura do histórico.';

-- ---------------------------------------------------------------- auditoria
do $$
declare t text;
begin
    foreach t in array array['mensageria_planos_rota', 'mensageria_plano_fornecedores', 'mensageria_rota_empresa',
                             'mensageria_custos', 'parametros_margem'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
