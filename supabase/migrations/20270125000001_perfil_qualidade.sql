-- SQL 89 · Perfil "Qualidade": pessoa da empresa cliente que vê SÓ a área Speech Analytics (PR 1 do Roleplay de
-- treinamento de operadores, SPEC §3.1 e §10). Sem tabelas de treino e sem a aba Roleplay (vêm nos próximos PRs).
--
-- 1. papel ganha o valor 'qualidade'. As funções abaixo comparam papel::text = 'qualidade' (o valor novo do enum não
--    pode ser usado como literal na mesma transação em que nasce, e o APLICAR roda tudo numa transação só).
-- 2. permissoes_speech(): as permissões que existem dentro do Speech Analytics (ouvir_gravacoes, ver_transcricoes,
--    ver_operadores, ver_alertas, curadoria_voz, editar_checklist). permissoes_qualidade(): o padrão MotorCX do perfil
--    Qualidade (as mesmas, menos editar_checklist, que fica com o Admin, SPEC pergunta 11).
--    O catálogo permissoes_catalogo continua com 4 colunas (admin, planejamento, operacao, gestao), porque toda
--    migração que cria permissão recria a view com 4 booleanos: o padrão da Qualidade vem de permissao_padrao().
-- 3. pode(), pode_usuario(), permissoes_do_usuario() e permissoes_do_papel(): para a Qualidade, permissão fora de
--    permissoes_speech() é sempre "não", mesmo com ajuste do Admin (permissoes_papel/permissoes_usuario). O Admin
--    ajusta dentro do Speech (ex.: liberar editar_checklist); fora dele o banco recusa o ajuste (validar_permissao_*).
-- 4. minhas_empresas() deixa de devolver a empresa para a Qualidade. Toda policy, view e RPC de fora do Speech que
--    confere a empresa por ela (as 157 policies com minhas_empresas/cliente_pode/pode_ver_empresa, ve_faturamento,
--    pode_ver_slug do Storage, equipe_pode etc.) passa a negar a Qualidade sem mudar uma linha.
--    empresa_da_tela() (Início, pessoas_empresa, perfis_empresa, numeros_areas, para_hoje) também não cai mais na
--    empresa do perfil para a Qualidade.
-- 5. minhas_empresas_speech() = minhas_empresas() + a empresa da Qualidade. Usada só no que as telas do Speech leem:
--    - cliente_pode(empresa, perm): com perm de permissoes_speech(), vale a empresa do Speech (cobre as policies de
--      voz_avaliacoes, voz_alertas, voz_operadores, voz_treino_exemplos, voz_curadoria_itens, voz_golden_set,
--      voz_golden_medicoes, voz_melhorias e as RPCs alertas_voz, contagem_alertas_voz, revisar_alerta_voz,
--      reprovadas_voz, buscar_trechos_voz, resultado_busca_voz, contestar_nota_voz, curar_item_voz, salvar_melhoria_voz,
--      decidir_exemplo_treino, salvar_operador_voz, salvar_rascunho_checklist, publicar_checklist);
--    - policies: voz_gravacoes (ouvir dentro do Speech › Gravações, com ouvir_gravacoes), acessos (registrar a escuta:
--      a Qualidade só registra ouvir_gravacao/ler_transcricao), voz_insights_dia, voz_temas, checklists_qualidade,
--      checklist_versoes, recomendacoes, recomendacao_impacto e empresa_modulos (o site sabe se o Speech está
--      contratado; sem o módulo, a Qualidade vê "não faz parte do plano");
--    - RPCs recriadas inteiras (mesmo texto do SQL 60, só a conferência da empresa muda): painel_speech, qualidade_voz,
--      operadores_voz, operador_voz; e acesso_da_empresa (o aviso de empresa suspensa também aparece para ela);
--    - RPC nova carteiras_speech(empresa): id, código e nome das carteiras para o filtro do Speech (a Qualidade não lê
--      a tabela credores, que tem política, calendário e regras de retorno).
--    Continua só do Admin: buscas_recentes_voz, guardar_gravacao/soltar_gravacao, voz_buscas. Continua com a permissão
--    enviar_relatorio_credor: Relatório ao credor (a Qualidade não tem).
-- Pode rodar de novo (funções recriadas inteiras, policies com drop if exists). Nenhum perfil antigo muda de acesso:
-- para quem não é Qualidade, minhas_empresas_speech() = minhas_empresas() e pode() dá o mesmo resultado.
-- Depende dos SQL 60 (Speech), 56 (gravações) e 87 (módulo speech_analytics). Se o SQL 60 for rodado de novo um dia,
-- rode este de novo depois (ele recria as RPCs e policies do Speech com minhas_empresas()).

-- ================================================================ 1. o valor novo do papel
alter type public.papel add value if not exists 'qualidade';

-- ================================================================ 2. permissões do Speech e padrão da Qualidade
create or replace function public.permissoes_speech() returns text[]
language sql immutable set search_path = '' as $$
    select array['ouvir_gravacoes', 'ver_transcricoes', 'ver_operadores', 'ver_alertas', 'curadoria_voz', 'editar_checklist']
$$;
comment on function public.permissoes_speech() is
    'Permissões que existem dentro do Speech Analytics: as únicas que o perfil Qualidade pode ter (SQL 89).';

create or replace function public.permissoes_qualidade() returns text[]
language sql immutable set search_path = '' as $$
    select array['ouvir_gravacoes', 'ver_transcricoes', 'ver_operadores', 'ver_alertas', 'curadoria_voz']
$$;
comment on function public.permissoes_qualidade() is
    'Padrão MotorCX do perfil Qualidade (o Admin ajusta dentro de permissoes_speech()).';

revoke all on function public.permissoes_speech(), public.permissoes_qualidade() from public, anon;
grant execute on function public.permissoes_speech(), public.permissoes_qualidade() to authenticated, service_role;

create or replace function public.permissao_padrao(p public.papel, perm text) returns boolean
language sql stable set search_path = public as $$
    select case when p::text = 'qualidade' then perm = any (public.permissoes_qualidade())
                else coalesce((select case p when 'admin' then c.admin when 'planejamento' then c.planejamento
                                             when 'operacao' then c.operacao when 'gestao' then c.gestao end
                               from public.permissoes_catalogo c where c.codigo = perm), false) end
$$;

-- ================================================================ 3. pode(): a Qualidade nunca passa do Speech
create or replace function public.pode(perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.equipe and p.papel = 'admin' then true
                    when p.equipe and p.papel = 'planejamento'
                         and perm in ('enviar_arquivos', 'reenquadrar', 'editar_orquestracao', 'editar_credores',
                                      'editar_canais', 'gerenciar_usuarios', 'gerenciar_permissoes') then false
                    when not p.equipe and p.papel::text = 'qualidade' and not (perm = any (public.permissoes_speech())) then false
                    when p.papel = 'admin' and perm in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                    else coalesce((select pu.permitido from public.permissoes_usuario pu
                                   where pu.usuario_id = p.id and pu.permissao = perm),
                                  (select pp.permitido from public.permissoes_papel pp
                                   where pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = perm),
                                  public.permissao_padrao(p.papel, perm)) end
        from public.perfis p where p.id = auth.uid() and p.ativo), false)
$$;

create or replace function public.pode_usuario(uid uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.equipe and p.papel = 'admin' then true
                    when p.equipe and p.papel = 'planejamento'
                         and perm in ('enviar_arquivos', 'reenquadrar', 'editar_orquestracao', 'editar_credores',
                                      'editar_canais', 'gerenciar_usuarios', 'gerenciar_permissoes') then false
                    when not p.equipe and p.papel::text = 'qualidade' and not (perm = any (public.permissoes_speech())) then false
                    when p.papel = 'admin' and perm in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                    else coalesce((select pu.permitido from public.permissoes_usuario pu
                                   where pu.usuario_id = p.id and pu.permissao = perm),
                                  (select pp.permitido from public.permissoes_papel pp
                                   where pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = perm),
                                  public.permissao_padrao(p.papel, perm)) end
        from public.perfis p where p.id = uid and p.ativo), false)
$$;
revoke all on function public.pode_usuario(uuid, text) from public, anon, authenticated;
grant execute on function public.pode_usuario(uuid, text) to service_role;

create or replace function public.permissoes_do_usuario(uid uuid)
returns table (codigo text, permitido boolean, origem text)
language sql stable security definer set search_path = public as $$
    select c.codigo,
           case when p.equipe and p.papel = 'admin' then true
                when not p.equipe and p.papel::text = 'qualidade' and not (c.codigo = any (public.permissoes_speech())) then false
                when p.papel = 'admin' and c.codigo in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                else coalesce(pu.permitido, pp.permitido, public.permissao_padrao(p.papel, c.codigo)) end,
           case when pu.permitido is not null then 'usuario' when pp.permitido is not null then 'perfil'
                else 'padrao' end
    from public.perfis p
    cross join public.permissoes_catalogo c
    left join public.permissoes_usuario pu on pu.usuario_id = p.id and pu.permissao = c.codigo
    left join public.permissoes_papel pp on pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = c.codigo
    where p.id = $1
      and (p.id = auth.uid() or public.admin_equipe()
           or (public.pode('gerenciar_usuarios') and p.empresa_id in (select public.minhas_empresas())))
    order by c.ordem
$$;

create or replace function public.permissoes_do_papel(papel public.papel, empresa bigint default null)
returns table (codigo text, permitido boolean, origem text)
language sql stable security definer set search_path = public as $$
    select c.codigo,
           case when $1::text = 'qualidade' and not (c.codigo = any (public.permissoes_speech())) then false
                when $1 = 'admin' and c.codigo in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                else coalesce(pp.permitido, public.permissao_padrao($1, c.codigo)) end,
           case when pp.permitido is not null then 'perfil' else 'padrao' end
    from public.permissoes_catalogo c
    left join public.permissoes_papel pp
           on pp.empresa_id = coalesce($2, (select p.empresa_id from public.perfis p where p.id = auth.uid()))
          and pp.papel = $1 and pp.permissao = c.codigo
    where (public.pode('gerenciar_usuarios') or public.pode('gerenciar_permissoes'))
      and ($2 is null or $2 in (select public.minhas_empresas()))
    order by c.ordem
$$;

-- o Admin ajusta a Qualidade só dentro do Speech (fora dele o pode() já diz "não"; aqui a tela recebe o motivo)
create or replace function public.validar_permissao_papel() returns trigger
language plpgsql set search_path = public as $$
begin
    if not exists (select 1 from public.permissoes_catalogo where codigo = new.permissao) then
        raise exception 'permissão desconhecida: %', new.permissao;
    end if;
    if new.papel = 'admin' and new.permissao in ('gerenciar_usuarios', 'gerenciar_permissoes') and not new.permitido then
        raise exception 'o perfil Admin não pode perder %', new.permissao;   -- evita trancar a empresa para fora
    end if;
    if new.papel::text = 'qualidade' and new.permitido and not (new.permissao = any (public.permissoes_speech())) then
        raise exception 'o perfil Qualidade só tem acessos do Speech Analytics';
    end if;
    new.atualizado_em := now();
    new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
    return new;
end $$;

create or replace function public.validar_permissao_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    alvo public.perfis;
    grupo text;
begin
    select * into alvo from public.perfis where id = new.usuario_id;
    select c.grupo into grupo from public.permissoes_catalogo c where c.codigo = new.permissao;
    if grupo is null then
        raise exception 'permissão desconhecida: %', new.permissao;
    end if;
    new.empresa_id := alvo.empresa_id;              -- a empresa vem sempre do usuário
    if alvo.papel = 'admin' and new.permissao in ('gerenciar_usuarios', 'gerenciar_permissoes') and not new.permitido then
        raise exception 'o Admin não pode perder %', new.permissao;
    end if;
    if alvo.papel::text = 'qualidade' and not coalesce(alvo.equipe, false) and new.permitido
       and not (new.permissao = any (public.permissoes_speech())) then
        raise exception 'o perfil Qualidade só tem acessos do Speech Analytics';
    end if;
    if auth.uid() is not null then                  -- pelo site (a função de usuários valida do lado dela)
        if new.usuario_id = auth.uid() then
            raise exception 'ninguém altera os próprios acessos';
        end if;
        if grupo = 'Administração' and new.permitido and not public.tem_papel('admin') then
            raise exception 'só um Admin libera acessos de administração';
        end if;
        if alvo.papel = 'admin' and not public.tem_papel('admin') then
            raise exception 'só um Admin altera os acessos de outro Admin';
        end if;
    end if;
    new.atualizado_em := now();
    new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
    return new;
end $$;

-- ================================================================ 4. minhas_empresas() sem a Qualidade
create or replace function public.minhas_empresas() returns setof bigint
language sql stable security definer set search_path = public as $$
    with eu as (
        select p.id, p.equipe, p.empresa_id, p.papel, p.equipe_alcance,
               case when p.equipe then public.pode_equipe('ver_empresas') else false end as ve
          from public.perfis p where p.id = auth.uid() and p.ativo
           and (p.equipe or p.papel::text <> 'qualidade')     -- SQL 89: a Qualidade só vê o Speech (minhas_empresas_speech)
    )
    select e.id from public.empresas e, eu
     where (not eu.equipe and eu.empresa_id = e.id)
        or (eu.equipe and (eu.papel = 'admin'
                           or (eu.ve and (eu.equipe_alcance = 'todas' or e.vendedor_id = eu.id or e.gerente_id = eu.id))))
$$;

create or replace function public.empresa_da_tela(empresa bigint default null) returns bigint
language sql stable security definer set search_path = public as $$
    select coalesce(
        (select empresa where empresa in (select public.minhas_empresas())),
        (select p.empresa_id from public.perfis p where p.id = auth.uid() and p.ativo and not p.equipe
            and p.papel::text <> 'qualidade'))
$$;

-- ================================================================ 5. a empresa do Speech
create or replace function public.minhas_empresas_speech() returns setof bigint
language sql stable security definer set search_path = public as $$
    select public.minhas_empresas()
    union
    select p.empresa_id from public.perfis p
     where p.id = auth.uid() and p.ativo and not p.equipe and p.papel::text = 'qualidade' and p.empresa_id is not null
$$;
comment on function public.minhas_empresas_speech() is
    'minhas_empresas() + a empresa do perfil Qualidade: só para as tabelas e RPCs do Speech Analytics (SQL 89).';
revoke all on function public.minhas_empresas_speech() from public, anon;
grant execute on function public.minhas_empresas_speech() to authenticated, service_role;

-- pessoa ativa do cliente (não da equipe MotorCX), da empresa, com a permissão; permissão do Speech vale na empresa
-- do Speech (a Qualidade entra só por aqui)
create or replace function public.cliente_pode(eid bigint, perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select eid is not null and not public.sou_equipe() and public.pode(perm)
           and (eid in (select public.minhas_empresas())
                or (perm = any (public.permissoes_speech()) and eid in (select public.minhas_empresas_speech())))
$$;
revoke all on function public.cliente_pode(bigint, text) from public, anon;
grant execute on function public.cliente_pode(bigint, text) to authenticated;

create or replace function public.acesso_da_empresa(empresa bigint)
returns table (situacao text, bloqueada boolean, motivo text, desde timestamptz, liberada_ate date)
language sql stable security definer set search_path = public as $$
    select e.situacao, e.situacao in ('suspensa', 'encerrada', 'inadimplente'), e.situacao_motivo, e.situacao_em,
           e.liberada_ate
      from public.empresas e
     where e.id = empresa and e.id in (select public.minhas_empresas_speech())
$$;

-- carteiras para o filtro do Speech: só id, código e nome (a tabela credores fica com quem vê a Cobrança)
create or replace function public.carteiras_speech(empresa bigint)
returns table (id bigint, empresa_id bigint, codigo text, nome text, ativo boolean)
language sql stable security definer set search_path = public as $$
    select c.id, c.empresa_id, c.codigo, c.nome, c.ativo
      from public.credores c
     where c.empresa_id = empresa and empresa in (select public.minhas_empresas_speech())
     order by c.nome
$$;
revoke all on function public.carteiras_speech(bigint) from public, anon;
grant execute on function public.carteiras_speech(bigint) to authenticated;

-- ---------------------------------------------------------------- policies do Speech
drop policy if exists voz_gravacoes_ver on public.voz_gravacoes;
create policy voz_gravacoes_ver on public.voz_gravacoes for select to authenticated
    using (public.admin_equipe()
           or (empresa_id in (select public.minhas_empresas_speech()) and not public.sou_equipe()
               and public.pode('ouvir_gravacoes')));

drop policy if exists registrar_acesso on public.acessos;
create policy registrar_acesso on public.acessos for insert to authenticated
    with check (public.meu_papel() is not null and usuario = auth.uid()
                and (empresa_id is null or empresa_id in (select public.minhas_empresas())
                     or (acao in ('ouvir_gravacao', 'ler_transcricao')
                         and empresa_id in (select public.minhas_empresas_speech()))));

drop policy if exists voz_insights_ver on public.voz_insights_dia;
create policy voz_insights_ver on public.voz_insights_dia for select to authenticated
    using (empresa_id in (select public.minhas_empresas_speech()));

drop policy if exists voz_temas_ver on public.voz_temas;
create policy voz_temas_ver on public.voz_temas for select to authenticated
    using (empresa_id in (select public.minhas_empresas_speech()));

drop policy if exists checklists_qualidade_ver on public.checklists_qualidade;
create policy checklists_qualidade_ver on public.checklists_qualidade for select to authenticated
    using (empresa_id is null or empresa_id in (select public.minhas_empresas_speech()));

drop policy if exists checklist_versoes_ver on public.checklist_versoes;
create policy checklist_versoes_ver on public.checklist_versoes for select to authenticated
    using (exists (select 1 from public.checklists_qualidade c where c.id = checklist_id
                    and (c.empresa_id is null or c.empresa_id in (select public.minhas_empresas_speech()))));

drop policy if exists recomendacoes_ver on public.recomendacoes;
create policy recomendacoes_ver on public.recomendacoes for select to authenticated
    using (empresa_id in (select public.minhas_empresas_speech()));

drop policy if exists recomendacao_impacto_ver on public.recomendacao_impacto;
create policy recomendacao_impacto_ver on public.recomendacao_impacto for select to authenticated
    using (exists (select 1 from public.recomendacoes r where r.id = rec_id
                    and r.empresa_id in (select public.minhas_empresas_speech())));

drop policy if exists empresa_modulos_ver on public.empresa_modulos;
create policy empresa_modulos_ver on public.empresa_modulos for select to authenticated
    using (empresa_id in (select public.minhas_empresas_speech()));

-- ---------------------------------------------------------------- RPCs do Speech (SQL 60, inteiras)
create or replace function public.painel_speech(empresa bigint, credor bigint, de date, ate date,
                                                origem text default null, persona text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    n bigint;
    res jsonb;
    inicio_sem date := date_trunc('week', ate::timestamp)::date - 7 * 12;    -- 12 semanas completas
begin
    if empresa is null or empresa not in (select public.minhas_empresas_speech()) then
        raise exception 'sem acesso a esta empresa';
    end if;
    select coalesce(sum(q.avaliadas), 0) into n from public.voz_qualidade_dia q
     where q.empresa_id = empresa and q.item = '_ligacao' and q.data between de and ate
       and (credor is null or q.credor_id = credor) and (painel_speech.origem is null or q.origem = painel_speech.origem)
       and (painel_speech.persona is null or q.persona = painel_speech.persona);
    if n < 30 then
        return jsonb_build_object('n', null, 'pequeno', n > 0);
    end if;
    with q as (
        select * from public.voz_qualidade_dia x
         where x.empresa_id = empresa and x.data between de and ate and (credor is null or x.credor_id = credor)
           and (painel_speech.origem is null or x.origem = painel_speech.origem)
           and (painel_speech.persona is null or x.persona = painel_speech.persona)),
    lig as (select origem, sum(avaliadas) av, sum(aprovadas) ap, sum(nota_soma) ns from q where item = '_ligacao' group by rollup (origem)),
    cv as (
        select * from public.voz_conversao_dia x
         where x.empresa_id = empresa and x.data between de and ate and (credor is null or x.credor_id = credor)
           and (painel_speech.origem is null or x.origem = painel_speech.origem)
           and (painel_speech.persona is null or x.persona = painel_speech.persona)),
    au as (
        select * from public.voz_audio_dia x
         where x.empresa_id = empresa and x.data between de and ate and (credor is null or x.credor_id = credor)
           and (painel_speech.origem is null or x.origem = painel_speech.origem)
           and (painel_speech.persona is null or x.persona = painel_speech.persona)),
    tot as (select sum(conversas) c, sum(com_acordo) a from cv where dimensao = 'total'),
    ident as (select sum(conversas) c from cv where dimensao = 'funil' and valor = 'identidade'),
    sem as (
        select date_trunc('week', x.data::timestamp)::date s, x.origem, sum(x.avaliadas) av, sum(x.aprovadas) ap, sum(x.nota_soma) ns
          from public.voz_qualidade_dia x
         where x.empresa_id = empresa and x.item = '_ligacao' and x.data >= inicio_sem and x.data < date_trunc('week', ate::timestamp)::date
           and (credor is null or x.credor_id = credor) and (painel_speech.origem is null or x.origem = painel_speech.origem)
           and (painel_speech.persona is null or x.persona = painel_speech.persona)
         group by 1, 2),
    semc as (
        select date_trunc('week', x.data::timestamp)::date s, x.origem, sum(x.conversas) c, sum(x.com_acordo) a
          from public.voz_conversao_dia x
         where x.empresa_id = empresa and x.dimensao = 'total' and x.data >= inicio_sem and x.data < date_trunc('week', ate::timestamp)::date
           and (credor is null or x.credor_id = credor) and (painel_speech.origem is null or x.origem = painel_speech.origem)
           and (painel_speech.persona is null or x.persona = painel_speech.persona)
         group by 1, 2),
    sems as (
        select date_trunc('week', x.data::timestamp)::date s, x.origem, sum(x.com_sentimento) c, sum(x.melhorou) m
          from public.voz_audio_dia x
         where x.empresa_id = empresa and x.data >= inicio_sem and x.data < date_trunc('week', ate::timestamp)::date
           and (credor is null or x.credor_id = credor) and (painel_speech.origem is null or x.origem = painel_speech.origem)
           and (painel_speech.persona is null or x.persona = painel_speech.persona)
         group by 1, 2),
    heat as (
        select x.credor_id, x.valor, sum(x.conversas) c, sum(x.com_acordo) a,
               sum(sum(x.conversas)) over (partition by x.credor_id) tc
          from public.voz_conversao_dia x
         where x.empresa_id = empresa and x.dimensao = 'motivo' and x.data between de and ate
           and (painel_speech.origem is null or x.origem = painel_speech.origem)
           and (painel_speech.persona is null or x.persona = painel_speech.persona)
         group by 1, 2),
    dims as (select dimensao, valor, sum(conversas) c, sum(com_acordo) a from cv where dimensao in ('motivo', 'objecao', 'frase', 'oferta', 'funil') group by 1, 2),
    temas as (
        select t.id, t.nome,
               sum(w.conversas) filter (where w.semana >= date_trunc('week', ate::timestamp)::date - 28) recente,
               sum(w.conversas) filter (where w.semana < date_trunc('week', ate::timestamp)::date - 28) anterior,
               jsonb_agg(jsonb_build_object('s', w.semana, 'c', w.conversas) order by w.semana) serie
          from public.voz_temas t join public.voz_temas_semana w on w.tema_id = t.id
         where t.empresa_id = empresa and t.situacao <> 'descartado' and (credor is null or w.credor_id = credor)
           and w.semana >= date_trunc('week', ate::timestamp)::date - 56 and w.semana < date_trunc('week', ate::timestamp)::date
         group by t.id, t.nome)
    select jsonb_build_object(
        'n', n,
        'por_origem', (select jsonb_object_agg(origem, case when av >= 30 then av end) from lig where origem is not null),
        'identidade_pct', public.pct30((select c from ident), n),
        'nota', (select case when av >= 30 then round(ns / av, 1) end from lig where origem is null),
        'conformidade', (select public.pct30(ap, av) from lig where origem is null),
        'conversao', (select public.pct30(a, c) from tot),
        'sentimento', (select case when sum(com_sentimento) >= 30 then jsonb_build_object(
                           'ini', round(sum(sentimento_ini) / sum(com_sentimento), 2),
                           'fim', round(sum(sentimento_fim) / sum(com_sentimento), 2),
                           'melhorou_pct', public.pct30(sum(melhorou), sum(com_sentimento))) end from au),
        'audio', (select case when sum(ligacoes) >= 30 then jsonb_build_object(
                      'fala_agente_s', round(sum(fala_agente_s)::numeric / sum(ligacoes)),
                      'fala_cliente_s', round(sum(fala_cliente_s)::numeric / sum(ligacoes)),
                      'silencio_s', round(sum(silencio_s)::numeric / sum(ligacoes)),
                      'interrupcoes', round(sum(interrupcoes)::numeric / sum(ligacoes), 1)) end from au),
        'origens', (select jsonb_object_agg(o.origem, jsonb_build_object(
                        'n', case when o.av >= 30 then o.av end,
                        'nota', case when o.av >= 30 then round(o.ns / o.av, 1) end,
                        'conformidade', public.pct30(o.ap, o.av),
                        'conversao', (select public.pct30(sum(com_acordo), sum(conversas)) from cv where cv.dimensao = 'total' and cv.origem = o.origem),
                        'sentimento_melhorou', (select public.pct30(sum(melhorou), sum(com_sentimento)) from au where au.origem = o.origem),
                        'itens', (select jsonb_object_agg(i.item, public.pct30(i.ap, i.av - i.na))
                                    from (select item, sum(avaliadas) av, sum(aprovadas) ap, sum(na) na from q
                                           where q.origem = o.origem and item in ('ck_cpc', 'ck_oferta', 'ck_canais') group by item) i)))
                      from lig o where o.origem is not null),
        'semanas', (select coalesce(jsonb_agg(jsonb_build_object(
                        's', s.s, 'origem', s.origem, 'n', case when s.av >= 30 then s.av end,
                        'nota', case when s.av >= 30 then round(s.ns / s.av, 1) end, 'conformidade', public.pct30(s.ap, s.av),
                        'conversao', (select public.pct30(c.a, c.c) from semc c where c.s = s.s and c.origem = s.origem),
                        'sentimento', (select public.pct30(m.m, m.c, 0) from sems m where m.s = s.s and m.origem = s.origem))
                        order by s.s, s.origem), '[]'::jsonb) from sem s),
        'mapa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'credor_id', h.credor_id, 'credor', (select cr.nome from public.credores cr where cr.id = h.credor_id),
                     'motivo', h.valor, 'n', case when h.c >= 30 then h.c end,
                     'parte', case when h.c >= 30 then public.pct30(h.c, h.tc) end, 'conversao', public.pct30(h.a, h.c))
                     order by h.credor_id, h.valor), '[]'::jsonb) from heat h),
        'funil', (select coalesce(jsonb_object_agg(d.valor, case when d.c >= 30 then d.c end), '{}'::jsonb) from dims d where d.dimensao = 'funil'),
        'motivos', (select coalesce(jsonb_agg(jsonb_build_object('valor', d.valor, 'n', case when d.c >= 30 then d.c end,
                        'parte', public.pct30(d.c, (select sum(x.c) from dims x where x.dimensao = 'motivo')),
                        'conversao', public.pct30(d.a, d.c)) order by d.c desc), '[]'::jsonb) from dims d where d.dimensao = 'motivo'),
        'objecoes', (select coalesce(jsonb_agg(jsonb_build_object('valor', d.valor, 'n', case when d.c >= 30 then d.c end,
                        'parte', public.pct30(d.c, (select sum(x.c) from dims x where x.dimensao = 'objecao')),
                        'conversao', public.pct30(d.a, d.c)) order by d.c desc), '[]'::jsonb) from dims d where d.dimensao = 'objecao'),
        'converte', (select coalesce(jsonb_agg(jsonb_build_object('tipo', d.dimensao, 'valor', d.valor,
                        'com_acordo', public.pct30(d.a, (select a from tot)),
                        'sem_acordo', public.pct30(d.c - d.a, (select c - a from tot))) order by d.a desc), '[]'::jsonb)
                       from dims d where d.dimensao in ('frase', 'oferta') and d.c >= 30),
        'temas', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome,
                      'n', case when t.recente >= 30 then t.recente end,
                      'crescimento', case when t.recente >= 30 and t.anterior >= 30 then round(100.0 * (t.recente - t.anterior) / t.anterior) end,
                      'serie', case when t.recente >= 30 then t.serie end) order by t.recente desc nulls last), '[]'::jsonb) from temas t),
        'alertas', (select jsonb_build_object('total', count(*), 'abertos', count(*) filter (where a.situacao = 'novo'),
                        'vulnerabilidade', count(*) filter (where a.tipo = 'vulnerabilidade'),
                        'procon_juridico', count(*) filter (where a.tipo in ('procon', 'juridico')))
                      from public.voz_alertas a where a.empresa_id = empresa and (credor is null or a.credor_id = credor)
                       and (painel_speech.origem is null or a.origem = painel_speech.origem)
                       and (a.criado_em at time zone 'America/Sao_Paulo')::date between de and ate))
    into res;
    return res;
end $$;

create or replace function public.qualidade_voz(empresa bigint, credor bigint, de date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare res jsonb;
begin
    if empresa is null or empresa not in (select public.minhas_empresas_speech()) then
        raise exception 'sem acesso a esta empresa';
    end if;
    with q as (select * from public.voz_qualidade_dia x where x.empresa_id = empresa and x.data between de and ate
                  and (credor is null or x.credor_id = credor)),
    lig as (select origem, sum(avaliadas) av, sum(aprovadas) ap, sum(nota_soma) ns from q where item = '_ligacao' group by rollup (origem)),
    it as (select item, origem, sum(avaliadas) av, sum(aprovadas) ap, sum(na) na from q where item <> '_ligacao' group by 1, 2),
    sem as (select date_trunc('week', x.data::timestamp)::date s, x.origem, sum(x.avaliadas) av, sum(x.aprovadas) ap
              from public.voz_qualidade_dia x
             where x.empresa_id = empresa and x.item = '_ligacao' and (credor is null or x.credor_id = credor)
               and x.data >= date_trunc('week', ate::timestamp)::date - 84 and x.data < date_trunc('week', ate::timestamp)::date
             group by 1, 2)
    select jsonb_build_object(
        'n', (select case when av >= 30 then av end from lig where origem is null),
        'nota', (select case when av >= 30 then round(ns / av, 1) end from lig where origem is null),
        'conformidade', (select public.pct30(ap, av) from lig where origem is null),
        'origens', (select coalesce(jsonb_object_agg(origem, jsonb_build_object('n', case when av >= 30 then av end,
                        'nota', case when av >= 30 then round(ns / av, 1) end, 'conformidade', public.pct30(ap, av),
                        'reprovadas', case when av >= 30 then av - ap end)), '{}'::jsonb) from lig where origem is not null),
        'itens', (select coalesce(jsonb_object_agg(item, x), '{}'::jsonb) from (
                     select item, jsonb_object_agg(origem, jsonb_build_object('n', case when av >= 30 then av end,
                                'aprovado', public.pct30(ap, av - na))) x from it group by item) y),
        'semanas', (select coalesce(jsonb_agg(jsonb_build_object('s', s, 'origem', origem, 'conformidade', public.pct30(ap, av))
                        order by s, origem), '[]'::jsonb) from sem),
        'contestadas', (select case when count(*) >= 30 then round(100.0 * count(*) filter (where a.contestada_em is not null) / count(*), 1) end
                          from public.voz_avaliacoes a where a.empresa_id = empresa and (credor is null or a.credor_id = credor)
                           and (a.avaliada_em at time zone 'America/Sao_Paulo')::date between de and ate))
    into res;
    return res;
end $$;

create or replace function public.operadores_voz(empresa bigint, credor bigint, de date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    gestor boolean := public.cliente_pode(empresa, 'ver_operadores');
    meu text := (select o.operador_ref from public.voz_operadores o where o.empresa_id = empresa and o.usuario_id = auth.uid()
                  and o.ativo limit 1);
    res jsonb;
begin
    if empresa is null or empresa not in (select public.minhas_empresas_speech()) or (not gestor and meu is null) then
        raise exception 'a nota por operador exige a permissão ver_operadores';
    end if;
    with q as (select * from public.voz_qualidade_dia x where x.empresa_id = empresa and x.origem = 'discador'
                  and x.data between de and ate and (credor is null or x.credor_id = credor)),
    ops as (select operador_ref, sum(avaliadas) av, sum(nota_soma) ns from q where item = '_ligacao' and operador_ref <> '' group by 1),
    eq as (select sum(avaliadas) av, sum(nota_soma) ns from q where item = '_ligacao'),
    eqi as (select item, sum(avaliadas) av, sum(aprovadas) ap, sum(na) na from q where item <> '_ligacao' group by 1)
    select jsonb_build_object(
        'gestor', gestor,
        'humanas', (select case when av >= 30 then av end from eq),
        'sem_operador', (select coalesce(sum(av), 0) from (select sum(avaliadas) av from q where item = '_ligacao' and operador_ref = '') z),
        'sem_operador_import', (select coalesce(sum(e.sem_operador), 0) from public.voz_import_execucoes e
                                 where e.empresa_id = empresa and (e.iniciada_em at time zone 'America/Sao_Paulo')::date between de and ate),
        'equipe', jsonb_build_object('nota', (select case when av >= 30 then round(ns / av, 1) end from eq),
                     'itens', (select coalesce(jsonb_object_agg(item, public.pct30(ap, av - na)), '{}'::jsonb) from eqi)),
        'operadores', (select coalesce(jsonb_agg(jsonb_build_object(
                          'ref', o.operador_ref, 'apelido', vo.apelido, 'n', o.av,
                          'nota', case when o.av >= 30 then round(o.ns / o.av, 1) end) order by coalesce(vo.apelido, o.operador_ref)), '[]'::jsonb)
                         from ops o left join public.voz_operadores vo on vo.empresa_id = empresa and vo.operador_ref = o.operador_ref
                        where gestor or o.operador_ref = meu),
        'exemplos', case when gestor then (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'tag', e.tag, 'nota', e.nota,
                          'duracao_s', e.duracao_s, 'trecho', e.trecho_redigido, 'situacao', e.situacao,
                          'operador', e.operador_ref || coalesce(' · ' || vo.apelido, '')) order by e.criado_em desc), '[]'::jsonb)
                         from (select * from public.voz_treino_exemplos x where x.empresa_id = empresa and x.situacao <> 'recusado'
                                 order by x.criado_em desc limit 20) e
                         left join public.voz_operadores vo on vo.empresa_id = empresa and vo.operador_ref = e.operador_ref) end)
    into res;
    return res;
end $$;

create or replace function public.operador_voz(empresa bigint, operador text, de date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    gestor boolean := public.cliente_pode(empresa, 'ver_operadores');
    res jsonb;
begin
    if empresa is null or empresa not in (select public.minhas_empresas_speech())
       or not (gestor or exists (select 1 from public.voz_operadores o where o.empresa_id = empresa
                                  and o.operador_ref = operador and o.usuario_id = auth.uid())) then
        raise exception 'a nota por operador exige a permissão ver_operadores';
    end if;
    with q as (select * from public.voz_qualidade_dia x where x.empresa_id = empresa and x.origem = 'discador'
                  and x.data between de and ate),
    eu as (select item, sum(avaliadas) av, sum(aprovadas) ap, sum(na) na, sum(nota_soma) ns from q where operador_ref = operador group by 1),
    eq as (select item, sum(avaliadas) av, sum(aprovadas) ap, sum(na) na, sum(nota_soma) ns from q group by 1),
    sem as (select date_trunc('week', x.data::timestamp)::date s, sum(x.avaliadas) av, sum(x.nota_soma) ns
              from public.voz_qualidade_dia x
             where x.empresa_id = empresa and x.origem = 'discador' and x.operador_ref = operador and x.item = '_ligacao'
               and x.data >= date_trunc('week', ate::timestamp)::date - 56 and x.data < date_trunc('week', ate::timestamp)::date
             group by 1)
    select jsonb_build_object(
        'ref', operador,
        'apelido', (select o.apelido from public.voz_operadores o where o.empresa_id = empresa and o.operador_ref = operador),
        'n', (select av from eu where item = '_ligacao'),
        'nota', (select case when av >= 30 then round(ns / av, 1) end from eu where item = '_ligacao'),
        'equipe', (select case when av >= 30 then round(ns / av, 1) end from eq where item = '_ligacao'),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('item', e.item, 'operador', public.pct30(e.ap, e.av - e.na),
                      'equipe', public.pct30(t.ap, t.av - t.na)) order by e.item), '[]'::jsonb)
                    from eu e join eq t on t.item = e.item
                   where e.item <> '_ligacao' and (select av from eu where item = '_ligacao') >= 30),
        'semanas', (select coalesce(jsonb_agg(jsonb_build_object('s', s, 'nota', case when av >= 30 then round(ns / av, 1) end) order by s), '[]'::jsonb) from sem),
        'conversar', case when public.pode('ver_transcricoes') then (
                        select coalesce(jsonb_agg(jsonb_build_object('avaliacao_id', a.id, 'item', a.item_reprovado,
                                   'em', a.avaliada_em, 'trecho', a.trecho_redigido) order by a.avaliada_em desc), '[]'::jsonb)
                          from (select * from public.voz_avaliacoes v where v.empresa_id = empresa and v.operador_ref = operador
                                  and v.reprovada and (v.avaliada_em at time zone 'America/Sao_Paulo')::date between de and ate
                                order by v.avaliada_em desc limit 5) a) end)
    into res;
    return res;
end $$;

revoke all on function public.painel_speech(bigint, bigint, date, date, text, text), public.qualidade_voz(bigint, bigint, date, date),
    public.operadores_voz(bigint, bigint, date, date), public.operador_voz(bigint, text, date, date) from public, anon;
grant execute on function public.painel_speech(bigint, bigint, date, date, text, text), public.qualidade_voz(bigint, bigint, date, date),
    public.operadores_voz(bigint, bigint, date, date), public.operador_voz(bigint, text, date, date) to authenticated;

do $conta$
declare n int;
begin
    select count(*) into n from public.perfis where papel::text = 'qualidade' and ativo and not equipe;
    raise notice 'SQL 89: % pessoa(s) com o perfil Qualidade (no começo, 0)', n;
end $conta$;
