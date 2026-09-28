-- Clusters por empresa, definidos no site.
--
-- Cada empresa tem uma lista de regras em ordem. Vale a primeira cuja lista de
-- condições bate inteira; quem não bate em nenhuma fica no cluster padrão
-- ticket x atraso (A1…B3). O código entra na TAG do cliente.
--
-- condicoes: [{"campo": "PRODUTO", "op": "=", "valor": "CARTAO"}, ...]  (todas precisam bater)
--   campo: coluna da base bruta da empresa (lista em empresas.colunas_base) ou um campo
--          calculado: saldo, dias_atraso, qtd_contratos
--   op:    = · != · > · >= · < · <= · em · nao_em · contem · vazio · preenchido
--          (em/nao_em: valor é uma lista, ex.: ["SP","RJ"])
--
-- A rotina do motor lê as regras ativas a cada dia; mudança vale a partir da rotina
-- seguinte e revisa o cluster atual de todos os clientes da empresa (o de origem não muda).

alter table public.empresas add column colunas_base jsonb;
comment on column public.empresas.colunas_base is
    'Colunas da última base bruta (só nome e tipo, nunca valores). Gravado pela rotina do motor.';

create table public.clusters (
    id                 bigint generated always as identity primary key,
    empresa_id         bigint not null references public.empresas (id) on delete cascade,
    ordem              int not null default 100,
    codigo             text not null check (codigo ~ '^[A-Z0-9]{1,4}$'),
    nome               text not null default '',
    condicoes          jsonb not null default '[]' check (jsonb_typeof(condicoes) = 'array'),
    pacote             text not null default 'básico',          -- pacote de enriquecimento
    revalida_dias      int not null default 90 check (revalida_dias between 1 and 3650),
    so_digital         boolean not null default false,          -- sem agente virtual e discador
    voz_d0             boolean not null default false,          -- voz no D0 do preventivo
    canais_bloqueados  text[] not null default '{}'
        check (canais_bloqueados <@ array['whatsapp','rcs','agente_voz','discador','sms','email']),
    ativo              boolean not null default true,
    atualizado_em      timestamptz not null default now(),
    atualizado_por     uuid default auth.uid() references auth.users (id),
    unique (empresa_id, codigo)
);
create index on public.clusters (empresa_id, ordem);
comment on table public.clusters is 'Regras de cluster da empresa, em ordem; vale a primeira que bate.';

create function public.carimbar_cluster() returns trigger
language plpgsql set search_path = public as $$
begin
    new.atualizado_em := now();
    new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
    return new;
end $$;

create trigger carimbar_cluster before insert or update on public.clusters
    for each row execute function public.carimbar_cluster();

alter table public.clusters enable row level security;

create policy clusters_ver on public.clusters for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
create policy clusters_criar on public.clusters for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
create policy clusters_editar on public.clusters for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
create policy clusters_apagar on public.clusters for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));

revoke all on public.clusters from anon;
