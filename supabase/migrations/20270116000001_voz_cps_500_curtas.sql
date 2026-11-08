-- SQL 80 · Telefonia: CPS de 1 a 500 e chamadas curtas pela regra da Anatel (vigência 12/11/2026)
--
-- Decisões do dono (08/11/2026; revisão do especialista C1, C14 e C16):
-- 1. CPS de 1 a 500 (voz_troncos.cps). O banco aceitava até 1.000, mas a VM (voz/banco.py › ler_tronco) recusa acima de
--    500: um tronco com 600 deixava a configuração de voz de todas as empresas parada. Antes de apertar o check, as
--    linhas acima de 500 passam a 500 (raise notice com a quantidade e os ids; z_auditar registra cada mudança).
-- 2. Chamadas curtas (Despacho Decisório Anatel nº 100/2026; MP 1.396/2026): o aviso padrão passa de 75% para 70%
--    (regras_curtas_voz, cópia de motor/discagem.py › PADRAO; tests/test_resubmit.py confere) e a falha técnica (não
--    completada) conta SEMPRE como curta: chamada_curta_voz ignora um `falha_conta: false` salvo antes (motor/discagem.py
--    › e_curta faz o mesmo). O corte ligado em 80% e os horários por UF ligados são padrão do motor (regras/regua.json):
--    nada muda no banco para isso (credores.discagem guarda só o que a carteira mudou).
-- Independente do SQL 79 (pode rodar antes dele). Pode rodar de novo.

-- ================================================================ 1. CPS de 1 a 500
do $cps$
declare n int; ids text;
begin
    select count(*), string_agg(id::text, ', ' order by id) into n, ids from public.voz_troncos where cps > 500;
    if n > 0 then
        update public.voz_troncos set cps = 500, atualizado_em = now() where cps > 500;
        raise notice 'SQL 80: % tronco(s) com CPS acima de 500 passaram a 500 (ids: %)', n, ids;
    else
        raise notice 'SQL 80: nenhum tronco com CPS acima de 500';
    end if;
end $cps$;

alter table public.voz_troncos drop constraint if exists voz_troncos_cps_check;
alter table public.voz_troncos add constraint voz_troncos_cps_check check (cps between 1 and 500);
comment on column public.voz_troncos.cps is
    'Chamadas por segundo do tronco, de 1 a 500 (SQL 80; o mesmo limite da VM em voz/banco.py › ler_tronco).';

-- ================================================================ 2. chamadas curtas (gerado de motor/voz.py e motor/discagem.py)
create or replace function public.regras_curtas_voz() returns jsonb
language sql immutable parallel safe as $$
    select '{"sempre":["numero_inexistente","nao_atendida","caixa_postal","ocupado","falha_rede","inexistente_voz","maquina","falha_operadora","bloqueio_originacao","cancelada_discador","indisponivel","rejeitada"],"abandono":["abandonada"],"tecnicos":["falha_rede","falha_operadora","bloqueio_originacao","cancelada_discador","indisponivel"],"segundos":6,"aviso":0.7,"prior":0.9,"forca_carteira":20.0,"forca_numero":5.0}'::jsonb
$$;

-- motor/discagem.py › e_curta: cc = credores.discagem › chamadas_curtas (o que faltar vale o padrão). A falha técnica
-- (não completada) é sempre curta: `falha_conta` ficou travado em sim (Despacho Anatel 100/2026).
create or replace function public.chamada_curta_voz(resultado text, duracao_s int, cc jsonb default '{}') returns boolean
language sql immutable parallel safe as $$
    with r as (select public.regras_curtas_voz() as g)
    select case
        when duracao_s is not null and duracao_s <= coalesce((cc ->> 'segundos')::int, (r.g ->> 'segundos')::int) then true
        when resultado in (select jsonb_array_elements_text(r.g -> 'sempre')) then true
        else coalesce(resultado in (select jsonb_array_elements_text(r.g -> 'abandono')), false)
             and coalesce((cc ->> 'abandono_conta')::boolean, true) end
      from r
$$;
revoke all on function public.regras_curtas_voz(), public.chamada_curta_voz(text, int, jsonb) from public, anon;
grant execute on function public.regras_curtas_voz(), public.chamada_curta_voz(text, int, jsonb) to authenticated, service_role;
