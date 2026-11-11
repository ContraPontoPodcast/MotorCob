-- SQL 105 · Agente Voz/CX › Telefonia, PR T3: o Admin do cliente configura a telefonia dele (G3, G4 e D13 do parecer)
-- Decisão do dono (08/11/2026, SPEC Canais §3.4, §5 e §6.2 item 11): cada cliente pode usar a operadora (tronco SIP)
-- dele e configurar a sua. Modelo aprovado: o Admin do cliente cadastra a operadora com a verificação em duas etapas;
-- a senha vai direto ao cofre (SQL 103); a rota só liga depois do teste e da liberação da equipe MotorCX no firewall
-- (SQL 104).
--
-- 1. Permissão nova do cliente configurar_telefonia ("Configurar a telefonia"), separada de editar_canais. Padrão: só o
--    perfil Admin (o Admin ajusta em Empresa › Perfis, como as outras). Fora do Speech: o perfil Qualidade nunca tem.
-- 2. pode_configurar_telefonia(eid) recriada: a equipe com gerenciar_troncos_voz (como antes) OU a pessoa do cliente
--    com configurar_telefonia, na empresa dela, com o módulo agente_voz ativo E a sessão confirmada pela verificação em
--    duas etapas (aal2). Com isso abrem para o cliente, sem mudar mais nada nelas: cadastrar_tronco_voz,
--    preparar_segredo_tronco_voz (senha no cofre) e definir_ips_voz (IPs da operadora). Liberar os IPs no firewall
--    (liberar_ips_voz) continua só com a equipe: é o segundo passo.
--    Trava de liberação ("a rota só liga depois do teste e da liberação da equipe MotorCX"): hoje a VM usa todo tronco
--    ativo e não olha teste_ok. Por isso o tronco que o cliente cadastra nasce INATIVO, e quando o cliente muda como ele
--    conecta (endereço, autenticação, usuário, senha de referência, bina, formato ou CSP) o tronco volta a inativo. O
--    cliente pode desativar; só a equipe ativa (Console), depois de testar e liberar os IPs. Trocar só a senha no cofre
--    não desativa (zera o teste, como no SQL 103).
-- 3. salvar_rota_voz, encerrar_rota_voz e salvar_transferencia_voz recriadas INTEIRAS (a partir do SQL 56 e do SQL 81)
--    só trocando quem pode por pode_configurar_telefonia. Preço do minuto e vigência seguem as mesmas regras.
--    cadastrar_tronco_voz recriada inteira (a do SQL 103) só com a frase de recusa nova.
-- 4. Leitura do cliente sem segredo (G4): views voz_troncos_empresa e voz_rotas_empresa, para quem é da empresa com o
--    módulo agente_voz (e para a equipe que cuida da voz). voz_troncos_empresa não tem segredo_ref nem quem guardou: só
--    "senha guardada: sim/não" e a data, os IPs e o que falta liberar. A tabela continua só para a equipe e o faturamento.
-- 5. E-mail a todos os Admins da empresa a cada mudança de endereço (host, porta, transporte), autenticação, usuário,
--    senha, bina ou IPs da operadora de um tronco (D13): aviso obrigatório do assunto "Acesso e segurança" (que vira
--    e-mail pela rotina que já existe) com o tronco, o que mudou e quem mudou; nunca o valor da senha. A equipe recebe
--    o mesmo no sino (assunto Avisos da equipe).
-- Depende dos SQL 56, 81, 89 (permissões do Qualidade), 103 e 104. Pode rodar de novo sem erro. Se o SQL 56, o 81 ou o
-- 103 rodarem de novo, rode este depois (eles recriam as RPCs de tronco, rota e transferência ou pode_configurar_telefonia
-- só para a equipe).

-- ================================================================ 1. permissão no catálogo (só o Admin, por padrão)
do $perm$
declare def text; prox int;
begin
    if not exists (select 1 from public.permissoes_catalogo c where c.codigo = 'configurar_telefonia') then
        def := rtrim(btrim(pg_get_viewdef('public.permissoes_catalogo'::regclass)), ';');
        prox := coalesce((select max(ordem) from public.permissoes_catalogo), 0) + 1;
        execute format('create or replace view public.permissoes_catalogo as %s union all select %L::text, %L::text, '
                       '%L::text, %L::text, true, false, false, false, %s', def, 'configurar_telefonia', 'Agente virtual',
                       'Configurar a telefonia',
                       'Operadora (tronco SIP), senha no cofre, IPs, rotas e transferência. Pede a verificação em duas etapas.',
                       prox);
    end if;
end $perm$;
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- ================================================================ 2. quem configura a telefonia
create or replace function public.pode_configurar_telefonia(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select eid is not null
           and (public.cuida_voz(eid)
                or (public.cliente_pode(eid, 'configurar_telefonia')
                    and public.modulo_ativo(eid, 'agente_voz')
                    and public.sessao_aal2()))
$$;
revoke all on function public.pode_configurar_telefonia(bigint) from public, anon;
grant execute on function public.pode_configurar_telefonia(bigint) to authenticated;

-- ================================================================ 3. tronco, rotas e transferência (recriadas inteiras)
-- cadastrar_tronco_voz: a do SQL 103 com a frase de recusa que serve ao Admin do cliente e a trava de liberação: o que o
-- cliente cadastra nasce INATIVO, e mudar como o tronco conecta (endereço, autenticação, usuário, senha, bina, formato ou
-- CSP) desativa o tronco. Só a equipe MotorCX ativa, depois do teste e da liberação dos IPs no firewall.
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
    cliente boolean := not public.cuida_voz(empresa);
    ref text := lower(trim(referencia));
    pedido text := nullif(trim(segredo_ref), '');
    ref_segredo text;
begin
    if not public.pode_configurar_telefonia(empresa) then
        raise exception 'sem permissão para configurar a telefonia (Admin com a verificação em duas etapas, ou a equipe MotorCX)';
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
            canais, cps, case when cliente then false else coalesce(ativo, true) end)
    on conflict on constraint voz_troncos_empresa_id_referencia_key do update
        set operadora = excluded.operadora, host = excluded.host, porta = excluded.porta,
            transporte = excluded.transporte, autenticacao = excluded.autenticacao, segredo_ref = excluded.segredo_ref,
            codecs = excluded.codecs, canais = excluded.canais, cps = excluded.cps, usuario = excluded.usuario,
            ddd_origem = excluded.ddd_origem, bina = excluded.bina, formato_discagem = excluded.formato_discagem,
            csp = excluded.csp,
            -- SQL 105: o cliente desativa, mas não ativa; mudar como conecta desativa (a equipe ativa depois do teste)
            ativo = case when not cliente then excluded.ativo
                         when (t.host, t.porta, t.transporte, t.autenticacao, t.usuario, t.segredo_ref, t.bina,
                               t.formato_discagem, t.csp)
                              is distinct from (excluded.host, excluded.porta, excluded.transporte, excluded.autenticacao,
                                                excluded.usuario, excluded.segredo_ref, excluded.bina,
                                                excluded.formato_discagem, excluded.csp) then false
                         else t.ativo and coalesce(cadastrar_tronco_voz.ativo, true) end,
            atualizado_em = now(),
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

create or replace function public.salvar_rota_voz(empresa bigint, tronco bigint, tech_prefix text, tipo text,
                                                  prioridade int, cadencia_inicial_s int, cadencia_incremento_s int,
                                                  preco_minuto numeric, desde date default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    d date := coalesce(desde, (now() at time zone 'America/Sao_Paulo')::date);
    ant public.voz_rotas;
    rid bigint;
begin
    if not public.pode_configurar_telefonia(empresa) then
        raise exception 'sem permissão para configurar a telefonia (Admin com a verificação em duas etapas, ou a equipe MotorCX)';
    end if;
    if not exists (select 1 from public.voz_troncos t where t.id = tronco and t.empresa_id = empresa and t.ativo) then
        raise exception 'tronco não encontrado ou inativo nesta empresa';
    end if;
    select * into ant from public.voz_rotas r
     where r.empresa_id = empresa and r.tech_prefix = salvar_rota_voz.tech_prefix
     order by r.vigente_desde desc limit 1;
    if ant.id is not null then
        if ant.vigente_desde >= d then
            raise exception 'a nova vigência precisa começar depois de % (vigência atual)', to_char(ant.vigente_desde, 'DD/MM/YYYY');
        end if;
        if ant.vigente_ate is null or ant.vigente_ate >= d then
            update public.voz_rotas r set vigente_ate = d - 1 where r.id = ant.id;
        end if;
    end if;
    insert into public.voz_rotas (empresa_id, tronco_id, prioridade, tech_prefix, tipo, cadencia_inicial_s,
                                  cadencia_incremento_s, preco_minuto, vigente_desde)
    values (empresa, tronco, prioridade, salvar_rota_voz.tech_prefix, tipo, cadencia_inicial_s, cadencia_incremento_s,
            preco_minuto, d)
    returning id into rid;
    return rid;
end $$;
revoke all on function public.salvar_rota_voz(bigint, bigint, text, text, int, int, int, numeric, date) from public, anon;
grant execute on function public.salvar_rota_voz(bigint, bigint, text, text, int, int, int, numeric, date) to authenticated;

create or replace function public.encerrar_rota_voz(rota bigint, ate date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
    r public.voz_rotas;
    a date := coalesce(ate, (now() at time zone 'America/Sao_Paulo')::date);
begin
    select * into r from public.voz_rotas where id = rota;
    if r.id is null or not public.pode_configurar_telefonia(r.empresa_id) then
        raise exception 'rota não encontrada';
    end if;
    if a < r.vigente_desde then
        raise exception 'a rota começa em %', to_char(r.vigente_desde, 'DD/MM/YYYY');
    end if;
    update public.voz_rotas v set vigente_ate = a where v.id = rota;
end $$;
revoke all on function public.encerrar_rota_voz(bigint, date) from public, anon;
grant execute on function public.encerrar_rota_voz(bigint, date) to authenticated;

create or replace function public.salvar_transferencia_voz(empresa bigint, nome text, destino_sip text,
                                                           metodo text default 'ponte', tronco bigint default null,
                                                           tech_prefix text default null, credor bigint default null,
                                                           ativo boolean default true, transferencia bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare tid bigint := transferencia;
begin
    if not public.pode_configurar_telefonia(empresa) then
        raise exception 'sem permissão para configurar a telefonia (Admin com a verificação em duas etapas, ou a equipe MotorCX)';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if tid is null then
        insert into public.voz_transferencias (empresa_id, credor_id, nome, destino_sip, metodo, tronco_id, tech_prefix, ativo)
        values (empresa, credor, trim(nome), trim(destino_sip), metodo, tronco, tech_prefix, coalesce(ativo, true))
        returning id into tid;
    else
        update public.voz_transferencias v
           set credor_id = credor, nome = trim(salvar_transferencia_voz.nome),
               destino_sip = trim(salvar_transferencia_voz.destino_sip), metodo = salvar_transferencia_voz.metodo,
               tronco_id = tronco, tech_prefix = salvar_transferencia_voz.tech_prefix,
               ativo = coalesce(salvar_transferencia_voz.ativo, true), atualizado_em = now(),
               testado_em = case when v.destino_sip = trim(salvar_transferencia_voz.destino_sip) then v.testado_em end,
               teste_ok = case when v.destino_sip = trim(salvar_transferencia_voz.destino_sip) then v.teste_ok end
         where v.id = tid and v.empresa_id = empresa;
        if not found then
            raise exception 'transferência não encontrada';
        end if;
    end if;
    return tid;
end $$;
revoke all on function public.salvar_transferencia_voz(bigint, text, text, text, bigint, text, bigint, boolean, bigint)
    from public, anon;
grant execute on function public.salvar_transferencia_voz(bigint, text, text, text, bigint, text, bigint, boolean, bigint)
    to authenticated;

-- ================================================================ 4. leitura do cliente, sem segredo
-- quem vê a telefonia da empresa: a pessoa do cliente com o módulo agente_voz, e a equipe que cuida da voz
create or replace function public.ve_telefonia(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select eid is not null
           and (public.cuida_voz(eid)
                or (not public.sou_equipe() and eid in (select public.minhas_empresas())
                    and public.modulo_ativo(eid, 'agente_voz')))
$$;
revoke all on function public.ve_telefonia(bigint) from public, anon;
grant execute on function public.ve_telefonia(bigint) to authenticated;

create or replace view public.voz_troncos_empresa with (security_barrier = true) as
    select t.id, t.empresa_id, t.referencia, t.operadora, t.host, t.porta, t.transporte, t.autenticacao, t.usuario,
           t.ddd_origem, t.bina, t.formato_discagem, t.csp, t.codecs, t.canais, t.cps, t.ativo, t.testado_em, t.teste_ok,
           (t.autenticacao = 'senha' and t.segredo_guardado_em is not null) as segredo_no_cofre, t.segredo_guardado_em,
           t.ips_operadora, t.ips_liberados,
           array(select y from unnest(t.ips_operadora) y where not y = any (t.ips_liberados) order by y) as ips_pendentes,
           t.atualizado_em
      from public.voz_troncos t
     where public.ve_telefonia(t.empresa_id);
comment on view public.voz_troncos_empresa is
    'SQL 105: troncos da empresa para a tela Telefonia, sem a referência do segredo (só senha guardada sim/não e a data).';

create or replace view public.voz_rotas_empresa with (security_barrier = true) as
    select r.id, r.empresa_id, r.tronco_id, r.prioridade, r.tech_prefix, r.tipo, r.cadencia_inicial_s,
           r.cadencia_incremento_s, r.preco_minuto, r.vigente_desde, r.vigente_ate
      from public.voz_rotas r
     where public.ve_telefonia(r.empresa_id);
comment on view public.voz_rotas_empresa is 'SQL 105: rotas por tipo de número da empresa para a tela Telefonia.';

revoke all on public.voz_troncos_empresa, public.voz_rotas_empresa from public, anon, authenticated;
grant select on public.voz_troncos_empresa, public.voz_rotas_empresa to authenticated;
grant select on public.voz_troncos_empresa, public.voz_rotas_empresa to service_role;

-- ================================================================ 5. e-mail aos Admins a cada mudança sensível (D13)
create or replace function public.avisar_mudanca_tronco_voz() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    mudou text[] := '{}';
    quem uuid;
    quem_txt text;
    texto text;
begin
    if tg_op = 'INSERT' then
        mudou := array['tronco novo'];
    else
        if (new.host, new.porta, new.transporte) is distinct from (old.host, old.porta, old.transporte) then
            mudou := array_append(mudou, 'endereço'::text);
        end if;
        if (new.autenticacao, new.usuario) is distinct from (old.autenticacao, old.usuario) then
            mudou := array_append(mudou, 'autenticação'::text);
        end if;
        if new.segredo_versao is distinct from old.segredo_versao and new.segredo_versao is not null then
            mudou := array_append(mudou, 'senha'::text);
        end if;
        if new.bina is distinct from old.bina then
            mudou := array_append(mudou, 'bina'::text);
        end if;
        if new.ips_operadora is distinct from old.ips_operadora then
            mudou := array_append(mudou, 'IPs da operadora'::text);
        end if;
    end if;
    if cardinality(mudou) = 0 then
        return new;
    end if;
    quem := coalesce(auth.uid(), case when 'senha' = any (mudou) then new.segredo_guardado_por end);
    select case when p.equipe then 'equipe MotorCX (' || coalesce(nullif(trim(p.nome), ''), 'sem nome') || ')'
                else coalesce(nullif(trim(p.nome), ''), 'um usuário da empresa') end
      into quem_txt from public.perfis p where p.id = quem;
    texto := left('Mudou: ' || array_to_string(mudou, ', ') || '. Por: ' || coalesce(quem_txt, 'rotina do MotorCX')
                  || '. Se não foi alguém da sua empresa ou da equipe MotorCX, avise o suporte agora.', 400);
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, assunto)
    select 'usuario', new.empresa_id, p.id, 'atencao',
           left('Telefonia: o tronco ' || new.referencia || ' foi alterado', 140), texto, '/voz/telefonia', 'seguranca'
      from public.perfis p
     where p.empresa_id = new.empresa_id and p.ativo and not p.equipe and p.papel = 'admin';
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, assunto)
    values ('equipe', new.empresa_id, 'pronto', left('Telefonia do cliente: o tronco ' || new.referencia || ' foi alterado', 140),
            texto, '/console/fornecedores?aba=voz', 'equipe');
    return new;
end $$;
revoke all on function public.avisar_mudanca_tronco_voz() from public, anon, authenticated;
drop trigger if exists voz_troncos_avisar_mudanca on public.voz_troncos;
create trigger voz_troncos_avisar_mudanca after insert or update on public.voz_troncos
    for each row execute function public.avisar_mudanca_tronco_voz();
