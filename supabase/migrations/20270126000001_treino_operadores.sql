-- SQL 90 · Roleplay de treinamento de operadores: o banco do treino (PR 2 do Roleplay, SPEC §3.2, §4, §8, §9 e §10).
-- Só banco: tabelas, RLS, sementes MotorCX, retenção, cobrança e as RPCs que as telas e o serviço de treino vão usar
-- (telas nos próximos PRs). Operador humano treina com cliente simulado por IA; a nota vem do checklist do Speech.
--
-- 1. Permissões novas no catálogo: treinar_operadores (atribuir treinos, links, ver sessões, feedback) e
--    editar_cenarios_treino (biblioteca de cenários). Padrão: Admin sim; Planejamento, Operação e Gestão não;
--    Qualidade sim (permissoes_qualidade). As duas entram em permissoes_speech(), então cliente_pode() vale na empresa do
--    Speech para a Qualidade (SQL 89). permissoes_speech/permissoes_qualidade recriadas inteiras.
-- 2. voz_operadores: + equipe_id (treino_equipes), + so_treino; operador_ref passa a ser opcional SÓ para operador de
--    treino (check: operador_ref is not null or so_treino). O unique (empresa_id, operador_ref) continua (nulos não
--    colidem); o motor e as RPCs do Speech só cruzam por operador_ref = x, que nunca casa com nulo.
-- 3. Tabelas (todas com empresa_id, RLS, escrita só por RPC security definer com search_path fixo, nada para anon):
--    treino_equipes · treino_cenarios (empresa nula = Padrão MotorCX, só leitura; persona sempre "(fictícia/o)", textos
--    sem CPF/telefone/e-mail, insights só códigos e porcentagens com base >= 30) · treino_atribuicoes ·
--    treino_atribuicao_operadores (tentativas_usadas, tentativas_extra, melhor_nota) · treino_links (só o sha-256 do
--    token, validade, revogação; um ativo por operador; o hash não sai nem para quem vê o link) · treino_link_acessos
--    (sem IP, sem token) · treino_sessoes (em_andamento/abandonada/avaliada/falhou; só "avaliada" conta tentativa) ·
--    treino_transcricoes e treino_feedback (apagados em 90 dias por apagar_voz_expirada; teste da Qualidade em 1 dia) ·
--    treino_feedbacks (1:1) · treino_revisoes · treino_discordancias · treino_sugestoes (motivo da dispensa) ·
--    treino_uso_mes (minutos de voz e sessões de texto do mês, para a franquia).
--    Nota de treino NUNCA vai para voz_avaliacoes/voz_qualidade_dia. Áudio nunca é guardado (não há coluna para isso).
-- 4. Quem vê: cliente_pode(empresa, 'treinar_operadores') (Admin e Qualidade da empresa; Qualidade só pela empresa do
--    Speech). Cenários: também editar_cenarios_treino; os Padrão MotorCX para quem tem uma das duas.
-- 5. Operador sem login: link pessoal. anon só chama treino_meus, treino_iniciar, treino_resultado, treino_sair e
--    treino_discordar, que recebem o token (64 hex), conferem o hash, a validade, a revogação, o operador ativo e o
--    módulo speech_analytics, e devolvem só os treinos daquele operador. Cada chamada vai para treino_link_acessos.
-- 6. RPCs da Qualidade/Admin: salvar_equipe_treino, salvar_operador_treino, salvar_cenario_treino,
--    duplicar_cenario_treino, atribuir_treino, liberar_tentativa_treino, estender_prazo_treino, gerar_link_treino,
--    revogar_link_treino, iniciar_treino_lado_a_lado, testar_cenario_treino, revisar_sessao_treino,
--    salvar_feedback_treino, resolver_discordancia_treino, dispensar_sugestao_treino, uso_treino.
--    Do serviço de treino (service_role): registrar_sessao_treino (resultado, transcrição, feedback, tentativas, uso e
--    cobrança). Toda RPC confere o módulo speech_analytics ativo (sem ele, os links param de abrir).
-- 7. Cobrança: itens ia_treino_voz (minuto) e ia_treino_texto (sessão), módulo speech_analytics, com franquia mensal
--    (cobranca_itens.franquia_padrao, ou precos_empresa.franquia da empresa, SQL 78): 1.000 min de voz e 300 sessões
--    de texto. O custo real vai para consumo_ia (registrar_consumo_ia, só o Master vê); na fatura (consumo_mensageria)
--    entra só o que passou da franquia. Voz acabou: voz bloqueia, texto segue; aviso no sino a 80% e 100%.
--    Sessão abandonada é cobrada (a IA rodou) mas não conta tentativa; sessão que falhou (rede, microfone, serviço)
--    não conta nem é cobrada. Teste da Qualidade conta no saldo.
-- 8. apagar_voz_expirada() recriada inteira (mesmo texto de hoje: SQL 56, 58, 59 e 65) + transcrição e feedback do
--    treino vencidos. A última linha (o return) fica igual, porque o SQL 58, 59 e 65 rodados de novo procuram por ela.
-- Pode rodar de novo (tabelas if not exists, funções recriadas inteiras, policies com drop if exists, sementes por
-- código). Depende dos SQL 56, 59, 60, 61, 78, 87 e 89.

-- ================================================================ 1. permissões
do $perm$
declare
    def text;
    prox int;
    p record;
begin
    for p in select * from (values
        ('treinar_operadores', 'Treinar operadores',
         'Roleplay: atribuir treinos, gerar links de treino, ver sessões e notas do treino e registrar o feedback 1:1.'),
        ('editar_cenarios_treino', 'Editar cenários de treino',
         'Roleplay: criar, duplicar e publicar os cenários (clientes simulados) da empresa.')) v(codigo, nome, descricao)
    loop
        if not exists (select 1 from public.permissoes_catalogo c where c.codigo = p.codigo) then
            def := rtrim(btrim(pg_get_viewdef('public.permissoes_catalogo'::regclass)), ';');
            prox := coalesce((select max(ordem) from public.permissoes_catalogo), 0) + 1;
            execute format('create or replace view public.permissoes_catalogo as %s union all select %L::text, %L::text, '
                           '%L::text, %L::text, true, false, false, false, %s', def, p.codigo, 'Agente virtual', p.nome,
                           p.descricao, prox);
        end if;
    end loop;
end $perm$;
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

create or replace function public.permissoes_speech() returns text[]
language sql immutable set search_path = '' as $$
    select array['ouvir_gravacoes', 'ver_transcricoes', 'ver_operadores', 'ver_alertas', 'curadoria_voz', 'editar_checklist',
                 'treinar_operadores', 'editar_cenarios_treino']
$$;
comment on function public.permissoes_speech() is
    'Permissões que existem dentro do Speech Analytics: as únicas que o perfil Qualidade pode ter (SQL 89; treino no SQL 90).';

create or replace function public.permissoes_qualidade() returns text[]
language sql immutable set search_path = '' as $$
    select array['ouvir_gravacoes', 'ver_transcricoes', 'ver_operadores', 'ver_alertas', 'curadoria_voz',
                 'treinar_operadores', 'editar_cenarios_treino']
$$;
comment on function public.permissoes_qualidade() is
    'Padrão MotorCX do perfil Qualidade (o Admin ajusta dentro de permissoes_speech()). SQL 89; treino no SQL 90.';
revoke all on function public.permissoes_speech(), public.permissoes_qualidade() from public, anon;
grant execute on function public.permissoes_speech(), public.permissoes_qualidade() to authenticated, service_role;

-- ================================================================ 2. listas e checks (só ficção, nada de cliente real)
-- tipo de cliente do treino: os perfis do roleplay do agente, com "quer falar com o supervisor" no lugar de quer_humano
create or replace function public.perfis_treino() returns text[]
language sql immutable parallel safe set search_path = '' as $$
    select array['desempregado_recente', 'ja_pagou', 'contesta_procon', 'idoso_dificuldade', 'irritado',
                 'quer_parcelar_muito', 'terceiro_atende', 'nao_me_ligue', 'quer_supervisor', 'negocia_rapido', 'outro']::text[]
$$;

-- textos curtos do cenário: sem CPF, telefone, e-mail, 8+ dígitos seguidos
create or replace function public.textos_treino_ok(t text[], n int, tam int) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(cardinality(t) <= n
                    and not exists (select 1 from unnest(t) x
                                     where x is null or char_length(trim(x)) not between 1 and tam
                                        or not public.texto_mascarado_ok(x) or x ~ '@'), false)
$$;

-- objeções na ordem: [{codigo, quando}]
create or replace function public.objecoes_treino_ok(j jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(jsonb_typeof(j) = 'array' and jsonb_array_length(j) <= 10
           and not exists (select 1 from jsonb_array_elements(j) x
                            where case when jsonb_typeof(x) <> 'object' then true
                                       else exists (select 1 from jsonb_object_keys(x) k where k not in ('codigo', 'quando'))
                                            or coalesce(x ->> 'codigo', '') !~ '^[a-z][a-z0-9_]{1,40}$'
                                            or (x ? 'quando' and (jsonb_typeof(x -> 'quando') <> 'string'
                                                                  or char_length(x ->> 'quando') > 120
                                                                  or not public.texto_mascarado_ok(x ->> 'quando')
                                                                  or (x ->> 'quando') ~ '@')) end), false)
$$;

-- dívida fictícia: {produto, faixa, dias_atraso, alcada: {parcelas, desconto_max}}. O valor é sorteado na faixa pelo
-- serviço na hora do treino; nunca fica gravado um valor de cliente.
create or replace function public.divida_treino_ok(j jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(jsonb_typeof(j) = 'object'
           and not exists (select 1 from jsonb_object_keys(j) k where k not in ('produto', 'faixa', 'dias_atraso', 'alcada'))
           and (not j ? 'produto' or (jsonb_typeof(j -> 'produto') = 'string' and char_length(trim(j ->> 'produto')) between 2 and 60
                                      and public.texto_mascarado_ok(j ->> 'produto') and (j ->> 'produto') !~ '@'))
           and (not j ? 'faixa' or (j ->> 'faixa') in ('ate_1k', '1k_5k', '5k_mais'))
           and (not j ? 'dias_atraso' or (jsonb_typeof(j -> 'dias_atraso') = 'number'
                                          and (j ->> 'dias_atraso')::numeric between 1 and 3650))
           and (not j ? 'alcada' or (jsonb_typeof(j -> 'alcada') = 'object'
                and not exists (select 1 from jsonb_object_keys(j -> 'alcada') k where k not in ('parcelas', 'desconto_max'))
                and (not (j -> 'alcada') ? 'parcelas' or (jsonb_typeof(j -> 'alcada' -> 'parcelas') = 'number'
                                                          and (j -> 'alcada' ->> 'parcelas')::numeric between 1 and 120))
                and (not (j -> 'alcada') ? 'desconto_max' or (jsonb_typeof(j -> 'alcada' -> 'desconto_max') = 'number'
                                                              and (j -> 'alcada' ->> 'desconto_max')::numeric between 0 and 100)))),
           false)
$$;

-- insights do cenário gerado de padrões: só códigos e porcentagens, base (ligações) >= 30, período em ISO
create or replace function public.insights_treino_ok(j jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select j is null or coalesce(jsonb_typeof(j) = 'object' and octet_length(j::text) <= 4000
           and jsonb_typeof(j -> 'base') = 'number' and (j ->> 'base')::numeric >= 30
           and not exists (select 1 from jsonb_each(j) e
                            where case when e.key in ('de', 'ate')
                                       then jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$'
                                       else e.key !~ '^[a-z_]{2,30}(:[a-z0-9_]{1,40})?$' or jsonb_typeof(e.value) <> 'number' end),
           false)
$$;

-- transcrição do treino: [{quem: persona|operador, texto <= 600 mascarado, t (segundos)?}]
create or replace function public.transcricao_treino_ok(j jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(jsonb_typeof(j) = 'array' and jsonb_array_length(j) <= 400 and octet_length(j::text) <= 200000
           and j::text !~ '[0-9]{9,}' and j::text !~ '@'
           and not exists (select 1 from jsonb_array_elements(j) x
                            where case when jsonb_typeof(x) <> 'object' then true
                                       else exists (select 1 from jsonb_object_keys(x) k where k not in ('quem', 'texto', 't'))
                                            or coalesce(x ->> 'quem', '') not in ('persona', 'operador')
                                            or jsonb_typeof(x -> 'texto') is distinct from 'string'
                                            or char_length(x ->> 'texto') > 600
                                            or not public.texto_mascarado_ok(x ->> 'texto')
                                            or (x ? 't' and jsonb_typeof(x -> 't') <> 'number') end), false)
$$;

-- respostas do checklist (mesmo formato de voz_avaliacoes.itens / evidencia)
create or replace function public.itens_treino_ok(j jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(jsonb_typeof(j) = 'object'
           and not exists (select 1 from jsonb_each(j) e
                            where e.key !~ '^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(e.value) <> 'string'
                               or (e.value #>> '{}') not in ('sim', 'nao', 'na')), false)
$$;
create or replace function public.evidencia_treino_ok(j jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(jsonb_typeof(j) = 'object'
           and not exists (select 1 from jsonb_each(j) e
                            where e.key !~ '^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(e.value) <> 'array'
                               or jsonb_array_length(e.value) <> 2
                               or exists (select 1 from jsonb_array_elements(e.value) v where jsonb_typeof(v) <> 'number')), false)
$$;

-- evidência da sugestão: só contagens e códigos (nada de trecho, cliente, chamada)
create or replace function public.evidencia_sugestao_treino_ok(j jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(jsonb_typeof(j) = 'object' and octet_length(j::text) <= 4000
           and not jsonb_path_exists(j, 'strict $.** ? (@.type() == "string" && !(@ like_regex "^[a-z0-9_:.\\-]{1,60}$"))')
           and not jsonb_path_exists(j, 'lax $.** ? (@.type() == "object" && (exists (@.id_cliente) || exists (@.cpf)
                                           || exists (@.telefone) || exists (@.chamada_id) || exists (@.trecho)
                                           || exists (@.nome_cliente) || exists (@.gravacao_id)))'), false)
$$;
revoke all on function public.perfis_treino(), public.textos_treino_ok(text[], int, int), public.objecoes_treino_ok(jsonb),
    public.divida_treino_ok(jsonb), public.insights_treino_ok(jsonb), public.transcricao_treino_ok(jsonb),
    public.itens_treino_ok(jsonb), public.evidencia_treino_ok(jsonb), public.evidencia_sugestao_treino_ok(jsonb)
    from public, anon;
grant execute on function public.perfis_treino(), public.textos_treino_ok(text[], int, int), public.objecoes_treino_ok(jsonb),
    public.divida_treino_ok(jsonb), public.insights_treino_ok(jsonb), public.transcricao_treino_ok(jsonb),
    public.itens_treino_ok(jsonb), public.evidencia_treino_ok(jsonb), public.evidencia_sugestao_treino_ok(jsonb)
    to authenticated, service_role;

-- ================================================================ 3. equipes e operadores de treino
create table if not exists public.treino_equipes (
    id          bigint generated always as identity primary key,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    nome        text not null check (char_length(trim(nome)) between 2 and 40 and public.texto_mascarado_ok(nome)
                                     and nome !~ '@'),
    ativo       boolean not null default true,
    criado_em   timestamptz not null default now()
);
create unique index if not exists treino_equipes_nome on public.treino_equipes (empresa_id, lower(trim(nome)));
comment on table public.treino_equipes is 'Equipes do Roleplay (Equipe Manhã, Acordos...). Só o nome. SQL 90.';

alter table public.voz_operadores add column if not exists equipe_id bigint references public.treino_equipes (id) on delete set null;
alter table public.voz_operadores add column if not exists so_treino boolean not null default false;
alter table public.voz_operadores alter column operador_ref drop not null;
alter table public.voz_operadores drop constraint if exists voz_operadores_ref_ou_treino;
alter table public.voz_operadores add constraint voz_operadores_ref_ou_treino check (operador_ref is not null or so_treino);
create index if not exists voz_operadores_equipe on public.voz_operadores (equipe_id) where equipe_id is not null;
comment on column public.voz_operadores.so_treino is
    'Cadastrado só para o Roleplay (sem ID do discador): a evolução mostra só o treino, sem cruzar com a nota real. SQL 90.';
comment on column public.voz_operadores.operador_ref is
    'ID do operador no discador. Nulo só para operador de treino (so_treino), SQL 90.';

-- ================================================================ 4. cenários
create table if not exists public.treino_cenarios (
    id                bigint generated always as identity primary key,
    empresa_id        bigint references public.empresas (id) on delete cascade,      -- nulo = Padrão MotorCX
    codigo            text check (codigo ~ '^[a-z][a-z0-9_]{1,40}$'),
    base_id           bigint references public.treino_cenarios (id) on delete set null,
    nome              text not null check (char_length(trim(nome)) between 3 and 80 and public.texto_mascarado_ok(nome)
                                           and nome !~ '@'),
    persona_nome      text not null check (char_length(persona_nome) <= 60 and persona_nome ~ '^\S.{0,40}\((fictícia|fictício)\)$'
                                           and public.texto_mascarado_ok(persona_nome) and persona_nome !~ '[0-9@]'),
    perfil            text not null check (perfil = any (public.perfis_treino())),
    descricao         text check (char_length(descricao) <= 400 and public.texto_mascarado_ok(descricao) and descricao !~ '@'),
    objetivo          text not null check (char_length(trim(objetivo)) between 10 and 500 and public.texto_mascarado_ok(objetivo)
                                           and objetivo !~ '@'),
    comportamentos    text[] not null default '{}' check (public.textos_treino_ok(comportamentos, 10, 200)),
    frases            text[] not null default '{}' check (public.textos_treino_ok(frases, 20, 200)),
    objecoes          jsonb not null default '[]' check (public.objecoes_treino_ok(objecoes)),
    dificuldade       int not null default 2 check (dificuldade between 1 and 5),
    divida            jsonb not null default '{}' check (public.divida_treino_ok(divida)),
    voz_tts           text check (voz_tts ~ '^[A-Za-z0-9_.:\-]{1,60}$'),
    duracao_max_s     int not null default 480 check (duracao_max_s between 60 and 900),
    modos             text[] not null default array['voz', 'texto'] check (cardinality(modos) between 1 and 2
                                                                           and modos <@ array['voz', 'texto']),
    itens_foco        text[] not null default '{}' check (public.codigos_ok(itens_foco, 12)),
    objetivo_cenario  text check (char_length(objetivo_cenario) <= 200 and public.texto_mascarado_ok(objetivo_cenario)
                                  and objetivo_cenario !~ '@'),
    situacao          text not null default 'rascunho' check (situacao in ('rascunho', 'publicado', 'arquivado')),
    origem            text not null default 'manual' check (origem in ('padrao', 'manual', 'insights')),
    insights          jsonb check (public.insights_treino_ok(insights)),
    criado_por        uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em         timestamptz not null default now(),
    atualizado_em     timestamptz not null default now(),
    publicado_em      timestamptz,
    check ((empresa_id is null) = (origem = 'padrao')),
    check (origem = 'insights' or insights is null),
    check (situacao <> 'publicado' or publicado_em is not null)
);
create unique index if not exists treino_cenarios_codigo on public.treino_cenarios (coalesce(empresa_id, 0), codigo)
    where codigo is not null;
create index if not exists treino_cenarios_empresa on public.treino_cenarios (empresa_id, situacao);
comment on table public.treino_cenarios is
    'Cenários do Roleplay (cliente simulado, só ficção). empresa_id nulo = Padrão MotorCX (só leitura; a empresa duplica '
    'para editar). Persona sempre "(fictícia/o)"; insights só códigos e porcentagens de grupos >= 30. SQL 90.';

-- sementes Padrão MotorCX (os cenários do protótipo + o resto de PERSONAS_PADRAO, sem quer_humano, que vira supervisor).
-- Itens em foco só do checklist padrão MotorCX v1 (os itens da empresa, como objeção e alçada, a empresa põe na cópia).
insert into public.treino_cenarios (empresa_id, codigo, nome, persona_nome, perfil, descricao, objetivo, comportamentos,
                                    frases, objecoes, dificuldade, divida, modos, itens_foco, objetivo_cenario, situacao,
                                    origem, publicado_em, criado_por)
select null, v.codigo, v.nome, v.persona_nome, v.perfil, v.descricao, v.objetivo, v.comportamentos, v.frases,
       v.objecoes::jsonb, v.dificuldade, v.divida::jsonb, array['voz', 'texto'], v.itens_foco, v.objetivo_cenario,
       'publicado', 'padrao', now(), null
  from (values
    ('ja_pagou', 'Já pagou', 'Rita (fictícia)', 'ja_pagou',
     'Diz que já pagou e quer que parem de cobrar. Fica calma se o operador pede data e canal do pagamento.',
     'Diz que já pagou a dívida e quer que parem de cobrar; aceita a conferência se o operador pedir data e canal.',
     array['confirma a identidade', 'insiste que pagou', 'informa a data e o canal quando perguntada']::text[],
     array['Sou eu.', 'Mas eu já paguei isso!', 'Paguei semana passada, no Pix.', 'Quero que parem de me ligar.']::text[],
     '[{"codigo": "ja_paguei", "quando": "logo depois de ouvir o motivo da ligação"}]', 2,
     '{"produto": "Conta da loja Exemplo", "faixa": "ate_1k", "dias_atraso": 60, "alcada": {"parcelas": 6, "desconto_max": 20}}',
     array['ck_cpc', 'ck_ident', 'ck_resumo']::text[], 'Pedir data e canal do pagamento e abrir a conferência da baixa'),
    ('contesta_procon', 'Contesta e ameaça o Procon', 'Marcos (fictício)', 'contesta_procon',
     'Não reconhece a dívida e sobe o tom. Testa se o operador mantém a calma e registra a contestação.',
     'Não reconhece a dívida, ameaça reclamar no Procon e só se acalma com a contestação registrada e um prazo.',
     array['confirma a identidade', 'nega a dívida', 'sobe o tom se o operador insistir na oferta']::text[],
     array['Sou eu.', 'Não reconheço essa dívida.', 'Vou reclamar no Procon!', 'Quero isso por escrito.']::text[],
     '[{"codigo": "nao_reconheco", "quando": "quando ouvir o produto"}, {"codigo": "procon", "quando": "se o operador oferecer acordo"}]', 3,
     '{"produto": "Empréstimo pessoal Exemplo", "faixa": "1k_5k", "dias_atraso": 120, "alcada": {"parcelas": 12, "desconto_max": 25}}',
     array['ck_ameaca', 'ck_cpc', 'ck_resumo']::text[], 'Registrar a contestação e informar o prazo de resposta'),
    ('idoso_dificuldade', 'Idoso com dificuldade', 'Dona Lúcia (fictícia)', 'idoso_dificuldade',
     'Ouve mal, pede para repetir e se confunde com valores, mas quer pagar. Treina paciência e resumo claro.',
     'Pessoa idosa que ouve mal, pede para repetir e se confunde com números, mas quer pagar do jeito mais fácil.',
     array['pede para repetir', 'responde devagar', 'prefere parcelas pequenas']::text[],
     array['Alô? Quem fala?', 'Como? Pode repetir, minha filha?', 'Quero pagar, sim, do jeito mais fácil.']::text[],
     '[{"codigo": "nao_entendi", "quando": "sempre que ouvir um valor"}]', 4,
     '{"produto": "Conta da loja Exemplo", "faixa": "ate_1k", "dias_atraso": 45, "alcada": {"parcelas": 6, "desconto_max": 15}}',
     array['ck_ameaca', 'ck_oferta', 'ck_resumo']::text[], 'Repetir a condição com calma até a cliente confirmar'),
    ('quer_parcelar_muito', 'Quer parcelar demais', 'Paulo (fictício)', 'quer_parcelar_muito',
     'Pede parcelas e desconto acima da alçada. Testa se o operador segura a alçada e oferece alternativa.',
     'Quer pagar em muito mais parcelas e com desconto maior do que a alçada permite; aceita se a parcela couber.',
     array['insiste em parcelas acima do limite', 'pede desconto maior', 'aceita se a parcela couber no mês']::text[],
     array['Quero parcelar.', 'Faz em 24 vezes?', 'Não dá pra dar 50% de desconto?', 'Cabe, se for dia 20.']::text[],
     '[{"codigo": "pedir_fora_alcada", "quando": "depois da primeira oferta"}]', 3,
     '{"produto": "Cartão Exemplo", "faixa": "1k_5k", "dias_atraso": 70, "alcada": {"parcelas": 12, "desconto_max": 20}}',
     array['ck_oferta', 'ck_canais', 'ck_resumo']::text[], 'Segurar a alçada e achar uma parcela que caiba'),
    ('terceiro_atende', 'Terceiro atende', 'Irmão da titular (fictício)', 'terceiro_atende',
     'Quem atende não é o titular e pergunta do que se trata. Item crítico: não falar da dívida.',
     'Atende no lugar da titular, pergunta do que se trata e insiste em saber se é dívida.',
     array['diz que não é a pessoa', 'pergunta do que se trata', 'oferece dar o recado']::text[],
     array['Não, é o irmão dela.', 'Do que se trata?', 'É dívida? Pode falar comigo.', 'Tá, eu aviso.']::text[],
     '[]', 1,
     '{"produto": "Cartão Exemplo", "faixa": "1k_5k", "dias_atraso": 35, "alcada": {"parcelas": 10, "desconto_max": 15}}',
     array['ck_terceiro', 'ck_cpc']::text[], 'Marcar um horário para falar com a titular'),
    ('nao_me_ligue', 'Não me ligue', 'Sérgio (fictício)', 'nao_me_ligue',
     'Pede logo no começo para não receber mais ligações.',
     'Pede logo no começo para não receber mais ligações e quer a confirmação de que o pedido foi registrado.',
     array['pede para não ligar mais logo no começo', 'agradece quando o pedido é registrado']::text[],
     array['Olha, não me liga mais, por favor.', 'Para de me ligar.', 'Tá bom, obrigado.']::text[],
     '[{"codigo": "nao_me_ligue", "quando": "na primeira fala"}]', 1,
     '{"produto": "Conta de consumo Exemplo", "faixa": "ate_1k", "dias_atraso": 40, "alcada": {"parcelas": 4}}',
     array['ck_naoligue']::text[], 'Registrar o pedido sem insistir'),
    ('irritado', 'Irritado', 'Carla (fictícia)', 'irritado',
     'Responde curto e com grosseria. Treina tom e a saída com retorno agendado.',
     'Está irritada com as ligações, responde curto e com grosseria, mas aceita um retorno em outro horário.',
     array['responde curto e irritada', 'reclama da quantidade de ligações', 'aceita retorno agendado']::text[],
     array['Que é?', 'Vocês ligam toda hora!', 'Não tenho tempo pra isso agora.', 'Sexta, depois das 18h.']::text[],
     '[{"codigo": "sem_tempo", "quando": "logo no começo"}]', 4,
     '{"produto": "Conta de consumo Exemplo", "faixa": "ate_1k", "dias_atraso": 55, "alcada": {"parcelas": 6, "desconto_max": 10}}',
     array['ck_ameaca', 'ck_ident']::text[], 'Agendar um retorno sem perder o tom'),
    ('desempregado_recente', 'Perdeu o emprego', 'Fábio (fictício)', 'desempregado_recente',
     'Quer resolver, mas perdeu o emprego há pouco e a parcela não cabe. Treina ouvir antes de oferecer.',
     'Quer resolver, mas perdeu o emprego há pouco; só aceita se o operador perguntar quanto cabe por mês.',
     array['confirma a identidade sem resistência', 'explica a situação', 'aceita parcela pequena ou retorno agendado']::text[],
     array['Sou eu, sim.', 'Perdi o emprego mês passado.', 'Uns 150 reais por mês, no máximo.']::text[],
     '[{"codigo": "sem_dinheiro", "quando": "antes da primeira oferta"}]', 2,
     '{"produto": "Empréstimo pessoal Exemplo", "faixa": "1k_5k", "dias_atraso": 65, "alcada": {"parcelas": 10, "desconto_max": 20}}',
     array['ck_oferta', 'ck_canais', 'ck_resumo']::text[], 'Descobrir quanto cabe antes de oferecer'),
    ('negocia_rapido', 'Negocia rápido', 'Bruno (fictício)', 'negocia_rapido',
     'Quer resolver logo e aceita a primeira condição boa. Treina fechar com resumo e canais.',
     'Quer resolver logo, é objetivo e aceita a primeira condição dentro da alçada.',
     array['objetivo e cooperativo', 'aceita oferta dentro da alçada']::text[],
     array['Sou eu.', 'Quero pagar, como faço?', 'Em 6 vezes está ótimo, pode fechar.']::text[],
     '[]', 1,
     '{"produto": "Cartão Exemplo", "faixa": "ate_1k", "dias_atraso": 30, "alcada": {"parcelas": 6, "desconto_max": 10}}',
     array['ck_oferta', 'ck_canais', 'ck_resumo']::text[], 'Fechar o acordo com resumo e canais de pagamento'),
    ('quer_supervisor', 'Quer falar com o supervisor', 'Helena (fictícia)', 'quer_supervisor',
     'Pede para falar com o supervisor logo no começo. Treina escalonar sem perder o cliente.',
     'Não quer falar com o operador e pede o supervisor; aceita se o operador explicar o próximo passo e o prazo.',
     array['pede o supervisor', 'repete o pedido se o operador ignorar', 'aceita retorno do supervisor com prazo']::text[],
     array['Quero falar com o seu supervisor.', 'Não vou resolver isso com você.', 'Tá, mas quando ele me liga?']::text[],
     '[{"codigo": "pedir_supervisor", "quando": "na primeira oferta"}]', 2,
     '{"produto": "Cartão Exemplo", "faixa": "1k_5k", "dias_atraso": 50, "alcada": {"parcelas": 10, "desconto_max": 15}}',
     array['ck_ameaca', 'ck_ident', 'ck_resumo']::text[], 'Explicar o escalonamento e combinar o retorno')
  ) as v(codigo, nome, persona_nome, perfil, descricao, objetivo, comportamentos, frases, objecoes, dificuldade, divida,
         itens_foco, objetivo_cenario)
 where not exists (select 1 from public.treino_cenarios c where c.empresa_id is null and c.codigo = v.codigo);

-- ================================================================ 5. atribuições, links, sessões
create table if not exists public.treino_sugestoes (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    regra            text not null check (regra in ('item_reprovado', 'alerta_subiu', 'item_critico_operador', 'vulnerabilidade')),
    chave            text not null check (chave ~ '^[a-z0-9_:.\-]{3,120}$'),
    cenario_id       bigint references public.treino_cenarios (id) on delete set null,
    operadores       bigint[] not null default '{}' check (cardinality(operadores) <= 200),
    evidencia        jsonb not null default '{}' check (public.evidencia_sugestao_treino_ok(evidencia)),
    situacao         text not null default 'nova' check (situacao in ('nova', 'aceita', 'dispensada')),
    dispensada_ate   date,
    motivo_dispensa  text check (motivo_dispensa in ('tratado', 'falso_positivo')),
    dispensada_por   uuid references auth.users (id) on delete set null,
    criado_em        timestamptz not null default now(),
    unique (empresa_id, chave),
    check ((situacao = 'dispensada') = (motivo_dispensa is not null))
);
comment on table public.treino_sugestoes is
    'Sugestão de treino (job noturno, só contagens e ids de operador). Dispensada some por 30 dias; o motivo calibra as regras.';

create table if not exists public.treino_atribuicoes (
    id                  bigint generated always as identity primary key,
    empresa_id          bigint not null references public.empresas (id) on delete cascade,
    cenario_id          bigint not null references public.treino_cenarios (id),
    prazo               date not null,
    nota_minima         int not null default 75 check (nota_minima between 0 and 100),
    tentativas          int check (tentativas between 1 and 20),                      -- nulo = sem limite
    modos               text[] not null default array['voz', 'texto'] check (cardinality(modos) between 1 and 2
                                                                             and modos <@ array['voz', 'texto']),
    origem_sugestao_id  bigint references public.treino_sugestoes (id) on delete set null,
    criado_por          uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em           timestamptz not null default now()
);
create index if not exists treino_atribuicoes_empresa on public.treino_atribuicoes (empresa_id, prazo desc);

create table if not exists public.treino_atribuicao_operadores (
    atribuicao_id      bigint not null references public.treino_atribuicoes (id) on delete cascade,
    operador_id        bigint not null references public.voz_operadores (id) on delete cascade,
    empresa_id         bigint not null references public.empresas (id) on delete cascade,
    situacao           text not null default 'pendente' check (situacao in ('pendente', 'em_andamento', 'aprovado', 'abaixo')),
    melhor_nota        numeric(5, 2) check (melhor_nota between 0 and 100),
    tentativas_usadas  int not null default 0 check (tentativas_usadas >= 0),
    tentativas_extra   int not null default 0 check (tentativas_extra between 0 and 20),
    ultima_sessao_em   timestamptz,
    primary key (atribuicao_id, operador_id)
);
create index if not exists treino_atribuicao_operadores_op on public.treino_atribuicao_operadores (operador_id);
comment on column public.treino_atribuicao_operadores.tentativas_usadas is
    'Sessões avaliadas (abandonada, rede que caiu e microfone negado não contam). SQL 90.';
comment on column public.treino_atribuicao_operadores.tentativas_extra is '"Liberar +1 tentativa" da Qualidade. SQL 90.';

create table if not exists public.treino_links (
    id           bigint generated always as identity primary key,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    operador_id  bigint not null references public.voz_operadores (id) on delete cascade,
    token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    valido_ate   timestamptz not null,
    revogado_em  timestamptz,
    criado_por   uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em    timestamptz not null default now()
);
create unique index if not exists treino_links_um_ativo on public.treino_links (operador_id) where revogado_em is null;
comment on table public.treino_links is
    'Link pessoal de treino do operador (sem login). Só o sha-256 do token fica aqui; o token aparece uma vez. SQL 90.';

create table if not exists public.treino_link_acessos (
    id          bigint generated always as identity primary key,
    link_id     bigint not null references public.treino_links (id) on delete cascade,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    acao        text not null check (acao in ('abrir', 'iniciar', 'resultado', 'sair', 'discordar')),
    em          timestamptz not null default now()
);
create index if not exists treino_link_acessos_link on public.treino_link_acessos (link_id, em desc);
comment on table public.treino_link_acessos is 'Cada uso do link de treino. Sem IP e sem token. SQL 90.';

create table if not exists public.treino_sessoes (
    id                   bigint generated always as identity primary key,
    empresa_id           bigint not null references public.empresas (id) on delete cascade,
    atribuicao_id        bigint references public.treino_atribuicoes (id) on delete cascade,   -- nulo = teste
    operador_id          bigint references public.voz_operadores (id) on delete cascade,       -- nulo = teste
    cenario_id           bigint not null references public.treino_cenarios (id),
    checklist_versao_id  bigint references public.checklist_versoes (id),
    origem               text not null check (origem in ('link', 'lado_a_lado', 'teste')),
    modo                 text not null check (modo in ('voz', 'texto')),
    iniciada_por         uuid references auth.users (id) on delete set null,
    situacao             text not null default 'em_andamento'
                             check (situacao in ('em_andamento', 'abandonada', 'avaliada', 'falhou')),
    motivo_falha         text check (motivo_falha in ('rede', 'microfone', 'servico', 'voz_esgotada')),
    inicio               timestamptz not null default now(),
    fim                  timestamptz,
    duracao_s            int check (duracao_s between 0 and 3600),
    nota                 numeric(5, 2) check (nota between 0 and 100),
    itens                jsonb not null default '{}' check (public.itens_treino_ok(itens)),
    evidencia            jsonb not null default '{}' check (public.evidencia_treino_ok(evidencia)),
    reprovada            boolean not null default false,
    item_reprovado       text check (item_reprovado ~ '^[a-z][a-z0-9_]{1,39}$'),
    objetivo_ok          boolean,
    tokens               bigint not null default 0 check (tokens >= 0),
    minutos_stt          numeric(8, 2) not null default 0 check (minutos_stt >= 0),
    caracteres_tts       int not null default 0 check (caracteres_tts >= 0),
    uso_registrado       boolean not null default false,
    check ((origem = 'teste') = (operador_id is null)),
    check ((origem = 'teste') = (atribuicao_id is null)),
    check ((situacao = 'avaliada') = (nota is not null)),
    check ((situacao = 'falhou') = (motivo_falha is not null)),
    check (situacao = 'em_andamento' or fim is not null)
);
create index if not exists treino_sessoes_atr on public.treino_sessoes (atribuicao_id, operador_id, inicio desc);
create index if not exists treino_sessoes_abertas on public.treino_sessoes (empresa_id, inicio) where situacao = 'em_andamento';
comment on table public.treino_sessoes is
    'Sessão de treino. Nota e itens no formato de voz_avaliacoes, mas NUNCA em voz_avaliacoes/voz_qualidade_dia. Só a '
    'avaliada conta tentativa (abandonada, rede e microfone não contam). Áudio nunca é guardado. SQL 90.';

create table if not exists public.treino_transcricoes (
    sessao_id   bigint primary key references public.treino_sessoes (id) on delete cascade,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    turnos      jsonb not null check (public.transcricao_treino_ok(turnos)),
    expira_em   timestamptz not null default now() + interval '90 days'
);
create index if not exists treino_transcricoes_expira on public.treino_transcricoes (expira_em);
comment on table public.treino_transcricoes is
    'Transcrição da sessão de treino (fala do operador já mascarada). Apagada em 90 dias (teste da Qualidade: 1 dia) por '
    'apagar_voz_expirada(). Fora de Gravações, Busca, Alertas e Curadoria. SQL 90.';

create table if not exists public.treino_feedback (
    id          bigint generated always as identity primary key,
    sessao_id   bigint not null references public.treino_sessoes (id) on delete cascade,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    item_id     text not null check (item_id ~ '^[a-z][a-z0-9_]{1,39}$'),
    trecho      text check (char_length(trecho) <= 600 and public.texto_mascarado_ok(trecho) and trecho !~ '@'),
    dica        text not null check (char_length(trim(dica)) between 3 and 400 and public.texto_mascarado_ok(dica) and dica !~ '@'),
    expira_em   timestamptz not null default now() + interval '90 days',
    unique (sessao_id, item_id)
);
comment on table public.treino_feedback is 'Ponto a ponto da sessão (trecho do operador + dica). Some com a transcrição. SQL 90.';

create table if not exists public.treino_feedbacks (
    id                bigint generated always as identity primary key,
    empresa_id        bigint not null references public.empresas (id) on delete cascade,
    operador_id       bigint not null references public.voz_operadores (id) on delete cascade,
    atribuicao_id     bigint references public.treino_atribuicoes (id) on delete set null,
    sessao_id         bigint references public.treino_sessoes (id) on delete set null,
    combinado         text not null check (char_length(trim(combinado)) between 3 and 1000 and public.texto_mascarado_ok(combinado)
                                           and combinado !~ '@'),
    proxima_conversa  date,
    criado_por        uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em         timestamptz not null default now()
);
create index if not exists treino_feedbacks_op on public.treino_feedbacks (operador_id, criado_em desc);
comment on table public.treino_feedbacks is 'Feedback 1:1 registrado pela Qualidade (o combinado e a próxima conversa). SQL 90.';

create table if not exists public.treino_revisoes (
    sessao_id     bigint not null references public.treino_sessoes (id) on delete cascade,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    item_id       text not null check (item_id ~ '^[a-z][a-z0-9_]{1,39}$'),
    ia            text not null check (ia in ('sim', 'nao', 'na')),
    qualidade     text not null check (qualidade in ('sim', 'nao', 'na')),
    revisado_por  uuid default auth.uid() references auth.users (id) on delete set null,
    em            timestamptz not null default now(),
    primary key (sessao_id, item_id)
);
comment on table public.treino_revisoes is '"Revisar avaliação" (item a item): base da concordância IA × Qualidade. SQL 90.';

create table if not exists public.treino_discordancias (
    id             bigint generated always as identity primary key,
    sessao_id      bigint not null references public.treino_sessoes (id) on delete cascade,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    item_id        text not null check (item_id ~ '^[a-z][a-z0-9_]{1,39}$'),
    texto          text not null check (char_length(trim(texto)) between 3 and 200 and public.texto_mascarado_ok(texto)
                                        and texto !~ '@'),
    em             timestamptz not null default now(),
    resolvida_por  uuid references auth.users (id) on delete set null,
    resolvida_em   timestamptz,
    unique (sessao_id, item_id)
);
comment on table public.treino_discordancias is '"Discordo deste ponto" do operador (pelo link). Entra em "Precisa de ação". SQL 90.';

create table if not exists public.treino_uso_mes (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    competencia    date not null check (extract(day from competencia) = 1),
    segundos_voz   bigint not null default 0 check (segundos_voz >= 0),
    minutos_voz    int not null default 0 check (minutos_voz >= 0),
    sessoes_voz    int not null default 0 check (sessoes_voz >= 0),
    sessoes_texto  int not null default 0 check (sessoes_texto >= 0),
    tokens         bigint not null default 0 check (tokens >= 0),
    atualizado_em  timestamptz not null default now(),
    primary key (empresa_id, competencia)
);
comment on table public.treino_uso_mes is
    'Uso do Roleplay no mês (Brasília): minutos de voz (inteiros, acumulados) e sessões de texto, para a franquia. SQL 90.';

-- ---------------------------------------------------------------- RLS
do $rls$
declare t text;
begin
    foreach t in array array['treino_equipes', 'treino_cenarios', 'treino_atribuicoes', 'treino_atribuicao_operadores',
                             'treino_links', 'treino_link_acessos', 'treino_sessoes', 'treino_transcricoes',
                             'treino_feedback', 'treino_feedbacks', 'treino_revisoes', 'treino_discordancias',
                             'treino_sugestoes', 'treino_uso_mes'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_ver', t);
        if t = 'treino_cenarios' then
            execute format('create policy %I on public.%I for select to authenticated using ('
                           '(empresa_id is null and (public.pode(''treinar_operadores'') or public.pode(''editar_cenarios_treino'')))'
                           ' or public.cliente_pode(empresa_id, ''treinar_operadores'')'
                           ' or public.cliente_pode(empresa_id, ''editar_cenarios_treino''))', t || '_ver', t);
        elsif t = 'treino_uso_mes' then
            execute format('create policy %I on public.%I for select to authenticated using ('
                           'public.cliente_pode(empresa_id, ''treinar_operadores'') or public.ve_faturamento(empresa_id))',
                           t || '_ver', t);
        else
            execute format('create policy %I on public.%I for select to authenticated using ('
                           'public.cliente_pode(empresa_id, ''treinar_operadores''))', t || '_ver', t);
        end if;
        execute format('revoke all on public.%I from anon', t);
        execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    end loop;
end $rls$;
-- o hash do token não sai nem para quem vê os links
revoke select on public.treino_links from authenticated;
grant select (id, empresa_id, operador_id, valido_ate, revogado_em, criado_por, criado_em) on public.treino_links to authenticated;

do $aud$
declare t text;
begin
    foreach t in array array['treino_equipes', 'treino_cenarios', 'treino_atribuicoes', 'treino_revisoes', 'treino_feedbacks'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $aud$;

-- ================================================================ 6. cobrança (itens, custo de premissa, franquia)
insert into public.cobranca_itens (codigo, produto, nome, unidade, preco_de, modulo, ordem, descricao, franquia_padrao) values
    ('ia_treino_voz', 'speech_analytics', 'Speech Analytics · treino por voz (IA)', 'minuto', null, 'speech_analytics', 57,
     'Roleplay de treino de operadores por voz: minutos além da franquia do mês.', 1000),
    ('ia_treino_texto', 'speech_analytics', 'Speech Analytics · treino por texto (IA)', 'sessão', null, 'speech_analytics', 57,
     'Roleplay de treino de operadores por texto: sessões além da franquia do mês.', 300)
on conflict (codigo) do nothing;
update public.cobranca_itens set eh_ia = true where codigo in ('ia_treino_voz', 'ia_treino_texto') and not eh_ia;

-- custo de premissa (só se o item ainda não tiver custo). O Master troca em Console › Margem › IA.
insert into public.custos_ia (item, custo_unitario, moeda, cotacao, vigente_desde, premissa)
select v.item, v.custo, 'USD', 5.60, date '2026-11-01', v.premissa
  from (values
    ('ia_treino_voz', 0.06::numeric, 'Premissa SQL 90: STT em streaming (~US$ 0,008/min) + TTS da persona (~US$ 0,04/min) + LLM da persona, ≈ US$ 0,06 por minuto de sessão. Trocar pelo realizado.'),
    ('ia_treino_texto', 0.05, 'Premissa SQL 90: ≈ 60 mil tokens por sessão (persona + avaliação + dicas) a US$ 0,60/milhão, com folga, ≈ US$ 0,05 por sessão. Trocar pelo realizado.')
  ) v(item, custo, premissa)
 where exists (select 1 from public.cobranca_itens i where i.codigo = v.item and i.eh_ia)
   and not exists (select 1 from public.custos_ia c where c.item = v.item);

-- preço de tabela proposto (o valor da empresa vem de precos_empresa; sem preço, a fatura mostra "sem preço cadastrado"):
-- nunca abaixo do mínimo da IA (custo ÷ (1 − impostos − 70%))
update public.cobranca_itens i
   set preco_minimo = public.preco_minimo_ia(i.codigo),
       preco_tabela = greatest(case i.codigo when 'ia_treino_voz' then 1.50 else 1.20 end, public.preco_minimo_ia(i.codigo))
 where i.codigo in ('ia_treino_voz', 'ia_treino_texto') and i.preco_tabela is null
   and public.preco_minimo_ia(i.codigo) is not null;

-- franquia da empresa no mês: precos_empresa.franquia (SQL 78) ou franquia_padrao do item
create or replace function public.franquia_treino(empresa bigint, item text, competencia date) returns int
language sql stable security definer set search_path = public as $$
    select coalesce((select p.franquia from public.preco_vigente(franquia_treino.empresa, franquia_treino.item,
                                                                 franquia_treino.competencia) p where p.id is not null),
                    (select i.franquia_padrao from public.cobranca_itens i where i.codigo = franquia_treino.item), 0)
$$;
revoke all on function public.franquia_treino(bigint, text, date) from public, anon, authenticated;
grant execute on function public.franquia_treino(bigint, text, date) to service_role;

-- ================================================================ 7. funções internas
create or replace function public.hoje_treino() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
revoke all on function public.hoje_treino() from public, anon;
grant execute on function public.hoje_treino() to authenticated, service_role;

-- o Roleplay vem com o módulo Speech Analytics
create or replace function public.treino_liberado(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select empresa is not null and public.modulo_ativo(empresa, 'speech_analytics')
$$;
revoke all on function public.treino_liberado(bigint) from public, anon;
grant execute on function public.treino_liberado(bigint) to authenticated, service_role;

-- pessoa da empresa com a permissão, e o módulo ligado (senão, erro com o motivo)
create or replace function public.conferir_treino(empresa bigint, perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
    if empresa is null or not public.cliente_pode(empresa, perm) then
        raise exception 'sem permissão para o treino de operadores (%)', perm;
    end if;
    if not public.treino_liberado(empresa) then
        raise exception 'o Roleplay faz parte do Speech Analytics, que não está contratado';
    end if;
end $$;
revoke all on function public.conferir_treino(bigint, text) from public, anon, authenticated;

-- validade do link: maior prazo das atribuições abertas do operador + 1 dia (fim do dia, Brasília); sem nenhuma, 7 dias
create or replace function public.validade_link_treino(operador bigint) returns timestamptz
language sql stable security definer set search_path = public as $$
    select greatest(
        coalesce(((select max(a.prazo) from public.treino_atribuicoes a
                     join public.treino_atribuicao_operadores ao on ao.atribuicao_id = a.id
                    where ao.operador_id = validade_link_treino.operador and a.prazo >= public.hoje_treino())
                  + 2)::timestamp at time zone 'America/Sao_Paulo', now() + interval '7 days'),
        now() + interval '1 day')
$$;
revoke all on function public.validade_link_treino(bigint) from public, anon, authenticated;

-- link pelo token: hash, validade, revogação, operador ativo e módulo
create or replace function public.link_do_token_treino(token text) returns public.treino_links
language plpgsql stable security definer set search_path = public as $$
declare l public.treino_links;
begin
    if token is null or token !~ '^[0-9a-f]{64}$' then
        raise exception 'link inválido ou vencido';
    end if;
    select x.* into l from public.treino_links x
      join public.voz_operadores o on o.id = x.operador_id and o.ativo
     where x.token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
       and x.revogado_em is null and x.valido_ate > now();
    if l.id is null then
        raise exception 'link inválido ou vencido';
    end if;
    if not public.treino_liberado(l.empresa_id) then
        raise exception 'treinos indisponíveis';
    end if;
    return l;
end $$;
revoke all on function public.link_do_token_treino(text) from public, anon, authenticated;

-- situação de uma pessoa numa atribuição (para as telas): aprovado, precisa_apoio (esgotou), item_critico,
-- prazo_vencido, abaixo_meta, em_andamento, nao_comecou
create or replace function public.situacao_treino_operador(atribuicao bigint, operador bigint) returns text
language sql stable security definer set search_path = public as $$
    select case when ao.situacao = 'aprovado' then 'aprovado'
                when a.tentativas is not null and ao.tentativas_usadas >= a.tentativas + ao.tentativas_extra then 'precisa_apoio'
                when (select s.reprovada from public.treino_sessoes s
                       where s.atribuicao_id = a.id and s.operador_id = ao.operador_id and s.situacao = 'avaliada'
                       order by s.inicio desc limit 1) then 'item_critico'
                when a.prazo < public.hoje_treino() then 'prazo_vencido'
                when ao.tentativas_usadas > 0 then 'abaixo_meta'
                when ao.situacao = 'em_andamento' then 'em_andamento'
                else 'nao_comecou' end
      from public.treino_atribuicoes a
      join public.treino_atribuicao_operadores ao on ao.atribuicao_id = a.id
     where a.id = situacao_treino_operador.atribuicao and ao.operador_id = situacao_treino_operador.operador
$$;
revoke all on function public.situacao_treino_operador(bigint, bigint) from public, anon;
grant execute on function public.situacao_treino_operador(bigint, bigint) to service_role;

-- briefing do cenário (o que o operador pode ver: sem o roteiro da persona)
create or replace function public.briefing_treino(cenario bigint, empresa bigint) returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'persona_nome', c.persona_nome, 'perfil', c.perfil, 'descricao', c.descricao,
        'dificuldade', c.dificuldade, 'divida', c.divida, 'duracao_max_s', c.duracao_max_s, 'modos', c.modos,
        'objetivo_cenario', c.objetivo_cenario,
        'itens_foco', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'texto', i ->> 'texto',
                                                                    'gravidade', i ->> 'gravidade') order by f.n)
                                  from unnest(c.itens_foco) with ordinality f(id, n)
                                  left join lateral (select x from public.checklist_versoes v,
                                                          jsonb_array_elements(v.itens) x
                                                      where v.id = public.checklist_vigente(briefing_treino.empresa,
                                                                                            public.hoje_treino())
                                                        and x ->> 'id' = f.id limit 1) z(i) on true), '[]'::jsonb))
      from public.treino_cenarios c where c.id = briefing_treino.cenario
$$;
revoke all on function public.briefing_treino(bigint, bigint) from public, anon, authenticated;

-- abre uma sessão (link, lado a lado ou teste): módulo, modo, franquia de voz, 5 de voz ao mesmo tempo, prazo e tentativas
create or replace function public.abrir_sessao_treino(empresa bigint, cenario bigint, modo text, atribuicao bigint,
                                                      operador bigint, origem text, iniciada_por uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    c public.treino_cenarios;
    a public.treino_atribuicoes;
    ao public.treino_atribuicao_operadores;
    comp date := date_trunc('month', public.hoje_treino())::date;
    usados int;
    sid bigint;
begin
    if not public.treino_liberado(empresa) then
        raise exception 'treinos indisponíveis';
    end if;
    select * into c from public.treino_cenarios x where x.id = cenario and (x.empresa_id is null or x.empresa_id = empresa);
    if c.id is null or c.situacao = 'arquivado' or (origem <> 'teste' and c.situacao <> 'publicado') then
        raise exception 'cenário não encontrado';
    end if;
    if modo is null or modo not in ('voz', 'texto') or not (modo = any (c.modos)) then
        raise exception 'este treino não tem o modo %', coalesce(modo, '(vazio)');
    end if;
    if atribuicao is not null then
        select * into a from public.treino_atribuicoes x where x.id = atribuicao and x.empresa_id = empresa;
        select * into ao from public.treino_atribuicao_operadores x where x.atribuicao_id = atribuicao and x.operador_id = operador;
        if a.id is null or ao.atribuicao_id is null then
            raise exception 'treino não encontrado';
        end if;
        if not (modo = any (a.modos)) then
            raise exception 'este treino não tem o modo %', modo;
        end if;
        if a.prazo < public.hoje_treino() then
            raise exception 'o prazo deste treino acabou';
        end if;
        if a.tentativas is not null and ao.tentativas_usadas >= a.tentativas + ao.tentativas_extra then
            raise exception 'você usou as % tentativas; a Qualidade vai combinar com você o próximo passo',
                a.tentativas + ao.tentativas_extra;
        end if;
    end if;
    if modo = 'voz' then
        select coalesce(max(u.minutos_voz), 0) into usados from public.treino_uso_mes u
         where u.empresa_id = empresa and u.competencia = comp;
        if usados >= public.franquia_treino(empresa, 'ia_treino_voz', comp) then
            raise exception 'os minutos de voz do treino deste mês acabaram; o treino por texto continua';
        end if;
        if (select count(*) from public.treino_sessoes s where s.empresa_id = empresa and s.situacao = 'em_andamento'
              and s.modo = 'voz' and s.inicio > now() - interval '20 minutes'
              and (atribuicao is null or not (s.atribuicao_id = atribuicao and s.operador_id = operador))) >= 5 then
            raise exception 'já há 5 treinos por voz agora nesta empresa; tente em alguns minutos ou use o texto';
        end if;
    end if;
    -- sessão anterior que ficou aberta (fechou a aba, caiu a rede): abandonada, não conta
    if atribuicao is not null then
        update public.treino_sessoes s set situacao = 'abandonada', fim = now(),
               duracao_s = least(3600, extract(epoch from now() - s.inicio)::int)
         where s.atribuicao_id = atribuicao and s.operador_id = operador and s.situacao = 'em_andamento';
        update public.treino_atribuicao_operadores x set situacao = 'em_andamento'
         where x.atribuicao_id = atribuicao and x.operador_id = operador and x.situacao = 'pendente';
    elsif origem = 'teste' then
        update public.treino_sessoes s set situacao = 'abandonada', fim = now(),
               duracao_s = least(3600, extract(epoch from now() - s.inicio)::int)
         where s.empresa_id = empresa and s.origem = 'teste' and s.iniciada_por = abrir_sessao_treino.iniciada_por
           and s.situacao = 'em_andamento';
    end if;
    insert into public.treino_sessoes (empresa_id, atribuicao_id, operador_id, cenario_id, checklist_versao_id, origem, modo,
                                       iniciada_por)
    values (empresa, atribuicao, operador, c.id, public.checklist_vigente(empresa, public.hoje_treino()), origem, modo,
            abrir_sessao_treino.iniciada_por)
    returning id into sid;
    return jsonb_build_object('sessao', sid, 'modo', modo, 'duracao_max_s', c.duracao_max_s,
                              'tentativa', case when atribuicao is not null then ao.tentativas_usadas + 1 end,
                              'tentativas', case when atribuicao is not null and a.tentativas is not null
                                                 then a.tentativas + ao.tentativas_extra end,
                              'cenario', public.briefing_treino(c.id, empresa));
end $$;
revoke all on function public.abrir_sessao_treino(bigint, bigint, text, bigint, bigint, text, uuid) from public, anon, authenticated;

-- ================================================================ 8. RPCs da Qualidade / Admin
create or replace function public.salvar_equipe_treino(empresa bigint, nome text, equipe bigint default null,
                                                       ativo boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
declare eid bigint;
begin
    perform public.conferir_treino(empresa, 'treinar_operadores');
    if equipe is null then
        insert into public.treino_equipes (empresa_id, nome, ativo)
        values (empresa, trim(salvar_equipe_treino.nome), coalesce(salvar_equipe_treino.ativo, true))
        returning id into eid;
    else
        update public.treino_equipes e set nome = coalesce(trim(salvar_equipe_treino.nome), e.nome),
               ativo = coalesce(salvar_equipe_treino.ativo, e.ativo)
         where e.id = equipe and e.empresa_id = empresa
        returning e.id into eid;
        if eid is null then
            raise exception 'equipe não encontrada';
        end if;
    end if;
    return eid;
end $$;

-- cadastro para treino: apelido, equipe e (opcional) ID do discador. Sem ID = só treino (so_treino).
create or replace function public.salvar_operador_treino(empresa bigint, apelido text, equipe bigint default null,
                                                         operador_ref text default null, operador bigint default null,
                                                         ativo boolean default true, discador text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    oid bigint := operador;
    ref text := nullif(trim(salvar_operador_treino.operador_ref), '');
begin
    perform public.conferir_treino(empresa, 'treinar_operadores');
    if equipe is not null and not exists (select 1 from public.treino_equipes e where e.id = equipe and e.empresa_id = empresa) then
        raise exception 'equipe não encontrada';
    end if;
    if oid is null and ref is not null then         -- "Trazer de Speech › Operadores": o mesmo ID vira o mesmo cadastro
        select o.id into oid from public.voz_operadores o where o.empresa_id = empresa and o.operador_ref = ref;
    end if;
    if oid is null then
        insert into public.voz_operadores (empresa_id, discador, operador_ref, apelido, ativo, equipe_id, so_treino)
        values (empresa, coalesce(salvar_operador_treino.discador, 'generico'), ref, trim(salvar_operador_treino.apelido),
                coalesce(salvar_operador_treino.ativo, true), equipe, ref is null)
        returning id into oid;
        return oid;
    end if;
    update public.voz_operadores o
       set apelido = coalesce(nullif(trim(salvar_operador_treino.apelido), ''), o.apelido),
           equipe_id = equipe, ativo = coalesce(salvar_operador_treino.ativo, o.ativo),
           operador_ref = coalesce(ref, o.operador_ref),
           so_treino = coalesce(ref, o.operador_ref) is null,
           discador = coalesce(salvar_operador_treino.discador, o.discador)
     where o.id = oid and o.empresa_id = empresa
    returning o.id into oid;
    if oid is null then
        raise exception 'operador não encontrado';
    end if;
    if not coalesce(salvar_operador_treino.ativo, true) then  -- desativado: o link para de abrir
        update public.treino_links l set revogado_em = now() where l.operador_id = oid and l.revogado_em is null;
    end if;
    return oid;
end $$;

-- cenário da empresa (o Padrão MotorCX só se duplica). Publicar grava publicado_em.
create or replace function public.salvar_cenario_treino(empresa bigint, dados jsonb, cenario bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    k text;
    cid bigint;
    arr constant text[] := array['comportamentos', 'frases', 'modos', 'itens_foco'];
begin
    perform public.conferir_treino(empresa, 'editar_cenarios_treino');
    if jsonb_typeof(dados) is distinct from 'object' then
        raise exception 'dados inválidos';
    end if;
    for k in select jsonb_object_keys(dados) loop
        if k not in ('codigo', 'nome', 'persona_nome', 'perfil', 'descricao', 'objetivo', 'comportamentos', 'frases',
                     'objecoes', 'dificuldade', 'divida', 'voz_tts', 'duracao_max_s', 'modos', 'itens_foco',
                     'objetivo_cenario', 'situacao', 'origem', 'insights') then
            raise exception 'campo desconhecido: %', k;
        end if;
        if k = any (arr) and jsonb_typeof(dados -> k) <> 'array' then
            raise exception 'o campo % é uma lista', k;
        end if;
    end loop;
    if dados ? 'origem' and dados ->> 'origem' not in ('manual', 'insights') then
        raise exception 'origem inválida';
    end if;
    if cenario is null then
        insert into public.treino_cenarios (empresa_id, codigo, nome, persona_nome, perfil, descricao, objetivo,
                                            comportamentos, frases, objecoes, dificuldade, divida, voz_tts, duracao_max_s,
                                            modos, itens_foco, objetivo_cenario, situacao, origem, insights, publicado_em)
        values (empresa, dados ->> 'codigo', trim(dados ->> 'nome'), trim(dados ->> 'persona_nome'), dados ->> 'perfil',
                nullif(trim(dados ->> 'descricao'), ''), trim(dados ->> 'objetivo'),
                array(select jsonb_array_elements_text(coalesce(dados -> 'comportamentos', '[]'))),
                array(select jsonb_array_elements_text(coalesce(dados -> 'frases', '[]'))),
                coalesce(dados -> 'objecoes', '[]'), coalesce((dados ->> 'dificuldade')::int, 2),
                coalesce(dados -> 'divida', '{}'), dados ->> 'voz_tts', coalesce((dados ->> 'duracao_max_s')::int, 480),
                case when dados ? 'modos' then array(select jsonb_array_elements_text(dados -> 'modos'))
                     else array['voz', 'texto'] end,
                array(select jsonb_array_elements_text(coalesce(dados -> 'itens_foco', '[]'))),
                nullif(trim(dados ->> 'objetivo_cenario'), ''), coalesce(dados ->> 'situacao', 'rascunho'),
                coalesce(dados ->> 'origem', 'manual'), dados -> 'insights',
                case when dados ->> 'situacao' = 'publicado' then now() end)
        returning id into cid;
        return cid;
    end if;
    update public.treino_cenarios c set
        codigo = case when dados ? 'codigo' then dados ->> 'codigo' else c.codigo end,
        nome = coalesce(trim(dados ->> 'nome'), c.nome),
        persona_nome = coalesce(trim(dados ->> 'persona_nome'), c.persona_nome),
        perfil = coalesce(dados ->> 'perfil', c.perfil),
        descricao = case when dados ? 'descricao' then nullif(trim(dados ->> 'descricao'), '') else c.descricao end,
        objetivo = coalesce(trim(dados ->> 'objetivo'), c.objetivo),
        comportamentos = case when dados ? 'comportamentos'
                              then array(select jsonb_array_elements_text(dados -> 'comportamentos')) else c.comportamentos end,
        frases = case when dados ? 'frases' then array(select jsonb_array_elements_text(dados -> 'frases')) else c.frases end,
        objecoes = coalesce(dados -> 'objecoes', c.objecoes),
        dificuldade = coalesce((dados ->> 'dificuldade')::int, c.dificuldade),
        divida = coalesce(dados -> 'divida', c.divida),
        voz_tts = case when dados ? 'voz_tts' then dados ->> 'voz_tts' else c.voz_tts end,
        duracao_max_s = coalesce((dados ->> 'duracao_max_s')::int, c.duracao_max_s),
        modos = case when dados ? 'modos' then array(select jsonb_array_elements_text(dados -> 'modos')) else c.modos end,
        itens_foco = case when dados ? 'itens_foco' then array(select jsonb_array_elements_text(dados -> 'itens_foco'))
                          else c.itens_foco end,
        objetivo_cenario = case when dados ? 'objetivo_cenario' then nullif(trim(dados ->> 'objetivo_cenario'), '')
                                else c.objetivo_cenario end,
        situacao = coalesce(dados ->> 'situacao', c.situacao),
        origem = coalesce(dados ->> 'origem', c.origem),
        insights = case when dados ? 'insights' then dados -> 'insights' else c.insights end,
        publicado_em = case when coalesce(dados ->> 'situacao', c.situacao) = 'publicado' then coalesce(c.publicado_em, now())
                            else c.publicado_em end,
        atualizado_em = now()
     where c.id = cenario and c.empresa_id = empresa
    returning c.id into cid;
    if cid is null then
        raise exception 'cenário não encontrado (o Padrão MotorCX não se edita: duplique para editar)';
    end if;
    return cid;
end $$;

-- "Duplicar para editar": cópia em rascunho na empresa
create or replace function public.duplicar_cenario_treino(cenario bigint, empresa bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
    perform public.conferir_treino(empresa, 'editar_cenarios_treino');
    insert into public.treino_cenarios (empresa_id, base_id, nome, persona_nome, perfil, descricao, objetivo, comportamentos,
                                        frases, objecoes, dificuldade, divida, voz_tts, duracao_max_s, modos, itens_foco,
                                        objetivo_cenario, situacao, origem)
    select empresa, c.id, left(c.nome || ' (cópia)', 80), c.persona_nome, c.perfil, c.descricao, c.objetivo,
           c.comportamentos, c.frases, c.objecoes, c.dificuldade, c.divida, c.voz_tts, c.duracao_max_s, c.modos,
           c.itens_foco, c.objetivo_cenario, 'rascunho', 'manual'
      from public.treino_cenarios c
     where c.id = cenario and (c.empresa_id is null or c.empresa_id = empresa)
    returning id into cid;
    if cid is null then
        raise exception 'cenário não encontrado';
    end if;
    return cid;
end $$;

-- "Atribuir treino": cenário publicado, pessoas ativas da empresa, prazo de hoje a 180 dias. O link ativo de cada
-- pessoa passa a valer até o novo prazo + 1 dia.
create or replace function public.atribuir_treino(empresa bigint, cenario bigint, operadores bigint[], prazo date,
                                                  nota_minima int default 75, tentativas int default 2,
                                                  modos text[] default null, sugestao bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    c public.treino_cenarios;
    aid bigint;
begin
    perform public.conferir_treino(empresa, 'treinar_operadores');
    select * into c from public.treino_cenarios x
     where x.id = cenario and (x.empresa_id is null or x.empresa_id = empresa) and x.situacao = 'publicado';
    if c.id is null then
        raise exception 'cenário não encontrado ou não publicado';
    end if;
    if operadores is null or cardinality(operadores) not between 1 and 200 then
        raise exception 'escolha de 1 a 200 pessoas';
    end if;
    if exists (select 1 from unnest(operadores) o
                where not exists (select 1 from public.voz_operadores v where v.id = o and v.empresa_id = empresa and v.ativo)) then
        raise exception 'pessoa não encontrada no cadastro para treino';
    end if;
    if prazo is null or prazo < public.hoje_treino() or prazo > public.hoje_treino() + 180 then
        raise exception 'prazo de hoje a 180 dias';
    end if;
    if modos is not null and not (modos <@ c.modos) then
        raise exception 'o cenário não tem esse modo';
    end if;
    if sugestao is not null and not exists (select 1 from public.treino_sugestoes s where s.id = sugestao and s.empresa_id = empresa) then
        raise exception 'sugestão não encontrada';
    end if;
    insert into public.treino_atribuicoes (empresa_id, cenario_id, prazo, nota_minima, tentativas, modos, origem_sugestao_id)
    values (empresa, c.id, prazo, coalesce(atribuir_treino.nota_minima, 75), tentativas, coalesce(modos, c.modos), sugestao)
    returning id into aid;
    insert into public.treino_atribuicao_operadores (atribuicao_id, operador_id, empresa_id)
    select distinct aid, o, empresa from unnest(operadores) o;
    update public.treino_links l set valido_ate = greatest(l.valido_ate, public.validade_link_treino(l.operador_id))
     where l.operador_id = any (operadores) and l.revogado_em is null and l.valido_ate > now();
    if sugestao is not null then
        update public.treino_sugestoes s set situacao = 'aceita' where s.id = sugestao and s.situacao = 'nova';
    end if;
    return aid;
end $$;

create or replace function public.liberar_tentativa_treino(atribuicao bigint, operador bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
    emp bigint := (select a.empresa_id from public.treino_atribuicoes a where a.id = atribuicao);
    n int;
begin
    perform public.conferir_treino(emp, 'treinar_operadores');
    update public.treino_atribuicao_operadores x set tentativas_extra = x.tentativas_extra + 1
     where x.atribuicao_id = atribuicao and x.operador_id = operador
    returning x.tentativas_extra into n;
    if n is null then
        raise exception 'pessoa não está neste treino';
    end if;
    return n;
end $$;

create or replace function public.estender_prazo_treino(atribuicao bigint, prazo date) returns void
language plpgsql security definer set search_path = public as $$
declare a public.treino_atribuicoes;
begin
    select * into a from public.treino_atribuicoes x where x.id = atribuicao;
    perform public.conferir_treino(a.empresa_id, 'treinar_operadores');
    if prazo is null or prazo <= a.prazo or prazo > public.hoje_treino() + 180 then
        raise exception 'o novo prazo vem depois do atual e até 180 dias';
    end if;
    update public.treino_atribuicoes x set prazo = estender_prazo_treino.prazo where x.id = atribuicao;
    update public.treino_links l set valido_ate = greatest(l.valido_ate, public.validade_link_treino(l.operador_id))
     where l.revogado_em is null and l.valido_ate > now()
       and l.operador_id in (select ao.operador_id from public.treino_atribuicao_operadores ao where ao.atribuicao_id = atribuicao);
end $$;

-- link pessoal: o token aparece uma vez; o banco guarda só o sha-256. Gerar outro revoga o anterior.
create or replace function public.gerar_link_treino(operador bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    o public.voz_operadores;
    token text;
    ate timestamptz;
begin
    select * into o from public.voz_operadores x where x.id = operador;
    perform public.conferir_treino(o.empresa_id, 'treinar_operadores');
    if not o.ativo then
        raise exception 'pessoa inativa no cadastro para treino';
    end if;
    update public.treino_links l set revogado_em = now() where l.operador_id = o.id and l.revogado_em is null;
    token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    ate := public.validade_link_treino(o.id);
    insert into public.treino_links (empresa_id, operador_id, token_hash, valido_ate)
    values (o.empresa_id, o.id, encode(sha256(convert_to(token, 'UTF8')), 'hex'), ate);
    return jsonb_build_object('token', token, 'valido_ate', ate);
end $$;

create or replace function public.revogar_link_treino(operador bigint) returns void
language plpgsql security definer set search_path = public as $$
declare emp bigint := (select o.empresa_id from public.voz_operadores o where o.id = operador);
begin
    perform public.conferir_treino(emp, 'treinar_operadores');
    update public.treino_links l set revogado_em = now() where l.operador_id = operador and l.revogado_em is null;
end $$;

-- "Treino lado a lado": a Qualidade, logada, abre a sessão para o operador ao lado
create or replace function public.iniciar_treino_lado_a_lado(atribuicao bigint, operador bigint, modo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.treino_atribuicoes;
begin
    select * into a from public.treino_atribuicoes x where x.id = atribuicao;
    perform public.conferir_treino(a.empresa_id, 'treinar_operadores');
    return public.abrir_sessao_treino(a.empresa_id, a.cenario_id, modo, a.id, operador, 'lado_a_lado', auth.uid());
end $$;

-- teste do cenário pela Qualidade: sem operador, conta no saldo, transcrição some em 1 dia
create or replace function public.testar_cenario_treino(cenario bigint, empresa bigint, modo text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
    perform public.conferir_treino(empresa, 'editar_cenarios_treino');
    return public.abrir_sessao_treino(empresa, cenario, modo, null, null, 'teste', auth.uid());
end $$;

-- "Revisar avaliação" item a item (a IA disse X, a Qualidade diz Y)
create or replace function public.revisar_sessao_treino(sessao bigint, item text, qualidade text) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare s public.treino_sessoes;
begin
    select * into s from public.treino_sessoes x where x.id = sessao;
    perform public.conferir_treino(s.empresa_id, 'treinar_operadores');
    if s.situacao <> 'avaliada' or s.origem = 'teste' then
        raise exception 'só sessão avaliada de operador é revisada';
    end if;
    if not (s.itens ? item) then
        raise exception 'item não avaliado nesta sessão';
    end if;
    if qualidade is null then
        delete from public.treino_revisoes r where r.sessao_id = sessao and r.item_id = item;
        return;
    end if;
    if qualidade not in ('sim', 'nao', 'na') then
        raise exception 'resposta inválida';
    end if;
    insert into public.treino_revisoes (sessao_id, empresa_id, item_id, ia, qualidade)
    values (sessao, s.empresa_id, item, s.itens ->> item, qualidade)
    on conflict (sessao_id, item_id) do update set qualidade = excluded.qualidade, revisado_por = auth.uid(), em = now();
end $$;

-- feedback 1:1 (o combinado e a próxima conversa)
create or replace function public.salvar_feedback_treino(empresa bigint, operador bigint, combinado text,
                                                         proxima_conversa date default null, atribuicao bigint default null,
                                                         sessao bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare fid bigint;
begin
    perform public.conferir_treino(empresa, 'treinar_operadores');
    if not exists (select 1 from public.voz_operadores o where o.id = operador and o.empresa_id = empresa) then
        raise exception 'pessoa não encontrada';
    end if;
    if atribuicao is not null and not exists (select 1 from public.treino_atribuicao_operadores x
                                               where x.atribuicao_id = atribuicao and x.operador_id = operador) then
        raise exception 'pessoa não está neste treino';
    end if;
    if sessao is not null and not exists (select 1 from public.treino_sessoes s where s.id = sessao and s.operador_id = operador) then
        raise exception 'sessão não encontrada';
    end if;
    if not public.texto_mascarado_ok(combinado) or combinado ~ '@' then
        raise exception 'sem CPF, telefone ou e-mail no feedback';
    end if;
    insert into public.treino_feedbacks (empresa_id, operador_id, atribuicao_id, sessao_id, combinado, proxima_conversa)
    values (empresa, operador, atribuicao, sessao, trim(combinado), proxima_conversa)
    returning id into fid;
    return fid;
end $$;

create or replace function public.resolver_discordancia_treino(discordancia bigint) returns void
language plpgsql security definer set search_path = public as $$
declare emp bigint := (select d.empresa_id from public.treino_discordancias d where d.id = discordancia);
begin
    perform public.conferir_treino(emp, 'treinar_operadores');
    update public.treino_discordancias d set resolvida_por = auth.uid(), resolvida_em = now()
     where d.id = discordancia and d.resolvida_em is null;
end $$;

-- "Dispensar" com o motivo em 1 clique (tratado / falso_positivo); motivo nulo = "Desfazer"
create or replace function public.dispensar_sugestao_treino(sugestao bigint, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare emp bigint := (select s.empresa_id from public.treino_sugestoes s where s.id = sugestao);
begin
    perform public.conferir_treino(emp, 'treinar_operadores');
    if motivo is null then
        update public.treino_sugestoes s set situacao = 'nova', motivo_dispensa = null, dispensada_ate = null,
               dispensada_por = null
         where s.id = sugestao and s.situacao = 'dispensada';
        return;
    end if;
    if motivo not in ('tratado', 'falso_positivo') then
        raise exception 'motivo inválido';
    end if;
    update public.treino_sugestoes s set situacao = 'dispensada', motivo_dispensa = motivo,
           dispensada_ate = public.hoje_treino() + 30, dispensada_por = auth.uid()
     where s.id = sugestao;
end $$;

-- uso do mês e franquia (Painel do Roleplay e aviso de voz esgotada)
create or replace function public.uso_treino(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    comp date := date_trunc('month', public.hoje_treino())::date;
    u public.treino_uso_mes;
    fv int;
begin
    perform public.conferir_treino(empresa, 'treinar_operadores');
    select * into u from public.treino_uso_mes x where x.empresa_id = empresa and x.competencia = comp;
    fv := public.franquia_treino(empresa, 'ia_treino_voz', comp);
    return jsonb_build_object('competencia', comp, 'minutos_voz', coalesce(u.minutos_voz, 0), 'franquia_voz', fv,
                              'sessoes_texto', coalesce(u.sessoes_texto, 0),
                              'franquia_texto', public.franquia_treino(empresa, 'ia_treino_texto', comp),
                              'voz_bloqueada', coalesce(u.minutos_voz, 0) >= fv);
end $$;

revoke all on function public.salvar_equipe_treino(bigint, text, bigint, boolean),
    public.salvar_operador_treino(bigint, text, bigint, text, bigint, boolean, text),
    public.salvar_cenario_treino(bigint, jsonb, bigint), public.duplicar_cenario_treino(bigint, bigint),
    public.atribuir_treino(bigint, bigint, bigint[], date, int, int, text[], bigint),
    public.liberar_tentativa_treino(bigint, bigint), public.estender_prazo_treino(bigint, date),
    public.gerar_link_treino(bigint), public.revogar_link_treino(bigint),
    public.iniciar_treino_lado_a_lado(bigint, bigint, text), public.testar_cenario_treino(bigint, bigint, text),
    public.revisar_sessao_treino(bigint, text, text),
    public.salvar_feedback_treino(bigint, bigint, text, date, bigint, bigint),
    public.resolver_discordancia_treino(bigint), public.dispensar_sugestao_treino(bigint, text), public.uso_treino(bigint)
    from public, anon;
grant execute on function public.salvar_equipe_treino(bigint, text, bigint, boolean),
    public.salvar_operador_treino(bigint, text, bigint, text, bigint, boolean, text),
    public.salvar_cenario_treino(bigint, jsonb, bigint), public.duplicar_cenario_treino(bigint, bigint),
    public.atribuir_treino(bigint, bigint, bigint[], date, int, int, text[], bigint),
    public.liberar_tentativa_treino(bigint, bigint), public.estender_prazo_treino(bigint, date),
    public.gerar_link_treino(bigint), public.revogar_link_treino(bigint),
    public.iniciar_treino_lado_a_lado(bigint, bigint, text), public.testar_cenario_treino(bigint, bigint, text),
    public.revisar_sessao_treino(bigint, text, text),
    public.salvar_feedback_treino(bigint, bigint, text, date, bigint, bigint),
    public.resolver_discordancia_treino(bigint), public.dispensar_sugestao_treino(bigint, text), public.uso_treino(bigint)
    to authenticated;

-- ================================================================ 9. pelo link (anon, com o token)
-- "Meus treinamentos": só os treinos daquele operador
create or replace function public.treino_meus(token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    l public.treino_links;
    comp date := date_trunc('month', public.hoje_treino())::date;
begin
    l := public.link_do_token_treino(token);
    insert into public.treino_link_acessos (link_id, empresa_id, acao) values (l.id, l.empresa_id, 'abrir');
    return jsonb_build_object(
        'apelido', (select o.apelido from public.voz_operadores o where o.id = l.operador_id),
        'valido_ate', l.valido_ate,
        'voz_disponivel', coalesce((select u.minutos_voz from public.treino_uso_mes u
                                     where u.empresa_id = l.empresa_id and u.competencia = comp), 0)
                          < public.franquia_treino(l.empresa_id, 'ia_treino_voz', comp),
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

create or replace function public.treino_iniciar(token text, atribuicao bigint, modo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    l public.treino_links;
    a public.treino_atribuicoes;
begin
    l := public.link_do_token_treino(token);
    select * into a from public.treino_atribuicoes x
     where x.id = atribuicao and x.empresa_id = l.empresa_id
       and exists (select 1 from public.treino_atribuicao_operadores ao where ao.atribuicao_id = x.id
                    and ao.operador_id = l.operador_id);
    if a.id is null then
        raise exception 'treino não encontrado';
    end if;
    insert into public.treino_link_acessos (link_id, empresa_id, acao) values (l.id, l.empresa_id, 'iniciar');
    return public.abrir_sessao_treino(l.empresa_id, a.cenario_id, modo, a.id, l.operador_id, 'link', null);
end $$;

-- resultado formativo de uma sessão do próprio operador
create or replace function public.treino_resultado(token text, sessao bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    l public.treino_links;
    s public.treino_sessoes;
begin
    l := public.link_do_token_treino(token);
    select * into s from public.treino_sessoes x where x.id = sessao and x.operador_id = l.operador_id
       and x.empresa_id = l.empresa_id;
    if s.id is null then
        raise exception 'sessão não encontrada';
    end if;
    insert into public.treino_link_acessos (link_id, empresa_id, acao) values (l.id, l.empresa_id, 'resultado');
    return jsonb_build_object(
        'sessao', s.id, 'atribuicao', s.atribuicao_id, 'situacao', s.situacao, 'modo', s.modo, 'inicio', s.inicio,
        'duracao_s', s.duracao_s, 'nota', s.nota, 'reprovada', s.reprovada, 'item_reprovado', s.item_reprovado,
        'objetivo_ok', s.objetivo_ok,
        'nota_minima', (select a.nota_minima from public.treino_atribuicoes a where a.id = s.atribuicao_id),
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
        'discordancias', coalesce((select jsonb_agg(jsonb_build_object('item', d.item_id, 'texto', d.texto,
                                                                       'resolvida', d.resolvida_em is not null))
                                     from public.treino_discordancias d where d.sessao_id = s.id), '[]'::jsonb));
end $$;

-- "Sair sem contar": a sessão aberta vira abandonada (não conta tentativa)
create or replace function public.treino_sair(token text, sessao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare l public.treino_links;
begin
    l := public.link_do_token_treino(token);
    insert into public.treino_link_acessos (link_id, empresa_id, acao) values (l.id, l.empresa_id, 'sair');
    update public.treino_sessoes s set situacao = 'abandonada', fim = now(),
           duracao_s = least(3600, extract(epoch from now() - s.inicio)::int)
     where s.id = sessao and s.operador_id = l.operador_id and s.situacao = 'em_andamento';
end $$;

-- "Discordo deste ponto" (só em item "não", uma linha por item)
create or replace function public.treino_discordar(token text, sessao bigint, item text, texto text) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    l public.treino_links;
    s public.treino_sessoes;
begin
    l := public.link_do_token_treino(token);
    select * into s from public.treino_sessoes x where x.id = sessao and x.operador_id = l.operador_id
       and x.empresa_id = l.empresa_id and x.situacao = 'avaliada';
    if s.id is null then
        raise exception 'sessão não encontrada';
    end if;
    if coalesce(s.itens ->> item, '') <> 'nao' then
        raise exception 'só dá para discordar de um item marcado como não';
    end if;
    if texto is null or char_length(trim(texto)) not between 3 and 200 or not public.texto_mascarado_ok(texto) or texto ~ '@' then
        raise exception 'escreva de 3 a 200 caracteres, sem CPF, telefone ou e-mail';
    end if;
    insert into public.treino_link_acessos (link_id, empresa_id, acao) values (l.id, l.empresa_id, 'discordar');
    insert into public.treino_discordancias (sessao_id, empresa_id, item_id, texto)
    values (s.id, s.empresa_id, item, trim(texto))
    on conflict (sessao_id, item_id) do update set texto = excluded.texto, em = now(), resolvida_por = null,
                                                   resolvida_em = null;
end $$;

revoke all on function public.treino_meus(text), public.treino_iniciar(text, bigint, text),
    public.treino_resultado(text, bigint), public.treino_sair(text, bigint),
    public.treino_discordar(text, bigint, text, text) from public;
grant execute on function public.treino_meus(text), public.treino_iniciar(text, bigint, text),
    public.treino_resultado(text, bigint), public.treino_sair(text, bigint),
    public.treino_discordar(text, bigint, text, text) to anon, authenticated;

-- ================================================================ 10. do serviço de treino (service_role)
-- Resultado da sessão: situação (avaliada / abandonada / falhou), nota e itens do checklist, transcrição e feedback,
-- tentativas e melhor nota, uso do mês, custo (consumo_ia) e fatura (só o que passou da franquia).
create or replace function public.registrar_sessao_treino(sessao bigint, dados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    s public.treino_sessoes;
    a public.treino_atribuicoes;
    k text;
    sit text := dados ->> 'situacao';
    dur int := least(3600, greatest(0, coalesce((dados ->> 'duracao_s')::int, 0)));
    tok bigint := greatest(0, coalesce((dados ->> 'tokens')::bigint, 0));
    hoje date := public.hoje_treino();
    comp date := date_trunc('month', public.hoje_treino())::date;
    u public.treino_uso_mes;
    min_antes int;
    fr int;
    item_fat text;
    total int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o serviço de treino registra a sessão';
    end if;
    if jsonb_typeof(dados) is distinct from 'object' then
        raise exception 'dados inválidos';
    end if;
    for k in select jsonb_object_keys(dados) loop
        if k not in ('situacao', 'motivo_falha', 'duracao_s', 'nota', 'itens', 'evidencia', 'reprovada', 'item_reprovado',
                     'objetivo_ok', 'tokens', 'minutos_stt', 'caracteres_tts', 'transcricao', 'feedback', 'custo_real') then
            raise exception 'campo desconhecido: %', k;
        end if;
    end loop;
    select * into s from public.treino_sessoes x where x.id = sessao for update;
    if s.id is null then
        raise exception 'sessão não encontrada';
    end if;
    if sit is null or sit not in ('avaliada', 'abandonada', 'falhou') then
        raise exception 'situação inválida';
    end if;
    if s.situacao <> 'em_andamento' then
        -- fechada pelo operador ("Sair sem contar") ou por uma sessão nova: o serviço ainda registra o uso, uma vez
        if not (s.situacao = 'abandonada' and sit = 'abandonada' and not s.uso_registrado) then
            return jsonb_build_object('sessao', s.id, 'situacao', s.situacao, 'ja_registrada', true);
        end if;
        update public.treino_sessoes x set duracao_s = dur, tokens = tok,
               minutos_stt = coalesce((dados ->> 'minutos_stt')::numeric, 0),
               caracteres_tts = coalesce((dados ->> 'caracteres_tts')::int, 0)
         where x.id = s.id;
    else
        update public.treino_sessoes x set
            situacao = sit, fim = now(), duracao_s = dur,
            motivo_falha = case when sit = 'falhou' then coalesce(dados ->> 'motivo_falha', 'servico') end,
            nota = case when sit = 'avaliada' then (dados ->> 'nota')::numeric end,
            itens = case when sit = 'avaliada' then coalesce(dados -> 'itens', '{}') else '{}' end,
            evidencia = case when sit = 'avaliada' then coalesce(dados -> 'evidencia', '{}') else '{}' end,
            reprovada = sit = 'avaliada' and coalesce((dados ->> 'reprovada')::boolean, false),
            item_reprovado = case when sit = 'avaliada' then dados ->> 'item_reprovado' end,
            objetivo_ok = case when sit = 'avaliada' then (dados ->> 'objetivo_ok')::boolean end,
            tokens = tok, minutos_stt = coalesce((dados ->> 'minutos_stt')::numeric, 0),
            caracteres_tts = coalesce((dados ->> 'caracteres_tts')::int, 0)
         where x.id = s.id;
    end if;
    if sit = 'avaliada' and jsonb_typeof(dados -> 'transcricao') = 'array' then
        insert into public.treino_transcricoes (sessao_id, empresa_id, turnos, expira_em)
        values (s.id, s.empresa_id, dados -> 'transcricao',
                now() + case when s.origem = 'teste' then interval '1 day' else interval '90 days' end)
        on conflict (sessao_id) do update set turnos = excluded.turnos;
    end if;
    if sit = 'avaliada' and jsonb_typeof(dados -> 'feedback') = 'array' then
        insert into public.treino_feedback (sessao_id, empresa_id, item_id, trecho, dica, expira_em)
        select s.id, s.empresa_id, f ->> 'item', nullif(f ->> 'trecho', ''), f ->> 'dica',
               now() + case when s.origem = 'teste' then interval '1 day' else interval '90 days' end
          from jsonb_array_elements(dados -> 'feedback') f
        on conflict (sessao_id, item_id) do update set trecho = excluded.trecho, dica = excluded.dica;
    end if;
    -- tentativas: só a avaliada conta; aprovado = nota >= meta sem item crítico
    if s.atribuicao_id is not null then
        select * into a from public.treino_atribuicoes x where x.id = s.atribuicao_id;
        update public.treino_atribuicao_operadores ao set
            tentativas_usadas = v.n, melhor_nota = v.melhor, ultima_sessao_em = now(),
            situacao = case when v.aprovou then 'aprovado' when v.n > 0 then 'abaixo' else 'pendente' end
          from (select count(*)::int n, max(x.nota) melhor,
                       coalesce(bool_or(x.nota >= a.nota_minima and not x.reprovada), false) aprovou
                  from public.treino_sessoes x
                 where x.atribuicao_id = s.atribuicao_id and x.operador_id = s.operador_id and x.situacao = 'avaliada') v
         where ao.atribuicao_id = s.atribuicao_id and ao.operador_id = s.operador_id;
    end if;
    -- uso, custo e fatura: avaliada e abandonada (a IA rodou); falhou não conta nem cobra
    if sit in ('avaliada', 'abandonada') then
        update public.treino_sessoes x set uso_registrado = true where x.id = s.id;
        select coalesce(max(x.minutos_voz), 0) into min_antes from public.treino_uso_mes x
         where x.empresa_id = s.empresa_id and x.competencia = comp;
        insert into public.treino_uso_mes as m (empresa_id, competencia, segundos_voz, minutos_voz, sessoes_voz, sessoes_texto, tokens)
        values (s.empresa_id, comp, case when s.modo = 'voz' then dur else 0 end,
                case when s.modo = 'voz' then ceil(dur / 60.0)::int else 0 end,
                case when s.modo = 'voz' then 1 else 0 end, case when s.modo = 'texto' then 1 else 0 end, tok)
        on conflict (empresa_id, competencia) do update set
            segundos_voz = m.segundos_voz + excluded.segundos_voz,
            minutos_voz = ceil((m.segundos_voz + excluded.segundos_voz) / 60.0)::int,
            sessoes_voz = m.sessoes_voz + excluded.sessoes_voz, sessoes_texto = m.sessoes_texto + excluded.sessoes_texto,
            tokens = m.tokens + excluded.tokens, atualizado_em = now()
        returning * into u;
        item_fat := case when s.modo = 'voz' then 'ia_treino_voz' else 'ia_treino_texto' end;
        total := case when s.modo = 'voz' then u.minutos_voz else u.sessoes_texto end;
        fr := public.franquia_treino(s.empresa_id, item_fat, comp);
        perform public.registrar_consumo_ia(s.empresa_id, item_fat,
                                            case when s.modo = 'voz' then dur / 60.0 else 1 end, tok,
                                            (dados ->> 'custo_real')::numeric, false, hoje);
        if total > fr then
            insert into public.consumo_mensageria as m (empresa_id, competencia, item, quantidade)
            values (s.empresa_id, comp, item_fat, total - fr)
            on conflict (empresa_id, competencia, item) do update set quantidade = excluded.quantidade, atualizado_em = now();
        end if;
        -- aviso no sino da empresa a 80% e 100% dos minutos de voz (uma vez por mês cada)
        if s.modo = 'voz' and fr > 0 then
            if min_antes < fr and u.minutos_voz >= fr then
                insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
                values ('empresa', s.empresa_id, 'atencao', format('Os %s minutos de voz do treino deste mês acabaram', fr),
                        'O treino por voz fica bloqueado até o mês que vem; o treino por texto continua.',
                        '/speech-analytics', format('treino_voz:%s:%s:100', s.empresa_id, comp))
                on conflict (chave) where chave is not null do nothing;
            elsif min_antes < ceil(fr * 0.8) and u.minutos_voz >= ceil(fr * 0.8) then
                insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
                values ('empresa', s.empresa_id, 'atencao',
                        format('Treino por voz: %s de %s minutos no mês (aviso de 80%%)', u.minutos_voz, fr),
                        'Ao chegar na franquia, o treino por voz fica bloqueado até o mês que vem; o texto continua.',
                        '/speech-analytics', format('treino_voz:%s:%s:80', s.empresa_id, comp))
                on conflict (chave) where chave is not null do nothing;
            end if;
        end if;
    end if;
    return jsonb_build_object('sessao', s.id, 'situacao', sit,
                              'conta_tentativa', sit = 'avaliada' and s.atribuicao_id is not null);
end $$;
revoke all on function public.registrar_sessao_treino(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_sessao_treino(bigint, jsonb) to service_role;

-- ================================================================ 11. retenção (recriada inteira: SQL 56, 58, 59, 65 + 90)
create or replace function public.apagar_voz_expirada() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    g int;
    c int;
    c2 int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor apaga gravações vencidas';
    end if;
    delete from public.voz_gravacoes v where v.expira_em < now() and not v.guarda;
    get diagnostics g = row_count;
    update public.voz_chamadas ch set codigos = null
      from public.voz_config cf
     where cf.empresa_id = ch.empresa_id and ch.codigos is not null and not ch.tem_gravacao
       and ch.ocorrido_em < now() - make_interval(days => cf.retencao_dias);
    get diagnostics c = row_count;
    update public.voz_chamadas ch set codigos = null
     where ch.codigos is not null and not ch.tem_gravacao and ch.ocorrido_em < now() - interval '90 days'
       and not exists (select 1 from public.voz_config cf where cf.empresa_id = ch.empresa_id);
    get diagnostics c2 = row_count;
    delete from public.voz_fluxo_passos p
     where p.entrou_em < now() - make_interval(days => coalesce((select cf.retencao_dias from public.voz_config cf
                                                                  where cf.empresa_id = p.empresa_id), 90));
    delete from public.crm_chamadas h
     where h.ocorrido_em < now() - make_interval(days => coalesce((select cf.retencao_dias from public.voz_config cf
                                                                    where cf.empresa_id = h.empresa_id), 90));
    update public.roleplay_conversas r set transcricao = null
     where r.transcricao is not null and r.transcricao_expira_em < now();
    delete from public.voz_resubmits r                     -- SQL 65: decisões do Resubmit na mesma retenção
     where r.criado_em < now() - make_interval(days => coalesce((select cf.retencao_dias from public.voz_config cf
                                                                 where cf.empresa_id = r.empresa_id), 90));
    delete from public.treino_transcricoes x where x.expira_em < now();   -- SQL 90: transcrição do treino (90 dias)
    delete from public.treino_feedback f where f.expira_em < now();       -- o trecho do feedback vai junto
    return jsonb_build_object('gravacoes', g, 'codigos', c + c2);
end $$;
revoke all on function public.apagar_voz_expirada() from public, anon, authenticated;
grant execute on function public.apagar_voz_expirada() to service_role;

do $conta$
declare n int;
begin
    select count(*) into n from public.treino_cenarios where empresa_id is null;
    raise notice 'SQL 90: % cenário(s) Padrão MotorCX (esperado 10)', n;
end $conta$;
