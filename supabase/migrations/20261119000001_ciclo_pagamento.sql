-- Contratação v2: Orquestração e Jornada como módulos, ciclo de uso em dias e cobrança pré ou pós-paga.
-- * Módulos do motor: 'orquestracao' (MotorCob) e 'jornada' (MotorCli) são marcados na Contratação; o motor de
--   cada carteira só roda com o módulo da frente dela ligado. salvar_frentes() não liga mais módulo sozinho.
-- * Ciclo de uso (ciclo_empresa): 'mensal' (dia de corte, como antes) ou 'dias' (a cada N dias, de 1 a 90, a
--   partir de uma data de início: semanal = 7, quinzenal = 15). No ciclo em dias, a competência é o PRIMEIRO dia do
--   ciclo (no mensal continua o dia 1 do mês em que o ciclo termina). Prazo de pagamento em dias após o
--   fechamento (prazo_dias); sem ele, vale o dia de vencimento antigo.
-- * Cobrança: pós-pago (fatura no fim do ciclo) ou pré-pago (saldo recarregado; o uso valorado desconta do saldo;
--   sem fatura). Formas aceitas: boleto, Pix e cartão. Pré-pago: recarga mínima, aviso de saldo baixo, o que fazer
--   quando o saldo acaba (pausar a Mensageria ou continuar) e recarga automática (só com cartão).
-- * Recargas (recargas): o cliente (ou a equipe) pede; a equipe confirma o pagamento ("Marcar como paga") enquanto
--   a ferramenta de cobrança não estiver integrada. saldo_empresa(): recargas pagas menos o uso valorado.
-- Rode DEPOIS do SQL 21. Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- módulos do motor
alter table public.empresa_modulos drop constraint if exists empresa_modulos_modulo_check;
alter table public.empresa_modulos add constraint empresa_modulos_modulo_check
    check (modulo in ('orquestracao', 'jornada', 'mensageria', 'enriquecimento', 'api'));
comment on column public.empresa_modulos.modulo is
    'orquestracao (motor do MotorCob), jornada (motor do MotorCli), mensageria, enriquecimento ou api.';
-- quem já tem o MotorCli ligado ganha o módulo Jornada (para não parar de rodar)
insert into public.empresa_modulos (empresa_id, modulo, ativo)
select f.empresa_id, 'jornada', true from public.empresa_frentes f where f.frente = 'motorcli' and f.ativo
on conflict do nothing;
update public.cobranca_itens set modulo = 'jornada' where codigo = 'jornada_clientes';

create or replace function public.salvar_frentes(empresa bigint, frentes text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.equipe_pode('editar_contratacao', salvar_frentes.empresa) then
        raise exception 'sem permissão para definir o motor da empresa';
    end if;
    if frentes is null or cardinality(frentes) = 0 or not (frentes <@ array['motorcob', 'motorcli']) then
        raise exception 'escolha o MotorCob, o MotorCli ou os dois';
    end if;
    insert into public.empresa_frentes (empresa_id, frente, ativo)
    select empresa, f, f = any (frentes) from unnest(array['motorcob', 'motorcli']) f
    on conflict (empresa_id, frente) do update set ativo = excluded.ativo,
        desde = case when public.empresa_frentes.ativo then public.empresa_frentes.desde else current_date end;
end $$;

-- ---------------------------------------------------------------- ciclo em dias e cobrança
alter table public.ciclo_empresa
    add column if not exists periodicidade text not null default 'mensal' check (periodicidade in ('mensal', 'dias')),
    add column if not exists ciclo_dias int check (ciclo_dias is null or ciclo_dias between 1 and 90),
    add column if not exists inicio date,
    add column if not exists prazo_dias int check (prazo_dias is null or prazo_dias between 1 and 60),
    add column if not exists modelo_pagamento text not null default 'pos' check (modelo_pagamento in ('pos', 'pre')),
    add column if not exists formas text[] not null default array['boleto', 'pix']
        check (cardinality(formas) > 0 and formas <@ array['boleto', 'pix', 'cartao']),
    add column if not exists recarga_minima numeric(14, 2) check (recarga_minima is null or recarga_minima > 0),
    add column if not exists aviso_saldo numeric(14, 2) check (aviso_saldo is null or aviso_saldo >= 0),
    add column if not exists ao_zerar text not null default 'pausar' check (ao_zerar in ('pausar', 'continuar')),
    add column if not exists recarga_automatica boolean not null default false,
    add column if not exists pre_desde date;
alter table public.ciclo_empresa drop constraint if exists ciclo_empresa_dias_ok;
alter table public.ciclo_empresa add constraint ciclo_empresa_dias_ok
    check (periodicidade = 'mensal' or (ciclo_dias is not null and inicio is not null));
alter table public.ciclo_empresa drop constraint if exists ciclo_empresa_auto_cartao;
alter table public.ciclo_empresa add constraint ciclo_empresa_auto_cartao
    check (not recarga_automatica or 'cartao' = any (formas));
alter table public.ciclo_empresa drop constraint if exists ciclo_empresa_pre_ok;
alter table public.ciclo_empresa add constraint ciclo_empresa_pre_ok
    check (modelo_pagamento = 'pos' or recarga_minima is not null);
comment on table public.ciclo_empresa is 'Ciclo de uso (mensal com dia de corte ou a cada N dias) e a forma de cobrança.';

-- pré-pago começa a contar o uso a partir de quando foi ligado
create or replace function public.marcar_pre_desde() returns trigger
language plpgsql as $$
begin
    if new.modelo_pagamento = 'pre' and (tg_op = 'INSERT' or old.modelo_pagamento <> 'pre') then
        new.pre_desde := current_date;
    elsif new.modelo_pagamento = 'pos' then
        new.pre_desde := null;
    end if;
    new.atualizado_em := now();
    return new;
end $$;
drop trigger if exists marcar_pre_desde on public.ciclo_empresa;
create trigger marcar_pre_desde before insert or update on public.ciclo_empresa
    for each row execute function public.marcar_pre_desde();

-- competência fora do dia 1 passa a valer (ciclo em dias)
do $$
declare r record;
begin
    for r in select conrelid::regclass as t, conname from pg_constraint
              where contype = 'c' and pg_get_constraintdef(oid) ilike '%(day FROM competencia)%'
                and conrelid::regclass::text in ('contratos_mes', 'consumo_mensageria', 'faturas',
                    'mensageria_consumo_fornecedor', 'jornada_clientes_mes') loop
        execute format('alter table %s drop constraint %I', r.t, r.conname);
    end loop;
end $$;

create or replace function public.ciclo_de(empresa bigint, competencia date, out inicio date, out fim date)
language plpgsql stable security definer set search_path = public as $$
declare
    c public.ciclo_empresa;
    mes date := date_trunc('month', competencia)::date;
    corte int;
begin
    select * into c from public.ciclo_empresa x where x.empresa_id = empresa;
    if c.empresa_id is not null and c.periodicidade = 'dias' then
        inicio := competencia;
        fim := competencia + c.ciclo_dias - 1;
        return;
    end if;
    corte := coalesce(c.dia_corte, 1);
    if corte = 1 then
        inicio := mes;
        fim := (mes + interval '1 month')::date - 1;
    else
        inicio := (mes - interval '1 month')::date + (corte - 1);
        fim := mes + (corte - 2);
    end if;
end $$;

create or replace function public.competencia_de(empresa bigint, dia date) returns date
language plpgsql stable security definer set search_path = public as $$
declare
    c public.ciclo_empresa;
begin
    select * into c from public.ciclo_empresa x where x.empresa_id = empresa;
    if c.empresa_id is not null and c.periodicidade = 'dias' then
        return c.inicio + (floor((dia - c.inicio)::numeric / c.ciclo_dias) * c.ciclo_dias)::int;
    end if;
    if coalesce(c.dia_corte, 1) > 1 and extract(day from dia) >= c.dia_corte then
        return (date_trunc('month', dia) + interval '1 month')::date;
    end if;
    return date_trunc('month', dia)::date;
end $$;

-- vencimento: prazo em dias após o fechamento; sem prazo, o dia de vencimento antigo
create or replace function public.vencimento_de(empresa bigint, competencia date) returns date
language plpgsql stable security definer set search_path = public as $$
declare
    fim date := (public.ciclo_de(empresa, competencia)).fim;
    prazo int := (select c.prazo_dias from public.ciclo_empresa c where c.empresa_id = empresa);
    dia int := coalesce((select c.vencimento_dia from public.ciclo_empresa c where c.empresa_id = empresa),
                        (select p.vencimento_dia from public.planos_empresa p where p.empresa_id = empresa), 10);
    v date;
begin
    if prazo is not null then
        return fim + 1 + prazo;
    end if;
    v := date_trunc('month', fim)::date + (dia - 1);
    if v <= fim then
        v := (date_trunc('month', fim) + interval '1 month')::date + (dia - 1);
    end if;
    return v;
end $$;

-- prévia e fechamento usam a competência do ciclo (em dias, qualquer dia); o motor (sem login) também calcula
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
select pg_temp.trocar('public.previa_fatura(bigint,date)',
    'mes date := date_trunc(''month'', competencia)::date;', 'mes date := public.competencia_de(empresa, competencia);');
select pg_temp.trocar('public.previa_fatura(bigint,date)',
    'if not public.ve_faturamento(empresa) then', 'if auth.uid() is not null and not public.ve_faturamento(empresa) then');
select pg_temp.trocar('public.fechar_fatura(bigint,date)',
    'mes date := date_trunc(''month'', competencia)::date;', 'mes date := public.competencia_de(empresa, competencia);');
select pg_temp.trocar('public.fechar_fatura(bigint,date)',
    'if not exists (select 1 from public.precos_empresa x where x.empresa_id = empresa) then',
    'if (select c.modelo_pagamento from public.ciclo_empresa c where c.empresa_id = empresa) = ''pre'' then
        raise exception ''empresa pré-paga não tem fatura: o uso desconta do saldo'';
    end if;
    if not exists (select 1 from public.precos_empresa x where x.empresa_id = empresa) then');
revoke execute on function public.previa_fatura(bigint, date) from public, anon;

-- rascunhos: mensal = a competência pedida; em dias = o último ciclo fechado; pré-pago não tem fatura
create or replace function public.gerar_rascunhos(competencia date) returns int
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    e record;
    comp date;
    n int := 0;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCX gera rascunhos';
    end if;
    for e in select x.id, c.periodicidade, c.modelo_pagamento from public.empresas x
               left join public.ciclo_empresa c on c.empresa_id = x.id
              where x.situacao in ('ativa', 'implantacao', 'suspensa')
                and exists (select 1 from public.precos_empresa p where p.empresa_id = x.id)
              order by x.id loop
        if coalesce(e.modelo_pagamento, 'pos') = 'pre' then
            continue;
        end if;
        comp := case when e.periodicidade = 'dias'
                     then public.competencia_de(e.id, (public.ciclo_de(e.id, public.competencia_de(e.id, current_date))).inicio - 1)
                     else mes end;
        if exists (select 1 from public.faturas f where f.empresa_id = e.id and f.competencia = comp)
           or (public.ciclo_de(e.id, comp)).fim >= current_date then
            continue;
        end if;
        perform public.fechar_fatura(e.id, comp);
        n := n + 1;
    end loop;
    return n;
end $$;

-- ---------------------------------------------------------------- recargas e saldo (pré-pago)
create table if not exists public.recargas (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    valor          numeric(14, 2) not null check (valor > 0),
    forma          text not null check (forma in ('boleto', 'pix', 'cartao')),
    situacao       text not null default 'pendente' check (situacao in ('pendente', 'paga', 'cancelada')),
    automatica     boolean not null default false,
    id_externo     text check (char_length(id_externo) <= 200),          -- código na ferramenta de cobrança
    link_pagamento text check (link_pagamento ~ '^https://'),
    pedida_em      timestamptz not null default now(),
    pedida_por     uuid default auth.uid() references auth.users (id),
    paga_em        timestamptz,
    confirmada_por uuid references auth.users (id)
);
create index if not exists recargas_empresa on public.recargas (empresa_id, pedida_em desc);
alter table public.recargas enable row level security;
drop policy if exists recargas_ver on public.recargas;
create policy recargas_ver on public.recargas for select to authenticated using (public.ve_faturamento(empresa_id));
revoke all on public.recargas from anon;
revoke insert, update, delete on public.recargas from authenticated;

create or replace function public.solicitar_recarga(empresa bigint, valor numeric, forma text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    c public.ciclo_empresa;
    rid bigint;
begin
    if not (public.equipe_pode('emitir_faturas', empresa)
            or (not public.sou_equipe() and empresa in (select public.minhas_empresas()) and public.pode('ver_faturamento'))) then
        raise exception 'sem permissão para recarregar esta empresa';
    end if;
    select * into c from public.ciclo_empresa x where x.empresa_id = empresa;
    if c.empresa_id is null or c.modelo_pagamento <> 'pre' then
        raise exception 'a empresa não é pré-paga';
    end if;
    if valor is null or valor < c.recarga_minima then
        raise exception 'a recarga mínima é de R$ %', to_char(c.recarga_minima, 'FM999G999G990D00');
    end if;
    if forma is null or not (forma = any (c.formas)) then
        raise exception 'forma de pagamento não aceita para esta empresa';
    end if;
    insert into public.recargas (empresa_id, valor, forma) values (empresa, round(valor, 2), forma) returning id into rid;
    return rid;
end $$;

create or replace function public.confirmar_recarga(recarga bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.recargas;
begin
    select * into r from public.recargas where id = recarga;
    if r.id is null then
        raise exception 'recarga não encontrada';
    end if;
    if not public.equipe_pode('emitir_faturas', r.empresa_id) then
        raise exception 'só a equipe confirma o pagamento da recarga';
    end if;
    if r.situacao <> 'pendente' then
        raise exception 'a recarga já está %', r.situacao;
    end if;
    update public.recargas set situacao = 'paga', paga_em = now(), confirmada_por = auth.uid() where id = recarga;
end $$;

create or replace function public.cancelar_recarga(recarga bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.recargas;
begin
    select * into r from public.recargas where id = recarga;
    if r.id is null or not public.ve_faturamento(r.empresa_id) then
        raise exception 'recarga não encontrada';
    end if;
    if r.situacao <> 'pendente' then
        raise exception 'só recarga pendente pode ser cancelada';
    end if;
    if not (public.equipe_pode('emitir_faturas', r.empresa_id) or r.pedida_por = auth.uid()) then
        raise exception 'só quem pediu ou a equipe cancela a recarga';
    end if;
    update public.recargas set situacao = 'cancelada' where id = recarga;
end $$;

-- saldo do pré-pago: recargas pagas menos o uso valorado (prévia de cada ciclo desde que virou pré-pago)
create or replace function public.saldo_empresa(empresa bigint)
returns table (pre_pago boolean, saldo numeric, recargas_pagas numeric, uso numeric, aviso_saldo numeric,
               abaixo_do_aviso boolean, pausar_envios boolean, recarga_minima numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    c public.ciclo_empresa;
    comp date;
    atual date;
    total_uso numeric := 0;
    pagas numeric;
    i int := 0;
begin
    if auth.uid() is not null and not public.ve_faturamento(empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    select * into c from public.ciclo_empresa x where x.empresa_id = empresa;
    if c.empresa_id is null or c.modelo_pagamento <> 'pre' then
        return query select false, null::numeric, null::numeric, null::numeric, null::numeric, false, false, null::numeric;
        return;
    end if;
    select coalesce(sum(r.valor), 0) into pagas from public.recargas r where r.empresa_id = empresa and r.situacao = 'paga';
    comp := public.competencia_de(empresa, coalesce(c.pre_desde, current_date));
    atual := public.competencia_de(empresa, current_date);
    while comp <= atual and i < 400 loop
        total_uso := total_uso + coalesce((select sum(v.valor) from public.previa_fatura(empresa, comp) v), 0);
        comp := public.competencia_de(empresa, (public.ciclo_de(empresa, comp)).fim + 1);
        i := i + 1;
    end loop;
    return query select true, round(pagas - total_uso, 2), pagas, round(total_uso, 2), c.aviso_saldo,
                        (pagas - total_uso) <= coalesce(c.aviso_saldo, 0),
                        c.ao_zerar = 'pausar' and (pagas - total_uso) <= 0, c.recarga_minima;
end $$;

revoke all on function public.solicitar_recarga(bigint, numeric, text), public.confirmar_recarga(bigint),
    public.cancelar_recarga(bigint), public.saldo_empresa(bigint) from public, anon;
grant execute on function public.solicitar_recarga(bigint, numeric, text), public.confirmar_recarga(bigint),
    public.cancelar_recarga(bigint), public.saldo_empresa(bigint) to authenticated;
