-- SQL 41 · Tokens de API, revisão de UX (protótipo aprovado em 15/10/2026)
-- 1. Tokens saem de Minha conta e vão para Empresa › Integrações (só tela; o banco continua por empresa).
-- 2. Restrição opcional por endereço IP (faixas CIDR) e escopo novo "jornada:enviar" (cargas da Jornada: clientes,
--    contatos e leads pela API).
-- 3. Trocar token sem parar o sistema: o novo nasce com as mesmas permissões e o antigo continua valendo por 1, 7
--    (padrão) ou 14 dias; "Parar agora" encerra o antigo antes.
-- 4. Uso e erros por token (api_registros, 90 dias): método, rota, carteira, código, IP e quando — nunca o arquivo
--    nem dado de cliente. Painel da equipe no Console.
-- 5. Avisos no sino: 15 e 3 dias antes de vencer, token que parou de ser usado e token antigo de uma troca que
--    ainda estava sendo chamado quando parou.
-- 6. Revogar pela equipe: só o Master, com motivo (Auditoria e aviso ao Admin da empresa).
-- Depende dos SQL 8 (api_tokens) e 34 (avisos). Pode rodar de novo sem erro.

-- ================================================================ 1. tokens
alter table public.api_tokens add column if not exists ips cidr[];
alter table public.api_tokens add column if not exists substitui_id bigint references public.api_tokens (id) on delete set null;
alter table public.api_tokens add column if not exists substituido_por bigint references public.api_tokens (id) on delete set null;
alter table public.api_tokens add column if not exists revogado_motivo text check (revogado_motivo is null or char_length(revogado_motivo) <= 200);
comment on column public.api_tokens.ips is 'Faixas de IP liberadas (CIDR). Vazio = qualquer endereço.';
comment on column public.api_tokens.substituido_por is 'Troca de token: o novo. O antigo vale até expira_em (o fim da convivência).';
alter table public.api_tokens drop constraint if exists api_tokens_escopos_check;
alter table public.api_tokens add constraint api_tokens_escopos_check check (array_length(escopos, 1) >= 1
    and escopos <@ array['cargas:enviar', 'cargas:status', 'lista:ler', 'jornada:enviar']::text[]);
alter table public.api_tokens drop constraint if exists api_tokens_ips_check;
alter table public.api_tokens add constraint api_tokens_ips_check check (ips is null or cardinality(ips) between 1 and 20);
grant select (ips, substitui_id, substituido_por, revogado_motivo) on public.api_tokens to authenticated;

-- quem cria: o Admin (gerenciar_api) da empresa, com o módulo API ativo; até 10 ativos (o antigo de uma troca não conta)
drop function if exists public.criar_token_api(bigint, text, text[], bigint[], int);
create or replace function public.criar_token_api(empresa bigint, nome text, escopos text[], credores bigint[] default null,
                                                  dias int default 90, ips cidr[] default null)
returns text language plpgsql security definer set search_path = public as $$
declare
    token text := 'mc_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
    if not (empresa in (select public.minhas_empresas()) and public.pode('gerenciar_api')) then
        raise exception 'sem permissão para criar token de API';
    end if;
    if not exists (select 1 from public.empresa_modulos m where m.empresa_id = empresa and m.modulo = 'api' and m.ativo) then
        raise exception 'o módulo API não está ativo nesta empresa';
    end if;
    if dias is null or dias not between 1 and 365 then
        raise exception 'validade de 1 a 365 dias';
    end if;
    if credores is not null and exists (select 1 from unnest(credores) c
                                        where not exists (select 1 from public.credores x
                                                          where x.id = c and x.empresa_id = empresa)) then
        raise exception 'carteira de outra empresa';
    end if;
    if ips is not null and cardinality(ips) = 0 then
        ips := null;
    end if;
    if (select count(*) from public.api_tokens t where t.empresa_id = empresa and t.revogado_em is null
          and t.expira_em > now() and t.substituido_por is null) >= 10 then
        raise exception 'limite de 10 tokens ativos: revogue um antes';
    end if;
    insert into public.api_tokens (empresa_id, nome, prefixo, hash, escopos, credor_ids, criado_por, expira_em, ips)
    values (empresa, trim(nome), left(token, 11), encode(sha256(convert_to(token, 'UTF8')), 'hex'),
            (select array_agg(distinct e order by e) from unnest(escopos) e), credores, auth.uid(),
            now() + make_interval(days => dias), ips);
    return token;              -- única vez em que o token aparece
end $$;
revoke execute on function public.criar_token_api(bigint, text, text[], bigint[], int, cidr[]) from public, anon;
grant execute on function public.criar_token_api(bigint, text, text[], bigint[], int, cidr[]) to authenticated;

-- troca: o novo com as mesmas permissões e a mesma duração; o antigo vale mais 1, 7 ou 14 dias
create or replace function public.trocar_token_api(token_id bigint, convivencia int default 7) returns text
language plpgsql security definer set search_path = public as $$
declare
    t public.api_tokens;
    token text := 'mc_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    novo bigint;
    dias int;
begin
    select * into t from public.api_tokens x where x.id = token_id;
    if t.id is null or not (t.empresa_id in (select public.minhas_empresas()) and public.pode('gerenciar_api')) then
        raise exception 'token não encontrado';
    end if;
    if t.revogado_em is not null or t.expira_em <= now() or t.substituido_por is not null then
        raise exception 'só token ativo é trocado';
    end if;
    if convivencia not in (1, 7, 14) then
        raise exception 'o antigo continua valendo por 1, 7 ou 14 dias';
    end if;
    dias := least(365, greatest(1, ceil(extract(epoch from (t.expira_em - t.criado_em)) / 86400)::int));
    insert into public.api_tokens (empresa_id, nome, prefixo, hash, escopos, credor_ids, criado_por, expira_em, ips,
                                   substitui_id)
    values (t.empresa_id, t.nome, left(token, 11), encode(sha256(convert_to(token, 'UTF8')), 'hex'), t.escopos,
            t.credor_ids, auth.uid(), now() + make_interval(days => dias), t.ips, t.id)
    returning id into novo;
    update public.api_tokens set substituido_por = novo,
           expira_em = least(expira_em, now() + make_interval(days => convivencia))
     where id = t.id;
    return token;
end $$;
revoke execute on function public.trocar_token_api(bigint, int) from public, anon;
grant execute on function public.trocar_token_api(bigint, int) to authenticated;

-- revogar: o Admin da empresa; da equipe, só o Master e com motivo (vai para a Auditoria e para o sino do Admin)
drop function if exists public.revogar_token_api(bigint);
create or replace function public.revogar_token_api(token_id bigint, motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
    t public.api_tokens;
    m text := nullif(trim(coalesce(motivo, '')), '');
    pela_equipe boolean := public.sou_equipe();
begin
    select * into t from public.api_tokens x where x.id = token_id and x.revogado_em is null;
    if t.id is null or not t.empresa_id in (select public.minhas_empresas()) then
        raise exception 'token não encontrado ou já revogado';
    end if;
    if pela_equipe then
        if not public.admin_equipe() then
            raise exception 'na equipe, só o Master revoga token de cliente';
        end if;
        if m is null or char_length(m) < 5 then
            raise exception 'informe o motivo (incidente de segurança)';
        end if;
    elsif not public.pode('gerenciar_api') then
        raise exception 'sem permissão para revogar token';
    end if;
    update public.api_tokens set revogado_em = now(), revogado_por = auth.uid(), revogado_motivo = left(m, 200)
     where id = t.id;
    if pela_equipe then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', t.empresa_id, 'erro', left('Token de API revogado pela MotorCob: ' || t.nome, 140),
                left('Motivo: ' || m || '. O sistema que usava este token parou; crie outro em Integrações.', 400),
                '/empresa/integracoes');
    end if;
end $$;
revoke execute on function public.revogar_token_api(bigint, text) from public, anon;
grant execute on function public.revogar_token_api(bigint, text) to authenticated;

drop trigger if exists z_auditar on public.api_tokens;
create trigger z_auditar after insert or update or delete on public.api_tokens
    for each row execute function public.auditar();

-- ================================================================ 2. uso e erros
create table if not exists public.api_registros (
    id          bigint generated always as identity primary key,
    token_id    bigint not null references public.api_tokens (id) on delete cascade,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    quando      timestamptz not null default now(),
    metodo      text not null check (metodo in ('GET', 'POST')),
    rota        text not null check (rota ~ '^/v1/[a-z/{}-]{1,40}\Z'),
    carteira    text check (carteira is null or carteira ~ '^[a-z0-9][a-z0-9-]{0,39}\Z'),
    status      int not null check (status between 100 and 599),
    ip          inet,
    motivo      text check (motivo is null or char_length(motivo) <= 200)
);
comment on table public.api_registros is
    'Chamadas da API por token (90 dias): rota sem parâmetros, carteira, código, IP. Nunca o arquivo nem dado de cliente.';
create index if not exists api_registros_token on public.api_registros (token_id, quando desc);
create index if not exists api_registros_empresa on public.api_registros (empresa_id, quando desc);
alter table public.api_registros enable row level security;
drop policy if exists api_registros_ver on public.api_registros;
create policy api_registros_ver on public.api_registros for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.sou_equipe() or public.pode('gerenciar_api')));
revoke all on public.api_registros from anon;
revoke insert, update, delete on public.api_registros from authenticated;
grant select on public.api_registros to authenticated;
grant all on public.api_registros to service_role;

-- a função "api" registra cada chamada (só com a chave do servidor)
create or replace function public.registrar_chamada_api(token bigint, metodo text, rota text, carteira text, status int,
                                                        ip text default null, motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
    insert into public.api_registros (token_id, empresa_id, metodo, rota, carteira, status, ip, motivo)
    select t.id, t.empresa_id, metodo, rota, nullif(carteira, ''), status,
           case when ip ~ '^[0-9a-fA-F:.]{2,45}$' then ip::inet end, left(motivo, 200)
      from public.api_tokens t where t.id = token;
    if status < 400 then
        update public.api_tokens set ultimo_uso = now() where id = token;
    end if;
end $$;
revoke all on function public.registrar_chamada_api(bigint, text, text, text, int, text, text) from public, anon, authenticated;
grant execute on function public.registrar_chamada_api(bigint, text, text, text, int, text, text) to service_role;

-- uso por token nos últimos N dias (lista da empresa) e por dia (gráfico)
create or replace function public.uso_tokens_api(empresa bigint, dias int default 7)
returns table (token_id bigint, chamadas bigint, erros bigint, ultimo_ip text, ultima_chamada timestamptz)
language sql stable security invoker set search_path = public as $$
    select r.token_id, count(*), count(*) filter (where r.status >= 400),
           (array_agg(host(r.ip) order by r.quando desc))[1], max(r.quando)
      from public.api_registros r
     where r.empresa_id = empresa and r.quando > now() - make_interval(days => least(greatest(coalesce(dias, 7), 1), 90))
     group by r.token_id
$$;
create or replace function public.uso_token_api_dias(token bigint, dias int default 7)
returns table (dia date, chamadas bigint, erros bigint)
language sql stable security invoker set search_path = public as $$
    select d::date, count(r.id), count(r.id) filter (where r.status >= 400)
      from generate_series((now() at time zone 'America/Sao_Paulo')::date - (least(greatest(coalesce(dias, 7), 1), 90) - 1),
                           (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') d
      left join public.api_registros r on r.token_id = token
                                      and (r.quando at time zone 'America/Sao_Paulo')::date = d::date
     group by d order by d
$$;
-- Console: tokens de todas as empresas (a equipe; nunca o token)
create or replace function public.tokens_console()
returns table (empresa_id bigint, empresa text, ativos bigint, chamadas_7d bigint, erros_7d bigint,
               recusados_401_7d bigint, vence_primeiro timestamptz)
language sql stable security definer set search_path = public as $$
    select e.id, e.nome,
           (select count(*) from public.api_tokens t where t.empresa_id = e.id and t.revogado_em is null and t.expira_em > now()),
           (select count(*) from public.api_registros r where r.empresa_id = e.id and r.quando > now() - interval '7 days'),
           (select count(*) from public.api_registros r where r.empresa_id = e.id and r.quando > now() - interval '7 days'
               and r.status >= 400),
           (select count(*) from public.api_registros r where r.empresa_id = e.id and r.quando > now() - interval '7 days'
               and r.status = 401),
           (select min(t.expira_em) from public.api_tokens t where t.empresa_id = e.id and t.revogado_em is null
               and t.expira_em > now())
      from public.empresas e
     where public.sou_equipe()
       and exists (select 1 from public.api_tokens t where t.empresa_id = e.id)
     order by 5 desc, 2
$$;
revoke all on function public.uso_tokens_api(bigint, int), public.uso_token_api_dias(bigint, int),
    public.tokens_console() from public, anon;
grant execute on function public.uso_tokens_api(bigint, int), public.uso_token_api_dias(bigint, int),
    public.tokens_console() to authenticated;

-- 401 de token inexistente não tem dono: só contagem por minuto não guarda nada; registros de token apagado saem junto
create or replace function public.limpar_registros_api() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    delete from public.api_registros where quando < now() - interval '90 days';
    get diagnostics n = row_count;
    delete from public.api_chamadas where minuto < now() - interval '1 day';
    return n;
end $$;
revoke all on function public.limpar_registros_api() from public, anon, authenticated;
grant execute on function public.limpar_registros_api() to service_role;

-- ================================================================ 3. avisos no sino (motor, uma vez por dia)
create or replace function public.gerar_avisos_api() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
    -- 15 e 3 dias antes de vencer: para quem criou e para os Admins da empresa (token de troca em andamento fica de fora)
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave)
    select 'usuario', t.empresa_id, p.id, case when f.dias = 3 then 'erro' else 'atencao' end,
           left('Token de API "' || t.nome || '" vence em ' || f.dias || ' dias', 140),
           left('Vence em ' || to_char(t.expira_em at time zone 'America/Sao_Paulo', 'DD/MM') ||
                '. Use "Trocar token" para o sistema não parar (o antigo continua valendo alguns dias).', 400),
           '/empresa/integracoes', 'api_vence:' || t.id || ':' || f.dias || ':' || p.id
      from public.api_tokens t
      cross join (values (15), (3)) as f(dias)
      join public.perfis p on p.ativo and not p.equipe and p.empresa_id = t.empresa_id
                          and (p.id = t.criado_por or p.papel = 'admin')
     where t.revogado_em is null and t.substituido_por is null
       and t.expira_em > now() and t.expira_em <= now() + make_interval(days => f.dias)
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
    -- parou de chamar: usado antes e sem chamada boa há 7 dias
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'empresa', t.empresa_id, 'atencao', left('O token "' || t.nome || '" parou de ser usado', 140),
           left('A última chamada foi em ' || to_char(t.ultimo_uso at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') ||
                '. Se o sistema deveria estar enviando, veja Uso e erros.', 400),
           '/empresa/integracoes', 'api_parado:' || t.id || ':' || to_char(t.ultimo_uso, 'YYYY-MM-DD')
      from public.api_tokens t
     where t.revogado_em is null and t.expira_em > now() and t.substituido_por is null
       and t.ultimo_uso < now() - interval '7 days' and t.ultimo_uso > now() - interval '8 days'
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
    -- fim da convivência de uma troca: o antigo ainda era chamado no último dia
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'empresa', t.empresa_id, 'erro', left('O token antigo de "' || t.nome || '" parou, mas ainda era usado', 140),
           'Algum sistema continua com o token antigo e agora recebe 401. Cole o token novo nele.',
           '/empresa/integracoes', 'api_troca:' || t.id
      from public.api_tokens t
     where t.substituido_por is not null and t.revogado_em is null
       and t.expira_em <= now() and t.expira_em > now() - interval '2 days'
       and exists (select 1 from public.api_registros r where r.token_id = t.id and r.quando > t.expira_em - interval '1 day')
    on conflict (chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
    return n;
end $$;
revoke all on function public.gerar_avisos_api() from public, anon, authenticated;
grant execute on function public.gerar_avisos_api() to service_role;
