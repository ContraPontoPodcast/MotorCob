-- SQL 60 · Agente de voz: Speech Analytics (Visão geral, Qualidade e compliance, Operadores, Alertas, Busca,
-- Retroalimentação com o Relatório ao credor e Curadoria). Protótipo aprovado (ux/speech-analytics-prototipo.html,
-- necessidades SA1 a SA24; o Roleplay, SA25 a SA27, é do SQL 59 e fica fora daqui).
-- Decisões do dono (todas as escolhas padrão do protótipo aprovadas):
-- 1. Nota por operador: só Admin e supervisor (permissão nova ver_operadores), só com 30 ou mais ligações avaliadas
--    do operador; precisa do ID do operador vindo do discador (voz_gravacoes.operador_ref). Sem ID, a tela mostra o
--    aviso "o discador não manda" e só a equipe; o sistema nunca adivinha quem atendeu.
-- 2. Checklist: itens de lei têm trava (não desligam, não mudam de gravidade); versão nova vale só daqui para a frente
--    (vigente_de = amanhã) e a nota fica na versão em que foi dada.
-- 3. Alertas de vulnerabilidade só sinalizam (nada pausa, muda régua ou bloqueia) e o trecho nunca é guardado;
--    a fila só aparece com a permissão nova ver_alertas.
-- 4. Relatório ao credor: link de leitura sem login, válido por 30 dias, cada acesso registrado
--    (relatorio_credor_acessos); só o hash sha-256 do token fica no banco. Estimativa de impacto = metade da
--    diferença observada, faixa de 25% a 75% (motor/retroalimentacao.py).
-- 5. Recomendações: n >= 200 por grupo, diferença >= 5 p.p.; dispensada some por 90 dias. "Aplicar" só cria um
--    rascunho com o que já existe (estratégia nova sem vínculo nenhum, frase desligada) e nunca publica.
-- 6. Conjunto de referência (voz_golden_set) guarda o trecho mascarado além da retenção, sem id_cliente e sem
--    chamada_id.
-- 7. Tema novo só ganha nome pela Curadoria (permissão nova curadoria_voz).
-- 8. (revista pelo dono) IA é comercializada com margem de contribuição mínima de 70%: o custo NUNCA é repassado.
--    O uso grava custo e quantidade separados: custo real = unidades × custo unitário vigente (custos_ia_voz, só o
--    Master) em voz_analise_consumo; a quantidade cobrável (minuto analisado) vai para consumo_mensageria no item de IA
--    novo ia_speech_analytics, cobrado pelo preço da empresa (precos_empresa / valor_item), como os outros itens.
--    margem_speech_analytics() mostra receita, custo e %MC ao Master (impostos de parametros_margem). A trava geral
--    de %MC >= 70% nos itens de IA é de outro PR.
-- 9. Embeddings no mesmo provedor e região do resto do MotorCX de voz (Vertex AI em São Paulo, pela conta de
--    serviço da VM): vector(1536). Sem a extensão pgvector no banco, a coluna e a busca semântica não são criadas
--    (a busca por termo funciona igual) e voltam ao rodar este arquivo de novo depois de ligar a extensão.
-- Mapeamento para este banco: o "credor" e a "carteira" do protótipo são a mesma linha de public.credores (a
-- carteira do MotorCob); por isso não há carteira_id (SA1) e a política (SA21) fica em credores.politica.
-- LGPD: nenhuma tabela nova guarda CPF, nome ou telefone de devedor. Trecho só mascarado (texto_mascarado_ok), busca
-- recusa CPF, telefone e e-mail no termo, agregado com menos de 30 some (as tabelas _dia não são lidas pelo site:
-- só pelas funções que somam e escondem o grupo pequeno). Trecho, avaliação, exemplo e item aberto da curadoria vão
-- embora com a gravação; o alerta fica só como contagem.
-- Quem grava o dia a dia (agregados, trechos, avaliações, alertas, fila da curadoria) é a VM, com a chave do
-- servidor (service_role). O site só escreve por RPC security definer com search_path fixo. RLS em tudo.
-- Depende dos SQL 21 (equipe), 24/25 (permissões e auditoria), 35 (primeiro uso), 39 (avisos) e 56 (voz).
-- Pode rodar de novo sem erro.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('voz_conversao_dia',
--             'voz_audio_dia', 'voz_qualidade_dia', 'voz_temas', 'voz_temas_semana', 'checklists_qualidade',
--             'checklist_versoes', 'voz_avaliacoes', 'voz_operadores', 'voz_treino_exemplos', 'voz_alertas',
--             'voz_trechos', 'voz_buscas', 'voz_busca_resultados', 'recomendacoes', 'recomendacao_impacto',
--             'relatorios_credor', 'relatorio_credor_respostas', 'relatorio_credor_acessos', 'voz_curadoria_itens',
--             'voz_golden_set', 'voz_golden_medicoes', 'voz_melhorias', 'voz_analise_consumo', 'custos_ia_voz')) as tabelas, -- 25
--          (select unidade from public.cobranca_itens where codigo = 'ia_speech_analytics') as item_ia,          -- minuto analisado
--          (select count(*) from pg_tables where schemaname = 'public' and tablename in ('voz_trechos', 'voz_alertas',
--             'recomendacoes', 'relatorios_credor', 'voz_curadoria_itens', 'voz_golden_set') and not rowsecurity) as sem_rls, -- 0
--          (select count(*) from public.permissoes_catalogo where codigo in ('editar_checklist', 'ver_operadores',
--             'ver_alertas', 'curadoria_voz', 'enviar_relatorio_credor')) as permissoes_novas,                -- 5
--          (select count(*) from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id
--             where c.empresa_id is null and v.situacao = 'em_uso') as checklist_padrao,                      -- 1
--          public.termo_busca_proibido('123.456.789-09') as recusa_cpf,                                    -- true
--          exists (select 1 from information_schema.columns where table_name = 'voz_trechos'
--                  and column_name = 'embedding') as busca_semantica,                                      -- true com pgvector
--          has_function_privilege('anon', 'public.relatorio_credor_publico(text)', 'execute') as link_credor, -- true
--          has_table_privilege('authenticated', 'public.voz_conversao_dia', 'select') as site_le_dia;    -- false

-- ================================================================ 0. auxiliares
-- permissão de outra pessoa (para o sino): mesma regra de public.pode(), pelo id
create or replace function public.pode_usuario(uid uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.equipe and p.papel = 'admin' then true
                    when p.equipe and p.papel = 'planejamento'
                         and perm in ('enviar_arquivos', 'reenquadrar', 'editar_orquestracao', 'editar_credores',
                                      'editar_canais', 'gerenciar_usuarios', 'gerenciar_permissoes') then false
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

-- pessoa ativa do cliente (não da equipe MotorCX), da empresa, com a permissão
create or replace function public.cliente_pode(eid bigint, perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select eid is not null and not public.sou_equipe() and eid in (select public.minhas_empresas()) and public.pode(perm)
$$;
revoke all on function public.cliente_pode(bigint, text) from public, anon;
grant execute on function public.cliente_pode(bigint, text) to authenticated;

-- mescla profunda de objetos jsonb (b vence a)
create or replace function public.jsonb_mesclar(a jsonb, b jsonb) returns jsonb
language sql immutable parallel safe as $$
    select case
        when a is null then b
        when b is null then a
        when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then coalesce((
            select jsonb_object_agg(k, case when a ? k and b ? k then public.jsonb_mesclar(a -> k, b -> k)
                                            when b ? k then b -> k else a -> k end)
              from (select jsonb_object_keys(a) as k union select jsonb_object_keys(b)) s), '{}'::jsonb)
        else b end
$$;

-- texto que pode ser guardado ou mostrado: sem CPF, sem sequência longa de dígitos, sem telefone, sem e-mail
create or replace function public.texto_mascarado_ok(t text) returns boolean
language sql immutable parallel safe as $$
    select t is null or (t !~ '\d{3}\.\d{3}\.\d{3}-\d{2}' and t !~ '\d{8,}'
                         and t !~ '\(?\d{2}\)?\s?9?\d{4}-\d{4}' and t !~ '[^\s@]+@[^\s@]+\.[A-Za-z]{2,}')
$$;

-- termo de busca proibido: CPF, telefone (8+ dígitos sem os separadores) ou e-mail
create or replace function public.termo_busca_proibido(q text) returns boolean
language sql immutable parallel safe as $$
    select coalesce(q ~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}' or regexp_replace(q, '[\s().\-/+]', '', 'g') ~ '\d{8,}'
                    or q ~ '@', false)
$$;

-- conteúdo do relatório ao credor: só agregados. Qualquer "n" abaixo de 30 e qualquer chave de dado pessoal recusam.
create or replace function public.relatorio_agregado_ok(c jsonb) returns boolean
language sql immutable parallel safe as $$
    select c is not null and jsonb_typeof(c) = 'object'
       and not jsonb_path_exists(c, 'lax $.** ? (@.type() == "object" && @.n.type() == "number" && @.n < 30)')
       and not jsonb_path_exists(c, 'lax $.** ? (@.type() == "object" && exists (@.n) && @.n.type() != "number" && @.n.type() != "null")')
       and not jsonb_path_exists(c, 'lax $.** ? (@.type() == "object" && (exists (@.id_cliente) || exists (@.cpf)
                                       || exists (@.telefone) || exists (@.chamada_id) || exists (@.operador_ref)
                                       || exists (@.trecho) || exists (@.nome_cliente)))')
$$;

-- política da carteira (SA21): esquema fechado
create or replace function public.politica_credor_ok(p jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare k text;
begin
    if p is null then
        return true;
    end if;
    if jsonb_typeof(p) <> 'object' then
        return false;
    end if;
    for k in select jsonb_object_keys(p) loop
        if k not in ('parcela_minima', 'entrada_pct', 'juros_mes', 'prazo_max', 'dia_vencimento_livre',
                     'canais_pagamento') then
            return false;
        end if;
    end loop;
    if (p ? 'parcela_minima' and (jsonb_typeof(p -> 'parcela_minima') <> 'number' or (p ->> 'parcela_minima')::numeric < 0))
       or (p ? 'entrada_pct' and (jsonb_typeof(p -> 'entrada_pct') <> 'number'
                                  or (p ->> 'entrada_pct')::numeric not between 0 and 100))
       or (p ? 'juros_mes' and (jsonb_typeof(p -> 'juros_mes') <> 'number' or (p ->> 'juros_mes')::numeric not between 0 and 20))
       or (p ? 'prazo_max' and (jsonb_typeof(p -> 'prazo_max') <> 'number' or (p ->> 'prazo_max')::numeric not between 1 and 240))
       or (p ? 'dia_vencimento_livre' and jsonb_typeof(p -> 'dia_vencimento_livre') <> 'boolean') then
        return false;
    end if;
    if p ? 'canais_pagamento' and (jsonb_typeof(p -> 'canais_pagamento') <> 'array'
            or exists (select 1 from jsonb_array_elements(p -> 'canais_pagamento') x
                        where jsonb_typeof(x) <> 'string' or x #>> '{}' not in ('boleto', 'pix', 'cartao', 'debito'))) then
        return false;
    end if;
    return true;
end $$;

-- ================================================================ 1. permissões novas do cliente
create or replace view public.permissoes_catalogo as
select * from (values
  -- codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem
  ('baixar_listas',        'Operação',      'Baixar a lista do dia',        'Arquivos por canal (IDs e contatos) da Lista do dia.', true,  true,  true, true, 1),
  ('baixar_relatorios',    'Operação',      'Baixar arquivos completos',    'Fila completa, higienização, enriquecimento e demais saídas.', true, true, false, false, 2),
  ('baixar_comite',        'Gestão',        'Baixar o relatório de comitê', 'Planilha mensal do comitê.', true, true, false, true, 3),
  ('enviar_arquivos',      'Operação',      'Enviar arquivos',              'Cargas, acordos, pagamentos, ocorrências e retornos dos canais.', true, true, false, false, 4),
  ('reenquadrar',          'Operação',      'Reenquadrar agora',            'Pedir a rodada do motor na hora.', true, true, false, false, 5),
  ('editar_orquestracao',  'Configuração',  'Editar a orquestração',        'Segmentos, estratégias, personas e sugestões.', true, true, false, false, 6),
  ('editar_credores',      'Configuração',  'Editar credores',              'Criar credor, calendário, mapeamento de arquivos e regras de retorno.', true, true, false, false, 7),
  ('editar_canais',        'Configuração',  'Editar canais e frases',       'Canais da empresa (custo, horário) e playbook de frases.', true, true, false, false, 8),
  ('ver_acessos',          'Administração', 'Ver acessos',                  'Histórico de acessos ao site.', true, false, false, true, 9),
  ('ver_auditoria',        'Administração', 'Ver auditoria',                'Quem alterou o quê e quando.', true, false, false, false, 10),
  ('gerenciar_usuarios',   'Administração', 'Gerenciar usuários',           'Convidar, desativar, reativar, resetar senha e trocar perfil.', true, false, false, false, 11),
  ('gerenciar_permissoes', 'Administração', 'Gerenciar permissões',         'Ajustar o que cada perfil pode fazer.', true, false, false, false, 12),
  ('ver_faturamento',      'Administração', 'Ver faturamento',              'Plano, consumo do mês e faturas da empresa.', true, false, false, true, 13),
  ('enviar_mensagens',     'Operação',      'Enviar mensagens',             'Aprovar, pausar, retomar e cancelar lotes da Mensageria; descadastrar contatos.', true, true, false, false, 14),
  ('gerenciar_api',        'Administração', 'Gerenciar tokens de API',      'Criar e revogar os tokens que o sistema da empresa usa na API.', true, false, false, false, 15),
  ('pagar_faturas',        'Administração', 'Pagar faturas e recarregar',   'Pagar faturas (Pix, boleto ou cartão) e pedir recargas do pré-pago.', true, false, false, false, 16),
  ('ver_clientes',         'Operação',      'Ver clientes',                 'Lista e ficha dos clientes da carteira.', true, true, true, true, 17),
  ('ver_painel',           'Gestão',        'Ver o painel',                 'Painel de resultados da área.', true, true, true, true, 18),
  ('ouvir_gravacoes',      'Agente virtual', 'Ouvir gravações',             'Ouvir as gravações das ligações (link de 5 minutos; cada escuta fica registrada).', true, false, false, true, 19),
  ('ver_transcricoes',     'Agente virtual', 'Ler transcrições',            'Ler a transcrição redigida das ligações, sem copiar nem baixar.', true, false, false, true, 20),
  ('aprovar_roteiro_voz',  'Agente virtual', 'Aprovar o roteiro',           'Aprovar o roteiro do agente virtual e colocar a versão em uso.', true, false, false, false, 21),
  -- SQL 60 · Speech Analytics
  ('editar_checklist',     'Agente virtual', 'Editar o checklist de qualidade', 'Ajustar e publicar o checklist que dá nota às ligações (itens de lei não mudam).', true, false, false, false, 22),
  ('ver_operadores',       'Agente virtual', 'Ver a nota dos operadores',   'Nota e itens por operador do discador (só com 30 ou mais ligações avaliadas).', true, false, false, true, 23),
  ('ver_alertas',          'Agente virtual', 'Ver alertas das ligações',    'Procon, jurídico, ameaça, linguagem abusiva e vulnerabilidade (só sinaliza).', true, false, false, true, 24),
  ('curadoria_voz',        'Agente virtual', 'Fazer a curadoria da IA',     'Confirmar e corrigir o que a IA decidiu, dar nome aos temas novos e cuidar do backlog.', true, false, false, false, 25),
  ('enviar_relatorio_credor', 'Gestão',      'Enviar o relatório ao credor', 'Revisar, comentar e enviar o relatório mensal ao credor (link de 30 dias).', true, false, false, true, 26)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- ================================================================ 2. agregados (SA1 a SA4, SA8): só pelas funções
alter table public.voz_insights_dia drop constraint if exists voz_insights_dia_campo_check;
alter table public.voz_insights_dia add constraint voz_insights_dia_campo_check
    check (campo in ('conversas', 'motivo', 'objecao', 'promessa', 'retorno', 'nao_ligar', 'acordo', 'frase', 'oferta',
                     'tema'));

-- SA2: conversão por dimensão. dimensao total/valor todas = base; funil = etapas do funil.
create table if not exists public.voz_conversao_dia (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint not null default 0,
    data        date not null,
    origem      text not null check (origem in ('ia', 'discador')),
    persona     text not null default '' check (char_length(persona) <= 60),
    dimensao    text not null check (dimensao in ('total', 'motivo', 'objecao', 'frase', 'oferta', 'tema', 'funil',
                                                  'horario', 'canal_preferido')),
    valor       text not null check (valor ~ '^[a-z0-9_\-]{1,60}$'),
    conversas   int not null default 0 check (conversas >= 0),
    com_acordo  int not null default 0 check (com_acordo >= 0 and com_acordo <= conversas),
    primary key (empresa_id, credor_id, data, origem, persona, dimensao, valor)
);
comment on table public.voz_conversao_dia is 'SA2: conversas e acordos por dimensão e dia (só contagens). Gravada pela VM.';

-- SA3: métricas de áudio e sentimento (somas; a média sai na função)
create table if not exists public.voz_audio_dia (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint not null default 0,
    data            date not null,
    origem          text not null check (origem in ('ia', 'discador')),
    persona         text not null default '' check (char_length(persona) <= 60),
    ligacoes        int not null default 0 check (ligacoes >= 0),
    fala_agente_s   bigint not null default 0 check (fala_agente_s >= 0),
    fala_cliente_s  bigint not null default 0 check (fala_cliente_s >= 0),
    silencio_s      bigint not null default 0 check (silencio_s >= 0),
    interrupcoes    int not null default 0 check (interrupcoes >= 0),
    sentimento_ini  numeric(12, 3) not null default 0,
    sentimento_fim  numeric(12, 3) not null default 0,
    com_sentimento  int not null default 0 check (com_sentimento >= 0 and com_sentimento <= ligacoes),
    melhorou        int not null default 0 check (melhorou >= 0 and melhorou <= com_sentimento),
    primary key (empresa_id, credor_id, data, origem, persona)
);
comment on table public.voz_audio_dia is 'SA3: fala, silêncio, interrupções e sentimento (−1 a +1) somados por dia. Gravada pela VM.';

-- SA8: nota por item. item '_ligacao' = a ligação inteira (avaliadas, aprovadas = em conformidade, nota_soma).
create table if not exists public.voz_qualidade_dia (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null default 0,
    data          date not null,
    origem        text not null check (origem in ('ia', 'discador')),
    persona       text not null default '' check (char_length(persona) <= 60),
    operador_ref  text not null default '' check (operador_ref = '' or (operador_ref ~ '^[A-Za-z0-9_.:\-]{1,40}$'
                                                                         and operador_ref !~ '[0-9]{8,}')),
    versao_id     bigint not null default 0,
    item          text not null check (item ~ '^[a-z0-9_]{1,40}$'),
    avaliadas     int not null default 0 check (avaliadas >= 0),
    aprovadas     int not null default 0 check (aprovadas >= 0),
    na            int not null default 0 check (na >= 0),
    nota_soma     numeric(14, 2) not null default 0 check (nota_soma >= 0),
    primary key (empresa_id, credor_id, data, origem, persona, operador_ref, versao_id, item)
);
comment on table public.voz_qualidade_dia is
    'SA8: avaliações por item e dia (fica depois dos 90 dias: não tem dado por cliente). item _ligacao = a ligação.';

-- temas (agrupamento semanal dos trechos mascarados); nome só depois da Curadoria
create table if not exists public.voz_temas (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    nome           text check (nome is null or (char_length(trim(nome)) between 3 and 80 and public.texto_mascarado_ok(nome))),
    situacao       text not null default 'novo' check (situacao in ('novo', 'promovido', 'descartado')),
    criado_em      timestamptz not null default now(),
    promovido_por  uuid references auth.users (id) on delete set null,
    promovido_em   timestamptz,
    check ((situacao = 'promovido') = (nome is not null))
);
create table if not exists public.voz_temas_semana (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint not null default 0,
    semana      date not null check (extract(isodow from semana) = 1),
    tema_id     bigint not null references public.voz_temas (id) on delete cascade,
    conversas   int not null default 0 check (conversas >= 0),
    com_acordo  int not null default 0 check (com_acordo >= 0 and com_acordo <= conversas),
    primary key (empresa_id, credor_id, semana, tema_id)
);

-- uso de IA (decisão 8 revista): custo real só para a margem; a cobrança é a quantidade × preço da empresa
create table if not exists public.voz_analise_consumo (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    dia             date not null,
    componente      text not null check (componente in ('avaliador', 'extrator', 'alertas', 'embeddings', 'temas',
                                                        'golden')),
    chamadas        int not null default 0 check (chamadas >= 0),
    minutos         numeric(12, 2) not null default 0 check (minutos >= 0),
    minutos_cobrados numeric(12, 2) not null default 0 check (minutos_cobrados >= 0),
    tokens_entrada  bigint not null default 0 check (tokens_entrada >= 0),
    tokens_saida    bigint not null default 0 check (tokens_saida >= 0),
    custo_real      numeric(14, 5) not null default 0 check (custo_real >= 0),
    sem_custo       boolean not null default false,
    primary key (empresa_id, dia, componente)
);
alter table public.voz_analise_consumo add column if not exists minutos numeric(12, 2) not null default 0;
alter table public.voz_analise_consumo add column if not exists minutos_cobrados numeric(12, 2) not null default 0;
alter table public.voz_analise_consumo add column if not exists custo_real numeric(14, 5) not null default 0;
alter table public.voz_analise_consumo add column if not exists sem_custo boolean not null default false;
comment on table public.voz_analise_consumo is
    'Uso de IA do Speech Analytics: custo real (para a margem, só o Master) separado da quantidade cobrada (minutos_cobrados → consumo_mensageria, item ia_speech_analytics).';

-- custo unitário do fornecedor de IA, com vigência (só o Master): por mil tokens de entrada/saída e por minuto
create table if not exists public.custos_ia_voz (
    id              bigint generated always as identity primary key,
    componente      text not null check (componente in ('avaliador', 'extrator', 'alertas', 'embeddings', 'temas',
                                                        'golden')),
    por_mil_entrada numeric(12, 6) not null default 0 check (por_mil_entrada >= 0),
    por_mil_saida   numeric(12, 6) not null default 0 check (por_mil_saida >= 0),
    por_minuto      numeric(12, 6) not null default 0 check (por_minuto >= 0),
    vigente_desde   date not null,
    criado_em       timestamptz not null default now(),
    unique (componente, vigente_desde)
);
comment on table public.custos_ia_voz is 'Custo unitário da IA do Speech Analytics (fornecedor). Nunca vira preço: o cliente paga o preço do item.';

-- item de IA da fatura: minuto analisado (preço por empresa em precos_empresa)
insert into public.cobranca_itens (codigo, produto, nome, unidade, preco_de, modulo, ordem, descricao) values
    ('ia_speech_analytics', 'agente_voz', 'Agente virtual · Speech Analytics (IA)', 'minuto analisado', null,
     'agente_voz', 57, 'minuto de ligação analisado pela IA (nota do checklist, códigos, alertas e busca)')
on conflict (codigo) do nothing;

do $$
declare t text;
begin
    foreach t in array array['voz_conversao_dia', 'voz_audio_dia', 'voz_qualidade_dia', 'voz_temas_semana'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
        execute format('grant all on public.%I to service_role', t);
    end loop;
end $$;
alter table public.voz_temas enable row level security;
drop policy if exists voz_temas_ver on public.voz_temas;
create policy voz_temas_ver on public.voz_temas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_temas from anon;
revoke insert, update, delete on public.voz_temas from authenticated;
alter table public.voz_analise_consumo enable row level security;
alter table public.custos_ia_voz enable row level security;
drop policy if exists voz_analise_consumo_ver on public.voz_analise_consumo;
create policy voz_analise_consumo_ver on public.voz_analise_consumo for select to authenticated
    using (public.admin_equipe());
drop policy if exists custos_ia_voz_ver on public.custos_ia_voz;
create policy custos_ia_voz_ver on public.custos_ia_voz for select to authenticated using (public.admin_equipe());
drop policy if exists custos_ia_voz_gravar on public.custos_ia_voz;
create policy custos_ia_voz_gravar on public.custos_ia_voz for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.voz_analise_consumo, public.custos_ia_voz from anon;
revoke insert, update, delete on public.voz_analise_consumo from authenticated;

-- a VM registra o uso: custo real pelo custo unitário vigente (para a margem) e, separado, a quantidade cobrável no
-- item de IA da fatura. O custo nunca vai para a fatura.
create or replace function public.registrar_uso_ia_voz(empresa bigint, dia date, componente text, chamadas int,
                                                       minutos numeric, minutos_cobraveis numeric,
                                                       tokens_entrada bigint, tokens_saida bigint) returns numeric
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    c public.custos_ia_voz;
    custo numeric;
    comp date := date_trunc('month', dia)::date;
    cob bigint;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor registra o uso de IA';
    end if;
    if least(coalesce(chamadas, 0), coalesce(minutos, 0), coalesce(minutos_cobraveis, 0), coalesce(tokens_entrada, 0),
             coalesce(tokens_saida, 0)) < 0 then
        raise exception 'quantidades não podem ser negativas';
    end if;
    select * into c from public.custos_ia_voz x where x.componente = registrar_uso_ia_voz.componente and x.vigente_desde <= dia
     order by x.vigente_desde desc limit 1;
    custo := case when c.id is null then 0 else round(coalesce(tokens_entrada, 0) / 1000.0 * c.por_mil_entrada
                                                      + coalesce(tokens_saida, 0) / 1000.0 * c.por_mil_saida
                                                      + coalesce(minutos, 0) * c.por_minuto, 5) end;
    insert into public.voz_analise_consumo as v (empresa_id, dia, componente, chamadas, minutos, minutos_cobrados,
                                                 tokens_entrada, tokens_saida, custo_real, sem_custo)
    values (empresa, dia, componente, coalesce(chamadas, 0), coalesce(minutos, 0), coalesce(minutos_cobraveis, 0),
            coalesce(tokens_entrada, 0), coalesce(tokens_saida, 0), custo, c.id is null)
    on conflict on constraint voz_analise_consumo_pkey do update
        set chamadas = v.chamadas + excluded.chamadas, minutos = v.minutos + excluded.minutos,
            minutos_cobrados = v.minutos_cobrados + excluded.minutos_cobrados,
            tokens_entrada = v.tokens_entrada + excluded.tokens_entrada, tokens_saida = v.tokens_saida + excluded.tokens_saida,
            custo_real = v.custo_real + excluded.custo_real, sem_custo = v.sem_custo or excluded.sem_custo;
    -- cobrança: minuto inteiro acumulado no mês (o valor sai de precos_empresa na prévia da fatura)
    if coalesce(minutos_cobraveis, 0) > 0 then
        select ceil(sum(x.minutos_cobrados)) into cob from public.voz_analise_consumo x
         where x.empresa_id = empresa and x.dia >= comp and x.dia < comp + interval '1 month';
        insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade)
        values (empresa, comp, 'ia_speech_analytics', cob)
        on conflict (empresa_id, competencia, item) do update set quantidade = excluded.quantidade, atualizado_em = now();
    end if;
    return custo;
end $$;
revoke all on function public.registrar_uso_ia_voz(bigint, date, text, int, numeric, numeric, bigint, bigint)
    from public, anon, authenticated;
grant execute on function public.registrar_uso_ia_voz(bigint, date, text, int, numeric, numeric, bigint, bigint) to service_role;

-- margem do Speech Analytics por empresa no mês (só o Master): receita pelo preço do item, custo real, %MC
create or replace function public.margem_speech_analytics(competencia date)
returns table (empresa_id bigint, minutos bigint, receita numeric, custo numeric, impostos numeric, mc numeric,
               mc_pct numeric, falta_preco boolean, sem_custo boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    comp date := date_trunc('month', competencia)::date;
    imp numeric := coalesce((select p.impostos_pct from public.parametros_margem p where p.id = 1), 0);
begin
    if not public.admin_equipe() then
        raise exception 'custo e margem: só o Master';
    end if;
    return query
    with uso as (
        select v.empresa_id, sum(v.custo_real) custo, bool_or(v.sem_custo) sem_custo
          from public.voz_analise_consumo v where v.dia >= comp and v.dia < comp + interval '1 month' group by 1),
    q as (
        select u.empresa_id, coalesce(cm.quantidade, 0) qtd, u.custo, u.sem_custo
          from uso u left join public.consumo_mensageria cm
            on cm.empresa_id = u.empresa_id and cm.competencia = comp and cm.item = 'ia_speech_analytics'),
    r as (
        select q.*, (select x.valor from public.valor_item(q.empresa_id, 'ia_speech_analytics', q.qtd, comp) x) receita
          from q)
    select r.empresa_id, r.qtd, coalesce(r.receita, 0), round(r.custo, 2), round(coalesce(r.receita, 0) * imp / 100, 2),
           round(coalesce(r.receita, 0) * (1 - imp / 100) - r.custo, 2),
           case when coalesce(r.receita, 0) > 0 then round(100 * (r.receita * (1 - imp / 100) - r.custo) / r.receita, 1) end,
           r.receita is null and r.qtd > 0, r.sem_custo
      from r order by r.empresa_id;
end $$;
revoke all on function public.margem_speech_analytics(date) from public, anon;
grant execute on function public.margem_speech_analytics(date) to authenticated;

-- ================================================================ 3. checklist (SA5, SA6)
create table if not exists public.checklists_qualidade (
    id          bigint generated always as identity primary key,
    empresa_id  bigint references public.empresas (id) on delete cascade,     -- nulo = padrão MotorCX
    base_id     bigint references public.checklists_qualidade (id) on delete set null,
    nome        text not null check (char_length(trim(nome)) between 2 and 60),
    criado_em   timestamptz not null default now()
);
create unique index if not exists checklists_qualidade_um_por_empresa
    on public.checklists_qualidade (coalesce(empresa_id, 0));

create table if not exists public.checklist_versoes (
    id             bigint generated always as identity primary key,
    checklist_id   bigint not null references public.checklists_qualidade (id) on delete cascade,
    versao         int not null check (versao >= 1),
    situacao       text not null default 'rascunho' check (situacao in ('rascunho', 'em_uso', 'arquivada')),
    itens          jsonb not null,
    criado_por     uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em      timestamptz not null default now(),
    publicada_por  uuid references auth.users (id) on delete set null,
    publicada_em   timestamptz,
    vigente_de     date,
    vigente_ate    date,
    unique (checklist_id, versao),
    check (situacao = 'rascunho' or vigente_de is not null)
);
create unique index if not exists checklist_versoes_um_rascunho on public.checklist_versoes (checklist_id)
    where situacao = 'rascunho';
create unique index if not exists checklist_versoes_um_em_uso on public.checklist_versoes (checklist_id)
    where situacao = 'em_uso';

-- itens: [{id, texto, criterio, gravidade bloqueante|importante|boa_pratica, aplica ia|humano|ambos, peso 1..3,
--          origem padrao|ajustado|cliente, trava bool, on bool}]. Item com trava: sempre ligado e bloqueante.
create or replace function public.checklist_itens_ok(itens jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare
    i jsonb;
    k text;
    ids text[] := '{}';
begin
    if itens is null or jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) not between 1 and 40 then
        return false;
    end if;
    for i in select * from jsonb_array_elements(itens) loop
        if jsonb_typeof(i) <> 'object' then
            return false;
        end if;
        for k in select jsonb_object_keys(i) loop
            if k not in ('id', 'texto', 'criterio', 'gravidade', 'aplica', 'peso', 'origem', 'trava', 'on') then
                return false;
            end if;
        end loop;
        if jsonb_typeof(i -> 'id') is distinct from 'string' or (i ->> 'id') !~ '^[a-z][a-z0-9_]{1,39}$'
           or (i ->> 'id') = any (ids) or (i ->> 'id') = '_ligacao'
           or jsonb_typeof(i -> 'texto') is distinct from 'string' or char_length(trim(i ->> 'texto')) not between 5 and 140
           or not public.texto_mascarado_ok(i ->> 'texto')
           or (i ? 'criterio' and (jsonb_typeof(i -> 'criterio') <> 'string' or char_length(i ->> 'criterio') > 400))
           or coalesce(i ->> 'gravidade', '') not in ('bloqueante', 'importante', 'boa_pratica')
           or coalesce(i ->> 'aplica', '') not in ('ia', 'humano', 'ambos')
           or jsonb_typeof(i -> 'peso') is distinct from 'number' or (i ->> 'peso') not in ('1', '2', '3')
           or coalesce(i ->> 'origem', '') not in ('padrao', 'ajustado', 'cliente')
           or jsonb_typeof(i -> 'trava') is distinct from 'boolean' or jsonb_typeof(i -> 'on') is distinct from 'boolean' then
            return false;
        end if;
        if (i ->> 'trava')::boolean and (not (i ->> 'on')::boolean or i ->> 'gravidade' <> 'bloqueante') then
            return false;
        end if;
        ids := ids || (i ->> 'id');
    end loop;
    return true;
end $$;
alter table public.checklist_versoes drop constraint if exists checklist_versoes_itens_ok;
alter table public.checklist_versoes add constraint checklist_versoes_itens_ok check (public.checklist_itens_ok(itens));

-- versões não se editam depois de publicadas (só a situação e a vigência mudam, pela função)
create or replace function public.travar_checklist_versao() returns trigger
language plpgsql set search_path = public as $$
begin
    if old.situacao <> 'rascunho' and (new.itens is distinct from old.itens or new.versao <> old.versao
                                        or new.checklist_id <> old.checklist_id) then
        raise exception 'versão publicada do checklist não muda: crie um rascunho novo';
    end if;
    return new;
end $$;
revoke all on function public.travar_checklist_versao() from public, anon, authenticated;
drop trigger if exists travar_checklist_versao on public.checklist_versoes;
create trigger travar_checklist_versao before update on public.checklist_versoes
    for each row execute function public.travar_checklist_versao();

-- padrão MotorCX v1 (itens de lei com trava: CDC art. 42 e LGPD)
do $$
declare cid bigint;
begin
    select id into cid from public.checklists_qualidade where empresa_id is null;
    if cid is null then
        insert into public.checklists_qualidade (empresa_id, nome) values (null, 'Padrão MotorCX') returning id into cid;
    end if;
    if not exists (select 1 from public.checklist_versoes where checklist_id = cid) then
        insert into public.checklist_versoes (checklist_id, versao, situacao, itens, criado_por, publicada_em, vigente_de)
        values (cid, 1, 'em_uso', '[
          {"id": "ck_ident", "texto": "Se identificou (empresa e motivo da ligação)", "gravidade": "importante", "aplica": "ambos", "peso": 2, "origem": "padrao", "trava": false, "on": true},
          {"id": "ck_cpc", "texto": "Confirmou a identidade antes de falar valor", "gravidade": "bloqueante", "aplica": "ambos", "peso": 3, "origem": "padrao", "trava": true, "on": true},
          {"id": "ck_ameaca", "texto": "Não ameaçou nem constrangeu", "gravidade": "bloqueante", "aplica": "ambos", "peso": 3, "origem": "padrao", "trava": true, "on": true},
          {"id": "ck_oferta", "texto": "Ofereceu condição", "gravidade": "importante", "aplica": "ambos", "peso": 2, "origem": "padrao", "trava": false, "on": true},
          {"id": "ck_canais", "texto": "Informou os canais de pagamento", "gravidade": "importante", "aplica": "ambos", "peso": 2, "origem": "padrao", "trava": false, "on": true},
          {"id": "ck_naoligue", "texto": "Respeitou o \"não me ligue\"", "gravidade": "bloqueante", "aplica": "ambos", "peso": 3, "origem": "padrao", "trava": true, "on": true},
          {"id": "ck_terceiro", "texto": "Não falou da dívida com terceiro", "gravidade": "bloqueante", "aplica": "ambos", "peso": 3, "origem": "padrao", "trava": true, "on": true},
          {"id": "ck_resumo", "texto": "Resumiu o combinado antes de encerrar", "gravidade": "boa_pratica", "aplica": "ambos", "peso": 1, "origem": "padrao", "trava": false, "on": true}
        ]'::jsonb, null, now(), date '2026-01-01');
    end if;
end $$;

alter table public.checklists_qualidade enable row level security;
alter table public.checklist_versoes enable row level security;
drop policy if exists checklists_qualidade_ver on public.checklists_qualidade;
create policy checklists_qualidade_ver on public.checklists_qualidade for select to authenticated
    using (empresa_id is null or empresa_id in (select public.minhas_empresas()));
drop policy if exists checklist_versoes_ver on public.checklist_versoes;
create policy checklist_versoes_ver on public.checklist_versoes for select to authenticated
    using (exists (select 1 from public.checklists_qualidade c where c.id = checklist_id
                    and (c.empresa_id is null or c.empresa_id in (select public.minhas_empresas()))));
revoke all on public.checklists_qualidade, public.checklist_versoes from anon;
revoke insert, update, delete on public.checklists_qualidade, public.checklist_versoes from authenticated;

-- versão vigente num dia (a do cliente; sem checklist próprio, a do padrão)
create or replace function public.checklist_vigente(empresa bigint, dia date) returns bigint
language sql stable security definer set search_path = public as $$
    select v.id from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id
     where v.situacao <> 'rascunho' and v.vigente_de <= dia and (v.vigente_ate is null or v.vigente_ate >= dia)
       and (c.empresa_id = empresa or c.empresa_id is null)
     order by (c.empresa_id is null), v.vigente_de desc limit 1
$$;
revoke all on function public.checklist_vigente(bigint, date) from public, anon, authenticated;
grant execute on function public.checklist_vigente(bigint, date) to service_role;

-- SA6: rascunho do checklist da empresa (cria o checklist na primeira vez). Itens de trava do padrão em uso
-- precisam estar todos lá, ligados, bloqueantes e com o mesmo texto.
create or replace function public.salvar_rascunho_checklist(empresa bigint, itens jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    cid bigint;
    pad jsonb;
    t jsonb;
    vid bigint;
    proxima int;
begin
    if not public.cliente_pode(empresa, 'editar_checklist') then
        raise exception 'sem permissão para editar o checklist (editar_checklist)';
    end if;
    if not public.checklist_itens_ok(itens) then
        raise exception 'itens do checklist inválidos';
    end if;
    select v.itens into pad from public.checklist_versoes v join public.checklists_qualidade c on c.id = v.checklist_id
     where c.empresa_id is null and v.situacao = 'em_uso';
    for t in select * from jsonb_array_elements(coalesce(pad, '[]')) x where (x ->> 'trava')::boolean loop
        if not exists (select 1 from jsonb_array_elements(itens) i
                        where i ->> 'id' = t ->> 'id' and (i ->> 'trava')::boolean and (i ->> 'on')::boolean
                          and i ->> 'gravidade' = 'bloqueante' and i ->> 'texto' = t ->> 'texto') then
            raise exception 'o item de lei "%" não pode ser tirado, desligado nem mudado', t ->> 'texto';
        end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(itens) i where (i ->> 'trava')::boolean
                  and not exists (select 1 from jsonb_array_elements(coalesce(pad, '[]')) x
                                   where x ->> 'id' = i ->> 'id' and (x ->> 'trava')::boolean)) then
        raise exception 'só os itens de lei do padrão têm trava';
    end if;
    select id into cid from public.checklists_qualidade where empresa_id = empresa;
    if cid is null then
        insert into public.checklists_qualidade (empresa_id, base_id, nome)
        values (empresa, (select id from public.checklists_qualidade where empresa_id is null),
                coalesce((select left(nome, 50) from public.empresas where id = empresa), 'Checklist'))
        returning id into cid;
    end if;
    update public.checklist_versoes set itens = salvar_rascunho_checklist.itens
     where checklist_id = cid and situacao = 'rascunho' returning id into vid;
    if vid is null then
        select coalesce(max(versao), 0) + 1 into proxima from public.checklist_versoes where checklist_id = cid;
        insert into public.checklist_versoes (checklist_id, versao, situacao, itens)
        values (cid, proxima, 'rascunho', salvar_rascunho_checklist.itens) returning id into vid;
    end if;
    return vid;
end $$;

-- SA6: publicar vale a partir de amanhã (Brasília). A versão anterior fica até hoje. Mudar não reavalia o passado.
create or replace function public.publicar_checklist(versao_id bigint) returns date
language plpgsql security definer set search_path = public as $$
declare
    v public.checklist_versoes;
    eid bigint;
    amanha date := (now() at time zone 'America/Sao_Paulo')::date + 1;
begin
    select * into v from public.checklist_versoes where id = versao_id for update;
    select empresa_id into eid from public.checklists_qualidade where id = v.checklist_id;
    if v.id is null or eid is null or not public.cliente_pode(eid, 'editar_checklist') then
        raise exception 'sem permissão para publicar este checklist (editar_checklist)';
    end if;
    if v.situacao <> 'rascunho' then
        raise exception 'só um rascunho é publicado';
    end if;
    update public.checklist_versoes set situacao = 'arquivada', vigente_ate = amanha - 1
     where checklist_id = v.checklist_id and situacao = 'em_uso';
    update public.checklist_versoes set situacao = 'em_uso', publicada_por = auth.uid(), publicada_em = now(),
           vigente_de = amanha
     where id = versao_id;
    return amanha;
end $$;
revoke all on function public.salvar_rascunho_checklist(bigint, jsonb), public.publicar_checklist(bigint) from public, anon;
grant execute on function public.salvar_rascunho_checklist(bigint, jsonb), public.publicar_checklist(bigint) to authenticated;

-- ================================================================ 4. operadores do discador (SA9, SA10, SA11)
create table if not exists public.voz_operadores (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    discador      text not null check (discador in ('aspect', 'olos', '2cx', '3cplus', 'totalip', 'tactium', 'fastway',
                                                    'generico')),
    operador_ref  text not null check (operador_ref ~ '^[A-Za-z0-9_.:\-]{1,40}$' and operador_ref !~ '[0-9]{8,}'),
    apelido       text not null check (char_length(trim(apelido)) between 1 and 30 and apelido !~ '[0-9]{6,}'
                                       and apelido !~ '@'),
    usuario_id    uuid references auth.users (id) on delete set null,       -- o próprio operador, quando tem login
    ativo         boolean not null default true,
    criado_em     timestamptz not null default now(),
    unique (empresa_id, operador_ref)
);
comment on table public.voz_operadores is 'Operador do discador do cliente: ID do discador e apelido. Nunca CPF, nome completo ou e-mail.';

alter table public.voz_gravacoes add column if not exists operador_ref text
    check (operador_ref is null or (operador_ref ~ '^[A-Za-z0-9_.:\-]{1,40}$' and operador_ref !~ '[0-9]{8,}'));
alter table public.voz_import_execucoes add column if not exists sem_operador int not null default 0
    check (sem_operador >= 0);

create table if not exists public.voz_treino_exemplos (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint references public.credores (id) on delete set null,
    gravacao_id      bigint references public.voz_gravacoes (id) on delete set null,
    operador_ref     text check (operador_ref is null or operador_ref ~ '^[A-Za-z0-9_.:\-]{1,40}$'),
    tag              text not null check (char_length(trim(tag)) between 3 and 80 and public.texto_mascarado_ok(tag)),
    nota             numeric(5, 2) check (nota between 0 and 100),
    duracao_s        int check (duracao_s >= 0),
    trecho_redigido  text check (char_length(trecho_redigido) <= 600 and public.texto_mascarado_ok(trecho_redigido)),
    situacao         text not null default 'proposto' check (situacao in ('proposto', 'aprovado', 'recusado')),
    aprovado_por     uuid references auth.users (id) on delete set null,
    aprovado_em      timestamptz,
    criado_em        timestamptz not null default now()
);
comment on table public.voz_treino_exemplos is
    'SA11: ligação-exemplo para treino. Entra na biblioteca com o ok do supervisor. O trecho some com a gravação.';

alter table public.voz_operadores enable row level security;
alter table public.voz_treino_exemplos enable row level security;
drop policy if exists voz_operadores_ver on public.voz_operadores;
create policy voz_operadores_ver on public.voz_operadores for select to authenticated
    using (public.cliente_pode(empresa_id, 'ver_operadores') or usuario_id = auth.uid());
drop policy if exists voz_treino_exemplos_ver on public.voz_treino_exemplos;
create policy voz_treino_exemplos_ver on public.voz_treino_exemplos for select to authenticated
    using (public.cliente_pode(empresa_id, 'ver_operadores'));
revoke all on public.voz_operadores, public.voz_treino_exemplos from anon;
revoke insert, update, delete on public.voz_operadores, public.voz_treino_exemplos from authenticated;

create or replace function public.salvar_operador_voz(empresa bigint, discador text, operador_ref text, apelido text,
                                                      ativo boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare oid bigint;
begin
    if not public.cliente_pode(empresa, 'ver_operadores') then
        raise exception 'sem permissão para cadastrar operadores (ver_operadores)';
    end if;
    insert into public.voz_operadores as o (empresa_id, discador, operador_ref, apelido, ativo)
    values (empresa, salvar_operador_voz.discador, trim(salvar_operador_voz.operador_ref), trim(salvar_operador_voz.apelido),
            coalesce(salvar_operador_voz.ativo, true))
    on conflict (empresa_id, operador_ref) do update set apelido = excluded.apelido, ativo = excluded.ativo,
                                                         discador = excluded.discador
    returning o.id into oid;
    return oid;
end $$;

create or replace function public.decidir_exemplo_treino(exemplo bigint, aprovar boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e public.voz_treino_exemplos;
begin
    select * into e from public.voz_treino_exemplos where id = exemplo;
    if e.id is null or not public.cliente_pode(e.empresa_id, 'ver_operadores') then
        raise exception 'sem permissão para aprovar exemplos de treino (ver_operadores)';
    end if;
    update public.voz_treino_exemplos set situacao = case when aprovar then 'aprovado' else 'recusado' end,
           aprovado_por = auth.uid(), aprovado_em = now()
     where id = exemplo;
end $$;
revoke all on function public.salvar_operador_voz(bigint, text, text, text, boolean),
    public.decidir_exemplo_treino(bigint, boolean) from public, anon;
grant execute on function public.salvar_operador_voz(bigint, text, text, text, boolean),
    public.decidir_exemplo_treino(bigint, boolean) to authenticated;

-- ================================================================ 5. avaliações (SA7)
create table if not exists public.voz_avaliacoes (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint references public.credores (id) on delete set null,
    chamada_id       bigint not null references public.voz_chamadas (id) on delete cascade,
    gravacao_id      bigint references public.voz_gravacoes (id) on delete cascade,
    versao_id        bigint not null references public.checklist_versoes (id),
    origem           text not null check (origem in ('ia', 'discador')),
    operador_ref     text check (operador_ref is null or (operador_ref ~ '^[A-Za-z0-9_.:\-]{1,40}$'
                                                          and operador_ref !~ '[0-9]{8,}')),
    nota             numeric(5, 2) not null check (nota between 0 and 100),
    itens            jsonb not null check (jsonb_typeof(itens) = 'object'
                                           and not jsonb_path_exists(itens, 'strict $.* ? (@ != "sim" && @ != "nao" && @ != "na")')),
    evidencia        jsonb not null default '{}' check (jsonb_typeof(evidencia) = 'object'
                                           and not jsonb_path_exists(evidencia, 'strict $.* ? (@.type() != "array" || @.size() != 2)')),
    reprovada        boolean not null default false,
    item_reprovado   text check (item_reprovado ~ '^[a-z][a-z0-9_]{1,39}$'),
    trecho_redigido  text check (char_length(trecho_redigido) <= 600 and public.texto_mascarado_ok(trecho_redigido)),
    modelo           text check (modelo ~ '^[A-Za-z0-9_.:\-]{1,60}$'),
    avaliada_em      timestamptz not null default now(),
    contestada_por   uuid references auth.users (id) on delete set null,
    contestada_em    timestamptz,
    unique (chamada_id, origem)
);
create index if not exists voz_avaliacoes_lista on public.voz_avaliacoes (empresa_id, avaliada_em desc) where reprovada;
comment on table public.voz_avaliacoes is
    'SA7: nota da ligação na versão vigente do checklist (sim | nao | na por item, evidência só como posição no tempo). Vai embora com a gravação.';
alter table public.voz_avaliacoes enable row level security;
drop policy if exists voz_avaliacoes_ver on public.voz_avaliacoes;
create policy voz_avaliacoes_ver on public.voz_avaliacoes for select to authenticated
    using (public.cliente_pode(empresa_id, 'ver_transcricoes'));
revoke all on public.voz_avaliacoes from anon;
revoke insert, update, delete on public.voz_avaliacoes from authenticated;

-- ================================================================ 6. alertas (SA12, SA13)
create table if not exists public.voz_alertas (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint references public.credores (id) on delete set null,
    chamada_id       bigint references public.voz_chamadas (id) on delete set null,
    gravacao_id      bigint references public.voz_gravacoes (id) on delete set null,
    id_cliente       text check (char_length(id_cliente) between 1 and 60),
    tipo             text not null check (tipo in ('procon', 'juridico', 'ameaca', 'abusiva', 'vulnerabilidade')),
    sinal            text check (sinal in ('idade_confusao', 'saude', 'luto', 'desemprego_recente')),
    falante          text check (falante in ('cliente', 'agente', 'operador')),
    origem           text not null default 'ia' check (origem in ('ia', 'discador')),
    operador_ref     text check (operador_ref is null or operador_ref ~ '^[A-Za-z0-9_.:\-]{1,40}$'),
    inicio_s         numeric(8, 2) check (inicio_s >= 0),
    trecho_redigido  text check (char_length(trecho_redigido) <= 600 and public.texto_mascarado_ok(trecho_redigido)),
    criado_em        timestamptz not null default now(),
    situacao         text not null default 'novo' check (situacao in ('novo', 'revisado')),
    revisado_por     uuid references auth.users (id) on delete set null,
    revisado_em      timestamptz,
    desfecho         text check (desfecho in ('tratado', 'sem_acao', 'juridico', 'regua_ajustada', 'conversado_operador')),
    observacao       text check (char_length(observacao) <= 200 and public.texto_mascarado_ok(observacao)),
    check ((tipo = 'vulnerabilidade') = (sinal is not null)),
    check (tipo <> 'vulnerabilidade' or trecho_redigido is null),
    check ((situacao = 'revisado') = (revisado_em is not null and desfecho is not null))
);
create index if not exists voz_alertas_fila on public.voz_alertas (empresa_id, situacao, criado_em desc);
comment on table public.voz_alertas is
    'SA12: alerta só avisa (nada pausa nem bloqueia). Vulnerabilidade guarda só o sinal, nunca o trecho. Na retenção ficam tipo, data, carteira e desfecho.';
alter table public.voz_alertas enable row level security;
drop policy if exists voz_alertas_ver on public.voz_alertas;
create policy voz_alertas_ver on public.voz_alertas for select to authenticated
    using (public.cliente_pode(empresa_id, 'ver_alertas'));
revoke all on public.voz_alertas from anon;
revoke insert, update, delete on public.voz_alertas from authenticated;

-- a fila (trecho só para quem também lê transcrições)
create or replace function public.alertas_voz(empresa bigint, filtro_tipo text default null, filtro_situacao text default null,
                                              de date default null, ate date default null, limite int default 50)
returns table (id bigint, tipo text, sinal text, falante text, origem text, operador text, id_cliente text,
               gravacao_id bigint, credor_id bigint, criado_em timestamptz, trecho text, situacao text,
               revisado_por text, revisado_em timestamptz, desfecho text, observacao text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    ve_trecho boolean := public.pode('ver_transcricoes');
    ve_op boolean := public.pode('ver_operadores');
begin
    if not public.cliente_pode(empresa, 'ver_alertas') then
        raise exception 'sem permissão para ver alertas (ver_alertas)';
    end if;
    return query
    select a.id, a.tipo, a.sinal, a.falante, a.origem,
           case when ve_op and a.operador_ref is not null
                then a.operador_ref || coalesce(' · ' || o.apelido, '') end,
           a.id_cliente, a.gravacao_id, a.credor_id, a.criado_em,
           case when ve_trecho then a.trecho_redigido end, a.situacao,
           (select coalesce(nullif(trim(p.nome), ''), 'Pessoa da empresa') from public.perfis p where p.id = a.revisado_por),
           a.revisado_em, a.desfecho, a.observacao
      from public.voz_alertas a
      left join public.voz_operadores o on o.empresa_id = a.empresa_id and o.operador_ref = a.operador_ref
     where a.empresa_id = empresa
       and (filtro_tipo is null or a.tipo = filtro_tipo)
       and (filtro_situacao is null or a.situacao = filtro_situacao)
       and (de is null or (a.criado_em at time zone 'America/Sao_Paulo')::date >= de)
       and (ate is null or (a.criado_em at time zone 'America/Sao_Paulo')::date <= ate)
     order by a.criado_em desc
     limit least(greatest(coalesce(limite, 50), 1), 200);
end $$;

create or replace function public.contagem_alertas_voz(empresa bigint, de date, ate date)
returns table (tipo text, total bigint, abertos bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
    if not public.cliente_pode(empresa, 'ver_alertas') then
        raise exception 'sem permissão para ver alertas (ver_alertas)';
    end if;
    return query
    select a.tipo, count(*), count(*) filter (where a.situacao = 'novo')
      from public.voz_alertas a
     where a.empresa_id = empresa and (a.criado_em at time zone 'America/Sao_Paulo')::date between de and ate
     group by a.tipo;
end $$;

-- SA13: grava quem e quando; não muda nada fora do alerta
create or replace function public.revisar_alerta_voz(alerta bigint, desfecho text, observacao text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare a public.voz_alertas;
begin
    select * into a from public.voz_alertas where id = alerta for update;
    if a.id is null or not public.cliente_pode(a.empresa_id, 'ver_alertas') then
        raise exception 'sem permissão para revisar alertas (ver_alertas)';
    end if;
    if a.situacao = 'revisado' then
        raise exception 'este alerta já foi revisado';
    end if;
    if desfecho = 'regua_ajustada' and a.tipo <> 'vulnerabilidade' or desfecho = 'conversado_operador' and a.tipo <> 'ameaca' then
        raise exception 'desfecho não vale para este tipo de alerta';
    end if;
    if not public.texto_mascarado_ok(observacao) then
        raise exception 'a observação não pode ter CPF, telefone nem e-mail';
    end if;
    update public.voz_alertas v set situacao = 'revisado', revisado_por = auth.uid(), revisado_em = now(),
           desfecho = revisar_alerta_voz.desfecho, observacao = nullif(trim(revisar_alerta_voz.observacao), '')
     where v.id = alerta;
end $$;
revoke all on function public.alertas_voz(bigint, text, text, date, date, int), public.contagem_alertas_voz(bigint, date, date),
    public.revisar_alerta_voz(bigint, text, text) from public, anon;
grant execute on function public.alertas_voz(bigint, text, text, date, date, int), public.contagem_alertas_voz(bigint, date, date),
    public.revisar_alerta_voz(bigint, text, text) to authenticated;

-- sino: um aviso por pessoa com ver_alertas, agrupado por hora (a VM chama a cada hora)
create or replace function public.avisar_alertas_voz() returns int
language plpgsql security definer set search_path = public as $$
declare
    r record;
    k int;
    n int := 0;
    hora text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24');
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor avisa alertas';
    end if;
    for r in select a.empresa_id, count(*) as q from public.voz_alertas a
              where a.situacao = 'novo' and a.criado_em >= now() - interval '1 hour' group by a.empresa_id loop
        insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave)
        select 'usuario', r.empresa_id, p.id, 'atencao',
               r.q || case when r.q = 1 then ' alerta novo nas ligações' else ' alertas novos nas ligações' end,
               'Procon, jurídico, ameaça, linguagem abusiva ou vulnerabilidade. Alerta só avisa: nada foi pausado.',
               '/speech-analytics/alertas', 'voz_alertas:' || p.id || ':' || hora
          from public.perfis p
         where p.empresa_id = r.empresa_id and p.ativo and not p.equipe and public.pode_usuario(p.id, 'ver_alertas')
        on conflict do nothing;
        get diagnostics k = row_count;
        n := n + k;
    end loop;
    return n;
end $$;
revoke all on function public.avisar_alertas_voz() from public, anon, authenticated;
grant execute on function public.avisar_alertas_voz() to service_role;

-- ================================================================ 7. trechos e busca (SA14, SA15, SA16)
create table if not exists public.voz_trechos (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint references public.credores (id) on delete set null,
    gravacao_id      bigint not null references public.voz_gravacoes (id) on delete cascade,
    origem           text not null check (origem in ('ia', 'discador')),
    inicio_s         numeric(8, 2) not null check (inicio_s >= 0),
    fim_s            numeric(8, 2) not null check (fim_s >= inicio_s),
    falante          text not null check (falante in ('agente', 'cliente', 'operador')),
    texto_redigido   text not null check (char_length(texto_redigido) between 1 and 2000
                                          and public.texto_mascarado_ok(texto_redigido)),
    tsv              tsvector generated always as (to_tsvector('portuguese', texto_redigido)) stored,
    expira_em        timestamptz not null,
    criado_em        timestamptz not null default now(),
    unique (gravacao_id, inicio_s, falante)
);
create index if not exists voz_trechos_tsv on public.voz_trechos using gin (tsv);
create index if not exists voz_trechos_empresa on public.voz_trechos (empresa_id, expira_em);
comment on table public.voz_trechos is
    'SA14: janelas de 15 a 30 s por falante, já mascaradas (CPF, cartão, telefone, e-mail, nomes, saúde) antes do embedding. Vão embora com a gravação.';

-- expira junto com a gravação
create or replace function public.validade_trecho_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    select g.expira_em, g.empresa_id into new.expira_em, new.empresa_id from public.voz_gravacoes g where g.id = new.gravacao_id;
    return new;
end $$;
revoke all on function public.validade_trecho_voz() from public, anon, authenticated;
drop trigger if exists validade_trecho_voz on public.voz_trechos;
create trigger validade_trecho_voz before insert on public.voz_trechos
    for each row execute function public.validade_trecho_voz();

alter table public.voz_trechos enable row level security;
revoke all on public.voz_trechos from anon, authenticated;     -- o site só busca pela função (registrada)
grant all on public.voz_trechos to service_role;

create table if not exists public.voz_buscas (
    id          bigint generated always as identity primary key,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    usuario     uuid not null default auth.uid() references auth.users (id),
    termo       text not null check (char_length(termo) between 2 and 120),
    modo        text not null check (modo in ('semantica', 'termo')),
    filtros     jsonb not null default '{}' check (jsonb_typeof(filtros) = 'object'),
    situacao    text not null default 'pronta' check (situacao in ('pendente', 'pronta', 'erro')),
    resultados  int not null default 0 check (resultados >= 0),
    em          timestamptz not null default now()
);
create index if not exists voz_buscas_empresa on public.voz_buscas (empresa_id, em desc);
create index if not exists voz_buscas_pendentes on public.voz_buscas (em) where situacao = 'pendente';
comment on table public.voz_buscas is 'SA16: toda busca nas transcrições (quem, termo, modo, hora, resultados). Leitura só do Admin.';
create table if not exists public.voz_busca_resultados (
    busca_id      bigint not null references public.voz_buscas (id) on delete cascade,
    trecho_id     bigint not null references public.voz_trechos (id) on delete cascade,
    similaridade  numeric(5, 4),
    primary key (busca_id, trecho_id)
);
alter table public.voz_buscas enable row level security;
alter table public.voz_busca_resultados enable row level security;
drop policy if exists voz_buscas_ver on public.voz_buscas;
create policy voz_buscas_ver on public.voz_buscas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and not public.sou_equipe() and public.tem_papel('admin'));
revoke all on public.voz_buscas from anon;
revoke insert, update, delete on public.voz_buscas from authenticated;
revoke all on public.voz_busca_resultados from anon, authenticated;
drop trigger if exists z_auditar on public.voz_buscas;
create trigger z_auditar after insert on public.voz_buscas for each row execute function public.auditar();

-- pgvector (decisão 9): mesma dimensão do resto do MotorCX de voz. Sem a extensão, nada disto é criado.
do $$
declare esq text;
begin
    if not exists (select 1 from pg_extension where extname = 'vector')
       and exists (select 1 from pg_available_extensions where name = 'vector') then
        create schema if not exists extensions;
        create extension if not exists vector with schema extensions;
    end if;
    select n.nspname into esq from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector';
    if esq is null then
        raise notice 'pgvector não está disponível: busca semântica desligada (a busca por termo funciona)';
        return;
    end if;
    execute format('alter table public.voz_trechos add column if not exists embedding %I.vector(1536)', esq);
    execute format('create index if not exists voz_trechos_embedding on public.voz_trechos using hnsw (embedding %I.vector_cosine_ops)', esq);
    -- a VM manda o embedding da pergunta; a função procura na mesma empresa, dentro da retenção, e guarda o resultado
    execute format($f$
create or replace function public.responder_busca_voz(busca bigint, emb text) returns int
language plpgsql security definer set search_path = public, %1$I as $b$
declare
    b public.voz_buscas;
    n int;
    v %1$I.vector(1536);
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor responde a busca semântica';
    end if;
    select * into b from public.voz_buscas where id = busca for update;
    if b.id is null or b.situacao <> 'pendente' then
        return 0;
    end if;
    v := emb::%1$I.vector(1536);
    insert into public.voz_busca_resultados (busca_id, trecho_id, similaridade)
    select b.id, t.id, round((1 - (t.embedding OPERATOR(%1$I.<=>) v))::numeric, 4)
      from public.voz_trechos t
     where t.empresa_id = b.empresa_id and t.expira_em > now() and t.embedding is not null
       and (b.filtros ->> 'de' is null or t.criado_em >= (b.filtros ->> 'de')::date)
       and (b.filtros ->> 'ate' is null or t.criado_em < (b.filtros ->> 'ate')::date + 1)
       and (b.filtros ->> 'credor' is null or t.credor_id = (b.filtros ->> 'credor')::bigint)
       and (b.filtros ->> 'origem' is null or t.origem = b.filtros ->> 'origem')
       and 1 - (t.embedding OPERATOR(%1$I.<=>) v) >= 0.70
     order by t.embedding OPERATOR(%1$I.<=>) v
     limit 200;
    get diagnostics n = row_count;
    update public.voz_buscas set situacao = 'pronta', resultados = n where id = b.id;
    return n;
end $b$;$f$, esq);
end $$;

do $$
begin
    if to_regprocedure('public.responder_busca_voz(bigint, text)') is null then
        execute $f$
create function public.responder_busca_voz(busca bigint, emb text) returns int
language plpgsql security definer set search_path = public as $b$
begin
    raise exception 'pgvector não está instalado: busca semântica desligada';
end $b$;$f$;
    end if;
end $$;
revoke all on function public.responder_busca_voz(bigint, text) from public, anon, authenticated;
grant execute on function public.responder_busca_voz(bigint, text) to service_role;

-- buscas semânticas esperando o embedding (a VM pega, calcula no provedor e responde)
create or replace function public.buscas_voz_pendentes(limite int default 20)
returns table (id bigint, termo text)
language plpgsql security definer set search_path = public as $$
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor lê as buscas pendentes';
    end if;
    update public.voz_buscas b set situacao = 'erro'
     where b.situacao = 'pendente' and b.em < now() - interval '2 minutes';
    return query select b.id, b.termo from public.voz_buscas b where b.situacao = 'pendente'
                  order by b.em limit least(greatest(coalesce(limite, 20), 1), 100);
end $$;
revoke all on function public.buscas_voz_pendentes(int) from public, anon, authenticated;
grant execute on function public.buscas_voz_pendentes(int) to service_role;

-- os trechos de uma busca (mesma regra para os dois modos)
create or replace function public.trechos_da_busca_voz(busca bigint) returns jsonb
language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'trecho_id', t.id, 'gravacao_id', t.gravacao_id, 'id_cliente', g.id_cliente, 'credor_id', t.credor_id,
               'credor', c.nome, 'origem', t.origem, 'falante', t.falante, 'inicio_s', t.inicio_s,
               'em', t.criado_em, 'texto', t.texto_redigido, 'similaridade', r.similaridade)
           order by r.similaridade desc nulls last, t.criado_em desc), '[]'::jsonb)
      from public.voz_busca_resultados r
      join public.voz_trechos t on t.id = r.trecho_id and t.expira_em > now()
      join public.voz_gravacoes g on g.id = t.gravacao_id
      left join public.credores c on c.id = t.credor_id
     where r.busca_id = busca
$$;
revoke all on function public.trechos_da_busca_voz(bigint) from public, anon, authenticated;

-- SA15: confere ver_transcricoes, recusa CPF/telefone/e-mail, limita a 200 e registra na mesma transação
create or replace function public.buscar_trechos_voz(empresa bigint, q text, modo text default 'termo',
                                                     de date default null, ate date default null,
                                                     credor bigint default null, origem text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
    termo text := btrim(coalesce(q, ''));
    bid bigint;
    n int;
    tsq tsquery;
    padrao text;
    tem_vetor boolean := exists (select 1 from information_schema.columns
                                  where table_schema = 'public' and table_name = 'voz_trechos' and column_name = 'embedding');
begin
    if not public.cliente_pode(empresa, 'ver_transcricoes') then
        raise exception 'a busca exige a permissão ver_transcricoes';
    end if;
    if public.termo_busca_proibido(termo) then
        raise exception 'a busca não aceita CPF, telefone nem e-mail: procure pelo assunto';
    end if;
    if char_length(termo) not between 2 and 120 then
        raise exception 'o termo precisa ter de 2 a 120 caracteres';
    end if;
    if modo not in ('semantica', 'termo') or (origem is not null and origem not in ('ia', 'discador')) then
        raise exception 'modo ou origem inválido';
    end if;
    if modo = 'semantica' and not tem_vetor then
        raise exception 'a busca semântica ainda não está ligada neste banco: use a busca por termo';
    end if;
    insert into public.voz_buscas (empresa_id, termo, modo, filtros, situacao)
    values (empresa, termo, modo, jsonb_strip_nulls(jsonb_build_object('de', de, 'ate', ate, 'credor', credor, 'origem', origem)),
            case when modo = 'semantica' then 'pendente' else 'pronta' end)
    returning id into bid;
    if modo = 'semantica' then
        return jsonb_build_object('busca_id', bid, 'situacao', 'pendente', 'resultados', '[]'::jsonb);
    end if;
    tsq := plainto_tsquery('portuguese', termo);
    padrao := '%' || replace(replace(replace(lower(termo), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    insert into public.voz_busca_resultados (busca_id, trecho_id, similaridade)
    select bid, t.id, null
      from public.voz_trechos t
     where t.empresa_id = empresa and t.expira_em > now()
       and (numnode(tsq) = 0 or t.tsv @@ tsq)
       and lower(t.texto_redigido) like padrao
       and (de is null or t.criado_em >= de) and (ate is null or t.criado_em < ate + 1)
       and (credor is null or t.credor_id = credor)
       and (buscar_trechos_voz.origem is null or t.origem = buscar_trechos_voz.origem)
     order by t.criado_em desc
     limit 200;
    get diagnostics n = row_count;
    update public.voz_buscas set resultados = n where id = bid;
    return jsonb_build_object('busca_id', bid, 'situacao', 'pronta', 'resultados', public.trechos_da_busca_voz(bid));
end $$;

-- resultado de uma busca (só quem buscou, e de novo com a permissão)
create or replace function public.resultado_busca_voz(busca bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.voz_buscas;
begin
    select * into b from public.voz_buscas where id = busca;
    if b.id is null or b.usuario <> auth.uid() or not public.cliente_pode(b.empresa_id, 'ver_transcricoes') then
        raise exception 'busca não encontrada';
    end if;
    return jsonb_build_object('busca_id', b.id, 'situacao', b.situacao,
                              'resultados', case when b.situacao = 'pronta' then public.trechos_da_busca_voz(b.id) else '[]'::jsonb end);
end $$;

-- registro de buscas (Admin)
create or replace function public.buscas_recentes_voz(empresa bigint, limite int default 20)
returns table (termo text, modo text, quem text, em timestamptz, resultados int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
    if not (empresa in (select public.minhas_empresas()) and not public.sou_equipe() and public.tem_papel('admin')) then
        raise exception 'só o Admin vê o registro de buscas';
    end if;
    return query select b.termo, b.modo, coalesce(nullif(trim(p.nome), ''), p.email, 'Pessoa da empresa'), b.em, b.resultados
                   from public.voz_buscas b left join public.perfis p on p.id = b.usuario
                  where b.empresa_id = empresa order by b.em desc limit least(greatest(coalesce(limite, 20), 1), 100);
end $$;
revoke all on function public.buscar_trechos_voz(bigint, text, text, date, date, bigint, text),
    public.resultado_busca_voz(bigint), public.buscas_recentes_voz(bigint, int) from public, anon;
grant execute on function public.buscar_trechos_voz(bigint, text, text, date, date, bigint, text),
    public.resultado_busca_voz(bigint), public.buscas_recentes_voz(bigint, int) to authenticated;

-- ================================================================ 8. política da carteira (SA21)
alter table public.credores add column if not exists politica jsonb;
alter table public.credores drop constraint if exists credores_politica_ok;
alter table public.credores add constraint credores_politica_ok check (public.politica_credor_ok(politica));

create or replace function public.salvar_politica_credor(credor bigint, politica jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare eid bigint;
begin
    select empresa_id into eid from public.credores where id = credor;
    if not public.cliente_pode(eid, 'editar_credores') then
        raise exception 'sem permissão para editar a carteira (editar_credores)';
    end if;
    if not public.politica_credor_ok(politica) then
        raise exception 'política inválida';
    end if;
    update public.credores set politica = salvar_politica_credor.politica where id = credor;
end $$;
revoke all on function public.salvar_politica_credor(bigint, jsonb) from public, anon;
grant execute on function public.salvar_politica_credor(bigint, jsonb) to authenticated;

-- ================================================================ 9. recomendações (SA17, SA18, SA19)
create table if not exists public.recomendacoes (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    credor_id      bigint references public.credores (id) on delete cascade,
    destino        text not null check (destino in ('regua', 'renitencia', 'fluxo', 'canal', 'frases', 'propensao')),
    regra          text not null check (regra ~ '^[a-z0-9_]{2,40}$'),
    chave          text not null check (chave ~ '^[a-z0-9_:.\-]{2,120}$'),
    titulo         text not null check (char_length(trim(titulo)) between 5 and 140 and public.texto_mascarado_ok(titulo)),
    texto          text not null default '' check (char_length(texto) <= 500 and public.texto_mascarado_ok(texto)),
    evidencia      jsonb not null check (jsonb_typeof(evidencia) = 'object'
                                         and (evidencia ->> 'n_a')::numeric >= 200 and (evidencia ->> 'n_b')::numeric >= 200
                                         and abs((evidencia ->> 'pct_a')::numeric - (evidencia ->> 'pct_b')::numeric) >= 5),
    proposta       jsonb not null default '{}' check (jsonb_typeof(proposta) = 'object'),
    situacao       text not null default 'nova' check (situacao in ('nova', 'rascunho', 'dispensada', 'aplicada')),
    rascunho_tipo  text check (rascunho_tipo in ('estrategia', 'frase')),
    rascunho_id    bigint,
    criada_em      timestamptz not null default now(),
    atualizada_em  timestamptz not null default now(),
    decidida_por   uuid references auth.users (id) on delete set null,
    decidida_em    timestamptz,
    aplicada_em    timestamptz,
    volta_em       timestamptz,
    unique (empresa_id, chave),
    check ((rascunho_tipo is null) = (rascunho_id is null)),
    check (situacao <> 'dispensada' or volta_em is not null)
);
comment on table public.recomendacoes is
    'SA17: recomendação com evidência (n >= 200 por grupo, diferença >= 5 p.p.). Aplicar só cria rascunho; dispensada some por 90 dias.';
create table if not exists public.recomendacao_impacto (
    id           bigint generated always as identity primary key,
    rec_id       bigint not null references public.recomendacoes (id) on delete cascade,
    metrica      text not null check (metrica ~ '^[a-z0-9_]{2,40}$'),
    antes        numeric(8, 3),
    depois       numeric(8, 3),
    n_antes      int check (n_antes >= 0),
    n_depois     int check (n_depois >= 0),
    janela_dias  int not null default 28 check (janela_dias between 7 and 90),
    medido_em    timestamptz not null default now(),
    unique (rec_id, metrica)
);
alter table public.recomendacoes enable row level security;
alter table public.recomendacao_impacto enable row level security;
drop policy if exists recomendacoes_ver on public.recomendacoes;
create policy recomendacoes_ver on public.recomendacoes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists recomendacao_impacto_ver on public.recomendacao_impacto;
create policy recomendacao_impacto_ver on public.recomendacao_impacto for select to authenticated
    using (exists (select 1 from public.recomendacoes r where r.id = rec_id and r.empresa_id in (select public.minhas_empresas())));
revoke all on public.recomendacoes, public.recomendacao_impacto from anon;
revoke insert, update, delete on public.recomendacoes, public.recomendacao_impacto from authenticated;
drop trigger if exists z_auditar on public.recomendacoes;
create trigger z_auditar after insert or update or delete on public.recomendacoes for each row execute function public.auditar();

-- o motor registra (o piso e os 90 dias da dispensada ficam aqui, no banco)
create or replace function public.registrar_recomendacao_voz(empresa bigint, credor bigint, destino text, regra text,
                                                            chave text, titulo text, texto text, evidencia jsonb,
                                                            proposta jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare
    r public.recomendacoes;
    rid bigint;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o motor registra recomendações';
    end if;
    select * into r from public.recomendacoes x where x.empresa_id = empresa and x.chave = registrar_recomendacao_voz.chave;
    if r.id is not null then
        if r.situacao = 'dispensada' and r.volta_em > now() or r.situacao in ('rascunho', 'aplicada') then
            return null;                                    -- dispensada não volta antes de 90 dias
        end if;
        update public.recomendacoes x set situacao = 'nova', titulo = registrar_recomendacao_voz.titulo,
               texto = coalesce(registrar_recomendacao_voz.texto, ''), evidencia = registrar_recomendacao_voz.evidencia,
               proposta = coalesce(registrar_recomendacao_voz.proposta, '{}'), atualizada_em = now(),
               volta_em = null, decidida_por = null, decidida_em = null
         where x.id = r.id;
        return r.id;
    end if;
    insert into public.recomendacoes (empresa_id, credor_id, destino, regra, chave, titulo, texto, evidencia, proposta)
    values (empresa, credor, destino, regra, chave, titulo, coalesce(texto, ''), evidencia, coalesce(proposta, '{}'))
    returning id into rid;
    return rid;
end $$;
revoke all on function public.registrar_recomendacao_voz(bigint, bigint, text, text, text, text, text, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.registrar_recomendacao_voz(bigint, bigint, text, text, text, text, text, jsonb, jsonb)
    to service_role;

create or replace function public.dispensar_recomendacao(rec bigint, desfazer boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r public.recomendacoes;
begin
    select * into r from public.recomendacoes where id = rec for update;
    if r.id is null or not public.cliente_pode(r.empresa_id, 'editar_orquestracao') then
        raise exception 'sem permissão para decidir recomendações (editar_orquestracao)';
    end if;
    if desfazer then
        if r.situacao <> 'dispensada' then
            raise exception 'só uma recomendação dispensada volta';
        end if;
        update public.recomendacoes set situacao = 'nova', volta_em = null, decidida_por = auth.uid(), decidida_em = now(),
               atualizada_em = now() where id = rec;
        return;
    end if;
    if r.situacao <> 'nova' then
        raise exception 'só uma recomendação nova é dispensada';
    end if;
    update public.recomendacoes set situacao = 'dispensada', volta_em = now() + interval '90 days',
           decidida_por = auth.uid(), decidida_em = now(), atualizada_em = now()
     where id = rec;
end $$;

-- SA18: cria o rascunho e nunca publica. Régua e renitência: estratégia NOVA, cópia da estratégia da carteira com a
-- mudança, sem vínculo nenhum (não é padrão, não está em segmento nem em carteira): nada muda até alguém ligá-la.
-- Frases: frase nova desligada. Fluxo, canal e propensão ainda não têm rascunho automático.
create or replace function public.aplicar_recomendacao(rec bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    r public.recomendacoes;
    base public.estrategias;
    nid bigint;
    nome_r text;
begin
    select * into r from public.recomendacoes where id = rec for update;
    if r.id is null or r.empresa_id not in (select public.minhas_empresas()) or public.sou_equipe() then
        raise exception 'recomendação não encontrada';
    end if;
    if r.situacao <> 'nova' then
        raise exception 'esta recomendação já foi decidida';
    end if;
    nome_r := left('Rascunho · ' || r.titulo, 80);
    if r.destino in ('regua', 'renitencia') then
        if not public.pode('editar_orquestracao') then
            raise exception 'sem permissão para criar rascunho na estratégia (editar_orquestracao)';
        end if;
        if jsonb_typeof(r.proposta -> 'definicao') is distinct from 'object' then
            raise exception 'recomendação sem proposta de estratégia';
        end if;
        select e.* into base from public.estrategias e
         where e.empresa_id = r.empresa_id
           and e.id = coalesce((select c.estrategia_id from public.credores c where c.id = r.credor_id),
                               (select x.id from public.estrategias x where x.empresa_id = r.empresa_id and x.padrao));
        if exists (select 1 from public.estrategias e where e.empresa_id = r.empresa_id and e.nome = nome_r) then
            nome_r := left(nome_r, 72) || ' #' || r.id;
        end if;
        insert into public.estrategias (empresa_id, nome, descricao, definicao, padrao)
        values (r.empresa_id, nome_r,
                'Rascunho do Speech Analytics (recomendação ' || r.id || '). Não está ligado a nenhum segmento nem carteira: nada muda até vocês ligarem.',
                public.jsonb_mesclar(coalesce(base.definicao, '{}'::jsonb), r.proposta -> 'definicao'), false)
        returning id into nid;
        update public.recomendacoes set situacao = 'rascunho', rascunho_tipo = 'estrategia', rascunho_id = nid,
               decidida_por = auth.uid(), decidida_em = now(), atualizada_em = now() where id = rec;
        return jsonb_build_object('tipo', 'estrategia', 'id', nid, 'nome', nome_r);
    elsif r.destino = 'frases' then
        if not public.pode('editar_canais') then
            raise exception 'sem permissão para criar rascunho de frase (editar_canais)';
        end if;
        if coalesce(r.proposta ->> 'texto', '') = '' or not public.texto_mascarado_ok(r.proposta ->> 'texto') then
            raise exception 'recomendação sem frase proposta';
        end if;
        if exists (select 1 from public.frases f where f.empresa_id = r.empresa_id
                      and f.canal = coalesce(r.proposta ->> 'canal', 'agente_voz') and f.nome = nome_r) then
            nome_r := left(nome_r, 72) || ' #' || r.id;
        end if;
        insert into public.frases (empresa_id, canal, nome, estagio, texto, ativo)
        values (r.empresa_id, coalesce(r.proposta ->> 'canal', 'agente_voz'), left(nome_r, 120), r.proposta ->> 'estagio',
                left(r.proposta ->> 'texto', 2000), false)
        returning id into nid;
        update public.recomendacoes set situacao = 'rascunho', rascunho_tipo = 'frase', rascunho_id = nid,
               decidida_por = auth.uid(), decidida_em = now(), atualizada_em = now() where id = rec;
        return jsonb_build_object('tipo', 'frase', 'id', nid, 'nome', nome_r);
    elsif r.destino = 'propensao' then
        raise exception 'Propensão em sombra é só observação: não há rascunho a criar';
    else
        raise exception 'esta recomendação ainda não cria rascunho sozinha: faça a mudança na tela de destino';
    end if;
end $$;
revoke all on function public.dispensar_recomendacao(bigint, boolean), public.aplicar_recomendacao(bigint) from public, anon;
grant execute on function public.dispensar_recomendacao(bigint, boolean), public.aplicar_recomendacao(bigint) to authenticated;

-- o motor confere se o rascunho entrou em uso (estratégia ligada a carteira, segmento ou padrão; frase ligada):
-- é daí que contam os 28 dias do antes × depois
create or replace function public.conferir_rascunhos_recomendacoes() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o motor confere os rascunhos';
    end if;
    update public.recomendacoes r set situacao = 'aplicada', aplicada_em = now(), atualizada_em = now()
     where r.situacao = 'rascunho' and (
           (r.rascunho_tipo = 'estrategia' and (
                exists (select 1 from public.estrategias e where e.id = r.rascunho_id and e.padrao)
             or exists (select 1 from public.credores c where c.estrategia_id = r.rascunho_id)
             or exists (select 1 from public.clusters c where c.estrategia_id = r.rascunho_id)))
        or (r.rascunho_tipo = 'frase' and exists (select 1 from public.frases f where f.id = r.rascunho_id and f.ativo)));
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function public.conferir_rascunhos_recomendacoes() from public, anon, authenticated;
grant execute on function public.conferir_rascunhos_recomendacoes() to service_role;

-- ================================================================ 10. relatório ao credor (SA20)
create table if not exists public.relatorios_credor (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint not null references public.credores (id) on delete cascade,
    competencia      date not null check (extract(day from competencia) = 1),
    situacao         text not null default 'rascunho' check (situacao in ('rascunho', 'revisao', 'enviado', 'respondido')),
    conteudo         jsonb not null check (public.relatorio_agregado_ok(conteudo)),
    comentario       text check (char_length(comentario) <= 400 and public.texto_mascarado_ok(comentario)),
    gerado_em        timestamptz not null default now(),
    revisado_por     uuid references auth.users (id) on delete set null,
    revisado_em      timestamptz,
    enviado_por      uuid references auth.users (id) on delete set null,
    enviado_em       timestamptz,
    link_token_hash  text check (link_token_hash ~ '^[0-9a-f]{64}$'),
    expira_em        timestamptz,
    pdf_caminho      text check (char_length(pdf_caminho) <= 300 and pdf_caminho ~ '^[A-Za-z0-9_\-/.]+$'),
    unique (empresa_id, credor_id, competencia),
    check ((link_token_hash is null) = (expira_em is null))
);
create unique index if not exists relatorios_credor_token on public.relatorios_credor (link_token_hash)
    where link_token_hash is not null;
comment on table public.relatorios_credor is
    'SA20: relatório mensal ao credor, só agregados (grupo < 30 recusado no check). Só o hash do token do link fica aqui.';
create table if not exists public.relatorio_credor_respostas (
    relatorio_id  bigint not null references public.relatorios_credor (id) on delete cascade,
    recomendacao  text not null check (recomendacao ~ '^[a-z0-9_\-]{1,40}$'),
    resposta      text not null check (resposta in ('testar', 'nao', 'depois')),
    em            timestamptz not null default now(),
    primary key (relatorio_id, recomendacao)
);
create table if not exists public.relatorio_credor_acessos (
    id            bigint generated always as identity primary key,
    relatorio_id  bigint not null references public.relatorios_credor (id) on delete cascade,
    acao          text not null check (acao in ('leitura', 'resposta')),
    em            timestamptz not null default now()
);
create index if not exists relatorio_credor_acessos_rel on public.relatorio_credor_acessos (relatorio_id, em desc);
comment on table public.relatorio_credor_acessos is 'Cada acesso do credor pelo link (sem login). Sem IP e sem token.';
alter table public.relatorios_credor enable row level security;
alter table public.relatorio_credor_respostas enable row level security;
alter table public.relatorio_credor_acessos enable row level security;
drop policy if exists relatorios_credor_ver on public.relatorios_credor;
create policy relatorios_credor_ver on public.relatorios_credor for select to authenticated
    using (public.cliente_pode(empresa_id, 'enviar_relatorio_credor'));
drop policy if exists relatorio_credor_respostas_ver on public.relatorio_credor_respostas;
create policy relatorio_credor_respostas_ver on public.relatorio_credor_respostas for select to authenticated
    using (exists (select 1 from public.relatorios_credor r where r.id = relatorio_id
                    and public.cliente_pode(r.empresa_id, 'enviar_relatorio_credor')));
drop policy if exists relatorio_credor_acessos_ver on public.relatorio_credor_acessos;
create policy relatorio_credor_acessos_ver on public.relatorio_credor_acessos for select to authenticated
    using (exists (select 1 from public.relatorios_credor r where r.id = relatorio_id
                    and public.cliente_pode(r.empresa_id, 'enviar_relatorio_credor')));
revoke all on public.relatorios_credor, public.relatorio_credor_respostas, public.relatorio_credor_acessos from anon;
revoke insert, update, delete on public.relatorios_credor, public.relatorio_credor_respostas, public.relatorio_credor_acessos
    from authenticated;
-- o hash do token não sai nem para quem vê o relatório
revoke select on public.relatorios_credor from authenticated;
grant select (id, empresa_id, credor_id, competencia, situacao, conteudo, comentario, gerado_em, revisado_por, revisado_em,
              enviado_por, enviado_em, expira_em, pdf_caminho) on public.relatorios_credor to authenticated;
drop trigger if exists z_auditar on public.relatorios_credor;
create trigger z_auditar after insert or update or delete on public.relatorios_credor
    for each row execute function public.auditar();

-- o motor grava o rascunho do mês (só enquanto ainda é rascunho)
create or replace function public.gravar_relatorio_credor(empresa bigint, credor bigint, competencia date, conteudo jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare rid bigint;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o motor gera o relatório ao credor';
    end if;
    insert into public.relatorios_credor as r (empresa_id, credor_id, competencia, conteudo)
    values (empresa, credor, date_trunc('month', competencia)::date, conteudo)
    on conflict (empresa_id, credor_id, competencia) do update set conteudo = excluded.conteudo, gerado_em = now()
        where r.situacao = 'rascunho'
    returning r.id into rid;
    return rid;
end $$;
revoke all on function public.gravar_relatorio_credor(bigint, bigint, date, jsonb) from public, anon, authenticated;
grant execute on function public.gravar_relatorio_credor(bigint, bigint, date, jsonb) to service_role;

-- fluxo: rascunho → revisão → enviado (link de 30 dias) → respondido. O token sai uma vez, na hora.
create or replace function public.mudar_relatorio_credor(relatorio bigint, acao text, comentario text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    r public.relatorios_credor;
    token text;
begin
    select * into r from public.relatorios_credor where id = relatorio for update;
    if r.id is null or not public.cliente_pode(r.empresa_id, 'enviar_relatorio_credor') then
        raise exception 'sem permissão para o relatório ao credor (enviar_relatorio_credor)';
    end if;
    if acao = 'comentar' then
        if r.situacao not in ('rascunho', 'revisao') then
            raise exception 'relatório enviado não muda';
        end if;
        if not public.texto_mascarado_ok(comentario) or char_length(coalesce(comentario, '')) > 400 then
            raise exception 'comentário sem CPF, telefone ou e-mail, com até 400 caracteres';
        end if;
        update public.relatorios_credor set comentario = nullif(trim(mudar_relatorio_credor.comentario), '') where id = relatorio;
        return jsonb_build_object('situacao', r.situacao);
    elsif acao = 'revisar' then
        if r.situacao <> 'rascunho' then
            raise exception 'só o rascunho vai para revisão';
        end if;
        update public.relatorios_credor set situacao = 'revisao' where id = relatorio;
        return jsonb_build_object('situacao', 'revisao');
    elsif acao in ('enviar', 'novo_link') then
        if acao = 'enviar' and r.situacao <> 'revisao' then
            raise exception 'só o relatório revisado é enviado';
        end if;
        if acao = 'novo_link' and r.situacao not in ('enviado', 'respondido') then
            raise exception 'o relatório ainda não foi enviado';
        end if;
        token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        update public.relatorios_credor
           set situacao = case when acao = 'enviar' then 'enviado' else situacao end,
               revisado_por = case when acao = 'enviar' then auth.uid() else revisado_por end,
               revisado_em = case when acao = 'enviar' then now() else revisado_em end,
               enviado_por = auth.uid(), enviado_em = coalesce(case when acao = 'enviar' then now() end, enviado_em),
               link_token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex'),
               expira_em = now() + interval '30 days'
         where id = relatorio;
        return jsonb_build_object('situacao', case when acao = 'enviar' then 'enviado' else r.situacao end,
                                  'token', token, 'expira_em', now() + interval '30 days');
    end if;
    raise exception 'ação inválida';
end $$;
revoke all on function public.mudar_relatorio_credor(bigint, text, text) from public, anon;
grant execute on function public.mudar_relatorio_credor(bigint, text, text) to authenticated;

-- o credor lê pelo link, sem login. Cada leitura fica registrada.
create or replace function public.relatorio_credor_publico(token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    r public.relatorios_credor;
begin
    if token is null or token !~ '^[0-9a-f]{64}$' then
        raise exception 'link inválido ou vencido';
    end if;
    select * into r from public.relatorios_credor x
     where x.link_token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
       and x.situacao in ('enviado', 'respondido') and x.expira_em > now();
    if r.id is null then
        raise exception 'link inválido ou vencido';
    end if;
    insert into public.relatorio_credor_acessos (relatorio_id, acao) values (r.id, 'leitura');
    return jsonb_build_object(
        'competencia', r.competencia, 'conteudo', r.conteudo, 'comentario', r.comentario, 'expira_em', r.expira_em,
        'credor', (select c.nome from public.credores c where c.id = r.credor_id),
        'assessoria', (select e.nome from public.empresas e where e.id = r.empresa_id),
        'respostas', coalesce((select jsonb_object_agg(s.recomendacao, s.resposta)
                                 from public.relatorio_credor_respostas s where s.relatorio_id = r.id), '{}'::jsonb));
end $$;

create or replace function public.responder_relatorio_credor(token text, recomendacao text, resposta text) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r public.relatorios_credor;
begin
    if token is null or token !~ '^[0-9a-f]{64}$' then
        raise exception 'link inválido ou vencido';
    end if;
    select * into r from public.relatorios_credor x
     where x.link_token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
       and x.situacao in ('enviado', 'respondido') and x.expira_em > now();
    if r.id is null then
        raise exception 'link inválido ou vencido';
    end if;
    if not jsonb_path_exists(r.conteudo, '$.recomendacoes[*] ? (@.id == $id)', jsonb_build_object('id', responder_relatorio_credor.recomendacao)) then
        raise exception 'recomendação não está neste relatório';
    end if;
    if responder_relatorio_credor.resposta is null then
        delete from public.relatorio_credor_respostas s where s.relatorio_id = r.id and s.recomendacao = responder_relatorio_credor.recomendacao;
    else
        insert into public.relatorio_credor_respostas (relatorio_id, recomendacao, resposta)
        values (r.id, responder_relatorio_credor.recomendacao, responder_relatorio_credor.resposta)
        on conflict (relatorio_id, recomendacao) do update set resposta = excluded.resposta, em = now();
    end if;
    update public.relatorios_credor set situacao = 'respondido' where id = r.id and situacao = 'enviado';
    insert into public.relatorio_credor_acessos (relatorio_id, acao) values (r.id, 'resposta');
end $$;
revoke all on function public.relatorio_credor_publico(text), public.responder_relatorio_credor(text, text, text) from public;
grant execute on function public.relatorio_credor_publico(text), public.responder_relatorio_credor(text, text, text)
    to anon, authenticated;

-- PDF do relatório (a VM gera no dia 1 em saidas/<empresa>/relatorios_credor/...): quem envia o relatório baixa
drop policy if exists saidas_relatorio_credor on storage.objects;
create policy saidas_relatorio_credor on storage.objects for select to authenticated
    using (bucket_id = 'saidas' and (storage.foldername(name))[2] = 'relatorios_credor'
           and exists (select 1 from public.empresas e where e.slug = (storage.foldername(name))[1]
                        and public.cliente_pode(e.id, 'enviar_relatorio_credor')));

-- ================================================================ 11. curadoria (SA22, SA23, SA24)
create table if not exists public.voz_curadoria_itens (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    tipo             text not null check (tipo in ('intencao', 'trava', 'codigo', 'nota', 'transcricao', 'tema')),
    chamada_id       bigint references public.voz_chamadas (id) on delete set null,
    gravacao_id      bigint references public.voz_gravacoes (id) on delete set null,
    avaliacao_id     bigint references public.voz_avaliacoes (id) on delete set null,
    tema_id          bigint references public.voz_temas (id) on delete cascade,
    trecho_redigido  text check (char_length(trecho_redigido) <= 600 and public.texto_mascarado_ok(trecho_redigido)),
    decisao_ia       jsonb not null default '{}' check (jsonb_typeof(decisao_ia) = 'object'),
    opcoes           jsonb not null default '[]' check (jsonb_typeof(opcoes) = 'array' and jsonb_array_length(opcoes) <= 20),
    confianca        numeric(4, 3) check (confianca between 0 and 1),
    situacao         text not null default 'aberto' check (situacao in ('aberto', 'confirmado', 'corrigido', 'exemplo',
                                                                         'caso_teste', 'descartado')),
    valor_certo      text check (char_length(valor_certo) <= 80 and public.texto_mascarado_ok(valor_certo)),
    criado_em        timestamptz not null default now(),
    por              uuid references auth.users (id) on delete set null,
    em               timestamptz,
    check (situacao = 'aberto' or (por is not null and em is not null))
);
create index if not exists voz_curadoria_fila on public.voz_curadoria_itens (empresa_id, situacao, criado_em);
create unique index if not exists voz_curadoria_um_por_avaliacao on public.voz_curadoria_itens (avaliacao_id)
    where avaliacao_id is not null and situacao = 'aberto';

-- SA23: sem id_cliente e sem chamada_id, para durar além da retenção (decisão 6)
create table if not exists public.voz_golden_set (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    tipo             text not null check (tipo in ('intencao', 'trava', 'codigo', 'nota', 'transcricao', 'tema')),
    trecho_redigido  text not null check (char_length(trecho_redigido) between 1 and 600 and public.texto_mascarado_ok(trecho_redigido)),
    contexto         jsonb not null default '{}' check (jsonb_typeof(contexto) = 'object'
                                                       and not (contexto ?| array['id_cliente', 'chamada_id', 'gravacao_id', 'cpf', 'telefone'])),
    resposta_certa   text not null check (char_length(resposta_certa) between 1 and 80),
    exemplo          boolean not null default false,
    origem_item      bigint references public.voz_curadoria_itens (id) on delete set null,
    criado_por       uuid references auth.users (id) on delete set null,
    criado_em        timestamptz not null default now()
);
create table if not exists public.voz_golden_medicoes (
    id          bigint generated always as identity primary key,
    empresa_id  bigint references public.empresas (id) on delete cascade,    -- nulo = medição geral do MotorCX
    mes         date not null check (extract(day from mes) = 1),
    tipo        text not null check (tipo in ('intencao', 'codigo', 'nota', 'alerta')),
    componente  text not null check (componente in ('extrator', 'avaliador', 'fluxo', 'classificador')),
    versao      text not null check (versao ~ '^[A-Za-z0-9_.:\-]{1,60}$'),
    acertos     int not null check (acertos >= 0),
    total       int not null check (total >= acertos),
    medido_em   timestamptz not null default now()
);
create unique index if not exists voz_golden_medicoes_chave on public.voz_golden_medicoes (coalesce(empresa_id, 0), mes, tipo, componente, versao);
create table if not exists public.voz_melhorias (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    tipo           text not null check (tipo in ('fluxo', 'base', 'checklist')),
    titulo         text not null check (char_length(trim(titulo)) between 5 and 140 and public.texto_mascarado_ok(titulo)),
    responsavel    text check (char_length(responsavel) <= 60 and public.texto_mascarado_ok(responsavel)),
    situacao       text not null default 'aberta' check (situacao in ('aberta', 'em_teste', 'aplicada', 'descartada')),
    origem_item    bigint references public.voz_curadoria_itens (id) on delete set null,
    impacto        jsonb check (impacto is null or (jsonb_typeof(impacto) = 'object' and public.texto_mascarado_ok(impacto ->> 'texto'))),
    criada_em      timestamptz not null default now(),
    atualizada_em  timestamptz not null default now()
);

do $$
declare t text;
begin
    foreach t in array array['voz_curadoria_itens', 'voz_golden_set', 'voz_melhorias'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_ver', t);
        execute format('create policy %I on public.%I for select to authenticated using (public.cliente_pode(empresa_id, ''curadoria_voz''))',
                       t || '_ver', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('revoke insert, update, delete on public.%I from authenticated', t);
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I for each row execute function public.auditar()', t);
    end loop;
end $$;
alter table public.voz_golden_medicoes enable row level security;
drop policy if exists voz_golden_medicoes_ver on public.voz_golden_medicoes;
create policy voz_golden_medicoes_ver on public.voz_golden_medicoes for select to authenticated
    using (empresa_id is null or public.cliente_pode(empresa_id, 'curadoria_voz') or public.admin_equipe());
revoke all on public.voz_golden_medicoes from anon;
revoke insert, update, delete on public.voz_golden_medicoes from authenticated;

-- ação na fila: confirmar | corrigir (valor) | exemplo | caso_teste | descartar | desfazer. Fica na auditoria.
create or replace function public.curar_item_voz(item bigint, acao text, valor text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
    c public.voz_curadoria_itens;
    certo text;
begin
    select * into c from public.voz_curadoria_itens where id = item for update;
    if c.id is null or not public.cliente_pode(c.empresa_id, 'curadoria_voz') then
        raise exception 'sem permissão para a curadoria (curadoria_voz)';
    end if;
    if acao = 'desfazer' then
        if c.situacao = 'aberto' then
            return 'aberto';
        end if;
        if c.situacao = 'caso_teste' then
            raise exception 'caso de teste já entrou no Fluxo do agente: tire por lá';
        end if;
        delete from public.voz_golden_set g where g.origem_item = c.id;
        if c.tipo = 'tema' and c.tema_id is not null then
            update public.voz_temas set nome = null, situacao = 'novo', promovido_por = null, promovido_em = null
             where id = c.tema_id;
        end if;
        update public.voz_curadoria_itens set situacao = 'aberto', valor_certo = null, por = null, em = null where id = item;
        return 'aberto';
    end if;
    if c.situacao <> 'aberto' then
        raise exception 'este item já foi tratado';
    end if;
    if acao = 'caso_teste' then
        raise exception 'o Fluxo do agente (casos de teste) ainda não está neste banco';
    end if;
    if acao not in ('confirmar', 'corrigir', 'exemplo', 'descartar') then
        raise exception 'ação inválida';
    end if;
    if acao = 'exemplo' and c.tipo not in ('intencao', 'trava', 'codigo', 'tema') then
        raise exception 'este tipo de item não vira exemplo';
    end if;
    certo := case when acao = 'corrigir' then nullif(trim(valor), '') else coalesce(c.decisao_ia ->> 'valor', '') end;
    if acao = 'corrigir' and (certo is null or not public.texto_mascarado_ok(certo) or char_length(certo) > 80) then
        raise exception 'informe o valor certo (sem dado pessoal, até 80 caracteres)';
    end if;
    if acao = 'corrigir' and jsonb_array_length(c.opcoes) > 0 and c.tipo <> 'tema'
       and not exists (select 1 from jsonb_array_elements_text(c.opcoes) o where o = certo) then
        raise exception 'valor fora das opções deste item';
    end if;
    -- tema: confirmar ou corrigir dá o nome (decisão 7)
    if c.tipo = 'tema' and acao in ('confirmar', 'corrigir') then
        if c.tema_id is null or char_length(coalesce(certo, '')) < 3 then
            raise exception 'dê um nome ao tema (3 a 80 caracteres)';
        end if;
        update public.voz_temas set nome = certo, situacao = 'promovido', promovido_por = auth.uid(), promovido_em = now()
         where id = c.tema_id;
    end if;
    if acao in ('confirmar', 'corrigir', 'exemplo') and c.trecho_redigido is not null and coalesce(certo, '') <> '' then
        insert into public.voz_golden_set (empresa_id, tipo, trecho_redigido, contexto, resposta_certa, exemplo, origem_item, criado_por)
        values (c.empresa_id, c.tipo, c.trecho_redigido,
                jsonb_strip_nulls(jsonb_build_object('decisao_ia', c.decisao_ia ->> 'valor', 'confianca', c.confianca)),
                left(certo, 80), acao = 'exemplo', c.id, auth.uid());
    end if;
    if acao = 'exemplo' then
        insert into public.voz_melhorias (empresa_id, tipo, titulo, situacao, origem_item)
        values (c.empresa_id, case when c.tipo = 'trava' then 'base' else 'fluxo' end,
                left('Exemplo da curadoria: ' || coalesce(nullif(certo, ''), c.tipo), 140), 'aberta', c.id);
    end if;
    update public.voz_curadoria_itens
       set situacao = case acao when 'confirmar' then 'confirmado' when 'corrigir' then 'corrigido'
                                when 'exemplo' then 'exemplo' else 'descartado' end,
           valor_certo = case when acao in ('confirmar', 'corrigir', 'exemplo') then nullif(certo, '') end,
           por = auth.uid(), em = now()
     where id = item;
    return (select situacao from public.voz_curadoria_itens where id = item);
end $$;

-- "Discordar da nota": manda para a curadoria
create or replace function public.contestar_nota_voz(avaliacao bigint, item text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    a public.voz_avaliacoes;
    cid bigint;
begin
    select * into a from public.voz_avaliacoes where id = avaliacao for update;
    if a.id is null or not public.cliente_pode(a.empresa_id, 'ver_transcricoes') then
        raise exception 'avaliação não encontrada';
    end if;
    item := coalesce(item, a.item_reprovado);
    if item is null or not (a.itens ? item) then
        raise exception 'item não está nesta avaliação';
    end if;
    update public.voz_avaliacoes set contestada_por = auth.uid(), contestada_em = now() where id = avaliacao;
    insert into public.voz_curadoria_itens (empresa_id, tipo, chamada_id, gravacao_id, avaliacao_id, trecho_redigido,
                                            decisao_ia, opcoes)
    values (a.empresa_id, 'nota', a.chamada_id, a.gravacao_id, a.id, a.trecho_redigido,
            jsonb_build_object('item', item, 'valor', a.itens ->> item, 'contestada', true),
            '["sim", "nao", "na"]'::jsonb)
    on conflict do nothing
    returning id into cid;
    return cid;
end $$;

create or replace function public.salvar_melhoria_voz(empresa bigint, id bigint, tipo text, titulo text,
                                                      responsavel text, situacao text, impacto text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare mid bigint;
begin
    if not public.cliente_pode(empresa, 'curadoria_voz') then
        raise exception 'sem permissão para a curadoria (curadoria_voz)';
    end if;
    if salvar_melhoria_voz.id is null then
        insert into public.voz_melhorias (empresa_id, tipo, titulo, responsavel, situacao, impacto)
        values (empresa, tipo, trim(titulo), nullif(trim(responsavel), ''), coalesce(situacao, 'aberta'),
                case when nullif(trim(impacto), '') is not null then jsonb_build_object('texto', left(trim(impacto), 200)) end)
        returning voz_melhorias.id into mid;
        return mid;
    end if;
    update public.voz_melhorias m set tipo = salvar_melhoria_voz.tipo, titulo = trim(salvar_melhoria_voz.titulo),
           responsavel = nullif(trim(salvar_melhoria_voz.responsavel), ''), situacao = salvar_melhoria_voz.situacao,
           impacto = case when nullif(trim(salvar_melhoria_voz.impacto), '') is not null
                          then jsonb_build_object('texto', left(trim(salvar_melhoria_voz.impacto), 200)) else m.impacto end,
           atualizada_em = now()
     where m.id = salvar_melhoria_voz.id and m.empresa_id = empresa
    returning m.id into mid;
    if mid is null then
        raise exception 'melhoria não encontrada';
    end if;
    return mid;
end $$;
revoke all on function public.curar_item_voz(bigint, text, text), public.contestar_nota_voz(bigint, text),
    public.salvar_melhoria_voz(bigint, bigint, text, text, text, text, text) from public, anon;
grant execute on function public.curar_item_voz(bigint, text, text), public.contestar_nota_voz(bigint, text),
    public.salvar_melhoria_voz(bigint, bigint, text, text, text, text, text) to authenticated;

-- ================================================================ 12. retenção: a análise vai embora com a gravação
create or replace function public.apagar_analise_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    delete from public.voz_avaliacoes a where a.gravacao_id = old.id
        or (a.chamada_id = old.chamada_id and a.gravacao_id is null);
    delete from public.voz_curadoria_itens c where c.situacao = 'aberto'
       and (c.gravacao_id = old.id or (old.chamada_id is not null and c.chamada_id = old.chamada_id));
    update public.voz_curadoria_itens c set trecho_redigido = null, chamada_id = null, gravacao_id = null
     where c.gravacao_id = old.id or (old.chamada_id is not null and c.chamada_id = old.chamada_id);
    update public.voz_alertas a set trecho_redigido = null, id_cliente = null, chamada_id = null, gravacao_id = null,
           operador_ref = null
     where a.gravacao_id = old.id or (old.chamada_id is not null and a.chamada_id = old.chamada_id);
    update public.voz_treino_exemplos e set trecho_redigido = null where e.gravacao_id = old.id;
    return old;
end $$;
revoke all on function public.apagar_analise_voz() from public, anon, authenticated;
drop trigger if exists apagar_analise_voz on public.voz_gravacoes;
create trigger apagar_analise_voz before delete on public.voz_gravacoes
    for each row execute function public.apagar_analise_voz();

-- chamada sem gravação: depois da retenção, o alerta fica só como contagem (a VM chama junto com apagar_voz_expirada)
create or replace function public.apagar_analise_voz_expirada() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor apaga a análise vencida';
    end if;
    update public.voz_alertas x set trecho_redigido = null, id_cliente = null, chamada_id = null, gravacao_id = null,
           operador_ref = null
     where (x.id_cliente is not null or x.trecho_redigido is not null)
       and x.criado_em < now() - make_interval(days => coalesce(
               (select cf.retencao_dias from public.voz_config cf where cf.empresa_id = x.empresa_id), 90));
    get diagnostics a = row_count;
    delete from public.voz_trechos t where t.expira_em < now();
    update public.voz_buscas b set termo = '[apagado]' where b.em < now() - interval '1 year' and b.termo <> '[apagado]';
    return jsonb_build_object('alertas', a);
end $$;
revoke all on function public.apagar_analise_voz_expirada() from public, anon, authenticated;
grant execute on function public.apagar_analise_voz_expirada() to service_role;

-- ================================================================ 13. painéis (SA4 e telas): somam no servidor, grupo < 30 vira nulo
-- pct com piso de 30 na base
create or replace function public.pct30(parte numeric, base numeric, casas int default 1) returns numeric
language sql immutable parallel safe as $$
    select case when base >= 30 then round(100.0 * coalesce(parte, 0) / base, casas) end
$$;

create or replace function public.painel_speech(empresa bigint, credor bigint, de date, ate date,
                                                origem text default null, persona text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    n bigint;
    res jsonb;
    inicio_sem date := date_trunc('week', ate::timestamp)::date - 7 * 12;    -- 12 semanas completas
begin
    if empresa is null or empresa not in (select public.minhas_empresas()) then
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

-- Qualidade e compliance: nota por item (IA × humano), conformidade por semana, KPIs
create or replace function public.qualidade_voz(empresa bigint, credor bigint, de date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare res jsonb;
begin
    if empresa is null or empresa not in (select public.minhas_empresas()) then
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

-- lista das reprovadas (trecho só com ver_transcricoes; operador só com ver_operadores)
create or replace function public.reprovadas_voz(empresa bigint, credor bigint, de date, ate date, limite int default 20)
returns table (avaliacao_id bigint, gravacao_id bigint, id_cliente text, origem text, operador text, item text,
               avaliada_em timestamptz, trecho text, contestada boolean, total bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare ve_op boolean := public.pode('ver_operadores');
begin
    if not public.cliente_pode(empresa, 'ver_transcricoes') then
        raise exception 'a lista de reprovadas mostra trechos e exige ver_transcricoes';
    end if;
    return query
    select a.id, a.gravacao_id, ch.id_cliente, a.origem,
           case when a.origem = 'ia' then null when ve_op and a.operador_ref is not null
                then a.operador_ref || coalesce(' · ' || o.apelido, '') end,
           a.item_reprovado, a.avaliada_em, a.trecho_redigido, a.contestada_em is not null, count(*) over ()
      from public.voz_avaliacoes a
      join public.voz_chamadas ch on ch.id = a.chamada_id
      left join public.voz_operadores o on o.empresa_id = a.empresa_id and o.operador_ref = a.operador_ref
     where a.empresa_id = empresa and a.reprovada and (credor is null or a.credor_id = credor)
       and (a.avaliada_em at time zone 'America/Sao_Paulo')::date between de and ate
     order by a.avaliada_em desc
     limit least(greatest(coalesce(limite, 20), 1), 100);
end $$;

-- Operadores: só quem tem ver_operadores (ou o próprio operador, só a linha dele). Nota só com 30+ ligações.
create or replace function public.operadores_voz(empresa bigint, credor bigint, de date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    gestor boolean := public.cliente_pode(empresa, 'ver_operadores');
    meu text := (select o.operador_ref from public.voz_operadores o where o.empresa_id = empresa and o.usuario_id = auth.uid()
                  and o.ativo limit 1);
    res jsonb;
begin
    if empresa is null or empresa not in (select public.minhas_empresas()) or (not gestor and meu is null) then
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

-- a página do operador: itens contra a média da equipe (item só com 30+), 8 semanas e trechos para o 1:1
create or replace function public.operador_voz(empresa bigint, operador text, de date, ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    gestor boolean := public.cliente_pode(empresa, 'ver_operadores');
    res jsonb;
begin
    if empresa is null or empresa not in (select public.minhas_empresas())
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
    public.reprovadas_voz(bigint, bigint, date, date, int), public.operadores_voz(bigint, bigint, date, date),
    public.operador_voz(bigint, text, date, date) from public, anon;
grant execute on function public.painel_speech(bigint, bigint, date, date, text, text), public.qualidade_voz(bigint, bigint, date, date),
    public.reprovadas_voz(bigint, bigint, date, date, int), public.operadores_voz(bigint, bigint, date, date),
    public.operador_voz(bigint, text, date, date) to authenticated;

-- o motor lê os agregados da empresa para as regras de recomendação (só o servidor)
create or replace function public.renitencia_voz(empresa bigint, de date, ate date)
returns table (credor_id bigint, faixa text, tentativas bigint, cpcs bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor lê a renitência';
    end if;
    return query
    with c as (
        select ch.credor_id, ch.id_cliente, ch.ocorrido_em, ch.resultado,
               lag(ch.resultado) over w as anterior, lag(ch.ocorrido_em) over w as anterior_em
          from public.voz_chamadas ch
         where ch.empresa_id = empresa and ch.modo <> 'simulado'
           and (ch.ocorrido_em at time zone 'America/Sao_Paulo')::date between de and ate
        window w as (partition by ch.credor_id, ch.id_cliente order by ch.ocorrido_em))
    select coalesce(c.credor_id, 0),
           case when c.ocorrido_em - c.anterior_em < interval '30 minutes' then 'ate_30'
                when c.ocorrido_em - c.anterior_em < interval '45 minutes' then '30_45'
                when c.ocorrido_em - c.anterior_em < interval '90 minutes' then '45_90' else 'mais_90' end,
           count(*), count(*) filter (where c.resultado in ('cpc', 'promessa', 'recusa', 'identidade_confirmada', 'retorno_agendado'))
      from c where c.anterior = 'ocupado' and c.ocorrido_em - c.anterior_em < interval '1 day'
     group by 1, 2;
end $$;
revoke all on function public.renitencia_voz(bigint, date, date) from public, anon, authenticated;
grant execute on function public.renitencia_voz(bigint, date, date) to service_role;

-- ================================================================ 14. auditoria e permissões das funções
do $$
declare t text;
begin
    foreach t in array array['checklists_qualidade', 'checklist_versoes', 'voz_operadores', 'voz_treino_exemplos',
                             'voz_alertas', 'credores'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;

do $$
declare f regprocedure;
begin
    for f in select p.oid::regprocedure from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('jsonb_mesclar', 'texto_mascarado_ok', 'termo_busca_proibido', 'relatorio_agregado_ok',
                                  'politica_credor_ok', 'checklist_itens_ok', 'pct30') loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end $$;
