-- SQL 73 · LGPD: o CPF nunca é o id do cliente · rascunho de fatura cancelado pode ser gerado de novo
-- (o SQL 72 é o 20270108000001_estimativa_ciclo_distintos.sql; o número 70 ficou sem uso)
--
-- 1) Decisão do dono (07/11/2026): o CPF nunca é usado como identificador do cliente. No layout automático sem código
--    de cliente o motor usava o próprio CPF como id_cliente, e ele ia para estado_cliente, fila_dia (Lista do dia),
--    trilha, voz, mensageria e para as listas do Storage. Agora o motor troca o CPF por um código pseudônimo estável:
--        MX + 16 letras = HMAC-SHA256(faturamento_sal da empresa, 'motorcx:id_cliente:v1:' || dígitos do documento)
--    (motor/pseudonimo.py). Mesmo cliente → mesmo código todo dia; credor que manda código de cliente não muda.
--    * parece_cpf(texto): 000.000.000-00 ou 11 dígitos com dígito verificador válido (a mesma regra do motor).
--    * id_cliente_pseudonimo(empresa, valor): a mesma conta do motor, no banco (só o servidor; o sal nunca sai).
--    * rechavear_clientes(empresa, credor, pares): a rotina manda os pares antigo → novo da troca local (inclusive
--      ids antigos que não têm cara de CPF, como CNPJ ou CPF sem o zero à esquerda) e o banco troca em todas as tabelas
--      com id_cliente (e o 'cliente:<id>' de contratos_mes). Linha antiga cujo código novo já existe é apagada (fica
--      a nova). Os pares não são guardados.
--    * Aqui mesmo: tudo o que já está gravado com cara de CPF é trocado pelo código (todas as empresas), e cada tabela
--      ganha o check "<tabela>_id_cliente_sem_cpf" (id_cliente nunca com cara de CPF). As listas antigas do Storage são
--      republicadas pela rotina (o banco não mexe no Storage).
--    Ordem de implantação: primeiro a imagem do motor nova (ela já grava o código), depois este SQL. Com o SQL antes, a
--    rotina antiga de um credor sem código de cliente para no check até a imagem nova subir.
--    O sal (faturamento_sal) não pode mudar: muda o código de todos os clientes.
--
-- 2) Faturamento: cancelar_rascunho (SQL 71) deixa a fatura 'cancelada' (fica para o histórico). Agora gerar_rascunhos e
--    fechar_fatura ignoram o rascunho cancelado (nunca emitido) e geram um rascunho novo para a empresa/competência.
--    A unicidade (empresa_id, competencia) passa a valer só para as faturas não canceladas (índice parcial). Fatura
--    emitida e depois cancelada continua segurando a competência (gerar de novo nesse caso é decisão manual).
--
-- Nada para anon. Sem superusuário. Pode rodar de novo sem erro.

-- ---------------------------------------------------------------- 1. CPF nunca é o id do cliente
create or replace function public.parece_cpf(valor text) returns boolean
language plpgsql immutable parallel safe set search_path = public as $$
declare
    d text := regexp_replace(coalesce(valor, ''), '^\s+|\s+$', '', 'g');
    s int;
    i int;
begin
    if d ~ '^\d{3}\.\d{3}\.\d{3}-\d{2}$' then
        return true;
    end if;
    if d !~ '^\d{11}$' or d ~ '^(\d)\1{10}$' then
        return false;
    end if;
    s := 0;
    for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
    if (s * 10 % 11) % 10 <> substr(d, 10, 1)::int then
        return false;
    end if;
    s := 0;
    for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
    return (s * 10 % 11) % 10 = substr(d, 11, 1)::int;
end $$;
comment on function public.parece_cpf(text) is
    'Texto com cara de CPF (000.000.000-00, ou 11 dígitos com dígito verificador válido). Barra o CPF em id_cliente. SQL 73.';

-- HMAC-SHA256 com o sha256 do próprio Postgres (o banco não tem pgcrypto): o mesmo do hmac do Python.
create or replace function public.hmac_sha256_motorcx(chave bytea, mensagem bytea) returns bytea
language plpgsql immutable strict parallel safe set search_path = public as $$
declare
    k bytea := case when length(chave) > 64 then sha256(chave) else chave end;
    ki bytea;
    ko bytea;
    i int;
begin
    k := k || decode(repeat('00', 64 - length(k)), 'hex');
    ki := k;
    ko := k;
    for i in 0..63 loop
        ki := set_byte(ki, i, get_byte(k, i) # 54);    -- 0x36
        ko := set_byte(ko, i, get_byte(k, i) # 92);    -- 0x5c
    end loop;
    return sha256(ko || sha256(ki || mensagem));
end $$;
comment on function public.hmac_sha256_motorcx(bytea, bytea) is 'HMAC-SHA256 (RFC 2104) sobre o sha256 do Postgres. SQL 73.';
revoke all on function public.hmac_sha256_motorcx(bytea, bytea) from public, anon, authenticated;

create or replace function public.id_cliente_pseudonimo(empresa bigint, valor text) returns text
language plpgsql security definer set search_path = public as $$
declare
    alfabeto constant text := 'BCDFGHJKLMNPQRSTVWXZ';
    s text;
    v text := regexp_replace(coalesce(valor, ''), '^\s+|\s+$', '', 'g');
    d text;
    h bytea;
    saida text := 'MX';
    i int;
begin
    select f.sal into s from public.faturamento_sal f where f.empresa_id = empresa;
    if s is null then
        insert into public.faturamento_sal (empresa_id) values (empresa) on conflict (empresa_id) do nothing;
        select f.sal into s from public.faturamento_sal f where f.empresa_id = empresa;
    end if;
    if s is null then
        raise exception 'empresa sem sal (faturamento_sal)';
    end if;
    d := regexp_replace(v, '\D', '', 'g');
    if v ~ '^[0-9./[:space:]-]+$' and length(d) between 1 and 14 and d !~ '^0+$' then
        v := case when length(d) <= 11 then lpad(d, 11, '0') else lpad(d, 14, '0') end;
    end if;
    h := public.hmac_sha256_motorcx(convert_to(s, 'UTF8'), convert_to('motorcx:id_cliente:v1:' || v, 'UTF8'));
    for i in 0..15 loop
        saida := saida || substr(alfabeto, get_byte(h, i) % 20 + 1, 1);
    end loop;
    return saida;
end $$;
comment on function public.id_cliente_pseudonimo(bigint, text) is
    'Código do cliente que era CPF: MX + 16 letras do HMAC-SHA256(sal da empresa, documento). Igual ao do motor '
    '(motor/pseudonimo.py). Só o servidor: com ele daria para ligar CPF a código. SQL 73.';
revoke all on function public.id_cliente_pseudonimo(bigint, text) from public, anon, authenticated;
grant execute on function public.id_cliente_pseudonimo(bigint, text) to service_role;

-- as tabelas que guardam id_cliente (o que o motor, a voz e a mensageria gravam)
create or replace function public.tabelas_id_cliente() returns text[]
language sql immutable set search_path = public as $$
    select array['estado_cliente', 'fila_dia', 'trilha', 'jornada_cliente', 'jornada_cliente_dia', 'jornada_clientes_mes',
                 'mensageria_conversas', 'mensageria_links', 'mensageria_mensagens', 'titular_pedidos', 'voz_alertas',
                 'voz_chamadas', 'voz_gravacoes', 'voz_resubmits', 'crm_chamadas']
$$;
revoke all on function public.tabelas_id_cliente() from public, anon, authenticated;

create or replace function public.rechavear_clientes(empresa bigint, credor bigint, pares jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
    t text;
    pk text;
    tem_pk_id boolean;
    filtro text;
    n int;
    total int := 0;
begin
    if auth.uid() is not null then
        raise exception 'só a rotina troca o id do cliente';
    end if;
    if jsonb_typeof(pares) <> 'array' then
        raise exception 'pares: lista de {de, para}';
    end if;
    if exists (select 1 from jsonb_to_recordset(pares) p(de text, para text)
                where p.para is null or public.parece_cpf(p.para) or p.de is null or p.de = p.para) then
        raise exception 'par inválido (o id novo não pode ter cara de CPF)';
    end if;
    foreach t in array public.tabelas_id_cliente() loop
        continue when to_regclass('public.' || t) is null;
        select string_agg(format('n.%1$I = o.%1$I', a.attname), ' and ') filter (where a.attname <> 'id_cliente'),
               coalesce(bool_or(a.attname = 'id_cliente'), false)
          into pk, tem_pk_id
          from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
         where i.indrelid = ('public.' || t)::regclass and i.indisprimary;
        filtro := case when credor is not null and exists (select 1 from pg_attribute a
                                                               where a.attrelid = ('public.' || t)::regclass
                                                                 and a.attname = 'credor_id' and not a.attisdropped)
                       then format(' and o.credor_id = %s', credor) else '' end;
        if tem_pk_id then   -- o código novo já tem a linha (rodada nova antes da troca): fica a nova
            execute format('delete from public.%1$I o using jsonb_to_recordset($1) p(de text, para text) '
                           'where o.empresa_id = $2 and o.id_cliente = p.de%2$s and exists '
                           '(select 1 from public.%1$I n where n.id_cliente = p.para and %3$s)', t, filtro, pk)
                using pares, empresa;
        end if;
        execute format('update public.%1$I o set id_cliente = p.para from jsonb_to_recordset($1) p(de text, para text) '
                       'where o.empresa_id = $2 and o.id_cliente = p.de%2$s', t, filtro)
            using pares, empresa;
        get diagnostics n = row_count;
        total := total + n;
    end loop;
    -- contratos_mes: cliente sem código de contrato conta como 'cliente:<id>'
    if to_regclass('public.contratos_mes') is not null then
        delete from public.contratos_mes o using jsonb_to_recordset(pares) p(de text, para text)
         where o.empresa_id = empresa and o.contrato = 'cliente:' || p.de
           and (credor is null or o.credor_id = credor)
           and exists (select 1 from public.contratos_mes n
                        where n.empresa_id = o.empresa_id and n.competencia = o.competencia
                          and n.credor_id = o.credor_id and n.contrato = 'cliente:' || p.para);
        update public.contratos_mes o set contrato = 'cliente:' || p.para from jsonb_to_recordset(pares) p(de text, para text)
         where o.empresa_id = empresa and o.contrato = 'cliente:' || p.de and (credor is null or o.credor_id = credor);
        get diagnostics n = row_count;
        total := total + n;
    end if;
    return total;
end $$;
comment on function public.rechavear_clientes(bigint, bigint, jsonb) is
    'Troca ids antigos (CPF) pelo código pseudônimo em todas as tabelas com id_cliente (e contratos_mes). Só a rotina '
    '(nuvem/ids_cliente.py); os pares não são guardados. SQL 73.';
revoke all on function public.rechavear_clientes(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.rechavear_clientes(bigint, bigint, jsonb) to service_role;

-- o que já está gravado com cara de CPF vira o código (todas as empresas; o regex corta antes da conta do dígito)
do $troca$
declare
    t text;
    e bigint;
    pares jsonb;
    uniao text := '';
begin
    foreach t in array public.tabelas_id_cliente() loop
        continue when to_regclass('public.' || t) is null;
        uniao := uniao || case when uniao = '' then '' else ' union ' end
              || format('select empresa_id, id_cliente as de from public.%I '
                        'where id_cliente ~ ''^\s*(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})\s*$'' '
                        'and public.parece_cpf(id_cliente)', t);
    end loop;
    if to_regclass('public.contratos_mes') is not null then
        uniao := uniao || ' union select empresa_id, substr(contrato, 9) from public.contratos_mes '
                       || 'where contrato like ''cliente:%'' and public.parece_cpf(substr(contrato, 9))';
    end if;
    execute 'create temporary table if not exists ids_cpf_sql73 (empresa_id bigint, de text) on commit drop';
    execute 'insert into ids_cpf_sql73 ' || uniao;
    for e in select distinct x.empresa_id from ids_cpf_sql73 x where x.empresa_id is not null loop
        select jsonb_agg(jsonb_build_object('de', x.de, 'para', public.id_cliente_pseudonimo(e, x.de)))
          into pares
          from (select distinct de from ids_cpf_sql73 where empresa_id = e) x;
        perform public.rechavear_clientes(e, null, pares);
    end loop;
    drop table ids_cpf_sql73;
end $troca$;

-- a trava: id_cliente nunca com cara de CPF (o motor também barra antes de gravar)
do $trava$
declare
    t text;
    c text;
begin
    foreach t in array public.tabelas_id_cliente() loop
        continue when to_regclass('public.' || t) is null;
        c := t || '_id_cliente_sem_cpf';
        if not exists (select 1 from pg_constraint where conname = c and conrelid = ('public.' || t)::regclass) then
            execute format('alter table public.%I add constraint %I check (not public.parece_cpf(id_cliente)) not valid',
                           t, c);
        end if;
        execute format('alter table public.%I validate constraint %I', t, c);
    end loop;
    if to_regclass('public.contratos_mes') is not null
       and not exists (select 1 from pg_constraint where conname = 'contratos_mes_cliente_sem_cpf') then
        alter table public.contratos_mes add constraint contratos_mes_cliente_sem_cpf
            check (contrato not like 'cliente:%' or not public.parece_cpf(substr(contrato, 9))) not valid;
    end if;
    if to_regclass('public.contratos_mes') is not null then
        alter table public.contratos_mes validate constraint contratos_mes_cliente_sem_cpf;
    end if;
end $trava$;

-- ---------------------------------------------------------------- 2. rascunho cancelado pode ser gerado de novo
alter table public.faturas drop constraint if exists faturas_empresa_id_competencia_key;
create unique index if not exists faturas_empresa_competencia_ativa
    on public.faturas (empresa_id, competencia) where situacao <> 'cancelada';
comment on index public.faturas_empresa_competencia_ativa is
    'Uma fatura não cancelada por empresa e competência; a cancelada fica para o histórico. SQL 73.';

-- a competência "já tem fatura" quando há uma não cancelada ou uma cancelada que chegou a ser emitida
create or replace function public.competencia_tem_fatura(empresa bigint, competencia date) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.faturas f
                    where f.empresa_id = competencia_tem_fatura.empresa
                      and f.competencia = competencia_tem_fatura.competencia
                      and (f.situacao <> 'cancelada' or f.emitida_em is not null))
$$;
comment on function public.competencia_tem_fatura(bigint, date) is
    'A competência da empresa já tem fatura (rascunho cancelado, nunca emitido, não conta). SQL 73.';
revoke all on function public.competencia_tem_fatura(bigint, date) from public, anon, authenticated;
grant execute on function public.competencia_tem_fatura(bigint, date) to service_role;

create or replace function public.fechar_fatura(empresa bigint, competencia date) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    mes date := public.competencia_de(empresa, competencia);
    p public.planos_empresa;
    fid bigint;
    total numeric;
begin
    if auth.uid() is not null and not public.equipe_pode('emitir_faturas', fechar_fatura.empresa) then
        raise exception 'só o Admin da equipe MotorCX fecha fatura';
    end if;
    if (public.ciclo_de(empresa, mes)).fim >= current_date then
        raise exception 'só dá para fechar o ciclo depois que ele termina';
    end if;
    if (select c.modelo_pagamento from public.ciclo_empresa c where c.empresa_id = empresa) = 'pre' then
        raise exception 'empresa pré-paga não tem fatura: o uso desconta do saldo';
    end if;
    if not exists (select 1 from public.precos_empresa x where x.empresa_id = empresa) then
        raise exception 'empresa sem preço cadastrado';
    end if;
    if public.competencia_tem_fatura(empresa, mes) then
        raise exception 'fatura deste ciclo já foi fechada';
    end if;
    select * into p from public.planos_empresa where empresa_id = empresa;
    select coalesce(sum(v.valor), 0) into total from public.previa_fatura(empresa, mes) v;
    insert into public.faturas (empresa_id, competencia, situacao, valor_total, itens_total, vencimento, modelo)
        values (empresa, mes, 'rascunho', total, total, public.vencimento_de(empresa, mes),
                coalesce(p.orquestracao_modelo, 'por_produto'))
        returning id into fid;
    insert into public.fatura_itens (fatura_id, ordem, item, descricao, quantidade, preco, valor)
        select fid, v.ordem, v.item, v.descricao, v.quantidade, v.preco, v.valor from public.previa_fatura(empresa, mes) v;
    return fid;
end $$;

create or replace function public.gerar_rascunhos(competencia date) returns int
language plpgsql security definer set search_path = public as $$
declare
    mes date := date_trunc('month', competencia)::date;
    e record;
    comp date;
    n int := 0;
begin
    if auth.uid() is not null and not public.admin_equipe() then
        raise exception 'só o Admin da equipe MotorCX gera rascunhos';
    end if;
    for e in select x.id, c.periodicidade, c.modelo_pagamento from public.empresas x
               left join public.ciclo_empresa c on c.empresa_id = x.id
              where x.situacao in ('ativa', 'implantacao', 'suspensa')
                and exists (select 1 from public.precos_empresa p where p.empresa_id = x.id)
              order by x.id loop
        if coalesce(e.modelo_pagamento, 'pos') = 'pre' then
            continue;
        end if;
        comp := case when e.periodicidade = 'dias'
                     then public.competencia_de(e.id, (public.ciclo_de(e.id, public.competencia_de(e.id, current_date))).inicio - 1)
                     else mes end;
        if public.competencia_tem_fatura(e.id, comp) or (public.ciclo_de(e.id, comp)).fim >= current_date then
            continue;
        end if;
        perform public.fechar_fatura(e.id, comp);
        n := n + 1;
    end loop;
    return n;
end $$;
comment on function public.gerar_rascunhos(date) is
    'Rascunho de fatura para quem ainda não tem na competência; rascunho cancelado (nunca emitido) não conta e é '
    'gerado de novo. SQL 73.';
revoke execute on function public.gerar_rascunhos(date), public.fechar_fatura(bigint, date) from public, anon;
grant execute on function public.gerar_rascunhos(date), public.fechar_fatura(bigint, date) to authenticated, service_role;
