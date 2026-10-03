-- Carimbo de alteração na carteira (credores): a vigia do Mac refaz a lista quando a esteira padrão
-- da carteira muda (e quando muda segmento, esteira, persona ou canal). Pode ser rodado de novo.
alter table public.credores
    add column if not exists atualizado_em timestamptz not null default now(),
    add column if not exists atualizado_por uuid default auth.uid() references auth.users (id);
drop trigger if exists carimbar_credor on public.credores;
create trigger carimbar_credor before insert or update on public.credores
    for each row execute function public.carimbar_cluster();
