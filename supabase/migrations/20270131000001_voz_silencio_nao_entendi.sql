-- SQL 95 · Agente de voz: "Se não entender" e "Se não ouvir nada" com fala própria por etapa (PR8 do redesenho do
-- fluxo; SPEC B1 e B2). Pré-requisito para o agente começar a ligar.
--
-- O esquema 1 do fluxo ganha, só nas etapas que ouvem a pessoa (abertura, identidade, pergunta, intencao, oferta,
-- retorno), dois params OPCIONAIS e uma saída OPCIONAL:
--   params.nao_entendi = {fala?, vezes 1..3?}   o que o agente diz quando não entende e quantas vezes até seguir a
--                                                saída de "não entendi" da etapa (sem vezes: `tentativas`, padrão 2)
--   params.silencio    = {fala?, vezes 1..3?}   o mesmo quando não ouve nada (padrão 2)
--   saída quando = 'silencio'                    para onde vai depois das N vezes sem ouvir (sem ela: a de "não
--                                                entendi"; na Abertura, encerra sem recado e não marca terceiro)
-- As falas novas passam pelas mesmas regras da fala: 500 caracteres (fala_longa), variáveis de variaveis_voz()
-- (variavel_invalida), senha/cartão (fala_pede_senha) e a trava 1 (valor_antes_identidade: credor ou valor antes de
-- Confirmar identidade em algum caminho), porque fluxo_voz_aux_textos_bloco passa a devolvê-las.
--
-- 1. fluxo_voz_aux_textos_bloco(b): + 'nao_entendi.fala' e 'silencio.fala' (= voz/fluxo_validador.textos_do_bloco).
-- 2. fluxo_voz_erros(d): a mesma função do SQL 58, inteira, com as chaves novas, a checagem de {fala, vezes} e
--    'silencio' entre as saídas válidas das etapas que ouvem (= voz/fluxo_validador.erros; os casos de
--    voz/fluxo_casos.py rodam nos dois lados em supabase/testes/testar_rls.py).
-- Só acrescenta: todo fluxo que valia continua valendo, com os mesmos erros (nenhuma versão gravada muda de situação).
-- Rode ANTES de atualizar o motor e as VMs de voz (o site novo grava os params novos; o executor novo os lê; o
-- executor antigo recusaria um fluxo com eles). Pode rodar de novo. Se o SQL 58 rodar de novo, rode o 95 depois.

-- ================================================================ 1. textos que viram fala (agora com os de repetição)
create or replace function public.fluxo_voz_aux_textos_bloco(b jsonb) returns table (campo text, texto text)
language sql immutable parallel safe as $$
    select k, b -> 'params' ->> k from unnest(array['fala', 'fala_espera', 'objetivo']) k
     where jsonb_typeof(b -> 'params') = 'object' and jsonb_typeof(b -> 'params' -> k) = 'string'
    union all
    select k || '.fala', b -> 'params' -> k ->> 'fala' from unnest(array['nao_entendi', 'silencio']) k
     where jsonb_typeof(b -> 'params') = 'object' and jsonb_typeof(b -> 'params' -> k) = 'object'
       and jsonb_typeof(b -> 'params' -> k -> 'fala') = 'string'
$$;

-- ================================================================ 2. validador do fluxo (SQL 58 + SQL 95)
create or replace function public.fluxo_voz_erros(d jsonb) returns text[]
language plpgsql immutable parallel safe set search_path = public as $$
declare
    tipos constant text[] := array['abertura', 'identidade', 'pergunta', 'intencao', 'generativa', 'oferta', 'retorno',
                                   'conector', 'registrar', 'link', 'condicao', 'transferir', 'encerrar'];
    finais constant text[] := array['transferir', 'encerrar'];
    com_fala constant text[] := array['abertura', 'identidade', 'pergunta', 'intencao', 'oferta', 'retorno', 'link',
                                      'transferir', 'encerrar'];
    ouvem constant text[] := array['abertura', 'identidade', 'pergunta', 'intencao', 'oferta', 'retorno'];
    ferramentas constant text[] := array['apresentar_oferta', 'registrar_promessa', 'agendar_retorno', 'consultar_base',
                                         'transferir_humano', 'encerrar_chamada'];
    vars_fala text[] := public.variaveis_voz() || public.campos_oferta_voz();
    out text[] := '{}';
    b jsonb; s jsonb; p jsonb;
    bid text; tipo text; ini text;
    ids text[] := '{}';
    chaves text[];
    modos text[];
    validos text[]; obrig text[]; qs text[];
    ruim boolean; final boolean;
    t record;
    eo text[] := '{}'; eq text[] := '{}'; ep text[] := '{}';
    identidades text[]; alc text[]; mapa jsonb := '{}'; comp text[]; feitos text[] := '{}';
    i text; j text; n int; r jsonb; rk text;
begin
    if d is null or jsonb_typeof(d) <> 'object'
       or exists (select 1 from jsonb_object_keys(d) k where k not in ('esquema', 'blocos'))
       or jsonb_typeof(d -> 'esquema') is distinct from 'number' or (d ->> 'esquema')::numeric <> 1
       or jsonb_typeof(d -> 'blocos') is distinct from 'array' then
        return array['esquema_invalido'];
    end if;
    if jsonb_array_length(d -> 'blocos') > 60 then
        return array['blocos_demais'];
    end if;

    -- forma: sem id válido, id repetido ou tipo desconhecido não dá para seguir
    for b in select x from jsonb_array_elements(d -> 'blocos') x loop
        if jsonb_typeof(b) <> 'object' or jsonb_typeof(b -> 'id') is distinct from 'string' or (b ->> 'id') !~ '^N[0-9]{1,3}$' then
            out := out || 'id_invalido'::text;
            continue;
        end if;
        bid := b ->> 'id';
        if bid = any (ids) then
            out := out || ('id_repetido:' || bid);
        end if;
        ids := ids || bid;
        if not public.fluxo_voz_aux_em(b -> 'tipo', tipos) then
            out := out || ('tipo_invalido:' || bid);
        end if;
    end loop;
    if cardinality(out) > 0 then
        return array(select distinct x collate "C" from unnest(out) x order by 1);
    end if;

    for b in select x from jsonb_array_elements(d -> 'blocos') x loop
        bid := b ->> 'id';
        tipo := b ->> 'tipo';
        final := tipo = any (finais);
        p := case when jsonb_typeof(b -> 'params') = 'object' then b -> 'params' else '{}'::jsonb end;
        modos := case tipo when 'abertura' then array['arvore'] when 'identidade' then array['arvore', 'cognicao']
                           when 'pergunta' then array['arvore'] when 'intencao' then array['cognicao']
                           when 'generativa' then array['generativo'] when 'oferta' then array['arvore', 'cognicao']
                           when 'retorno' then array['arvore', 'cognicao'] when 'link' then array['arvore']
                           when 'transferir' then array['arvore'] when 'encerrar' then array['arvore']
                           else array['sistema'] end;

        -- bloco
        if exists (select 1 from jsonb_object_keys(b) k
                    where k not in ('id', 'tipo', 'modo', 'x', 'y', 'titulo', 'repetir_max', 'params', 'saidas'))
           or not (b ? 'params' and b ? 'saidas' and b ? 'modo')
           or (b ? 'x' and jsonb_typeof(b -> 'x') <> 'number') or (b ? 'y' and jsonb_typeof(b -> 'y') <> 'number')
           or (b ? 'titulo' and not coalesce(jsonb_typeof(b -> 'titulo') = 'string' and char_length(b ->> 'titulo') <= 60, false))
           or (b ? 'repetir_max' and not public.fluxo_voz_aux_inteiro(b -> 'repetir_max', 1, 5)) then
            out := out || ('bloco_invalido:' || bid);
        end if;
        if tipo = 'identidade' and b -> 'modo' = '"generativo"'::jsonb then
            out := out || ('identidade_generativa:' || bid);
        elsif not public.fluxo_voz_aux_em(b -> 'modo', modos) then
            out := out || ('modo_incompativel:' || bid);
        end if;

        -- params
        if jsonb_typeof(b -> 'params') is distinct from 'object' then
            out := out || ('params_invalidos:' || bid);
        else
            chaves := case tipo
                when 'abertura' then array['fala', 'nao_entendi', 'silencio']
                when 'identidade' then array['fala', 'pergunta', 'conector_id', 'tentativas', 'nao_entendi', 'silencio']
                when 'pergunta' then array['fala', 'opcoes', 'tentativas', 'nao_entendi', 'silencio']
                when 'intencao' then array['fala', 'intencoes', 'exemplos', 'confianca_min', 'tentativas', 'entidades',
                                           'nao_entendi', 'silencio']
                when 'generativa' then array['objetivo', 'tom', 'max_turnos', 'ferramentas', 'contrapropostas_max']
                when 'oferta' then array['fala', 'origem', 'conector_id', 'nao_entendi', 'silencio']
                when 'retorno' then array['fala', 'dias_max', 'nao_entendi', 'silencio']
                when 'conector' then array['conector_id', 'fala_espera']
                when 'registrar' then array['registra', 'conectores']
                when 'link' then array['fala', 'canal', 'modelo_id']
                when 'condicao' then array['campo', 'op', 'valor']
                when 'transferir' then array['fala', 'motivo']
                else array['fala', 'resultado', 'codigo'] end;
            ruim := exists (select 1 from jsonb_object_keys(p) k where k <> all (chaves));
            if tipo = any (com_fala) then
                if jsonb_typeof(p -> 'fala') is distinct from 'string' or btrim(p ->> 'fala', E' \t\n\r') = '' then
                    ruim := true;
                elsif char_length(p ->> 'fala') > 500 then
                    out := out || ('fala_longa:' || bid);
                end if;
            end if;
            if p ? 'fala_espera' then
                if jsonb_typeof(p -> 'fala_espera') <> 'string' or btrim(p ->> 'fala_espera', E' \t\n\r') = '' then
                    ruim := true;
                elsif char_length(p ->> 'fala_espera') > 500 then
                    out := out || ('fala_longa:' || bid);
                end if;
            end if;
            if p ? 'tentativas' and not public.fluxo_voz_aux_inteiro(p -> 'tentativas', 1, 3) then
                ruim := true;
            end if;
            if p ? 'conector_id' and jsonb_typeof(p -> 'conector_id') <> 'null'
               and not public.fluxo_voz_aux_inteiro(p -> 'conector_id', 1, 9007199254740992) then
                ruim := true;
            end if;
            -- SQL 95: "Se não entender" e "Se não ouvir nada" = {fala?, vezes 1..3?}
            foreach rk in array array['nao_entendi', 'silencio'] loop
                if not p ? rk then
                    continue;
                end if;
                r := p -> rk;
                if jsonb_typeof(r) <> 'object' or exists (select 1 from jsonb_object_keys(r) x where x not in ('fala', 'vezes')) then
                    ruim := true;
                    continue;
                end if;
                if r ? 'vezes' and not public.fluxo_voz_aux_inteiro(r -> 'vezes', 1, 3) then
                    ruim := true;
                end if;
                if r ? 'fala' then
                    if jsonb_typeof(r -> 'fala') <> 'string' or btrim(r ->> 'fala', E' \t\n\r') = '' then
                        ruim := true;
                    elsif char_length(r ->> 'fala') > 500 then
                        out := out || ('fala_longa:' || bid);
                    end if;
                end if;
            end loop;

            if tipo = 'identidade' then
                ruim := ruim or not public.fluxo_voz_aux_em(p -> 'pergunta',
                                                           array['dia_mes_nascimento', 'ano_nascimento', 'ultimos3_documento']);
            elsif tipo = 'pergunta' then
                if jsonb_typeof(p -> 'opcoes') is distinct from 'array' or jsonb_array_length(p -> 'opcoes') not between 1 and 6 then
                    ruim := true;
                else
                    if exists (select 1 from jsonb_array_elements(p -> 'opcoes') o
                                where jsonb_typeof(o) <> 'object'
                                   or exists (select 1 from jsonb_object_keys(o) k where k not in ('codigo', 'rotulo', 'exemplos'))
                                   or not public.fluxo_voz_aux_codigo(o -> 'codigo') or o ->> 'codigo' = 'sem_resposta'
                                   or not coalesce(jsonb_typeof(o -> 'rotulo') = 'string'
                                                   and char_length(o ->> 'rotulo') between 1 and 60, false)
                                   or (o ? 'exemplos' and not public.fluxo_voz_aux_textos(o -> 'exemplos', 10, 120))) then
                        ruim := true;
                    end if;
                    ruim := ruim or (select count(*) <> count(distinct o ->> 'codigo')
                      from jsonb_array_elements(p -> 'opcoes') o
                     where jsonb_typeof(o) = 'object'
                       and not exists (select 1 from jsonb_object_keys(o) k where k not in ('codigo', 'rotulo', 'exemplos'))
                       and public.fluxo_voz_aux_codigo(o -> 'codigo') and o ->> 'codigo' <> 'sem_resposta'
                       and coalesce(jsonb_typeof(o -> 'rotulo') = 'string' and char_length(o ->> 'rotulo') between 1 and 60, false)
                       and not (o ? 'exemplos' and not public.fluxo_voz_aux_textos(o -> 'exemplos', 10, 120)));
                end if;
            elsif tipo = 'intencao' then
                if jsonb_typeof(p -> 'intencoes') is distinct from 'array' or jsonb_array_length(p -> 'intencoes') not between 1 and 12
                   or exists (select 1 from jsonb_array_elements(p -> 'intencoes') x where not public.fluxo_voz_aux_codigo(x))
                   or (select count(distinct x) <> count(*) from jsonb_array_elements(p -> 'intencoes') x)
                   or p -> 'intencoes' @> '["nao_entendido"]'::jsonb then
                    ruim := true;
                end if;
                if p ? 'exemplos' then
                    if jsonb_typeof(p -> 'exemplos') <> 'object' or jsonb_typeof(p -> 'intencoes') is distinct from 'array'
                       or exists (select 1 from jsonb_each(p -> 'exemplos') e
                                   where not (p -> 'intencoes' @> jsonb_build_array(e.key))
                                      or not public.fluxo_voz_aux_textos(e.value, 10, 120)) then
                        ruim := true;
                    end if;
                end if;
                if p ? 'confianca_min' and not coalesce(jsonb_typeof(p -> 'confianca_min') = 'number'
                                                        and (p ->> 'confianca_min')::numeric between 0.5 and 0.95, false) then
                    ruim := true;
                end if;
                if p ? 'entidades' and not coalesce(jsonb_typeof(p -> 'entidades') = 'array'
                       and not exists (select 1 from jsonb_array_elements(p -> 'entidades') x
                                        where not public.fluxo_voz_aux_em(x, array['data', 'valor', 'parcelas', 'hora'])), false) then
                    ruim := true;
                end if;
            elsif tipo = 'generativa' then
                if jsonb_typeof(p -> 'objetivo') is distinct from 'string'
                   or char_length(btrim(p ->> 'objetivo', E' \t\n\r')) < 20 or char_length(p ->> 'objetivo') > 20000 then
                    out := out || ('generativo_sem_objetivo:' || bid);
                end if;
                if not public.fluxo_voz_aux_inteiro(p -> 'max_turnos', 1, 40) then
                    out := out || ('generativo_sem_limite:' || bid);
                end if;
                if jsonb_typeof(p -> 'ferramentas') is distinct from 'array'
                   or exists (select 1 from jsonb_array_elements(p -> 'ferramentas') x where not public.fluxo_voz_aux_em(x, ferramentas))
                   or (select count(distinct x) <> count(*) from jsonb_array_elements(p -> 'ferramentas') x) then
                    out := out || ('ferramenta_invalida:' || bid);
                elsif not p -> 'ferramentas' @> '["transferir_humano"]'::jsonb then
                    out := out || ('transferir_humano_desligado:' || bid);
                end if;
                if p ? 'tom' and not coalesce(jsonb_typeof(p -> 'tom') = 'array'
                       and not exists (select 1 from jsonb_array_elements(p -> 'tom') x
                                        where not public.fluxo_voz_aux_em(x, array['cordial', 'frases_curtas', 'sem_giria',
                                                                                     'nao_pressiona', 'formal'])), false) then
                    ruim := true;
                end if;
                if p ? 'contrapropostas_max' and not public.fluxo_voz_aux_inteiro(p -> 'contrapropostas_max', 0, 5) then
                    ruim := true;
                end if;
            elsif tipo = 'oferta' then
                ruim := ruim or not public.fluxo_voz_aux_em(p -> 'origem', array['conector', 'carteira']);
            elsif tipo = 'retorno' then
                if p ? 'dias_max' and not public.fluxo_voz_aux_inteiro(p -> 'dias_max', 1, 7) then
                    ruim := true;
                end if;
            elsif tipo = 'registrar' then
                ruim := ruim or not public.fluxo_voz_aux_em(p -> 'registra', array['acordo_crm', 'promessa_motorcx']);
                if p ? 'conectores' and (jsonb_typeof(p -> 'conectores') <> 'array' or jsonb_array_length(p -> 'conectores') > 2
                       or exists (select 1 from jsonb_array_elements(p -> 'conectores') x
                                   where jsonb_typeof(x) <> 'null' and not public.fluxo_voz_aux_inteiro(x, 1, 9007199254740992))) then
                    ruim := true;
                end if;
            elsif tipo = 'link' then
                ruim := ruim or not public.fluxo_voz_aux_em(p -> 'canal', array['whatsapp_sms', 'sms', 'whatsapp']);
                if p ? 'modelo_id' and jsonb_typeof(p -> 'modelo_id') <> 'null'
                   and not public.fluxo_voz_aux_inteiro(p -> 'modelo_id', 1, 9007199254740992) then
                    ruim := true;
                end if;
            elsif tipo = 'condicao' then
                if not public.fluxo_voz_aux_em(p -> 'campo', array['ofertas_quantidade', 'identidade_confirmada', 'dias_atraso',
                                                                     'saldo', 'tentativa_do_dia'])
                   or not public.fluxo_voz_aux_em(p -> 'op', array['=', '<>', '<', '<=', '>', '>=']) then
                    ruim := true;
                elsif p ->> 'campo' = 'identidade_confirmada' then
                    ruim := ruim or jsonb_typeof(p -> 'valor') is distinct from 'boolean' or p ->> 'op' not in ('=', '<>');
                else
                    ruim := ruim or jsonb_typeof(p -> 'valor') is distinct from 'number';
                end if;
            elsif tipo = 'transferir' then
                ruim := ruim or not public.fluxo_voz_aux_em(p -> 'motivo', array['cpc', 'pedido_humano', 'ofertas_sem_acordo',
                                                                                  'fora_alcada', 'contestacao']);
            elsif tipo = 'encerrar' then
                ruim := ruim or not public.fluxo_voz_aux_em(p -> 'resultado', array['promessa', 'retorno_agendado', 'recusa',
                                                                                      'recado', 'cpc', 'atendida_sem_cpc',
                                                                                      'identidade_confirmada']);
                if p ? 'codigo' and not public.fluxo_voz_aux_codigo(p -> 'codigo') then
                    ruim := true;
                end if;
            end if;
            if ruim then
                out := out || ('params_invalidos:' || bid);
            end if;
        end if;

        -- variáveis e senha nos textos
        for t in select * from public.fluxo_voz_aux_textos_bloco(b) loop
            if exists (select 1 from unnest(public.fluxo_voz_aux_variaveis(t.texto)) v where v <> all (vars_fala)) then
                out := out || ('variavel_invalida:' || bid);
            end if;
            if t.campo <> 'objetivo' and public.fluxo_voz_aux_pede_senha(t.texto) then
                out := out || ('fala_pede_senha:' || bid);
            end if;
        end loop;

        -- saídas
        if jsonb_typeof(b -> 'saidas') is distinct from 'array' then
            out := out || ('saida_invalida:' || bid);
            continue;
        end if;
        if final then
            if jsonb_array_length(b -> 'saidas') > 0 then
                out := out || ('final_com_saida:' || bid);
            end if;
            continue;
        end if;
        if jsonb_array_length(b -> 'saidas') = 0 then
            out := out || ('sem_saida:' || bid);
            continue;
        end if;
        if tipo = 'pergunta' then
            obrig := case when jsonb_typeof(p -> 'opcoes') = 'array'
                          then array(select o ->> 'codigo' from jsonb_array_elements(p -> 'opcoes') o
                                      where jsonb_typeof(o) = 'object' and jsonb_typeof(o -> 'codigo') = 'string')
                          else '{}' end;
            validos := obrig || 'sem_resposta'::text || 'silencio'::text;
        elsif tipo = 'intencao' then
            obrig := case when jsonb_typeof(p -> 'intencoes') = 'array'
                          then array(select x #>> '{}' from jsonb_array_elements(p -> 'intencoes') x where jsonb_typeof(x) = 'string')
                          else '{}' end || 'nao_entendido'::text;
            validos := obrig || 'silencio'::text;
        elsif tipo = 'generativa' then
            obrig := '{}';
            validos := '{}';
        else
            validos := case tipo
                when 'abertura' then array['titular', 'terceiro']
                when 'identidade' then array['confirmou', 'nao_confirmou', 'falhou']
                when 'oferta' then array['aceitou', 'quer_outra', 'recusou']
                when 'retorno' then array['agendou', 'nao_agendou']
                when 'conector' then array['respondeu', 'falhou']
                when 'registrar' then array['registrado', 'falhou']
                when 'link' then array['enviado', 'falhou']
                else array['sim', 'nao'] end;
            obrig := case tipo
                when 'abertura' then array['titular', 'terceiro']
                when 'identidade' then array['confirmou', 'nao_confirmou']
                when 'oferta' then array['aceitou', 'recusou']
                when 'retorno' then array['agendou']
                when 'conector' then array['respondeu', 'falhou']
                when 'registrar' then array['registrado', 'falhou']
                when 'link' then array['enviado']
                else array['sim', 'nao'] end;
            if tipo = 'identidade' and p ? 'conector_id' and jsonb_typeof(p -> 'conector_id') <> 'null' then
                obrig := obrig || 'falhou'::text;
            end if;
            if tipo = any (ouvem) then
                validos := validos || 'silencio'::text;      -- SQL 95: "Se não ouvir nada", opcional
            end if;
        end if;
        qs := '{}';
        for s in select x from jsonb_array_elements(b -> 'saidas') x loop
            if jsonb_typeof(s) <> 'object'
               or exists (select 1 from jsonb_object_keys(s) k where k not in ('rotulo', 'para', 'tipo', 'quando'))
               or not (s ? 'rotulo' and s ? 'para' and s ? 'tipo' and s ? 'quando')
               or not coalesce(jsonb_typeof(s -> 'rotulo') = 'string' and char_length(s ->> 'rotulo') between 1 and 60, false)
               or not coalesce(jsonb_typeof(s -> 'para') = 'string' and (s ->> 'para') ~ '^N[0-9]{1,3}$', false)
               or not public.fluxo_voz_aux_em(s -> 'tipo', array['normal', 'devolve', 'falha'])
               or not public.fluxo_voz_aux_codigo(s -> 'quando')
               or (tipo <> 'generativa' and (s ->> 'quando') <> all (validos))
               or ((s ->> 'tipo') = 'devolve') <> (tipo = 'generativa')
               or ((s ->> 'tipo') = 'falha') <> ((s ->> 'quando') = 'falhou') then
                out := out || ('saida_invalida:' || bid);
                continue;
            end if;
            qs := qs || (s ->> 'quando');
            if (s ->> 'para') <> all (ids) then
                out := out || ('saida_inexistente:' || bid);
            end if;
        end loop;
        if cardinality(qs) <> (select count(distinct x) from unnest(qs) x) then
            out := out || ('saida_invalida:' || bid);
        end if;
        if not (obrig <@ qs) then
            out := out || ('saida_faltando:' || bid);
        end if;
    end loop;

    -- grafo (só saídas com destino existente)
    for b in select x from jsonb_array_elements(d -> 'blocos') x loop
        if jsonb_typeof(b -> 'saidas') = 'array' then
            for s in select x from jsonb_array_elements(b -> 'saidas') x loop
                if jsonb_typeof(s) = 'object' and jsonb_typeof(s -> 'para') = 'string' and (s ->> 'para') = any (ids)
                   and jsonb_typeof(s -> 'quando') = 'string' then
                    eo := eo || (b ->> 'id');
                    eq := eq || (s ->> 'quando');
                    ep := ep || (s ->> 'para');
                end if;
            end loop;
        end if;
    end loop;
    select count(*), min(x ->> 'id') into n, ini from jsonb_array_elements(d -> 'blocos') x where x ->> 'tipo' = 'abertura';
    if n = 0 then
        out := out || 'abertura_ausente'::text;
    elsif n > 1 then
        out := out || 'abertura_repetida'::text;
    else
        alc := public.fluxo_voz_aux_alcance(eo, eq, ep, ini, '{}', true);
        foreach i in array ids loop
            if i <> all (alc) then
                out := out || ('inalcancavel:' || i);
            end if;
        end loop;
        -- terceiro: recado neutro fixo e encerra
        for j in select ep[k] from generate_subscripts(eo, 1) k where eo[k] = ini and eq[k] = 'terceiro' loop
            select x into b from jsonb_array_elements(d -> 'blocos') x where x ->> 'id' = j;
            if b ->> 'tipo' <> 'encerrar' or b -> 'params' ->> 'resultado' is distinct from 'recado'
               or jsonb_typeof(b -> 'params') <> 'object' then
                out := out || 'terceiro_sem_recado'::text;
            end if;
        end loop;
        -- trava: valor, oferta ou credor só depois de Confirmar identidade, em todos os caminhos
        identidades := array(select x ->> 'id' from jsonb_array_elements(d -> 'blocos') x where x ->> 'tipo' = 'identidade');
        alc := public.fluxo_voz_aux_alcance(eo, eq, ep, ini, identidades, true);
        for b in select x from jsonb_array_elements(d -> 'blocos') x where x ->> 'id' = any (alc) loop
            if public.fluxo_voz_aux_sensivel(b) then
                out := out || ('valor_antes_identidade:' || (b ->> 'id'));
            end if;
        end loop;
    end if;

    -- ciclos: cada componente com volta precisa de um bloco com repetir_max
    foreach i in array ids loop
        mapa := mapa || jsonb_build_object(i, to_jsonb(public.fluxo_voz_aux_alcance(eo, eq, ep, i, '{}', false)));
    end loop;
    for i in select x from unnest(ids) x order by substr(x, 2)::int loop
        if i = any (feitos) or not (mapa -> i ? i) then
            continue;
        end if;
        comp := array(select j2 from jsonb_array_elements_text(mapa -> i) j2 where mapa -> j2 ? i) || i;
        feitos := feitos || comp;
        if not exists (select 1 from jsonb_array_elements(d -> 'blocos') x where x ->> 'id' = any (comp) and x ? 'repetir_max') then
            out := out || ('ciclo_sem_limite:' || (select c from unnest(comp) c order by substr(c, 2)::int limit 1));
        end if;
    end loop;

    return array(select distinct x collate "C" from unnest(out) x order by 1);
end $$;

comment on function public.fluxo_voz_erros(jsonb) is
    'Erros do fluxo (esquema 1), como voz/fluxo_validador.erros. SQL 95: params nao_entendi/silencio {fala, vezes} e a '
    'saída silencio nas etapas que ouvem.';
