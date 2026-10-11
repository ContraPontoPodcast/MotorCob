-- Faturamento e fornecedores de mensageria.
-- * Orquestração: cada empresa tem UM modelo, escolhido na negociação:
--     por_contrato  preço por contrato distinto que passou pela plataforma no mês (com mínimo mensal opcional)
--     mensalidade   valor fixo por mês
-- * Mensageria: sempre por consumo (preço por mensagem de cada tipo: SMS, e-mail, RCS Basic/Single/
--   Conversacional, WhatsApp).
-- * contratos_mes: a rotina grava cada contrato avaliado no mês (só o código do contrato, nunca CPF ou nome);
--   a contagem do mês é o que vai para a fatura no modelo por_contrato.
-- * consumo_mensageria: quantidades do mês por tipo de mensagem (gravadas pelo envio).
-- * previa_fatura(empresa, competencia): a conta do mês, item a item. fechar_fatura(): congela a prévia numa
--   fatura (só o Admin da equipe MotorCob). Boleto e nota fiscal ficam na ferramenta de cobrança; a fatura
--   guarda o link e o código externo.
-- * mensageria_fornecedores / mensageria_rotas: Ótima, Zenvia, Infobip e Sinch, com principal e reserva por
--   canal. Credencial do fornecedor NUNCA fica no banco: só o nome do segredo (segredo_ref).
-- * permissão nova ver_faturamento (padrão: Admin e Gestão).
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- permissão ver_faturamento
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
  ('ver_faturamento',      'Administração', 'Ver faturamento',              'Plano, consumo do mês e faturas da empresa.', true, false, false, true, 13)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- quem vê o faturamento de uma empresa: a equipe MotorCob, ou o usuário da empresa com ver_faturamento
create or replace function public.ve_faturamento(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select public.sou_equipe()
        or (eid in (select public.minhas_empresas()) and public.pode('ver_faturamento'))
$$;
revoke execute on function public.ve_faturamento(bigint) from public, anon;
grant execute on function public.ve_faturamento(bigint) to authenticated;

-- ---------------------------------------------------------------- plano da empresa (negociação)
create table if not exists public.planos_empresa (
    empresa_id           bigint primary key references public.empresas (id) on delete cascade,
    orquestracao_modelo  text not null check (orquestracao_modelo in ('por_contrato', 'mensalidade')),
    orquestracao_valor   numeric(14, 4) not null check (orquestracao_valor >= 0),
    orquestracao_minimo  numeric(14, 2) not null default 0 check (orquestracao_minimo >= 0),
    vencimento_dia       int not null default 10 check (vencimento_dia between 1 and 28),
    inicio               date not null default current_date,
    observacao           text check (char_length(observacao) <= 1000),
    atualizado_em        timestamptz not null default now(),
    atualizado_por       uuid default auth.uid() references auth.users (id),
    check (orquestracao_modelo = 'por_contrato' or orquestracao_minimo = 0)
);
comment on table public.planos_empresa is 'Modelo comercial da empresa, definido na negociação.';
comment on column public.planos_empresa.orquestracao_valor is
    'por_contrato: preço por contrato distinto no mês. mensalidade: valor fixo do mês.';
comment on column public.planos_empresa.orquestracao_minimo is 'Só por_contrato: valor mínimo do mês (0 = sem mínimo).';
alter table public.planos_empresa enable row level security;
drop policy if exists planos_ver on public.planos_empresa;
create policy planos_ver on public.planos_empresa for select to authenticated using (public.ve_faturamento(empresa_id));
drop policy if exists planos_gravar on public.planos_empresa;
create policy planos_gravar on public.planos_empresa for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.planos_empresa from anon;

-- ---------------------------------------------------------------- tarifas da mensageria (preço ao cliente)
create table if not exists public.tarifas_mensageria (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    item           text not null check (item in ('sms', 'email', 'rcs_basic', 'rcs_single', 'rcs_conversacional',
                                                 'whatsapp_marketing', 'whatsapp_utilidade', 'whatsapp_servico')),
    preco          numeric(12, 5) not null check (preco >= 0),
    atualizado_em  timestamptz not null default now(),
    primary key (empresa_id, item)
);
comment on column public.tarifas_mensageria.preco is 'Preço por mensagem (RCS Conversacional: por sessão).';
alter table public.tarifas_mensageria enable row level security;
drop policy if exists tarifas_ver on public.tarifas_mensageria;
create policy tarifas_ver on public.tarifas_mensageria for select to authenticated using (public.ve_faturamento(empresa_id));
drop policy if exists tarifas_gravar on public.tarifas_mensageria;
create policy tarifas_gravar on public.tarifas_mensageria for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.tarifas_mensageria from anon;

-- ---------------------------------------------------------------- medição: contratos do mês
create table if not exists public.contratos_mes (
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    competencia  date not null check (extract(day from competencia) = 1),
    credor_id    bigint not null default 0,              -- 0 = empresa sem credores cadastrados
    contrato     text not null check (char_length(contrato) between 1 and 120),
    primeiro_dia date not null default current_date,
    primary key (empresa_id, competencia, credor_id, contrato)
);
comment on table public.contratos_mes is
    'Contratos distintos avaliados pela orquestração no mês (código do contrato; sem dado pessoal). Gravado pela rotina.';
alter table public.contratos_mes enable row level security;
drop policy if exists contratos_mes_ver on public.contratos_mes;
create policy contratos_mes_ver on public.contratos_mes for select to authenticated using (public.ve_faturamento(empresa_id));
revoke all on public.contratos_mes from anon;
revoke insert, update, delete on public.contratos_mes from authenticated;

-- ---------------------------------------------------------------- medição: mensagens do mês
create table if not exists public.consumo_mensageria (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    competencia    date not null check (extract(day from competencia) = 1),
    item           text not null check (item in ('sms', 'email', 'rcs_basic', 'rcs_single', 'rcs_conversacional',
                                                 'whatsapp_marketing', 'whatsapp_utilidade', 'whatsapp_servico')),
    quantidade     bigint not null default 0 check (quantidade >= 0),
    atualizado_em  timestamptz not null default now(),
    primary key (empresa_id, competencia, item)
);
alter table public.consumo_mensageria enable row level security;
drop policy if exists consumo_ver on public.consumo_mensageria;
create policy consumo_ver on public.consumo_mensageria for select to authenticated using (public.ve_faturamento(empresa_id));
drop policy if exists consumo_gravar on public.consumo_mensageria;
create policy consumo_gravar on public.consumo_mensageria for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.consumo_mensageria from anon;

-- consumo do mês em uma lista (contratos + mensagens), para a tela "Consumo do mês"
create or replace view public.consumo_mes with (security_invoker = true) as
select empresa_id, competencia, 'contratos'::text as item, count(*)::bigint as quantidade
  from public.contratos_mes group by empresa_id, competencia
union all
select empresa_id, competencia, item, quantidade from public.consumo_mensageria;
grant select on public.consumo_mes to authenticated;
revoke all on public.consumo_mes from anon;

-- ---------------------------------------------------------------- prévia da fatura
create or replace function public.previa_fatura(empresa bigint, competencia date)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    p public.planos_empresa;
    mes date := date_trunc('month', competencia)::date;
    n bigint;
begin
    if not public.ve_faturamento(empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    select * into p from public.planos_empresa where empresa_id = empresa;
    if found then
        if p.orquestracao_modelo = 'mensalidade' then
            return query select 1, 'orquestracao'::text, 'Orquestração · mensalidade'::text,
                                1::numeric, p.orquestracao_valor, round(p.orquestracao_valor, 2);
        else
            select count(*) into n from public.contratos_mes c where c.empresa_id = empresa and c.competencia = mes;
            return query select 1, 'orquestracao'::text, 'Orquestração · contratos no mês'::text,
                                n::numeric, p.orquestracao_valor, round(n * p.orquestracao_valor, 2);
            if p.orquestracao_minimo > round(n * p.orquestracao_valor, 2) then
                return query select 2, 'orquestracao_minimo'::text, 'Orquestração · complemento do mínimo mensal'::text,
                                    1::numeric, p.orquestracao_minimo - round(n * p.orquestracao_valor, 2),
                                    p.orquestracao_minimo - round(n * p.orquestracao_valor, 2);
            end if;
        end if;
    end if;
    return query
        select 10 + array_position(array['sms', 'email', 'rcs_basic', 'rcs_single', 'rcs_conversacional',
                                         'whatsapp_marketing', 'whatsapp_utilidade', 'whatsapp_servico'], c.item),
               c.item,
               'Mensageria · ' || case c.item when 'sms' then 'SMS' when 'email' then 'E-mail'
                    when 'rcs_basic' then 'RCS Basic' when 'rcs_single' then 'RCS Single'
                    when 'rcs_conversacional' then 'RCS Conversacional' when 'whatsapp_marketing' then 'WhatsApp marketing'
                    when 'whatsapp_utilidade' then 'WhatsApp utilidade' else 'WhatsApp serviço' end,
               c.quantidade::numeric, coalesce(t.preco, 0), round(c.quantidade * coalesce(t.preco, 0), 2)
          from public.consumo_mensageria c
          left join public.tarifas_mensageria t on t.empresa_id = c.empresa_id and t.item = c.item
         where c.empresa_id = empresa and c.competencia = mes and c.quantidade > 0;
end $$;
revoke execute on function public.previa_fatura(bigint, date) from public, anon;
grant execute on function public.previa_fatura(bigint, date) to authenticated;

-- ---------------------------------------------------------------- faturas
create table if not exists public.faturas (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete restrict,
    competencia      date not null check (extract(day from competencia) = 1),
    situacao         text not null default 'aberta' check (situacao in ('aberta', 'paga', 'vencida', 'cancelada')),
    valor_total      numeric(14, 2) not null check (valor_total >= 0),
    vencimento       date not null,
    modelo           text not null,                   -- modelo da Orquestração no fechamento
    id_externo       text check (char_length(id_externo) <= 200),    -- código na ferramenta de cobrança
    link_boleto      text check (link_boleto ~ '^https://'),
    link_nota_fiscal text check (link_nota_fiscal ~ '^https://'),
    fechada_em       timestamptz not null default now(),
    fechada_por      uuid default auth.uid() references auth.users (id),
    paga_em          date,
    unique (empresa_id, competencia)
);
create table if not exists public.fatura_itens (
    fatura_id   bigint not null references public.faturas (id) on delete cascade,
    ordem       int not null,
    item        text not null,
    descricao   text not null,
    quantidade  numeric not null,
    preco       numeric not null,
    valor       numeric(14, 2) not null,
    primary key (fatura_id, item)
);
alter table public.faturas enable row level security;
alter table public.fatura_itens enable row level security;
drop policy if exists faturas_ver on public.faturas;
create policy faturas_ver on public.faturas for select to authenticated using (public.ve_faturamento(empresa_id));
drop policy if exists faturas_atualizar on public.faturas;
create policy faturas_atualizar on public.faturas for update to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
drop policy if exists fatura_itens_ver on public.fatura_itens;
create policy fatura_itens_ver on public.fatura_itens for select to authenticated
    using (exists (select 1 from public.faturas f where f.id = fatura_id and public.ve_faturamento(f.empresa_id)));
revoke all on public.faturas, public.fatura_itens from anon;
revoke insert, delete on public.faturas from authenticated;
revoke insert, update, delete on public.fatura_itens from authenticated;
-- depois de fechada, só situação, links, código externo e data de pagamento mudam
revoke update on public.faturas from authenticated;
grant update (situacao, id_externo, link_boleto, link_nota_fiscal, paga_em) on public.faturas to authenticated;

create or replace function public.fechar_fatura(empresa bigint, competencia date) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    p public.planos_empresa;
    fid bigint;
    total numeric;
begin
    if not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCob fecha fatura';
    end if;
    if mes >= date_trunc('month', current_date)::date then
        raise exception 'só dá para fechar mês que já terminou';
    end if;
    select * into p from public.planos_empresa where empresa_id = empresa;
    if not found then
        raise exception 'empresa sem plano cadastrado';
    end if;
    if exists (select 1 from public.faturas f where f.empresa_id = empresa and f.competencia = mes) then
        raise exception 'fatura deste mês já foi fechada';
    end if;
    select coalesce(sum(v.valor), 0) into total from public.previa_fatura(empresa, mes) v;
    insert into public.faturas (empresa_id, competencia, valor_total, vencimento, modelo)
        values (empresa, mes, total, (mes + interval '1 month')::date + (p.vencimento_dia - 1), p.orquestracao_modelo)
        returning id into fid;
    insert into public.fatura_itens (fatura_id, ordem, item, descricao, quantidade, preco, valor)
        select fid, v.ordem, v.item, v.descricao, v.quantidade, v.preco, v.valor from public.previa_fatura(empresa, mes) v;
    return fid;
end $$;
revoke execute on function public.fechar_fatura(bigint, date) from public, anon;
grant execute on function public.fechar_fatura(bigint, date) to authenticated;

-- ---------------------------------------------------------------- fornecedores e rotas da mensageria
create table if not exists public.mensageria_fornecedores (
    codigo        text primary key check (codigo ~ '^[a-z0-9_]{2,30}$'),
    nome          text not null,
    canais        text[] not null default '{}'
                  check (canais <@ array['sms', 'email', 'rcs', 'whatsapp']::text[]),
    ativo         boolean not null default true,
    segredo_ref   text check (segredo_ref ~ '^[A-Za-z0-9_\-/.]{1,120}$'),
    observacao    text check (char_length(observacao) <= 1000)
);
comment on column public.mensageria_fornecedores.segredo_ref is
    'NOME do segredo com a credencial (Secret Manager / Vault). A credencial em si nunca fica no banco.';
insert into public.mensageria_fornecedores (codigo, nome, canais) values
    ('otima', 'Ótima', '{sms}'), ('zenvia', 'Zenvia', '{sms}'), ('infobip', 'Infobip', '{sms}'), ('sinch', 'Sinch', '{sms}')
on conflict (codigo) do nothing;

create table if not exists public.mensageria_rotas (
    id              bigint generated always as identity primary key,
    empresa_id      bigint references public.empresas (id) on delete cascade,   -- nulo = rota padrão
    canal           text not null check (canal in ('sms', 'email', 'rcs', 'whatsapp')),
    prioridade      int not null check (prioridade between 1 and 5),            -- 1 = principal; 2+ = reserva
    fornecedor      text not null references public.mensageria_fornecedores (codigo),
    custo_unitario  numeric(12, 5) check (custo_unitario >= 0),                -- custo MotorCob; só a equipe vê
    ativo           boolean not null default true
);
create unique index if not exists mensageria_rotas_unica
    on public.mensageria_rotas (coalesce(empresa_id, 0), canal, prioridade);

create or replace function public.validar_rota() returns trigger
language plpgsql set search_path = public as $$
begin
    if not exists (select 1 from public.mensageria_fornecedores f
                   where f.codigo = new.fornecedor and new.canal = any (f.canais)) then
        raise exception 'o fornecedor % não está habilitado para o canal %', new.fornecedor, new.canal;
    end if;
    return new;
end $$;
drop trigger if exists validar_rota on public.mensageria_rotas;
create trigger validar_rota before insert or update on public.mensageria_rotas
    for each row execute function public.validar_rota();

alter table public.mensageria_fornecedores enable row level security;
alter table public.mensageria_rotas enable row level security;
drop policy if exists fornecedores_ver on public.mensageria_fornecedores;
create policy fornecedores_ver on public.mensageria_fornecedores for select to authenticated using (public.sou_equipe());
drop policy if exists fornecedores_gravar on public.mensageria_fornecedores;
create policy fornecedores_gravar on public.mensageria_fornecedores for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
drop policy if exists rotas_ver on public.mensageria_rotas;
create policy rotas_ver on public.mensageria_rotas for select to authenticated using (public.sou_equipe());
drop policy if exists rotas_gravar on public.mensageria_rotas;
create policy rotas_gravar on public.mensageria_rotas for all to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.mensageria_fornecedores, public.mensageria_rotas from anon;

-- ---------------------------------------------------------------- auditoria das tabelas novas
do $$
declare t text;
begin
    foreach t in array array['planos_empresa', 'tarifas_mensageria', 'faturas', 'mensageria_fornecedores',
                             'mensageria_rotas'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
