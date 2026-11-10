-- SQL 120 · Roleplay: sugestões de atribuição de treino a partir das notas e dos alertas do Speech (PR 7 do Roleplay,
-- SPEC §2.3, §5.3 e §10). O job noturno da VM (voz/analise/rotina.py › noite, 02:40, depois de agregar_speech_dia) chama
-- gerar_sugestoes_treino(empresa) para cada empresa da sua parte; as telas (Painel do Roleplay) mostram, deixam ver a
-- evidência (só contagens), atribuir o treino sugerido e dispensar com o motivo em 1 clique (com "Desfazer").
--
-- 1. treino_sugestoes: + atualizada_em (a última noite em que a regra ainda valia; a que parou de valer some em 8 dias)
--    e a regra nova 'nota_baixa'. Continua só com contagens e ids de operador (evidencia_sugestao_treino_ok, SQL 90:
--    nada de id_cliente, cpf, telefone, chamada, gravação ou trecho).
-- 2. gerar_sugestoes_treino(empresa, hoje): só o servidor ou a VM de voz. Regras (janela que o banco ainda tem; a nota
--    diária por item, voz_qualidade_dia, fica depois dos 90 dias; voz_avaliacoes e voz_alertas vão com a gravação):
--    - item_reprovado: item do checklist com "não" em 3+ operadores nos últimos 7 dias (ligações do discador);
--    - nota_baixa: operador com nota média abaixo de 70 em 10+ ligações nos últimos 14 dias (o pior item vai junto);
--    - item_critico_operador: o mesmo item crítico reprovado 2+ vezes por um operador em 30 dias (prioridade alta);
--    - alerta_subiu: alerta (Procon, jurídico, ameaça, cobrança abusiva) que dobrou na semana numa equipe (3+);
--    - vulnerabilidade: sinal de vulnerabilidade 3+ vezes na semana numa equipe.
--    Cada regra tem uma chave estável (regra:item[:equipe|operador]); a noite seguinte atualiza a evidência e os
--    operadores. Dispensada fica dispensada até dispensada_ate (30 dias, dispensar_sugestao_treino do SQL 90) e volta
--    se a regra ainda valer; aceita (virou treino) fica aceita enquanto o treino estiver aberto ou até 14 dias depois do
--    prazo, e volta se ainda valer. O cenário sugerido é publicado (da empresa antes do Padrão MotorCX) com o item em
--    foco ou com o tipo de cliente da regra. Só operadores ativos do cadastro (voz_operadores) com o ID do discador.
-- 3. voz_vm.gerar_sugestoes_treino(args): a mesma função pelo acesso próprio da VM (papel motorcx_voz).
-- Nunca grava em voz_avaliacoes/voz_qualidade_dia (só lê). Pode rodar de novo (colunas if not exists, constraint com
-- drop if exists, funções recriadas inteiras). Depende dos SQL 57, 60, 62, 89 e 90.

-- ================================================================ 1. tabela
alter table public.treino_sugestoes add column if not exists atualizada_em timestamptz not null default now();
alter table public.treino_sugestoes drop constraint if exists treino_sugestoes_regra_check;
alter table public.treino_sugestoes add constraint treino_sugestoes_regra_check
    check (regra in ('item_reprovado', 'alerta_subiu', 'item_critico_operador', 'vulnerabilidade', 'nota_baixa'));
create index if not exists treino_sugestoes_abertas on public.treino_sugestoes (empresa_id, situacao, atualizada_em desc);
comment on column public.treino_sugestoes.atualizada_em is
    'Última noite em que a regra ainda valia (gerar_sugestoes_treino). Nova sem atualizar há 8 dias some. SQL 120.';

-- cenário publicado para a sugestão: com o item em foco ou com o tipo de cliente; o da empresa antes do Padrão MotorCX
create or replace function public.cenario_sugestao_treino(empresa bigint, item text, perfil text) returns bigint
language sql stable security definer set search_path = public as $$
    select c.id from public.treino_cenarios c
     where c.situacao = 'publicado' and (c.empresa_id is null or c.empresa_id = cenario_sugestao_treino.empresa)
       and ((cenario_sugestao_treino.item is not null and cenario_sugestao_treino.item = any (c.itens_foco))
            or (cenario_sugestao_treino.perfil is not null and c.perfil = cenario_sugestao_treino.perfil))
     order by (cenario_sugestao_treino.item is not null and cenario_sugestao_treino.item = any (c.itens_foco)) desc,
              (c.empresa_id is null), c.id
     limit 1
$$;
revoke all on function public.cenario_sugestao_treino(bigint, text, text) from public, anon, authenticated;

-- ================================================================ 2. o job noturno
create or replace function public.gerar_sugestoes_treino(empresa bigint, hoje date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    d date := coalesce(hoje, public.hoje_treino());
    ini7 timestamptz := ((d - 7)::timestamp at time zone 'America/Sao_Paulo');
    ini14 timestamptz := ((d - 14)::timestamp at time zone 'America/Sao_Paulo');
    fim timestamptz := (d::timestamp at time zone 'America/Sao_Paulo');
    r record;
    n int := 0;
    apagadas int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz geram as sugestões de treino';
    end if;
    if empresa is null or not public.treino_liberado(empresa) then
        return jsonb_build_object('empresa', empresa, 'sugestoes', 0, 'desligado', true);
    end if;
    for r in
        with ops as (
            select o.id, o.operador_ref, o.equipe_id from public.voz_operadores o
             where o.empresa_id = empresa and o.ativo and o.operador_ref is not null),
        -- item com "não" em 3+ operadores na semana
        r1 as (
            select q.item, array_agg(distinct o.id order by o.id) filter (where q.avaliadas - q.aprovadas - q.na > 0) ops,
                   count(distinct o.id) filter (where q.avaliadas - q.aprovadas - q.na > 0) n_ops,
                   sum(q.avaliadas)::int avaliadas, sum(q.avaliadas - q.aprovadas - q.na)::int nao
              from public.voz_qualidade_dia q join ops o on o.operador_ref = q.operador_ref
             where q.empresa_id = empresa and q.origem = 'discador' and q.item <> '_ligacao'
               and q.data between d - 7 and d - 1
             group by q.item
            having count(distinct o.id) filter (where q.avaliadas - q.aprovadas - q.na > 0) >= 3),
        -- nota média abaixo de 70 em 10+ ligações em 14 dias
        r5 as (
            select o.id op, sum(q.avaliadas)::int ligacoes, round(sum(q.nota_soma) / nullif(sum(q.avaliadas), 0), 1) media
              from public.voz_qualidade_dia q join ops o on o.operador_ref = q.operador_ref
             where q.empresa_id = empresa and q.origem = 'discador' and q.item = '_ligacao' and q.data between d - 14 and d - 1
             group by o.id
            having sum(q.avaliadas) >= 10 and sum(q.nota_soma) / nullif(sum(q.avaliadas), 0) < 70),
        r5_pior as (
            select distinct on (o.id) o.id op, q.item
              from public.voz_qualidade_dia q join ops o on o.operador_ref = q.operador_ref
             where q.empresa_id = empresa and q.origem = 'discador' and q.item <> '_ligacao' and q.data between d - 14 and d - 1
               and o.id in (select op from r5)
             group by o.id, q.item
            having sum(q.avaliadas - q.na) > 0
             order by o.id, sum(q.aprovadas)::numeric / sum(q.avaliadas - q.na), q.item),
        -- o mesmo item crítico reprovado 2+ vezes por um operador em 30 dias
        r3 as (
            select v.item_reprovado item, o.id op, count(*)::int vezes
              from public.voz_avaliacoes v join ops o on o.operador_ref = v.operador_ref
             where v.empresa_id = empresa and v.origem = 'discador' and v.reprovada and v.item_reprovado is not null
               and v.avaliada_em >= ((d - 30)::timestamp at time zone 'America/Sao_Paulo') and v.avaliada_em < fim
             group by v.item_reprovado, o.id
            having count(*) >= 2),
        -- alerta que dobrou na semana numa equipe
        r2 as (
            select a.tipo, o.equipe_id, array_agg(distinct o.id order by o.id) filter (where a.criado_em >= ini7) ops,
                   count(*) filter (where a.criado_em >= ini7)::int semana,
                   count(*) filter (where a.criado_em < ini7)::int anterior
              from public.voz_alertas a join ops o on o.operador_ref = a.operador_ref
             where a.empresa_id = empresa and a.tipo in ('procon', 'juridico', 'ameaca', 'abusiva') and o.equipe_id is not null
               and a.criado_em >= ini14 and a.criado_em < fim
             group by a.tipo, o.equipe_id
            having count(*) filter (where a.criado_em >= ini7) >= 3
               and count(*) filter (where a.criado_em >= ini7) >= 2 * count(*) filter (where a.criado_em < ini7)),
        -- sinal de vulnerabilidade concentrado numa equipe
        r4 as (
            select a.sinal, o.equipe_id, array_agg(distinct o.id order by o.id) ops, count(*)::int alertas
              from public.voz_alertas a join ops o on o.operador_ref = a.operador_ref
             where a.empresa_id = empresa and a.tipo = 'vulnerabilidade' and a.sinal is not null and o.equipe_id is not null
               and a.criado_em >= ini7 and a.criado_em < fim
             group by a.sinal, o.equipe_id
            having count(*) >= 3)
        select 'item_reprovado' regra, 'item_reprovado:' || r1.item chave, r1.ops[1:200] ops,
               public.cenario_sugestao_treino(empresa, r1.item,
                   case r1.item when 'ck_cpc' then 'terceiro_atende' when 'ck_terceiro' then 'terceiro_atende'
                                when 'ck_naoligue' then 'nao_me_ligue' when 'ck_ameaca' then 'irritado'
                                when 'ck_oferta' then 'quer_parcelar_muito' end) cen,
               jsonb_build_object('item', r1.item, 'operadores', r1.n_ops, 'avaliadas', r1.avaliadas, 'nao', r1.nao,
                                  'de', (d - 7)::text, 'ate', (d - 1)::text) ev
          from r1
        union all
        select 'nota_baixa', 'nota_baixa:op' || r5.op, array[r5.op],
               public.cenario_sugestao_treino(empresa, p.item, null),
               jsonb_strip_nulls(jsonb_build_object('nota_media', r5.media, 'ligacoes', r5.ligacoes, 'item', p.item,
                                                    'de', (d - 14)::text, 'ate', (d - 1)::text))
          from r5 left join r5_pior p on p.op = r5.op
        union all
        select 'item_critico_operador', 'item_critico_operador:' || r3.item || ':op' || r3.op, array[r3.op],
               public.cenario_sugestao_treino(empresa, r3.item,
                   case r3.item when 'ck_cpc' then 'terceiro_atende' when 'ck_terceiro' then 'terceiro_atende'
                                when 'ck_naoligue' then 'nao_me_ligue' when 'ck_ameaca' then 'irritado' end),
               jsonb_build_object('item', r3.item, 'vezes', r3.vezes, 'de', (d - 30)::text, 'ate', (d - 1)::text)
          from r3
        union all
        select 'alerta_subiu', 'alerta_subiu:' || r2.tipo || ':eq' || r2.equipe_id, r2.ops[1:200],
               public.cenario_sugestao_treino(empresa, null,
                   case r2.tipo when 'procon' then 'contesta_procon' when 'juridico' then 'contesta_procon' else 'irritado' end),
               jsonb_build_object('alerta', r2.tipo, 'equipe', r2.equipe_id, 'semana', r2.semana,
                                  'semana_anterior', r2.anterior, 'de', (d - 7)::text, 'ate', (d - 1)::text)
          from r2
        union all
        select 'vulnerabilidade', 'vulnerabilidade:' || r4.sinal || ':eq' || r4.equipe_id, r4.ops[1:200],
               public.cenario_sugestao_treino(empresa, null,
                   case r4.sinal when 'idade_confusao' then 'idoso_dificuldade' when 'desemprego_recente' then 'desempregado_recente' end),
               jsonb_build_object('sinal', r4.sinal, 'equipe', r4.equipe_id, 'alertas', r4.alertas,
                                  'de', (d - 7)::text, 'ate', (d - 1)::text)
          from r4
    loop
        insert into public.treino_sugestoes as s (empresa_id, regra, chave, cenario_id, operadores, evidencia, atualizada_em)
        values (empresa, r.regra, r.chave, r.cen, coalesce(r.ops, '{}'), r.ev, now())
        on conflict (empresa_id, chave) do update set
            evidencia = excluded.evidencia, operadores = excluded.operadores, atualizada_em = now(),
            cenario_id = coalesce(s.cenario_id, excluded.cenario_id),
            criado_em = case when s.situacao = 'nova'
                               or (s.situacao = 'aceita' and exists (select 1 from public.treino_atribuicoes a
                                                                       where a.origem_sugestao_id = s.id and a.prazo >= d - 14))
                             then s.criado_em else now() end,
            situacao = case when s.situacao = 'aceita' and exists (select 1 from public.treino_atribuicoes a
                                                                     where a.origem_sugestao_id = s.id and a.prazo >= d - 14)
                            then 'aceita' else 'nova' end,
            motivo_dispensa = null, dispensada_ate = null, dispensada_por = null
         where s.situacao <> 'dispensada' or s.dispensada_ate < d;
        n := n + 1;
    end loop;
    -- a regra parou de valer: a sugestão nova some depois de 8 noites sem atualizar
    delete from public.treino_sugestoes s
     where s.empresa_id = empresa and s.situacao = 'nova' and s.atualizada_em < now() - interval '8 days';
    get diagnostics apagadas = row_count;
    return jsonb_build_object('empresa', empresa, 'sugestoes', n, 'apagadas', apagadas, 'dia', d);
end $$;
comment on function public.gerar_sugestoes_treino(bigint, date) is
    'Job noturno das sugestões de treino (só contagens e ids de operador): item com "não" em 3+ operadores, nota baixa, '
    'item crítico repetido, alerta que dobrou e vulnerabilidade concentrada. Só servidor ou VM de voz. SQL 120.';
revoke all on function public.gerar_sugestoes_treino(bigint, date) from public, anon, authenticated;
grant execute on function public.gerar_sugestoes_treino(bigint, date) to service_role;

-- ================================================================ 3. acesso próprio da VM (voz_vm)
create or replace function voz_vm.gerar_sugestoes_treino(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.gerar_sugestoes_treino((args ->> 'empresa')::bigint, (args ->> 'hoje')::date);
end $$;
revoke all on function voz_vm.gerar_sugestoes_treino(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.gerar_sugestoes_treino(jsonb) to motorcx_voz;
