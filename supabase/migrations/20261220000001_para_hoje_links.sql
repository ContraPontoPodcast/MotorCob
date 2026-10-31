-- SQL 53 · Início › Para hoje: links que abrem o que o aviso promete (navegação, Onda 2)
-- Decisão aprovada pelo dono na proposta de UX da navegação (auditoria_navegacao/proposta_ux.md, Onda 2, CX-02):
-- 1. "Uma carga voltou com erro" › Ver: o link leva o id da carga (/envios?carga=<id>) e o site abre o relatório
--    dela (antes abria a lista de cargas e a pessoa tinha que achar a carga).
-- 2. "Lista do dia pronta" › a ação passa de "Baixar" para "Abrir": o botão leva à Lista do dia (/fila), que é
--    onde estão os arquivos; "Baixar" prometia um download que o botão não fazia.
-- Só recria a função para_hoje (os mesmos itens e regras do SQL 47, com essas duas mudanças). Não mexe em tabela,
-- view nem política. Pode rodar de novo sem erro.

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
        -- carga com erro nas últimas 24 horas (quem envia cargas): "Ver" abre o relatório dessa carga em Cargas
        (select 'carga', 25, 'Uma carga voltou com erro',
                left(coalesce(v.nome_original, 'Arquivo enviado') || ' · ' ||
                     to_char(v.enviado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 120),
                'Ver', '/envios?carga=' || v.id
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
        -- clientes sem estágio (nenhum estágio ligado do segmento pega o cliente): ficam sem ação; quem
        -- decide a estratégia precisa saber (decisão do dono, 28/10/2026). Os dois maiores primeiro.
        (select 'sem_estagio', 18,
                left(replace(to_char(s.n, 'FM999G999G990'), ',', '.') || case when s.n = 1 then ' cliente' else ' clientes' end
                     || ' sem estágio em ' || coalesce(cr.nome, 'carteira') || ' · ' || coalesce(cl.nome, s.cluster_atual)
                     || ' — ficam sem ação', 140),
                'Ficam sem ação até entrarem em algum estágio.', 'Resolver',
                '/orquestracao?carteira=' || s.credor_id || coalesce('&segmento=' || cl.id, '') || '&passo=estagios'
           from (select ec.credor_id, ec.cluster_atual, count(*) as n
                   from public.estado_cliente ec
                  where ec.empresa_id = e and coalesce(ec.na_carga, true)
                    and (ec.motivo_hoje like 'sem ação: sem estágio%'
                         or ec.motivo_hoje like 'sem ação: a fase do cliente%'
                         or ec.motivo_hoje like 'sem ação: acordo quebrado, mas a quebra%')
                  group by 1, 2) s
           left join public.credores cr on cr.id = s.credor_id and cr.empresa_id = e
           left join public.clusters cl on cl.empresa_id = e and cl.codigo = s.cluster_atual
          where public.pode('editar_orquestracao')
          order by s.n desc limit 2)
        union all
        -- Lista do dia pronta (quem baixa listas): "Abrir" leva à Lista do dia, onde estão os arquivos para baixar
        (select 'lista', 60,
                'Lista do dia pronta às ' || to_char(x.terminada_em at time zone 'America/Sao_Paulo', 'HH24:MI'),
                replace(to_char((select count(*) from public.fila_dia d where d.empresa_id = e and d.data = hoje),
                                'FM999G999G990'), ',', '.') || ' clientes',
                'Abrir', '/fila'
           from public.execucoes x
          where x.empresa_id = e and x.data_ref = hoje and x.status = 'ok' and public.pode('baixar_listas')
          order by x.terminada_em desc nulls last limit 1)
    ) itens (tipo, urgencia, titulo, detalhe, acao, link)
    order by urgencia, titulo
    limit lim;
end $$;
revoke all on function public.para_hoje(bigint, int) from public, anon;
grant execute on function public.para_hoje(bigint, int) to authenticated;

comment on function public.para_hoje(bigint, int) is
    'Início: o que precisa da pessoa hoje, do mais urgente ao menos. Cada item só para quem pode agir.';
