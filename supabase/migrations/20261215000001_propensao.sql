-- SQL 48 · Propensão a pagamento (fase 1: taxas por célula)
-- A rotina calcula, por cliente ativo, a chance de pagar em 30 dias (quitação ou 1ª parcela do acordo paga;
-- acordo fechado é promessa, não pagamento) e a faixa A (muito alta) … E (muito baixa). Em "Coletando"
-- (menos de 30 pagamentos no treino) a faixa fica vazia. Ver motor/propensao.py.
--   estado_cliente: + propensao (0 a 1, 4 casas) e faixa_propensao (A–E; vazio = sem faixa)
--   personas:       + propensao (jsonb: clientes, saldo, p média, pagamentos e valor esperados, evidência)
--   view propensao_carteira: por carteira × segmento × faixa × persona da empresa, só quem está na carga
-- Nenhum dado pessoal: só ID do cliente, número e faixa. A view enquadramento não muda.
-- Pode rodar de novo sem erro.

alter table public.estado_cliente
    add column if not exists propensao numeric(5, 4),
    add column if not exists faixa_propensao text;

do $$ begin
    alter table public.estado_cliente add constraint estado_cliente_faixa_propensao_chk
        check (faixa_propensao in ('A', 'B', 'C', 'D', 'E'));
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.estado_cliente add constraint estado_cliente_propensao_chk
        check (propensao between 0 and 1);
exception when duplicate_object then null; end $$;

comment on column public.estado_cliente.propensao is
    'Propensão a pagamento: chance de pagar (quitação ou 1ª parcela) em 30 dias; vazio = fora da população.';
comment on column public.estado_cliente.faixa_propensao is
    'Faixa da propensão: A (muito alta) … E (muito baixa); vazio = Coletando ou fora da população.';

alter table public.personas add column if not exists propensao jsonb;
comment on column public.personas.propensao is
    'Propensão a pagamento da persona (só relatório): clientes, saldo, p_media, pagamentos_esperados, '
    'valor_esperado, faixas, evidencia.';

drop view if exists public.propensao_carteira;
create view public.propensao_carteira with (security_invoker = true) as
    select empresa_id,
           credor_id,
           cluster_atual as cluster,
           coalesce(faixa_propensao, '') as faixa_propensao,
           coalesce(persona_usuario, '') as persona_usuario,
           count(*)::int as clientes,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo,
           avg(propensao)::numeric(5, 4) as propensao_media,
           coalesce(sum(propensao), 0)::numeric(12, 2) as pagamentos_esperados,
           coalesce(sum(propensao * saldo), 0)::numeric(16, 2) as valor_esperado
    from public.estado_cliente
    where coalesce(na_carga, true) and propensao is not null
    group by 1, 2, 3, 4, 5;
comment on view public.propensao_carteira is
    'Propensão a pagamento por carteira, segmento, faixa (A–E; vazio = Coletando) e persona da empresa: '
    'clientes, saldo, p média e valor esperado (só quem está na carga).';
revoke all on public.propensao_carteira from anon;
grant select on public.propensao_carteira to authenticated;
