-- SQL 123 · Agente de voz cobrado por minuto falado com a IA, PR 1 do plano (SPEC "Agente de voz por minuto falado",
-- aprovada pelo dono com todas as recomendações P1–P13). Só banco: ninguém lê ainda (as colunas por chamada são o
-- SQL 125, a fatura o 126, a divisão do teto o 128).
--
-- 1. voz_cobranca_ia: o contrato da IA por empresa, uma linha por vigência, só se acrescenta (histórico = a própria
--    tabela, como voz_licencas). Modelo (por_minuto | licenca), cadência grátis/inicial/incremento (padrão 0/30/6),
--    limite de conversas simultâneas (obrigatório no por_minuto; teto de capacidade, sem preço), franquia opcional de
--    minutos tarifados, vigente_desde com hora (P10: "neste ciclo" vale do momento em que salvou), motivo, overbooking
--    confirmado, quem e quando. O PREÇO do minuto continua em precos_empresa (item voz_minuto_ia, vigência por mês),
--    para não duplicar o guarda da margem: a RPC grava as duas tabelas na mesma transação.
-- 2. voz_contrato.cadencia_ia_padrao ('0/30/6'): a cadência que vem pré-preenchida para quem ainda não tem contrato da
--    IA. Só o Master muda (definir_cadencia_ia_padrao).
-- 3. segundos_tarifados_ia(segundos, gratis, inicial, incremento): a tarifação do minuto de IA, em milésimos e com
--    tempo grátis. ≤ 0 ou ≤ grátis → 0; ≤ inicial → inicial; senão inicial + ceil((s − inicial) ÷ incremento) ×
--    incremento, com s arredondado em 3 casas. 0/30/6: 47 s → 48 s; 12 s → 30 s. A da telefonia
--    (segundos_tarifados, segundos inteiros, sem grátis) não muda. voz/tarifacao.py repete a regra, com a mesma tabela
--    de casos (tests/dados/tarifacao_ia_casos.json).
-- 4. cobranca_ia_vigente(empresa, momento) e modelo_ia_voz(empresa, momento): a vigência que vale no instante. Sem
--    linha em voz_cobranca_ia, o legado decide (§6 da SPEC): licença vigente com robôs > 0 = 'licenca'; senão
--    'por_minuto' sem contrato (cobranca_ia_id nulo: a fatura dessas empresas não muda).
-- 5. conversas_vendidas_voz(dia, exceto): robôs das licenças + limites do por minuto (cada empresa pelo modelo que vale
--    no dia), para o overbooking contra voz_contrato.concorrencia_contratada.
-- 6. salvar_cobranca_ia_voz(...): a única escrita. equipe_pode('editar_contratacao'); preço novo também editar_precos;
--    guarda da IA (conferir_preco_ia, nunca abaixo, nem o Master) e mínimo do catálogo com motivo (preco_abaixo_minimo
--    ou Master). Valores vazios = pré-preenchidos (o que vale; sem contrato, a cadência padrão e o preço de tabela).
--    Vigência: próximo ciclo (padrão) ou agora (motivo obrigatório sempre). Troca de modelo só no próximo ciclo (P8),
--    nunca com a fidelidade da licença correndo. Overbooking com confirmação e aviso para a equipe. Auditoria z_auditar.
-- 7. Leitura: historico_cobranca_ia_voz(empresa) para a equipe (quem, quando, de → para, motivo); o cliente
--    (ve_faturamento) lê a view voz_cobranca_ia_cliente, sem motivo e sem autor.
-- Não muda fatura, limite nem tarifação de ninguém. Depende dos SQL 56 (voz), 61 (margem da IA), 92 (preços) e 93
-- (licenças). Pode rodar de novo.

-- ================================================================ 1. cadência padrão
alter table public.voz_contrato add column if not exists cadencia_ia_padrao text not null default '0/30/6';
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'voz_contrato_cadencia_ia_padrao_check') then
        alter table public.voz_contrato add constraint voz_contrato_cadencia_ia_padrao_check
            check (cadencia_ia_padrao ~ '^[0-9]{1,2}/[0-9]{1,3}/[0-9]{1,3}$');
    end if;
end $$;
comment on column public.voz_contrato.cadencia_ia_padrao is
    'Cadência do minuto de IA (grátis/inicial/incremento, em segundos) pré-preenchida para quem ainda não tem contrato. SQL 123.';

-- ================================================================ 2. tarifação do minuto de IA
create or replace function public.segundos_tarifados_ia(segundos numeric, gratis int, inicial int, incremento int)
returns int
language plpgsql immutable parallel safe set search_path = '' as $$
declare
    s numeric := round(segundos, 3);
begin
    if s is null then
        return null;
    end if;
    if inicial is null or incremento is null or inicial < 1 or incremento < 1 or coalesce(gratis, 0) < 0 then
        raise exception 'cadência inválida: inicial e incremento precisam ser >= 1 e o grátis >= 0';
    end if;
    if s <= 0 or s <= coalesce(gratis, 0) then
        return 0;
    end if;
    if s <= inicial then
        return inicial;
    end if;
    return inicial + (ceil((s - inicial) / incremento))::int * incremento;
end $$;
comment on function public.segundos_tarifados_ia(numeric, int, int, int) is
    'Segundos tarifados do minuto de IA: ≤ grátis → 0; ≤ inicial → inicial; senão sobe de incremento em incremento. '
    'Em milésimos (3 casas). Igual a voz/tarifacao.py › segundos_tarifados_ia. SQL 123.';

-- '0/30/6' -> (0, 30, 6)
create or replace function public.cadencia_ia_partes(cadencia text, out gratis int, out inicial int, out incremento int)
returns record
language sql immutable parallel safe set search_path = '' as $$
    select split_part(cadencia, '/', 1)::int, split_part(cadencia, '/', 2)::int, split_part(cadencia, '/', 3)::int
$$;

-- ================================================================ 3. contrato da IA por empresa
create table if not exists public.voz_cobranca_ia (
    id                     bigint generated always as identity primary key,
    empresa_id             bigint not null references public.empresas (id) on delete cascade,
    modelo                 text not null check (modelo in ('por_minuto', 'licenca')),
    gratis_s               int not null default 0 check (gratis_s between 0 and 60),
    inicial_s              int not null default 30 check (inicial_s between 1 and 600),
    incremento_s           int not null default 6 check (incremento_s between 1 and 600),
    limite_conversas       int check (limite_conversas between 1 and 5000),
    franquia_min           int check (franquia_min between 1 and 10000000),
    vigente_desde          timestamptz not null,
    motivo                 text not null check (char_length(trim(motivo)) between 5 and 300),
    overbooking_confirmado boolean not null default false,
    criado_por             uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em              timestamptz not null default now(),
    constraint voz_cobranca_ia_gratis check (gratis_s < inicial_s),
    constraint voz_cobranca_ia_limite check (modelo <> 'por_minuto' or limite_conversas is not null),
    constraint voz_cobranca_ia_licenca check (modelo <> 'licenca' or (limite_conversas is null and franquia_min is null))
);
comment on table public.voz_cobranca_ia is
    'Contrato do minuto de IA do Agente de voz por empresa (modelo, cadência, limite de conversas, franquia). Uma linha '
    'por vigência, só se acrescenta; vale a última com vigente_desde <= o instante. O preço fica em precos_empresa '
    '(voz_minuto_ia). Escrita só por salvar_cobranca_ia_voz. SQL 123.';
create index if not exists voz_cobranca_ia_empresa on public.voz_cobranca_ia (empresa_id, vigente_desde desc, id desc);

alter table public.voz_cobranca_ia enable row level security;
drop policy if exists voz_cobranca_ia_ver on public.voz_cobranca_ia;
create policy voz_cobranca_ia_ver on public.voz_cobranca_ia for select to authenticated
    using (public.equipe_pode('editar_contratacao', empresa_id) or public.ve_faturamento(empresa_id));
revoke all on public.voz_cobranca_ia from public, anon, authenticated, service_role;
-- motivo e autor só pela RPC da equipe (historico_cobranca_ia_voz)
grant select (id, empresa_id, modelo, gratis_s, inicial_s, incremento_s, limite_conversas, franquia_min, vigente_desde,
              overbooking_confirmado, criado_em)
    on public.voz_cobranca_ia to authenticated;
grant select on public.voz_cobranca_ia to service_role;

create or replace function public.voz_cobranca_ia_so_acrescenta() returns trigger
language plpgsql set search_path = public as $$
begin
    if tg_op = 'DELETE' and (pg_trigger_depth() > 1
                             or coalesce(current_setting('motorcob.excluindo_empresa', true), '') <> '') then
        return old;
    end if;
    raise exception 'o contrato do minuto de IA só se acrescenta: grave uma vigência nova (salvar_cobranca_ia_voz)';
end $$;
drop trigger if exists voz_cobranca_ia_so_acrescenta on public.voz_cobranca_ia;
create trigger voz_cobranca_ia_so_acrescenta before update or delete on public.voz_cobranca_ia
    for each row execute function public.voz_cobranca_ia_so_acrescenta();
drop trigger if exists z_auditar on public.voz_cobranca_ia;
create trigger z_auditar after insert or update or delete on public.voz_cobranca_ia
    for each row execute function public.auditar();

-- ================================================================ 4. leitura
create or replace function public.cobranca_ia_vigente(empresa bigint, momento timestamptz default now())
returns public.voz_cobranca_ia
language sql stable security definer set search_path = public as $$
    select x.* from public.voz_cobranca_ia x
     where x.empresa_id = cobranca_ia_vigente.empresa and x.vigente_desde <= cobranca_ia_vigente.momento
     order by x.vigente_desde desc, x.id desc limit 1
$$;

-- o modelo que vale no instante: o do contrato; sem contrato, licença vigente com robôs > 0 = licenca, senão por_minuto
create or replace function public.modelo_ia_voz(empresa bigint, momento timestamptz default now()) returns text
language sql stable security definer set search_path = public as $$
    select coalesce((public.cobranca_ia_vigente(modelo_ia_voz.empresa, modelo_ia_voz.momento)).modelo,
                    case when coalesce((public.licenca_voz_em(modelo_ia_voz.empresa,
                                         (modelo_ia_voz.momento at time zone 'America/Sao_Paulo')::date)).robos, 0) > 0
                         then 'licenca' else 'por_minuto' end)
$$;

-- início do próximo ciclo da empresa (00:00 de Brasília)
create or replace function public.proximo_ciclo_ia_voz(empresa bigint) returns timestamptz
language sql stable security definer set search_path = public as $$
    select (((public.ciclo_de(proximo_ciclo_ia_voz.empresa,
                              public.competencia_de(proximo_ciclo_ia_voz.empresa, public.hoje_sp()))).fim + 1)::timestamp
            at time zone 'America/Sao_Paulo')
$$;

-- robôs das licenças + limites do por minuto, cada empresa pelo modelo que vale no dia (fim do dia)
create or replace function public.conversas_vendidas_voz(dia date, exceto bigint default null) returns int
language sql stable security definer set search_path = public as $$
    with m as (select (conversas_vendidas_voz.dia + 1)::timestamp at time zone 'America/Sao_Paulo' - interval '1 microsecond' as t),
    e as (select x.empresa_id from public.voz_cobranca_ia x
          union select l.empresa_id from public.voz_licencas l)
    select coalesce(sum(case when public.modelo_ia_voz(e.empresa_id, m.t) = 'por_minuto'
                             then coalesce((public.cobranca_ia_vigente(e.empresa_id, m.t)).limite_conversas, 0)
                             else coalesce((public.licenca_voz_em(e.empresa_id, conversas_vendidas_voz.dia)).robos, 0) end),
                    0)::int
      from e cross join m
     where e.empresa_id is distinct from conversas_vendidas_voz.exceto
$$;

-- cliente (ve_faturamento) e equipe: as vigências sem o motivo e sem o autor
create or replace view public.voz_cobranca_ia_cliente with (security_invoker = true) as
select x.id, x.empresa_id, x.modelo, x.gratis_s, x.inicial_s, x.incremento_s,
       x.gratis_s || '/' || x.inicial_s || '/' || x.incremento_s as cadencia, x.limite_conversas, x.franquia_min,
       x.vigente_desde, x.criado_em
  from public.voz_cobranca_ia x;
revoke all on public.voz_cobranca_ia_cliente from public, anon;
grant select on public.voz_cobranca_ia_cliente to authenticated, service_role;

-- equipe: histórico completo (de → para), o mais novo primeiro, com o preço do mês de cada vigência
create or replace function public.historico_cobranca_ia_voz(empresa bigint)
returns table (id bigint, situacao text, vigente_desde timestamptz, modelo text, modelo_antes text, cadencia text,
               cadencia_antes text, limite_conversas int, limite_antes int, franquia_min int, preco_minuto numeric,
               motivo text, overbooking_confirmado boolean, quem text, criado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
    vig bigint := (public.cobranca_ia_vigente(historico_cobranca_ia_voz.empresa, now())).id;
begin
    if not (public.equipe_pode('editar_contratacao', historico_cobranca_ia_voz.empresa)
            or public.equipe_pode('ver_faturamento', historico_cobranca_ia_voz.empresa)) then
        raise exception 'sem permissão para ver o contrato do minuto de IA desta empresa';
    end if;
    return query
    select x.id,
           case when x.id = vig then 'vigente' when x.vigente_desde > now() then 'agendada' else 'anterior' end,
           x.vigente_desde, x.modelo, lag(x.modelo) over w,
           x.gratis_s || '/' || x.inicial_s || '/' || x.incremento_s,
           lag(x.gratis_s || '/' || x.inicial_s || '/' || x.incremento_s) over w,
           x.limite_conversas, lag(x.limite_conversas) over w, x.franquia_min,
           (public.preco_vigente(x.empresa_id, 'voz_minuto_ia',
               public.competencia_de(x.empresa_id, (x.vigente_desde at time zone 'America/Sao_Paulo')::date))).preco,
           x.motivo, x.overbooking_confirmado, coalesce(public.nome_curto(x.criado_por), 'Equipe MotorCX'), x.criado_em
      from public.voz_cobranca_ia x
     where x.empresa_id = historico_cobranca_ia_voz.empresa
    window w as (order by x.vigente_desde, x.id)
     order by x.vigente_desde desc, x.id desc;
end $$;

-- ================================================================ 5. cadência padrão (só o Master)
create or replace function public.definir_cadencia_ia_padrao(cadencia text) returns text
language plpgsql security definer set search_path = public as $$
declare
    p record;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob muda a cadência padrão do minuto de IA';
    end if;
    if cadencia is null or cadencia !~ '^[0-9]{1,2}/[0-9]{1,3}/[0-9]{1,3}$' then
        raise exception 'cadência: grátis/inicial/incremento em segundos (ex.: 0/30/6)';
    end if;
    p := public.cadencia_ia_partes(cadencia);
    if p.gratis > 60 or p.inicial not between 1 and 600 or p.incremento not between 1 and 600 or p.gratis >= p.inicial then
        raise exception 'cadência inválida: grátis de 0 a 60 e menor que o inicial; inicial e incremento de 1 a 600';
    end if;
    update public.voz_contrato set cadencia_ia_padrao = cadencia, atualizado_por = auth.uid(), atualizado_em = now()
     where id;
    return cadencia;
end $$;

-- ================================================================ 6. salvar (a única escrita)
create or replace function public.salvar_cobranca_ia_voz(empresa bigint, modelo text, motivo text,
    preco numeric default null, gratis_s int default null, inicial_s int default null, incremento_s int default null,
    limite_conversas int default null, franquia_min int default null, quando text default 'proximo',
    overbooking_confirmado boolean default false, motivo_abaixo text default null)
returns table (cobranca_id bigint, vale_desde timestamptz, preco_id bigint, vendido int, contratado int,
               overbooking boolean)
language plpgsql security definer set search_path = public as $$
declare
    agora timestamptz := now();
    d timestamptz;
    dia date;
    ant public.voz_cobranca_ia;
    mod_atual text;
    mod_novo text := salvar_cobranca_ia_voz.modelo;
    lic public.voz_licencas;
    it public.cobranca_itens;
    pad record;
    m text := trim(coalesce(salvar_cobranca_ia_voz.motivo, ''));
    ma text := nullif(trim(coalesce(salvar_cobranca_ia_voz.motivo_abaixo, '')), '');
    g int; ini int; inc int; lim int; fr int;
    pr numeric;
    mes date;
    pv public.precos_empresa;
    preco_mudou boolean := false;
    teto int := coalesce((select c.concorrencia_contratada from public.voz_contrato c limit 1), 0);
    vend int := 0;
    over boolean := false;
    pid bigint;
    cid bigint;
    nome_emp text;
begin
    if not public.equipe_pode('editar_contratacao', salvar_cobranca_ia_voz.empresa) then
        raise exception 'sem permissão para editar o contrato do Agente de voz desta empresa (editar_contratacao)';
    end if;
    if mod_novo is null or mod_novo not in ('por_minuto', 'licenca') then
        raise exception 'modelo: por minuto falado ou licença de robôs';
    end if;
    if salvar_cobranca_ia_voz.quando is null or salvar_cobranca_ia_voz.quando not in ('agora', 'proximo') then
        raise exception 'vigência: no próximo ciclo ou neste ciclo, a partir de agora';
    end if;
    if char_length(m) not between 5 and 300 then
        raise exception 'escreva o motivo da mudança (5 a 300 letras)';
    end if;
    d := case salvar_cobranca_ia_voz.quando when 'agora' then agora
              else public.proximo_ciclo_ia_voz(salvar_cobranca_ia_voz.empresa) end;
    dia := (d at time zone 'America/Sao_Paulo')::date;
    ant := public.cobranca_ia_vigente(salvar_cobranca_ia_voz.empresa, d);

    -- P8: troca de modelo só no próximo ciclo; nunca com a fidelidade da licença correndo
    mod_atual := public.modelo_ia_voz(salvar_cobranca_ia_voz.empresa, agora);
    if salvar_cobranca_ia_voz.quando = 'agora' and mod_novo <> mod_atual then
        raise exception 'troca de modelo (licença ↔ por minuto) vale só a partir do próximo ciclo (%)',
            to_char((public.proximo_ciclo_ia_voz(salvar_cobranca_ia_voz.empresa) at time zone 'America/Sao_Paulo')::date,
                    'DD/MM/YYYY');
    end if;
    lic := public.licenca_voz_em(salvar_cobranca_ia_voz.empresa, dia);
    if mod_novo = 'por_minuto' and lic.fidelidade_ate >= dia and lic.robos > 0 then
        raise exception 'a licença de robôs tem fidelidade até %: a troca para o minuto falado só depois do fim',
            to_char(lic.fidelidade_ate, 'DD/MM/YYYY');
    end if;

    -- pré-preenchido: o que vale; sem contrato, a cadência padrão
    pad := public.cadencia_ia_partes(coalesce((select c.cadencia_ia_padrao from public.voz_contrato c limit 1), '0/30/6'));
    g := coalesce(salvar_cobranca_ia_voz.gratis_s, ant.gratis_s, pad.gratis);
    ini := coalesce(salvar_cobranca_ia_voz.inicial_s, ant.inicial_s, pad.inicial);
    inc := coalesce(salvar_cobranca_ia_voz.incremento_s, ant.incremento_s, pad.incremento);
    if g not between 0 and 60 or ini not between 1 and 600 or inc not between 1 and 600 then
        raise exception 'cadência: grátis de 0 a 60 s; inicial e incremento de 1 a 600 s';
    end if;
    if g >= ini then
        raise exception 'o tempo grátis (% s) precisa ser menor que a cobrança inicial (% s)', g, ini;
    end if;
    if mod_novo = 'por_minuto' then
        lim := coalesce(salvar_cobranca_ia_voz.limite_conversas, ant.limite_conversas);
        if lim is null or lim not between 1 and 5000 then
            raise exception 'informe o limite de conversas simultâneas (1 a 5.000)';
        end if;
        fr := case when salvar_cobranca_ia_voz.franquia_min is null then ant.franquia_min
                   else nullif(salvar_cobranca_ia_voz.franquia_min, 0) end;
        if fr is not null and fr not between 1 and 10000000 then
            raise exception 'franquia: de 1 a 10.000.000 minutos (0 = sem franquia)';
        end if;
    end if;

    -- preço (só no por minuto): editar_precos; guarda da IA (nunca abaixo); mínimo do catálogo com motivo
    if mod_novo = 'por_minuto' then
        select * into it from public.cobranca_itens c where c.codigo = 'voz_minuto_ia';
        mes := date_trunc('month', public.competencia_de(salvar_cobranca_ia_voz.empresa, dia))::date;
        pv := public.preco_vigente(salvar_cobranca_ia_voz.empresa, 'voz_minuto_ia', mes);
        pr := coalesce(salvar_cobranca_ia_voz.preco, case when pv.modelo = 'flat' then pv.preco end, it.preco_tabela);
        if pr is null or pr <= 0 then
            raise exception 'informe o preço do minuto';
        end if;
        pr := round(pr, 5);
        preco_mudou := pv.id is null or pv.modelo is distinct from 'flat' or pv.preco is distinct from pr::numeric(14, 5);
        if preco_mudou and not public.equipe_pode('editar_precos', salvar_cobranca_ia_voz.empresa) then
            raise exception 'sem permissão para definir o preço desta empresa (editar_precos)';
        end if;
        perform public.conferir_preco_ia('voz_minuto_ia', 'flat', pr);
        if preco_mudou and it.preco_minimo is not null and pr < it.preco_minimo then
            if not (public.admin_equipe() or public.equipe_pode('preco_abaixo_minimo', salvar_cobranca_ia_voz.empresa)) then
                raise exception 'preço abaixo do mínimo do catálogo (% por minuto): só o Administrativo ou o Master aprovam',
                    public.texto_preco_ia(it.preco_minimo);
            end if;
            if ma is null or char_length(ma) < 3 then
                raise exception 'informe o motivo do preço abaixo do mínimo';
            end if;
        else
            ma := null;
        end if;
    end if;

    -- overbooking: conversas vendidas acima do teto contratado com o provedor, numa mudança que aumenta
    if mod_novo = 'por_minuto' then
        vend := public.conversas_vendidas_voz(dia, salvar_cobranca_ia_voz.empresa) + lim;
        over := lim > coalesce(case when (mod_atual = 'por_minuto') then ant.limite_conversas end,
                               case when mod_atual = 'licenca' then lic.robos end, 0)
                and vend > teto;
        if over and not coalesce(salvar_cobranca_ia_voz.overbooking_confirmado, false) then
            raise exception 'overbooking: % conversas vendidas para % contratadas com o provedor de voz; confirme para salvar',
                vend, teto;
        end if;
    else
        vend := public.conversas_vendidas_voz(dia, salvar_cobranca_ia_voz.empresa) + coalesce(lic.robos, 0);
    end if;

    insert into public.voz_cobranca_ia (empresa_id, modelo, gratis_s, inicial_s, incremento_s, limite_conversas,
                                        franquia_min, vigente_desde, motivo, overbooking_confirmado)
    values (salvar_cobranca_ia_voz.empresa, mod_novo, g, ini, inc, lim, fr, d, m, over)
    returning id into cid;

    -- o preço em precos_empresa (vigência do mês do ciclo da mudança): as chamadas congelam o preço quando são tarifadas
    if mod_novo = 'por_minuto' then
        if preco_mudou then
            delete from public.precos_empresa p
             where p.empresa_id = salvar_cobranca_ia_voz.empresa and p.item = 'voz_minuto_ia' and p.vigente_desde = mes;
            insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde, motivo_abaixo,
                                               motivo_vigencia)
            values (salvar_cobranca_ia_voz.empresa, 'voz_minuto_ia', 'flat', pr, 0, mes, left(ma, 300),
                    case when salvar_cobranca_ia_voz.quando = 'agora' then left(m, 200) end)
            returning id into pid;
        else
            pid := pv.id;
        end if;
    end if;

    if over then
        select e.nome into nome_emp from public.empresas e where e.id = salvar_cobranca_ia_voz.empresa;
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('equipe', salvar_cobranca_ia_voz.empresa, 'atencao', 'Agente de voz: conversas vendidas acima do teto',
                left(format('%s passou a ter limite de %s conversas simultâneas (desde %s). Vendido: %s conversas para %s '
                            'contratadas com o provedor de voz. Quem cuida do contrato com o provedor precisa ampliar o teto.',
                            coalesce(nome_emp, 'Empresa ' || salvar_cobranca_ia_voz.empresa), lim,
                            to_char(d at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), vend, teto), 400),
                '/console/voz');
    end if;

    return query select cid, d, pid, vend, teto, vend > teto;
end $$;

-- ================================================================ 7. permissões das funções
revoke all on function public.cobranca_ia_vigente(bigint, timestamptz), public.modelo_ia_voz(bigint, timestamptz),
    public.proximo_ciclo_ia_voz(bigint), public.conversas_vendidas_voz(date, bigint),
    public.voz_cobranca_ia_so_acrescenta()
    from public, anon, authenticated;
grant execute on function public.cobranca_ia_vigente(bigint, timestamptz), public.modelo_ia_voz(bigint, timestamptz),
    public.proximo_ciclo_ia_voz(bigint), public.conversas_vendidas_voz(date, bigint) to service_role;
revoke all on function public.segundos_tarifados_ia(numeric, int, int, int), public.cadencia_ia_partes(text)
    from public, anon;
grant execute on function public.segundos_tarifados_ia(numeric, int, int, int), public.cadencia_ia_partes(text)
    to authenticated, service_role;
revoke all on function public.historico_cobranca_ia_voz(bigint),
    public.salvar_cobranca_ia_voz(bigint, text, text, numeric, int, int, int, int, int, text, boolean, text),
    public.definir_cadencia_ia_padrao(text)
    from public, anon;
grant execute on function public.historico_cobranca_ia_voz(bigint),
    public.salvar_cobranca_ia_voz(bigint, text, text, numeric, int, int, int, int, int, text, boolean, text),
    public.definir_cadencia_ia_padrao(text)
    to authenticated;
