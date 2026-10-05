-- Visões do Mapa da Esteira por credor (versão de 20261005). Se o banco ficou com a versão antiga
-- (sem credor_id — ex.: o trecho 20260930 rodou de novo depois), o Mapa dá erro 42703
-- "column fluxo_esteira.credor_id does not exist". Recria as três na versão certa.
-- Pode ser rodado de novo sem erro.

drop view if exists public.mapa_esteira;
create view public.mapa_esteira with (security_invoker = true) as
    select empresa_id,
           credor_id,
           estado,
           case
               when estado = 'LOC' then 'L' || least(coalesce(nullif(substr(ciclo, 2), '')::int, 0), 99)
               when estado = 'NCP' and ciclo = 'RE' then 'RE'
               else coalesce(nullif(ciclo, ''), '-')
           end as etapa,
           canal,
           cluster_atual as cluster,
           to_char(safra, 'YYYY-MM') as safra,
           count(*)::int as clientes,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo
    from public.estado_cliente
    group by 1, 2, 3, 4, 5, 6, 7;

drop view if exists public.acoes_hoje;
create view public.acoes_hoje with (security_invoker = true) as
    select empresa_id, credor_id, data, regua, passo, canal, reserva, count(*)::int as clientes
    from public.fila_dia
    group by 1, 2, 3, 4, 5, 6, 7;

drop view if exists public.fluxo_esteira;
create view public.fluxo_esteira with (security_invoker = true) as
    select empresa_id,
           credor_id,
           data,
           nullif(split_part(tag_anterior, '-', 3), '') as de,
           split_part(tag, '-', 3) as para,
           count(*)::int as clientes
    from public.trilha
    where split_part(tag_anterior, '-', 3) is distinct from split_part(tag, '-', 3)
    group by 1, 2, 3, 4, 5;
