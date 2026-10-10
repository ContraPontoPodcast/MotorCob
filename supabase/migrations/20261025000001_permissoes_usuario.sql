-- Acessos por usuário: além do perfil (padrão MotorCob + ajuste da empresa), o Admin libera ou bloqueia uma
-- permissão para uma pessoa específica, já no convite ou depois, na página Usuários.
-- Ordem do que vale em pode(): exceção do usuário › ajuste do perfil na empresa › padrão MotorCob.
-- Travas: ninguém muda as próprias exceções; Admin nunca perde gerenciar usuários/permissões; só um Admin libera
-- permissão do grupo Administração para alguém.
-- Pode ser rodado de novo sem erro. Rode depois da 20261024 (permissões e auditoria).

create table if not exists public.permissoes_usuario (
    usuario_id      uuid not null references public.perfis (id) on delete cascade,
    permissao       text not null,
    permitido       boolean not null,
    empresa_id      bigint references public.empresas (id) on delete cascade,
    atualizado_em   timestamptz not null default now(),
    atualizado_por  uuid default auth.uid() references auth.users (id),
    primary key (usuario_id, permissao)
);
create index if not exists permissoes_usuario_empresa on public.permissoes_usuario (empresa_id);

create or replace function public.validar_permissao_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    alvo public.perfis;
    grupo text;
begin
    select * into alvo from public.perfis where id = new.usuario_id;
    select c.grupo into grupo from public.permissoes_catalogo c where c.codigo = new.permissao;
    if grupo is null then
        raise exception 'permissão desconhecida: %', new.permissao;
    end if;
    new.empresa_id := alvo.empresa_id;              -- a empresa vem sempre do usuário
    if alvo.papel = 'admin' and new.permissao in ('gerenciar_usuarios', 'gerenciar_permissoes') and not new.permitido then
        raise exception 'o Admin não pode perder %', new.permissao;
    end if;
    if auth.uid() is not null then                  -- pelo site (a função de usuários valida do lado dela)
        if new.usuario_id = auth.uid() then
            raise exception 'ninguém altera os próprios acessos';
        end if;
        if grupo = 'Administração' and new.permitido and not public.tem_papel('admin') then
            raise exception 'só um Admin libera acessos de administração';
        end if;
        if alvo.papel = 'admin' and not public.tem_papel('admin') then
            raise exception 'só um Admin altera os acessos de outro Admin';
        end if;
    end if;
    new.atualizado_em := now();
    new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
    return new;
end $$;
drop trigger if exists validar_permissao_usuario on public.permissoes_usuario;
create trigger validar_permissao_usuario before insert or update on public.permissoes_usuario
    for each row execute function public.validar_permissao_usuario();

create or replace function public.pode(perm text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((
        select case when p.equipe and p.papel = 'admin' then true
                    when p.papel = 'admin' and perm in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                    else coalesce((select pu.permitido from public.permissoes_usuario pu
                                   where pu.usuario_id = p.id and pu.permissao = perm),
                                  (select pp.permitido from public.permissoes_papel pp
                                   where pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = perm),
                                  public.permissao_padrao(p.papel, perm)) end
        from public.perfis p where p.id = auth.uid() and p.ativo), false)
$$;

-- permissões efetivas de qualquer usuário da empresa (tela Usuários › Acessos), para quem gerencia usuários
create or replace function public.permissoes_do_usuario(usuario uuid)
returns table (codigo text, permitido boolean, origem text)
language sql stable security definer set search_path = public as $$
    select c.codigo,
           case when p.equipe and p.papel = 'admin' then true
                when p.papel = 'admin' and c.codigo in ('gerenciar_usuarios', 'gerenciar_permissoes') then true
                else coalesce(pu.permitido, pp.permitido, public.permissao_padrao(p.papel, c.codigo)) end,
           case when pu.permitido is not null then 'usuario' when pp.permitido is not null then 'perfil'
                else 'padrao' end
    from public.perfis p
    cross join public.permissoes_catalogo c
    left join public.permissoes_usuario pu on pu.usuario_id = p.id and pu.permissao = c.codigo
    left join public.permissoes_papel pp on pp.empresa_id = p.empresa_id and pp.papel = p.papel and pp.permissao = c.codigo
    where p.id = usuario
      and (p.id = auth.uid() or public.admin_equipe()
           or (public.pode('gerenciar_usuarios') and p.empresa_id in (select public.minhas_empresas())))
$$;
revoke all on function public.permissoes_do_usuario(uuid) from anon;
grant execute on function public.permissoes_do_usuario(uuid) to authenticated;

alter table public.permissoes_usuario enable row level security;
drop policy if exists permissoes_usuario_ver on public.permissoes_usuario;
create policy permissoes_usuario_ver on public.permissoes_usuario for select to authenticated
    using (usuario_id = auth.uid() or public.admin_equipe()
           or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas())));
drop policy if exists permissoes_usuario_criar on public.permissoes_usuario;
create policy permissoes_usuario_criar on public.permissoes_usuario for insert to authenticated
    with check (public.admin_equipe()
                or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas())));
drop policy if exists permissoes_usuario_editar on public.permissoes_usuario;
create policy permissoes_usuario_editar on public.permissoes_usuario for update to authenticated
    using (public.admin_equipe()
           or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas())))
    with check (public.admin_equipe()
                or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas())));
drop policy if exists permissoes_usuario_apagar on public.permissoes_usuario;
create policy permissoes_usuario_apagar on public.permissoes_usuario for delete to authenticated
    using (usuario_id <> auth.uid()
           and (public.admin_equipe()
                or (public.pode('gerenciar_usuarios') and empresa_id in (select public.minhas_empresas()))));
revoke all on public.permissoes_usuario from anon;
revoke truncate, references, trigger on public.permissoes_usuario from authenticated;

drop trigger if exists z_auditar on public.permissoes_usuario;
create trigger z_auditar after insert or update or delete on public.permissoes_usuario
    for each row execute function public.auditar();
