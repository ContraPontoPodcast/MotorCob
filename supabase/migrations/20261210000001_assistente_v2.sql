-- SQL 43 · Assistente MotorCX, revisão de UX (protótipo aprovado em 16/10/2026)
-- 1. assistente_config: teto do mês em reais (R$ 399,90), cotação do dólar (o motor busca a PTAX do Banco Central
--    todo dia; o Master pode digitar outra) e o modelo em uso (Sonnet 5.5).
-- 2. Cada pergunta guarda a situação (respondida · sem resposta · fora do ar · teto), o tema da base que respondeu,
--    os tokens e o custo estimado, o motivo do 👎 e o que a equipe fez (base completada, virou chamado, ignorada).
--    Fora do ar e teto não contam no limite de 30 por hora e não entram na lista "sem resposta".
-- 3. Sugestões por tela (a equipe escreve) e as mais perguntadas na empresa (só pergunta feita por 3 ou mais pessoas,
--    respondida e sem 👎).
-- 4. Respostas da equipe: Master e Atendimento publicam pelo Console e a função usa na hora (Auditoria).
-- 5. Contexto da pessoa para o Assistente (perfil, frentes, módulos e as telas que pode abrir), só para o servidor.
-- 6. Chamado aberto a partir do Assistente leva a pergunta junto (assistente_pergunta_id).
-- 7. Console: assistente_painel (uso, acerto, chamados, custo × teto, temas, telas), assistente_fila (perguntas
--    parecidas juntas) e resolver_perguntas_assistente. Aviso para a equipe com 80% e 100% do teto.
-- Depende dos SQL 11 (assistente_perguntas), 18 (frentes), 34 (avisos) e 42. Pode rodar de novo sem erro.

-- ================================================================ 1. configuração (teto e cotação)
create table if not exists public.assistente_config (
    id              int primary key default 1 check (id = 1),
    modelo          text not null default 'claude-sonnet-5-5' check (modelo ~ '^claude-[a-z0-9-]{3,40}$'),
    teto_mensal_brl numeric(10, 2) not null default 399.90 check (teto_mensal_brl >= 0),
    cotacao_dolar   numeric(8, 4) check (cotacao_dolar is null or cotacao_dolar between 1 and 50),
    cotacao_fonte   text not null default 'bcb' check (cotacao_fonte in ('bcb', 'manual')),
    cotacao_em      date,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid
);
comment on table public.assistente_config is
    'Assistente: modelo, teto do mês em reais e cotação do dólar (PTAX do Banco Central pelo motor, ou manual).';
insert into public.assistente_config (id) values (1) on conflict (id) do nothing;
alter table public.assistente_config enable row level security;
drop policy if exists assistente_config_ver on public.assistente_config;
create policy assistente_config_ver on public.assistente_config for select to authenticated using (public.sou_equipe());
revoke all on public.assistente_config from anon, authenticated;
grant select on public.assistente_config to authenticated;
grant all on public.assistente_config to service_role;

-- Master: teto e cotação manual (cotação vazia volta para a do Banco Central)
create or replace function public.salvar_assistente_config(teto numeric, cotacao numeric default null) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só o Master altera o teto do Assistente';
    end if;
    if teto is null or teto < 0 or teto > 100000 then
        raise exception 'teto inválido';
    end if;
    update public.assistente_config
       set teto_mensal_brl = round(teto, 2),
           cotacao_dolar = coalesce(cotacao, cotacao_dolar),
           cotacao_fonte = case when cotacao is null then 'bcb' else 'manual' end,
           cotacao_em = case when cotacao is null then cotacao_em else (now() at time zone 'America/Sao_Paulo')::date end,
           atualizado_em = now(), atualizado_por = auth.uid()
     where id = 1;
    insert into public.auditoria (usuario, tabela, acao, registro, mudou)
    values (auth.uid(), 'assistente_config', 'UPDATE', '1',
            jsonb_build_object('teto', jsonb_build_object('antes', null, 'depois', round(teto, 2)),
                               'cotacao', jsonb_build_object('antes', null, 'depois', coalesce(cotacao::text, 'Banco Central'))));
end $$;
revoke all on function public.salvar_assistente_config(numeric, numeric) from public, anon;
grant execute on function public.salvar_assistente_config(numeric, numeric) to authenticated;

-- o motor grava a PTAX do dia (só quando a cotação não é manual)
create or replace function public.registrar_cotacao_dolar(valor numeric, dia date) returns void
language sql security definer set search_path = public as $$
    update public.assistente_config set cotacao_dolar = valor, cotacao_em = dia
     where id = 1 and cotacao_fonte = 'bcb' and valor between 1 and 50
$$;

-- ================================================================ 2. perguntas: situação, tema, custo, 👎, resolução
alter table public.assistente_perguntas add column if not exists situacao text not null default 'respondida'
    check (situacao in ('respondida', 'sem_resposta', 'fora_do_ar', 'teto'));
update public.assistente_perguntas set situacao = 'sem_resposta' where not respondida and situacao = 'respondida';
alter table public.assistente_perguntas add column if not exists tema text check (tema is null or char_length(tema) <= 60);
alter table public.assistente_perguntas add column if not exists tela_nome text check (tela_nome is null or char_length(tela_nome) <= 80);
alter table public.assistente_perguntas add column if not exists modelo text check (modelo is null or char_length(modelo) <= 60);
alter table public.assistente_perguntas add column if not exists tokens jsonb check (tokens is null or jsonb_typeof(tokens) = 'object');
alter table public.assistente_perguntas add column if not exists custo_usd numeric(10, 6) check (custo_usd is null or custo_usd >= 0);
alter table public.assistente_perguntas add column if not exists ms int check (ms is null or ms >= 0);
alter table public.assistente_perguntas add column if not exists removeu_dado boolean not null default false;
alter table public.assistente_perguntas add column if not exists resposta_equipe_id bigint;
alter table public.assistente_perguntas add column if not exists avaliacao_motivo text
    check (avaliacao_motivo is null or avaliacao_motivo in ('nao_respondeu', 'errado', 'dificil', 'sem_acesso'));
alter table public.assistente_perguntas add column if not exists resolucao text not null default 'nova'
    check (resolucao in ('nova', 'base_completada', 'virou_chamado', 'ignorada'));
alter table public.assistente_perguntas add column if not exists resolucao_motivo text
    check (resolucao_motivo is null or char_length(resolucao_motivo) <= 200);
alter table public.assistente_perguntas add column if not exists resolvido_por uuid;
alter table public.assistente_perguntas add column if not exists resolvido_em timestamptz;
alter table public.assistente_perguntas add column if not exists chamado_id bigint;
create index if not exists assistente_perguntas_mes on public.assistente_perguntas (criado_em) where custo_usd is not null;

-- quem grava sem a situação (versão antiga da função) continua certo: não respondida = sem resposta
create or replace function public.pergunta_situacao() returns trigger
language plpgsql as $$
begin
    if new.situacao = 'respondida' and not new.respondida then
        new.situacao := 'sem_resposta';
    end if;
    return new;
end $$;
drop trigger if exists pergunta_situacao on public.assistente_perguntas;
create trigger pergunta_situacao before insert on public.assistente_perguntas
    for each row execute function public.pergunta_situacao();

-- 👎 com motivo (a mesma função de antes, com o motivo opcional)
drop function if exists public.avaliar_resposta(bigint, smallint);
create or replace function public.avaliar_resposta(id_pergunta bigint, nota smallint, motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
    if nota not in (-1, 1) then
        raise exception 'avaliação inválida';
    end if;
    if motivo is not null and (nota = 1 or motivo not in ('nao_respondeu', 'errado', 'dificil', 'sem_acesso')) then
        raise exception 'motivo inválido';
    end if;
    update public.assistente_perguntas set avaliacao = nota, avaliacao_motivo = motivo
     where id = id_pergunta and usuario_id = auth.uid();
    if not found then
        raise exception 'pergunta não encontrada';
    end if;
end $$;
revoke all on function public.avaliar_resposta(bigint, smallint, text) from public, anon;
grant execute on function public.avaliar_resposta(bigint, smallint, text) to authenticated;

-- a lista antiga do Console deixa de fora o que foi falha nossa ou teto
create or replace view public.assistente_sem_resposta with (security_invoker = true) as
select p.id, p.criado_em, p.empresa_id, e.nome as empresa, p.tela, p.pergunta, p.resposta, p.avaliacao
  from public.assistente_perguntas p
  left join public.empresas e on e.id = p.empresa_id
 where (p.situacao = 'sem_resposta' or p.avaliacao = -1) and public.admin_equipe();

-- limite por hora: só o que o Assistente respondeu (fora do ar e teto não contam)
create or replace function public.perguntas_na_hora(usuario uuid) returns int
language sql stable security definer set search_path = public as $$
    select count(*)::int from public.assistente_perguntas
     where usuario_id = usuario and criado_em > now() - interval '1 hour' and situacao in ('respondida', 'sem_resposta')
$$;

-- custo do mês (fuso de São Paulo) em dólar e em reais, contra o teto
create or replace function public.assistente_custo_mes() returns table (usd numeric, brl numeric, teto numeric, cotacao numeric, pct numeric)
language sql stable security definer set search_path = public as $$
    with c as (select * from public.assistente_config where id = 1),
         s as (select coalesce(sum(custo_usd), 0) as usd from public.assistente_perguntas
                where criado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    select round(s.usd, 4), round(s.usd * c.cotacao_dolar, 2), c.teto_mensal_brl, c.cotacao_dolar,
           case when c.cotacao_dolar is null or c.teto_mensal_brl = 0 then null
                else round(100 * s.usd * c.cotacao_dolar / c.teto_mensal_brl, 1) end
      from c, s
$$;

-- ================================================================ 3. sugestões
create or replace function public.pode_responder_assistente() returns boolean
language sql stable security definer set search_path = public as $$
    select public.admin_equipe()
        or exists (select 1 from public.perfis p where p.id = auth.uid() and p.ativo and p.equipe and p.papel <> 'gestao')
$$;

create table if not exists public.assistente_sugestoes (
    id        bigint generated always as identity primary key,
    tela      text not null check (tela ~ '^/[a-z0-9_/-]{0,79}$'),        -- vale para a tela e as de dentro dela
    pergunta  text not null check (char_length(trim(pergunta)) between 5 and 120),
    ordem     int not null default 0,
    ativo     boolean not null default true,
    unique (tela, pergunta)
);
alter table public.assistente_sugestoes enable row level security;
drop policy if exists assistente_sugestoes_ver on public.assistente_sugestoes;
create policy assistente_sugestoes_ver on public.assistente_sugestoes for select to authenticated using (true);
drop policy if exists assistente_sugestoes_equipe on public.assistente_sugestoes;
create policy assistente_sugestoes_equipe on public.assistente_sugestoes for all to authenticated
    using (public.pode_responder_assistente()) with check (public.pode_responder_assistente());
revoke all on public.assistente_sugestoes from anon;
grant select, insert, update, delete on public.assistente_sugestoes to authenticated;
grant all on public.assistente_sugestoes to service_role;
insert into public.assistente_sugestoes (tela, pergunta, ordem) values
    ('/', 'O que é Disparado e Enviado?', 1),
    ('/', 'Como convido um usuário?', 2),
    ('/', 'Como baixo a Lista do dia?', 3),
    ('/lista-do-dia', 'Como baixo a Lista do dia?', 1),
    ('/lista-do-dia', 'Por que um cliente não está na lista de hoje?', 2),
    ('/lista-do-dia', 'O que é reserva na lista?', 3),
    ('/mensageria', 'Como agendo uma campanha?', 1),
    ('/mensageria', 'Por que a prévia mostra menos números?', 2),
    ('/mensageria', 'O que é Score de Entrega?', 3),
    ('/relatorios', 'Como monto um relatório meu?', 1),
    ('/relatorios', 'Como recebo um relatório por e-mail?', 2),
    ('/relatorios', 'Qual a diferença entre Entregue e Lido?', 3),
    ('/orquestracao', 'Como mudo a prioridade de uma fase?', 1),
    ('/orquestracao', 'O que acontece quando separo a estratégia de uma carteira?', 2),
    ('/orquestracao', 'Como funciona o orçamento por canal?', 3),
    ('/jornada', 'O que mostra o mapa da jornada?', 1),
    ('/jornada', 'Como escolho a mensagem de cada momento?', 2),
    ('/jornada', 'Como o melhor canal é escolhido?', 3),
    ('/empresa', 'Como marco quem recebe as faturas?', 1),
    ('/empresa', 'Como crio um token de API?', 2),
    ('/empresa', 'Como pago uma fatura vencida?', 3)
on conflict (tela, pergunta) do nothing;

-- 3 desta tela (a mais específica) + 2 mais perguntadas na empresa (só com 3 pessoas ou mais, respondidas e sem 👎)
create or replace function public.sugestoes_assistente(tela text) returns table (grupo text, pergunta text)
language sql stable security definer set search_path = public as $$
    with t as (
        select s.pergunta, s.ordem, length(s.tela) as peso
          from public.assistente_sugestoes s
         where s.ativo and (sugestoes_assistente.tela = s.tela or sugestoes_assistente.tela like rtrim(s.tela, '/') || '/%'
                            or s.tela = '/')
    ), melhor as (select max(peso) as peso from t),
    tela_sug as (
        select 'tela'::text as grupo, t.pergunta from t, melhor where t.peso = melhor.peso order by t.ordem limit 3
    ), empresa as (
        select p.empresa_id from public.perfis p where p.id = auth.uid() and p.ativo and not p.equipe
    ), freq as (
        select 'frequentes'::text as grupo, min(q.pergunta) as pergunta
          from public.assistente_perguntas q, empresa
         where q.empresa_id = empresa.empresa_id and q.criado_em > now() - interval '30 days'
           and q.situacao = 'respondida' and q.avaliacao is distinct from -1 and q.removeu_dado = false
         group by trim(lower(regexp_replace(q.pergunta, '[[:punct:][:space:]]+', ' ', 'g')))
        having count(distinct q.usuario_id) >= 3
         order by count(*) desc limit 2
    )
    select * from tela_sug
    union all
    select * from freq where freq.pergunta not in (select tela_sug.pergunta from tela_sug)
$$;
revoke all on function public.sugestoes_assistente(text) from public, anon;
grant execute on function public.sugestoes_assistente(text) to authenticated;

-- ================================================================ 4. respostas da equipe
create table if not exists public.assistente_respostas (
    id            bigint generated always as identity primary key,
    pergunta      text not null check (char_length(trim(pergunta)) between 5 and 200),
    resposta      text not null check (char_length(trim(resposta)) between 5 and 1500),
    passos        text[] not null default '{}' check (cardinality(passos) <= 6),
    acao          text check (acao is null or acao ~ '^[a-z_]{3,40}$'),
    tela          text check (tela is null or tela ~ '^/[a-z0-9_/-]{0,79}$'),
    frente        text not null default 'todas' check (frente in ('todas', 'motorcob', 'motorcli')),
    ativo         boolean not null default true,
    usos          int not null default 0,
    aprovacoes    int not null default 0,
    reprovacoes   int not null default 0,
    criado_por    uuid default auth.uid(),
    criado_em     timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    -- nada de dado pessoal nem preço na resposta da equipe
    check ((pergunta || ' ' || resposta || ' ' || array_to_string(passos, ' '))
           !~* '([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{8,}|R\$)')
);
comment on table public.assistente_respostas is
    'Respostas que a equipe escreve pelo Console; a função assistente usa junto com a base do código, na hora.';
alter table public.assistente_respostas enable row level security;
drop policy if exists assistente_respostas_ver on public.assistente_respostas;
create policy assistente_respostas_ver on public.assistente_respostas for select to authenticated
    using (public.pode_responder_assistente());
drop policy if exists assistente_respostas_editar on public.assistente_respostas;
create policy assistente_respostas_editar on public.assistente_respostas for all to authenticated
    using (public.pode_responder_assistente()) with check (public.pode_responder_assistente());
revoke all on public.assistente_respostas from anon;
grant select, insert, update, delete on public.assistente_respostas to authenticated;
grant all on public.assistente_respostas to service_role;
drop trigger if exists z_auditar on public.assistente_respostas;
create trigger z_auditar after insert or update or delete on public.assistente_respostas
    for each row execute function public.auditar();

-- resposta publicada a partir da fila marca as perguntas como "base completada"
create or replace function public.resolver_perguntas_assistente(ids bigint[], resolucao text, motivo text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if not public.pode_responder_assistente() then
        raise exception 'só Master e Atendimento resolvem perguntas do Assistente';
    end if;
    if resolucao not in ('nova', 'base_completada', 'ignorada') then
        raise exception 'situação inválida';
    end if;
    if resolucao = 'ignorada' and coalesce(trim(motivo), '') = '' then
        raise exception 'diga por que ignorar';
    end if;
    update public.assistente_perguntas p
       set resolucao = resolver_perguntas_assistente.resolucao, resolucao_motivo = left(motivo, 200),
           resolvido_por = auth.uid(), resolvido_em = now()
     where p.id = any (ids) and p.resolucao <> 'virou_chamado';
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function public.resolver_perguntas_assistente(bigint[], text, text) from public, anon;
grant execute on function public.resolver_perguntas_assistente(bigint[], text, text) to authenticated;

-- a função conta o uso de uma resposta da equipe (e a avaliação dela vem pela pergunta)
create or replace function public.contar_resposta_equipe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' and new.resposta_equipe_id is not null then
        update public.assistente_respostas set usos = usos + 1 where id = new.resposta_equipe_id;
    elsif tg_op = 'UPDATE' and new.resposta_equipe_id is not null and new.avaliacao is distinct from old.avaliacao then
        update public.assistente_respostas
           set aprovacoes = aprovacoes + (case when new.avaliacao = 1 then 1 else 0 end) - (case when old.avaliacao = 1 then 1 else 0 end),
               reprovacoes = reprovacoes + (case when new.avaliacao = -1 then 1 else 0 end) - (case when old.avaliacao = -1 then 1 else 0 end)
         where id = new.resposta_equipe_id;
    end if;
    return new;
end $$;
drop trigger if exists contar_resposta_equipe on public.assistente_perguntas;
create trigger contar_resposta_equipe after insert or update of avaliacao on public.assistente_perguntas
    for each row execute function public.contar_resposta_equipe();

-- ================================================================ 5. contexto da pessoa (só o servidor)
-- Perfil, frentes, módulos ativos e as permissões que decidem quais telas o Assistente pode sugerir.
create or replace function public.contexto_assistente(usuario uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    p public.perfis;
    antes text := current_setting('request.jwt.claim.sub', true);
    r jsonb;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor monta o contexto do Assistente';
    end if;
    select * into p from public.perfis where id = usuario;
    if p.id is null or not p.ativo then
        return null;
    end if;
    perform set_config('request.jwt.claim.sub', usuario::text, true);
    select jsonb_build_object(
        'papel', p.papel, 'equipe', p.equipe, 'empresa_id', p.empresa_id,
        'frentes', coalesce((select jsonb_agg(f.frente order by f.frente) from public.empresa_frentes f
                              where f.empresa_id = p.empresa_id and f.ativo
                                and (not exists (select 1 from public.usuario_frentes u where u.usuario_id = p.id)
                                     or exists (select 1 from public.usuario_frentes u where u.usuario_id = p.id and u.frente = f.frente))),
                            '[]'),
        'modulos', coalesce((select jsonb_agg(m.modulo order by m.modulo) from public.empresa_modulos m
                              where m.empresa_id = p.empresa_id and m.ativo), '[]'),
        'pode', jsonb_build_object(
            'gerenciar_usuarios', public.pode('gerenciar_usuarios'), 'ver_auditoria', public.pode('ver_auditoria'),
            'ver_faturamento', public.pode('ver_faturamento'), 'gerenciar_api', public.pode('gerenciar_api'),
            'editar_orquestracao', public.pode('editar_orquestracao'), 'enviar_mensagens', public.pode('enviar_mensagens'),
            'editar_canais', public.pode('editar_canais'))) into r;
    perform set_config('request.jwt.claim.sub', coalesce(antes, ''), true);
    return r;
end $$;

-- respostas da equipe ativas, para a função (só o servidor)
create or replace function public.respostas_equipe_assistente() returns table (id bigint, pergunta text, resposta text,
    passos text[], acao text, tela text, frente text)
language sql stable security definer set search_path = public as $$
    select r.id, r.pergunta, r.resposta, r.passos, r.acao, r.tela, r.frente
      from public.assistente_respostas r where r.ativo order by r.id
$$;

-- ================================================================ 6. chamado aberto pelo Assistente
alter table public.chamados add column if not exists assistente_pergunta_id bigint
    references public.assistente_perguntas (id) on delete set null;
create or replace function public.chamado_do_assistente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.assistente_pergunta_id is not null then
        update public.assistente_perguntas
           set resolucao = 'virou_chamado', chamado_id = new.id, resolvido_em = now()
         where id = new.assistente_pergunta_id and usuario_id = new.aberto_por;
    end if;
    return new;
end $$;
drop trigger if exists chamado_do_assistente on public.chamados;
create trigger chamado_do_assistente after insert on public.chamados
    for each row execute function public.chamado_do_assistente();

-- ================================================================ 7. Console
create or replace function public.assistente_painel(dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    d int := least(greatest(coalesce(dias, 30), 1), 90);
    r jsonb;
begin
    if not public.sou_equipe() then
        raise exception 'só a equipe vê o painel do Assistente';
    end if;
    with s as (select * from public.assistente_perguntas where criado_em > now() - make_interval(days => d)),
         v as (select * from s where situacao in ('respondida', 'sem_resposta'))
    select jsonb_build_object(
        'perguntas', (select count(*) from v),
        'pessoas', (select count(distinct usuario_id) from v),
        'empresas', (select count(distinct empresa_id) from v),
        'respondidas_pct', (select round(100.0 * count(*) filter (where situacao = 'respondida') / nullif(count(*), 0), 1) from v),
        'sem_resposta', (select count(*) from v where situacao = 'sem_resposta'),
        'avaliadas', (select count(*) from v where avaliacao is not null),
        'aprovacao_pct', (select round(100.0 * count(*) filter (where avaliacao = 1) / nullif(count(*) filter (where avaliacao is not null), 0), 1) from v),
        'viraram_chamado', (select count(*) from s where resolucao = 'virou_chamado'),
        'fora_do_ar', (select count(*) from s where situacao = 'fora_do_ar'),
        'no_teto', (select count(*) from s where situacao = 'teto'),
        'tempo_medio_ms', (select round(avg(ms)) from v where ms is not null),
        'custo', (select to_jsonb(c) from public.assistente_custo_mes() c),
        'temas', coalesce((select jsonb_agg(x order by (x->>'perguntas')::int desc) from (
            select jsonb_build_object('tema', coalesce(tema, 'Sem tema'), 'perguntas', count(*)) x
              from v group by coalesce(tema, 'Sem tema') order by count(*) desc limit 8) t), '[]'),
        'telas', coalesce((select jsonb_agg(x) from (
            select jsonb_build_object('tela', coalesce(tela_nome, tela, '—'), 'perguntas', count(*),
                                      'sem_resposta_pct', round(100.0 * count(*) filter (where situacao = 'sem_resposta') / count(*), 1)) x
              from v group by coalesce(tela_nome, tela, '—') having count(*) >= 5
             order by count(*) filter (where situacao = 'sem_resposta')::numeric / count(*) desc limit 8) t), '[]'),
        'dias', d) into r;
    return r;
end $$;
revoke all on function public.assistente_painel(int) from public, anon;
grant execute on function public.assistente_painel(int) to authenticated;

-- fila "Para resolver": sem resposta e 👎, perguntas parecidas juntas
create or replace function public.assistente_fila(resolucao text default 'nova', dias int default 30)
returns table (pergunta text, tela text, motivo text, repetiu bigint, empresas bigint, ultima timestamptz, ids bigint[])
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.pode_responder_assistente() then
        raise exception 'só Master e Atendimento veem a fila do Assistente';
    end if;
    return query
    select (array_agg(p.pergunta order by p.criado_em desc))[1],
           (array_agg(coalesce(p.tela_nome, p.tela) order by p.criado_em desc))[1],
           case when bool_or(p.situacao = 'sem_resposta') then 'sem resposta'
                else '👎 ' || coalesce((array_agg(p.avaliacao_motivo order by p.criado_em desc) filter (where p.avaliacao_motivo is not null))[1], '') end,
           count(*), count(distinct p.empresa_id), max(p.criado_em), array_agg(p.id order by p.id)
      from public.assistente_perguntas p
     where p.criado_em > now() - make_interval(days => least(greatest(coalesce(dias, 30), 1), 90))
       and (p.situacao = 'sem_resposta' or p.avaliacao = -1)
       and p.resolucao = assistente_fila.resolucao
     group by trim(lower(regexp_replace(p.pergunta, '[[:punct:][:space:]]+', ' ', 'g')))
     order by count(*) desc, max(p.criado_em) desc
     limit 200;
end $$;
revoke all on function public.assistente_fila(text, int) from public, anon;
grant execute on function public.assistente_fila(text, int) to authenticated;

-- aviso para a equipe com 80% e com 100% do teto (o motor chama a cada 10 minutos)
create or replace function public.avisar_teto_assistente() returns int
language plpgsql security definer set search_path = public as $$
declare
    c record;
    mes text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
    n int := 0;
begin
    select * into c from public.assistente_custo_mes();
    if c.pct is null then
        return 0;
    end if;
    if c.pct >= 80 then
        insert into public.avisos (para, tipo, titulo, texto, link, chave, assunto)
        values ('equipe', case when c.pct >= 100 then 'erro' else 'atencao' end,
                case when c.pct >= 100 then 'Assistente no teto do mês' else 'Assistente com 80% do teto do mês' end,
                left('Custo estimado R$ ' || to_char(c.brl, 'FM999G990D00') || ' de R$ ' || to_char(c.teto, 'FM999G990D00')
                     || case when c.pct >= 100 then '. Até virar o mês, só Respostas da equipe e Suporte.' else '.' end, 400),
                '/console/assistente', 'assistente_teto:' || mes || ':' || case when c.pct >= 100 then '100' else '80' end, 'equipe')
        on conflict (chave) where chave is not null do nothing;
        get diagnostics n = row_count;
    end if;
    return n;
end $$;

do $$
declare f text;
begin
    foreach f in array array['public.registrar_cotacao_dolar(numeric, date)', 'public.perguntas_na_hora(uuid)',
                             'public.assistente_custo_mes()', 'public.contexto_assistente(uuid)',
                             'public.respostas_equipe_assistente()', 'public.avisar_teto_assistente()'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;
revoke all on function public.pode_responder_assistente() from public, anon;
grant execute on function public.pode_responder_assistente() to authenticated;
