-- Enriquecimento mapeado por cliente: quando a esteira mandou o cliente para o bureau e quando
-- chegou o último retorno (telefones atualizados pelo bureau). A ação "enriquecimento" e a regra
-- de prioridade dos telefones (Score/Ranking) ficam em estrategias.definicao: não precisam de
-- tabela nova. Pode ser rodado de novo sem erro.
alter table public.estado_cliente
    add column if not exists enriq_enviado date,
    add column if not exists enriq_retorno date;
