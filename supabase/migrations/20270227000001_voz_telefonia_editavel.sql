-- SQL 114 · Agente Voz/CX › Telefonia, PR T5: a tela Telefonia editável e o "Testar a rota" de verdade (C11, C12, D12,
-- G1, G18 e G29 do parecer; seção F)
-- Decisão do dono (08/11/2026, SPEC Canais §3.4 e §6.2 item 13): o Admin configura a rota direta dele numa tela guiada e
-- testa a rota de verdade antes de qualquer ligação para cliente.
--
-- 1. Números de teste da empresa (D12, G29): voz_numeros_teste, de 1 a 5 por empresa. O NÚMERO fica só no cofre de
--    segredos (Secret Manager), como a senha do tronco: a Edge Function segredo-tronco-voz recebe o número, pede ao banco
--    a linha (preparar_numero_teste_voz, com o login da pessoa: permissão, duas etapas, limite), grava o número no
--    segredo motorcx-voz-trunk-e<empresa>-teste-<12 do hash> e registra (registrar_numero_teste_voz, servidor). O banco
--    guarda só o hash (sha-256 dos dígitos sem o 55, o mesmo de voz_config.numeros_teste_hash), a máscara com o DDD e
--    os 2 últimos dígitos e a referência do segredo. Remover (remover_numero_teste_voz) apaga a linha e a função
--    destrói o segredo. O número fica CONFIRMADO quando a pessoa digita, no passo 5 do teste da rota, o código de 4
--    dígitos que só aparece na tela de quem pediu o teste (prova que o celular está com alguém da empresa). Não existe
--    hoje um envio de SMS avulso para número da equipe do cliente; quando existir, a confirmação por SMS entra aqui.
--    Só os confirmados entram em voz_config.numeros_teste_hash (o modo "Só números de teste").
-- 2. Teste da rota (seção F, G1): voz_testes_tronco. pedir_teste_tronco_voz(tronco, numero_teste) confere no banco o
--    que dá (passo 0: número de teste guardado da empresa, IPs da operadora já liberados no firewall pela equipe, senha
--    guardada), os limites (10 por hora por tronco, 30 por dia por empresa, um de cada vez por tronco) e cria o pedido
--    com o código de 4 dígitos. Nenhum número passa pelo banco: o servidor de voz (voz/testador.py) pega o pedido
--    (pegar_teste_tronco_voz, com a referência do segredo), lê o número no cofre, liga de verdade, grava cada passo
--    (registrar_teste_tronco_voz) e, no fim, voz_troncos.teste_ok / testado_em, mas só se o tronco não mudou desde o
--    pedido (assinatura da conexão). A pessoa responde na tela se a bina apareceu certa (responder_bina_teste_voz) e
--    pode cancelar (cancelar_teste_tronco_voz). Pedido parado há mais de 10 minutos expira.
-- 3. Caminho até Real (C11): usar_tronco_voz(tronco, ativo). Desativar: o Admin sempre pode. Ativar: o tronco precisa
--    ter passado no teste depois da última mudança, ter os IPs da operadora liberados no firewall (a equipe libera) e não
--    estar pausado. Na primeira vez da empresa (nunca teve as ligações reais ligadas pela equipe), quem ativa é a equipe
--    MotorCX: o pedido vira aviso para a equipe (até 1 dia útil). Depois disso, o Admin ativa sozinho e a equipe é avisada.
--    A equipe continua ativando pelo Console como antes.
-- 4. Retomar depois do teste (G18): retomar_rota_voz(pausa) para o Admin, só se o tronco passou num teste completo DEPOIS
--    da pausa. Quem retomou e por quê ficam na pausa (nota automática) e na Auditoria.
-- 5. Leitura do cliente (ve_telefonia): voz_numeros_teste_empresa (sem hash), voz_testes_tronco_empresa (sem número;
--    o código só enquanto o teste está pedido ou rodando) e voz_pausas_empresa.
-- Depende dos SQL 56, 57, 65, 103, 104, 105 e 113. Pode rodar de novo sem erro.

-- ================================================================ 1. números de teste
create table if not exists public.voz_numeros_teste (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    hash          text not null check (hash ~ '^[0-9a-f]{64}$'),
    mascara       text not null check (mascara ~ '^\([1-9][1-9]\) [0-9]?•{3,4}-••[0-9]{2}$'),
    segredo_ref   text not null check (segredo_ref ~ '^voz/trunk/e[1-9][0-9]{0,18}/teste-[0-9a-f]{12}$'),
    guardado_em   timestamptz,
    guardado_por  uuid references auth.users (id) on delete set null,
    versao        int check (versao > 0),
    criado_por    uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em     timestamptz not null default now(),
    confirmado_em timestamptz,
    unique (empresa_id, hash)
);
comment on table public.voz_numeros_teste is
    'SQL 114: números de teste da empresa (só hash, máscara e a referência do segredo; o número fica no cofre). '
    'Confirmado = a pessoa digitou o código da tela no teste da rota.';
alter table public.voz_numeros_teste enable row level security;
revoke all on public.voz_numeros_teste from anon, authenticated;

-- a Edge Function chama com o login da pessoa: confere quem pode e devolve o nome do segredo da empresa
create or replace function public.preparar_numero_teste_voz(empresa bigint, hash text, mascara text)
returns table (numero_id bigint, empresa_id bigint, nome_segredo text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    n public.voz_numeros_teste;
    h text := lower(hash);
begin
    if not public.pode_configurar_telefonia(empresa) then
        raise exception 'sem permissão para configurar a telefonia (Admin com a verificação em duas etapas, ou a equipe MotorCX)';
    end if;
    if not public.sessao_aal2() then
        raise exception 'confirme a verificação em duas etapas para cadastrar o número de teste';
    end if;
    if h is null or h !~ '^[0-9a-f]{64}$' then
        raise exception 'número de teste inválido';
    end if;
    select * into n from public.voz_numeros_teste x where x.empresa_id = empresa and x.hash = h;
    if n.id is null then
        if (select count(*) from public.voz_numeros_teste x where x.empresa_id = empresa) >= 5 then
            raise exception 'no máximo 5 números de teste por empresa';
        end if;
        insert into public.voz_numeros_teste (empresa_id, hash, mascara, segredo_ref)
        values (empresa, h, mascara, public.segredo_ref_tronco_voz(empresa, 'teste-' || left(h, 12)))
        returning * into n;
    end if;
    return query select n.id, n.empresa_id, public.nome_segredo_tronco_voz(n.empresa_id, 'teste-' || left(n.hash, 12));
end $$;
revoke all on function public.preparar_numero_teste_voz(bigint, text, text) from public, anon;
grant execute on function public.preparar_numero_teste_voz(bigint, text, text) to authenticated;

-- o servidor (Edge Function) registra depois de gravar no cofre
create or replace function public.registrar_numero_teste_voz(numero bigint, usuario uuid, versao int) returns timestamptz
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare agora timestamptz := now();
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor registra o número guardado';
    end if;
    if versao is null or versao < 1 then
        raise exception 'versão do segredo inválida';
    end if;
    update public.voz_numeros_teste x set guardado_em = agora, guardado_por = usuario, versao = registrar_numero_teste_voz.versao
     where x.id = numero;
    if not found then
        raise exception 'número de teste não encontrado';
    end if;
    return agora;
end $$;
revoke all on function public.registrar_numero_teste_voz(bigint, uuid, int) from public, anon, authenticated;
grant execute on function public.registrar_numero_teste_voz(bigint, uuid, int) to service_role;

-- remover: apaga a linha (e o hash do modo "Só números de teste"); devolve o nome do segredo para a função destruir
create or replace function public.remover_numero_teste_voz(numero bigint) returns text
language plpgsql security definer set search_path = public as $$
declare n public.voz_numeros_teste;
begin
    select * into n from public.voz_numeros_teste x where x.id = numero;
    if n.id is null or not public.pode_configurar_telefonia(n.empresa_id) then
        raise exception 'número de teste não encontrado';
    end if;
    update public.voz_testes_tronco t set numero_teste_id = null where t.numero_teste_id = n.id and t.situacao not in ('pedido', 'rodando');
    if exists (select 1 from public.voz_testes_tronco t where t.numero_teste_id = n.id) then
        raise exception 'há um teste em andamento com este número: espere terminar';
    end if;
    delete from public.voz_numeros_teste x where x.id = n.id;
    update public.voz_config c set numeros_teste_hash = array_remove(c.numeros_teste_hash, n.hash), atualizado_em = now()
     where c.empresa_id = n.empresa_id and n.hash = any (c.numeros_teste_hash);
    return public.nome_segredo_tronco_voz(n.empresa_id, 'teste-' || left(n.hash, 12));
end $$;
revoke all on function public.remover_numero_teste_voz(bigint) from public, anon;
grant execute on function public.remover_numero_teste_voz(bigint) to authenticated;

-- ================================================================ 2. teste da rota
-- o que identifica a conexão do tronco: se mudar entre o pedido e o fim, o resultado não vale para o tronco
create or replace function public.assinatura_tronco_voz(t public.voz_troncos) returns text
language sql stable set search_path = public as $$
    select md5(concat_ws('|', t.host, t.porta, t.transporte, t.autenticacao, t.usuario, t.segredo_ref, t.segredo_versao,
                         t.bina, t.formato_discagem, t.csp, t.realm, t.from_usuario, t.cabecalho_bina, t.dtmf,
                         array_to_string(t.codecs, ',')))
$$;
revoke all on function public.assinatura_tronco_voz(public.voz_troncos) from public, anon, authenticated;

create table if not exists public.voz_testes_tronco (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    tronco_id       bigint not null,
    numero_teste_id bigint references public.voz_numeros_teste (id) on delete set null,
    numero_mascara  text check (numero_mascara ~ '^\([1-9][1-9]\) [0-9]?•{3,4}-••[0-9]{2}$'),
    codigo          text not null check (codigo ~ '^[0-9]{4}$'),
    assinatura      text not null,
    situacao        text not null default 'pedido'
                    check (situacao in ('pedido', 'rodando', 'passou', 'atencao', 'falhou', 'incompleto', 'cancelado',
                                        'expirado')),
    passos          jsonb not null default '[]' check (jsonb_typeof(passos) = 'array'),
    bina_resposta   text check (bina_resposta in ('certa', 'outro', 'privado')),
    resumo          text check (char_length(resumo) <= 400),
    vm              text check (vm ~ '^[a-z0-9-]{1,63}$'),
    pedido_por      uuid default auth.uid() references auth.users (id) on delete set null,
    pedido_em       timestamptz not null default now(),
    iniciado_em     timestamptz,
    concluido_em    timestamptz,
    foreign key (tronco_id, empresa_id) references public.voz_troncos (id, empresa_id) on delete cascade
);
create unique index if not exists voz_testes_tronco_ativo on public.voz_testes_tronco (tronco_id)
    where situacao in ('pedido', 'rodando');
create index if not exists voz_testes_tronco_por_empresa on public.voz_testes_tronco (empresa_id, pedido_em desc);
comment on table public.voz_testes_tronco is
    'SQL 114: teste da rota (seção F do parecer). Sem número: o servidor de voz lê o número de teste no cofre.';
alter table public.voz_testes_tronco enable row level security;
revoke all on public.voz_testes_tronco from anon, authenticated;

-- pedido parado (servidor de voz fora, VM reiniciou no meio): expira e libera o tronco para outro teste
create or replace function public.expirar_testes_tronco_voz() returns void
language sql security definer set search_path = public as $$
    update public.voz_testes_tronco x
       set situacao = 'expirado', concluido_em = now(),
           resumo = 'Teste incompleto: o servidor de voz não terminou o teste. Tente de novo.'
     where x.situacao in ('pedido', 'rodando') and x.pedido_em < now() - interval '10 minutes'
$$;
revoke all on function public.expirar_testes_tronco_voz() from public, anon, authenticated;

drop function if exists public.pedir_teste_tronco_voz(bigint, text);
create or replace function public.pedir_teste_tronco_voz(tronco bigint, numero_teste bigint) returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    t public.voz_troncos;
    nt public.voz_numeros_teste;
    tid bigint;
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
    select * into t from public.voz_troncos x where x.id = tronco;
    if t.id is null or not public.pode_configurar_telefonia(t.empresa_id) then
        raise exception 'tronco não encontrado';
    end if;
    select * into nt from public.voz_numeros_teste n where n.id = numero_teste and n.empresa_id = t.empresa_id;
    if nt.id is null then
        raise exception 'escolha um número de Números de teste';
    end if;
    if nt.guardado_em is null then
        raise exception 'este número de teste ainda não foi guardado no cofre: cadastre de novo';
    end if;
    -- passo 0 no banco (sem custo)
    if cardinality(t.ips_operadora) = 0 then
        raise exception 'informe os IPs da operadora (sinalização e áudio) antes de testar';
    end if;
    if exists (select 1 from unnest(t.ips_operadora) y where not y = any (t.ips_liberados)) then
        raise exception 'Ainda estamos liberando os IPs da operadora no nosso firewall. A equipe MotorCX confere e libera; tente de novo depois.';
    end if;
    if t.autenticacao = 'senha' and t.segredo_guardado_em is null then
        raise exception 'guarde a senha do tronco antes de testar';
    end if;
    perform public.expirar_testes_tronco_voz();
    if exists (select 1 from public.voz_testes_tronco x where x.tronco_id = t.id and x.situacao in ('pedido', 'rodando')) then
        raise exception 'já existe um teste deste tronco em andamento';
    end if;
    if (select count(*) from public.voz_testes_tronco x where x.tronco_id = t.id
          and x.pedido_em > now() - interval '1 hour' and x.situacao <> 'cancelado') >= 10 then
        raise exception 'limite de 10 testes por hora neste tronco: tente mais tarde';
    end if;
    if (select count(*) from public.voz_testes_tronco x where x.empresa_id = t.empresa_id
          and (x.pedido_em at time zone 'America/Sao_Paulo')::date = hoje and x.situacao <> 'cancelado') >= 30 then
        raise exception 'limite de 30 testes por dia na empresa: tente amanhã';
    end if;
    insert into public.voz_testes_tronco (empresa_id, tronco_id, numero_teste_id, numero_mascara, codigo, assinatura)
    values (t.empresa_id, t.id, nt.id, nt.mascara, lpad((floor(random() * 10000))::int::text, 4, '0'),
            public.assinatura_tronco_voz(t))
    returning id into tid;
    return tid;
end $$;
revoke all on function public.pedir_teste_tronco_voz(bigint, bigint) from public, anon;
grant execute on function public.pedir_teste_tronco_voz(bigint, bigint) to authenticated;

create or replace function public.cancelar_teste_tronco_voz(teste bigint) returns void
language plpgsql security definer set search_path = public as $$
declare x public.voz_testes_tronco;
begin
    select * into x from public.voz_testes_tronco v where v.id = teste;
    if x.id is null or not public.pode_configurar_telefonia(x.empresa_id) then
        raise exception 'teste não encontrado';
    end if;
    update public.voz_testes_tronco v set situacao = 'cancelado', concluido_em = now(),
                                          resumo = 'Teste cancelado.'
     where v.id = x.id and v.situacao in ('pedido', 'rodando');
end $$;
revoke all on function public.cancelar_teste_tronco_voz(bigint) from public, anon;
grant execute on function public.cancelar_teste_tronco_voz(bigint) to authenticated;

create or replace function public.responder_bina_teste_voz(teste bigint, resposta text) returns void
language plpgsql security definer set search_path = public as $$
declare x public.voz_testes_tronco;
begin
    select * into x from public.voz_testes_tronco v where v.id = teste;
    if x.id is null or not public.pode_configurar_telefonia(x.empresa_id) then
        raise exception 'teste não encontrado';
    end if;
    if resposta is null or resposta not in ('certa', 'outro', 'privado') then
        raise exception 'resposta da bina: certa, outro ou privado';
    end if;
    if x.situacao not in ('pedido', 'rodando') then
        raise exception 'o teste já terminou';
    end if;
    update public.voz_testes_tronco v set bina_resposta = resposta where v.id = x.id;
end $$;
revoke all on function public.responder_bina_teste_voz(bigint, text) from public, anon;
grant execute on function public.responder_bina_teste_voz(bigint, text) to authenticated;

-- servidor de voz: pega o pedido mais antigo, com a referência do segredo do número de teste (o número fica no cofre)
create or replace function public.pegar_teste_tronco_voz(vm text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    perform public.expirar_testes_tronco_voz();
    with alvo as (
        select x.id from public.voz_testes_tronco x
         where x.situacao = 'pedido' order by x.pedido_em limit 1 for update skip locked
    ), feito as (
        update public.voz_testes_tronco v
           set situacao = 'rodando', iniciado_em = now(),
               vm = case when pegar_teste_tronco_voz.vm ~ '^[a-z0-9-]{1,63}$' then pegar_teste_tronco_voz.vm end
          from alvo where v.id = alvo.id
        returning v.id, v.empresa_id, v.tronco_id, v.codigo, v.assinatura, v.numero_teste_id
    )
    select jsonb_build_object('id', f.id, 'empresa_id', f.empresa_id, 'tronco_id', f.tronco_id, 'codigo', f.codigo,
                              'assinatura', f.assinatura,
                              'numero_ref', (select n.segredo_ref from public.voz_numeros_teste n where n.id = f.numero_teste_id),
                              'atualizado_em', (select t.atualizado_em from public.voz_troncos t where t.id = f.tronco_id))
      into r from feito f;
    return r;
end $$;

-- o que a pessoa respondeu na tela e se cancelou (o servidor de voz lê durante o teste)
create or replace function public.ler_teste_tronco_voz(teste bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    return (select jsonb_build_object('situacao', x.situacao, 'bina_resposta', x.bina_resposta)
              from public.voz_testes_tronco x where x.id = teste);
end $$;

-- cada passo (e o fim). passos: [{passo 0..9, resultado ok|aviso|falha|inconclusivo|rodando|pulado, mensagem}]
create or replace function public.registrar_teste_tronco_voz(teste bigint, passos jsonb, situacao text default null,
                                                            resumo text default null) returns text
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    x public.voz_testes_tronco;
    t public.voz_troncos;
    p jsonb;
    final boolean := situacao in ('passou', 'atencao', 'falhou', 'incompleto');
    vale boolean;
    h text;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    if situacao is not null and situacao not in ('rodando', 'passou', 'atencao', 'falhou', 'incompleto') then
        raise exception 'situação do teste inválida';
    end if;
    if jsonb_typeof(passos) <> 'array' or jsonb_array_length(passos) > 10 then
        raise exception 'passos: lista de até 10';
    end if;
    for p in select * from jsonb_array_elements(passos) loop
        if jsonb_typeof(p) <> 'object' or (p ->> 'passo') !~ '^[0-9]$'
           or coalesce(p ->> 'resultado', '') not in ('ok', 'aviso', 'falha', 'inconclusivo', 'rodando', 'pulado')
           or char_length(coalesce(p ->> 'mensagem', '')) > 300
           or not public.texto_sem_dado_pessoal(coalesce(p ->> 'mensagem', '')) then
            raise exception 'passo inválido no teste';
        end if;
    end loop;
    if resumo is not null and (char_length(resumo) > 400 or not public.texto_sem_dado_pessoal(resumo)) then
        raise exception 'resumo inválido';
    end if;
    select * into x from public.voz_testes_tronco v where v.id = teste for update;
    if x.id is null then
        raise exception 'teste não encontrado';
    end if;
    if x.situacao <> 'rodando' then
        return x.situacao;                 -- cancelado ou expirado: o servidor de voz para
    end if;
    update public.voz_testes_tronco v
       set passos = registrar_teste_tronco_voz.passos,
           situacao = coalesce(registrar_teste_tronco_voz.situacao, v.situacao),
           resumo = coalesce(registrar_teste_tronco_voz.resumo, v.resumo),
           concluido_em = case when final then now() end
     where v.id = x.id;
    if not final then
        return 'rodando';
    end if;
    select * into t from public.voz_troncos y where y.id = x.tronco_id for update;
    vale := public.assinatura_tronco_voz(t) = x.assinatura;
    if vale and situacao in ('passou', 'atencao', 'falhou') then
        update public.voz_troncos y set teste_ok = situacao in ('passou', 'atencao'), testado_em = now()
         where y.id = t.id;
    end if;
    -- passo 5 com o código da tela: o número de teste fica confirmado e passa a valer no modo "Só números de teste"
    if exists (select 1 from jsonb_array_elements(passos) e where e ->> 'passo' = '5' and e ->> 'resultado' = 'ok')
       and x.numero_teste_id is not null then
        update public.voz_numeros_teste n set confirmado_em = coalesce(n.confirmado_em, now())
         where n.id = x.numero_teste_id returning n.hash into h;
        if h is not null then
            insert into public.voz_config (empresa_id) values (x.empresa_id) on conflict (empresa_id) do nothing;
            update public.voz_config c
               set numeros_teste_hash = c.numeros_teste_hash || h, atualizado_em = now()
             where c.empresa_id = x.empresa_id and not h = any (c.numeros_teste_hash)
               and cardinality(c.numeros_teste_hash) < 20;
        end if;
    end if;
    if vale and situacao in ('passou', 'atencao') and not t.ativo then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, assunto)
        values ('equipe', x.empresa_id, 'pronto', left('Telefonia do cliente: o tronco ' || t.referencia || ' passou no teste', 140),
                'O tronco passou no teste da rota. Se é a primeira vez da empresa, confira e ative no Console.',
                '/console/fornecedores?aba=voz', 'equipe');
    end if;
    return situacao;
end $$;

revoke all on function public.pegar_teste_tronco_voz(text), public.ler_teste_tronco_voz(bigint),
              public.registrar_teste_tronco_voz(bigint, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.pegar_teste_tronco_voz(text), public.ler_teste_tronco_voz(bigint),
              public.registrar_teste_tronco_voz(bigint, jsonb, text, text) to service_role;

create or replace function voz_vm.pegar_teste_tronco(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.pegar_teste_tronco_voz(args ->> 'vm')
$$;
create or replace function voz_vm.ler_teste_tronco(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.ler_teste_tronco_voz((args ->> 'teste')::bigint)
$$;
create or replace function voz_vm.registrar_teste_tronco(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.registrar_teste_tronco_voz((args ->> 'teste')::bigint, args -> 'passos', args ->> 'situacao',
                                                      args ->> 'resumo'))
$$;
revoke all on function voz_vm.pegar_teste_tronco(jsonb), voz_vm.ler_teste_tronco(jsonb),
              voz_vm.registrar_teste_tronco(jsonb) from public, anon, authenticated, service_role;
do $g$ begin
    if exists (select 1 from pg_roles where rolname = 'motorcx_voz') then
        grant execute on function voz_vm.pegar_teste_tronco(jsonb), voz_vm.ler_teste_tronco(jsonb),
                                  voz_vm.registrar_teste_tronco(jsonb) to motorcx_voz;
    end if;
end $g$;

-- ================================================================ 3. caminho até Real (C11)
create or replace function public.usar_tronco_voz(tronco bigint, ativo boolean) returns text
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    t public.voz_troncos;
    ja_real boolean;
begin
    select * into t from public.voz_troncos x where x.id = tronco;
    if t.id is null or not public.pode_configurar_telefonia(t.empresa_id) then
        raise exception 'tronco não encontrado';
    end if;
    if not coalesce(ativo, false) then
        update public.voz_troncos x set ativo = false, atualizado_em = now() where x.id = t.id;
        return 'inativo';
    end if;
    if t.ativo then
        return 'ativo';
    end if;
    if t.teste_ok is not true or t.testado_em is null then
        raise exception 'o tronco precisa passar no teste da rota antes de ligar';
    end if;
    if cardinality(t.ips_operadora) = 0 or exists (select 1 from unnest(t.ips_operadora) y where not y = any (t.ips_liberados)) then
        raise exception 'os IPs da operadora ainda não foram liberados no firewall pela equipe MotorCX';
    end if;
    if t.autenticacao = 'senha' and t.segredo_guardado_em is null then
        raise exception 'guarde a senha do tronco antes de ligar';
    end if;
    if exists (select 1 from public.voz_troncos_pausas p where p.tronco_id = t.id and p.retomado_em is null) then
        raise exception 'a rota está pausada: teste de novo e toque em Retomar';
    end if;
    if public.cuida_voz(t.empresa_id) then
        update public.voz_troncos x set ativo = true, atualizado_em = now() where x.id = t.id;
        return 'ativo';
    end if;
    ja_real := exists (select 1 from public.pedidos_envio_real r where r.empresa_id = t.empresa_id
                                                               and r.canal = 'agente_voz' and r.situacao = 'ligado')
               or exists (select 1 from public.voz_config c where c.empresa_id = t.empresa_id and c.modo = 'real');
    if not ja_real then
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave, assunto)
        values ('equipe', t.empresa_id, 'atencao',
                left('Telefonia do cliente: ativar o tronco ' || t.referencia || ' (primeira vez)', 140),
                'O tronco passou no teste e os IPs estão liberados. Primeira vez da empresa: confira e ative no Console (até 1 dia útil).',
                '/console/fornecedores?aba=voz', 'usar_tronco_voz:' || t.id || ':' || coalesce(to_char(t.testado_em, 'YYYYMMDDHH24MISS'), ''),
                'equipe')
        on conflict (chave) where chave is not null do nothing;
        return 'pedido_equipe';
    end if;
    update public.voz_troncos x set ativo = true, atualizado_em = now() where x.id = t.id;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, assunto)
    values ('equipe', t.empresa_id, 'pronto', left('Telefonia do cliente: o tronco ' || t.referencia || ' entrou em uso', 140),
            'O Admin passou a usar o tronco depois do teste que passou.', '/console/fornecedores?aba=voz', 'equipe');
    return 'ativo';
end $$;
revoke all on function public.usar_tronco_voz(bigint, boolean) from public, anon;
grant execute on function public.usar_tronco_voz(bigint, boolean) to authenticated;

-- ================================================================ 4. retomar depois do teste (G18)
create or replace function public.retomar_rota_voz(pausa bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    p public.voz_troncos_pausas;
    t public.voz_troncos;
begin
    select * into p from public.voz_troncos_pausas x where x.id = pausa for update;
    if p.id is null or not public.pode_configurar_telefonia(p.empresa_id) then
        raise exception 'pausa não encontrada';
    end if;
    if p.retomado_em is not null then
        raise exception 'a rota já foi retomada';
    end if;
    select * into t from public.voz_troncos x where x.id = p.tronco_id;
    if t.teste_ok is not true or t.testado_em is null or t.testado_em <= p.pausado_em then
        raise exception 'rode o Testar a rota completo depois da pausa; Retomar só depois de um teste que passou';
    end if;
    update public.voz_troncos_pausas x
       set retomado_em = now(), retomado_por = auth.uid(),
           nota = 'Retomada pela empresa depois do teste da rota que passou em '
                  || to_char(t.testado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
     where x.id = p.id returning * into p;
    return jsonb_build_object('id', p.id, 'tronco_id', p.tronco_id, 'motivo', p.motivo, 'pausado_em', p.pausado_em,
                              'retomado_em', p.retomado_em);
end $$;
revoke all on function public.retomar_rota_voz(bigint) from public, anon;
grant execute on function public.retomar_rota_voz(bigint) to authenticated;

-- ================================================================ 5. leitura do cliente
create or replace view public.voz_numeros_teste_empresa with (security_barrier = true) as
    select n.id, n.empresa_id, n.mascara, n.criado_em, n.confirmado_em, n.guardado_em
      from public.voz_numeros_teste n
     where public.ve_telefonia(n.empresa_id);

create or replace view public.voz_testes_tronco_empresa with (security_barrier = true) as
    select x.id, x.empresa_id, x.tronco_id, x.numero_mascara, x.situacao, x.passos, x.bina_resposta, x.resumo,
           case when x.situacao in ('pedido', 'rodando') then x.codigo end as codigo,
           x.pedido_em, x.iniciado_em, x.concluido_em
      from public.voz_testes_tronco x
     where public.ve_telefonia(x.empresa_id);

create or replace view public.voz_pausas_empresa with (security_barrier = true) as
    select p.id, p.empresa_id, p.tronco_id, p.motivo, p.causa_sip, p.pausado_em, p.retomado_em
      from public.voz_troncos_pausas p
     where public.ve_telefonia(p.empresa_id);

revoke all on public.voz_numeros_teste_empresa, public.voz_testes_tronco_empresa, public.voz_pausas_empresa
    from public, anon, authenticated;
grant select on public.voz_numeros_teste_empresa, public.voz_testes_tronco_empresa, public.voz_pausas_empresa
    to authenticated, service_role;

-- Auditoria (como troncos e rotas): os números de teste (só hash, máscara e referência) e os testes (sem número; o
-- teste_ok que ele grava no tronco entra na Auditoria pela voz_troncos).
drop trigger if exists z_auditar on public.voz_numeros_teste;
create trigger z_auditar after insert or update or delete on public.voz_numeros_teste
    for each row execute function public.auditar();
drop trigger if exists z_auditar on public.voz_testes_tronco;
create trigger z_auditar after insert or delete on public.voz_testes_tronco
    for each row execute function public.auditar();
