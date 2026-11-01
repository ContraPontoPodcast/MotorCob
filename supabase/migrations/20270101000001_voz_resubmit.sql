-- SQL 65 · Renitência por situação, regra de discagem por sinalização, modo de discagem (vertical × horizontal com
-- spins), Reenviar agora, Reciclar mailing e Contato por passada
-- Protótipo funcional aprovado pelo dono (ux/renitencia-prototipo-funcional.html, necessidades R1 a R16) e decisões de
-- 01/11/2026:
-- * Um intervalo só por situação: por_sinalizacao.<sinalização>.rediscar.depois_min (não há outro).
-- * Tentativas por número: 3 para a carteira que salvar a regra nova (por_sinalizacao ou modo_discagem); sem ela, 2.
-- * Horizontal: spin N → telefone N por padrão.
-- * Prioridade "topo" fura a fila das 1ªs tentativas (muda a regra 5 do agendador).
-- * "Fora de área/desligado" (indisponivel) é falha técnica: não conta no descanso e nunca penaliza o número
--   (motor/voz.py); falha técnica continua contando como tentativa do dia.
-- * "Reenviar agora" (reenviar_lote_voz) e "Reciclar mailing" (reciclar_lote_voz): Admin e Operação por padrão.
-- * Tudo dentro de credores.discagem: uma validação, um histórico de versões, uma auditoria.
--
-- R1  credores.discagem: por_situacao {situação: {max_dia, conta_descanso}}, falhas_tecnicas {falha: {aviso}},
--     chamadas_curtas.falha_conta. Validação: discagem_erros() (regras geradas de motor/discagem.py;
--     tests/test_resubmit.py confere) e discagem_padrao() (o padrão MotorCX que o site mostra).
-- R2  regras_voz_versoes + R2b salvar_discagem() (editar_credores, conflito de versão, validação, versão nova).
-- R3  por_sinalizacao {sinalização: {finaliza, rediscar: {ativo, depois_min 0–600, max 1–9, prioridade
--     topo|normal|fim}, depois: {acao proximo_telefone|proximo_cliente|finaliza, espera_min 0–240}, ate HH:MM}}. Fixos
--     (recusados se mudados): pediu retorno finaliza; inexistente e pessoa errada não rediscam. CPC, promessa, recusa e
--     "não ligar" finalizam e sem crédito e bloqueio pausam a rota (não são linhas). Sem a chave = a VM de hoje.
-- R4  voz_ondas: origem (regua|spin|rediscagem|manual|reciclagem), passada, situacao_origem, prioridade, reenvio_id;
--     voz_chamadas: passada (tentativa do cliente no dia), situacao_origem e resubmit_id.
-- R5  voz_resubmits: cada decisão (finaliza, redisca, proximo_telefone, proximo_cliente ou fora, com o motivo). Só
--     destino_hash. Leitura por empresa; escrita só pela VM (voz_vm.gravar_resubmits ou a chave do servidor), com
--     validação por linha no gatilho. Apagada com a retenção da empresa (apagar_voz_expirada).
-- R6/R7/R8  previa_reenvio_voz, voz_reenvios + pedir_reenvio_voz, permissão reenviar_lote_voz.
-- R9/R10  voz_passadas_dia (a VM agrega à noite) e contato_por_passada() (menos de 30 chamadas = taxa nula).
-- R11 modo_discagem {modo vertical|horizontal, max_telefones_dia 1–5, ordem certificado|carga|historico,
--     spins {quantidade 1–10, intervalo_min 0–600, regras [{spin, telefone t1…t5|nao_tentado|historico, inicio}]},
--     telefone_ausente proximo|pula}.
-- R12–R15 voz_reciclagens, previa_reciclagem_voz, pedir_reciclagem_voz, permissão reciclar_lote_voz.
-- R16 reciclagem_auto {ativo, hora, sem_contato_pct 10–100, excluir [cpc|promessa|recusa|pessoa_errada|retorno]};
--     uma automática por lote no dia, sempre mantendo o limite do dia.
-- R17 Pausa da rota: sem crédito (falha da operadora com SIP 402) ou bloqueio de originação pausam o tronco na hora
--     (a VM para de discar por ele, com ou sem a regra nova da carteira), a pausa fica em voz_troncos_pausas
--     (pausar_tronco_voz, da VM) e a equipe recebe o aviso (bloqueio = crítico). A retomada é manual, pela equipe com
--     gerenciar_troncos_voz (retomar_tronco_voz, com nota; quem, quando e a auditoria); a VM lê as pausas ativas
--     (troncos_pausados_voz) e volta a discar sem reiniciar.
-- R18 voz_lotes.janelas: clientes do lote por janela de discagem (UF/DDD, horário de Brasília), só contagem e UF,
--     gravado pela VM (registrar_janelas_lote_voz). A prévia da reciclagem (R13) devolve também chamadas (com as
--     rediscagens da regra), ondas, duração estimada (ritmo do lote ou concorrência), se cabe em cada janela
--     (cabe_pct) e as chamadas curtas previstas (chamada_curta_voz = motor/discagem.py › e_curta).
-- R19 execucoes.resumo.voz.resubmit: a agregação da noite (agregar_passadas_voz) grava na última execução do motor de
--     cada carteira do dia as decisões por situação e por motivo de ficar fora, por origem, pedidos e rotas pausadas
--     (resumo_resubmit_voz; só contagens).
-- VM (os dois acessos: chave do servidor e papel motorcx_voz): regras_discagem_voz, lote_voz_do_dia,
--     registrar_onda_voz, pegar_reenvio_voz, concluir_reenvio_voz, pegar_reciclagem_voz, registrar_reciclagem_auto_voz,
--     concluir_reciclagem_voz, agregar_passadas_voz, pausar_tronco_voz, troncos_pausados_voz e
--     registrar_janelas_lote_voz (as do public aceitam só o servidor e a VM; as de voz_vm, só o
--     motorcx_voz), e gravar_chamadas com passada, situacao_origem e resubmit_id.
-- LGPD: nenhuma coluna nova guarda CPF, nome ou telefone. Telefone só em hash (sha-256 em hex).
-- Depende dos SQL 51 (discagem do credor), 56 (voz), 57 (voz_vm) e 58 (gravar_chamadas com o fluxo). Se o 57 ou o
-- 58 for rodado de novo, rode este depois. Pode rodar de novo sem erro. Não precisa de superusuário.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('regras_voz_versoes',
--             'voz_resubmits', 'voz_reenvios', 'voz_reciclagens', 'voz_passadas_dia', 'voz_troncos_pausas')) as tabelas, -- 6
--          (select count(*) from pg_tables where schemaname = 'public' and tablename in ('regras_voz_versoes',
--             'voz_resubmits', 'voz_reenvios', 'voz_reciclagens', 'voz_passadas_dia', 'voz_troncos_pausas')
--             and not rowsecurity) as sem_rls,                                                                   -- 0
--          (select count(*) from information_schema.columns where table_schema = 'public'
--             and ((table_name = 'voz_chamadas' and column_name in ('passada', 'situacao_origem', 'resubmit_id'))
--               or (table_name = 'voz_ondas' and column_name in ('origem', 'passada', 'situacao_origem',
--                                                                'prioridade', 'reenvio_id')))) as colunas,        -- 8
--          (select count(*) from public.permissoes_catalogo
--             where codigo in ('reenviar_lote_voz', 'reciclar_lote_voz')) as permissoes,                           -- 2
--          cardinality(public.discagem_erros('{"por_sinalizacao": {"ocupado": {"rediscar": {"max": 99}}}}')) as erro, -- 1
--          public.discagem_padrao() -> 'por_sinalizacao' -> 'nao_atendida' -> 'rediscar' ->> 'depois_min' as na,   -- 60
--          has_function_privilege('motorcx_voz', 'voz_vm.pegar_reciclagem(jsonb)', 'execute') as vm_recicla,       -- true
--          has_function_privilege('motorcx_voz', 'voz_vm.pausar_tronco(jsonb)', 'execute') as vm_pausa,            -- true
--          public.chamada_curta_voz('nao_atendida', null) as curta,                                              -- true
--          has_table_privilege('anon', 'public.voz_resubmits', 'select') as anon_le;                               -- false

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

-- ================================================================ 1. situações (motor/discagem.py)
-- as 15 situações da Renitência/Resubmit: 8 do dono + 7 falhas técnicas (sem_credito = falha_operadora com SIP 402)
create or replace function public.situacoes_resubmit_voz() returns text[]
language sql immutable parallel safe as $$
    select array['maquina', 'nao_atendida', 'ocupado', 'caixa_postal', 'desligou_sem_conversar', 'retorno_agendado',
                 'atendeu_desligou', 'numero_incorreto', 'falha_operadora', 'sem_credito', 'falha_rede', 'indisponivel',
                 'bloqueio_originacao', 'cancelada_discador', 'abandonada']::text[]
$$;

-- desfecho de voz -> situação (= motor/discagem.situacao_de); nulo = houve contato ou pedido (não volta)
create or replace function public.situacao_voz(resultado text, causa_sip int default null) returns text
language sql immutable parallel safe as $$
    select case
        when resultado in ('numero_inexistente', 'inexistente_voz', 'atendida_terceiro_desconhece') then 'numero_incorreto'
        when resultado = 'falha_operadora' and causa_sip = 402 then 'sem_credito'
        when resultado = any (public.situacoes_resubmit_voz()) then resultado
    end
$$;

-- desfechos que finalizam o cliente sempre (= motor/discagem.py › FINALIZA_SEMPRE): houve contato de verdade ou
-- pedido explícito. O resto (recado, pessoa errada…) é linha da regra por sinalização.
create or replace function public.encerra_cliente_voz() returns text[]
language sql immutable parallel safe as $$
    select array['cpc', 'identidade_confirmada', 'promessa', 'recusa', 'opt_out', 'atendida_sem_cpc']::text[]
$$;

-- ================================================================ 2. validação e padrão (R1, R3)
-- regras geradas de motor/discagem.py (_INTEIROS, _SUB, _SUB_SITUACAO, _SUB_FALHA, _SUB_RESUBMIT e as chaves de
-- PADRAO). tests/test_resubmit.py confere que este JSON é o do motor.
create or replace function public.discagem_regras() returns jsonb
language sql immutable parallel safe as $$
    select '{"_inteiros":{"tentativas_numero_dia":["int",1,10],"tentativas_cliente_dia":["int",1,10],"intervalo_min_minutos":["int",0,1440],"intervalo_ocupado_minutos":["int",0,1440]},"_blocos":{"descanso_nao_atende":{"ativo":"bool","n":["int",1,50],"em_dias":["int",1,60],"descansa_dias":["int",1,365]},"descanso_recusa":{"ativo":"bool","dias":["int",1,365]},"promessa_suspende":{"ativo":"bool","dias_sem_data":["int",1,90]},"inexistente":{"ativo":"bool","modo":["enum","so_voz","invalida"],"so_voz_desde":"data","confirmacoes":["int",1,10],"reteste_dias":["int",1,90],"max_retestes":["int",0,10],"sinal_outros_canais":"bool","aceita_tipo_b":"bool","trava_lote_ativo":"bool","trava_lote_minimo":["int",1,1000000],"trava_lote_fracao":"fracao","trava_lote_relativa":["real",1.0,20.0],"trava_lote_pp_min":"fracao","trava_rota_minimo":["int",1,1000000]},"agente_ia":{"peso_cpc":["real",0.0,2.0],"peso_cpc_sem_identidade":["real",0.0,2.0]},"retorno_agendado":{"ativo":"bool","max_dias":["int",1,60],"sem_hora_dias":["int",0,30],"de":"hora","ate":"hora"},"nao_ligar":{"ativo":"bool"},"chamadas_curtas":{"ativo":"bool","aviso":"fracao","corte_ativo":"bool","corte":"fracao","max_por_numero_dia":["int",1,1000000],"max_total_dia":["int",1,100000000],"abandono_conta":"bool","segundos":["int",1,60],"falha_conta":"bool"}},"por_situacao":{"chaves":["maquina","nao_atendida","ocupado","caixa_postal","desligou_sem_conversar","atendeu_desligou"],"campos":{"max_dia":["int",1,10],"conta_descanso":"bool"}},"falhas_tecnicas":{"chaves":["falha_operadora","sem_credito","falha_rede","indisponivel","bloqueio_originacao","cancelada_discador","abandonada"],"campos":{"aviso":"fracao"}},"por_sinalizacao":{"chaves":["maquina","nao_atendida","ocupado","caixa_postal","desligou_sem_conversar","retorno_agendado","atendeu_desligou","numero_inexistente","pessoa_errada","recado","falha_operadora","falha_rede","indisponivel","cancelada_discador","abandonada"],"campos":{"finaliza":"bool","rediscar":{"ativo":"bool","depois_min":["int",0,600],"max":["int",1,9],"prioridade":["enum","topo","normal","fim"]},"depois":{"acao":["enum","proximo_telefone","proximo_cliente","finaliza"],"espera_min":["int",0,240]},"ate":"hora"}},"modo_discagem":{"campos":{"modo":["enum","vertical","horizontal"],"max_telefones_dia":["int",1,5],"ordem":["enum","certificado","carga","historico"],"telefone_ausente":["enum","proximo","pula"]},"spins":{"quantidade":["int",1,10],"intervalo_min":["int",0,600]},"telefones":["t1","t2","t3","t4","t5","nao_tentado","historico"]},"reciclagem_auto":{"campos":{"ativo":"bool","hora":"hora","sem_contato_pct":["int",10,100]},"excluir":["cpc","promessa","recusa","pessoa_errada","retorno"]},"_chaves":["agente_ia","chamadas_curtas","descanso_nao_atende","descanso_recusa","falhas_tecnicas","horarios","inexistente","intervalo_min_minutos","intervalo_ocupado_minutos","modo_discagem","nao_ligar","por_sinalizacao","por_situacao","promessa_suspende","reciclagem_auto","retorno_agendado","tentativas_cliente_dia","tentativas_numero_dia"]}'::jsonb
$$;

-- o padrão MotorCX que o site mostra (= motor/discagem.padrao_site(); o teste confere): os valores de hoje por
-- situação e falha técnica e o Resubmit sugerido (que só vale quando a carteira salva o bloco resubmit)
create or replace function public.discagem_padrao() returns jsonb
language sql immutable parallel safe as $$
    select '{"tentativas_numero_dia":2,"tentativas_numero_dia_regra_nova":3,"tentativas_cliente_dia":3,"intervalo_min_minutos":120,"intervalo_ocupado_minutos":15,"por_situacao":{"maquina":{"max_dia":2,"conta_descanso":true},"nao_atendida":{"max_dia":2,"conta_descanso":true},"ocupado":{"max_dia":2,"conta_descanso":true},"caixa_postal":{"max_dia":2,"conta_descanso":true},"desligou_sem_conversar":{"max_dia":2,"conta_descanso":false},"atendeu_desligou":{"max_dia":2,"conta_descanso":false}},"falhas_tecnicas":{"falha_operadora":{"aviso":0.15},"sem_credito":{"aviso":0.01},"falha_rede":{"aviso":0.05},"indisponivel":{"aviso":0.2},"bloqueio_originacao":{"aviso":0.01},"cancelada_discador":{"aviso":0.05},"abandonada":{"aviso":0.03}},"por_sinalizacao":{"maquina":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":120,"max":1,"prioridade":"fim"},"depois":{"acao":"proximo_cliente","espera_min":0},"ate":"19:00"},"nao_atendida":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":60,"max":2,"prioridade":"normal"},"depois":{"acao":"proximo_cliente","espera_min":0},"ate":"19:30"},"ocupado":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":15,"max":2,"prioridade":"topo"},"depois":{"acao":"proximo_cliente","espera_min":0},"ate":"19:30"},"caixa_postal":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":120,"max":1,"prioridade":"fim"},"depois":{"acao":"proximo_cliente","espera_min":0},"ate":"19:00"},"desligou_sem_conversar":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":90,"max":1,"prioridade":"normal"},"depois":{"acao":"proximo_telefone","espera_min":0},"ate":"19:00"},"retorno_agendado":{"finaliza":true,"rediscar":{"ativo":false,"depois_min":0,"max":1,"prioridade":"topo"},"depois":{"acao":"finaliza","espera_min":0},"ate":"20:00"},"atendeu_desligou":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":120,"max":1,"prioridade":"normal"},"depois":{"acao":"proximo_cliente","espera_min":0},"ate":"19:00"},"numero_inexistente":{"finaliza":false,"rediscar":{"ativo":false,"depois_min":0,"max":1,"prioridade":"normal"},"depois":{"acao":"proximo_telefone","espera_min":0},"ate":"19:30"},"pessoa_errada":{"finaliza":false,"rediscar":{"ativo":false,"depois_min":0,"max":1,"prioridade":"normal"},"depois":{"acao":"proximo_telefone","espera_min":0},"ate":"19:30"},"recado":{"finaliza":true,"rediscar":{"ativo":false,"depois_min":120,"max":1,"prioridade":"normal"},"depois":{"acao":"proximo_cliente","espera_min":0},"ate":"19:00"},"falha_operadora":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":30,"max":1,"prioridade":"topo"},"depois":{"acao":"proximo_telefone","espera_min":0},"ate":"19:30"},"falha_rede":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":30,"max":1,"prioridade":"topo"},"depois":{"acao":"proximo_telefone","espera_min":0},"ate":"19:30"},"indisponivel":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":30,"max":1,"prioridade":"normal"},"depois":{"acao":"proximo_telefone","espera_min":0},"ate":"19:30"},"cancelada_discador":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":30,"max":1,"prioridade":"topo"},"depois":{"acao":"proximo_telefone","espera_min":0},"ate":"19:30"},"abandonada":{"finaliza":false,"rediscar":{"ativo":true,"depois_min":0,"max":1,"prioridade":"topo"},"depois":{"acao":"proximo_cliente","espera_min":0},"ate":"19:30"}},"sinalizacao_vertical":{"maquina":"proximo_telefone","nao_atendida":"proximo_telefone","caixa_postal":"proximo_telefone"},"modo_discagem":{"modo":"horizontal","max_telefones_dia":1,"ordem":"certificado","telefone_ausente":"proximo","spins":{"quantidade":3,"intervalo_min":120,"regras":[{"spin":1,"telefone":"t1","inicio":null},{"spin":2,"telefone":"t2","inicio":null},{"spin":3,"telefone":"t3","inicio":null}]}},"reciclagem_auto":{"ativo":false,"hora":"16:00","sem_contato_pct":60,"excluir":["cpc","recusa","pessoa_errada","retorno"]},"retorno_agendado":{"max_dias":7},"chamadas_curtas":{"falha_conta":true}}'::jsonb
$$;

-- um valor contra uma regra ("bool", "fracao", "data", "hora", ["int", lo, hi], ["real", lo, hi], ["enum", ...]).
-- Só tipos JSON (o site manda número e booleano de verdade): é a mesma faixa do motor, sem os apelidos de texto.
create or replace function public.discagem_valor_ok(v jsonb, regra jsonb) returns boolean
language plpgsql immutable as $$
declare x numeric; t text;
begin
    if jsonb_typeof(regra) = 'string' then
        t := regra #>> '{}';
        if t = 'bool' then
            return jsonb_typeof(v) = 'boolean';
        elsif t = 'fracao' then
            if jsonb_typeof(v) <> 'number' then return false; end if;
            x := (v #>> '{}')::numeric;
            x := case when x > 1 then x / 100 else x end;          -- 75 = 75%, como o motor
            return x > 0 and x <= 1;
        elsif t = 'hora' then
            return jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
        elsif t = 'data' then
            if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
            begin
                perform (v #>> '{}')::date;
                return true;
            exception when others then
                return false;
            end;
        end if;
        return false;
    end if;
    t := regra ->> 0;
    if t = 'enum' then
        return jsonb_typeof(v) = 'string' and exists (select 1 from jsonb_array_elements_text(regra) with ordinality e(o, i)
                                                      where i > 1 and o = v #>> '{}');
    end if;
    if jsonb_typeof(v) <> 'number' then return false; end if;
    x := (v #>> '{}')::numeric;
    if t = 'int' and x <> trunc(x) then return false; end if;
    return x between (regra ->> 1)::numeric and (regra ->> 2)::numeric;
end $$;

-- campos de um objeto contra as regras (subobjeto = regras aninhadas, como rediscar e depois da sinalização)
create or replace function public.discagem_campos_erros(v jsonb, regras jsonb, onde text) returns text[]
language plpgsql immutable as $$
declare erros text[] := '{}'; k text; x jsonb; regra jsonb;
begin
    if jsonb_typeof(v) <> 'object' then
        return array[onde || ': precisa ser um objeto'];
    end if;
    for k, x in select * from jsonb_each(v) loop
        continue when k like '\_%';
        regra := regras -> k;
        if regra is null then
            erros := erros || (onde || ': ''' || k || ''' não existe');
        elsif jsonb_typeof(regra) = 'object' then
            erros := erros || public.discagem_campos_erros(x, regra, onde || '/' || k);
        elsif not public.discagem_valor_ok(x, regra) then
            erros := erros || (onde || '/' || k || ': fora da faixa');
        end if;
    end loop;
    return erros;
end $$;

-- modo de discagem (R11): campos, spins {quantidade, intervalo_min, regras [{spin, telefone, inicio}]}; uma regra por
-- spin até a quantidade, inícios crescentes dentro de 08:00–20:00
create or replace function public.discagem_modo_erros(v jsonb, regras jsonb) returns text[]
language plpgsql immutable as $$
declare erros text[]; s jsonb; q int; e jsonb; vistos int[] := '{}'; ultimo text := '';
begin
    if jsonb_typeof(v) <> 'object' then
        return array['modo_discagem: precisa ser um objeto'];
    end if;
    erros := public.discagem_campos_erros(v - 'spins', regras -> 'campos', 'modo_discagem');
    s := v -> 'spins';
    if s is null then
        return erros;
    end if;
    if jsonb_typeof(s) <> 'object' then
        return erros || 'modo_discagem/spins: precisa ser um objeto'::text;
    end if;
    erros := erros || public.discagem_campos_erros(s - 'regras', regras -> 'spins', 'modo_discagem/spins');
    q := case when jsonb_typeof(s -> 'quantidade') = 'number' then (s ->> 'quantidade')::numeric::int else 3 end;
    if s ? 'regras' then
        if jsonb_typeof(s -> 'regras') <> 'array' then
            return erros || 'modo_discagem/spins/regras: precisa ser uma lista'::text;
        end if;
        for e in select x from jsonb_array_elements(s -> 'regras') x loop
            if jsonb_typeof(e) <> 'object' or not public.discagem_valor_ok(e -> 'spin', jsonb_build_array('int', 1, q))
               or (e ->> 'spin')::numeric::int = any (vistos)
               or not (regras -> 'telefones') @> jsonb_build_array(e -> 'telefone')
               or (e -> 'inicio' is not null and e -> 'inicio' <> 'null'::jsonb
                   and (not public.discagem_valor_ok(e -> 'inicio', '"hora"') or e ->> 'inicio' < '08:00'
                        or e ->> 'inicio' > '20:00' or e ->> 'inicio' <= ultimo)) then
                erros := erros || 'modo_discagem/spins/regras: uma por spin (até a quantidade), telefone t1–t5, não tentado ou histórico, início crescente entre 08:00 e 20:00'::text;
                exit;
            end if;
            vistos := vistos || (e ->> 'spin')::numeric::int;
            ultimo := coalesce(nullif(e ->> 'inicio', ''), ultimo);
        end loop;
    end if;
    return erros;
end $$;

-- erros do bloco discagem (vazio = vale). Chave desconhecida é erro aqui (o motor só avisa e ignora): o que o site
-- grava tem de ser entendido inteiro.
create or replace function public.discagem_erros(d jsonb) returns text[]
language plpgsql immutable as $$
declare
    r jsonb := public.discagem_regras();
    erros text[] := '{}';
    k text; v jsonb; kk text; vv jsonb; kkk text; vvv jsonb; regra jsonb;
begin
    if d is null then
        return erros;
    end if;
    if jsonb_typeof(d) <> 'object' then
        return array['discagem: precisa ser um objeto'];
    end if;
    for k, v in select * from jsonb_each(d) loop
        continue when k like '\_%';
        if k = 'spins_discador_dia' then k := 'tentativas_cliente_dia'; end if;
        if k = 'descanso_recusa_dias' then
            if not (v = 'null'::jsonb or public.discagem_valor_ok(v, '["int", 0, 365]')) then
                erros := erros || ('descanso_recusa_dias: use um número de 0 a 365');
            end if;
            continue;
        end if;
        if not (r -> '_chaves') ? k then
            erros := erros || (k || ': não existe');
        elsif r -> '_inteiros' ? k then
            if not ((k = 'tentativas_cliente_dia' and v = 'null'::jsonb) or public.discagem_valor_ok(v, r -> '_inteiros' -> k)) then
                erros := erros || (k || ': fora da faixa');
            end if;
        elsif k = 'horarios' then
            if jsonb_typeof(v) = 'object' then
                if v ? 'ativo' and jsonb_typeof(v -> 'ativo') <> 'boolean' then
                    erros := erros || 'horarios/ativo: use sim/não'::text;
                end if;
                if v ? 'tabela' and jsonb_typeof(v -> 'tabela') not in ('object', 'null') then
                    erros := erros || 'horarios/tabela: precisa ser um objeto'::text;
                end if;
            elsif jsonb_typeof(v) <> 'boolean' then
                erros := erros || 'horarios: use sim/não ou um objeto'::text;
            end if;
        elsif k in ('por_situacao', 'falhas_tecnicas', 'por_sinalizacao') then
            if jsonb_typeof(v) <> 'object' then
                erros := erros || (k || ': precisa ser um objeto');
                continue;
            end if;
            for kk, vv in select * from jsonb_each(v) loop
                continue when kk like '\_%';
                if not (r -> k -> 'chaves') ? kk then
                    erros := erros || (k || '/' || kk || ': não existe');
                else
                    erros := erros || public.discagem_campos_erros(vv, r -> k -> 'campos', k || '/' || kk);
                end if;
            end loop;
            -- regras fixas da sinalização: pediu retorno finaliza; inexistente e pessoa errada não rediscam
            if k = 'por_sinalizacao' then
                if v -> 'retorno_agendado' -> 'finaliza' = 'false'::jsonb then
                    erros := erros || 'por_sinalizacao/retorno_agendado/finaliza: regra fixa (pediu retorno finaliza)'::text;
                end if;
                if v -> 'numero_inexistente' -> 'rediscar' -> 'ativo' = 'true'::jsonb
                   or v -> 'pessoa_errada' -> 'rediscar' -> 'ativo' = 'true'::jsonb then
                    erros := erros || 'por_sinalizacao: inexistente e pessoa errada não rediscam (regra fixa)'::text;
                end if;
            end if;
        elsif k = 'modo_discagem' then
            erros := erros || public.discagem_modo_erros(v, r -> 'modo_discagem');
        elsif k = 'reciclagem_auto' then
            if jsonb_typeof(v) <> 'object' then
                erros := erros || 'reciclagem_auto: precisa ser um objeto'::text;
                continue;
            end if;
            erros := erros || public.discagem_campos_erros(v - 'excluir', r -> 'reciclagem_auto' -> 'campos', k);
            if v ? 'excluir' and (jsonb_typeof(v -> 'excluir') <> 'array'
                                 or exists (select 1 from jsonb_array_elements(v -> 'excluir') e
                                             where not (r -> 'reciclagem_auto' -> 'excluir') @> jsonb_build_array(e))) then
                erros := erros || 'reciclagem_auto/excluir: use cpc, promessa, recusa, pessoa_errada ou retorno'::text;
            end if;
            if jsonb_typeof(v -> 'hora') = 'string' and (v ->> 'hora' < '08:00' or v ->> 'hora' > '20:00') then
                erros := erros || 'reciclagem_auto/hora: entre 08:00 e 20:00'::text;
            end if;
        else
            if jsonb_typeof(v) <> 'object' then
                v := jsonb_build_object('ativo', v);
            end if;
            for kk, vv in select * from jsonb_each(v) loop
                continue when kk like '\_%';
                regra := r -> '_blocos' -> k -> kk;
                if regra is null then
                    erros := erros || (k || ': ''' || kk || ''' não existe');
                elsif not public.discagem_valor_ok(vv, regra) then
                    erros := erros || (k || '/' || kk || ': fora da faixa');
                end if;
            end loop;
        end if;
    end loop;
    return erros;
end $$;

revoke all on function public.situacoes_resubmit_voz(), public.situacao_voz(text, int), public.encerra_cliente_voz(),
    public.discagem_regras(), public.discagem_padrao(), public.discagem_valor_ok(jsonb, jsonb),
    public.discagem_campos_erros(jsonb, jsonb, text), public.discagem_modo_erros(jsonb, jsonb),
    public.discagem_erros(jsonb) from public, anon;
grant execute on function public.situacoes_resubmit_voz(), public.situacao_voz(text, int), public.encerra_cliente_voz(),
    public.discagem_regras(), public.discagem_padrao(), public.discagem_valor_ok(jsonb, jsonb),
    public.discagem_campos_erros(jsonb, jsonb, text), public.discagem_modo_erros(jsonb, jsonb),
    public.discagem_erros(jsonb) to authenticated, service_role;

-- ================================================================ 3. versões das regras de discagem (R2, R2b)
create table if not exists public.regras_voz_versoes (
    id          bigint generated always as identity primary key,
    empresa_id  bigint not null references public.empresas (id) on delete cascade,
    credor_id   bigint not null references public.credores (id) on delete cascade,
    versao      int not null check (versao >= 1),
    regras      jsonb check (regras is null or jsonb_typeof(regras) = 'object'),
    resumo      text[] not null default '{}' check (cardinality(resumo) <= 200),
    motivo      text check (char_length(motivo) <= 200),
    criado_por  uuid references auth.users (id) on delete set null,
    criado_em   timestamptz not null default now(),
    unique (empresa_id, credor_id, versao)
);
comment on table public.regras_voz_versoes is
    'Histórico das regras de discagem da carteira (credores.discagem inteiro em cada versão). Só salvar_discagem grava.';
alter table public.regras_voz_versoes enable row level security;
drop policy if exists regras_voz_versoes_ver on public.regras_voz_versoes;
create policy regras_voz_versoes_ver on public.regras_voz_versoes for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.regras_voz_versoes from anon;
revoke insert, update, delete on public.regras_voz_versoes from authenticated;

-- texto livre sem CPF, telefone ou e-mail (motivo e resumo do histórico)
create or replace function public.texto_sem_dado_pessoal(t text) returns boolean
language sql immutable parallel safe as $$
    select t is null or not (t ~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}' or t ~ '\(?\d{2}\)?\s?9?\s?\d{4}[ -]?\d{4}'
                             or t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}')
$$;

create or replace function public.salvar_discagem(credor bigint, regras jsonb, versao_base int, motivo text default null,
                                                  resumo text[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
    k public.credores;
    atual int;
    erros text[];
    nova int;
begin
    select * into k from public.credores c where c.id = credor;
    if k.id is null or k.empresa_id not in (select public.minhas_empresas()) then
        raise exception 'carteira não encontrada';
    end if;
    if not public.pode('editar_credores') then
        raise exception 'sem permissão para editar a discagem da carteira';
    end if;
    if regras is not null and jsonb_typeof(regras) <> 'object' then
        raise exception 'regras: precisa ser um objeto';
    end if;
    erros := public.discagem_erros(regras);
    if cardinality(erros) > 0 then
        raise exception 'regras inválidas: %', array_to_string(erros, '; ');
    end if;
    if char_length(motivo) > 200 or not public.texto_sem_dado_pessoal(motivo) then
        raise exception 'motivo: até 200 caracteres, sem CPF, telefone ou e-mail';
    end if;
    if cardinality(resumo) > 200 or exists (select 1 from unnest(resumo) x
                                            where char_length(x) > 300 or not public.texto_sem_dado_pessoal(x)) then
        raise exception 'resumo inválido';
    end if;
    perform 1 from public.credores c where c.id = k.id for update;      -- uma gravação por vez na carteira
    select coalesce(max(v.versao), 0) into atual from public.regras_voz_versoes v
     where v.empresa_id = k.empresa_id and v.credor_id = k.id;
    if coalesce(versao_base, 0) <> atual then
        raise exception 'outra pessoa salvou a versão % enquanto você editava: recarregue a página', atual;
    end if;
    if atual = 0 then          -- a 1ª gravação guarda como v1 o que valia antes (padrão ou o que já estava gravado)
        insert into public.regras_voz_versoes (empresa_id, credor_id, versao, regras, resumo)
        values (k.empresa_id, k.id, 1, k.discagem,
                case when k.discagem is null or k.discagem = '{}'::jsonb then array['Padrão MotorCX']
                     else array['Regras em uso antes do histórico de versões'] end);
        atual := 1;
    end if;
    nova := atual + 1;
    update public.credores c set discagem = case when regras = '{}'::jsonb then null else regras end
     where c.id = k.id;
    insert into public.regras_voz_versoes (empresa_id, credor_id, versao, regras, resumo, motivo, criado_por)
    values (k.empresa_id, k.id, nova, case when regras = '{}'::jsonb then null else regras end,
            coalesce(resumo, '{}'), nullif(btrim(motivo), ''), auth.uid());
    return nova;
end $$;
revoke all on function public.salvar_discagem(bigint, jsonb, int, text, text[]) from public, anon;
grant execute on function public.salvar_discagem(bigint, jsonb, int, text, text[]) to authenticated;
revoke all on function public.texto_sem_dado_pessoal(text) from public, anon;
grant execute on function public.texto_sem_dado_pessoal(text) to authenticated, service_role;

-- ================================================================ 4. permissão nova (R8): Admin e Operação
-- O catálogo é uma view de valores que outros SQL recriam inteira: aqui só ACRESCENTA a linha, se ainda não está.
do $$
declare
    def text;
    prox int;
begin
    if not exists (select 1 from public.permissoes_catalogo where codigo = 'reenviar_lote_voz') then
        def := rtrim(btrim(pg_get_viewdef('public.permissoes_catalogo'::regclass)), ';');
        prox := coalesce((select max(ordem) from public.permissoes_catalogo), 0) + 1;
        execute format('create or replace view public.permissoes_catalogo as %s union all select %L::text, %L::text, '
                       '%L::text, %L::text, true, false, true, false, %s', def, 'reenviar_lote_voz', 'Agente virtual',
                       'Reenviar números do lote',
                       'Reenviar agora, no lote do dia do agente virtual, os números sem contato (mesmas regras do Resubmit).',
                       prox);
    end if;
end $$;
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- ================================================================ 5. ondas e chamadas (R4)
alter table public.voz_ondas add column if not exists origem text;
alter table public.voz_ondas add column if not exists passada int;
alter table public.voz_ondas add column if not exists situacao_origem text;
alter table public.voz_ondas add column if not exists prioridade text;
alter table public.voz_ondas drop constraint if exists voz_ondas_origem_check;
alter table public.voz_ondas add constraint voz_ondas_origem_check
    check (origem is null or origem in ('regua', 'spin', 'rediscagem', 'manual', 'reciclagem'));
alter table public.voz_ondas drop constraint if exists voz_ondas_passada_check;
alter table public.voz_ondas add constraint voz_ondas_passada_check check (passada is null or passada between 1 and 50);
alter table public.voz_ondas drop constraint if exists voz_ondas_situacao_origem_check;
alter table public.voz_ondas add constraint voz_ondas_situacao_origem_check
    check (situacao_origem is null or situacao_origem = any (public.situacoes_resubmit_voz()));
alter table public.voz_ondas drop constraint if exists voz_ondas_prioridade_check;
alter table public.voz_ondas add constraint voz_ondas_prioridade_check
    check (prioridade is null or prioridade in ('topo', 'normal', 'fim'));
comment on column public.voz_ondas.origem is
    'regua (1ª passada e a retentativa de hoje), spin (passagem N do horizontal), rediscagem (regra por sinalização), '
    'manual (Reenviar agora), reciclagem (Reciclar mailing). Nulo = onda antiga.';

alter table public.voz_chamadas add column if not exists passada int;
alter table public.voz_chamadas add column if not exists situacao_origem text;
alter table public.voz_chamadas drop constraint if exists voz_chamadas_passada_check;
alter table public.voz_chamadas add constraint voz_chamadas_passada_check check (passada is null or passada between 1 and 50);
alter table public.voz_chamadas drop constraint if exists voz_chamadas_situacao_origem_check;
alter table public.voz_chamadas add constraint voz_chamadas_situacao_origem_check
    check (situacao_origem is null or situacao_origem = any (public.situacoes_resubmit_voz()));
comment on column public.voz_chamadas.passada is '1 = primeira tentativa do número no dia; 2 em diante = voltas.';
comment on column public.voz_chamadas.situacao_origem is 'Situação da tentativa anterior que gerou esta (da 2ª passada em diante).';

-- ================================================================ 6. reenvios (R7) e decisões do Resubmit (R5)
create table if not exists public.voz_reenvios (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    credor_id     bigint references public.credores (id) on delete set null,
    lote_id       bigint not null references public.voz_lotes (id) on delete cascade,
    filtros       jsonb not null check (jsonb_typeof(filtros) = 'object'),
    prioridade    text not null default 'normal' check (prioridade in ('topo', 'normal', 'fim')),
    outro_numero  boolean not null default false,
    previa        jsonb check (previa is null or jsonb_typeof(previa) = 'object'),
    pedido_por    uuid references auth.users (id) on delete set null,
    pedido_em     timestamptz not null default now(),
    situacao      text not null default 'pendente' check (situacao in ('pendente', 'em_onda', 'concluido', 'cancelado')),
    onda_id       bigint references public.voz_ondas (id) on delete set null,
    volta_real    int check (volta_real >= 0),
    resultado     jsonb check (resultado is null or jsonb_typeof(resultado) = 'object'),
    concluido_em  timestamptz
);
create index if not exists voz_reenvios_lote on public.voz_reenvios (lote_id, pedido_em desc);
create index if not exists voz_reenvios_pendentes on public.voz_reenvios (empresa_id, pedido_em) where situacao = 'pendente';
comment on table public.voz_reenvios is
    'Reenviar agora (lote do dia do agente virtual): filtros, prévia e o que a VM fez. Só contagens.';
alter table public.voz_ondas add column if not exists reenvio_id bigint references public.voz_reenvios (id) on delete set null;

-- R12 · reciclagens do lote (manual ou automática): só filtros e contagens, nunca telefone
create table if not exists public.voz_reciclagens (
    id              bigint generated always as identity primary key,
    empresa_id      bigint not null references public.empresas (id) on delete cascade,
    credor_id       bigint references public.credores (id) on delete set null,
    lote_id         bigint not null references public.voz_lotes (id) on delete cascade,
    data            date not null,
    origem          text not null check (origem in ('manual', 'automatica')),
    escopo          text not null default 'lote' check (escopo in ('lote', 'filtro')),
    filtros         jsonb not null default '{}' check (jsonb_typeof(filtros) = 'object'),
    excluir         text[] not null default '{}' check (excluir <@ array['cpc', 'promessa', 'recusa', 'pessoa_errada', 'retorno']),
    limite_cliente  text not null default 'mantem' check (limite_cliente in ('mantem', 'recomeca')),
    previa          jsonb check (previa is null or jsonb_typeof(previa) = 'object'),
    pedido_por      uuid references auth.users (id) on delete set null,
    pedido_em       timestamptz not null default now(),
    situacao        text not null default 'pendente' check (situacao in ('pendente', 'em_onda', 'concluido', 'cancelado')),
    onda_id         bigint references public.voz_ondas (id) on delete set null,
    volta_real      int check (volta_real >= 0),
    fora_real       jsonb check (fora_real is null or jsonb_typeof(fora_real) = 'object'),
    concluido_em    timestamptz,
    check (origem = 'manual' or (pedido_por is null and limite_cliente = 'mantem'))
);
create unique index if not exists voz_reciclagens_auto_dia on public.voz_reciclagens (lote_id, data) where origem = 'automatica';
create index if not exists voz_reciclagens_lote on public.voz_reciclagens (lote_id, pedido_em desc);
create index if not exists voz_reciclagens_pendentes on public.voz_reciclagens (empresa_id, pedido_em) where situacao = 'pendente';
comment on table public.voz_reciclagens is
    'Reciclar mailing do lote do dia (manual ou automática): filtros, exclusões, limite do dia, prévia e o que a VM fez.';

create table if not exists public.voz_resubmits (
    id                 bigint generated always as identity primary key,
    ref                text not null check (ref ~ '^[0-9a-f]{32}$'),
    empresa_id         bigint not null references public.empresas (id) on delete cascade,
    credor_id          bigint references public.credores (id) on delete set null,
    lote_id            bigint references public.voz_lotes (id) on delete set null,
    id_chamada_origem  text check (id_chamada_origem ~ '^[A-Za-z0-9_.:\-]{4,80}$'),
    id_cliente         text not null check (char_length(id_cliente) between 1 and 60),
    destino_hash       text not null check (destino_hash ~ '^[0-9a-f]{64}$'),
    situacao_origem    text not null check (situacao_origem = any (public.situacoes_resubmit_voz())),
    passada            int not null check (passada between 1 and 50),
    origem             text not null check (origem in ('auto', 'manual', 'reciclagem')),
    pedido_id          bigint references public.voz_reenvios (id) on delete set null,
    reciclagem_id      bigint references public.voz_reciclagens (id) on delete set null,
    decisao            text not null check (decisao in ('finaliza', 'redisca', 'proximo_telefone', 'proximo_cliente', 'fora')),
    motivo_fora        text check (motivo_fora in ('max_dia', 'fora_horario', 'nao_ligar', 'promessa', 'inexistente',
                                                   'descanso', 'corte_curtas', 'cpc', 'recusa', 'pessoa_errada', 'retorno')),
    nao_antes_de       timestamptz,
    onda_id            bigint references public.voz_ondas (id) on delete set null,
    criado_em          timestamptz not null default now(),
    unique (empresa_id, ref),
    check ((decisao = 'fora') = (motivo_fora is not null)),
    check (origem <> 'manual' or pedido_id is not null),
    check (origem <> 'reciclagem' or reciclagem_id is not null)
);
create index if not exists voz_resubmits_lote on public.voz_resubmits (lote_id, situacao_origem);
create index if not exists voz_resubmits_empresa on public.voz_resubmits (empresa_id, criado_em);
comment on table public.voz_resubmits is
    'Cada decisão da regra por sinalização (auto), do Reenviar agora (manual) ou da reciclagem: finaliza, redisca, '
    'próximo telefone, próximo cliente ou fora (com o motivo). Só destino_hash, nunca o telefone. Gravada pela VM.';

-- validação por linha (vale para a chave do servidor e para o papel motorcx_voz): tudo da mesma empresa, com voz
create or replace function public.validar_resubmit_voz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.voz_config c where c.empresa_id = new.empresa_id) then
        raise exception 'empresa sem voz configurada';
    end if;
    if (new.credor_id is not null and not exists (select 1 from public.credores k
                                                  where k.id = new.credor_id and k.empresa_id = new.empresa_id))
       or (new.lote_id is not null and not exists (select 1 from public.voz_lotes l
                                                   where l.id = new.lote_id and l.empresa_id = new.empresa_id))
       or (new.onda_id is not null and not exists (select 1 from public.voz_ondas o
                                                   where o.id = new.onda_id and o.empresa_id = new.empresa_id))
       or (new.pedido_id is not null and not exists (select 1 from public.voz_reenvios r
                                                     where r.id = new.pedido_id and r.empresa_id = new.empresa_id))
       or (new.reciclagem_id is not null and not exists (select 1 from public.voz_reciclagens r
                                                         where r.id = new.reciclagem_id and r.empresa_id = new.empresa_id)) then
        raise exception 'referência de outra empresa';
    end if;
    return new;
end $$;
revoke all on function public.validar_resubmit_voz() from public, anon, authenticated;
drop trigger if exists validar_resubmit_voz on public.voz_resubmits;
create trigger validar_resubmit_voz before insert or update on public.voz_resubmits
    for each row execute function public.validar_resubmit_voz();

alter table public.voz_chamadas add column if not exists resubmit_id bigint references public.voz_resubmits (id) on delete set null;
create index if not exists voz_chamadas_passada on public.voz_chamadas (empresa_id, ocorrido_em, passada);

alter table public.voz_reenvios enable row level security;
alter table public.voz_resubmits enable row level security;
drop policy if exists voz_reenvios_ver on public.voz_reenvios;
create policy voz_reenvios_ver on public.voz_reenvios for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
drop policy if exists voz_resubmits_ver on public.voz_resubmits;
create policy voz_resubmits_ver on public.voz_resubmits for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_reenvios, public.voz_resubmits from anon;
revoke insert, update, delete on public.voz_reenvios, public.voz_resubmits from authenticated;

-- decisões apagadas com a retenção da empresa (a mesma das gravações e códigos das chamadas)
select pg_temp.trocar('public.apagar_voz_expirada()',
    '    return jsonb_build_object(''gravacoes'', g, ''codigos'', c + c2);',
    '    delete from public.voz_resubmits r                     -- SQL 65: decisões do Resubmit na mesma retenção
     where r.criado_em < now() - make_interval(days => coalesce((select cf.retencao_dias from public.voz_config cf
                                                                 where cf.empresa_id = r.empresa_id), 90));
    return jsonb_build_object(''gravacoes'', g, ''codigos'', c + c2);');

-- ================================================================ 7. contagens do lote, prévia e pedido (R6, R7)
-- o intervalo da renitência para a situação (credores.discagem; sem a chave, o geral de hoje)
create or replace function public.intervalo_situacao_voz(d jsonb, sit text) returns int
language sql immutable parallel safe as $$
    select coalesce(
        -- o único intervalo da situação é o rediscar.depois_min da regra por sinalização (decisão do dono)
        case when d ? 'por_sinalizacao'
             then coalesce((d -> 'por_sinalizacao' -> (case sit when 'numero_incorreto' then 'numero_inexistente'
                                                                  when 'sem_credito' then 'falha_operadora' else sit end)
                              -> 'rediscar' ->> 'depois_min')::int,
                           ((public.discagem_padrao() -> 'por_sinalizacao' -> (case sit when 'numero_incorreto'
                              then 'numero_inexistente' when 'sem_credito' then 'falha_operadora' else sit end))
                              -> 'rediscar' ->> 'depois_min')::int) end,
        case when sit = 'ocupado' then (d ->> 'intervalo_ocupado_minutos')::int end,
        case when sit = 'ocupado' then 15 end,
        (d ->> 'intervalo_min_minutos')::int, 120)
$$;

-- números sem contato do lote (a última tentativa de cada número, e o cliente não teve contato hoje): só contagens
create or replace function public.sem_contato_lote_voz(lote bigint)
returns table (situacao text, onda_id bigint, numeros bigint)
language sql stable security invoker set search_path = public as $$
    with ult as (
        select distinct on (c.id_cliente, c.destino_hash) c.id_cliente, c.destino_hash, c.onda_id,
               public.situacao_voz(c.resultado, c.causa_sip) as sit
          from public.voz_chamadas c
         where c.lote_id = lote and c.destino_hash is not null and c.resultado is not null
         order by c.id_cliente, c.destino_hash, c.ocorrido_em desc, c.id desc)
    select u.sit, u.onda_id, count(*)
      from ult u
     where u.sit is not null
       and not exists (select 1 from public.voz_chamadas x where x.lote_id = lote and x.id_cliente = u.id_cliente
                          and x.resultado = any (public.encerra_cliente_voz()))
     group by 1, 2 order by 3 desc
$$;

-- sem contato no dia da carteira, por situação (prévia do Resubmit com o dia de ontem)
create or replace function public.sem_contato_dia_voz(empresa bigint, credor bigint, dia date)
returns table (situacao text, numeros bigint, chamadas bigint)
language sql stable security invoker set search_path = public as $$
    with dia_c as (
        select c.* from public.voz_chamadas c
         where c.empresa_id = empresa and c.credor_id is not distinct from credor
           and c.ocorrido_em >= (dia::timestamp at time zone 'America/Sao_Paulo')
           and c.ocorrido_em < ((dia + 1)::timestamp at time zone 'America/Sao_Paulo')),
    ult as (
        select distinct on (c.id_cliente, coalesce(c.destino_hash, c.id_chamada)) c.id_cliente,
               public.situacao_voz(c.resultado, c.causa_sip) as sit
          from dia_c c where c.resultado is not null
         order by c.id_cliente, coalesce(c.destino_hash, c.id_chamada), c.ocorrido_em desc, c.id desc)
    select u.sit, count(*), (select count(*) from dia_c)
      from ult u
     where u.sit is not null
       and not exists (select 1 from dia_c x where x.id_cliente = u.id_cliente
                          and x.resultado = any (public.encerra_cliente_voz()))
     group by 1 order by 2 desc
$$;

-- prévia do Reenviar agora: as mesmas regras do agendador, só contagens. A VM confere tudo de novo na hora.
create or replace function public.previa_reenvio_voz(lote bigint, resultados text[], ondas bigint[] default null,
                                                     prioridade text default 'normal', outro_numero boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    l public.voz_lotes;
    d jsonb;
    tnum int; tcli int;
    agora timestamptz := now();
    fim timestamptz;
    dia date := (now() at time zone 'America/Sao_Paulo')::date;
    r jsonb;
begin
    select * into l from public.voz_lotes v where v.id = lote;
    if l.id is null or l.empresa_id not in (select public.minhas_empresas()) then
        raise exception 'lote não encontrado';
    end if;
    if resultados is null or not (resultados <@ public.situacoes_resubmit_voz()) then
        raise exception 'resultados: use as situações da renitência';
    end if;
    select k.discagem into d from public.credores k where k.id = l.credor_id;
    d := coalesce(d, '{}');
    tnum := coalesce((d ->> 'tentativas_numero_dia')::int, 2);
    tcli := coalesce((d ->> 'tentativas_cliente_dia')::int, (d ->> 'spins_discador_dia')::int, 3);
    -- fim do dia pela faixa global (seg–sex até 20:00, sábado até 14:00); a janela UF/DDD a VM confere na hora
    fim := ((dia + case when extract(isodow from dia) = 6 then time '14:00' else time '20:00' end)
            at time zone 'America/Sao_Paulo');
    with ch as (
        select c.* from public.voz_chamadas c where c.lote_id = lote and c.destino_hash is not null),
    ult as (
        select distinct on (c.id_cliente, c.destino_hash) c.id_cliente, c.destino_hash, c.onda_id, c.resultado,
               coalesce(c.encerrada_em, c.ocorrido_em) as quando, public.situacao_voz(c.resultado, c.causa_sip) as sit
          from ch c where c.resultado is not null
         order by c.id_cliente, c.destino_hash, c.ocorrido_em desc, c.id desc),
    cand as (
        select u.*,
               (select count(*) from ch x where x.id_cliente = u.id_cliente and x.destino_hash = u.destino_hash) as n_num,
               (select count(*) from ch x where x.id_cliente = u.id_cliente) as n_cli,
               (select count(distinct x.destino_hash) from ch x where x.id_cliente = u.id_cliente) as numeros,
               exists (select 1 from ch x where x.id_cliente = u.id_cliente and x.resultado = 'opt_out') as nl,
               exists (select 1 from ch x where x.id_cliente = u.id_cliente and x.resultado = 'promessa') as prom
          from ult u
         where u.sit = any (resultados) and (ondas is null or cardinality(ondas) = 0 or u.onda_id = any (ondas))),
    cls as (
        select c.*, case
            when c.nl then 'nao_ligar'
            when c.prom then 'promessa'
            when exists (select 1 from ch x where x.id_cliente = c.id_cliente
                            and x.resultado = any (public.encerra_cliente_voz())) then 'contato'
            when c.resultado in ('numero_inexistente', 'inexistente_voz', 'atendida_terceiro_desconhece')
                 and not (outro_numero and c.numeros > 1) then 'inexistente'
            when c.n_cli >= tcli or (c.n_num >= tnum and not (outro_numero and c.numeros > 1)) then 'max_dia'
            when c.quando + make_interval(mins => public.intervalo_situacao_voz(d, c.sit)) >= fim then 'fora_horario'
            when outro_numero and c.numeros > 1
                 and (c.n_num >= tnum or c.resultado in ('numero_inexistente', 'inexistente_voz',
                                                          'atendida_terceiro_desconhece')) then 'volta_outro'
            when c.quando + make_interval(mins => public.intervalo_situacao_voz(d, c.sit)) > agora then 'espera'
            else 'volta' end as cl
          from cand c)
    select jsonb_build_object(
        'selecionados', count(*) filter (where cl <> 'contato'),
        'volta', count(*) filter (where cl in ('volta', 'volta_outro', 'espera')),
        'volta_outro_numero', count(*) filter (where cl = 'volta_outro'),
        'espera_intervalo', count(*) filter (where cl = 'espera'),
        'fora', jsonb_build_object(
            'max_dia', count(*) filter (where cl = 'max_dia'),
            'fora_horario', count(*) filter (where cl = 'fora_horario'),
            'nao_ligar', count(*) filter (where cl = 'nao_ligar'),
            'promessa', count(*) filter (where cl = 'promessa'),
            'inexistente', count(*) filter (where cl = 'inexistente')))
      into r from cls;
    return r;
end $$;

create or replace function public.pedir_reenvio_voz(lote bigint, resultados text[], ondas bigint[] default null,
                                                    prioridade text default 'normal', outro_numero boolean default false)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    l public.voz_lotes;
    agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
    hhmm time := (now() at time zone 'America/Sao_Paulo')::time;
    dow int := extract(isodow from (now() at time zone 'America/Sao_Paulo'));
    novo bigint;
begin
    select * into l from public.voz_lotes v where v.id = lote;
    if l.id is null or l.empresa_id not in (select public.minhas_empresas()) then
        raise exception 'lote não encontrado';
    end if;
    if not public.pode('reenviar_lote_voz') then
        raise exception 'sem permissão para reenviar números do lote';
    end if;
    if l.data <> agora_sp::date or l.situacao not in ('ligando', 'pausado') then
        raise exception 'só o lote de hoje, ligando ou pausado, pode reenviar';
    end if;
    if dow = 7 or hhmm < time '08:00' or hhmm >= (case when dow = 6 then time '14:00' else time '20:00' end) then
        raise exception 'fora da janela de ligações de hoje';
    end if;
    if prioridade not in ('topo', 'normal', 'fim') then
        raise exception 'prioridade: topo, normal ou fim';
    end if;
    if resultados is null or cardinality(resultados) = 0 or not (resultados <@ public.situacoes_resubmit_voz()) then
        raise exception 'escolha pelo menos uma situação da renitência';
    end if;
    if cardinality(ondas) > 0 and exists (select 1 from unnest(ondas) o
                                           where not exists (select 1 from public.voz_ondas w where w.id = o and w.lote_id = lote)) then
        raise exception 'onda de outro lote';
    end if;
    insert into public.voz_reenvios (empresa_id, credor_id, lote_id, filtros, prioridade, outro_numero, previa, pedido_por)
    values (l.empresa_id, l.credor_id, l.id,
            jsonb_build_object('resultados', to_jsonb(resultados), 'ondas', to_jsonb(coalesce(ondas, '{}'::bigint[]))),
            prioridade, coalesce(outro_numero, false),
            public.previa_reenvio_voz(lote, resultados, ondas, prioridade, outro_numero), auth.uid())
    returning id into novo;
    return novo;
end $$;
revoke all on function public.intervalo_situacao_voz(jsonb, text), public.sem_contato_lote_voz(bigint),
    public.sem_contato_dia_voz(bigint, bigint, date), public.previa_reenvio_voz(bigint, text[], bigint[], text, boolean),
    public.pedir_reenvio_voz(bigint, text[], bigint[], text, boolean) from public, anon;
grant execute on function public.intervalo_situacao_voz(jsonb, text), public.sem_contato_lote_voz(bigint),
    public.sem_contato_dia_voz(bigint, bigint, date), public.previa_reenvio_voz(bigint, text[], bigint[], text, boolean),
    public.pedir_reenvio_voz(bigint, text[], bigint[], text, boolean) to authenticated;

-- ================================================================ 7b. reciclar mailing (R12–R15)
alter table public.voz_reciclagens enable row level security;
drop policy if exists voz_reciclagens_ver on public.voz_reciclagens;
create policy voz_reciclagens_ver on public.voz_reciclagens for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_reciclagens from anon;
revoke insert, update, delete on public.voz_reciclagens from authenticated;

-- R15: permissão própria (zerar o lote é mais forte que uma volta), padrão Admin e Operação
do $$
declare
    def text;
    prox int;
begin
    if not exists (select 1 from public.permissoes_catalogo where codigo = 'reciclar_lote_voz') then
        def := rtrim(btrim(pg_get_viewdef('public.permissoes_catalogo'::regclass)), ';');
        prox := coalesce((select max(ordem) from public.permissoes_catalogo), 0) + 1;
        execute format('create or replace view public.permissoes_catalogo as %s union all select %L::text, %L::text, '
                       '%L::text, %L::text, true, false, true, false, %s', def, 'reciclar_lote_voz', 'Agente virtual',
                       'Reciclar o mailing do lote',
                       'Zerar as tentativas dos números sem contato do lote do dia e discar de novo (não ligar e inexistente nunca voltam).',
                       prox);
    end if;
end $$;
grant select on public.permissoes_catalogo to authenticated;
revoke all on public.permissoes_catalogo from anon;

-- R13: prévia, só contagens. Nunca volta: não ligar e inexistente; promessa fica fora quando a carteira suspende por
-- promessa (travada); o resto do "excluir" é escolha. Com limite "mantem", quem já atingiu o máximo do dia fica fora.
-- R18: também chamadas (com as rediscagens da regra), ondas, duração estimada, se cabe em cada janela UF/DDD do lote e
-- as chamadas curtas previstas (e como fica a parte de curtas do lote).
create or replace function public.previa_reciclagem_voz(lote bigint, escopo text default 'lote', resultados text[] default null,
                                                        ondas bigint[] default null, excluir text[] default null,
                                                        limite_cliente text default 'mantem')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
    l public.voz_lotes;
    d jsonb;
    ex text[] := coalesce(excluir, '{}');
    tnum int; tcli int;
    r jsonb;
    volta int; n_sel int; k_sel int; n_lote int; k_lote int; sem_lote int; ult_hora int; dur_media numeric;
    ps jsonb; md jsonb; g jsonb; jan jsonb; jan_out jsonb;
    redisc int; tent int; j int; n_ondas int; conc int;
    p_sem numeric; chamadas numeric; por_hora numeric; dur_min numeric; cabe_pct numeric; resta_max numeric;
    taxa_lote numeric; taxa_sel numeric; curtas numeric; aviso numeric; horizontal boolean;
    agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
    dow int := extract(isodow from (now() at time zone 'America/Sao_Paulo'));
    fim_legal time := case when extract(isodow from (now() at time zone 'America/Sao_Paulo')) = 6 then time '14:00'
                           else time '20:00' end;
begin
    select * into l from public.voz_lotes v where v.id = lote;
    if l.id is null or not (l.empresa_id in (select public.minhas_empresas()) or public.chamada_do_servidor()
                            or public.chamada_da_vm_voz()) then
        raise exception 'lote não encontrado';
    end if;
    if escopo not in ('lote', 'filtro') or limite_cliente not in ('mantem', 'recomeca')
       or not (ex <@ array['cpc', 'promessa', 'recusa', 'pessoa_errada', 'retorno'])
       or (escopo = 'filtro' and (resultados is null or not (resultados <@ public.situacoes_resubmit_voz()))) then
        raise exception 'filtros da reciclagem inválidos';
    end if;
    select k.discagem into d from public.credores k where k.id = l.credor_id;
    d := coalesce(d, '{}');
    if coalesce((d -> 'promessa_suspende' ->> 'ativo')::boolean, false) and not ('promessa' = any (ex)) then
        ex := ex || 'promessa'::text;
    end if;
    tnum := coalesce((d ->> 'tentativas_numero_dia')::int,
                     case when d ? 'por_sinalizacao' or d ? 'modo_discagem' then 3 else 2 end);
    tcli := coalesce((d ->> 'tentativas_cliente_dia')::int, (d ->> 'spins_discador_dia')::int, 3);
    -- contagens por número (o último resultado de cada número do lote), com o motivo de quem fica fora
    with ch as (
        select c.*, public.situacao_voz(c.resultado, c.causa_sip) as sit_ch,
               public.chamada_curta_voz(c.resultado, c.duracao_s, d -> 'chamadas_curtas') as curta
          from public.voz_chamadas c where c.lote_id = lote and c.destino_hash is not null),
    ult as (
        select distinct on (c.id_cliente, c.destino_hash) c.id_cliente, c.destino_hash, c.onda_id, c.resultado,
               c.sit_ch as sit
          from ch c where c.resultado is not null
         order by c.id_cliente, c.destino_hash, c.ocorrido_em desc, c.id desc),
    cand as (
        select u.*,
               (select count(*) from ch x where x.id_cliente = u.id_cliente and x.destino_hash = u.destino_hash) as n_num,
               (select count(*) from ch x where x.id_cliente = u.id_cliente) as n_cli,
               array(select distinct x.resultado from ch x where x.id_cliente = u.id_cliente) as ds
          from ult u
         where escopo = 'lote' or (u.sit = any (resultados) and (ondas is null or cardinality(ondas) = 0
                                                                  or u.onda_id = any (ondas)))),
    cls as (
        select c.id_cliente, c.destino_hash, case
            when 'opt_out' = any (c.ds) then 'nao_ligar'
            when c.resultado in ('numero_inexistente', 'inexistente_voz') then 'inexistente'
            when 'cpc' = any (ex) and c.ds && array['cpc', 'identidade_confirmada', 'atendida_sem_cpc'] then 'cpc'
            when 'promessa' = any (ex) and 'promessa' = any (c.ds) then 'promessa'
            when 'recusa' = any (ex) and 'recusa' = any (c.ds) then 'recusa'
            when 'pessoa_errada' = any (ex) and c.resultado = 'atendida_terceiro_desconhece' then 'pessoa_errada'
            when 'retorno' = any (ex) and 'retorno_agendado' = any (c.ds) then 'retorno'
            when limite_cliente = 'mantem' and (c.n_num >= tnum or c.n_cli >= tcli) then 'max_dia'
            else 'volta' end as cl
          from cand c),
    sel as (
        select count(*) as n, count(*) filter (where x.curta) as k
          from ch x join cls c on c.id_cliente = x.id_cliente and c.destino_hash = x.destino_hash and c.cl = 'volta'),
    lt as (
        select count(*) filter (where x.resultado is not null) as n,
               count(*) filter (where x.resultado is not null and x.curta) as k,
               count(*) filter (where x.resultado is not null and x.sit_ch is not null) as sem,
               count(*) filter (where x.ocorrido_em > now() - interval '1 hour') as ult_hora,
               avg(least(greatest(extract(epoch from x.encerrada_em - x.ocorrido_em), 5), 1800))
                   filter (where x.encerrada_em is not null) as dur
          from ch x)
    select jsonb_build_object(
        'base', (select count(*) from cls), 'volta', (select count(*) from cls where cl = 'volta'),
        'excluir_efetivo', to_jsonb(ex),
        'fora', jsonb_build_object(
            'max_dia', (select count(*) from cls where cl = 'max_dia'), 'cpc', (select count(*) from cls where cl = 'cpc'),
            'promessa', (select count(*) from cls where cl = 'promessa'),
            'recusa', (select count(*) from cls where cl = 'recusa'),
            'pessoa_errada', (select count(*) from cls where cl = 'pessoa_errada'),
            'retorno', (select count(*) from cls where cl = 'retorno'),
            'nao_ligar', (select count(*) from cls where cl = 'nao_ligar'),
            'inexistente', (select count(*) from cls where cl = 'inexistente'))),
           (select count(*) from cls where cl = 'volta'), sel.n, sel.k, lt.n, lt.k, lt.sem, lt.ult_hora, lt.dur
      into r, volta, n_sel, k_sel, n_lote, k_lote, sem_lote, ult_hora, dur_media
      from sel, lt;

    -- chamadas: cada número que volta sai uma vez e, sem contato, redisca pela regra da carteira (até o máximo por
    -- número). A chance de seguir sem contato é a do lote hoje (com menos de 30 chamadas, 70%).
    ps := d -> 'por_sinalizacao';
    if ps is not null and jsonb_typeof(ps) = 'object' then
        select coalesce(max(case when coalesce((ps -> k ->> 'finaliza')::boolean, (pp -> k ->> 'finaliza')::boolean)
                                      or not coalesce((ps -> k -> 'rediscar' ->> 'ativo')::boolean,
                                                      (pp -> k -> 'rediscar' ->> 'ativo')::boolean) then 0
                                 else coalesce((ps -> k -> 'rediscar' ->> 'max')::int, (pp -> k -> 'rediscar' ->> 'max')::int) end), 0)
          into redisc
          from unnest(array['maquina', 'nao_atendida', 'ocupado', 'caixa_postal', 'desligou_sem_conversar',
                            'atendeu_desligou']) k, (select public.discagem_padrao() -> 'por_sinalizacao' as pp) z;
    else
        redisc := tnum - 1;                              -- a VM de hoje: volta no mesmo número até o máximo do dia
    end if;
    tent := greatest(1, least(1 + redisc, tnum));
    p_sem := case when n_lote >= 30 then sem_lote::numeric / n_lote else 0.7 end;
    chamadas := 0;
    for j in 0 .. tent - 1 loop
        chamadas := chamadas + volta * power(p_sem, j);
    end loop;
    chamadas := round(chamadas);
    md := d -> 'modo_discagem';
    horizontal := md is not null and coalesce(md ->> 'modo', 'horizontal') = 'horizontal';
    n_ondas := case when horizontal then coalesce((md -> 'spins' ->> 'quantidade')::int, 3) else 1 end;
    -- duração: o ritmo do lote na última hora (30 chamadas ou mais) ou a concorrência da empresa pela duração média
    if ult_hora >= 30 then
        por_hora := ult_hora;
    else
        select v.limite into conc from public.divisao_concorrencia_voz() v where v.empresa_id = l.empresa_id;
        por_hora := greatest(1, coalesce(conc, 1)) * 3600.0 / greatest(coalesce(case when n_lote >= 30 then dur_media end, 45), 15);
    end if;
    dur_min := ceil(chamadas * 60.0 / greatest(por_hora, 1));
    if horizontal and n_ondas > 1 and chamadas > 0 then   -- um spin por onda, com o intervalo mínimo entre eles
        dur_min := greatest(dur_min, (n_ondas - 1) * coalesce((md -> 'spins' ->> 'intervalo_min')::int, 120)
                                     + ceil(chamadas * 60.0 / n_ondas / greatest(por_hora, 1)));
    end if;

    -- janela: a de cada grupo de UF/DDD do lote (a VM conta), cortada pela faixa legal de hoje; sem as janelas do
    -- lote, só a faixa legal (seg–sex 08:00–20:00, sábado até 14:00, domingo não liga)
    jan := case when jsonb_typeof(l.janelas) = 'array' and jsonb_array_length(l.janelas) > 0 then l.janelas
                else jsonb_build_array(jsonb_build_object('abre', '08:00', 'fecha', '20:00', 'clientes', 1)) end;
    select coalesce(jsonb_agg(jsonb_build_object('abre', w.abre, 'fecha', w.fecha, 'ufs', w.ufs, 'clientes', w.clientes,
                                                 'resta_min', w.resta, 'cabe_pct',
                                                 round(100 * case when dur_min <= 0 then 1
                                                                  else least(1, w.resta / dur_min) end, 1))
                              order by w.fecha, w.abre), '[]'),
           case when sum(w.clientes) > 0
                then round(100 * sum(w.clientes * case when dur_min <= 0 then 1 else least(1, w.resta / dur_min) end)
                           / sum(w.clientes), 1) else 100 end,
           coalesce(max(w.resta), 0)
      into jan_out, cabe_pct, resta_max
      from (select x ->> 'abre' as abre, x ->> 'fecha' as fecha, coalesce(x -> 'ufs', '[]') as ufs,
                   (x ->> 'clientes')::numeric as clientes,
                   case when dow = 7 then 0
                        else greatest(0, extract(epoch from (least((x ->> 'fecha')::time, fim_legal)
                                                             - greatest(agora_sp::time, (x ->> 'abre')::time, time '08:00')))
                                         / 60)::numeric end as resta
              from jsonb_array_elements(jan) x) w;

    -- chamadas curtas previstas: a taxa dos números que voltam (encolhida para a do lote, como o motor faz por
    -- número) vezes as chamadas; e como fica a parte de curtas do lote depois
    g := public.regras_curtas_voz();
    taxa_lote := (k_lote + (g ->> 'prior')::numeric * (g ->> 'forca_carteira')::numeric)
                 / (n_lote + (g ->> 'forca_carteira')::numeric);
    taxa_sel := (k_sel + taxa_lote * (g ->> 'forca_numero')::numeric) / (n_sel + (g ->> 'forca_numero')::numeric);
    curtas := round(chamadas * taxa_sel);
    aviso := coalesce((d -> 'chamadas_curtas' ->> 'aviso')::numeric, (g ->> 'aviso')::numeric);
    return r || jsonb_build_object(
        'chamadas', chamadas, 'ondas', n_ondas, 'tentativas_numero', tent,
        'duracao_min', dur_min, 'por_hora', round(por_hora),
        'janela_fonte', case when jan_out is not null and jsonb_typeof(l.janelas) = 'array'
                                  and jsonb_array_length(l.janelas) > 0 then 'uf_ddd' else 'faixa_legal' end,
        'janelas', jan_out, 'resta_min', round(resta_max), 'cabe_pct', cabe_pct, 'cabe_na_janela', cabe_pct >= 100,
        'curtas_previstas', curtas,
        'curtas', jsonb_build_object(
            'previstas', curtas, 'fracao_prevista', round(taxa_sel, 4),
            'hoje', jsonb_build_object('chamadas', n_lote, 'curtas', k_lote,
                                       'fracao', case when n_lote > 0 then round(k_lote::numeric / n_lote, 4) end),
            'fracao_depois', case when n_lote + chamadas > 0
                                  then round((k_lote + curtas) / (n_lote + chamadas), 4) end,
            'aviso', aviso,
            'acima_do_aviso', n_lote + chamadas > 0 and (k_lote + curtas) / (n_lote + chamadas) >= aviso));
end $$;

-- R14: pedido manual (site)
create or replace function public.pedir_reciclagem_voz(lote bigint, escopo text default 'lote', resultados text[] default null,
                                                       ondas bigint[] default null, excluir text[] default null,
                                                       limite_cliente text default 'mantem')
returns bigint
language plpgsql security definer set search_path = public as $$
declare
    l public.voz_lotes;
    agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
    hhmm time := (now() at time zone 'America/Sao_Paulo')::time;
    dow int := extract(isodow from (now() at time zone 'America/Sao_Paulo'));
    p jsonb;
    novo bigint;
begin
    select * into l from public.voz_lotes v where v.id = lote;
    if l.id is null or l.empresa_id not in (select public.minhas_empresas()) then
        raise exception 'lote não encontrado';
    end if;
    if not public.pode('reciclar_lote_voz') then
        raise exception 'sem permissão para reciclar o lote';
    end if;
    if l.data <> agora_sp::date or l.situacao not in ('ligando', 'pausado', 'concluido') then
        raise exception 'só o lote de hoje (ligando, pausado ou concluído) pode ser reciclado';
    end if;
    if dow = 7 or hhmm < time '08:00' or hhmm >= (case when dow = 6 then time '14:00' else time '20:00' end) then
        raise exception 'fora da janela de ligações de hoje';
    end if;
    if exists (select 1 from public.voz_reciclagens r where r.lote_id = lote and r.situacao in ('pendente', 'em_onda')) then
        raise exception 'já há uma reciclagem em andamento neste lote';
    end if;
    p := public.previa_reciclagem_voz(lote, escopo, resultados, ondas, excluir, limite_cliente);
    insert into public.voz_reciclagens (empresa_id, credor_id, lote_id, data, origem, escopo, filtros, excluir,
                                        limite_cliente, previa, pedido_por)
    values (l.empresa_id, l.credor_id, l.id, l.data, 'manual', escopo,
            jsonb_build_object('resultados', to_jsonb(coalesce(resultados, '{}')), 'ondas', to_jsonb(coalesce(ondas, '{}'::bigint[]))),
            array(select jsonb_array_elements_text(p -> 'excluir_efetivo')), limite_cliente, p - 'excluir_efetivo', auth.uid())
    returning id into novo;
    return novo;
end $$;
revoke all on function public.previa_reciclagem_voz(bigint, text, text[], bigint[], text[], text),
    public.pedir_reciclagem_voz(bigint, text, text[], bigint[], text[], text) from public, anon;
grant execute on function public.previa_reciclagem_voz(bigint, text, text[], bigint[], text[], text),
    public.pedir_reciclagem_voz(bigint, text, text[], bigint[], text[], text) to authenticated;
grant execute on function public.previa_reciclagem_voz(bigint, text, text[], bigint[], text[], text) to service_role;

-- VM: pega o pedido (manual ou automático), conclui e registra a automática (uma por lote no dia)
create or replace function public.pegar_reciclagem_voz(empresas bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.voz_reciclagens;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into r from public.voz_reciclagens x
     where x.situacao = 'pendente' and x.empresa_id = any (empresas)
     order by x.pedido_em limit 1 for update skip locked;
    if r.id is null then
        return null;
    end if;
    update public.voz_reciclagens x set situacao = 'em_onda' where x.id = r.id;
    return jsonb_build_object('id', r.id, 'empresa_id', r.empresa_id, 'credor_id', r.credor_id, 'lote_id', r.lote_id,
                              'escopo', r.escopo, 'filtros', r.filtros, 'excluir', to_jsonb(r.excluir),
                              'limite_cliente', r.limite_cliente, 'origem', r.origem);
end $$;

create or replace function public.registrar_reciclagem_auto_voz(lote bigint, excluir text[], sem_contato_pct numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    l public.voz_lotes;
    d jsonb;
    ex text[] := coalesce(excluir, '{}');
    novo bigint;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into l from public.voz_lotes v where v.id = lote;
    if l.id is null or not exists (select 1 from public.voz_config c where c.empresa_id = l.empresa_id) then
        raise exception 'lote não encontrado';
    end if;
    select k.discagem into d from public.credores k where k.id = l.credor_id;
    if not coalesce((d -> 'reciclagem_auto' ->> 'ativo')::boolean, false) then
        raise exception 'reciclagem automática desligada na carteira';
    end if;
    if not (ex <@ array['cpc', 'promessa', 'recusa', 'pessoa_errada', 'retorno']) then
        raise exception 'excluir: cpc, promessa, recusa, pessoa_errada ou retorno';
    end if;
    if coalesce((d -> 'promessa_suspende' ->> 'ativo')::boolean, false) and not ('promessa' = any (ex)) then
        ex := ex || 'promessa'::text;
    end if;
    insert into public.voz_reciclagens (empresa_id, credor_id, lote_id, data, origem, excluir, limite_cliente, previa,
                                        situacao)
    values (l.empresa_id, l.credor_id, l.id, l.data, 'automatica', ex, 'mantem',
            jsonb_build_object('sem_contato_pct', sem_contato_pct), 'em_onda')
    on conflict (lote_id, data) where origem = 'automatica' do nothing
    returning id into novo;
    if novo is null then
        return null;
    end if;
    return jsonb_build_object('id', novo, 'lote_id', l.id, 'escopo', 'lote', 'filtros', '{}'::jsonb, 'excluir', to_jsonb(ex),
                              'limite_cliente', 'mantem', 'origem', 'automatica');
end $$;

create or replace function public.concluir_reciclagem_voz(reciclagem bigint, situacao text, volta_real int,
                                                          onda bigint default null, fora_real jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare r public.voz_reciclagens;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into r from public.voz_reciclagens x where x.id = reciclagem for update;
    if r.id is null or r.situacao <> 'em_onda' then
        raise exception 'reciclagem não está em onda';
    end if;
    if situacao not in ('concluido', 'cancelado') then
        raise exception 'situacao: concluido ou cancelado';
    end if;
    if onda is not null and not exists (select 1 from public.voz_ondas o where o.id = onda and o.lote_id = r.lote_id) then
        raise exception 'onda de outro lote';
    end if;
    if fora_real is not null and jsonb_typeof(fora_real) <> 'object' then
        raise exception 'fora_real: objeto de contagens';
    end if;
    update public.voz_reciclagens x set situacao = situacao, volta_real = greatest(coalesce(volta_real, 0), 0),
           onda_id = onda, fora_real = fora_real, concluido_em = now()
     where x.id = r.id;
end $$;
revoke all on function public.pegar_reciclagem_voz(bigint[]), public.registrar_reciclagem_auto_voz(bigint, text[], numeric),
    public.concluir_reciclagem_voz(bigint, text, int, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.pegar_reciclagem_voz(bigint[]), public.registrar_reciclagem_auto_voz(bigint, text[], numeric),
    public.concluir_reciclagem_voz(bigint, text, int, bigint, jsonb) to service_role;

create or replace function voz_vm.pegar_reciclagem(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.pegar_reciclagem_voz(array(select e::bigint from jsonb_array_elements_text(coalesce(args -> 'empresas', '[]')) e
                                              where voz_vm.tem_voz(e::bigint)))
$$;
create or replace function voz_vm.registrar_reciclagem_auto(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.registrar_reciclagem_auto_voz((args ->> 'lote')::bigint,
                                                array(select jsonb_array_elements_text(coalesce(args -> 'excluir', '[]'))),
                                                (args ->> 'sem_contato_pct')::numeric)
$$;
create or replace function voz_vm.concluir_reciclagem(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform public.concluir_reciclagem_voz((args ->> 'reciclagem')::bigint, args ->> 'situacao', (args ->> 'volta_real')::int,
                                           (args ->> 'onda')::bigint,
                                           case when jsonb_typeof(args -> 'fora_real') = 'object' then args -> 'fora_real' end);
    return null;
end $$;
revoke all on function voz_vm.pegar_reciclagem(jsonb), voz_vm.registrar_reciclagem_auto(jsonb),
    voz_vm.concluir_reciclagem(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.pegar_reciclagem(jsonb), voz_vm.registrar_reciclagem_auto(jsonb),
    voz_vm.concluir_reciclagem(jsonb) to motorcx_voz;

-- ================================================================ 8. contato por passada (R9, R10)
create table if not exists public.voz_passadas_dia (
    id               bigint generated always as identity primary key,
    empresa_id       bigint not null references public.empresas (id) on delete cascade,
    credor_id        bigint references public.credores (id) on delete cascade,
    data             date not null,
    situacao_origem  text check (situacao_origem is null or situacao_origem = any (public.situacoes_resubmit_voz())),
    passada          int not null check (passada between 1 and 50),
    chamadas         int not null default 0 check (chamadas >= 0),
    atendidas        int not null default 0 check (atendidas >= 0),
    contatos         int not null default 0 check (contatos >= 0),
    promessas        int not null default 0 check (promessas >= 0),
    curtas           int not null default 0 check (curtas >= 0),
    minutos_ia       numeric(14, 2) not null default 0 check (minutos_ia >= 0),
    custo_operadora  numeric(14, 5) not null default 0 check (custo_operadora >= 0),
    sem_custo        int not null default 0 check (sem_custo >= 0),
    atualizado_em    timestamptz not null default now(),
    check ((passada = 1) = (situacao_origem is null))
);
create unique index if not exists voz_passadas_dia_chave on public.voz_passadas_dia
    (empresa_id, coalesce(credor_id, 0), data, coalesce(situacao_origem, ''), passada);
comment on table public.voz_passadas_dia is
    'Contato por passada: chamadas, contatos (CPC do motor) e curtas por carteira, dia, situação de origem e passada. Gravada pela VM.';
alter table public.voz_passadas_dia enable row level security;
drop policy if exists voz_passadas_dia_ver on public.voz_passadas_dia;
create policy voz_passadas_dia_ver on public.voz_passadas_dia for select to authenticated
    using (empresa_id in (select public.minhas_empresas()));
revoke all on public.voz_passadas_dia from anon;
revoke insert, update, delete on public.voz_passadas_dia from authenticated;

-- a soma no servidor. Grupo com menos de 30 chamadas: taxa e curtas nulas (o site mostra "—").
create or replace function public.contato_por_passada(empresa bigint, credor bigint, de date, ate date,
                                                      situacao text default null)
returns table (passada int, chamadas bigint, contatos bigint, taxa numeric, curtas bigint, curtas_pct numeric,
               minutos_ia numeric, custo_operadora numeric, sem_custo bigint)
language sql stable security invoker set search_path = public as $$
    select p.passada, sum(p.chamadas)::bigint, sum(p.contatos)::bigint,
           case when sum(p.chamadas) >= 30 then round(100.0 * sum(p.contatos) / sum(p.chamadas), 2) end,
           sum(p.curtas)::bigint,
           case when sum(p.chamadas) >= 30 then round(100.0 * sum(p.curtas) / sum(p.chamadas), 1) end,
           sum(p.minutos_ia), sum(p.custo_operadora), sum(p.sem_custo)::bigint
      from public.voz_passadas_dia p
     where p.empresa_id = empresa and (credor is null or p.credor_id = credor) and p.data between de and ate
       and (situacao is null or p.passada = 1 or p.situacao_origem = situacao)
     group by p.passada order by p.passada
$$;
revoke all on function public.contato_por_passada(bigint, bigint, date, date, text) from public, anon;
grant execute on function public.contato_por_passada(bigint, bigint, date, date, text) to authenticated;

-- ================================================================ 9. funções da VM (servidor ou motorcx_voz)
-- Regras de discagem das carteiras ativas (só id e o bloco discagem: sem nome, CNPJ nem nada do devedor)
create or replace function public.regras_discagem_voz(empresa bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('credor_id', k.id, 'discagem', k.discagem) order by k.id)
                       from public.credores k where k.empresa_id = empresa and k.ativo), '[]');
end $$;

-- o voz_lotes da carteira no dia: acha (o mais antigo não cancelado) ou cria já ligando
create or replace function public.lote_voz_do_dia(empresa bigint, credor bigint, dia date, total int default 0)
returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare l public.voz_lotes;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    if not exists (select 1 from public.voz_config c where c.empresa_id = empresa)
       or (credor is not null and not exists (select 1 from public.credores k where k.id = credor and k.empresa_id = empresa)) then
        raise exception 'empresa sem voz configurada ou carteira de outra empresa';
    end if;
    select * into l from public.voz_lotes v
     where v.empresa_id = empresa and v.credor_id is not distinct from credor and v.data = dia and v.situacao <> 'cancelado'
     order by v.id limit 1 for update;
    if l.id is null then
        insert into public.voz_lotes (empresa_id, credor_id, data, modo, situacao, total)
        values (empresa, credor, dia, (select c.modo from public.voz_config c where c.empresa_id = empresa), 'ligando',
                greatest(coalesce(total, 0), 0))
        returning * into l;
    else
        update public.voz_lotes v set total = greatest(v.total, coalesce(total, 0)),
               situacao = case when v.situacao = 'agendado' then 'ligando' else v.situacao end, atualizado_em = now()
         where v.id = l.id;
    end if;
    return l.id;
end $$;

-- onda do lote (acha pela chave origem × passada × situação × prioridade × reenvio, ou cria) com as contagens
create or replace function public.registrar_onda_voz(lote bigint, origem text, passada int, situacao_origem text,
                                                     prioridade text, reenvio bigint default null, total int default 0,
                                                     encerradas int default 0)
returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    l public.voz_lotes;
    oid bigint;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into l from public.voz_lotes v where v.id = lote;
    if l.id is null or not exists (select 1 from public.voz_config c where c.empresa_id = l.empresa_id) then
        raise exception 'lote não encontrado';
    end if;
    if reenvio is not null and not exists (select 1 from public.voz_reenvios r where r.id = reenvio and r.lote_id = lote) then
        raise exception 'reenvio de outro lote';
    end if;
    select o.id into oid from public.voz_ondas o
     where o.lote_id = lote and o.origem = origem and o.passada = passada
       and o.situacao_origem is not distinct from situacao_origem and o.prioridade = prioridade
       and o.reenvio_id is not distinct from reenvio
     order by o.id limit 1 for update;
    if oid is null then
        insert into public.voz_ondas as o (empresa_id, lote_id, janela, tentativa, total, encerradas, situacao, abre_em,
                                           origem, passada, situacao_origem, prioridade, reenvio_id)
        values (l.empresa_id, lote, origem, passada, greatest(coalesce(total, 0), 0), greatest(coalesce(encerradas, 0), 0),
                'ligando', now(), origem, passada, situacao_origem, prioridade, reenvio)
        returning o.id into oid;
    else
        update public.voz_ondas o set total = greatest(o.total, coalesce(total, 0)),
               encerradas = greatest(o.encerradas, coalesce(encerradas, 0))
         where o.id = oid;
    end if;
    update public.voz_ondas o set situacao = case when o.encerradas >= o.total and o.total > 0 then 'encerrada'
                                                   else 'ligando' end,
           fecha_em = case when o.encerradas >= o.total and o.total > 0 then coalesce(o.fecha_em, now()) end
     where o.id = oid and o.situacao <> 'cancelada';
    return oid;
end $$;

-- o pedido de reenvio mais antigo das empresas desta VM (vira em_onda)
create or replace function public.pegar_reenvio_voz(empresas bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.voz_reenvios;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into r from public.voz_reenvios x
     where x.situacao = 'pendente' and x.empresa_id = any (empresas)
     order by x.pedido_em limit 1 for update skip locked;
    if r.id is null then
        return null;
    end if;
    update public.voz_reenvios x set situacao = 'em_onda' where x.id = r.id;
    return jsonb_build_object('id', r.id, 'empresa_id', r.empresa_id, 'credor_id', r.credor_id, 'lote_id', r.lote_id,
                              'filtros', r.filtros, 'prioridade', r.prioridade, 'outro_numero', r.outro_numero);
end $$;

create or replace function public.concluir_reenvio_voz(reenvio bigint, situacao text, volta_real int,
                                                       onda bigint default null, resultado jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.voz_reenvios;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into r from public.voz_reenvios x where x.id = reenvio for update;
    if r.id is null or r.situacao <> 'em_onda' then
        raise exception 'reenvio não está em onda';
    end if;
    if situacao not in ('concluido', 'cancelado') then
        raise exception 'situacao: concluido ou cancelado';
    end if;
    if onda is not null and not exists (select 1 from public.voz_ondas o where o.id = onda and o.lote_id = r.lote_id) then
        raise exception 'onda de outro lote';
    end if;
    if resultado is not null and jsonb_typeof(resultado) <> 'object' then
        raise exception 'resultado: objeto de contagens';
    end if;
    update public.voz_reenvios x set situacao = concluir_reenvio_voz.situacao, volta_real = greatest(coalesce(concluir_reenvio_voz.volta_real, 0), 0),
           onda_id = onda, resultado = concluir_reenvio_voz.resultado, concluido_em = now()
     where x.id = r.id;
end $$;

-- noite: refaz voz_passadas_dia da empresa no dia, pelas regras do motor (regras: {contato[], curta_sempre[],
-- curta_abandono[], segundos}). Simulado não entra (como o consumo). Idempotente.
create or replace function public.agregar_passadas_voz(empresa bigint, dia date, regras jsonb) returns int
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    contato text[]; sempre text[]; aband text[]; seg int; n int; cr bigint;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    if not exists (select 1 from public.voz_config c where c.empresa_id = empresa) then
        raise exception 'empresa sem voz configurada';
    end if;
    contato := array(select jsonb_array_elements_text(coalesce(regras -> 'contato', '[]')));
    sempre := array(select jsonb_array_elements_text(coalesce(regras -> 'curta_sempre', '[]')));
    aband := array(select jsonb_array_elements_text(coalesce(regras -> 'curta_abandono', '[]')));
    seg := coalesce((regras ->> 'segundos')::int, 6);
    if not (contato <@ public.desfechos_voz() and sempre <@ public.desfechos_voz() and aband <@ public.desfechos_voz())
       or seg not between 1 and 60 then
        raise exception 'regras: desfechos de voz e segundos de 1 a 60';
    end if;
    delete from public.voz_passadas_dia p where p.empresa_id = empresa and p.data = dia;
    insert into public.voz_passadas_dia (empresa_id, credor_id, data, situacao_origem, passada, chamadas, atendidas,
                                         contatos, promessas, curtas, minutos_ia, custo_operadora, sem_custo)
    select c.empresa_id, c.credor_id, dia,
           case when coalesce(c.passada, 1) = 1 then null else c.situacao_origem end, coalesce(c.passada, 1),
           count(*), count(*) filter (where c.atendida_em is not null),
           count(*) filter (where c.resultado = any (contato)), count(*) filter (where c.resultado = 'promessa'),
           count(*) filter (where (c.billsec is not null and c.billsec <= seg) or c.resultado = any (sempre)
                                  or c.resultado = any (aband)),
           coalesce(sum(c.minutos_ia), 0), coalesce(sum(c.custo_operadora), 0),
           count(*) filter (where c.tarifada_em is not null and c.custo_operadora is null)
      from public.voz_chamadas c
     where c.empresa_id = empresa and c.modo <> 'simulado'
       and c.ocorrido_em >= (dia::timestamp at time zone 'America/Sao_Paulo')
       and c.ocorrido_em < ((dia + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (coalesce(c.passada, 1) = 1 or c.situacao_origem is not null)
     group by c.empresa_id, c.credor_id, 4, 5;
    get diagnostics n = row_count;
    -- R19: o resumo do Resubmit do dia vai para a última execução do motor de cada carteira desse dia
    -- (execucoes.resumo.voz.resubmit), só contagens
    for cr in select distinct v.credor_id from public.voz_resubmits v
               where v.empresa_id = empresa
                 and v.criado_em >= (dia::timestamp at time zone 'America/Sao_Paulo')
                 and v.criado_em < ((dia + 1)::timestamp at time zone 'America/Sao_Paulo') loop
        update public.execucoes x
           set resumo = jsonb_set(case when jsonb_typeof(x.resumo) = 'object' then x.resumo else '{}'::jsonb end, '{voz}',
                                  (case when jsonb_typeof(x.resumo -> 'voz') = 'object' then x.resumo -> 'voz'
                                        else '{}'::jsonb end)
                                  || jsonb_build_object('resubmit', public.resumo_resubmit_voz(empresa, cr, dia)))
         where x.id = (select y.id from public.execucoes y
                        where y.empresa_id = empresa and y.credor_id is not distinct from cr and y.data_ref = dia
                        order by y.iniciada_em desc limit 1);
    end loop;
    return n;
end $$;

revoke all on function public.regras_discagem_voz(bigint), public.lote_voz_do_dia(bigint, bigint, date, int),
    public.registrar_onda_voz(bigint, text, int, text, text, bigint, int, int), public.pegar_reenvio_voz(bigint[]),
    public.concluir_reenvio_voz(bigint, text, int, bigint, jsonb), public.agregar_passadas_voz(bigint, date, jsonb)
    from public, anon, authenticated;
grant execute on function public.regras_discagem_voz(bigint), public.lote_voz_do_dia(bigint, bigint, date, int),
    public.registrar_onda_voz(bigint, text, int, text, text, bigint, int, int), public.pegar_reenvio_voz(bigint[]),
    public.concluir_reenvio_voz(bigint, text, int, bigint, jsonb), public.agregar_passadas_voz(bigint, date, jsonb)
    to service_role;

-- ================================================================ 10. acesso próprio da VM (schema voz_vm do SQL 57)
-- mesmos argumentos (um objeto jsonb, como o corpo do PostgREST) e a mesma resposta das RPCs do public
create or replace function voz_vm.regras_discagem(args jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return public.regras_discagem_voz((args ->> 'empresa')::bigint);
end $$;

create or replace function voz_vm.lote_do_dia(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.lote_voz_do_dia((args ->> 'empresa')::bigint, (args ->> 'credor')::bigint,
                                           (args ->> 'dia')::date, (args ->> 'total')::int))
$$;

create or replace function voz_vm.registrar_onda(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.registrar_onda_voz((args ->> 'lote')::bigint, args ->> 'origem', (args ->> 'passada')::int,
                                              args ->> 'situacao_origem', args ->> 'prioridade',
                                              (args ->> 'reenvio')::bigint, (args ->> 'total')::int,
                                              (args ->> 'encerradas')::int))
$$;

create or replace function voz_vm.pegar_reenvio(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select public.pegar_reenvio_voz(array(select e::bigint from jsonb_array_elements_text(coalesce(args -> 'empresas', '[]')) e
                                           where voz_vm.tem_voz(e::bigint)))
$$;

create or replace function voz_vm.concluir_reenvio(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform public.concluir_reenvio_voz((args ->> 'reenvio')::bigint, args ->> 'situacao', (args ->> 'volta_real')::int,
                                        (args ->> 'onda')::bigint,
                                        case when jsonb_typeof(args -> 'resultado') = 'object' then args -> 'resultado' end);
    return null;
end $$;

create or replace function voz_vm.agregar_passadas(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.agregar_passadas_voz((args ->> 'empresa')::bigint, (args ->> 'dia')::date, args -> 'regras'))
$$;

-- escrita: decisões do Resubmit (upsert por empresa e ref; devolve os ids na ordem). Só as colunas de
-- voz/banco.py › COLUNAS["voz_resubmits"]; o gatilho valida as referências.
create or replace function voz_vm.gravar_resubmits(linhas jsonb) returns table (id bigint)
language plpgsql security definer set search_path = '' as $$
declare
    fora text;
    r record;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 5000 then
        raise exception 'linhas: lista de até 5000 decisões';
    end if;
    if exists (select 1 from jsonb_array_elements(linhas) e where jsonb_typeof(e) <> 'object') then
        raise exception 'linhas: cada decisão é um objeto';
    end if;
    select string_agg(distinct k, ', ' order by k) into fora
      from jsonb_array_elements(linhas) e, jsonb_object_keys(e) k
     where k <> all (array['ref', 'empresa_id', 'credor_id', 'lote_id', 'id_chamada_origem', 'id_cliente', 'destino_hash',
                           'situacao_origem', 'passada', 'origem', 'pedido_id', 'reciclagem_id', 'decisao', 'motivo_fora',
                           'nao_antes_de', 'onda_id', 'criado_em']);
    if fora is not null then
        raise exception 'colunas que a VM não grava em voz_resubmits: %', fora;
    end if;
    for r in select * from jsonb_populate_recordset(null::public.voz_resubmits, linhas) loop
        if r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id) then
            raise exception 'empresa sem voz configurada';
        end if;
        insert into public.voz_resubmits as v (ref, empresa_id, credor_id, lote_id, id_chamada_origem, id_cliente,
                                               destino_hash, situacao_origem, passada, origem, pedido_id, reciclagem_id,
                                               decisao, motivo_fora, nao_antes_de, onda_id, criado_em)
        values (r.ref, r.empresa_id, r.credor_id, r.lote_id, r.id_chamada_origem, r.id_cliente, r.destino_hash,
                r.situacao_origem, r.passada, r.origem, r.pedido_id, r.reciclagem_id, r.decisao, r.motivo_fora,
                r.nao_antes_de, r.onda_id, coalesce(r.criado_em, now()))
        on conflict (empresa_id, ref) do update set onda_id = coalesce(excluded.onda_id, v.onda_id)
        returning v.id into gravar_resubmits.id;
        return next;
    end loop;
end $$;

-- chamadas: passada, situação de origem e a decisão que gerou a volta (da mesma empresa)
select pg_temp.trocar('voz_vm.gravar_chamadas(jsonb)',
    '''transcricao'', ''fluxo_versao_id'', ''bloco_final'']);',
    '''transcricao'', ''fluxo_versao_id'', ''bloco_final'', ''passada'', ''situacao_origem'', ''resubmit_id'']);');
select pg_temp.trocar('voz_vm.gravar_chamadas(jsonb)',
    'where x.id = r.fluxo_versao_id and x.empresa_id = r.empresa_id))) then',
    'where x.id = r.fluxo_versao_id and x.empresa_id = r.empresa_id))
                   or (r.resubmit_id is not null and not exists (select 1 from public.voz_resubmits x
                                                       where x.id = r.resubmit_id and x.empresa_id = r.empresa_id))) then');
select pg_temp.trocar('voz_vm.gravar_chamadas(jsonb)',
    '        fluxo_versao_id, bloco_final)
    select',
    '        fluxo_versao_id, bloco_final, passada, situacao_origem, resubmit_id)
    select');
select pg_temp.trocar('voz_vm.gravar_chamadas(jsonb)',
    '           r.fluxo_versao_id, r.bloco_final
      from',
    '           r.fluxo_versao_id, r.bloco_final, r.passada, r.situacao_origem, r.resubmit_id
      from');
select pg_temp.trocar('voz_vm.gravar_chamadas(jsonb)',
    '        bloco_final = coalesce(excluded.bloco_final, v.bloco_final);',
    '        bloco_final = coalesce(excluded.bloco_final, v.bloco_final),
        passada = coalesce(excluded.passada, v.passada),
        situacao_origem = coalesce(excluded.situacao_origem, v.situacao_origem),
        resubmit_id = coalesce(excluded.resubmit_id, v.resubmit_id);');

revoke all on function voz_vm.regras_discagem(jsonb), voz_vm.lote_do_dia(jsonb), voz_vm.registrar_onda(jsonb),
    voz_vm.pegar_reenvio(jsonb), voz_vm.concluir_reenvio(jsonb), voz_vm.agregar_passadas(jsonb),
    voz_vm.gravar_resubmits(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.regras_discagem(jsonb), voz_vm.lote_do_dia(jsonb), voz_vm.registrar_onda(jsonb),
    voz_vm.pegar_reenvio(jsonb), voz_vm.concluir_reenvio(jsonb), voz_vm.agregar_passadas(jsonb),
    voz_vm.gravar_resubmits(jsonb) to motorcx_voz;

-- ================================================================ 12. pausa da rota (R17): sem crédito e bloqueio
-- Sem crédito (falha da operadora com SIP 402) ou bloqueio de originação num tronco: a VM para de discar por ele na
-- hora, grava a pausa aqui e a equipe recebe o aviso (bloqueio é crítico). A rota pausada não disca, em nenhuma VM,
-- até alguém da equipe com gerenciar_troncos_voz retomar, com uma nota (fica registrado quem e quando, mais a
-- auditoria). Vale para o tronco inteiro (a operadora), não para a carteira: independe da regra de discagem.
create table if not exists public.voz_troncos_pausas (
    id            bigint generated always as identity primary key,
    empresa_id    bigint not null references public.empresas (id) on delete cascade,
    tronco_id     bigint not null,
    motivo        text not null check (motivo in ('sem_credito', 'bloqueio_originacao')),
    causa_sip     int check (causa_sip between 100 and 699),
    pausado_em    timestamptz not null default now(),
    retomado_em   timestamptz,
    retomado_por  uuid references auth.users (id) on delete set null,
    nota          text check (nota is null or (char_length(trim(nota)) between 3 and 300
                                               and public.texto_sem_dado_pessoal(nota))),
    foreign key (tronco_id, empresa_id) references public.voz_troncos (id, empresa_id) on delete cascade,
    check ((retomado_em is null) = (nota is null))
);
create unique index if not exists voz_troncos_pausa_ativa on public.voz_troncos_pausas (tronco_id) where retomado_em is null;
create index if not exists voz_troncos_pausas_empresa on public.voz_troncos_pausas (empresa_id, pausado_em desc);
comment on table public.voz_troncos_pausas is
    'Rota (tronco) pausada pela VM por sem crédito ou bloqueio de originação. Não disca até a equipe retomar (nota e quem).';
alter table public.voz_troncos_pausas enable row level security;
drop policy if exists voz_troncos_pausas_ver on public.voz_troncos_pausas;
create policy voz_troncos_pausas_ver on public.voz_troncos_pausas for select to authenticated
    using (public.ve_faturamento(empresa_id) or public.cuida_voz(empresa_id));
revoke all on public.voz_troncos_pausas from anon;
revoke insert, update, delete on public.voz_troncos_pausas from authenticated;
grant select on public.voz_troncos_pausas to authenticated;

-- a VM (as duas chaves) pausa; devolve o id da pausa ativa (a mesma, se já estava pausado: um aviso só)
create or replace function public.pausar_tronco_voz(empresa bigint, tronco bigint, motivo text, causa_sip int default null)
returns bigint
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
    t public.voz_troncos;
    novo bigint;
    nome_empresa text;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    if motivo is null or motivo not in ('sem_credito', 'bloqueio_originacao') then
        raise exception 'motivo da pausa: sem_credito ou bloqueio_originacao';
    end if;
    if causa_sip is not null and causa_sip not between 100 and 699 then
        raise exception 'causa SIP de 100 a 699';
    end if;
    select * into t from public.voz_troncos x where x.id = tronco and x.empresa_id = empresa;
    if t.id is null or not exists (select 1 from public.voz_config c where c.empresa_id = empresa) then
        raise exception 'tronco não encontrado';
    end if;
    insert into public.voz_troncos_pausas as p (empresa_id, tronco_id, motivo, causa_sip)
    values (empresa, tronco, motivo, causa_sip)
    on conflict (tronco_id) where retomado_em is null do nothing
    returning p.id into novo;
    if novo is null then
        return (select p.id from public.voz_troncos_pausas p where p.tronco_id = tronco and p.retomado_em is null);
    end if;
    select e.nome into nome_empresa from public.empresas e where e.id = empresa;
    insert into public.avisos (para, empresa_id, tipo, titulo, texto, link, chave)
    values ('equipe', empresa, case when motivo = 'bloqueio_originacao' then 'erro' else 'atencao' end,
            left(case when motivo = 'bloqueio_originacao' then 'Crítico: rota de voz pausada por bloqueio de originação · '
                      else 'Rota de voz pausada sem crédito · ' end || coalesce(nome_empresa, ''), 140),
            left('O tronco ' || t.referencia || ' (' || t.operadora || ') '
                 || case when motivo = 'bloqueio_originacao' then 'recusou a originação'
                         else 'respondeu sem crédito' end
                 || coalesce(' (SIP ' || causa_sip || ')', '')
                 || ' e parou de discar. Resolva com a operadora e retome a rota no Console de voz: '
                 || 'fica registrado quem retomou e por quê.', 400),
            '/console/voz', 'tronco_pausado:' || novo);
    return novo;
end $$;

-- a equipe retoma (gerenciar_troncos_voz no alcance da empresa), com nota; a auditoria guarda o antes e o depois
create or replace function public.retomar_tronco_voz(pausa bigint, nota text) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare p public.voz_troncos_pausas;
begin
    select * into p from public.voz_troncos_pausas x where x.id = pausa for update;
    if p.id is null or not public.cuida_voz(p.empresa_id) then
        raise exception 'pausa não encontrada';
    end if;
    if p.retomado_em is not null then
        raise exception 'a rota já foi retomada';
    end if;
    if nota is null or char_length(trim(nota)) not between 3 and 300 then
        raise exception 'conte em poucas palavras o que foi resolvido (3 a 300 caracteres)';
    end if;
    if not public.texto_sem_dado_pessoal(nota) then
        raise exception 'a nota não pode ter CPF, telefone ou e-mail';
    end if;
    update public.voz_troncos_pausas x set retomado_em = now(), retomado_por = auth.uid(), nota = trim(retomar_tronco_voz.nota)
     where x.id = p.id returning * into p;
    return jsonb_build_object('id', p.id, 'tronco_id', p.tronco_id, 'motivo', p.motivo, 'pausado_em', p.pausado_em,
                              'retomado_em', p.retomado_em);
end $$;

-- a VM lê as pausas ativas das empresas dela (a cada minuto: a retomada vale sem reiniciar nada)
create or replace function public.troncos_pausados_voz(empresas bigint[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'empresa_id', p.empresa_id, 'tronco_id', p.tronco_id,
                                                         'motivo', p.motivo, 'pausado_em', p.pausado_em) order by p.id)
                       from public.voz_troncos_pausas p
                      where p.retomado_em is null and p.empresa_id = any (coalesce(empresas, '{}'))), '[]'::jsonb);
end $$;

revoke all on function public.pausar_tronco_voz(bigint, bigint, text, int), public.troncos_pausados_voz(bigint[])
    from public, anon, authenticated;
grant execute on function public.pausar_tronco_voz(bigint, bigint, text, int), public.troncos_pausados_voz(bigint[])
    to service_role;
revoke all on function public.retomar_tronco_voz(bigint, text) from public, anon;
grant execute on function public.retomar_tronco_voz(bigint, text) to authenticated;

create or replace function voz_vm.pausar_tronco(args jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    if not voz_vm.tem_voz((args ->> 'empresa')::bigint) then
        raise exception 'empresa sem voz configurada';
    end if;
    return to_jsonb(public.pausar_tronco_voz((args ->> 'empresa')::bigint, (args ->> 'tronco')::bigint, args ->> 'motivo',
                                             (args ->> 'causa_sip')::int));
end $$;
create or replace function voz_vm.troncos_pausados(args jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
    select public.troncos_pausados_voz(array(select e::bigint from jsonb_array_elements_text(coalesce(args -> 'empresas', '[]')) e
                                              where voz_vm.tem_voz(e::bigint)))
$$;
revoke all on function voz_vm.pausar_tronco(jsonb), voz_vm.troncos_pausados(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.pausar_tronco(jsonb), voz_vm.troncos_pausados(jsonb) to motorcx_voz;

-- ================================================================ 13. janelas do lote (R18): UF/DDD na prévia
-- A VM conta os clientes do lote por janela de discagem (horário de Brasília, já cortado pela UF/DDD e pela faixa
-- legal): só contagem por janela e as UFs, nunca cliente ou telefone. A prévia da reciclagem usa para dizer se cabe.
create or replace function public.janelas_lote_voz_ok(j jsonb) returns boolean
language sql immutable parallel safe as $$
    select j is null or (jsonb_typeof(j) = 'array' and jsonb_array_length(j) <= 40
        and not exists (select 1 from jsonb_array_elements(j) e
                         where jsonb_typeof(e) <> 'object'
                            or exists (select 1 from jsonb_object_keys(e) k where k not in ('abre', 'fecha', 'ufs', 'clientes'))
                            or coalesce(e ->> 'abre', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                            or coalesce(e ->> 'fecha', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                            or e ->> 'fecha' <= e ->> 'abre'
                            or jsonb_typeof(e -> 'clientes') <> 'number' or (e ->> 'clientes')::numeric < 0
                            or (e ->> 'clientes')::numeric <> floor((e ->> 'clientes')::numeric)
                            or (e ? 'ufs' and (jsonb_typeof(e -> 'ufs') <> 'array' or jsonb_array_length(e -> 'ufs') > 27
                                or exists (select 1 from jsonb_array_elements(e -> 'ufs') u
                                            where jsonb_typeof(u) <> 'string' or u #>> '{}' !~ '^[A-Z]{2}$')))))
$$;
revoke all on function public.janelas_lote_voz_ok(jsonb) from public, anon;
grant execute on function public.janelas_lote_voz_ok(jsonb) to authenticated, service_role;
alter table public.voz_lotes add column if not exists janelas jsonb;
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'voz_lotes_janelas_ok') then
        alter table public.voz_lotes add constraint voz_lotes_janelas_ok check (public.janelas_lote_voz_ok(janelas));
    end if;
end $$;
comment on column public.voz_lotes.janelas is
    'Clientes do lote por janela de discagem (horário de Brasília, pela UF/DDD): [{abre, fecha, ufs, clientes}]. Da VM.';

create or replace function public.registrar_janelas_lote_voz(lote bigint, janelas jsonb) returns int
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare l public.voz_lotes;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz()) then
        raise exception 'só o servidor ou a VM de voz';
    end if;
    select * into l from public.voz_lotes v where v.id = lote;
    if l.id is null or not exists (select 1 from public.voz_config c where c.empresa_id = l.empresa_id) then
        raise exception 'lote não encontrado';
    end if;
    if janelas is null or not public.janelas_lote_voz_ok(janelas) then
        raise exception 'janelas: lista de {abre, fecha HH:MM, ufs, clientes}';
    end if;
    update public.voz_lotes v set janelas = registrar_janelas_lote_voz.janelas where v.id = l.id;
    return jsonb_array_length(janelas);
end $$;
revoke all on function public.registrar_janelas_lote_voz(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_janelas_lote_voz(bigint, jsonb) to service_role;
create or replace function voz_vm.registrar_janelas_lote(args jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select to_jsonb(public.registrar_janelas_lote_voz((args ->> 'lote')::bigint, args -> 'janelas'))
$$;
revoke all on function voz_vm.registrar_janelas_lote(jsonb) from public, anon, authenticated, service_role;
grant execute on function voz_vm.registrar_janelas_lote(jsonb) to motorcx_voz;

-- ================================================================ 14. chamada curta no banco (a mesma do motor)
-- Gerado de motor/voz.py (NAO_COMPLETADA, CURTA_SE_ABANDONO, TECNICOS) e motor/discagem.py (chamadas_curtas,
-- PRIOR_CURTA, FORCA_CARTEIRA, FORCA_NUMERO); tests/test_resubmit.py confere que são iguais.
create or replace function public.regras_curtas_voz() returns jsonb
language sql immutable parallel safe as $$
    select '{"sempre":["numero_inexistente","nao_atendida","caixa_postal","ocupado","falha_rede","inexistente_voz","maquina","falha_operadora","bloqueio_originacao","cancelada_discador","indisponivel","rejeitada"],"abandono":["abandonada"],"tecnicos":["falha_rede","falha_operadora","bloqueio_originacao","cancelada_discador","indisponivel"],"segundos":6,"aviso":0.75,"prior":0.9,"forca_carteira":20.0,"forca_numero":5.0}'::jsonb
$$;

-- motor/discagem.py › e_curta: cc = credores.discagem › chamadas_curtas (o que faltar vale o padrão)
create or replace function public.chamada_curta_voz(resultado text, duracao_s int, cc jsonb default '{}') returns boolean
language sql immutable parallel safe as $$
    with r as (select public.regras_curtas_voz() as g)
    select case
        when resultado in (select jsonb_array_elements_text(r.g -> 'tecnicos'))
             and not coalesce((cc ->> 'falha_conta')::boolean, true) then false
        when duracao_s is not null and duracao_s <= coalesce((cc ->> 'segundos')::int, (r.g ->> 'segundos')::int) then true
        when resultado in (select jsonb_array_elements_text(r.g -> 'sempre')) then true
        else coalesce(resultado in (select jsonb_array_elements_text(r.g -> 'abandono')), false)
             and coalesce((cc ->> 'abandono_conta')::boolean, true) end
      from r
$$;
revoke all on function public.regras_curtas_voz(), public.chamada_curta_voz(text, int, jsonb) from public, anon;
grant execute on function public.regras_curtas_voz(), public.chamada_curta_voz(text, int, jsonb) to authenticated, service_role;

-- ================================================================ 15. resumo do Resubmit do dia (R19)
-- Só contagens (nunca telefone, hash ou cliente): decisões por situação de origem e por motivo de ficar fora, por
-- origem (automática, Reenviar agora, reciclagem), pedidos do dia e rotas pausadas. A VM grava em
-- execucoes.resumo.voz.resubmit na agregação da noite (agregar_passadas_voz); a empresa também lê pela RPC.
create or replace function public.resumo_resubmit_voz(empresa bigint, credor bigint, dia date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
    ini timestamptz := dia::timestamp at time zone 'America/Sao_Paulo';
    fim timestamptz := (dia + 1)::timestamp at time zone 'America/Sao_Paulo';
    r jsonb;
begin
    if not (public.chamada_do_servidor() or public.chamada_da_vm_voz() or empresa in (select public.minhas_empresas())) then
        raise exception 'empresa não encontrada';
    end if;
    with d as (
        select v.situacao_origem, v.decisao, v.motivo_fora, v.origem from public.voz_resubmits v
         where v.empresa_id = empresa and v.credor_id is not distinct from credor and v.criado_em >= ini and v.criado_em < fim),
    s as (
        select d.situacao_origem, jsonb_build_object(
                   'total', count(*), 'finaliza', count(*) filter (where d.decisao = 'finaliza'),
                   'redisca', count(*) filter (where d.decisao = 'redisca'),
                   'proximo_telefone', count(*) filter (where d.decisao = 'proximo_telefone'),
                   'proximo_cliente', count(*) filter (where d.decisao = 'proximo_cliente'),
                   'fora', count(*) filter (where d.decisao = 'fora')) as c
          from d group by d.situacao_origem),
    m as (select d.motivo_fora, count(*) as n from d where d.decisao = 'fora' group by d.motivo_fora),
    o as (select d.origem, count(*) as n from d group by d.origem)
    select jsonb_build_object(
        'dia', dia, 'decisoes', (select count(*) from d),
        'por_situacao', coalesce((select jsonb_object_agg(s.situacao_origem, s.c order by s.situacao_origem) from s), '{}'),
        'por_motivo_fora', coalesce((select jsonb_object_agg(m.motivo_fora, m.n order by m.motivo_fora) from m), '{}'),
        'por_origem', coalesce((select jsonb_object_agg(o.origem, o.n order by o.origem) from o), '{}'),
        'reenvios', (select count(*) from public.voz_reenvios x where x.empresa_id = empresa
                       and x.credor_id is not distinct from credor and x.pedido_em >= ini and x.pedido_em < fim),
        'reciclagens', (select count(*) from public.voz_reciclagens x where x.empresa_id = empresa
                          and x.credor_id is not distinct from credor and x.data = dia),
        'rotas_pausadas', (select count(*) from public.voz_troncos_pausas x where x.empresa_id = empresa
                             and x.pausado_em >= ini and x.pausado_em < fim))
      into r;
    return r;
end $$;
revoke all on function public.resumo_resubmit_voz(bigint, bigint, date) from public, anon;
grant execute on function public.resumo_resubmit_voz(bigint, bigint, date) to authenticated, service_role;

-- ================================================================ 16. auditoria
do $$
declare t text;
begin
    foreach t in array array['regras_voz_versoes', 'voz_reenvios', 'voz_reciclagens', 'voz_troncos_pausas'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
