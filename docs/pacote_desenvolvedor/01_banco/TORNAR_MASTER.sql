-- Uma vez só: transforma o seu usuário no primeiro Master da equipe MotorCob (troque o e-mail).
-- Depois disso, novos Masters e Atendimentos são convidados pelo Console › Equipe.
update public.perfis
   set equipe = true, papel = 'admin', empresa_id = null, ativo = true
 where id = (select id from auth.users where email = lower('SEU_EMAIL'));
-- confira: deve aparecer o seu e-mail com papel admin e equipe true
select u.email, p.papel, p.equipe, p.ativo
  from public.perfis p join auth.users u on u.id = p.id
 where p.equipe;
