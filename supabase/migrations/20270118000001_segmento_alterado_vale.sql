-- SQL 82 · "Descrever segmentos e régua": segmento alterado segue valendo até ligar a versão nova
--
-- Decisão do dono (08/11/2026): quando a proposta aplicada ALTERA um segmento que já existe e está valendo, a versão
-- atual continua valendo até o usuário clicar em "Conferi, ligar" na nova. Só segmentos NOVOS (e as estratégias deles)
-- nascem pausados. No SQL 79 o segmento alterado ficava pausado e, até ligar, os clientes dele iam para o próximo
-- segmento ligado ou para Demais — errado.
--
-- 1. aplicar_segmentacao (mesma assinatura, mesma transação, mesmo previa_hash e snapshot): segmento existente que
--    está valendo (em uso em alguma carteira) e foi alterado NÃO é mexido: a versão nova (nome, condições, só digital,
--    canais bloqueados) fica guardada em segmentacao_aplicacoes.criados -> 'espera' -> 'versoes'. Estratégia nova de
--    segmento que está valendo NESTA carteira é criada (criar_estrategia_segmento) mas o vínculo volta para a atual; a
--    nova também fica na versão em espera. Segmento existente que não está valendo (pausado em todas) é alterado já,
--    como antes, e segue pausado até ligar. Segmento novo: igual ao SQL 79 (pausado, com a estratégia nova).
--    Quando há algo para ligar, o que muda a classificação de hoje nesta carteira também espera o Ligar: a ordem nova,
--    os segmentos desligados nesta carteira (inclusive o compartilhado do padrão "desligar aqui + criar novo", que
--    segue valendo aqui até o novo ser ligado, e nas outras carteiras como antes) e o Demais. Sem nada para ligar
--    (só ordem, desligar ou Demais), vale na hora, como antes.
-- 2. ligar_segmentacao(aplicacao, segmentos): numa transação troca a versão atual pela nova (condições, nome, flags e
--    estratégia) e liga os pausados. A ordem nova vale a partir do 1º Ligar; desligar e Demais, quando não sobra nada
--    para ligar. Devolve quantos segmentos foram ligados (pausado ligado ou versão nova trocada).
-- 3. Aplicar de novo na mesma carteira com uma aplicação anterior ainda esperando: a anterior é SUBSTITUÍDA (a proposta
--    nova foi gerada a partir do que vale hoje); as versões em espera dela não valem mais (os segmentos novos pausados
--    dela continuam ligáveis, como antes).
-- 4. desfazer_segmentacao: volta do snapshot como antes (as versões em espera não chegaram a valer). Conflito = segmento
--    mexido depois da ÚLTIMA escrita desta aplicação (aplicar ou ligar), não só depois de aplicar. Os segmentos e as
--    estratégias criados por ela que ninguém mexeu nem ligou em outro lugar são APAGADOS (auditoria registra): o código
--    e o nome voltam a ficar livres e a próxima geração não cria D904 nem "(3)". O que alguém mexeu fica, desligado.
-- O motor não muda: ele só lê clusters e segmentos_carteira, e a versão em espera não está em nenhum dos dois.
-- Depende do SQL 79; independente dos SQL 80 (urgente, voz) e 81 (transferência). Pode rodar de novo. Se o SQL 79
-- rodar de novo, rode este depois.

-- ================================================================ 1. aplicar (uma transação)
create or replace function public.aplicar_segmentacao(pedido bigint, proposta jsonb, previa_hash text,
                                                      carteiras_extra bigint[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    p public.segmentacao_pedidos;
    emp bigint;
    cred bigint;
    nome_cart text;
    segs jsonb;
    ordem_refs jsonb;
    ref text;
    s jsonb;
    c jsonb;
    v jsonb;
    acao text;
    cl public.clusters;
    cid bigint;
    eid bigint;
    est_antes bigint;
    vivo boolean;
    aqui boolean;
    envolvidos bigint[] := '{}';
    novos bigint[] := '{}';
    pausados bigint[] := '{}';
    estrategias bigint[] := '{}';
    desligar bigint[] := '{}';
    versoes jsonb := '{}';
    ordens jsonb := '{}';
    espera jsonb;
    demais_novo boolean;
    vinculos_extra jsonb := '[]';
    extras bigint[] := coalesce(carteiras_extra, '{}');
    n_novos int := 0; n_alt int := 0; n_desl int := 0; n_mant int := 0;
    base_ordem int;
    i int := 0;
    extra bigint;
    antes jsonb;
    aid bigint;
    ch text;
begin
    select * into p from public.segmentacao_pedidos x where x.id = pedido for update;
    if p.id is null or not public.pode_descrever_segmentacao(p.empresa_id) then
        raise exception 'sem permissão para aplicar nesta carteira';
    end if;
    if p.situacao <> 'gerado' then
        raise exception 'esta proposta não está pronta para aplicar (situação: %)', p.situacao;
    end if;
    emp := p.empresa_id;
    cred := p.credor_id;
    select coalesce(nullif(trim(cr.nome), ''), cr.codigo) into nome_cart from public.credores cr where cr.id = cred;
    -- uma aplicação por carteira de cada vez
    perform pg_advisory_xact_lock(hashtextextended('segmentacao:' || cred, 79));
    if previa_hash is null or previa_hash <> public.hash_segmentacao(emp, cred) then
        raise exception 'a carteira mudou desde a geração (segmentos, ordem ou estratégias); gere a prévia de novo';
    end if;
    if proposta is null or jsonb_typeof(proposta) <> 'object' or jsonb_typeof(proposta -> 'segmentos') <> 'object'
       or jsonb_typeof(proposta -> 'ordem') <> 'array' then
        raise exception 'proposta inválida';
    end if;
    segs := proposta -> 'segmentos';
    ordem_refs := proposta -> 'ordem';
    if (select count(*) from jsonb_each(segs) e where e.value ->> 'acao' in ('novo', 'alterar')
                                                    and coalesce((e.value ->> 'incluir')::boolean, true)) > 8 then
        raise exception 'no máximo 8 segmentos novos ou alterados por texto';
    end if;
    if exists (select 1 from jsonb_array_elements_text(ordem_refs) r where not segs ? r) then
        raise exception 'proposta inválida: a ordem cita um segmento que não está na proposta';
    end if;
    if exists (select 1 from unnest(extras) x
                where x = cred or not exists (select 1 from public.credores c2 where c2.id = x and c2.empresa_id = emp)) then
        raise exception 'carteira extra inválida';
    end if;

    -- validação de cada segmento (antes de qualquer escrita)
    for ref, s in select e.key, e.value from jsonb_each(segs) e loop
        acao := s ->> 'acao';
        if acao not in ('novo', 'alterar', 'manter', 'desligar') then
            raise exception 'segmento %: ação inválida', ref;
        end if;
        if not coalesce((s ->> 'incluir')::boolean, true) then
            continue;
        end if;
        if acao = 'novo' and coalesce(s ->> 'codigo', '') !~ '^[A-Z0-9]{1,4}$' then
            raise exception 'segmento %: código inválido', ref;
        end if;
        if acao <> 'novo' then
            select * into cl from public.clusters x where x.empresa_id = emp and x.codigo = s ->> 'existente';
            if cl.id is null or not exists (select 1 from public.segmentos_em_uso u
                                             where u.cluster_id = cl.id and u.credor_id = cred and u.vinculado) then
                raise exception 'segmento %: % não está nesta carteira', ref, coalesce(s ->> 'existente', '?');
            end if;
        end if;
        if acao in ('novo', 'alterar') then
            if jsonb_typeof(s -> 'condicoes') <> 'array' then
                raise exception 'segmento %: condições inválidas', ref;
            end if;
            for c in select x from jsonb_array_elements(s -> 'condicoes') x loop
                perform public.previa_condicao_sql(c);          -- mesma validação de cluster.ler_condicoes
            end loop;
        end if;
        if s ->> 'estrategia' = 'nova' and jsonb_typeof(s -> 'definicao') <> 'object' then
            raise exception 'segmento %: estratégia sem definição', ref;
        end if;
        for ch in select jsonb_array_elements_text(case when jsonb_typeof(s -> 'canais_a_ativar') = 'array'
                                                          then s -> 'canais_a_ativar' else '[]' end) loop
            if not coalesce((select ce.ativo from public.canais_empresa ce where ce.empresa_id = emp and ce.canal = ch), true)
               or (ch = 'agente_voz' and not exists (select 1 from public.voz_config vc where vc.empresa_id = emp)) then
                raise exception 'ative o canal % antes de aplicar (você escolheu "Vou ativar o canal")', ch;
            end if;
        end loop;
    end loop;

    -- snapshot: segmentos desta carteira (e os citados), seus vínculos em todas as carteiras e o Demais
    select coalesce(array_agg(distinct u.cluster_id), '{}') into envolvidos
      from public.segmentos_em_uso u where u.credor_id = cred and u.vinculado;
    antes := jsonb_build_object(
        'clusters', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'codigo', x.codigo, 'nome', x.nome,
                                   'condicoes', x.condicoes, 'ordem', x.ordem, 'so_digital', x.so_digital,
                                   'canais_bloqueados', to_jsonb(x.canais_bloqueados), 'credor_id', x.credor_id,
                                   'atualizado_em', x.atualizado_em) order by x.id)
                                from public.clusters x where x.id = any (envolvidos)), '[]'),
        'vinculos', coalesce((select jsonb_agg(jsonb_build_object('cluster_id', v.cluster_id, 'credor_id', v.credor_id,
                                   'ativo', v.ativo, 'estrategia_id', v.estrategia_id) order by v.cluster_id, v.credor_id)
                                from public.segmentos_carteira v where v.cluster_id = any (envolvidos)), '[]'),
        'demais_ativo', (select cr.demais_ativo from public.credores cr where cr.id = cred));

    -- a ordem final começa na posição do 1º segmento atual desta carteira (a dos outros segmentos não muda)
    select coalesce(min(x.ordem), (select coalesce(max(y.ordem), 0) + 10 from public.clusters y where y.empresa_id = emp))
      into base_ordem from public.clusters x where x.id = any (envolvidos);

    -- desligar (só nesta carteira): os vínculos de hoje gravados já; o desligamento, já ou no Ligar (abaixo)
    for ref, s in select e.key, e.value from jsonb_each(segs) e where e.value ->> 'acao' = 'desligar'
                                                                 and coalesce((e.value ->> 'incluir')::boolean, true) loop
        select x.id into cid from public.clusters x where x.empresa_id = emp and x.codigo = s ->> 'existente';
        perform public.segmentacao_vincular(cid);
        desligar := desligar || cid;
        n_desl := n_desl + 1;
    end loop;

    -- na ordem: cria, altera, mantém; estratégia nova
    for ref in select r from jsonb_array_elements_text(ordem_refs) with ordinality as o(r, k) order by k loop
        s := segs -> ref;
        acao := s ->> 'acao';
        if acao = 'desligar' or not coalesce((s ->> 'incluir')::boolean, true) then
            continue;
        end if;
        if acao = 'novo' then
            -- segmento novo: nasce pausado nesta carteira (decisão do dono)
            insert into public.clusters (empresa_id, ordem, codigo, nome, condicoes, so_digital, canais_bloqueados, ativo)
            values (emp, base_ordem + i * 10, s ->> 'codigo', left(coalesce(nullif(trim(s ->> 'nome'), ''), s ->> 'codigo'), 60),
                    s -> 'condicoes', coalesce((s ->> 'so_digital')::boolean, false),
                    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(s -> 'canais_bloqueados') = 'array'
                                                                         then s -> 'canais_bloqueados' else '[]' end)), '{}'), true)
            returning id into cid;
            insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo) values (emp, cid, cred, false);
            novos := novos || cid;
            pausados := pausados || cid;
            n_novos := n_novos + 1;
        else
            select * into cl from public.clusters x where x.empresa_id = emp and x.codigo = s ->> 'existente';
            cid := cl.id;
            perform public.segmentacao_vincular(cid);
            ordens := ordens || jsonb_build_object(cid::text, base_ordem + i * 10);
            -- valendo = em uso em alguma carteira (condição e nome são da empresa); aqui = em uso nesta carteira
            vivo := exists (select 1 from public.segmentos_em_uso u where u.cluster_id = cid and u.em_uso);
            aqui := exists (select 1 from public.segmentos_em_uso u where u.cluster_id = cid and u.credor_id = cred and u.em_uso);
            if acao = 'alterar' then
                v := jsonb_build_object(
                    'nome', left(coalesce(nullif(trim(s ->> 'nome'), ''), cl.nome), 60),
                    'condicoes', s -> 'condicoes',
                    'so_digital', coalesce((s ->> 'so_digital')::boolean, cl.so_digital),
                    'canais_bloqueados', case when jsonb_typeof(s -> 'canais_bloqueados') = 'array' then s -> 'canais_bloqueados'
                                              else to_jsonb(cl.canais_bloqueados) end);
                if vivo then
                    versoes := versoes || jsonb_build_object(cid::text, v);       -- a atual segue valendo até ligar
                else
                    update public.clusters x
                       set nome = v ->> 'nome', condicoes = v -> 'condicoes', so_digital = (v ->> 'so_digital')::boolean,
                           canais_bloqueados = array(select jsonb_array_elements_text(v -> 'canais_bloqueados'))
                     where x.id = cid;
                end if;
                n_alt := n_alt + 1;
            else
                n_mant := n_mant + 1;
            end if;
            -- pausado nesta carteira (sem valer aqui) e alterado ou com estratégia nova: segue pausado até ligar
            if (acao = 'alterar' or s ->> 'estrategia' = 'nova') and not aqui then
                update public.segmentos_carteira x set ativo = false where x.cluster_id = cid and x.credor_id = cred;
                pausados := pausados || cid;
            end if;
        end if;
        if s ->> 'estrategia' = 'nova' then
            select x.estrategia_id into est_antes from public.segmentos_carteira x where x.cluster_id = cid and x.credor_id = cred;
            eid := public.criar_estrategia_segmento(cid, cred, s -> 'definicao',
                                                    left(coalesce(nullif(trim(s ->> 'nome'), ''), s ->> 'codigo') || ' · ' || nome_cart, 100));
            update public.estrategias x
               set descricao = 'Gerada por "Descrever segmentos e régua" (pedido ' || p.id || '); confira e ligue o segmento.'
             where x.id = eid;
            estrategias := estrategias || eid;
            if acao <> 'novo' and aqui then
                -- valendo nesta carteira: a estratégia atual segue até ligar; a nova vai na versão em espera
                update public.segmentos_carteira x set estrategia_id = est_antes where x.cluster_id = cid and x.credor_id = cred;
                versoes := jsonb_set(versoes, array[cid::text],
                                     coalesce(versoes -> cid::text, '{}'::jsonb) || jsonb_build_object('estrategia_id', eid));
            end if;
        end if;
        -- carteiras extra: o segmento novo lá também, pausado, com CÓPIA da estratégia (mudar uma não muda a outra)
        if acao = 'novo' then
            foreach extra in array extras loop
                insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo) values (emp, cid, extra, false)
                on conflict (cluster_id, credor_id) do nothing;
                vinculos_extra := vinculos_extra || jsonb_build_array(jsonb_build_object('cluster_id', cid, 'credor_id', extra));
                if s ->> 'estrategia' = 'nova' then
                    eid := public.criar_estrategia_segmento(cid, extra, s -> 'definicao',
                        left(coalesce(nullif(trim(s ->> 'nome'), ''), s ->> 'codigo') || ' · '
                             || (select coalesce(nullif(trim(cr.nome), ''), cr.codigo) from public.credores cr where cr.id = extra), 100));
                    update public.estrategias x
                       set descricao = 'Gerada por "Descrever segmentos e régua" (pedido ' || p.id || ', cópia para esta carteira); confira e ligue o segmento.'
                     where x.id = eid;
                    estrategias := estrategias || eid;
                end if;
            end loop;
        end if;
        i := i + 1;
    end loop;

    -- ordem, desligar e Demais: com algo para ligar, esperam o Ligar (o que vale hoje não muda); sem, valem já
    demais_novo := coalesce(proposta ->> 'demais', 'manter') <> 'desligar';
    if cardinality(pausados) > 0 or versoes <> '{}'::jsonb then
        espera := jsonb_build_object(
            'versoes', versoes, 'ordem', ordens, 'desligar', to_jsonb(desligar),
            'demais', case when demais_novo is distinct from (select cr.demais_ativo from public.credores cr where cr.id = cred)
                           then to_jsonb(demais_novo) end,
            'ordem_em', null, 'concluida_em', null, 'substituida_por', null);
    else
        update public.clusters x set ordem = o.value::int
          from jsonb_each_text(ordens) o where x.id = o.key::bigint and x.ordem <> o.value::int;
        update public.segmentos_carteira x set ativo = false where x.cluster_id = any (desligar) and x.credor_id = cred;
        update public.credores x set demais_ativo = demais_novo where x.id = cred and x.demais_ativo is distinct from demais_novo;
    end if;

    insert into public.segmentacao_aplicacoes (empresa_id, credor_id, pedido_id, texto, proposta, resumo, antes, criados)
    values (emp, cred, p.id, p.texto, proposta,
            jsonb_build_object('novos', n_novos, 'alterados', n_alt, 'desligados', n_desl, 'mantidos', n_mant,
                               'estrategias', cardinality(estrategias), 'pausados', cardinality(pausados),
                               'versoes', (select count(*) from jsonb_object_keys(versoes)),
                               'carteiras_extra', to_jsonb(extras)),
            antes,
            jsonb_build_object('clusters', to_jsonb(novos), 'estrategias', to_jsonb(estrategias),
                               'pausados', to_jsonb(pausados), 'vinculos_extra', vinculos_extra)
            || case when espera is not null then jsonb_build_object('espera', espera) else '{}'::jsonb end)
    returning id into aid;
    -- aplicação anterior desta carteira ainda esperando o Ligar: substituída (a proposta nova viu o que vale hoje)
    update public.segmentacao_aplicacoes x
       set criados = jsonb_set(x.criados, '{espera,substituida_por}', to_jsonb(aid))
     where x.credor_id = cred and x.id <> aid and x.situacao = 'aplicada'
       and x.criados ? 'espera' and x.criados #>> '{espera,concluida_em}' is null
       and x.criados #>> '{espera,substituida_por}' is null;
    update public.segmentacao_pedidos x set situacao = 'aplicado', atualizado_em = now() where x.id = p.id;
    return jsonb_build_object('aplicacao', aid, 'novos', n_novos, 'alterados', n_alt, 'desligados', n_desl,
                              'mantidos', n_mant, 'estrategias', cardinality(estrategias), 'pausados', to_jsonb(pausados),
                              'versoes', coalesce((select jsonb_agg(k::bigint order by k::bigint) from jsonb_object_keys(versoes) k), '[]'));
end $$;

-- ================================================================ 2. ligar: pausados e versões em espera, numa transação
create or replace function public.ligar_segmentacao(aplicacao bigint, segmentos bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
    a public.segmentacao_aplicacoes;
    esp jsonb;
    vale boolean;                    -- a espera ainda vale (não foi substituída nem concluída)
    pausados bigint[];
    alvo bigint[];
    feitos bigint[] := '{}';
    marcas jsonb;
    k text;
    v jsonb;
    agora text := to_jsonb(now()) #>> '{}';
begin
    select * into a from public.segmentacao_aplicacoes x where x.id = aplicacao for update;
    if a.id is null or not public.pode_descrever_segmentacao(a.empresa_id) then
        raise exception 'aplicação não encontrada';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('segmentacao:' || a.credor_id, 79));
    if a.situacao <> 'aplicada' then
        raise exception 'esta aplicação foi desfeita';
    end if;
    esp := a.criados -> 'espera';
    vale := esp is not null and esp ->> 'substituida_por' is null and esp ->> 'concluida_em' is null;
    marcas := coalesce(a.criados -> 'marcas', '{}');
    pausados := array(select jsonb_array_elements_text(coalesce(a.criados -> 'pausados', '[]'))::bigint);
    alvo := array(select x from unnest(pausados) x where segmentos is null or x = any (segmentos));
    if vale then
        alvo := alvo || array(select j.key::bigint from jsonb_each(esp -> 'versoes') j
                               where j.value ->> 'ligada_em' is null and (segmentos is null or j.key::bigint = any (segmentos)));
    end if;
    -- a ordem nova vale a partir do 1º Ligar (com ela, nenhum empate com a ordem antiga)
    if vale and esp ->> 'ordem_em' is null and cardinality(alvo) > 0 then
        with mudou as (
            update public.clusters x set ordem = o.value::int
              from jsonb_each_text(esp -> 'ordem') o where x.id = o.key::bigint and x.ordem <> o.value::int
            returning x.id)
        select marcas || coalesce(jsonb_object_agg(m.id::text, agora), '{}') into marcas from mudou m;
        esp := jsonb_set(esp, '{ordem_em}', to_jsonb(agora));
    end if;
    -- versão nova no lugar da atual: condições, nome, flags e estratégia desta carteira
    if vale then
        for k, v in select j.key, j.value from jsonb_each(esp -> 'versoes') j
                     where j.value ->> 'ligada_em' is null and j.key::bigint = any (alvo) loop
            if v ? 'condicoes' then
                update public.clusters x
                   set nome = v ->> 'nome', condicoes = v -> 'condicoes', so_digital = (v ->> 'so_digital')::boolean,
                       canais_bloqueados = array(select jsonb_array_elements_text(v -> 'canais_bloqueados'))
                 where x.id = k::bigint;
                marcas := marcas || jsonb_build_object(k, agora);
            end if;
            if v ? 'estrategia_id' then
                update public.segmentos_carteira x set estrategia_id = (v ->> 'estrategia_id')::bigint
                 where x.cluster_id = k::bigint and x.credor_id = a.credor_id;
            end if;
            esp := jsonb_set(esp, array['versoes', k, 'ligada_em'], to_jsonb(agora));
            feitos := feitos || k::bigint;
        end loop;
    end if;
    -- pausados: ligados nesta carteira
    with ligou as (
        update public.segmentos_carteira x set ativo = true
         where x.credor_id = a.credor_id and not x.ativo and x.cluster_id = any (alvo) and x.cluster_id = any (pausados)
        returning x.cluster_id)
    select feitos || coalesce(array_agg(l.cluster_id), '{}') into feitos from ligou l;
    -- nada mais para ligar: o que sai desta carteira (desligar, Demais) sai agora
    if not exists (select 1 from public.segmentos_carteira x
                    where x.credor_id = a.credor_id and not x.ativo and x.cluster_id = any (pausados))
       and not (vale and exists (select 1 from jsonb_each(esp -> 'versoes') j where j.value ->> 'ligada_em' is null)) then
        if vale then
            update public.segmentos_carteira x set ativo = false
             where x.credor_id = a.credor_id and x.ativo
               and x.cluster_id in (select jsonb_array_elements_text(esp -> 'desligar')::bigint);
            if jsonb_typeof(esp -> 'demais') = 'boolean' then
                update public.credores x set demais_ativo = (esp ->> 'demais')::boolean
                 where x.id = a.credor_id and x.demais_ativo is distinct from (esp ->> 'demais')::boolean;
            end if;
            esp := jsonb_set(esp, '{concluida_em}', to_jsonb(agora));
        end if;
        update public.segmentacao_aplicacoes x set ligada_em = coalesce(x.ligada_em, now()) where x.id = aplicacao;
    end if;
    update public.segmentacao_aplicacoes x
       set criados = x.criados || jsonb_build_object('marcas', marcas)
                   || case when esp is not null then jsonb_build_object('espera', esp) else '{}'::jsonb end
     where x.id = aplicacao;
    return (select count(distinct f) from unnest(feitos) f)::int;
end $$;

-- ================================================================ 3. desfazer (até a próxima rotina)
create or replace function public.desfazer_segmentacao(aplicacao bigint, forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    a public.segmentacao_aplicacoes;
    conflitos text[];
    k jsonb;
    v jsonb;
    criados bigint[];
    n_seg int := 0;
    n_est int := 0;
begin
    select * into a from public.segmentacao_aplicacoes x where x.id = aplicacao for update;
    if a.id is null or not public.pode_descrever_segmentacao(a.empresa_id) then
        raise exception 'aplicação não encontrada';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('segmentacao:' || a.credor_id, 79));
    if a.situacao <> 'aplicada' then
        raise exception 'esta aplicação já foi desfeita';
    end if;
    if exists (select 1 from public.execucoes e where e.empresa_id = a.empresa_id and e.iniciada_em > a.aplicada_em) then
        raise exception 'a rotina já rodou depois da aplicação: desfazer vale só até a próxima rotina';
    end if;
    if exists (select 1 from public.segmentacao_aplicacoes x where x.credor_id = a.credor_id and x.situacao = 'aplicada'
                                                               and x.aplicada_em > a.aplicada_em) then
        raise exception 'há uma aplicação mais nova nesta carteira: desfaça a mais nova primeiro';
    end if;
    -- mexido por outra pessoa depois da última escrita desta aplicação (aplicar ou ligar): lista e só desfaz com forcar
    select array_agg(c.codigo order by c.codigo) into conflitos
      from public.clusters c
     where c.id in (select (j ->> 'id')::bigint from jsonb_array_elements(a.antes -> 'clusters') j)
       and c.atualizado_em > coalesce((a.criados #>> array['marcas', c.id::text])::timestamptz, a.aplicada_em);
    if conflitos is not null and not forcar then
        return jsonb_build_object('ok', false, 'conflitos', to_jsonb(conflitos));
    end if;
    -- condições, nomes, ordem e flags de antes (só o que mudou: regravar igual marcaria conflito na aplicação anterior)
    for k in select x from jsonb_array_elements(a.antes -> 'clusters') x loop
        update public.clusters c
           set nome = k ->> 'nome', condicoes = k -> 'condicoes', ordem = (k ->> 'ordem')::int,
               so_digital = (k ->> 'so_digital')::boolean,
               canais_bloqueados = array(select jsonb_array_elements_text(k -> 'canais_bloqueados'))
         where c.id = (k ->> 'id')::bigint
           and (c.nome, c.condicoes, c.ordem, c.so_digital, c.canais_bloqueados)
               is distinct from (k ->> 'nome', k -> 'condicoes', (k ->> 'ordem')::int, (k ->> 'so_digital')::boolean,
                                 array(select jsonb_array_elements_text(k -> 'canais_bloqueados')));
    end loop;
    -- vínculos de antes: os que não existiam saem (foram gravados por esta aplicação), os outros voltam
    delete from public.segmentos_carteira x
     where x.cluster_id in (select (j ->> 'id')::bigint from jsonb_array_elements(a.antes -> 'clusters') j)
       and not exists (select 1 from jsonb_array_elements(a.antes -> 'vinculos') w
                        where (w ->> 'cluster_id')::bigint = x.cluster_id and (w ->> 'credor_id')::bigint = x.credor_id);
    for v in select x from jsonb_array_elements(a.antes -> 'vinculos') x loop
        update public.segmentos_carteira x
           set ativo = (v ->> 'ativo')::boolean, estrategia_id = (v ->> 'estrategia_id')::bigint
         where x.cluster_id = (v ->> 'cluster_id')::bigint and x.credor_id = (v ->> 'credor_id')::bigint;
    end loop;
    -- segmentos criados: desligados nesta carteira e nas extras
    criados := array(select jsonb_array_elements_text(coalesce(a.criados -> 'clusters', '[]'))::bigint);
    update public.segmentos_carteira x set ativo = false where x.cluster_id = any (criados);
    -- e apagados se ninguém mexeu neles nem os ligou em outra carteira: código e nome voltam a ficar livres
    with apagou as (
        delete from public.clusters c
         where c.id = any (criados) and c.empresa_id = a.empresa_id
           and c.atualizado_em <= coalesce((a.criados #>> array['marcas', c.id::text])::timestamptz, a.aplicada_em)
           and not exists (select 1 from public.segmentos_carteira x where x.cluster_id = c.id and x.ativo)
        returning c.id)
    select count(*) into n_seg from apagou;
    -- estratégias criadas por esta aplicação que não valem em lugar nenhum e ninguém editou
    with apagou as (
        delete from public.estrategias e
         where e.empresa_id = a.empresa_id and not e.padrao
           and e.id in (select jsonb_array_elements_text(coalesce(a.criados -> 'estrategias', '[]'))::bigint)
           and e.atualizado_em <= a.aplicada_em
           and not exists (select 1 from public.segmentos_carteira x where x.estrategia_id = e.id)
           and not exists (select 1 from public.clusters x where x.estrategia_id = e.id)
           and not exists (select 1 from public.credores x where x.estrategia_id = e.id)
        returning e.id)
    select count(*) into n_est from apagou;
    update public.credores x set demais_ativo = (a.antes ->> 'demais_ativo')::boolean
     where x.id = a.credor_id and a.antes ? 'demais_ativo';
    update public.segmentacao_aplicacoes x set situacao = 'desfeita', desfeita_em = now(), desfeita_por = auth.uid()
     where x.id = aplicacao;
    return jsonb_build_object('ok', true, 'conflitos', coalesce(to_jsonb(conflitos), '[]'),
                              'segmentos_apagados', n_seg, 'estrategias_apagadas', n_est);
end $$;

-- ================================================================ 4. permissões (as mesmas do SQL 79)
revoke all on function public.aplicar_segmentacao(bigint, jsonb, text, bigint[]), public.ligar_segmentacao(bigint, bigint[]),
    public.desfazer_segmentacao(bigint, boolean)
    from public, anon;
grant execute on function public.aplicar_segmentacao(bigint, jsonb, text, bigint[]), public.ligar_segmentacao(bigint, bigint[]),
    public.desfazer_segmentacao(bigint, boolean)
    to authenticated, service_role;
comment on function public.aplicar_segmentacao(bigint, jsonb, text, bigint[]) is
    'Aplica a proposta de "Descrever segmentos e régua" numa transação. Novos nascem pausados; alterado que vale segue na versão atual até ligar (SQL 82).';
comment on function public.ligar_segmentacao(bigint, bigint[]) is
    'Conferi, ligar: liga os pausados e troca a versão atual pela nova dos alterados, numa transação (SQL 82).';
