-- SQL 44 · Workspace, revisão de UX (protótipo aprovado em 16/10/2026: docs/homologacao/workspace-prototipo.html)
-- 1. Início: "Para hoje" (até 5 itens, do mais urgente ao menos, só o que a pessoa pode resolver) e o número do dia
--    de cada área (de hoje ou de ontem, nunca simulação; área não contratada volta sem número).
-- 2. Empresa › Pessoas e perfis: lista única de pessoas (e-mail só para quem gerencia usuários; convite pendente) e
--    o resumo de cada perfil (quantas pessoas e quantos ajustes fora do padrão MotorCX).
-- 3. Suporte do cliente: "Resposta até" pelo prazo (1 dia útil; prioridade alta: 4 horas úteis; dias úteis de 9h às
--    18h em São Paulo) e chamado "Aguardando você" que fecha sozinho com 7 dias sem resposta (aviso no 5º dia).
-- Só funções: nenhuma tabela nova. Depende dos SQL 8 (api_tokens), 12 (chamados), 34 (avisos) e 42 (assuntos).
-- Pode rodar de novo sem erro.

-- ================================================================ 0. empresa da tela
-- cliente: a própria (o parâmetro é ignorado se for de outra); equipe: a escolhida na pílula da empresa
create or replace function public.empresa_da_tela(empresa bigint default null) returns bigint
language sql stable security definer set search_path = public as $$
    select coalesce(
        (select empresa where empresa in (select public.minhas_empresas())),
        (select p.empresa_id from public.perfis p where p.id = auth.uid() and p.ativo and not p.equipe))
$$;
revoke all on function public.empresa_da_tela(bigint) from public, anon;
grant execute on function public.empresa_da_tela(bigint) to authenticated, service_role;

-- ================================================================ 1. Início
drop function if exists public.para_hoje(bigint, int);
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
                'Ver', '/cargas/' || v.id
           from public.envios v
          where v.empresa_id = e and v.status = 'erro' and v.enviado_em > now() - interval '24 hours'
            and public.pode('enviar_arquivos')
          order by v.enviado_em desc limit 1)
        union all
        -- envios pausados (Mensageria)
        (select 'pausa', 35,
                case when count(*) = 1 then 'Um envio está pausado' else count(*) || ' envios estão pausados' end,
                left(coalesce(min(l.motivo), 'Veja o motivo e retome quando puder.'), 120), 'Ver', '/mensageria/lotes'
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
                'Baixar', '/lista-do-dia'
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

-- número do dia de cada área; área não contratada (ou fora das frentes da pessoa) volta sem número
drop function if exists public.numeros_areas(bigint);
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
        '/lista-do-dia';

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

-- ================================================================ 2. Pessoas e perfis
drop function if exists public.pessoas_empresa(bigint);
create or replace function public.pessoas_empresa(empresa bigint default null)
returns table (id uuid, nome text, email text, papel text, areas text[], ultimo_acesso timestamptz, situacao text,
               duas_etapas_obrigatoria boolean)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
declare
    e bigint := public.empresa_da_tela(empresa);
    gerencia boolean := public.pode('gerenciar_usuarios') or public.admin_equipe();
begin
    if e is null then
        return;
    end if;
    return query
    select p.id, trim(concat_ws(' ', p.nome, p.sobrenome)),
           case when gerencia or p.id = auth.uid() then coalesce(p.email, u.email) end,
           p.papel::text,
           coalesce((select array_agg(case uf.frente when 'motorcob' then 'cobranca' else 'jornada' end order by uf.frente)
                       from public.usuario_frentes uf where uf.usuario_id = p.id),
                    array(select case f.frente when 'motorcob' then 'cobranca' else 'jornada' end
                            from public.empresa_frentes f where f.empresa_id = e and f.ativo order by f.frente)),
           p.ultimo_acesso,
           case when not p.ativo then 'inativo' when u.last_sign_in_at is null then 'convite' else 'ativo' end,
           p.papel = 'admin'
      from public.perfis p
      left join auth.users u on u.id = p.id
     where p.empresa_id = e and not coalesce(p.equipe, false)
     order by (not p.ativo), p.nome;
end $$;
revoke all on function public.pessoas_empresa(bigint) from public, anon;
grant execute on function public.pessoas_empresa(bigint) to authenticated;
comment on function public.pessoas_empresa(bigint) is
    'Empresa › Pessoas: todos da empresa veem a lista; o e-mail dos outros só para quem gerencia usuários.';

drop function if exists public.perfis_empresa(bigint);
create or replace function public.perfis_empresa(empresa bigint default null)
returns table (papel text, pessoas int, ajustes int)
language sql stable security definer set search_path = public as $$
    with e as (select public.empresa_da_tela(empresa) id)
    select x.papel::text,
           (select count(*)::int from public.perfis p where p.empresa_id = e.id and p.ativo
               and not coalesce(p.equipe, false) and p.papel = x.papel),
           (select count(*)::int from public.permissoes_papel pp where pp.empresa_id = e.id and pp.papel = x.papel
               and pp.permitido is distinct from public.permissao_padrao(x.papel, pp.permissao))
      from e, unnest(enum_range(null::public.papel)) x (papel)
     where e.id is not null
$$;
revoke all on function public.perfis_empresa(bigint) from public, anon;
grant execute on function public.perfis_empresa(bigint) to authenticated;

-- ================================================================ 3. Suporte do cliente
-- soma horas úteis (seg a sex, 9h às 18h em São Paulo; feriados não contam como exceção)
create or replace function public.somar_horas_uteis(inicio timestamptz, horas numeric) returns timestamptz
language plpgsql stable set search_path = public as $$
declare
    t timestamp := inicio at time zone 'America/Sao_Paulo';
    resta numeric := horas * 60;
    livre numeric;
begin
    if inicio is null or horas is null then
        return null;
    end if;
    loop
        if extract(isodow from t) > 5 or t::time >= time '18:00' then
            t := (t::date + 1) + time '09:00';
            continue;
        end if;
        if t::time < time '09:00' then
            t := t::date + time '09:00';
        end if;
        livre := extract(epoch from ((t::date + time '18:00') - t)) / 60;
        if resta <= livre then
            return (t + make_interval(mins => resta::int)) at time zone 'America/Sao_Paulo';
        end if;
        resta := resta - livre;
        t := (t::date + 1) + time '09:00';
    end loop;
end $$;

-- "Resposta até": só enquanto a vez é da equipe (última mensagem do cliente, chamado não resolvido)
create or replace function public.prazo_resposta(c public.chamados) returns timestamptz
language sql stable set search_path = public as $$
    select case when c.situacao <> 'resolvido' and coalesce(c.ultima_de, 'cliente') = 'cliente'
                then public.somar_horas_uteis(coalesce(c.ultima_em, c.criado_em),
                                              case when c.prioridade = 'alta' then 4 else 9 end) end
$$;
comment on function public.prazo_resposta(public.chamados) is
    'Coluna calculada (select=...,prazo_resposta): 1 dia útil (9 horas úteis); prioridade alta: 4 horas úteis.';
grant execute on function public.prazo_resposta(public.chamados) to authenticated, service_role;

-- todo dia (motor): avisa no 5º dia e fecha no 7º o chamado que espera o cliente
create or replace function public.fechar_chamados_parados() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    c record;
    avisados int := 0;
    fechados int := 0;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor fecha chamados parados';
    end if;
    for c in select ch.* from public.chamados ch
              where ch.situacao = 'aguardando_cliente' and ch.ultima_de = 'equipe'
                and ch.ultima_em <= now() - interval '5 days' and ch.aberto_por is not null
    loop
        if c.ultima_em <= now() - interval '7 days' then
            insert into public.chamado_mensagens (chamado_id, tipo, texto)
            values (c.id, 'equipe', 'Fechamos este chamado porque ficou 7 dias sem resposta. Se ainda precisar, '
                                    || 'é só responder aqui que ele reabre.');
            update public.chamados set situacao = 'resolvido', atualizado_em = now() where id = c.id;
            fechados := fechados + 1;
        else
            insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave, assunto)
            values ('usuario', c.empresa_id, c.aberto_por, 'atencao',
                    left('O chamado ' || coalesce(c.protocolo, '#' || c.id) || ' fecha em 2 dias', 140),
                    left('O Suporte MotorCX espera sua resposta em "' || c.assunto || '". Sem resposta, ele fecha sozinho.', 400),
                    '/suporte/' || c.id,
                    'fecha_chamado:' || c.id || ':' || extract(epoch from c.ultima_em)::bigint, 'outros')
            on conflict (chave) where chave is not null do nothing;
            if found then
                avisados := avisados + 1;
            end if;
        end if;
    end loop;
    return jsonb_build_object('avisados', avisados, 'fechados', fechados);
end $$;
revoke all on function public.fechar_chamados_parados() from public, anon, authenticated;
grant execute on function public.fechar_chamados_parados() to service_role;
