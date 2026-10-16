-- SQL 39 · Relatórios e montador, revisão de UX (protótipo aprovado em 15/10/2026)
-- 1. Bases com nomes do dia a dia e por produto (Mensageria, Orquestração, Jornada). Novas bases da Orquestração:
--    Ações da régua, Carteira hoje, Movimento da carteira, Indicadores por safra e Evolução da carteira; Jornada do
--    MotorCli. Campos novos na Mensageria: campanha pelo nome, produto, faixa do Score, centro de custo, não
--    entregues e bounce. Nenhuma base tem telefone, e-mail, nome ou CPF.
-- 2. rodar_relatorio: separar por semana e mês, taxas (entregues ÷ enviadas…) e razões (custo ÷ CPCs) calculadas
--    sobre o grupo, total sem separar (para o rodapé e a comparação com o período anterior) e quem pode cada base.
-- 3. Foto da carteira: o motor guarda uma vez por dia os totais por situação, segmento, safra e etapa; ficam 90 dias
--    e, para sempre, a última foto de cada mês (fechamento).
-- 4. Relatórios salvos: "Toda a empresa" ou "Só para mim"; editam e apagam quem criou e o Admin.
-- 5. Exportação grande em segundo plano (acima de 50 mil linhas, até 1 milhão), com aviso no sino e link de 7 dias.
-- 6. Envio por e-mail agendado (dia, semana ou mês) só para usuários da empresa: os números do topo e um link.
-- 7. Os relatórios prontos viram perguntas (os antigos saem; os salvos pelas empresas ficam como estão).
-- Depende dos SQL 33 (Score), 34 (avisos) e 35. Pode rodar de novo sem erro.

-- ================================================================ 1. bases e permissões
alter table public.relatorio_bases add column if not exists produto text not null default 'mensageria'
    check (produto in ('mensageria', 'orquestracao', 'jornada'));
alter table public.relatorio_bases add column if not exists visivel boolean not null default true;
alter table public.relatorio_bases add column if not exists foto_do_dia boolean not null default false;
comment on column public.relatorio_bases.foto_do_dia is 'Base sem histórico (só o dia de hoje): a tela não pede período.';

-- quem pode rodar a base: da empresa, com o módulo contratado; Respostas pede "enviar mensagens" (como a caixa);
-- a equipe MotorCob precisa do acesso à Mensageria nas bases da Mensageria
create or replace function public.pode_base(base text, empresa bigint) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b public.relatorio_bases;
begin
    select * into b from public.relatorio_bases x where x.base = pode_base.base;
    if b.base is null or empresa is null then
        return false;
    end if;
    -- o servidor (motor, funções) pode tudo; conferindo por uma pessoa (envio agendado), vale a regra da pessoa
    if public.chamada_do_servidor() and auth.uid() is null then
        return true;
    end if;
    if not empresa in (select public.minhas_empresas()) then
        return false;
    end if;
    if not public.modulo_ativo(empresa, b.produto) then
        return false;
    end if;
    if b.produto = 'mensageria' then
        if public.sou_equipe() and not public.pode_equipe('acessar_mensageria') then
            return false;
        end if;
        if b.base = 'respostas' and not (public.pode('enviar_mensagens') or public.sou_equipe()) then
            return false;
        end if;
    end if;
    return true;
end $$;
revoke all on function public.pode_base(text, bigint) from public, anon;
grant execute on function public.pode_base(text, bigint) to authenticated, service_role;

-- rótulos da régua e do Score (nada de código cru na tela)
create or replace function public.rotulo_fase(regua text) returns text
language sql immutable set search_path = public as $$
    select case coalesce(regua, '')
        when 'localizacao' then 'Localização'
        when 'giro' then 'Não CPC'
        when 'cpc' then 'CPC'
        when 'preventivo' then 'Acordo em dia'
        when 'quebra' then 'Acordo · parcela vencida'
        when '' then 'Sem fase'
        else initcap(replace(regua, '_', ' ')) end
$$;
create or replace function public.rotulo_faixa_score(faixa text) returns text
language sql immutable set search_path = public as $$
    select case faixa when 'alto' then 'Alto' when 'medio' then 'Médio' when 'baixo' then 'Baixo'
                      when 'sem' then 'Sem histórico' else 'Fora do Score' end
$$;
-- nome do segmento (cluster) da carteira; o total do playbook vira "Toda a carteira"
create or replace function public.nome_segmento(empresa bigint, credor bigint, codigo text) returns text
language sql stable security definer set search_path = public as $$
    select case when coalesce(codigo, '') = '' then 'Toda a carteira'
                else coalesce((select c.nome from public.clusters c
                                where c.empresa_id = empresa and c.codigo = nome_segmento.codigo
                                order by (c.credor_id is not distinct from credor) desc, c.id limit 1), codigo) end
$$;
-- estratégia ATUAL do segmento na carteira (a do segmento, a do cluster ou a da carteira)
create or replace function public.nome_estrategia(empresa bigint, credor bigint, codigo text) returns text
language sql stable security definer set search_path = public as $$
    select coalesce((select e.nome
                       from public.credores cr
                       left join public.clusters cl on cl.empresa_id = empresa and cl.codigo = nome_estrategia.codigo
                                                   and (cl.credor_id is null or cl.credor_id = credor)
                       left join public.segmentos_carteira sc on sc.empresa_id = empresa and sc.credor_id = credor
                                                             and sc.cluster_id = cl.id
                       join public.estrategias e on e.id = coalesce(sc.estrategia_id, cl.estrategia_id, cr.estrategia_id)
                      where cr.id = credor
                      order by (cl.credor_id is not distinct from credor) desc limit 1), 'Sem estratégia')
$$;
revoke all on function public.nome_estrategia(bigint, bigint, text) from public, anon;
grant execute on function public.nome_estrategia(bigint, bigint, text) to authenticated, service_role;
grant execute on function public.rotulo_fase(text), public.rotulo_faixa_score(text) to authenticated, service_role;
revoke all on function public.nome_segmento(bigint, bigint, text) from public, anon;
grant execute on function public.nome_segmento(bigint, bigint, text) to authenticated, service_role;

-- ---------------------------------------------------------------- Mensageria
drop view if exists public.rel_funil;
create view public.rel_funil with (security_invoker = true) as
select l.empresa_id, l.data, l.canal, l.campanha_id, coalesce(c.nome, 'Lista do dia') as origem,
       coalesce(c.produto, '') as produto, coalesce(k.nome, '') as centro,
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
  left join public.mensageria_centros_custo k on k.id = coalesce(l.centro_custo_id, c.centro_custo_id)
 group by l.empresa_id, l.data, l.canal, l.campanha_id, c.nome, c.produto, k.nome;

drop view if exists public.rel_mensagens;
create view public.rel_mensagens with (security_invoker = true) as
select m.empresa_id, l.data, l.canal, l.campanha_id, coalesce(c.nome, 'Lista do dia') as origem,
       coalesce(c.produto, '') as produto, coalesce(k.nome, '') as centro, m.id_cliente,
       m.destino_mascara as destino, m.operadora, m.item as tipo, m.situacao, m.motivo, m.fallback,
       (m.respondida_em is not null) as respondeu, m.enviado_em, m.tentativas,
       public.rotulo_faixa_score(m.score_faixa) as faixa_score, m.bounce,
       (m.situacao in ('enviada', 'entregue', 'falhou'))::int as enviada,
       (m.situacao = 'entregue')::int as entregue,
       (m.situacao = 'falhou')::int as nao_entregue
  from public.mensageria_mensagens m
  join public.mensageria_lotes l on l.id = m.lote_id
  left join public.mensageria_campanhas c on c.id = l.campanha_id
  left join public.mensageria_centros_custo k on k.id = coalesce(l.centro_custo_id, c.centro_custo_id);

-- ---------------------------------------------------------------- Orquestração e Jornada
drop view if exists public.rel_acoes_regua;
create view public.rel_acoes_regua with (security_invoker = true) as
select a.empresa_id, a.data, a.credor_id, coalesce(cr.nome, '') as carteira, a.canal,
       public.rotulo_fase(a.regua) as fase, public.nome_segmento(a.empresa_id, a.credor_id, a.cluster) as segmento,
       public.nome_estrategia(a.empresa_id, a.credor_id, a.cluster) as estrategia,
       coalesce(nullif(a.persona, ''), 'Sem persona') as persona,
       a.enviadas as acionamentos, a.reservas, a.com_retorno, a.retornos, a.cpcs, a.custo, a.primeiros_cpc,
       a.acoes_ate_primeiro_cpc
  from public.acoes_dia a
  left join public.credores cr on cr.id = a.credor_id;

drop view if exists public.rel_carteira_hoje;
create view public.rel_carteira_hoje with (security_invoker = true) as
select m.empresa_id, (now() at time zone 'America/Sao_Paulo')::date as data, m.credor_id,
       coalesce(cr.nome, '') as carteira, public.rotulo_estado(m.estado) as situacao,
       public.rotulo_ciclo(m.estado, m.etapa) as etapa, coalesce(m.canal, '') as canal,
       public.nome_segmento(m.empresa_id, m.credor_id, m.cluster) as segmento, coalesce(m.safra, '') as safra,
       public.nome_estrategia(m.empresa_id, m.credor_id, m.cluster) as estrategia,
       m.clientes, m.saldo
  from public.mapa_esteira m
  left join public.credores cr on cr.id = m.credor_id;

create or replace view public.rel_movimento with (security_invoker = true) as
select f.empresa_id, f.data, f.credor_id, coalesce(cr.nome, '') as carteira,
       coalesce(public.rotulo_estado(f.de), 'Entrada na carteira') as de, public.rotulo_estado(f.para) as para,
       f.clientes
  from public.fluxo_esteira f
  left join public.credores cr on cr.id = f.credor_id;

create or replace view public.rel_indicadores with (security_invoker = true) as
select k.empresa_id, k.fim as data, k.inicio, k.credor_id, coalesce(cr.nome, '') as carteira,
       case when k.safra = 'TOTAL' then 'Todas' else k.safra end as safra,
       public.nome_segmento(k.empresa_id, k.credor_id, k.cluster) as segmento,
       (k.dados ->> 'clientes')::numeric as clientes,
       (k.dados ->> 'pct_localizados')::numeric as pct_localizados,
       (k.dados ->> 'custo_por_cpc_descoberto')::numeric as custo_por_cpc_descoberto,
       (k.dados ->> 'tentativas_ate_contato')::numeric as tentativas_ate_contato,
       (k.dados ->> 'acordos')::numeric as acordos,
       (k.dados ->> 'pct_acordo_sobre_cpc_voz')::numeric as pct_acordo_sobre_cpc_voz,
       (k.dados ->> 'pct_acordo_sobre_retorno_digital')::numeric as pct_acordo_sobre_retorno_digital,
       (k.dados ->> 'custo_por_acordo')::numeric as custo_por_acordo,
       (k.dados ->> 'pct_parcelas_em_dia')::numeric as pct_parcelas_em_dia,
       (k.dados ->> 'pct_acordos_quitados')::numeric as pct_acordos_quitados,
       (k.dados ->> 'quebras')::numeric as quebras,
       (k.dados ->> 'pct_regularizacao_ate_d5')::numeric as pct_regularizacao_ate_d5,
       (k.dados ->> 'pct_retorna_estoque')::numeric as pct_retorna_estoque
  from public.kpis k
  left join public.credores cr on cr.id = k.credor_id;

create or replace view public.rel_jornada with (security_invoker = true) as
select j.empresa_id, j.data, j.credor_id, coalesce(cr.nome, '') as carteira, coalesce(j.momento, '') as momento,
       coalesce(j.motivo, '') as motivo, j.clientes
  from public.jornada_resumo j
  left join public.credores cr on cr.id = j.credor_id;

-- ---------------------------------------------------------------- foto diária da carteira
create table if not exists public.carteira_fotos (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    data        date not null,
    credor_id   bigint not null,
    estado      text not null,
    etapa       text not null default '',
    segmento    text not null default '',
    safra       text not null default '',
    clientes    int not null check (clientes >= 0),
    saldo       numeric(16, 2) not null default 0,
    primary key (empresa_id, data, credor_id, estado, etapa, segmento, safra)
);
comment on table public.carteira_fotos is
    'Totais da carteira por dia (sem cliente um a um). Ficam 90 dias; a última foto de cada mês fica para sempre.';
alter table public.carteira_fotos enable row level security;
drop policy if exists carteira_fotos_ver on public.carteira_fotos;
create policy carteira_fotos_ver on public.carteira_fotos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.carteira_fotos from anon;
revoke insert, update, delete on public.carteira_fotos from authenticated;
grant select on public.carteira_fotos to authenticated;
grant all on public.carteira_fotos to service_role;

-- motor, uma vez por dia depois da rotina: tira a foto de hoje (refaz se rodar de novo) e limpa as antigas
create or replace function public.tirar_foto_carteira() returns int
language plpgsql security definer set search_path = public as $$
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    n int;
begin
    delete from public.carteira_fotos where data = hoje;
    insert into public.carteira_fotos (empresa_id, data, credor_id, estado, etapa, segmento, safra, clientes, saldo)
    select m.empresa_id, hoje, m.credor_id, m.estado, coalesce(m.etapa, ''), coalesce(m.cluster, ''),
           coalesce(m.safra, ''), sum(m.clientes)::int, sum(m.saldo)
      from public.mapa_esteira m
     group by m.empresa_id, m.credor_id, m.estado, coalesce(m.etapa, ''), coalesce(m.cluster, ''), coalesce(m.safra, '');
    get diagnostics n = row_count;
    -- mais de 90 dias: fica só a última foto de cada mês
    delete from public.carteira_fotos f
     where f.data < hoje - 90
       and f.data <> (select max(x.data) from public.carteira_fotos x
                       where x.empresa_id = f.empresa_id and date_trunc('month', x.data) = date_trunc('month', f.data));
    return n;
end $$;
revoke all on function public.tirar_foto_carteira() from public, anon, authenticated;
grant execute on function public.tirar_foto_carteira() to service_role;

create or replace view public.rel_evolucao with (security_invoker = true) as
select f.empresa_id, f.data, f.credor_id, coalesce(cr.nome, '') as carteira, public.rotulo_estado(f.estado) as situacao,
       public.rotulo_ciclo(f.estado, f.etapa) as etapa, public.nome_segmento(f.empresa_id, f.credor_id, f.segmento) as segmento,
       f.safra, f.clientes, f.saldo,
       (f.data = max(f.data) over (partition by f.empresa_id, date_trunc('month', f.data))) as fechamento
  from public.carteira_fotos f
  left join public.credores cr on cr.id = f.credor_id;

grant select on public.rel_funil, public.rel_mensagens, public.rel_acoes_regua, public.rel_carteira_hoje,
    public.rel_movimento, public.rel_indicadores, public.rel_jornada, public.rel_evolucao to authenticated, service_role;
revoke all on public.rel_funil, public.rel_mensagens, public.rel_acoes_regua, public.rel_carteira_hoje,
    public.rel_movimento, public.rel_indicadores, public.rel_jornada, public.rel_evolucao from anon;
grant select on public.rel_envios, public.rel_respostas, public.rel_cliques, public.rel_descadastros,
    public.rel_consumo_centro to service_role;

-- ---------------------------------------------------------------- catálogo
insert into public.relatorio_bases (base, visao, nome, descricao, ordem, produto, visivel, foto_do_dia) values
  ('funil',        'rel_funil',          'Envios do dia',          'Totais por dia, canal e campanha: carregadas, enviadas, entregues, não entregues, respostas e, no e-mail, bounces e aberturas.', 1, 'mensageria', true, false),
  ('mensagens',    'rel_mensagens',      'Cada mensagem',          'Uma linha por mensagem: situação, motivo, operadora, faixa do Score.', 2, 'mensageria', true, false),
  ('respostas',    'rel_respostas',      'Respostas',              'Conversas com a classificação do Radar.', 3, 'mensageria', true, false),
  ('cliques',      'rel_cliques',        'Cliques',                'Cada clique de pessoa (sem robôs) nos links rastreados.', 4, 'mensageria', true, false),
  ('descadastros', 'rel_descadastros',   'Descadastros',           'Quem pediu para não receber mais, por canal e origem.', 5, 'mensageria', true, false),
  ('consumo',      'rel_consumo_centro', 'Consumo',                'Quantidade por item, mês e centro de custo.', 6, 'mensageria', true, false),
  ('envios',       'rel_envios',         'Envios (antigo)',        'Substituída por Envios do dia; fica para os relatórios já salvos.', 99, 'mensageria', false, false),
  ('acoes_regua',  'rel_acoes_regua',    'Ações da régua',         'Acionamentos, retornos, CPCs e custo por dia, canal, fase, segmento e persona.', 11, 'orquestracao', true, false),
  ('carteira_hoje','rel_carteira_hoje',  'Carteira hoje',          'Clientes e saldo por situação, segmento, safra e etapa, como estão hoje.', 12, 'orquestracao', true, true),
  ('movimento',    'rel_movimento',      'Movimento da carteira',  'Clientes que mudaram de situação, de onde para onde, por dia.', 13, 'orquestracao', true, false),
  ('indicadores',  'rel_indicadores',    'Indicadores por safra',  'Os indicadores do playbook por safra e segmento: localização, CPC, acordos e pagamento.', 14, 'orquestracao', true, false),
  ('evolucao',     'rel_evolucao',       'Evolução da carteira',   'A foto diária da carteira: 90 dias dia a dia e o fechamento de cada mês.', 15, 'orquestracao', true, false),
  ('jornada',      'rel_jornada',        'Jornada',                'Clientes por momento e motivo da jornada, dia a dia.', 21, 'jornada', true, false)
on conflict (base) do update set visao = excluded.visao, nome = excluded.nome, descricao = excluded.descricao,
    ordem = excluded.ordem, produto = excluded.produto, visivel = excluded.visivel, foto_do_dia = excluded.foto_do_dia;

alter table public.relatorio_campos drop constraint if exists relatorio_campos_campo_check;
alter table public.relatorio_campos add constraint relatorio_campos_campo_check check (campo ~ '^[a-z][a-z0-9_]*$');
update public.relatorio_campos set rotulo = 'Campanha', agrupavel = true, filtravel = true
 where campo = 'origem';
update public.relatorio_campos set agrupavel = false, filtravel = false where campo = 'campanha_id';
insert into public.relatorio_campos (base, campo, rotulo, tipo, agrupavel, filtravel, ordem) values
  ('funil', 'produto', 'Produto', 'texto', true, true, 5), ('funil', 'centro', 'Centro de custo', 'texto', true, true, 6),
  ('mensagens', 'produto', 'Produto', 'texto', true, true, 15), ('mensagens', 'centro', 'Centro de custo', 'texto', true, true, 16),
  ('mensagens', 'faixa_score', 'Faixa do Score', 'texto', true, true, 17), ('mensagens', 'bounce', 'Bounce (e-mail)', 'texto', true, true, 18),
  ('mensagens', 'enviada', 'Enviadas', 'numero', false, false, 19), ('mensagens', 'entregue', 'Entregues', 'numero', false, false, 20),
  ('mensagens', 'nao_entregue', 'Não entregues', 'numero', false, false, 21),
  ('acoes_regua', 'data', 'Data', 'data', true, true, 1), ('acoes_regua', 'carteira', 'Carteira', 'texto', true, true, 2),
  ('acoes_regua', 'canal', 'Canal', 'texto', true, true, 3), ('acoes_regua', 'fase', 'Fase da régua', 'texto', true, true, 4),
  ('acoes_regua', 'segmento', 'Segmento', 'texto', true, true, 5), ('acoes_regua', 'estrategia', 'Estratégia', 'texto', true, true, 15), ('acoes_regua', 'persona', 'Persona', 'texto', true, true, 6),
  ('acoes_regua', 'acionamentos', 'Acionamentos', 'numero', false, false, 7), ('acoes_regua', 'reservas', 'Reservas', 'numero', false, false, 8),
  ('acoes_regua', 'com_retorno', 'Clientes com retorno', 'numero', false, false, 9), ('acoes_regua', 'retornos', 'Retornos', 'numero', false, false, 10),
  ('acoes_regua', 'cpcs', 'CPCs', 'numero', false, false, 11), ('acoes_regua', 'custo', 'Custo (R$)', 'numero', false, false, 12),
  ('acoes_regua', 'primeiros_cpc', 'Primeiros CPCs', 'numero', false, false, 13),
  ('acoes_regua', 'acoes_ate_primeiro_cpc', 'Ações até o 1º CPC (soma)', 'numero', false, false, 14),
  ('carteira_hoje', 'carteira', 'Carteira', 'texto', true, true, 1), ('carteira_hoje', 'situacao', 'Situação', 'texto', true, true, 2),
  ('carteira_hoje', 'etapa', 'Etapa', 'texto', true, true, 3), ('carteira_hoje', 'canal', 'Canal', 'texto', true, true, 4),
  ('carteira_hoje', 'segmento', 'Segmento', 'texto', true, true, 5), ('carteira_hoje', 'estrategia', 'Estratégia', 'texto', true, true, 9), ('carteira_hoje', 'safra', 'Safra', 'texto', true, true, 6),
  ('carteira_hoje', 'clientes', 'Clientes', 'numero', false, true, 7), ('carteira_hoje', 'saldo', 'Saldo (R$)', 'numero', false, true, 8),
  ('movimento', 'data', 'Data', 'data', true, true, 1), ('movimento', 'carteira', 'Carteira', 'texto', true, true, 2),
  ('movimento', 'de', 'De', 'texto', true, true, 3), ('movimento', 'para', 'Para', 'texto', true, true, 4),
  ('movimento', 'clientes', 'Clientes', 'numero', false, true, 5),
  ('indicadores', 'data', 'Fim do período', 'data', true, true, 1), ('indicadores', 'carteira', 'Carteira', 'texto', true, true, 2),
  ('indicadores', 'safra', 'Safra', 'texto', true, true, 3), ('indicadores', 'segmento', 'Segmento', 'texto', true, true, 4),
  ('indicadores', 'clientes', 'Clientes', 'numero', false, false, 5), ('indicadores', 'pct_localizados', '% localizados', 'numero', false, false, 6),
  ('indicadores', 'custo_por_cpc_descoberto', 'Custo por CPC descoberto (R$)', 'numero', false, false, 7),
  ('indicadores', 'tentativas_ate_contato', 'Tentativas até o contato', 'numero', false, false, 8),
  ('indicadores', 'acordos', 'Acordos', 'numero', false, false, 9),
  ('indicadores', 'pct_acordo_sobre_cpc_voz', '% acordo sobre CPC (voz)', 'numero', false, false, 10),
  ('indicadores', 'pct_acordo_sobre_retorno_digital', '% acordo sobre retorno (digital)', 'numero', false, false, 11),
  ('indicadores', 'custo_por_acordo', 'Custo por acordo (R$)', 'numero', false, false, 12),
  ('indicadores', 'pct_parcelas_em_dia', '% parcelas pagas em dia', 'numero', false, false, 13),
  ('indicadores', 'pct_acordos_quitados', '% acordos quitados', 'numero', false, false, 14),
  ('indicadores', 'quebras', 'Quebras', 'numero', false, false, 15),
  ('indicadores', 'pct_regularizacao_ate_d5', '% regularizados até 5 dias', 'numero', false, false, 16),
  ('indicadores', 'pct_retorna_estoque', '% que volta ao estoque', 'numero', false, false, 17),
  ('evolucao', 'data', 'Data', 'data', true, true, 1), ('evolucao', 'carteira', 'Carteira', 'texto', true, true, 2),
  ('evolucao', 'situacao', 'Situação', 'texto', true, true, 3), ('evolucao', 'etapa', 'Etapa', 'texto', true, true, 4),
  ('evolucao', 'segmento', 'Segmento', 'texto', true, true, 5), ('evolucao', 'safra', 'Safra', 'texto', true, true, 6),
  ('evolucao', 'fechamento', 'Fechamento do mês', 'booleano', true, true, 7),
  ('evolucao', 'clientes', 'Clientes', 'numero', false, true, 8), ('evolucao', 'saldo', 'Saldo (R$)', 'numero', false, true, 9),
  ('jornada', 'data', 'Data', 'data', true, true, 1), ('jornada', 'carteira', 'Carteira', 'texto', true, true, 2),
  ('jornada', 'momento', 'Momento', 'texto', true, true, 3), ('jornada', 'motivo', 'Motivo', 'texto', true, true, 4),
  ('jornada', 'clientes', 'Clientes', 'numero', false, false, 5)
on conflict (base, campo) do update set rotulo = excluded.rotulo, tipo = excluded.tipo, agrupavel = excluded.agrupavel,
                                        filtravel = excluded.filtravel, ordem = excluded.ordem;

-- ================================================================ 2. montador
-- metricas: [{"funcao": "contar|contar_distintos|somar|media|minimo|maximo", "campo": "...", "nome": "enviados",
--             "rotulo": "Enviadas", "sentido": "maior_melhor|menor_melhor"},
--            {"funcao": "taxa", "num": "entregues", "den": "enviados", ...}   → % com 1 casa (soma ÷ soma × 100)
--            {"funcao": "razao", "num": "custo", "den": "cpcs", ...}]        → soma ÷ soma com 2 casas
-- agrupar aceita também "semana" e "mes" (a partir da data). Com métricas e sem agrupar: uma linha com o total.
-- desempate: ordena também por todas as colunas (a exportação lê em páginas e não pode repetir nem pular linha)
create or replace function public.montar_sql_relatorio(base text, colunas text[], filtros jsonb, agrupar text[],
                                                       metricas jsonb, ordem text, desempate boolean default false)
returns text
language plpgsql stable security invoker set search_path = public as $$
declare
    b public.relatorio_bases;
    campos text[];
    numericos text[];
    filtraveis text[];
    sel text[] := '{}';
    onde text[] := '{}';
    nomes text[] := '{}';
    f jsonb;
    m jsonb;
    c text;
    op text;
    fn text;
    expr text;
    nome text;
    n int := 0;
    k int := 0;
    agregado boolean;
    sqltxt text;
begin
    select * into b from public.relatorio_bases x where x.base = montar_sql_relatorio.base;
    if b.base is null then
        raise exception 'base de relatório desconhecida: %', montar_sql_relatorio.base;
    end if;
    select array_agg(x.campo), array_agg(x.campo) filter (where x.tipo = 'numero'),
           array_agg(x.campo) filter (where x.filtravel)
      into campos, numericos, filtraveis
      from public.relatorio_campos x where x.base = b.base;
    if (filtros ->> 'empresa') is null then
        raise exception 'escolha a empresa';
    end if;
    onde := onde || format('empresa_id = %s', (filtros ->> 'empresa')::bigint);
    if not b.foto_do_dia then
        if filtros ? 'de' then onde := onde || format('data >= %L::date', filtros ->> 'de'); end if;
        if filtros ? 'ate' then onde := onde || format('data <= %L::date', filtros ->> 'ate'); end if;
    end if;
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

    agregado := coalesce(array_length(agrupar, 1), 0) > 0
                or (metricas is not null and jsonb_typeof(metricas) = 'array' and jsonb_array_length(metricas) > 0);
    if agregado then
        foreach c in array coalesce(agrupar, '{}') loop
            k := k + 1;
            if c in ('semana', 'mes') and 'data' = any (campos) then
                sel := sel || format('date_trunc(%L, data)::date as %I', case c when 'semana' then 'week' else 'month' end, c);
            elsif exists (select 1 from public.relatorio_campos x where x.base = b.base and x.campo = c and x.agrupavel) then
                sel := sel || format('%I', c);
            else
                raise exception 'não dá para separar por %', c;
            end if;
            nomes := nomes || c;
        end loop;
        if metricas is null or jsonb_typeof(metricas) <> 'array' or jsonb_array_length(metricas) = 0 then
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
                expr := format('%s(%I)', case fn when 'somar' then 'sum' when 'media' then 'round(avg' when 'minimo' then 'min'
                                             else 'max' end, c) || case when fn = 'media' then ', 2)' else '' end;
            elsif fn in ('taxa', 'razao') and (m ->> 'num') = any (numericos) and (m ->> 'den') = any (numericos) then
                expr := case fn
                    when 'taxa' then format('round(100.0 * sum(%I) / nullif(sum(%I), 0), 1)', m ->> 'num', m ->> 'den')
                    else format('round(sum(%I)::numeric / nullif(sum(%I), 0), 2)', m ->> 'num', m ->> 'den') end;
            else
                raise exception 'métrica inválida: % de %', fn, coalesce(c, m ->> 'num', '—');
            end if;
            nome := left(coalesce(nullif(m ->> 'nome', ''), fn || '_' || n), 60);
            sel := sel || format('%s as %I', expr, nome);
            nomes := nomes || nome;
        end loop;
        sqltxt := format('select %s from %I where %s', array_to_string(sel, ', '), b.visao, array_to_string(onde, ' and '));
        if k > 0 then
            sqltxt := sqltxt || ' group by ' || (select string_agg(g::text, ', ') from generate_series(1, k) g);
        end if;
    else
        if coalesce(array_length(colunas, 1), 0) = 0 then
            colunas := campos;
        end if;
        foreach c in array colunas loop
            if not c = any (campos) then
                raise exception 'coluna desconhecida: %', c;
            end if;
            sel := sel || format('%I', c);
            nomes := nomes || c;
        end loop;
        sqltxt := format('select %s from %I where %s', array_to_string(sel, ', '), b.visao, array_to_string(onde, ' and '));
    end if;
    if ordem is not null then
        if ordem !~ '^[a-z_0-9]+( desc| asc)?$' or not split_part(ordem, ' ', 1) = any (nomes) then
            raise exception 'ordem inválida';
        end if;
        sqltxt := sqltxt || format(' order by %I %s nulls last', split_part(ordem, ' ', 1),
                                   coalesce(nullif(split_part(ordem, ' ', 2), ''), 'asc'));
    end if;
    if desempate then
        sqltxt := sqltxt || case when ordem is null then ' order by ' else ', ' end
                  || (select string_agg(g::text, ', ') from generate_series(1, cardinality(nomes)) g);
    end if;
    return sqltxt;
end $$;
revoke all on function public.montar_sql_relatorio(text, text[], jsonb, text[], jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.montar_sql_relatorio(text, text[], jsonb, text[], jsonb, text, boolean) to authenticated, service_role;

-- a tela: até 50 mil linhas (o servidor, na exportação, até 1 milhão)
create or replace function public.rodar_relatorio(base text, colunas text[] default null, filtros jsonb default '{}',
                                                  agrupar text[] default null, metricas jsonb default null,
                                                  ordem text default null, limite int default 1000)
returns setof jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
    lim int := least(greatest(coalesce(limite, 1000), 1), case when public.chamada_do_servidor() then 1000000 else 50000 end);
begin
    perform set_config('statement_timeout', case when public.chamada_do_servidor() then '120000' else '20000' end, true);
    if not public.pode_base(rodar_relatorio.base, (filtros ->> 'empresa')::bigint) then
        raise exception 'sem permissão para este relatório (ou o produto não está contratado)';
    end if;
    return query execute format('select to_jsonb(t) from (%s limit %s) t',
        public.montar_sql_relatorio(rodar_relatorio.base, colunas, filtros, agrupar, metricas, ordem), lim);
end $$;
revoke execute on function public.rodar_relatorio(text, text[], jsonb, text[], jsonb, text, int) from public, anon;
grant execute on function public.rodar_relatorio(text, text[], jsonb, text[], jsonb, text, int) to authenticated, service_role;

create or replace function public.contar_relatorio(base text, colunas text[] default null, filtros jsonb default '{}',
                                                   agrupar text[] default null, metricas jsonb default null)
returns bigint
language plpgsql stable security invoker set search_path = public as $$
declare n bigint;
begin
    perform set_config('statement_timeout', '30000', true);
    if not public.pode_base(contar_relatorio.base, (filtros ->> 'empresa')::bigint) then
        raise exception 'sem permissão para este relatório (ou o produto não está contratado)';
    end if;
    execute format('select count(*) from (%s) t',
        public.montar_sql_relatorio(contar_relatorio.base, colunas, filtros, agrupar, metricas, null)) into n;
    return n;
end $$;
revoke execute on function public.contar_relatorio(text, text[], jsonb, text[], jsonb) from public, anon;
grant execute on function public.contar_relatorio(text, text[], jsonb, text[], jsonb) to authenticated, service_role;

-- exportação: uma página por vez (só o servidor)
create or replace function public.rodar_relatorio_pagina(base text, colunas text[], filtros jsonb, agrupar text[],
                                                         metricas jsonb, ordem text, inicio int, qtd int)
returns setof jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
    perform set_config('statement_timeout', '120000', true);
    return query execute format('select to_jsonb(t) from (%s offset %s limit %s) t',
        public.montar_sql_relatorio(rodar_relatorio_pagina.base, colunas, filtros, agrupar, metricas, ordem, true),
        greatest(coalesce(inicio, 0), 0), least(greatest(coalesce(qtd, 50000), 1), 50000));
end $$;
revoke all on function public.rodar_relatorio_pagina(text, text[], jsonb, text[], jsonb, text, int, int)
    from public, anon, authenticated;
grant execute on function public.rodar_relatorio_pagina(text, text[], jsonb, text[], jsonb, text, int, int) to service_role;

-- ================================================================ 3. relatórios salvos
alter table public.relatorios_modelos add column if not exists visibilidade text not null default 'empresa'
    check (visibilidade in ('empresa', 'pessoal'));
alter table public.relatorios_modelos add column if not exists destaque boolean not null default false;
alter table public.relatorios_modelos add column if not exists requer text check (requer is null or requer in ('score'));
alter table public.relatorios_modelos add column if not exists atualizado_em timestamptz not null default now();

drop policy if exists relatorios_modelos_ver on public.relatorios_modelos;
create policy relatorios_modelos_ver on public.relatorios_modelos for select to authenticated
    using (empresa_id is null
           or (empresa_id in (select public.minhas_empresas()) and (visibilidade = 'empresa' or criado_por = auth.uid())));
drop policy if exists relatorios_modelos_gravar on public.relatorios_modelos;
drop policy if exists relatorios_modelos_criar on public.relatorios_modelos;
create policy relatorios_modelos_criar on public.relatorios_modelos for insert to authenticated
    with check (empresa_id in (select public.minhas_empresas()) and criado_por = auth.uid());
drop policy if exists relatorios_modelos_editar on public.relatorios_modelos;
create policy relatorios_modelos_editar on public.relatorios_modelos for update to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (criado_por = auth.uid() or public.tem_papel('admin')))
    with check (empresa_id in (select public.minhas_empresas()));
drop policy if exists relatorios_modelos_apagar on public.relatorios_modelos;
create policy relatorios_modelos_apagar on public.relatorios_modelos for delete to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (criado_por = auth.uid() or public.tem_papel('admin')));

-- quem criou não muda; a data de alteração anda sozinha
create or replace function public.relatorio_modelo_guarda() returns trigger
language plpgsql set search_path = public as $$
begin
    new.criado_por := old.criado_por;
    new.empresa_id := old.empresa_id;
    new.atualizado_em := now();
    return new;
end $$;
drop trigger if exists relatorio_modelo_guarda on public.relatorios_modelos;
create trigger relatorio_modelo_guarda before update on public.relatorios_modelos
    for each row execute function public.relatorio_modelo_guarda();

-- ================================================================ 4. exportação grande
insert into storage.buckets (id, name, public) values ('relatorios', 'relatorios', false) on conflict (id) do nothing;

create table if not exists public.relatorio_exportacoes (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    pedido_por    uuid not null default auth.uid() references auth.users (id) on delete cascade,
    nome          text not null check (char_length(trim(nome)) between 2 and 120),
    base          text not null references public.relatorio_bases (base),
    colunas       text[],
    filtros       jsonb not null,
    agrupar       text[],
    metricas      jsonb,
    ordem         text,
    formato       text not null default 'xlsx' check (formato in ('xlsx', 'csv')),
    situacao      text not null default 'pendente' check (situacao in ('pendente', 'processando', 'pronta', 'erro', 'expirada')),
    linhas_total  bigint not null default 0,
    linhas_feitas bigint not null default 0,
    arquivo       text,
    link          text check (link is null or link ~ '^https://'),
    expira_em     timestamptz,
    iniciado_em   timestamptz,
    erro          text check (erro is null or char_length(erro) <= 300),
    criado_em     timestamptz not null default now(),
    concluido_em  timestamptz
);
create index if not exists relatorio_exportacoes_fila on public.relatorio_exportacoes (criado_em) where situacao in ('pendente', 'processando');
alter table public.relatorio_exportacoes enable row level security;
drop policy if exists relatorio_exportacoes_ver on public.relatorio_exportacoes;
create policy relatorio_exportacoes_ver on public.relatorio_exportacoes for select to authenticated
    using (pedido_por = auth.uid());
revoke all on public.relatorio_exportacoes from anon;
revoke insert, update, delete on public.relatorio_exportacoes from authenticated;
grant select on public.relatorio_exportacoes to authenticated;
grant all on public.relatorio_exportacoes to service_role;

-- a pessoa pede; o banco confere a permissão e o tamanho (até 1 milhão de linhas) e o motor prepara o arquivo
create or replace function public.pedir_exportacao(nome text, base text, colunas text[] default null,
    filtros jsonb default '{}', agrupar text[] default null, metricas jsonb default null, ordem text default null,
    formato text default 'xlsx')
returns table (id bigint, linhas bigint)
language plpgsql security invoker set search_path = public as $$
declare
    n bigint;
    novo bigint;
begin
    if auth.uid() is null then
        raise exception 'faça login';
    end if;
    if (select count(*) from public.relatorio_exportacoes x
         where x.pedido_por = auth.uid() and x.situacao in ('pendente', 'processando')) >= 3 then
        raise exception 'já há 3 arquivos sendo preparados: espere um terminar';
    end if;
    n := public.contar_relatorio(pedir_exportacao.base, colunas, filtros, agrupar, metricas);
    if n = 0 then
        raise exception 'nada no período: tente outro período ou tire um filtro';
    end if;
    if n > 1000000 then
        raise exception 'o relatório tem % linhas; o limite por arquivo é 1 milhão. Escolha um período menor ou um filtro',
            to_char(n, 'FM999G999G999');
    end if;
    perform public.montar_sql_relatorio(pedir_exportacao.base, colunas, filtros, agrupar, metricas, ordem);
    novo := public.registrar_exportacao(nome, pedir_exportacao.base, colunas, filtros, agrupar, metricas, ordem,
                                        coalesce(formato, 'xlsx'), n);
    return query select novo, n;
end $$;

create or replace function public.registrar_exportacao(nome text, base text, colunas text[], filtros jsonb,
    agrupar text[], metricas jsonb, ordem text, formato text, linhas bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
    if not public.pode_base(registrar_exportacao.base, (filtros ->> 'empresa')::bigint) then
        raise exception 'sem permissão para este relatório';
    end if;
    insert into public.relatorio_exportacoes (empresa_id, pedido_por, nome, base, colunas, filtros, agrupar, metricas,
                                              ordem, formato, linhas_total)
    values ((filtros ->> 'empresa')::bigint, auth.uid(), left(trim(nome), 120), registrar_exportacao.base, colunas,
            filtros, agrupar, metricas, ordem, formato, linhas)
    returning id into novo;
    return novo;
end $$;
revoke all on function public.registrar_exportacao(text, text, text[], jsonb, text[], jsonb, text, text, bigint)
    from public, anon, authenticated;
grant execute on function public.registrar_exportacao(text, text, text[], jsonb, text[], jsonb, text, text, bigint)
    to authenticated;
revoke all on function public.pedir_exportacao(text, text, text[], jsonb, text[], jsonb, text, text) from public, anon;
grant execute on function public.pedir_exportacao(text, text, text[], jsonb, text[], jsonb, text, text) to authenticated;

-- arquivos vencidos: o motor apaga do Storage e marca como expirados
create or replace function public.exportacoes_vencidas() returns table (id bigint, arquivo text)
language sql security definer set search_path = public as $$
    update public.relatorio_exportacoes x set situacao = 'expirada', link = null
     where x.situacao = 'pronta' and x.expira_em < now()
    returning x.id, x.arquivo
$$;
revoke all on function public.exportacoes_vencidas() from public, anon, authenticated;
grant execute on function public.exportacoes_vencidas() to service_role;

-- ================================================================ 5. envio por e-mail agendado
create table if not exists public.relatorio_envios (
    id              bigint generated always as identity primary key,
    modelo_id       bigint not null unique references public.relatorios_modelos (id) on delete cascade,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    frequencia      text not null check (frequencia in ('dia', 'semana', 'mes')),
    dia_semana      int not null default 1 check (dia_semana between 1 and 7),     -- 1 = segunda (ISO)
    dia_mes         int not null default 1 check (dia_mes between 1 and 28),
    hora            int not null default 8 check (hora between 0 and 23),
    destinatarios   uuid[] not null check (cardinality(destinatarios) between 1 and 20),
    ativo           boolean not null default true,
    proximo_em      timestamptz not null,
    ultimo_envio_em timestamptz,
    ultimo_erro     text check (ultimo_erro is null or char_length(ultimo_erro) <= 300),
    criado_por      uuid default auth.uid() references auth.users (id),
    criado_em       timestamptz not null default now()
);
comment on table public.relatorio_envios is
    'Envio por e-mail de um relatório salvo: números do topo e um link (sem anexo), só para usuários da empresa.';
alter table public.relatorio_envios enable row level security;
drop policy if exists relatorio_envios_ver on public.relatorio_envios;
create policy relatorio_envios_ver on public.relatorio_envios for select to authenticated
    using (empresa_id in (select public.minhas_empresas())
           and exists (select 1 from public.relatorios_modelos m where m.id = modelo_id));
revoke all on public.relatorio_envios from anon;
revoke insert, update, delete on public.relatorio_envios from authenticated;
grant select on public.relatorio_envios to authenticated;
grant all on public.relatorio_envios to service_role;

-- próximo envio depois de "depois", no horário de São Paulo
create or replace function public.proximo_envio_relatorio(frequencia text, dia_semana int, dia_mes int, hora int,
                                                          depois timestamptz default now())
returns timestamptz
language plpgsql stable set search_path = public as $$
declare
    local timestamp := depois at time zone 'America/Sao_Paulo';
    c timestamp := date_trunc('day', local) + make_interval(hours => hora);
begin
    if frequencia = 'dia' then
        if c <= local then c := c + interval '1 day'; end if;
    elsif frequencia = 'semana' then
        c := c + make_interval(days => ((dia_semana - extract(isodow from c)::int + 7) % 7));
        if c <= local then c := c + interval '7 days'; end if;
    else
        c := date_trunc('month', local) + make_interval(days => dia_mes - 1, hours => hora);
        if c <= local then c := c + interval '1 month'; end if;
    end if;
    return c at time zone 'America/Sao_Paulo';
end $$;
grant execute on function public.proximo_envio_relatorio(text, int, int, int, timestamptz) to authenticated, service_role;

-- período que o e-mail mostra e o anterior (para comparar): ontem; a semana passada (seg–dom); o mês passado
create or replace function public.periodo_envio_relatorio(frequencia text, quando timestamptz default now())
returns table (de date, ate date, ant_de date, ant_ate date)
language sql stable set search_path = public as $$
    with d as (select (quando at time zone 'America/Sao_Paulo')::date as hoje)
    select case frequencia when 'dia' then hoje - 1
                           when 'semana' then (date_trunc('week', hoje) - interval '7 days')::date
                           else (date_trunc('month', hoje) - interval '1 month')::date end,
           case frequencia when 'dia' then hoje - 1
                           when 'semana' then (date_trunc('week', hoje) - interval '1 day')::date
                           else (date_trunc('month', hoje) - interval '1 day')::date end,
           case frequencia when 'dia' then hoje - 2
                           when 'semana' then (date_trunc('week', hoje) - interval '14 days')::date
                           else (date_trunc('month', hoje) - interval '2 months')::date end,
           case frequencia when 'dia' then hoje - 2
                           when 'semana' then (date_trunc('week', hoje) - interval '8 days')::date
                           else (date_trunc('month', hoje) - interval '1 month' - interval '1 day')::date end
      from d
$$;
grant execute on function public.periodo_envio_relatorio(text, timestamptz) to authenticated, service_role;

-- agenda (ou muda) o envio de um relatório salvo; quem pode editar o relatório agenda
create or replace function public.salvar_envio_relatorio(modelo bigint, frequencia text, destinatarios uuid[],
    dia_semana int default 1, dia_mes int default 1, hora int default 8, ativo boolean default true)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
    m public.relatorios_modelos;
    ids uuid[] := array(select distinct x from unnest(coalesce(destinatarios, '{}')) x where x is not null);
    validos int;
    prox timestamptz;
begin
    select * into m from public.relatorios_modelos x where x.id = modelo;
    if m.id is null or m.empresa_id is null or not m.empresa_id in (select public.minhas_empresas())
       or not (m.visibilidade = 'empresa' or m.criado_por = auth.uid()) then
        raise exception 'salve o relatório antes de agendar o envio';
    end if;
    if not (m.criado_por = auth.uid() or public.tem_papel('admin')) then
        raise exception 'só quem criou o relatório e o Admin agendam o envio';
    end if;
    if frequencia not in ('dia', 'semana', 'mes') then
        raise exception 'frequência inválida: todo dia, toda semana ou todo mês';
    end if;
    if cardinality(ids) = 0 or cardinality(ids) > 20 then
        raise exception 'escolha de 1 a 20 pessoas';
    end if;
    select count(*) into validos from public.perfis p
     where p.id = any (ids) and p.ativo and not p.equipe and p.empresa_id = m.empresa_id;
    if validos <> cardinality(ids) then
        raise exception 'só usuários ativos da empresa recebem o relatório';
    end if;
    if m.visibilidade = 'pessoal' and ids <> array[m.criado_por] then
        raise exception 'relatório "Só para mim" só pode ser enviado para quem criou';
    end if;
    prox := public.proximo_envio_relatorio(frequencia, coalesce(dia_semana, 1), coalesce(dia_mes, 1), coalesce(hora, 8));
    insert into public.relatorio_envios (modelo_id, empresa_id, frequencia, dia_semana, dia_mes, hora, destinatarios,
                                         ativo, proximo_em, criado_por)
    values (m.id, m.empresa_id, frequencia, coalesce(dia_semana, 1), coalesce(dia_mes, 1), coalesce(hora, 8), ids,
            coalesce(ativo, true), prox, auth.uid())
    on conflict (modelo_id) do update set frequencia = excluded.frequencia, dia_semana = excluded.dia_semana,
        dia_mes = excluded.dia_mes, hora = excluded.hora, destinatarios = excluded.destinatarios,
        ativo = excluded.ativo, proximo_em = excluded.proximo_em, ultimo_erro = null;
    return prox;
end $$;

create or replace function public.apagar_envio_relatorio(modelo bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m public.relatorios_modelos;
begin
    select * into m from public.relatorios_modelos x where x.id = modelo;
    if m.id is null or not m.empresa_id in (select public.minhas_empresas())
       or not (m.criado_por = auth.uid() or public.tem_papel('admin')) then
        raise exception 'só quem criou o relatório e o Admin mudam o envio';
    end if;
    delete from public.relatorio_envios where modelo_id = m.id;
end $$;

-- motor, a cada 10 minutos: envios na hora (a função "relatorios" monta e manda cada um)
create or replace function public.envios_relatorio_devidos() returns setof bigint
language sql stable security definer set search_path = public as $$
    select e.id from public.relatorio_envios e
      join public.empresas x on x.id = e.empresa_id and x.situacao not in ('suspensa', 'encerrada', 'inadimplente')
     where e.ativo and e.proximo_em <= now()
     order by e.proximo_em limit 50
$$;

-- quem ainda pode receber: ativo, da empresa e com permissão para a base (conferido como a própria pessoa)
create or replace function public.destinatarios_relatorio(envio bigint) returns table (usuario uuid, email text)
language plpgsql security definer set search_path = public as $$
declare
    e public.relatorio_envios;
    m public.relatorios_modelos;
    u uuid;
    antes text := current_setting('request.jwt.claim.sub', true);
begin
    select * into e from public.relatorio_envios x where x.id = envio;
    select * into m from public.relatorios_modelos x where x.id = e.modelo_id;
    if e.id is null or m.id is null then
        return;
    end if;
    foreach u in array e.destinatarios loop
        perform set_config('request.jwt.claim.sub', u::text, true);
        if exists (select 1 from public.perfis p where p.id = u and p.ativo and not p.equipe and p.empresa_id = e.empresa_id)
           and (m.visibilidade = 'empresa' or m.criado_por = u)
           and public.pode_base(m.base, e.empresa_id) then
            return query select u, (select a.email::text from auth.users a where a.id = u);
        end if;
    end loop;
    perform set_config('request.jwt.claim.sub', coalesce(antes, ''), true);
end $$;

create or replace function public.marcar_envio_relatorio(envio bigint, erro text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare e public.relatorio_envios; prox timestamptz;
begin
    select * into e from public.relatorio_envios x where x.id = envio;
    if e.id is null then
        return null;
    end if;
    prox := public.proximo_envio_relatorio(e.frequencia, e.dia_semana, e.dia_mes, e.hora, greatest(now(), e.proximo_em));
    -- falhou (fora do ar, sem e-mail): tenta de novo de hora em hora por até 24 horas, depois espera o próximo
    if erro is not null and now() < e.proximo_em + interval '24 hours' then
        prox := least(prox, now() + interval '1 hour');
    end if;
    update public.relatorio_envios
       set proximo_em = prox, ultimo_erro = left(erro, 300),
           ultimo_envio_em = case when erro is null then now() else ultimo_envio_em end
     where id = envio;
    return prox;
end $$;

do $$
declare f text;
begin
    foreach f in array array['public.salvar_envio_relatorio(bigint, text, uuid[], int, int, int, boolean)',
                             'public.apagar_envio_relatorio(bigint)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
    foreach f in array array['public.envios_relatorio_devidos()', 'public.destinatarios_relatorio(bigint)',
                             'public.marcar_envio_relatorio(bigint, text)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;

-- ================================================================ 6. relatórios prontos, por pergunta
-- saem só os relatórios prontos antigos (os do SQL 40 em diante ficam, se este for rodado de novo)
delete from public.relatorios_modelos where empresa_id is null and nome in (
    'Entregabilidade por dia e canal', 'Desempenho por campanha', 'Entrega por operadora',
    'Motivos de não envio (higienização)', 'Respostas por classificação do Radar', 'Cliques por campanha e aparelho',
    'Cliques por hora do dia', 'Descadastros (opt-out)', 'Consumo por centro de custo', 'Mensagens enviadas (analítico)',
    'Saúde do e-mail');
insert into public.relatorios_modelos (empresa_id, nome, descricao, categoria, base, colunas, agrupar, metricas, filtros,
                                       ordem, destaque, requer) values
  (null, 'Quanto foi entregue, dia a dia?', 'Enviadas, entregues, não entregues e as taxas por dia e canal.', 'Entrega', 'funil', null,
   array['data', 'canal'],
   '[{"funcao":"somar","campo":"enviados","nome":"enviados","rotulo":"Enviadas"},{"funcao":"somar","campo":"entregues","nome":"entregues","rotulo":"Entregues"},{"funcao":"taxa","num":"entregues","den":"enviados","nome":"taxa_entrega","rotulo":"Taxa de entrega","sentido":"maior_melhor"},{"funcao":"somar","campo":"nao_entregues","nome":"nao_entregues","rotulo":"Não entregues","sentido":"menor_melhor"},{"funcao":"taxa","num":"nao_entregues","den":"enviados","nome":"taxa_nao_entrega","rotulo":"Taxa de não entrega","sentido":"menor_melhor"},{"funcao":"somar","campo":"respostas","nome":"respostas","rotulo":"Respostas"},{"funcao":"taxa","num":"respostas","den":"entregues","nome":"taxa_resposta","rotulo":"Taxa de resposta","sentido":"maior_melhor"}]',
   '{}', 'data asc', true, null),
  (null, 'Como foi cada campanha?', 'Lista carregada, enviadas, entregues, não entregues, respostas e descadastros por campanha.', 'Entrega', 'funil', null,
   array['origem', 'canal'],
   '[{"funcao":"somar","campo":"carregados","nome":"carregados","rotulo":"Lista carregada"},{"funcao":"somar","campo":"enviados","nome":"enviados","rotulo":"Enviadas"},{"funcao":"taxa","num":"entregues","den":"enviados","nome":"taxa_entrega","rotulo":"Taxa de entrega","sentido":"maior_melhor"},{"funcao":"somar","campo":"nao_entregues","nome":"nao_entregues","rotulo":"Não entregues","sentido":"menor_melhor"},{"funcao":"taxa","num":"respostas","den":"entregues","nome":"taxa_resposta","rotulo":"Taxa de resposta","sentido":"maior_melhor"},{"funcao":"taxa","num":"descadastros","den":"entregues","nome":"taxa_descadastro","rotulo":"Taxa de descadastro","sentido":"menor_melhor"}]',
   '{}', 'enviados desc', false, null),
  (null, 'Como cada operadora entregou?', 'Enviadas, entregues e não entregues de SMS por operadora.', 'Entrega', 'mensagens', null,
   array['operadora'],
   '[{"funcao":"somar","campo":"enviada","nome":"enviadas","rotulo":"Enviadas"},{"funcao":"somar","campo":"entregue","nome":"entregues","rotulo":"Entregues"},{"funcao":"taxa","num":"entregue","den":"enviada","nome":"taxa_entrega","rotulo":"Taxa de entrega","sentido":"maior_melhor"},{"funcao":"somar","campo":"nao_entregue","nome":"nao_entregues","rotulo":"Não entregues","sentido":"menor_melhor"},{"funcao":"taxa","num":"nao_entregue","den":"enviada","nome":"taxa_nao_entrega","rotulo":"Taxa de não entrega","sentido":"menor_melhor"}]',
   '{"campos":[{"campo":"canal","op":"igual","valor":"sms"}]}', 'enviadas desc', false, null),
  (null, 'Por que mensagens não saíram ou não foram entregues?', 'Bloqueio, número inválido, descadastro e o motivo da falha de entrega.', 'Entrega', 'mensagens', null,
   array['canal', 'situacao', 'motivo'], '[{"funcao":"contar","nome":"mensagens","rotulo":"Mensagens"}]',
   '{"campos":[{"campo":"situacao","op":"em","valor":["falhou","bloqueada","descadastro"]}]}', 'mensagens desc', false, null),
  (null, 'Quantos e-mails voltaram (bounce)?', 'Bounce permanente e temporário por dia e campanha, com as taxas, aberturas e spam.', 'Entrega', 'funil', null,
   array['data', 'origem'],
   '[{"funcao":"somar","campo":"enviados","nome":"enviados","rotulo":"E-mails enviados"},{"funcao":"somar","campo":"entregues","nome":"entregues","rotulo":"Entregues"},{"funcao":"somar","campo":"bounce_permanente","nome":"bounce_permanente","rotulo":"Bounce permanente","sentido":"menor_melhor"},{"funcao":"taxa","num":"bounce_permanente","den":"enviados","nome":"taxa_bounce_permanente","rotulo":"Taxa de bounce permanente","sentido":"menor_melhor"},{"funcao":"somar","campo":"bounce_temporario","nome":"bounce_temporario","rotulo":"Bounce temporário","sentido":"menor_melhor"},{"funcao":"taxa","num":"bounce_temporario","den":"enviados","nome":"taxa_bounce_temporario","rotulo":"Taxa de bounce temporário","sentido":"menor_melhor"},{"funcao":"taxa","num":"aberturas","den":"entregues","nome":"taxa_abertura","rotulo":"Taxa de abertura","sentido":"maior_melhor"},{"funcao":"somar","campo":"spam","nome":"spam","rotulo":"Marcados como spam","sentido":"menor_melhor"}]',
   '{"campos":[{"campo":"canal","op":"igual","valor":"email"}]}', 'data asc', false, null),
  (null, 'Quanto o Score evitou de envio?', 'Mensagens por faixa do Score e situação: enviadas, não enviadas e entregues.', 'Entrega', 'mensagens', null,
   array['faixa_score', 'situacao'], '[{"funcao":"contar","nome":"mensagens","rotulo":"Mensagens"}]',
   '{"campos":[{"campo":"canal","op":"igual","valor":"sms"}]}', 'mensagens desc', false, 'score'),
  (null, 'Quem respondeu e o que disse?', 'Conversas por classificação do Radar e canal.', 'Respostas e links', 'respostas', null,
   array['classe', 'canal'], '[{"funcao":"contar","nome":"conversas","rotulo":"Conversas"}]', '{}', 'conversas desc', false, null),
  (null, 'Quem clicou nos links?', 'Pessoas e cliques por campanha e aparelho (sem robôs).', 'Respostas e links', 'cliques', null,
   array['origem', 'dispositivo'],
   '[{"funcao":"contar_distintos","campo":"id_cliente","nome":"pessoas","rotulo":"Pessoas"},{"funcao":"contar","nome":"cliques","rotulo":"Cliques"}]',
   '{}', 'cliques desc', false, null),
  (null, 'Qual o melhor horário?', 'Cliques por hora do dia.', 'Respostas e links', 'cliques', null,
   array['hora'], '[{"funcao":"contar","nome":"cliques","rotulo":"Cliques"}]', '{}', 'hora asc', false, null),
  (null, 'Quem pediu para sair?', 'Descadastros por dia, canal e campanha, com a taxa sobre as entregues.', 'Respostas e links', 'funil', null,
   array['data', 'canal', 'origem'],
   '[{"funcao":"somar","campo":"entregues","nome":"entregues","rotulo":"Entregues"},{"funcao":"somar","campo":"descadastros","nome":"descadastros","rotulo":"Descadastros","sentido":"menor_melhor"},{"funcao":"taxa","num":"descadastros","den":"entregues","nome":"taxa_descadastro","rotulo":"Taxa de descadastro","sentido":"menor_melhor"}]',
   '{}', 'data asc', false, null),
  (null, 'Quanto cada centro de custo usou?', 'Quantidade por item e mês em cada centro de custo, com o orçamento.', 'Custo e conferência', 'consumo', null,
   array['data', 'centro', 'item'],
   '[{"funcao":"somar","campo":"quantidade","nome":"quantidade","rotulo":"Quantidade"},{"funcao":"maximo","campo":"orcamento_mensal","nome":"orcamento","rotulo":"Orçamento do mês"}]',
   '{}', 'data asc', false, null),
  (null, 'Lista de mensagens, uma a uma', 'Para conferência: ID do cliente, destino mascarado, situação e motivo.', 'Custo e conferência', 'mensagens',
   array['data', 'canal', 'origem', 'id_cliente', 'destino', 'operadora', 'tipo', 'situacao', 'motivo', 'fallback', 'respondeu', 'enviado_em'],
   null, null, '{}', 'enviado_em desc', false, null),
  (null, 'Quantos CPCs a régua gerou e quanto custou cada um?', 'Acionamentos, retornos, CPCs, taxa de CPC e custo por CPC por fase e canal.', 'Régua', 'acoes_regua', null,
   array['fase', 'canal'],
   '[{"funcao":"somar","campo":"acionamentos","nome":"acionamentos","rotulo":"Acionamentos"},{"funcao":"somar","campo":"com_retorno","nome":"com_retorno","rotulo":"Com retorno"},{"funcao":"taxa","num":"com_retorno","den":"acionamentos","nome":"taxa_retorno","rotulo":"Taxa de retorno","sentido":"maior_melhor"},{"funcao":"somar","campo":"cpcs","nome":"cpcs","rotulo":"CPCs"},{"funcao":"taxa","num":"cpcs","den":"acionamentos","nome":"taxa_cpc","rotulo":"Taxa de CPC","sentido":"maior_melhor"},{"funcao":"somar","campo":"custo","nome":"custo","rotulo":"Custo (R$)"},{"funcao":"razao","num":"custo","den":"cpcs","nome":"custo_por_cpc","rotulo":"Custo por CPC (R$)","sentido":"menor_melhor"}]',
   '{}', 'acionamentos desc', true, null),
  (null, 'Qual canal localiza mais cliente novo?', 'Primeiros CPCs por canal na localização e quantas ações até o primeiro contato.', 'Régua', 'acoes_regua', null,
   array['canal'],
   '[{"funcao":"somar","campo":"acionamentos","nome":"acionamentos","rotulo":"Acionamentos"},{"funcao":"somar","campo":"primeiros_cpc","nome":"primeiros_cpc","rotulo":"Primeiros CPCs"},{"funcao":"taxa","num":"primeiros_cpc","den":"acionamentos","nome":"taxa_localizacao","rotulo":"Taxa de localização","sentido":"maior_melhor"},{"funcao":"razao","num":"acoes_ate_primeiro_cpc","den":"primeiros_cpc","nome":"acoes_ate_1o_cpc","rotulo":"Ações até o 1º CPC","sentido":"menor_melhor"},{"funcao":"razao","num":"custo","den":"primeiros_cpc","nome":"custo_por_cpc","rotulo":"Custo por CPC descoberto (R$)","sentido":"menor_melhor"}]',
   '{"campos":[{"campo":"fase","op":"igual","valor":"Localização"}]}', 'primeiros_cpc desc', false, null),
  (null, 'Qual segmento e persona respondem melhor?', 'Taxa de retorno e de CPC por segmento da carteira e persona.', 'Régua', 'acoes_regua', null,
   array['segmento', 'persona'],
   '[{"funcao":"somar","campo":"acionamentos","nome":"acionamentos","rotulo":"Acionamentos"},{"funcao":"taxa","num":"com_retorno","den":"acionamentos","nome":"taxa_retorno","rotulo":"Taxa de retorno","sentido":"maior_melhor"},{"funcao":"taxa","num":"cpcs","den":"acionamentos","nome":"taxa_cpc","rotulo":"Taxa de CPC","sentido":"maior_melhor"}]',
   '{}', 'taxa_cpc desc', false, null),
  (null, 'Onde está a carteira hoje?', 'Clientes e saldo por situação e segmento, como estão hoje.', 'Carteira', 'carteira_hoje', null,
   array['situacao', 'segmento'],
   '[{"funcao":"somar","campo":"clientes","nome":"clientes","rotulo":"Clientes"},{"funcao":"somar","campo":"saldo","nome":"saldo","rotulo":"Saldo (R$)"}]',
   '{}', 'clientes desc', false, null),
  (null, 'Como a carteira se moveu?', 'Clientes que mudaram de situação, de onde para onde.', 'Carteira', 'movimento', null,
   array['de', 'para'], '[{"funcao":"somar","campo":"clientes","nome":"clientes","rotulo":"Clientes"}]', '{}', 'clientes desc', false, null),
  (null, 'Como a carteira evoluiu mês a mês?', 'O fechamento de cada mês: clientes e saldo por situação.', 'Carteira', 'evolucao', null,
   array['data', 'situacao'],
   '[{"funcao":"somar","campo":"clientes","nome":"clientes","rotulo":"Clientes"},{"funcao":"somar","campo":"saldo","nome":"saldo","rotulo":"Saldo (R$)"}]',
   '{"campos":[{"campo":"fechamento","op":"igual","valor":"true"}]}', 'data asc', false, null),
  (null, 'Os acordos estão sendo pagos?', 'Parcelas pagas em dia, quebras, regularização até 5 dias e acordos quitados, por safra.', 'Acordos e resultado', 'indicadores',
   array['data', 'carteira', 'safra', 'segmento', 'pct_parcelas_em_dia', 'quebras', 'pct_regularizacao_ate_d5', 'pct_acordos_quitados'],
   null, null, '{}', 'data desc', false, null),
  (null, 'Resultado por safra e segmento', 'Localização, custo por CPC, acordo sobre CPC e custo por acordo (os indicadores do playbook).', 'Acordos e resultado', 'indicadores',
   array['data', 'carteira', 'safra', 'segmento', 'clientes', 'pct_localizados', 'custo_por_cpc_descoberto', 'acordos', 'pct_acordo_sobre_cpc_voz', 'pct_acordo_sobre_retorno_digital', 'custo_por_acordo'],
   null, null, '{}', 'data desc', false, null),
  (null, 'Em que momento da jornada estão os clientes?', 'Clientes por momento da jornada, dia a dia.', 'Jornada', 'jornada', null,
   array['data', 'momento'], '[{"funcao":"somar","campo":"clientes","nome":"clientes","rotulo":"Clientes"}]', '{}', 'data asc', false, null)
on conflict (empresa_id, nome) do update set descricao = excluded.descricao, categoria = excluded.categoria,
    base = excluded.base, colunas = excluded.colunas, agrupar = excluded.agrupar, metricas = excluded.metricas,
    filtros = excluded.filtros, ordem = excluded.ordem, destaque = excluded.destaque, requer = excluded.requer;
