-- SQL 121 · Roleplay: Evolução do treino por operador e por equipe (PR 8 do Roleplay, SPEC §2.2, §3.3, §5.2 e §10).
-- Uma leitura só, já agregada, para a tela Evolução (/speech-analytics/roleplay/evolucao) e para a página da pessoa:
-- a nota do treino por item e por semana (com a revisão da Qualidade valendo sobre a da IA), a nota das ligações reais
-- no mesmo item e na mesma semana (voz_qualidade_dia, só do discador, pelo ID do discador de quem está no escopo), o
-- mapa por item por equipe e a concordância IA × Qualidade (treino_revisoes).
--
-- evolucao_treino(empresa, equipe, operador, dias): quem treina (treinar_operadores) na empresa, com o módulo ligado.
--   - escopo: a empresa toda (só agregados, com o mapa por equipe), uma equipe, ou uma pessoa (aí também a lista das
--     sessões avaliadas, para a linha do tempo por item). Sem ranking: a leitura de equipe e de empresa nunca traz
--     nota por pessoa nem a lista de quem está acima ou abaixo;
--   - período: 14 a 180 dias (padrão 90), em semanas (segunda-feira, Brasília);
--   - ligações reais só de quem tem o ID do discador; quem é só de treino entra só no treino.
-- A nota de treino continua só em treino_sessoes (nunca voz_avaliacoes/voz_qualidade_dia); aqui só se lê.
-- Pode rodar de novo (função recriada inteira). Depende dos SQL 60, 62, 89 e 90.

create or replace function public.evolucao_treino(empresa bigint, equipe bigint default null, operador bigint default null,
                                                  dias int default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
    d date := public.hoje_treino();
    ini date := public.hoje_treino() - greatest(14, least(coalesce(dias, 90), 180));
    ops bigint[];
    refs text[];
begin
    perform public.conferir_treino(empresa, 'treinar_operadores');
    if operador is not null and not exists (select 1 from public.voz_operadores o where o.id = operador and o.empresa_id = empresa) then
        raise exception 'pessoa não encontrada';
    end if;
    if equipe is not null and not exists (select 1 from public.treino_equipes q where q.id = equipe and q.empresa_id = empresa) then
        raise exception 'equipe não encontrada';
    end if;
    select coalesce(array_agg(o.id), '{}'), coalesce(array_agg(o.operador_ref) filter (where o.operador_ref is not null), '{}')
      into ops, refs
      from public.voz_operadores o
     where o.empresa_id = empresa and (operador is null or o.id = operador) and (equipe is null or o.equipe_id = equipe)
       and (operador is not null or o.ativo);
    return jsonb_build_object(
        'de', ini, 'ate', d, 'escopo', case when operador is not null then 'pessoa' when equipe is not null then 'equipe' else 'empresa' end,
        'pessoas', cardinality(ops), 'com_ligacoes', cardinality(refs),
        -- treino por semana e item (a revisão da Qualidade vale sobre a da IA)
        'treino_itens', coalesce((
            select jsonb_agg(jsonb_build_object('semana', x.semana, 'item', x.item, 'sim', x.sim, 'avaliados', x.avaliados)
                             order by x.semana, x.item)
              from (select date_trunc('week', s.inicio at time zone 'America/Sao_Paulo')::date semana, e.key item,
                           count(*) filter (where coalesce(r.qualidade, e.value #>> '{}') = 'sim')::int sim,
                           count(*) filter (where coalesce(r.qualidade, e.value #>> '{}') in ('sim', 'nao'))::int avaliados
                      from public.treino_sessoes s
                      cross join lateral jsonb_each(s.itens) e
                      left join public.treino_revisoes r on r.sessao_id = s.id and r.item_id = e.key
                     where s.empresa_id = empresa and s.situacao = 'avaliada' and s.origem <> 'teste'
                       and s.operador_id = any (ops) and s.inicio >= (ini::timestamp at time zone 'America/Sao_Paulo')
                     group by 1, 2) x), '[]'::jsonb),
        -- nota do treino por semana
        'treino_notas', coalesce((
            select jsonb_agg(jsonb_build_object('semana', x.semana, 'nota', x.nota, 'sessoes', x.n, 'na_meta', x.meta) order by x.semana)
              from (select date_trunc('week', s.inicio at time zone 'America/Sao_Paulo')::date semana, round(avg(s.nota), 1) nota,
                           count(*)::int n,
                           count(*) filter (where s.nota >= coalesce(a.nota_minima, 75) and not s.reprovada)::int meta
                      from public.treino_sessoes s
                      left join public.treino_atribuicoes a on a.id = s.atribuicao_id
                     where s.empresa_id = empresa and s.situacao = 'avaliada' and s.origem <> 'teste'
                       and s.operador_id = any (ops) and s.inicio >= (ini::timestamp at time zone 'America/Sao_Paulo')
                     group by 1) x), '[]'::jsonb),
        -- ligações reais no mesmo item e na mesma semana
        'real_itens', coalesce((
            select jsonb_agg(jsonb_build_object('semana', x.semana, 'item', x.item, 'sim', x.sim, 'avaliados', x.avaliados)
                             order by x.semana, x.item)
              from (select date_trunc('week', q.data)::date semana, q.item, sum(q.aprovadas)::int sim,
                           sum(q.avaliadas - q.na)::int avaliados
                      from public.voz_qualidade_dia q
                     where q.empresa_id = empresa and q.origem = 'discador' and q.item <> '_ligacao'
                       and q.operador_ref = any (refs) and q.data >= ini
                     group by 1, 2
                    having sum(q.avaliadas - q.na) > 0) x), '[]'::jsonb),
        'real_notas', coalesce((
            select jsonb_agg(jsonb_build_object('semana', x.semana, 'nota', x.nota, 'ligacoes', x.n) order by x.semana)
              from (select date_trunc('week', q.data)::date semana, round(sum(q.nota_soma) / nullif(sum(q.avaliadas), 0), 1) nota,
                           sum(q.avaliadas)::int n
                      from public.voz_qualidade_dia q
                     where q.empresa_id = empresa and q.origem = 'discador' and q.item = '_ligacao'
                       and q.operador_ref = any (refs) and q.data >= ini
                     group by 1
                    having sum(q.avaliadas) > 0) x), '[]'::jsonb),
        -- mapa por item e equipe (só na leitura da empresa; nunca por pessoa)
        'por_equipe', case when operador is null and equipe is null then coalesce((
            select jsonb_agg(jsonb_build_object('equipe', x.equipe_id, 'item', x.item, 'sim', x.sim, 'avaliados', x.avaliados,
                                                'pessoas', x.pessoas) order by x.equipe_id, x.item)
              from (select o.equipe_id, e.key item,
                           count(*) filter (where coalesce(r.qualidade, e.value #>> '{}') = 'sim')::int sim,
                           count(*) filter (where coalesce(r.qualidade, e.value #>> '{}') in ('sim', 'nao'))::int avaliados,
                           count(distinct s.operador_id)::int pessoas
                      from public.treino_sessoes s
                      join public.voz_operadores o on o.id = s.operador_id and o.equipe_id is not null
                      cross join lateral jsonb_each(s.itens) e
                      left join public.treino_revisoes r on r.sessao_id = s.id and r.item_id = e.key
                     where s.empresa_id = empresa and s.situacao = 'avaliada' and s.origem <> 'teste'
                       and s.operador_id = any (ops) and s.inicio >= (ini::timestamp at time zone 'America/Sao_Paulo')
                     group by 1, 2) x), '[]'::jsonb) end,
        -- concordância IA × Qualidade nos itens revisados
        'concordancia', (select jsonb_build_object('revisados', count(*), 'iguais', count(*) filter (where r.ia = r.qualidade))
                           from public.treino_revisoes r join public.treino_sessoes s on s.id = r.sessao_id
                          where s.empresa_id = empresa and s.operador_id = any (ops)
                            and s.inicio >= (ini::timestamp at time zone 'America/Sao_Paulo')),
        -- itens em foco nos treinos atribuídos ao escopo (o "treinado" do treino × ligações reais)
        'itens_treinados', coalesce((
            select jsonb_agg(distinct f) from public.treino_atribuicoes a
              join public.treino_cenarios c on c.id = a.cenario_id
              cross join lateral unnest(c.itens_foco) f
             where a.empresa_id = empresa and a.criado_em >= (ini::timestamp at time zone 'America/Sao_Paulo')
               and exists (select 1 from public.treino_atribuicao_operadores ao
                            where ao.atribuicao_id = a.id and ao.operador_id = any (ops))), '[]'::jsonb),
        -- só na leitura da pessoa: as sessões, para a linha do tempo por item
        'sessoes', case when operador is not null then coalesce((
            select jsonb_agg(jsonb_build_object('id', s.id, 'atribuicao', s.atribuicao_id, 'inicio', s.inicio, 'modo', s.modo,
                                                'nota', s.nota, 'reprovada', s.reprovada,
                                                'cenario', (select c.nome from public.treino_cenarios c where c.id = s.cenario_id),
                                                'itens', (select jsonb_object_agg(e.key, coalesce(r.qualidade, e.value #>> '{}'))
                                                            from jsonb_each(s.itens) e
                                                            left join public.treino_revisoes r on r.sessao_id = s.id and r.item_id = e.key))
                             order by s.inicio)
              from public.treino_sessoes s
             where s.empresa_id = empresa and s.operador_id = operador and s.situacao = 'avaliada' and s.origem <> 'teste'
               and s.inicio >= (ini::timestamp at time zone 'America/Sao_Paulo')), '[]'::jsonb) end);
end $$;
comment on function public.evolucao_treino(bigint, bigint, bigint, int) is
    'Evolução do treino (empresa, equipe ou pessoa): nota do treino por item e semana (revisão da Qualidade vale), ligações '
    'reais no mesmo item, mapa por equipe, concordância IA × Qualidade e, da pessoa, as sessões. Sem ranking. SQL 121.';
revoke all on function public.evolucao_treino(bigint, bigint, bigint, int) from public, anon;
grant execute on function public.evolucao_treino(bigint, bigint, bigint, int) to authenticated;
