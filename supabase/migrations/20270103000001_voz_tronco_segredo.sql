-- SQL 67 · Agente de voz: a referência da senha do tronco começa com voz/
-- (o SQL 66 é o 20270102000001_voz_fluxo_site.sql)
-- Por quê: voz_troncos.segredo_ref é o NOME do segredo no Secret Manager. A VM transforma a referência no nome do
-- segredo (barras e pontos viram hífen, prefixo motorcx-; voz/segredos.py) e a conta da VM só lê segredos
-- motorcx-voz-* e motorcx-crm-* (infra/asterisk/criar_gcp.sh). Uma referência como 'sip/aurora-opc' (o exemplo antigo
-- da tela) vira motorcx-sip-aurora-opc, que a VM não consegue ler: o tronco não sobe. Com voz/, a referência
-- 'voz/trunk/aurora-opc' vira motorcx-voz-trunk-aurora-opc.
-- Como: trigger em voz_troncos que confere só quando a referência é nova ou MUDA (inserção, ou update em que
-- segredo_ref muda). Tronco já salvo com outra referência continua funcionando e salvando enquanto ela não muda
-- (por isso não é um check na tabela: um check, mesmo "not valid", recusaria qualquer update da linha antiga).
-- O site confere o mesmo (site/src/lib/voz.ts › segredoTroncoOk). Vale para o RPC cadastrar_tronco_voz e para
-- qualquer outra escrita. Nada para anon. Pode rodar de novo sem erro. Depende do SQL 56 (voz_troncos).
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select count(*) from pg_trigger where tgname = 'voz_troncos_segredo_voz'
--      and tgrelid = 'public.voz_troncos'::regclass;                                                   -- 1
--   -- troncos antigos que a VM não lê (troque a referência e crie o segredo motorcx-voz-... correspondente):
--   select id, empresa_id, referencia, segredo_ref from public.voz_troncos
--    where segredo_ref is not null and segredo_ref !~ '^voz/';

create or replace function public.voz_troncos_conferir_segredo() returns trigger
language plpgsql set search_path = '' as $$
begin
    if new.segredo_ref is null or new.segredo_ref ~ '^voz/[A-Za-z0-9_./-]{1,116}$' then
        return new;
    end if;
    -- referência antiga que não muda: no update, a mesma da linha; no insert do upsert (cadastrar_tronco_voz faz
    -- "insert ... on conflict do update", e o trigger de insert roda antes do conflito), a mesma do tronco que existe
    if tg_op = 'UPDATE' and new.segredo_ref is not distinct from old.segredo_ref then
        return new;
    end if;
    if tg_op = 'INSERT' and exists (select 1 from public.voz_troncos t
                                     where t.empresa_id = new.empresa_id and t.referencia = new.referencia
                                       and t.segredo_ref = new.segredo_ref) then
        return new;
    end if;
    raise exception 'a referência da senha do tronco precisa começar com voz/ (ex.: voz/trunk/aurora-opc): a VM só lê os segredos motorcx-voz-*';
end $$;
revoke all on function public.voz_troncos_conferir_segredo() from public, anon, authenticated;

drop trigger if exists voz_troncos_segredo_voz on public.voz_troncos;
create trigger voz_troncos_segredo_voz before insert or update of segredo_ref on public.voz_troncos
    for each row execute function public.voz_troncos_conferir_segredo();
