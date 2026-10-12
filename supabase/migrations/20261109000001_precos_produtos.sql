-- Preços por produto, cada um cobrado isolado, e Orquestração opcional.
-- * Catálogo de itens cobráveis (cobranca_itens): Orquestração (contratos), SMS, E-mail, RCS (Basic, Single,
--   Conversacional) e WhatsApp. Produto novo do MotorCob = uma linha nova no catálogo, sem mudar o banco.
--   "preco_de": o item usa o preço e soma o volume de outro (resposta de SMS = preço do SMS).
-- * Preço de cada item por empresa, com vigência por mês e quatro modelos:
--     flat         um preço por unidade
--     faixa        tabela escalonada: o volume do mês escolhe a faixa e esse preço vale para todas as unidades
--     progressivo  tabela escalonada progressiva: cada faixa cobra o seu preço só nas unidades dentro dela
--     mensalidade  valor fixo no mês (só cobra com o módulo do produto ligado)
--   Todo modelo por unidade aceita um mínimo mensal (o complemento entra como linha própria na fatura).
-- * As telas antigas (planos_empresa e tarifas_mensageria) continuam valendo: o que for gravado nelas vira preço
--   do mês corrente. planos_empresa passa a guardar só o dia de vencimento quando o cliente não tem Orquestração.
-- * Orquestração liga e desliga por empresa (Empresa › Módulos): desligada, o motor não roda a rotina da empresa,
--   a Saúde não cobra a rotina e a mensalidade não entra na fatura.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- catálogo
create table if not exists public.cobranca_itens (
    codigo     text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
    produto    text not null check (produto ~ '^[a-z0-9_]{2,30}$'),
    nome       text not null check (length(trim(nome)) between 2 and 60),
    unidade    text not null check (length(trim(unidade)) between 2 and 30),
    preco_de   text references public.cobranca_itens (codigo),
    modulo     text,
    ordem      int not null default 100,
    ativo      boolean not null default true,
    check (preco_de is null or preco_de <> codigo)
);
comment on table public.cobranca_itens is 'Itens cobráveis do MotorCob. Produto novo = linha nova.';
comment on column public.cobranca_itens.preco_de is 'Usa o preço (e soma o volume) de outro item. Ex.: resposta de SMS.';
comment on column public.cobranca_itens.modulo is 'Módulo que precisa estar ligado para a mensalidade entrar na fatura.';
insert into public.cobranca_itens (codigo, produto, nome, unidade, preco_de, modulo, ordem) values
    ('contratos',          'orquestracao', 'Orquestração',        'contrato', null,  'orquestracao', 1),
    ('sms',                'sms',          'SMS',                 'mensagem', null,  'mensageria',   10),
    ('sms_resposta',       'sms',          'SMS · respostas',     'resposta', 'sms', 'mensageria',   11),
    ('email',              'email',        'E-mail',              'mensagem', null,  'mensageria',   20),
    ('rcs_basic',          'rcs',          'RCS Basic',           'mensagem', null,  'mensageria',   30),
    ('rcs_single',         'rcs',          'RCS Single',          'mensagem', null,  'mensageria',   31),
    ('rcs_conversacional', 'rcs',          'RCS Conversacional',  'sessão',   null,  'mensageria',   32),
    ('whatsapp_marketing', 'whatsapp',     'WhatsApp marketing',  'conversa', null,  'mensageria',   40),
    ('whatsapp_utilidade', 'whatsapp',     'WhatsApp utilidade',  'conversa', null,  'mensageria',   41),
    ('whatsapp_servico',   'whatsapp',     'WhatsApp serviço',    'conversa', null,  'mensageria',   42)
on conflict (codigo) do nothing;
alter table public.cobranca_itens enable row level security;
drop policy if exists cobranca_itens_ver on public.cobranca_itens;
create policy cobranca_itens_ver on public.cobranca_itens for select to authenticated using (true);
drop policy if exists cobranca_itens_gravar on public.cobranca_itens;
create policy cobranca_itens_gravar on public.cobranca_itens for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.cobranca_itens from anon;

-- consumo do mês aceita qualquer item do catálogo (resposta de SMS e produtos novos)
alter table public.consumo_mensageria drop constraint if exists consumo_mensageria_item_check;
alter table public.consumo_mensageria drop constraint if exists consumo_mensageria_item_fkey;
alter table public.consumo_mensageria add constraint consumo_mensageria_item_fkey
    foreign key (item) references public.cobranca_itens (codigo);

-- ---------------------------------------------------------------- preços por empresa (com vigência por mês)
create table if not exists public.precos_empresa (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    item           text not null references public.cobranca_itens (codigo),
    modelo         text not null check (modelo in ('flat', 'faixa', 'progressivo', 'mensalidade')),
    preco          numeric(14, 5) check (preco >= 0),
    minimo         numeric(14, 2) not null default 0 check (minimo >= 0),
    vigente_desde  date not null default date_trunc('month', current_date)::date
                   check (extract(day from vigente_desde) = 1),
    criado_em      timestamptz not null default now(),
    criado_por     uuid default auth.uid() references auth.users (id),
    unique (empresa_id, item, vigente_desde),
    check ((modelo in ('flat', 'mensalidade')) = (preco is not null)),
    check (modelo <> 'mensalidade' or minimo = 0)
);
comment on column public.precos_empresa.preco is 'flat: preço por unidade. mensalidade: valor do mês. faixa/progressivo: ver precos_faixas.';
comment on column public.precos_empresa.vigente_desde is 'Primeiro mês em que este preço vale (o anterior vale até o mês anterior).';
create table if not exists public.precos_faixas (
    preco_id  bigint not null references public.precos_empresa (id) on delete cascade,
    ate       bigint check (ate > 0),
    preco     numeric(14, 5) not null check (preco >= 0)
);
comment on column public.precos_faixas.ate is 'Última unidade da faixa; vazio = acima da faixa anterior (última faixa).';
create unique index if not exists precos_faixas_unica on public.precos_faixas (preco_id, coalesce(ate, 9223372036854775807));

alter table public.precos_empresa enable row level security;
alter table public.precos_faixas enable row level security;
drop policy if exists precos_ver on public.precos_empresa;
create policy precos_ver on public.precos_empresa for select to authenticated using (public.ve_faturamento(empresa_id));
drop policy if exists precos_faixas_ver on public.precos_faixas;
create policy precos_faixas_ver on public.precos_faixas for select to authenticated
    using (exists (select 1 from public.precos_empresa p where p.id = preco_id and public.ve_faturamento(p.empresa_id)));
revoke all on public.precos_empresa, public.precos_faixas from anon;
revoke insert, update, delete on public.precos_empresa, public.precos_faixas from authenticated;

-- preço que vale no mês: a última vigência até o mês; antes da primeira, vale a primeira
create or replace function public.preco_vigente(empresa bigint, it text, competencia date) returns public.precos_empresa
language sql stable security definer set search_path = public as $$
    select p.* from public.precos_empresa p
     where p.empresa_id = empresa and p.item = it
     order by (p.vigente_desde <= date_trunc('month', competencia)::date) desc,
              case when p.vigente_desde <= date_trunc('month', competencia)::date then p.vigente_desde end desc nulls last,
              p.vigente_desde
     limit 1
$$;
revoke execute on function public.preco_vigente(bigint, text, date) from public, anon;

-- valor de um volume no mês pelo preço vigente (sem o mínimo). Sem preço: nenhuma linha.
create or replace function public.valor_item(empresa bigint, it text, qtd numeric, competencia date)
returns table (valor numeric, preco_medio numeric, modelo text, minimo numeric, detalhe text)
language plpgsql stable security definer set search_path = public as $$
declare
    p public.precos_empresa;
    f record;
    anterior bigint := 0;
    total numeric := 0;
    faixa_qtd numeric;
begin
    p := public.preco_vigente(empresa, it, competencia);
    if p.id is null then
        return;
    end if;
    if p.modelo = 'flat' then
        return query select round(qtd * p.preco, 2), p.preco, p.modelo, p.minimo, null::text;
    elsif p.modelo = 'mensalidade' then
        return query select round(p.preco, 2), p.preco, p.modelo, 0::numeric, 'valor fixo do mês'::text;
    elsif p.modelo = 'faixa' then
        select x.ate, x.preco into f from public.precos_faixas x
         where x.preco_id = p.id and (x.ate is null or qtd <= x.ate) order by x.ate nulls last limit 1;
        return query select round(qtd * f.preco, 2), f.preco, p.modelo, p.minimo,
            case when f.ate is null then 'faixa acima de ' || coalesce((select max(x.ate) from public.precos_faixas x
                                                                         where x.preco_id = p.id), 0)
                 else 'faixa até ' || f.ate end;
    else
        for f in select x.ate, x.preco from public.precos_faixas x where x.preco_id = p.id order by x.ate nulls last loop
            exit when qtd <= anterior;
            faixa_qtd := coalesce(least(qtd, f.ate), qtd) - anterior;
            total := total + faixa_qtd * f.preco;
            anterior := coalesce(f.ate, anterior);
        end loop;
        return query select round(total, 2), case when qtd > 0 then round(total / qtd, 5) else 0 end, p.modelo,
                            p.minimo, 'tabela progressiva'::text;
    end if;
end $$;
revoke execute on function public.valor_item(bigint, text, numeric, date) from public, anon;

-- gravar um preço (só o Master). faixas: [{"ate": 10000, "preco": 0.07}, {"ate": null, "preco": 0.06}]
create or replace function public.salvar_preco(empresa bigint, item text, modelo text, preco numeric default null,
                                               minimo numeric default 0, faixas jsonb default null,
                                               vigente_desde date default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', coalesce(vigente_desde, current_date))::date;
    pid bigint;
    n int;
    abertas int;
    ordenadas boolean;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob define preços';
    end if;
    if not exists (select 1 from public.cobranca_itens c where c.codigo = salvar_preco.item and c.preco_de is null) then
        raise exception 'item sem preço próprio ou desconhecido: %', salvar_preco.item;
    end if;
    if salvar_preco.modelo in ('faixa', 'progressivo') then
        if faixas is null or jsonb_typeof(faixas) <> 'array' or jsonb_array_length(faixas) < 2 then
            raise exception 'tabela escalonada precisa de pelo menos duas faixas';
        end if;
        select count(*), count(*) filter (where f ->> 'ate' is null) into n, abertas from jsonb_array_elements(faixas) f;
        if abertas <> 1 then
            raise exception 'a última faixa fica sem limite (acima de) e só ela';
        end if;
        select coalesce(bool_and(a < b), true) into ordenadas from (
            select (f ->> 'ate')::bigint as a, lead((f ->> 'ate')::bigint) over (order by (f ->> 'ate')::bigint) as b
              from jsonb_array_elements(faixas) f where f ->> 'ate' is not null) x where b is not null;
        if not ordenadas or exists (select 1 from jsonb_array_elements(faixas) f
                                    where (f ->> 'ate')::bigint <= 0 or (f ->> 'preco') is null
                                       or (f ->> 'preco')::numeric < 0) then
            raise exception 'faixas inválidas: limites crescentes, maiores que zero, e preço em todas';
        end if;
    elsif salvar_preco.preco is null then
        raise exception 'informe o preço';
    end if;
    delete from public.precos_empresa p where p.empresa_id = empresa and p.item = salvar_preco.item and p.vigente_desde = mes;
    insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde)
    values (empresa, salvar_preco.item, salvar_preco.modelo,
            case when salvar_preco.modelo in ('flat', 'mensalidade') then salvar_preco.preco end,
            case when salvar_preco.modelo = 'mensalidade' then 0 else coalesce(salvar_preco.minimo, 0) end, mes)
    returning id into pid;
    if salvar_preco.modelo in ('faixa', 'progressivo') then
        insert into public.precos_faixas (preco_id, ate, preco)
        select pid, (f ->> 'ate')::bigint, (f ->> 'preco')::numeric from jsonb_array_elements(faixas) f;
    end if;
    return pid;
end $$;
revoke execute on function public.salvar_preco(bigint, text, text, numeric, numeric, jsonb, date) from public, anon;
grant execute on function public.salvar_preco(bigint, text, text, numeric, numeric, jsonb, date) to authenticated;

-- ---------------------------------------------------------------- telas antigas continuam valendo
alter table public.planos_empresa alter column orquestracao_modelo drop not null;
alter table public.planos_empresa alter column orquestracao_valor drop not null;
comment on table public.planos_empresa is
    'Cobrança da empresa: dia de vencimento (e o modelo antigo da Orquestração, espelhado em precos_empresa).';

create or replace function public.espelhar_plano() returns trigger
language plpgsql security definer set search_path = public as $$
declare mes date := date_trunc('month', current_date)::date;
begin
    if new.orquestracao_modelo is not null and new.orquestracao_valor is not null then
        delete from public.precos_empresa where empresa_id = new.empresa_id and item = 'contratos' and vigente_desde = mes;
        insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde)
        values (new.empresa_id, 'contratos',
                case when new.orquestracao_modelo = 'mensalidade' then 'mensalidade' else 'flat' end,
                new.orquestracao_valor,
                case when new.orquestracao_modelo = 'mensalidade' then 0 else new.orquestracao_minimo end, mes);
    end if;
    return new;
end $$;
drop trigger if exists espelhar_plano on public.planos_empresa;
create trigger espelhar_plano after insert or update on public.planos_empresa
    for each row execute function public.espelhar_plano();

create or replace function public.espelhar_tarifa() returns trigger
language plpgsql security definer set search_path = public as $$
declare mes date := date_trunc('month', current_date)::date;
begin
    delete from public.precos_empresa where empresa_id = new.empresa_id and item = new.item and vigente_desde = mes;
    insert into public.precos_empresa (empresa_id, item, modelo, preco, vigente_desde)
    values (new.empresa_id, new.item, 'flat', new.preco, mes);
    return new;
end $$;
drop trigger if exists espelhar_tarifa on public.tarifas_mensageria;
create trigger espelhar_tarifa after insert or update on public.tarifas_mensageria
    for each row execute function public.espelhar_tarifa();

-- o que já estava cadastrado vira preço (uma vez)
insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde)
select p.empresa_id, 'contratos', case when p.orquestracao_modelo = 'mensalidade' then 'mensalidade' else 'flat' end,
       p.orquestracao_valor, case when p.orquestracao_modelo = 'mensalidade' then 0 else p.orquestracao_minimo end,
       date_trunc('month', coalesce(p.inicio, current_date))::date
  from public.planos_empresa p
 where p.orquestracao_modelo is not null and p.orquestracao_valor is not null
   and not exists (select 1 from public.precos_empresa x where x.empresa_id = p.empresa_id and x.item = 'contratos');
insert into public.precos_empresa (empresa_id, item, modelo, preco, vigente_desde)
select t.empresa_id, t.item, 'flat', t.preco, date_trunc('month', t.atualizado_em)::date
  from public.tarifas_mensageria t
 where not exists (select 1 from public.precos_empresa x where x.empresa_id = t.empresa_id and x.item = t.item);

-- ---------------------------------------------------------------- prévia da fatura pelos preços
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
        if c.codigo = 'contratos' then
            select count(*) into qtd from public.contratos_mes m where m.empresa_id = empresa and m.competencia = mes;
            qtd_extra := 0;
        else
            select coalesce(sum(m.quantidade), 0) into qtd from public.consumo_mensageria m
             where m.empresa_id = empresa and m.competencia = mes and m.item = c.codigo;
            select coalesce(sum(m.quantidade), 0) into qtd_extra from public.consumo_mensageria m
              join public.cobranca_itens x on x.codigo = m.item and x.preco_de = c.codigo
             where m.empresa_id = empresa and m.competencia = mes;
        end if;
        pv := public.preco_vigente(empresa, c.codigo, mes);
        codigo_fatura := case when c.codigo = 'contratos' then 'orquestracao' else c.codigo end;
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
            nome || case when c.codigo = 'contratos' then ' · contratos no mês'
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
revoke execute on function public.previa_fatura(bigint, date) from public, anon;
grant execute on function public.previa_fatura(bigint, date) to authenticated;

-- fechar: vencimento do cadastro de cobrança (padrão dia 10); precisa de pelo menos um preço
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
    if not exists (select 1 from public.precos_empresa x where x.empresa_id = empresa) then
        raise exception 'empresa sem preço cadastrado';
    end if;
    if exists (select 1 from public.faturas f where f.empresa_id = empresa and f.competencia = mes) then
        raise exception 'fatura deste mês já foi fechada';
    end if;
    select * into p from public.planos_empresa where empresa_id = empresa;
    select coalesce(sum(v.valor), 0) into total from public.previa_fatura(empresa, mes) v;
    insert into public.faturas (empresa_id, competencia, situacao, valor_total, itens_total, vencimento, modelo)
        values (empresa, mes, 'rascunho', total, total,
                (mes + interval '1 month')::date + (coalesce(p.vencimento_dia, 10) - 1),
                coalesce(p.orquestracao_modelo, 'por_produto'))
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
    for e in select x.id from public.empresas x
              where x.situacao in ('ativa', 'implantacao', 'suspensa')
                and exists (select 1 from public.precos_empresa p where p.empresa_id = x.id)
                and not exists (select 1 from public.faturas f where f.empresa_id = x.id and f.competencia = mes)
              order by x.id loop
        perform public.fechar_fatura(e, mes);
        n := n + 1;
    end loop;
    return n;
end $$;
revoke execute on function public.gerar_rascunhos(date) from public, anon;
grant execute on function public.gerar_rascunhos(date) to authenticated;

-- ---------------------------------------------------------------- Orquestração opcional
-- a rotina do dia só é cobrada pela Saúde de quem tem a Orquestração ligada
create or replace function public.orquestracao_ligada(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((select m.ativo from public.empresa_modulos m where m.empresa_id = eid and m.modulo = 'orquestracao'),
                    false)
$$;
revoke execute on function public.orquestracao_ligada(bigint) from public, anon;
grant execute on function public.orquestracao_ligada(bigint) to authenticated;

-- Saúde do sistema: sem rotina hoje só é crítico para quem tem a Orquestração ligada
create or replace function public.saude_empresas()
returns table (empresa_id bigint, nome text, situacao text, nivel text, rotina_hoje boolean,
               ultima_rotina timestamptz, ultima_rotina_status text, ultima_rotina_erro text,
               cargas_erro_7d int, cargas_aguardando int, lotes_parados int, lotes_aguardando int,
               chamados_atrasados int, faturas_vencidas int, valor_vencido numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    agora timestamptz := now();
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    hora int := extract(hour from now() at time zone 'America/Sao_Paulo');
    dia_util boolean := extract(isodow from (now() at time zone 'America/Sao_Paulo')) < 6;
begin
    if not public.sou_equipe() then
        raise exception 'só a equipe MotorCob vê a saúde do sistema';
    end if;
    return query
    with base as (
        select e.id, e.nome, e.situacao,
               ult.iniciada_em, ult.status, ult.erro,
               exists (select 1 from public.execucoes x where x.empresa_id = e.id and x.data_ref = hoje
                       and x.status = 'ok') as hoje_ok,
               public.orquestracao_ligada(e.id) as orq,
               (select count(*) from public.envios v where v.empresa_id = e.id and v.status = 'erro'
                  and v.enviado_em > agora - interval '7 days')::int as c_erro,
               (select count(*) from public.envios v where v.empresa_id = e.id and v.status = 'aguardando')::int as c_agu,
               (select count(*) from public.mensageria_lotes l where l.empresa_id = e.id
                  and l.situacao in ('agendado', 'enviando')
                  and (l.data < hoje or l.atualizado_em < agora - interval '1 hour'))::int as l_par,
               (select count(*) from public.mensageria_lotes l where l.empresa_id = e.id and l.data = hoje
                  and l.situacao = 'aguardando_aprovacao')::int as l_agu,
               (select count(*) from public.chamados c where c.empresa_id = e.id and c.situacao <> 'resolvido'
                  and c.situacao <> 'aguardando_cliente'
                  and c.criado_em < agora - case when c.prioridade = 'alta' then interval '4 hours'
                                                 else interval '24 hours' end)::int as ch_atr,
               (select count(*) from public.faturas f where f.empresa_id = e.id and f.situacao = 'aberta'
                  and f.vencimento < hoje)::int as fat_n,
               (select coalesce(sum(f.valor_total), 0) from public.faturas f where f.empresa_id = e.id
                  and f.situacao = 'aberta' and f.vencimento < hoje) as fat_v
          from public.empresas e
          left join lateral (select x.iniciada_em, x.status, x.erro from public.execucoes x
                              where x.empresa_id = e.id order by x.iniciada_em desc limit 1) ult on true
         where e.ativa and e.situacao <> 'encerrada'
    )
    select b.id, b.nome, b.situacao,
           case when b.status = 'erro' or (b.orq and dia_util and hora >= 9 and not b.hoje_ok and b.situacao = 'ativa') then 'critico'
                when b.c_erro + b.c_agu + b.l_par + b.l_agu + b.ch_atr + b.fat_n > 0 then 'atencao'
                else 'ok' end,
           b.hoje_ok, b.iniciada_em, b.status, left(b.erro, 200),
           b.c_erro, b.c_agu, b.l_par, b.l_agu, b.ch_atr, b.fat_n, b.fat_v
      from base b
     order by case when b.status = 'erro' or (b.orq and dia_util and hora >= 9 and not b.hoje_ok and b.situacao = 'ativa') then 0
                   when b.c_erro + b.c_agu + b.l_par + b.l_agu + b.ch_atr + b.fat_n > 0 then 1 else 2 end, b.nome;
end $$;
revoke execute on function public.saude_empresas() from public, anon;
grant execute on function public.saude_empresas() to authenticated;

-- ---------------------------------------------------------------- auditoria
do $$
declare t text;
begin
    foreach t in array array['cobranca_itens', 'precos_empresa'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
