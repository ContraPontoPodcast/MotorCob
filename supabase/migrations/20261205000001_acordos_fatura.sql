-- SQL 38 · Acordo de pagamento de fatura vencida (protótipo aprovado em 15/10/2026)
-- 1. Quem lança: Master e Administrativo (equipe_pode('emitir_faturas')). Junta faturas em aberto ou vencidas da
--    empresa em até 12 parcelas, com desconto ou acréscimo manual (pede motivo, o cliente não vê; fica na
--    Auditoria). Sem juros nem multa automáticos. A 1ª parcela vence de hoje até 30 dias; as outras, mês a mês.
-- 2. Ao lançar: as faturas ficam "Em acordo" (saem das vencidas, sem lembrete nem bloqueio) e a empresa
--    inadimplente é liberada enquanto as parcelas estiverem em dia. "Informar o cliente": aviso no sino na hora e
--    e-mail para quem recebe faturas (função "cobranca", acao informar_acordo; o motor reenvia o que faltar).
-- 3. Cada parcela é uma cobrança própria (Pix, boleto ou cartão, nas formas do acordo), com lembrete no dia
--    seguinte ao vencimento e 5 dias depois, aviso no 7º dia e nota fiscal quando paga.
-- 4. Parcela com 10 dias de atraso: o acordo é QUEBRADO. As parcelas em aberto viram uma cobrança só com o que
--    falta (vencida desde a parcela atrasada) e a empresa fica inadimplente de novo até pagar.
-- 5. Todas pagas: acordo Quitado e as faturas, Pagas (via acordo). Cancelar (sem parcela paga) volta as faturas
--    para em aberto/vencidas, e a régua de lembretes e bloqueio volta a contar.
-- Depende dos SQL 23 (cobranças e nota fiscal), 34 (avisos) e 37 (inadimplência). Pode rodar de novo sem erro.
-- Atenção: redefine baixar_cobranca (SQL 23) e lembretes_para_enviar, liberar_se_em_dia e atualizar_inadimplencia
-- (SQL 37). Não rode o SQL 23 nem o 37 de novo depois deste.

-- ================================================================ 1. tabelas
create table if not exists public.acordos_fatura (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete restrict,
    situacao         text not null default 'ativo' check (situacao in ('ativo', 'quitado', 'quebrado', 'cancelado')),
    valor_faturas    numeric(14, 2) not null check (valor_faturas > 0),
    ajuste           numeric(14, 2) not null default 0,
    ajuste_motivo    text check (ajuste_motivo is null or char_length(ajuste_motivo) <= 200),
    valor_total      numeric(14, 2) not null check (valor_total > 0),
    parcelas         int not null check (parcelas between 1 and 12),
    primeira_parcela date not null,
    formas           text[] not null check (cardinality(formas) between 1 and 3
                                            and formas <@ array['boleto', 'pix', 'cartao']),
    informar         boolean not null default true,
    informado_em     timestamptz,
    informado_para   text check (informado_para is null or char_length(informado_para) <= 500),
    criado_por       uuid default auth.uid() references auth.users (id),
    criado_em        timestamptz not null default now(),
    encerrado_em     timestamptz,
    encerrado_por    uuid references auth.users (id),
    encerrado_motivo text check (encerrado_motivo is null or char_length(encerrado_motivo) <= 200),
    check (valor_total = valor_faturas + ajuste),
    check (ajuste = 0 or char_length(trim(coalesce(ajuste_motivo, ''))) >= 5)
);
comment on table public.acordos_fatura is
    'Acordo de pagamento de faturas vencidas: parcelas em acordo_parcelas. ajuste < 0 = desconto, > 0 = acréscimo.';
create index if not exists acordos_fatura_empresa on public.acordos_fatura (empresa_id, criado_em desc);

create table if not exists public.acordo_parcelas (
    id               bigint generated always as identity primary key,
    acordo_id        bigint not null references public.acordos_fatura (id) on delete cascade,
    empresa_id       bigint not null references public.empresas (id) on delete restrict,
    numero           int not null check (numero between 1 and 13),
    tipo             text not null default 'parcela' check (tipo in ('parcela', 'saldo')),
    vencimento       date not null,
    valor            numeric(14, 2) not null check (valor > 0),
    situacao         text not null default 'aberta' check (situacao in ('aberta', 'paga', 'cancelada')),
    paga_em          date,
    link_nota_fiscal text check (link_nota_fiscal ~ '^https://'),
    unique (acordo_id, numero)
);
comment on column public.acordo_parcelas.tipo is
    'parcela: do plano do acordo. saldo: o que faltava quando o acordo quebrou (uma cobrança só).';
create index if not exists acordo_parcelas_abertas on public.acordo_parcelas (vencimento) where situacao = 'aberta';

create table if not exists public.parcela_lembretes (
    parcela_id   bigint not null references public.acordo_parcelas (id) on delete cascade,
    tipo         text not null check (tipo in ('d1', 'd5')),
    enviado_em   timestamptz not null default now(),
    enviado_para text check (enviado_para is null or char_length(enviado_para) <= 500),
    primary key (parcela_id, tipo)
);

alter table public.faturas add column if not exists acordo_id bigint references public.acordos_fatura (id) on delete set null;
create index if not exists faturas_acordo on public.faturas (acordo_id) where acordo_id is not null;

-- cobrança e nota fiscal também de uma parcela
alter table public.cobrancas add column if not exists parcela_id bigint references public.acordo_parcelas (id) on delete cascade;
alter table public.notas_fiscais add column if not exists parcela_id bigint references public.acordo_parcelas (id) on delete restrict;
do $$
declare c record;
begin
    for c in select t.relname, k.conname from pg_constraint k join pg_class t on t.oid = k.conrelid
              where t.relnamespace = 'public'::regnamespace and t.relname in ('cobrancas', 'notas_fiscais')
                and k.contype = 'c' and pg_get_constraintdef(k.oid) like '%fatura_id IS NULL%recarga_id IS NULL%' loop
        execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
    end loop;
end $$;
alter table public.cobrancas drop constraint if exists cobrancas_um_alvo;
alter table public.cobrancas add constraint cobrancas_um_alvo check (num_nonnulls(fatura_id, recarga_id, parcela_id) = 1);
alter table public.notas_fiscais drop constraint if exists notas_fiscais_um_alvo;
alter table public.notas_fiscais add constraint notas_fiscais_um_alvo check (num_nonnulls(fatura_id, recarga_id, parcela_id) = 1);
create index if not exists cobrancas_parcela on public.cobrancas (parcela_id) where parcela_id is not null;
create unique index if not exists notas_fiscais_uma_por_parcela on public.notas_fiscais (parcela_id)
    where parcela_id is not null and situacao in ('processando', 'autorizada');
alter table public.nf_config add column if not exists descricao_parcela text not null
    default 'Licença de uso da plataforma MotorCX e serviços de mensageria. Parcela {parcela} do acordo de pagamento nº {acordo}.'
    check (char_length(descricao_parcela) <= 1000);

-- ---------------------------------------------------------------- quem vê
alter table public.acordos_fatura enable row level security;
alter table public.acordo_parcelas enable row level security;
alter table public.parcela_lembretes enable row level security;
-- o acordo (com o motivo do desconto) só a equipe lê direto; o cliente vê pela função acordos()
drop policy if exists acordos_fatura_ver on public.acordos_fatura;
create policy acordos_fatura_ver on public.acordos_fatura for select to authenticated
    using (public.sou_equipe() and public.ve_faturamento(empresa_id));
drop policy if exists acordo_parcelas_ver on public.acordo_parcelas;
create policy acordo_parcelas_ver on public.acordo_parcelas for select to authenticated
    using (public.ve_faturamento(empresa_id));
drop policy if exists parcela_lembretes_ver on public.parcela_lembretes;
create policy parcela_lembretes_ver on public.parcela_lembretes for select to authenticated
    using (exists (select 1 from public.acordo_parcelas p where p.id = parcela_id and public.ve_faturamento(p.empresa_id)));
revoke all on public.acordos_fatura, public.acordo_parcelas, public.parcela_lembretes from anon;
revoke insert, update, delete on public.acordos_fatura, public.acordo_parcelas, public.parcela_lembretes from authenticated;
grant select on public.acordos_fatura, public.acordo_parcelas, public.parcela_lembretes to authenticated;
grant all on public.acordos_fatura, public.acordo_parcelas, public.parcela_lembretes to service_role;

drop trigger if exists z_auditar on public.acordos_fatura;
create trigger z_auditar after insert or update or delete on public.acordos_fatura
    for each row execute function public.auditar();

-- a fatura só entra e sai de acordo pelas funções (lancar_acordo, cancelar_acordo)
create or replace function public.proteger_acordo_fatura() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.acordo_id is distinct from old.acordo_id
       and coalesce(current_setting('motorcob.sistema', true), '') <> '1' then
        raise exception 'a fatura entra e sai de acordo só por Lançar acordo ou Cancelar acordo';
    end if;
    return new;
end $$;
drop trigger if exists proteger_acordo_fatura on public.faturas;
create trigger proteger_acordo_fatura before update of acordo_id on public.faturas
    for each row execute function public.proteger_acordo_fatura();

-- painel: fatura em acordo aparece "em_acordo" (fora das vencidas); a coluna nova entra no f.*
drop view if exists public.faturas_painel;
create view public.faturas_painel with (security_invoker = true) as
select f.*,
       case when f.acordo_id is not null and f.situacao in ('aberta', 'vencida') then 'em_acordo'
            when f.situacao = 'aberta' and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date
            then 'vencida' else f.situacao end as situacao_atual,
       coalesce((select sum(case when a.tipo = 'cobranca_extra' then a.valor else -a.valor end)
                   from public.fatura_ajustes a where a.fatura_id = f.id), 0) as ajustes_total
  from public.faturas f;
grant select on public.faturas_painel to authenticated;
revoke all on public.faturas_painel from anon;

-- ================================================================ 2. lançar e cancelar
create or replace function public.lancar_acordo(empresa bigint, faturas bigint[], parcelas int, primeira date,
    formas text[] default array['pix', 'boleto'], ajuste numeric default 0, motivo text default null,
    informar boolean default true)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    ids bigint[] := array(select distinct x from unnest(coalesce(lancar_acordo.faturas, '{}')) x where x is not null);
    aj numeric := round(coalesce(lancar_acordo.ajuste, 0), 2);
    m text := nullif(trim(coalesce(motivo, '')), '');
    fs text[] := array(select distinct x from unnest(coalesce(lancar_acordo.formas, '{}')) x);
    soma numeric;
    achadas int;
    total numeric;
    cent bigint;
    parte bigint;
    novo bigint;
    i int;
begin
    if not public.equipe_pode('emitir_faturas', empresa) then
        raise exception 'só o Master e o Administrativo lançam acordo';
    end if;
    if cardinality(ids) = 0 then
        raise exception 'escolha ao menos uma fatura';
    end if;
    select count(*), coalesce(sum(f.valor_total), 0) into achadas, soma
      from public.faturas f
     where f.id = any (ids) and f.empresa_id = empresa and f.situacao in ('aberta', 'vencida')
       and f.acordo_id is null and f.valor_total > 0;
    if achadas <> cardinality(ids) then
        raise exception 'só entram faturas em aberto ou vencidas desta empresa que não estejam em outro acordo';
    end if;
    if parcelas is null or parcelas not between 1 and 12 then
        raise exception 'o acordo vai de 1 a 12 parcelas';
    end if;
    if primeira is null or primeira < hoje or primeira > hoje + 30 then
        raise exception 'a 1ª parcela vence de hoje até 30 dias';
    end if;
    if cardinality(fs) = 0 or not fs <@ array['boleto', 'pix', 'cartao'] then
        raise exception 'escolha as formas de pagamento: Pix, boleto ou cartão';
    end if;
    if aj <> 0 and (m is null or char_length(m) < 5) then
        raise exception 'informe o motivo do desconto ou do acréscimo';
    end if;
    total := soma + aj;
    if total < 5 * parcelas then
        raise exception 'cada parcela precisa ter ao menos R$ 5,00';
    end if;

    insert into public.acordos_fatura (empresa_id, valor_faturas, ajuste, ajuste_motivo, valor_total, parcelas,
                                       primeira_parcela, formas, informar)
    values (empresa, soma, aj, case when aj <> 0 then left(m, 200) end, total, parcelas, primeira, fs,
            coalesce(informar, true))
    returning id into novo;
    -- divide em centavos; o resto vai na 1ª parcela
    cent := round(total * 100);
    parte := cent / parcelas;
    for i in 1 .. parcelas loop
        insert into public.acordo_parcelas (acordo_id, empresa_id, numero, vencimento, valor)
        values (novo, empresa, i, (primeira + make_interval(months => i - 1))::date,
                (parte + case when i = 1 then cent - parte * parcelas else 0 end) / 100.0);
    end loop;

    perform set_config('motorcob.sistema', '1', true);
    update public.faturas f set acordo_id = novo where f.id = any (ids);
    perform set_config('motorcob.sistema', '', true);
    -- boleto ou Pix já gerado da fatura sai da tela: agora se paga a parcela
    update public.cobrancas c set situacao = 'cancelada', motivo = 'fatura entrou no acordo nº ' || novo
     where c.fatura_id = any (ids) and c.situacao = 'pendente';

    perform public.liberar_se_em_dia(empresa);
    if coalesce(informar, true) then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
        values ('empresa', empresa, 'pronto',
                left('Acordo de pagamento registrado · ' || parcelas || ' parcela' || case when parcelas > 1 then 's' else '' end, 140),
                left('Total de R$ ' || to_char(total, 'FM999G999G990D00') || '. A 1ª parcela vence em '
                     || to_char(primeira, 'DD/MM/YYYY') || '. O acesso fica liberado enquanto as parcelas estiverem em dia.', 400),
                '/empresa/faturamento', 'acordo:' || novo)
        on conflict (chave) where chave is not null do nothing;
    end if;
    return novo;
end $$;

create or replace function public.cancelar_acordo(acordo bigint, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
    a public.acordos_fatura;
    m text := nullif(trim(coalesce(motivo, '')), '');
begin
    select * into a from public.acordos_fatura x where x.id = acordo;
    if a.id is null or not public.equipe_pode('emitir_faturas', a.empresa_id) then
        raise exception 'acordo não encontrado';
    end if;
    if a.situacao <> 'ativo' then
        raise exception 'só acordo em andamento é cancelado';
    end if;
    if exists (select 1 from public.acordo_parcelas p where p.acordo_id = a.id and p.situacao = 'paga') then
        raise exception 'acordo com parcela paga não é cancelado: as parcelas seguem até quitar ou quebrar';
    end if;
    if m is null or char_length(m) < 5 then
        raise exception 'informe o motivo do cancelamento';
    end if;
    update public.acordo_parcelas set situacao = 'cancelada' where acordo_id = a.id and situacao = 'aberta';
    update public.cobrancas c set situacao = 'cancelada', motivo = 'acordo cancelado'
     where c.situacao = 'pendente' and c.parcela_id in (select p.id from public.acordo_parcelas p where p.acordo_id = a.id);
    perform set_config('motorcob.sistema', '1', true);
    update public.faturas set acordo_id = null where acordo_id = a.id;
    perform set_config('motorcob.sistema', '', true);
    update public.acordos_fatura set situacao = 'cancelado', encerrado_em = now(), encerrado_por = auth.uid(),
                                     encerrado_motivo = left(m, 200)
     where id = a.id;
    if a.informar then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', a.empresa_id, 'atencao', 'Acordo de pagamento cancelado',
                'As faturas do acordo voltaram a ficar em aberto. Veja em Faturamento.', '/empresa/faturamento');
    end if;
end $$;

-- ================================================================ 3. o que a tela mostra
-- Acordos da empresa (ou todos, para a equipe). Situação: em_dia, parcela_vencida, quebrado, quitado, cancelado.
-- O motivo do desconto ou acréscimo só volta para a equipe.
create or replace function public.acordos(empresa bigint default null)
returns table (id bigint, empresa_id bigint, empresa_nome text, situacao text, parcelas int, pagas int,
               valor_faturas numeric, ajuste numeric, ajuste_motivo text, valor_total numeric, valor_pago numeric,
               valor_restante numeric, proxima_parcela bigint, proxima_numero int, proxima_vencimento date,
               proxima_valor numeric, dias_atraso int, quebra_em date, formas text[], faturas bigint[],
               competencias date[], criado_em timestamptz, informado_em timestamptz, encerrado_em timestamptz,
               encerrado_motivo text)
language sql stable security definer set search_path = public as $$
    with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
    select a.id, a.empresa_id, e.nome,
           case when a.situacao <> 'ativo' then a.situacao
                when atraso.venc is not null then 'parcela_vencida' else 'em_dia' end,
           a.parcelas,
           (select count(*)::int from public.acordo_parcelas p where p.acordo_id = a.id and p.situacao = 'paga'
               and p.tipo = 'parcela'),
           a.valor_faturas, a.ajuste, case when public.sou_equipe() then a.ajuste_motivo end, a.valor_total,
           coalesce((select sum(p.valor) from public.acordo_parcelas p where p.acordo_id = a.id and p.situacao = 'paga'), 0),
           coalesce((select sum(p.valor) from public.acordo_parcelas p where p.acordo_id = a.id and p.situacao = 'aberta'), 0),
           prox.id, prox.numero, prox.vencimento, prox.valor,
           case when atraso.venc is not null then (hoje.d - atraso.venc)::int end,
           case when a.situacao = 'ativo' and atraso.venc is not null then atraso.venc + 10 end,
           a.formas,
           array(select f.id from public.faturas f where f.acordo_id = a.id order by f.competencia),
           array(select f.competencia from public.faturas f where f.acordo_id = a.id order by f.competencia),
           a.criado_em, a.informado_em, a.encerrado_em, a.encerrado_motivo
      from public.acordos_fatura a
      join public.empresas e on e.id = a.empresa_id
      cross join hoje
      left join lateral (select p.id, p.numero, p.vencimento, p.valor from public.acordo_parcelas p
                          where p.acordo_id = a.id and p.situacao = 'aberta'
                          order by p.vencimento, p.numero limit 1) prox on true
      left join lateral (select min(p.vencimento) as venc from public.acordo_parcelas p
                          where p.acordo_id = a.id and p.situacao = 'aberta' and p.vencimento < hoje.d) atraso on true
     where public.ve_faturamento(a.empresa_id)
       and (acordos.empresa is null or a.empresa_id = acordos.empresa)
     order by (a.situacao in ('ativo', 'quebrado')) desc, a.criado_em desc
$$;

-- ================================================================ 4. régua das parcelas e inadimplência
-- dívida vencida há N dias: fatura em aberto fora de acordo ou parcela em aberto (inclusive o saldo do quebrado)
create or replace function public.divida_vencida_desde(empresa bigint, dias int) returns date
language sql stable security definer set search_path = public as $$
    select min(v) from (
        select f.vencimento as v from public.faturas f
         where f.empresa_id = empresa and f.situacao = 'aberta' and f.acordo_id is null
           and f.vencimento <= (now() at time zone 'America/Sao_Paulo')::date - dias
        union all
        select p.vencimento from public.acordo_parcelas p
         where p.empresa_id = empresa and p.situacao = 'aberta'
           and p.vencimento <= (now() at time zone 'America/Sao_Paulo')::date - dias) x
$$;

-- lembretes da fatura (SQL 37): fatura em acordo não recebe
create or replace function public.lembretes_para_enviar()
returns table (fatura_id bigint, tipo text)
language sql stable security definer set search_path = public as $$
    with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
    select f.id, t.tipo
      from public.faturas f, hoje,
           lateral (values ('d1', 1), ('d5', 5), ('d7', 7)) as t(tipo, dias)
     where f.situacao = 'aberta' and f.acordo_id is null and f.vencimento is not null
       and f.vencimento <= hoje.d - t.dias and f.vencimento > hoje.d - 30
       and not exists (select 1 from public.fatura_lembretes l where l.fatura_id = f.id and l.tipo = t.tipo)
       -- só o lembrete mais recente que ainda falta: quem já passou do 7º dia recebe o do 7º, não os três
       and t.dias = (select max(x.dias) from (values (1), (5), (7)) as x(dias) where f.vencimento <= hoje.d - x.dias)
     order by f.id, t.dias
$$;

-- lembretes da parcela: no dia seguinte e com 5 dias (o aviso do 7º dia vai no sino, por atualizar_inadimplencia)
create or replace function public.lembretes_parcelas_para_enviar()
returns table (parcela_id bigint, tipo text)
language sql stable security definer set search_path = public as $$
    with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
    select p.id, t.tipo
      from public.acordo_parcelas p
      join public.acordos_fatura a on a.id = p.acordo_id and a.situacao = 'ativo'
      cross join hoje
      cross join lateral (values ('d1', 1), ('d5', 5)) as t(tipo, dias)
     where p.situacao = 'aberta' and p.tipo = 'parcela'
       and p.vencimento <= hoje.d - t.dias and p.vencimento > hoje.d - 10
       and not exists (select 1 from public.parcela_lembretes l where l.parcela_id = p.id and l.tipo = t.tipo)
       and t.dias = (select max(x.dias) from (values (1), (5)) as x(dias) where p.vencimento <= hoje.d - x.dias)
     order by p.id, t.dias
$$;

-- quebra: as parcelas em aberto viram uma cobrança só (o saldo), vencida desde a parcela atrasada
create or replace function public.quebrar_acordo(acordo bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
    a public.acordos_fatura;
    venc date;
    resto numeric;
    atrasada int;
    novo bigint;
begin
    select * into a from public.acordos_fatura x where x.id = acordo and x.situacao = 'ativo' for update;
    if a.id is null then
        return false;
    end if;
    select min(p.vencimento), sum(p.valor) into venc, resto
      from public.acordo_parcelas p where p.acordo_id = a.id and p.situacao = 'aberta';
    select p.numero into atrasada from public.acordo_parcelas p
     where p.acordo_id = a.id and p.situacao = 'aberta' order by p.vencimento, p.numero limit 1;
    update public.cobrancas c set situacao = 'cancelada', motivo = 'acordo quebrado: vale a cobrança do saldo'
     where c.situacao = 'pendente'
       and c.parcela_id in (select p.id from public.acordo_parcelas p where p.acordo_id = a.id and p.situacao = 'aberta');
    update public.acordo_parcelas set situacao = 'cancelada' where acordo_id = a.id and situacao = 'aberta';
    insert into public.acordo_parcelas (acordo_id, empresa_id, numero, tipo, vencimento, valor)
    values (a.id, a.empresa_id, a.parcelas + 1, 'saldo', venc, resto)
    returning id into novo;
    update public.acordos_fatura
       set situacao = 'quebrado', encerrado_em = now(), encerrado_por = null,
           encerrado_motivo = left(atrasada || 'ª parcela com 10 dias de atraso', 200)
     where id = a.id;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    values ('empresa', a.empresa_id, 'erro', 'Acordo de pagamento desfeito',
            left('A ' || atrasada || 'ª parcela ficou 10 dias em atraso. O que falta, R$ '
                 || to_char(resto, 'FM999G999G990D00') || ', voltou a ser cobrado de uma vez em Faturamento.', 400),
            '/empresa/faturamento', 'acordo_quebrado:' || a.id),
           ('equipe', a.empresa_id, 'erro',
            left('Acordo quebrado · ' || (select e.nome from public.empresas e where e.id = a.empresa_id), 140),
            left('Acordo nº ' || a.id || ': ' || atrasada || 'ª parcela com 10 dias de atraso. Saldo de R$ '
                 || to_char(resto, 'FM999G999G990D00') || ' em cobrança.', 400),
            '/console/faturas', 'acordo_quebrado_equipe:' || a.id)
    on conflict (chave) where chave is not null do nothing;
    return true;
end $$;

-- libera a empresa inadimplente que não tem mais dívida vencida há 10 dias (fatura fora de acordo ou parcela)
create or replace function public.liberar_se_em_dia(empresa bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare liberou boolean;
begin
    if public.divida_vencida_desde(empresa, 10) is not null then
        return false;
    end if;
    perform set_config('motorcob.sistema', '1', true);
    update public.empresas set situacao = 'ativa', ativa = true, situacao_motivo = null, situacao_em = now(),
                               situacao_por = null
     where id = empresa and situacao = 'inadimplente';
    liberou := found;
    if liberou then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', empresa, 'pronto', 'Acesso liberado',
                case when exists (select 1 from public.acordos_fatura a where a.empresa_id = empresa and a.situacao = 'ativo')
                     then 'O acordo de pagamento está em dia. Os envios voltam a sair.'
                     else 'O pagamento foi confirmado. Os envios voltam a sair.' end,
                '/empresa/faturamento');
    end if;
    perform set_config('motorcob.sistema', '', true);
    return liberou;
end $$;

-- motor, uma vez por dia: quebra de acordo, avisos do 7º dia, bloqueio no 10º e liberação de quem pagou
create or replace function public.atualizar_inadimplencia() returns int
language plpgsql security definer set search_path = public as $$
declare
    n int := 0; k int; e record;
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
    -- 1. parcela com 10 dias de atraso quebra o acordo (o saldo nasce vencido e entra no bloqueio abaixo)
    for e in select distinct p.acordo_id from public.acordo_parcelas p
               join public.acordos_fatura a on a.id = p.acordo_id and a.situacao = 'ativo'
              where p.situacao = 'aberta' and p.vencimento <= hoje - 10 loop
        if public.quebrar_acordo(e.acordo_id) then n := n + 1; end if;
    end loop;

    -- 2. 7º dia: aviso de bloqueio (fatura fora de acordo) ou de quebra (parcela)
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'empresa', f.empresa_id, 'atencao', 'O acesso será bloqueado em 3 dias',
           left('A fatura de ' || to_char(f.competencia, 'MM/YYYY') || ' venceu em ' || to_char(f.vencimento, 'DD/MM')
                || '. Pague até ' || to_char(f.vencimento + 9, 'DD/MM') || ' para não bloquear o acesso.', 400),
           '/empresa/faturamento', 'bloqueio_em_3:' || f.id
      from public.faturas f
     where f.situacao = 'aberta' and f.acordo_id is null
       and f.vencimento <= hoje - 7 and f.vencimento > hoje - 10
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'empresa', p.empresa_id, 'atencao', 'O acordo de pagamento será desfeito em 3 dias',
           left('A ' || p.numero || 'ª parcela venceu em ' || to_char(p.vencimento, 'DD/MM') || '. Pague até '
                || to_char(p.vencimento + 9, 'DD/MM') || ' para manter o acordo e o acesso.', 400),
           '/empresa/faturamento', 'quebra_em_3:' || p.id
      from public.acordo_parcelas p
      join public.acordos_fatura a on a.id = p.acordo_id and a.situacao = 'ativo'
     where p.situacao = 'aberta' and p.vencimento <= hoje - 7 and p.vencimento > hoje - 10
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;

    -- 3. 10 dias de dívida vencida: inadimplente (a menos que o Master tenha liberado até hoje)
    perform set_config('motorcob.sistema', '1', true);
    for e in
        update public.empresas x
           set situacao = 'inadimplente', ativa = false, situacao_em = now(), situacao_por = null,
               situacao_motivo = left(case when exists (select 1 from public.acordos_fatura a
                                                          where a.empresa_id = x.id and a.situacao = 'quebrado'
                                                            and exists (select 1 from public.acordo_parcelas p
                                                                         where p.acordo_id = a.id and p.situacao = 'aberta'))
                                           then 'Acordo de pagamento quebrado (parcela vencida desde '
                                           else 'Fatura vencida há mais de 10 dias (' end
                   || to_char(public.divida_vencida_desde(x.id, 10), 'DD/MM/YYYY') || ')', 200)
         where x.situacao = 'ativa'
           and (x.liberada_ate is null or x.liberada_ate < hoje)
           and public.divida_vencida_desde(x.id, 10) is not null
        returning x.id, x.nome
    loop
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', e.id, 'erro', 'Acesso bloqueado por fatura vencida',
                'Os envios estão parados. Pague em Faturamento para liberar; volta sozinho quando o pagamento confirmar.',
                '/empresa/faturamento'),
               ('equipe', e.id, 'erro', left('Inadimplente · ' || e.nome, 140),
                'Dívida vencida há mais de 10 dias: acesso bloqueado e envios parados.', '/console/faturas');
        n := n + 1;
    end loop;
    perform set_config('motorcob.sistema', '', true);

    -- 4. quem pagou (ou entrou em acordo) volta
    for e in select x.id from public.empresas x where x.situacao = 'inadimplente' loop
        if public.liberar_se_em_dia(e.id) then n := n + 1; end if;
    end loop;
    return n;
end $$;

-- parcela paga: com todas pagas, o acordo fica quitado e as faturas, pagas (via acordo); libera na hora
create or replace function public.parcela_paga() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.acordos_fatura;
begin
    if new.situacao = 'paga' and old.situacao is distinct from 'paga' then
        select * into a from public.acordos_fatura x where x.id = new.acordo_id;
        if a.situacao in ('ativo', 'quebrado')
           and not exists (select 1 from public.acordo_parcelas p where p.acordo_id = new.acordo_id and p.situacao = 'aberta') then
            update public.acordos_fatura set situacao = 'quitado', encerrado_em = now(),
                   encerrado_motivo = case when a.situacao = 'quebrado'
                                           then left('Saldo pago depois da quebra (' || coalesce(a.encerrado_motivo, '') || ')', 200)
                                           else 'Todas as parcelas pagas' end
             where id = a.id;
            update public.faturas set situacao = 'paga', paga_em = coalesce(new.paga_em, (now() at time zone 'America/Sao_Paulo')::date)
             where acordo_id = a.id and situacao in ('aberta', 'vencida');
            insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
            values ('empresa', a.empresa_id, 'pronto', 'Acordo de pagamento quitado',
                    'Todas as parcelas foram pagas e as faturas do acordo estão quitadas.', '/empresa/faturamento',
                    'acordo_quitado:' || a.id)
            on conflict (chave) where chave is not null do nothing;
        end if;
        perform public.liberar_se_em_dia(new.empresa_id);
    end if;
    return new;
end $$;
drop trigger if exists parcela_paga on public.acordo_parcelas;
create trigger parcela_paga after update of situacao on public.acordo_parcelas
    for each row execute function public.parcela_paga();

-- acordos com "Informar o cliente" ainda sem e-mail (o motor chama a função "cobranca" para cada um)
create or replace function public.acordos_para_informar() returns setof bigint
language sql stable security definer set search_path = public as $$
    select a.id from public.acordos_fatura a
     where a.informar and a.informado_em is null and a.situacao = 'ativo' and a.criado_em > now() - interval '3 days'
     order by a.id
$$;

-- ================================================================ 5. baixa automática também da parcela
-- (mesma assinatura do SQL 23; a parcela paga dispara parcela_paga)
create or replace function public.baixar_cobranca(p_id_externo text, p_pago_em timestamptz default now())
returns table (empresa_id bigint, fatura_id bigint, recarga_id bigint, valor numeric, baixou boolean)
language plpgsql security definer set search_path = public as $$
declare
    c public.cobrancas;
    n int := 0;
    dia date := (coalesce(p_pago_em, now()) at time zone 'America/Sao_Paulo')::date;
begin
    update public.cobrancas x set situacao = 'paga', paga_em = coalesce(p_pago_em, now())
     where x.id_externo = p_id_externo and x.situacao <> 'paga'
    returning * into c;
    if c.id is null then
        return query select x.empresa_id, x.fatura_id, x.recarga_id, x.valor, false
                       from public.cobrancas x where x.id_externo = p_id_externo;
        return;
    end if;
    if c.fatura_id is not null then
        update public.faturas f set situacao = 'paga', paga_em = dia
         where f.id = c.fatura_id and f.situacao in ('aberta', 'vencida');
        get diagnostics n = row_count;
    elsif c.recarga_id is not null then
        update public.recargas r set situacao = 'paga', paga_em = coalesce(p_pago_em, now())
         where r.id = c.recarga_id and r.situacao = 'pendente';
        get diagnostics n = row_count;
    else
        -- parcela: vale mesmo se a cobrança foi cancelada pela quebra (o dinheiro entrou)
        update public.acordo_parcelas p set situacao = 'paga', paga_em = dia
         where p.id = c.parcela_id and p.situacao in ('aberta', 'cancelada');
        get diagnostics n = row_count;
    end if;
    -- as outras formas geradas para o mesmo pagamento deixam de valer
    update public.cobrancas x set situacao = 'cancelada', motivo = 'pago por outra forma'
     where x.situacao = 'pendente' and x.id <> c.id
       and (x.fatura_id = c.fatura_id or x.recarga_id = c.recarga_id or x.parcela_id = c.parcela_id);
    return query select c.empresa_id, c.fatura_id, c.recarga_id, c.valor, n > 0;
end $$;

-- ================================================================ permissões
do $$
declare f text;
begin
    foreach f in array array['public.lancar_acordo(bigint, bigint[], int, date, text[], numeric, text, boolean)',
                             'public.cancelar_acordo(bigint, text)', 'public.acordos(bigint)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
    foreach f in array array['public.lembretes_para_enviar()', 'public.lembretes_parcelas_para_enviar()',
                             'public.atualizar_inadimplencia()', 'public.acordos_para_informar()',
                             'public.quebrar_acordo(bigint)', 'public.divida_vencida_desde(bigint, int)',
                             'public.liberar_se_em_dia(bigint)', 'public.baixar_cobranca(text, timestamptz)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;
revoke all on function public.parcela_paga() from public, anon, authenticated;
revoke all on function public.proteger_acordo_fatura() from public, anon, authenticated;
