-- Fornecedor de e-mail: Locaweb (SMTP Locaweb). Pode ser rodado de novo sem erro.
-- A credencial fica no cofre de segredos do servidor; aqui só o fornecedor e o canal.
insert into public.mensageria_fornecedores (codigo, nome, canais) values ('locaweb', 'Locaweb', '{email}')
on conflict (codigo) do update set canais = (
    select array_agg(distinct c order by c) from unnest(public.mensageria_fornecedores.canais || '{email}'::text[]) c);

-- rota padrão de e-mail (todas as empresas): Locaweb como principal, se ainda não houver
insert into public.mensageria_rotas (empresa_id, canal, prioridade, fornecedor)
select null, 'email', 1, 'locaweb'
 where not exists (select 1 from public.mensageria_rotas where empresa_id is null and canal = 'email' and prioridade = 1);
