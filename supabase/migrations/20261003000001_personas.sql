-- Personas aprendidas pelo motor e sugestões de régua (aprovadas no site).
--
-- * personas: refeita pela rotina a cada dia — cada grupo de clientes parecidos, quantos
--   estão na carga e o ranking de canais (taxa de CPC, tentativas, custo por CPC).
-- * sugestoes: mudanças de régua que o motor recomenda com evidência. A empresa aprova ou
--   recusa no site; na rotina seguinte o motor aplica as aprovadas (cria um segmento com as
--   condições da persona e uma estratégia com a mudança) e marca como 'aplicada'.
-- Pode ser rodado de novo sem erro.

create table if not exists public.personas (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    persona        text not null,                 -- chave (valores das características)
    nome           text not null,
    clientes       int not null default 0,
    condicoes      jsonb not null default '[]',   -- [{campo, valor}]
    ranking        jsonb not null default '[]',   -- [{canal, taxa_cpc, tentativas, cpcs, custo_por_cpc}]
    caracteristicas jsonb not null default '[]',  -- colunas que o motor escolheu
    atualizado_em  timestamptz not null default now(),
    primary key (empresa_id, persona)
);

create table if not exists public.sugestoes (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    chave            text not null,               -- persona|fase|dia|de|para
    texto            text not null,
    dados            jsonb not null,              -- persona, condições, mudança, evidência
    status           text not null default 'pendente'
                     check (status in ('pendente', 'aprovada', 'recusada', 'aplicada')),
    criada_em        timestamptz not null default now(),
    decidida_em      timestamptz,
    decidida_por     uuid references auth.users (id),
    aplicada_em      timestamptz,
    unique (empresa_id, chave)
);

create or replace function public.decidir_sugestao() returns trigger
language plpgsql set search_path = public as $$
begin
    if auth.uid() is not null then
        -- pelo site só se muda o status de pendente para aprovada ou recusada
        if old.status <> 'pendente' or new.status not in ('aprovada', 'recusada')
           or new.chave is distinct from old.chave or new.dados is distinct from old.dados
           or new.texto is distinct from old.texto or new.empresa_id is distinct from old.empresa_id then
            raise exception 'só dá para aprovar ou recusar uma sugestão pendente';
        end if;
        new.decidida_em := now();
        new.decidida_por := auth.uid();
    end if;
    return new;
end $$;

drop trigger if exists decidir_sugestao on public.sugestoes;
create trigger decidir_sugestao before update on public.sugestoes
    for each row execute function public.decidir_sugestao();

alter table public.personas enable row level security;
alter table public.sugestoes enable row level security;

drop policy if exists personas_ver on public.personas;
create policy personas_ver on public.personas for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists sugestoes_ver on public.sugestoes;
create policy sugestoes_ver on public.sugestoes for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists sugestoes_decidir on public.sugestoes;
create policy sugestoes_decidir on public.sugestoes for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));

revoke all on public.personas, public.sugestoes from anon;
