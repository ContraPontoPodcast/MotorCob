-- SQL 132 · Agente de voz: a tela "Ofertas da carteira" (SPEC_OFERTAS_v2 §8; PR 3 do plano, o site).
--
-- painel_ofertas_voz(empresa, credor): tudo o que a tela mostra, numa chamada e SÓ com contagens e códigos (nunca um
-- cliente, um valor de oferta ou o corpo da resposta da API):
--   config     a fonte e a ordem em vigor (voz_mailing_config.ofertas da carteira; sem ela, a da empresa toda; null =
--              o padrão) e o rascunho da equipe (voz_ofertas_rascunho);
--   api        o conector da API (o da configuração; sem ele, o 1º "Buscar ofertas" ativo da empresa): nome, host,
--              situação, tempo máximo, nova tentativa e, nas últimas 24 h (crm_chamadas), chamadas, % que respondeu,
--              tempo médio e p95, falhas por tempo e por erro; estado: nao_configurada | sem_dados | no_ar | instavel
--              (as 3 últimas chamadas falharam em 5 min: a VM pula a API por 5 min, Q18) | fora (sem resposta boa há
--              15 min, com 6+ falhas);
--   uso        nas últimas 24 h (voz_ofertas_uso, SQL 131): ligações, por fonte (api, arquivo, nenhuma), reserva usada,
--              API pulada e ofertas descartadas por motivo;
--   carga      a última carga processada da carteira (envios.relatorio.ofertas_voz, só contagens) e quando;
--   alcada     a trava vigente (só leitura) e se existe (Q6: sem alçada nada passa);
--   pode       ativar (Admin do cliente, editar_orquestracao) e rascunho (+ equipe MotorCX que monta o fluxo).
-- Quem lê: quem vê a empresa (minhas_empresas). Depende dos SQL 58, 130 e 131. Pode rodar de novo.

create or replace function public.painel_ofertas_voz(empresa bigint, credor bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    cfg jsonb := public.ofertas_voz_vigente(empresa, credor);
    ras jsonb;
    con public.crm_conectores;
    api jsonb := null;
    uso jsonb;
    carga jsonb;
    alc public.voz_alcada_carteira;
    ult text[];
    estado text;
begin
    if not (empresa in (select public.minhas_empresas())) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    select jsonb_build_object('ofertas', r.ofertas, 'salvo_em', r.salvo_em) into ras
      from public.voz_ofertas_rascunho r where r.empresa_id = empresa and r.credor_id is not distinct from credor;
    select * into con from public.crm_conectores k
     where k.empresa_id = empresa and k.finalidade = 'buscar_ofertas'
       and (k.id = (cfg -> 'ofertas' ->> 'conector_id')::bigint or (cfg -> 'ofertas' ->> 'conector_id') is null)
     order by (k.id = (cfg -> 'ofertas' ->> 'conector_id')::bigint) desc nulls last, (k.situacao = 'ativo') desc, k.id
     limit 1;
    if con.id is not null then
        select array_agg(x.classe order by x.ocorrido_em desc) into ult
          from (select h.classe, h.ocorrido_em from public.crm_chamadas h
                 where h.conector_id = con.id and h.ocorrido_em > now() - interval '5 minutes'
                 order by h.ocorrido_em desc limit 3) x;
        select jsonb_build_object(
                   'chamadas', count(*),
                   'ok_pct', round(100.0 * count(*) filter (where h.classe = 'ok') / nullif(count(*), 0), 1),
                   'media_ms', round(avg(h.latencia_ms)),
                   'p95_ms', percentile_disc(0.95) within group (order by h.latencia_ms),
                   'falhas_tempo', count(*) filter (where h.classe = 'tempo'),
                   'falhas_erro', count(*) filter (where h.classe not in ('ok', 'tempo')),
                   'fora', count(*) filter (where h.ocorrido_em > now() - interval '15 minutes' and h.classe <> 'ok') >= 6
                           and count(*) filter (where h.ocorrido_em > now() - interval '15 minutes' and h.classe = 'ok') = 0)
          into api
          from public.crm_chamadas h
         where h.conector_id = con.id and h.ocorrido_em > now() - interval '24 hours';
        estado := case when (api ->> 'fora')::boolean then 'fora'
                       when cardinality(coalesce(ult, '{}')) = 3 and not ('ok' = any (ult)) then 'instavel'
                       when (api ->> 'chamadas')::int = 0 then 'sem_dados'
                       else 'no_ar' end;
        api := (api - 'fora') || jsonb_build_object(
            'conector_id', con.id, 'nome', con.nome, 'situacao', con.situacao,
            'host', substring(con.url from '^https://([^/:?#]+)'), 'timeout_ms', con.timeout_ms,
            'tentativas', con.tentativas, 'em_falha', con.em_falha,
            'mapeia_validade', exists (select 1 from jsonb_array_elements(con.mapa_saida) m where m ->> 'destino' = 'oferta.validade'),
            'estado', estado);
    end if;
    select jsonb_build_object(
               'ligacoes', count(*),
               'api', count(*) filter (where u.fonte = 'api'),
               'arquivo', count(*) filter (where u.fonte = 'arquivo'),
               'nenhuma', count(*) filter (where u.fonte is null),
               'reserva', count(*) filter (where u.fonte is not null and u.motivo <> 'primeira'),
               'api_pulada', count(*) filter (where u.pulou_api),
               'descartes', jsonb_build_object(
                   'incompleta', coalesce(sum((u.descartes ->> 'incompleta')::int), 0),
                   'vencida', coalesce(sum((u.descartes ->> 'vencida')::int), 0),
                   'acima_alcada', coalesce(sum((u.descartes ->> 'acima_alcada')::int), 0),
                   'conta', coalesce(sum((u.descartes ->> 'conta')::int), 0)))
      into uso
      from public.voz_ofertas_uso u
     where u.empresa_id = empresa and u.credor_id is not distinct from credor and u.registrado_em > now() - interval '24 hours';
    select jsonb_build_object('em', e.enviado_em, 'relatorio', e.relatorio -> 'ofertas_voz') into carga
      from public.envios e
     where e.empresa_id = empresa and e.credor_id is not distinct from credor and e.status = 'processado'
       and e.tipo in ('base', 'incremental')
     order by e.enviado_em desc, e.id desc limit 1;
    alc := public.alcada_voz_vigente(empresa, credor, null);
    return jsonb_build_object(
        'config', cfg, 'rascunho', ras, 'api', api, 'uso', uso, 'carga', carga,
        'alcada', case when alc.id is null then null else jsonb_build_object(
            'desconto_max_pct', alc.desconto_max_pct, 'parcelas_max', alc.parcelas_max, 'parcela_min', alc.parcela_min,
            'entrada_min', alc.entrada_min, 'credor_id', alc.credor_id) end,
        'pode', jsonb_build_object('ativar', public.pode_ativar_ofertas_voz(empresa),
                                   'rascunho', public.pode_rascunho_ofertas_voz(empresa)));
end $$;
comment on function public.painel_ofertas_voz(bigint, bigint) is
    'SQL 132: a tela Ofertas da carteira (config, rascunho, API 24 h, uso 24 h, última carga, alçada, permissões). Só '
    'contagens e códigos.';
revoke all on function public.painel_ofertas_voz(bigint, bigint) from public, anon;
grant execute on function public.painel_ofertas_voz(bigint, bigint) to authenticated;
