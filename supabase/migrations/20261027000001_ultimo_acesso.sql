-- Último acesso de cada usuário em perfis.ultimo_acesso (página Usuários: "Último acesso" e "Convite enviado"
-- enquanto a pessoa nunca entrou). Copiado do login do Supabase (auth.users.last_sign_in_at) a cada entrada.
-- Pode ser rodado de novo sem erro.

alter table public.perfis add column if not exists ultimo_acesso timestamptz;

create or replace function public.copiar_ultimo_acesso() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    update public.perfis set ultimo_acesso = new.last_sign_in_at
    where id = new.id and ultimo_acesso is distinct from new.last_sign_in_at;
    return new;
end $$;

drop trigger if exists ao_entrar_usuario on auth.users;
create trigger ao_entrar_usuario after update of last_sign_in_at on auth.users
    for each row execute function public.copiar_ultimo_acesso();

-- quem já entrou antes desta migração
update public.perfis p set ultimo_acesso = u.last_sign_in_at
from auth.users u
where u.id = p.id and p.ultimo_acesso is distinct from u.last_sign_in_at;
