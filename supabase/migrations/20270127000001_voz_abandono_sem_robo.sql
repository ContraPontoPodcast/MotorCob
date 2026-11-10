-- SQL 91 · Agente de voz: contar conversas, não linhas, e nunca derrubar mudo quem atende (pré-requisito da licença
-- de robôs; decisões do dono). A VM passa a reservar o robô (sessão de IA) ANTES de discar; se mesmo assim a pessoa
-- atende e o provedor não abre a sessão (corrida com a capacidade da VM ou falha), ela ouve uma mensagem curta e
-- neutra e a chamada termina com o desfecho próprio abandono_sem_robo, que conta no abandono.
--
-- 1. desfechos_voz(): + 'abandono_sem_robo' (motor/voz.py › DESFECHOS, sem os internos, na mesma ordem;
--    tests/test_voz_banco.py confere). Só acrescenta: nenhuma linha gravada deixa de valer.
-- 2. voz_chamadas.transferencia: + 'sem_robo' (atendeu e não havia robô livre; motor/voz.py › TRANSFERENCIAS). O check
--    é refeito pelo nome (voz_chamadas_transferencia_check), NOT VALID + VALIDATE: só acrescenta um valor.
-- 3. regras_curtas_voz(): o abandono que conta como chamada curta passa a ser abandonada + abandono_sem_robo (cópia de
--    motor/voz.py › CURTA_SE_ABANDONO; tests/test_resubmit.py confere). O resto do JSON é o do SQL 80, sem mudança.
-- 4. situacao_voz(): abandono_sem_robo é a situação "abandonada" da Renitência/Resubmit (= motor/discagem.situacao_de),
--    então a regra por sinalização da carteira e os avisos de falha técnica valem para ele sem configuração nova.
-- Independente dos SQL 89 e 90. Rode ANTES de atualizar o motor e as VMs de voz (a VM nova grava os valores novos).
-- Pode rodar de novo.

-- ================================================================ 1. desfechos de voz
create or replace function public.desfechos_voz() returns text[]
language sql immutable parallel safe as $$
    select array['numero_inexistente', 'nao_atendida', 'caixa_postal', 'atendida_sem_cpc',
                 'atendida_terceiro_desconhece', 'cpc', 'promessa', 'recusa', 'recado', 'ocupado', 'abandonada',
                 'falha_rede', 'opt_out', 'identidade_confirmada', 'maquina', 'desligou_sem_conversar',
                 'atendeu_desligou', 'retorno_agendado', 'falha_operadora', 'bloqueio_originacao',
                 'cancelada_discador', 'indisponivel', 'rejeitada', 'mudo', 'fax', 'abandono_sem_robo']::text[]
$$;

-- ================================================================ 2. transferência: sem robô livre
alter table public.voz_chamadas drop constraint if exists voz_chamadas_transferencia_check;
alter table public.voz_chamadas add constraint voz_chamadas_transferencia_check
    check (transferencia in ('atendida', 'sem_operador', 'falhou', 'sem_robo')) not valid;
alter table public.voz_chamadas validate constraint voz_chamadas_transferencia_check;
comment on column public.voz_chamadas.transferencia is
    'Transferência IA -> humano: atendida | sem_operador | falhou. sem_robo = a pessoa atendeu e não havia robô '
    '(sessão de IA) livre: ouviu a mensagem curta e a chamada acabou (resultado abandono_sem_robo; SQL 91).';
comment on column public.voz_chamadas.resultado is
    'Desfecho final (motor/voz.classificar_chamada). Abandono = abandonada (transferência sem operador) ou '
    'abandono_sem_robo (atendeu sem robô livre).';

-- ================================================================ 3. chamadas curtas (gerado de motor/voz.py e motor/discagem.py)
create or replace function public.regras_curtas_voz() returns jsonb
language sql immutable parallel safe as $$
    select '{"sempre":["numero_inexistente","nao_atendida","caixa_postal","ocupado","falha_rede","inexistente_voz","maquina","falha_operadora","bloqueio_originacao","cancelada_discador","indisponivel","rejeitada"],"abandono":["abandonada","abandono_sem_robo"],"tecnicos":["falha_rede","falha_operadora","bloqueio_originacao","cancelada_discador","indisponivel"],"segundos":6,"aviso":0.7,"prior":0.9,"forca_carteira":20.0,"forca_numero":5.0}'::jsonb
$$;

-- ================================================================ 4. desfecho -> situação (= motor/discagem.situacao_de)
create or replace function public.situacao_voz(resultado text, causa_sip int default null) returns text
language sql immutable parallel safe as $$
    select case
        when resultado in ('numero_inexistente', 'inexistente_voz', 'atendida_terceiro_desconhece') then 'numero_incorreto'
        when resultado = 'falha_operadora' and causa_sip = 402 then 'sem_credito'
        when resultado = 'abandono_sem_robo' then 'abandonada'
        when resultado = any (public.situacoes_resubmit_voz()) then resultado
    end
$$;

revoke all on function public.desfechos_voz(), public.regras_curtas_voz(), public.situacao_voz(text, int)
    from public, anon;
grant execute on function public.desfechos_voz(), public.regras_curtas_voz(), public.situacao_voz(text, int)
    to authenticated, service_role;
