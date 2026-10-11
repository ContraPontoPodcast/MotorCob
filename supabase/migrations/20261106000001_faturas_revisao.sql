-- Revisão das faturas antes de emitir.
-- * fechar_fatura passa a criar a fatura em RASCUNHO (o cliente não vê). gerar_rascunhos(competencia) faz isso
--   para todas as empresas com plano de uma vez.
-- * Ajustes no rascunho: desconto, crédito ou cobrança extra, com motivo (aparece na fatura). O total é
--   recalculado: itens + cobranças extras − descontos − créditos (nunca abaixo de zero).
-- * emitir_fatura: rascunho → aberta (o cliente passa a ver). Rascunho só vira aberta por aqui ou cancelada.
-- * View faturas_painel: mostra "vencida" sozinha quando a fatura aberta passou do vencimento.
-- Pode ser rodado de novo sem erro.

alter table public.faturas drop constraint if exists faturas_situacao_check;
alter table public.faturas add constraint faturas_situacao_check
    check (situacao in ('rascunho', 'aberta', 'paga', 'vencida', 'cancelada'));
alter table public.faturas
    add column if not exists itens_total  numeric(14, 2),
    add column if not exists emitida_em   timestamptz,
    add column if not exists emitida_por  uuid references auth.users (id);
update public.faturas f set itens_total = coalesce((select sum(i.valor) from public.fatura_itens i where i.fatura_id = f.id), 0)
 where itens_total is null;

-- cliente não vê rascunho (nem os itens dele)
drop policy if exists faturas_ver on public.faturas;
create policy faturas_ver on public.faturas for select to authenticated
    using (public.ve_faturamento(empresa_id) and (situacao <> 'rascunho' or public.sou_equipe()));
drop policy if exists fatura_itens_ver on public.fatura_itens;
create policy fatura_itens_ver on public.fatura_itens for select to authenticated
    using (exists (select 1 from public.faturas f where f.id = fatura_id and public.ve_faturamento(f.empresa_id)
                   and (f.situacao <> 'rascunho' or public.sou_equipe())));

-- ---------------------------------------------------------------- ajustes
create table if not exists public.fatura_ajustes (
    id          bigint generated always as identity primary key,
    fatura_id   bigint not null references public.faturas (id) on delete cascade,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    tipo        text not null check (tipo in ('desconto', 'credito', 'cobranca_extra')),
    valor       numeric(14, 2) not null check (valor > 0),
    motivo      text not null check (length(trim(motivo)) between 3 and 200),
    criado_por  uuid default auth.uid() references auth.users (id),
    criado_em   timestamptz not null default now()
);
create index if not exists fatura_ajustes_fatura on public.fatura_ajustes (fatura_id);
alter table public.fatura_ajustes enable row level security;
drop policy if exists fatura_ajustes_ver on public.fatura_ajustes;
create policy fatura_ajustes_ver on public.fatura_ajustes for select to authenticated
    using (exists (select 1 from public.faturas f where f.id = fatura_id and public.ve_faturamento(f.empresa_id)
                   and (f.situacao <> 'rascunho' or public.sou_equipe())));
revoke all on public.fatura_ajustes from anon;
revoke insert, update, delete on public.fatura_ajustes from authenticated;

create or replace function public.recalcular_fatura(fid bigint) returns numeric
language sql security definer set search_path = public as $$
    update public.faturas f
       set valor_total = greatest(0, coalesce(f.itens_total, 0)
             + coalesce((select sum(case when a.tipo = 'cobranca_extra' then a.valor else -a.valor end)
                           from public.fatura_ajustes a where a.fatura_id = f.id), 0))
     where f.id = fid
    returning valor_total;
$$;
revoke execute on function public.recalcular_fatura(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- transições da situação
create or replace function public.proteger_situacao_fatura() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.situacao = old.situacao then
        return new;
    end if;
    if old.situacao = 'rascunho' and new.situacao = 'aberta'
       and coalesce(current_setting('motorcob.emitindo', true), '') <> '1' then
        raise exception 'use emitir_fatura para emitir o rascunho';
    end if;
    if old.situacao = 'rascunho' and new.situacao not in ('aberta', 'cancelada') then
        raise exception 'rascunho só vira fatura emitida ou cancelada';
    end if;
    if new.situacao = 'rascunho' then
        raise exception 'fatura emitida não volta a rascunho';
    end if;
    return new;
end $$;
drop trigger if exists proteger_situacao_fatura on public.faturas;
create trigger proteger_situacao_fatura before update on public.faturas
    for each row execute function public.proteger_situacao_fatura();

-- ---------------------------------------------------------------- fechar (agora em rascunho)
create or replace function public.fechar_fatura(empresa bigint, competencia date) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    p public.planos_empresa;
    fid bigint;
    total numeric;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCob fecha fatura';
    end if;
    if mes >= date_trunc('month', current_date)::date then
        raise exception 'só dá para fechar mês que já terminou';
    end if;
    select * into p from public.planos_empresa where empresa_id = empresa;
    if not found then
        raise exception 'empresa sem plano cadastrado';
    end if;
    if exists (select 1 from public.faturas f where f.empresa_id = empresa and f.competencia = mes) then
        raise exception 'fatura deste mês já foi fechada';
    end if;
    select coalesce(sum(v.valor), 0) into total from public.previa_fatura(empresa, mes) v;
    insert into public.faturas (empresa_id, competencia, situacao, valor_total, itens_total, vencimento, modelo)
        values (empresa, mes, 'rascunho', total, total, (mes + interval '1 month')::date + (p.vencimento_dia - 1),
                p.orquestracao_modelo)
        returning id into fid;
    insert into public.fatura_itens (fatura_id, ordem, item, descricao, quantidade, preco, valor)
        select fid, v.ordem, v.item, v.descricao, v.quantidade, v.preco, v.valor from public.previa_fatura(empresa, mes) v;
    return fid;
end $$;
revoke execute on function public.fechar_fatura(bigint, date) from public, anon;
grant execute on function public.fechar_fatura(bigint, date) to authenticated;

create or replace function public.gerar_rascunhos(competencia date) returns int
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    e bigint;
    n int := 0;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCob gera rascunhos';
    end if;
    for e in select p.empresa_id from public.planos_empresa p
              join public.empresas x on x.id = p.empresa_id and x.situacao in ('ativa', 'implantacao', 'suspensa')
             where not exists (select 1 from public.faturas f where f.empresa_id = p.empresa_id and f.competencia = mes)
             order by p.empresa_id loop
        perform public.fechar_fatura(e, mes);
        n := n + 1;
    end loop;
    return n;
end $$;
revoke execute on function public.gerar_rascunhos(date) from public, anon;
grant execute on function public.gerar_rascunhos(date) to authenticated;

create or replace function public.ajustar_fatura(fatura bigint, tipo text, valor numeric, motivo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare f public.faturas;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCob ajusta fatura';
    end if;
    select * into f from public.faturas where id = fatura for update;
    if f.id is null then raise exception 'fatura não encontrada'; end if;
    if f.situacao <> 'rascunho' then raise exception 'só dá para ajustar fatura em rascunho'; end if;
    insert into public.fatura_ajustes (fatura_id, empresa_id, tipo, valor, motivo)
        values (fatura, f.empresa_id, tipo, round(valor, 2), trim(motivo));
    return public.recalcular_fatura(fatura);
end $$;
revoke execute on function public.ajustar_fatura(bigint, text, numeric, text) from public, anon;
grant execute on function public.ajustar_fatura(bigint, text, numeric, text) to authenticated;

create or replace function public.remover_ajuste(ajuste bigint) returns numeric
language plpgsql security definer set search_path = public as $$
declare fid bigint;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCob ajusta fatura';
    end if;
    select a.fatura_id into fid from public.fatura_ajustes a join public.faturas f on f.id = a.fatura_id
     where a.id = ajuste and f.situacao = 'rascunho';
    if fid is null then raise exception 'ajuste não encontrado ou fatura já emitida'; end if;
    delete from public.fatura_ajustes where id = ajuste;
    return public.recalcular_fatura(fid);
end $$;
revoke execute on function public.remover_ajuste(bigint) from public, anon;
grant execute on function public.remover_ajuste(bigint) to authenticated;

create or replace function public.emitir_fatura(fatura bigint) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCob emite fatura';
    end if;
    perform set_config('motorcob.emitindo', '1', true);
    update public.faturas set situacao = 'aberta', emitida_em = now(), emitida_por = auth.uid()
     where id = fatura and situacao = 'rascunho';
    get diagnostics n = row_count;
    perform set_config('motorcob.emitindo', '', true);
    if n = 0 then raise exception 'fatura não está em rascunho'; end if;
end $$;
revoke execute on function public.emitir_fatura(bigint) from public, anon;
grant execute on function public.emitir_fatura(bigint) to authenticated;

-- ---------------------------------------------------------------- painel: "vencida" sozinha
create or replace view public.faturas_painel with (security_invoker = true) as
select f.*,
       case when f.situacao = 'aberta' and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date
            then 'vencida' else f.situacao end as situacao_atual,
       coalesce((select sum(case when a.tipo = 'cobranca_extra' then a.valor else -a.valor end)
                   from public.fatura_ajustes a where a.fatura_id = f.id), 0) as ajustes_total
  from public.faturas f;
grant select on public.faturas_painel to authenticated;
revoke all on public.faturas_painel from anon;

drop trigger if exists z_auditar on public.fatura_ajustes;
create trigger z_auditar after insert or update or delete on public.fatura_ajustes
    for each row execute function public.auditar();
