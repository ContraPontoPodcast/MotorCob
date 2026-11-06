-- SQL 72 · Faturamento: a estimativa do ciclo não projeta por dia o que é contado uma vez no ciclo
-- (o SQL 71 é o 20270107000001_cancelar_rascunho.sql; o número 70 ficou sem uso)
--
-- QA da implantação (B12): estimativa_ciclo fazia "fixo + variável × dias do ciclo ÷ dias corridos" com TODO item
-- não fixo. A Orquestração é cobrada por CPF distinto ativo no ciclo (SQL 69) e a Jornada por cliente acionado no
-- ciclo: a quantidade medida no dia 6 já é (quase) a do ciclo inteiro — cada pessoa conta UMA vez —, mas a conta
-- multiplicava por 30/6. Ex.: 3.200 CPFs × R$ 0,35 = R$ 1.120 medidos viravam R$ 5.600 "estimados".
--
-- Regra nova (só a estimativa; a prévia, o fechamento e os preços não mudam):
--   estimativa = fixo (mensalidades)
--              + itens contados uma vez no ciclo ('orquestracao', 'jornada' e o complemento do mínimo deles) pelo valor
--                medido até agora
--              + itens de consumo (envios, etc.) × dias do ciclo ÷ dias corridos (como antes)
-- O complemento do mínimo dos itens de consumo continua fora da conta (como antes).
-- A função antiga lia preco_vigente com o código da fatura ('orquestracao'), que não é o do catálogo ('contratos'):
-- agora traduz o código antes de procurar a mensalidade.
--
-- estimativa_ciclo(empresa) continua com a mesma assinatura e a mesma checagem (ve_faturamento). A conta vive em
-- estimativa_ciclo_em(empresa, hoje), que só o servidor chama (permite testar com data fixa).
-- Nada para anon. Pode rodar de novo sem erro.

create or replace function public.estimativa_ciclo_em(empresa bigint, hoje date)
returns table (competencia date, inicio date, fim date, dia int, dias int, ate_agora numeric, estimativa numeric)
language plpgsql stable security definer set search_path = public as $$
declare comp date; ini date; fi date; d int; tot int; fixo numeric; distintos numeric; var numeric; total numeric;
begin
    comp := public.competencia_de(empresa, hoje);
    select x.inicio, x.fim into ini, fi from public.ciclo_de(empresa, comp) x;
    d := hoje - ini + 1; tot := fi - ini + 1;
    with p as (
        select v.item, v.valor,
               (public.preco_vigente(empresa,
                    case v.item when 'orquestracao' then 'contratos' when 'jornada' then 'jornada_clientes' else v.item end,
                    comp)).modelo as modelo
          from public.previa_fatura(empresa, comp) v)
    select coalesce(sum(p.valor) filter (where p.modelo = 'mensalidade'), 0),
           coalesce(sum(p.valor) filter (where p.modelo is distinct from 'mensalidade'
                                           and p.item in ('orquestracao', 'orquestracao_minimo', 'jornada', 'jornada_minimo')), 0),
           coalesce(sum(p.valor) filter (where p.modelo is distinct from 'mensalidade'
                                           and p.item not in ('orquestracao', 'jornada') and p.item not like '%\_minimo'), 0),
           coalesce(sum(p.valor), 0)
      into fixo, distintos, var, total
      from p;
    return query select comp, ini, fi, d, tot, total,
        case when d >= 5 then round(fixo + distintos + var * tot / d, 2) end;
end $$;
comment on function public.estimativa_ciclo_em(bigint, date) is
    'Estimativa do ciclo numa data: fixo + itens contados uma vez no ciclo (Orquestração por CPF, Jornada) pelo medido '
    '+ consumo projetado por dia. Só o servidor (estimativa_ciclo chama com a data de hoje). SQL 72.';
revoke all on function public.estimativa_ciclo_em(bigint, date) from public, anon, authenticated;
grant execute on function public.estimativa_ciclo_em(bigint, date) to service_role;

create or replace function public.estimativa_ciclo(empresa bigint)
returns table (competencia date, inicio date, fim date, dia int, dias int, ate_agora numeric, estimativa numeric)
language plpgsql stable security definer set search_path = public as $$
begin
    if auth.uid() is not null and not public.ve_faturamento(empresa) then
        raise exception 'sem acesso ao faturamento desta empresa';
    end if;
    return query select * from public.estimativa_ciclo_em(empresa, current_date);
end $$;
comment on function public.estimativa_ciclo(bigint) is
    'Estimativa do ciclo aberto (Empresa › Faturas): o que é contado uma vez no ciclo não é projetado por dia. SQL 72.';
revoke all on function public.estimativa_ciclo(bigint) from public, anon;
grant execute on function public.estimativa_ciclo(bigint) to authenticated, service_role;
