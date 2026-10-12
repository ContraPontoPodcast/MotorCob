-- Radar MotorCob, atendimento das respostas e rastreio de links.
-- * Radar: lê cada resposta das mensagens e classifica o cliente em cpc_negocio (CPC Negócio), cpc, alega_pagamento
--   (Alega pagamento), baixo_calao (Baixo calão), desconhece, judicial. O sinal de negócio pesa mais que o palavrão
--   ("me manda o boleto FDP" = CPC Negócio). Ligado para toda empresa com Mensageria (mensageria_config.radar).
-- * Atendimento: cada número que respondeu vira uma conversa; o cliente filtra pela classificação do Radar e responde
--   dali (o motor envia pelo mesmo canal; o telefone continua só no servidor). Textos guardados por 90 dias.
-- * Links rastreados: com "Rastrear links" ligado, cada link do texto vira um endereço curto do MotorCob, único por
--   mensagem; cada clique é registrado. Funil: enviados → entregues → clicaram → responderam → CPC Negócio.
-- Pode ser rodado de novo sem erro.

alter table public.mensageria_config add column if not exists radar boolean not null default true;
comment on column public.mensageria_config.radar is 'Radar MotorCob: classificar as respostas com IA (ligado por padrão).';

-- ---------------------------------------------------------------- conversas e mensagens (90 dias)
create table if not exists public.mensageria_conversas (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    canal            text not null check (canal in ('sms', 'rcs', 'whatsapp', 'email')),
    destino_hash     text not null check (destino_hash ~ '^[0-9a-f]{64}$'),
    destino_mascara  text check (char_length(destino_mascara) <= 80),
    id_cliente       text check (char_length(id_cliente) <= 80),
    lote_id          bigint references public.mensageria_lotes (id) on delete set null,
    mensagem_id      bigint,                                   -- envio original (o motor acha o contato por ele)
    campanha_id      bigint references public.mensageria_campanhas (id) on delete set null,
    classe           text check (classe in ('cpc_negocio', 'cpc', 'alega_pagamento', 'baixo_calao', 'desconhece',
                                            'judicial', 'sem_classe')),
    confianca        numeric(4, 3),
    situacao         text not null default 'aberta' check (situacao in ('aberta', 'resolvida')),
    nao_lidas        int not null default 0,
    responsavel      uuid references auth.users (id),
    ultima_em        timestamptz not null default now(),
    criada_em        timestamptz not null default now(),
    unique (empresa_id, canal, destino_hash)
);
create index if not exists mensageria_conversas_lista on public.mensageria_conversas (empresa_id, situacao, ultima_em desc);

create table if not exists public.mensageria_conversa_mensagens (
    id             bigint generated always as identity primary key,
    conversa_id    bigint not null references public.mensageria_conversas (id) on delete cascade,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    direcao        text not null check (direcao in ('entrada', 'saida')),
    texto          text not null check (length(texto) between 1 and 2000),
    classe         text check (classe in ('cpc_negocio', 'cpc', 'alega_pagamento', 'baixo_calao', 'desconhece',
                                          'judicial', 'sem_classe')),
    confianca      numeric(4, 3),
    justificativa  text check (justificativa is null or length(justificativa) <= 300),
    origem_radar   text check (origem_radar in ('ia', 'regras')),
    situacao       text not null default 'recebida'
                   check (situacao in ('recebida', 'pendente', 'enviada', 'falhou', 'bloqueada')),
    motivo         text check (motivo is null or length(motivo) <= 200),
    criado_em      timestamptz not null default now(),
    criado_por     uuid default auth.uid() references auth.users (id),
    apagar_em      timestamptz not null default now() + interval '90 days'
);
create index if not exists mensageria_conversa_mensagens_conversa on public.mensageria_conversa_mensagens (conversa_id, id);
create index if not exists mensageria_conversa_mensagens_saida on public.mensageria_conversa_mensagens (situacao)
    where situacao = 'pendente';
create index if not exists mensageria_conversa_mensagens_apagar on public.mensageria_conversa_mensagens (apagar_em);

-- responder um cliente pela plataforma: o motor envia no próximo minuto, dentro do horário do canal
create or replace function public.responder_conversa(conversa bigint, texto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    c public.mensageria_conversas;
    mid bigint;
    t text := trim(texto);
begin
    select * into c from public.mensageria_conversas where id = conversa;
    if c.id is null or c.empresa_id not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'conversa não encontrada';
    end if;
    if t = '' then
        raise exception 'escreva a resposta';
    end if;
    if c.canal = 'sms' and length(t) > 160 then
        raise exception 'SMS tem até 160 caracteres (está com %)', length(t);
    end if;
    if length(t) > 1000 then
        raise exception 'resposta com até 1.000 caracteres';
    end if;
    if exists (select 1 from public.mensageria_descadastros d where d.empresa_id = c.empresa_id and d.canal = c.canal
               and d.destino_hash = c.destino_hash) then
        raise exception 'este contato pediu para não receber mais mensagens deste canal';
    end if;
    insert into public.mensageria_conversa_mensagens (conversa_id, empresa_id, direcao, texto, situacao, criado_por)
    values (conversa, c.empresa_id, 'saida', t, 'pendente', auth.uid()) returning id into mid;
    update public.mensageria_conversas set ultima_em = now(), nao_lidas = 0,
           responsavel = coalesce(responsavel, auth.uid())
     where id = conversa;
    return mid;
end $$;
revoke execute on function public.responder_conversa(bigint, text) from public, anon;
grant execute on function public.responder_conversa(bigint, text) to authenticated;

create or replace function public.atualizar_conversa(conversa bigint, acao text, classe text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.mensageria_conversas;
begin
    select * into c from public.mensageria_conversas where id = conversa;
    if c.id is null or c.empresa_id not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'conversa não encontrada';
    end if;
    if acao = 'lida' then
        update public.mensageria_conversas set nao_lidas = 0 where id = conversa;
    elsif acao = 'resolver' then
        update public.mensageria_conversas set situacao = 'resolvida', nao_lidas = 0 where id = conversa;
    elsif acao = 'reabrir' then
        update public.mensageria_conversas set situacao = 'aberta' where id = conversa;
    elsif acao = 'assumir' then
        update public.mensageria_conversas set responsavel = auth.uid() where id = conversa;
    elsif acao = 'reclassificar' and atualizar_conversa.classe in ('cpc_negocio', 'cpc', 'alega_pagamento',
                                                                    'baixo_calao', 'desconhece', 'judicial') then
        update public.mensageria_conversas set classe = atualizar_conversa.classe, confianca = 1 where id = conversa;
    else
        raise exception 'ação inválida';
    end if;
    return acao;
end $$;
revoke execute on function public.atualizar_conversa(bigint, text, text) from public, anon;
grant execute on function public.atualizar_conversa(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------- links rastreados e cliques
create table if not exists public.mensageria_links (
    codigo        text primary key check (codigo ~ '^[A-Za-z0-9]{7,12}$'),
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    lote_id       bigint references public.mensageria_lotes (id) on delete cascade,
    mensagem_id   bigint,
    campanha_id   bigint references public.mensageria_campanhas (id) on delete set null,
    canal         text not null,
    id_cliente    text check (char_length(id_cliente) <= 80),
    url_destino   text not null check (url_destino ~ '^https?://' and length(url_destino) <= 2000),
    criado_em     timestamptz not null default now(),
    apagar_em     timestamptz not null default now() + interval '90 days'
);
create index if not exists mensageria_links_lote on public.mensageria_links (lote_id);
create index if not exists mensageria_links_campanha on public.mensageria_links (campanha_id);

create table if not exists public.mensageria_cliques (
    id           bigint generated always as identity primary key,
    codigo       text not null references public.mensageria_links (codigo) on delete cascade,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    clicado_em   timestamptz not null default now(),
    dispositivo  text check (dispositivo in ('celular', 'computador', 'robo', 'outro'))
);
create index if not exists mensageria_cliques_codigo on public.mensageria_cliques (codigo, clicado_em);

-- o encurtador (função l, sem login) chama só isto: devolve o destino e registra o clique
create or replace function public.registrar_clique(codigo text, dispositivo text default 'outro') returns text
language plpgsql security definer set search_path = public as $$
declare l public.mensageria_links;
begin
    select * into l from public.mensageria_links x where x.codigo = registrar_clique.codigo and x.apagar_em > now();
    if l.codigo is null then
        return null;
    end if;
    insert into public.mensageria_cliques (codigo, empresa_id, dispositivo)
    values (l.codigo, l.empresa_id, case when dispositivo in ('celular', 'computador', 'robo') then dispositivo else 'outro' end);
    return l.url_destino;
end $$;
revoke execute on function public.registrar_clique(text, text) from public, anon, authenticated;
grant execute on function public.registrar_clique(text, text) to service_role;

-- ---------------------------------------------------------------- funil dos links e resumo do Radar
create or replace view public.mensageria_funil_links with (security_invoker = true) as
select l.empresa_id, l.canal, l.data, l.campanha_id, coalesce(c.nome, 'Lista do dia') as origem,
       sum(l.enviadas)::bigint as enviados,
       sum(l.entregues)::bigint as entregues,
       (select count(*) from public.mensageria_links k where k.lote_id = any (array_agg(l.id)))::bigint as links,
       (select count(distinct k.codigo) from public.mensageria_links k join public.mensageria_cliques q on q.codigo = k.codigo
         where k.lote_id = any (array_agg(l.id)) and q.dispositivo <> 'robo')::bigint as clicaram,
       (select count(*) from public.mensageria_links k join public.mensageria_cliques q on q.codigo = k.codigo
         where k.lote_id = any (array_agg(l.id)) and q.dispositivo <> 'robo')::bigint as cliques,
       sum(l.respostas)::bigint as responderam,
       (select count(*) from public.mensageria_conversas v where v.lote_id = any (array_agg(l.id))
           and v.classe = 'cpc_negocio')::bigint as cpc_negocio
  from public.mensageria_lotes l
  left join public.mensageria_campanhas c on c.id = l.campanha_id
 group by l.empresa_id, l.canal, l.data, l.campanha_id, c.nome;
grant select on public.mensageria_funil_links to authenticated;
revoke all on public.mensageria_funil_links from anon;

create or replace view public.radar_resumo with (security_invoker = true) as
select v.empresa_id, v.canal, (v.ultima_em at time zone 'America/Sao_Paulo')::date as data, v.campanha_id,
       coalesce(v.classe, 'sem_classe') as classe, count(*)::bigint as conversas,
       count(*) filter (where v.situacao = 'aberta')::bigint as abertas
  from public.mensageria_conversas v
 group by 1, 2, 3, 4, 5;
grant select on public.radar_resumo to authenticated;
revoke all on public.radar_resumo from anon;

-- ---------------------------------------------------------------- 90 dias (o motor chama uma vez por dia)
create or replace function public.limpar_mensageria_90d() returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int; k int;
begin
    delete from public.mensageria_conversa_mensagens where apagar_em < now();
    get diagnostics n = row_count;
    delete from public.mensageria_conversas v where v.ultima_em < now() - interval '90 days'
       and not exists (select 1 from public.mensageria_conversa_mensagens x where x.conversa_id = v.id);
    get diagnostics m = row_count;
    delete from public.mensageria_links where apagar_em < now();
    get diagnostics k = row_count;
    return n + m + k;
end $$;
revoke execute on function public.limpar_mensageria_90d() from public, anon, authenticated;
grant execute on function public.limpar_mensageria_90d() to service_role;

-- ---------------------------------------------------------------- permissões (RLS)
alter table public.mensageria_conversas enable row level security;
alter table public.mensageria_conversa_mensagens enable row level security;
alter table public.mensageria_links enable row level security;
alter table public.mensageria_cliques enable row level security;

-- o texto das respostas só para quem atende (enviar_mensagens) e para a equipe
drop policy if exists conversas_ver on public.mensageria_conversas;
create policy conversas_ver on public.mensageria_conversas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.pode('enviar_mensagens') or public.sou_equipe()));
drop policy if exists conversa_mensagens_ver on public.mensageria_conversa_mensagens;
create policy conversa_mensagens_ver on public.mensageria_conversa_mensagens for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.pode('enviar_mensagens') or public.sou_equipe()));
drop policy if exists links_ver on public.mensageria_links;
create policy links_ver on public.mensageria_links for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists cliques_ver on public.mensageria_cliques;
create policy cliques_ver on public.mensageria_cliques for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke insert, update, delete on public.mensageria_conversas, public.mensageria_conversa_mensagens,
    public.mensageria_links, public.mensageria_cliques from authenticated;
revoke all on public.mensageria_conversas, public.mensageria_conversa_mensagens, public.mensageria_links,
    public.mensageria_cliques from anon;
