-- SQL 81 · Transferência para humano: o padrão passa a ser a ponte ("o MotorCX segura a ligação e chama a sua fila")
--
-- Decisão do dono (08/11/2026; revisão do especialista C9 e G22): com REFER o Asterisk pede à OPERADORA do cliente que
-- transfira, e muitas recusam ou cobram; com a ponte o MotorCX liga para a fila do cliente e só tira o agente quando o
-- humano atende. Se ninguém atender ou a fila recusar, a pessoa volta para o agente, que pede desculpas e agenda um
-- retorno (voz/orquestrador/nucleo.py › _sem_humano); nunca se desliga na cara.
-- 1. voz_transferencias.metodo: padrão 'ponte' (antes 'refer'). REFER continua como opção explícita (avançada).
-- 2. A ponte não exige mais tronco: sem tronco, o MotorCX liga direto para o endereço SIP da fila (o endpoint
--    tf-<empresa>-<id> que voz/asterisk/gerador.py já gera para destino sem tronco); com tronco, sai pelo tronco.
-- 3. salvar_transferencia_voz: metodo padrão 'ponte' (o resto igual ao SQL 56).
-- As transferências já cadastradas NÃO mudam (quem está com 'refer' continua; o raise notice diz quantas são).
-- Independente dos SQL 79 e 80. Pode rodar de novo.

alter table public.voz_transferencias alter column metodo set default 'ponte';
alter table public.voz_transferencias drop constraint if exists voz_transferencias_check;
comment on column public.voz_transferencias.metodo is
    'ponte (padrão, SQL 81): o MotorCX segura a ligação e chama a fila; sem tronco liga direto no destino_sip. '
    'refer (avançado): pede à operadora que transfira; só se ela confirmar que aceita.';

do $n$
declare n int;
begin
    select count(*) into n from public.voz_transferencias where metodo = 'refer';
    raise notice 'SQL 81: % transferência(s) cadastrada(s) com REFER continuam com REFER (mude no Console, se quiser)', n;
end $n$;

create or replace function public.salvar_transferencia_voz(empresa bigint, nome text, destino_sip text,
                                                           metodo text default 'ponte', tronco bigint default null,
                                                           tech_prefix text default null, credor bigint default null,
                                                           ativo boolean default true, transferencia bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare tid bigint := transferencia;
begin
    if not public.cuida_voz(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz configura a transferência';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if tid is null then
        insert into public.voz_transferencias (empresa_id, credor_id, nome, destino_sip, metodo, tronco_id, tech_prefix, ativo)
        values (empresa, credor, trim(nome), trim(destino_sip), metodo, tronco, tech_prefix, coalesce(ativo, true))
        returning id into tid;
    else
        update public.voz_transferencias v
           set credor_id = credor, nome = trim(salvar_transferencia_voz.nome),
               destino_sip = trim(salvar_transferencia_voz.destino_sip), metodo = salvar_transferencia_voz.metodo,
               tronco_id = tronco, tech_prefix = salvar_transferencia_voz.tech_prefix,
               ativo = coalesce(salvar_transferencia_voz.ativo, true), atualizado_em = now(),
               testado_em = case when v.destino_sip = trim(salvar_transferencia_voz.destino_sip) then v.testado_em end,
               teste_ok = case when v.destino_sip = trim(salvar_transferencia_voz.destino_sip) then v.teste_ok end
         where v.id = tid and v.empresa_id = empresa;
        if not found then
            raise exception 'transferência não encontrada';
        end if;
    end if;
    return tid;
end $$;
revoke all on function public.salvar_transferencia_voz(bigint, text, text, text, bigint, text, bigint, boolean, bigint)
    from public, anon;
grant execute on function public.salvar_transferencia_voz(bigint, text, text, text, bigint, text, bigint, boolean, bigint)
    to authenticated;
