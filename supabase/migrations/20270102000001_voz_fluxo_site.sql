-- SQL 66 · Agente de voz: o que a tela "Fluxo do agente" do site precisa e o SQL 58/59 não tinham
-- (o SQL 65 é o 20270101000001_voz_resubmit.sql)
-- Desenho aprovado (ux/redesign/fluxo-agente-v2.html) e decisões do dono:
-- 1. "Enviar para aprovação": quem edita (editar_canais) manda o rascunho para quem aprova (aprovar_roteiro_voz).
--    O SQL 58 só tinha aprovar_fluxo_voz (rascunho → aprovado_empresa, por quem aprova), sem um passo de "enviado".
--    enviar_fluxo_voz_aprovacao(versao): recusa enquanto houver bloqueio (fluxo_voz_bloqueios: validador, pendências
--    de contexto e casos de teste que falharam), marca enviado_aprovacao_em/enviado_por e avisa no sino cada pessoa
--    ativa da empresa que pode aprovar (pode_usuario do SQL 60). Mudar a definição do rascunho limpa o envio (trigger):
--    o que foi enviado é exatamente o que quem aprova vê. A aprovação continua sendo aprovar_fluxo_voz (nada muda nela).
-- 2. Anexos do pedido em texto ("Descrever e o MotorCX monta"): o SQL 58 aceita referências 'entradas/<slug>/...',
--    mas o bucket entradas só deixava enviar nas pastas da carga. Política nova: entradas/<slug>/fluxo/... para quem
--    edita canais na própria empresa (só envia; quem lê é a geração, pela chave do servidor, e quem apaga é a VM).
-- 3. Descartar o pedido em texto: cancelar_pedido_fluxo_voz(pedido). Quem edita cancela o pedido (pendente, gerado,
--    com_erros ou com a equipe; "gerando" espera terminar). Gerado: o rascunho gerado é apagado (só se ainda for
--    rascunho; aprovado ou em uso fica, e o pedido não cancela); se o fluxo nasceu do pedido e não tem outra versão, o
--    fluxo sai junto. Com a equipe: o chamado recebe a mensagem do cancelamento. O pedido fica guardado (cancelado_por,
--    cancelado_em; auditoria pelo z_auditar). Anexos: saem pela regra de 30 dias (anexos_fluxo_vencidos).
-- 4. Job noturno das métricas do fluxo (o SQL 58 deixou "ainda sem job"): agregar_fluxo_dia(empresa, dia) refaz do
--    zero voz_fluxo_metricas_dia e voz_fluxo_intencoes_dia do dia, por versão e bloco, a partir de voz_fluxo_passos
--    (entradas, saída seguida, intenção, turnos) e voz_chamadas (bloco_final: quem saiu sem saída num bloco que não é
--    final = "desligou"). Só códigos e contagens. Idempotente; dia até 35 dias atrás. fluxo_empresas_voz(parte) lista
--    as empresas com voz da parte i/n. Na VM: voz/fluxo_metricas.py (timer motorcx-voz-fluxo-noite, 02:50), nos dois
--    acessos (voz_vm.agregar_fluxo_dia e voz_vm.fluxo_empresas para o papel motorcx_voz).
-- 5. "Ouvir a voz" (prévia em áudio de uma fala no Testar conversa): o uso de TTS entra em registrar_uso_ia_voz com o
--    componente novo 'previa_voz' (tokens_entrada = caracteres sintetizados; minutos estimados; nada cobrado: minutos
--    cobráveis = 0, o custo real vai só para a margem). O áudio não é guardado em lugar nenhum.
-- Nada para anon. Escrita só por RPC security definer com search_path fixo. Pode rodar de novo sem erro.
-- Depende do SQL 57 (voz_vm), 58 (fluxos), 60 (pode_usuario, uso de IA) e do SQL 1/12 (avisos).
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from information_schema.columns where table_name = 'voz_fluxo_versoes'
--             and column_name in ('enviado_aprovacao_em', 'enviado_por')) as colunas,                         -- 2
--          has_function_privilege('authenticated', 'public.enviar_fluxo_voz_aprovacao(bigint)', 'execute') as site, -- true
--          has_function_privilege('anon', 'public.enviar_fluxo_voz_aprovacao(bigint)', 'execute') as anon,         -- false
--          (select count(*) from pg_policies where policyname = 'entradas_fluxo_enviar') as politica,              -- 1
--          has_function_privilege('authenticated', 'public.cancelar_pedido_fluxo_voz(bigint)', 'execute') as cancelar, -- true
--          has_function_privilege('motorcx_voz', 'voz_vm.agregar_fluxo_dia(jsonb)', 'execute') as vm_job;           -- true

-- ================================================================ 1. enviado para aprovação
alter table public.voz_fluxo_versoes add column if not exists enviado_aprovacao_em timestamptz;
alter table public.voz_fluxo_versoes add column if not exists enviado_por uuid references auth.users (id) on delete set null;
comment on column public.voz_fluxo_versoes.enviado_aprovacao_em is
    'Quando quem edita mandou o rascunho para aprovação (enviar_fluxo_voz_aprovacao). Mudar a definição limpa.';

-- mudou a definição do rascunho: o envio deixa de valer (quem aprova precisa ver a versão nova)
create or replace function public.limpar_envio_fluxo_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.definicao is distinct from old.definicao then
        new.enviado_aprovacao_em := null;
        new.enviado_por := null;
    end if;
    return new;
end $$;
revoke all on function public.limpar_envio_fluxo_voz() from public, anon, authenticated;
drop trigger if exists limpar_envio_fluxo_voz on public.voz_fluxo_versoes;
create trigger limpar_envio_fluxo_voz before update of definicao on public.voz_fluxo_versoes
    for each row execute function public.limpar_envio_fluxo_voz();

create or replace function public.enviar_fluxo_voz_aprovacao(versao bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
    v public.voz_fluxo_versoes;
    f public.voz_fluxos;
    pend text[];
begin
    select * into v from public.voz_fluxo_versoes x where x.id = enviar_fluxo_voz_aprovacao.versao for update;
    if v.id is null or not public.pode_editar_fluxo_voz(v.empresa_id) then
        raise exception 'versão não encontrada ou sem permissão para editar o fluxo';
    end if;
    if v.situacao <> 'rascunho' then
        raise exception 'a versão está em %: só rascunho vai para aprovação', replace(v.situacao, '_', ' ');
    end if;
    pend := public.fluxo_voz_bloqueios(v.id);
    if cardinality(pend) > 0 then
        raise exception 'o fluxo não pode ir para aprovação: %', array_to_string(pend, ', ');
    end if;
    update public.voz_fluxo_versoes x set enviado_aprovacao_em = now(), enviado_por = auth.uid() where x.id = v.id;
    select * into f from public.voz_fluxos where id = v.fluxo_id;
    -- sino de quem pode aprovar (uma vez por conteúdo enviado: o hash muda quando a definição muda)
    insert into public.avisos (para, empresa_id, usuario_id, tipo, titulo, texto, link, chave)
    select 'usuario', v.empresa_id, p.id, 'atencao',
           left('Fluxo do agente para aprovar · ' || f.nome || ' v' || v.versao, 140),
           'Quem edita os canais mandou o rascunho para aprovação. Ele só entra na próxima ligação depois de aprovado e '
           || 'colocado em uso.',
           '/canais/agente-virtual/editor/' || v.id,
           'voz_fluxo_enviado:' || v.id || ':' || left(v.hash, 16) || ':' || p.id
      from public.perfis p
     where p.empresa_id = v.empresa_id and p.ativo and not p.equipe and p.id is distinct from auth.uid()
       and public.pode_usuario(p.id, 'aprovar_roteiro_voz')
    on conflict (chave) where chave is not null do nothing;
    return 'enviado';
end $$;
revoke all on function public.enviar_fluxo_voz_aprovacao(bigint) from public, anon;
grant execute on function public.enviar_fluxo_voz_aprovacao(bigint) to authenticated;

-- ================================================================ 2. anexos do pedido em texto (Storage)
drop policy if exists entradas_fluxo_enviar on storage.objects;
create policy entradas_fluxo_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'entradas' and (storage.foldername(name))[2] = 'fluxo'
                and public.pode_ver_slug((storage.foldername(name))[1])
                and exists (select 1 from public.empresas e
                             where e.slug = (storage.foldername(name))[1] and public.pode_editar_fluxo_voz(e.id))
                and name !~ '\.\.' and name !~ '[0-9]{10,}' and char_length(name) <= 290);

-- ================================================================ 3. descartar o pedido em texto
alter table public.voz_fluxo_pedidos add column if not exists cancelado_em timestamptz;
alter table public.voz_fluxo_pedidos add column if not exists cancelado_por uuid references auth.users (id) on delete set null;

create or replace function public.cancelar_pedido_fluxo_voz(pedido bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
    p public.voz_fluxo_pedidos;
    v public.voz_fluxo_versoes;
    f public.voz_fluxos;
begin
    select * into p from public.voz_fluxo_pedidos x where x.id = pedido for update;
    if p.id is null or not public.pode_editar_fluxo_voz(p.empresa_id) then
        raise exception 'pedido não encontrado ou sem permissão para editar o fluxo';
    end if;
    if p.situacao = 'cancelado' then
        return 'cancelado';
    end if;
    if p.situacao = 'gerando' then
        raise exception 'o rascunho está sendo gerado agora: espere terminar e descarte depois';
    end if;
    if p.versao_gerada_id is not null then
        select * into v from public.voz_fluxo_versoes x where x.id = p.versao_gerada_id for update;
        if v.id is not null and v.situacao <> 'rascunho' then
            raise exception 'a versão gerada já foi aprovada (v%): para tirar de uso, volte para outra versão', v.versao;
        end if;
        if v.id is not null then
            select * into f from public.voz_fluxos x where x.id = v.fluxo_id;
            delete from public.voz_fluxo_versoes x where x.id = v.id;
            if f.modelo_origem in ('pedido_texto', 'pedido_equipe')
               and not exists (select 1 from public.voz_fluxo_versoes x where x.fluxo_id = f.id) then
                delete from public.voz_fluxos x where x.id = f.id;
            end if;
        end if;
    end if;
    if p.tipo = 'equipe' and p.chamado_id is not null then
        insert into public.chamado_mensagens (chamado_id, empresa_id, tipo, texto, anexos)
        values (p.chamado_id, p.empresa_id, 'cliente', 'Pedido de fluxo cancelado pela empresa. Não é preciso montar o rascunho.', '[]');
    end if;
    update public.voz_fluxo_pedidos x set situacao = 'cancelado', versao_gerada_id = null, cancelado_em = now(),
           cancelado_por = auth.uid(), atualizado_em = now()
     where x.id = p.id;
    return 'cancelado';
end $$;
revoke all on function public.cancelar_pedido_fluxo_voz(bigint) from public, anon;
grant execute on function public.cancelar_pedido_fluxo_voz(bigint) to authenticated;

-- ================================================================ 4. job noturno das métricas do fluxo
create or replace function public.agregar_fluxo_dia(empresa bigint, dia date) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    hoje date := (now() at time zone 'America/Sao_Paulo')::date;
    n_m int;
    n_i int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz agregam o dia do fluxo';
    end if;
    if empresa is null or dia is null or dia > hoje or dia < hoje - 35 then
        raise exception 'dia fora da janela do job (até 35 dias atrás)';
    end if;
    delete from public.voz_fluxo_metricas_dia x where x.empresa_id = empresa and x.dia = dia;
    delete from public.voz_fluxo_intencoes_dia x where x.empresa_id = empresa and x.dia = dia;

    with p as (
        select p.fluxo_versao_id, p.bloco_id, p.saida_quando, p.turnos, p.id_chamada, p.ordem,
               exists (select 1 from public.voz_fluxo_versoes v, jsonb_array_elements(v.definicao -> 'blocos') b
                        where v.id = p.fluxo_versao_id and b ->> 'id' = p.bloco_id
                          and b ->> 'tipo' in ('transferir', 'encerrar')) as final,
               (select c.bloco_final from public.voz_chamadas c
                 where (p.chamada_id is not null and c.id = p.chamada_id)
                    or (p.chamada_id is null and c.empresa_id = p.empresa_id and c.id_chamada = p.id_chamada)
                 limit 1) as bloco_final,
               p.ordem = max(p.ordem) over (partition by p.id_chamada) as ultimo
          from public.voz_fluxo_passos p
         where p.empresa_id = empresa and (p.entrou_em at time zone 'America/Sao_Paulo')::date = dia),
    q as (
        select fluxo_versao_id, bloco_id,
               coalesce(saida_quando, case when not final and ultimo and bloco_final = bloco_id then 'desligou' end) as quando,
               count(*) as n
          from p group by 1, 2, 3),
    b as (
        select fluxo_versao_id, bloco_id, count(*) as chegaram, round(avg(turnos), 2) as turnos_medio
          from p group by 1, 2)
    insert into public.voz_fluxo_metricas_dia (empresa_id, fluxo_versao_id, dia, bloco_id, chegaram, saidas, turnos_medio)
    select empresa, b.fluxo_versao_id, dia, b.bloco_id, b.chegaram,
           coalesce((select jsonb_object_agg(q.quando, q.n) from q
                      where q.fluxo_versao_id = b.fluxo_versao_id and q.bloco_id = b.bloco_id and q.quando is not null), '{}'),
           b.turnos_medio
      from b;
    get diagnostics n_m = row_count;

    insert into public.voz_fluxo_intencoes_dia (empresa_id, fluxo_versao_id, dia, bloco_id, intencao, n)
    select empresa, p.fluxo_versao_id, dia, p.bloco_id, p.intencao, count(*)
      from public.voz_fluxo_passos p
     where p.empresa_id = empresa and (p.entrou_em at time zone 'America/Sao_Paulo')::date = dia and p.intencao is not null
     group by p.fluxo_versao_id, p.bloco_id, p.intencao;
    get diagnostics n_i = row_count;
    return jsonb_build_object('blocos', n_m, 'intencoes', n_i);
end $$;

-- empresas com voz da parte i/n (a VM i de n agrega as suas)
create or replace function public.fluxo_empresas_voz(parte text default '1/1') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    i int;
    n int;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz listam as empresas';
    end if;
    if coalesce(parte, '1/1') !~ '^[1-9][0-9]?/[1-9][0-9]?$' then
        raise exception 'parte: i/n';
    end if;
    i := split_part(coalesce(parte, '1/1'), '/', 1)::int;
    n := split_part(coalesce(parte, '1/1'), '/', 2)::int;
    if i > n then
        raise exception 'parte: i/n com i <= n';
    end if;
    return coalesce((select jsonb_agg(c.empresa_id order by c.empresa_id) from public.voz_config c
                      where c.empresa_id % n = i - 1), '[]'::jsonb);
end $$;
revoke all on function public.agregar_fluxo_dia(bigint, date), public.fluxo_empresas_voz(text) from public, anon, authenticated;
grant execute on function public.agregar_fluxo_dia(bigint, date), public.fluxo_empresas_voz(text) to service_role;

-- acesso próprio da VM (voz_vm, SQL 57): mesmos argumentos (um objeto jsonb) e a mesma resposta
create or replace function voz_vm.agregar_fluxo_dia(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.agregar_fluxo_dia((args ->> 'empresa')::bigint, (args ->> 'dia')::date);
end $$;
create or replace function voz_vm.fluxo_empresas(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.fluxo_empresas_voz(coalesce(args ->> 'parte', '1/1'))
$$;
revoke all on function voz_vm.agregar_fluxo_dia(jsonb), voz_vm.fluxo_empresas(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.agregar_fluxo_dia(jsonb), voz_vm.fluxo_empresas(jsonb) to motorcx_voz;

-- ================================================================ 5. "Ouvir a voz": componente de uso de IA
alter table public.voz_analise_consumo drop constraint if exists voz_analise_consumo_componente_check;
alter table public.voz_analise_consumo add constraint voz_analise_consumo_componente_check
    check (componente in ('avaliador', 'extrator', 'alertas', 'embeddings', 'temas', 'golden', 'previa_voz'));
alter table public.custos_ia_voz drop constraint if exists custos_ia_voz_componente_check;
alter table public.custos_ia_voz add constraint custos_ia_voz_componente_check
    check (componente in ('avaliador', 'extrator', 'alertas', 'embeddings', 'temas', 'golden', 'previa_voz'));
comment on column public.voz_analise_consumo.tokens_entrada is
    'Tokens de entrada do modelo. Para previa_voz ("Ouvir a voz" do Fluxo do agente): caracteres sintetizados.';
