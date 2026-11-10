-- SQL 98 · Agente de voz: robôs contratados (licenças) na fatura, PR 2 do plano "Robôs contratados" (SPEC aprovada
-- pelo dono com os padrões recomendados). Lê o que o SQL 93 grava em voz_licencas; quem não tem licença não muda nada.
--
-- 1. previa_fatura (e por ela gerar_rascunhos, fechar_fatura e a estimativa do ciclo) recriada INTEIRA a partir da
--    versão em produção (SQL 69 + trecho do SQL 78), com o item voz_licenca_robo lido de voz_licencas e não de
--    precos_empresa (o preço gravado lá pelo SQL 93 vale o mês inteiro; a licença tem o dia exato):
--    * ciclo cheio: a licença que vale no 1º dia do ciclo (por robô: robôs × preço; valor fechado: o total do mês);
--    * mudança no meio do ciclo (aumento "agora", troca de preço ou contrato que começa no meio): linha "ajuste pro
--      rata" = (total novo − total anterior) × dias restantes ÷ dias do ciclo, contando o dia da mudança. Somadas, as
--      linhas dão o valor de cada vigência pelos dias em que ela valeu. Troca de preço para baixo "agora" vira ajuste
--      negativo (crédito) pelos dias restantes. Duas gravações no mesmo dia: vale a última (id), como no SQL 93.
--    * franquia do voz_minuto_ia vinda da licença: Σ robôs × franquia_min_robo pelos dias de cada vigência (ciclo
--      cheio = robôs × franquia). Linha "franquia de N min, incluída nos robôs" (sempre, mesmo sem uso) e o excedente
--      = max(0, minutos de IA + minutos de pico − franquia) × preço do voz_minuto_ia (valor_item: flat/faixa/
--      progressivo). Com licença, o mínimo mensal do voz_minuto_ia não vale (a licença é o compromisso do mês).
--    * com licença no ciclo (alguma vigência com robôs > 0): voz_plataforma sai (linha zerada "incluída nos robôs",
--      se a empresa tem preço); voz_transcricao sai se a licença inclui transcrição (linha zerada com os minutos);
--      voz_minuto_ia_pico não é cobrado a 2× (os minutos de pico entram no minuto de IA, contra a franquia).
--      gestao_tronco_sip, ia_speech_analytics e o resto seguem iguais. Telefonia continua fora (consumo_voz).
--    * itens das linhas novas (fatura_itens tem chave (fatura_id, item)): voz_licenca_robo, voz_licenca_robo_ajuste,
--      voz_licenca_robo_ajuste_2..., voz_minuto_ia_franquia e voz_minuto_ia.
-- 2. Pico desligado para quem tem licença vigente hoje (America/Sao_Paulo) com robôs > 0: divisao_concorrencia_voz()
--    recriada inteira (mesma assinatura: pico_multiplo = 1 e teto = limite para essas empresas; legado igual) e a view
--    voz_vm.config recriada com pico_multiplo = 1 para elas (a VM lê o pico dali: voz/banco.py). O motor não muda.
--    voz_config.pico_multiplo guardado não é apagado (volta a valer se a licença chegar a 0 robôs).
-- 3. Funções novas (security definer, só o servidor e as funções da fatura chamam): licenca_voz_ciclo(empresa, mes),
--    linhas_fatura_licenca_voz(empresa, mes, posicao), linhas_fatura_minuto_ia_voz(empresa, mes, posicao, franquia).
-- Recriadas inteiras: previa_fatura, divisao_concorrencia_voz e voz_vm.config. Se o SQL 56, 57, 69 ou 78 (ou as
-- migrações antigas de fatura) rodarem de novo, rode este depois. Depende dos SQL 56/57 (voz), 69/78 (fatura) e 93
-- (licenças). Pode rodar de novo.

-- ================================================================ 1. a licença num ciclo
-- inicio/fim/dias do ciclo; tem = alguma vigência com robôs > 0 no ciclo; franquia = Σ robôs × franquia pelos dias;
-- transcricao = alguma vigência com robôs > 0 inclui transcrição; robos_fim = robôs no último dia do ciclo
create or replace function public.licenca_voz_ciclo(empresa bigint, mes date,
    out inicio date, out fim date, out dias int, out tem boolean, out franquia bigint, out transcricao boolean,
    out robos_fim int)
returns record
language plpgsql stable security definer set search_path = public as $$
declare
    cic record;
begin
    cic := public.ciclo_de(licenca_voz_ciclo.empresa, licenca_voz_ciclo.mes);
    inicio := cic.inicio;
    fim := cic.fim;
    dias := fim - inicio + 1;
    select coalesce(bool_or(s.robos > 0), false),
           coalesce(round(sum(s.robos::numeric * s.franquia_min_robo * s.nd) / dias), 0)::bigint,
           coalesce(bool_or(s.robos > 0 and s.transcricao_inclusa), false)
      into tem, franquia, transcricao
      from public.segmentos_licenca_voz(licenca_voz_ciclo.empresa, inicio, fim) s
     where s.nd > 0;
    robos_fim := coalesce((public.licenca_voz_em(licenca_voz_ciclo.empresa, fim)).robos, 0);
end $$;

-- vigências que valem dentro de [ini, fim]: a que vale no 1º dia e as que começam depois, com os dias de cada uma
-- (nd = 0 quando outra gravação do mesmo dia a substitui)
create or replace function public.segmentos_licenca_voz(empresa bigint, ini date, fim date)
returns table (id bigint, de date, ate date, nd int, robos int, modelo text, preco_robo numeric, valor_fechado numeric,
               total numeric, franquia_min_robo int, transcricao_inclusa boolean)
language sql stable security definer set search_path = public as $$
    with l as (
        select x.* from public.voz_licencas x
         where x.empresa_id = segmentos_licenca_voz.empresa
           and (x.id = (public.licenca_voz_em(segmentos_licenca_voz.empresa, segmentos_licenca_voz.ini)).id
                or x.vigente_desde > segmentos_licenca_voz.ini and x.vigente_desde <= segmentos_licenca_voz.fim)
    ), s as (
        select l.*, greatest(l.vigente_desde, segmentos_licenca_voz.ini) as d0,
               coalesce(lead(greatest(l.vigente_desde, segmentos_licenca_voz.ini)) over w - 1,
                        segmentos_licenca_voz.fim) as d1
          from l window w as (order by l.vigente_desde, l.id)
    )
    select s.id, s.d0, s.d1, greatest(s.d1 - s.d0 + 1, 0), s.robos, s.modelo, s.preco_robo, s.valor_fechado,
           case when s.modelo = 'valor_fechado' then s.valor_fechado else s.robos * s.preco_robo end,
           s.franquia_min_robo, s.transcricao_inclusa
      from s order by s.d0, s.id
$$;

-- ================================================================ 2. linhas da licença e do minuto de IA
create or replace function public.linhas_fatura_licenca_voz(empresa bigint, mes date, posicao int)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    c record;
    s record;
    tem_ant boolean := false;      -- já passou por uma vigência com dias no ciclo
    a_total numeric := 0;
    a_robos int := 0;
    a_modelo text;
    a_preco numeric;
    n int := 0;
    rest int;
    nome text := coalesce((select i.nome from public.cobranca_itens i where i.codigo = 'voz_licenca_robo'),
                          'Agente virtual · robôs (licenças)');
begin
    c := public.licenca_voz_ciclo(linhas_fatura_licenca_voz.empresa, linhas_fatura_licenca_voz.mes);
    for s in select * from public.segmentos_licenca_voz(linhas_fatura_licenca_voz.empresa, c.inicio, c.fim) x
              where x.nd > 0 order by x.de, x.id loop
        if not tem_ant and s.de = c.inicio then          -- ciclo cheio: a licença do 1º dia
            if s.robos > 0 then
                if s.modelo = 'valor_fechado' then
                    return query select posicao, 'voz_licenca_robo'::text,
                        nome || ' · valor fechado, ' || s.robos || case when s.robos = 1 then ' robô' else ' robôs' end,
                        1::numeric, s.valor_fechado, round(s.valor_fechado, 2);
                else
                    return query select posicao, 'voz_licenca_robo'::text,
                        nome || ' · ' || s.robos || case when s.robos = 1 then ' robô' else ' robôs' end,
                        s.robos::numeric, s.preco_robo, round(s.robos * s.preco_robo, 2);
                end if;
            end if;
        elsif s.total <> a_total then   -- mudança no meio do ciclo: pro rata
            n := n + 1;
            rest := c.fim - s.de + 1;
            return query select posicao, 'voz_licenca_robo_ajuste' || case when n > 1 then '_' || n else '' end,
                nome || ' · ' || case when not tem_ant then 'início em ' || to_char(s.de, 'DD/MM') || ', '
                                                       || s.robos || case when s.robos = 1 then ' robô' else ' robôs' end
                                      when a_robos <> s.robos then 'ajuste pro rata: de ' || a_robos || ' para '
                                                       || s.robos || ' robôs desde ' || to_char(s.de, 'DD/MM')
                                      else 'ajuste pro rata: preço novo desde ' || to_char(s.de, 'DD/MM') end
                     || ' (' || rest || ' de ' || c.dias || ' dias)',
                case when tem_ant and a_modelo = 'por_robo' and s.modelo = 'por_robo' and a_preco = s.preco_robo
                     then round((s.robos - a_robos)::numeric * rest / c.dias, 4)
                     else round(rest::numeric / c.dias, 4) end,
                case when tem_ant and a_modelo = 'por_robo' and s.modelo = 'por_robo' and a_preco = s.preco_robo
                     then s.preco_robo else s.total - a_total end,
                round((s.total - a_total) * rest / c.dias, 2);
        end if;
        tem_ant := true;
        a_total := s.total;
        a_robos := s.robos;
        a_modelo := s.modelo;
        a_preco := s.preco_robo;
    end loop;
end $$;

-- minuto de IA de quem tem licença: franquia incluída (sempre aparece) e o excedente (minutos de pico contam junto)
create or replace function public.linhas_fatura_minuto_ia_voz(empresa bigint, mes date, posicao int, franquia bigint)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    usados numeric;
    exc numeric;
    v record;
    fr bigint := coalesce(linhas_fatura_minuto_ia_voz.franquia, 0);
    nome text := coalesce((select i.nome from public.cobranca_itens i where i.codigo = 'voz_minuto_ia'),
                          'Agente virtual · minuto de IA');
begin
    select coalesce(sum(m.quantidade), 0) into usados from public.consumo_mensageria m
     where m.empresa_id = linhas_fatura_minuto_ia_voz.empresa and m.competencia = linhas_fatura_minuto_ia_voz.mes
       and m.item in ('voz_minuto_ia', 'voz_minuto_ia_pico');
    exc := greatest(0, usados - fr);
    return query select posicao, 'voz_minuto_ia_franquia'::text,
        nome || ' · ' || replace(to_char(least(usados, fr), 'FM999,999,999,990'), ',', '.') || ' de '
             || replace(to_char(fr, 'FM999,999,999,990'), ',', '.') || ' min da franquia (incluída nos robôs)',
        least(usados, fr)::numeric, 0::numeric, 0::numeric;
    if exc = 0 then
        return;
    end if;
    select * into v from public.valor_item(linhas_fatura_minuto_ia_voz.empresa, 'voz_minuto_ia', exc,
                                           linhas_fatura_minuto_ia_voz.mes);
    if v.valor is null then
        return query select posicao, 'voz_minuto_ia'::text, nome || ' · excedente da franquia · sem preço cadastrado',
                            exc, 0::numeric, 0::numeric;
        return;
    end if;
    return query select posicao, 'voz_minuto_ia'::text,
        nome || ' · excedente da franquia · ' || replace(to_char(exc, 'FM999,999,999,990'), ',', '.') || ' min'
             || coalesce(' (' || v.detalhe || ')', ''),
        exc, v.preco_medio, v.valor;
end $$;

-- ================================================================ 3. previa_fatura (recriada inteira)
create or replace function public.previa_fatura(empresa bigint, competencia date)
returns table (ordem int, item text, descricao text, quantidade numeric, preco numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
    mes date := public.competencia_de(empresa, competencia);
    c record;
    v record;
    qtd numeric;
    qtd_extra numeric;
    pv public.precos_empresa;
    codigo_fatura text;
    nome text;
    lic record;
begin
    if auth.uid() is not null and not public.ve_faturamento(empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    lic := public.licenca_voz_ciclo(empresa, mes);      -- SQL 98: robôs contratados (licenças) no ciclo
    for c in select ci.* from public.cobranca_itens ci where ci.preco_de is null order by ci.ordem, ci.codigo loop
        qtd_extra := 0;
        if c.codigo = 'ia_creditos' then   -- SQL 78: franquia incluída + excedente
            return query select * from public.linhas_fatura_creditos_ia(empresa, mes, c.ordem);
            continue;
        end if;
        if c.codigo = 'voz_licenca_robo' then   -- SQL 98: da licença (dia exato e pro rata), nunca de precos_empresa
            return query select * from public.linhas_fatura_licenca_voz(empresa, mes, c.ordem);
            continue;
        end if;
        if lic.tem then                          -- SQL 98: o que a licença inclui
            if c.codigo = 'voz_minuto_ia' then
                return query select * from public.linhas_fatura_minuto_ia_voz(empresa, mes, c.ordem, lic.franquia);
                continue;
            elsif c.codigo = 'voz_minuto_ia_pico' then   -- sem pico para quem tem licença: conta no minuto de IA
                continue;
            elsif c.codigo = 'voz_plataforma' then
                if (public.preco_vigente(empresa, c.codigo, mes)).id is not null then
                    return query select c.ordem, c.codigo, c.nome || ' · incluída nos robôs (licenças)', 1::numeric,
                                        0::numeric, 0::numeric;
                end if;
                continue;
            elsif c.codigo = 'voz_transcricao' and lic.transcricao then
                select coalesce(sum(m.quantidade), 0) into qtd from public.consumo_mensageria m
                 where m.empresa_id = empresa and m.competencia = mes and m.item = c.codigo;
                if qtd > 0 then
                    return query select c.ordem, c.codigo,
                        c.nome || ' · ' || replace(to_char(qtd, 'FM999,999,999,990'), ',', '.')
                               || ' min (incluída nos robôs)', qtd, 0::numeric, 0::numeric;
                end if;
                continue;
            end if;
        end if;
        if c.codigo = 'contratos' then
            qtd := (public.orquestracao_medicao(empresa, mes)).quantidade;   -- SQL 69: CPFs ativos no ciclo
        elsif c.codigo = 'jornada_clientes' then
            select count(*) into qtd from public.jornada_clientes_mes m
             where m.empresa_id = empresa and m.competencia = mes;
        else
            select coalesce(sum(m.quantidade), 0) into qtd from public.consumo_mensageria m
             where m.empresa_id = empresa and m.competencia = mes and m.item = c.codigo;
            select coalesce(sum(m.quantidade), 0) into qtd_extra from public.consumo_mensageria m
              join public.cobranca_itens x on x.codigo = m.item and x.preco_de = c.codigo
             where m.empresa_id = empresa and m.competencia = mes;
        end if;
        pv := public.preco_vigente(empresa, c.codigo, mes);
        codigo_fatura := case when c.codigo = 'contratos' then 'orquestracao'
                              when c.codigo = 'jornada_clientes' then 'jornada' else c.codigo end;
        nome := case when c.codigo = 'contratos' then 'Orquestração' else c.nome end;
        if pv.id is null then
            if qtd + qtd_extra > 0 then        -- consumo sem preço cadastrado: aparece zerado para a equipe ver
                return query select c.ordem, codigo_fatura, nome || ' · sem preço cadastrado', qtd + qtd_extra,
                                    0::numeric, 0::numeric;
            end if;
            continue;
        end if;
        if pv.modelo = 'mensalidade' then
            if c.modulo is null or exists (select 1 from public.empresa_modulos em where em.empresa_id = empresa
                                           and em.modulo = c.modulo and em.ativo) then
                return query select c.ordem, codigo_fatura, nome || ' · mensalidade', 1::numeric, pv.preco,
                                    round(pv.preco, 2);
            end if;
            continue;
        end if;
        if qtd + qtd_extra = 0 and pv.minimo = 0 then
            continue;
        end if;
        select * into v from public.valor_item(empresa, c.codigo, qtd + qtd_extra, mes);
        return query select c.ordem, codigo_fatura,
            nome || case when c.codigo = 'contratos' and (public.orquestracao_medicao(empresa, mes)).por_cpf
                              then ' · CPFs ativos no mês'
                         when c.codigo = 'contratos'
                              then ' · contratos no ciclo (medição anterior à cobrança por CPF)'
                         when c.codigo = 'jornada_clientes' then ' · clientes acionados no ciclo'
                         when qtd_extra > 0 then ' · ' || qtd || ' envios + ' || qtd_extra || ' respostas'
                         else '' end
                 || coalesce(' (' || v.detalhe || ')', ''),
            qtd + qtd_extra, v.preco_medio, v.valor;
        if v.minimo > v.valor then
            return query select c.ordem + 1000, codigo_fatura || '_minimo',
                                nome || ' · complemento do mínimo mensal', 1::numeric, v.minimo - v.valor,
                                v.minimo - v.valor;
        end if;
    end loop;
end $$;

-- ================================================================ 4. pico desligado para quem tem licença
-- SQL 56/57 recriada inteira: empresa com licença vigente hoje (robôs > 0) fica com pico 1 (teto = limite)
create or replace function public.divisao_concorrencia_voz()
returns table (empresa_id bigint, canais int, contratado int, cota numeric, limite int, pico_multiplo int, teto int)
language sql stable security definer set search_path = public as $$
    with c as (select v.concorrencia_contratada as n from public.voz_contrato v where v.id),
    t as (select tr.empresa_id, sum(tr.canais)::int as canais from public.voz_troncos tr
           where tr.ativo group by tr.empresa_id),
    s as (select sum(t.canais) as total from t),
    b as (select t.empresa_id, t.canais, coalesce(c.n, 0) as n,
                 coalesce(c.n, 0)::numeric * t.canais / nullif(s.total, 0) as cota
            from t cross join s left join c on true),
    f as (select b.*, least(floor(b.cota)::int, b.canais) as base, b.cota - floor(b.cota) as resto from b),
    k as (select greatest(coalesce(max(f.n), 0) - coalesce(sum(f.base), 0), 0) as sobra from f),
    r as (select f.empresa_id, row_number() over (order by f.resto desc, f.canais desc, f.empresa_id) as ordem
            from f where f.base < f.canais),
    p as (select f.empresa_id,
                 case when coalesce((select l.robos from public.voz_licencas l
                                      where l.empresa_id = f.empresa_id and l.vigente_desde <= public.hoje_sp()
                                      order by l.vigente_desde desc, l.id desc limit 1), 0) > 0
                      then 1 else coalesce(vc.pico_multiplo, 1) end as pico     -- SQL 98: licença = sem pico
            from f left join public.voz_config vc on vc.empresa_id = f.empresa_id)
    select f.empresa_id, f.canais, f.n, round(f.cota, 4),
           least(f.base + case when r.ordem <= k.sobra then 1 else 0 end, f.canais) as limite,
           p.pico,
           least((f.base + case when r.ordem <= k.sobra then 1 else 0 end) * p.pico, f.canais)
      from f cross join k
      left join r on r.empresa_id = f.empresa_id
      join p on p.empresa_id = f.empresa_id
     where public.chamada_do_servidor() or public.chamada_da_vm_voz() or f.empresa_id in (select public.minhas_empresas())
$$;

-- SQL 57 recriada inteira: a VM lê o pico daqui (voz/banco.py); com licença vigente hoje e robôs > 0, pico = 1.
-- A data de hoje vai escrita (não hoje_sp()): a VM (motorcx_voz) não executa funções de public.
create or replace view voz_vm.config with (security_barrier = true) as
    select c.empresa_id, c.provedor, c.modo, c.agent_id, c.voz_id, c.numeros_teste_hash,
           case when coalesce((select l.robos from public.voz_licencas l
                                where l.empresa_id = c.empresa_id
                                  and l.vigente_desde <= (now() at time zone 'America/Sao_Paulo')::date
                                order by l.vigente_desde desc, l.id desc limit 1), 0) > 0
                then 1 else c.pico_multiplo end as pico_multiplo,
           c.alo_fake_liberado, c.bucket_gravacoes, c.alo_fake, c.alo_fake_max_s, c.alo_fake_audio_ref,
           c.abandono_max_pct, c.freio_ritmo_pct, c.variaveis, c.gravar, c.aviso_gravacao, c.retencao_dias,
           c.transcrever, c.transcrever_min_segundos, c.atualizado_em
      from public.voz_config c;

-- ================================================================ 5. permissões
revoke all on function public.licenca_voz_ciclo(bigint, date), public.segmentos_licenca_voz(bigint, date, date),
    public.linhas_fatura_licenca_voz(bigint, date, int), public.linhas_fatura_minuto_ia_voz(bigint, date, int, bigint)
    from public, anon, authenticated;
grant execute on function public.licenca_voz_ciclo(bigint, date), public.segmentos_licenca_voz(bigint, date, date),
    public.linhas_fatura_licenca_voz(bigint, date, int), public.linhas_fatura_minuto_ia_voz(bigint, date, int, bigint)
    to service_role;
revoke execute on function public.previa_fatura(bigint, date) from public, anon;
grant execute on function public.previa_fatura(bigint, date) to authenticated, service_role;
