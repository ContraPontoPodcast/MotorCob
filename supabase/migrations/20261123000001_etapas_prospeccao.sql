-- SQL 26 · Etapas da empresa na estratégia (MotorCob e MotorCli) e prospecção (leads) no MotorCli.
-- As etapas ficam na própria definição da estratégia (estrategias.definicao: "etapas" e "ordem_etapas"),
-- com as mesmas regras de acesso de hoje, assim como o orçamento por canal e as travas configuráveis. Este SQL
-- só abre o tipo de arquivo de leads e o nome das etapas no enquadramento da jornada. Pode rodar mais de uma vez.

-- 1. Arquivo de leads (prospecção do MotorCli) em Enviar arquivos
alter table public.envios drop constraint if exists envios_tipo_check;
alter table public.envios add constraint envios_tipo_check
    check (tipo in ('base', 'incremental', 'retirada', 'acordo', 'baixa', 'ocorrencia', 'enriquecimento',
                    'clientes', 'contatos', 'parcelas', 'retorno', 'portal',
                    'canal_sms', 'canal_rcs', 'canal_whatsapp', 'canal_email', 'canal_voz', 'leads'));
comment on constraint envios_tipo_check on public.envios is
    'leads: quem ainda não é cliente (prospecção do MotorCli). O motor só aceita lead com base legal '
    '(consentimento ou legítimo interesse) e origem registradas.';

-- 2. Enquadramento da jornada: momento do motor ou etapa da empresa ("etapa-<id>")
alter table public.jornada_cliente drop constraint if exists jornada_cliente_momento_check;
alter table public.jornada_cliente add constraint jornada_cliente_momento_check
    check (momento in ('', 'boas_vindas', 'ativacao', 'pre_vencimento', 'retencao', 'reativacao')
           or momento ~ '^etapa-[a-z0-9][a-z0-9_-]{0,39}$');

comment on column public.estrategias.definicao is
    'Régua da estratégia (motor/estrategia.py; MotorCli: motor/jornada.py). "etapas": etapas da empresa '
    '(id, nome, ativo, condicoes, referencia {tipo, coluna?}, de, ate, ciclo {dias, vezes}?, passos, saidas, '
    'orcamento {canal: {modo, clientes, telefones, prioridade, fora}}?, travas {intervalo_horas, acoes_dia, de, '
    'ate}?) e "ordem_etapas": prioridade entre as etapas da empresa e as fases do motor (motor/etapas.py). '
    '"travas": travas configuráveis da estratégia (motor/travas.py), dentro das faixas de segurança.';
