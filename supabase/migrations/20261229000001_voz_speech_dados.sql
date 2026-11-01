-- SQL 62 · Agente de voz: os dados do Speech Analytics (o que faltava para as telas do SQL 60 terem conteúdo).
-- Três peças, todas na VM de voz (voz/analise/analisador.py e voz/analise/rotina.py), com o mesmo LLM da Montagem:
-- 1. Avaliador por IA: cada ligação encerrada com transcrição mascarada é avaliada na versão do checklist vigente no
--    dia da ligação (checklist_vigente: o da empresa ou o padrão MotorCX), item a item (sim | nao | na), com a
--    evidência só como posição no tempo. A nota é a soma dos pesos aprovados ÷ a soma dos pesos avaliados; item
--    bloqueante com "nao" reprova (conformidade). Grava em voz_avaliacoes.
-- 2. Extrator de códigos: só códigos fechados (motivo, objeções, intenção do catálogo voz_intencoes, canal e horário
--    preferidos, riscos de reclamação/fraude, frases-código do agente e temas já promovidos pela Curadoria). Nunca
--    texto livre. Os códigos por cliente de sempre (codigos_voz_validos) também vão para voz_chamadas.codigos.
--    Vulnerabilidade só vira SINAL em voz_alertas (sem trecho, decisão 3 do SQL 60), nunca código. Procon,
--    jurídico, ameaça e linguagem abusiva viram alerta com o trecho mascarado.
--    Dúvida da IA vai para a fila da Curadoria (as regras do SQL 60, voz/analise/curadoria.py): intenção com
--    confiança < 0,5; motivo ou objeção com as duas maiores probabilidades a menos de 0,15; transcrição com mais de
--    30% ruim; e (novo) item do checklist com confiança < 0,6 (tipo nota, um por avaliação).
--    Avaliação e códigos saem de UMA chamada ao LLM por gravação (mais barato que duas).
-- 3. Job noturno: agregar_speech_dia(empresa, dia) refaz do zero, para o dia e a empresa, voz_conversao_dia,
--    voz_audio_dia e voz_qualidade_dia (operador só quando o ID vem do discador: voz_gravacoes.operador_ref), e a
--    semana inteira de voz_temas_semana. Idempotente (apaga e recalcula no mesmo comando). Grupo com menos de 30
--    continua escondido na leitura (as funções do SQL 60). Depois a VM roda as regras de motor/retroalimentacao.py
--    e o impacto de 28 dias pelas funções daqui.
-- Tabela nova voz_analise_chamadas: o resultado por gravação (códigos fechados, métricas de áudio, sentimento),
-- base do job noturno. Sem CPF, nome, telefone nem texto. Vai embora com a gravação (on delete cascade).
-- Liga por empresa: voz_config.speech_analytics (padrão desligado; o Master liga). Na VM, o metadado
-- motorcx-speech-analytics=1 liga as rotinas (padrão desligado).
-- Uso de IA (SQL 60, decisão 8 revista, e SQL 61): cada análise registra pelo registrar_uso_ia_voz, no componente
-- avaliador, os tokens reais (custo real pelo custos_ia_voz, só para a margem) e, só na primeira análise que deu
-- certo, os minutos cobráveis (item ia_speech_analytics, minuto analisado, pelo preço da empresa). Tentativa que
-- falhou registra o custo e não cobra. O custo nunca vai para a fatura. Premissa de custo do componente avaliador
-- (só entra se ainda não houver): a mesma do SQL 61 para LLM, US$ 0,60 por milhão de tokens × R$ 5,60.
-- Acesso próprio (SQL 57): tudo por funções de voz_vm com validação por linha, com os mesmos argumentos (um objeto
-- jsonb, como o corpo do PostgREST) das RPCs do public. As RPCs do motor que a retroalimentação usa
-- (registrar_recomendacao_voz, conferir_rascunhos_recomendacoes, renitencia_voz) e o sino dos alertas
-- (avisar_alertas_voz) passam a aceitar também a VM (chamada_da_vm_voz).
-- Depende dos SQL 56, 57, 58 (voz_intencoes), 60 e 61. Pode rodar de novo sem erro. ORDEM: rode depois do SQL 60 e
-- do 61; se o SQL 57 ou o 60 for rodado de novo, rode este depois.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public' and tablename = 'voz_analise_chamadas'
--             and rowsecurity) as tabela_com_rls,                                                      -- 1
--          (select column_default from information_schema.columns where table_name = 'voz_config'
--             and column_name = 'speech_analytics') as liga_por_empresa,                               -- false
--          has_table_privilege('authenticated', 'public.voz_analise_chamadas', 'select') as site_le,   -- false
--          has_function_privilege('motorcx_voz', 'voz_vm.gravar_analise_voz(jsonb)', 'execute')
--            and has_function_privilege('motorcx_voz', 'voz_vm.agregar_speech_dia(jsonb)', 'execute')
--            and not has_table_privilege('motorcx_voz', 'public.voz_analise_chamadas', 'select') as vm_speech, -- true
--          has_function_privilege('authenticated', 'public.gravar_analise_voz(jsonb)', 'execute') as site_grava, -- false
--          public.codigos_speech_ok('{"motivo": "desemprego", "riscos": ["procon"]}') as codigo_ok,     -- true
--          public.codigos_speech_ok('{"saude": "cancer"}') as saude_nunca_codigo,                       -- false
--          (select count(*) from public.custos_ia_voz where componente = 'avaliador') >= 1 as custo_premissa; -- true

create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then          -- já aplicado
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

-- ================================================================ 1. liga por empresa
alter table public.voz_config add column if not exists speech_analytics boolean not null default false;
comment on column public.voz_config.speech_analytics is
    'Speech Analytics (SQL 62): a VM avalia e extrai códigos das ligações transcritas desta empresa (minuto analisado na fatura). Padrão desligado.';

-- ================================================================ 2. códigos fechados da análise
--   motivo, objecoes, canal_preferido, horario_preferido  as listas de codigos_voz_validos (SQL 56)
--   intencao   código do catálogo voz_intencoes (conferido na gravação; o catálogo é tabela)
--   riscos     procon | juridico | ameaca | abusiva (viram alerta) | fraude | reclamacao (só código)
--   frases     frases-código do agente (motor/retroalimentacao.py › FRASES)
--   temas      ids de temas já promovidos pela Curadoria (até 3)
-- Saúde e vulnerabilidade nunca viram código (só o sinal do alerta).
create or replace function public.codigos_speech_ok(c jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare
    k text;
    v jsonb;
begin
    if c is null or jsonb_typeof(c) <> 'object' then
        return false;
    end if;
    for k, v in select * from jsonb_each(c) loop
        if k = 'motivo' then
            if jsonb_typeof(v) <> 'string' or v #>> '{}' not in ('desemprego', 'reducao_renda', 'outras_dividas',
                    'esquecimento', 'aguardando_recebimento', 'nao_reconhece', 'contestacao', 'fraude_alegada',
                    'insatisfacao_servico', 'outro') then
                return false;
            end if;
        elsif k = 'objecoes' then
            if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 5 or exists (
                    select 1 from jsonb_array_elements(v) o where jsonb_typeof(o) <> 'string'
                       or o #>> '{}' not in ('valor_alto', 'parcela_alta', 'juros', 'sem_dinheiro_agora', 'quer_desconto',
                                             'desconfia_golpe', 'quer_por_escrito', 'quer_falar_humano', 'outro')) then
                return false;
            end if;
        elsif k = 'intencao' then
            if jsonb_typeof(v) <> 'string' or v #>> '{}' !~ '^[a-z][a-z0-9_]{1,40}$' then
                return false;
            end if;
        elsif k = 'canal_preferido' then
            if jsonb_typeof(v) <> 'string'
               or v #>> '{}' not in ('whatsapp', 'sms', 'email', 'rcs', 'agente_voz', 'discador') then
                return false;
            end if;
        elsif k = 'horario_preferido' then
            if jsonb_typeof(v) <> 'string' or v #>> '{}' not in ('manha', 'tarde', 'noite', 'sabado') then
                return false;
            end if;
        elsif k = 'riscos' then
            if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 6 or exists (
                    select 1 from jsonb_array_elements(v) o where jsonb_typeof(o) <> 'string'
                       or o #>> '{}' not in ('procon', 'juridico', 'ameaca', 'abusiva', 'fraude', 'reclamacao')) then
                return false;
            end if;
        elsif k = 'frases' then
            if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 4 or exists (
                    select 1 from jsonb_array_elements(v) o where jsonb_typeof(o) <> 'string'
                       or o #>> '{}' not in ('reconheceu_dificuldade', 'resumiu_acordo', 'link_na_ligacao',
                                             'dia_vencimento')) then
                return false;
            end if;
        elsif k = 'temas' then
            if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 3 or exists (
                    select 1 from jsonb_array_elements(v) o where jsonb_typeof(o) <> 'number'
                       or (o #>> '{}')::numeric < 1 or (o #>> '{}')::numeric <> trunc((o #>> '{}')::numeric)) then
                return false;
            end if;
        else
            return false;
        end if;
    end loop;
    return true;
end $$;
revoke all on function public.codigos_speech_ok(jsonb) from public, anon;
grant execute on function public.codigos_speech_ok(jsonb) to authenticated, service_role;

-- ================================================================ 3. resultado por gravação (base do job noturno)
create table if not exists public.voz_analise_chamadas (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint references public.credores (id) on delete set null,
    chamada_id      bigint not null references public.voz_chamadas (id) on delete cascade,
    gravacao_id     bigint not null references public.voz_gravacoes (id) on delete cascade,
    origem          text not null check (origem in ('ia', 'discador')),
    operador_ref    text check (operador_ref is null or (operador_ref ~ '^[A-Za-z0-9_.:\-]{1,40}$'
                                                          and operador_ref !~ '[0-9]{8,}')),
    dia             date not null,
    situacao        text not null default 'ok' check (situacao in ('ok', 'falhou')),
    tentativas      int not null default 1 check (tentativas between 1 and 20),
    minutos         numeric(8, 2) not null default 0 check (minutos between 0 and 600),
    codigos         jsonb not null default '{}' check (public.codigos_speech_ok(codigos)),
    fala_agente_s   int not null default 0 check (fala_agente_s >= 0),
    fala_cliente_s  int not null default 0 check (fala_cliente_s >= 0),
    silencio_s      int not null default 0 check (silencio_s >= 0),
    interrupcoes    int not null default 0 check (interrupcoes >= 0),
    sentimento_ini  numeric(4, 3) check (sentimento_ini between -1 and 1),
    sentimento_fim  numeric(4, 3) check (sentimento_fim between -1 and 1),
    versao          text check (versao ~ '^[A-Za-z0-9_.:\-]{1,60}$'),
    analisada_em    timestamptz not null default now(),
    unique (chamada_id, origem),
    check (operador_ref is null or origem = 'discador'),
    check ((sentimento_ini is null) = (sentimento_fim is null)),
    check (situacao = 'ok' or codigos = '{}'::jsonb)
);
create index if not exists voz_analise_chamadas_dia on public.voz_analise_chamadas (empresa_id, dia);
comment on table public.voz_analise_chamadas is
    'SQL 62: resultado da IA por gravação (códigos fechados, fala/silêncio, sentimento), base dos agregados _dia. Sem dado pessoal nem texto. Vai embora com a gravação.';
alter table public.voz_analise_chamadas enable row level security;
revoke all on public.voz_analise_chamadas from anon, authenticated;     -- o site só lê os agregados, pelas funções
grant all on public.voz_analise_chamadas to service_role;

-- premissa de custo do componente avaliador (R$ por mil tokens; o Master troca em custos_ia_voz)
insert into public.custos_ia_voz (componente, por_mil_entrada, por_mil_saida, por_minuto, vigente_desde)
select 'avaliador', 0.00336, 0.00336, 0, date '2025-12-01'
 where not exists (select 1 from public.custos_ia_voz where componente = 'avaliador');

-- ================================================================ 4. o que a VM precisa para analisar
-- refs: [{ref, caminho}] das transcrições que a VM tem no disco (voz/transcricao/worker.py). Casa com a gravação da
-- empresa, nesta ordem: id da gravação, transcricao_caminho, nome do arquivo da gravação (sem extensão), id_chamada
-- (gravação do discador antes da da IA). Empate na melhor regra = ambígua (a VM não analisa). Não devolve id_cliente.
create or replace function public.speech_contexto_voz(empresa bigint, refs jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    res jsonb;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz leem o contexto da análise';
    end if;
    if jsonb_typeof(refs) <> 'array' or jsonb_array_length(refs) > 200
       or exists (select 1 from jsonb_array_elements(refs) r where jsonb_typeof(r) <> 'object'
                     or coalesce(r ->> 'ref', '') !~ '^[A-Za-z0-9_.:\-]{1,120}$'
                     or coalesce(r ->> 'caminho', '') !~ '^[A-Za-z0-9_\-/.]*$' or char_length(r ->> 'caminho') > 300) then
        raise exception 'refs: lista de até 200 {ref, caminho} sem caracteres fora do padrão';
    end if;
    if not exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.speech_analytics) then
        return jsonb_build_object('ligado', false, 'chamadas', '[]'::jsonb);
    end if;
    with r as (
        select x ->> 'ref' as ref, nullif(x ->> 'caminho', '') as caminho from jsonb_array_elements(refs) x),
    cand as (
        select r.ref, g.id as gravacao_id, g.chamada_id, g.credor_id, g.origem, g.operador_ref, g.duracao_s,
               ch.atendida_em, ch.ocorrido_em, ch.transferida_em,
               case when g.id::text = r.ref then 1
                    when g.transcricao_caminho is not null and g.transcricao_caminho = r.caminho then 2
                    when regexp_replace(g.caminho, '^.*/|\.[^./]*$', '', 'g') = r.ref then 3
                    when ch.id_chamada = r.ref and g.origem = 'discador' then 4
                    when ch.id_chamada = r.ref then 5 end as prio
          from r
          join public.voz_gravacoes g on g.empresa_id = empresa and g.chamada_id is not null
          join public.voz_chamadas ch on ch.id = g.chamada_id and ch.empresa_id = empresa and ch.modo <> 'simulado'
         where g.id::text = r.ref or g.transcricao_caminho = r.caminho
            or regexp_replace(g.caminho, '^.*/|\.[^./]*$', '', 'g') = r.ref or ch.id_chamada = r.ref),
    melhor as (
        select c.*, count(*) over (partition by c.ref, c.prio) as empates,
               rank() over (partition by c.ref order by c.prio) as pos
          from cand c),
    um as (
        select m.*, (coalesce(m.atendida_em, m.ocorrido_em) at time zone 'America/Sao_Paulo')::date as dia
          from melhor m where m.pos = 1)
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'ref', u.ref, 'ambigua', case when u.empates > 1 then true end,
               'gravacao_id', case when u.empates = 1 then u.gravacao_id end,
               'chamada_id', case when u.empates = 1 then u.chamada_id end,
               'credor_id', case when u.empates = 1 then u.credor_id end,
               'origem', case when u.empates = 1 then u.origem end,
               'operador_ref', case when u.empates = 1 and u.origem = 'discador' then u.operador_ref end,
               'duracao_s', case when u.empates = 1 then u.duracao_s end,
               'dia', case when u.empates = 1 then u.dia end,
               'transferida_s', case when u.empates = 1 and u.transferida_em is not null
                                     then greatest(0, round(extract(epoch from u.transferida_em
                                                                     - coalesce(u.atendida_em, u.ocorrido_em))::numeric, 1)) end,
               'versao_id', case when u.empates = 1 then public.checklist_vigente(empresa, u.dia) end,
               'situacao', (select a.situacao from public.voz_analise_chamadas a
                             where u.empates = 1 and a.chamada_id = u.chamada_id and a.origem = u.origem),
               'tentativas', (select a.tentativas from public.voz_analise_chamadas a
                               where u.empates = 1 and a.chamada_id = u.chamada_id and a.origem = u.origem))
           ) order by u.ref), '[]'::jsonb)
      into res
      from (select distinct on (ref) * from um order by ref, gravacao_id) u;
    return jsonb_build_object(
        'ligado', true,
        'chamadas', res,
        'checklists', coalesce((select jsonb_object_agg(v.id::text, v.itens) from public.checklist_versoes v
                                 where v.id in (select (x ->> 'versao_id')::bigint from jsonb_array_elements(res) x
                                                 where x ? 'versao_id')), '{}'::jsonb),
        'intencoes', coalesce((select jsonb_agg(i.codigo order by i.codigo) from public.voz_intencoes i where i.ativa),
                              '[]'::jsonb),
        'temas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome) order by t.id)
                             from public.voz_temas t where t.empresa_id = empresa and t.situacao = 'promovido'),
                          '[]'::jsonb));
end $$;

-- ================================================================ 5. grava o resultado de uma gravação
-- analise: {empresa_id, gravacao_id, situacao ok|falhou, versao, minutos, uso {chamadas_llm, tokens_entrada,
--           tokens_saida}, e, quando ok: codigos, audio {fala_agente_s, fala_cliente_s, silencio_s, interrupcoes},
--           sentimento {ini, fim} | null, avaliacao {versao_id, nota, itens, evidencia, reprovada, item_reprovado,
--           trecho_redigido, modelo}, alertas [...], curadoria [...]}
-- Tudo numa transação: análise, avaliação, códigos da chamada, alertas, fila da curadoria e uso de IA. Reenvio de
-- gravação já analisada não muda nada (só registra o custo das chamadas ao LLM, sem cobrar).
create or replace function public.gravar_analise_voz(analise jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    a jsonb := analise;
    emp bigint;
    g public.voz_gravacoes;
    ch public.voz_chamadas;
    ex public.voz_analise_chamadas;
    v public.checklist_versoes;
    ok boolean;
    primeira boolean := false;
    fora text;
    dia_l date;
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    minutos_v numeric;
    av jsonb;
    aval_id bigint;
    n_al int := 0;
    n_cur int := 0;
    custo numeric := 0;
    u jsonb;
    cods jsonb;
    opref text;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz gravam a análise';
    end if;
    if a is null or jsonb_typeof(a) <> 'object' then
        raise exception 'analise: um objeto';
    end if;
    select string_agg(k, ', ' order by k) into fora from jsonb_object_keys(a) k
     where k <> all (array['empresa_id', 'gravacao_id', 'situacao', 'versao', 'minutos', 'uso', 'codigos', 'audio',
                           'sentimento', 'avaliacao', 'alertas', 'curadoria']);
    if fora is not null then
        raise exception 'campos que a análise não grava: %', fora;
    end if;
    emp := (a ->> 'empresa_id')::bigint;
    ok := coalesce(a ->> 'situacao', 'ok') = 'ok';
    if coalesce(a ->> 'situacao', 'ok') not in ('ok', 'falhou') then
        raise exception 'situacao: ok ou falhou';
    end if;
    select * into g from public.voz_gravacoes x where x.id = (a ->> 'gravacao_id')::bigint and x.empresa_id = emp;
    if g.id is null or g.chamada_id is null then
        raise exception 'gravação não encontrada nesta empresa';
    end if;
    select * into ch from public.voz_chamadas x where x.id = g.chamada_id;
    if not exists (select 1 from public.voz_config c where c.empresa_id = emp and c.speech_analytics) then
        raise exception 'Speech Analytics desligado para esta empresa';
    end if;
    minutos_v := coalesce((a ->> 'minutos')::numeric, 0);
    if minutos_v < 0 or minutos_v > 600 then
        raise exception 'minutos fora do intervalo';
    end if;
    u := coalesce(a -> 'uso', '{}'::jsonb);
    if jsonb_typeof(u) <> 'object' or coalesce((u ->> 'tokens_entrada')::bigint, 0) < 0
       or coalesce((u ->> 'tokens_saida')::bigint, 0) < 0 or coalesce((u ->> 'chamadas_llm')::int, 0) not between 0 and 10 then
        raise exception 'uso inválido';
    end if;
    dia_l := (coalesce(ch.atendida_em, ch.ocorrido_em) at time zone 'America/Sao_Paulo')::date;
    opref := case when g.origem = 'discador' then g.operador_ref end;

    cods := coalesce(a -> 'codigos', '{}'::jsonb);
    if ok and not public.codigos_speech_ok(cods) then           -- entrada fora das listas: recusada sempre
        raise exception 'códigos fora das listas fechadas';
    end if;
    select * into ex from public.voz_analise_chamadas x where x.chamada_id = g.chamada_id and x.origem = g.origem for update;
    if ex.situacao = 'ok' then
        ok := false;                                   -- já analisada: só o custo desta tentativa
    elsif not ok then
        insert into public.voz_analise_chamadas as x (empresa_id, credor_id, chamada_id, gravacao_id, origem, operador_ref,
                                                      dia, situacao, tentativas, minutos, versao)
        values (emp, g.credor_id, g.chamada_id, g.id, g.origem, opref, dia_l, 'falhou', 1, minutos_v, a ->> 'versao')
        on conflict (chamada_id, origem) do update set tentativas = least(x.tentativas + 1, 20), analisada_em = now(),
                                                       versao = excluded.versao;
    else
        primeira := true;
        if cods ? 'intencao' and not exists (select 1 from public.voz_intencoes i where i.codigo = cods ->> 'intencao' and i.ativa) then
            raise exception 'intenção fora do catálogo';
        end if;
        if exists (select 1 from jsonb_array_elements_text(coalesce(cods -> 'temas', '[]'::jsonb)) t
                    where not exists (select 1 from public.voz_temas x where x.id = t::bigint and x.empresa_id = emp
                                         and x.situacao = 'promovido')) then
            raise exception 'tema que não é desta empresa (ou não foi promovido pela Curadoria)';
        end if;
        insert into public.voz_analise_chamadas as x (empresa_id, credor_id, chamada_id, gravacao_id, origem, operador_ref, dia,
                                                      situacao, tentativas, minutos, codigos, fala_agente_s, fala_cliente_s,
                                                      silencio_s, interrupcoes, sentimento_ini, sentimento_fim, versao)
        values (emp, g.credor_id, g.chamada_id, g.id, g.origem, opref, dia_l, 'ok', 1, minutos_v, cods,
                coalesce((a #>> '{audio,fala_agente_s}')::int, 0), coalesce((a #>> '{audio,fala_cliente_s}')::int, 0),
                coalesce((a #>> '{audio,silencio_s}')::int, 0), coalesce((a #>> '{audio,interrupcoes}')::int, 0),
                (a #>> '{sentimento,ini}')::numeric, (a #>> '{sentimento,fim}')::numeric, a ->> 'versao')
        on conflict (chamada_id, origem) do update
            set situacao = 'ok', tentativas = least(x.tentativas + 1, 20), minutos = excluded.minutos,
                codigos = excluded.codigos, fala_agente_s = excluded.fala_agente_s, fala_cliente_s = excluded.fala_cliente_s,
                silencio_s = excluded.silencio_s, interrupcoes = excluded.interrupcoes,
                sentimento_ini = excluded.sentimento_ini, sentimento_fim = excluded.sentimento_fim,
                versao = excluded.versao, analisada_em = now(), gravacao_id = excluded.gravacao_id;

        -- códigos por cliente de sempre (codigos_voz_validos): só as chaves de lá; promessa e retorno ficam
        update public.voz_chamadas x
           set codigos = (coalesce(x.codigos, '{}'::jsonb) - array['motivo', 'objecoes', 'canal_preferido', 'horario_preferido'])
                         || jsonb_strip_nulls(jsonb_build_object('motivo', cods -> 'motivo',
                                'objecoes', case when jsonb_array_length(coalesce(cods -> 'objecoes', '[]')) > 0 then cods -> 'objecoes' end,
                                'canal_preferido', cods -> 'canal_preferido', 'horario_preferido', cods -> 'horario_preferido'))
         where x.id = ch.id;

        -- avaliação na versão do checklist (da empresa ou o padrão; nunca de outra empresa)
        av := a -> 'avaliacao';
        if av is not null and jsonb_typeof(av) = 'object' then
            select v2.* into v from public.checklist_versoes v2 join public.checklists_qualidade c on c.id = v2.checklist_id
             where v2.id = (av ->> 'versao_id')::bigint and v2.situacao <> 'rascunho'
               and (c.empresa_id is null or c.empresa_id = emp);
            if v.id is null then
                raise exception 'versão do checklist que não vale para esta empresa';
            end if;
            if jsonb_typeof(av -> 'itens') <> 'object' or exists (
                    select 1 from jsonb_object_keys(av -> 'itens') k
                     where k not in (select x ->> 'id' from jsonb_array_elements(v.itens) x)) then
                raise exception 'item fora da versão do checklist';
            end if;
            insert into public.voz_avaliacoes (empresa_id, credor_id, chamada_id, gravacao_id, versao_id, origem, operador_ref,
                                               nota, itens, evidencia, reprovada, item_reprovado, trecho_redigido, modelo)
            values (emp, g.credor_id, g.chamada_id, g.id, v.id, g.origem, opref, (av ->> 'nota')::numeric, av -> 'itens',
                    coalesce(av -> 'evidencia', '{}'::jsonb), coalesce((av ->> 'reprovada')::boolean, false),
                    av ->> 'item_reprovado', av ->> 'trecho_redigido', av ->> 'modelo')
            on conflict (chamada_id, origem) do nothing
            returning id into aval_id;
        end if;

        -- alertas: só sinalizam. Vulnerabilidade só com o sinal (sem trecho).
        if jsonb_typeof(coalesce(a -> 'alertas', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(a -> 'alertas', '[]'::jsonb)) > 10 then
            raise exception 'alertas: lista de até 10';
        end if;
        insert into public.voz_alertas (empresa_id, credor_id, chamada_id, gravacao_id, id_cliente, tipo, sinal, falante,
                                        origem, operador_ref, inicio_s, trecho_redigido)
        select emp, g.credor_id, g.chamada_id, g.id, ch.id_cliente, x ->> 'tipo',
               case when x ->> 'tipo' = 'vulnerabilidade' then x ->> 'sinal' end, x ->> 'falante', g.origem,
               case when x ->> 'falante' = 'operador' then opref end, (x ->> 'inicio_s')::numeric,
               case when x ->> 'tipo' <> 'vulnerabilidade' then left(x ->> 'trecho', 600) end
          from jsonb_array_elements(coalesce(a -> 'alertas', '[]'::jsonb)) x;
        get diagnostics n_al = row_count;

        -- fila da curadoria (nasce aberta; a decisão é sempre de uma pessoa)
        if jsonb_typeof(coalesce(a -> 'curadoria', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(a -> 'curadoria', '[]'::jsonb)) > 20
           or exists (select 1 from jsonb_array_elements(coalesce(a -> 'curadoria', '[]'::jsonb)) x
                       where x ->> 'tipo' not in ('intencao', 'codigo', 'transcricao', 'nota')) then
            raise exception 'curadoria: até 20 itens de intencao, codigo, transcricao ou nota';
        end if;
        insert into public.voz_curadoria_itens (empresa_id, tipo, chamada_id, gravacao_id, avaliacao_id, trecho_redigido,
                                                decisao_ia, opcoes, confianca)
        select emp, x ->> 'tipo', g.chamada_id, g.id, case when x ->> 'tipo' = 'nota' then aval_id end,
               left(x ->> 'trecho_redigido', 600), coalesce(x -> 'decisao_ia', '{}'::jsonb), coalesce(x -> 'opcoes', '[]'::jsonb),
               (x ->> 'confianca')::numeric
          from jsonb_array_elements(coalesce(a -> 'curadoria', '[]'::jsonb)) x
         where x ->> 'tipo' <> 'nota' or aval_id is not null
        on conflict do nothing;
        get diagnostics n_cur = row_count;
    end if;

    -- uso de IA: custo real sempre; minuto cobrável só na primeira análise que deu certo
    if coalesce((u ->> 'tokens_entrada')::bigint, 0) + coalesce((u ->> 'tokens_saida')::bigint, 0) > 0 or primeira then
        custo := public.registrar_uso_ia_voz(emp, hoje, 'avaliador', case when primeira then 1 else 0 end, minutos_v,
                                             case when primeira then minutos_v else 0 end,
                                             coalesce((u ->> 'tokens_entrada')::bigint, 0),
                                             coalesce((u ->> 'tokens_saida')::bigint, 0));
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
        'situacao', case when ex.situacao = 'ok' then 'ja_analisada' when primeira then 'ok' else 'falhou' end,
        'avaliacao_id', aval_id, 'alertas', n_al, 'curadoria', n_cur, 'cobrado', primeira));
end $$;

-- ================================================================ 6. job noturno: agregados do dia (idempotente)
create or replace function public.agregar_speech_dia(empresa bigint, dia date) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    semana date := date_trunc('week', dia::timestamp)::date;
    n_conv int; n_audio int; n_qual int; n_temas int; n_ops int;
    disc text;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz agregam o dia';
    end if;
    if empresa is null or dia is null or dia > hoje or dia < hoje - 35 then
        raise exception 'dia fora da janela do job (até 35 dias atrás)';
    end if;
    delete from public.voz_conversao_dia x where x.empresa_id = empresa and x.data = dia;
    delete from public.voz_audio_dia x where x.empresa_id = empresa and x.data = dia;
    delete from public.voz_qualidade_dia x where x.empresa_id = empresa and x.data = dia;

    -- conversão (SA2) por dimensão: total, motivo, objeção, frase, tema, funil, horário e canal preferido
    with b as (
        select a.*, coalesce(a.credor_id, 0) as cr,
               (ch.resultado = 'promessa' or ch.data_promessa is not null) as acordo,
               coalesce(ch.identidade_confirmada, false) as ident,
               coalesce(av.itens ->> 'ck_oferta' = 'sim', false) as ofereceu,
               extract(hour from coalesce(ch.atendida_em, ch.ocorrido_em) at time zone 'America/Sao_Paulo')::int as hora
          from public.voz_analise_chamadas a
          join public.voz_chamadas ch on ch.id = a.chamada_id
          left join public.voz_avaliacoes av on av.chamada_id = a.chamada_id and av.origem = a.origem
         where a.empresa_id = empresa and a.dia = dia and a.situacao = 'ok')
    insert into public.voz_conversao_dia (empresa_id, credor_id, data, origem, persona, dimensao, valor, conversas, com_acordo)
    select empresa, b.cr, dia, b.origem, '', d.dim, d.val, count(*), count(*) filter (where b.acordo)
      from b cross join lateral (
            select 'total', 'todas'
            union all select 'motivo', b.codigos ->> 'motivo' where b.codigos ? 'motivo'
            union all select 'objecao', o from jsonb_array_elements_text(coalesce(b.codigos -> 'objecoes', '[]')) o
            union all select 'frase', f from jsonb_array_elements_text(coalesce(b.codigos -> 'frases', '[]')) f
            union all select 'tema', 'tema_' || t from jsonb_array_elements_text(coalesce(b.codigos -> 'temas', '[]')) t
            union all select 'canal_preferido', b.codigos ->> 'canal_preferido' where b.codigos ? 'canal_preferido'
            union all select 'horario', case when b.hora < 12 then 'manha' when b.hora < 17 then 'tarde' else 'noite' end
                       where b.hora between 8 and 19
            union all select 'funil', 'atendidas'
            union all select 'funil', 'identidade' where b.ident
            union all select 'funil', 'oferta' where b.ofereceu
            union all select 'funil', 'acordo' where b.acordo) d(dim, val)
     group by b.cr, b.origem, d.dim, d.val;
    get diagnostics n_conv = row_count;

    -- áudio e sentimento (SA3): somas; a média sai na função de leitura
    insert into public.voz_audio_dia (empresa_id, credor_id, data, origem, persona, ligacoes, fala_agente_s, fala_cliente_s,
                                      silencio_s, interrupcoes, sentimento_ini, sentimento_fim, com_sentimento, melhorou)
    select empresa, coalesce(a.credor_id, 0), dia, a.origem, '', count(*), sum(a.fala_agente_s), sum(a.fala_cliente_s),
           sum(a.silencio_s), sum(a.interrupcoes), coalesce(sum(a.sentimento_ini), 0), coalesce(sum(a.sentimento_fim), 0),
           count(a.sentimento_ini), count(*) filter (where a.sentimento_fim - a.sentimento_ini >= 0.2)
      from public.voz_analise_chamadas a
     where a.empresa_id = empresa and a.dia = dia and a.situacao = 'ok'
     group by coalesce(a.credor_id, 0), a.origem;
    get diagnostics n_audio = row_count;

    -- qualidade (SA8): a ligação (_ligacao) e cada item, na versão em que a nota foi dada. Operador só com o ID do
    -- discador (voz_gravacoes.operador_ref), nunca adivinhado.
    with q as (
        select coalesce(a.credor_id, 0) as cr, a.origem, coalesce(a.operador_ref, '') as op, av.versao_id, av.nota,
               av.reprovada, av.itens
          from public.voz_analise_chamadas a
          join public.voz_avaliacoes av on av.chamada_id = a.chamada_id and av.origem = a.origem
         where a.empresa_id = empresa and a.dia = dia and a.situacao = 'ok')
    insert into public.voz_qualidade_dia (empresa_id, credor_id, data, origem, persona, operador_ref, versao_id, item,
                                          avaliadas, aprovadas, na, nota_soma)
    select empresa, cr, dia, origem, '', op, versao_id, item, sum(av), sum(ap), sum(na), sum(ns)
      from (select cr, origem, op, versao_id, '_ligacao' as item, 1 as av, case when reprovada then 0 else 1 end as ap,
                   0 as na, nota as ns from q
            union all
            select cr, origem, op, versao_id, i.key, 1, case when i.value #>> '{}' = 'sim' then 1 else 0 end,
                   case when i.value #>> '{}' = 'na' then 1 else 0 end, 0
              from q cross join lateral jsonb_each(q.itens) i) z
     group by cr, origem, op, versao_id, item;
    get diagnostics n_qual = row_count;

    -- operadores vistos no dia (ID do discador) entram na lista; apelido e ativo continuam com a empresa
    disc := coalesce((select c.adaptador from public.voz_import_config c where c.empresa_id = empresa and c.ativo
                       order by c.id limit 1), 'generico');
    insert into public.voz_operadores (empresa_id, discador, operador_ref, apelido)
    select distinct empresa, disc, a.operador_ref,
           case when char_length(a.operador_ref) <= 30 and a.operador_ref !~ '[0-9]{6,}' then a.operador_ref
                else 'Operador ' || upper(substr(md5(a.operador_ref), 1, 4)) end
      from public.voz_analise_chamadas a
     where a.empresa_id = empresa and a.dia = dia and a.situacao = 'ok' and a.operador_ref is not null
    on conflict (empresa_id, operador_ref) do nothing;
    get diagnostics n_ops = row_count;

    -- temas da semana (segunda a domingo), refeita inteira
    delete from public.voz_temas_semana x where x.empresa_id = empresa and x.semana = semana;
    insert into public.voz_temas_semana (empresa_id, credor_id, semana, tema_id, conversas, com_acordo)
    select empresa, coalesce(a.credor_id, 0), semana, t::bigint, count(*),
           count(*) filter (where ch.resultado = 'promessa' or ch.data_promessa is not null)
      from public.voz_analise_chamadas a
      join public.voz_chamadas ch on ch.id = a.chamada_id
      cross join lateral jsonb_array_elements_text(coalesce(a.codigos -> 'temas', '[]')) t
     where a.empresa_id = empresa and a.situacao = 'ok' and a.dia between semana and semana + 6
       and exists (select 1 from public.voz_temas x where x.id = t::bigint and x.empresa_id = empresa)
     group by coalesce(a.credor_id, 0), t::bigint;
    get diagnostics n_temas = row_count;
    return jsonb_build_object('conversao', n_conv, 'audio', n_audio, 'qualidade', n_qual, 'temas', n_temas,
                              'operadores_novos', n_ops);
end $$;

-- empresas com o Speech Analytics ligado (parte i/n: esta VM cuida das empresas com id % n == i - 1)
create or replace function public.speech_empresas_voz(parte text default '1/1') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    i int;
    n int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz listam as empresas';
    end if;
    if coalesce(parte, '1/1') !~ '^[1-9][0-9]?/[1-9][0-9]?$' then
        raise exception 'parte: i/n';
    end if;
    i := split_part(coalesce(parte, '1/1'), '/', 1)::int;
    n := split_part(coalesce(parte, '1/1'), '/', 2)::int;
    if i > n then
        raise exception 'parte: i/n com i <= n';
    end if;
    return coalesce((select jsonb_agg(c.empresa_id order by c.empresa_id) from public.voz_config c
                      where c.speech_analytics and c.empresa_id % n = i - 1), '[]'::jsonb);
end $$;

-- ================================================================ 7. retroalimentação pela VM (motor/retroalimentacao.py)
-- o motor (service_role) e a VM (motorcx_voz) registram recomendações, conferem rascunhos e leem a renitência
select pg_temp.trocar('public.registrar_recomendacao_voz(bigint,bigint,text,text,text,text,text,jsonb,jsonb)',
'if not public.chamada_do_servidor() then
        raise exception ''só o motor registra recomendações'';',
'if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception ''só o motor registra recomendações'';');
select pg_temp.trocar('public.conferir_rascunhos_recomendacoes()',
'if not public.chamada_do_servidor() then
        raise exception ''só o motor confere os rascunhos'';',
'if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception ''só o motor confere os rascunhos'';');
select pg_temp.trocar('public.renitencia_voz(bigint,date,date)',
'if not public.chamada_do_servidor() then
        raise exception ''só o servidor lê a renitência'';',
'if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception ''só o servidor lê a renitência'';');
select pg_temp.trocar('public.avisar_alertas_voz()',
'if not public.chamada_do_servidor() then
        raise exception ''só o servidor avisa alertas'';',
'if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception ''só o servidor avisa alertas'';');

-- só agregados (nada por cliente): conversão do período e, se pedida, a realização por motivo e a renitência
create or replace function public.dados_retroalimentacao_voz(empresa bigint, de date, ate date, so_total boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz leem os agregados da retroalimentação';
    end if;
    if de is null or ate is null or ate < de or ate - de > 120 then
        raise exception 'período de até 120 dias';
    end if;
    return jsonb_build_object(
        'conversao', coalesce((select jsonb_agg(jsonb_build_object('credor_id', x.credor_id, 'data', x.data,
                                       'origem', x.origem, 'dimensao', x.dimensao, 'valor', x.valor,
                                       'conversas', x.conversas, 'com_acordo', x.com_acordo))
                                 from public.voz_conversao_dia x
                                where x.empresa_id = empresa and x.data between de and ate
                                  and (not coalesce(so_total, false) or x.dimensao = 'total')), '[]'::jsonb),
        'por_motivo', case when coalesce(so_total, false) then '[]'::jsonb else
                      coalesce((select jsonb_agg(to_jsonb(m) - 'empresa_id') from public.voz_resultado_por_motivo m
                                 where m.empresa_id = empresa and m.data between de and ate), '[]'::jsonb) end,
        'renitencia', case when coalesce(so_total, false) then '[]'::jsonb else
                      coalesce((select jsonb_agg(to_jsonb(r)) from public.renitencia_voz(empresa, de, ate) r), '[]'::jsonb) end);
end $$;

create or replace function public.recomendacoes_aplicadas_voz(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz leem as recomendações aplicadas';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'credor_id', r.credor_id, 'aplicada_em', r.aplicada_em)
                                      order by r.id)
                       from public.recomendacoes r where r.empresa_id = empresa and r.situacao = 'aplicada'), '[]'::jsonb);
end $$;

-- impacto antes × depois (28 dias): só com 30 ou mais conversas dos dois lados
create or replace function public.gravar_impacto_voz(rec bigint, metrica text, antes numeric, depois numeric,
                                                     n_antes int, n_depois int, janela_dias int default 28) returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
    r public.recomendacoes;
    iid bigint;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz gravam o impacto';
    end if;
    select * into r from public.recomendacoes x where x.id = rec;
    if r.id is null or r.situacao <> 'aplicada' then
        raise exception 'recomendação não aplicada';
    end if;
    if public.chamada_da_vm_voz() and not public.chamada_do_servidor()
       and not exists (select 1 from public.voz_config c where c.empresa_id = r.empresa_id) then
        raise exception 'empresa sem voz configurada';
    end if;
    if coalesce(gravar_impacto_voz.n_antes, 0) < 30 or coalesce(gravar_impacto_voz.n_depois, 0) < 30
       or gravar_impacto_voz.antes not between 0 and 100 or gravar_impacto_voz.depois not between 0 and 100 then
        raise exception 'impacto só com 30 ou mais conversas de cada lado';
    end if;
    insert into public.recomendacao_impacto as i (rec_id, metrica, antes, depois, n_antes, n_depois, janela_dias)
    values (rec, gravar_impacto_voz.metrica, gravar_impacto_voz.antes, gravar_impacto_voz.depois, gravar_impacto_voz.n_antes,
            gravar_impacto_voz.n_depois, coalesce(gravar_impacto_voz.janela_dias, 28))
    on conflict (rec_id, metrica) do update set antes = excluded.antes, depois = excluded.depois,
        n_antes = excluded.n_antes, n_depois = excluded.n_depois, janela_dias = excluded.janela_dias, medido_em = now()
    returning i.id into iid;
    return iid;
end $$;

revoke all on function public.speech_contexto_voz(bigint, jsonb), public.gravar_analise_voz(jsonb),
    public.agregar_speech_dia(bigint, date), public.speech_empresas_voz(text),
    public.dados_retroalimentacao_voz(bigint, date, date, boolean), public.recomendacoes_aplicadas_voz(bigint),
    public.gravar_impacto_voz(bigint, text, numeric, numeric, int, int, int) from public, anon, authenticated;
grant execute on function public.speech_contexto_voz(bigint, jsonb), public.gravar_analise_voz(jsonb),
    public.agregar_speech_dia(bigint, date), public.speech_empresas_voz(text),
    public.dados_retroalimentacao_voz(bigint, date, date, boolean), public.recomendacoes_aplicadas_voz(bigint),
    public.gravar_impacto_voz(bigint, text, numeric, numeric, int, int, int) to service_role;

-- ================================================================ 8. acesso próprio da VM (voz_vm, SQL 57)
-- mesmos argumentos das RPCs do public (um objeto jsonb, como o corpo do PostgREST) e a mesma resposta. Toda chamada
-- exige empresa com voz configurada; a gravação, a versão do checklist, os temas e a recomendação são conferidos
-- por linha nas funções do public.
create or replace function voz_vm.speech_contexto(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.speech_contexto_voz((args ->> 'empresa')::bigint, coalesce(args -> 'refs', '[]'::jsonb));
end $$;
create or replace function voz_vm.gravar_analise_voz(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if jsonb_typeof(args -> 'analise') is distinct from 'object'
       or not voz_vm.tem_voz((args #>> '{analise,empresa_id}')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.gravar_analise_voz(args -> 'analise');
end $$;
create or replace function voz_vm.agregar_speech_dia(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.agregar_speech_dia((args ->> 'empresa')::bigint, (args ->> 'dia')::date);
end $$;
create or replace function voz_vm.speech_empresas(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(e), '[]'::jsonb)
      from jsonb_array_elements(public.speech_empresas_voz(coalesce(args ->> 'parte', '1/1'))) e
     where voz_vm.tem_voz((e #>> '{}')::bigint)
$$;
create or replace function voz_vm.dados_retroalimentacao(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.dados_retroalimentacao_voz((args ->> 'empresa')::bigint, (args ->> 'de')::date, (args ->> 'ate')::date,
                                             coalesce((args ->> 'so_total')::boolean, false));
end $$;
create or replace function voz_vm.registrar_recomendacao_voz(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    if args ->> 'credor' is not null and not exists (select 1 from public.credores k where k.id = (args ->> 'credor')::bigint
                                                        and k.empresa_id = (args ->> 'empresa')::bigint) then
        raise exception 'referência de outra empresa';
    end if;
    return to_jsonb(public.registrar_recomendacao_voz((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint,
                                                      args ->> 'destino', args ->> 'regra', args ->> 'chave',
                                                      args ->> 'titulo', args ->> 'texto', args -> 'evidencia',
                                                      coalesce(args -> 'proposta', '{}'::jsonb)));
end $$;
create or replace function voz_vm.conferir_rascunhos_recomendacoes(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.conferir_rascunhos_recomendacoes())
$$;
create or replace function voz_vm.recomendacoes_aplicadas(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.recomendacoes_aplicadas_voz((args ->> 'empresa')::bigint);
end $$;
create or replace function voz_vm.gravar_impacto(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.gravar_impacto_voz((args ->> 'rec')::bigint, args ->> 'metrica', (args ->> 'antes')::numeric,
                                              (args ->> 'depois')::numeric, (args ->> 'n_antes')::int,
                                              (args ->> 'n_depois')::int, coalesce((args ->> 'janela_dias')::int, 28)))
$$;
create or replace function voz_vm.avisar_alertas(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.avisar_alertas_voz())
$$;

revoke all on function voz_vm.speech_contexto(jsonb), voz_vm.gravar_analise_voz(jsonb), voz_vm.agregar_speech_dia(jsonb),
    voz_vm.speech_empresas(jsonb), voz_vm.dados_retroalimentacao(jsonb), voz_vm.registrar_recomendacao_voz(jsonb),
    voz_vm.conferir_rascunhos_recomendacoes(jsonb), voz_vm.recomendacoes_aplicadas(jsonb), voz_vm.gravar_impacto(jsonb),
    voz_vm.avisar_alertas(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.speech_contexto(jsonb), voz_vm.gravar_analise_voz(jsonb), voz_vm.agregar_speech_dia(jsonb),
    voz_vm.speech_empresas(jsonb), voz_vm.dados_retroalimentacao(jsonb), voz_vm.registrar_recomendacao_voz(jsonb),
    voz_vm.conferir_rascunhos_recomendacoes(jsonb), voz_vm.recomendacoes_aplicadas(jsonb), voz_vm.gravar_impacto(jsonb),
    voz_vm.avisar_alertas(jsonb) to motorcx_voz;
