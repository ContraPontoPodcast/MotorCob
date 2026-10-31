-- SQL 61 · Margem mínima dos itens de IA (decisão do dono: a IA é revendida)
-- Todo item de IA tem de dar margem de contribuição de pelo menos 70% para o MotorCX, com a mesma definição da
-- mensageria (SQL 18 · rotas_margem): %MC = (receita − impostos − custo) ÷ receita. Logo:
--     preço mínimo = custo unitário ÷ (1 − impostos% − MC mínima da IA%)
-- arredondado PARA CIMA em centavos (ou em 5 casas, a precisão dos preços, quando o mínimo fica abaixo de R$ 0,10).
-- 1. cobranca_itens.eh_ia: marca os itens de IA (o guarda vale para qualquer item marcado). Hoje: voz_minuto_ia,
--    voz_minuto_ia_pico, voz_transcricao (SQL 56), ia_geracao_fluxo (SQL 58), ia_roleplay (SQL 59). Item novo com
--    código "ia_…" ou do produto speech_analytics nasce marcado (gancho para o Speech Analytics, SQL 60); outro item
--    novo de IA: o Master marca (update public.cobranca_itens set eh_ia = true where codigo = '…').
-- 2. custos_ia: custo REAL por unidade do item (separado do preço), com moeda, cotação e vigência; opcionalmente o
--    custo por mil tokens, quando o uso chega em tokens (geração de fluxo). Só o Master vê e grava (salvar_custo_ia).
-- 3. consumo_ia: o uso de cada mês com a quantidade e o custo real (tokens × custo, minutos × custo ou o custo que o
--    fornecedor informou). Só o Master vê. O cliente é cobrado SEMPRE por preço × quantidade (consumo_mensageria →
--    fatura), nunca pelo custo. registrar_consumo_ia() grava os dois de uma vez (VM: service_role); roleplay
--    (concluir_roleplay_lote) e geração de fluxo (registrar_geracao_fluxo_voz) passam a usá-la.
-- 4. parametros_margem.mc_minima_ia_pct (padrão 70; só o Master muda).
-- 5. Guarda: gravar preço de item de IA (preço de tabela/mínimo do catálogo, preço da empresa em precos_empresa,
--    faixas em precos_faixas, por salvar_preco, salvar_preco_vigencia ou direto) abaixo do mínimo é recusado com a
--    mensagem que diz o menor preço aceito. Vale até para o Master (não há "abaixo do mínimo com motivo" na IA).
--    Item de IA sem custo cadastrado não recebe preço de empresa; mensalidade não vale para item de IA.
--    Custo novo (ou impostos/MC mínima novos) não muda preço nenhum: ia_precos_abaixo_minimo() lista o que ficou
--    abaixo (só o Master), e salvar_custo_ia devolve quantos ficaram.
-- 6. Preço padrão de item de IA sem preço de tabela = o preço mínimo (no primeiro custo cadastrado).
-- 7. margem_ia(competência): por empresa e item, quantidade, receita, impostos, custo, MC e %MC (só o Master).
--    itens_ia(): catálogo da IA com custo, preço mínimo, tabela e %MC (só o Master).
-- Custos iniciais (PREMISSAS, confirmar com os contratos; o Master troca em Console › Margem › IA): cotação
-- R$ 5,60/US$; minuto de IA e minuto no pico US$ 0,08 (tabela pública do provedor de voz); transcrição US$ 0,22/h
-- (US$ 0,00367/min); LLM dos testes e da geração US$ 0,60 por milhão de tokens (preço de saída, conservador),
-- logo ia_roleplay US$ 0,0006 por mil tokens e ia_geracao_fluxo US$ 0,03 por geração (≈ 50 mil tokens, até 3
-- tentativas). Só entram se o item ainda não tiver custo.
-- Depende dos SQL 18 (margem), 30 (preço mínimo), 56, 58 e 59. Pode rodar de novo sem erro. Rode de novo depois do
-- SQL 60 (para marcar os itens dele) e sempre que rodar de novo o SQL 30, 58 ou 59: eles recriam salvar_preco,
-- registrar_geracao_fluxo_voz e concluir_roleplay_lote sem os trechos deste SQL (os gatilhos do guarda continuam).
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select codigo, eh_ia, preco_minimo, preco_tabela,
--          (select round(c.custo_unitario * c.cotacao, 5) from public.custos_ia c where c.item = i.codigo
--            order by c.vigente_desde desc limit 1) as custo_brl,
--          public.preco_minimo_ia(codigo) as preco_minimo_ia
--     from public.cobranca_itens i where eh_ia order by ordem;                                -- 5 itens, tabela ≥ mínimo da IA
--   select mc_minima_ia_pct from public.parametros_margem;                                   -- 70.00
--   select count(*) from public.cobranca_itens
--    where eh_ia and preco_tabela < public.preco_minimo_ia(codigo);                         -- 0
--   select has_table_privilege('authenticated', 'public.consumo_ia', 'insert') as site_grava, -- false
--          (select count(*) from pg_tables where schemaname = 'public'
--             and tablename in ('custos_ia', 'consumo_ia') and not rowsecurity) as sem_rls;   -- 0

create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then          -- já aplicado
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

-- ================================================================ 1. itens de IA
alter table public.cobranca_itens add column if not exists eh_ia boolean not null default false;
comment on column public.cobranca_itens.eh_ia is
    'Item de IA revendido: preço nunca abaixo do mínimo da IA (custo ÷ (1 − impostos − MC mínima da IA)).';
update public.cobranca_itens set eh_ia = true
 where not eh_ia
   and (codigo in ('voz_minuto_ia', 'voz_minuto_ia_pico', 'voz_transcricao', 'ia_geracao_fluxo', 'ia_roleplay')
        or codigo like 'ia\_%' or produto = 'speech_analytics');

-- ================================================================ 2. parâmetros
alter table public.parametros_margem
    add column if not exists mc_minima_ia_pct numeric(5, 2) not null default 70 check (mc_minima_ia_pct between 0 and 99);
comment on column public.parametros_margem.mc_minima_ia_pct is
    'MC mínima (%) de todo item de IA: preço abaixo do que ela exige é recusado. Só o Master muda.';

create or replace function public.validar_parametros_margem() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.impostos_pct + new.mc_minima_ia_pct >= 100 then
        raise exception '%', format('impostos (%s%%) + MC mínima da IA (%s%%) chegam a 100%%: nenhum preço daria essa margem',
                                    new.impostos_pct, new.mc_minima_ia_pct);
    end if;
    return new;
end $$;
drop trigger if exists validar_parametros_margem on public.parametros_margem;
create trigger validar_parametros_margem before insert or update on public.parametros_margem
    for each row execute function public.validar_parametros_margem();

-- ================================================================ 3. custo real dos itens de IA (só o Master)
create table if not exists public.custos_ia (
    id                bigint generated always as identity primary key,
    item              text not null references public.cobranca_itens (codigo),
    custo_unitario    numeric(14, 6) not null check (custo_unitario > 0),
    custo_mil_tokens  numeric(14, 6) check (custo_mil_tokens is null or custo_mil_tokens > 0),
    moeda             text not null default 'BRL' check (moeda in ('BRL', 'USD', 'EUR')),
    cotacao           numeric(10, 4) not null default 1 check (cotacao > 0),
    vigente_desde     date not null default current_date,
    premissa          text check (premissa is null or char_length(premissa) <= 300),
    criado_em         timestamptz not null default now(),
    criado_por        uuid default auth.uid() references auth.users (id) on delete set null,
    unique (item, vigente_desde),
    check (moeda <> 'BRL' or cotacao = 1)
);
comment on table public.custos_ia is
    'Custo do MotorCX por unidade de cada item de IA (na unidade do item), com vigência. Só o Master vê.';
comment on column public.custos_ia.custo_unitario is 'Custo por unidade do item (minuto, mil tokens, geração…), na moeda.';
comment on column public.custos_ia.custo_mil_tokens is
    'Opcional: custo por mil tokens, usado quando o uso chega em tokens (ex.: geração de fluxo). Na moeda.';
comment on column public.custos_ia.cotacao is 'Reais por unidade da moeda na data do cadastro (BRL = 1).';

create or replace function public.validar_custo_ia() returns trigger
language plpgsql set search_path = public as $$
begin
    if not exists (select 1 from public.cobranca_itens c where c.codigo = new.item and c.eh_ia) then
        raise exception 'o item % não é de IA', new.item;
    end if;
    new.premissa := nullif(trim(coalesce(new.premissa, '')), '');
    return new;
end $$;
drop trigger if exists validar_custo_ia on public.custos_ia;
create trigger validar_custo_ia before insert or update on public.custos_ia
    for each row execute function public.validar_custo_ia();

-- uso do mês com custo real (o motor e a VM gravam por registrar_consumo_ia)
create table if not exists public.consumo_ia (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    competencia    date not null check (extract(day from competencia) = 1),
    item           text not null references public.cobranca_itens (codigo),
    quantidade     numeric(18, 4) not null default 0 check (quantidade >= 0),
    tokens         bigint not null default 0 check (tokens >= 0),
    custo          numeric(14, 5) not null default 0 check (custo >= 0),
    registros      int not null default 0 check (registros >= 0),
    sem_custo      int not null default 0 check (sem_custo >= 0),
    atualizado_em  timestamptz not null default now(),
    primary key (empresa_id, competencia, item)
);
comment on table public.consumo_ia is
    'Uso dos itens de IA no mês com o custo real (R$). Só o Master vê. A fatura usa consumo_mensageria (preço × quantidade).';
comment on column public.consumo_ia.quantidade is 'Quantidade exata na unidade do item (ex.: 2,5 mil tokens); a fatura arredonda para cima por registro.';
comment on column public.consumo_ia.sem_custo is 'Registros sem custo cadastrado na data (custo 0 neles; aparece como sem_custo na margem).';

alter table public.custos_ia enable row level security;
alter table public.consumo_ia enable row level security;
drop policy if exists custos_ia_ver on public.custos_ia;
create policy custos_ia_ver on public.custos_ia for select to authenticated using (public.admin_equipe());
drop policy if exists consumo_ia_ver on public.consumo_ia;
create policy consumo_ia_ver on public.consumo_ia for select to authenticated using (public.admin_equipe());
revoke all on public.custos_ia, public.consumo_ia from anon;
revoke insert, update, delete on public.custos_ia, public.consumo_ia from authenticated;

-- custo em R$ por unidade do item numa data (nulo = sem custo)
create or replace function public.custo_ia_vigente(it text, dia date default current_date) returns numeric
language sql stable security definer set search_path = public as $$
    select round(c.custo_unitario * c.cotacao, 6) from public.custos_ia c
     where c.item = it and c.vigente_desde <= dia
     order by c.vigente_desde desc limit 1
$$;
-- custo de referência para o guarda: o maior entre o de hoje e os já cadastrados para depois (preço gravado hoje
-- não pode ficar abaixo do mínimo quando o custo novo entrar)
create or replace function public.custo_ia_referencia(it text) returns numeric
language sql stable security definer set search_path = public as $$
    select max(x) from (
        select public.custo_ia_vigente(it, current_date) as x
        union all
        select round(c.custo_unitario * c.cotacao, 6) from public.custos_ia c where c.item = it and c.vigente_desde > current_date
    ) v
$$;

-- arredonda para cima: centavos a partir de R$ 0,10; abaixo disso, 5 casas (a precisão dos preços)
create or replace function public.arredondar_preco_ia(v numeric) returns numeric
language sql immutable parallel safe as $$
    select case when v is null then null
                when v >= 0.10 then ceil(v * 100) / 100
                else ceil(v * 100000) / 100000 end::numeric(14, 5)
$$;
create or replace function public.texto_preco_ia(v numeric) returns text
language sql immutable parallel safe as $$
    select 'R$ ' || replace(to_char(v, case when v >= 0.10 then 'FM999999990.00' else 'FM0.00000' end), '.', ',')
$$;

-- preço mínimo (já arredondado) de um item de IA: custo ÷ (1 − impostos − MC mínima da IA). Nulo = sem custo.
create or replace function public.preco_minimo_ia(it text, custo numeric default null) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
    par public.parametros_margem;
    c numeric := coalesce(preco_minimo_ia.custo, public.custo_ia_referencia(it));
    d numeric;
begin
    if c is null then
        return null;
    end if;
    select * into par from public.parametros_margem where id = 1;
    d := 1 - (coalesce(par.impostos_pct, 0) + coalesce(par.mc_minima_ia_pct, 70)) / 100;
    if d <= 0 then
        raise exception 'impostos + MC mínima da IA chegam a 100%%: ajuste os parâmetros da margem';
    end if;
    return public.arredondar_preco_ia(c / d);
end $$;

-- %MC de um preço de IA (com os impostos de hoje)
create or replace function public.mc_pct_ia(preco numeric, custo numeric) returns numeric
language sql stable security definer set search_path = public as $$
    select case when preco > 0 and custo is not null then
                round((preco - preco * pm.impostos_pct / 100 - custo) / preco * 100, 1) end
      from public.parametros_margem pm where pm.id = 1
$$;

-- o guarda: devolve o problema do preço (nulo = ok). modelo: flat, faixa, progressivo ou mensalidade.
create or replace function public.problema_preco_ia(it text, modelo text, preco numeric) returns text
language plpgsql stable security definer set search_path = public as $$
declare
    i public.cobranca_itens;
    minimo numeric;
    mc numeric;
begin
    select * into i from public.cobranca_itens c where c.codigo = it;
    if i.codigo is null or not i.eh_ia then
        return null;
    end if;
    if modelo = 'mensalidade' then
        return format('item de IA (%s) é cobrado por unidade: use preço por %s, faixa ou progressivo, nunca mensalidade',
                      i.nome, i.unidade);
    end if;
    if preco is null then
        return null;
    end if;
    minimo := public.preco_minimo_ia(it);
    if minimo is null then
        return format('item de IA (%s) sem custo cadastrado: o Master cadastra o custo (Console › Margem › IA) antes do preço',
                      i.nome);
    end if;
    if preco < minimo then
        select pm.mc_minima_ia_pct into mc from public.parametros_margem pm where pm.id = 1;
        return format('preço abaixo do mínimo para item de IA (%s): o menor preço aceito é %s por %s (MC mínima de %s%% da IA)',
                      i.nome, public.texto_preco_ia(minimo), i.unidade, replace(rtrim(rtrim(mc::text, '0'), '.'), '.', ','));
    end if;
    return null;
end $$;
create or replace function public.conferir_preco_ia(it text, modelo text, preco numeric) returns void
language plpgsql stable security definer set search_path = public as $$
declare p text := public.problema_preco_ia(it, modelo, preco);
begin
    if p is not null then
        raise exception '%', p using errcode = 'check_violation';
    end if;
end $$;

-- ================================================================ 4. guarda em toda gravação de preço
-- catálogo (preço de tabela e mínimo): só quando o preço muda. Inserção sem custo passa (o item novo ainda não tem
-- custo; o preço da empresa fica bloqueado até o Master cadastrar).
create or replace function public.guardar_item_ia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' and (new.codigo like 'ia\_%' or new.produto = 'speech_analytics') then
        new.eh_ia := true;
    end if;
    if not new.eh_ia then
        return new;
    end if;
    if tg_op = 'INSERT' then
        if public.custo_ia_referencia(new.codigo) is not null then
            perform public.conferir_preco_ia(new.codigo, 'flat', least(new.preco_minimo, new.preco_tabela));
        end if;
    elsif new.preco_tabela is distinct from old.preco_tabela or new.preco_minimo is distinct from old.preco_minimo then
        if new.preco_tabela is distinct from old.preco_tabela then
            perform public.conferir_preco_ia(new.codigo, 'flat', new.preco_tabela);
        end if;
        if new.preco_minimo is distinct from old.preco_minimo then
            perform public.conferir_preco_ia(new.codigo, 'flat', new.preco_minimo);
        end if;
    end if;
    return new;
end $$;
drop trigger if exists guardar_item_ia on public.cobranca_itens;
create trigger guardar_item_ia before insert or update on public.cobranca_itens
    for each row execute function public.guardar_item_ia();

-- preço da empresa (flat e mensalidade aqui; faixas no gatilho de precos_faixas)
create or replace function public.guardar_preco_empresa_ia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' and (new.item, new.modelo, new.preco) is not distinct from (old.item, old.modelo, old.preco) then
        return new;
    end if;
    perform public.conferir_preco_ia(new.item, new.modelo, case when new.modelo = 'flat' then new.preco end);
    return new;
end $$;
drop trigger if exists guardar_preco_empresa_ia on public.precos_empresa;
create trigger guardar_preco_empresa_ia before insert or update on public.precos_empresa
    for each row execute function public.guardar_preco_empresa_ia();

create or replace function public.guardar_faixa_ia() returns trigger
language plpgsql security definer set search_path = public as $$
declare it text; m text;
begin
    select p.item, p.modelo into it, m from public.precos_empresa p where p.id = new.preco_id;
    perform public.conferir_preco_ia(it, m, new.preco);
    return new;
end $$;
drop trigger if exists guardar_faixa_ia on public.precos_faixas;
create trigger guardar_faixa_ia before insert or update on public.precos_faixas
    for each row execute function public.guardar_faixa_ia();

-- salvar_preco (e salvar_preco_vigencia, que o chama): a regra da IA vem antes do "abaixo do mínimo com motivo",
-- para a mensagem ser a da IA (na IA não há exceção com motivo)
select pg_temp.trocar('public.salvar_preco(bigint,text,text,numeric,numeric,jsonb,date,text)',
    '    select c.preco_minimo into piso from public.cobranca_itens c where c.codigo = salvar_preco.item;',
    '    perform public.conferir_preco_ia(salvar_preco.item, salvar_preco.modelo, menor);   -- SQL 61: IA nunca abaixo do mínimo
    select c.preco_minimo into piso from public.cobranca_itens c where c.codigo = salvar_preco.item;');

-- ================================================================ 5. consumo com custo real
-- quantidade: na unidade do item (pode ter fração: 2,5 mil tokens). A fatura recebe ceil(quantidade) (preço ×
-- quantidade, nunca o custo). Custo: custo_real (R$) informado pelo fornecedor > tokens × custo por mil tokens >
-- quantidade × custo unitário. Sem custo cadastrado: custo 0 e conta em sem_custo (nunca custo inventado).
create or replace function public.registrar_consumo_ia(empresa bigint, item_ia text, quantidade numeric,
                                                      tokens bigint default null, custo_real numeric default null,
                                                      faturar boolean default true, dia date default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
    d date := coalesce(dia, (now() at time zone 'America/Sao_Paulo')::date);
    comp date := date_trunc('month', coalesce(dia, (now() at time zone 'America/Sao_Paulo')::date))::date;
    c public.custos_ia;
    valor numeric;
begin
    if not exists (select 1 from public.cobranca_itens i where i.codigo = item_ia and i.eh_ia) then
        raise exception 'o item % não é de IA', item_ia;
    end if;
    if coalesce(registrar_consumo_ia.quantidade, 0) <= 0 then
        return 0;
    end if;
    if registrar_consumo_ia.custo_real is not null and registrar_consumo_ia.custo_real < 0 then
        raise exception 'custo inválido';
    end if;
    select * into c from public.custos_ia x where x.item = item_ia and x.vigente_desde <= d
     order by x.vigente_desde desc limit 1;
    valor := case when registrar_consumo_ia.custo_real is not null then registrar_consumo_ia.custo_real
                  when coalesce(registrar_consumo_ia.tokens, 0) > 0 and c.custo_mil_tokens is not null
                       then registrar_consumo_ia.tokens / 1000.0 * c.custo_mil_tokens * c.cotacao
                  when c.id is not null then registrar_consumo_ia.quantidade * c.custo_unitario * c.cotacao end;
    insert into public.consumo_ia as x (empresa_id, competencia, item, quantidade, tokens, custo, registros, sem_custo)
    values (empresa, comp, item_ia, registrar_consumo_ia.quantidade, greatest(coalesce(registrar_consumo_ia.tokens, 0), 0),
            round(coalesce(valor, 0), 5), 1, case when valor is null then 1 else 0 end)
    on conflict (empresa_id, competencia, item) do update
        set quantidade = x.quantidade + excluded.quantidade, tokens = x.tokens + excluded.tokens,
            custo = x.custo + excluded.custo, registros = x.registros + 1, sem_custo = x.sem_custo + excluded.sem_custo,
            atualizado_em = now();
    if faturar then
        insert into public.consumo_mensageria as m (empresa_id, competencia, item, quantidade)
        values (empresa, comp, item_ia, ceil(registrar_consumo_ia.quantidade)::bigint)
        on conflict (empresa_id, competencia, item) do update
            set quantidade = m.quantidade + excluded.quantidade, atualizado_em = now();
    end if;
    return round(coalesce(valor, 0), 5);
end $$;

-- roleplay: tokens por mil (a fatura continua com ceil(tokens ÷ 1000) por lote)
select pg_temp.trocar('public.concluir_roleplay_lote(bigint,bigint,text)',
'        insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade)
        values (l.empresa_id, date_trunc(''month'', now() at time zone ''America/Sao_Paulo'')::date, ''ia_roleplay'',
                ceil(concluir_roleplay_lote.tokens / 1000.0)::bigint)
        on conflict (empresa_id, competencia, item) do update
            set quantidade = public.consumo_mensageria.quantidade + excluded.quantidade, atualizado_em = now();',
'        -- SQL 61: fatura (preço × ceil(mil tokens)) e custo real (tokens × custo) num passo só
        perform public.registrar_consumo_ia(l.empresa_id, ''ia_roleplay'', concluir_roleplay_lote.tokens / 1000.0,
                                            concluir_roleplay_lote.tokens);');

-- geração de fluxo: 1 por geração na fatura; o custo usa os tokens que a VM manda em resultado.tokens_ia (que não
-- fica gravado no pedido, que o cliente lê)
select pg_temp.trocar('public.registrar_geracao_fluxo_voz(bigint,jsonb,jsonb)',
'        insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade)
        values (p.empresa_id, date_trunc(''month'', now() at time zone ''America/Sao_Paulo'')::date, ''ia_geracao_fluxo'', 1)
        on conflict (empresa_id, competencia, item) do update
            set quantidade = public.consumo_mensageria.quantidade + 1, atualizado_em = now();',
'        -- SQL 61: fatura (1 geração × preço) e custo real (tokens × custo) num passo só
        perform public.registrar_consumo_ia(p.empresa_id, ''ia_geracao_fluxo'', 1,
            case when registrar_geracao_fluxo_voz.resultado ->> ''tokens_ia'' ~ ''^[0-9]{1,12}$''
                 then (registrar_geracao_fluxo_voz.resultado ->> ''tokens_ia'')::bigint end);');
select pg_temp.trocar('public.registrar_geracao_fluxo_voz(bigint,jsonb,jsonb)',
'    erros := case when definicao is null',
'    registrar_geracao_fluxo_voz.resultado := registrar_geracao_fluxo_voz.resultado - ''tokens_ia'';   -- SQL 61: custo só no consumo_ia
    erros := case when definicao is null');

-- ================================================================ 6. telas do Master
-- catálogo da IA: custo vigente, preço mínimo, tabela e %MC
create or replace function public.itens_ia()
returns table (codigo text, nome text, unidade text, ativo boolean, custo_unitario numeric, moeda text,
               custo_moeda numeric, cotacao numeric, custo_mil_tokens numeric, custo_vigente_desde date, premissa text,
               custo_futuro boolean, preco_minimo_ia numeric, preco_minimo numeric, preco_tabela numeric,
               mc_tabela_pct numeric, precos_abaixo int)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê o custo da IA';
    end if;
    return query
    select i.codigo, i.nome, i.unidade, i.ativo, round(c.custo_unitario * c.cotacao, 6), c.moeda, c.custo_unitario,
           c.cotacao, c.custo_mil_tokens, c.vigente_desde, c.premissa,
           exists (select 1 from public.custos_ia f where f.item = i.codigo and f.vigente_desde > current_date),
           public.preco_minimo_ia(i.codigo), i.preco_minimo, i.preco_tabela,
           public.mc_pct_ia(i.preco_tabela, public.custo_ia_referencia(i.codigo)),
           (select count(*)::int from public.ia_precos_abaixo_minimo() a where a.item = i.codigo)
      from public.cobranca_itens i
      left join lateral (select x.* from public.custos_ia x where x.item = i.codigo and x.vigente_desde <= current_date
                          order by x.vigente_desde desc limit 1) c on true
     where i.eh_ia
     order by i.ordem, i.codigo;
end $$;

-- preços de IA abaixo do mínimo de hoje (depois de custo, impostos ou MC mínima novos). Nunca muda preço.
-- origem: tabela | minimo_catalogo | empresa (o preço que vale agora e os já gravados para depois).
create or replace function public.ia_precos_abaixo_minimo()
returns table (origem text, empresa_id bigint, empresa text, item text, nome text, modelo text, preco numeric,
               preco_minimo_ia numeric, mc_pct numeric, vigente_desde date, problema text)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê o custo da IA';
    end if;
    return query
    with itens as (
        select i.codigo, i.nome, i.preco_tabela, i.preco_minimo, public.preco_minimo_ia(i.codigo) as pmin,
               public.custo_ia_referencia(i.codigo) as custo
          from public.cobranca_itens i where i.eh_ia
    ), cat as (
        select 'tabela'::text as o, null::bigint as eid, null::text as en, t.codigo, t.nome, 'flat'::text as m,
               t.preco_tabela as pr, t.pmin, t.custo, null::date as vd
          from itens t where t.preco_tabela is not null
        union all
        select 'minimo_catalogo', null, null, t.codigo, t.nome, 'flat', t.preco_minimo, t.pmin, t.custo, null
          from itens t where t.preco_minimo is not null
    ), emp as (
        select 'empresa'::text as o, p.empresa_id as eid, e.nome as en, t.codigo, t.nome, p.modelo as m,
               case when p.modelo in ('faixa', 'progressivo')
                    then (select min(f.preco) from public.precos_faixas f where f.preco_id = p.id) else p.preco end as pr,
               t.pmin, t.custo, p.vigente_desde as vd
          from public.precos_empresa p
          join itens t on t.codigo = p.item
          join public.empresas e on e.id = p.empresa_id
         where p.vigente_desde >= coalesce((public.preco_vigente(p.empresa_id, p.item, current_date)).vigente_desde, p.vigente_desde)
    ), tudo as (
        select * from cat union all select * from emp
    )
    select x.o, x.eid, x.en, x.codigo, x.nome, x.m, x.pr, x.pmin,
           case when x.m <> 'mensalidade' then public.mc_pct_ia(x.pr, x.custo) end, x.vd,
           case when x.m = 'mensalidade' then 'mensalidade'
                when x.pmin is null then 'sem_custo'
                else 'abaixo_minimo' end
      from tudo x
     where x.m = 'mensalidade' or (x.o = 'empresa' and x.pmin is null) or (x.pmin is not null and x.pr < x.pmin)
     order by x.codigo, x.o, x.en nulls first;
end $$;

-- custo novo (Master). Item de IA ainda sem preço de tabela ganha o preço padrão (= o mínimo). Preço nenhum muda:
-- devolve quantos ficaram abaixo do mínimo (ia_precos_abaixo_minimo lista).
create or replace function public.salvar_custo_ia(item text, custo_unitario numeric, moeda text default 'BRL',
                                                 cotacao numeric default 1, custo_mil_tokens numeric default null,
                                                 vigente_desde date default null, premissa text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    d date := coalesce(salvar_custo_ia.vigente_desde, current_date);
    padrao numeric;
    aplicou boolean := false;
    abaixo int;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob cadastra o custo da IA';
    end if;
    insert into public.custos_ia as c (item, custo_unitario, custo_mil_tokens, moeda, cotacao, vigente_desde, premissa)
    values (salvar_custo_ia.item, salvar_custo_ia.custo_unitario, salvar_custo_ia.custo_mil_tokens,
            coalesce(salvar_custo_ia.moeda, 'BRL'), case when coalesce(salvar_custo_ia.moeda, 'BRL') = 'BRL' then 1
                                                          else salvar_custo_ia.cotacao end, d, salvar_custo_ia.premissa)
    on conflict on constraint custos_ia_item_vigente_desde_key do update
        set custo_unitario = excluded.custo_unitario, custo_mil_tokens = excluded.custo_mil_tokens,
            moeda = excluded.moeda, cotacao = excluded.cotacao, premissa = excluded.premissa,
            criado_em = now(), criado_por = auth.uid();
    padrao := public.preco_minimo_ia(salvar_custo_ia.item);
    if exists (select 1 from public.cobranca_itens i where i.codigo = salvar_custo_ia.item and i.preco_tabela is null) then
        update public.cobranca_itens i set preco_minimo = padrao, preco_tabela = padrao where i.codigo = salvar_custo_ia.item;
        aplicou := true;
    end if;
    select count(*) into abaixo from public.ia_precos_abaixo_minimo() a where a.item = salvar_custo_ia.item;
    return jsonb_build_object('preco_minimo', padrao, 'preco_padrao_aplicado', aplicou, 'precos_abaixo', abaixo);
end $$;

-- preço de tabela de um item de IA (Master). O mínimo do catálogo acompanha: nunca acima da tabela e nunca abaixo
-- do mínimo da IA.
create or replace function public.salvar_preco_tabela_ia(item text, preco_tabela numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare
    i public.cobranca_itens;
    pmin numeric;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob define o preço de tabela da IA';
    end if;
    select * into i from public.cobranca_itens c where c.codigo = salvar_preco_tabela_ia.item and c.eh_ia;
    if i.codigo is null then
        raise exception 'o item % não é de IA', salvar_preco_tabela_ia.item;
    end if;
    if coalesce(salvar_preco_tabela_ia.preco_tabela, 0) <= 0 then
        raise exception 'informe o preço de tabela';
    end if;
    perform public.conferir_preco_ia(i.codigo, 'flat', salvar_preco_tabela_ia.preco_tabela);
    pmin := public.preco_minimo_ia(i.codigo);
    update public.cobranca_itens c
       set preco_minimo = least(greatest(coalesce(c.preco_minimo, pmin), pmin), salvar_preco_tabela_ia.preco_tabela),
           preco_tabela = salvar_preco_tabela_ia.preco_tabela
     where c.codigo = i.codigo;
    return salvar_preco_tabela_ia.preco_tabela;
end $$;

-- margem da IA por empresa e item no mês. Receita = preço da empresa × quantidade faturada (valor_item: flat, faixa,
-- progressivo; sem o mínimo mensal), como na margem da mensageria. Custo = consumo_ia; uso sem registro de custo
-- (antes do SQL 61, ou gravado por fora) = quantidade × custo vigente, marcado como estimado.
create or replace function public.margem_ia(competencia date)
returns table (empresa_id bigint, empresa text, item text, nome text, unidade text, quantidade numeric,
               receita numeric, impostos numeric, custo numeric, custo_estimado boolean, mc numeric, mc_pct numeric,
               preco_medio numeric, preco_minimo_ia numeric, situacao text, sem_custo int)
language plpgsql stable security definer set search_path = public as $$
declare
    par public.parametros_margem;
    comp date := date_trunc('month', competencia)::date;
    dia date := least(current_date, (date_trunc('month', competencia) + interval '1 month - 1 day')::date);
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê a margem da IA';
    end if;
    select * into par from public.parametros_margem pm where pm.id = 1;
    return query
    with uso as (
        select coalesce(m.empresa_id, k.empresa_id) as eid, coalesce(m.item, k.item) as it,
               coalesce(m.quantidade, 0)::numeric as qtd, k.custo as cst, k.sem_custo as semc, k.registros as regs
          from (select c.* from public.consumo_mensageria c join public.cobranca_itens i on i.codigo = c.item and i.eh_ia
                 where c.competencia = comp) m
          full join (select x.* from public.consumo_ia x where x.competencia = comp) k
            on k.empresa_id = m.empresa_id and k.item = m.item
    ), calc as (
        select u.eid, u.it, u.qtd, v.valor as rec, v.preco_medio as pm_,
               case when u.regs is not null then u.cst else u.qtd * public.custo_ia_vigente(u.it, dia) end as cst,
               u.regs is null as estimado, coalesce(u.semc, case when u.regs is null and public.custo_ia_vigente(u.it, dia) is null
                                                                 then 1 else 0 end) as semc
          from uso u left join lateral public.valor_item(u.eid, u.it, u.qtd, comp) v on true
    )
    select k.eid, e.nome, k.it, i.nome, i.unidade, k.qtd, coalesce(k.rec, 0),
           round(coalesce(k.rec, 0) * par.impostos_pct / 100, 2), round(coalesce(k.cst, 0), 2), k.estimado,
           round(coalesce(k.rec, 0) - coalesce(k.rec, 0) * par.impostos_pct / 100 - coalesce(k.cst, 0), 2),
           case when k.rec > 0 then round((k.rec - k.rec * par.impostos_pct / 100 - coalesce(k.cst, 0)) / k.rec * 100, 1) end,
           k.pm_, public.preco_minimo_ia(k.it),
           case when k.rec is null and k.qtd > 0 then 'sem_preco'
                when coalesce(k.rec, 0) = 0 then 'sem_receita'
                when k.cst is null or k.semc > 0 then 'sem_custo'
                when (k.rec - k.rec * par.impostos_pct / 100 - k.cst) / k.rec * 100 < par.mc_minima_ia_pct then 'abaixo_minimo'
                else 'ok' end,
           k.semc::int
      from calc k
      join public.empresas e on e.id = k.eid
      join public.cobranca_itens i on i.codigo = k.it
     order by 12 nulls first, e.nome, i.ordem;
end $$;

-- ================================================================ 7. permissões das funções
revoke all on function public.custo_ia_vigente(text, date), public.custo_ia_referencia(text),
    public.preco_minimo_ia(text, numeric), public.mc_pct_ia(numeric, numeric), public.problema_preco_ia(text, text, numeric),
    public.conferir_preco_ia(text, text, numeric), public.guardar_item_ia(), public.guardar_preco_empresa_ia(),
    public.guardar_faixa_ia(), public.validar_custo_ia(), public.validar_parametros_margem()
    from public, anon, authenticated;
revoke all on function public.registrar_consumo_ia(bigint, text, numeric, bigint, numeric, boolean, date)
    from public, anon, authenticated;
grant execute on function public.registrar_consumo_ia(bigint, text, numeric, bigint, numeric, boolean, date) to service_role;
revoke all on function public.itens_ia(), public.ia_precos_abaixo_minimo(), public.margem_ia(date),
    public.salvar_custo_ia(text, numeric, text, numeric, numeric, date, text), public.salvar_preco_tabela_ia(text, numeric)
    from public, anon;
grant execute on function public.itens_ia(), public.ia_precos_abaixo_minimo(), public.margem_ia(date),
    public.salvar_custo_ia(text, numeric, text, numeric, numeric, date, text), public.salvar_preco_tabela_ia(text, numeric)
    to authenticated;
revoke all on function public.arredondar_preco_ia(numeric), public.texto_preco_ia(numeric) from public, anon;
grant execute on function public.arredondar_preco_ia(numeric), public.texto_preco_ia(numeric) to authenticated, service_role;

-- ================================================================ 8. auditoria
drop trigger if exists z_auditar on public.custos_ia;
create trigger z_auditar after insert or update or delete on public.custos_ia
    for each row execute function public.auditar();

-- ================================================================ 9. custos iniciais (premissas) e preço padrão
-- só para item de IA ainda sem custo; vigência fixa (rodar de novo não duplica)
insert into public.custos_ia (item, custo_unitario, custo_mil_tokens, moeda, cotacao, vigente_desde, premissa)
select v.item, v.custo, v.mil_tokens, 'USD', 5.60, date '2026-10-01', v.premissa
  from (values
    ('voz_minuto_ia', 0.08::numeric, null::numeric, 'Premissa SQL 61: US$ 0,08/min (tabela pública do provedor de voz), US$ 1 = R$ 5,60. Confirmar com o contrato.'),
    ('voz_minuto_ia_pico', 0.08, null, 'Premissa SQL 61: mesmo custo do minuto de IA (o pico só muda o preço). US$ 1 = R$ 5,60.'),
    ('voz_transcricao', 0.00367, null, 'Premissa SQL 61: US$ 0,22/h de transcrição (US$ 0,00367/min), US$ 1 = R$ 5,60.'),
    ('ia_roleplay', 0.0006, 0.0006, 'Premissa SQL 61: LLM a US$ 0,60 por milhão de tokens (preço de saída, conservador). US$ 1 = R$ 5,60.'),
    ('ia_geracao_fluxo', 0.03, 0.0006, 'Premissa SQL 61: ≈ 50 mil tokens por geração (até 3 tentativas) a US$ 0,60/milhão; com os tokens da VM vale o real. US$ 1 = R$ 5,60.')
  ) v(item, custo, mil_tokens, premissa)
 where exists (select 1 from public.cobranca_itens i where i.codigo = v.item and i.eh_ia)
   and not exists (select 1 from public.custos_ia c where c.item = v.item);

-- preço padrão para item de IA com custo e sem preço de tabela (= o mínimo)
update public.cobranca_itens i
   set preco_minimo = public.preco_minimo_ia(i.codigo), preco_tabela = public.preco_minimo_ia(i.codigo)
 where i.eh_ia and i.preco_tabela is null and public.preco_minimo_ia(i.codigo) is not null;
