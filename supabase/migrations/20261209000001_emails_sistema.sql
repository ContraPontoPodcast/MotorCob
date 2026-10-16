-- SQL 42 · E-mails do sistema (protótipo aprovado em 16/10/2026)
-- 1. email_config (Console, só o Master edita): razão social, CNPJ e endereço do rodapé, domínio dos remetentes
--    (acesso@, financeiro@, avisos@, relatorios@), e-mails da equipe (suporte, comercial, financeiro) e o resultado da
--    verificação de SPF, DKIM e DMARC que o motor faz uma vez por dia.
-- 2. Assuntos e preferências: notificacao_assuntos (catálogo; os obrigatórios não desligam) e notificacao_preferencias
--    (sino e e-mail por pessoa). minhas_notificacoes e salvar_notificacoes para Minha conta › Notificações.
-- 3. Cada aviso do sino ganha um assunto (classificado na gravação, sem mudar quem grava) e entra na fila de e-mail:
--    avisos_para_email entrega ao servidor quem recebe cada aviso por e-mail (obrigatório ou ligado pela pessoa) e
--    no máximo 1 e-mail por dia do mesmo aviso para a mesma pessoa. Sino desligado esconde o aviso opcional.
-- 4. emails_sistema: registro de cada e-mail (sem o endereço: só o hash e a forma mascarada) e as devoluções que a
--    conta de envio avisa (aplicar_retorno_email). Contato de fatura que volta de vez (ou 3 vezes seguidas, quando é
--    temporário) fica marcado em Empresa › Contatos e os Admins recebem aviso.
-- 5. emails_fatura: para quem vai a fatura (contatos que recebem faturas e não voltaram; sem nenhum, os Admins, e a
--    equipe é avisada).
-- 6. sair_email: o link "Não quero mais estes e-mails" e "Sair desta lista" do relatório, sem login.
-- 7. A equipe recebe e-mail de chamado novo ou respondido pelo cliente e de contato pelo site.
-- 8. Console: emails_console (enviados, devoluções, remetentes) e limpeza depois de 180 dias.
-- Convite, senha, senha alterada e verificação em duas etapas saem pelo Supabase Auth (SMTP próprio, modelos em
-- português): 02_supabase_painel/EMAILS_SISTEMA.md. Depende dos SQL 34 a 41. Pode rodar de novo sem erro.

-- ================================================================ 1. configuração
create table if not exists public.email_config (
    id              int primary key default 1 check (id = 1),
    dominio         text not null default 'motorcob.online' check (dominio ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'),
    razao_social    text check (razao_social is null or char_length(trim(razao_social)) between 2 and 120),
    cnpj            text check (cnpj is null or cnpj ~ '^[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2}$'),
    endereco        text check (endereco is null or char_length(trim(endereco)) between 5 and 200),
    email_suporte   text check (email_suporte is null or email_suporte ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$'),
    email_comercial text check (email_comercial is null or email_comercial ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$'),
    email_financeiro text check (email_financeiro is null or email_financeiro ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$'),
    dkim_seletor    text check (dkim_seletor is null or dkim_seletor ~ '^[A-Za-z0-9._-]{1,63}$'),
    verificacao     jsonb not null default '{}' check (jsonb_typeof(verificacao) = 'object'),
    verificado_em   timestamptz,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid
);
comment on table public.email_config is
    'E-mails do sistema: domínio dos remetentes, rodapé (razão social, CNPJ, endereço) e e-mails da equipe. Só o Master edita.';
insert into public.email_config (id) values (1) on conflict (id) do nothing;
alter table public.email_config enable row level security;
drop policy if exists email_config_ver on public.email_config;
create policy email_config_ver on public.email_config for select to authenticated using (public.sou_equipe());
revoke all on public.email_config from anon, authenticated;
grant select on public.email_config to authenticated;
grant all on public.email_config to service_role;

create or replace function public.salvar_email_config(dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
    txt text;
begin
    if not public.admin_equipe() then
        raise exception 'só o Master altera os e-mails do sistema';
    end if;
    if jsonb_typeof(dados) is distinct from 'object' then
        raise exception 'dados inválidos';
    end if;
    update public.email_config c set
        dominio          = coalesce(nullif(lower(trim(dados->>'dominio')), ''), c.dominio),
        razao_social     = case when dados ? 'razao_social' then nullif(trim(dados->>'razao_social'), '') else c.razao_social end,
        cnpj             = case when dados ? 'cnpj' then nullif(trim(dados->>'cnpj'), '') else c.cnpj end,
        endereco         = case when dados ? 'endereco' then nullif(trim(dados->>'endereco'), '') else c.endereco end,
        email_suporte    = case when dados ? 'email_suporte' then nullif(lower(trim(dados->>'email_suporte')), '') else c.email_suporte end,
        email_comercial  = case when dados ? 'email_comercial' then nullif(lower(trim(dados->>'email_comercial')), '') else c.email_comercial end,
        email_financeiro = case when dados ? 'email_financeiro' then nullif(lower(trim(dados->>'email_financeiro')), '') else c.email_financeiro end,
        dkim_seletor     = case when dados ? 'dkim_seletor' then nullif(trim(dados->>'dkim_seletor'), '') else c.dkim_seletor end,
        atualizado_em    = now(),
        atualizado_por   = auth.uid()
     where c.id = 1;
    txt := 'e-mails do sistema: ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(dados) k);
    insert into public.auditoria (usuario, tabela, acao, registro, mudou)
    values (auth.uid(), 'email_config', 'UPDATE', '1', jsonb_build_object('campos', jsonb_build_object('antes', null, 'depois', left(txt, 300))));
end $$;
revoke all on function public.salvar_email_config(jsonb) from public, anon;
grant execute on function public.salvar_email_config(jsonb) to authenticated;

-- rodapé e domínio para as funções que montam e-mail (só o servidor)
create or replace function public.email_rodape() returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object('dominio', c.dominio, 'razao_social', c.razao_social, 'cnpj', c.cnpj,
                              'endereco', c.endereco, 'email_suporte', c.email_suporte)
      from public.email_config c where c.id = 1
$$;
revoke all on function public.email_rodape() from public, anon, authenticated;
grant execute on function public.email_rodape() to service_role;

-- o motor grava o resultado da verificação do domínio (SPF, DKIM, DMARC) uma vez por dia
create or replace function public.registrar_verificacao_email(resultado jsonb) returns void
language sql security definer set search_path = public as $$
    update public.email_config set verificacao = coalesce(resultado, '{}'), verificado_em = now() where id = 1
$$;
revoke all on function public.registrar_verificacao_email(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_verificacao_email(jsonb) to service_role;

-- ================================================================ 2. assuntos e preferências
create table if not exists public.notificacao_assuntos (
    codigo            text primary key check (codigo ~ '^[a-z_]{3,30}$'),
    nome              text not null,
    descricao         text not null default '',
    sino_obrigatorio  boolean not null default false,
    email_obrigatorio boolean not null default false,
    email_padrao      boolean not null default false,
    remetente         text not null check (remetente in ('acesso', 'financeiro', 'avisos', 'relatorios')),
    requer            text,          -- null = todos · 'equipe' · 'cliente' · 'qualidade' · 'interno' · permissão de pode()
    ordem             int not null default 0
);
comment on table public.notificacao_assuntos is
    'Assuntos do sino e do e-mail. Obrigatório não desliga; "interno" vai para os e-mails da equipe (email_config).';
insert into public.notificacao_assuntos (codigo, nome, descricao, sino_obrigatorio, email_obrigatorio, email_padrao, remetente, requer, ordem) values
    ('seguranca',         'Acesso e segurança', 'Convite, senha, verificação em duas etapas', true, true, true, 'acesso', null, 10),
    ('faturas',           'Faturas, bloqueio e acordo', 'Admins e contatos que recebem faturas', true, true, true, 'financeiro', 'cliente', 20),
    ('integracoes',       'Integrações (tokens de API)', 'Vencimento em 3 dias e revogação', true, true, true, 'avisos', 'gerenciar_api', 30),
    ('pausa',             'Envios pausados', 'Saldo, bloqueio ou orçamento', true, true, true, 'avisos', 'cliente', 40),
    ('exportacoes',       'Exportações e listas prontas', 'Arquivo pronto ou com erro', true, false, false, 'avisos', 'cliente', 50),
    ('atendimento',       'Atendimento', 'Resposta judicial, conversa transferida, espera acima da meta', false, false, true, 'avisos', 'cliente', 60),
    ('qualidade',         'Qualidade e Score de Entrega', 'Alertas dos fornecedores (Técnico e Master)', false, false, false, 'avisos', 'qualidade', 70),
    ('implantacao',       'Implantação', 'Envio real liberado, pedido parado', false, false, false, 'avisos', null, 80),
    ('integracoes_aviso', 'Token de API vence em 15 dias ou ficou parado', 'O aviso de 3 dias é obrigatório', false, false, false, 'avisos', 'gerenciar_api', 90),
    ('equipe',            'Avisos da equipe MotorCX', 'Inadimplência, implantação e pedidos das empresas', false, false, false, 'avisos', 'equipe', 100),
    ('outros',            'Outros avisos', 'O que não se encaixa nos assuntos acima', false, false, false, 'avisos', null, 110),
    ('suporte',           'Chamados de suporte', 'Chamado novo ou respondido pelo cliente', true, true, true, 'avisos', 'interno', 200),
    ('comercial',         'Contato pelo site', 'Formulário do site', true, true, true, 'avisos', 'interno', 210),
    ('financeiro_equipe', 'Faturas das empresas', 'Empresa sem contato de fatura entregue', true, true, true, 'financeiro', 'interno', 220)
on conflict (codigo) do update set nome = excluded.nome, descricao = excluded.descricao,
    sino_obrigatorio = excluded.sino_obrigatorio, email_obrigatorio = excluded.email_obrigatorio,
    email_padrao = excluded.email_padrao, remetente = excluded.remetente, requer = excluded.requer, ordem = excluded.ordem;
alter table public.notificacao_assuntos enable row level security;
drop policy if exists notificacao_assuntos_ver on public.notificacao_assuntos;
create policy notificacao_assuntos_ver on public.notificacao_assuntos for select to authenticated using (true);
revoke all on public.notificacao_assuntos from anon, authenticated;
grant select on public.notificacao_assuntos to authenticated;
grant all on public.notificacao_assuntos to service_role;

create table if not exists public.notificacao_preferencias (
    usuario_id    uuid not null references auth.users (id) on delete cascade,
    assunto       text not null references public.notificacao_assuntos (codigo) on delete cascade,
    sino          boolean not null default true,
    email         boolean not null default false,
    atualizado_em timestamptz not null default now(),
    primary key (usuario_id, assunto)
);
alter table public.notificacao_preferencias enable row level security;
drop policy if exists notificacao_preferencias_ver on public.notificacao_preferencias;
create policy notificacao_preferencias_ver on public.notificacao_preferencias for select to authenticated
    using (usuario_id = auth.uid());
revoke all on public.notificacao_preferencias from anon, authenticated;
grant select on public.notificacao_preferencias to authenticated;
grant all on public.notificacao_preferencias to service_role;

-- o assunto vale para a pessoa (auth.uid())? equipe vê os seus; cliente, os da empresa e as permissões
create or replace function public.assunto_para_mim(requer text) returns boolean
language sql stable security definer set search_path = public as $$
    select case
        when requer = 'interno' then false
        when requer = 'equipe' then public.sou_equipe()
        when requer = 'qualidade' then public.pode_ver_qualidade() and auth.uid() is not null
        when requer = 'cliente' then not public.sou_equipe()
        when requer is null then true
        else not public.sou_equipe() and public.pode(requer) end
$$;
revoke all on function public.assunto_para_mim(text) from public, anon, authenticated;

create or replace function public.minhas_notificacoes()
returns table (assunto text, nome text, descricao text, sino boolean, email boolean, sino_travado boolean,
               email_travado boolean)
language sql stable security definer set search_path = public as $$
    select a.codigo, a.nome, a.descricao,
           a.sino_obrigatorio or coalesce(p.sino, true),
           a.email_obrigatorio or coalesce(p.email, a.email_padrao),
           a.sino_obrigatorio, a.email_obrigatorio
      from public.notificacao_assuntos a
      left join public.notificacao_preferencias p on p.usuario_id = auth.uid() and p.assunto = a.codigo
     where auth.uid() is not null and public.assunto_para_mim(a.requer)
     order by a.ordem
$$;

-- [{"assunto": "atendimento", "sino": true, "email": false}, ...]; o que é obrigatório é ignorado
create or replace function public.salvar_notificacoes(prefs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if auth.uid() is null then
        raise exception 'faça login';
    end if;
    if jsonb_typeof(prefs) is distinct from 'array' or jsonb_array_length(prefs) > 30 then
        raise exception 'preferências inválidas';
    end if;
    insert into public.notificacao_preferencias (usuario_id, assunto, sino, email, atualizado_em)
    select auth.uid(), a.codigo,
           a.sino_obrigatorio or coalesce((x->>'sino')::boolean, true),
           a.email_obrigatorio or coalesce((x->>'email')::boolean, a.email_padrao), now()
      from jsonb_array_elements(prefs) x
      join public.notificacao_assuntos a on a.codigo = x->>'assunto'
     where public.assunto_para_mim(a.requer) and not (a.sino_obrigatorio and a.email_obrigatorio)
    on conflict (usuario_id, assunto) do update set sino = excluded.sino, email = excluded.email,
                                                    atualizado_em = excluded.atualizado_em;
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function public.minhas_notificacoes(), public.salvar_notificacoes(jsonb) from public, anon;
grant execute on function public.minhas_notificacoes(), public.salvar_notificacoes(jsonb) to authenticated;

-- ================================================================ 3. assunto de cada aviso e fila de e-mail
do $$
begin
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'avisos' and column_name = 'email_em') then
        alter table public.avisos add column email_em timestamptz;
        update public.avisos set email_em = criado_em;      -- o que já estava no sino não vira e-mail agora
    end if;
end $$;
alter table public.avisos add column if not exists assunto text references public.notificacao_assuntos (codigo);
create index if not exists avisos_fila_email on public.avisos (id) where email_em is null;

-- de onde vem o aviso → assunto (pela chave, pelo título e pelo link; quem grava pode mandar o assunto pronto)
create or replace function public.classificar_aviso(para text, titulo text, link text, chave text) returns text
language sql immutable as $$
    select case
        when chave like 'pausa:%' then 'pausa'
        when chave ~ '^api_vence:[0-9]+:3:' then 'integracoes'
        when chave like 'api_vence:%' or chave like 'api_parado:%' or chave like 'api_troca:%' then 'integracoes_aviso'
        when titulo like 'Token de API revogado%' then 'integracoes'
        when chave like 'chamado%' then 'suporte'
        when chave like 'contato_site:%' then 'comercial'
        when chave like 'sem_contato_fatura:%' then 'financeiro_equipe'
        when para = 'tecnico' or chave like 'qualidade:%' then 'qualidade'
        when para = 'equipe' then 'equipe'
        when chave like 'judicial:%' or chave like 'espera:%' or chave like 'negocio:%' then 'atendimento'
        when chave like 'envio_real%' or chave like 'implantacao:%' then 'implantacao'
        when chave like 'exportacao%' or link like '/mensageria/%/campanhas%' then 'exportacoes'
        when link like '/empresa/faturamento%' or chave like 'email_voltou:%' then 'faturas'
        else 'outros' end
$$;

create or replace function public.aviso_assunto() returns trigger
language plpgsql as $$
begin
    new.assunto := coalesce(new.assunto, public.classificar_aviso(new.para, new.titulo, new.link, new.chave));
    return new;
end $$;
drop trigger if exists aviso_assunto on public.avisos;
create trigger aviso_assunto before insert on public.avisos for each row execute function public.aviso_assunto();
update public.avisos set assunto = public.classificar_aviso(para, titulo, link, chave) where assunto is null;

-- o sino respeita o "sino desligado" dos assuntos opcionais (o resto igual ao SQL 34)
create or replace function public.aviso_e_meu(a public.avisos) returns boolean
language sql stable security definer set search_path = public as $$
    select a.criado_em > now() - interval '90 days' and case a.para
        when 'usuario' then a.usuario_id = auth.uid()
        when 'empresa' then exists (select 1 from public.perfis p where p.id = auth.uid() and p.ativo
                                       and not p.equipe and p.empresa_id = a.empresa_id)
        when 'equipe'  then public.sou_equipe()
        when 'tecnico' then public.pode_ver_qualidade()
        else false end
       and not exists (select 1 from public.notificacao_preferencias np
                         join public.notificacao_assuntos na on na.codigo = np.assunto
                        where np.usuario_id = auth.uid() and np.assunto = a.assunto
                          and not np.sino and not na.sino_obrigatorio)
$$;
revoke all on function public.aviso_e_meu(public.avisos) from public, anon, authenticated;

-- ================================================================ 4. registro e devoluções
alter table public.empresa_contatos add column if not exists email_situacao text not null default 'ok'
    check (email_situacao in ('ok', 'voltou'));
alter table public.empresa_contatos add column if not exists email_motivo text
    check (email_motivo is null or char_length(email_motivo) <= 200);
alter table public.empresa_contatos add column if not exists email_voltou_em timestamptz;
alter table public.empresa_contatos add column if not exists email_temporarios int not null default 0;
alter table public.empresa_contatos add column if not exists email_entregue_em timestamptz;
comment on column public.empresa_contatos.email_situacao is
    'voltou = a conta de envio devolveu (definitivo, ou 3 temporários seguidos). Corrigir o e-mail volta para ok.';

-- e-mail novo começa do zero
create or replace function public.contato_email_novo() returns trigger
language plpgsql as $$
begin
    if new.email is distinct from old.email then
        new.email_situacao := 'ok';
        new.email_motivo := null;
        new.email_voltou_em := null;
        new.email_temporarios := 0;
        new.email_entregue_em := null;
    end if;
    return new;
end $$;
drop trigger if exists contato_email_novo on public.empresa_contatos;
create trigger contato_email_novo before update of email on public.empresa_contatos
    for each row execute function public.contato_email_novo();

create table if not exists public.emails_sistema (
    id                bigint generated always as identity primary key,
    criado_em         timestamptz not null default now(),
    empresa_id        bigint references public.empresas (id) on delete cascade,
    tipo              text not null check (tipo ~ '^[a-z_]{3,40}$'),
    titulo            text not null check (char_length(titulo) between 1 and 150),
    remetente         text not null check (remetente in ('acesso', 'financeiro', 'avisos', 'relatorios')),
    destino_hash      text not null check (destino_hash ~ '^[0-9a-f]{64}$'),
    destino_mascarado text not null check (char_length(destino_mascarado) <= 80),
    usuario_id        uuid references auth.users (id) on delete set null,
    contato_id        bigint references public.empresa_contatos (id) on delete set null,
    aviso_id          bigint references public.avisos (id) on delete set null,
    provedor_id       text check (provedor_id is null or char_length(provedor_id) <= 120),
    situacao          text not null default 'enviado'
                      check (situacao in ('enviado', 'aberto', 'voltou_definitivo', 'voltou_temporario', 'spam', 'erro')),
    motivo            text check (motivo is null or char_length(motivo) <= 300),
    atualizado_em     timestamptz
);
comment on table public.emails_sistema is
    'Cada e-mail do sistema (fatura, aviso, relatório). Sem o endereço: só o hash e a forma mascarada. 180 dias.';
create index if not exists emails_sistema_recentes on public.emails_sistema (criado_em desc);
create index if not exists emails_sistema_destino on public.emails_sistema (destino_hash, criado_em desc);
create unique index if not exists emails_sistema_provedor on public.emails_sistema (provedor_id) where provedor_id is not null;
alter table public.emails_sistema enable row level security;
revoke all on public.emails_sistema from anon, authenticated;
grant all on public.emails_sistema to service_role;

create or replace function public.hash_email(e text) returns text
language sql immutable as $$
    select encode(sha256(convert_to(lower(trim(e)), 'UTF8')), 'hex')
$$;
create or replace function public.mascarar_email(e text) returns text
language sql immutable as $$
    select left(split_part(lower(trim(e)), '@', 1), 1) || '***@' || left(split_part(lower(trim(e)), '@', 2), 4) || '…'
$$;

-- a função que mandou registra (um e-mail por destinatário); erro = não saiu
create or replace function public.registrar_email_sistema(empresa bigint, tipo text, titulo text, remetente text,
                                                          destino text, usuario uuid default null,
                                                          contato bigint default null, aviso bigint default null,
                                                          provedor text default null, erro text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
    insert into public.emails_sistema (empresa_id, tipo, titulo, remetente, destino_hash, destino_mascarado, usuario_id,
                                       contato_id, aviso_id, provedor_id, situacao, motivo)
    values (empresa, tipo, left(titulo, 150), remetente, public.hash_email(destino), public.mascarar_email(destino),
            usuario, contato, aviso, nullif(left(provedor, 120), ''), case when erro is null then 'enviado' else 'erro' end,
            left(erro, 300))
    on conflict (provedor_id) where provedor_id is not null do nothing
    returning id into novo;
    if erro is null and contato is not null then
        update public.empresa_contatos set email_entregue_em = now() where id = contato and email_situacao = 'ok';
    end if;
    return novo;
end $$;

-- aviso da conta de envio: bounce (permanente ou temporário), abertura ou spam
create or replace function public.aplicar_retorno_email(provedor text, evento text, bounce text default null,
                                                        motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
    e public.emails_sistema;
    c public.empresa_contatos;
    sit text;
begin
    select * into e from public.emails_sistema where provedor_id = provedor;
    if e.id is null then
        return 'desconhecido';
    end if;
    sit := case when evento = 'bounce' and bounce = 'temporario' then 'voltou_temporario'
                when evento = 'bounce' then 'voltou_definitivo'
                when evento = 'spam' then 'spam'
                when evento = 'abertura' and e.situacao = 'enviado' then 'aberto'
                else e.situacao end;
    update public.emails_sistema set situacao = sit, motivo = coalesce(left(aplicar_retorno_email.motivo, 300), emails_sistema.motivo),
                                     atualizado_em = now()
     where id = e.id;
    if e.contato_id is null or sit not in ('voltou_definitivo', 'voltou_temporario', 'aberto') then
        return sit;
    end if;
    select * into c from public.empresa_contatos where id = e.contato_id;
    if c.id is null or c.email is null or public.hash_email(c.email) <> e.destino_hash then
        return sit;                                         -- o contato mudou de e-mail depois do envio
    end if;
    if sit = 'aberto' then
        update public.empresa_contatos set email_temporarios = 0, email_entregue_em = now() where id = c.id;
        return sit;
    end if;
    update public.empresa_contatos
       set email_temporarios = case when sit = 'voltou_temporario' then email_temporarios + 1 else email_temporarios end,
           email_entregue_em = null
     where id = c.id
    returning * into c;
    if c.email_situacao = 'ok' and (sit = 'voltou_definitivo' or c.email_temporarios >= 3) then
        update public.empresa_contatos set email_situacao = 'voltou', email_voltou_em = now(),
                                           email_motivo = left(coalesce(aplicar_retorno_email.motivo, 'devolvido'), 200)
         where id = c.id;
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave, assunto)
        values ('empresa', c.empresa_id, 'erro', left('O e-mail de ' || c.nome || ' voltou', 140),
                left('O e-mail ' || e.titulo || ' não foi entregue. Confira o endereço em Empresa › Contatos.', 400),
                '/empresa/contatos', 'email_voltou:' || c.id || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
                'faturas')
        on conflict (chave) where chave is not null do nothing;
    end if;
    return sit;
end $$;

-- ================================================================ 5. para quem vai a fatura
-- Contatos que recebem faturas (sem eles, os do financeiro; sem eles, todos), menos os que voltaram. Sem nenhum
-- entregável: os Admins da empresa, e a equipe é avisada uma vez por dia.
create or replace function public.emails_fatura(empresa bigint)
returns table (email text, contato_id bigint, usuario_id uuid)
language plpgsql security definer set search_path = public as $$
declare nome_emp text;
begin
    return query
    with c as (
        select x.id, lower(trim(x.email)) as em, x.recebe_faturas, x.papel_contrato
          from public.empresa_contatos x
         where x.empresa_id = empresa and x.email is not null and x.email_situacao = 'ok'
    ), escolha as (
        select * from c where c.recebe_faturas
        union all select * from c where not exists (select 1 from c where c.recebe_faturas) and c.papel_contrato = 'financeiro'
        union all select * from c where not exists (select 1 from c where c.recebe_faturas or c.papel_contrato = 'financeiro')
    )
    select distinct on (escolha.em) escolha.em, escolha.id, null::uuid from escolha order by escolha.em, escolha.id limit 10;
    if found then
        return;
    end if;
    return query
    select distinct on (lower(u.email)) lower(u.email)::text, null::bigint, p.id
      from public.perfis p join auth.users u on u.id = p.id
     where p.empresa_id = empresa and p.ativo and not p.equipe and p.papel = 'admin' and u.email is not null
     order by lower(u.email), p.id limit 10;
    select e.nome into nome_emp from public.empresas e where e.id = empresa;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave, assunto)
    values ('equipe', empresa, 'atencao', left('Sem contato de fatura entregue · ' || coalesce(nome_emp, ''), 140),
            'Nenhum contato da empresa recebe a fatura por e-mail (sem cadastro ou devolvido). Foi para os Admins.',
            '/console/faturas', 'sem_contato_fatura:' || empresa || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
            'financeiro_equipe')
    on conflict (chave) where chave is not null do nothing;
end $$;

-- ================================================================ 3b. fila: quem recebe cada aviso por e-mail
-- Pega (e marca) os avisos das últimas 24 horas que ainda não passaram pela fila. Para cada um: obrigatório vai para
-- quem o assunto manda; opcional, só para quem ligou o e-mail (ou o padrão do assunto). O mesmo título para o mesmo
-- endereço sai no máximo 1 vez por dia.
create or replace function public.avisos_para_email(limite int default 200)
returns table (aviso_id bigint, empresa_id bigint, empresa_nome text, assunto text, assunto_nome text, obrigatorio boolean,
               remetente text, tipo text, titulo text, texto text, link text, destino text, usuario_id uuid, contato_id bigint)
language plpgsql security definer set search_path = public as $$
declare
    ids bigint[];
    cfg public.email_config;
    nf_fin text;
    r record;
    antes text := current_setting('request.jwt.claim.sub', true);
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor lê a fila de e-mail';
    end if;
    select array_agg(x.id order by x.id) into ids from (
        select a.id from public.avisos a
         where a.email_em is null and a.criado_em > now() - interval '24 hours'
         order by a.id limit least(greatest(coalesce(limite, 200), 1), 1000)
         for update skip locked) x;
    if ids is null then
        return;
    end if;
    update public.avisos set email_em = now() where id = any (ids);
    -- acordo registrado e "bloqueio em 3 dias" já têm e-mail próprio da função cobranca (acordo e lembrete do 7º dia)
    ids := array(select a.id from public.avisos a where a.id = any (ids)
                  and coalesce(a.chave, '') !~ '^(acordo|bloqueio_em_3):');
    if cardinality(ids) = 0 then
        return;
    end if;
    select * into cfg from public.email_config where id = 1;
    begin
        execute 'select email_financeiro from public.nf_config where id = 1' into nf_fin;
    exception when others then nf_fin := null;
    end;

    create temporary table if not exists _fila_email (aviso bigint, destino text, usuario uuid, contato bigint) on commit drop;
    truncate _fila_email;

    -- e-mails da equipe (assuntos internos)
    insert into _fila_email
    select a.id, d.destino, null, null
      from public.avisos a join public.notificacao_assuntos na on na.codigo = a.assunto and na.requer = 'interno'
      cross join lateral (select case a.assunto when 'suporte' then cfg.email_suporte
                                                when 'comercial' then cfg.email_comercial
                                                else coalesce(cfg.email_financeiro, nf_fin) end as destino) d
     where a.id = any (ids) and d.destino is not null;

    -- pessoas: quem o aviso alcança no sino, conforme o assunto
    insert into _fila_email
    select a.id, u.email, p.id, null
      from public.avisos a
      join public.notificacao_assuntos na on na.codigo = a.assunto and na.requer is distinct from 'interno'
      join public.perfis p on p.ativo
      join auth.users u on u.id = p.id and u.email is not null
      left join public.notificacao_preferencias np on np.usuario_id = p.id and np.assunto = a.assunto
     where a.id = any (ids) and a.para <> 'tecnico'
       and case a.para
             when 'usuario' then p.id = a.usuario_id
             when 'equipe'  then p.equipe
             when 'empresa' then not p.equipe and p.empresa_id = a.empresa_id
                                 and case a.assunto when 'faturas' then p.papel = 'admin'
                                                    when 'integracoes' then p.papel = 'admin'
                                                    when 'pausa' then p.papel in ('admin', 'planejamento')
                                                    else true end
             else false end
       and (na.email_obrigatorio or coalesce(np.email, na.email_padrao));

    -- quem cuida da qualidade (Técnico e Master), só com o e-mail ligado
    for r in select a.id as aid, u.email as em, p.id as pid
               from public.avisos a
               join public.notificacao_preferencias np on np.assunto = a.assunto and np.email
               join public.perfis p on p.id = np.usuario_id and p.ativo and p.equipe
               join auth.users u on u.id = p.id and u.email is not null
              where a.id = any (ids) and a.para = 'tecnico' loop
        perform set_config('request.jwt.claim.sub', r.pid::text, true);
        if public.admin_equipe() or public.pode_equipe('ver_qualidade') then
            insert into _fila_email values (r.aid, r.em, r.pid, null);
        end if;
    end loop;
    perform set_config('request.jwt.claim.sub', coalesce(antes, ''), true);

    -- contatos que recebem faturas, nos avisos de faturas da empresa
    insert into _fila_email
    select a.id, lower(trim(c.email)), null, c.id
      from public.avisos a
      join public.empresa_contatos c on c.empresa_id = a.empresa_id and c.recebe_faturas and c.email is not null
                                    and c.email_situacao = 'ok'
     where a.id = any (ids) and a.para = 'empresa' and a.assunto = 'faturas';

    return query
    select distinct on (a.id, lower(f.destino))
           a.id, a.empresa_id, e.nome, a.assunto, na.nome, na.email_obrigatorio, na.remetente, a.tipo, a.titulo, a.texto,
           a.link, lower(f.destino), f.usuario, f.contato
      from _fila_email f
      join public.avisos a on a.id = f.aviso
      join public.notificacao_assuntos na on na.codigo = a.assunto
      left join public.empresas e on e.id = a.empresa_id
     where not exists (select 1 from public.emails_sistema s
                        where s.destino_hash = public.hash_email(f.destino) and s.titulo = left(a.titulo, 150)
                          and s.criado_em > now() - interval '24 hours' and s.situacao <> 'erro')
     order by a.id, lower(f.destino), f.usuario nulls last;
end $$;

-- ================================================================ 6. sair sem login
-- assunto = código do assunto, ou 'relatorio:<id do envio>' para sair da lista de um relatório agendado.
-- A função "emails" confere a assinatura do link antes de chamar.
create or replace function public.sair_email(usuario uuid, assunto text) returns text
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
    a public.notificacao_assuntos;
    env public.relatorio_envios;
    nome_rel text;
begin
    if not exists (select 1 from auth.users u where u.id = usuario) then
        return 'Link inválido.';
    end if;
    if assunto ~ '^relatorio:[0-9]{1,15}$' then
        select * into env from public.relatorio_envios where id = split_part(assunto, ':', 2)::bigint;
        if env.id is null or not (usuario = any (env.destinatarios)) then
            return 'Você já não está na lista deste relatório.';
        end if;
        select m.nome into nome_rel from public.relatorios_modelos m where m.id = env.modelo_id;
        if cardinality(env.destinatarios) = 1 then
            update public.relatorio_envios set ativo = false where id = env.id;      -- a lista não fica vazia
        else
            update public.relatorio_envios set destinatarios = array_remove(destinatarios, usuario) where id = env.id;
        end if;
        return 'Você saiu da lista do relatório "' || coalesce(nome_rel, '') || '".';
    end if;
    select * into a from public.notificacao_assuntos where codigo = assunto;
    if a.codigo is null then
        return 'Link inválido.';
    end if;
    if a.email_obrigatorio then
        return 'Este e-mail é obrigatório: avisa de algo que para a operação ou mexe em acesso e pagamento.';
    end if;
    insert into public.notificacao_preferencias (usuario_id, assunto, sino, email)
    values (usuario, a.codigo, true, false)
    on conflict (usuario_id, assunto) do update set email = false, atualizado_em = now();
    return 'Pronto: você não recebe mais por e-mail "' || a.nome || '". O sino continua mostrando.';
end $$;

-- ================================================================ 7. a equipe recebe: chamados e contato do site
create or replace function public.aviso_chamado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    ch public.chamados;
    emp text;
begin
    if tg_table_name = 'chamados' then
        select e.nome into emp from public.empresas e where e.id = new.empresa_id;
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave, assunto)
        values ('equipe', new.empresa_id, case when new.prioridade = 'alta' then 'atencao' else 'pronto' end,
                left('Chamado novo · ' || coalesce(emp, '') || ': ' || new.assunto, 140),
                left('Motivo: ' || new.motivo || case when new.prioridade = 'alta' then ' · prioridade alta' else '' end, 400),
                '/console/chamados?id=' || new.id, 'chamado:' || new.id, 'suporte')
        on conflict (chave) where chave is not null do nothing;
        return new;
    end if;
    if new.tipo <> 'cliente' then
        return new;
    end if;
    select * into ch from public.chamados where id = new.chamado_id;
    if ch.id is null or ch.criado_em > now() - interval '2 minutes' then
        return new;                                        -- a 1ª mensagem chega junto com o chamado
    end if;
    select e.nome into emp from public.empresas e where e.id = ch.empresa_id;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave, assunto)
    values ('equipe', ch.empresa_id, 'pronto', left('Chamado respondido pelo cliente · ' || coalesce(emp, '') || ': ' || ch.assunto, 140),
            'Nova mensagem do cliente no chamado ' || coalesce(ch.protocolo, ch.id::text) || '.',
            '/console/chamados?id=' || ch.id, 'chamado_msg:' || new.id, 'suporte')
    on conflict (chave) where chave is not null do nothing;
    return new;
end $$;
drop trigger if exists z_aviso_chamado on public.chamados;
create trigger z_aviso_chamado after insert on public.chamados for each row execute function public.aviso_chamado();
drop trigger if exists z_aviso_chamado on public.chamado_mensagens;
create trigger z_aviso_chamado after insert on public.chamado_mensagens for each row execute function public.aviso_chamado();

-- contato pelo site: sem nome, e-mail ou telefone no aviso (só a empresa informada)
create or replace function public.aviso_contato_site() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.avisos (para, tipo, titulo, texto, link, chave, assunto)
    values ('equipe', 'pronto', left('Contato pelo site' || coalesce(' · ' || nullif(trim(new.empresa), ''), ''), 140),
            'Veja e responda pelo Console.', '/console/contatos-site', 'contato_site:' || new.id, 'comercial')
    on conflict (chave) where chave is not null do nothing;
    return new;
end $$;
drop trigger if exists z_aviso_contato_site on public.contatos_site;
create trigger z_aviso_contato_site after insert on public.contatos_site
    for each row execute function public.aviso_contato_site();

-- ================================================================ 8. Console e limpeza
create or replace function public.emails_console(dias int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    d int := least(greatest(coalesce(dias, 7), 1), 180);
    r jsonb;
begin
    if not public.sou_equipe() then
        raise exception 'só a equipe vê os e-mails do sistema';
    end if;
    with s as (select * from public.emails_sistema where criado_em > now() - make_interval(days => d))
    select jsonb_build_object(
        'enviados', (select count(*) from s where situacao <> 'erro'),
        'nao_sairam', (select count(*) from s where situacao = 'erro'),
        'voltaram_definitivo', (select count(*) from s where situacao = 'voltou_definitivo'),
        'voltaram_temporario', (select count(*) from s where situacao = 'voltou_temporario'),
        'spam', (select count(*) from s where situacao = 'spam'),
        'por_tipo', coalesce((select jsonb_agg(x order by x->>'tipo') from (
            select jsonb_build_object('tipo', tipo, 'remetente', min(remetente), 'enviados', count(*) filter (where situacao <> 'erro'),
                                      'voltaram', count(*) filter (where situacao like 'voltou%'),
                                      'nao_sairam', count(*) filter (where situacao = 'erro')) x
              from s group by tipo) t), '[]'),
        'voltaram', coalesce((select jsonb_agg(x) from (
            select jsonb_build_object('quando', s.criado_em, 'empresa', e.nome, 'tipo', s.tipo, 'titulo', s.titulo,
                                      'situacao', s.situacao, 'motivo', s.motivo,
                                      'destino', case when public.admin_equipe() then s.destino_mascarado end) x
              from s left join public.empresas e on e.id = s.empresa_id
             where s.situacao in ('voltou_definitivo', 'voltou_temporario', 'spam', 'erro')
             order by s.criado_em desc limit 100) t), '[]'),
        'dominio', (select jsonb_build_object('dominio', c.dominio, 'verificacao', c.verificacao, 'verificado_em', c.verificado_em,
                                              'rodape_completo', c.razao_social is not null and c.cnpj is not null and c.endereco is not null,
                                              'equipe_completa', c.email_suporte is not null and c.email_comercial is not null)
                      from public.email_config c where c.id = 1),
        'dias', d) into r;
    return r;
end $$;
revoke all on function public.emails_console(int) from public, anon;
grant execute on function public.emails_console(int) to authenticated;

create or replace function public.limpar_emails_sistema() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    delete from public.emails_sistema where criado_em < now() - interval '180 days';
    get diagnostics n = row_count;
    return n;
end $$;

do $$
declare f text;
begin
    foreach f in array array['public.registrar_email_sistema(bigint, text, text, text, text, uuid, bigint, bigint, text, text)',
                             'public.aplicar_retorno_email(text, text, text, text)',
                             'public.emails_fatura(bigint)', 'public.avisos_para_email(int)',
                             'public.sair_email(uuid, text)', 'public.limpar_emails_sistema()'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;
