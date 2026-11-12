-- SQL 130 · Agente de voz: as ofertas vêm SÓ da API do credor ou do arquivo (SPEC_OFERTAS_v2, respostas Q1–Q18
-- aprovadas pelo dono: "a política ou vem no arquivo ou via API/web service... não vamos calcular nada na mão").
-- PR 1 do plano (banco + motor). O executor (VM) é o PR 2; as telas, o PR 3; a limpeza do legado, o PR 4.
--
-- 1. voz_mailing_config ganha a parte "ofertas" = {"modo": api_arquivo | arquivo_api | so_api | so_arquivo,
--    "conector_id": o conector "Buscar ofertas" (a API, inclusive o CRM) ou null em so_arquivo}. Versões, vigência e
--    auditoria como a identidade. A identidade passa a poder ser nula numa versão (a carteira que só configurou as
--    ofertas); identidade e ofertas são resolvidas cada uma por si (carteira; sem ela, a empresa toda).
--    Sem "ofertas" vigente: padrão = API → arquivo (só o arquivo quando não há API), e a VM faz o de hoje sem a
--    "alternativa da carteira" (que sai).
-- 2. Quem muda: ATIVA só o Admin do cliente (cliente_pode(empresa, 'editar_orquestracao'); Q15). A equipe MotorCX (a
--    mesma que monta o fluxo, pode_editar_fluxo_voz) só grava RASCUNHO (voz_ofertas_rascunho, um por carteira).
--    Não se cria permissão de desconto: não há mais desconto para definir no MotorCX.
-- 3. crm_conectores.em_falha: 'alternativa_carteira' (ofertas calculadas do saldo) vira 'reserva_arquivo' (as linhas
--    são migradas; o site antigo que ainda mandar o nome velho é traduzido por gatilho).
-- 4. voz_ofertas_dia: as ofertas prontas do arquivo (colunas oferta1..3_*) dos clientes da lista de hoje do agente,
--    por contrato (o principal = o de maior saldo; Q12). Só números e datas; nunca nome, documento ou telefone. A rotina
--    publica (service_role, publicar_ofertas_voz) e troca tudo da carteira; carteira em "só API" não guarda nada.
--    Ninguém lê a tabela: a VM pede as ofertas de UM cliente com ofertas_mailing_voz, que só responde dentro de uma
--    ligação com a identidade confirmada (pelo arquivo, no banco, ou pelo CRM, registrada pela VM com
--    confirmar_identidade_crm_voz). A API nunca recebe CPF (Q14): isso é do conector e do executor.
-- 5. limpar_ofertas_voz: o job noturno apaga o que passou de 1 dia e o de carteira que não usa mais o arquivo.
-- 6. fluxo_voz_erros aceita a origem 'arquivo' na etapa Oferta ('carteira' fica aceita só como nome antigo: o
--    executor a trata como a ordem da carteira e o editor não oferece mais).
-- 7. salvar_mapeamento_base: as colunas oferta1..3_{id, parcelas, valor_parcela, desconto, entrada, validade,
--    valor_total, vencimento}. Desconto só em % (Q11). Não existem colunas de limite por cliente (desconto_max,
--    parcelas_max, entrada_min): o MotorCX não calcula oferta.
-- Fica sem uso (não apaga): voz_alcada_carteira.ofertas_padrao e validade_dias (a alçada é só trava; Q6, Q13).
-- Depende dos SQL 58, 68, 73, 88 e 95. Pode rodar de novo. Se o SQL 58, 88 ou 95 rodar de novo, rode este depois.

-- ================================================================ 0. troca pontual em função existente
create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then          -- já aplicado
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

-- ================================================================ 1. formato da parte "ofertas"
create or replace function public.ofertas_mailing_valida(j jsonb) returns boolean
language sql immutable set search_path = '' as $$
    select coalesce(
        jsonb_typeof(j) = 'object'
        and (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(j) k) = array['conector_id', 'modo']
        and j ->> 'modo' in ('api_arquivo', 'arquivo_api', 'so_api', 'so_arquivo')
        and case when j ->> 'modo' = 'so_arquivo' then jsonb_typeof(j -> 'conector_id') = 'null'
                 else jsonb_typeof(j -> 'conector_id') = 'number' and (j ->> 'conector_id') ~ '^[1-9][0-9]{0,17}$' end,
        false)
$$;
comment on function public.ofertas_mailing_valida(jsonb) is
    'SQL 130: forma da parte "ofertas" de voz_mailing_config ({modo, conector_id}). Cópia em site/src/lib/ofertas-voz.ts '
    'e voz/fluxo.py (config_ofertas).';

-- ================================================================ 2. voz_mailing_config: a parte "ofertas"
alter table public.voz_mailing_config add column if not exists ofertas jsonb;
alter table public.voz_mailing_config alter column identidade drop not null;
alter table public.voz_mailing_config drop constraint if exists voz_mailing_config_identidade_check;
alter table public.voz_mailing_config drop constraint if exists voz_mailing_config_identidade_valida;
alter table public.voz_mailing_config add constraint voz_mailing_config_identidade_valida
    check (identidade is null or public.identidade_mailing_valida(identidade));
alter table public.voz_mailing_config drop constraint if exists voz_mailing_config_ofertas_valida;
alter table public.voz_mailing_config add constraint voz_mailing_config_ofertas_valida
    check (ofertas is null or public.ofertas_mailing_valida(ofertas));
alter table public.voz_mailing_config drop constraint if exists voz_mailing_config_alguma_parte;
alter table public.voz_mailing_config add constraint voz_mailing_config_alguma_parte
    check (identidade is not null or ofertas is not null);
comment on column public.voz_mailing_config.ofertas is
    'SQL 130: de onde vêm as ofertas do agente ({modo, conector_id}). Nula = o padrão (API → arquivo; só o arquivo sem '
    'API). Só o Admin do cliente ativa (ativar_ofertas_voz); a equipe MotorCX grava rascunho (voz_ofertas_rascunho).';

-- a identidade em vigor: a da carteira; sem ela, a da empresa toda (só versões com identidade; null = o de hoje)
create or replace function public.identidade_voz_vigente(empresa bigint, credor bigint) returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object('id', c.id, 'credor_id', c.credor_id, 'identidade', c.identidade,
                              'vigente_desde', c.vigente_desde)
      from public.voz_mailing_config c
     where (public.chamada_do_servidor() or public.chamada_da_vm_voz() or empresa in (select public.minhas_empresas()))
       and c.empresa_id = empresa and (c.credor_id = credor or c.credor_id is null) and c.vigente_ate is null
       and c.identidade is not null
     order by (c.credor_id is null) limit 1
$$;
revoke all on function public.identidade_voz_vigente(bigint, bigint) from public, anon;
grant execute on function public.identidade_voz_vigente(bigint, bigint) to authenticated, service_role;

-- as ofertas em vigor: as da carteira; sem elas, as da empresa toda; sem as duas, null (= o padrão)
create or replace function public.ofertas_voz_vigente(empresa bigint, credor bigint) returns jsonb
language sql stable security definer set search_path = public as $$
    select jsonb_build_object('id', c.id, 'credor_id', c.credor_id, 'ofertas', c.ofertas, 'vigente_desde', c.vigente_desde)
      from public.voz_mailing_config c
     where (public.chamada_do_servidor() or public.chamada_da_vm_voz() or empresa in (select public.minhas_empresas()))
       and c.empresa_id = empresa and (c.credor_id = credor or c.credor_id is null) and c.vigente_ate is null
       and c.ofertas is not null
     order by (c.credor_id is null) limit 1
$$;
revoke all on function public.ofertas_voz_vigente(bigint, bigint) from public, anon;
grant execute on function public.ofertas_voz_vigente(bigint, bigint) to authenticated, service_role;

-- a carteira usa o arquivo? Sim, a menos que esteja em "só a API" (o padrão usa o arquivo como reserva)
create or replace function public.ofertas_voz_usa_arquivo(empresa bigint, credor bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce(public.ofertas_voz_vigente(empresa, credor) -> 'ofertas' ->> 'modo', 'api_arquivo') <> 'so_api'
$$;
revoke all on function public.ofertas_voz_usa_arquivo(bigint, bigint) from public, anon;
grant execute on function public.ofertas_voz_usa_arquivo(bigint, bigint) to authenticated, service_role;

-- "o que mudou" em palavras (para o Histórico; nunca dado de cliente)
create or replace function public.ofertas_mailing_mudancas(antes jsonb, depois jsonb) returns text
language sql stable security definer set search_path = public as $$
    with nomes(k, v) as (values
        ('api_arquivo', 'API, e o arquivo como reserva'), ('arquivo_api', 'arquivo, e a API como reserva'),
        ('so_api', 'só a API'), ('so_arquivo', 'só o arquivo')),
    partes as (
        select 1 o, 'Ofertas: ' || coalesce((select v from nomes where k = depois ->> 'modo'), depois ->> 'modo') t
         where antes is null or antes ->> 'modo' is distinct from depois ->> 'modo'
        union all
        select 2, 'API: ' || coalesce((select k.nome from public.crm_conectores k
                                        where k.id = (depois ->> 'conector_id')::bigint), 'conector ' || (depois ->> 'conector_id'))
         where depois ->> 'conector_id' is not null and (antes is null or antes ->> 'conector_id' is distinct from depois ->> 'conector_id'))
    select case when depois is null then 'Ofertas: voltou ao padrão (API, e o arquivo como reserva)'
                else coalesce(string_agg(t, ' · ' order by o), 'Sem mudança') end
      from partes
$$;
revoke all on function public.ofertas_mailing_mudancas(jsonb, jsonb) from public, anon;

-- salvar a IDENTIDADE (SQL 88) mantendo as ofertas da versão atual. identidade null = voltar ao de hoje.
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
    if atual.id is not null and atual.identidade is not distinct from identidade then
        return atual.id;                                  -- nada mudou: não abre versão
    end if;
    if identidade is null then
        if atual.id is null then
            return null;
        end if;
        update public.voz_mailing_config c set vigente_ate = now(),
               mudancas = left(coalesce(c.mudancas || ' | ', '') || 'Encerrada: ' || public.identidade_mailing_mudancas(c.identidade, null), 2000)
         where c.id = atual.id;
        if atual.ofertas is null then
            return null;
        end if;
        insert into public.voz_mailing_config (empresa_id, credor_id, identidade, ofertas, mudancas)
        values (empresa, credor, null, atual.ofertas, public.identidade_mailing_mudancas(atual.identidade, null))
        returning id into novo;
        return novo;
    end if;
    if atual.id is not null then
        update public.voz_mailing_config c set vigente_ate = now() where c.id = atual.id;
    end if;
    insert into public.voz_mailing_config (empresa_id, credor_id, identidade, ofertas, mudancas)
    values (empresa, credor, identidade, atual.ofertas, public.identidade_mailing_mudancas(atual.identidade, identidade))
    returning id into novo;
    return novo;
end $$;
revoke all on function public.salvar_config_mailing_voz(bigint, bigint, jsonb) from public, anon;
grant execute on function public.salvar_config_mailing_voz(bigint, bigint, jsonb) to authenticated;

-- ================================================================ 3. quem muda: Admin do cliente ativa; equipe, rascunho
create or replace function public.pode_ativar_ofertas_voz(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select empresa is not null and public.cliente_pode(empresa, 'editar_orquestracao')
$$;
create or replace function public.pode_rascunho_ofertas_voz(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select empresa is not null and (public.pode_ativar_ofertas_voz(empresa) or public.pode_editar_fluxo_voz(empresa))
$$;
comment on function public.pode_ativar_ofertas_voz(bigint) is
    'SQL 130 (Q15): quem ativa a fonte e a ordem das ofertas do agente: o cliente com editar_orquestracao (nunca a equipe).';
comment on function public.pode_rascunho_ofertas_voz(bigint) is
    'SQL 130 (Q15): quem grava o rascunho das ofertas: quem ativa, e a equipe MotorCX que monta o fluxo (SQL 68).';
revoke all on function public.pode_ativar_ofertas_voz(bigint), public.pode_rascunho_ofertas_voz(bigint) from public, anon;
grant execute on function public.pode_ativar_ofertas_voz(bigint), public.pode_rascunho_ofertas_voz(bigint) to authenticated;

create table if not exists public.voz_ofertas_rascunho (
    id          bigint generated always as identity primary key,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint references public.credores (id) on delete cascade,          -- nulo = empresa toda
    ofertas     jsonb not null check (public.ofertas_mailing_valida(ofertas)),
    salvo_por   uuid default auth.uid() references auth.users (id) on delete set null,
    salvo_em    timestamptz not null default now()
);
create unique index if not exists voz_ofertas_rascunho_carteira on public.voz_ofertas_rascunho (empresa_id, coalesce(credor_id, 0));
comment on table public.voz_ofertas_rascunho is
    'SQL 130: rascunho da fonte e da ordem das ofertas (um por carteira). A equipe MotorCX monta; o Admin do cliente '
    'ativa (ativar_ofertas_voz apaga o rascunho). Não vale para as ligações.';
alter table public.voz_ofertas_rascunho enable row level security;
drop policy if exists voz_ofertas_rascunho_ver on public.voz_ofertas_rascunho;
create policy voz_ofertas_rascunho_ver on public.voz_ofertas_rascunho for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_ofertas_rascunho from anon;
revoke insert, update, delete, truncate on public.voz_ofertas_rascunho from authenticated;
grant select on public.voz_ofertas_rascunho to authenticated, service_role;
drop trigger if exists z_auditar on public.voz_ofertas_rascunho;
create trigger z_auditar after insert or update or delete on public.voz_ofertas_rascunho
    for each row execute function public.auditar();

-- o conector da API tem de ser um "Buscar ofertas" da empresa (pode estar em rascunho/pausado: a tela avisa)
create or replace function public.ofertas_voz_conferir(empresa bigint, credor bigint, ofertas jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
begin
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if ofertas is null then
        return;
    end if;
    if not public.ofertas_mailing_valida(ofertas) then
        raise exception 'configuração de ofertas inválida: escolha de onde vêm as ofertas e, com a API, o conector';
    end if;
    if ofertas ->> 'conector_id' is not null and not exists (
        select 1 from public.crm_conectores k where k.id = (ofertas ->> 'conector_id')::bigint and k.empresa_id = empresa
           and k.finalidade = 'buscar_ofertas') then
        raise exception 'o conector escolhido não é um "Buscar ofertas" desta empresa';
    end if;
end $$;
revoke all on function public.ofertas_voz_conferir(bigint, bigint, jsonb) from public, anon, authenticated;

-- rascunho: ofertas null apaga o rascunho
create or replace function public.salvar_rascunho_ofertas_voz(empresa bigint, credor bigint, ofertas jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
    if not public.pode_rascunho_ofertas_voz(empresa) then
        raise exception 'seu perfil não monta o rascunho das ofertas do agente desta empresa';
    end if;
    perform public.ofertas_voz_conferir(empresa, credor, ofertas);
    if ofertas is null then
        delete from public.voz_ofertas_rascunho r where r.empresa_id = empresa and r.credor_id is not distinct from credor;
        return null;
    end if;
    insert into public.voz_ofertas_rascunho (empresa_id, credor_id, ofertas)
    values (empresa, credor, ofertas)
    on conflict (empresa_id, coalesce(credor_id, 0)) do update
       set ofertas = excluded.ofertas, salvo_por = auth.uid(), salvo_em = now()
    returning id into novo;
    return novo;
end $$;
revoke all on function public.salvar_rascunho_ofertas_voz(bigint, bigint, jsonb) from public, anon;
grant execute on function public.salvar_rascunho_ofertas_voz(bigint, bigint, jsonb) to authenticated;

-- ativar (só o Admin do cliente): abre versão com a identidade atual e as ofertas novas; null = voltar ao padrão
create or replace function public.ativar_ofertas_voz(empresa bigint, credor bigint, ofertas jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    atual public.voz_mailing_config;
    novo bigint;
begin
    if not public.pode_ativar_ofertas_voz(empresa) then
        raise exception 'só o Admin do cliente (Editar a orquestração) ativa as ofertas do agente; a equipe MotorCX monta o rascunho';
    end if;
    perform public.ofertas_voz_conferir(empresa, credor, ofertas);
    perform pg_advisory_xact_lock(hashtext('voz_mailing_config'), hashtext(empresa::text || ':' || coalesce(credor, 0)::text));
    delete from public.voz_ofertas_rascunho r where r.empresa_id = empresa and r.credor_id is not distinct from credor;
    select * into atual from public.voz_mailing_config c
     where c.empresa_id = empresa and c.credor_id is not distinct from credor and c.vigente_ate is null;
    if atual.id is not null and atual.ofertas is not distinct from ofertas then
        return atual.id;                                  -- nada mudou: não abre versão
    end if;
    if ofertas is null and atual.id is null then
        return null;
    end if;
    if atual.id is not null then
        update public.voz_mailing_config c set vigente_ate = now() where c.id = atual.id;
    end if;
    if ofertas is null and atual.identidade is null then
        update public.voz_mailing_config c
           set mudancas = left(coalesce(c.mudancas || ' | ', '') || 'Encerrada: ' || public.ofertas_mailing_mudancas(c.ofertas, null), 2000)
         where c.id = atual.id;
        return null;
    end if;
    insert into public.voz_mailing_config (empresa_id, credor_id, identidade, ofertas, mudancas)
    values (empresa, credor, atual.identidade, ofertas, public.ofertas_mailing_mudancas(atual.ofertas, ofertas))
    returning id into novo;
    return novo;
end $$;
revoke all on function public.ativar_ofertas_voz(bigint, bigint, jsonb) from public, anon;
grant execute on function public.ativar_ofertas_voz(bigint, bigint, jsonb) to authenticated;

-- ================================================================ 4. em_falha: alternativa_carteira → reserva_arquivo
do $em_falha$
declare r record;
begin
    for r in select conname from pg_constraint
              where conrelid = 'public.crm_conectores'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) like '%alternativa_carteira%' loop
        execute format('alter table public.crm_conectores drop constraint %I', r.conname);
    end loop;
end $em_falha$;
update public.crm_conectores set em_falha = 'reserva_arquivo' where em_falha = 'alternativa_carteira';
alter table public.crm_conectores drop constraint if exists crm_conectores_em_falha_check;
alter table public.crm_conectores add constraint crm_conectores_em_falha_check
    check (em_falha in ('ramo', 'reserva_arquivo', 'transferir'));
alter table public.crm_conectores drop constraint if exists crm_conectores_reserva_arquivo_check;
alter table public.crm_conectores add constraint crm_conectores_reserva_arquivo_check
    check (em_falha <> 'reserva_arquivo' or finalidade = 'buscar_ofertas');
comment on column public.crm_conectores.em_falha is
    'ramo = segue a saída "falhou" do bloco; reserva_arquivo = as ofertas do arquivo do dia (só buscar_ofertas; SQL 130, '
    'era alternativa_carteira); transferir = transfere para humano.';
-- quem ainda mandar o nome antigo (site em cache) grava o novo
create or replace function public.em_falha_conector_legado() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.em_falha = 'alternativa_carteira' then
        new.em_falha := 'reserva_arquivo';
    end if;
    return new;
end $$;
revoke all on function public.em_falha_conector_legado() from public, anon, authenticated;
drop trigger if exists a_em_falha_legado on public.crm_conectores;
create trigger a_em_falha_legado before insert or update of em_falha on public.crm_conectores
    for each row execute function public.em_falha_conector_legado();

-- ================================================================ 5. ofertas do arquivo do dia (ninguém lê a tabela)
-- até 3 ofertas, na ordem do arquivo; campos do contrato mínimo (SPEC §4). Obrigatórios: id, parcelas, valor_parcela,
-- validade. Desconto só em % (0–100).
create or replace function public.ofertas_dia_validas(o jsonb) returns boolean
language sql immutable set search_path = '' as $$
    select coalesce(jsonb_typeof(o) = 'array' and jsonb_array_length(o) between 1 and 3
        and not exists (
            select 1 from jsonb_array_elements(o) x
             where jsonb_typeof(x) <> 'object'
                or exists (select 1 from jsonb_object_keys(x) k
                            where k not in ('id', 'parcelas', 'valor_parcela', 'desconto_pct', 'entrada', 'validade',
                                            'valor_total', 'vencimento'))
                or not coalesce(jsonb_typeof(x -> 'id') = 'string' and (x ->> 'id') ~ '^[A-Za-z0-9_.\-]{1,40}$', false)
                or not coalesce(jsonb_typeof(x -> 'parcelas') = 'number' and (x ->> 'parcelas') ~ '^[0-9]{1,3}$'
                                and (x ->> 'parcelas')::int between 1 and 120, false)
                or not coalesce(jsonb_typeof(x -> 'valor_parcela') = 'number'
                                and (x ->> 'valor_parcela')::numeric > 0 and (x ->> 'valor_parcela')::numeric < 100000000, false)
                or not coalesce(jsonb_typeof(x -> 'validade') = 'string' and (x ->> 'validade') ~ '^\d{4}-\d{2}-\d{2}$', false)
                or (x ? 'desconto_pct' and not coalesce(jsonb_typeof(x -> 'desconto_pct') = 'number'
                                                        and (x ->> 'desconto_pct')::numeric between 0 and 100, false))
                or (x ? 'entrada' and not coalesce(jsonb_typeof(x -> 'entrada') = 'number'
                                                   and (x ->> 'entrada')::numeric between 0 and 100000000, false))
                or (x ? 'valor_total' and not coalesce(jsonb_typeof(x -> 'valor_total') = 'number'
                                                       and (x ->> 'valor_total')::numeric between 0 and 1000000000, false))
                or (x ? 'vencimento' and not coalesce(jsonb_typeof(x -> 'vencimento') = 'string'
                                                      and (x ->> 'vencimento') ~ '^\d{4}-\d{2}-\d{2}$', false)))
        and (select count(distinct x ->> 'id') = count(*) from jsonb_array_elements(o) x), false)
$$;

create table if not exists public.voz_ofertas_dia (
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null references public.credores (id) on delete cascade,
    id_cliente    text not null check (char_length(id_cliente) between 1 and 60),
    contrato      text not null default '' check (char_length(contrato) <= 60),
    principal     boolean not null default true,
    ofertas       jsonb not null check (public.ofertas_dia_validas(ofertas)),
    dia           date not null,
    publicado_em  timestamptz not null default now(),
    primary key (empresa_id, credor_id, id_cliente, contrato),
    constraint voz_ofertas_dia_id_cliente_sem_cpf check (not public.parece_cpf(id_cliente))
);
create index if not exists voz_ofertas_dia_dia on public.voz_ofertas_dia (dia);
comment on table public.voz_ofertas_dia is
    'SQL 130: ofertas prontas do arquivo (colunas oferta1..3_*) dos clientes da lista de hoje do agente, por contrato '
    '(principal = o de maior saldo). Só números e datas. A rotina publica e troca tudo da carteira; o job noturno apaga o '
    'que passou de 1 dia. Sem política: só ofertas_mailing_voz lê, e só dentro de uma ligação com a identidade confirmada.';
alter table public.voz_ofertas_dia enable row level security;
revoke all on public.voz_ofertas_dia from public, anon, authenticated, service_role;

-- publicação da rotina (service_role): substituir = true apaga tudo da carteira antes (1º lote). Carteira em "só a
-- API": apaga e não grava nada.
create or replace function public.publicar_ofertas_voz(empresa bigint, credor bigint, dia date, linhas jsonb,
                                                       substituir boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    apagados int := 0; gravados int := 0; usa boolean;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só a rotina do motor publica as ofertas do arquivo';
    end if;
    if not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if linhas is null or jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 200000 then
        raise exception 'linhas inválidas';
    end if;
    if substituir then
        delete from public.voz_ofertas_dia d where d.empresa_id = empresa and d.credor_id = credor;
        get diagnostics apagados = row_count;
    end if;
    usa := public.ofertas_voz_usa_arquivo(empresa, credor);
    if usa then
        insert into public.voz_ofertas_dia (empresa_id, credor_id, id_cliente, contrato, principal, ofertas, dia)
        select empresa, credor, l ->> 'id_cliente', coalesce(l ->> 'contrato', ''), coalesce((l ->> 'principal')::boolean, true),
               l -> 'ofertas', publicar_ofertas_voz.dia
          from jsonb_array_elements(linhas) l
        on conflict (empresa_id, credor_id, id_cliente, contrato) do update
           set principal = excluded.principal, ofertas = excluded.ofertas, dia = excluded.dia, publicado_em = now();
        get diagnostics gravados = row_count;
    end if;
    return jsonb_build_object('gravados', gravados, 'apagados', apagados, 'usa_arquivo', usa);
end $$;
revoke all on function public.publicar_ofertas_voz(bigint, bigint, date, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.publicar_ofertas_voz(bigint, bigint, date, jsonb, boolean) to service_role;

-- identidade confirmada pelo CRM nesta ligação (registrada pela VM, que é quem chamou o conector Validar cadastro):
-- abre a ligação já confirmada. Ligação de outro cliente: erro.
create or replace function public.confirmar_identidade_crm_voz(empresa bigint, credor bigint, id_cliente text,
                                                               id_chamada text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ch public.voz_identidade_chamadas;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a VM de voz registra a identidade confirmada';
    end if;
    if id_chamada is null or id_chamada !~ '^[A-Za-z0-9_.:\-]{4,80}$' or coalesce(char_length(id_cliente), 0) not between 1 and 60
       or not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'ligação inválida';
    end if;
    insert into public.voz_identidade_chamadas (empresa_id, credor_id, id_chamada, id_cliente, confirmada_em)
    values (empresa, credor, confirmar_identidade_crm_voz.id_chamada, confirmar_identidade_crm_voz.id_cliente, now())
    on conflict on constraint voz_identidade_chamadas_pkey do nothing;
    select * into ch from public.voz_identidade_chamadas c
     where c.empresa_id = empresa and c.id_chamada = confirmar_identidade_crm_voz.id_chamada for update;
    if ch.credor_id <> credor or ch.id_cliente <> confirmar_identidade_crm_voz.id_cliente
       or ch.aberta_em < now() - interval '30 minutes' then
        raise exception 'ligação de outro cliente';
    end if;
    update public.voz_identidade_chamadas c set confirmada_em = coalesce(c.confirmada_em, now())
     where c.empresa_id = empresa and c.id_chamada = confirmar_identidade_crm_voz.id_chamada;
    return true;
end $$;
revoke all on function public.confirmar_identidade_crm_voz(bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.confirmar_identidade_crm_voz(bigint, bigint, text, text) to service_role;

-- as ofertas do arquivo de UM cliente, só dentro de uma ligação dele com a identidade confirmada. Do contrato da
-- ligação; sem ele (ou sem oferta para ele), do contrato principal (maior saldo). Sem oferta: [] (a reserva entra).
create or replace function public.ofertas_mailing_voz(empresa bigint, credor bigint, id_cliente text, id_chamada text,
                                                      contrato text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    ch public.voz_identidade_chamadas;
    o jsonb;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a VM de voz lê as ofertas do arquivo';
    end if;
    select * into ch from public.voz_identidade_chamadas c
     where c.empresa_id = empresa and c.id_chamada = ofertas_mailing_voz.id_chamada;
    if ch.id_chamada is null or ch.credor_id <> credor or ch.id_cliente <> ofertas_mailing_voz.id_cliente
       or ch.confirmada_em is null or ch.aberta_em < now() - interval '30 minutes' then
        raise exception 'identidade não confirmada nesta ligação';
    end if;
    if not public.ofertas_voz_usa_arquivo(empresa, credor) then
        return '[]'::jsonb;
    end if;
    select d.ofertas into o from public.voz_ofertas_dia d
     where d.empresa_id = empresa and d.credor_id = credor and d.id_cliente = ofertas_mailing_voz.id_cliente
       and (d.contrato = coalesce(ofertas_mailing_voz.contrato, '') or d.principal)
     order by (d.contrato = coalesce(ofertas_mailing_voz.contrato, '')) desc, d.principal desc limit 1;
    return coalesce(o, '[]'::jsonb);
end $$;
revoke all on function public.ofertas_mailing_voz(bigint, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.ofertas_mailing_voz(bigint, bigint, text, text, text) to service_role;

-- job noturno: ofertas com mais de 1 dia e as de carteira que não usa mais o arquivo. Só contagem de volta.
create or replace function public.limpar_ofertas_voz() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    a int; b int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor limpa as ofertas do arquivo';
    end if;
    delete from public.voz_ofertas_dia x where x.dia < hoje - 1;
    get diagnostics a = row_count;
    delete from public.voz_ofertas_dia x where not public.ofertas_voz_usa_arquivo(x.empresa_id, x.credor_id);
    get diagnostics b = row_count;
    return jsonb_build_object('ofertas', a + b);
end $$;
revoke all on function public.limpar_ofertas_voz() from public, anon, authenticated;
grant execute on function public.limpar_ofertas_voz() to service_role;

-- ================================================================ 6. acesso próprio da VM (papel motorcx_voz)
create or replace function voz_vm.ofertas_vigente(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.ofertas_voz_vigente((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint)
     where voz_vm.tem_voz((args ->> 'empresa')::bigint)
$$;
create or replace function voz_vm.confirmar_identidade_crm(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz';
    end if;
    return to_jsonb(public.confirmar_identidade_crm_voz((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint,
                                                        args ->> 'id_cliente', args ->> 'id_chamada'));
end $$;
create or replace function voz_vm.ofertas_mailing(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz';
    end if;
    return public.ofertas_mailing_voz((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint, args ->> 'id_cliente',
                                      args ->> 'id_chamada', args ->> 'contrato');
end $$;
create or replace function voz_vm.limpar_ofertas(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.limpar_ofertas_voz()
$$;
revoke all on function voz_vm.ofertas_vigente(jsonb), voz_vm.confirmar_identidade_crm(jsonb), voz_vm.ofertas_mailing(jsonb),
                       voz_vm.limpar_ofertas(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.ofertas_vigente(jsonb), voz_vm.confirmar_identidade_crm(jsonb), voz_vm.ofertas_mailing(jsonb),
                          voz_vm.limpar_ofertas(jsonb) to motorcx_voz;

-- ================================================================ 7. fluxo: a etapa Oferta aceita a origem 'arquivo'
select pg_temp.trocar('public.fluxo_voz_erros(jsonb)',
    $a$public.fluxo_voz_aux_em(p -> 'origem', array['conector', 'carteira'])$a$,
    $b$public.fluxo_voz_aux_em(p -> 'origem', array['conector', 'arquivo', 'carteira'])$b$);

-- ================================================================ 8. colunas de oferta na carga (mapeamento)
select pg_temp.trocar('public.salvar_mapeamento_base(bigint,jsonb,jsonb)',
    $a$if k = any (simples) then$a$,
    $b$if k = any (simples) or k ~ '^oferta[1-3]_(id|parcelas|valor_parcela|desconto|entrada|validade|valor_total|vencimento)$' then$b$);
select pg_temp.trocar('public.salvar_mapeamento_base(bigint,jsonb,jsonb)',
    $a$raise exception 'Escolha uma coluna do arquivo para %.', nomes ->> k;$a$,
    $b$raise exception 'Escolha uma coluna do arquivo para %.', coalesce(nomes ->> k, 'a ' || replace(k, '_', ' '));$b$);

do $conta$
declare n int; e int;
begin
    select count(*) into n from public.voz_mailing_config where vigente_ate is null and ofertas is not null;
    select count(*) into e from public.crm_conectores where em_falha = 'reserva_arquivo';
    raise notice 'SQL 130: % carteira(s) com ofertas configuradas; % conector(es) com o arquivo como reserva', n, e;
end $conta$;
