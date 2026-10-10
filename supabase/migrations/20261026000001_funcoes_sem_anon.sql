-- Endurecimento: funções do banco só para quem está logado. Por padrão o Postgres deixa qualquer um
-- (PUBLIC, inclusive o visitante anônimo) executar funções; as nossas já devolvem vazio/falso sem login,
-- mas no pentest o certo é nem chamar. O site e a rotina continuam iguais (authenticated e service_role).
-- Pode ser rodado de novo sem erro.

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
