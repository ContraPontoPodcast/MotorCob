-- Playbook de frases da empresa, por canal (página Canais → Frases). A empresa importa o playbook
-- (planilha) ou cria as frases; na estratégia (Mensagens) cada célula estágio × canal aponta uma frase
-- do playbook ({"frase_id": n}) ou tem texto próprio. Corrigir a frase no playbook corrige todas as
-- estratégias que a usam. Variáveis do MotorCob: {saldo} {dias_atraso} {vencimento} {valor_parcela}
-- {qtd_parcelas_abertas}; as outras ({nome}, {link}…) saem como estão para a ferramenta do canal.
-- Pode ser rodado de novo sem erro.

create table if not exists public.frases (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    canal           text not null check (canal in ('whatsapp', 'rcs', 'sms', 'email', 'agente_voz', 'discador')),
    nome            text not null check (length(trim(nome)) between 1 and 120),
    estagio         text check (estagio in ('localizacao', 'cpa', 'cpb', 'giro', 'preventivo', 'quebra')),
    texto           text not null check (length(texto) between 1 and 2000),
    ativo           boolean not null default true,
    origem          text not null default 'criado' check (origem in ('importado', 'criado')),
    criado_em       timestamptz not null default now(),
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    unique (empresa_id, canal, nome)
);
create index if not exists frases_empresa_canal on public.frases (empresa_id, canal) where ativo;

drop trigger if exists carimbar_frase on public.frases;
create trigger carimbar_frase before insert or update on public.frases
    for each row execute function public.carimbar_cluster();

alter table public.frases enable row level security;
drop policy if exists frases_ver on public.frases;
create policy frases_ver on public.frases for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists frases_criar on public.frases;
create policy frases_criar on public.frases for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()));
drop policy if exists frases_editar on public.frases;
create policy frases_editar on public.frases for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()))
    with check (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()));
drop policy if exists frases_apagar on public.frases;
create policy frases_apagar on public.frases for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and empresa_id in (select public.minhas_empresas()));
revoke all on public.frases from anon;
