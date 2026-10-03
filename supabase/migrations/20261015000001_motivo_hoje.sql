-- Por que cada cliente está (ou não) na lista de hoje: "com ação hoje", "sem ação: a esteira
-- não tem passo no D+2", "sem ação: sem contato para os canais do dia"… Preenchido pela rotina.
-- Pode ser rodado de novo sem erro.

alter table public.estado_cliente add column if not exists motivo_hoje text;

-- resumo por carteira: quantos clientes da carga em cada motivo (para o site)
create or replace view public.motivos_hoje with (security_invoker = true) as
    select empresa_id, credor_id, coalesce(motivo_hoje, 'ainda não calculado') as motivo,
           count(*)::int as clientes
    from public.estado_cliente
    where coalesce(na_carga, true)
    group by 1, 2, 3;
comment on view public.motivos_hoje is 'Clientes da carga por motivo de estar (ou não) na lista de hoje.';
