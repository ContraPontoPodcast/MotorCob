-- SQL 76 · Segmentos a partir de condições: prévia de quantos clientes caem em cada segmento (etapa 2)
--
-- Decisão do dono (07/11/2026, "Descrever segmentos e régua", etapa 2): ao montar ou editar segmentos, o site mostra
-- quantos clientes cairiam em cada um HOJE, na ordem da empresa ("o cliente fica no 1º segmento em que se encaixa"),
-- quantos ficam em Demais e de onde eles vêm (segmento de hoje → proposto). Só contagens: nenhum cliente sai do banco.
-- (A reavaliação diária dos segmentos com dias de atraso é do motor, sem SQL: motor/marcacao.reavaliar_diario.)
--
-- 1. atributos_previa: o retrato por cliente que a rotina grava a cada dia (nuvem/sincronizar.publicar_previa,
--    motor/previa.py): id_cliente pseudônimo (SQL 73, nunca o CPF), segmento de hoje (null = Demais), saldo, dias de
--    atraso no dia da rotina, contratos e só os atributos que valem em condição e não identificam ninguém (sem nome,
--    documento, contato, endereço, nascimento ou código). Universo: clientes da carga fora de BLQ/LIQ (quem o motor
--    reavalia). O site NÃO lê a tabela (RLS ligada e sem política; só a rotina, com service_role, grava).
--    Entra em tabelas_id_cliente() (troca de id do SQL 73) e ganha o check "id_cliente sem cara de CPF".
-- 2. previa_numero(texto): o número como o motor lê (motor/cluster.numero: com vírgula = pt-BR; 2+ pontos em grupos
--    de 3 = milhar; um ponto = decimal; "R$" e espaços fora).
-- 3. previa_condicao_sql(condição): a condição como expressão SQL, com a mesma validação de cluster.ler_condicoes e a
--    mesma regra de cluster.condicao_ok (faixa fechada, "é um destes" sem caixa nem espaços, "=" numérico quando os dois
--    lados são número). Uso interno (ninguém executa de fora).
-- 4. previa_segmentacao(empresa, credor, proposta): proposta = {"segmentos": [{"codigo", "nome", "ref",
--    "condicoes": [{campo, op, valor}]}, ...]} NA ORDEM final (o site manda os segmentos em uso na carteira com o
--    editado no lugar dele). Devolve jsonb só com contagens: por segmento (1º que bate e quantos batem sem olhar a
--    ordem), Demais, sobreposições, a matriz "de onde vêm" e os campos sem dado no retrato. Segmento com condição
--    inválida é ignorado com o erro (como o motor faz com regra inválida). security definer: quem pode editar a
--    Orquestração da empresa (pode('editar_orquestracao')) ou a equipe que enxerga a empresa; nada para anon.
-- Pode rodar de novo sem erro.

-- ================================================================ 1. retrato por cliente
create table if not exists public.atributos_previa (
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint not null references public.credores (id) on delete cascade,
    id_cliente      text not null,
    data_base       date not null,
    segmento_atual  text,
    saldo           numeric(16, 2) not null default 0,
    dias_atraso     int not null default 0,
    qtd_contratos   int not null default 1,
    atributos       jsonb not null default '{}'::jsonb check (jsonb_typeof(atributos) = 'object'),
    primary key (empresa_id, credor_id, id_cliente)
);
comment on table public.atributos_previa is
    'Retrato por cliente em cobrança para a prévia de segmentação (só contagens saem, pela previa_segmentacao). '
    'id_cliente pseudônimo; sem nome, documento, contato ou endereço. Gravado pela rotina. SQL 76.';
alter table public.atributos_previa enable row level security;
revoke all on public.atributos_previa from public, anon, authenticated;
grant select, insert, update, delete on public.atributos_previa to service_role;

do $trava$
begin
    if not exists (select 1 from pg_constraint where conname = 'atributos_previa_id_cliente_sem_cpf') then
        alter table public.atributos_previa add constraint atributos_previa_id_cliente_sem_cpf
            check (not public.parece_cpf(id_cliente));
    end if;
end $trava$;

-- a troca do id (SQL 73) passa também por esta tabela
create or replace function public.tabelas_id_cliente() returns text[]
language sql immutable set search_path = public as $$
    select array['estado_cliente', 'fila_dia', 'trilha', 'jornada_cliente', 'jornada_cliente_dia', 'jornada_clientes_mes',
                 'mensageria_conversas', 'mensageria_links', 'mensageria_mensagens', 'titular_pedidos', 'voz_alertas',
                 'voz_chamadas', 'voz_gravacoes', 'voz_resubmits', 'crm_chamadas', 'atributos_previa']
$$;
revoke all on function public.tabelas_id_cliente() from public, anon, authenticated;

-- ================================================================ 2. número como o motor lê
-- Uma expressão só (sem FROM nem SET): o planejador a expande dentro da consulta da prévia (~5x mais rápido por linha).
-- Leitura: s = o texto sem "R$", espaços e NBSP; x = s com vírgula → pt-BR (tira os pontos, vírgula vira ponto), s com
-- 2+ grupos de milhar ("1.000.000") → sem pontos, senão s; número = x quando x tem forma de número.
create or replace function public.previa_numero(v text) returns double precision
language sql immutable parallel safe as $$
    select case when (case when strpos(btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), ',') > 0 then replace(replace(btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), '.', ''), ',', '.')
                     when btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) ~ '^[+-]?[0-9]{1,3}([.][0-9]{3}){2,}$' then replace(btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), '.', '')
                     else btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) end) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,2})?$'
                then (case when strpos(btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), ',') > 0 then replace(replace(btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), '.', ''), ',', '.')
                     when btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) ~ '^[+-]?[0-9]{1,3}([.][0-9]{3}){2,}$' then replace(btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)), '.', '')
                     else btrim(replace(replace(replace(coalesce(v, ''), 'R$', ''), ' ', ''), chr(160), ''), ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)) end)::double precision end
$$;
comment on function public.previa_numero(text) is
    'Número como motor/cluster.numero lê ("1.500,50", "1500.5", "1.000.000", "R$ 10"); null se não é número. SQL 76.';
revoke all on function public.previa_numero(text) from public, anon;
grant execute on function public.previa_numero(text) to authenticated, service_role;

-- ================================================================ 3. condição → expressão SQL (uso interno)
-- Valores da linha: a.saldo, a.dias_atraso, a.qtd_contratos e a.atributos (texto). O texto do campo é o do motor
-- (str(valor).strip().casefold(); saldo como o Python escreve um float: 1500.0).
create or replace function public.previa_condicao_sql(cond jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare
    campo text;
    op text;
    valor jsonb;
    num text;      -- o valor do campo como número
    txt text;      -- o valor do campo como texto do motor
    b double precision;
    lim double precision[];
    itens text[];
    x jsonb;
    t text;
    ws constant text := (' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13));
begin
    if cond is null or jsonb_typeof(cond) <> 'object' then
        raise exception 'condição inválida %', coalesce(cond::text, 'null');
    end if;
    campo := btrim(coalesce(case when jsonb_typeof(cond -> 'campo') in ('string', 'number') then cond ->> 'campo' end, ''), ws);
    op := btrim(coalesce(case when jsonb_typeof(cond -> 'op') <> 'null' then cond ->> 'op' end, ''), ws);
    valor := coalesce(cond -> 'valor', 'null'::jsonb);
    if campo = '' or op not in ('=', '!=', '>', '>=', '<', '<=', 'entre', 'em', 'nao_em', 'contem', 'vazio', 'preenchido') then
        raise exception 'condição inválida %', cond::text;
    end if;
    if campo = 'saldo' then
        num := 'a.saldo::double precision';
        txt := 'case when a.saldo = trunc(a.saldo) then trunc(a.saldo)::bigint::text || ''.0'' '
               'else a.saldo::double precision::text end';
    elsif campo in ('dias_atraso', 'qtd_contratos') then
        num := format('a.%I::double precision', campo);
        txt := format('a.%I::text', campo);
    else
        num := format('public.previa_numero(a.atributos ->> %L)', campo);
        txt := format('lower(btrim(coalesce(a.atributos ->> %L, %L), %L) collate "und-x-icu")', campo, '', ws);
    end if;

    if op = 'vazio' then
        return format('(%s) = %L', txt, '');
    elsif op = 'preenchido' then
        return format('(%s) <> %L', txt, '');
    elsif op in ('>', '>=', '<', '<=') then
        b := case jsonb_typeof(valor) when 'number' then (valor #>> '{}')::double precision
                                      when 'string' then public.previa_numero(valor #>> '{}') end;
        if b is null then
            raise exception '''% % %'': valor precisa ser número (ex.: 1.500,50)', campo, op, valor #>> '{}';
        end if;
        return format('coalesce((%s) %s %s::double precision, false)', num, op, quote_literal(b::text));
    elsif op = 'entre' then
        if jsonb_typeof(valor) = 'array' then
            select array_agg(case jsonb_typeof(e) when 'number' then (e #>> '{}')::double precision
                                                  when 'string' then public.previa_numero(e #>> '{}') end order by n)
              into lim from jsonb_array_elements(valor) with ordinality as z(e, n);
        elsif jsonb_typeof(valor) = 'string' then
            select array_agg(public.previa_numero(p) order by n) into lim
              from unnest(string_to_array(valor #>> '{}', ';')) with ordinality as z(p, n);
        else
            lim := array[null::double precision];
        end if;
        if coalesce(array_length(lim, 1), 0) <> 2 or lim[1] is null or lim[2] is null then
            raise exception '''% entre %'': informe dois números, de e até (ex.: [1500.5, 3000])', campo, valor::text;
        end if;
        if lim[1] > lim[2] then
            raise exception '''% entre %'': o primeiro valor precisa ser menor ou igual ao segundo', campo, valor::text;
        end if;
        return format('coalesce((%s) between %s::double precision and %s::double precision, false)', num,
                      quote_literal(lim[1]::text), quote_literal(lim[2]::text));
    elsif op in ('em', 'nao_em') then
        itens := '{}';
        if jsonb_typeof(valor) = 'array' then
            for x in select e from jsonb_array_elements(valor) e loop
                t := lower(btrim(case when jsonb_typeof(x) = 'null' then '' else x #>> '{}' end, ws) collate "und-x-icu");
                if t <> '' then itens := itens || t; end if;
            end loop;
        else
            foreach t in array string_to_array(case when jsonb_typeof(valor) = 'null' then '' else valor #>> '{}' end, ';') loop
                t := lower(btrim(t, ws) collate "und-x-icu");
                if t <> '' then itens := itens || t; end if;
            end loop;
        end if;
        return format('(%s(%s) = any (%L::text[]))', case when op = 'nao_em' then 'not ' else '' end, txt, itens);
    elsif op = 'contem' then
        t := lower(btrim(case when jsonb_typeof(valor) = 'null' then '' else valor #>> '{}' end, ws) collate "und-x-icu");
        return format('(strpos(%s, %L) > 0)', txt, t);
    else   -- '=' e '!=': como número quando os dois lados são número, senão como texto
        b := case jsonb_typeof(valor) when 'number' then (valor #>> '{}')::double precision
                                      when 'string' then public.previa_numero(valor #>> '{}') end;
        t := lower(btrim(case when jsonb_typeof(valor) = 'null' then '' else valor #>> '{}' end, ws) collate "und-x-icu");
        if b is null then
            return format('(%s(%s) = %L)', case when op = '!=' then 'not ' else '' end, txt, t);
        end if;
        return format('(%s(case when (%s) is not null then (%s) = %s::double precision else (%s) = %L end))',
                      case when op = '!=' then 'not ' else '' end, num, num, quote_literal(b::text), txt, t);
    end if;
end $$;
comment on function public.previa_condicao_sql(jsonb) is
    'Condição de segmento como expressão SQL sobre atributos_previa (a), com a validação e a regra do motor. SQL 76.';
revoke all on function public.previa_condicao_sql(jsonb) from public, anon, authenticated;

-- ================================================================ 4. a prévia (só contagens)
create or replace function public.previa_segmentacao(empresa bigint, credor bigint, proposta jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    segs jsonb;
    s jsonb;
    i int;
    n int;
    expr text;
    exprs text[] := '{}';
    mascara text := '0::bigint';
    erros text[] := '{}';
    campos text[] := '{}';
    c jsonb;
    r record;
    primeiro int;
    total int := 0;
    demais int := 0;
    por_seg int[];
    batem int[];
    sobre jsonb := '{}'::jsonb;
    de_onde jsonb := '{}'::jsonb;
    chave text;
    base date;
    saida_segs jsonb := '[]'::jsonb;
    sem_dado jsonb := '[]'::jsonb;
    j int;
begin
    if auth.uid() is not null and not (public.pode_ver_empresa(empresa)
                                       and (public.pode('editar_orquestracao') or public.sou_equipe())) then
        raise exception 'sem permissão para ver a prévia de segmentação desta empresa';
    end if;
    if not exists (select 1 from public.credores cr where cr.id = credor and cr.empresa_id = empresa) then
        raise exception 'a carteira não é desta empresa';
    end if;
    if proposta is null or jsonb_typeof(proposta) <> 'object' or jsonb_typeof(proposta -> 'segmentos') <> 'array' then
        raise exception 'proposta: {"segmentos": [{"codigo", "nome", "condicoes": [...]}, ...]} na ordem';
    end if;
    segs := proposta -> 'segmentos';
    n := jsonb_array_length(segs);
    if n > 60 then
        raise exception 'no máximo 60 segmentos por prévia';
    end if;

    -- cada segmento vira uma expressão; condição inválida: segmento ignorado, com o erro (como no motor)
    for i in 1 .. n loop
        s := segs -> (i - 1);
        expr := null;
        erros := erros || null::text;
        begin
            if jsonb_typeof(s) <> 'object' then
                raise exception 'segmento inválido';
            end if;
            if s -> 'condicoes' is not null and jsonb_typeof(s -> 'condicoes') not in ('array', 'null') then
                raise exception 'condicoes precisa ser uma lista';
            end if;
            if jsonb_typeof(s -> 'condicoes') = 'array' and jsonb_array_length(s -> 'condicoes') > 0 then
                select string_agg('(' || public.previa_condicao_sql(e) || ')', ' and ' order by k)
                  into expr from jsonb_array_elements(s -> 'condicoes') with ordinality as z(e, k);
                for c in select e from jsonb_array_elements(s -> 'condicoes') e loop
                    campos := campos || btrim(c ->> 'campo');
                end loop;
            else
                expr := 'true';          -- sem condição: vale para todos (como no motor)
            end if;
        exception when others then
            expr := null;
            erros[i] := sqlerrm;
        end;
        exprs := exprs || coalesce(expr, 'false');
        mascara := mascara || format(' | (case when %s then %s::bigint else 0 end)', coalesce(expr, 'false'),
                                     (1::bigint << (i - 1))::text);
    end loop;

    select max(a.data_base) into base from public.atributos_previa a
     where a.empresa_id = empresa and a.credor_id = credor;
    por_seg := array_fill(0, array[greatest(n, 1)]);
    batem := array_fill(0, array[greatest(n, 1)]);

    for r in execute format('select x.m, x.atual, count(*)::int as q from (select %s as m, a.segmento_atual as atual '
                            'from public.atributos_previa a where a.empresa_id = $1 and a.credor_id = $2 '
                            'and a.data_base = $3) x group by 1, 2', mascara)
             using empresa, credor, base loop
        total := total + r.q;
        primeiro := null;
        for i in 1 .. n loop
            if (r.m >> (i - 1)) & 1 = 1 then
                batem[i] := batem[i] + r.q;
                if primeiro is null then
                    primeiro := i;
                end if;
                for j in i + 1 .. n loop
                    if (r.m >> (j - 1)) & 1 = 1 then
                        chave := i || '-' || j;
                        sobre := jsonb_set(sobre, array[chave], to_jsonb(coalesce((sobre ->> chave)::int, 0) + r.q));
                    end if;
                end loop;
            end if;
        end loop;
        if primeiro is null then
            demais := demais + r.q;
        else
            por_seg[primeiro] := por_seg[primeiro] + r.q;
        end if;
        chave := coalesce(r.atual, '') || E'\x1f' || coalesce(primeiro::text, '');
        de_onde := jsonb_set(de_onde, array[chave], to_jsonb(coalesce((de_onde ->> chave)::int, 0) + r.q));
    end loop;

    for i in 1 .. n loop
        s := segs -> (i - 1);
        saida_segs := saida_segs || jsonb_build_object(
            'posicao', i,
            'ref', case when jsonb_typeof(s) = 'object' then s -> 'ref' end,
            'codigo', case when jsonb_typeof(s) = 'object' then left(s ->> 'codigo', 40) end,
            'nome', case when jsonb_typeof(s) = 'object' then left(s ->> 'nome', 120) end,
            'clientes', por_seg[i], 'batem', batem[i], 'erro', erros[i]);
    end loop;

    -- campo de condição que o retrato não traz (coluna fora por parecer dado pessoal, ou que não existe)
    if base is not null then
        select coalesce(jsonb_agg(x.campo order by x.campo), '[]'::jsonb) into sem_dado
          from (select distinct u.campo from unnest(campos) u(campo)
                 where u.campo not in ('saldo', 'dias_atraso', 'qtd_contratos')
                   and not exists (select 1 from public.atributos_previa a
                                    where a.empresa_id = empresa and a.credor_id = credor and a.data_base = base
                                      and a.atributos ? u.campo)) x;
    end if;

    return jsonb_build_object(
        'data_base', base,
        'clientes', total,
        'segmentos', saida_segs,
        'demais', demais,
        'sobreposicao', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'a', split_part(k, '-', 1)::int, 'b', split_part(k, '-', 2)::int, 'clientes', v::int)
                                    order by split_part(k, '-', 1)::int, split_part(k, '-', 2)::int), '[]'::jsonb)
                           from jsonb_each_text(sobre) as t(k, v)),
        'de_onde', (select coalesce(jsonb_agg(jsonb_build_object(
                               'de', nullif(split_part(k, E'\x1f', 1), ''),
                               'para', nullif(split_part(k, E'\x1f', 2), '')::int,
                               'clientes', v::int) order by split_part(k, E'\x1f', 1), k), '[]'::jsonb)
                      from jsonb_each_text(de_onde) as t(k, v)),
        'campos_sem_dado', sem_dado);
end $$;
comment on function public.previa_segmentacao(bigint, bigint, jsonb) is
    'Quantos clientes da carteira cairiam em cada segmento proposto (na ordem), em Demais e de onde vêm; só contagens, '
    'do retrato da última rotina (atributos_previa). Quem edita a Orquestração ou a equipe. SQL 76.';
revoke all on function public.previa_segmentacao(bigint, bigint, jsonb) from public, anon;
grant execute on function public.previa_segmentacao(bigint, bigint, jsonb) to authenticated, service_role;
