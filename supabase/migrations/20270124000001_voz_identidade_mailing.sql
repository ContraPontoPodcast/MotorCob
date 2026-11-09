-- SQL 88 · Agente de voz: confirmar a identidade pelo arquivo (mailing). Parte IDENTIDADE da SPEC "Dados do arquivo
-- (mailing) na identidade, nas ofertas e nos descontos" (§1.1, §3, §4, §6, §7; padrões aprovados pelo dono em 08/11/2026).
-- As ofertas e as regras de desconto pelo arquivo esperam a política do dono: nada delas existe aqui (só os pontos de
-- extensão marcados com "ofertas (depois)").
--
-- 1. voz_mailing_config (por carteira; credor nulo = empresa toda, como a alçada): a parte "identidade" com versões e
--    vigência. {"fonte": crm | arquivo | crm_arquivo | arquivo_crm, "perguntas": [ordem, só as ligadas],
--    "quantas": 1 | 2, "se_faltar": proxima | menos | transferir, "erros_dia": 3 | 4 | 6}. Sem linha = o executor faz
--    exatamente o de hoje (só o CRM, uma pergunta por etapa). Quem salva: só o cliente, com aprovar_roteiro_voz
--    (pode_aprovar_fluxo_voz; muda quem ouve a dívida). Cada salvamento é uma versão inteira, com "o que mudou" em
--    palavras e auditoria (z_auditar). O site lê pela RLS (quem vê a empresa).
-- 2. voz_identidade_dia: SÓ CÓDIGOS (HMAC-SHA256 com a chave de identidade da empresa, 32 hexadecimais), nunca a data
--    nem o documento. Só dos clientes da lista de hoje do agente; a publicação da rotina troca tudo da carteira (quem
--    saiu da carteira sai junto) e o job noturno apaga o que passou de 1 dia. Ninguém lê a tabela: nem o site, nem a VM,
--    nem a chave do servidor (só as funções abaixo).
-- 3. voz_identidade_tentativas: erros por cliente e dia, somando as ligações (padrão 4). Só contagem; apaga com 2 dias.
-- 4. voz_identidade_chamadas: a ligação em andamento que pode conferir (aberta pela VM no começo da etapa, vale 30 min).
-- 5. conferir_identidade_voz: a comparação acontece NO BANCO. A VM manda o código da resposta e recebe só
--    identidade_ok | identidade_nao_confere | sem_dado | bloqueado. A VM nunca recebe os códigos guardados.
-- 6. identidade_mailing_confirmada(empresa, chamada): a trava para as ofertas do arquivo (ofertas (depois)): só depois
--    de a identidade conferir nesta ligação.
-- 7. fluxo_voz_pendencias: "identidade_sem_conferencia" deixa de valer quando a carteira confere pelo arquivo.
-- 8. salvar_mapeamento_base: as colunas novas "nascimento" e "documento_validacao" (esta pode ser a do CPF já
--    apontado). O motor nunca as transforma em atributo, prévia ou saída (risco R1).
-- Depende do SQL 58 (fluxo), 73 (parece_cpf) e 74 (mapeamento). Pode rodar de novo. Se o SQL 58 for rodado de novo,
-- rode este depois (ele refaz fluxo_voz_pendencias). Sem este SQL: o motor só avisa, a VM e o site fazem o de hoje.

-- ================================================================ 0. formato da configuração
create or replace function public.identidade_mailing_valida(j jsonb) returns boolean
language sql immutable set search_path = '' as $$
    select coalesce(
        jsonb_typeof(j) = 'object'
        and (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(j) k)
            = array['erros_dia', 'fonte', 'perguntas', 'quantas', 'se_faltar']
        and j ->> 'fonte' in ('crm', 'arquivo', 'crm_arquivo', 'arquivo_crm')
        and j ->> 'se_faltar' in ('proxima', 'menos', 'transferir')
        and jsonb_typeof(j -> 'erros_dia') = 'number' and (j ->> 'erros_dia') in ('3', '4', '6')
        and jsonb_typeof(j -> 'quantas') = 'number' and (j ->> 'quantas') in ('1', '2')
        and jsonb_typeof(j -> 'perguntas') = 'array'
        and jsonb_array_length(j -> 'perguntas') between (j ->> 'quantas')::int and 3
        and not exists (select 1 from jsonb_array_elements(j -> 'perguntas') p
                         where jsonb_typeof(p) <> 'string'
                            or p #>> '{}' not in ('dia_mes_nascimento', 'ultimos3_documento', 'ano_nascimento'))
        and (select count(distinct p) = count(*) from jsonb_array_elements_text(j -> 'perguntas') p),
        false)
$$;
comment on function public.identidade_mailing_valida(jsonb) is
    'SQL 88: forma da parte "identidade" de voz_mailing_config. Cópia em site/src/lib/identidade-mailing.ts e '
    'voz/fluxo.py (config_identidade).';

-- ================================================================ 1. configuração por carteira (versões com vigência)
create table if not exists public.voz_mailing_config (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    credor_id      bigint references public.credores (id) on delete cascade,          -- nulo = empresa toda
    identidade     jsonb not null check (public.identidade_mailing_valida(identidade)),
    -- ofertas (depois): "ofertas" e "negociacao" entram como colunas novas, com a política do dono
    mudancas       text check (char_length(mudancas) <= 2000),
    vigente_desde  timestamptz not null default now(),
    vigente_ate    timestamptz,
    salvo_por      uuid default auth.uid() references auth.users (id) on delete set null,
    salvo_em       timestamptz not null default now(),
    check (vigente_ate is null or vigente_ate >= vigente_desde)
);
create unique index if not exists voz_mailing_config_vigente on public.voz_mailing_config (empresa_id, coalesce(credor_id, 0))
    where vigente_ate is null;
create index if not exists voz_mailing_config_historico on public.voz_mailing_config (empresa_id, credor_id, vigente_desde desc);
comment on table public.voz_mailing_config is
    'SQL 88: como o agente de voz usa os dados do arquivo (mailing) por carteira (credor nulo = empresa toda). Hoje só a '
    'identidade (quem confere, quantas e quais perguntas, se faltar dado, erros no dia). Cada salvamento é uma versão '
    'inteira; a vigente tem vigente_ate nulo. Sem linha: o agente faz o de hoje (só o CRM).';
alter table public.voz_mailing_config enable row level security;
drop policy if exists voz_mailing_config_ver on public.voz_mailing_config;
create policy voz_mailing_config_ver on public.voz_mailing_config for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_mailing_config from anon;
revoke insert, update, delete, truncate on public.voz_mailing_config from authenticated;
grant select on public.voz_mailing_config to authenticated;
grant select on public.voz_mailing_config to service_role;
drop trigger if exists z_auditar on public.voz_mailing_config;
create trigger z_auditar after insert or update or delete on public.voz_mailing_config
    for each row execute function public.auditar();

-- a configuração em vigor: a da carteira; sem ela, a da empresa toda; sem as duas, null (= o de hoje)
create or replace function public.identidade_voz_vigente(empresa bigint, credor bigint) returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object('id', c.id, 'credor_id', c.credor_id, 'identidade', c.identidade,
                              'vigente_desde', c.vigente_desde)
      from public.voz_mailing_config c
     where (public.chamada_do_servidor() or public.chamada_da_vm_voz() or empresa in (select public.minhas_empresas()))
       and c.empresa_id = empresa and (c.credor_id = credor or c.credor_id is null) and c.vigente_ate is null
     order by (c.credor_id is null) limit 1
$$;
revoke all on function public.identidade_voz_vigente(bigint, bigint) from public, anon;
grant execute on function public.identidade_voz_vigente(bigint, bigint) to authenticated, service_role;

create or replace function public.identidade_voz_usa_arquivo(empresa bigint, credor bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((public.identidade_voz_vigente(empresa, credor) -> 'identidade' ->> 'fonte')
                    in ('arquivo', 'crm_arquivo', 'arquivo_crm'), false)
$$;
revoke all on function public.identidade_voz_usa_arquivo(bigint, bigint) from public, anon;
grant execute on function public.identidade_voz_usa_arquivo(bigint, bigint) to authenticated, service_role;

-- "o que mudou" em palavras (para o Histórico; nunca dado de cliente)
create or replace function public.identidade_mailing_mudancas(antes jsonb, depois jsonb) returns text
language sql immutable set search_path = '' as $$
    with nomes(k, v) as (values
        ('crm', 'Só o CRM'), ('arquivo', 'Só o arquivo'), ('crm_arquivo', 'CRM; se falhar, o arquivo'),
        ('arquivo_crm', 'Arquivo; se faltar o dado, o CRM'), ('proxima', 'usar a próxima fonte'),
        ('menos', 'fazer só a pergunta que tem dado'), ('transferir', 'transferir para um atendente'),
        ('dia_mes_nascimento', 'dia e mês de nascimento'), ('ultimos3_documento', '3 últimos dígitos do documento'),
        ('ano_nascimento', 'ano de nascimento')),
    n as (select k, v from nomes),
    partes as (
        select 1 o, 'Quem confere: ' || coalesce((select v from n where k = depois ->> 'fonte'), depois ->> 'fonte') t
         where antes is null or antes ->> 'fonte' is distinct from depois ->> 'fonte'
        union all
        select 2, 'Perguntas: ' || (depois ->> 'quantas') || case when depois ->> 'quantas' = '1' then ' pergunta' else ' perguntas' end
         where antes is null or antes ->> 'quantas' is distinct from depois ->> 'quantas'
        union all
        select 3, 'Ordem: ' || (select string_agg(coalesce((select v from n where k = p), p), ' → ' order by i)
                                  from jsonb_array_elements_text(depois -> 'perguntas') with ordinality x(p, i))
         where antes is null or antes -> 'perguntas' is distinct from depois -> 'perguntas'
        union all
        select 4, 'Se faltar dado no arquivo: ' || coalesce((select v from n where k = depois ->> 'se_faltar'), depois ->> 'se_faltar')
         where antes is null or antes ->> 'se_faltar' is distinct from depois ->> 'se_faltar'
        union all
        select 5, 'Erros no dia por cliente: ' || (depois ->> 'erros_dia')
         where antes is null or antes ->> 'erros_dia' is distinct from depois ->> 'erros_dia')
    select case when depois is null then 'Voltou ao de hoje: só o CRM confere'
                else coalesce(string_agg(t, ' · ' order by o), 'Sem mudança') end
      from partes
$$;

-- salvar (só o cliente, com aprovar_roteiro_voz). identidade null = voltar ao de hoje (fecha a vigência).
-- ofertas (depois): parâmetros novos com default null, cada parte com a sua permissão (SPEC §7).
create or replace function public.salvar_config_mailing_voz(empresa bigint, credor bigint, identidade jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    atual public.voz_mailing_config;
    novo bigint;
begin
    if not public.pode_aprovar_fluxo_voz(empresa) then
        raise exception 'só quem aprova o roteiro de voz da empresa muda quem confere a identidade';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if identidade is not null and not public.identidade_mailing_valida(identidade) then
        raise exception 'configuração de identidade inválida: confira quem confere, as perguntas e os erros no dia';
    end if;
    perform pg_advisory_xact_lock(hashtext('voz_mailing_config'), hashtext(empresa::text || ':' || coalesce(credor, 0)::text));
    select * into atual from public.voz_mailing_config c
     where c.empresa_id = empresa and c.credor_id is not distinct from credor and c.vigente_ate is null;
    if identidade is null then
        if atual.id is not null then
            update public.voz_mailing_config c set vigente_ate = now(),
                   mudancas = left(coalesce(c.mudancas || ' | ', '') || 'Encerrada: ' || public.identidade_mailing_mudancas(c.identidade, null), 2000)
             where c.id = atual.id;
        end if;
        return null;
    end if;
    if atual.id is not null and atual.identidade = identidade then
        return atual.id;                                  -- nada mudou: não abre versão
    end if;
    if atual.id is not null then
        update public.voz_mailing_config c set vigente_ate = now() where c.id = atual.id;
    end if;
    insert into public.voz_mailing_config (empresa_id, credor_id, identidade, mudancas)
    values (empresa, credor, identidade, public.identidade_mailing_mudancas(atual.identidade, identidade))
    returning id into novo;
    return novo;
end $$;
revoke all on function public.salvar_config_mailing_voz(bigint, bigint, jsonb) from public, anon;
grant execute on function public.salvar_config_mailing_voz(bigint, bigint, jsonb) to authenticated;

-- ================================================================ 2. códigos do dia (só código; ninguém lê a tabela)
create table if not exists public.voz_identidade_dia (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null references public.credores (id) on delete cascade,
    id_cliente    text not null check (char_length(id_cliente) between 1 and 60),
    pergunta      text not null check (pergunta in ('dia_mes_nascimento', 'ultimos3_documento', 'ano_nascimento')),
    codigo        text not null check (codigo ~ '^[0-9a-f]{32}$'),
    versao        int not null check (versao between 1 and 1000000),
    dia           date not null,
    publicado_em  timestamptz not null default now(),
    primary key (empresa_id, credor_id, id_cliente, pergunta),
    constraint voz_identidade_dia_id_cliente_sem_cpf check (not public.parece_cpf(id_cliente))
);
create index if not exists voz_identidade_dia_dia on public.voz_identidade_dia (dia);
comment on table public.voz_identidade_dia is
    'SQL 88: códigos de validação (HMAC-SHA256 da resposta normalizada com a chave de identidade da empresa, que fica '
    'só no Secret Manager). Nunca a data nem o documento. Só a lista de hoje do agente; quem saiu da carteira sai na '
    'publicação seguinte; o job noturno apaga o que passou de 1 dia. Sem política: só as funções do SQL 88 leem.';
alter table public.voz_identidade_dia enable row level security;
revoke all on public.voz_identidade_dia from public, anon, authenticated, service_role;

create table if not exists public.voz_identidade_tentativas (
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    credor_id      bigint not null references public.credores (id) on delete cascade,
    id_cliente     text not null check (char_length(id_cliente) between 1 and 60),
    dia            date not null,
    erros          int not null default 0 check (erros between 0 and 1000),
    atualizado_em  timestamptz not null default now(),
    primary key (empresa_id, credor_id, id_cliente, dia),
    constraint voz_identidade_tentativas_id_cliente_sem_cpf check (not public.parece_cpf(id_cliente))
);
comment on table public.voz_identidade_tentativas is
    'SQL 88: respostas que não conferiram pelo arquivo, por cliente e dia, somando as ligações. Só contagem; apaga com 2 dias.';
alter table public.voz_identidade_tentativas enable row level security;
revoke all on public.voz_identidade_tentativas from public, anon, authenticated, service_role;

create table if not exists public.voz_identidade_chamadas (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null references public.credores (id) on delete cascade,
    id_chamada    text not null check (id_chamada ~ '^[A-Za-z0-9_.:\-]{4,80}$'),
    id_cliente    text not null check (char_length(id_cliente) between 1 and 60),
    aberta_em     timestamptz not null default now(),
    tentativas    jsonb not null default '{}',
    confirmadas   text[] not null default '{}',
    confirmada_em timestamptz,
    primary key (empresa_id, id_chamada),
    constraint voz_identidade_chamadas_id_cliente_sem_cpf check (not public.parece_cpf(id_cliente))
);
comment on table public.voz_identidade_chamadas is
    'SQL 88: ligação em andamento que pode conferir a identidade pelo arquivo (30 min), tentativas por pergunta nesta '
    'ligação e as perguntas que conferiram. Sem código, sem resposta. Apaga com 2 dias.';
alter table public.voz_identidade_chamadas enable row level security;
revoke all on public.voz_identidade_chamadas from public, anon, authenticated, service_role;

-- publicação da rotina (service_role): troca os códigos da carteira pelos da lista de hoje. substituir = true apaga
-- tudo da carteira antes (1º lote); os lotes seguintes passam false. Carteira que não confere pelo arquivo: apaga e não
-- grava nada (desligar a fonte limpa na rotina seguinte).
create or replace function public.publicar_identidade_voz(empresa bigint, credor bigint, dia date, linhas jsonb,
                                                          substituir boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    apagados int := 0; gravados int := 0; usa boolean;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só a rotina do motor publica os códigos de identidade';
    end if;
    if not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if linhas is null or jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 200000 then
        raise exception 'linhas inválidas';
    end if;
    if substituir then
        delete from public.voz_identidade_dia d where d.empresa_id = empresa and d.credor_id = credor;
        get diagnostics apagados = row_count;
    end if;
    usa := public.identidade_voz_usa_arquivo(empresa, credor);
    if usa then
        insert into public.voz_identidade_dia (empresa_id, credor_id, id_cliente, pergunta, codigo, versao, dia)
        select empresa, credor, l ->> 'id_cliente', l ->> 'pergunta', l ->> 'codigo', (l ->> 'versao')::int,
               publicar_identidade_voz.dia
          from jsonb_array_elements(linhas) l
        on conflict (empresa_id, credor_id, id_cliente, pergunta) do update
           set codigo = excluded.codigo, versao = excluded.versao, dia = excluded.dia, publicado_em = now();
        get diagnostics gravados = row_count;
    end if;
    return jsonb_build_object('gravados', gravados, 'apagados', apagados, 'usa_arquivo', usa);
end $$;
revoke all on function public.publicar_identidade_voz(bigint, bigint, date, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.publicar_identidade_voz(bigint, bigint, date, jsonb, boolean) to service_role;

-- job noturno (VM, voz/fluxo_metricas.py) e a própria rotina: códigos com mais de 1 dia, de carteira que não confere
-- mais pelo arquivo, tentativas e ligações com mais de 2 dias. Só contagens de volta.
create or replace function public.limpar_identidade_voz() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    a int; b int; c int; d int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor limpa os códigos de identidade';
    end if;
    delete from public.voz_identidade_dia x where x.dia < hoje - 1;
    get diagnostics a = row_count;
    delete from public.voz_identidade_dia x where not public.identidade_voz_usa_arquivo(x.empresa_id, x.credor_id);
    get diagnostics b = row_count;
    delete from public.voz_identidade_tentativas x where x.dia < hoje - 2;
    get diagnostics c = row_count;
    delete from public.voz_identidade_chamadas x where x.aberta_em < now() - interval '2 days';
    get diagnostics d = row_count;
    return jsonb_build_object('codigos', a + b, 'tentativas', c, 'chamadas', d);
end $$;
revoke all on function public.limpar_identidade_voz() from public, anon, authenticated;
grant execute on function public.limpar_identidade_voz() to service_role;

-- quantas perguntas a configuração pede para este cliente (as ligadas, na ordem, que têm código hoje)
create or replace function public.identidade_mailing_disponiveis(empresa bigint, credor bigint, cliente text, cfg jsonb)
returns text[]
language sql stable security definer set search_path = public as $$
    select coalesce(array_agg(p order by i), '{}')
      from jsonb_array_elements_text(cfg -> 'perguntas') with ordinality x(p, i)
     where exists (select 1 from public.voz_identidade_dia d where d.empresa_id = empresa and d.credor_id = credor
                      and d.id_cliente = cliente and d.pergunta = x.p)
$$;
revoke all on function public.identidade_mailing_disponiveis(bigint, bigint, text, jsonb) from public, anon, authenticated, service_role;

-- quantas precisam conferir: "quantas" (com "menos", as que têm dado, no mínimo 1)
create or replace function public.identidade_mailing_exigidas(cfg jsonb, disponiveis int) returns int
language sql immutable set search_path = '' as $$
    select case when cfg ->> 'se_faltar' = 'menos'
                then greatest(1, least((cfg ->> 'quantas')::int, disponiveis))
                else (cfg ->> 'quantas')::int end
$$;

-- começo da etapa "Confirmar identidade" (VM): registra a ligação em andamento e diz quais perguntas têm dado (só os
-- nomes, nunca os códigos) e se o cliente já atingiu o limite de erros do dia.
create or replace function public.abrir_identidade_voz(empresa bigint, credor bigint, id_cliente text, id_chamada text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    cfg jsonb := public.identidade_voz_vigente(empresa, credor) -> 'identidade';
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    ch public.voz_identidade_chamadas;
    erros int;
    disp text[];
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a VM de voz confere a identidade';
    end if;
    if cfg is null or cfg ->> 'fonte' not in ('arquivo', 'crm_arquivo', 'arquivo_crm') then
        raise exception 'carteira sem identidade pelo arquivo';
    end if;
    if id_chamada is null or id_chamada !~ '^[A-Za-z0-9_.:\-]{4,80}$' or coalesce(char_length(id_cliente), 0) not between 1 and 60 then
        raise exception 'ligação inválida';
    end if;
    insert into public.voz_identidade_chamadas (empresa_id, credor_id, id_chamada, id_cliente)
    values (empresa, credor, abrir_identidade_voz.id_chamada, abrir_identidade_voz.id_cliente)
    on conflict on constraint voz_identidade_chamadas_pkey do nothing;
    select * into ch from public.voz_identidade_chamadas c
     where c.empresa_id = empresa and c.id_chamada = abrir_identidade_voz.id_chamada;
    if ch.credor_id <> credor or ch.id_cliente <> abrir_identidade_voz.id_cliente then
        raise exception 'ligação de outro cliente';
    end if;
    select t.erros into erros from public.voz_identidade_tentativas t
     where t.empresa_id = empresa and t.credor_id = credor and t.id_cliente = abrir_identidade_voz.id_cliente and t.dia = hoje;
    disp := public.identidade_mailing_disponiveis(empresa, credor, abrir_identidade_voz.id_cliente, cfg);
    return jsonb_build_object('disponiveis', to_jsonb(disp),
                              'bloqueado', coalesce(erros, 0) >= (cfg ->> 'erros_dia')::int);
end $$;
revoke all on function public.abrir_identidade_voz(bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.abrir_identidade_voz(bigint, bigint, text, text) to service_role;

-- a comparação, no banco. Recusa (erro) fora de uma ligação em andamento deste cliente; 2 tentativas por pergunta nesta
-- ligação; limite de erros do dia somando as ligações. Devolve só a palavra.
create or replace function public.conferir_identidade_voz(empresa bigint, credor bigint, id_cliente text, id_chamada text,
                                                          pergunta text, codigo text, versao int) returns text
language plpgsql security definer set search_path = public as $$
declare
    cfg jsonb := public.identidade_voz_vigente(empresa, credor) -> 'identidade';
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    ch public.voz_identidade_chamadas;
    guardado public.voz_identidade_dia;
    erros int;
    n int;
    conf text[];
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a VM de voz confere a identidade';
    end if;
    if cfg is null or cfg ->> 'fonte' not in ('arquivo', 'crm_arquivo', 'arquivo_crm') then
        raise exception 'carteira sem identidade pelo arquivo';
    end if;
    if codigo is null or codigo !~ '^[0-9a-f]{32}$' or versao is null
       or pergunta is null or not (cfg -> 'perguntas') ? pergunta then
        raise exception 'pedido de conferência inválido';
    end if;
    select * into ch from public.voz_identidade_chamadas c
     where c.empresa_id = empresa and c.id_chamada = conferir_identidade_voz.id_chamada for update;
    if ch.id_chamada is null or ch.credor_id <> credor or ch.id_cliente <> conferir_identidade_voz.id_cliente
       or ch.aberta_em < now() - interval '30 minutes' then
        raise exception 'ligação fora de andamento';
    end if;
    n := coalesce((ch.tentativas ->> pergunta)::int, 0);
    if n >= 2 then
        return 'bloqueado';                               -- 2 tentativas por pergunta nesta ligação
    end if;
    select t.erros into erros from public.voz_identidade_tentativas t
     where t.empresa_id = empresa and t.credor_id = credor and t.id_cliente = conferir_identidade_voz.id_cliente
       and t.dia = hoje for update;
    if coalesce(erros, 0) >= (cfg ->> 'erros_dia')::int then
        return 'bloqueado';                               -- limite do dia, somando as ligações
    end if;
    select * into guardado from public.voz_identidade_dia d
     where d.empresa_id = empresa and d.credor_id = credor and d.id_cliente = conferir_identidade_voz.id_cliente
       and d.pergunta = conferir_identidade_voz.pergunta;
    if guardado.codigo is null or guardado.versao <> conferir_identidade_voz.versao then
        return 'sem_dado';                                -- sem código (ou chave de outra versão): próxima fonte
    end if;
    update public.voz_identidade_chamadas c set tentativas = c.tentativas || jsonb_build_object(pergunta, n + 1)
     where c.empresa_id = empresa and c.id_chamada = conferir_identidade_voz.id_chamada;
    if guardado.codigo = codigo then
        conf := array(select distinct x from unnest(ch.confirmadas || pergunta) x order by 1);
        update public.voz_identidade_chamadas c
           set confirmadas = conf,
               confirmada_em = case when cardinality(conf) >= public.identidade_mailing_exigidas(cfg,
                                        cardinality(public.identidade_mailing_disponiveis(empresa, credor, ch.id_cliente, cfg)))
                                    then coalesce(c.confirmada_em, now()) end
         where c.empresa_id = empresa and c.id_chamada = conferir_identidade_voz.id_chamada;
        return 'identidade_ok';
    end if;
    insert into public.voz_identidade_tentativas (empresa_id, credor_id, id_cliente, dia, erros)
    values (empresa, credor, conferir_identidade_voz.id_cliente, hoje, 1)
    on conflict on constraint voz_identidade_tentativas_pkey do update
       set erros = public.voz_identidade_tentativas.erros + 1, atualizado_em = now();
    return 'identidade_nao_confere';
end $$;
revoke all on function public.conferir_identidade_voz(bigint, bigint, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.conferir_identidade_voz(bigint, bigint, text, text, text, text, int) to service_role;

-- trava das ofertas do arquivo (ofertas (depois)): só depois de a identidade conferir nesta ligação, pelo banco
create or replace function public.identidade_mailing_confirmada(empresa bigint, id_chamada text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((select c.confirmada_em is not null and c.aberta_em >= now() - interval '30 minutes'
                       from public.voz_identidade_chamadas c
                      where c.empresa_id = empresa and c.id_chamada = identidade_mailing_confirmada.id_chamada), false)
$$;
revoke all on function public.identidade_mailing_confirmada(bigint, text) from public, anon, authenticated, service_role;

-- ================================================================ 3. acesso próprio da VM (papel motorcx_voz)
create or replace function voz_vm.identidade_vigente(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.identidade_voz_vigente((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint)
     where voz_vm.tem_voz((args ->> 'empresa')::bigint)
$$;
create or replace function voz_vm.abrir_identidade(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz';
    end if;
    return public.abrir_identidade_voz((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint,
                                       args ->> 'id_cliente', args ->> 'id_chamada');
end $$;
create or replace function voz_vm.conferir_identidade(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz';
    end if;
    return to_jsonb(public.conferir_identidade_voz((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint,
                                                   args ->> 'id_cliente', args ->> 'id_chamada', args ->> 'pergunta',
                                                   args ->> 'codigo', (args ->> 'versao')::int));
end $$;
create or replace function voz_vm.limpar_identidade(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.limpar_identidade_voz()
$$;
revoke all on function voz_vm.identidade_vigente(jsonb), voz_vm.abrir_identidade(jsonb), voz_vm.conferir_identidade(jsonb),
                       voz_vm.limpar_identidade(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.identidade_vigente(jsonb), voz_vm.abrir_identidade(jsonb), voz_vm.conferir_identidade(jsonb),
                          voz_vm.limpar_identidade(jsonb) to motorcx_voz;

-- ================================================================ 4. fluxo: a identidade pelo arquivo conta como conferência
-- igual ao SQL 58, com uma diferença: a carteira que confere pelo arquivo (SQL 88) não fica com identidade_sem_conferencia
create or replace function public.fluxo_voz_pendencias(empresa bigint, credor bigint, d jsonb) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
    out text[] := '{}';
    b jsonb; p jsonb; c jsonb; cid bigint; cs jsonb;
    con public.crm_conectores;
    fins text[];
    arquivo boolean := public.identidade_voz_usa_arquivo(empresa, credor);
begin
    if not (public.chamada_do_servidor() or empresa in (select public.minhas_empresas())) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if not public.fluxo_voz_valido(d) then
        return public.fluxo_voz_erros(d);
    end if;
    for b in select x from jsonb_array_elements(d -> 'blocos') x loop
        p := b -> 'params';
        if b ->> 'tipo' = 'identidade' and coalesce(jsonb_typeof(p -> 'conector_id'), 'null') = 'null'
           and not arquivo then                                                 -- CRM ou, com o SQL 88, o arquivo
            out := out || ('identidade_sem_conferencia:' || (b ->> 'id'));
        end if;
        cs := case
            when b ->> 'tipo' = 'conector' then jsonb_build_array(p -> 'conector_id')
            when b ->> 'tipo' = 'identidade' and jsonb_typeof(p -> 'conector_id') = 'number' then jsonb_build_array(p -> 'conector_id')
            when b ->> 'tipo' = 'oferta' and p ->> 'origem' = 'conector' then jsonb_build_array(p -> 'conector_id')
            when b ->> 'tipo' = 'registrar' and p ->> 'registra' = 'acordo_crm' then
                coalesce(nullif((select jsonb_agg(x) from jsonb_array_elements(coalesce(p -> 'conectores', '[]')) x
                                  where jsonb_typeof(x) = 'number'), '[]'), '[null]'::jsonb)
            else '[]'::jsonb end;
        fins := case b ->> 'tipo' when 'identidade' then array['validar_cadastro'] when 'oferta' then array['buscar_ofertas']
                                 when 'registrar' then array['registrar_acordo', 'gerar_boleto', 'gerar_link'] else null end;
        for c in select x from jsonb_array_elements(cs) x loop
            cid := case when jsonb_typeof(c) = 'number' then (c #>> '{}')::bigint end;
            select * into con from public.crm_conectores k where k.id = cid and k.empresa_id = empresa;
            if con.id is null or con.situacao <> 'ativo' then
                out := out || ('conector_inativo:' || (b ->> 'id'));
            elsif fins is not null and con.finalidade <> all (fins) then
                out := out || ('conector_finalidade:' || (b ->> 'id'));
            end if;
        end loop;
        if b ->> 'tipo' = 'intencao' and exists (
            select 1 from jsonb_array_elements_text(p -> 'intencoes') i
             where not exists (select 1 from public.voz_intencoes v where v.codigo = i and v.ativa)) then
            out := out || ('intencao_fora_catalogo:' || (b ->> 'id'));
        end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(d -> 'blocos') x
                where x ->> 'tipo' = 'oferta'
                   or (x ->> 'tipo' = 'generativa' and x -> 'params' -> 'ferramentas' @> '["apresentar_oferta"]'))
       and not exists (select 1 from public.voz_alcada_carteira a
                        where a.empresa_id = empresa and (a.credor_id = credor or a.credor_id is null)
                          and a.vigente_desde <= (now() at time zone 'America/Sao_Paulo')::date
                          and (a.vigente_ate is null or a.vigente_ate >= (now() at time zone 'America/Sao_Paulo')::date)) then
        out := out || 'sem_alcada'::text;
    end if;
    return array(select distinct x collate "C" from unnest(out) x order by 1);
end $$;
revoke all on function public.fluxo_voz_pendencias(bigint, bigint, jsonb) from public, anon;
grant execute on function public.fluxo_voz_pendencias(bigint, bigint, jsonb) to authenticated, service_role;

-- ================================================================ 5. colunas da carga para o agente de voz
-- igual ao SQL 74, com os campos opcionais do agente de voz: nascimento e documento_validacao (só viram código de
-- validação; o motor nunca os transforma em atributo, prévia ou saída). documento_validacao pode repetir a coluna do CPF.
-- Cabeçalho: SQL 74 (formato de colunas e cabecalho).
create or replace function public.salvar_mapeamento_base(credor bigint, colunas jsonb, cabecalho jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    eid bigint; cab jsonb; k text; v jsonb; col text; usadas text[] := '{}'; faltam text[] := '{}';
    simples constant text[] := array['id_cliente', 'cpf', 'id_contrato', 'saldo', 'dias_atraso', 'vencimento',
                                     'data_entrada', 'nascimento', 'documento_validacao'];
    nomes constant jsonb := '{"id_cliente": "o código do cliente", "cpf": "o CPF/CNPJ", "id_contrato": "o contrato",
        "saldo": "o saldo", "dias_atraso": "os dias de atraso", "vencimento": "o vencimento",
        "data_entrada": "a data de entrada", "telefones": "os telefones", "emails": "os e-mails",
        "nascimento": "a data de nascimento", "documento_validacao": "os 3 últimos dígitos do documento"}';
    limpo jsonb := '{}'; lista jsonb; pediu boolean := false;
begin
    select c.empresa_id into eid from public.credores c where c.id = credor;
    if eid is null or not public.pode_implantar(eid, 'editar_credores') then
        raise exception 'seu perfil não pode mudar as colunas desta carteira';
    end if;
    if colunas is null or jsonb_typeof(colunas) <> 'object' then
        raise exception 'mapeamento inválido: aponte as colunas de novo';
    end if;
    if cabecalho is not null then
        if jsonb_typeof(cabecalho) <> 'array' or jsonb_array_length(cabecalho) > 500
           or exists (select 1 from jsonb_array_elements(cabecalho) x where jsonb_typeof(x) <> 'string'
                         or length(x #>> '{}') > 120) then
            raise exception 'cabeçalho do arquivo inválido: escolha o arquivo de novo';
        end if;
        cab := cabecalho;
    else
        select m.cabecalho into cab from public.mapeamento_arquivos m
         where m.empresa_id = eid and m.credor_id = credor and m.tipo = 'base';
    end if;
    for k, v in select * from jsonb_each(colunas) loop
        if k = any (simples) then
            if jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') then
                continue;
            end if;
            if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 120 then
                raise exception 'Escolha uma coluna do arquivo para %.', nomes ->> k;
            end if;
            col := v #>> '{}';
            -- SQL 88: "usar o CPF/CNPJ já apontado" para os 3 últimos dígitos (só vira código; nunca atributo)
            if k = 'documento_validacao' and col = colunas ->> 'cpf' then
                limpo := limpo || jsonb_build_object(k, col);
                continue;
            end if;
            if col = any (usadas) then
                raise exception 'A coluna "%" foi apontada para mais de um campo. Cada campo usa uma coluna.', col;
            end if;
            usadas := usadas || col;
            limpo := limpo || jsonb_build_object(k, col);
        elsif k in ('telefones', 'emails') then
            if jsonb_typeof(v) = 'null' then continue; end if;
            if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then
                raise exception 'Escolha as colunas de % do arquivo.', nomes ->> k;
            end if;
            lista := '[]';
            for col in select jsonb_array_elements_text(v) loop
                if trim(col) = '' then continue; end if;
                if col = any (usadas) then
                    raise exception 'A coluna "%" foi apontada para mais de um campo. Cada campo usa uma coluna.', col;
                end if;
                usadas := usadas || col;
                lista := lista || to_jsonb(col);
            end loop;
            if jsonb_array_length(lista) > 0 then limpo := limpo || jsonb_build_object(k, lista); end if;
        else
            raise exception 'campo desconhecido no mapeamento: %', left(k, 40);
        end if;
    end loop;
    -- só colunas que existem no último arquivo recebido (quando o motor já leu o cabeçalho)
    if cab is not null and jsonb_typeof(cab) = 'array' and jsonb_array_length(cab) > 0 then
        foreach col in array usadas loop
            if not cab ? col then
                raise exception 'A coluna "%" não está no último arquivo desta carteira. Escolha uma das colunas do arquivo.', col;
            end if;
        end loop;
    end if;
    if not (limpo ? 'id_cliente' or limpo ? 'cpf') then faltam := faltam || 'o código do cliente ou o CPF'::text; end if;
    if not limpo ? 'saldo' then faltam := faltam || 'o saldo'::text; end if;
    if not (limpo ? 'dias_atraso' or limpo ? 'vencimento') then faltam := faltam || 'os dias de atraso ou o vencimento'::text; end if;
    if not (limpo ? 'telefones' or limpo ? 'emails') then faltam := faltam || 'o telefone ou o e-mail'::text; end if;
    if cardinality(faltam) > 0 then
        raise exception 'Falta apontar %: %.', case when cardinality(faltam) = 1 then '1 coluna'
                                                    else cardinality(faltam) || ' colunas' end,
                        array_to_string(faltam, ', ');
    end if;
    insert into public.mapeamento_arquivos (empresa_id, credor_id, tipo, colunas, confirmado, atualizado_em, cabecalho)
    values (eid, credor, 'base', limpo, true, now(), cab)
    on conflict (empresa_id, credor_id, tipo) do update
       set colunas = excluded.colunas, confirmado = true, atualizado_em = now(), atualizado_por = auth.uid(),
           cabecalho = coalesce(excluded.cabecalho, public.mapeamento_arquivos.cabecalho);
    -- carga esperando o mapeamento (ou recusada por coluna): o motor processa de novo em segundos
    if exists (select 1 from public.envios e where e.empresa_id = eid and e.credor_id = credor
                  and e.tipo in ('base', 'incremental') and e.status in ('aguardando', 'erro')
                  and e.enviado_em > now() - interval '30 days'
                  and not exists (select 1 from public.envios d where d.empresa_id = eid and d.credor_id = credor
                                     and d.tipo in ('base', 'incremental') and d.status = 'processado'
                                     and d.enviado_em > e.enviado_em)) then
        insert into public.pedidos_rotina (empresa_id, credor_id) values (eid, credor) on conflict do nothing;
        pediu := true;
    end if;
    perform public.marcar_passo_implantacao(eid, 3, false);
    return jsonb_build_object('colunas', limpo, 'reprocessar', pediu);
end $$;
revoke execute on function public.salvar_mapeamento_base(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_mapeamento_base(bigint, jsonb, jsonb) to authenticated;

do $conta$
declare n int;
begin
    select count(*) into n from public.voz_mailing_config where vigente_ate is null;
    raise notice 'SQL 88: % carteira(s) com identidade configurada (sem configuração: o agente faz o de hoje)', n;
end $conta$;
