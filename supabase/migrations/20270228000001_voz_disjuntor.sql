-- SQL 115 · Agente Voz/CX › Telefonia, PR T6: disjuntor por tronco, "suspeita de sem crédito" e saúde do tronco (D4,
-- G19 e G34 do parecer)
-- Decisão do dono (08/11/2026, SPEC Canais §6.2 item 14): um tronco que falha seguido sai sozinho, avisa e não derruba
-- os outros; volta depois de um teste que passou.
--
-- 1. voz_troncos_pausas ganha os motivos 'disjuntor' e 'suspeita_sem_credito' (os de antes continuam: sem_credito e
--    bloqueio_originacao, que a VM pausa na hora com SIP 402 e os códigos de bloqueio).
-- 2. falha_tecnica_voz(sip, q850): o que conta como falha TÉCNICA da operadora (não é a pessoa que não atendeu): SIP 403,
--    407, 408, 5xx (menos 580) e Q.850 3, 34, 38, 41, 42, 44, 47, 102 quando não veio código SIP. 404/484 (número),
--    480/486/487/603 (a pessoa) e 402/bloqueio (a VM já pausa) não contam.
-- 3. Gatilho voz_chamadas_disjuntor (depois de gravar a tentativa encerrada, modo teste ou real): olha as tentativas do
--    tronco nas últimas 6 horas, sempre depois da última retomada, e pausa o tronco quando
--      - 50% das últimas 50 tentativas falharam por motivo técnico, ou
--      - as últimas 20 tentativas falharam todas por motivo técnico (motivo 'disjuntor'), ou
--      - mais de 90% das últimas 30 tentativas deram o MESMO código SIP de erro, para pelo menos 15 destinos diferentes
--        (motivo 'suspeita_sem_credito': operadora sem crédito costuma responder 403, 480 ou 503).
--    A pausa é só do tronco: a VM lê as pausas a cada 30 s (troncos_pausados_voz) e a reserva assume; os outros troncos
--    e as outras empresas continuam. Os Admins da empresa recebem o aviso obrigatório "Envios pausados" (vira e-mail) e
--    a equipe, no sino.
-- 4. Volta com teste: registrar_teste_tronco_voz recriada inteira (a do SQL 114) e, quando o teste passa sem o tronco ter
--    mudado, retoma sozinha a pausa do disjuntor ou da suspeita de sem crédito (nota automática). Sem crédito e bloqueio
--    de originação continuam pedindo o Retomar (retomar_rota_voz, depois do teste) ou a equipe.
-- 5. saude_troncos_voz(empresa, horas): por tronco, tentativas, atendidas, % atendidas, falhas técnicas, % de falhas,
--    duração média atendida e os 5 códigos SIP mais comuns (G34). Só para quem vê a telefonia (ve_telefonia).
-- Depende dos SQL 56, 65, 105 e 114. Pode rodar de novo sem erro. Se o SQL 114 rodar de novo, rode este depois.

-- ================================================================ 1. motivos novos da pausa
do $m$
begin
    if exists (select 1 from pg_constraint where conname = 'voz_troncos_pausas_motivo_check'
                and conrelid = 'public.voz_troncos_pausas'::regclass
                and pg_get_constraintdef(oid) not like '%disjuntor%') then
        alter table public.voz_troncos_pausas drop constraint voz_troncos_pausas_motivo_check;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'voz_troncos_pausas_motivo_check'
                    and conrelid = 'public.voz_troncos_pausas'::regclass) then
        alter table public.voz_troncos_pausas add constraint voz_troncos_pausas_motivo_check
            check (motivo in ('sem_credito', 'bloqueio_originacao', 'disjuntor', 'suspeita_sem_credito'));
    end if;
end $m$;
create index if not exists voz_chamadas_tronco on public.voz_chamadas (tronco_id, ocorrido_em desc) where tronco_id is not null;

-- ================================================================ 2. o que é falha técnica
create or replace function public.falha_tecnica_voz(sip int, q850 int) returns boolean
language sql immutable parallel safe set search_path = public as $$
    select case
        when sip is not null and sip > 0 then sip in (403, 407, 408) or (sip between 500 and 599 and sip <> 580)
        else coalesce(q850 in (3, 34, 38, 41, 42, 44, 47, 102), false)
    end
$$;
revoke all on function public.falha_tecnica_voz(int, int) from public, anon;
grant execute on function public.falha_tecnica_voz(int, int) to authenticated, service_role;

-- ================================================================ 3. disjuntor
create or replace function public.avaliar_disjuntor_tronco_voz(tronco bigint) returns text
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    t public.voz_troncos;
    desde timestamptz;
    n50 int; tec50 int; n20 int; tec20 int; n30 int;
    cod int; cod_qtd int; destinos int;
    motivo text;
    causa int;
    pid bigint;
    detalhe text;
begin
    select * into t from public.voz_troncos x where x.id = tronco;
    if t.id is null or exists (select 1 from public.voz_troncos_pausas p where p.tronco_id = t.id and p.retomado_em is null) then
        return null;
    end if;
    desde := greatest(now() - interval '6 hours',
                      coalesce((select max(p.retomado_em) from public.voz_troncos_pausas p where p.tronco_id = t.id),
                               '-infinity'::timestamptz));
    with u as (
        select row_number() over (order by c.ocorrido_em desc) as pos,
               public.falha_tecnica_voz(c.causa_sip, c.causa_q850) as tecnica,
               case when c.atendida_em is null and c.causa_sip >= 400 then c.causa_sip end as sip, c.destino_hash as destino
          from public.voz_chamadas c
         where c.tronco_id = t.id and c.empresa_id = t.empresa_id and c.modo in ('teste', 'real')
           and c.encerrada_em is not null and c.ocorrido_em >= desde
         order by c.ocorrido_em desc limit 50
    ), top as (
        select u.sip, count(*) as qtd, count(distinct u.destino) as destinos
          from u where u.pos <= 30 and u.sip is not null group by u.sip order by count(*) desc limit 1
    )
    select count(*), count(*) filter (where u.tecnica),
           count(*) filter (where u.pos <= 20), count(*) filter (where u.pos <= 20 and u.tecnica),
           count(*) filter (where u.pos <= 30),
           (select top.sip from top), (select top.qtd from top), (select top.destinos from top)
      into n50, tec50, n20, tec20, n30, cod, cod_qtd, destinos
      from u;
    if n30 >= 30 and cod_qtd * 10 > n30 * 9 and coalesce(destinos, 0) >= 15 then
        motivo := 'suspeita_sem_credito'; causa := cod;
        detalhe := cod_qtd || ' das últimas ' || n30 || ' tentativas deram o código SIP ' || cod
                   || ', para destinos diferentes';
    elsif n20 >= 20 and tec20 = n20 then
        motivo := 'disjuntor'; causa := cod;
        detalhe := 'as últimas ' || n20 || ' tentativas falharam por motivo técnico';
    elsif n50 >= 50 and tec50 * 2 >= n50 then
        motivo := 'disjuntor'; causa := cod;
        detalhe := tec50 || ' das últimas ' || n50 || ' tentativas falharam por motivo técnico';
    else
        return null;
    end if;
    insert into public.voz_troncos_pausas as p (empresa_id, tronco_id, motivo, causa_sip)
    values (t.empresa_id, t.id, motivo, case when causa between 100 and 699 then causa end)
    on conflict (tronco_id) where retomado_em is null do nothing
    returning p.id into pid;
    if pid is null then
        return null;
    end if;
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, assunto)
    select 'usuario', t.empresa_id, pr.id, 'erro',
           left('Telefonia: o tronco ' || t.referencia || ' saiu sozinho', 140),
           left(case when motivo = 'suspeita_sem_credito' then 'Suspeita de sem crédito ou bloqueio na operadora: '
                     else 'Muitas falhas seguidas da operadora: ' end || detalhe
                || '. Os outros troncos continuam ligando (a reserva assume). O que fazer: fale com a operadora, rode o '
                || 'Testar a rota e, se passar, o tronco volta sozinho.', 400),
           '/voz/telefonia', 'pausa'
      from public.perfis pr
     where pr.empresa_id = t.empresa_id and pr.ativo and not pr.equipe and pr.papel = 'admin';
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'equipe', t.empresa_id, 'atencao',
           left('Disjuntor: tronco ' || t.referencia || ' pausado · ' || coalesce(e.nome, ''), 140),
           left(motivo || ': ' || detalhe || '. Volta com um teste que passou (ou retomar no Console).', 400),
           '/console/voz', 'tronco_pausado:' || pid
      from public.empresas e where e.id = t.empresa_id;
    return motivo;
end $$;
revoke all on function public.avaliar_disjuntor_tronco_voz(bigint) from public, anon, authenticated;
grant execute on function public.avaliar_disjuntor_tronco_voz(bigint) to service_role;

create or replace function public.disjuntor_chamada_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.tronco_id is null or new.encerrada_em is null or new.modo not in ('teste', 'real') then
        return null;
    end if;
    if tg_op = 'UPDATE' and old.encerrada_em is not null then
        return null;
    end if;
    -- só a tentativa que falhou pode abrir o disjuntor (atendida não precisa olhar)
    if new.atendida_em is null and (public.falha_tecnica_voz(new.causa_sip, new.causa_q850) or new.causa_sip >= 400) then
        perform public.avaliar_disjuntor_tronco_voz(new.tronco_id);
    end if;
    return null;
end $$;
revoke all on function public.disjuntor_chamada_voz() from public, anon, authenticated;
drop trigger if exists voz_chamadas_disjuntor on public.voz_chamadas;
create trigger voz_chamadas_disjuntor after insert or update on public.voz_chamadas
    for each row execute function public.disjuntor_chamada_voz();

-- ================================================================ 5. saúde do tronco (G34)
create or replace function public.saude_troncos_voz(empresa bigint, horas int default 24)
returns table (tronco_id bigint, tentativas int, atendidas int, pct_atendidas numeric, falhas_tecnicas int,
               pct_falhas numeric, duracao_media_s numeric, codigos jsonb, ultima_em timestamptz)
language sql stable security definer set search_path = public as $$
    with c as (
        select v.tronco_id, v.atendida_em, v.billsec, v.causa_sip, v.causa_q850, v.ocorrido_em
          from public.voz_chamadas v
         where v.empresa_id = empresa and v.tronco_id is not null and v.modo in ('teste', 'real')
           and v.ocorrido_em >= now() - make_interval(hours => least(greatest(coalesce(horas, 24), 1), 24 * 31))
           and public.ve_telefonia(empresa)
    ), cod as (
        select x.tronco_id, jsonb_agg(jsonb_build_object('codigo', x.causa_sip, 'qtd', x.qtd) order by x.qtd desc) as codigos
          from (select c.tronco_id, c.causa_sip, count(*) as qtd,
                       row_number() over (partition by c.tronco_id order by count(*) desc) as ord
                  from c where c.atendida_em is null and c.causa_sip is not null
                 group by c.tronco_id, c.causa_sip) x
         where x.ord <= 5
         group by x.tronco_id
    )
    select c.tronco_id, count(*)::int, count(c.atendida_em)::int,
           round(100.0 * count(c.atendida_em) / count(*), 1),
           count(*) filter (where c.atendida_em is null and public.falha_tecnica_voz(c.causa_sip, c.causa_q850))::int,
           round(100.0 * count(*) filter (where c.atendida_em is null and public.falha_tecnica_voz(c.causa_sip, c.causa_q850))
                 / count(*), 1),
           round(avg(c.billsec) filter (where c.atendida_em is not null), 1),
           coalesce((select cod.codigos from cod where cod.tronco_id = c.tronco_id), '[]'::jsonb),
           max(c.ocorrido_em)
      from c group by c.tronco_id
$$;
revoke all on function public.saude_troncos_voz(bigint, int) from public, anon;
grant execute on function public.saude_troncos_voz(bigint, int) to authenticated;

-- ================================================================ 4. volta com teste
-- registrar_teste_tronco_voz: a do SQL 114 com a retomada automática do disjuntor (passo final que passou).
-- cada passo (e o fim). passos: [{passo 0..9, resultado ok|aviso|falha|inconclusivo|rodando|pulado, mensagem}]
create or replace function public.registrar_teste_tronco_voz(teste bigint, passos jsonb, situacao text default null,
                                                            resumo text default null) returns text
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    x public.voz_testes_tronco;
    t public.voz_troncos;
    p jsonb;
    final boolean := situacao in ('passou', 'atencao', 'falhou', 'incompleto');
    vale boolean;
    h text;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    if situacao is not null and situacao not in ('rodando', 'passou', 'atencao', 'falhou', 'incompleto') then
        raise exception 'situação do teste inválida';
    end if;
    if jsonb_typeof(passos) <> 'array' or jsonb_array_length(passos) > 10 then
        raise exception 'passos: lista de até 10';
    end if;
    for p in select * from jsonb_array_elements(passos) loop
        if jsonb_typeof(p) <> 'object' or (p ->> 'passo') !~ '^[0-9]$'
           or coalesce(p ->> 'resultado', '') not in ('ok', 'aviso', 'falha', 'inconclusivo', 'rodando', 'pulado')
           or char_length(coalesce(p ->> 'mensagem', '')) > 300
           or not public.texto_sem_dado_pessoal(coalesce(p ->> 'mensagem', '')) then
            raise exception 'passo inválido no teste';
        end if;
    end loop;
    if resumo is not null and (char_length(resumo) > 400 or not public.texto_sem_dado_pessoal(resumo)) then
        raise exception 'resumo inválido';
    end if;
    select * into x from public.voz_testes_tronco v where v.id = teste for update;
    if x.id is null then
        raise exception 'teste não encontrado';
    end if;
    if x.situacao <> 'rodando' then
        return x.situacao;                 -- cancelado ou expirado: o servidor de voz para
    end if;
    update public.voz_testes_tronco v
       set passos = registrar_teste_tronco_voz.passos,
           situacao = coalesce(registrar_teste_tronco_voz.situacao, v.situacao),
           resumo = coalesce(registrar_teste_tronco_voz.resumo, v.resumo),
           concluido_em = case when final then now() end
     where v.id = x.id;
    if not final then
        return 'rodando';
    end if;
    select * into t from public.voz_troncos y where y.id = x.tronco_id for update;
    vale := public.assinatura_tronco_voz(t) = x.assinatura;
    if vale and situacao in ('passou', 'atencao', 'falhou') then
        update public.voz_troncos y set teste_ok = situacao in ('passou', 'atencao'), testado_em = now()
         where y.id = t.id;
    end if;
    -- passo 5 com o código da tela: o número de teste fica confirmado e passa a valer no modo "Só números de teste"
    if exists (select 1 from jsonb_array_elements(passos) e where e ->> 'passo' = '5' and e ->> 'resultado' = 'ok')
       and x.numero_teste_id is not null then
        update public.voz_numeros_teste n set confirmado_em = coalesce(n.confirmado_em, now())
         where n.id = x.numero_teste_id returning n.hash into h;
        if h is not null then
            insert into public.voz_config (empresa_id) values (x.empresa_id) on conflict (empresa_id) do nothing;
            update public.voz_config c
               set numeros_teste_hash = c.numeros_teste_hash || h, atualizado_em = now()
             where c.empresa_id = x.empresa_id and not h = any (c.numeros_teste_hash)
               and cardinality(c.numeros_teste_hash) < 20;
        end if;
    end if;
    -- SQL 115 · volta com teste: a pausa do disjuntor ou da suspeita de sem crédito sai sozinha quando o teste passa
    if vale and situacao in ('passou', 'atencao') then
        update public.voz_troncos_pausas p
           set retomado_em = now(), retomado_por = x.pedido_por,
               nota = 'Retomada sozinha: o teste da rota passou em '
                      || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
         where p.tronco_id = t.id and p.retomado_em is null and p.motivo in ('disjuntor', 'suspeita_sem_credito');
    end if;
    if vale and situacao in ('passou', 'atencao') and not t.ativo then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, assunto)
        values ('equipe', x.empresa_id, 'pronto', left('Telefonia do cliente: o tronco ' || t.referencia || ' passou no teste', 140),
                'O tronco passou no teste da rota. Se é a primeira vez da empresa, confira e ative no Console.',
                '/console/fornecedores?aba=voz', 'equipe');
    end if;
    return situacao;
end $$;

revoke all on function public.registrar_teste_tronco_voz(bigint, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.registrar_teste_tronco_voz(bigint, jsonb, text, text) to service_role;
