-- Saúde do sistema (Console da equipe MotorCob): numa linha por empresa ativa, o que pede atenção.
-- * rotina do dia (rodou hoje? a última deu erro?), cargas com erro nos últimos 7 dias e cargas aguardando o
--   mapeamento das colunas, lotes da mensageria parados ou aguardando aprovação, chamados atrasados (alta > 4 h,
--   normal > 24 h sem resolver) e faturas vencidas.
-- * nivel: critico (rotina com erro, ou dia útil depois das 9h sem rotina) · atencao (qualquer outro alerta) · ok.
-- Só a equipe MotorCob vê. Pode ser rodado de novo sem erro.

create or replace function public.saude_empresas()
returns table (empresa_id bigint, nome text, situacao text, nivel text, rotina_hoje boolean,
               ultima_rotina timestamptz, ultima_rotina_status text, ultima_rotina_erro text,
               cargas_erro_7d int, cargas_aguardando int, lotes_parados int, lotes_aguardando int,
               chamados_atrasados int, faturas_vencidas int, valor_vencido numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    agora timestamptz := now();
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    hora int := extract(hour from now() at time zone 'America/Sao_Paulo');
    dia_util boolean := extract(isodow from (now() at time zone 'America/Sao_Paulo')) < 6;
begin
    if not public.sou_equipe() then
        raise exception 'só a equipe MotorCob vê a saúde do sistema';
    end if;
    return query
    with base as (
        select e.id, e.nome, e.situacao,
               ult.iniciada_em, ult.status, ult.erro,
               exists (select 1 from public.execucoes x where x.empresa_id = e.id and x.data_ref = hoje
                       and x.status = 'ok') as hoje_ok,
               (select count(*) from public.envios v where v.empresa_id = e.id and v.status = 'erro'
                  and v.enviado_em > agora - interval '7 days')::int as c_erro,
               (select count(*) from public.envios v where v.empresa_id = e.id and v.status = 'aguardando')::int as c_agu,
               (select count(*) from public.mensageria_lotes l where l.empresa_id = e.id
                  and l.situacao in ('agendado', 'enviando')
                  and (l.data < hoje or l.atualizado_em < agora - interval '1 hour'))::int as l_par,
               (select count(*) from public.mensageria_lotes l where l.empresa_id = e.id and l.data = hoje
                  and l.situacao = 'aguardando_aprovacao')::int as l_agu,
               (select count(*) from public.chamados c where c.empresa_id = e.id and c.situacao <> 'resolvido'
                  and c.situacao <> 'aguardando_cliente'
                  and c.criado_em < agora - case when c.prioridade = 'alta' then interval '4 hours'
                                                 else interval '24 hours' end)::int as ch_atr,
               (select count(*) from public.faturas f where f.empresa_id = e.id and f.situacao = 'aberta'
                  and f.vencimento < hoje)::int as fat_n,
               (select coalesce(sum(f.valor_total), 0) from public.faturas f where f.empresa_id = e.id
                  and f.situacao = 'aberta' and f.vencimento < hoje) as fat_v
          from public.empresas e
          left join lateral (select x.iniciada_em, x.status, x.erro from public.execucoes x
                              where x.empresa_id = e.id order by x.iniciada_em desc limit 1) ult on true
         where e.ativa and e.situacao <> 'encerrada'
    )
    select b.id, b.nome, b.situacao,
           case when b.status = 'erro' or (dia_util and hora >= 9 and not b.hoje_ok and b.situacao = 'ativa') then 'critico'
                when b.c_erro + b.c_agu + b.l_par + b.l_agu + b.ch_atr + b.fat_n > 0 then 'atencao'
                else 'ok' end,
           b.hoje_ok, b.iniciada_em, b.status, left(b.erro, 200),
           b.c_erro, b.c_agu, b.l_par, b.l_agu, b.ch_atr, b.fat_n, b.fat_v
      from base b
     order by case when b.status = 'erro' or (dia_util and hora >= 9 and not b.hoje_ok and b.situacao = 'ativa') then 0
                   when b.c_erro + b.c_agu + b.l_par + b.l_agu + b.ch_atr + b.fat_n > 0 then 1 else 2 end, b.nome;
end $$;
revoke execute on function public.saude_empresas() from public, anon;
grant execute on function public.saude_empresas() to authenticated;
