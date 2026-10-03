-- "Demais clientes" (quem não cai em nenhum segmento em uso na carteira) ligado ou desligado por
-- carteira. Desligado: esses clientes ficam sem ação massiva e sem bureau (acordo segue); o
-- enquadramento mostra a esteira "Demais clientes (desligado)". Mudar dispara a vigia (o carimbo
-- atualizado_em de credores já existe). Pode ser rodado de novo sem erro.

alter table public.credores add column if not exists demais_ativo boolean not null default true;
comment on column public.credores.demais_ativo is
    'Demais clientes (sem segmento em uso) recebem a esteira padrão da carteira? false = ficam sem ação.';
