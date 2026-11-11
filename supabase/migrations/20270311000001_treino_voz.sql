-- SQL 119 · Roleplay: sessão de treino por VOZ no navegador (PR 6 do Roleplay, SPEC §2.4, §6, §8 e pergunta 4).
-- O áudio vai do navegador ao serviço de voz do treino na VM (voz/treino_voz.py, WebSocket seguro atrás do Caddy da
-- 8443) com um bilhete de uso único assinado pela Edge Function `treino`; STT Deepgram e TTS da Montagem, chaves no
-- Secret Manager. Quem lê e grava o banco continua sendo a Edge Function: a VM devolve o resultado assinado e a função
-- chama registrar_sessao_treino (SQL 90), que já cobra ia_treino_voz por minuto, com franquia, e avisa a 80% e 100%.
-- Áudio nunca é guardado; a transcrição é a mesma das sessões por texto (fala do operador mascarada, 90 dias).
--
-- 1. treino_contexto_sessao(sessao, token) recriada inteira (texto do SQL 100) com dois campos a mais: voz_tts do
--    cenário (a voz da cliente simulada; nula = a voz padrão da VM) e voz_restante_s (segundos de voz que ainda
--    cabem na franquia do mês). A Edge Function corta a sessão por voz no menor entre a duração do cenário e esse saldo:
--    ao esgotar no meio, a ligação encerra e é avaliada; a próxima sessão por voz não abre (abrir_sessao_treino, SQL 90).
-- 2. treino_meus(token) recriada inteira (texto do SQL 90) com voz_minutos e voz_franquia, para o aviso de 80% no
--    briefing do operador ("Restam N minutos de voz neste mês"). Nada mais muda nela.
-- 3. treino_previa_voz(token, atribuicao, cenario, empresa): o "Ouvir a voz" da cliente simulada antes de começar.
--    Devolve só a voz e uma frase do roteiro fictício (nunca o roteiro inteiro). Pelo link, só com a chave do servidor
--    (a Edge Function), para um treino do próprio operador que tem voz, até 6 prévias por hora (cada uma registrada em
--    treino_link_acessos com a ação nova 'ouvir'). Logado: quem treina ou edita cenários na empresa.
-- Pode rodar de novo (constraint com drop if exists, funções recriadas inteiras). Depende dos SQL 60, 89, 90, 99 e 100.
-- Nunca grava em voz_avaliacoes/voz_qualidade_dia.

-- ================================================================ acessos do link: + 'ouvir'
alter table public.treino_link_acessos drop constraint if exists treino_link_acessos_acao_check;
alter table public.treino_link_acessos add constraint treino_link_acessos_acao_check
    check (acao in ('abrir', 'iniciar', 'resultado', 'sair', 'discordar', 'ouvir'));

-- segundos de voz que ainda cabem na franquia do mês da empresa (0 = esgotou)
create or replace function public.voz_restante_treino(empresa bigint) returns int
language sql stable security definer set search_path = public as $$
    select greatest(0, public.franquia_treino(voz_restante_treino.empresa, 'ia_treino_voz',
                                              date_trunc('month', public.hoje_treino())::date) * 60
                       - coalesce((select u.segundos_voz from public.treino_uso_mes u
                                    where u.empresa_id = voz_restante_treino.empresa
                                      and u.competencia = date_trunc('month', public.hoje_treino())::date), 0))::int
$$;
revoke all on function public.voz_restante_treino(bigint) from public, anon, authenticated;
grant execute on function public.voz_restante_treino(bigint) to service_role;

-- ================================================================ 1. contexto da sessão (+ voz_tts, voz_restante_s)
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
                                      'itens_foco', to_jsonb(c.itens_foco), 'voz_tts', c.voz_tts),
        'checklist', jsonb_build_object('versao_id', s.checklist_versao_id,
                                        'itens', coalesce((select v.itens from public.checklist_versoes v
                                                            where v.id = s.checklist_versao_id), '[]'::jsonb)),
        'turnos', coalesce(t.turnos, '[]'::jsonb), 'tokens', coalesce(t.tokens, 0), 'saldo', t.saldo,
        'voz_restante_s', case when s.modo = 'voz' then public.voz_restante_treino(s.empresa_id) end);
end $$;
comment on function public.treino_contexto_sessao(bigint, text) is
    'Cenário inteiro (com o roteiro do cliente simulado e a voz), checklist da sessão, conversa até agora e, na sessão '
    'por voz, os segundos que ainda cabem na franquia, para a Edge Function treino. Pelo link: só com a chave do '
    'servidor. Logado: só quem abriu o treino lado a lado ou o teste. SQL 100/119.';

-- ================================================================ 2. "Meus treinamentos" (+ uso de voz do mês)
create or replace function public.treino_meus(token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    l public.treino_links;
    comp date := date_trunc('month', public.hoje_treino())::date;
    usados int;
    fr int;
begin
    l := public.link_do_token_treino(token);
    insert into public.treino_link_acessos (link_id, empresa_id, acao) values (l.id, l.empresa_id, 'abrir');
    usados := coalesce((select u.minutos_voz from public.treino_uso_mes u
                         where u.empresa_id = l.empresa_id and u.competencia = comp), 0);
    fr := public.franquia_treino(l.empresa_id, 'ia_treino_voz', comp);
    return jsonb_build_object(
        'apelido', (select o.apelido from public.voz_operadores o where o.id = l.operador_id),
        'valido_ate', l.valido_ate,
        'voz_disponivel', usados < fr,
        'voz_minutos', usados,
        'voz_franquia', fr,
        'treinos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'atribuicao', a.id, 'prazo', a.prazo, 'nota_minima', a.nota_minima, 'modos', a.modos,
                       'tentativas', case when a.tentativas is not null then a.tentativas + ao.tentativas_extra end,
                       'tentativas_usadas', ao.tentativas_usadas, 'melhor_nota', ao.melhor_nota,
                       'situacao', public.situacao_treino_operador(a.id, ao.operador_id),
                       'cenario', public.briefing_treino(a.cenario_id, a.empresa_id),
                       'sessoes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'modo', s.modo,
                                                     'inicio', s.inicio, 'nota', s.nota, 'reprovada', s.reprovada)
                                                     order by s.inicio)
                                              from public.treino_sessoes s
                                             where s.atribuicao_id = a.id and s.operador_id = ao.operador_id
                                               and s.situacao = 'avaliada'), '[]'::jsonb))
                       order by a.prazo, a.id)
              from public.treino_atribuicao_operadores ao
              join public.treino_atribuicoes a on a.id = ao.atribuicao_id
             where ao.operador_id = l.operador_id and a.empresa_id = l.empresa_id), '[]'::jsonb));
end $$;

-- ================================================================ 3. "Ouvir a voz" da cliente simulada
create or replace function public.treino_previa_voz(token text default null, atribuicao bigint default null,
                                                    cenario bigint default null, empresa bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    l public.treino_links;
    c public.treino_cenarios;
    emp bigint;
    frase text;
begin
    if token is not null then
        if not public.chamada_do_servidor() then
            raise exception 'só o serviço de treino gera a prévia pelo link';
        end if;
        l := public.link_do_token_treino(token);
        select c2.* into c from public.treino_atribuicoes a
          join public.treino_cenarios c2 on c2.id = a.cenario_id
         where a.id = atribuicao and a.empresa_id = l.empresa_id and 'voz' = any (a.modos)
           and exists (select 1 from public.treino_atribuicao_operadores ao
                        where ao.atribuicao_id = a.id and ao.operador_id = l.operador_id);
        if c.id is null then
            raise exception 'treino não encontrado';
        end if;
        if (select count(*) from public.treino_link_acessos x
             where x.link_id = l.id and x.acao = 'ouvir' and x.em > now() - interval '1 hour') >= 6 then
            raise exception 'limite de prévias da voz: tente de novo em alguns minutos';
        end if;
        insert into public.treino_link_acessos (link_id, empresa_id, acao) values (l.id, l.empresa_id, 'ouvir');
        emp := l.empresa_id;
    else
        if empresa is null or not (public.cliente_pode(empresa, 'treinar_operadores')
                                   or public.cliente_pode(empresa, 'editar_cenarios_treino')) then
            raise exception 'sem permissão para o treino de operadores';
        end if;
        select * into c from public.treino_cenarios x
         where x.id = cenario and (x.empresa_id is null or x.empresa_id = empresa) and x.situacao <> 'arquivado';
        if c.id is null then
            raise exception 'cenário não encontrado';
        end if;
        emp := empresa;
    end if;
    if not public.treino_liberado(emp) then
        raise exception 'treinos indisponíveis';
    end if;
    frase := coalesce((select f from unnest(c.frases) f where char_length(trim(f)) between 3 and 200 limit 1),
                      'Alô? Quem está falando?');
    return jsonb_build_object('empresa', emp, 'voz_tts', c.voz_tts, 'frase', frase);
end $$;
comment on function public.treino_previa_voz(text, bigint, bigint, bigint) is
    '"Ouvir a voz" da cliente simulada: a voz do cenário e uma frase do roteiro fictício. Pelo link só com a chave do '
    'servidor (6 por hora, registrada em treino_link_acessos); logado, quem treina ou edita cenários. SQL 119.';

revoke all on function public.treino_contexto_sessao(bigint, text), public.treino_previa_voz(text, bigint, bigint, bigint)
    from public, anon;
grant execute on function public.treino_contexto_sessao(bigint, text), public.treino_previa_voz(text, bigint, bigint, bigint)
    to authenticated, service_role;
revoke all on function public.treino_meus(text) from public;
grant execute on function public.treino_meus(text) to anon, authenticated;
