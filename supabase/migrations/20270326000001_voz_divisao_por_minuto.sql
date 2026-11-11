-- SQL 128 · Agente de voz por minuto falado: limite de conversas na divisão do teto global, PR 7 do plano (SPEC §6,
-- F7, P9: o limite é teto duro, sem pico).
--
-- 1. divisao_concorrencia_voz() recriada INTEIRA (estado atual: SQL 101; mesma assinatura, então create or replace):
--      demanda(e) = min(limite de conversas do contrato por minuto vigente agora OU robôs da licença vigente hoje, canais)
--    Empresas por minuto entram como as licenciadas (proporcional só no overbooking, sobra pelo maior resto), com
--    motivo 'por_minuto' (ou 'teto'/'tronco', como antes). A coluna `licencas` traz a demanda contratada (robôs ou
--    limite). Só o legado sem nenhum dos dois divide a sobra pelos canais. O contrato por minuto ganha da licença (P8).
--    A view public.voz_divisao_concorrencia e voz_vm.divisao() leem a função e não mudam.
-- 2. voz_vm.config recriada (mesmas colunas): pico_multiplo = 1 também para quem está no por minuto (teto duro). Sem
--    funções de public na view (a VM não as executa).
-- 3. A equipe lê voz_contrato.cadencia_ia_padrao (SQL 123), para a tela da Contratação pré-preencher a cadência (a
--    policy de voz_contrato já limita à equipe; a coluna não tinha grant).
-- A VM não precisa de atualização: lê empresa_id e limite da divisão e o pico de voz_vm.config no próximo ciclo dela.
-- Se o SQL 56, 57, 98 ou 101 rodarem de novo, rode este depois. Depende dos SQL 101 e 123. Pode rodar de novo.

-- ================================================================ 1. a divisão com o limite do por minuto
create or replace function public.divisao_concorrencia_voz()
returns table (empresa_id bigint, canais int, contratado int, cota numeric, limite int, pico_multiplo int, teto int,
               licencas int, motivo text)
language sql stable security definer set search_path = public as $$
    with c as (select coalesce((select v.concorrencia_contratada from public.voz_contrato v where v.id), 0) as n),
    t as (select tr.empresa_id, sum(tr.canais)::int as canais from public.voz_troncos tr
           where tr.ativo group by tr.empresa_id),
    -- SQL 128: a demanda de cada empresa pelo modelo que vale agora: por minuto = limite de conversas do contrato;
    -- licença = robôs vigentes hoje (o contrato por minuto ganha da licença: P8)
    cv as (select distinct on (x.empresa_id) x.empresa_id, x.modelo, x.limite_conversas from public.voz_cobranca_ia x
            where x.vigente_desde <= now()
            order by x.empresa_id, x.vigente_desde desc, x.id desc),
    ll as (select distinct on (l.empresa_id) l.empresa_id, l.robos from public.voz_licencas l
            where l.vigente_desde <= public.hoje_sp()
            order by l.empresa_id, l.vigente_desde desc, l.id desc),
    lv as (select coalesce(cv.empresa_id, ll.empresa_id) as empresa_id,
                  case when cv.modelo = 'por_minuto' then cv.limite_conversas else ll.robos end as robos,
                  coalesce(cv.modelo = 'por_minuto', false) as por_minuto
             from cv full join ll on ll.empresa_id = cv.empresa_id),
    e as (select coalesce(t.empresa_id, lv.empresa_id) as empresa_id, coalesce(t.canais, 0) as canais,
                 lv.robos as licencas, coalesce(lv.robos, 0) > 0 as com_licenca, coalesce(lv.por_minuto, false) as por_minuto
            from t full join lv on lv.empresa_id = t.empresa_id
           where t.empresa_id is not null or lv.robos > 0),
    -- licenciadas: demanda usável, divisão proporcional só no overbooking
    d as (select e.empresa_id, e.canais, e.licencas, e.por_minuto, least(e.licencas, e.canais) as demanda
            from e where e.com_licenca),
    ds as (select coalesce(sum(d.demanda), 0) as total from d),
    dc as (select d.*, case when ds.total <= c.n then d.demanda::numeric
                            else c.n::numeric * d.demanda / ds.total end as cota
             from d cross join ds cross join c),
    df as (select dc.*, least(floor(dc.cota)::int, dc.demanda) as base, dc.cota - floor(dc.cota) as resto from dc),
    dk as (select greatest((select c.n from c) - coalesce(sum(df.base), 0), 0) as sobra from df),
    dr as (select df.empresa_id, row_number() over (order by df.resto desc, df.demanda desc, df.empresa_id) as ordem
             from df where df.base < df.demanda),
    dl as (select df.empresa_id, df.canais, df.licencas, df.por_minuto, df.demanda, df.cota,
                  least(df.base + case when dr.ordem <= dk.sobra then 1 else 0 end, df.demanda) as limite
             from df cross join dk left join dr on dr.empresa_id = df.empresa_id),
    -- sem licença: só a sobra do teto, pelos canais (a regra de antes)
    s as (select greatest((select c.n from c) - coalesce((select sum(dl.limite) from dl), 0), 0) as n),
    g as (select e.empresa_id, e.canais, e.licencas from e where not e.com_licenca),
    gs as (select sum(g.canais) as total from g),
    gc as (select g.*, coalesce(s.n::numeric * g.canais / nullif(gs.total, 0), 0) as cota
             from g cross join gs cross join s),
    gf as (select gc.*, least(floor(gc.cota)::int, gc.canais) as base, gc.cota - floor(gc.cota) as resto from gc),
    gk as (select greatest((select s.n from s) - coalesce(sum(gf.base), 0), 0) as sobra from gf),
    gr as (select gf.empresa_id, row_number() over (order by gf.resto desc, gf.canais desc, gf.empresa_id) as ordem
             from gf where gf.base < gf.canais),
    gl as (select gf.empresa_id, gf.canais, gf.licencas, gf.cota,
                  least(gf.base + case when gr.ordem <= gk.sobra then 1 else 0 end, gf.canais) as limite
             from gf cross join gk left join gr on gr.empresa_id = gf.empresa_id),
    f as (select dl.empresa_id, dl.canais, dl.cota, dl.limite, 1 as pico, dl.licencas,
                 case when dl.limite < dl.demanda then 'teto' when dl.canais < dl.licencas then 'tronco'
                      when dl.por_minuto then 'por_minuto' else 'licencas' end as motivo
            from dl
          union all
          select gl.empresa_id, gl.canais, gl.cota, gl.limite, coalesce(vc.pico_multiplo, 1), gl.licencas, 'legado'
            from gl left join public.voz_config vc on vc.empresa_id = gl.empresa_id),
    -- quem enxerga o teto global: o servidor, a VM e a equipe (o cliente nunca; para ele `teto` vira "limite
    -- temporário da plataforma" na tela)
    v as (select public.chamada_do_servidor() or public.chamada_da_vm_voz() or public.sou_equipe() as equipe)
    select f.empresa_id, f.canais,
           case when v.equipe then c.n end,
           case when v.equipe then round(f.cota, 4) end,
           f.limite, f.pico, least(f.limite * f.pico, f.canais), f.licencas, f.motivo
      from f cross join c cross join v
     where public.chamada_do_servidor() or public.chamada_da_vm_voz() or f.empresa_id in (select public.minhas_empresas())
$$;
comment on function public.divisao_concorrencia_voz() is
    'Divisão do teto global de voz (voz_contrato) por empresa: contratadas primeiro (robôs da licença ou limite de '
    'conversas do por minuto, min com os canais; proporcional no overbooking), a sobra para o legado pelos canais. '
    'motivo: licencas|por_minuto|tronco|teto|legado. SQL 101 e 128.';
revoke all on function public.divisao_concorrencia_voz() from public, anon;
grant execute on function public.divisao_concorrencia_voz() to authenticated, service_role;

-- ================================================================ 2. sem pico no por minuto
create or replace view voz_vm.config with (security_barrier = true) as
    select c.empresa_id, c.provedor, c.modo, c.agent_id, c.voz_id, c.numeros_teste_hash,
           case when coalesce((select l.robos from public.voz_licencas l
                                where l.empresa_id = c.empresa_id
                                  and l.vigente_desde <= (now() at time zone 'America/Sao_Paulo')::date
                                order by l.vigente_desde desc, l.id desc limit 1), 0) > 0
                     or coalesce((select x.modelo from public.voz_cobranca_ia x
                                   where x.empresa_id = c.empresa_id and x.vigente_desde <= now()
                                   order by x.vigente_desde desc, x.id desc limit 1), '') = 'por_minuto'
                then 1 else c.pico_multiplo end as pico_multiplo,
           c.alo_fake_liberado, c.bucket_gravacoes, c.alo_fake, c.alo_fake_max_s, c.alo_fake_audio_ref,
           c.abandono_max_pct, c.freio_ritmo_pct, c.variaveis, c.gravar, c.aviso_gravacao, c.retencao_dias,
           c.transcrever, c.transcrever_min_segundos, c.atualizado_em
      from public.voz_config c;
revoke all on voz_vm.config from public, anon, authenticated, service_role;
grant select on voz_vm.config to motorcx_voz;

-- ================================================================ 3. cadência padrão para a tela da Contratação
grant select (cadencia_ia_padrao) on public.voz_contrato to authenticated;
