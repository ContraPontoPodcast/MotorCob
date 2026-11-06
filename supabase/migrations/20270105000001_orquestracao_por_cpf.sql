-- SQL 69 · Orquestração cobrada por CPF (clientes distintos ativos no ciclo)
-- (o SQL 68 é o 20270104000001_voz_fluxo_equipe.sql)
-- Decisão do dono: a Orquestração é cobrada SÓ por CPF: preço × CPFs distintos ativos no ciclo. Ativo no ciclo = esteve
-- na carteira em cobrança (na carga do motor) em pelo menos um dia do ciclo de faturamento. O mesmo cliente em várias
-- cargas/rodadas conta UMA vez; cliente com vários contratos conta UMA vez; quem saiu (pagou/devolvido) deixa de contar
-- no ciclo seguinte. O modelo de preço continua o do item (flat por unidade, com mínimo opcional; faixa, progressivo e
-- mensalidade seguem funcionando).
-- * clientes_mes: a rotina grava um registro por cliente distinto no ciclo (empresa × credor × competência). A chave
--   (`cliente`) é HMAC-SHA256 com o sal secreto da empresa sobre a chave pseudônima da pessoa (vinda do CPF da carteira,
--   em memória no motor) ou, sem CPF, sobre o id_cliente. NUNCA guarda CPF, nome ou telefone: só 32 hexadecimais (o
--   check barra qualquer outra coisa). Mesmo CPF em dois credores da mesma empresa = a mesma chave = conta UMA vez na
--   fatura (count distinct por empresa); credor_id fica só como detalhe (uso por carteira no demonstrativo).
-- * faturamento_sal: o sal de cada empresa (gerado aqui, nunca sai do banco para o site). Só a rotina (service_role) lê.
-- * previa_fatura: o item 'contratos' (Orquestração) passa a contar CPFs ("Orquestração · CPFs ativos no mês"). Ciclo
--   medido só antes deste SQL (tem contratos_mes e nenhum clientes_mes) continua pelos contratos, com o texto
--   "contratos no ciclo (medição anterior à cobrança por CPF)", para não zerar rascunho de ciclo antigo. No ciclo aberto
--   quando o SQL 69 entra, a contagem por CPF começa na primeira rodada do motor novo (quem saiu antes dela não conta:
--   erro a favor do cliente). Fatura já fechada não muda (os itens ficam congelados em fatura_itens).
-- * contratos_mes continua sendo gravado (informativo: "Contratos avaliados" no demonstrativo).
-- * consumo_mes ('contratos') e demonstrativo_fatura (carteiras.cpfs) seguem a mesma regra.
-- Pode ser rodado de novo sem erro. Sem superusuário e sem OWNER TO (cabe no APLICAR do SQL Editor).

-- ---------------------------------------------------------------- sal da empresa (só a rotina lê)
create table if not exists public.faturamento_sal (
    empresa_id  bigint primary key references public.empresas (id) on delete cascade,
    sal         text not null default encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text
                                                     || clock_timestamp()::text)::bytea), 'hex')
                check (sal ~ '^[0-9a-f]{64}$'),
    criado_em   timestamptz not null default now()
);
comment on table public.faturamento_sal is
    'Sal secreto por empresa para a chave do cliente em clientes_mes (HMAC). Só a rotina (service_role) lê; não mudar: '
    'trocar o sal no meio do ciclo conta o mesmo CPF duas vezes.';
alter table public.faturamento_sal enable row level security;
revoke all on public.faturamento_sal from public, anon, authenticated;
grant select, insert, update on public.faturamento_sal to service_role;
insert into public.faturamento_sal (empresa_id) select id from public.empresas on conflict (empresa_id) do nothing;

-- ---------------------------------------------------------------- medição: CPFs (clientes distintos) do ciclo
create table if not exists public.clientes_mes (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    competencia   date not null,
    credor_id     bigint not null default 0,              -- 0 = empresa sem credores cadastrados
    cliente       text not null check (cliente ~ '^[0-9a-f]{32}$'),
    primeiro_dia  date not null default current_date,
    primary key (empresa_id, competencia, credor_id, cliente)
);
comment on table public.clientes_mes is
    'Orquestração: clientes distintos (CPFs) na carteira em cobrança no ciclo. cliente = HMAC com o sal da empresa '
    '(nunca CPF, nome ou telefone). A fatura conta distinct por empresa. Gravado pela rotina.';
create index if not exists clientes_mes_empresa_cliente on public.clientes_mes (empresa_id, competencia, cliente);
alter table public.clientes_mes enable row level security;
drop policy if exists clientes_mes_ver on public.clientes_mes;
create policy clientes_mes_ver on public.clientes_mes for select to authenticated using (public.ve_faturamento(empresa_id));
revoke all on public.clientes_mes from anon;
revoke insert, update, delete, truncate on public.clientes_mes from authenticated;

-- ---------------------------------------------------------------- catálogo: a unidade da Orquestração é o CPF
update public.cobranca_itens set nome = 'Orquestração', unidade = 'CPF'
 where codigo = 'contratos' and (nome, unidade) is distinct from ('Orquestração', 'CPF');
comment on column public.planos_empresa.orquestracao_valor is
    'por_contrato (nome antigo): preço por CPF ativo no ciclo (SQL 69). mensalidade: valor fixo do mês.';

-- ---------------------------------------------------------------- a medição da Orquestração num ciclo
-- por_cpf = o ciclo tem clientes_mes, ou não tem medição nenhuma; senão (ciclo medido só antes do SQL 69) = contratos.
create or replace function public.orquestracao_medicao(empresa bigint, competencia date,
                                                       out por_cpf boolean, out quantidade bigint, out contratos bigint)
language sql stable security definer set search_path = public as $$
    with c as (select count(distinct m.cliente) n from public.clientes_mes m
                where m.empresa_id = orquestracao_medicao.empresa and m.competencia = orquestracao_medicao.competencia),
         k as (select count(*) n from public.contratos_mes m
                where m.empresa_id = orquestracao_medicao.empresa and m.competencia = orquestracao_medicao.competencia)
    select c.n > 0 or k.n = 0, case when c.n > 0 or k.n = 0 then c.n else k.n end, k.n from c, k
$$;
revoke execute on function public.orquestracao_medicao(bigint, date) from public, anon, authenticated;
grant execute on function public.orquestracao_medicao(bigint, date) to service_role;

-- consumo do ciclo (tela "Consumo"): 'contratos' = a quantidade cobrada da Orquestração (CPFs; contratos no ciclo antigo)
create or replace view public.consumo_mes with (security_invoker = true) as
select e.empresa_id, e.competencia, 'contratos'::text as item, coalesce(c.n, k.n, 0)::bigint as quantidade
  from (select empresa_id, competencia from public.contratos_mes
        union select empresa_id, competencia from public.clientes_mes) e
  left join (select empresa_id, competencia, count(distinct cliente) n from public.clientes_mes
              group by empresa_id, competencia) c on c.empresa_id = e.empresa_id and c.competencia = e.competencia
  left join (select empresa_id, competencia, count(*) n from public.contratos_mes
              group by empresa_id, competencia) k on k.empresa_id = e.empresa_id and k.competencia = e.competencia
union all
select empresa_id, competencia, 'jornada_clientes'::text, count(*)::bigint
  from public.jornada_clientes_mes group by empresa_id, competencia
union all
select empresa_id, competencia, item, quantidade from public.consumo_mensageria;
grant select on public.consumo_mes to authenticated;
revoke all on public.consumo_mes from anon;

-- ---------------------------------------------------------------- prévia (e o fechamento, que congela a prévia)
create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

select pg_temp.trocar('public.previa_fatura(bigint,date)',
    'select count(*) into qtd from public.contratos_mes m where m.empresa_id = empresa and m.competencia = mes;',
    'qtd := (public.orquestracao_medicao(empresa, mes)).quantidade;   -- SQL 69: CPFs ativos no ciclo');
select pg_temp.trocar('public.previa_fatura(bigint,date)',
    'nome || case when c.codigo = ''contratos'' then '' · contratos no ciclo''',
    'nome || case when c.codigo = ''contratos'' and (public.orquestracao_medicao(empresa, mes)).por_cpf
                              then '' · CPFs ativos no mês''
                         when c.codigo = ''contratos''
                              then '' · contratos no ciclo (medição anterior à cobrança por CPF)''');
revoke execute on function public.previa_fatura(bigint, date) from public, anon;

-- ---------------------------------------------------------------- demonstrativo: CPFs por carteira (detalhe)
-- A soma das carteiras pode passar do total cobrado: o mesmo CPF em duas carteiras da empresa é cobrado uma vez.
select pg_temp.trocar('public.demonstrativo_fatura(bigint)',
    '''clientes'', (select count(*) from public.jornada_clientes_mes m',
    '''cpfs'', (select count(*) from public.clientes_mes m where m.empresa_id = f.empresa_id
                                    and m.competencia = f.competencia and m.credor_id = coalesce(cr.id, 0)),
                   ''clientes'', (select count(*) from public.jornada_clientes_mes m');
select pg_temp.trocar('public.demonstrativo_fatura(bigint)',
    '(x->>''contratos'')::int + (x->>''clientes'')::int',
    '(x->>''contratos'')::int + (x->>''cpfs'')::int + (x->>''clientes'')::int');
revoke all on function public.demonstrativo_fatura(bigint) from public, anon;
grant execute on function public.demonstrativo_fatura(bigint) to authenticated, service_role;
