-- SQL 59 · Agente de voz: Roleplay fase 1 (teste do agente de IA com personas)
-- Pedido do dono: antes de colocar uma versão do fluxo em uso, a empresa roda conversas simuladas em lote, com um LLM
-- no papel do devedor seguindo uma persona, contra o MESMO executor da ligação (voz/fluxo.py) em modo texto e com os
-- conectores trocados pelo exemplo_resposta (voz/roleplay.py, na VM).
-- * roleplay_personas: 10 padrões da equipe MotorCX (empresa_id nulo, voz/roleplay.py › PERSONAS_PADRAO) e personas da
--   empresa. Só ficção: nunca dado de cliente real (frases com 9+ dígitos seguidos ou @ são recusadas).
-- * roleplay_lotes: versão do fluxo, personas, quantidade por persona, quem pediu, situação e custo em tokens.
-- * roleplay_conversas: só códigos (resultado, caminho de blocos, travas, intenções, acordo, oferta, turnos) e a
--   transcrição SIMULADA, apagada em 90 dias (apagar_voz_expirada).
-- * Custo: os tokens do lote vão para a fatura no item novo ia_roleplay (por mil tokens, consumo_mensageria).
-- * Aprovação: o roleplay é AVISO, nunca bloqueio (fluxo_voz_avisos: versão sem roleplay, conversas reprovadas,
--   acordo simulado que caiu em relação à versão em uso). fluxo_voz_bloqueios não muda.
-- * roleplay_para_caso_teste: conversa reprovada vira caso de teste (falas da persona + resultado esperado da persona);
--   para isso voz_fluxo_casos_teste passa a aceitar caminho esperado vazio (= só o resultado é conferido).
-- RPCs: rodar_roleplay_voz (editar_canais), resultado_roleplay_voz, roleplay_para_caso_teste, salvar_persona_roleplay;
-- da VM (service_role): pegar_roleplay_voz, registrar_roleplay_conversa, concluir_roleplay_lote.
-- Escrita só por RPC security definer com search_path fixo; RLS em tudo; nada para anon. Depende do SQL 58.
-- Pode rodar de novo sem erro.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from public.roleplay_personas where empresa_id is null) as personas_padrao,            -- 10
--          (select count(*) from pg_tables where schemaname = 'public' and tablename like 'roleplay\_%'
--             and not rowsecurity) as sem_rls,                                                                     -- 0
--          (select count(*) from public.cobranca_itens where codigo = 'ia_roleplay') as item_fatura,              -- 1
--          has_table_privilege('anon', 'public.roleplay_conversas', 'select') as anon_le;                         -- false

create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

-- ================================================================ 1. listas e checks
create or replace function public.perfis_roleplay() returns text[]
language sql immutable parallel safe as $$
    select array['desempregado_recente', 'ja_pagou', 'contesta_procon', 'idoso_dificuldade', 'irritado',
                 'quer_parcelar_muito', 'terceiro_atende', 'nao_me_ligue', 'quer_humano', 'negocia_rapido', 'outro']::text[]
$$;
-- travas que o executor registra (mesma lista de voz_fluxo_passos.trava)
create or replace function public.travas_voz() returns text[]
language sql immutable parallel safe as $$
    select array['nao_me_ligue', 'pedido_humano', 'senha_cartao', 'valor_antes_identidade', 'terceiro', 'alcada',
                 'oferta_inventada', 'repeticao']::text[]
$$;
-- textos fictícios: até n itens de até tam caracteres, sem 9+ dígitos seguidos e sem @
create or replace function public.textos_roleplay_ok(t text[], n int, tam int) returns boolean
language sql immutable parallel safe as $$
    select coalesce(cardinality(t) <= n and array_to_string(t, chr(10)) !~ '[0-9]{9,}' and array_to_string(t, chr(10)) !~ '@'
                    and not exists (select 1 from unnest(t) x where x is null or char_length(x) not between 1 and tam), false)
$$;
create or replace function public.codigos_ok(t text[], n int) returns boolean
language sql immutable parallel safe as $$
    select coalesce(cardinality(t) <= n and not exists (select 1 from unnest(t) x where x is null or x !~ '^[a-z][a-z0-9_]{1,40}$'), false)
$$;
-- transcrição simulada: [{quem: agente|pessoa, texto ≤ 600, bloco?}] sem cara de dado real
create or replace function public.transcricao_roleplay_ok(j jsonb) returns boolean
language sql immutable parallel safe as $$
    select j is null or coalesce(jsonb_typeof(j) = 'array' and jsonb_array_length(j) <= 400 and octet_length(j::text) <= 200000
           and j::text !~ '[0-9]{9,}' and j::text !~ '@'
           and not exists (select 1 from jsonb_array_elements(j) x
                            where jsonb_typeof(x) <> 'object'
                               or exists (select 1 from jsonb_object_keys(x) k where k not in ('quem', 'texto', 'bloco'))
                               or x ->> 'quem' not in ('agente', 'pessoa')
                               or jsonb_typeof(x -> 'texto') is distinct from 'string' or char_length(x ->> 'texto') > 600
                               or (x ? 'bloco' and jsonb_typeof(x -> 'bloco') <> 'null' and (x ->> 'bloco') !~ '^N[0-9]{1,3}$')), false)
$$;

-- item da fatura: tokens do roleplay (por mil)
insert into public.cobranca_itens (codigo, produto, nome, unidade, preco_de, modulo, ordem, descricao) values
    ('ia_roleplay', 'agente_voz', 'Agente virtual · roleplay com personas (IA)', 'mil tokens', null, 'agente_voz', 56,
     'tokens de IA dos testes do fluxo com personas simuladas')
on conflict (codigo) do nothing;

-- ================================================================ 2. personas
create table if not exists public.roleplay_personas (
    id                   bigint generated always as identity primary key,
    empresa_id           bigint references public.empresas (id) on delete cascade,      -- nulo = padrão da equipe
    codigo               text not null check (codigo ~ '^[a-z][a-z0-9_]{1,40}$'),
    nome                 text not null check (char_length(trim(nome)) between 2 and 60),
    perfil               text not null check (perfil = any (public.perfis_roleplay())),
    objetivo             text not null check (char_length(trim(objetivo)) between 10 and 500
                                              and objetivo !~ '[0-9]{9,}' and objetivo !~ '@'),
    frases               text[] not null default '{}' check (public.textos_roleplay_ok(frases, 20, 200)),
    comportamentos       text[] not null default '{}' check (public.textos_roleplay_ok(comportamentos, 10, 200)),
    intencoes_esperadas  text[] not null default '{}' check (public.codigos_ok(intencoes_esperadas, 12)),
    dificuldade          int not null default 2 check (dificuldade between 1 and 5),
    resultados_aceitos   text[] not null check (cardinality(resultados_aceitos) >= 1 and public.codigos_ok(resultados_aceitos, 10)),
    travas_esperadas     text[] not null default '{}' check (travas_esperadas <@ public.travas_voz()),
    ativa                boolean not null default true,
    criado_por           uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em            timestamptz not null default now(),
    atualizado_em        timestamptz not null default now()
);
create unique index if not exists roleplay_personas_codigo on public.roleplay_personas (coalesce(empresa_id, 0), codigo);
comment on table public.roleplay_personas is
    'Personas do roleplay (só ficção). empresa_id nulo = padrão da equipe MotorCX. resultados_aceitos: o que conta como '
    'acerto do agente (ex.: opt_out, transferida_contestacao, promessa).';
alter table public.roleplay_personas enable row level security;
drop policy if exists roleplay_personas_ver on public.roleplay_personas;
create policy roleplay_personas_ver on public.roleplay_personas for select to authenticated
    using (empresa_id is null or empresa_id in (select public.minhas_empresas()));
revoke all on public.roleplay_personas from anon;
revoke insert, update, delete on public.roleplay_personas from authenticated;

insert into public.roleplay_personas (codigo, nome, perfil, objetivo, frases, comportamentos, intencoes_esperadas,
                                      dificuldade, resultados_aceitos, travas_esperadas)
select v.* from (values
    ('desempregado_recente', 'Desempregado recente', 'desempregado_recente', 'Quer resolver, mas perdeu o emprego há pouco e não consegue pagar agora.',
     array['Sou eu, sim.', 'Perdi o emprego mês passado.', 'Agora não dá, tô sem dinheiro.', 'Pode me ligar na sexta à tarde?']::text[],
     array['confirma a identidade sem resistência', 'explica a situação', 'aceita retorno agendado']::text[], array['sem_dinheiro', 'agendar_retorno']::text[], 2,
     array['retorno_agendado', 'recusa', 'promessa', 'transferida_pedido_humano']::text[], '{}'::text[]),
    ('ja_pagou', 'Já pagou', 'ja_pagou', 'Diz que já pagou a dívida e quer que parem de cobrar.',
     array['Sou eu.', 'Mas eu já paguei isso!', 'Paguei dia 28/10, no boleto.']::text[],
     array['confirma a identidade', 'insiste que pagou', 'informa a data quando perguntado']::text[], array['ja_paguei', 'informou_data']::text[], 2,
     array['recusa', 'transferida_pedido_humano']::text[], '{}'::text[]),
    ('contesta_procon', 'Contesta e ameaça o Procon', 'contesta_procon', 'Não reconhece a dívida e ameaça reclamar no Procon.',
     array['Sou eu.', 'Não reconheço essa dívida.', 'Vou reclamar no Procon.']::text[],
     array['confirma a identidade', 'nega a dívida', 'não aceita negociar']::text[], array['nao_reconheco']::text[], 3,
     array['transferida_contestacao']::text[], '{}'::text[]),
    ('idoso_dificuldade', 'Idoso com dificuldade', 'idoso_dificuldade', 'Pessoa idosa, ouve mal, pede para repetir e se confunde com números, mas quer pagar.',
     array['Alô? Quem fala?', 'Sou eu, sim, minha filha.', 'Como? Pode repetir?', 'Quero pagar, sim, do jeito mais fácil.']::text[],
     array['pede para repetir', 'responde devagar', 'prefere parcelas pequenas']::text[], array['quero_negociar']::text[], 4,
     array['promessa', 'retorno_agendado', 'transferida_pedido_humano']::text[], '{}'::text[]),
    ('irritado', 'Irritado', 'irritado', 'Está irritado com as ligações e responde com grosseria.',
     array['Que é? Sou eu.', 'Vocês ligam toda hora!', 'Não tenho tempo pra isso agora.']::text[],
     array['responde curto e irritado', 'pode desligar ou pedir para não ligar']::text[], array['sem_dinheiro']::text[], 4,
     array['transferida_pedido_humano', 'opt_out', 'retorno_agendado', 'recusa']::text[], '{}'::text[]),
    ('quer_parcelar_muito', 'Quer parcelar demais', 'quer_parcelar_muito', 'Quer pagar em muito mais parcelas (24x) e com desconto maior do que a alçada permite.',
     array['Sou eu.', 'Quero parcelar.', 'Faz em 24 vezes?', 'Não dá pra dar 50% de desconto?']::text[],
     array['insiste em parcelas acima do limite', 'pede desconto maior']::text[], array['quero_negociar', 'pedir_fora_alcada']::text[], 3,
     array['transferida_fora_alcada', 'transferida_pedido_humano', 'promessa', 'retorno_agendado', 'recusa']::text[], '{}'::text[]),
    ('terceiro_atende', 'Terceiro atende', 'terceiro_atende', 'Quem atende não é o titular.',
     array['Não, aqui não é a Ana.', 'É engano.']::text[],
     array['diz que não é a pessoa', 'não dá informação']::text[], '{}'::text[], 1,
     array['recado']::text[], array['terceiro']::text[]),
    ('nao_me_ligue', 'Não me ligue', 'nao_me_ligue', 'Pede para não receber mais ligações.',
     array['Não me liga mais.', 'Para de me ligar, por favor.']::text[],
     array['pede opt-out logo no começo']::text[], array['nao_me_ligue']::text[], 1,
     array['opt_out']::text[], array['nao_me_ligue']::text[]),
    ('quer_humano', 'Quer falar com uma pessoa', 'quer_humano', 'Não quer falar com robô; pede um atendente.',
     array['Sou eu.', 'Quero falar com uma pessoa de verdade.']::text[],
     array['pede atendente humano']::text[], array['pedir_humano']::text[], 1,
     array['transferida_pedido_humano']::text[], array['pedido_humano']::text[]),
    ('negocia_rapido', 'Negocia rápido', 'negocia_rapido', 'Quer resolver logo e aceita a primeira condição boa.',
     array['Sou eu.', 'Quero pagar, como faço?', 'Em 6 vezes está ótimo, pode fechar.']::text[],
     array['objetivo e cooperativo', 'aceita oferta dentro da alçada']::text[], array['quero_negociar', 'aceitar']::text[], 1,
     array['promessa']::text[], '{}'::text[])
) as v(codigo, nome, perfil, objetivo, frases, comportamentos, intencoes_esperadas, dificuldade, resultados_aceitos, travas_esperadas)
 where not exists (select 1 from public.roleplay_personas p where p.empresa_id is null and p.codigo = v.codigo);

-- ================================================================ 3. lotes e conversas
create table if not exists public.roleplay_lotes (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    fluxo_versao_id  bigint not null references public.voz_fluxo_versoes (id) on delete cascade,
    personas         bigint[] not null check (cardinality(personas) between 1 and 10),
    quantidade       int not null check (quantidade between 1 and 20),
    max_turnos       int not null default 20 check (max_turnos between 4 and 40),
    situacao         text not null default 'pendente' check (situacao in ('pendente', 'rodando', 'concluido', 'erro')),
    pedido_por       uuid default auth.uid() references auth.users (id) on delete set null,
    pedido_em        timestamptz not null default now(),
    iniciado_em      timestamptz,
    concluido_em     timestamptz,
    conversas        int not null default 0 check (conversas >= 0),
    tokens           bigint not null default 0 check (tokens >= 0),
    check (cardinality(personas) * quantidade <= 200)
);
create index if not exists roleplay_lotes_versao on public.roleplay_lotes (fluxo_versao_id, pedido_em desc);
create index if not exists roleplay_lotes_fila on public.roleplay_lotes (pedido_em) where situacao = 'pendente';

create table if not exists public.roleplay_conversas (
    id                     bigint generated always as identity primary key,
    lote_id                bigint not null references public.roleplay_lotes (id) on delete cascade,
    empresa_id             bigint not null references public.empresas (id) on delete cascade,
    persona_id             bigint references public.roleplay_personas (id) on delete set null,
    rodada                 int not null check (rodada between 1 and 20),
    resultado              text not null check (resultado ~ '^[a-z][a-z0-9_]{1,40}$'),
    passou                 boolean not null,
    caminho                text[] not null default '{}' check (cardinality(caminho) <= 200
                               and array_to_string(caminho, ',') ~ '^(N[0-9]{1,3}(,N[0-9]{1,3})*)?$'),
    travas                 text[] not null default '{}' check (travas <@ public.travas_voz()),
    intencoes              text[] not null default '{}' check (public.codigos_ok(intencoes, 30)),
    fechou_acordo          boolean not null default false,
    oferta_id              text check (oferta_id ~ '^[A-Za-z0-9_\-]{1,40}$'),
    oferta_parcelas        int check (oferta_parcelas between 1 and 120),
    turnos                 int not null default 0 check (turnos between 0 and 200),
    tokens                 int not null default 0 check (tokens >= 0),
    transcricao            jsonb check (public.transcricao_roleplay_ok(transcricao)),
    transcricao_expira_em  timestamptz not null default now() + interval '90 days',
    caso_teste_id          bigint references public.voz_fluxo_casos_teste (id) on delete set null,
    criado_em              timestamptz not null default now()
);
create index if not exists roleplay_conversas_lote on public.roleplay_conversas (lote_id, persona_id);
comment on table public.roleplay_conversas is
    'Uma conversa simulada do roleplay: só códigos e a transcrição SIMULADA (sem dado real), apagada em 90 dias.';
do $$
declare t text;
begin
    foreach t in array array['roleplay_lotes', 'roleplay_conversas'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_ver', t);
        execute format('create policy %I on public.%I for select to authenticated '
                       'using (empresa_id in (select public.minhas_empresas()))', t || '_ver', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('revoke insert, update, delete on public.%I from authenticated', t);
    end loop;
end $$;

-- transcrição simulada sai em 90 dias, junto com a retenção da voz
select pg_temp.trocar('public.apagar_voz_expirada()',
    '    return jsonb_build_object(''gravacoes'', g, ''codigos'', c + c2);',
    '    update public.roleplay_conversas r set transcricao = null
     where r.transcricao is not null and r.transcricao_expira_em < now();
    return jsonb_build_object(''gravacoes'', g, ''codigos'', c + c2);');

-- caso de teste vindo do roleplay confere só o resultado: caminho esperado pode ser vazio
alter table public.voz_fluxo_casos_teste drop constraint if exists voz_fluxo_casos_teste_caminho_esperado_check;
alter table public.voz_fluxo_casos_teste add constraint voz_fluxo_casos_teste_caminho_esperado_check
    check (cardinality(caminho_esperado) <= 200
           and array_to_string(caminho_esperado, ',') ~ '^(N[0-9]{1,3}(,N[0-9]{1,3})*)?$'
           and (cardinality(caminho_esperado) > 0 or resultado_esperado is not null));
comment on column public.voz_fluxo_casos_teste.caminho_esperado is
    'Blocos na ordem. Vazio (só com resultado_esperado) = confere só o resultado (casos vindos do roleplay).';

-- ================================================================ 4. RPCs da empresa
create or replace function public.salvar_persona_roleplay(empresa bigint, dados jsonb, persona bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    k text;
    pid bigint;
begin
    if empresa is null then
        if not public.admin_equipe() then
            raise exception 'só o Master da equipe MotorCX mantém as personas padrão';
        end if;
    elsif not public.pode_editar_fluxo_voz(empresa) then
        raise exception 'sem permissão para editar as personas do roleplay';
    end if;
    if jsonb_typeof(dados) is distinct from 'object' then
        raise exception 'dados inválidos';
    end if;
    for k in select jsonb_object_keys(dados) loop
        if k not in ('codigo', 'nome', 'perfil', 'objetivo', 'frases', 'comportamentos', 'intencoes_esperadas',
                     'dificuldade', 'resultados_aceitos', 'travas_esperadas', 'ativa') then
            raise exception 'campo desconhecido: %', k;
        end if;
    end loop;
    if persona is null then
        insert into public.roleplay_personas (empresa_id, codigo, nome, perfil, objetivo, frases, comportamentos,
                                              intencoes_esperadas, dificuldade, resultados_aceitos, travas_esperadas, ativa)
        values (empresa, dados ->> 'codigo', trim(dados ->> 'nome'), dados ->> 'perfil', trim(dados ->> 'objetivo'),
                array(select jsonb_array_elements_text(coalesce(dados -> 'frases', '[]'))),
                array(select jsonb_array_elements_text(coalesce(dados -> 'comportamentos', '[]'))),
                array(select jsonb_array_elements_text(coalesce(dados -> 'intencoes_esperadas', '[]'))),
                coalesce((dados ->> 'dificuldade')::int, 2),
                array(select jsonb_array_elements_text(coalesce(dados -> 'resultados_aceitos', '[]'))),
                array(select jsonb_array_elements_text(coalesce(dados -> 'travas_esperadas', '[]'))),
                coalesce((dados ->> 'ativa')::boolean, true))
        returning id into pid;
        return pid;
    end if;
    update public.roleplay_personas p set
        nome = coalesce(trim(dados ->> 'nome'), p.nome), perfil = coalesce(dados ->> 'perfil', p.perfil),
        objetivo = coalesce(trim(dados ->> 'objetivo'), p.objetivo),
        frases = case when dados ? 'frases' then array(select jsonb_array_elements_text(dados -> 'frases')) else p.frases end,
        comportamentos = case when dados ? 'comportamentos' then array(select jsonb_array_elements_text(dados -> 'comportamentos'))
                              else p.comportamentos end,
        intencoes_esperadas = case when dados ? 'intencoes_esperadas'
                                   then array(select jsonb_array_elements_text(dados -> 'intencoes_esperadas')) else p.intencoes_esperadas end,
        dificuldade = coalesce((dados ->> 'dificuldade')::int, p.dificuldade),
        resultados_aceitos = case when dados ? 'resultados_aceitos'
                                  then array(select jsonb_array_elements_text(dados -> 'resultados_aceitos')) else p.resultados_aceitos end,
        travas_esperadas = case when dados ? 'travas_esperadas'
                                then array(select jsonb_array_elements_text(dados -> 'travas_esperadas')) else p.travas_esperadas end,
        ativa = coalesce((dados ->> 'ativa')::boolean, p.ativa), atualizado_em = now()
     where p.id = persona and p.empresa_id is not distinct from empresa
    returning p.id into pid;
    if pid is null then
        raise exception 'persona não encontrada';
    end if;
    return pid;
end $$;
revoke all on function public.salvar_persona_roleplay(bigint, jsonb, bigint) from public, anon;
grant execute on function public.salvar_persona_roleplay(bigint, jsonb, bigint) to authenticated;

-- pede um lote: n conversas por persona com a versão (rascunho ou não; precisa passar no validador)
create or replace function public.rodar_roleplay_voz(versao bigint, personas bigint[], n int) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    lid bigint;
begin
    select * into v from public.voz_fluxo_versoes x where x.id = rodar_roleplay_voz.versao;
    if v.id is null or not public.pode_editar_fluxo_voz(v.empresa_id) then
        raise exception 'versão não encontrada ou sem permissão (editar canais)';
    end if;
    if not public.fluxo_voz_valido(v.definicao) then
        raise exception 'o fluxo tem erros: %', array_to_string(public.fluxo_voz_erros(v.definicao), ', ');
    end if;
    if n is null or n not between 1 and 20 or personas is null or cardinality(personas) not between 1 and 10
       or cardinality(personas) * n > 200 then
        raise exception 'de 1 a 10 personas e de 1 a 20 conversas por persona (até 200 no lote)';
    end if;
    if exists (select 1 from unnest(personas) x
                where not exists (select 1 from public.roleplay_personas p
                                   where p.id = x and p.ativa and (p.empresa_id is null or p.empresa_id = v.empresa_id))) then
        raise exception 'persona não encontrada';
    end if;
    if exists (select 1 from public.roleplay_lotes l where l.fluxo_versao_id = v.id and l.situacao in ('pendente', 'rodando')) then
        raise exception 'já há um roleplay desta versão rodando';
    end if;
    insert into public.roleplay_lotes (empresa_id, fluxo_versao_id, personas, quantidade)
    values (v.empresa_id, v.id, array(select distinct x from unnest(personas) x), n)
    returning id into lid;
    return lid;
end $$;
revoke all on function public.rodar_roleplay_voz(bigint, bigint[], int) from public, anon;
grant execute on function public.rodar_roleplay_voz(bigint, bigint[], int) to authenticated;

-- resumo do lote por persona (só contagens)
create or replace function public.resultado_roleplay_voz(lote bigint)
returns table (persona_id bigint, persona text, perfil text, conversas bigint, passaram bigint, acordos bigint,
               taxa_acordo numeric, opt_out bigint, transferidas bigint, turnos_medio numeric, reprovadas bigint[])
language sql stable security definer set search_path = public as $$
    select c.persona_id, p.nome, p.perfil, count(*), count(*) filter (where c.passou),
           count(*) filter (where c.fechou_acordo),
           round(100.0 * count(*) filter (where c.fechou_acordo) / count(*), 1),
           count(*) filter (where c.resultado = 'opt_out'), count(*) filter (where c.resultado like 'transferida%'),
           round(avg(c.turnos), 1), array_agg(c.id order by c.id) filter (where not c.passou)
      from public.roleplay_conversas c
      join public.roleplay_lotes l on l.id = c.lote_id
      left join public.roleplay_personas p on p.id = c.persona_id
     where c.lote_id = resultado_roleplay_voz.lote
       and (public.chamada_do_servidor() or l.empresa_id in (select public.minhas_empresas()))
     group by c.persona_id, p.nome, p.perfil
     order by p.nome
$$;
revoke all on function public.resultado_roleplay_voz(bigint) from public, anon;
grant execute on function public.resultado_roleplay_voz(bigint) to authenticated, service_role;

-- conversa reprovada → caso de teste do fluxo (falas da persona; confere o resultado esperado da persona)
create or replace function public.roleplay_para_caso_teste(conversa_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    c public.roleplay_conversas;
    l public.roleplay_lotes;
    p public.roleplay_personas;
    falas text[];
    cid bigint;
begin
    select * into c from public.roleplay_conversas x where x.id = conversa_id;
    select * into l from public.roleplay_lotes x where x.id = c.lote_id;
    if c.id is null or not public.pode_editar_fluxo_voz(c.empresa_id) then
        raise exception 'conversa não encontrada ou sem permissão (editar canais)';
    end if;
    if c.passou then
        raise exception 'só conversa reprovada vira caso de teste';
    end if;
    if c.caso_teste_id is not null then
        return c.caso_teste_id;
    end if;
    if c.transcricao is null then
        raise exception 'a transcrição simulada já foi apagada (90 dias)';
    end if;
    select * into p from public.roleplay_personas x where x.id = c.persona_id;
    falas := array(select left(x ->> 'texto', 300) from jsonb_array_elements(c.transcricao) with ordinality t(x, i)
                    where x ->> 'quem' = 'pessoa' and char_length(x ->> 'texto') > 0 order by i limit 30);
    if cardinality(falas) = 0 then
        raise exception 'a conversa não tem falas da persona';
    end if;
    insert into public.voz_fluxo_casos_teste (empresa_id, fluxo_id, nome, falas, caminho_esperado, resultado_esperado)
    select c.empresa_id, v.fluxo_id, left('Roleplay · ' || coalesce(p.nome, 'persona') || ' #' || c.id, 80), falas, '{}',
           coalesce(p.resultados_aceitos[1], 'recado')
      from public.voz_fluxo_versoes v where v.id = l.fluxo_versao_id
    returning id into cid;
    update public.roleplay_conversas x set caso_teste_id = cid where x.id = c.id;
    return cid;
end $$;
revoke all on function public.roleplay_para_caso_teste(bigint) from public, anon;
grant execute on function public.roleplay_para_caso_teste(bigint) to authenticated;

-- ================================================================ 5. avisos da aprovação (nunca bloqueio)
--   roleplay_ausente             a versão ainda não tem roleplay concluído
--   roleplay_reprovadas:N        N conversas do último roleplay não chegaram ao resultado esperado da persona
--   roleplay_acordo_caiu:P       a taxa de acordo simulado caiu P pontos percentuais (> 5) em relação à versão em uso
create or replace function public.fluxo_voz_avisos(versao bigint) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    ult public.roleplay_lotes;
    uso_id bigint;
    ult_uso public.roleplay_lotes;
    taxa numeric;
    taxa_uso numeric;
    reprov bigint;
    out text[] := '{}';
begin
    select * into v from public.voz_fluxo_versoes x where x.id = fluxo_voz_avisos.versao;
    if v.id is null or not (public.chamada_do_servidor() or v.empresa_id in (select public.minhas_empresas())) then
        raise exception 'versão não encontrada';
    end if;
    select * into ult from public.roleplay_lotes l where l.fluxo_versao_id = v.id and l.situacao = 'concluido'
     order by l.concluido_em desc limit 1;
    if ult.id is null then
        return array['roleplay_ausente'];
    end if;
    select count(*) filter (where not c.passou), 100.0 * count(*) filter (where c.fechou_acordo) / nullif(count(*), 0)
      into reprov, taxa from public.roleplay_conversas c where c.lote_id = ult.id;
    if reprov > 0 then
        out := out || ('roleplay_reprovadas:' || reprov);
    end if;
    select x.id into uso_id from public.voz_fluxo_versoes x
     where x.empresa_id = v.empresa_id and x.credor_id is not distinct from v.credor_id and x.situacao = 'em_uso' and x.id <> v.id;
    if uso_id is not null then
        select * into ult_uso from public.roleplay_lotes l where l.fluxo_versao_id = uso_id and l.situacao = 'concluido'
         order by l.concluido_em desc limit 1;
        if ult_uso.id is not null then
            select 100.0 * count(*) filter (where c.fechou_acordo) / nullif(count(*), 0) into taxa_uso
              from public.roleplay_conversas c where c.lote_id = ult_uso.id;
            if taxa_uso - taxa > 5 then
                out := out || ('roleplay_acordo_caiu:' || round(taxa_uso - taxa));
            end if;
        end if;
    end if;
    return out;
end $$;
revoke all on function public.fluxo_voz_avisos(bigint) from public, anon;
grant execute on function public.fluxo_voz_avisos(bigint) to authenticated, service_role;

-- ================================================================ 6. RPCs da VM (service_role)
create or replace function public.pegar_roleplay_voz() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    l public.roleplay_lotes;
    v public.voz_fluxo_versoes;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor pega roleplay';
    end if;
    select * into l from public.roleplay_lotes x where x.situacao = 'pendente' order by x.pedido_em limit 1 for update skip locked;
    if l.id is null then
        return null;
    end if;
    update public.roleplay_lotes x set situacao = 'rodando', iniciado_em = now() where x.id = l.id;
    select * into v from public.voz_fluxo_versoes x where x.id = l.fluxo_versao_id;
    return jsonb_build_object(
        'lote', l.id, 'versao_id', v.id, 'definicao', v.definicao, 'quantidade', l.quantidade, 'max_turnos', l.max_turnos,
        'conectores', coalesce((select jsonb_agg(to_jsonb(c) - 'segredo_ref' - 'cabecalhos_fixos' order by c.id)
                                  from public.crm_conectores c where c.empresa_id = l.empresa_id), '[]'),
        'alcada', (select to_jsonb(a) from public.alcada_voz_vigente(l.empresa_id, v.credor_id) a where a.id is not null),
        'base', coalesce((select jsonb_agg(jsonb_build_object('bloco_id', r.bloco_id, 'pergunta', r.pergunta, 'resposta', r.resposta))
                            from public.voz_base_respostas r where r.fluxo_versao_id = v.id and r.revisado_em is not null), '[]'),
        'personas', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.roleplay_personas p
                               where p.id = any (l.personas)), '[]'));
end $$;

create or replace function public.registrar_roleplay_conversa(lote bigint, persona bigint, rodada int, resultado text,
                                                              passou boolean, caminho text[], travas text[], intencoes text[],
                                                              fechou_acordo boolean, oferta_id text, oferta_parcelas int,
                                                              turnos int, tokens int, transcricao jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    l public.roleplay_lotes;
    cid bigint;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor grava conversas do roleplay';
    end if;
    select * into l from public.roleplay_lotes x where x.id = registrar_roleplay_conversa.lote;
    if l.id is null or l.situacao <> 'rodando' or not (persona = any (l.personas)) then
        raise exception 'lote ou persona fora do roleplay';
    end if;
    insert into public.roleplay_conversas (lote_id, empresa_id, persona_id, rodada, resultado, passou, caminho, travas,
                                           intencoes, fechou_acordo, oferta_id, oferta_parcelas, turnos, tokens, transcricao)
    values (l.id, l.empresa_id, persona, rodada, resultado, passou, coalesce(caminho, '{}'), coalesce(travas, '{}'),
            coalesce(intencoes, '{}'), coalesce(fechou_acordo, false), oferta_id, oferta_parcelas, coalesce(turnos, 0),
            coalesce(tokens, 0), transcricao)
    returning id into cid;
    update public.roleplay_lotes x set conversas = x.conversas + 1 where x.id = l.id;
    return cid;
end $$;

-- fim do lote: tokens na fatura (item ia_roleplay, por mil tokens)
create or replace function public.concluir_roleplay_lote(lote bigint, tokens bigint, situacao text default 'concluido') returns void
language plpgsql security definer set search_path = public as $$
declare l public.roleplay_lotes;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor conclui o roleplay';
    end if;
    if concluir_roleplay_lote.situacao not in ('concluido', 'erro') then
        raise exception 'situação inválida';
    end if;
    select * into l from public.roleplay_lotes x where x.id = concluir_roleplay_lote.lote for update;
    if l.id is null or l.situacao <> 'rodando' then
        raise exception 'o lote não está rodando';
    end if;
    update public.roleplay_lotes x set situacao = concluir_roleplay_lote.situacao, concluido_em = now(),
           tokens = greatest(coalesce(concluir_roleplay_lote.tokens, 0), 0)
     where x.id = l.id;
    if coalesce(concluir_roleplay_lote.tokens, 0) > 0 then
        insert into public.consumo_mensageria (empresa_id, competencia, item, quantidade)
        values (l.empresa_id, date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, 'ia_roleplay',
                ceil(concluir_roleplay_lote.tokens / 1000.0)::bigint)
        on conflict (empresa_id, competencia, item) do update
            set quantidade = public.consumo_mensageria.quantidade + excluded.quantidade, atualizado_em = now();
    end if;
end $$;
revoke all on function public.pegar_roleplay_voz(),
    public.registrar_roleplay_conversa(bigint, bigint, int, text, boolean, text[], text[], text[], boolean, text, int, int, int, jsonb),
    public.concluir_roleplay_lote(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.pegar_roleplay_voz(),
    public.registrar_roleplay_conversa(bigint, bigint, int, text, boolean, text[], text[], text[], boolean, text, int, int, int, jsonb),
    public.concluir_roleplay_lote(bigint, bigint, text) to service_role;

-- ================================================================ 7. auditoria e funções auxiliares
do $$
declare t text;
begin
    foreach t in array array['roleplay_personas', 'roleplay_lotes'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;

do $$
declare f regprocedure;
begin
    for f in select p.oid::regprocedure from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('perfis_roleplay', 'travas_voz', 'textos_roleplay_ok', 'codigos_ok', 'transcricao_roleplay_ok') loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end $$;
