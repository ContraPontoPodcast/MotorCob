-- Funil de envio com Disparado separado de Enviado, status do e-mail e o Assistente MotorCob.
-- * SMS e RCS: Carregado → Higienizado → Disparado (o MotorCob entregou à operadora) → Enviado (a operadora
--   confirmou o envio ao número) → Entregue / Não entregue (retorno da operadora, DLR) → Respostas.
--   Percentuais: Enviado, Entregue e Não entregue ÷ Disparados; Respostas ÷ Entregues.
--   Sem retorno final: a operadora confirmou o envio e não devolveu a DLR de entregue nem de falha.
--   Entregue inclui quem recebeu e pediu para sair (descadastro).
-- * E-mail: Disparado (entregue ao provedor de e-mail) → Entregue (o servidor do destinatário aceitou) ou bounce
--   permanente / temporário; depois aberturas, cliques, respostas, descadastros e marcações de spam.
-- * Assistente: cada pergunta feita no Workspace fica registrada 90 dias (para a equipe ver o que não teve
--   resposta e melhorar a base). Quem grava é só a Edge Function "assistente"; o usuário vê e avalia as suas.
-- Pode ser rodado de novo sem erro.

-- ---------------------------------------------------------------- lotes: contadores novos
alter table public.mensageria_lotes add column if not exists disparadas int not null default 0;
alter table public.mensageria_lotes add column if not exists bounce_temporario int not null default 0;
alter table public.mensageria_lotes add column if not exists aberturas int not null default 0;
alter table public.mensageria_lotes add column if not exists cliques int not null default 0;
alter table public.mensageria_lotes add column if not exists spam int not null default 0;
alter table public.mensageria_lotes add column if not exists sem_retorno int not null default 0;
comment on column public.mensageria_lotes.disparadas is
    'Entregues pelo MotorCob à operadora (SMS/RCS) ou ao provedor de e-mail. Base dos percentuais de envio.';
comment on column public.mensageria_lotes.enviadas is
    'SMS/RCS: a operadora confirmou o envio ao número. E-mail: igual a disparadas. Antes do SQL 17 = disparadas.';
comment on column public.mensageria_lotes.sem_retorno is
    'SMS/RCS: a operadora confirmou o envio e não devolveu a DLR final (a mensagem fica "enviada").';
comment on column public.mensageria_lotes.falhas is
    'Não entregues (retorno de falha da operadora). No e-mail: bounce permanente.';
-- lotes antigos: tudo o que foi "enviado" tinha sido disparado
update public.mensageria_lotes set disparadas = enviadas where disparadas = 0 and enviadas > 0;

-- ---------------------------------------------------------------- mensagens: situação e eventos do e-mail
alter table public.mensageria_mensagens drop constraint if exists mensageria_mensagens_situacao_check;
alter table public.mensageria_mensagens add constraint mensageria_mensagens_situacao_check
    check (situacao in ('pendente', 'disparada', 'enviada', 'entregue', 'falhou', 'descadastro', 'bloqueada'));
alter table public.mensageria_mensagens add column if not exists bounce text
    check (bounce is null or bounce in ('permanente', 'temporario'));
alter table public.mensageria_mensagens add column if not exists aberta_em timestamptz;
alter table public.mensageria_mensagens add column if not exists clicada_em timestamptz;
alter table public.mensageria_mensagens add column if not exists spam_em timestamptz;
comment on column public.mensageria_mensagens.situacao is
    'pendente · disparada (com a operadora/provedor, sem retorno) · enviada (a operadora confirmou o envio, sem DLR '
    'final) · entregue · falhou (não entregue / bounce) · descadastro · bloqueada (higienização).';

-- ---------------------------------------------------------------- funil com todos os status
-- view nova (a mensageria_funil do SQL 14 continua igual, para os SQL anteriores poderem ser rodados de novo)
create or replace view public.mensageria_funil_status with (security_invoker = true) as
select l.empresa_id, l.canal, l.data, l.campanha_id, coalesce(c.nome, 'Lista do dia') as origem,
       sum(l.total)::bigint                                   as carregados,
       sum(l.invalidos)::bigint                               as invalidos,
       sum(l.bloqueadas - l.invalidos)::bigint                as bloqueados,
       sum(l.total - l.bloqueadas)::bigint                    as higienizados,
       sum(greatest(l.disparadas, l.enviadas))::bigint        as disparados,
       sum(l.enviadas)::bigint                                as enviados,
       sum(l.entregues)::bigint                               as entregues,
       sum(l.falhas)::bigint                                  as nao_entregues,
       sum(l.sem_retorno)::bigint                             as sem_retorno,
       sum(l.respostas)::bigint                               as respostas,
       sum(l.fallback)::bigint                                as fallback,
       sum(l.descadastros)::bigint                            as descadastros,
       sum(case when l.canal = 'email' then l.falhas else 0 end)::bigint          as bounce_permanente,
       sum(l.bounce_temporario)::bigint                       as bounce_temporario,
       sum(l.aberturas)::bigint                               as aberturas,
       sum(l.cliques)::bigint                                 as cliques,
       sum(l.spam)::bigint                                    as spam
  from public.mensageria_lotes l
  left join public.mensageria_campanhas c on c.id = l.campanha_id
 group by l.empresa_id, l.canal, l.data, l.campanha_id, c.nome;
grant select on public.mensageria_funil_status to authenticated;
revoke all on public.mensageria_funil_status from anon;

-- ---------------------------------------------------------------- relatórios: base "Funil de envio (status)"
create or replace view public.rel_funil with (security_invoker = true) as
select f.* from public.mensageria_funil_status f;
grant select on public.rel_funil to authenticated;
revoke all on public.rel_funil from anon;
insert into public.relatorio_bases (base, visao, nome, descricao, ordem) values
  ('funil', 'rel_funil', 'Funil de envio (status)',
   'Por dia, canal e origem: carregados, higienizados, disparados, enviados, entregues, não entregues, sem retorno, '
   'respostas e, no e-mail, bounces, aberturas, cliques e spam.', 2)
on conflict (base) do update set visao = excluded.visao, nome = excluded.nome, descricao = excluded.descricao,
                                 ordem = excluded.ordem;

insert into public.relatorio_campos (base, campo, rotulo, tipo, agrupavel, filtravel, ordem) values
  ('funil', 'data', 'Data', 'data', true, true, 1), ('funil', 'canal', 'Canal', 'texto', true, true, 2),
  ('funil', 'origem', 'Origem', 'texto', true, true, 3), ('funil', 'campanha_id', 'Campanha (código)', 'numero', true, true, 4),
  ('funil', 'carregados', 'Carregados', 'numero', false, false, 5), ('funil', 'invalidos', 'Inválidos', 'numero', false, false, 6),
  ('funil', 'bloqueados', 'Bloqueados', 'numero', false, false, 7), ('funil', 'higienizados', 'Higienizados', 'numero', false, false, 8),
  ('funil', 'disparados', 'Disparados', 'numero', false, false, 9), ('funil', 'enviados', 'Enviados', 'numero', false, false, 10),
  ('funil', 'entregues', 'Entregues', 'numero', false, false, 11), ('funil', 'nao_entregues', 'Não entregues', 'numero', false, false, 12),
  ('funil', 'sem_retorno', 'Sem retorno final', 'numero', false, false, 13), ('funil', 'respostas', 'Respostas', 'numero', false, false, 14),
  ('funil', 'fallback', 'Fallback', 'numero', false, false, 15), ('funil', 'descadastros', 'Descadastros', 'numero', false, false, 16),
  ('funil', 'bounce_permanente', 'Bounce permanente (e-mail)', 'numero', false, false, 17),
  ('funil', 'bounce_temporario', 'Bounce temporário (e-mail)', 'numero', false, false, 18),
  ('funil', 'aberturas', 'Aberturas únicas (e-mail)', 'numero', false, false, 19),
  ('funil', 'cliques', 'Cliques únicos (e-mail)', 'numero', false, false, 20),
  ('funil', 'spam', 'Marcados como spam (e-mail)', 'numero', false, false, 21)
on conflict (base, campo) do update set rotulo = excluded.rotulo, tipo = excluded.tipo, agrupavel = excluded.agrupavel,
                                        filtravel = excluded.filtravel, ordem = excluded.ordem;

insert into public.relatorios_modelos (empresa_id, nome, descricao, categoria, base, colunas, agrupar, metricas, ordem) values
  (null, 'Entregabilidade por dia e canal', 'Carregados, higienizados, disparados, enviados, entregues, não entregues e sem retorno por dia.', 'Entrega', 'funil',
   null, array['data', 'canal'], '[{"funcao":"somar","campo":"carregados","nome":"carregados"},{"funcao":"somar","campo":"higienizados","nome":"higienizados"},{"funcao":"somar","campo":"disparados","nome":"disparados"},{"funcao":"somar","campo":"enviados","nome":"enviados"},{"funcao":"somar","campo":"entregues","nome":"entregues"},{"funcao":"somar","campo":"nao_entregues","nome":"nao_entregues"},{"funcao":"somar","campo":"sem_retorno","nome":"sem_retorno"},{"funcao":"somar","campo":"fallback","nome":"fallback"}]', 'data asc'),
  (null, 'Saúde do e-mail', 'Disparados, entregues, bounces, aberturas, cliques, descadastros e spam por dia.', 'Entrega', 'funil',
   null, array['data'], '[{"funcao":"somar","campo":"disparados","nome":"disparados"},{"funcao":"somar","campo":"entregues","nome":"entregues"},{"funcao":"somar","campo":"bounce_permanente","nome":"bounce_permanente"},{"funcao":"somar","campo":"bounce_temporario","nome":"bounce_temporario"},{"funcao":"somar","campo":"aberturas","nome":"aberturas"},{"funcao":"somar","campo":"cliques","nome":"cliques"},{"funcao":"somar","campo":"descadastros","nome":"descadastros"},{"funcao":"somar","campo":"spam","nome":"spam"}]', 'data asc')
on conflict (empresa_id, nome) do update set descricao = excluded.descricao, categoria = excluded.categoria,
    base = excluded.base, colunas = excluded.colunas, agrupar = excluded.agrupar, metricas = excluded.metricas,
    ordem = excluded.ordem;
update public.relatorios_modelos set filtros = '{"campos":[{"campo":"canal","op":"igual","valor":"email"}]}'
 where empresa_id is null and nome = 'Saúde do e-mail';

-- ---------------------------------------------------------------- Assistente MotorCob: perguntas (90 dias)
create table if not exists public.assistente_perguntas (
    id           bigint generated always as identity primary key,
    usuario_id   uuid not null references auth.users (id) on delete cascade,
    empresa_id   bigint references public.empresas (id) on delete cascade,
    origem       text not null default 'busca' check (origem in ('busca', 'conversa')),
    tela         text check (tela is null or length(tela) <= 80),
    pergunta     text not null check (length(pergunta) between 1 and 500),
    resposta     text check (resposta is null or length(resposta) <= 4000),
    respondida   boolean not null default false,          -- false: a base não cobre (a equipe completa)
    acao         text check (acao is null or length(acao) <= 80),
    avaliacao    smallint check (avaliacao is null or avaliacao in (-1, 1)),
    criado_em    timestamptz not null default now()
);
comment on table public.assistente_perguntas is
    'Perguntas feitas ao Assistente MotorCob (sem dado de devedor: a função apaga CPF, telefone e e-mail antes). '
    'Grava só a Edge Function assistente; apagadas em 90 dias.';
create index if not exists assistente_perguntas_usuario on public.assistente_perguntas (usuario_id, criado_em desc);
create index if not exists assistente_perguntas_sem_resposta on public.assistente_perguntas (criado_em desc)
    where not respondida;
alter table public.assistente_perguntas enable row level security;
drop policy if exists assistente_ver on public.assistente_perguntas;
create policy assistente_ver on public.assistente_perguntas for select to authenticated
    using (usuario_id = auth.uid() or public.admin_equipe());
revoke all on public.assistente_perguntas from anon;
revoke insert, update, delete on public.assistente_perguntas from authenticated;

-- o usuário diz se a resposta ajudou (👍 1 / 👎 -1); só nas próprias perguntas
create or replace function public.avaliar_resposta(id_pergunta bigint, nota smallint) returns void
language plpgsql security definer set search_path = public as $$
begin
    if nota not in (-1, 1) then
        raise exception 'avaliação inválida';
    end if;
    update public.assistente_perguntas set avaliacao = nota
     where id = id_pergunta and usuario_id = auth.uid();
    if not found then
        raise exception 'pergunta não encontrada';
    end if;
end $$;
revoke execute on function public.avaliar_resposta(bigint, smallint) from public, anon;
grant execute on function public.avaliar_resposta(bigint, smallint) to authenticated;

-- Console (equipe): o que perguntam e não tem resposta, para melhorar a base de conhecimento
create or replace view public.assistente_sem_resposta with (security_invoker = true) as
select p.id, p.criado_em, p.empresa_id, e.nome as empresa, p.tela, p.pergunta, p.resposta, p.avaliacao
  from public.assistente_perguntas p
  left join public.empresas e on e.id = p.empresa_id
 where (not p.respondida or p.avaliacao = -1) and public.admin_equipe();
grant select on public.assistente_sem_resposta to authenticated;
revoke all on public.assistente_sem_resposta from anon;

-- ---------------------------------------------------------------- 90 dias (o motor chama uma vez por dia)
create or replace function public.limpar_mensageria_90d() returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int; k int; p int;
begin
    delete from public.mensageria_conversa_mensagens where apagar_em < now();
    get diagnostics n = row_count;
    delete from public.mensageria_conversas v where v.ultima_em < now() - interval '90 days'
       and not exists (select 1 from public.mensageria_conversa_mensagens x where x.conversa_id = v.id);
    get diagnostics m = row_count;
    delete from public.mensageria_links where apagar_em < now();
    get diagnostics k = row_count;
    delete from public.assistente_perguntas where criado_em < now() - interval '90 days';
    get diagnostics p = row_count;
    return n + m + k + p;
end $$;
revoke execute on function public.limpar_mensageria_90d() from public, anon, authenticated;
grant execute on function public.limpar_mensageria_90d() to service_role;
