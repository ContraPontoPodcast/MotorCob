-- SQL 127 · Agente de voz por minuto falado: demonstrativo por ligação e por mês, PR 6 do plano (SPEC §5.4, P12).
--
-- 1. demonstrativo_ia_voz(empresa, competencia, pagina): as ligações tarifadas do ciclo (fora o simulado), 1.000 por
--    página (o site junta as páginas para a planilha): id_chamada, dia, atendimento, início e fim da IA, retomada,
--    fim, segundos falados e tarifados, cadência, preço, valor, transferência e desfecho. Nada de telefone, máscara,
--    id_cliente ou conteúdo. Exige ve_faturamento(empresa).
-- 2. resumo_ia_voz(empresa, competencia): por dia e modelo (ligações, cobradas, segundos falados e tarifados, valor).
--    Fatura fechada: lê o que ficou congelado (P12); aberta ou sem fatura: o consumo do dia (voz_consumo_ia_dia).
-- 3. faturas_demonstrativo_voz: o resumo por dia e vigência (contrato, cadência, preço) congelado quando a fatura sai do
--    rascunho (gatilho em faturas: inserida já aberta pelo fechar_fatura, ou rascunho → aberta). fechar_fatura não é
--    recriada. As ligações já ficam congeladas em voz_chamadas (SQL 125); a planilha por ligação sai delas.
-- Depende dos SQL 125 e 126. Pode rodar de novo.

-- ================================================================ 1. resumo congelado da fatura
create table if not exists public.faturas_demonstrativo_voz (
    id                    bigint generated always as identity primary key,
    fatura_id             bigint not null references public.faturas (id) on delete cascade,
    empresa_id            bigint not null references public.empresas (id) on delete cascade,
    competencia           date not null,
    dia                   date not null,
    modelo                text not null,
    cobranca_ia_id        bigint,
    cadencia_ia           text,
    preco_minuto_ia       numeric(10, 5),
    ligacoes              int not null,
    ligacoes_cobradas     int not null,
    segundos_ia           numeric(14, 3) not null,
    segundos_ia_tarifados bigint not null,
    valor                 numeric(14, 5),
    congelado_em          timestamptz not null default now()
);
comment on table public.faturas_demonstrativo_voz is
    'Demonstrativo do minuto falado com a IA congelado quando a fatura sai do rascunho (por dia e vigência). SQL 127.';
create index if not exists faturas_demonstrativo_voz_fatura on public.faturas_demonstrativo_voz (fatura_id, dia);
alter table public.faturas_demonstrativo_voz enable row level security;
drop policy if exists faturas_demonstrativo_voz_ver on public.faturas_demonstrativo_voz;
create policy faturas_demonstrativo_voz_ver on public.faturas_demonstrativo_voz for select to authenticated
    using (public.ve_faturamento(empresa_id));
revoke all on public.faturas_demonstrativo_voz from public, anon, authenticated, service_role;
grant select on public.faturas_demonstrativo_voz to authenticated, service_role;

create or replace function public.congelar_demonstrativo_voz() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    cic record;
begin
    if new.situacao not in ('aberta', 'paga', 'vencida')
       or (tg_op = 'UPDATE' and old.situacao is not distinct from new.situacao)
       or (tg_op = 'UPDATE' and old.situacao <> 'rascunho') then
        return null;
    end if;
    cic := public.ciclo_de(new.empresa_id, new.competencia);
    delete from public.faturas_demonstrativo_voz d where d.fatura_id = new.id;
    insert into public.faturas_demonstrativo_voz (fatura_id, empresa_id, competencia, dia, modelo, cobranca_ia_id,
        cadencia_ia, preco_minuto_ia, ligacoes, ligacoes_cobradas, segundos_ia, segundos_ia_tarifados, valor)
    select new.id, new.empresa_id, new.competencia, d.dia, d.modelo, d.cobranca_ia_id, d.cadencia_ia, d.preco_minuto_ia,
           d.ligacoes, d.ligacoes_cobradas, d.segundos_ia, d.segundos_ia_tarifados, d.valor
      from public.voz_consumo_ia_dia d
     where d.empresa_id = new.empresa_id and d.dia between cic.inicio and cic.fim;
    return null;
end $$;
drop trigger if exists congelar_demonstrativo_voz on public.faturas;
create trigger congelar_demonstrativo_voz after insert or update of situacao on public.faturas
    for each row execute function public.congelar_demonstrativo_voz();

-- ================================================================ 2. leitura
create or replace function public.resumo_ia_voz(empresa bigint, competencia date)
returns table (dia date, modelo text, cadencia_ia text, preco_minuto_ia numeric, ligacoes bigint, ligacoes_cobradas bigint,
               segundos_ia numeric, segundos_ia_tarifados bigint, valor numeric, congelado boolean)
language plpgsql stable security definer set search_path = public as $$
declare
    mes date := public.competencia_de(resumo_ia_voz.empresa, resumo_ia_voz.competencia);
    cic record;
    fid bigint;
begin
    if not public.ve_faturamento(resumo_ia_voz.empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    cic := public.ciclo_de(resumo_ia_voz.empresa, mes);
    select f.id into fid from public.faturas f
     where f.empresa_id = resumo_ia_voz.empresa and f.competencia = mes and f.situacao in ('aberta', 'paga', 'vencida')
       and exists (select 1 from public.faturas_demonstrativo_voz d where d.fatura_id = f.id)
     limit 1;
    if fid is not null then
        return query
        select d.dia, d.modelo, d.cadencia_ia, d.preco_minuto_ia, sum(d.ligacoes)::bigint, sum(d.ligacoes_cobradas)::bigint,
               sum(d.segundos_ia), sum(d.segundos_ia_tarifados)::bigint, sum(d.valor), true
          from public.faturas_demonstrativo_voz d where d.fatura_id = fid
         group by d.dia, d.modelo, d.cadencia_ia, d.preco_minuto_ia
         order by d.dia, d.modelo, d.cadencia_ia, d.preco_minuto_ia;
        return;
    end if;
    return query
    select d.dia, d.modelo, d.cadencia_ia, d.preco_minuto_ia, sum(d.ligacoes)::bigint, sum(d.ligacoes_cobradas)::bigint,
           sum(d.segundos_ia), sum(d.segundos_ia_tarifados)::bigint, sum(d.valor), false
      from public.voz_consumo_ia_dia d
     where d.empresa_id = resumo_ia_voz.empresa and d.dia between cic.inicio and cic.fim
     group by d.dia, d.modelo, d.cadencia_ia, d.preco_minuto_ia
     order by d.dia, d.modelo, d.cadencia_ia, d.preco_minuto_ia;
end $$;

create or replace function public.demonstrativo_ia_voz(empresa bigint, competencia date, pagina int default 0)
returns table (id bigint, id_chamada text, dia date, atendida_em timestamptz, ia_inicio_em timestamptz,
               ia_fim_em timestamptz, ia_retomada_em timestamptz, encerrada_em timestamptz, segundos_ia numeric,
               segundos_ia_tarifados int, cadencia_ia text, preco_minuto_ia numeric, valor_ia numeric,
               transferida_em timestamptz, transferencia text, desfecho text, ia_trechos jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
    mes date := public.competencia_de(demonstrativo_ia_voz.empresa, demonstrativo_ia_voz.competencia);
    cic record;
begin
    if not public.ve_faturamento(demonstrativo_ia_voz.empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    if demonstrativo_ia_voz.pagina is null or demonstrativo_ia_voz.pagina < 0 then
        raise exception 'página inválida';
    end if;
    cic := public.ciclo_de(demonstrativo_ia_voz.empresa, mes);
    return query
    select v.id, v.id_chamada, public.dia_ia_voz(v.ia_inicio_em, v.atendida_em, v.ocorrido_em), v.atendida_em,
           v.ia_inicio_em, v.ia_fim_em, v.ia_retomada_em, v.encerrada_em, v.segundos_ia, v.segundos_ia_tarifados,
           v.cadencia_ia, v.preco_minuto_ia, v.valor_ia, v.transferida_em, v.transferencia, v.resultado, v.ia_trechos
      from public.voz_chamadas v
     where v.empresa_id = demonstrativo_ia_voz.empresa and v.ia_tarifada_em is not null and v.modo <> 'simulado'
       and v.ocorrido_em >= (cic.inicio - 1)::timestamp at time zone 'America/Sao_Paulo'
       and v.ocorrido_em < (cic.fim + 2)::timestamp at time zone 'America/Sao_Paulo'
       and public.dia_ia_voz(v.ia_inicio_em, v.atendida_em, v.ocorrido_em) between cic.inicio and cic.fim
     order by coalesce(v.ia_inicio_em, v.atendida_em, v.ocorrido_em), v.id
     limit 1000 offset demonstrativo_ia_voz.pagina * 1000;
end $$;

revoke all on function public.congelar_demonstrativo_voz() from public, anon, authenticated;
revoke all on function public.resumo_ia_voz(bigint, date), public.demonstrativo_ia_voz(bigint, date, int) from public, anon;
grant execute on function public.resumo_ia_voz(bigint, date), public.demonstrativo_ia_voz(bigint, date, int)
    to authenticated, service_role;
