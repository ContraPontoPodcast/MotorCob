-- SQL 65 · Renitência por situação, Resubmit automático, Reenviar agora e Contato por passada
-- Protótipo aprovado pelo dono (ux/renitencia-prototipo.html, necessidades R1 a R10) e respostas de 01/11/2026:
-- * Resubmit "depois de" menor que o intervalo da renitência: vale o maior.
-- * Prioridade "topo" pode furar a fila das 1ªs tentativas (muda a regra 5 do agendador).
-- * "Fora de área/desligado" (indisponivel) é falha técnica: não conta no descanso por não atende e nunca penaliza o
--   número (motor/voz.py). Falha técnica continua contando como tentativa do dia.
-- * "Reenviar agora" (permissão nova reenviar_lote_voz): ligada por padrão para Admin e Operação.
-- * As regras do Resubmit ficam dentro de credores.discagem: uma validação, um histórico de versões, uma auditoria.
--
-- R1  credores.discagem ganha por_situacao, falhas_tecnicas, resubmit e chamadas_curtas.falha_conta (sem coluna
--     nova; sem as chaves, o motor e a VM fazem o de hoje). Validação: discagem_erros() (mesmas regras de
--     motor/discagem.py › normalizar, geradas de lá; tests/test_resubmit.py confere) e discagem_padrao() (o padrão
--     MotorCX que o site mostra).
-- R2  regras_voz_versoes (histórico; leitura por empresa, escrita só pela RPC) e R2b salvar_discagem(): confere
--     editar_credores, recusa se outra pessoa salvou antes (versao_base), valida, grava credores.discagem e a versão.
-- R3  credores.discagem › resubmit {situação: {ativo, depois_minutos 0–600, max_dia 1–9, prioridade topo|normal|fim,
--     ate HH:MM, outro_numero}}.
-- R4  voz_ondas ganha origem (regua|resubmit|manual|reciclagem), passada, situacao_origem, prioridade e reenvio_id;
--     voz_chamadas ganha passada (1 = primeira do número no dia), situacao_origem e resubmit_id.
-- R5  voz_resubmits: cada decisão (volta ou fora, com o motivo). Só destino_hash, nunca o telefone. Leitura por
--     empresa; escrita só pela VM (voz_vm.gravar_resubmits ou a chave do servidor), com validação por linha no
--     gatilho (vale nos dois acessos). Apagada com a retenção da empresa (apagar_voz_expirada).
-- R6  previa_reenvio_voz(): só contagens. R7 voz_reenvios + pedir_reenvio_voz(). R8 permissão reenviar_lote_voz.
-- R9  voz_passadas_dia (gravada pela VM à noite: agregar_passadas_voz) e R10 contato_por_passada() (taxa nula com
--     menos de 30 chamadas).
-- VM (os dois acessos: chave do servidor e papel motorcx_voz): regras_discagem_voz, lote_voz_do_dia,
--     registrar_onda_voz, pegar_reenvio_voz, concluir_reenvio_voz e agregar_passadas_voz (as do public aceitam só o
--     servidor e a VM; as de voz_vm, só o motorcx_voz), e gravar_chamadas com passada, situacao_origem e resubmit_id.
-- Preparado para o que vem (não implementado aqui): modo_discagem em credores.discagem, voz_reciclagens e a
--     permissão reciclar_lote_voz (a origem "reciclagem" das ondas já é aceita).
-- LGPD: nenhuma coluna nova guarda CPF, nome ou telefone. Telefone só em hash (sha-256 em hex).
-- Depende dos SQL 51 (discagem do credor), 56 (voz), 57 (voz_vm) e 58 (gravar_chamadas com o fluxo). Se o 57 ou o
-- 58 for rodado de novo, rode este depois. Pode rodar de novo sem erro. Não precisa de superusuário.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select (select count(*) from pg_tables where schemaname = 'public'
--             and tablename in ('regras_voz_versoes', 'voz_resubmits', 'voz_reenvios', 'voz_passadas_dia')) as tabelas, -- 4
--          (select count(*) from pg_tables where schemaname = 'public'
--             and tablename in ('regras_voz_versoes', 'voz_resubmits', 'voz_reenvios', 'voz_passadas_dia')
--             and not rowsecurity) as sem_rls,                                                                      -- 0
--          (select count(*) from information_schema.columns where table_schema = 'public'
--             and ((table_name = 'voz_chamadas' and column_name in ('passada', 'situacao_origem', 'resubmit_id'))
--               or (table_name = 'voz_ondas' and column_name in ('origem', 'passada', 'situacao_origem',
--                                                                'prioridade', 'reenvio_id')))) as colunas,        -- 8
--          (select count(*) from public.permissoes_catalogo where codigo = 'reenviar_lote_voz') as permissao,       -- 1
--          cardinality(public.discagem_erros('{"resubmit": {"ocupado": {"max_dia": 99}}}')) as erro_validacao,     -- 1
--          public.discagem_padrao() -> 'resubmit' -> 'nao_atendida' ->> 'depois_minutos' as padrao_na,           -- 60
--          has_function_privilege('motorcx_voz', 'voz_vm.gravar_resubmits(jsonb)', 'execute') as vm_grava,         -- true
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

-- desfechos que encerram o cliente no dia e que nenhuma volta reabre (= voz/orquestrador/lote.py: ENCERRA_CLIENTE
-- menos REABRIVEIS): houve contato de verdade ou pedido explícito
create or replace function public.encerra_cliente_voz() returns text[]
language sql immutable parallel safe as $$
    select array['cpc', 'identidade_confirmada', 'opt_out', 'promessa', 'recado', 'recusa', 'atendida_sem_cpc']::text[]
$$;

-- ================================================================ 2. validação e padrão (R1, R3)
-- regras geradas de motor/discagem.py (_INTEIROS, _SUB, _SUB_SITUACAO, _SUB_FALHA, _SUB_RESUBMIT e as chaves de
-- PADRAO). tests/test_resubmit.py confere que este JSON é o do motor.
create or replace function public.discagem_regras() returns jsonb
language sql immutable parallel safe as $$
    select '{"_inteiros":{"tentativas_numero_dia":["int",1,10],"tentativas_cliente_dia":["int",1,10],"intervalo_min_minutos":["int",0,1440],"intervalo_ocupado_minutos":["int",0,1440]},"_blocos":{"descanso_nao_atende":{"ativo":"bool","n":["int",1,50],"em_dias":["int",1,60],"descansa_dias":["int",1,365]},"descanso_recusa":{"ativo":"bool","dias":["int",1,365]},"promessa_suspende":{"ativo":"bool","dias_sem_data":["int",1,90]},"inexistente":{"ativo":"bool","modo":["enum","so_voz","invalida"],"so_voz_desde":"data","confirmacoes":["int",1,10],"reteste_dias":["int",1,90],"max_retestes":["int",0,10],"sinal_outros_canais":"bool","aceita_tipo_b":"bool","trava_lote_ativo":"bool","trava_lote_minimo":["int",1,1000000],"trava_lote_fracao":"fracao","trava_lote_relativa":["real",1.0,20.0],"trava_lote_pp_min":"fracao","trava_rota_minimo":["int",1,1000000]},"agente_ia":{"peso_cpc":["real",0.0,2.0],"peso_cpc_sem_identidade":["real",0.0,2.0]},"retorno_agendado":{"ativo":"bool","max_dias":["int",1,60],"sem_hora_dias":["int",0,30],"de":"hora","ate":"hora"},"nao_ligar":{"ativo":"bool"},"chamadas_curtas":{"ativo":"bool","aviso":"fracao","corte_ativo":"bool","corte":"fracao","max_por_numero_dia":["int",1,1000000],"max_total_dia":["int",1,100000000],"abandono_conta":"bool","segundos":["int",1,60],"falha_conta":"bool"}},"por_situacao":{"chaves":["maquina","nao_atendida","ocupado","caixa_postal","desligou_sem_conversar","atendeu_desligou"],"campos":{"intervalo_minutos":["int",0,1440],"max_dia":["int",1,10],"conta_descanso":"bool"}},"falhas_tecnicas":{"chaves":["falha_operadora","sem_credito","falha_rede","indisponivel","bloqueio_originacao","cancelada_discador","abandonada"],"campos":{"religar_minutos":["int",0,1440],"aviso":"fracao"}},"resubmit":{"chaves":["maquina","nao_atendida","ocupado","caixa_postal","desligou_sem_conversar","retorno_agendado","atendeu_desligou","numero_incorreto","falha_operadora","sem_credito","falha_rede","indisponivel","bloqueio_originacao","cancelada_discador","abandonada"],"campos":{"ativo":"bool","depois_minutos":["int",0,600],"max_dia":["int",1,9],"prioridade":["enum","topo","normal","fim"],"ate":"hora","outro_numero":"bool"}},"_chaves":["agente_ia","chamadas_curtas","descanso_nao_atende","descanso_recusa","falhas_tecnicas","horarios","inexistente","intervalo_min_minutos","intervalo_ocupado_minutos","nao_ligar","por_situacao","promessa_suspende","resubmit","retorno_agendado","tentativas_cliente_dia","tentativas_numero_dia"]}'::jsonb
$$;

-- o padrão MotorCX que o site mostra (= motor/discagem.padrao_site(); o teste confere): os valores de hoje por
-- situação e falha técnica e o Resubmit sugerido (que só vale quando a carteira salva o bloco resubmit)
create or replace function public.discagem_padrao() returns jsonb
language sql immutable parallel safe as $$
    select '{"tentativas_numero_dia":2,"tentativas_cliente_dia":3,"intervalo_min_minutos":120,"intervalo_ocupado_minutos":15,"por_situacao":{"maquina":{"intervalo_minutos":120,"max_dia":2,"conta_descanso":true},"nao_atendida":{"intervalo_minutos":120,"max_dia":2,"conta_descanso":true},"ocupado":{"intervalo_minutos":15,"max_dia":2,"conta_descanso":true},"caixa_postal":{"intervalo_minutos":120,"max_dia":2,"conta_descanso":true},"desligou_sem_conversar":{"intervalo_minutos":120,"max_dia":2,"conta_descanso":false},"atendeu_desligou":{"intervalo_minutos":120,"max_dia":2,"conta_descanso":false}},"falhas_tecnicas":{"falha_operadora":{"religar_minutos":120,"aviso":0.15},"sem_credito":{"religar_minutos":120,"aviso":0.01},"falha_rede":{"religar_minutos":120,"aviso":0.05},"indisponivel":{"religar_minutos":120,"aviso":0.2},"bloqueio_originacao":{"religar_minutos":120,"aviso":0.01},"cancelada_discador":{"religar_minutos":120,"aviso":0.05},"abandonada":{"religar_minutos":120,"aviso":0.03}},"resubmit":{"maquina":{"ativo":true,"depois_minutos":120,"max_dia":1,"prioridade":"fim","ate":"19:00","outro_numero":true},"nao_atendida":{"ativo":true,"depois_minutos":60,"max_dia":2,"prioridade":"normal","ate":"19:30","outro_numero":true},"ocupado":{"ativo":true,"depois_minutos":15,"max_dia":2,"prioridade":"topo","ate":"19:30","outro_numero":false},"caixa_postal":{"ativo":true,"depois_minutos":120,"max_dia":1,"prioridade":"fim","ate":"19:00","outro_numero":true},"desligou_sem_conversar":{"ativo":true,"depois_minutos":90,"max_dia":1,"prioridade":"normal","ate":"19:00","outro_numero":false},"retorno_agendado":{"ativo":true,"depois_minutos":0,"max_dia":1,"prioridade":"topo","ate":"20:00","outro_numero":false},"atendeu_desligou":{"ativo":false,"depois_minutos":120,"max_dia":1,"prioridade":"fim","ate":"18:00","outro_numero":false},"numero_incorreto":{"ativo":false,"depois_minutos":30,"max_dia":1,"prioridade":"normal","ate":"19:00","outro_numero":true},"falha_operadora":{"ativo":true,"depois_minutos":30,"max_dia":2,"prioridade":"topo","ate":"19:30","outro_numero":false},"sem_credito":{"ativo":false,"depois_minutos":30,"max_dia":1,"prioridade":"normal","ate":"19:30","outro_numero":false},"falha_rede":{"ativo":true,"depois_minutos":30,"max_dia":2,"prioridade":"topo","ate":"19:30","outro_numero":false},"indisponivel":{"ativo":true,"depois_minutos":180,"max_dia":1,"prioridade":"fim","ate":"19:00","outro_numero":true},"bloqueio_originacao":{"ativo":false,"depois_minutos":120,"max_dia":1,"prioridade":"normal","ate":"19:00","outro_numero":false},"cancelada_discador":{"ativo":true,"depois_minutos":30,"max_dia":1,"prioridade":"topo","ate":"19:30","outro_numero":false},"abandonada":{"ativo":true,"depois_minutos":60,"max_dia":1,"prioridade":"topo","ate":"19:30","outro_numero":false}},"retorno_agendado":{"max_dias":7},"chamadas_curtas":{"falha_conta":true}}'::jsonb
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
        elsif k in ('por_situacao', 'falhas_tecnicas', 'resubmit') then
            if jsonb_typeof(v) <> 'object' then
                erros := erros || (k || ': precisa ser um objeto');
                continue;
            end if;
            for kk, vv in select * from jsonb_each(v) loop
                continue when kk like '\_%';
                if not (r -> k -> 'chaves') ? kk then
                    erros := erros || (k || '/' || kk || ': não existe');
                elsif jsonb_typeof(vv) <> 'object' then
                    erros := erros || (k || '/' || kk || ': precisa ser um objeto');
                else
                    for kkk, vvv in select * from jsonb_each(vv) loop
                        continue when kkk like '\_%';
                        regra := r -> k -> 'campos' -> kkk;
                        if regra is null then
                            erros := erros || (k || '/' || kk || ': ''' || kkk || ''' não existe');
                        elsif not public.discagem_valor_ok(vvv, regra) then
                            erros := erros || (k || '/' || kk || '/' || kkk || ': fora da faixa');
                        end if;
                    end loop;
                end if;
            end loop;
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
    public.discagem_erros(jsonb) from public, anon;
grant execute on function public.situacoes_resubmit_voz(), public.situacao_voz(text, int), public.encerra_cliente_voz(),
    public.discagem_regras(), public.discagem_padrao(), public.discagem_valor_ok(jsonb, jsonb),
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
    check (origem is null or origem in ('regua', 'resubmit', 'manual', 'reciclagem'));
alter table public.voz_ondas drop constraint if exists voz_ondas_passada_check;
alter table public.voz_ondas add constraint voz_ondas_passada_check check (passada is null or passada between 1 and 50);
alter table public.voz_ondas drop constraint if exists voz_ondas_situacao_origem_check;
alter table public.voz_ondas add constraint voz_ondas_situacao_origem_check
    check (situacao_origem is null or situacao_origem = any (public.situacoes_resubmit_voz()));
alter table public.voz_ondas drop constraint if exists voz_ondas_prioridade_check;
alter table public.voz_ondas add constraint voz_ondas_prioridade_check
    check (prioridade is null or prioridade in ('topo', 'normal', 'fim'));
comment on column public.voz_ondas.origem is
    'regua (1ª passada e a retentativa de hoje), resubmit (volta automática), manual (Reenviar agora). Nulo = onda antiga.';

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
    origem             text not null check (origem in ('auto', 'manual')),
    pedido_id          bigint references public.voz_reenvios (id) on delete set null,
    decisao            text not null check (decisao in ('volta', 'fora')),
    motivo_fora        text check (motivo_fora in ('max_dia', 'fora_horario', 'nao_ligar', 'promessa', 'inexistente',
                                                   'descanso', 'corte_curtas')),
    nao_antes_de       timestamptz,
    onda_id            bigint references public.voz_ondas (id) on delete set null,
    criado_em          timestamptz not null default now(),
    unique (empresa_id, ref),
    check ((decisao = 'fora') = (motivo_fora is not null)),
    check (origem = 'auto' or pedido_id is not null or decisao = 'fora')
);
create index if not exists voz_resubmits_lote on public.voz_resubmits (lote_id, situacao_origem);
create index if not exists voz_resubmits_empresa on public.voz_resubmits (empresa_id, criado_em);
comment on table public.voz_resubmits is
    'Decisão de cada volta do Resubmit (auto) ou do Reenviar agora (manual). Só destino_hash, nunca o telefone. Gravada pela VM.';

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
                                                     where r.id = new.pedido_id and r.empresa_id = new.empresa_id)) then
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
        case when sit = any (array['falha_operadora', 'sem_credito', 'falha_rede', 'indisponivel', 'bloqueio_originacao',
                                   'cancelada_discador', 'abandonada'])
             then (d -> 'falhas_tecnicas' -> sit ->> 'religar_minutos')::int
             else (d -> 'por_situacao' -> sit ->> 'intervalo_minutos')::int end,
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
    contato text[]; sempre text[]; aband text[]; seg int; n int;
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
                           'situacao_origem', 'passada', 'origem', 'pedido_id', 'decisao', 'motivo_fora', 'nao_antes_de',
                           'onda_id', 'criado_em']);
    if fora is not null then
        raise exception 'colunas que a VM não grava em voz_resubmits: %', fora;
    end if;
    for r in select * from jsonb_populate_recordset(null::public.voz_resubmits, linhas) loop
        if r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id) then
            raise exception 'empresa sem voz configurada';
        end if;
        insert into public.voz_resubmits as v (ref, empresa_id, credor_id, lote_id, id_chamada_origem, id_cliente,
                                               destino_hash, situacao_origem, passada, origem, pedido_id, decisao,
                                               motivo_fora, nao_antes_de, onda_id, criado_em)
        values (r.ref, r.empresa_id, r.credor_id, r.lote_id, r.id_chamada_origem, r.id_cliente, r.destino_hash,
                r.situacao_origem, r.passada, r.origem, r.pedido_id, r.decisao, r.motivo_fora, r.nao_antes_de, r.onda_id,
                coalesce(r.criado_em, now()))
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

-- ================================================================ 11. auditoria
do $$
declare t text;
begin
    foreach t in array array['regras_voz_versoes', 'voz_reenvios'] loop
        execute format('drop trigger if exists z_auditar on public.%I', t);
        execute format('create trigger z_auditar after insert or update or delete on public.%I '
                       'for each row execute function public.auditar()', t);
    end loop;
end $$;
