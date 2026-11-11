-- SQL 111 · Agente de voz: a perna humana (Power e Preditivo, V8; PREDITIVO.md 3.8, P14). O MotorCX não enxerga quantos
-- operadores do cliente estão livres, então não disca prevendo a fila humana: a IA atende primeiro e só transfere até
-- um limite. Passou do limite (ou a fila ficou cheia), o agente continua a conversa e agenda o retorno; o desfecho é
-- transferencia_sem_operador (SQL 106), que não é abandono.
--
-- 1. voz_transferencias.simultaneas: "Operadores para transferência ao mesmo tempo" (1 a 500, padrão 5; o cliente
--    informa à equipe). A VM nunca tem mais transferências tocando ou em ponte para o destino do que isso.
-- 2. voz_vm.transferencias_operadores (id, simultaneas): a leitura da VM no acesso próprio. voz_vm.transferencias
--    (SQL 57) não muda, para o SQL 57 continuar podendo rodar de novo; a VM junta as duas (voz/configuracao.py).
-- 3. definir_operadores_transferencia_voz(transferencia, simultaneas): quem configura a transferência (a equipe que
--    cuida da voz da empresa, como salvar_transferencia_voz) muda o número; auditado pelo z_auditar da tabela, se houver.
-- Depende dos SQL 56/57. Pode rodar de novo.

-- ================================================================ 1. coluna
alter table public.voz_transferencias add column if not exists simultaneas int not null default 5
    check (simultaneas between 1 and 500);
comment on column public.voz_transferencias.simultaneas is
    'Operadores para transferência ao mesmo tempo (padrão 5): a VM nunca passa disso; passou, o agente agenda retorno '
    '(transferencia_sem_operador). SQL 111.';

-- ================================================================ 2. leitura da VM (acesso próprio)
-- uma view própria (id, simultaneas), e não uma coluna nova em voz_vm.transferencias: o SQL 57 recria aquela view
-- com as colunas dele e precisa continuar podendo rodar de novo por cima (create or replace não tira coluna)
create or replace view voz_vm.transferencias_operadores with (security_barrier = true) as
    select t.id, t.simultaneas from public.voz_transferencias t;
revoke all on voz_vm.transferencias_operadores from public, anon, authenticated, service_role;
grant select on voz_vm.transferencias_operadores to motorcx_voz;

-- ================================================================ 3. quem configura a transferência muda o número
create or replace function public.definir_operadores_transferencia_voz(transferencia bigint, simultaneas int)
returns int
language plpgsql security definer set search_path = public as $$
declare
    emp bigint;
begin
    select t.empresa_id into emp from public.voz_transferencias t where t.id = transferencia;
    if emp is null then
        raise exception 'transferência não encontrada';
    end if;
    if not public.cuida_voz(emp) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz configura a transferência';
    end if;
    if simultaneas is null or simultaneas not between 1 and 500 then
        raise exception 'operadores ao mesmo tempo: de 1 a 500';
    end if;
    update public.voz_transferencias v
       set simultaneas = definir_operadores_transferencia_voz.simultaneas, atualizado_em = now()
     where v.id = transferencia;
    return simultaneas;
end $$;
revoke all on function public.definir_operadores_transferencia_voz(bigint, int) from public, anon;
grant execute on function public.definir_operadores_transferencia_voz(bigint, int) to authenticated;
