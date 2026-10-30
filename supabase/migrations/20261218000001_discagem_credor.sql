-- SQL 51 · Regras de discagem da carteira (Estratégia › Discagem)
-- O motor já aplica as regras de discagem do credor (motor/discagem.py; rodar_dia(discagem=...)), mas não havia
-- onde o site gravá-las. Agora: credores.discagem (jsonb), com o mesmo formato de regras/regua.json › discagem:
--   tentativas_numero_dia, tentativas_cliente_dia, intervalo_min_minutos, intervalo_ocupado_minutos,
--   descanso_nao_atende, descanso_recusa, promessa_suspende, inexistente, nao_ligar,
--   horarios {ativo, tabela por UF/DDD}, chamadas_curtas {ativo, aviso, corte_ativo, corte, ...}
-- Só as chaves que o cliente mudou; o resto vale a sugestão do MotorCX (horários desligados; chamadas curtas só
-- monitoradas, corte desligado).
-- Parte inválida não segura a lista: vira alerta "DISCAGEM" e vale a sugestão.
-- O resumo do dia (renitência, fora do horário por UF, chamadas curtas) vai em execucoes.resumo.discagem, só com
-- contagens: nenhum telefone nem CPF. RLS de credores não muda (grava quem tem editar_credores).
-- Pode rodar de novo sem erro.

alter table public.credores add column if not exists discagem jsonb
    check (discagem is null or jsonb_typeof(discagem) = 'object');
comment on column public.credores.discagem is
    'Regras de discagem da carteira (Estratégia › Discagem), no formato de regras/regua.json › discagem: '
    'tentativas e intervalos, descansos (não atende, recusa, promessa), inexistente, nao_ligar, horarios {ativo, '
    'tabela por UF/DDD} e chamadas_curtas (aviso e corte opcional). Chave ausente ou vazio = sugestão do MotorCX.';
