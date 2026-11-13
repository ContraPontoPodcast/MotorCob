-- SQL 131 · Agente de voz: o executor das ofertas só da API ou do arquivo (SPEC_OFERTAS_v2; PR 2 do plano, a VM).
--
-- 1. campos_oferta_voz() ganha oferta.validade (obrigatória no contrato da API: sem ela a oferta é descartada; o mapa de
--    saída do conector passa a poder preenchê-la) e oferta.condicao (a frase fixa da oferta, só com os campos que vieram,
--    para a fala da etapa Oferta). Mesma lista em voz/fluxo_validador.py (CAMPOS_OFERTA).
-- 2. voz_ofertas_uso: uma linha por ligação que buscou ofertas, SÓ códigos e contagens (modo, fonte usada, por que a
--    reserva entrou, se pulou a API instável, a classe e o tempo da API, descartes por motivo, quantas ofertas). Nunca o
--    cliente, nunca valores. Para o Painel e a tela Ofertas da carteira ("oferta usada por fonte", "descartadas por
--    motivo", "API: falhas e reserva usada"). A VM grava por registrar_ofertas_voz (lote); ninguém lê direto (o site lê
--    pela função da tela, SQL 132). Apaga com 90 dias (limpar_ofertas_voz).
-- Depende do SQL 130. Pode rodar de novo. Se o SQL 58 rodar de novo, rode este depois (ele refaz campos_oferta_voz).

-- ================================================================ 1. campos de oferta
create or replace function public.campos_oferta_voz() returns text[]
language sql immutable parallel safe as $$
    select array['oferta.id', 'oferta.parcelas', 'oferta.valor_parcela', 'oferta.desconto_pct', 'oferta.vencimento',
                 'oferta.valor_total', 'oferta.entrada', 'oferta.validade', 'oferta.condicao']::text[]
$$;

-- ================================================================ 2. uso das fontes (só códigos e contagens)
create or replace function public.descartes_ofertas_validos(d jsonb) returns boolean
language sql immutable set search_path = '' as $$
    select coalesce(jsonb_typeof(d) = 'object'
        and not exists (select 1 from jsonb_each(d) x
                         where x.key not in ('incompleta', 'vencida', 'acima_alcada', 'conta')
                            or jsonb_typeof(x.value) <> 'number' or (x.value #>> '{}') !~ '^[0-9]{1,4}$'), false)
$$;

create table if not exists public.voz_ofertas_uso (
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    id_chamada       text not null check (id_chamada ~ '^[A-Za-z0-9_.:\-]{4,80}$'),
    credor_id        bigint references public.credores (id) on delete set null,
    dia              date not null default (now() at time zone 'America/Sao_Paulo')::date,
    fluxo_versao_id  bigint,
    bloco_id         text check (bloco_id ~ '^N[0-9]{1,3}$'),
    modo             text not null check (modo in ('api_arquivo', 'arquivo_api', 'so_api', 'so_arquivo')),
    fonte            text check (fonte in ('api', 'arquivo')),
    motivo           text not null check (motivo in ('primeira', 'api_falhou', 'api_instavel', 'api_descartadas',
                                                     'api_ausente', 'arquivo_vazio', 'arquivo_descartadas',
                                                     'arquivo_falhou', 'arquivo_ausente', 'api_sem_oferta', 'sem_oferta')),
    pulou_api        boolean not null default false,
    api_classe       text check (api_classe in ('ok', 'tempo', 'http_4xx', 'http_5xx', 'mapa_invalido', 'recusado')),
    api_ms           int check (api_ms between 0 and 120000),
    descartes        jsonb not null default '{}' check (public.descartes_ofertas_validos(descartes)),
    ofertas          int not null default 0 check (ofertas between 0 and 3),
    registrado_em    timestamptz not null default now(),
    primary key (empresa_id, id_chamada),
    check (fonte is not null or ofertas = 0)
);
create index if not exists voz_ofertas_uso_dia on public.voz_ofertas_uso (empresa_id, credor_id, dia);
comment on table public.voz_ofertas_uso is
    'SQL 131: de onde vieram as ofertas de cada ligação (só códigos e contagens: modo, fonte, motivo da reserva, API '
    'pulada, classe e tempo da API, descartes por motivo, quantas). Nunca o cliente nem valores. A VM grava; o site lê '
    'pela função da tela. Apaga com 90 dias.';
alter table public.voz_ofertas_uso enable row level security;
revoke all on public.voz_ofertas_uso from public, anon, authenticated;
grant select on public.voz_ofertas_uso to service_role;

-- a VM grava um lote (repetir a mesma ligação não duplica). Linha de empresa sem voz ou fora do formato: recusa o lote.
create or replace function public.registrar_ofertas_voz(linhas jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a VM de voz registra o uso das ofertas';
    end if;
    if linhas is null or jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 5000 then
        raise exception 'linhas inválidas';
    end if;
    insert into public.voz_ofertas_uso (empresa_id, id_chamada, credor_id, fluxo_versao_id, bloco_id, modo, fonte, motivo,
                                        pulou_api, api_classe, api_ms, descartes, ofertas)
    select (l ->> 'empresa_id')::bigint, l ->> 'id_chamada',
           (select c.id from public.credores c where c.id = (l ->> 'credor_id')::bigint
                                                 and c.empresa_id = (l ->> 'empresa_id')::bigint),
           (l ->> 'fluxo_versao_id')::bigint, l ->> 'bloco_id', l ->> 'modo', l ->> 'fonte', l ->> 'motivo',
           coalesce((l ->> 'pulou_api')::boolean, false), l ->> 'api_classe', (l ->> 'api_ms')::int,
           coalesce(l -> 'descartes', '{}'), coalesce((l ->> 'ofertas')::int, 0)
      from jsonb_array_elements(linhas) l
    on conflict (empresa_id, id_chamada) do nothing;
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function public.registrar_ofertas_voz(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_ofertas_voz(jsonb) to service_role;

create or replace function voz_vm.registrar_ofertas(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if exists (select 1 from jsonb_array_elements(coalesce(args -> 'linhas', '[]')) l
                where not voz_vm.tem_voz((l ->> 'empresa_id')::bigint)) then
        raise exception 'empresa sem voz';
    end if;
    return to_jsonb(public.registrar_ofertas_voz(args -> 'linhas'));
end $$;
revoke all on function voz_vm.registrar_ofertas(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.registrar_ofertas(jsonb) to motorcx_voz;

-- a limpeza do job noturno passa a apagar também o uso com mais de 90 dias
create or replace function public.limpar_ofertas_voz() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    a int; b int; c int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor limpa as ofertas do arquivo';
    end if;
    delete from public.voz_ofertas_dia x where x.dia < hoje - 1;
    get diagnostics a = row_count;
    delete from public.voz_ofertas_dia x where not public.ofertas_voz_usa_arquivo(x.empresa_id, x.credor_id);
    get diagnostics b = row_count;
    delete from public.voz_ofertas_uso x where x.dia < hoje - 90;
    get diagnostics c = row_count;
    return jsonb_build_object('ofertas', a + b, 'uso', c);
end $$;
revoke all on function public.limpar_ofertas_voz() from public, anon, authenticated;
grant execute on function public.limpar_ofertas_voz() to service_role;
