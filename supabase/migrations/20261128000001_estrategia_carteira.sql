-- SQL 31 · Bloco 3 da homologação (aprovado em 14/10/2026): Orquestração por carteira.
--
-- 1. Estratégia por carteira: segmentos_carteira.estrategia_id é a estratégia própria da carteira naquele
--    segmento e vale sobre clusters.estrategia_id. Corrige o "aparece a estratégia do outro credor": a
--    estratégia ficava no segmento, que é da empresa, e duas carteiras com o mesmo segmento a dividiam.
-- 2. segmentos_em_uso passa a trazer a estratégia que vale EM CADA CARTEIRA (estrategia_id), a do segmento
--    (estrategia_segmento), se é própria da carteira e com quais carteiras ela é compartilhada.
-- 3. separar_estrategia(segmento, carteira[, definicao]): "Separar só para esta carteira" (cópia da
--    estratégia atual, só nesta carteira) e "Copiar de outra carteira" (cópia com a definição trazida do
--    editor). A cópia é sempre independente: mudar uma não muda a outra.
-- 4. Rótulos legíveis para o Mapa da Esteira e a Lista do dia (nenhum código cru na tela):
--    rotulo_estado('NCP') = 'Não CPC', rotulo_ciclo('NCP','G2') = '2º ciclo',
--    rotulo_ciclo('NCP','RE') = 'Parado · aguarda enriquecimento', rotulo_passo('CPC B · T1') =
--    'CPC · sem resposta · 1ª tentativa'. O motor tem o mesmo mapa em motor/rotulos.py.
-- 5. Orçamento por canal, prioridade e travas próprias das fases do motor ficam na própria estratégia:
--    estrategias.definicao.<fase>.orcamento e .travas (fase: localizacao, cpc, giro, preventivo, quebra),
--    no mesmo formato das etapas próprias. Quem valida é o motor (motor/etapas.py: validar_fases).
-- Pode ser rodado de novo sem erro.

-- ================================================================ 1. estratégia própria da carteira
alter table public.segmentos_carteira
    add column if not exists estrategia_id bigint references public.estrategias (id) on delete set null;
comment on column public.segmentos_carteira.estrategia_id is
    'Estratégia própria desta carteira neste segmento (vazio = a do segmento, clusters.estrategia_id).';

create or replace function public.checar_estrategia_carteira() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.estrategia_id is not null and not exists (
        select 1 from public.estrategias e where e.id = new.estrategia_id and e.empresa_id = new.empresa_id) then
        raise exception 'a estratégia escolhida é de outra empresa';
    end if;
    return new;
end $$;
drop trigger if exists checar_estrategia_carteira on public.segmentos_carteira;
create trigger checar_estrategia_carteira before insert or update of estrategia_id on public.segmentos_carteira
    for each row execute function public.checar_estrategia_carteira();

-- ================================================================ 2. o que vale em cada carteira
drop view if exists public.segmentos_em_uso;
create view public.segmentos_em_uso with (security_invoker = true) as
    with base as (
        select c.empresa_id,
               cr.id as credor_id,
               coalesce(nullif(trim(cr.nome), ''), cr.codigo) as carteira,
               c.id as cluster_id,
               c.codigo,
               c.nome,
               c.ordem,
               c.estrategia_id as estrategia_segmento,
               x.estrategia_id as estrategia_carteira,
               case when exists (select 1 from public.segmentos_carteira y where y.cluster_id = c.id)
                    then 'escolhidas'
                    when c.credor_id is not null then 'uma'
                    else 'todas' end as vinculo,
               (c.ativo and case
                    when exists (select 1 from public.segmentos_carteira y where y.cluster_id = c.id)
                        then coalesce(x.ativo, false)
                    else c.credor_id is null or c.credor_id = cr.id end) as em_uso,
               (x.credor_id is not null
                or (not exists (select 1 from public.segmentos_carteira y where y.cluster_id = c.id)
                    and (c.credor_id is null or c.credor_id = cr.id))) as vinculado
        from public.clusters c
        join public.credores cr on cr.empresa_id = c.empresa_id
        left join public.segmentos_carteira x on x.cluster_id = c.id and x.credor_id = cr.id
    )
    select b.empresa_id, b.credor_id, b.cluster_id, b.codigo, b.nome, b.ordem,
           coalesce(b.estrategia_carteira, b.estrategia_segmento) as estrategia_id,
           b.vinculo, b.em_uso, b.vinculado,
           b.estrategia_segmento,
           b.estrategia_carteira is not null as estrategia_propria,
           (select string_agg(o.carteira, ', ' order by o.carteira) from base o
            where o.cluster_id = b.cluster_id and o.credor_id <> b.credor_id and o.vinculado
              and coalesce(o.estrategia_carteira, o.estrategia_segmento)
                  = coalesce(b.estrategia_carteira, b.estrategia_segmento)) as compartilhada_com
    from base b;
comment on view public.segmentos_em_uso is
    'Cada segmento × carteira: vínculo, em uso, a estratégia que vale nesta carteira e com quem ela é compartilhada.';
grant select on public.segmentos_em_uso to authenticated;
revoke all on public.segmentos_em_uso from anon;

-- ================================================================ 3. separar / copiar
create or replace function public.separar_estrategia(segmento bigint, carteira bigint, definicao jsonb default null)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
    c public.clusters%rowtype;
    e public.estrategias%rowtype;
    atual bigint;
    nova bigint;
    nome_cart text;
    base text;
    nome_novo text;
    n int := 1;
begin
    if not public.pode('editar_orquestracao') then
        raise exception 'sem permissão para editar a orquestração';
    end if;
    if definicao is not null and jsonb_typeof(definicao) <> 'object' then
        raise exception 'a definição da estratégia precisa ser um objeto';
    end if;
    select * into c from public.clusters where id = segmento;
    if c.id is null then
        raise exception 'segmento não encontrado';
    end if;
    select coalesce(nullif(trim(cr.nome), ''), cr.codigo) into nome_cart
        from public.credores cr where cr.id = carteira and cr.empresa_id = c.empresa_id;
    if nome_cart is null then
        raise exception 'a carteira não é da empresa do segmento';
    end if;
    if not exists (select 1 from public.segmentos_em_uso s
                   where s.cluster_id = segmento and s.credor_id = carteira and s.vinculado) then
        raise exception 'o segmento não está nesta carteira';
    end if;
    select s.estrategia_id into atual from public.segmentos_em_uso s
        where s.cluster_id = segmento and s.credor_id = carteira;
    select * into e from public.estrategias where id = atual;
    base := left(coalesce(e.nome, coalesce(nullif(trim(c.nome), ''), c.codigo)), 60) || ' · ' || left(nome_cart, 16);
    nome_novo := base;
    while exists (select 1 from public.estrategias where empresa_id = c.empresa_id and nome = nome_novo) loop
        n := n + 1;
        nome_novo := base || ' (' || n || ')';
    end loop;
    insert into public.estrategias (empresa_id, nome, descricao, definicao, padrao, frente)
        values (c.empresa_id, nome_novo, coalesce(e.descricao, ''),
                coalesce(definicao, e.definicao, '{}'::jsonb), false, coalesce(e.frente, 'motorcob'))
        returning id into nova;
    -- segmento sem vínculo escolhido valia por regra (todas ou uma carteira): grava os vínculos de hoje antes,
    -- senão a linha nova faria o segmento sair das outras carteiras
    if not exists (select 1 from public.segmentos_carteira where cluster_id = segmento) then
        insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo)
            select s.empresa_id, s.cluster_id, s.credor_id, true from public.segmentos_em_uso s
            where s.cluster_id = segmento and s.vinculado
        on conflict (cluster_id, credor_id) do nothing;
    end if;
    update public.segmentos_carteira set estrategia_id = nova
        where cluster_id = segmento and credor_id = carteira;
    return nova;
end $$;
comment on function public.separar_estrategia(bigint, bigint, jsonb) is
    'Estratégia só desta carteira no segmento: cópia da atual ou, com definicao, a cópia trazida de outra carteira.';
revoke all on function public.separar_estrategia(bigint, bigint, jsonb) from public, anon;
grant execute on function public.separar_estrategia(bigint, bigint, jsonb) to authenticated;

-- ================================================================ 4. rótulos legíveis
create or replace function public.rotulo_estado(estado text) returns text
language sql immutable set search_path = public as $$
    select case estado
        when 'LOC' then 'Cliente novo'
        when 'CPA' then 'CPC · em negociação'
        when 'CPB' then 'CPC · sem resposta'
        when 'NCP' then 'Não CPC'
        when 'PRE' then 'Acordo · antes do vencimento'
        when 'COL' then 'Acordo em dia'
        when 'QBR' then 'Acordo · parcela vencida'
        when 'LIQ' then 'Quitado'
        when 'BLQ' then 'Bloqueado'
        when 'ET' then 'Etapa própria'
        else estado end
$$;

create or replace function public.rotulo_ciclo(estado text, ciclo text) returns text
language sql immutable set search_path = public as $$
    select case
        when ciclo is null or ciclo = '' then ''
        when ciclo = 'RE' then 'Parado · aguarda enriquecimento'
        when ciclo ~ '^G[0-9]+\Z' then substr(ciclo, 2) || 'º ciclo'
        when ciclo ~ '^T[0-9]+\Z' then substr(ciclo, 2) || 'ª tentativa'
        when ciclo = 'L0' then 'Aguardando a 1ª lista'
        when ciclo ~ '^L[0-9]+\Z' then 'D+' || substr(ciclo, 2)
        when estado = 'QBR' and ciclo ~ '^D[0-9]+\Z' then 'D+' || substr(ciclo, 2)
        else ciclo end
$$;

create or replace function public.rotulo_passo(passo text) returns text
language sql immutable set search_path = public as $$
    select case
        when passo is null then ''
        when passo ~ '^[GC][0-9]+-(dia|D)[0-9]+\Z'
            then substring(passo from '^[GC]([0-9]+)') || 'º ciclo · dia ' || substring(passo from '([0-9]+)\Z')
        when passo = 'CPC A · negociação' then 'CPC · em negociação'
        when passo ~ '^CPC B · T[0-9]+\Z'
            then 'CPC · sem resposta · ' || substring(passo from '([0-9]+)\Z') || 'ª tentativa'
        when passo like 'rotação → %' then 'troca de canal → ' || substr(passo, 11)
        else passo end
$$;
grant execute on function public.rotulo_estado(text), public.rotulo_ciclo(text, text), public.rotulo_passo(text)
    to authenticated;
