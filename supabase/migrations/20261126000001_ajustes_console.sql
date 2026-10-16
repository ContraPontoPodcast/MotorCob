-- SQL 29 · Ajustes do Console e da empresa (homologação)
-- 1. Suspender, encerrar e reativar empresa (com motivo e registro de quem fez); suspensa ou encerrada não roda.
-- 2. Excluir empresa de TESTE (só Master, só sem histórico: nenhuma fatura emitida, cobrança, envio ou Lista do dia).
-- 3. Atendimento: quem falou por último e o que ainda não foi visto (contador no menu do Console e do Workspace).
-- 4. Faturas: qualquer contato da empresa pode receber a fatura por e-mail ("Recebe faturas").
-- Pode rodar mais de uma vez.

-- ---------------------------------------------------------------- 1. situação da empresa
alter table public.empresas
    add column if not exists situacao_motivo text check (situacao_motivo is null or length(situacao_motivo) <= 200),
    add column if not exists situacao_em     timestamptz,
    add column if not exists situacao_por    uuid references auth.users (id) on delete set null;

-- o cadastro da empresa ignora as colunas que só a mudança de situação grava
create or replace function public.carteira_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' then
        if public.sou_equipe() and not public.admin_equipe() then
            new.vendedor_id := auth.uid();         -- quem cria fica com a conta
        end if;
        return new;
    end if;
    if auth.uid() is null or public.admin_equipe() then
        return new;
    end if;
    if (new.vendedor_id is distinct from old.vendedor_id or new.gerente_id is distinct from old.gerente_id)
       and not public.pode_equipe('gerenciar_equipe') then
        raise exception 'só quem gerencia a equipe troca o responsável da conta';
    end if;
    if (new.situacao is distinct from old.situacao or new.ativa is distinct from old.ativa)
       and not public.pode_equipe('pausar_empresa') then
        raise exception 'sem permissão para pausar ou reativar a empresa';
    end if;
    if (to_jsonb(new) - 'situacao' - 'ativa' - 'situacao_motivo' - 'situacao_em' - 'situacao_por'
                      - 'vendedor_id' - 'gerente_id' - 'colunas_base')
       is distinct from (to_jsonb(old) - 'situacao' - 'ativa' - 'situacao_motivo' - 'situacao_em' - 'situacao_por'
                         - 'vendedor_id' - 'gerente_id' - 'colunas_base')
       and not public.pode_equipe('editar_contratacao') then
        raise exception 'sem permissão para editar o cadastro da empresa';
    end if;
    return new;
end $$;

-- nova: 'ativa' (reativar), 'suspensa' ou 'encerrada'. Suspensa e encerrada param a rotina (ativa = false).
create or replace function public.mudar_situacao_empresa(empresa bigint, nova text, motivo text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
    atual text;
    m text := nullif(trim(coalesce(motivo, '')), '');
begin
    if not (public.admin_equipe() or public.equipe_pode('pausar_empresa', empresa)) then
        raise exception 'sem permissão para suspender, encerrar ou reativar esta empresa';
    end if;
    if nova not in ('ativa', 'suspensa', 'encerrada') then
        raise exception 'situação inválida: use ativa, suspensa ou encerrada';
    end if;
    select situacao into atual from public.empresas where id = empresa;
    if atual is null then
        raise exception 'empresa não encontrada';
    end if;
    if nova in ('suspensa', 'encerrada') and (m is null or length(m) < 3) then
        raise exception 'informe o motivo';
    end if;
    update public.empresas
       set situacao = nova, ativa = (nova = 'ativa'), situacao_motivo = m, situacao_em = now(),
           situacao_por = auth.uid()
     where id = empresa;
    return nova;
end $$;
revoke all on function public.mudar_situacao_empresa(bigint, text, text) from public, anon;
grant execute on function public.mudar_situacao_empresa(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------- 2. excluir empresa de teste
-- Na exclusão, as linhas filhas (módulos, contatos…) não viram auditoria uma a uma: a exclusão fica numa
-- linha só, gravada pela própria função. A auditoria ganha esse desvio sem mudar o resto do corpo.
do $$
declare d text := pg_get_functiondef('public.auditar()'::regprocedure);
begin
    if position('motorcob.excluindo_empresa' in d) = 0 then
        d := replace(d, $velho$begin
    if auth.uid() is null then$velho$, $novo$begin
    if tg_op = 'DELETE' and coalesce(current_setting('motorcob.excluindo_empresa', true), '') <> '' then
        return old;
    end if;
    if auth.uid() is null then$novo$);
        if position('motorcob.excluindo_empresa' in d) = 0 then
            raise exception 'não achei o início da função auditar() para ajustar';
        end if;
        execute d;
    end if;
end $$;

-- Só o Master, com o código de duas etapas, digitando o slug da empresa. Recusa empresa com histórico.
create or replace function public.excluir_empresa_teste(empresa bigint, confirmacao text)
returns text
language plpgsql security definer set search_path = public as $$
declare
    e public.empresas;
    motivo text;
begin
    if not public.admin_equipe() then
        raise exception 'só o Master exclui empresa';
    end if;
    if not public.sessao_aal2() then
        raise exception 'entre com o seu código de duas etapas para excluir';
    end if;
    select * into e from public.empresas where id = empresa;
    if e.id is null then
        raise exception 'empresa não encontrada';
    end if;
    if confirmacao is distinct from e.slug then
        raise exception 'para confirmar, digite o identificador da empresa: %', e.slug;
    end if;
    motivo := case
        when to_regclass('public.faturas') is not null
             and exists (select 1 from public.faturas where empresa_id = empresa and situacao <> 'rascunho')
            then 'tem fatura emitida'
        when to_regclass('public.cobrancas') is not null
             and exists (select 1 from public.cobrancas where empresa_id = empresa)
            then 'tem cobrança'
        when exists (select 1 from public.envios where empresa_id = empresa)
            then 'tem arquivos enviados'
        when exists (select 1 from public.fila_dia where empresa_id = empresa)
            then 'já teve Lista do dia'
        when to_regclass('public.mensageria_lotes') is not null
             and exists (select 1 from public.mensageria_lotes where empresa_id = empresa)
            then 'tem lotes da Mensageria'
        end;
    if motivo is not null then
        raise exception 'esta empresa não é só de teste (%): use Encerrar', motivo;
    end if;
    perform set_config('motorcob.excluindo_empresa', empresa::text, true);
    delete from public.empresas where id = empresa;
    perform set_config('motorcob.excluindo_empresa', '', true);
    insert into public.auditoria (empresa_id, usuario, tabela, acao, registro, mudou)
    values (null, auth.uid(), 'empresas', 'DELETE', e.slug, jsonb_build_object('nome', e.nome, 'teste', true));
    return e.slug;
end $$;
revoke all on function public.excluir_empresa_teste(bigint, text) from public, anon;
grant execute on function public.excluir_empresa_teste(bigint, text) to authenticated;

-- ---------------------------------------------------------------- 3. atendimento: quem falou por último
alter table public.chamados
    add column if not exists ultima_de        text check (ultima_de is null or ultima_de in ('cliente', 'equipe')),
    add column if not exists ultima_em        timestamptz,
    add column if not exists visto_equipe_em  timestamptz,
    add column if not exists visto_cliente_em timestamptz;

-- preenche os chamados que já existem pela última mensagem (nota interna não conta)
update public.chamados c
   set ultima_de = m.tipo, ultima_em = m.criado_em
  from (select distinct on (chamado_id) chamado_id, tipo, criado_em
          from public.chamado_mensagens where tipo in ('cliente', 'equipe')
         order by chamado_id, criado_em desc) m
 where m.chamado_id = c.id and c.ultima_em is null;
update public.chamados set ultima_de = 'cliente', ultima_em = criado_em where ultima_em is null;

create or replace function public.mensagem_chamado() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.chamados;
begin
    select * into c from public.chamados where id = new.chamado_id;
    if c.id is null then raise exception 'chamado não encontrado'; end if;
    new.empresa_id := c.empresa_id;
    new.texto := nullif(trim(new.texto), '');
    new.autor_nome := public.nome_curto(coalesce(new.autor, auth.uid()));
    if new.tipo = 'cliente' then
        update public.chamados set atualizado_em = now(), ultima_de = 'cliente', ultima_em = now(),
               visto_cliente_em = now(),
               situacao = case when situacao in ('resolvido', 'aguardando_cliente') then 'em_atendimento' else situacao end
         where id = c.id;
    elsif new.tipo = 'equipe' then
        update public.chamados set atualizado_em = now(), ultima_de = 'equipe', ultima_em = now(),
               visto_equipe_em = now()
         where id = c.id;
    end if;
    return new;
end $$;

-- chamado novo: a última palavra é de quem abriu
create or replace function public.chamado_novo_ultima() returns trigger
language plpgsql set search_path = public as $$
begin
    new.ultima_de := coalesce(new.ultima_de, 'cliente');
    new.ultima_em := coalesce(new.ultima_em, now());
    new.visto_cliente_em := coalesce(new.visto_cliente_em, now());
    return new;
end $$;
drop trigger if exists chamado_novo_ultima on public.chamados;
create trigger chamado_novo_ultima before insert on public.chamados
    for each row execute function public.chamado_novo_ultima();

-- quem abre o chamado marca como visto (equipe ou cliente, conforme quem está logado)
create or replace function public.marcar_chamado_visto(cid bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.chamados where id = cid and empresa_id in (select public.minhas_empresas())) then
        raise exception 'chamado não encontrado';
    end if;
    if public.sou_equipe() then
        update public.chamados set visto_equipe_em = now() where id = cid;
    else
        update public.chamados set visto_cliente_em = now() where id = cid;
    end if;
end $$;
revoke all on function public.marcar_chamado_visto(bigint) from public, anon;
grant execute on function public.marcar_chamado_visto(bigint) to authenticated;

-- contadores do menu. Equipe: aguardando a equipe (aberto ou o cliente falou por último) e quantos têm
-- resposta do cliente ainda não vista. Cliente: respostas da equipe ainda não vistas.
create or replace function public.atendimento_pendentes()
returns table (aguardando_equipe int, respostas_novas int)
language sql stable security definer set search_path = public as $$
    select case when public.sou_equipe() then
                (select count(*)::int from public.chamados c
                  where c.empresa_id in (select public.minhas_empresas()) and c.situacao <> 'resolvido'
                    and (c.situacao = 'aberto' or c.ultima_de = 'cliente'))
           else 0 end,
           case when public.sou_equipe() then
                (select count(*)::int from public.chamados c
                  where c.empresa_id in (select public.minhas_empresas()) and c.situacao <> 'resolvido'
                    and c.ultima_de = 'cliente' and (c.visto_equipe_em is null or c.visto_equipe_em < c.ultima_em))
           else
                (select count(*)::int from public.chamados c
                  where c.empresa_id in (select public.minhas_empresas()) and c.ultima_de = 'equipe'
                    and (c.visto_cliente_em is null or c.visto_cliente_em < c.ultima_em))
           end
$$;
revoke all on function public.atendimento_pendentes() from public, anon;
grant execute on function public.atendimento_pendentes() to authenticated;

-- ---------------------------------------------------------------- 4. quem recebe a fatura
alter table public.empresa_contatos add column if not exists recebe_faturas boolean not null default false;
update public.empresa_contatos set recebe_faturas = true
 where papel_contrato = 'financeiro' and not recebe_faturas and email is not null;
comment on column public.empresa_contatos.recebe_faturas is
    'Recebe o e-mail da fatura (demonstrativo, boleto, nota). Sem nenhum marcado, vale o papel Financeiro.';
