-- Emissão das faturas (uma a uma, em lote ou automática) e envio ao cliente: demonstrativo em PDF, boleto em PDF
-- separado e e-mail para os contatos financeiros.
-- * ciclo_empresa.emissao: 'revisar' (padrão; a equipe confere o rascunho e emite) ou 'automatica' (o motor gera e
--   emite no dia seguinte ao fim do ciclo).
-- * emitir_faturas(ids): emite várias de uma vez (cada uma com a mesma checagem de permissão da emissão unitária).
-- * Envio: toda fatura emitida entra na fila (faturas.envio = 'pendente'). O motor chama a função "cobranca"
--   (acao enviar_fatura), que gera o demonstrativo, o boleto e manda o e-mail; grava 'enviado' ou 'erro' com o motivo.
--   "Enviar de novo" no Console devolve a fatura para a fila.
-- * demonstrativo_fatura(id): tudo que vai no PDF (itens com o modelo de preço e as faixas, ajustes, uso por
--   carteira e a Mensageria por canal), com as mesmas permissões do faturamento.
-- * PDFs no bucket privado "faturas" (<empresa>/<fatura>.pdf); quem vê o faturamento da empresa baixa.
-- Rode DEPOIS do SQL 24. Pode ser rodado de novo sem erro.

alter table public.ciclo_empresa add column if not exists emissao text not null default 'revisar'
    check (emissao in ('revisar', 'automatica'));
comment on column public.ciclo_empresa.emissao is 'revisar: a equipe emite o rascunho · automatica: sai sozinha no fim do ciclo.';

alter table public.faturas
    add column if not exists envio text check (envio in ('pendente', 'enviando', 'enviado', 'erro')),
    add column if not exists envio_motivo text check (char_length(envio_motivo) <= 300),
    add column if not exists envio_tentativas int not null default 0,
    add column if not exists enviada_em timestamptz,
    add column if not exists enviada_para text check (char_length(enviada_para) <= 500),
    add column if not exists demonstrativo text check (demonstrativo ~ '^[0-9]+/[0-9]+\.pdf$'),
    add column if not exists boleto_pdf text check (boleto_pdf ~ '^https://');
comment on column public.faturas.envio is 'Envio ao cliente (demonstrativo, boleto e e-mail): pendente, enviando, enviado ou erro.';

-- dados do prestador que aparecem no demonstrativo (os mesmos da nota fiscal)
alter table public.nf_config
    add column if not exists razao_social_prestador text check (char_length(razao_social_prestador) <= 150),
    add column if not exists endereco_prestador text check (char_length(endereco_prestador) <= 250),
    add column if not exists email_financeiro text check (email_financeiro ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$');

-- ---------------------------------------------------------------- o servidor também gera, fecha e emite
create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare corpo text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in corpo) > 0 then return; end if;
    if position(de in corpo) = 0 then raise exception 'trecho não encontrado em %', assinatura; end if;
    execute replace(corpo, de, para);
end $$;
select pg_temp.trocar('public.gerar_rascunhos(date)',
    'if not public.admin_equipe() then', 'if auth.uid() is not null and not public.admin_equipe() then');
select pg_temp.trocar('public.fechar_fatura(bigint,date)',
    'if not public.equipe_pode(''emitir_faturas'', fechar_fatura.empresa) then',
    'if auth.uid() is not null and not public.equipe_pode(''emitir_faturas'', fechar_fatura.empresa) then');
select pg_temp.trocar('public.emitir_fatura(bigint)',
    'if not public.equipe_pode(''emitir_faturas'', (select fx.empresa_id from public.faturas fx where fx.id = emitir_fatura.fatura)) then',
    'if auth.uid() is not null and not public.equipe_pode(''emitir_faturas'', (select fx.empresa_id from public.faturas fx where fx.id = emitir_fatura.fatura)) then');
-- a emissão só exige o código de duas etapas de quem está logado; o servidor não tem login
revoke execute on function public.gerar_rascunhos(date), public.fechar_fatura(bigint, date), public.emitir_fatura(bigint)
    from public, anon;
grant execute on function public.gerar_rascunhos(date), public.fechar_fatura(bigint, date), public.emitir_fatura(bigint)
    to authenticated, service_role;

-- emitida = entra na fila de envio
create or replace function public.fatura_na_fila() returns trigger
language plpgsql as $$
begin
    if new.situacao = 'aberta' and old.situacao = 'rascunho' then
        new.envio := 'pendente';
        new.envio_motivo := null;
        new.envio_tentativas := 0;
    end if;
    return new;
end $$;
drop trigger if exists fatura_na_fila on public.faturas;
create trigger fatura_na_fila before update of situacao on public.faturas
    for each row execute function public.fatura_na_fila();

-- ---------------------------------------------------------------- em lote
create or replace function public.emitir_faturas(faturas bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare
    f bigint;
    n int := 0;
begin
    if faturas is null or cardinality(faturas) = 0 then
        raise exception 'escolha pelo menos uma fatura';
    end if;
    if cardinality(faturas) > 500 then
        raise exception 'no máximo 500 faturas por vez';
    end if;
    foreach f in array faturas loop
        perform public.emitir_fatura(f);                 -- mesma permissão e mesma regra da emissão unitária
        n := n + 1;
    end loop;
    return n;
end $$;
revoke all on function public.emitir_faturas(bigint[]) from public, anon;
grant execute on function public.emitir_faturas(bigint[]) to authenticated;

-- emissão automática: o motor chama uma vez por dia (depois de gerar_rascunhos)
create or replace function public.emitir_automaticas() returns int
language plpgsql security definer set search_path = public as $$
declare
    f record;
    n int := 0;
begin
    for f in select x.id from public.faturas x
               join public.ciclo_empresa c on c.empresa_id = x.empresa_id
              where x.situacao = 'rascunho' and c.emissao = 'automatica' and c.modelo_pagamento = 'pos'
              order by x.id loop
        perform public.emitir_fatura(f.id);
        n := n + 1;
    end loop;
    return n;
end $$;
revoke all on function public.emitir_automaticas() from public, anon, authenticated;
grant execute on function public.emitir_automaticas() to service_role;

-- "Enviar de novo" (Console): volta para a fila
create or replace function public.reenviar_fatura(fatura bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f public.faturas;
begin
    select * into f from public.faturas where id = fatura;
    if f.id is null or not public.equipe_pode('emitir_faturas', f.empresa_id) then
        raise exception 'sem permissão para enviar esta fatura';
    end if;
    if f.situacao not in ('aberta', 'vencida', 'paga') then
        raise exception 'só fatura emitida é enviada ao cliente';
    end if;
    update public.faturas set envio = 'pendente', envio_motivo = null, envio_tentativas = 0 where id = fatura;
end $$;
revoke all on function public.reenviar_fatura(bigint) from public, anon;
grant execute on function public.reenviar_fatura(bigint) to authenticated;

-- fila do motor: pega até 20 faturas para enviar (marca "enviando" para não pegar duas vezes)
create or replace function public.faturas_para_enviar() returns setof bigint
language sql security definer set search_path = public as $$
    update public.faturas set envio = 'enviando', envio_tentativas = envio_tentativas + 1
     where id in (select id from public.faturas
                   where (envio = 'pendente' or (envio = 'enviando' and envio_tentativas < 3))
                     and situacao in ('aberta', 'vencida')
                   order by id limit 20
                     for update skip locked)
    returning id
$$;
revoke all on function public.faturas_para_enviar() from public, anon, authenticated;
grant execute on function public.faturas_para_enviar() to service_role;

-- ---------------------------------------------------------------- o que vai no demonstrativo
create or replace function public.demonstrativo_fatura(fatura bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    f public.faturas;
    e public.empresas;
    ciclo record;
    nf public.nf_config;
    itens jsonb;
    ajustes jsonb;
    carteiras jsonb;
    canais jsonb;
    campanhas jsonb;
begin
    select * into f from public.faturas where id = fatura;
    if f.id is null or (auth.uid() is not null and not public.ve_faturamento(f.empresa_id)) then
        raise exception 'fatura não encontrada';
    end if;
    if f.situacao = 'rascunho' and auth.uid() is not null and not public.sou_equipe() then
        raise exception 'fatura não encontrada';
    end if;
    select * into e from public.empresas where id = f.empresa_id;
    select * into ciclo from public.ciclo_de(f.empresa_id, f.competencia);
    select * into nf from public.nf_config where id = 1;

    -- itens com o modelo de preço vigente no ciclo e as faixas
    select coalesce(jsonb_agg(jsonb_build_object(
               'ordem', i.ordem, 'item', i.item, 'descricao', i.descricao, 'quantidade', i.quantidade,
               'preco', i.preco, 'valor', i.valor,
               'grupo', case when i.item like 'orquestracao%' or i.item like 'jornada%' then 'motor' else 'mensageria' end,
               'modelo', p.modelo, 'minimo', p.minimo,
               'faixas', (select jsonb_agg(jsonb_build_object('ate', fx.ate, 'preco', fx.preco) order by fx.ate nulls last)
                            from public.precos_faixas fx where fx.preco_id = p.id))
             order by i.ordem), '[]'::jsonb)
      into itens
      from public.fatura_itens i
      left join lateral (select pv.* from public.preco_vigente(f.empresa_id,
                           case when i.item like 'orquestracao%' then 'contratos'
                                when i.item like 'jornada%' then 'jornada_clientes'
                                else regexp_replace(i.item, '_minimo$', '') end, f.competencia) pv) p on true
     where i.fatura_id = f.id;

    select coalesce(jsonb_agg(jsonb_build_object('tipo', a.tipo, 'valor', a.valor, 'motivo', a.motivo) order by a.id), '[]'::jsonb)
      into ajustes from public.fatura_ajustes a where a.fatura_id = f.id;

    select coalesce(jsonb_agg(x order by x->>'carteira'), '[]'::jsonb) into carteiras from (
        select jsonb_build_object(
                   'carteira', coalesce(cr.nome, 'Empresa'), 'frente', coalesce(cr.frente, 'motorcob'),
                   'contratos', (select count(*) from public.contratos_mes m where m.empresa_id = f.empresa_id
                                    and m.competencia = f.competencia and m.credor_id = coalesce(cr.id, 0)),
                   'clientes', (select count(*) from public.jornada_clientes_mes m where m.empresa_id = f.empresa_id
                                   and m.competencia = f.competencia and m.credor_id = coalesce(cr.id, 0)),
                   'dias', (select count(distinct a.data) from public.acoes_dia a where a.empresa_id = f.empresa_id
                               and coalesce(a.credor_id, 0) = coalesce(cr.id, 0)
                               and a.data between ciclo.inicio and ciclo.fim)) as x
          from (select id, nome, frente from public.credores where empresa_id = f.empresa_id
                union all select null, null, null
                 where not exists (select 1 from public.credores where empresa_id = f.empresa_id)) cr
    ) t where (x->>'contratos')::int + (x->>'clientes')::int + (x->>'dias')::int > 0;

    select coalesce(jsonb_agg(jsonb_build_object('canal', canal, 'disparadas', d, 'entregues', en, 'falhas', fa,
                                                 'respostas', re) order by canal), '[]'::jsonb)
      into canais from (
        select l.canal, sum(coalesce(l.disparadas, l.enviadas, 0)) d, sum(coalesce(l.entregues, 0)) en,
               sum(coalesce(l.falhas, 0)) fa, sum(coalesce(l.respostas, 0)) re
          from public.mensageria_lotes l
         where l.empresa_id = f.empresa_id and l.modo = 'real' and l.data between ciclo.inicio and ciclo.fim
         group by l.canal) c;

    select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'canal', canal, 'disparadas', d) order by origem, canal), '[]'::jsonb)
      into campanhas from (
        select coalesce(cp.nome, 'Lista do dia (Orquestração)') origem, l.canal, sum(coalesce(l.disparadas, l.enviadas, 0)) d
          from public.mensageria_lotes l
          left join public.mensageria_campanhas cp on cp.id = l.campanha_id
         where l.empresa_id = f.empresa_id and l.modo = 'real' and l.data between ciclo.inicio and ciclo.fim
         group by 1, 2) c;

    return jsonb_build_object(
        'fatura', jsonb_build_object('id', f.id, 'situacao', f.situacao, 'competencia', f.competencia,
                                     'ciclo_inicio', ciclo.inicio, 'ciclo_fim', ciclo.fim, 'emitida_em', f.emitida_em,
                                     'vencimento', f.vencimento, 'valor_total', f.valor_total),
        'prestador', jsonb_build_object('razao_social', coalesce(nf.razao_social_prestador, 'MotorCX'),
                                        'cnpj', nf.cnpj_prestador, 'endereco', nf.endereco_prestador,
                                        'email', nf.email_financeiro),
        'cliente', jsonb_build_object('razao_social', coalesce(e.razao_social, e.nome), 'cnpj', e.cnpj,
                                      'endereco', concat_ws(' · ', nullif(concat_ws(', ', e.logradouro, e.numero), ''),
                                                            e.complemento, e.bairro,
                                                            nullif(concat_ws(' · ', e.municipio, e.uf), ''),
                                                            case when e.cep ~ '^\d{8}$' then substr(e.cep, 1, 5) || '-' || substr(e.cep, 6) end)),
        'frentes', (select coalesce(jsonb_agg(ef.frente order by ef.frente), '[]'::jsonb) from public.empresa_frentes ef
                     where ef.empresa_id = f.empresa_id and ef.ativo),
        'itens', itens, 'ajustes', ajustes, 'carteiras', carteiras, 'canais', canais, 'campanhas', campanhas);
end $$;
revoke all on function public.demonstrativo_fatura(bigint) from public, anon;
grant execute on function public.demonstrativo_fatura(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- PDFs no bucket privado
insert into storage.buckets (id, name, public) values ('faturas', 'faturas', false)
on conflict (id) do update set public = false;
drop policy if exists faturas_pdf_ver on storage.objects;
create policy faturas_pdf_ver on storage.objects for select to authenticated
    using (bucket_id = 'faturas' and (storage.foldername(name))[1] ~ '^[0-9]+$'
           and public.ve_faturamento(((storage.foldername(name))[1])::bigint));
