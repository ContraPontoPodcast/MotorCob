-- API das cargas: tokens com escopo para o sistema do cliente enviar cargas e ler a Lista do dia.
-- * O token aparece UMA vez, na criação. O banco guarda só o hash (sha256) e o prefixo para reconhecer.
-- * Escopos: cargas:enviar · cargas:status · lista:ler. Pode ser limitado a credores. Vence em até 365 dias.
-- * Só com o módulo API ativo e a permissão nova gerenciar_api (padrão: só Admin). Máximo 10 tokens ativos.
-- * A Edge Function "api" (com a chave do servidor) confere o token, o escopo, o credor e o limite por minuto,
--   e entra pelo mesmo caminho do envio pelo site (bucket entradas + tabela envios).
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- permissão gerenciar_api
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
  ('gerenciar_api',        'Administração', 'Gerenciar tokens de API',      'Criar e revogar os tokens que o sistema da empresa usa na API.', true, false, false, false, 15)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- ---------------------------------------------------------------- tokens
create table if not exists public.api_tokens (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    nome          text not null check (length(trim(nome)) between 2 and 60),
    prefixo       text not null check (prefixo ~ '^mc_[0-9a-f]{8}$'),
    hash          text not null unique check (hash ~ '^[0-9a-f]{64}$'),
    escopos       text[] not null check (array_length(escopos, 1) >= 1
                  and escopos <@ array['cargas:enviar', 'cargas:status', 'lista:ler']::text[]),
    credor_ids    bigint[],                                -- nulo = todos os credores da empresa
    criado_por    uuid not null references auth.users (id),
    criado_em     timestamptz not null default now(),
    expira_em     timestamptz not null,
    ultimo_uso    timestamptz,
    revogado_em   timestamptz,
    revogado_por  uuid references auth.users (id)
);
create index if not exists api_tokens_empresa on public.api_tokens (empresa_id);
alter table public.api_tokens enable row level security;
drop policy if exists api_tokens_ver on public.api_tokens;
create policy api_tokens_ver on public.api_tokens for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.sou_equipe() or public.pode('gerenciar_api')));
revoke all on public.api_tokens from anon, authenticated;
-- o hash nunca sai para o site
grant select (id, empresa_id, nome, prefixo, escopos, credor_ids, criado_por, criado_em, expira_em, ultimo_uso,
              revogado_em, revogado_por) on public.api_tokens to authenticated;

create or replace function public.criar_token_api(empresa bigint, nome text, escopos text[],
                                                  credores bigint[] default null, dias int default 90)
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
        raise exception 'credor de outra empresa';
    end if;
    if (select count(*) from public.api_tokens t where t.empresa_id = empresa and t.revogado_em is null
          and t.expira_em > now()) >= 10 then
        raise exception 'limite de 10 tokens ativos: revogue um antes';
    end if;
    insert into public.api_tokens (empresa_id, nome, prefixo, hash, escopos, credor_ids, criado_por, expira_em)
    values (empresa, trim(nome), left(token, 11), encode(sha256(convert_to(token, 'UTF8')), 'hex'),
            (select array_agg(distinct e order by e) from unnest(escopos) e), credores, auth.uid(),
            now() + make_interval(days => dias));
    return token;              -- única vez em que o token aparece
end $$;
revoke execute on function public.criar_token_api(bigint, text, text[], bigint[], int) from public, anon;
grant execute on function public.criar_token_api(bigint, text, text[], bigint[], int) to authenticated;

create or replace function public.revogar_token_api(token_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
    update public.api_tokens set revogado_em = now(), revogado_por = auth.uid()
     where id = token_id and revogado_em is null
       and empresa_id in (select public.minhas_empresas()) and (public.sou_equipe() or public.pode('gerenciar_api'));
    if not found then
        raise exception 'token não encontrado ou já revogado';
    end if;
end $$;
revoke execute on function public.revogar_token_api(bigint) from public, anon;
grant execute on function public.revogar_token_api(bigint) to authenticated;

-- ---------------------------------------------------------------- limite por minuto (só a Edge Function usa)
create table if not exists public.api_chamadas (
    token_id  bigint not null references public.api_tokens (id) on delete cascade,
    minuto    timestamptz not null,
    n         int not null default 0,
    primary key (token_id, minuto)
);
alter table public.api_chamadas enable row level security;
revoke all on public.api_chamadas from anon, authenticated;

create or replace function public.contar_chamada_api(token bigint) returns int
language sql security definer set search_path = public as $$
    insert into public.api_chamadas (token_id, minuto, n) values (token, date_trunc('minute', now()), 1)
    on conflict (token_id, minuto) do update set n = public.api_chamadas.n + 1
    returning n;
$$;
revoke execute on function public.contar_chamada_api(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- auditoria (sem o hash do token)
create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    a jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    d jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
    ruido constant text[] := array['atualizado_em', 'atualizado_por', 'visto_em', 'qtd', 'primeira_vez', 'ultima_vez',
                                   'sugerido', 'cabecalho', 'arquivo', 'criado_em', 'hash', 'ultimo_uso'];
    so_perfis constant text[] := array['papel', 'ativo', 'nome', 'empresa_id', 'equipe'];
    mudou jsonb := '{}';
    k text;
begin
    if auth.uid() is null then
        return coalesce(new, old);       -- a rotina do motor não entra na auditoria
    end if;
    for k in select jsonb_object_keys(coalesce(d, a)) loop
        continue when k = any (ruido);
        continue when tg_table_name = 'perfis' and not (k = any (so_perfis));   -- sem e-mail no histórico
        if tg_op = 'UPDATE' and (a -> k) is not distinct from (d -> k) then
            continue;
        end if;
        mudou := mudou || jsonb_build_object(k, jsonb_build_object('antes', a -> k, 'depois', d -> k));
    end loop;
    if tg_op = 'UPDATE' and mudou = '{}' then
        return new;
    end if;
    insert into public.auditoria (empresa_id, usuario, tabela, acao, registro, mudou)
    values (coalesce((coalesce(d, a) ->> 'empresa_id')::bigint,
                     case when tg_table_name = 'empresas' then (coalesce(d, a) ->> 'id')::bigint end),
            auth.uid(), tg_table_name, tg_op,
            coalesce(coalesce(d, a) ->> 'id', coalesce(d, a) ->> 'codigo', coalesce(d, a) ->> 'permissao'), mudou);
    return coalesce(new, old);
end $$;
drop trigger if exists z_auditar on public.api_tokens;
create trigger z_auditar after insert or update or delete on public.api_tokens
    for each row execute function public.auditar();
