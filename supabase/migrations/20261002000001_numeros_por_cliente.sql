-- Quantos contatos de cada cliente vão na lista do dia, por canal e por empresa.
--   nulo/1 = um contato (padrão: o CPC da ocorrência marca exatamente esse contato como Hot)
--   2, 3…  = até N contatos      99 = todos
-- Com mais de um contato, o CPC vale para o cliente (CPC A e canal marcado) e os contatos
-- enviados viram candidatos a Hot: as ações seguintes vão a um candidato por vez até um
-- deles dar CPC sozinho.
alter table public.canais_empresa
    add column numeros_por_cliente int check (numeros_por_cliente between 1 and 99);
comment on column public.canais_empresa.numeros_por_cliente is
    'Contatos por cliente na lista do dia: nulo/1 = um (padrão), 99 = todos.';
