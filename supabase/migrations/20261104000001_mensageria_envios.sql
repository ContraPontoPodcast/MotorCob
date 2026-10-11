-- Mensageria: lotes de envio da Lista do dia (SMS e e-mail), mensagens, descadastros e modelo de e-mail.
-- * O contato (telefone/e-mail) NUNCA fica no banco: só o ID do cliente, o destino mascarado
--   ("(11) 9••••-••17", "jo••@empresa.com.br") e um hash do destino normalizado (para casar descadastro).
--   O texto e o contato de cada mensagem ficam só no servidor do motor.
-- * modo 'simulado' (padrão) não fala com fornecedor nenhum e NÃO entra no consumo/fatura; 'real' só a equipe liga,
--   e só quando o adaptador do fornecedor existir.
-- * Lote nasce "aguardando aprovação" (ou "agendado", se a empresa desligar a aprovação). Quem tem
--   enviar_mensagens aprova, pausa, retoma e cancela; o motor envia dentro da janela do canal.
-- * Permissão nova enviar_mensagens (padrão: Admin e Planejamento).
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- permissão enviar_mensagens
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
  ('enviar_mensagens',     'Operação',      'Enviar mensagens',             'Aprovar, pausar, retomar e cancelar lotes da Mensageria; descadastrar contatos.', true, true, false, false, 14)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- destino normalizado: telefone só com dígitos e sem o 55 do Brasil; e-mail minúsculo e sem espaços
create or replace function public.hash_destino(canal text, destino text) returns text
language sql immutable set search_path = public as $$
    select encode(sha256(convert_to(
        case when canal = 'email' then lower(trim(destino))
             else regexp_replace(regexp_replace(destino, '\D', '', 'g'), '^55(\d{10,11})$', '\1') end, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------- configuração por empresa
create table if not exists public.mensageria_config (
    empresa_id      bigint primary key references public.empresas (id) on delete cascade,
    modo            text not null default 'simulado' check (modo in ('simulado', 'real')),
    aprovar_lotes   boolean not null default true,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id)
);
comment on column public.mensageria_config.modo is 'simulado: não fala com fornecedor nem cobra. real: só a equipe liga.';
alter table public.mensageria_config enable row level security;
drop policy if exists mensageria_config_ver on public.mensageria_config;
create policy mensageria_config_ver on public.mensageria_config for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists mensageria_config_gravar on public.mensageria_config;
create policy mensageria_config_gravar on public.mensageria_config for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.mensageria_config from anon;

-- o cliente só liga/desliga a aprovação de lote (modo é da equipe)
create or replace function public.definir_aprovacao_lotes(empresa bigint, aprovar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not (empresa in (select public.minhas_empresas()) and public.pode('enviar_mensagens')) then
        raise exception 'sem permissão para configurar a mensageria';
    end if;
    insert into public.mensageria_config (empresa_id, aprovar_lotes, atualizado_por)
    values (empresa, aprovar, auth.uid())
    on conflict (empresa_id) do update set aprovar_lotes = excluded.aprovar_lotes, atualizado_em = now(),
                                           atualizado_por = auth.uid();
end $$;
revoke execute on function public.definir_aprovacao_lotes(bigint, boolean) from public, anon;
grant execute on function public.definir_aprovacao_lotes(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------- modelo de e-mail
create table if not exists public.mensageria_modelos_email (
    empresa_id      bigint primary key references public.empresas (id) on delete cascade,
    remetente_nome  text not null check (length(trim(remetente_nome)) between 2 and 60),
    assunto         text not null check (length(trim(assunto)) between 3 and 120),
    corpo           text not null check (length(trim(corpo)) between 10 and 5000),
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id)
);
comment on table public.mensageria_modelos_email is
    'Texto do e-mail de cobrança da empresa. Única variável: {empresa} (nome da empresa). O rodapé de descadastro é automático.';
alter table public.mensageria_modelos_email enable row level security;
drop policy if exists modelos_email_ver on public.mensageria_modelos_email;
create policy modelos_email_ver on public.mensageria_modelos_email for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists modelos_email_gravar on public.mensageria_modelos_email;
create policy modelos_email_gravar on public.mensageria_modelos_email for all to authenticated
    using (empresa_id in (select public.minhas_empresas()) and public.pode('editar_canais'))
    with check (empresa_id in (select public.minhas_empresas()) and public.pode('editar_canais'));
revoke all on public.mensageria_modelos_email from anon;

-- ---------------------------------------------------------------- lotes
create table if not exists public.mensageria_lotes (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    credor_id      bigint not null default 0,              -- 0 = empresa sem credores cadastrados
    data           date not null,
    canal          text not null check (canal in ('sms', 'email')),
    modo           text not null check (modo in ('simulado', 'real')),
    situacao       text not null check (situacao in ('aguardando_aprovacao', 'agendado', 'enviando', 'pausado',
                                                     'concluido', 'cancelado')),
    total          int not null default 0,
    bloqueadas     int not null default 0,                 -- sem frase, descadastrado, sem modelo
    enviadas       int not null default 0,
    entregues      int not null default 0,
    falhas         int not null default 0,
    descadastros   int not null default 0,
    janela_inicio  text,
    janela_fim     text,
    motivo         text check (motivo is null or length(motivo) <= 300),
    aprovado_por   uuid references auth.users (id),
    aprovado_em    timestamptz,
    criado_em      timestamptz not null default now(),
    atualizado_em  timestamptz not null default now(),
    concluido_em   timestamptz,
    unique (empresa_id, credor_id, data, canal)
);
create index if not exists mensageria_lotes_empresa on public.mensageria_lotes (empresa_id, data desc);
create index if not exists mensageria_lotes_fila on public.mensageria_lotes (situacao, data)
    where situacao in ('agendado', 'enviando');
alter table public.mensageria_lotes enable row level security;
drop policy if exists lotes_ver on public.mensageria_lotes;
create policy lotes_ver on public.mensageria_lotes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.mensageria_lotes from anon;
revoke insert, update, delete on public.mensageria_lotes from authenticated;

-- aprovar · pausar · retomar · cancelar (quem tem enviar_mensagens; transições válidas só)
create or replace function public.mudar_lote(lote bigint, acao text) returns text
language plpgsql security definer set search_path = public as $$
declare
    l public.mensageria_lotes;
    nova text;
begin
    select * into l from public.mensageria_lotes where id = lote;
    if l.id is null or l.empresa_id not in (select public.minhas_empresas()) then
        raise exception 'lote não encontrado';
    end if;
    if not public.pode('enviar_mensagens') then
        raise exception 'sem permissão para enviar mensagens';
    end if;
    nova := case
        when acao = 'aprovar'  and l.situacao = 'aguardando_aprovacao'          then 'agendado'
        when acao = 'pausar'   and l.situacao in ('agendado', 'enviando')       then 'pausado'
        when acao = 'retomar'  and l.situacao = 'pausado'                       then 'agendado'
        when acao = 'cancelar' and l.situacao in ('aguardando_aprovacao', 'agendado', 'enviando', 'pausado')
                                                                               then 'cancelado'
    end;
    if nova is null then
        raise exception 'não dá para % um lote %', acao, replace(l.situacao, '_', ' ');
    end if;
    if nova = 'agendado' and l.data < (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'lote de outro dia não é enviado';
    end if;
    update public.mensageria_lotes
       set situacao = nova, atualizado_em = now(),
           aprovado_por = case when acao = 'aprovar' then auth.uid() else aprovado_por end,
           aprovado_em = case when acao = 'aprovar' then now() else aprovado_em end,
           concluido_em = case when nova = 'cancelado' then now() else concluido_em end
     where id = lote;
    return nova;
end $$;
revoke execute on function public.mudar_lote(bigint, text) from public, anon;
grant execute on function public.mudar_lote(bigint, text) to authenticated;

-- ---------------------------------------------------------------- mensagens (sem contato e sem texto)
create table if not exists public.mensageria_mensagens (
    id               bigint generated by default as identity primary key,   -- o motor atualiza em lote (upsert por id)
    lote_id          bigint not null references public.mensageria_lotes (id) on delete cascade,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    id_cliente       text not null check (char_length(id_cliente) between 1 and 80),
    destino_mascara  text not null check (char_length(destino_mascara) <= 80),
    destino_hash     text not null check (destino_hash ~ '^[0-9a-f]{64}$'),
    fornecedor       text,
    tentativas       smallint not null default 0,
    situacao         text not null default 'pendente'
                     check (situacao in ('pendente', 'enviada', 'entregue', 'falhou', 'descadastro', 'bloqueada')),
    motivo           text check (motivo is null or length(motivo) <= 200),
    id_externo       text check (id_externo is null or length(id_externo) <= 120),
    enviado_em       timestamptz,
    atualizado_em    timestamptz not null default now()
);
create index if not exists mensageria_mensagens_lote on public.mensageria_mensagens (lote_id, situacao);
create index if not exists mensageria_mensagens_destino on public.mensageria_mensagens (empresa_id, destino_hash);
alter table public.mensageria_mensagens enable row level security;
drop policy if exists mensagens_ver on public.mensageria_mensagens;
create policy mensagens_ver on public.mensageria_mensagens for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.mensageria_mensagens from anon;
revoke insert, update, delete on public.mensageria_mensagens from authenticated;

-- ---------------------------------------------------------------- descadastros
create table if not exists public.mensageria_descadastros (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    canal          text not null check (canal in ('sms', 'email', 'rcs', 'whatsapp')),
    destino_hash   text not null check (destino_hash ~ '^[0-9a-f]{64}$'),
    destino_mascara text check (char_length(destino_mascara) <= 80),
    origem         text not null check (origem in ('resposta', 'link', 'manual', 'reclamacao')),
    criado_em      timestamptz not null default now(),
    criado_por     uuid default auth.uid() references auth.users (id),
    primary key (empresa_id, canal, destino_hash)
);
alter table public.mensageria_descadastros enable row level security;
drop policy if exists descadastros_ver on public.mensageria_descadastros;
create policy descadastros_ver on public.mensageria_descadastros for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.mensageria_descadastros from anon;
revoke insert, update, delete on public.mensageria_descadastros from authenticated;

-- descadastro manual: o site manda o destino digitado; o banco guarda só o hash e a máscara
create or replace function public.descadastrar_destino(empresa bigint, canal text, destino text) returns void
language plpgsql security definer set search_path = public as $$
declare
    d text := trim(destino);
    digitos text := regexp_replace(destino, '\D', '', 'g');
begin
    if not (empresa in (select public.minhas_empresas()) and public.pode('enviar_mensagens')) then
        raise exception 'sem permissão para descadastrar';
    end if;
    if canal not in ('sms', 'email', 'rcs', 'whatsapp') then
        raise exception 'canal inválido';
    end if;
    if canal = 'email' and d !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
        raise exception 'e-mail inválido';
    end if;
    if canal <> 'email' and regexp_replace(digitos, '^55(\d{10,11})$', '\1') !~ '^\d{10,11}$' then
        raise exception 'telefone inválido';
    end if;
    insert into public.mensageria_descadastros (empresa_id, canal, destino_hash, destino_mascara, origem, criado_por)
    values (empresa, canal, public.hash_destino(canal, d),
            case when canal = 'email' then left(split_part(lower(d), '@', 1), 2) || '••@' || split_part(lower(d), '@', 2)
                 else '(' || substr(regexp_replace(digitos, '^55(\d{10,11})$', '\1'), 1, 2) || ') ••••-••'
                      || right(digitos, 2) end,
            'manual', auth.uid())
    on conflict do nothing;
end $$;
revoke execute on function public.descadastrar_destino(bigint, text, text) from public, anon;
grant execute on function public.descadastrar_destino(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------- auditoria
do $$
declare t text;
begin
    foreach t in array array['mensageria_config', 'mensageria_modelos_email', 'mensageria_lotes',
                             'mensageria_descadastros'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
