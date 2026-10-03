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

drop view if exists public.mapa_esteira;  -- refeita (a de credores acrescenta credor_id)
create view public.mapa_esteira with (security_invoker = true) as
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

drop view if exists public.acoes_hoje;  -- refeita (a de credores acrescenta credor_id)
create view public.acoes_hoje with (security_invoker = true) as
    select empresa_id, data, regua, passo, canal, reserva, count(*)::int as clientes
    from public.fila_dia
    group by 1, 2, 3, 4, 5, 6;
comment on view public.acoes_hoje is 'Clientes por régua, passo e canal na fila do dia.';

drop view if exists public.fluxo_esteira;  -- refeita (a de credores acrescenta credor_id)
create view public.fluxo_esteira with (security_invoker = true) as
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

-- ===================== 20261005000001_credores.sql
-- Credores: cada empresa tem uma ou mais carteiras (credores). Toda carga é de um credor, e a
-- estratégia, os segmentos, a lista do dia e os números são por credor.
--
-- * credores: código, nome, ativo e a estratégia padrão do credor.
-- * Toda empresa ganha o credor 'principal' (os dados que já existiam vão para ele). Empresa
--   nova também nasce com ele; dá para renomear e criar outros no site.
-- * credor_id em envios, execucoes, estado_cliente, trilha, fila_dia, acoes_dia, personas,
--   sugestoes e kpis (obrigatório) e em clusters (vazio = segmento vale para todos os credores).
--   Chave composta (empresa_id, credor_id) → o credor é sempre da mesma empresa.
-- * Envios: novos tipos 'incremental', 'retirada', 'acordo' e 'baixa' ('base' = carga geral).
--   Envio sem credor: se a empresa tem um credor só, vai para ele; retorno do bureau
--   (enriquecimento) sem credor vale para todos; os demais tipos exigem o credor.
-- * Saídas no Storage passam a ser saidas/<slug>/<data>/<credor>/… (ids/ continua liberado).
-- * Views ganham credor_id.
-- Pode ser rodado de novo sem erro.

create table if not exists public.credores (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    codigo         text not null check (codigo ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
    nome           text not null check (length(trim(nome)) between 1 and 80),
    ativo          boolean not null default true,
    estrategia_id  bigint references public.estrategias (id) on delete set null,
    criado_em      timestamptz not null default now(),
    unique (empresa_id, codigo),
    unique (empresa_id, id)
);
comment on table public.credores is 'Carteiras (credores) de cada empresa; estratégia padrão por credor.';

insert into public.credores (empresa_id, codigo, nome)
    select e.id, 'principal', 'Carteira principal' from public.empresas e
    where not exists (select 1 from public.credores c where c.empresa_id = e.id);

create or replace function public.criar_credor_principal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.credores (empresa_id, codigo, nome) values (new.id, 'principal', 'Carteira principal')
        on conflict do nothing;
    return new;
end $$;
drop trigger if exists criar_credor_principal on public.empresas;
create trigger criar_credor_principal after insert on public.empresas
    for each row execute function public.criar_credor_principal();

create or replace function public.checar_estrategia_credor() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.estrategia_id is not null and not exists (
        select 1 from public.estrategias e where e.id = new.estrategia_id and e.empresa_id = new.empresa_id) then
        raise exception 'a estratégia escolhida é de outra empresa';
    end if;
    return new;
end $$;
drop trigger if exists checar_estrategia_credor on public.credores;
create trigger checar_estrategia_credor before insert or update on public.credores
    for each row execute function public.checar_estrategia_credor();

-- linha gravada sem credor (versão antiga da rotina): vai para o credor único ou o principal
create or replace function public.credor_padrao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.credor_id is null then
        select id into new.credor_id from public.credores
        where empresa_id = new.empresa_id order by (codigo = 'principal') desc, id limit 1;
    end if;
    return new;
end $$;

-- credor_id nas tabelas (dados existentes → credor principal da empresa)
do $$
declare t text;
begin
    foreach t in array array['envios', 'execucoes', 'estado_cliente', 'trilha', 'fila_dia', 'acoes_dia',
                             'personas', 'sugestoes', 'kpis', 'clusters'] loop
        execute format('alter table public.%I add column if not exists credor_id bigint', t);
        if not exists (select 1 from pg_constraint where conname = t || '_credor_fk') then
            execute format('alter table public.%I add constraint %I foreign key (empresa_id, credor_id) '
                           'references public.credores (empresa_id, id) on delete cascade', t, t || '_credor_fk');
        end if;
        if t not in ('clusters', 'envios') then
            execute format('update public.%I x set credor_id = c.id from public.credores c '
                           'where x.credor_id is null and c.empresa_id = x.empresa_id and c.codigo = ''principal''', t);
            execute format('alter table public.%I alter column credor_id set not null', t);
            execute format('drop trigger if exists credor_padrao on public.%I', t);
            execute format('create trigger credor_padrao before insert on public.%I '
                           'for each row execute function public.credor_padrao()', t);
        end if;
    end loop;
end $$;
update public.envios x set credor_id = c.id from public.credores c
    where x.credor_id is null and x.tipo <> 'enriquecimento' and c.empresa_id = x.empresa_id and c.codigo = 'principal';

alter table public.estado_cliente drop constraint if exists estado_cliente_pkey,
    add constraint estado_cliente_pkey primary key (empresa_id, credor_id, id_cliente);
alter table public.fila_dia drop constraint if exists fila_dia_pkey,
    add constraint fila_dia_pkey primary key (empresa_id, credor_id, data, canal, id_cliente, reserva);
alter table public.acoes_dia drop constraint if exists acoes_dia_pkey,
    add constraint acoes_dia_pkey primary key (empresa_id, credor_id, data, canal, regua, cluster, persona);
alter table public.personas drop constraint if exists personas_pkey,
    add constraint personas_pkey primary key (empresa_id, credor_id, persona);
alter table public.kpis drop constraint if exists kpis_pkey,
    add constraint kpis_pkey primary key (empresa_id, credor_id, inicio, fim, safra, cluster);
alter table public.sugestoes drop constraint if exists sugestoes_empresa_id_chave_key;
create unique index if not exists sugestoes_credor_chave on public.sugestoes (empresa_id, credor_id, chave);
alter table public.clusters drop constraint if exists clusters_empresa_id_codigo_key;
create unique index if not exists clusters_credor_codigo
    on public.clusters (empresa_id, coalesce(credor_id, 0), codigo);
create index if not exists execucoes_credor_idx on public.execucoes (empresa_id, credor_id, iniciada_em desc);

-- envios: tipos da carteira e credor obrigatório (com as exceções acima)
alter table public.envios drop constraint if exists envios_tipo_check;
alter table public.envios add constraint envios_tipo_check
    check (tipo in ('base', 'incremental', 'retirada', 'acordo', 'baixa', 'ocorrencia', 'enriquecimento',
                    'clientes', 'contatos', 'parcelas', 'retorno', 'portal'));

create or replace function public.credor_do_envio() returns trigger
language plpgsql security definer set search_path = public as $$
declare unico bigint;
begin
    if new.credor_id is null then
        select min(id) into unico from public.credores where empresa_id = new.empresa_id and ativo
            having count(*) = 1;
        if unico is not null then
            new.credor_id := unico;
        elsif new.tipo <> 'enriquecimento' then
            raise exception 'escolha o credor do arquivo';
        end if;
    elsif not exists (select 1 from public.credores c where c.id = new.credor_id and c.ativo) then
        raise exception 'credor inativo';
    end if;
    return new;
end $$;
drop trigger if exists credor_do_envio on public.envios;
create trigger credor_do_envio before insert on public.envios
    for each row execute function public.credor_do_envio();

drop policy if exists entradas_enviar on storage.objects;
create policy entradas_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'entradas' and public.tem_papel('admin', 'planejamento')
                and public.pode_ver_slug((storage.foldername(name))[1])
                and (storage.foldername(name))[2] in ('base', 'incremental', 'retirada', 'acordo', 'baixa',
                                                      'ocorrencia', 'enriquecimento', 'clientes', 'contatos',
                                                      'parcelas', 'retorno', 'portal'));
drop policy if exists saidas_ler_ids on storage.objects;
create policy saidas_ler_ids on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and public.meu_papel() is not null
           and public.pode_ver_slug((storage.foldername(name))[1])
           and ((storage.foldername(name))[3] = 'ids' or (storage.foldername(name))[4] = 'ids'));

-- RLS de credores: todos da empresa veem; admin e planejamento criam e editam (não apagam:
-- credor que sai fica inativo, para não perder o histórico)
alter table public.credores enable row level security;
drop policy if exists credores_ver on public.credores;
create policy credores_ver on public.credores for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists credores_criar on public.credores;
create policy credores_criar on public.credores for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists credores_editar on public.credores;
create policy credores_editar on public.credores for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
revoke all on public.credores from anon;

-- views com credor_id
drop view if exists public.resumo_estados;
create view public.resumo_estados with (security_invoker = true) as
    select empresa_id, credor_id, estado, count(*)::int as clientes
    from public.estado_cliente group by 1, 2, 3;

drop view if exists public.resumo_fila;
create view public.resumo_fila with (security_invoker = true) as
    select empresa_id, credor_id, data, canal, reserva, count(*)::int as clientes
    from public.fila_dia group by 1, 2, 3, 4, 5;

drop view if exists public.ultima_execucao;
create view public.ultima_execucao with (security_invoker = true) as
    select distinct on (empresa_id, credor_id) * from public.execucoes
    order by empresa_id, credor_id, iniciada_em desc;

drop view if exists public.mapa_esteira;
create view public.mapa_esteira with (security_invoker = true) as
    select empresa_id,
           credor_id,
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
    group by 1, 2, 3, 4, 5, 6, 7;

drop view if exists public.acoes_hoje;
create view public.acoes_hoje with (security_invoker = true) as
    select empresa_id, credor_id, data, regua, passo, canal, reserva, count(*)::int as clientes
    from public.fila_dia
    group by 1, 2, 3, 4, 5, 6, 7;

drop view if exists public.fluxo_esteira;
create view public.fluxo_esteira with (security_invoker = true) as
    select empresa_id,
           credor_id,
           data,
           nullif(split_part(tag_anterior, '-', 3), '') as de,
           split_part(tag, '-', 3) as para,
           count(*)::int as clientes
    from public.trilha
    where split_part(tag_anterior, '-', 3) is distinct from split_part(tag, '-', 3)
    group by 1, 2, 3, 4, 5;

-- ===================== 20261006000001_enquadramento.sql
-- Onde cada cliente se enquadrou: a rotina grava, por cliente, a esteira (estratégia do
-- segmento) que ele segue, a persona, se está na carga em cobrança e a ação de hoje.
-- A view enquadramento resume por carteira × segmento × esteira × momento (estado).
-- Pode ser rodado de novo sem erro.

alter table public.estado_cliente
    add column if not exists estrategia text,
    add column if not exists persona text,
    add column if not exists na_carga boolean,
    add column if not exists acao_hoje text,
    add column if not exists passo_hoje text;

drop view if exists public.enquadramento;
create view public.enquadramento with (security_invoker = true) as
    select empresa_id,
           credor_id,
           cluster_atual as cluster,
           coalesce(estrategia, '') as estrategia,
           estado,
           coalesce(na_carga, true) as na_carga,
           count(*)::int as clientes,
           count(*) filter (where coalesce(acao_hoje, '') <> '')::int as com_acao_hoje,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo
    from public.estado_cliente
    group by 1, 2, 3, 4, 5, 6;
comment on view public.enquadramento is 'Clientes por carteira, segmento, esteira, momento e se estão na carga.';

-- ===================== 20261007000001_personas_usuario.sql
-- Personas criadas pela empresa: o perfil do devedor (público), por carteira.
-- Cada persona tem nome e características (condições sobre as colunas da carga e as calculadas:
-- saldo, dias_atraso, qtd_contratos, ddd, tem_whatsapp, tem_rcs). Em ordem: o cliente fica na
-- primeira que bate. Na orquestração, uma ação da esteira pode ir só para algumas personas
-- (estrategias.definicao: {"canal": ..., "personas": [ids]}). O nome da persona do cliente vai
-- para estado_cliente.persona_usuario e para a coluna "persona" usada nos segmentos.
-- Pode ser rodado de novo sem erro.

create table if not exists public.personas_usuario (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint not null,
    nome            text not null check (length(trim(nome)) between 1 and 60),
    descricao       text not null default '',
    ordem           int not null default 100,
    condicoes       jsonb not null default '[]' check (jsonb_typeof(condicoes) = 'array'),
    cor             text,
    ativo           boolean not null default true,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade,
    unique (credor_id, nome)
);
create index if not exists personas_usuario_credor on public.personas_usuario (empresa_id, credor_id, ordem);

drop trigger if exists carimbar_persona_usuario on public.personas_usuario;
create trigger carimbar_persona_usuario before insert or update on public.personas_usuario
    for each row execute function public.carimbar_cluster();

alter table public.personas_usuario enable row level security;
drop policy if exists personas_usuario_ver on public.personas_usuario;
create policy personas_usuario_ver on public.personas_usuario for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists personas_usuario_criar on public.personas_usuario;
create policy personas_usuario_criar on public.personas_usuario for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists personas_usuario_editar on public.personas_usuario;
create policy personas_usuario_editar on public.personas_usuario for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists personas_usuario_apagar on public.personas_usuario;
create policy personas_usuario_apagar on public.personas_usuario for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
revoke all on public.personas_usuario from anon;

alter table public.estado_cliente add column if not exists persona_usuario text;

drop view if exists public.enquadramento;
create view public.enquadramento with (security_invoker = true) as
    select empresa_id,
           credor_id,
           cluster_atual as cluster,
           coalesce(estrategia, '') as estrategia,
           coalesce(persona_usuario, '') as persona_usuario,
           estado,
           coalesce(na_carga, true) as na_carga,
           count(*)::int as clientes,
           count(*) filter (where coalesce(acao_hoje, '') <> '')::int as com_acao_hoje,
           coalesce(sum(saldo), 0)::numeric(16, 2) as saldo
    from public.estado_cliente
    group by 1, 2, 3, 4, 5, 6, 7;

-- ===================== 20261008000001_enriquecimento_esteira.sql
-- Enriquecimento mapeado por cliente: quando a esteira mandou o cliente para o bureau e quando
-- chegou o último retorno (telefones atualizados pelo bureau). A ação "enriquecimento" e a regra
-- de prioridade dos telefones (Score/Ranking) ficam em estrategias.definicao: não precisam de
-- tabela nova. Pode ser rodado de novo sem erro.
alter table public.estado_cliente
    add column if not exists enriq_enviado date,
    add column if not exists enriq_retorno date;

-- ===================== 20261009000001_segmentos_carteira.sql
-- Segmento × carteira: quais carteiras usam cada segmento e se está em uso em cada uma.
--
-- * segmentos_carteira (cluster_id, credor_id, ativo): o segmento vale nas carteiras listadas,
--   e só onde ativo = true. Segmento SEM nenhuma linha aqui segue a regra antiga:
--   clusters.credor_id preenchido = só aquela carteira; vazio = todas as carteiras.
-- * clusters.ativo continua sendo o liga/desliga geral (desligado = não vale em nenhuma).
-- * O que já existia é copiado: segmento de uma carteira vira uma linha com o ativo dele.
-- Pode ser rodado de novo sem erro.

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'clusters_empresa_id_id_key') then
        alter table public.clusters add constraint clusters_empresa_id_id_key unique (empresa_id, id);
    end if;
end $$;

create table if not exists public.segmentos_carteira (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    cluster_id      bigint not null,
    credor_id       bigint not null,
    ativo           boolean not null default true,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (cluster_id, credor_id),
    foreign key (empresa_id, cluster_id) references public.clusters (empresa_id, id) on delete cascade,
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
create index if not exists segmentos_carteira_credor on public.segmentos_carteira (empresa_id, credor_id);

insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo)
    select c.empresa_id, c.id, c.credor_id, c.ativo from public.clusters c
    where c.credor_id is not null
on conflict (cluster_id, credor_id) do nothing;

drop trigger if exists carimbar_segmento_carteira on public.segmentos_carteira;
create trigger carimbar_segmento_carteira before insert or update on public.segmentos_carteira
    for each row execute function public.carimbar_cluster();

alter table public.segmentos_carteira enable row level security;
drop policy if exists segmentos_carteira_ver on public.segmentos_carteira;
create policy segmentos_carteira_ver on public.segmentos_carteira for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists segmentos_carteira_criar on public.segmentos_carteira;
create policy segmentos_carteira_criar on public.segmentos_carteira for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists segmentos_carteira_editar on public.segmentos_carteira;
create policy segmentos_carteira_editar on public.segmentos_carteira for update to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id))
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
drop policy if exists segmentos_carteira_apagar on public.segmentos_carteira;
create policy segmentos_carteira_apagar on public.segmentos_carteira for delete to authenticated
    using (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id));
revoke all on public.segmentos_carteira from anon;

-- visão pronta para o site: cada segmento × cada carteira da empresa, com "em uso" já resolvido
drop view if exists public.segmentos_em_uso;
create view public.segmentos_em_uso with (security_invoker = true) as
    select c.empresa_id,
           cr.id as credor_id,
           c.id as cluster_id,
           c.codigo,
           c.nome,
           c.ordem,
           c.estrategia_id,
           case when exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id)
                then 'escolhidas'
                when c.credor_id is not null then 'uma'
                else 'todas' end as vinculo,
           (c.ativo and case
                when exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id)
                    then coalesce((select x.ativo from public.segmentos_carteira x
                                   where x.cluster_id = c.id and x.credor_id = cr.id), false)
                else c.credor_id is null or c.credor_id = cr.id end) as em_uso,
           (exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id and x.credor_id = cr.id)
            or (not exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id)
                and (c.credor_id is null or c.credor_id = cr.id))) as vinculado
    from public.clusters c
    join public.credores cr on cr.empresa_id = c.empresa_id;
comment on view public.segmentos_em_uso is 'Cada segmento × carteira: se está vinculado e se está em uso (ativo).';

-- ===================== 20261010000001_credores_atualizado.sql
-- Carimbo de alteração na carteira (credores): a vigia do Mac refaz a lista quando a esteira padrão
-- da carteira muda (e quando muda segmento, esteira, persona ou canal). Pode ser rodado de novo.
alter table public.credores
    add column if not exists atualizado_em timestamptz not null default now(),
    add column if not exists atualizado_por uuid default auth.uid() references auth.users (id);
drop trigger if exists carimbar_credor on public.credores;
create trigger carimbar_credor before insert or update on public.credores
    for each row execute function public.carimbar_cluster();

-- ===================== 20261011000001_personas_modelo.sql
-- Modelos de persona do MotorCob (catálogo para o usuário copiar para a carteira).
-- Hipóteses de mercado (cobrança no Brasil): propensão ao digital ou ao analógico (voz).
-- Fonte: regras/personas_modelo.json (o teste confere que os dois estão iguais).
-- Todos os usuários leem; ninguém grava pelo site. Pode ser rodado de novo (atualiza os modelos).

create table if not exists public.personas_modelo (
    id                  text primary key,
    propensao           text not null check (propensao in ('digital', 'analogico')),
    nome                text not null,
    descricao           text not null,
    canais_sugeridos    text[] not null default '{}',
    condicoes           jsonb not null,
    campos_necessarios  text[] not null default '{}',
    ordem               int not null default 100,
    cor                 text
);

insert into public.personas_modelo (id, propensao, nome, descricao, canais_sugeridos, condicoes, campos_necessarios,
                                    ordem, cor)
select e->>'id', e->>'propensao', e->>'nome', e->>'descricao',
       array(select jsonb_array_elements_text(e->'canais_sugeridos')),
       e->'condicoes',
       array(select jsonb_array_elements_text(e->'campos_necessarios')),
       (e->>'ordem')::int, e->>'cor'
from jsonb_array_elements('[{"id": "digital-nativo", "propensao": "digital", "nome": "Digital nativo", "descricao": "Até 35 anos e com WhatsApp. Responde rápido por mensagem, prefere resolver sozinho por link, rejeita ligação. Costuma aceitar acordo no autoatendimento.", "canais_sugeridos": ["whatsapp", "rcs", "sms", "email"], "condicoes": [{"campo": "idade", "op": "<=", "valor": 35}, {"campo": "tem_whatsapp", "op": "=", "valor": "sim"}], "campos_necessarios": ["idade"], "ordem": 10, "cor": "#1F8A4C"}, {"id": "conectado", "propensao": "digital", "nome": "Conectado (WhatsApp + e-mail)", "descricao": "Tem WhatsApp e e-mail, qualquer idade. Lê mensagem e abre e-mail; voz só como reforço depois de dias sem resposta.", "canais_sugeridos": ["whatsapp", "email", "sms", "agente_voz"], "condicoes": [{"campo": "tem_whatsapp", "op": "=", "valor": "sim"}, {"campo": "tem_email", "op": "=", "valor": "sim"}], "campos_necessarios": [], "ordem": 20, "cor": "#3B5BA9"}, {"id": "atraso-recente-ticket-baixo", "propensao": "digital", "nome": "Atraso recente, ticket baixo", "descricao": "Até 30 dias de atraso, saldo até R$ 1.500 e celular. Esquecimento ou aperto pontual: lembrete com link de pagamento resolve; ligação é custo alto para pouco saldo.", "canais_sugeridos": ["sms", "whatsapp", "rcs", "agente_voz"], "condicoes": [{"campo": "dias_atraso", "op": "<=", "valor": 30}, {"campo": "saldo", "op": "<=", "valor": 1500}, {"campo": "tem_celular", "op": "=", "valor": "sim"}], "campos_necessarios": [], "ordem": 30, "cor": "#7A4FB0"}, {"id": "celular-sem-whatsapp", "propensao": "digital", "nome": "Celular sem WhatsApp confirmado", "descricao": "Tem celular, mas o WhatsApp não foi confirmado. RCS e SMS chegam; o agente virtual entra se não houver clique.", "canais_sugeridos": ["rcs", "sms", "agente_voz", "discador"], "condicoes": [{"campo": "tem_celular", "op": "=", "valor": "sim"}, {"campo": "tem_whatsapp", "op": "=", "valor": "não"}], "campos_necessarios": [], "ordem": 70, "cor": "#0E7C86"}, {"id": "senior", "propensao": "analogico", "nome": "Sênior (60+)", "descricao": "60 anos ou mais. Confia mais na voz humana, desconfia de link (medo de golpe) e prefere negociar falando. Mensagem curta e sem link como aviso.", "canais_sugeridos": ["discador", "agente_voz", "sms"], "condicoes": [{"campo": "idade", "op": ">=", "valor": 60}], "campos_necessarios": ["idade"], "ordem": 5, "cor": "#A2552B"}, {"id": "so-telefone-fixo", "propensao": "analogico", "nome": "Só telefone fixo", "descricao": "Nenhum celular na carga, só fixo. Não recebe WhatsApp, SMS nem RCS: voz é o único caminho (melhor horário: fim de tarde e sábado de manhã).", "canais_sugeridos": ["discador", "agente_voz"], "condicoes": [{"campo": "so_fixo", "op": "=", "valor": "sim"}], "campos_necessarios": [], "ordem": 1, "cor": "#475569"}, {"id": "ticket-alto", "propensao": "analogico", "nome": "Ticket alto (R$ 10 mil+)", "descricao": "Saldo de R$ 10 mil ou mais (veículo, imobiliário, empréstimo). Acordo exige negociação: proposta, parcelamento, entrada. Voz humana fecha; WhatsApp apoia com a proposta por escrito.", "canais_sugeridos": ["discador", "whatsapp", "agente_voz", "email"], "condicoes": [{"campo": "saldo", "op": ">=", "valor": 10000}], "campos_necessarios": [], "ordem": 15, "cor": "#C62828"}, {"id": "atraso-longo", "propensao": "analogico", "nome": "Atraso longo (180 dias+)", "descricao": "180 dias ou mais de atraso. Já ignorou mensagens; voz (agente virtual em massa, humano no fim do funil) recupera o contato. Vale enriquecer antes.", "canais_sugeridos": ["agente_voz", "discador", "sms"], "condicoes": [{"campo": "dias_atraso", "op": ">=", "valor": 180}], "campos_necessarios": [], "ordem": 40, "cor": "#E9A23B"}, {"id": "sem-canal-digital", "propensao": "analogico", "nome": "Sem canal digital", "descricao": "Sem WhatsApp, sem RCS e sem e-mail. Mesmo com celular, só a voz e o SMS chegam; priorize enriquecimento para achar canais.", "canais_sugeridos": ["agente_voz", "discador", "sms"], "condicoes": [{"campo": "tem_whatsapp", "op": "=", "valor": "não"}, {"campo": "tem_rcs", "op": "=", "valor": "não"}, {"campo": "tem_email", "op": "=", "valor": "não"}], "campos_necessarios": [], "ordem": 60, "cor": "#6B7280"}]'::jsonb) e
on conflict (id) do update set propensao = excluded.propensao, nome = excluded.nome,
    descricao = excluded.descricao, canais_sugeridos = excluded.canais_sugeridos, condicoes = excluded.condicoes,
    campos_necessarios = excluded.campos_necessarios, ordem = excluded.ordem, cor = excluded.cor;

alter table public.personas_modelo enable row level security;
drop policy if exists personas_modelo_ver on public.personas_modelo;
create policy personas_modelo_ver on public.personas_modelo for select to authenticated using (true);
revoke all on public.personas_modelo from anon;

-- ===== 20261012000001_personas_empresa_do_credor.sql =====
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

-- ===== 20261013000001_demais_ativo.sql =====
-- "Demais clientes" (quem não cai em nenhum segmento em uso na carteira) ligado ou desligado por
-- carteira. Desligado: esses clientes ficam sem ação massiva e sem bureau (acordo segue); o
-- enquadramento mostra a esteira "Demais clientes (desligado)". Mudar dispara a vigia (o carimbo
-- atualizado_em de credores já existe). Pode ser rodado de novo sem erro.

alter table public.credores add column if not exists demais_ativo boolean not null default true;
comment on column public.credores.demais_ativo is
    'Demais clientes (sem segmento em uso) recebem a esteira padrão da carteira? false = ficam sem ação.';

-- ===== 20261014000001_pedidos_rotina.sql =====
-- "Reenquadrar agora": o site registra o pedido e a vigia do Mac (plantão, a cada 5 s) roda a
-- rotina da carteira na hora, reenquadra os clientes com a orquestração atual e refaz a lista do
-- dia. O site acompanha pelo status: pendente → rodando → ok | erro.
-- Pode ser rodado de novo sem erro.

create table if not exists public.pedidos_rotina (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint,
    motivo        text not null default 'reenquadrar' check (motivo in ('reenquadrar')),
    status        text not null default 'pendente' check (status in ('pendente', 'rodando', 'ok', 'erro')),
    pedido_em     timestamptz not null default now(),
    pedido_por    uuid default auth.uid() references auth.users (id),
    iniciado_em   timestamptz,
    terminado_em  timestamptz,
    execucao_id   bigint,
    erro          text,
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
-- um pedido por carteira na fila de cada vez
create unique index if not exists pedidos_rotina_um_na_fila
    on public.pedidos_rotina (empresa_id, coalesce(credor_id, 0)) where status in ('pendente', 'rodando');
create index if not exists pedidos_rotina_credor on public.pedidos_rotina (empresa_id, credor_id, id desc);

drop trigger if exists a_empresa_do_credor on public.pedidos_rotina;
create trigger a_empresa_do_credor before insert on public.pedidos_rotina
    for each row execute function public.empresa_do_credor();

alter table public.pedidos_rotina enable row level security;
drop policy if exists pedidos_rotina_ver on public.pedidos_rotina;
create policy pedidos_rotina_ver on public.pedidos_rotina for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
drop policy if exists pedidos_rotina_criar on public.pedidos_rotina;
create policy pedidos_rotina_criar on public.pedidos_rotina for insert to authenticated
    with check (public.tem_papel('admin', 'planejamento') and public.pode_ver_empresa(empresa_id)
                and status = 'pendente' and iniciado_em is null and terminado_em is null
                and execucao_id is null and erro is null);
-- status, início e fim só a rotina (service_role) grava
revoke all on public.pedidos_rotina from anon;
revoke update, delete on public.pedidos_rotina from authenticated;

-- ===== 20261015000001_motivo_hoje.sql =====
-- Por que cada cliente está (ou não) na lista de hoje: "com ação hoje", "sem ação: a esteira
-- não tem passo no D+2", "sem ação: sem contato para os canais do dia"… Preenchido pela rotina.
-- Pode ser rodado de novo sem erro.

alter table public.estado_cliente add column if not exists motivo_hoje text;

-- resumo por carteira: quantos clientes da carga em cada motivo (para o site)
create or replace view public.motivos_hoje with (security_invoker = true) as
    select empresa_id, credor_id, coalesce(motivo_hoje, 'ainda não calculado') as motivo,
           count(*)::int as clientes
    from public.estado_cliente
    where coalesce(na_carga, true)
    group by 1, 2, 3;
comment on view public.motivos_hoje is 'Clientes da carga por motivo de estar (ou não) na lista de hoje.';
