-- SQL 86 · Canais: a tela do canal (SPEC Canais §6.2, PRs 6 e 7; padrões aprovados pelo dono em 08/11/2026)
--
-- A tela nova do canal (/canais/:canal) tem Pausar / Retomar no topo, com "Pausado desde". Até aqui o "desde" era o
-- atualizado_em da linha de canais_empresa, que muda a cada horário, custo ou quem envia salvo depois da pausa: o canal
-- pausado em 02/11 e com o custo corrigido em 05/11 aparecia "pausado desde 05/11". Agora a data fica guardada à parte.
--
-- 1. canais_empresa.pausado_em / pausado_por: o banco grava quando ativo passa a false (agora + quem pausou) e apaga
--    quando volta a true. Nada do site grava essas colunas: o gatilho ignora o que vier e mantém o valor anterior
--    enquanto o canal segue pausado. Canal que já estava pausado: pausado_em = atualizado_em (a melhor data que existe),
--    sem mexer no atualizado_em nem gerar auditoria.
-- 2. estado_canais(empresa): "Pausado desde" e a frase do problema usam pausado_em (sem ele, atualizado_em, como antes);
--    o "o que fazer" diz "toque em Retomar". Resto igual ao SQL 84.
-- 3. credor_canais (a carteira muda a regra do canal): a gravação passa de tem_papel('admin','planejamento') para
--    pode('editar_canais'), o mesmo de canais_empresa, do menu e da tela (SPEC §5: "trocar o papel fixo").
-- Depende do SQL 84. Pode rodar de novo. O site novo funciona sem este SQL (o "desde" cai no atualizado_em).

-- ================================================================ 1. pausado desde
alter table public.canais_empresa add column if not exists pausado_em timestamptz;
alter table public.canais_empresa add column if not exists pausado_por uuid references auth.users (id) on delete set null;
comment on column public.canais_empresa.pausado_em is
    'Quando o canal foi pausado (ativo = false); nulo com o canal ligado. Gravado pelo gatilho canal_pausado_desde. SQL 86.';
comment on column public.canais_empresa.pausado_por is 'Quem pausou o canal (auth.users). SQL 86.';

-- canal que já estava pausado antes deste SQL: a melhor data que existe, sem carimbar nem auditar a linha
drop trigger if exists canal_pausado_desde on public.canais_empresa;
alter table public.canais_empresa disable trigger carimbar_canal;
do $$ begin
    if exists (select 1 from pg_trigger where tgrelid = 'public.canais_empresa'::regclass and tgname = 'z_auditar') then
        execute 'alter table public.canais_empresa disable trigger z_auditar';
    end if;
end $$;
update public.canais_empresa set pausado_em = atualizado_em, pausado_por = atualizado_por
 where ativo = false and pausado_em is null;
update public.canais_empresa set pausado_em = null, pausado_por = null
 where ativo = true and (pausado_em is not null or pausado_por is not null);
alter table public.canais_empresa enable trigger carimbar_canal;
do $$ begin
    if exists (select 1 from pg_trigger where tgrelid = 'public.canais_empresa'::regclass and tgname = 'z_auditar') then
        execute 'alter table public.canais_empresa enable trigger z_auditar';
    end if;
end $$;

create or replace function public.canal_pausado_desde() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.ativo is distinct from false then
        new.pausado_em := null;
        new.pausado_por := null;
    elsif tg_op = 'INSERT' or old.ativo is distinct from false then
        new.pausado_em := now();
        new.pausado_por := auth.uid();
    else
        new.pausado_em := old.pausado_em;
        new.pausado_por := old.pausado_por;
    end if;
    return new;
end $$;
revoke all on function public.canal_pausado_desde() from public, anon, authenticated;
create trigger canal_pausado_desde before insert or update on public.canais_empresa
    for each row execute function public.canal_pausado_desde();

-- ================================================================ 2. estado_canais com o "pausado desde" guardado
create or replace function public.estado_canais(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    tz constant text := 'America/Sao_Paulo';
    hoje date := (now() at time zone tz)::date;
    canais_ordem constant text[] := array['whatsapp', 'sms', 'rcs', 'email', 'agente_voz', 'discador'];
    nivel_de constant jsonb := '{"pausado":5,"nao_configurado":4,"com_problema":3,"atencao":2,"funcionando":1}';
    c text;
    ce record;
    msg_mod boolean; msg_canais text[]; voz_mod boolean;
    mcfg record;
    orc record; centro record; orc_pct numeric;
    d_lista date; ult_exec timestamptz;
    voz record; voz_ativos int; voz_rotas_vig int; pausas record; invalidos int; sem_cadastro int;
    curtas record; curtas_pct numeric;
    quem text; grupo text; tipo_ret text; canal_cod text;
    m record; lh record; lv record; vc record; ret record; n_cod int; n_lista int; lista_ini date; tem_lista boolean;
    atraso int; taxa24 numeric; taxa7 numeric;
    probs jsonb; sinais jsonb; ult timestamptz; est text; p jsonb;
    saida jsonb := '[]'; resumo jsonb := '{}';
begin
    if empresa is null or not public.pode_ver_empresa(empresa) or not (public.pode('editar_canais') or public.sou_equipe()) then
        raise exception 'sem permissão para ver o estado dos canais';
    end if;

    -- ---------------------------------------------------------------- o que vale para a empresa toda
    select coalesce(bool_or(em.modulo = 'mensageria' and em.ativo), false),
           coalesce(bool_or(em.modulo = 'agente_voz' and em.ativo), false)
      into msg_mod, voz_mod
      from public.empresa_modulos em where em.empresa_id = empresa;
    select coalesce((select em.canais from public.empresa_modulos em
                      where em.empresa_id = empresa and em.modulo = 'mensageria' and em.ativo), '{}')
      into msg_canais;
    select null::bigint as id, null::boolean as ativo, null::int as alerta_pct into centro;
    select null::numeric as orcamento, null::numeric as gasto, null::text as ao_estourar, null::boolean as alerta into orc;

    select mc.modo, mc.centro_custo_id into mcfg from public.mensageria_config mc where mc.empresa_id = empresa;
    if mcfg.centro_custo_id is not null then
        select cc.id, cc.ativo, cc.alerta_pct into centro from public.mensageria_centros_custo cc where cc.id = mcfg.centro_custo_id;
        if centro.ativo then
            select * into orc from public.orcamento_centro_motor(mcfg.centro_custo_id, hoje);
            if orc.orcamento is not null and orc.orcamento > 0 then
                orc_pct := round(100 * orc.gasto / orc.orcamento, 1);
            end if;
        end if;
    end if;

    select max(f.data) into d_lista from public.fila_dia f where f.empresa_id = empresa and f.data >= hoje - 30;
    select max(e.terminada_em) into ult_exec from public.execucoes e where e.empresa_id = empresa and e.status = 'ok';

    select vc0.modo, vc0.provedor into voz from public.voz_config vc0 where vc0.empresa_id = empresa;
    select count(*) filter (where t.ativo) into voz_ativos from public.voz_troncos t where t.empresa_id = empresa;
    select count(*) into voz_rotas_vig from public.voz_rotas r
     where r.empresa_id = empresa and r.vigente_desde <= hoje and (r.vigente_ate is null or r.vigente_ate >= hoje);
    select count(*) as n, string_agg(distinct p0.motivo, ',') as motivos,
           count(distinct p0.tronco_id) filter (where t.ativo) as troncos, min(p0.pausado_em) as desde
      into pausas
      from public.voz_troncos_pausas p0 join public.voz_troncos t on t.id = p0.tronco_id
     where p0.empresa_id = empresa and p0.retomado_em is null;
    select count(*) filter (where fs.item = 'configuracao_invalida'), count(*) filter (where fs.item = 'rota_sem_cadastro')
      into invalidos, sem_cadastro
      from public.fornecedor_saude fs where fs.empresa_id = empresa and not fs.ok;

    -- chamadas curtas: a última rodada ok de cada carteira (últimos 3 dias), medido dos últimos 7 dias
    select coalesce(sum((x ->> 'chamadas')::numeric), 0) as chamadas, coalesce(sum((x ->> 'curtas')::numeric), 0) as curtas
      into curtas
      from (select distinct on (e.credor_id) e.resumo
              from public.execucoes e
             where e.empresa_id = empresa and e.status = 'ok' and e.data_ref >= hoje - 3
             order by e.credor_id, e.iniciada_em desc) u,
           lateral jsonb_array_elements(case when jsonb_typeof(u.resumo #> '{discagem,chamadas_curtas,medido}') = 'array'
                                             then u.resumo #> '{discagem,chamadas_curtas,medido}' else '[]' end) x;
    if curtas.chamadas >= 30 then curtas_pct := round(100 * curtas.curtas / curtas.chamadas, 1); end if;

    -- ---------------------------------------------------------------- canal a canal
    foreach c in array canais_ordem loop
        probs := '[]'; sinais := '[]'; ult := null; atraso := null;
        select ce0.ativo, ce0.quem_envia, coalesce(ce0.pausado_em, ce0.atualizado_em) as pausado_em into ce
          from public.canais_empresa ce0 where ce0.empresa_id = empresa and ce0.canal = c;
        grupo := case when c in ('agente_voz', 'discador') then 'voz' else 'mensagens' end;
        if grupo = 'voz' then
            quem := case when voz_mod then 'voz_motorcx' else 'lista' end;
            tipo_ret := 'canal_voz'; canal_cod := 'voz';
        else
            quem := coalesce(ce.quem_envia, case when c = any (msg_canais) then 'motorcx' else 'lista' end);
            tipo_ret := 'canal_' || c; canal_cod := c;
        end if;

        -- pausado
        if ce.ativo is false then
            probs := probs || jsonb_build_object('nivel', 'pausado', 'motivo', 'pausado',
                'problema', 'Canal pausado desde ' || to_char(ce.pausado_em at time zone tz, 'DD/MM') || '.',
                'o_que_fazer', 'Enquanto pausado, nenhuma estratégia usa este canal. Para voltar a usar, abra o canal e toque em Retomar.',
                'acao', 'retomar');
            sinais := sinais || jsonb_build_object('chave', 'pausado_desde', 'rotulo', 'Pausado desde', 'tipo', 'data',
                                                   'valor', ce.pausado_em, 'detalhe', null, 'ruim', false);
        end if;

        if quem = 'motorcx' then
            -- ---------------------------------------------------- Mensageria da MotorCX envia
            select count(*) filter (where mm.enviado_em >= now() - interval '24 hours'
                                     and mm.situacao in ('enviada', 'entregue', 'falhou'))                       as env24,
                   count(*) filter (where mm.enviado_em >= now() - interval '24 hours' and mm.situacao = 'entregue') as ent24,
                   count(*) filter (where mm.enviado_em >= now() - interval '24 hours' and mm.situacao = 'falhou')   as fal24,
                   count(*) filter (where mm.enviado_em >= now() - interval '24 hours'
                                     and (mm.situacao in ('entregue', 'falhou')
                                          or (mm.situacao = 'enviada' and mm.enviado_em < now() - interval '1 hour'))) as base24,
                   count(*) filter (where mm.enviado_em >= now() - interval '8 days' and mm.enviado_em < now() - interval '24 hours'
                                     and mm.situacao in ('entregue', 'falhou', 'enviada'))                       as base7,
                   count(*) filter (where mm.enviado_em >= now() - interval '8 days' and mm.enviado_em < now() - interval '24 hours'
                                     and mm.situacao = 'entregue')                                               as ent7,
                   max(mm.enviado_em)                                                                            as ultimo
              into m
              from public.mensageria_lotes l join public.mensageria_mensagens mm on mm.lote_id = l.id
             where l.empresa_id = empresa and l.canal = c and l.data >= hoje - 9;
            select count(*) as lotes, max(l.atualizado_em) as ultimo_lote,
                   bool_or(l.data = hoje and l.situacao = 'aguardando_aprovacao') as esperando,
                   bool_or(l.data = hoje and l.situacao = 'pausado') as pausado
              into lh from public.mensageria_lotes l where l.empresa_id = empresa and l.canal = c;
            ult := m.ultimo;
            taxa24 := case when m.base24 >= 30 then round(100.0 * m.ent24 / m.base24, 1) end;
            taxa7 := case when m.base7 >= 30 then round(100.0 * m.ent7 / m.base7, 1) end;

            if not (c = any (msg_canais)) then
                probs := probs || jsonb_build_object('nivel', 'nao_configurado', 'motivo', 'canal_nao_liberado',
                    'problema', case when c = 'rcs'
                                     then 'Falta o agente RCS verificado da empresa (nome, logo e selo que aparecem no celular).'
                                     else 'O MotorCX está marcado para enviar, mas o canal não está liberado na Mensageria da empresa.' end,
                    'o_que_fazer', case when c = 'rcs'
                                        then 'Peça a verificação à equipe MotorCX. Enquanto isso, nenhuma estratégia usa RCS.'
                                        else 'Peça à equipe MotorCX para liberar o canal, ou troque para "Lista para baixar" na configuração do canal.' end,
                    'acao', 'suporte');
            elsif lh.lotes = 0 then
                probs := probs || jsonb_build_object('nivel', 'nao_configurado', 'motivo', 'nunca_enviou',
                    'problema', 'Nunca enviou.',
                    'o_que_fazer', 'O primeiro lote sai com a próxima Lista do dia que tiver clientes neste canal. Confira se alguma estratégia usa o canal.',
                    'acao', 'estrategias');
            end if;

            if taxa24 is not null and (taxa24 < 80 or (taxa7 is not null and taxa24 < taxa7 - 15)) then
                probs := probs || jsonb_build_object('nivel', 'com_problema', 'motivo', 'entrega_baixa',
                    'problema', 'A entrega caiu para ' || replace(round(taxa24)::text, '.', ',') || '% nas últimas 24 h'
                                || coalesce(' (a média dos 7 dias anteriores é ' || replace(round(taxa7)::text, '.', ',') || '%)', '') || '.',
                    'o_que_fazer', 'Abra o Score de entrega para ver em qual operadora caiu. Se não melhorar, fale com a equipe MotorCX: ela pode trocar a rota.',
                    'acao', 'score_entrega');
            end if;
            if orc_pct is not null and orc_pct > 90 and orc.ao_estourar = 'bloquear' then
                probs := probs || jsonb_build_object('nivel', 'com_problema', 'motivo', 'orcamento_bloqueia',
                    'problema', 'O orçamento do mês está em ' || replace(round(orc_pct)::text, '.', ',')
                                || '% e, ao acabar, os envios são bloqueados.',
                    'o_que_fazer', 'Aumente o orçamento do centro de custo ou troque "ao acabar" para continuar, em Mensageria › Configurações.',
                    'acao', 'orcamento');
            elsif orc_pct is not null and orc.alerta then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'orcamento_alerta',
                    'problema', 'O orçamento do mês já chegou a ' || replace(round(orc_pct)::text, '.', ',') || '%.',
                    'o_que_fazer', 'Confira o centro de custo em Mensageria › Configurações antes que acabe.',
                    'acao', 'orcamento');
            end if;
            if lh.esperando then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'lote_esperando',
                    'problema', 'O lote de hoje está esperando aprovação.',
                    'o_que_fazer', 'Aprove o lote para ele sair dentro do horário do canal.', 'acao', 'lotes');
            elsif lh.pausado then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'lote_pausado',
                    'problema', 'O lote de hoje está pausado.',
                    'o_que_fazer', 'Retome o lote em Mensageria para ele terminar hoje.', 'acao', 'lotes');
            end if;
            if coalesce(mcfg.modo, 'simulado') = 'simulado' and lh.lotes > 0 then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'simulado',
                    'problema', 'Em simulação: as mensagens não saem de verdade.',
                    'o_que_fazer', 'Quando estiver tudo conferido, peça o envio real à equipe MotorCX.', 'acao', 'suporte');
            end if;

            sinais := sinais
                || jsonb_build_object('chave', 'ultimo_envio', 'rotulo', 'Último envio', 'tipo', 'data', 'valor', m.ultimo,
                                      'detalhe', case when m.ultimo is null then 'nunca' end, 'ruim', false)
                || jsonb_build_object('chave', 'enviadas_24h', 'rotulo', 'Enviadas 24 h', 'tipo', 'numero', 'valor', m.env24,
                                      'detalhe', null, 'ruim', false)
                || jsonb_build_object('chave', 'entregues_24h', 'rotulo', 'Entregues 24 h', 'tipo', 'pct', 'valor', taxa24,
                                      'detalhe', case when taxa7 is not null then 'média 7 d: ' || replace(taxa7::text, '.', ',') || '%'
                                                      when taxa24 is null and m.env24 > 0 then 'poucas para medir' end,
                                      'ruim', coalesce(taxa24 < 80 or taxa24 < taxa7 - 15, false));
            if orc_pct is not null then
                sinais := sinais || jsonb_build_object('chave', 'orcamento', 'rotulo', 'Orçamento do mês', 'tipo', 'pct',
                    'valor', orc_pct, 'detalhe', 'ao acabar: ' || case orc.ao_estourar when 'bloquear' then 'bloquear envios' else 'continuar' end,
                    'ruim', orc_pct > 90 and orc.ao_estourar = 'bloquear');
            else
                sinais := sinais || jsonb_build_object('chave', 'falhas_24h', 'rotulo', 'Falhas 24 h', 'tipo', 'numero',
                    'valor', m.fal24, 'detalhe', null, 'ruim', false);
            end if;

        elsif quem = 'voz_motorcx' then
            -- ---------------------------------------------------- Voz MotorCX liga (agente e discador)
            select count(*) as total, count(*) filter (where vc1.atendida_em is not null) as atendidas,
                   count(*) filter (where vc1.transferencia = 'atendida') as transferidas,
                   count(*) filter (where vc1.transferencia = 'sem_operador') as sem_operador
              into vc from public.voz_chamadas vc1
             where vc1.empresa_id = empresa and vc1.canal = c and vc1.ocorrido_em >= now() - interval '24 hours';
            select max(vc1.ocorrido_em) into ult from public.voz_chamadas vc1
             where vc1.empresa_id = empresa and vc1.canal = c and vc1.ocorrido_em >= now() - interval '30 days';
            select coalesce(sum(vl.total), 0) as total, coalesce(sum(vl.encerradas), 0) as encerradas,
                   bool_or(vl.freado_em is not null) as freado, bool_or(vl.situacao = 'ligando') as ligando, count(*) as lotes
              into lv from public.voz_lotes vl where vl.empresa_id = empresa and vl.data = hoje;

            if voz.modo is null then
                probs := probs || jsonb_build_object('nivel', 'nao_configurado', 'motivo', 'voz_sem_config',
                    'problema', 'O agente de voz ainda não foi montado para a empresa.',
                    'o_que_fazer', 'A equipe MotorCX configura o provedor e o modo. Fale com ela pelo Suporte.', 'acao', 'suporte');
            elsif voz_ativos = 0 then
                probs := probs || jsonb_build_object('nivel', 'nao_configurado', 'motivo', 'sem_tronco',
                    'problema', 'Nenhum tronco de voz ativo: o MotorCX não tem por onde ligar.',
                    'o_que_fazer', 'Cadastre o tronco da sua operadora em Agente Voz/CX › Telefonia (ou peça à equipe MotorCX).',
                    'acao', 'telefonia');
            elsif voz_rotas_vig = 0 then
                probs := probs || jsonb_build_object('nivel', 'nao_configurado', 'motivo', 'sem_rota',
                    'problema', 'Nenhuma rota de voz vigente.',
                    'o_que_fazer', 'Cadastre a rota (prefixo e preço) em Agente Voz/CX › Telefonia.', 'acao', 'telefonia');
            end if;
            if pausas.n > 0 then
                probs := probs || jsonb_build_object('nivel', 'com_problema', 'motivo', 'rota_pausada',
                    'problema', pausas.n || case when pausas.n = 1 then ' rota pausada' else ' rotas pausadas' end
                                || case when pausas.motivos like '%bloqueio_originacao%' then ' (bloqueio da operadora)'
                                        else ' (sem crédito na operadora)' end
                                || case when pausas.troncos >= voz_ativos then '. As ligações estão paradas.'
                                        else '. As ligações saem pelas outras rotas, mais devagar.' end,
                    'o_que_fazer', 'Peça à sua operadora para liberar a linha. Depois, a rota é retomada em Agente Voz/CX › Telefonia.',
                    'acao', 'telefonia');
            end if;
            if invalidos > 0 then
                probs := probs || jsonb_build_object('nivel', 'com_problema', 'motivo', 'tronco_invalido',
                    'problema', invalidos || case when invalidos = 1 then ' tronco, rota ou transferência com erro de configuração ficou de fora.'
                                                  else ' troncos, rotas ou transferências com erro de configuração ficaram de fora.' end,
                    'o_que_fazer', 'Confira endereço, porta e autenticação em Agente Voz/CX › Telefonia. A equipe MotorCX já recebeu o aviso.',
                    'acao', 'telefonia');
            end if;
            if voz.modo in ('simulado', 'teste') then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'voz_' || voz.modo,
                    'problema', case voz.modo when 'simulado' then 'Em simulação: nenhuma ligação de verdade.'
                                              else 'Só números de teste: os clientes ainda não recebem ligações.' end,
                    'o_que_fazer', 'A passagem para Real é feita com a equipe MotorCX, depois do checklist.', 'acao', 'agente_voz');
            end if;
            if sem_cadastro > 0 then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'rota_sem_cadastro',
                    'problema', 'Há ligações por uma rota sem cadastro de preço.',
                    'o_que_fazer', 'Cadastre a rota em Agente Voz/CX › Telefonia para o custo aparecer certo.', 'acao', 'telefonia');
            end if;
            if lv.freado then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'freio_abandono',
                    'problema', 'O lote de hoje foi freado por abandono.',
                    'o_que_fazer', 'Veja o lote em Agente Voz/CX › Ligações.', 'acao', 'ligacoes');
            end if;
            if c = 'discador' and curtas_pct is not null and curtas_pct >= 70 then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'chamadas_curtas',
                    'problema', 'Chamadas curtas em ' || replace(round(curtas_pct)::text, '.', ',')
                                || '% nos últimos 7 dias (o ritmo cai a partir de 70%; o corte é em 80%).',
                    'o_que_fazer', 'Veja as sugestões em Agente Voz/CX › Discagem › Chamadas curtas.', 'acao', 'discagem');
            end if;

            sinais := sinais
                || jsonb_build_object('chave', 'ligacoes_24h', 'rotulo', 'Ligações 24 h', 'tipo', 'numero', 'valor', vc.total,
                                      'detalhe', null, 'ruim', false)
                || jsonb_build_object('chave', 'atendidas_24h', 'rotulo', 'Atendidas', 'tipo', 'pct',
                                      'valor', case when vc.total >= 30 then round(100.0 * vc.atendidas / vc.total, 1) end,
                                      'detalhe', case when vc.total between 1 and 29 then 'poucas para medir' end, 'ruim', false);
            if c = 'discador' then
                sinais := sinais || jsonb_build_object('chave', 'transferidas_24h', 'rotulo', 'Transferidas', 'tipo', 'numero',
                    'valor', vc.transferidas,
                    'detalhe', case when vc.sem_operador > 0 then vc.sem_operador || ' sem operador livre' end, 'ruim', false);
            end if;
            sinais := sinais || jsonb_build_object('chave', 'lote_hoje', 'rotulo', 'Lote de hoje', 'tipo', 'pct',
                'valor', case when lv.total > 0 then round(100.0 * lv.encerradas / lv.total, 0) end,
                'detalhe', case when lv.lotes = 0 then 'sem lote hoje' when lv.ligando then 'ligando agora' end, 'ruim', false);
            if c = 'discador' and curtas_pct is not null then
                sinais := sinais || jsonb_build_object('chave', 'chamadas_curtas', 'rotulo', 'Chamadas curtas', 'tipo', 'pct',
                    'valor', curtas_pct, 'detalhe', '7 dias · ritmo cai em 70%', 'ruim', curtas_pct >= 70);
            end if;

        else
            -- ---------------------------------------------------- lista para baixar (fornecedor, AGV ou discador da empresa)
            select count(*) filter (where not f.reserva), min(f.data), count(*) > 0
              into n_lista, lista_ini, tem_lista
              from public.fila_dia f where f.empresa_id = empresa and f.data >= hoje - 10 and f.canal = c;
            if d_lista is not null then
                select count(*) filter (where not f.reserva) into n_lista
                  from public.fila_dia f where f.empresa_id = empresa and f.data = d_lista and f.canal = c;
            end if;
            select max(ma.visto_em) as visto, count(*) as mapeamentos into ret
              from public.mapeamento_arquivos ma where ma.empresa_id = empresa and ma.tipo = tipo_ret;
            select count(*) into n_cod from public.canal_codigos cc
             where cc.empresa_id = empresa and cc.canal = canal_cod and not cc.mapeado;
            ult := greatest(ret.visto, case when tem_lista then ult_exec end);

            if tem_lista then
                atraso := public.dias_uteis_entre(coalesce((ret.visto at time zone tz)::date, lista_ini), hoje);
                if atraso > 1 then
                    probs := probs || jsonb_build_object('nivel', 'com_problema', 'motivo', 'retorno_atrasado',
                        'problema', case when ret.visto is null
                                         then 'O retorno do fornecedor ainda não chegou nenhuma vez. Sem ele o MotorCX não sabe quem atendeu e repete as ações.'
                                         else 'O retorno do fornecedor não chega há ' || atraso || ' dias úteis (o último foi em '
                                              || to_char(ret.visto at time zone tz, 'DD/MM') || '). Sem ele o MotorCX não sabe quem atendeu e repete as ações.' end,
                        'o_que_fazer', 'Peça o arquivo de retorno ao fornecedor do canal, ou envie o arquivo em Cargas.',
                        'acao', 'enviar_retorno');
                end if;
            end if;
            if n_cod > 0 then
                probs := probs || jsonb_build_object('nivel', 'com_problema', 'motivo', 'codigos_sem_mapear',
                    'problema', n_cod || case when n_cod = 1 then ' código de retorno sem significado: o MotorCX não sabe o que ele quer dizer.'
                                              else ' códigos de retorno sem significado: o MotorCX não sabe o que eles querem dizer.' end,
                    'o_que_fazer', 'Diga o que cada código significa em Carteiras › (carteira) › Configurações › Canais.',
                    'acao', 'mapear_codigos');
            end if;
            if not tem_lista and ce.ativo is not false and d_lista is not null then
                probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'sem_lista',
                    'problema', 'Nenhum cliente saiu neste canal nos últimos 10 dias.',
                    'o_que_fazer', 'Confira se alguma estratégia usa o canal.', 'acao', 'estrategias');
            end if;

            sinais := sinais
                || jsonb_build_object('chave', 'ultima_lista', 'rotulo', 'Última lista', 'tipo', 'data_dia', 'valor', d_lista,
                                      'detalhe', case when d_lista is null then 'nenhuma' else n_lista || case when grupo = 'voz' then ' números' else ' clientes' end end,
                                      'ruim', false)
                || jsonb_build_object('chave', 'ultimo_retorno', 'rotulo', 'Último retorno', 'tipo', 'data', 'valor', ret.visto,
                                      'detalhe', case when ret.visto is null then 'nunca chegou' end,
                                      'ruim', coalesce(atraso > 1 and tem_lista, false))
                || jsonb_build_object('chave', 'codigos_sem_mapear', 'rotulo', 'Códigos sem mapear', 'tipo', 'numero',
                                      'valor', n_cod, 'detalhe', null, 'ruim', n_cod > 0);
            if c = 'discador' and curtas_pct is not null then
                sinais := sinais || jsonb_build_object('chave', 'chamadas_curtas', 'rotulo', 'Chamadas curtas', 'tipo', 'pct',
                    'valor', curtas_pct, 'detalhe', '7 dias · corte em 80%', 'ruim', curtas_pct >= 70);
                if curtas_pct >= 70 then
                    probs := probs || jsonb_build_object('nivel', 'atencao', 'motivo', 'chamadas_curtas',
                        'problema', 'Chamadas curtas em ' || replace(round(curtas_pct)::text, '.', ',')
                                    || '% nos últimos 7 dias (aviso em 70%; o corte é em 80%).',
                        'o_que_fazer', 'Veja as sugestões em Agente Voz/CX › Discagem › Chamadas curtas.', 'acao', 'discagem');
                end if;
            end if;
        end if;

        -- o mais grave vale; empate = o primeiro achado (a ordem acima é a de importância)
        p := null;
        select x into p from jsonb_array_elements(probs) with ordinality as t(x, i)
         order by (nivel_de ->> (x ->> 'nivel'))::int desc, i limit 1;
        est := coalesce(p ->> 'nivel', 'funcionando');
        resumo := resumo || jsonb_build_object(est, coalesce((resumo ->> est)::int, 0) + 1);
        saida := saida || jsonb_build_object(
            'canal', c, 'grupo', grupo, 'quem', quem, 'estado', est,
            'motivo', p ->> 'motivo', 'problema', p ->> 'problema', 'o_que_fazer', p ->> 'o_que_fazer',
            'acao', coalesce(p ->> 'acao', case quem when 'motorcx' then 'ver_envios' when 'voz_motorcx' then 'agente_voz'
                                                     else 'baixar_lista' end),
            'ultima_atividade', ult, 'sinais', sinais, 'problemas', probs);
    end loop;

    return jsonb_build_object('empresa_id', empresa, 'gerado_em', now(), 'hoje', hoje, 'resumo', resumo, 'canais', saida);
end $$;
revoke all on function public.estado_canais(bigint) from public, anon;
grant execute on function public.estado_canais(bigint) to authenticated;
comment on function public.estado_canais(bigint) is
    'Estado de cada canal da empresa (funcionando, atenção, com problema, não configurado, pausado), última atividade, '
    'sinais e o que fazer. Só agregados; pode_ver_empresa + editar_canais (ou equipe). SQL 84; pausado desde = pausado_em (SQL 86).';

-- ================================================================ 3. carteira muda a regra do canal com editar_canais
alter table public.credor_canais enable row level security;
drop policy if exists credor_canais_gravar on public.credor_canais;
create policy credor_canais_gravar on public.credor_canais for all to authenticated
    using (public.pode('editar_canais') and empresa_id in (select public.minhas_empresas()))
    with check (public.pode('editar_canais') and empresa_id in (select public.minhas_empresas()));
