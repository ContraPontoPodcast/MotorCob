-- Suporte: corrige o envio de mensagens e mostra quem está atendendo.
-- * chamado_mensagens.autor_nome: o nome de quem escreveu (o Console já mandava este campo e o banco recusava a
--   resposta). Preenchido pelo banco a partir do perfil, nunca pelo site.
-- * chamados.responsavel_nome: nome de quem assumiu o atendimento ("Ana S."), para o cliente ver "Em atendimento
--   com Ana S." sem ler o cadastro da equipe. Preenchido pelo banco quando o responsável muda.
-- * Quem abriu o chamado escreve como cliente nele, mesmo sendo da equipe (o Master testando o suporte).
-- * Mensagem só com anexo (sem texto) é aceita.
-- Pode ser rodado de novo sem erro.

alter table public.chamado_mensagens add column if not exists autor_nome text
    check (autor_nome is null or char_length(autor_nome) <= 80);
alter table public.chamados add column if not exists responsavel_nome text
    check (responsavel_nome is null or char_length(responsavel_nome) <= 80);

-- "Ana Souza" -> "Ana S."; sem sobrenome, só o nome
create or replace function public.nome_curto(uid uuid) returns text
language sql stable security definer set search_path = public as $$
    select nullif(trim(coalesce(split_part(trim(p.nome), ' ', 1), '') ||
           case when coalesce(trim(p.sobrenome), '') <> '' then ' ' || left(trim(p.sobrenome), 1) || '.'
                when position(' ' in trim(p.nome)) > 0
                     then ' ' || left(split_part(trim(p.nome), ' ', 2), 1) || '.'
                else '' end), '')
      from public.perfis p where p.id = uid
$$;
revoke all on function public.nome_curto(uuid) from public, anon, authenticated;

-- texto vazio é aceito quando há anexo
alter table public.chamado_mensagens drop constraint if exists chamado_mensagens_texto_check;
alter table public.chamado_mensagens alter column texto drop not null;
alter table public.chamado_mensagens drop constraint if exists chamado_mensagens_texto_ou_anexo;
alter table public.chamado_mensagens add constraint chamado_mensagens_texto_ou_anexo check (
    (texto is not null and length(trim(texto)) between 1 and 10000)
    or (texto is null and jsonb_array_length(anexos) > 0));

-- a mensagem herda a empresa do chamado e o nome do autor; resposta do cliente reabre o chamado
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
        update public.chamados set atualizado_em = now(),
               situacao = case when situacao in ('resolvido', 'aguardando_cliente') then 'em_atendimento' else situacao end
         where id = c.id;
    elsif new.tipo = 'equipe' then
        update public.chamados set atualizado_em = now() where id = c.id;
    end if;
    return new;
end $$;

-- nome de quem assumiu, sempre que o responsável muda
create or replace function public.responsavel_chamado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.responsavel is distinct from old.responsavel or (new.responsavel is not null and new.responsavel_nome is null) then
        new.responsavel_nome := case when new.responsavel is null then null else public.nome_curto(new.responsavel) end;
    elsif new.responsavel_nome is distinct from old.responsavel_nome then
        new.responsavel_nome := old.responsavel_nome;      -- o site não escreve o nome
    end if;
    return new;
end $$;
drop trigger if exists responsavel_chamado on public.chamados;
create trigger responsavel_chamado before update on public.chamados
    for each row execute function public.responsavel_chamado();
update public.chamados set responsavel_nome = public.nome_curto(responsavel)
 where responsavel is not null and responsavel_nome is null;

-- equipe escreve resposta e nota; cliente (ou quem abriu o chamado) escreve como cliente
drop policy if exists chamado_mensagens_escrever on public.chamado_mensagens;
create policy chamado_mensagens_escrever on public.chamado_mensagens for insert to authenticated
    with check (autor = auth.uid()
                and exists (select 1 from public.chamados c where c.id = chamado_id
                            and c.empresa_id in (select public.minhas_empresas()))
                and (case when public.sou_equipe()
                          then tipo in ('equipe', 'nota')
                               or (tipo = 'cliente' and exists (select 1 from public.chamados c
                                                                where c.id = chamado_id and c.aberto_por = auth.uid()))
                          else tipo = 'cliente' end));
