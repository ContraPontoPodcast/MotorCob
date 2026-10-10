-- Lista do dia agrupada: além do texto do motivo, a rotina grava o grupo de cada cliente
-- (com_acao, regra_esteira, sem_contato, encerrado). O site soma por grupo sem ler texto.
-- Pode ser rodado de novo sem erro.

alter table public.estado_cliente add column if not exists motivo_categoria text;

do $$ begin
    alter table public.estado_cliente add constraint estado_cliente_motivo_categoria_chk
        check (motivo_categoria in ('com_acao', 'regra_esteira', 'sem_contato', 'encerrado'));
exception when duplicate_object then null; end $$;

-- resumo por carteira: grupo, título curto (sem o "sem ação: ") e quantidade
drop view if exists public.motivos_hoje;
create view public.motivos_hoje with (security_invoker = true) as
    select empresa_id, credor_id,
           coalesce(motivo_hoje, 'ainda não calculado') as motivo,
           coalesce(motivo_categoria, case when motivo_hoje = 'com ação hoje' then 'com_acao' end) as categoria,
           initcap(left(regexp_replace(coalesce(motivo_hoje, 'ainda não calculado'), '^sem ação: ', ''), 1))
               || substr(regexp_replace(coalesce(motivo_hoje, 'ainda não calculado'), '^sem ação: ', ''), 2) as titulo,
           count(*)::int as clientes
    from public.estado_cliente
    where coalesce(na_carga, true)
    group by 1, 2, 3, 4, 5;
comment on view public.motivos_hoje is
    'Clientes da carga por motivo de estar (ou não) na lista de hoje, com o grupo (categoria) para a Lista do dia.';
revoke all on public.motivos_hoje from anon;
grant select on public.motivos_hoje to authenticated;
