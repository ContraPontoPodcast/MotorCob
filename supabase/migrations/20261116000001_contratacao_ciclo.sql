-- Contratação em um lugar só: motor (MotorCob / MotorCli), módulos, preço de cada item e o ciclo de uso.
-- * Ciclo de uso (ciclo_empresa): o uso conta do dia de corte de um mês até a véspera do corte no mês seguinte
--   (corte 1 = mês fechado, como antes). A competência leva o nome do mês em que o ciclo TERMINA: com corte 21,
--   "outubro" = 21/09 a 20/10. O volume do preço escalonado é medido nesse ciclo. A fatura só fecha depois do
--   fim do ciclo e vence no primeiro "dia de vencimento" depois dele.
-- * Jornada (MotorCli) cobrada igual à Orquestração: por cliente acionado no ciclo (flat, faixa ou progressivo,
--   com mínimo) ou mensalidade. Medição em jornada_clientes_mes (só o ID do cliente), gravada pela rotina.
-- * salvar_frentes(): liga o MotorCob e/ou o MotorCli da empresa (pelo menos um) e garante o motor ligado.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- ciclo de uso
create table if not exists public.ciclo_empresa (
    empresa_id      bigint primary key references public.empresas (id) on delete cascade,
    dia_corte       int not null default 1 check (dia_corte between 1 and 28),
    vencimento_dia  int not null default 10 check (vencimento_dia between 1 and 28),
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id)
);
comment on table public.ciclo_empresa is
    'Ciclo de uso: do dia de corte até a véspera do corte no mês seguinte (1 = mês fechado). Sem linha = mês fechado.';
alter table public.ciclo_empresa enable row level security;
drop policy if exists ciclo_empresa_ver on public.ciclo_empresa;
create policy ciclo_empresa_ver on public.ciclo_empresa for select to authenticated
    using (public.ve_faturamento(empresa_id));
drop policy if exists ciclo_empresa_gravar on public.ciclo_empresa;
create policy ciclo_empresa_gravar on public.ciclo_empresa for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.ciclo_empresa from anon;
-- quem já tinha vencimento no plano antigo continua com ele
insert into public.ciclo_empresa (empresa_id, vencimento_dia)
select empresa_id, vencimento_dia from public.planos_empresa on conflict do nothing;

create or replace function public.dia_corte(empresa bigint) returns int
language sql stable security definer set search_path = public as $$
    select coalesce((select c.dia_corte from public.ciclo_empresa c where c.empresa_id = empresa), 1)
$$;

-- período de uso da competência (mês em que o ciclo termina)
create or replace function public.ciclo_de(empresa bigint, competencia date, out inicio date, out fim date)
language plpgsql stable security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    corte int := public.dia_corte(empresa);
begin
    if corte = 1 then
        inicio := mes;
        fim := (mes + interval '1 month')::date - 1;
    else
        inicio := (mes - interval '1 month')::date + (corte - 1);
        fim := mes + (corte - 2);
    end if;
end $$;

-- competência de um dia de uso
create or replace function public.competencia_de(empresa bigint, dia date) returns date
language sql stable security definer set search_path = public as $$
    select case when public.dia_corte(empresa) > 1 and extract(day from dia) >= public.dia_corte(empresa)
                then (date_trunc('month', dia) + interval '1 month')::date
                else date_trunc('month', dia)::date end
$$;

-- vencimento da fatura da competência: o primeiro dia de vencimento depois do fim do ciclo
create or replace function public.vencimento_de(empresa bigint, competencia date) returns date
language plpgsql stable security definer set search_path = public as $$
declare
    fim date := (public.ciclo_de(empresa, competencia)).fim;
    dia int := coalesce((select c.vencimento_dia from public.ciclo_empresa c where c.empresa_id = empresa),
                        (select p.vencimento_dia from public.planos_empresa p where p.empresa_id = empresa), 10);
    v date := date_trunc('month', fim)::date + (dia - 1);
begin
    if v <= fim then
        v := (date_trunc('month', fim) + interval '1 month')::date + (dia - 1);
    end if;
    return v;
end $$;

-- o ciclo de hoje, para a tela
create or replace function public.ciclo_atual(empresa bigint)
returns table (competencia date, inicio date, fim date, fecha_em date, vence_em date)
language plpgsql stable security definer set search_path = public as $$
declare
    comp date;
begin
    if not public.ve_faturamento(empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    comp := public.competencia_de(empresa, current_date);
    return query select comp, c.inicio, c.fim, c.fim + 1, public.vencimento_de(empresa, comp)
                   from public.ciclo_de(empresa, comp) c;
end $$;

revoke all on function public.dia_corte(bigint), public.ciclo_de(bigint, date), public.competencia_de(bigint, date),
    public.vencimento_de(bigint, date), public.ciclo_atual(bigint) from public, anon;
grant execute on function public.dia_corte(bigint), public.ciclo_de(bigint, date), public.competencia_de(bigint, date),
    public.vencimento_de(bigint, date), public.ciclo_atual(bigint) to authenticated;

-- ---------------------------------------------------------------- Jornada (MotorCli): item e medição
insert into public.cobranca_itens (codigo, produto, nome, unidade, preco_de, modulo, ordem)
values ('jornada_clientes', 'jornada', 'Jornada (MotorCli)', 'cliente', null, 'orquestracao', 2)
on conflict (codigo) do nothing;

create table if not exists public.jornada_clientes_mes (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    competencia   date not null check (extract(day from competencia) = 1),
    credor_id     bigint not null default 0,
    id_cliente    text not null check (char_length(id_cliente) between 1 and 60),
    primeiro_dia  date not null default current_date,
    primary key (empresa_id, competencia, credor_id, id_cliente)
);
comment on table public.jornada_clientes_mes is
    'MotorCli: clientes distintos acionados pela jornada no ciclo (só o ID). Gravado pela rotina.';
alter table public.jornada_clientes_mes enable row level security;
drop policy if exists jornada_clientes_mes_ver on public.jornada_clientes_mes;
create policy jornada_clientes_mes_ver on public.jornada_clientes_mes for select to authenticated
    using (public.ve_faturamento(empresa_id));
revoke all on public.jornada_clientes_mes from anon;
revoke insert, update, delete on public.jornada_clientes_mes from authenticated;

create or replace view public.consumo_mes with (security_invoker = true) as
select empresa_id, competencia, 'contratos'::text as item, count(*)::bigint as quantidade
  from public.contratos_mes group by empresa_id, competencia
union all
select empresa_id, competencia, 'jornada_clientes'::text, count(*)::bigint
  from public.jornada_clientes_mes group by empresa_id, competencia
union all
select empresa_id, competencia, item, quantidade from public.consumo_mensageria;
grant select on public.consumo_mes to authenticated;
revoke all on public.consumo_mes from anon;

-- ---------------------------------------------------------------- prévia, fechamento e rascunhos pelo ciclo
create or replace function public.previa_fatura(empresa bigint, competencia date)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    c record;
    v record;
    qtd numeric;
    qtd_extra numeric;
    pv public.precos_empresa;
    codigo_fatura text;
    nome text;
begin
    if not public.ve_faturamento(empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    for c in select ci.* from public.cobranca_itens ci where ci.preco_de is null order by ci.ordem, ci.codigo loop
        qtd_extra := 0;
        if c.codigo = 'contratos' then
            select count(*) into qtd from public.contratos_mes m where m.empresa_id = empresa and m.competencia = mes;
        elsif c.codigo = 'jornada_clientes' then
            select count(*) into qtd from public.jornada_clientes_mes m
             where m.empresa_id = empresa and m.competencia = mes;
        else
            select coalesce(sum(m.quantidade), 0) into qtd from public.consumo_mensageria m
             where m.empresa_id = empresa and m.competencia = mes and m.item = c.codigo;
            select coalesce(sum(m.quantidade), 0) into qtd_extra from public.consumo_mensageria m
              join public.cobranca_itens x on x.codigo = m.item and x.preco_de = c.codigo
             where m.empresa_id = empresa and m.competencia = mes;
        end if;
        pv := public.preco_vigente(empresa, c.codigo, mes);
        codigo_fatura := case when c.codigo = 'contratos' then 'orquestracao'
                              when c.codigo = 'jornada_clientes' then 'jornada' else c.codigo end;
        nome := case when c.codigo = 'contratos' then 'Orquestração' else c.nome end;
        if pv.id is null then
            if qtd + qtd_extra > 0 then        -- consumo sem preço cadastrado: aparece zerado para a equipe ver
                return query select c.ordem, codigo_fatura, nome || ' · sem preço cadastrado', qtd + qtd_extra,
                                    0::numeric, 0::numeric;
            end if;
            continue;
        end if;
        if pv.modelo = 'mensalidade' then
            if c.modulo is null or exists (select 1 from public.empresa_modulos em where em.empresa_id = empresa
                                           and em.modulo = c.modulo and em.ativo) then
                return query select c.ordem, codigo_fatura, nome || ' · mensalidade', 1::numeric, pv.preco,
                                    round(pv.preco, 2);
            end if;
            continue;
        end if;
        if qtd + qtd_extra = 0 and pv.minimo = 0 then
            continue;
        end if;
        select * into v from public.valor_item(empresa, c.codigo, qtd + qtd_extra, mes);
        return query select c.ordem, codigo_fatura,
            nome || case when c.codigo = 'contratos' then ' · contratos no ciclo'
                         when c.codigo = 'jornada_clientes' then ' · clientes acionados no ciclo'
                         when qtd_extra > 0 then ' · ' || qtd || ' envios + ' || qtd_extra || ' respostas'
                         else '' end
                 || coalesce(' (' || v.detalhe || ')', ''),
            qtd + qtd_extra, v.preco_medio, v.valor;
        if v.minimo > v.valor then
            return query select c.ordem + 1000, codigo_fatura || '_minimo',
                                nome || ' · complemento do mínimo mensal', 1::numeric, v.minimo - v.valor,
                                v.minimo - v.valor;
        end if;
    end loop;
end $$;

create or replace function public.fechar_fatura(empresa bigint, competencia date) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    p public.planos_empresa;
    fid bigint;
    total numeric;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCX fecha fatura';
    end if;
    if (public.ciclo_de(empresa, mes)).fim >= current_date then
        raise exception 'só dá para fechar o ciclo depois que ele termina';
    end if;
    if not exists (select 1 from public.precos_empresa x where x.empresa_id = empresa) then
        raise exception 'empresa sem preço cadastrado';
    end if;
    if exists (select 1 from public.faturas f where f.empresa_id = empresa and f.competencia = mes) then
        raise exception 'fatura deste ciclo já foi fechada';
    end if;
    select * into p from public.planos_empresa where empresa_id = empresa;
    select coalesce(sum(v.valor), 0) into total from public.previa_fatura(empresa, mes) v;
    insert into public.faturas (empresa_id, competencia, situacao, valor_total, itens_total, vencimento, modelo)
        values (empresa, mes, 'rascunho', total, total, public.vencimento_de(empresa, mes),
                coalesce(p.orquestracao_modelo, 'por_produto'))
        returning id into fid;
    insert into public.fatura_itens (fatura_id, ordem, item, descricao, quantidade, preco, valor)
        select fid, v.ordem, v.item, v.descricao, v.quantidade, v.preco, v.valor from public.previa_fatura(empresa, mes) v;
    return fid;
end $$;

create or replace function public.gerar_rascunhos(competencia date) returns int
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    e bigint;
    n int := 0;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCX gera rascunhos';
    end if;
    for e in select x.id from public.empresas x
              where x.situacao in ('ativa', 'implantacao', 'suspensa')
                and exists (select 1 from public.precos_empresa p where p.empresa_id = x.id)
                and not exists (select 1 from public.faturas f where f.empresa_id = x.id and f.competencia = mes)
                and (public.ciclo_de(x.id, mes)).fim < current_date      -- ciclo ainda aberto fica para depois
              order by x.id loop
        perform public.fechar_fatura(e, mes);
        n := n + 1;
    end loop;
    return n;
end $$;

-- ---------------------------------------------------------------- motor da empresa (frentes)
create or replace function public.salvar_frentes(empresa bigint, frentes text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCX define o motor da empresa';
    end if;
    if frentes is null or cardinality(frentes) = 0 or not (frentes <@ array['motorcob', 'motorcli']) then
        raise exception 'escolha o MotorCob, o MotorCli ou os dois';
    end if;
    insert into public.empresa_frentes (empresa_id, frente, ativo)
    select empresa, f, f = any (frentes) from unnest(array['motorcob', 'motorcli']) f
    on conflict (empresa_id, frente) do update set ativo = excluded.ativo,
        desde = case when public.empresa_frentes.ativo then public.empresa_frentes.desde else current_date end;
    -- o motor de decisão (módulo orquestração) roda as duas frentes
    insert into public.empresa_modulos (empresa_id, modulo, ativo) values (empresa, 'orquestracao', true)
    on conflict (empresa_id, modulo) do update set ativo = true;
end $$;
revoke all on function public.salvar_frentes(bigint, text[]) from public, anon;
grant execute on function public.salvar_frentes(bigint, text[]) to authenticated;
