-- Excluir segmento, desvincular segmento da carteira, apagar persona, esteira ou canal também
-- precisa refazer a lista. A vigia percebe mudança pelo atualizado_em, mas uma linha apagada não
-- deixa carimbo: este gatilho carimba a(s) carteira(s) afetada(s) (credores.atualizado_em), e a
-- vigia reenquadra em até 1 minuto. Pode ser rodado de novo sem erro.

create or replace function public.orquestracao_excluida() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    cred bigint := nullif(to_jsonb(old) ->> 'credor_id', '')::bigint;
begin
    update public.credores set atualizado_em = now()
     where empresa_id = old.empresa_id and (cred is null or id = cred);
    return old;
end $$;
revoke all on function public.orquestracao_excluida() from public, anon, authenticated;

do $$
declare t text;
begin
    foreach t in array array['clusters', 'segmentos_carteira', 'personas_usuario', 'estrategias', 'canais_empresa']
    loop
        if to_regclass('public.' || t) is not null then
            execute format('drop trigger if exists z_orquestracao_excluida on public.%I', t);
            execute format('create trigger z_orquestracao_excluida after delete on public.%I '
                           'for each row execute function public.orquestracao_excluida()', t);
        end if;
    end loop;
end $$;
