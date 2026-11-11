-- SQL 113 · Agente Voz/CX › Telefonia, PR T4: os campos que a operadora pede (seção E do parecer, G10, G12, G13, G14,
-- G35, C4, C17 e D5)
-- Decisão do dono (08/11/2026, SPEC Canais §3.4 e §6.2 item 12): o assistente "Adicionar tronco" pede o que a operadora
-- costuma pedir, com o Avançado recolhido e com padrão. Este SQL só cria os campos e as regras no banco; a tela vem no
-- PR T5 (SQL 114) e o disjuntor no PR T6 (SQL 115).
--
-- 1. voz_troncos ganha (todos com padrão: o tronco que já existe continua igual):
--    - declaracao_em / declaracao_por: o Admin declarou que o contrato com a operadora e a bina são da empresa (ou do
--      credor que autorizou). Obrigatória para o cliente no tronco novo e a cada troca de bina (C4, campos 4 e 19).
--    - autenticacao_operadora: a operadora autentica as ligações (Origem Verificada / STIR-SHAKEN)? sim / nao / nao_sei
--      (padrão nao_sei; a tela mostra o aviso amarelo com nao e nao_sei). Campo 20, G35.
--    - dtmf: como as teclas chegam (auto = RFC 4733 e, se a operadora não oferecer, no áudio; rfc4733; inband; info).
--      Antes era fixo em RFC 4733 (G10). Campo 16.
--    - realm e from_usuario: domínio de autenticação e o número/usuário no "De" (só se a operadora pedir). G12, campos 8 e 9.
--    - cabecalho_bina: como a bina vai na ligação: from_pai (De + P-Asserted-Identity, o de hoje), from (só De) ou rpid
--      (Remote-Party-ID). G12, campo 23.
--    - tech_prefix: prefixo da operadora do tronco, OPCIONAL (C17, campo 26); vira o padrão das rotas novas na tela.
--    - toque_max_s (30 s; 15 a 45) e duracao_max_min (20 min; 5 a 60): D5, campos 29 e 30. O servidor de voz desiste da
--      ligação que não atende nesse tempo e derruba a ligação pendurada.
--    - verificar_options: o MotorCX pergunta a cada 60 s se a operadora está no ar (OPTIONS). Padrão ligado. Campo 17.
--    - liga_para: o tronco liga para fixo e móvel, só fixo ou só móvel (a tela cria as rotas por tipo). Campo 3.
--    - retorno_bina: "quem liga de volta para a bina cai em" (texto curto, informativo, sem dado pessoal). Campo 21.
-- 2. formato_discagem ganha tech_e164 (+55 DDD número, G13, campo 24).
-- 3. Bina única por operadora: a mesma bina não pode estar em tronco de OUTRA operadora da mesma empresa (C4, campo 18).
-- 4. Rota com prefixo opcional (G14, C17): voz_rotas.enviar_prefixo. Prefixo em branco na rota = não manda prefixo; o
--    banco guarda um código interno da rota em tech_prefix (a chave da vigência e da tarifação continua a mesma, sem
--    mexer no custo), reaproveitado pela vigência nova do mesmo tronco e tipo: a chave da vigência sem prefixo passa a
--    ser (tronco, tipo). salvar_rota_voz recriada inteira (a do SQL 105) com isso, e aceita tronco inativo da empresa
--    (a rota de tronco inativo não disca: o servidor de voz só usa rota de tronco ativo; a tela cria as rotas antes da
--    equipe ativar o tronco).
-- 5. cadastrar_tronco_voz recriada inteira (a do SQL 105, MESMA assinatura: o Console e as chamadas de hoje seguem
--    iguais) com a declaração do cliente; RPC nova salvar_tronco_voz(empresa, tronco jsonb) com TODOS os campos da
--    seção E (a tela do PR T5 chama esta): cadastra pelo cadastrar_tronco_voz e grava os campos novos. Chave ausente =
--    mantém (ou o padrão); texto vazio limpa realm, from_usuario, tech_prefix e retorno_bina. Mudar realm, from_usuario,
--    cabecalho_bina ou dtmf também zera o teste e, para o cliente, desativa o tronco (como mudar endereço ou bina).
-- 6. Leitura dos campos novos em views próprias: voz_troncos_campos_empresa e voz_rotas_prefixo_empresa (tela do
--    cliente, mesma regra do SQL 105) e voz_vm.troncos_campos / voz_vm.rotas_prefixo (servidor de voz).
-- Depende dos SQL 56, 57, 80, 103, 104 e 105. Pode rodar de novo sem erro. Se o SQL 56, 81, 103 ou 105 rodar de novo,
-- rode este depois (eles recriam cadastrar_tronco_voz e salvar_rota_voz).

-- ================================================================ 1. campos novos do tronco
alter table public.voz_troncos add column if not exists declaracao_em timestamptz;
alter table public.voz_troncos add column if not exists declaracao_por uuid references auth.users (id) on delete set null;
alter table public.voz_troncos add column if not exists autenticacao_operadora text not null default 'nao_sei';
alter table public.voz_troncos add column if not exists dtmf text not null default 'auto';
alter table public.voz_troncos add column if not exists realm text;
alter table public.voz_troncos add column if not exists from_usuario text;
alter table public.voz_troncos add column if not exists cabecalho_bina text not null default 'from_pai';
alter table public.voz_troncos add column if not exists tech_prefix text;
alter table public.voz_troncos add column if not exists toque_max_s int not null default 30;
alter table public.voz_troncos add column if not exists duracao_max_min int not null default 20;
alter table public.voz_troncos add column if not exists verificar_options boolean not null default true;
alter table public.voz_troncos add column if not exists liga_para text not null default 'fixo_movel';
alter table public.voz_troncos add column if not exists retorno_bina text;

do $chk$
declare c record;
begin
    for c in select * from (values
        ('voz_troncos_autenticacao_operadora_check', 'check (autenticacao_operadora in (''sim'', ''nao'', ''nao_sei''))'),
        ('voz_troncos_dtmf_check', 'check (dtmf in (''auto'', ''rfc4733'', ''inband'', ''info''))'),
        ('voz_troncos_realm_check', 'check (realm ~ ''^[A-Za-z0-9]([A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*$'' and char_length(realm) <= 253)'),
        ('voz_troncos_from_usuario_check', 'check (from_usuario ~ ''^[A-Za-z0-9_.+\-]{1,64}$'')'),
        ('voz_troncos_cabecalho_bina_check', 'check (cabecalho_bina in (''from_pai'', ''from'', ''rpid''))'),
        ('voz_troncos_tech_prefix_check', 'check (tech_prefix ~ ''^[0-9]{1,8}$'')'),
        ('voz_troncos_toque_max_s_check', 'check (toque_max_s between 15 and 45)'),
        ('voz_troncos_duracao_max_min_check', 'check (duracao_max_min between 5 and 60)'),
        ('voz_troncos_liga_para_check', 'check (liga_para in (''fixo_movel'', ''fixo'', ''movel''))'),
        ('voz_troncos_retorno_bina_check', 'check (char_length(trim(retorno_bina)) between 2 and 80 and public.texto_sem_dado_pessoal(retorno_bina))')
    ) v(nome, def) loop
        if not exists (select 1 from pg_constraint where conname = c.nome and conrelid = 'public.voz_troncos'::regclass) then
            execute format('alter table public.voz_troncos add constraint %I %s', c.nome, c.def);
        end if;
    end loop;
    -- 2. formato E.164 (+55): recria o check do formato (o nome é o do SQL 56)
    if not exists (select 1 from pg_constraint where conname = 'voz_troncos_formato_discagem_check'
                    and conrelid = 'public.voz_troncos'::regclass
                    and pg_get_constraintdef(oid) like '%tech_e164%') then
        alter table public.voz_troncos drop constraint if exists voz_troncos_formato_discagem_check;
        alter table public.voz_troncos add constraint voz_troncos_formato_discagem_check
            check (formato_discagem in ('tech_ddd_numero', 'tech_0_csp_ddd_numero', 'tech_55_ddd_numero', 'tech_e164'));
    end if;
end $chk$;

comment on column public.voz_troncos.declaracao_em is
    'SQL 113: quando o Admin declarou que o contrato com a operadora e a bina são da empresa (ou do credor que autorizou). Zera ao trocar a bina.';
comment on column public.voz_troncos.autenticacao_operadora is
    'SQL 113: a operadora autentica as ligações (Origem Verificada / STIR-SHAKEN)? sim | nao | nao_sei.';
comment on column public.voz_troncos.dtmf is 'SQL 113: envio das teclas: auto (RFC 4733 ou no áudio) | rfc4733 | inband | info.';
comment on column public.voz_troncos.realm is 'SQL 113: domínio de autenticação (só se a operadora informar).';
comment on column public.voz_troncos.from_usuario is 'SQL 113: número ou usuário no "De" (só se a operadora pedir; vazio = bina, ou o usuário com senha).';
comment on column public.voz_troncos.cabecalho_bina is 'SQL 113: como a bina vai: from_pai (De + P-Asserted-Identity) | from | rpid.';
comment on column public.voz_troncos.tech_prefix is 'SQL 113: prefixo da operadora (opcional): o padrão das rotas novas do tronco.';
comment on column public.voz_troncos.toque_max_s is 'SQL 113: tempo máximo tocando (s). Depois disso o servidor de voz desiste.';
comment on column public.voz_troncos.duracao_max_min is 'SQL 113: duração máxima da ligação (min): proteção contra ligação pendurada.';
comment on column public.voz_troncos.verificar_options is 'SQL 113: OPTIONS a cada 60 s para saber se a operadora está no ar.';
comment on column public.voz_troncos.liga_para is 'SQL 113: o tronco liga para fixo_movel | fixo | movel (a tela cria as rotas por tipo).';
comment on column public.voz_troncos.retorno_bina is 'SQL 113: quem liga de volta para a bina cai em (texto informativo).';

-- ================================================================ 3. bina única por operadora (na empresa)
create or replace function public.validar_bina_operadora_voz() returns trigger
language plpgsql security definer set search_path = public as $$
declare outro text;
begin
    if tg_op = 'UPDATE' and new.bina is not distinct from old.bina and new.operadora is not distinct from old.operadora then
        return new;
    end if;
    select t.referencia into outro from public.voz_troncos t
     where t.empresa_id = new.empresa_id and t.id <> new.id and t.bina = new.bina
       and lower(trim(t.operadora)) <> lower(trim(new.operadora))
     order by t.id limit 1;
    if outro is not null then
        raise exception 'a bina já está no tronco % de outra operadora: cada bina fica com uma operadora só', outro;
    end if;
    return new;
end $$;
revoke all on function public.validar_bina_operadora_voz() from public, anon, authenticated;
drop trigger if exists voz_troncos_bina_operadora on public.voz_troncos;
create trigger voz_troncos_bina_operadora before insert or update on public.voz_troncos
    for each row execute function public.validar_bina_operadora_voz();

-- ================================================================ 4. rota com prefixo opcional
alter table public.voz_rotas add column if not exists enviar_prefixo boolean not null default true;
comment on column public.voz_rotas.enviar_prefixo is
    'SQL 113: false = a operadora não usa prefixo; tech_prefix guarda só o código interno da rota (vigência e tarifação).';

-- ================================================================ 5. RPCs recriadas inteiras
-- cadastrar_tronco_voz: a do SQL 105 (mesma assinatura: o Console e as chamadas de hoje continuam iguais) com a
-- declaração do cliente (C4): o tronco novo e a troca de bina pelo cliente só passam pelo salvar_tronco_voz com as duas
-- declarações marcadas (ele avisa por motorcx.tronco_declarado, só nesta transação). Trocar a bina zera a declaração.
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
    v_bina text := regexp_replace(coalesce(bina, ''), '\D', '', 'g');
    ant public.voz_troncos;
    declarou boolean := coalesce(current_setting('motorcx.tronco_declarado', true), '') = '1';
    v_decl_em timestamptz;
    v_decl_por uuid;
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
    select * into ant from public.voz_troncos t where t.empresa_id = empresa and t.referencia = ref;
    -- SQL 113 · C4: declaração do contrato e da bina (obrigatória para o cliente no tronco novo e na troca de bina)
    if declarou then
        v_decl_em := now(); v_decl_por := auth.uid();
    elsif ant.id is not null and ant.bina is not distinct from v_bina then
        v_decl_em := ant.declaracao_em; v_decl_por := ant.declaracao_por;
    end if;
    if cliente and v_decl_em is null then
        raise exception 'marque as duas declarações: o contrato com a operadora e a bina são da sua empresa (ou do credor que autorizou)';
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
                                         cps, ativo, declaracao_em, declaracao_por)
    values (empresa, ref, trim(operadora), lower(trim(host)), porta, transporte, autenticacao,
            nullif(trim(usuario), ''), ref_segredo, trim(ddd_origem), v_bina, coalesce(formato_discagem, 'tech_ddd_numero'),
            nullif(trim(csp), ''), codecs,
            canais, cps, case when cliente then false else coalesce(ativo, true) end, v_decl_em, v_decl_por)
    on conflict on constraint voz_troncos_empresa_id_referencia_key do update
        set operadora = excluded.operadora, host = excluded.host, porta = excluded.porta,
            transporte = excluded.transporte, autenticacao = excluded.autenticacao, segredo_ref = excluded.segredo_ref,
            codecs = excluded.codecs, canais = excluded.canais, cps = excluded.cps, usuario = excluded.usuario,
            ddd_origem = excluded.ddd_origem, bina = excluded.bina, formato_discagem = excluded.formato_discagem,
            csp = excluded.csp, declaracao_em = excluded.declaracao_em, declaracao_por = excluded.declaracao_por,
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

-- salvar_tronco_voz: o que a tela do cliente (e a equipe) chama, com TODOS os campos da seção E num objeto. Cadastra pelo
-- cadastrar_tronco_voz (mesmas travas: quem pode, senha no cofre da empresa, nasce inativo para o cliente) e grava os
-- campos novos. Chave ausente = mantém o que está (ou o padrão no tronco novo); texto vazio limpa os opcionais.
-- Mudar realm, from_usuario, cabecalho_bina ou dtmf também zera o teste e, para o cliente, desativa o tronco.
create or replace function public.salvar_tronco_voz(empresa bigint, tronco jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    d jsonb := coalesce(tronco, '{}'::jsonb);
    chave text;
    ref text := lower(trim(coalesce(d ->> 'referencia', '')));
    ant public.voz_troncos;
    novo public.voz_troncos;
    tid bigint;
    cliente boolean := not public.cuida_voz(empresa);
    codecs_v text[];
    mudou_conexao boolean;
begin
    if not public.pode_configurar_telefonia(empresa) then
        raise exception 'sem permissão para configurar a telefonia (Admin com a verificação em duas etapas, ou a equipe MotorCX)';
    end if;
    if jsonb_typeof(d) <> 'object' then
        raise exception 'tronco: objeto JSON';
    end if;
    for chave in select jsonb_object_keys(d) loop
        if chave not in ('referencia', 'operadora', 'host', 'porta', 'transporte', 'autenticacao', 'usuario', 'ddd_origem',
                         'bina', 'formato_discagem', 'csp', 'codecs', 'canais', 'cps', 'ativo', 'autenticacao_operadora',
                         'dtmf', 'realm', 'from_usuario', 'cabecalho_bina', 'tech_prefix', 'toque_max_s',
                         'duracao_max_min', 'verificar_options', 'liga_para', 'retorno_bina', 'declaro') then
            raise exception 'campo desconhecido no tronco: %', chave;
        end if;
    end loop;
    select * into ant from public.voz_troncos t where t.empresa_id = empresa and t.referencia = ref;
    if d ? 'codecs' then
        select array_agg(lower(x)) into codecs_v from jsonb_array_elements_text(d -> 'codecs') x;
    end if;
    if coalesce((d ->> 'declaro')::boolean, false) then
        perform set_config('motorcx.tronco_declarado', '1', true);
    end if;
    begin
        tid := public.cadastrar_tronco_voz(
            empresa, ref,
            coalesce(d ->> 'operadora', ant.operadora),
            coalesce(d ->> 'host', ant.host),
            coalesce((d ->> 'canais')::int, ant.canais),
            coalesce(d ->> 'autenticacao', ant.autenticacao, 'ip'),
            coalesce(nullif(d ->> 'ddd_origem', ''), ant.ddd_origem,
                     substr(regexp_replace(coalesce(d ->> 'bina', ''), '\D', '', 'g'), 1, 2)),
            coalesce(d ->> 'bina', ant.bina),
            null,
            case when d ? 'usuario' then d ->> 'usuario' else ant.usuario end,
            coalesce((d ->> 'porta')::int, ant.porta, 5060),
            coalesce(d ->> 'transporte', ant.transporte, 'udp'),
            coalesce((d ->> 'cps')::int, ant.cps, 10),
            coalesce(codecs_v, ant.codecs, '{alaw,ulaw}'),
            coalesce(d ->> 'formato_discagem', ant.formato_discagem, 'tech_ddd_numero'),
            coalesce((d ->> 'ativo')::boolean, ant.ativo, true),
            case when d ? 'csp' then d ->> 'csp' else ant.csp end);
    exception when others then
        perform set_config('motorcx.tronco_declarado', '', true);
        raise;
    end;
    perform set_config('motorcx.tronco_declarado', '', true);
    update public.voz_troncos t
       set autenticacao_operadora = coalesce(nullif(d ->> 'autenticacao_operadora', ''), t.autenticacao_operadora),
           dtmf = coalesce(nullif(d ->> 'dtmf', ''), t.dtmf),
           realm = case when d ? 'realm' then nullif(lower(trim(d ->> 'realm')), '') else t.realm end,
           from_usuario = case when d ? 'from_usuario' then nullif(trim(d ->> 'from_usuario'), '') else t.from_usuario end,
           cabecalho_bina = coalesce(nullif(d ->> 'cabecalho_bina', ''), t.cabecalho_bina),
           tech_prefix = case when d ? 'tech_prefix' then nullif(trim(d ->> 'tech_prefix'), '') else t.tech_prefix end,
           toque_max_s = coalesce((d ->> 'toque_max_s')::int, t.toque_max_s),
           duracao_max_min = coalesce((d ->> 'duracao_max_min')::int, t.duracao_max_min),
           verificar_options = coalesce((d ->> 'verificar_options')::boolean, t.verificar_options),
           liga_para = coalesce(nullif(d ->> 'liga_para', ''), t.liga_para),
           retorno_bina = case when d ? 'retorno_bina' then nullif(trim(d ->> 'retorno_bina'), '') else t.retorno_bina end
     where t.id = tid
    returning * into novo;
    mudou_conexao := ant.id is not null
                     and (ant.realm, ant.from_usuario, ant.cabecalho_bina, ant.dtmf)
                         is distinct from (novo.realm, novo.from_usuario, novo.cabecalho_bina, novo.dtmf);
    if mudou_conexao then
        update public.voz_troncos t
           set testado_em = null, teste_ok = null, atualizado_em = now(),
               ativo = case when cliente then false else t.ativo end
         where t.id = tid;
    end if;
    return tid;
end $$;
revoke all on function public.salvar_tronco_voz(bigint, jsonb) from public, anon;
grant execute on function public.salvar_tronco_voz(bigint, jsonb) to authenticated;

-- salvar_rota_voz: a do SQL 105 com o prefixo opcional (G14) e tronco inativo da empresa aceito
create or replace function public.salvar_rota_voz(empresa bigint, tronco bigint, tech_prefix text, tipo text,
                                                  prioridade int, cadencia_inicial_s int, cadencia_incremento_s int,
                                                  preco_minuto numeric, desde date default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    d date := coalesce(desde, (now() at time zone 'America/Sao_Paulo')::date);
    ant public.voz_rotas;
    rid bigint;
    prefixo text := nullif(trim(salvar_rota_voz.tech_prefix), '');
    enviar boolean := prefixo is not null;
    tentativa int := 0;
begin
    if not public.pode_configurar_telefonia(empresa) then
        raise exception 'sem permissão para configurar a telefonia (Admin com a verificação em duas etapas, ou a equipe MotorCX)';
    end if;
    if not exists (select 1 from public.voz_troncos t where t.id = tronco and t.empresa_id = empresa) then
        raise exception 'tronco não encontrado nesta empresa';
    end if;
    if prefixo is not null and prefixo !~ '^[0-9]{1,8}$' then
        raise exception 'prefixo da operadora: de 1 a 8 dígitos, ou em branco se a operadora não usa';
    end if;
    if enviar then
        select * into ant from public.voz_rotas r
         where r.empresa_id = empresa and r.tech_prefix = prefixo
         order by r.vigente_desde desc limit 1;
    else
        -- SQL 113 · G14: sem prefixo, a vigência é do tronco e do tipo; o código interno da rota é reaproveitado
        select * into ant from public.voz_rotas r
         where r.empresa_id = empresa and r.tronco_id = tronco and r.tipo = salvar_rota_voz.tipo and not r.enviar_prefixo
         order by r.vigente_desde desc limit 1;
        prefixo := ant.tech_prefix;
        while prefixo is null loop
            tentativa := tentativa + 1;
            prefixo := '0' || lpad((floor(random() * 10000000))::int::text, 7, '0');
            if exists (select 1 from public.voz_rotas r where r.empresa_id = empresa and r.tech_prefix = prefixo) then
                prefixo := null;
                if tentativa > 50 then
                    raise exception 'não deu para criar o código interno da rota: tente de novo';
                end if;
            end if;
        end loop;
    end if;
    if ant.id is not null then
        if ant.vigente_desde >= d then
            raise exception 'a nova vigência precisa começar depois de % (vigência atual)', to_char(ant.vigente_desde, 'DD/MM/YYYY');
        end if;
        if ant.vigente_ate is null or ant.vigente_ate >= d then
            update public.voz_rotas r set vigente_ate = d - 1 where r.id = ant.id;
        end if;
    end if;
    insert into public.voz_rotas (empresa_id, tronco_id, prioridade, tech_prefix, tipo, cadencia_inicial_s,
                                  cadencia_incremento_s, preco_minuto, vigente_desde, enviar_prefixo)
    values (empresa, tronco, prioridade, prefixo, tipo, cadencia_inicial_s, cadencia_incremento_s,
            preco_minuto, d, enviar)
    returning id into rid;
    return rid;
end $$;
revoke all on function public.salvar_rota_voz(bigint, bigint, text, text, int, int, int, numeric, date) from public, anon;
grant execute on function public.salvar_rota_voz(bigint, bigint, text, text, int, int, int, numeric, date) to authenticated;

-- ================================================================ 6. leitura dos campos novos (views próprias)
-- Views SEPARADAS (e não colunas a mais em voz_troncos_empresa e voz_vm.troncos): o SQL 105 e o SQL 57 recriam aquelas
-- com "create or replace view" e não podem tirar colunas, então reaplicá-los depois deste daria erro.
-- Tela do cliente (mesma regra de quem vê do SQL 105: ve_telefonia).
create or replace view public.voz_troncos_campos_empresa with (security_barrier = true) as
    select t.id, t.empresa_id, t.declaracao_em, t.autenticacao_operadora, t.dtmf, t.realm, t.from_usuario,
           t.cabecalho_bina, t.tech_prefix, t.toque_max_s, t.duracao_max_min, t.verificar_options, t.liga_para,
           t.retorno_bina
      from public.voz_troncos t
     where public.ve_telefonia(t.empresa_id);
comment on view public.voz_troncos_campos_empresa is 'SQL 113: os campos da seção E de cada tronco, para a tela Telefonia.';

create or replace view public.voz_rotas_prefixo_empresa with (security_barrier = true) as
    select r.id, r.empresa_id, r.tronco_id, r.enviar_prefixo
      from public.voz_rotas r
     where public.ve_telefonia(r.empresa_id);
comment on view public.voz_rotas_prefixo_empresa is 'SQL 113: se a rota manda o prefixo (false = a operadora não usa).';

revoke all on public.voz_troncos_campos_empresa, public.voz_rotas_prefixo_empresa from public, anon, authenticated;
grant select on public.voz_troncos_campos_empresa, public.voz_rotas_prefixo_empresa to authenticated, service_role;

-- Servidor de voz (acesso próprio, papel motorcx_voz): voz/acesso.py junta estas colunas às de voz_vm.troncos/rotas
create or replace view voz_vm.troncos_campos with (security_barrier = true) as
    select t.id, t.dtmf, t.realm, t.from_usuario, t.cabecalho_bina, t.toque_max_s, t.duracao_max_min, t.verificar_options
      from public.voz_troncos t;
create or replace view voz_vm.rotas_prefixo with (security_barrier = true) as
    select r.id, r.enviar_prefixo from public.voz_rotas r;
revoke all on voz_vm.troncos_campos, voz_vm.rotas_prefixo from public, anon, authenticated, service_role;
do $g$ begin
    if exists (select 1 from pg_roles where rolname = 'motorcx_voz') then
        grant select on voz_vm.troncos_campos, voz_vm.rotas_prefixo to motorcx_voz;
    end if;
end $g$;
