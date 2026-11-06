-- SQL 71 · Faturamento: cancelar o rascunho de uma fatura (Console › Faturamento › Rascunhos)
-- (o SQL 68 é o 20270104000001_voz_fluxo_equipe.sql)
-- O site já tinha o botão "Cancelar rascunho" (cancelar_rascunho(fatura)), mas a função nunca existiu no banco: o
-- clique dava "Could not find the function public.cancelar_rascunho(fatura) in the schema cache". O caminho já estava
-- previsto desde o 20261106000001_faturas_revisao.sql: "Rascunho só vira aberta por aqui ou cancelada" — o
-- gatilho proteger_situacao_fatura aceita rascunho → cancelada; só faltava quem fizesse a transição pelo site.
--
-- Regra: só rascunho vira cancelada (fatura emitida, paga ou vencida não passa por aqui). Quem pode é quem emite a
-- fatura daquela empresa — equipe_pode('emitir_faturas', empresa), a mesma checagem de emitir_fatura/ajustar_fatura
-- (catálogo de permissões da equipe; dentro do alcance da pessoa). O cliente não cancela (nem vê o rascunho).
-- A linha fica (situacao = 'cancelada'), com o z_auditar das faturas registrando quem cancelou; não é apagada.
-- Efeito conhecido: a competência daquela empresa continua com fatura (cancelada), então gerar_rascunhos não gera outro
-- rascunho para ela sozinho — o mesmo comportamento de qualquer fatura cancelada.
--
-- Nada para anon. Sem superusuário. Pode rodar de novo sem erro.

create or replace function public.cancelar_rascunho(fatura bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
    e bigint;
    n int;
begin
    select f.empresa_id into e from public.faturas f where f.id = cancelar_rascunho.fatura;
    if auth.uid() is not null and (e is null or not public.equipe_pode('emitir_faturas', e)) then
        raise exception 'sem permissão para cancelar o rascunho desta fatura';
    end if;
    update public.faturas f set situacao = 'cancelada'
     where f.id = cancelar_rascunho.fatura and f.situacao = 'rascunho';
    get diagnostics n = row_count;
    if n = 0 then
        raise exception 'fatura não está em rascunho';
    end if;
end $$;
comment on function public.cancelar_rascunho(bigint) is
    'Rascunho → cancelada (só rascunho). Quem emite a fatura da empresa: equipe_pode(''emitir_faturas'', empresa). SQL 71.';
revoke all on function public.cancelar_rascunho(bigint) from public, anon;
grant execute on function public.cancelar_rascunho(bigint) to authenticated;
