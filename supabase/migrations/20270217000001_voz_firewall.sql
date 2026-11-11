-- SQL 104 · Agente Voz/CX › Telefonia, PR T2: IPs da operadora por tronco e firewall das VMs a partir do cadastro (G6)
-- Decisão do dono (SPEC Canais §3.4, §6.2 item 10 e §7): cada cliente usa a operadora dele; o firewall das VMs de voz
-- (regras motorcx-voz-sip e motorcx-voz-rtp) precisa aceitar o IP da operadora, senão a ligação completa sem áudio ou
-- fica "pendurada" (o BYE de outro IP é barrado). Hoje a lista é à mão em infra/asterisk/criar_gcp.sh. Agora:
--
-- 1. voz_troncos e voz_transferencias ganham ips_operadora (o que o cadastro pede: IPs do SBC da operadora, sinalização e
--    áudio; na transferência, os IPs do PABX/discador do cliente) e ips_liberados / ips_liberados_em / ips_liberados_por
--    (o que a equipe MotorCX conferiu e liberou). Regra dos IPs (voz_ips_motivo, igual à VM em voz/firewall.py): de 0 a
--    20 itens, só IPv4, faixa até /24 (nunca 0.0.0.0/0), nunca rede interna/reservada/loopback (voz_faixas_reservadas)
--    nem IP do próprio MotorCX (voz_enderecos_motorcx). Gatilho voz_ips_seguros: vale no cadastro e quando a lista muda.
-- 2. Revisão em dois passos (primeira versão, SPEC §7): quem configura a telefonia grava a lista (definir_ips_voz); só a
--    equipe com gerenciar_troncos_voz e a sessão em aal2 libera (liberar_ips_voz), e a equipe recebe aviso no sino
--    quando há IP esperando. Tirar um IP da lista vale na hora: o liberado é sempre a interseção com a lista atual.
-- 3. O que entra no firewall (origens_firewall_voz, só o servidor; voz_vm.origens_firewall para a VM): os IPs liberados
--    que ainda estão na lista, de troncos e transferências ativos, conferidos de novo. A VM (voz/firewall.py, a cada
--    2 minutos) junta com a lista fixa do criar_gcp.sh, confere de novo e só então atualiza as duas regras do GCP;
--    cada mudança vai para voz_firewall_eventos (registrar_firewall_voz / voz_vm.registrar_firewall).
-- Depende dos SQL 56/57 (voz, voz_vm), 83 (voz_faixas_reservadas, voz_enderecos_motorcx) e 103 (pode_configurar_telefonia).
-- Pode rodar de novo sem erro. Nenhum tronco existente muda: as listas começam vazias (o firewall continua com a lista
-- fixa do criar_gcp.sh até a equipe liberar os IPs de cada tronco).

-- ================================================================ 1. colunas
alter table public.voz_troncos add column if not exists ips_operadora cidr[] not null default '{}';
alter table public.voz_troncos add column if not exists ips_liberados cidr[] not null default '{}';
alter table public.voz_troncos add column if not exists ips_liberados_em timestamptz;
alter table public.voz_troncos add column if not exists ips_liberados_por uuid references auth.users (id) on delete set null;
alter table public.voz_transferencias add column if not exists ips_operadora cidr[] not null default '{}';
alter table public.voz_transferencias add column if not exists ips_liberados cidr[] not null default '{}';
alter table public.voz_transferencias add column if not exists ips_liberados_em timestamptz;
alter table public.voz_transferencias add column if not exists ips_liberados_por uuid references auth.users (id) on delete set null;
comment on column public.voz_troncos.ips_operadora is
    'SQL 104: IPs (ou faixas até /24) do SBC da operadora, sinalização e áudio. Entram no firewall das VMs depois que a '
    'equipe MotorCX libera (ips_liberados).';
comment on column public.voz_troncos.ips_liberados is
    'SQL 104: IPs que a equipe MotorCX conferiu e liberou no firewall. Vale só o que ainda está em ips_operadora.';
comment on column public.voz_transferencias.ips_operadora is
    'SQL 104: IPs do PABX/discador do cliente (a mídia da ponte vem dele). Mesma regra e mesma liberação dos troncos.';

-- ================================================================ 2. regra dos IPs (cópia de voz/firewall.py › motivo_origem)
-- motivo (uma frase, sem o endereço) ou null
create or replace function public.voz_ips_motivo(ips cidr[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare x cidr;
begin
    if ips is null then
        return 'lista de IPs vazia';
    end if;
    if cardinality(ips) > 20 then
        return 'no máximo 20 IPs ou faixas';
    end if;
    if (select count(distinct y) from unnest(ips) y) <> cardinality(ips) then
        return 'IP repetido na lista';
    end if;
    foreach x in array ips loop
        if family(x) <> 4 then
            return 'só IPv4';
        end if;
        if masklen(x) < 24 then
            return 'faixa grande demais: no máximo /24 (256 endereços)';
        end if;
        if exists (select 1 from unnest(public.voz_faixas_reservadas()) f where x && f) then
            return 'endereço em rede interna, reservada ou de loopback';
        end if;
        if exists (select 1 from public.voz_enderecos_motorcx m where x && m.faixa) then
            return 'endereço do próprio MotorCX';
        end if;
    end loop;
    return null;
end $$;
revoke all on function public.voz_ips_motivo(cidr[]) from public, anon;
grant execute on function public.voz_ips_motivo(cidr[]) to authenticated, service_role;

-- texto da tela → cidr[] (1.2.3.4 vira 1.2.3.4/32; 1.2.3.9/24 vira 1.2.3.0/24), sem repetição, em ordem
create or replace function public.normalizar_ips_voz(ips text[]) returns cidr[]
language plpgsql immutable set search_path = public as $$
declare
    saida cidr[] := '{}';
    t text;
    c cidr;
begin
    foreach t in array coalesce(ips, '{}') loop
        t := btrim(t);
        continue when t = '';
        if t !~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$' then
            raise exception 'IP inválido: use o formato 200.100.50.10 ou 200.100.50.0/24';
        end if;
        begin
            c := network(t::inet);
        exception when others then
            raise exception 'IP inválido: use o formato 200.100.50.10 ou 200.100.50.0/24';
        end;
        if not c = any (saida) then
            saida := saida || c;
        end if;
    end loop;
    return (select coalesce(array_agg(x order by x), '{}') from unnest(saida) x);
end $$;
revoke all on function public.normalizar_ips_voz(text[]) from public, anon;
grant execute on function public.normalizar_ips_voz(text[]) to authenticated, service_role;

-- a lista vale no cadastro e quando muda; tirar um IP tira também da liberação, na hora
create or replace function public.voz_ips_seguros() returns trigger
language plpgsql security definer set search_path = public as $$
declare m text;
begin
    if tg_op = 'INSERT' or new.ips_operadora is distinct from old.ips_operadora then
        m := public.voz_ips_motivo(new.ips_operadora);
        if m is not null then
            raise exception 'IPs da operadora recusados: %', m;
        end if;
    end if;
    new.ips_liberados := (select coalesce(array_agg(x order by x), '{}') from unnest(new.ips_liberados) x
                           where x = any (new.ips_operadora));
    return new;
end $$;
revoke all on function public.voz_ips_seguros() from public, anon, authenticated;
drop trigger if exists voz_ips_seguros on public.voz_troncos;
create trigger voz_ips_seguros before insert or update on public.voz_troncos
    for each row execute function public.voz_ips_seguros();
drop trigger if exists voz_ips_seguros on public.voz_transferencias;
create trigger voz_ips_seguros before insert or update on public.voz_transferencias
    for each row execute function public.voz_ips_seguros();

-- ================================================================ 3. gravar a lista e liberar (dois passos)
create or replace function public.definir_ips_voz(tipo text, id bigint, ips text[]) returns cidr[]
language plpgsql security definer set search_path = public as $$
declare
    eid bigint;
    nome text;
    lista cidr[] := public.normalizar_ips_voz(ips);
    pendentes cidr[];
begin
    if tipo = 'tronco' then
        select t.empresa_id, t.referencia into eid, nome from public.voz_troncos t where t.id = definir_ips_voz.id;
    elsif tipo = 'transferencia' then
        select t.empresa_id, t.nome into eid, nome from public.voz_transferencias t where t.id = definir_ips_voz.id;
    else
        raise exception 'tipo inválido: tronco ou transferencia';
    end if;
    if eid is null or not public.pode_configurar_telefonia(eid) then
        raise exception 'não encontrado';
    end if;
    if tipo = 'tronco' then
        update public.voz_troncos t set ips_operadora = lista, atualizado_em = now() where t.id = definir_ips_voz.id
        returning (select coalesce(array_agg(x order by x), '{}') from unnest(t.ips_operadora) x
                    where not x = any (t.ips_liberados)) into pendentes;
    else
        update public.voz_transferencias t set ips_operadora = lista, atualizado_em = now() where t.id = definir_ips_voz.id
        returning (select coalesce(array_agg(x order by x), '{}') from unnest(t.ips_operadora) x
                    where not x = any (t.ips_liberados)) into pendentes;
    end if;
    -- a equipe vê no sino que há IP esperando liberação (um aviso por lista; repetir a mesma lista não duplica)
    if cardinality(pendentes) > 0 then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave, assunto)
        values ('equipe', eid, 'atencao', left('Telefonia: IPs para liberar no firewall · ' || nome, 140),
                cardinality(pendentes) || ' IP(s) da operadora esperando a conferência da equipe MotorCX.',
                '/console/fornecedores?aba=voz',
                left('firewall_voz:' || tipo || ':' || definir_ips_voz.id || ':' || md5(pendentes::text), 200), 'equipe')
        on conflict (chave) where chave is not null do nothing;
    end if;
    return pendentes;
end $$;
revoke all on function public.definir_ips_voz(text, bigint, text[]) from public, anon;
grant execute on function public.definir_ips_voz(text, bigint, text[]) to authenticated;

-- só a equipe (gerenciar_troncos_voz), com a verificação em duas etapas: libera exatamente a lista atual
create or replace function public.liberar_ips_voz(tipo text, id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
    eid bigint;
    lista cidr[];
    m text;
begin
    if tipo = 'tronco' then
        select t.empresa_id, t.ips_operadora into eid, lista from public.voz_troncos t where t.id = liberar_ips_voz.id;
    elsif tipo = 'transferencia' then
        select t.empresa_id, t.ips_operadora into eid, lista from public.voz_transferencias t where t.id = liberar_ips_voz.id;
    else
        raise exception 'tipo inválido: tronco ou transferencia';
    end if;
    if eid is null or not public.cuida_voz(eid) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz libera IPs no firewall';
    end if;
    if not public.sessao_aal2() then
        raise exception 'confirme a verificação em duas etapas para liberar IPs no firewall';
    end if;
    m := public.voz_ips_motivo(lista);          -- confere de novo (a lista do MotorCX pode ter mudado)
    if m is not null then
        raise exception 'IPs da operadora recusados: %', m;
    end if;
    if tipo = 'tronco' then
        update public.voz_troncos t set ips_liberados = lista, ips_liberados_em = now(), ips_liberados_por = auth.uid(),
               atualizado_em = now() where t.id = liberar_ips_voz.id;
    else
        update public.voz_transferencias t set ips_liberados = lista, ips_liberados_em = now(),
               ips_liberados_por = auth.uid(), atualizado_em = now() where t.id = liberar_ips_voz.id;
    end if;
    return cardinality(lista);
end $$;
revoke all on function public.liberar_ips_voz(text, bigint) from public, anon;
grant execute on function public.liberar_ips_voz(text, bigint) to authenticated;

-- o que a equipe tem para conferir (Console)
create or replace function public.ips_voz_pendentes()
returns table (empresa_id bigint, empresa text, tipo text, id bigint, nome text, pendentes cidr[], liberados cidr[])
language sql stable security definer set search_path = public as $$
    select x.empresa_id, e.nome, x.tipo, x.id, x.nome, x.pendentes, x.liberados
      from (select t.empresa_id, 'tronco'::text as tipo, t.id, t.referencia as nome, t.ips_liberados as liberados,
                   array(select y from unnest(t.ips_operadora) y where not y = any (t.ips_liberados) order by y) as pendentes
              from public.voz_troncos t where t.ativo
            union all
            select v.empresa_id, 'transferencia', v.id, v.nome, v.ips_liberados,
                   array(select y from unnest(v.ips_operadora) y where not y = any (v.ips_liberados) order by y)
              from public.voz_transferencias v where v.ativo) x
      join public.empresas e on e.id = x.empresa_id
     where cardinality(x.pendentes) > 0 and public.cuida_voz(x.empresa_id)
     order by e.nome, x.tipo, x.nome
$$;
revoke all on function public.ips_voz_pendentes() from public, anon;
grant execute on function public.ips_voz_pendentes() to authenticated;

-- ================================================================ 4. o que entra no firewall (servidor e VM)
create or replace function public.origens_firewall_voz()
returns table (origem cidr, empresa_id bigint, tipo text, ref_id bigint)
language sql stable security definer set search_path = public as $$
    select o.origem, o.empresa_id, o.tipo, o.ref_id
      from (select y as origem, t.empresa_id, 'tronco'::text as tipo, t.id as ref_id
              from public.voz_troncos t, unnest(t.ips_liberados) y
             where t.ativo and y = any (t.ips_operadora)
            union all
            select y, v.empresa_id, 'transferencia', v.id
              from public.voz_transferencias v, unnest(v.ips_liberados) y
             where v.ativo and y = any (v.ips_operadora)) o
     where (public.chamada_do_servidor() or public.chamada_da_vm_voz())
       and public.voz_ips_motivo(array[o.origem]) is null
     order by o.origem, o.empresa_id, o.tipo, o.ref_id
$$;
revoke all on function public.origens_firewall_voz() from public, anon, authenticated;
grant execute on function public.origens_firewall_voz() to service_role;

create table if not exists public.voz_firewall_eventos (
    id          bigint generated always as identity primary key,
    em          timestamptz not null default now(),
    vm          text not null check (vm ~ '^[a-z0-9-]{1,63}$'),
    origens     int not null check (origens >= 0),
    adicionadas cidr[] not null default '{}',
    removidas   cidr[] not null default '{}',
    ok          boolean not null,
    detalhe     text check (char_length(detalhe) <= 300)
);
create index if not exists voz_firewall_eventos_em on public.voz_firewall_eventos (em desc);
comment on table public.voz_firewall_eventos is
    'SQL 104: cada atualização das regras motorcx-voz-sip/rtp feita pela VM (quantas origens, o que entrou e saiu, '
    'erro). Só a equipe com gerenciar_troncos_voz lê.';
alter table public.voz_firewall_eventos enable row level security;
drop policy if exists voz_firewall_eventos_ver on public.voz_firewall_eventos;
create policy voz_firewall_eventos_ver on public.voz_firewall_eventos for select to authenticated
    using (public.equipe_pode('gerenciar_troncos_voz', null));
revoke all on public.voz_firewall_eventos from anon, authenticated;
grant select on public.voz_firewall_eventos to authenticated;
grant all on public.voz_firewall_eventos to service_role;

create or replace function public.registrar_firewall_voz(evento jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare eid bigint;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a VM de voz registra o firewall';
    end if;
    if jsonb_typeof(evento) <> 'object'
       or exists (select 1 from jsonb_object_keys(evento) k
                   where k not in ('vm', 'origens', 'adicionadas', 'removidas', 'ok', 'detalhe')) then
        raise exception 'evento: só vm, origens, adicionadas, removidas, ok e detalhe';
    end if;
    insert into public.voz_firewall_eventos (vm, origens, adicionadas, removidas, ok, detalhe)
    values (evento ->> 'vm', (evento ->> 'origens')::int,
            coalesce((select array_agg(x::cidr) from jsonb_array_elements_text(evento -> 'adicionadas') x), '{}'),
            coalesce((select array_agg(x::cidr) from jsonb_array_elements_text(evento -> 'removidas') x), '{}'),
            (evento ->> 'ok')::boolean, left(evento ->> 'detalhe', 300))
    returning id into eid;
    return eid;
end $$;
revoke all on function public.registrar_firewall_voz(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_firewall_voz(jsonb) to service_role;

-- VM com acesso próprio (motorcx_voz, SQL 57): as mesmas duas, pelo schema voz_vm (args jsonb, como o corpo do PostgREST)
create or replace function voz_vm.origens_firewall(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(jsonb_build_object('origem', o.origem::text, 'empresa_id', o.empresa_id, 'tipo', o.tipo,
                                                 'ref_id', o.ref_id)), '[]'::jsonb)
      from public.origens_firewall_voz() o
$$;
create or replace function voz_vm.registrar_firewall(args jsonb) returns jsonb
language sql security definer set search_path = '' as $$
    select to_jsonb(public.registrar_firewall_voz(args -> 'evento'))
$$;
revoke all on function voz_vm.origens_firewall(jsonb), voz_vm.registrar_firewall(jsonb)
    from public, anon, authenticated, service_role;
grant execute on function voz_vm.origens_firewall(jsonb), voz_vm.registrar_firewall(jsonb) to motorcx_voz;
