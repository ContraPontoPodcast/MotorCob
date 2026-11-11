-- SQL 103 · Agente Voz/CX › Telefonia, PR T1: a senha do tronco vai direto para o cofre (G5 do parecer)
-- Decisão do dono (SPEC Canais §3.4 e §6.2, item 9): o Admin do cliente vai cadastrar a operadora dele na tela Telefonia;
-- a senha do tronco (autenticação "usuário e senha") é digitada uma vez e vai DIRETO para o Secret Manager do MotorCX por
-- uma função do servidor (Edge Function segredo-tronco-voz). O banco nunca vê a senha: guarda só a referência
-- (segredo_ref) e QUANDO a senha foi guardada. O site só sabe "senha cadastrada: sim/não". Só a VM do Asterisk lê.
--
-- 1. voz_troncos ganha segredo_guardado_em, segredo_guardado_por e segredo_versao (a versão no Secret Manager). Nenhuma
--    delas tem o valor. O nome do segredo é sempre o da empresa: segredo_ref = voz/trunk/e<empresa>/<referência>, que
--    a VM transforma em motorcx-voz-trunk-e<empresa>-<referência> (voz/segredos.py › nome_secret_manager). Assim o
--    servidor nunca escreve fora do prefixo da empresa, e a conta que escreve só alcança motorcx-voz-trunk-* (IAM).
-- 2. preparar_segredo_tronco_voz(tronco): o site chama pela Edge Function, com o login da pessoa. Confere quem pode
--    (pode_configurar_telefonia: hoje a equipe com gerenciar_troncos_voz; o PR T3 abre para o Admin do cliente com
--    configurar_telefonia), exige a sessão confirmada pela verificação em duas etapas (aal2) e o tronco com
--    autenticação por senha, limita 5 trocas por hora por tronco e 30 por dia por empresa, registra o pedido e devolve
--    só o nome do segredo. Não devolve nem guarda senha.
-- 3. registrar_segredo_tronco_voz(tronco, usuario, versao): só o servidor (a Edge Function, depois que o Secret
--    Manager aceitou a versão nova). Exige um pedido da mesma pessoa para o mesmo tronco nos últimos 10 minutos. Grava
--    a referência padrão, a data, quem e a versão; zera o teste do tronco (senha nova = testar de novo, como já era
--    com a referência); muda atualizado_em (a VM regera o pjsip na próxima rodada e lê a senha nova) e grava na
--    Auditoria "senha trocada (versão N)", sem valor.
-- 4. cadastrar_tronco_voz recriada INTEIRA: quem pode passa por pode_configurar_telefonia; com autenticação por senha
--    e sem referência informada, mantém a do tronco ou usa a padrão da empresa (a tela não pede mais o nome do segredo);
--    referência fora do padrão só a equipe informa (um cliente não pode apontar para o segredo de outra empresa);
--    trocar de referência ou passar para IP limpa "senha guardada".
-- 5. voz_troncos_cofre: o registro dos pedidos e das senhas guardadas (sem valor), para o limite e para a equipe.
-- Depende dos SQL 56 (voz_troncos), 67 (referência voz/) e 83 (destino seguro). Pode rodar de novo sem erro. Se o SQL 56
-- rodar de novo, rode este depois (ele recria cadastrar_tronco_voz sem o cofre).

-- ================================================================ 1. colunas (sem valor de senha)
alter table public.voz_troncos add column if not exists segredo_guardado_em timestamptz;
alter table public.voz_troncos add column if not exists segredo_guardado_por uuid references auth.users (id) on delete set null;
alter table public.voz_troncos add column if not exists segredo_versao int;
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'voz_troncos_segredo_versao_check') then
        alter table public.voz_troncos add constraint voz_troncos_segredo_versao_check check (segredo_versao > 0);
    end if;
end $$;
comment on column public.voz_troncos.segredo_guardado_em is
    'SQL 103: quando a senha foi guardada no cofre pela Edge Function segredo-tronco-voz. Nulo = ainda não guardada pela '
    'tela (ou guardada à mão pela equipe). A senha nunca fica no banco.';
comment on column public.voz_troncos.segredo_versao is
    'SQL 103: versão do segredo no Secret Manager (a VM lê a última). Só o número, nunca o valor.';

-- ================================================================ 2. nome do segredo da empresa
-- voz/trunk/e<empresa>/<referência>: a referência do tronco é única na empresa e não muda (a tela não deixa)
create or replace function public.segredo_ref_tronco_voz(empresa bigint, referencia text) returns text
language sql immutable parallel safe set search_path = '' as $$
    select 'voz/trunk/e' || empresa::text || '/' || referencia
$$;
-- o nome no Secret Manager (a mesma regra de voz/segredos.py › nome_secret_manager)
create or replace function public.nome_segredo_tronco_voz(empresa bigint, referencia text) returns text
language sql immutable parallel safe set search_path = '' as $$
    select 'motorcx-voz-trunk-e' || empresa::text || '-' || referencia
$$;
revoke all on function public.segredo_ref_tronco_voz(bigint, text), public.nome_segredo_tronco_voz(bigint, text)
    from public, anon;
grant execute on function public.segredo_ref_tronco_voz(bigint, text), public.nome_segredo_tronco_voz(bigint, text)
    to authenticated, service_role;

-- quem configura a telefonia da empresa. PR T1: a equipe com gerenciar_troncos_voz (cuida_voz), como hoje.
-- PR T3 recria para abrir ao cliente com configurar_telefonia e a verificação em duas etapas.
create or replace function public.pode_configurar_telefonia(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select eid is not null and public.cuida_voz(eid)
$$;
revoke all on function public.pode_configurar_telefonia(bigint) from public, anon;
grant execute on function public.pode_configurar_telefonia(bigint) to authenticated;

-- ================================================================ 3. registro dos pedidos e das senhas guardadas
create table if not exists public.voz_troncos_cofre (
    id          bigint generated always as identity primary key,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    tronco_id   bigint not null,
    usuario     uuid references auth.users (id) on delete set null,
    evento      text not null check (evento in ('pedido', 'guardado')),
    versao      int check (versao > 0),
    em          timestamptz not null default now(),
    foreign key (tronco_id, empresa_id) references public.voz_troncos (id, empresa_id) on delete cascade
);
create index if not exists voz_troncos_cofre_tronco on public.voz_troncos_cofre (tronco_id, em desc);
create index if not exists voz_troncos_cofre_empresa on public.voz_troncos_cofre (empresa_id, em desc);
comment on table public.voz_troncos_cofre is
    'SQL 103: pedidos de troca da senha do tronco e as senhas guardadas no cofre (quem, quando, versão). Nunca o valor.';
alter table public.voz_troncos_cofre enable row level security;
drop policy if exists voz_troncos_cofre_ver on public.voz_troncos_cofre;
create policy voz_troncos_cofre_ver on public.voz_troncos_cofre for select to authenticated
    using (public.pode_configurar_telefonia(empresa_id));
revoke all on public.voz_troncos_cofre from anon, authenticated;
grant select on public.voz_troncos_cofre to authenticated;
grant all on public.voz_troncos_cofre to service_role;

-- ================================================================ 4. preparar (com o login da pessoa)
create or replace function public.preparar_segredo_tronco_voz(tronco bigint)
returns table (empresa_id bigint, nome_segredo text)
language plpgsql security definer set search_path = public as $$
declare
    t public.voz_troncos;
begin
    select * into t from public.voz_troncos v where v.id = tronco;
    if t.id is null or not public.pode_configurar_telefonia(t.empresa_id) then
        raise exception 'tronco não encontrado';
    end if;
    if not public.sessao_aal2() then
        raise exception 'confirme a verificação em duas etapas para guardar a senha do tronco';
    end if;
    if t.autenticacao <> 'senha' then
        raise exception 'este tronco autentica por IP: não tem senha para guardar';
    end if;
    if (select count(*) from public.voz_troncos_cofre c
         where c.tronco_id = t.id and c.evento = 'pedido' and c.em > now() - interval '1 hour') >= 5 then
        raise exception 'muitas trocas de senha deste tronco na última hora: espere um pouco e tente de novo';
    end if;
    if (select count(*) from public.voz_troncos_cofre c
         where c.empresa_id = t.empresa_id and c.evento = 'pedido' and c.em > now() - interval '1 day') >= 30 then
        raise exception 'limite de 30 trocas de senha por dia na empresa: tente amanhã';
    end if;
    insert into public.voz_troncos_cofre (empresa_id, tronco_id, usuario, evento)
    values (t.empresa_id, t.id, auth.uid(), 'pedido');
    return query select t.empresa_id, public.nome_segredo_tronco_voz(t.empresa_id, t.referencia);
end $$;
revoke all on function public.preparar_segredo_tronco_voz(bigint) from public, anon;
grant execute on function public.preparar_segredo_tronco_voz(bigint) to authenticated;

-- ================================================================ 5. registrar (só o servidor, depois do cofre)
create or replace function public.registrar_segredo_tronco_voz(tronco bigint, usuario uuid, versao int)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
    t public.voz_troncos;
    agora timestamptz := now();
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor registra a senha guardada';
    end if;
    if versao is null or versao < 1 then
        raise exception 'versão do segredo inválida';
    end if;
    select * into t from public.voz_troncos v where v.id = tronco for update;
    if t.id is null or t.autenticacao <> 'senha' then
        raise exception 'tronco não encontrado ou sem autenticação por senha';
    end if;
    -- só depois de um pedido autorizado da mesma pessoa (preparar_segredo_tronco_voz) para este tronco
    if not exists (select 1 from public.voz_troncos_cofre c
                    where c.tronco_id = t.id and c.usuario = registrar_segredo_tronco_voz.usuario
                      and c.evento = 'pedido' and c.em > agora - interval '10 minutes') then
        raise exception 'pedido de troca de senha não encontrado ou vencido';
    end if;
    update public.voz_troncos v
       set segredo_ref = public.segredo_ref_tronco_voz(t.empresa_id, t.referencia),
           segredo_guardado_em = agora, segredo_guardado_por = registrar_segredo_tronco_voz.usuario,
           segredo_versao = registrar_segredo_tronco_voz.versao, atualizado_em = agora,
           testado_em = null, teste_ok = null
     where v.id = t.id;
    insert into public.voz_troncos_cofre (empresa_id, tronco_id, usuario, evento, versao)
    values (t.empresa_id, t.id, registrar_segredo_tronco_voz.usuario, 'guardado', registrar_segredo_tronco_voz.versao);
    -- a Auditoria da empresa (o gatilho z_auditar não registra o servidor): só o fato, nunca o valor nem o nome
    insert into public.auditoria (empresa_id, usuario, tabela, acao, registro, mudou)
    values (t.empresa_id, registrar_segredo_tronco_voz.usuario, 'voz_troncos', 'UPDATE', t.id::text,
            jsonb_build_object('senha', jsonb_build_object(
                'antes', case when t.segredo_guardado_em is null then 'não guardada pela tela' else 'guardada' end,
                'depois', 'trocada (versão ' || registrar_segredo_tronco_voz.versao || ')'),
                'teste_ok', jsonb_build_object('antes', t.teste_ok, 'depois', null)));
    return agora;
end $$;
revoke all on function public.registrar_segredo_tronco_voz(bigint, uuid, int) from public, anon, authenticated;
grant execute on function public.registrar_segredo_tronco_voz(bigint, uuid, int) to service_role;

-- ================================================================ 6. cadastrar_tronco_voz (recriada inteira)
create or replace function public.cadastrar_tronco_voz(empresa bigint, referencia text, operadora text, host text,
                                                       canais int, autenticacao text, ddd_origem text, bina text,
                                                       segredo_ref text default null, usuario text default null,
                                                       porta int default 5060, transporte text default 'udp',
                                                       cps int default 10, codecs text[] default '{alaw,ulaw}',
                                                       formato_discagem text default 'tech_ddd_numero',
                                                       ativo boolean default true, csp text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    tid bigint;
    ref text := lower(trim(referencia));
    pedido text := nullif(trim(segredo_ref), '');
    ref_segredo text;
begin
    if not public.pode_configurar_telefonia(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz cadastra tronco';
    end if;
    if coalesce(formato_discagem, 'tech_ddd_numero') = 'tech_0_csp_ddd_numero' and nullif(trim(csp), '') is null then
        raise exception 'o formato 0 + CSP + DDD + número precisa do CSP da operadora (2 dígitos)';
    end if;
    if nullif(trim(csp), '') is not null and trim(csp) !~ '^[0-9]{2}$' then
        raise exception 'CSP inválido: use 2 dígitos';
    end if;
    -- SQL 103: a senha fica no segredo da empresa; referência fora do padrão, só a equipe informa
    if autenticacao = 'senha' then
        if pedido is not null and pedido <> public.segredo_ref_tronco_voz(empresa, ref) and not public.cuida_voz(empresa) then
            raise exception 'a senha do tronco fica no cofre da empresa: não informe a referência';
        end if;
        ref_segredo := coalesce(pedido,
                                (select t.segredo_ref from public.voz_troncos t
                                  where t.empresa_id = empresa and t.referencia = ref and t.autenticacao = 'senha'),
                                public.segredo_ref_tronco_voz(empresa, ref));
    end if;
    insert into public.voz_troncos as t (empresa_id, referencia, operadora, host, porta, transporte, autenticacao,
                                         usuario, segredo_ref, ddd_origem, bina, formato_discagem, csp, codecs, canais,
                                         cps, ativo)
    values (empresa, ref, trim(operadora), lower(trim(host)), porta, transporte, autenticacao,
            nullif(trim(usuario), ''), ref_segredo, trim(ddd_origem),
            regexp_replace(coalesce(bina, ''), '\D', '', 'g'), coalesce(formato_discagem, 'tech_ddd_numero'),
            nullif(trim(csp), ''), codecs,
            canais, cps, coalesce(ativo, true))
    on conflict on constraint voz_troncos_empresa_id_referencia_key do update
        set operadora = excluded.operadora, host = excluded.host, porta = excluded.porta,
            transporte = excluded.transporte, autenticacao = excluded.autenticacao, segredo_ref = excluded.segredo_ref,
            codecs = excluded.codecs, canais = excluded.canais, cps = excluded.cps, usuario = excluded.usuario,
            ddd_origem = excluded.ddd_origem, bina = excluded.bina, formato_discagem = excluded.formato_discagem,
            csp = excluded.csp,
            ativo = excluded.ativo, atualizado_em = now(),
            -- SQL 103: outra referência (ou IP) = a senha guardada não vale mais
            segredo_guardado_em = case when t.segredo_ref is not distinct from excluded.segredo_ref
                                       then t.segredo_guardado_em end,
            segredo_guardado_por = case when t.segredo_ref is not distinct from excluded.segredo_ref
                                        then t.segredo_guardado_por end,
            segredo_versao = case when t.segredo_ref is not distinct from excluded.segredo_ref then t.segredo_versao end,
            -- mudou como conecta: precisa de teste de novo
            testado_em = case when (t.host, t.porta, t.transporte, t.autenticacao, t.usuario, t.segredo_ref, t.bina, t.formato_discagem, t.csp)
                                   is distinct from (excluded.host, excluded.porta, excluded.transporte,
                                                     excluded.autenticacao, excluded.usuario, excluded.segredo_ref,
                                                     excluded.bina, excluded.formato_discagem, excluded.csp)
                              then null else t.testado_em end,
            teste_ok = case when (t.host, t.porta, t.transporte, t.autenticacao, t.usuario, t.segredo_ref, t.bina, t.formato_discagem, t.csp)
                                 is distinct from (excluded.host, excluded.porta, excluded.transporte,
                                                   excluded.autenticacao, excluded.usuario, excluded.segredo_ref,
                                                   excluded.bina, excluded.formato_discagem, excluded.csp)
                            then null else t.teste_ok end
    returning t.id into tid;
    return tid;
end $$;
revoke all on function public.cadastrar_tronco_voz(bigint, text, text, text, int, text, text, text, text, text, int, text, int, text[], text, boolean, text)
    from public, anon;
grant execute on function public.cadastrar_tronco_voz(bigint, text, text, text, int, text, text, text, text, text, int, text, int, text[], text, boolean, text)
    to authenticated;
