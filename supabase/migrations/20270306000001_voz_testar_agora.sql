-- SQL 116 · Canais › Agente de voz › "Testar agora" (PR 9 do plano Canais/Agente Voz/CX; SPEC §1.2, §3.2, §5 e §7).
-- Uma ligação de verdade para um número de teste confirmado da empresa, com o fluxo em uso da carteira e a rota de
-- hoje, pelo mesmo caminho das ligações do lote: a VM confere de novo e aplica as travas de sempre (plano de discagem
-- nacional, horário por UF/DDD, rota pausada, freios de chamadas curtas, CPS e tronco isolado; aviso de gravação e
-- "assistente virtual" na abertura; o credor e a dívida só depois de confirmar a identidade; nunca CPF).
--
-- Nenhum número passa pelo banco nem pelo site. O número de teste fica no cofre (Secret Manager), como em
-- voz_numeros_teste (SQL 114, Telefonia, em paralelo): aqui só o id, a máscara e o hash. A VM pega o pedido com a
-- referência do segredo, lê o número no cofre, confere o hash e liga. Sem o SQL 114 aplicado, o pedido explica o que
-- falta (as funções leem voz_numeros_teste por SQL dinâmico, então este SQL roda antes ou depois do 114).
--
-- 1. voz_testes_agora: um pedido por linha (sem número). Leitura: quem é da empresa (sem o hash); auditada.
-- 2. pedir_teste_agora_voz(credor, numero_teste): quem tem editar_canais (SPEC §5; o teste gasta 1 ligação) ou a
--    equipe que cuida da voz. Confere: Agente de voz fora do Simulado; número da empresa guardado no cofre, confirmado
--    e na lista de teste (voz_config.numeros_teste_hash); fluxo em uso da carteira; rota ativa sem pausa; a empresa não
--    parou pelas chamadas curtas hoje; segunda a sábado (domingo nunca; a VM confere a janela da UF do número); até 5
--    por dia por empresa e um de cada vez. Pedido parado há 10 min (ou ligando há 15) expira.
-- 3. cancelar_teste_agora_voz(teste): quem pediu ou quem pode pedir, enquanto ninguém pegou.
--    numeros_teste_agora_voz(empresa): os números de teste (id, máscara, pronto), para a tela escolher; sem o SQL 114, [].
-- 4. Servidor/VM: pegar_teste_agora_voz(empresas) e concluir_teste_agora_voz(...) (voz_vm.pegar_teste_agora e
--    voz_vm.concluir_teste_agora). Os passos são só marcas e contagens (tocou, atendeu, agente falou, aviso de gravação,
--    identidade confirmada, segundos, SIP), nunca texto da conversa.
-- Depende dos SQL 56/57 (voz), 58 (fluxo), 65 (pausas), 84 (pode_ver_empresa), 106 (amostras) e 109 (liberação).
-- Pode rodar de novo.

-- ================================================================ 1. pedidos
create table if not exists public.voz_testes_agora (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null references public.credores (id) on delete cascade,
    numero_id     bigint not null,                 -- voz_numeros_teste.id (SQL 114; sem FK: corre em paralelo)
    mascara       text not null check (mascara ~ '^\([1-9][1-9]\) [0-9]?•{3,4}-••[0-9]{2}$'),
    hash          text not null check (hash ~ '^[0-9a-f]{64}$'),
    situacao      text not null default 'pedido'
                  check (situacao in ('pedido', 'ligando', 'concluido', 'recusado', 'expirado', 'cancelado')),
    motivo        text check (motivo is null or char_length(motivo) <= 200),
    desfecho      text check (desfecho is null or desfecho ~ '^[a-z_]{1,40}$'),
    passos        jsonb not null default '{}'::jsonb check (jsonb_typeof(passos) = 'object'),
    pedido_por    uuid default auth.uid() references auth.users (id) on delete set null,
    pedido_em     timestamptz not null default now(),
    pego_em       timestamptz,
    concluido_em  timestamptz
);
create index if not exists voz_testes_agora_empresa on public.voz_testes_agora (empresa_id, pedido_em desc);
comment on table public.voz_testes_agora is
    '"Testar agora" do Agente de voz: uma ligação de verdade para um número de teste (sem número: id, máscara e hash; '
    'o número fica no cofre). Só pedir/cancelar/concluir gravam. SQL 116.';
alter table public.voz_testes_agora enable row level security;
drop policy if exists voz_testes_agora_ver on public.voz_testes_agora;
create policy voz_testes_agora_ver on public.voz_testes_agora for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) or public.cuida_voz(empresa_id));
revoke all on public.voz_testes_agora from public, anon, authenticated;
grant select (id, empresa_id, credor_id, numero_id, mascara, situacao, motivo, desfecho, passos, pedido_em, pego_em,
              concluido_em) on public.voz_testes_agora to authenticated;
grant select on public.voz_testes_agora to service_role;
drop trigger if exists z_auditar on public.voz_testes_agora;
create trigger z_auditar after insert or update or delete on public.voz_testes_agora
    for each row execute function public.auditar();

-- limites (SPEC §8, pergunta 8: até 5 por dia; um de cada vez)
create or replace function public.testes_agora_voz_limite() returns int
language sql immutable parallel safe as $$ select 5 $$;

-- pedidos parados: 10 min sem a VM pegar, 15 min ligando sem concluir
create or replace function public.expirar_testes_agora_voz() returns int
language sql security definer set search_path = public as $$
    with x as (
        update public.voz_testes_agora t
           set situacao = 'expirado', concluido_em = now(),
               motivo = case when t.situacao = 'pedido' then 'nenhum servidor de voz pegou o pedido em 10 minutos'
                             else 'a ligação não terminou em 15 minutos' end
         where (t.situacao = 'pedido' and t.pedido_em < now() - interval '10 minutes')
            or (t.situacao = 'ligando' and t.pego_em < now() - interval '15 minutes')
        returning 1)
    select count(*)::int from x
$$;

-- ================================================================ 2. pedir (site)
create or replace function public.pedir_teste_agora_voz(credor bigint, numero_teste bigint) returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    emp bigint;
    cfg public.voz_config;
    n_hash text; n_mascara text; n_conf timestamptz; n_guardado timestamptz;
    agora timestamp := now() at time zone 'America/Sao_Paulo';
    hoje date := public.hoje_sp();
    tot bigint; cur bigint; lib boolean;
    novo bigint;
begin
    select c.empresa_id into emp from public.credores c where c.id = credor;
    if emp is null or not public.pode_ver_empresa(emp)
       or not ((public.pode('editar_canais') and emp in (select public.minhas_empresas())) or public.cuida_voz(emp)) then
        raise exception 'sem permissão para testar o canal (editar canais)';
    end if;
    select * into cfg from public.voz_config c where c.empresa_id = emp;
    if cfg.empresa_id is null then
        raise exception 'a empresa ainda não tem o Agente de voz configurado';
    end if;
    if cfg.modo = 'simulado' then
        raise exception 'o Agente de voz está em Simulado: nenhuma ligação sai. Use "Testar conversa" no Agente de voz, ou peça à equipe MotorCX o modo Só números de teste';
    end if;
    if to_regclass('public.voz_numeros_teste') is null then
        raise exception 'cadastre um número de teste em Agente Voz/CX › Telefonia (os números de teste chegam com a Telefonia)';
    end if;
    execute 'select n.hash, n.mascara, n.confirmado_em, n.guardado_em from public.voz_numeros_teste n
              where n.id = $1 and n.empresa_id = $2'
       into n_hash, n_mascara, n_conf, n_guardado using numero_teste, emp;
    if n_hash is null then
        raise exception 'número de teste não encontrado nesta empresa';
    end if;
    if n_guardado is null then
        raise exception 'o número de teste ainda não foi guardado no cofre: cadastre de novo em Telefonia';
    end if;
    if n_conf is null or not (lower(n_hash) = any (cfg.numeros_teste_hash)) then
        raise exception 'o número de teste ainda não foi confirmado: confirme com o código no teste da rota (Telefonia)';
    end if;
    if not exists (select 1 from public.voz_fluxo_versoes v
                    where v.empresa_id = emp and v.situacao = 'em_uso' and (v.credor_id = credor or v.credor_id is null)) then
        raise exception 'a carteira não tem fluxo em uso: aprove um fluxo em Agente Voz/CX › Agente de voz';
    end if;
    if not exists (select 1 from public.voz_troncos t
                    where t.empresa_id = emp and t.ativo
                      and not exists (select 1 from public.voz_troncos_pausas p
                                       where p.tronco_id = t.id and p.empresa_id = emp and p.retomado_em is null)) then
        raise exception 'nenhuma rota ativa: o tronco está desligado ou pausado (veja Agente Voz/CX › Telefonia)';
    end if;
    select coalesce(sum(a.discadas), 0), coalesce(sum(a.curtas), 0) into tot, cur
      from public.voz_ritmo_amostras a where a.empresa_id = emp and a.dia = hoje;
    lib := exists (select 1 from public.voz_curtas_liberacoes l where l.empresa_id = emp and l.dia = hoje);
    if tot >= (case when lib then 9500 else 8000 end) and 100 * cur >= 80 * tot then
        raise exception 'a empresa parou de ligar hoje pelas chamadas curtas (volta amanhã às 08:00)';
    end if;
    if extract(isodow from agora) = 7 then
        raise exception 'domingo não liga: teste de segunda a sábado, no horário do estado do número';
    end if;
    perform public.expirar_testes_agora_voz();
    perform pg_advisory_xact_lock(hashtext('voz_testes_agora'), emp::int);
    if exists (select 1 from public.voz_testes_agora t where t.empresa_id = emp and t.situacao in ('pedido', 'ligando')) then
        raise exception 'já há um teste em andamento: espere o resultado';
    end if;
    if (select count(*) from public.voz_testes_agora t
         where t.empresa_id = emp and (t.pedido_em at time zone 'America/Sao_Paulo')::date = hoje
           and t.situacao <> 'cancelado') >= public.testes_agora_voz_limite() then
        raise exception 'limite de % testes por dia atingido: tente amanhã', public.testes_agora_voz_limite();
    end if;
    insert into public.voz_testes_agora (empresa_id, credor_id, numero_id, mascara, hash)
    values (emp, credor, numero_teste, n_mascara, lower(n_hash))
    returning id into novo;
    return novo;
end $$;

-- os números de teste que o "Testar agora" pode usar (só id e máscara; prontos = guardados, confirmados e na lista)
create or replace function public.numeros_teste_agora_voz(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
    if empresa is null or not public.pode_ver_empresa(empresa)
       or not ((public.pode('editar_canais') and empresa in (select public.minhas_empresas())) or public.cuida_voz(empresa)) then
        raise exception 'sem permissão para testar o canal (editar canais)';
    end if;
    if to_regclass('public.voz_numeros_teste') is null then
        return '[]'::jsonb;
    end if;
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'', n.id, ''mascara'', n.mascara,
                    ''pronto'', n.guardado_em is not null and n.confirmado_em is not null
                                and lower(n.hash) = any (coalesce(c.numeros_teste_hash, ''{}''))) order by n.id), ''[]'')
               from public.voz_numeros_teste n left join public.voz_config c on c.empresa_id = n.empresa_id
              where n.empresa_id = $1'
       into r using empresa;
    return r;
end $$;

create or replace function public.cancelar_teste_agora_voz(teste bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t public.voz_testes_agora;
begin
    select * into t from public.voz_testes_agora x where x.id = teste for update;
    if t.id is null or not (t.pedido_por = auth.uid()
                            or (public.pode('editar_canais') and t.empresa_id in (select public.minhas_empresas()))
                            or public.cuida_voz(t.empresa_id)) then
        raise exception 'teste não encontrado';
    end if;
    if t.situacao <> 'pedido' then
        raise exception 'o teste já começou: espere o resultado';
    end if;
    update public.voz_testes_agora x set situacao = 'cancelado', concluido_em = now(), motivo = 'cancelado por quem pediu'
     where x.id = teste;
end $$;

-- ================================================================ 3. servidor / VM
create or replace function public.pegar_teste_agora_voz(empresas bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    t public.voz_testes_agora;
    ref text;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    perform public.expirar_testes_agora_voz();
    select * into t from public.voz_testes_agora x
     where x.situacao = 'pedido' and x.empresa_id = any (empresas)
     order by x.pedido_em limit 1 for update skip locked;
    if t.id is null then
        return null;
    end if;
    if to_regclass('public.voz_numeros_teste') is not null then
        execute 'select n.segredo_ref from public.voz_numeros_teste n
                  where n.id = $1 and n.empresa_id = $2 and n.hash = $3 and n.guardado_em is not null'
           into ref using t.numero_id, t.empresa_id, t.hash;
    end if;
    if ref is null then
        update public.voz_testes_agora x set situacao = 'recusado', concluido_em = now(),
               motivo = 'o número de teste foi removido ou trocado depois do pedido'
         where x.id = t.id;
        return null;
    end if;
    update public.voz_testes_agora x set situacao = 'ligando', pego_em = now() where x.id = t.id;
    return jsonb_build_object('id', t.id, 'empresa_id', t.empresa_id, 'credor_id', t.credor_id, 'hash', t.hash,
                              'segredo_ref', ref);
end $$;

create or replace function public.concluir_teste_agora_voz(teste bigint, situacao text, desfecho text default null,
                                                           passos jsonb default '{}'::jsonb, motivo text default null)
returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    t public.voz_testes_agora;
    k text; v jsonb;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into t from public.voz_testes_agora x where x.id = teste for update;
    if t.id is null or t.situacao <> 'ligando' then
        raise exception 'teste não está ligando';
    end if;
    if situacao not in ('concluido', 'recusado') then
        raise exception 'situacao: concluido ou recusado';
    end if;
    if desfecho is not null and desfecho !~ '^[a-z_]{1,40}$' then
        raise exception 'desfecho inválido';
    end if;
    if passos is null or jsonb_typeof(passos) <> 'object' then
        raise exception 'passos: objeto';
    end if;
    for k, v in select * from jsonb_each(passos) loop
        if k in ('tocou', 'atendeu', 'agente', 'gravada', 'aviso_gravacao', 'identidade_confirmada', 'transferiu') then
            if jsonb_typeof(v) <> 'boolean' then raise exception 'passo %: verdadeiro ou falso', k; end if;
        elsif k in ('segundos', 'toque_s') then
            if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 7200 then
                raise exception 'passo %: segundos de 0 a 7200', k;
            end if;
        elsif k = 'sip' then
            if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 100 and 699 then
                raise exception 'passo sip: código de 100 a 699';
            end if;
        else
            raise exception 'passo desconhecido: %', k;
        end if;
    end loop;
    if motivo is not null and (char_length(motivo) > 200 or not public.texto_sem_dado_pessoal(motivo)) then
        raise exception 'motivo: até 200 caracteres, sem CPF, telefone ou e-mail';
    end if;
    update public.voz_testes_agora x
       set situacao = concluir_teste_agora_voz.situacao, desfecho = concluir_teste_agora_voz.desfecho,
           passos = concluir_teste_agora_voz.passos, motivo = concluir_teste_agora_voz.motivo, concluido_em = now()
     where x.id = teste;
end $$;

revoke all on function public.testes_agora_voz_limite(), public.expirar_testes_agora_voz(),
    public.pedir_teste_agora_voz(bigint, bigint), public.cancelar_teste_agora_voz(bigint),
    public.numeros_teste_agora_voz(bigint), public.pegar_teste_agora_voz(bigint[]), public.concluir_teste_agora_voz(bigint, text, text, jsonb, text)
    from public, anon, authenticated;
grant execute on function public.testes_agora_voz_limite() to authenticated, service_role;
grant execute on function public.pedir_teste_agora_voz(bigint, bigint), public.cancelar_teste_agora_voz(bigint),
    public.numeros_teste_agora_voz(bigint) to authenticated;
grant execute on function public.expirar_testes_agora_voz(), public.pegar_teste_agora_voz(bigint[]),
    public.concluir_teste_agora_voz(bigint, text, text, jsonb, text) to service_role;

create or replace function voz_vm.pegar_teste_agora(args jsonb) returns jsonb
language sql security definer set search_path = '' as $$
    select public.pegar_teste_agora_voz(array(select e::bigint
                                                 from jsonb_array_elements_text(coalesce(args -> 'empresas', '[]')) e))
$$;
create or replace function voz_vm.concluir_teste_agora(args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
    perform public.concluir_teste_agora_voz((args ->> 'teste')::bigint, args ->> 'situacao', args ->> 'desfecho',
                                            coalesce(args -> 'passos', '{}'::jsonb), args ->> 'motivo');
    return null;
end $$;
revoke all on function voz_vm.pegar_teste_agora(jsonb), voz_vm.concluir_teste_agora(jsonb)
    from public, anon, authenticated, service_role;
grant execute on function voz_vm.pegar_teste_agora(jsonb), voz_vm.concluir_teste_agora(jsonb) to motorcx_voz;
