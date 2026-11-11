-- SQL 124 · MC mínima própria por item de IA (só o Master), PR 2 do plano "Agente de voz por minuto falado" (SPEC §7,
-- P1 aprovada pelo dono: mínima própria por item, 60% no minuto de IA, a geral continua em 70%, sem exceção com motivo).
--
-- 1. cobranca_itens.mc_minima_ia_pct (nulo = usa a geral, parametros_margem.mc_minima_ia_pct). Gatilho
--    guardar_mc_minima_item: pelo site (auth.uid() preenchido) só o Master muda a coluna, também por gravação direta
--    (a policy deixa editar_produtos gravar o catálogo), como a franquia padrão (SQL 92).
-- 2. mc_minima_ia_de(item) = coalesce(mínima do item, geral). preco_minimo_ia e problema_preco_ia recriadas INTEIRAS
--    (estado atual: SQL 61) com ela; a mensagem do banco cita a mínima que valeu ("MC mínima de 60% deste item" ou
--    "MC mínima de 70% da IA"). A regra do SQL 61 não muda: preço de IA nunca abaixo do mínimo, nem para o Master.
-- 3. itens_ia() e ia_precos_abaixo_minimo() NÃO mudam de assinatura (o SQL 61 e o 93 as recriam com create or replace
--    e quebrariam ao rodar de novo): já devolvem o preço mínimo com a mínima do item (usam preco_minimo_ia); a tela lê a
--    mínima do item em cobranca_itens.mc_minima_ia_pct (o catálogo é legível pelo site). salvar_mc_minima_ia_item(item,
--    pct) para o Master (nulo = volta a usar a geral) e preco_minimo_ia_com_mc(item, pct) para a prévia na gaveta
--    (R$ 1,50 → R$ 1,12).
-- 4. margem_preco_ia(item, preco): para a caixa de margem da Contratação (equipe): menor preço aceito, mínima que vale e
--    o problema do preço (a mesma mensagem do banco); a %MC do preço só para o Master (custo é só dele).
-- 5. Padrão (só na primeira vez, quando o voz_minuto_ia ainda não tem mínima própria): voz_minuto_ia = 60% e, se o
--    mínimo com 60% (e os impostos que estão gravados, sem alterar) ficar até R$ 1,25, o preço de tabela vira R$ 1,25 e
--    o mínimo do catálogo vira o mínimo da IA. Com impostos que deixem o mínimo acima de R$ 1,25, a tabela não muda
--    (o VERIFICAR mostra) e o Master decide em Console › Margem › IA.
-- Se o SQL 61 rodar de novo (ele recria preco_minimo_ia e problema_preco_ia sem a mínima do item), rode este depois.
-- Depende do SQL 61 (margem da IA) e 93 (licenças). Pode rodar de novo (o padrão do item 5 só na primeira vez).

-- ================================================================ 1. coluna e guarda
alter table public.cobranca_itens add column if not exists mc_minima_ia_pct numeric(5, 2);
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'cobranca_itens_mc_minima_ia_pct_check') then
        alter table public.cobranca_itens add constraint cobranca_itens_mc_minima_ia_pct_check
            check (mc_minima_ia_pct is null or mc_minima_ia_pct between 0 and 99);
    end if;
end $$;
comment on column public.cobranca_itens.mc_minima_ia_pct is
    'MC mínima própria do item de IA (nulo = parametros_margem.mc_minima_ia_pct). Só o Master muda. SQL 124.';

create or replace function public.guardar_mc_minima_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if (tg_op = 'INSERT' and new.mc_minima_ia_pct is not null
        or tg_op = 'UPDATE' and new.mc_minima_ia_pct is distinct from old.mc_minima_ia_pct)
       and auth.uid() is not null and not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob muda a MC mínima de um item de IA';
    end if;
    return new;
end $$;
drop trigger if exists guardar_mc_minima_item on public.cobranca_itens;
create trigger guardar_mc_minima_item before insert or update of mc_minima_ia_pct on public.cobranca_itens
    for each row execute function public.guardar_mc_minima_item();

-- ================================================================ 2. a mínima que vale e o guarda
create or replace function public.mc_minima_ia_de(it text) returns numeric
language sql stable security definer set search_path = public as $$
    select coalesce((select i.mc_minima_ia_pct from public.cobranca_itens i where i.codigo = it),
                    (select pm.mc_minima_ia_pct from public.parametros_margem pm where pm.id = 1), 70)
$$;

-- '60,5' a partir de 60.50
create or replace function public.texto_pct_ia(v numeric) returns text
language sql immutable parallel safe set search_path = '' as $$
    select replace(rtrim(rtrim(v::text, '0'), '.'), '.', ',')
$$;

-- SQL 61 recriada inteira: custo ÷ (1 − impostos − MC mínima do item, ou a geral). Nulo = sem custo.
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
    d := 1 - (coalesce(par.impostos_pct, 0) + public.mc_minima_ia_de(it)) / 100;
    if d <= 0 then
        raise exception 'impostos + MC mínima da IA chegam a 100%%: ajuste os parâmetros da margem';
    end if;
    return public.arredondar_preco_ia(c / d);
end $$;

-- prévia: o mínimo do item com outra MC mínima (gaveta do Master)
create or replace function public.preco_minimo_ia_com_mc(it text, mc numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
    c numeric := public.custo_ia_referencia(it);
    imp numeric := coalesce((select pm.impostos_pct from public.parametros_margem pm where pm.id = 1), 0);
    m numeric := coalesce(preco_minimo_ia_com_mc.mc, (select pm.mc_minima_ia_pct from public.parametros_margem pm where pm.id = 1), 70);
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê o custo da IA';
    end if;
    if c is null or imp + m >= 100 then
        return null;
    end if;
    return public.arredondar_preco_ia(c / (1 - (imp + m) / 100));
end $$;

-- SQL 61 recriada inteira: a mensagem cita a mínima que valeu (do item ou a geral)
create or replace function public.problema_preco_ia(it text, modelo text, preco numeric) returns text
language plpgsql stable security definer set search_path = public as $$
declare
    i public.cobranca_itens;
    minimo numeric;
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
        return format('preço abaixo do mínimo para item de IA (%s): o menor preço aceito é %s por %s (MC mínima de %s%% %s)',
                      i.nome, public.texto_preco_ia(minimo), i.unidade, public.texto_pct_ia(public.mc_minima_ia_de(it)),
                      case when i.mc_minima_ia_pct is not null then 'deste item' else 'da IA' end);
    end if;
    return null;
end $$;

-- ================================================================ 3. telas do Master
-- Master: a mínima própria do item (nulo = volta a usar a geral). Não muda preço nenhum: o que ficar abaixo aparece em
-- ia_precos_abaixo_minimo (devolve quantos).
create or replace function public.salvar_mc_minima_ia_item(item text, pct numeric) returns int
language plpgsql security definer set search_path = public as $$
declare
    imp numeric := coalesce((select pm.impostos_pct from public.parametros_margem pm where pm.id = 1), 0);
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob muda a MC mínima de um item de IA';
    end if;
    if not exists (select 1 from public.cobranca_itens i where i.codigo = salvar_mc_minima_ia_item.item and i.eh_ia) then
        raise exception 'o item % não é de IA', salvar_mc_minima_ia_item.item;
    end if;
    if pct is not null and (pct < 0 or pct > 99) then
        raise exception 'MC mínima: de 0 a 99%%';
    end if;
    if pct is not null and imp + pct >= 100 then
        raise exception 'impostos (% %%) + MC mínima chegam a 100%%', imp;
    end if;
    update public.cobranca_itens set mc_minima_ia_pct = round(pct, 2) where codigo = salvar_mc_minima_ia_item.item;
    return (select count(*)::int from public.ia_precos_abaixo_minimo() a where a.item = salvar_mc_minima_ia_item.item);
end $$;

-- ================================================================ 4. caixa de margem da Contratação (equipe)
create or replace function public.margem_preco_ia(item text, preco numeric default null)
returns table (preco_minimo numeric, mc_minima_pct numeric, mc_pct numeric, problema text, unidade text)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.sou_equipe() then
        raise exception 'só a equipe MotorCX vê o mínimo dos preços de IA';
    end if;
    return query
    select public.preco_minimo_ia(i.codigo), public.mc_minima_ia_de(i.codigo),
           case when public.admin_equipe() then public.mc_pct_ia(margem_preco_ia.preco, public.custo_ia_referencia(i.codigo)) end,
           public.problema_preco_ia(i.codigo, 'flat', margem_preco_ia.preco), i.unidade
      from public.cobranca_itens i
     where i.codigo = margem_preco_ia.item and i.eh_ia;
end $$;

-- ================================================================ 5. padrão do minuto de IA (só na primeira vez)
do $$
declare
    pmin numeric;
begin
    if not exists (select 1 from public.cobranca_itens i where i.codigo = 'voz_minuto_ia' and i.mc_minima_ia_pct is null) then
        return;
    end if;
    update public.cobranca_itens set mc_minima_ia_pct = 60 where codigo = 'voz_minuto_ia';
    pmin := public.preco_minimo_ia('voz_minuto_ia');
    if pmin is not null and pmin <= 1.25 then
        update public.cobranca_itens set preco_minimo = pmin, preco_tabela = 1.25 where codigo = 'voz_minuto_ia';
    else
        raise notice 'voz_minuto_ia: com os impostos gravados o mínimo com 60%% é %, acima de R$ 1,25; a tabela não mudou',
            coalesce(public.texto_preco_ia(pmin), 'sem custo');
    end if;
end $$;

-- ================================================================ 6. permissões das funções
revoke all on function public.guardar_mc_minima_item() from public, anon, authenticated;
revoke all on function public.mc_minima_ia_de(text) from public, anon;
grant execute on function public.mc_minima_ia_de(text) to authenticated, service_role;
revoke all on function public.texto_pct_ia(numeric) from public, anon;
grant execute on function public.texto_pct_ia(numeric) to authenticated, service_role;
revoke all on function public.salvar_mc_minima_ia_item(text, numeric), public.preco_minimo_ia_com_mc(text, numeric),
    public.margem_preco_ia(text, numeric) from public, anon;
grant execute on function public.salvar_mc_minima_ia_item(text, numeric), public.preco_minimo_ia_com_mc(text, numeric),
    public.margem_preco_ia(text, numeric) to authenticated;
