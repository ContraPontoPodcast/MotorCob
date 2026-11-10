-- SQL 96 · Agente de voz: trava de CPF (PR9 do redesenho do fluxo; SPEC B4 e Q4). Pré-requisito para começar a ligar.
-- Regra do produto: o CPF nunca é identificador do cliente e nunca é dito, pedido ou repetido pelo agente.
--
-- 1. fluxo_voz_aux_pede_senha(t): a trava 2 da fala passa a valer também para CPF (= voz/fluxo_validador.pede_senha e
--    pede_cpf): a fala não pode citar CPF (fora "os três últimos números/dígitos do CPF", a pergunta de identidade
--    que já existe) nem dizer um número com cara de CPF (000.000.000-00 ou 11 dígitos). O código de erro continua
--    fala_pede_senha (o site diz "pede senha, cartão ou CPF"); o objetivo da IA conversa continua fora da regra (pode
--    dizer "nunca peça o CPF"). Como fluxo_voz_erros chama esta função, o validador inteiro passa a recusar.
-- 2. travas_voz() e o check voz_fluxo_passos_trava_check: + 'cpf' (a pessoa disse um CPF: o executor responde, nunca
--    repete e o texto não vai ao modelo, ao log nem à transcrição). Só acrescenta um valor (NOT VALID + VALIDATE).
-- Rascunho ou versão salva que cite CPF passa a ter a pendência fala_pede_senha: o VERIFICAR conta as aprovadas/em uso
-- (o esperado é 0). Rode ANTES de atualizar o motor e as VMs de voz (a VM nova grava trava = 'cpf'). Pode rodar de novo.
-- Se o SQL 58 ou o 59 rodarem de novo, rode o 96 depois.

-- ================================================================ 1. a fala nunca pede, cita nem diz CPF
create or replace function public.fluxo_voz_aux_pede_senha(t text) returns boolean
language sql immutable parallel safe as $$
    select x ~ '(senha|numero do cartao|codigo de seguranca|cvv)'
        or regexp_replace(x, '(tres|3) ultimos (numeros|digitos)[^.?!]{0,20}c\.?p\.?f', '', 'g') ~ 'c\.?p\.?f'
        or x ~ '[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}'
      from (select translate(lower(t), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as x) s
$$;
comment on function public.fluxo_voz_aux_pede_senha(text) is
    'Trava 2 da fala: senha, cartão ou (SQL 96) CPF — fora "os três últimos números do CPF". = voz/fluxo_validador.pede_senha.';

-- ================================================================ 2. a trava "cpf" no executor
create or replace function public.travas_voz() returns text[]
language sql immutable parallel safe as $$
    select array['nao_me_ligue', 'pedido_humano', 'senha_cartao', 'valor_antes_identidade', 'terceiro', 'alcada',
                 'oferta_inventada', 'repeticao', 'cpf']::text[]
$$;
alter table public.voz_fluxo_passos drop constraint if exists voz_fluxo_passos_trava_check;
alter table public.voz_fluxo_passos add constraint voz_fluxo_passos_trava_check
    check (trava in ('nao_me_ligue', 'pedido_humano', 'senha_cartao', 'valor_antes_identidade', 'terceiro', 'alcada',
                     'oferta_inventada', 'repeticao', 'cpf')) not valid;
alter table public.voz_fluxo_passos validate constraint voz_fluxo_passos_trava_check;
comment on column public.voz_fluxo_passos.trava is
    'Trava que agiu neste bloco (travas_voz()). cpf = a pessoa disse um CPF: o agente respondeu sem repetir (SQL 96).';
