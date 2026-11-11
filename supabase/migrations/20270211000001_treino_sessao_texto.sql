-- SQL 100 · Roleplay: sessão de treino por TEXTO e avaliação pelo checklist (PR 5 do Roleplay, SPEC §2.4, §5.1, §5.2,
-- §6 e §8). Quem conversa e avalia é o simulador da VM (voz/treino.py), atrás da Edge Function `treino`, que lê e grava
-- o banco. Aqui só o que faltava para isso; o resultado continua sendo gravado por registrar_sessao_treino (SQL 90).
--
-- 1. treino_turnos: a conversa em andamento (só enquanto a sessão está aberta). Uma linha por sessão, com as falas já
--    mascaradas (mesmo check da transcrição: transcricao_treino_ok), os tokens gastos até agora e o saldo fictício
--    sorteado para a sessão. RLS ligada e NENHUMA policy: nem o site nem anon leem ou gravam; só a Edge Function, com a
--    chave do servidor. Some ao encerrar (a transcrição avaliada vai para treino_transcricoes, 90 dias; a da Qualidade,
--    1 dia) e, se a sessão ficar largada, em 1 dia (expira_em; apagada a cada gravação nova).
-- 2. treino_contexto_sessao(sessao, token): o que a Edge Function precisa para o turno e para a avaliação (o cenário
--    inteiro, com o roteiro do cliente simulado, o checklist da versão da sessão e a conversa até agora). Pelo link
--    (token) só com a chave do servidor (o operador nunca vê o roteiro do cliente); logado, só quem abriu a sessão
--    (iniciada_por), no treino lado a lado (treinar_operadores) ou no teste do cenário (editar_cenarios_treino).
-- 3. treino_guardar_turnos(sessao, turnos, tokens, saldo) e treino_descartar_turnos(sessao, abandonar): só o servidor.
--    Guardar recusa sessão que não está mais em andamento (saiu sem contar, outra sessão aberta, link revogado na hora
--    em que a Edge Function confere). Descartar com abandonar = true fecha a sessão aberta como abandonada SEM uso (o
--    operador saiu antes de falar: nada a cobrar).
-- 4. resultado_sessao_treino(sessao): o resultado para a Qualidade (o mesmo formato de treino_resultado, mais quem
--    treinou, o cenário, a atribuição, a revisão item a item e as discordâncias com o id para resolver). Quem treina
--    vê as sessões da empresa; o teste do cenário, quem o fez (com editar_cenarios_treino) ou quem treina.
-- A nota de treino continua só em treino_sessoes (nunca voz_avaliacoes/voz_qualidade_dia). Cobrança: a de sempre do
-- registrar_sessao_treino (ia_treino_texto por sessão, com franquia; abandonada com fala do operador é cobrada e não
-- conta tentativa; falhou não conta nem cobra).
-- Pode rodar de novo (tabela if not exists, funções recriadas inteiras). Depende dos SQL 60, 89, 90 e 99.

-- ================================================================ 1. conversa em andamento
create table if not exists public.treino_turnos (
    sessao_id      bigint primary key references public.treino_sessoes (id) on delete cascade,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    turnos         jsonb not null default '[]' check (public.transcricao_treino_ok(turnos)),
    tokens         bigint not null default 0 check (tokens >= 0),
    saldo          text check (saldo ~ '^R\$ [0-9.]{1,12},[0-9]{2}$'),
    atualizado_em  timestamptz not null default now(),
    expira_em      timestamptz not null default now() + interval '1 day'
);
create index if not exists treino_turnos_expira on public.treino_turnos (expira_em);
comment on table public.treino_turnos is
    'Conversa da sessão de treino por texto ENQUANTO está aberta (falas mascaradas, tokens, saldo fictício). Só a Edge '
    'Function treino lê e grava (sem policy). Some ao encerrar ou em 1 dia. SQL 100.';
alter table public.treino_turnos enable row level security;
revoke all on public.treino_turnos from anon, authenticated;

-- ================================================================ 2. contexto da sessão (para o turno e a avaliação)
create or replace function public.treino_contexto_sessao(sessao bigint, token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    s public.treino_sessoes;
    l public.treino_links;
    c public.treino_cenarios;
    t public.treino_turnos;
begin
    select * into s from public.treino_sessoes x where x.id = sessao;
    if s.id is null then
        raise exception 'sessão não encontrada';
    end if;
    if token is not null then
        if not public.chamada_do_servidor() then
            raise exception 'só o serviço de treino abre a sessão pelo link';
        end if;
        l := public.link_do_token_treino(token);
        if s.origem <> 'link' or s.operador_id is distinct from l.operador_id or s.empresa_id <> l.empresa_id then
            raise exception 'sessão não encontrada';
        end if;
    else
        if auth.uid() is null or s.iniciada_por is distinct from auth.uid() or s.origem not in ('lado_a_lado', 'teste') then
            raise exception 'sessão não encontrada';
        end if;
        perform public.conferir_treino(s.empresa_id,
                                       case when s.origem = 'teste' then 'editar_cenarios_treino' else 'treinar_operadores' end);
    end if;
    if not public.treino_liberado(s.empresa_id) then
        raise exception 'treinos indisponíveis';
    end if;
    select * into c from public.treino_cenarios x where x.id = s.cenario_id;
    select * into t from public.treino_turnos x where x.sessao_id = s.id;
    return jsonb_build_object(
        'sessao', s.id, 'empresa', s.empresa_id, 'origem', s.origem, 'modo', s.modo, 'situacao', s.situacao,
        'atribuicao', s.atribuicao_id, 'operador', s.operador_id, 'inicio', s.inicio,
        'segundos', greatest(0, extract(epoch from now() - s.inicio)::int), 'duracao_max_s', c.duracao_max_s,
        'cenario', jsonb_build_object('id', c.id, 'nome', c.nome, 'persona_nome', c.persona_nome, 'perfil', c.perfil,
                                      'objetivo', c.objetivo, 'comportamentos', to_jsonb(c.comportamentos),
                                      'frases', to_jsonb(c.frases), 'objecoes', c.objecoes, 'dificuldade', c.dificuldade,
                                      'divida', c.divida, 'objetivo_cenario', c.objetivo_cenario,
                                      'itens_foco', to_jsonb(c.itens_foco)),
        'checklist', jsonb_build_object('versao_id', s.checklist_versao_id,
                                        'itens', coalesce((select v.itens from public.checklist_versoes v
                                                            where v.id = s.checklist_versao_id), '[]'::jsonb)),
        'turnos', coalesce(t.turnos, '[]'::jsonb), 'tokens', coalesce(t.tokens, 0), 'saldo', t.saldo);
end $$;
comment on function public.treino_contexto_sessao(bigint, text) is
    'Cenário inteiro (com o roteiro do cliente simulado), checklist da sessão e conversa até agora, para a Edge Function '
    'treino. Pelo link: só com a chave do servidor. Logado: só quem abriu o treino lado a lado ou o teste. SQL 100.';

-- ================================================================ 3. guardar e descartar a conversa (só o servidor)
create or replace function public.treino_guardar_turnos(sessao bigint, turnos jsonb, tokens bigint, saldo text default null)
returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare s public.treino_sessoes;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o serviço de treino grava a conversa';
    end if;
    select * into s from public.treino_sessoes x where x.id = sessao for update;
    if s.id is null or s.situacao <> 'em_andamento' then
        raise exception 'a sessão já terminou';
    end if;
    delete from public.treino_turnos x where x.expira_em < now();
    insert into public.treino_turnos (sessao_id, empresa_id, turnos, tokens, saldo)
    values (s.id, s.empresa_id, coalesce(turnos, '[]'::jsonb), greatest(0, coalesce(tokens, 0)), saldo)
    on conflict (sessao_id) do update set turnos = excluded.turnos, tokens = excluded.tokens,
                                          saldo = coalesce(excluded.saldo, public.treino_turnos.saldo), atualizado_em = now();
end $$;

create or replace function public.treino_descartar_turnos(sessao bigint, abandonar boolean default false) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o serviço de treino descarta a conversa';
    end if;
    delete from public.treino_turnos x where x.sessao_id = sessao;
    if abandonar then                           -- saiu antes de falar: não conta tentativa e não é cobrada
        update public.treino_sessoes x set situacao = 'abandonada', fim = now(),
               duracao_s = least(3600, extract(epoch from now() - x.inicio)::int)
         where x.id = sessao and x.situacao = 'em_andamento';
    end if;
end $$;

-- ================================================================ 4. resultado para a Qualidade
create or replace function public.resultado_sessao_treino(sessao bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    s public.treino_sessoes;
    a public.treino_atribuicoes;
begin
    select * into s from public.treino_sessoes x where x.id = sessao;
    if s.id is null then
        raise exception 'sessão não encontrada';
    end if;
    if not public.cliente_pode(s.empresa_id, 'treinar_operadores')
       and not (s.origem = 'teste' and s.iniciada_por = auth.uid() and public.cliente_pode(s.empresa_id, 'editar_cenarios_treino')) then
        raise exception 'sem permissão para ver esta sessão de treino';
    end if;
    select * into a from public.treino_atribuicoes x where x.id = s.atribuicao_id;
    return jsonb_build_object(
        'sessao', s.id, 'origem', s.origem, 'atribuicao', s.atribuicao_id, 'situacao', s.situacao, 'modo', s.modo,
        'inicio', s.inicio, 'duracao_s', s.duracao_s, 'nota', s.nota, 'reprovada', s.reprovada,
        'item_reprovado', s.item_reprovado, 'objetivo_ok', s.objetivo_ok, 'motivo_falha', s.motivo_falha,
        'nota_minima', a.nota_minima, 'prazo', a.prazo,
        'tentativas', case when a.tentativas is not null then a.tentativas
                               + coalesce((select ao.tentativas_extra from public.treino_atribuicao_operadores ao
                                            where ao.atribuicao_id = a.id and ao.operador_id = s.operador_id), 0) end,
        'tentativa', case when s.situacao = 'avaliada' and s.atribuicao_id is not null
                          then (select count(*) from public.treino_sessoes y where y.atribuicao_id = s.atribuicao_id
                                   and y.operador_id = s.operador_id and y.situacao = 'avaliada' and y.inicio <= s.inicio) end,
        'operador', (select jsonb_build_object('id', o.id, 'apelido', o.apelido) from public.voz_operadores o where o.id = s.operador_id),
        'cenario', (select jsonb_build_object('id', c.id, 'nome', c.nome, 'persona_nome', c.persona_nome,
                                              'objetivo_cenario', c.objetivo_cenario)
                      from public.treino_cenarios c where c.id = s.cenario_id),
        'itens', coalesce((select jsonb_agg(jsonb_build_object(
                               'id', e.key, 'resposta', e.value #>> '{}', 'texto', i ->> 'texto', 'gravidade', i ->> 'gravidade',
                               'evidencia', s.evidencia -> e.key,
                               'revisado', (select r.qualidade from public.treino_revisoes r where r.sessao_id = s.id and r.item_id = e.key))
                               order by e.key)
                             from jsonb_each(s.itens) e
                             left join lateral (select x from public.checklist_versoes v, jsonb_array_elements(v.itens) x
                                                 where v.id = s.checklist_versao_id and x ->> 'id' = e.key limit 1) z(i) on true),
                          '[]'::jsonb),
        'feedback', coalesce((select jsonb_agg(jsonb_build_object('item', f.item_id, 'trecho', f.trecho, 'dica', f.dica)
                                               order by f.item_id)
                                from public.treino_feedback f where f.sessao_id = s.id and f.expira_em > now()), '[]'::jsonb),
        'transcricao', (select t.turnos from public.treino_transcricoes t where t.sessao_id = s.id and t.expira_em > now()),
        'discordancias', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'item', d.item_id, 'texto', d.texto,
                                                                       'em', d.em, 'resolvida', d.resolvida_em is not null)
                                                    order by d.em)
                                     from public.treino_discordancias d where d.sessao_id = s.id), '[]'::jsonb));
end $$;
comment on function public.resultado_sessao_treino(bigint) is
    'Resultado de uma sessão de treino para a Qualidade (itens, trechos, dicas, transcrição, revisão e discordâncias). '
    'Quem treina vê a empresa; o teste do cenário, quem o fez. SQL 100.';

revoke all on function public.treino_contexto_sessao(bigint, text), public.resultado_sessao_treino(bigint)
    from public, anon;
grant execute on function public.treino_contexto_sessao(bigint, text) to authenticated, service_role;
grant execute on function public.resultado_sessao_treino(bigint) to authenticated;
revoke all on function public.treino_guardar_turnos(bigint, jsonb, bigint, text), public.treino_descartar_turnos(bigint, boolean)
    from public, anon, authenticated;
grant execute on function public.treino_guardar_turnos(bigint, jsonb, bigint, text), public.treino_descartar_turnos(bigint, boolean)
    to service_role;
