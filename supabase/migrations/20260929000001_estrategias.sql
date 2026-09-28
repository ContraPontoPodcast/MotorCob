-- Estratégias de acionamento, canais da empresa e retorno do enriquecimento.
--
-- * estrategias: o que cada cluster faz em cada fase (Novo/localização, CPC, Não CPC/giro,
--   Preventivo, Quebra): passos por dia com o blend de ações (canal, modo, filtro de
--   contato, quantos números). Formato de `definicao` em motor/estrategia.py.
--   Uma estratégia pode ser a padrão da empresa (vale para quem não tem estratégia).
-- * clusters.estrategia_id: a estratégia do cluster.
-- * canais_empresa: limites de cada canal na empresa (ligado, horário, sábado, capacidade
--   por dia, custo, tentativas por dia, respeitar Não Perturbe).
-- * envio do tipo 'enriquecimento': o arquivo que volta do bureau.
-- A rotina lê tudo a cada dia; mudança vale a partir da rotina seguinte.

create table public.estrategias (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    nome            text not null check (length(trim(nome)) between 1 and 80),
    descricao       text not null default '',
    definicao       jsonb not null default '{}' check (jsonb_typeof(definicao) = 'object'),
    padrao          boolean not null default false,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    unique (empresa_id, nome)
);
create unique index estrategias_uma_padrao on public.estrategias (empresa_id) where padrao;
comment on table public.estrategias is 'Estratégia de acionamento por fase; usada pelos clusters da empresa.';

alter table public.clusters
    add column estrategia_id bigint references public.estrategias (id) on delete set null;

-- a estratégia do cluster tem de ser da mesma empresa
create function public.checar_estrategia_cluster() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.estrategia_id is not null and not exists (
        select 1 from public.estrategias e where e.id = new.estrategia_id and e.empresa_id = new.empresa_id) then
        raise exception 'a estratégia escolhida é de outra empresa';
    end if;
    return new;
end $$;
create trigger checar_estrategia_cluster before insert or update on public.clusters
    for each row execute function public.checar_estrategia_cluster();

create table public.canais_empresa (
    empresa_id              bigint not null references public.empresas (id) on delete cascade,
    canal                   text not null check (canal in ('whatsapp','rcs','agente_voz','discador','sms','email')),
    ativo                   boolean not null default true,
    janela_inicio           text check (janela_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    janela_fim              text check (janela_fim ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    sabado                  boolean not null default true,
    capacidade_dia          int check (capacidade_dia > 0),
    custo                   numeric(12, 4) check (custo >= 0),
    tentativas_dia          int check (tentativas_dia between 1 and 20),
    respeitar_nao_perturbe  boolean,          -- nulo = padrão (voz respeita, digitais não)
    atualizado_em           timestamptz not null default now(),
    atualizado_por          uuid default auth.uid() references auth.users (id),
    primary key (empresa_id, canal)
);
comment on table public.canais_empresa is 'Limites de cada canal na empresa; valem para todas as estratégias.';

create trigger carimbar_estrategia before insert or update on public.estrategias
    for each row execute function public.carimbar_cluster();
create trigger carimbar_canal before insert or update on public.canais_empresa
    for each row execute function public.carimbar_cluster();

alter table public.estrategias enable row level security;
alter table public.canais_empresa enable row level security;

create policy estrategias_ver on public.estrategias for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
create policy estrategias_criar on public.estrategias for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
create policy estrategias_editar on public.estrategias for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
create policy estrategias_apagar on public.estrategias for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));

create policy canais_ver on public.canais_empresa for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
create policy canais_criar on public.canais_empresa for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
create policy canais_editar on public.canais_empresa for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
create policy canais_apagar on public.canais_empresa for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));

revoke all on public.estrategias, public.canais_empresa from anon;

-- ---------------------------------------------------------------- envio do enriquecimento
alter table public.envios drop constraint envios_tipo_check, add constraint envios_tipo_check
    check (tipo in ('base', 'ocorrencia', 'enriquecimento', 'clientes', 'contatos', 'parcelas', 'retorno',
                    'portal'));

drop policy entradas_enviar on storage.objects;
create policy entradas_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'entradas' and public.tem_papel('admin', 'planejamento')
                and public.pode_ver_slug((storage.foldername(name))[1])
                and (storage.foldername(name))[2] in ('base', 'ocorrencia', 'enriquecimento', 'clientes',
                                                      'contatos', 'parcelas', 'retorno', 'portal'));
