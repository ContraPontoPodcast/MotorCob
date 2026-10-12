-- Equipe MotorCob: Master e Atendimento.
-- * Master = perfil Admin da equipe (equipe = true, papel admin, sem empresa): cadastra empresas, libera módulos,
--   convida o Admin de cada cliente e tem o Console inteiro (faturamento, fornecedores, equipe).
-- * Atendimento = equipe com papel operacao: vê todas as empresas e responde chamados; não muda cadastro, módulo,
--   fatura nem fornecedor (o banco já recusa, porque essas regras pedem admin_equipe()).
-- * definir_funcao_equipe: só um Master, com a sessão confirmada pelo código de duas etapas (aal2), nunca no
--   próprio usuário, e sempre sobra pelo menos um Master ativo.
-- * listar_equipe: quem é da equipe, com a função, o último login e se tem duas etapas ligadas.
-- Pode ser rodado de novo sem erro.

-- a sessão do pedido passou pelo código de duas etapas? (o Supabase põe o token inteiro em request.jwt.claims)
create or replace function public.sessao_aal2() returns boolean
language sql stable set search_path = public as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2'
$$;

create or replace function public.listar_equipe()
returns table (id uuid, nome text, email text, funcao text, ativo boolean, ultimo_login timestamptz,
               duas_etapas boolean)
language sql stable security definer set search_path = public as $$
    select p.id, p.nome, u.email::text,
           case when p.papel = 'admin' then 'master' else 'atendimento' end,
           p.ativo, u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified')
      from public.perfis p
      join auth.users u on u.id = p.id
     where p.equipe and public.sou_equipe()
     order by (p.papel = 'admin') desc, p.nome
$$;
revoke execute on function public.listar_equipe() from public, anon;
grant execute on function public.listar_equipe() to authenticated;

create or replace function public.definir_funcao_equipe(usuario uuid, funcao text) returns text
language plpgsql security definer set search_path = public as $$
declare
    alvo public.perfis;
begin
    if not public.admin_equipe() then
        raise exception 'só um Master da equipe MotorCob define funções';
    end if;
    if not public.sessao_aal2() then
        raise exception 'entre com o seu código de duas etapas para mudar a equipe';
    end if;
    if funcao not in ('master', 'atendimento') then
        raise exception 'função inválida: use master ou atendimento';
    end if;
    if usuario = auth.uid() then
        raise exception 'ninguém muda a própria função';
    end if;
    select * into alvo from public.perfis where id = usuario;
    if alvo.id is null then
        raise exception 'usuário não encontrado';
    end if;
    if funcao = 'atendimento' and alvo.equipe and alvo.papel = 'admin'
       and (select count(*) from public.perfis where equipe and papel = 'admin' and ativo and id <> usuario) = 0 then
        raise exception 'a equipe precisa de pelo menos um Master ativo';
    end if;
    update public.perfis
       set equipe = true, empresa_id = null, ativo = true,
           papel = case when funcao = 'master' then 'admin' else 'operacao' end::public.papel
     where id = usuario;
    return funcao;
end $$;
revoke execute on function public.definir_funcao_equipe(uuid, text) from public, anon;
grant execute on function public.definir_funcao_equipe(uuid, text) to authenticated;

-- ninguém desativa o último Master ativo (nem pela tela Usuários)
create or replace function public.manter_um_master() returns trigger
language plpgsql set search_path = public as $$
begin
    if old.equipe and old.papel = 'admin' and old.ativo
       and not (new.equipe and new.papel = 'admin' and new.ativo)
       and (select count(*) from public.perfis where equipe and papel = 'admin' and ativo and id <> old.id) = 0 then
        raise exception 'a equipe precisa de pelo menos um Master ativo';
    end if;
    return new;
end $$;
drop trigger if exists manter_um_master on public.perfis;
create trigger manter_um_master before update on public.perfis
    for each row execute function public.manter_um_master();
