-- SQL 40 · Jornada do Cliente (MotorCli), revisão de UX (protótipo aprovado em 15/10/2026)
-- 1. Resultado de cada momento (jornada_desfechos) e movimento entre momentos (jornada_movimento), gravados pelo
--    motor a partir da carga diária: Boas-vindas recebeu a 1ª mensagem · Ativação ativou em até 30 dias · Pré-
--    vencimento pagou até o vencimento · Retenção voltou a usar antes de 90 dias · Reativação voltou a usar; e quem
--    foi para a cobrança. Conta para o último canal que acionou o cliente nos 7 dias anteriores.
-- 2. mapa_jornada e resultado_jornada: o Início (cartões por momento com o resultado) e o resultado por canal
--    com o custo por resultado. Fase de cada cliente hoje em jornada_cliente.fase.
-- 3. Mensagens por momento: o catálogo de frases aceita os momentos da Jornada como estágio.
-- 4. Lista do dia sem códigos: rotulo_momento, rotulo_passo_jornada e o porquê do "melhor canal" (fila_dia.por_que).
-- 5. Estratégia por carteira, como na Cobrança: carteiras_da_estrategia, separar_estrategia_jornada e
--    copiar_estrategia_jornada (sempre cópia independente). Prioridade, orçamento por canal e mensagem de cada
--    passo ficam na definição da estratégia (o motor lê).
-- 6. Relatórios (aba Jornada): "Resultado por momento e canal" e "Movimento da jornada".
-- Cliente em atraso só é contado ("foi para a cobrança"); não entra sozinho na carteira de cobrança.
-- Depende dos SQL 26 (etapas), 31 e 39. Pode rodar de novo sem erro.

-- ================================================================ 1. resultado e movimento
create table if not exists public.jornada_desfechos (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint not null,
    data        date not null,
    momento     text not null default '' check (momento in ('', 'boas_vindas', 'ativacao', 'pre_vencimento', 'retencao', 'reativacao')),
    canal       text not null default '',
    frase_id    bigint not null default 0,      -- mensagem da última ação (0 = template padrão do canal)
    desfecho    text not null check (desfecho in ('sucesso', 'nao', 'cobranca')),
    clientes    int not null check (clientes >= 0),
    primary key (empresa_id, credor_id, data, momento, canal, frase_id, desfecho)
);
comment on table public.jornada_desfechos is
    'Resultado dos momentos da Jornada por dia e canal (só contagens). canal vazio = sem ação nos 7 dias anteriores.';
create table if not exists public.jornada_movimento (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint not null,
    data        date not null,
    de          text not null,
    para        text not null,
    clientes    int not null check (clientes >= 0),
    primary key (empresa_id, credor_id, data, de, para)
);
comment on table public.jornada_movimento is
    'Clientes que mudaram de momento no dia: entrada, momentos, voltou_a_usar, cobranca e fora (só contagens).';
alter table public.jornada_desfechos enable row level security;
alter table public.jornada_movimento enable row level security;
drop policy if exists jornada_desfechos_ver on public.jornada_desfechos;
create policy jornada_desfechos_ver on public.jornada_desfechos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists jornada_movimento_ver on public.jornada_movimento;
create policy jornada_movimento_ver on public.jornada_movimento for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.jornada_desfechos, public.jornada_movimento from anon;
revoke insert, update, delete on public.jornada_desfechos, public.jornada_movimento from authenticated;
grant select on public.jornada_desfechos, public.jornada_movimento to authenticated;
grant all on public.jornada_desfechos, public.jornada_movimento to service_role;

alter table public.jornada_cliente add column if not exists fase text not null default '';
comment on column public.jornada_cliente.fase is 'Momento em que o cliente está hoje (com ou sem ação); cobranca = em atraso.';
alter table public.fila_dia add column if not exists por_que text check (por_que is null or char_length(por_que) <= 200);
comment on column public.fila_dia.por_que is 'Por que o motor escolheu o canal (ex.: "melhor canal: 91% pagam em dia").';

-- ================================================================ 2. rótulos (nada de código na tela)
create or replace function public.rotulo_momento(momento text) returns text
language sql immutable set search_path = public as $$
    select case coalesce(momento, '')
        when 'boas_vindas' then 'Boas-vindas' when 'ativacao' then 'Ativação'
        when 'pre_vencimento' then 'Pré-vencimento' when 'retencao' then 'Retenção'
        when 'reativacao' then 'Reativação' when 'cobranca' then 'Foi para a cobrança'
        when 'voltou_a_usar' then 'Voltou a usar' when 'entrada' then 'Entrou na carga'
        when 'fora' then 'Sem momento' when '' then 'Sem momento'
        else case when momento like 'etapa-%' then 'Etapa da empresa' else momento end end
$$;

-- "D-5" no Pré-vencimento → "5 dias antes do vencimento"; "C2-D3" → "2º ciclo, dia 3"
create or replace function public.rotulo_passo_jornada(momento text, passo text) returns text
language sql immutable set search_path = public as $$
    select case
        when passo is null or passo = '' then ''
        when passo ~ '^C[0-9]+-D[0-9]+\Z' then substring(passo from '^C([0-9]+)') || 'º ciclo, dia ' || substring(passo from '([0-9]+)\Z')
        when momento = 'pre_vencimento' and passo = 'D0' then 'No dia do vencimento'
        when momento = 'pre_vencimento' and passo ~ '^D-[0-9]+\Z' then
            substring(passo from '([0-9]+)\Z') || case when substring(passo from '([0-9]+)\Z') = '1' then ' dia' else ' dias' end
            || ' antes do vencimento'
        when momento in ('boas_vindas', 'ativacao') and passo = 'D0' then 'No dia da contratação'
        when momento in ('boas_vindas', 'ativacao') and passo ~ '^D\+[0-9]+\Z' then
            substring(passo from '([0-9]+)\Z') || case when substring(passo from '([0-9]+)\Z') = '1' then ' dia' else ' dias' end
            || ' depois da contratação'
        when momento in ('retencao', 'reativacao') and passo ~ '^D\+[0-9]+\Z' then
            substring(passo from '([0-9]+)\Z') || ' dias sem atividade'
        when passo = 'D0' then 'No dia'
        when passo ~ '^D[+-][0-9]+\Z' then
            'Dia ' || substring(passo from '([0-9]+)\Z') || case when passo like 'D-%' then ' antes' else '' end
        else passo end
$$;
grant execute on function public.rotulo_momento(text), public.rotulo_passo_jornada(text, text) to authenticated, service_role;

-- ================================================================ 3. Início e resultado
-- O mapa: por momento, quem está nele hoje, quem tem ação hoje e o resultado no período (taxa = sucesso ÷ fechados)
create or replace function public.mapa_jornada(credor bigint, de date, ate date)
returns table (momento text, nome text, ordem int, no_momento bigint, com_acao bigint, sucesso bigint, nao bigint,
               taxa numeric, cobranca bigint)
language sql stable security invoker set search_path = public as $$
    with m(momento, ordem) as (values ('boas_vindas', 1), ('ativacao', 2), ('pre_vencimento', 3), ('retencao', 4),
                                      ('reativacao', 5), ('cobranca', 6)),
         hoje as (select j.fase, count(*) as n from public.jornada_cliente j where j.credor_id = credor group by j.fase),
         acao as (select j.momento, count(*) as n from public.jornada_cliente j
                   where j.credor_id = credor and j.motivo = 'com ação hoje' group by j.momento),
         r as (select d.momento, sum(d.clientes) filter (where d.desfecho = 'sucesso') as s,
                      sum(d.clientes) filter (where d.desfecho = 'nao') as nn,
                      sum(d.clientes) filter (where d.desfecho = 'cobranca') as cob
                 from public.jornada_desfechos d
                where d.credor_id = credor and d.data between de and ate group by d.momento)
    select m.momento, public.rotulo_momento(m.momento), m.ordem, coalesce(h.n, 0), coalesce(ac.n, 0),
           coalesce(r.s, 0), coalesce(r.nn, 0),
           case when m.momento <> 'cobranca' then round(100.0 * r.s / nullif(coalesce(r.s, 0) + coalesce(r.nn, 0), 0), 1) end,
           case when m.momento = 'cobranca' then (select coalesce(sum(d.clientes), 0) from public.jornada_desfechos d
                                                  where d.credor_id = credor and d.data between de and ate
                                                    and d.desfecho = 'cobranca')
                else coalesce(r.cob, 0) end
      from m
      left join hoje h on h.fase = m.momento
      left join acao ac on ac.momento = m.momento
      left join r on r.momento = m.momento
     order by m.ordem
$$;

-- Resultado por canal num momento: acionados e custo (ações da régua) e o custo por resultado
create or replace function public.resultado_jornada(credor bigint, de date, ate date, momento text default null)
returns table (momento text, canal text, acionamentos bigint, sucesso bigint, nao bigint, taxa numeric,
               custo numeric, custo_por_sucesso numeric)
language sql stable security invoker set search_path = public as $$
    with r as (select d.momento, d.canal,
                      sum(d.clientes) filter (where d.desfecho = 'sucesso') as s,
                      sum(d.clientes) filter (where d.desfecho = 'nao') as nn
                 from public.jornada_desfechos d
                where d.credor_id = credor and d.data between de and ate and d.desfecho <> 'cobranca'
                  and (resultado_jornada.momento is null or d.momento = resultado_jornada.momento)
                group by d.momento, d.canal),
         a as (select x.regua as momento, x.canal, sum(x.enviadas) as env, sum(x.custo) as custo
                 from public.acoes_dia x
                where x.credor_id = credor and x.data between de and ate
                  and (resultado_jornada.momento is null or x.regua = resultado_jornada.momento)
                group by x.regua, x.canal)
    select coalesce(r.momento, a.momento), coalesce(nullif(coalesce(r.canal, a.canal), ''), 'sem ação'),
           coalesce(a.env, 0), coalesce(r.s, 0), coalesce(r.nn, 0),
           round(100.0 * r.s / nullif(coalesce(r.s, 0) + coalesce(r.nn, 0), 0), 1),
           coalesce(a.custo, 0), round(a.custo / nullif(r.s, 0), 2)
      from r full join a on a.momento = r.momento and a.canal = r.canal
     order by 1, 4 desc
$$;
-- resultado de cada mensagem (para comparar textos): taxa do momento entre quem a recebeu por último
create or replace function public.resultado_frases(credor bigint, de date, ate date)
returns table (frase_id bigint, momento text, sucesso bigint, nao bigint, taxa numeric)
language sql stable security invoker set search_path = public as $$
    select d.frase_id, d.momento, sum(d.clientes) filter (where d.desfecho = 'sucesso'),
           sum(d.clientes) filter (where d.desfecho = 'nao'),
           round(100.0 * sum(d.clientes) filter (where d.desfecho = 'sucesso')
                 / nullif(sum(d.clientes) filter (where d.desfecho in ('sucesso', 'nao')), 0), 1)
      from public.jornada_desfechos d
     where d.credor_id = credor and d.data between de and ate and d.frase_id > 0
     group by d.frase_id, d.momento
$$;
revoke all on function public.resultado_frases(bigint, date, date) from public, anon;
grant execute on function public.resultado_frases(bigint, date, date) to authenticated, service_role;
revoke all on function public.mapa_jornada(bigint, date, date), public.resultado_jornada(bigint, date, date, text)
    from public, anon;
grant execute on function public.mapa_jornada(bigint, date, date), public.resultado_jornada(bigint, date, date, text)
    to authenticated, service_role;

-- ================================================================ 4. mensagens por momento
alter table public.frases drop constraint if exists frases_estagio_check;
alter table public.frases add constraint frases_estagio_check check (estagio in (
    'localizacao', 'cpa', 'cpb', 'giro', 'preventivo', 'quebra',
    'boas_vindas', 'ativacao', 'pre_vencimento', 'retencao', 'reativacao'));

-- ================================================================ 5. estratégia por carteira (MotorCli)
create or replace function public.carteiras_da_estrategia(estrategia bigint)
returns table (credor_id bigint, nome text)
language sql stable security invoker set search_path = public as $$
    select c.id, coalesce(nullif(trim(c.nome), ''), c.codigo) from public.credores c
     where c.ativo and (c.estrategia_id = estrategia
            or (c.estrategia_id is null and exists (select 1 from public.estrategias e where e.id = estrategia
                                                     and e.padrao and e.frente = c.frente and e.empresa_id = c.empresa_id)))
     order by 2
$$;

-- cópia independente da estratégia para a carteira (de outra carteira ou da que ela usa hoje)
create or replace function public.copiar_estrategia_jornada(credor bigint, origem bigint default null)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
    c public.credores%rowtype;
    o public.credores%rowtype;
    e public.estrategias%rowtype;
    base text;
    nome_novo text;
    n int := 1;
    nova bigint;
begin
    if not public.pode('editar_orquestracao') then
        raise exception 'sem permissão para editar a jornada';
    end if;
    select * into c from public.credores x where x.id = credor and x.frente = 'motorcli';
    if c.id is null then
        raise exception 'carteira da Jornada não encontrada';
    end if;
    select * into o from public.credores x where x.id = coalesce(origem, credor) and x.empresa_id = c.empresa_id
                                              and x.frente = 'motorcli';
    if o.id is null then
        raise exception 'a carteira de origem não é da Jornada desta empresa';
    end if;
    select * into e from public.estrategias x
     where x.id = o.estrategia_id or (o.estrategia_id is null and x.empresa_id = o.empresa_id and x.padrao
                                      and x.frente = 'motorcli')
     order by (x.id = o.estrategia_id) desc limit 1;
    base := left(coalesce(e.nome, 'Jornada'), 48) || ' · ' || left(coalesce(nullif(trim(c.nome), ''), c.codigo), 28);
    nome_novo := base;
    while exists (select 1 from public.estrategias x where x.empresa_id = c.empresa_id and x.nome = nome_novo) loop
        n := n + 1;
        nome_novo := base || ' (' || n || ')';
    end loop;
    insert into public.estrategias (empresa_id, nome, descricao, definicao, padrao, frente)
    values (c.empresa_id, nome_novo, coalesce(e.descricao, ''), coalesce(e.definicao, '{}'::jsonb), false, 'motorcli')
    returning id into nova;
    update public.credores set estrategia_id = nova where id = c.id;
    return nova;
end $$;

-- "Separar só para esta carteira": cópia da que ela usa hoje
create or replace function public.separar_estrategia_jornada(credor bigint) returns bigint
language sql security invoker set search_path = public as $$
    select public.copiar_estrategia_jornada(credor, null)
$$;
revoke all on function public.carteiras_da_estrategia(bigint), public.copiar_estrategia_jornada(bigint, bigint),
    public.separar_estrategia_jornada(bigint) from public, anon;
grant execute on function public.carteiras_da_estrategia(bigint), public.copiar_estrategia_jornada(bigint, bigint),
    public.separar_estrategia_jornada(bigint) to authenticated;

-- ================================================================ 6. relatórios (aba Jornada)
create or replace view public.rel_jornada_resultado with (security_invoker = true) as
select d.empresa_id, d.data, d.credor_id, coalesce(cr.nome, '') as carteira, public.rotulo_momento(d.momento) as momento,
       coalesce(nullif(d.canal, ''), 'sem ação') as canal,
       (case when d.desfecho = 'sucesso' then d.clientes else 0 end) as sucessos,
       (case when d.desfecho = 'nao' then d.clientes else 0 end) as sem_sucesso,
       (case when d.desfecho in ('sucesso', 'nao') then d.clientes else 0 end) as fechados,
       (case when d.desfecho = 'cobranca' then d.clientes else 0 end) as foram_para_cobranca
  from public.jornada_desfechos d
  left join public.credores cr on cr.id = d.credor_id;
create or replace view public.rel_jornada_movimento with (security_invoker = true) as
select v.empresa_id, v.data, v.credor_id, coalesce(cr.nome, '') as carteira, public.rotulo_momento(v.de) as de,
       public.rotulo_momento(v.para) as para, v.clientes
  from public.jornada_movimento v
  left join public.credores cr on cr.id = v.credor_id;
grant select on public.rel_jornada_resultado, public.rel_jornada_movimento to authenticated, service_role;
revoke all on public.rel_jornada_resultado, public.rel_jornada_movimento from anon;

insert into public.relatorio_bases (base, visao, nome, descricao, ordem, produto, visivel, foto_do_dia) values
  ('jornada_resultado',  'rel_jornada_resultado', 'Resultado da jornada', 'Resultado de cada momento por dia e canal: sucessos, sem sucesso e quem foi para a cobrança.', 22, 'jornada', true, false),
  ('jornada_movimento',  'rel_jornada_movimento', 'Movimento da jornada', 'Clientes que mudaram de momento, de onde para onde.', 23, 'jornada', true, false)
on conflict (base) do update set visao = excluded.visao, nome = excluded.nome, descricao = excluded.descricao,
    ordem = excluded.ordem, produto = excluded.produto, visivel = excluded.visivel, foto_do_dia = excluded.foto_do_dia;
insert into public.relatorio_campos (base, campo, rotulo, tipo, agrupavel, filtravel, ordem) values
  ('jornada_resultado', 'data', 'Data', 'data', true, true, 1), ('jornada_resultado', 'carteira', 'Carteira', 'texto', true, true, 2),
  ('jornada_resultado', 'momento', 'Momento', 'texto', true, true, 3), ('jornada_resultado', 'canal', 'Canal', 'texto', true, true, 4),
  ('jornada_resultado', 'sucessos', 'Sucessos', 'numero', false, false, 5), ('jornada_resultado', 'sem_sucesso', 'Sem sucesso', 'numero', false, false, 6),
  ('jornada_resultado', 'fechados', 'Resultados fechados', 'numero', false, false, 7),
  ('jornada_resultado', 'foram_para_cobranca', 'Foram para a cobrança', 'numero', false, false, 8),
  ('jornada_movimento', 'data', 'Data', 'data', true, true, 1), ('jornada_movimento', 'carteira', 'Carteira', 'texto', true, true, 2),
  ('jornada_movimento', 'de', 'De', 'texto', true, true, 3), ('jornada_movimento', 'para', 'Para', 'texto', true, true, 4),
  ('jornada_movimento', 'clientes', 'Clientes', 'numero', false, true, 5)
on conflict (base, campo) do update set rotulo = excluded.rotulo, tipo = excluded.tipo, agrupavel = excluded.agrupavel,
                                        filtravel = excluded.filtravel, ordem = excluded.ordem;
insert into public.relatorios_modelos (empresa_id, nome, descricao, categoria, base, colunas, agrupar, metricas, filtros,
                                       ordem, destaque, requer) values
  (null, 'A jornada está dando resultado?', 'Resultado de cada momento por canal: sucessos, taxa e quem foi para a cobrança.', 'Jornada', 'jornada_resultado', null,
   array['momento', 'canal'],
   '[{"funcao":"somar","campo":"fechados","nome":"fechados","rotulo":"Resultados fechados"},{"funcao":"somar","campo":"sucessos","nome":"sucessos","rotulo":"Sucessos"},{"funcao":"taxa","num":"sucessos","den":"fechados","nome":"taxa_sucesso","rotulo":"Taxa de sucesso","sentido":"maior_melhor"},{"funcao":"somar","campo":"foram_para_cobranca","nome":"cobranca","rotulo":"Foram para a cobrança","sentido":"menor_melhor"}]',
   '{}', 'fechados desc', true, null),
  (null, 'Para onde os clientes foram?', 'Clientes que mudaram de momento, de onde para onde.', 'Jornada', 'jornada_movimento', null,
   array['de', 'para'], '[{"funcao":"somar","campo":"clientes","nome":"clientes","rotulo":"Clientes"}]', '{}', 'clientes desc', false, null)
on conflict (empresa_id, nome) do update set descricao = excluded.descricao, categoria = excluded.categoria,
    base = excluded.base, colunas = excluded.colunas, agrupar = excluded.agrupar, metricas = excluded.metricas,
    filtros = excluded.filtros, ordem = excluded.ordem, destaque = excluded.destaque, requer = excluded.requer;
