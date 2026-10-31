-- SQL 56 · Agente de voz (base do banco): configuração, roteiro, troncos, rotas, chamadas, gravações e faturamento
-- Protótipo aprovado pelo dono (ux/agente-voz-prototipo.html, necessidades V1 a V25) e Decisões do dono de 31/10
-- (plano agente_voz_elevenlabs.md, seção 0, que vale sobre o resto do plano). Resumo das decisões que o banco segue:
-- * Quem disca é sempre o agente de IA, pelo Asterisk do MotorCX (VMs em São Paulo). O provedor de voz é escolhido
--   por empresa: Montagem MotorCX, ElevenLabs ou Simulador. Ligar de verdade passa por Simulado → Só números de
--   teste → Real (ligar_voz_real, só a equipe com a permissão nova ligar_voz_real).
-- * Telefonia é do cliente: vários troncos por empresa (IP ou host, porta, transporte, autenticação por IP ou por
--   senha, canais, CPS, DDD de origem, bina e formato de discagem). Senha nunca no banco: só o NOME do segredo no
--   cofre (segredo_ref). A bina é o número da PRÓPRIA empresa (não do devedor) e fica inteira: o Asterisk precisa
--   dela para originar. Gravações: um bucket por empresa (voz_config.bucket_gravacoes), porque a retenção varia.
-- * Rotas no padrão de mercado: tipo do número → tronco + tech prefix + prioridade (failover), com cadência e preço
--   do minuto com vigência (sem carência). Servem só para conferir o custo de telefonia (pago à operadora): nunca
--   entram na fatura do MotorCX. segundos_tarifados() e rota_voz_vigente() calculam e o valor fica congelado na
--   chamada. Rota sem cadastro = sem custo + alerta (fornecedor_saude, item rota_sem_cadastro), nunca preço inventado.
-- * Transferência para humano por SIP para o discador do cliente (voz_transferencias, só a equipe cadastra).
-- * Concorrência contratada dividida entre as empresas pelos canais dos troncos ativos, com a sobra para as maiores
--   frações (maior resto); pico opcional até 3×, nunca acima dos canais (view voz_divisao_concorrencia).
-- * Alô fake: a equipe libera (alo_fake_liberado), a empresa liga, desliga e define o tempo máximo.
-- * Roteiro por empresa e carteira: Rascunho → Aprovado pela empresa → Em uso (sem jurídico); tipo de agente
--   localizador, negociador ou os dois; regras de transferência com esquema fechado.
-- * Chamadas: um registro por canal por tentativa, com o de-para que já está no motor (motor/voz.py e
--   motor/certificacao.py): causa_sip, causa_q850, dialstatus, amd, resultado_ia, resultado_operador, resultado,
--   transferencia, id_chamada, billsec. Número discado só mascarado ou em hash. Códigos fechados por cliente
--   (codigos jsonb) apagados junto com a gravação.
-- * Abandono medido por lote e freio de ritmo; retenção padrão 90 dias (mínimo, sem teto); transcrição a partir de
--   5 s (editável pelo cliente).
-- * Fatura do MotorCX: plataforma, minuto de IA, minuto de pico, transcrição e gestão de tronco (cobranca_itens,
--   preços em precos_empresa, quantidades em consumo_mensageria). Telefonia fica em consumo_voz, fora da fatura.
-- * Permissões novas do cliente: ouvir_gravacoes, ver_transcricoes, aprovar_roteiro_voz. Da equipe:
--   gerenciar_troncos_voz e ligar_voz_real.
-- LGPD: nenhuma coluna guarda CPF, nome, telefone de devedor em claro ou senha. Telefone de devedor só em hash
-- (sha-256 em hex) ou máscara com no máximo 4 dígitos; senha só como referência ao cofre. Única exceção, por ser
-- dado da empresa e não pessoal: voz_troncos.bina (número que a empresa exibe).
-- Quem grava o dia a dia (chamadas, ondas, consumo, saúde) é a VM, com a chave do servidor (service_role). O site
-- só escreve por RPC security definer com search_path fixo. RLS em tudo e nada para anon.
-- Depende dos SQL 12 (faturamento), 18/19 (preços e rotas), 21 (equipe), 33 (produtos), 35 (primeiro uso).
-- Pode rodar de novo sem erro.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'voz\_%') as tabelas_voz,      -- 15
--          (select count(*) from pg_tables where schemaname = 'public' and tablename like 'voz\_%' and not rowsecurity) as sem_rls, -- 0
--          public.segundos_tarifados(31, 30, 6) as tarifa_31s_30_6,                                                  -- 36
--          (select count(*) from public.cobranca_itens where produto = 'agente_voz') as itens_fatura,                -- 5
--          (select count(*) from public.permissoes_catalogo
--             where codigo in ('ouvir_gravacoes', 'ver_transcricoes', 'aprovar_roteiro_voz')) as permissoes_cliente, -- 3
--          (select count(*) from public.permissoes_equipe_catalogo
--             where permissao in ('gerenciar_troncos_voz', 'ligar_voz_real')) as permissoes_equipe,                 -- 2
--          has_table_privilege('anon', 'public.voz_chamadas', 'select') as anon_le;                                   -- false

-- ================================================================ 0. auxiliar: troca de trecho em função existente
create or replace function pg_temp.trocar(assinatura text, de text, para text) returns void
language plpgsql as $$
declare d text := pg_get_functiondef(assinatura::regprocedure);
begin
    if position(para in d) > 0 then          -- já aplicado
        return;
    end if;
    if position(de in d) = 0 then
        raise exception 'trecho não encontrado em %: %', assinatura, de;
    end if;
    execute replace(d, de, para);
end $$;

-- ================================================================ 1. permissões (cliente e equipe)
create or replace view public.permissoes_catalogo as
select * from (values
  -- codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem
  ('baixar_listas',        'Operação',      'Baixar a lista do dia',        'Arquivos por canal (IDs e contatos) da Lista do dia.', true,  true,  true, true, 1),
  ('baixar_relatorios',    'Operação',      'Baixar arquivos completos',    'Fila completa, higienização, enriquecimento e demais saídas.', true, true, false, false, 2),
  ('baixar_comite',        'Gestão',        'Baixar o relatório de comitê', 'Planilha mensal do comitê.', true, true, false, true, 3),
  ('enviar_arquivos',      'Operação',      'Enviar arquivos',              'Cargas, acordos, pagamentos, ocorrências e retornos dos canais.', true, true, false, false, 4),
  ('reenquadrar',          'Operação',      'Reenquadrar agora',            'Pedir a rodada do motor na hora.', true, true, false, false, 5),
  ('editar_orquestracao',  'Configuração',  'Editar a orquestração',        'Segmentos, estratégias, personas e sugestões.', true, true, false, false, 6),
  ('editar_credores',      'Configuração',  'Editar credores',              'Criar credor, calendário, mapeamento de arquivos e regras de retorno.', true, true, false, false, 7),
  ('editar_canais',        'Configuração',  'Editar canais e frases',       'Canais da empresa (custo, horário) e playbook de frases.', true, true, false, false, 8),
  ('ver_acessos',          'Administração', 'Ver acessos',                  'Histórico de acessos ao site.', true, false, false, true, 9),
  ('ver_auditoria',        'Administração', 'Ver auditoria',                'Quem alterou o quê e quando.', true, false, false, false, 10),
  ('gerenciar_usuarios',   'Administração', 'Gerenciar usuários',           'Convidar, desativar, reativar, resetar senha e trocar perfil.', true, false, false, false, 11),
  ('gerenciar_permissoes', 'Administração', 'Gerenciar permissões',         'Ajustar o que cada perfil pode fazer.', true, false, false, false, 12),
  ('ver_faturamento',      'Administração', 'Ver faturamento',              'Plano, consumo do mês e faturas da empresa.', true, false, false, true, 13),
  ('enviar_mensagens',     'Operação',      'Enviar mensagens',             'Aprovar, pausar, retomar e cancelar lotes da Mensageria; descadastrar contatos.', true, true, false, false, 14),
  ('gerenciar_api',        'Administração', 'Gerenciar tokens de API',      'Criar e revogar os tokens que o sistema da empresa usa na API.', true, false, false, false, 15),
  ('pagar_faturas',        'Administração', 'Pagar faturas e recarregar',   'Pagar faturas (Pix, boleto ou cartão) e pedir recargas do pré-pago.', true, false, false, false, 16),
  ('ver_clientes',         'Operação',      'Ver clientes',                 'Lista e ficha dos clientes da carteira.', true, true, true, true, 17),
  ('ver_painel',           'Gestão',        'Ver o painel',                 'Painel de resultados da área.', true, true, true, true, 18),
  ('ouvir_gravacoes',      'Agente virtual', 'Ouvir gravações',             'Ouvir as gravações das ligações (link de 5 minutos; cada escuta fica registrada).', true, false, false, true, 19),
  ('ver_transcricoes',     'Agente virtual', 'Ler transcrições',            'Ler a transcrição redigida das ligações, sem copiar nem baixar.', true, false, false, true, 20),
  ('aprovar_roteiro_voz',  'Agente virtual', 'Aprovar o roteiro',           'Aprovar o roteiro do agente virtual e colocar a versão em uso.', true, false, false, false, 21)
) as t (codigo, grupo, nome, descricao, admin, planejamento, operacao, gestao, ordem);
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

create or replace view public.permissoes_equipe_catalogo as
select * from (values
    ('ver_empresas', 'Empresas', 'Ver empresas e Saúde', true, true, true, true, true),
    ('criar_empresa', 'Empresas', 'Criar empresa', true, false, true, false, false),
    ('convidar_admin', 'Empresas', 'Convidar o Admin do cliente', true, false, true, false, false),
    ('pausar_empresa', 'Empresas', 'Ativar, suspender, encerrar ou reativar empresa', true, false, false, true, false),
    ('editar_contratacao', 'Contratação', 'Editar contratação', true, false, false, false, false),
    ('editar_precos', 'Contratação', 'Editar preços (entre o mínimo e a tabela)', true, false, false, true, false),
    ('contratar_score', 'Contratação', 'Contratar o Score de Entrega e definir a cobrança', true, false, true, true, false),
    ('ver_faturamento', 'Financeiro', 'Ver faturamento', true, false, true, true, false),
    ('emitir_faturas', 'Financeiro', 'Ajustar e emitir faturas e notas fiscais', true, false, false, true, false),
    ('ver_margem', 'Financeiro', 'Ver margem (MC)', true, false, false, true, false),
    ('responder_chamados', 'Atendimento', 'Responder chamados', true, true, false, false, true),
    ('acessar_mensageria', 'Atendimento', 'Entrar na Mensageria do cliente', true, true, false, false, true),
    ('gerenciar_equipe', 'Equipe', 'Gerenciar a equipe', true, false, false, false, false),
    ('editar_produtos', 'Produtos', 'Criar produtos e definir preço mínimo e de tabela', true, false, false, true, false),
    ('preco_abaixo_minimo', 'Produtos', 'Dar preço abaixo do mínimo (com motivo)', true, false, false, true, false),
    ('gerenciar_fornecedores', 'Produtos', 'Fornecedores, negociações e rotas', true, false, false, true, false),
    ('ver_qualidade', 'Técnico', 'Ver a qualidade dos fornecedores', true, true, false, true, true),
    ('ver_detalhe_tecnico', 'Técnico', 'Ver o detalhe técnico dos envios', true, false, false, false, true),
    ('configurar_score', 'Técnico', 'Configurar o filtro de inteligência e os nomes devolvidos', true, false, false, false, true),
    ('ligar_envio_real', 'Atendimento', 'Ligar o envio real da Mensageria do cliente', true, true, false, false, false),
    -- SQL 56 · agente de voz
    ('gerenciar_troncos_voz', 'Técnico', 'Troncos, rotas, transferência e concorrência do agente de voz', true, false, false, false, true),
    ('ligar_voz_real', 'Atendimento', 'Ligar as ligações reais do agente de voz', true, true, false, false, false)
) as c(permissao, grupo, nome, master, atendimento, comercial, administrativo, tecnico);
grant select on public.permissoes_equipe_catalogo to authenticated;
revoke all on public.permissoes_equipe_catalogo from anon;

-- quem cuida da telefonia de voz de uma empresa (equipe, no alcance, com a permissão)
create or replace function public.cuida_voz(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
    select public.equipe_pode('gerenciar_troncos_voz', eid)
$$;
revoke all on function public.cuida_voz(bigint) from public, anon;
grant execute on function public.cuida_voz(bigint) to authenticated;

-- escuta e leitura entram no registro de acessos
alter table public.acessos drop constraint if exists acessos_acao_check;
alter table public.acessos add constraint acessos_acao_check
    check (acao in ('download', 'consulta_cliente', 'envio', 'ouvir_gravacao', 'ler_transcricao'));

-- ================================================================ 2. módulo, fornecedor e itens da fatura
alter table public.empresa_modulos drop constraint if exists empresa_modulos_modulo_check;
alter table public.empresa_modulos add constraint empresa_modulos_modulo_check
    check (modulo in ('orquestracao', 'jornada', 'mensageria', 'enriquecimento', 'api', 'agente_voz'));

alter table public.mensageria_fornecedores drop constraint if exists mensageria_fornecedores_canais_validos;
alter table public.mensageria_fornecedores add constraint mensageria_fornecedores_canais_validos
    check (canais <@ array['sms', 'email', 'rcs', 'whatsapp', 'agente_voz']::text[]);
insert into public.mensageria_fornecedores (codigo, nome, canais, segredo_ref)
values ('elevenlabs', 'ElevenLabs', '{agente_voz}', 'voz/elevenlabs')
on conflict (codigo) do nothing;

-- V23: o que o MotorCX fatura do agente de voz. Telefonia NÃO é item (o cliente paga à operadora).
insert into public.cobranca_itens (codigo, produto, nome, unidade, preco_de, modulo, ordem, descricao) values
    ('voz_plataforma',      'agente_voz', 'Agente virtual · plataforma',      'mês',         null, 'agente_voz', 50, 'plataforma do agente de voz'),
    ('voz_minuto_ia',       'agente_voz', 'Agente virtual · minuto de IA',    'minuto',      null, 'agente_voz', 51, 'minuto conectado do agente de IA'),
    ('voz_minuto_ia_pico',  'agente_voz', 'Agente virtual · minuto no pico',  'minuto',      null, 'agente_voz', 52, 'minuto acima do limite, com o pico ligado (2x)'),
    ('voz_transcricao',     'agente_voz', 'Agente virtual · transcrição',     'minuto',      null, 'agente_voz', 53, 'minuto transcrito acima do mínimo de segundos'),
    ('gestao_tronco_sip',   'agente_voz', 'Agente virtual · gestão de tronco','tronco·mês',  null, 'agente_voz', 54, 'cadastro e gestão do tronco SIP')
on conflict (codigo) do nothing;

-- ================================================================ 3. listas fechadas e validações
-- desfechos de voz do motor (motor/voz.py › DESFECHOS, sem os internos). tests/test_voz_banco.py confere a paridade.
create or replace function public.desfechos_voz() returns text[]
language sql immutable parallel safe as $$
    select array['numero_inexistente', 'nao_atendida', 'caixa_postal', 'atendida_sem_cpc',
                 'atendida_terceiro_desconhece', 'cpc', 'promessa', 'recusa', 'recado', 'ocupado', 'abandonada',
                 'falha_rede', 'opt_out', 'identidade_confirmada', 'maquina', 'desligou_sem_conversar',
                 'atendeu_desligou', 'retorno_agendado', 'falha_operadora', 'bloqueio_originacao',
                 'cancelada_discador', 'indisponivel', 'rejeitada', 'mudo', 'fax']::text[]
$$;

-- variáveis que o agente pode receber (nunca CPF; o valor só existe na VM e no provedor durante a chamada)
create or replace function public.variaveis_voz() returns text[]
language sql immutable parallel safe as $$
    select array['primeiro_nome', 'credor', 'saldo', 'dias_atraso', 'vencimento', 'link_pagamento',
                 'valor_minimo', 'parcelas_max', 'desconto_max']::text[]
$$;

-- máscara de telefone: no máximo 4 dígitos à vista (ex.: "(11) ••••-••12")
create or replace function public.mascara_voz_ok(m text) returns boolean
language sql immutable parallel safe as $$
    select m is null or (char_length(m) between 4 and 30 and length(regexp_replace(m, '\D', '', 'g')) <= 4)
$$;

-- regras de transferência do roteiro: esquema fechado, todas as chaves presentes
--   cpc                 transfere quando confirma o titular (obrigatório no localizador)
--   pedido_humano       "quero falar com uma pessoa" sempre transfere (sempre true)
--   ofertas_sem_acordo  transfere depois de N ofertas sem acordo (0 = não transfere por isso; até 5)
--   fora_alcada         pedido fora da alçada do roteiro (desconto, prazo) transfere
--   contestacao         cliente contesta a dívida: transfere
create or replace function public.regras_transferencia_validas(tipo text, r jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare k text;
begin
    if r is null or jsonb_typeof(r) <> 'object' then
        return false;
    end if;
    for k in select jsonb_object_keys(r) loop
        if k not in ('cpc', 'pedido_humano', 'ofertas_sem_acordo', 'fora_alcada', 'contestacao') then
            return false;
        end if;
    end loop;
    if jsonb_typeof(r -> 'cpc') is distinct from 'boolean' or jsonb_typeof(r -> 'pedido_humano') is distinct from 'boolean'
       or jsonb_typeof(r -> 'fora_alcada') is distinct from 'boolean'
       or jsonb_typeof(r -> 'contestacao') is distinct from 'boolean'
       or jsonb_typeof(r -> 'ofertas_sem_acordo') is distinct from 'number' then
        return false;
    end if;
    if not (r ->> 'pedido_humano')::boolean then
        return false;                                   -- "falar com humano" sempre funciona
    end if;
    if (r ->> 'ofertas_sem_acordo')::numeric not in (0, 1, 2, 3, 4, 5) then
        return false;
    end if;
    if tipo = 'localizador' and not (r ->> 'cpc')::boolean then
        return false;                                   -- o localizador confirma o titular e transfere
    end if;
    return true;
end $$;

-- códigos fechados por cliente (decisão 14): só estas chaves e valores; apagados junto com a gravação
--   motivo             motivo do não pagamento (lista fechada; saúde nunca vira código)
--   objecoes           até 5 objeções da lista
--   promessa           {data: AAAA-MM-DD, valor?: número >= 0, parcelas?: 1..120}
--   retorno            {quando: AAAA-MM-DDTHH:MM[:SS](Z|±HH:MM)}
--   canal_preferido    canal que a pessoa pediu
--   horario_preferido  manha | tarde | noite | sabado
create or replace function public.codigos_voz_validos(c jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare
    k text;
    v jsonb;
begin
    if c is null then
        return true;
    end if;
    if jsonb_typeof(c) <> 'object' then
        return false;
    end if;
    for k, v in select * from jsonb_each(c) loop
        if k = 'motivo' then
            if jsonb_typeof(v) <> 'string' or v #>> '{}' not in ('desemprego', 'reducao_renda', 'outras_dividas',
                    'esquecimento', 'aguardando_recebimento', 'nao_reconhece', 'contestacao', 'fraude_alegada',
                    'insatisfacao_servico', 'outro') then
                return false;
            end if;
        elsif k = 'objecoes' then
            if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 5 then
                return false;
            end if;
            if exists (select 1 from jsonb_array_elements(v) o
                        where jsonb_typeof(o) <> 'string'
                           or o #>> '{}' not in ('valor_alto', 'parcela_alta', 'juros', 'sem_dinheiro_agora',
                                                 'quer_desconto', 'desconfia_golpe', 'quer_por_escrito',
                                                 'quer_falar_humano', 'outro')) then
                return false;
            end if;
        elsif k = 'promessa' then
            if jsonb_typeof(v) <> 'object' or not (v ? 'data')
               or exists (select 1 from jsonb_object_keys(v) x where x not in ('data', 'valor', 'parcelas'))
               or jsonb_typeof(v -> 'data') <> 'string' or (v ->> 'data') !~ '^\d{4}-\d{2}-\d{2}$' then
                return false;
            end if;
            if v ? 'valor' and (jsonb_typeof(v -> 'valor') <> 'number' or (v ->> 'valor')::numeric < 0) then
                return false;
            end if;
            if v ? 'parcelas' and (jsonb_typeof(v -> 'parcelas') <> 'number'
                                   or (v ->> 'parcelas')::numeric not between 1 and 120
                                   or (v ->> 'parcelas')::numeric <> trunc((v ->> 'parcelas')::numeric)) then
                return false;
            end if;
        elsif k = 'retorno' then
            if jsonb_typeof(v) <> 'object'
               or exists (select 1 from jsonb_object_keys(v) x where x <> 'quando')
               or jsonb_typeof(v -> 'quando') is distinct from 'string'
               or (v ->> 'quando') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$' then
                return false;
            end if;
        elsif k = 'canal_preferido' then
            if jsonb_typeof(v) <> 'string'
               or v #>> '{}' not in ('whatsapp', 'sms', 'email', 'rcs', 'agente_voz', 'discador') then
                return false;
            end if;
        elsif k = 'horario_preferido' then
            if jsonb_typeof(v) <> 'string' or v #>> '{}' not in ('manha', 'tarde', 'noite', 'sabado') then
                return false;
            end if;
        else
            return false;
        end if;
    end loop;
    return true;
end $$;

-- ================================================================ 4. tarifação (V20/V21)
-- segundos cobrados pela operadora: qualquer segundo atendido paga o mínimo inicial; depois, blocos do incremento.
-- 0 se billsec <= 0 (ou nulo); nulo se a cadência é desconhecida (rota sem cadastro).
create or replace function public.segundos_tarifados(billsec int, inicial int, incremento int) returns int
language plpgsql immutable parallel safe as $$
begin
    if billsec is null or billsec <= 0 then
        return 0;
    end if;
    if inicial is null or incremento is null then
        return null;
    end if;
    if inicial < 1 or incremento < 1 then
        raise exception 'cadência inválida: inicial e incremento precisam ser >= 1';
    end if;
    if billsec <= inicial then
        return inicial;
    end if;
    return inicial + (ceil((billsec - inicial)::numeric / incremento))::int * incremento;
end $$;

create or replace function public.custo_voz(segundos int, preco_minuto numeric) returns numeric
language sql immutable parallel safe as $$
    select round(segundos * preco_minuto / 60, 5)
$$;

-- ================================================================ 5. configuração por empresa (V1, V7, V16, V24)
create table if not exists public.voz_config (
    empresa_id               bigint primary key references public.empresas (id) on delete cascade,
    -- equipe MotorCX
    provedor                 text not null default 'simulador'
                             check (provedor in ('montagem_motorcx', 'elevenlabs', 'simulador')),
    modo                     text not null default 'simulado' check (modo in ('simulado', 'teste', 'real')),
    agent_id                 text check (agent_id ~ '^[A-Za-z0-9_\-]{4,80}$'),
    voz_id                   text check (voz_id ~ '^[A-Za-z0-9_\-]{2,80}$'),
    numeros_teste_hash       text[] not null default '{}'
                             check (cardinality(numeros_teste_hash) <= 20
                                    and array_to_string(numeros_teste_hash, ',') ~ '^([0-9a-f]{64}(,[0-9a-f]{64})*)?$'),
    pico_multiplo            int not null default 1 check (pico_multiplo between 1 and 3),
    alo_fake_liberado        boolean not null default false,
    bucket_gravacoes         text check (bucket_gravacoes ~ '^[a-z0-9][a-z0-9_.\-]{1,61}[a-z0-9]$'),
    -- empresa (Admin ou quem edita canais)
    alo_fake                 boolean not null default false,
    alo_fake_max_s           int not null default 4 check (alo_fake_max_s between 1 and 15),
    alo_fake_audio_ref       text check (alo_fake_audio_ref ~ '^[A-Za-z0-9_\-/.]{1,200}$'),
    abandono_max_pct         numeric(4, 1) not null default 3 check (abandono_max_pct between 0.5 and 20),
    freio_ritmo_pct          int not null default 60 check (freio_ritmo_pct between 10 and 100),
    variaveis                text[] not null default '{primeiro_nome,credor,link_pagamento}'
                             check (variaveis <@ public.variaveis_voz()),
    -- privacidade (Admin da empresa)
    gravar                   boolean not null default true,
    aviso_gravacao           boolean not null default false,
    retencao_dias            int not null default 90 check (retencao_dias >= 90),
    transcrever              boolean not null default true,
    transcrever_min_segundos int not null default 5 check (transcrever_min_segundos between 0 and 600),
    atualizado_em            timestamptz not null default now(),
    atualizado_por           uuid default auth.uid() references auth.users (id) on delete set null,
    check (alo_fake_liberado or not alo_fake),
    check (modo = 'simulado' or provedor <> 'simulador')
);
comment on table public.voz_config is 'Agente de voz por empresa. Escrita só por RPC: configurar_voz_equipe, configurar_voz_empresa, ligar_voz_real.';
comment on column public.voz_config.modo is 'simulado → teste (só números de teste) → real. Só a equipe muda (ligar_voz_real).';
comment on column public.voz_config.numeros_teste_hash is 'sha-256 (hex) dos números de teste. Nunca o número.';
comment on column public.voz_config.pico_multiplo is '1 = sem pico; até 3. Teto = min(limite × pico, canais dos troncos).';
comment on column public.voz_config.bucket_gravacoes is
    'Só o NOME do bucket de gravações da empresa (um por empresa, com o ciclo de vida da retenção dela). Escrito pela equipe.';
comment on column public.voz_config.retencao_dias is 'Gravação, transcrição e códigos por cliente: mínimo e padrão 90, sem teto.';
comment on column public.voz_config.transcrever_min_segundos is 'Transcreve quando duracao_s >= valor (padrão 5).';
alter table public.voz_config enable row level security;
drop policy if exists voz_config_ver on public.voz_config;
create policy voz_config_ver on public.voz_config for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_config from anon;
revoke insert, update, delete on public.voz_config from authenticated;

-- ================================================================ 6. roteiros (V1, V5, V6, V25)
create table if not exists public.voz_roteiros (
    id                    bigint generated always as identity primary key,
    empresa_id            bigint not null references public.empresas (id) on delete cascade,
    credor_id             bigint references public.credores (id) on delete cascade,     -- nulo = empresa toda
    versao                int not null check (versao >= 1),
    situacao              text not null default 'rascunho'
                          check (situacao in ('rascunho', 'aprovado_empresa', 'em_uso', 'arquivado')),
    tipo_agente           text not null default 'negociador' check (tipo_agente in ('localizador', 'negociador', 'ambos')),
    prompt                text not null check (char_length(prompt) between 50 and 20000),
    primeira_fala         text not null check (char_length(primeira_fala) between 10 and 500),
    apresentar_virtual    boolean not null default false,
    regras_transferencia  jsonb not null,
    parecer               text check (parecer is null or char_length(parecer) <= 1000),
    criado_por            uuid default auth.uid() references auth.users (id) on delete set null,
    criado_em             timestamptz not null default now(),
    atualizado_em         timestamptz not null default now(),
    aprovado_por          uuid references auth.users (id) on delete set null,
    aprovado_em           timestamptz,
    em_uso_por            uuid references auth.users (id) on delete set null,
    em_uso_em             timestamptz,
    check (public.regras_transferencia_validas(tipo_agente, regras_transferencia)),
    check (situacao = 'rascunho' or aprovado_em is not null)
);
create unique index if not exists voz_roteiros_versao on public.voz_roteiros (empresa_id, coalesce(credor_id, 0), versao);
create unique index if not exists voz_roteiros_em_uso on public.voz_roteiros (empresa_id, coalesce(credor_id, 0))
    where situacao = 'em_uso';
comment on column public.voz_roteiros.apresentar_virtual is 'Frase de assistente virtual no texto aprovado (padrão: não).';
comment on column public.voz_roteiros.regras_transferencia is
    'Esquema fechado: {cpc, pedido_humano (sempre true), ofertas_sem_acordo 0..5, fora_alcada, contestacao}.';
alter table public.voz_roteiros enable row level security;
drop policy if exists voz_roteiros_ver on public.voz_roteiros;
create policy voz_roteiros_ver on public.voz_roteiros for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_roteiros from anon;
revoke insert, update, delete on public.voz_roteiros from authenticated;

-- ================================================================ 7. troncos (V2)
create table if not exists public.voz_troncos (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    referencia      text not null check (referencia ~ '^[a-z0-9][a-z0-9_\-]{1,39}$'),
    operadora       text not null check (char_length(trim(operadora)) between 2 and 60),
    host            text not null check (host ~ '^([0-9]{1,3}\.){3}[0-9]{1,3}$'
                                         or host ~ '^[A-Za-z0-9]([A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)+$'),
    porta           int not null default 5060 check (porta between 1 and 65535),
    transporte      text not null default 'udp' check (transporte in ('udp', 'tcp', 'tls')),
    autenticacao    text not null check (autenticacao in ('ip', 'senha')),
    usuario         text check (usuario ~ '^[A-Za-z0-9_.\-+]{1,64}$'),
    segredo_ref     text check (segredo_ref ~ '^[A-Za-z0-9_\-/.]{1,120}$'),
    ddd_origem      text not null check (ddd_origem ~ '^[1-9][1-9]$'),
    bina            text not null check (bina ~ '^([1-9][1-9][2-9][0-9]{7,8}|0[3589]00[0-9]{6,7}|[34]00[0-9][0-9]{4})$'),
    formato_discagem text not null default 'tech_ddd_numero'
                    check (formato_discagem in ('tech_ddd_numero', 'tech_0_csp_ddd_numero', 'tech_55_ddd_numero')),
    codecs          text[] not null default '{alaw,ulaw}'
                    check (cardinality(codecs) >= 1 and codecs <@ array['alaw', 'ulaw', 'g729', 'g722', 'opus']::text[]),
    canais          int not null check (canais between 1 and 10000),
    cps             int not null default 10 check (cps between 1 and 1000),
    ativo           boolean not null default true,
    testado_em      timestamptz,
    teste_ok        boolean,
    cadastrado_por  uuid default auth.uid() references auth.users (id) on delete set null,
    cadastrado_em   timestamptz not null default now(),
    atualizado_em   timestamptz not null default now(),
    unique (empresa_id, referencia),
    unique (id, empresa_id),
    check ((autenticacao = 'senha') = (segredo_ref is not null)),
    check ((autenticacao = 'senha') = (usuario is not null))
);
comment on column public.voz_troncos.segredo_ref is
    'NOME do segredo (Secret Manager do MotorCX) com usuário e senha do tronco. Nulo na autenticação por IP. A senha nunca fica no banco.';
comment on column public.voz_troncos.usuario is 'Usuário SIP (autenticação por senha). Nulo na autenticação por IP.';
comment on column public.voz_troncos.ddd_origem is 'DDD de onde o tronco origina: separa fixo local de LDN e móvel VC1 de VC2/VC3.';
comment on column public.voz_troncos.bina is
    'Número que a empresa exibe (da própria empresa, nunca do devedor), só dígitos e inteiro: o Asterisk origina com ele.';
comment on column public.voz_troncos.formato_discagem is
    'Como o Asterisk monta o número: tech prefix + DDD + número (padrão), + 0 + CSP + DDD + número, ou + 55 + DDD + número.';
comment on column public.voz_troncos.canais is 'Canais simultâneos contratados com a operadora: limite real de saída e peso na divisão da concorrência.';
alter table public.voz_troncos enable row level security;
drop policy if exists voz_troncos_ver on public.voz_troncos;
create policy voz_troncos_ver on public.voz_troncos for select to authenticated
    using (public.ve_faturamento(empresa_id) or public.cuida_voz(empresa_id));
revoke all on public.voz_troncos from anon;
revoke insert, update, delete on public.voz_troncos from authenticated;

-- ================================================================ 8. rotas com vigência (V20)
create table if not exists public.voz_rotas (
    id                     bigint generated always as identity primary key,
    empresa_id             bigint not null references public.empresas (id) on delete cascade,
    tronco_id              bigint not null,
    prioridade             int not null check (prioridade between 1 and 9),
    tech_prefix            text not null check (tech_prefix ~ '^[0-9]{1,8}$'),
    tipo                   text not null check (tipo in ('fixo_local', 'fixo_ldn', 'movel_vc1', 'movel_vc2_vc3')),
    cadencia_inicial_s     int not null check (cadencia_inicial_s between 1 and 600),
    cadencia_incremento_s  int not null check (cadencia_incremento_s between 1 and 600),
    preco_minuto           numeric(10, 5) not null check (preco_minuto >= 0),
    vigente_desde          date not null,
    vigente_ate            date,
    cadastrado_por         uuid default auth.uid() references auth.users (id) on delete set null,
    cadastrado_em          timestamptz not null default now(),
    unique (empresa_id, tech_prefix, vigente_desde),
    foreign key (tronco_id, empresa_id) references public.voz_troncos (id, empresa_id),
    check (vigente_ate is null or vigente_ate >= vigente_desde)
);
create unique index if not exists voz_rotas_tipo_prioridade on public.voz_rotas (empresa_id, tipo, prioridade)
    where vigente_ate is null;
comment on table public.voz_rotas is
    'Tipo do número → tronco + tech prefix + prioridade (failover). Cadência e preço do minuto contratados com a operadora, '
    'com vigência e sem carência: só para conferir o custo de telefonia (não entra na fatura do MotorCX). '
    'Preço não se edita: salvar_rota_voz cria vigência nova e fecha a anterior no dia de antes.';

-- vigências do mesmo tech prefix não se sobrepõem
create or replace function public.validar_rota_voz() returns trigger
language plpgsql set search_path = public as $$
begin
    if exists (select 1 from public.voz_rotas r
                where r.empresa_id = new.empresa_id and r.tech_prefix = new.tech_prefix and r.id <> new.id
                  and r.vigente_desde <= coalesce(new.vigente_ate, 'infinity'::date)
                  and new.vigente_desde <= coalesce(r.vigente_ate, 'infinity'::date)) then
        raise exception 'o tech prefix % já tem rota nesse período', new.tech_prefix;
    end if;
    if tg_op = 'UPDATE' and (new.preco_minuto, new.cadencia_inicial_s, new.cadencia_incremento_s, new.vigente_desde,
                             new.tech_prefix, new.empresa_id)
                            is distinct from (old.preco_minuto, old.cadencia_inicial_s, old.cadencia_incremento_s,
                                              old.vigente_desde, old.tech_prefix, old.empresa_id) then
        raise exception 'preço e cadência não se editam: crie uma vigência nova';
    end if;
    return new;
end $$;
revoke all on function public.validar_rota_voz() from public, anon, authenticated;
drop trigger if exists validar_rota_voz on public.voz_rotas;
create trigger validar_rota_voz before insert or update on public.voz_rotas
    for each row execute function public.validar_rota_voz();

alter table public.voz_rotas enable row level security;
drop policy if exists voz_rotas_ver on public.voz_rotas;
create policy voz_rotas_ver on public.voz_rotas for select to authenticated
    using (public.ve_faturamento(empresa_id) or public.cuida_voz(empresa_id));
revoke all on public.voz_rotas from anon;
revoke insert, update, delete on public.voz_rotas from authenticated;

-- rota em vigor no dia (security invoker: o site só acha rota que pode ver; a VM usa a chave do servidor)
create or replace function public.rota_voz_vigente(empresa bigint, prefixo text, dia date) returns public.voz_rotas
language sql stable set search_path = public as $$
    select r.* from public.voz_rotas r
     where r.empresa_id = empresa and r.tech_prefix = prefixo
       and r.vigente_desde <= dia and (r.vigente_ate is null or r.vigente_ate >= dia)
     order by r.vigente_desde desc limit 1
$$;
revoke all on function public.rota_voz_vigente(bigint, text, date) from public, anon;
grant execute on function public.rota_voz_vigente(bigint, text, date) to authenticated, service_role;

-- ================================================================ 9. transferência para humano (V25)
create table if not exists public.voz_transferencias (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint references public.credores (id) on delete cascade,     -- nulo = empresa toda
    nome            text not null check (char_length(trim(nome)) between 2 and 60),
    destino_sip     text not null
                    check (destino_sip ~ '^sips?:[A-Za-z0-9_.+\-]{1,64}@[A-Za-z0-9.\-]{1,253}(:[0-9]{1,5})?(;transport=(udp|tcp|tls))?$'),
    metodo          text not null default 'refer' check (metodo in ('refer', 'ponte')),
    tronco_id       bigint,
    tech_prefix     text check (tech_prefix ~ '^[0-9]{1,8}$'),
    cabecalhos      text[] not null
                    default '{X-MotorCX-Id-Chamada,X-MotorCX-Id-Acao,X-MotorCX-Acao,X-MotorCX-Motivo}'
                    check (cabecalhos <@ array['X-MotorCX-Id-Chamada', 'X-MotorCX-Id-Acao', 'X-MotorCX-Acao',
                                               'X-MotorCX-Motivo']::text[]),
    ativo           boolean not null default true,
    testado_em      timestamptz,
    teste_ok        boolean,
    cadastrado_por  uuid default auth.uid() references auth.users (id) on delete set null,
    cadastrado_em   timestamptz not null default now(),
    atualizado_em   timestamptz not null default now(),
    foreign key (tronco_id, empresa_id) references public.voz_troncos (id, empresa_id),
    check (metodo = 'refer' or tronco_id is not null)
);
create unique index if not exists voz_transferencias_ativa on public.voz_transferencias (empresa_id, coalesce(credor_id, 0))
    where ativo;
comment on column public.voz_transferencias.cabecalhos is
    'Cabeçalhos SIP X-MotorCX com ID da chamada, ID da ação, ação e motivo. Nunca CPF, nome ou valor.';
alter table public.voz_transferencias enable row level security;
drop policy if exists voz_transferencias_ver on public.voz_transferencias;
create policy voz_transferencias_ver on public.voz_transferencias for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_transferencias from anon;
revoke insert, update, delete on public.voz_transferencias from authenticated;

-- ================================================================ 10. concorrência contratada e divisão (V4, decisão 12)
create table if not exists public.voz_contrato (
    id                       boolean primary key default true check (id),
    concorrencia_contratada  int not null default 0 check (concorrencia_contratada >= 0),
    atualizado_por           uuid references auth.users (id) on delete set null,
    atualizado_em            timestamptz not null default now()
);
insert into public.voz_contrato (id) values (true) on conflict (id) do nothing;
comment on table public.voz_contrato is 'Uma linha: chamadas simultâneas contratadas no provedor de voz (teto global).';
alter table public.voz_contrato enable row level security;
drop policy if exists voz_contrato_ver on public.voz_contrato;
create policy voz_contrato_ver on public.voz_contrato for select to authenticated using (public.sou_equipe());
revoke all on public.voz_contrato from anon;
revoke insert, update, delete on public.voz_contrato from authenticated;

-- limite = parte inteira de contratado × canais ÷ soma dos canais dos troncos ativos; a sobra vai, uma a uma, para as
-- maiores frações (empate: mais canais, depois o menor id); nunca acima dos canais. teto = min(limite × pico, canais).
-- Calcula sobre todas as empresas, mas só devolve as que a pessoa enxerga (a VM, com a chave do servidor, vê todas).
create or replace function public.divisao_concorrencia_voz()
returns table (empresa_id bigint, canais int, contratado int, cota numeric, limite int, pico_multiplo int, teto int)
language sql stable security definer set search_path = public as $$
    with c as (select v.concorrencia_contratada as n from public.voz_contrato v where v.id),
    t as (select tr.empresa_id, sum(tr.canais)::int as canais from public.voz_troncos tr
           where tr.ativo group by tr.empresa_id),
    s as (select sum(t.canais) as total from t),
    b as (select t.empresa_id, t.canais, coalesce(c.n, 0) as n,
                 coalesce(c.n, 0)::numeric * t.canais / nullif(s.total, 0) as cota
            from t cross join s left join c on true),
    f as (select b.*, least(floor(b.cota)::int, b.canais) as base, b.cota - floor(b.cota) as resto from b),
    k as (select greatest(coalesce(max(f.n), 0) - coalesce(sum(f.base), 0), 0) as sobra from f),
    r as (select f.empresa_id, row_number() over (order by f.resto desc, f.canais desc, f.empresa_id) as ordem
            from f where f.base < f.canais)
    select f.empresa_id, f.canais, f.n, round(f.cota, 4),
           least(f.base + case when r.ordem <= k.sobra then 1 else 0 end, f.canais) as limite,
           coalesce(vc.pico_multiplo, 1),
           least((f.base + case when r.ordem <= k.sobra then 1 else 0 end) * coalesce(vc.pico_multiplo, 1), f.canais)
      from f cross join k
      left join r on r.empresa_id = f.empresa_id
      left join public.voz_config vc on vc.empresa_id = f.empresa_id
     where public.chamada_do_servidor() or f.empresa_id in (select public.minhas_empresas())
$$;
revoke all on function public.divisao_concorrencia_voz() from public, anon;
grant execute on function public.divisao_concorrencia_voz() to authenticated, service_role;

create or replace view public.voz_divisao_concorrencia as select * from public.divisao_concorrencia_voz();
revoke all on public.voz_divisao_concorrencia from anon;
grant select on public.voz_divisao_concorrencia to authenticated, service_role;

-- ================================================================ 11. saúde de fornecedores e troncos (V3)
create table if not exists public.fornecedor_saude (
    id             bigint generated always as identity primary key,
    empresa_id     bigint references public.empresas (id) on delete cascade,     -- nulo = global
    fornecedor     text references public.mensageria_fornecedores (codigo) on delete cascade,
    tronco_id      bigint references public.voz_troncos (id) on delete cascade,
    item           text not null check (item ~ '^[a-z0-9_]{2,40}$'),
    referencia     text not null default '' check (referencia ~ '^[A-Za-z0-9_.\-]{0,40}$'),
    ok             boolean not null,
    contagem       int not null default 1 check (contagem >= 0),
    detalhe        text check (detalhe is null or char_length(detalhe) <= 200),
    verificado_em  timestamptz not null default now()
);
create unique index if not exists fornecedor_saude_unica on public.fornecedor_saude
    ((coalesce(empresa_id, 0)), (coalesce(fornecedor, '')), (coalesce(tronco_id, 0)), item, referencia);
comment on table public.fornecedor_saude is
    'Saúde de fornecedor ou tronco (gravada pela VM e pelas Edge Functions). rota_sem_cadastro: referencia = tech prefix.';
alter table public.fornecedor_saude enable row level security;
drop policy if exists fornecedor_saude_ver on public.fornecedor_saude;
create policy fornecedor_saude_ver on public.fornecedor_saude for select to authenticated
    using (case when empresa_id is null then public.sou_equipe()
                else public.ve_faturamento(empresa_id) or public.cuida_voz(empresa_id) end);
revoke all on public.fornecedor_saude from anon;
revoke insert, update, delete on public.fornecedor_saude from authenticated;

-- ================================================================ 12. lotes, ondas e chamadas (V8, V8b, V10, V21, V24, V25)
create table if not exists public.voz_lotes (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint references public.credores (id) on delete set null,
    data             date not null,
    modo             text not null check (modo in ('simulado', 'teste', 'real')),
    situacao         text not null default 'agendado'
                     check (situacao in ('aguardando_aprovacao', 'agendado', 'ligando', 'pausado', 'concluido', 'cancelado')),
    roteiro_id       bigint references public.voz_roteiros (id) on delete set null,
    total            int not null default 0 check (total >= 0),
    encerradas       int not null default 0 check (encerradas >= 0),
    abandonos        int not null default 0 check (abandonos >= 0),
    custo_operadora  numeric(14, 5) not null default 0 check (custo_operadora >= 0),
    freado_em        timestamptz,
    criado_em        timestamptz not null default now(),
    atualizado_em    timestamptz not null default now(),
    atualizado_por   uuid references auth.users (id) on delete set null,
    concluido_em     timestamptz
);
create index if not exists voz_lotes_empresa on public.voz_lotes (empresa_id, data desc);
comment on column public.voz_lotes.freado_em is 'Quando a taxa de abandono passou de voz_config.abandono_max_pct (ritmo cai para freio_ritmo_pct).';

create table if not exists public.voz_ondas (
    id           bigint generated always as identity primary key,
    empresa_id   bigint not null references public.empresas (id) on delete cascade,
    lote_id      bigint not null references public.voz_lotes (id) on delete cascade,
    janela       text not null check (janela ~ '^[A-Za-z0-9_ :\-]{2,40}$'),
    tentativa    int not null check (tentativa between 1 and 50),
    total        int not null default 0 check (total >= 0),
    encerradas   int not null default 0 check (encerradas >= 0),
    situacao     text not null default 'aguardando'
                 check (situacao in ('aguardando', 'ligando', 'encerrada', 'cancelada')),
    abre_em      timestamptz,
    fecha_em     timestamptz
);
create index if not exists voz_ondas_lote on public.voz_ondas (lote_id);

create table if not exists public.voz_chamadas (
    id                     bigint generated always as identity primary key,
    empresa_id             bigint not null references public.empresas (id) on delete cascade,
    credor_id              bigint references public.credores (id) on delete set null,
    lote_id                bigint references public.voz_lotes (id) on delete set null,
    onda_id                bigint references public.voz_ondas (id) on delete set null,
    id_chamada             text not null check (id_chamada ~ '^[A-Za-z0-9_.:\-]{4,80}$'),
    canal                  text not null default 'agente_voz' check (canal in ('agente_voz', 'discador')),
    id_cliente             text not null check (char_length(id_cliente) between 1 and 60),
    id_acao                text check (char_length(id_acao) between 1 and 80),
    destino_mascara        text check (public.mascara_voz_ok(destino_mascara)),
    destino_hash           text check (destino_hash ~ '^[0-9a-f]{64}$'),
    tentativa              int not null default 1 check (tentativa between 1 and 50),
    modo                   text not null default 'simulado' check (modo in ('simulado', 'teste', 'real')),
    provedor               text check (provedor in ('montagem_motorcx', 'elevenlabs', 'simulador')),
    conversa_ref           text check (conversa_ref ~ '^[A-Za-z0-9_\-]{4,100}$'),
    ocorrido_em            timestamptz not null default now(),
    atendida_em            timestamptz,
    encerrada_em           timestamptz,
    duracao_s              int check (duracao_s >= 0),
    billsec                int check (billsec >= 0),
    -- de-para do motor (rede, IA, operador)
    causa_sip              int check (causa_sip between 100 and 699),
    causa_q850             int check (causa_q850 between 0 and 127),
    dialstatus             text check (dialstatus ~ '^[A-Z]{2,20}$'),
    amd                    text check (amd ~ '^[A-Z]{2,20}$'),
    resultado_ia           text check (resultado_ia = any (public.desfechos_voz())),
    resultado_operador     text check (resultado_operador = any (public.desfechos_voz())),
    resultado              text check (resultado = any (public.desfechos_voz())),
    origem_resultado       text check (origem_resultado in ('operador', 'transferencia', 'ia', 'rede', 'nenhum')),
    destino                text check (destino in ('ia', 'ia_humano')),
    identidade_confirmada  boolean,
    transferencia          text check (transferencia in ('atendida', 'sem_operador', 'falhou')),
    transferida_em         timestamptz,
    transferencia_id       bigint references public.voz_transferencias (id) on delete set null,
    -- minuto de IA e pico
    minutos_ia             numeric(10, 2) check (minutos_ia >= 0),
    no_pico                boolean not null default false,
    -- tarifação de telefonia (congelada em tarifada_em)
    tronco_id              bigint references public.voz_troncos (id) on delete set null,
    tech_prefix            text check (tech_prefix ~ '^[0-9]{1,8}$'),
    rota_id                bigint references public.voz_rotas (id) on delete set null,
    segundos_tarifados     int check (segundos_tarifados >= 0),
    preco_minuto           numeric(10, 5) check (preco_minuto >= 0),
    custo_operadora        numeric(12, 5) check (custo_operadora >= 0),
    tarifada_em            timestamptz,
    -- evento pós-chamada
    data_promessa          date,
    valor_promessa         numeric(14, 2) check (valor_promessa >= 0),
    retorno_em             timestamptz,
    -- roteiro, gravação, transcrição e códigos
    roteiro_id             bigint references public.voz_roteiros (id) on delete set null,
    roteiro_versao         int,
    tem_gravacao           boolean not null default false,
    transcricao            text check (transcricao in ('pendente', 'ok', 'abaixo_limiar', 'desligada', 'erro')),
    codigos                jsonb check (public.codigos_voz_validos(codigos)),
    unique (empresa_id, id_chamada, canal),
    check (transferencia is null or transferida_em is not null)
);
create index if not exists voz_chamadas_cliente on public.voz_chamadas (empresa_id, id_cliente, ocorrido_em desc);
create index if not exists voz_chamadas_lote on public.voz_chamadas (lote_id);
create index if not exists voz_chamadas_dia on public.voz_chamadas (empresa_id, ocorrido_em);
comment on table public.voz_chamadas is
    'Um registro por canal por tentativa (de-para do motor). Número discado só mascarado e em hash. Gravada pela VM.';
comment on column public.voz_chamadas.resultado is 'Desfecho final (motor/voz.classificar_chamada). Abandono = abandonada.';
comment on column public.voz_chamadas.codigos is 'Códigos fechados por cliente (codigos_voz_validos). Apagados junto com a gravação.';
comment on column public.voz_chamadas.custo_operadora is 'Telefonia estimada (paga à operadora). Nulo = rota sem cadastro.';

-- tarifação no encerramento (rota do dia em America/Sao_Paulo) e congelamento depois
create or replace function public.tarifar_chamada_voz() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    r public.voz_rotas;
    dia date;
    k text;
begin
    if tg_op = 'UPDATE' and old.tarifada_em is not null then
        if (new.billsec, new.tech_prefix, new.rota_id, new.segundos_tarifados, new.preco_minuto, new.custo_operadora,
            new.tarifada_em)
           is distinct from (old.billsec, old.tech_prefix, old.rota_id, old.segundos_tarifados, old.preco_minuto,
                             old.custo_operadora, old.tarifada_em) then
            raise exception 'a tarifação da chamada já foi feita e não muda';
        end if;
        return new;
    end if;
    if new.encerrada_em is null or new.billsec is null then
        new.rota_id := null; new.segundos_tarifados := null; new.preco_minuto := null; new.custo_operadora := null;
        return new;
    end if;
    dia := (coalesce(new.atendida_em, new.ocorrido_em) at time zone 'America/Sao_Paulo')::date;
    if new.tech_prefix is not null then
        r := public.rota_voz_vigente(new.empresa_id, new.tech_prefix, dia);
    end if;
    if r.id is null then
        new.rota_id := null; new.segundos_tarifados := null; new.preco_minuto := null; new.custo_operadora := null;
        k := coalesce(new.tech_prefix, 'sem_prefixo');
        insert into public.fornecedor_saude (empresa_id, item, referencia, ok, contagem, detalhe, verificado_em)
        values (new.empresa_id, 'rota_sem_cadastro', k, false, 1,
                'tentativas sem rota vigente para o tech prefix ' || k || ': sem custo calculado', now())
        on conflict ((coalesce(empresa_id, 0)), (coalesce(fornecedor, '')), (coalesce(tronco_id, 0)), item, referencia)
        do update set ok = false, contagem = fornecedor_saude.contagem + 1, verificado_em = now(),
                      detalhe = excluded.detalhe;
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
        select 'equipe', new.empresa_id, 'atencao', left('Rota de voz sem cadastro · ' || e.nome, 140),
               'Tech prefix ' || k || ' sem rota vigente: as tentativas ficam sem custo de telefonia até o cadastro.',
               '/console/voz', 'rota_sem_cadastro:' || new.empresa_id || ':' || k || ':' || dia
          from public.empresas e where e.id = new.empresa_id
        on conflict (chave) where chave is not null do nothing;
    else
        new.rota_id := r.id;
        new.preco_minuto := r.preco_minuto;
        new.segundos_tarifados := public.segundos_tarifados(new.billsec, r.cadencia_inicial_s, r.cadencia_incremento_s);
        new.custo_operadora := public.custo_voz(new.segundos_tarifados, r.preco_minuto);
    end if;
    new.tarifada_em := now();
    return new;
end $$;
revoke all on function public.tarifar_chamada_voz() from public, anon, authenticated;
drop trigger if exists tarifar_chamada_voz on public.voz_chamadas;
create trigger tarifar_chamada_voz before insert or update on public.voz_chamadas
    for each row execute function public.tarifar_chamada_voz();

alter table public.voz_lotes enable row level security;
alter table public.voz_ondas enable row level security;
alter table public.voz_chamadas enable row level security;
drop policy if exists voz_lotes_ver on public.voz_lotes;
create policy voz_lotes_ver on public.voz_lotes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_ondas_ver on public.voz_ondas;
create policy voz_ondas_ver on public.voz_ondas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_chamadas_ver on public.voz_chamadas;
create policy voz_chamadas_ver on public.voz_chamadas for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_lotes, public.voz_ondas, public.voz_chamadas from anon;
revoke insert, update, delete on public.voz_lotes, public.voz_ondas, public.voz_chamadas from authenticated;

-- ================================================================ 13. gravações (V11, V12)
create table if not exists public.voz_gravacoes (
    id                   bigint generated always as identity primary key,
    empresa_id           bigint not null references public.empresas (id) on delete cascade,
    credor_id            bigint references public.credores (id) on delete set null,
    chamada_id           bigint references public.voz_chamadas (id) on delete cascade,
    id_cliente           text not null check (char_length(id_cliente) between 1 and 60),
    id_acao              text check (char_length(id_acao) between 1 and 80),
    origem               text not null check (origem in ('ia', 'discador')),
    caminho              text not null check (char_length(caminho) <= 300 and caminho ~ '^[A-Za-z0-9_\-/.]+$'
                                              and caminho !~ '[0-9]{10,}'),
    transcricao_caminho  text check (char_length(transcricao_caminho) <= 300 and transcricao_caminho ~ '^[A-Za-z0-9_\-/.]+$'
                                     and transcricao_caminho !~ '[0-9]{10,}'),
    duracao_s            int check (duracao_s >= 0),
    gravada_em           timestamptz not null default now(),
    expira_em            timestamptz not null,
    guarda               boolean not null default false,
    guarda_motivo        text check (guarda_motivo is null or char_length(trim(guarda_motivo)) between 5 and 300),
    guarda_por           uuid references auth.users (id) on delete set null,
    guarda_em            timestamptz,
    unique (empresa_id, caminho),
    check (not guarda or guarda_motivo is not null)
);
create index if not exists voz_gravacoes_cliente on public.voz_gravacoes (empresa_id, id_cliente, gravada_em desc);
create index if not exists voz_gravacoes_expira on public.voz_gravacoes (expira_em) where not guarda;
comment on column public.voz_gravacoes.caminho is
    'Objeto no bucket da empresa (<credor>/<AAAA>/<MM>/<DD>/<id_acao>_<id_chamada>.mp3). Sem telefone nem CPF: sequência de 10+ dígitos é recusada.';
comment on column public.voz_gravacoes.guarda is 'Guarda para disputa (object hold no GCS): não expira nem é eliminada. Só o Admin tira.';

create or replace function public.validade_gravacao_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.expira_em is null then
        new.expira_em := new.gravada_em + make_interval(days => coalesce(
            (select c.retencao_dias from public.voz_config c where c.empresa_id = new.empresa_id), 90));
    end if;
    return new;
end $$;
revoke all on function public.validade_gravacao_voz() from public, anon, authenticated;
drop trigger if exists validade_gravacao_voz on public.voz_gravacoes;
create trigger validade_gravacao_voz before insert on public.voz_gravacoes
    for each row execute function public.validade_gravacao_voz();

-- a gravação apagada leva junto os códigos por cliente da chamada (decisão 14)
create or replace function public.apagar_codigos_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    update public.voz_chamadas c set codigos = null,
           tem_gravacao = exists (select 1 from public.voz_gravacoes g where g.chamada_id = c.id and g.id <> old.id)
     where c.id = old.chamada_id;
    return old;
end $$;
revoke all on function public.apagar_codigos_voz() from public, anon, authenticated;
drop trigger if exists apagar_codigos_voz on public.voz_gravacoes;
create trigger apagar_codigos_voz after delete on public.voz_gravacoes
    for each row execute function public.apagar_codigos_voz();

alter table public.voz_gravacoes enable row level security;
drop policy if exists voz_gravacoes_ver on public.voz_gravacoes;
create policy voz_gravacoes_ver on public.voz_gravacoes for select to authenticated
    using (public.admin_equipe()
           or (empresa_id in (select public.minhas_empresas()) and not public.sou_equipe()
               and public.pode('ouvir_gravacoes')));
revoke all on public.voz_gravacoes from anon;
revoke insert, update, delete on public.voz_gravacoes from authenticated;

-- ================================================================ 14. consumo de telefonia (V22) — fora da fatura
create table if not exists public.consumo_voz (
    empresa_id          bigint not null references public.empresas (id) on delete cascade,
    dia                 date not null,
    tech_prefix         text not null default '' check (tech_prefix ~ '^[0-9]{0,8}$'),   -- '' = sem prefixo
    rota_id             bigint references public.voz_rotas (id) on delete set null,
    chamadas            int not null default 0 check (chamadas >= 0),
    chamadas_atendidas  int not null default 0 check (chamadas_atendidas >= 0),
    segundos_atendidos  bigint not null default 0 check (segundos_atendidos >= 0),
    segundos_tarifados  bigint not null default 0 check (segundos_tarifados >= 0),
    custo_estimado      numeric(14, 5) check (custo_estimado >= 0),
    sem_custo           int not null default 0 check (sem_custo >= 0),
    atualizado_em       timestamptz not null default now(),
    primary key (empresa_id, dia, tech_prefix)
);
comment on table public.consumo_voz is
    'Telefonia por dia e rota (pago à operadora, só para conferência). Nunca entra em previa_fatura nem em fechar_fatura.';
alter table public.consumo_voz enable row level security;
drop policy if exists consumo_voz_ver on public.consumo_voz;
create policy consumo_voz_ver on public.consumo_voz for select to authenticated using (public.ve_faturamento(empresa_id));
revoke all on public.consumo_voz from anon;
revoke insert, update, delete on public.consumo_voz from authenticated;

create or replace view public.consumo_voz_mes with (security_invoker = true) as
select c.empresa_id, date_trunc('month', c.dia)::date as competencia, c.tech_prefix, max(c.rota_id) as rota_id,
       sum(c.chamadas)::bigint as chamadas, sum(c.chamadas_atendidas)::bigint as chamadas_atendidas,
       sum(c.segundos_atendidos)::bigint as segundos_atendidos, sum(c.segundos_tarifados)::bigint as segundos_tarifados,
       round(sum(c.segundos_tarifados) / 60.0, 2) as minutos_tarifados,
       sum(c.custo_estimado) as custo_estimado, sum(c.sem_custo)::bigint as sem_custo
  from public.consumo_voz c
 group by c.empresa_id, date_trunc('month', c.dia), c.tech_prefix;
revoke all on public.consumo_voz_mes from anon;
grant select on public.consumo_voz_mes to authenticated;

-- a VM consolida o dia a partir das chamadas (recalcula o dia inteiro; pode rodar de novo)
create or replace function public.consolidar_consumo_voz(empresa bigint, dia date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor consolida o consumo de voz';
    end if;
    delete from public.consumo_voz c where c.empresa_id = empresa and c.dia = consolidar_consumo_voz.dia;
    insert into public.consumo_voz (empresa_id, dia, tech_prefix, rota_id, chamadas, chamadas_atendidas,
                                    segundos_atendidos, segundos_tarifados, custo_estimado, sem_custo)
    select empresa, consolidar_consumo_voz.dia, coalesce(v.tech_prefix, ''), max(v.rota_id), count(*),
           count(*) filter (where coalesce(v.billsec, 0) > 0), coalesce(sum(v.billsec), 0),
           coalesce(sum(v.segundos_tarifados), 0), sum(v.custo_operadora),
           count(*) filter (where v.rota_id is null and coalesce(v.billsec, 0) > 0)
      from public.voz_chamadas v
     where v.empresa_id = empresa and v.tarifada_em is not null and v.modo <> 'simulado'
       and (coalesce(v.atendida_em, v.ocorrido_em) at time zone 'America/Sao_Paulo')::date = consolidar_consumo_voz.dia
     group by coalesce(v.tech_prefix, '');
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function public.consolidar_consumo_voz(bigint, date) from public, anon, authenticated;
grant execute on function public.consolidar_consumo_voz(bigint, date) to service_role;

-- exportação para conferir com a fatura da operadora: uma linha por dia e rota
create or replace function public.telefonia_csv(empresa bigint, competencia date)
returns table (dia date, tech_prefix text, tipo text, tronco text, cadencia text, preco_minuto numeric, chamadas int,
               chamadas_atendidas int, segundos_atendidos bigint, segundos_tarifados bigint, custo_estimado numeric,
               sem_custo int)
language plpgsql stable security definer set search_path = public as $$
begin
    if not public.ve_faturamento(empresa) then
        raise exception 'sem permissão para ver o faturamento desta empresa';
    end if;
    return query
    select c.dia, c.tech_prefix, r.tipo, t.referencia,
           case when r.id is null then null else r.cadencia_inicial_s || '/' || r.cadencia_incremento_s end,
           r.preco_minuto, c.chamadas, c.chamadas_atendidas, c.segundos_atendidos, c.segundos_tarifados,
           c.custo_estimado, c.sem_custo
      from public.consumo_voz c
      left join public.voz_rotas r on r.id = c.rota_id
      left join public.voz_troncos t on t.id = r.tronco_id
     where c.empresa_id = empresa and c.dia >= date_trunc('month', competencia)::date
       and c.dia < (date_trunc('month', competencia) + interval '1 month')::date
     order by c.dia, c.tech_prefix;
end $$;
revoke all on function public.telefonia_csv(bigint, date) from public, anon;
grant execute on function public.telefonia_csv(bigint, date) to authenticated;

-- ================================================================ 15. insights (V13, V14, V15) — só agregados
create table if not exists public.voz_insights_dia (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint not null default 0,
    data        date not null,
    origem      text not null check (origem in ('ia', 'discador')),
    persona     text not null default '' check (char_length(persona) <= 60),
    regua       text not null default '' check (char_length(regua) <= 40),
    campo       text not null check (campo in ('conversas', 'motivo', 'objecao', 'promessa', 'retorno', 'nao_ligar')),
    valor       text not null check (valor ~ '^[a-z0-9_]{1,40}$'),
    qtd         int not null check (qtd >= 0),
    primary key (empresa_id, credor_id, data, origem, persona, regua, campo, valor)
);
comment on table public.voz_insights_dia is 'Agregados de voz por dia (só contagens). campo conversas/valor total = base do grupo.';

create table if not exists public.voz_resultado_por_motivo (
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint not null default 0,
    data        date not null,
    motivo      text not null check (motivo ~ '^[a-z0-9_]{1,40}$'),
    conversas   int not null default 0 check (conversas >= 0),
    promessas   int not null default 0 check (promessas >= 0),
    pagamentos  int not null default 0 check (pagamentos >= 0),
    primary key (empresa_id, credor_id, data, motivo)
);
comment on table public.voz_resultado_por_motivo is 'Realizado por motivo (Propensão em sombra). Gravado pela VM.';
alter table public.voz_insights_dia enable row level security;
alter table public.voz_resultado_por_motivo enable row level security;
drop policy if exists voz_insights_ver on public.voz_insights_dia;
create policy voz_insights_ver on public.voz_insights_dia for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_resultado_motivo_ver on public.voz_resultado_por_motivo;
create policy voz_resultado_motivo_ver on public.voz_resultado_por_motivo for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_insights_dia, public.voz_resultado_por_motivo from anon;
revoke insert, update, delete on public.voz_insights_dia, public.voz_resultado_por_motivo from authenticated;

-- soma no servidor; grupo com menos de 30 conversas não mostra quantidade nem percentual
create or replace function public.insights_voz(credor bigint, de date, ate date, persona text default null,
                                               origem text default null)
returns table (campo text, valor text, qtd bigint, conversas bigint, pct numeric)
language sql stable security invoker set search_path = public as $$
    with base as (
        select i.* from public.voz_insights_dia i
         where i.credor_id = coalesce(credor, 0) and i.data between de and ate
           and (insights_voz.persona is null or i.persona = insights_voz.persona)
           and (insights_voz.origem is null or i.origem = insights_voz.origem)
    ),
    tot as (select coalesce(sum(b.qtd), 0) as n from base b where b.campo = 'conversas')
    select b.campo, b.valor,
           case when tot.n >= 30 then sum(b.qtd) end::bigint,
           tot.n::bigint,
           case when tot.n >= 30 then round(100.0 * sum(b.qtd) / tot.n, 1) end
      from base b cross join tot
     where b.campo <> 'conversas'
     group by b.campo, b.valor, tot.n
     order by b.campo, sum(b.qtd) desc
$$;
revoke all on function public.insights_voz(bigint, date, date, text, text) from public, anon;
grant execute on function public.insights_voz(bigint, date, date, text, text) to authenticated;

-- ================================================================ 16. pedidos do titular (V17)
create table if not exists public.titular_pedidos (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    id_cliente    text not null check (char_length(id_cliente) between 1 and 60),
    tipo          text not null check (tipo in ('exportar', 'eliminar')),
    aberto_por    uuid default auth.uid() references auth.users (id) on delete set null,
    aberto_em     timestamptz not null default now(),
    prazo         date not null default ((now() at time zone 'America/Sao_Paulo')::date + 15),
    situacao      text not null default 'aberto' check (situacao in ('aberto', 'em_execucao', 'concluido', 'recusado')),
    arquivo       text check (char_length(arquivo) <= 300 and arquivo ~ '^[A-Za-z0-9_\-/.]+$'),
    concluido_em  timestamptz,
    check ((situacao in ('concluido', 'recusado')) = (concluido_em is not null))
);
comment on table public.titular_pedidos is 'Pedido do titular (LGPD) aberto pelo ID do cliente, nunca por nome ou CPF. Prazo de 15 dias. A VM executa.';
alter table public.titular_pedidos enable row level security;
drop policy if exists titular_pedidos_ver on public.titular_pedidos;
create policy titular_pedidos_ver on public.titular_pedidos for select to authenticated
    using (empresa_id in (select public.minhas_empresas()) and (public.sou_equipe() or public.tem_papel('admin')));
revoke all on public.titular_pedidos from anon;
revoke insert, update, delete on public.titular_pedidos from authenticated;

-- ================================================================ 17. importação de gravações do discador (V18, V19)
create table if not exists public.voz_import_config (
    id             bigint generated always as identity primary key,
    empresa_id     bigint not null references public.empresas (id) on delete cascade,
    adaptador      text not null check (adaptador in ('aspect', 'olos', '2cx', '3cplus', 'totalip', 'tactium', 'fastway',
                                                      'generico')),
    forma          text not null check (forma in ('sftp', 'url', 'api', 'arquivo')),
    segredo_ref    text check (segredo_ref ~ '^[A-Za-z0-9_\-/.]{1,120}$'),
    pasta          text check (pasta ~ '^[A-Za-z0-9_\-/.]{1,200}$'),
    dominios_url   text[] not null default '{}'
                   check (array_to_string(dominios_url, ',') ~ '^([a-z0-9.\-]{3,253}(,[a-z0-9.\-]{3,253})*)?$'),
    transcrever    boolean not null default false,
    ativo          boolean not null default true,
    cadastrado_por uuid default auth.uid() references auth.users (id) on delete set null,
    cadastrado_em  timestamptz not null default now(),
    unique (empresa_id, adaptador),
    check (forma = 'arquivo' or segredo_ref is not null)
);
create table if not exists public.voz_import_execucoes (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    config_id     bigint not null references public.voz_import_config (id) on delete cascade,
    iniciada_em   timestamptz not null default now(),
    terminada_em  timestamptz,
    lidas         int not null default 0 check (lidas >= 0),
    casadas       int not null default 0 check (casadas >= 0),
    quarentena    int not null default 0 check (quarentena >= 0),
    erro          text check (erro is null or char_length(erro) <= 300)
);
create table if not exists public.voz_import_quarentena (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    execucao_id   bigint not null references public.voz_import_execucoes (id) on delete cascade,
    ref_gravacao  text not null check (ref_gravacao ~ '^[A-Za-z0-9_.:\-]{1,120}$' and ref_gravacao !~ '[0-9]{10,}'),
    motivo        text not null check (motivo in ('sem_par', 'par_ambiguo', 'nome_com_dado_pessoal', 'formato', 'outro')),
    criado_em     timestamptz not null default now()
);
comment on column public.voz_import_quarentena.ref_gravacao is 'ID da gravação no discador (nunca o nome do arquivo).';
alter table public.voz_import_config enable row level security;
alter table public.voz_import_execucoes enable row level security;
alter table public.voz_import_quarentena enable row level security;
drop policy if exists voz_import_config_ver on public.voz_import_config;
create policy voz_import_config_ver on public.voz_import_config for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_import_execucoes_ver on public.voz_import_execucoes;
create policy voz_import_execucoes_ver on public.voz_import_execucoes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_import_quarentena_ver on public.voz_import_quarentena;
create policy voz_import_quarentena_ver on public.voz_import_quarentena for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_import_config, public.voz_import_execucoes, public.voz_import_quarentena from anon;
revoke insert, update, delete on public.voz_import_config, public.voz_import_execucoes, public.voz_import_quarentena
    from authenticated;

-- ================================================================ 18. pedido de ligações reais (V4)
alter table public.pedidos_envio_real add column if not exists canal text not null default 'mensageria'
    check (canal in ('mensageria', 'agente_voz'));
drop index if exists public.pedidos_envio_real_aberto;
create unique index if not exists pedidos_envio_real_aberto_canal on public.pedidos_envio_real (empresa_id, canal)
    where situacao = 'aberto';
-- as funções da Mensageria passam a olhar só o canal delas
select pg_temp.trocar('public.pedir_envio_real(bigint)',
    $a$if exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa and r.situacao = 'aberto') then$a$,
    $b$if exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa and r.situacao = 'aberto' and r.canal = 'mensageria') then$b$);
select pg_temp.trocar('public.ligar_envio_real(bigint)',
    $a$where empresa_id = empresa and situacao = 'aberto' returning * into r;$a$,
    $b$where empresa_id = empresa and situacao = 'aberto' and canal = 'mensageria' returning * into r;$b$);
select pg_temp.trocar('public.recusar_envio_real(bigint,text)',
    $a$where p.empresa_id = empresa and p.situacao = 'aberto' returning * into r;$a$,
    $b$where p.empresa_id = empresa and p.situacao = 'aberto' and p.canal = 'mensageria' returning * into r;$b$);
select pg_temp.trocar('public.primeiros_passos(bigint)',
    $a$exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa
                            and r.situacao in ('aberto', 'ligado')), false),$a$,
    $b$exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa and r.canal = 'mensageria'
                            and r.situacao in ('aberto', 'ligado')), false),$b$);

-- ================================================================ 19. RPCs: configuração
-- equipe (gerenciar_troncos_voz): provedor, agent_id, voz_id, pico_multiplo, alo_fake_liberado, numeros_teste_hash,
-- bucket_gravacoes
create or replace function public.configurar_voz_equipe(empresa bigint, ajustes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
    if not public.cuida_voz(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz configura o provedor';
    end if;
    if jsonb_typeof(ajustes) is distinct from 'object' then
        raise exception 'ajustes inválidos';
    end if;
    for k in select jsonb_object_keys(ajustes) loop
        if k not in ('provedor', 'agent_id', 'voz_id', 'pico_multiplo', 'alo_fake_liberado', 'numeros_teste_hash',
                     'bucket_gravacoes') then
            raise exception 'ajuste desconhecido ou fora da equipe: %', k;
        end if;
    end loop;
    insert into public.voz_config (empresa_id) values (empresa) on conflict (empresa_id) do nothing;
    update public.voz_config c set
        provedor = case when ajustes ? 'provedor' then ajustes ->> 'provedor' else c.provedor end,
        agent_id = case when ajustes ? 'agent_id' then ajustes ->> 'agent_id' else c.agent_id end,
        voz_id = case when ajustes ? 'voz_id' then ajustes ->> 'voz_id' else c.voz_id end,
        bucket_gravacoes = case when ajustes ? 'bucket_gravacoes' then ajustes ->> 'bucket_gravacoes' else c.bucket_gravacoes end,
        pico_multiplo = case when ajustes ? 'pico_multiplo' then (ajustes ->> 'pico_multiplo')::int else c.pico_multiplo end,
        alo_fake_liberado = case when ajustes ? 'alo_fake_liberado' then (ajustes ->> 'alo_fake_liberado')::boolean
                                 else c.alo_fake_liberado end,
        alo_fake = case when ajustes ? 'alo_fake_liberado' and not (ajustes ->> 'alo_fake_liberado')::boolean then false
                        else c.alo_fake end,
        numeros_teste_hash = case when ajustes ? 'numeros_teste_hash'
                                  then array(select lower(x) from jsonb_array_elements_text(ajustes -> 'numeros_teste_hash') x)
                                  else c.numeros_teste_hash end,
        atualizado_em = now(), atualizado_por = auth.uid()
     where c.empresa_id = empresa;
end $$;
revoke all on function public.configurar_voz_equipe(bigint, jsonb) from public, anon;
grant execute on function public.configurar_voz_equipe(bigint, jsonb) to authenticated;

-- empresa: operação (editar_canais) e privacidade (Admin). A equipe MotorCX não chama.
create or replace function public.configurar_voz_empresa(empresa bigint, ajustes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
    k text;
    c public.voz_config;
begin
    if public.sou_equipe() or empresa not in (select public.minhas_empresas()) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if jsonb_typeof(ajustes) is distinct from 'object' then
        raise exception 'ajustes inválidos';
    end if;
    for k in select jsonb_object_keys(ajustes) loop
        if k in ('alo_fake', 'alo_fake_max_s', 'alo_fake_audio_ref', 'abandono_max_pct', 'freio_ritmo_pct', 'variaveis') then
            if not public.pode('editar_canais') then
                raise exception 'sem permissão para editar canais';
            end if;
        elsif k in ('gravar', 'aviso_gravacao', 'retencao_dias', 'transcrever', 'transcrever_min_segundos') then
            if not public.tem_papel('admin') then
                raise exception 'só o Admin da empresa muda a privacidade das gravações';
            end if;
        else
            raise exception 'ajuste desconhecido ou da equipe MotorCX: %', k;
        end if;
    end loop;
    insert into public.voz_config (empresa_id) values (empresa) on conflict (empresa_id) do nothing;
    select * into c from public.voz_config where empresa_id = empresa;
    if coalesce((ajustes ->> 'alo_fake')::boolean, false) and not c.alo_fake_liberado then
        raise exception 'o Alô fake ainda não foi liberado pela equipe MotorCX';
    end if;
    update public.voz_config v set
        alo_fake = case when ajustes ? 'alo_fake' then (ajustes ->> 'alo_fake')::boolean else v.alo_fake end,
        alo_fake_max_s = case when ajustes ? 'alo_fake_max_s' then (ajustes ->> 'alo_fake_max_s')::int else v.alo_fake_max_s end,
        alo_fake_audio_ref = case when ajustes ? 'alo_fake_audio_ref' then ajustes ->> 'alo_fake_audio_ref'
                                  else v.alo_fake_audio_ref end,
        abandono_max_pct = case when ajustes ? 'abandono_max_pct' then (ajustes ->> 'abandono_max_pct')::numeric
                                else v.abandono_max_pct end,
        freio_ritmo_pct = case when ajustes ? 'freio_ritmo_pct' then (ajustes ->> 'freio_ritmo_pct')::int else v.freio_ritmo_pct end,
        variaveis = case when ajustes ? 'variaveis' then array(select jsonb_array_elements_text(ajustes -> 'variaveis'))
                         else v.variaveis end,
        gravar = case when ajustes ? 'gravar' then (ajustes ->> 'gravar')::boolean else v.gravar end,
        aviso_gravacao = case when ajustes ? 'aviso_gravacao' then (ajustes ->> 'aviso_gravacao')::boolean else v.aviso_gravacao end,
        retencao_dias = case when ajustes ? 'retencao_dias' then (ajustes ->> 'retencao_dias')::int else v.retencao_dias end,
        transcrever = case when ajustes ? 'transcrever' then (ajustes ->> 'transcrever')::boolean else v.transcrever end,
        transcrever_min_segundos = case when ajustes ? 'transcrever_min_segundos'
                                        then (ajustes ->> 'transcrever_min_segundos')::int else v.transcrever_min_segundos end,
        atualizado_em = now(), atualizado_por = auth.uid()
     where v.empresa_id = empresa;
    if ajustes ? 'retencao_dias' then        -- nova retenção vale para o que já está guardado
        update public.voz_gravacoes g
           set expira_em = g.gravada_em + make_interval(days => (ajustes ->> 'retencao_dias')::int)
         where g.empresa_id = empresa;
    end if;
end $$;
revoke all on function public.configurar_voz_empresa(bigint, jsonb) from public, anon;
grant execute on function public.configurar_voz_empresa(bigint, jsonb) to authenticated;

-- ================================================================ 20. RPCs: roteiro (V6)
-- cria ou edita. Rascunho edita no lugar; aprovado ou em uso vira uma versão nova (rascunho).
create or replace function public.salvar_roteiro_voz(empresa bigint, credor bigint, prompt text, primeira_fala text,
                                                     tipo_agente text, regras_transferencia jsonb default null,
                                                     apresentar_virtual boolean default false, roteiro bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    atual public.voz_roteiros;
    regras jsonb := regras_transferencia;
    rid bigint;
begin
    if public.sou_equipe() or empresa not in (select public.minhas_empresas()) or not public.pode('editar_canais') then
        raise exception 'sem permissão para editar o roteiro do agente virtual';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if regras is null then
        regras := jsonb_build_object('cpc', tipo_agente = 'localizador', 'pedido_humano', true,
                                     'ofertas_sem_acordo', case when tipo_agente = 'localizador' then 0 else 2 end,
                                     'fora_alcada', true, 'contestacao', true);
    end if;
    if roteiro is not null then
        select * into atual from public.voz_roteiros r
         where r.id = roteiro and r.empresa_id = empresa and r.credor_id is not distinct from credor;
        if atual.id is null then
            raise exception 'roteiro não encontrado';
        end if;
        if atual.situacao = 'rascunho' then
            update public.voz_roteiros r set prompt = salvar_roteiro_voz.prompt, primeira_fala = salvar_roteiro_voz.primeira_fala,
                   tipo_agente = salvar_roteiro_voz.tipo_agente, regras_transferencia = regras,
                   apresentar_virtual = coalesce(salvar_roteiro_voz.apresentar_virtual, false), atualizado_em = now()
             where r.id = atual.id;
            return atual.id;
        end if;
    end if;
    insert into public.voz_roteiros (empresa_id, credor_id, versao, prompt, primeira_fala, tipo_agente,
                                     regras_transferencia, apresentar_virtual)
    values (empresa, credor,
            coalesce((select max(r.versao) from public.voz_roteiros r
                       where r.empresa_id = empresa and r.credor_id is not distinct from credor), 0) + 1,
            salvar_roteiro_voz.prompt, salvar_roteiro_voz.primeira_fala, salvar_roteiro_voz.tipo_agente, regras,
            coalesce(salvar_roteiro_voz.apresentar_virtual, false))
    returning id into rid;
    return rid;
end $$;
revoke all on function public.salvar_roteiro_voz(bigint, bigint, text, text, text, jsonb, boolean, bigint) from public, anon;
grant execute on function public.salvar_roteiro_voz(bigint, bigint, text, text, text, jsonb, boolean, bigint) to authenticated;

-- uma etapa por vez: rascunho → aprovado_empresa → em_uso (a versão em uso anterior é arquivada)
create or replace function public.aprovar_roteiro_voz(roteiro bigint, etapa text, parecer text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.voz_roteiros;
begin
    select * into r from public.voz_roteiros where id = roteiro;
    if r.id is null or public.sou_equipe() or r.empresa_id not in (select public.minhas_empresas()) then
        raise exception 'roteiro não encontrado';
    end if;
    if not public.pode('aprovar_roteiro_voz') then
        raise exception 'sem permissão para aprovar o roteiro';
    end if;
    if not ((r.situacao = 'rascunho' and etapa = 'aprovado_empresa') or (r.situacao = 'aprovado_empresa' and etapa = 'em_uso')) then
        raise exception 'o roteiro está em %: só avança uma etapa por vez', replace(r.situacao, '_', ' ');
    end if;
    if etapa = 'aprovado_empresa' then
        update public.voz_roteiros v set situacao = 'aprovado_empresa', aprovado_por = auth.uid(), aprovado_em = now(),
               parecer = coalesce(nullif(trim(aprovar_roteiro_voz.parecer), ''), v.parecer), atualizado_em = now()
         where v.id = roteiro;
    else
        update public.voz_roteiros v set situacao = 'arquivado', atualizado_em = now()
         where v.empresa_id = r.empresa_id and v.credor_id is not distinct from r.credor_id and v.situacao = 'em_uso';
        update public.voz_roteiros v set situacao = 'em_uso', em_uso_por = auth.uid(), em_uso_em = now(),
               parecer = coalesce(nullif(trim(aprovar_roteiro_voz.parecer), ''), v.parecer), atualizado_em = now()
         where v.id = roteiro;
    end if;
    return etapa;
end $$;
revoke all on function public.aprovar_roteiro_voz(bigint, text, text) from public, anon;
grant execute on function public.aprovar_roteiro_voz(bigint, text, text) to authenticated;

-- ================================================================ 21. RPCs da equipe: troncos, rotas, transferência, contrato
drop function if exists public.cadastrar_tronco_voz(bigint, text, text, text, int, text, text, int, text, int, text[], text, boolean);
create or replace function public.cadastrar_tronco_voz(empresa bigint, referencia text, operadora text, host text,
                                                       canais int, autenticacao text, ddd_origem text, bina text,
                                                       segredo_ref text default null, usuario text default null,
                                                       porta int default 5060, transporte text default 'udp',
                                                       cps int default 10, codecs text[] default '{alaw,ulaw}',
                                                       formato_discagem text default 'tech_ddd_numero',
                                                       ativo boolean default true)
returns bigint
language plpgsql security definer set search_path = public as $$
declare tid bigint;
begin
    if not public.cuida_voz(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz cadastra tronco';
    end if;
    insert into public.voz_troncos as t (empresa_id, referencia, operadora, host, porta, transporte, autenticacao,
                                         usuario, segredo_ref, ddd_origem, bina, formato_discagem, codecs, canais, cps,
                                         ativo)
    values (empresa, lower(trim(referencia)), trim(operadora), lower(trim(host)), porta, transporte, autenticacao,
            nullif(trim(usuario), ''), nullif(trim(segredo_ref), ''), trim(ddd_origem),
            regexp_replace(coalesce(bina, ''), '\D', '', 'g'), coalesce(formato_discagem, 'tech_ddd_numero'), codecs,
            canais, cps, coalesce(ativo, true))
    on conflict on constraint voz_troncos_empresa_id_referencia_key do update
        set operadora = excluded.operadora, host = excluded.host, porta = excluded.porta,
            transporte = excluded.transporte, autenticacao = excluded.autenticacao, segredo_ref = excluded.segredo_ref,
            codecs = excluded.codecs, canais = excluded.canais, cps = excluded.cps, usuario = excluded.usuario,
            ddd_origem = excluded.ddd_origem, bina = excluded.bina, formato_discagem = excluded.formato_discagem,
            ativo = excluded.ativo, atualizado_em = now(),
            -- mudou como conecta: precisa de teste de novo
            testado_em = case when (t.host, t.porta, t.transporte, t.autenticacao, t.usuario, t.segredo_ref, t.bina, t.formato_discagem)
                                   is distinct from (excluded.host, excluded.porta, excluded.transporte,
                                                     excluded.autenticacao, excluded.usuario, excluded.segredo_ref,
                                                     excluded.bina, excluded.formato_discagem)
                              then null else t.testado_em end,
            teste_ok = case when (t.host, t.porta, t.transporte, t.autenticacao, t.usuario, t.segredo_ref, t.bina, t.formato_discagem)
                                 is distinct from (excluded.host, excluded.porta, excluded.transporte,
                                                   excluded.autenticacao, excluded.usuario, excluded.segredo_ref,
                                                   excluded.bina, excluded.formato_discagem)
                            then null else t.teste_ok end
    returning t.id into tid;
    return tid;
end $$;
revoke all on function public.cadastrar_tronco_voz(bigint, text, text, text, int, text, text, text, text, text, int, text, int, text[], text, boolean)
    from public, anon;
grant execute on function public.cadastrar_tronco_voz(bigint, text, text, text, int, text, text, text, text, text, int, text, int, text[], text, boolean)
    to authenticated;

-- vigência nova para o tech prefix: fecha a anterior no dia de antes. Sem carência: vale a partir de "desde".
create or replace function public.salvar_rota_voz(empresa bigint, tronco bigint, tech_prefix text, tipo text,
                                                  prioridade int, cadencia_inicial_s int, cadencia_incremento_s int,
                                                  preco_minuto numeric, desde date default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    d date := coalesce(desde, (now() at time zone 'America/Sao_Paulo')::date);
    ant public.voz_rotas;
    rid bigint;
begin
    if not public.cuida_voz(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz cadastra rotas';
    end if;
    if not exists (select 1 from public.voz_troncos t where t.id = tronco and t.empresa_id = empresa and t.ativo) then
        raise exception 'tronco não encontrado ou inativo nesta empresa';
    end if;
    select * into ant from public.voz_rotas r
     where r.empresa_id = empresa and r.tech_prefix = salvar_rota_voz.tech_prefix
     order by r.vigente_desde desc limit 1;
    if ant.id is not null then
        if ant.vigente_desde >= d then
            raise exception 'a nova vigência precisa começar depois de % (vigência atual)', to_char(ant.vigente_desde, 'DD/MM/YYYY');
        end if;
        if ant.vigente_ate is null or ant.vigente_ate >= d then
            update public.voz_rotas r set vigente_ate = d - 1 where r.id = ant.id;
        end if;
    end if;
    insert into public.voz_rotas (empresa_id, tronco_id, prioridade, tech_prefix, tipo, cadencia_inicial_s,
                                  cadencia_incremento_s, preco_minuto, vigente_desde)
    values (empresa, tronco, prioridade, salvar_rota_voz.tech_prefix, tipo, cadencia_inicial_s, cadencia_incremento_s,
            preco_minuto, d)
    returning id into rid;
    return rid;
end $$;
revoke all on function public.salvar_rota_voz(bigint, bigint, text, text, int, int, int, numeric, date) from public, anon;
grant execute on function public.salvar_rota_voz(bigint, bigint, text, text, int, int, int, numeric, date) to authenticated;

create or replace function public.encerrar_rota_voz(rota bigint, ate date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
    r public.voz_rotas;
    a date := coalesce(ate, (now() at time zone 'America/Sao_Paulo')::date);
begin
    select * into r from public.voz_rotas where id = rota;
    if r.id is null or not public.cuida_voz(r.empresa_id) then
        raise exception 'rota não encontrada';
    end if;
    if a < r.vigente_desde then
        raise exception 'a rota começa em %', to_char(r.vigente_desde, 'DD/MM/YYYY');
    end if;
    update public.voz_rotas v set vigente_ate = a where v.id = rota;
end $$;
revoke all on function public.encerrar_rota_voz(bigint, date) from public, anon;
grant execute on function public.encerrar_rota_voz(bigint, date) to authenticated;

create or replace function public.salvar_transferencia_voz(empresa bigint, nome text, destino_sip text,
                                                           metodo text default 'refer', tronco bigint default null,
                                                           tech_prefix text default null, credor bigint default null,
                                                           ativo boolean default true, transferencia bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare tid bigint := transferencia;
begin
    if not public.cuida_voz(empresa) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz configura a transferência';
    end if;
    if credor is not null and not exists (select 1 from public.credores c where c.id = credor and c.empresa_id = empresa) then
        raise exception 'carteira não encontrada';
    end if;
    if tid is null then
        insert into public.voz_transferencias (empresa_id, credor_id, nome, destino_sip, metodo, tronco_id, tech_prefix, ativo)
        values (empresa, credor, trim(nome), trim(destino_sip), metodo, tronco, tech_prefix, coalesce(ativo, true))
        returning id into tid;
    else
        update public.voz_transferencias v
           set credor_id = credor, nome = trim(salvar_transferencia_voz.nome),
               destino_sip = trim(salvar_transferencia_voz.destino_sip), metodo = salvar_transferencia_voz.metodo,
               tronco_id = tronco, tech_prefix = salvar_transferencia_voz.tech_prefix,
               ativo = coalesce(salvar_transferencia_voz.ativo, true), atualizado_em = now(),
               testado_em = case when v.destino_sip = trim(salvar_transferencia_voz.destino_sip) then v.testado_em end,
               teste_ok = case when v.destino_sip = trim(salvar_transferencia_voz.destino_sip) then v.teste_ok end
         where v.id = tid and v.empresa_id = empresa;
        if not found then
            raise exception 'transferência não encontrada';
        end if;
    end if;
    return tid;
end $$;
revoke all on function public.salvar_transferencia_voz(bigint, text, text, text, bigint, text, bigint, boolean, bigint)
    from public, anon;
grant execute on function public.salvar_transferencia_voz(bigint, text, text, text, bigint, text, bigint, boolean, bigint)
    to authenticated;

create or replace function public.definir_concorrencia_contratada(n int) returns void
language plpgsql security definer set search_path = public as $$
begin
    if not (public.admin_equipe() or public.equipe_pode('gerenciar_troncos_voz', null)) then
        raise exception 'só a equipe MotorCX com a permissão de troncos de voz define a concorrência';
    end if;
    if n is null or n < 0 then
        raise exception 'concorrência inválida';
    end if;
    update public.voz_contrato set concorrencia_contratada = n, atualizado_por = auth.uid(), atualizado_em = now()
     where id;
end $$;
revoke all on function public.definir_concorrencia_contratada(int) from public, anon;
grant execute on function public.definir_concorrencia_contratada(int) to authenticated;

create or replace function public.salvar_importacao_voz(empresa bigint, adaptador text, forma text,
                                                        segredo_ref text default null, pasta text default null,
                                                        dominios_url text[] default '{}', transcrever boolean default false,
                                                        ativo boolean default true)
returns bigint
language plpgsql security definer set search_path = public as $$
declare iid bigint;
begin
    if not public.cuida_voz(empresa) then
        raise exception 'só a equipe MotorCX configura a importação de gravações';
    end if;
    insert into public.voz_import_config as v (empresa_id, adaptador, forma, segredo_ref, pasta, dominios_url, transcrever, ativo)
    values (empresa, adaptador, forma, nullif(trim(segredo_ref), ''), nullif(trim(pasta), ''), coalesce(dominios_url, '{}'),
            coalesce(transcrever, false), coalesce(ativo, true))
    on conflict on constraint voz_import_config_empresa_id_adaptador_key do update
        set forma = excluded.forma, segredo_ref = excluded.segredo_ref, pasta = excluded.pasta,
            dominios_url = excluded.dominios_url, transcrever = excluded.transcrever, ativo = excluded.ativo
    returning v.id into iid;
    return iid;
end $$;
revoke all on function public.salvar_importacao_voz(bigint, text, text, text, text, text[], boolean, boolean) from public, anon;
grant execute on function public.salvar_importacao_voz(bigint, text, text, text, text, text[], boolean, boolean) to authenticated;

-- ================================================================ 22. RPCs: Simulado → Só números de teste → Real
-- o que falta para um modo (texto vazio = pronto). Conferido no servidor.
create or replace function public.falta_para_voz(empresa bigint, modo text) returns text
language sql stable security definer set search_path = public as $$
    select nullif(concat_ws(', ',
        case when not exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.provedor <> 'simulador')
             then 'escolher o provedor de voz' end,
        case when not exists (select 1 from public.voz_roteiros r where r.empresa_id = empresa and r.situacao = 'em_uso')
             then 'roteiro em uso' end,
        case when not exists (select 1 from public.voz_troncos t where t.empresa_id = empresa and t.ativo and t.teste_ok)
             then 'tronco ativo e testado' end,
        case when not exists (select 1 from public.voz_rotas r where r.empresa_id = empresa
                               and (r.vigente_ate is null or r.vigente_ate >= (now() at time zone 'America/Sao_Paulo')::date))
             then 'rota cadastrada' end,
        case when exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.gravar
                           and c.bucket_gravacoes is null)
             then 'bucket de gravações da empresa' end,
        case when modo = 'teste' and not exists (select 1 from public.voz_config c where c.empresa_id = empresa
                                                  and cardinality(c.numeros_teste_hash) > 0)
             then 'números de teste' end,
        case when modo = 'real' and not exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.modo = 'teste')
             then 'passar antes por só números de teste' end,
        case when modo = 'real' and not exists (select 1 from public.voz_chamadas v where v.empresa_id = empresa and v.modo = 'teste')
             then 'ligação de teste feita' end,
        case when modo = 'real' and not exists (select 1 from public.empresa_contatos c where c.empresa_id = empresa and c.recebe_faturas)
             then 'quem recebe as faturas' end
    ), '')
$$;
revoke all on function public.falta_para_voz(bigint, text) from public, anon, authenticated;

create or replace function public.pedir_voz_real(empresa bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    falta text;
    ch bigint;
    pid bigint;
begin
    if public.sou_equipe() or empresa not in (select public.minhas_empresas()) then
        raise exception 'empresa fora do seu acesso';
    end if;
    if not public.pode('editar_canais') then
        raise exception 'só quem edita canais pede as ligações reais';
    end if;
    if exists (select 1 from public.voz_config c where c.empresa_id = empresa and c.modo = 'real') then
        raise exception 'as ligações reais já estão ligadas';
    end if;
    if exists (select 1 from public.pedidos_envio_real r where r.empresa_id = empresa and r.canal = 'agente_voz'
                                                         and r.situacao = 'aberto') then
        raise exception 'já existe um pedido em aberto';
    end if;
    falta := public.falta_para_voz(empresa, 'real');
    if falta is not null then
        raise exception 'antes de pedir: %', falta;
    end if;
    insert into public.chamados (empresa_id, motivo, assunto, prioridade)
    values (empresa, 'integracao', 'Ligar as ligações reais do agente virtual', 'alta') returning id into ch;
    insert into public.chamado_mensagens (chamado_id, tipo, texto)
    values (ch, 'cliente', 'Pedido de ligações reais do agente virtual. Conferido: roteiro em uso, tronco testado, '
                           || 'rota cadastrada, ligação de teste e quem recebe as faturas.');
    insert into public.pedidos_envio_real (empresa_id, chamado_id, canal) values (empresa, ch, 'agente_voz') returning id into pid;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    select 'equipe', empresa, 'atencao', left('Pedido de ligações reais · ' || e.nome, 140),
           'Conferir e ligar o agente de voz.', '/console/implantacao', 'voz_real:' || pid
      from public.empresas e where e.id = empresa;
    return pid;
end $$;
revoke all on function public.pedir_voz_real(bigint) from public, anon;
grant execute on function public.pedir_voz_real(bigint) to authenticated;

-- a equipe (ligar_voz_real) muda o modo: 'teste' (só números de teste), 'real' ou de volta para 'simulado'
create or replace function public.ligar_voz_real(empresa bigint, modo text default 'real') returns text
language plpgsql security definer set search_path = public as $$
declare
    falta text;
    r public.pedidos_envio_real;
begin
    if not public.sou_equipe() or not public.pode_equipe('ligar_voz_real') or not public.pode_ver_empresa(empresa) then
        raise exception 'sem permissão para ligar as ligações reais';
    end if;
    if modo not in ('simulado', 'teste', 'real') then
        raise exception 'modo inválido: simulado, teste ou real';
    end if;
    if modo <> 'simulado' then
        falta := public.falta_para_voz(empresa, modo);
        if falta is not null then
            raise exception 'falta: %', falta;
        end if;
    end if;
    insert into public.voz_config (empresa_id) values (empresa) on conflict (empresa_id) do nothing;
    update public.voz_config c set modo = ligar_voz_real.modo, atualizado_em = now(), atualizado_por = auth.uid()
     where c.empresa_id = empresa;
    if modo = 'real' then
        update public.pedidos_envio_real p set situacao = 'ligado', resolvido_por = auth.uid(), resolvido_em = now()
         where p.empresa_id = empresa and p.canal = 'agente_voz' and p.situacao = 'aberto' returning * into r;
        if r.chamado_id is not null then
            insert into public.chamado_mensagens (chamado_id, tipo, texto)
            values (r.chamado_id, 'equipe', 'Ligações reais do agente virtual ligadas. O minuto de IA entra na fatura.');
            update public.chamados set situacao = 'resolvido', atualizado_em = now() where id = r.chamado_id;
        end if;
        insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
        values ('empresa', empresa, 'pronto', 'Ligações reais do agente virtual ligadas',
                'O agente passa a ligar de verdade pelos troncos da empresa. O minuto de IA entra na fatura.', '/canais');
    end if;
    return modo;
end $$;
revoke all on function public.ligar_voz_real(bigint, text) from public, anon;
grant execute on function public.ligar_voz_real(bigint, text) to authenticated;

create or replace function public.recusar_voz_real(empresa bigint, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.pedidos_envio_real;
begin
    if not public.sou_equipe() or not public.pode_equipe('ligar_voz_real') or not public.pode_ver_empresa(empresa) then
        raise exception 'sem permissão para responder o pedido';
    end if;
    update public.pedidos_envio_real p set situacao = 'recusado', resolvido_por = auth.uid(), resolvido_em = now(),
                                         motivo = trim(recusar_voz_real.motivo)
     where p.empresa_id = empresa and p.canal = 'agente_voz' and p.situacao = 'aberto' returning * into r;
    if r.id is null then
        raise exception 'não há pedido em aberto';
    end if;
    if r.chamado_id is not null then
        insert into public.chamado_mensagens (chamado_id, tipo, texto) values (r.chamado_id, 'equipe', r.motivo);
        update public.chamados set situacao = 'aguardando_cliente', atualizado_em = now() where id = r.chamado_id;
    end if;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link)
    values ('empresa', empresa, 'atencao', 'Ligações reais ainda não ligadas', left(r.motivo, 400), '/canais');
end $$;
revoke all on function public.recusar_voz_real(bigint, text) from public, anon;
grant execute on function public.recusar_voz_real(bigint, text) to authenticated;

-- ================================================================ 23. RPCs: lote (V9)
create or replace function public.mudar_lote_voz(lote bigint, acao text) returns text
language plpgsql security definer set search_path = public as $$
declare
    l public.voz_lotes;
    nova text;
begin
    select * into l from public.voz_lotes where id = lote;
    if l.id is null or l.empresa_id not in (select public.minhas_empresas()) then
        raise exception 'lote não encontrado';
    end if;
    if not public.pode('enviar_mensagens') then
        raise exception 'sem permissão para mudar o lote';
    end if;
    nova := case
        when acao = 'aprovar'  and l.situacao = 'aguardando_aprovacao'      then 'agendado'
        when acao = 'pausar'   and l.situacao in ('agendado', 'ligando')     then 'pausado'
        when acao = 'retomar'  and l.situacao = 'pausado'                   then 'agendado'
        when acao = 'cancelar' and l.situacao in ('aguardando_aprovacao', 'agendado', 'ligando', 'pausado') then 'cancelado'
    end;
    if nova is null then
        raise exception 'não dá para % um lote %', acao, replace(l.situacao, '_', ' ');
    end if;
    if nova = 'agendado' and l.data < (now() at time zone 'America/Sao_Paulo')::date then
        raise exception 'lote de outro dia não liga';
    end if;
    update public.voz_lotes v set situacao = nova, atualizado_em = now(), atualizado_por = auth.uid(),
           concluido_em = case when nova = 'cancelado' then now() else v.concluido_em end
     where v.id = lote;
    return nova;
end $$;
revoke all on function public.mudar_lote_voz(bigint, text) from public, anon;
grant execute on function public.mudar_lote_voz(bigint, text) to authenticated;

create or replace function public.pausar_lote_voz(lote bigint) returns text
language sql security definer set search_path = public as $$ select public.mudar_lote_voz(lote, 'pausar') $$;
create or replace function public.retomar_lote_voz(lote bigint) returns text
language sql security definer set search_path = public as $$ select public.mudar_lote_voz(lote, 'retomar') $$;
create or replace function public.cancelar_lote_voz(lote bigint) returns text
language sql security definer set search_path = public as $$ select public.mudar_lote_voz(lote, 'cancelar') $$;
revoke all on function public.pausar_lote_voz(bigint), public.retomar_lote_voz(bigint), public.cancelar_lote_voz(bigint)
    from public, anon;
grant execute on function public.pausar_lote_voz(bigint), public.retomar_lote_voz(bigint), public.cancelar_lote_voz(bigint)
    to authenticated;

-- resultado do lote até o momento (security invoker: a RLS de voz_chamadas filtra a empresa)
create or replace function public.resumo_lote_voz(lote bigint)
returns table (resultado text, chamadas bigint, segundos bigint, minutos_ia numeric, custo_operadora numeric, sem_custo bigint)
language sql stable security invoker set search_path = public as $$
    select coalesce(c.resultado, 'em_andamento'), count(*), coalesce(sum(c.billsec), 0)::bigint,
           coalesce(sum(c.minutos_ia), 0), coalesce(sum(c.custo_operadora), 0),
           count(*) filter (where c.tarifada_em is not null and c.rota_id is null and coalesce(c.billsec, 0) > 0)
      from public.voz_chamadas c where c.lote_id = lote
     group by 1 order by 2 desc
$$;
revoke all on function public.resumo_lote_voz(bigint) from public, anon;
grant execute on function public.resumo_lote_voz(bigint) to authenticated;

-- ================================================================ 24. RPCs: gravações e titular (V12, V17)
create or replace function public.guardar_gravacao(gravacao bigint, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.voz_gravacoes;
begin
    select * into g from public.voz_gravacoes where id = gravacao;
    if g.id is null or public.sou_equipe() or g.empresa_id not in (select public.minhas_empresas())
       or not public.tem_papel('admin') then
        raise exception 'só o Admin da empresa guarda gravação';
    end if;
    if motivo is null or char_length(trim(motivo)) < 5 then
        raise exception 'informe o motivo da guarda';
    end if;
    update public.voz_gravacoes v set guarda = true, guarda_motivo = trim(motivo), guarda_por = auth.uid(), guarda_em = now()
     where v.id = gravacao;
end $$;
create or replace function public.soltar_gravacao(gravacao bigint) returns void
language plpgsql security definer set search_path = public as $$
declare g public.voz_gravacoes;
begin
    select * into g from public.voz_gravacoes where id = gravacao;
    if g.id is null or public.sou_equipe() or g.empresa_id not in (select public.minhas_empresas())
       or not public.tem_papel('admin') then
        raise exception 'só o Admin da empresa tira a guarda';
    end if;
    update public.voz_gravacoes v set guarda = false, guarda_motivo = null, guarda_por = auth.uid(), guarda_em = now()
     where v.id = gravacao;
end $$;
revoke all on function public.guardar_gravacao(bigint, text), public.soltar_gravacao(bigint) from public, anon;
grant execute on function public.guardar_gravacao(bigint, text), public.soltar_gravacao(bigint) to authenticated;

create or replace function public.abrir_pedido_titular(id_cliente text, tipo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
    eid bigint;
    pid bigint;
begin
    select p.empresa_id into eid from public.perfis p where p.id = auth.uid() and p.ativo and not p.equipe;
    if eid is null or not public.tem_papel('admin') then
        raise exception 'só o Admin da empresa abre pedido do titular';
    end if;
    if tipo not in ('exportar', 'eliminar') then
        raise exception 'tipo inválido: exportar ou eliminar';
    end if;
    if id_cliente is null or char_length(trim(id_cliente)) not between 1 and 60 then
        raise exception 'informe o ID do cliente';
    end if;
    if tipo = 'eliminar' and exists (select 1 from public.voz_gravacoes g where g.empresa_id = eid
                                       and g.id_cliente = trim(abrir_pedido_titular.id_cliente) and g.guarda) then
        raise exception 'há gravação em guarda para disputa: a eliminação fica bloqueada até o Admin tirar a guarda';
    end if;
    insert into public.titular_pedidos (empresa_id, id_cliente, tipo) values (eid, trim(id_cliente), tipo) returning id into pid;
    return pid;
end $$;
revoke all on function public.abrir_pedido_titular(text, text) from public, anon;
grant execute on function public.abrir_pedido_titular(text, text) to authenticated;

-- a VM apaga o que venceu (fora da guarda) e os códigos de chamada sem gravação que passaram da retenção
create or replace function public.apagar_voz_expirada() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    g int;
    c int;
    c2 int;
begin
    if not public.chamada_do_servidor() then
        raise exception 'só o servidor apaga gravações vencidas';
    end if;
    delete from public.voz_gravacoes v where v.expira_em < now() and not v.guarda;
    get diagnostics g = row_count;
    update public.voz_chamadas ch set codigos = null
      from public.voz_config cf
     where cf.empresa_id = ch.empresa_id and ch.codigos is not null and not ch.tem_gravacao
       and ch.ocorrido_em < now() - make_interval(days => cf.retencao_dias);
    get diagnostics c = row_count;
    update public.voz_chamadas ch set codigos = null
     where ch.codigos is not null and not ch.tem_gravacao and ch.ocorrido_em < now() - interval '90 days'
       and not exists (select 1 from public.voz_config cf where cf.empresa_id = ch.empresa_id);
    get diagnostics c2 = row_count;
    return jsonb_build_object('gravacoes', g, 'codigos', c + c2);
end $$;
revoke all on function public.apagar_voz_expirada() from public, anon, authenticated;
grant execute on function public.apagar_voz_expirada() to service_role;

-- ================================================================ 25. auditoria das tabelas de configuração
do $$
declare t text;
begin
    foreach t in array array['voz_config', 'voz_roteiros', 'voz_troncos', 'voz_rotas', 'voz_transferencias',
                             'voz_contrato', 'voz_gravacoes', 'voz_import_config', 'titular_pedidos'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;

-- funções auxiliares (usadas nos checks): nada para anon; o site e a VM chamam
do $$
declare f regprocedure;
begin
    for f in select p.oid::regprocedure from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('desfechos_voz', 'variaveis_voz', 'mascara_voz_ok', 'regras_transferencia_validas',
                                  'codigos_voz_validos', 'segundos_tarifados', 'custo_voz') loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end $$;
