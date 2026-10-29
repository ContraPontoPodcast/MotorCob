-- SQL 49 · Abordagem da persona: bloco Contato
-- A rotina calcula a nota de cada contato do cliente (É dele × Chega × Responde) e ordena os números dentro
-- de cada canal por ela; o contato e a nota ficam só no estado local do motor (estado/contatos_nota.csv).
-- Para o banco vai só o resumo por persona (ver motor/persona.py, bloco_contato):
--   personas: + contato (jsonb: acionados, localizados, taxa_localizacao, primeiros_cpc,
--             acoes_ate_primeiro_cpc, acoes_por_primeiro_cpc, evidencia coletando|previa|definida)
-- Nenhum dado pessoal: só contagens e taxas. RLS de personas não muda (a empresa lê a sua; só a rotina grava).
-- Pode rodar de novo sem erro.

alter table public.personas add column if not exists contato jsonb;
comment on column public.personas.contato is
    'Bloco Contato da persona (só números): acionados, localizados (Hot ou contato certificado), '
    'taxa_localizacao, primeiros_cpc, acoes_ate_primeiro_cpc, acoes_por_primeiro_cpc e evidencia '
    '(coletando < 30 acionados · previa · definida ≥ 200).';
