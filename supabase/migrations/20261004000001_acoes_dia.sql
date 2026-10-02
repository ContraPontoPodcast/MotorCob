-- Ações realizadas: quantas ações o MotorCob mandou fazer e o que voltou delas.
--
-- Uma linha por empresa × dia × canal × régua (momento) × segmento × persona. Só número
-- agregado: nenhum ID de cliente, telefone ou e-mail. A rotina do Mac regrava os últimos
-- 60 dias a cada execução (a ocorrência de um dia pode chegar depois).
--   enviadas      ações exportadas na lista (reserva só conta se teve retorno)
--   reservas      ações exportadas como reserva
--   com_retorno   ações com ocorrência/retorno · retornos: total de ocorrências
--   cpcs          ações com CPC · custo: R$ (sem retorno: custo do canal)
--   primeiros_cpc / acoes_ate_primeiro_cpc: média de ações até o 1º CPC = a / b
--   regua = 'fora_da_lista': ocorrência sem ação exportada pelo MotorCob
-- Pode ser rodado de novo sem erro.

create table if not exists public.acoes_dia (
    empresa_id             bigint not null references public.empresas (id) on delete cascade,
    data                   date not null,
    canal                  text not null,
    regua                  text not null default '',
    cluster                text not null default '',
    persona                text not null default '',
    enviadas               int not null default 0,
    reservas               int not null default 0,
    com_retorno            int not null default 0,
    retornos               int not null default 0,
    cpcs                   int not null default 0,
    custo                  numeric(14, 2) not null default 0,
    primeiros_cpc          int not null default 0,
    acoes_ate_primeiro_cpc int not null default 0,
    atualizado_em          timestamptz not null default now(),
    primary key (empresa_id, data, canal, regua, cluster, persona)
);

create index if not exists acoes_dia_empresa_data on public.acoes_dia (empresa_id, data);

alter table public.acoes_dia enable row level security;

drop policy if exists acoes_dia_ver on public.acoes_dia;
create policy acoes_dia_ver on public.acoes_dia for select to authenticated
    using (public.pode_ver_empresa(empresa_id));

revoke all on public.acoes_dia from anon;
