-- SQL 110 · Agente de voz: o histórico que o Preditivo usa (Power e Preditivo, V5; PREDITIVO.md 3.2, Parte 4).
-- O controlador do Preditivo (voz/orquestrador/ritmo.py) precisa, por carteira, do que aconteceu nos últimos dias:
--   - aquecimento: a carteira só sai do Power 1,0 com 200 atendidas por pessoa nos últimos 7 dias;
--   - a base do p (chance de atender por pessoa) antes de juntar amostra no dia: a carteira em 7 dias (sem histórico, a
--     empresa);
--   - a primeira semana no Preditivo (razão máxima 2,0): há quantos dias a carteira disca em Preditivo.
--
-- historico_ritmo_voz(empresa): uma linha por carteira com amostras nos últimos 35 dias: discadas e atendidas por pessoa
-- nos últimos 7 dias (sem hoje: o de hoje a VM conta), dias desde a primeira amostra em Preditivo e o p da empresa em 7
-- dias. Só contagens, das amostras do SQL 106. Só o servidor ou a VM (voz_vm.historico_ritmo); a VM lê ao carregar o
-- lote e a cada 30 min. Nenhuma tabela muda.
-- Depende dos SQL 106 e 108. Pode rodar de novo.

create or replace function public.historico_ritmo_voz(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    hoje date := public.hoje_sp();
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    return jsonb_build_object(
        'p_empresa', (select case when sum(a.discadas) >= 100 then round(sum(a.atendidas_pessoa)::numeric / sum(a.discadas), 4) end
                        from public.voz_ritmo_amostras a
                       where a.empresa_id = historico_ritmo_voz.empresa and a.dia between hoje - 7 and hoje - 1),
        'carteiras', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'credor_id', x.credor_id, 'discadas_7d', x.discadas_7d, 'atendidas_7d', x.atendidas_7d,
                       'dias_preditivo', x.dias_preditivo) order by x.credor_id nulls first)
              from (select a.credor_id,
                           coalesce(sum(a.discadas) filter (where a.dia between hoje - 7 and hoje - 1), 0) as discadas_7d,
                           coalesce(sum(a.atendidas_pessoa) filter (where a.dia between hoje - 7 and hoje - 1), 0)
                               as atendidas_7d,
                           coalesce(hoje - min(a.dia) filter (where a.modo = 'preditivo'), 0) as dias_preditivo
                      from public.voz_ritmo_amostras a
                     where a.empresa_id = historico_ritmo_voz.empresa and a.dia >= hoje - 35
                     group by a.credor_id) x), '[]'::jsonb));
end $$;
revoke all on function public.historico_ritmo_voz(bigint) from public, anon, authenticated;
grant execute on function public.historico_ritmo_voz(bigint) to service_role;

create or replace function voz_vm.historico_ritmo(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.historico_ritmo_voz((args ->> 'empresa')::bigint)
$$;
revoke all on function voz_vm.historico_ritmo(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.historico_ritmo(jsonb) to motorcx_voz;
