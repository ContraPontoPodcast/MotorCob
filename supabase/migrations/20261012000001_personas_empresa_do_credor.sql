-- Persona gravada pelo site sem empresa_id ("Usar nesta carteira" e "+ Persona" mandam só o
-- credor_id): o banco recusava (empresa_id é obrigatório) e a persona nunca aparecia na
-- carteira nem no orquestrador. Agora a empresa vem da carteira (credor) quando não vier.
-- A checagem de permissão (RLS) continua valendo sobre a linha já preenchida.
-- Pode ser rodado de novo sem erro.

create or replace function public.empresa_do_credor() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.empresa_id is null and new.credor_id is not null then
        select c.empresa_id into new.empresa_id from public.credores c where c.id = new.credor_id;
    end if;
    return new;
end $$;

drop trigger if exists a_empresa_do_credor on public.personas_usuario;
create trigger a_empresa_do_credor before insert or update on public.personas_usuario
    for each row execute function public.empresa_do_credor();

drop trigger if exists a_empresa_do_credor on public.segmentos_carteira;
create trigger a_empresa_do_credor before insert or update on public.segmentos_carteira
    for each row execute function public.empresa_do_credor();
