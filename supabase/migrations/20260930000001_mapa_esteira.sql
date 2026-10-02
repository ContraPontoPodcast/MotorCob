-- Mapa da esteira: onde está concentrada a base em cada etapa dos acionamentos.
--
-- * estado_cliente ganha saldo e dias_atraso (gravados pela rotina; não são dado pessoal)
--   para mostrar a concentração em R$ além da quantidade.
-- * mapa_esteira: clientes e saldo por empresa × estado × etapa (ciclo) × canal × cluster × safra.
-- * acoes_hoje: clientes por régua × passo × canal na fila de cada dia.
-- * fluxo_esteira: quantos clientes passaram de um estado para outro, por dia (trilha).
-- Pode ser rodado de novo sem erro.
-- As views respeitam o RLS das tabelas (security_invoker): cada empresa vê só a sua.

alter table public.estado_cliente
    add column if not exists saldo numeric(14, 2),
    add column if not exists dias_atraso int;

create or replace view public.mapa_esteira with (security_invoker = true) as
    select empresa_id,
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
    group by 1, 2, 3, 4, 5, 6;
comment on view public.mapa_esteira is 'Clientes e saldo por estado, etapa (ciclo), canal, cluster e safra (mês de entrada).';

create or replace view public.acoes_hoje with (security_invoker = true) as
    select empresa_id, data, regua, passo, canal, reserva, count(*)::int as clientes
    from public.fila_dia
    group by 1, 2, 3, 4, 5, 6;
comment on view public.acoes_hoje is 'Clientes por régua, passo e canal na fila do dia.';

create or replace view public.fluxo_esteira with (security_invoker = true) as
    select empresa_id,
           data,
           nullif(split_part(tag_anterior, '-', 3), '') as de,
           split_part(tag, '-', 3) as para,
           count(*)::int as clientes
    from public.trilha
    where split_part(tag_anterior, '-', 3) is distinct from split_part(tag, '-', 3)
    group by 1, 2, 3, 4;
comment on view public.fluxo_esteira is 'Mudanças de estado por dia (de → para); de nulo = entrada na esteira.';

create index if not exists trilha_empresa_data_idx on public.trilha (empresa_id, data);
