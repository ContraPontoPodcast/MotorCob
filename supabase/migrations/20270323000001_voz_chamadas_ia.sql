-- SQL 125 · Agente de voz por minuto falado: o minuto de IA de cada chamada, PR 3 do plano (SPEC §5.2, P2–P5, P7, P10
-- e as decisões do dono: a cobrança para no início da transferência, volta a contar quando o agente volta, cadência
-- uma vez por ligação sobre a soma dos trechos, máquina/caixa postal não paga, toque da ponte é custo nosso).
--
-- 1. voz_chamadas ganha no fim: ia_inicio_em, ia_fim_em, ia_retomada_em, ia_trechos (jsonb, até 5 trechos
--    [início, fim, motivo]), segundos_ia (falado com a IA, cobrável, 3 casas), segundos_sessao_ia (sessão do provedor,
--    custo; inclui o toque da ponte), segundos_ia_tarifados, cadencia_ia ('0/30/6' congelada), preco_minuto_ia,
--    valor_ia, cobranca_ia_id e ia_tarifada_em. O site lê (quem é da empresa, como as outras colunas); só o gatilho
--    escreve a tarifação.
-- 2. Gatilho novo tarifar_ia_chamada_voz (separado do tarifar_chamada_voz da telefonia, que não muda). No primeiro
--    registro com segundos_ia, lê o modelo que vale no início da IA (modelo_ia_voz/cobranca_ia_vigente) e CONGELA:
--      por minuto com contrato: segundos_tarifados_ia(segundos_ia, cadência do contrato) × preço do minuto de IA da
--        empresa no mês do ciclo (precos_empresa, voz_minuto_ia) ÷ 60, em 5 casas (o arredondamento é só no total da
--        fatura, P5);
--      licença: ceil(segundos_ia) sem cadência (P7) e valor nulo (quem cobra é a licença);
--      por minuto sem contrato (legado): os segundos com a cadência padrão, só informativos (preço e valor nulos): a
--        fatura de quem não tem o modelo novo não muda;
--      desfecho final máquina ou caixa postal: 0 s tarifados e R$ 0 (decisão do dono), também se o desfecho chegar
--        depois (só baixa para zero; nunca sobe).
--    minutos_ia = round(tarifados ÷ 60, 2), que as telas e os resumos já leem. Depois de ia_tarifada_em a tarifação
--    não muda (mudar direto dá o mesmo erro da telefonia); medição reenviada pela VM depois disso é ignorada.
-- 3. voz_vm.gravar_chamadas recriada inteira (estado atual: SQL 57/58/65) aceitando as chaves novas, com coalesce no
--    upsert. As chaves novas vão no INÍCIO de cada lista, para os trechos que o SQL 65 troca (pg_temp.trocar) continuarem
--    iguais e ele poder rodar de novo. A VM continua sem gravar as colunas da tarifação.
-- Depende dos SQL 56/57/58/65 (voz), 123 e 124. Pode rodar de novo. Sem chamada nova da VM (PR 4), nada muda.

-- ================================================================ 1. colunas
alter table public.voz_chamadas
    add column if not exists ia_inicio_em timestamptz,
    add column if not exists ia_fim_em timestamptz,
    add column if not exists ia_retomada_em timestamptz,
    add column if not exists ia_trechos jsonb,
    add column if not exists segundos_ia numeric(9, 3),
    add column if not exists segundos_sessao_ia numeric(9, 3),
    add column if not exists segundos_ia_tarifados int,
    add column if not exists cadencia_ia text,
    add column if not exists preco_minuto_ia numeric(10, 5),
    add column if not exists valor_ia numeric(12, 5),
    add column if not exists cobranca_ia_id bigint references public.voz_cobranca_ia (id) on delete set null,
    add column if not exists ia_tarifada_em timestamptz;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'voz_chamadas_ia_valores_check') then
        alter table public.voz_chamadas add constraint voz_chamadas_ia_valores_check
            check (segundos_ia >= 0 and segundos_sessao_ia >= 0 and segundos_ia_tarifados >= 0 and preco_minuto_ia >= 0
                   and valor_ia >= 0);
        alter table public.voz_chamadas add constraint voz_chamadas_ia_trechos_check
            check (ia_trechos is null or (jsonb_typeof(ia_trechos) = 'array' and jsonb_array_length(ia_trechos) <= 5));
        alter table public.voz_chamadas add constraint voz_chamadas_cadencia_ia_check
            check (cadencia_ia ~ '^[0-9]{1,2}/[0-9]{1,3}/[0-9]{1,3}$');
    end if;
end $$;
create index if not exists voz_chamadas_ia_tarifada on public.voz_chamadas (empresa_id, ia_inicio_em)
    where ia_tarifada_em is not null;
comment on column public.voz_chamadas.segundos_ia is
    'Segundos falados com a IA (soma dos trechos; para no início da transferência, volta quando o agente volta). SQL 125.';
comment on column public.voz_chamadas.segundos_sessao_ia is
    'Segundos da sessão do provedor de IA (custo nosso; inclui o toque da ponte até o humano atender). SQL 125.';

grant select (ia_inicio_em, ia_fim_em, ia_retomada_em, ia_trechos, segundos_ia, segundos_sessao_ia, segundos_ia_tarifados,
              cadencia_ia, preco_minuto_ia, valor_ia, cobranca_ia_id, ia_tarifada_em)
    on public.voz_chamadas to authenticated;

-- ================================================================ 2. tarifação do minuto de IA (congela)
create or replace function public.desfecho_maquina_voz(resultado text, resultado_ia text, amd text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
    select coalesce(resultado, resultado_ia) in ('maquina', 'caixa_postal') or coalesce(amd, '') = 'MACHINE'
$$;

create or replace function public.tarifar_ia_chamada_voz() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    momento timestamptz;
    dia date;
    mod text;
    cob public.voz_cobranca_ia;
    pad record;
    pv public.precos_empresa;
    seg numeric;
begin
    if tg_op = 'UPDATE' and old.ia_tarifada_em is not null then
        if (new.segundos_ia_tarifados, new.cadencia_ia, new.preco_minuto_ia, new.valor_ia, new.cobranca_ia_id,
            new.ia_tarifada_em)
           is distinct from (old.segundos_ia_tarifados, old.cadencia_ia, old.preco_minuto_ia, old.valor_ia,
                             old.cobranca_ia_id, old.ia_tarifada_em) then
            raise exception 'a tarifação do minuto de IA da chamada já foi feita e não muda';
        end if;
        -- a medição já tarifada não muda (reenvio da VM é ignorado)
        new.ia_inicio_em := old.ia_inicio_em; new.ia_fim_em := old.ia_fim_em;
        new.ia_retomada_em := old.ia_retomada_em; new.ia_trechos := old.ia_trechos;
        new.segundos_ia := old.segundos_ia; new.segundos_sessao_ia := old.segundos_sessao_ia;
        -- máquina/caixa postal que chega depois: só baixa para zero
        if public.desfecho_maquina_voz(new.resultado, new.resultado_ia, new.amd) and coalesce(old.segundos_ia_tarifados, 0) > 0 then
            new.segundos_ia_tarifados := 0;
            new.valor_ia := case when old.valor_ia is not null then 0 end;
            new.minutos_ia := 0;
        end if;
        return new;
    end if;
    if new.segundos_ia is null then
        return new;
    end if;
    momento := coalesce(new.ia_inicio_em, new.atendida_em, new.ocorrido_em);
    dia := (momento at time zone 'America/Sao_Paulo')::date;
    mod := public.modelo_ia_voz(new.empresa_id, momento);
    cob := public.cobranca_ia_vigente(new.empresa_id, momento);
    seg := case when public.desfecho_maquina_voz(new.resultado, new.resultado_ia, new.amd) then 0 else new.segundos_ia end;
    new.cobranca_ia_id := cob.id;
    if mod = 'licenca' then
        new.segundos_ia_tarifados := ceil(round(seg, 3))::int;
        new.cadencia_ia := null;
        new.preco_minuto_ia := null;
        new.valor_ia := null;
    elsif cob.id is not null then
        new.segundos_ia_tarifados := public.segundos_tarifados_ia(seg, cob.gratis_s, cob.inicial_s, cob.incremento_s);
        new.cadencia_ia := cob.gratis_s || '/' || cob.inicial_s || '/' || cob.incremento_s;
        pv := public.preco_vigente(new.empresa_id, 'voz_minuto_ia', public.competencia_de(new.empresa_id, dia));
        new.preco_minuto_ia := case when pv.modelo = 'flat' then pv.preco end;
        new.valor_ia := round(new.segundos_ia_tarifados * new.preco_minuto_ia / 60, 5);
    else
        pad := public.cadencia_ia_partes(coalesce((select c.cadencia_ia_padrao from public.voz_contrato c limit 1), '0/30/6'));
        new.segundos_ia_tarifados := public.segundos_tarifados_ia(seg, pad.gratis, pad.inicial, pad.incremento);
        new.cadencia_ia := pad.gratis || '/' || pad.inicial || '/' || pad.incremento;
        new.preco_minuto_ia := null;
        new.valor_ia := null;
    end if;
    new.minutos_ia := round(new.segundos_ia_tarifados / 60.0, 2);
    new.ia_tarifada_em := now();
    return new;
end $$;
drop trigger if exists tarifar_ia_chamada_voz on public.voz_chamadas;
create trigger tarifar_ia_chamada_voz before insert or update on public.voz_chamadas
    for each row execute function public.tarifar_ia_chamada_voz();
revoke all on function public.tarifar_ia_chamada_voz() from public, anon, authenticated;
revoke all on function public.desfecho_maquina_voz(text, text, text) from public, anon;
grant execute on function public.desfecho_maquina_voz(text, text, text) to authenticated, service_role;

-- ================================================================ 3. a VM grava os trechos
create or replace function voz_vm.gravar_chamadas(linhas jsonb) returns integer
language plpgsql security definer set search_path = '' as $f$
declare n int; fora text;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 5000 then
        raise exception 'linhas: lista de até 5000 chamadas';
    end if;
    if exists (select 1 from jsonb_array_elements(linhas) e where jsonb_typeof(e) <> 'object') then
        raise exception 'linhas: cada chamada é um objeto';
    end if;
    select string_agg(distinct k, ', ' order by k) into fora
      from jsonb_array_elements(linhas) e, jsonb_object_keys(e) k
     where k <> all (array['ia_inicio_em', 'ia_fim_em', 'ia_retomada_em', 'ia_trechos', 'segundos_ia', 'segundos_sessao_ia',
                           'empresa_id', 'credor_id', 'lote_id', 'onda_id', 'id_chamada', 'canal', 'id_cliente',
                           'id_acao', 'destino_mascara', 'destino_hash', 'tentativa', 'modo', 'provedor', 'conversa_ref',
                           'ocorrido_em', 'atendida_em', 'encerrada_em', 'duracao_s', 'billsec', 'causa_sip',
                           'causa_q850', 'dialstatus', 'amd', 'resultado_ia', 'resultado_operador', 'resultado',
                           'origem_resultado', 'destino', 'identidade_confirmada', 'transferencia', 'transferida_em',
                           'transferencia_id', 'minutos_ia', 'no_pico', 'tronco_id', 'tech_prefix', 'data_promessa',
                           'valor_promessa', 'retorno_em', 'roteiro_id', 'roteiro_versao', 'tem_gravacao',
                           'transcricao', 'fluxo_versao_id', 'bloco_final', 'passada', 'situacao_origem', 'resubmit_id']);
    if fora is not null then
        raise exception 'colunas que a VM não grava em voz_chamadas: %', fora;
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.voz_chamadas, linhas) r
                where r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id)) then
        raise exception 'empresa sem voz configurada';
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.voz_chamadas, linhas) r
                where (r.credor_id is not null and not exists (select 1 from public.credores k
                                                               where k.id = r.credor_id and k.empresa_id = r.empresa_id))
                   or (r.tronco_id is not null and not exists (select 1 from public.voz_troncos t
                                                               where t.id = r.tronco_id and t.empresa_id = r.empresa_id))
                   or (r.lote_id is not null and not exists (select 1 from public.voz_lotes l
                                                             where l.id = r.lote_id and l.empresa_id = r.empresa_id))
                   or (r.onda_id is not null and not exists (select 1 from public.voz_ondas o
                                                             where o.id = r.onda_id and o.empresa_id = r.empresa_id))
                   or (r.roteiro_id is not null and not exists (select 1 from public.voz_roteiros x
                                                                where x.id = r.roteiro_id and x.empresa_id = r.empresa_id))
                   or (r.transferencia_id is not null and not exists (select 1 from public.voz_transferencias x
                                                       where x.id = r.transferencia_id and x.empresa_id = r.empresa_id))
                   or (r.fluxo_versao_id is not null and not exists (select 1 from public.voz_fluxo_versoes x
                                                       where x.id = r.fluxo_versao_id and x.empresa_id = r.empresa_id))
                   or (r.resubmit_id is not null and not exists (select 1 from public.voz_resubmits x
                                                       where x.id = r.resubmit_id and x.empresa_id = r.empresa_id))) then
        raise exception 'referência de outra empresa';
    end if;
    insert into public.voz_chamadas as v (
        ia_inicio_em, ia_fim_em, ia_retomada_em, ia_trechos, segundos_ia, segundos_sessao_ia,
        empresa_id, credor_id, lote_id, onda_id, id_chamada, canal, id_cliente, id_acao, destino_mascara, destino_hash,
        tentativa, modo, provedor, conversa_ref, ocorrido_em, atendida_em, encerrada_em, duracao_s, billsec, causa_sip,
        causa_q850, dialstatus, amd, resultado_ia, resultado_operador, resultado, origem_resultado, destino,
        identidade_confirmada, transferencia, transferida_em, transferencia_id, minutos_ia, no_pico, tronco_id,
        tech_prefix, data_promessa, valor_promessa, retorno_em, roteiro_id, roteiro_versao, tem_gravacao, transcricao,
        fluxo_versao_id, bloco_final, passada, situacao_origem, resubmit_id)
    select r.ia_inicio_em, r.ia_fim_em, r.ia_retomada_em, r.ia_trechos, r.segundos_ia, r.segundos_sessao_ia,
           r.empresa_id, r.credor_id, r.lote_id, r.onda_id, r.id_chamada, coalesce(r.canal, 'agente_voz'), r.id_cliente,
           r.id_acao, r.destino_mascara, r.destino_hash, coalesce(r.tentativa, 1),
           coalesce(r.modo, (select c.modo from public.voz_config c where c.empresa_id = r.empresa_id), 'simulado'),
           r.provedor, r.conversa_ref, coalesce(r.ocorrido_em, now()), r.atendida_em, r.encerrada_em, r.duracao_s,
           r.billsec, r.causa_sip, r.causa_q850, r.dialstatus, r.amd, r.resultado_ia, r.resultado_operador, r.resultado,
           r.origem_resultado, r.destino, r.identidade_confirmada, r.transferencia, r.transferida_em,
           r.transferencia_id, r.minutos_ia, coalesce(r.no_pico, false), r.tronco_id, r.tech_prefix, r.data_promessa,
           r.valor_promessa, r.retorno_em, r.roteiro_id, r.roteiro_versao, coalesce(r.tem_gravacao, false), r.transcricao,
           r.fluxo_versao_id, r.bloco_final, r.passada, r.situacao_origem, r.resubmit_id
      from jsonb_populate_recordset(null::public.voz_chamadas, linhas) r
    on conflict (empresa_id, id_chamada, canal) do update set
        ia_inicio_em = coalesce(excluded.ia_inicio_em, v.ia_inicio_em), ia_fim_em = coalesce(excluded.ia_fim_em, v.ia_fim_em),
        ia_retomada_em = coalesce(excluded.ia_retomada_em, v.ia_retomada_em),
        ia_trechos = coalesce(excluded.ia_trechos, v.ia_trechos), segundos_ia = coalesce(excluded.segundos_ia, v.segundos_ia),
        segundos_sessao_ia = coalesce(excluded.segundos_sessao_ia, v.segundos_sessao_ia),
        credor_id = coalesce(excluded.credor_id, v.credor_id), lote_id = coalesce(excluded.lote_id, v.lote_id),
        onda_id = coalesce(excluded.onda_id, v.onda_id), id_cliente = excluded.id_cliente,
        id_acao = coalesce(excluded.id_acao, v.id_acao),
        destino_mascara = coalesce(excluded.destino_mascara, v.destino_mascara),
        destino_hash = coalesce(excluded.destino_hash, v.destino_hash), tentativa = excluded.tentativa,
        provedor = coalesce(excluded.provedor, v.provedor), conversa_ref = coalesce(excluded.conversa_ref, v.conversa_ref),
        atendida_em = coalesce(excluded.atendida_em, v.atendida_em),
        encerrada_em = coalesce(excluded.encerrada_em, v.encerrada_em),
        duracao_s = coalesce(excluded.duracao_s, v.duracao_s), billsec = coalesce(excluded.billsec, v.billsec),
        causa_sip = coalesce(excluded.causa_sip, v.causa_sip), causa_q850 = coalesce(excluded.causa_q850, v.causa_q850),
        dialstatus = coalesce(excluded.dialstatus, v.dialstatus), amd = coalesce(excluded.amd, v.amd),
        resultado_ia = coalesce(excluded.resultado_ia, v.resultado_ia),
        resultado_operador = coalesce(excluded.resultado_operador, v.resultado_operador),
        resultado = coalesce(excluded.resultado, v.resultado),
        origem_resultado = coalesce(excluded.origem_resultado, v.origem_resultado),
        destino = coalesce(excluded.destino, v.destino),
        identidade_confirmada = coalesce(excluded.identidade_confirmada, v.identidade_confirmada),
        transferencia = coalesce(excluded.transferencia, v.transferencia),
        transferida_em = coalesce(excluded.transferida_em, v.transferida_em),
        transferencia_id = coalesce(excluded.transferencia_id, v.transferencia_id),
        minutos_ia = coalesce(excluded.minutos_ia, v.minutos_ia), no_pico = excluded.no_pico or v.no_pico,
        tronco_id = coalesce(excluded.tronco_id, v.tronco_id), tech_prefix = coalesce(excluded.tech_prefix, v.tech_prefix),
        data_promessa = coalesce(excluded.data_promessa, v.data_promessa),
        valor_promessa = coalesce(excluded.valor_promessa, v.valor_promessa),
        retorno_em = coalesce(excluded.retorno_em, v.retorno_em), roteiro_id = coalesce(excluded.roteiro_id, v.roteiro_id),
        roteiro_versao = coalesce(excluded.roteiro_versao, v.roteiro_versao),
        tem_gravacao = excluded.tem_gravacao or v.tem_gravacao, transcricao = coalesce(excluded.transcricao, v.transcricao),
        fluxo_versao_id = coalesce(excluded.fluxo_versao_id, v.fluxo_versao_id),
        bloco_final = coalesce(excluded.bloco_final, v.bloco_final),
        passada = coalesce(excluded.passada, v.passada),
        situacao_origem = coalesce(excluded.situacao_origem, v.situacao_origem),
        resubmit_id = coalesce(excluded.resubmit_id, v.resubmit_id);
    get diagnostics n = row_count;
    return n;
end $f$;
revoke all on function voz_vm.gravar_chamadas(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.gravar_chamadas(jsonb) to motorcx_voz;
