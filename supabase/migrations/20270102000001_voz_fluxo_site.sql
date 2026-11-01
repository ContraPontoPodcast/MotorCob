-- SQL 65 · Agente de voz: o que a tela "Fluxo do agente" do site precisa e o SQL 58 não tinha
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
-- Nada para anon. Escrita só por RPC security definer com search_path fixo. Pode rodar de novo sem erro.
-- Depende do SQL 58 (fluxos), do SQL 60 (pode_usuario) e do SQL 1/12 (avisos).
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from information_schema.columns where table_name = 'voz_fluxo_versoes'
--             and column_name in ('enviado_aprovacao_em', 'enviado_por')) as colunas,                         -- 2
--          has_function_privilege('authenticated', 'public.enviar_fluxo_voz_aprovacao(bigint)', 'execute') as site, -- true
--          has_function_privilege('anon', 'public.enviar_fluxo_voz_aprovacao(bigint)', 'execute') as anon,         -- false
--          (select count(*) from pg_policies where policyname = 'entradas_fluxo_enviar') as politica;              -- 1

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
