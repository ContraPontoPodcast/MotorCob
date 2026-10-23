-- SQL 45 · Links do Início que davam 404 (SQL 44 apontava para rotas que o site não tem)
-- * Cartão "Cobrança" (Suas áreas) e item "Lista do dia pronta" (Para hoje): /lista-do-dia → /fila.
-- * Carga com erro: /cargas/{id} → /envios.
-- * Envio pausado: /mensageria/lotes → /mensageria/{canal}/lotes.
-- Só troca os links das duas funções; nada mais muda. Pode rodar de novo sem erro.

create or replace function public.para_hoje(empresa bigint default null, lim int default 5)
returns table (tipo text, urgencia int, titulo text, detalhe text, acao text, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    e bigint := public.empresa_da_tela(empresa);
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    eu uuid := auth.uid();
begin
    if e is null or eu is null then
        return;
    end if;
    lim := least(greatest(coalesce(lim, 5), 1), 10);
    return query
    select * from (
        -- fatura vencida ou vencendo em até 3 dias (quem vê o faturamento; "Pagar" só para quem paga)
        (select 'fatura'::text,
                case when f.situacao = 'vencida' or f.vencimento < hoje then 10 else 20 end,
                left('Fatura de ' || (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro',
                                          'outubro','novembro','dezembro'])[extract(month from f.competencia)::int] ||
                     case when f.situacao = 'vencida' or f.vencimento < hoje then ' está vencida'
                          when f.vencimento = hoje then ' vence hoje'
                          when f.vencimento = hoje + 1 then ' vence amanhã'
                          else ' vence em ' || (f.vencimento - hoje) || ' dias' end, 140),
                'R$ ' || replace(replace(replace(to_char(f.valor_total, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.'),
                case when public.pode('pagar_faturas') then 'Pagar' else 'Ver' end,
                '/empresa/faturamento?fatura=' || f.id
           from public.faturas f
          where f.empresa_id = e and public.ve_faturamento(e)
            and f.situacao in ('aberta', 'vencida') and f.vencimento <= hoje + 3
          order by f.vencimento limit 2)
        union all
        -- chamado que a pessoa abriu e que espera por ela (ou tem resposta nova do Suporte)
        (select 'chamado',
                case when c.situacao = 'aguardando_cliente' then 15 else 30 end,
                left(case when c.situacao = 'aguardando_cliente'
                          then 'O Suporte espera sua resposta no chamado ' else 'O Suporte respondeu o chamado ' end
                     || coalesce(c.protocolo, '#' || c.id), 140),
                left(c.assunto, 120), 'Ver', '/suporte/' || c.id
           from public.chamados c
          where c.empresa_id = e and c.aberto_por = eu and c.situacao <> 'resolvido' and c.ultima_de = 'equipe'
            and (c.situacao = 'aguardando_cliente' or c.ultima_em > coalesce(c.visto_cliente_em, '-infinity'))
          order by c.ultima_em limit 2)
        union all
        -- carga com erro nas últimas 24 horas (quem envia cargas)
        (select 'carga', 25, 'Uma carga voltou com erro',
                left(coalesce(v.nome_original, 'Arquivo enviado') || ' · ' ||
                     to_char(v.enviado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 120),
                'Ver', '/envios'
           from public.envios v
          where v.empresa_id = e and v.status = 'erro' and v.enviado_em > now() - interval '24 hours'
            and public.pode('enviar_arquivos')
          order by v.enviado_em desc limit 1)
        union all
        -- envios pausados (Mensageria)
        (select 'pausa', 35,
                case when count(*) = 1 then 'Um envio está pausado' else count(*) || ' envios estão pausados' end,
                left(coalesce(min(l.motivo), 'Veja o motivo e retome quando puder.'), 120), 'Ver', '/mensageria/' || min(l.canal) || '/lotes'
           from public.mensageria_lotes l
          where l.empresa_id = e and l.situacao = 'pausado' and l.data >= hoje - 1
            and public.modulo_ativo(e, 'mensageria') and public.pode('enviar_mensagens')
         having count(*) > 0)
        union all
        -- respostas de clientes sem ninguém cuidando
        (select 'respostas', 40,
                case when count(*) = 1 then '1 resposta de cliente espera alguém'
                     else count(*) || ' respostas de clientes esperam alguém' end,
                'Na caixa de atendimento, sem responsável.', 'Abrir', '/mensageria/atendimento?filtro=sem_dono'
           from public.mensageria_conversas m
          where m.empresa_id = e and m.situacao = 'aberta' and m.responsavel is null and m.nao_lidas > 0
            and public.modulo_ativo(e, 'mensageria') and public.pode('enviar_mensagens')
         having count(*) > 0)
        union all
        -- token de API vencendo em até 15 dias (quem cuida dos tokens)
        (select 'token', case when t.expira_em < now() + interval '3 days' then 22 else 50 end,
                left('Token "' || t.nome || '" vence em ' ||
                     greatest(((t.expira_em at time zone 'America/Sao_Paulo')::date - hoje), 0) || ' dias', 140),
                'Troque antes para o sistema não parar.', 'Trocar', '/empresa/integracoes?token=' || t.id
           from public.api_tokens t
          where t.empresa_id = e and t.revogado_em is null and t.substituido_por is null
            and t.expira_em > now() and t.expira_em < now() + interval '15 days' and public.pode('gerenciar_api')
          order by t.expira_em limit 1)
        union all
        -- Lista do dia pronta (quem baixa listas)
        (select 'lista', 60,
                'Lista do dia pronta às ' || to_char(x.terminada_em at time zone 'America/Sao_Paulo', 'HH24:MI'),
                replace(to_char((select count(*) from public.fila_dia d where d.empresa_id = e and d.data = hoje),
                                'FM999G999G990'), ',', '.') || ' clientes',
                'Baixar', '/fila'
           from public.execucoes x
          where x.empresa_id = e and x.data_ref = hoje and x.status = 'ok' and public.pode('baixar_listas')
          order by x.terminada_em desc nulls last limit 1)
    ) itens (tipo, urgencia, titulo, detalhe, acao, link)
    order by urgencia, titulo
    limit lim;
end $$;
revoke all on function public.para_hoje(bigint, int) from public, anon;
grant execute on function public.para_hoje(bigint, int) to authenticated;

create or replace function public.numeros_areas(empresa bigint default null)
returns table (area text, contratada boolean, numero text, detalhe text, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
    e bigint := public.empresa_da_tela(empresa);
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    frentes text[] := array(select public.minhas_frentes());
    cob boolean; jor boolean; men boolean;
    dia date; qtd bigint; env bigint; ent bigint; canais text[];
begin
    if e is null then
        return;
    end if;
    cob := 'motorcob' = any (frentes) and public.modulo_ativo(e, 'orquestracao');
    jor := 'motorcli' = any (frentes) and public.modulo_ativo(e, 'jornada');
    men := public.modulo_ativo(e, 'mensageria');

    select max(d.data) into dia from public.fila_dia d where d.empresa_id = e and d.data between hoje - 1 and hoje;
    select count(*) into qtd from public.fila_dia d where d.empresa_id = e and d.data = dia;
    return query select 'cobranca'::text, cob,
        case when cob and dia is not null then replace(to_char(qtd, 'FM999G999G990'), ',', '.') end,
        case when not cob then null
             else concat_ws(' · ',
                     case when dia is null then 'Lista do dia ainda não saiu'
                          when dia = hoje then 'na Lista do dia' else 'na Lista do dia de ontem' end,
                     (select count(*) || case when count(*) = 1 then ' carteira' else ' carteiras' end
                        from public.credores c where c.empresa_id = e and c.ativo)) end,
        '/fila';

    select sum(l.enviadas), sum(l.entregues) into env, ent
      from public.mensageria_lotes l where l.empresa_id = e and l.data = hoje - 1;
    select m.canais into canais from public.empresa_modulos m where m.empresa_id = e and m.modulo = 'mensageria';
    return query select 'mensageria'::text, men,
        case when men and coalesce(env, 0) > 0
             then replace(to_char(round(100.0 * ent / env, 1), 'FM990D0'), '.', ',') || '%' end,
        case when not men then null
             else concat_ws(' · ', case when coalesce(env, 0) > 0 then 'entregues ontem' else 'Nenhum envio ontem' end,
                     (select string_agg(upper(c), ' e ' order by c) from unnest(canais) c)) end,
        '/mensageria';

    return query select 'jornada'::text, jor,
        case when jor then replace(to_char((select count(*) from public.jornada_cliente j where j.empresa_id = e),
                                           'FM999G999G990'), ',', '.') end,
        case when jor then 'clientes na jornada' end,
        '/jornada';
end $$;
revoke all on function public.numeros_areas(bigint) from public, anon;
grant execute on function public.numeros_areas(bigint) to authenticated;

-- Sugestões do Assistente na tela da Lista do dia: a rota do site é /fila.
update public.assistente_sugestoes s set tela = '/fila'
 where s.tela = '/lista-do-dia'
   and not exists (select 1 from public.assistente_sugestoes x where x.tela = '/fila' and x.pergunta = s.pergunta);
delete from public.assistente_sugestoes where tela = '/lista-do-dia';

-- Avisos de fatura (SQL 36, 38 e 42) apontavam para /console/faturas; a tela é /console/faturamento. O gatilho corrige
-- o link na gravação, sem reescrever as funções que criam esses avisos, e o update corrige os que já existem.
create or replace function public.corrigir_link_aviso() returns trigger language plpgsql set search_path = public as $$
begin
    if new.link = '/console/faturas' or new.link like '/console/faturas?%' then
        new.link := '/console/faturamento' || substr(new.link, 17);
    end if;
    return new;
end $$;
revoke all on function public.corrigir_link_aviso() from public, anon, authenticated;
drop trigger if exists avisos_corrigir_link on public.avisos;
create trigger avisos_corrigir_link before insert or update of link on public.avisos
    for each row execute function public.corrigir_link_aviso();
update public.avisos set link = link where link = '/console/faturas' or link like '/console/faturas?%';
