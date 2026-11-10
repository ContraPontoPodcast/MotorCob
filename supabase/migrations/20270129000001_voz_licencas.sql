-- SQL 93 · Agente de voz: robôs contratados (licenças), PR 1 do plano "Robôs contratados" (SPEC aprovada pelo dono,
-- com os padrões recomendados). Só banco: ninguém lê ainda (a fatura é o PR seguinte; a divisão da concorrência e o
-- motor não mudam aqui). 1 robô = 1 conversa ao mesmo tempo com a IA (não é linha discando nem canal do tronco).
--
-- 1. voz_licencas: uma linha por vigência, só se acrescenta (nada é alterado nem apagado; histórico = a própria
--    tabela). Robôs (0 a 5.000), modelo (por_robo: preço por robô · valor_fechado: total do mês), franquia de minutos
--    de IA por robô, transcrição inclusa, vigente_desde (dia exato), fidelidade (0, 6, 12 ou 24 meses, até quando,
--    mínimo de robôs), motivo, overbooking confirmado, quem e quando. Duas linhas no mesmo dia: vale a última (id).
-- 2. Item voz_licenca_robo (robô·mês, módulo agente_voz, ordem 49, eh_ia) com franquia padrão de 4.000 min por robô.
--    Entra em itens_com_franquia() (franquia padrão editável pelo Master em Console › Margem › IA, como no SQL 92).
--    Custo de referência do robô para o guarda da IA = franquia × custo de referência do voz_minuto_ia (ou o custo
--    próprio cadastrado, se maior): custo_ia_referencia() recriada inteira com esse ramo. Pré-preenchido: mínimo do
--    catálogo = o mínimo da IA com a franquia padrão; tabela = esse mínimo arredondado para cima em R$ 10 (só se o item
--    ainda não tem preço; o Master troca em Margem › IA). Nenhum outro item muda.
-- 3. salvar_licencas_voz(...): a única escrita. Quantidade, fidelidade e franquia: equipe_pode('editar_contratacao');
--    preço novo: também editar_precos; abaixo do mínimo do catálogo: preco_abaixo_minimo (ou Master) com motivo; o guarda
--    da IA confere preço por robô × franquia (nunca abaixo, nem para o Master). Valores vazios = pré-preenchidos (o que
--    vale; sem licença, a tabela e a franquia padrão). Aumento vale hoje (America/Sao_Paulo) ou no próximo ciclo;
--    redução (robôs, franquia, transcrição) só no próximo ciclo e nunca abaixo do mínimo da fidelidade antes do fim.
--    Overbooking (Σ robôs vendidos > voz_contrato.concorrencia_contratada e a mudança aumenta) exige confirmação e avisa
--    a equipe (avisos, link /console/voz). O preço vai também para precos_empresa (voz_licenca_robo: flat = preço por
--    robô, mensalidade = valor fechado; vigência do ciclo da mudança, franquia = a da licença), para a fatura seguir o
--    caminho de sempre. Auditoria pelo gatilho z_auditar.
-- 4. Preço do item só pela licença: guardar_preco_licenca_voz (gatilho novo em precos_empresa) recusa gravar
--    voz_licenca_robo por salvar_preco/salvar_preco_vigencia/salvar_preco_franquia; guardar_preco_empresa_ia() recriada
--    inteira deixa esse item para a regra da licença (a franquia varia por licença e o valor fechado é mensalidade);
--    ia_precos_abaixo_minimo() recriada inteira confere as licenças com a franquia de cada uma.
-- 5. Leitura: equipe com editar_contratacao ou ver_faturamento e cliente com ve_faturamento leem voz_licencas (sem
--    motivo nem autor: só pela RPC da equipe) e voz_licencas_cliente; voz_licenca_vigente (robôs, franquia, transcrição
--    e fidelidade, sem preço) para quem é da empresa (minhas_empresas) e o servidor; licencas_voz(empresa): histórico
--    completo da equipe (quem, quando, de → para, desde quando vale, motivo).
-- Não muda a fatura nem o limite de ninguém sem licença. Depende dos SQL 56 (voz), 37 (vigência), 61 (margem da IA),
-- 78 (franquia) e 92 (preços editáveis). Pode rodar de novo.

-- ================================================================ 1. item do catálogo
insert into public.cobranca_itens (codigo, produto, nome, unidade, modulo, ordem, eh_ia, franquia_padrao, descricao)
values ('voz_licenca_robo', 'agente_voz', 'Agente virtual · robôs (licenças)', 'robô·mês', 'agente_voz', 49, true, 4000,
        'Licença fixa: 1 robô = 1 conversa ao mesmo tempo com a IA, com franquia de minutos de IA por robô')
on conflict (codigo) do nothing;

create or replace function public.itens_com_franquia() returns text[]
language sql immutable parallel safe set search_path = '' as $$
    select array['ia_creditos', 'ia_treino_voz', 'ia_treino_texto', 'voz_licenca_robo']::text[]
$$;
comment on function public.itens_com_franquia() is
    'Itens em que a franquia (cobranca_itens.franquia_padrao, precos_empresa.franquia) vale na cobrança. SQL 92 e 93 '
    '(voz_licenca_robo: minutos de IA por robô).';

-- custo de um robô com a franquia f: f × custo de referência do minuto de IA, ou o custo próprio do item, se maior
create or replace function public.custo_licenca_voz(franquia int) returns numeric
language sql stable security definer set search_path = public as $$
    select greatest(
        public.custo_ia_vigente('voz_licenca_robo', current_date),
        (select max(round(c.custo_unitario * c.cotacao, 6)) from public.custos_ia c
          where c.item = 'voz_licenca_robo' and c.vigente_desde > current_date),
        custo_licenca_voz.franquia * public.custo_ia_referencia('voz_minuto_ia'))
$$;

-- SQL 61 recriada inteira: + o ramo do robô (franquia padrão × minuto de IA)
create or replace function public.custo_ia_referencia(it text) returns numeric
language sql stable security definer set search_path = public as $$
    select max(x) from (
        select public.custo_ia_vigente(it, current_date) as x
        union all
        select round(c.custo_unitario * c.cotacao, 6) from public.custos_ia c where c.item = it and c.vigente_desde > current_date
        union all
        select round(sum(k.custo) / sum(k.quantidade), 6) from public.consumo_ia k
         where k.item = it and k.competencia >= date_trunc('month', current_date - 90)::date
        having sum(k.quantidade) > 0 and sum(k.registros) >= 10 and sum(k.sem_custo) = 0
        union all
        select i.franquia_padrao * public.custo_ia_referencia('voz_minuto_ia') from public.cobranca_itens i
         where it = 'voz_licenca_robo' and i.codigo = 'voz_licenca_robo'
    ) v
$$;

-- menor preço por robô com a franquia f (nulo = minuto de IA sem custo)
create or replace function public.preco_minimo_licenca_voz(franquia int) returns numeric
language sql stable security definer set search_path = public as $$
    select public.preco_minimo_ia('voz_licenca_robo', public.custo_licenca_voz(preco_minimo_licenca_voz.franquia))
$$;

-- pré-preenchido (só se o item ainda não tem preço)
update public.cobranca_itens i
   set preco_minimo = public.preco_minimo_ia(i.codigo),
       preco_tabela = ceil(public.preco_minimo_ia(i.codigo) / 10) * 10
 where i.codigo = 'voz_licenca_robo' and i.preco_tabela is null and public.preco_minimo_ia(i.codigo) is not null;

-- ================================================================ 2. tabela das licenças
create table if not exists public.voz_licencas (
    id                     bigint generated always as identity primary key,
    empresa_id             bigint not null references public.empresas (id) on delete cascade,
    robos                  int not null check (robos between 0 and 5000),
    modelo                 text not null check (modelo in ('por_robo', 'valor_fechado')),
    preco_robo             numeric(14, 2) check (preco_robo >= 0),
    valor_fechado          numeric(14, 2) check (valor_fechado >= 0),
    franquia_min_robo      int not null default 4000 check (franquia_min_robo between 0 and 1000000),
    transcricao_inclusa    boolean not null default true,
    vigente_desde          date not null,
    fidelidade_meses       int not null default 0 check (fidelidade_meses in (0, 6, 12, 24)),
    fidelidade_ate         date,
    fidelidade_min         int not null default 0 check (fidelidade_min >= 0),
    motivo                 text not null check (char_length(trim(motivo)) between 5 and 300),
    overbooking_confirmado boolean not null default false,
    criado_por             uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em              timestamptz not null default now(),
    constraint voz_licencas_preco_do_modelo check ((modelo = 'por_robo') = (preco_robo is not null)
                                                   and (modelo = 'valor_fechado') = (valor_fechado is not null)),
    constraint voz_licencas_fidelidade check ((fidelidade_meses = 0) = (fidelidade_ate is null)
                                              and (fidelidade_meses > 0 or fidelidade_min = 0)
                                              and fidelidade_min <= robos)
);
comment on table public.voz_licencas is
    'Robôs contratados do Agente de voz (1 robô = 1 conversa ao mesmo tempo com a IA). Uma linha por vigência, só se '
    'acrescenta; vale a última com vigente_desde <= hoje (America/Sao_Paulo). Escrita só por salvar_licencas_voz. SQL 93.';
create index if not exists voz_licencas_empresa on public.voz_licencas (empresa_id, vigente_desde desc, id desc);

alter table public.voz_licencas enable row level security;
drop policy if exists voz_licencas_ver on public.voz_licencas;
create policy voz_licencas_ver on public.voz_licencas for select to authenticated
    using (public.equipe_pode('editar_contratacao', empresa_id) or public.ve_faturamento(empresa_id));
revoke all on public.voz_licencas from public, anon, authenticated, service_role;
-- motivo e autor só pela RPC da equipe (licencas_voz)
grant select (id, empresa_id, robos, modelo, preco_robo, valor_fechado, franquia_min_robo, transcricao_inclusa,
              vigente_desde, fidelidade_meses, fidelidade_ate, fidelidade_min, overbooking_confirmado, criado_em)
    on public.voz_licencas to authenticated;
grant select on public.voz_licencas to service_role;

-- só acrescenta: nem a função security definer altera ou apaga (a exclusão da empresa apaga em cascata)
create or replace function public.voz_licencas_so_acrescenta() returns trigger
language plpgsql set search_path = public as $$
begin
    if tg_op = 'DELETE' and (pg_trigger_depth() > 1
                             or coalesce(current_setting('motorcob.excluindo_empresa', true), '') <> '') then
        return old;
    end if;
    raise exception 'licenças de robôs só se acrescentam: grave uma vigência nova (salvar_licencas_voz)';
end $$;
drop trigger if exists voz_licencas_so_acrescenta on public.voz_licencas;
create trigger voz_licencas_so_acrescenta before update or delete on public.voz_licencas
    for each row execute function public.voz_licencas_so_acrescenta();
drop trigger if exists z_auditar on public.voz_licencas;
create trigger z_auditar after insert or update or delete on public.voz_licencas
    for each row execute function public.auditar();

-- ================================================================ 3. leitura
-- licença de uma empresa num dia (a última vigência que já começou)
create or replace function public.licenca_voz_em(empresa bigint, dia date) returns public.voz_licencas
language sql stable security definer set search_path = public as $$
    select l.* from public.voz_licencas l
     where l.empresa_id = licenca_voz_em.empresa and l.vigente_desde <= licenca_voz_em.dia
     order by l.vigente_desde desc, l.id desc limit 1
$$;

create or replace function public.hoje_sp() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- cliente (ve_faturamento) e equipe: as vigências sem o motivo e sem o autor
create or replace view public.voz_licencas_cliente with (security_invoker = true) as
select l.id, l.empresa_id, l.robos, l.modelo, l.preco_robo, l.valor_fechado,
       case when l.modelo = 'valor_fechado' then l.valor_fechado else l.robos * l.preco_robo end as total_mes,
       l.franquia_min_robo, l.robos * l.franquia_min_robo as franquia_total, l.transcricao_inclusa, l.vigente_desde,
       l.fidelidade_meses, l.fidelidade_ate, l.fidelidade_min, l.criado_em
  from public.voz_licencas l;
revoke all on public.voz_licencas_cliente from public, anon;
grant select on public.voz_licencas_cliente to authenticated, service_role;

-- quem é da empresa (qualquer perfil, menos a Qualidade) e o servidor: os robôs que valem hoje, sem preço
create or replace view public.voz_licenca_vigente as
select distinct on (l.empresa_id)
       l.empresa_id, l.id as licenca_id, l.robos, l.franquia_min_robo, l.transcricao_inclusa, l.vigente_desde,
       l.fidelidade_ate, l.fidelidade_min
  from public.voz_licencas l
 where l.vigente_desde <= public.hoje_sp()
   and (public.chamada_do_servidor() or l.empresa_id in (select public.minhas_empresas()))
 order by l.empresa_id, l.vigente_desde desc, l.id desc;
comment on view public.voz_licenca_vigente is
    'Robôs contratados que valem hoje (America/Sao_Paulo), por empresa, sem preço. Lê: minhas_empresas() e o servidor. SQL 93.';
revoke all on public.voz_licenca_vigente from public, anon;
grant select on public.voz_licenca_vigente to authenticated, service_role;

-- equipe: histórico completo (de → para em cada coluna sai da linha anterior), o mais novo primeiro
create or replace function public.licencas_voz(empresa bigint)
returns table (id bigint, situacao text, vigente_desde date, robos int, robos_antes int, modelo text, preco_robo numeric,
               valor_fechado numeric, total_mes numeric, franquia_min_robo int, transcricao_inclusa boolean,
               fidelidade_meses int, fidelidade_ate date, fidelidade_min int, motivo text, overbooking_confirmado boolean,
               quem text, criado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
    vig bigint := (public.licenca_voz_em(licencas_voz.empresa, public.hoje_sp())).id;
begin
    if not (public.equipe_pode('editar_contratacao', licencas_voz.empresa)
            or public.equipe_pode('ver_faturamento', licencas_voz.empresa)) then
        raise exception 'sem permissão para ver os robôs contratados desta empresa';
    end if;
    return query
    select l.id,
           case when l.id = vig then 'vigente' when l.vigente_desde > public.hoje_sp() then 'agendada'
                else 'anterior' end,
           l.vigente_desde, l.robos, lag(l.robos) over w, l.modelo, l.preco_robo, l.valor_fechado,
           case when l.modelo = 'valor_fechado' then l.valor_fechado else l.robos * l.preco_robo end,
           l.franquia_min_robo, l.transcricao_inclusa, l.fidelidade_meses, l.fidelidade_ate, l.fidelidade_min, l.motivo,
           l.overbooking_confirmado, coalesce(public.nome_curto(l.criado_por), 'Equipe MotorCX'), l.criado_em
      from public.voz_licencas l
     where l.empresa_id = licencas_voz.empresa
    window w as (order by l.vigente_desde, l.id)
     order by l.vigente_desde desc, l.id desc;
end $$;

-- robôs vendidos num dia (todas as empresas) e o teto contratado com o provedor
create or replace function public.robos_vendidos_voz(dia date, exceto bigint default null) returns int
language sql stable security definer set search_path = public as $$
    select coalesce(sum(x.robos), 0)::int from (
        select distinct on (l.empresa_id) l.robos from public.voz_licencas l
         where l.vigente_desde <= robos_vendidos_voz.dia and l.empresa_id is distinct from robos_vendidos_voz.exceto
         order by l.empresa_id, l.vigente_desde desc, l.id desc) x
$$;

-- ================================================================ 4. preço do item só pela licença
create or replace function public.guardar_preco_licenca_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.item = 'voz_licenca_robo' and coalesce(current_setting('motorcx.salvando_licenca_voz', true), '') <> '1' then
        raise exception 'o preço dos robôs (licenças) se grava em Contratação › Agente de voz (salvar_licencas_voz)';
    end if;
    return new;
end $$;
drop trigger if exists guardar_preco_licenca_voz on public.precos_empresa;
create trigger guardar_preco_licenca_voz before insert or update on public.precos_empresa
    for each row execute function public.guardar_preco_licenca_voz();

-- SQL 61 recriada inteira: o robô fica com a regra da licença (franquia de cada licença; valor fechado é mensalidade)
create or replace function public.guardar_preco_empresa_ia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' and (new.item, new.modelo, new.preco) is not distinct from (old.item, old.modelo, old.preco) then
        return new;
    end if;
    if new.item = 'voz_licenca_robo' then      -- SQL 93: conferido em salvar_licencas_voz (preço por robô × franquia)
        return new;
    end if;
    perform public.conferir_preco_ia(new.item, new.modelo, case when new.modelo = 'flat' then new.preco end);
    return new;
end $$;

-- SQL 61 recriada inteira: os preços de empresa do robô saem das licenças (preço por robô com a franquia de cada uma)
create or replace function public.ia_precos_abaixo_minimo()
returns table (origem text, empresa_id bigint, empresa text, item text, nome text, modelo text, preco numeric,
               preco_minimo_ia numeric, mc_pct numeric, vigente_desde date, problema text)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob vê o custo da IA';
    end if;
    return query
    with itens as (
        select i.codigo, i.nome, i.preco_tabela, i.preco_minimo, public.preco_minimo_ia(i.codigo) as pmin,
               public.custo_ia_referencia(i.codigo) as custo
          from public.cobranca_itens i where i.eh_ia
    ), cat as (
        select 'tabela'::text as o, null::bigint as eid, null::text as en, t.codigo, t.nome, 'flat'::text as m,
               t.preco_tabela as pr, t.pmin, t.custo, null::date as vd
          from itens t where t.preco_tabela is not null
        union all
        select 'minimo_catalogo', null, null, t.codigo, t.nome, 'flat', t.preco_minimo, t.pmin, t.custo, null
          from itens t where t.preco_minimo is not null
    ), emp as (
        select 'empresa'::text as o, p.empresa_id as eid, e.nome as en, t.codigo, t.nome, p.modelo as m,
               case when p.modelo in ('faixa', 'progressivo')
                    then (select min(f.preco) from public.precos_faixas f where f.preco_id = p.id) else p.preco end as pr,
               t.pmin, t.custo, p.vigente_desde as vd
          from public.precos_empresa p
          join itens t on t.codigo = p.item
          join public.empresas e on e.id = p.empresa_id
         where p.item <> 'voz_licenca_robo'
           and p.vigente_desde >= coalesce((public.preco_vigente(p.empresa_id, p.item, current_date)).vigente_desde, p.vigente_desde)
    ), lic as (       -- SQL 93: a licença que vale e as agendadas, preço por robô contra a franquia de cada uma
        select 'empresa'::text as o, l.empresa_id as eid, e.nome as en, t.codigo, t.nome, 'flat'::text as m,
               round(coalesce(l.preco_robo, l.valor_fechado / nullif(l.robos, 0)), 2) as pr,
               public.preco_minimo_licenca_voz(l.franquia_min_robo) as pmin,
               public.custo_licenca_voz(l.franquia_min_robo) as custo, l.vigente_desde as vd
          from public.voz_licencas l
          join itens t on t.codigo = 'voz_licenca_robo'
          join public.empresas e on e.id = l.empresa_id
         where l.robos > 0
           and (l.vigente_desde > current_date or l.id = (public.licenca_voz_em(l.empresa_id, current_date)).id)
    ), tudo as (
        select * from cat union all select * from emp union all select * from lic
    )
    select x.o, x.eid, x.en, x.codigo, x.nome, x.m, x.pr, x.pmin,
           case when x.m <> 'mensalidade' then public.mc_pct_ia(x.pr, x.custo) end, x.vd,
           case when x.m = 'mensalidade' then 'mensalidade'
                when x.pmin is null then 'sem_custo'
                else 'abaixo_minimo' end
      from tudo x
     where x.m = 'mensalidade' or (x.o = 'empresa' and x.pmin is null) or (x.pmin is not null and x.pr < x.pmin)
     order by x.codigo, x.o, x.en nulls first;
end $$;

-- ================================================================ 5. salvar (a única escrita)
create or replace function public.salvar_licencas_voz(empresa bigint, robos int, motivo text,
    modelo text default 'por_robo', preco_robo numeric default null, valor_fechado numeric default null,
    franquia_min_robo int default null, transcricao_inclusa boolean default null, inicio text default 'agora',
    fidelidade_meses int default null, fidelidade_min int default null, overbooking_confirmado boolean default false,
    motivo_abaixo text default null)
returns table (licenca_id bigint, vale_desde date, fidelidade_ate date, preco_id bigint, vendido int, contratado int,
               overbooking boolean)
language plpgsql security definer set search_path = public as $$
declare
    hoje date := public.hoje_sp();
    d date;
    ant public.voz_licencas;
    it public.cobranca_itens;
    m text := trim(coalesce(salvar_licencas_voz.motivo, ''));
    ma text := nullif(trim(coalesce(salvar_licencas_voz.motivo_abaixo, '')), '');
    n int := salvar_licencas_voz.robos;
    mod text := coalesce(salvar_licencas_voz.modelo, 'por_robo');
    pr numeric;           -- preço por robô
    vf numeric;           -- valor fechado
    por_robo numeric;     -- equivalente por robô
    fr int;
    tr boolean;
    fm int;
    fmin int;
    fate date;
    pmin numeric;
    piso numeric;
    preco_mudou boolean;
    teto int := coalesce((select c.concorrencia_contratada from public.voz_contrato c limit 1), 0);
    vend int;
    over boolean;
    aumenta boolean;
    mes date;
    pv public.precos_empresa;
    pid bigint;
    lid bigint;
    nome_emp text;
begin
    if not public.equipe_pode('editar_contratacao', salvar_licencas_voz.empresa) then
        raise exception 'sem permissão para editar os robôs contratados desta empresa (editar_contratacao)';
    end if;
    if n is null or n not between 0 and 5000 then
        raise exception 'robôs: de 0 a 5.000';
    end if;
    if mod not in ('por_robo', 'valor_fechado') then
        raise exception 'modelo: por robô ou valor fechado';
    end if;
    if salvar_licencas_voz.inicio not in ('agora', 'proximo') then
        raise exception 'início: agora ou no próximo ciclo';
    end if;
    if char_length(m) not between 5 and 300 then
        raise exception 'escreva o motivo da mudança (5 a 300 letras)';
    end if;
    select * into it from public.cobranca_itens c where c.codigo = 'voz_licenca_robo';
    d := case salvar_licencas_voz.inicio when 'agora' then hoje
              else (public.ciclo_de(salvar_licencas_voz.empresa,
                                    public.competencia_de(salvar_licencas_voz.empresa, hoje))).fim + 1 end;
    ant := public.licenca_voz_em(salvar_licencas_voz.empresa, d);

    -- pré-preenchido: o que vale; sem licença, a tabela e a franquia padrão
    fr := coalesce(salvar_licencas_voz.franquia_min_robo, ant.franquia_min_robo, it.franquia_padrao, 4000);
    tr := coalesce(salvar_licencas_voz.transcricao_inclusa, ant.transcricao_inclusa, true);
    if mod = 'por_robo' then
        pr := coalesce(salvar_licencas_voz.preco_robo, case when ant.modelo = 'por_robo' then ant.preco_robo end,
                       it.preco_tabela);
        if pr is null or pr <= 0 then
            raise exception 'informe o preço por robô';
        end if;
        pr := round(pr, 2);
        por_robo := pr;
    else
        vf := coalesce(salvar_licencas_voz.valor_fechado, case when ant.modelo = 'valor_fechado' then ant.valor_fechado end);
        if vf is null or vf <= 0 then
            raise exception 'informe o valor fechado por mês';
        end if;
        if n = 0 then
            raise exception 'valor fechado precisa de pelo menos 1 robô';
        end if;
        vf := round(vf, 2);
        por_robo := vf / n;
    end if;
    if fr not between 0 and 1000000 then
        raise exception 'franquia por robô inválida (0 a 1.000.000 min)';
    end if;

    -- redução só no próximo ciclo
    if ant.id is not null and salvar_licencas_voz.inicio = 'agora'
       and (n < ant.robos or fr < ant.franquia_min_robo or (ant.transcricao_inclusa and not tr)) then
        raise exception 'redução (robôs, franquia ou transcrição) vale só a partir do próximo ciclo (%)',
            to_char((public.ciclo_de(salvar_licencas_voz.empresa,
                                     public.competencia_de(salvar_licencas_voz.empresa, hoje))).fim + 1, 'DD/MM/YYYY');
    end if;

    -- fidelidade: a que está correndo segue (nunca encurta nem baixa o mínimo antes do fim)
    fm := coalesce(salvar_licencas_voz.fidelidade_meses, case when ant.fidelidade_ate >= d then ant.fidelidade_meses end, 0);
    if fm not in (0, 6, 12, 24) then
        raise exception 'fidelidade: sem, 6, 12 ou 24 meses';
    end if;
    if ant.fidelidade_ate >= d then
        if n < ant.fidelidade_min then
            raise exception 'fidelidade até % com mínimo de % robôs: não dá para reduzir abaixo disso antes do fim',
                to_char(ant.fidelidade_ate, 'DD/MM/YYYY'), ant.fidelidade_min;
        end if;
        if fm = 0 then
            raise exception 'fidelidade até %: não dá para tirar antes do fim', to_char(ant.fidelidade_ate, 'DD/MM/YYYY');
        end if;
        fate := case when fm = ant.fidelidade_meses then ant.fidelidade_ate
                     else ((d + make_interval(months => fm))::date - 1) end;
        fmin := coalesce(salvar_licencas_voz.fidelidade_min, ant.fidelidade_min);
        if fate < ant.fidelidade_ate or fmin < ant.fidelidade_min then
            raise exception 'fidelidade até % com mínimo de % robôs: só dá para manter ou estender',
                to_char(ant.fidelidade_ate, 'DD/MM/YYYY'), ant.fidelidade_min;
        end if;
    elsif fm > 0 then
        fate := (d + make_interval(months => fm))::date - 1;
        fmin := coalesce(salvar_licencas_voz.fidelidade_min, n);
    else
        fate := null;
        fmin := 0;
    end if;
    if fmin < 0 or fmin > n then
        raise exception 'mínimo de robôs na fidelidade: de 0 a % (os robôs contratados)', n;
    end if;

    -- preço: editar_precos; guarda da IA (preço por robô × franquia, nunca abaixo); mínimo do catálogo com motivo
    preco_mudou := ant.id is null or ant.modelo is distinct from mod or ant.preco_robo is distinct from pr
                   or ant.valor_fechado is distinct from vf;
    if preco_mudou and not public.equipe_pode('editar_precos', salvar_licencas_voz.empresa) then
        raise exception 'sem permissão para definir o preço desta empresa (editar_precos)';
    end if;
    if n > 0 then
        pmin := public.preco_minimo_licenca_voz(fr);
        if pmin is null then
            raise exception 'minuto de IA sem custo cadastrado: o Master cadastra o custo (Console › Margem › IA) antes do preço';
        end if;
        if round(por_robo, 2) < pmin then
            raise exception '%', format('preço abaixo do mínimo para item de IA (robôs): com franquia de %s min por robô, '
                'o menor preço aceito é %s por robô (MC mínima de %s%% da IA)', fr, public.texto_preco_ia(pmin),
                (select replace(rtrim(rtrim(pm.mc_minima_ia_pct::text, '0'), '.'), '.', ',')
                   from public.parametros_margem pm where pm.id = 1))
                using errcode = 'check_violation';
        end if;
        piso := it.preco_minimo;
        if preco_mudou and piso is not null and round(por_robo, 2) < piso then
            if not (public.admin_equipe() or public.equipe_pode('preco_abaixo_minimo', salvar_licencas_voz.empresa)) then
                raise exception 'preço abaixo do mínimo (% por robô): só o Administrativo ou o Master aprovam',
                    public.texto_preco_ia(piso);
            end if;
            if ma is null or char_length(ma) < 3 then
                raise exception 'informe o motivo do preço abaixo do mínimo';
            end if;
        else
            ma := null;
        end if;
    else
        ma := null;
    end if;

    -- overbooking: vendido acima do teto contratado com o provedor, numa mudança que aumenta
    aumenta := n > coalesce(ant.robos, 0);
    vend := public.robos_vendidos_voz(d, salvar_licencas_voz.empresa) + n;
    over := aumenta and vend > teto;
    if over and not coalesce(salvar_licencas_voz.overbooking_confirmado, false) then
        raise exception 'overbooking: % robôs vendidos para % contratados com o provedor de voz; confirme para salvar', vend, teto;
    end if;

    insert into public.voz_licencas (empresa_id, robos, modelo, preco_robo, valor_fechado, franquia_min_robo,
                                     transcricao_inclusa, vigente_desde, fidelidade_meses, fidelidade_ate, fidelidade_min,
                                     motivo, overbooking_confirmado)
    values (salvar_licencas_voz.empresa, n, mod, pr, vf, fr, tr, d, fm, fate, fmin, m, over)
    returning id into lid;

    -- o preço também em precos_empresa (vigência do ciclo da mudança), para a fatura seguir o caminho de sempre
    if n > 0 then
        mes := date_trunc('month', public.competencia_de(salvar_licencas_voz.empresa, d))::date;
        pv := public.preco_vigente(salvar_licencas_voz.empresa, 'voz_licenca_robo', mes);
        if pv.id is null or pv.modelo is distinct from (case when mod = 'por_robo' then 'flat' else 'mensalidade' end)
           or pv.preco is distinct from coalesce(pr, vf)::numeric(14, 5) or pv.franquia is distinct from fr then
            perform set_config('motorcx.salvando_licenca_voz', '1', true);
            delete from public.precos_empresa p
             where p.empresa_id = salvar_licencas_voz.empresa and p.item = 'voz_licenca_robo' and p.vigente_desde = mes;
            insert into public.precos_empresa (empresa_id, item, modelo, preco, minimo, vigente_desde, motivo_abaixo,
                                               motivo_vigencia, franquia)
            values (salvar_licencas_voz.empresa, 'voz_licenca_robo', case when mod = 'por_robo' then 'flat' else 'mensalidade' end,
                    coalesce(pr, vf), 0, mes, left(ma, 300),
                    case when salvar_licencas_voz.inicio = 'agora' then left(m, 200) end, fr)
            returning id into pid;
            perform set_config('motorcx.salvando_licenca_voz', '', true);
        else
            pid := pv.id;
        end if;
    end if;

    if over then
        select e.nome into nome_emp from public.empresas e where e.id = salvar_licencas_voz.empresa;
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('equipe', salvar_licencas_voz.empresa, 'atencao', 'Agente de voz: robôs vendidos acima do teto',
                left(format('%s passou a ter %s robôs (desde %s). Vendido: %s robôs para %s contratados com o provedor de voz. '
                            'Quem cuida do contrato com o provedor precisa ampliar o teto.',
                            coalesce(nome_emp, 'Empresa ' || salvar_licencas_voz.empresa), n, to_char(d, 'DD/MM/YYYY'),
                            vend, teto), 400),
                '/console/voz');
    end if;

    return query select lid, d, fate, pid, vend, teto, vend > teto;
end $$;

-- ================================================================ 6. permissões das funções
revoke all on function public.custo_licenca_voz(int), public.custo_ia_referencia(text),
    public.preco_minimo_licenca_voz(int), public.licenca_voz_em(bigint, date), public.robos_vendidos_voz(date, bigint),
    public.guardar_preco_licenca_voz(), public.guardar_preco_empresa_ia(), public.voz_licencas_so_acrescenta()
    from public, anon, authenticated;
grant execute on function public.licenca_voz_em(bigint, date), public.robos_vendidos_voz(date, bigint) to service_role;
revoke all on function public.hoje_sp() from public, anon;
grant execute on function public.hoje_sp() to authenticated, service_role;
revoke all on function public.licencas_voz(bigint),
    public.salvar_licencas_voz(bigint, int, text, text, numeric, numeric, int, boolean, text, int, int, boolean, text),
    public.ia_precos_abaixo_minimo() from public, anon;
grant execute on function public.licencas_voz(bigint),
    public.salvar_licencas_voz(bigint, int, text, text, numeric, numeric, int, boolean, text, int, int, boolean, text),
    public.ia_precos_abaixo_minimo() to authenticated;
