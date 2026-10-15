-- SQL 33 · Bloco 6 da homologação (aprovado em 14/10/2026): qualidade dos fornecedores, função Técnico e Score de
-- Entrega.
--
-- 1. Equipe: função Técnico (papel operacao + perfis.equipe_tecnico). Vê a qualidade dos fornecedores e o detalhe
--    técnico, configura o filtro de inteligência e os nomes devolvidos ao cliente. Permissões novas no catálogo.
-- 2. Mensagens: dlr_em e dlr_codigo (quando e com que código a DLR voltou), score_faixa, score_prob,
--    score_controle e filtro ('score' = não enviado pelo filtro; o nome que o cliente vê é editável à parte).
-- 3. Filtro de inteligência por rota (mensageria_score_config; linha sem plano = padrão): janela, meia-vida, peso
--    da falha permanente, força da base, faixas, quarentena (menor que a janela) e grupo de controle. Fornecedores cuja DLR entra na
--    análise (mensageria_score_fornecedores). Nomes devolvidos (mensageria_score_nomes), com trava: nada que imite
--    status de operadora.
-- 4. score_entrega(hashes, item): probabilidade de entrega e faixa (alto, medio, baixo, sem) de cada número, pelo
--    histórico de tudo o que saiu pela Mensageria (decisão do bloco 6), com peso maior para o recente e a base da
--    operadora para quem tem pouco histórico. O motor tem a mesma conta em nuvem/score.py.
-- 5. Contratação do Score (empresa_score): por número analisado ou só pelos represados; itens de cobrança
--    score_analisado e score_represado. Campanha escolhe as faixas que recebem (mensageria_campanhas.score_faixas).
-- 6. Leituras: qualidade_fornecedores, qualidade_por_hora, alertas_qualidade, detalhe_tecnico_envios,
--    controle_score e economia_score (economia líquida e custo unitário efetivo, com valores faturados);
--    vitrine_score para quem não contratou (SMS que não chegaram e quanto custaram, dados reais).
-- 7. Prévia do Score antes de agendar, para campanha pela plataforma (situação 'calculando_previa' e score_previa);
--    agendar_campanha recebe as faixas escolhidas. Campanha pela API segue direto.
-- Rode depois do SQL 32. Pode rodar mais de uma vez.

-- ================================================================ 1. função Técnico
alter table public.perfis add column if not exists equipe_tecnico boolean not null default false;
comment on column public.perfis.equipe_tecnico is 'Equipe: função Técnico (papel operacao). Ver funcao_da_equipe().';

create or replace view public.permissoes_equipe_catalogo as
select * from (values
    ('ver_empresas', 'Empresas', 'Ver empresas e Saúde', true, true, true, true, true),
    ('criar_empresa', 'Empresas', 'Criar empresa', true, false, true, false, false),
    ('convidar_admin', 'Empresas', 'Convidar o Admin do cliente', true, false, true, false, false),
    ('pausar_empresa', 'Empresas', 'Ativar, suspender, encerrar ou reativar empresa', true, false, false, true, false),
    ('editar_contratacao', 'Contratação', 'Editar contratação', true, false, false, false, false),
    ('editar_precos', 'Contratação', 'Editar preços (entre o mínimo e a tabela)', true, false, false, true, false),
    ('contratar_score', 'Contratação', 'Contratar o Score de Entrega e definir a cobrança', true, false, true, true, false),
    ('ver_faturamento', 'Financeiro', 'Ver faturamento', true, false, true, true, false),
    ('emitir_faturas', 'Financeiro', 'Ajustar e emitir faturas e notas fiscais', true, false, false, true, false),
    ('ver_margem', 'Financeiro', 'Ver margem (MC)', true, false, false, true, false),
    ('responder_chamados', 'Atendimento', 'Responder chamados', true, true, false, false, true),
    ('acessar_mensageria', 'Atendimento', 'Entrar na Mensageria do cliente', true, true, false, false, true),
    ('gerenciar_equipe', 'Equipe', 'Gerenciar a equipe', true, false, false, false, false),
    ('editar_produtos', 'Produtos', 'Criar produtos e definir preço mínimo e de tabela', true, false, false, true, false),
    ('preco_abaixo_minimo', 'Produtos', 'Dar preço abaixo do mínimo (com motivo)', true, false, false, true, false),
    ('gerenciar_fornecedores', 'Produtos', 'Fornecedores, negociações e rotas', true, false, false, true, false),
    ('ver_qualidade', 'Técnico', 'Ver a qualidade dos fornecedores', true, true, false, true, true),
    ('ver_detalhe_tecnico', 'Técnico', 'Ver o detalhe técnico dos envios', true, false, false, false, true),
    ('configurar_score', 'Técnico', 'Configurar o filtro de inteligência e os nomes devolvidos', true, false, false, false, true)
) as c(permissao, grupo, nome, master, atendimento, comercial, administrativo, tecnico);
grant select on public.permissoes_equipe_catalogo to authenticated;

create or replace function public.funcao_da_equipe(papel public.papel, tecnico boolean) returns text
language sql immutable as $$
    select case when papel = 'operacao' and tecnico then 'tecnico' else public.funcao_equipe(papel) end
$$;

create or replace function public.pode_equipe(perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.papel = 'admin' then true
                    else coalesce((select x.permitido from public.permissoes_equipe x
                                    where x.usuario_id = p.id and x.permissao = perm),
                                  (select case public.funcao_da_equipe(p.papel, p.equipe_tecnico)
                                              when 'comercial' then c.comercial when 'administrativo' then c.administrativo
                                              when 'tecnico' then c.tecnico else c.atendimento end
                                     from public.permissoes_equipe_catalogo c where c.permissao = perm), false) end
          from public.perfis p where p.id = auth.uid() and p.ativo and p.equipe), false)
$$;

create or replace function public.listar_equipe()
returns table (id uuid, nome text, email text, funcao text, alcance text, ativo boolean,
               ultimo_login timestamptz, duas_etapas boolean, carteira integer, permissoes jsonb)
language sql stable security definer set search_path = public as $$
    select p.id, p.nome, u.email::text, public.funcao_da_equipe(p.papel, p.equipe_tecnico), p.equipe_alcance, p.ativo,
           u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'),
           (select count(*)::int from public.empresas e where e.vendedor_id = p.id or e.gerente_id = p.id),
           (select jsonb_object_agg(c.permissao, case when p.papel = 'admin' then true
                       else coalesce(x.permitido, case public.funcao_da_equipe(p.papel, p.equipe_tecnico)
                                                      when 'comercial' then c.comercial
                                                      when 'administrativo' then c.administrativo
                                                      when 'tecnico' then c.tecnico else c.atendimento end) end)
              from public.permissoes_equipe_catalogo c
              left join public.permissoes_equipe x on x.usuario_id = p.id and x.permissao = c.permissao)
      from public.perfis p
      join auth.users u on u.id = p.id
     where p.equipe and public.sou_equipe()
     order by (p.papel = 'admin') desc, p.nome
$$;

create or replace function public.definir_funcao_equipe(usuario uuid, funcao text) returns text
language plpgsql security definer set search_path = public as $$
declare
    alvo public.perfis;
begin
    if not (public.admin_equipe() or (public.pode_equipe('gerenciar_equipe') and funcao <> 'master')) then
        raise exception 'sem permissão para mudar a função de alguém da equipe';
    end if;
    if not public.sessao_aal2() then
        raise exception 'entre com o seu código de duas etapas para mudar a equipe';
    end if;
    if funcao not in ('master', 'atendimento', 'comercial', 'administrativo', 'tecnico') then
        raise exception 'função inválida: use master, atendimento, comercial, administrativo ou tecnico';
    end if;
    if usuario = auth.uid() then
        raise exception 'ninguém muda a própria função';
    end if;
    select * into alvo from public.perfis where id = usuario;
    if alvo.id is null then
        raise exception 'usuário não encontrado';
    end if;
    if alvo.equipe and alvo.papel = 'admin' and not public.admin_equipe() then
        raise exception 'só um Master muda outro Master';
    end if;
    if funcao <> 'master' and alvo.equipe and alvo.papel = 'admin'
       and (select count(*) from public.perfis where equipe and papel = 'admin' and ativo and id <> usuario) = 0 then
        raise exception 'a equipe precisa de pelo menos um Master ativo';
    end if;
    update public.perfis
       set equipe = true, empresa_id = null, ativo = true,
           papel = case funcao when 'master' then 'admin' when 'comercial' then 'gestao'
                               when 'administrativo' then 'planejamento' else 'operacao' end::public.papel,
           equipe_tecnico = (funcao = 'tecnico'),
           equipe_alcance = case funcao when 'comercial' then 'carteira' when 'atendimento' then equipe_alcance
                                 else 'todas' end
     where id = usuario;
    delete from public.permissoes_equipe where usuario_id = usuario;       -- nova função, padrão novo
    return funcao;
end $$;
revoke execute on function public.definir_funcao_equipe(uuid, text) from public, anon;
grant execute on function public.definir_funcao_equipe(uuid, text) to authenticated;

create or replace function public.cuida_score() returns boolean
language sql stable security definer set search_path = public as $$
    select public.admin_equipe() or public.pode_equipe('configurar_score')
$$;
revoke all on function public.cuida_score() from public, anon;
grant execute on function public.cuida_score() to authenticated;

-- ================================================================ 2. mensagens
alter table public.mensageria_mensagens
    add column if not exists dlr_em         timestamptz,
    add column if not exists dlr_codigo     text check (dlr_codigo is null or char_length(dlr_codigo) <= 60),
    add column if not exists score_faixa    text check (score_faixa is null or score_faixa in ('alto', 'medio', 'baixo', 'sem')),
    add column if not exists score_prob     numeric(5, 4) check (score_prob is null or score_prob between 0 and 1),
    add column if not exists score_controle boolean not null default false,
    add column if not exists filtro         text check (filtro is null or filtro = 'score');
comment on column public.mensageria_mensagens.dlr_em is 'Quando a DLR (entregue ou não entregue) voltou do fornecedor.';
comment on column public.mensageria_mensagens.dlr_codigo is 'Código original da DLR (ex.: DELIVRD, UNDELIV). Só no detalhe técnico.';
comment on column public.mensageria_mensagens.filtro is
    'score = não enviado pelo filtro de inteligência (o cliente vê o nome de mensageria_score_nomes).';
comment on column public.mensageria_mensagens.score_controle is
    'Enviado de propósito, mesmo fora das faixas da campanha, para medir a entrega real (grupo de controle).';
create index if not exists mensageria_mensagens_score_hist on public.mensageria_mensagens (destino_hash, atualizado_em)
    where situacao in ('entregue', 'falhou');
create index if not exists mensageria_mensagens_qualidade on public.mensageria_mensagens (enviado_em)
    where enviado_em is not null;

-- ================================================================ 3. filtro de inteligência
create table if not exists public.mensageria_score_config (
    id                 bigint generated always as identity primary key,
    plano_id           bigint unique references public.mensageria_planos_rota (id) on delete cascade,
    janela_dias        int not null default 30 check (janela_dias between 7 and 180),
    meia_vida_dias     numeric(5, 1) not null default 10 check (meia_vida_dias between 1 and 90),
    peso_permanente    numeric(4, 1) not null default 2 check (peso_permanente between 1 and 5),
    forca_base         numeric(4, 1) not null default 1 check (forca_base between 0 and 10),
    alto_min           numeric(5, 2) not null default 70 check (alto_min between 1 and 100),
    baixo_max          numeric(5, 2) not null default 20 check (baixo_max between 0 and 99),
    historico_min      numeric(4, 1) not null default 1.5 check (historico_min between 0.5 and 10),
    sem_historico_abaixo numeric(4, 1) not null default 0.5 check (sem_historico_abaixo between 0.1 and 5),
    quarentena_dias    int not null default 20 check (quarentena_dias between 1 and 180),
    controle_pct       numeric(4, 2) not null default 1 check (controle_pct between 0 and 5),
    atualizado_em      timestamptz not null default now(),
    atualizado_por     uuid default auth.uid() references auth.users (id),
    check (baixo_max < alto_min),
    check (quarentena_dias <= janela_dias)      -- depois da janela o número já volta como sem histórico
);
create unique index if not exists mensageria_score_config_padrao on public.mensageria_score_config ((true))
    where plano_id is null;
comment on table public.mensageria_score_config is
    'Filtro de inteligência (Score de Entrega) por rota; a linha sem plano é o padrão das rotas sem configuração.';
insert into public.mensageria_score_config (plano_id)
    select null where not exists (select 1 from public.mensageria_score_config where plano_id is null);

create table if not exists public.mensageria_score_fornecedores (
    fornecedor     text primary key references public.mensageria_fornecedores (codigo) on delete cascade,
    considerar     boolean not null default true,
    atualizado_em  timestamptz not null default now(),
    atualizado_por uuid default auth.uid() references auth.users (id)
);
comment on table public.mensageria_score_fornecedores is
    'DLR de fornecedor com considerar = false não entra no Score (fornecedor sem linha aqui entra).';

create table if not exists public.mensageria_score_nomes (
    faixa          text primary key check (faixa in ('alto', 'medio', 'baixo', 'sem')),
    texto          text not null check (char_length(trim(texto)) between 5 and 80),
    atualizado_em  timestamptz not null default now(),
    atualizado_por uuid default auth.uid() references auth.users (id)
);
comment on table public.mensageria_score_nomes is
    'Nome que o cliente vê quando o número da faixa não é enviado. O código interno continua filtro = score.';
insert into public.mensageria_score_nomes (faixa, texto) values
    ('alto', 'Não enviado · faixa Alto fora da campanha'),
    ('medio', 'Não enviado · faixa Médio fora da campanha'),
    ('baixo', 'Não enviado · baixa propensão de entrega'),
    ('sem', 'Não enviado · número sem histórico')
on conflict (faixa) do nothing;

-- o nome não pode imitar status nem código de operadora
create or replace function public.nome_score_valido(texto text) returns boolean
language sql immutable set search_path = public as $$
    select not (regexp_replace(lower(coalesce(texto, '')), 'não enviado', '', 'g')
                ~ '(^|[^[:alpha:]])(entregue|entregues|delivered|delivrd|undeliv|undelivered|expired|rejectd|dlr|enviado com sucesso|aceito pela operadora|recebido|recebida)([^[:alpha:]]|\Z)')
$$;
create or replace function public.validar_nome_score() returns trigger
language plpgsql set search_path = public as $$
begin
    new.texto := trim(new.texto);
    if not public.nome_score_valido(new.texto) then
        raise exception 'o nome "%" imita status de operadora: escolha outro', new.texto;
    end if;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
    return new;
end $$;
drop trigger if exists validar_nome_score on public.mensageria_score_nomes;
create trigger validar_nome_score before insert or update on public.mensageria_score_nomes
    for each row execute function public.validar_nome_score();

do $$
declare t text;
begin
    foreach t in array array['mensageria_score_config', 'mensageria_score_fornecedores', 'mensageria_score_nomes'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists ver on public.%I', t);
        execute format('create policy ver on public.%I for select to authenticated using (public.sou_equipe())', t);
        execute format('drop policy if exists gravar on public.%I', t);
        execute format('create policy gravar on public.%I for all to authenticated
                        using (public.cuida_score()) with check (public.cuida_score())', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end loop;
end $$;
-- o cliente lê os nomes (é o que aparece no retorno da campanha dele)
drop policy if exists ver on public.mensageria_score_nomes;
create policy ver on public.mensageria_score_nomes for select to authenticated using (true);

-- ================================================================ 4. Score de Entrega
-- configuração que vale para um produto: a da rota do produto, senão a da rota padrão do canal, senão a padrão
create or replace function public.score_config_do_item(item_produto text)
returns public.mensageria_score_config
language sql stable security definer set search_path = public as $$
    select s.* from public.mensageria_score_config s
      left join public.mensageria_planos_rota p on p.id = s.plano_id
     where s.plano_id is null
        or (p.ativo and (p.item = item_produto
                         or (p.item is null and p.padrao and p.canal = public.canal_do_item(item_produto))))
     order by case when p.item = item_produto then 0 when s.plano_id is not null then 1 else 2 end
     limit 1
$$;

create or replace function public.falha_permanente(motivo text) returns boolean
language sql immutable set search_path = public as $$
    select coalesce(lower(motivo) ~ '(inexist|inv[aá]lid|unknown|desconhecid|n[uú]mero errado)', false)
$$;

create or replace function public.score_entrega(hashes text[], item_produto text default 'sms',
                                                ate timestamptz default now())
returns table (destino_hash text, probabilidade numeric, historico numeric, faixa text)
language sql stable security definer set search_path = public as $$
    with cfg as (select * from public.score_config_do_item(item_produto)),
    forn as (
        select f.codigo from public.mensageria_fornecedores f
         where coalesce((select s.considerar from public.mensageria_score_fornecedores s where s.fornecedor = f.codigo), true)
    ),
    hist as (
        select m.destino_hash as h, m.operadora, m.situacao,
               greatest(0, extract(epoch from (ate - coalesce(m.dlr_em, m.atualizado_em, m.enviado_em))) / 86400.0) as idade,
               public.falha_permanente(m.motivo) as permanente
          from public.mensageria_mensagens m, cfg
         where m.destino_hash = any (hashes) and m.situacao in ('entregue', 'falhou')
           and m.fornecedor in (select codigo from forn)
           and coalesce(m.dlr_em, m.atualizado_em, m.enviado_em) <= ate
           and coalesce(m.dlr_em, m.atualizado_em, m.enviado_em) > ate - make_interval(days => cfg.janela_dias)
    ),
    base as (    -- taxa de entrega de cada operadora na janela (base de quem tem pouco histórico)
        select m.operadora, count(*) filter (where m.situacao = 'entregue')::numeric / count(*) as taxa
          from public.mensageria_mensagens m, cfg
         where m.situacao in ('entregue', 'falhou') and m.operadora in (select distinct operadora from hist)
           and m.fornecedor in (select codigo from forn)
           and coalesce(m.dlr_em, m.atualizado_em, m.enviado_em) <= ate
           and coalesce(m.dlr_em, m.atualizado_em, m.enviado_em) > ate - make_interval(days => cfg.janela_dias)
         group by m.operadora having count(*) >= 20
    ),
    pesos as (
        select hist.h, power(0.5, hist.idade / cfg.meia_vida_dias)
                       * case when hist.situacao = 'falhou' and hist.permanente then cfg.peso_permanente else 1 end as w,
               hist.situacao, hist.idade
          from hist, cfg
    ),
    soma as (
        select p.h, sum(p.w) as t, sum(p.w) filter (where p.situacao = 'entregue') as e, min(p.idade) as ultima,
               (select h2.operadora from hist h2 where h2.h = p.h order by h2.idade limit 1) as operadora
          from pesos p group by p.h
    ),
    calc as (
        select x.h, coalesce(s.t, 0) as t, s.ultima,
               (coalesce((select b.taxa from base b where b.operadora = s.operadora), 0.8) * cfg.forca_base + coalesce(s.e, 0))
               / nullif(cfg.forca_base + coalesce(s.t, 0), 0) as p
          from (select distinct unnest(hashes) as h) x
          left join soma s on s.h = x.h, cfg
    )
    select c.h, round(coalesce(c.p, 0.8), 4), round(c.t, 2),
           case when c.t < cfg.sem_historico_abaixo then 'sem'
                when coalesce(c.p, 0.8) * 100 >= cfg.alto_min then 'alto'
                when coalesce(c.p, 0.8) * 100 < cfg.baixo_max and c.t >= cfg.historico_min then
                     case when c.ultima >= cfg.quarentena_dias then 'sem' else 'baixo' end
                else 'medio' end
      from calc c, cfg
$$;
comment on function public.score_entrega(text[], text, timestamptz) is
    'Probabilidade de entrega e faixa de cada número (hash), pelo histórico de toda a Mensageria. Usado pelo motor.';
revoke all on function public.score_entrega(text[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.score_entrega(text[], text, timestamptz) to service_role;

-- ================================================================ 5. contratação e campanha
insert into public.cobranca_itens (codigo, produto, nome, unidade, modulo, ordem, descricao) values
    ('score_analisado', 'score', 'Score de Entrega · por número analisado', 'número', 'mensageria', 60,
     'toda a lista passa pelo Score'),
    ('score_represado', 'score', 'Score de Entrega · por número represado', 'número', 'mensageria', 61,
     'cobra só os números que o filtro segurou')
on conflict (codigo) do nothing;

create or replace function public.salvar_preco_score(item text, preco_minimo numeric, preco_tabela numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.cuida_produtos() then
        raise exception 'sem permissão para definir o preço do Score';
    end if;
    if item not in ('score_analisado', 'score_represado') then
        raise exception 'item do Score inválido';
    end if;
    if coalesce(preco_minimo, 0) <= 0 or coalesce(preco_tabela, 0) < preco_minimo then
        raise exception 'informe o mínimo (maior que zero) e a tabela (maior ou igual ao mínimo)';
    end if;
    update public.cobranca_itens c set preco_minimo = salvar_preco_score.preco_minimo,
                                       preco_tabela = salvar_preco_score.preco_tabela
     where c.codigo = salvar_preco_score.item;
end $$;
revoke all on function public.salvar_preco_score(text, numeric, numeric) from public, anon;
grant execute on function public.salvar_preco_score(text, numeric, numeric) to authenticated;

create table if not exists public.empresa_score (
    empresa_id     bigint primary key references public.empresas (id) on delete cascade,
    ativo          boolean not null default true,
    cobranca       text not null check (cobranca in ('analisado', 'represado')),
    atualizado_em  timestamptz not null default now(),
    atualizado_por uuid default auth.uid() references auth.users (id)
);
comment on table public.empresa_score is
    'Score de Entrega contratado: cobrança por número analisado (toda a lista) ou só pelos represados.';
alter table public.empresa_score enable row level security;
drop policy if exists ver on public.empresa_score;
create policy ver on public.empresa_score for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists gravar on public.empresa_score;
create policy gravar on public.empresa_score for all to authenticated
    using (public.admin_equipe() or public.equipe_pode('contratar_score', empresa_id))
    with check (public.admin_equipe() or public.equipe_pode('contratar_score', empresa_id));
revoke all on public.empresa_score from anon;
grant select, insert, update, delete on public.empresa_score to authenticated;

alter table public.mensageria_campanhas add column if not exists score_faixas text[]
    check (score_faixas is null or (cardinality(score_faixas) between 1 and 4
                                    and score_faixas <@ array['alto', 'medio', 'baixo', 'sem']));
comment on column public.mensageria_campanhas.score_faixas is
    'Faixas do Score que recebem a campanha (vazio = Score desligado). Só com o Score contratado.';

create or replace function public.validar_score_campanha() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.score_faixas is not null and not exists (
        select 1 from public.empresa_score s where s.empresa_id = new.empresa_id and s.ativo) then
        raise exception 'o Score de Entrega não está contratado para esta empresa';
    end if;
    return new;
end $$;
drop trigger if exists validar_score_campanha on public.mensageria_campanhas;
create trigger validar_score_campanha before insert or update of score_faixas on public.mensageria_campanhas
    for each row execute function public.validar_score_campanha();

-- ================================================================ 6. leituras
create table if not exists public.mensageria_alertas_config (
    id             smallint primary key default 1 check (id = 1),
    sem_dlr_minutos int not null default 30 check (sem_dlr_minutos between 5 and 1440),
    sem_dlr_pct    numeric(5, 2) not null default 5 check (sem_dlr_pct between 0.5 and 100),
    dlr_p90_seg    int not null default 300 check (dlr_p90_seg between 10 and 86400),
    janela_min     int not null default 60 check (janela_min between 10 and 1440),
    atualizado_em  timestamptz not null default now(),
    atualizado_por uuid default auth.uid() references auth.users (id)
);
insert into public.mensageria_alertas_config (id) values (1) on conflict (id) do nothing;
alter table public.mensageria_alertas_config enable row level security;
drop policy if exists ver on public.mensageria_alertas_config;
create policy ver on public.mensageria_alertas_config for select to authenticated using (public.sou_equipe());
drop policy if exists gravar on public.mensageria_alertas_config;
create policy gravar on public.mensageria_alertas_config for update to authenticated
    using (public.cuida_score()) with check (public.cuida_score());
revoke all on public.mensageria_alertas_config from anon;
grant select, update on public.mensageria_alertas_config to authenticated;

create or replace function public.pode_ver_qualidade() returns boolean
language sql stable security definer set search_path = public as $$
    select public.admin_equipe() or public.pode_equipe('ver_qualidade')
$$;

create or replace function public.qualidade_fornecedores(de timestamptz, ate timestamptz, canal_lote text default 'sms')
returns table (fornecedor text, operadora text, disparadas bigint, aceite_med numeric, aceite_p90 numeric,
               dlr_med numeric, dlr_p90 numeric, sem_dlr_pct numeric, entregue_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare lim int := (select sem_dlr_minutos from public.mensageria_alertas_config where id = 1);
begin
    if not public.pode_ver_qualidade() then
        raise exception 'sem permissão para ver a qualidade dos fornecedores';
    end if;
    return query
    select m.fornecedor, coalesce(m.operadora, 'outras'), count(*),
           round(percentile_cont(0.5) within group (order by extract(epoch from m.confirmada_em - m.enviado_em))::numeric, 1),
           round(percentile_cont(0.9) within group (order by extract(epoch from m.confirmada_em - m.enviado_em))::numeric, 1),
           round(percentile_cont(0.5) within group (order by extract(epoch from m.dlr_em - m.enviado_em))::numeric, 0),
           round(percentile_cont(0.9) within group (order by extract(epoch from m.dlr_em - m.enviado_em))::numeric, 0),
           round(100.0 * count(*) filter (where m.situacao = 'enviada' and m.dlr_em is null
                                            and m.enviado_em < now() - make_interval(mins => lim)) / count(*), 2),
           round(100.0 * count(*) filter (where m.situacao = 'entregue')
                 / nullif(count(*) filter (where m.situacao in ('entregue', 'falhou')), 0), 2)
      from public.mensageria_mensagens m
      join public.mensageria_lotes l on l.id = m.lote_id and l.canal = canal_lote and l.modo = 'real'
     where m.enviado_em >= de and m.enviado_em < ate and m.fornecedor is not null
     group by m.fornecedor, coalesce(m.operadora, 'outras')
     order by 1, 2;
end $$;

create or replace function public.qualidade_por_hora(de timestamptz, ate timestamptz, canal_lote text default 'sms')
returns table (hora timestamptz, fornecedor text, dlr_med numeric, disparadas bigint)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.pode_ver_qualidade() then
        raise exception 'sem permissão para ver a qualidade dos fornecedores';
    end if;
    return query
    select date_trunc('hour', m.enviado_em), m.fornecedor,
           round(percentile_cont(0.5) within group (order by extract(epoch from m.dlr_em - m.enviado_em))::numeric, 0),
           count(*)
      from public.mensageria_mensagens m
      join public.mensageria_lotes l on l.id = m.lote_id and l.canal = canal_lote and l.modo = 'real'
     where m.enviado_em >= de and m.enviado_em < ate and m.fornecedor is not null
     group by 1, 2 order by 1, 2;
end $$;

create or replace function public.alertas_qualidade(canal_lote text default 'sms')
returns table (fornecedor text, operadora text, nivel text, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare c public.mensageria_alertas_config;
begin
    select * into c from public.mensageria_alertas_config where id = 1;
    return query
    select q.fornecedor, q.operadora,
           case when q.sem_dlr_pct >= c.sem_dlr_pct * 2 or q.dlr_p90 >= c.dlr_p90_seg * 2 then 'critico' else 'atencao' end,
           case when q.sem_dlr_pct >= c.sem_dlr_pct
                then q.sem_dlr_pct || '% sem DLR após ' || c.sem_dlr_minutos || ' min (limite ' || c.sem_dlr_pct || '%)'
                else 'DLR p90 em ' || q.dlr_p90 || ' s (limite ' || c.dlr_p90_seg || ' s)' end
      from public.qualidade_fornecedores(now() - make_interval(mins => c.janela_min), now(), canal_lote) q
     where q.disparadas >= 50 and (q.sem_dlr_pct >= c.sem_dlr_pct or q.dlr_p90 >= c.dlr_p90_seg);
end $$;

create or replace function public.detalhe_tecnico_envios(de timestamptz, ate timestamptz, forn text default null,
                                                         limite int default 200)
returns table (id bigint, empresa_id bigint, destino_mascara text, fornecedor text, operadora text, situacao text,
               dlr_codigo text, enviado_em timestamptz, confirmada_em timestamptz, dlr_em timestamptz,
               fallback text, score_faixa text, score_controle boolean)
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.admin_equipe() or public.pode_equipe('ver_detalhe_tecnico')) then
        raise exception 'sem permissão para ver o detalhe técnico';
    end if;
    return query
    select m.id, m.empresa_id, m.destino_mascara, m.fornecedor, m.operadora, m.situacao, m.dlr_codigo, m.enviado_em,
           m.confirmada_em, m.dlr_em, m.fallback, m.score_faixa, m.score_controle
      from public.mensageria_mensagens m
     where m.enviado_em >= de and m.enviado_em < ate and (forn is null or m.fornecedor = forn)
     order by m.enviado_em desc
     limit least(greatest(coalesce(limite, 200), 1), 2000);
end $$;

-- entrega real do grupo de controle por faixa (prova do Score); cliente vê a dele, equipe vê todas
create or replace function public.controle_score(empresa bigint, de date, ate date)
returns table (faixa text, enviados bigint, entregues bigint, taxa numeric)
language plpgsql stable security definer set search_path = public as $$
begin
    if empresa is not null and not public.pode_ver_empresa(empresa) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if empresa is null and not public.sou_equipe() then
        raise exception 'informe a empresa';
    end if;
    return query
    select m.score_faixa, count(*), count(*) filter (where m.situacao = 'entregue'),
           round(100.0 * count(*) filter (where m.situacao = 'entregue')
                 / nullif(count(*) filter (where m.situacao in ('entregue', 'falhou')), 0), 1)
      from public.mensageria_mensagens m
     where m.score_controle and (empresa is null or m.empresa_id = empresa)
       and m.enviado_em >= de and m.enviado_em < ate + 1
     group by m.score_faixa order by 1;
end $$;

-- preço unitário de um item para a empresa num mês (pela régua de preço contratada)
create or replace function public.preco_unitario(empresa bigint, it text, qtd numeric, competencia date)
returns numeric
language sql stable security definer set search_path = public as $$
    select case when qtd > 0 then (select v.valor from public.valor_item(empresa, it, qtd, competencia) v) / qtd end
$$;

-- Economia do Score por campanha, com valores faturados: sem o Score (lista analisada × SMS) e com o Score
-- (enviados × SMS + Score pela forma contratada). custo unitário efetivo = com ÷ lista analisada.
create or replace function public.economia_score(empresa bigint, de date, ate date)
returns table (campanha_id bigint, nome text, dia date, analisados bigint, represados bigint, enviados bigint,
               preco_sms numeric, total_sem numeric, total_com numeric, economia numeric, custo_unitario numeric)
language plpgsql stable security definer set search_path = public as $$
declare cobr text := (select s.cobranca from public.empresa_score s where s.empresa_id = economia_score.empresa);
begin
    if not public.pode_ver_empresa(empresa) then
        raise exception 'empresa fora do seu acesso';
    end if;
    return query
    with base as (
        select c.id, c.nome, l.data::date as dia, coalesce(c.produto, l.canal) as item,
               count(*) filter (where m.score_faixa is not null) as analisados,
               count(*) filter (where m.filtro = 'score') as represados
          from public.mensageria_campanhas c
          join public.mensageria_lotes l on l.campanha_id = c.id
          join public.mensageria_mensagens m on m.lote_id = l.id
         where c.empresa_id = economia_score.empresa and c.score_faixas is not null
           and l.data between de and ate
         group by c.id, c.nome, l.data, coalesce(c.produto, l.canal)
    ), precos as (
        select b.*, coalesce(public.preco_unitario(economia_score.empresa, b.item, b.analisados,
                                                   date_trunc('month', b.dia)::date), 0) as sms,
               coalesce(public.preco_unitario(economia_score.empresa,
                                              case cobr when 'represado' then 'score_represado' else 'score_analisado' end,
                                              case cobr when 'represado' then b.represados else b.analisados end,
                                              date_trunc('month', b.dia)::date), 0) as score
          from base b where b.analisados > 0
    )
    select p.id, p.nome, p.dia, p.analisados, p.represados, p.analisados - p.represados, round(p.sms, 4),
           round(p.analisados * p.sms, 2),
           round((p.analisados - p.represados) * p.sms
                 + p.score * case cobr when 'represado' then p.represados else p.analisados end, 2),
           round(p.analisados * p.sms - ((p.analisados - p.represados) * p.sms
                 + p.score * case cobr when 'represado' then p.represados else p.analisados end), 2),
           round(((p.analisados - p.represados) * p.sms
                 + p.score * case cobr when 'represado' then p.represados else p.analisados end) / p.analisados, 4)
      from precos p order by p.dia desc, p.id desc;
end $$;

-- Vitrine da Economia do Score (cliente sem o Score): só dados reais do período. SMS enviados, quantos não
-- chegaram (DLR de falha) e quanto a empresa pagou por eles, pelo preço do contrato no mês. Sem simulação.
create or replace function public.vitrine_score(empresa bigint, de date, ate date)
returns table (enviados bigint, nao_entregues bigint, valor_nao_entregues numeric, preco_medio numeric)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.pode_ver_empresa(empresa) then
        raise exception 'empresa fora do seu acesso';
    end if;
    return query
    with base as (
        select coalesce(c.produto, l.canal) as item, date_trunc('month', m.enviado_em)::date as mes,
               count(*) as env, count(*) filter (where m.situacao = 'falhou') as falhas
          from public.mensageria_mensagens m
          join public.mensageria_lotes l on l.id = m.lote_id
          left join public.mensageria_campanhas c on c.id = l.campanha_id
         where m.empresa_id = vitrine_score.empresa and l.canal = 'sms' and m.enviado_em is not null
           and m.enviado_em >= de and m.enviado_em < ate + 1
         group by 1, 2
    ), valores as (
        select b.env, b.falhas,
               b.falhas * coalesce(public.preco_unitario(vitrine_score.empresa, b.item, b.env, b.mes), 0) as valor
          from base b
    )
    select coalesce(sum(v.env), 0)::bigint, coalesce(sum(v.falhas), 0)::bigint, round(coalesce(sum(v.valor), 0), 2),
           round(sum(v.valor) / nullif(sum(v.falhas), 0), 4)
      from valores v;
end $$;

do $$
declare f text;
begin
    foreach f in array array['public.pode_ver_qualidade()',
                             'public.qualidade_fornecedores(timestamptz, timestamptz, text)',
                             'public.qualidade_por_hora(timestamptz, timestamptz, text)',
                             'public.alertas_qualidade(text)',
                             'public.detalhe_tecnico_envios(timestamptz, timestamptz, text, int)',
                             'public.controle_score(bigint, date, date)',
                             'public.preco_unitario(bigint, text, numeric, date)',
                             'public.economia_score(bigint, date, date)',
                             'public.vitrine_score(bigint, date, date)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;

-- ================================================================ auditoria das tabelas novas
do $$
declare t text;
begin
    foreach t in array array['mensageria_score_config', 'mensageria_score_fornecedores', 'mensageria_score_nomes',
                             'empresa_score', 'mensageria_alertas_config'] loop
        execute format('drop trigger if exists auditar on public.%I', t);
        execute format('create trigger auditar after insert or update or delete on public.%I
                        for each row execute function public.auditar()', t);
    end loop;
end $$;

-- ================================================================ glossário "O que significa" (termos do bloco 6)
insert into public.glossario (slug, grupo, termo, definicao, exemplo, antes, ordem) values
    ('lista-da-campanha', 'Mensageria', 'Lista da campanha',
     'Arquivo (ou envio por API) com os contatos de uma campanha da Mensageria. Na Cobrança e na Jornada o nome é carga.',
     '18.420 números na lista; 16.210 enviados depois do Score.', 'Mailing', 414),
    ('score-de-entrega', 'Mensageria', 'Score de Entrega',
     'Probabilidade de cada número receber a mensagem, calculada pelo histórico da Mensageria. Separa os números em Alto, Médio, Baixo e Sem histórico; a campanha escolhe quais faixas recebem.',
     'Baixo = número que só teve "não entregue" nos últimos dias.', 'Filtro de inteligência', 415),
    ('sem-historico', 'Mensageria', 'Sem histórico',
     'Número que ainda não passou pela Mensageria (ou não passa há muito tempo): o Score não tem como classificar.', '', 'Neutro', 416),
    ('grupo-de-controle', 'Mensageria', 'Grupo de controle',
     'Pequena amostra sorteada dos números fora das faixas da campanha que sai mesmo assim, para medir a entrega real de cada faixa. É cobrada como SMS normal.',
     '1% dos números de score Baixo.', '', 417),
    ('custo-unitario-efetivo', 'Financeiro', 'Custo unitário efetivo',
     'Total pago na campanha com o Score dividido pelo lista carregada. Mostra quanto custou, de fato, cada número da lista.',
     'R$ 1.002,07 ÷ 18.420 números = R$ 0,0544 por número.', '', 418),
    ('economia-do-score', 'Financeiro', 'Economia do Score',
     'Quanto a campanha deixou de gastar em SMS para números de baixa entrega, já descontado o que foi pago pelo Score.', '', '', 419)
on conflict (slug) do nothing;

-- ================================================================ prévia do Score antes de agendar (plataforma)
-- Campanha pela plataforma com o Score contratado: ao confirmar as colunas ela vai para 'calculando_previa'; o
-- motor classifica a lista (mesmos números que vão sair) e grava score_previa (quantos por faixa e os preços);
-- só então fica 'pronta' e o cliente escolhe as faixas, vê o custo unitário efetivo e agenda. Campanha pela API
-- segue direto: o Score é aplicado no envio e o resultado aparece depois, em Economia do Score.
alter table public.mensageria_campanhas drop constraint if exists mensageria_campanhas_situacao_check;
alter table public.mensageria_campanhas add constraint mensageria_campanhas_situacao_check
    check (situacao in ('analisando', 'aguardando_layout', 'calculando_previa', 'pronta', 'agendada', 'em_andamento',
                        'concluida', 'cancelada', 'erro'));
alter table public.mensageria_campanhas add column if not exists score_previa jsonb
    check (score_previa is null or jsonb_typeof(score_previa) = 'object');
comment on column public.mensageria_campanhas.score_previa is
    'Prévia do Score: {"faixas": {"alto": n, "medio": n, "baixo": n, "sem": n}, "analisados": n, "preco_sms": x, '
    '"preco_score": y, "cobranca": "analisado"|"represado", "calculado_em": "..."}';

create or replace function public.confirmar_layout(campanha bigint, layout jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
    c public.mensageria_campanhas;
    faltam text;
    proxima text;
begin
    select * into c from public.mensageria_campanhas where id = campanha;
    if c.id is null or c.empresa_id not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'campanha não encontrada';
    end if;
    if c.situacao not in ('aguardando_layout', 'pronta') then
        raise exception 'o layout só é confirmado antes do envio';
    end if;
    if c.canal = 'email' and coalesce(layout ->> 'email', '') = '' then
        raise exception 'escolha a coluna do e-mail';
    end if;
    if c.canal <> 'email' and coalesce(layout ->> 'telefone', '') = '' then
        raise exception 'escolha a coluna do telefone';
    end if;
    select string_agg(v, ', ') into faltam
      from unnest((select t.variaveis from public.mensageria_templates t where t.id = c.template_id)) v
     where coalesce(layout -> 'variaveis' ->> v, '') = '';
    if faltam is not null then
        raise exception 'o template usa variáveis sem coluna: %', faltam;
    end if;
    proxima := case when c.origem = 'arquivo' and exists (select 1 from public.empresa_score s
                                                          where s.empresa_id = c.empresa_id and s.ativo)
                    then 'calculando_previa' else 'pronta' end;
    update public.mensageria_campanhas
       set layout = confirmar_layout.layout, situacao = proxima, score_previa = null
     where id = campanha;
    return proxima;
end $$;
revoke execute on function public.confirmar_layout(bigint, jsonb) from public, anon;
grant execute on function public.confirmar_layout(bigint, jsonb) to authenticated;

drop function if exists public.agendar_campanha(bigint, timestamptz);
create or replace function public.agendar_campanha(campanha bigint, quando timestamptz default null,
                                                   faixas text[] default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.mensageria_campanhas;
begin
    select * into c from public.mensageria_campanhas where id = campanha;
    if c.id is null or c.empresa_id not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'campanha não encontrada';
    end if;
    if c.situacao = 'calculando_previa' then
        raise exception 'aguarde a prévia do Score de Entrega (leva alguns minutos)';
    end if;
    if c.situacao <> 'pronta' then
        raise exception 'confirme o layout antes de agendar';
    end if;
    if c.template_id is null then
        raise exception 'escolha o template';
    end if;
    if faixas is not null and cardinality(faixas) = 0 then
        raise exception 'marque pelo menos uma faixa do Score para enviar';
    end if;
    update public.mensageria_campanhas
       set situacao = 'agendada', agendada_para = coalesce(quando, now()), score_faixas = faixas
     where id = campanha;
    return 'agendada';
end $$;
revoke execute on function public.agendar_campanha(bigint, timestamptz, text[]) from public, anon;
grant execute on function public.agendar_campanha(bigint, timestamptz, text[]) to authenticated;
