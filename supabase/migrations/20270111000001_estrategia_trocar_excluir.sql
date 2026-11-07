-- SQL 75 · Orquestração: trocar e excluir a estratégia do segmento; nome legível da estratégia criada
--
-- Relato do dono (07/11/2026): depois de "Começar de um modelo" o segmento ficou com "teste · Carteira princip (2)" e
-- não havia como desfazer: nem excluir a estratégia nem voltar às três opções (Criar do zero / Copiar / Começar de um
-- modelo). Este SQL:
-- 1. separar_estrategia: o nome da cópia não corta mais o nome da carteira em 16 letras ("Carteira princip") e não
--    repete a carteira quando o nome de origem já termina nela. Mesma assinatura (o site e os testes não mudam).
-- 2. criar_estrategia_segmento(segmento, carteira, definicao, nome): o mesmo que separar_estrategia com a definição
--    trazida da tela, mas com o nome escolhido pelo site ("<Modelo> · <Segmento>"); único na empresa com " (2)",
--    " (3)"… só quando já existe. Uma transação: ou cria com o nome, ou não cria.
-- 3. usos_estrategia(estrategia, segmento, carteira): onde a estratégia vale hoje (segmento × carteira, "Demais
--    clientes" de uma carteira, padrão da empresa), sem contar o par segmento × carteira informado. O site usa para
--    dizer se dá para excluir e, se não der, onde ela está em uso.
-- 4. excluir_estrategia(estrategia, segmento, carteira): tira a estratégia deste segmento × carteira e a apaga, numa
--    transação, só se ela não valer em mais nenhum lugar (senão recusa e diz onde). As réguas e os estágios moram na
--    própria definição (jsonb); os vínculos (clusters, credores, segmentos_carteira) já são "on delete set null".
--    Auditoria: os gatilhos z_auditar de estrategias e segmentos_carteira registram a troca e a exclusão; a exclusão
--    também carimba a orquestração (gatilho z_orquestracao_excluida) para a rotina refazer a lista.
-- "Trocar estratégia" no site é só segmentos_carteira.estrategia_id = null (RLS de editar_orquestracao): o segmento
-- volta às três opções e a estratégia continua na empresa (aparece em "Começar de um modelo › Da sua empresa").
-- Tudo security invoker: vale a RLS de quem chama (pode('editar_orquestracao') para escrever). Pode rodar de novo.

-- ================================================================ 1. nome da cópia sem cortar a carteira
create or replace function public.separar_estrategia(segmento bigint, carteira bigint, definicao jsonb default null)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
    c public.clusters%rowtype;
    e public.estrategias%rowtype;
    atual bigint;
    nova bigint;
    nome_cart text;
    origem text;
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
    origem := coalesce(nullif(trim(e.nome), ''), nullif(trim(c.nome), ''), c.codigo);
    -- "<origem> · <carteira>" inteiro (sem cortar a carteira); se a origem já termina na carteira, não repete
    base := case when origem like '% · ' || nome_cart then origem else origem || ' · ' || nome_cart end;
    base := left(base, 100);
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

-- ================================================================ 2. criar com o nome escolhido
create or replace function public.criar_estrategia_segmento(segmento bigint, carteira bigint, definicao jsonb,
                                                            nome text default null)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
    nova bigint;
    emp bigint;
    base text := left(nullif(regexp_replace(trim(coalesce(criar_estrategia_segmento.nome, '')), '\s+', ' ', 'g'), ''), 100);
    nome_novo text;
    n int := 1;
begin
    if definicao is null then
        raise exception 'informe a definição da estratégia';
    end if;
    nova := public.separar_estrategia(segmento, carteira, definicao);
    if base is null then
        return nova;
    end if;
    select x.empresa_id into emp from public.estrategias x where x.id = nova;
    nome_novo := base;
    while exists (select 1 from public.estrategias x where x.empresa_id = emp and x.nome = nome_novo and x.id <> nova) loop
        n := n + 1;
        nome_novo := base || ' (' || n || ')';
    end loop;
    update public.estrategias x set nome = nome_novo where x.id = nova;
    return nova;
end $$;
comment on function public.criar_estrategia_segmento(bigint, bigint, jsonb, text) is
    'Primeira estratégia do segmento nesta carteira (Criar do zero, Copiar, Começar de um modelo), com o nome da tela.';
revoke all on function public.criar_estrategia_segmento(bigint, bigint, jsonb, text) from public, anon;
grant execute on function public.criar_estrategia_segmento(bigint, bigint, jsonb, text) to authenticated;

-- ================================================================ 3. onde a estratégia vale
create or replace function public.usos_estrategia(estrategia bigint, segmento bigint default null,
                                                  carteira bigint default null)
returns table (tipo text, onde text)
language sql stable security invoker set search_path = public as $$
    select 'segmento'::text,
           'Segmento ' || coalesce(nullif(trim(s.nome), ''), s.codigo) || ' · carteira '
               || coalesce(nullif(trim(cr.nome), ''), cr.codigo)
      from public.segmentos_em_uso s
      join public.credores cr on cr.id = s.credor_id
     where s.estrategia_id = usos_estrategia.estrategia and s.vinculado
       and not (s.cluster_id is not distinct from usos_estrategia.segmento
                and s.credor_id is not distinct from usos_estrategia.carteira)
    union all
    select 'demais', 'Demais clientes · carteira ' || coalesce(nullif(trim(cr.nome), ''), cr.codigo)
      from public.credores cr where cr.estrategia_id = usos_estrategia.estrategia
    union all
    select 'padrao', 'Padrão da empresa' from public.estrategias e
     where e.id = usos_estrategia.estrategia and e.padrao
    order by 1, 2
$$;
comment on function public.usos_estrategia(bigint, bigint, bigint) is
    'Onde a estratégia vale hoje (fora o segmento × carteira informado): segmentos, Demais clientes, padrão da empresa.';
revoke all on function public.usos_estrategia(bigint, bigint, bigint) from public, anon;
grant execute on function public.usos_estrategia(bigint, bigint, bigint) to authenticated;

-- ================================================================ 4. excluir (só se não vale em outro lugar)
create or replace function public.excluir_estrategia(estrategia bigint, segmento bigint default null,
                                                     carteira bigint default null)
returns void
language plpgsql security invoker set search_path = public as $$
declare
    e public.estrategias%rowtype;
    outros text;
begin
    if not public.pode('editar_orquestracao') then
        raise exception 'sem permissão para editar a orquestração';
    end if;
    select * into e from public.estrategias where id = estrategia;
    if e.id is null then
        raise exception 'estratégia não encontrada';
    end if;
    select string_agg(u.onde, '; ') into outros from public.usos_estrategia(estrategia, segmento, carteira) u;
    if outros is not null then
        raise exception 'a estratégia ainda vale em: %. Use "Trocar estratégia" neste segmento.', outros;
    end if;
    if segmento is not null and carteira is not null then
        update public.segmentos_carteira set estrategia_id = null
         where cluster_id = segmento and credor_id = carteira and estrategia_id = estrategia;
    end if;
    delete from public.estrategias where id = estrategia;
    if not found then
        raise exception 'sem permissão para excluir esta estratégia';
    end if;
end $$;
comment on function public.excluir_estrategia(bigint, bigint, bigint) is
    'Tira a estratégia deste segmento × carteira e apaga, só se ela não vale em mais nenhum lugar.';
revoke all on function public.excluir_estrategia(bigint, bigint, bigint) from public, anon;
grant execute on function public.excluir_estrategia(bigint, bigint, bigint) to authenticated;
