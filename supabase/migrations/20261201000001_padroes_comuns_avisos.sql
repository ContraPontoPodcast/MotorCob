-- SQL 34 · Padrões comuns da revisão de UX (protótipo aprovado em 15/10/2026)
-- 1. Sino de avisos: tabela avisos (só o motor grava), lidos por pessoa, meus_avisos, avisos_novos e
--    marcar_avisos_lidos. Avisos com mais de 90 dias somem da lista e o motor apaga.
-- 2. Alertas de qualidade viram aviso para quem cuida (Técnico e Master): gerar_avisos_qualidade, chamada pelo
--    motor (uma vez por dia por fornecedor, operadora e nível).
-- 3. Cores próprias das faixas do Score de Entrega no tema (score.alto, score.medio, score.baixo, score.sem),
--    para não confundir com as cores de erro e alerta.
-- 4. score_formacao: quando o histórico da Mensageria começou e quando a janela do Score fica completa (aviso
--    "O Score está formando o histórico" na prévia e na Economia do Score).
-- Depende do SQL 33. Pode rodar de novo sem erro.

-- ================================================================ 1. avisos (sino)
create table if not exists public.avisos (
    id          bigint generated always as identity primary key,
    para        text not null check (para in ('usuario', 'empresa', 'equipe', 'tecnico')),
    empresa_id  bigint references public.empresas (id) on delete cascade,
    usuario_id  uuid references auth.users (id) on delete cascade,
    tipo        text not null default 'pronto' check (tipo in ('pronto', 'atencao', 'erro')),
    titulo      text not null check (char_length(trim(titulo)) between 3 and 140),
    texto       text not null default '' check (char_length(texto) <= 400),
    link        text check (link is null or link ~ '^/[A-Za-z0-9/_.?=&-]*\Z'),
    chave       text check (chave is null or char_length(chave) <= 200),
    criado_em   timestamptz not null default now(),
    check ((para = 'usuario') = (usuario_id is not null)),
    check (para not in ('usuario', 'empresa') or empresa_id is not null)
);
comment on table public.avisos is
    'Sino de avisos. Só o motor (service_role) grava. Vai para: uma pessoa, todos da empresa, a equipe ou quem cuida da qualidade.';
create unique index if not exists avisos_chave on public.avisos (chave) where chave is not null;
create index if not exists avisos_recentes on public.avisos (criado_em desc);
create index if not exists avisos_empresa on public.avisos (empresa_id, criado_em desc);

create table if not exists public.avisos_lidos (
    aviso_id    bigint not null references public.avisos (id) on delete cascade,
    usuario_id  uuid not null references auth.users (id) on delete cascade,
    lido_em     timestamptz not null default now(),
    primary key (aviso_id, usuario_id)
);

alter table public.avisos enable row level security;
alter table public.avisos_lidos enable row level security;
revoke all on public.avisos, public.avisos_lidos from anon, authenticated;
grant all on public.avisos, public.avisos_lidos to service_role;

-- quem vê o aviso: a própria pessoa; quem é da empresa (equipe MotorCob não recebe aviso de cada cliente);
-- a equipe; quem cuida da qualidade
create or replace function public.aviso_e_meu(a public.avisos) returns boolean
language sql stable security definer set search_path = public as $$
    select a.criado_em > now() - interval '90 days' and case a.para
        when 'usuario' then a.usuario_id = auth.uid()
        when 'empresa' then exists (select 1 from public.perfis p where p.id = auth.uid() and p.ativo
                                       and not p.equipe and p.empresa_id = a.empresa_id)
        when 'equipe'  then public.sou_equipe()
        when 'tecnico' then public.pode_ver_qualidade()
        else false end
$$;

create or replace function public.meus_avisos(limite int default 30)
returns table (id bigint, tipo text, titulo text, texto text, link text, criado_em timestamptz, lido boolean)
language sql stable security definer set search_path = public as $$
    select a.id, a.tipo, a.titulo, a.texto, a.link, a.criado_em,
           exists (select 1 from public.avisos_lidos l where l.aviso_id = a.id and l.usuario_id = auth.uid())
      from public.avisos a
     where public.aviso_e_meu(a)
     order by a.criado_em desc, a.id desc
     limit least(greatest(coalesce(limite, 30), 1), 100)
$$;

create or replace function public.avisos_novos() returns int
language sql stable security definer set search_path = public as $$
    select count(*)::int from public.avisos a
     where public.aviso_e_meu(a)
       and not exists (select 1 from public.avisos_lidos l where l.aviso_id = a.id and l.usuario_id = auth.uid())
$$;

-- ids nulo = marcar todos os avisos visíveis como lidos
create or replace function public.marcar_avisos_lidos(ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if auth.uid() is null then
        raise exception 'faça login';
    end if;
    insert into public.avisos_lidos (aviso_id, usuario_id)
    select a.id, auth.uid() from public.avisos a
     where public.aviso_e_meu(a) and (ids is null or a.id = any (ids))
    on conflict do nothing;
    get diagnostics n = row_count;
    return n;
end $$;

revoke all on function public.aviso_e_meu(public.avisos) from public, anon, authenticated;
do $$
declare f text;
begin
    foreach f in array array['public.meus_avisos(int)', 'public.avisos_novos()',
                             'public.marcar_avisos_lidos(bigint[])'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;

-- ================================================================ 2. alertas de qualidade viram aviso
-- O motor chama com a chave do servidor (pode_ver_qualidade aceita service_role desde o SQL 33); a tela de
-- qualidade continua só para quem cuida.
create or replace function public.gerar_avisos_qualidade() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    insert into public.avisos (para, tipo, titulo, texto, link, chave)
    select 'tecnico', case q.nivel when 'critico' then 'erro' else 'atencao' end,
           left(q.fornecedor || ' · ' || q.operadora || ': entrega ' || case q.nivel when 'critico' then 'crítica'
                else 'em atenção' end, 140),
           left(q.motivo, 400), '/console/qualidade',
           'qualidade:' || q.fornecedor || ':' || q.operadora || ':' || q.nivel || ':' || current_date
      from public.alertas_qualidade('sms') q
    on conflict (chave) where chave is not null do nothing;
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function public.gerar_avisos_qualidade() from public, anon, authenticated;
grant execute on function public.gerar_avisos_qualidade() to service_role;

-- ================================================================ 3. cores das faixas do Score no tema
insert into public.tema_tokens (chave, claro, escuro, uso) values
    ('score.alto',         '#7A2E3B', '#D07A8A', 'faixa Alto do Score de Entrega (fundo)'),
    ('score.alto_texto',   '#FFFFFF', '#1D1D1F', 'texto sobre a faixa Alto'),
    ('score.medio',        '#B9707D', '#8E4A57', 'faixa Médio do Score de Entrega (fundo)'),
    ('score.medio_texto',  '#FFFFFF', '#FFFFFF', 'texto sobre a faixa Médio'),
    ('score.baixo',        '#EBCDD2', '#4A2229', 'faixa Baixo do Score de Entrega (fundo)'),
    ('score.baixo_texto',  '#63222E', '#EDB8C2', 'texto sobre a faixa Baixo'),
    ('score.sem',          '#E5E5EA', '#3A3A3C', 'faixa Sem histórico (fundo, com o i)'),
    ('score.sem_texto',    '#3A3A3C', '#D1D1D6', 'texto sobre a faixa Sem histórico')
on conflict (chave) do update set claro = excluded.claro, escuro = excluded.escuro, uso = excluded.uso,
                                  atualizado_em = now();

-- ================================================================ 4. histórico do Score em formação
-- O Score usa o histórico de toda a Mensageria; a janela fica completa N dias depois do primeiro envio de SMS.
create or replace function public.score_formacao()
returns table (inicio date, janela_dias int, completa_em date, completa boolean)
language sql stable security definer set search_path = public as $$
    with i as (select min(m.enviado_em)::date as d
                 from public.mensageria_mensagens m join public.mensageria_lotes l on l.id = m.lote_id
                where l.canal = 'sms' and m.enviado_em is not null),
         j as (select coalesce((select c.janela_dias from public.score_config_do_item('sms') c), 30) as dias)
    select i.d, j.dias, i.d + j.dias, coalesce(current_date >= i.d + j.dias, false) from i, j
$$;
revoke all on function public.score_formacao() from public, anon;
grant execute on function public.score_formacao() to authenticated;
