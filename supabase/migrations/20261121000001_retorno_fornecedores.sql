-- Retorno dos fornecedores reais da Mensageria (Zenvia, Infobip, Sinch e Locaweb).
-- * No envio real a entrega, a resposta do cliente e o bounce não chegam na hora: o fornecedor avisa depois
--   (webhook) na função "retorno-mensageria". Ela grava aqui só o essencial, SEM o número nem o e-mail do cliente:
--   o id da mensagem no fornecedor, o tipo do aviso e, na resposta, o hash do número (igual a hash_destino) e o texto.
-- * O motor lê os avisos a cada minuto, atualiza a mensagem e o lote (funil), descadastro, Radar e atendimento,
--   e marca o aviso como processado. Avisos processados são apagados depois de 7 dias.
-- * mensageria_mensagens.confirmada_em: quando a operadora confirmou o envio ao número (conta em "Enviado").
-- Rode DEPOIS do SQL 23. Pode ser rodado de novo sem erro.

create table if not exists public.mensageria_eventos (
    id            bigint generated always as identity primary key,
    fornecedor    text not null check (fornecedor ~ '^[a-z0-9_-]{2,30}$'),
    evento_id     text check (char_length(evento_id) <= 200),
    id_externo    text check (char_length(id_externo) <= 120),
    tipo          text not null check (tipo in ('enviado', 'entregue', 'falhou', 'resposta', 'bounce', 'abertura', 'clique', 'spam')),
    canal         text check (canal in ('sms', 'rcs', 'email', 'whatsapp')),
    motivo        text check (char_length(motivo) <= 200),
    bounce        text check (bounce in ('permanente', 'temporario')),
    de_hash       text check (de_hash ~ '^[0-9a-f]{64}$'),
    texto         text check (char_length(texto) <= 2000),
    ocorrido_em   timestamptz not null default now(),
    recebido_em   timestamptz not null default now(),
    processado_em timestamptz,
    resultado     text check (char_length(resultado) <= 200),
    check (tipo <> 'resposta' or de_hash is not null),
    check (tipo = 'resposta' or id_externo is not null)
);
comment on table public.mensageria_eventos is
    'Avisos dos fornecedores (entrega, falha, resposta, bounce, abertura). Sem contato do cliente; 7 dias.';
-- o mesmo aviso repetido (o fornecedor reenvia quando não recebe resposta) entra uma vez só
create unique index if not exists mensageria_eventos_aviso on public.mensageria_eventos (fornecedor, evento_id);
create index if not exists mensageria_eventos_fila on public.mensageria_eventos (recebido_em) where processado_em is null;
alter table public.mensageria_eventos enable row level security;
revoke all on public.mensageria_eventos from anon, authenticated;

alter table public.mensageria_mensagens add column if not exists confirmada_em timestamptz;
comment on column public.mensageria_mensagens.confirmada_em is 'A operadora confirmou o envio ao número (funil: Enviado).';
create index if not exists mensageria_mensagens_externo on public.mensageria_mensagens (fornecedor, id_externo)
    where id_externo is not null;

-- Zenvia e Infobip também enviam RCS (entram no plano de rota do RCS só se a equipe colocar)
update public.mensageria_fornecedores
   set canais = (select array_agg(distinct c order by c) from unnest(canais || array['rcs']) c)
 where codigo in ('zenvia', 'infobip') and not ('rcs' = any (canais));

create or replace function public.limpar_eventos_mensageria() returns int
language sql security definer set search_path = public as $$
    with x as (delete from public.mensageria_eventos
                where processado_em is not null and processado_em < now() - interval '7 days' returning 1)
    select count(*)::int from x
$$;
revoke all on function public.limpar_eventos_mensageria() from public, anon, authenticated;
grant execute on function public.limpar_eventos_mensageria() to service_role;
