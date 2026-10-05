-- Lista do dia por estratégia e calendário de exportação do credor.
-- * fila_dia.estrategia: nome da estratégia (esteira) do cliente; o site mostra e exporta por
--   estratégia. View resumo_fila_estrategia: clientes por estratégia × canal × reserva.
-- * credores.calendario: dias em que cada estratégia exporta (padrão do credor e exceções por
--   estratégia). Formato:
--   {"padrao": {"dias_semana": [0,1,2,3,4,5], "feriados_nacionais": true,
--               "sem_acao": ["2026-11-24"], "com_acao": []},
--    "estrategias": {"<id da estratégia>": {"seguir_padrao": false, "dias_semana": [0,1,2,3,4],
--                                          "feriados_nacionais": true, "sem_acao": [], "com_acao": []}}}
--   dias_semana: 0 = segunda … 6 = domingo. Sem calendário: segunda a sábado, sem feriados nacionais.
-- Pode ser rodado de novo sem erro.

alter table public.fila_dia add column if not exists estrategia text;

drop view if exists public.resumo_fila_estrategia;
create view public.resumo_fila_estrategia with (security_invoker = true) as
    select empresa_id, credor_id, data, coalesce(estrategia, '') as estrategia, canal, reserva,
           count(*)::int as clientes
    from public.fila_dia group by 1, 2, 3, 4, 5, 6;

alter table public.credores add column if not exists calendario jsonb
    check (calendario is null or jsonb_typeof(calendario) = 'object');
