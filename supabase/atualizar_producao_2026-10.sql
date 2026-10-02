-- Atualização de produção (outubro/2026): cole este arquivo inteiro no SQL Editor e clique em Run.
-- Junta as migrações ainda não aplicadas, na ordem. Pode ser rodado mais de uma vez.

-- ===================== 20260930000001_mapa_esteira.sql
-- Mapa da esteira: onde está concentrada a base em cada etapa dos acionamentos.
--
-- * estado_cliente ganha saldo e dias_atraso (gravados pela rotina; não são dado pessoal)
--   para mostrar a concentração em R$ além da quantidade.
-- * mapa_esteira: clientes e saldo por empresa × estado × etapa (ciclo) × canal × cluster × safra.
-- * acoes_hoje: clientes por régua × passo × canal na fila de cada dia.
-- * fluxo_esteira: quantos clientes passaram de um estado para outro, por dia (trilha).
-- Pode ser rodado de novo sem erro.
-- As views respeitam o RLS das tabelas (security_invoker): cada empresa vê só a sua.

alter table public.estado_cliente
    add column if not exists saldo numeric(14, 2),
    add column if not exists dias_atraso int;

create or replace view public.mapa_esteira with (security_invoker = true) as
    select empresa_id,
           estado,
           case
               when estado = 'LOC' then 'L' || least(coalesce(nullif(substr(ciclo, 2), '')::int, 0), 99)
               when estado = 'NCP' and ciclo = 'RE' then 'RE'
               else coalesce(nullif(ciclo, ''), '-')
           end as etapa,
           canal,
           cluster_atual as cluster,
           to_char(safra, 'YYYY-MM') as safra,
           count(*)::int as clientes,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo
    from public.estado_cliente
    group by 1, 2, 3, 4, 5, 6;
comment on view public.mapa_esteira is 'Clientes e saldo por estado, etapa (ciclo), canal, cluster e safra (mês de entrada).';

create or replace view public.acoes_hoje with (security_invoker = true) as
    select empresa_id, data, regua, passo, canal, reserva, count(*)::int as clientes
    from public.fila_dia
    group by 1, 2, 3, 4, 5, 6;
comment on view public.acoes_hoje is 'Clientes por régua, passo e canal na fila do dia.';

create or replace view public.fluxo_esteira with (security_invoker = true) as
    select empresa_id,
           data,
           nullif(split_part(tag_anterior, '-', 3), '') as de,
           split_part(tag, '-', 3) as para,
           count(*)::int as clientes
    from public.trilha
    where split_part(tag_anterior, '-', 3) is distinct from split_part(tag, '-', 3)
    group by 1, 2, 3, 4;
comment on view public.fluxo_esteira is 'Mudanças de estado por dia (de → para); de nulo = entrada na esteira.';

create index if not exists trilha_empresa_data_idx on public.trilha (empresa_id, data);

-- ===================== 20261002000001_numeros_por_cliente.sql
-- Quantos contatos de cada cliente vão na lista do dia, por canal e por empresa.
--   nulo/1 = um contato (padrão: o CPC da ocorrência marca exatamente esse contato como Hot)
--   2, 3…  = até N contatos      99 = todos
-- Com mais de um contato, o CPC vale para o cliente (CPC A e canal marcado) e os contatos
-- enviados viram candidatos a Hot: as ações seguintes vão a um candidato por vez até um
-- deles dar CPC sozinho.
alter table public.canais_empresa
    add column if not exists numeros_por_cliente int check (numeros_por_cliente between 1 and 99);
comment on column public.canais_empresa.numeros_por_cliente is
    'Contatos por cliente na lista do dia: nulo/1 = um (padrão), 99 = todos.';


-- ===================== 20261003000001_personas.sql
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

-- ===================== 20261004000001_acoes_dia.sql
-- Ações realizadas: quantas ações o MotorCob mandou fazer e o que voltou delas.
--
-- Uma linha por empresa × dia × canal × régua (momento) × segmento × persona. Só número
-- agregado: nenhum ID de cliente, telefone ou e-mail. A rotina do Mac regrava os últimos
-- 60 dias a cada execução (a ocorrência de um dia pode chegar depois).
--   enviadas      ações exportadas na lista (reserva só conta se teve retorno)
--   reservas      ações exportadas como reserva
--   com_retorno   ações com ocorrência/retorno · retornos: total de ocorrências
--   cpcs          ações com CPC · custo: R$ (sem retorno: custo do canal)
--   primeiros_cpc / acoes_ate_primeiro_cpc: média de ações até o 1º CPC = a / b
--   regua = 'fora_da_lista': ocorrência sem ação exportada pelo MotorCob
-- Pode ser rodado de novo sem erro.

create table if not exists public.acoes_dia (
    empresa_id             bigint not null references public.empresas (id) on delete cascade,
    data                   date not null,
    canal                  text not null,
    regua                  text not null default '',
    cluster                text not null default '',
    persona                text not null default '',
    enviadas               int not null default 0,
    reservas               int not null default 0,
    com_retorno            int not null default 0,
    retornos               int not null default 0,
    cpcs                   int not null default 0,
    custo                  numeric(14, 2) not null default 0,
    primeiros_cpc          int not null default 0,
    acoes_ate_primeiro_cpc int not null default 0,
    atualizado_em          timestamptz not null default now(),
    primary key (empresa_id, data, canal, regua, cluster, persona)
);

create index if not exists acoes_dia_empresa_data on public.acoes_dia (empresa_id, data);

alter table public.acoes_dia enable row level security;

drop policy if exists acoes_dia_ver on public.acoes_dia;
create policy acoes_dia_ver on public.acoes_dia for select to authenticated
    using (public.pode_ver_empresa(empresa_id));

revoke all on public.acoes_dia from anon;
