-- SQL 126 · Agente de voz por minuto falado: consumo do dia e fatura, PR 5 do plano (SPEC §5.3, P5, P6, P7, P9, P10).
--
-- 1. voz_consumo_ia_dia: por empresa × dia (America/Sao_Paulo, do início da IA) × contrato × cadência × preço:
--    ligações, ligações cobradas (tarifados > 0), segundos falados, tarifados, sessão do provedor e valor. Recalculado
--    a partir de voz_chamadas (só as tarifadas, fora o modo simulado) pelo gatilho de instrução em voz_chamadas (uma
--    vez por lote da VM, para os dias tocados) e por consolidar_consumo_voz (recriada inteira: a telefonia de sempre +
--    este). Só o servidor grava; a equipe com ver_faturamento e o cliente com ve_faturamento leem a da empresa.
-- 2. Custo para a margem: a diferença de cada recálculo vai para consumo_ia (voz_minuto_ia: quantidade = tarifados ÷ 60,
--    custo = sessão do provedor ÷ 60 × custo do minuto de IA do dia, que inclui o toque da ponte, P4), sem faturar: a
--    fatura não lê consumo_mensageria para o minuto falado (quantidade inteira não cabe os segundos, F8).
-- 3. previa_fatura recriada INTEIRA a partir da versão em produção (SQL 98; nada a recriou depois na pilha). Para o
--    ciclo com contrato por minuto (cobranca_ia_ciclo):
--      uma linha "Agente de voz — minutos tarifados × preço" por cadência e preço (vigências do ciclo; itens
--      voz_minuto_ia, voz_minuto_ia_2…), quantidade = Σ tarifados ÷ 60 (2 casas), valor = round(Σ tarifados × preço ÷
--      60, 2) (P5: arredonda só no total);
--      com franquia N (P6): "franquia de N min" = N × preço (sempre) e o excedente = max(0, minutos − N) × preço (o
--      preço que vale no fim do ciclo); o mínimo mensal do voz_minuto_ia não vale com franquia;
--      sem franquia, o mínimo mensal do preço da empresa (precos_empresa.minimo) vale como antes (complemento);
--      voz_minuto_ia_pico não entra (P9) e a licença (robôs) não é cobrada nesse ciclo (P8).
--    Licença: igual ao SQL 98; a franquia passa a contar também os minutos falados medidos (ceil dos segundos, P7):
--    linhas_fatura_minuto_ia_voz recriada inteira. Quem não tem contrato (legado): nada muda.
-- 4. margem_ia recriada inteira (estado atual: SQL 61): no voz_minuto_ia por minuto a quantidade vem do consumo_ia e a
--    receita é Σ valor das ligações do mês; a situação "abaixo_minimo" usa a mínima do item (SQL 124).
-- Recriadas inteiras: consolidar_consumo_voz, previa_fatura, linhas_fatura_minuto_ia_voz e margem_ia. Se o SQL 56, 61,
-- 69, 78 ou 98 rodarem de novo, rode este depois. Depende dos SQL 98, 123, 124 e 125. Pode rodar de novo.

-- ================================================================ 1. consumo do dia
create table if not exists public.voz_consumo_ia_dia (
    id                    bigint generated always as identity primary key,
    empresa_id            bigint not null references public.empresas (id) on delete cascade,
    dia                   date not null,
    cobranca_ia_id        bigint references public.voz_cobranca_ia (id) on delete set null,
    modelo                text not null check (modelo in ('por_minuto', 'licenca', 'legado')),
    cadencia_ia           text,
    preco_minuto_ia       numeric(10, 5),
    ligacoes              int not null default 0,
    ligacoes_cobradas     int not null default 0,
    segundos_ia           numeric(14, 3) not null default 0,
    segundos_ia_tarifados bigint not null default 0,
    segundos_sessao_ia    numeric(14, 3) not null default 0,
    valor                 numeric(14, 5),
    atualizado_em         timestamptz not null default now()
);
comment on table public.voz_consumo_ia_dia is
    'Minuto falado com a IA por empresa, dia (America/Sao_Paulo), contrato, cadência e preço. Recalculado de '
    'voz_chamadas (gatilho e consolidar_consumo_voz). Só o servidor grava. SQL 126.';
create unique index if not exists voz_consumo_ia_dia_chave on public.voz_consumo_ia_dia
    (empresa_id, dia, coalesce(cobranca_ia_id, 0), modelo, coalesce(cadencia_ia, ''), coalesce(preco_minuto_ia, -1));
alter table public.voz_consumo_ia_dia enable row level security;
drop policy if exists voz_consumo_ia_dia_ver on public.voz_consumo_ia_dia;
create policy voz_consumo_ia_dia_ver on public.voz_consumo_ia_dia for select to authenticated
    using (public.ve_faturamento(empresa_id));
revoke all on public.voz_consumo_ia_dia from public, anon, authenticated, service_role;
grant select on public.voz_consumo_ia_dia to authenticated, service_role;

-- dia da ligação para o consumo (o do início da IA; sem IA, o do atendimento)
create or replace function public.dia_ia_voz(ia_inicio_em timestamptz, atendida_em timestamptz, ocorrido_em timestamptz)
returns date
language sql immutable parallel safe set search_path = '' as $$
    select (coalesce(ia_inicio_em, atendida_em, ocorrido_em) at time zone 'America/Sao_Paulo')::date
$$;

-- recalcula o dia da empresa e espelha a diferença de quantidade e custo em consumo_ia (margem)
create or replace function public.consolidar_consumo_ia_voz(empresa bigint, dia date) returns int
language plpgsql security definer set search_path = public as $$
declare
    antes_t numeric; antes_s numeric; depois_t numeric; depois_s numeric;
    dq numeric; ds numeric; custo_dia numeric;
    n int;
begin
    select coalesce(sum(d.segundos_ia_tarifados), 0), coalesce(sum(d.segundos_sessao_ia), 0) into antes_t, antes_s
      from public.voz_consumo_ia_dia d where d.empresa_id = consolidar_consumo_ia_voz.empresa and d.dia = consolidar_consumo_ia_voz.dia;
    delete from public.voz_consumo_ia_dia d
     where d.empresa_id = consolidar_consumo_ia_voz.empresa and d.dia = consolidar_consumo_ia_voz.dia;
    insert into public.voz_consumo_ia_dia (empresa_id, dia, cobranca_ia_id, modelo, cadencia_ia, preco_minuto_ia, ligacoes,
                                           ligacoes_cobradas, segundos_ia, segundos_ia_tarifados, segundos_sessao_ia, valor)
    select consolidar_consumo_ia_voz.empresa, consolidar_consumo_ia_voz.dia, v.cobranca_ia_id,
           case when v.cadencia_ia is null then 'licenca' when v.valor_ia is null then 'legado' else 'por_minuto' end,
           v.cadencia_ia, v.preco_minuto_ia, count(*), count(*) filter (where v.segundos_ia_tarifados > 0),
           coalesce(sum(v.segundos_ia), 0), coalesce(sum(v.segundos_ia_tarifados), 0), coalesce(sum(v.segundos_sessao_ia), 0),
           sum(v.valor_ia)
      from public.voz_chamadas v
     where v.empresa_id = consolidar_consumo_ia_voz.empresa and v.ia_tarifada_em is not null and v.modo <> 'simulado'
       and v.ocorrido_em >= (consolidar_consumo_ia_voz.dia - 1)::timestamp at time zone 'America/Sao_Paulo'
       and v.ocorrido_em < (consolidar_consumo_ia_voz.dia + 1)::timestamp at time zone 'America/Sao_Paulo'
       and public.dia_ia_voz(v.ia_inicio_em, v.atendida_em, v.ocorrido_em) = consolidar_consumo_ia_voz.dia
     group by v.cobranca_ia_id, 4, v.cadencia_ia, v.preco_minuto_ia;
    get diagnostics n = row_count;
    select coalesce(sum(d.segundos_ia_tarifados), 0), coalesce(sum(d.segundos_sessao_ia), 0) into depois_t, depois_s
      from public.voz_consumo_ia_dia d where d.empresa_id = consolidar_consumo_ia_voz.empresa and d.dia = consolidar_consumo_ia_voz.dia;
    dq := depois_t - antes_t;
    ds := depois_s - antes_s;
    if (dq <> 0 or ds <> 0) and exists (select 1 from public.cobranca_itens i where i.codigo = 'voz_minuto_ia' and i.eh_ia) then
        custo_dia := public.custo_ia_vigente('voz_minuto_ia', consolidar_consumo_ia_voz.dia);
        insert into public.consumo_ia as x (empresa_id, competencia, item, quantidade, tokens, custo, registros, sem_custo)
        values (consolidar_consumo_ia_voz.empresa, date_trunc('month', consolidar_consumo_ia_voz.dia)::date, 'voz_minuto_ia',
                greatest(dq / 60.0, 0), 0, greatest(round(coalesce(ds / 60.0 * custo_dia, 0), 5), 0), 1,
                case when custo_dia is null and ds > 0 then 1 else 0 end)
        on conflict (empresa_id, competencia, item) do update
            set quantidade = greatest(x.quantidade + dq / 60.0, 0),
                custo = greatest(x.custo + round(coalesce(ds / 60.0 * custo_dia, 0), 5), 0),
                registros = x.registros + 1, sem_custo = x.sem_custo + excluded.sem_custo, atualizado_em = now();
    end if;
    return n;
end $$;

-- gatilho de instrução: uma vez por lote da VM, para cada empresa × dia tocado
create or replace function public.consumo_ia_voz_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    r record;
begin
    for r in select distinct n.empresa_id, public.dia_ia_voz(n.ia_inicio_em, n.atendida_em, n.ocorrido_em) as dia
               from novas n where n.ia_tarifada_em is not null and n.modo <> 'simulado' loop
        perform public.consolidar_consumo_ia_voz(r.empresa_id, r.dia);
    end loop;
    return null;
end $$;
drop trigger if exists consumo_ia_voz_inserir on public.voz_chamadas;
create trigger consumo_ia_voz_inserir after insert on public.voz_chamadas
    referencing new table as novas for each statement execute function public.consumo_ia_voz_gatilho();
drop trigger if exists consumo_ia_voz_atualizar on public.voz_chamadas;
create trigger consumo_ia_voz_atualizar after update on public.voz_chamadas
    referencing new table as novas for each statement execute function public.consumo_ia_voz_gatilho();

-- SQL 56 recriada inteira: a telefonia de sempre e o minuto falado do mesmo dia
create or replace function public.consolidar_consumo_voz(empresa bigint, dia date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor consolida o consumo de voz';
    end if;
    delete from public.consumo_voz c where c.empresa_id = empresa and c.dia = consolidar_consumo_voz.dia;
    insert into public.consumo_voz (empresa_id, dia, tech_prefix, rota_id, chamadas, chamadas_atendidas,
                                    segundos_atendidos, segundos_tarifados, custo_estimado, sem_custo)
    select empresa, consolidar_consumo_voz.dia, coalesce(v.tech_prefix, ''), max(v.rota_id), count(*),
           count(*) filter (where coalesce(v.billsec, 0) > 0), coalesce(sum(v.billsec), 0),
           coalesce(sum(v.segundos_tarifados), 0), sum(v.custo_operadora),
           count(*) filter (where v.rota_id is null and coalesce(v.billsec, 0) > 0)
      from public.voz_chamadas v
     where v.empresa_id = empresa and v.tarifada_em is not null and v.modo <> 'simulado'
       and (coalesce(v.atendida_em, v.ocorrido_em) at time zone 'America/Sao_Paulo')::date = consolidar_consumo_voz.dia
     group by coalesce(v.tech_prefix, '');
    get diagnostics n = row_count;
    perform public.consolidar_consumo_ia_voz(empresa, consolidar_consumo_voz.dia);   -- SQL 126
    return n;
end $$;

-- ================================================================ 2. o contrato por minuto no ciclo
-- por_minuto = alguma vigência por minuto vale dentro do ciclo; franquia e preço = os que valem no fim do ciclo
create or replace function public.cobranca_ia_ciclo(empresa bigint, mes date,
    out inicio date, out fim date, out por_minuto boolean, out franquia_min int, out preco numeric)
returns record
language plpgsql stable security definer set search_path = public as $$
declare
    cic record;
    ate timestamptz;
    c public.voz_cobranca_ia;
    pv public.precos_empresa;
begin
    cic := public.ciclo_de(cobranca_ia_ciclo.empresa, cobranca_ia_ciclo.mes);
    inicio := cic.inicio;
    fim := cic.fim;
    ate := (fim + 1)::timestamp at time zone 'America/Sao_Paulo';
    c := public.cobranca_ia_vigente(cobranca_ia_ciclo.empresa, ate - interval '1 microsecond');
    por_minuto := c.modelo = 'por_minuto'
                  or exists (select 1 from public.voz_cobranca_ia x
                              where x.empresa_id = cobranca_ia_ciclo.empresa and x.modelo = 'por_minuto'
                                and x.vigente_desde >= inicio::timestamp at time zone 'America/Sao_Paulo'
                                and x.vigente_desde < ate);
    por_minuto := coalesce(por_minuto, false);
    franquia_min := case when c.modelo = 'por_minuto' then c.franquia_min end;
    pv := public.preco_vigente(cobranca_ia_ciclo.empresa, 'voz_minuto_ia', cobranca_ia_ciclo.mes);
    preco := case when pv.modelo = 'flat' then pv.preco end;
end $$;

-- linhas do minuto falado de um ciclo por minuto
create or replace function public.linhas_fatura_minuto_falado_voz(empresa bigint, mes date, posicao int)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    c record;
    g record;
    n int := 0;
    tot_seg numeric := 0;
    tot_val numeric := 0;
    tot_lig bigint := 0;
    minutos numeric;
    exc numeric;
    pv public.precos_empresa;
    rotulo text := 'Agente de voz — minutos tarifados × preço';
begin
    c := public.cobranca_ia_ciclo(linhas_fatura_minuto_falado_voz.empresa, linhas_fatura_minuto_falado_voz.mes);
    if c.franquia_min is null then
        for g in select d.cadencia_ia, d.preco_minuto_ia, sum(d.segundos_ia_tarifados) as seg,
                        sum(d.ligacoes_cobradas) as lig, min(d.dia) as de
                   from public.voz_consumo_ia_dia d
                  where d.empresa_id = linhas_fatura_minuto_falado_voz.empresa and d.modelo = 'por_minuto'
                    and d.dia between c.inicio and c.fim
                  group by d.cadencia_ia, d.preco_minuto_ia
                  order by min(d.dia), d.cadencia_ia, d.preco_minuto_ia loop
            n := n + 1;
            tot_seg := tot_seg + g.seg;
            tot_val := tot_val + round(g.seg * g.preco_minuto_ia / 60, 2);
            return query select posicao, 'voz_minuto_ia' || case when n > 1 then '_' || n else '' end,
                rotulo || ' · cadência ' || g.cadencia_ia || ' · '
                       || replace(to_char(g.lig, 'FM999,999,990'), ',', '.') || ' ligações'
                       || case when n > 1 or g.de > c.inicio then ' · desde ' || to_char(g.de, 'DD/MM') else '' end,
                round(g.seg / 60.0, 2), g.preco_minuto_ia, round(g.seg * g.preco_minuto_ia / 60, 2);
        end loop;
        -- sem franquia, o mínimo mensal do preço da empresa vale como antes
        pv := public.preco_vigente(linhas_fatura_minuto_falado_voz.empresa, 'voz_minuto_ia', linhas_fatura_minuto_falado_voz.mes);
        if pv.minimo > tot_val then
            return query select posicao + 1000, 'voz_minuto_ia_minimo'::text,
                rotulo || ' · complemento do mínimo mensal', 1::numeric, pv.minimo - tot_val, pv.minimo - tot_val;
        end if;
        return;
    end if;
    -- franquia (P6): compromisso de N minutos tarifados ao preço do fim do ciclo, excedente ao mesmo preço
    select coalesce(sum(d.segundos_ia_tarifados), 0), coalesce(sum(d.ligacoes_cobradas), 0) into tot_seg, tot_lig
      from public.voz_consumo_ia_dia d
     where d.empresa_id = linhas_fatura_minuto_falado_voz.empresa and d.modelo = 'por_minuto'
       and d.dia between c.inicio and c.fim;
    minutos := round(tot_seg / 60.0, 2);
    exc := greatest(0, minutos - c.franquia_min);
    return query select posicao, 'voz_minuto_ia_franquia'::text,
        rotulo || ' · franquia de ' || replace(to_char(c.franquia_min, 'FM999,999,990'), ',', '.') || ' min ('
               || replace(replace(replace(to_char(least(minutos, c.franquia_min), 'FM999,999,990.00'), ',', '_'), '.', ','), '_', '.') || ' min usados)',
        c.franquia_min::numeric, c.preco, round(c.franquia_min * coalesce(c.preco, 0), 2);
    if exc > 0 then
        return query select posicao, 'voz_minuto_ia'::text,
            rotulo || ' · excedente da franquia · ' || replace(to_char(tot_lig, 'FM999,999,990'), ',', '.') || ' ligações',
            exc, c.preco, round(exc * coalesce(c.preco, 0), 2);
    end if;
end $$;

-- ================================================================ 3. franquia da licença com os minutos medidos
create or replace function public.linhas_fatura_minuto_ia_voz(empresa bigint, mes date, posicao int, franquia bigint)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    usados numeric;
    cic record;
    exc numeric;
    v record;
    fr bigint := coalesce(linhas_fatura_minuto_ia_voz.franquia, 0);
    nome text := coalesce((select i.nome from public.cobranca_itens i where i.codigo = 'voz_minuto_ia'),
                          'Agente virtual · minuto de IA');
begin
    select coalesce(sum(m.quantidade), 0) into usados from public.consumo_mensageria m
     where m.empresa_id = linhas_fatura_minuto_ia_voz.empresa and m.competencia = linhas_fatura_minuto_ia_voz.mes
       and m.item in ('voz_minuto_ia', 'voz_minuto_ia_pico');
    -- SQL 126: + os minutos falados medidos pela VM nas ligações da licença (segundos inteiros, sem cadência: P7)
    cic := public.ciclo_de(linhas_fatura_minuto_ia_voz.empresa, linhas_fatura_minuto_ia_voz.mes);
    usados := usados + coalesce((select ceil(sum(d.segundos_ia_tarifados) / 60.0) from public.voz_consumo_ia_dia d
                                  where d.empresa_id = linhas_fatura_minuto_ia_voz.empresa and d.modelo = 'licenca'
                                    and d.dia between cic.inicio and cic.fim), 0);
    exc := greatest(0, usados - fr);
    return query select posicao, 'voz_minuto_ia_franquia'::text,
        nome || ' · ' || replace(to_char(least(usados, fr), 'FM999,999,999,990'), ',', '.') || ' de '
             || replace(to_char(fr, 'FM999,999,999,990'), ',', '.') || ' min da franquia (incluída nos robôs)',
        least(usados, fr)::numeric, 0::numeric, 0::numeric;
    if exc = 0 then
        return;
    end if;
    select * into v from public.valor_item(linhas_fatura_minuto_ia_voz.empresa, 'voz_minuto_ia', exc,
                                           linhas_fatura_minuto_ia_voz.mes);
    if v.valor is null then
        return query select posicao, 'voz_minuto_ia'::text, nome || ' · excedente da franquia · sem preço cadastrado',
                            exc, 0::numeric, 0::numeric;
        return;
    end if;
    return query select posicao, 'voz_minuto_ia'::text,
        nome || ' · excedente da franquia · ' || replace(to_char(exc, 'FM999,999,999,990'), ',', '.') || ' min'
             || coalesce(' (' || v.detalhe || ')', ''),
        exc, v.preco_medio, v.valor;
end $$;

-- ================================================================ 4. previa_fatura (recriada inteira)
create or replace function public.previa_fatura(empresa bigint, competencia date)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    mes date := public.competencia_de(empresa, competencia);
    c record;
    v record;
    qtd numeric;
    qtd_extra numeric;
    pv public.precos_empresa;
    codigo_fatura text;
    nome text;
    lic record;
    ia record;
begin
    if auth.uid() is not null and not public.ve_faturamento(empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    lic := public.licenca_voz_ciclo(empresa, mes);      -- SQL 98: robôs contratados (licenças) no ciclo
    ia := public.cobranca_ia_ciclo(empresa, mes);       -- SQL 126: minuto falado com a IA no ciclo
    if ia.por_minuto then                               -- SQL 126: no por minuto a licença não vale (P8)
        lic.tem := false;
    end if;
    for c in select ci.* from public.cobranca_itens ci where ci.preco_de is null order by ci.ordem, ci.codigo loop
        qtd_extra := 0;
        if c.codigo = 'ia_creditos' then   -- SQL 78: franquia incluída + excedente
            return query select * from public.linhas_fatura_creditos_ia(empresa, mes, c.ordem);
            continue;
        end if;
        if c.codigo = 'voz_licenca_robo' then   -- SQL 98: da licença (dia exato e pro rata), nunca de precos_empresa
            if not ia.por_minuto then
                return query select * from public.linhas_fatura_licenca_voz(empresa, mes, c.ordem);
            end if;
            continue;
        end if;
        if ia.por_minuto then                    -- SQL 126: minutos tarifados × preço (por vigência), franquia, sem pico
            if c.codigo = 'voz_minuto_ia' then
                return query select * from public.linhas_fatura_minuto_falado_voz(empresa, mes, c.ordem);
                continue;
            elsif c.codigo = 'voz_minuto_ia_pico' then
                continue;
            end if;
        end if;
        if lic.tem then                          -- SQL 98: o que a licença inclui
            if c.codigo = 'voz_minuto_ia' then
                return query select * from public.linhas_fatura_minuto_ia_voz(empresa, mes, c.ordem, lic.franquia);
                continue;
            elsif c.codigo = 'voz_minuto_ia_pico' then   -- sem pico para quem tem licença: conta no minuto de IA
                continue;
            elsif c.codigo = 'voz_plataforma' then
                if (public.preco_vigente(empresa, c.codigo, mes)).id is not null then
                    return query select c.ordem, c.codigo, c.nome || ' · incluída nos robôs (licenças)', 1::numeric,
                                        0::numeric, 0::numeric;
                end if;
                continue;
            elsif c.codigo = 'voz_transcricao' and lic.transcricao then
                select coalesce(sum(m.quantidade), 0) into qtd from public.consumo_mensageria m
                 where m.empresa_id = empresa and m.competencia = mes and m.item = c.codigo;
                if qtd > 0 then
                    return query select c.ordem, c.codigo,
                        c.nome || ' · ' || replace(to_char(qtd, 'FM999,999,999,990'), ',', '.')
                               || ' min (incluída nos robôs)', qtd, 0::numeric, 0::numeric;
                end if;
                continue;
            end if;
        end if;
        if c.codigo = 'contratos' then
            qtd := (public.orquestracao_medicao(empresa, mes)).quantidade;   -- SQL 69: CPFs ativos no ciclo
        elsif c.codigo = 'jornada_clientes' then
            select count(*) into qtd from public.jornada_clientes_mes m
             where m.empresa_id = empresa and m.competencia = mes;
        else
            select coalesce(sum(m.quantidade), 0) into qtd from public.consumo_mensageria m
             where m.empresa_id = empresa and m.competencia = mes and m.item = c.codigo;
            select coalesce(sum(m.quantidade), 0) into qtd_extra from public.consumo_mensageria m
              join public.cobranca_itens x on x.codigo = m.item and x.preco_de = c.codigo
             where m.empresa_id = empresa and m.competencia = mes;
        end if;
        pv := public.preco_vigente(empresa, c.codigo, mes);
        codigo_fatura := case when c.codigo = 'contratos' then 'orquestracao'
                              when c.codigo = 'jornada_clientes' then 'jornada' else c.codigo end;
        nome := case when c.codigo = 'contratos' then 'Orquestração' else c.nome end;
        if pv.id is null then
            if qtd + qtd_extra > 0 then        -- consumo sem preço cadastrado: aparece zerado para a equipe ver
                return query select c.ordem, codigo_fatura, nome || ' · sem preço cadastrado', qtd + qtd_extra,
                                    0::numeric, 0::numeric;
            end if;
            continue;
        end if;
        if pv.modelo = 'mensalidade' then
            if c.modulo is null or exists (select 1 from public.empresa_modulos em where em.empresa_id = empresa
                                           and em.modulo = c.modulo and em.ativo) then
                return query select c.ordem, codigo_fatura, nome || ' · mensalidade', 1::numeric, pv.preco,
                                    round(pv.preco, 2);
            end if;
            continue;
        end if;
        if qtd + qtd_extra = 0 and pv.minimo = 0 then
            continue;
        end if;
        select * into v from public.valor_item(empresa, c.codigo, qtd + qtd_extra, mes);
        return query select c.ordem, codigo_fatura,
            nome || case when c.codigo = 'contratos' and (public.orquestracao_medicao(empresa, mes)).por_cpf
                              then ' · CPFs ativos no mês'
                         when c.codigo = 'contratos'
                              then ' · contratos no ciclo (medição anterior à cobrança por CPF)'
                         when c.codigo = 'jornada_clientes' then ' · clientes acionados no ciclo'
                         when qtd_extra > 0 then ' · ' || qtd || ' envios + ' || qtd_extra || ' respostas'
                         else '' end
                 || coalesce(' (' || v.detalhe || ')', ''),
            qtd + qtd_extra, v.preco_medio, v.valor;
        if v.minimo > v.valor then
            return query select c.ordem + 1000, codigo_fatura || '_minimo',
                                nome || ' · complemento do mínimo mensal', 1::numeric, v.minimo - v.valor,
                                v.minimo - v.valor;
        end if;
    end loop;
end $$;

-- ================================================================ 5. margem da IA com o minuto falado
create or replace function public.margem_ia(competencia date)
returns table (empresa_id bigint, empresa text, item text, nome text, unidade text, quantidade numeric,
               receita numeric, impostos numeric, custo numeric, custo_estimado boolean, mc numeric, mc_pct numeric,
               preco_medio numeric, preco_minimo_ia numeric, situacao text, sem_custo int)
language plpgsql stable security definer set search_path = public as $$
declare
    par public.parametros_margem;
    comp date := date_trunc('month', competencia)::date;
    dia date := least(current_date, (date_trunc('month', competencia) + interval '1 month - 1 day')::date);
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê a margem da IA';
    end if;
    select * into par from public.parametros_margem pm where pm.id = 1;
    return query
    with uso as (
        select coalesce(m.empresa_id, k.empresa_id) as eid, coalesce(m.item, k.item) as it,
               -- SQL 126: o minuto falado (por minuto) não passa por consumo_mensageria: a quantidade vem do consumo_ia
               coalesce(m.quantidade, case when k.item = 'voz_minuto_ia' then k.quantidade end, 0)::numeric as qtd, k.custo as cst, k.sem_custo as semc, k.registros as regs
          from (select c.* from public.consumo_mensageria c join public.cobranca_itens i on i.codigo = c.item and i.eh_ia
                 where c.competencia = comp) m
          full join (select x.* from public.consumo_ia x where x.competencia = comp) k
            on k.empresa_id = m.empresa_id and k.item = m.item
    ), calc as (
        select u.eid, u.it, u.qtd,
               coalesce(f.valor, v.valor) as rec, coalesce(case when f.valor is not null and u.qtd > 0
                                                               then round(f.valor / u.qtd, 5) end, v.preco_medio) as pm_,
               case when u.regs is not null then u.cst else u.qtd * public.custo_ia_vigente(u.it, dia) end as cst,
               u.regs is null as estimado, coalesce(u.semc, case when u.regs is null and public.custo_ia_vigente(u.it, dia) is null
                                                                 then 1 else 0 end) as semc
          from uso u left join lateral public.valor_item(u.eid, u.it, u.qtd, comp) v on true
          -- SQL 126: receita do minuto falado = Σ valor das ligações tarifadas por minuto no mês
          left join lateral (select round(sum(d.valor), 2) as valor from public.voz_consumo_ia_dia d
                              where u.it = 'voz_minuto_ia' and d.empresa_id = u.eid and d.valor is not null
                                and d.dia >= comp and d.dia < (comp + interval '1 month')::date) f on true
    )
    select k.eid, e.nome, k.it, i.nome, i.unidade, k.qtd, coalesce(k.rec, 0),
           round(coalesce(k.rec, 0) * par.impostos_pct / 100, 2), round(coalesce(k.cst, 0), 2), k.estimado,
           round(coalesce(k.rec, 0) - coalesce(k.rec, 0) * par.impostos_pct / 100 - coalesce(k.cst, 0), 2),
           case when k.rec > 0 then round((k.rec - k.rec * par.impostos_pct / 100 - coalesce(k.cst, 0)) / k.rec * 100, 1) end,
           k.pm_, public.preco_minimo_ia(k.it),
           case when k.rec is null and k.qtd > 0 then 'sem_preco'
                when coalesce(k.rec, 0) = 0 then 'sem_receita'
                when k.cst is null or k.semc > 0 then 'sem_custo'
                when (k.rec - k.rec * par.impostos_pct / 100 - k.cst) / k.rec * 100 < public.mc_minima_ia_de(k.it) then 'abaixo_minimo'
                else 'ok' end,
           k.semc::int
      from calc k
      join public.empresas e on e.id = k.eid
      join public.cobranca_itens i on i.codigo = k.it
     order by 12 nulls first, e.nome, i.ordem;
end $$;

-- ================================================================ 6. permissões das funções
revoke all on function public.consolidar_consumo_ia_voz(bigint, date), public.consumo_ia_voz_gatilho(),
    public.cobranca_ia_ciclo(bigint, date), public.linhas_fatura_minuto_falado_voz(bigint, date, int),
    public.linhas_fatura_minuto_ia_voz(bigint, date, int, bigint)
    from public, anon, authenticated;
grant execute on function public.consolidar_consumo_ia_voz(bigint, date), public.cobranca_ia_ciclo(bigint, date),
    public.linhas_fatura_minuto_falado_voz(bigint, date, int), public.linhas_fatura_minuto_ia_voz(bigint, date, int, bigint)
    to service_role;
revoke all on function public.dia_ia_voz(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.dia_ia_voz(timestamptz, timestamptz, timestamptz) to authenticated, service_role;
revoke execute on function public.previa_fatura(bigint, date) from public, anon;
grant execute on function public.previa_fatura(bigint, date) to authenticated, service_role;
