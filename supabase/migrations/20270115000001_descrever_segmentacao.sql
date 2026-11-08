-- SQL 79 · Descrever segmentos e régua (etapa 5 da IA na Orquestração)
--
-- Decisões do dono (07/11/2026, DECISOES_IA › "Descrever segmentos e régua"; protótipo proto-segmentacao v2):
-- na Segmentação o usuário escreve UM texto com todos os segmentos e como a régua se comporta em cada um; a IA (na VM,
-- voz/gerar_segmentacao.py + motor/segmentacao_ia.py) devolve uma PROPOSTA: segmentos na ordem com condições, a
-- estratégia de cada um (fases do motor, raias por persona) e perguntas com opções onde o texto é ambíguo. O usuário
-- confere as contagens (previa_segmentacao, SQL 76), responde as perguntas (sem IA, sem custo) e clica Aplicar.
--
-- 1. segmentacao_pedidos: a fila (texto até 6.000 caracteres; um pedido em andamento por carteira). pedir_segmentacao
--    grava o pedido e RESERVA os 2 créditos de IA da função descrever_segmentos (SQL 78, pedido_ref
--    `seg:geracao:<id>`), na mesma transação: sem reserva (teto do Master), sem pedido. Não há item avulso por geração.
-- 2. pegar_pedido_segmentacao (VM): o próximo pedido e o contexto SEM dado pessoal: segmentos atuais da carteira
--    (código, nome, condições, ordem, com quem é compartilhado, se tem estratégia própria), códigos da empresa, nomes
--    e tipos dos campos (calculados + colunas da carga), até 30 valores distintos de cada coluna de texto com a
--    contagem (do retrato da rotina, já sem dado pessoal), canais com estado (ativo / desligado / não contratado),
--    personas com o mapeamento de canais e o hash do estado de hoje. Nunca cliente, CPF, telefone ou saldo individual.
-- 3. registrar_segmentacao (VM): com proposta → pedido 'gerado' e CONFIRMA os créditos (custo real em consumo_ia, só o
--    Master vê); sem proposta (LLM fora, esquema errado, recusado pelo motor) → 'com_erros' e ESTORNA. A IA nunca
--    escreve em segmentos ou estratégias: não há ferramenta de escrita, e aplicar é só do usuário.
-- 4. aplicar_segmentacao(pedido, proposta, previa_hash, carteiras_extra): UMA transação, tudo ou nada.
--    Confere o previa_hash (a carteira não mudou desde a geração; senão recusa), grava o snapshot em
--    segmentacao_aplicacoes e aplica: novo → clusters + segmentos_carteira; alterar → condições/nome; desligar →
--    segmentos_carteira.ativo = false SÓ nesta carteira (nunca delete, nunca clusters.ativo); ordem reescrita só dos
--    segmentos desta carteira; estratégia nova por criar_estrategia_segmento (SQL 75; a antiga não é apagada);
--    Demais (credores.demais_ativo); carteiras_extra: os segmentos novos lá também, com CÓPIA da estratégia.
--    Decisão do dono: os segmentos novos ou alterados e as estratégias novas nascem PAUSADOS nesta carteira
--    (segmentos_carteira.ativo = false, o "Pausados" da Orquestração) até o usuário conferir e ligar
--    (ligar_segmentacao). Canal "a ativar" (opção "Vou ativar o canal") ainda desligado: recusa.
-- 5. desfazer_segmentacao(aplicacao, forcar): volta condições, nomes, ordem, vínculos (ativo e estratégia) e Demais
--    do snapshot e desliga nesta carteira os segmentos criados (não apaga; as estratégias criadas ficam na empresa).
--    Só até a próxima rotina da empresa (decisão do dono); segmento mexido depois por outra pessoa vira conflito
--    listado (forcar = true desfaz mesmo assim).
-- 6. hash_segmentacao(empresa, credor): o estado que a proposta viu (segmentos da carteira, ordem, condições, vínculos,
--    estratégias e Demais).
-- Permissões (SPEC §6): ver/gerar/aplicar/ligar/desfazer = quem vê a empresa e tem pode('editar_orquestracao') e o
-- papel que edita segmentos (admin/planejamento, a mesma RLS de clusters e segmentos_carteira). Sem permissão, o site
-- esconde o caminho. RLS em todas as tabelas novas; o site só lê os pedidos e as aplicações; escrita só por função.
-- Depende dos SQL 75, 76 e 78. Pode rodar de novo sem erro.

-- ================================================================ 1. tabelas
create table if not exists public.segmentacao_pedidos (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null,
    texto         text not null check (char_length(trim(texto)) between 10 and 6000),
    situacao      text not null default 'pendente'
                  check (situacao in ('pendente', 'gerando', 'gerado', 'com_erros', 'descartado', 'aplicado')),
    proposta      jsonb check (proposta is null or (jsonb_typeof(proposta) = 'object' and octet_length(proposta::text) <= 600000)),
    resultado     jsonb check (resultado is null or (jsonb_typeof(resultado) = 'object' and octet_length(resultado::text) <= 20000)),
    hash_base     text check (hash_base is null or hash_base ~ '^[0-9a-f]{32}$'),
    pedido_por    uuid default auth.uid() references auth.users (id) on delete set null,
    pedido_em     timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    gerado_em     timestamptz,
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
create index if not exists segmentacao_pedidos_fila on public.segmentacao_pedidos (pedido_em) where situacao = 'pendente';
create index if not exists segmentacao_pedidos_carteira on public.segmentacao_pedidos (empresa_id, credor_id, pedido_em desc);
create unique index if not exists segmentacao_pedidos_um_por_vez on public.segmentacao_pedidos (credor_id)
    where situacao in ('pendente', 'gerando');
comment on table public.segmentacao_pedidos is
    'Descrever segmentos e régua: texto do usuário e a proposta da IA (só intenção compilada; nada aplicado). SQL 79.';

create table if not exists public.segmentacao_aplicacoes (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint not null,
    pedido_id     bigint references public.segmentacao_pedidos (id) on delete set null,
    autor         uuid default auth.uid() references auth.users (id) on delete set null,
    aplicada_em   timestamptz not null default now(),
    texto         text not null default '',
    proposta      jsonb not null check (jsonb_typeof(proposta) = 'object'),
    resumo        jsonb not null default '{}'::jsonb check (jsonb_typeof(resumo) = 'object'),
    antes         jsonb not null check (jsonb_typeof(antes) = 'object'),
    criados       jsonb not null default '{}'::jsonb check (jsonb_typeof(criados) = 'object'),
    situacao      text not null default 'aplicada' check (situacao in ('aplicada', 'desfeita')),
    ligada_em     timestamptz,
    desfeita_em   timestamptz,
    desfeita_por  uuid references auth.users (id) on delete set null,
    check (situacao <> 'desfeita' or desfeita_em is not null),
    foreign key (empresa_id, credor_id) references public.credores (empresa_id, id) on delete cascade
);
create index if not exists segmentacao_aplicacoes_carteira on public.segmentacao_aplicacoes (empresa_id, credor_id, aplicada_em desc);
comment on table public.segmentacao_aplicacoes is
    'Cada Aplicar de "Descrever segmentos e régua": o que mudou e o estado anterior (desfazer até a próxima rotina). SQL 79.';

alter table public.segmentacao_pedidos enable row level security;
alter table public.segmentacao_aplicacoes enable row level security;
drop policy if exists segmentacao_pedidos_ver on public.segmentacao_pedidos;
create policy segmentacao_pedidos_ver on public.segmentacao_pedidos for select to authenticated
    using (public.pode_ver_empresa(empresa_id) and public.pode('editar_orquestracao'));
drop policy if exists segmentacao_aplicacoes_ver on public.segmentacao_aplicacoes;
create policy segmentacao_aplicacoes_ver on public.segmentacao_aplicacoes for select to authenticated
    using (public.pode_ver_empresa(empresa_id) and public.pode('editar_orquestracao'));
revoke all on public.segmentacao_pedidos, public.segmentacao_aplicacoes from anon;
revoke insert, update, delete, truncate on public.segmentacao_pedidos, public.segmentacao_aplicacoes from authenticated;
grant select on public.segmentacao_pedidos, public.segmentacao_aplicacoes to authenticated;
grant select, insert, update, delete on public.segmentacao_pedidos, public.segmentacao_aplicacoes to service_role;

do $$
declare t text;
begin
    foreach t in array array['segmentacao_pedidos', 'segmentacao_aplicacoes'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;

-- ================================================================ 2. quem pode, e o estado que a proposta viu
create or replace function public.pode_descrever_segmentacao(empresa bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select auth.uid() is not null and public.pode_ver_empresa(empresa) and public.pode('editar_orquestracao')
           and public.tem_papel('admin', 'planejamento')
$$;

create or replace function public.hash_segmentacao(empresa bigint, credor bigint) returns text
language plpgsql stable security definer set search_path = public as $$
begin
    if auth.uid() is not null and not public.pode_ver_empresa(empresa) then
        raise exception 'sem permissão para ver esta empresa';
    end if;
    return md5(coalesce((
        select string_agg(concat_ws('|', s.cluster_id, s.codigo, s.nome, s.ordem, s.em_uso, s.vinculado,
                                    s.estrategia_id, c.condicoes::text, c.so_digital, c.canais_bloqueados::text),
                          E'\n' order by s.ordem, s.codigo, s.cluster_id)
          from public.segmentos_em_uso s join public.clusters c on c.id = s.cluster_id
         where s.empresa_id = empresa and s.credor_id = credor and s.vinculado), '')
        || '#' || coalesce((select cr.demais_ativo::text || ':' || coalesce(cr.estrategia_id::text, '')
                              from public.credores cr where cr.id = credor and cr.empresa_id = empresa), 'x'));
end $$;

-- ================================================================ 3. pedir (reserva 2 créditos) e descartar
create or replace function public.pedir_segmentacao(empresa bigint, credor bigint, texto text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    pid bigint;
    r jsonb;
    t text := trim(coalesce(pedir_segmentacao.texto, ''));
begin
    if not public.pode_descrever_segmentacao(empresa) then
        raise exception 'sem permissão: "Descrever segmentos e régua" pede a permissão de editar a orquestração';
    end if;
    if not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'a carteira não é desta empresa';
    end if;
    if char_length(t) < 10 then
        raise exception 'escreva como a carteira se divide (pelo menos 10 caracteres)';
    end if;
    if char_length(t) > 6000 then
        raise exception 'o texto passou de 6.000 caracteres (tem %)', char_length(t);
    end if;
    if exists (select 1 from public.segmentacao_pedidos p where p.credor_id = credor and p.situacao in ('pendente', 'gerando')) then
        raise exception 'já há uma proposta desta carteira sendo gerada';
    end if;
    insert into public.segmentacao_pedidos (empresa_id, credor_id, texto) values (empresa, credor, t) returning id into pid;
    r := public.reservar_creditos_ia_em(empresa, 'descrever_segmentos', 'seg:geracao:' || pid, 'usuario', auth.uid(),
                                        (now() at time zone 'America/Sao_Paulo')::date);
    if not coalesce((r ->> 'ok')::boolean, false) then
        raise exception '%', coalesce(r ->> 'mensagem', 'não deu para reservar os créditos de IA');
    end if;
    return jsonb_build_object('pedido', pid, 'creditos', r);
end $$;

create or replace function public.descartar_segmentacao(pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p public.segmentacao_pedidos;
begin
    select * into p from public.segmentacao_pedidos x where x.id = pedido for update;
    if p.id is null or not public.pode_descrever_segmentacao(p.empresa_id) then
        raise exception 'pedido não encontrado';
    end if;
    if p.situacao = 'aplicado' then
        raise exception 'proposta já aplicada: use Desfazer aplicação';
    end if;
    update public.segmentacao_pedidos x set situacao = 'descartado', atualizado_em = now() where x.id = pedido;
    -- ainda não gerada: a reserva volta (crédito confirmado não volta)
    perform public.estornar_creditos_ia('seg:geracao:' || pedido, 'descartado antes de gerar');
end $$;

-- ================================================================ 4. a VM: pegar e registrar
create or replace function public.pegar_pedido_segmentacao() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    p public.segmentacao_pedidos;
    h text;
    base date;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a geração (servidor) pega pedidos';
    end if;
    select * into p from public.segmentacao_pedidos x where x.situacao = 'pendente'
     order by x.pedido_em limit 1 for update skip locked;
    if p.id is null then
        return null;
    end if;
    h := public.hash_segmentacao(p.empresa_id, p.credor_id);
    update public.segmentacao_pedidos x set situacao = 'gerando', hash_base = h, atualizado_em = now() where x.id = p.id;
    select max(a.data_base) into base from public.atributos_previa a where a.empresa_id = p.empresa_id and a.credor_id = p.credor_id;
    return jsonb_build_object(
        'pedido', p.id, 'empresa_id', p.empresa_id, 'credor_id', p.credor_id, 'texto', p.texto, 'hash_base', h,
        'carteira', (select jsonb_build_object('nome', coalesce(nullif(trim(c.nome), ''), c.codigo))
                       from public.credores c where c.id = p.credor_id),
        'segmentos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'codigo', s.codigo, 'nome', s.nome, 'ordem', s.ordem, 'condicoes', c.condicoes, 'em_uso', s.em_uso,
                       'compartilhado_com', coalesce((select jsonb_agg(distinct coalesce(nullif(trim(cr.nome), ''), cr.codigo))
                                                        from public.segmentos_em_uso o join public.credores cr on cr.id = o.credor_id
                                                       where o.cluster_id = s.cluster_id and o.credor_id <> s.credor_id and o.vinculado), '[]'),
                       'estrategia_propria', s.estrategia_propria,
                       'estrategia_nome', (select e.nome from public.estrategias e where e.id = s.estrategia_id))
                   order by s.ordem, s.codigo)
              from public.segmentos_em_uso s join public.clusters c on c.id = s.cluster_id
             where s.credor_id = p.credor_id and s.vinculado and c.ativo), '[]'),
        'codigos_empresa', coalesce((select jsonb_agg(c.codigo order by c.codigo) from public.clusters c
                                      where c.empresa_id = p.empresa_id), '[]'),
        'campos', (select jsonb_agg(y.x order by y.ord) from (
            select jsonb_build_object('nome', v.nome, 'rotulo', v.rotulo, 'tipo', v.tipo) as x, v.ord from (values
                ('saldo', 'Saldo total', 'numero', 1), ('dias_atraso', 'Dias de atraso', 'numero', 2),
                ('qtd_contratos', 'Quantidade de contratos', 'numero', 3), ('idade', 'Idade (anos)', 'numero', 4),
                ('qtd_telefones', 'Qtd. de telefones', 'numero', 5), ('tem_email', 'Tem e-mail', 'sim_nao', 6),
                ('tem_celular', 'Tem celular', 'sim_nao', 7), ('so_fixo', 'Só fixo', 'sim_nao', 8),
                ('tem_whatsapp', 'Tem WhatsApp', 'sim_nao', 9), ('persona', 'Persona', 'texto', 10)) v(nome, rotulo, tipo, ord)
            union all
            select jsonb_build_object('nome', k ->> 'nome', 'rotulo', k ->> 'nome',
                                      'tipo', case when k ->> 'tipo' = 'numero' then 'numero' else 'texto' end), 100 + n
              from public.empresas e,
                   jsonb_array_elements(case when jsonb_typeof(e.colunas_base -> 'colunas') = 'array' then e.colunas_base -> 'colunas'
                                             else '[]' end) with ordinality as z(k, n)
             where e.id = p.empresa_id and coalesce(k ->> 'nome', '') <> ''
               and k ->> 'nome' not in ('saldo', 'dias_atraso', 'qtd_contratos')) y),
        -- valores distintos (com contagem) das colunas de texto do retrato: só categorias, nunca um cliente
        'valores', coalesce((
            select jsonb_object_agg(col, vals) from (
                select col, jsonb_agg(jsonb_build_object('valor', val, 'clientes', q) order by q desc, val) filter (where rk <= 30) as vals
                  from (select a.key as col, a.value as val, count(*)::int as q,
                               row_number() over (partition by a.key order by count(*) desc, a.value) as rk
                          from public.atributos_previa ap, jsonb_each_text(ap.atributos) a
                         where ap.empresa_id = p.empresa_id and ap.credor_id = p.credor_id and ap.data_base = base
                           and public.previa_numero(a.value) is null
                         group by a.key, a.value) z
                 group by col
                having count(*) <= 50) w), '{}'),
        'canais', (select jsonb_object_agg(k.canal, case
                       when k.canal = 'agente_voz' and not exists (select 1 from public.voz_config v where v.empresa_id = p.empresa_id)
                           then 'nao_contratado'
                       when coalesce((select ce.ativo from public.canais_empresa ce where ce.empresa_id = p.empresa_id and ce.canal = k.canal), true)
                           then 'ativo' else 'desligado' end)
                     from unnest(array['whatsapp', 'rcs', 'sms', 'email', 'agente_voz', 'discador']) as k(canal)),
        'personas', coalesce((
            select jsonb_agg(jsonb_build_object('id', pu.id::text, 'nome', pu.nome,
                                                'canais', coalesce((select to_jsonb(pm.canais_sugeridos) from public.personas_modelo pm
                                                                     where pm.nome = pu.nome limit 1), '[]'))
                             order by pu.ordem, pu.id)
              from public.personas_usuario pu where pu.credor_id = p.credor_id and pu.ativo), '[]'));
end $$;

create or replace function public.registrar_segmentacao(pedido bigint, proposta jsonb, resultado jsonb,
                                                        tokens bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    p public.segmentacao_pedidos;
    ok boolean;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só a geração (servidor) registra o resultado';
    end if;
    select * into p from public.segmentacao_pedidos x where x.id = pedido for update;
    if p.id is null or p.situacao <> 'gerando' then
        raise exception 'pedido não está em geração';
    end if;
    ok := proposta is not null and jsonb_typeof(proposta) = 'object' and jsonb_typeof(proposta -> 'segmentos') = 'object'
          and jsonb_typeof(proposta -> 'ordem') = 'array';
    if ok then
        update public.segmentacao_pedidos x
           set situacao = 'gerado', proposta = registrar_segmentacao.proposta, gerado_em = now(), atualizado_em = now(),
               resultado = case when jsonb_typeof(registrar_segmentacao.resultado) = 'object' then registrar_segmentacao.resultado end
         where x.id = pedido;
        perform public.confirmar_creditos_ia('seg:geracao:' || pedido, tokens);
    else
        update public.segmentacao_pedidos x
           set situacao = 'com_erros', gerado_em = now(), atualizado_em = now(),
               resultado = case when jsonb_typeof(registrar_segmentacao.resultado) = 'object' then registrar_segmentacao.resultado
                                else '{"erros": ["sem_proposta"]}'::jsonb end
         where x.id = pedido;
        perform public.estornar_creditos_ia('seg:geracao:' || pedido, 'geração sem proposta');
    end if;
    return jsonb_build_object('ok', ok, 'situacao', case when ok then 'gerado' else 'com_erros' end);
end $$;

-- ================================================================ 5. aplicar (uma transação)
-- vínculos de hoje gravados antes de mexer num segmento que valia por regra (todas ou uma carteira), como o
-- separar_estrategia faz: senão a linha nova tiraria o segmento das outras carteiras
create or replace function public.segmentacao_vincular(cluster bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.segmentos_carteira x where x.cluster_id = cluster) then
        insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo)
        select s.empresa_id, s.cluster_id, s.credor_id, s.em_uso from public.segmentos_em_uso s
         where s.cluster_id = cluster and s.vinculado
        on conflict (cluster_id, credor_id) do nothing;
    end if;
end $$;

create or replace function public.aplicar_segmentacao(pedido bigint, proposta jsonb, previa_hash text,
                                                      carteiras_extra bigint[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    p public.segmentacao_pedidos;
    emp bigint;
    cred bigint;
    nome_cart text;
    segs jsonb;
    ordem_refs jsonb;
    ref text;
    s jsonb;
    c jsonb;
    acao text;
    cl public.clusters;
    cid bigint;
    eid bigint;
    envolvidos bigint[] := '{}';
    novos bigint[] := '{}';
    pausados bigint[] := '{}';
    estrategias bigint[] := '{}';
    vinculos_extra jsonb := '[]';
    extras bigint[] := coalesce(carteiras_extra, '{}');
    n_novos int := 0; n_alt int := 0; n_desl int := 0; n_mant int := 0;
    base_ordem int;
    i int := 0;
    extra bigint;
    antes jsonb;
    aid bigint;
    ch text;
begin
    select * into p from public.segmentacao_pedidos x where x.id = pedido for update;
    if p.id is null or not public.pode_descrever_segmentacao(p.empresa_id) then
        raise exception 'sem permissão para aplicar nesta carteira';
    end if;
    if p.situacao <> 'gerado' then
        raise exception 'esta proposta não está pronta para aplicar (situação: %)', p.situacao;
    end if;
    emp := p.empresa_id;
    cred := p.credor_id;
    select coalesce(nullif(trim(cr.nome), ''), cr.codigo) into nome_cart from public.credores cr where cr.id = cred;
    -- uma aplicação por carteira de cada vez
    perform pg_advisory_xact_lock(hashtextextended('segmentacao:' || cred, 79));
    if previa_hash is null or previa_hash <> public.hash_segmentacao(emp, cred) then
        raise exception 'a carteira mudou desde a geração (segmentos, ordem ou estratégias); gere a prévia de novo';
    end if;
    if proposta is null or jsonb_typeof(proposta) <> 'object' or jsonb_typeof(proposta -> 'segmentos') <> 'object'
       or jsonb_typeof(proposta -> 'ordem') <> 'array' then
        raise exception 'proposta inválida';
    end if;
    segs := proposta -> 'segmentos';
    ordem_refs := proposta -> 'ordem';
    if (select count(*) from jsonb_each(segs) e where e.value ->> 'acao' in ('novo', 'alterar')
                                                    and coalesce((e.value ->> 'incluir')::boolean, true)) > 8 then
        raise exception 'no máximo 8 segmentos novos ou alterados por texto';
    end if;
    if exists (select 1 from jsonb_array_elements_text(ordem_refs) r where not segs ? r) then
        raise exception 'proposta inválida: a ordem cita um segmento que não está na proposta';
    end if;
    if exists (select 1 from unnest(extras) x
                where x = cred or not exists (select 1 from public.credores c2 where c2.id = x and c2.empresa_id = emp)) then
        raise exception 'carteira extra inválida';
    end if;

    -- validação de cada segmento (antes de qualquer escrita)
    for ref, s in select e.key, e.value from jsonb_each(segs) e loop
        acao := s ->> 'acao';
        if acao not in ('novo', 'alterar', 'manter', 'desligar') then
            raise exception 'segmento %: ação inválida', ref;
        end if;
        if not coalesce((s ->> 'incluir')::boolean, true) then
            continue;
        end if;
        if acao = 'novo' and coalesce(s ->> 'codigo', '') !~ '^[A-Z0-9]{1,4}$' then
            raise exception 'segmento %: código inválido', ref;
        end if;
        if acao <> 'novo' then
            select * into cl from public.clusters x where x.empresa_id = emp and x.codigo = s ->> 'existente';
            if cl.id is null or not exists (select 1 from public.segmentos_em_uso u
                                             where u.cluster_id = cl.id and u.credor_id = cred and u.vinculado) then
                raise exception 'segmento %: % não está nesta carteira', ref, coalesce(s ->> 'existente', '?');
            end if;
        end if;
        if acao in ('novo', 'alterar') then
            if jsonb_typeof(s -> 'condicoes') <> 'array' then
                raise exception 'segmento %: condições inválidas', ref;
            end if;
            for c in select x from jsonb_array_elements(s -> 'condicoes') x loop
                perform public.previa_condicao_sql(c);          -- mesma validação de cluster.ler_condicoes
            end loop;
        end if;
        if s ->> 'estrategia' = 'nova' and jsonb_typeof(s -> 'definicao') <> 'object' then
            raise exception 'segmento %: estratégia sem definição', ref;
        end if;
        for ch in select jsonb_array_elements_text(case when jsonb_typeof(s -> 'canais_a_ativar') = 'array'
                                                          then s -> 'canais_a_ativar' else '[]' end) loop
            if not coalesce((select ce.ativo from public.canais_empresa ce where ce.empresa_id = emp and ce.canal = ch), true)
               or (ch = 'agente_voz' and not exists (select 1 from public.voz_config vc where vc.empresa_id = emp)) then
                raise exception 'ative o canal % antes de aplicar (você escolheu "Vou ativar o canal")', ch;
            end if;
        end loop;
    end loop;

    -- snapshot: segmentos desta carteira (e os citados), seus vínculos em todas as carteiras e o Demais
    select coalesce(array_agg(distinct u.cluster_id), '{}') into envolvidos
      from public.segmentos_em_uso u where u.credor_id = cred and u.vinculado;
    antes := jsonb_build_object(
        'clusters', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'codigo', x.codigo, 'nome', x.nome,
                                   'condicoes', x.condicoes, 'ordem', x.ordem, 'so_digital', x.so_digital,
                                   'canais_bloqueados', to_jsonb(x.canais_bloqueados), 'credor_id', x.credor_id,
                                   'atualizado_em', x.atualizado_em) order by x.id)
                                from public.clusters x where x.id = any (envolvidos)), '[]'),
        'vinculos', coalesce((select jsonb_agg(jsonb_build_object('cluster_id', v.cluster_id, 'credor_id', v.credor_id,
                                   'ativo', v.ativo, 'estrategia_id', v.estrategia_id) order by v.cluster_id, v.credor_id)
                                from public.segmentos_carteira v where v.cluster_id = any (envolvidos)), '[]'),
        'demais_ativo', (select cr.demais_ativo from public.credores cr where cr.id = cred));

    -- a ordem final começa na posição do 1º segmento atual desta carteira (a dos outros segmentos não muda)
    select coalesce(min(x.ordem), (select coalesce(max(y.ordem), 0) + 10 from public.clusters y where y.empresa_id = emp))
      into base_ordem from public.clusters x where x.id = any (envolvidos);

    -- desligar (só nesta carteira)
    for ref, s in select e.key, e.value from jsonb_each(segs) e where e.value ->> 'acao' = 'desligar'
                                                                 and coalesce((e.value ->> 'incluir')::boolean, true) loop
        select x.id into cid from public.clusters x where x.empresa_id = emp and x.codigo = s ->> 'existente';
        perform public.segmentacao_vincular(cid);
        update public.segmentos_carteira x set ativo = false where x.cluster_id = cid and x.credor_id = cred;
        n_desl := n_desl + 1;
    end loop;

    -- na ordem: cria, altera, mantém; estratégia nova; pausado nesta carteira
    for ref in select r from jsonb_array_elements_text(ordem_refs) with ordinality as o(r, k) order by k loop
        s := segs -> ref;
        acao := s ->> 'acao';
        if acao = 'desligar' or not coalesce((s ->> 'incluir')::boolean, true) then
            continue;
        end if;
        if acao = 'novo' then
            insert into public.clusters (empresa_id, ordem, codigo, nome, condicoes, so_digital, canais_bloqueados, ativo)
            values (emp, base_ordem + i * 10, s ->> 'codigo', left(coalesce(nullif(trim(s ->> 'nome'), ''), s ->> 'codigo'), 60),
                    s -> 'condicoes', coalesce((s ->> 'so_digital')::boolean, false),
                    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(s -> 'canais_bloqueados') = 'array'
                                                                         then s -> 'canais_bloqueados' else '[]' end)), '{}'), true)
            returning id into cid;
            insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo) values (emp, cid, cred, false);
            novos := novos || cid;
            pausados := pausados || cid;
            n_novos := n_novos + 1;
        else
            select x.id into cid from public.clusters x where x.empresa_id = emp and x.codigo = s ->> 'existente';
            perform public.segmentacao_vincular(cid);
            if acao = 'alterar' then
                update public.clusters x
                   set condicoes = s -> 'condicoes', nome = left(coalesce(nullif(trim(s ->> 'nome'), ''), x.nome), 60),
                       so_digital = coalesce((s ->> 'so_digital')::boolean, x.so_digital),
                       canais_bloqueados = case when jsonb_typeof(s -> 'canais_bloqueados') = 'array'
                                                then array(select jsonb_array_elements_text(s -> 'canais_bloqueados'))
                                                else x.canais_bloqueados end,
                       ordem = base_ordem + i * 10
                 where x.id = cid;
                n_alt := n_alt + 1;
            else
                update public.clusters x set ordem = base_ordem + i * 10 where x.id = cid and x.ordem <> base_ordem + i * 10;
                n_mant := n_mant + 1;
            end if;
            if acao = 'alterar' or s ->> 'estrategia' = 'nova' then
                update public.segmentos_carteira x set ativo = false where x.cluster_id = cid and x.credor_id = cred;
                pausados := pausados || cid;
            end if;
        end if;
        if s ->> 'estrategia' = 'nova' then
            eid := public.criar_estrategia_segmento(cid, cred, s -> 'definicao',
                                                    left(coalesce(nullif(trim(s ->> 'nome'), ''), s ->> 'codigo') || ' · ' || nome_cart, 100));
            update public.estrategias x
               set descricao = 'Gerada por "Descrever segmentos e régua" (pedido ' || p.id || '); confira e ligue o segmento.'
             where x.id = eid;
            estrategias := estrategias || eid;
        end if;
        -- carteiras extra: o segmento novo lá também, pausado, com CÓPIA da estratégia (mudar uma não muda a outra)
        if acao = 'novo' then
            foreach extra in array extras loop
                insert into public.segmentos_carteira (empresa_id, cluster_id, credor_id, ativo) values (emp, cid, extra, false)
                on conflict (cluster_id, credor_id) do nothing;
                vinculos_extra := vinculos_extra || jsonb_build_array(jsonb_build_object('cluster_id', cid, 'credor_id', extra));
                if s ->> 'estrategia' = 'nova' then
                    eid := public.criar_estrategia_segmento(cid, extra, s -> 'definicao',
                        left(coalesce(nullif(trim(s ->> 'nome'), ''), s ->> 'codigo') || ' · '
                             || (select coalesce(nullif(trim(cr.nome), ''), cr.codigo) from public.credores cr where cr.id = extra), 100));
                    update public.estrategias x
                       set descricao = 'Gerada por "Descrever segmentos e régua" (pedido ' || p.id || ', cópia para esta carteira); confira e ligue o segmento.'
                     where x.id = eid;
                    estrategias := estrategias || eid;
                end if;
            end loop;
        end if;
        i := i + 1;
    end loop;

    update public.credores x set demais_ativo = coalesce(proposta ->> 'demais', 'manter') <> 'desligar'
     where x.id = cred and x.demais_ativo is distinct from (coalesce(proposta ->> 'demais', 'manter') <> 'desligar');

    insert into public.segmentacao_aplicacoes (empresa_id, credor_id, pedido_id, texto, proposta, resumo, antes, criados)
    values (emp, cred, p.id, p.texto, proposta,
            jsonb_build_object('novos', n_novos, 'alterados', n_alt, 'desligados', n_desl, 'mantidos', n_mant,
                               'estrategias', cardinality(estrategias), 'pausados', cardinality(pausados),
                               'carteiras_extra', to_jsonb(extras)),
            antes,
            jsonb_build_object('clusters', to_jsonb(novos), 'estrategias', to_jsonb(estrategias),
                               'pausados', to_jsonb(pausados), 'vinculos_extra', vinculos_extra))
    returning id into aid;
    update public.segmentacao_pedidos x set situacao = 'aplicado', atualizado_em = now() where x.id = p.id;
    return jsonb_build_object('aplicacao', aid, 'novos', n_novos, 'alterados', n_alt, 'desligados', n_desl,
                              'mantidos', n_mant, 'estrategias', cardinality(estrategias), 'pausados', to_jsonb(pausados));
end $$;

-- ================================================================ 6. ligar o que nasceu pausado
create or replace function public.ligar_segmentacao(aplicacao bigint, segmentos bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
    a public.segmentacao_aplicacoes;
    n int;
begin
    select * into a from public.segmentacao_aplicacoes x where x.id = aplicacao for update;
    if a.id is null or not public.pode_descrever_segmentacao(a.empresa_id) then
        raise exception 'aplicação não encontrada';
    end if;
    if a.situacao <> 'aplicada' then
        raise exception 'esta aplicação foi desfeita';
    end if;
    update public.segmentos_carteira x set ativo = true
     where x.credor_id = a.credor_id and not x.ativo
       and x.cluster_id in (select jsonb_array_elements_text(a.criados -> 'pausados')::bigint)
       and (segmentos is null or x.cluster_id = any (segmentos));
    get diagnostics n = row_count;
    if not exists (select 1 from public.segmentos_carteira x
                    where x.credor_id = a.credor_id and not x.ativo
                      and x.cluster_id in (select jsonb_array_elements_text(a.criados -> 'pausados')::bigint)) then
        update public.segmentacao_aplicacoes x set ligada_em = coalesce(x.ligada_em, now()) where x.id = aplicacao;
    end if;
    return n;
end $$;

-- ================================================================ 7. desfazer (até a próxima rotina)
create or replace function public.desfazer_segmentacao(aplicacao bigint, forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    a public.segmentacao_aplicacoes;
    conflitos text[];
    k jsonb;
    v jsonb;
begin
    select * into a from public.segmentacao_aplicacoes x where x.id = aplicacao for update;
    if a.id is null or not public.pode_descrever_segmentacao(a.empresa_id) then
        raise exception 'aplicação não encontrada';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('segmentacao:' || a.credor_id, 79));
    if a.situacao <> 'aplicada' then
        raise exception 'esta aplicação já foi desfeita';
    end if;
    if exists (select 1 from public.execucoes e where e.empresa_id = a.empresa_id and e.iniciada_em > a.aplicada_em) then
        raise exception 'a rotina já rodou depois da aplicação: desfazer vale só até a próxima rotina';
    end if;
    if exists (select 1 from public.segmentacao_aplicacoes x where x.credor_id = a.credor_id and x.situacao = 'aplicada'
                                                               and x.aplicada_em > a.aplicada_em) then
        raise exception 'há uma aplicação mais nova nesta carteira: desfaça a mais nova primeiro';
    end if;
    -- mexido por outra pessoa depois da aplicação: lista e só desfaz com forcar
    select array_agg(c.codigo order by c.codigo) into conflitos
      from public.clusters c
     where c.id in (select (j ->> 'id')::bigint from jsonb_array_elements(a.antes -> 'clusters') j)
       and c.atualizado_em > a.aplicada_em;
    if conflitos is not null and not forcar then
        return jsonb_build_object('ok', false, 'conflitos', to_jsonb(conflitos));
    end if;
    -- condições, nomes, ordem e flags de antes
    for k in select x from jsonb_array_elements(a.antes -> 'clusters') x loop
        update public.clusters c
           set nome = k ->> 'nome', condicoes = k -> 'condicoes', ordem = (k ->> 'ordem')::int,
               so_digital = (k ->> 'so_digital')::boolean,
               canais_bloqueados = array(select jsonb_array_elements_text(k -> 'canais_bloqueados'))
         where c.id = (k ->> 'id')::bigint;
    end loop;
    -- vínculos de antes: os que não existiam saem (foram gravados por esta aplicação), os outros voltam
    delete from public.segmentos_carteira x
     where x.cluster_id in (select (j ->> 'id')::bigint from jsonb_array_elements(a.antes -> 'clusters') j)
       and not exists (select 1 from jsonb_array_elements(a.antes -> 'vinculos') w
                        where (w ->> 'cluster_id')::bigint = x.cluster_id and (w ->> 'credor_id')::bigint = x.credor_id);
    for v in select x from jsonb_array_elements(a.antes -> 'vinculos') x loop
        update public.segmentos_carteira x
           set ativo = (v ->> 'ativo')::boolean, estrategia_id = (v ->> 'estrategia_id')::bigint
         where x.cluster_id = (v ->> 'cluster_id')::bigint and x.credor_id = (v ->> 'credor_id')::bigint;
    end loop;
    -- segmentos criados: desligados nesta carteira (e nas extras); nunca apagados. Estratégias criadas ficam.
    update public.segmentos_carteira x set ativo = false
     where x.cluster_id in (select jsonb_array_elements_text(a.criados -> 'clusters')::bigint);
    update public.credores x set demais_ativo = (a.antes ->> 'demais_ativo')::boolean
     where x.id = a.credor_id and a.antes ? 'demais_ativo';
    update public.segmentacao_aplicacoes x set situacao = 'desfeita', desfeita_em = now(), desfeita_por = auth.uid()
     where x.id = aplicacao;
    return jsonb_build_object('ok', true, 'conflitos', coalesce(to_jsonb(conflitos), '[]'));
end $$;

-- ================================================================ 8. acesso próprio da VM (schema voz_vm)
create or replace function voz_vm.pegar_pedido_segmentacao(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.pegar_pedido_segmentacao()
$$;
create or replace function voz_vm.registrar_segmentacao(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.registrar_segmentacao((args ->> 'pedido')::bigint,
                                        case when jsonb_typeof(args -> 'proposta') = 'object' then args -> 'proposta' end,
                                        args -> 'resultado', (args ->> 'tokens')::bigint)
$$;
revoke all on function voz_vm.pegar_pedido_segmentacao(jsonb), voz_vm.registrar_segmentacao(jsonb)
    from public, anon, authenticated, service_role;
grant execute on function voz_vm.pegar_pedido_segmentacao(jsonb), voz_vm.registrar_segmentacao(jsonb) to motorcx_voz;

-- ================================================================ 9. permissões das funções
revoke all on function public.pode_descrever_segmentacao(bigint), public.hash_segmentacao(bigint, bigint),
    public.pedir_segmentacao(bigint, bigint, text), public.descartar_segmentacao(bigint),
    public.aplicar_segmentacao(bigint, jsonb, text, bigint[]), public.ligar_segmentacao(bigint, bigint[]),
    public.desfazer_segmentacao(bigint, boolean)
    from public, anon;
grant execute on function public.pode_descrever_segmentacao(bigint), public.hash_segmentacao(bigint, bigint),
    public.pedir_segmentacao(bigint, bigint, text), public.descartar_segmentacao(bigint),
    public.aplicar_segmentacao(bigint, jsonb, text, bigint[]), public.ligar_segmentacao(bigint, bigint[]),
    public.desfazer_segmentacao(bigint, boolean)
    to authenticated, service_role;
revoke all on function public.pegar_pedido_segmentacao(), public.registrar_segmentacao(bigint, jsonb, jsonb, bigint),
    public.segmentacao_vincular(bigint)
    from public, anon, authenticated;
grant execute on function public.pegar_pedido_segmentacao(), public.registrar_segmentacao(bigint, jsonb, jsonb, bigint)
    to service_role;
