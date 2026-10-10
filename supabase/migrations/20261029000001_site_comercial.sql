-- Página comercial do motorcob.online:
-- * bucket público "site" só com a mídia da página (vídeos curtos, capas, GIFs). Leitura pública pela URL;
--   ninguém grava pelo site (o upload é pelo painel do Supabase).
-- * contatos_site: formulário "Fale com a gente". O visitante só INSERE (não lê nada); campos validados,
--   consentimento LGPD obrigatório e limite contra spam. Só a equipe MotorCob lê.
-- Pode ser rodado de novo sem erro.

insert into storage.buckets (id, name, public) values ('site', 'site', true)
    on conflict (id) do update set public = true;
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
        execute $u$update storage.buckets set file_size_limit = 20971520,
                   allowed_mime_types = array['video/mp4', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
                   where id = 'site'$u$;
    end if;
end $$;

create table if not exists public.contatos_site (
    id            uuid primary key default gen_random_uuid(),
    criado_em     timestamptz not null default now(),
    nome          text not null check (length(trim(nome)) between 2 and 120),
    empresa       text check (length(empresa) <= 120),
    email         text not null check (length(email) <= 254 and email ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$'),
    telefone      text check (length(telefone) <= 30 and telefone ~ '^[0-9 ()+.-]*$'),
    mensagem      text check (length(mensagem) <= 2000),
    consentimento boolean not null check (consentimento),
    origem        text check (length(origem) <= 60)
);
create index if not exists contatos_site_email on public.contatos_site (lower(email), criado_em desc);

create or replace function public.limitar_contatos_site() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if (select count(*) from public.contatos_site
        where lower(email) = lower(new.email) and criado_em > now() - interval '1 hour') >= 3
       or (select count(*) from public.contatos_site where criado_em > now() - interval '1 hour') >= 200 then
        raise exception 'muitas mensagens em pouco tempo; tente mais tarde';
    end if;
    new.id := gen_random_uuid();
    new.criado_em := now();
    return new;
end $$;
drop trigger if exists limitar_contatos_site on public.contatos_site;
create trigger limitar_contatos_site before insert on public.contatos_site
    for each row execute function public.limitar_contatos_site();

alter table public.contatos_site enable row level security;
revoke all on public.contatos_site from anon, authenticated;
grant insert (nome, empresa, email, telefone, mensagem, consentimento, origem) on public.contatos_site to anon, authenticated;
grant select on public.contatos_site to authenticated;
drop policy if exists contatos_site_enviar on public.contatos_site;
create policy contatos_site_enviar on public.contatos_site for insert to anon, authenticated
    with check (consentimento);
drop policy if exists contatos_site_ler on public.contatos_site;
create policy contatos_site_ler on public.contatos_site for select to authenticated
    using (public.admin_equipe());
