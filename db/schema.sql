-- Modelo alvo (Postgres). O MVP roda em memória; esta é a estrutura de produção.

CREATE TYPE canal AS ENUM ('discador', 'agente_voz', 'sms', 'whatsapp', 'rcs', 'email');

CREATE TABLE carteira (
    id                    SERIAL PRIMARY KEY,
    nome                  TEXT NOT NULL,
    credor                TEXT,
    valor_contato_efetivo NUMERIC(10,2) NOT NULL DEFAULT 8.00,
    limiar_whatsapp       NUMERIC(4,3)  NOT NULL DEFAULT 0.800
);

-- O motor roda pelo ID do cliente do sistema de cobrança (identificador opaco).
-- O CPF é opcional e serve só para agrupar IDs da mesma pessoa; fornecedores
-- recebem e devolvem apenas o id_cliente.
CREATE TABLE cliente (
    id_cliente  TEXT PRIMARY KEY CHECK (length(id_cliente) BETWEEN 1 AND 64),
    cpf         CHAR(11),             -- opcional; acesso restrito (LGPD)
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON cliente (cpf) WHERE cpf IS NOT NULL;

CREATE TABLE cliente_carteira (
    id_cliente   TEXT NOT NULL REFERENCES cliente(id_cliente),
    carteira_id  INT NOT NULL REFERENCES carteira(id),
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_cliente, carteira_id)
);

CREATE TABLE contato (
    id         BIGSERIAL PRIMARY KEY,
    id_cliente TEXT NOT NULL REFERENCES cliente(id_cliente),
    tipo       TEXT NOT NULL CHECK (tipo IN ('telefone', 'email')),
    valor      TEXT NOT NULL,
    origem     TEXT,               -- cadastro, enriquecimento, bureau... (define o prior)
    UNIQUE (id_cliente, valor)
);
-- O mesmo número em vários clientes: certificado para uma pessoa é evidência
-- contra as outras e a favor dos outros IDs da mesma pessoa (mesmo CPF).
CREATE INDEX ON contato (valor);

CREATE TABLE campanha (
    id            BIGSERIAL PRIMARY KEY,
    carteira_id   INT NOT NULL REFERENCES carteira(id),
    canal         canal NOT NULL,
    fornecedor    TEXT NOT NULL,
    mensagem_id   TEXT,               -- versão do roteiro/template (fase 3)
    disparada_em  TIMESTAMPTZ
);

-- Toda ação sai com link único rastreável: é o que resolve a atribuição
-- em canal sem confirmação de leitura (SMS) e liga o portal ao disparo.
CREATE TABLE acao (
    id           BIGSERIAL PRIMARY KEY,
    campanha_id  BIGINT NOT NULL REFERENCES campanha(id),
    contato_id   BIGINT NOT NULL REFERENCES contato(id),
    token_link   TEXT UNIQUE,         -- HMAC da ação (motor/rastreio.py), sem dado pessoal
    enviada_em   TIMESTAMPTZ
);

-- Acessos ao portal pelo link: clique (engajamento), login (certifica), acordo (conversão)
CREATE TABLE acesso_portal (
    id           BIGSERIAL PRIMARY KEY,
    acao_id      BIGINT NOT NULL REFERENCES acao(id),
    evento       TEXT NOT NULL CHECK (evento IN ('clique', 'login', 'acordo')),
    ocorrido_em  TIMESTAMPTZ NOT NULL,
    UNIQUE (acao_id, evento, ocorrido_em)
);

-- Evento canônico: todo retorno de todo fornecedor vira uma linha aqui.
-- O canal vem da campanha (via ação); não é repetido para não divergir.
CREATE TABLE evento (
    id            BIGSERIAL PRIMARY KEY,
    acao_id       BIGINT NOT NULL REFERENCES acao(id),
    fornecedor    TEXT NOT NULL,
    id_externo    TEXT NOT NULL,      -- id do retorno no fornecedor
    resultado     TEXT NOT NULL,      -- vocabulário de motor/taxonomia.py
    nivel         SMALLINT NOT NULL CHECK (nivel BETWEEN -1 AND 3),
    custo         NUMERIC(10,4) NOT NULL DEFAULT 0,
    ocorrido_em   TIMESTAMPTZ NOT NULL,
    payload_bruto JSONB,              -- retorno original, para auditoria (ver retenção)
    UNIQUE (fornecedor, id_externo)   -- reimportar o arquivo não duplica evidência
);
CREATE INDEX ON evento (acao_id, ocorrido_em);
CREATE INDEX ON evento (ocorrido_em);

-- Estado materializado, recalculado pelo motor
CREATE TABLE certificacao (
    contato_id    BIGINT PRIMARY KEY REFERENCES contato(id),
    status        TEXT NOT NULL CHECK (status IN
                  ('CERTIFICADO', 'PROVAVEL', 'NAO_CONFIRMADO', 'CONTESTADO', 'INVALIDO', 'DESCONHECIDO')),
    score         NUMERIC(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
    restricoes    TEXT[] NOT NULL DEFAULT '{}',
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE afinidade_canal (
    id_cliente    TEXT NOT NULL REFERENCES cliente(id_cliente),
    canal         canal NOT NULL,
    prob_engajar  NUMERIC(4,3) NOT NULL,
    prob_cpc      NUMERIC(4,3) NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_cliente, canal)
);

-- Compliance aplicado pelo NÚCLEO antes do disparo (não só pelo agente Validador)
CREATE TABLE opt_out (
    contato_id    BIGINT NOT NULL REFERENCES contato(id),
    canal         canal NOT NULL,
    registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    origem        TEXT,               -- resposta SAIR, descadastro, pedido ao operador...
    PRIMARY KEY (contato_id, canal)
);

CREATE TABLE politica_contato (
    carteira_id        INT NOT NULL REFERENCES carteira(id),
    canal              canal NOT NULL,
    hora_inicio        TIME NOT NULL,
    hora_fim           TIME NOT NULL,
    max_tentativas_dia SMALLINT,
    max_tentativas_semana SMALLINT,
    PRIMARY KEY (carteira_id, canal)
);

-- Conversão ligada à ação de origem (fase 3)
CREATE TABLE conversao (
    id             BIGSERIAL PRIMARY KEY,
    id_cliente     TEXT NOT NULL,
    carteira_id    INT NOT NULL,
    acao_origem_id BIGINT REFERENCES acao(id),
    via            TEXT NOT NULL CHECK (via IN ('operador', 'portal')),
    valor_acordo   NUMERIC(12,2),
    ocorrido_em    TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (id_cliente, carteira_id) REFERENCES cliente_carteira(id_cliente, carteira_id)
);
CREATE INDEX ON conversao (acao_origem_id);

-- LGPD: payload_bruto carrega dado pessoal. Expurgar/mascarar após o prazo de
-- auditoria definido com o jurídico (ex.: job diário):
--   UPDATE evento SET payload_bruto = NULL WHERE ocorrido_em < now() - interval '180 days';

-- ===== Playbook: marcação, trilha e acordos =====

-- Foto atual de cada cliente (a TAG). Recalculada pela rotina diária.
CREATE TABLE estado_cliente (
    id_cliente        TEXT PRIMARY KEY REFERENCES cliente(id_cliente),
    safra             DATE NOT NULL,                 -- imutável
    cluster_origem    CHAR(2) NOT NULL,              -- imutável
    cluster_atual     CHAR(2) NOT NULL,              -- revisado no fechamento mensal
    estado            TEXT NOT NULL CHECK (estado IN
                      ('LOC','CPA','CPB','NCP','PRE','QBR','COL','LIQ','BLQ')),
    canal             TEXT NOT NULL CHECK (canal IN ('WA','RC','AV','DC','SM','EM','ND')),
    ciclo             TEXT NOT NULL DEFAULT '',
    tag               TEXT GENERATED ALWAYS AS (
                      'S' || to_char(safra, 'YYMMDD') || '-' || cluster_atual || '-' || estado || '-' || canal
                      || CASE WHEN ciclo = '' THEN '' ELSE '-' || ciclo END) STORED,
    detalhe           JSONB NOT NULL DEFAULT '{}',   -- tentativas, canais esgotados, localizador...
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON estado_cliente (estado, canal);

-- A trilha: cada mudança de TAG é um evento. O extrato do cliente é a sequência.
CREATE TABLE trilha (
    id            BIGSERIAL PRIMARY KEY,
    id_cliente    TEXT NOT NULL REFERENCES cliente(id_cliente),
    data          DATE NOT NULL,
    tag_anterior  TEXT,
    tag           TEXT NOT NULL,
    motivo        TEXT NOT NULL,
    quem_marcou   TEXT NOT NULL
);
CREATE INDEX ON trilha (id_cliente, data);

CREATE TABLE parcela (
    id_cliente  TEXT NOT NULL REFERENCES cliente(id_cliente),
    id_acordo   TEXT NOT NULL,
    numero      SMALLINT NOT NULL,
    vencimento  DATE NOT NULL,
    valor       NUMERIC(12,2) NOT NULL,
    pago_em     DATE,                    -- só com baixa confirmada
    PRIMARY KEY (id_acordo, numero)
);
