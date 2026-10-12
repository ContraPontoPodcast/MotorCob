-- Mensageria por produto (SMS, RCS, E-mail, WhatsApp): campanhas com lista própria, templates, centro de custo,
-- listas de bloqueio e de favoritos, fallback do RCS e funil.
-- * Campanha: o cliente sobe uma lista em QUALQUER layout (CSV, TXT ou XLSX); o motor identifica as colunas
--   (telefone, e-mail, ID, variáveis) e o cliente confirma o layout antes do envio. Também nasce da Lista do dia.
--   O arquivo fica no bucket entradas/<empresa>/mensageria/ e é apagado em 90 dias; no banco só ficam nomes de
--   colunas, contadores e, por mensagem, o destino mascarado e o hash (nunca o telefone, o e-mail ou as variáveis).
-- * Higienização: telefone celular válido (DDD + 9 dígitos), e-mail válido, repetidos, lista de bloqueio,
--   descadastro e consulta de operadora. Favoritos passam direto pela validação de formato e de operadora
--   (descadastro e bloqueio sempre valem).
-- * Template de SMS (até 160 caracteres depois de preencher as variáveis) e de RCS com categoria (autenticação,
--   transacional, marketing) e tipo de mídia (simples, botões, arquivo, rich card, carrossel). Variáveis {{nome}}.
-- * Centro de custo: orçamento do mês e o que fazer quando estourar (bloquear ou continuar); o motor pausa o
--   lote sem saldo quando for bloquear.
-- * RCS sem disponibilidade no aparelho: fallback por SMS ou WhatsApp, configurável na empresa e na campanha.
-- * Funil por dia, canal e campanha: carregados, inválidos, bloqueados, enviados, entregues, não entregues, fallback.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- centros de custo
create table if not exists public.mensageria_centros_custo (
    id                bigint generated always as identity primary key,
    empresa_id        bigint not null references public.empresas (id) on delete cascade,
    nome              text not null check (length(trim(nome)) between 2 and 60),
    orcamento_mensal  numeric(14, 2) check (orcamento_mensal is null or orcamento_mensal >= 0),
    ao_estourar       text not null default 'bloquear' check (ao_estourar in ('bloquear', 'continuar')),
    alerta_pct        int not null default 80 check (alerta_pct between 1 and 100),
    ativo             boolean not null default true,
    criado_em         timestamptz not null default now(),
    unique (empresa_id, nome)
);
comment on column public.mensageria_centros_custo.orcamento_mensal is 'Orçamento do mês em R$ (vazio = sem limite).';

create table if not exists public.mensageria_consumo_centro (
    centro_id     bigint not null references public.mensageria_centros_custo (id) on delete cascade,
    competencia   date not null check (extract(day from competencia) = 1),
    item          text not null,
    quantidade    bigint not null default 0 check (quantidade >= 0),
    atualizado_em timestamptz not null default now(),
    primary key (centro_id, competencia, item)
);

-- gasto estimado do mês pelo preço vigente de cada item (preço médio da faixa do volume do mês)
create or replace function public.orcamento_centro_motor(centro bigint, competencia date default current_date)
returns table (orcamento numeric, gasto numeric, restante numeric, ao_estourar text, alerta boolean,
               preco_sms numeric, preco_rcs numeric, preco_email numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    c public.mensageria_centros_custo;
    comp date := date_trunc('month', competencia)::date;
    g numeric := 0;
    r record;
    v record;
    unit numeric;
    ps numeric; pr numeric; pe numeric;
begin
    select * into c from public.mensageria_centros_custo where id = centro;
    if c.id is null then
        raise exception 'centro de custo não encontrado';
    end if;
    for r in select coalesce(ci.preco_de, cc.item) as base, sum(cc.quantidade) as qtd
               from public.mensageria_consumo_centro cc
               left join public.cobranca_itens ci on ci.codigo = cc.item
              where cc.centro_id = centro and cc.competencia = comp
              group by 1 loop
        select * into v from public.valor_item(c.empresa_id, r.base, r.qtd, comp);
        g := g + coalesce(v.valor, 0);
    end loop;
    select x.preco_medio into ps from public.valor_item(c.empresa_id, 'sms', greatest(1, (select coalesce(sum(k.quantidade), 0)
        from public.mensageria_consumo_centro k where k.centro_id = centro and k.competencia = comp
         and k.item in ('sms', 'sms_resposta'))), comp) x;
    select x.preco_medio into pr from public.valor_item(c.empresa_id, 'rcs_basic', 1, comp) x;
    select x.preco_medio into pe from public.valor_item(c.empresa_id, 'email', 1, comp) x;
    return query select c.orcamento_mensal, round(g, 2),
        case when c.orcamento_mensal is null then null else round(c.orcamento_mensal - g, 2) end,
        c.ao_estourar,
        c.orcamento_mensal is not null and c.orcamento_mensal > 0 and g >= c.orcamento_mensal * c.alerta_pct / 100,
        ps, pr, pe;
end $$;
revoke execute on function public.orcamento_centro_motor(bigint, date) from public, anon, authenticated;
grant execute on function public.orcamento_centro_motor(bigint, date) to service_role;

-- o mesmo para o site: só de centro da própria empresa (ou equipe)
create or replace function public.orcamento_centro(centro bigint, competencia date default current_date)
returns table (orcamento numeric, gasto numeric, restante numeric, ao_estourar text, alerta boolean,
               preco_sms numeric, preco_rcs numeric, preco_email numeric)
language plpgsql stable security definer set search_path = public as $$
begin
    if not exists (select 1 from public.mensageria_centros_custo c where c.id = centro
                   and (public.sou_equipe() or c.empresa_id in (select public.minhas_empresas()))) then
        raise exception 'centro de custo não encontrado';
    end if;
    return query select * from public.orcamento_centro_motor(centro, competencia);
end $$;
revoke execute on function public.orcamento_centro(bigint, date) from public, anon;
grant execute on function public.orcamento_centro(bigint, date) to authenticated;

-- ---------------------------------------------------------------- templates (SMS e RCS)
create table if not exists public.mensageria_templates (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    canal           text not null check (canal in ('sms', 'rcs')),
    nome            text not null check (length(trim(nome)) between 2 and 60),
    categoria       text check (categoria in ('autenticacao', 'transacional', 'marketing')),
    tipo_midia      text not null default 'simples'
                    check (tipo_midia in ('simples', 'botoes', 'arquivo', 'rich_card', 'carrossel')),
    conteudo        jsonb not null,
    variaveis       text[] not null default '{}',
    rastrear_links  boolean not null default false,
    situacao        text not null default 'ativo' check (situacao in ('rascunho', 'ativo', 'arquivado')),
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    unique (empresa_id, canal, nome),
    check (canal = 'rcs' or (tipo_midia = 'simples' and categoria is null)),
    check (canal = 'sms' or categoria is not null)
);
comment on column public.mensageria_templates.conteudo is
    'simples {texto} · botoes {texto, botoes[{tipo url|resposta|ligar, rotulo, valor}]} · arquivo {texto, arquivo{caminho, nome}} '
    '· rich_card {card{titulo, descricao, midia, botoes[]}} · carrossel {cards[2..10]}. Variáveis: {{nome}}.';

create or replace function public.validar_template() returns trigger
language plpgsql set search_path = public as $$
declare
    c jsonb := new.conteudo;
    txt text;
    b jsonb;
    card jsonb;
    cards jsonb;
begin
    if jsonb_typeof(c) <> 'object' then
        raise exception 'conteúdo do template inválido';
    end if;
    if new.tipo_midia in ('simples', 'botoes') and coalesce(length(trim(c ->> 'texto')), 0) = 0 then
        raise exception 'o template precisa de texto';
    end if;
    if new.canal = 'sms' and length(regexp_replace(c ->> 'texto', '\{\{\s*[a-z0-9_]+\s*\}\}', '', 'gi')) > 160 then
        raise exception 'SMS passa de 160 caracteres mesmo sem as variáveis';
    end if;
    if new.tipo_midia = 'botoes' then
        if jsonb_typeof(c -> 'botoes') <> 'array' or jsonb_array_length(c -> 'botoes') not between 1 and 4 then
            raise exception 'de 1 a 4 botões';
        end if;
    end if;
    if new.tipo_midia = 'arquivo' and coalesce(c -> 'arquivo' ->> 'caminho', '') = '' then
        raise exception 'escolha o arquivo do template';
    end if;
    if new.tipo_midia = 'rich_card' and coalesce(c -> 'card' ->> 'titulo', '') = '' then
        raise exception 'o rich card precisa de título';
    end if;
    if new.tipo_midia = 'carrossel' then
        cards := c -> 'cards';
        if jsonb_typeof(cards) <> 'array' or jsonb_array_length(cards) not between 2 and 10 then
            raise exception 'o carrossel tem de 2 a 10 cards';
        end if;
        for card in select * from jsonb_array_elements(cards) loop
            if coalesce(card ->> 'titulo', '') = '' then
                raise exception 'todo card do carrossel precisa de título';
            end if;
        end loop;
    end if;
    -- botões: tipo e rótulo (até 25 caracteres)
    for b in select x from jsonb_path_query(c, 'strict $.**.botoes[*]') x loop
        if coalesce(b ->> 'tipo', '') not in ('url', 'resposta', 'ligar') or length(coalesce(b ->> 'rotulo', '')) not between 1 and 25 then
            raise exception 'botão inválido: tipo url, resposta ou ligar e rótulo de 1 a 25 caracteres';
        end if;
    end loop;
    -- variáveis usadas em qualquer texto do template
    txt := c::text;
    new.variaveis := coalesce((select array_agg(distinct lower(m[1]) order by lower(m[1]))
                                 from regexp_matches(txt, '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}', 'g') m), '{}');
    new.atualizado_em := now();
    return new;
end $$;
drop trigger if exists validar_template on public.mensageria_templates;
create trigger validar_template before insert or update on public.mensageria_templates
    for each row execute function public.validar_template();

-- ---------------------------------------------------------------- listas de bloqueio e de favoritos
create table if not exists public.mensageria_listas_contato (
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    tipo             text not null check (tipo in ('bloqueio', 'favorito')),
    canal            text not null default 'todos' check (canal in ('todos', 'sms', 'email', 'rcs', 'whatsapp')),
    destino_hash     text not null check (destino_hash ~ '^[0-9a-f]{64}$'),
    destino_mascara  text check (char_length(destino_mascara) <= 80),
    motivo           text check (motivo is null or length(motivo) <= 120),
    criado_em        timestamptz not null default now(),
    criado_por       uuid default auth.uid() references auth.users (id),
    primary key (empresa_id, tipo, canal, destino_hash)
);
comment on table public.mensageria_listas_contato is
    'Bloqueio (suspeitos: nunca recebem) e favoritos (passam direto pela validação de formato e operadora). Só hash e máscara.';

create or replace function public.mascara_destino(canal text, destino text) returns text
language sql immutable set search_path = public as $$
    select case when canal = 'email' or position('@' in destino) > 0
                then left(split_part(lower(trim(destino)), '@', 1), 2) || '••@' || split_part(lower(trim(destino)), '@', 2)
                else '(' || substr(regexp_replace(regexp_replace(destino, '\D', '', 'g'), '^55(\d{10,11})$', '\1'), 1, 2)
                     || ') ••••-••' || right(regexp_replace(destino, '\D', '', 'g'), 2) end
$$;

-- o site manda os destinos digitados ou colados; o banco guarda só hash e máscara. Devolve quantos entraram.
create or replace function public.adicionar_lista_contato(empresa bigint, tipo text, canal text, destinos text[],
                                                          motivo text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
    d text;
    n int := 0;
    canal_hash text;
begin
    if not (empresa in (select public.minhas_empresas()) and public.pode('editar_canais')) then
        raise exception 'sem permissão para alterar as listas';
    end if;
    if tipo not in ('bloqueio', 'favorito') or canal not in ('todos', 'sms', 'email', 'rcs', 'whatsapp') then
        raise exception 'lista ou canal inválido';
    end if;
    if coalesce(array_length(destinos, 1), 0) > 50000 then
        raise exception 'até 50.000 contatos por vez';
    end if;
    foreach d in array destinos loop
        d := trim(d);
        continue when d = '';
        canal_hash := case when position('@' in d) > 0 then 'email' else 'sms' end;
        if canal_hash = 'email' and d !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then continue; end if;
        if canal_hash = 'sms' and regexp_replace(regexp_replace(d, '\D', '', 'g'), '^55(\d{10,11})$', '\1') !~ '^\d{10,11}$' then
            continue;
        end if;
        insert into public.mensageria_listas_contato (empresa_id, tipo, canal, destino_hash, destino_mascara, motivo)
        values (empresa, tipo, canal, public.hash_destino(canal_hash, d), public.mascara_destino(canal_hash, d),
                left(motivo, 120))
        on conflict do nothing;
        if found then n := n + 1; end if;
    end loop;
    return n;
end $$;
revoke execute on function public.adicionar_lista_contato(bigint, text, text, text[], text) from public, anon;
grant execute on function public.adicionar_lista_contato(bigint, text, text, text[], text) to authenticated;

create or replace function public.remover_lista_contato(empresa bigint, tipo text, canal text, destino_hash text)
returns void
language plpgsql security definer set search_path = public as $$
begin
    if not (empresa in (select public.minhas_empresas()) and public.pode('editar_canais')) then
        raise exception 'sem permissão para alterar as listas';
    end if;
    delete from public.mensageria_listas_contato l
     where l.empresa_id = empresa and l.tipo = remover_lista_contato.tipo and l.canal = remover_lista_contato.canal
       and l.destino_hash = remover_lista_contato.destino_hash;
end $$;
revoke execute on function public.remover_lista_contato(bigint, text, text, text) from public, anon;
grant execute on function public.remover_lista_contato(bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------- campanhas
create table if not exists public.mensageria_campanhas (
    id                    bigint generated always as identity primary key,
    empresa_id            bigint not null references public.empresas (id) on delete cascade,
    canal                 text not null check (canal in ('sms', 'email', 'rcs', 'whatsapp')),
    nome                  text not null check (length(trim(nome)) between 2 and 80),
    origem                text not null default 'arquivo' check (origem in ('arquivo', 'api')),
    template_id           bigint references public.mensageria_templates (id),
    centro_custo_id       bigint references public.mensageria_centros_custo (id),
    arquivo_caminho       text check (arquivo_caminho is null or arquivo_caminho ~ '^[a-z0-9-]+/mensageria/'),
    arquivo_nome          text check (char_length(arquivo_nome) <= 200),
    layout_sugerido       jsonb,
    layout                jsonb,
    situacao              text not null default 'analisando'
                          check (situacao in ('analisando', 'aguardando_layout', 'pronta', 'agendada', 'em_andamento',
                                              'concluida', 'cancelada', 'erro')),
    agendada_para         timestamptz,
    rastrear_links        boolean not null default false,
    fallback              text not null default 'empresa' check (fallback in ('empresa', 'nenhum', 'sms', 'whatsapp')),
    fallback_template_id  bigint references public.mensageria_templates (id),
    carregados            int not null default 0,
    invalidos             int not null default 0,
    duplicados            int not null default 0,
    bloqueados            int not null default 0,
    erro                  text check (erro is null or length(erro) <= 500),
    criado_por            uuid default auth.uid() references auth.users (id),
    criado_em             timestamptz not null default now(),
    atualizado_em         timestamptz not null default now()
);
create index if not exists mensageria_campanhas_empresa on public.mensageria_campanhas (empresa_id, criado_em desc);
create index if not exists mensageria_campanhas_fila on public.mensageria_campanhas (situacao)
    where situacao in ('analisando', 'agendada');
comment on column public.mensageria_campanhas.layout is
    '{"telefone": "coluna", "email": "coluna", "id_cliente": "coluna", "variaveis": {"nome_var": "coluna"}} confirmado pelo cliente.';

-- campanha: o site cria e confirma o layout; o motor analisa e envia
create or replace function public.validar_campanha() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.template_id is not null and not exists (
        select 1 from public.mensageria_templates t where t.id = new.template_id and t.empresa_id = new.empresa_id
           and (t.canal = new.canal or (new.canal in ('email', 'whatsapp')))) then
        raise exception 'template de outra empresa ou de outro canal';
    end if;
    if new.fallback_template_id is not null and not exists (
        select 1 from public.mensageria_templates t where t.id = new.fallback_template_id
           and t.empresa_id = new.empresa_id and t.canal = 'sms') then
        raise exception 'o fallback usa um template de SMS da empresa';
    end if;
    if new.centro_custo_id is not null and not exists (
        select 1 from public.mensageria_centros_custo c where c.id = new.centro_custo_id and c.empresa_id = new.empresa_id) then
        raise exception 'centro de custo de outra empresa';
    end if;
    if new.arquivo_caminho is not null and split_part(new.arquivo_caminho, '/', 1) <>
       (select e.slug from public.empresas e where e.id = new.empresa_id) then
        raise exception 'arquivo fora da pasta da empresa';
    end if;
    new.atualizado_em := now();
    return new;
end $$;
drop trigger if exists validar_campanha on public.mensageria_campanhas;
create trigger validar_campanha before insert or update on public.mensageria_campanhas
    for each row execute function public.validar_campanha();

create or replace function public.confirmar_layout(campanha bigint, layout jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
    c public.mensageria_campanhas;
    faltam text;
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
    update public.mensageria_campanhas set layout = confirmar_layout.layout, situacao = 'pronta' where id = campanha;
    return 'pronta';
end $$;
revoke execute on function public.confirmar_layout(bigint, jsonb) from public, anon;
grant execute on function public.confirmar_layout(bigint, jsonb) to authenticated;

create or replace function public.agendar_campanha(campanha bigint, quando timestamptz default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.mensageria_campanhas;
begin
    select * into c from public.mensageria_campanhas where id = campanha;
    if c.id is null or c.empresa_id not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'campanha não encontrada';
    end if;
    if c.situacao <> 'pronta' then
        raise exception 'confirme o layout antes de agendar';
    end if;
    if c.template_id is null then
        raise exception 'escolha o template';
    end if;
    update public.mensageria_campanhas set situacao = 'agendada', agendada_para = coalesce(quando, now())
     where id = campanha;
    return 'agendada';
end $$;
revoke execute on function public.agendar_campanha(bigint, timestamptz) from public, anon;
grant execute on function public.agendar_campanha(bigint, timestamptz) to authenticated;

create or replace function public.cancelar_campanha(campanha bigint) returns text
language plpgsql security definer set search_path = public as $$
declare c public.mensageria_campanhas;
begin
    select * into c from public.mensageria_campanhas where id = campanha;
    if c.id is null or c.empresa_id not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'campanha não encontrada';
    end if;
    if c.situacao in ('concluida', 'cancelada') then
        raise exception 'campanha já %', replace(c.situacao, '_', ' ');
    end if;
    update public.mensageria_campanhas set situacao = 'cancelada' where id = campanha;
    update public.mensageria_lotes set situacao = 'cancelado', concluido_em = now(), atualizado_em = now()
     where campanha_id = campanha and situacao in ('aguardando_aprovacao', 'agendado', 'enviando', 'pausado');
    return 'cancelada';
end $$;
revoke execute on function public.cancelar_campanha(bigint) from public, anon;
grant execute on function public.cancelar_campanha(bigint) to authenticated;

-- ---------------------------------------------------------------- lotes, mensagens e configuração
alter table public.mensageria_lotes add column if not exists campanha_id bigint references public.mensageria_campanhas (id);
alter table public.mensageria_lotes add column if not exists centro_custo_id bigint references public.mensageria_centros_custo (id);
alter table public.mensageria_lotes add column if not exists invalidos int not null default 0;
alter table public.mensageria_lotes add column if not exists fallback int not null default 0;
alter table public.mensageria_lotes drop constraint if exists mensageria_lotes_empresa_id_credor_id_data_canal_key;
create unique index if not exists mensageria_lotes_unico
    on public.mensageria_lotes (empresa_id, credor_id, data, canal, coalesce(campanha_id, 0));
alter table public.mensageria_lotes drop constraint if exists mensageria_lotes_canal_check;
alter table public.mensageria_lotes add constraint mensageria_lotes_canal_check
    check (canal in ('sms', 'email', 'rcs', 'whatsapp'));
alter table public.mensageria_mensagens add column if not exists fallback text
    check (fallback is null or fallback in ('sms', 'whatsapp'));

alter table public.mensageria_config add column if not exists centro_custo_id bigint
    references public.mensageria_centros_custo (id);
alter table public.mensageria_config add column if not exists rcs_fallback text not null default 'sms';
alter table public.mensageria_config drop constraint if exists mensageria_config_rcs_fallback_check;
alter table public.mensageria_config add constraint mensageria_config_rcs_fallback_check
    check (rcs_fallback in ('nenhum', 'sms', 'whatsapp'));
alter table public.mensageria_config add column if not exists rcs_fallback_template_id bigint
    references public.mensageria_templates (id);
comment on column public.mensageria_config.rcs_fallback is
    'Aparelho sem RCS: manda por SMS (template de fallback ou o texto do RCS até 160 caracteres), WhatsApp ou nada.';

-- o cliente (com editar_canais) escolhe centro de custo e fallback da Lista do dia; o modo continua com a equipe
create or replace function public.configurar_mensageria(empresa bigint, centro_custo bigint, rcs_fallback text,
                                                        rcs_fallback_template bigint default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
    if not (empresa in (select public.minhas_empresas()) and public.pode('editar_canais')) then
        raise exception 'sem permissão para configurar a mensageria';
    end if;
    if centro_custo is not null and not exists (select 1 from public.mensageria_centros_custo c
                                                where c.id = centro_custo and c.empresa_id = empresa) then
        raise exception 'centro de custo de outra empresa';
    end if;
    if rcs_fallback_template is not null and not exists (select 1 from public.mensageria_templates t
                                                         where t.id = rcs_fallback_template and t.empresa_id = empresa
                                                           and t.canal = 'sms') then
        raise exception 'o fallback usa um template de SMS da empresa';
    end if;
    insert into public.mensageria_config (empresa_id, centro_custo_id, rcs_fallback, rcs_fallback_template_id, atualizado_por)
    values (empresa, centro_custo, rcs_fallback, rcs_fallback_template, auth.uid())
    on conflict (empresa_id) do update set centro_custo_id = excluded.centro_custo_id,
        rcs_fallback = excluded.rcs_fallback, rcs_fallback_template_id = excluded.rcs_fallback_template_id,
        atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke execute on function public.configurar_mensageria(bigint, bigint, text, bigint) from public, anon;
grant execute on function public.configurar_mensageria(bigint, bigint, text, bigint) to authenticated;

-- ---------------------------------------------------------------- funil
create or replace view public.mensageria_funil with (security_invoker = true) as
select l.empresa_id, l.canal, l.data, l.campanha_id, coalesce(c.nome, 'Lista do dia') as origem,
       sum(l.total)::bigint                                   as carregados,
       sum(l.invalidos)::bigint                               as invalidos,
       sum(l.bloqueadas - l.invalidos)::bigint                as bloqueados,
       sum(l.total - l.bloqueadas)::bigint                    as higienizados,
       sum(l.enviadas)::bigint                                as enviados,
       sum(l.entregues)::bigint                               as entregues,
       sum(l.falhas)::bigint                                  as nao_entregues,
       sum(l.fallback)::bigint                                as fallback,
       sum(l.descadastros)::bigint                            as descadastros,
       sum(l.respostas)::bigint                               as respostas
  from public.mensageria_lotes l
  left join public.mensageria_campanhas c on c.id = l.campanha_id
 group by l.empresa_id, l.canal, l.data, l.campanha_id, c.nome;
grant select on public.mensageria_funil to authenticated;
revoke all on public.mensageria_funil from anon;

-- ---------------------------------------------------------------- permissões (RLS)
alter table public.mensageria_centros_custo enable row level security;
alter table public.mensageria_consumo_centro enable row level security;
alter table public.mensageria_templates enable row level security;
alter table public.mensageria_listas_contato enable row level security;
alter table public.mensageria_campanhas enable row level security;

drop policy if exists centros_ver on public.mensageria_centros_custo;
create policy centros_ver on public.mensageria_centros_custo for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists centros_gravar on public.mensageria_centros_custo;
create policy centros_gravar on public.mensageria_centros_custo for all to authenticated
    using (empresa_id in (select public.minhas_empresas()) and public.pode('editar_canais'))
    with check (empresa_id in (select public.minhas_empresas()) and public.pode('editar_canais'));
drop policy if exists consumo_centro_ver on public.mensageria_consumo_centro;
create policy consumo_centro_ver on public.mensageria_consumo_centro for select to authenticated
    using (exists (select 1 from public.mensageria_centros_custo c where c.id = centro_id
                   and c.empresa_id in (select public.minhas_empresas())));
revoke insert, update, delete on public.mensageria_consumo_centro from authenticated;

drop policy if exists templates_ver on public.mensageria_templates;
create policy templates_ver on public.mensageria_templates for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists templates_gravar on public.mensageria_templates;
create policy templates_gravar on public.mensageria_templates for all to authenticated
    using (empresa_id in (select public.minhas_empresas()) and public.pode('editar_canais'))
    with check (empresa_id in (select public.minhas_empresas()) and public.pode('editar_canais'));

drop policy if exists listas_contato_ver on public.mensageria_listas_contato;
create policy listas_contato_ver on public.mensageria_listas_contato for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke insert, update, delete on public.mensageria_listas_contato from authenticated;

drop policy if exists campanhas_ver on public.mensageria_campanhas;
create policy campanhas_ver on public.mensageria_campanhas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists campanhas_criar on public.mensageria_campanhas;
create policy campanhas_criar on public.mensageria_campanhas for insert to authenticated
    with check (empresa_id in (select public.minhas_empresas()) and public.pode('enviar_mensagens')
                and situacao = 'analisando' and layout is null and layout_sugerido is null and carregados = 0);
drop policy if exists campanhas_editar on public.mensageria_campanhas;
create policy campanhas_editar on public.mensageria_campanhas for update to authenticated
    using (empresa_id in (select public.minhas_empresas()) and public.pode('enviar_mensagens')
           and situacao in ('aguardando_layout', 'pronta'))
    with check (empresa_id in (select public.minhas_empresas()) and situacao in ('aguardando_layout', 'pronta'));
-- o site só muda nome, template, centro de custo, links e fallback; layout e situação vão pelas funções
revoke update on public.mensageria_campanhas from authenticated;
grant update (nome, template_id, centro_custo_id, rastrear_links, fallback, fallback_template_id)
    on public.mensageria_campanhas to authenticated;
revoke delete on public.mensageria_campanhas from authenticated;

revoke all on public.mensageria_centros_custo, public.mensageria_consumo_centro, public.mensageria_templates,
    public.mensageria_listas_contato, public.mensageria_campanhas from anon;

-- ---------------------------------------------------------------- arquivos: listas e mídia do RCS
-- entradas/<empresa>/mensageria/... (listas das campanhas) e entradas/<empresa>/midia/... (imagens e PDFs do RCS)
drop policy if exists entradas_mensageria_enviar on storage.objects;
create policy entradas_mensageria_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'entradas' and public.pode_ver_slug((storage.foldername(name))[1])
                and (((storage.foldername(name))[2] = 'mensageria' and public.pode('enviar_mensagens'))
                     or ((storage.foldername(name))[2] = 'midia' and public.pode('editar_canais'))));
drop policy if exists entradas_midia_ler on storage.objects;
create policy entradas_midia_ler on storage.objects for select to authenticated
    using (bucket_id = 'entradas' and public.pode_ver_slug((storage.foldername(name))[1])
           and (storage.foldername(name))[2] = 'midia');

-- ---------------------------------------------------------------- auditoria
do $$
declare t text;
begin
    foreach t in array array['mensageria_centros_custo', 'mensageria_templates', 'mensageria_campanhas'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
