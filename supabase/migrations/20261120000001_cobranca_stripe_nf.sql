-- Cobrança pelo Stripe (boleto, Pix e cartão) e nota fiscal de serviço (NFS-e nacional) pelo Focus NFe.
-- * O Stripe só recebe: gera o boleto, o Pix e a página do cartão, e avisa quando pagou (webhook). Ele NÃO emite
--   nota fiscal no Brasil; a NFS-e sai pelo Focus NFe depois do pagamento (ou na emissão da fatura, se configurado).
-- * Tudo que fala com o Stripe e o Focus NFe roda nas funções "cobranca" e "pagamentos-webhook" (chaves só nos
--   Secrets do Supabase). Este SQL guarda o resultado; ninguém do site grava nestas tabelas.
-- * cobrancas: cada boleto, Pix ou link de cartão gerado (de uma fatura ou de uma recarga). Pago = baixa sozinha
--   (fatura vira "paga"; recarga vira "paga" e entra no saldo), sem o "Marcar como paga" manual.
-- * cartoes_salvos: cartão guardado no Stripe para a recarga automática (só bandeira, final e validade aqui).
-- * notas_fiscais e nf_config: NFS-e de cada fatura ou recarga paga; os dados fiscais vêm do contador.
-- Rode DEPOIS do SQL 22. Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- cliente no Stripe (só a função lê)
create table if not exists public.cobranca_clientes (
    empresa_id    bigint primary key references public.empresas (id) on delete cascade,
    provedor      text not null default 'stripe' check (provedor = 'stripe'),
    id_externo    text not null unique check (char_length(id_externo) <= 100),
    atualizado_em timestamptz not null default now()
);
alter table public.cobranca_clientes enable row level security;
revoke all on public.cobranca_clientes from anon, authenticated;

-- ---------------------------------------------------------------- cobranças geradas
create table if not exists public.cobrancas (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    fatura_id      bigint references public.faturas (id) on delete cascade,
    recarga_id     bigint references public.recargas (id) on delete cascade,
    forma          text not null check (forma in ('boleto', 'pix', 'cartao')),
    valor          numeric(14, 2) not null check (valor > 0),
    provedor       text not null default 'stripe' check (provedor = 'stripe'),
    id_externo     text unique check (char_length(id_externo) <= 200),
    situacao       text not null default 'pendente' check (situacao in ('pendente', 'paga', 'falhou', 'expirada', 'cancelada')),
    link           text check (link ~ '^https://'),
    pix_copia_cola text check (char_length(pix_copia_cola) <= 1000),
    boleto_codigo  text check (char_length(boleto_codigo) <= 80),
    expira_em      timestamptz,
    automatica     boolean not null default false,
    motivo         text check (char_length(motivo) <= 300),
    criada_em      timestamptz not null default now(),
    paga_em        timestamptz,
    check ((fatura_id is null) <> (recarga_id is null))
);
comment on table public.cobrancas is 'Boleto, Pix ou link de cartão gerado no Stripe para uma fatura ou recarga.';
create index if not exists cobrancas_fatura on public.cobrancas (fatura_id) where fatura_id is not null;
create index if not exists cobrancas_recarga on public.cobrancas (recarga_id) where recarga_id is not null;
alter table public.cobrancas enable row level security;
drop policy if exists cobrancas_ver on public.cobrancas;
create policy cobrancas_ver on public.cobrancas for select to authenticated using (public.ve_faturamento(empresa_id));
revoke all on public.cobrancas from anon;
revoke insert, update, delete on public.cobrancas from authenticated;

-- eventos já tratados (o Stripe e o Focus podem mandar o mesmo aviso mais de uma vez)
create table if not exists public.cobranca_eventos (
    id          text primary key check (char_length(id) <= 200),
    provedor    text not null check (provedor in ('stripe', 'focusnfe')),
    tipo        text not null check (char_length(tipo) <= 100),
    recebido_em timestamptz not null default now()
);
alter table public.cobranca_eventos enable row level security;
revoke all on public.cobranca_eventos from anon, authenticated;

-- ---------------------------------------------------------------- cartão para a recarga automática
create table if not exists public.cartoes_salvos (
    id_externo  text primary key check (char_length(id_externo) <= 100),
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    bandeira    text check (char_length(bandeira) <= 30),
    final       text check (final ~ '^\d{4}$'),
    validade    text check (validade ~ '^\d{2}/\d{4}$'),
    padrao      boolean not null default true,
    criado_em   timestamptz not null default now()
);
create unique index if not exists cartoes_salvos_um_padrao on public.cartoes_salvos (empresa_id) where padrao;
alter table public.cartoes_salvos enable row level security;
drop policy if exists cartoes_salvos_ver on public.cartoes_salvos;
create policy cartoes_salvos_ver on public.cartoes_salvos for select to authenticated
    using (public.ve_faturamento(empresa_id));
revoke all on public.cartoes_salvos from anon;
revoke insert, update, delete on public.cartoes_salvos from authenticated;

-- ---------------------------------------------------------------- nota fiscal de serviço
-- código IBGE do município da empresa (tomador da nota); a função preenche pelo CEP quando estiver vazio
alter table public.empresas add column if not exists codigo_ibge int check (codigo_ibge between 1000000 and 9999999);
create table if not exists public.nf_config (
    id                                  int primary key default 1 check (id = 1),
    ativo                               boolean not null default false,
    ambiente                            text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
    emitir_quando                       text not null default 'pagamento' check (emitir_quando in ('pagamento', 'emissao')),
    cnpj_prestador                      text check (cnpj_prestador is null or public.cnpj_valido(cnpj_prestador)),
    inscricao_municipal_prestador       text check (char_length(inscricao_municipal_prestador) <= 20),
    codigo_municipio_emissora           int check (codigo_municipio_emissora between 1000000 and 9999999),
    codigo_municipio_prestacao          int check (codigo_municipio_prestacao between 1000000 and 9999999),
    codigo_tributacao_nacional_iss      text check (codigo_tributacao_nacional_iss ~ '^\d{6}$'),
    codigo_tributacao_municipal_iss     text check (codigo_tributacao_municipal_iss ~ '^\d{3}$'),
    codigo_nbs                          text check (codigo_nbs ~ '^\d{9}$'),
    codigo_opcao_simples_nacional       int not null default 1 check (codigo_opcao_simples_nacional between 1 and 3),
    regime_tributario_simples_nacional  int check (regime_tributario_simples_nacional between 1 and 3),
    regime_especial_tributacao          int not null default 0 check (regime_especial_tributacao in (0, 1, 2, 3, 4, 5, 6, 9)),
    tributacao_iss                      int not null default 1 check (tributacao_iss between 1 and 4),
    tipo_retencao_iss                   int not null default 1 check (tipo_retencao_iss between 1 and 3),
    percentual_aliquota_iss             numeric(5, 2) check (percentual_aliquota_iss between 0 and 10),
    descricao_fatura                    text not null default 'Licença de uso da plataforma MotorCX e serviços de mensageria. Ciclo {ciclo}.'
                                        check (char_length(descricao_fatura) <= 1000),
    descricao_recarga                   text not null default 'Créditos pré-pagos de uso da plataforma MotorCX.'
                                        check (char_length(descricao_recarga) <= 1000),
    atualizado_em                       timestamptz not null default now(),
    atualizado_por                      uuid default auth.uid() references auth.users (id)
);
comment on table public.nf_config is 'Dados fiscais da NFS-e (preencha com o contador). ativo = false: nenhuma nota é emitida.';
insert into public.nf_config (id) values (1) on conflict do nothing;
alter table public.nf_config enable row level security;
drop policy if exists nf_config_ver on public.nf_config;
create policy nf_config_ver on public.nf_config for select to authenticated using (public.sou_equipe());
drop policy if exists nf_config_gravar on public.nf_config;
create policy nf_config_gravar on public.nf_config for update to authenticated
    using (public.admin_equipe()) with check (public.admin_equipe());
revoke all on public.nf_config from anon;
revoke insert, delete on public.nf_config from authenticated;

create table if not exists public.notas_fiscais (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete restrict,
    fatura_id     bigint references public.faturas (id) on delete restrict,
    recarga_id    bigint references public.recargas (id) on delete restrict,
    referencia    text not null unique check (referencia ~ '^[a-z0-9_-]{3,60}$'),
    valor         numeric(14, 2) not null check (valor > 0),
    situacao      text not null default 'processando'
                  check (situacao in ('processando', 'autorizada', 'erro', 'negada', 'cancelada')),
    numero        text check (char_length(numero) <= 30),
    link_pdf      text check (link_pdf ~ '^https://'),
    link_xml      text check (link_xml ~ '^https://'),
    mensagem      text check (char_length(mensagem) <= 1000),
    criada_em     timestamptz not null default now(),
    atualizada_em timestamptz not null default now(),
    check ((fatura_id is null) <> (recarga_id is null))
);
create unique index if not exists notas_fiscais_uma_por_fatura on public.notas_fiscais (fatura_id)
    where fatura_id is not null and situacao in ('processando', 'autorizada');
create unique index if not exists notas_fiscais_uma_por_recarga on public.notas_fiscais (recarga_id)
    where recarga_id is not null and situacao in ('processando', 'autorizada');
alter table public.notas_fiscais enable row level security;
drop policy if exists notas_fiscais_ver on public.notas_fiscais;
create policy notas_fiscais_ver on public.notas_fiscais for select to authenticated
    using (public.ve_faturamento(empresa_id));
revoke all on public.notas_fiscais from anon;
revoke insert, update, delete on public.notas_fiscais from authenticated;

-- ---------------------------------------------------------------- baixa automática (só a função, com a chave do servidor)
-- Marca a cobrança como paga e dá baixa na fatura ou na recarga. Repetir o mesmo aviso não faz nada.
create or replace function public.baixar_cobranca(p_id_externo text, p_pago_em timestamptz default now())
returns table (empresa_id bigint, fatura_id bigint, recarga_id bigint, valor numeric, baixou boolean)
language plpgsql security definer set search_path = public as $$
declare
    c public.cobrancas;
    n int := 0;
begin
    update public.cobrancas x set situacao = 'paga', paga_em = coalesce(p_pago_em, now())
     where x.id_externo = p_id_externo and x.situacao <> 'paga'
    returning * into c;
    if c.id is null then
        return query select x.empresa_id, x.fatura_id, x.recarga_id, x.valor, false
                       from public.cobrancas x where x.id_externo = p_id_externo;
        return;
    end if;
    if c.fatura_id is not null then
        update public.faturas f set situacao = 'paga', paga_em = (coalesce(p_pago_em, now()) at time zone 'America/Sao_Paulo')::date
         where f.id = c.fatura_id and f.situacao in ('aberta', 'vencida');
        get diagnostics n = row_count;
    else
        update public.recargas r set situacao = 'paga', paga_em = coalesce(p_pago_em, now())
         where r.id = c.recarga_id and r.situacao = 'pendente';
        get diagnostics n = row_count;
    end if;
    -- as outras formas geradas para o mesmo pagamento deixam de valer
    update public.cobrancas x set situacao = 'cancelada', motivo = 'pago por outra forma'
     where x.situacao = 'pendente' and x.id <> c.id
       and (x.fatura_id = c.fatura_id or x.recarga_id = c.recarga_id);
    return query select c.empresa_id, c.fatura_id, c.recarga_id, c.valor, n > 0;
end $$;
revoke all on function public.baixar_cobranca(text, timestamptz) from public, anon, authenticated;
grant execute on function public.baixar_cobranca(text, timestamptz) to service_role;

-- empresas pré-pagas que precisam de recarga automática agora (o motor chama a função "cobranca" de hora em hora)
create or replace function public.recargas_automaticas_pendentes()
returns table (empresa_id bigint, valor numeric, cartao text)
language plpgsql stable security definer set search_path = public as $$
declare
    c record;
    s record;
begin
    for c in select x.* from public.ciclo_empresa x
              where x.modelo_pagamento = 'pre' and x.recarga_automatica loop
        select * into s from public.saldo_empresa(c.empresa_id);
        if s.abaixo_do_aviso
           and not exists (select 1 from public.recargas r where r.empresa_id = c.empresa_id and r.automatica
                             and (r.situacao = 'pendente' or r.pedida_em > now() - interval '1 hour')) then
            return query select c.empresa_id, c.recarga_minima,
                                (select k.id_externo from public.cartoes_salvos k
                                  where k.empresa_id = c.empresa_id and k.padrao);
        end if;
    end loop;
end $$;
revoke all on function public.recargas_automaticas_pendentes() from public, anon, authenticated;
grant execute on function public.recargas_automaticas_pendentes() to service_role;

-- o "Marcar como paga" manual continua valendo enquanto o Stripe não estiver ligado; com ele, a cobrança
-- pendente gerada para a recarga é encerrada junto
create or replace function public.cancelar_cobrancas_da_recarga() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.situacao in ('paga', 'cancelada') and old.situacao = 'pendente' then
        update public.cobrancas set situacao = 'cancelada',
               motivo = case new.situacao when 'paga' then 'baixa manual' else 'recarga cancelada' end
         where recarga_id = new.id and situacao = 'pendente';
    end if;
    return new;
end $$;
drop trigger if exists cancelar_cobrancas_da_recarga on public.recargas;
create trigger cancelar_cobrancas_da_recarga after update of situacao on public.recargas
    for each row execute function public.cancelar_cobrancas_da_recarga();
