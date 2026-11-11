-- SQL 101 · Agente de voz: robôs contratados (licenças) na divisão do teto global, PR 4 do plano "Robôs contratados"
-- (SPEC aprovada pelo dono com os padrões recomendados, §4.1). 1 robô = 1 conversa ao mesmo tempo com a IA; desde o
-- PR 212 (SQL 91) a VM conta CONVERSAS (robôs ocupados + reservados) contra o `limite` que sai daqui.
--
-- 1. divisao_concorrencia_voz() recriada INTEIRA (estado atual: SQL 56 + troca do 57 + pico do 98) com as licenças:
--      demanda(e) = min(robôs vigentes hoje, canais dos troncos ativos)          empresas com licença (robôs > 0)
--      Σ demanda ≤ contratado: limite = demanda
--      senão (overbooking):    limite = floor(contratado × demanda ÷ Σ demanda), a sobra uma a uma para as maiores
--                              frações (empate: mais demanda, depois o menor id); nunca acima da demanda
--      sobra = contratado − Σ limite das licenciadas
--      sem licença (transição, ou licença com 0 robôs): dividem SÓ a sobra pelos canais, como antes (maior resto; empate:
--                              mais canais, depois o menor id), nunca acima dos canais
--      motivo = 'teto' (limite < demanda) | 'tronco' (canais < licenças) | 'licencas' | 'legado' (sem licença)
--      teto = limite para quem tem licença (pico desligado, SQL 98); legado: min(limite × pico_multiplo, canais)
--    Colunas novas NO FIM: licencas (robôs vigentes hoje; nulo = nenhuma licença) e motivo. Empresa com licença e sem
--    tronco ativo aparece com canais 0, limite 0 e motivo 'tronco' (antes não aparecia; a VM já tratava como 0).
--    Quem não é da equipe (cliente) não vê o teto global: `contratado` e `cota` vêm nulos para ele (antes vinham).
--    Como o retorno muda, `create or replace` não basta: drop cascade e recriar a função, a view
--    public.voz_divisao_concorrencia, voz_vm.divisao() e a view voz_vm.divisao_concorrencia, com os mesmos grants.
--    O motor/VM lê só empresa_id e limite (voz/configuracao.py; colunas a mais são ignoradas); a VM continua com pico 1
--    para licenciadas pela view voz_vm.config (SQL 98, não depende da divisão e não muda aqui).
-- 2. definir_concorrencia_contratada(n) avisa (não bloqueia) quando o teto novo fica abaixo dos robôs vendidos hoje:
--    aviso para a equipe (sino, link /console/voz) quando a mudança diminui o teto e ele fica abaixo do vendido. A tela
--    do Console pede confirmação antes. Mesma assinatura (devolve void).
-- Recriadas inteiras: divisao_concorrencia_voz, voz_vm.divisao, as duas views e definir_concorrencia_contratada.
-- Se o SQL 56, 57 ou 98 rodarem de novo, rode este depois (eles recriam a divisão sem as licenças; desde este SQL eles
-- conferem a assinatura antes, para rodar de novo sem erro). Depende dos SQL 56/57 (voz), 91 (conversas, PR 212) e
-- 93 (licenças). Pode rodar de novo.

-- ================================================================ 1. a divisão com as licenças
drop function if exists public.divisao_concorrencia_voz() cascade;   -- leva public.voz_divisao_concorrencia
drop function if exists voz_vm.divisao() cascade;                    -- leva voz_vm.divisao_concorrencia

create function public.divisao_concorrencia_voz()
returns table (empresa_id bigint, canais int, contratado int, cota numeric, limite int, pico_multiplo int, teto int,
               licencas int, motivo text)
language sql stable security definer set search_path = public as $$
    with c as (select coalesce((select v.concorrencia_contratada from public.voz_contrato v where v.id), 0) as n),
    t as (select tr.empresa_id, sum(tr.canais)::int as canais from public.voz_troncos tr
           where tr.ativo group by tr.empresa_id),
    lv as (select distinct on (l.empresa_id) l.empresa_id, l.robos from public.voz_licencas l
            where l.vigente_desde <= public.hoje_sp()
            order by l.empresa_id, l.vigente_desde desc, l.id desc),
    e as (select coalesce(t.empresa_id, lv.empresa_id) as empresa_id, coalesce(t.canais, 0) as canais,
                 lv.robos as licencas, coalesce(lv.robos, 0) > 0 as com_licenca
            from t full join lv on lv.empresa_id = t.empresa_id
           where t.empresa_id is not null or lv.robos > 0),
    -- licenciadas: demanda usável, divisão proporcional só no overbooking
    d as (select e.empresa_id, e.canais, e.licencas, least(e.licencas, e.canais) as demanda from e where e.com_licenca),
    ds as (select coalesce(sum(d.demanda), 0) as total from d),
    dc as (select d.*, case when ds.total <= c.n then d.demanda::numeric
                            else c.n::numeric * d.demanda / ds.total end as cota
             from d cross join ds cross join c),
    df as (select dc.*, least(floor(dc.cota)::int, dc.demanda) as base, dc.cota - floor(dc.cota) as resto from dc),
    dk as (select greatest((select c.n from c) - coalesce(sum(df.base), 0), 0) as sobra from df),
    dr as (select df.empresa_id, row_number() over (order by df.resto desc, df.demanda desc, df.empresa_id) as ordem
             from df where df.base < df.demanda),
    dl as (select df.empresa_id, df.canais, df.licencas, df.demanda, df.cota,
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
                      else 'licencas' end as motivo
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
    'Divisão do teto global de voz (voz_contrato) por empresa: licenças primeiro (min(robôs, canais), proporcional no '
    'overbooking), a sobra para quem não tem licença pelos canais. motivo: licencas|tronco|teto|legado. SQL 101.';
revoke all on function public.divisao_concorrencia_voz() from public, anon;
grant execute on function public.divisao_concorrencia_voz() to authenticated, service_role;

create view public.voz_divisao_concorrencia as select * from public.divisao_concorrencia_voz();
revoke all on public.voz_divisao_concorrencia from public, anon;
grant select on public.voz_divisao_concorrencia to authenticated, service_role;

-- a VM (motorcx_voz) não executa funções de public: lê por uma função de voz_vm (SQL 57), agora com as colunas novas
create function voz_vm.divisao()
returns table (empresa_id bigint, canais int, contratado int, cota numeric, limite int, pico_multiplo int, teto int,
               licencas int, motivo text)
language sql stable security definer set search_path = '' as $$
    select d.empresa_id, d.canais, d.contratado, d.cota, d.limite, d.pico_multiplo, d.teto, d.licencas, d.motivo
      from public.divisao_concorrencia_voz() d
$$;
revoke all on function voz_vm.divisao() from public, anon, authenticated, service_role;
grant execute on function voz_vm.divisao() to motorcx_voz;
create view voz_vm.divisao_concorrencia as select * from voz_vm.divisao();
revoke all on voz_vm.divisao_concorrencia from public, anon, authenticated, service_role;
grant select on voz_vm.divisao_concorrencia to motorcx_voz;

-- ================================================================ 2. teto abaixo do vendido: aviso para a equipe
-- SQL 56 recriada inteira (mesma assinatura). Não bloqueia: o Console pede confirmação antes; aqui fica o registro no
-- sino da equipe quando a mudança diminui o teto e ele fica abaixo dos robôs vendidos hoje.
create or replace function public.definir_concorrencia_contratada(n int) returns void
language plpgsql security definer set search_path = public as $$
declare
    antes int;
    vend int;
begin
    if not (public.admin_equipe() or public.equipe_pode('gerenciar_troncos_voz', null)) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz define a concorrência';
    end if;
    if n is null or n < 0 then
        raise exception 'concorrência inválida';
    end if;
    select v.concorrencia_contratada into antes from public.voz_contrato v where v.id;
    update public.voz_contrato set concorrencia_contratada = n, atualizado_por = auth.uid(), atualizado_em = now()
     where id;
    vend := public.robos_vendidos_voz(public.hoje_sp());
    if vend > n and n < coalesce(antes, 0) then
        insert into public.avisos (para, tipo, titulo, texto, link)
        values ('equipe', 'atencao', 'Agente de voz: teto abaixo dos robôs vendidos',
                left(format('O teto contratado com o provedor de voz passou de %s para %s, abaixo dos %s robôs vendidos. '
                            'Nos horários em que todos usam juntos, o limite de cada empresa cai proporcionalmente.',
                            coalesce(antes, 0), n, vend), 400),
                '/console/voz');
        raise notice 'teto (%) abaixo dos robôs vendidos (%): overbooking', n, vend;
    end if;
end $$;
revoke all on function public.definir_concorrencia_contratada(int) from public, anon;
grant execute on function public.definir_concorrencia_contratada(int) to authenticated;
