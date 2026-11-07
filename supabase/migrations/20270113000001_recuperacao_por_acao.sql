-- SQL 77 · Recuperação por ação: acordo, pagamento e valor recuperado por canal × persona × estágio (Etapa 3)
--
-- Decisão do dono (07/11/2026, DECISOES_IA › ordem de implementação 3): antes do Especialista de Estratégia, publicar o
-- resultado de cada ação até o dinheiro, para otimizar "valor recuperado por real" e não só "CPC por real".
-- A rotina do motor (motor/recuperacao.py, publicada por nuvem/sincronizar.publicar_recuperacao) grava SÓ AGREGADOS:
-- nenhuma tabela deste SQL tem id_cliente, CPF, nome, telefone, e-mail ou saldo individual.
--
-- 1. recuperacao_dia: empresa × carteira × dia DA AÇÃO × canal × regua (fase ou etapa de origem) × cluster (segmento)
--    × persona × volta × dia_ciclo → acoes, com_retorno, contatos, cpcs, promessas, optouts, custo, acordos,
--    valor_acordo, pagamentos, valor_pago.
--    Regra de atribuição (motor/recuperacao.py): o acordo nasce no dia da rotina que o viu pela 1ª vez nas parcelas
--    (estado/acordos_vistos.csv, local; o que já existia antes do controle segue a regra do comitê pela trilha) e vai
--    para o ÚLTIMO TOQUE COM CPC nos 7 dias antes dessa rotina (sem CPC, o último toque; empate no dia: o canal
--    marcado na entrada em acordo). Sem toque nos 7 dias (inclusive acordo que já veio na carga) → regua 'sem_acao'
--    (canal ''). Pagamento (parcela paga; promessa não é pagamento) vai para a mesma linha do acordo. Pagamento que
--    chega depois atualiza o dia da ação: a rotina recalcula e regrava os
--    últimos 180 dias a cada rodada (idempotente). volta/dia_ciclo vêm do passo (G2-dia3, C2-D5, D+4, D-3, T2);
--    volta 0 = não se aplica, dia_ciclo nulo = passo sem dia.
-- 2. contato_posicao_dia: dia × canal × posição do número na ação (1..5; 5 = 5 ou mais) × dias seguidos com o mesmo
--    número na lista do canal (1..5; 5 = 5 ou mais) → tentativas, com_retorno, contatos, cpcs, terceiros, curtas.
-- 3. RPCs para o painel e o especialista (security definer, só agregados, quem vê a empresa e pode('ver_painel')):
--    recuperacao_por_acao(empresa, de, ate, credor, agrupar, so_canal, so_regua, so_cluster, so_persona) · contato_por_posicao(…)
--    · respostas_por_hora(…) (mensageria_mensagens somado no banco; hora de Brasília). Taxas só com ≥ 30 no grupo.
-- 4. Retenção: a rotina apaga o que passou de 760 dias (~25 meses) a cada publicação; limpar_recuperacao(dias) faz o
--    mesmo para todas as empresas (só o servidor).
-- RLS: a empresa vê as suas linhas; a equipe vê as do alcance (pode_ver_empresa); anônimo nada; o site nunca grava
-- (só a rotina, chave service_role). Pode rodar de novo sem erro. Não precisa de superusuário.

-- ================================================================ 1. recuperacao_dia
create table if not exists public.recuperacao_dia (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null,
    data          date not null,
    canal         text not null default '' check (char_length(canal) <= 40),
    regua         text not null default '' check (char_length(regua) <= 80),
    cluster       text not null default '' check (char_length(cluster) <= 80),
    persona       text not null default '' check (char_length(persona) <= 120),
    volta         smallint not null default 0 check (volta between 0 and 999),
    dia_ciclo     smallint check (dia_ciclo between -999 and 999),
    acoes         int not null default 0 check (acoes >= 0),
    com_retorno   int not null default 0 check (com_retorno >= 0),
    contatos      int not null default 0 check (contatos >= 0),
    cpcs          int not null default 0 check (cpcs >= 0),
    promessas     int not null default 0 check (promessas >= 0),
    optouts       int not null default 0 check (optouts >= 0),
    custo         numeric(14, 2) not null default 0 check (custo >= 0),
    acordos       int not null default 0 check (acordos >= 0),
    valor_acordo  numeric(16, 2) not null default 0 check (valor_acordo >= 0),
    pagamentos    int not null default 0 check (pagamentos >= 0 and pagamentos <= acordos),
    valor_pago    numeric(16, 2) not null default 0 check (valor_pago >= 0),
    atualizado_em timestamptz not null default now(),
    constraint recuperacao_dia_credor_fk foreign key (empresa_id, credor_id)
        references public.credores (empresa_id, id) on delete cascade
);
create unique index if not exists recuperacao_dia_chave on public.recuperacao_dia
    (empresa_id, credor_id, data, canal, regua, cluster, persona, volta, coalesce(dia_ciclo, -1000));
create index if not exists recuperacao_dia_empresa_data on public.recuperacao_dia (empresa_id, data);
comment on table public.recuperacao_dia is
    'SQL 77: resultado por ação até o dinheiro (agregado; sem dado pessoal). Dia = dia da ação; acordo no último '
    'toque com CPC nos 7 dias antes da rotina que o viu; sem toque = regua sem_acao. A rotina regrava 180 dias.';

drop trigger if exists credor_padrao on public.recuperacao_dia;
create trigger credor_padrao before insert on public.recuperacao_dia
    for each row execute function public.credor_padrao();

alter table public.recuperacao_dia enable row level security;
drop policy if exists recuperacao_dia_ver on public.recuperacao_dia;
create policy recuperacao_dia_ver on public.recuperacao_dia for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
revoke all on public.recuperacao_dia from anon;
revoke insert, update, delete, truncate on public.recuperacao_dia from authenticated;
grant select on public.recuperacao_dia to authenticated;
grant all on public.recuperacao_dia to service_role;

-- ================================================================ 2. contato_posicao_dia
create table if not exists public.contato_posicao_dia (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null,
    data          date not null,
    canal         text not null check (char_length(canal) between 1 and 40),
    posicao       smallint not null check (posicao between 1 and 5),
    dias_seguidos smallint not null check (dias_seguidos between 1 and 5),
    tentativas    int not null default 0 check (tentativas >= 0),
    com_retorno   int not null default 0 check (com_retorno >= 0),
    contatos      int not null default 0 check (contatos >= 0),
    cpcs          int not null default 0 check (cpcs >= 0),
    terceiros     int not null default 0 check (terceiros >= 0),
    curtas        int not null default 0 check (curtas >= 0),
    atualizado_em timestamptz not null default now(),
    primary key (empresa_id, credor_id, data, canal, posicao, dias_seguidos),
    constraint contato_posicao_dia_credor_fk foreign key (empresa_id, credor_id)
        references public.credores (empresa_id, id) on delete cascade
);
create index if not exists contato_posicao_dia_empresa_data on public.contato_posicao_dia (empresa_id, data);
comment on table public.contato_posicao_dia is
    'SQL 77: contato por posição do número na ação e dias seguidos no mesmo número (agregado; sem telefone).';

drop trigger if exists credor_padrao on public.contato_posicao_dia;
create trigger credor_padrao before insert on public.contato_posicao_dia
    for each row execute function public.credor_padrao();

alter table public.contato_posicao_dia enable row level security;
drop policy if exists contato_posicao_dia_ver on public.contato_posicao_dia;
create policy contato_posicao_dia_ver on public.contato_posicao_dia for select to authenticated
    using (public.pode_ver_empresa(empresa_id));
revoke all on public.contato_posicao_dia from anon;
revoke insert, update, delete, truncate on public.contato_posicao_dia from authenticated;
grant select on public.contato_posicao_dia to authenticated;
grant all on public.contato_posicao_dia to service_role;

-- ================================================================ 3. RPCs (só agregados)
-- quem pode consultar: vê a empresa (dela ou no alcance da equipe) e tem 'ver_painel'
create or replace function public.pode_ver_recuperacao(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select empresa is not null and public.pode_ver_empresa(empresa) and public.pode('ver_painel')
$$;
revoke all on function public.pode_ver_recuperacao(bigint) from public, anon;
grant execute on function public.pode_ver_recuperacao(bigint) to authenticated;

create or replace function public.checar_periodo_recuperacao(empresa bigint, de date, ate date) returns void
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.pode_ver_recuperacao(empresa) then
        raise exception 'sem permissão para ver os resultados desta empresa';
    end if;
    if de is null or ate is null or de > ate then
        raise exception 'período inválido';
    end if;
    if ate - de > 800 then
        raise exception 'período longo demais (máximo 800 dias)';
    end if;
end $$;
revoke all on function public.checar_periodo_recuperacao(bigint, date, date) from public, anon;
grant execute on function public.checar_periodo_recuperacao(bigint, date, date) to authenticated;

-- Recuperação no período, agrupada pelas dimensões pedidas (data, canal, regua, cluster, persona, volta, dia_ciclo).
-- Dimensão não pedida volta nula. Taxas só com ≥ 30 ações no grupo; recuperado_por_real só com custo > 0.
drop function if exists public.recuperacao_por_acao(bigint, date, date, bigint, text[], text, text, text, text);
create function public.recuperacao_por_acao(empresa bigint, de date, ate date, credor bigint default null,
                                            agrupar text[] default array['canal', 'persona'],
                                            so_canal text default null, so_regua text default null,
                                            so_cluster text default null, so_persona text default null)
returns table (data date, canal text, regua text, fase text, cluster text, segmento text, persona text, volta int,
               dia_ciclo int, acoes bigint, com_retorno bigint, contatos bigint, cpcs bigint, promessas bigint,
               optouts bigint, custo numeric, acordos bigint, valor_acordo numeric, pagamentos bigint,
               valor_pago numeric, taxa_contato numeric, taxa_cpc numeric, acordo_por_cpc numeric,
               custo_por_cpc numeric, custo_por_acordo numeric, recuperado_por_real numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    g text[] := coalesce(agrupar, '{}');
    f_canal text := so_canal; f_regua text := so_regua; f_cluster text := so_cluster; f_persona text := so_persona;
begin
    perform public.checar_periodo_recuperacao(empresa, de, ate);
    if exists (select 1 from unnest(g) x where x not in ('data', 'canal', 'regua', 'cluster', 'persona', 'volta',
                                                          'dia_ciclo')) then
        raise exception 'agrupar aceita só data, canal, regua, cluster, persona, volta e dia_ciclo';
    end if;
    return query
    with base as (
        select case when 'data' = any (g) then r.data end           as d,
               case when 'canal' = any (g) then r.canal end         as c,
               case when 'regua' = any (g) then r.regua end         as rg,
               case when 'cluster' = any (g) then r.cluster end     as cl,
               case when 'persona' = any (g) then r.persona end     as pe,
               case when 'volta' = any (g) then r.volta::int end    as vo,
               case when 'dia_ciclo' = any (g) then r.dia_ciclo::int end as dc,
               r.*
          from public.recuperacao_dia r
         where r.empresa_id = empresa and (credor is null or r.credor_id = credor) and r.data between de and ate
           and (f_canal is null or r.canal = f_canal) and (f_regua is null or r.regua = f_regua)
           and (f_cluster is null or r.cluster = f_cluster) and (f_persona is null or r.persona = f_persona)
    ), soma as (
        select b.d, b.c, b.rg, b.cl, b.pe, b.vo, b.dc,
               sum(b.acoes)::bigint ac, sum(b.com_retorno)::bigint cr, sum(b.contatos)::bigint ct,
               sum(b.cpcs)::bigint cp, sum(b.promessas)::bigint pr, sum(b.optouts)::bigint oo, sum(b.custo) cu,
               sum(b.acordos)::bigint ao, sum(b.valor_acordo) va, sum(b.pagamentos)::bigint pg, sum(b.valor_pago) vp
          from base b
         group by b.d, b.c, b.rg, b.cl, b.pe, b.vo, b.dc
    )
    select s.d, s.c, s.rg,
           case when s.rg is null then null when s.rg = 'sem_acao' then 'Sem ação do motor'
                else public.rotulo_fase(s.rg) end,
           s.cl, case when s.cl is null then null else public.nome_segmento(empresa, credor, s.cl) end,
           s.pe, s.vo, s.dc, s.ac, s.cr, s.ct, s.cp, s.pr, s.oo, s.cu, s.ao, s.va, s.pg, s.vp,
           case when s.ac >= 30 then round(100.0 * s.ct / s.ac, 2) end,
           case when s.ac >= 30 then round(100.0 * s.cp / s.ac, 2) end,
           case when s.cp >= 30 then round(100.0 * s.ao / s.cp, 2) end,
           case when s.cp > 0 then round(s.cu / s.cp, 2) end,
           case when s.ao > 0 then round(s.cu / s.ao, 2) end,
           case when s.cu > 0 then round(s.vp / s.cu, 2) end
      from soma s
     order by s.d nulls first, s.vp desc, s.c, s.rg, s.cl, s.pe, s.vo, s.dc;
end $$;
comment on function public.recuperacao_por_acao(bigint, date, date, bigint, text[], text, text, text, text) is
    'SQL 77: valor recuperado por real e o funil (ações → contato → CPC → promessa → acordo → pagamento) agregados.';
revoke all on function public.recuperacao_por_acao(bigint, date, date, bigint, text[], text, text, text, text)
    from public, anon;
grant execute on function public.recuperacao_por_acao(bigint, date, date, bigint, text[], text, text, text, text)
    to authenticated;

-- Contato por posição do número e dias seguidos no mesmo número (taxas só com ≥ 30 tentativas)
drop function if exists public.contato_por_posicao(bigint, date, date, bigint, text);
create function public.contato_por_posicao(empresa bigint, de date, ate date, credor bigint default null,
                                           so_canal text default null)
returns table (canal text, posicao int, dias_seguidos int, tentativas bigint, com_retorno bigint, contatos bigint,
               cpcs bigint, terceiros bigint, curtas bigint, taxa_contato numeric, taxa_cpc numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare f_canal text := so_canal;
begin
    perform public.checar_periodo_recuperacao(empresa, de, ate);
    return query
    select p.canal, p.posicao::int, p.dias_seguidos::int, sum(p.tentativas)::bigint, sum(p.com_retorno)::bigint,
           sum(p.contatos)::bigint, sum(p.cpcs)::bigint, sum(p.terceiros)::bigint, sum(p.curtas)::bigint,
           case when sum(p.tentativas) >= 30 then round(100.0 * sum(p.contatos) / sum(p.tentativas), 2) end,
           case when sum(p.tentativas) >= 30 then round(100.0 * sum(p.cpcs) / sum(p.tentativas), 2) end
      from public.contato_posicao_dia p
     where p.empresa_id = empresa and (credor is null or p.credor_id = credor) and p.data between de and ate
       and (f_canal is null or p.canal = f_canal)
     group by p.canal, p.posicao, p.dias_seguidos
     order by p.canal, p.posicao, p.dias_seguidos;
end $$;
revoke all on function public.contato_por_posicao(bigint, date, date, bigint, text) from public, anon;
grant execute on function public.contato_por_posicao(bigint, date, date, bigint, text) to authenticated;

-- Resposta por hora de envio (Mensageria): mensageria_mensagens somado no banco, hora de Brasília (0–23).
-- Taxas só com ≥ 30 enviadas na hora.
drop function if exists public.respostas_por_hora(bigint, date, date, bigint, text);
create function public.respostas_por_hora(empresa bigint, de date, ate date, credor bigint default null,
                                          so_canal text default null)
returns table (canal text, hora int, enviadas bigint, entregues bigint, respostas bigint, descadastros bigint,
               taxa_entrega numeric, taxa_resposta numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare f_canal text := so_canal;
begin
    perform public.checar_periodo_recuperacao(empresa, de, ate);
    return query
    with m as (
        select l.canal as c, extract(hour from (x.enviado_em at time zone 'America/Sao_Paulo'))::int as h,
               x.situacao, x.respondida_em
          from public.mensageria_mensagens x
          join public.mensageria_lotes l on l.id = x.lote_id
         where x.empresa_id = empresa and l.empresa_id = empresa and x.enviado_em is not null
           and (credor is null or l.credor_id = credor) and (f_canal is null or l.canal = f_canal)
           and (x.enviado_em at time zone 'America/Sao_Paulo')::date between de and ate
    )
    select m.c, m.h, count(*)::bigint, count(*) filter (where m.situacao = 'entregue')::bigint,
           count(m.respondida_em)::bigint, count(*) filter (where m.situacao = 'descadastro')::bigint,
           case when count(*) >= 30 then round(100.0 * count(*) filter (where m.situacao = 'entregue') / count(*), 2) end,
           case when count(*) >= 30 then round(100.0 * count(m.respondida_em) / count(*), 2) end
      from m
     group by m.c, m.h
     order by m.c, m.h;
end $$;
revoke all on function public.respostas_por_hora(bigint, date, date, bigint, text) from public, anon;
grant execute on function public.respostas_por_hora(bigint, date, date, bigint, text) to authenticated;

-- ================================================================ 4. retenção (só o servidor)
create or replace function public.limpar_recuperacao(dias int default 760) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint; m bigint;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor';
    end if;
    if dias is null or dias < 400 then
        raise exception 'a retenção mínima é de 400 dias';
    end if;
    delete from public.recuperacao_dia where data < current_date - dias;
    get diagnostics n = row_count;
    delete from public.contato_posicao_dia where data < current_date - dias;
    get diagnostics m = row_count;
    return n + m;
end $$;
revoke all on function public.limpar_recuperacao(int) from public, anon, authenticated;
grant execute on function public.limpar_recuperacao(int) to service_role;
