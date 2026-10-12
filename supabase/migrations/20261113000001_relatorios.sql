-- Relatórios da Mensageria: os padrões de mercado e o montador de relatório personalizado.
-- * Bases (views com as permissões de quem consulta): mensagens (analítico), envios (sintético por dia, campanha e
--   canal), respostas (Radar), cliques, descadastros e consumo por centro de custo. Nenhuma tem telefone, e-mail,
--   nome ou CPF: só ID do cliente e destino mascarado.
-- * relatorio_campos: o que cada base oferece (rótulo, tipo, se agrupa e se filtra). O site monta a tela a partir dele.
-- * rodar_relatorio(base, colunas, filtros, agrupar, metricas, ordem, limite): monta a consulta só com campos do
--   catálogo, roda com as permissões de quem chamou e devolve as linhas em JSON (até 50.000; 20 s no máximo).
-- * relatorios_modelos: os relatórios padrão (empresa vazia, para todos) e os salvos por cada empresa.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- bases
create or replace view public.rel_mensagens with (security_invoker = true) as
select m.empresa_id, l.data, l.canal, l.campanha_id, coalesce(c.nome, 'Lista do dia') as origem, m.id_cliente,
       m.destino_mascara as destino, m.operadora, m.item as tipo, m.situacao, m.motivo, m.fallback,
       (m.respondida_em is not null) as respondeu, m.enviado_em, m.tentativas
  from public.mensageria_mensagens m
  join public.mensageria_lotes l on l.id = m.lote_id
  left join public.mensageria_campanhas c on c.id = l.campanha_id;

create or replace view public.rel_envios with (security_invoker = true) as
select f.empresa_id, f.data, f.canal, f.campanha_id, f.origem, f.carregados, f.invalidos, f.bloqueados, f.higienizados,
       f.enviados, f.entregues, f.nao_entregues, f.fallback, f.descadastros, f.respostas
  from public.mensageria_funil f;

create or replace view public.rel_respostas with (security_invoker = true) as
select v.empresa_id, (v.ultima_em at time zone 'America/Sao_Paulo')::date as data, v.canal, v.campanha_id,
       coalesce(c.nome, 'Lista do dia') as origem, v.id_cliente, v.destino_mascara as destino,
       coalesce(v.classe, 'sem_classe') as classe, v.confianca, v.situacao
  from public.mensageria_conversas v
  left join public.mensageria_campanhas c on c.id = v.campanha_id;

create or replace view public.rel_cliques with (security_invoker = true) as
select k.empresa_id, (q.clicado_em at time zone 'America/Sao_Paulo')::date as data,
       extract(hour from q.clicado_em at time zone 'America/Sao_Paulo')::int as hora, k.canal, k.campanha_id,
       coalesce(c.nome, 'Lista do dia') as origem, k.id_cliente, q.dispositivo, k.codigo
  from public.mensageria_cliques q
  join public.mensageria_links k on k.codigo = q.codigo
  left join public.mensageria_campanhas c on c.id = k.campanha_id
 where q.dispositivo <> 'robo';

create or replace view public.rel_descadastros with (security_invoker = true) as
select d.empresa_id, (d.criado_em at time zone 'America/Sao_Paulo')::date as data, d.canal, d.origem,
       d.destino_mascara as destino
  from public.mensageria_descadastros d;

create or replace view public.rel_consumo_centro with (security_invoker = true) as
select c.empresa_id, k.competencia as data, c.nome as centro, k.item, k.quantidade, c.orcamento_mensal
  from public.mensageria_consumo_centro k
  join public.mensageria_centros_custo c on c.id = k.centro_id;

grant select on public.rel_mensagens, public.rel_envios, public.rel_respostas, public.rel_cliques,
    public.rel_descadastros, public.rel_consumo_centro to authenticated;
revoke all on public.rel_mensagens, public.rel_envios, public.rel_respostas, public.rel_cliques,
    public.rel_descadastros, public.rel_consumo_centro from anon;

-- ---------------------------------------------------------------- catálogo de campos
create table if not exists public.relatorio_bases (
    base       text primary key,
    visao      text not null unique,
    nome       text not null,
    descricao  text not null,
    ordem      int not null default 100
);
create table if not exists public.relatorio_campos (
    base       text not null references public.relatorio_bases (base) on delete cascade,
    campo      text not null check (campo ~ '^[a-z_]+$'),
    rotulo     text not null,
    tipo       text not null check (tipo in ('texto', 'numero', 'data', 'booleano')),
    agrupavel  boolean not null default false,
    filtravel  boolean not null default true,
    ordem      int not null default 100,
    primary key (base, campo)
);
insert into public.relatorio_bases (base, visao, nome, descricao, ordem) values
  ('mensagens',    'rel_mensagens',      'Mensagens (analítico)',       'Uma linha por mensagem: situação, motivo, operadora, tipo, fallback e resposta.', 1),
  ('envios',       'rel_envios',         'Envios (sintético)',          'Por dia, canal e origem: carregados, higienização, enviados, entregues e respostas.', 2),
  ('respostas',    'rel_respostas',      'Respostas (Radar)',           'Conversas com a classificação do Radar MotorCob.', 3),
  ('cliques',      'rel_cliques',        'Cliques nos links',           'Cada clique de pessoa (sem robôs) nos links rastreados.', 4),
  ('descadastros', 'rel_descadastros',   'Descadastros',                'Quem pediu para não receber mais, por canal e origem.', 5),
  ('consumo',      'rel_consumo_centro', 'Consumo por centro de custo', 'Quantidade por item, mês e centro de custo.', 6)
on conflict (base) do update set visao = excluded.visao, nome = excluded.nome, descricao = excluded.descricao,
                                 ordem = excluded.ordem;
insert into public.relatorio_campos (base, campo, rotulo, tipo, agrupavel, filtravel, ordem) values
  ('mensagens', 'data', 'Data', 'data', true, true, 1), ('mensagens', 'canal', 'Canal', 'texto', true, true, 2),
  ('mensagens', 'origem', 'Origem', 'texto', true, true, 3), ('mensagens', 'campanha_id', 'Campanha (código)', 'numero', true, true, 4),
  ('mensagens', 'id_cliente', 'ID do cliente', 'texto', false, true, 5), ('mensagens', 'destino', 'Destino (mascarado)', 'texto', false, false, 6),
  ('mensagens', 'operadora', 'Operadora', 'texto', true, true, 7), ('mensagens', 'tipo', 'Tipo', 'texto', true, true, 8),
  ('mensagens', 'situacao', 'Situação', 'texto', true, true, 9), ('mensagens', 'motivo', 'Motivo', 'texto', true, true, 10),
  ('mensagens', 'fallback', 'Fallback', 'texto', true, true, 11), ('mensagens', 'respondeu', 'Respondeu', 'booleano', true, true, 12),
  ('mensagens', 'enviado_em', 'Enviado em', 'data', false, true, 13), ('mensagens', 'tentativas', 'Tentativas', 'numero', false, true, 14),
  ('envios', 'data', 'Data', 'data', true, true, 1), ('envios', 'canal', 'Canal', 'texto', true, true, 2),
  ('envios', 'origem', 'Origem', 'texto', true, true, 3), ('envios', 'campanha_id', 'Campanha (código)', 'numero', true, true, 4),
  ('envios', 'carregados', 'Carregados', 'numero', false, false, 5), ('envios', 'invalidos', 'Inválidos', 'numero', false, false, 6),
  ('envios', 'bloqueados', 'Bloqueados', 'numero', false, false, 7), ('envios', 'higienizados', 'Higienizados', 'numero', false, false, 8),
  ('envios', 'enviados', 'Enviados', 'numero', false, false, 9), ('envios', 'entregues', 'Entregues', 'numero', false, false, 10),
  ('envios', 'nao_entregues', 'Não entregues', 'numero', false, false, 11), ('envios', 'fallback', 'Fallback', 'numero', false, false, 12),
  ('envios', 'descadastros', 'Descadastros', 'numero', false, false, 13), ('envios', 'respostas', 'Respostas', 'numero', false, false, 14),
  ('respostas', 'data', 'Data', 'data', true, true, 1), ('respostas', 'canal', 'Canal', 'texto', true, true, 2),
  ('respostas', 'origem', 'Origem', 'texto', true, true, 3), ('respostas', 'campanha_id', 'Campanha (código)', 'numero', true, true, 4),
  ('respostas', 'id_cliente', 'ID do cliente', 'texto', false, true, 5), ('respostas', 'destino', 'Destino (mascarado)', 'texto', false, false, 6),
  ('respostas', 'classe', 'Classificação do Radar', 'texto', true, true, 7), ('respostas', 'confianca', 'Confiança', 'numero', false, true, 8),
  ('respostas', 'situacao', 'Situação', 'texto', true, true, 9),
  ('cliques', 'data', 'Data', 'data', true, true, 1), ('cliques', 'hora', 'Hora', 'numero', true, true, 2),
  ('cliques', 'canal', 'Canal', 'texto', true, true, 3), ('cliques', 'origem', 'Origem', 'texto', true, true, 4),
  ('cliques', 'campanha_id', 'Campanha (código)', 'numero', true, true, 5), ('cliques', 'id_cliente', 'ID do cliente', 'texto', true, true, 6),
  ('cliques', 'dispositivo', 'Aparelho', 'texto', true, true, 7), ('cliques', 'codigo', 'Link', 'texto', true, true, 8),
  ('descadastros', 'data', 'Data', 'data', true, true, 1), ('descadastros', 'canal', 'Canal', 'texto', true, true, 2),
  ('descadastros', 'origem', 'Origem', 'texto', true, true, 3), ('descadastros', 'destino', 'Destino (mascarado)', 'texto', false, false, 4),
  ('consumo', 'data', 'Mês', 'data', true, true, 1), ('consumo', 'centro', 'Centro de custo', 'texto', true, true, 2),
  ('consumo', 'item', 'Item', 'texto', true, true, 3), ('consumo', 'quantidade', 'Quantidade', 'numero', false, true, 4),
  ('consumo', 'orcamento_mensal', 'Orçamento do mês', 'numero', false, false, 5)
on conflict (base, campo) do update set rotulo = excluded.rotulo, tipo = excluded.tipo, agrupavel = excluded.agrupavel,
                                        filtravel = excluded.filtravel, ordem = excluded.ordem;
alter table public.relatorio_bases enable row level security;
alter table public.relatorio_campos enable row level security;
drop policy if exists relatorio_bases_ver on public.relatorio_bases;
create policy relatorio_bases_ver on public.relatorio_bases for select to authenticated using (true);
drop policy if exists relatorio_campos_ver on public.relatorio_campos;
create policy relatorio_campos_ver on public.relatorio_campos for select to authenticated using (true);
revoke insert, update, delete on public.relatorio_bases, public.relatorio_campos from authenticated;
revoke all on public.relatorio_bases, public.relatorio_campos from anon;

-- ---------------------------------------------------------------- montador
-- filtros: {"empresa": 1, "de": "2026-10-01", "ate": "2026-10-31",
--           "campos": [{"campo": "canal", "op": "igual|diferente|em|contem|maior|menor|vazio|preenchido", "valor": ...}]}
-- metricas: [{"funcao": "contar|contar_distintos|somar|media|minimo|maximo", "campo": "enviados", "nome": "Enviados"}]
-- Sem agrupar: devolve as colunas linha a linha. Com agrupar: as colunas de agrupamento + as métricas.
create or replace function public.rodar_relatorio(base text, colunas text[] default null, filtros jsonb default '{}',
                                                  agrupar text[] default null, metricas jsonb default null,
                                                  ordem text default null, limite int default 1000)
returns setof jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
    b public.relatorio_bases;
    campos text[];
    numericos text[];
    filtraveis text[];
    tipos jsonb;
    sel text[] := '{}';
    onde text[] := '{}';
    f jsonb;
    m jsonb;
    c text;
    op text;
    fn text;
    expr text;
    sqltxt text;
    n int := 0;
    lim int := least(greatest(coalesce(limite, 1000), 1), 50000);
begin
    perform set_config('statement_timeout', '20000', true);
    select * into b from public.relatorio_bases x where x.base = rodar_relatorio.base;
    if b.base is null then
        raise exception 'base de relatório desconhecida: %', rodar_relatorio.base;
    end if;
    select array_agg(x.campo), array_agg(x.campo) filter (where x.tipo = 'numero'),
           array_agg(x.campo) filter (where x.filtravel), jsonb_object_agg(x.campo, x.tipo)
      into campos, numericos, filtraveis, tipos
      from public.relatorio_campos x where x.base = b.base;
    if (filtros ->> 'empresa') is null then
        raise exception 'escolha a empresa';
    end if;
    onde := onde || format('empresa_id = %s', (filtros ->> 'empresa')::bigint);
    if filtros ? 'de' then onde := onde || format('data >= %L::date', filtros ->> 'de'); end if;
    if filtros ? 'ate' then onde := onde || format('data <= %L::date', filtros ->> 'ate'); end if;
    for f in select * from jsonb_array_elements(coalesce(filtros -> 'campos', '[]')) loop
        c := f ->> 'campo';
        op := coalesce(f ->> 'op', 'igual');
        if not c = any (filtraveis) then
            raise exception 'não dá para filtrar por %', c;
        end if;
        onde := onde || case op
            when 'igual'      then format('%I::text = %L', c, f ->> 'valor')
            when 'diferente'  then format('%I::text is distinct from %L', c, f ->> 'valor')
            when 'contem'     then format('%I::text ilike %L', c, '%' || replace(replace(f ->> 'valor', '%', '\%'), '_', '\_') || '%')
            when 'em'         then format('%I::text = any (%L::text[])', c,
                                          (select array_agg(v) from jsonb_array_elements_text(f -> 'valor') v))
            when 'maior'      then format('%I > %L', c, f ->> 'valor')
            when 'menor'      then format('%I < %L', c, f ->> 'valor')
            when 'vazio'      then format('%I is null', c)
            when 'preenchido' then format('%I is not null', c)
            else null end;
        if onde[array_length(onde, 1)] is null then
            raise exception 'operador inválido: %', op;
        end if;
    end loop;
    if coalesce(array_length(agrupar, 1), 0) > 0 then
        foreach c in array agrupar loop
            if not exists (select 1 from public.relatorio_campos x where x.base = b.base and x.campo = c and x.agrupavel) then
                raise exception 'não dá para agrupar por %', c;
            end if;
            sel := sel || format('%I', c);
        end loop;
        if metricas is null or jsonb_array_length(metricas) = 0 then
            metricas := '[{"funcao": "contar", "nome": "quantidade"}]';
        end if;
        for m in select * from jsonb_array_elements(metricas) loop
            fn := m ->> 'funcao';
            c := m ->> 'campo';
            n := n + 1;
            if fn = 'contar' then
                expr := 'count(*)';
            elsif fn = 'contar_distintos' and c = any (campos) then
                expr := format('count(distinct %I)', c);
            elsif fn in ('somar', 'media', 'minimo', 'maximo') and c = any (numericos) then
                expr := format('%s(%I)', case fn when 'somar' then 'sum' when 'media' then 'avg' when 'minimo' then 'min'
                                             else 'max' end, c);
            else
                raise exception 'métrica inválida: % de %', fn, coalesce(c, '—');
            end if;
            sel := sel || format('%s as %I', expr, left(coalesce(nullif(m ->> 'nome', ''), fn || '_' || n), 60));
        end loop;
        sqltxt := format('select %s from %I where %s group by %s', array_to_string(sel, ', '), b.visao,
                         array_to_string(onde, ' and '),
                         (select string_agg(format('%I', g), ', ') from unnest(agrupar) g));
    else
        if coalesce(array_length(colunas, 1), 0) = 0 then
            colunas := campos;
        end if;
        foreach c in array colunas loop
            if not c = any (campos) then
                raise exception 'coluna desconhecida: %', c;
            end if;
            sel := sel || format('%I', c);
        end loop;
        sqltxt := format('select %s from %I where %s', array_to_string(sel, ', '), b.visao, array_to_string(onde, ' and '));
    end if;
    if ordem is not null then
        if ordem !~ '^[a-z_0-9]+( desc| asc)?$' then
            raise exception 'ordem inválida';
        end if;
        sqltxt := sqltxt || format(' order by %I %s', split_part(ordem, ' ', 1),
                                   coalesce(nullif(split_part(ordem, ' ', 2), ''), 'asc'));
    end if;
    sqltxt := format('select to_jsonb(t) from (%s limit %s) t', sqltxt, lim);
    return query execute sqltxt;
end $$;
revoke execute on function public.rodar_relatorio(text, text[], jsonb, text[], jsonb, text, int) from public, anon;
grant execute on function public.rodar_relatorio(text, text[], jsonb, text[], jsonb, text, int) to authenticated;

-- ---------------------------------------------------------------- modelos (padrão e salvos)
create table if not exists public.relatorios_modelos (
    id           bigint generated always as identity primary key,
    empresa_id   bigint references public.empresas (id) on delete cascade,   -- vazio = relatório padrão
    nome         text not null check (length(trim(nome)) between 2 and 80),
    descricao    text check (descricao is null or length(descricao) <= 300),
    categoria    text not null default 'Personalizado',
    base         text not null references public.relatorio_bases (base),
    colunas      text[],
    agrupar      text[],
    metricas     jsonb,
    filtros      jsonb not null default '{}',
    ordem        text,
    criado_por   uuid default auth.uid() references auth.users (id),
    criado_em    timestamptz not null default now(),
    unique nulls not distinct (empresa_id, nome)
);
alter table public.relatorios_modelos enable row level security;
drop policy if exists relatorios_modelos_ver on public.relatorios_modelos;
create policy relatorios_modelos_ver on public.relatorios_modelos for select to authenticated
    using (empresa_id is null or empresa_id in (select public.minhas_empresas()));
drop policy if exists relatorios_modelos_gravar on public.relatorios_modelos;
create policy relatorios_modelos_gravar on public.relatorios_modelos for all to authenticated
    using (empresa_id in (select public.minhas_empresas()))
    with check (empresa_id in (select public.minhas_empresas()));
revoke all on public.relatorios_modelos from anon;

-- relatórios padrão do mercado (o período e a empresa vêm da tela)
insert into public.relatorios_modelos (empresa_id, nome, descricao, categoria, base, colunas, agrupar, metricas, ordem) values
  (null, 'Entregabilidade por dia e canal', 'Carregados, higienizados, enviados, entregues e não entregues por dia.', 'Entrega', 'envios',
   null, array['data', 'canal'], '[{"funcao":"somar","campo":"carregados","nome":"carregados"},{"funcao":"somar","campo":"higienizados","nome":"higienizados"},{"funcao":"somar","campo":"enviados","nome":"enviados"},{"funcao":"somar","campo":"entregues","nome":"entregues"},{"funcao":"somar","campo":"nao_entregues","nome":"nao_entregues"},{"funcao":"somar","campo":"fallback","nome":"fallback"}]', 'data asc'),
  (null, 'Desempenho por campanha', 'Volume, entrega e respostas de cada campanha e da Lista do dia.', 'Entrega', 'envios',
   null, array['origem', 'canal'], '[{"funcao":"somar","campo":"carregados","nome":"carregados"},{"funcao":"somar","campo":"enviados","nome":"enviados"},{"funcao":"somar","campo":"entregues","nome":"entregues"},{"funcao":"somar","campo":"respostas","nome":"respostas"},{"funcao":"somar","campo":"descadastros","nome":"descadastros"}]', 'enviados desc'),
  (null, 'Entrega por operadora', 'SMS enviados e situação por operadora (Vivo, Claro, TIM, Oi, outras).', 'Entrega', 'mensagens',
   null, array['operadora', 'situacao'], '[{"funcao":"contar","nome":"mensagens"}]', 'mensagens desc'),
  (null, 'Motivos de não envio (higienização)', 'Por que as mensagens foram bloqueadas ou não entregues.', 'Higienização', 'mensagens',
   null, array['canal', 'situacao', 'motivo'], '[{"funcao":"contar","nome":"mensagens"}]', 'mensagens desc'),
  (null, 'Respostas por classificação do Radar', 'Quantas conversas em cada classe (CPC Negócio, CPC, Alega pagamento…).', 'Respostas', 'respostas',
   null, array['classe', 'canal'], '[{"funcao":"contar","nome":"conversas"}]', 'conversas desc'),
  (null, 'Cliques por campanha e aparelho', 'Pessoas que clicaram (sem robôs) e total de cliques.', 'Links', 'cliques',
   null, array['origem', 'dispositivo'], '[{"funcao":"contar_distintos","campo":"id_cliente","nome":"pessoas"},{"funcao":"contar","nome":"cliques"}]', 'cliques desc'),
  (null, 'Cliques por hora do dia', 'Melhor horário de engajamento.', 'Links', 'cliques',
   null, array['hora'], '[{"funcao":"contar","nome":"cliques"}]', 'hora asc'),
  (null, 'Descadastros (opt-out)', 'Quem pediu para sair, por canal e origem.', 'Descadastros', 'descadastros',
   null, array['data', 'canal', 'origem'], '[{"funcao":"contar","nome":"descadastros"}]', 'data asc'),
  (null, 'Consumo por centro de custo', 'Quantidade por item e mês em cada centro de custo.', 'Custo', 'consumo',
   null, array['data', 'centro', 'item'], '[{"funcao":"somar","campo":"quantidade","nome":"quantidade"}]', 'data asc'),
  (null, 'Mensagens enviadas (analítico)', 'Uma linha por mensagem, para conferência e auditoria.', 'Analítico', 'mensagens',
   array['data', 'canal', 'origem', 'id_cliente', 'destino', 'operadora', 'tipo', 'situacao', 'motivo', 'fallback', 'respondeu', 'enviado_em'],
   null, null, 'enviado_em desc')
on conflict (empresa_id, nome) do update set descricao = excluded.descricao, categoria = excluded.categoria,
    base = excluded.base, colunas = excluded.colunas, agrupar = excluded.agrupar, metricas = excluded.metricas,
    ordem = excluded.ordem;
