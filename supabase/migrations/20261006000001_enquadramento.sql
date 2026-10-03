-- Onde cada cliente se enquadrou: a rotina grava, por cliente, a esteira (estratégia do
-- segmento) que ele segue, a persona, se está na carga em cobrança e a ação de hoje.
-- A view enquadramento resume por carteira × segmento × esteira × momento (estado).
-- Pode ser rodado de novo sem erro.

alter table public.estado_cliente
    add column if not exists estrategia text,
    add column if not exists persona text,
    add column if not exists na_carga boolean,
    add column if not exists acao_hoje text,
    add column if not exists passo_hoje text;

drop view if exists public.enquadramento;
create view public.enquadramento with (security_invoker = true) as
    select empresa_id,
           credor_id,
           cluster_atual as cluster,
           coalesce(estrategia, '') as estrategia,
           estado,
           coalesce(na_carga, true) as na_carga,
           count(*)::int as clientes,
           count(*) filter (where coalesce(acao_hoje, '') <> '')::int as com_acao_hoje,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo
    from public.estado_cliente
    group by 1, 2, 3, 4, 5, 6;
comment on view public.enquadramento is 'Clientes por carteira, segmento, esteira, momento e se estão na carga.';
