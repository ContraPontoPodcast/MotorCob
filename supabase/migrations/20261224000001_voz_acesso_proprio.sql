-- SQL 57 · Agente de voz: acesso próprio das VMs do Asterisk (papel motorcx_voz), que só enxerga a voz
-- Decisão do dono: no piloto em modo simulado as VMs podem usar a chave do servidor (service_role); ANTES do modo real
-- elas passam a entrar no Postgres pelo pooler do Supabase (Supavisor) com o papel de login motorcx_voz.
-- O papel:
-- * é NOINHERIT, sem BYPASSRLS, sem CREATEDB/CREATEROLE, sem ser membro de nenhum papel e sem senha neste arquivo.
--   A senha é gerada no Secret Manager (motorcx-voz-db-senha) e definida pelo dono com o comando do
--   infra/asterisk/README.md (lê o segredo; nunca passa pelo chat nem por arquivo do repositório);
-- * não recebe nenhum grant em tabela do public: tudo passa pelo schema voz_vm (sem uso para public), com
--   - leitura por views de colunas escolhidas: voz_config, voz_troncos, voz_rotas, voz_transferencias, voz_contrato,
--     roteiros em uso, divisão da concorrência, id/slug/nome das empresas com voz, id/código das carteiras ativas delas e
--     as colunas de tarifação das chamadas (sem id_cliente, sem destino) para recalcular consumo_voz;
--   - escrita só por funções security definer (search_path vazio, nomes qualificados, validação por linha):
--     voz_chamadas, voz_gravacoes, consumo_voz, voz_lotes, voz_ondas e fornecedor_saude;
--   - publicação do envio de retorno (voz/publicacao.py): linha em envios só do tipo retorno, pendente, no caminho
--     <slug>/retorno/<dia>/<uuid>_motorcx_(voz|discador)_<dia>_<hhmmss>.csv, com o arquivo já no bucket entradas;
--   - arquivos (Lista do dia no bucket saidas, retorno no bucket entradas): o Postgres não lê nem grava o conteúdo do
--     Storage. A VM pede aqui um bilhete de uso único (2 min) para UM caminho validado e a Edge Function voz-arquivos
--     (supabase/functions/voz-arquivos) faz a operação, com a chave do servidor que só existe no ambiente dela;
-- * não lê clientes, carteiras (além de id/código), perfis, faturas nem nada fora da voz; não faz DDL.
-- Endurecimento junto: função security definer do public que ainda podia ser executada por PUBLIC passa a ser só de
-- anon/authenticated/service_role (o efeito para eles não muda), e funções novas deixam de nascer com execução para
-- PUBLIC. Assim um login direto (que consegue forjar request.jwt.claim.sub, coisa que a API não deixa) não alcança
-- função que confia em auth.uid().
-- Depende do SQL 56 (voz_base). Se o SQL 56 for rodado de novo, rode este depois (ele refaz a troca na divisão da
-- concorrência). Pode rodar de novo sem erro (não mexe na senha do papel). Os SQL seguintes que estendem o voz_vm
-- (58 em diante) refazem as trocas deles: rodou este de novo, rode-os de novo depois, em ordem.
--
-- Conferência (no SQL Editor do Supabase, depois de rodar):
--   select r.rolcanlogin as entra, r.rolinherit as herda, r.rolbypassrls as fura_rls, r.rolsuper as super,
--          r.rolcreatedb or r.rolcreaterole as cria,                                                         -- t f f f f
--          (select count(*) from pg_auth_members m where m.member = r.oid) as membro_de,                      -- 0
--          (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
--            where n.nspname not in ('pg_catalog', 'information_schema') and c.relkind in ('r', 'v', 'm', 'p', 'f')
--              and n.nspname <> 'voz_vm'
--              and (has_table_privilege(r.oid, c.oid, 'select') or has_table_privilege(r.oid, c.oid, 'insert')
--                   or has_table_privilege(r.oid, c.oid, 'update') or has_table_privilege(r.oid, c.oid, 'delete'))
--          ) as tabelas_fora_da_voz,                                                                           -- 0
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where p.prosecdef and n.nspname <> 'voz_vm' and n.nspname not like 'pg\_%'
--              and has_function_privilege(r.oid, p.oid, 'execute')) as definer_fora_da_voz,                   -- 0
--          (select count(*) from pg_namespace n where n.nspname not like 'pg\_%'
--              and has_schema_privilege(r.oid, n.oid, 'create')) as schemas_com_create,                        -- 0
--          has_table_privilege(r.oid, 'voz_vm.config', 'select') as le_config,                                -- true
--          has_function_privilege(r.oid, 'voz_vm.gravar_chamadas(jsonb)', 'execute') as grava_chamadas,      -- true
--          r.rolpassword is not null as tem_senha                                                             -- (*)
--     from pg_authid r where r.rolname = 'motorcx_voz';
--   (*) pg_authid só é legível por superusuário; sem acesso, troque "pg_authid" por "pg_roles" e tire a última
--   coluna. tem_senha = false até o dono rodar o passo da senha (o papel não entra sem ela).

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

-- ================================================================ 1. o papel
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'motorcx_voz') then
        create role motorcx_voz login noinherit nosuperuser nocreatedb nocreaterole nobypassrls noreplication
            connection limit 20;
    end if;
end $$;
-- reafirma os atributos (sem PASSWORD: rodar de novo não troca nem apaga a senha que o dono definiu).
-- No Supabase o "postgres" não é superusuário: ele não pode nem citar SUPERUSER, BYPASSRLS ou REPLICATION num
-- ALTER ROLE (dá "permission denied to alter role"). Esses três só nascem no CREATE acima e são conferidos aqui.
alter role motorcx_voz with login noinherit nocreatedb nocreaterole connection limit 20;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'motorcx_voz'
                  and (rolsuper or rolbypassrls or rolreplication)) then
        raise exception 'motorcx_voz não pode ser superusuário, furar RLS nem replicar: apague o papel e rode de novo';
    end if;
end $$;
alter role motorcx_voz set search_path = voz_vm;
alter role motorcx_voz set statement_timeout = '30s';
alter role motorcx_voz set idle_in_transaction_session_timeout = '60s';
alter role motorcx_voz set lock_timeout = '10s';
comment on role motorcx_voz is
    'Login das VMs de voz (Asterisk) pelo pooler. Só o schema voz_vm. Senha: segredo motorcx-voz-db-senha (SQL 57).';

-- nenhum papel herdado ou "set role" possível: tira qualquer participação que alguém tenha dado à mão
do $$
declare g name;
begin
    for g in select b.rolname from pg_auth_members m join pg_roles b on b.oid = m.roleid
              where m.member = (select oid from pg_roles where rolname = 'motorcx_voz') loop
        execute format('revoke %I from motorcx_voz', g);
    end loop;
end $$;

-- nada explícito em outros schemas (o que vier de PUBLIC é tratado no item 2). Schema que quem roda não alcança
-- (do próprio Supabase) é pulado: um papel novo não tem grant lá, e a conferência do topo mostra se tiver.
do $$
declare s name;
begin
    for s in select n.nspname from pg_namespace n
              where n.nspname not like 'pg\_%' and n.nspname not in ('information_schema', 'voz_vm')
                and has_schema_privilege(n.oid, 'usage') loop
        begin
            execute format('revoke all on all tables in schema %I from motorcx_voz', s);
            execute format('revoke all on all sequences in schema %I from motorcx_voz', s);
            execute format('revoke all on all functions in schema %I from motorcx_voz', s);
            execute format('revoke create on schema %I from motorcx_voz', s);
        exception when insufficient_privilege then
            null;
        end;
    end loop;
    begin
        execute format('revoke create, temporary on database %I from motorcx_voz', current_database());
    exception when insufficient_privilege then
        null;
    end;
end $$;

-- ================================================================ 2. funções security definer fora do alcance de PUBLIC
-- Um login direto consegue gravar request.jwt.claim.sub (a API não deixa). Função security definer que PUBLIC ainda
-- executa passa a ser só dos papéis da API, que já a executavam por PUBLIC: para eles nada muda.
do $$
declare f regprocedure;
begin
    for f in select p.oid::regprocedure from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.prosecdef
                and has_function_privilege('public', p.oid, 'execute')
                and pg_has_role(p.proowner, 'usage') loop          -- só as de quem roda (as do Supabase ficam)
        execute format('revoke execute on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated, service_role', f);
    end loop;
end $$;
-- funções criadas daqui em diante (por quem roda as migrações) não nascem executáveis por PUBLIC; no Supabase os
-- papéis da API continuam com os privilégios padrão próprios deles
alter default privileges in schema public revoke execute on functions from public;

-- ================================================================ 3. schema da VM
create schema if not exists voz_vm;
revoke all on schema voz_vm from public;
grant usage on schema voz_vm to motorcx_voz;
alter default privileges in schema voz_vm revoke execute on functions from public;
comment on schema voz_vm is 'Interface das VMs de voz (papel motorcx_voz): views de leitura e funções de escrita.';

-- quem está chamando é a VM (login direto do papel). session_user não se forja sem superusuário.
create or replace function public.chamada_da_vm_voz() returns boolean
language sql stable set search_path = '' as $$ select session_user = 'motorcx_voz'::name $$;
revoke all on function public.chamada_da_vm_voz() from public, anon;
grant execute on function public.chamada_da_vm_voz() to authenticated, service_role;

-- empresa com voz configurada (toda escrita da VM exige)
create or replace function voz_vm.tem_voz(empresa bigint) returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.voz_config c where c.empresa_id = empresa)
$$;
revoke all on function voz_vm.tem_voz(bigint) from public;

-- ================================================================ 4. leitura (views do dono das tabelas: sem RLS no caminho)
create or replace view voz_vm.config with (security_barrier = true) as
    select c.empresa_id, c.provedor, c.modo, c.agent_id, c.voz_id, c.numeros_teste_hash, c.pico_multiplo,
           c.alo_fake_liberado, c.bucket_gravacoes, c.alo_fake, c.alo_fake_max_s, c.alo_fake_audio_ref,
           c.abandono_max_pct, c.freio_ritmo_pct, c.variaveis, c.gravar, c.aviso_gravacao, c.retencao_dias,
           c.transcrever, c.transcrever_min_segundos, c.atualizado_em
      from public.voz_config c;

create or replace view voz_vm.troncos with (security_barrier = true) as
    select t.id, t.empresa_id, t.referencia, t.operadora, t.host, t.porta, t.transporte, t.autenticacao, t.usuario,
           t.segredo_ref, t.ddd_origem, t.bina, t.formato_discagem, t.csp, t.codecs, t.canais, t.cps, t.ativo,
           t.atualizado_em
      from public.voz_troncos t;

create or replace view voz_vm.rotas with (security_barrier = true) as
    select r.id, r.empresa_id, r.tronco_id, r.prioridade, r.tech_prefix, r.tipo, r.cadencia_inicial_s,
           r.cadencia_incremento_s, r.preco_minuto, r.vigente_desde, r.vigente_ate
      from public.voz_rotas r;

create or replace view voz_vm.transferencias with (security_barrier = true) as
    select t.id, t.empresa_id, t.credor_id, t.nome, t.destino_sip, t.metodo, t.tronco_id, t.tech_prefix,
           t.cabecalhos, t.ativo, t.atualizado_em
      from public.voz_transferencias t;

create or replace view voz_vm.contrato with (security_barrier = true) as
    select c.concorrencia_contratada from public.voz_contrato c where c.id;

create or replace view voz_vm.roteiros_em_uso with (security_barrier = true) as
    select r.id, r.empresa_id, r.credor_id, r.versao, r.tipo_agente, r.prompt, r.primeira_fala, r.apresentar_virtual,
           r.regras_transferencia, r.em_uso_em
      from public.voz_roteiros r where r.situacao = 'em_uso';

-- a divisão devolve todas as empresas para o servidor e, agora, também para a VM (session_user = motorcx_voz)
select pg_temp.trocar('public.divisao_concorrencia_voz()',
    'where public.chamada_do_servidor() or f.empresa_id',
    'where public.chamada_do_servidor() or public.chamada_da_vm_voz() or f.empresa_id');
-- função da view chamada pela VM: precisa de execução para o papel, então passa por uma função de voz_vm
create or replace function voz_vm.divisao()
returns table (empresa_id bigint, canais int, contratado int, cota numeric, limite int, pico_multiplo int, teto int)
language sql stable security definer set search_path = '' as $$
    select * from public.divisao_concorrencia_voz()
$$;
create or replace view voz_vm.divisao_concorrencia as select * from voz_vm.divisao();

-- só id, slug (monta o caminho dos arquivos) e nome (variável assessoria do recado neutro do fluxo, SQL 58) das
-- empresas com voz. Sem CNPJ, endereço nem contato.
create or replace view voz_vm.empresas with (security_barrier = true) as
    select e.id, e.slug, e.nome from public.empresas e
     where exists (select 1 from public.voz_config c where c.empresa_id = e.id);

-- só id e código (pasta da Lista do dia) das carteiras ativas das empresas com voz
create or replace view voz_vm.carteiras with (security_barrier = true) as
    select k.id, k.empresa_id, k.codigo, k.ativo from public.credores k
     where k.ativo and exists (select 1 from public.voz_config c where c.empresa_id = k.empresa_id);

-- colunas de tarifação das chamadas (recalcular consumo_voz): sem id_cliente, sem destino, sem códigos
create or replace view voz_vm.chamadas_tarifacao with (security_barrier = true) as
    select v.empresa_id, v.id_chamada, v.canal, v.modo, v.ocorrido_em, v.tech_prefix, v.billsec,
           v.segundos_tarifados, v.rota_id, v.custo_operadora
      from public.voz_chamadas v;

revoke all on voz_vm.config, voz_vm.troncos, voz_vm.rotas, voz_vm.transferencias, voz_vm.contrato,
              voz_vm.roteiros_em_uso, voz_vm.divisao_concorrencia, voz_vm.empresas, voz_vm.carteiras,
              voz_vm.chamadas_tarifacao from public, anon, authenticated, service_role;
grant select on voz_vm.config, voz_vm.troncos, voz_vm.rotas, voz_vm.transferencias, voz_vm.contrato,
               voz_vm.roteiros_em_uso, voz_vm.divisao_concorrencia, voz_vm.empresas, voz_vm.carteiras,
               voz_vm.chamadas_tarifacao to motorcx_voz;

-- ================================================================ 5. escrita: chamadas (upsert por empresa, id_chamada e canal)
-- O mesmo formato do modo chave (voz/banco.py › COLUNAS e CONFLITO, corrigido no #152): só colunas reais de
-- voz_chamadas (transferencia, transferida_em, destino...) e upsert por (empresa_id, id_chamada, canal). Chave que não
-- é coluna gravável é recusada, como o PostgREST recusa coluna inexistente: nada é ignorado em silêncio. A tarifação
-- (rota, segundos, preço, custo, tarifada_em) é do gatilho tarifar_chamada_voz e a VM nunca manda (SO_DO_BANCO);
-- mandar também é recusado. Reenvio não apaga valor já gravado (coalesce). Modo ausente = o modo atual da empresa.
create or replace function voz_vm.gravar_chamadas(linhas jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; fora text;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 5000 then
        raise exception 'linhas: lista de até 5000 chamadas';
    end if;
    if exists (select 1 from jsonb_array_elements(linhas) e where jsonb_typeof(e) <> 'object') then
        raise exception 'linhas: cada chamada é um objeto';
    end if;
    select string_agg(distinct k, ', ' order by k) into fora
      from jsonb_array_elements(linhas) e, jsonb_object_keys(e) k
     where k <> all (array['empresa_id', 'credor_id', 'lote_id', 'onda_id', 'id_chamada', 'canal', 'id_cliente',
                           'id_acao', 'destino_mascara', 'destino_hash', 'tentativa', 'modo', 'provedor', 'conversa_ref',
                           'ocorrido_em', 'atendida_em', 'encerrada_em', 'duracao_s', 'billsec', 'causa_sip',
                           'causa_q850', 'dialstatus', 'amd', 'resultado_ia', 'resultado_operador', 'resultado',
                           'origem_resultado', 'destino', 'identidade_confirmada', 'transferencia', 'transferida_em',
                           'transferencia_id', 'minutos_ia', 'no_pico', 'tronco_id', 'tech_prefix', 'data_promessa',
                           'valor_promessa', 'retorno_em', 'roteiro_id', 'roteiro_versao', 'tem_gravacao',
                           'transcricao']);
    if fora is not null then
        raise exception 'colunas que a VM não grava em voz_chamadas: %', fora;
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.voz_chamadas, linhas) r
                where r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id)) then
        raise exception 'empresa sem voz configurada';
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.voz_chamadas, linhas) r
                where (r.credor_id is not null and not exists (select 1 from public.credores k
                                                               where k.id = r.credor_id and k.empresa_id = r.empresa_id))
                   or (r.tronco_id is not null and not exists (select 1 from public.voz_troncos t
                                                               where t.id = r.tronco_id and t.empresa_id = r.empresa_id))
                   or (r.lote_id is not null and not exists (select 1 from public.voz_lotes l
                                                             where l.id = r.lote_id and l.empresa_id = r.empresa_id))
                   or (r.onda_id is not null and not exists (select 1 from public.voz_ondas o
                                                             where o.id = r.onda_id and o.empresa_id = r.empresa_id))
                   or (r.roteiro_id is not null and not exists (select 1 from public.voz_roteiros x
                                                                where x.id = r.roteiro_id and x.empresa_id = r.empresa_id))
                   or (r.transferencia_id is not null and not exists (select 1 from public.voz_transferencias x
                                                       where x.id = r.transferencia_id and x.empresa_id = r.empresa_id))) then
        raise exception 'referência de outra empresa';
    end if;
    insert into public.voz_chamadas as v (
        empresa_id, credor_id, lote_id, onda_id, id_chamada, canal, id_cliente, id_acao, destino_mascara, destino_hash,
        tentativa, modo, provedor, conversa_ref, ocorrido_em, atendida_em, encerrada_em, duracao_s, billsec, causa_sip,
        causa_q850, dialstatus, amd, resultado_ia, resultado_operador, resultado, origem_resultado, destino,
        identidade_confirmada, transferencia, transferida_em, transferencia_id, minutos_ia, no_pico, tronco_id,
        tech_prefix, data_promessa, valor_promessa, retorno_em, roteiro_id, roteiro_versao, tem_gravacao, transcricao)
    select r.empresa_id, r.credor_id, r.lote_id, r.onda_id, r.id_chamada, coalesce(r.canal, 'agente_voz'), r.id_cliente,
           r.id_acao, r.destino_mascara, r.destino_hash, coalesce(r.tentativa, 1),
           coalesce(r.modo, (select c.modo from public.voz_config c where c.empresa_id = r.empresa_id), 'simulado'),
           r.provedor, r.conversa_ref, coalesce(r.ocorrido_em, now()), r.atendida_em, r.encerrada_em, r.duracao_s,
           r.billsec, r.causa_sip, r.causa_q850, r.dialstatus, r.amd, r.resultado_ia, r.resultado_operador, r.resultado,
           r.origem_resultado, r.destino, r.identidade_confirmada, r.transferencia, r.transferida_em,
           r.transferencia_id, r.minutos_ia, coalesce(r.no_pico, false), r.tronco_id, r.tech_prefix, r.data_promessa,
           r.valor_promessa, r.retorno_em, r.roteiro_id, r.roteiro_versao, coalesce(r.tem_gravacao, false), r.transcricao
      from jsonb_populate_recordset(null::public.voz_chamadas, linhas) r
    on conflict (empresa_id, id_chamada, canal) do update set
        credor_id = coalesce(excluded.credor_id, v.credor_id), lote_id = coalesce(excluded.lote_id, v.lote_id),
        onda_id = coalesce(excluded.onda_id, v.onda_id), id_cliente = excluded.id_cliente,
        id_acao = coalesce(excluded.id_acao, v.id_acao),
        destino_mascara = coalesce(excluded.destino_mascara, v.destino_mascara),
        destino_hash = coalesce(excluded.destino_hash, v.destino_hash), tentativa = excluded.tentativa,
        provedor = coalesce(excluded.provedor, v.provedor), conversa_ref = coalesce(excluded.conversa_ref, v.conversa_ref),
        atendida_em = coalesce(excluded.atendida_em, v.atendida_em),
        encerrada_em = coalesce(excluded.encerrada_em, v.encerrada_em),
        duracao_s = coalesce(excluded.duracao_s, v.duracao_s), billsec = coalesce(excluded.billsec, v.billsec),
        causa_sip = coalesce(excluded.causa_sip, v.causa_sip), causa_q850 = coalesce(excluded.causa_q850, v.causa_q850),
        dialstatus = coalesce(excluded.dialstatus, v.dialstatus), amd = coalesce(excluded.amd, v.amd),
        resultado_ia = coalesce(excluded.resultado_ia, v.resultado_ia),
        resultado_operador = coalesce(excluded.resultado_operador, v.resultado_operador),
        resultado = coalesce(excluded.resultado, v.resultado),
        origem_resultado = coalesce(excluded.origem_resultado, v.origem_resultado),
        destino = coalesce(excluded.destino, v.destino),
        identidade_confirmada = coalesce(excluded.identidade_confirmada, v.identidade_confirmada),
        transferencia = coalesce(excluded.transferencia, v.transferencia),
        transferida_em = coalesce(excluded.transferida_em, v.transferida_em),
        transferencia_id = coalesce(excluded.transferencia_id, v.transferencia_id),
        minutos_ia = coalesce(excluded.minutos_ia, v.minutos_ia), no_pico = excluded.no_pico or v.no_pico,
        tronco_id = coalesce(excluded.tronco_id, v.tronco_id), tech_prefix = coalesce(excluded.tech_prefix, v.tech_prefix),
        data_promessa = coalesce(excluded.data_promessa, v.data_promessa),
        valor_promessa = coalesce(excluded.valor_promessa, v.valor_promessa),
        retorno_em = coalesce(excluded.retorno_em, v.retorno_em), roteiro_id = coalesce(excluded.roteiro_id, v.roteiro_id),
        roteiro_versao = coalesce(excluded.roteiro_versao, v.roteiro_versao),
        tem_gravacao = excluded.tem_gravacao or v.tem_gravacao, transcricao = coalesce(excluded.transcricao, v.transcricao);
    get diagnostics n = row_count;
    return n;
end $$;

-- ================================================================ 6. escrita: consumo de telefonia (upsert por empresa, dia, prefixo)
create or replace function voz_vm.gravar_consumo(linhas jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 1000 then
        raise exception 'linhas: lista de até 1000 dias e prefixos';
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.consumo_voz, linhas) r
                where r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id)
                   or (r.rota_id is not null and not exists (select 1 from public.voz_rotas x
                                                             where x.id = r.rota_id and x.empresa_id = r.empresa_id))) then
        raise exception 'empresa sem voz configurada ou rota de outra empresa';
    end if;
    insert into public.consumo_voz as c (empresa_id, dia, tech_prefix, rota_id, chamadas, chamadas_atendidas,
                                         segundos_atendidos, segundos_tarifados, custo_estimado, sem_custo, atualizado_em)
    select r.empresa_id, r.dia, coalesce(r.tech_prefix, ''), r.rota_id, coalesce(r.chamadas, 0),
           coalesce(r.chamadas_atendidas, 0), coalesce(r.segundos_atendidos, 0), coalesce(r.segundos_tarifados, 0),
           r.custo_estimado, coalesce(r.sem_custo, 0), now()
      from jsonb_populate_recordset(null::public.consumo_voz, linhas) r
    on conflict (empresa_id, dia, tech_prefix) do update set
        rota_id = excluded.rota_id, chamadas = excluded.chamadas, chamadas_atendidas = excluded.chamadas_atendidas,
        segundos_atendidos = excluded.segundos_atendidos, segundos_tarifados = excluded.segundos_tarifados,
        custo_estimado = excluded.custo_estimado, sem_custo = excluded.sem_custo, atualizado_em = now();
    get diagnostics n = row_count;
    return n;
end $$;

-- ================================================================ 7. escrita: gravações (upsert por empresa e caminho)
-- A validade (expira_em) é do gatilho pela retenção da empresa e a guarda é do Admin: a VM não mexe em nenhuma.
-- A chamada pode vir pelo id do banco (chamada_id) ou por id_chamada (+ canal, padrão agente_voz).
-- linhas da VM com a chamada resolvida (usada só por gravar_gravacoes)
create or replace function voz_vm.linhas_gravacoes(linhas jsonb)
returns table (empresa_id bigint, credor_id bigint, chamada_id bigint, id_cliente text, id_acao text, origem text,
               caminho text, transcricao_caminho text, duracao_s int, gravada_em timestamptz)
language sql stable security definer set search_path = '' as $$
    select r.empresa_id, r.credor_id,
           coalesce(r.chamada_id, (select v.id from public.voz_chamadas v
                                    where v.empresa_id = r.empresa_id and v.id_chamada = r.id_chamada
                                      and v.canal = coalesce(r.canal, 'agente_voz'))),
           r.id_cliente, r.id_acao, r.origem, r.caminho, r.transcricao_caminho, r.duracao_s,
           coalesce(r.gravada_em, now())
      from jsonb_to_recordset(linhas) as r(empresa_id bigint, credor_id bigint, chamada_id bigint, id_chamada text,
                                           canal text, id_cliente text, id_acao text, origem text, caminho text,
                                           transcricao_caminho text, duracao_s int, gravada_em timestamptz)
$$;

create or replace function voz_vm.gravar_gravacoes(linhas jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 1000 then
        raise exception 'linhas: lista de até 1000 gravações';
    end if;
    if exists (select 1 from voz_vm.linhas_gravacoes(linhas) g
                where g.empresa_id is null or not voz_vm.tem_voz(g.empresa_id)
                   or (g.chamada_id is not null and not exists (select 1 from public.voz_chamadas v
                                                                where v.id = g.chamada_id and v.empresa_id = g.empresa_id))
                   or (g.credor_id is not null and not exists (select 1 from public.credores k
                                                               where k.id = g.credor_id and k.empresa_id = g.empresa_id))) then
        raise exception 'empresa sem voz configurada ou referência de outra empresa';
    end if;
    insert into public.voz_gravacoes as x (empresa_id, credor_id, chamada_id, id_cliente, id_acao, origem, caminho,
                                           transcricao_caminho, duracao_s, gravada_em)
    select g.empresa_id, g.credor_id, g.chamada_id, g.id_cliente, g.id_acao, g.origem, g.caminho,
           g.transcricao_caminho, g.duracao_s, g.gravada_em
      from voz_vm.linhas_gravacoes(linhas) g
    on conflict (empresa_id, caminho) do update set
        chamada_id = coalesce(x.chamada_id, excluded.chamada_id),
        transcricao_caminho = coalesce(excluded.transcricao_caminho, x.transcricao_caminho),
        duracao_s = coalesce(excluded.duracao_s, x.duracao_s);
    get diagnostics n = row_count;
    update public.voz_chamadas v set tem_gravacao = true
      from voz_vm.linhas_gravacoes(linhas) g where v.id = g.chamada_id and not v.tem_gravacao;
    return n;
end $$;

-- ================================================================ 8. escrita: saúde de fornecedor e tronco
create or replace function voz_vm.gravar_saude(linhas jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 500 then
        raise exception 'linhas: lista de até 500 itens';
    end if;
    if exists (select 1 from jsonb_populate_recordset(null::public.fornecedor_saude, linhas) r
                where (r.empresa_id is not null and not voz_vm.tem_voz(r.empresa_id))
                   or (r.tronco_id is not null and not exists (select 1 from public.voz_troncos t
                                                               where t.id = r.tronco_id
                                                                 and t.empresa_id = r.empresa_id))) then
        raise exception 'empresa sem voz configurada ou tronco de outra empresa';
    end if;
    insert into public.fornecedor_saude as s (empresa_id, fornecedor, tronco_id, item, referencia, ok, contagem,
                                              detalhe, verificado_em)
    select r.empresa_id, r.fornecedor, r.tronco_id, r.item, coalesce(r.referencia, ''), r.ok, coalesce(r.contagem, 1),
           r.detalhe, now()
      from jsonb_populate_recordset(null::public.fornecedor_saude, linhas) r
    on conflict ((coalesce(empresa_id, 0)), (coalesce(fornecedor, '')), (coalesce(tronco_id, 0)), item, referencia)
    do update set ok = excluded.ok, contagem = excluded.contagem, detalhe = excluded.detalhe, verificado_em = now();
    get diagnostics n = row_count;
    return n;
end $$;

-- ================================================================ 9. escrita: lotes e ondas (sem id = cria; com id = atualiza)
-- A VM não tira um lote de aguardando_aprovacao, pausado ou cancelado (isso é da pessoa, por mudar_lote_voz) e só
-- avança agendado → ligando → concluido.
create or replace function voz_vm.gravar_lotes(linhas jsonb) returns table (id bigint)
language plpgsql security definer set search_path = '' as $$
declare
    r record;
    atual public.voz_lotes;
    nova text;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 500 then
        raise exception 'linhas: lista de até 500 lotes';
    end if;
    for r in select * from jsonb_to_recordset(linhas) as x(id bigint, empresa_id bigint, credor_id bigint, data date,
                 modo text, situacao text, roteiro_id bigint, total int, encerradas int, abandonos int,
                 custo_operadora numeric, freado_em timestamptz, concluido_em timestamptz) loop
        if r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id)
           or (r.credor_id is not null and not exists (select 1 from public.credores k
                                                       where k.id = r.credor_id and k.empresa_id = r.empresa_id))
           or (r.roteiro_id is not null and not exists (select 1 from public.voz_roteiros x
                                                        where x.id = r.roteiro_id and x.empresa_id = r.empresa_id)) then
            raise exception 'empresa sem voz configurada ou referência de outra empresa';
        end if;
        if r.id is null then
            if coalesce(r.situacao, 'agendado') not in ('aguardando_aprovacao', 'agendado') then
                raise exception 'lote novo nasce agendado ou aguardando aprovação';
            end if;
            insert into public.voz_lotes as l (empresa_id, credor_id, data, modo, situacao, roteiro_id, total)
            values (r.empresa_id, r.credor_id, r.data,
                    coalesce(r.modo, (select c.modo from public.voz_config c where c.empresa_id = r.empresa_id)),
                    coalesce(r.situacao, 'agendado'), r.roteiro_id, coalesce(r.total, 0))
            returning l.id into gravar_lotes.id;
        else
            select * into atual from public.voz_lotes l where l.id = r.id and l.empresa_id = r.empresa_id for update;
            if atual.id is null then
                raise exception 'lote não encontrado';
            end if;
            nova := case
                when r.situacao is null or r.situacao = atual.situacao then atual.situacao
                when atual.situacao = 'agendado' and r.situacao in ('ligando', 'concluido') then r.situacao
                when atual.situacao = 'ligando' and r.situacao = 'concluido' then r.situacao
                else atual.situacao end;          -- pausado, cancelado ou aguardando aprovação: fica como está
            update public.voz_lotes l set
                situacao = nova, total = coalesce(r.total, l.total), encerradas = coalesce(r.encerradas, l.encerradas),
                abandonos = coalesce(r.abandonos, l.abandonos),
                custo_operadora = coalesce(r.custo_operadora, l.custo_operadora),
                freado_em = coalesce(l.freado_em, r.freado_em),
                concluido_em = case when nova = 'concluido' then coalesce(l.concluido_em, r.concluido_em, now())
                                    else l.concluido_em end,
                atualizado_em = now()
             where l.id = atual.id;
            gravar_lotes.id := atual.id;
        end if;
        return next;
    end loop;
end $$;

create or replace function voz_vm.gravar_ondas(linhas jsonb) returns table (id bigint)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
    if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) > 500 then
        raise exception 'linhas: lista de até 500 ondas';
    end if;
    for r in select * from jsonb_to_recordset(linhas) as x(id bigint, empresa_id bigint, lote_id bigint, janela text,
                 tentativa int, total int, encerradas int, situacao text, abre_em timestamptz, fecha_em timestamptz) loop
        if r.empresa_id is null or not voz_vm.tem_voz(r.empresa_id)
           or not exists (select 1 from public.voz_lotes l where l.id = r.lote_id and l.empresa_id = r.empresa_id) then
            raise exception 'empresa sem voz configurada ou lote de outra empresa';
        end if;
        if r.id is null then
            insert into public.voz_ondas as o (empresa_id, lote_id, janela, tentativa, total, encerradas, situacao,
                                               abre_em, fecha_em)
            values (r.empresa_id, r.lote_id, r.janela, r.tentativa, coalesce(r.total, 0), coalesce(r.encerradas, 0),
                    coalesce(r.situacao, 'aguardando'), r.abre_em, r.fecha_em)
            returning o.id into gravar_ondas.id;
        else
            update public.voz_ondas o set total = coalesce(r.total, o.total), encerradas = coalesce(r.encerradas, o.encerradas),
                   situacao = coalesce(r.situacao, o.situacao), abre_em = coalesce(r.abre_em, o.abre_em),
                   fecha_em = coalesce(r.fecha_em, o.fecha_em)
             where o.id = r.id and o.empresa_id = r.empresa_id and o.lote_id = r.lote_id
            returning o.id into gravar_ondas.id;
            if gravar_ondas.id is null then
                raise exception 'onda não encontrada';
            end if;
        end if;
        return next;
    end loop;
end $$;

-- ================================================================ 10. arquivos: bilhete de uso único para a Edge Function
-- O Postgres não lê nem grava o conteúdo do Storage. A VM pede um bilhete para UMA operação num caminho validado:
--   baixar  saidas   <slug>/<AAAA-MM-DD>[/<código da carteira ativa>]/(discador_mailing.csv|ids/agente_voz.csv|
--                    ids/agente_voz_reserva.csv)  (só a Lista de voz; nenhum outro arquivo do motor)
--   enviar  entradas <slug>/retorno/<AAAA-MM-DD>/<uuid>_motorcx_(voz|discador)_<AAAA-MM-DD>_<hhmmss>.csv
--   apagar  entradas o mesmo padrão, só enquanto não há envio registrado no caminho (desfaz upload sem envios)
-- O bilhete vale 2 minutos e uma vez. O banco guarda só o sha-256 dele.
create table if not exists voz_vm.bilhetes (
    hash       text primary key check (hash ~ '^[0-9a-f]{64}$'),
    operacao   text not null check (operacao in ('baixar', 'enviar', 'apagar')),
    bucket     text not null check (bucket in ('saidas', 'entradas')),
    caminho    text not null check (char_length(caminho) <= 300),
    criado_em  timestamptz not null default now(),
    expira_em  timestamptz not null,
    usado_em   timestamptz
);
create index if not exists voz_bilhetes_criado on voz_vm.bilhetes (criado_em);
alter table voz_vm.bilhetes enable row level security;
revoke all on voz_vm.bilhetes from public, anon, authenticated, service_role, motorcx_voz;
comment on table voz_vm.bilhetes is 'Bilhetes de uso único da VM de voz para a Edge Function voz-arquivos (só o hash).';

-- empresa (com voz) dona do caminho, ou null se o caminho não é um dos permitidos
create or replace function voz_vm.empresa_do_caminho(operacao text, bucket text, caminho text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare
    m text[];
    e bigint;
begin
    if operacao = 'baixar' and bucket = 'saidas' then
        m := regexp_match(caminho, '^([a-z0-9][a-z0-9-]{1,39})/([0-9]{4}-[0-9]{2}-[0-9]{2})(/([a-z0-9][a-z0-9-]{0,39}))?/'
                                   '(discador_mailing\.csv|ids/agente_voz\.csv|ids/agente_voz_reserva\.csv)$');
    elsif operacao in ('enviar', 'apagar') and bucket = 'entradas' then
        m := regexp_match(caminho, '^([a-z0-9][a-z0-9-]{1,39})/retorno/([0-9]{4}-[0-9]{2}-[0-9]{2})/'
                                   '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_'
                                   'motorcx_(voz|discador)_([0-9]{4}-[0-9]{2}-[0-9]{2})_[0-9]{6}\.csv$');
        if m is not null and m[2] <> m[4] then
            return null;                     -- dia da pasta e do nome têm de ser o mesmo
        end if;
    end if;
    if m is null then
        return null;
    end if;
    select x.id into e from public.empresas x where x.slug = m[1];
    if e is null or not voz_vm.tem_voz(e) then
        return null;
    end if;
    if operacao = 'baixar' and m[4] is not null
       and not exists (select 1 from public.credores k where k.empresa_id = e and k.codigo = m[4] and k.ativo) then
        return null;
    end if;
    return e;
end $$;
revoke all on function voz_vm.empresa_do_caminho(text, text, text) from public;

create or replace function voz_vm.bilhete_arquivo(operacao text, bucket text, caminho text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
    t text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
    if voz_vm.empresa_do_caminho(operacao, bucket, caminho) is null then
        raise exception 'caminho não permitido para a VM de voz';
    end if;
    if operacao = 'apagar' and exists (select 1 from public.envios x where x.caminho = bilhete_arquivo.caminho) then
        raise exception 'arquivo já registrado em envios';
    end if;
    if (select count(*) from voz_vm.bilhetes b where b.criado_em > now() - interval '1 minute') >= 600 then
        raise exception 'limite de 600 bilhetes por minuto';
    end if;
    delete from voz_vm.bilhetes b where b.criado_em < now() - interval '1 day';
    insert into voz_vm.bilhetes (hash, operacao, bucket, caminho, expira_em)
    values (encode(sha256(convert_to(t, 'UTF8')), 'hex'), operacao, bucket, caminho, now() + interval '2 minutes');
    return t;
end $$;

-- a Edge Function voz-arquivos (chave do servidor) troca o bilhete pela operação, uma vez só
create or replace function public.consumir_bilhete_voz(bilhete_hash text)
returns table (operacao text, bucket text, caminho text)
language plpgsql volatile security definer set search_path = '' as $$
begin
    return query
    update voz_vm.bilhetes b set usado_em = now()
     where b.hash = bilhete_hash and b.usado_em is null and b.expira_em > now()
       and voz_vm.empresa_do_caminho(b.operacao, b.bucket, b.caminho) is not null
    returning b.operacao, b.bucket, b.caminho;
end $$;
revoke all on function public.consumir_bilhete_voz(text) from public, anon, authenticated;
grant execute on function public.consumir_bilhete_voz(text) to service_role;

-- ================================================================ 11. publicação do envio de retorno (voz/publicacao.py)
-- Linha em envios só do tipo retorno e pendente, no caminho permitido, com o arquivo já no bucket entradas e
-- enviado_por de um usuário ativo da equipe MotorCX (envios.enviado_por é obrigatório).
create or replace function voz_vm.registrar_retorno(empresa bigint, credor bigint, caminho text, nome_original text,
                                                    enviado_por uuid) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare n bigint;
begin
    if voz_vm.empresa_do_caminho('enviar', 'entradas', caminho) is distinct from empresa then
        raise exception 'caminho não é de retorno de voz desta empresa';
    end if;
    if nome_original !~ '^motorcx_(voz|discador)_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.csv$'
       or right(caminho, char_length(nome_original) + 1) <> '_' || nome_original then
        raise exception 'nome do arquivo não confere com o caminho';
    end if;
    if credor is not null and not exists (select 1 from public.credores k where k.id = credor and k.empresa_id = empresa) then
        raise exception 'carteira de outra empresa';
    end if;
    if not exists (select 1 from public.perfis p where p.id = enviado_por and p.equipe and p.ativo) then
        raise exception 'enviado_por precisa ser um usuário ativo da equipe MotorCX';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'entradas' and o.name = caminho) then
        raise exception 'arquivo não está no bucket entradas';
    end if;
    insert into public.envios (empresa_id, credor_id, tipo, caminho, nome_original, enviado_por, status)
    values (empresa, credor, 'retorno', caminho, nome_original, enviado_por, 'pendente')
    returning id into n;
    return n;
end $$;

-- ================================================================ 12. o que o papel executa
do $$
declare f regprocedure;
begin
    for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'voz_vm'::regnamespace loop
        execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    end loop;
end $$;
grant execute on function voz_vm.divisao(), voz_vm.gravar_chamadas(jsonb), voz_vm.gravar_consumo(jsonb), voz_vm.gravar_gravacoes(jsonb),
                          voz_vm.gravar_saude(jsonb), voz_vm.gravar_lotes(jsonb), voz_vm.gravar_ondas(jsonb),
                          voz_vm.bilhete_arquivo(text, text, text),
                          voz_vm.registrar_retorno(bigint, bigint, text, text, uuid) to motorcx_voz;
