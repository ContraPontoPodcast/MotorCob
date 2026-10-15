-- SQL 36 · Radar e caixa de atendimento (protótipo aprovado em 15/10/2026)
-- 1. Situações da conversa: Nova (aberta, sem responsável) · Em atendimento (aberta, com responsável) · Aguardando
--    cliente (a última mensagem é nossa) · Resolvida. Tempo de espera desde a primeira mensagem do cliente sem
--    resposta e tempo de cada resposta, gravados sozinhos.
-- 2. Notas internas, histórico (assumiu, transferiu, corrigiu a classe, resolveu, reabriu) e transferência para colega.
-- 3. Respostas rápidas: nenhuma vem pronta; Admin e Planejamento da empresa escrevem as suas.
-- 4. Configuração por empresa: meta de primeira resposta (opcional, desligada) e avisos no sino.
-- 5. Painel do Radar (classes, correções, tempo de resposta) e desempenho por pessoa (só Admin e Gestão).
-- 6. Custo previsto da resposta em grupo.
-- Depende do SQL 34 (avisos). Pode rodar de novo sem erro.

-- ================================================================ 1. situações e tempos
alter table public.mensageria_conversas drop constraint if exists mensageria_conversas_situacao_check;
alter table public.mensageria_conversas add constraint mensageria_conversas_situacao_check
    check (situacao in ('aberta', 'aguardando', 'resolvida'));
alter table public.mensageria_conversas add column if not exists espera_desde timestamptz;
comment on column public.mensageria_conversas.espera_desde is
    'Primeira mensagem do cliente ainda sem resposta nossa (nulo quando respondida). Base do "esperando há".';
alter table public.mensageria_conversa_mensagens add column if not exists tempo_resposta_seg int;
comment on column public.mensageria_conversa_mensagens.tempo_resposta_seg is
    'Na saída: segundos entre a primeira mensagem do cliente sem resposta e esta resposta.';

create or replace function public.tempos_da_conversa() returns trigger
language plpgsql security definer set search_path = public as $$
declare esp timestamptz;
begin
    if new.direcao = 'entrada' then
        update public.mensageria_conversas
           set espera_desde = coalesce(espera_desde, new.criado_em),
               situacao = case when situacao = 'resolvida' or situacao = 'aguardando' then 'aberta' else situacao end
         where id = new.conversa_id;
    elsif new.direcao = 'saida' then
        select espera_desde into esp from public.mensageria_conversas where id = new.conversa_id;
        if esp is not null then
            new.tempo_resposta_seg := greatest(0, extract(epoch from new.criado_em - esp))::int;
        end if;
        update public.mensageria_conversas set espera_desde = null, situacao = 'aguardando' where id = new.conversa_id;
    end if;
    return new;
end $$;
drop trigger if exists tempos_da_conversa on public.mensageria_conversa_mensagens;
create trigger tempos_da_conversa before insert on public.mensageria_conversa_mensagens
    for each row execute function public.tempos_da_conversa();

-- ================================================================ 2. notas, histórico e transferência
create table if not exists public.mensageria_conversa_notas (
    id           bigint generated always as identity primary key,
    conversa_id  bigint not null references public.mensageria_conversas (id) on delete cascade,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    autor        uuid default auth.uid() references auth.users (id) on delete set null,
    texto        text not null check (char_length(trim(texto)) between 1 and 1000),
    criado_em    timestamptz not null default now(),
    apagar_em    timestamptz not null default now() + interval '90 days'
);
create index if not exists mensageria_conversa_notas_conversa on public.mensageria_conversa_notas (conversa_id, id);

create table if not exists public.mensageria_conversa_eventos (
    id           bigint generated always as identity primary key,
    conversa_id  bigint not null references public.mensageria_conversas (id) on delete cascade,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    tipo         text not null check (tipo in ('assumiu', 'transferiu', 'reclassificou', 'resolveu', 'reabriu',
                                               'aguardando')),
    por          uuid default auth.uid() references auth.users (id) on delete set null,
    para         uuid references auth.users (id) on delete set null,
    de_classe    text,
    para_classe  text,
    criado_em    timestamptz not null default now(),
    apagar_em    timestamptz not null default now() + interval '90 days'
);
create index if not exists mensageria_conversa_eventos_conversa on public.mensageria_conversa_eventos (conversa_id, id);
create index if not exists mensageria_conversa_eventos_empresa on public.mensageria_conversa_eventos (empresa_id, tipo, criado_em);

alter table public.mensageria_conversa_notas enable row level security;
alter table public.mensageria_conversa_eventos enable row level security;
revoke all on public.mensageria_conversa_notas, public.mensageria_conversa_eventos from anon, authenticated;
grant select on public.mensageria_conversa_notas, public.mensageria_conversa_eventos to authenticated;
grant all on public.mensageria_conversa_notas, public.mensageria_conversa_eventos to service_role;
drop policy if exists conversa_notas_ver on public.mensageria_conversa_notas;
create policy conversa_notas_ver on public.mensageria_conversa_notas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.pode('enviar_mensagens') or public.sou_equipe()));
drop policy if exists conversa_eventos_ver on public.mensageria_conversa_eventos;
create policy conversa_eventos_ver on public.mensageria_conversa_eventos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.pode('enviar_mensagens') or public.sou_equipe()));

-- a conversa que a pessoa pode atender (mesma regra do responder_conversa)
create or replace function public.conversa_que_atendo(conversa bigint) returns public.mensageria_conversas
language plpgsql stable security definer set search_path = public as $$
declare c public.mensageria_conversas;
begin
    select * into c from public.mensageria_conversas where id = conversa;
    if c.id is null or c.empresa_id not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'conversa não encontrada';
    end if;
    return c;
end $$;
revoke all on function public.conversa_que_atendo(bigint) from public, anon, authenticated;

-- mesmas ações de antes, agora com histórico; 'aguardando' é nova
create or replace function public.atualizar_conversa(conversa bigint, acao text, classe text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.mensageria_conversas := public.conversa_que_atendo(conversa);
begin
    if acao = 'lida' then
        update public.mensageria_conversas set nao_lidas = 0 where id = conversa;
        return acao;
    elsif acao = 'resolver' then
        update public.mensageria_conversas set situacao = 'resolvida', nao_lidas = 0, espera_desde = null where id = conversa;
        insert into public.mensageria_conversa_eventos (conversa_id, empresa_id, tipo) values (conversa, c.empresa_id, 'resolveu');
    elsif acao = 'reabrir' then
        update public.mensageria_conversas set situacao = 'aberta' where id = conversa;
        insert into public.mensageria_conversa_eventos (conversa_id, empresa_id, tipo) values (conversa, c.empresa_id, 'reabriu');
    elsif acao = 'aguardando' then
        update public.mensageria_conversas set situacao = 'aguardando', espera_desde = null where id = conversa;
        insert into public.mensageria_conversa_eventos (conversa_id, empresa_id, tipo) values (conversa, c.empresa_id, 'aguardando');
    elsif acao = 'assumir' then
        update public.mensageria_conversas set responsavel = auth.uid() where id = conversa;
        insert into public.mensageria_conversa_eventos (conversa_id, empresa_id, tipo, para)
        values (conversa, c.empresa_id, 'assumiu', auth.uid());
    elsif acao = 'reclassificar' and atualizar_conversa.classe in ('cpc_negocio', 'cpc', 'alega_pagamento',
                                                                    'baixo_calao', 'desconhece', 'judicial') then
        if c.classe is distinct from atualizar_conversa.classe then
            update public.mensageria_conversas set classe = atualizar_conversa.classe, confianca = 1 where id = conversa;
            insert into public.mensageria_conversa_eventos (conversa_id, empresa_id, tipo, de_classe, para_classe)
            values (conversa, c.empresa_id, 'reclassificou', coalesce(c.classe, 'sem_classe'), atualizar_conversa.classe);
        end if;
    else
        raise exception 'ação inválida';
    end if;
    return acao;
end $$;
revoke execute on function public.atualizar_conversa(bigint, text, text) from public, anon;
grant execute on function public.atualizar_conversa(bigint, text, text) to authenticated;

create or replace function public.anotar_conversa(conversa bigint, texto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.mensageria_conversas := public.conversa_que_atendo(conversa); nid bigint;
begin
    insert into public.mensageria_conversa_notas (conversa_id, empresa_id, texto)
    values (conversa, c.empresa_id, trim(texto)) returning id into nid;
    return nid;
end $$;

-- quem pode atender (enviar_mensagens), olhando o perfil de outra pessoa da empresa
create or replace function public.atende_mensagens(usuario uuid, empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select coalesce((select pu.permitido from public.permissoes_usuario pu
                          where pu.usuario_id = p.id and pu.permissao = 'enviar_mensagens'),
                        (select pp.permitido from public.permissoes_papel pp
                          where pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = 'enviar_mensagens'),
                        public.permissao_padrao(p.papel, 'enviar_mensagens'))
          from public.perfis p
         where p.id = usuario and p.ativo and not p.equipe and p.empresa_id = empresa), false)
$$;
revoke all on function public.atende_mensagens(uuid, bigint) from public, anon, authenticated;

create or replace function public.transferir_conversa(conversa bigint, para uuid, nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.mensageria_conversas := public.conversa_que_atendo(conversa);
begin
    if para is null or para = auth.uid() or not public.atende_mensagens(para, c.empresa_id) then
        raise exception 'escolha um colega da empresa que atende mensagens';
    end if;
    update public.mensageria_conversas set responsavel = para,
           situacao = case when situacao = 'resolvida' then 'aberta' else situacao end
     where id = conversa;
    insert into public.mensageria_conversa_eventos (conversa_id, empresa_id, tipo, para)
    values (conversa, c.empresa_id, 'transferiu', para);
    if nullif(trim(coalesce(nota, '')), '') is not null then
        insert into public.mensageria_conversa_notas (conversa_id, empresa_id, texto) values (conversa, c.empresa_id, trim(nota));
    end if;
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link)
    select 'usuario', c.empresa_id, transferir_conversa.para, 'atencao',
           left('Conversa transferida para você · ' || coalesce(c.destino_mascara, 'cliente'), 140),
           left(coalesce('De ' || nullif(trim(p.nome), '') || '. ', '') || coalesce(nullif(trim(nota), ''), ''), 400),
           '/mensageria/atendimento?conversa=' || c.id
      from public.perfis p where p.id = auth.uid();
end $$;

-- ================================================================ 3. respostas rápidas
create table if not exists public.mensageria_respostas_rapidas (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    nome           text not null check (char_length(trim(nome)) between 2 and 40),
    classe         text check (classe is null or classe in ('cpc_negocio', 'cpc', 'alega_pagamento', 'baixo_calao',
                                                            'desconhece', 'judicial', 'sem_classe')),
    texto          text not null check (char_length(trim(texto)) between 1 and 1000),
    atualizado_por uuid default auth.uid() references auth.users (id) on delete set null,
    atualizado_em  timestamptz not null default now(),
    unique (empresa_id, nome)
);
alter table public.mensageria_respostas_rapidas enable row level security;
revoke all on public.mensageria_respostas_rapidas from anon, authenticated;
grant select on public.mensageria_respostas_rapidas to authenticated;
grant all on public.mensageria_respostas_rapidas to service_role;
drop policy if exists respostas_rapidas_ver on public.mensageria_respostas_rapidas;
create policy respostas_rapidas_ver on public.mensageria_respostas_rapidas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.pode('enviar_mensagens') or public.sou_equipe()));

create or replace function public.configura_atendimento(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select public.pode_ver_empresa(empresa) and not public.sou_equipe() and public.tem_papel('admin', 'planejamento')
$$;
revoke all on function public.configura_atendimento(bigint) from public, anon, authenticated;

create or replace function public.salvar_resposta_rapida(empresa bigint, id bigint, nome text, classe text, texto text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
    if not public.configura_atendimento(empresa) then
        raise exception 'só Admin e Planejamento da empresa editam as respostas rápidas';
    end if;
    if salvar_resposta_rapida.id is null then
        insert into public.mensageria_respostas_rapidas (empresa_id, nome, classe, texto)
        values (empresa, trim(nome), nullif(classe, ''), trim(texto)) returning mensageria_respostas_rapidas.id into rid;
    else
        update public.mensageria_respostas_rapidas r
           set nome = trim(salvar_resposta_rapida.nome), classe = nullif(salvar_resposta_rapida.classe, ''),
               texto = trim(salvar_resposta_rapida.texto), atualizado_por = auth.uid(), atualizado_em = now()
         where r.id = salvar_resposta_rapida.id and r.empresa_id = empresa
        returning r.id into rid;
        if rid is null then
            raise exception 'resposta rápida não encontrada';
        end if;
    end if;
    return rid;
end $$;

create or replace function public.apagar_resposta_rapida(id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e bigint;
begin
    select r.empresa_id into e from public.mensageria_respostas_rapidas r where r.id = apagar_resposta_rapida.id;
    if e is null or not public.configura_atendimento(e) then
        raise exception 'resposta rápida não encontrada';
    end if;
    delete from public.mensageria_respostas_rapidas r where r.id = apagar_resposta_rapida.id;
end $$;

-- ================================================================ 4. configuração do atendimento
alter table public.mensageria_config
    add column if not exists meta_resposta_min int check (meta_resposta_min is null or meta_resposta_min between 5 and 240),
    add column if not exists avisar_judicial boolean not null default true,
    add column if not exists avisar_acima_meta boolean not null default true,
    add column if not exists avisar_negocio_sem_responsavel boolean not null default false;
comment on column public.mensageria_config.meta_resposta_min is
    'Meta de primeira resposta em minutos. Opcional: nulo = sem meta (a espera aparece sem cor).';

create or replace function public.salvar_config_atendimento(empresa bigint, meta_min int, avisar_judicial boolean,
                                                            avisar_acima_meta boolean, avisar_negocio boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
    if not public.configura_atendimento(empresa) then
        raise exception 'só Admin e Planejamento da empresa configuram o atendimento';
    end if;
    insert into public.mensageria_config (empresa_id, meta_resposta_min, avisar_judicial, avisar_acima_meta,
                                          avisar_negocio_sem_responsavel)
    values (empresa, meta_min, coalesce(avisar_judicial, true), coalesce(avisar_acima_meta, true),
            coalesce(avisar_negocio, false))
    on conflict (empresa_id) do update
       set meta_resposta_min = excluded.meta_resposta_min, avisar_judicial = excluded.avisar_judicial,
           avisar_acima_meta = excluded.avisar_acima_meta,
           avisar_negocio_sem_responsavel = excluded.avisar_negocio_sem_responsavel, atualizado_em = now();
end $$;

-- avisos do atendimento (motor, chave do servidor): Judicial na hora; acima do dobro da meta; CPC Negócio sem
-- responsável há 10 min. Vão para Admin e Gestão da empresa (o de meta, para quem atende quando houver).
create or replace function public.gerar_avisos_atendimento() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
    with gestores as (
        select p.id, p.empresa_id from public.perfis p where p.ativo and not p.equipe and p.papel in ('admin', 'gestao'))
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave)
    select 'usuario', c.empresa_id, g.id, 'atencao',
           left('Resposta Judicial · ' || coalesce(c.destino_mascara, 'cliente'), 140),
           left('Cliente ' || coalesce(c.id_cliente, '—') || ' citou processo ou advogado. Veja a conversa.', 400),
           '/mensageria/atendimento?conversa=' || c.id, 'judicial:' || c.id || ':' || g.id
      from public.mensageria_conversas c
      join gestores g on g.empresa_id = c.empresa_id
      left join public.mensageria_config cf on cf.empresa_id = c.empresa_id
     where c.classe = 'judicial' and c.situacao <> 'resolvida' and c.ultima_em > now() - interval '1 day'
       and coalesce(cf.avisar_judicial, true)
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;

    with gestores as (
        select p.id, p.empresa_id from public.perfis p where p.ativo and not p.equipe and p.papel in ('admin', 'gestao')),
    atrasadas as (
        select c.* from public.mensageria_conversas c join public.mensageria_config cf on cf.empresa_id = c.empresa_id
         where c.situacao = 'aberta' and cf.meta_resposta_min is not null and cf.avisar_acima_meta
           and c.espera_desde < now() - make_interval(mins => cf.meta_resposta_min * 2))
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave)
    select 'usuario', a.empresa_id, d.usuario, 'erro',
           left('Esperando resposta há ' || (extract(epoch from now() - a.espera_desde) / 60)::int || ' min · '
                || coalesce(a.destino_mascara, 'cliente'), 140),
           'Passou do dobro da meta de primeira resposta.', '/mensageria/atendimento?conversa=' || a.id,
           'espera:' || a.id || ':' || extract(epoch from a.espera_desde)::bigint || ':' || d.usuario
      from atrasadas a
      cross join lateral (select a.responsavel as usuario where a.responsavel is not null
                          union all select g.id from gestores g where a.responsavel is null and g.empresa_id = a.empresa_id) d
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;

    with gestores as (
        select p.id, p.empresa_id from public.perfis p where p.ativo and not p.equipe and p.papel in ('admin', 'gestao'))
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave)
    select 'usuario', c.empresa_id, g.id, 'atencao',
           left('CPC Negócio sem responsável · ' || coalesce(c.destino_mascara, 'cliente'), 140),
           'O cliente quer negociar e ninguém assumiu a conversa há mais de 10 minutos.',
           '/mensageria/atendimento?conversa=' || c.id,
           'negocio:' || c.id || ':' || extract(epoch from c.espera_desde)::bigint || ':' || g.id
      from public.mensageria_conversas c
      join public.mensageria_config cf on cf.empresa_id = c.empresa_id and cf.avisar_negocio_sem_responsavel
      join gestores g on g.empresa_id = c.empresa_id
     where c.classe = 'cpc_negocio' and c.situacao = 'aberta' and c.responsavel is null
       and c.espera_desde < now() - interval '10 minutes'
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
    return n;
end $$;

create or replace function public.limpar_atendimento_90d() returns void
language sql security definer set search_path = public as $$
    delete from public.mensageria_conversa_notas where apagar_em < now();
    delete from public.mensageria_conversa_eventos where apagar_em < now();
$$;

-- ================================================================ 5. painel do Radar e desempenho
-- respostas de verdade: conversas de lotes reais (ou sem lote)
create or replace function public.painel_radar(empresa bigint, de date, ate date)
returns table (classe text, respostas bigint, corrigidas bigint)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.pode_ver_empresa(empresa) or not (public.pode('enviar_mensagens') or public.sou_equipe()) then
        raise exception 'empresa fora do seu acesso';
    end if;
    return query
    with resp as (
        select coalesce(m.classe, 'sem_classe') as classe, count(*) as n
          from public.mensageria_conversa_mensagens m
          join public.mensageria_conversas c on c.id = m.conversa_id
          left join public.mensageria_lotes l on l.id = c.lote_id
         where m.empresa_id = empresa and m.direcao = 'entrada' and coalesce(l.modo, 'real') = 'real'
           and m.criado_em >= de and m.criado_em < ate + 1
         group by 1),
    corr as (
        select e.de_classe as classe, count(*) as n from public.mensageria_conversa_eventos e
         where e.empresa_id = empresa and e.tipo = 'reclassificou' and e.criado_em >= de and e.criado_em < ate + 1
         group by 1)
    select k.classe, coalesce(r.n, 0), coalesce(x.n, 0)
      from (values ('cpc_negocio', 1), ('cpc', 2), ('alega_pagamento', 3), ('desconhece', 4), ('judicial', 5),
                   ('baixo_calao', 6), ('sem_classe', 7)) as k(classe, ordem)
      left join resp r on r.classe = k.classe left join corr x on x.classe = k.classe
     order by k.ordem;
end $$;

create or replace function public.resumo_atendimento(empresa bigint, de date, ate date)
returns table (respostas bigint, entregues bigint, primeira_resposta_mediana_min numeric, esperando_agora bigint,
               mais_antiga_min int, meta_min int)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.pode_ver_empresa(empresa) or not (public.pode('enviar_mensagens') or public.sou_equipe()) then
        raise exception 'empresa fora do seu acesso';
    end if;
    return query
    select (select count(*) from public.mensageria_conversa_mensagens m
              join public.mensageria_conversas c on c.id = m.conversa_id
              left join public.mensageria_lotes l on l.id = c.lote_id
             where m.empresa_id = empresa and m.direcao = 'entrada' and coalesce(l.modo, 'real') = 'real'
               and m.criado_em >= de and m.criado_em < ate + 1),
           (select count(*) from public.mensageria_mensagens mm join public.mensageria_lotes l on l.id = mm.lote_id
             where mm.empresa_id = empresa and l.modo = 'real' and mm.situacao = 'entregue'
               and mm.enviado_em >= de and mm.enviado_em < ate + 1),
           (select round((percentile_cont(0.5) within group (order by m.tempo_resposta_seg) / 60.0)::numeric, 0)
              from public.mensageria_conversa_mensagens m
             where m.empresa_id = empresa and m.direcao = 'saida' and m.tempo_resposta_seg is not null
               and m.criado_em >= de and m.criado_em < ate + 1),
           (select count(*) from public.mensageria_conversas c
             where c.empresa_id = empresa and c.situacao = 'aberta' and c.espera_desde is not null),
           (select (extract(epoch from now() - min(c.espera_desde)) / 60)::int from public.mensageria_conversas c
             where c.empresa_id = empresa and c.situacao = 'aberta' and c.espera_desde is not null),
           (select cf.meta_resposta_min from public.mensageria_config cf where cf.empresa_id = empresa);
end $$;

-- por pessoa: só Admin e Gestão da empresa (e a equipe MotorCob)
create or replace function public.desempenho_atendimento(empresa bigint, de date, ate date)
returns table (usuario uuid, nome text, atendidas bigint, primeira_resposta_mediana_min numeric, resolvidas bigint)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.pode_ver_empresa(empresa) or not (public.tem_papel('admin', 'gestao') or public.sou_equipe()) then
        raise exception 'só Admin e Gestão veem o desempenho por pessoa';
    end if;
    return query
    with saidas as (
        select m.criado_por as u, m.conversa_id, m.tempo_resposta_seg from public.mensageria_conversa_mensagens m
         where m.empresa_id = empresa and m.direcao = 'saida' and m.criado_por is not null
           and m.criado_em >= de and m.criado_em < ate + 1),
    res as (
        select e.por as u, count(distinct e.conversa_id) as n from public.mensageria_conversa_eventos e
         where e.empresa_id = empresa and e.tipo = 'resolveu' and e.criado_em >= de and e.criado_em < ate + 1
         group by 1)
    select s.u, p.nome, count(distinct s.conversa_id),
           round((percentile_cont(0.5) within group (order by s.tempo_resposta_seg) / 60.0)::numeric, 0),
           coalesce(max(r.n), 0)
      from saidas s join public.perfis p on p.id = s.u left join res r on r.u = s.u
     group by s.u, p.nome
     order by 3 desc;
end $$;

-- ================================================================ 6. custo previsto da resposta em grupo
create or replace function public.custo_resposta_grupo(conversas bigint[], texto text)
returns table (canal text, item text, mensagens bigint, descadastrados bigint, preco numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
declare e bigint;
begin
    select min(c.empresa_id) into e from public.mensageria_conversas c where c.id = any (conversas);
    if e is null or exists (select 1 from public.mensageria_conversas c where c.id = any (conversas) and c.empresa_id <> e)
       or e not in (select public.minhas_empresas()) or not public.pode('enviar_mensagens') then
        raise exception 'conversas fora do seu acesso';
    end if;
    if cardinality(conversas) > 200 then
        raise exception 'até 200 conversas por vez';
    end if;
    return query
    with base as (
        select c.canal,
               case when c.canal = 'rcs' then
                         case when exists (select 1 from public.mensageria_sessoes_rcs s where s.empresa_id = c.empresa_id
                                             and s.destino_hash = c.destino_hash and s.fim > now()) then 'rcs_sessao'
                              when char_length(coalesce(texto, '')) <= 160 then 'rcs_basic' else 'rcs_single' end
                    else c.canal end as item,
               exists (select 1 from public.mensageria_descadastros d where d.empresa_id = c.empresa_id
                         and d.canal = c.canal and d.destino_hash = c.destino_hash) as fora
          from public.mensageria_conversas c where c.id = any (conversas))
    select b.canal, b.item, count(*) filter (where not b.fora), count(*) filter (where b.fora),
           round(coalesce(public.preco_unitario(e, b.item, count(*) filter (where not b.fora),
                                                date_trunc('month', current_date)::date), 0), 4),
           round(coalesce(public.preco_unitario(e, b.item, count(*) filter (where not b.fora),
                                                date_trunc('month', current_date)::date), 0)
                 * count(*) filter (where not b.fora), 2)
      from base b group by b.canal, b.item order by 1, 2;
end $$;

-- ================================================================ permissões
do $$
declare f text;
begin
    foreach f in array array['public.anotar_conversa(bigint, text)', 'public.transferir_conversa(bigint, uuid, text)',
                             'public.salvar_resposta_rapida(bigint, bigint, text, text, text)',
                             'public.apagar_resposta_rapida(bigint)',
                             'public.salvar_config_atendimento(bigint, int, boolean, boolean, boolean)',
                             'public.painel_radar(bigint, date, date)', 'public.resumo_atendimento(bigint, date, date)',
                             'public.desempenho_atendimento(bigint, date, date)',
                             'public.custo_resposta_grupo(bigint[], text)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
revoke all on function public.gerar_avisos_atendimento() from public, anon, authenticated;
grant execute on function public.gerar_avisos_atendimento() to service_role;
revoke all on function public.limpar_atendimento_90d() from public, anon, authenticated;
grant execute on function public.limpar_atendimento_90d() to service_role;
